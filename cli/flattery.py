#!/usr/bin/env python3
"""
flattery.py - find likely AI-built ("vibe coded") reimplementations on GitHub
and write a ranked, self-contained HTML report.

Every repo gets two scores, 0-100 each:
  * AI-built score         - agent config files, AI co-author trailers, commit bursts, README style
  * Reimplementation score - "drop-in replacement", "clean-room", "rewrite of", "compatible with" ...
A high score on both means a likely AI-built reimplementation.

Optionally pass --original owner/repo. Each candidate is then also compared with
that repo: license change and file-path overlap.

Stdlib only. Needs a GitHub token (GITHUB_TOKEN env var or --token), because
code search and commit search require authentication.

Examples:
  export GITHUB_TOKEN=ghp_...
  python3 flattery.py                                  # broad scan
  python3 flattery.py --target redis --original redis/redis
  python3 flattery.py --target "ffmpeg" --since 2025-06-01 --max-repos 60 -o ffmpeg.html
  python3 flattery.py --demo                           # preview the report with sample data
"""

import argparse
import base64
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api.github.com"

# ---------------------------------------------------------------- signals

# Path pattern -> (label, points). Matched against every path in the repo tree.
AGENT_FILES = [
    (re.compile(r"(^|/)CLAUDE\.md$", re.I), "CLAUDE.md", 25),
    (re.compile(r"(^|/)\.claude/"), ".claude/", 20),
    (re.compile(r"(^|/)AGENTS\.md$", re.I), "AGENTS.md", 20),
    (re.compile(r"(^|/)\.cursorrules$"), ".cursorrules", 20),
    (re.compile(r"(^|/)\.cursor/"), ".cursor/", 20),
    (re.compile(r"(^|/)\.windsurfrules$"), ".windsurfrules", 20),
    (re.compile(r"(^|/)\.aider[^/]*$"), ".aider*", 20),
    (re.compile(r"(^|/)\.github/copilot-instructions\.md$"), "copilot-instructions.md", 15),
    (re.compile(r"(^|/)GEMINI\.md$", re.I), "GEMINI.md", 20),
    (re.compile(r"(^|/)\.clinerules"), ".clinerules", 20),
    (re.compile(r"(^|/)\.kiro/"), ".kiro/", 20),
]
AGENT_FILES_CAP = 35

AI_TRAILERS = re.compile(
    r"co-authored-by:\s*(claude|copilot|cursor|devin|codex|gemini|aider|openhands|sweep|jules)"
    r"|generated with \[?claude code"
    r"|🤖 generated with"
    r"|^aider:"
    r"|\(aider\)"
    r"|codex-cli|cursor agent",
    re.I | re.M,
)

CLAIMS = [
    (re.compile(r"drop[- ]in replacement", re.I), "drop-in replacement"),
    (re.compile(r"clean[- ]room", re.I), "clean-room"),
    (re.compile(r"\b(re-?write|re-?implementation|reimplement(?:ed|s)?)\b( of| in)?", re.I), "rewrite/reimplementation"),
    (re.compile(r"\b(api[- ])?compatible with\b", re.I), "compatible with"),
    (re.compile(r"\bwritten from scratch\b|\bfrom the ground up\b", re.I), "from scratch"),
    (re.compile(r"\b(open[- ]source )?alternative to\b", re.I), "alternative to"),
    (re.compile(r"\bport of\b|\bported from\b", re.I), "port of"),
    (re.compile(r"\bfrom (the )?spec(ification)?\b", re.I), "from spec"),
    (re.compile(r"\b(re)?licens(ed|e) under (mit|apache|bsd)\b.*\b(originally|original)\b", re.I | re.S), "relicensed"),
]
CLAIM_POINTS = 18

VIBE_WORDS = re.compile(r"\b(vibe[- ]?coded|built with (claude|cursor|copilot|ai)|ai[- ]generated|written by (claude|ai|an llm))\b", re.I)

# Discovery queries. {t} is replaced by --target when given.
REPO_QUERIES_BROAD = [
    '"drop-in replacement" in:description',
    '"clean-room" in:readme',
    '"clean room implementation" in:readme',
    '"rewrite of" in:description',
    '"reimplementation of" in:description',
    '"written from scratch" "compatible" in:readme',
    '"vibe coded" in:readme,description',
]
REPO_QUERIES_TARGET = [
    '"{t}" "drop-in replacement" in:description,readme',
    '"{t}" "compatible" in:description',
    '"{t}" rewrite in:description',
    '"{t}" "clean-room" in:readme',
    '"{t}" alternative in:description',
    '"{t}" reimplementation in:description,readme',
]
CODE_QUERIES = [
    "path:CLAUDE.md",
    "path:AGENTS.md",
    "path:.cursorrules",
    "path:.github/copilot-instructions.md",
]
COMMIT_QUERIES = [
    '"Co-Authored-By: Claude"',
    '"Generated with Claude Code"',
]


# ---------------------------------------------------------------- HTTP

class GitHub:
    def __init__(self, token, verbose=True):
        self.token = token
        self.verbose = verbose
        self.calls = 0

    def log(self, *a):
        if self.verbose:
            print(*a, file=sys.stderr)

    def get(self, path, params=None, accept="application/vnd.github+json", raw=False):
        url = path if path.startswith("http") else API + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        for attempt in range(5):
            req = urllib.request.Request(url, headers={
                "Accept": accept,
                "Authorization": f"Bearer {self.token}",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "flattery",
            })
            try:
                self.calls += 1
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read()
                    return body.decode("utf-8", "replace") if raw else json.loads(body)
            except urllib.error.HTTPError as e:
                if e.code in (403, 429) and self._rate_limited(e):
                    continue
                if e.code in (404, 409, 422, 451):
                    return None
                if e.code >= 500 and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                self.log(f"  ! HTTP {e.code} on {url}: {e.read()[:200]!r}")
                return None
            except urllib.error.URLError as e:
                if attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                self.log(f"  ! network error on {url}: {e}")
                return None
        return None

    def _rate_limited(self, e):
        h = e.headers
        if h.get("Retry-After"):
            wait = int(h["Retry-After"]) + 1
        elif h.get("X-RateLimit-Remaining") == "0" and h.get("X-RateLimit-Reset"):
            wait = max(1, int(h["X-RateLimit-Reset"]) - int(time.time()) + 1)
        else:
            body = e.read()[:300].decode("utf-8", "replace").lower()
            if "rate limit" not in body:
                return False
            wait = 30
        wait = min(wait, 300)
        self.log(f"  … rate limited, sleeping {wait}s")
        time.sleep(wait)
        return True


# ---------------------------------------------------------------- discovery

def discover(gh, args):
    """Return {full_name: {"found_by": set(...)}}"""
    found = {}

    def add(name, why):
        found.setdefault(name, {"found_by": set()})["found_by"].add(why)

    date_q = f" created:>={args.since}" if args.since else ""
    lang_q = f" language:{args.language}" if args.language else ""
    star_q = f" stars:>={args.min_stars}" if args.min_stars else ""

    queries = ([q.format(t=args.target) for q in REPO_QUERIES_TARGET] if args.target else REPO_QUERIES_BROAD)
    for q in queries + list(args.query or []):
        full = q + date_q + lang_q + star_q + " fork:false"
        gh.log(f"repo search: {full}")
        res = gh.get("/search/repositories", {"q": full, "sort": "stars", "order": "desc", "per_page": args.per_query})
        for it in (res or {}).get("items", []):
            add(it["full_name"], f"repo: {q}")

    if not args.skip_code_search:
        for q in CODE_QUERIES:
            full = q + (f' "{args.target}"' if args.target else "")
            gh.log(f"code search: {full}")
            res = gh.get("/search/code", {"q": full, "per_page": args.per_query})
            for it in (res or {}).get("items", []):
                add(it["repository"]["full_name"], f"code: {q}")
            time.sleep(6)  # code search allows ~10 req/min

    if not args.skip_commit_search:
        for q in COMMIT_QUERIES:
            full = q + (f' "{args.target}"' if args.target else "")
            gh.log(f"commit search: {full}")
            res = gh.get("/search/commits", {"q": full, "sort": "committer-date", "order": "desc", "per_page": args.per_query})
            for it in (res or {}).get("items", []):
                add(it["repository"]["full_name"], f"commit: {q}")

    for name in args.repo or []:
        add(name, "given on command line")
    return found


# ---------------------------------------------------------------- analysis

def parse_ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) if s else None


def tree_paths(gh, full_name, branch):
    t = gh.get(f"/repos/{full_name}/git/trees/{urllib.parse.quote(branch, safe='')}", {"recursive": "1"})
    if not t:
        return [], False
    return [x["path"] for x in t.get("tree", [])], bool(t.get("truncated"))


def analyze(gh, full_name, found_by, original=None):
    meta = gh.get(f"/repos/{full_name}")
    if not meta:
        return None
    r = {
        "repo": full_name,
        "url": meta["html_url"],
        "description": meta.get("description") or "",
        "stars": meta.get("stargazers_count", 0),
        "language": meta.get("language") or "",
        "license": (meta.get("license") or {}).get("spdx_id") or "",
        "created": meta.get("created_at", "")[:10],
        "pushed": meta.get("pushed_at", "")[:10],
        "size_kb": meta.get("size", 0),
        "fork": meta.get("fork", False),
        "found_by": sorted(found_by),
        "ai_signals": [],
        "reimpl_signals": [],
        "orig_signals": [],
    }
    ai, re_score = 0, 0

    # Agent config files
    paths, truncated = tree_paths(gh, full_name, meta.get("default_branch", "main"))
    hits, pts = [], 0
    for rx, label, p in AGENT_FILES:
        if any(rx.search(x) for x in paths):
            hits.append(label)
            pts += p
    if hits:
        pts = min(pts, AGENT_FILES_CAP)
        ai += pts
        r["ai_signals"].append({"label": "agent files: " + ", ".join(hits), "points": pts})
    r["file_count"] = len(paths)

    # Commits: AI trailers + burst/big-bang shape
    commits = gh.get(f"/repos/{full_name}/commits", {"per_page": 100}) or []
    msgs = [c["commit"]["message"] for c in commits]
    dates = sorted(d for d in (parse_ts(c["commit"]["committer"]["date"]) for c in commits) if d)
    r["commits_sampled"] = len(commits)
    trailer_hits = sum(1 for m in msgs if AI_TRAILERS.search(m))
    if trailer_hits:
        frac = trailer_hits / len(msgs)
        pts = min(35, round(15 + 20 * frac))
        ai += pts
        r["ai_signals"].append({"label": f"AI trailers in {trailer_hits}/{len(msgs)} recent commits", "points": pts})
    if len(dates) >= 2:
        span_days = max((dates[-1] - dates[0]).total_seconds() / 86400, 0.01)
        if len(commits) < 100 and len(commits) >= 15 and span_days <= 7:
            ai += 10
            r["ai_signals"].append({"label": f"entire history ({len(commits)} commits) within {span_days:.1f} days", "points": 10})
        elif len(commits) == 100 and span_days <= 3:
            ai += 10
            r["ai_signals"].append({"label": f"100 commits within {span_days:.1f} days", "points": 10})
    if 0 < len(commits) <= 5 and len(paths) >= 80:
        ai += 10
        r["ai_signals"].append({"label": f"big-bang: {len(paths)} files in {len(commits)} commit(s)", "points": 10})
    # Plan / task files agents tend to leave behind
    plan_files = [p for p in paths if re.search(r"(^|/)(PLAN|TODO|TASKS|PROGRESS|IMPLEMENTATION_PLAN|SPEC)\.md$", p, re.I)]
    if plan_files and hits:
        ai += 5
        r["ai_signals"].append({"label": "agent plan files: " + ", ".join(plan_files[:3]), "points": 5})

    # README: claims + style
    readme = gh.get(f"/repos/{full_name}/readme", accept="application/vnd.github.raw+json", raw=True) or ""
    text = r["description"] + "\n" + readme
    claims = [label for rx, label in CLAIMS if rx.search(text)]
    if claims:
        pts = min(100, CLAIM_POINTS * len(claims) + 10)
        re_score += pts
        r["reimpl_signals"].append({"label": "claims: " + ", ".join(claims), "points": pts})
    if re.search(r"\b(benchmark|vs\.?|compared to)\b", readme, re.I) and claims:
        re_score += 10
        r["reimpl_signals"].append({"label": "benchmarks against another project", "points": 10})
    if re.search(r"compatib(le|ility)\s*(table|matrix)|\|\s*(supported|status)\s*\|", readme, re.I):
        re_score += 10
        r["reimpl_signals"].append({"label": "compatibility/feature-status table", "points": 10})
    vibe = VIBE_WORDS.search(text)
    if vibe:
        ai += 25
        r["ai_signals"].append({"label": f'README says "{vibe.group(0)}"', "points": 25})
    checks = len(re.findall(r"✅|☑️|✔️", readme))
    emoji_heads = len(re.findall(r"^#{1,4}\s*[\U0001F300-\U0001FAFF☀-➿]", readme, re.M))
    if checks >= 8:
        ai += 5
        r["ai_signals"].append({"label": f"{checks} ✅ checkmarks in README", "points": 5})
    if emoji_heads >= 4:
        ai += 5
        r["ai_signals"].append({"label": f"{emoji_heads} emoji headings in README", "points": 5})

    # Comparison with the original
    if original:
        if original["license"] and r["license"] and original["license"] != r["license"]:
            r["orig_signals"].append({"label": f"license changed {original['license']} → {r['license']}", "points": 0})
        if original["paths"] and paths:
            a = {os.path.basename(p) for p in paths if "." in os.path.basename(p)}
            b = original["basenames"]
            if a and b:
                j = len(a & b) / len(a | b)
                r["path_overlap"] = round(j, 3)
                if j >= 0.25:
                    r["orig_signals"].append({"label": f"file-name overlap with original {j:.0%} — check for copied code", "points": 0})
        mentions = len(re.findall(re.escape(original["name"]), readme, re.I))
        if mentions:
            r["orig_signals"].append({"label": f"README mentions '{original['name']}' {mentions}×", "points": 0})

    r["ai_score"] = min(ai, 100)
    r["reimpl_score"] = min(re_score, 100)
    r["combined"] = round((r["ai_score"] * r["reimpl_score"]) ** 0.5)  # geometric mean: needs both
    r["truncated_tree"] = truncated
    return r


def load_original(gh, full_name):
    meta = gh.get(f"/repos/{full_name}")
    if not meta:
        sys.exit(f"original repo {full_name} not found")
    paths, _ = tree_paths(gh, full_name, meta.get("default_branch", "main"))
    return {
        "repo": full_name,
        "name": full_name.split("/")[1],
        "license": (meta.get("license") or {}).get("spdx_id") or "",
        "paths": paths,
        "basenames": {os.path.basename(p) for p in paths if "." in os.path.basename(p)},
        "url": meta["html_url"],
    }


# ---------------------------------------------------------------- HTML

def render_html(results, info):
    data = json.dumps(results, ensure_ascii=False).replace("</", "<\\/")
    info_json = json.dumps(info, ensure_ascii=False).replace("</", "<\\/")
    return HTML_TEMPLATE.replace("__DATA__", data).replace("__INFO__", info_json).replace(
        "__TITLE__", html.escape(info.get("title", "Flattery report")))


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root{
  --bg:#f7f7f5;--surface:#ffffff;--text:#1d1d1b;--muted:#6b6b66;--border:#e3e2dd;
  --accent:#3b5bdb;--ai:#c2410c;--ai-bg:#fff1e6;--re:#0f766e;--re-bg:#e6f6f4;--orig:#7c3aed;--orig-bg:#f3ecff;
  --hi:#b91c1c;--mid:#b45309;--lo:#6b6b66;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#141413;--surface:#1e1e1c;--text:#ecebe6;--muted:#9b9a94;--border:#33332f;
  --accent:#8ea2ff;--ai:#fb923c;--ai-bg:#3a2214;--re:#2dd4bf;--re-bg:#10302c;--orig:#c4a5ff;--orig-bg:#2a1f40;
  --hi:#f87171;--mid:#fbbf24;--lo:#9b9a94;
}}
:root[data-theme="dark"]{
  --bg:#141413;--surface:#1e1e1c;--text:#ecebe6;--muted:#9b9a94;--border:#33332f;
  --accent:#8ea2ff;--ai:#fb923c;--ai-bg:#3a2214;--re:#2dd4bf;--re-bg:#10302c;--orig:#c4a5ff;--orig-bg:#2a1f40;
  --hi:#f87171;--mid:#fbbf24;--lo:#9b9a94;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:24px;margin:0 0 8px}
blockquote{margin:0 0 12px;padding:4px 0 4px 16px;border-left:3px solid var(--accent);font:italic 17px/1.45 Georgia,serif}
blockquote cite{display:block;font:normal 13px system-ui,sans-serif;color:var(--muted);margin-top:4px}
.sub{color:var(--muted);margin:0 0 20px}
.banner{background:var(--orig-bg);color:var(--orig);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:22px}
.stat span{color:var(--muted);font-size:13px}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.controls input[type=search]{flex:1 1 240px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}
.controls label{color:var(--muted);font-size:13px;display:flex;gap:6px;align-items:center}
select{padding:7px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;display:grid;grid-template-columns:72px 1fr;gap:14px}
.score{text-align:center}
.score .big{font-size:26px;font-weight:700;line-height:1}
.score .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.hi{color:var(--hi)}.mid{color:var(--mid)}.lo{color:var(--lo)}
.name{font-weight:600;font-size:16px;color:var(--accent);text-decoration:none;word-break:break-word}
.desc{color:var(--muted);margin:2px 0 8px;overflow-wrap:anywhere}
.meta{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px;margin-bottom:8px}
.bars{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;font-size:12.5px}
.bar{display:flex;align-items:center;gap:6px}
.bar i{display:inline-block;width:90px;height:6px;border-radius:3px;background:var(--border);position:relative;overflow:hidden}
.bar i em{position:absolute;inset:0 auto 0 0;border-radius:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12.5px;border-radius:999px;padding:2px 10px;overflow-wrap:anywhere}
.chip.ai{background:var(--ai-bg);color:var(--ai)}
.chip.re{background:var(--re-bg);color:var(--re)}
.chip.orig{background:var(--orig-bg);color:var(--orig)}
details{margin-top:6px;font-size:12.5px;color:var(--muted)}
.note{margin-top:28px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:14px}
.empty{color:var(--muted);text-align:center;padding:40px}
@media (max-width:560px){.card{grid-template-columns:1fr}.score{display:flex;gap:10px;align-items:baseline;text-align:left}}
</style>
</head>
<body>
<div class="wrap">
  <h1>__TITLE__</h1>
  <blockquote>“Imitation is the sincerest form of flattery that mediocrity can pay to greatness.”<cite>— Oscar Wilde</cite></blockquote>
  <p class="sub" id="sub"></p>
  <div id="banner"></div>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by name, description, signal…">
    <label>Sort <select id="sort">
      <option value="combined">Combined score</option>
      <option value="ai_score">AI-built score</option>
      <option value="reimpl_score">Reimplementation score</option>
      <option value="stars">Stars</option>
      <option value="created">Newest</option>
    </select></label>
    <label>Min combined <select id="min">
      <option value="0">any</option><option value="20">20+</option><option value="40" selected>40+</option><option value="60">60+</option>
    </select></label>
  </div>
  <div id="list"></div>
  <div class="note">
    <b>How to read this.</b> <span style="color:var(--ai)">AI-built</span> counts agent config files (CLAUDE.md, AGENTS.md, .cursorrules…),
    AI co-author trailers in recent commits, burst/big-bang commit history and typical README style.
    <span style="color:var(--re)">Reimplementation</span> counts claims like “drop-in replacement”, “clean-room”, “rewrite of”, “compatible with”.
    Combined is the geometric mean, so both have to be present. <span style="color:var(--orig)">Original</span> chips appear when run with
    <code>--original</code>. A changed license or high file-name overlap is a reason to check provenance by hand, not proof of copying.
    Scores are heuristics: absence of signals does not mean human-written, and presence does not mean a legal problem.
  </div>
</div>
<script>
const DATA = __DATA__;
const INFO = __INFO__;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cls = v => v >= 60 ? "hi" : v >= 35 ? "mid" : "lo";

$("#sub").textContent = `Generated ${INFO.generated} · ${DATA.length} repositories analysed` +
  (INFO.target ? ` · target: “${INFO.target}”` : "") + (INFO.original ? ` · original: ${INFO.original}` : "");
if (INFO.demo) $("#banner").innerHTML = '<div class="banner">Demo data. These repositories are invented to preview the report layout.</div>';

function stats(){
  const n = k => DATA.filter(r => r[k] >= 60).length;
  const items = [
    [DATA.length, "repos analysed"],
    [n("combined"), "likely AI-built reimplementations (60+)"],
    [n("ai_score"), "strong AI-built signals"],
    [n("reimpl_score"), "strong reimplementation claims"],
  ];
  if (INFO.original) items.push([DATA.filter(r => r.orig_signals.length).length, "flagged vs original"]);
  $("#stats").innerHTML = items.map(([b, s]) => `<div class="stat"><b>${b}</b><span>${esc(s)}</span></div>`).join("");
}

function bar(label, v, color){
  return `<span class="bar">${label}<i><em style="width:${v}%;background:${color}"></em></i><b>${v}</b></span>`;
}

function render(){
  const q = $("#q").value.trim().toLowerCase();
  const key = $("#sort").value, min = +$("#min").value;
  let rows = DATA.filter(r => r.combined >= min);
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  rows.sort((a, b) => key === "created" ? b.created.localeCompare(a.created) : b[key] - a[key]);
  if (!rows.length){ $("#list").innerHTML = '<div class="empty">No repositories match. Try lowering the minimum score.</div>'; return; }
  $("#list").innerHTML = rows.map(r => `
    <div class="card">
      <div class="score"><div class="big ${cls(r.combined)}">${r.combined}</div><div class="lbl">combined</div></div>
      <div>
        <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a>
        <div class="desc">${esc(r.description) || "<i>no description</i>"}</div>
        <div class="meta">
          <span>★ ${r.stars.toLocaleString()}</span>${r.language ? `<span>${esc(r.language)}</span>` : ""}
          <span>license ${esc(r.license || "none")}</span><span>created ${esc(r.created)}</span>
          <span>${r.commits_sampled}${r.commits_sampled === 100 ? "+" : ""} commits</span><span>${r.file_count} files</span>
          ${r.path_overlap != null ? `<span>overlap ${(r.path_overlap*100).toFixed(0)}%</span>` : ""}
        </div>
        <div class="bars">${bar("AI-built", r.ai_score, "var(--ai)")}${bar("Reimpl.", r.reimpl_score, "var(--re)")}</div>
        <div class="chips">
          ${r.ai_signals.map(s => `<span class="chip ai">${esc(s.label)} +${s.points}</span>`).join("")}
          ${r.reimpl_signals.map(s => `<span class="chip re">${esc(s.label)} +${s.points}</span>`).join("")}
          ${r.orig_signals.map(s => `<span class="chip orig">${esc(s.label)}</span>`).join("")}
        </div>
        <details><summary>found by</summary>${r.found_by.map(esc).join("<br>")}</details>
      </div>
    </div>`).join("");
}
stats();
["#q", "#sort", "#min"].forEach(s => $(s).addEventListener("input", render));
render();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- demo

def demo_results():
    def mk(repo, desc, stars, lang, lic, created, commits, files, ai, re_, orig=(), overlap=None):
        r = {"repo": repo, "url": "https://github.com/" + repo, "description": desc, "stars": stars,
             "language": lang, "license": lic, "created": created, "pushed": created, "size_kb": 0, "fork": False,
             "found_by": ["demo"], "ai_signals": [{"label": l, "points": p} for l, p in ai],
             "reimpl_signals": [{"label": l, "points": p} for l, p in re_],
             "orig_signals": [{"label": l, "points": 0} for l in orig],
             "commits_sampled": commits, "file_count": files, "truncated_tree": False}
        if overlap is not None:
            r["path_overlap"] = overlap
        r["ai_score"] = min(100, sum(p for _, p in ai))
        r["reimpl_score"] = min(100, sum(p for _, p in re_))
        r["combined"] = round((r["ai_score"] * r["reimpl_score"]) ** 0.5)
        return r
    return [
        mk("example-org/kvstore-rs", "Drop-in replacement for a popular in-memory store, written in Rust", 2140, "Rust", "MIT", "2026-03-02", 100, 412,
           [("agent files: CLAUDE.md, .claude/", 35), ("AI trailers in 88/100 recent commits", 33), ("100 commits within 2.4 days", 10), ("14 ✅ checkmarks in README", 5)],
           [("claims: drop-in replacement, rewrite/reimplementation, compatible with", 64), ("benchmarks against another project", 10), ("compatibility/feature-status table", 10)],
           ["license changed BSD-3-Clause → MIT", "README mentions 'redis' 23×"], 0.08),
        mk("sample-user/chardetect-ng", "Clean-room character encoding detector, API compatible with the original", 530, "Python", "MIT", "2026-02-11", 37, 96,
           [("agent files: AGENTS.md", 20), ("AI trailers in 30/37 recent commits", 31), ("entire history (37 commits) within 4.2 days", 10)],
           [("claims: clean-room, compatible with", 46), ("compatibility/feature-status table", 10)],
           ["license changed LGPL-2.1 → MIT", "file-name overlap with original 41% — check for copied code"], 0.41),
        mk("demo-labs/tinyvideo", "A small video toolkit — vibe coded in a weekend", 88, "TypeScript", "Apache-2.0", "2026-07-19", 4, 140,
           [("README says \"vibe coded\"", 25), ("big-bang: 140 files in 4 commit(s)", 10), ("agent files: .cursorrules", 20)],
           [("claims: alternative to", 28)]),
        mk("placeholder/jsonfast", "Port of a C JSON parser to Go", 1210, "Go", "MIT", "2024-08-30", 100, 58,
           [], [("claims: port of", 28), ("benchmarks against another project", 10)]),
        mk("example-org/agent-notes", "Personal dotfiles and agent prompts", 12, "Shell", "", "2025-11-03", 61, 30,
           [("agent files: CLAUDE.md, AGENTS.md", 35)], []),
    ]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", help='product/project name to look for reimplementations of, e.g. "redis"')
    ap.add_argument("--original", help="owner/repo of the original project, enables license + file overlap comparison")
    ap.add_argument("--since", help="only repos created on/after this date (YYYY-MM-DD)")
    ap.add_argument("--language", help="restrict repo search to a language")
    ap.add_argument("--min-stars", type=int, default=0)
    ap.add_argument("--query", action="append", help="extra GitHub repo-search query (repeatable)")
    ap.add_argument("--repo", action="append", help="always analyse this owner/repo (repeatable)")
    ap.add_argument("--per-query", type=int, default=20, help="results per search query (max 100)")
    ap.add_argument("--max-repos", type=int, default=80, help="cap on repos analysed (each costs ~4 API calls)")
    ap.add_argument("--skip-code-search", action="store_true")
    ap.add_argument("--skip-commit-search", action="store_true")
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
    ap.add_argument("--json", help="also write raw results as JSON to this path")
    ap.add_argument("-o", "--output", default="flattery_report.html")
    ap.add_argument("--demo", action="store_true", help="write a report from built-in sample data, no network")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    info = {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "target": args.target or "",
            "original": args.original or "", "title": "Flattery report"}

    if args.demo:
        results = demo_results()
        info["demo"] = True
    else:
        if not args.token:
            sys.exit("Set GITHUB_TOKEN (a classic or fine-grained token with public read access) or pass --token.")
        gh = GitHub(args.token, verbose=not args.quiet)
        original = load_original(gh, args.original) if args.original else None
        if original and not args.target:
            args.target = original["name"]
            info["target"] = args.target
        found = discover(gh, args)
        if original:
            found.pop(original["repo"], None)
        names = sorted(found, key=lambda n: -len(found[n]["found_by"]))[: args.max_repos]
        gh.log(f"\n{len(found)} candidates, analysing {len(names)}")
        results = []
        for i, name in enumerate(names, 1):
            gh.log(f"[{i}/{len(names)}] {name}")
            r = analyze(gh, name, found[name]["found_by"], original)
            if r and not r["fork"]:
                results.append(r)
        gh.log(f"done, {gh.calls} API calls")

    results.sort(key=lambda r: (-r["combined"], -r["ai_score"]))
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(render_html(results, info))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"wrote {args.output} ({len(results)} repos)")


if __name__ == "__main__":
    main()

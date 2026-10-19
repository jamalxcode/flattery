// Flattery scanner: finds likely AI-built reimplementations on GitHub and scores them.
// Runs in the browser against api.github.com, with the viewer's token if they give one.
// Without a token GitHub allows 60 core requests an hour and no code search, so each repo
// is kept to ~2 API calls: metadata comes from search results, READMEs from raw.githubusercontent.com.
// Each repo gets two 0-100 scores; `combined` is their geometric mean, so both must be present.

const API = "https://api.github.com";

// [regex over repo paths, label, points]
const AGENT_FILES = [
  [/(^|\/)CLAUDE\.md$/i, "CLAUDE.md", 25],
  [/(^|\/)\.claude\//, ".claude/", 20],
  [/(^|\/)AGENTS\.md$/i, "AGENTS.md", 20],
  [/(^|\/)\.cursorrules$/, ".cursorrules", 20],
  [/(^|\/)\.cursor\//, ".cursor/", 20],
  [/(^|\/)\.windsurfrules$/, ".windsurfrules", 20],
  [/(^|\/)\.aider[^/]*$/, ".aider*", 20],
  [/(^|\/)\.github\/copilot-instructions\.md$/, "copilot-instructions.md", 15],
  [/(^|\/)GEMINI\.md$/i, "GEMINI.md", 20],
  [/(^|\/)\.clinerules/, ".clinerules", 20],
  [/(^|\/)\.kiro\//, ".kiro/", 20],
];
const AGENT_FILES_CAP = 35;

const AI_TRAILERS = /co-authored-by:\s*(claude|copilot|cursor|devin|codex|gemini|aider|openhands|sweep|jules)|generated with \[?claude code|🤖 generated with|^aider:|\(aider\)|codex-cli|cursor agent/im;

const CLAIMS = [
  [/drop[- ]in replacement/i, "drop-in replacement"],
  [/clean[- ]room/i, "clean-room"],
  [/\b(re-?write|re-?implementation|reimplement(ed|s)?)\b/i, "rewrite/reimplementation"],
  [/\b(api[- ])?compatible with\b/i, "compatible with"],
  [/\bwritten from scratch\b|\bfrom the ground up\b/i, "from scratch"],
  [/\b(open[- ]source )?alternative to\b/i, "alternative to"],
  [/\bport of\b|\bported from\b/i, "port of"],
  [/\bfrom (the )?spec(ification)?\b/i, "from spec"],
];
const CLAIM_POINTS = 18;

const VIBE_WORDS = /\b(vibe[- ]?coded|built with (claude|cursor|copilot|ai)|ai[- ]generated|written by (claude|ai|an llm))\b/i;
const PLAN_FILES = /(^|\/)(PLAN|TODO|TASKS|PROGRESS|IMPLEMENTATION_PLAN|SPEC)\.md$/i;

const REPO_QUERIES_BROAD = [
  '"drop-in replacement" in:description',
  '"clean-room" in:readme',
  '"clean room implementation" in:readme',
  '"rewrite of" in:description',
  '"reimplementation of" in:description',
  '"written from scratch" "compatible" in:readme',
  '"vibe coded" in:readme,description',
];
const REPO_QUERIES_TARGET = [
  '"{t}" "drop-in replacement" in:description,readme',
  '"{t}" "compatible" in:description',
  '"{t}" rewrite in:description',
  '"{t}" "clean-room" in:readme',
  '"{t}" alternative in:description',
  '"{t}" reimplementation in:description,readme',
];
const CODE_QUERIES = ["path:CLAUDE.md", "path:AGENTS.md", "path:.cursorrules", "path:.github/copilot-instructions.md"];
const COMMIT_QUERIES = ['"Co-Authored-By: Claude"', '"Generated with Claude Code"'];

export class RateLimitError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const basename = p => p.slice(p.lastIndexOf("/") + 1);

export class GitHub {
  constructor(token, log, signal) {
    this.token = token;
    this.log = log;
    this.signal = signal;
    this.calls = 0;
  }

  async get(path, params, { accept = "application/vnd.github+json", raw = false } = {}) {
    let url = path.startsWith("http") ? path : API + path;
    if (params) url += "?" + new URLSearchParams(params);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.signal?.aborted) throw new DOMException("Stopped", "AbortError");
      let res;
      try {
        this.calls++;
        res = await fetch(url, {
          headers: { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", ...(this.token && { Authorization: `Bearer ${this.token}` }) },
          signal: this.signal,
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (res.ok) return raw ? res.text() : res.json();
      if (res.status === 401) throw new Error("GitHub rejected the token (401). Check it and try again.");
      if (res.status === 403 || res.status === 429) {
        const wait = await this.rateLimitWait(res);
        if (wait != null && wait > 120 && !this.token)
          throw new RateLimitError(`hit GitHub's limit of 60 requests an hour without a token (resets in ${Math.ceil(wait / 60)} min)`);
        if (wait != null) {
          this.log(`rate limited, waiting ${wait}s…`, "warn");
          await sleep(wait * 1000);
          continue;
        }
      }
      if ([404, 409, 422, 451].includes(res.status)) return null;
      if (res.status >= 500 && attempt < 4) { await sleep(2 ** attempt * 1000); continue; }
      this.log(`HTTP ${res.status} on ${url.replace(API, "")}`, "warn");
      return null;
    }
    return null;
  }

  async rateLimitWait(res) {
    const h = res.headers;
    let wait;
    if (h.get("retry-after")) wait = +h.get("retry-after") + 1;
    else if (h.get("x-ratelimit-remaining") === "0" && h.get("x-ratelimit-reset"))
      wait = Math.max(1, +h.get("x-ratelimit-reset") - Math.floor(Date.now() / 1000) + 1);
    else if (/rate limit/i.test(await res.text())) wait = 30;
    else return null;
    return this.token ? Math.min(wait, 300) : wait;
  }
}

export async function discover(gh, opts) {
  const found = new Map();
  const add = (name, why, meta) => {
    if (!found.has(name)) found.set(name, { why: new Set(), meta: null });
    found.get(name).why.add(why);
    if (meta) found.get(name).meta = meta;
  };
  const filters = (opts.since ? ` created:>=${opts.since}` : "") +
    (opts.language ? ` language:${opts.language}` : "") +
    (opts.minStars ? ` stars:>=${opts.minStars}` : "") + " fork:false";
  const t = opts.target;
  const repoQueries = (t ? REPO_QUERIES_TARGET.map(q => q.replaceAll("{t}", t)) : REPO_QUERIES_BROAD).concat(opts.queries || []);

  for (const q of repoQueries) {
    gh.log(`repo search: ${q}`);
    const res = await gh.get("/search/repositories", { q: q + filters, sort: "stars", order: "desc", per_page: opts.perQuery });
    for (const it of res?.items || []) add(it.full_name, `repo: ${q}`, "default_branch" in it && "stargazers_count" in it ? it : null);
  }
  if (opts.codeSearch) {
    for (const q of CODE_QUERIES) {
      const full = q + (t ? ` "${t}"` : "");
      gh.log(`code search: ${full}`);
      const res = await gh.get("/search/code", { q: full, per_page: opts.perQuery });
      for (const it of res?.items || []) add(it.repository.full_name, `code: ${q}`);
      await sleep(6000); // code search allows ~10 requests/minute
    }
  }
  if (opts.commitSearch) {
    for (const q of COMMIT_QUERIES) {
      const full = q + (t ? ` "${t}"` : "");
      gh.log(`commit search: ${full}`);
      const res = await gh.get("/search/commits", { q: full, sort: "committer-date", order: "desc", per_page: opts.perQuery });
      for (const it of res?.items || []) add(it.repository.full_name, `commit: ${q}`);
    }
  }
  for (const r of opts.repos || []) add(r, "added by hand");
  return found;
}

// raw.githubusercontent.com isn't API rate limited, so try it before the API.
async function fetchReadme(gh, fullName, branch, paths) {
  const file = paths.find(p => /^readme(\.\w+)?$/i.test(p));
  if (!file) return "";
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(branch)}/${encodeURI(file)}`, { signal: gh.signal });
    if (res.ok) return res.text();
  } catch (e) {
    if (e.name === "AbortError") throw e;
  }
  return (await gh.get(`/repos/${fullName}/readme`, null, { accept: "application/vnd.github.raw+json", raw: true })) || "";
}

async function treePaths(gh, fullName, branch) {
  const t = await gh.get(`/repos/${fullName}/git/trees/${encodeURIComponent(branch)}`, { recursive: "1" });
  return t ? { paths: t.tree.map(x => x.path), truncated: !!t.truncated } : { paths: [], truncated: false };
}

export async function loadOriginal(gh, fullName) {
  const meta = await gh.get(`/repos/${fullName}`);
  if (!meta) throw new Error(`Original repo ${fullName} not found.`);
  const { paths } = await treePaths(gh, fullName, meta.default_branch || "main");
  return {
    repo: meta.full_name,
    name: meta.name,
    license: meta.license?.spdx_id || "",
    basenames: new Set(paths.map(basename).filter(b => b.includes("."))),
  };
}

// Repo search results carry the full repo object; others need one extra call.
export async function analyze(gh, fullName, foundBy, original, knownMeta) {
  const meta = knownMeta || await gh.get(`/repos/${fullName}`);
  if (!meta || meta.fork) return null;
  const r = {
    repo: meta.full_name,
    url: meta.html_url,
    description: meta.description || "",
    stars: meta.stargazers_count || 0,
    language: meta.language || "",
    license: meta.license?.spdx_id || "",
    created: (meta.created_at || "").slice(0, 10),
    found_by: [...foundBy].sort(),
    ai_signals: [],
    reimpl_signals: [],
    orig_signals: [],
  };
  let ai = 0, re = 0;
  const sig = (list, label, points) => list.push({ label, points });

  // Agent config files
  const { paths, truncated } = await treePaths(gh, fullName, meta.default_branch || "main");
  const hits = [];
  let pts = 0;
  for (const [rx, label, p] of AGENT_FILES) if (paths.some(x => rx.test(x))) { hits.push(label); pts += p; }
  if (hits.length) {
    pts = Math.min(pts, AGENT_FILES_CAP);
    ai += pts;
    sig(r.ai_signals, "agent files: " + hits.join(", "), pts);
  }
  r.file_count = paths.length;
  r.truncated_tree = truncated;

  // Commits: AI trailers and burst / big-bang history
  const commits = (await gh.get(`/repos/${fullName}/commits`, { per_page: 100 })) || [];
  r.commits_sampled = commits.length;
  const trailerHits = commits.filter(c => AI_TRAILERS.test(c.commit.message)).length;
  if (trailerHits) {
    pts = Math.min(35, Math.round(15 + 20 * trailerHits / commits.length));
    ai += pts;
    sig(r.ai_signals, `AI trailers in ${trailerHits}/${commits.length} recent commits`, pts);
  }
  const dates = commits.map(c => Date.parse(c.commit.committer?.date)).filter(Number.isFinite).sort((a, b) => a - b);
  if (dates.length >= 2) {
    const span = Math.max((dates.at(-1) - dates[0]) / 864e5, 0.01);
    if (commits.length >= 15 && commits.length < 100 && span <= 7) {
      ai += 10;
      sig(r.ai_signals, `entire history (${commits.length} commits) within ${span.toFixed(1)} days`, 10);
    } else if (commits.length === 100 && span <= 3) {
      ai += 10;
      sig(r.ai_signals, `100 commits within ${span.toFixed(1)} days`, 10);
    }
  }
  if (commits.length > 0 && commits.length <= 5 && paths.length >= 80) {
    ai += 10;
    sig(r.ai_signals, `big-bang: ${paths.length} files in ${commits.length} commit(s)`, 10);
  }
  const plans = paths.filter(p => PLAN_FILES.test(p));
  if (plans.length && hits.length) {
    ai += 5;
    sig(r.ai_signals, "agent plan files: " + plans.slice(0, 3).join(", "), 5);
  }

  // README: reimplementation claims and style
  const readme = await fetchReadme(gh, meta.full_name, meta.default_branch || "main", paths);
  const text = r.description + "\n" + readme;
  const claims = CLAIMS.filter(([rx]) => rx.test(text)).map(([, l]) => l);
  if (claims.length) {
    pts = Math.min(100, CLAIM_POINTS * claims.length + 10);
    re += pts;
    sig(r.reimpl_signals, "claims: " + claims.join(", "), pts);
    if (/\b(benchmark|vs\.?|compared to)\b/i.test(readme)) {
      re += 10;
      sig(r.reimpl_signals, "benchmarks against another project", 10);
    }
  }
  if (/compatib(le|ility)\s*(table|matrix)|\|\s*(supported|status)\s*\|/i.test(readme)) {
    re += 10;
    sig(r.reimpl_signals, "compatibility/feature-status table", 10);
  }
  const vibe = text.match(VIBE_WORDS);
  if (vibe) {
    ai += 25;
    sig(r.ai_signals, `README says "${vibe[0]}"`, 25);
  }
  const checks = (readme.match(/✅|☑️|✔️/g) || []).length;
  const emojiHeads = (readme.match(/^#{1,4}\s*\p{Extended_Pictographic}/gmu) || []).length;
  if (checks >= 8) { ai += 5; sig(r.ai_signals, `${checks} ✅ checkmarks in README`, 5); }
  if (emojiHeads >= 4) { ai += 5; sig(r.ai_signals, `${emojiHeads} emoji headings in README`, 5); }

  // Comparison with the original project
  if (original) {
    if (original.license && r.license && original.license !== r.license && r.license !== "NOASSERTION")
      sig(r.orig_signals, `license changed ${original.license} → ${r.license}`, 0);
    const mine = new Set(paths.map(basename).filter(b => b.includes(".")));
    if (mine.size && original.basenames.size) {
      let inter = 0;
      for (const b of mine) if (original.basenames.has(b)) inter++;
      const j = inter / (mine.size + original.basenames.size - inter);
      r.path_overlap = Math.round(j * 1000) / 1000;
      if (j >= 0.25) sig(r.orig_signals, `file-name overlap with original ${Math.round(j * 100)}% — check for copied code`, 0);
    }
    const esc = original.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentions = (readme.match(new RegExp(esc, "gi")) || []).length;
    if (mentions) sig(r.orig_signals, `README mentions '${original.name}' ${mentions}×`, 0);
  }

  r.ai_score = Math.min(ai, 100);
  r.reimpl_score = Math.min(re, 100);
  r.combined = Math.round(Math.sqrt(r.ai_score * r.reimpl_score));
  return r;
}

// Discover candidates, then analyse them with a small worker pool.
export async function scan(opts, { log, onResult, signal }) {
  const gh = new GitHub(opts.token, log, signal);
  if (opts.token) {
    const me = await gh.get("/user");
    if (!me) throw new Error("Could not read your GitHub user. Check the token.");
    log(`signed in as ${me.login}`);
  } else {
    opts.codeSearch = false;
    const rl = await gh.get("/rate_limit"); // free: doesn't count against the limit
    const left = rl?.resources?.core?.remaining ?? 60;
    opts.maxRepos = Math.min(opts.maxRepos, Math.max(1, Math.floor((left - (opts.original ? 2 : 0)) / 2)));
    log(`no token: code search off, ${left} requests left this hour, analysing up to ${opts.maxRepos} repos`, "warn");
    if (left < 3) throw new RateLimitError("no requests left this hour without a token. Add a token or try again later.");
  }

  let original = null;
  if (opts.original) {
    original = await loadOriginal(gh, opts.original);
    if (!opts.target) opts.target = original.name;
    log(`original: ${original.repo} (${original.license || "no license"}, ${original.basenames.size} file names)`);
  }
  const found = await discover(gh, opts);
  if (original) found.delete(original.repo);
  const names = [...found.keys()].sort((a, b) => found.get(b).why.size - found.get(a).why.size).slice(0, opts.maxRepos);
  log(`${found.size} candidates, analysing ${names.length}`);

  let next = 0, done = 0, limitHit = null;
  const worker = async () => {
    while (next < names.length && !limitHit) {
      const name = names[next++];
      let r;
      try {
        r = await analyze(gh, name, found.get(name).why, original, found.get(name).meta);
      } catch (e) {
        if (!(e instanceof RateLimitError)) throw e;
        limitHit = limitHit || e;
        return;
      }
      done++;
      log(`[${done}/${names.length}] ${name}${r ? ` → ${r.combined}` : " (skipped)"}`);
      if (r) onResult(r);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (limitHit) log(`stopped early: ${limitHit.message}. Add a token to scan more.`, "warn");
  log(`done, ${gh.calls} API calls`, "ok");
  return { target: opts.target, original: original?.repo || "" };
}

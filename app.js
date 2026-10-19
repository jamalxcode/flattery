import { scan } from "./scanner.js";
import { reportHtml } from "./report.js";

const $ = id => document.getElementById(id);
const report = $("report");
let results = [], info = {}, controller = null;

const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) {
    try {
      sessionStorage.setItem(k, v);
      persist ? localStorage.setItem(k, v) : localStorage.removeItem(k);
    } catch {}
  },
};

const saved = store.get("flattery.token");
if (saved) $("token").value = saved;
try { $("remember").checked = !!localStorage.getItem("flattery.token"); } catch {}

function log(msg, kind = "") {
  const el = $("log");
  el.hidden = false;
  const line = document.createElement("div");
  line.className = kind;
  line.textContent = msg;
  el.append(line);
  el.scrollTop = el.scrollHeight;
}

let pending = false;
function show() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (!results.length && !controller && !info.demo) return;
    renderReport(report, results, info);
  });
}

function setRunning(on) {
  $("run").disabled = on;
  $("demo").disabled = on;
  $("stop").disabled = !on;
  $("dlHtml").disabled = $("dlJson").disabled = on || !results.length;
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const token = $("token").value.trim();
  if (token) store.set("flattery.token", token, $("remember").checked);
  const opts = {
    token,
    target: $("target").value.trim(),
    original: $("original").value.trim(),
    since: $("since").value,
    language: $("language").value.trim(),
    minStars: +$("minStars").value || 0,
    perQuery: Math.min(100, Math.max(5, +$("perQuery").value || 20)),
    maxRepos: Math.max(1, +$("maxRepos").value || 60),
    repos: $("repos").value.split(/\s+/).filter(s => /^[\w.-]+\/[\w.-]+$/.test(s)),
    codeSearch: $("codeSearch").checked,
    commitSearch: $("commitSearch").checked,
  };
  results = [];
  info = { generated: new Date().toISOString().slice(0, 16).replace("T", " "), target: opts.target, original: opts.original };
  $("log").replaceChildren();
  controller = new AbortController();
  setRunning(true);
  show();
  try {
    const meta = await scan(opts, { log, onResult: r => { results.push(r); show(); }, signal: controller.signal });
    Object.assign(info, meta);
  } catch (err) {
    log(err.name === "AbortError" ? "stopped" : err.message, err.name === "AbortError" ? "warn" : "err");
  }
  setRunning(false);
  show();
});

$("stop").addEventListener("click", () => controller?.abort());

$("demo").addEventListener("click", () => {
  results = demoResults();
  info = { demo: true };
  selectTab(true);
  setRunning(false);
  show();
});

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = () => "flattery-" + (info.target || "scan").replace(/[^\w-]+/g, "-").toLowerCase() + "-" + new Date().toISOString().slice(0, 10);

$("dlJson").addEventListener("click", () => download(slug() + ".json", JSON.stringify({ info, results }, null, 2), "application/json"));

// A standalone report: the same stylesheet and renderer inlined, with the data embedded.
$("dlHtml").addEventListener("click", async () => {
  const [css, renderJs] = await Promise.all(["style.css", "render.js"].map(f => fetch(f).then(r => r.text())));
  const html = reportHtml({ css, renderJs, noteHtml: document.querySelector(".note").innerHTML, results, info });
  download(slug() + ".html", html, "text/html");
});

function demoResults() {
  const mk = (repo, description, stars, language, license, created, commits, files, ai, re, orig = [], overlap) => {
    const r = {
      repo, url: "https://github.com/" + repo, description, stars, language, license, created,
      commits_sampled: commits, file_count: files, found_by: ["demo"],
      ai_signals: ai.map(([label, points]) => ({ label, points })),
      reimpl_signals: re.map(([label, points]) => ({ label, points })),
      orig_signals: orig.map(label => ({ label, points: 0 })),
    };
    if (overlap != null) r.path_overlap = overlap;
    r.ai_score = Math.min(100, ai.reduce((s, [, p]) => s + p, 0));
    r.reimpl_score = Math.min(100, re.reduce((s, [, p]) => s + p, 0));
    r.combined = Math.round(Math.sqrt(r.ai_score * r.reimpl_score));
    return r;
  };
  return [
    mk("example-org/kvstore-rs", "Drop-in replacement for a popular in-memory store, written in Rust", 2140, "Rust", "MIT", "2026-03-02", 100, 412,
      [["agent files: CLAUDE.md, .claude/", 35], ["AI trailers in 88/100 recent commits", 33], ["100 commits within 2.4 days", 10], ["14 ✅ checkmarks in README", 5]],
      [["claims: drop-in replacement, rewrite/reimplementation, compatible with", 64], ["benchmarks against another project", 10], ["compatibility/feature-status table", 10]],
      ["license changed BSD-3-Clause → MIT", "README mentions 'kvstore' 23×"], 0.08),
    mk("sample-user/chardetect-ng", "Clean-room character encoding detector, API compatible with the original", 530, "Python", "MIT", "2026-02-11", 37, 96,
      [["agent files: AGENTS.md", 20], ["AI trailers in 30/37 recent commits", 31], ["entire history (37 commits) within 4.2 days", 10]],
      [["claims: clean-room, compatible with", 46], ["compatibility/feature-status table", 10]],
      ["license changed LGPL-2.1 → MIT", "file-name overlap with original 41% — check for copied code"], 0.41),
    mk("demo-labs/tinyvideo", "A small video toolkit — vibe coded in a weekend", 88, "TypeScript", "Apache-2.0", "2026-07-19", 4, 140,
      [['README says "vibe coded"', 25], ["big-bang: 140 files in 4 commit(s)", 10], ["agent files: .cursorrules", 20]],
      [["claims: alternative to", 28]]),
    mk("placeholder/jsonfast", "Port of a C JSON parser to Go", 1210, "Go", "MIT", "2024-08-30", 100, 58,
      [], [["claims: port of", 28], ["benchmarks against another project", 10]]),
    mk("example-org/agent-notes", "Personal dotfiles and agent prompts", 12, "Shell", "", "2025-11-03", 61, 30,
      [["agent files: CLAUDE.md, AGENTS.md", 35]], []),
  ];
}

show();

// Tabs
function selectTab(own) {
  $("tabLive").setAttribute("aria-selected", !own);
  $("tabOwn").setAttribute("aria-selected", own);
  $("livePane").hidden = own;
  $("ownPane").hidden = !own;
}
$("tabLive").addEventListener("click", () => selectTab(false));
$("tabOwn").addEventListener("click", () => selectTab(true));

// Latest scan, published by the scheduled workflow every 10 minutes. The page keeps
// showing the last scan and swaps in a newer one when it appears.
const INTERVAL_MIN = 10;
let live = null;

function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : m < 120 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
}

function liveStatus() {
  if (!live) return;
  const at = Date.parse(live.info.generated_iso);
  const next = at + INTERVAL_MIN * 60000 - Date.now();
  const when = next > 60000 ? `next in about ${Math.ceil(next / 60000)} min` : "next one due now";
  $("liveStatus").innerHTML = `Automatic scan, updated <b>${ago(Date.now() - at)}</b> · ${when} · ` +
    `<a href="data/latest.html" target="_blank" rel="noopener">standalone report</a> · <a href="data/latest.json" target="_blank" rel="noopener">JSON</a>`;
}

async function loadLive() {
  try {
    const res = await fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!live || data.info.generated_iso !== live.info.generated_iso) {
      live = data;
      renderReport($("live"), live.results, live.info);
    }
    liveStatus();
  } catch {
    if (!live) $("liveStatus").textContent = "No automatic scan has been published yet. Run your own scan in the meantime.";
  }
}

loadLive();
setInterval(loadLive, 2 * 60000);
setInterval(liveStatus, 30000);

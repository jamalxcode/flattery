// Runs a Flattery scan outside the browser, with the same scanner the page uses, and
// writes <out>/latest.json and <out>/latest.html. The scheduled workflow runs this every
// 10 minutes; it also works locally:
//
//   GITHUB_TOKEN=github_pat_... node tools/scan.mjs --target redis --original redis/redis
//
// With --cache (an earlier latest.json) every run builds on what was found before:
//   1. link check: all known repos in a few GraphQL requests; deleted ones are kept and
//      marked gone, renamed or transferred ones move to their new name
//   2. discovery: new candidates are analysed; known ones are reused unless stale
//      (analysed more than --cache-hours ago, or pushed to since)
//   3. refresh: what's left of --max-fresh re-analyses the stalest known repos
// Nothing found earlier is dropped. --budget-sec stops new work in time to write the files.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { GitHub, scan, analyze, checkLinks } from "../scanner.js";
import { reportHtml } from "../report.js";

const root = new URL("../", import.meta.url);
const { values: a } = parseArgs({
  options: {
    target: { type: "string", default: "" },
    original: { type: "string", default: "" },
    since: { type: "string", default: "" },
    language: { type: "string", default: "" },
    "min-stars": { type: "string", default: "0" },
    "per-query": { type: "string", default: "20" },
    "max-repos": { type: "string", default: "60" },
    "max-fresh": { type: "string", default: "0" },
    cache: { type: "string" },
    "cache-hours": { type: "string", default: "6" },
    "budget-sec": { type: "string", default: "0" },
    "max-wait": { type: "string", default: "300" },
    rotate: { type: "boolean", default: false },
    out: { type: "string", default: "data" },
    "no-code-search": { type: "boolean", default: false },
  },
});

const t0 = Date.now();
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const today = nowIso().slice(0, 10);
const log = (msg, kind) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${kind ? kind + ": " : ""}${msg}`);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const gh = new GitHub(token, log, null, { maxWait: +a["max-wait"] });
const deadline = +a["budget-sec"] ? t0 + +a["budget-sec"] * 1000 : 0;
const maxFresh = +a["max-fresh"];
const staleMs = +a["cache-hours"] * 3600e3;

// Everything found so far, keyed by repo. A cache from a scan against a different
// original isn't comparable, so it starts over.
const known = new Map();
if (a.cache) {
  try {
    const prev = JSON.parse(await readFile(a.cache, "utf8"));
    if ((prev.info?.original || "") === a.original)
      for (const r of prev.results || []) known.set(r.repo, { first_seen: (r.analysed_at || nowIso()).slice(0, 10), ...r });
  } catch {}
  log(`known: ${known.size} repos from the previous scan`);
}

// 1. Link check
const counts = { gone: 0, renamed: 0, archived: 0, returned: 0 };
if (known.size && token) {
  const links = await checkLinks(gh, [...known.keys()]);
  for (const [name, l] of links) {
    let r = known.get(name);
    r.link_checked = nowIso();
    if (l.status === "gone") {
      if (r.link !== "gone") counts.gone++;
      r.link = "gone";
      r.link_reason = l.reason;
      r.gone_since ||= today;
      continue;
    }
    if (r.link === "gone") counts.returned++;
    if (l.archived && r.link !== "archived") counts.archived++;
    delete r.gone_since;
    delete r.link_reason;
    r.link = l.archived ? "archived" : "ok";
    r.pushed_at = l.pushed_at;
    if (l.status === "renamed") {
      counts.renamed++;
      known.delete(name);
      const other = known.get(l.name);
      r = { ...r, repo: l.name, url: l.url, previously: [...new Set([...(r.previously || []), name])] };
      // already known under the new name too: keep the newer analysis
      if (!other || (r.analysed_at || "") > (other.analysed_at || "")) known.set(l.name, r);
    }
  }
  log(`links: ${links.size} checked, ${counts.gone} newly gone, ${counts.renamed} renamed, ${counts.archived} newly archived, ${counts.returned} back`);
}

// Analyses from before product detection (no `product` field) count as stale.
const isFresh = r => r.link === "gone" || (r.product !== undefined &&
  Date.parse(r.analysed_at) > Date.now() - staleMs && !(r.pushed_at && r.pushed_at > r.analysed_at));
const keepFields = r => {
  const k = {};
  for (const f of ["first_seen", "link", "previously", "gone_since", "link_reason", "link_checked", "pushed_at"]) if (r?.[f] != null) k[f] = r[f];
  return k;
};
let newCount = 0;
const seenNow = new Set();
const merge = r => {
  const prev = known.get(r.repo);
  if (!prev) newCount++;
  seenNow.add(r.repo);
  known.set(r.repo, { ...r, ...keepFields(prev), first_seen: prev?.first_seen || today, last_seen: today,
    found_by: [...new Set([...(prev?.found_by || []), ...r.found_by])].sort(),
    ...(r.link == null && !prev?.link && { link: "ok" }) });
};

// 2. Discovery
const rotate = a.rotate ? Math.floor(Date.now() / 600e3) : null;
const meta = await scan({
  gh, token, rotate, deadline, maxFresh,
  target: a.target, original: a.original, since: a.since, language: a.language,
  minStars: +a["min-stars"], perQuery: +a["per-query"], maxRepos: +a["max-repos"],
  codeSearch: !a["no-code-search"], commitSearch: true,
  cache: new Map([...known].filter(([, r]) => isFresh(r))),
}, { log, onResult: merge });

// 3. Refresh the stalest known repos with what's left of the budget
let refreshed = 0;
const stale = [...known.values()].filter(r => !isFresh(r) && !seenNow.has(r.repo))
  .sort((x, y) => (x.analysed_at || "").localeCompare(y.analysed_at || ""));
for (const old of stale) {
  if ((maxFresh && meta.fresh + refreshed >= maxFresh) || (deadline && Date.now() > deadline)) break;
  const r = await analyze(gh, old.repo, new Set(old.found_by), meta.originalData, null);
  refreshed++;
  if (r) {
    const moved = r.repo !== old.repo; // renamed since the link check: GitHub redirected
    if (moved) known.delete(old.repo);
    known.set(r.repo, { ...r, ...keepFields(old), last_seen: old.last_seen, analysed_at: nowIso(),
      ...(moved && { previously: [...new Set([...(old.previously || []), old.repo])] }) });
    log(`refreshed ${old.repo} → ${r.combined}`);
  }
}
if (stale.length) log(`refreshed ${refreshed} of ${stale.length} stale repos`);

// Write
const results = [...known.values()].sort((x, y) => y.combined - x.combined || y.ai_score - x.ai_score);
const now = new Date();
const info = {
  generated: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  generated_iso: now.toISOString().replace(/\.\d+Z$/, "Z"),
  target: meta.target || "",
  original: meta.original || "",
  run: { new: newCount, refreshed, ...counts, api_calls: gh.calls, seconds: Math.round((Date.now() - t0) / 1000) },
};
await mkdir(a.out, { recursive: true });
await writeFile(`${a.out}/latest.json`, JSON.stringify({ info, results }));
const [css, renderJs, index] = await Promise.all(["style.css", "render.js", "index.html"].map(f => readFile(new URL(f, root), "utf8")));
const noteHtml = index.match(/<div class="note">([\s\S]*?)<\/div>/)?.[1] || "";
await writeFile(`${a.out}/latest.html`, reportHtml({ css, renderJs, noteHtml, results, info }));

log(`wrote ${a.out}/latest.json and latest.html: ${results.length} repos (${newCount} new, ${refreshed} refreshed, ` +
  `${results.filter(r => r.link === "gone").length} gone), ${gh.calls} API calls. Top 10:`);
for (const r of results.filter(r => r.link !== "gone").slice(0, 10))
  console.log(`  ${String(r.combined).padStart(3)}  ${r.repo}  [AI ${r.ai_score} / reimpl ${r.reimpl_score}]`);

// Runs a Flattery scan outside the browser, with the same scanner the page uses, and
// writes <out>/latest.json and <out>/latest.html. The scheduled workflow runs this every
// 10 minutes; it also works locally:
//
//   GITHUB_TOKEN=github_pat_... node tools/scan.mjs --target redis --original redis/redis
//
// --cache points at an earlier latest.json: repos analysed there within --cache-hours
// are reused, and at most --max-fresh repos are fetched again per run.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { scan } from "../scanner.js";
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
    out: { type: "string", default: "data" },
    "no-code-search": { type: "boolean", default: false },
  },
});

async function loadCache(path, original, hours) {
  if (!path) return null;
  let data;
  try { data = JSON.parse(await readFile(path, "utf8")); } catch { return new Map(); }
  if ((data.info?.original || "") !== original) return new Map();
  const cutoff = Date.now() - hours * 3600e3;
  return new Map((data.results || []).filter(r => Date.parse(r.analysed_at) > cutoff).map(r => [r.repo, r]));
}

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`;
const opts = {
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  target: a.target,
  original: a.original,
  since: a.since,
  language: a.language,
  minStars: +a["min-stars"],
  perQuery: +a["per-query"],
  maxRepos: +a["max-repos"],
  maxFresh: +a["max-fresh"],
  codeSearch: !a["no-code-search"],
  commitSearch: true,
  cache: await loadCache(a.cache, a.original, +a["cache-hours"]),
};
if (opts.cache) console.log(`${stamp()} cache: ${opts.cache.size} recent analyses`);

const results = [];
const meta = await scan(opts, {
  log: (msg, kind) => console.log(`${stamp()} ${kind ? kind + ": " : ""}${msg}`),
  onResult: r => results.push(r),
});
results.sort((x, y) => y.combined - x.combined || y.ai_score - x.ai_score);

const now = new Date();
const info = {
  generated: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  generated_iso: now.toISOString().replace(/\.\d+Z$/, "Z"),
  target: meta.target || "",
  original: meta.original || "",
};
await mkdir(a.out, { recursive: true });
await writeFile(`${a.out}/latest.json`, JSON.stringify({ info, results }));

const [css, renderJs, index] = await Promise.all(["style.css", "render.js", "index.html"].map(f => readFile(new URL(f, root), "utf8")));
const noteHtml = index.match(/<div class="note">([\s\S]*?)<\/div>/)?.[1] || "";
await writeFile(`${a.out}/latest.html`, reportHtml({ css, renderJs, noteHtml, results, info }));

console.log(`\n${stamp()} wrote ${a.out}/latest.json and latest.html (${results.length} repos). Top 10:`);
for (const r of results.slice(0, 10)) console.log(`  ${String(r.combined).padStart(3)}  ${r.repo}  [AI ${r.ai_score} / reimpl ${r.reimpl_score}]`);

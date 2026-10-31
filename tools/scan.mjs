// Runs a Flattery scan of X and writes <out>/latest.json and <out>/latest.html.
// The scheduled workflow runs this every 2 hours; it also works locally:
//
//   X_BEARER_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... node tools/scan.mjs --cache prev.json
//
// --cache is the previously published latest.json; each run builds on it (see pipeline.js).
// --max-reads caps the X posts read per run, which is what X bills for.
// --backfill-days N also searches the full archive for the last N days (popular posts
// only), for catching up; it needs full-archive search on the X plan.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { X } from "../x.js";
import { Haiku } from "../haiku.js";
import { repoStats } from "../github.js";
import { run } from "../pipeline.js";
import { reportHtml } from "../report.js";

const root = new URL("../", import.meta.url);
const { values: a } = parseArgs({
  options: {
    cache: { type: "string" },
    out: { type: "string", default: "data" },
    "max-reads": { type: "string", default: "600" },
    "per-query": { type: "string", default: "50" },
    "products-per-run": { type: "string", default: "6" },
    "max-reactions": { type: "string", default: "10" },
    "budget-sec": { type: "string", default: "0" },
    "max-wait": { type: "string", default: "60" },
    rotate: { type: "boolean", default: false },
    "backfill-days": { type: "string", default: "0" },
    "backfill-per-query": { type: "string", default: "200" },
  },
});

const t0 = Date.now();
const log = (msg, kind) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${kind ? kind + ": " : ""}${msg}`);
const need = name => process.env[name] || (console.error(`${name} is not set`), process.exit(1));
const xToken = need("X_BEARER_TOKEN");
need("ANTHROPIC_API_KEY");
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

let prev = null;
if (a.cache) {
  try { prev = JSON.parse(await readFile(a.cache, "utf8")); } catch {}
  log(prev?.info?.source === "x" ? `known: ${prev.results.length} posts from the previous scan` : "no previous X scan, starting fresh");
}

const x = new X(xToken, log, { maxReads: +a["max-reads"], maxWait: +a["max-wait"] });
const haiku = new Haiku(log);
const { results, info: runInfo } = await run(prev, {
  rotate: a.rotate ? Math.floor(Date.now() / 7200e3) : 0,
  deadline: +a["budget-sec"] ? t0 + +a["budget-sec"] * 1000 : 0,
  perQuery: +a["per-query"],
  productsPerRun: +a["products-per-run"],
  maxReactions: +a["max-reactions"],
  backfillDays: +a["backfill-days"],
  backfillPerQuery: +a["backfill-per-query"],
}, {
  x, haiku, log,
  githubStats: names => ghToken ? repoStats(ghToken, names, log) : (log("no GITHUB_TOKEN, skipping GitHub checks", "warn"), new Map()),
});

// Nothing found is ever dropped, so a smaller catalog means something went wrong
if (prev?.info?.source === "x" && results.length < prev.results.length) {
  console.error(`catalog shrank from ${prev.results.length} to ${results.length} posts; not writing it`);
  process.exit(1);
}

const now = new Date();
const info = {
  ...runInfo,
  generated: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  generated_iso: now.toISOString().replace(/\.\d+Z$/, "Z"),
  run: { ...runInfo.counts, x_reads: x.reads, x_calls: x.calls, haiku_calls: haiku.calls, haiku_tokens: haiku.tokens, seconds: Math.round((Date.now() - t0) / 1000) },
};
delete info.counts;
await mkdir(a.out, { recursive: true });
await writeFile(`${a.out}/latest.json`, JSON.stringify({ info, results }));
const [css, renderJs, index] = await Promise.all(["style.css", "render.js", "index.html"].map(f => readFile(new URL(f, root), "utf8")));
const noteHtml = index.match(/<section class="about">([\s\S]*?)<\/section>/)?.[1] || "";
await writeFile(`${a.out}/latest.html`, reportHtml({ css, renderJs, noteHtml, results, info }));

const by = v => results.filter(e => e.reception.verdict === v).length;
log(`wrote ${a.out}/latest.json and latest.html: ${results.length} posts (${by("well-received")} well received, ` +
  `${by("unconfirmed")} unconfirmed, ${by("mixed")} mixed, ${by("stay-away")} stay away, ${by("too-early")} too early), ` +
  `${x.reads} X reads, ${haiku.calls} Haiku calls. Top 10:`);
for (const e of results.filter(e => e.status === "ok").slice(0, 10))
  console.log(`  ${String(e.reception.score).padStart(3)}  ${e.reception.verdict.padEnd(13)} @${e.author.username}  ${e.project || e.repo || e.id}${e.original ? " ≈ " + e.original : ""}`);

// Runs a Flattery scan of X and writes <out>/latest.json and <out>/latest.html.
// The scheduled workflow runs this every 8 hours; it also works locally:
//
//   X_BEARER_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... node tools/scan.mjs --cache prev.json
//
// --cache is the previously published latest.json; each run builds on it (see pipeline.js).
// --max-reads caps the X posts read per run, which is what X bills for.
// --backfill-days N also searches the full archive for the last N days (popular posts
// only), for catching up; it needs full-archive search on the X plan.
// --search "ArtCraft, Other" also looks for posts about those names (last --search-days days).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { X } from "../x.js";
import { Haiku } from "../haiku.js";
import { repoStats, readmeImage } from "../github.js";
import { run } from "../pipeline.js";
import { reportHtml } from "../report.js";

const root = new URL("../", import.meta.url);
const { values: a } = parseArgs({
  options: {
    cache: { type: "string" },
    out: { type: "string", default: "data" },
    "max-reads": { type: "string", default: "600" },
    "per-query": { type: "string", default: "50" },
    "products-per-run": { type: "string", default: "27" },
    "max-reactions": { type: "string", default: "20" },
    "budget-sec": { type: "string", default: "0" },
    "max-wait": { type: "string", default: "60" },
    rotate: { type: "boolean", default: false },
    "backfill-days": { type: "string", default: "0" },
    "backfill-per-query": { type: "string", default: "200" },
    search: { type: "string", default: "" },
    "search-days": { type: "string", default: "21" },
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

let overrides = {};
try { overrides = JSON.parse(await readFile(new URL("overrides.json", root), "utf8")); } catch {}

const x = new X(xToken, log, { maxReads: +a["max-reads"], maxWait: +a["max-wait"] });
const haiku = new Haiku(log);
const { results, groups, info: runInfo } = await run(prev, {
  rotate: a.rotate ? Math.floor(Date.now() / 288e5) : 0,
  deadline: +a["budget-sec"] ? t0 + +a["budget-sec"] * 1000 : 0,
  perQuery: +a["per-query"],
  productsPerRun: +a["products-per-run"],
  maxReactions: +a["max-reactions"],
  backfillDays: +a["backfill-days"],
  backfillPerQuery: +a["backfill-per-query"],
  search: a.search.split(",").map(s => s.trim()).filter(Boolean),
  searchDays: +a["search-days"],
  overrides,
}, {
  x, haiku, log,
  githubImage: readmeImage,
  githubStats: names => ghToken ? repoStats(ghToken, names, log) : (log("no GITHUB_TOKEN, skipping GitHub checks", "warn"), new Map()),
});

// Nothing found is ever dropped, so a smaller catalog means something went wrong
if (prev?.info?.source === "x" && results.length < prev.results.length) {
  console.error(`catalog shrank from ${prev.results.length} to ${results.length} posts; not writing it`);
  process.exit(1);
}

// Thumbnails: README screenshots copied into <out>/thumbs, so the page doesn't load images
// from other people's servers (they break, change or track visitors). Kept on the data
// branch between runs; up to 40 new ones a run.
const thumbDir = `${a.out}/thumbs`;
await mkdir(thumbDir, { recursive: true });
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
let newThumbs = 0;
const wantThumbs = groups.filter(g => g.github?.image && g.github.status !== "gone");
for (let i = 0; i < wantThumbs.length; i += 6) {
  await Promise.all(wantThumbs.slice(i, i + 6).map(async g => {
    const base = createHash("sha1").update(g.github.image).digest("hex").slice(0, 16);
    const have = Object.values(EXT).map(x => `${base}.${x}`).find(f => existsSync(`${thumbDir}/${f}`));
    if (have) return void (g.thumb = `thumbs/${have}`);
    if (newThumbs >= 40) return;
    newThumbs++;
    try {
      const res = await fetch(g.github.image, { signal: AbortSignal.timeout(15000) });
      const ext = EXT[(res.headers.get("content-type") || "").split(";")[0].trim()];
      if (!res.ok || !ext) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2.5e6) return; // too big for a card picture
      await writeFile(`${thumbDir}/${base}.${ext}`, buf);
      g.thumb = `thumbs/${base}.${ext}`;
    } catch {}
  }));
}
log(`thumbnails: ${groups.filter(g => g.thumb).length} stored, ${newThumbs} fetched this run`);

const now = new Date();
const costPerRead = +(process.env.X_COST_PER_READ || 0);
const info = {
  ...runInfo,
  generated: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  generated_iso: now.toISOString().replace(/\.\d+Z$/, "Z"),
  run: { ...runInfo.counts, x_reads: x.reads, ...(costPerRead && { x_cost_usd: Math.round(x.reads * costPerRead * 100) / 100 }), x_calls: x.calls, haiku_calls: haiku.calls, haiku_tokens: haiku.tokens, seconds: Math.round((Date.now() - t0) / 1000) },
};
delete info.counts;
await mkdir(a.out, { recursive: true });
await writeFile(`${a.out}/latest.json`, JSON.stringify({ info, results, groups }));
const [css, renderJs, index] = await Promise.all(["style.css", "render.js", "index.html"].map(f => readFile(new URL(f, root), "utf8")));
const noteHtml = index.match(/<section class="about">([\s\S]*?)<\/section>/)?.[1] || "";
await writeFile(`${a.out}/latest.html`, reportHtml({ css, renderJs, noteHtml, results: groups, info }));

// RSS: newly rated and newly promoted projects of the last two weeks
const site = (process.env.SITE_URL || "https://jamalxcode.github.io/flattery/").replace(/\/?$/, "/");
const xml = s => String(s ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const LABEL = { "well-received": "❤️ Loved", unconfirmed: "🔥 Hyped, unproven", mixed: "😐 Mixed", "stay-away": "☠️ Don't touch", "too-early": "🆕 New & untested" };
const fresh = groups.filter(g => g.status === "ok" && g.reception.verdict !== "too-early" && g.history?.length &&
  Date.now() - Date.parse(g.history.at(-1).at) < 14 * 864e5).sort((p, q) => q.history.at(-1).at.localeCompare(p.history.at(-1).at)).slice(0, 40);
await writeFile(`${a.out}/feed.xml`, `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Flattery: software clones, rated by the crowd</title><link>${site}</link>
<description>Newly rated and promoted clones, reverse-engineered and reimagined software found on X.</description>
${fresh.map(g => {
  const name = g.project || g.repo || "Untitled";
  const prevV = g.history.length > 1 ? g.history.at(-2).verdict : null;
  const link = `${site}#p=${encodeURIComponent(g.id)}`;
  return `<item><title>${xml(`${LABEL[g.reception.verdict]}: ${name}${g.original ? ` (≈ ${g.original})` : ""}`)}</title><link>${xml(link)}</link><guid isPermaLink="false">${xml(g.id + ":" + g.history.at(-1).at + ":" + g.reception.verdict)}</guid>
<pubDate>${new Date(g.history.at(-1).at + "T12:00:00Z").toUTCString()}</pubDate><description>${xml(`${prevV ? `${LABEL[prevV]} → ${LABEL[g.reception.verdict]}. ` : ""}${g.summary || ""} Score ${g.reception.score}.`)}</description></item>`;
}).join("\n")}
</channel></rss>
`);

const by = v => groups.filter(e => e.reception.verdict === v).length;
log(`wrote ${a.out}/latest.json and latest.html: ${results.length} posts, ${groups.length} projects (${by("well-received")} well received, ` +
  `${by("unconfirmed")} unconfirmed, ${by("mixed")} mixed, ${by("stay-away")} stay away, ${by("too-early")} too early), ` +
  `${x.reads} X reads, ${haiku.calls} Haiku calls. Top 10:`);
for (const e of groups.filter(e => e.status === "ok").slice(0, 10))
  console.log(`  ${String(e.reception.score).padStart(3)}  ${e.reception.verdict.padEnd(13)} @${e.author.username}  ${e.project || e.repo || e.id}${e.original ? " ≈ " + e.original : ""}`);

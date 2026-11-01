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
import { repoStats, readmeImage, readmeText } from "../github.js";
import { run } from "../pipeline.js";
import { makeSources } from "../sources.js";
import { reportHtml } from "../report.js";
import { makePoster, postsToMake } from "../xpost.js";

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
    repos: { type: "string", default: "" },
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

// Monthly X budget: once a month's reads pass X_MONTHLY_READS (default 60,000), runs read
// nothing more from X until the month turns; GitHub checks and scoring carry on
const month = new Date().toISOString().slice(0, 7);
const monthCap = +(process.env.X_MONTHLY_READS || 60000);
const usedThisMonth = prev?.info?.month?.key === month ? prev.info.month.reads : 0;
const maxReads = Math.max(0, Math.min(+a["max-reads"], monthCap - usedThisMonth));
if (maxReads < +a["max-reads"]) log(`monthly X budget: ${usedThisMonth} of ${monthCap} reads used, ${maxReads} left for this run`, "warn");

const repoTerms = a.repos.split(/[\s,]+/).map(s => s.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$|\/+$/g, ""))
  .map(s => s.split("/").slice(0, 2).join("/")).filter(s => /^[\w.-]+\/[\w.-]+$/.test(s)).map(r => `url:"github.com/${r}"`);
if (repoTerms.length) log(`adding repos: ${repoTerms.join(", ")}`);
const x = new X(xToken, log, { maxReads, maxWait: +a["max-wait"] });
const haiku = new Haiku(log);
const { results, groups, info: runInfo } = await run(prev, {
  rotate: a.rotate ? Math.floor(Date.now() / 288e5) : 0,
  deadline: +a["budget-sec"] ? t0 + +a["budget-sec"] * 1000 : 0,
  perQuery: +a["per-query"],
  productsPerRun: +a["products-per-run"],
  maxReactions: +a["max-reactions"],
  backfillDays: +a["backfill-days"],
  backfillPerQuery: +a["backfill-per-query"],
  // --repos: GitHub repos to add (links or owner/repo). Flattery lists what X talks about, so each
  // becomes a search for X posts linking it over the last 6 months; triage still decides.
  search: [...a.search.split(",").map(s => s.trim()).filter(Boolean), ...repoTerms],
  searchDays: repoTerms.length ? Math.max(+a["search-days"], 180) : +a["search-days"],
  overrides,
}, {
  x, haiku, log,
  sources: makeSources(log),
  githubImage: readmeImage,
  githubReadme: readmeText,
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
// Copies an image into thumbs/ once (named by its URL's hash): returns its path, or null
const store = async (url, maxBytes) => {
  const base = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const have = Object.values(EXT).map(x => `${base}.${x}`).find(f => existsSync(`${thumbDir}/${f}`));
  if (have) return `thumbs/${have}`;
  if (newThumbs >= 80) return null;
  newThumbs++;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    // No SVG: an SVG served from the site's own domain could run scripts when opened directly
    const ext = EXT[(res.headers.get("content-type") || "").split(";")[0].trim()];
    if (!res.ok || !ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    await writeFile(`${thumbDir}/${base}.${ext}`, buf);
    return `thumbs/${base}.${ext}`;
  } catch { return null; }
};
const wantThumbs = groups.filter(g => g.github && g.github.status !== "gone" && (g.github.image || g.github.logo || g.github.org_avatar));
// Projects without a repo logo: the maker's X picture, when the poster built it (never a
// reposter's face on someone else's project)
for (const g of groups) if (!wantThumbs.includes(g) && g.author_built_it && g.author?.avatar && g.status === "ok") wantThumbs.push({ ...g, github: {}, _avatarOnly: g });
for (let i = 0; i < wantThumbs.length; i += 6) {
  await Promise.all(wantThumbs.slice(i, i + 6).map(async g => {
    if (g._avatarOnly) { const t = await store(g.author.avatar, 3e5); if (t) g._avatarOnly.icon = t; return; }
    if (g.github.image) { const t = await store(g.github.image, 2.5e6); if (t) g.thumb = t; }
    // The row's icon: the README's logo, else the organisation's avatar
    for (const src of [g.github.logo, g.github.org_avatar].filter(Boolean)) {
      const t = await store(src, 6e5);
      if (t) { g.icon = t; break; }
    }
  }));
}
log(`thumbnails: ${groups.filter(g => g.thumb).length} pictures and ${groups.filter(g => g.icon).length} icons stored, ${newThumbs} fetched this run`);

const now = new Date();
const costPerRead = +(process.env.X_COST_PER_READ || 0);
const info = {
  ...runInfo,
  generated: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  generated_iso: now.toISOString().replace(/\.\d+Z$/, "Z"),
  run: { ...runInfo.counts, x_reads: x.reads, ...(costPerRead && { x_cost_usd: Math.round(x.reads * costPerRead * 100) / 100 }), x_calls: x.calls, haiku_calls: haiku.calls, haiku_tokens: haiku.tokens, seconds: Math.round((Date.now() - t0) / 1000) },
};
delete info.counts;
// Posts on X as the Flattery account (only with posting keys): the newsletter and newly loved
// projects, each once, each linking to the site
info.posted = { ...(prev?.info?.source === "x" ? prev.info.posted : {}) };
const poster = makePoster(process.env, log);
if (poster) {
  for (const p of postsToMake(groups, info, info.posted, { today: info.generated_iso.slice(0, 10) })) {
    const id = await poster.post(p.text);
    if (id) { info.posted[p.key] = info.generated_iso.slice(0, 10); log(`posted on X: ${p.key}`); }
  }
}
// Keep the record small: the last 300 posts
info.posted = Object.fromEntries(Object.entries(info.posted).slice(-300));
info.month = { key: month, reads: usedThisMonth + x.reads, cap: monthCap };
// Status for the page: the last 60 runs
info.status = [...(prev?.info?.source === "x" ? prev.info.status || [] : []),
  { at: info.generated_iso, reads: x.reads, added: info.run.added || 0, changed: info.run.changed || 0, seconds: info.run.seconds }].slice(-60);
await mkdir(a.out, { recursive: true });
await writeFile(`${a.out}/latest.json`, JSON.stringify({ info, results, groups }));
const [css, renderJs, index] = await Promise.all(["style.css", "render.js", "index.html"].map(f => readFile(new URL(f, root), "utf8")));
const noteHtml = (index.match(/<dialog class="drawer about"[^>]*>([\s\S]*?)<\/dialog>/)?.[1] || "").replace(/<button[^>]*class="close"[^>]*>.*?<\/button>/, "");
await writeFile(`${a.out}/latest.html`, reportHtml({ css, renderJs, noteHtml, results: groups, info }));

// RSS: newly rated and newly promoted projects of the last two weeks
const site = "https://flattery.sala.company/";
const xml = s => String(s ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const LABEL = { faded: "🌫️ Didn't catch on", "well-received": "❤️ Loved", proven: "⭐ Proven on GitHub", unconfirmed: "🔥 Hyped, unproven", mixed: "😐 Mixed", "stay-away": "☠️ Don't touch", "too-early": "🆕 New & untested" };
const fresh = groups.filter(g => g.status === "ok" && !["too-early", "faded"].includes(g.reception.verdict) && g.history?.length &&
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
${(info.newsletter || []).slice(0, 8).map(n => `<item><title>${xml(`This week in clones: ${n.title}`)}</title><link>${xml(`${site}#news=${n.date}`)}</link><guid isPermaLink="false">news:${n.date}</guid>
<pubDate>${new Date(n.date + "T08:00:00Z").toUTCString()}</pubDate><description>${xml(`${n.intro} ${n.items.map(i => `${i.name}: ${i.blurb}`).join(" ")} ${n.outro}`)}</description></item>`).join("\n")}
</channel></rss>
`);

const by = v => groups.filter(e => e.reception.verdict === v).length;
log(`wrote ${a.out}/latest.json and latest.html: ${results.length} posts, ${groups.length} projects (${by("well-received")} well received, ` +
  `${by("unconfirmed")} unconfirmed, ${by("mixed")} mixed, ${by("stay-away")} stay away, ${by("too-early")} too early), ` +
  `${x.reads} X reads, ${haiku.calls} Haiku calls. Top 10:`);
for (const e of groups.filter(e => e.status === "ok").slice(0, 10))
  console.log(`  ${String(e.reception.score).padStart(3)}  ${e.reception.verdict.padEnd(13)} @${e.author.username}  ${e.project || e.repo || e.id}${e.original ? " ≈ " + e.original : ""}`);

// "The clone scene": a stats page at stats/index.html, written from data/latest.json on each
// deploy. Plain HTML and CSS bars (values written on them, hover titles), the site's styles.
//
//   node tools/stats.mjs [--data data/latest.json] [--out .]
import { GOATCOUNTER } from "../analytics.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";

const SITE = "https://flattery.sala.company/";
const { values: a } = parseArgs({ options: { data: { type: "string", default: "data/latest.json" }, out: { type: "string", default: "." } } });
const root = new URL("../", import.meta.url);
const RATINGS = [["well-received", "❤️", "Loved", "loved"], ["proven", "⭐", "Proven on GitHub", "proven"], ["unconfirmed", "🔥", "Hyped, unproven", "hype"],
  ["mixed", "😐", "Mixed", "mixed"], ["stay-away", "☠️", "Don't touch", "danger"], ["too-early", "🆕", "New & untested", "new"], ["faded", "🌫️", "Didn't catch on", "faded"]];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => (v || 0).toLocaleString("en", { notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });
const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
const what = g => g.product ? label(g.product) : (g.original_clean || g.original || "");
const name = g => g.project || g.display_name || g.repo?.split("/")[1] || (what(g) ? `${what(g)} clone` : "Untitled");
// Companies only when they're known: a listed product's vendor, or a well-known vendor name
const VENDORS = /^(Adobe|Microsoft|Autodesk|Apple|Google|OpenAI|Anthropic|Meta|Amazon|Salesforce|Atlassian|Notion|Figma|Canva|Slack|Discord|Spotify|Shopify|Intuit|Oracle|SAP|Dassault|Avid|Corel|Blackmagic|ByteDance|xAI|Zoom|Dropbox|Webflow|Vercel|JetBrains|GitHub)\b/;
const vendor = g => g.product?.vendor || (what(g).match(VENDORS)?.[1] || "");
// Generic descriptions ("websites") aren't apps
const isApp = w => /^[A-Z0-9]/.test(w);
const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const { groups = [], info = {} } = JSON.parse(await readFile(a.data, "utf8"));
const live = groups.filter(g => g.status === "ok");
const now = Date.parse(info.generated_iso || new Date().toISOString());
const own = g => g.github && g.github.status !== "gone" && g.reception.repo_counted ? g.github : null;
const days = iso => (now - Date.parse(iso)) / 864e5;

// Horizontal bars, one series: label, bar, value
const hbars = (rows, unit = "") => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="hbars">${rows.map(([l, v, href]) => `<div class="hbar" title="${esc(l)}: ${num(v)}${unit}">
    <span class="hl">${href ? `<a href="${esc(href)}">${esc(l)}</a>` : esc(l)}</span><span class="track"><i style="width:${(100 * v / max).toFixed(1)}%"></i></span><b>${num(v)}${unit}</b></div>`).join("")}</div>`;
};

// Tiles
const repos = live.map(own).filter(Boolean);
const old = repos.filter(g => days(g.created || info.generated_iso) > 30);
const abandoned = old.filter(g => g.status === "archived" || (g.pushed_at && days(g.pushed_at) > 30));
const rated = live.filter(g => !["too-early", "faded"].includes(g.reception.verdict));
const tiles = [
  [live.length, "clones tracked"],
  [live.filter(g => g.reception.verdict === "well-received").length, "❤️ loved"],
  [num(repos.reduce((s, g) => s + g.stars, 0)), "GitHub stars on their own repos"],
  [old.length ? `${Math.round(100 * abandoned.length / old.length)}%` : "–", "of repos over a month old look abandoned"],
];

// Most cloned companies
const byVendor = new Map();
for (const g of live) { const v = vendor(g); if (v && v !== "?") byVendor.set(v, (byVendor.get(v) || 0) + 1); }
const vendors = [...byVendor].sort((x, y) => y[1] - x[1]).slice(0, 10);

// Most cloned apps
const byApp = new Map();
for (const g of live) { const w = what(g); if (w && isApp(w)) byApp.set(w, (byApp.get(w) || 0) + 1); }
const apps = [...byApp].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([w, n]) => [w, n, `${SITE}alternatives/${slug(w)}/`]);

// Clones per week (when they were posted)
const weekOf = iso => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const weeks = new Map();
for (const g of live) { const w = weekOf(g.created_at); weeks.set(w, (weeks.get(w) || 0) + 1); }
const weekRows = [...weeks].sort((x, y) => x[0].localeCompare(y[0])).slice(-12);
const wmax = Math.max(1, ...weekRows.map(w => w[1]));
const vbars = `<div class="vbars">${weekRows.map(([w, n]) => `<div class="vbar" title="Week of ${w}: ${n} clones"><b>${n}</b><span class="vtrack"><i style="height:${(100 * n / wmax).toFixed(1)}%"></i></span><small>${new Date(w + "T12:00:00Z").toLocaleDateString("en", { day: "numeric", month: "short" })}</small></div>`).join("")}</div>`;

// Ratings by category (stacked), with a legend
const cats = new Map();
for (const g of live) { const c = g.category || "Other"; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(g.reception.verdict); }
const catRows = [...cats].sort((x, y) => y[1].length - x[1].length);
const stacked = `<div class="legend-row">${RATINGS.map(([, e, n, cls]) => `<span class="lg r-${cls}"><i></i>${e} ${n}</span>`).join("")}</div>
<div class="stack">${catRows.map(([c, vs]) => `<div class="srow"><span class="hl">${esc(c)}</span><span class="strack">${RATINGS.map(([v, e, n, cls]) => {
  const k = vs.filter(x => x === v).length;
  return k ? `<i class="r-${cls}" style="flex:${k}" title="${esc(c)}: ${k} ${n}"></i>` : "";
}).join("")}</span><b>${vs.length}</b></div>`).join("")}</div>`;

// Fastest-growing repos: stars per day since the repo was created
const fast = repos.map(g => [g, g.stars / Math.max(1, days(g.created || info.generated_iso))]).sort((x, y) => y[1] - x[1]).slice(0, 10);
const fastRows = fast.map(([g, r]) => [live.find(x => x.github === g) ? name(live.find(x => x.github === g)) : g.repo, Math.round(r), `${SITE}p/${live.find(x => x.github === g)?.code || ""}/`]);

// Builders: whose own repos count, how many projects, stars and hit rate
const builders = new Map();
for (const g of live) {
  const who = g.author?.username; if (!who || !own(g)) continue;
  if (!builders.has(who)) builders.set(who, { projects: 0, stars: 0, hits: 0 });
  const b = builders.get(who); b.projects++; b.stars += own(g).stars;
  if (["well-received", "proven"].includes(g.reception.verdict)) b.hits++;
}
const builderRows = [...builders].sort((x, y) => y[1].stars - x[1].stars).slice(0, 15);

const index = await readFile(new URL("index.html", root), "utf8");
const head = index.slice(0, index.indexOf("<body>"))
  .replace(/<title>[\s\S]*?<\/title>/, "<title>The clone scene: stats | Flattery</title>")
  .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="Which apps get cloned most, how fast clones appear, which ones people love and how many are abandoned. Imitation is the sincerest form of flattery.">`)
  .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${SITE}stats/">`)
  .replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
const html = `${head}<body>
<header class="topbar"><div class="wrap"><a class="brand" href="./"><span class="mark" aria-hidden="true">🪞</span>Flattery</a>
  <a class="bar-btn dark" href="./" style="margin-left:auto">Browse the clones</a></div></header>
<main class="wrap stats-page">
  <p class="issue-date">📊 The clone scene · updated ${esc(info.generated || "")}</p>
  <h1>Who gets cloned, and how it goes.</h1>
  <p class="lede">Every software clone Flattery has found on X, Hacker News and Reddit, counted. Click a bar to see the clones behind it.</p>
  <div class="tiles">${tiles.map(([b, s]) => `<div class="tile-stat"><b>${b}</b><span>${esc(s)}</span></div>`).join("")}</div>
  <div class="charts">
    <section class="chart"><h2>Most cloned companies</h2>${hbars(vendors)}</section>
    <section class="chart"><h2>Most cloned apps</h2>${hbars(apps)}</section>
    <section class="chart wide"><h2>New clones per week</h2><p class="note-small">By the week they were posted.</p>${vbars}</section>
    <section class="chart wide"><h2>How each category is received</h2>${stacked}</section>
    <section class="chart"><h2>Fastest-growing repos</h2><p class="note-small">GitHub stars per day since the repo was created.</p>${hbars(fastRows, "/day")}</section>
    <section class="chart"><h2>Builders</h2><p class="note-small">Accounts with their own repos. Hit rate: share rated ❤️ Loved or ⭐ Proven.</p>
      <table class="btable"><thead><tr><th>Builder</th><th>Projects</th><th>Stars</th><th>Hit rate</th></tr></thead><tbody>
      ${builderRows.map(([who, b]) => `<tr><td><a href="./?q=${encodeURIComponent("@" + who)}">@${esc(who)}</a></td><td>${b.projects}</td><td>${num(b.stars)}</td><td>${Math.round(100 * b.hits / b.projects)}%</td></tr>`).join("")}
      </tbody></table></section>
  </div>
  <p class="note-small">${rated.length} of ${live.length} clones are rated so far; the rest are new or didn't catch on. Crowd opinion, not a legal or technical judgement.</p>
</main>${GOATCOUNTER}</body></html>`;
await mkdir(`${a.out}/stats`, { recursive: true });
await writeFile(`${a.out}/stats/index.html`, html);
console.log(`stats: ${vendors.length} companies, ${apps.length} apps, ${weekRows.length} weeks, ${builderRows.length} builders`);

// Draws the share preview images (1200×630 PNG) with a headless browser: one per project at
// data/og/<code>.png, plus data/og/home.png for the site. Each shows the name, rating, score,
// what it clones, likes and stars, and the README screenshot when there is one. Kept on the
// data branch and redrawn only when what they show changes (data/og/index.json).
//
//   node tools/cards.mjs [--data data/latest.json]      (CHROMIUM=/path to use a local browser)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({ options: { data: { type: "string", default: "data/latest.json" }, max: { type: "string", default: "400" } } });
const dataDir = a.data.replace(/[^/]+$/, "") || "./";
const ogDir = `${dataDir}og`;
// Embedded as data: URLs, since a page set from memory can't load local files
const font = "data:font/woff2;base64," + (await readFile(new URL("../fonts/inter-latin.woff2", import.meta.url))).toString("base64");
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const dataUrl = async file => `data:${MIME[file.split(".").pop().toLowerCase()] || "image/png"};base64,${(await readFile(file)).toString("base64")}`;

const LABEL = {
  "well-received": ["❤️", "Loved", "#e11d48"], proven: ["⭐", "Proven on GitHub", "#b7791f"], unconfirmed: ["🔥", "Hyped, unproven", "#e07a1f"],
  mixed: ["😐", "Mixed", "#6b6a75"], "stay-away": ["☠️", "Don't touch", "#16151a"], "too-early": ["🆕", "New & untested", "#0e8a8c"], faded: ["🌫️", "Didn't catch on", "#6b6a75"],
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
const what = g => g.product ? label(g.product) : (g.original_clean || g.original || "");
const name = g => g.project || g.display_name || g.repo?.split("/")[1] || (what(g) ? `${what(g)} clone` : "Untitled");
const num = v => (v || 0).toLocaleString("en", { notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url("${font}") format("woff2"); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; font-family: Inter, sans-serif; color: #fff; overflow: hidden; }
.bg { position: absolute; inset: 0; }
.shot { position: absolute; right: 0; top: 0; width: 560px; height: 630px; object-fit: cover; object-position: top center; }
.fade { position: absolute; inset: 0; }
.text { position: absolute; left: 64px; top: 56px; bottom: 120px; width: 620px; display: flex; flex-direction: column; gap: 18px; }
.rate { align-self: flex-start; display: flex; align-items: center; gap: 10px; background: #fff; color: var(--rc); font-weight: 800; font-size: 26px; padding: 10px 22px 10px 16px; border-radius: 999px; letter-spacing: .02em; text-transform: uppercase; }
h1 { font-size: 84px; line-height: 1; letter-spacing: -0.04em; font-weight: 800; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
h1.long { font-size: 64px; }
.of { font-size: 30px; font-weight: 600; opacity: .9; }
.stats { margin-top: auto; display: flex; gap: 28px; font-size: 30px; font-weight: 700; }
.stats b { font-size: 44px; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 64px 34px; font-size: 22px; display: flex; justify-content: space-between; gap: 24px;
  background: linear-gradient(transparent, rgba(10,10,20,.55)); text-shadow: 0 1px 6px rgba(0,0,0,.5); }
</style></head><body>${body}</body></html>`;

function card(g, thumb) {
  const [emo, rating, rc] = LABEL[g.reception.verdict] || LABEL.mixed;
  const n = name(g), h = hue(n);
  return page(`
    <div class="bg" style="background: radial-gradient(120% 90% at 0% 0%, hsl(${h} 85% 58%), transparent 60%), linear-gradient(135deg, hsl(${h} 70% 34%), hsl(${h + 50} 65% 18%))"></div>
    ${thumb ? `<img class="shot" src="${thumb}"><div class="fade" style="background: linear-gradient(90deg, hsl(${h} 70% 26%) 46%, transparent 72%)"></div>` : ""}
    <div class="text" style="--rc:${rc}">
      <div class="rate"><span>${emo}</span>${esc(rating)}</div>
      <h1 class="${n.length > 14 ? "long" : ""}">${esc(n)}</h1>
      ${what(g) ? `<div class="of">≈ ${esc(what(g))}</div>` : ""}
      <div class="stats"><span><b>${g.reception.score}</b> score</span><span><b>${num(g.metrics.likes)}</b> likes</span>
        ${g.reception.repo_counted && g.github?.stars ? `<span><b>${num(g.github.stars)}</b> ★</span>` : ""}</div>
    </div>
    <div class="foot"><span>flattery.sala.company</span><span>Imitation is the sincerest form of flattery</span></div>`);
}

function home(groups) {
  const count = v => groups.filter(g => g.reception.verdict === v).length;
  return page(`
    <div class="bg" style="background: radial-gradient(120% 90% at 0% 0%, #6366f1, transparent 60%), linear-gradient(135deg, #4338ca, #0e7490)"></div>
    <div class="text" style="width: 1080px; --rc:#4f46e5">
      <div class="rate">🪞 Flattery</div>
      <h1 style="font-size: 92px">Software clones,<br>rated by the crowd.</h1>
      <div class="of">“Imitation is the sincerest form of flattery.”</div>
      <div class="stats"><span><b>${groups.length}</b> clones</span><span><b>${count("well-received")}</b> ❤️ loved</span><span><b>${count("proven")}</b> ⭐ proven</span><span><b>${count("stay-away")}</b> ☠️ to avoid</span></div>
    </div>
    <div class="foot"><span>flattery.sala.company</span><span>Found on X · checked on GitHub · updated every 8 hours</span></div>`);
}

const { groups = [] } = JSON.parse(await readFile(a.data, "utf8"));
const live = groups.filter(g => g.status === "ok" && g.code);
await mkdir(ogDir, { recursive: true });
let index = {};
try { index = JSON.parse(await readFile(`${ogDir}/index.json`, "utf8")); } catch {}

const key = g => createHash("sha1").update(JSON.stringify([name(g), g.reception.verdict, g.reception.score, num(g.metrics.likes),
  g.reception.repo_counted && num(g.github?.stars), what(g), g.thumb])).digest("hex").slice(0, 12);
const stale = live.filter(g => index[g.code] !== key(g) || !existsSync(`${ogDir}/${g.code}.png`));
const todo = stale.slice(0, +a.max);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const shoot = async (html, file) => {
  await tab.setContent(html, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, type: "png" });
};
await shoot(home(live), `${ogDir}/home.png`);
for (const g of todo) {
  try {
    const thumb = g.thumb && existsSync(`${dataDir}${g.thumb}`) ? await dataUrl(`${dataDir}${g.thumb}`) : null;
    await shoot(card(g, thumb), `${ogDir}/${g.code}.png`);
    index[g.code] = key(g);
  } catch (e) { console.log(`card ${g.code}: ${e.message}`); }
}
await browser.close();
await writeFile(`${ogDir}/index.json`, JSON.stringify(index));
console.log(`cards: ${todo.length} drawn, ${live.length - stale.length} unchanged, ${stale.length - todo.length} left for the next run, home.png updated`);

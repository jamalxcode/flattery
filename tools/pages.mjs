// Writes a page per project at p/<code>/index.html, plus sitemap.xml and robots.txt, from
// data/latest.json. Each page is the full app with its own title, description and preview
// image (data/og/<code>.png from tools/cards.mjs), so a link shared on X shows that project,
// search engines can index it, and visitors land on the app with the project open.
//
//   node tools/pages.mjs [--data data/latest.json] [--out .]
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

const SITE = "https://flattery.sala.company/";
const { values: a } = parseArgs({ options: { data: { type: "string", default: "data/latest.json" }, out: { type: "string", default: "." } } });
const root = new URL("../", import.meta.url);

const LABEL = {
  "well-received": ["❤️", "Loved"], proven: ["⭐", "Proven on GitHub"], unconfirmed: ["🔥", "Hyped, unproven"], mixed: ["😐", "Mixed"],
  "stay-away": ["☠️", "Don't touch"], "too-early": ["🆕", "New & untested"], faded: ["🌫️", "Didn't catch on"],
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
const what = g => g.product ? label(g.product) : (g.original_clean || g.original || "");
const name = g => g.project || g.display_name || g.repo?.split("/")[1] || (what(g) ? `${what(g)} clone` : "Untitled");
const num = v => (v || 0).toLocaleString("en");

const { groups = [], info = {} } = JSON.parse(await readFile(a.data, "utf8"));
const index = await readFile(new URL("index.html", root), "utf8");
const live = groups.filter(g => g.status === "ok" && g.code);

// Swaps the head's title, description, canonical and social tags
function withMeta(html, { title, description, url, image }) {
  const set = (re, tag) => re.test(html) ? (html = html.replace(re, tag)) : (html = html.replace("</head>", tag + "\n</head>"));
  set(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  set(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  set(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(url)}">`);
  set(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  set(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  set(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  set(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(image)}">`);
  set(/<meta name="twitter:card"[^>]*>/, `<meta name="twitter:card" content="summary_large_image">`);
  set(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(image)}">`);
  return html;
}

const ogFor = code => existsSync(`${a.out}/data/og/${code}.png`) ? `${SITE}data/og/${code}.png` : `${SITE}data/og/home.png`;

// Home page: the shared preview image
await writeFile(`${a.out}/index.html`, withMeta(index, {
  title: "Flattery: software clones, rated by the crowd",
  description: "Imitation is the sincerest form of flattery. Clones, reverse-engineered and reimagined versions of apps you know, rated by reactions on X and use on GitHub. Updated every 8 hours.",
  url: SITE, image: `${SITE}data/og/home.png`,
}));

await rm(`${a.out}/p`, { recursive: true, force: true });
for (const g of live) {
  const [emo, rating] = LABEL[g.reception.verdict] || LABEL.mixed;
  const n = name(g), url = `${SITE}p/${g.code}/`;
  const stars = g.reception.repo_counted && g.github?.stars ? `, ${num(g.github.stars)} GitHub stars` : "";
  const description = `${emo} ${rating}${what(g) ? ` · a ${g.kind === "reverse-engineered" ? "reverse-engineered" : g.kind === "reimagined" ? "reimagined" : g.kind === "port" ? "port of" : "clone of"} ${what(g)}` : ""}. ` +
    `${g.summary || ""} ${num(g.metrics.likes)} likes on X${stars}. Imitation is the sincerest form of flattery.`.replace(/\s+/g, " ").trim();
  let html = withMeta(index, { title: `${n}: ${emo} ${rating} | Flattery`, description, url, image: ogFor(g.code) });
  // Relative links (style.css, data/latest.json…) resolve from the site root
  html = html.replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
  // Readable without JavaScript and for search engines; the app replaces it when it loads
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card">
    <p class="issue-date">${emo} ${esc(rating)} · score ${g.reception.score}</p>
    <h1>${esc(n)}</h1>${what(g) ? `<p class="of">≈ ${esc(what(g))}</p>` : ""}
    <p>${esc(g.summary || "")}</p>
    <p>${num(g.metrics.likes)} likes and ${num(g.metrics.reposts)} reposts on X${g.posts?.length > 1 ? ` across ${g.posts.length} posts` : ""}${stars}.</p>
    <p><a href="${esc(g.url)}">The post on X</a>${g.repo ? ` · <a href="https://github.com/${esc(g.repo)}">${esc(g.repo)} on GitHub</a>` : ""}</p>
  </article></div>`);
  html = html.replace('<script src="render.js', `<script>window.FLATTERY_OPEN = ${JSON.stringify(g.id).replace(/</g, "\\u003c")};</script>\n<script src="render.js`);
  await mkdir(`${a.out}/p/${g.code}`, { recursive: true });
  await writeFile(`${a.out}/p/${g.code}/index.html`, html);
}

const day = (info.generated_iso || new Date().toISOString()).slice(0, 10);
await writeFile(`${a.out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq></url>
${live.map(g => `<url><loc>${SITE}p/${g.code}/</loc><lastmod>${(g.history?.at(-1)?.at || day)}</lastmod></url>`).join("\n")}
</urlset>
`);
await writeFile(`${a.out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`pages: ${live.length} project pages, sitemap.xml and robots.txt written`);

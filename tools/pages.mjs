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
  established: ["🏛️", "Established open-source"],
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

// Structured data for search engines (schema.org), so results can show the app as a free
// app with its systems. No star rating is claimed: Flattery's score isn't user reviews.
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const OS_NAME = { Mac: "macOS", Windows: "Windows", Linux: "Linux", Android: "Android", iOS: "iOS" };
const appLd = (g, url) => ({
  "@context": "https://schema.org", "@type": "SoftwareApplication", name: name(g), url,
  description: g.summary || undefined,
  applicationCategory: g.category === "Games" ? "GameApplication" : g.category === "Dev tools" ? "DeveloperApplication" : g.category === "Design" || g.category === "Media" ? "MultimediaApplication" : "BusinessApplication",
  operatingSystem: [...(g.github?.platforms || []).map(p => OS_NAME[p] || p), ...(g.github?.homepage ? ["Web"] : [])].join(", ") || undefined,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  sameAs: g.repo ? `https://github.com/${g.repo}` : undefined,
  image: ogFor(g.code),
});

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
  const description = g.reception.verdict === "established"
    ? `🏛️ A free, open-source alternative to ${(g.replaces || [what(g)]).join(" and ")}. ${g.summary || ""} ${num(g.github?.stars)} GitHub stars. Rated by its use on GitHub.`.replace(/\s+/g, " ").trim()
    : `${emo} ${rating}${what(g) ? ` · a ${g.kind === "reverse-engineered" ? "reverse-engineered" : g.kind === "reimagined" ? "reimagined" : g.kind === "port" ? "port of" : "clone of"} ${what(g)}` : ""}. ` +
    `${g.summary || ""} ${num(g.metrics.likes)} likes on X${stars}. Imitation is the sincerest form of flattery.`.replace(/\s+/g, " ").trim();
  let html = withMeta(index, { title: `${n}: ${emo} ${rating} | Flattery`, description, url, image: ogFor(g.code) });
  // Relative links (style.css, data/latest.json…) resolve from the site root
  html = html.replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
  // Readable without JavaScript and for search engines; the app replaces it when it loads
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card">
    <p class="issue-date">${emo} ${esc(rating)} · score ${g.reception.score}</p>
    <h1>${esc(n)}</h1>${what(g) ? `<p class="of">≈ ${esc(what(g))}</p>` : ""}
    <p>${esc(g.summary || "")}</p>
    <p>${g.reception.verdict === "established" ? `${num(g.github?.stars)} GitHub stars.` : `${num(g.metrics.likes)} likes and ${num(g.metrics.reposts)} reposts on X${g.posts?.length > 1 ? ` across ${g.posts.length} posts` : ""}${stars}.`}</p>
    <p>${g.reception.verdict === "established" ? "" : `<a href="${esc(g.url)}">The post on X</a>`}${g.repo ? ` · <a href="https://github.com/${esc(g.repo)}">${esc(g.repo)} on GitHub</a>` : ""}</p>
  </article></div>`);
  html = html.replace("</head>", ld(appLd(g, url)) + "\n</head>");
  html = html.replace('<script src="render.js', `<script>window.FLATTERY_OPEN = ${JSON.stringify(g.id).replace(/</g, "\\u003c")};</script>\n<script src="render.js`);
  await mkdir(`${a.out}/p/${g.code}`, { recursive: true });
  await writeFile(`${a.out}/p/${g.code}/index.html`, html);
}

// A short intro for each alternatives page, written from the data: how many, the best rated,
// which ones install on which systems or run in the browser
function intro(app, list) {
  const best = [...list].sort((x, y) => (y.reception.verdict === "established") - (x.reception.verdict === "established") || y.reception.score - x.reception.score);
  const established = best.filter(g => g.reception.verdict === "established");
  const rated = best.filter(g => !["too-early", "faded"].includes(g.reception.verdict));
  const loved = best.filter(g => ["well-received", "proven", "established"].includes(g.reception.verdict));
  const install = best.filter(g => g.github?.platforms?.length);
  const web = best.filter(g => g.github?.homepage && !g.github?.platforms?.length);
  const n = list.length;
  return [
    `${n} free ${n === 1 ? "alternative" : "alternatives"} to ${app}${established.length ? `, from established open-source apps (${established.slice(0, 3).map(name).join(", ")}) to new clones` : ""} found on X${list.some(g => g.source === "hn") ? " and Hacker News" : ""}, rated by how people reacted and checked on GitHub.`,
    loved.filter(g => g.reception.verdict !== "established").length ? `Best received of the clones: ${loved.filter(g => g.reception.verdict !== "established").slice(0, 3).map(name).join(", ")}.` : rated.length ? `Best rated so far: ${rated.slice(0, 2).map(name).join(", ")}.` : "Most are new, so their ratings are still settling.",
    install.length ? `Ready to install: ${install.slice(0, 3).map(g => `${name(g)} (${g.github.platforms.join(", ")})`).join("; ")}.` : "",
    web.length ? `Runs in the browser: ${web.slice(0, 3).map(name).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

// "Free alternatives to X": a page per original app, the app filtered to its clones
const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const byApp = new Map();
for (const g of live) {
  const w = what(g);
  if (!w || !slug(w) || ["faded"].includes(g.reception.verdict)) continue;
  if (!byApp.has(w)) byApp.set(w, []);
  byApp.get(w).push(g);
}
// Only apps with 2+ clones, or a well-known product with one: no thin one-line pages
for (const [app, list] of byApp) if (list.length < 2 && !list.some(g => g.product)) byApp.delete(app);
await rm(`${a.out}/alternatives`, { recursive: true, force: true });
for (const [app, list] of byApp) {
  let html = withMeta(index, {
    title: `Free ${app} alternatives, rated by the crowd | Flattery`,
    description: intro(app, list).slice(0, 300),
    url: `${SITE}alternatives/${slug(app)}/`, image: `${SITE}data/og/home.png`,
  });
  html = html.replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card"><h1>Free ${esc(app)} alternatives</h1>
    <p>${esc(intro(app, list))}</p>
    <ul>${[...list].sort((x, y) => (y.reception.verdict === "established") - (x.reception.verdict === "established") || y.reception.score - x.reception.score).map(g => `<li><a href="p/${g.code}/">${esc(name(g))}</a>: ${(LABEL[g.reception.verdict] || LABEL.mixed).join(" ")}. ${esc(g.summary || "")}</li>`).join("")}</ul></article></div>`);
  html = html.replace("</head>", ld({ "@context": "https://schema.org", "@type": "ItemList", name: `Free ${app} alternatives`,
    itemListElement: [...list].sort((x, y) => y.reception.score - x.reception.score).map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}p/${g.code}/`, name: name(g) })) }) + "\n</head>");
  html = html.replace('<script src="render.js', `<script>window.FLATTERY_PRODUCT = ${JSON.stringify(app).replace(/</g, "\\u003c")};</script>\n<script src="render.js`);
  await mkdir(`${a.out}/alternatives/${slug(app)}`, { recursive: true });
  await writeFile(`${a.out}/alternatives/${slug(app)}/index.html`, html);
}
// The index of all of them
{
  const apps = [...byApp].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
  let html = withMeta(index, { title: "Free alternatives to paid apps, rated by the crowd | Flattery",
    description: `Free clones and alternatives to ${apps.length} paid apps, from Photoshop to Word, found on X and checked on GitHub.`,
    url: `${SITE}alternatives/`, image: `${SITE}data/og/home.png` });
  html = html.replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card"><h1>Free alternatives to paid apps</h1>
    <ul class="alt-index">${apps.map(([app, list]) => `<li><a href="alternatives/${slug(app)}/">${esc(app)}</a> <span>${list.length}</span></li>`).join("")}</ul></article></div>`);
  // This page stays a plain list: the app would replace it
  html = html.replace(/<script type="module" src="app\.js[^"]*"><\/script>/, "");
  await writeFile(`${a.out}/alternatives/index.html`, html);
}

const day = (info.generated_iso || new Date().toISOString()).slice(0, 10);
await writeFile(`${a.out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq></url>
${live.map(g => `<url><loc>${SITE}p/${g.code}/</loc><lastmod>${(g.history?.at(-1)?.at || day)}</lastmod></url>`).join("\n")}
<url><loc>${SITE}alternatives/</loc><lastmod>${day}</lastmod></url>
${[...byApp.keys()].map(app => `<url><loc>${SITE}alternatives/${slug(app)}/</loc><lastmod>${day}</lastmod></url>`).join("\n")}
</urlset>
`);
await writeFile(`${a.out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`pages: ${live.length} project pages, ${byApp.size} alternatives pages, sitemap.xml and robots.txt written`);

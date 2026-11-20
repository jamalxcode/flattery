// Writes the site's pages from data/latest.json, each the full app with its own title,
// description, preview image and plain-HTML content (what search engines read before the app
// loads): the home page; a page per project at app/<slug>/ (old p/<code>/ addresses redirect
// there); "Free X alternatives" pages; landing pages per category, rating and system; and
// sitemap.xml (indexable pages only) and robots.txt. Untested projects are "noindex" until rated.
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

// Addresses: app/<slug>/ (the slug is kept for good by the scan); the code as a fallback
const appPath = g => `app/${g.slug || g.code}/`;
const appUrl = g => SITE + appPath(g);
// Projects worth indexing: rated ones. New & untested and Didn't catch on pages exist (and are
// linked) but carry "noindex" and stay out of the sitemap until they're rated.
const indexable = g => !["too-early", "faded"].includes(g.reception.verdict);
const noindex = html => html.replace("</head>", '<meta name="robots" content="noindex,follow">\n</head>');
const withBase = html => html.replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<base href="/">`);
const KIND = { "reverse-engineered": "Reverse-engineered", reimagined: "Reimagined", port: "Port of", clone: "Clone of" };

// The project's page as plain HTML, for search engines and readers without JavaScript: what it
// is, how it compares with the original, whether you can install it, what people said. The app
// replaces it with the full page when it loads.
const OS_LIST = ["Mac", "Windows", "Linux", "Android", "iOS"];
// System landing pages: [name, path]
const SYSTEMS = [["Mac", "mac"], ["Windows", "windows"], ["Linux", "linux"]];
// Rating landing pages: [verdict, path, title, intro]
const RATING_PAGES = [
  ["well-received", "loved", "Loved Free App Clones and Alternatives", "Free clones and alternatives people loved: real use on GitHub and a real crowd on X, mostly positive."],
  ["established", "established", "Established Open-Source Alternatives to Paid Apps", "Mature open-source apps that replace a paid one, with 1,000+ GitHub stars and recent work."],
  ["proven", "proven", "Free App Clones Proven on GitHub", "Free clones with lots of stars or downloads on their own GitHub repo."],
];
const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Apps that get a "Free alternatives" page (2+ alternatives, or a well-known product)
const altCount = new Map();
for (const g of live) if (what(g) && g.reception.verdict !== "faded") altCount.set(what(g), (altCount.get(what(g)) || 0) + 1);
const hasAltPage = g => what(g) && (altCount.get(what(g)) >= 2 || live.some(x => what(x) === what(g) && x.product));
function staticCard(g, emo, rating, stars) {
  const n = name(g), w = what(g), est = g.reception.verdict === "established";
  const c = g.compare, gh = g.github && g.github.status !== "gone" ? g.github : null;
  const li = list => list.map(x => `<li>${esc(x)}</li>`).join("");
  const platforms = (gh?.platforms || []).filter(p => OS_LIST.includes(p));
  const use = gh ? [
    platforms.length ? `Installers for ${platforms.join(", ")} in its GitHub releases.` : gh.homepage ? `Runs online at ${esc(gh.homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""))}.` : "Source code only: you build it yourself.",
    gh.license && gh.license !== "NOASSERTION" ? `License: ${esc(gh.license)}.` : "No license: by default others may not use, copy or change it.",
    gh.pushed_at ? `Last changed ${esc(gh.pushed_at.slice(0, 10))}.` : "",
  ].filter(Boolean) : [];
  const cat = g.category || "Other";
  const related = live.filter(x => x !== g && w && what(x) === w && indexable(x)).sort((x, y) => y.reception.score - x.reception.score).slice(0, 5);
  const sameCat = live.filter(x => x !== g && x.category === cat && indexable(x) && !related.includes(x)).sort((x, y) => y.reception.score - x.reception.score).slice(0, 5);
  const links = list => list.map(x => `<li><a href="${appPath(x)}">${esc(name(x))}</a>${what(x) ? `: free ${esc(what(x))} alternative` : ""} (${(LABEL[x.reception.verdict] || LABEL.mixed)[1]})</li>`).join("");
  return `<article class="static-card">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="./">Flattery</a> › <a href="category/${slug(cat)}/">${esc(cat)}</a> › ${esc(n)}</nav>
    <p class="issue-date">${emo} ${esc(rating)} · score ${g.reception.score}</p>
    <h1>${esc(n)}${w ? `: a free ${est ? "open-source alternative to" : g.kind === "reverse-engineered" ? "reverse-engineered" : g.kind === "port" ? "port of" : "alternative to"} ${esc(w)}` : ""}</h1>
    <p>${esc(g.summary || "")}</p>
    ${c && (c.does?.length || c.missing?.length) ? `<h2>${esc(n)} vs ${esc(w)}</h2>
    ${c.verdict ? `<p>${esc(c.verdict)}</p>` : ""}
    ${c.does?.length ? `<h3>What it does like ${esc(w)}</h3><ul>${li(c.does)}</ul>` : ""}
    ${c.missing?.length ? `<h3>What's missing compared with ${esc(w)}</h3><ul>${li(c.missing)}</ul>` : ""}
    <p>Opens ${esc(w)} files: ${({ yes: "yes", partly: "partly", no: "no" })[c.opens_files] || "not said"}.</p>` : ""}
    ${use.length ? `<h2>Can I use ${esc(n)}?</h2><ul>${li(use)}</ul>` : ""}
    ${!est && g.sentiment?.sampled ? `<h2>What people said</h2><p>${g.sentiment.positive} positive, ${g.sentiment.neutral} neutral and ${g.sentiment.negative} negative of ${g.sentiment.sampled} replies.${g.sentiment.summary ? ` ${esc(g.sentiment.summary)}` : ""}</p>` : ""}
    <p>${est ? `${num(gh?.stars)} GitHub stars.` : `${num(g.metrics.likes)} likes and ${num(g.metrics.reposts)} reposts on X${g.posts?.length > 1 ? ` across ${g.posts.length} posts` : ""}${stars}.`}</p>
    <p>${est ? "" : `<a href="${esc(g.url)}">The post on X</a>`}${g.repo ? `${est ? "" : " · "}<a href="https://github.com/${esc(g.repo)}">${esc(g.repo)} on GitHub</a>` : ""}${hasAltPage(g) ? ` · <a href="alternatives/${slug(w)}/">All free ${esc(w)} alternatives</a>` : ""}</p>
    ${related.length ? `<h2>Other free ${esc(w)} alternatives</h2><ul>${links(related)}</ul>` : ""}
    ${sameCat.length ? `<h2>More free ${esc(cat.toLowerCase())} apps</h2><ul>${links(sameCat)}</ul>` : ""}
  </article>`;
}
const crumbsLd = g => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "Flattery", item: SITE },
  { "@type": "ListItem", position: 2, name: g.category || "Other", item: `${SITE}category/${slug(g.category || "Other")}/` },
  { "@type": "ListItem", position: 3, name: name(g), item: appUrl(g) }] });

// Search-friendly titles and descriptions: what people search ("free Photoshop alternative"),
// no emoji (they take room in results)
function titleFor(g) {
  const n = name(g), w = what(g).replace(/^\p{Ll}/u, c => c.toUpperCase()), est = g.reception.verdict === "established";
  if (!w) return `${n}: ${(LABEL[g.reception.verdict] || LABEL.mixed)[1]} | Flattery`;
  return `${n}: Free ${est ? "Open-Source " : ""}${w} Alternative | Flattery`.replace(/\s+/g, " ");
}
function descriptionFor(g, stars) {
  const w = what(g), est = g.reception.verdict === "established", [, rating] = LABEL[g.reception.verdict] || LABEL.mixed;
  const lead = est ? `A free, open-source alternative to ${(g.replaces || [w]).join(" and ")}.`
    : w ? `${KIND[g.kind] ? `${KIND[g.kind]} ${w}` : `A free alternative to ${w}`}: rated ${rating} by the crowd.` : `Rated ${rating} by the crowd.`;
  const proof = est ? `${num(g.github?.stars)} GitHub stars.` : `${num(g.metrics.likes)} ${g.metrics.likes === 1 ? "like" : "likes"} on X${stars}.`;
  const install = (g.github?.platforms || []).length ? ` Installers for ${g.github.platforms.join(", ")}.` : g.github?.homepage ? " Runs in the browser." : "";
  return `${lead} ${g.summary || ""} ${proof}${install}`.replace(/\s+/g, " ").trim().slice(0, 300);
}

// Home page: real content in the HTML (the best apps, categories, landing pages), which the app
// replaces when it loads
{
  const top = (list, n = 12) => [...list].sort((x, y) => y.reception.score - x.reception.score).slice(0, n);
  const by = v => live.filter(g => g.reception.verdict === v);
  const li = list => list.map(g => `<li><a href="${appPath(g)}">${esc(name(g))}</a>${what(g) ? `, free ${esc(what(g))} alternative` : ""}</li>`).join("");
  const cats = [...new Set(live.map(g => g.category || "Other"))].sort();
  const home = `<article class="static-card">
    <h1>Free alternatives to paid apps, rated by the crowd</h1>
    <p>Flattery is an app store of free clones, open-source alternatives, reverse-engineered and reimagined versions of the apps you pay for. ${live.length} apps, found on X and Hacker News, rated by how people reacted and checked on GitHub. Updated every 8 hours.</p>
    <h2>Most loved</h2><ul>${li(top(by("well-received")))}</ul>
    <h2>Established open-source alternatives</h2><ul>${li(top(by("established")))}</ul>
    <h2>Proven on GitHub</h2><ul>${li(top(by("proven")))}</ul>
    <h2>Browse by category</h2><ul>${cats.map(c => `<li><a href="category/${slug(c)}/">Free ${esc(c.toLowerCase())} apps</a></li>`).join("")}</ul>
    <h2>Free apps for your computer</h2><ul>${SYSTEMS.map(([os, s]) => `<li><a href="${s}/">Free ${os} apps that replace paid software</a></li>`).join("")}</ul>
    <p><a href="alternatives/">Free alternatives to paid apps, by app</a> · <a href="stats/">Stats</a> · <a href="suggest/">Suggest a clone</a></p>
  </article>`;
  let html = withMeta(index, {
    title: "Flattery: Free Alternatives to Paid Apps, Rated by the Crowd",
    description: `Free clones and open-source alternatives to the apps you pay for: Photoshop, Word, Premiere Pro and more. ${live.length} apps rated by real reactions on X and use on GitHub, updated every 8 hours.`,
    url: SITE, image: `${SITE}data/og/home.png`,
  });
  html = html.replace('<div id="live"></div>', `<div id="live">${home}</div>`);
  html = html.replace("</head>", ld({ "@context": "https://schema.org", "@type": "WebSite", name: "Flattery", url: SITE,
    description: "Free alternatives to paid apps, rated by the crowd", publisher: { "@type": "Organization", name: "Sala Company", url: "https://go.sala.company" } }) + "\n</head>");
  await writeFile(`${a.out}/index.html`, html);
}

await rm(`${a.out}/p`, { recursive: true, force: true });
await rm(`${a.out}/app`, { recursive: true, force: true });
for (const g of live) {
  const [emo, rating] = LABEL[g.reception.verdict] || LABEL.mixed;
  const url = appUrl(g);
  const stars = g.reception.repo_counted && g.github?.stars ? `, ${num(g.github.stars)} GitHub stars` : "";
  let html = withMeta(index, { title: titleFor(g), description: descriptionFor(g, stars), url, image: ogFor(g.code) });
  // Relative links (style.css, data/site.json…) resolve from the site root
  html = withBase(html);
  if (!indexable(g)) html = noindex(html);
  // Readable without JavaScript and for search engines; the app replaces it when it loads
  html = html.replace('<div id="live"></div>', `<div id="live">${staticCard(g, emo, rating, stars)}</div>`);
  html = html.replace("</head>", ld(appLd(g, url)) + "\n" + ld(crumbsLd(g)) + "\n</head>");
  html = html.replace('<script src="render.js', `<script>window.FLATTERY_OPEN = ${JSON.stringify(g.id).replace(/</g, "\\u003c")};</script>\n<script src="render.js`);
  await mkdir(`${a.out}/${appPath(g)}`, { recursive: true });
  await writeFile(`${a.out}/${appPath(g)}index.html`, html);
  // The old address p/<code>/ (shared links, the share images) forwards to the new one
  await mkdir(`${a.out}/p/${g.code}`, { recursive: true });
  await writeFile(`${a.out}/p/${g.code}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name(g))} | Flattery</title>
<link rel="canonical" href="${esc(url)}"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=${esc(url)}"></head>
<body><p><a href="${esc(url)}">${esc(name(g))} on Flattery</a></p></body></html>`);
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
    title: `Best Free ${app} Alternatives (${new Date(info.generated_iso || Date.now()).getFullYear()}): Open-Source and Clones | Flattery`,
    description: intro(app, list).slice(0, 300),
    url: `${SITE}alternatives/${slug(app)}/`, image: `${SITE}data/og/home.png`,
  });
  html = withBase(html);
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card"><h1>Free ${esc(app)} alternatives</h1>
    <p>${esc(intro(app, list))}</p>
    <ul>${[...list].sort((x, y) => (y.reception.verdict === "established") - (x.reception.verdict === "established") || y.reception.score - x.reception.score).map(g => `<li><a href="${appPath(g)}">${esc(name(g))}</a>: ${(LABEL[g.reception.verdict] || LABEL.mixed).join(" ")}. ${esc(g.summary || "")}</li>`).join("")}</ul></article></div>`);
  html = html.replace("</head>", ld({ "@context": "https://schema.org", "@type": "ItemList", name: `Free ${app} alternatives`,
    itemListElement: [...list].sort((x, y) => y.reception.score - x.reception.score).map((g, i) => ({ "@type": "ListItem", position: i + 1, url: appUrl(g), name: name(g) })) }) + "\n</head>");
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
  html = withBase(html);
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card"><h1>Free alternatives to paid apps</h1>
    <ul class="alt-index">${apps.map(([app, list]) => `<li><a href="alternatives/${slug(app)}/">${esc(app)}</a> <span>${list.length}</span></li>`).join("")}</ul></article></div>`);
  // This page stays a plain list: the app would replace it
  html = html.replace(/<script type="module" src="app\.js[^"]*"><\/script>/, "");
  await writeFile(`${a.out}/alternatives/index.html`, html);
}

// Landing pages: the app opened on a category or rating, with the list in plain HTML
const byScore = list => [...list].sort((x, y) => y.reception.score - x.reception.score);
const landing = [];   // [path, indexable]
async function landingPage(path, { title, description, h1, intro: text, list, view, crumb, appless }) {
  let html = withMeta(index, { title, description, url: SITE + path, image: `${SITE}data/og/home.png` });
  html = withBase(html);
  const ok = list.filter(indexable).length >= 3;
  if (!ok) html = noindex(html);
  html = html.replace('<div id="live"></div>', `<div id="live"><article class="static-card">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="./">Flattery</a> › ${esc(crumb)}</nav>
    <h1>${esc(h1)}</h1><p>${esc(text)}</p>
    <ol>${byScore(list).map(g => `<li><a href="${appPath(g)}">${esc(name(g))}</a>${what(g) ? `, free ${esc(what(g))} alternative` : ""}: ${(LABEL[g.reception.verdict] || LABEL.mixed)[1]}. ${esc(g.summary || "")}</li>`).join("")}</ol></article></div>`);
  html = html.replace("</head>", ld({ "@context": "https://schema.org", "@type": "ItemList", name: h1,
    itemListElement: byScore(list).slice(0, 50).map((g, i) => ({ "@type": "ListItem", position: i + 1, url: appUrl(g), name: name(g) })) }) + "\n" +
    ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Flattery", item: SITE }, { "@type": "ListItem", position: 2, name: crumb, item: SITE + path }] }) + "\n</head>");
  if (appless) html = html.replace(/<script type="module" src="app\.js[^"]*"><\/script>/, "");
  else html = html.replace('<script src="render.js', `<script>window.FLATTERY_VIEW = ${JSON.stringify(view).replace(/</g, "\\u003c")};</script>\n<script src="render.js`);
  await mkdir(`${a.out}/${path}`, { recursive: true });
  await writeFile(`${a.out}/${path}index.html`, html);
  landing.push([path, ok]);
}
await rm(`${a.out}/category`, { recursive: true, force: true });
for (const cat of [...new Set(live.map(g => g.category || "Other"))]) {
  const list = live.filter(g => (g.category || "Other") === cat && g.reception.verdict !== "faded");
  if (!list.length) continue;
  const lc = cat.toLowerCase();
  await landingPage(`category/${slug(cat)}/`, { title: `Free ${cat} Apps: Open-Source Alternatives and Clones | Flattery`,
    description: `${list.length} free ${lc} apps that replace paid software, from open-source alternatives to new clones, rated by real reactions on X and use on GitHub.`,
    h1: `Free ${lc} apps`, intro: `Free ${lc} apps that replace paid software: open-source alternatives and new clones found on X and Hacker News, rated by the crowd and checked on GitHub. Best first.`,
    list, view: { filter: "all", cat }, crumb: cat });
}
for (const [v, path, title, text] of RATING_PAGES) {
  await rm(`${a.out}/${path}`, { recursive: true, force: true });
  const list = live.filter(g => g.reception.verdict === v);
  await landingPage(`${path}/`, { title: `${title} | Flattery`, description: `${list.length} ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    h1: title, intro: text, list, view: { filter: v }, crumb: (LABEL[v] || [, title])[1] });
}
const getable = g => ["well-received", "proven", "established"].includes(g.reception.verdict);
for (const [os, path] of SYSTEMS) {
  await rm(`${a.out}/${path}`, { recursive: true, force: true });
  const list = live.filter(g => getable(g) && (g.github?.platforms || []).includes(os));
  await landingPage(`${path}/`, { title: `Free ${os} Apps That Replace Paid Software | Flattery`,
    description: `${list.length} free ${os} apps with ready-made installers that replace paid software: open-source alternatives and loved clones, rated by the crowd.`,
    h1: `Free ${os} apps that replace paid software`, intro: `Free apps with a ${os} installer in their GitHub releases, rated Loved, Proven on GitHub or Established. Downloads come straight from GitHub; Flattery doesn't check them.`,
    list, crumb: os, appless: true });
}

const day = (info.generated_iso || new Date().toISOString()).slice(0, 10);
await writeFile(`${a.out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq></url>
${live.filter(indexable).map(g => `<url><loc>${appUrl(g)}</loc><lastmod>${String(g.history?.at(-1)?.at || day).slice(0, 10)}</lastmod></url>`).join("\n")}
${landing.filter(([, ok]) => ok).map(([path]) => `<url><loc>${SITE}${path}</loc><lastmod>${day}</lastmod></url>`).join("\n")}
<url><loc>${SITE}alternatives/</loc><lastmod>${day}</lastmod></url>
<url><loc>${SITE}suggest/</loc><lastmod>${day}</lastmod></url>
${[...byApp.keys()].map(app => `<url><loc>${SITE}alternatives/${slug(app)}/</loc><lastmod>${day}</lastmod></url>`).join("\n")}
</urlset>
`);
await writeFile(`${a.out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`pages: ${live.length} project pages (${live.filter(indexable).length} indexable), ${byApp.size} alternatives pages, ${landing.length} landing pages, sitemap.xml and robots.txt written`);

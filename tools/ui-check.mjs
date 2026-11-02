// Opens the page in a real browser, from a local copy of the site with the real catalog, and
// checks that it works: rows appear, search, the sidebar, the detail sheet, the How it works
// drawer, no script errors and no sideways scrolling, on a desktop and a phone screen.
// Runs on every pull request (.github/workflows/pr-check.yml), so a broken page isn't merged.
//
//   node tools/ui-check.mjs [--root .]      (needs data/latest.json, and data/site.json from tools/slim.mjs, under the root;
//                                            CHROMIUM=/path to use a local browser)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { createRequire } from "node:module";

// Accessibility audit (axe-core): serious or critical problems fail the check
const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
async function axe(p, where) {
  await p.addScriptTag({ content: axeSource });
  const bad = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations
    .filter(v => ["serious", "critical"].includes(v.impact)).map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`));
  check(!bad.length, `${where}: accessibility${bad.length ? ": " + bad.join(" | ") : ""}`);
}

const { values: a } = parseArgs({ options: { root: { type: "string", default: "." } } });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml" };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(a.root, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [width, label] of [[1280, "desktop"], [390, "phone"]]) {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await p.goto(base);
  try { await p.waitForSelector(".grid .card", { timeout: 15000 }); } catch {}
  const rows = await p.locator(".grid .card").count();
  check(rows > 0, `${label}: ${rows} rows in the list`);
  check(await p.locator("[data-r=discover] .shelf-sec").count() > 0, `${label}: Discover shelves shown`);
  // Sideways scrolling, naming the elements that stick out
  const wide = await p.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w + 1) return [];
    return [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("dialog:not([open]), [hidden], .side-group") &&
      ![...(function* (n) { while ((n = n.parentElement) && n !== document.body) yield n; })(el)].some(a => getComputedStyle(a).overflowX !== "visible"))
      .slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} (${Math.round(el.getBoundingClientRect().right)}px of ${w}px): ${(el.textContent || "").trim().slice(0, 40)}`);
  });
  check(!wide.length, `${label}: no sideways scrolling${wide.length ? ": " + wide.join(" | ") : ""}`);

  // Search: a word from the first row's name finds it
  const first = (await p.locator(".grid .card h3").first().textContent()).trim();
  const word = first.split(/[^\p{L}\p{N}]+/u).find(w => w.length > 2) || first;
  await p.fill("#search", word);
  await p.waitForTimeout(300);
  const found = await p.locator(".grid .card h3").allTextContents();
  check(found.some(t => t.includes(word)), `${label}: search "${word}" finds ${found.length}`);
  await p.fill("#search", "zzzzqqqq");
  await p.waitForTimeout(300);
  check(await p.locator(".grid .card").count() === 0, `${label}: nonsense search finds nothing`);
  await p.fill("#search", "");
  await p.waitForTimeout(300);

  // Sidebar: Everything lists at least as many as Discover's list, and explains itself
  await p.click('.side-item[data-filter="all"]');
  await p.waitForTimeout(200);
  check(await p.locator(".grid .card").count() >= rows, `${label}: Everything lists everything`);
  check(width < 900 ? await p.locator("[data-r=sideNote]").isVisible() : await p.locator(".side-desc").count() === 1, `${label}: the chosen view is explained`);

  await axe(p, `${label} list`);

  // Detail sheet
  await p.locator(".grid .card h3 button").first().click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector("[data-r=sheet]")?.open), `${label}: a row opens its detail sheet`);
  await axe(p, `${label} detail sheet`);
  await p.keyboard.press("Escape");

  // How it works
  if (width < 640) { await p.click(".more-menu summary"); await p.click(".menu [data-about]"); }
  else await p.click("#about-btn");
  await p.waitForTimeout(200);
  check(await p.evaluate(() => document.getElementById("about")?.open), `${label}: How it works opens`);
  await p.keyboard.press("Escape");

  // The Suggest page
  await p.goto(base + "suggest/");
  await p.waitForTimeout(400);
  check(await p.locator("h1").textContent() === "Suggest a clone", `${label}: the Suggest page opens`);
  await axe(p, `${label} suggest page`);

  check(!errors.length, `${label}: no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await p.close();
}
await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} checks failed`); process.exit(1); }
console.log("\nall page checks passed");

// Tells search engines that use IndexNow (Bing, Yandex, Seznam, Naver…; Bing shares with
// others) which pages changed, right after a deploy, so they're crawled within hours instead
// of days. Sends the sitemap's pages changed in the last day (all of them with --all). The key
// file (b91d696d9ea49e597f80c1e418330c20.txt at the site root) proves the site is ours. Never fails the deploy.
//
//   node tools/indexnow.mjs [--sitemap sitemap.xml] [--all]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const SITE = "https://flattery.sala.company/";
const KEY = "b91d696d9ea49e597f80c1e418330c20";
const { values: a } = parseArgs({ options: { sitemap: { type: "string", default: "sitemap.xml" }, all: { type: "boolean", default: false } } });

try {
  const xml = await readFile(a.sitemap, "utf8");
  const since = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)]
    .filter(([, , mod]) => a.all || !mod || mod >= since).map(([, loc]) => loc).slice(0, 10000);
  if (!urls.length) { console.log("indexnow: nothing changed"); process.exit(0); }
  // Right after a deploy the key file may not be served yet (IndexNow answers 403): wait for it
  for (let i = 0; i < 12; i++) {
    const t = await fetch(`${SITE}${KEY}.txt?${Date.now()}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.text() : "").catch(() => "");
    if (t.trim() === KEY) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}${KEY}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`indexnow: sent ${urls.length} pages, answer ${res.status}${res.ok ? "" : `: ${(await res.text()).slice(0, 200)}`}`);
    if (res.ok || ![403, 429].includes(res.status) || attempt === 3) break;
    await new Promise(r => setTimeout(r, 30000));
  }
} catch (e) {
  console.log(`indexnow: skipped (${e.message})`);
}

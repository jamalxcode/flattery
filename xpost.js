// Posting to X as the Flattery account: the weekly newsletter and "just promoted to ❤️ Loved"
// posts, each linking back to flattery.sala.company. Posting needs user-context keys (OAuth 1.0a),
// not the read-only bearer token: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET.
// Without them nothing is posted and the scan carries on as before.
import { createHmac, randomBytes } from "node:crypto";

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// The Authorization header for one request (a JSON body isn't part of the signature)
export function oauthHeader(method, url, keys, { nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const params = {
    oauth_consumer_key: keys.apiKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp), oauth_token: keys.accessToken, oauth_version: "1.0",
  };
  const u = new URL(url);
  const all = [...Object.entries(params), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : 1);
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const signature = createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...params, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

export function makePoster(env, log) {
  const keys = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET };
  if (!Object.values(keys).every(Boolean)) return null;
  return {
    async post(text) {
      const url = "https://api.x.com/2/tweets";
      try {
        const res = await fetch(url, { method: "POST", body: JSON.stringify({ text }),
          headers: { Authorization: oauthHeader("POST", url, keys), "Content-Type": "application/json" } });
        if (res.ok) return (await res.json()).data?.id || true;
        log(`posting to X failed (${res.status}): ${(await res.text()).slice(0, 200)}`, "warn");
      } catch (e) { log(`posting to X failed: ${e.message}`, "warn"); }
      return null;
    },
  };
}

const SITE = "https://flattery.sala.company/";
const cut = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;

// What to post this run, given the catalog and what was posted before: [{ key, text }]
// A post's link counts as 23 characters on X, so texts stay under 280 with it.
export function postsToMake(groups, info, posted, { today, max = 3 } = {}) {
  const out = [];
  const issue = (info.newsletter || [])[0];
  if (issue && !posted[`news:${issue.date}`]) {
    const items = issue.items.slice(0, 3).map(i => `• ${i.name}`).join("\n");
    out.push({ key: `news:${issue.date}`, text: cut(`📰 This week in clones: ${issue.title}\n\n${items}\n\nRated by the crowd: ${SITE}#news`, 270) });
  }
  // Newly loved, at most two a run, the best first
  const label = g => g.project || g.display_name || g.repo?.split("/")[1];
  const of = g => g.original_clean || g.original;
  const loved = groups.filter(g => g.status === "ok" && g.reception.verdict === "well-received" && g.code && label(g) &&
    g.history?.at(-1)?.at === today && !posted[`loved:${g.id}`]).sort((a, b) => b.reception.score - a.reception.score);
  for (const g of loved.slice(0, 2)) {
    const stars = g.reception.repo_counted && g.github?.stars ? ` · ★ ${g.github.stars.toLocaleString("en")} on GitHub` : "";
    out.push({ key: `loved:${g.id}`, text: cut(`❤️ Now Loved on Flattery: ${label(g)}${of(g) ? `, a free take on ${of(g)}` : ""}${stars}\n\n${g.summary || ""}`, 245) + `\n${SITE}p/${g.code}/` });
  }
  return out.slice(0, max);
}

// The same posts, as alerts on the site's public ntfy.sh channel (🔔 Follow on the site): free,
// no keys, no sign-up for followers. Published as JSON (titles carry emoji, which headers can't).
// Returns the keys sent.
export async function sendAlerts(topic, items, log) {
  const sent = [];
  for (const it of items) {
    const [first, ...rest] = it.text.split("\n").filter(Boolean);
    const url = (it.text.match(/https:\/\/flattery\.sala\.company\/\S*/) || ["https://flattery.sala.company/"])[0];
    const body = { topic, title: first.slice(0, 120), message: rest.filter(l => !l.startsWith("http")).join("\n").slice(0, 600) || first, click: url,
      tags: [it.key.startsWith("news:") ? "newspaper" : "heart"] };
    try {
      const res = await fetch("https://ntfy.sh/", { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (res.ok) sent.push(it.key); else log(`alerts: ntfy answered ${res.status}`, "warn");
    } catch (e) { log(`alerts: ${e.message}`, "warn"); }
  }
  return sent;
}

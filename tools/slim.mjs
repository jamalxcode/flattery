// Writes data/site.json: only what the page shows, from data/latest.json. The full catalog
// (every post, every rejected id, the scan's bookkeeping) is over a megabyte; the page needs
// the cards and a little status, so visitors download a fraction of it. latest.json stays
// published for the RSS/JSON users and the scans.
//
//   node tools/slim.mjs [--data data/latest.json] [--out data/site.json]
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { data: { type: "string", default: "data/latest.json" }, out: { type: "string", default: "data/site.json" } } });
const { info = {}, groups = [] } = JSON.parse(await readFile(a.data, "utf8"));

const GROUP = ["id", "code", "status", "project", "display_name", "repo", "foreign_repo", "original", "original_clean", "product", "kind", "category",
  "summary", "url", "source", "created_at", "metrics", "reception", "history", "group", "objections", "trials", "second_opinion", "compare", "thumb", "icon"];
const GITHUB = ["status", "repo", "stars", "forks", "downloads", "license", "platforms", "get", "homepage", "created", "pushed_at", "commits_30d", "image"];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));

export function slimGroup(g) {
  const out = pick(g, GROUP);
  out.text = (g.text || "").slice(0, 600);
  out.author = pick(g.author || {}, ["username", "followers"]);
  if (g.github) {
    out.github = pick(g.github, GITHUB);
    // Star growth needs only the first and last of the kept history
    const h = g.github.stars_history || [];
    if (h.length > 1) out.github.stars_history = [h[0], h.at(-1)];
  }
  if (g.sentiment) out.sentiment = pick(g.sentiment, ["positive", "neutral", "negative", "sampled", "flags", "evidence", "summary"]);
  // The 15 most liked posts are listed (they're sorted by likes); the count says how many in all
  if (g.posts) {
    out.posts = g.posts.slice(0, 15).map(p => ({ ...pick(p, ["id", "url", "author", "likes", "created_at", "status"]), text: (p.text || "").slice(0, 120) }));
    out.posts_count = g.posts.length;
  }
  return out;
}

const INFO = ["source", "generated", "generated_iso", "newsletter", "status", "month", "rejected_samples", "removed_projects", "audit", "suggest_log"];
const site = { info: { ...pick(info, INFO), rejected_samples: (info.rejected_samples || []).slice(-30) }, groups: groups.map(slimGroup) };
const body = JSON.stringify(site);
await writeFile(a.out, body);
const full = (await readFile(a.data)).length;
console.log(`site.json: ${(body.length / 1024).toFixed(0)} KB for ${groups.length} cards (latest.json is ${(full / 1024).toFixed(0)} KB)`);

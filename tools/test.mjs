// Offline check of the whole pipeline: the real X client against a stubbed fetch, with
// fake Haiku and GitHub answers. Runs two scans two days apart and checks the verdicts.
//
//   node tools/test.mjs [--html out.html]
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { X, githubRepo } from "../x.js";
import { run } from "../pipeline.js";
import { repoStats } from "../github.js";
import { reportHtml } from "../report.js";

const { values: a } = parseArgs({ options: { html: { type: "string" } } });
const H = 36e5, T0 = Date.parse("2026-10-30T12:00:00Z");
const log = () => {};

const users = {
  u1: { id: "u1", username: "alice", name: "Alice", public_metrics: { followers_count: 12000 } },
  u2: { id: "u2", username: "bob", name: "Bob", public_metrics: { followers_count: 300 } },
  u3: { id: "u3", username: "carol", name: "Carol", public_metrics: { followers_count: 50000 } },
  u4: { id: "u4", username: "dave", name: "Dave", public_metrics: { followers_count: 90 } },
  fan: { id: "fan", username: "fan", name: "Fan", public_metrics: { followers_count: 10 } },
};
const metrics = (likes, reposts, replies, quotes, views) => ({ like_count: likes, retweet_count: reposts, reply_count: replies, quote_count: quotes, bookmark_count: Math.round(likes / 5), impression_count: views });
const post = (id, author, text, hoursAgo, m, url) => ({
  id, author_id: author, conversation_id: id, text, created_at: new Date(T0 - hoursAgo * H).toISOString(), lang: "en", public_metrics: m,
  entities: url ? { urls: [{ url: "https://t.co/x", expanded_url: url }] } : undefined,
});
const posts = {
  // well received: lots of likes, positive replies, repo with many stars
  p1: post("p1", "u1", "I rebuilt Photoshop in the browser, open source", 40, metrics(4200, 900, 310, 80, 400000), "https://github.com/alice/webshop"),
  // buzz: popular, no repo
  p2: post("p2", "u3", "We recreated Figma from scratch in a weekend", 30, metrics(2500, 400, 200, 30, 300000)),
  // stay away: ratioed with negative replies
  p3: post("p3", "u2", "My Notion clone is better than Notion", 50, metrics(40, 2, 120, 25, 30000), "https://github.com/bob/notnotion"),
  // too early: new and small
  p4: post("p4", "u4", "reverse engineered the Slack desktop protocol", 3, metrics(4, 0, 1, 0, 300), "https://github.com/dave/slackre"),
  // not a clone: rejected by triage
  p5: post("p5", "u2", "Hot take: Photoshop is overpriced", 10, metrics(100, 10, 50, 2, 9000)),
};
// alice posts the repo again in a self-reply; fans reply positively
const replyPosts = {
  p1: [post("r1", "u1", "repo: github.com/alice/webshop", 39, metrics(50, 1, 0, 0, 0), "https://github.com/alice/webshop"),
    ...Array.from({ length: 12 }, (_, i) => post(`r1${i}`, "fan", i < 10 ? "this is amazing, starred" : "how does it handle PSD?", 38, metrics(1, 0, 0, 0, 0)))],
  p2: Array.from({ length: 8 }, (_, i) => post(`r2${i}`, "fan", "wow", 29, metrics(1, 0, 0, 0, 0))),
  p3: Array.from({ length: 10 }, (_, i) => post(`r3${i}`, "fan", i < 8 ? "doesn't even start, and it's a wrapper" : "ok", 49, metrics(1, 0, 0, 0, 0))),
};
let deleted = new Set();
let archiveRefused = false;
// an older popular post only full-archive search can find
const oldPost = post("p9", "u3", "I reverse engineered the AirDrop protocol, open source", 15 * 24, metrics(3000, 600, 150, 40, 200000), "https://github.com/carol/opendrop");

const reads = [];
globalThis.fetch = async url => {
  const u = new URL(url);
  reads.push(u.pathname + "?" + u.searchParams.get("query"));
  const json = body => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
  const pack = list => json({ data: list, includes: { users: [...new Set(list.map(p => p.author_id))].map(id => users[id]) }, meta: { newest_id: list[0]?.id, result_count: list.length } });
  if (u.pathname === "/2/tweets/search/all" && archiveRefused)
    return { ok: false, status: 403, text: async () => "client-not-enrolled", headers: new Headers() };
  if (u.pathname === "/2/tweets/search/recent" || u.pathname === "/2/tweets/search/all") {
    const q = u.searchParams.get("query");
    const conv = q.match(/conversation_id:(\w+)/);
    if (conv) return pack(replyPosts[conv[1]] || []);
    if (u.searchParams.get("since_id")) return pack([]);
    if (u.pathname.endsWith("/all")) return pack([oldPost, posts.p4]);
    return pack(Object.values(posts).filter(p => !deleted.has(p.id)));
  }
  if (/\/quote_tweets$/.test(u.pathname)) return pack([]);
  if (u.pathname === "/2/tweets") {
    const ids = u.searchParams.get("ids").split(",");
    const body = await pack(ids.filter(id => posts[id] && !deleted.has(id)).map(id => posts[id])).json();
    body.errors = ids.filter(id => deleted.has(id)).map(id => ({ resource_id: id, resource_type: "tweet", type: "https://api.twitter.com/2/problems/resource-not-found" }));
    return json(body);
  }
  throw new Error("unexpected fetch " + url);
};

const haiku = {
  async triage(list) {
    return new Map(list.map(p => [p.id, p.id === "p5"
      ? { id: p.id, kind: "not-a-clone", original: "", project: "", summary: "" }
      : { id: p.id, kind: p.id === "p4" ? "reverse-engineered" : "clone", original: { p1: "Adobe Photoshop", p2: "Figma", p3: "Notion", p4: "Slack" }[p.id], project: "Proj " + p.id, summary: "Built " + p.id }]));
  },
  async sentiment(_, reactions) {
    const neg = reactions.filter(r => /doesn't|wrapper/.test(r.text)).length;
    const pos = reactions.filter(r => /amazing|wow/.test(r.text)).length;
    return { positive: pos, negative: neg, neutral: reactions.length - pos - neg, sampled: reactions.length, flags: neg ? ["does-not-work", "just-a-wrapper"] : [], summary: neg ? "People say it doesn't work." : "People love it." };
  },
};
let stars = { "alice/webshop": 3100, "bob/notnotion": 12, "dave/slackre": 2 };
const githubStats = async names => new Map(names.map(n => [n, { status: "ok", repo: n, url: "https://github.com/" + n, stars: stars[n], forks: 10, watchers: 5, downloads: n === "alice/webshop" ? 9000 : 0, releases: 1, license: "MIT", language: "TypeScript", created: "2026-10-01", pushed_at: "2026-10-29T00:00:00Z" }]));

assert.equal(githubRepo("https://github.com/alice/webshop.git"), "alice/webshop");
assert.equal(githubRepo("https://github.com/features/copilot"), null);

// GitHub sometimes returns null nodes inside a repo (partial answers); that mustn't crash the scan
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { r0: {
  nameWithOwner: "a/b", url: "https://github.com/a/b", isArchived: false, stargazerCount: 7, forkCount: 1, watchers: null,
  releases: { totalCount: 2, nodes: [null, { releaseAssets: { nodes: [null, { downloadCount: 5 }] } }] } } } }) });
const partial = (await repoStats("t", ["a/b"], log)).get("a/b");
assert.equal(partial.downloads, 5);
assert.equal(partial.stars, 7);
globalThis.fetch = realFetch;

// Run 1
const x = new X("token", log, { maxReads: 2000 });
const r1 = await run(null, { perQuery: 50, productsPerRun: 1 }, { x, haiku, githubStats, log, now: T0 });
const by = (r, id) => r.results.find(e => e.id === id);
assert.equal(r1.results.length, 4, "the non-clone is rejected");
assert.ok(r1.info.rejected.includes("p5"));
assert.equal(by(r1, "p1").reception.verdict, "well-received");
assert.equal(by(r1, "p1").product.name, "Photoshop");
assert.equal(by(r1, "p2").reception.verdict, "unconfirmed");
assert.equal(by(r1, "p3").reception.verdict, "stay-away");
assert.equal(by(r1, "p4").reception.verdict, "too-early");
assert.equal(by(r1, "p1").sentiment.sampled, 12, "the author's own reply isn't counted");
assert.ok(by(r1, "p1").reception.score > by(r1, "p3").reception.score);
const firstReads = x.reads;

// Run 2, two days later: p3 deleted, alice's stars grew
deleted = new Set(["p3"]);
stars = { ...stars, "alice/webshop": 3500 };
const x2 = new X("token", log, { maxReads: 2000 });
const r2 = await run({ ...r1, info: { ...r1.info } }, { perQuery: 50, productsPerRun: 1, rotate: 1 }, { x: x2, haiku, githubStats, log, now: T0 + 48 * H });
assert.equal(r2.results.length, 4, "nothing is dropped");
assert.equal(by(r2, "p3").status, "gone");
assert.equal(by(r2, "p3").text, "", "removed posts lose their text");
assert.equal(by(r2, "p1").github.stars_history.length, 2);
assert.ok(by(r2, "p1").snapshots["24h"], "24h checkpoint recorded");
assert.ok(x2.reads < firstReads, "known posts aren't searched again");

// Backfill: full-archive search adds the older popular post (the tiny p4 is skipped)
posts.p9 = oldPost;
const x3 = new X("token", log, { maxReads: 3000 });
const r3 = await run(r2, { perQuery: 50, productsPerRun: 1, backfillDays: 21, maxReactions: 40 }, { x: x3, haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(by(r3, "p9"), "backfill finds the older post");
assert.ok(by(r3, "p9").found_by.some(f => f.startsWith("backfill")));
assert.ok(reads.some(r => r.startsWith("/2/tweets/search/all?conversation_id:p9")), "old threads are read through the archive");

// Without full-archive access the run carries on
archiveRefused = true;
delete posts.p9;
const x4 = new X("token", log, { maxReads: 3000 });
const r4 = await run(r1, { perQuery: 50, productsPerRun: 1, backfillDays: 21 }, { x: x4, haiku, githubStats, log, now: T0 + 48 * H });
assert.equal(r4.results.length, 4);

console.log(`ok: ${r1.results.length} posts, ${firstReads} + ${x2.reads} X reads`);
for (const e of r2.results) console.log(`  ${String(e.reception.score).padStart(3)} ${e.reception.verdict.padEnd(13)} ${e.id} ${JSON.stringify(e.reception.parts)} ${e.reception.reasons.join("; ")}`);

if (a.html) {
  const root = new URL("../", import.meta.url);
  const [css, renderJs] = await Promise.all(["style.css", "render.js"].map(f => readFile(new URL(f, root), "utf8")));
  await writeFile(a.html, reportHtml({ css, renderJs, noteHtml: "Test data.", results: r2.results, info: { generated: "test" } }));
}

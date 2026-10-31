// Offline check of the whole pipeline: the real X client against a stubbed fetch, with
// fake Haiku and GitHub answers. Runs two scans two days apart and checks the verdicts.
//
//   node tools/test.mjs [--html out.html]
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { X, githubRepo } from "../x.js";
import { run } from "../pipeline.js";
import { repoStats, pickReadmeImage, pickReadmeLogo, downloadsOf } from "../github.js";
import { oauthHeader, postsToMake } from "../xpost.js";
import { parseAdd } from "../complaints.js";
import { reportHtml } from "../report.js";
import { score } from "../reception.js";
import { buildGroups } from "../groups.js";
import { Haiku } from "../haiku.js";

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
let complaintPosts = [];
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
    if (q.startsWith("#FlatteryRemove")) return pack(complaintPosts);
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
  async classify(list) { return new Map(list.map(e => [e.id, { category: "Design", original_clean: e.original || "" }])); },
  async match(list) { return new Map(list.map(e => [e.id, ""])); },
  async review(list) { return new Map(list.map(f => [f.id, { agree: f.rating !== "Don't touch", note: "checked" }])); },
  async name(list) { return new Map(list.map(e => [e.id, "Named " + e.id])); },
  async complaints(list) { return new Map(list.map(c => [c.id, !/spam/.test(c.text)])); },
  async newsletter(facts) { return { title: "Week", intro: "Intro", items: facts.items.slice(0, 2).map(i => ({ id: i.id, blurb: "b" })), outro: "Bye" }; },
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

// README screenshots: badges, logos and avatars are skipped; relative paths become raw URLs
assert.equal(pickReadmeImage('<img src="./logo.svg"> ![b](https://img.shields.io/x) ![Title](docs/shot.png)', "a/b"), "https://raw.githubusercontent.com/a/b/HEAD/docs/shot.png");
assert.equal(pickReadmeImage("![x](https://github.com/a/b/blob/main/s.png)", "a/b"), "https://raw.githubusercontent.com/a/b/main/s.png");
assert.equal(pickReadmeImage("no images here", "a/b"), null);
// Icons, downloads, suggestions and posting
assert.equal(pickReadmeLogo('<p align="center"><img src="assets/logo.png" width="120"></p> ![shot](docs/shot.png)', "a/b"), "https://raw.githubusercontent.com/a/b/HEAD/assets/logo.png");
assert.equal(pickReadmeLogo('![b](https://img.shields.io/x) ![shot](docs/shot.png)', "a/b"), null);
{
  const u = f => `https://github.com/a/b/releases/download/v1.0/${f}`;
  assert.deepEqual(downloadsOf([{ tagName: "v1.0", releaseAssets: { nodes: [
    { name: "App-1.0-x64.dmg" }, { name: "App-1.0-arm64.dmg" }, { name: "App-Setup.exe" }, { name: "App.exe.sha256" }, { name: "app.AppImage" }] } }], "a/b"),
    { Mac: u("App-1.0-arm64.dmg"), Windows: u("App-Setup.exe"), Linux: u("app.AppImage") });
  assert.deepEqual(downloadsOf([{ tagName: "v1.0", releaseAssets: { nodes: [
    { name: "p-windows-arm64.msi" }, { name: "p-windows-x64.msi" }, { name: "p-linux-aarch64.AppImage" }, { name: "p-linux-x86_64.AppImage" },
    { name: "p-macos-x64.dmg" }, { name: "p-macos-universal.dmg" }] } }], "a/b"),
    { Mac: u("p-macos-universal.dmg"), Windows: u("p-windows-x64.msi"), Linux: u("p-linux-x86_64.AppImage") });
}
assert.deepEqual(parseAdd({ id: "9", urls: ["https://x.com/bob/status/123", "https://github.com/a/b"], repos: ["a/b"] }), { ids: ["123"], repos: ["a/b"] });
// X's documented OAuth 1.0a example
assert.match(oauthHeader("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=" + encodeURIComponent("Hello Ladies + Gentlemen, a signed OAuth request!").replace(/!/g, "%21"),
  { apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
  { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958 }), /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
{
  const g = { id: "g1", code: "frabcde", status: "ok", project: "PhotoCraft", original_clean: "Adobe Photoshop", summary: "A free photo editor.",
    reception: { verdict: "well-received", score: 80, repo_counted: true }, github: { stars: 75400 }, history: [{ at: "2026-10-31", verdict: "well-received" }] };
  const todo = postsToMake([g], { newsletter: [{ date: "2026-10-27", title: "Big week", items: [{ name: "PhotoCraft" }] }] }, {}, { today: "2026-10-31" });
  assert.deepEqual(todo.map(t => t.key), ["news:2026-10-27", "loved:g1"]);
  assert.ok(todo.every(t => t.text.includes("flattery.sala.company") && t.text.length <= 300));
  assert.equal(postsToMake([g], {}, { "loved:g1": "2026-10-31" }, { today: "2026-10-31" }).length, 0);
}

// GitHub takes priority: a huge repo behind a tiny X post is loved; a scam flag still wins
const small = { created_at: new Date(T0 - 72 * H).toISOString(), author: { username: "ChrisTitusTech", followers: 100 }, repo: "ChrisTitusTech/winutil",
  metrics: { likes: 7, reposts: 0, replies: 1, quotes: 0, bookmarks: 1, views: 900 },
  github: { status: "ok", repo: "ChrisTitusTech/winutil", created: "2022-01-01", stars: 65300, downloads: 5700000, stars_history: [] } };
assert.equal(score(small, T0).verdict, "proven", "lots of stars but a quiet X post is proven, not loved");
assert.equal(score({ ...small, metrics: { ...small.metrics, likes: 400, reposts: 60 } }, T0).verdict, "well-received", "stars and a crowd is loved");
assert.equal(score({ ...small, sentiment: { positive: 1, neutral: 2, negative: 7, sampled: 10, flags: ["scam-or-malware"] } }, T0).verdict, "stay-away");
assert.equal(score({ ...small, github: { ...small.github, stars: 150, downloads: 0 } }, T0).verdict !== "too-early", true, "100+ stars is never new & untested");
// Someone else's famous repo lends no stars; a brand-new repo counts whoever shares it
const curator = { ...small, author: { username: "matchaman11", followers: 100 } };
assert.equal(score(curator, T0).verdict, "too-early");
assert.equal(score(curator, T0).repo_counted, false);
assert.equal(score({ ...curator, author_built_it: true, github: { ...small.github, stars: 900 } }, T0).repo_counted, true, "an author who says they built it owns a non-famous repo");
assert.equal(score({ ...curator, author_built_it: true }, T0).repo_counted, false, "but not a famous one");
assert.equal(score({ ...curator, github: { ...small.github, created: new Date(T0 - 30 * 864e5).toISOString().slice(0, 10) } }, T0).verdict, "proven");

// Red flags need two different accounts, and keep their replies as evidence
const hk = Object.create(Haiku.prototype);
hk.ask = async () => ({ labels: [{ n: 1, sentiment: "negative" }, { n: 2, sentiment: "negative" }, { n: 3, sentiment: "negative" }],
  flags: [{ flag: "scam-or-malware", examples: [1, 2] }, { flag: "overhyped", examples: [3, 4] }], summary: "s" });
const sent = await hk.sentiment({ author: { username: "x" }, text: "t" }, [
  { text: "malware!", kind: "reply", author: "a", url: "u1" }, { text: "virus", kind: "reply", author: "b", url: "u2" },
  { text: "meh", kind: "reply", author: "c", url: "u3" }, { text: "meh again", kind: "reply", author: "c", url: "u4" }]);
assert.deepEqual(sent.flags, ["scam-or-malware"], "one account repeating itself isn't a pattern");
assert.equal(sent.evidence["scam-or-malware"].length, 2);
assert.equal(sent.evidence["scam-or-malware"][0].url, "u1");
// Fewer than 15 replies: tone is low confidence and can't decide the rating
const few = { ...small, github: undefined, repo: null, metrics: { likes: 300, reposts: 50, replies: 10, quotes: 0, bookmarks: 20, views: 30000 },
  sentiment: { positive: 0, neutral: 2, negative: 8, sampled: 10, flags: [] } };
assert.equal(score(few, T0).confidence, "low");
assert.notEqual(score(few, T0).verdict, "stay-away");

// Run 1
const x = new X("token", log, { maxReads: 2000 });
const githubImage = async repo => repo === "alice/webshop" ? "https://raw.githubusercontent.com/alice/webshop/HEAD/shot.png" : null;
const r1 = await run(null, { perQuery: 50, productsPerRun: 1 }, { x, haiku, githubStats, githubImage, log, now: T0 });
const by = (r, id) => r.results.find(e => e.id === id);
assert.equal(r1.results.length, 4, "the non-clone is rejected");
assert.ok(r1.info.rejected.includes("p5"));
assert.equal(by(r1, "p1").reception.verdict, "well-received");
assert.equal(by(r1, "p1").product.name, "Photoshop");
assert.equal(by(r1, "p2").reception.verdict, "unconfirmed");
assert.equal(by(r1, "p3").reception.verdict, "stay-away");
assert.equal(by(r1, "p4").reception.verdict, "too-early");
assert.equal(by(r1, "p1").github.image, "https://raw.githubusercontent.com/alice/webshop/HEAD/shot.png");
assert.equal(by(r1, "p1").sentiment.sampled, 12, "the author's own reply isn't counted");
assert.ok(by(r1, "p1").reception.score > by(r1, "p3").reception.score);
const firstReads = x.reads;

// Run 2, two days later: p3 deleted, alice's stars grew
deleted = new Set(["p3"]);
stars = { ...stars, "alice/webshop": 3500 };
const x2 = new X("token", log, { maxReads: 2000 });
const r2 = await run({ ...r1, info: { ...r1.info } }, { perQuery: 50, productsPerRun: 1, rotate: 1, repoSearches: 0 }, { x: x2, haiku, githubStats, githubImage, log, now: T0 + 48 * H });
assert.equal(r2.results.length, 4, "nothing is dropped");
assert.equal(by(r2, "p3").status, "gone");
assert.equal(by(r2, "p3").text, "", "removed posts lose their text");
assert.equal(by(r2, "p1").github.stars_history.length, 2);
assert.ok(by(r2, "p1").github.image, "the screenshot survives the next GitHub check");
assert.ok(by(r2, "p1").snapshots["24h"], "24h checkpoint recorded");
assert.ok(x2.reads < firstReads, "known posts aren't searched again");
assert.equal(by(r2, "p1").history.length, 1, "a rating that doesn't change isn't repeated in the history");
assert.equal(by(r2, "p1").history[0].verdict, "well-received");

// Backfill: full-archive search adds the older popular post (the tiny p4 is skipped)
posts.p9 = oldPost;
const x3 = new X("token", log, { maxReads: 3000 });
const r3 = await run(r2, { perQuery: 50, productsPerRun: 1, backfillDays: 21, maxReactions: 40 }, { x: x3, haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(by(r3, "p9"), "backfill finds the older post");
assert.ok(by(r3, "p9").found_by.some(f => f.startsWith("backfill")));
assert.ok(reads.some(r => r.startsWith("/2/tweets/search/all?conversation_id:p9")), "old threads are read through the archive");
assert.ok(reads.some(r => r.includes('url:"github.com/alice/webshop"')), "known starred repos are searched by URL");

// Without full-archive access the run carries on
archiveRefused = true;
delete posts.p9;
const x4 = new X("token", log, { maxReads: 3000 });
const r4 = await run(r1, { perQuery: 50, productsPerRun: 1, backfillDays: 21 }, { x: x4, haiku, githubStats, log, now: T0 + 48 * H });
assert.equal(r4.results.length, 4);

// A named search judges posts about it again, even ones rejected before
const x5 = new X("token", log, { maxReads: 3000 });
const r5 = await run(r1, { perQuery: 50, productsPerRun: 0, search: ["Webshop"] }, { x: x5, haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(reads.some(r => r.includes('"Webshop" -is:retweet')), "the name is searched");
assert.ok(by(r5, "p1").found_by.includes("search: Webshop"));
const x6 = new X("token", log, { maxReads: 3000 });
await run(r1, { perQuery: 50, productsPerRun: 0, search: ["from:alice"] }, { x: x6, haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(reads.some(r => r.endsWith("?from:alice -is:retweet")), "X operators are passed through as typed");

// Posts about the same project merge: same name across posts, and a name joins its repo
const mkp = (id, project, likes, repo) => ({ id, project, repo, status: "ok", url: "u" + id, created_at: new Date(T0 - 50 * H).toISOString(),
  author: { username: "a" + id, followers: 10 }, metrics: { likes, reposts: 0, replies: 0, quotes: 0, bookmarks: 0, views: 0 }, found_by: [],
  github: repo ? { status: "ok", repo, created: "2026-10-01", stars: 5000, downloads: 0, stars_history: [] } : undefined });
const gposts = [mkp("g1", "ArtCraft", 100), mkp("g2", "Artcraft", 30), mkp("g3", "PhotoCraft", 5), mkp("g4", "photocraft", 2, "storytold/photocraft"),
  mkp("g5", "Discord clone", 50), mkp("g6", "Discord clone", 40)];
for (const e of gposts) e.reception = score(e, T0);
const gs = buildGroups(gposts, [], "2026-10-30", T0);
const gby = name => gs.find(g => g.posts.some(p => p.id === name));
assert.equal(gby("g1").posts.length, 2, "ArtCraft posts merge");
assert.equal(gby("g1").metrics.likes, 130, "their likes add up");
assert.equal(gby("g3"), gby("g4"), "a name joins the repo of the same name");
assert.equal(gby("g3").repo, "storytold/photocraft");
assert.notEqual(gby("g5"), gby("g6"), "generic names never merge");
// Stray posts about a suite join it; posts with their own repo don't
const suite = [mkp("s1", "ArtCraft", 10), mkp("s2", "ArtCraft", 5), mkp("s3", "Artcraft", 1),
  { ...mkp("s4", "PhotoCraft, VectorCraft, FilmCraft", 0), text: "ArtCraft released three apps" },
  { ...mkp("s5", "ArtCraft Launcher", 0), text: "How to install the ArtCraft launcher" },
  { ...mkp("s6", "EffectCraft", 0), text: "We tested EffectCraft from ArtCraft" },
  { ...mkp("s7", "CADCraft", 4, "storytold/cadcraft"), text: "CADCraft from @get_artcraft" }];
for (const e of suite) e.reception = score(e, T0);
const sg = buildGroups(suite, [], "2026-10-30", T0);
const art = sg.find(g => g.posts.some(p => p.id === "s1"));
assert.deepEqual(art.posts.map(p => p.id).sort(), ["s1", "s2", "s3", "s4", "s5", "s6"]);
assert.ok(!art.posts.some(p => p.id === "s7"), "a post with its own repo keeps its own card");
// Stray posts that lead with an existing project's name join it
const lead = [mkp("l1", "PhotoCraft", 5, "storytold/photocraft"), mkp("l2", "PhotoCraft web version", 0), mkp("l3", "PhotoCraft, VectorCraft, FilmCraft", 0)];
for (const e of lead) e.reception = score(e, T0);
assert.equal(buildGroups(lead, [], "2026-10-30", T0).length, 1);
assert.ok(r1.groups.length >= 1 && r1.groups.every(g => g.reception && g.history.length));

// The week's newsletter is written from rating changes
assert.ok(r1.info.newsletter?.length === 1 && r1.info.newsletter[0].items.length === 2, "a newsletter issue is written");
assert.ok(by(r1, "p1").category, "new entries get a category");
assert.ok(r1.groups.every(g => g.code && g.code.startsWith("fr")), "every card has an objection code");

// Six spread-out objections from established accounts take a listing down; a burst doesn't
const { postCode, parseCode } = await import("../complaints.js");
assert.equal(parseCode("I vibe coded this with friends"), null, "a word starting with fr isn't a code");
assert.equal(parseCode("bad listing #FlatteryRemove frabc12"), "frabc12".slice(0, 7));
const code = postCode("p1");
for (let i = 0; i < 8; i++) users["c" + i] = { id: "c" + i, username: "critic" + i, created_at: "2020-01-01T00:00:00Z", public_metrics: { followers_count: 100 } };
complaintPosts = Array.from({ length: 6 }, (_, i) => ({ ...post("k" + i, "c" + i, `Please remove "Proj p1" from Flattery: this listing is wrong, reason number ${i} is real #FlatteryRemove ${code}`, 60 - i * 0.5, metrics(0, 0, 0, 0, 0)) }));
const x7 = new X("token", log, { maxReads: 3000 });
const r7 = await run(r1, { perQuery: 50, productsPerRun: 0, repoSearches: 0 }, { x: x7, haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(!r7.groups.some(g => g.posts.some(p => p.id === "p1")), "the listing is taken down");
assert.equal(r7.info.removed_projects.at(-1).objections, 6);
complaintPosts = Array.from({ length: 6 }, (_, i) => ({ ...post("b" + i, "c" + i, `Remove this listing now please, burst number ${i} of complaints here #FlatteryRemove ${postCode("p2")}`, 10, metrics(0, 0, 0, 0, 0)) }));
const r8 = await run(r1, { perQuery: 50, productsPerRun: 0, repoSearches: 0 }, { x: new X("token", log, { maxReads: 3000 }), haiku, githubStats, log, now: T0 + 48 * H });
assert.ok(r8.groups.some(g => g.posts.some(p => p.id === "p2")), "a burst of objections at the same time doesn't");
assert.equal(r8.groups.find(g => g.posts.some(p => p.id === "p2")).objections, 2);
complaintPosts = [];

// Old posts that never got going "didn't catch on"; a serious flag against a loved, starred
// project is disputed (Mixed), not Don't touch
assert.equal(score({ ...small, github: undefined, repo: null, created_at: new Date(T0 - 20 * 864e5).toISOString() }, T0).verdict, "faded");
assert.equal(score({ ...small, github: undefined, repo: null }, T0).verdict, "too-early");
const loved = { ...small, metrics: { likes: 400, reposts: 60, replies: 30, quotes: 2, bookmarks: 40, views: 40000 },
  sentiment: { positive: 16, neutral: 2, negative: 2, sampled: 20, flags: ["stolen-code"] } };
assert.equal(score(loved, T0).verdict, "mixed");
assert.equal(score(loved, T0).disputed, true);
assert.equal(score({ ...loved, github: undefined, repo: null }, T0).verdict, "stay-away", "without real GitHub use the flag still decides");
// Version numbers don't split a project: "Open Duet 2.0" and "Open-Duet" are one card
{
  const dup = [mkp("d1", "Open Duet 2.0", 200), mkp("d2", "Open-Duet", 30)];
  for (const e of dup) e.reception = score(e, T0);
  assert.equal(buildGroups(dup, [], "2026-10-30", T0).length, 1);
}
// A curator's reach counts at half weight once they post 3+ projects that aren't theirs
{
  const cur = ["x1", "x2", "x3"].map((id, i) => ({ ...mkp(id, "Thing " + i + " app", 100), author: { id: "cur", username: "curator", followers: 10 } }));
  for (const e of cur) e.reception = score(e, T0);
  assert.equal(buildGroups(cur, [], "2026-10-30", T0).find(g => g.posts[0].id === "x1").metrics.likes, 50);
}

// A reposter sharing a famous project's own repo keeps the repo, and its stars count (the repo
// is the project); a famous repo that isn't the project (Linux behind "Ginux") is dropped
{
  const famous = (id, project, repo) => {
    const e = { ...mkp(id, project, 40, repo), author: { username: "reposter", followers: 10 }, author_built_it: false };
    e.github = { ...e.github, stars: 25000, created: "2024-01-01" };
    e.reception = score(e, T0);
    return e;
  };
  const vb = buildGroups([famous("v1", "Voicebox", "jamiepine/voicebox")], [], "2026-10-30", T0)[0];
  assert.equal(vb.repo, "jamiepine/voicebox", "the project's own repo stays on its card");
  assert.equal(vb.reception.repo_counted, true, "its stars count: the repo is the project itself");
  assert.ok(["proven", "well-received"].includes(vb.reception.verdict), "25k stars make it proven or loved");
  const xl = famous("v3", "Excel", "someone/excel");
  xl.original_clean = "Microsoft Excel"; xl.original = "Excel";
  assert.equal(score(xl, T0).repo_counted, false, "a project named after the app it clones doesn't count as the repo's own");
  const gx = buildGroups([famous("v2", "Ginux", "torvalds/linux")], [], "2026-10-30", T0)[0];
  assert.equal(gx.repo, null, "an unrelated famous repo is dropped");
  assert.equal(gx.foreign_repo, "torvalds/linux");
}

// A serious flag judged under older rules is read again, even when replies haven't grown
{
  const old = JSON.parse(JSON.stringify(r1));
  const p1 = old.results.find(e => e.id === "p1");
  p1.sentiment = { ...p1.sentiment, flags: ["stolen-code"], at: new Date(T0).toISOString() };
  delete p1.sentiment.v;
  const before = reads.length;
  await run(old, { perQuery: 50, productsPerRun: 0, repoSearches: 0 }, { x: new X("token", log, { maxReads: 3000 }), haiku, githubStats, log, now: T0 + 2 * H });
  assert.ok(reads.slice(before).some(r => r.includes("conversation_id:p1")), "the flagged post's replies are read again");
}

// The second opinion can overrule a Don't touch verdict, and it's remembered
{
  const g3 = r1.groups.find(g => g.posts.some(p => p.id === "p3"));
  assert.equal(g3.reception.verdict, "mixed", "the reviewer disagreed with Don't touch");
  assert.ok(g3.second_opinion && !g3.second_opinion.agree);
  assert.ok(Object.keys(r1.info.second_opinions).some(k => k.endsWith("|stay-away")));
}

// Hacker News / Reddit posts go through the same triage and get their comments read
{
  const hn = { id: "hn:42", conversation_id: "hn:42", source: "hn", url: "https://news.ycombinator.com/item?id=42", text: "Show HN: I rebuilt Figma in Rust",
    created_at: new Date(T0 - 30 * H).toISOString(), lang: "en", author: { id: "hn:pg", username: "pg", followers: 0 },
    metrics: { likes: 300, reposts: 0, replies: 80, quotes: 0, bookmarks: 0, views: 0 }, urls: [], repos: [], is_reply_or_repost: false };
  const asked = [];
  const sources = {
    async search() { return [hn]; },
    async refresh(list) { asked.push(...list.map(e => e.id)); return new Map(); },
    async comments() { return Array.from({ length: 6 }, (_, i) => ({ text: "amazing", kind: "reply", author: "u" + i, url: "c" + i })); },
  };
  const r9 = await run(r1, { perQuery: 50, productsPerRun: 0, repoSearches: 0 }, { x: new X("token", log, { maxReads: 3000 }), haiku, githubStats, sources, log, now: T0 + 2 * H });
  const e = r9.results.find(e => e.id === "hn:42");
  assert.ok(e, "the Hacker News post is in the catalog");
  assert.equal(e.url, "https://news.ycombinator.com/item?id=42");
  assert.equal(e.sentiment.sampled, 6, "its comments were read");
  const r10 = await run(r9, { perQuery: 50, productsPerRun: 0, repoSearches: 0 }, { x: new X("token", log, { maxReads: 3000 }), haiku, githubStats, sources, log, now: T0 + 4 * H });
  assert.ok(asked.includes("hn:42"), "known Hacker News posts are refreshed through their own API");
  assert.ok(!reads.some(r => r.includes("hn%3A42") || r.includes("hn:42")), "and never through X");
  assert.ok(r10.results.find(e => e.id === "hn:42"));
}

console.log(`ok: ${r1.results.length} posts, ${firstReads} + ${x2.reads} X reads`);
for (const e of r2.results) console.log(`  ${String(e.reception.score).padStart(3)} ${e.reception.verdict.padEnd(13)} ${e.id} ${JSON.stringify(e.reception.parts)} ${e.reception.reasons.join("; ")}`);

if (a.html) {
  const root = new URL("../", import.meta.url);
  const [css, renderJs] = await Promise.all(["style.css", "render.js"].map(f => readFile(new URL(f, root), "utf8")));
  await writeFile(a.html, reportHtml({ css, renderJs, noteHtml: "Test data.", results: r2.results, info: { generated: "test" } }));
}

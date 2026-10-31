// Merges posts about the same project into one catalog entry ("group"), so a project that
// many people posted about (ArtCraft: dozens of reviews in several languages) gets one card
// with everyone's reactions added up. Posts join a group when they link the same repo, or
// name the same specific project; a name also joins the repo of the same name
// ("PhotoCraft" ↔ storytold/photocraft). Generic names ("Discord clone") never merge.
// A suite many people post about without a repo (ArtCraft) then also takes in stray posts
// that mention it and have no repo of their own: posts listing several of its apps
// ("PhotoCraft, VectorCraft, FilmCraft"), extensions of its name ("ArtCraft Launcher"), and
// lone posts about one of its apps ("EffectCraft"). Remaining stray posts without a repo join
// an existing project they lead with ("PhotoCraft web version", "PhotoCraft, VectorCraft…").
import { score, FAMOUS } from "./reception.js";

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const GENERIC = /clone|alternative|copy|replacement|version|untitled/;

const mode = list => {
  const n = new Map();
  for (const v of list) if (v) n.set(v, (n.get(v) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
};

export function nameKey(e) {
  const n = norm(e.project);
  if (n.length < 5 || GENERIC.test(n) || n === norm(e.original) || n === norm(e.product?.name)) return null;
  return n;
}

// posts: per-post entries, already scored. prevGroups: last run's groups, for history.
// overrides (overrides.json): attach post ids to a project, keep some separate, hide some.
// removed: post ids taken down after objections (complaints.js).
export function buildGroups(posts, prevGroups = [], today = new Date().toISOString().slice(0, 10), now = Date.now(), overrides = {}, removed = new Set()) {
  const hidden = new Set(overrides.hide || []), separate = new Set(overrides.separate || []);
  posts = posts.filter(e => !hidden.has(e.id) && !removed.has(e.id))
    // A famous repo the poster doesn't own (Linux, Expo…) never becomes the card's subject:
    // the post keeps its own project name without the repo, or leaves the page if it has none
    .map(e => e.github && e.github.status !== "gone" && e.reception && !e.reception.repo_counted && e.github.stars >= FAMOUS
      ? { ...e, foreign_repo: e.repo, repo: null, github: undefined, repos: [] } : e)
    .filter(e => !e.foreign_repo || nameKey(e) || (e.project && !/\//.test(e.project)));
  // Union-find over post ids
  const parent = new Map(posts.map(e => [e.id, e.id]));
  const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
  const byKey = new Map();
  const link = (key, id) => byKey.has(key) ? join(byKey.get(key), id) : byKey.set(key, id);
  for (const e of posts) {
    if (separate.has(e.id)) continue;
    const to = overrides.attach?.[e.id];
    if (to) link(to.includes("/") ? "repo:" + to.toLowerCase() : "name:" + norm(to), e.id);
    const repo = e.repo?.toLowerCase();
    if (repo) {
      link("repo:" + repo, e.id);
      const rn = norm(repo.split("/")[1]);
      if (rn.length >= 5 && !GENERIC.test(rn)) link("name:" + rn, e.id);
    }
    const n = nameKey(e);
    if (n) link("name:" + n, e.id);
  }

  // Suites: name-only groups (no repo) of 3+ posts
  const size = new Map(), hasRepo = new Set();
  for (const e of posts) { const r = find(e.id); size.set(r, (size.get(r) || 0) + 1); if (e.repo) hasRepo.add(r); }
  const suites = new Map(); // name key -> root id
  for (const e of posts) {
    const r = find(e.id), n = nameKey(e);
    if (n && size.get(r) >= 3 && !hasRepo.has(r) && !suites.has(n)) suites.set(n, r);
  }
  for (const e of posts) {
    if (e.repo || !suites.size || separate.has(e.id) || overrides.attach?.[e.id]) continue;
    const r = find(e.id);
    if (size.get(r) !== 1) continue; // already part of a project
    const own = norm(e.project), text = norm(e.text);
    const multi = String(e.project || "").split(/,|\band\b|&|\//i).filter(x => norm(x).length >= 3).length >= 2;
    for (const [k, root] of suites) {
      if (find(root) === r) continue;
      if ((own.startsWith(k) || multi || text.includes(k)) && (text.includes(k) || own.includes(k))) { join(root, e.id); break; }
    }
  }

  // Stray posts that lead with an existing project's name
  const index = new Map(); // name key -> root, for projects of 2+ posts or with a repo
  const grown = new Map();
  for (const e of posts) grown.set(find(e.id), (grown.get(find(e.id)) || 0) + 1);
  for (const e of posts) {
    const r = find(e.id);
    if (grown.get(r) < 2 && !e.repo) continue;
    const n = nameKey(e);
    if (n && !index.has(n)) index.set(n, r);
    const rn = norm(e.repo?.split("/")[1]);
    if (rn.length >= 5 && !GENERIC.test(rn) && !index.has(rn)) index.set(rn, r);
  }
  for (const e of posts) {
    const r = find(e.id);
    if (e.repo || grown.get(r) !== 1 || separate.has(e.id) || overrides.attach?.[e.id]) continue;
    const first = norm(String(e.project || "").split(/,|،|\band\b|&|\//i)[0]);
    const own = norm(e.project);
    let target = index.get(first), best = 0;
    if (!target) for (const [k, root] of index) if (k.length >= 5 && k.length > best && own.startsWith(k)) { target = root; best = k.length; }
    if (target && find(target) !== r) join(target, e.id);
  }

  const members = new Map();
  for (const e of posts) {
    const r = find(e.id);
    if (!members.has(r)) members.set(r, []);
    members.get(r).push(e);
  }

  const prev = new Map(prevGroups.map(g => [g.id, g]));
  const groups = [];
  for (const list of members.values()) {
    const live = list.filter(e => e.status !== "gone");
    const pool = live.length ? live : list;
    const lead = [...pool].sort((a, b) => b.metrics.likes - a.metrics.likes)[0];
    // The poster's own repo, if any post has one; the most starred wins
    const own = pool.filter(e => e.github && e.github.status !== "gone" && e.reception?.repo_counted)
      .sort((a, b) => b.github.stars - a.github.stars)[0];
    const anyRepo = own || pool.find(e => e.repo);
    // One post per account counts toward the numbers (its most liked), so a curator posting
    // the same project five times doesn't inflate it
    const best = new Map();
    for (const e of pool) {
      const who = e.author?.id || e.author?.username || e.id;
      if (!best.has(who) || e.metrics.likes > best.get(who).metrics.likes) best.set(who, e);
    }
    const counted = [...best.values()];
    const sum = k => counted.reduce((s, e) => s + (e.metrics[k] || 0), 0);
    const sentiments = pool.map(e => e.sentiment).filter(s => s?.sampled);
    const names = new Map();
    for (const e of pool) {
      const to = overrides.attach?.[e.id];
      const n = e.project || (to && !to.includes("/") ? to : "");
      if (n) names.set(n, (names.get(n) || 0) + e.metrics.likes + 1);
    }
    const project = [...names].sort((a, b) => b[1] - a[1])[0]?.[0] || lead.project;
    const key = anyRepo?.repo ? "repo:" + anyRepo.repo.toLowerCase() : nameKey(lead) ? "name:" + nameKey(lead) : "post:" + lead.id;
    const id = list.length > 1 ? key : lead.id;
    const g = {
      ...lead,
      id,
      group: list.length > 1,
      project,
      status: live.length ? "ok" : "gone",
      created_at: pool.map(e => e.created_at).sort()[0],
      metrics: { likes: sum("likes"), reposts: sum("reposts"), replies: sum("replies"), quotes: sum("quotes"), bookmarks: sum("bookmarks"), views: sum("views") },
      repo: anyRepo?.repo || null,
      github: anyRepo?.github,
      repo_owned: own ? true : undefined,
      sentiment: sentiments.length ? {
        positive: sentiments.reduce((s, x) => s + x.positive, 0),
        neutral: sentiments.reduce((s, x) => s + x.neutral, 0),
        negative: sentiments.reduce((s, x) => s + x.negative, 0),
        sampled: sentiments.reduce((s, x) => s + x.sampled, 0),
        flags: [...new Set(sentiments.flatMap(x => x.flags || []))],
        evidence: Object.assign({}, ...sentiments.map(x => x.evidence || {})),
        summary: [...sentiments].sort((a, b) => b.sampled - a.sampled)[0].summary,
      } : undefined,
      found_by: [...new Set(list.flatMap(e => e.found_by || []))],
      category: mode(pool.map(e => e.category)),
      original_clean: mode(pool.map(e => e.original_clean)) || lead.original_clean,
      first_seen: list.map(e => e.first_seen).filter(Boolean).sort()[0],
      posts: [...list].sort((a, b) => b.metrics.likes - a.metrics.likes).map(e => ({
        id: e.id, url: e.url, author: e.author?.username, likes: e.metrics.likes, created_at: e.created_at,
        text: (e.text || "").slice(0, 160), status: e.status, verdict: e.reception?.verdict,
      })),
    };
    delete g.history;
    g.reception = score(g, now);
    const h = [...(prev.get(id)?.history || (list.length === 1 ? lead.history : null) || [])];
    if (h.at(-1)?.verdict !== g.reception.verdict) {
      h.push({ at: today, verdict: g.reception.verdict, score: g.reception.score });
      if (h.length > 20) h.splice(0, h.length - 20);
    }
    g.history = h;
    groups.push(g);
  }
  return groups.sort((a, b) => b.reception.score - a.reception.score || b.metrics.likes - a.metrics.likes);
}

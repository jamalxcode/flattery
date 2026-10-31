// One Flattery run: X finds the posts, Haiku sorts and reads them, GitHub confirms them.
// Each run builds on the previous catalog, so nothing found is ever dropped:
//   1. refresh   new metrics for known posts (100 per request): every run in their first
//                week, daily up to 30 days, then weekly for good; deleted posts are kept,
//                marked removed, and their text dropped, as X's terms require
//   2. discover  recent search: generic queries every run, product queries in turn,
//                each continuing from the newest post it saw last time (since_id)
//   3. triage    Haiku keeps only posts announcing a clone, reverse-engineered or
//                reimagined version of existing software
//   4. react     replies and quote posts of posts with enough reach, read by Haiku;
//                re-read when replies have grown, while X's 7-day search still covers them
//   5. confirm   stars, downloads and star growth of each linked GitHub repo
//   6. score     reception score and verdict (reception.js)
import { BudgetError, ArchiveError } from "./x.js";
import { score, reached } from "./reception.js";
import { detectProduct, matchProduct, PRODUCT_QUERIES, PRODUCT_GROUP_QUERIES } from "./products.js";

const CLONE_WORDS = '(clone OR reimplementation OR "reverse engineered" OR "open source alternative" OR rebuilt OR recreated OR "from scratch")';
export const GENERIC_QUERIES = [
  `url:github.com ${CLONE_WORDS} -is:retweet -is:reply`,
  `url:github.com ("I built" OR "I made" OR "we built") (clone OR alternative OR replacement) -is:retweet -is:reply`,
  `("reverse engineered" OR "clean-room" OR "clean room") (open source OR github) has:links -is:retweet -is:reply`,
  `("vibe coded" OR "built with Claude" OR "built with Cursor") (clone OR alternative OR rebuilt) has:links -is:retweet -is:reply`,
];
const CHECKPOINTS = [["1h", 1], ["24h", 24], ["7d", 168]];
const REPLY_WINDOW_H = 6.5 * 24; // recent search only reaches 7 days back
const WEEK = 7 * 864e5;

const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

export async function run(prev, opts, { x, haiku, githubStats, log, now = Date.now() }) {
  const nowIso = iso(now), today = nowIso.slice(0, 10);
  const ageH = e => (now - Date.parse(e.created_at)) / 36e5;
  const outOfTime = () => opts.deadline && Date.now() > opts.deadline;
  const fromX = prev?.info?.source === "x";
  const catalog = new Map(fromX ? prev.results.map(e => [e.id, e]) : []);
  const sinceIds = { ...(fromX && prev.info.since_ids) };
  const rejected = new Set(fromX ? prev.info.rejected || [] : []);
  // Whether full-archive search worked last time; a refusal is retried after a week
  let archiveState = fromX ? prev.info.archive : undefined;
  let canArchive = !(archiveState?.ok === false && now - Date.parse(archiveState.checked) < WEEK);
  const counts = { refreshed: 0, removed: 0, searched: 0, candidates: 0, added: 0, rejected: 0, reactions: 0, repos: 0 };

  const setMetrics = (e, p) => {
    e.metrics = p.metrics;
    e.author = p.author;
    e.metrics_at = nowIso;
    for (const [k, h] of CHECKPOINTS) if (ageH(e) >= h && !e.snapshots?.[k]) (e.snapshots ||= {})[k] = { at: nowIso, ...p.metrics };
  };

  try {
    // 1. Refresh
    const due = [...catalog.values()].filter(e => e.status !== "gone" &&
      (ageH(e) < 8 * 24 || (ageH(e) < 30 * 24 && now - Date.parse(e.metrics_at) > 24 * 36e5) || now - Date.parse(e.metrics_at) > WEEK));
    if (due.length) {
      const { posts, gone } = await x.lookup(due.map(e => e.id));
      for (const p of posts) { setMetrics(catalog.get(p.id), p); counts.refreshed++; }
      for (const id of gone) {
        const e = catalog.get(id);
        if (!e) continue;
        e.status = "gone";
        e.gone_since = today;
        e.text = "";
        counts.removed++;
      }
      log(`refresh: ${counts.refreshed} of ${due.length} posts updated, ${counts.removed} removed`);
    }

    // 2. Discover
    const per = opts.productsPerRun ?? 6;
    const start = ((opts.rotate ?? 0) * per) % PRODUCT_QUERIES.length;
    const queries = [...GENERIC_QUERIES, ...Array.from({ length: per }, (_, i) => PRODUCT_QUERIES[(start + i) % PRODUCT_QUERIES.length].q)];
    const fresh = new Map();
    for (const q of queries) {
      if (outOfTime()) break;
      const { posts, newest } = await x.search(q, { sinceId: sinceIds[q], max: opts.perQuery ?? 50 });
      counts.searched++;
      if (newest) sinceIds[q] = newest;
      for (const p of posts) {
        if (p.is_reply_or_repost) continue;
        const known = catalog.get(p.id);
        if (known) { known.found_by = [...new Set([...known.found_by, q])]; continue; }
        if (rejected.has(p.id)) continue;
        if (!fresh.has(p.id)) fresh.set(p.id, { ...p, found_by: [] });
        fresh.get(p.id).found_by.push(q);
      }
      log(`search: ${posts.length} posts for ${q.slice(0, 80)}${q.length > 80 ? "…" : ""}`);
    }

    // Backfill: full-archive search over the last N days, most popular first. Only posts
    // with some reach are kept, so a backfill fills the catalog with what people noticed.
    let archive = false;
    if (opts.backfillDays) {
      const startTime = iso(now - opts.backfillDays * 864e5);
      archive = true;
      let kept = 0;
      for (const q of [...GENERIC_QUERIES, ...PRODUCT_GROUP_QUERIES]) {
        if (outOfTime()) break;
        let posts;
        try {
          ({ posts } = await x.search(q, { archive: true, startTime, max: opts.backfillPerQuery ?? 100 }));
        } catch (err) {
          if (!(err instanceof ArchiveError)) throw err;
          log(`backfill stopped: ${err.message}`, "warn");
          archive = canArchive = false;
          archiveState = { ok: false, checked: today };
          break;
        }
        counts.searched++;
        for (const p of posts) {
          if (p.is_reply_or_repost || !reached(p.metrics) || rejected.has(p.id)) continue;
          const known = catalog.get(p.id);
          if (known) { known.found_by = [...new Set([...known.found_by, "backfill"])]; continue; }
          if (!fresh.has(p.id)) { fresh.set(p.id, { ...p, found_by: [] }); kept++; }
          fresh.get(p.id).found_by.push("backfill: " + q);
        }
        log(`backfill: ${posts.length} posts for ${q.slice(0, 80)}${q.length > 80 ? "…" : ""}`);
      }
      log(`backfill: ${kept} popular candidates from the last ${opts.backfillDays} days`);
    }
    counts.candidates = fresh.size;

    // 3. Triage
    if (fresh.size) {
      const verdicts = await haiku.triage([...fresh.values()]);
      for (const p of fresh.values()) {
        const t = verdicts.get(p.id);
        if (!t) continue; // not classified this run (refusal, error): seen again next time it turns up
        if (t.kind === "not-a-clone") { rejected.add(p.id); counts.rejected++; continue; }
        const { is_reply_or_repost, ...post } = p;
        catalog.set(p.id, {
          ...post,
          url: `https://x.com/${p.author.username || "i"}/status/${p.id}`,
          status: "ok",
          first_seen: today,
          metrics_at: nowIso,
          kind: t.kind,
          original: t.original,
          project: t.project,
          summary: t.summary,
          product: detectProduct(p.text, "") || matchProduct(t.original),
          repo: p.repos[0] || null,
        });
        setMetrics(catalog.get(p.id), p);
        counts.added++;
      }
      log(`triage: ${fresh.size} candidates, ${counts.added} clones, ${counts.rejected} not clones`);
    }

    // 4. Reactions (a backfill reads many more, since it brings in many popular posts at once).
    // In a post's first week: when replies have grown. After that, weekly when they've grown,
    // through full-archive search, so ratings can still change. Unread posts go first.
    const grown = (e, k) => e.metrics.replies + e.metrics.quotes >= k * (e.sentiment.reactions_at_sample || 0) + 3;
    const needReactions = [...catalog.values()].filter(e => e.status === "ok" && reached(e.metrics) && (ageH(e) < REPLY_WINDOW_H
      ? !e.sentiment || (now - Date.parse(e.sentiment.at) > 24 * 36e5 && grown(e, 1.3))
      : canArchive && (!e.sentiment || (now - Date.parse(e.sentiment.at) > WEEK && grown(e, 1.1)))))
      .sort((a, b) => (!b.sentiment - !a.sentiment) || b.metrics.likes - a.metrics.likes)
      .slice(0, opts.maxReactions ?? 10);
    for (const e of needReactions) {
      if (outOfTime()) break;
      const old = ageH(e) >= REPLY_WINDOW_H;
      if (old && !canArchive) continue;
      let replies;
      try {
        replies = (await x.replies(e, opts.repliesPerPost ?? 50, { archive: old })).posts;
        if (old) archiveState = { ok: true, checked: today };
      } catch (err) {
        if (!(err instanceof ArchiveError)) throw err;
        log(`older threads can't be re-read: ${err.message}`, "warn");
        canArchive = false;
        archiveState = { ok: false, checked: today };
        continue;
      }
      const quotes = e.metrics.quotes ? (await x.quotes(e, opts.quotesPerPost ?? 20)).posts : [];
      // The author's own replies aren't reception, but often carry the repo link
      const own = replies.filter(r => r.author.id === e.author.id);
      const repos = [...new Set([...e.repos, ...own.flatMap(r => r.repos)])];
      if (repos.length > e.repos.length) { e.repos = repos; e.repo ||= repos[0]; }
      const reactions = [
        ...replies.filter(r => r.author.id !== e.author.id).map(r => ({ text: r.text, kind: "reply" })),
        ...quotes.filter(q => q.author.id !== e.author.id).map(q => ({ text: q.text, kind: "quote" })),
      ];
      const s = await haiku.sentiment(e, reactions);
      if (s) {
        e.sentiment = { ...s, at: nowIso, reactions_at_sample: e.metrics.replies + e.metrics.quotes };
        counts.reactions++;
        log(`reactions: @${e.author.username} ${e.id}: +${s.positive} ~${s.neutral} -${s.negative}${s.flags.length ? " flags " + s.flags.join(",") : ""}`);
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetError)) throw err;
    log(`stopped reading X: ${err.message}`, "warn");
  }

  // 5. Confirm on GitHub
  const linked = [...catalog.values()].filter(e => e.repo && e.status === "ok");
  const names = [...new Set(linked.map(e => e.repo))];
  // A GitHub failure mustn't lose the X reads already paid for: keep the old stats this run
  let stats = new Map();
  if (names.length) {
    try { stats = await githubStats(names); } catch (err) { log(`github check failed: ${err.message}`, "warn"); }
    for (const e of linked) {
      const st = stats.get(e.repo);
      if (!st) continue;
      if (st.status === "gone") { e.github = { ...e.github, status: "gone", reason: st.reason, checked: nowIso }; continue; }
      const history = (e.github?.stars_history || []).filter(h => h.at.slice(0, 10) !== today);
      e.github = { ...st, checked: nowIso, stars_history: [...history, { at: nowIso, stars: st.stars }].slice(-30) };
      if (st.repo !== e.repo) { e.previous_repo = e.repo; e.repo = st.repo; }
    }
    counts.repos = stats.size;
    log(`github: ${stats.size} of ${names.length} repos checked`);
  }

  // 6. Score
  // and keep each change of rating, so the page can show what was promoted or demoted
  let changed = 0;
  for (const e of catalog.values()) {
    e.reception = score(e, now);
    const h = e.history ||= [];
    if (h.at(-1)?.verdict !== e.reception.verdict) {
      if (h.length) changed++;
      h.push({ at: today, verdict: e.reception.verdict, score: e.reception.score });
      if (h.length > 20) h.splice(0, h.length - 20);
    }
  }
  counts.changed = changed;
  if (changed) log(`ratings: ${changed} changed`);

  const results = [...catalog.values()].sort((a, b) => b.reception.score - a.reception.score || b.metrics.likes - a.metrics.likes);
  return {
    results,
    info: {
      source: "x",
      since_ids: sinceIds,
      rejected: [...rejected].slice(-5000),
      archive: archiveState,
      counts,
    },
  };
}

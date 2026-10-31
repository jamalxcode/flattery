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
//   7. group     posts about the same project merged into one entry (groups.js)
import { BudgetError, ArchiveError } from "./x.js";
import { score, reached } from "./reception.js";
import { buildGroups } from "./groups.js";
import { TAG, postCode, parseCode, tally } from "./complaints.js";
import { detectProduct, matchProduct, PRODUCT_QUERIES, PRODUCT_GROUP_QUERIES } from "./products.js";

const CLONE_WORDS = '(clone OR reimplementation OR "reverse engineered" OR "reverse engineer" OR "open source alternative" OR rebuilt OR recreated OR recreation OR "from scratch" OR tribute)';
export const GENERIC_QUERIES = [
  // Vibe-coded functional copies, tributes and white-room rebuilds of popular apps
  `("white room" OR "clean room" OR "reverse engineer" OR tribute OR homage OR "functional copy" OR "1:1 copy" OR "pixel perfect" OR recreation) (app OR clone OR "open source" OR github) has:links -is:retweet -is:reply`,
  `("vibe coded" OR "vibecoded" OR "vibe-coded") (clone OR copy OR "my own" OR rebuilt OR recreated OR tribute OR version) has:links -is:retweet -is:reply`,
  `url:github.com ${CLONE_WORDS} -is:retweet -is:reply`,
  `url:github.com ("I built" OR "I made" OR "we built") (clone OR alternative OR replacement) -is:retweet -is:reply`,
  `("reverse engineered" OR "clean-room" OR "clean room") (open source OR github) has:links -is:retweet -is:reply`,
  `("vibe coded" OR "built with Claude" OR "built with Cursor") (clone OR alternative OR rebuilt) has:links -is:retweet -is:reply`,
];
const CHECKPOINTS = [["1h", 1], ["24h", 24], ["7d", 168]];
const REPLY_WINDOW_H = 6.5 * 24; // recent search only reaches 7 days back
const WEEK = 7 * 864e5;

const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

export async function run(prev, opts, { x, haiku, githubStats, githubImage, log, now = Date.now() }) {
  const nowIso = iso(now), today = nowIso.slice(0, 10);
  const ageH = e => (now - Date.parse(e.created_at)) / 36e5;
  const outOfTime = () => opts.deadline && Date.now() > opts.deadline;
  const fromX = prev?.info?.source === "x";
  const catalog = new Map(fromX ? prev.results.map(e => [e.id, e]) : []);
  const sinceIds = { ...(fromX && prev.info.since_ids) };
  const rejected = new Set(fromX ? prev.info.rejected || [] : []);
  // The latest rejections, shown on the page so wrong ones can be spotted
  const rejectedSamples = fromX ? [...(prev.info.rejected_samples || [])] : [];
  const objections = fromX ? [...(prev.info.objections || [])] : [];
  // Whether full-archive search worked last time; a refusal is retried after a week
  let archiveState = fromX ? prev.info.archive : undefined;
  let canArchive = !(archiveState?.ok === false && now - Date.parse(archiveState.checked) < WEEK);
  const runInfo = {};
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

    // Named searches ("ArtCraft"): every original post about it from the last
    // searchDays days, popular first, whatever its reach; triage still decides
    for (const term of opts.search || []) {
      if (outOfTime()) break;
      // A plain name is searched as a phrase; X operators (from:echelon, url:…) as typed
      const q = /\b(from|to|url|has|is|lang|conversation_id|list|place):/i.test(term)
        ? (/-is:retweet/.test(term) ? term : `${term} -is:retweet`)
        : `"${term.replaceAll('"', "")}" -is:retweet -is:reply`;
      let posts;
      try {
        ({ posts } = await x.search(q, { archive: canArchive, startTime: canArchive ? iso(now - (opts.searchDays ?? 21) * 864e5) : undefined, max: opts.searchMax ?? 100 }));
      } catch (err) {
        if (!(err instanceof ArchiveError)) throw err;
        canArchive = false;
        archiveState = { ok: false, checked: today };
        ({ posts } = await x.search(q, { max: opts.searchMax ?? 100 }));
      }
      counts.searched++;
      let kept = 0;
      for (const p of posts) {
        if (p.is_reply_or_repost) continue;
        const known = catalog.get(p.id);
        if (known) { known.found_by = [...new Set([...known.found_by, `search: ${term}`])]; continue; }
        rejected.delete(p.id); // asked for by name: judge it again
        if (!fresh.has(p.id)) { fresh.set(p.id, { ...p, found_by: [] }); kept++; }
        fresh.get(p.id).found_by.push(`search: ${term}`);
      }
      log(`search for "${term}": ${posts.length} posts, ${kept} new candidates`);
    }

    // Watchlist: builders whose projects earned ❤️ or ⭐ (with their own repo) are checked every
    // run, so their next launch is caught on day one. Built from the catalog, nothing to maintain.
    const watchlist = [...new Set((fromX ? prev.groups || [] : [])
      .filter(g => g.status === "ok" && ["well-received", "proven"].includes(g.reception?.verdict) && g.reception?.repo_counted)
      .map(g => g.author?.username).filter(Boolean))].slice(0, 40);
    const watchFrom = iso(Math.max(now - WEEK + 36e5, Date.parse(fromX && prev.info.watch_at || 0)));
    for (let i = 0, chunk = []; i <= watchlist.length; i++) {
      const next = watchlist[i];
      const q = `(${[...chunk, next].filter(Boolean).map(u => "from:" + u).join(" OR ")}) -is:retweet -is:reply`;
      if (next && q.length < 480) { chunk.push(next); continue; }
      if (!chunk.length || outOfTime()) break;
      const { posts } = await x.search(`(${chunk.map(u => "from:" + u).join(" OR ")}) -is:retweet -is:reply`, { startTime: watchFrom, max: opts.watchMax ?? 50 });
      counts.searched++;
      for (const p of posts) {
        if (p.is_reply_or_repost || catalog.has(p.id) || rejected.has(p.id)) continue;
        if (!fresh.has(p.id)) fresh.set(p.id, { ...p, found_by: [] });
        fresh.get(p.id).found_by.push(`watchlist: @${p.author.username}`);
      }
      log(`watchlist: ${posts.length} posts from ${chunk.length} builders`);
      chunk = next ? [next] : [];
    }
    runInfo.watchlist = watchlist;
    runInfo.watch_at = nowIso;

    // Objections: "#FlatteryRemove <code>" posts from the page's Object button
    {
      const q = `#${TAG} -is:retweet`;
      const { posts, newest } = await x.search(q, { sinceId: sinceIds[q], max: 100 });
      if (newest) sinceIds[q] = newest;
      const fresh = posts.map(p => ({ id: p.id, code: parseCode(p.text), author_id: p.author.id, username: p.author.username,
        account_created: p.author.created_at, followers: p.author.followers, at: p.created_at, text: p.text.slice(0, 280) }))
        .filter(o => o.code && !objections.some(k => k.id === o.id));
      if (fresh.length) {
        const ok = await haiku.complaints(fresh);
        for (const o of fresh) objections.push({ ...o, reasonable: ok.get(o.id) === true });
        log(`objections: ${fresh.length} new, ${fresh.filter(o => ok.get(o.id)).length} with a real reason`);
      }
    }

    // Repo searches: posts linking a known, starred repo, to find its original announcement
    // and the real discussion, not only the curator post that brought it in. Weekly per repo.
    const repoSearched = { ...(fromX && prev.info.repo_searched) };
    const repos = [...new Map([...catalog.values()].filter(e => e.status === "ok" && e.repo && e.github?.stars >= 50 && e.github.status !== "gone")
      .map(e => [e.repo.toLowerCase(), e])).values()]
      .filter(e => !repoSearched[e.repo.toLowerCase()] || now - Date.parse(repoSearched[e.repo.toLowerCase()]) > WEEK)
      .sort((a, b) => b.github.stars - a.github.stars)
      .slice(0, opts.repoSearches ?? 5);
    for (const e of repos) {
      if (outOfTime()) break;
      const q = `url:"github.com/${e.repo}" -is:retweet`;
      let posts;
      try {
        ({ posts } = await x.search(q, { archive: canArchive, startTime: canArchive ? iso(now - 30 * 864e5) : undefined, max: opts.repoSearchMax ?? 50 }));
      } catch (err) {
        if (!(err instanceof ArchiveError)) throw err;
        canArchive = false;
        archiveState = { ok: false, checked: today };
        ({ posts } = await x.search(q, { max: opts.repoSearchMax ?? 50 }));
      }
      repoSearched[e.repo.toLowerCase()] = today;
      counts.searched++;
      let kept = 0;
      for (const p of posts) {
        if (p.is_reply_or_repost || catalog.has(p.id) || rejected.has(p.id)) continue;
        if (!fresh.has(p.id)) { fresh.set(p.id, { ...p, found_by: [] }); kept++; }
        fresh.get(p.id).found_by.push(`repo: ${e.repo}`);
      }
      log(`repo search ${e.repo}: ${posts.length} posts, ${kept} new candidates`);
    }
    runInfo.repo_searched = repoSearched;
    counts.candidates = fresh.size;

    // 3. Triage
    if (fresh.size) {
      const verdicts = await haiku.triage([...fresh.values()]);
      for (const p of fresh.values()) {
        const t = verdicts.get(p.id);
        if (!t) continue; // not classified this run (refusal, error): seen again next time it turns up
        if (t.kind === "not-a-clone") {
          rejected.add(p.id);
          counts.rejected++;
          if (p.metrics.likes >= 10) rejectedSamples.push({ id: p.id, url: `https://x.com/${p.author.username || "i"}/status/${p.id}`,
            author: p.author.username, likes: p.metrics.likes, text: p.text.slice(0, 200), at: today });
          continue;
        }
        const { is_reply_or_repost, ...post } = p;
        catalog.set(p.id, {
          ...post,
          url: `https://x.com/${p.author.username || "i"}/status/${p.id}`,
          status: "ok",
          first_seen: today,
          metrics_at: nowIso,
          kind: t.kind,
          original: t.original,
          original_clean: t.original_clean,
          category: t.category,
          author_built_it: t.author_built_it,
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

    // Posts that name no project and link no repo are matched to a known project, once
    // (e.g. a launch post that never says the project's name)
    const known = (fromX ? prev.groups || [] : []).filter(g => g.status === "ok" && g.project && (g.group || g.repo))
      .sort((a, b) => b.metrics.likes - a.metrics.likes).slice(0, 60).map(g => ({ name: g.project, summary: g.summary }));
    const unnamed = [...catalog.values()].filter(e => e.status === "ok" && !e.project && !e.repo && !e.match_checked).slice(0, 40);
    if (known.length && unnamed.length) {
      const m = await haiku.match(unnamed, known);
      for (const e of unnamed) {
        e.match_checked = today;
        if (m.get(e.id)) { e.project = m.get(e.id); e.matched = true; }
      }
      log(`matching: ${unnamed.filter(e => e.matched).length} of ${unnamed.length} unnamed posts matched to a project`);
    }
    // Categories and clean product names for entries from before they existed
    const unclassified = [...catalog.values()].filter(e => !e.category).slice(0, 100);
    if (unclassified.length) {
      const c = await haiku.classify(unclassified);
      for (const e of unclassified) if (c.get(e.id)) Object.assign(e, { category: c.get(e.id).category, original_clean: c.get(e.id).original_clean });
      log(`categories: ${c.size} of ${unclassified.length} classified`);
    }

    // 4. Reactions (a backfill reads many more, since it brings in many popular posts at once).
    // In a post's first week: when replies have grown. After that, weekly when they've grown,
    // through full-archive search, so ratings can still change. Unread posts go first.
    const priority = e => (e.reception?.repo_counted ? 1000 * Math.log10(1 + (e.github?.stars || 0)) : 0) + e.metrics.likes;
    const grown = (e, k) => e.metrics.replies + e.metrics.quotes >= k * (e.sentiment.reactions_at_sample || 0) + 3;
    const needReactions = [...catalog.values()].filter(e => e.status === "ok" && reached(e.metrics) && (ageH(e) < REPLY_WINDOW_H
      ? !e.sentiment || (now - Date.parse(e.sentiment.at) > 24 * 36e5 && grown(e, 1.3))
      : canArchive && (!e.sentiment || (now - Date.parse(e.sentiment.at) > WEEK && grown(e, 1.1)))))
      // Unread first; then the ones with real GitHub use, where the replies matter most
      .sort((a, b) => (!b.sentiment - !a.sentiment) || priority(b) - priority(a))
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
        ...replies.filter(r => r.author.id !== e.author.id).map(r => ({ text: r.text, kind: "reply", author: r.author.username, url: `https://x.com/${r.author.username || "i"}/status/${r.id}` })),
        ...quotes.filter(q => q.author.id !== e.author.id).map(q => ({ text: q.text, kind: "quote", author: q.author.username, url: `https://x.com/${q.author.username || "i"}/status/${q.id}` })),
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

  // overrides.json can give a post the repo it didn't link
  for (const [id, repo] of Object.entries(opts.overrides?.repo || {})) {
    const e = catalog.get(id);
    if (e && !e.repo) { e.repo = repo; e.repos = [...new Set([...(e.repos || []), repo])]; }
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
      const { image, image_checked } = e.github || {};
      e.github = { ...st, checked: nowIso, stars_history: [...history, { at: nowIso, stars: st.stars }].slice(-30), image, image_checked };
      if (st.repo !== e.repo) { e.previous_repo = e.repo; e.repo = st.repo; }
    }
    counts.repos = stats.size;
    log(`github: ${stats.size} of ${names.length} repos checked`);
  }

  // Card pictures: the first real image in each repo's README, looked up weekly
  if (githubImage) {
    const want = linked.filter(e => e.github && e.github.status !== "gone" &&
      (!e.github.image_checked || now - Date.parse(e.github.image_checked) > WEEK)).slice(0, opts.maxImages ?? 40);
    let found = 0;
    for (let i = 0; i < want.length; i += 8) {
      await Promise.all(want.slice(i, i + 8).map(async e => {
        const img = await githubImage(e.repo);
        if (img === undefined) return; // README unreachable: try again next run
        e.github.image = img;
        e.github.image_checked = nowIso;
        if (img) found++;
      }));
    }
    if (want.length) log(`images: ${found} of ${want.length} READMEs had a screenshot`);
  }

  // 6. Score (overrides.json can say whose a repo is)
  const owned = new Map(Object.entries(opts.overrides?.owned || {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const e of catalog.values()) {
    if (e.repo && owned.has(e.repo.toLowerCase())) e.repo_owned = owned.get(e.repo.toLowerCase());
    else delete e.repo_owned;
  }
  // and keep each change of rating, so the page can show what was promoted or demoted
  for (const e of catalog.values()) {
    e.reception = score(e, now);
    const h = e.history ||= [];
    if (h.at(-1)?.verdict !== e.reception.verdict) {
      h.push({ at: today, verdict: e.reception.verdict, score: e.reception.score });
      if (h.length > 20) h.splice(0, h.length - 20);
    }
  }

  // 8. Newsletter: "This week in clones", written by Haiku from the week's changes, weekly
  async function newsletter() {
    const issues = fromX ? [...(prev.info.newsletter || [])] : [];
    if (opts.newsletter === false || (issues[0] && now - Date.parse(issues[0].date) < WEEK - 6 * 36e5)) return issues;
    const since = iso(now - WEEK).slice(0, 10);
    const growth = g => {
      const h = g.github?.stars_history || [];
      const d = h.length > 1 ? (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5 : 0;
      return d >= 0.9 && g.reception.repo_counted ? Math.round((h.at(-1).stars - h[0].stars) / d) : 0;
    };
    const live = groups.filter(g => g.status === "ok");
    const changed = live.filter(g => g.reception.verdict !== "too-early" && g.history?.at(-1)?.at >= since);
    const rising = live.filter(g => growth(g) >= 5).sort((a, b) => growth(b) - growth(a)).slice(0, 3);
    const pick = [...new Map([...changed.sort((a, b) => b.reception.score - a.reception.score), ...rising].map(g => [g.id, g])).values()].slice(0, 12);
    if (pick.length < 2) return issues;
    const items = pick.map(g => ({ id: g.id, name: g.project || g.repo || "Untitled", verdict: g.reception.verdict,
      previous: g.history.length > 1 ? g.history.at(-2).verdict : null, likes: g.metrics.likes, posts: g.posts?.length || 1,
      stars: g.reception.repo_counted ? g.github?.stars : undefined, stars_a_day: growth(g) || undefined,
      clone_of: g.original_clean || g.original, summary: g.summary }));
    const removed = removedProjects.filter(r => r.at >= since).map(r => r.name);
    const nl = await haiku.newsletter({ week: `${since} to ${today}`, items, removed });
    if (!nl) return issues;
    const byId = new Map(items.map(i => [i.id, i]));
    issues.unshift({ date: today, title: nl.title, intro: nl.intro, outro: nl.outro,
      items: nl.items.map(i => ({ id: i.id, name: byId.get(i.id).name, verdict: byId.get(i.id).verdict, blurb: i.blurb })) });
    log(`newsletter: "${nl.title}" with ${nl.items.length} projects`);
    return issues.slice(0, 52);
  }

  const results = [...catalog.values()].sort((a, b) => b.reception.score - a.reception.score || b.metrics.likes - a.metrics.likes);
  // 7. Merge posts about the same project into one entry each; these are what the page shows
  // Listings taken down after enough objections stay down
  const removedIds = new Set(fromX ? prev.info.removed_ids || [] : []);
  const removedProjects = fromX ? [...(prev.info.removed_projects || [])] : [];
  const build = () => buildGroups(results, fromX ? prev.groups || [] : [], today, now, opts.overrides, removedIds);
  let groups = build();
  const tallies = tally(objections);
  let takenDown = 0;
  for (const g of groups) {
    g.code = postCode([...g.posts.map(p => p.id)].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]);
    const codes = new Set(g.posts.map(p => postCode(p.id)));
    const t = [...tallies].filter(([c]) => codes.has(c)).map(([, v]) => v).sort((a, b) => b.counted - a.counted)[0];
    g.objections = t?.counted || 0;
    if (t?.removed) {
      for (const p of g.posts) removedIds.add(p.id);
      removedProjects.push({ name: g.project || g.repo || "Untitled", at: today, objections: t.counted });
      takenDown++;
    }
  }
  if (takenDown) {
    log(`objections: ${takenDown} listings taken down`);
    const keep = new Map(groups.map(g => [g.id, { code: g.code, objections: g.objections }]));
    groups = build();
    for (const g of groups) Object.assign(g, keep.get(g.id) || { code: postCode(g.posts[0].id), objections: 0 });
  }
  counts.changed = groups.filter(g => g.history.length > 1 && g.history.at(-1).at === today).length;
  if (counts.changed) log(`ratings: ${counts.changed} projects changed`);
  log(`groups: ${results.length} posts about ${groups.length} projects`);
  return {
    results,
    groups,
    info: {
      source: "x",
      since_ids: sinceIds,
      rejected: [...rejected].slice(-5000),
      archive: archiveState,
      rejected_samples: rejectedSamples.slice(-60),
      repo_searched: runInfo.repo_searched || (fromX ? prev.info.repo_searched : undefined),
      watchlist: runInfo.watchlist || (fromX ? prev.info.watchlist : undefined),
      watch_at: runInfo.watch_at || (fromX ? prev.info.watch_at : undefined),
      objections: objections.slice(-3000),
      removed_ids: [...removedIds],
      removed_projects: removedProjects,
      newsletter: await newsletter(),
      counts,
    },
  };
}

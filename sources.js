// Hacker News and Reddit as extra sources, beside X. Their posts are shaped like X posts
// (points as likes, comment counts as replies) so triage, rating and merging treat them alike,
// and their comments are read for tone the same way as X replies. Both are free and keyless:
// Hacker News through its Algolia search API; Reddit through its public JSON, which often
// refuses requests from cloud servers. A source that fails is skipped for that run.
import { githubRepo } from "./x.js";

const HN = "https://hn.algolia.com/api/v1";
const UA = { "User-Agent": "flattery/1.0 (+https://flattery.sala.company)" };
const QUERIES = ["clone", "open source alternative", "open-source alternative to", "free alternative to", "reverse engineered", "reimplementation", "rewrite of", "vibe coded", "self-hosted alternative", "I rebuilt", "clean room"];
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function json(url, log) {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.ok) return res.json();
    log(`${new URL(url).hostname}: HTTP ${res.status}`, "warn");
  } catch (e) { log(`${new URL(url).hostname}: ${e.message}`, "warn"); }
  return null;
}

const post = ({ source, id, title, body, url, link, author, points, comments, created }) => {
  const urls = [link].filter(Boolean);
  return {
    id: `${source}:${id}`, conversation_id: `${source}:${id}`, source, url,
    text: [title, body, link].filter(Boolean).join("\n").slice(0, 2000),
    created_at: new Date(created).toISOString(), lang: "en",
    author: { id: `${source}:${author}`, username: author, name: author, followers: 0, verified: false, created_at: "" },
    metrics: { likes: points || 0, reposts: 0, replies: comments || 0, quotes: 0, bookmarks: 0, views: 0 },
    urls, repos: [...new Set(urls.map(githubRepo).filter(Boolean))], is_reply_or_repost: false,
  };
};

const hnPost = h => post({ source: "hn", id: h.objectID || h.id, title: h.title, body: strip(h.story_text || h.text), link: h.url,
  url: `https://news.ycombinator.com/item?id=${h.objectID || h.id}`, author: h.author, points: h.points, comments: h.num_comments ?? h.children?.length, created: h.created_at });

const redditPost = d => post({ source: "reddit", id: d.id, title: d.title, body: d.selftext, link: d.is_self ? "" : d.url,
  url: `https://www.reddit.com${d.permalink}`, author: d.author, points: d.score, comments: d.num_comments, created: d.created_utc * 1000 });

export function makeSources(log) {
  return {
    // New posts since `since` (ms), from both sources
    async search(since) {
      const out = [];
      for (const q of QUERIES) {
        const hn = await json(`${HN}/search_by_date?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${Math.floor(since / 1000)}&hitsPerPage=50`, log);
        out.push(...(hn?.hits || []).map(hnPost));
      }
      for (const q of ["open source alternative", "clone of", "I rebuilt", "reverse engineered"]) {
        const rd = await json(`https://www.reddit.com/search.json?q=${encodeURIComponent(`"${q}"`)}&sort=new&t=week&limit=50&type=link`, log);
        if (!rd) break; // blocked: skip Reddit for this run
        out.push(...(rd.data?.children || []).map(c => c.data).filter(d => d.created_utc * 1000 > since).map(redditPost));
      }
      return [...new Map(out.map(p => [p.id, p])).values()];
    },

    // Fresh points and comment counts for known posts: Map id -> post (missing = couldn't check)
    async refresh(entries) {
      const out = new Map();
      for (const e of entries) {
        const [src, id] = e.id.split(":");
        if (src === "hn") { const h = await json(`${HN}/items/${id}`, log); if (h?.id) out.set(e.id, hnPost(h)); }
        if (src === "reddit") {
          const r = await json(`https://www.reddit.com/by_id/t3_${id}.json`, log);
          const d = r?.data?.children?.[0]?.data;
          if (d) out.set(e.id, redditPost(d));
        }
      }
      return out;
    },

    // Comments, shaped like X reactions: [{ text, kind, author, url }]
    async comments(e, max = 50) {
      const [src, id] = e.id.split(":");
      const list = [];
      if (src === "hn") {
        const walk = n => { for (const c of n?.children || []) { if (c.text && c.author) list.push({ text: strip(c.text).slice(0, 600), kind: "reply", author: c.author, url: `https://news.ycombinator.com/item?id=${c.id}` }); walk(c); } };
        walk(await json(`${HN}/items/${id}`, log));
      }
      if (src === "reddit") {
        const r = await json(`https://www.reddit.com/comments/${id}.json?limit=${max}&sort=top`, log);
        const walk = cs => { for (const c of cs || []) { const d = c.data; if (d?.body && d.author) list.push({ text: d.body.slice(0, 600), kind: "reply", author: d.author, url: `https://www.reddit.com${d.permalink}` }); walk(d?.replies?.data?.children); } };
        walk(r?.[1]?.data?.children);
      }
      return list.filter(c => c.author !== e.author.username).slice(0, max);
    },
  };
}

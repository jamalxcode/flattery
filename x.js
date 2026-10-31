// X (Twitter) API v2 client for Flattery: finds posts announcing clones, reverse-engineered
// or reimagined versions of existing software, and fetches the reactions to them.
// Every post the API returns is a paid read, so the client counts them (`reads`) and
// stops once `maxReads` is spent. Recent search covers the last 7 days only, which is
// why the scheduled scan keeps everything it has found and re-checks it from the catalog.

const API = "https://api.x.com/2";
const POST_FIELDS = "created_at,public_metrics,conversation_id,entities,lang,author_id,referenced_tweets";
const USER_FIELDS = "username,name,public_metrics,verified,created_at,profile_image_url";

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class BudgetError extends Error {}
// Full-archive search (/2/tweets/search/all) isn't on every plan
export class ArchiveError extends Error {}

export class X {
  constructor(token, log, { maxReads = 500, maxWait = 60 } = {}) {
    this.token = token;
    this.log = log;
    this.maxReads = maxReads;
    this.maxWait = maxWait;
    this.reads = 0;
    this.calls = 0;
  }

  get left() { return this.maxReads - this.reads; }

  async get(path, params) {
    const url = API + path + "?" + new URLSearchParams(params);
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        this.calls++;
        res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      } catch {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (res.ok) {
        const body = await res.json();
        this.reads += body.data?.length || 0;
        return body;
      }
      if (res.status === 403 && path === "/tweets/search/all")
        throw new ArchiveError(`full-archive search not available (${res.status}): ${(await res.text()).slice(0, 200)}`);
      if (res.status === 401 || res.status === 403)
        throw new Error(`X rejected the request (${res.status}): ${(await res.text()).slice(0, 200)}`);
      if (res.status === 429) {
        const reset = +res.headers.get("x-rate-limit-reset");
        const wait = reset ? Math.max(1, reset - Math.floor(Date.now() / 1000) + 1) : 30;
        if (wait > this.maxWait) {
          this.log(`X rate limit for ${wait}s, skipping ${path}`, "warn");
          return null;
        }
        this.log(`X rate limit, waiting ${wait}s…`, "warn");
        await sleep(wait * 1000);
        continue;
      }
      if (res.status >= 500) { await sleep(2 ** attempt * 1000); continue; }
      this.log(`X HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`, "warn");
      return null;
    }
    return null;
  }

  // Pages through a list endpoint until `max` posts or the read budget runs out.
  async list(path, params, max) {
    const posts = [], users = new Map();
    let next, newest;
    while (posts.length < max) {
      if (this.left < 10) throw new BudgetError(`X read budget of ${this.maxReads} posts spent`);
      if (path === "/tweets/search/all" && this.calls) await sleep(1100); // full-archive search allows one request a second
      const n = Math.max(10, Math.min(100, max - posts.length, this.left));
      const body = await this.get(path, {
        ...params, max_results: n, "tweet.fields": POST_FIELDS, expansions: "author_id", "user.fields": USER_FIELDS,
        ...(next && { [path.includes("/search/") ? "next_token" : "pagination_token"]: next }),
      });
      if (!body) break;
      for (const u of body.includes?.users || []) users.set(u.id, u);
      posts.push(...(body.data || []));
      newest ||= body.meta?.newest_id;
      next = body.meta?.next_token;
      if (!next) break;
    }
    return { posts: posts.map(p => normalise(p, users)), newest };
  }

  // archive: full-archive search from startTime (an ISO date) instead of the last 7 days.
  search(query, { max = 100, sinceId, sort = "relevancy", archive = false, startTime } = {}) {
    // since_id and sort_order=relevancy can't be combined; with since_id only new posts come back anyway
    return this.list(archive ? "/tweets/search/all" : "/tweets/search/recent",
      { query, ...(sinceId ? { since_id: sinceId } : { sort_order: sort }), ...(startTime && { start_time: startTime }) }, max);
  }

  // Replies in the thread, the author's own included (they often post the repo link there).
  // Threads older than recent search's 7 days need full-archive search.
  replies(post, max = 50, { archive = false } = {}) {
    return this.search(`conversation_id:${post.id} is:reply`, { max, archive, ...(archive && { startTime: post.created_at }) });
  }

  quotes(post, max = 20) {
    return this.list(`/tweets/${post.id}/quote_tweets`, {}, max);
  }

  // Fresh metrics for known posts, 100 per request. Returns { posts, gone: Set(ids) }.
  async lookup(ids) {
    const posts = [], gone = new Set();
    for (let i = 0; i < ids.length; i += 100) {
      if (this.left < 10) break;
      const batch = ids.slice(i, i + 100);
      const body = await this.get("/tweets", { ids: batch.join(","), "tweet.fields": POST_FIELDS, expansions: "author_id", "user.fields": USER_FIELDS });
      if (!body) continue;
      const users = new Map((body.includes?.users || []).map(u => [u.id, u]));
      posts.push(...(body.data || []).map(p => normalise(p, users)));
      for (const e of body.errors || [])
        if (e.resource_type === "tweet" && /not-found|authorization|suspended/i.test(e.type || e.title || "")) gone.add(e.resource_id || e.value);
    }
    return { posts, gone };
  }
}

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i;
const NOT_OWNERS = new Set(["orgs", "features", "topics", "sponsors", "settings", "marketplace", "apps", "about", "pricing", "collections", "trending", "login", "search"]);

export function githubRepo(url) {
  const m = (url || "").match(GITHUB_URL);
  if (!m || NOT_OWNERS.has(m[1].toLowerCase())) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

function normalise(p, users) {
  const u = users.get(p.author_id) || {};
  const m = p.public_metrics || {};
  const urls = (p.entities?.urls || []).map(x => x.unwound_url || x.expanded_url || x.url).filter(Boolean);
  return {
    id: p.id,
    conversation_id: p.conversation_id,
    text: (p.text || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), // X sends these escaped
    created_at: p.created_at,
    lang: p.lang,
    author: { id: p.author_id, username: u.username || "", name: u.name || "", followers: u.public_metrics?.followers_count || 0, verified: !!u.verified, created_at: u.created_at || "",
      avatar: /^https:\/\/pbs\.twimg\.com\//.test(u.profile_image_url || "") ? u.profile_image_url.replace(/_normal(\.\w+)$/, "_200x200$1") : "" },
    metrics: { likes: m.like_count || 0, reposts: m.retweet_count || 0, replies: m.reply_count || 0, quotes: m.quote_count || 0, bookmarks: m.bookmark_count || 0, views: m.impression_count || 0 },
    urls,
    repos: [...new Set(urls.map(githubRepo).filter(Boolean))],
    is_reply_or_repost: (p.referenced_tweets || []).some(r => r.type === "retweeted" || r.type === "replied_to"),
  };
}

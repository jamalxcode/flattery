// Suggestions from the site's GitHub form (.github/ISSUE_TEMPLATE/suggest.yml): open issues
// labelled "suggestion". Each scan reads them, checks the links like #FlatteryAdd posts, then
// replies on each issue with what happened and closes it. No X account needed.
import { githubRepo } from "./x.js";

const API = "https://api.github.com";

// Links in an issue: X post ids and GitHub repos
export function parseSuggestion(body) {
  const urls = String(body || "").match(/https?:\/\/[^\s)<>"']+/g) || [];
  const ids = urls.map(u => u.match(/(?:x|twitter)\.com\/\w+\/status(?:es)?\/(\d+)/i)?.[1]).filter(Boolean);
  const repos = urls.map(githubRepo).filter(Boolean).filter(r => !/^jamalxcode\/flattery$/i.test(r));
  return { ids: [...new Set(ids)], repos: [...new Set(repos)] };
}

export function makeSuggestions(token, repo, log) {
  if (!token || !repo) return null;
  const call = async (path, init = {}) => {
    try {
      const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" } });
      if (res.ok) return res.status === 204 ? true : res.json();
      log(`suggestions: GitHub ${res.status} on ${path}`, "warn");
    } catch (e) { log(`suggestions: ${e.message}`, "warn"); }
    return null;
  };
  return {
    // Open suggestions, oldest first, at most 20 a scan
    async open() {
      const list = await call(`/repos/${repo}/issues?labels=suggestion&state=open&sort=created&direction=asc&per_page=20`) || [];
      return list.filter(i => !i.pull_request).map(i => ({ number: i.number, url: i.html_url, ...parseSuggestion(i.body) }));
    },
    async reply(number, text, completed) {
      await call(`/repos/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: text + "\n\n— Flattery's scan (automatic reply)" }) });
      await call(`/repos/${repo}/issues/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: completed ? "completed" : "not_planned" }) });
    },
  };
}

// What became of a suggestion after the scan: [text, completed]
export function outcome(s, { groups, results, rejected, site }) {
  if (!s.ids.length && !s.repos.length)
    return ["No link found. Please open a new suggestion with the link to the X post or the GitHub page.", false];
  const repos = new Set(s.repos.map(r => r.toLowerCase()));
  const card = groups.find(g => g.status === "ok" && ((g.repo && repos.has(g.repo.toLowerCase())) || g.posts?.some(p => s.ids.includes(p.id))));
  if (card) {
    const label = { established: "🏛️ Established", "well-received": "❤️ Loved", proven: "⭐ Proven on GitHub", unconfirmed: "🔥 Hyped, unproven", mixed: "😐 Mixed", "stay-away": "☠️ Don't touch", "too-early": "🆕 New & untested", faded: "🌫️ Didn't catch on" }[card.reception.verdict];
    return [`✅ It's on Flattery: **${card.project || card.repo}**, rated ${label}.\n${site}p/${card.code}/`, true];
  }
  const found = results.filter(e => s.ids.includes(e.id) || (e.repo && repos.has(e.repo.toLowerCase())));
  if (found.length)
    return ["👀 Found and kept, but not shown yet: it needs a little attention on X first (a few likes), or its post doesn't name the app it clones. It will appear by itself when it qualifies.", true];
  if (s.ids.some(id => rejected.has(id)))
    return ["❌ The AI filter judged this post not to be a clone announcement (for example news, a tip, or a list of tools), so it isn't listed.", false];
  return ["🔍 Nothing to list yet. No X post links it in the last 6 months, and it isn't an established open-source app with 1,000+ GitHub stars updated in the last 6 months. Flattery rates clones by how people react on X, so it will be picked up once someone posts about it (with #FlatteryAdd, for example).", false];
}

// Suggestions from the Suggest page: messages on the site's ntfy.sh channel (no sign-up). ntfy.sh
// keeps messages 12 hours; scans run every 8, and `seen` (message ids already read) avoids repeats.
export function parseNtfy(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.event !== "message") continue;
    let m = {}; try { m = JSON.parse(ev.message); } catch { m = { link: ev.message }; }
    out.push({ id: ev.id, time: ev.time, link: String(m.link || "").trim().slice(0, 300), note: String(m.note || "").trim().slice(0, 200) });
  }
  return out;
}
export async function ntfyAnswers(topic, seen, log) {
  if (!topic) return [];
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?poll=1&since=12h`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) { log(`suggest page: ntfy answered ${res.status}`, "warn"); return []; }
    return parseNtfy(await res.text()).filter(m => !seen.has(m.id)).slice(0, 30);
  } catch (e) { log(`suggest page: ${e.message}`, "warn"); return []; }
}

// A one-line result for the Suggest page's "Recently suggested" list
export function logEntry(link, [text], ctx, today) {
  const s = parseSuggestion(link);
  const repos = new Set(s.repos.map(r => r.toLowerCase()));
  const card = ctx.groups.find(g => g.status === "ok" && ((g.repo && repos.has(g.repo.toLowerCase())) || g.posts?.some(p => s.ids.includes(p.id))));
  if (card) return { at: today, link, code: card.code, name: card.project || card.repo };
  const result = text.startsWith("👀") ? "found, waiting for reactions on X" : text.startsWith("❌") ? "not a clone announcement"
    : text.startsWith("No link") ? "not a GitHub or X link" : "nothing to list yet";
  return { at: today, link: link.slice(0, 120), result };
}

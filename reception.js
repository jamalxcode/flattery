// Reception score (0-100) and verdict for a cataloged post. Four parts:
//   approval   likes, reposts and bookmarks, log-scaled (≈5,000 weighted = full marks)
//   interest   engagement per view (or per follower when views are missing), so big
//              accounts don't win on reach alone
//   sentiment  share of positive vs negative replies and quote posts (Haiku)
//   github     stars, release downloads and star growth of the linked repo
// GitHub takes priority: a repo many people star or download is well received however
// small its X post was, and lots of likes on X with a repo nobody stars is buzz, not success.
// Only red flags several people raise (scam, stolen code…) override GitHub. Stars count only
// when the repo is the poster's own or the project itself (ownsRepo), so a post that links a
// famous unrelated project (Linux behind "Ginux") borrows nothing.
import { SERIOUS_FLAGS } from "./haiku.js";

const log01 = (v, full) => Math.min(1, Math.log10(1 + Math.max(0, v)) / Math.log10(1 + full));
const round = v => Math.round(v);

// Days after which a post that never got going counts as "didn't catch on"
export const FADE_DAYS = 14;

export const VERDICTS = {
  faded: "Didn't catch on",
  "well-received": "Well received",
  proven: "Proven on GitHub",
  unconfirmed: "Buzz, not confirmed on GitHub",
  mixed: "Mixed",
  "stay-away": "Stay away",
  "too-early": "Too early to tell",
};

// Thresholds a linked repo must reach to count as confirmed.
export const CONFIRM = { stars: 100, downloads: 500 };
// Thresholds where GitHub alone makes a clone well received.
export const STRONG = { stars: 1000, downloads: 10000 };
// Minimum reach before a post is judged at all, and replies fetched.
export const MIN_REACH = { likes: 20, reposts: 5 };

// Replies needed before their tone is trusted; below this it weighs less and is "low confidence"
export const CONFIDENT_REPLIES = 15;

export const reached = m => m.likes >= MIN_REACH.likes || m.reposts >= MIN_REACH.reposts;

// A linked repo counts as the poster's when its owner matches their X handle or name, or
// when it was created at most NEW_REPO_DAYS before the post (so it's the clone itself, even
// if a curator shared it). Anything else is someone else's project, often the original.
export const NEW_REPO_DAYS = 120;
// A repo this starred that isn't the poster's own is a famous project someone linked to: it
// never becomes the subject of a card (no "Linux: don't touch").
export const FAMOUS = 10000;
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const baseName = s => String(s || "").replace(/\b(v(er(sion)?)?\s*)?\d+(\.\d+)*\b/gi, " ").replace(/\b(beta|alpha|preview|release|rc)\b/gi, " ");

// Whether a post's linked repo is the project the post is about: the repo's name and the
// project's name match ("Voicebox" and jamiepine/voicebox, "open-notebook" and lfnovo/open-notebook).
// A project named after the app it clones ("Excel" linking an Excel repo) doesn't count.
export function repoIsProject(e, gh = e.github) {
  const repo = norm(baseName(String(gh?.repo || e.repo || "").split("/")[1]));
  const original = [e.original_clean, e.original, e.product?.name].map(n => norm(n)).filter(Boolean);
  const names = [e.project, e.display_name].map(n => norm(baseName(n))).filter(n => n.length >= 3 && !original.includes(n));
  return repo.length >= 3 && !original.includes(repo) &&
    names.some(n => n === repo || (Math.min(n.length, repo.length) >= 5 && (n.includes(repo) || repo.includes(n))));
}

export function ownsRepo(entry, gh = entry.github) {
  if (entry.repo_owned != null) return entry.repo_owned; // set by a merge or by overrides.json
  // The repo is the project itself, whoever shared it: its stars are the project's success
  if (repoIsProject(entry, gh)) return true;
  // The author says they built it (Haiku, from the post); trusted below famous-project size
  if (entry.author_built_it && (gh?.stars ?? 0) < FAMOUS) return true;
  const rawOwner = (gh?.repo || entry.repo || "").split("/")[0];
  const owner = norm(rawOwner);
  if (!owner) return false;
  // Words of 5+ letters in the owner ("Anil-matcha" → "matcha") also match the handle
  const words = rawOwner.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 5);
  for (const who of [entry.author?.username, entry.author?.name].map(norm))
    if (who && (who === owner || (Math.min(who.length, owner.length) >= 5 && (who.includes(owner) || owner.includes(who))) ||
      words.some(w => who.includes(w)))) return true;
  const created = Date.parse(gh?.created || "");
  return Number.isFinite(created) && Date.parse(entry.created_at) - created <= NEW_REPO_DAYS * 864e5;
}

export function starsPerDay(gh) {
  const h = gh?.stars_history || [];
  if (h.length < 2) return null;
  const days = (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5;
  return days >= 0.9 ? (h.at(-1).stars - h[0].stars) / days : null;
}

export function score(entry, now = Date.now()) {
  const m = entry.metrics;
  const ageH = (now - Date.parse(entry.created_at)) / 36e5;
  const s = entry.sentiment;
  const linked = entry.github && entry.github.status !== "gone" ? entry.github : null;
  const gh = linked && ownsRepo(entry, linked) ? linked : null; // only their own repo counts
  const parts = {};

  parts.approval = round(100 * log01(m.likes + 2 * m.reposts + 1.5 * m.bookmarks, 5000));
  const engaged = m.likes + m.reposts + m.bookmarks;
  parts.interest = round(100 * (m.views ? Math.min(1, engaged / m.views / 0.03) : m.likes && entry.author.followers ? Math.min(1, engaged / entry.author.followers / 0.05) : 0));

  let net = null, confidence = null;
  if (s?.sampled >= 5) {
    parts.sentiment = round(50 + 50 * (s.positive - s.negative) / s.sampled);
    confidence = s.sampled >= CONFIDENT_REPLIES ? "ok" : "low";
    if (confidence === "ok") net = (s.positive - s.negative) / s.sampled;
  }
  let confirmed = false, strong = false;
  if (gh) {
    const growth = starsPerDay(gh);
    parts.github = round(100 * (0.6 * log01(gh.stars, 5000) + 0.25 * log01(gh.downloads, 20000) + 0.15 * (growth == null ? log01(gh.stars, 5000) : log01(growth, 200))));
    confirmed = gh.stars >= CONFIRM.stars || gh.downloads >= CONFIRM.downloads;
    strong = gh.stars >= STRONG.stars || gh.downloads >= STRONG.downloads;
  }

  // Weighted mean over the parts we have
  const weights = { approval: 25, interest: 5, sentiment: confidence === "low" ? 10 : 25, github: 45 };
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(weights)) if (parts[k] != null) { sum += parts[k] * w; wsum += w; }
  let total = wsum ? sum / wsum : 0;

  const reasons = [];
  // "Ratioed": many more replies and quotes than likes usually means people are piling on
  const ratio = (m.replies + m.quotes) / (m.likes + 1);
  if (ratio > 1 && m.replies + m.quotes >= 10) {
    total -= net != null && net < 0 ? 20 : 8;
    reasons.push(`ratioed: ${m.replies + m.quotes} replies and quotes vs ${m.likes} likes`);
  }
  const flags = s?.flags || [];
  const serious = flags.filter(f => SERIOUS_FLAGS.has(f));
  total -= Math.min(30, 10 * (flags.length - serious.length));
  // A serious accusation against a project most people clearly like, with real use on GitHub,
  // is disputed rather than decisive: the card shows both sides as Mixed
  const disputed = serious.length > 0 && strong && net != null && net >= 0.2;
  if (serious.length && !disputed) total -= 30;
  // People who tried it (#FlatteryWorks / #FlatteryBroken on X)
  const tr = entry.trials;
  if (tr?.works >= 3 && tr.works >= 2 * tr.broken) { total += 5; reasons.push(`${tr.works} people say it works`); }
  if (tr?.broken >= 3 && tr.broken > tr.works) { total -= 12; reasons.push(`${tr.broken} people say it's broken`); }
  if (linked?.status === "archived") reasons.push("repo archived");
  if (linked && !gh) reasons.push(`links to someone else's repo (${entry.repo}), so its ${linked.stars.toLocaleString("en")} stars don't count`);
  if (entry.github?.status === "gone") reasons.push("linked repo removed");
  total = Math.max(0, Math.min(100, round(total)));

  let verdict;
  if (disputed) { verdict = "mixed"; reasons.push(`disputed: some people on X raised ${serious.map(f => f.replaceAll("-", " ")).join(", ")}, while most replies are positive`); }
  else if (serious.length) { verdict = "stay-away"; reasons.push(`people on X raised: ${serious.map(f => f.replaceAll("-", " ")).join(", ")}`); }
  else if (entry.github?.status === "gone") verdict = "stay-away";
  else if ((strong || confirmed) && !reached(m) && (net == null || net > -0.2)) {
    // Real use on GitHub but a quiet post on X: proven, not (yet) loved by a crowd
    verdict = "proven";
    reasons.push(`${gh.stars.toLocaleString("en")} GitHub stars${gh.downloads ? ` and ${gh.downloads.toLocaleString("en")} downloads` : ""}, quiet on X`);
  } else if (strong) {
    // Lots of stars or downloads: well received, unless the replies are clearly negative
    verdict = net != null && net <= -0.2 ? "mixed" : "well-received";
    reasons.push(`${gh.stars.toLocaleString("en")} GitHub stars${gh.downloads ? ` and ${gh.downloads.toLocaleString("en")} downloads` : ""}`);
  } else if (confirmed && (net == null || net > -0.2)) verdict = total >= 50 ? "well-received" : "mixed";
  else if (!reached(m) || (ageH < 24 && !s)) {
    // Two weeks on with little reach and no GitHub use: it didn't catch on (it can still
    // come back if people pick it up later)
    verdict = ageH > FADE_DAYS * 24 && !confirmed ? "faded" : "too-early";
  }
  else if (total < 35 || (net != null && net <= -0.2)) verdict = "stay-away";
  else if (total >= 60 && (net == null || net >= 0.2)) {
    verdict = confirmed ? "well-received" : "unconfirmed";
    if (!confirmed && !(linked && !gh)) reasons.push(gh ? `repo has ${gh.stars} stars and ${gh.downloads} downloads (needs ${CONFIRM.stars} stars or ${CONFIRM.downloads} downloads)` : "no GitHub repo linked");
  } else verdict = "mixed";

  return { score: total, verdict, disputed, parts, net: net == null ? null : Math.round(net * 100) / 100, confirmed, repo_counted: !!gh, confidence, reasons };
}

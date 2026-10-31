// Objections to a listing, made on X: the page's "Object" button opens a post like
//   Please remove "PhotoCraft" from Flattery (flattery.sala.company): <reason> #FlatteryRemove frk3x9a
// Each scan reads those posts. A listing comes down by itself, with no one reviewing it, when
// enough objections count:
//   - one per account, from accounts at least MIN_AGE_DAYS old with MIN_FOLLOWERS followers
//   - a real reason (Claude Haiku judges it), not the bare template or a copy of another one
//   - spread out: at most PER_WINDOW counted per WINDOW_MIN minutes, NEEDED counted in all,
//     the first and last at least MIN_SPAN_H hours apart
export const TAG = "FlatteryRemove";
export const NEEDED = 6, MIN_SPAN_H = 2, WINDOW_MIN = 30, PER_WINDOW = 2, MIN_AGE_DAYS = 30, MIN_FOLLOWERS = 10;

// Short stable code for a post id (FNV-1a), e.g. "frk3x9a"
export function postCode(id) {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return "fr" + h.toString(36).padStart(7, "0").slice(-5);
}

// The code right after the tag; a bare "fr" word ("friends") is never a code
export function parseCode(text) {
  return String(text).match(new RegExp(`#${TAG}\\W+(fr[0-9a-z]{5})\\b`, "i"))?.[1].toLowerCase() || null;
}

// The reason alone: without the tag, code, links, mentions and the template's words
export function reasonOf(text, name = "") {
  return String(text)
    .replace(new RegExp(`#${TAG}\\W+fr[0-9a-z]{5}\\b`, "gi"), " ").replace(/#\w+/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ")
    .replace(/please remove/gi, " ").replace(/from flattery/gi, " ").replace(/\(?flattery\.sala\.company\)?/gi, " ")
    .replace(name ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : /$^/, " ")
    .replace(/<your reason>/gi, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

// objections: [{ id, code, author_id, account_created, followers, at, text, reasonable }]
// Returns Map code -> { counted, total, removed, first, last }
export function tally(objections) {
  const byCode = new Map();
  for (const o of [...objections].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!byCode.has(o.code)) byCode.set(o.code, []);
    byCode.get(o.code).push(o);
  }
  const out = new Map();
  for (const [code, list] of byCode) {
    const authors = new Set(), reasons = new Set(), counted = [];
    for (const o of list) {
      if (authors.has(o.author_id)) continue; // one per account
      authors.add(o.author_id);
      const ageDays = (Date.parse(o.at) - Date.parse(o.account_created || o.at)) / 864e5;
      const reason = reasonOf(o.text);
      if (o.reasonable !== true || ageDays < MIN_AGE_DAYS || (o.followers || 0) < MIN_FOLLOWERS || reason.length < 15 || reasons.has(reason)) continue;
      reasons.add(reason);
      const t = Date.parse(o.at);
      if (counted.filter(c => t - Date.parse(c.at) < WINDOW_MIN * 6e4).length >= PER_WINDOW) continue; // a burst
      counted.push(o);
    }
    const span = counted.length ? (Date.parse(counted.at(-1).at) - Date.parse(counted[0].at)) / 36e5 : 0;
    out.set(code, { counted: counted.length, total: list.length, removed: counted.length >= NEEDED && span >= MIN_SPAN_H,
      first: counted[0]?.at, last: counted.at(-1)?.at });
  }
  return out;
}

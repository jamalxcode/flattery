// The catalog is published by the scheduled workflow every 2 hours. The page keeps
// showing the last scan and swaps in a newer one when it appears.
const $ = id => document.getElementById(id);
const INTERVAL_MIN = 120;
let live = null;

function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : m < 120 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
}

function liveStatus() {
  if (!live) return;
  const at = Date.parse(live.info.generated_iso);
  const next = at + INTERVAL_MIN * 60000 - Date.now();
  const when = next > 60000 ? `next in about ${Math.ceil(next / 60000)} min` : "next one due now";
  $("liveStatus").innerHTML = `Updated <b>${ago(Date.now() - at)}</b> · ${when} · ` +
    `<a href="data/latest.html" target="_blank" rel="noopener">standalone report</a> · <a href="data/latest.json" target="_blank" rel="noopener">JSON</a>`;
}

async function loadLive() {
  try {
    const res = await fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.info?.source !== "x") throw new Error("old format");
    if (!live || data.info.generated_iso !== live.info.generated_iso) {
      live = data;
      renderReport($("live"), live.results, live.info);
    }
    liveStatus();
  } catch {
    if (!live) $("liveStatus").textContent = "No scan of X has been published yet. The first one appears after the next scheduled run.";
  }
}

loadLive();
setInterval(loadLive, 5 * 60000);
setInterval(liveStatus, 30000);

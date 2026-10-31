// The catalog is published by the scheduled workflow every 8 hours. The page keeps
// showing the last scan and swaps in a newer one when it appears.
const $ = id => document.getElementById(id);
const INTERVAL_MIN = 480;
let live = null;

// Theme: Auto (system) → Light → Dark, remembered per browser, as on go.sala.company
const themeBtn = $("theme-btn");
const themeLabels = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };
const showTheme = t => { themeBtn.textContent = themeLabels[t]; themeBtn.setAttribute("aria-label", "Colour theme: " + (t === "auto" ? "automatic" : t)); };
showTheme(document.documentElement.dataset.theme || "auto");
themeBtn.addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(document.documentElement.dataset.theme || "auto") + 1) % 3];
  if (next === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try { next === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", next); } catch {}
  showTheme(next);
});

// Surprise me: a random loved clone, or any rated one when none are loved yet
$("surprise").addEventListener("click", () => {
  if (!live) return;
  const ok = live.results.filter(e => e.status !== "gone");
  const pool = ok.filter(e => e.reception.verdict === "well-received");
  const list = pool.length ? pool : ok;
  if (list.length) $("live").flattery?.open(list[Math.floor(Math.random() * list.length)].id);
});

function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : m < 120 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
}

function liveStatus() {
  const el = $("live").querySelector("[data-r=status]");
  if (!live || !el) return;
  const at = Date.parse(live.info.generated_iso);
  const next = at + INTERVAL_MIN * 60000 - Date.now();
  el.textContent = `Updated ${ago(Date.now() - at)} · ${next > 60000 ? `next scan in about ${Math.ceil(next / 60000)} min` : "next scan due now"}`;
}

async function loadLive() {
  try {
    const res = await fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.info?.source !== "x") throw new Error("old format");
    if (!live || data.info.generated_iso !== live.info.generated_iso) {
      live = data;
      renderReport($("live"), live.results, live.info, { search: $("search") });
    }
    liveStatus();
  } catch {
    if (!live) {
      renderReport($("live"), [], {}, { search: $("search") });
      $("live").querySelector("[data-r=status]").textContent = "No scan of X has been published yet. The first one appears after the next scheduled run.";
    }
  }
}

loadLive();
setInterval(loadLive, 5 * 60000);
setInterval(liveStatus, 30000);

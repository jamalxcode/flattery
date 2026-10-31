// The catalog is published by the scheduled workflow every 8 hours. The page keeps
// showing the last scan and swaps in a newer one when it appears.
const $ = id => document.getElementById(id);
const INTERVAL_MIN = 480;
let live = null;

// Theme: Auto (system) → Light → Dark, remembered per browser, as on go.sala.company
const themeBtn = $("theme-btn");
const themeLabels = { auto: "◐ <span class=\"label\">Auto</span>", light: "☀ <span class=\"label\">Light</span>", dark: "☾ <span class=\"label\">Dark</span>" };
const showTheme = t => { themeBtn.innerHTML = themeLabels[t]; themeBtn.setAttribute("aria-label", "Colour theme: " + (t === "auto" ? "automatic" : t)); };
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
// How the ratings work: a drawer, like the newsletter
const about = $("about");
const showAbout = () => { if (!about.open) about.showModal(); about.scrollTop = 0; };
$("about-btn").addEventListener("click", showAbout);
// The phone menu (⋯): closes after a choice
const menu = document.querySelector(".more-menu");
menu?.addEventListener("click", ev => {
  if (ev.target.closest("[data-about]")) showAbout();
  if (ev.target.closest(".menu a, .menu button")) menu.open = false;
});
document.addEventListener("click", ev => { if (menu?.open && !menu.contains(ev.target)) menu.open = false; });

// Usage counts (GoatCounter events): which buttons, filters and links people actually use
const goat = name => { try { window.goatcounter?.count?.({ path: "flattery-" + name, title: name, event: true }); } catch {} };
document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-goat], [data-filter], [data-cat], [data-open]");
  if (!el) return;
  goat(el.dataset.goat || (el.dataset.filter ? "filter-" + el.dataset.filter : el.dataset.cat != null ? "category-" + (el.dataset.cat || "all") : "open-project"));
}, true);
let searchTimer;
$("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => $("search").value.trim() && goat("search"), 1500); });
about.addEventListener("click", ev => { if (ev.target === about || ev.target.closest(".close")) about.close(); });

$("news-btn").addEventListener("click", () => $("live").flattery?.news());

$("surprise").addEventListener("click", () => {
  if (!live) return;
  const ok = (live.groups || live.results).filter(e => e.status !== "gone");
  const pool = ok.filter(e => ["well-received", "proven"].includes(e.reception.verdict));
  const list = pool.length ? pool : ok;
  if (list.length) $("live").flattery?.open(list[Math.floor(Math.random() * list.length)].id);
});

// A shared link (#p=<id>) opens that project once the catalog has loaded
let hashOpened = false;
function openFromHash() {
  if (location.hash.startsWith("#news")) return $("live").flattery?.news();
  if (location.hash === "#how") return $("about").showModal();
  const m = location.hash.match(/^#p=(.+)$/);
  // A project page (/p/<code>/) names its project in window.FLATTERY_OPEN
  if (!m && window.FLATTERY_PRODUCT && !hashOpened) { hashOpened = true; return $("live").flattery?.pick(window.FLATTERY_PRODUCT); }
  const id = m ? decodeURIComponent(m[1]) : window.FLATTERY_OPEN;
  if (!id || hashOpened) return;
  hashOpened = true;
  $("live").flattery?.open(id);
}
window.addEventListener("hashchange", () => { hashOpened = false; openFromHash(); });

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
    // The slim file has just what the page shows; the full catalog is the fallback
    let res = await fetch("data/site.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) res = await fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.info?.source !== "x") throw new Error("old format");
    if (!live || data.info.generated_iso !== live.info.generated_iso) {
      live = data;
      renderReport($("live"), live.groups || live.results, live.info, { search: $("search"), base: "data/" });
      $("news-btn").hidden = !(live.info.newsletter || []).length;
      $("news-btn").classList.toggle("fresh", !!$("live").dataset.newsFresh);
      // ?q=… (e.g. from the stats page's builder links) starts with that search
      const q = new URLSearchParams(location.search).get("q");
      if (q && !$("search").value) { $("search").value = q; $("search").dispatchEvent(new Event("input")); }
      openFromHash();
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

// Renders the catalog as an app store: a sidebar of ratings and categories, Discover shelves
// (most loved, rising, promoted, new), a list of app rows, and a detail sheet per clone.
// Shared by the live page and the standalone report. opts.search: an <input> outside root to filter with.
// opts.base: where the catalog's files (thumbnails) live, relative to the page ("data/").
const RATINGS = [
  ["well-received", "❤️", "Loved", "Real use on GitHub and a real crowd on X, mostly positive.", "loved"],
  ["proven", "⭐", "Proven on GitHub", "Lots of stars or downloads on the poster's own repo, but quiet on X so far.", "proven"],
  ["unconfirmed", "🔥", "Hyped, unproven", "Lots of buzz on X, but no repo or one nobody uses yet.", "hype"],
  ["too-early", "🆕", "New & untested", "Too new or too small to judge yet.", "new"],
  ["faded", "🌫️", "Didn't catch on", "Two weeks on, with little reach and no real GitHub use. It can still come back.", "faded"],
  ["mixed", "😐", "Mixed", "People are split on it.", "mixed"],
  ["stay-away", "☠️", "Don't touch", "Mostly negative, a pile-on, a removed repo, or red flags like scams or stolen code.", "danger"],
];

// Order for promotions and demotions
const RANK = { "stay-away": 0, faded: 0.5, "too-early": 1, mixed: 2, unconfirmed: 3, proven: 3.5, "well-received": 4 };
const SITE = "https://flattery.sala.company/";
const CAT_ICON = { Design: "🎨", Office: "📄", "Dev tools": "🛠", AI: "🤖", Media: "🎬", Utilities: "🧰", Communication: "💬", Business: "💼", Games: "🎮", Other: "📦" };
const CATEGORIES = ["Design", "Office", "Dev tools", "AI", "Media", "Utilities", "Communication", "Business", "Games", "Other"];
// Approximate yearly list prices (USD) of originals, for "saves about $X a year"
const PRICES = {
  "adobe photoshop": 264, "photoshop": 264, "adobe lightroom": 120, "lightroom": 120, "adobe illustrator": 264, "illustrator": 264,
  "adobe premiere pro": 264, "premiere pro": 264, "adobe after effects": 264, "after effects": 264, "adobe indesign": 264, "indesign": 264,
  "adobe acrobat": 240, "acrobat": 240, "adobe creative cloud": 720, "adobe creative suite": 720,
  "microsoft word": 100, "microsoft excel": 100, "microsoft powerpoint": 100, "microsoft office": 100, "microsoft 365": 100,
  "autocad": 2030, "autodesk autocad": 2030, "canva": 120, "notion": 120, "slack": 105, "grammarly": 144, "dropbox": 120, "1password": 36,
};

function renderReport(root, DATA, INFO, opts = {}) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (v || 0).toLocaleString("en", { notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });
  const rating = v => RATINGS.find(r => r[0] === v) || RATINGS.find(r => r[0] === "mixed");
  const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
  const what = e => e.product ? label(e.product) : (e.original_clean || e.original);
  const price = e => PRICES[String(e.original_clean || "").toLowerCase()] || (e.product && PRICES[label(e.product).toLowerCase()]);
  const xIntent = (text, url) => "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + (url ? "&url=" + encodeURIComponent(url) : "");
  const name = e => e.project || e.display_name || e.repo?.split("/")[1] || what(e) && `${what(e)} clone` || "Untitled";
  // Each project's own page (static, with its own preview image for sharing)
  const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const altUrl = e => what(e) ? `${SITE}alternatives/${slug(what(e))}/` : "";
  const pageUrl = e => e.code ? `${SITE}p/${e.code}/` : `${SITE}#p=${encodeURIComponent(e.id)}`;
  const src = e => e.source === "hn" ? "Hacker News" : e.source === "reddit" ? "Reddit" : "X";
  const unrated = v => v === "too-early" || v === "faded";
  // Can I use it? From the poster's own repo: installers in its releases, a web demo, a license,
  // and whether anyone still works on it
  const usable = e => {
    const g = e.github && e.github.status !== "gone" && e.reception?.repo_counted !== false ? e.github : null;
    if (!g) return null;
    const days = g.pushed_at ? (Date.now() - Date.parse(g.pushed_at)) / 864e5 : null;
    const age = g.created ? (Date.now() - Date.parse(g.created)) / 864e5 : 999;
    return {
      ready: g.platforms?.length ? "install" : g.homepage ? "online" : "source",
      platforms: g.platforms || [], homepage: g.homepage,
      licensed: !!g.license && g.license !== "NOASSERTION",
      alive: g.status === "archived" || (days != null && days > 30 && age > 30) ? "abandoned" : g.commits_30d > 0 || (days != null && days <= 14) ? "active" : "quiet",
      days, commits: g.commits_30d,
    };
  };
  const useLine = e => {
    const u = usable(e);
    if (!u) return "";
    return `<p class="use">${u.ready === "install" ? `⬇ ${u.platforms.join(" · ")}` : u.ready === "online" ? "🌐 Try online" : "📦 Source only"}${!u.licensed ? ' <span class="warn" title="No license: you may not be allowed to use it">⚠ no license</span>' : ""}${u.alive === "abandoned" ? ' <span class="dead">🪦 abandoned</span>' : ""}</p>`;
  };
  // The visitor's system, for the Get button
  const OS = (() => {
    if (typeof navigator === "undefined") return "";
    const ua = navigator.userAgent || "", pf = navigator.userAgentData?.platform || navigator.platform || "";
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(pf) && navigator.maxTouchPoints > 1)) return "iOS";
    if (/mac/i.test(pf) || /Mac OS X/.test(ua)) return "Mac";
    if (/win/i.test(pf) || /Windows/.test(ua)) return "Windows";
    if (/linux|cros/i.test(pf + ua)) return "Linux";
    return "";
  })();
  // Get: the installer for this system from the newest release; Open: the project's web app.
  // Never for Don't touch.
  const getLink = e => {
    if (e.reception?.verdict === "stay-away") return null;
    const u = usable(e);
    if (!u) return null;
    if (OS && e.github.get?.[OS]) return { label: "Get", long: `Get for ${OS}`, url: e.github.get[OS], title: `Download for ${OS} from the project's GitHub releases` };
    if (u.homepage) return { label: "Open", long: "Open the web app", url: u.homepage, title: "Open it in your browser" };
    return null;
  };
  const OF = { clone: "Clone of", "reverse-engineered": "Reverse-engineered", reimagined: "Reimagined", port: "Port of" };
  const ofLine = e => what(e) ? `${OF[e.kind] || "Clone of"} ${what(e)}` : (e.kind || "clone");
  const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const live = DATA.filter(e => e.status !== "gone");
  // The latest change of rating, if it happened in the last `days`
  const moved = (e, days = 14) => {
    const h = e.history || [];
    if (h.length < 2 || Date.now() - Date.parse(h.at(-1).at) > days * 864e5) return null;
    const prev = h.at(-2).verdict;
    return { prev, up: RANK[e.reception.verdict] > RANK[prev] };
  };
  const moveLine = e => {
    const m = moved(e);
    if (!m) return "";
    const [, emo, n] = rating(m.prev);
    return `<p class="move ${m.up ? "up" : "down"}">${m.up ? "⬆ Promoted from" : "⬇ Was"} ${emo} ${n}</p>`;
  };
  const search = opts.search || null;

  // A README screenshot when the repo has one, over a generated tile (shown if it fails to load).
  // Long names get a smaller size and may wrap to two lines instead of being cut off.
  const art = e => {
    const n = name(e);
    const size = n.length <= 9 ? "l" : n.length <= 16 ? "m" : "s";
    // Our stored copy when there is one; the README's own image until then
    const src = e.thumb ? (opts.base || "") + e.thumb : e.github?.status !== "gone" && e.github?.image;
    const shot = src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    return `<div class="tile" style="--h:${hue(n)}"><span class="tile-mark ${size}">${esc(n)}</span>${what(e) ? `<span class="tile-of">≈ ${esc(what(e))}</span>` : ""}</div>${shot}`;
  };
  const mini = s => {
    if (!s?.sampled) return "";
    const pc = n => (100 * n / s.sampled).toFixed(1);
    return `<div class="mini" title="${s.positive} positive, ${s.neutral} neutral, ${s.negative} negative"><i class="p" style="width:${pc(s.positive)}%"></i><i class="u" style="width:${pc(s.neutral)}%"></i><i class="m" style="width:${pc(s.negative)}%"></i></div>`;
  };

  if (!root.dataset.ready) {
    root.innerHTML = `
      <div class="store">
        <nav class="side" aria-label="Browse">
          <div class="side-group" data-r="side"></div>
          <p class="side-note" data-r="sideNote" hidden></p>
          <h3 class="side-h" data-r="catsH">Categories</h3>
          <div class="side-group" data-r="cats"></div>
          <a class="suggest" href="${esc(xIntent("Flattery is missing a clone: <link to the X post or the GitHub repo> #FlatteryAdd", SITE))}" target="_blank" rel="noopener" data-goat="suggest">＋ Suggest a clone on X</a>
        </nav>
        <div class="store-main">
          <header class="store-head">
            <h1 data-r="title">Discover</h1>
            <p class="motto"><q>Imitation is the sincerest form of flattery.</q> <span class="why">Clones of apps you know, rated by the crowd on X, Hacker News and Reddit, and checked on GitHub.</span> <span class="status" data-r="status"></span></p>
          </header>
          <div data-r="discover"></div>
          <section id="apps">
            <div class="sec-head">
              <h2 data-r="listTitle"></h2>
              <div class="selects">
                ${search ? "" : `<input type="search" class="search" data-r="q" placeholder="Search clones…" aria-label="Search clones" style="padding-left:16px;height:36px;width:180px">`}
                <select data-r="product" aria-label="Clones of"></select>
                <select data-r="use" aria-label="Can I use it">
                  <option value="">Usable or not</option><option value="install">Ready to install</option><option value="online">Try online</option>
                  <option value="licensed">Has a license</option><option value="alive">Still maintained</option>
                </select>
                <select data-r="sort" aria-label="Sort">
                  <option value="score">Top rated</option><option value="likes">Most liked</option><option value="stars">Most GitHub stars</option>
                  <option value="downloads">Most downloads</option><option value="newest">Newest</option>
                </select>
              </div>
            </div>
            <div class="alt-title" data-r="altTitle" hidden></div>
            <p class="results" data-r="results" hidden></p>
            <ul class="grid rows" data-r="grid"></ul>
          </section>
          <details class="rejected" data-r="rejWrap"><summary>Recently left out by the filter</summary>
            <p class="note-small">Popular posts Claude Haiku judged not to be clone announcements.</p>
            <ul class="posts" data-r="rej"></ul></details>
          <details class="rejected" data-r="downWrap"><summary data-r="downTitle">Taken down after objections</summary>
            <p class="note-small">Listings removed automatically after enough people objected on X (six or more established accounts, real reasons, spread over time).</p>
            <ul class="posts" data-r="down"></ul></details>
          <details class="rejected" data-r="statusWrap"><summary>Status</summary><div data-r="statusBody"></div></details>
        </div>
      </div>
      <dialog class="sheet" data-r="sheet"></dialog>
      <dialog class="drawer" id="news" data-r="newsDrawer" aria-label="This week in clones"></dialog>`;
    root.dataset.ready = "1";
    root._filter = "rated";
    const rerender = () => renderReport(root, root._data, root._info, opts);
    root.querySelectorAll("select,[data-r=q]").forEach(el => el.addEventListener("input", rerender));
    // Picking a section in the sidebar shows it from the top
    const toTop = () => { const m = root.querySelector(".store-main"); if (m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: "start" }); };
    // Searching shows the results right away: the grid is far below the search box
    const toResults = () => {
      const apps = root.querySelector("#apps");
      if (apps.getBoundingClientRect().top > innerHeight * 0.6 || apps.getBoundingClientRect().bottom < 0)
        apps.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    for (const box of [search, root.querySelector("[data-r=q]")].filter(Boolean)) {
      box.addEventListener("input", () => { rerender(); if (box.value.trim()) toResults(); });
      box.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); toResults(); } });
    }
    root.addEventListener("click", ev => {
      const c = ev.target.closest("[data-cat]");
      if (c) { root._cat = root._cat === c.dataset.cat ? "" : c.dataset.cat; rerender(); toTop(); return; }
      if (ev.target.closest("[data-clear]")) {
        for (const box of [search, root.querySelector("[data-r=q]")].filter(Boolean)) box.value = "";
        rerender();
        return;
      }
      const f = ev.target.closest("[data-filter]");
      if (f) {
        root._filter = f.dataset.filter;
        if (f.dataset.filter === "rated") root._cat = "";
        rerender();
        toTop();
        return;
      }
      if (ev.target.closest("[data-news]")) { root.flattery.news(); return; }
      const o = ev.target.closest("[data-open]");
      if (o) root.flattery.open(o.dataset.open);
    });
    const drawer = root.querySelector("[data-r=newsDrawer]");
    drawer.addEventListener("click", ev => {
      if (ev.target === drawer || ev.target.closest(".close")) drawer.close();
      else if (ev.target.closest("[data-open]")) drawer.close();
    });
    const sheet = root.querySelector("[data-r=sheet]");
    sheet.addEventListener("click", ev => {
      if (ev.target === sheet || ev.target.closest(".close")) sheet.close();
      const share = ev.target.closest("[data-share]");
      if (share) {
        const url = share.dataset.url || location.href.split("#")[0] + "#p=" + encodeURIComponent(share.dataset.share);
        navigator.clipboard?.writeText(url).then(() => { share.textContent = "Link copied"; }, () => { share.textContent = url; });
      }
    });
    // Each project has its own link (#p=<id>); closing the sheet clears it
    sheet.addEventListener("close", () => { if (location.hash.startsWith("#p=")) history.replaceState(null, "", location.pathname + location.search); });
  }
  root._data = DATA;
  root._info = INFO;
  const $ = k => root.querySelector(`[data-r=${k}]`);
  const by = v => live.filter(e => e.reception.verdict === v);

  if (search) search.placeholder = `Search ${live.length} clones…`;

  // A row, as in an app store: icon, name, what it clones, a line of numbers, and the rating
  // where the price would be
  const initials = n => (String(n).match(/[A-Za-z0-9]+/g) || ["?"]).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const growth = e => {
    const h = e.github?.stars_history || [];
    const days = h.length > 1 ? (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5 : 0;
    return days >= 0.9 && e.reception.repo_counted ? (h.at(-1).stars - h[0].stars) / days : 0;
  };
  const counted = e => e.github && e.github.status !== "gone" && e.reception.repo_counted !== false;
  // The project's logo or its organisation's avatar when there is one, over its initials
  const icon = (e, cls = "icon") => `<div class="${cls}" style="--h:${hue(name(e))}" aria-hidden="true">${esc(initials(name(e)))}${e.icon
    ? `<img src="${esc((opts.base || "") + e.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>`;
  const row = (e, note) => {
    const [, emo, rname, , cls] = rating(e.reception.verdict);
    const u = usable(e), m = moved(e);
    const bits = [
      note,
      m ? `<span class="move ${m.up ? "up" : "down"}">${m.up ? "⬆ promoted" : `⬇ was ${rating(m.prev)[1]}`}</span>` : "",
      `♥ ${num(e.metrics.likes)}`,
      counted(e) ? `★ ${num(e.github.stars)}` : "",
      u ? (u.ready === "install" ? `⬇ ${esc(u.platforms.join(" · "))}` : u.ready === "online" ? "🌐 Try online" : "") : "",
      u?.alive === "abandoned" ? '<span class="dead">🪦 abandoned</span>' : "",
      e.trials ? `✅ ${e.trials.works} · ❌ ${e.trials.broken}` : "",
      e.reception.disputed ? '<span class="obj">⚠️ Disputed</span>' : "",
      e.objections ? `<span class="obj" title="objections counted">⚑ ${e.objections}</span>` : "",
      price(e) ? `<span class="save">saves ~$${price(e)}/yr</span>` : "",
    ].filter(Boolean);
    return `<li><article class="card r-${cls}${e.status === "gone" ? " gone" : ""}">
      ${icon(e)}
      <div class="card-body">
        <h3><button type="button" data-open="${esc(e.id)}">${esc(name(e))}</button></h3>
        <p class="of">${esc(ofLine(e))}</p>
        <p class="meta">${bits.join('<span class="sep">·</span>')}</p>
      </div>
      <div class="get"><span class="pill" title="${esc(rname)}, score ${e.reception.score}">${emo} ${e.reception.score}</span>${(g => g
        ? `<a class="get-btn" href="${esc(g.url)}" target="_blank" rel="noopener nofollow" title="${esc(g.title)}" data-goat="${g.label === "Get" ? "get" : "open"}">${g.label}</a>`
        : `<small>${esc(rname)}</small>`)(getLink(e))}</div>
    </article></li>`;
  };
  const shelf = (title, list, filter, note) => list.length ? `<section class="shelf-sec">
      <div class="sec-head"><h2>${title}</h2>${filter ? `<button type="button" class="see-all" data-filter="${filter}">See all</button>` : ""}</div>
      <ul class="rows">${list.slice(0, 6).map(e => row(e, note && note(e))).join("")}</ul></section>` : "";
  const feature = (e, eyebrow) => `<button type="button" class="feature" data-open="${esc(e.id)}">
      <div class="art">${art(e)}</div>
      <span class="eyebrow">${eyebrow}</span><span class="f-name">${esc(name(e))}</span>
      <span class="f-sum">${esc(e.summary || ofLine(e))}</span></button>`;

  // Sidebar: ratings, then categories
  // The chosen one shows a line saying what it means
  const side = [["all", "🗂", "Everything", live.length, "", "Every clone found, rated or not yet, best first."],
    ["rated", "✨", "Discover", live.filter(e => !unrated(e.reception.verdict)).length, "", "The highlights: most loved, rising, just promoted, new and proven, then all rated clones."],
    ...RATINGS.map(([v, emo, n, d, cls]) => [v, emo, n, by(v).length, cls, d])];
  const gone = DATA.length - live.length;
  if (gone) side.push(["gone", "🗑", "Removed", gone, "", "Listings whose post or repo was deleted."]);
  const chosen = side.find(([v]) => v === root._filter && (v !== "rated" || !root._cat));
  $("side").innerHTML = side.map(([v, emo, t, n, cls, d]) => `<button type="button" class="side-item${cls ? ` r-${cls}` : ""}" data-filter="${v}" aria-pressed="${chosen?.[0] === v}">
      <span class="emo">${emo}</span><span class="t">${esc(t)}</span><span class="n">${n}</span>${chosen?.[0] === v ? `<small class="side-desc">${esc(d)}</small>` : ""}</button>`).join("");
  $("sideNote").hidden = !chosen;
  if (chosen) $("sideNote").textContent = `${chosen[1]} ${chosen[2]}: ${chosen[5]}`;
  const catCount = new Map();
  for (const e of live) if (e.category) catCount.set(e.category, (catCount.get(e.category) || 0) + 1);
  $("catsH").hidden = !catCount.size;
  $("cats").innerHTML = CATEGORIES.filter(c => catCount.has(c)).map(c => `<button type="button" class="side-item" data-cat="${esc(c)}" aria-pressed="${root._cat === c}">
      <span class="emo">${CAT_ICON[c] || "•"}</span><span class="t">${esc(c)}</span><span class="n">${catCount.get(c)}</span></button>`).join("");

  const counts = new Map();
  for (const e of live) if (what(e)) counts.set(what(e), (counts.get(what(e)) || 0) + 1);
  const pick = $("product").value;
  $("product").innerHTML = '<option value="">Clones of anything</option>' + [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([p, c]) => `<option value="${esc(p)}"${p === pick ? " selected" : ""}>${esc(p)} (${c})</option>`).join("");

  const useWant = $("use").value;
  const useOk = e => {
    if (!useWant) return true;
    const u = usable(e);
    return !!u && (useWant === "install" ? u.ready === "install" : useWant === "online" ? u.ready !== "source" :
      useWant === "licensed" ? u.licensed : u.alive !== "abandoned");
  };
  const q = (search || $("q")).value.trim().toLowerCase();
  // A search looks through every rating, not only the current filter
  const f = q && root._filter === "rated" ? "all" : root._filter;
  let rows = DATA.filter(e => (f === "gone" ? e.status === "gone" : e.status !== "gone" && (f === "all" || (f === "rated" ? !unrated(e.reception.verdict) : e.reception.verdict === f))) &&
    (!pick || what(e) === pick) && (!root._cat || e.category === root._cat) && useOk(e));
  // Every word must appear somewhere in the project: its name, what it clones, its rating,
  // category, repo, summary, posters and posts ("adobe photoshop", "loved word", "rust")
  if (q) {
    const fold = s => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const words = fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    rows = rows.filter(e => {
      const hay = fold([name(e), e.project, what(e), e.original, e.original_clean, e.product && label(e.product), e.category, e.kind,
        rating(e.reception.verdict)[2], e.summary, e.text, e.repo, e.author?.username, ...(e.posts || []).flatMap(p => [p.author, p.text])].join(" "));
      return words.every(w => hay.includes(w));
    });
  }
  $("results").hidden = !q;
  if (q) $("results").innerHTML = `${rows.length ? `<b>${rows.length}</b> ${rows.length === 1 ? "result" : "results"}` : "No results"} for “${esc(q)}” <button type="button" data-clear>Clear search</button>`;
  // Picking an app turns the list into "Free alternatives to X"
  $("altTitle").hidden = !pick;
  if (pick) {
    const p = PRICES[pick.toLowerCase()];
    $("altTitle").innerHTML = `<h2>Free alternatives to ${esc(pick)}</h2><p>${rows.length} ${rows.length === 1 ? "clone" : "clones"} found online, rated by the crowd and checked on GitHub${p ? `, each saving about $${p} a year` : ""}. Best rated first.</p>`;
  }
  const sorts = {
    score: e => e.reception.score - (e.reception.verdict === "stay-away" ? 1000 : unrated(e.reception.verdict) ? 500 : 0), likes: e => e.metrics.likes,
    stars: e => e.github?.stars ?? -1, downloads: e => e.github?.downloads ?? -1, newest: e => Date.parse(e.created_at),
  };
  const key = $("sort").value;
  rows.sort((a, b) => sorts[key](b) - sorts[key](a));

  $("grid").innerHTML = rows.length ? rows.map(e => row(e)).join("")
    : `<li class="empty" style="grid-column:1/-1">${DATA.length ? "Nothing matches. Try another rating or clear the search." : "No clones yet. The first scan appears soon."}</li>`;

  // Titles: the view's name on top, and on Discover a few shelves above the full list
  const view = f === "rated" ? ["✨", "Discover"] : f === "all" ? ["🗂", "Everything"] : f === "gone" ? ["🗑", "Removed"] : rating(f).slice(1, 3);
  const discover = f === "rated" && !root._cat && !q && !pick && !useWant;
  root.querySelector(".store-head").classList.toggle("discover", discover);
  $("title").textContent = root._cat && f === "rated" ? `${CAT_ICON[root._cat] || ""} ${root._cat}` : discover ? "Discover" : `${view[0]} ${view[1]}${root._cat ? ` · ${root._cat}` : ""}`;
  $("listTitle").textContent = discover ? "All rated clones" : q ? "Search results" : `${rows.length} ${rows.length === 1 ? "clone" : "clones"}`;
  if (discover) {
    const top = list => [...list].sort((x, y) => y.reception.score - x.reception.score);
    const loved = top(by("well-received"));
    const rising = live.filter(e => growth(e) >= 5).sort((x, y) => growth(y) - growth(x));
    const promoted = top(live.filter(e => moved(e, 7)?.up));
    const newest = live.filter(e => Date.now() - Date.parse(e.created_at) < 7 * 864e5 && e.reception.verdict !== "stay-away")
      .sort((x, y) => y.metrics.likes - x.metrics.likes);
    // Two big picture cards, as an app store features its picks: ones with a screenshot
    const seen = new Set(), feats = [];
    // Not the ones already at the top of Most loved, unless nothing else has a picture
    for (const [e, eyebrow] of [...rising.map(e => [e, `📈 Rising · +${num(Math.round(growth(e)))} ★ a day`]), ...top(by("proven")).map(e => [e, "⭐ Proven on GitHub"]),
      ...loved.slice(6).map(e => [e, "❤️ Loved by the crowd"]), ...loved.slice(0, 6).map(e => [e, "❤️ Loved by the crowd"])]) {
      if (feats.length < 2 && e.thumb && !seen.has(e.id)) { seen.add(e.id); feats.push(feature(e, eyebrow)); }
    }
    $("discover").innerHTML = shelf("❤️ Most loved", loved, "well-received") +
      (feats.length ? `<section class="shelf-sec"><div class="features">${feats.join("")}</div></section>` : "") +
      shelf("📈 Rising on GitHub", rising, "", e => `<b class="up">+${num(Math.round(growth(e)))} ★/day</b>`) +
      shelf("⬆ Just promoted", promoted, "") +
      shelf("🆕 New this week", newest, "") +
      shelf("⭐ Proven on GitHub", top(by("proven")), "proven");
  }
  $("discover").hidden = !discover;

  const rej = [...(INFO.rejected_samples || [])].reverse().slice(0, 30);
  $("rejWrap").hidden = !rej.length;
  $("rej").innerHTML = rej.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">@${esc(p.author)}</a> <span>♥ ${num(p.likes)} · ${esc(p.at)}</span><small>${esc(p.text)}</small></li>`).join("");

  // Newsletter: the latest issue, then the archive
  // Haiku sometimes repeats the newsletter's name in the title
  const issues = (INFO.newsletter || []).map(n => ({ ...n, title: String(n.title || "").replace(/^this week in clones\s*[:–-]\s*/i, "") }));
  // Anyone can post an issue from their own X account, with its top picks and a link back
  const issueShare = n => `<a class="xshare" href="${esc(xIntent(`📰 This week in clones: ${n.title}\n\n${n.items.slice(0, 3).map(i => `${rating(i.verdict)[1]} ${i.name}`).join("\n")}\n\nRated by the crowd on Flattery:`, SITE + "#news"))}" target="_blank" rel="noopener" data-goat="share-newsletter">Share this issue on X</a>`;
  const issueHtml = (n, latest) => `<div class="issue">
      ${latest ? `<div class="issue-share">${issueShare(n)}</div>` : ""}
      <p class="issue-date">${latest ? "📰 This week in clones · " : ""}${esc(new Date(n.date + "T12:00:00Z").toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }))}</p>
      <h${latest ? 2 : 3}>${esc(n.title)}</h${latest ? 2 : 3}><p>${esc(n.intro)}</p>
      <ul>${n.items.map(i => `<li><button type="button" data-open="${esc(i.id)}">${rating(i.verdict)[1]} <b>${esc(i.name)}</b></button> ${esc(i.blurb)}</li>`).join("")}</ul>
      <p>${esc(n.outro)}</p>
      ${issueShare(n)}</div>`;
  // The newsletter lives in a drawer, so it never pushes the cards down
  const fresh = issues[0] && Date.now() - Date.parse(issues[0].date + "T12:00:00Z") < 7 * 864e5;
  $("newsDrawer").innerHTML = issues.length ? `<button type="button" class="close" aria-label="Close">×</button>` + issueHtml(issues[0], true) + (issues.length > 1
    ? `<details class="past"><summary>Past issues (${issues.length - 1})</summary>${issues.slice(1).map(n => issueHtml(n, false)).join("")}</details>` : "") : "";
  root.dataset.newsFresh = fresh ? "1" : "";

  const down = [...(INFO.removed_projects || [])].reverse();
  $("downWrap").hidden = !down.length;
  $("downTitle").textContent = `Taken down after objections (${down.length})`;
  $("down").innerHTML = down.map(r => `<li><b>${esc(r.name)}</b> <span>${esc(r.at)} · ${r.objections} objections</span></li>`).join("");

  // Status: scans run every 8 hours; this shows whether they do
  const runs = INFO.status || [];
  const last = Date.parse(INFO.generated_iso || runs.at(-1)?.at || 0);
  const hoursAgo = last ? (Date.now() - last) / 36e5 : null;
  const week = runs.filter(r => Date.now() - Date.parse(r.at) < 7 * 864e5);
  $("statusWrap").hidden = !runs.length && !last;
  $("statusBody").innerHTML = `<ul class="statuslist">
    <li>${hoursAgo == null ? "No scan yet" : hoursAgo < 10 ? "🟢 On schedule" : hoursAgo < 26 ? "🟡 Running late" : "🔴 Scans have stopped"} · last scan ${hoursAgo == null ? "never" : hoursAgo < 1 ? "under an hour ago" : `${Math.round(hoursAgo)} hours ago`}</li>
    <li>${week.length} scans in the last 7 days (expected about 21), ${num(week.reduce((s, r) => s + (r.added || 0), 0))} new posts, ${num(week.reduce((s, r) => s + (r.changed || 0), 0))} rating changes</li>
    ${INFO.month ? `<li>X reads this month: ${num(INFO.month.reads)} of ${num(INFO.month.cap)}${INFO.month.reads >= INFO.month.cap ? " (budget reached: scans pause reading X until next month)" : ""}</li>` : ""}
    <li>${num(live.length)} projects from ${num(DATA.reduce((s, e) => s + (e.posts?.length || 1), 0))} posts</li></ul>`;

  root.flattery = {
    // Show one app's alternatives (used by /alternatives/<app>/ pages)
    pick(name) {
      const sel = $("product");
      const opt = [...sel.options].find(o => o.value.toLowerCase() === String(name).toLowerCase());
      if (!opt) return;
      sel.value = opt.value;
      root._filter = "all";
      renderReport(root, root._data, root._info, opts);
      root.querySelector("#apps").scrollIntoView({ block: "start" });
    },
    news() {
      const d = $("newsDrawer");
      if (!d.innerHTML) return;
      if (!d.open) d.showModal();
      d.scrollTop = 0;
    },
    open(id) {
      // By card id, by one of its posts, or by project name, so old links survive id changes
      const key = s => String(s || "").toLowerCase().replace(/^(name|repo|post):/, "").replace(/[^a-z0-9]/g, "");
      const e = DATA.find(x => x.id === id) || DATA.find(x => x.posts?.some(p => p.id === id)) ||
        DATA.find(x => key(x.project) === key(id) || key(x.repo?.split("/")[1]) === key(id));
      if (!e) return;
      const [, emo, rname, rdesc, cls] = rating(e.reception.verdict);
      const m = e.metrics, s = e.sentiment, g = e.github && e.github.status !== "gone" ? e.github : null;
      const h = g?.stars_history || [];
      const days = h.length > 1 ? (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5 : 0;
      const growth = days >= 0.9 ? Math.round((h.at(-1).stars - h[0].stars) / days) : null;
      const fig = (v, t) => `<div><b>${v}</b><small>${t}</small></div>`;
      const sheet = $("sheet");
      sheet.className = `sheet r-${cls}`;
      const get = getLink(e);
      const u = usable(e);
      const otherGets = u && e.github.get ? Object.entries(e.github.get).filter(([os]) => os !== OS) : [];
      const xFig = `<div class="figures">${fig(num(m.likes), "likes")}${fig(num(m.reposts), "reposts")}${fig(num(m.replies), "replies")}${fig(num(m.quotes), "quotes")}${fig(num(m.bookmarks), "bookmarks")}${m.views ? fig(num(m.views), "views") : ""}</div>`;
      // Laid out like an app store page: picture, name, Get, rating, can I use it, what people
      // said; the evidence behind the rating folds under Details
      sheet.innerHTML = `
        <button type="button" class="close" aria-label="Close">×</button>
        <div class="art">${art(e)}</div>
        <div class="sheet-body">
          <div class="sheet-head">${icon(e, "icon big")}<div><h2>${esc(name(e))}</h2><p class="of">${esc(ofLine(e))}${price(e) ? ` <span class="save">saves ~$${price(e)}/yr</span>` : ""}</p></div></div>
          <div class="actions">
            ${get ? `<a class="primary" href="${esc(get.url)}" target="_blank" rel="noopener nofollow" title="${esc(get.title)}" data-goat="${get.label === "Get" ? "get" : "open"}">${esc(get.long)}</a>` : ""}
            ${e.repo && cls !== "danger" ? `<a${get ? "" : ' class="primary"'} href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener" data-goat="github">View on GitHub</a>` : ""}
            <a${get || (e.repo && cls !== "danger") ? "" : ' class="primary"'} href="${esc(e.url)}" target="_blank" rel="noopener" data-goat="post">The post on ${src(e)}</a>
            ${e.repo && cls === "danger" ? `<a href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener nofollow" data-goat="github">☠️ Repo (don't run it)</a>` : ""}
            <a href="${esc(pageUrl(e))}" data-share="${esc(e.id)}" data-url="${esc(pageUrl(e))}" data-goat="copy-link" onclick="event.preventDefault()">Copy link</a>
            ${cls !== "danger" ? `<a class="xshare fav" href="${esc(xIntent(`❤️ My favourite ${what(e) ? `free take on ${what(e)}` : "clone"}: ${name(e)}${e.summary ? `\n\n${e.summary}` : ""}\n\nRated ${emo} ${rname} by the crowd on Flattery:`, pageUrl(e)))}" target="_blank" rel="noopener" data-goat="share-favourite">❤️ Share as my favourite</a>` : ""}
            <a class="xshare" href="${esc(xIntent(`${emo} ${name(e)} is rated "${rname}" on Flattery, the crowd-rated catalog of software clones${what(e) ? ` (≈ ${what(e)})` : ""}.`, pageUrl(e)))}" target="_blank" rel="noopener" data-goat="share-x">Share on X</a>
          </div>
          <div class="verdict"><span class="emo">${emo}</span><span><b>${rname}</b><small>${rdesc}</small></span>
            <span class="big">${e.reception.score}<small>score</small></span></div>
          ${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
          ${s?.flags?.length ? `<div><h4>What people on ${src(e)} raised</h4><div class="chips">${s.flags.map(fl => `<span class="chip flag">${esc(fl.replaceAll("-", " "))}</span>`).join("")}</div>
            ${Object.entries(s.evidence || {}).length ? `<ul class="posts evidence">${Object.entries(s.evidence).flatMap(([fl, list]) => list.map(r => `<li>
              <span class="chip flag">${esc(fl.replaceAll("-", " "))}</span> <a href="${esc(r.url)}" target="_blank" rel="noopener">@${esc(r.author)}</a>
              <small>${esc(r.text)}</small></li>`)).join("")}</ul>` : ""}</div>` : ""}
          ${u ? `<div class="canuse"><h4>Can I use it?</h4><ul>
            <li>${u.ready === "install" ? `✅ Installers for ${esc(u.platforms.join(", "))}${otherGets.length ? `: ${otherGets.map(([os, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener nofollow" data-goat="get">${esc(os)}</a>`).join(" · ")}` : ""}` : u.ready === "online" ? `🌐 Runs online: <a href="${esc(u.homepage)}" target="_blank" rel="noopener nofollow" data-goat="open">${esc(u.homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : "📦 Source code only: you'd build it yourself"}${u.homepage && u.ready === "install" ? ` · <a href="${esc(u.homepage)}" target="_blank" rel="noopener nofollow" data-goat="open">website</a>` : ""}</li>
            <li>${u.licensed ? `✅ License: ${esc(e.github.license)}` : "⚠️ No license: by default nobody else may use, copy or change it"}</li>
            <li>${u.alive === "abandoned" ? `🪦 Looks abandoned: no changes for ${Math.round(u.days)} days${e.github.status === "archived" ? " (archived)" : ""}` : u.alive === "active" ? `✅ Maintained${u.commits ? `: ${u.commits} commits in the last 30 days` : ""}` : `⏸ Quiet lately: last change ${Math.round(u.days)} days ago`}</li>
          </ul></div>` : `<p class="note-small">${e.repo ? (g ? "This repo isn't the poster's own, so it isn't checked for installers." : "The linked repo was removed.") : "No GitHub repo linked yet, so it can't be installed or confirmed."}</p>`}
          ${s?.sampled ? `<div class="senti"><h4>What people said · ${s.sampled} replies and quotes${e.reception.confidence === "low" ? ' · <span class="low">low confidence</span>' : ""}</h4>${mini(s)}
            <p>${s.positive} positive · ${s.neutral} neutral · ${s.negative} negative${s.summary ? ` — “${esc(s.summary)}”` : ""}</p></div>` : ""}
          ${e.second_opinion ? `<p class="note-small">🔎 Second opinion (Claude Sonnet): ${e.second_opinion.agree ? "agrees" : "disagrees, so it's shown as Mixed"}. ${esc(e.second_opinion.note)}</p>` : ""}
          <div class="object"><h4>Tried it?</h4>
            <p class="note-small">Tell everyone on X whether it works. Each account counts once.${e.trials ? ` So far: <b>✅ ${e.trials.works} works · ❌ ${e.trials.broken} broken</b>.` : ""}</p>
            <a class="xobject" href="${esc(xIntent(`I tried ${name(e)}${what(e) ? ` (≈ ${what(e)})` : ""} and it works ✅ #FlatteryWorks ${e.code || ""}`, pageUrl(e)))}" target="_blank" rel="noopener" data-goat="works">✅ It works</a>
            <a class="xobject" href="${esc(xIntent(`I tried ${name(e)}${what(e) ? ` (≈ ${what(e)})` : ""} and it's broken ❌ #FlatteryBroken ${e.code || ""}`, pageUrl(e)))}" target="_blank" rel="noopener" data-goat="broken">❌ It's broken</a></div>
          <details class="more"><summary>Details: posts, numbers and how it was scored</summary><div class="more-body">
            ${altUrl(e) ? `<p><a href="${esc(altUrl(e))}">All ${esc(what(e))} alternatives →</a></p>` : ""}
            ${(e.history || []).length > 1 ? `<p class="note-small">Rating history: ${e.history.map(x => `${rating(x.verdict)[1]} ${esc(x.at.slice(5))}`).join(" → ")}</p>` : ""}
            ${e.text ? `<blockquote class="post">${esc(e.text)}<cite>${src(e) === "X" ? `@${esc(e.author.username)} · ${num(e.author.followers)} followers` : `${esc(e.author.username)} on ${src(e)}`} · ${esc((e.created_at || "").slice(0, 10))}${e.group ? " · most liked post" : ""}</cite></blockquote>` : '<p class="note-small">The post was removed from X.</p>'}
            ${e.group ? `<div><h4>${e.posts.length} posts about it · numbers below are added up</h4><ul class="posts">${e.posts.map(p => `<li${p.status === "gone" ? ' class="gone"' : ""}>
              <a href="${esc(p.url)}" target="_blank" rel="noopener">@${esc(p.author)}</a> <span>♥ ${num(p.likes)} · ${esc((p.created_at || "").slice(0, 10))}</span>
              <small>${esc(p.text) || "removed"}</small></li>`).join("")}</ul></div>` : ""}
            <div><h4>On ${src(e)}${e.group ? " · all posts" : ""}</h4>${xFig}</div>
            ${g ? `<div><h4>On GitHub · ${esc(e.repo)}</h4>${e.reception.repo_counted === false ? `<p class="note-small" style="margin-bottom:8px">This repo isn't the poster's own, so its stars and downloads don't count toward the rating.</p>` : ""}<div class="figures">${fig(num(g.stars), "stars")}${fig(num(g.forks), "forks")}${fig(num(g.downloads), "downloads")}${growth != null ? fig((growth >= 0 ? "+" : "") + num(growth), "stars a day") : ""}${fig(esc(g.license || "none"), "license")}</div>
              ${g.status === "archived" ? '<p class="note-small">This repo is archived.</p>' : ""}</div>` : ""}
            ${e.reception.reasons.length ? `<div class="chips">${e.reception.reasons.map(r => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}
            <p class="note-small">Score parts: ${Object.entries(e.reception.parts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}. Crowd opinion, not a legal or technical judgement.</p>
          </div></details>
          <div class="object"><h4>Is this listing wrong?</h4>
            <p class="note-small">Post an objection on X with your reason. When six or more established accounts object for real reasons, spread over at least two hours, the listing comes down by itself.${e.objections ? ` <b>⚑ ${e.objections} of 6 counted so far.</b>` : ""}</p>
            <a class="xobject" href="${esc(xIntent(`Please remove "${name(e)}" from Flattery (flattery.sala.company): <your reason> #FlatteryRemove ${e.code || ""}`))}" target="_blank" rel="noopener" data-goat="object">⚑ Object on X</a></div>
        </div>`;
      if (!sheet.open) sheet.showModal();
      if (location.protocol !== "file:" && !window.FLATTERY_OPEN) history.replaceState(null, "", "#p=" + encodeURIComponent(id));
      sheet.scrollTop = 0;
    },
  };
}

// Renders the catalog as an app store: hero with the rating legend, a shelf of the best
// loved, filters, a grid of cards, and a detail sheet per clone. Shared by the live page
// and the standalone report. opts.search: an <input> outside root to filter with.
// opts.base: where the catalog's files (thumbnails) live, relative to the page ("data/").
const RATINGS = [
  ["well-received", "❤️", "Loved", "Real use on GitHub and a real crowd on X, mostly positive.", "loved"],
  ["proven", "⭐", "Proven on GitHub", "Lots of stars or downloads on the poster's own repo, but quiet on X so far.", "proven"],
  ["unconfirmed", "🔥", "Hyped, unproven", "Lots of buzz on X, but no repo or one nobody uses yet.", "hype"],
  ["too-early", "🆕", "New & untested", "Too new or too small to judge yet.", "new"],
  ["mixed", "😐", "Mixed", "People are split on it.", "mixed"],
  ["stay-away", "☠️", "Don't touch", "Mostly negative, a pile-on, a removed repo, or red flags like scams or stolen code.", "danger"],
];

// Order for promotions and demotions
const RANK = { "stay-away": 0, "too-early": 1, mixed: 2, unconfirmed: 3, proven: 3.5, "well-received": 4 };
const SITE = "https://flattery.sala.company/";
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
  const name = e => e.project || e.repo?.split("/")[1] || what(e) && `${what(e)} clone` || "Untitled";
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
      <section class="hero">
        <div class="hero-copy">
          <div class="pills"><span class="pill accent" data-r="count"></span><span class="pill">Found on X · checked on GitHub</span></div>
          <h1>Software clones, <em>rated by the crowd.</em></h1>
          <p class="lede">Reverse-engineered, reimagined and cloned versions of apps you know, found on X and ranked by how people reacted: likes, reposts, the tone of the replies, and GitHub stars and downloads as proof.</p>
          <p class="quote">“Imitation is the sincerest form of flattery that mediocrity can pay to greatness.” — Oscar Wilde</p>
          <p class="status" data-r="status"></p>
        </div>
        <div class="legend"><h2>Ratings</h2><div data-r="legend"></div></div>
      </section>
      <section class="news" id="news" data-r="newsWrap"></section>
      <section class="fresh" data-r="riseWrap"><h2 class="section-title">📈 Rising on GitHub</h2><ul class="shelf" data-r="rise"></ul></section>
      <section class="fresh" data-r="upWrap"><h2 class="section-title">⬆ Just promoted</h2><ul class="shelf" data-r="up"></ul></section>
      <section class="fresh" data-r="shelfWrap"><h2 class="section-title">❤️ Most loved</h2><ul class="shelf" data-r="shelf"></ul></section>
      <section id="apps">
        <div class="cats" data-r="cats"></div>
        <div class="filters-row">
          <div class="filters" data-r="filters"></div>
          <div class="selects">
            ${search ? "" : `<input type="search" class="search" data-r="q" placeholder="Search clones…" aria-label="Search clones" style="padding-left:16px;height:40px;width:200px">`}
            <select data-r="product" aria-label="Clones of"></select>
            <select data-r="sort" aria-label="Sort">
              <option value="score">Top rated</option><option value="likes">Most liked</option><option value="stars">Most GitHub stars</option>
              <option value="downloads">Most downloads</option><option value="newest">Newest</option>
            </select>
          </div>
        </div>
        <ul class="grid" data-r="grid"></ul>
      </section>
      <details class="rejected" data-r="rejWrap"><summary>Recently left out by the filter</summary>
        <p class="note-small">Popular posts Claude Haiku judged not to be clone announcements.</p>
        <ul class="posts" data-r="rej"></ul></details>
      <details class="rejected" data-r="downWrap"><summary data-r="downTitle">Taken down after objections</summary>
        <p class="note-small">Listings removed automatically after enough people objected on X (six or more established accounts, real reasons, spread over time).</p>
        <ul class="posts" data-r="down"></ul></details>
      <details class="rejected" data-r="statusWrap"><summary>Status</summary><div data-r="statusBody"></div></details>
      <dialog class="sheet" data-r="sheet"></dialog>`;
    root.dataset.ready = "1";
    root._filter = "rated";
    const rerender = () => renderReport(root, root._data, root._info, opts);
    root.querySelectorAll("select,[data-r=q]").forEach(el => el.addEventListener("input", rerender));
    search?.addEventListener("input", rerender);
    root.addEventListener("click", ev => {
      const c = ev.target.closest("[data-cat]");
      if (c) { root._cat = root._cat === c.dataset.cat ? "" : c.dataset.cat; rerender(); return; }
      const f = ev.target.closest("[data-filter]");
      if (f) {
        root._filter = root._filter === f.dataset.filter && f.closest("[data-r=legend]") ? "all" : f.dataset.filter;
        rerender();
        if (f.closest("[data-r=legend]")) root.querySelector("#apps").scrollIntoView({ behavior: "smooth" });
        return;
      }
      const o = ev.target.closest("[data-open]");
      if (o) root.flattery.open(o.dataset.open);
    });
    const sheet = root.querySelector("[data-r=sheet]");
    sheet.addEventListener("click", ev => {
      if (ev.target === sheet || ev.target.closest(".close")) sheet.close();
      const share = ev.target.closest("[data-share]");
      if (share) {
        const url = location.href.split("#")[0] + "#p=" + encodeURIComponent(share.dataset.share);
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

  $("count").textContent = `${live.length} clones tracked`;
  if (search) search.placeholder = `Search ${live.length} clones…`;
  $("legend").innerHTML = RATINGS.map(([v, emo, name, desc, cls]) => `
    <button type="button" class="r-${cls}" data-filter="${v}" aria-pressed="${root._filter === v}">
      <span class="emo">${emo}</span><span><b>${name}</b><small>${desc}</small></span><span class="n">${by(v).length}</span>
    </button>`).join("");

  // Most loved: the well received first, topped up with the best of the rest
  const loved = by("well-received").sort((a, b) => b.reception.score - a.reception.score);
  $("shelfWrap").hidden = !loved.length;
  $("shelf").innerHTML = loved.slice(0, 12).map(e => `<li><button type="button" data-open="${esc(e.id)}">
    <div class="art">${art(e)}</div><span class="name">${esc(name(e))}</span>
    <span class="meta">❤️ ${e.reception.score} · ★ ${num(e.github?.stars)} · ${esc(what(e) || e.kind)}</span></button></li>`).join("");

  // Rising: the fastest-growing repos that count (the poster's own), by stars a day
  const growth = e => {
    const h = e.github?.stars_history || [];
    const days = h.length > 1 ? (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5 : 0;
    return days >= 0.9 && e.reception.repo_counted ? (h.at(-1).stars - h[0].stars) / days : 0;
  };
  const rising = live.filter(e => growth(e) >= 5).sort((a, b) => growth(b) - growth(a));
  $("riseWrap").hidden = !rising.length;
  $("rise").innerHTML = rising.slice(0, 12).map(e => `<li><button type="button" data-open="${esc(e.id)}"><div class="art">${art(e)}</div><span class="name">${esc(name(e))}</span>
    <span class="meta">+${num(Math.round(growth(e)))} ★ a day · ${rating(e.reception.verdict)[1]} ${esc(what(e) || e.kind)}</span></button></li>`).join("");

  const promoted = live.filter(e => moved(e, 7)?.up).sort((a, b) => b.reception.score - a.reception.score);
  $("upWrap").hidden = !promoted.length;
  $("up").innerHTML = promoted.slice(0, 12).map(e => {
    const [, pe] = rating(moved(e, 7).prev), [, ne] = rating(e.reception.verdict);
    return `<li><button type="button" data-open="${esc(e.id)}"><div class="art">${art(e)}</div><span class="name">${esc(name(e))}</span>
      <span class="meta">${pe} → ${ne} · ${esc(what(e) || e.kind)}</span></button></li>`;
  }).join("");

  const chips = [["rated", "Rated", live.length - by("too-early").length], ["all", "Everything", live.length], ...RATINGS.map(([v, emo, n]) => [v, `${emo} ${n}`, by(v).length])];
  const gone = DATA.length - live.length;
  if (gone) chips.push(["gone", "🗑 Removed", gone]);
  $("filters").innerHTML = chips.map(([v, t, n]) => `<button type="button" class="filter" data-filter="${v}" aria-pressed="${root._filter === v}">${t} <span class="n">${n}</span></button>`).join("");

  const counts = new Map();
  for (const e of live) if (what(e)) counts.set(what(e), (counts.get(what(e)) || 0) + 1);
  const pick = $("product").value;
  $("product").innerHTML = '<option value="">Clones of anything</option>' + [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([p, c]) => `<option value="${esc(p)}"${p === pick ? " selected" : ""}>${esc(p)} (${c})</option>`).join("");

  // Categories, like an app store
  const catCount = new Map();
  for (const e of live) if (e.category) catCount.set(e.category, (catCount.get(e.category) || 0) + 1);
  $("cats").innerHTML = catCount.size ? [["", "All categories", live.length], ...CATEGORIES.filter(c => catCount.has(c)).map(c => [c, c, catCount.get(c)])]
    .map(([v, t, n]) => `<button type="button" class="cat" data-cat="${esc(v)}" aria-pressed="${(root._cat || "") === v}">${esc(t)} <span class="n">${n}</span></button>`).join("") : "";

  const q = (search || $("q")).value.trim().toLowerCase();
  const f = root._filter;
  let rows = DATA.filter(e => (f === "gone" ? e.status === "gone" : e.status !== "gone" && (f === "all" || (f === "rated" ? e.reception.verdict !== "too-early" : e.reception.verdict === f))) &&
    (!pick || what(e) === pick) && (!root._cat || e.category === root._cat));
  if (q) rows = rows.filter(e => JSON.stringify([e.text, e.project, e.original, e.original_clean, e.category, e.summary, e.author?.username, e.repo, e.product, e.posts?.map(p => p.author)]).toLowerCase().includes(q));
  const sorts = {
    score: e => e.reception.score - (e.reception.verdict === "stay-away" ? 1000 : 0), likes: e => e.metrics.likes,
    stars: e => e.github?.stars ?? -1, downloads: e => e.github?.downloads ?? -1, newest: e => Date.parse(e.created_at),
  };
  const key = $("sort").value;
  rows.sort((a, b) => sorts[key](b) - sorts[key](a));

  $("grid").innerHTML = rows.length ? rows.map(e => {
    const [, emo, rname, , cls] = rating(e.reception.verdict);
    return `<li><article class="card r-${cls}${e.status === "gone" ? " gone" : ""}">
      <div class="art">${art(e)}<span class="rate"><i>${emo}</i>${rname}</span></div>
      <div class="card-body">
        <h3><button type="button" data-open="${esc(e.id)}">${esc(name(e))}</button></h3>
        <p class="of">${esc(ofLine(e))}${price(e) ? ` <span class="save">saves ~$${price(e)}/yr</span>` : ""}</p>
        ${moveLine(e)}
        ${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ""}
        <div class="stats"><span class="score">${e.reception.score}</span><span>♥ ${num(e.metrics.likes)}</span>
          ${e.github && e.github.status !== "gone" && e.reception.repo_counted !== false ? `<span>★ ${num(e.github.stars)}</span>${e.github.downloads ? `<span>⬇ ${num(e.github.downloads)}</span>` : ""}` : ""}
          <span>${e.group ? `${e.posts.length} posts` : `@${esc(e.author.username)}`}</span>${e.objections ? `<span class="obj" title="objections counted">⚑ ${e.objections}</span>` : ""}</div>
        ${mini(e.sentiment)}
      </div></article></li>`;
  }).join("") : `<li class="empty" style="grid-column:1/-1">${DATA.length ? "Nothing matches. Try another rating or clear the search." : "No clones yet. The first scan appears soon."}</li>`;

  const rej = [...(INFO.rejected_samples || [])].reverse().slice(0, 30);
  $("rejWrap").hidden = !rej.length;
  $("rej").innerHTML = rej.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">@${esc(p.author)}</a> <span>♥ ${num(p.likes)} · ${esc(p.at)}</span><small>${esc(p.text)}</small></li>`).join("");

  // Newsletter: the latest issue, then the archive
  const issues = INFO.newsletter || [];
  const issueHtml = (n, latest) => `<div class="issue">
      <p class="issue-date">${latest ? "📰 This week in clones · " : ""}${esc(new Date(n.date + "T12:00:00Z").toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }))}</p>
      <h${latest ? 2 : 3}>${esc(n.title)}</h${latest ? 2 : 3}><p>${esc(n.intro)}</p>
      <ul>${n.items.map(i => `<li><button type="button" data-open="${esc(i.id)}">${rating(i.verdict)[1]} <b>${esc(i.name)}</b></button> ${esc(i.blurb)}</li>`).join("")}</ul>
      <p>${esc(n.outro)}</p>
      <a class="xshare" href="${esc(xIntent(`📰 This week in clones: ${n.title}`, SITE + "#news=" + n.date))}" target="_blank" rel="noopener">Share on X</a></div>`;
  $("newsWrap").hidden = !issues.length;
  $("newsWrap").innerHTML = issues.length ? issueHtml(issues[0], true) + (issues.length > 1
    ? `<details class="past"><summary>Past issues (${issues.length - 1})</summary>${issues.slice(1).map(n => issueHtml(n, false)).join("")}</details>` : "") : "";

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
      sheet.innerHTML = `
        <button type="button" class="close" aria-label="Close">×</button>
        <div class="art">${art(e)}</div>
        <div class="sheet-body">
          <div><h2>${esc(name(e))}</h2><p class="of">${esc(ofLine(e))}</p></div>
          <div class="verdict"><span class="emo">${emo}</span><span><b>${rname}</b><small>${rdesc}</small></span>
            <span class="big">${e.reception.score}<small>score</small></span></div>
          ${(e.history || []).length > 1 ? `<p class="note-small">Rating history: ${e.history.map(x => `${rating(x.verdict)[1]} ${esc(x.at.slice(5))}`).join(" → ")}</p>` : ""}
          ${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
          <div class="actions">
            ${e.repo && cls !== "danger" ? `<a class="primary" href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener">View on GitHub</a>` : ""}
            <a${e.repo && cls !== "danger" ? "" : ' class="primary"'} href="${esc(e.url)}" target="_blank" rel="noopener">Open the post on X</a>
            ${e.repo && cls === "danger" ? `<a href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener nofollow">☠️ Repo (don't run it)</a>` : ""}
            <a href="#p=${encodeURIComponent(e.id)}" data-share="${esc(e.id)}" onclick="event.preventDefault()">Copy link</a>
            <a class="xshare" href="${esc(xIntent(`${emo} ${name(e)} is rated "${rname}" on Flattery, the crowd-rated catalog of software clones${what(e) ? ` (≈ ${what(e)})` : ""}.`, SITE + "#p=" + encodeURIComponent(e.id)))}" target="_blank" rel="noopener">Share on X</a>
          </div>
          ${e.text ? `<blockquote class="post">${esc(e.text)}<cite>@${esc(e.author.username)} · ${num(e.author.followers)} followers · ${esc((e.created_at || "").slice(0, 10))}${e.group ? " · most liked post" : ""}</cite></blockquote>` : '<p class="note-small">The post was removed from X.</p>'}
          ${e.group ? `<div><h4>${e.posts.length} posts about it · numbers below are added up</h4><ul class="posts">${e.posts.map(p => `<li${p.status === "gone" ? ' class="gone"' : ""}>
            <a href="${esc(p.url)}" target="_blank" rel="noopener">@${esc(p.author)}</a> <span>♥ ${num(p.likes)} · ${esc((p.created_at || "").slice(0, 10))}</span>
            <small>${esc(p.text) || "removed"}</small></li>`).join("")}</ul></div>` : ""}
          <div><h4>On X${e.group ? " · all posts" : ""}</h4><div class="figures">${fig(num(m.likes), "likes")}${fig(num(m.reposts), "reposts")}${fig(num(m.replies), "replies")}${fig(num(m.quotes), "quotes")}${fig(num(m.bookmarks), "bookmarks")}${m.views ? fig(num(m.views), "views") : ""}</div></div>
          ${s?.sampled ? `<div class="senti"><h4>What people said · ${s.sampled} replies and quotes${e.reception.confidence === "low" ? ' · <span class="low">low confidence</span>' : ""}</h4>${mini(s)}
            <p>${s.positive} positive · ${s.neutral} neutral · ${s.negative} negative${s.summary ? ` — “${esc(s.summary)}”` : ""}</p></div>` : ""}
          ${s?.flags?.length ? `<div><h4>What people on X raised</h4><div class="chips">${s.flags.map(fl => `<span class="chip flag">${esc(fl.replaceAll("-", " "))}</span>`).join("")}</div>
            ${Object.entries(s.evidence || {}).length ? `<ul class="posts evidence">${Object.entries(s.evidence).flatMap(([fl, list]) => list.map(r => `<li>
              <span class="chip flag">${esc(fl.replaceAll("-", " "))}</span> <a href="${esc(r.url)}" target="_blank" rel="noopener">@${esc(r.author)}</a>
              <small>${esc(r.text)}</small></li>`)).join("")}</ul>` : ""}</div>` : ""}
          ${g ? `<div><h4>On GitHub · ${esc(e.repo)}</h4>${e.reception.repo_counted === false ? `<p class="note-small" style="margin-bottom:8px">This repo isn't the poster's own, so its stars and downloads don't count toward the rating.</p>` : ""}<div class="figures">${fig(num(g.stars), "stars")}${fig(num(g.forks), "forks")}${fig(num(g.downloads), "downloads")}${growth != null ? fig((growth >= 0 ? "+" : "") + num(growth), "stars a day") : ""}${fig(esc(g.license || "none"), "license")}</div>
            ${g.status === "archived" ? '<p class="note-small">This repo is archived.</p>' : ""}</div>`
            : `<p class="note-small">${e.repo ? "The linked repo was removed." : "No GitHub repo linked yet, so it can't be confirmed."}</p>`}
          ${e.reception.reasons.length ? `<div class="chips">${e.reception.reasons.map(r => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}
          <div class="object"><h4>Is this listing wrong?</h4>
            <p class="note-small">Post an objection on X with your reason. When six or more established accounts object for real reasons, spread over at least two hours, the listing comes down by itself.${e.objections ? ` <b>⚑ ${e.objections} of 6 counted so far.</b>` : ""}</p>
            <a class="xobject" href="${esc(xIntent(`Please remove "${name(e)}" from Flattery (flattery.sala.company): <your reason> #FlatteryRemove ${e.code || ""}`))}" target="_blank" rel="noopener">⚑ Object on X</a></div>
          <p class="note-small">Score parts: ${Object.entries(e.reception.parts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}. Crowd opinion, not a legal or technical judgement.</p>
        </div>`;
      if (!sheet.open) sheet.showModal();
      if (location.protocol !== "file:") history.replaceState(null, "", "#p=" + encodeURIComponent(id));
      sheet.scrollTop = 0;
    },
  };
}

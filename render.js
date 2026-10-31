// Renders the catalog as an app store: hero with the rating legend, a shelf of the best
// loved, filters, a grid of cards, and a detail sheet per clone. Shared by the live page
// and the standalone report. opts.search: an <input> outside root to filter with.
const RATINGS = [
  ["well-received", "❤️", "Loved", "Popular on X, mostly positive replies, and real use on GitHub.", "loved"],
  ["unconfirmed", "🔥", "Hyped, unproven", "Lots of buzz on X, but no repo or one nobody uses yet.", "hype"],
  ["too-early", "🆕", "New & untested", "Too new or too small to judge yet.", "new"],
  ["mixed", "😐", "Mixed", "People are split on it.", "mixed"],
  ["stay-away", "☠️", "Don't touch", "Mostly negative, a pile-on, a removed repo, or red flags like scams or stolen code.", "danger"],
];

// Order for promotions and demotions
const RANK = { "stay-away": 0, "too-early": 1, mixed: 2, unconfirmed: 3, "well-received": 4 };

function renderReport(root, DATA, INFO, opts = {}) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (v || 0).toLocaleString("en", { notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });
  const rating = v => RATINGS.find(r => r[0] === v) || RATINGS[3];
  const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
  const what = e => e.product ? label(e.product) : e.original;
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
    const shot = e.github?.image && e.github.status !== "gone"
      ? `<img src="${esc(e.github.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
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
      <section class="fresh" data-r="upWrap"><h2 class="section-title">⬆ Just promoted</h2><ul class="shelf" data-r="up"></ul></section>
      <section class="fresh" data-r="shelfWrap"><h2 class="section-title">❤️ Most loved</h2><ul class="shelf" data-r="shelf"></ul></section>
      <section id="apps">
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
      <dialog class="sheet" data-r="sheet"></dialog>`;
    root.dataset.ready = "1";
    root._filter = "all";
    const rerender = () => renderReport(root, root._data, root._info, opts);
    root.querySelectorAll("select,[data-r=q]").forEach(el => el.addEventListener("input", rerender));
    search?.addEventListener("input", rerender);
    root.addEventListener("click", ev => {
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
    sheet.addEventListener("click", ev => { if (ev.target === sheet || ev.target.closest(".close")) sheet.close(); });
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

  const promoted = live.filter(e => moved(e, 7)?.up).sort((a, b) => b.reception.score - a.reception.score);
  $("upWrap").hidden = !promoted.length;
  $("up").innerHTML = promoted.slice(0, 12).map(e => {
    const [, pe] = rating(moved(e, 7).prev), [, ne] = rating(e.reception.verdict);
    return `<li><button type="button" data-open="${esc(e.id)}"><div class="art">${art(e)}</div><span class="name">${esc(name(e))}</span>
      <span class="meta">${pe} → ${ne} · ${esc(what(e) || e.kind)}</span></button></li>`;
  }).join("");

  const chips = [["all", "All", live.length], ...RATINGS.map(([v, emo, n]) => [v, `${emo} ${n}`, by(v).length])];
  const gone = DATA.length - live.length;
  if (gone) chips.push(["gone", "🗑 Removed", gone]);
  $("filters").innerHTML = chips.map(([v, t, n]) => `<button type="button" class="filter" data-filter="${v}" aria-pressed="${root._filter === v}">${t} <span class="n">${n}</span></button>`).join("");

  const counts = new Map();
  for (const e of live) if (what(e)) counts.set(what(e), (counts.get(what(e)) || 0) + 1);
  const pick = $("product").value;
  $("product").innerHTML = '<option value="">Clones of anything</option>' + [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([p, c]) => `<option value="${esc(p)}"${p === pick ? " selected" : ""}>${esc(p)} (${c})</option>`).join("");

  const q = (search || $("q")).value.trim().toLowerCase();
  const f = root._filter;
  let rows = DATA.filter(e => (f === "gone" ? e.status === "gone" : e.status !== "gone" && (f === "all" || e.reception.verdict === f)) &&
    (!pick || what(e) === pick));
  if (q) rows = rows.filter(e => JSON.stringify([e.text, e.project, e.original, e.summary, e.author?.username, e.repo, e.product]).toLowerCase().includes(q));
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
        <p class="of">${esc(ofLine(e))}</p>
        ${moveLine(e)}
        ${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ""}
        <div class="stats"><span class="score">${e.reception.score}</span><span>♥ ${num(e.metrics.likes)}</span>
          ${e.github && e.github.status !== "gone" ? `<span>★ ${num(e.github.stars)}</span>${e.github.downloads ? `<span>⬇ ${num(e.github.downloads)}</span>` : ""}` : ""}
          <span>@${esc(e.author.username)}</span></div>
        ${mini(e.sentiment)}
      </div></article></li>`;
  }).join("") : `<li class="empty" style="grid-column:1/-1">${DATA.length ? "Nothing matches. Try another rating or clear the search." : "No clones yet. The first scan appears soon."}</li>`;

  root.flattery = {
    open(id) {
      const e = DATA.find(x => x.id === id);
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
          </div>
          ${e.text ? `<blockquote class="post">${esc(e.text)}<cite>@${esc(e.author.username)} · ${num(e.author.followers)} followers · ${esc((e.created_at || "").slice(0, 10))}</cite></blockquote>` : '<p class="note-small">The post was removed from X.</p>'}
          <div><h4>On X</h4><div class="figures">${fig(num(m.likes), "likes")}${fig(num(m.reposts), "reposts")}${fig(num(m.replies), "replies")}${fig(num(m.quotes), "quotes")}${fig(num(m.bookmarks), "bookmarks")}${m.views ? fig(num(m.views), "views") : ""}</div></div>
          ${s?.sampled ? `<div class="senti"><h4>What people said · ${s.sampled} replies and quotes</h4>${mini(s)}
            <p>${s.positive} positive · ${s.neutral} neutral · ${s.negative} negative${s.summary ? ` — “${esc(s.summary)}”` : ""}</p></div>` : ""}
          ${s?.flags?.length ? `<div><h4>Red flags people raised</h4><div class="chips">${s.flags.map(fl => `<span class="chip flag">${esc(fl.replaceAll("-", " "))}</span>`).join("")}</div></div>` : ""}
          ${g ? `<div><h4>On GitHub · ${esc(e.repo)}</h4><div class="figures">${fig(num(g.stars), "stars")}${fig(num(g.forks), "forks")}${fig(num(g.downloads), "downloads")}${growth != null ? fig((growth >= 0 ? "+" : "") + num(growth), "stars a day") : ""}${fig(esc(g.license || "none"), "license")}</div>
            ${g.status === "archived" ? '<p class="note-small">This repo is archived.</p>' : ""}</div>`
            : `<p class="note-small">${e.repo ? "The linked repo was removed." : "No GitHub repo linked yet, so it can't be confirmed."}</p>`}
          ${e.reception.reasons.length ? `<div class="chips">${e.reception.reasons.map(r => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}
          <p class="note-small">Score parts: ${Object.entries(e.reception.parts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}. Crowd opinion, not a legal or technical judgement.</p>
        </div>`;
      if (!sheet.open) sheet.showModal();
      sheet.scrollTop = 0;
    },
  };
}

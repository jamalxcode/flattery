// Renders the catalog. Shared by the live page and the standalone report.
function renderReport(root, DATA, INFO) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (v || 0).toLocaleString("en", { notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });
  const VERDICTS = [
    ["well-received", "Well received", "ok"], ["unconfirmed", "Buzz, not confirmed", "re"], ["mixed", "Mixed", "mid"],
    ["stay-away", "Stay away", "hi"], ["too-early", "Too early", "lo"],
  ];
  const vName = v => VERDICTS.find(x => x[0] === v)?.[1] || v;
  const vCls = v => VERDICTS.find(x => x[0] === v)?.[2] || "lo";
  const label = p => p.vendor === p.name ? p.name : `${p.vendor} ${p.name}`;
  const what = e => e.product ? label(e.product) : e.original;

  if (!root.dataset.ready) {
    root.innerHTML = `
      <p class="sub" data-r="sub"></p>
      <div class="stats" data-r="stats"></div>
      <div class="controls">
        <input type="search" data-r="q" placeholder="Filter by project, author, product…" aria-label="Filter">
        <label>Verdict <select data-r="verdict">
          <option value="well-received">well received</option><option value="good">well received + buzz</option>
          <option value="all">all</option>${VERDICTS.map(([v, n]) => `<option value="${v}">${n.toLowerCase()}</option>`).join("")}
        </select></label>
        <label>Kind <select data-r="kind">
          <option value="">any</option><option value="clone">clone</option><option value="reverse-engineered">reverse-engineered</option>
          <option value="reimagined">reimagined</option><option value="port">port</option>
        </select></label>
        <label>Of <select data-r="product"></select></label>
        <label>Sort <select data-r="sort">
          <option value="score">Reception</option><option value="likes">Likes</option><option value="stars">GitHub stars</option>
          <option value="downloads">Downloads</option><option value="newest">Newest</option>
        </select></label>
        <label><input type="checkbox" data-r="gone"> show removed</label>
      </div>
      <div data-r="list"></div>`;
    root.dataset.ready = "1";
    root.querySelectorAll("input,select").forEach(el => el.addEventListener("input", () => renderReport(root, DATA, INFO)));
  }
  const $ = k => root.querySelector(`[data-r=${k}]`);
  // A new data set opens on the well-received list when it has any
  if (root._data !== DATA) {
    root._data = DATA;
    $("verdict").value = DATA.some(e => e.reception.verdict === "well-received") ? "well-received" : "all";
  }

  const live = DATA.filter(e => e.status !== "gone");
  $("sub").textContent = `${INFO.generated ? "Updated " + INFO.generated + " · " : ""}${live.length} clones found on X`;
  const by = v => live.filter(e => e.reception.verdict === v).length;
  $("stats").innerHTML = [
    [by("well-received"), "well received, confirmed on GitHub"],
    [by("unconfirmed"), "buzz on X, not confirmed on GitHub"],
    [by("mixed"), "mixed reception"],
    [by("stay-away"), "stay away"],
    [by("too-early"), "too early to tell"],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${esc(s)}</span></div>`).join("");

  const counts = new Map();
  for (const e of live) if (what(e)) counts.set(what(e), (counts.get(what(e)) || 0) + 1);
  const pick = $("product").value;
  $("product").innerHTML = '<option value="">anything</option>' + [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([p, c]) => `<option value="${esc(p)}"${p === pick ? " selected" : ""}>${esc(p)} (${c})</option>`).join("");

  const q = $("q").value.trim().toLowerCase(), verdict = $("verdict").value, kind = $("kind").value, key = $("sort").value;
  let rows = DATA.filter(e => ($("gone").checked || e.status !== "gone") &&
    (verdict === "all" || e.reception.verdict === verdict || (verdict === "good" && ["well-received", "unconfirmed"].includes(e.reception.verdict))) &&
    (!kind || e.kind === kind) && (!pick || what(e) === pick));
  if (q) rows = rows.filter(e => JSON.stringify([e.text, e.project, e.original, e.summary, e.author, e.repo]).toLowerCase().includes(q));
  const sorts = {
    score: e => e.reception.score, likes: e => e.metrics.likes, stars: e => e.github?.stars ?? -1,
    downloads: e => e.github?.downloads ?? -1, newest: e => Date.parse(e.created_at),
  };
  rows.sort((a, b) => sorts[key](b) - sorts[key](a));
  if (!rows.length) {
    $("list").innerHTML = `<div class="empty">${DATA.length ? "Nothing matches. Try another verdict or “all”." : "No results yet."}</div>`;
    return;
  }

  const sentimentBar = s => {
    if (!s?.sampled) return "";
    const pc = n => Math.round(100 * n / s.sampled);
    return `<div class="senti" title="${s.sampled} replies and quotes read">
      <i><em class="pos" style="width:${pc(s.positive)}%"></em><em class="neu" style="width:${pc(s.neutral)}%"></em><em class="neg" style="width:${pc(s.negative)}%"></em></i>
      <span><b class="pos">${s.positive}</b> positive · ${s.neutral} neutral · <b class="neg">${s.negative}</b> negative</span></div>`;
  };
  const githubBox = e => {
    const g = e.github;
    if (!e.repo) return '<div class="gh none">No GitHub repo linked</div>';
    const link = `<a href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener">${esc(e.repo)}</a>`;
    if (!g) return `<div class="gh">${link} <span class="muted">not checked yet</span></div>`;
    if (g.status === "gone") return `<div class="gh">${link} <span class="chip gone">repo removed</span></div>`;
    const h = g.stars_history || [];
    const days = h.length > 1 ? (Date.parse(h.at(-1).at) - Date.parse(h[0].at)) / 864e5 : 0;
    const growth = days >= 0.9 ? Math.round((h.at(-1).stars - h[0].stars) / days) : null;
    return `<div class="gh${e.reception.confirmed ? " ok" : ""}">${link}
      <span>★ ${num(g.stars)}</span><span>⑂ ${num(g.forks)}</span><span>⬇ ${num(g.downloads)} downloads</span>
      ${growth != null ? `<span>${growth >= 0 ? "+" : ""}${num(growth)} stars/day</span>` : ""}
      ${g.language ? `<span>${esc(g.language)}</span>` : ""}<span>license ${esc(g.license || "none")}</span>
      ${g.status === "archived" ? '<span class="chip moved">archived</span>' : ""}</div>`;
  };

  $("list").innerHTML = rows.map(e => {
    const m = e.metrics, r = e.reception;
    return `
    <div class="card${e.status === "gone" ? " is-gone" : ""}">
      <div class="score"><div class="big ${vCls(r.verdict)}">${r.score}</div><div class="lbl">reception</div></div>
      <div class="body">
        <span class="verdict ${vCls(r.verdict)}">${esc(vName(r.verdict))}</span>
        <span class="name">${esc(e.project || e.repo?.split("/")[1] || "Untitled project")}</span>
        ${what(e) ? `<span class="chip product">≈ ${esc(what(e))}</span>` : ""}
        <span class="chip kind">${esc(e.kind)}</span>
        ${e.status === "gone" ? `<span class="chip gone">post removed${e.gone_since ? " since " + esc(e.gone_since) : ""}</span>` : ""}
        ${e.summary ? `<div class="desc">${esc(e.summary)}</div>` : ""}
        <blockquote class="post"><p>${esc(e.text) || "<i>post removed</i>"}</p><cite><a href="${esc(e.url)}" target="_blank" rel="noopener">@${esc(e.author.username)}</a> · ${num(e.author.followers)} followers · ${esc((e.created_at || "").slice(0, 10))}</cite></blockquote>
        <div class="meta">
          <span>♥ ${num(m.likes)}</span><span>⟲ ${num(m.reposts)}</span><span>💬 ${num(m.replies)}</span><span>❝ ${num(m.quotes)}</span>
          <span>🔖 ${num(m.bookmarks)}</span>${m.views ? `<span>👁 ${num(m.views)}</span>` : ""}
        </div>
        ${sentimentBar(e.sentiment)}
        ${e.sentiment?.summary ? `<div class="desc">“${esc(e.sentiment.summary)}”</div>` : ""}
        ${githubBox(e)}
        <div class="chips">
          ${(e.sentiment?.flags || []).map(f => `<span class="chip flag">${esc(f.replaceAll("-", " "))}</span>`).join("")}
          ${r.reasons.filter(s => e.repo || !/^no GitHub repo/.test(s)).map(s => `<span class="chip note">${esc(s)}</span>`).join("")}
        </div>
        <details><summary>score parts</summary>${Object.entries(r.parts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}<br>found by: ${e.found_by.map(esc).join("<br>")}</details>
      </div>
    </div>`;
  }).join("");
}

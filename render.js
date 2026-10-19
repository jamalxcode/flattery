// Renders a results list. Shared by the live app and the downloaded standalone report.
function renderReport(root, DATA, INFO) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cls = v => v >= 60 ? "hi" : v >= 35 ? "mid" : "lo";
  const bar = (label, v, color) => `<span class="bar">${label}<i><em style="width:${v}%;background:${color}"></em></i><b>${v}</b></span>`;

  if (!root.dataset.ready) {
    root.innerHTML = `
      <p class="sub" data-r="sub"></p>
      <div data-r="banner"></div>
      <div class="stats" data-r="stats"></div>
      <div class="controls">
        <input type="search" data-r="q" placeholder="Filter by name, description, signal…" aria-label="Filter">
        <label>Sort <select data-r="sort">
          <option value="combined">Combined score</option>
          <option value="ai_score">AI-built score</option>
          <option value="reimpl_score">Reimplementation score</option>
          <option value="stars">Stars</option>
          <option value="created">Newest</option>
        </select></label>
        <label>Min combined <select data-r="min">
          <option value="0">any</option><option value="20">20+</option><option value="40">40+</option><option value="60">60+</option>
        </select></label>
      </div>
      <div data-r="list"></div>`;
    root.dataset.ready = "1";
    root.querySelectorAll("[data-r=q],[data-r=sort],[data-r=min]").forEach(el => el.addEventListener("input", () => renderReport(root, DATA, INFO)));
  }
  const $ = k => root.querySelector(`[data-r=${k}]`);

  $("sub").textContent = `${INFO.generated ? "Generated " + INFO.generated + " · " : ""}${DATA.length} repositories analysed` +
    (INFO.target ? ` · target: “${INFO.target}”` : "") + (INFO.original ? ` · original: ${INFO.original}` : "");
  $("banner").innerHTML = INFO.demo ? '<div class="banner">Demo data. These repositories are invented to preview the layout.</div>' : "";

  const n = k => DATA.filter(r => r[k] >= 60).length;
  const stats = [
    [DATA.length, "repos analysed"],
    [n("combined"), "likely AI-built reimplementations (60+)"],
    [n("ai_score"), "strong AI-built signals"],
    [n("reimpl_score"), "strong reimplementation claims"],
  ];
  if (INFO.original) stats.push([DATA.filter(r => r.orig_signals.length).length, "flagged vs original"]);
  $("stats").innerHTML = stats.map(([b, s]) => `<div class="stat"><b>${b}</b><span>${esc(s)}</span></div>`).join("");

  const q = $("q").value.trim().toLowerCase();
  const key = $("sort").value, min = +$("min").value;
  let rows = DATA.filter(r => r.combined >= min);
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  rows.sort((a, b) => key === "created" ? b.created.localeCompare(a.created) : b[key] - a[key]);
  if (!rows.length) {
    $("list").innerHTML = `<div class="empty">${DATA.length ? "No repositories match. Try lowering the minimum score." : "No results yet."}</div>`;
    return;
  }
  $("list").innerHTML = rows.map(r => `
    <div class="card">
      <div class="score"><div class="big ${cls(r.combined)}">${r.combined}</div><div class="lbl">combined</div></div>
      <div class="body">
        <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a>
        <div class="desc">${esc(r.description) || "<i>no description</i>"}</div>
        <div class="meta">
          <span>★ ${r.stars.toLocaleString()}</span>${r.language ? `<span>${esc(r.language)}</span>` : ""}
          <span>license ${esc(r.license || "none")}</span><span>created ${esc(r.created)}</span>
          <span>${r.commits_sampled}${r.commits_sampled === 100 ? "+" : ""} commits</span><span>${r.file_count} files</span>
          ${r.path_overlap != null ? `<span>overlap ${Math.round(r.path_overlap * 100)}%</span>` : ""}
        </div>
        <div class="bars">${bar("AI-built", r.ai_score, "var(--ai)")}${bar("Reimpl.", r.reimpl_score, "var(--re)")}</div>
        <div class="chips">
          ${r.ai_signals.map(s => `<span class="chip ai">${esc(s.label)} +${s.points}</span>`).join("")}
          ${r.reimpl_signals.map(s => `<span class="chip re">${esc(s.label)} +${s.points}</span>`).join("")}
          ${r.orig_signals.map(s => `<span class="chip orig">${esc(s.label)}</span>`).join("")}
        </div>
        <details><summary>found by</summary>${r.found_by.map(esc).join("<br>")}</details>
      </div>
    </div>`).join("");
}

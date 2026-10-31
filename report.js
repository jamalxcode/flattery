// Builds a standalone HTML report: the stylesheet and renderer inlined, with the data embedded.
// Used by the scheduled scan (tools/scan.mjs).
export function reportHtml({ css, renderJs, noteHtml, results, info }) {
  const safe = v => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flattery report</title><style>${css}</style></head>
<body><main class="wrap">
<div id="report"></div>
<section class="about">${noteHtml}</section>
</main>
<script>${renderJs}
renderReport(document.getElementById("report"), ${safe(results)}, ${safe(info)});
document.querySelector("[data-r=status]").textContent = ${safe(info.generated ? "Generated " + info.generated : "")};
<\/script></body></html>`;
}

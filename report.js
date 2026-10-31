// Builds a standalone HTML report: the stylesheet and renderer inlined, with the data embedded.
// Used by the scheduled scan (tools/scan.mjs).
export function reportHtml({ css, renderJs, noteHtml, results, info }) {
  const safe = v => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flattery report</title><style>${css}</style></head>
<body><div class="wrap">
<header><h1>Flattery report</h1>
<blockquote>“Imitation is the sincerest form of flattery that mediocrity can pay to greatness.”<cite>— Oscar Wilde</cite></blockquote></header>
<div id="report"></div>
<div class="note">${noteHtml}</div>
</div>
<script>${renderJs}
renderReport(document.getElementById("report"), ${safe(results)}, ${safe(info)});
<\/script></body></html>`;
}

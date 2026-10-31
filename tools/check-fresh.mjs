// Freshness check for the live site: fails (exit 1) when the published catalog stops updating,
// even if every scan "succeeds". Run hourly by .github/workflows/freshness.yml; a failure there
// sends GitHub's failed-workflow email. Same approach as heat.sala.company.
//   node tools/check-fresh.mjs [site URL]      (default https://flattery.sala.company)
const SITE = (process.argv[2] || process.env.SITE_URL || "https://flattery.sala.company").replace(/\/$/, "");
const HOUR = 36e5;

// Scans run every 8 hours; 11 hours leaves room for one late run
const LIMIT = 11 * HOUR;
const problems = [];
const say = (ok, what) => { console.log(`${ok ? "ok  " : "LATE"} ${what}`); if (!ok) problems.push(what); };

try {
  const d = await (await fetch(`${SITE}/data/latest.json?b=${Date.now()}`, { signal: AbortSignal.timeout(30e3) })).json();
  const age = Date.now() - Date.parse(d.info?.generated_iso);
  say(Number.isFinite(age) && age <= LIMIT, `catalog last built ${Number.isFinite(age) ? (age / HOUR).toFixed(1) + " h ago" : "never"} (limit ${LIMIT / HOUR} h)`);
  const shown = (d.groups || []).filter(g => g.status === "ok").length;
  say(shown > 0, `${shown} projects on the page`);
  const month = d.info?.month;
  if (month) say(month.reads < month.cap, `X reads this month: ${month.reads} of ${month.cap}${month.reads >= month.cap ? " (cap reached: scans can't read X until next month)" : ""}`);
} catch (e) { say(false, `catalog unreadable: ${e.message}`); }
try {
  const res = await fetch(`${SITE}/?b=${Date.now()}`, { signal: AbortSignal.timeout(30e3) });
  say(res.ok, `home page answers (${res.status})`);
} catch (e) { say(false, `home page unreachable: ${e.message}`); }

if (problems.length) { console.error(`\n${problems.length} problem(s): ${problems.join("; ")}`); process.exit(1); }
console.log("\nthe site is up to date");

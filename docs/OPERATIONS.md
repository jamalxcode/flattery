# Flattery: running it

How Flattery is set up, how it keeps itself running, and what to do by hand. For the rules it applies, see [Business rules](BUSINESS-RULES.md); for why, see [Development decisions](DECISIONS.md).

## Setup

### Secrets

**Settings → Secrets and variables → Actions**:

| Secret | Needed | For |
|---|---|---|
| `X_BEARER_TOKEN` | yes | X API v2: recent and full-archive search, post lookup, quote posts |
| `ANTHROPIC_API_KEY` | yes | Claude Haiku (triage, replies, names, comparisons, newsletter) and Sonnet (second opinion) |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | no | Only if the site should post on X by itself: the weekly newsletter and newly loved projects, once each, with a link back. These are the app's keys with *Read and write* permission and the account's access token. Without them nothing is posted. |

The Actions token covers GitHub.

### Variables

| Variable | Default | For |
|---|---|---|
| `X_MONTHLY_READS` | 60,000 | Scans stop reading X past it until the month turns |
| `X_COST_PER_READ` | none | Logs each run's estimated X cost |

### Config files

| File | Holds |
|---|---|
| [`products.js`](../products.js) | Well-known paid products to search for (add a line to search one) |
| [`established.json`](../established.json) | The hand-picked 🏛️ Established apps |
| [`overrides.json`](../overrides.json) | Manual corrections, applied every scan: `attach` puts a post into a project, `repo` gives a post a repo it didn't link, `separate` stops a merge, `hide` drops a post, `owned` says whose a repo is |
| [`suggest.json`](../suggest.json) | The two ntfy.sh channels (suggestions in, alerts out) |

### Domain

flattery.sala.company (`CNAME`; DNS: CNAME `flattery` → `jamalxcode.github.io`).

## Running a scan by hand

**Actions → Scan and deploy → Run workflow** takes these inputs:

| Input | What it does |
|---|---|
| `max_reads` | X read limit for this run (default 1,000) |
| `backfill_days` | Also search X's full archive that far back for popular clones |
| `search`, `search_days` | Names to look for, comma-separated, and how far back |
| `repos` | GitHub repos to add (links or `owner/repo`). X posts from the last 6 months linking them are found and rated; mature ones that aren't clones are checked for 🏛️ Established. |

Pushing to `main` also runs a full scan and deploy, which spends X and Claude credit.

## Keeping itself running

- **Timers:** GitHub's own schedules run late and sometimes not at all, so cron-job.org starts the workflows through GitHub's API (the same setup as heat.sala.company). It uses a fine-grained token limited to this repo (*Actions: read and write*), and each job sends `POST https://api.github.com/repos/jamalxcode/flattery/actions/workflows/<file>/dispatches` with the body `{"ref":"main"}`.
  - `pages.yml` (scan and deploy) at 00:17, 08:17 and 16:17 UTC.
  - `freshness.yml` every hour at :41.
  - GitHub's schedules stay on as a backup.
  - ⚠️ The token expires: renew it in the cron-job.org jobs before it does.
- **Freshness check** (`freshness.yml`, `tools/check-fresh.mjs`): fails, and GitHub emails the owner, when the live catalog is over 11 hours old, the page shows no projects, the monthly X read cap is reached, or the site is down. It also cancels deploys GitHub left stuck.
- **Never paused:** GitHub pauses scheduled workflows after 60 days without commits, so each scan re-enables its own workflow.
- **Never shrinks:** a scan refuses to save a catalog smaller than the last. If X, Haiku or GitHub fails, the last good data stays published.
- **Self-check:** every scan logs any card whose posts link a GitHub repo it doesn't show, and the page's Status section shows ✅ or ⚠️.
- **Status:** the bottom of the page shows the last scan, scans in the last 7 days, X reads this month and the self-check.

## Before merging

`pr-check.yml` runs on every pull request to `main`:

1. `npm test`: the whole pipeline offline, against stubbed X, Haiku and GitHub.
2. `tools/ui-check.mjs`: opens the page in Chromium with the real catalog, on a desktop and a phone. It checks rows, Discover, search, the sidebar, the detail sheet, How it works, the Suggest page, script errors, sideways scrolling, and runs an axe-core accessibility audit (serious or critical problems fail it).

## Workflows

| Workflow | When | What |
|---|---|---|
| `pages.yml` (Scan and deploy) | push to `main`, every 8 h, cron-job.org, manual | Scan, draw share cards, save the catalog to the `data` branch, generate pages, deploy to GitHub Pages |
| `pr-check.yml` | pull requests | Tests and the browser check |
| `freshness.yml` | hourly | Live catalog freshness check |
| `check-domain.yml`, `check-site.yml` | manual | Diagnostics |

## Costs

GitHub, GitHub Pages, cron-job.org, ntfy.sh and GoatCounter are free. The X API (about 220 reads a scan, capped at `X_MONTHLY_READS`) and Claude (a few dollars a month) are paid from prepaid credit.

Turn off auto-recharge on both so nothing is ever charged beyond the credit. If either runs out, scans keep the last data but stop finding and rating, and the freshness check emails you.

# Flattery

> “Imitation is the sincerest form of flattery.” Hence the name: every project here imitates software you already know.

An app store of free clones of the apps you pay for: reverse-engineered, reimagined, white-room and vibe-coded copies. They're found on X and Hacker News, rated by how people reacted, and confirmed with GitHub stars and downloads.

**See it:** https://flattery.sala.company/ · [Free alternatives](https://flattery.sala.company/alternatives/) · [Stats](https://flattery.sala.company/stats/) · [RSS](https://flattery.sala.company/data/feed.xml) · [JSON](https://flattery.sala.company/data/latest.json)

Everything runs by itself. Nobody reviews listings, ratings, objections or the newsletter by hand: a scan every 8 hours finds, rates and re-rates projects, and the site rebuilds itself.

## The site

- **App store layout:** a sidebar of views and categories (chips on phones) and rows of apps. Each row has an icon, the name, what it clones, likes, stars and installers, and the rating where the price would be.
  - Views: Everything, Discover, and one per rating.
  - Discover shows Most loved, two featured picks, Rising on GitHub, Just promoted, New this week and Proven, then every rated clone.
- **Ratings:** ❤️ Loved, ⭐ Proven on GitHub, 🔥 Hyped (unproven), 😐 Mixed, 🆕 New & untested, 🌫️ Didn't catch on and ☠️ Don't touch. The chosen view explains itself in one line. The rules are under [Ratings](#ratings).
- **Detail sheet**, laid out like an app store page:
  - the screenshot, icon and name;
  - **Get** or **Open**;
  - the rating, and what people said;
  - *Compared with the original*: what it does (✓), what's missing (✗), whether it opens the original's files, and a verdict;
  - *Can I use it?*: installers, license, and whether it's maintained or 🪦 abandoned.
  - The posts, numbers and score parts fold under **Details**.
- **Get / Open:**
  - **Get** downloads the installer for the visitor's system from the project's newest GitHub release (`.dmg`, `.exe`/`.msi`, `.AppImage`, `.apk`; universal or Apple-chip builds on Mac, x64 on Windows and Linux). It's offered only for ❤️ and ⭐ apps whose repo is at least 2 weeks old with 50+ stars, with a note that Flattery doesn't check downloads.
  - **Open** links a project's web app, for anything but ☠️.
- **Icons:** the README's logo or the organisation's avatar, or the maker's X picture when the poster built it, with initials as the fallback. They're copied to the `data` branch, never hot-linked; SVG is skipped.
- **Sharing**, from the visitor's own X account: ❤️ *Share as my favourite*, *Share on X* and *Copy link* on every app, and *Share this issue on X* in the newsletter. Each project has its own page, `p/<code>/`, with its own preview image (`data/og/<code>.png`), so a shared link shows that project.
- **Newsletter:** *This week in clones*, written weekly by Haiku from the week's rating changes. It opens in a drawer (📰) that never covers the cards, with past issues below, and is also in the RSS feed.
- **How it works** (ℹ️) explains the ratings in a drawer. On phones, Stats, How it works, Free alternatives and Suggest move into a ⋯ menu.
- **Free alternatives:**
  - `alternatives/<app>/` exists for every app with 2+ clones, or a well-known product with one.
  - Each page has an intro written from the data (best received, ready to install, runs in the browser) and an `alternatives/` index.
- **Stats:** `stats/` shows the most-cloned companies and apps, clones per week, ratings by category, the fastest-growing repos, and builders with their hit rate.
- **For search engines:**
  - project pages carry schema.org `SoftwareApplication` data (free, systems, repo; no star rating is claimed);
  - alternatives pages carry an `ItemList`;
  - there's a sitemap and robots.txt.
- **Usage:** GoatCounter page views on every page, plus events for Get, Open, GitHub, shares, filters, categories, search, Surprise me, the newsletter, votes and objections.

## 🏛️ Established open-source alternatives

A separate section for mature open-source apps that replace a paid one: Kdenlive for Premiere Pro, OBS Studio, GIMP, LibreOffice, Bitwarden for 1Password, and so on. They're rated on their GitHub use, not on X reactions, since nobody "launches" them any more.

- **Who gets in:** the hand-picked list in [`established.json`](established.json) (40 to start), plus any repo suggested through #FlatteryAdd or the workflow's `repos` box that isn't a clone but passes the bar. For those, Haiku names the paid products it replaces.
- **The bar:** 1,000+ GitHub stars, a change in the last 6 months, and (for suggested ones) a license. An app that stops changing for 6 months drops off.
- **The score:** from stars, recent activity and downloads (50–97).
- **Where it shows:** in its own sidebar view (🏛️ Established) and a shelf on Discover, but never in the clone ratings or the stats. On each "Free alternatives to X" page, established apps come first, then the new clones.
- **Everything else:** Get, "Can I use it?", the comparison with the original and ⚑ Object all work as for clones.

## Anyone can take part, through X

| Button | What it posts | What happens |
|---|---|---|
| ＋ **Suggest a clone** | `#FlatteryAdd <link>` | The scan looks up the linked X post, or searches X for posts linking the GitHub repo, and judges them like any other. |
| ✅ **It works** / ❌ **It's broken** | `#FlatteryWorks` / `#FlatteryBroken <code>` | One vote per established account (30+ days old, 10+ followers). 3+ works adds to the score; 3+ broken takes some off. |
| ⚑ **Object on X** | `#FlatteryRemove <code>` with a reason | The listing comes down once **6** objections count. Each must come from a different established account and give a real reason (judged by Haiku). At most 2 count per 30 minutes, and the first and last must be at least 2 hours apart. |

## How a scan works

`tools/scan.mjs` runs `pipeline.js`, which builds on the previous catalog every 8 hours, so nothing found is ever lost:

1. **Refresh:** new metrics for known posts. That happens every scan in a post's first week, daily up to 30 days, then weekly. Deleted posts stay marked *removed*, with their text dropped.
2. **Discover:**
   - X recent search: generic clone queries every run, and product queries from `products.js` in turn. Each query continues from the newest post it saw last time.
   - Builders whose projects reached ❤️ or ⭐ (the watchlist).
   - Posts that link known repos.
   - `#FlatteryAdd` suggestions.
   - Hacker News, through Algolia. Reddit too, when it doesn't block cloud servers.
3. **Triage:** Claude Haiku (`haiku.js`) keeps only real announcements of a clone, reverse-engineered, reimagined or ported app. It names the original and gives a category. A project gets its own name, or none ("<app> clone"), never a description.
4. **Reactions:** for posts with reach (20+ likes or 5+ reposts) or 3+ replies, Haiku reads up to 50 replies and 20 quote posts. It records their tone and any red flags: doesn't work, license, scam or malware, wrapper, stolen code, overhyped, security. A flag counts only when two different accounts raise it, with their replies quoted.
5. **Confirm on GitHub** (`github.js`): stars, forks, release downloads and the files per system, star growth, license, commits in the last 30 days, the homepage, and the README's screenshot and logo.
6. **Score** (`reception.js`), then **merge** posts about the same project into one card (`groups.js`): same repo, or the same specific name. Version numbers don't split a project ("Open Duet 2.0" and "Open-Duet" are one card).
7. **Second opinion:** Claude Sonnet reviews each ❤️ and ☠️ once, applying the site's rules. When it disagrees, the card shows 😐 Mixed with its note.
8. **Compared with the original:** Haiku compares up to 6 rated projects a scan with the app they clone, from the README and what people said, and redoes each monthly.
9. **Newsletter:** weekly.
10. **Publish:** the catalog goes to the `data` branch (`latest.json`, thumbnails, icons, preview images). Then project, alternatives and stats pages, the sitemap and the RSS feed are written, and the site deploys to GitHub Pages.

**Kept off the page until they grow** (the posts stay in the catalog):
- brand-new posts with under 3 likes and no repo;
- untested ones still tiny after two weeks;
- cards with neither a name of their own nor an original.

**Corrections** (`overrides.json`, applied every scan): `attach` puts a post into a project, `repo` gives a post a repo it didn't link, `separate` stops a merge, `hide` drops a post, and `owned` says whose a repo is.

## Ratings

The score (0–100) is a weighted mean:

| Part | Weight | What |
|---|---|---|
| approval | 25 | likes + 2×reposts + 1.5×bookmarks, log-scaled (≈5,000 = full marks) |
| interest | 5 | engagement per view (3% = full marks), or per follower when views are missing |
| sentiment | 25 | positive vs negative share of replies and quotes (needs 5+; fewer than 15 is *low confidence* and weighs less) |
| github | 45 | stars, release downloads and star growth |

Penalties apply for being *ratioed* (more replies and quotes than likes), for each red flag, and for a serious one (scam or malware, stolen code, security issue).

| Rating | When |
|---|---|
| **❤️ Loved** | real use on GitHub (100+ stars or 500+ downloads; 1,000+ / 10,000+ counts regardless of score) and a real crowd on X (20+ likes or 5+ reposts), with replies not clearly negative |
| **⭐ Proven on GitHub** | the same GitHub use, but quiet on X so far |
| **🔥 Hyped, unproven** | score 60+ and mostly positive replies, but no repo or one nobody uses yet |
| **😐 Mixed** | in between, or a well-used repo with clearly negative replies. A serious flag against a project most people clearly like is shown as **⚠️ Disputed** here. |
| **☠️ Don't touch** | a serious red flag raised by two different accounts, a removed repo, or a low score with mostly negative replies and no GitHub to back it |
| **🆕 New & untested** | too little reach, or under a day old with no replies read yet, and no real GitHub use |
| **🌫️ Didn't catch on** | more than 14 days old with little reach and no real GitHub use (it comes back if people pick it up) |

**Whose stars count:** GitHub counts when the repo is the project's own. That means:
- its owner matches the poster;
- or it was created at most 120 days before the post;
- or its name is the project's name, even when someone else shared it (Voicebox and `jamiepine/voicebox`).

Stars of a famous repo that isn't the project (Linux behind a post about "Ginux") never count, and such a repo isn't shown as the card's repo.

**Steady ratings:** a new rating shows once it holds for two scans in a row, so cards don't flip back and forth. ☠️ Don't touch and jumps of 20+ points show at once. While a change waits, the sheet says so.

**Fairness:** each account counts once per project. Accounts that keep posting other people's projects (3+) count at half weight.

The thresholds live at the top of `reception.js`. Everything here is crowd opinion, not a legal or technical judgement.

## Keeping itself running

- **Timers (as for heat.sala.company):** GitHub's own schedules run late and sometimes not at all, so cron-job.org starts the workflows through GitHub's API. It uses a fine-grained token limited to this repo (*Actions: read and write*), and each job sends `POST https://api.github.com/repos/jamalxcode/flattery/actions/workflows/<file>/dispatches` with the body `{"ref":"main"}`.
  - `pages.yml` (scan and deploy) at 00:17, 08:17 and 16:17 UTC.
  - `freshness.yml` every hour at :41.
  - GitHub's schedules stay on as a backup. The token expires; renew it in the cron-job.org jobs before it does.
- **Freshness check** (`freshness.yml`, `tools/check-fresh.mjs`): it fails, and GitHub emails the owner, when the live catalog is over 11 hours old, the page shows no projects, the monthly X read cap is reached, or the site is down. It also cancels deploys GitHub left stuck.
- **Never paused:** GitHub pauses scheduled workflows after 60 days without commits, so each scan re-enables its own workflow.
- **Never shrinks:** a scan refuses to save a catalog smaller than the last. If X, Haiku or GitHub fails, the last good data stays.
- **Self-check:** every scan logs any card whose posts link a GitHub repo it doesn't show, and the page's Status section shows ✅ or ⚠️.
- **Status:** the bottom of the page shows the last scan, scans in the last 7 days, X reads this month and the self-check.
- **Before merging:** `pr-check.yml` runs on every pull request. It runs the offline tests, then `tools/ui-check.mjs`, which opens the page in a real browser with the real catalog on a desktop and a phone. It checks rows, Discover, search, the sidebar, the detail sheet, How it works, script errors and sideways scrolling.

## Setup

Repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Needed | For |
|---|---|---|
| `X_BEARER_TOKEN` | yes | X API v2: recent and full-archive search, post lookup, quote posts |
| `ANTHROPIC_API_KEY` | yes | Claude Haiku (triage, replies, names, comparisons, newsletter) and Sonnet (second opinion) |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | no | Only if the site should post on X by itself: the weekly newsletter and newly loved projects, once each, with a link back. These are the app's keys with *Read and write* permission and the account's access token. Without them nothing is posted. |

The Actions token covers GitHub. Repository variables: `X_MONTHLY_READS` (default 60,000; scans stop reading X past it until the month turns) and `X_COST_PER_READ` (optional; logs each run's estimated X cost).

**Domain:** flattery.sala.company (`CNAME`; DNS: CNAME `flattery` → `jamalxcode.github.io`).

**By hand:** **Actions → Scan and deploy → Run workflow** takes these inputs:
- `max_reads` (default 1,000);
- `backfill_days`: also search X's full archive that far back for popular clones;
- `search`: names to look for, comma-separated, with `search_days`.

**Check balances monthly:** your X API credit and your Anthropic balance. If either runs out, scans keep the last data but stop finding and rating.

## Running locally

Node 22:

```sh
npm ci
npm test                      # the whole pipeline offline, against fake X, Haiku and GitHub answers
X_BEARER_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... node tools/scan.mjs --cache data/latest.json --out data
node tools/pages.mjs --data data/latest.json --out .    # project, alternatives pages, sitemap
node tools/stats.mjs --data data/latest.json --out .    # stats page
node tools/ui-check.mjs --root .                        # the page in a browser (needs data/latest.json)
```

Scan options: `--max-reads`, `--per-query`, `--products-per-run`, `--max-reactions`, `--budget-sec`, `--rotate`, `--backfill-days`, `--search`.

To search for a product, add a line to `products.js`.

## License

[MIT](LICENSE) © 2026 Sala Company. Projects listed on the site belong to their makers. Ratings are crowd opinion, collected and summarised automatically.

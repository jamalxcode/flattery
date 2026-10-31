# Flattery

> “Imitation is the sincerest form of flattery that mediocrity can pay to greatness.” — Oscar Wilde

A catalog of clones, reverse-engineered and reimagined versions of existing software, found on X and ranked by how people received them.

**See it:** https://jamalxcode.github.io/flattery/ (also [`data/latest.html`](https://jamalxcode.github.io/flattery/data/latest.html) and [`data/latest.json`](https://jamalxcode.github.io/flattery/data/latest.json))

## How it works

A GitHub Action runs `tools/scan.mjs` every 8 hours and publishes the catalog with the site. Each run builds on the previous one, so nothing found is ever dropped (`pipeline.js`):

1. **Refresh** — fresh likes, reposts, replies, quotes, bookmarks and views for known posts (100 per request): every run (every 8 hours) in a post's first week, daily up to 30 days, then weekly for good, so a rating can still change. Snapshots are kept at 1 hour, 24 hours and 7 days. Deleted posts stay in the catalog marked *removed*, with their text dropped.
2. **Discover** — X recent search (`x.js`). Generic queries every run (`url:github.com` plus clone / reimplementation / reverse engineered / rebuilt…), plus product queries built from `products.js` (Photoshop, Figma, Notion…), 27 per run in turn, so all ~80 products are searched once a day. Each query continues from the newest post it saw last time.
3. **Triage** — Claude Haiku (`haiku.js`) keeps only posts that announce a *clone*, *reverse-engineered*, *reimagined* or *port* of existing software, and names the original. News, opinions and "is there an alternative to…" posts are dropped.
4. **Reactions** — for posts with some reach (20+ likes or 5+ reposts), up to 50 replies and 20 quote posts are read by Haiku, which labels each one positive, neutral or negative and lists red flags people raise (doesn't work, license/IP concern, scam or malware, just a wrapper, stolen code, overhyped, security issue). The author's own replies don't count, but repo links in them are picked up. Reactions are read again when replies have grown, while X's 7-day search still reaches them.
5. **Confirm on GitHub** (`github.js`) — stars, forks, release downloads and daily star growth of the linked repo, 50 repos per GraphQL request. Renamed repos are followed; removed ones are marked.
6. **Score** (`reception.js`) — see below. Each change of rating is kept in the post's history; the page marks clones promoted or demoted in the last two weeks and shows a *Just promoted* shelf.

The catalog is saved to the `data` branch (`latest.json`, one commit per run) and every run starts from it. A run never starts from empty while a catalog is saved, and refuses to write one smaller than the last.

**Search for a name:** **Run workflow** with `search` (e.g. `ArtCraft`, or several separated by commas) looks for every original post about it from the last 21 days (or `search_days`), popular first, and rates the ones Haiku confirms as clones.

**One card per project:** posts about the same project are merged into one entry: they link the same repo, or name the same specific project (a name also joins the repo of the same name, e.g. "PhotoCraft" and `storytold/photocraft`). Generic names like "Discord clone" never merge. A merged card adds up likes, reposts and replies across its posts, uses the poster's own repo if any post links one, and lists every post in its detail sheet.

**Corrections (`overrides.json`):** applied on every scan. `attach` puts a post into a project (by name or `owner/repo`), `repo` gives a post the repo it didn't link, `separate` keeps posts from merging, `hide` leaves posts off the page, and `owned` says whether a repo is the poster's own (`true`) or someone else's (`false`). For example, @echelon's ArtCraft launch post never names ArtCraft, so it's attached by hand.

**Finding the real announcement:** each run also searches X for posts linking up to 5 known starred repos (weekly per repo, 30 days back), so a project's own launch post and discussion turn up, not only the curator post that brought it in.

**Trust:** reply tone from fewer than 15 replies is marked *low confidence*, weighs less, and can't decide a rating on its own. A red flag counts only when two different accounts raise it, and the detail sheet quotes up to three of their replies with links. The page also lists popular posts the filter recently left out, so wrong rejections can be spotted.

**Page:** opens on rated projects (New & untested one tap away), each project has its own link (`#p=…`, with a Copy link button), a *Rising on GitHub* shelf shows the fastest-growing repos, and `data/feed.xml` is an RSS feed of newly rated and promoted projects. README screenshots are copied into `data/thumbs/` (kept on the `data` branch) instead of being loaded from other servers.

**Health and cost:** when a scheduled scan fails, the workflow opens an issue (*Flattery scans are failing*) and closes it once scans work again. Set the repo variable `X_COST_PER_READ` (e.g. `0.005`) to log each run's estimated X cost in `latest.json` (`info.run.x_cost_usd`).

**Backfill:** **Actions → Scan and deploy → Run workflow** with `backfill_days` (e.g. 21) and a higher `max_reads` (e.g. 3000) searches X's full archive for popular clones from those days. Reactions on threads older than 7 days are also re-read weekly through the archive when they've grown.

There is no GitHub discovery: X finds the projects, GitHub only confirms them.

## Reception score and verdicts

The score (0–100) is a weighted mean of:

| Part | Weight | What |
|---|---|---|
| approval | 25 | likes + 2×reposts + 1.5×bookmarks, log-scaled (≈5,000 = full marks) |
| interest | 5 | engagement per view (3% = full marks), or per follower when views are missing |
| sentiment | 25 | positive vs negative share of replies and quotes (needs 5+) |
| github | 45 | stars, release downloads and star growth |

Penalties: being *ratioed* (more replies and quotes than likes), each red flag, and a serious red flag (scam/malware, stolen code, security issue).

| Verdict | When |
|---|---|
| **Loved** | GitHub counts most: 1,000+ stars or 10,000+ release downloads, whatever the X post did (unless the replies are clearly negative); or 100+ stars / 500+ downloads with a score of 50+ |
| **Hyped, unproven** | score 60+ and mostly positive replies on X, but no repo or one nobody uses yet |
| **Mixed** | in between, or a well-used repo with clearly negative replies |
| **Don't touch** | a serious red flag raised by several people (scam/malware, stolen code, security issue), a removed repo, or a low score / mostly negative replies without GitHub to back it |
| **New & untested** | under 20 likes and 5 reposts, or under 24 hours old with no replies read yet, and no real GitHub use |

GitHub only counts when the repo is the poster's own: its owner matches their X handle or name (or a 5+ letter word of it, so `Anil-matcha` matches `@matchaman11`), or it was created at most 120 days before the post, so it's the clone itself even when a curator shares it. Linking someone else's famous project borrows nothing.

The thresholds live at the top of `reception.js`. This is crowd opinion, not a legal or technical judgement.

## Setup

Repository secrets (**Settings → Secrets and variables → Actions**):

- `X_BEARER_TOKEN` — the bearer token of an app in the [X developer console](https://developer.x.com/). Needs recent search, post lookup and quote posts (API v2).
- `ANTHROPIC_API_KEY` — for Claude Haiku.

The Actions token (`github.token`) covers the GitHub checks. Without the secrets the scan fails and the previous catalog is republished.

**Cost:** X bills per post read, so each run is capped with `--max-reads` (1,000 in the workflow, at most ~3,000 a day at 3 runs). Lower it, or the run frequency in `.github/workflows/pages.yml`, to fit your plan. The run log ends with the reads, Haiku calls and tokens used. Haiku costs a few cents a day.

**Timer:** GitHub's own schedule runs late and sometimes not at all, so, as for heat, a cron-job.org job can start the workflow through GitHub's API (`POST /repos/jamalxcode/flattery/actions/workflows/pages.yml/dispatches`, fine-grained token with *Actions: read and write*). Set it to every 8 hours. To run a scan by hand: **Actions → Scan and deploy → Run workflow**.

## Running locally

Node 20 or newer:

```sh
npm ci
X_BEARER_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... node tools/scan.mjs --cache data/latest.json --out data
```

Options: `--max-reads`, `--per-query`, `--products-per-run`, `--max-reactions`, `--budget-sec`, `--rotate`.

`node tools/test.mjs` runs the whole pipeline offline against fake X, Haiku and GitHub answers and checks the verdicts.

Add a product to search for by adding a line to `products.js`.

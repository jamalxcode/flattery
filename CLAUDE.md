# CLAUDE.md

This file guides Claude Code when working in this repository.

## Overview

Flattery (live at https://flattery.sala.company) is an "app store" of free software clones (reverse-engineered, reimagined, white-room, vibe-coded copies of paid apps). A scheduled Node pipeline finds candidates on X and Hacker News, has Claude Haiku triage them and read the replies, confirms usage on GitHub, scores and rates them (Loved, Proven, Hyped, Mixed, New, Didn't catch on, Don't touch), and publishes a JSON catalog. The site is static vanilla HTML/CSS/JS rendered from that catalog; generated pages (`p/<code>/`, `alternatives/`, `stats/`, sitemap, RSS) are written at deploy time, not committed. Fully automated: nobody reviews listings by hand.

## Commands

Node 22.

```sh
npm ci
npm test                         # node tools/test.mjs: whole pipeline offline vs. stubbed X/Haiku/GitHub
npm run scan                     # node tools/scan.mjs (needs X_BEARER_TOKEN, ANTHROPIC_API_KEY, GITHUB_TOKEN)
node tools/scan.mjs --cache data/latest.json --out data
node tools/pages.mjs --data data/latest.json --out .     # = npm run pages: project + alternatives pages, sitemap
node tools/stats.mjs --data data/latest.json --out .     # stats page
node tools/slim.mjs --data data/latest.json --out data/site.json   # what the page loads
node tools/cards.mjs --data data/latest.json             # = npm run cards: share images (Playwright)
node tools/ui-check.mjs --root .                         # page check in Chromium + axe-core (needs data/latest.json and data/site.json)
node tools/check-fresh.mjs                               # live catalog freshness check
```

To get a real catalog locally: `git fetch origin data` and extract `latest.json` (as `pr-check.yml` does). No lint script. Scan flags: `--max-reads`, `--per-query`, `--products-per-run`, `--max-reactions`, `--budget-sec`, `--rotate`, `--backfill-days`, `--search`, `--repos`.

## Architecture

Pipeline (Node ES modules at repo root, driven by `tools/scan.mjs` -> `pipeline.js`):
- `x.js`: X API v2 client (search, lookup, replies/quotes); read budget via `X_MONTHLY_READS`.
- `sources.js`: Hacker News (Algolia) and Reddit, shaped like X posts.
- `products.js`: well-known commercial software list driving product searches (add a line to search a product).
- `haiku.js`: Claude Haiku triage/reactions/names/comparisons/newsletter (uses `@anthropic-ai/sdk`); Sonnet gives a second opinion on Loved/Don't touch.
- `github.js`: stars, downloads, releases/installers, license, activity, README images.
- `reception.js`: score (0-100) and rating; all thresholds live at its top.
- `groups.js`: merges posts about the same project into one card.
- `complaints.js` (#FlatteryRemove objections), `suggestions.js` (issue-form suggestions), `xpost.js` (optional posting to X), `report.js` + `analytics.js` (standalone report; shared GoatCounter snippet string for tool-written pages).
- `overrides.json` (manual corrections: attach/repo/separate/hide/owned), `established.json` (hand-picked established OSS apps), `suggest.json` (ntfy.sh channel names).

Front end:
- `index.html` + `style.css` + `render.js` (shared app-store renderer) + `app.js` (module; loads `data/site.json`, swaps in newer catalogs). Theme stored in `localStorage` key `theme`.
- `suggest/index.html`: suggestion form posting to an ntfy.sh channel.
- `fonts/inter-latin.woff2`: self-hosted Inter.

Data: the catalog (`latest.json`, `thumbs/`, `og/`) lives on the `data` branch, not `main`. `data/` in the deployed site holds `latest.json`, `site.json`, `feed.xml`, etc.

Docs: `docs/BUSINESS-RULES.md` (every rule, keep in sync with code) and `docs/DECISIONS.md`. Read them before changing rating/listing behavior.

## Deployment

- `.github/workflows/pages.yml` ("Scan and deploy") runs on push to `main`, every 8 h (`17 */8 * * *`, plus cron-job.org dispatches), and manual dispatch (inputs: `backfill_days`, `search`, `search_days`, `repos`, `max_reads`). It loads the previous catalog from the `data` branch, scans, draws share cards, saves the catalog to `data`, replaces `__BUILD__` with the short SHA in `index.html` and `suggest/index.html`, generates pages, and deploys the repo root via GitHub Pages Actions. Pushing to `main` triggers a full scan + live deploy (spends X/Claude credit).
- Secrets: `X_BEARER_TOKEN`, `ANTHROPIC_API_KEY` (required); X OAuth keys optional for posting.
- `pr-check.yml`: on PRs to `main`, runs `npm test` then `tools/ui-check.mjs` with the real catalog.
- `freshness.yml`: hourly freshness check. `check-domain.yml`, `check-site.yml`: manual diagnostics.
- Custom domain `flattery.sala.company` via `CNAME`; `.nojekyll` present.

## Conventions and gotchas

- Asset URLs use `?v=__BUILD__` (CSS, `render.js`, `app.js`); CI substitutes it, so don't hard-code a version and keep the placeholder in new asset links.
- Keep the GoatCounter snippet (endpoint `https://salacompany.goatcounter.com/count`) intact in `index.html`, `suggest/index.html`, and the `GOATCOUNTER` constant in `analytics.js` (used by tool-written pages). The site also fires custom GoatCounter events.
- A scan must never save a smaller catalog than the last; on failure the previous catalog is republished. Preserve that safety.
- A card is never named after the app it clones (shows "<app> clone").
- WCAG AA contrast in light/dark and no sideways scrolling on phones are checked by `ui-check.mjs`; on phones secondary links move into a menu and categories become chips.
- Post content can be in many languages; names prefer plain letters matching the repo.

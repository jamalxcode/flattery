# Flattery

> *"Imitation is the sincerest form of flattery."*

**An app store of free clones of the apps you pay for.** Reverse-engineered, reimagined, white-room and vibe-coded copies, found on X and Hacker News, rated by how people reacted, and confirmed with GitHub stars and downloads.

[![Scan and deploy](https://github.com/jamalxcode/flattery/actions/workflows/pages.yml/badge.svg)](https://github.com/jamalxcode/flattery/actions/workflows/pages.yml)
[![Freshness](https://github.com/jamalxcode/flattery/actions/workflows/freshness.yml/badge.svg)](https://github.com/jamalxcode/flattery/actions/workflows/freshness.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**🌐 [flattery.sala.company](https://flattery.sala.company/)** · [Free alternatives](https://flattery.sala.company/alternatives/) · [Stats](https://flattery.sala.company/stats/) · [Suggest a clone](https://flattery.sala.company/suggest/) · [RSS](https://flattery.sala.company/data/feed.xml) · [JSON](https://flattery.sala.company/data/latest.json)

It's fully automated: a scan every 8 hours finds, rates and re-rates projects, and the site rebuilds itself. Nobody reviews listings by hand.

## Contents

- [How it works](#how-it-works)
- [Ratings](#ratings)
- [What's on the site](#whats-on-the-site)
- [Take part](#take-part)
- [Run it locally](#run-it-locally)
- [Project layout](#project-layout)
- [Docs](#docs)

## How it works

```
X + Hacker News + suggestions ──▶ Haiku triage ──▶ read the replies ──▶ check GitHub ──▶ score & rate ──▶ static site
```

1. **Find:** search X for clone announcements (generic queries plus one per product in [`products.js`](products.js)), watch builders who've had a hit, and read Hacker News and visitor suggestions.
2. **Triage:** Claude Haiku keeps only real announcements of a clone, names the app it copies and picks a category.
3. **Read the replies:** for posts with reach, Haiku reads up to 50 replies and 20 quotes for tone and red flags (doesn't work, scam, stolen code, security…). A flag counts only when two different accounts raise it.
4. **Confirm on GitHub:** stars, downloads, installers, license and recent activity of the project's *own* repo.
5. **Score and rate:** a 0–100 score and a rating; posts about the same project merge into one card. Claude Sonnet double-checks every ❤️ and ☠️.
6. **Publish:** the catalog is saved to the `data` branch, pages are generated, and the site deploys to GitHub Pages.

Each scan builds on the last, so nothing found is lost, and a scan never saves a smaller catalog than the one before.

## Ratings

| Rating | Means |
|---|---|
| ❤️ **Loved** | Real use on GitHub and a real crowd on X, with replies not clearly negative |
| ⭐ **Proven on GitHub** | Real GitHub use, but quiet on X so far |
| 🔥 **Hyped, unproven** | People are excited, but no one uses the repo yet (or there isn't one) |
| 😐 **Mixed** | In between, or well used with clearly negative replies (⚠️ *Disputed* when a serious flag meets a well-liked project) |
| 🆕 **New & untested** | Too little reach yet |
| 🌫️ **Didn't catch on** | Over 14 days old, little reach, no real use |
| ☠️ **Don't touch** | A serious red flag from two accounts, a removed repo, or mostly negative replies with nothing to back it |

*Real use* means 100+ stars or 500+ downloads; *a real crowd* means 20+ likes or 5+ reposts. The score weighs GitHub 45, approval 25, sentiment 25 and interest 5, minus penalties for red flags and being ratioed. Ratings change only after holding for two scans.

The full rules are in [Business rules](docs/BUSINESS-RULES.md); the thresholds live at the top of [`reception.js`](reception.js). Everything here is crowd opinion, not a legal or technical judgement.

## What's on the site

- **App store layout:** views for Everything, Discover and each rating, plus categories. Each app has a detail sheet with what people said, *Compared with the original* (what it does, what's missing, a verdict) and *Can I use it?* (installers, license, still maintained).
- **Get / Open:** **Get** downloads the right installer for your system from the newest GitHub release, offered only for ❤️ and ⭐ apps with an established repo. **Open** links a project's web app.
- **🏛️ Established:** a separate section for mature open-source apps that replace a paid one (Kdenlive, OBS Studio, GIMP, Bitwarden…), rated on GitHub use. Hand-picked in [`established.json`](established.json).
- **Free alternatives:** an `alternatives/<app>/` page for every app with clones.
- **Stats:** most-cloned companies and apps, clones per week, fastest-growing repos, builders' hit rates.
- **📰 Newsletter:** *This week in clones*, written weekly from rating changes; also in RSS.
- **🔔 Follow:** free alerts for newly loved apps and the newsletter via [ntfy](https://ntfy.sh), no sign-up.
- **Sharing:** every project has its own page (`p/<code>/`) with its own preview image.
- **Light and accessible:** the page loads about 100 KB of data, meets WCAG AA contrast in light and dark, and is audited with axe-core before every merge.

## Take part

No sign-up needed.

| How | What happens |
|---|---|
| ＋ **[Suggest a clone](https://flattery.sala.company/suggest/)** | Paste a link. The next scan checks it, and the Suggest page shows what became of it. |
| **`#FlatteryAdd <link>`** on X | The scan finds the post (or posts linking the repo) and judges it. |
| **`#FlatteryWorks` / `#FlatteryBroken <code>`** on X | "I tried it" votes from established accounts. 3+ add to or take from the score. |
| ⚑ **`#FlatteryRemove <code>` + a reason** on X | The listing comes down after 6 objections with real reasons from different established accounts. |

## Run it locally

Node 22.

```sh
npm ci
npm test    # the whole pipeline offline, against stubbed X, Haiku and GitHub
```

To work with the real catalog, fetch it from the `data` branch:

```sh
git fetch --depth 1 origin data
mkdir -p data && git archive origin/data latest.json thumbs | tar -x -C data
```

Then:

```sh
node tools/pages.mjs --data data/latest.json --out .               # project and alternatives pages, sitemap
node tools/stats.mjs --data data/latest.json --out .               # stats page
node tools/slim.mjs  --data data/latest.json --out data/site.json  # what the page loads
node tools/ui-check.mjs --root .                                   # browser check + accessibility audit
```

A real scan needs API keys:

```sh
X_BEARER_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... node tools/scan.mjs --cache data/latest.json --out data
```

Scan options: `--max-reads`, `--per-query`, `--products-per-run`, `--max-reactions`, `--budget-sec`, `--rotate`, `--backfill-days`, `--search`, `--repos`.

## Project layout

| Path | What |
|---|---|
| `tools/scan.mjs` → `pipeline.js` | The scan |
| `x.js`, `sources.js` | X API client; Hacker News and Reddit |
| `haiku.js` | Claude Haiku triage, replies, names, comparisons, newsletter; Sonnet second opinion |
| `github.js` | Stars, downloads, releases, license, activity, README images |
| `reception.js` | Score and rating (all thresholds at the top) |
| `groups.js` | Merges posts about the same project |
| `complaints.js`, `suggestions.js`, `xpost.js` | Objections, suggestions, optional posting to X |
| `products.js`, `established.json`, `overrides.json` | What to search, hand-picked apps, manual corrections |
| `index.html`, `style.css`, `render.js`, `app.js` | The site (static, vanilla JS) |
| `suggest/` | The Suggest a clone page |
| `tools/` | Page, stats, share-card generators and checks |
| `data` branch | The catalog: `latest.json`, thumbnails, icons, preview images |

## Docs

- **[Business rules](docs/BUSINESS-RULES.md):** every rule the site applies, in one place.
- **[Development decisions](docs/DECISIONS.md):** what we chose while building Flattery, and why.
- **[Running it](docs/OPERATIONS.md):** secrets, manual scans, timers, health checks and costs.

## License

[MIT](LICENSE) © 2026 Sala Company. Projects listed on the site belong to their makers. Ratings are crowd opinion, collected and summarised automatically.

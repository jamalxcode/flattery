# Flattery: business rules

Every rule Flattery applies, in one place. They run automatically on every scan; nobody applies them by hand. The thresholds live in the code named after each section, so this page and the code should be changed together.

For *why* the rules are what they are, see [Development decisions](DECISIONS.md).

## 1. What Flattery lists

1. **A clone** is a project that recreates existing software. Four kinds count:
   - a *clone* (a copy or open-source alternative of an existing product, including vibe-coded functional copies);
   - *reverse-engineered* (rebuilt by studying how the original works, including clean-room or white-room rebuilds);
   - *reimagined* (a new take that keeps the original's core idea, including tributes);
   - a *port* (the same software moved to another language or platform).
2. **Not a clone:** news, opinions, jobs, ads, threads about the original product, people asking for an alternative, lists of tools, and reposts that add nothing. *(`haiku.js`, triage)*
3. **A clone must name the app it copies.** A placeholder ("Not specified") or a kind of software ("Website", "Ad blocker", "Memory optimizer", "Printer software") doesn't count. Such a card gets one more try at naming a specific app; without one, it stays off the page. *(`pipeline.js`, `realOriginal`)*
4. **Established open-source apps** (🏛️) are listed separately, not as clones: mature projects that replace a paid product (Kdenlive for Premiere Pro, OBS Studio, GIMP…). *(See section 8.)*
5. **Discovery only finds what's talked about.** Projects come from X posts (and Hacker News), never from browsing GitHub. GitHub only confirms what X found, except for the 🏛️ Established list. *(`pipeline.js`)*

## 2. Names

1. A card's name is the project's own name, from the post, its links or its repo, never a description ("Open Discord alternative" is not a name).
2. Without a name of its own, a card shows as "<original> clone".
3. **A card is never named after the app it clones.** A card called "Cursor" rated ☠️ would read as a verdict on Cursor itself, so it shows as "Cursor clone".
4. When several names exist, the one matching the repo wins, in plain letters ("Voicebox", not "보이스박스 (Voicebox)").

## 3. One card per project

Posts about the same project merge into one card when:
- they link the same repo; or
- they name the same specific project. Generic names like "Discord clone" never merge; version numbers don't split a project ("Open Duet 2.0" and "Open-Duet" are one card); a name also joins the repo of the same name; or
- the same account posts about the same unnamed clone again.

On a merged card:
- likes, reposts and replies are added up;
- each account counts once (its most liked post);
- accounts that keep posting other people's projects (3+) count at half weight.

*(`groups.js`)*

## 4. Whose GitHub stars count

GitHub stars and downloads count toward a rating only when the repo is **the project's own**:
- its owner matches the poster's X handle or name; or
- the poster says they built it (for repos under 10,000 stars); or
- it was created at most 120 days before the post; or
- its name is the project's name, whoever shared it (`jamiepine/voicebox` for Voicebox); or
- its owner carries the project's name (`lightpanda-io/browser` for Lightpanda).

Exceptions:
- A project named after the app it clones (a project called "Excel" linking an Excel repo) doesn't count.
- A **famous repo (10,000+ stars) that isn't the project** (Linux linked from a post about "Ginux") never counts and isn't shown as the card's repo. The sheet says which repo was linked.

*(`reception.js`, `ownsRepo`, `repoIsProject`; `groups.js`)*

## 5. Ratings

**Score (0–100)**, a weighted mean:

| Part | Weight | What |
|---|---|---|
| Approval | 25 | likes + 2×reposts + 1.5×bookmarks, log-scaled (≈5,000 = full marks) |
| Interest | 5 | engagement per view (3% = full marks), or per follower |
| Sentiment | 25 | positive vs negative share of replies and quotes (needs 5+; under 15 is *low confidence* and weighs 10) |
| GitHub | 45 | stars, downloads and star growth of the project's own repo |

Penalties apply for being *ratioed* (more replies and quotes than likes), for each red flag, and more for a serious one.

**Thresholds:**
- *confirmed* use on GitHub: 100+ stars or 500+ downloads;
- *strong* use: 1,000+ stars or 10,000+ downloads;
- *reach* on X: 20+ likes or 5+ reposts.

**Verdicts, in order of precedence:**
1. A **serious red flag** (scam or malware, stolen code, security issue) raised by **at least 2 different accounts** gives ☠️ Don't touch. The exception: strong GitHub use with clearly positive, confident replies, which gives 😐 Mixed marked **⚠️ Disputed**.
2. **Repo removed** gives ☠️ Don't touch.
3. **Strong or confirmed GitHub use**, quiet on X, gives ⭐ Proven on GitHub.
4. **Strong GitHub use** with a real crowd on X gives ❤️ Loved.
5. **Confirmed GitHub use** with reach on X gives ❤️ Loved, or 😐 Mixed if the replies are clearly negative.
6. **No reach yet** gives 🆕 New & untested; after 14 days it becomes 🌫️ Didn't catch on, and it comes back if people pick it up.
7. **Otherwise, by score:** 🔥 Hyped, unproven (60+ and mostly positive, with no repo or an unused one), 😐 Mixed, or ☠️ Don't touch (a low score with mostly negative replies).

**"I tried it" votes:**
- 3+ ✅ works (and at least twice the ❌) add 5 points.
- 3+ ❌ broken (more than the ✅) take 12 off.

**Second opinion:**
- Every ❤️ and ☠️ is reviewed once by Claude Sonnet, which applies these same rules.
- When it disagrees, the card shows 😐 Mixed with its note.
- Opinions are kept per project and verdict, and redone when the rules change.

**Steady ratings:**
- A new rating shows only after it holds for **two scans in a row**.
- ☠️ Don't touch and jumps of **20+ points** show at once.
- While a change waits, the sheet says "⏳ Its rating may change to …".

*(`reception.js`, `pipeline.js`)*

## 6. Red flags and replies

1. Replies and quote posts are read for posts with reach or with **3+ replies or quotes**: up to 50 replies and 20 quotes.
2. Each reply is labelled positive, neutral or negative. Red flags are:
   - doesn't work;
   - license or IP concern;
   - scam or malware;
   - just a wrapper;
   - stolen code;
   - overhyped;
   - security issue.
3. **A flag counts only when 2 different accounts raise it.** The sheet quotes up to 3 of their replies with links.
4. The author's own replies don't count.
5. When the flag rules change, old serious flags are re-read under the new rules.

*(`haiku.js`, `pipeline.js`)*

## 7. What's kept off the page

The posts stay in the catalog and come back when they qualify. Off the page are:
- untested posts with no repo and **under 3 likes**, or **under 5 in their first 3 days**;
- untested posts still tiny after **2 weeks** (under 20 likes, no used repo, no votes);
- cards that don't name a real app they clone (section 1.3);
- listings taken down by objections (section 10), for good.

*(`pipeline.js`)*

## 8. 🏛️ Established open-source alternatives

1. **Source:** the hand-picked list in `established.json`, plus repos suggested through the Suggest page, #FlatteryAdd or the workflow's `repos` box that don't become a clone card.
2. **Bar:** **1,000+ stars** and **a change in the last 6 months**. Suggested ones also need a license, and Claude must name the paid products they replace; libraries, frameworks and infrastructure don't qualify.
3. **Score (50–97):** from stars, commits in the last 30 days and downloads.
4. **Where they show:**
   - their own sidebar view and a Discover shelf;
   - first on each app's "Free alternatives" page.
5. **Where they never show:** the clone ratings, Discover's list, Rising, the stats and the newsletter.
6. A repo that's already a clone card stays a clone card.

## 9. Get and Open buttons

1. **Get** downloads the installer for the visitor's system from the project's newest GitHub release. It's offered only when **all** of these hold:
   - the rating is ❤️, ⭐ or 🏛️;
   - the repo is **at least 2 weeks old**;
   - it has **50+ stars**;
   - there's an installer for that system.
2. **Installer choice:** `.dmg` or `.pkg` on Mac, preferring universal or Apple-chip builds; `.exe` or `.msi` on Windows, preferring x64; `.AppImage`, `.deb` or `.rpm` on Linux, preferring x64; `.apk` on Android. Checksums, signatures and source archives are skipped.
3. The sheet always says the file comes straight from GitHub and Flattery doesn't check downloads.
4. **Open** links a project's web app, for anything but ☠️.

*(`render.js`, `github.js`)*

## 10. Taking part

| Action | Rule |
|---|---|
| ＋ **Suggest** (site) | A GitHub or X link, sent to the site's ntfy.sh channel. At most 10 a day per browser. Read every scan; ntfy.sh keeps messages 12 hours, and scans run every 8. The Suggest page shows what became of each. |
| **#FlatteryAdd** (X) | A post with a link: the linked X post is looked up, or X posts linking the repo are searched (6 months back). |
| ✅ / ❌ **I tried it** | One vote per account. The account must be 30+ days old with 10+ followers. |
| ⚑ **Object** | A listing comes down once **6** objections count. Each must: come from a different account (30+ days old, 10+ followers); give a real reason, as judged by Claude (the bare template or a copied reason doesn't count). At most 2 count per 30 minutes, and the first and last counted must be **2+ hours apart**. Taken-down listings stay down and are listed on the page. |

Every suggestion goes through the same checks as anything found by search. Nothing gets in just because it was suggested.

*(`complaints.js`, `suggestions.js`)*

## 11. Alerts, newsletter and posting

1. **Newsletter:** written weekly by Claude Haiku from the week's rating changes and rising repos. It leaves out 🆕, 🌫️ and 🏛️ entries.
2. **🔔 Follow alerts:** each newly loved app (at most 2 a scan) and each new issue, once, on the public ntfy.sh channel `flattery-sala-alerts`.
3. **Posting on X as Flattery:** off unless X posting keys are set; then the same items, once each. Visitors share from their own accounts through ready-made posts that link back to the site.

## 12. Costs and limits

1. **X reads:**
   - capped at `X_MONTHLY_READS` (default 60,000). Past it, scans stop reading X until the month turns; GitHub checks and the site carry on;
   - known posts are re-checked every scan for their first 2 days, about daily up to 30 days, then weekly;
   - a normal scan reads about 220 posts.
2. **Claude:** each scan reads replies for up to 20 posts, compares up to 6 projects with their original, and gives second opinions on up to 15.
3. **Free services only** for everything else: GitHub Pages and Actions, cron-job.org, ntfy.sh, GoatCounter.

## 13. Data and safety

1. **The catalog never shrinks.** A scan refuses to save one smaller than the last, and on any failure the last good data stays published.
2. **Deleted X posts** stay as *removed*, with their text dropped (X's terms).
3. **Pictures and icons** are copied to the site's own `data` branch, never hot-linked. SVG is never stored, since it could run scripts on the site's domain.
4. **Post text is untrusted:** every prompt tells Claude never to follow instructions inside it, and everything is escaped on the page.
5. **Self-check:** a card whose posts link a GitHub repo it doesn't show is logged as a bug, unless it's a famous unrelated repo.
6. **Everything on the site is crowd opinion**, collected and summarised automatically: not a legal or technical judgement.

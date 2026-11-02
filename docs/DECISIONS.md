# Flattery: development decisions

What we decided while building Flattery, and why. Each entry gives the situation, the decision, and what we learned, including the things we tried first and changed. The rules themselves are listed in [Business rules](BUSINESS-RULES.md).

Flattery was built in October–November 2026 by its owner, with Claude Code (Anthropic) writing the code. Every change went through a pull request in this repo.

## Product

### 1. Find clones on X, not on GitHub
**Situation:** the first version searched GitHub for clone repos. Search there finds code, but not whether anyone cares about it.
**Decision:** discover clones through **X posts** (later Hacker News too), and rate them by how people reacted. GitHub is used only to *confirm* real use, through stars and downloads.
**Why:** launches happen on X, and the replies carry the verdict: "works great", "it's a scam", "just a wrapper". A repo's existence says nothing about whether it's any good.

### 2. Ratings that read at a glance
**Decision:** seven ratings with emoji: ❤️ Loved, ⭐ Proven on GitHub, 🔥 Hyped, 😐 Mixed, 🆕 New & untested, 🌫️ Didn't catch on, ☠️ Don't touch.
**Why:** the owner asked for "new and untested", "skull and crossbones if it's dangerous" and "red heart if it's popular". ⭐ was added so projects with heavy GitHub use but a quiet X launch aren't stuck at 🆕. 🌫️ was added so old, ignored posts don't sit in 🆕 forever.

### 3. GitHub use outweighs likes
**Decision:** GitHub has the biggest weight in the score (45 of 100). Strong GitHub use alone earns ⭐ or ❤️.
**Why:** likes are cheap, and stars and downloads mean people actually use it. This was the owner's call: "GitHub stars take priority."

### 4. Only the project's own repo counts, after four tries
**Situation:** posts often link a famous repo that isn't the project, like Linux or Expo, and borrowed its stars.
**Decision and changes:**
1. **First rule:** only the *poster's own* repo counts.
2. **Problem:** reposters sharing a project's real repo were ignored. Voicebox had 59,000 stars but was rated as if it had none.
3. **Second rule:** a repo also counts when its name matches the project's.
4. **Third rule:** or when the owner's name matches (`lightpanda-io/browser`). The self-check caught this one.

Famous repos that aren't the project are still dropped.
**Lesson:** each fix came with a test for the case it missed.

### 5. A red flag needs two accounts
**Situation:** a single angry reply was enough to mark a loved project ☠️ "stolen code".
**Decision:** a red flag counts only when **two different accounts** raise it, and the sheet quotes their replies. All old serious flags were re-read under the stricter rules.
**Why:** one person shouldn't be able to sink a project, and readers should see the evidence.

### 6. A second opinion that applies the site's rules
**Situation:** Claude Sonnet was added to double-check every ❤️ and ☠️. In its first version it overruled 10 of 15 verdicts with its own standards ("158 stars isn't real use").
**Decision:** give the reviewer the site's own rules. It now disagrees rarely, mostly to soften unsupported ☠️ verdicts.
**Lesson:** a reviewer model needs the same rules as the system it reviews, or it just substitutes its taste.

### 7. Ratings must be steady
**Situation:** scans changed 20–30 ratings at a time as scores hovered around thresholds.
**Decision:** a new rating shows only after holding for two scans. ☠️ and big jumps show at once. The change count is now measured per scan.
**Why:** a rating that flips every 8 hours can't be trusted, and "⬆ Promoted" should mean something.

### 8. Fewer, better listings
**Situation:** two-thirds of the catalog was 🆕, and some cards cloned "Website" or "Not specified".
**Decision:** keep low-signal posts and cards that don't name a real app off the page until they qualify. The posts stay in the catalog. A card is never named after the app it clones.
**Mistake along the way:** one version also hid 24 good "<app> clone" cards. It was fixed the same day, with a test covering both cases.

### 9. A separate section for established apps
**Situation:** the owner wanted Kdenlive, OBS Studio and Postiz. They're mature originals, not clones, and nobody "launches" them on X, so the clone rules rejected them.
**Decision:** a separate **🏛️ Established** section, seeded with 40 apps and rated on GitHub use (1,000+ stars, active in the last 6 months). It's kept out of the clone ratings, and shown first on "Free alternatives" pages.
**Why:** someone searching "free Premiere Pro alternative" is better served by Kdenlive than by a weekend clone. Keeping the section separate keeps ❤️ meaning "a new clone people loved".

### 10. Get buttons only where they're safe
**Situation:** a Get button downloads a file that runs on someone's computer, from a repo nobody checked.
**Decision:**
- Get appears only for ❤️, ⭐ and 🏛️ apps whose repo is 2+ weeks old with 50+ stars, with a visible note that downloads aren't checked.
- Windows and Linux get x64 builds; Mac gets universal or Apple-chip builds. An early version handed Windows users ARM installers.

**Why:** a fake "free Photoshop" with malware should never get a big blue button.

## How it runs

### 11. No human in the loop
**Decision:** everything is automatic: listings, ratings, objections, the newsletter. Mistakes are handled by rules:
- objections take a listing down after 6 genuine, spread-out ones;
- votes nudge ratings;
- the second opinion and the self-check catch errors.

**Why:** the owner asked for "no review or interference or action from my side".

### 12. A static site, with the data on its own branch
**Decision:** a static site on GitHub Pages, built by a GitHub Actions scan. The catalog lives on a `data` branch, and every scan builds on the previous one.
**Why:** it's free, has no server to maintain, and keeps data history. The site can't lose its catalog: a scan refuses to save a smaller one.

### 13. Timers that actually fire
**Situation:** GitHub's own schedule ran late or skipped runs; one gap was 14 hours. The owner's other project, heat.sala.company, had the same problem.
**Decision, copying heat:**
- **cron-job.org** starts the scans through GitHub's API;
- an hourly **freshness check** emails the owner if the site stops updating;
- each scan **re-enables its own schedule**, since GitHub pauses schedules after 60 days without commits.

### 14. Stay inside a budget
**Situation:** X charges per post read. As the catalog grew, re-checking every post every scan would have hit the monthly cap mid-month.
**Decision:**
- a monthly read cap (60,000);
- re-check posts every scan for 2 days, then daily, then weekly;
- free services for everything else.

Reads per scan fell from about 500 to about 220.
**Owner's rule:** "preserve the free part and not get charged". Prepaid credit with auto-recharge off is the real guarantee.

### 15. Visitors share from their own accounts
**Situation:** posting on X automatically needs extra X keys and posts as the owner.
**Decision:** the auto-posting code exists but stays off. Visitors share through ready-made posts, such as "❤️ Share as my favourite" or "Share this issue", from their own accounts. Alerts go out through ntfy.sh instead.

### 16. Suggestions without sign-up, and without exposing the owner, after three tries
**Situation:** people needed a way to suggest clones without X.
1. **A GitHub issue form:** it worked, but it led visitors to the owner's GitHub profile, and the owner wanted that hidden.
2. **A Google Form** was proposed; the owner preferred no Google and no sign-up.
3. **Final:** a Suggest page on flattery.sala.company that sends links to an **ntfy.sh** channel. It's free and open source, with no accounts. Scans read the channel, and the page shows what became of each suggestion.

**Trade-off:** ntfy.sh keeps messages 12 hours and scans run every 8, so a skipped scan could lose some.

### 17. Alerts through ntfy too
**Decision:** 🔔 Follow sends newly loved apps and the newsletter to a public ntfy channel. Visitors follow it in the free app or a browser, with no sign-up.

## Interface

### 18. An app store, not a dashboard
**Decision:** rows like an app store, each with an icon, name, what it clones and the rating where the price would be, plus a sidebar of views and categories. Shelves, the newsletter and the explanations moved out of the way: the newsletter is in a drawer, "How it works" is behind a button.
**Why:** the owner's direction: "the clone app cards need to be front and center."
**Refinement:** rows got more room, and names wrap rather than ending in "…".

### 19. Real icons and pictures, hosted by the site
**Decision:**
- Icons come from README logos, organisation avatars, or the maker's X picture.
- Pictures come from README screenshots.
- All are copied to the `data` branch, never hot-linked, and never as SVG.

**Why:** hot-linked images break, change, and let other servers track visitors. An SVG served from the site could run scripts.

### 20. A light page
**Situation:** the page loaded the whole 1.8 MB catalog on every visit.
**Decision:** the page loads a slim `site.json` with only what it shows, about 100 KB compressed. The full catalog stays published for JSON and RSS users.

### 21. Built to be found
**Decision:**
- Each project and each "Free alternatives to X" page is a real page.
- Its plain HTML carries the comparison and install details, plus schema.org data.
- No star rating is claimed in that data, because Flattery's score isn't user reviews.

**Why:** Google reads the HTML before any script runs, and a fake review rating would be misleading.

### 22. Accessible by default
**Decision:**
- An axe-core audit (WCAG 2 AA) of every main view, in light and dark themes, on desktop and phone.
- Rating colours were darkened to pass contrast, and headings fixed.
- The audit runs on every pull request.

## Engineering

### 23. Test in a real browser before merging
**Decision:** every pull request runs the offline tests, then opens the page in a real browser with the real catalog, on desktop and phone.
**Why:** it caught problems unit tests can't, like captions stretching the page sideways in one browser.

### 24. Fail loudly, keep the last good data
**Lessons from real bugs:**
- A GraphQL field name that doesn't exist (`browserDownloadUrl`) silently returned no data for any repo.
- A field the Actions token can't read (`downloadUrl`) emptied every release.

**Decision:** GitHub query errors are logged. Download links are built from the release tag and file name. A failure never overwrites good data.

### 25. Treat everything from X as untrusted
**Decision:**
- Post text goes to Claude marked as untrusted, with an instruction never to follow it.
- Everything is escaped on the page.
- Suggestions must be GitHub or X links.
- Every suggestion passes the same checks as search results.

### 26. Small, reversible changes
**Decision:** every change went through its own pull request with a description, the tests and the browser check, then was merged and checked live. Bugs were fixed forward in new pull requests, each with a test for the case it missed.

## Things we chose not to do

- **GitHub discovery:** it finds code, not reception (decision 1).
- **Reddit:** it blocks GitHub's servers. It would need an API key from the owner.
- **Hand-curating ratings:** against the "no action from my side" rule (decision 11).
- **Auto-posting on X as the owner:** off by default (decision 15).
- **A server or database:** a static site and free services cover everything (decision 12).
- **More frequent scans:** every 4 hours or less would exceed the X budget for little gain, since launches play out over days (decision 14).

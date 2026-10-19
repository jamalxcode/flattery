# Flattery

> “Imitation is the sincerest form of flattery that mediocrity can pay to greatness.” — Oscar Wilde

Finds GitHub projects that look like AI-built ("vibe coded") reimplementations of existing software, and shows the evidence for each one.

**Run it in the browser:** https://jamalxcode.github.io/flattery/

**Latest scan** shows a broad scan that a GitHub Action runs every 10 minutes and publishes with the site, so it needs no token. Until the next scan lands, the page shows the previous one, and an open page swaps in the new one by itself. The same results are at [`data/latest.html`](https://jamalxcode.github.io/flattery/data/latest.html) and [`data/latest.json`](https://jamalxcode.github.io/flattery/data/latest.json).

**Run your own scan** lets you name a target project, e.g. `redis`, and the original repo, e.g. `redis/redis`. A token is optional: without one GitHub allows 60 requests an hour (about 25 repos) and no code search; a fine-grained token with no extra permissions raises that to 5,000. The token stays in your browser and is sent only to `api.github.com`. Results can be downloaded as a standalone HTML report or as JSON.

GitHub runs scheduled workflows on a best-effort basis, so a scan can arrive a few minutes late, and it pauses them in a repo with no activity for 60 days (re-enable under Actions).

## How it scores

Each repo gets two scores from 0 to 100:

- **AI-built**: agent config files (`CLAUDE.md`, `.claude/`, `AGENTS.md`, `.cursorrules`, `.cursor/`, `.windsurfrules`, `.aider*`, `copilot-instructions.md`, `GEMINI.md`…), AI co-author trailers in recent commits, burst or big-bang commit history, plan files left by agents, "vibe coded" wording, and README style (✅ lists, emoji headings).
- **Reimplementation**: claims like "drop-in replacement", "clean-room", "rewrite of", "compatible with", "port of", "from spec", plus benchmark sections and compatibility tables.

**Combined** is the geometric mean of the two, so a repo needs both to rank high.

When you give an original repo, each candidate is also checked for a **license change** against the original (e.g. LGPL → MIT), a high **file-name overlap**, and how often its README mentions the original by name.

These are heuristics. A high score is a reason to look closer, not proof of copying or of a legal problem. A repo with no signals isn't necessarily human-written.

## How it finds candidates

- Repo search for reimplementation wording (scoped to the target name when given)
- Code search for agent config files (`path:CLAUDE.md`, `path:AGENTS.md`, …)
- Commit search for `Co-Authored-By: Claude` / `Generated with Claude Code`
- Any repos you list by hand

## Command line

`cli/flattery.py` does the same scan from a terminal (Python 3, standard library only) and writes an HTML report:

```sh
export GITHUB_TOKEN=github_pat_...
python3 cli/flattery.py --target redis --original redis/redis -o redis.html
python3 cli/flattery.py --since 2026-01-01 --language rust --max-repos 100
python3 cli/flattery.py --demo          # sample report, no network
python3 cli/flattery.py --json data.json --cache data.json   # reuse analyses from the last run
```

Run `python3 cli/flattery.py --help` for all options.

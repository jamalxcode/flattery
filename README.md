# Flattery

> “Imitation is the sincerest form of flattery that mediocrity can pay to greatness.” — Oscar Wilde

Finds GitHub projects that look like AI-built ("vibe coded") reimplementations of existing software, and shows the evidence for each one.

**Run it in the browser:** https://jamalxcode.github.io/flattery/

Paste a GitHub token (a fine-grained token with no extra permissions is enough). Optionally name a target project, e.g. `redis`, and the original repo, e.g. `redis/redis`, then press **Scan GitHub**. Results can be downloaded as a standalone HTML report or as JSON. The token stays in your browser and is sent only to `api.github.com`.

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
```

Run `python3 cli/flattery.py --help` for all options.

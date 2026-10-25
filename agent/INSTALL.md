# The Mirage skill pack

Seven skills in the open Agent Skills format (one folder per skill, `SKILL.md` with `name` and `description`
frontmatter, optional `references/` and `assets/`). They teach an agent to build a Mirage world from a brief, in
parallel, and to prove it works.

| skill | for |
|---|---|
| `mirage-router` | entry point: finds the engine and the project, picks the next skill |
| `mirage-brief-to-plan` | idea → brief → site plan → module briefs → project scaffold |
| `mirage-module` | writing one module that follows the world protocol |
| `mirage-parallel-build` | a lead running one worker agent per module; the coordination contract |
| `mirage-playtest` | build → run → scripted inputs → screenshots + metrics → pass / fail → fix |
| `mirage-game` | interactables, inventory, flags, doors, saves, input, sound, HUD (`@mirage/game`) |
| `mirage-ship` | single file, budgets, deploy folder (uploads nothing), credits / licences |

The skills run the tools in this repo (`packages/tools`), so the agent needs a clone of Mirage; worlds live in it
as `examples/<name>` until the packages are published. `node agent/check.mjs` validates the pack (also part of
`npm test`).

## Claude Code

Personal (every project): link or copy each skill folder into `~/.claude/skills/`.

```bash
for s in /path/to/mirage-engine/agent/mirage-*/; do ln -sfn "$s" ~/.claude/skills/"$(basename "$s")"; done
```

Per project (shared with the team through git): the same into `<project>/.claude/skills/`. Restart Claude Code;
the skills load by their descriptions ("build a world", "playtest", "ship it"), or call one by name
(`/mirage-router`). Parallel builds use Claude Code's background sub-agents (`mirage-parallel-build` §2).

## Codex, Cursor and other Agent Skills clients

Put the folders in the project's `.agents/skills/` (the cross-tool location these clients read):

```bash
mkdir -p .agents/skills && cp -R /path/to/mirage-engine/agent/mirage-* .agents/skills/
```

User-level locations differ per tool and version; check its documentation. Clients without skills support can be
pointed at the files directly ("read agent/mirage-router/SKILL.md and follow it"); every skill is plain Markdown
and works that way too. For parallel work, start one session per module in the same checkout with the prompt in
`mirage-parallel-build/references/worker-prompt.md`.

## Using Mirage inside Claude-Code-Game-Studios

Claude-Code-Game-Studios (MIT) organises a game project as a studio of role agents. Mirage does not replace any
of them; it gives the roles that make the *world* a code-only engine and a verification loop. Install this pack in
the studio project's `.claude/skills/` (above), then point each role at its skills — in the role's own agent
definition or in the task you hand it. Nothing from that project needs to be copied into Mirage, or the reverse.

| studio role (general terms) | Mirage skills | what it produces |
|---|---|---|
| world builder / environment lead | `mirage-brief-to-plan`, `mirage-parallel-build` (as lead) | BRIEF.md, plan.js, module briefs, the integrated world |
| level designer | `mirage-brief-to-plan` (regions, paths, routes, viewpoints), `mirage-game` (interactables, objectives) | the plan's layout, `game.js`, the route the playtest walks |
| technical artist | `mirage-module` (materials through hooks, LOD, budgets, collider proxies), `mirage-playtest` (flicker, frame cost) | modules that meet budget, no flicker |
| environment / prop artists (one per module) | `mirage-module` as workers under `mirage-parallel-build` | `modules/<name>.js`, a passing module scenario |
| gameplay programmer | `mirage-game` | entities from anchors, saves, input, sound |
| QA | `mirage-playtest` | scenarios, `report.md` + `sheet.png` per build, regressions as new steps |
| release / producer | `mirage-ship` | the single file, the deploy folder, the checklist — never the upload |

The studio's own planning, design-document and review flow stays as it is; the hand-off points are files
(`BRIEF.md`, `plan.js`, `NOTES.md`, the playtest reports), so any role agent can read what another produced.

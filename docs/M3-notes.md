# M3 notes — the agent skill pack, the playtest loop, a world built by agents

M3 adds `agent/` (seven skills in the Agent Skills format, an install guide, a validator), the playtest runner in
`packages/tools`, two engine fixes found by agents using the pack, and `examples/agent-trial`: a seaside pier with
a lighthouse at dusk, planned by a lead agent from the skills and built by three sub-agents in parallel. All new code
is Mirage original code; nothing comes from the author's earlier project or from Golden Temple (the old
`flickerwalk` idea — flicker measured along a walk — was written fresh inside `playtest.mjs`).

## What

- **Skills** (`agent/<name>/SKILL.md`, frontmatter `name` = folder, `description` with trigger phrases):

  | skill | one line |
  |---|---|
  | `mirage-router` | entry point: finds the engine and the project, routes to the others, the rules that hold everywhere |
  | `mirage-brief-to-plan` | "先定方向再建设": a one-paragraph idea → BRIEF.md (idea, mood, references, scale, target) → plan.js → module briefs → scaffold (`assets/skeleton`, templates in `references/`) |
  | `mirage-module` | one module by the protocol: plan-only positions, `ctx.R`, batching and geometry signatures, materials through hooks, collision rules and proxies, anchors, budgets, NOTES, self-test |
  | `mirage-parallel-build` | the lead's side: preconditions, the ownership / plan / anchors / NOTES / builds contract, launching in Claude Code, Codex, Cursor or sequentially, integration and conflict order; `references/worker-prompt.md` |
  | `mirage-playtest` | build → run → scripted inputs → screenshots + metrics → pass / fail → fix → rerun; scenario format, what every world must check, a failure table |
  | `mirage-game` | `@mirage/game` from a module's anchors: `startGame`, interactables, state, physics, saves, sound, UI, how to test it |
  | `mirage-ship` | single file, budgets, deploy folder (uploads nothing, never without the user's explicit OK), credits / licence checklist |

  `agent/INSTALL.md`: Claude Code (`~/.claude/skills` or `.claude/skills`), Codex / Cursor (`.agents/skills`),
  plain-file use, and a role → skill map for Claude-Code-Game-Studios (described in general terms, nothing copied).
  `agent/check.mjs` (in `npm test`): name = folder, name format, description present and ≤ 1024 chars, every
  `references/` / `assets/` path a skill mentions exists. Current descriptions: 462–563 chars.
- **`packages/tools/src/playtest.mjs`** (`mirage-playtest`): one JSON scenario against any Mirage page (dist folder or
  single file). Steps: `place / mode / viewpoint`, `walkTo` (steer through points; "stuck" after 2.5 s without
  progress vs "timed out"), `lookAt` (a point or a game entity), `tap`, held `keys`, `flicker` (the camera walks a path
  or `plan.paths` entry at walking speed following the ground, one TAA frame per 1/60 s, grain off; mean and worst
  `|f0 − 2f1 + f2|`, where, and the worst triple saved as a picture and a ×4 difference image), `perf` (synchronous
  frame cost while keys act, draw calls, triangles). Expectations on feet position, `maxY`, `dist`, ground,
  mode, fps, console errors, game state (`near`, `prompt`, `inventory`, `paused`, `flags.*`), flicker and frame
  numbers. Output: `report.md` (verdict, GPU, load, per-module triangles and build ms, anchors, walk grid, a row per
  step, metrics, console), `report.json`, one screenshot per step, `sheet.png` (contact sheet, verdict per
  thumbnail). `walktest.mjs` is now an alias (M2's scenarios run unchanged); `perf` got a bin.
- **Scenarios**: courtyard and garden walk tests gained a flicker walk and a frame-cost step; garden-quest got
  `scenarios/playtest.json` (start, walk 45 m to the key, prompt, pick up, climb to the pavilion, unlock, flicker,
  frame cost); every example has `npm run playtest`.
- **Engine fixes** (both reported or exposed by the trial, both with checks):
  - `@mirage/play` walker: a falling walker whose disc overlapped an overhang (a bench seat, a coping lip) never
    landed and fell through the world. It now never moves into a place its body does not fit: going up that is a
    ceiling, coming down it lands on the edge; with no floor at all under its centre it still falls. New case in
    `packages/play/check.mjs` (jumps at an overhanging bench from 26 distances: lowest feet 0.00, was −5.04).
  - `@mirage/game` input: a key pressed inside a dialog also queued its action, so Enter on "Continue" interacted
    as the dialog closed (in the trial it turned the lighthouse straight off again). Inside a dialog only the menu /
    inventory toggles pass now. garden-quest's 37-step playthrough passes unchanged.
- **agent-trial**: brief, plan (90 × 60 m walkable, sea level 0, promenade and deck at 2.4 m, sun 1.2° at 262°),
  three modules (shore: sea, seawall, promenade with parapet and land wall, benches, entrance lamp posts, hills;
  pier: 56 m timber deck on piles with bracing, rails, a 12 × 12 m head, five lamp posts; lighthouse: plinth, tapering
  white shaft with a red band, door, lever plate, gallery, lantern room, lens), and `game.js`: seven lanterns on the
  `lamps` anchors, a lever on `levers`, the lamp with a light and two slowly turning, fading beams on `beacon`;
  wind, water, footsteps on wood and stone, the start screen, saves. `TRIAL.md` records every step, what was read,
  where the skills were unclear and what changed.

## Numbers (Apple M4 Pro, ANGLE Metal, Chrome headless, 1440 × 900)

Playtests of all four examples after the last change (reports and contact sheets in the M3 artefact folder):

| example | steps | console | flicker mean / max (where) | frame ms mean / p95 | calls, triangles | load to ready |
|---|---|---|---|---|---|---|
| hello-courtyard | 14 / 14 | 0 | 4.84 / 7.61 | 3.45 / 3.8 | 50, 120 k | 3.4 s |
| walled-garden | 18 / 18 | 0 | 4.23 / 7.04 | 3.93 / 4.3 | 60, 406 k | 6.4 s |
| garden-quest | 9 / 9 | 0 | 1.84 / 10.7 (basin) | 4.08 / 4.6 | 90, 409 k | 7.8 s |
| agent-trial | 17 / 17 | 0 | 2.55 / 49.0 (sun behind a post) | 4.03 / 4.5 | 103, 86 k | 5.2 s (first load) |
| agent-trial, single file (file://) | 17 / 17 | 0 | 2.56 / 51.4 | 4.16 / 4.5 | 103, 86 k | 1.0 s |

- Also: garden-quest's scripted playthrough 37 / 37 (main, gamepad, touch), `snap.mjs` of courtyard (7 views),
  garden (10) and agent-trial (9), 0 console errors each; `npm test` (core, world, play, game, skills) ok.
- agent-trial: modules shore 42.1 k triangles / 25 ms, pier 9.0 k / 9 ms, lighthouse 7.5 k / 5 ms; world build
  39 ms; anchors lamps 7, seats 3, levers 1, beacon 1; walk grid 704 × 480 × 66 slabs, ~180 ms. Single file
  3.00 MB, code only (2.24 MB of it Rapier); deploy folder 3 files, nothing uploaded.
- The trial's workers (fresh Claude Code sub-agents, in parallel, same checkout): shore 14.3 min, 30 tool calls;
  pier 7.9 min, 18; lighthouse 6.8 min, 26. Each passed its own scenario (18 / 17 / 13 steps) before handing back; no
  module needed changes after integration; the lead made one plan addition (`lampPost.h`) on a request.
- Flicker is a relative number: forward walking between near walls (courtyard) measures ~5, open ground ~2. The
  trial's maximum is real: walking toward the low sun, an entrance lamp post crosses the sun disc for one frame and
  the whole bloom changes (the saved difference image shows it). Path ends no longer swing the view (a one-segment
  walk to the pier entrance: max 11.1 → 2.1).

## Lines

| part | lines |
|---|---|
| `agent/` (7 SKILL.md, 4 references, skeleton, INSTALL, check) | 583 skills + 137 references + 64 install + 33 check + skeleton ~90 |
| `packages/tools/src/playtest.mjs` | 265 (walktest.mjs 87 → 3) |
| engine fixes | walker +7 / −3, input +4 / −2, play check +8 |
| `examples/agent-trial` | plan 72, main 44, game 99, modules 446 (shore 183, pier 139, lighthouse 124), scenarios: whole world 23 + the workers' three |

## Open problems / not done

- **Validation breadth**: one trial, one round, Claude Code only. Codex / Cursor launching is described, not run; the
  lead was the skills' author (the three workers were fresh); no worker had to take a fix back after integration.
- **Self-tests see one module**: a worker cannot see the seams with its neighbours until integration (the
  parallel-build skill says so; a "neighbour preview" build of producers' current files is possible with
  `?modules=` but was not needed).
- **Playtest**: wall-clock key holds (positions vary by centimetres between runs); flicker covers at most 600 frames
  (14 m walking, 42 m at run speed); no image comparison against a reference (the contact sheet is read by the
  agent, which caught the light-off bug that every expectation missed — a pixel probe on lit lamps would catch it
  without eyes); `perf` runs in the headless page, vsync-free, not on a phone.
- **Skills**: no skill for textures (the texture layer is mentioned, not taught), terrain or vegetation kits (they do
  not exist as packages yet: modules write their own); `mirage-game` covers one interactable pattern, not quests as
  data; descriptions are tuned by hand, not measured for triggering.
- **agent-trial look**: the sea is a flat plane with a bump (no waves, no foam at the piles); a dark vertical smear
  shows on the water in the view from the sea; the land behind the promenade is plain; the lighthouse beam is two
  additive cones (no volumetric scattering).
- **Walker fix ceiling**: a walker that lands on an overhang edge stands there (the disc is partly over the void);
  it does not slide off. Fine at the 0.125 m grid; a swept capsule would be the upgrade.

# Trial: building a world from the skill pack alone

M3's acceptance test: an agent with no Mirage knowledge beyond `agent/` builds a small world, verifies it and
ships it. The lead (one agent) followed the skills step by step; the three modules were written by three fresh
sub-agents running at the same time (Claude Code background agents), each given only the filled worker prompt from
`agent/mirage-parallel-build/references/worker-prompt.md`. Every place a skill was unclear, wrong or silent is
listed below with what was changed. Date: 2026-10-25.

## Steps

| # | step (skill) | what was read | result |
|---|---|---|---|
| 1 | route (`mirage-router`) | router SKILL.md, `docs/world-protocol.md` | no project yet → brief-to-plan |
| 2 | brief (`mirage-brief-to-plan` §1) | brief template | `BRIEF.md`: idea, mood (dusk, sun 1.2° at 262°), references (kinds of place), scale (90 × 60 m, 70 m route), target (walk + one interactable, ≤ 5 MB, ≤ 8 ms); 4 decisions written down |
| 3 | plan (§2) | plan template | `plan.js`: bounds, walk range, render (place, fixed sun, shadow, probe, fog), budget, shore / pier / lighthouse parameters, regions, footprints, paths (`pier`, `route`), points, 8 viewpoints, spawn; checked in node with the skill's `definePlan` one-liner |
| 4 | module briefs (§3) | brief template § Modules | three briefs (owns / builds / reads / anchors / collision / budget / done-when); anchor contract fixed: `lamps` (shore 2, pier ≈ 5), `seats`, `levers`, `beacon` |
| 5 | scaffold (§4) | `assets/skeleton` | copied; stubs for the three modules, shared `materials.js`, NOTES headers; the stub world passed its one-step playtest |
| 6 | fan out (`mirage-parallel-build` §2) | worker prompt | three `Agent` calls in one message, in the background, same checkout |
| 7 | workers (`mirage-module`, `mirage-playtest`) | each read the two skills, the protocol, BRIEF, plan, NOTES, materials | shore 18 / 18 steps, pier 17 / 17, lighthouse 13 / 13, all 0 console errors, each looked at its own contact sheet (wall time 14.3 / 7.9 / 6.8 min) |
| 8 | answer requests (§2) | NOTES | shore asked for `lampPost.h` in the plan (added; the lead edited both local constants, noted in NOTES § lead) and reported a walker bug (fixed in the engine, below) |
| 9 | integrate (§3) | the three hand-backs and reports | build order shore → pier → lighthouse; whole-world scenario: route, parapet / rails / tower / head rail with jumps, the lever, flicker along the route, frame cost, five views |
| 10 | game (`mirage-game`) | game SKILL.md, garden-quest | `main.js` switched to `startGame`; `game.js` spawns 7 lanterns on `lamps`, the lever on `levers`, the lamp, its light and two turning beams on `beacon` |
| 11 | playtest loop (`mirage-playtest`) | report.md, sheet.png | run 1 passed every step — and the sheet showed the light **off** after the message closed (see "found by looking"); fixed, rerun, pass |
| 12 | ship (`mirage-ship`) | ship SKILL.md | `release/agent-trial.html` 3.00 MB (code only; 2.24 MB of it Rapier); the same scenario passes on the single file from file://; deploy folder made outside the repo, nothing uploaded |

## Where the skills were unclear, and what changed

From the three workers' hand-backs (they were asked to name skill, line and what they had to guess) and the lead:

| skill | problem | fix |
|---|---|---|
| mirage-module rule 3 | no API shapes: `lathe` profile format, `box` rotation units / order and bevel, `cylinder`, `finish()` returning a Group (all three workers read `geom.js`) | rule 3 now lists signatures: `[[radius, y], …]` bottom to top, Euler radians order YXZ, bevel, `b.cylinder`, Group |
| mirage-module rule 4 | `PROC` options (`wear`, `foot`, wood `axis`) undocumented; extending a PROC set unclear; no water material (shore copied walled-garden's) | options listed, "you may append to its `albedo`", a water one-liner |
| mirage-module rule 5 | "0.4–1.0 m can be jumped onto" but the brief called a 0.9 m parapet a barrier (shore found it can be jumped and added a 1.3 m proxy); walker width not stated (pier derived the 0.3 m stand-off) | barriers > 1.0 m or a ≥ 1.1 m proxy; walker r 0.28 m, stops ~0.3 m short, passages ≥ 0.6 m |
| mirage-module rule 5 | a falling walker under an overhang (bench seat, coping lip) fell through the world | engine bug, fixed (below); the rule now says overhangs are fine |
| mirage-playtest | `viewpoint` index or name, from 0 or 1? | "an index into `plan.viewpoints`, from 0" |
| mirage-playtest | `walkTo` default timeout produced the same "stuck" message as a real collision (pier hunted a non-existent bug) | the tool now says "stuck" (no progress 2.5 s) or "timed out" (still moving); skill notes 1.5 m/s and `run` |
| mirage-playtest | `walkTo` stops within `tol` of the target, so `x < target` fails by centimetres; the skill's own example hid this | stated, with an example |
| mirage-playtest | bounds edges | "no floor beyond `plan.bounds`: walkers stop there" |
| mirage-brief-to-plan §4 | the skeleton has `<one line>` placeholders the step did not mention; the brief template said `<world name>` | step 4 lists both and a grep; template uses `<name>` |
| mirage-parallel-build | the worker prompt did not forbid commits | "Do not commit (the lead does)" |
| mirage-playtest | a flicker spike with no way to see what flickered | the tool saves the worst triple (`-worst.png`, `-worst-diff.png`); the table says how to read it |

Found by the lead while integrating:

- **The path end** (tool): the flicker walk's look-ahead point clamped at the path's end, so the view swung round in
  the last 6 m (flickerMax 11 on a straight walk). The path now runs straight on past its end (max 2.1 on the same
  walk).
- **Enter in a dialog** (engine, `@mirage/game` input): closing "The lamp is lit" with Enter also queued the
  `interact` action, which fired when the dialog closed and turned the light straight off. Every expectation still
  passed (they were all before the dialog); only the contact sheet showed dark lanterns after step 7. Keys pressed
  inside a dialog now only pass the menu / inventory toggles. The scenario checks `flags.lit` after closing, and the
  playtest skill says to.
- **A real flicker spike**: `flickerMax` 42–50 at (2.4, 3.2) on the promenade. The worst-diff picture shows the
  whole sun bloom changing: walking toward the low sun, an entrance lamp post crosses the sun disc for a frame. It is
  physically right (the sun goes behind a post), so it is accepted and listed in the skill's table; the mean along
  the route is 1.7–2.6.

## Results

See `docs/M3-notes.md` for the numbers of the final run (all four examples).

- Modules: shore 42.1 k triangles (6 materials), pier 9.0 k (4), lighthouse 7.5 k (6); world build 39 ms; walk grid
  704 × 480 cells × 66 slabs in ~180 ms.
- Whole-world playtest: 17 / 17 steps, 0 console errors or warnings, served over http and as the single file.
- Lines: plan 72, main 44, game 99, modules 446 (shore 183, pier 139, lighthouse 124).

## What the trial did not cover

- The workers could not see each other's parts in their self-tests (no shore under the pier, no sea under the
  tower); the seams were first seen at integration (they were right: the pier's slab overlaps the promenade by
  0.1 m at the same height, its rails close the parapet opening to 0.26 m).
- One round: no worker had to change its module after integration, so "send the failure back to its owner" (§3.5)
  was not exercised; neither were Codex or Cursor (only the Claude Code path of §2).
- The lead is the author of the skills; the workers were fresh agents. A fully independent lead remains to be tried.

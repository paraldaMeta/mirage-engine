---
name: mirage-playtest
description: The agent self-test loop for a Mirage world - build, run it in the real Chrome, drive it with a scripted JSON scenario (walk routes, keys, interactions), collect screenshots, a contact sheet and metrics (positions, collision, console errors, flicker along a path, frame time), read the pass/fail report, fix, rerun. Use after any change to a Mirage world, before saying a world or module is done, and when the user says "test it", "playtest", "does it work", "check collisions", "is it flickering", "how fast is it", "screenshots".
---

# Playtest loop

**build → run → scripted inputs → screenshots + metrics → pass / fail → fix → rerun.** A world is done when its
scenario passes with 0 console errors *and* you have looked at the contact sheet. Tools drive the local Chrome
headless with the GPU (macOS default path, or `$CHROME`).

```bash
cd $MIRAGE/examples/<world>
npx vite build                                    # or --outDir out/dist-<module> when others build too
node ../../packages/tools/src/playtest.mjs scenarios/playtest.json dist --out out/playtest
#  -> out/playtest/report.md (read this), report.json, NN-<step>.png, sheet.png (look at this); exit 1 = fail
node ../../packages/tools/src/snap.mjs dist --out out/snap --game     # every plan viewpoint, still path, sheet.png
```

The page contract: `window.__mirage = { world, built, play, g? }` and `window.__READY = true` (the skeleton's
`main.js` and every example do it). A `.html` single file or an http(s) URL works as the target too.

## Read the diagnostics first

Every problem the tools find is one diagnostic `{ code, severity, target, message, fix, at? }`: in `report.json`
`diagnostics`, as the **Diagnostics** table at the top of `report.md`, and on the terminal. They are ordered errors
first, root causes (plan, modules, spawn) before the step failures they cause. **Work down that list: do what `fix`
says** (it names the field, the value or position to use, the file), rerun, repeat. Codes: `docs/diagnostics.md`
(MG1xx plan, MG2xx modules, MG3xx walking / collision, MG4xx what the frame shows, MG5xx budgets, MG6xx console,
MG7xx game state). Errors fail the run; warnings (a floating object MG320, coplanar faces MG450, a black frame MG440,
over the triangle budget MG504, a viewpoint that misses its subject MG412) are real defects too: fix them before
calling a world done.

Beyond your expectations, every playtest checks at load (scenario `"checks": false` turns it off): the spawn and every
plan viewpoint against the walk grid (inside a solid, no floor), floating objects, coplanar surfaces, what each
viewpoint shows (give a viewpoint `see: ["rail"]`, or name it after its subject, and it must show it), the triangle
budget. Without a scenario: `node ../../packages/tools/src/check-world.mjs dist [--json]`; the plan alone:
`node ../../packages/tools/src/validate-plan.mjs plan.js [--json]`.

## Scenario (`scenarios/*.json`)

```json
{ "title": "pier: deck and rails", "query": "mode=walk&ui=0&grain=0&modules=shore,pier", "w": 1440, "h": 900,
  "steps": [
    { "name": "spawn", "ms": 300, "expect": { "onGround": "== true", "y": "~ 2.0 0.05" } },
    { "name": "walk-the-deck", "walkTo": [[-10, 0], [-50, 0]], "run": true, "expect": { "x": "< -49" } },
    { "name": "rail-blocks", "place": { "eye": [-30, 3.62, 0], "look": [-30, 3.62, 9], "mode": "walk" },
      "keys": ["KeyW"], "ms": 2500, "expect": { "z": "< 1.9", "y": "~ 2.0 0.05" } },
    { "name": "lever-prompt", "lookAt": "lever", "expect": { "near": "== lever", "prompt": "has Light" } },
    { "name": "use-lever", "tap": "KeyE", "ms": 500, "expect": { "flags.lit": "== true" } },
    { "name": "flicker-walk", "flicker": { "path": "pier" }, "expect": { "flicker": "< 8" } },
    { "name": "frame-cost", "keys": ["KeyW"], "perf": { "frames": 90 }, "expect": { "frameMs": "< 8" } }
  ] }
```

Step fields run in this order: `place` / `mode` / `viewpoint` (an index into `plan.viewpoints`, from 0) → `walkTo`
(hold W, steer through `[x, z]` points; `run`, `tol` 0.35 m, `timeout` 30 s; fails with "stuck" *or* "timed out";
walking is 1.5 m/s, so long walks need `"run": true`; it stops within `tol` of the target, so expect `x > -59.6`,
not `x < -60`, for a target at −60) → `lookAt` (`[x, y, z]` or a game entity id) → `tap` (key
codes) → `keys` + `ms` (held) or `ms` (wait) → `flicker` → `perf`. Expectations: `"<op> <value> [tol]"`, ops
`< > <= >= ~ == != has`; values `x y z` (feet), `maxY`, `dist` (moved this step), `onGround`, `blocked`,
`mode`, `fps`, `errors`; games add `near`, `prompt`, `inventory` (`has key`, `inventory.length`), `paused`,
`flags.<name>`; `flicker`, `flickerMax`, `flickerMaxAt`, `meanAbsDiff`; `frameMs`, `p95Ms`, `calls`,
`triangles`; `luma`, `dark`, `clipped` (of the step's screenshot). Full reference: the header of
`packages/tools/src/playtest.mjs`.

`"see"` checks what the final view shows: `{ "rail": ">= 0.005", "station": "> 0.02" }` (share of the frame,
0..1) or `["rail"]` (each `> 0.001`). A name matches an object or anything under a node of that name; a module's
root carries the module's name. A failed `see` says why: *out of frame*, *hidden* or *mostly hidden by* the named
objects in front, or *too small*. Glass and water do not hide what is behind them. Name the meshes you will want to
check (`b.finish({ name: 'rail' })`).

## What every world's scenario checks

1. **Spawn** on the ground (`onGround == true`, `y ~ floor`).
2. **The route** from BRIEF.md as one or more `walkTo` steps: proves it is connected and walkable.
3. **Every barrier** that must hold (walls, railings, water edges, cliff edges): walk straight at it, expect the
   position to stop ~0.3 m before it (the walker's radius) and `y` unchanged; also `tap: "Space"` while walking
   at the low ones (≤ 1.0 m can be jumped). A barrier you do not test is a hole. The edge of `plan.bounds` has
   no floor beyond it: walkers stop there.
4. **Every opening** that must pass (gates, doors, stairs: expect `y` at the top floor).
5. **Interactables** (games): `walkTo` near, `lookAt` the entity, `prompt` text, `tap: "KeyE"`, the flag or item;
   after closing any message (`tap: "Enter"`) expect the flag again — a toggle can flip back unseen.
6. **Flicker** along the main path: `< 8` (walking through a tight court measures ~6, open garden ~2). Spikes:
   `flickerMaxAt` says where.
7. **Frame cost** walking: `frameMs < plan.budget.frameMs` (8 ms on an M-series; 16.7 is the 60 fps limit).
8. **Shots**: every composition the brief asks for (each viewpoint, the barrier you claim the player sees)
   gets a `see` with the objects it is about: a test that passes while the subject is out of frame proves
   nothing. The sheet is still the visual check (scale, gaps, floating parts, black or blown-out materials, the
   sky and mood the brief asked for); a black or clipped screenshot is listed as a warning in the report.

## Reading failures

The diagnostics already measure most of these (the gap and the two objects either side of it, the width of an
opening and the plan field behind it, the proxy box to add, the free spot for a spawn inside a crate). The table is
for what they cannot see:

| symptom | usual cause | fix |
|---|---|---|
| `walkTo: stuck at …` | a gap narrower than 0.6 m, a step > 0.4 m, a proxy too big | measure in plan terms; widen, add a step, shrink the proxy |
| walked through a wall / rail | open mesh, or thinner than 0.125 m | closed geometry or a `ctx.collider` proxy ≥ 0.2 m |
| fell (`y` far below the floor) | floor is an open plane / `collide = false` / outside `walk.yMax` | closed slab; raise `plan.walk.yMax` |
| `onGround false` at spawn | spawn eye not 1.62 above a floor, or over water | fix `plan.spawn` |
| high `flicker` at one spot | coplanar faces (z-fight), sub-pixel high-contrast detail, an animated thing; looking into a low sun, a thin post crossing the disc flashes the bloom (real, ~40 for one frame) | open `NN-<step>-worst-diff.png` (bright = what flickered); offset 1–2 cm, coarsen detail, exclude the animation; accept a sun crossing |
| console error, module listed failed in the report header | the module threw | read the error: it names the module and phase |
| `prompt` null | entity out of `reach` (2.4 m) or outside the view cone | walk closer, `lookAt` the entity id |
| `see.<name>` fails: out of frame | the camera looks past it (a barrier right at your feet is below the view) | step back, `lookAt` it, or `place` a view that frames it |
| `see.<name>` fails: hidden by … | the named objects stand in front | move the view, or the object; check it is not inside another mesh |
| black / white surfaces in shots | NaN normals, `emissive` too strong, wrong side | check the material hook, `side: DoubleSide` only for cards |

`walkTo` also writes `NN-<step>-route.png`: the walk grid from above, the planned route (dashed), the path taken,
the stuck point (red cross); `"onion": true` adds the game entities that moved. Open it first when a walk fails.

Loop: fix → rebuild → rerun the same scenario. Add a step for every bug you fix so it stays fixed. After five
rounds without progress, stop and report what fails, with the report and the screenshot.

## Regressions, determinism, variants, phone, text

- **Baseline** (before a refactor): `snap.mjs dist --baseline baseline/` writes the stills the first time and
  compares later runs by region SSIM (4 × 4 cells; mean 0.92, 5th percentile 0.85, worst cell 0.75; `--ssim`
  to change). A miss is MG460 with `baseline-diff-*.png` (baseline | now, worst cell boxed). In a scenario:
  `"baseline": "baseline/"` compares every step whose view `place` / `viewpoint` fixed (a walk ends anywhere
  within `tol`; `"baseline": true` on a step forces it).
- **Determinism**: `snap.mjs dist --determinism` draws every view again after another view and after a reload;
  any pixel off is MG461. A clock of your own (a game system's `t += dt`) must restart on `game.on('place')`;
  a pile of physics props must `physics.settle()` at setup.
- **Variants**: `snap.mjs dist --views 0 --variants "time=dusk;time=noon;post.bloom=0.2;quality=low"` → one
  labelled grid per view (≤ 16, 4 columns). `time` and dotted `world` settings change in place; other keys reload
  the page with that query.
- **Phone**: `--phone` on snap or playtest shoots 375 × 812 and lays the sheet out one phone wide per tile.
- **Text over the scene**: `"contrast": true` on a step measures every visible prompt / HUD line against what is
  behind its glyphs; under WCAG AA (4.5:1, large 3:1) is MG710.

## Review (before you call it done)

1. **A stranger's sentence**: for each key view on the sheet, write one sentence as someone who never read the
   brief would, naming every object. A thing you would have to explain ("that box is a well") is a **P0**.
2. **Against the brief**: compare each view with BRIEF.md's numbers and its BANNED line; every default you see
   (from the line or new) goes on the line and is fixed first.
3. **Notes**: one line each, `where · problem → concrete fix` (`view "gate" · arch reads as a tunnel → lower
   it to 3.2 m, add the 0.4 m keystone`), ranked **P0** (wrong, broken, unreadable), **P1** (weakens it), **P2**
   (polish). Fix every P0 and the P1s worth it, rerun only what changed. Never score the world out of 10.
4. **Fresh eyes**: if you can start a sub-agent, give it only BRIEF.md and `sheet.png` (and the phone sheet), ask
   for P0 / P1 lines in that format, and keep the editing to yourself.
5. **REVIEW.md** at delivery, its short form in your reply: the calls you made and what you left out; what was
   measured and what was only looked at; the weakest view and what you would change; warnings kept on purpose.

Other tools: `packages/tools/src/perf.mjs <dist>` (frame cost of walk / game / fly / stills), `walktest.mjs` (an
alias of playtest kept for older scripts).

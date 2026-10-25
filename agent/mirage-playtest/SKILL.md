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
`main.js` and every example do it). A `.html` single file works as the target too (opened from file://).

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
`triangles`. Full reference: the header of `packages/tools/src/playtest.mjs`.

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
8. **Shots**: every step saves one; the sheet is the visual check (scale, gaps, floating parts, black or
   blown-out materials, the sky and mood the brief asked for).

## Reading failures

| symptom | usual cause | fix |
|---|---|---|
| `walkTo: stuck at …` | a gap narrower than 0.6 m, a step > 0.4 m, a proxy too big | measure in plan terms; widen, add a step, shrink the proxy |
| walked through a wall / rail | open mesh, or thinner than 0.125 m | closed geometry or a `ctx.collider` proxy ≥ 0.2 m |
| fell (`y` far below the floor) | floor is an open plane / `collide = false` / outside `walk.yMax` | closed slab; raise `plan.walk.yMax` |
| `onGround false` at spawn | spawn eye not 1.62 above a floor, or over water | fix `plan.spawn` |
| high `flicker` at one spot | coplanar faces (z-fight), sub-pixel high-contrast detail, an animated thing; looking into a low sun, a thin post crossing the disc flashes the bloom (real, ~40 for one frame) | open `NN-<step>-worst-diff.png` (bright = what flickered); offset 1–2 cm, coarsen detail, exclude the animation; accept a sun crossing |
| console error, module listed failed in the report header | the module threw | read the error: it names the module and phase |
| `prompt` null | entity out of `reach` (2.4 m) or outside the view cone | walk closer, `lookAt` the entity id |
| black / white surfaces in shots | NaN normals, `emissive` too strong, wrong side | check the material hook, `side: DoubleSide` only for cards |

Loop: fix → rebuild → rerun the same scenario. Add a step for every bug you fix so it stays fixed. After five
rounds without progress, stop and report what fails, with the report and the screenshot.

Other tools: `packages/tools/src/perf.mjs <dist>` (frame cost of walk / game / fly / stills), `walktest.mjs` (an
alias of playtest kept for older scripts).

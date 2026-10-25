# Brief — snow-hut

> A small mountain hut on a snowy slope at night or blue hour, falling snow, warm lit windows, a few pines;
> walkable, with one thing to do (light the stove). A contrast to the warm, sunlit examples.

| field | choice |
|---|---|
| idea | a one-room log hut in a fenced yard on a slope; walk in out of the snow and light the iron stove |
| mood | blue hour (sun 6° under the horizon, WNW), light haze, falling snow; blue-white snow, near-black pines, amber windows and lantern; wind |
| references | alpine shepherds' huts, split-rail fences, snow-laden spruce (kinds of place, no named site) |
| scale | yard 32 × 26 m inside the fence; hut 6 × 5 m outside; the walk from the gate side to the stove ≈ 17 m (≈ 11 s) |
| target | walk + game (one interactable) · desktop · single file ≤ 5 MB · frame ≤ 8 ms (M-series walk) |

Decisions made without asking: a fence closes the yard (no gate; the slope beyond is scenery); the hut's door
stands open; the porch lantern and the lamp over the table are lit from the start, only the stove waits;
footsteps on snow use the gravel sound; the snowfall's clock is game time (still views freeze it).

## Route

spawn (4, 11) → porch (1.3, 1.5) → doorway (1.3, −0.5) → inside (1.3, −1.6) → past the table (−1.2, −2.0) →
the stove (−1.5, −3.9): `plan.paths.route`.

## Modules

Build order: ground, hut, pines. Lead owns `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js`,
`game.js`, `scenarios/playtest.json`. Built sequentially by one agent (the parallel-build skill's "sequential"
mode); the module boundaries are the same as if three workers had built them.

### ground
- **Owns**: `plan.ground`, `plan.fence`, `plan.snow`; the terrain everywhere outside the hut footprint.
- **Builds**: a 1400 m heightfield (0.5 m cells inside ±40 m, then growing 10 % a cell): level yard, drifts ≤ 0.25 m
  away from the hut, the slope rising north at 0.34 m/m, ridges to ~320 m from 260 m out; the split-rail fence
  (posts every 2.5 m, two rails, snow caps); 7000 falling flakes in a 36 m box that follows the camera.
- **Offers**: `ctx.modules.ground.heightAt(x, z)`, `snow` (the flakes' clock uniform). No anchors.
- **Collision**: the terrain is solid; the fence carries 2 m × 0.4 m proxies (rails are thin).

### hut
- **Owns**: `plan.hut`, `plan.woodpile`, `plan.points.door / stove / lantern / lamp`.
- **Builds**: stone footing, one plank floor slab running out as a 0.9 m porch, one step; log walls with crossing
  corners, three windows (lit panes, cross mullions, snowy sills), gables, plank roof under 0.22 m of snow, snow roll
  on the ridge; the open door; table, bench, bunk; the stove on a hearth with its pipe through the roof; woodpile.
- **Offers anchors**: `stoves` — the stove's fire-door centre, rotY 0 (faces +Z), 1. Ambient volume: the room.
- **Budget**: ≤ 20 k triangles.

### pines
- **Reads**: `plan.pines`, `plan.ground.yard`, `ctx.modules.ground.heightAt`.
- **Builds**: 6 spruces in the yard and 220 on the slope (22–240 m), one drooping-tier lathe instanced, snow on
  upward faces, a noise wobble; trunks instanced (solid), needles not.

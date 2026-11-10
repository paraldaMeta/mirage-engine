# Diagnostics

Every Mirage tool reports problems in one shape, so an agent reads one list and acts on it:

```json
{ "code": "MG304", "severity": "error", "target": "step 2 \"north-wall-blocks\"",
  "message": "expected z ~ -6.52 0.15, got -7.55: the walker went past the expected stop; there is no geometry where it crossed [0, 0, -6.87]: a gap between walls/wall-n-a (ends at x -1) and walls/wall-n-b (starts at x 1)",
  "fix": "Close the gap from x -1 to 1 in modules/walls.js (the segments should meet), or move the expectation if the opening is meant.",
  "at": [0, 0, -6.87] }
```

| field | meaning |
|---|---|
| `code` | stable; never renumbered. The table below. |
| `severity` | `error` (fails the run), `warning` (wrong but runs), `info` |
| `target` | what it is about: a plan field (`viewpoints[1].look`), a module (`crate`), an object (`walls/wall-n-a`: module / mesh name), a scenario step, a file and line |
| `message` | what is wrong, with the measured numbers |
| `fix` | one concrete action: a field and a value to try, a file to edit, a position to use. Measured where it can be (the free spot next to a spawn inside a crate, the centre to look at, the proxy box to add). |
| `at` | optional `[x, y, z]` (or `[x, z]`) in world metres |

Where they appear:

- `mirage-playtest` (packages/tools/src/playtest.mjs): `report.json` `diagnostics` (all earlier fields are kept), a
  **Diagnostics** table at the top of `report.md`, and the non-info ones on the terminal. Each failing step row lists
  its codes in `row.diagnostics`.
- `mirage-check <dist | page.html | url> [--json]` (packages/tools/src/check-world.mjs): the world check, no scenario
  needed. Loads the world once and lists everything below that needs no walking. Exit 1 on any error.
- `mirage-snap --baseline dir` (MG460) and `--determinism` (MG461): in `snap.json` `diagnostics` and on the terminal.
- `mirage-validate-plan <plan> [--json]`: the plan rules (MG1xx) without a browser. The text output still starts with
  definePlan's message.

Order: errors first, then warnings, then info; within each, load-time findings (the plan, the modules, the spawn)
come before the step failures they cause, and a step failure caused by a load-time finding carries that finding's fix
("caused by MG310: viewpoints[2].eye is inside a solid"). Read from the top; fix the first error first.

The code table lives in `packages/tools/src/diagnostics.mjs` (`CODES`); `packages/tools/diagnostics.check.mjs` fails
when this page and the table disagree.

## Codes

### MG1xx: the site plan

| code | severity | problem | fix |
|---|---|---|---|
| MG100 | error | plan could not be loaded | fix the syntax / import; `export default` a plain object (or JSON) |
| MG101 | error | required field missing | add the field named in `target` (name, bounds; a view needs eye and look) |
| MG102 | error | wrong type | the type the message names |
| MG103 | error | number out of range or not finite | a finite number above the minimum (radii, widths > 0) |
| MG104 | error | wrong number of coordinates | `[x, z]`, `[x, y, z]`, rect `[x0, z0, x1, z1]` |
| MG105 | error | value not allowed | one of the listed values (mode: walk, fly, game, orbit) |
| MG106 | error | shape needs exactly one of rect, circle, poly | give exactly one |
| MG107 | error | rectangle corners out of order | x1 > x0 and z1 > z0 |
| MG108 | error | walk height range empty | `walk.yMax` above `walk.yMin` |
| MG109 | error | empty string | a non-empty string |
| MG110 | error | spawn outside `plan.bounds` | the spawn inside the bounds (the message gives a point), or grow the bounds |
| MG111 | error | a view looks at its own eye | a look point different from the eye |
| MG112 | warning | spawn feet outside `walk.yMin..yMax` | widen `plan.walk` or move the eye to floor + 1.62 |

### MG2xx: modules and anchors (the world build report)

| code | severity | problem | fix |
|---|---|---|---|
| MG201 | error | a module threw in `build` and was skipped | the fix names the file and line from the stack, and a hint from the error text |
| MG202 | error | a module threw in `finalize` | fix finalize; check every anchor it reads exists |
| MG203 | error | required anchors missing (`consumes.required`) | a module that offers them, or move the key to `consumes.optional` |
| MG204 | error | module definition invalid (no name / build, duplicate name, bad anchors, consumes, ambientVolumes) | the documented shape |
| MG205 | info | module built no triangles | add meshes to `ctx.root`, if it should be visible |
| MG206 | warning | a `wall()` opening reaches the top of its wall: an opening's `height` is where its arch springs and `arch` defaults to `'round'` (+ width / 2), so a 2.1 m door 1.2 m wide tops out at 2.7 m (console warning from `@mirage/core/geom`, listed by the playtest) | `arch: 'flat'`, or the lower `height` that keeps the arch under the wall top (the message has the numbers) |

Module failures fail a playtest through the console errors they log (allowed with the scenario's `"errors": N`).

### MG3xx: walking and collision

| code | severity | problem | fix |
|---|---|---|---|
| MG301 | error | `walkTo` stuck | measured at the stuck point: an opening narrower than 0.62 m (and the plan field that sets it, e.g. `plan.yard.gate`), a step above 0.4 m, head room under 1.8 m, or the object in the way: an invisible collision proxy that does not line up with the meshes it stands in for (the box to make it), or a solid too tall for a step (move it, or raise its bottom to 1.9 m if it belongs overhead) |
| MG302 | error | `walkTo` timed out while still moving | `"run": true` or a longer `timeout` |
| MG303 | error | the walker fell below the expected height | a closed floor inside `plan.walk` |
| MG304 | error | walked through a barrier (moved past the expected stop) | names what it crossed and why the walk grid ignores it (`userData.collide = false`, transparent, thinner than a cell, an open plane) with the `ctx.collider` box to add (when the module already has a proxy that misses: that proxy, corrected, not a second one); or, when nothing is there, the gap: which two objects end where |
| MG305 | error | stopped short of the expected point | what blocks, as MG301 |
| MG306 | error | ended higher than expected | it climbed onto something of <= 0.4 m |
| MG307 | error | not on the ground | the eye 1.62 m above a solid floor |
| MG310 | error | the spawn's or a viewpoint's eye or body is inside a solid | the nearest free spot as the new eye, and the solid's name |
| MG311 | error | no floor under a walking view | an eye over a floor inside the plan, or mode `fly` |
| MG312 | warning | spawn more than 0.5 m above its floor (drops on load) | eye height = floor + 1.62 |
| MG320 | warning | an object floats above the floor under it (0.25 m or more; gaps thinner than the walk grid keeps are measured with a ray) | lower it by the measured gap in its module file, or `userData.float = true` |

### MG4xx: what the frame shows

| code | severity | problem | fix |
|---|---|---|---|
| MG401 | error | `see`: out of frame | the look point to use: the object's centre |
| MG402 | error | `see`: hidden | what is in front, and a clear eye position from which the object is the first thing hit |
| MG403 | error | `see`: too small | an eye position close enough for the expected share |
| MG404 | error | `see`: nothing has that name | name the mesh, or one of the names in the scene (a failed module has none: fix MG201 first) |
| MG410 | warning | a viewpoint shows only sky or void | aim it at the world |
| MG411 | warning | a viewpoint is blocked: one surface fills > 90 % of it, less than 1 m from the eye | move the eye back |
| MG412 | warning | a viewpoint misses its subject (its `see: [...]` list, or the object it is named after) | the look point: the subject's centre |
| MG440 | warning | black frame (98 % of pixels near black, or mean luma < 4); error when a `luma` / `dark` expectation fails | from the light state: `plan.render.post.exposure`, the sun below the horizon (`plan.render.time`), or a camera inside a mesh |
| MG441 | warning | overexposed frame (35 % near white) | exposure, emissive |
| MG442 | warning | interior nearly black: the step's eye is inside a module's `ambientVolumes` box and the screenshot's mean luma is under 40 of 255 (measured: an unlit 6 x 5 m room with a door at midday and `factor: 0.35` reads 25 - 33, the same room with a lamp 55 - 76, snow-hut's stove view 75) | a lamp or emissive surface inside, a higher `factor` (0.5 - 0.7), or a window to the sun |
| MG450 | warning | coplanar upward surfaces (z-fighting) | raise the upper one 1 cm (the value to use) |
| MG451 | error | flicker over the expectation | the worst frame's diff image and position |
| MG452 | info | a flicker spike: one frame > 4 x the mean and > 15 | look at the worst frame |
| MG460 | error | a still differs from its baseline: region SSIM (8 x 8 windows, 4 x 4 cells) under mean 0.92, 5th percentile 0.85 or worst cell 0.75 (`mirage-snap --baseline`, playtest `baseline`) | the view, the worst cell (pixels and SSIM) and the diff image with it boxed |
| MG461 | error | a still is not reproducible: the same view drew different pixels after another view, or after a reload (`mirage-snap --determinism`) | how many pixels differ and by how much; where to look for the state that leaks |

### MG5xx: performance budgets (`plan.budget`)

| code | severity | problem | fix |
|---|---|---|---|
| MG501 | error | frame time over budget (warning without an expectation); the time is the median of the perf step's runs (3 by default) and the message lists the runs and their spread | when the runs differ by more than 25 %: measure again on a quiet machine. Triangles or calls are blamed only when they are over `plan.budget`; otherwise the fix says the time is not a cause and lists what costs time without triangles |
| MG502 | error | p95 frame time over budget | spikes: compile at load, no per-frame allocation |
| MG503 | error | draw calls over budget | merge per material, instance |
| MG504 | error | triangles over budget; a warning at load from the build report (module triangles vs `plan.budget.triangles`) | the heaviest module and the share of its triangles to cut |

### MG6xx: console and runtime

| code | severity | problem | fix |
|---|---|---|---|
| MG601 | error | console error (a warning when the scenario allows it) | the file and line, when the text has one |
| MG602 | error | uncaught exception in the page | the file and line from the stack |
| MG603 | error | the page never became ready (`window.__READY`) | what the page logged before it failed |
| MG604 | error | a scenario step threw | the step's message |

### MG7xx: game state (@mirage/game)

| code | severity | problem | fix |
|---|---|---|---|
| MG701 | error | an expectation failed (anything not covered above) | compare value and expectation |
| MG702 | error | no interaction prompt (`near` / `prompt`) | walk within reach, `lookAt` the entity |
| MG703 | error | a game flag not set | the interaction ran, the handler sets it |
| MG704 | error | an inventory item missing | the pick-up ran |
| MG705 | error | `lookAt` an entity that does not exist | an id the game defines |
| MG710 | error | prompt / HUD text over the scene below WCAG AA contrast (4.5:1, large text 3:1), measured behind the glyphs (playtest step `"contrast"`) | the text, its colour, the backdrop measured, the ratio needed |

## The checks beyond expectations

These run at load in every playtest (scenario `"checks": false` turns them off) and in `mirage-check`. They are
deliberately conservative: each is tested to fire on broken cases (`packages/tools/diagnostics.check.mjs`) and to stay quiet on all
seven examples (`node packages/tools/world-checks.check.mjs`).

- **Eyes in solids (MG310 / MG311 / MG312)**: the spawn and every plan viewpoint against the walk grid
  (`play.grid`). A walking view (mode walk / game, or a view less than 3 m above its floor, as `play.viewpoint` picks)
  needs the body to fit: feet = eye - 1.62 on a floor within a 0.4 m step, 1.8 m of head room. A free camera (fly /
  orbit) only needs the eye in air, and may hang over void or outside the bounds. The fix is the nearest spot (within
  4 m) where it fits.
- **Floating objects (MG320)**: every solid mesh (the walk grid's rule: visible, layer 0, opaque, collide not false)
  inside the plan whose sampled columns (up to 8 x 8 under its box) all have a gap of at least 0.25 m between its
  bottom and the floor below it (`play.grid.groundAt`). Not reported: anything touching another solid from the side
  (a balcony on a wall, a roof on walls), anything with a solid less than 1.5 m above it (a hanging lamp), and
  `userData.float = true`. Gaps below the walk grid's resolution (~0.3 m) are not seen.
- **Coplanar surfaces (MG450)**: flat-ish solids (< 0.3 m tall, > 0.25 m^2: slabs, tiles, rugs, decals) whose top, at
  five ray samples, lies within 3 mm of another solid's upward face. Materials with `polygonOffset` are skipped.
- **What each viewpoint shows (MG410 / MG411 / MG412)**: one ID pass per view (320 px, a flat colour per mesh).
- **Budget at load (MG504)**: module triangles from the build report against `plan.budget.triangles`.

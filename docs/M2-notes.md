# M2 notes — the world protocol, play, tools

M2 adds `packages/world`, `packages/play` and `packages/tools` (packager, walk tests, snapshots, perf, deploy),
converts `examples/hello-courtyard` to the protocol and adds `examples/walled-garden`. One small core change:
ambient volumes. Code implementing Golden Temple techniques was written fresh; no Golden Temple file was opened for
M2. The author's own earlier code (walk mode, embedding, packager, walk test, walk-grid bake) informed or was
adapted as listed below; nothing place-specific from that project is in the repo.

## What

- **`@mirage/world`** — `definePlan()` (site plan: metres, the core's axes, bounds, walk range, regions,
  footprints, paths, points, viewpoints; every problem listed at once), `buildWorld(world, { plan, modules,
  shared })`: builds in order into one group per module, `anchors` merged with `from`, `finalize` after every
  build, ambient volumes to the core, `ctx.R` seeded per module (`plan.seed/name`), `ctx.collider()` proxies.
  A module that throws in build / anchors / finalize is logged and dropped with its group and its updates.
  Convention for agents and humans: `docs/world-protocol.md`; notes template: `packages/world/NOTES.template.md`.
- **`@mirage/play`** — walk (WASD, mouse look with pointer lock or drag, Shift run, Space jump), fly (F), an
  orthographic isometric game view following a figure (G, wheel zoom), orbit (O, the stills view), viewpoints 1–9,
  R spawn. Moving frames: the core's TAA; when the view stops: the core's still path at spp 6, after ~0.75 s at
  spp 16, then no rendering until something moves. Shadows follow the view, snapped to shadow texels.
  `mountWorld()` embeds a world in a host program (shared renderer, host objects in `root`, host walkers on the
  grid, any host camera, optional render target).
- **The walk grid** (`bakeWalkGrid`): baked in the page from the real layer-0 geometry, top-down only. The height
  range is cut into 0.1 m slabs; one orthographic render per slab with an override material (DoubleSide,
  single pass): additive front-face and back-face counts, min-blended depth of the first crossing. Down each
  0.125 m column the winding number is non-zero inside solids — overlapping boxes, open-bottomed walls and
  inverted meshes come out solid with no side views (the earlier project's bake needed 11 680 side slabs and a
  flood fill to find the insides of solids). Floors are where it turns non-zero (exact height from the depth),
  ceilings where it turns back; up to 4 per column. The walker (cylinder r 0.28 m, head 1.8 m, step 0.4 m, jump
  4.2 m/s) steps, falls, jumps and slides on it; pure JS, tested in node.
- **Core**: `world.setAmbientVolumes([{ min, max, factor, soft }])` (≤ 8 boxes) scales the image-based light
  inside interiors. The code is compiled in only while a world has volumes (materials recompile when that
  changes), so worlds without them compile exactly the M1b shaders.
- **Tools** (`packages/tools/src`): `package.mjs` (single HTML file), `walktest.mjs` (JSON scenarios →
  screenshots + pass / fail), `snap.mjs` (every viewpoint as a still + contact sheet), `perf.mjs` (frame cost per
  mode), `deploy.mjs` (a static folder + instructions; uploads nothing), `chrome.mjs` (launch + static server).
- **hello-courtyard** on the protocol: `plan.js` + four modules (ground, walls, vegetation, props); the walls offer
  `lamps` anchors, props hangs the lanterns in finalize; `?mode=walk|fly|game|orbit` (orbit default = M1b's
  stills), `?broken=1`, `embed.html` (a host program mounting it).
- **walled-garden** (new, 72 × 72 m inside the walls, 80 × 94 m walkable): three terraces (0 / 1.6 / 3.2 m),
  retaining walls with parapets, two flights of 9 steps, a gate (3 m round arch), a pavilion on a plinth with an
  interior (door, windows, ceiling, bench, two hanging lanterns, an ambient volume), paved axis and cross paths,
  a basin, two pools, ten hedged lawns, six trees, cypresses. Six modules (terraces, walls, paths, pavilion,
  vegetation, props); anchors `lamps` (walls, pavilion), `posts` and `urns` (terraces), `seats` and `urns`
  (paths), all consumed by props; `NOTES.md` follows the convention.

## Sources

| subsystem | status | file(s) | earlier-project file consulted |
|---|---|---|---|
| site plan, module interface, anchors, NOTES convention | new code; conventions adapted from own project | `world/src/plan.js`, `loader.js`, `docs/world-protocol.md`, `NOTES.template.md` | `docs/NOTES.md` (anchor protocol, facing convention, per-module sections) |
| failure isolation, per-module rng, ambient volumes hand-off | new | `world/src/loader.js` | — |
| walk grid bake | approach adapted from own project (top-down rasterisation of layer-0 geometry, step, clearance); method new (winding slabs, min-blended depth, no side slabs, no flood fill) | `play/src/walkgrid.js` | `tools/bakewalk.mjs`, `bakewalk-page.js`, `lib/bakewalk-core.mjs` |
| walker | new code; feel adapted (speeds, jump, eased eye) | `play/src/walker.js` | `src/walk.js` |
| modes, keys, game camera angle, figure, loop | adapted from own project, rewritten around the core's renderFrame | `play/src/play.js` | `src/walk.js` |
| embed API | shape adapted from own project | `play/src/embed.js` | `src/embed.js` |
| single-file packager | adapted from own project | `tools/src/package.mjs` | `tools/package.mjs` |
| walk test runner | adapted from own project (JSON steps, held keys), expectations new | `tools/src/walktest.mjs` | `tools/walktest.mjs` |
| snapshots + contact sheet | new (the sheet is composed in the page's 2D canvas) | `tools/src/snap.mjs` | — (Golden Temple's `snap`/`sheet` not opened) |
| frame cost | new; idea from own project's sweep (uncapped synchronous frames) | `tools/src/perf.mjs` | `tools/gamesweep.mjs` |
| deploy folder | new | `tools/src/deploy.mjs` | — |
| Chrome launch, static server | new | `tools/src/chrome.mjs` | — (Golden Temple's `lib/chrome.mjs` not used) |
| ambient volumes | new (core) | `core/src/env.js`, `materials.js`, `world.js` | — |

`tools/flickerwalk.mjs` was not ported (see open problems).

## Numbers (Apple M4 Pro, ANGLE Metal, Chrome headless, 1440 × 900)

- **Node tests** (`npm test`): core, world (plan errors, order, anchors, failure isolation, per-module rng) and
  play (walker on a hand-made grid: gate passes, wall blocks, slide, stairs up / down, 0.6 m box blocks, jump onto
  it, stand under an arch): all ok.
- **Walk tests**, both served over http and as single files opened from file://, no console errors: courtyard
  12 / 12 steps pass (gate passes to z 9.8, wall stops at x 6.875, the west arcade passes, basin rim and the
  0.45 m bench block, jump onto the bench lands at 0.45 m, jump apex 0.86–0.92 m, run, game view, fly); garden
  16 / 16 (gate passes, perimeter wall stops at z 35.375, retaining wall at z 8.5, one flight to 1.65 m, both
  flights to the top terrace 3.25 m, descend to 0.05 m, parapet stops at z 7.5, hedge at 18.125, pool kerb at
  −3.0, plinth at x 5.0, jump onto the 0.45 m plinth lands at 3.65 m, into the pavilion to z −23.75 at 3.67 m,
  the game view climbs a flight, fly). Real-time loop during held keys: 54–60 fps (vsync-capped headless).
- **Walk grid bake**: courtyard 192 × 232 cells × 81 slabs in 52–65 ms; garden 640 × 752 × 111 in 267–283 ms;
  0 columns with more than 4 floors.
- **Frame cost** (synchronous, 1-px readback each frame, mean / p95 of 120): courtyard walk 3.3 / 3.5 ms, game
  3.5 / 4.0, fly 3.7; still path spp 6 15.1 ms, spp 16 37.8 ms. Garden walk 3.6 / 3.9 ms, game 3.7 / 4.0, fly
  4.2; spp 6 18.7 ms, spp 16 48.2 ms; 60 draw calls, 0.41 M triangles a frame (scene + shadow map). The
  single-file builds measure the same within 0.2 ms.
- **Still-frame identity**: the M1b example rendered with the M2 core is bit-identical to M1b (noon, night:
  0 differing pixels). M1b's `verify.mjs` on the converted courtyard: same `frameIndex` max difference 0 in all
  five views; walk, game and orbit views of both examples likewise 0. The converted courtyard is the same scene
  but not the same pixels as M1b: jars and palm fronds now draw from their own modules' seeds (mean |Δ| 3.3 / 255
  at noon, 2.5 at night; mean luma 122.8 → 122.2). Orbit with TAA: flicker 4.83 (M1b 4.62), meanAbsDiff 3.32
  (3.14) on the re-seeded scene.
- **Failure isolation**: `?broken=1` inserts a module that adds a 3 m red box, registers an update that would
  throw, then throws: in both examples it is reported (`failed: broken (build)`), the box is not in the scene, the
  update never runs, every other module builds, all anchors arrive; one console error (the loader's report).
- **Embed** (`embed.html`): a host renderer + host camera + host objects (a knot, a ball walking on the grid);
  the host camera's projection is unchanged after renders; no console errors.
- **Sizes**: single files 2.13 MB (courtyard) and 2.14 MB (garden): 1.30 MB inlined textures (base64 of 1.0 MB
  WebP), 0.83 / 0.84 MB code. Vite builds: garden JS 882 kB (239 kB gzip), `dist/` 1.9 MB each. Build in the page:
  courtyard 37–47 ms, garden 89–100 ms; load to ready 0.5–1 s (warm), 5–6 s for a first load in a fresh profile
  (shader compilation).

## Lines

| part | lines |
|---|---|
| `packages/world/src` (3 files) + `check.mjs` | 180 + 32 |
| `packages/play/src` (5 files) + `check.mjs` | 557 + 35 (play 275, walkgrid 156, walker 74, embed 47) |
| `packages/tools/src` (6 files) | 358 (walktest 86, snap 73, package 60, perf 54, deploy 44, chrome 41) |
| `packages/core/src` | 2624 (M1b 2583: ambient volumes +41) |
| `examples/hello-courtyard` (main, embed, plan, 7 module files) | 355 |
| `examples/walled-garden` (main, plan, 9 module files) | 519 |

## Open problems / not done

- **Walk grid**: one bake at load, no streaming or tiles (fine to ~100 m; a town needs tiles or an offline bake
  file); doors that move need a re-bake; open meshes need hand-made proxies (forgetting one silently makes a hole —
  e.g. a lathe column without caps); columns are sampled at cell centres, so features thinner than 0.125 m
  (railings, thin posts) can be missed; floors above `walk.yMax` are not found.
- **Walker**: axis-separated sliding can stall against diagonal walls; no crouch, no ladders or slopes steeper
  than the step rule, no moving platforms; the eye eases over steps but there is no camera bob.
- **Game view**: no occluder fading / x-ray (the figure disappears behind the garden's walls); the figure is a
  placeholder (robe, head, arms) with a bob, no animation; no click-to-move.
- **Progressive refinement**: the still frame pops in sharper than the TAA frames (M1b's open problem, unchanged);
  the clock and wind are frozen (T = 0) unless `animate`, so leaves and water do not move while walking.
- **Interiors**: one environment probe for the whole world plus ambient volumes; no local probes or irradiance
  volume, so the pavilion's interior light is a single factor, not bounced light.
- **Tools**: `flickerwalk` (flicker measured along a walk) was not ported; walk tests use wall-clock key holds,
  so distances vary by a few centimetres between runs (expectations use tolerances); `deploy` does not minify
  textures or split them out of the single file.
- **Garden look**: tree crowns are clumps of noisy spheres (no leaf cards); lawns are a shader, not grass; the lower
  terrace's ground texture reads as dry earth rather than gravel. Tuned at the golden hour only.
- **Protocol**: no schema file for plans (validation is code); modules cannot declare which anchor keys they
  consume (finalize just reads `ctx.anchors`); no parallel build of modules (they build in sequence in one page).

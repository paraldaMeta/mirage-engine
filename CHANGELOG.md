# Changelog

All notable changes. From 1.0.0 on, versions follow semver for the stable API in `docs/api.md`.

## 1.0.0 — unreleased (not tagged, not published)

The first version with an API promise: the names marked *stable* in `docs/api.md` change only in a major release.
It is `main` since 0.2.0, plus Codex's development chain (`codex/mirage-gpu-ci`, built on a machine without a GPU
and first verified here), plus the 1.0 review (`docs/review-1.0.md`). Package names on npm are not settled yet, so
nothing is published. Evidence: `docs/STATUS-1.0.md`.

**New**

- @mirage/tools, checking a world against itself (all opt-in; plain `snap` / `playtest` output unchanged, bit-identical
  before / after on hello-courtyard and walled-garden, sheets included):
  - **Regression baselines**: `mirage-snap --baseline dir` and a scenario's `"baseline"` compare each still with a
    saved one by region SSIM in plain JS (`src/imgcmp.mjs`: 8 × 8 windows, 4 × 4 cells; fails under mean 0.92, 5th
    percentile 0.85 or worst cell 0.75, `--ssim` to change), on the deterministic still path (grain 0, frameIndex 1).
    A miss is the new **MG460** with the worst cell, its view and `baseline | now` with the cell boxed. The same build
    scores 1.0; `?nodetail` (the wall relief off) is caught on the pergola view (5th percentile 0.83).
  - **Determinism**: `mirage-snap --determinism` draws every view again after another view and after a reload and
    requires bit-identical pixels (**MG461**); `npm run test:determinism` runs it over the seven examples: all pass.
    It found and this fixes: snow-hut's snow and garden-quest's key ran on their own clocks through view jumps (now
    `createPlay({ onPlace })`, which `startGame` turns into a game `'place'` event and a fresh simulation step);
    garden-quest's crate pile settled while the first views were drawn (new `physics.settle()`, called at setup) and
    its ball sat on the "axis" viewpoint, where standing kicked it away (moved 1.8 m). Chrome draws the first page it
    loads ≤ 1 level apart from later loads in < 0.1 % of pixels (through the SSAO pass; not the HTTP cache, storage,
    the program cache, the quality pick, MSAA or a warm-up context): the check loads the page once first.
  - **Variant grids**: `mirage-snap --variants "time=dusk;post.bloom=0.2;quality=low"`: one labelled grid per view,
    up to 16 variants, 4 columns.
  - **Phone review**: `--phone` on snap and playtest: 375 × 812, sheets one phone wide per tile.
  - **Text contrast**: a playtest step's `"contrast": true` measures every visible prompt / HUD line against the
    pixels behind its glyphs (WCAG AA 4.5:1, large 3:1; **MG710**). garden-quest passes: prompt 15.5:1, the lowest
    line is the power-saver button at 5.3:1 (phone) / 5.5:1 (desktop).
  - **Route maps**: every `walkTo` writes `NN-<step>-route.png` after the walk (its timing unchanged): the walk grid
    from above, planned route, path taken, stuck point; `"onion": true` adds the game entities that moved.
  - **Adaptive stills**: `renderFrame(T, { spp, converge })` (and `play.render`, `mirage-snap --adaptive`) compares
    the estimate every spp / 4 sub-frames and stops once the mean change is ≤ 0.25 display levels. spp 16, the sum
    of medians over 5 interleaved pairs per view: snow-hut 191 vs 324 ms (−41 %, stops at 8), walled-garden 304 vs
    320 ms (−5 %), hello-courtyard 225 vs 208 ms (+8 %: never converges, pays two probes). Against the full still the
    mean difference is ≤ 0.25 levels (< 1/255), the largest single pixel 25 levels (walled-garden) and 144 (snow-hut's
    flakes sit at other shutter times). Off by default: exact.
  - **Chrome**: capture flags beyond puppeteer's defaults (which already force sRGB and keep background pages
    running; a unit check keeps them) and a lease pool, `lease()` / `MIRAGE_POOL=1`: one Chrome per tool run, a
    browser context per lease; open + ready + one still, median 611 → 317 ms per page on woodland-path.
  - **Skill drift**: `agent/check.mjs` fails a skill that names an MG code, a tool flag or a scenario field the tools
    do not have (the vocabulary is `src/scenario-fields.mjs`; playtest lists unknown fields it was given).
- Skills: mirage-playtest gains a review pass (a stranger's sentence per view, `where · problem → fix` notes ranked
  P0 / P1 / P2, a fresh-eyes sub-agent given only BRIEF.md and the sheet, REVIEW.md at delivery);
  mirage-brief-to-plan turns adjectives into numbers and keeps a BANNED-defaults line in the brief.
- @mirage/tools: one diagnostic shape everywhere, `{ code, severity, target, message, fix, at? }`, with stable codes
  (MG1xx plan, MG2xx modules, MG3xx walking, MG4xx frame, MG5xx budgets, MG6xx console, MG7xx game state;
  `docs/diagnostics.md`). The playtest writes them to `report.json` `diagnostics` and the top of `report.md`;
  `mirage-validate-plan --json` and the new `mirage-check` (a world check without a scenario) print the same.
  Every fix is measured where it can be: the gap between two wall segments, the plan field behind a too-narrow
  gate, the collider box to add, the free spot next to a spawn inside a crate, the look point for an object out of
  frame. New load-time checks: the spawn and viewpoints inside solids, floating objects, coplanar surfaces, what each
  viewpoint shows, the triangle budget. Quiet on all seven examples.
- @mirage/tools: playtest `see` — a step can require named objects to be in the final view
  (`"see": { "rail": ">= 0.005" }`). An ID pass measures each object's share of the frame and, on a failure, says
  whether it is out of frame, hidden (and by which objects) or too small. Screenshots also report `luma`, `dark`
  and `clipped`, and a black or clipped frame is listed as a warning. Prompted by A1 run A, whose rail test passed
  while the rail was out of view.
- WebXR (`docs/xr.md`, experimental): `createXR(play, { game })` in @mirage/play adds Enter VR / Enter AR buttons to
  any world (all seven examples opt in). In the headset the desktop walker or a game's physics character walks
  (left stick, head-relative; room-scale steps go through it too, walls push the view back), with snap or smooth
  turning, a teleport arc onto walkable ground of the walk grid, a comfort vignette, the trigger as a game's E and its
  prompts and messages as text in the world. The frame is one stereo draw (`world.renderDirect`) graded by a
  CustomToneMapping with the desktop's exposure, white balance, tone map, saturation, contrast and lift and a
  measured stand-in for the bloom; MSAA, fixed foveation, framebuffer scale by quality. AR sets the world on the
  hit-tested floor or a table as a model. `mirage-xr-check` (Meta's iwer emulating a Quest 3 in headless Chrome)
  enters both, drives the controllers, replays the XR frames through the desktop path to the same end position and
  saves both eyes; `xr-fit.mjs` fits the bloom stand-in. Small hooks: `createWorldRenderer({ xr })` (a multisampled,
  XR-compatible context), `world.renderDirect(T, { camera, shadow, fog })`, `play.xrInput`. Not yet tried on a real
  headset.
- @mirage/tools: `rapierWasm()` Vite plugin (`src/vite-rapier.mjs`): Rapier's wasm ships as its own file instead
  of base64 inside the bundle, and Rapier's init compiles it while it downloads. garden-quest: 814 -> 594 KB gzip;
  over a 10 Mbps link (uncompressed test server) ready 4.3-4.7 -> 3.9-4.0 s. It also removes Rapier's init
  deprecation warning. The three game examples use it; single-file pages keep the wasm inline.
- @mirage/core: the sky's air (Sun and Moon scattering, airglow, the ground below the horizon) is baked per
  `setTime` into two 512x256 direction tables (`createSkyLut`) instead of being marched 16 steps per pixel. Sky cost
  at 2880x1800: 1.5-2 ms -> 0.25-0.4 ms (whole frame 11.5 -> 10.0 ms walled-garden, 12.5 -> 10.6 ms garden-quest).
  Stills at dawn, noon, sunset and night differ from before by at most 2/255.
- @mirage/core: faster cold start. `world.prepare()` now compiles every program the first frames use in parallel:
  against the pipeline's linear target (three keys programs on the output colour space, so the old screen-target
  compile was thrown away), with and without the environment map, plus the post passes
  (`pipeline.compileAsync()`). Before, ~40-70 programs compiled one after another on the first frame. Measured cold
  (shader cache defeated): woodland-path 3.8 → 1.8 s to ready, garden-quest 11 → 5.8 s; stills are unchanged.
- @mirage/core: optional `light2` (`createWorldRenderer({ light2: true })`): shadows for the 4 most important lamps
  (PointLights or `addLampSource` tables) through one octahedral depth atlas, half-resolution screen-space
  reflections on smooth surfaces, volumetric light (key light through its shadow map, lamps through the atlas),
  bloom mixed instead of added. Off by default; frames without it are bit-identical. hello-courtyard: `?light2=1`.
- @mirage/core: optional `post.aoLit` (SSAO fades on lit pixels: occlusion belongs to ambient light),
  `post.autoExposure` (centre-weighted metering on the GPU, eased in log space while moving, still frames metered
  on their own) and `dynamicRes` (moving frames render smaller when over budget; stills stay full size). All off by
  default; frames without them are bit-identical. hello-courtyard: `?aolit=1`, `?ae=1`, `?dynres=1`.
- @mirage/core: optional contact-hardening soft sun shadows (`createWorldRenderer({ softShadows: true })`,
  `softshadow.js`): a per-pixel blocker search and PCF over the sun's own shadow map (PCSS), so walking (TAA) frames
  get the penumbrae still frames had from the sun-disc jitter, and both look alike. +0.55–0.85 ms at 1440 x 900.
  Off by default; frames without it are bit-identical. hello-courtyard: `?soft=1` (`&sunAngle=` degrees).
- @mirage/core: optional close-range relief (`relief.js`): one parallax step and the relief's own shadow on the
  photo sets (`tex.material(name, { relief, render })`, `tex.hooks(names, h, { relief: true })`,
  `mgTex{Tri,Wall,Ground}Relief`), a hand-applied render's undulation and trowel swipes (`PROC.plaster(base,
  { render })`), `setRelief(level)`; geometry `geom.wall({ round })`, `softExtrude`, `softBox`, `sootPlumes`. Opt-in:
  worlds that do not ask for it compile the same shaders. hello-courtyard uses it (`?nodetail` for A/B).
- @mirage/core: optional wet surfaces (`wet.js`): `withWet(hooks, options)` gives any Standard / Physical material
  one ramp dry → damp → soaked → standing water (world-space puddles, run-off streaks on walls, a damp band at the
  ground, `porosity`), rain rings on standing water; `setWetness`, `setRain` (page-global). Only standing water is
  flagged for light2's reflections. Off by default; the wet code compiles only while the wetness is above 0, so
  `setWetness(0)` frames are bit-identical. `patch()` hooks gain `specAA` and `attach`. @mirage/world: rain kit
  (`@mirage/world/kits/rain`, `addRain`): camera-following streaks, one draw call. hello-courtyard: `?wet=0.8&rain=1`.
- Live examples on Cloudflare Pages (https://mirage-engine-4qj.pages.dev/): `npm run site` builds the seven examples
  as single files plus an index page (`scripts/build-site.mjs`); the owner deploys it with wrangler (see that file).
  Not rebuilt automatically: redeploy after changes to `main`.
- Export to GLB and USDZ: `mirage-export <dist> --out world.glb [--usdz world.usdz] [--verify dir]`
  (@mirage/tools) and `exportWorld(world, opts)` (`@mirage/core/export`, page side). Procedural patch() surfaces are
  baked into atlas textures (box-projection charts, 2x supersampled, base colour + roughness/metalness + normal);
  instancing survives in the GLB (`EXT_mesh_gpu_instancing`). Sky, stars, wind, translucency, lamp gain, ambient
  volumes, fog and post do not travel. Checked on woodland-path, hello-courtyard and garden-quest: the re-imported
  GLB covers the same pixels as the live world from every viewpoint, 0 gltf-validator errors (`docs/export.md`).
- @mirage/game: trigger zones — `game.zone({ id, box | sphere, enter, exit, once })`, `'zone'` events, kept in saves.
- @mirage/game: physics and the character run on one fixed 60 Hz clock, the camera interpolates (`simulation.js`;
  `npm run test:fixed-step`).
- @mirage/play: touch screens walk, run and look in plain play; a game's touch stick runs past its rim.
- @mirage/play: a rigged procedural traveller replaces the game-view placeholder (`createCharacter`).
- @mirage/world: `plan.schema.json` and `mirage-validate-plan` with field-level messages; modules declare the
  anchors they need (`consumes: { required, optional }`); kits for vegetation, terrain and water
  (`@mirage/world/kits/*`); examples `woodland-path` and `river-ford`.
- TypeScript declarations next to every source file, checked by compiling packed NodeNext and Bundler consumers
  (`npm run test:types`).
- One lifecycle: `play.dispose()`, `await session.dispose()` with `ctx.onDispose(fn)` in `setup`, and `dispose()`
  on input, ui, audio, physics, game (`docs/LIFECYCLE.md`).
- A serial acceptance runner for a test machine (`npm run acceptance`) and a GPU CI workflow that runs it on a
  self-hosted runner (`docs/ACCEPTANCE.md`, `docs/GPU-CI.md`).
- `docs/api.md` (every export with its stability) and `npm run test:pack` (what each package would publish);
  CI (`.github/workflows/ci.yml`) runs the node checks, the package check and every example's build on Ubuntu and
  macOS.

**Changes in behaviour**

- Version 1.0.0 for every package and example. Peer ranges: `three >=0.186.1 <0.187.0`, `@mirage/*` `^1.0.0`
  (were exact versions). Each package ships its LICENSE and has repository, homepage and bugs fields. The `"./*"`
  subpath export stays until a whitelist is decided (`docs/api.md`).
- @mirage/game: the key or button that leaves the start screen only starts the game; it no longer also does its own
  action (P / Esc used to open the menu at once; a held A already did not jump).
- @mirage/game: an imported save of another game (a different `id`) or with a broken version is refused.
- @mirage/world: a module whose `anchors` or `ambientVolumes` fail half-way offers none of them; a module whose
  `finalize` throws is taken out of the scene and its `onUpdate` callbacks stop; a second module with a name already
  used is skipped (all reported in `report.failed`). Missing required anchors skip only the module's `finalize`.
- @mirage/core: `world.dispose()` also frees materials and the shadow map; `mountWorld` leaves the host's `root` to
  the host and cleans up a mount that fails.
- @mirage/play: the walk grid bake refuses bounds larger than the GPU's texture size (it used to return an empty
  grid); a throw during the bake leaves the scene as it was.
- @mirage/tools: `mirage-deploy` and `mirage-package` reject unknown options and a second folder, and `mirage-deploy`
  refuses to empty an output folder that is or contains the current folder, the example, the home folder or a
  filesystem root, or a non-empty folder that is not an earlier deploy. The tools find Chrome on macOS, Linux and
  Windows (`$CHROME` still wins).
- @mirage/core: a malformed `time` or `place` throws a `TypeError` naming the field (it lit the world with NaN, a
  black frame); ISO date strings are instants; a partial `place` keeps the other defaults.
- @mirage/play: keys typed into the host page's fields (text inputs, selects, contenteditable, inside shadow DOM
  too) no longer move the player; `onQuality(quality)` and startGame's `onRestart` let an embedding page replace the
  default page reload; `dispose()` gives the world camera its lens and pose back; leaving fly or orbit over no
  ground at all goes back to the spawn; orbit releases pointer lock.
- @mirage/game: saves no longer carry or restore settings (bindings and volumes belong to the player; loading an
  older save undid a rebinding); a malformed save changes nothing; `session.load('auto')` reads the named slot;
  without `localStorage` (node, sandboxed iframes) saves are kept in memory; `reset()` brings removed entities back.
- @mirage/world: one broken module (a `null` entry, a mesh without positions, a malformed ambient volume) fails
  alone instead of rejecting `buildWorld`; a dropped module takes its ambient volumes along and frees its GPU
  objects; `ctx.rng(0)` is its own stream; fields set to `undefined` in a plan take the defaults.
- @mirage/tools: `mirage-deploy` only empties a folder carrying its own `.mirage-deploy` marker (a Pages folder with
  `.nojekyll` and `.git` passed before); `mirage-package` inlines a linked stylesheet and fails on any other file it
  cannot inline; `mirage-e2e` runs the `examples/` of the current folder or `--root`.

**Fixes**

- @mirage/game: text from saves and settings (inventory names, key bindings, slot summaries) is escaped in the
  overlay — an imported save file could run script in the page; `addStatic` skips meshes with nothing to collide
  with (empty geometry, an InstancedMesh with no instances) and warns about a BatchedMesh instead of throwing, which
  failed `startGame`; the character's collision filter no longer calls back into Rapier, which left the collider set
  borrowed so that freeing the physics world threw (game check failed on the Codex chain); the character no longer
  hovers beside a step's lip after a short last step (autostep lifted it without carrying it onto the step; a save
  made there loaded 14.5 cm lower), and `place()` stands it on a step beside it instead of inside it; the controls
  panel names arrow keys (`Left`, not ` L`).
- @mirage/play: a solid mesh under a plain `Object3D` (as glTF loads them) or a `LOD` blocks the walker; the bake
  used to leave it out. `createPlay` keeps the type of a walker passed in (the packed type check failed).
- Tools: the acceptance GPU preflight reads Chrome 156's `webgl` feature status (it has no `webgl2` entry).
- The `mirage-brief-to-plan` scaffold asks for the repository's `@mirage` version (it asked for 0.1.0, a 404 in a new
  world); `npm test` checks that it stays so.
- 1.0 code review (2026-11-09), each fix with a check that fails on the old code:
  - core: `geom.taperedTube` side walls faced inward (every triangle; the courtyard palm and the garden trunks);
    `archPath` segmental arches with a rise above half the span; `wind.dir: [0, 0]` made every swaying mesh vanish
    (NaN); refraction no longer jumps 0.76° at −2°; LOD errors are world metres on scaled meshes; texture set names
    with `-` or `.` compile in GLSL (`glslName`).
  - game: a turned prop's collider is its own box (a 45° plank got a 1.77 m square); a pending key rebind ends with
    the menu (the next key in play was swallowed and bound); touch buttons release on `pointercancel`; `place()` drops
    a deferred step-up.
  - play: the walk-grid bake keeps the lowest floors when a column has more than eight (the ground was dropped); fly
    speed is normalised on diagonals; fly → game lands where the camera is; viewpoint names are escaped.
  - world: the report's triangle counts are each module's own and leave out collision proxies; `along()` keeps a
    unit direction on repeated points.
  - tools: the test server answers a malformed URL with 400 (it crashed) and stays inside its folder; playtest step
    names are safe in file names.
- woodland-path: a wood beyond the meadow fades into haze; the horizon was a hard grey band (the edge of the ground).

## 0.2.0 — 2026-10-27 (pre-alpha)

Lighter on the GPU, steadier to play, tested in more browsers. Not published.

**Changes in behaviour**

- **Default quality is `medium`** (was `high`), and `low` is picked automatically on battery, phones, iPads and weak
  GPUs. Pass `quality: 'high'` (or `?quality=high`) for the 0.1.0 image.
- **A corner shows the quality level and the frame rate**, with a power saver (30 fps). `?hud=0` (or `hud: false`)
  hides it.
- **Nothing is drawn when nothing moves**: scene animation (snow, a fire) stops drawing after 10 s without input
  (`idle`), frames are capped at 60 (30 in the power saver), hidden tabs draw nothing and games suspend their audio.
- **Wind, water and clouds move while you walk** and stand still with the view; jumping to a viewpoint sets the
  scene clock back to 0, so fixed views look as they did (`play.clock`; `animate: true` is unchanged).
- **Stopping fades into the still frame** over 10 frames instead of popping sharp; the last frame of the fade is
  the still frame itself.

**Fixes**

- @mirage/game: a door closing on a pinned player stops instead of passing through it; a button held on the start
  screen no longer also jumps; a failed save is shown in the menu instead of thrown; the character climbs steps at
  120 fps and above (it stopped at snow-hut's door step in Firefox).
- @mirage/play: the walk-grid walker slides along diagonal walls instead of stalling; the canvas follows the window
  and a still view is redrawn after a resize; a negative first-frame time step is clamped.
- Demos: the day-night demo's image keeps up with its clock and starts at `?from=`.

**Tools and tests**

- `npm run test:e2e` runs every example end to end; `npm run test:gpu-load` checks the frames drawn (still, hidden,
  walking, power saver, the corner on a phone); `npm run test:still-pop` measures the change per frame after
  stopping and the scene clock.
- Safari (WebKit) and Firefox through Playwright: `MIRAGE_BROWSER=webkit|firefox` with `MIRAGE_PLAYWRIGHT`.
- Console warnings are listed in reports and no longer count as errors; headless Chrome runs with a null audio
  sink.
- Regression tests: small risers and high frame rates (game check), `packages/tools/check.mjs` and
  `bake-check.mjs` (need Chrome).
- Docs: solids thinner than a walk-grid cell (railings) need a `ctx.collider` proxy at least 0.2 m thick.

## 0.1.0 — 2026-10-27 (pre-alpha)

First complete cut; not published.

- **@mirage/core**: physical sky and aerial perspective in every material, sun / moon key light with fitted soft
  shadows, image-based light captured from the built world, sub-frame accumulation (AA, soft shadows, SSAO, depth of
  field), temporal AA for moving views, day / night for any place and time with a running clock, the `patch()`
  material hooks and GLSL noise library, an optional CC0 texture layer, ambient volumes for interiors, LOD, device
  tiers, seeded randomness. All Mirage original code; techniques learnt from Golden Temple (MIT, see NOTICE).
- **@mirage/world**: the world protocol — site plan validation, modules with anchors, finalize and ambient volumes,
  build order, failure isolation, per-module randomness, a build report.
- **@mirage/play**: walk / fly / game view / orbit, a walk grid baked from the geometry, progressive refinement, an
  embed API.
- **@mirage/game**: Rapier physics and character controller, doors, input (keys, gamepad, touch), procedural
  audio, entities, interactables, inventory, versioned saves, HTML overlay.
- **@mirage/tools**: playtest runner, single-file packager, snapshots and contact sheets, frame cost, static deploy
  folder (no upload).
- **agent/**: seven Agent Skills (router, brief-to-plan, module, parallel-build, playtest, game, ship), install
  guide, validator.
- **Examples**: hello-courtyard, walled-garden, garden-quest, agent-trial (built by three agents in parallel),
  snow-hut; demos day-night and assemble.

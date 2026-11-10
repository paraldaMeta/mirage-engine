# Changelog

All notable changes. From 1.0.0 on, versions follow semver for the stable API in `docs/api.md`.

## 1.0.0 — unreleased (not tagged, not published)

The first version with an API promise: the names marked *stable* in `docs/api.md` change only in a major release.
It is `main` since 0.2.0, plus Codex's development chain (`codex/mirage-gpu-ci`, built on a machine without a GPU
and first verified here), plus the 1.0 review (`docs/review-1.0.md`). Package names on npm are not settled yet, so
nothing is published. Evidence: `docs/STATUS-1.0.md`.

**New**

- @mirage/play: NPC navigation on the walk grid (`createNavGrid`, `createNavAgent`, `createNavCrowd`; experimental,
  opt-in). No navmesh: per-radius fit bits from the walker's own disc / step / head-room test (equal to the walker
  on every floor of the node checks' grids and on 20 000 of 20 000 random floors of walled-garden), coarse A* (4 x 4
  cell blocks split into connected pieces) then cell A* in that corridor (octile, one binary heap, typed arrays
  reused across queries), string pulling along a height-following cell walk, flow fields (one Dijkstra per goal),
  dynamic obstacles (`block` box / cylinder, `unblock`: only the region around it is redone), agents that are
  walkers of their own radius (dog 0.2, cart 0.5) and crowd separation. walled-garden (481 280 cells, 495 314 floors):
  create + fit bake 84 ms (the GPU walk-grid bake is 280-340 ms); gate to pavilion interior, 71.5 m up both stairs,
  1.5-1.6 ms per query, an agent walks it in 47 s and arrives; a whole-garden flow field 40 ms; shutting the
  pavilion door 0.8-1.1 ms. Node, 160 x 160 cells with pillars and walls: 0.28 ms per query (plain cell A* 0.74 ms);
  80 x 80 m: 1.5 ms (10 ms). 7.5 KB gzip with the walker (recast-navigation-js: ~211 KB gzip by the figure in the brief,
  not measured here). walled-garden `?npc=N` shows N travellers (the bundle +7.4 KB gzip; stills unchanged, and
  examples that do not use it build byte-identical). `node packages/tools/nav-check.mjs` checks it in Chrome.
- @mirage/play `createXR` for native WebXR hosts and hands (`docs/xr.md`, experimental). Where
  `navigator.xr.offerSession` exists the session is offered (`offer`, default on; `autoEnter` to start at once), so a
  host without a DOM (Srile/webxr-to-native on Quest: no layout, no `Intl`, a Canvas 2D whose `fillText` draws
  nothing) starts VR with no button. Labels draw with a built-in 5 x 9 glyph font into a DataTexture where Canvas 2D
  draws no text (`text: 'auto' | 'canvas' | 'glyphs'`; `packages/play/src/glyphs.js`, drawn for Mirage). Hand
  tracking (`hands`, default on, inert without tracked hands): pinch is the trigger, point then pinch teleports
  along the index finger's ray (`xr-hands.js`, thresholds measured on iwer's captured poses). The XR frame's own
  garbage: createXR's code 1988-2085 -> 163-195 bytes per frame (heap sample over 300 frames after a 10 s warm-up,
  hello-courtyard and garden-quest, two interleaved runs each); the whole frame is still 76-108 KB per frame
  (three.js, the walker, the emulator) and the GC count did not change measurably (14-31 minor per 300 frames,
  before and after). `mirage-xr-check --native` (no layout, no text in Canvas 2D, offerSession, glyph labels with a
  pixel check in the eye image, iwer's emulated hands), `--native-control` (the negative control) and `--alloc`.
  Desktop stills unchanged (mirage-snap: hello-courtyard 6/6, garden-quest 9/9 views pixel-identical). No multiview
  (three 0.186's WebGLRenderer has none): a known limit.
- @mirage/world: shell fur, short grass and moss (`@mirage/world/kits/fur`, `addFur`, opt-in): a patch (a rect on
  the ground or any mesh) drawn `shells` times in one instanced draw call, `gl_InstanceID` lifting each shell along the
  normal; strands from a jittered 3D lattice (no projection seams), tapering, shaded root to tip with round-strand
  normals, wind from `mgWind`, alpha-tested with depth writes (no sorting), a patched Standard material (shadows
  received, fog, TAA, extra hooks); far strands merge into a solid shell instead of shimmering; optional cast shadows
  and grazing-view fins. On walled-garden's lower east lawn (321 m², `?lawn=tufts | fur | fur-fins`, 1440x900 TAA,
  shared GPU): tufts at 30 per m² +144,435 triangles, +1 draw, +0.3–0.7 ms; fur +32 triangles, +1 draw, ~+0.1 ms
  (within the noise); fins +2,236 triangles, +2 draws. From walking height the fur reads as an even felt where the
  tufts keep blades (world README, "Fur").
- @mirage/core: metal PROCs `PROC.brushed` (streaks and hairlines stretched along an axis, in the roughness and the
  normal: highlights smear across the brushing), `PROC.hammered` (dimples from a 3D cell noise, polished ridges) and
  `PROC.patina` (verdigris on copper / bronze: rough, not metallic, on top faces and in run-off streaks). Stills on
  spheres and panels from `node packages/tools/looks.check.mjs`. Cost not measured.
- Reduced motion (opt-in in core, automatic in play): `world.setReducedMotion(true | { sway, rain })` scales the
  wind's strength while a frame renders (x 0.25), slows the rain kit (x 0.4: 8.5 -> 3.4 m/s) and closes the still
  path's shutter (no motion blur); @mirage/play's `reducedMotion` option (`'auto'` default: follows
  `prefers-reduced-motion` live; `true` / `false` / `{ sway, rain }` override; `play.reducedMotion`) also eases the
  eye over steps and jumps. No shader changes: off, the stills are bit-identical (hello-courtyard, walled-garden,
  woodland-path, river-ford: 23 views, 0 px). A fur lawn in a 1.5 x wind changes 3.9 -> 1.5 /255 per channel between T 0 and 1.7 s.
- Transparent stills (opt-in): `world.renderTransparent(T, opts)` renders the still over black and over white (sky hidden)
  and recovers straight alpha from the two linear HDR sums (the grade's `CLEAR` variant, after illos.dev);
  `mirage-snap --alpha` writes every viewpoint as an RGBA PNG (`src/png.mjs`, exact), `play.render({ transparent:
  true })`. On a test object: background alpha 0, partial alpha only within 2 px of an edge, opaque pixels within
  0.01/255 of the still over black, edges within 0.7 % in linear light; the object's own bloom kept. Cost: about two
  stills plus a read-back.
- @mirage/tools: `looks.check.mjs`, a browser check of the four (serves `check/looks.html` from the repository root,
  no build).
- @mirage/world: Gaussian splats, `@mirage/world/kits/splat` (opt-in, experimental; world README "Gaussian splats").
  Loaders for `.splat`, uncompressed 3DGS `.ply` (SH0) and SOG v1-3 (meta.json + webp); one instanced draw with one
  ShaderMaterial in the world's light and aerial perspective; a counting sort on view depth (histogram-spread
  buckets, still cameras skipped, nothing behind the eye) in a Blob worker with a transferable index buffer, so
  single-file pages work without SharedArrayBuffer / COOP-COEP; culls tiny and off-screen splats before the eigen
  decomposition; AA opacity compensation; effect hooks (centre, rotation / scale, colour) with `reveal` and
  `dissolve`; an optional depth pass for SSAO / TAA. 9.1 KB min + gzip (three external) vs Spark 2.4's 979 KB and
  GaussianSplats3D 0.4.7's 106 KB. Measured (Apple M4 Pro, headless Chrome, 1280x720, TAA, GPU shared with other
  jobs): 1M splats 30 ms a moving frame (p10-p90 21-51; the world alone 2.5 ms; + depth pass 53 ms), worker sort
  10.4 ms mean (max 20), first main-thread sort 16 ms; 1M sort in Node 9 ms. `examples/demos/splats`: a procedural
  hill, rock and tree (`hill.js`, any count), `make-fixtures.mjs` (saves it as .splat, .ply and SOG with a small
  own lossless-webp encoder), `splat-check.mjs` (loaders, `see`, worker sort vs a CPU reference, GPU order, effects,
  1M timing, kit size). No example uses it; their builds are unchanged.
- Seamless loading (all opt-in; with every option off the stills of hello-courtyard and walled-garden are
  byte-identical to before and the walk grids hash the same on three examples). Measured by
  `node examples/demos/streaming/streaming-check.mjs` (headless Chrome, Apple M4 Pro via ANGLE/Metal, a cold browser
  per page, A/B interleaved, medians of 3; other agents shared the GPU, spread in brackets where it mattered):
  - `createTextures({ decode: 'bitmap' })`: images decoded off the main thread (`createImageBitmap`), same pixels
    (still diff 0). hello-courtyard's five sets: `prepare()` 231 -> 162 ms, main-thread long tasks to ready
    298 -> 239 ms in total, the longest 143 -> 90 ms.
  - `createUploadBudget(renderer, { bytes })`: texture uploads spread over frames (`renderer.initTexture`). Six new
    1024 px textures: one 30 ms frame (29-32) -> six frames of at most 5.7 ms (5.7-5.9) at 8 MB a frame.
  - `world.prepare({ warm: true })`: one discarded still frame + a 1-px readback after the compiles, the canvas
    cleared and the TAA / exposure / dynamic-resolution histories put back. First visible frame (CPU + GPU, to a
    1-px readback): courtyard 11.1 -> 4.7 ms (CPU 10.0 -> 2.1), garden 12.7 -> 6.4 ms (CPU 11.1 -> 2.2); it costs
    13-14 ms inside `prepare()`. Stills identical.
  - @mirage/world `buildWorld(..., { slice: true | { budgetMs, yield } })`: yields to the frame between modules
    after a time budget (8 ms), `report.slices` with the longest unyielded stretch, modules over 50 ms and the long
    tasks (PerformanceObserver). walled-garden's six modules built into a side scene while the page draws: the
    longest frame interval 50 ms (50-67) -> 16.8 ms (no frame missed), the build 73 -> 70 ms.
  - @mirage/play `bakeWalkGridAsync(world, opts)`: the walk grid over frames, slabs read through pixel-pack buffers
    polled with fences (no stall), 4 ms of main thread a frame, tiles; `{ region, into }` (sync or async) re-bakes a
    region of an earlier grid in place. Floors and count arrays bit-identical to the sync bake on hello-courtyard and
    walled-garden, whole, in tiles of 128 cells, and for a region re-bake into a scribbled copy. Courtyard: sync
    45 ms blocking -> async 183 ms over 11 frames, longest slice 2.6 ms; garden (481k cells) sync 289 ms blocking -> async 807 ms over 48 frames, longest slice
    5.9 ms. Small tiles cost draws (each tile draws the whole scene once per slab): garden in 30 tiles of 128 cells
    7.0 s, so the default tile is 1024. The bake's override material is now kept for the page (its program stays
    linked; a re-bake while walking compiled it again, ~35 ms).
  - @mirage/world `createStreamer(world, { plan, modules, ... })`: modules streamed in and out by distance: a
    priority queue (nearest first), build in a task of its own, `compileAsync` against the world's scene and the
    pipeline's target, uploads through the budget, then one add; out of range they stay in an LRU byte budget (walking
    back is instant), evictions free what nothing else samples; `onChange` hands the region to a walk-grid re-bake.
    Core pieces exported on their own: `createJobQueue`, `createLRU`, `textureBytes`, `objectBytes`, `texturesOf`,
    `disposeObject`, `watchLongTasks`, `nextFrame`. Walking out of hello-courtyard's gate to a kiosk (8 new programs,
    two 1024 px textures; `examples/demos/streaming/kiosk.js`, shaders salted new to the driver each run) and back,
    twice, 9 runs a mode: loaded in the frame it comes in range, every run missed 4-5 frames, the longest frame
    58-750 ms (a cold compile of the 8 programs up to 750 ms); streamed (build 21-33 ms in its own task, compile
    28-29 ms off-frame, uploads over frames, shown ~5 frames later), 6 of 9 runs missed no frame (longest interval
    16.8 ms, longest callback 13-20 ms); the other 3 ran slow from start to end (mean 8.9-12.9 ms against 3.8-5.3,
    while other agents loaded the GPU) with intervals up to 50-83 ms. The p95 (MG502) does not see a one-frame hitch
    in 800 frames: 6.8-10.5 ms loaded at once, 7.6-10 ms streamed (clean runs).
  - KTX2 / Basis: manifest files ending in `.ktx2` load through `createKTX2Loader` from the subpath
    `@mirage/core/ktx2` (three's KTX2Loader, imported dynamically; transcoder from `three/examples/jsm/libs/basis`).
    hello-courtyard's sets as ETC1S (`basisu -ktx2 -mipmap -y_flip`, the check makes them when basisu is installed;
    transcoded to ETC2 here): GPU memory 55.9 -> 7.0 MB, `prepare()` 233 -> 131 ms (no decode), textures ready
    2 -> 67 ms (transcoding in workers), files 1.02 MB WebP -> 1.45 MB, still vs WebP mean difference 0.94 / 255. No example bundle contains KTX2Loader or the transcoder (a first try that exported it from the
    index made Vite emit a 60 KB chunk in every example: fixed by keeping it a subpath).
  - Bundle cost of the opt-in code that rides along when unused: +1.3 to +1.8 KB gzip per example (+0.5 %), e.g.
    hello-courtyard 280,130 -> 281,920 B, river-ford 266,908 -> 268,286 B.
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
  - **Route maps**: every `walkTo` writes `NN-<step>-route.png`: the walk grid from above, planned route, path
    taken, stuck point, and an onion skin of game entities that moved.
  - **Adaptive stills**: `renderFrame(T, { spp, converge })` (and `play.render`, `mirage-snap --adaptive`) compares
    the estimate every spp / 4 sub-frames and stops once the mean change is ≤ 0.25 display levels. spp 16, the sum
    of medians over 5 interleaved pairs per view: snow-hut 191 vs 324 ms (−41 %, stops at 8), walled-garden 304 vs
    320 ms (−5 %), hello-courtyard 225 vs 208 ms (+8 %: never converges, pays two probes). Against the full still the
    mean difference is ≤ 0.25 levels (< 1/255), the largest single pixel 25 levels (walled-garden) and 144 (snow-hut's
    flakes sit at other shutter times). Off by default: exact.
  - **Chrome**: capture flags beyond puppeteer's defaults (which already force sRGB and keep background pages
    running; a unit check keeps them) and a lease pool, `lease()` / `MIRAGE_POOL=1`: one Chrome per tool run;
    open + ready + one still, median 597 → 244 ms per page on woodland-path.
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

# Changelog

All notable changes. From 1.0.0 on, versions follow semver for the stable API in `docs/api.md`.

## 1.0.0 — unreleased (not tagged, not published)

The first version with an API promise: the names marked *stable* in `docs/api.md` change only in a major release.
It is `main` since 0.2.0, plus Codex's development chain (`codex/mirage-gpu-ci`, built on a machine without a GPU
and first verified here), plus the 1.0 review (`docs/review-1.0.md`). Package names on npm are not settled yet, so
nothing is published. Evidence: `docs/STATUS-1.0.md`.

**New**
- @mirage/core: screen-space lighting in the lit materials (`lighting: { screen: true }` + `post.ssr2`, `post.ssgi`,
  `post.contact`; experimental, opt-in, `docs/lighting.md`): reflections with roughness, short-range indirect light
  with colour, contact shadows of the sun; temporal history and edge-aware blur on moving frames, a reference mode
  for stills (flows into `--png16` / `--exr`). hello-courtyard `?wet=0.8&ssr=1&ssgi=1&contact=1`: 3.30 -> 4.40 ms at
  1440 x 900, 11.9 -> 15.8 ms at 2880 x 1800; a moving frame is 36.9 dB from the 64-sample reference instead of 29.9.
  `lights: { perCell: 0 }`: clustered lists without the per-cell cap (100 lamps bit-identical to the plain loop).
  `csm: { stagger: true }`: far cascades redrawn less often on moving frames (2.13 of 4 per frame; walled-garden
  3.60 -> 3.30 ms). `post.rcas`: contrast-adaptive sharpening after the upscaler (+0.1 ms at 1440 x 900). Not done:
  time-sliced probe capture, single-tile spot shadows, wider velocity coverage, mip bias.

- Platforms (experimental, opt-in; `docs/platforms.md`). `mirage-ship <example> --target web | pwa | single |
  desktop-electron | desktop-tauri | ios | android` (@mirage/tools) writes a static folder with caching rules, a PWA
  (manifest, icons from one PNG, an own service worker with a versioned precache, install and update hooks) or a
  project scaffold for Electron, Tauri 2 or Capacitor 8 (CSP, high-performance GPU switch, fullscreen, window
  state, orientation and safe area, saves mapped to the app's folder through one `window.mirageNative` bridge). It
  installs, downloads and signs nothing, and none of the wrappers is a dependency of this repository. Run-time
  layer in two subpaths: `@mirage/core/platform` (`probeDevice` with mobile GPU tiers, `createContextRecovery`,
  `createQualityGovernor` on battery, CPU pressure and frame time) and `@mirage/game/platform` (`createPlatform`:
  pause on hidden, audio unlock, wake lock, fullscreen, orientation, safe-area insets, input mode, storage
  persistence; `createSaveStorage`; `registerServiceWorker`; `createInstallPrompt`). `world.contextRestored()`,
  `play.running`, `startGame({ storage })` and `createWorldRenderer({ byteTargets })` are the engine-side hooks;
  8-bit render targets switch on by themselves only on a context without float colour targets (black canvas
  before, mean 96/255 after, 97 with floats). Measured in headless Chrome on one Mac: garden-quest PWA (33 files,
  3.98 MB) reloads with the server down in 793 ms; a new version waits and applies on request with one reload;
  after a lost WebGL context hello-courtyard and garden-quest are back in 307-317 ms (300 ms held lost) with at
  most 1/255 difference, against every pixel different without the recovery; under phone emulation with a
  reduced GL at `low`, 6x CPU throttle: hello-courtyard 2.2 ms (2.0-2.5), garden-quest 7.9 ms (7.9-8.8) per frame
  (CPU side only; spread between runs about 2 ms). With the flags off, six stills on two examples are
  bit-identical to the base. **Not done:** no real phone was used; no Electron, Tauri or Capacitor toolchain is on
  this machine, so no wrapper was built or run (the Rust main has never been compiled) and the scaffolds are
  checked for structure only; consoles are out of reach. Try: `?platform=1` on hello-courtyard and garden-quest,
  `?bytetargets=1` on hello-courtyard; `npm run test:ship`, `test:context-loss`, `test:mobile`.
- @mirage/play: XR towards parity, all opt-in and **exercised only in an emulated session** (no headset; `docs/xr.md`).
  `createXR(play, { post })` draws each eye through the engine's post chain (HDR + MSAA, AO, bloom, auto exposure,
  tone map, grade, LUT; TAA, motion blur, depth of field, chromatic aberration, grain and the lens vignette stay
  off) and copies both eyes with depth into the layer: 35.1 dB PSNR per eye against the desktop frame of the same
  camera with the same passes (direct path 24.5 dB; 6 spp vs 1 spp noise floor 39.2 dB), 39 render passes and 105
  draw calls per stereo frame against 1 and 78, 4.12 ms against 2.06 ms median (walled-garden, 1024 x 1024 per eye,
  desktop GPU). `budget` adds a frame-time governor with dynamic resolution (resolution, AO, resolution, bloom,
  then the direct path; back up after calm), `profile` a device table (Quest 2 / 3, Vision Pro, PC VR: untested on
  hardware), `posture` height calibration, `bounds` the play-area fence. `createXRInteraction`: near and ray grab,
  throw (Rapier, or ballistic: landing within 1 cm of the prediction), two-handed turn and scale, snap zones, poke
  buttons, canvas UI panels by ray and fingertip, fist / pinch / point gestures, haptics. `arFeatures`: anchors,
  plane detection, light estimation onto the sun and a light probe, DOM overlay, a shadows-only ground. New tool
  `mirage-xr-stereo-check` with its own WebXR shim (41 checks); walled-garden flags `?xrpost`, `?xrbudget`,
  `?xrprofile`, `?xrposture`, `?xrbounds`, `?xrsmooth`, `?xrdemo`, `?xrar`. Without the options the desktop stills
  of hello-courtyard and walled-garden are byte-identical.
- @mirage/game: a physics kit on the existing Rapier world (`createPhysicsKit`, `createJoints`, `createForces`,
  `createVehicle`, `createRagdoll`, `createPhysicsDebug`, `PHYSICS_MATERIALS`, `RAGDOLL_HUMANOID`; experimental,
  opt-in, `docs/physics.md`). `createPhysics` is unchanged for games that do not call it (stills of garden-quest and
  snow-hut byte-identical before and after); it gained `phys.ext` hooks so `snapshot()` / `restore()` carry the
  kit. Rigid bodies with box, ball, capsule, cylinder, cone, hull, triangle-mesh and compound colliders; materials
  with combine rules (from 2 m rubber bounces to 1.33 m, stone to 0.24; at 6 m/s a box slides 11.0 m on ice, 2.6 on
  wood); 16 named layers with a collision matrix and query filters; CCD (a 300 m/s ball passes a 4 cm wall without
  it, stops with it); sensors with enter / exit; contact events with impulse (19.98 N s for 2 kg at 9.57 m/s); ray
  and shape casts, overlaps, closest point; a fixed step with interpolation and a state hash (restore + the same
  steps gives the same hash, Node and Chrome, one machine). Joints: fixed, ball, cone, hinge and slider with limits
  and motors, spring, rope, six-axis, breakable by an estimated force (a chain reads 196.2 / 147.15 / 98.1 /
  49.05 N). A ragdoll from a skinned rig (14 parts, 13 joints): animated to ragdoll and blended back, limp limbs,
  active ragdoll. A ray-cast wheel vehicle (defaults: 15.7 m/s after 3 s, 28.7 top, stops in 2.07 s). Buoyancy
  (a 600 kg/m3 cube floats at 1.921 of 1.9), explosions with occlusion, kinematic platforms that carry bodies and
  the character. Debug draw and stats. Step time in Node (`node packages/game/physics-bench.mjs`, 3 rounds, ms per
  1/60 s step while falling, median (low-high)): 500 boxes 0.75 (0.75-0.77), 2000 boxes 3.19 (3.18-3.28), 5000
  boxes 6.79 (6.74-7.22) and 22.30 (22.17-22.53) as a settling heap, 20 ragdolls 0.93 (0.91-1.07). Checks: 80 in
  `npm test` (`packages/game/physics.check.mjs`) and `node examples/demos/physics/physics-check.mjs`, 23 of 23 in
  headless Chrome. Not there: cloth, soft bodies, fracture, fluids, GPU or multi-threaded physics, break torque,
  cross-platform determinism.
- Engineering: hosted CI draws frames. A `software-gl` job runs Chrome on SwiftShader (`MIRAGE_GL=software`) and
  plays two examples, redraws two views of each bit-identically and compares five stills with committed baselines
  by region SSIM (`npm run test:software-gl`, `docs/ci.md`; locally on macOS: four parts in about 230 s; not yet
  run on a hosted runner). Timing is printed, not gated, under software GL. Every action in both workflows is
  pinned to a commit SHA and a check fails on an unpinned one or a write scope.
- Engineering: `npm test` also runs ESLint (flat config, correctness rules only, no formatting), an import check
  against the export maps (299 files, 105 entries), a declaration check (95 modules, 602 runtime exports all
  declared, `tsc` clean) and a docs check (every `docs/*.md` linked from `docs/README.md`, 251 relative links
  resolve). Nothing is installed at test time. Check scripts report every failed assertion with a count
  (`scripts/soft-assert.mjs`; 29 scripts moved, what they test unchanged).
- Diagnostics: MG206 (a wall opening that reaches the wall top: `height` is where the arch springs and `arch`
  defaults to `'round'`; `geom.openingProblem(opening, wallHeight)` returns the text, `geom.wall` warns once per
  case) and MG442 (the eye is inside an `ambientVolumes` box and the picture's mean luma is under 40 of 255:
  measured 25 to 33 in an unlit room with `factor: 0.35`, 55 to 76 with a lamp). MG102 for a list under
  `plan.points` now says the two real ways out. `docs/diagnostics.md`.
- Docs: `docs/making-a-world.md` (a first world by hand, built and playtested as written; pitfalls; escape hatches
  to plain three.js), `docs/README.md` (the index), `docs/STABILITY.md` (37 of 212 exports are stable; the
  promotion policy; the Node checks run 51.8 % of 24 487 source lines), `docs/ci.md`, `docs/releasing.md` (checklist, npm provenance:
  documented, not run), `SECURITY.md`. `npm run coverage` and `npm run stability` produce the numbers.

- @mirage/editor (new package, experimental, opt-in, `docs/editor.md`): a visual editor in the browser against a
  live world. `npx mirage-editor <project dir> [--write]` serves the project's own page with the editor added:
  fly/orbit viewport, click selection with an outline, move/rotate/scale gizmos (local/world, grid and surface
  snap), multi-select, duplicate, copy/paste, undo/redo for every edit; hierarchy, an inspector typed from
  `plan.schema.json`, asset browser, console with the `MG` diagnostics, play-in-editor, time/weather/post/light2
  fields, wall/path/region drawing, a material value editor, a timeline on `createTimeline`, an animator viewer.
  Twelve placed-object types (models, lights, probe and GI volumes, audio zones, VFX emitters, nav areas, triggers,
  spawn points...) saved as data in `plan.edits.json`, which a project applies with `editable(plan, edits)`. The
  server binds 127.0.0.1 only, checks Host and Origin, needs a per-run token for POSTs and writes one fixed file
  inside the project, only with `--write`. Wired into `examples/hello-courtyard` and `examples/walled-garden`: with
  the empty layer their `mirage-snap` stills are byte-identical to the base commit (6 and 9 views) and the first
  load grows by 16.8 kB and 25.1 kB of JavaScript before compression. The browser check
  (`node packages/editor/editor-check.mjs`: select, gizmo drag, undo, save, reload, compare) passes on both: 28 undo
  steps, undo-all still SSIM 0.9961-0.9997 / 0.9998, saved layer 5,360 / 5,393 bytes, equal plan hash after reload, reload
  still SSIM 0.9844 (a placed probe and GI volume only take effect on reload) / 0.9997, `?editor=0` page identical
  to the editor's (0 differing pixels); editor open 726-1,698 ms / 953-1,004 ms. No prefabs, visual scripting,
  material graph, profiler, build UI, collaboration, plugins or terrain drawing: the guide lists what is missing.
- @mirage/play: character control and AI navigation (experimental, opt-in; `docs/character.md`,
  `docs/navigation.md`; demo `examples/demos/charnav`). `createWalker`, `createPlay` and existing paths are
  unchanged: stills of `hello-courtyard` and `walled-garden` (2 views each, 960 x 540, 8 spp, grain 0) are
  bit-identical before and after. Character: `createSolids` (moving boxes, cylinders and spheres composed into the
  walk grid at query time: lifts, turntables, doors, crates; ladder and water volumes), `createMover` (coyote time,
  jump buffering, variable jump height, sprint, crouch with a ceiling check, slope slide, ladders, swimming,
  mantling, carried by platforms, blocked by and pushing solids; `mode` for the animator through `driveAnimator`;
  `save` / `restore`), `createFollowCamera` (spring arm 4.5 m in the open, 0.50 m with a wall behind; first person),
  `linkSolids` (one rule for the grid and Rapier: kinematic solids are the game's and copied to Rapier before its
  step, dynamic ones are Rapier's and copied back after it; grid and Rapier agree on 3999 of 4000 probes, pose gap
  0). Step cost in Node, median of 5 (min-max): walker 1.04 us (1.02-1.07), mover 1.33 us (1.33-1.36), mover over 20
  solids 3.08 us (3.05-3.10); 2000 inputs through `@mirage/net`'s `applyInput` give identical movers. Navigation:
  areas with costs (`setArea`, `setAreaCost`, per-query `costs`), off-mesh links with `canEnter` / `traverse`
  (`nav.link`), turned-box obstacles, `carveSolids` (a moved door leaf re-bakes in 0.077 ms (0.074-0.095), a crate in
  0.174 ms (0.163-0.179)), `createPathQueue` (budgeted queries), `smoothPath`, `createCrowd` (ORCA avoidance,
  different radii), `createBehaviorTree` with a blackboard, `createSenses` (sight cones the grid occludes, hearing),
  `patrol` / `chase` / `flee` / `investigate` / `follow` / `guard`, `createNavDebug`. `findPath` mean over 300
  pairs: 0.141 ms on 160 x 160 cells (p95 0.389), 0.740 ms on 512 x 512 (0.713-0.747; p95 1.678, worst 2.282).
  `crowd.update` in Node: 200 agents 0.085 ms, 1000: 0.909 ms, 2000: 2.682 ms a step. The demo page in headless
  Chrome at 1280 x 720 holds the display's 60 fps with 240, 500, 1000 and 2000 agents (capsules, not skinned
  figures; `crowd.update` 0.28 to 4.8 ms a step); deepest overlap between agents 3 to 16 mm over 10 s with 240 (two runs). Still a
  grid, not navmesh polygons; nothing streams; one thread.
- @mirage/game: an audio engine on top of the mixer (`createAudioEngine`, `createMixer`, `createMusic`,
  `createAudioDebug`, occluders and DSP helpers; experimental, opt-in, `docs/audio.md`). `createAudio` is unchanged
  and, given to the engine, keeps playing through the new buses (`audio.play('pickup')` peak 0.284 alone, 0.284 again
  after `engine.dispose()`). Sound files decoded into a reference-counted cache with preload groups, streams through
  a media element, both working from the single-file build opened from file:// (533 KB with two WAV fixtures
  inlined). A bus tree with effect chains (EQ, filters, compressor, limiter, delay, convolution reverb from
  code-made impulse responses, drive, pan), sends, snapshots with timed and weighted transitions, and ducking that
  runs in the audio graph (music 1.000 -> 0.250 under dialogue, half-way down in 50 ms, back in 325 ms). HRTF or
  equal-power panning, inverse / linear / exponential / custom-curve distance, cones, Doppler (1111.1 / 909.1 Hz from
  1000 Hz at 34.3 m/s), spread. Reverb zones (boxes / spheres, `plan.audio.zones`) blended by listener position;
  occlusion by rays on the walk grid, Rapier or the scene with a ray budget (shut: x0.299 at 200 Hz, -41.1 dB at
  4 kHz). A voice cap with priorities, stealing and virtual voices (12 loops, cap 4: output equal to the nearest
  four alone to 1.2e-7; a voice silent for 1.28 s resumes 0.00 samples off). Cues (variants, ranges, sequences,
  cooldowns; the same seed is sample-identical) and adaptive music (stems, cross-fades, bar / beat-quantised
  transitions: first changed sample 1 after the boundary). Checked with OfflineAudioContext in headless Chrome:
  `node examples/demos/audio/audio-check.mjs`, 26 of 26, plus Node checks in `npm test`. `update()` with 64 moving
  loops (32 sounding) and 9 rays: 0.070 ms median (0.053-0.075). In garden-quest it is a separate chunk
  (37.4 KB, 15.8 KB gzip) fetched only with the flag. Demo `examples/demos/audio`; garden-quest `?audio=engine` (pavilion reverb zone, an
  occluded wind chime, the overlay).
- Model import and an animation stack (experimental, opt-in; `docs/import.md`, `docs/animation.md`).
  `@mirage/core/assets` (a subpath) loads glTF / GLB through a reference-counted cache (`load`, `instantiate`,
  `instances`, `release`), starts the Draco, meshopt and KTX2 decoders only for files that name them, patches
  imported materials into the world's fog, shadows and light, and puts static models into the walk grid and Rapier
  by the engine's one rule (`collide: 'mesh' | 'box' | 'hull' | false`). `writeGLB` (core) writes skinned, animated
  GLB with an own meshopt vertex encoder, so the checks need no downloaded files. `@mirage/play` gains
  `createAnimator` (layered state machines, 1D / 2D blend spaces on one phase, masked and additive layers, root
  motion that drives the walker through `rootMotionInput`, clip events, fixed stepping, snapshot / restore),
  `solveTwoBone`, `solveLookAt`, `createFootIK` (feet on the walk grid's floors), `retargetClip` between humanoid
  skeletons, `createTimeline` (camera, transform, animation, audio, event tracks; `seek` is exact) and
  `createRigCharacter` behind the new `createPlay({ character })` option. Measured: the code-authored rig (20 bones,
  880 vertices, 9 clips) is 164 596 B as GLB, 137 932 B with meshopt, and imports in 8-10 ms in Chrome; one animator
  update in Node 1.5 µs (one clip), 2.3 µs (3-clip blend with root motion), 5.7 µs with foot IK and look-at; a
  1.5 m/s walk clip moves a walker 6.00 m in 4 s; across a 0.15 m kerb both ankles are 7 mm from their floor (143 mm
  with `?ik=0`); retarget to the built-in traveller: limb error 4.9e-4 rad (1.35 rad without rest matching). The
  single-file build inlines the decoders (3.48 MB of the demo's 4.58 MB) and both start from it; no Draco or KTX2
  file was decoded (three ships no encoder; nothing was downloaded). Without the option nothing changes: the three
  example bundles compared (hello-courtyard, garden-quest, walled-garden) grew 27 bytes each, and six stills of hello-courtyard and garden-quest are byte-identical. Demo:
  `examples/demos/anim` (`?player=procedural`, `?ik=0`, `?npc=0`, `?retarget=0`, `?timeline=1`); checks:
  `packages/core/assets.check.mjs`, `packages/play/anim.check.mjs`, `packages/play/rig.check.mjs` (Node, in
  `npm test`) and `node examples/demos/anim/anim-check.mjs` (Chrome, 17 checks).
- @mirage/core: an opt-in post chain (`postfx.js`; `PostFX`, `FX_DEFAULTS`, `postFromQuery`, `parseCube`, `makeLut`,
  `lutTexture`, `apertureRadius`, `halton`; experimental; guide: `docs/post.md`). `post.taa2`: a velocity buffer
  (camera, moved and skinned meshes) and a TAA that reprojects with it, clips history in YCoCg by variance and
  rejects disoccluded history; `post.upscale` 0.5..1: the same pass as a temporal upscaler; `post.motionBlur`,
  `post.bokeh` (thin-lens circle of confusion, half-resolution gather), `post.bloomPyramid` (down / up-sample
  pyramid), `post.lut` (3D LUT, `.cube` parser), `post.chroma`. The pipeline's targets are now allocated once:
  a lower render scale draws into a corner through the viewport, so dynamic resolution no longer reallocates.
  hello-courtyard and walled-garden read `?taa2=1&upscale=0.67&mb=0.5&bokeh=1&lens=0.03&focus=6&bloom2=1&lut=warm&chroma=0.6`.
  With everything off the stills of both examples are byte-identical to before (6 of 6). hello-courtyard,
  1280 x 720, PSNR to a 16-sample still under a pan: old TAA 37.7 dB, taa2 40.2, upscale 0.67 37.3, upscale 0.5
  34.7. ms per frame off → on at 2560 x 1440 (median of 5 interleaved blocks, spread ±0.5): taa2 7.3 → 7.8,
  upscale 0.67 7.5 → 5.4, upscale 0.5 7.4 → 4.2, motion blur 7.7 → 8.8, bokeh 7.8 → 10.1, bloom pyramid 7.9 → 7.9.
  Not built: a roughness-aware SSR, the chain in XR (`docs/post.md` says what xr.js would need).
- @mirage/tools: `mirage-snap --seq N [--fps --from --to --shutter --video [file] --encoder]`: a deterministic image
  sequence whose frames integrate motion blur and depth of field by accumulation, encoded with a local ffmpeg
  (H.264 .mp4) or, without one, Chrome's WebCodecs VP9 into .ivf; `--png16` and `--exr` (linear half float) for
  stills and frames. 12 frames of 640 x 360 at 8 samples: frames byte-identical across two runs.
- @mirage/net (new package, experimental, opt-in; nothing else imports it): multiplayer for walked worlds. An
  authoritative room (`createRoom`) runs the play walker on a serialised walk grid in Node with no GPU, or in one
  player's page (`hostRoom`, with migration when the host leaves); quantised delta snapshots against acknowledged
  baselines, interest by distance, reliable events and RPCs over unreliable packets, clock sync; client prediction
  and reconciliation (`createClient().walker` goes straight into `createPlay`); lag-compensated `hitscan`; a lobby
  with room codes, reconnect and late join; transports: seeded in-memory loopback, WebSocket (own 100-line server,
  no dependency), WebRTC data channels signalled through the lobby. Server-side validation of every message, input
  rate and size limits. `mirage-net` dev server (127.0.0.1 only) with a network simulator and `bake` for the grid;
  `createNetOverlay`; example `examples/net-courtyard` (names, shared lanterns, chat). Measured (bench, 3 runs):
  941 B/s down and 1213 up per player at 20 Hz with 4 players, 2772 down at 60 Hz; tick 0.16 ms mean with 16
  players, 1.7-1.8 ms with 64; p99 tick inside budget up to 128 players at 20 Hz and 64 at 60 Hz. Browser check, 3
  Chrome clients at 150 ms + 5 % loss each way: 0 prediction corrections, positions converge to 1.66 mm. Guide,
  limits and what a public server needs: `docs/multiplayer.md`.
- @mirage/game: an in-game UI toolkit (`docs/ui.md`; experimental, opt-in; `createUI` is unchanged and the default).
  `createUIKit` (`@mirage/game/ui-kit`): descriptions as plain data (`h`, `each`, `show`), signals bound one
  attribute at a time (no diffing), `stack` / `row` / `grid` / `anchor` / `safeArea`, em sizes that follow the screen
  and a text-scale setting, four token themes (dark, light, contrast, colour-blind-safe), reduced motion. Widgets
  (`ui-widgets`): button, toggle, slider, select, tabs, text input, progress, health / stamina bar, tooltip,
  virtualised list, drag-and-drop inventory grid, minimap frame, objective tracker, rebinding list, and modal stack,
  dialogue (typewriter by grapheme, choices), toasts and radial menu services. `createFocusNav`: spatial focus for
  keyboard and gamepad, focus trapped in modals, glyphs that follow the last device used and a rebind.
  `createI18n` with English, Traditional Chinese and Arabic tables: plurals, ordinals, numbers and dates through
  `Intl`, a runtime language switch, RTL, CJK line breaking. `createWorldUI`: labels, markers and health bars at 3D
  points with distance fade and ray occlusion, `transform` and `opacity` writes only. `createCanvasUI`: a subset of
  the widgets drawn into a texture for screens in the world and XR. `createKitUI` (`ui-menu`): the start screen and
  pause menu on the toolkit, through `startGame`'s `ui: (o) => createKitUI(o)`; snow-hut `?ui=kit`. Demo:
  `examples/demos/ui/`. Measured there in headless Chrome, 1280 x 720, median (min-max) of 5 interleaved rounds of
  180 frames: with the HUD idle 0.000 layouts a frame; with the camera orbiting (labels, minimap, a distance
  read-out) 0.111 layouts a frame (0.017 ms); UI work 0.139 (0.108-0.147) ms a frame, the frame callback 0.277
  (0.229-0.323) ms against 0.133 (0.112-0.182) with the HUD hidden and 0.141 (0.122-0.179) without the toolkit.
  Worst text contrast per theme 7.73 / 4.88 / 10.50 / 7.67; the colour-blind theme's good and bad colours stay
  74.0 dE apart under simulated dichromacy (the default theme's 10.3). Sources 2 428 lines, about 64 KB gzip in all
  as separate modules; a game that does not import them is unchanged: hello-courtyard, river-ford, walled-garden
  and woodland-path build byte-identical, garden-quest +12 B gzip (one expression in `startGame`), and snow-hut and
  garden-quest stills are pixel-identical with it off. `node packages/game/ui.check.mjs` (in `npm test`) and
  `node examples/demos/ui/ui-check.mjs` (keyboard, touch, scripted gamepad, languages, layout counts, the menu).
- @mirage/core: visual effects (`createVfx`, `VFX_LIBRARY`, `defineEffect`; experimental, opt-in, `docs/vfx.md`).
  GPU particles for WebGL2 described as JSON: state in float textures advanced by one fragment pass per fixed
  60 Hz step, instanced draw; shapes (point, sphere, box, cone, ring, edge, mesh surface), gravity, drag, wind,
  curl-noise turbulence, attractors, vector fields, curves and gradients over life; soft, lit (sun, shadow, sky,
  fog), stretched, mesh and flipbook particles, three blends, GPU distance sort; collision with the depth buffer,
  planes and the walk grid (bounce, kill, stick); sub-emitters on birth, death, collision; trails, beams and
  lightning, depth-projected decals; per-effect and global caps, distance LOD, culling, pooled one-shots. The
  state hash is the same on two loads and at 30 updates a second. Measured (M4 Pro, 1280 x 720, a yard that
  itself costs 1.9 ms): 1 000 000 unlit additive sprites cost 0.70 ms a step and 6.3 ms to draw, 9.7 ms a frame
  in all; 60 fps holds to about 1.7 million and 120 fps to about 830 000 at pixel ratio 1, 440 000 at 60 fps at
  pixel ratio 2; lit soft particles 690 000 / 350 000 at pixel ratio 1. Gallery: `examples/demos/vfx`. Two
  examples build to byte-identical bundles with and without this change.
- @mirage/core realtime lighting, four opt-in features under `createWorldRenderer({ lighting })` (`docs/lighting.md`,
  experimental; without the option the stills of hello-courtyard and walled-garden are byte-identical). `csm`: 2-4
  cascaded sun shadows in the sun's own map (bounding spheres of view slices, texel-snapped, blended, the
  contact-hardening filter per cascade with `softShadows`). `gi`: an irradiance probe volume baked on the GPU at load
  (irradiance + distance moments per probe, visibility-weighted against leaks), re-baked 2 probes a frame when the
  time of day moves. `probes`: up to 4 box-parallax reflection probes filtered by PMREM. `lights`: clustered local
  lights (16 x 9 x 24 cells, lights in a float texture, the count is data) with a cached octahedral shadow atlas;
  `world.lighting.addLight(light, { shadow })`. Shader parts go into the world's own materials through an
  instance-scoped injector, not into `THREE.ShaderChunk`. Measured on an Apple M4 Pro (shared GPU, A/B interleaved,
  median [spread of 6 rounds], 1440 x 900): 100 lamps cost 3.6 ms [3.4-3.9] a frame clustered against 3.8 [3.4-4.0]
  with no lamps, 6.1 [5.3-6.3] as a plain loop and 121.6 [112.2-122.1] as three's own PointLights (walled-garden);
  in hello-courtyard's small court 6.2 / 3.4 / 7.0 / 183.4. Cascades, the probe volume and one reflection probe are
  each inside the spread (not resolved). Probe volume bake 315-495 ms (196-400 probes); a reflection probe capture
  is a 10-17 ms frame; a shadow tile redraw +0.1 to +1.6 ms, none while nothing moves. 2880 x 1800 and the limits
  (one GI box, cascades all redrawn each frame, spots pay six faces, 4 probes) are in the guide. Flags on both
  examples: `?csm=1`, `?gi=1`, `?probes=1`, `?lights=N` (`&lshadows=K`, `&cluster=0`, `&stock=1`).
  `node packages/tools/src/lighting-check.mjs` checks it in Chrome.
- Big worlds (`docs/big-worlds.md`; all opt-in and experimental; with none of it called, hello-courtyard and
  walled-garden render as at the base commit: SSIM 1.000, worst cell 0 in 15 views). @mirage/core: `simplify.js`
  (own quadric-error simplifier with attribute quadrics, locked borders, a time budget: a 12 096-triangle sphere to
  1 208 in 66 ms in Node), `chunk.js` (`chunkGeometry`, `chunkObject`, `MeshBatch.finish({ chunk })`), `autolod.js`
  (`createAutoLod`: chains built in workers or slices, screen-size selection with hysteresis and a dithered
  cross-fade; `buildProxy` for HLOD), `instancing.js` (`createInstances`: per-cell then per-instance frustum culling,
  per-instance LOD), `impostor.js` (hemi-octahedral impostors lit by the live sun), `hiz.js` (`createOcclusion`:
  the depth pyramid of the frame before, asynchronous readback, CPU test), `frame.js` (`onView`), and
  `applyBigWorld(world, root, 'chunk,lod,occ')` (`@mirage/core/bigworld`), which every example takes as
  `?perf=chunk,lod,occ`. @mirage/world: `createPartition` (streaming cells, an HLOD proxy for each cell that is out)
  and `createFloatingOrigin`. Measured on `examples/demos/bigworld` (4096 m, 256 cells, 5.8 M source triangles,
  30 000 trees; 1280 x 720, 3 interleaved runs, proxies baked): town 47.48 M triangles and 28.8 ms a frame to
  1.26 M and 9.2 ms (8.1-10.7); 2 km out 44.96 M and 26.7 ms to 0.34 M and 7.5 ms; CPU per frame 0.5-0.7 ms to
  1.1-1.8 ms. At 4x CPU throttle: 29.5 ms to 11.5 ms (p95 14.6). Occlusion: 0 differing pixels against the same
  frame without it over 803 comparisons at 6 to 60 m/s. The shipped examples are too small to gain: with the flag
  they submit 10-50 % fewer triangles in about twice the draw calls, and frame time is the same or 3-4 ms worse.
  Not built: a GPU-driven path (WebGL2 has no indirect draws), offline proxy baking, virtualised geometry.
- @mirage/play: fewer allocations in the frame loop (`walkgrid.support(x, z, y, step, out)` fills the caller's
  array; scratch vectors in `play.js` and `world.renderFrame`): 42 641 to 36 083 bytes a frame in hello-courtyard,
  44 363 to 37 292 in walled-garden (Chrome's sampling heap profiler, 3 runs). What is left is mostly three's own.
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
  - `createTextures({ decode: 'bitmap' })`: images decoded off the main thread (`createImageBitmap`, no colour
    conversion), same pixels (still diff 0); Safari < 17 and Firefox < 98 keep the `<img>` path. hello-courtyard's five sets: `prepare()` 231 -> 162 ms, main-thread long tasks to ready
    298 -> 239 ms in total, the longest 143 -> 90 ms.
  - `createUploadBudget(renderer, { bytes })`: texture uploads spread over frames (`renderer.initTexture`). Six new
    1024 px textures: one 30 ms frame (29-32) -> six frames of at most 5.7 ms (5.7-5.9) at 8 MB a frame. A texture
    that never gets an image (`maxWaitMs`, 10 s) or is disposed leaves the queue, so `whenDone` always resolves.
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
    region of an earlier grid in place; async bakes into one grid run in turn, a tile restarts when the scene changes
    under it (`restarts`, 3), `signal` aborts, at least one read a frame whatever `budgetMs`. Floors and count arrays bit-identical to the sync bake on hello-courtyard and
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

- `ctx.onUpdate(fn)` / `world.onUpdate(fn)` return a function that unsubscribes (they returned the number of
  subscribers). Calling it twice, or from inside the callback, is safe; `docs/LIFECYCLE.md`. Module callbacks of a
  streamed or partitioned world are dropped with their module.
- Export maps are explicit lists (core 42 subpaths, world 13, play 18, game 23, net 4): the `"./*": "./src/*.js"`
  wildcard is gone, so a file under `src/` that no entry names (for example core's `particle-draw.js`) can no
  longer be imported. Every subpath the examples, docs and packages use is listed; `node scripts/check-imports.mjs`
  names an import that is not.
- A playtest `perf` step times its frames in three consecutive parts and reports the median with the spread
  (`frameMsRuns`, `frameMsSpread`; the same number of frames as before, so the walker ends where it did). MG501
  no longer blames the triangle count for a slow frame unless the view is over `plan.budget`, and says so when the
  runs disagree by more than 25 %.

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

- @mirage/core: `createLod().register()` threw a ReferenceError (`unit` was declared inside the traverse callback
  and read after it; found by the linter, regression check in `scripts/checks/tooling.check.mjs`). `createVfx` on
  a world left its per-frame callback subscribed after `dispose()`.
- @mirage/tools, @mirage/net: the static servers followed a symlink inside the served folder to a file outside it;
  they now compare the real path (27 assertions in `scripts/checks/serve.check.mjs`). `mirage-package` found worker
  URLs with a regular expression, which a string or a comment could satisfy and a line break could defeat; it now
  parses the bundle and refuses a worker path outside the build (44 assertions).

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

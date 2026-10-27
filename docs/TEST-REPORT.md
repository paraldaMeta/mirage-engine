# Test report — round 1 (CURSOR-ROUND1)

Machine: Mac mini, Apple M4 Pro, macOS 26 (darwin 25.6), Node 22.23.1, local Google Chrome headless with the GPU
(ANGLE Metal). Code under test: `main` at `aee74a8`. Every fix is its own local branch with one commit (nothing
pushed, `main` untouched); `test/round1-integration` merges them all for the combined run.

## Summary

| Task | Result | Branch |
|---|---|---|
| Baseline | `npm test` ok. All walk / collision steps pass in all five examples, built and single file. Failures came only from the host's audio device (fixed) and from snow-hut's frame-cost step, which was a side effect of that audio error | — |
| (found) audio device error | fixed: headless Chrome gets a null audio sink | `fix/tools-audio-output` |
| 1 · A4 e2e | `npm run test:e2e` builds, playtests, packages and re-playtests every example, plus the garden-quest playthrough; exit 1 on any failure | `test/a4-e2e` |
| 2 · A5 door pinch | fixed: a leaf that would overlap the player waits; in the open the player is pushed out (that already worked) | `fix/a5-door-pinch` |
| 3 · B16 small risers | does not reproduce with the released controller (cylinder); regression test added (19 lanes); a capsule reproduces it | `fix/b16-small-risers` |
| 4 · B3 walk grid | 45° wall sliding fixed; thin railings (< 0.125 m) still missed by the bake: open, see below | `fix/b3-walk-grid` |
| 5 · B10 start jump | fixed (pad A, Space, touch Jump) | `fix/b10-start-jump` |
| 6 · B19 day-night clock | fixed: first frame = `?from=`, image lag 17.8 → 0.0 clock minutes | `fix/b19-day-night-clock` |
| 7b · B21 GPU load | still: 0 frames in 10 s, hidden tab: 0 frames, walking ≤ 60 and ≤ the display rate, power saver 30, medium by default with automatic low, corner HUD. Before: 9 checks failing (snow-hut drew 60 fps forever) | `fix/b21-gpu-load` |
| 7 · A2 Safari / Firefox | WebKit: 5 / 5 examples pass, 0 messages. Firefox: every step passes; the `errors == 0` check fails on WebGL / autoplay warnings (no errors) | `test/a2-browsers` |
| 8 · review | fixed: an unguarded save click; window resize (canvas, still redraw, TAA history); negative first-frame dt in play. The rest is listed under open issues | `fix/save-error-shown`, `fix/resize` |

## Baseline (main, before any fix)

`npm install`; `npm test`: core, game, play, world checks ok, 7 skills ok, exit 0. For each example: `vite build`
(all ok, 120–380 ms), playtest on `dist/` (http), `package.mjs` → `release/<name>.html`, and the playtest on that
file (file://). The run was serial on an otherwise idle machine.

| example | steps (dist / file) | console messages | frameMs (p95), dist / file | load to ready, dist / file | flicker mean / max | single file |
|---|---|---|---|---|---|---|
| hello-courtyard | 14/14 · 14/14 | 0 | 3.36 (3.6) / 3.55 (4.3) | 4.6 s / 0.6 s | 4.84 / 7.6 | 2.24 MB |
| walled-garden | 18/18 · 18/18 | 0 | 4.01 (4.4) / 3.99 (4.3) | 7.4 s / 1.0 s | 4.25 / 7.0 | 2.25 MB |
| garden-quest | 9/9 · 9/9 (marked FAIL) | 1 audio error | 4.60 (5.2) / 4.75 (5.1) | 6.7 s / 2.0 s | 1.84 / 10.7 | 4.52 MB |
| agent-trial | 16/17 · 16/17 | 1 audio error | 6.26 (6.9) / 4.55 (5.1) | 4.3 s / 1.9 s | 2.56 / 51.2 | 3.15 MB |
| snow-hut | 16/19 · 16/19 | 1 audio error | **13.79** (15.7) / **16.19** (20.9), budget 8 | 7.4 s / 2.6 s | 2.10 / 18.5 | 3.14 MB |

garden-quest playthrough (main, pad, touch parts): every step passed, but each part failed on the same audio error
(3 failures).

The error was "The AudioContext encountered an error from the audio device or the WebAudio renderer". It comes from
Chrome itself: headless Chrome opens the host's default output device (here a USB speaker) and that device fails.
With `--disable-audio-output` (branch `fix/tools-audio-output`), snow-hut passes 19 / 19 with 0 messages and
frameMs 5.82 (p95 6.3). The failing device was also what slowed snow-hut's frames.

Load times for dist include the vite asset fetches on the first open; file:// loads are warm.

## Per task

### A4 — `npm run test:e2e`

`packages/tools/src/e2e.mjs` (also the bin `mirage-e2e`) runs these steps, in order, for every example whose
`package.json` has a `playtest` script:

1. `vite build`
2. playtest on `dist/`
3. garden-quest only: the scripted playthrough
4. `package.mjs` → `release/<name>.html`
5. the playtest on that file

Options: `--only a,b` and `--no-file`. It writes `out/e2e/summary.json`, prints one line per step, and exits 1 if
any step fails (2 for an unknown example name). Combined run on `test/round1-integration`: see "Combined run" below.

### A5 — a door closing on the player

- **Found:** in the open, the character controller already steps the player out of the closing leaf (pushed 0.40 m
  out of the doorway, 0 overlap).
- **The real bug:** a player who can't get out of the way. Two kinematic bodies never push each other, so the
  leaf closed straight through the body: 0.00 rad (fully closed) and 2.0 cm inside the body for 128 frames.
- **Fix** (`packages/game/src/physics.js`): before a hinge advances, its next pose is tested against the character
  colliders (`world.intersectionWithShape`). If they would overlap, the leaf waits that step.
- **Tests:**
  - `packages/game/check.mjs`: pushed out in the open (z 3.40); pinned against a block, the door stops at 0.04 rad
    with 0.0 cm overlap; reopened, the player walks out and the door closes.
  - garden-quest playthrough: new steps `door-closes-on-the-player`, `walks-off-after-the-door` and
    `door-opens-again`.

### B16 — Rapier character on 5–13 cm risers

I could not reproduce it with the controller as released (a cylinder collider, radius 0.28; autostep 0.4 m with
treads ≥ 0.15 m; snap 0.3 m).

- **Node, box lanes:** a 17 cm step then a 13 cm riser; 5, 8 and 13 cm risers alone; a 3 cm chamfer; everything
  merged into one trimesh; straight and 22° off; treads 0.16–0.5 m; walking and running; dt 1/60, 1/30, 1/20, 1/10.
  Every lane climbs.
- **The built snow-hut page:** 12 lanes added at runtime on the snow terrain trimesh (the same step / riser /
  threshold sets, separate and merged, straight and diagonal). All go up and none stall.
- **Likely cause:** the collider shape at the time. With the collider swapped for a capsule of the same size, the
  new test fails 14 / 19: step plus riser at 74–79 % of the walk, 30 % on the diagonal. The comment in `physics.js`
  records the switch to a flat-bottomed cylinder.
- **Regression test** (`packages/game/check.mjs`, "small risers"): 19 lanes, each of which must end on top at
  ≥ 80 % of walking speed. Now: 19 / 19, slowest 93 %. With autostep cut to 6 cm the test fails (13 cm risers at
  19 %, 8 cm at 46 %), so it does catch a stall.
- **Engine:** unchanged; the hut's one-slab porch can stay.

### B3 — walk grid: 45° walls and thin railings

- **45° walls (fixed,** `packages/play/src/walker.js`): sliding was axis-separated. Against a diagonal wall both
  axis moves point into it, so the walker stalled. At 30° off the normal it moved 0.17 m in 2 s where sliding gives
  1.50 m.
  - Now, when the full move is blocked, the walker estimates the wall normal from 16 cells on a ring just outside
    the body and moves along the tangent, with a small outward push for the grid's 0.125 m staircase. Every
    candidate position still passes `fits()`.
  - `packages/play/check.mjs`: 0° (straight in) stops; 30° slides 1.51 m of 1.50; 60° slides 2.62 of 2.60. The body
    centre stays ≥ 0.19 m from the wall.
  - hello-courtyard and walled-garden playtests pass on the branch and on the integration branch (see "Combined
    run", including a failure under GPU sharing that did not reproduce).
- **Thin railings (open, not changed):** the bake samples each 0.125 m cell at its centre, so a solid thinner than
  about a cell can fall between samples. Fixing it in the bake means supersampling each cell (about 4× the bake
  CPU: walled-garden 0.27 s → about 1 s), which is a design choice for the author. Two options:
  - authors give thin solids a `ctx.collider(...)` proxy at least one cell thick (no engine change; document it in
    the world skill); or
  - an optional `walk.subsample` in `bakeWalkGrid`.

### B10 — gamepad A on the start screen also jumped

- **Cause:** the start screen turns input on in the frame the button goes down. Jump reads a held button, so the
  next frame jumped.
- **Fix:** keys and pad buttons held when input is enabled are marked spent until released; the touch Jump button
  on the start screen only starts the game.
- **Tests** (`packages/game/check.mjs`, fake gamepad and key target): A held for 30 frames through the start gives
  0 jump frames (was 30); pressing A again jumps; the same for Space. The garden-quest playthrough's pad part
  `a-starts` now holds A for 600 ms and requires the feet to stay within 5 cm.

### B19 — the day-night demo started about 10 minutes early

Measured in Chrome:

- The HUD clock was fine apart from the first frame (06:29–06:34 for `?from=06:30`: the first dt was the gap since
  the module ran, capped at 0.1 s = 4 clock minutes, or slightly negative).
- The image lagged: exposure adaptation (time constant about 1 s) and the light cross-fade (1.5 s) run in wall-clock
  seconds, which at 40 clock min/s is a steady 10–18 clock minutes behind (9.5 at 07:11, 12.5 at 07:51, 17.7 at
  08:31).

Fix (the demo only; the core is unchanged): `world.tick(dt * rate * 60)`, so easing runs on clock time, and the
first frame has dt = 0.

Test: `node examples/demos/day-night/clock-check.mjs`.

| | first frame vs `?from=` | exposure lag | fps | console errors |
|---|---|---|---|---|
| before | −1 min | 17.83 clock min | — | — |
| after | +0 min | 0.00 clock min | 60 | 0 |

### 7b / B21 — GPU load ("does it hurt the graphics card")

Test: `npm run test:gpu-load` (`packages/tools/src/gpu-load.mjs`, headless Chrome with the GPU, 60 Hz display). It
counts `renderFrame` calls and animation callbacks per example: after the idle time and the still refinement (10 s
still), with another tab in front (3 s), with W held (3 s) and with the power saver on.

| | still, 10 s | hidden tab, 3 s | walking | power saver | quality |
|---|---|---|---|---|---|
| main | 0 frames; **snow-hut 600** (60 fps forever) | 0 frames, 0 callbacks; **games: audio keeps running** | 60 fps (no cap of its own) | none | high |
| `fix/b21-gpu-load` | 0 frames, all five | 0 frames, 0 callbacks, audio suspended (running again on return) | 60.0–60.3 fps | 30.0 fps | medium (auto low) |

- **Why snow-hut never stopped:** its character drifted 0.3 mm/s on the snow (residual movement of the Rapier
  controller), so the view changed every frame. A 2 mm deadband when standing on the ground with no input stops it.
- **① still:** after 10 s without input (`idle` option) a changing scene (sky, animated props) no longer keeps play
  moving, the still refinement finishes and nothing is drawn; keys, pointer, wheel, touch and gamepad wake it.
- **② cap:** frames are capped at 60 (`maxFps`), never above the display rate (it follows rAF); the power saver caps
  at 30. Not measured on a 120 Hz display (this machine's headless Chrome runs at 60).
- **③ hidden:** `visibilitychange` stops scheduling animation frames altogether and suspends the game's audio.
- **④ quality:** a new `medium` preset (shadow map 2048, 8 AO samples, 4 spp, env 256) is the default.
  `pickQuality()` picks `low` on battery (Battery API), on mobile, or on a weak / software GPU (renderer string), and
  a saved choice wins. `?quality=` still overrides. Limit: a laptop at 100 % on its charger reads as a desktop.
- **⑤ HUD:** bottom right, DOM (not in the canvas): quality select (saved, reloads), frames drawn per second ("idle"
  when still) and a "Power saver" button. `?hud=0` hides it.
- **Unchanged images:** hello-courtyard `verify.mjs`, five views, same frame index → max 0, 0 pixels differ. `main` vs
  the branch with `?quality=high&hud=0`, settled frame: hello-courtyard 59 pixels differ by 1 and walled-garden 42 by
  1, exactly the same as `main` vs `main` (run-to-run noise).
- **Games, unchanged images:** the camera follows the physics character, whose resting place varies by fractions of
  a millimetre from run to run (variable physics step), so the frames were taken from the plan's first viewpoint in
  fly mode, once settled (`still > 60`). `main` vs the branch with `?quality=high&hud=0`: garden-quest 47 pixels
  differ by 1 and agent-trial 339 by 1, again exactly `main` vs `main`. snow-hut has no settled frame on `main` (the
  drift above). On the branch it settles; branch vs branch differs only in the snowfall (whose clock is game time and
  stops wherever the view settles): 22,979 pixels, and with the flakes hidden 454 pixels by 1.
- `npm test` ok; the five playtests all pass on the branch.
- **Behaviour choice for the author:** at the default medium, the images differ from `main` by design (smaller shadow
  map, fewer AO samples and spp). Use `quality: 'high'` where the look matters more than the load.

### A2 — Safari (WebKit) and Firefox

- **Setup:** Playwright installed outside the repo (`/tmp/pw`, not a dependency). Builds: webkit-2370 and Firefox
  157 (playwright firefox-1555). `MIRAGE_BROWSER=webkit|firefox` with `MIRAGE_PLAYWRIGHT=<playwright/index.js>`
  makes the tools launch them through a thin puppeteer-shaped wrapper (branch `test/a2-browsers`).
- **Targets:** the `dist/` builds of `main`.

| example | WebKit steps · messages · frameMs | Firefox steps · messages · frameMs |
|---|---|---|
| hello-courtyard | 14/14 · 0 · 3.44 | 14/14 · 15 warnings · 3.30 |
| walled-garden | 18/18 · 0 · 3.86 | 18/18 · 20 warnings · 3.53 |
| garden-quest | 9/9 · 0 · 3.92 | 9/9 · 27 warnings · 4.12 |
| agent-trial | 17/17 · 0 · 3.76 | 15/17 (the two `errors == 0` checks) · 15 warnings · 5.07 |
| snow-hut | 19/19 · 0 · 4.52 | 17/19 (the two `errors == 0` checks) · 24 warnings · 3.80 |

Firefox printed no errors, only warnings, and the playtest counts warnings in `errors`. Three of the kinds are not
ours to fix:

- three.js `WebGLProgram` shader info logs ("output of vertex shader not read by fragment shader")
- `KHR_parallel_shader_compile` not supported
- `WEBGL_debug_renderer_info` deprecated (the playtest tool's own GPU query)

The other two are worth noting:

- "Depth texture comparison requests LINEAR filtering … implementation-defined": shadow-map filtering may look
  harder on some Firefox systems.
- "An AudioContext was prevented from starting automatically" (garden-quest): expected before the first click. The
  game resumes the context on the start click.

To decide: count warnings separately from errors in the playtest, or ignore the three known driver warnings. I left
it unchanged.

The garden-quest playthrough (keyboard, gamepad shim, touch emulation) was not run in WebKit or Firefox; it uses
Chrome-only puppeteer features (touch emulation, `evaluateOnNewDocument`).

### 8 — code review

Fixed, each with a test:

- **The save click had no try/catch** (`packages/game/src/ui.js`). With storage full or blocked the menu said
  nothing, and a QuotaExceededError reached the page. Now the menu says "Could not save: …". New playthrough step
  `save-fails-visibly`: FAIL before, pass after; all 20 main steps pass.
- **Window resize** (`play`, `core`, all five examples):
  - The canvas kept its load-time size.
  - On a still view, a resize cleared the canvas and it stayed blank, because play's redraw key didn't include the
    size.
  - `world.resize()` didn't invalidate the TAA history.
  - Now `createPlay({ fit })` follows the window (the examples pass `fit` unless `?w=` is given, so the tools are
    unaffected), the redraw key includes the drawing size, and `resize()` resets TAA.
  - `examples/hello-courtyard/scripts/resize-check.mjs`: 1000×700 → 800×500 gives an 800×500 canvas, refinements
    2 → 4 and a non-blank image (before: canvas still 1000×700, no redraw, FAIL).
  - Still-frame identity (`hello-courtyard verify.mjs`, five views): same frame index → max difference 0, 0 pixels
    differ.
- **Negative first-frame dt in play's loop:** a rAF timestamp can be earlier than the `performance.now()` taken
  before it. Clamped at 0 (in the resize commit). The same pattern in the day-night demo is fixed in B19.

Looked at and fine: `post.js setSize` (render targets recreated, bloom resized); texture loads (errors are logged
and resolved); the world loader's module isolation; `envlight` (a zero or negative fade can't produce NaN: clamped
by `Math.min`). On return from a hidden tab, rAF resumes with dt capped at 0.1 s, so there is no jump.

## Combined run (`test/round1-integration`)

All ten branches merge without conflicts. `npm test`: ok (the game check includes the door pinch, the small
risers and the input section).

`npm run test:e2e` (serial, machine otherwise idle): **21 / 21 steps pass**, exit 0, 32.5 min. Five builds,
five playtests on `dist/`, the garden-quest playthrough (137 s), five single files and five playtests on them
(file://). Slowest: snow-hut, 405 s on dist and 403 s on file.

An earlier run, while other headless browsers shared the GPU, failed walled-garden (dist and file) with the walker
stopping early (`retaining-wall-blocks` at z 11.68, `stairs-descend`, `game-view-climbs`). It did not come back:
- the B3 branch alone, walled-garden playtest 3 / 3 runs pass; the integration branch 2 / 2 and then the full run;
- the B3 walker replayed in Node on walled-garden's baked grid (exported from the page), 40 random frame-time
  sequences per case: 0 failures, the same as `main`'s walker.
So I count it with open issue 7 (playtests steer in real time and fail under heavy GPU sharing), not as a B3 bug.

**With B21 merged** (`26d3bcb`; the conflicts were both sides adding options next to each other, and `play.js`'s frame
loop takes B21's scheduling plus resize's dt clamp and size in the redraw key): `npm test` ok; `npm run test:e2e`
21 / 21 again (24.5 min for the whole sequence below); `npm run test:gpu-load` all pass (walking 60.0–60.3 fps);
`resize-check.mjs` ok (800×500, refinements 2 → 4, 0 errors); `verify.mjs` five views, same frame index → max 0,
0 pixels differ.

## Adversarial review of the round's changes

Every branch's diff was read again as someone else's code, looking for what the tests would miss.

Fixed (`fix/b21-gpu-load`, commit `e69bc12`, each with a test that fails before):

- **The frame cap was wrong on most displays that aren't 60 or 120 Hz.** A minimum gap of 1/60 s − 2 ms between
  frames draws every other frame when the display's frame is shorter than that: 75 Hz gave 37.5 fps, 90 Hz 45,
  100 Hz 50, 144 Hz 48, 165 Hz 55, and the power saver 25 at 75 Hz. This machine's 60 Hz hid it. Now a deadline per
  frame: 60.1 fps at 75–165 Hz, 50 at 50 Hz, 30.1 in the power saver. Test: `packages/play/check.mjs` simulates
  50–165 Hz with ±0.8 ms jitter.
- **On a phone the corner covered the touch buttons.** It sat bottom right above the game's UI, over the lower edge
  of Jump and of the stick, so a tap there switched the power saver on. On touch it now goes below the game's menu
  button. Test: a "phone" check in `gpu-load.mjs` (390×844, touch): before "covers mg-stick, Jump", after clear in
  all three games.
- **iPads got medium:** their Safari sends a Macintosh user agent. `pickQuality` now uses the same touch test as
  `deviceProfile`. Test: `packages/core/check.mjs` (an iPad gets low, a Mac medium).

After the fixes: `npm test` ok, `npm run test:gpu-load` all pass, the five playtests pass, `verify.mjs` five
views max 0 / 0 pixels.

Looked at and fine: the door pinch (a leaf waits only when its next pose overlaps a character; loading a save sets
the angle directly); spent keys and pad buttons (released keys and blur clear them; the pause menu keeps polling the
pad); resize (the game-view camera's aspect is recomputed every frame); the save error message; B19's clock-time
`tick` (it drives only exposure and the light cross-fade, not module animation); a saved quality is checked
against the three levels, and no module reads `ctx.quality`.

Worth knowing, not changed:

- **The idle stop is time-based.** After 10 s without input, a game's scene changes that don't move the camera are
  no longer drawn. Today nothing changes without input (doors move only after E, for about 1.2 s), but a future
  timed event would freeze on screen until the next input. The game can call `play.wake()` for it.
- **When still, the GPU is idle but the loop isn't:** animation callbacks still run at the display rate (input,
  physics, the view key). That is CPU, not GPU.
- **The 2 mm standing deadband** would also ignore a platform moving slower than 0.12 m/s (0.06 at 30 fps) under a
  player who isn't pressing anything. There are no moving platforms yet.
- **`?quality=` is not checked:** an unknown value renders as high (core's fallback) and the corner's select shows
  the first level.
- **`fit` doesn't follow a change of device pixel ratio** (a window dragged to a screen with another scale).
- **Not measured on real devices:** a 75 / 144 Hz display, a laptop on battery, a phone or tablet, and B21 in Safari
  and Firefox.

## Open issues (for the author to decide; not changed)

1. **Thin railings in the walk grid**, under B3 above.
2. **`world.dispose()`** disposes geometries, the pipeline and the environment light, but not materials or
   textures (`createTextures().dispose()` exists and the host must call it). A page that mounts and unmounts worlds
   leaks GPU memory.
3. **`createPlay` adds window and document listeners** (keys, mouse, blur, and resize with `fit`) and never removes
   them; `stop()` only stops the loop. A host that makes several plays in one page keeps them all listening. A
   `dispose()` would need an API decision.
4. **Audio kept playing in a hidden tab:** suspended on `visibilitychange` in B21.
5. **`AudioContext.resume()` promises are not handled** in `@mirage/game` audio's start path. A rejection (rare,
   e.g. a permissions policy) would be an unhandled rejection. (B21's suspend / resume catches its own.)
6. **Firefox warnings fail the playtest's `errors == 0`** (A2). Decide whether warnings count.
7. **Flaky under load:** the garden-quest playthrough got stuck once on the way to the pavilion (at −0.58, 0.20,
   11.17), and walled-garden's walk steps stopped early in one e2e run, both while other headless runs shared the GPU. Alone it passes every time I ran it (3 runs). The steering uses
   real time, so low frame rates (dt capped at 0.1 s) change the path. e2e runs the examples one at a time for this
   reason.
8. **`package-lock.json` changes on every `npm install`:** the workspace packages are 0.1.0 but the lock records
   0.0.0. Regenerate and commit the lock once. I restored it in every commit here.
9. **The hello-courtyard clock loop** (`?clock=N`) and `embed.js` hosts use the same `Math.min(now - last, 0.1)`
   pattern as before. Minor: at most a few milliseconds of negative clock on the first frame.
10. **Commit messages:** the A4 commit carries "(WIP: numbers pending)"; the numbers are in this report and in a
    follow-up commit on the branch. The A2 commit message calls the WebKit build by its Playwright id only. Four new
    files were first committed with CRLF line endings (e2e.mjs, clock-check.mjs, resize-check.mjs, gpu-load.mjs);
    each branch has a follow-up commit that only switches them to LF. Rewriting history was not allowed, so those
    branches carry two commits.
11. agent-trial's flicker maximum (51 at 2.3, 3.1; the mean of 2.6 passes) and snow-hut's doorway maximum (18.5)
    are as in the M5 notes.

## Branches (local, one commit each, based on `main` aee74a8)

`fix/tools-audio-output` · `test/a4-e2e` · `fix/a5-door-pinch` · `fix/b16-small-risers` · `fix/b3-walk-grid` ·
`fix/b10-start-jump` · `fix/b19-day-night-clock` · `test/a2-browsers` (on top of the audio fix) ·
`fix/save-error-shown` · `fix/resize` · `fix/b21-gpu-load` (on `main` 183614b, which added task 7b) ·
`docs/test-report` (this file) · `test/round1-integration` (merges all of them, B21 included, for the combined run
only).

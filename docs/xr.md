# WebXR: a mirage world in a headset

`createXR(play)` (in `@mirage/play`, experimental) lets any world be entered in a VR headset (`immersive-vr`) or set
on a floor or table as a model (`immersive-ar`). All seven examples opt in: open one in a headset browser (Meta
Quest Browser, Android Chrome with a headset, Pico, Wolvic) and press **Enter VR** or **Enter AR**.

```js
import { createWorldRenderer } from '@mirage/core';
import { createPlay, createXR, xrSupport } from '@mirage/play';

const xrs = await xrSupport();                                   // { vr, ar }: ask before creating the world
const world = createWorldRenderer({ ..., xr: xrs.vr || xrs.ar }); // a multisampled, XR-compatible context
// ... build, prepare
const play = createPlay(world, { plan, canvas });                // a game: const g = await startGame(...); g.play
const xr = createXR(play, { support: xrs });                     // a game: createXR(g.play, { game: g, support: xrs })
```

The buttons appear only when the browser offers the session (bottom centre; `button: someElement` puts them there,
`button: false` leaves them out and `xr.enter('immersive-vr')` starts one from your own click). On a desktop
browser nothing changes: no buttons, the same context, the same image (checked bit for bit, below).

## Controls (VR)

| | |
|---|---|
| left stick | walk where you look (head-relative); deflection is speed |
| left grip (or stick click) | run |
| right stick left / right | snap turn 30° (`snapTurn: 0` for smooth turning at `turnSpeed` rad/s) |
| right stick forward, release | teleport: an arc from the right controller onto walkable ground (blue = can land, red = cannot) |
| A | jump |
| trigger (either hand) | a game's interact (E); closes a game message ("Continue") |
| walking around the room | moves the walker too, through the same collisions: at a wall the view is pushed back |

AR: the world appears on the floor about a metre in front of you (on the hit-tested surface where the device offers
hit testing; the ring shows where); the trigger puts it where the ring is, the right stick turns it (x) and scales it
(y). `arSize` (default 0.9 m) is the model's largest side.

## How it works

**Locomotion is the desktop's.** The XR frame calls `play.step(dt)` exactly as the desktop loop does; the sticks are
merged into that step's input through `play.xrInput`, with `play.yaw` / `play.pitch` set from the headset. So the
grid walker (or a game's Rapier character and its fixed 60 Hz simulation) moves, collides, climbs steps, falls and
follows the ground as on a keyboard, and a game's `onStep` (nearest interactable, audio listener) sees the head's
direction. The rig (`xr.rig`, the reference space) is put each frame so the feet stand on the walker's eased view
position and the head is above them; head height comes from the headset (`local-floor`). The head's own walk around
the room is fed to the walker as stick input, so it cannot walk through a wall either.

**Teleport** follows a ballistic arc (8 m/s, gravity) over the walk grid: inside a solid or under a roof it stops;
crossing a floor it lands; the landing must fit the walker (`walker.fits`, or the headroom of the floor) and be at most
`teleportMaxUp` (1.2 m) above the feet, so no wall tops or roofs. A short blink hides the jump; snap turns blink too.
The **comfort vignette** closes in with stick speed (off: `vignette: false`).

**Rendering.** Mirage's desktop frame (half-float MSAA scene, SSAO, sub-frame accumulation, TAA, bloom, grade) cannot
run per eye at 72–120 Hz into the headset's framebuffer. In XR the play's own loop stops and
`renderer.setAnimationLoop` draws one plain stereo frame: `world.renderDirect(T, { camera, shadow })` runs
`renderFrame`'s frame state (scene clock, `ctx.onUpdate`, fog, the shadow fit around the view) and a single
`renderer.render` into the headset framebuffer. The grade is three's `CustomToneMapping`, installed once per page,
reading one uniform array every program shares (`XR_GRADE`): the desktop's exposure (with the light's eased
exposure), white balance (`post.temperature` + the light's warmth), the world's tone map (AgX / ACES / neutral),
saturation, contrast and lift, in the same order as `post.js`. Sky and stars (ShaderMaterials that write linear
colour) get three's tone-mapping and colour-space chunks appended; drawing into the desktop pipeline's linear targets
those compile to nothing, so the desktop image is unchanged after a session.

Bloom has a stand-in. With threshold 0 the desktop bloom adds about a quarter of a widely blurred copy of the frame,
which lifts shadows and gives the hazy glow; without it the XR image was clearly darker and harder (mean |difference|
from the desktop frame of the same eye 26–35 of 255). The stand-in adds `bloom weight × (GAIN × the pixel + VEIL × the
view's mean radiance)`, the mean measured by a **meter**: twice a second a 32 × 32 HDR render from the head (XR off,
the shadow map reused, points left out), read back through a pixel-pack buffer and a fence so it never stalls.
`XR_FIT` holds the constants, fitted over all seven examples by `packages/tools/src/xr-fit.mjs` (results below).
Not reproduced: SSAO, sharpening, grain, the screen vignette, depth of field, `post.sky`; shadows are one sample (no
soft sub-frame shadows); anti-aliasing is the headset framebuffer's 4× MSAA (no TAA).

**MSAA**: three gives the XR framebuffer multisampling only when the canvas context has it, and Mirage's context
had none (the pipeline does its own MSAA). `createWorldRenderer({ xr: true })` makes the context multisampled and
XR-compatible; examples pass `xrs.vr || xrs.ar`, so desktops keep the old context. Without it XR still works,
aliased, with a console warning.

**Framebuffer and foveation.** `framebufferScale` defaults by quality (high 1, medium 0.9, low 0.75 of the
headset's recommended size); `foveation` defaults to 1 (three's maximum fixed foveation); `frameRate` asks for
72 / 90 / 120 Hz where the headset allows it.

**AR** scales the viewer, not the world: the rig is scaled by `extent / arSize`, so fog, shadows and lights work in
the world's own metres. The sky and stars are hidden and the clear is transparent (passthrough shows through), four
clipping planes cut the world at the plan's bounds, fog is scaled to the model's real viewing distance, and frustum
culling is off while presenting (three's stereo culling frustum mixes the scaled eye distance with view-space
near / far and culled what was in view). The world is a viewer's model in AR: the walker and a game's simulation
do not step.

## Games

`createXR(g.play, { game: g })`: the trigger taps the game's `interact` action (the same `input.tap` the touch
overlay uses), with a haptic pulse when something is in reach. The prompt (`Trigger` + the entity's label) floats
over the interactable; toasts and `game.ui.message` dialogs show on a panel that lazily follows the head; the trigger
closes a message. Entering VR passes the start screen. Pages without a game can pass `prompt: () => text` and
`onSelect(hand)`.

## Testing without a headset

```sh
npm run build:examples
node packages/tools/src/xr-check.mjs examples/hello-courtyard/dist examples/garden-quest/dist [--out dir] [--perf]
node packages/tools/src/xr-fit.mjs examples/*/dist        # refit XR_FIT
```

`mirage-xr-check` injects Meta's Immersive Web Emulation Runtime (`iwer`, MIT, a devDependency of @mirage/tools)
into the page before its scripts, emulating a Meta Quest 3 with controllers in headless Chrome. Per world it checks:
the page's context is multisampled; Enter VR from the button; walks with the left stick (the desktop scenarios' own
expectations where they exist: hello-courtyard's east wall stops at x ≈ 6.9, the gate passes, the basin rim stops;
garden-quest's terrace stairs climb to y > 3.4 and the locked pavilion door stops); then **the same frames replayed
through the desktop path** (keys and `play.step(dt)` for each recorded dt, from the same start) must end where XR
did; the vignette; snap turn (+30° once per push); teleport (aim, valid landing, the walker there); in a game, the
prompt over the key and the trigger picking it up; both eyes saved and not blank; the XR grade against the desktop
pipeline from the same eye's pose and lens; AR placement; after exit the desktop loop runs at the page size; a
desktop still before and after the sessions bit-identical (skipped where the scene moves with the game clock, e.g.
snow-hut's snowfall); no console errors. `--perf` adds a short session at two 1680 × 1760 eyes and times
`renderDirect` (CPU + GPU to a 1-pixel readback, and GPU time from `EXT_disjoint_timer_query_webgl2`).

### Results (2026-11-10, Apple M4 Pro, Chrome headless, iwer 2.8.0 as a Quest 3)

All seven examples: 84 checks, 0 failed (`docs/media/xr/xr-check.json`). The walks and their desktop replays:

| world | walk (left stick, the emulator's frames) | XR end | desktop replay of the same frames |
|---|---|---|---|
| hello-courtyard | east wall (x ≈ 6.9 expected) | x = 6.874, blocked 55 frames | same position (|Δ| < 1e-5 m) |
| hello-courtyard | through the gate (z > 8.6) | z = 9.75 | same |
| hello-courtyard | into the basin rim (z ≈ 2.15) | z = 2.125, blocked 85 frames | same |
| garden-quest (Rapier character) | up the terrace stairs to the locked door | y 1.67 → 3.67, z = −20.6, blocked 66 frames | same |

Snap turn: +30.00° per push. Teleport: hello-courtyard 4.9 m onto the court, garden-quest 4.9 m along the path,
both landing on the arc's target and on the ground. garden-quest: the prompt "Trigger: Pick up the key" floats over
the bench, the trigger puts the key in the inventory, the toast "You found the pavilion key" shows on the panel.

The grade against the desktop pipeline, same eye pose and lens, mean |difference| per 8-bit channel over a 200 ×
200 thumbnail (the desktop has SSAO, TAA, sharpening and the screen vignette, XR does not):

| | hello-courtyard | garden-quest | walled-garden | agent-trial | snow-hut | river-ford | woodland-path |
|---|---|---|---|---|---|---|---|
| no bloom stand-in | 26.6 | 28.0 | 30.2 | 34.7 | 35.0 | 27.8 | 26.3 |
| with the stand-in (`XR_FIT`) | 9.2 | 8.1 | 7.8 | 13.4 | 21.1 | 8.9 | 11.7 |

snow-hut (blue hour, falling snow) stays the furthest: its XR image is darker (mean 49 / 56 / 66 against 69 / 76 /
83); the desktop's glow around the lit windows and snowflakes is wider than the stand-in models. Bit-identical
desktop stills before and after the XR sessions in the six worlds whose scene holds still; snow-hut's snowfall runs
on the game clock, so its two stills before XR already differ (skipped). Separately, `mirage-snap` of
hello-courtyard (hero, corner) and garden-quest (gate) at 960 × 600 is pixel-identical before and after this change.

Frame cost (`--perf`: two 1680 × 1760 eyes, the page's own quality pick under the Quest user agent = medium, 2048
shadow map; 80 frames; `renderDirect` only, the meter's 32 × 32 render twice a second not included):

| | GPU (timer query) mean / p95 | CPU + GPU to readback mean / p95 | draw calls | triangles |
|---|---|---|---|---|
| hello-courtyard | 5.3 / 7.9 ms | 6.9 / 9.6 ms | 59 | 231 k |
| garden-quest | 6.1 / 9.7 ms | 8.1 / 11.6 ms | 150 | 676 k |

That is a desktop GPU many times faster than a Quest 3's: at 72 Hz the budget is 13.9 ms and a mobile XR GPU will
need the lower framebuffer scale, the `low` quality (smaller shadow map) and probably fewer triangles; this has not
been measured on a headset. Evidence images: `docs/media/xr/`.

![both eyes, hello-courtyard](media/xr/hello-courtyard-vr-eyes.jpg)
![XR (left) and the desktop pipeline (right), the same eye](media/xr/hello-courtyard-xr-vs-desktop.jpg)
![teleport arc](media/xr/hello-courtyard-teleport.jpg)
![prompt over the key, garden-quest](media/xr/garden-quest-prompt.jpg)
![after the trigger](media/xr/garden-quest-after-trigger.jpg)
![AR: the courtyard as a table model (transparent background shown grey)](media/xr/hello-courtyard-ar.jpg)

## Limits

- Not tried on a real headset yet: everything above ran in the emulator. Hit testing was not exercised (iwer needs
  its synthetic-environment module for it; the floor fallback was), nor real controller layouts beyond Quest Touch,
  `layers` (three's projection layer path), real foveation, or the frame rate at 72–120 Hz on mobile GPUs.
- A game's DOM UI (pause menu, inventory, save / load, settings) is not reachable in the headset; messages and toasts
  are mirrored, the menu is not. Exit VR to use it.
- No hand tracking input (hands show nothing; pinch is not select), no controller models from the WebXR input
  profiles (simple shapes instead, nothing is fetched from a CDN), no fly / game / orbit modes in VR (walk only).
- Seated play gets a low head: there is no height calibration.
- First entry compiles the XR variants of the materials (a pause on entering); a running clock (`?clock=`) keeps
  running, but the environment light fades are drawn with XR off between frames.
- AR: no depth occlusion, anchors or plane detection; the model is clipped to the plan's rectangle only.

## Compared with three-live's XR

three-live (google/three-live) ships, per its README: 6DoF WebXR with a desktop simulator and stereo / gyroscope
fallbacks, 25-joint hand tracking with gesture classification, gaze-dwell input, ballistic teleport with walkable /
blocked validation, snap or smooth turning, a comfort vignette, plane and mesh tracking, depth occlusion, persistent
anchors, shared rooms, spatial UI cards and head-follow HUDs, spatial audio, Gaussian splats and native Android /
visionOS targets. Mirage now matches the locomotion set (teleport with validation, snap / smooth turn, vignette,
lazy head-follow panels) and goes beyond it where Mirage is strong: locomotion is the same collision walker and
physics character as on the desktop (proved frame for frame), and the XR image is graded to match the desktop
pipeline (measured per example). Not matched: hand tracking and gestures, gaze input, world understanding (planes,
meshes, depth occlusion), anchors and persistence, multi-user, spatial audio in XR beyond the game's own listener,
iOS / non-WebXR fallbacks.

# Post chain: temporal AA, upscaling, lens, motion, bloom, god rays, lens flare, lens dirt, streaks, grade, offline output

Everything here is **opt-in** and experimental. With every option off, the pipeline runs the code it ran before:
the effects object (`world.pipeline.fx`, `packages/core/src/postfx.js`) is not even created, and the stills of
hello-courtyard and walled-garden are byte-identical to the ones before this work (`npm run test:determinism`).

```js
import { createWorldRenderer, postFromQuery } from '@miragekit/core';
const world = createWorldRenderer({ renderer, post: { taa2: 1, upscale: 0.67, motionBlur: 0.5, ...postFromQuery(new URLSearchParams(location.search)) } });
world.post.bloomPyramid = 1;   // every option can change between frames
```

## Options (`world.post`) and URL flags (`postFromQuery`)

hello-courtyard and walled-garden read the flags: `examples/hello-courtyard/dist/?taa2=1&upscale=0.67&mb=0.5`.

| option | URL flag | what it does |
|---|---|---|
| `taa2: 1` | `?taa2=1` | temporal AA that reprojects with the velocity buffer |
| `upscale: 0.5..1` | `?upscale=0.67` | render the scene smaller and reconstruct the output size (switches `taa2` on) |
| `motionBlur: 0..1` | `?mb=0.5` | shutter fraction (0.5 = 180 degrees); `motionBlurMax` px at 1080p |
| `bokeh: 1` + `dof`, `focus` | `?bokeh=1&lens=0.03&focus=6` | lens blur on moving frames; `bokehMax` px at 1080p |
| `bloomPyramid: 1` + `bloom` | `?bloom2=1&bloom=0.15` | down / up-sample bloom instead of three's bloom pass |
| `lut`, `lutStrength` | `?lut=warm\|cool\|bleach` | 3D colour lookup after the tone map |
| `chroma` | `?chroma=0.6` | chromatic aberration, % of the half diagonal at the corner |
| `rcas: 0..1` | `?rcas=1` | contrast-adaptive sharpening of moving frames after the resolve / upscaler |
| `godrays` (1 = Nizwa-like) | `?godrays=1` | screen-space light shafts from the sun; `godraysDecay`, `godraysThreshold`, `godraysVol` |
| `flare` (1 = Nizwa-like) | `?flare=1` | the sun's lens flare (veiling glare, ghosts, halo), tested against the depth buffer |
| `lensDirt: 0..1` + `lensDirtThreshold` (1) | `?dirt=0.6` | a dirty lens: a procedural smudge mask lit by a wide glow of the light above the threshold |
| `streak: 0..1` + `streakThreshold` (3), `streakLength` (1), `streakTint` | `?streak=0.6&streakthr=3&streaklen=1` | anamorphic streaks: bright light smeared horizontally, a cool blue |
| `ssr2`, `ssgi`, `contact` | `?ssr=1&ssgi=1&contact=1` | screen-space reflections, indirect light, contact shadows: need `lighting: { screen: true }`, see `docs/lighting.md` |

Vignette and grain were already options (`vignette`, `grain`).

## How each pass works

**Fixed allocation.** The pipeline's targets are allocated once at the output size. A lower render scale (dynamic
resolution, `upscale`) draws into the lower-left corner through viewport and scissor, and every shader samples
through the `uSub` uniforms. Changing the scale no longer reallocates anything (`pipeline.setRenderScale` returns
false: nothing to rebuild), so dynamic resolution cannot hitch on a resize.

**Velocity.** A full-screen pass turns depth and the previous view-projection into camera motion; then every mesh
whose world matrix changed since the last frame and every `SkinnedMesh` (the previous bone matrices kept per
skeleton) is drawn over it with a small override material; an `InstancedMesh` moves with its object's matrix.
`world.pipeline.fx.moved` is the count of the last frame. Not covered: instances animated one by one, transparent
surfaces, morph targets, `BatchedMesh`, and vertex animation done in a material's shader (wind sway, water): those
get camera motion only, and the history clip has to catch the rest.

**taa2.** Sub-pixel Halton(2, 3) jitter; history fetched with the velocity of the closest depth in a 3 x 3
neighbourhood (edges move with the front surface) through a Catmull-Rom filter; the history colour is clipped in
YCoCg to the neighbourhood's mean ± gamma · sigma, gamma 1.25 at rest falling to 0.6 with motion; the stored clip
depth of the last frame rejects disoccluded history. A camera cut (`renderFrame({ alpha: 1 })`, the first frame,
a resize) restarts it.

**Temporal upscaler.** With `upscale` (or dynamic resolution below 1) the same pass writes a full-size frame: each
output pixel weights the jittered low-resolution samples by a Gaussian of their distance in output pixels and
trusts the current frame less the further its nearest sample is. There is no texture mip bias, so textures are as
soft as the render scale until the history fills in; no learned upscaler.

**Bokeh.** Circle of confusion from the thin-lens model the accumulated stills use (`dof` is the lens radius in
metres — `apertureRadius(focalLengthMm, fNumber)` — and `focus` the distance), gathered at half resolution with a
40-tap rotated disc in which a sample counts only when its own circle reaches the pixel (and what lies behind a
sharp pixel cannot spread over it), then mixed back by circle size.

**Motion blur.** 16 px tiles carry the longest velocity near a pixel (so a fast object streaks over what stands
still behind it); 12 jittered taps along it, centred on the pixel, each weighted by depth order and by whether its
own motion reaches the pixel. Camera and per-object. Skipped on a cut.

**Bloom pyramid.** Six 13-tap downsamples (the first weighted by 1 / (1 + luma) against fireflies), tent upsamples
mixed level into level, mixed into the frame by `bloom`. No threshold: energy moves, it is not added. The exposure
is raised by what the old additive bloom added, so a look tuned with the old bloom keeps its mid-tones; the
picture has less haze (measured: 36.2 dB to the old bloom's still on hello-courtyard).

**LUT.** `lutTexture(parseCube(text))` for a `.cube` file, or `lutTexture(makeLut(([r, g, b]) => [...], 32))`.
Applied after the tone map on display-referred colour, with the half-texel correction.

Stills (`spp > 1`) never use taa2, bokeh or motionBlur: they integrate the lens and the shutter by accumulation,
which is exact. bloomPyramid, lut, chroma, godrays, flare, lensDirt and streak apply to stills and moving frames alike.

## God rays and the sun's lens flare (`godrays`, `flare`)

The two lens effects Golden Temple and Nizwa have (their `post.js`), rebuilt on Mirage's pipeline. Both are off by
default and draw nothing (no pass, no target, no program) until set; then they still draw nothing unless the sun
is in front of the camera, above the horizon and the key light (`createWorldRenderer` gives the pipeline the sun's
direction and the world's key light: `pipeline.lensSun`). At night, with the moon as the key light, and under an
orthographic camera they draw nothing. Their strength follows the key light's radiance, the sun as it reaches the
ground: weaker and redder toward the horizon, gone a minute after sunset.

**God rays** (`godrays`; `?godrays=1`): the cheap screen-space alternative to light2's volumetric light, for worlds
without light2. At half resolution, the sky (depth at the far plane) within a Gaussian round the sun's screen
position, weighted by its brightness (`godraysThreshold` x the sun's luminance and brighter counts fully), is
blurred along the line to the sun: three passes of 24 taps, decaying by `godraysDecay` (0.965). The plain sky mask
and the kernel are blurred alongside, and their ratio is how much of the sky round the sun something (a wall, a
palm, a tower) hides along a pixel's line to the sun: **shafts only show there**. An open sky round the sun keeps
the glow its own aureole gives it (this is light2's choice too: an open, wholly lit ray lays no veil). The light is
tinted by the key light's radiance, fades with the distance from the sun and with the air in front of each
surface (1 - exp(-z / 20 m): a wall 3 m away gets 14 %, the sky all of it), and is added before the bloom.

- **With light2.** light2's volumetric light marches the sun's own shafts through its shadow map (true shafts, in
  3D) whenever the sun is low or the eye is near a room. On those frames the god rays are weighted by `godraysVol`
  (0.35): they keep the streaks round the sun's disc that a 60 m dust march does not reach, without doubling the
  shafts. `godraysVol: 0` leaves the shafts to light2; on frames where light2 does not march the sun (a high sun
  over open ground) the god rays draw at full weight.
- **Determinism and TAA.** The only pattern is a per-pixel dither of each blur's first tap, stepped by the
  sub-frame / TAA index (constant for a still): stills stay bit-identical run to run. The passes run after the
  temporal resolve and test the jittered sub-frame's depth, so on moving frames the result is eased through a
  half-resolution history that follows the sun across the screen (20 % new per frame; a jump of the sun, a resize
  or `fx.reset()` starts it again). Static camera at golden hour behind the palm, mean change between moving
  frames (display levels): 0.28 off, 0.31 with god rays (1.24 before the history and the half-resolution air
  term).

**Lens flare** (`flare`; `?flare=1`): a 1 x 1 pass takes 16 depth taps over a disc 1.25 x the sun's (sky.js draws a
0.27 degree disc) and keeps the share that sees the sky, on the GPU (no read-back). A sun behind a wall, a pier or
the palm's trunk leaves no flare (the frame is bit-identical to `flare: 0`); half hidden among fronds, part of it;
off the frame, none. The flare is a veiling glare round the sun, six ghosts on the line from the sun through the
frame's centre, and a faint halo ring, x the key light's radiance x `flare`, added after the bloom. No noise; on
moving frames the visibility eases over a few frames (30 % new per frame).

Evidence (hello-courtyard, `?time=golden&date=2026-10-25`, stills at 8 sub-frames, 1280 x 720): with both effects
on, the stills hero@golden, basin@12:00, pergola@21:00 and gate@17:22 are bit-identical to the effects off (none of them faces the sun), and the effects-off stills are bit-identical
to the commit before. A sun-facing camera through the west arcade: flare and shafts; one step to the side, the
sun behind a pier: no flare at all (0 px differ), faint shafts round the pier's edge. Above the court, the sun
behind the palm's fronds: a partial flare, shafts between the fronds. From the court floor, the sun behind the
west wall: no flare, shafts over the wall and through the palm. A camera that tracks the sun from 12:00 to 17:14:
the effects fade with the key light and vanish below the horizon (0 px differ at 17:14). The Nizwa probe
(`probes/nizwa-probe`, `?godrays=1&flare=1`): its `approach@17:00` faces away from the sun (bit-identical); a
camera above the court looking west at the round tower shows the shafts over its crenellations, light2's own
march and the god rays at `godraysVol` together.

Cost, moving frames (`renderFrame({ taa })` + a 1-px read-back), the median of 7 interleaved blocks of 30 frames
each way, panning round the sun behind the palm (the passes run; with the sun out of view they cost nothing),
headless Chrome on an Apple M4 Pro that other jobs were using:

| | 1280 x 720 | 2560 x 1440 |
|---|---|---|
| off | 2.73 | 7.52 |
| `godrays: 1` | 2.92 (+0.19) | 8.81 (+1.29) |
| `flare: 1` | 2.73 (+0.00) | 7.79 (+0.27) |
| both | 3.08 (+0.35) | 9.09 (+1.57) |

A still pays the passes once per frame, not per sub-frame.

## Lens dirt and anamorphic streaks (`lensDirt`, `streak`)

Two lens effects for night scenes with lamps (they work by day too). Both are off by default and draw nothing (no
pass, no target, no program, no mask) until set; set back to 0, the frame is bit-identical to before (the browser
check compares). They are added into the frame after the bloom (whichever bloom ran) and before the flare and the
grade, so the tone map rolls them off like any other light; on moving frames they read the resolved frame, so the
jitter of the TAA does not make them crawl. No noise: stills stay bit-identical run to run.

**Lens dirt** (`lensDirt`, 0.5 subtle, 1 strong; `?dirt=0.6`). The mask is made in code once, on first use
(`lensDirtMask({ width, height, seed })`, 512 x 256 bytes, ~20 ms on the CPU): a faint mottle, 34 soft blotches
(a fifth of them dried drops with a brighter rim), six wiped streaks, 140 specks of dust. What lights it is the
frame's light above `lensDirtThreshold` (1, exposed luminance: after `exposure`, the bloom's factor and the adapted
auto exposure, before the tone map; each pixel thresholded on its own, so a small hot lamp keeps its light and the
dim pixels round it add none), taken to 1/8 size, then 1/32, and blurred there (a Gaussian of about 100 output
pixels): a blotch beside a lamp lights up in the lamp's colour, a blotch over a dark wall stays dark. By day a
sunlit pavement above the threshold shows a faint mottle; raise `lensDirtThreshold` (2-4) if that is not wanted.

It does not ride on the bloom pyramid, although the first design did. The pyramid has no threshold (it moves energy,
`bloomPyramid` above): dirt lit by its glow lit up the whole night sky as much as the lamps (tried: a uniform veil),
and dirt that only strengthened the pyramid's mix where it lay was invisible round a lamp a few pixels wide (the
glow round it is barely brighter than the wall). So it carries its own thresholded glow (four small passes) and
works with either bloom, or none.

**Anamorphic streaks** (`streak`, 0..1; `?streak=0.6`). The light above `streakThreshold` (3, exposed luminance, a
soft knee) is taken at a quarter of the width and half the height (two bilinear taps a texel), smeared along x by
three passes of 9 taps (steps of 1, 4 and 16 texels x `streakLength`, weights falling off exponentially), and the
second and third passes added together: a bright core and a long tail, about a third of the frame width each way at
`streakLength: 1`. The streak is mostly desaturated, tinted by `streakTint` (linear RGB, `[0.5, 0.7, 1.0]`: the cool
blue an anamorphic lens's coating gives) and added x `streak`. A lamp's streak is as tall as the lamp's hot core
(the vertical resolution is half the frame's: about 2 px thick for a point).

Evidence (`out/` of the work, not committed): hello-courtyard `?time=21:30`, view 0, 1440 x 900, 8-sample stills: off,
`lensDirt: 0.6` (the blotches round the three lanterns warm, the sky and the walls away from them unchanged) and
`streak: 0.6` (blue lines through the lanterns, the rest unchanged). `node packages/tools/src/postfx-check.mjs` on
hello-courtyard and walled-garden (golden hour, thresholds lowered so the view has light above them): each changes
the still (lens dirt 78 % / 99 % of the pixels, streak 1 % / 6 %), no GL error, and set back to 0 the still is
bit-identical to the one before.

Cost, moving frames (`renderFrame({ taa: true })` + a 1-px read-back), hello-courtyard `?time=21:30` view 0 with a
panning camera, 9 interleaved rounds of 30 frames (the order reversed every other round), headless Chrome on an Apple
M4 Pro that other jobs were using: the median of the rounds, the range of the rounds in brackets, and the median of
the paired differences (each round against its own `off`), which is steadier when the shared GPU's load changes:

| | 1440 x 900 | paired | 2880 x 1800 | paired |
|---|---|---|---|---|
| off | 2.36 [2.33-2.41] | | 10.47 [8.68-11.01] | |
| `lensDirt: 0.6` | 2.44 [2.43-2.46] | +0.09 | 11.07 [9.17-11.98] | +0.65 |
| `streak: 0.6` | 2.46 [2.43-2.47] | +0.10 | 11.42 [9.43-11.93] | +0.89 |
| both | 2.56 [2.55-2.58] | +0.21 | 12.28 [9.95-14.53] | +1.69 |

A second run while the GPU was busier gave paired medians of +0.12 / +0.12 / +0.19 ms at 1440 x 900 and +0.50 / +0.62
/ +1.03 ms at 2880 x 1800 (rounds from 8.9 to 17 ms): at 2880 x 1800 the cost is resolved to about ±0.3 ms. A still
pays the passes once per frame, not per sub-frame.

## Auto exposure and rcas at night

Checked on walled-garden `?lights=64&time=21:30` and hello-courtyard `?time=21:30` (view 0, 1440 x 900), against
the same views at 12:00. Neither misbehaves at night; nothing was changed.

**Auto exposure** (`autoExposure: 0.5` and `1`, `taa2: 1`), 240 moving frames at 60 fps while the camera pans
±0.6 rad (three slow sweeps across the lamps), the adapted EV read back each frame:

| | walled-garden 21:30 | hello-courtyard 21:30 | walled-garden 12:00 | hello-courtyard 12:00 |
|---|---|---|---|---|
| EV at 0.5, min..max | -0.05..-0.01 | -0.02..+0.04 | -0.66..-0.58 | -0.38..-0.06 |
| EV at 1, min..max | -0.10..-0.02 | -0.05..+0.08 | -1.00..-0.98 | -0.75..-0.12 |
| largest step between frames (EV), at 1 | 0.004 | 0.008 | 0.002 | 0.026 |
| a still's own EV, at 1 | -0.06 | -0.05 | -1.00 | -0.44 |

No pumping: the EV moves by less than a hundredth of a stop per frame and stays within 0.13 EV over the pan. No noise
amplification: at night the correction is about zero, because the target sits `aeNight` (1) EV lower at full lamp
level (`world.js` framePost) and the meter is a centre-weighted log mean (a lamp entering the frame moves it little).
So at night auto exposure leaves the image as the day-night exposure made it; by day it darkens, as before. Set
`aeNight: 0` to let it lift a night scene (by at most `aeRange` EV, with the noise that brings). The lens effects'
thresholds include the adapted EV (read on the GPU), so a lamp streaks as much after adaptation as before.

**rcas with taa2** (static camera, 32 moving frames after 32 to settle): temporal noise is the mean |change| of a
pixel's display luma between frames (levels of 255), over every pixel and over the dark ones (luma < 40); the
high-frequency energy is the mean |4c - n - s - e - w| / 4 of the last frame:

| | temporal, all | temporal, dark | high-frequency, all | high-frequency, dark |
|---|---|---|---|---|
| walled-garden 21:30, rcas 0 / 0.5 / 1 | 0.345 / 0.352 / 0.355 | 0.340 / 0.342 / 0.346 | 0.77 / 1.02 / 1.12 | 0.68 / 0.92 / 1.02 |
| hello-courtyard 21:30 | 0.370 / 0.389 / 0.396 | 0.387 / 0.408 / 0.416 | 1.33 / 1.76 / 1.91 | 1.31 / 1.69 / 1.82 |
| walled-garden 12:00 | 0.356 / 0.373 / 0.380 | (no dark pixels) | 1.07 / 1.49 / 1.64 | |
| hello-courtyard 12:00 | 0.399 / 0.434 / 0.447 | 0.437 / 0.486 / 0.505 | 1.78 / 2.44 / 2.68 | 1.94 / 2.81 / 3.16 |

At night `rcas: 1` adds 3-7 % of temporal noise (7-12 % by day) and sharpens the dark pixels by as much as the rest
(+39-50 %, by day +51-63 %): the squashed-space limit (the lobe as strong as the local range allows) keeps it from
lifting the low-contrast noise of shaded ground more than detail. Grain is added after it, in the grade, so it is
never sharpened.

## Offline output (`mirage-snap`)

```
mirage-snap dist --seq 90 --fps 30 --from 0 --to 1 --shutter 0.5 --spp 16 --video out.mp4
mirage-snap dist --view 0 --png16 --exr
```

`--seq N` writes `frame-0000.png ...`: the camera travels from viewpoint `--from` to `--to`; every frame is the
still path, its sub-frames spread over the shutter and the lens, so motion blur and depth of field are integrated.
Frame f is drawn at T = f / fps: the same command gives the same bytes (checked: frames byte-identical across two
runs). A page that exposes `window.__mirage.step(dt)` gets it called once per frame for its own actors; objects that
move only in `step` are sharp within one shutter (only clock-driven motion and the camera blur).

`--video` encodes with `ffmpeg` when one is on the PATH (H.264 .mp4); otherwise with Chrome's WebCodecs VP9 encoder
into an `.ivf` file (`--encoder webcodecs` forces it; ffprobe and VLC read it, a browser does not). Nothing is
downloaded. `--png16` adds `<name>.16.png` (the grade drawn into a half-float target, 16 bits per channel);
`--exr` adds `<name>.exr` (the linear scene-referred frame before exposure and tone map, half float, uncompressed).

## Cost

ms per moving frame (`renderFrame({ taa })` plus a 1-pixel read-back to wait for the GPU), option off → on, the
median of 5 interleaved blocks of 30 frames each way, view 0 with a panning camera, headless Chrome on an Apple
GPU that other jobs were using at the same time. Blocks spread about ±0.2 ms at 1280 x 720 and ±0.5 ms at
2560 x 1440, so differences below that are not resolved.

| option | hello-courtyard 1280 x 720 | 2560 x 1440 | walled-garden 1280 x 720 | 2560 x 1440 |
|---|---|---|---|---|
| `taa2` (instead of the old TAA) | 2.6 → 2.7 | 7.3 → 7.8 | 2.8 → 3.0 | 7.9 → 8.6 |
| `upscale: 0.67` | 2.6 → 2.1 | 7.5 → 5.4 | 2.7 → 2.3 | 8.4 → 6.0 |
| `upscale: 0.5` | 2.5 → 1.8 | 7.4 → 4.2 | 2.7 → 2.1 | 9.3 → 4.9 |
| `motionBlur: 0.5` | 2.6 → 2.8 | 7.7 → 8.8 | 2.8 → 3.0 | 8.1 → 10.4 |
| `bokeh` (lens 0.03 m, focus 6 m) | 2.5 → 2.8 | 7.8 → 10.1 | 2.8 → 3.1 | 8.1 → 11.8 |
| `bloomPyramid` (instead of three's bloom) | 2.5 → 2.5 | 7.9 → 7.9 | 2.7 → 2.7 | 7.8 → 7.7 |
| `chroma: 0.6` | 2.5 → 2.4 | 8.1 → 8.0 | 2.9 → 3.0 | 7.5 → 7.5 |

Quality at 1280 x 720, PSNR of the 30th moving frame against a 16-sample still of the same pose (hello-courtyard):
camera at rest, old TAA 40.2 dB, taa2 41.4, upscale 0.67 38.4, upscale 0.5 35.4; panning, old TAA 37.7, taa2 40.2,
upscale 0.67 37.3, upscale 0.5 34.7. walled-garden panning: 41.3 → 43.2; with 40 walking NPCs in view 39.7 → 40.2.
The LUT's cost was not measured on its own.

## Sharpening after the upscaler (`rcas`)

One 5-tap pass over the resolved frame, before bloom and the grade (the grade's own `sharpen` stays). In a squashed
0..1 space the negative lobe is as strong as the local minimum and maximum allow, so flats and full-range edges are
left alone and the result is clamped to the neighbourhood: no ringing. The TAA history is a different target, so it
does not feed back. It is a look, not a reconstruction: hello-courtyard at 960 x 600 with `upscale=0.67`, against a
64-sample still, 38.81 dB without, 38.76 dB at `rcas=0.5`, 38.18 dB at `rcas=1` (native-size taa2: 41.93 dB). Cost,
interleaved: 2.30 -> 2.40 ms at 1440 x 900, 6.60 [6.60-6.60] -> 7.30 [7.30-7.40] ms at 2880 x 1800. No negative mip
bias is applied under upscaling (WebGL2 has no sampler LOD bias): textures are a little softer than at native size.

## Not here

- **God rays and flare in XR.** The XR pipeline (`createXRPost`) gets no `lensSun`, so `post.godrays` and `post.flare`
  draw nothing in a headset.
- **Lens dirt from an image.** `lensDirt` takes only its procedural mask (`lensDirtMask`, a seed); there is no option
  for a texture of one's own. Streaks are horizontal only (no rotation, no vertical or star pattern), and their
  vertical size is the source's (no separate thickness).

- **Screen-space reflections** now live in the lit materials (`lighting: { screen: true }`, `docs/lighting.md`);
  light2's older pass is unchanged.
- **XR.** `world.renderDirect` (the XR path) calls `renderer.render` into the headset's framebuffer and never
  enters the pipeline. To run the chain there, `packages/play/src/xr.js` would have to: (1) render each
  `XRView` into a pipeline target with that view's viewport and projection instead of the layer framebuffer (or a
  multiview / array target); (2) keep history, previous view-projection and velocity **per eye**; (3) blit the
  result into `XRWebGLLayer.framebuffer` per view; (4) allow only the passes that are safe at 72-90 Hz and
  comfortable in a headset: bloom pyramid, LUT, grade. No jittered TAA (the compositor reprojects, jitter swims),
  no motion blur, no depth of field, no chromatic aberration (the lens is already corrected). Fixed foveation and
  MSAA on the layer stay the anti-aliasing. Not built.
- Variable-rate shading, a learned upscaler (FSR 2 / DLSS class), auto-focus, object motion vectors for
  shader-animated vertices. A lens flare of the moon (the flare is the sun's only); flares of lamps.

Checks: `node packages/core/postfx.check.mjs`, `node packages/tools/snap-seq.check.mjs` (both in `npm test`),
`node packages/tools/src/postfx-check.mjs <dist>` (headless Chrome with a GPU).

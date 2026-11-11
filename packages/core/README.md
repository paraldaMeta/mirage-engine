# @miragekit/core

The rendering core of Mirage: a physical sky, aerial perspective inside every material, a key light (Sun by
day, Moon by night) with fitted soft shadows, image-based light captured from the built world, a sub-frame
accumulation pipeline (anti-aliasing, motion blur, soft shadows, clean SSAO, depth of field), temporal AA for
moving cameras, tone mapping and grade, an optional world-space texture layer for CC0 PBR sets, the
`patch()` material-hook system with a GLSL noise library, seeded randomness, geometry helpers, an LOD helper and
day/night for any place and time. Peer dependency: `three >=0.186.1 <0.187.0`. ES modules, no build step.

The root renderer lifecycle and all current JS subpaths have candidate declarations, pending off-machine compilation.
See [coverage and off-machine validation](../../docs/TYPES.md) and [resource ownership](../../docs/LIFECYCLE.md).

```js
import { createWorldRenderer, PROC } from '@miragekit/core';

const world = createWorldRenderer({
  canvas, width: 1440, height: 900,
  place: { lat: 35.01, lon: 135.77, height: 50, tzHours: 9 },
  time: { day: '2026-10-25', time: '16:50' },           // or 'golden' | Date | { elevation, azimuth }
  shadow: { center: [0, 2, 0], radius: 17 },            // the region the shadow map covers
  envProbe: [0, 2.2, 0],                                // where the image-based light is captured
});
const { scene, camera, mat, geom, rng } = world;
const plaster = mat.std({ roughness: 0.9 }, PROC.plaster());
scene.add(new THREE.Mesh(geom.wall({ length: 10, height: 4, openings: [{ x: 0, width: 2, height: 2.3, arch: 'pointed' }] }), plaster));
await world.prepare();                                   // compile programs, capture the environment
function loop(t) { world.renderFrame(t / 1000); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
```

## `createWorldRenderer(config)`

| field | default | meaning |
|---|---|---|
| `canvas` / `renderer` | — | a canvas to create a WebGL 2 renderer on, or your own renderer |
| `width`, `height`, `pixelRatio` | canvas size, 1 | drawing size |
| `quality` | `'high'` | `'high'` (4096² shadows, 12 AO samples, 4 spp), `'medium'` (2048², 8, 4) or `'low'` (2048², 8, 2, a smaller environment map). Pages usually pass `(await pickQuality()).quality`, which picks medium on most desktops |
| `place` | `{ lat: 0, lon: 0, height: 0, tzHours: 0 }` | degrees (east +), metres, the local clock's UTC offset; missing fields keep these defaults |
| `time` | `'golden'` | `Date`; `{ day: 'YYYY-MM-DD', time: 'HH:MM' }` local to `place`; `{ elevation, azimuth }` (degrees, compass) for a fixed sun; `'golden'` = 6.8° at 250° (the exposure reference); an ISO date string is that instant. A malformed time or place throws a `TypeError` naming the field |
| `shadow` | `{ center: [0,0,0], radius: 30 }` | sphere the sun's orthographic shadow map is fitted to (also per frame: `renderFrame(T, { shadow })`) |
| `envProbe`, `envIntensity` | `[0, 3, 0]`, `0.5` | capture point and strength of the image-based light |
| `envFade` | `1.5` | seconds an eased environment recapture cross-fades over |
| `fog` | `{ density: 1, groundDensity: 0.0016, height: 18, air: 0.00012, level: 0, color: 1, glow: 1 }` | height fog (extinction /m at `level`, scale height m), thin air, multipliers for the haze colour and the glow toward the light |
| `post` | `DEFAULT_POST` | `exposure (0.4), temperature, saturation, contrast, lift, vignette, tonemap ('aces' \| 'agx' \| 'neutral'), sharpen, grain, bloom, bloomRadius, ao, aoRadius, aoPower, aoLit, autoExposure, aeKey, aeNight, aeRange, aeUp, aeDown, sky, dof (lens radius m, 0 = off), focus (m)` (the opt-in ones: see "Ambient-only AO, auto exposure, dynamic resolution") |
| `spp` | per quality | sub-frames per frame |
| `wind` | `{ dir: [0.8, 0.6], strength: 1 }` | for `mgWind()` in vertex hooks |
| `clouds` | `0.35` | cloud cover 0..1 (`0.5` with the dusk sky) |
| `sky` | off | `{ dusk: true }` or `{ dusk: { haze, night, airglow, cover } }` overriding `SKY_DUSK_DEFAULTS`: twilight colours, a darker night dome, a hazy horizon, altocumulus (see "The dusk sky") |
| `shadowMapSize`, `mobile`, `preserveDrawingBuffer` | | overrides |
| `dynamicRes` | off | `true` or `{ target: 60 fps, min: 0.6, step: 0.1 }`: moving frames render smaller when they run over budget (see below) |
| `light2` | off | `true` or `{ ls, ssr, vol, bloom }` overriding `LIGHT2_DEFAULTS` (each part `false` to drop it): lamp shadows, screen-space reflections, volumetric light, mixed bloom (see below) |
| `softShadows` | off | `true` or fields overriding `SOFTSHADOW_DEFAULTS`: contact-hardening soft sun shadows, per pixel, in still and walking frames alike (see below) |
| `grade` | off | `true` or `{ strength, nightAdapt, lampTint, noon, golden, dusk, night }` (look overrides of `GRADE_PRESETS`): the time-of-day grade and a darker night (see below) |
| `reducedMotion` | off | `true` or `{ sway: 0.25, rain: 0.4 }`: reduced motion from the start (see "Reduced motion"); @miragekit/play sets it from `prefers-reduced-motion` |

Returns `{ renderer, scene, camera, sun, sky, stars, pipeline, ctx, G, keyDir, mat, geom, rng, post, device, light2, grade, softShadows,
light, state, exposure, setTime(time, { ease }), tick(dt), prepare(), renderFrame(T, opts), resize(w, h), dispose(), captureEnv(),
setAmbientVolumes(list), setReducedMotion(option), reducedMotion, renderTransparent(T, opts) }`.
light, state, exposure, setTime(time, { ease }), tick(dt), prepare({ warm }), renderFrame(T, opts), resize(w, h), dispose(), captureEnv(),
setAmbientVolumes(list) }`. `prepare({ warm: true })` (opt-in) also draws one discarded frame: see Seamless loading below.

- `renderFrame(T, { camera, getCamera(t), spp, dt, shutter, frameIndex, target, shadow, taa })` renders the frame
  at time `T` seconds as `spp` sub-frames. `getCamera(t)` gives motion blur (it is called at each sub-frame's
  shutter time). `frameIndex` seeds grain and dither only: keep it constant and a still view renders
  bit-identical frames. With `post.dof > 0` and `spp > 1` the sub-frames also sample a thin lens.
- `taa: true` (or the new frame's weight, default 0.12): one jittered sub-frame blended into the reprojected
  history (clipped to the new frame's neighbourhood). Use it while the camera or the clock moves; switch back to
  plain `spp` frames when everything holds still (the history is dropped, still frames stay bit-identical).
- `setTime(time)` recomputes the Sun, Moon, sky, haze, exposure and lamps and recaptures the environment (two
  passes) before the next frame. `setTime(time, { ease: true })` is for a running clock: exposure adapts over
  about a second and the environment is recaptured once only when the light changed enough (0.5° of the key
  light, lamps, sky light), then cross-fades. Call `tick(dt)` every frame; it returns true while anything is
  still changing. `world.light` holds the values (`keyRGB`, `exposure` target, `lamp`, `warmth`, …).
- `post` is live: change a field and the next frame uses it.
- `dispose()` frees the scene's geometries and materials, the shadow map, the post and environment targets, and
  the renderer if the world made it. Take out of the scene anything you still need first (`mountWorld` does this for
  its `root`).
- `setAmbientVolumes([{ min, max, factor = 0.3, soft = 0.6 }])` (up to 8 boxes): the image-based light is scaled by
  `factor` inside each box (interiors), ramping over `soft` metres. Compiled in only while a world has volumes, so
  worlds without them render exactly as before. `@miragekit/world` passes modules' `ambientVolumes` here.
- `ctx` = `{ THREE, renderer, scene, camera, G, keyDir, mat, geom, rng, quality, place, onUpdate(fn) }` for
  world-building modules; `onUpdate(fn(t))` runs before every sub-frame.

## Lamp shadows, reflections, volumetric light (opt-in): `light2`

`createWorldRenderer({ ..., light2: true })` (or an object: `{ ls: { slots: 2 }, vol: false }`). Off, nothing is
patched and a world renders bit-identical to before.

- **Lamp shadows.** Every visible `PointLight` (intensity > 0) competes for 4 shadow slots by power and distance
  from the view, with hysteresis. A slot's cube is drawn by three's own shadow renderer (so `castShadow`, instancing,
  skinning, alpha test work as for the sun) once, then refreshed every 20 s; top-level objects with
  `userData.mgDynamic` (people, doors) are redrawn round-robin, `userData.mgLampCast === false` ones (terrain, big
  ground meshes) never cast. All slots live in one octahedral depth atlas sampled through one `sampler2DShadow`
  (5 fixed PCF taps: stable under TAA). A lamp's own lantern within `PointLight.userData.lsNear` (default 0.45 m) of
  the flame does not shadow it. A slot follows its lamp (by the PointLight, or a source's `id`): a lamp that moves
  or changes range is redrawn. `distance: 0` (three's "no cut-off") is treated as the radius where the light falls
  to 1 % of its 1 m value. Meshes with `receiveShadow = false` get no lamp shadow; wind-swayed casters (a
  `customDepthMaterial` from `world.mat.depth(hooks)`) get a matching distance material, so they shadow as they
  sway. Lamp tables that are not PointLights: `addLampSource(scene, (camPos) => [{ id, x, y, z, range, power }])`,
  and call `mgLsVis(lampWorld, pWorld, nWorld)` in your shader. Still frames (`spp > 1`) stay bit-identical:
  their cube redraws depend on the sub-frame index only.
- **Reflections.** Opaque Standard / Physical surfaces smoother than ~0.42 roughness flag their reflectance (as a
  negative alpha, less what they emit); the pipeline marches them in screen space at half resolution (water,
  polished stone, wet ground). Misses keep the environment map's reflection. `#define MG_NO_SSR` on a material, or
  `premultipliedAlpha`, opts it out.
- **Volumetric light.** The key light through its shadow map (only toward a low sun, or near an ambient volume) and
  the 8 best lamps through the atlas scatter in a low dust layer, denser inside `setAmbientVolumes` boxes. Shafts
  only: an open, wholly lit ray lays no veil. Half resolution, jittered per sub-frame.
- **Bloom.** The frame is mixed toward its blurred self (7 % by day, 18 % at night) instead of the blur being added;
  the exposure is raised by what the additive bloom of `post.bloom` lifted, so mid-tones stay.
- **Cost** (hello-courtyard, 1440 x 900, 1 sub-frame + TAA, Apple silicon): about +1.5 ms at night with 4 lamps in
  view (mostly the lamps' in-scatter), +0.5 ms toward a low sun, ~0 at noon. Live tuning: `world.light2` (the
  same object as `world.pipeline.l2.cfg`): every field except `ls.slots`, `ls.tile`, `ls.cube`, `ls.perFrame`.
- Page-global once installed: the analytic DFG fit replaces three's lookup table for every Standard material under
  `FogExp2` on the page (a tiny difference in rough speculars of other worlds on the same page). One lamp-shadow
  atlas per page: the first light2 world owns it until disposed; a second one gets reflections, volumetric light
  and bloom but no lamp shadows (a console warning says so). Worlds without light2 publish no lamp slots.
- Install before the first compile: with `config.renderer` shared by an earlier world, programs that renderer
  compiled before light2 was installed are reused without it (three's program cache does not see chunk edits).

## Ambient-only AO, auto exposure, dynamic resolution (opt-in)

All three are off by default; off, frames are bit-identical to before.

- **`post.aoLit`** (0..1): SSAO darkens ambient light, not sunlight. The accumulation fades the occlusion on pixels
  whose exposed luminance says they are lit (sunlit plaster sits at about 0.25-0.5, shade at 0.05-0.2), so
  sunlit edges lose their grey halos while corners in shade keep them. A heuristic: a dark material in full sun
  keeps some AO. Free (one smoothstep).
- **`post.autoExposure`** (0..1, the share of the correction applied; 0.5 is a good start): the frame is metered
  into a 32 x 18 grid of centre-weighted log luminances, reduced to one EV on the GPU (no read-back) and applied
  in the grade, on top of the day-night exposure. Target: `aeKey` (the exposed log-mean by day; hello-courtyard's
  views average about 0.07), `aeNight` EV lower at full lamp level, at most `aeRange` EV either way. While moving
  the EV eases in log space, `aeDown` (darkening, 2.5/s) faster than `aeUp` (brightening, 1/s). A still frame is
  metered on its own, so it stays bit-identical (adaptation completes when the view stops; play's fade covers
  it). `world.resetExposure()` after a teleport. It changes the look of dim scenes most: a dawn courtyard
  (06:30) is lifted by about 0.8 EV at 0.5.
- **`dynamicRes`** (world option): while moving (`taa` frames), the interval between frames drives a render scale
  (`world.resolutionScale`, `min`..1 in `step`s): over 112 % of the budget, one step down; at budget for 2 s, one
  step up (a step up undone within 2 s doubles that wait, up to 32 s); a step down that did not shorten the
  frame (the CPU, not the pixels, is the limit) is undone and the scaler rests for 30 s. The grade pass stretches
  the smaller frame to the canvas and sharpens a little more. Each step reallocates the pipeline's targets and
  restarts TAA (a brief shimmer). Still frames always render at full size. The interval includes the page's own
  work and the display's refresh: on a 60 Hz display a 60 fps target can only be met, never beaten, so steps up are
  probes. An app with its own frame cap sets `world.dynamicRes.cap` (fps) so the cap is not read as a slow GPU;
  @miragekit/play does this from `maxFps` and the power saver. `pipeline.w / h` stay the output size; the render size
  is `pipeline.rw / rh`.
## Time-of-day grade (opt-in): `grade`

`createWorldRenderer({ ..., grade: true })` (or an object: `{ strength: 0.7, golden: { saturation: 1.3 } }`). Off,
the grade program is the plain one and a world renders bit-identical to before (hello-courtyard hero@golden,
basin@12:00, pergola@21:00, gate@17:22: 0 px against the commit before it).

- **What it does.** A look per hour, keyed by the sun's elevation: `night` (≤ −12°), `dusk` (−4°), `golden` (2–10°),
  `noon` (≥ 25°), eased between (`GRADE_PRESETS`). A look has an exposure (EV), temperature and tint (added to the
  white balance), saturation and contrast, `tonemapMix` (the AgX share of an ACES / AgX blend; null keeps
  `post.tonemap`), display-referred split toning (`shadowTint`, `hiTint`), an sRGB black point (`black`), an S-curve
  on luma (`curve`, hue kept), `punch` (the AgX branch steeper and more saturated: AgX-punchy), `clarity` (local
  contrast against the bloom's 1/16 blur), `highlightWarmth` (the bright end leans warm, as film's halation), a
  display-referred RGB `lift` and a display `gamma`. The lamps tint the highlights as they come on (`lampTint` by
  `light.lamp`). Ported from the Nizwa Golden Hour project's day-night grade and post (which descend from Golden Temple's); its
  lens flare and screen-space god rays are not (light2's volumetric shafts cover the latter).
- **Night.** `lightAt`'s exposure adapts the eye up to 40x at night, which lifts the whole frame; `nightAdapt` (0.45)
  takes back that share of it (in log: at 21:00 an exposure of 5 becomes 2.4). The lamps' gain follows the graded
  exposure, so they stay as bright while the walls go dark; with auto exposure on, its target moves with it (it does
  not undo the darker night).
- **Live.** `world.grade` (the settings; `strength` 0..1 mixes every term from neutral) is read every frame;
  `gradeAt(light, state, settings)` is the pure function behind it (`post.grade` carries the look to the pipeline, so
  a host driving `Pipeline` itself can pass one).
- **Cost** (Nizwa probe, 1440 x 900, Apple M4 Pro, GPU shared with other work, so ranges): the grade pass +0.04-0.1 ms
  (0.14-0.2 ms plain); `clarity` reads the bloom's blur for free, and draws a 1/16-size pass of its own (+0.07-0.3 ms)
  only when the bloom is off. Walking frames, 8 spots x 2 runs interleaved: 10.33 -> 10.43 ms mean, inside the noise.
- **Limits.** One set of looks for every view (no per-shot grade). The grade cannot make bounce light or a sky: on the
  Nizwa probe at 17:00 the sunlit plaster comes within about 0-20 levels of Nizwa's per channel (it was 32-40 levels
  short in red before), the shade stays greyer (no bounce) and the dusk sky stays Mirage's.

## Soft sun shadows (opt-in): `softShadows`

`createWorldRenderer({ ..., softShadows: true })` (or an object: `{ sunAngle: 1.5 }`). Off, nothing is patched and
a world renders bit-identical to before.

- **What it changes.** Still frames (`spp > 1`) always had soft sun shadows: the sun moves over its disc between
  the sub-frames. Walking frames (`taa: true`, one sub-frame each) had hard ones. With `softShadows` the sun stays
  put and each lit pixel finds its own penumbra from the sun's shadow map: sharp where a post meets the ground,
  wider the further the caster is from what it shades. Still and walking frames then look alike (measured on a
  plate's shadow edge, 10–90 %: 1.2 / 1.8 / 4.4 cm at 1 / 3 / 8 m above the ground in both, against 1.5 / 2.1 /
  4.3 cm for the sun-disc stills and ~1.3 cm everywhere for the walking frames before).
- **How.** A blocker search (the pixel and `blockerSamples` taps on a Vogel disc as wide as the widest penumbra;
  each blocked tap binary-searches its blocker's distance, `blockerSteps`, in log distance), penumbra = mean blocker
  distance x 2 tan(`sunAngle` / 2) clamped by `maxPenumbra` (m) and `maxPenumbraTexels`, then `filterSamples` PCF
  taps over it. Everything goes through three's comparison sampler (no second view of the map, no extra texture
  unit). Each tap's reference depth follows the receiver's plane (slope clamped by `slopeMax`) against acne; the
  shadow fades out over `edgeFade` of the map at its edge. The taps turn per pixel (interleaved gradient noise) and
  per sub-frame by a golden-ratio step of `k` in a still frame, of the TAA index while moving: the average and the
  history converge to a smooth penumbra, and still frames stay bit-identical between runs.
- **Settings.** `sunAngle` 0.53° is the real sun (and matches the old sub-frame jitter); larger reads softer, raise
  `maxPenumbra` with it (it caps the width and is the search's reach). Live: `world.softShadows` (`on`, `sunAngle`,
  `maxPenumbra`, …; `on: false` gives three's PCF and the old jitter back). The tap counts (8 / 5 / 12) are compiled
  in once per page, by the first world that installs them; a later world asking for others gets those (warning).
- **Cost** (hello-courtyard, 1440 x 900, 1 sub-frame + TAA, Apple M4 Pro, interleaved in one browser; see the
  example's NOTES): +0.55–0.85 ms against a page without it (frames of 2.8–3.3 ms), of which 0.15–0.35 ms is paid
  even with `on: false` in a page that installed it (the code is compiled in). 6 / 4 / 8 taps save about 0.12 ms.
- Only the first shadow-casting directional light (the world's sun) of Standard / Physical / Lambert / Phong
  materials under `FogExp2` takes this path; spot and point lights (light2's lamps too), other directional lights,
  other materials and `ShadowMaterial` keep three's PCF. Note: with `softShadows` on, the world no longer jitters the
  sun over its disc, so in still frames those other materials (`#define MG_NO_SS`, `fog: false`, custom lit shaders)
  get hard PCF shadows instead of the old sub-frame penumbra. Page-global once installed: another world without
  `softShadows` on the same page writes "off" before it draws, and every world switches the path off again after
  its frame (a host's own materials drawn later see the stock path). Mirage materials put a chunk-patch epoch in
  their program key, so a world on a renderer that already compiled the same hooks without the patch gets new
  programs (the same holds for light2).
- **Limits.** A caster much thinner than the search taps' spacing (palm leaflets) is found only by some taps:
  its penumbra is noisier per frame (the average converges). The blocker distance is a per-tap median, so
  overlapping casters at very different heights average to one penumbra (PCSS's usual approximation). Install
  before the first compile (as light2).

## The dusk sky (opt-in): `sky: { dusk }`

`createWorldRenderer({ ..., sky: { dusk: true } })` (or `{ dusk: { haze: 2.5, night: 0.5, airglow: 1, cover: 0.5 } }`).
Off, the sky's shaders are the same text as before and every frame is bit-identical. Made for the hours the default
sky is weakest at: after sunset it is a flat bright blue with a hard horizon, black below it where no ground
reaches.

- **Air** (baked into the sky's direction tables per `setTime`, so no per-pixel cost): the aerosol x `haze` (a
  paler, softer horizon by day, a wide warm glow round a low Sun or Moon); multiple scattering lit by the light
  that reaches each point just above its own elevation (reddened at sunset, gone in Earth's shadow) plus a quarter
  of the old day-blue term. Day skies change little; twilight gets a warm horizon under the set Sun, a blue-grey
  Earth's shadow and a pink band above it, then a blue hour, and is darker than before (about a third from 2° below
  the horizon on: the image-based light follows, so a scene at dusk is darker too).
- **Night**: the airglow brightens toward the horizon (it shines from a shell ~90 km up). The dome as seen is x
  `night` once the Sun is 10° down (ramping from 2°): a moonlit sky reads as night instead of a day sky at a high
  exposure. Environment captures keep the dome as lit, so the light the night sky gives is unchanged.
- **Below the horizon**, where no ground reaches: the horizon's air, then what the world's haze makes of far
  ground (fog.js's in-scatter at infinite distance, colour and glow toward the light), so the far edge of a ground
  plane meets the sky without a black band.
- **Clouds**: altocumulus (coverage patches stretched along the wind, puffy cells of two cell-noise scales),
  self-shadowed by four taps toward the light, forward / back scattering, powder and a silver lining; lit by the Sun,
  by the Moon once the Sun is 4° down, thinner and sky-lit without sunlight. `cover` (0.5) applies when the world's
  `clouds` is not given; they drift with the scene clock as before (still frames stay bit-identical).
- **Cost** (nizwa-probe, 1440 x 900, one sub-frame + TAA, Apple M4 Pro shared with other jobs, off and on interleaved,
  3 rounds): the clouds are the only per-pixel part, +0.2–0.4 ms (min of the rounds) with the sky filling the frame,
  within the noise on a street view; `setTime` (the table bake) 0.34 -> 0.36 ms. Load: one more sky program.
- Techniques (the altocumulus cells, the night cloud look, the below-horizon fill) ported from the author's own
  Nizwa engine; the probe that asked for it: `probes/nizwa-probe` (`?sky=dusk`), hello-courtyard `?sky=dusk`.

## Materials: `world.mat`

`mat.std(params, hooks)`, `mat.phys(params, hooks)`, `mat.patch(material, hooks)`, `mat.depth(hooks)` (a shadow
depth material with the same vertex hooks), `mat.glow(rgb, intensity)` (an emissive lamp that follows day/night).
`PROC.plaster | stone | wood | terracotta | brushed | hammered | patina` return hook sets (the metals: below). Hooks (GLSL strings): `vertexDecl`, `vertexWorld`
(edit `vec3 mgWorld`), `fragmentDecl`, `albedo` (`diffuseColor`), `roughness`, `metalness`, `normal` (view
space; `normal = mgBump(normal, height, strength)`), `emissive`, `lighting` (`reflectedLight`), `output`
(`outgoingLight`), plus `uniforms` and `defines`. In scope: `mgWorldPos`, `mgWorldNormal`, the `G` uniforms
(`uTime, uWind, uKeyDir, uKeyColor, uLamp, uLampGain, uSkyLight, uNight, uUser, uFrame`) and the noise
library (`mgHash, mgHash3, mgValue2/3, mgGrad2/3, mgFbm2/3, mgRidge3, mgCell2/3, mgTriWeights, mgLuma`).

### Metals: `PROC.brushed`, `PROC.hammered`, `PROC.patina`

```js
const steel = world.mat.std({ metalness: 1, roughness: 0.3 }, PROC.brushed());                 // axis 'x', scale 1, wear 1
const pan = world.mat.std({ metalness: 1, roughness: 0.22 }, PROC.hammered('vec3(0.78, 0.45, 0.3)')); // size 0.035 m
const roof = world.mat.std({ metalness: 1, roughness: 0.3 }, PROC.patina(undefined, { amount: 0.5 })); // copper
```

Procedural like the others (world-space noise, one `mgH` for the bump, at most one PROC per material); put them on a
material with `metalness: 1`, `base` is the metal's reflectance (linear). Under Mirage's captured sky a metal is
mostly its reflection, so the pattern lives in the roughness and the normal more than in the colour.

- **brushed** (`axis` 'x' | 'y' | 'z', `scale`, `wear`): streaks (millimetres apart) and hairlines stretched along
  the axis; the streaks tilt the normal across the brushing only, so highlights smear across it (an anisotropic look
  without tangents); hairlines fade before they alias; `wear` adds smudges (rougher, a little darker).
- **hammered** (`size` 0.035 m, `depth` 1): overlapping dimples from a 3D cell noise, polished ridges where two meet,
  hollows a little rougher and darker.
- **patina** (`amount` 0..1, `verdigris` colour): verdigris on copper (bronze: `'vec3(0.55, 0.38, 0.2)'`) gathering
  on top faces and running down walls; where it is, the surface is rough (0.88) and not metallic; the bare metal is
  oxidised darker.

Stills of each on a sphere and a panel (plain, brushed, hammered copper, patina: [metals.jpg](../../docs/media/looks/metals.jpg)):
`node packages/tools/looks.check.mjs` (`metals.png`). Cost: not measured
(one to three fbm / cell lookups per pixel, like `stone`).

## Reduced motion (opt-in): `world.setReducedMotion`

`world.setReducedMotion(true | { sway, rain } | false)` (or the `reducedMotion` option): while a frame renders the
wind's strength is scaled by `sway` (0.25; every `mgWind` and `uWind` sway reads it), the rain kit falls at `rain`
x its speed (0.4: slower, shorter streaks; kits read `world.ctx.motion`), and the still path's default shutter is
0 (no motion blur across the sub-frames; an explicit `shutter` still wins). `world.reducedMotion` is the settings in
use or null. No shader changes: with it off the frames are bit-identical (hello-courtyard,
walled-garden, woodland-path, river-ford: 23 views, 0 px). @miragekit/play follows the user's `prefers-reduced-motion` (its `reducedMotion` option). Measured in
`looks.check.mjs` (a fur lawn in a 1.5 x wind): the image change between T = 0 and 1.7 s drops from 3.9 to 1.5 /255
per channel; rain 8.5 -> 3.4 m/s.

## Transparent stills: `world.renderTransparent(T, opts)`

A still with a transparent sky: the frame is rendered twice, sky and stars hidden, over a black and over a white
background (`pipeline.clearColor`), both summed in linear HDR over the same sub-frames, so each pixel's sum is linear
in the background: alpha = 1 - (white - black) / K (normalised by the sub-frames' weight sum) and the straight colour
= black / alpha, graded as usual (the grade's `CLEAR` variant, illos.dev's trick; the default grade program is left
untouched). Returns `{ width, height, data }`: RGBA8, straight alpha, top row first. Options: renderFrame's still
path (`spp`, `frameIndex`, `camera`, `shadow`, `shutter`). The object's own bloom is kept (added after the
un-premultiply, so it does not flare at thin edges); the sky's glow over it is not; no auto exposure. Terrain and
anything else drawn stays opaque; additive effects over the sky (rain) and clouds vanish. `mirage-snap --alpha` saves
every viewpoint this way, `play.render({ transparent: true })` renders the current view.

Checked on a torus knot and a sphere in empty air ([alpha.png](../../docs/media/looks/alpha.png)) (`looks.check.mjs`, 960x540, spp 16): background alpha 0 (the
corners and 77 % of the frame), the object 255, the 6,887 partial pixels all within 2 px of an edge; opaque pixels
match the normal still over black to 0.01/255, edge pixels composited over black to 0.7 % in linear light (not
exactly: the tone map is not linear). Cost: two stills plus a read-back (walled-garden 1440x900, spp 16: 436 / 650 ms
against 304 / 70 ms for the normal still, on a shared GPU).

## Textures (optional): `createTextures(world, { manifest, url })`
## Textures (optional): `createTextures(world, { manifest, url, decode, ktx2 })`

World-space sampling of photo-scanned PBR sets from patch() hooks; the project ships the files and the manifest
(`packages/tools/tex/pack.py` fetches CC0 sets from Poly Haven and packs them; see `examples/hello-courtyard/tex`).

```js
import manifest from './tex/manifest.json';
const urls = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['./tex/' + f] });
const stone = tex.material('ashlar', { mapping: 'wall', tint: [0.56, 0.47, 0.37], detail: 1.1 });   // 'tri' | 'wall' | 'ground'
const mine = world.mat.std({ roughness: 0.9 }, tex.hooks(['plaster'], {
  fragmentDecl: 'MgTex mgS;',
  albedo: 'mgS = mgTexWall(MG_TEX_plaster, mgWorldPos, normalize(mgWorldNormal), 0.0, 1.0); diffuseColor.rgb *= mgTexTint(mgS, vec3(0.8, 0.7, 0.55), 1.0);',
  normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
}));
await tex.ready();   // before world.prepare()
```

GLSL: `mgTexTri | mgTexWall | mgTexGround(MG_TEX_name, p, wn, tile, strength)` -> `MgTex { albedo, n, h, r, mean }`,
`mgTexTint`, `mgTexNormal`, `mgTexBlend` (height-aware mask). Every tap uses `textureGrad` with the projection's
own derivatives and a repetition breaker; every patched Standard / Physical material gets specular AA
(`mgSpecAA`).

## Close-range relief (optional): `relief.js`

Walls and floors that hold up at 1–3 m. Nothing is compiled into a material unless it opts in, so worlds that do
not ask for it build exactly the shaders they did before.

```js
import { setRelief, PROC, renderHeight, renderShade } from '@miragekit/core';
const paving = tex.material('paving', { mapping: 'ground', relief: 0.025 });         // depth (m) of the relief
const render = tex.material('plaster', { mapping: 'wall', relief: 0.024, render: 0.009 });   // + hand-applied render
const lime = world.mat.std({ roughness: 0.9 }, PROC.plaster(undefined, { render: 0.009 }));  // [und, swipe] also
const mine = world.mat.std({}, tex.hooks(['plaster'], {
  fragmentDecl: 'MgTex mgS;',
  albedo: 'mgS = mgTexWallRelief(MG_TEX_plaster, mgWorldPos, normalize(mgWorldNormal), 0.0, 1.0, 0.024); diffuseColor.rgb *= mgS.albedo;',
  normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
}, { relief: true }));                   // adds the relief GLSL, its uniforms and the self-shadow on direct light
setRelief(0.7);                          // 0 off (one uniform test), 1 full: fade 0.6·8 … 8 m; 0.7 → 5.6 m
```

- **Texture relief** (`relief: depth`, `mgTex{Tri,Wall,Ground}Relief(MG_TEX_x, p, wn, tile, k, depth)`): one
  parallax step on the set's own height (B channel), sampled again at the shifted point with the UNSHIFTED
  gradients (`textureGrad`, derivatives taken once in uniform flow), so the mip level never jumps and TAA stays
  stable; then one more height read toward the key light (`uKeyDir`, capped at 7 cm sideways) gives the relief's
  own shadow, applied to the direct light (`RELIEF_LIGHT` in `lighting`). It scales all direct light, so it only
  acts while the key light shines (above the horizon) and fades out as the lamps come on (`uLamp`). Back faces of
  DoubleSide materials are cut from the side seen. The repetition breaker's patch choice is made once per fragment.
  Faded out between 4.8 and 8 m, off in orthographic cameras (the game view) and with `setRelief(0)`.
- **Render relief** (`render: undulation`, `PROC.plaster(base, { render })`, or `renderHeight` + `renderShade` in your
  own hooks): a hand-applied render's slow undulation (~0.5 / 0.22 m) and overlapping trowel swipes (0.7× the
  undulation), a real-slope bump in metres plus a little shade in the hollows, on the three axis planes blended by
  the normal (curved surfaces do not stripe); full to half the relief's reach, gone by 1.25× it (4–10 m at full).
- **GLSL helpers** (`RELIEF_GLSL`, `withRelief(hooks)` to include them): `mgRlFade`, `mgRlShift`, `mgRlSunProbe`,
  `mgRlSelfShadow`, `mgRlRenderH`, `mgRlRenderK`, and for recesses and corners `mgRlGradQ` + `mgRlLip` (a lip's
  cast shadow and edge occlusion from a mask field's screen derivatives) and `mgRlArris` (0 on a face, 1 across a
  rounded corner); the last three are not used by any example yet.
- **Geometry** (`geom`): `wall({ …, round })` chamfers (45°) every arris inside the plain wall's bounds (faces inset,
  sides exact: walk grids do not change); the chamfer shrinks to 0.35× the narrowest strip of wall (an opening near
  the top, an end, another opening) and the foot's is cut below ground. `softExtrude(shape, depth, r)` is the raw
  tool: keep r under ~0.35× the shape's narrowest strip or the inset contours fold; `softBox(w, h, d, r)` (parts under 12 cm
  stay sharp); `sootPlumes([{ pos, rotY | normal, scale, up }])` multiply-blended soot above lamps (no depth writes,
  no shadows, ignored by the walk grid and SSAO).
- **Cost** (hello-courtyard, 1440×900, Apple M4 Pro, uncapped, A/B against `?nodetail` on a shared GPU): walk view
  +5…9 %, game view +2…4 %, 1–3 m from a wall that fills the screen +0.4…0.6 ms (+10…17 %); details in
  `examples/hello-courtyard/NOTES.md`. ponytail: the uniforms are shared by every world on a page.
- **Not ported**: the source's automatic rewrite of library calls into relief calls; materials opt in explicitly.

## Wet surfaces and rain (opt-in): `wet.js`

Rain-wet ground and walls, puddles and rain rings on any Standard / Physical material's hooks. Nothing is compiled
into a material unless it opts in, and an opted-in material compiles its wet code only while the wetness is above 0.

```js
import { withWet, setWetness, setRain } from '@miragekit/core';
import { addRain } from '@miragekit/world/kits/rain';
const paving = tex.material('paving', { mapping: 'ground' });
world.mat.patch(paving, withWet(paving.userData.hooks, { porosity: 0.5, height: 'mgS.h', heightMid: tex.info('paving').hMean }));
const lime = world.mat.std({ roughness: 0.9 }, withWet(PROC.plaster(), { porosity: 0.85, puddles: 0 }));
setWetness(0.8);                  // 0 dry (off) .. 1 full puddles; page-global
setRain(1);                       // 0 .. 1: rings on standing water, and the streaks' density
addRain(ctx);                     // falling streaks around the camera (a world kit, one draw call)
```

- **One ramp** per fragment, s = 0 dry → 1 damp → 2 soaked → 3 standing water, rising with `setWetness`. Damp:
  darker and a little more saturated (`porosity` 0..1: porous plaster ~0.85, paving ~0.5, sealed ~0.1; metals only
  get smoother), roughness 0.42–0.56. Soaked: a water film, roughness 0.1–0.2, the micro relief partly filled.
  Standing water: level (normal up), roughness ~0.05, the wet bed visible at a shallow rim and murkier with depth
  (never black).
- **Where**: up-facing surfaces soak from the low spots up and pool where they are level: a world-space height field
  (pools ~2 m apart, shorelines at ~40 / 15 / 5 cm) plus an optional height of the material (`height: 'mgS.h'`
  about `heightMid`, `heightScale` m per unit: the paving's joints fill first). Vertical surfaces get thin run-off
  streaks, undersides stay dry, a damp band rises `band` m from the ground (`ground`: a height, an Object3D or a
  horizontal THREE.Plane). `puddles`: 0 none, 1 default, more fuller.
- **Reflections**: without light2 the puddles reflect the environment map. Under light2 only standing water is
  flagged for screen-space reflection: the soaked film keeps its low roughness for the image-based light and the
  sun but is floored at 0.42 for the flag (light2's threshold), so damp ground is a sheen, not a second mirror.
- **Rain rings**: a sparse cell layer (two scales, ~2 cm waves, a drop per cell per cycle at a hashed spot), a
  normal perturbation on standing water only, from `uTime` alone (stills are identical on every run). They fade
  where a pixel covers more than ~1 cm and the pool reads rougher instead.
- **Stability**: octaves finer than the pixel footprint fade out, shorelines are antialiased by the height's screen
  derivative, far pools thin to a soaked sheen, and patch()'s specular AA widens the lobe where the normal varies
  (a material that had none gets it only while wet: `hooks.specAA`).
- **Off**: the wet code sits inside `#ifdef MG_WET`; `setWetness` sets the define on the opted-in materials (and
  only them) while the level is above 0 and recompiles them when it crosses 0, like `setAmbientVolumes`; moving
  between levels above 0 recompiles nothing. At `setWetness(0)` the program is the dry one: hello-courtyard's frames
  are bit-identical with `?wet=0` (5 views, 0 px). The two uniforms (`WET`) are page-global, not in the world's `G`.
- **Changing it live**: `world.tick(dt)` notices `setWetness` / `setRain` (and returns true, so @miragekit/play draws
  again); a wetness change recaptures the image-based light from scratch, so `setWetness(0)` after a wet spell
  gives the dry image exactly and wet puddles reflect a wet world. Without tick(), call `world.captureEnv(true)`
  after clearing `scene.environment`, and draw. Set the levels only through `setWetness` / `setRain`: writing
  `WET.uWet.value` directly skips the define and the change counter. Crossing 0 recompiles the wet materials on
  the next frame (a hitch). `WET_GLSL` is withWet's internal code (inside `#ifdef MG_WET`), not usable alone.
- **Faces**: DoubleSide and BackSide materials get wet on the face being seen (the underside of a two-sided slab
  stays dry). Re-applying `withWet` to hooks it returned re-wraps the dry hooks (new options, no second layer).
- **Cost** (hello-courtyard, 1440×900, Apple M4 Pro shared with other jobs, walking from the spawn, 1 sub-frame +
  TAA, dry / wet / wet + rain interleaved in one page): wet 0.8 +0.15…0.57 ms median (+2…5 %), rain streaks
  +0.0…0.25 ms more and one draw call. TAA shimmer on an orbit over the paving: flicker / motion unchanged (1.40 dry,
  1.40 wet). Details in `examples/hello-courtyard/NOTES.md`.
- **Limits**: no occlusion from above (the ground under a pergola or an arcade gets as wet as the open court; give
  such materials their own `withWet` options or none); no splashes, drips or wet-darkened foliage; the ripples are
  normals only (no refraction of the bed); `ground` is read once (an Object3D moved later needs the material
  re-made, or `hooks.uniforms.mgWetP.value.y` set). ponytail: the uniforms are shared by every world on a page.

## Seamless loading (opt-in): decode, upload, warm-up, streaming helpers

For worlds that load more while they run (a street, then an interior, no loading screen). Nothing here is on by
default; with every option off the engine draws exactly what it did (stills compared byte for byte). Measured by
`node examples/demos/streaming/streaming-check.mjs` (A/B, interleaved, a cold browser per page): numbers in the
changelog (1.0.0, **New**).

```js
const tex = createTextures(world, { manifest, url, decode: 'bitmap' });   // decode off the main thread
await world.prepare({ warm: true });                                     // one discarded frame + 1-px readback
const up = createUploadBudget(world.renderer, { bytes: 8 << 20 }).add(tex.textures());   // or: upload over frames
// per frame, before the draw: up.step();
```

- `createTextures({ decode: 'bitmap' })`: `fetch` + `createImageBitmap` (three's `ImageBitmapLoader`) decode the
  images off the main thread; the `<img>` path decodes each one on the main thread when three first uploads it.
  Same pixels: flipped while decoding (`imageOrientation: 'flipY'`), straight alpha, no colour conversion, as three
  uploads these `<img>` textures. Falls back to the image loader where `createImageBitmap` is missing or fails.
- `createTextures({ ktx2 })`: manifest files ending in `.ktx2` (ETC1S / UASTC, made with `basisu -ktx2 -mipmap -y_flip`,
  normal maps `-linear -normal_map`) load through three's KTX2Loader from `@miragekit/core/ktx2`
  (`createKTX2Loader(renderer, { transcoderPath })`); serve `three/examples/jsm/libs/basis/basis_transcoder.{js,wasm}`.
  A subpath on purpose: a bundle that never imports it has no KTX2Loader and no transcoder.
- `world.prepare({ warm: true })`: `compileAsync` links the programs, but the first frame still pays texture
  uploads (and `<img>` decodes), the shadow map's allocation and the first draw of each program. The warm-up draws
  one still frame (one sub-frame) to the canvas, waits for the GPU with a 1-px readback, clears the canvas and puts
  back every per-frame history (TAA, auto exposure, dynamic resolution), so the next frame is the same as without it.
- `createUploadBudget(renderer, { bytes, count })`: `renderer.initTexture` spread over frames (at least one a frame).
- `createJobQueue`, `createLRU`, `objectBytes`, `texturesOf`, `disposeObject`: the parts of `@miragekit/world`'s
  `createStreamer` (modules streamed in and out by distance), usable on their own.
- `watchLongTasks()`: long tasks (PerformanceObserver) from now until `stop()`.

## Rules learnt the hard way

- Every sampling pattern (AA offset, shutter time, sun-disc point, SSAO rotation) depends on the sub-frame index
  only, never on the frame number: a still camera gives identical frames; only grain/dither use `frameIndex`.
- Mirage's fog, and its fixed shadow-filter rotation, compile only under `THREE.FogExp2`. A scene with
  `THREE.Fog` or no fog renders exactly as stock three.js, so other scenes on the page are unaffected.
- The fog uniforms are page-global (three's shader chunks are); each world writes its own before it draws.
- Use `rng('<name>')`, never `Math.random`: every load builds the same world.
- Full-screen passes that accumulate must not let `renderer.render()` auto-clear their target (M1 did: a frame
  was its last sub-frame only).
- Patch three's materials instead of writing `ShaderMaterial`s, so shadows, fog and image-based light keep working.

## Also exported

`skyAt(date, place)`, `placeDate(day, time, tzHours)`, `placeClock(date, tzHours)` (astronomy, pure JS);
`skyState`, `lightAt` (pure light model); `GRADE_PRESETS`, `gradeConfig`, `gradeAt` (the time-of-day grade); `transmit`, `scatter`, `skyLightAt` (the atmosphere on the CPU);
`createSky`, `createStars`, `Pipeline`, `installFog`, `LIGHT2_DEFAULTS`, `light2Config`, `installLight2`, `addLampSource`, `LampShadows`, `SOFTSHADOW_DEFAULTS`, `softShadowConfig`, `installSoftShadows`, `createLod`, `deviceProfile`, `createEnvLight`, `TEX_GLSL`,
`geom.*`, `NOISE_GLSL`.
`npm test -w @miragekit/core` runs `check.mjs`.

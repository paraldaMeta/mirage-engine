# @mirage/core

The rendering core of Mirage: a physical sky, aerial perspective inside every material, a key light (Sun by
day, Moon by night) with fitted soft shadows, image-based light captured from the built world, a sub-frame
accumulation pipeline (anti-aliasing, motion blur, soft shadows, clean SSAO, depth of field), temporal AA for
moving cameras, tone mapping and grade, an optional world-space texture layer for CC0 PBR sets, the
`patch()` material-hook system with a GLSL noise library, seeded randomness, geometry helpers, an LOD helper and
day/night for any place and time. Peer dependency: `three >=0.186.1 <0.187.0`. ES modules, no build step.

The root renderer lifecycle and all current JS subpaths have candidate declarations, pending off-machine compilation.
See [coverage and off-machine validation](../../docs/TYPES.md) and [resource ownership](../../docs/LIFECYCLE.md).

```js
import { createWorldRenderer, PROC } from '@mirage/core';

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
| `post` | `DEFAULT_POST` | `exposure (0.4), temperature, saturation, contrast, lift, vignette, tonemap ('aces' \| 'agx' \| 'neutral'), sharpen, grain, bloom, bloomRadius, ao, aoRadius, aoPower, sky, dof (lens radius m, 0 = off), focus (m)` |
| `spp` | per quality | sub-frames per frame |
| `wind` | `{ dir: [0.8, 0.6], strength: 1 }` | for `mgWind()` in vertex hooks |
| `clouds` | `0.35` | cloud cover 0..1 |
| `shadowMapSize`, `mobile`, `preserveDrawingBuffer` | | overrides |
| `light2` | off | `true` or `{ ls, ssr, vol, bloom }` overriding `LIGHT2_DEFAULTS` (each part `false` to drop it): lamp shadows, screen-space reflections, volumetric light, mixed bloom (see below) |

Returns `{ renderer, scene, camera, sun, sky, stars, pipeline, ctx, G, keyDir, mat, geom, rng, post, device,
light, state, exposure, setTime(time, { ease }), tick(dt), prepare(), renderFrame(T, opts), resize(w, h), dispose(), captureEnv(),
setAmbientVolumes(list) }`.

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
  worlds without them render exactly as before. `@mirage/world` passes modules' `ambientVolumes` here.
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

## Materials: `world.mat`

`mat.std(params, hooks)`, `mat.phys(params, hooks)`, `mat.patch(material, hooks)`, `mat.depth(hooks)` (a shadow
depth material with the same vertex hooks), `mat.glow(rgb, intensity)` (an emissive lamp that follows day/night).
`PROC.plaster | stone | wood | terracotta` return hook sets. Hooks (GLSL strings): `vertexDecl`, `vertexWorld`
(edit `vec3 mgWorld`), `fragmentDecl`, `albedo` (`diffuseColor`), `roughness`, `metalness`, `normal` (view
space; `normal = mgBump(normal, height, strength)`), `emissive`, `lighting` (`reflectedLight`), `output`
(`outgoingLight`), plus `uniforms` and `defines`. In scope: `mgWorldPos`, `mgWorldNormal`, the `G` uniforms
(`uTime, uWind, uKeyDir, uKeyColor, uLamp, uLampGain, uSkyLight, uNight, uUser, uFrame`) and the noise
library (`mgHash, mgHash3, mgValue2/3, mgGrad2/3, mgFbm2/3, mgRidge3, mgCell2/3, mgTriWeights, mgLuma`).

## Textures (optional): `createTextures(world, { manifest, url })`

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
import { setRelief, PROC, renderHeight, renderShade } from '@mirage/core';
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
import { withWet, setWetness, setRain } from '@mirage/core';
import { addRain } from '@mirage/world/kits/rain';
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
- **Cost** (hello-courtyard, 1440×900, Apple M4 Pro shared with other jobs, walking from the spawn, 1 sub-frame +
  TAA, dry / wet / wet + rain interleaved in one page): wet 0.8 +0.15…0.57 ms median (+2…5 %), rain streaks
  +0.0…0.25 ms more and one draw call. TAA shimmer on an orbit over the paving: flicker / motion unchanged (1.40 dry,
  1.40 wet). Details in `examples/hello-courtyard/NOTES.md`.
- **Limits**: no occlusion from above (the ground under a pergola or an arcade gets as wet as the open court; give
  such materials their own `withWet` options or none); no splashes, drips or wet-darkened foliage; the ripples are
  normals only (no refraction of the bed); `ground` is read once (an Object3D moved later needs the material
  re-made, or `hooks.uniforms.mgWetP.value.y` set). ponytail: the uniforms are shared by every world on a page.

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
`skyState`, `lightAt` (pure light model); `transmit`, `scatter`, `skyLightAt` (the atmosphere on the CPU);
`createSky`, `createStars`, `Pipeline`, `installFog`, `LIGHT2_DEFAULTS`, `light2Config`, `installLight2`, `addLampSource`, `LampShadows`, `createLod`, `deviceProfile`, `createEnvLight`, `TEX_GLSL`,
`geom.*`, `NOISE_GLSL`.
`npm test -w @mirage/core` runs `check.mjs`.

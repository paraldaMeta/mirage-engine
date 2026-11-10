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
  the flame does not shadow it. Lamp tables that are not PointLights: `addLampSource(scene, (camPos) => [{ x, y, z,
  range, power }])`, and call `mgLsVis(lampWorld, pWorld, nWorld)` in your shader.
- **Reflections.** Opaque Standard / Physical surfaces smoother than ~0.42 roughness flag their reflectance; the
  pipeline marches them in screen space at half resolution (water, polished stone, wet ground). Misses keep the
  environment map's reflection. `#define MG_NO_SSR` on a material opts it out.
- **Volumetric light.** The key light through its shadow map (only toward a low sun, or near an ambient volume) and
  the 8 best lamps through the atlas scatter in a low dust layer, denser inside `setAmbientVolumes` boxes. Shafts
  only: an open, wholly lit ray lays no veil. Half resolution, jittered per sub-frame.
- **Bloom.** The frame is mixed toward its blurred self (7 % by day, 18 % at night) instead of the blur being added;
  the exposure is raised by what the additive bloom of `post.bloom` lifted, so mid-tones stay.
- **Cost** (hello-courtyard, 1440 x 900, 1 sub-frame + TAA, Apple silicon): about +1.5 ms at night with 4 lamps in
  view (mostly the lamps' in-scatter), +0.5 ms toward a low sun, ~0 at noon. Live tuning: `world.pipeline.l2.cfg`.
- Page-global once installed: the analytic DFG fit replaces three's lookup table for every Standard material under
  `FogExp2` on the page (a tiny difference in rough speculars of other worlds on the same page).

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

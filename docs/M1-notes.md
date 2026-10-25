# M1 notes — the rendering core

M1 delivers `packages/core` (`@mirage/core`) and `examples/hello-courtyard`. Everything that came from Golden
Temple's code was **rewritten**, not copied: new structure, names, GLSL and algorithms where practical. Code
from the author's own later work in an earlier project was **adapted**. Nothing place-specific from that project is in the repo.

## Where each subsystem came from

| subsystem | status | file(s) in core | earlier-project file consulted |
|---|---|---|---|
| physical sky (atmosphere, sun disc, Moon disc, clouds, night glow) | rewritten | `atmosphere.js`, `sky.js` | `src/core/sky.js` |
| atmosphere on the CPU (light colours, sky irradiance, haze colour) | rewritten | `atmosphere.js` | `src/core/daynight.js` (its CPU sky port, itself Golden-Temple-derived) |
| aerial perspective / height fog in every material, fixed PCF rotation | rewritten | `fog.js` | `src/core/fog.js` |
| key light + fitted soft shadows | rewritten | `world.js` (`fitShadow`) | `src/core/lighting.js`, `src/main.js` |
| environment capture (image-based light) | rewritten | `world.js` (`captureEnv`, three's `PMREMGenerator.fromScene`) | `src/core/lighting.js`, `src/core/envlight.js` |
| sub-frame accumulation (AA, motion blur, soft shadows, SSAO average), tone map, grade | rewritten | `post.js`, `world.js` (`renderFrame`) | `src/core/post.js`, `src/main.js` |
| material hooks `patch()`, generic PROC surfaces | rewritten | `materials.js` | `src/core/materials.js` |
| GLSL noise library | rewritten | `noise.js` | `src/core/glsl.js` |
| seeded RNG | rewritten | `rng.js` | `src/core/rng.js` |
| geometry helpers (+ new: `wall()` with arched openings, `archPath`, `taperedTube`) | rewritten | `geom.js` | `src/core/geom.js` |
| shared uniforms per world (`G`), wind | rewritten | `env.js` | `src/core/env.js` |
| world boot / config API | rewritten | `world.js` | `src/main.js`, `src/embed.js` |
| day/night light model | rewritten (pure functions) | `daynight.js` | `src/core/daynight.js` |
| Sun / Moon / sidereal astronomy | adapted from own project | `sky-time.js` | `src/core/sky-time.js` |
| stars (catalogue + faint field) | adapted from own project | `stars.js` | `src/core/stars.js` |
| LOD twins (meshoptimizer) | adapted from own project | `lod.js` | `src/core/lod.js` |
| device profile | adapted from own project (slimmed) | `device.js` | `src/core/device.js` |
| headless verification | new | `examples/hello-courtyard/scripts/verify.mjs` | — (Golden Temple's `tools/snap.mjs`, `lib/chrome.mjs` not used) |

Techniques kept (ideas, not code): sub-frame patterns depend only on the sub-frame index; fog and the fixed
shadow-filter rotation only under `FogExp2`; typed-array uniforms shared through three's ShaderLib; patching
three's materials instead of ShaderMaterials; per-material hook points; named seeded generators.

## Renamed / changed

- the hard-coded place and its date helpers → `place` config, `placeDate(day, time, tzHours)`, `placeClock(date, tzHours)`;
  `skyAt(date, place)` now requires a place.
- Global singletons (`ENV`, `G`, `sunDir`, `SKY_UNIFORMS`, `GRADE`, lamp registries) → per world:
  `createEnv()` returns `G` and `keyDir`; `createSkyUniforms()`; lamps are a uniform (`uLampGain`) instead of a
  registry. The fog state stays page-global (three's chunks are), written by each world before it draws.
- Uniform and hook names: `uSunDir/uSunColor` → `uKeyDir/uKeyColor` (it is the Moon at night); `vWPos/vWNrm` →
  `mgWorldPos/mgWorldNormal`; noise `n_*` → `mg*`; hooks `fragColor/fragRough/…` → `albedo/roughness/normal/…`;
  `windOffset` → `mgWind`; `Builder` → `MeshBatch`; `mat4` → `compose`; `materials()` set → none (PROC only).
- Atmosphere: optical depth toward the light is analytic (Chapman approximation) instead of a nested march.
- Bloom is three's `UnrealBloomPass`; tone mapping is three's own ACES / AgX / Neutral functions.
- AA offsets use the R2 sequence (was Halton); the shutter permutation is a coprime stride.

## Left out of M1, and why

- **Texture library (`textures.js`)**: M1b. It is the author's own code and will become an optional module
  with a project-supplied manifest; no texture files are copied. Not needed by the example.
- **Irradiance volume (`irradiance.js`)**: M1b. Its grid, kept modules and global 3D target were built for one
  town; it needs a config-sized volume and a scene filter.
- **Environment light keys / cross-fade (`envlight.js`)**: replaced by `PMREMGenerator.fromScene` twice (one
  bounce) on every `setTime()`. Enough for a still time of day; a running clock needs the cross-fade back.
- **Smooth running clock** (`setDate` easing, eye adaptation over time): the controller is now pure
  `skyState` + `lightAt`; animate by calling `setTime()`.
- **Depth of field, god rays, volumetric light, lens flare, temporal AA**: not in the M1 list; TAA belongs to
  `play` (M2, from the author's `walk.js`).
- **Ambient volumes** (sky-light occlusion boxes): no interior in the example; add when one appears.
- the earlier project's regional material set, layout, shots and town modules: project content, not engine.
- **Milky Way band**: stars only.

## Verification (this Mac: Apple M4 Pro, ANGLE Metal, Chrome headless)

- `npm install` at the root: ok (0 vulnerabilities). `npx vite build` in the example: ok (840 kB, 222 kB gzip).
- `npm test -w @mirage/core`: ok (rng determinism, solar noon at Kyoto, golden-hour exposure = 1, Moon as key
  light at night, wall with openings, arch end points). LOD helper smoke-tested in node.
- `node scripts/verify.mjs <dir>` (built `dist/` via `vite preview`, 1440×900, spp 6): no console errors or
  warnings in any view. Still camera, two consecutive renders:
  - same `frameIndex`: max difference **0**, 0 differing channels (every view);
  - next `frameIndex`, grain on: max **6–7**/255 (grain, by design);
  - next `frameIndex`, grain 0: max **1**/255 (the ±½-LSB dither only).
- Frame time at 1440×900 (synchronous, `readPixels` after each frame, mean of 12): **3.0–3.4 ms** at 1
  sub-frame, **13.9–16.7 ms** at 6 sub-frames (the still-view default).
- Screenshots: golden (fixed), Kyoto 16:50, 12:00, 22:00 (full Moon), 21:00 on 2026-11-09 (moonless).

## Size (lines)

| package | lines |
|---|---|
| `packages/core/src` (16 files) | 2264 (stars.js 356, of which ~240 are the star catalogue) |
| `packages/core/check.mjs` | 24 |
| `examples/hello-courtyard` (main.js 161, index.html, vite.config.js) | 177 |
| `examples/hello-courtyard/scripts/verify.mjs` | 74 |

## Open problems for M2

- A running clock: environment cross-fade (bring back the keyed `envlight.js`) and eased exposure; today each
  `setTime()` recaptures twice (~ms at 128–256², but it stalls a frame).
- Temporal AA for moving cameras (spp 1 while orbiting aliases); port from `walk.js` into `play`.
- The single-scattering sky is still a little dark/saturated against the ground at noon; tuned by
  `envIntensity` and exposure, a better multiple-scattering term would fix it at the source.
- Night exposure is clamped at 40× on moonless nights; lamps need a real example (point lights + glow) to tune
  `uLampGain`.
- Fog uniforms are page-global: two worlds drawn in one frame must render one after another (they do), but a
  world that renders inside another's frame would need to restore the state.
- Texture library and irradiance volume (M1b), then `world` (site plan, modules, anchors) and `play`.

---

# M1b — textures, a running clock, temporal AA, the hero example

## What

- **Texture layer** (`textures.js`, optional): `createTextures(world, { manifest, url })`; the project supplies
  the manifest and files. World-space `mgTexTri / mgTexWall / mgTexGround`, palette tint, detail normals,
  a height-aware blend, a repetition breaker; every tap is `textureGrad` with the projection's derivatives;
  anisotropic. `mgSpecAA` (screen-space normal variance widens roughness) is now applied by `patch()` to every
  Standard / Physical material. Packer: `packages/tools/tex/pack.py` (Poly Haven API, 1k, WebP).
- **Running clock** (`envlight.js`, `world.setTime(t, { ease: true })`, `world.tick(dt)`): the environment is
  recaptured once (not twice) only when the key light moved 0.5°, the lamps or the sky light changed, and the
  scene's environment texture cross-fades to it over `envFade` (1.5 s); exposure eases in log space (~1 s).
  Plain `setTime(t)` still snaps (two captures), so stills are unchanged.
- **Temporal AA** for moving cameras (`renderFrame(T, { taa: true })`): one jittered sub-frame, depth
  reprojection, 3×3 variance clip in a compressed range, 12 % new frame. Chosen over supersampling while moving
  (cost ×N per sub-frame, still crawls). The still path (`spp` sub-frames, no history) is untouched and stays
  bit-identical.
- **Depth of field** (`post.dof` lens radius, `post.focus`): thin lens sampled by the sub-frames (eye on a Vogel
  spiral, frustum sheared to keep the focus plane); still frames only.
- **Look**: a time-of-day white balance (`light.warmth`: +0.3 around the golden hour, −0.2 at night), stronger
  multiple scattering in the sky (`ATMO.ms` 0.32 → 0.5: a lighter, less saturated noon sky against the ground),
  `post.exposure` 1.25 → 0.4 and `envIntensity` 0.85 → 0.5 (see the bug below), lanterns with point lights.
- **Bug fixed (present in M1)**: the accumulation pass ran through `renderer.render()` with `autoClear` on, so
  each sub-frame cleared the accumulator: an M1 frame was only its last sub-frame times its weight (no AA, no
  soft shadows, and a still frame was ~2–5× darker than a moving one; spp 7 was nearly black). `_draw` now turns
  autoClear off. Mean red at the golden view, spp 1/2/3/6/7/16/24: M1 171/51/42/77/4/–/– → now 174 for all.
  M1's still-frame identity held (deterministic), but its images and exposure were tuned against this.
- **Example**: textured plaster (texture + procedural streaks and damp foot), ashlar, cobbles, planks, textured
  land; a timber pergola, more jars, four lanterns with warm point lights, a hero camera (`?view=hero`, default;
  `?view=corner` = M1's), `?clock=N` runs the clock (N minutes per second), `?dof=1`.

## Sources

| subsystem | status | file(s) | earlier-project file consulted |
|---|---|---|---|
| texture layer: projections, repetition breaker, tint, normals, height blend, spec AA | adapted from own project, GLSL rewritten | `textures.js`, `materials.js` (`mgSpecAA`) | `src/core/textures.js` |
| texture packer | adapted from own project, slimmed (fetch + pack in one, Poly Haven only, numpy) | `packages/tools/tex/pack.py` | `tools/tex/fetch.py`, `tools/tex/pack.py` |
| environment cross-fade over the CubeUV atlas | adapted from own project (no geometry keys, no sky tint) | `envlight.js` | `src/core/envlight.js` |
| eased exposure, recapture thresholds | adapted from own project | `world.js` (`setTime`, `tick`) | `src/core/daynight.js` (`DayNight`) |
| time-of-day warmth | new (idea from the own project's grade keys, one formula instead of a table) | `daynight.js` | `src/core/daynight.js` (`GRADE_KEYS`) |
| temporal AA | new code (technique as in the own project's walk mode; variance clip instead of min/max) | `post.js` (`taa`), `world.js` | `src/walk.js` |
| depth of field | new | `world.js` | — |
| verify: orbit shimmer, running clock | new | `examples/hello-courtyard/scripts/verify.mjs` | — |

No Golden Temple file was opened for M1b.

## Numbers (Apple M4 Pro, ANGLE Metal, Chrome headless, 1440×900)

- `node scripts/verify.mjs <dir>`: no console errors or warnings in any view (golden, noon, dusk, night, golden
  + DoF at spp 24). Still frames, same `frameIndex`: max difference **0**, 0 differing channels, every view.
- Frame time: still **13.6–15.6 ms** at spp 6, **3.1–3.5 ms** at spp 1; orbiting with TAA **3.5 ms**.
- Orbit (0.35°/frame around the courtyard from M1's camera, 24 warm-up frames, then 3 frames, grain off;
  `meanAbsDiff` = mean |f₁−f₀|, `flicker` = mean |f₀−2f₁+f₂|, per channel /255):

  | build | meanAbsDiff | flicker |
  |---|---|---|
  | M1 (spp 1, untextured) | 3.17 | 5.33 |
  | M1b spp 1 (textured) | 5.15 | 8.49 |
  | M1b TAA | **3.14** | **4.62** |

  TAA removes 46 % of the frame-to-frame flicker on the same scene; with five photo textures it is below M1's
  untextured scene. (M1's moving frames were exposed differently — 1.25, single sub-frame — so the cross-build
  row is indicative only.)
- Running clock, 16:50 → 17:20 at 10 clock minutes per second (30 fps), TAA frames: eased **5.6 ms** mean /
  7.2 ms p95 per frame vs snapping (M1 behaviour, two captures per `setTime`) **18.3 ms** / 19.6 ms. Largest
  frame-to-frame step of mean luma 3.7 vs 2.2 /255; the eased light lags at this (extreme) rate (mean luma 106
  vs 95 at the end) and settles within 4 s (95.5 vs 93.0).
- Build: JS 854 kB (228 kB gzip; M1 840 / 223), textures 1.0 MB (10 WebP), `dist/` 1.8 MB.
  Repo textures 1.3 MB.
- Screenshots: golden, noon, dusk with lanterns (17:22), night (2026-11-09 21:00, moonless), golden + DoF, and
  three consecutive TAA orbit frames.

## Size (lines)

| part | lines |
|---|---|
| `packages/core/src` (18 files) | 2583 (M1 2264: + textures 153, envlight 66, world +47, post +42, materials +7) |
| `packages/tools/tex/pack.py` | 66 |
| `examples/hello-courtyard/main.js` | 191 (world code ~165) |
| `examples/hello-courtyard/scripts/verify.mjs` | 133 |

## Open problems

- TAA reprojects with the camera only: the palm's wind sway and the water ripple ghost slightly and rely on the
  clip. Velocity output from the vertex hooks would fix it. History is bilinear (a little soft; the grade's
  sharpen hides most of it).
- Switching from TAA frames to the still `spp` frame when the camera stops is a visible (small) pop in
  sharpness and soft shadows; a short blend would hide it.
- At very fast clocks the eased environment lags (measured above); fine at real-time or minutes-per-second rates.
- DoF needs many sub-frames (spp 24 for a clean bokeh) and is off while moving.
- Exposure and environment strength were retuned for the fixed accumulation on this one example; a second,
  differently lit example should confirm them.
- Not done: irradiance volume / local probes (no interior yet), god rays, lens flare, Milky Way, decals.

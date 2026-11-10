# Public API

Everything each package's entry point exports, one line each, with its **stability**. The details live in each
package's README and in [world-protocol.md](world-protocol.md); this page is the list of what is public and what
a release may change. `npm run test:pack` fails if a package exports a name that is not on this page.

- **stable**: changed only in a major release (semver). Removing it, renaming it, or changing what an
  existing argument means is a breaking change.
- **experimental**: public and usable, but a minor release may change it (listed in the changelog). Mostly the
  rendering internals and constants a world rarely needs.

The entry points `@mirage/<pkg>` are the API. Every file under `src/` can also be imported as a subpath
(`"./*"` in the export map) and has its own `.d.ts`; the world kits live there (`@mirage/world/kits/vegetation`,
`/kits/terrain`, `/kits/water`, `/kits/rain`, `/kits/fur` (experimental), documented in the world README). Which subpaths stay supported is open:
`/kits/terrain`, `/kits/water`, `/kits/rain`, `/kits/splat`, documented in the world README). Which subpaths stay supported is open:
[API-CANDIDATE.md](API-CANDIDATE.md) lists them; until a whitelist is decided, treat subpaths other than the kits,
`@mirage/core/rng`, `@mirage/world/plan`, `@mirage/core/export` (`exportWorld`, experimental: [export.md](export.md)) and `@mirage/core/ktx2` (`createKTX2Loader(renderer, { transcoderPath, workers })`, experimental: a KTX2Loader for `createTextures({ ktx2 })`; a subpath so bundles that never import it never contain three's KTX2Loader) as internal. Types: each package's root entry declares `types`
([TYPES.md](TYPES.md)).

> The split 1.0.0 ships with, as proposed in the 1.0 review (docs/review-1.0.md); the owner can still move names
> before the tag. After it, moving a name from experimental to stable is a minor release, the other way a major one.

## @mirage/core

| export | stability | what it is |
|---|---|---|
| `createWorldRenderer(config)` | stable | the renderer for one world: sky, light, shadows, post, day / night; returns the `world` object (fields in the core README; experimental fields: `setReducedMotion`, `reducedMotion`, `renderTransparent`, `ctx.motion`) |
| `patch(material, hooks, G)` | stable | add GLSL hooks to a three.js material (vertex, albedo, roughness, normal, emissive, lighting, output) |
| `createTextures(world, { manifest, url, anisotropy })` | stable | the optional world-space texture layer for CC0 PBR sets |
| `PROC` | stable | ready hook sets: `plaster`, `stone`, `wood`, `terracotta` |
| `createTextures(world, { manifest, url, anisotropy, decode, ktx2 })` | stable | the optional world-space texture layer for CC0 PBR sets; opt-ins (experimental): `decode: 'bitmap'` decodes off the main thread (same pixels), `ktx2` loads `.ktx2` files (`@mirage/core/ktx2`); `tex.textures()` lists its textures |
| `TEX_GLSL` | stable | the GLSL of the texture layer (`mgTexTri`, `mgTexWall`, `mgTexGround`, …) |
| `glslName(name)` | stable | how a texture set name is spelled in `MG_TEX_<name>` (`'stone-wall'` → `stone_2d_wall`; plain names unchanged) |
| `LIGHT2_DEFAULTS` | experimental | light2's settings (`ls` lamp shadows, `ssr` reflections, `vol` volumetric light, `bloom` mixed bloom); `createWorldRenderer({ light2 })` turns it on |
| `light2Config(option)` | experimental | the full light2 settings for `true` / a partial object; null when off |
| `installLight2()` | experimental | patch three's chunks for light2 (page-global, idempotent; the world renderer calls it) |
| `addLampSource(scene, fn)` | experimental | register a lamp table (not PointLights) that competes for lamp-shadow slots |
| `LampShadows` | experimental | the lamp-shadow slots and their octahedral atlas (the pipeline owns one when light2 is on) |
| `SOFTSHADOW_DEFAULTS` | experimental | the soft sun shadows' settings (`on`, `sunAngle`, `maxPenumbra`, `maxPenumbraTexels`, `minBlocker`, tap counts, `slopeMax`, `edgeFade`); `createWorldRenderer({ softShadows })` turns them on |
| `softShadowConfig(option)` | experimental | the full soft-shadow settings for `true` / a partial object (numbers clamped); null when off |
| `installSoftShadows(settings)` | experimental | patch three's sun-shadow lookup for contact-hardening soft shadows (page-global, idempotent; tap counts compiled in by the first call; the world renderer calls it) |
| `TEX_RELIEF_GLSL` | experimental | the texture layer's relief taps (`mgTexTriRelief`, `mgTexWallRelief`, `mgTexGroundRelief`); compiled in by the relief opt-ins |
| `RELIEF` | experimental | the close-range relief's shared uniforms (`uRelief` on / off, `uReliefFar` fade distance) |
| `setRelief(level)` | experimental | relief level: 0 off, 1 full (8 m), in between a shorter reach |
| `RELIEF_GLSL` | experimental | the relief GLSL (`mgRlFade`, `mgRlShift`, `mgRlSunProbe`, `mgRlSelfShadow`, `mgRlLip`, `mgRlArris`, `mgRlRenderH`, …) |
| `RELIEF_LIGHT` | experimental | `lighting` hook snippet: the relief's self-shadow on the direct light |
| `withRelief(hooks)` | experimental | put the relief GLSL and uniforms in front of a hooks object |
| `renderHeight(name, und, swipe)` | experimental | GLSL declaring a hand-applied render's height (m), faded with distance |
| `renderShade(name)` | experimental | `output` hook snippet: shade the render's hollows |
| `withWet(hooks, options)` | experimental | wet surfaces on a hooks object: damp → soaked → standing water (puddles), run-off streaks, a damp band at the ground, rain rings; options `porosity`, `ground`, `band`, `puddles`, `height`, `heightMid`, `heightScale` |
| `setWetness(level)` | experimental | wetness 0 (off: the wet code not compiled; crossing 0 recompiles the opted-in materials) .. 1 (full puddles); page-global |
| `setRain(intensity)` | experimental | rain 0 .. 1: ripples on standing water and the rain kit's streak density; page-global |
| `WET` | experimental | the wetness's page-global uniforms (`uWet`, `uRain`) |
| `WET_GLSL` | experimental | the wet GLSL (`mgWetApply`, `mgWetNormal`, `mgWetRipples`, `mgWetH`) |
| `NOISE_GLSL` | stable | the GLSL noise library (`mgHash`, `mgValue2/3`, `mgFbm2/3`, `mgCell2/3`, …) |
| `rng(seed)` | stable | seeded random stream: `next`, `float`, `range`, `int`, `pick`, `chance`, `sign`, `gauss`, `inDisc`, `onSphere`, `fork(name)` (also `@mirage/core/rng`) |
| `geom` | stable | geometry helpers: `wall`, `archPath`, `lathe`, `taperedTube`, `instances`, `MeshBatch`, `compose`, `lerp`, `clamp`, `smoothstep`, `remap` (experimental: `softExtrude`, `softBox`, `sootPlumes`, `wall({ round })`); three's `mergeGeometries` and `RoundedBoxGeometry` re-exported |
| `skyAt(date, place)` | stable | Sun and Moon position for a date and a place (pure JS) |
| `placeDate(day, time, tzHours)` | stable | a `Date` for a local wall-clock time |
| `placeClock(date, tzHours)` | stable | the local wall-clock parts of a `Date` |
| `skyState(time, place)` | stable | the light model's input for a time: sun, moon, night |
| `lightAt(state)` | stable | key light, exposure, lamps and sky light for a sky state |
| `deviceProfile(renderer, { force })` | stable | the device tier (mobile, weak GPU) |
| `pickQuality({ storage, nav })` | stable | the quality a page starts with (saved choice, battery, phone) |
| `QUALITY_LEVELS` | stable | `['low', 'medium', 'high']` |
| `QUALITY_KEY` | experimental | the `localStorage` key of the saved quality |
| `createEnv({ wind })` | experimental | the shared uniforms (`G`) of one world |
| `GOLDEN` | experimental | the reference golden-hour sun `{ elevation, azimuth }` |
| `dirFromElevAz(elevation, azimuth, out)` | experimental | unit vector toward an elevation / compass azimuth |
| `elevAzOf(direction)` | experimental | elevation / azimuth of a direction |
| `dirFromAltAz(alt, az)` | experimental | the same from astronomy's altitude / azimuth |
| `WIND_GLSL` | experimental | `mgWind()` for vertex hooks |
| `createSky(uniforms)` | experimental | the sky dome mesh |
| `createSkyUniforms()` | experimental | its uniforms |
| `createSkyLut(renderer, uniforms, options?)` | experimental | bakes the sky's air into direction tables per `setTime` (call before `createSky`) |
| `createStars(skyUniforms, { faint })` | experimental | stars and the Moon's disc |
| `ATMO` | experimental | atmosphere constants (radii, scattering coefficients) |
| `ATMOSPHERE_GLSL` | experimental | the atmosphere in GLSL |
| `transmit(r, mu, k)` | experimental | transmittance on the CPU |
| `transmitAtGround(elevation, k)` | experimental | sunlight transmittance at the ground |
| `scatter(d, L, I, ms)` | experimental | sky radiance on the CPU (same as the shader) |
| `skyLightAt(elevation, I)` | experimental | sky irradiance and horizon radiance |
| `installFog()` | experimental | Mirage's height fog in three's shader chunks (under `THREE.FogExp2` only) |
| `FOG` | experimental | the page-global fog uniforms |
| `Pipeline` | experimental | the sub-frame accumulation / TAA / post pipeline |
| `DEFAULT_POST` | experimental | default post settings (exposure, tone map, bloom, AO, DOF, …) |
| `createMaterials(G)` | experimental | the `world.mat` kit (`std`, `phys`, `patch`, `depth`, `glow`) for a set of uniforms |
| `createEnvLight(renderer, { size, fade })` | experimental | image-based light captured from the world, cross-faded |
| `createLod()` | experimental | merge-and-swap level-of-detail helper |
| `hash32(string)` | experimental | 32-bit string hash used for seeds |
| `sfc32(seed)` | experimental | the raw SFC32 generator |
| `valueNoise2(x, z, seed)` | experimental | smooth 2D value noise on the CPU |
| `fbm2(x, z, octaves, seed)` | experimental | fractal sum of `valueNoise2` |
| `createJobQueue({ concurrency, priority })` | experimental | streaming: a job queue that runs the lowest `priority(job)` first, re-read at every pick, at most `concurrency` at once; `add(key, fn, { priority, data })`, `cancel`, `idle` |
| `createLRU({ budget, evict })` | experimental | streaming: an LRU cache with a byte budget; `set(key, value, bytes)`, `get`, `pin` / `unpin` (in-use entries are never evicted), `trim` |
| `createUploadBudget(renderer, { bytes, count })` | experimental | streaming: texture uploads (`renderer.initTexture`) spread over frames, `bytes` (8 MB) a frame; `add(textures)`, `step()` once a frame, `whenDone(textures)` |
| `textureBytes(texture)` | experimental | estimated GPU bytes of a texture (mipmaps, compressed levels) |
| `objectBytes(root)` | experimental | GPU bytes of an object tree: geometry attributes, indices, instance matrices, sampled textures (each once) |
| `texturesOf(object)` | experimental | the textures an object's materials sample (maps and `patch()` / ShaderMaterial sampler uniforms) |
| `disposeObject(root, { keepTextures })` | experimental | free an object tree's geometries, materials and textures |
| `watchLongTasks()` | experimental | count main-thread long tasks (PerformanceObserver `longtask`, or frame gaps over 50 ms): `stop()` → `{ count, totalMs, maxMs, source, tasks }` |
| `nextFrame(timeout)` | experimental | resolves after the next frame was drawn (a macrotask where there is no `requestAnimationFrame`) |

## @mirage/world

| export | stability | what it is |
|---|---|---|
| `definePlan(plan)` | stable | validate a site plan and fill defaults; throws listing every problem (also `@mirage/world/plan`) |
| `contains(shape, x, z)` | stable | is a point inside a rect / circle / poly |
| `bbox(shape)` | stable | bounding rectangle of a shape |
| `pathLength(path)` | stable | length of a plan path |
| `along(path, s)` | stable | point and direction at a distance along a path |
| `buildWorld(world, { plan, modules, shared, log, slice })` | stable | build modules in order with failure isolation; anchors, finalize, ambient volumes, report; `slice` (experimental, opt-in) yields to the frame between modules after a time budget and reports `slices` |
| `createStreamer(world, { plan, modules, shared, camera, concurrency, budget, uploadBytes, hysteresis, sync, onChange })` | experimental | modules that come into the scene near the viewer and leave when far: queued nearest first, built, compiled off-frame (`compileAsync`), textures uploaded over frames, cached in an LRU byte budget; `update(position)` once a frame |
| `regionOf(root, pad)` | experimental | the XZ rectangle an object covers (for a walk-grid region re-bake) |
| `LAYER` | stable | `{ VIEW: 0, COLLIDE: 2 }` |

The module interface (`name`, `build`, `finalize`, `anchors`, `ambientVolumes`, and the `ctx` fields) is stable;
see [world-protocol.md](world-protocol.md).

Gaussian splats, `@mirage/world/kits/splat` (opt-in subpath, world README "Gaussian splats"):

| export | stability | what it is |
|---|---|---|
| `addSplats(ctx, data, options)` | experimental | one instanced draw of sorted splats in the world's light and fog; options `position`, `rotation`, `scale`, `minPixelSize`, `antialias`, `gain`, `light`, `effect`, `progress`, `worker`, `resort`, `depth`, `name`; returns `{ mesh, count, bounds, stats, progress, setEffect, changed, sortNow, sorted, dispose }` |
| `loadSplats(url, { fetch })` | experimental | fetch and parse `.splat`, 3DGS `.ply` (SH0) or a SOG `meta.json` with its webp textures |
| `parseSplat(buffer)`, `parsePly(buffer)`, `parseSog(meta, images)` | experimental | the parsers, to the kit's data shape `{ count, center, scale, rot, color }` |
| `splatEffects.reveal(options)`, `splatEffects.dissolve(options)` | experimental | built-in effects (GLSL hooks on centre, rotation / scale and colour), driven by `progress` |
| `splatSorter()`, `packSplats(data, row)`, `splatBounds(data)` | experimental | the depth sort (the worker's code), the texture packing and the data bounds, for tests and tools |

## @mirage/play

| export | stability | what it is |
|---|---|---|
| `createPlay(world, opts)` | stable | walk / fly / game view / orbit, input, still refinement; returns `play` (fields in the play README); experimental: the `reducedMotion` option and field (follows `prefers-reduced-motion`), `render({ transparent: true })` |
| `createCharacter(world, { palette })` | experimental | the procedural traveller of the game view (rig, palette, locomotion); hosts can add its `root` to their own scene |
| `mountWorld(opts)` | stable | build a world into a host page's own renderer (the embed API) |
| `bakeWalkGrid(world, opts)` | stable | the walk grid baked from the geometry; `{ region, into }` (experimental) re-bakes only a region of an earlier grid in place |
| `bakeWalkGridAsync(world, opts)` | experimental | the same arrays, baked over frames: fenced pixel-pack reads, `budgetMs` (4) of main thread a frame, tiles; `{ region, into }` too |
| `createWalker(grid, { pos, body })` | stable | the walk-grid character |
| `BODY` | stable | the character's sizes and speeds |
| `makeGrid(data)` | experimental | a grid from raw arrays (tests, saved grids) |
| `MAXL` | experimental | floors per grid column (4) |
| `createNavGrid(grid, { coarse, step, head, drop, radius })` | experimental | NPC navigation on the walk grid: per-radius fit bits (the walker's own test), `findPath` (coarse A* + cell A* + string pulling), `flowField`, `block` / `unblock` dynamic obstacles, `visible`, `nearest`; `nav.grid` is the walk grid with the obstacles in |
| `createNavAgent(nav, { radius, speed, pos, arrive })` | experimental | an NPC: a walker of its own radius steered along `findPath` waypoints or a flow field (`setGoal`, `update(dt)`); re-plans on edits and when stuck; never steps onto a cell it does not fit |
| `createNavCrowd(nav, { separation, range })` | experimental | separation steering for many agents (`add`, `remove`, `update(dt)`) |
| `createXR(play, opts)` | experimental | WebXR: Enter VR / Enter AR buttons, the walker in a headset, teleport, snap turn, in-world game prompts, AR table model; hand tracking (pinch, point-and-pinch teleport), `navigator.xr.offerSession` / `autoEnter` for hosts without a DOM, labels in a built-in glyph font where Canvas 2D draws no text (`opts.offer`, `autoEnter`, `hands`, `text`; `docs/xr.md`) |
| `xrSupport()` | experimental | `{ vr, ar }`: which immersive sessions the browser offers; pass `vr \|\| ar` as the world's `xr` option |

## @mirage/game

| export | stability | what it is |
|---|---|---|
| `startGame(world, opts)` | stable | physics, character, game state, input, audio, overlay and play in one call |
| `createGame({ id, version, migrate })` | stable | entities, flags, inventory, events, zones, saves |
| `createPhysics(scene, { gravity })` | stable | Rapier world: static colliders, bodies, hinged doors, character |
| `createInput({ target, bindings, deadzone })` | stable | the action map over keyboard, mouse, gamepad and touch |
| `DEFAULT_BINDINGS` | stable | default keys per action |
| `ACTIONS` | stable | the action names |
| `createAudio({ volumes })` | stable | Web Audio buses and the procedural sounds |
| `SURFACES` | stable | footstep surfaces: `stone`, `gravel`, `grass`, `wood` |
| `createUI(opts)` | experimental | the HTML overlay (HUD, menus, touch controls) |
| `PAD` | experimental | default gamepad buttons per action |
| `loadRapier()` | experimental | load the Rapier WASM ahead of `createPhysics` |
| `createAudioEngine({ audio, voices, buses, snapshots, ducks, zones, occlusion, cues })` | experimental | the audio engine (docs/audio.md): files and streams, voices with a cap and virtual voices, 3D placement, reverb zones, occlusion, cues; opt-in, keeps `createAudio` working |
| `createMixer(ctx)` | experimental | bus tree with effect chains, sends, snapshots, ducking and meters on any (offline) audio context |
| `EFFECT_TYPES` | experimental | the effect names a bus takes: eq, filters, compressor, limiter, delay, reverb, drive, pan, gain |
| `createMusic(engine, { bpm, sections })` | experimental | adaptive music: sections of stems, bar / beat-quantised transitions, layers, stingers |
| `zonesFromPlan(plan)` | experimental | the reverb zones of a world plan (`plan.audio.zones`) |
| `zoneWeights(zones, pos)` | experimental | weight of each zone for a listener position; the last entry is the ambient share |
| `gridOccluder(grid)` | experimental | occlusion test on the walk grid |
| `physicsOccluder(physics)` | experimental | occlusion test by a Rapier ray |
| `sceneOccluder(root, { raycaster })` | experimental | occlusion test by a three.js raycast |
| `createAudioDebug(engine)` | experimental | overlay: voices, virtual voices, rays, zone weights, a meter per bus |
| `audioStatsText(engine)` | experimental | the same stat block as a string |
| `REVERBS` | experimental | reverb presets: room, hall, cave, cathedral, outdoor, plate |
| `impulseResponse({ decay, damping, seed })` | experimental | a stereo impulse response made from seeded noise (unit energy) |
| `encodeWav(channels, sampleRate, bits)` | experimental | PCM / float WAV bytes from Float32Arrays |
| `decodeWav(bytes)` | experimental | `{ sampleRate, channels }` from a WAV file |
| `distanceGain(d, { model, ref, max, rolloff, curve })` | experimental | the gain of a distance model or a custom roll-off curve |
| `coneGain(dir, toListener, inner, outer, outerGain)` | experimental | the gain of a sound cone |
| `dopplerRatio(src, vSrc, lis, vLis)` | experimental | the playback-rate factor of a moving source and listener |
| `occlusionResponse(occlusion)` | experimental | the gain and low-pass corner for an occlusion of 0..1 |
| `dbToGain(db)` | experimental | decibels to a linear gain |
| `gainToDb(gain)` | experimental | a linear gain to decibels |
| `rms(samples, from, to)` | experimental | root mean square of samples (checks) |
| `peak(samples, from, to)` | experimental | largest absolute sample (checks) |
| `toneLevel(samples, sampleRate, freq)` | experimental | amplitude of one frequency in samples (Goertzel; checks) |
| `onset(samples, level)` | experimental | index of the first sample at or over a level (checks) |

## @mirage/tools

Command-line tools (no JS entry point). Stable: `mirage-playtest` (scenario format in the playtest skill),
`mirage-package`, `mirage-snap`, `mirage-deploy`. Experimental: `mirage-walktest`, `mirage-perf`, `mirage-e2e` (runs the `examples/` of the current folder or `--root`),
`mirage-gpu-load`, `mirage-still-pop`, `mirage-xr-check` (WebXR in an emulated Quest 3; repository checks; some expect this repository's `examples/`). The tools
need Chrome: `$CHROME`, or the usual install place on macOS, Linux and Windows.

# Public API

Everything each package's entry point exports, one line each, with its **stability**. The details live in each
package's README and in [world-protocol.md](world-protocol.md); this page is the list of what is public and what
a release may change. `npm run test:pack` fails if a package exports a name that is not on this page.

- **stable**: changed only in a major release (semver). Removing it, renaming it, or changing what an
  existing argument means is a breaking change.
- **experimental**: public and usable, but a minor release may change it (listed in the changelog). Mostly the
  rendering internals and constants a world rarely needs.

The entry points `@miragekit/<pkg>` are the API. Subpaths are an explicit allow-list: each package's `exports` map
names every importable file (there is no `"./*"`), each with its own `.d.ts`, and a file under `src/` that is not
listed is internal and cannot be imported from an installed package. `npm test` fails on an import of a subpath
that is not listed (`scripts/check-imports.mjs`, over source, examples and docs) and on a `.d.ts` that declares
other value names than its module exports (`scripts/check-types.mjs`). The subpaths a world normally needs:

- the synthesis kit `@miragekit/game/sounds` ([sounds.md](sounds.md));
- the world kits `@miragekit/world/kits/vegetation`, `/kits/terrain`, `/kits/water`, `/kits/rain`, `/kits/splat` and
  `/kits/fur`, documented in the world README;
- the library's content, `@miragekit/assets/surfaces`, `/kits/cyber`, `/sounds`, `/destruct` (Business Source License
  1.1, not MIT: the last section below);
- `@miragekit/core/rng`, `@miragekit/core/geom`, `@miragekit/world/plan`;
- `@miragekit/core/export` (`exportWorld`, experimental: [export.md](export.md)), `@miragekit/core/assets`
  ([import.md](import.md)) and `@miragekit/core/ktx2` (`createKTX2Loader(renderer, { transcoderPath, workers })`,
  experimental: a KTX2Loader for `createTextures({ ktx2 })`; a subpath so bundles that never import it never contain
  three's KTX2Loader).

The other listed subpaths are the same modules the entry points re-export, importable one at a time; their names
carry the stability of the row that describes them below. Adding a subpath is a line in the package's `exports`;
removing one is a breaking change. Types: each package's root entry declares `types` ([TYPES.md](TYPES.md)). The
count of stable and experimental exports, and how a name is promoted: [STABILITY.md](STABILITY.md).

> The split 1.0.0 ships with, as proposed in the 1.0 review (docs/review-1.0.md); the owner can still move names
> before the tag. After it, moving a name from experimental to stable is a minor release, the other way a major one.

## @miragekit/core

| export | stability | what it is |
|---|---|---|
| `createWorldRenderer(config)` | stable | the renderer for one world: sky, light, shadows, post, day / night; returns the `world` object (fields in the core README; experimental fields: `setReducedMotion`, `reducedMotion`, `renderTransparent`, `ctx.motion`) |
| `patch(material, hooks, G)` | stable | add GLSL hooks to a three.js material (vertex, albedo, roughness, normal, emissive, lighting, output) |
| `createTextures(world, { manifest, url, anisotropy })` | stable | the optional world-space texture layer for CC0 PBR sets |
| `PROC` | stable | ready hook sets: `plaster`, `stone`, `wood`, `terracotta` |
| `SPEC_AA_GLSL` | experimental | the specular AA GLSL, guarded: `mgSpecAA(roughness, viewNormal[, strength])` widens the roughness by the shading normal's screen-space variance; every patched lit material has it, paste it into a shader of your own |
| `createTextures(world, { manifest, url, anisotropy, decode, ktx2 })` | stable | the optional world-space texture layer for CC0 PBR sets; opt-ins (experimental): `decode: 'bitmap'` decodes off the main thread (same pixels), `ktx2` loads `.ktx2` files (`@miragekit/core/ktx2`); `tex.textures()` lists its textures |
| `TEX_GLSL` | stable | the GLSL of the texture layer (`mgTexTri`, `mgTexWall`, `mgTexGround`, …) |
| `glslName(name)` | stable | how a texture set name is spelled in `MG_TEX_<name>` (`'stone-wall'` → `stone_2d_wall`; plain names unchanged) |
| `LIGHT2_DEFAULTS` | experimental | light2's settings (`ls` lamp shadows, `ssr` reflections, `vol` volumetric light, `bloom` mixed bloom); `createWorldRenderer({ light2 })` turns it on |
| `light2Config(option)` | experimental | the full light2 settings for `true` / a partial object; null when off |
| `installLight2()` | experimental | patch three's chunks for light2 (page-global while a world lives, three's own again when the last world is disposed; idempotent; the world renderer calls it) |
| `addLampSource(scene, fn)` | experimental | register a lamp table (not PointLights) that competes for lamp-shadow slots |
| `LampShadows` | experimental | the lamp-shadow slots and their octahedral atlas (the pipeline owns one when light2 is on) |
| `SOFTSHADOW_DEFAULTS` | experimental | the soft sun shadows' settings (`on`, `sunAngle`, `maxPenumbra`, `maxPenumbraTexels`, `minBlocker`, tap counts, `slopeMax`, `edgeFade`); `createWorldRenderer({ softShadows })` turns them on |
| `softShadowConfig(option)` | experimental | the full soft-shadow settings for `true` / a partial object (numbers clamped); null when off |
| `installSoftShadows(settings)` | experimental | patch three's sun-shadow lookup for contact-hardening soft shadows (page-global, idempotent; tap counts compiled in by the first call; the world renderer calls it) |
| `createLighting(world, option)` | experimental | the realtime lighting features behind `createWorldRenderer({ lighting })` (the world renderer calls it; `world.lighting` is its result): `csm`, `gi`, `probes`, `lights`, `screen`, `planar`, `addLight(light, { shadow })`, `removeLight`, `invalidate()`, `busy`. Shader parts go into the world's own lit materials, not three's chunks (`docs/lighting.md`) |
| `CSM_DEFAULTS` | experimental | cascaded sun shadows' settings (`cascades` 2-4, `distance`, `lambda`, `blend`, `tile`, `taps`, `stagger`, ...); `lighting: { csm: true }` |
| `GI_DEFAULTS` | experimental | the irradiance probe volume's settings (`spacing`, `bounces`, `cube`, `perFrame`, `intensity`, `fade`, `bias`, `specular`); `lighting: { gi: { min, max } }` |
| `BOUNCE_DEFAULTS` | experimental | the height-field bounce light's settings (`spacing`, `layers`, `curve`, `texel`, `margin`, `hmax`, `strength`, `multi`, `edge`, `lo`, `hi`, `bands`, `ease`, `maxProbes`, `maxMap`); `lighting: { bounce: true \| { min, max } }` |
| `LIGHTS_DEFAULTS` | experimental | clustered local lights and their shadow atlas (`max`, `cluster`, `perCell`, `atlas`, `tileMax`, `tileMin`, `perFrame`, `bias`); `lighting: { lights: true }` |
| `SCREEN_DEFAULTS` | experimental | the screen-space passes' buffers (`scale`, `refScale`, `layer`); `lighting: { screen: true }` (`docs/lighting.md`) |
| `SCREEN_POST` | experimental | their post settings, all off: `ssr2`, `ssrRough`, `ssrDist`, `ssrThick`, `ssgi`, `ssgiRange`, `ssgiRays`, `contact`, `contactLen` |
| `PLANAR_DEFAULTS` | experimental | the planar reflection of one horizontal plane (`y`, `scale`, `roughMax`, `fade`, `clip`, `layers`, `every`); `lighting: { planar: { y } }`, `world.lighting.planar.info` (`docs/lighting.md`) |
| `PROBE_DEFAULTS` | experimental | a reflection probe's defaults (`fade`, `intensity`); `lighting: { probes: [{ min, max, position }] }`, at most 4 |
| `LAMPPOOL_DEFAULTS` | experimental | the lamp pool's settings (`max`, `perCell`, `far`, `fade`, `lampGain`, `real`, `soft`, `light2`, `captures`); `createWorldRenderer({ lampPool: true })` turns it on and `world.lampPool.set(lamps)` fills it (README "Lamp pool") |
| `lampPoolConfig(option)` | experimental | the full lamp-pool settings for `true` / a partial object; null when off |
| `createLampPool(world, settings)` | experimental | what `createWorldRenderer({ lampPool })` builds (`world.lampPool`): `set`, `add`, `update`, `clear`, `count`, `info`. A clustered term in the world's lit materials; a PointLight on a pool lamp takes its share of it |
| `TEX_RELIEF_GLSL` | experimental | the texture layer's relief taps (`mgTexTriRelief`, `mgTexWallRelief`, `mgTexGroundRelief`); compiled in by the relief opt-ins |
| `RELIEF` | experimental | the close-range relief's shared uniforms (`uRelief` on / off, `uReliefFar` fade distance) |
| `setRelief(level)` | experimental | relief level: 0 off, 1 full (8 m), in between a shorter reach |
| `RELIEF_GLSL` | experimental | the relief GLSL (`mgRlFade`, `mgRlShift`, `mgRlSunProbe`, `mgRlSelfShadow`, `mgRlLip`, `mgRlArris`, `mgRlRenderH`, …) |
| `RELIEF_LIGHT` | experimental | `lighting` hook snippet: the relief's self-shadow on the direct light |
| `withRelief(hooks)` | experimental | put the relief GLSL and uniforms in front of a hooks object |
| `renderHeight(name, und, swipe)` | experimental | GLSL declaring a hand-applied render's height (m), faded with distance |
| `renderShade(name)` | experimental | `output` hook snippet: shade the render's hollows |
| `withWet(hooks, options)` | experimental | wet surfaces on a hooks object: damp → soaked → standing water (puddles), run-off streaks, a damp band at the ground, rain rings; options `porosity`, `ground`, `band`, `puddles`, `height`, `heightMid`, `heightScale`, `wear`, `wearDepth`, `shelter`, `rim`, `ripples`, `specAA` |
| `registerSurfaceKinds({ kinds, glsl, liveGlsl })`, `registerSurfaceDecals({ glsl, fragment, uniforms })` | experimental | the surface framework's registry ([surfaces.md](surfaces.md)): a kind is a table entry (numbers, packing, reference ranges, optional program pieces) and a GLSL recipe; the library's 35 are `@miragekit/assets/surfaces` |
| `surfaceKinds()`, `surfaceSpec(kind, options)` | experimental | the registered kinds' facts; a spec of a registered kind |
| `createSurfaces(world, { mode, size, anisotropy })` | experimental | `{ material(spec, options), hooks, bake, stats, dispose }`: `mode` `'auto'` (default) \| `'baked'` \| `'procedural'`; mappings `tri` / `wall` / `ground` / `grain` / `uv`, `space: 'object'`, `wet`, `decals`, asphalt `paint` |
| `surfaceHooks(spec, options)`, `bakeSurface(renderer, spec, options)`, `bakeDecalAtlas(renderer)`, `noiseTexture()` | experimental | the parts: hooks without a library, a set baked by hand, the weathering decal atlas, the runtime layer's noise |
| `setWetness(level)` | experimental | wetness 0 (off: the wet code not compiled; crossing 0 recompiles the opted-in materials) .. 1 (full puddles); page-global |
| `setRain(intensity)` | experimental | rain 0 .. 1: ripples on standing water and the rain kit's streak density; page-global |
| `WET` | experimental | the wetness's page-global uniforms (`uWet`, `uRain`) |
| `WET_GLSL` | experimental | the wet GLSL (`mgWetApply`, `mgWetNormal`, `mgWetRipples`, `mgWetH`) |
| `NOISE_GLSL` | stable | the GLSL noise library (`mgHash`, `mgValue2/3`, `mgFbm2/3`, `mgCell2/3`, …) |
| `rng(seed)` | stable | seeded random stream: `next`, `float`, `range`, `int`, `pick`, `chance`, `sign`, `gauss`, `inDisc`, `onSphere`, `fork(name)` (also `@miragekit/core/rng`) |
| `geom` | stable | geometry helpers: `wall`, `archPath`, `lathe`, `taperedTube`, `instances`, `MeshBatch`, `compose`, `lerp`, `clamp`, `smoothstep`, `remap` (experimental: `softExtrude`, `softBox`, `sootPlumes`, `wall({ round })`, `openingProblem(opening, wallHeight)`: why an opening does not fit its wall, the text of MG206). A `wall` opening's `height` is where its arch springs, not its top, and `arch` defaults to `'round'` (top = height + width / 2): give `arch: 'flat'` for a straight lintel at `height`; three's `mergeGeometries` and `RoundedBoxGeometry` re-exported |
| `skyAt(date, place)` | stable | Sun and Moon position for a date and a place (pure JS) |
| `placeDate(day, time, tzHours)` | stable | a `Date` for a local wall-clock time |
| `placeClock(date, tzHours)` | stable | the local wall-clock parts of a `Date` |
| `skyState(time, place)` | stable | the light model's input for a time: sun, moon, night |
| `lightAt(state)` | stable | key light, exposure, lamps and sky light for a sky state |
| `GRADE_PRESETS` | experimental | the time-of-day grade's four looks (`noon`, `golden`, `dusk`, `night`: `exposure` EV, `temperature`, `tint`, `saturation`, `contrast`, `tonemapMix`, `shadowTint`, `hiTint`, `black`, `curve`, `punch`, `clarity`, `highlightWarmth`, `lift`, `gamma`); `createWorldRenderer({ grade })` turns the grade on |
| `gradeConfig(option)` | experimental | the full grade settings for `true` / a partial object (`strength`, `nightAdapt`, `lampTint`, per-look overrides); null when off |
| `gradeAt(light, state, settings)` | experimental | the look of an hour (pure): the presets eased by the sun's elevation, the lamps' tint, the darker night; what the pipeline's grade variant applies through `post.grade` |
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
| `createSkyUniforms(options?)` | experimental | its uniforms; `{ dusk }` adds the dusk sky's (`createSky` and `createSkyLut` then compile it in) |
| `SKY_DUSK_DEFAULTS` | experimental | the dusk sky's settings (`haze`, `night`, `airglow`, `cover`); `createWorldRenderer({ sky: { dusk } })` turns it on |
| `skyDuskConfig(sky)` | experimental | the full dusk-sky settings for `{ dusk: true }` / a partial object (numbers clamped); null when off |
| `createSkyLut(renderer, uniforms, options?)` | experimental | bakes the sky's air into direction tables per `setTime` (call before `createSky`) |
| `createStars(skyUniforms, { faint })` | experimental | stars and the Moon's disc |
| `ATMO` | experimental | atmosphere constants (radii, scattering coefficients) |
| `ATMOSPHERE_GLSL` | experimental | the atmosphere in GLSL |
| `transmit(r, mu, k)` | experimental | transmittance on the CPU |
| `transmitAtGround(elevation, k)` | experimental | sunlight transmittance at the ground |
| `scatter(d, L, I, ms)` | experimental | sky radiance on the CPU (same as the shader) |
| `skyLightAt(elevation, I)` | experimental | sky irradiance and horizon radiance |
| `installFog()` | experimental | Mirage's height fog in three's shader chunks (under `THREE.FogExp2` only; `world.dispose()` of the last world on the page puts three's chunks back) |
| `FOG` | experimental | the page-global fog uniforms |
| `Pipeline` | experimental | the sub-frame accumulation / TAA / post pipeline |
| `DEFAULT_POST` | experimental | default post settings (exposure, tone map, bloom, AO, DOF, …) |
| `FX_DEFAULTS` | experimental | the post settings of `postfx.js`, all off: `taa2`, `upscale`, `motionBlur`, `bokeh`, `bloomPyramid`, `lut`, `chroma`, `rcas`, `godrays`, `flare`, `lensDirt`, `streak` (`docs/post.md`) |
| `PostFX` | experimental | the passes behind them (velocity buffer, temporal resolve / upscale, lens blur, motion blur, bloom pyramid, LUT grade, god rays, lens flare, lens dirt, anamorphic streaks); `pipeline.fx` |
| `postFromQuery(query)` | experimental | post settings from URL flags (`?taa2=1&upscale=0.67&mb=0.5&bokeh=1&lens=0.03&bloom2=1&lut=warm&chroma=0.6&godrays=1&flare=1&dirt=0.6&streak=0.6`) |
| `lensDirtMask({ width, height, seed })` | experimental | `post.lensDirt`'s procedural mask as bytes (blotches, dried drops, wiped streaks, specks; the same seed, the same bytes) |
| `parseCube(text)` | experimental | an Adobe / Resolve `.cube` 3D lookup table -> `{ size, data }` |
| `makeLut(fn, size)` | experimental | a lookup table from a function of display-referred RGB |
| `lutTexture(lut)` | experimental | the table as a `Data3DTexture` for `post.lut` |
| `apertureRadius(focalMm, fStop)` | experimental | the lens radius (m) of a real lens: `post.dof` |
| `halton(i, base)` | experimental | the Halton sequence (taa2's jitter) |
| `createMaterials(G)` | experimental | the `world.mat` kit (`std`, `phys`, `patch`, `depth`, `glow`) for a set of uniforms |
| `createEnvLight(renderer, { size, fade })` | experimental | image-based light captured from the world, cross-faded |
| `createVfx(world, { hz, maxParticles, instances, gain })` | experimental | GPU particles and effects (`docs/vfx.md`): `spawn`, `burst`, `prewarm`, `beam`, `decal`, `setGround`, `registerMesh` / `registerField` / `registerSheet`, `stats`; also takes `{ renderer, scene, camera }` with `update(seconds)` called by hand |
| `VFX_LIBRARY` | experimental | ten ready effects as JSON: fire, smoke, sparks, dust, splash, snow, leaves, fireflies, magic, explosion |
| `defineEffect(json)` | experimental | validate an effect description and fill its defaults (no GPU; unknown keys throw with their path) |
| `evalCurve(curve, t)` | experimental | a `[[t, v], ...]` curve at `t` |
| `bakeCurves(emitter)` | experimental | an emitter's curves and gradients as the lookup rows the shaders read |
| `effectRadius(emitter)` | experimental | radius of a sphere about a defined emitter that holds its particles, for culling |
| `VFX_ENUMS` | experimental | the allowed values of the format's enumerated keys (shapes, blends, sorts, …) |
| `createLod()` | experimental | merge-and-swap level-of-detail helper |
| `chunkGeometry(geometry, { maxVertices, maxSize, minVertices })` | experimental | split one geometry into spatial pieces with tight bounds (also `@miragekit/core/chunk`); guide: `docs/big-worlds.md` |
| `chunkObject(root, options)` | experimental | replace every large static mesh under `root` by its chunks so frustum culling can work; `MeshBatch.finish({ chunk })` calls it |
| `createSimplifier(mesh)` | experimental | Mirage's own quadric-error mesh simplifier (attributes, locked and border vertices), resumable: `run({ triangles, error, budgetMs })`, `extract()` |
| `simplify(mesh, { triangles, ratio, error })` | experimental | one simplified level of a `{ positions, index, attributes }` mesh |
| `createChain(mesh, { ratios, error, minGain })` | experimental | a chain of LOD levels in one pass, built in time slices with `step(budgetMs)` |
| `createAutoLod(world, { ratios, errorPx, hysteresis, fade, workers, budgetMs })` | experimental | automatic LOD: `add(root)` builds chains in workers (or on a frame budget) and selects by screen-space error with hysteresis and a dithered cross-fade |
| `buildProxy(roots, { ratio, triangles, material, lockBorder })` | experimental | HLOD: merge every mesh under `roots` into one vertex-coloured, simplified mesh |
| `buildProxyAsync(roots, options, workers)` | experimental | the same with the simplifier in a worker |
| `createSimplifyWorkers(count)` | experimental | a small pool of simplifier workers (falls back to the main thread) |
| `createInstances(world, { source, matrices, impostor, cell, maxDistance })` | experimental | instanced drawing with per-instance frustum culling and per-instance LOD on the CPU, an octahedral impostor as the last level |
| `bakeImpostor(world, object, { frames, tile })` | experimental | hemi-octahedral impostor atlas (albedo + alpha, normal) of an object |
| `impostorMaterial(world, impostor, params)` | experimental | the lit billboard material that blends the atlas frames nearest the view |
| `createOcclusion(world, { margin, confirm, cutMetres, cutDegrees })` | experimental | occlusion culling from the previous frame's depth (max-depth pyramid, async readback, CPU test; camera cuts show everything) |
| `onView(scene, camera, before, after)` | experimental | run a function before / after every render of the scene through that camera (not the shadow pass); returns `off()` |
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
| `writeGLB(root, { clips, meshopt })` | experimental | a binary glTF of an object tree: nodes, meshes, skins, standard-material factors, embedded images, animation clips (clip `userData` as extras); `meshopt: true` compresses vertex streams (EXT_meshopt_compression, own encoder) |

Model import, `@miragekit/core/assets` (opt-in subpath, [import.md](import.md)):

| export | stability | what it is |
|---|---|---|
| `createAssets(world, { decoders, adapt, anisotropy, workers })` | experimental | glTF / GLB import with a reference-counted cache: `load(urlOrBytes, { key, path, scale, shadows, collide, adapt })`, `instantiate`, `instances`, `retain`, `release`, `refs`, `get`, `stats`, `dispose`; Draco, meshopt and KTX2 decoders start only for files that name them; materials are patched into the world's fog, shadows and light; `collide: 'mesh' \| 'box' \| 'hull' \| false` says what the model adds to the walk grid and Rapier |
| `gltfExtensions(buffer)` | experimental | the `extensionsUsed` of a .glb or .gltf buffer, without loading it |
| `decoders` | experimental | from `@miragekit/core/assets-decoders`: three's Draco and Basis decoder files as Vite `?url` imports (a single-file build inlines them); pass to `createAssets` |

| `viewModelDepth(root, { near, active })` | experimental | a first-person view model drawn with its own near plane (default 1 cm) while writing the camera's true depth, so parts that come toward the eye are not clipped; `active(on)` switches it per frame; returns `{ count, materials, active }` |
| `viewModelShaders(vertexShader, fragmentShader, near)` | experimental | the shader rewrite `viewModelDepth` applies, for a custom material; `null` when the shaders cannot be patched |

| `createFlash(world, settings)` | experimental | lightning: a flash envelope driving the shared flash uniforms, a bolt in the sky, `strike()`; used by `createWorldRenderer({ flash })` (`world.flash`) |
| `flashConfig(option)`, `flashEnvelope(t, k)` | experimental | the flash option's defaults filled in; the three-pulse brightness of a strike at time `t` (scaled by `k`, e.g. a comfort setting) |
| `withFlash(hooks, options)`, `enableFlash(on)`, `flashEnabled()` | experimental | material hooks that add the flash's cold light and wet glint (open-sky surfaces); the global switch the wet layer reads |
| `FLASH`, `FLASH_GLSL`, `FLASH_LIGHT_GLSL` | experimental | the flash uniforms (`uFlash`, `uFlashDir`) and their GLSL, for custom materials |
| `skyStormConfig(option)`, `SKY_STORM_DEFAULTS` | experimental | the storm cloud deck of `sky: { storm }` (torn clouds lit from inside by the flash, a bright horizon band) |
| `channelWater(world, options)` | experimental | water in a straight open channel traced from its cross-section: refraction onto the bed, the opposite wall in the reflection, caustics, the walls' shadow, foam; returns the water mesh and the wall / bed geometry |
| `createPlumes(world, { budget, slices, far })` | experimental | lit volumetric steam / smoke plumes, all in one instanced draw |

## @miragekit/world

| export | stability | what it is |
|---|---|---|
| `definePlan(plan)` | stable | validate a site plan and fill defaults; throws listing every problem (also `@miragekit/world/plan`) |
| `contains(shape, x, z)` | stable | is a point inside a rect / circle / poly |
| `bbox(shape)` | stable | bounding rectangle of a shape |
| `pathLength(path)` | stable | length of a plan path |
| `along(path, s)` | stable | point and direction at a distance along a path |
| `buildWorld(world, { plan, modules, shared, log, slice })` | stable | build modules in order with failure isolation; anchors, finalize, ambient volumes, report; `slice` (experimental, opt-in) yields to the frame between modules after a time budget and reports `slices` |
| `createStreamer(world, { plan, modules, shared, camera, concurrency, budget, uploadBytes, hysteresis, sync, onChange })` | experimental | modules that come into the scene near the viewer and leave when far: queued nearest first, built, compiled off-frame (`compileAsync`), textures uploaded over frames, cached in an LRU byte budget; `update(position)` once a frame |
| `regionOf(root, pad)` | experimental | the XZ rectangle an object covers (for a walk-grid region re-bake) |
| `createPartition(world, { bounds, size, build, load, hysteresis, proxy, origin, onCell, onProxy, onRebase })` | experimental | world partition on the streamer: square cells that load around the viewer, an HLOD proxy for every cell that is out, floating-origin rebasing; guide: `docs/big-worlds.md` |
| `createFloatingOrigin({ roots, threshold, snap, onRebase })` | experimental | the floating origin alone: `update(camera)` moves camera and roots back by multiples of `snap` |
| `LAYER` | stable | `{ VIEW: 0, COLLIDE: 2 }` |

The module interface (`name`, `build`, `finalize`, `anchors`, `ambientVolumes`, and the `ctx` fields) is stable;
see [world-protocol.md](world-protocol.md).

Gaussian splats, `@miragekit/world/kits/splat` (opt-in subpath, world README "Gaussian splats"):

| export | stability | what it is |
|---|---|---|
| `addSplats(ctx, data, options)` | experimental | one instanced draw of sorted splats in the world's light and fog; options `position`, `rotation`, `scale`, `minPixelSize`, `antialias`, `gain`, `light`, `effect`, `progress`, `worker`, `resort`, `depth`, `name`; returns `{ mesh, count, bounds, stats, progress, setEffect, changed, sortNow, sorted, dispose }` |
| `loadSplats(url, { fetch })` | experimental | fetch and parse `.splat`, 3DGS `.ply` (SH0) or a SOG `meta.json` with its webp textures |
| `parseSplat(buffer)`, `parsePly(buffer)`, `parseSog(meta, images)` | experimental | the parsers, to the kit's data shape `{ count, center, scale, rot, color }` |
| `splatEffects.reveal(options)`, `splatEffects.dissolve(options)` | experimental | built-in effects (GLSL hooks on centre, rotation / scale and colour), driven by `progress` |
| `splatSorter()`, `packSplats(data, row)`, `splatBounds(data)` | experimental | the depth sort (the worker's code), the texture packing and the data bounds, for tests and tools |

## @miragekit/play

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
| `createNavGrid(grid, { coarse, step, head, drop, radius })` | experimental | NPC navigation on the walk grid: per-radius fit bits (the walker's own test), `findPath` (coarse A* + cell A* + string pulling), `flowField`, `block` / `unblock` dynamic obstacles (box, cylinder, turned box `obb`), `visible`, `nearest`; `nav.grid` is the walk grid with the obstacles in. Areas with costs (`setArea`, `setAreaCost`, `findPath(..., { costs })`) and off-mesh links (`link({ from, to, type, cost, time, canEnter, traverse })`, `unlink`, `links`; a waypoint that crosses one carries `.link`): `docs/navigation.md` |
| `createNavAgent(nav, { radius, speed, pos, arrive })` | experimental | an NPC: a walker of its own radius steered along `findPath` waypoints or a flow field (`setGoal`, `update(dt)`); re-plans on edits and when stuck; never steps onto a cell it does not fit; crosses off-mesh links (`onLink`), takes `costs` / `canUse` |
| `createNavCrowd(nav, { separation, range })` | experimental | separation steering for many agents (`add`, `remove`, `update(dt)`) |
| `createSolids(grid)` | experimental | a walk grid with moving shapes composed in at query time (doors, lifts, turntables, crates): `add({ box, cylinder, sphere, pos, yaw, kind })`, `solid.set({ pos, yaw })`, `groundSolid`, `solidAt`, `addVolume({ type: 'ladder' or 'water', box })`, `onChange`, `push`; anything that takes a walk grid takes it (`docs/character.md`) |
| `gridRay(grid, from, to)` | experimental | 0..1: the fraction of a segment that is clear on a walk grid (cameras, sight) |
| `airAt(grid, x, y, z)` | experimental | true when the point is in the air of its column |
| `volumeAt(volumes, type, x, y, z)` | experimental | the ladder / water volume holding a point, or null |
| `createMover(grid, { pos, body })` | experimental | the walker plus coyote time, jump buffering, variable jump height, sprint, crouch with a ceiling check, slope slide, ladders, swimming, mantling, riding and pushing solids; walker-shaped (`createPlay({ walker })`, @miragekit/net's `applyInput`), `mode`, `save` / `restore` |
| `driveAnimator(mover, animator)` | experimental | writes the mover's mode, speed, grounded and crouch into an animator's parameters and fires `jump` / `land` |
| `MOVER` | experimental | the mover's default body numbers (`BODY` plus sprint, crouch, coyote, buffer, slope, climb, swim, mantle, push) |
| `MOVER_MODES` | experimental | the mode names: idle, walk, run, sprint, crouch, jump, fall, slide, climb, swim, mantle |
| `createFollowCamera(grid, { mode, distance, height, shoulder })` | experimental | a third-person spring arm that shortens against the walk grid and its solids, and a first-person eye: `turn`, `update(dt, mover)`, `apply(camera)`, `forward()` |
| `linkSolids(space, physics)` | experimental | mirrors `createSolids` shapes into a Rapier world (`createPhysics` or `{ R, world }`): `pre()` copies kinematic poses and pushes in, `post()` copies dynamic poses back; `addMover` adds the character as a kinematic capsule |
| `carveSolids(nav, space, { tolerance })` | experimental | every solid becomes a `nav.block` obstacle that follows it; `update()` re-blocks what moved (incremental re-bake) |
| `createPathQueue(nav, { budgetMs, max })` | experimental | path queries by priority within a per-frame budget: `request(from, to, opts)` returns a promise with `cancel()`, `update()` runs them |
| `smoothPath(nav, path, { radius, corner })` | experimental | rounds a path's corners with arcs the navigation accepts; link waypoints stay |
| `pathLength(path)` | experimental | metres along a path |
| `createCrowd(nav, { max, neighbours, range, horizon })` | experimental | ORCA local avoidance for hundreds of agents of different radii in typed arrays: `add`, `setGoal` (queued path), `setField`, `setVelocity`, fixed agents (the player), off-mesh link traversal (`onLink`), `actor(i)` for the behaviours |
| `bt` | experimental | behaviour-tree nodes: `sequence`, `selector`, `parallel`, `invert`, `succeed`, `repeat`, `cooldown`, `timeout`, `wait`, `condition`, `action` |
| `createBehaviorTree(root, { actor, nav, senses, perception })` | experimental | runs a tree with a blackboard: `tick(dt)`, `active()`, `describe()`; perception writes `target`, `lastKnown`, `heard` |
| `createBlackboard(init)` | experimental | key / value store with write times (`age`) and change listeners |
| `createSenses(grid)` | experimental | sight cones occluded by the walk grid (`sees`) and noise events (`noise`, `hears`) |
| `agentActor(agent)` | experimental | wraps a `createNavAgent` so the behaviours can drive it |
| `patrol(points)` | experimental | behaviour: walk the points in turn |
| `chase({ reach })` | experimental | behaviour: run at the blackboard's `target` |
| `flee({ distance })` | experimental | behaviour: get `distance` away from the target |
| `investigate()` | experimental | behaviour: go to `lastKnown` or `heard`, wait, forget |
| `follow({ distance })` | experimental | behaviour: keep `distance` from the target |
| `guard({ points, onCatch })` | experimental | chase what is seen, investigate what was seen or heard, else patrol |
| `createNavDebug(nav, { radius })` | experimental | debug draw: fitting cells by area, carved cells, links, paths, crowd velocities, a tree as text |
| `createXR(play, opts)` | experimental | WebXR: Enter VR / Enter AR buttons, the walker in a headset, teleport, snap turn, in-world game prompts, AR table model; hand tracking (pinch, point-and-pinch teleport), `navigator.xr.offerSession` / `autoEnter` for hosts without a DOM, labels in a built-in glyph font where Canvas 2D draws no text (`opts.offer`, `autoEnter`, `hands`, `text`; `docs/xr.md`) |
| `xrSupport()` | experimental | `{ vr, ar }`: which immersive sessions the browser offers; pass `vr \|\| ar` as the world's `xr` option |
| `createXR` options `post`, `budget`, `profile`, `posture`, `bounds`, `interact`, `arFeatures` | experimental | opt-in XR parts ([xr.md](xr.md)): the post chain per eye, the frame-time governor, device defaults, height calibration, the play-area fence, interaction, AR features; `xr.post`, `xr.quality`, `xr.setLevel(i)`, `xr.calibrateHeight()`, `xr.anchor()`. Exercised only in an emulated session |
| `createXRPost(world, { msaa, ao, bloom, lut, depth, scale })` | experimental | the engine's post chain per eye into the XR layer (`render(T, frame)`, `setLevel`, `stats`) |
| `xrEyePost(post, level)`, `xrEyeSize(w, h, scale)`, `XR_POST_OFF` | experimental | an eye's post settings (temporal and lens passes off), its pipeline size, the passes a headset never gets |
| `XR_PROFILES`, `xrProfile(nameOrUA)` | experimental | default quality per device class (Quest 2, Quest 3, Vision Pro, PC VR); none tested on hardware |
| `createXRGovernor({ hz, levels, high, low, window, drops, calm, hold, warm })` | experimental | frame-time governor: `update(cpuMs, intervalMs)` -> level index; steps down before frames drop, up after calm |
| `XR_LEVELS`, `XR_SCALE_LEVELS` | experimental | the governor's ladders with and without the post chain |
| `heightOffset(posture, eye, headY)`, `boundsDistance(polygon, x, z)` | experimental | standing / seated rig lift; distance to the play area's edge |
| `createXRInteraction({ physics, reach, rayReach, ground })` | experimental | grab (near and ray), throw (Rapier or ballistic), two-handed turn and scale, `snapZone`, `pokeable`, canvas UI `panel` by ray and poke, haptic pulses; fed pointers by `createXR` |
| `createVelocityTracker(window)`, `twoHandTransform(a0, b0, a1, b1, out, range)`, `pokeTest(local, w, h, state)`, `POKE` | experimental | the interaction's pure parts: throw velocity, the two-hand transform, the fingertip press test and its thresholds |
| `createXRAR(world, { anchors, planes, light, domOverlay })` | experimental | immersive-ar features: anchors, detected planes, light estimation onto the sun and a light probe, DOM overlay |
| `shadowGround({ size, opacity })` | experimental | a ground that draws only the shadows cast on it (AR passthrough) |
| `createAnimator(root, clips, { parameters, layers, rootMotion, fixedStep, events })` | experimental | the animation controller ([animation.md](animation.md)): per-layer state machines with cross-fades and conditions, 1D / 2D blend spaces on one phase, masked and additive layers, root motion returned from `update(dt)`, clip events, `snapshot` / `restore`, `poseClip`; `post` hooks for IK |
| `blend1d(points, x)`, `blend2d(points, x, y, mode)` | experimental | the blend-space weights on their own |
| `rootMotionInput(move, heading, body, dt)` | experimental | a root-motion step as the input `walker.update` takes, so clips drive the walker and the walk grid still decides where it may go |
| `solveTwoBone(upper, lower, end, target, { pole, hint, weight })` | experimental | analytic two-bone IK in world space (arms, legs) |
| `solveLookAt(bones, target, { share, limit, weight })` | experimental | turn a bone or a chain (neck, head) to face a point, within a limit |
| `createFootIK(root, { ground, legs, hips })` | experimental | foot placement: each foot on its own floor (`grid.groundAt`), hips lowered to reach, feet pitched on slopes; `update(dt)` after the pose |
| `humanoidRoles(root)`, `humanoidMap(source, target)` | experimental | humanoid bones found by name (Mixamo-style, `.L` / `_l` / `Left` spellings) and the bone map between two skeletons |
| `retargetClip(clip, source, target, { map, scale, matchRest })` | experimental | a clip baked for another humanoid skeleton: world-space rotation deltas with rest poses matched, hip travel scaled by hip height, events kept |
| `createTimeline({ tracks, duration, loop })` | experimental | a sequencer on one clock: camera, transform, animation, audio and event tracks; `play`, `pause`, `seek(t)` (the picture depends on `t` alone), `update(dt)` |
| `createRigCharacter(root, clips, { clipNames, layers, rootBone, footIK, look })` | experimental | an imported rigged model as the play character: `createPlay(world, { character: () => createRigCharacter(...) })`; set `ground` for foot placement, `lookTarget` for the head |
| `createRigModel({ material, colors })` | experimental | a rigged humanoid authored in code (20 bones, 880 vertices, T-pose, nine clips with root motion and foot events): the test rig of the checks and the anim demo |
| `RIG` | experimental | that rig's measures and clip speeds |

## @miragekit/game

| export | stability | what it is |
|---|---|---|
| `startGame(world, opts)` | stable | physics, character, game state, input, audio, overlay and play in one call |
| `createGame({ id, version, migrate })` | stable | entities, flags, inventory, events, zones, saves |
| `createPhysics(scene, { gravity })` | stable | Rapier world: static colliders, bodies, hinged doors, character |
| `createInput({ target, bindings, deadzone })` | stable | the action map over keyboard, mouse, gamepad and touch |
| `DEFAULT_BINDINGS` | stable | default keys per action |
| `ACTIONS` | stable | the action names |
| `createAudio({ volumes })` | stable | Web Audio buses and the procedural sounds; `add(name, sound)` for your own (a buffer, variants, or a factory of the context), before or after `unlock()` |
| `SURFACES` | stable | footstep surfaces: `stone`, `gravel`, `grass`, `wood` |
| `createUI(opts)` | experimental | the HTML overlay (HUD, menus, touch controls); `opts.strings` / `ui.setStrings(table)`: its text in another language (`docs/ui.md`) |
| `UI_STRINGS` | experimental | `createUI`'s text table in English: the keys a game's table may set |
| `PAD` | experimental | default gamepad buttons per action |
| `loadRapier()` | experimental | load the Rapier WASM ahead of `createPhysics` |
| `createPhysicsKit(phys, { hz, maxSteps, interpolate, layers, profile })` | experimental | the physics kit (docs/physics.md): rigid bodies with box / ball / capsule / hull / mesh / compound colliders, materials, layers, CCD, sensors, contact events with impulse, ray / shape casts and overlaps, fixed step with interpolation, state hash; opt-in, `createPhysics` unchanged |
| `PHYSICS_MATERIALS` | experimental | the built-in materials (default, wood, stone, metal, rubber, ice) |
| `createJoints(kit)` | experimental | fixed, ball, cone, hinge, slider, spring, rope and six-axis joints with limits, motors and a break force |
| `createForces(kit)` | experimental | water volumes (buoyancy), explosions, kinematic platforms that carry bodies and the character |
| `createVehicle(kit, object, { half, mass, wheels, engine, brake, topSpeed, maxSteer, grip })` | experimental | a ray-cast wheel vehicle on a kit body |
| `createRagdoll(kit, model, { parts, mass, layer, settle, hitboxes })` | experimental | a ragdoll for a skinned rig: animated, ragdoll, partial, active, and the blend back |
| `RAGDOLL_HUMANOID` | experimental | the default part list (14 parts) for humanoid bone names |
| `createPhysicsDebug(kit, scene, { colliders, joints, contacts, stats })` | experimental | debug draw of colliders, joints and contacts, and a stats line |
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
| `createUIKit(opts)` | experimental | the UI toolkit on the DOM: reactive descriptions, layout, themes, layers (`docs/ui.md`; widgets in `@miragekit/game/ui-widgets`) |
| `createI18n({ locale, tables })` | experimental | string tables, plurals and formats through `Intl`, runtime language switch, direction and font stack |
| `createFocusNav({ root, input })` | experimental | spatial focus for keyboard and gamepad, focus scopes, last-used device |
| `createWorldUI({ kit, camera })` | experimental | labels, markers and health bars anchored to 3D points, with occlusion and distance fade |
| `createCanvasUI({ description })` | experimental | a widget panel drawn into a texture, for screens in the world and XR |
| `createKitUI(opts)` | experimental | `createUI`'s overlay rebuilt on the toolkit: pass as `startGame`'s `ui` |
| `createDestructibles(target, options)` | experimental | destructibles (docs/destructibles.md): props over meshes, instances, batched ids or merged ranges that crack, dent, shatter, spill, burn, fall and explode; `hit` (rays with penetration), `blast` (falloff, cover), staged material classes, pooled debris and marks, lamps out, behaviours, movers, actors, tally, snapshot / restore; opt-in, nothing made until something breaks |
| `registerDestructData({ materials, effects, fallback, addSounds })`, `destructData()` | experimental | the class table registries are made from (`@miragekit/assets/destruct` registers the library's on import; without it: a `generic` class and an `actor`, no effects, no sounds) |
| `DAMAGE_KINDS` | experimental | `bullet`, `pellet`, `blast`, `melee`, `emp`, `fire` |
| `BROKEN_STATES` | experimental | broken-state geometry in a unit box: a shattered pane rim, a split crate, a dented panel, a flat tyre |

The synthesis kit, `@miragekit/game/sounds` (opt-in subpath, [sounds.md](sounds.md)): sounds made in code from
definitions `{ n, loop?, render(sampleRate, v) }`. Every export is experimental.

| export | stability | what it is |
|---|---|---|
| `renderSoundDef(def, sampleRate, variant)`, `soundBuffers(ctx, def)`, `addSoundDefs(audio, { name: def }, { prefix })` | experimental | one variant as a Float32Array; every variant as AudioBuffers; give definitions to `createAudio` (made at unlock) |
| `makeRng`, `hash`, `biquad`, `chain`, `env`, `noiseLayer`, `thumpLayer`, `modesLayer`, `toneLayer`, `ROOMS`, `room`, `master`, `one`, `fold`, `click`, `scrape`, `TAU` | experimental | the synthesis kit, for sounds of your own |

## @miragekit/net

Multiplayer for walked worlds; all of it experimental and opt-in (nothing else imports it). Guide and numbers:
`docs/multiplayer.md`. The Node server is not in the index: `import { createServer } from '@miragekit/net/server'`
(`createServer({ protocol, grid, dir, setup, conditions, origins, host })`, 127.0.0.1 by default), and the
`mirage-net` command (`serve`, `bake`) wraps it.

| export | stability | what it is |
|---|---|---|
| `createRoom(options)` | experimental | the authoritative room: runs the play walker on a walk grid from client inputs at `tickRate` (must divide 60); `accept(transport)`, `spawn` / `despawn`, `rpc`, `emit`, `hitscan` (lag compensated), `serialize` / `restore`; no GPU or DOM |
| `createClient(options)` | experimental | prediction, reconciliation and interpolation: `walker` (give it to `createPlay`), `entities`, `input`, `rpc`, `on`, `stats` |
| `connectLobby(url)` | experimental | the lobby client: `list`, `create`, `join`, `host`, `leave` |
| `joinRoom(options)` | experimental | join a room by code wherever it runs; resolves to a session `{ client, room, mode, lobby }` |
| `hostRoom(options)` | experimental | run the room in this page (host mode); members come over the relay or WebRTC; migrates when the host leaves |
| `defineProtocol(def)` | experimental | entity, RPC and event schemas compiled to quantised bit layouts; both ends compare `hash` |
| `field` | experimental | schema field makers: `q`, `angle`, `u`, `bool`, `f32`, `str`, `pos` |
| `kitProtocol(options)` | experimental | a ready protocol: named players with a score, `pickup` entities, `chat` / `take` / `tag` RPCs |
| `installKit(room, options)` | experimental | the server side of `kitProtocol`: pickups with reach checks and respawn, chat rate limit, tag by `hitscan` |
| `createLoopbackNetwork(defaults)` | experimental | in-memory transports with seeded latency, jitter, loss, duplication and reordering on a virtual clock |
| `conditioned(transport, conditions)` | experimental | the same network conditions around any real transport; the conditions object stays live |
| `webSocketTransport(target)` | experimental | a transport over the platform's `WebSocket` (browser, Node 22) |
| `rtcTransport(options)` | experimental | a transport over an unreliable, unordered WebRTC data channel; signalling is the caller's (the lobby's) |
| `preferTransport(fallback, better)` | experimental | start on one transport, switch to the other when it opens |
| `createChannel(options)` | experimental | acks, a reliable ordered stream over unreliable packets, rtt and loss estimates |
| `serializeGrid(grid)` | experimental | a walk grid as bytes (what `mirage-net bake` writes) |
| `deserializeGrid(bytes)` | experimental | bytes back to a walk grid, validated before anything is allocated |
| `bakeGridCPU(triangles, options)` | experimental | a walk grid from triangles without a GPU (coarser than the GPU bake: do not mix the two in one room) |
| `boxTriangles(boxes)` | experimental | triangles for `bakeGridCPU` from boxes |
| `sceneTriangles(scene)` | experimental | triangles for `bakeGridCPU` from a three.js scene's meshes |
| `createNetOverlay(client, options)` | experimental | debug overlay: rtt, loss, bytes/s per entity type, prediction error; keys change the simulated network |

## @miragekit/editor

A visual editor in the browser against a live world; all of it experimental and opt-in (nothing else imports it).
Guide, keys, numbers and limits: `docs/editor.md`. The command is `mirage-editor <project dir> [--write] [--port n]
[--layer file.json] [--open]`; the Node server behind it is not in the index: `import { startEditor } from
'@miragekit/editor/server'` (`startEditor({ root, port, write, layerFile })`, 127.0.0.1 only). The page side of a
project imports `@miragekit/editor/runtime` (the last six rows). The editor's client (`src/client`) is not an API.

| export | stability | what it is |
|---|---|---|
| `LAYER_VERSION` | experimental | the version number written into an edit layer (1) |
| `emptyLayer()` | experimental | `{ version, set, objects, nodes, env, timelines }` with nothing in it |
| `normalizeLayer(layer)` | experimental | a checked copy of a layer with every section present; throws on a layer that would not load |
| `isEmptyLayer(layer)` | experimental | true for `{}` and for a layer whose sections are all empty |
| `applyEdits(plan, layer)` | experimental | the plan with the layer applied: `set` paths written into a copy, placed objects as `plan.objects` and as the fields their systems read (`lighting`, `audio.zones`, `nav.areas`, `triggers`, `spawns`); the plan object itself for an empty layer |
| `planHash(plan)` | experimental | 16 hex digits of a plan, independent of key order, the same in Node and in the page |
| `serializeLayer(layer)` | experimental | the text Save writes: JSON with sorted keys |
| `createDocument(plan, layer)` | experimental | the command stack: `exec(label, changes, { merge })`, `undo`, `redo`, `history`, `on`, `plan`, `layer`, `hash`, `dirty`, `markSaved`, `load` |
| `OBJECT_TYPES` | experimental | the twelve placed-object types (`model`, `primitive`, `wall`, `light`, `probe`, `gi`, `audioZone`, `sound`, `vfx`, `nav`, `trigger`, `spawnPoint`) with their defaults and typed fields |
| `newObject(type, at, extra)` | experimental | a new placed object: the type's defaults plus a pose |
| `planElements(plan)` | experimental | every plan entry the editor can select: points, footprints, regions, paths, viewpoints, spawn |
| `schemaAt(schema, path)` | experimental | the node of `plan.schema.json` a plan path points at, or null |
| `fieldsFromSchema(schema, node, value)` | experimental | typed inspector fields (number, vector, color, enum, bool, string, asset, points, json) for a value |
| `editable(plan, layer)` | experimental | the runtime half: `plan`, `lighting(cfg)`, `apply(world, built)`, `attach(host)`, `hash()`; every call is a no-op for an empty layer |
| `createPlaced(world)` | experimental | the placed objects in a scene: `set(id, def)`, `get`, `ready`, `dispose` |
| `applyNodes(scene, nodes)` | experimental | write node overrides (pose, visibility, material values) onto the nodes at their scene paths |
| `applyEnv(world, env)` | experimental | apply environment edits: `time`, `date`, `wet`, `rain`, `post.<setting>`, `light2.<part>.<setting>` |
| `createTimelines(plan, world, placed)` | experimental | `plan.timelines` as `createTimeline` instances of `@miragekit/play`, bound to placed objects, nodes and the camera |
| `createTriggers(plan, { onEnter, onLeave })` | experimental | `plan.triggers` as a test of a position against the boxes, with enter and leave callbacks |

## @miragekit/tools

Command-line tools (no JS entry point). Stable: `mirage-playtest` (scenario format in the playtest skill),
`mirage-package`, `mirage-snap`, `mirage-deploy`. Experimental: `mirage-walktest`, `mirage-perf`, `mirage-e2e` (runs the `examples/` of the current folder or `--root`),
`mirage-gpu-load`, `mirage-still-pop`, `mirage-xr-stereo-check` (both eyes of an emulated session against the desktop frame, interaction, locomotion, AR), `mirage-xr-check` (WebXR in an emulated Quest 3; repository checks; some expect this repository's `examples/`). `mirage-ship` (web, PWA and wrapper scaffolds; `mirage-desktop-check` runs an Electron scaffold or its packaged app and checks it over DevTools; with the subpaths `@miragekit/core/platform`, `@miragekit/core/byte-targets` and `@miragekit/game/platform`: `docs/platforms.md`). The tools
need Chrome: `$CHROME`, or the usual install place on macOS, Linux and Windows.

## @miragekit/assets

**Business Source License 1.1, not MIT** ([packages/assets/LICENSE](../packages/assets/LICENSE)): the library's
content, which plugs into the MIT systems above. Sub-paths only (no root entry); `/presets` is reserved (empty).

### The surface recipes: `@miragekit/assets/surfaces`

Registered with core's framework on import ([surfaces.md](surfaces.md)). Every export is experimental.

| export | stability | what it is |
|---|---|---|
| `SURFACES.<kind>(options)`, `SURFACE_KINDS`, `METALS` | experimental | 35 kinds (27 bakeable, 8 per pixel: emissive and liquid), each a GLSL recipe plus numbers in measured ranges; the F0 of common metals |
| `createSurfaces(world, options)` | experimental | core's `createSurfaces` with these recipes registered |
| `registerSurfaces(framework)`, `KIND_GLSL`, `LIVE_GLSL` | experimental | register the kinds and the weathering decals with a framework (done on import); the recipes' GLSL |

### The sound library: `@miragekit/assets/sounds`

125 sounds made in code on game's synthesis kit ([sounds.md](sounds.md)). Every export is experimental.

| export | stability | what it is |
|---|---|---|
| `SOUNDS`, `SOUND_CATEGORIES`, `SOUND_SPACES`, `GUNS` | experimental | the sounds by name (`{ cat, n, loop, desc, render(sampleRate, v) }`), the seven categories, the three spaces a gun is heard in, the guns |
| `soundNames(cat)`, `renderSound(name, sampleRate, variant)` | experimental | the names of a category (or all); one variant as a Float32Array |
| `soundBuffers(ctx, name)`, `addSounds(audio, names, { prefix })` | experimental | every variant as AudioBuffers; give sounds to `createAudio` (made at unlock) |
| `renderShot`, `renderGatlingLoop`, `renderGatlingTail`, `renderRocketLaunch`, `renderExplosion` | experimental | the weapons' renderers with their arguments (gun, space, variant) |

### The destructibles' classes: `@miragekit/assets/destruct`

Registered with game's destructibles on import ([destructibles.md](destructibles.md)). Every export is experimental.

| export | stability | what it is |
|---|---|---|
| `DESTRUCT_MATERIALS` | experimental | the material classes as data: health, armour per damage kind, pierce, stages, debris, effects, sound, value |
| `DESTRUCT_EFFECTS` | experimental | the particle effects (vfx JSON) the destructibles use: glitter, dust, sparks, a short circuit, spray, splash, blast, steam, water, fire |
| `DESTRUCT_SOUNDS`, `destructSoundFactories()`, `addDestructSounds(audio)` | experimental | the break sound sets (`dx_break_<name>`), made in code; add them to a `createAudio` mixer |
| `registerDestruct(register)` | experimental | register the table with the system (done on import) |

### The cyber kit: `@miragekit/assets/kits/cyber`

Street props for a dense neon city, cars, civilian robots and the robot parts kit, all made in code (geometry, and
labels drawn into a canvas); assets README "The cyber kit". Every export is experimental.

| export | stability | what it is |
|---|---|---|
| `propKit(ctx)` | experimental | the shared label atlas and its six materials (`paint`, `metal`, `glow`, `lantern`, `clear`, `product`); `put(batch, geometry, material, matrix, color, rect)`, `instanced(geometry, base, items)`, `R` (cells), `texture`, `names`; cached on `ctx.shared.props` |
| `uvRect`, `tint`, `uvByHeight`, `hex` | experimental | geometry helpers: fit uv into a cell, a vertex colour, uv by height and angle, linear RGB from a CSS colour |
| `recorder(ctx)`, `track(batch, fn)`, `trackLamps(ctx, fn)`, `breakables(ctx)`, `breakablesLamp`, `markBatch`, `sinceMark` | experimental | what a builder records for the destructibles: the vertex ranges each prop adds to a merged batch, resolved to draw handles once it is finished, and its lamps |
| `surfaceLib(ctx)` | experimental | the surface library per world (cached on `ctx.shared.surf`): bake sizes by quality and role, `surf(spec, options, { post, decl })`, `painted(rgb)`, `shade(kind, rgb)` |
| `canGeo`, `bottleGeo`, `wineGeo`, `cupGeo`, `boxGeo`, `packGeo`, `capsuleGeo`, `spiralGeo`, `glassGeo`, `bowlGeo`, `jarGeo` | experimental | product shapes with their uv laid out for an atlas cell |
| `spiritBottle`, `tumbler`, `bowls`, `pot`, `noodleBasket`, `riceCooker`, `chopsticks`, `skewers`, `stool`, `goodsBox`, `jar`, `goodsRack`, `gasBottle`, `extinguisher` | experimental | counter and shop goods: `(P, batch, geom, matrix, ...)` |
| `paperLantern`, `bulbString`, `streetLamp`, `bulkhead`, `tubeFixture`, `floodlight`, `beacon`, `signalHead` | experimental | light fixtures (the visible fitting; the light is the host's) |
| `bin`, `crate`, `bag`, `cardboard`, `acUnit`, `junctionBox`, `bollard`, `jersey`, `newsBox`, `bench` | experimental | street furniture: `(P, batch, geom, matrix, ...)` |
| `parkedCars(ctx, P, batch, list, proxyBox, { lamp })`, `carMaterials(ctx)`, `CAR_DESIGNS` | experimental | three designs of an invented marque in brushed steel, pearlescent paint and tinted glass, with rain |
| `rainBeads(hooks, options)` | experimental | rain beads, runs and a film as material hooks (inside core's `withWet`) |
| `buildMachines(ctx, spec)`, `machineUnits(group)` | experimental | civilian robots (domestic humanoids with a real gait, umbrellas in the rain, rail and pedestal vendors, a robot-dog courier, a floor scrubber, a notice totem, a broken one), animated; returns `{ group, update(t), count, tris, units() }` |
| `humanoid`, `quadruped`, `quadrupedDims`, `humanoidRig`, `part`, `mergeParts`, `moved`, `tf`, `ext`, `drum`, `link`, `cover`, `cable`, `decal`, `decalTexture`, `decalUV`, `COL`, `JOINTS`, `LEN`, `robotMaterials(world)`, `robotSurfaces(world)` | experimental | the robot parts kit: bodies as parts per bone at three levels of detail, decals, powder-coat and metal materials |
| `GAITS`, `bipedLegs`, `trotLegs`, `legIK` | experimental | gaits: a biped's and a quadruped's legs at a phase, two-bone IK |
| `humanoidMeshes`, `robotClips`, `CLIP_SPEED`, `createHound` | experimental | the rig: a humanoid skinned rigidly to @miragekit/play's bones, idle / walk / run clips with root motion, a robot dog posed in code |
| `corrugated`, `canopy`, `WORN_DECL`, `worn`, `interiorMaterial`, `textAtlas`, `atlasQuad` | experimental | corrugated sheet, canopies, worn painted metal hooks, shop interiors behind glass (interior mapping), text atlases |

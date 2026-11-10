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
`/kits/terrain`, `/kits/water`, documented in the world README). Which subpaths stay supported is open:
[API-CANDIDATE.md](API-CANDIDATE.md) lists them; until a whitelist is decided, treat subpaths other than the kits,
`@mirage/core/rng` and `@mirage/world/plan` as internal. Types: each package's root entry declares `types`
([TYPES.md](TYPES.md)).

> The split 1.0.0 ships with, as proposed in the 1.0 review (docs/review-1.0.md); the owner can still move names
> before the tag. After it, moving a name from experimental to stable is a minor release, the other way a major one.

## @mirage/core

| export | stability | what it is |
|---|---|---|
| `createWorldRenderer(config)` | stable | the renderer for one world: sky, light, shadows, post, day / night; returns the `world` object (fields in the core README) |
| `patch(material, hooks, G)` | stable | add GLSL hooks to a three.js material (vertex, albedo, roughness, normal, emissive, lighting, output) |
| `PROC` | stable | ready hook sets: `plaster`, `stone`, `wood`, `terracotta` |
| `createTextures(world, { manifest, url, anisotropy })` | stable | the optional world-space texture layer for CC0 PBR sets |
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

## @mirage/world

| export | stability | what it is |
|---|---|---|
| `definePlan(plan)` | stable | validate a site plan and fill defaults; throws listing every problem (also `@mirage/world/plan`) |
| `contains(shape, x, z)` | stable | is a point inside a rect / circle / poly |
| `bbox(shape)` | stable | bounding rectangle of a shape |
| `pathLength(path)` | stable | length of a plan path |
| `along(path, s)` | stable | point and direction at a distance along a path |
| `buildWorld(world, { plan, modules, shared, log })` | stable | build modules in order with failure isolation; anchors, finalize, ambient volumes, report |
| `LAYER` | stable | `{ VIEW: 0, COLLIDE: 2 }` |

The module interface (`name`, `build`, `finalize`, `anchors`, `ambientVolumes`, and the `ctx` fields) is stable;
see [world-protocol.md](world-protocol.md).

## @mirage/play

| export | stability | what it is |
|---|---|---|
| `createPlay(world, opts)` | stable | walk / fly / game view / orbit, input, still refinement; returns `play` (fields in the play README) |
| `createCharacter(world, { palette })` | experimental | the procedural traveller of the game view (rig, palette, locomotion); hosts can add its `root` to their own scene |
| `mountWorld(opts)` | stable | build a world into a host page's own renderer (the embed API) |
| `bakeWalkGrid(world, opts)` | stable | the walk grid baked from the geometry |
| `createWalker(grid, { pos, body })` | stable | the walk-grid character |
| `BODY` | stable | the character's sizes and speeds |
| `makeGrid(data)` | experimental | a grid from raw arrays (tests, saved grids) |
| `MAXL` | experimental | floors per grid column (4) |

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

## @mirage/tools

Command-line tools (no JS entry point). Stable: `mirage-playtest` (scenario format in the playtest skill),
`mirage-package`, `mirage-snap`, `mirage-deploy`. Experimental: `mirage-walktest`, `mirage-perf`, `mirage-e2e` (runs the `examples/` of the current folder or `--root`),
`mirage-gpu-load`, `mirage-still-pop` (repository checks; some expect this repository's `examples/`). The tools
need Chrome: `$CHROME`, or the usual install place on macOS, Linux and Windows.

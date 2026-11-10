# Notes between modules — hello-courtyard

Convention: `docs/world-protocol.md`. Build order: ground, walls, vegetation, props.

## ground
Land (hills beyond 40 m), paving (15 × 15 m), the basin (rim 0.6 m) and spout at `plan.footprints.basin`.

## walls
Four walls (`plan.court`: half 7.5 m, 3.8 m, 0.6 m), pointed gate south (2.4 × 2.3 m), west arcade (4 round
arches 1.9 m), windows N / E, plinth, coping, the bench and the pergola.

| anchor | pos is | extra | count |
|---|---|---|---|
| `lamps` | the lantern's ring: two on the pergola posts' south faces, the west arcade pier, the gate wall | `rotY` out of the surface; `wall` (m from the wall face, only on the two wall lamps) | 4 |

## vegetation
The palm at `plan.points.palm` (trunk proxy r 0.27 m × 2.4 m; fronds and the trunk tube do not collide) and the
cypresses in `plan.cypresses`.

## props
Nine seeded jars at `plan.points.jarsNorthWest` / `jarsGate`; in finalize a lantern with a warm point light on
every `lamps` anchor; with detail, soot on the wall above the anchors that have `wall`.

## detail (close-range relief, optional)
`@mirage/core` `relief.js`, on by default here; **`?nodetail`** turns it off (main.js and embed.js pass
`shared.detail`; off, every material and every wall compiles and builds exactly as before: same hooks, same
geometry). The relief's reach follows the quality: low off, medium 5.6 m, high 8 m (`setRelief`).
- **Materials** (`modules/materials.js`): one parallax step and the relief's own shadow toward the key light on
  the photo sets (`mgTexWallRelief` / `mgTexGroundRelief`, `tex.material(…, { relief })`): plaster 2.4 cm, land
  3 cm, ashlar 3 cm, paving 2.5 cm; the plaster also gets a hand-applied render (undulation 9 mm, trowel swipes
  6 mm, `renderHeight` / `renderShade`). Planks, clay, iron and water are unchanged.
- **Geometry** (`modules/walls.js`): the walls' arrises rounded by 5 cm (`geom.wall({ round })`: openings, ends,
  outer corners), coping, plinth and gate frame as `geom.softBox` (3.5 cm); all inside the old bounds, so the walk
  grid and the playtest results do not change. Sills (8 cm) and gate leaves stay sharp.
- **Soot** (`modules/props.js`): `geom.sootPlumes` above the lamps that hang on a wall (the arcade pier and the gate
  wall), not over the pergola posts.
- **Cost** (1440×900, Apple M4 Pro, uncapped, `quality=high`, A = detail, B = `?nodetail`, alternating; the GPU was
  shared with other agents, so the runs are noisy, and the page timer has 0.1 ms steps): `mirage-perf` walk from the
  spawn +0.23…0.32 ms (+5…9 %), game view (orthographic: no relief branches, only the geometry) +0.1 ms (+2…4 %),
  stills +2 %; 1–3 m from a wall that fills the screen (4 spots, 150 moving TAA frames each, 4 repeats)
  +0.4…0.6 ms (+10…17 %), about 4.2 against 3.6 ms. Triangles 130.5 k against 120.1 k, draw calls 52 against 50.
  TAA flicker on the playtest path 4.78 against 4.76; stills stay bit-identical (`verify.mjs`: sameFrameIndex 0).
- **Left out**: the source's automatic rewrite of texture-library calls (Mirage's materials opt in explicitly
  instead). `mgRlArris` and `mgRlLip` are in core, but nothing here uses them yet (no plaster losses, and the walls
  carry no along-wall tangent).

## light2 (lamp shadows, reflections, volumetric light, mixed bloom; optional)
`?light2=1` (parts off with `&l2=nols,nossr,novol,nobloom`). The four lantern PointLights hold the four lamp-shadow
slots at night: the pergola slats fan their shadows up the north wall, the posts shadow the wall behind them. By day
no slot is used (the lamp level is under 0.15). The basin's water reflects the pergola and the walls at noon and the
lantern at night (screen-space, misses fall back to the environment map). Volumetric light: shafts through the
arcade toward a low sun, a warm haze within 5 m of each lantern.

Frame cost, 1440 × 900, 1 sub-frame + TAA, Apple M4 Pro, parts toggled in one page and interleaved (6 rounds x 40
frames; `none` = light2 compiled in, every part off):

| view | none | all on | lamp shadows + their in-scatter | reflections | volumetric |
|---|---|---|---|---|---|
| hero 21:00 | 4.01 ms | 5.12 ms | ~1.0 ms | ~0.2 ms | ~1.0 ms |
| pergola 21:00 | 3.96 | 4.45 | ~0.4 | ~0.1 | ~0.2 |
| basin 21:00 | 3.60 | 4.22 | ~0.2 | ~0.1 | ~0.1 |
| hero, golden hour | 3.82 | 4.06 | — | ~0.2 | ~0.4 |

(The parts share work: switching off lamp shadows also drops the lamps' in-scatter through the atlas.) A later run
was disturbed by another GPU job on the machine (every view at 11–13 ms) and is not used. Without `?light2` the
frames are bit-identical to before (checked on three views). Single file: 2.2 MB with both light2 and the relief.

## wet (wet surfaces, puddles, rain; optional)
`?wet=0..1` (`&rain=0..1`): `modules/materials.js` re-patches the paving (porosity 0.5, joints fill first through the
photo set's height `mgS.h` about its hMean, 1.4 cm per unit), the land (0.8, puddles 0.8), the plaster (0.85, no
puddles, damp band 0.45 m) and the ashlar (0.45, `mgS.h`) with `withWet` (@mirage/core wet.js); `&rain` adds
`addRain` (@mirage/world/kits/rain) to the scene. Without either flag nothing is re-patched or added. Planks, clay,
iron and the basin's water stay as they are; the pergola and the arcade do not shelter the ground (no occlusion).
`window.__mirage.wet` = `{ setWetness, setRain, rain }` for tools.
- **Off path** (built `dist/` of this branch against the base commit's, 1440 × 900, 6 sub-frames, 5 views: golden
  hero, night hero, golden hero + light2, night pergola + light2, noon basin): no flag, `?wet=0` and `?wet=0&rain=0`
  are all 0 px different. The first page a fresh browser loads differs from every later load of the same view by
  1/255 in a few hundred pixels at golden hour (also base against base): references are second loads.
- **Stills**: every wet / rain still renders identically twice in a page and across runs (the same hash).
- **Cost** (walking from the spawn, 1 sub-frame + TAA, `play.stop()` + step + render + 1-px readback, dry / wet 0.8 /
  wet 0.8 + rain 1 interleaved in one page, 8 and 12 rounds of 60 frames; the M4 Pro was shared with other jobs:
  the dry walk took 9.2–14 ms instead of ~4): wet +0.15…0.57 ms median per round (+2…5 %), spread −0.7…+2.4 ms;
  rain on top +0.0…0.25 ms. Draw calls 52 → 53 with rain (one).
- **Shimmer** (TAA orbit over the paving, `verify.mjs`'s second difference, grain off): flicker / motion 1.40 dry
  against 1.40 wet (golden), 1.46 / 1.46 (golden + light2), 1.43 / 1.43 (night + light2): no new sparkle.

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
`@miragekit/core` `relief.js`, on by default here; **`?nodetail`** turns it off (main.js and embed.js pass
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

## Soft sun shadows (contact-hardening; optional)
`?soft=1` (`&sunAngle=2` for a softer, larger sun; 0.53° is the real one). Walking frames (TAA) get the penumbrae the
still frames had from the sun-disc jitter: the palm's fronds blur on the paving, the pergola slats sharpen toward the
posts' feet, the arch-shaped patch of low sun on the north wall has the same soft rim walking and standing.

- **Still against walking** (6 frames: hero / pergola / basin, golden hour and noon; the walking frame after 32 TAA
  frames of a still camera): pixels more than 16 levels apart 4 400–38 800 without, 62–1 800 with (the rest is
  geometry anti-aliasing). A plate's shadow edge (10–90 %) at 1 / 3 / 8 m above the ground: 1.2 / 1.8 / 4.4 cm in
  both kinds of frame, against 1.5 / 2.1 / 4.3 cm for the old stills and ~1.3 cm everywhere for the old walking frames.
- **Frame cost**, 1440 × 900, 1 sub-frame + TAA, Apple M4 Pro, `quality=high`; in one browser, page A with `?soft=1`
  toggled live (`world.softShadows.on`), page B without it, the three interleaved in rotating order (8 rounds × 40
  frames, medians; two quiet runs, a third under another agent's GPU load not used):

  | view | without | on − without | on − off (same page) | off − without |
  |---|---|---|---|---|
  | hero, golden hour | 3.2–3.3 ms | 0.63 ms (one run; the other disturbed) | 0.54 | 0.14–0.16 |
  | pergola, golden hour | 2.9–3.0 | 0.57–0.64 | 0.35–0.36 | 0.22–0.23 |
  | basin, golden hour | 2.8 | 0.69–0.72 | 0.48 | 0.22–0.24 |
  | hero, noon | 3.0–3.1 | 0.58–0.67 | 0.43–0.47 | 0.16–0.22 |
  | pergola, noon | 2.9–3.2 | 0.82–0.85 | 0.55–0.61 | 0.20–0.31 |
  | basin, noon | 2.8–3.0 | 0.70–0.80 | 0.46–0.50 | 0.22–0.35 |

  With 6 / 4 / 8 taps instead of 8 / 5 / 12: on − off 0.31–0.36 ms (hero, basin at noon). The first version (uniform
  loop bounds, an indexed array, a sin / cos per tap) cost +1.6–3.2 ms and 1–1.9 ms even switched off.
- Without `?soft` the frames are bit-identical to before (12 frames: 3 views × golden hour / noon × still / walking,
  against the parent commit: 0 px). With it, still and walking frames are bit-identical between runs.
- With `?light2=1` the lamp shadows are unchanged; the Moon's shadows (the key light at night) soften as the Sun's.

## wet (wet surfaces, puddles, rain; optional)
`?wet=0..1` (`&rain=0..1`): `modules/materials.js` re-patches the paving (porosity 0.5, joints fill first through the
photo set's height `mgS.h` about its hMean, 1.4 cm per unit), the land (0.8, puddles 0.8), the plaster (0.85, no
puddles, damp band 0.45 m) and the ashlar (0.45, `mgS.h`) with `withWet` (@miragekit/core wet.js); `&rain` adds
`addRain` (@miragekit/world/kits/rain) to the scene. Without either flag nothing is re-patched or added. Planks, clay,
iron and the basin's water stay as they are; without `&wear=1` the pergola and the arcade do not shelter the ground.
`window.__mirage.wet` = `{ setWetness, setRain, rain, withWet }` for tools.
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

### `&wear=1`: puddles that follow the wear, shelter, rain rings, specular AA
With `?wet`, `&wear=1` gives the paving `wear` (a trodden path from the gate to the basin, x ≈ 0 for z > 2.4, and a
splashed, walked ring round the basin at 2.25 m, both broken by noise) and `shelter` (the pergola's strip along the
north wall): the water gathers on the path and round the basin instead of in noise blobs, with a thin darker rim,
and the strip under the pergola stays dry. `window.__mirage.wet.withWet` is there for tools.
`node packages/tools/src/wet-check.mjs examples/hello-courtyard/dist --before=<dist of the parent> --out=examples/hello-courtyard/out/wet --cost=10`
(960 × 600, Apple M4 Pro, headless Chrome):
- No flag, `?wet=0`, `?wet=0.9`, `?wet=0.9&planar=1`: byte-identical to the parent's build (close, grazing). With
  rain the rings' AA changes 16-25 k pixels of a view (puddles only).
- Ripples 0 (every material's `mgWetQ.x`) at rain 1 = the frame of rain 0, byte for byte. Rain 0.25 / 0.5 / 1: 66 /
  86 / 142 rings in the close view, 100 / 100 / 99.99 % of the changed pixels in the puddles.
- Specular AA off → on, grazing over the wet floor, worst 1 % of the floor's pixels (temporal second difference
  under TAA, camera held / drifting) and a 1-sample still's Laplacian energy: plain wet 0.9 + rain x1.06 / x1.04 /
  x1.14; `&wear=1&planar=1` x1.06 / x1.04 / x1.12; at 21:30 x1.09 / x1.09 / x1.07.
- Shelter: |wet − dry| 3.15 under the pergola against 14.5 on the open paving the same distance away.
- Programs: 53 → 54 after 7 more wet materials with other numbers (porosity, ripples, specAA, rim, band, two numeric
  shelters: the one is the shelter term).
- Cost, walking frames, `?wet=0.9&rain=1`, 10 interleaved rounds of 60 (two runs): before 2.40 / 2.40 ms, after
  2.30 / 2.40 ms median; after − before per round 0.00 ms (spread −0.50…+0.90, then −0.10…+0.10). Inside the noise
  at this size (the timer is 0.1 ms coarse in headless Chrome).
- `npm run test:determinism`: neon-district differs between redraws, also on the parent commit's build (not this).

## aoLit, auto exposure, dynamic resolution (optional)

`?aolit=1` (post.aoLit 1), `?ae=1` (post.autoExposure 0.5), `?dynres=1 | <fps>`. Off: 0 px against 5bbdd82 on
hero@golden, basin@12:00, pergola@21:00, gate@17:22 (1280 x 720, 8 sub-frames).

- **aoLit**: the exposed luminance here is about 0.05-0.2 in shade and 0.25-0.5 on sunlit plaster (hero, basin at
  noon), hence the fade between 0.1 and 0.32. At noon it removes about half of the AO's darkening (1.5 -> 0.77 /255
  mean), all of it on the sunlit fountain base; at golden hour, where most of the view is in shade, little changes.
- **auto exposure**: the views' log-mean exposed luminance is 2^-3.3 .. 2^-4.2 by day (gate, basin@12:00, corner,
  hero) and 2^-4.4 .. 2^-5.6 at dusk, night and dawn: aeKey 0.07 (2^-3.84), aeNight 1. At 0.5: hero@golden +0.12
  EV, basin@12:00 -0.06, pergola@21:00 +0.08, gate@17:22 +0.15, basin@06:30 about +0.8 (the dawn court is lifted
  most). Moving from sky to shade and back the EV eases (darkening 2.5/s, brightening 1/s); the same still frame
  meters the same EV before and after 360 moving frames.
- **dynamicRes**: at 2560 x 1440 with a 240 fps target the scale steps 0.9, 0.8, 0.7 and holds; still frames render
  at 2560 x 1440. Under @miragekit/play the output size stays put, so a still view settles (the review caught a loop).
- **All on** (light2 + aoLit + ae + soft shadows), 1280 x 720 walking: about +0.7 ms by day, +1.1 ms at night over
  off (2.6-3.3 ms); wet 0.7 + rain on top: +0.1-0.2 ms.

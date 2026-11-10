# @mirage/world

The world protocol: a site plan as the single source of positions, a module interface, and a loader that builds
modules in order with failure isolation, merged anchors, ambient volumes and seeded randomness per module.
Full convention (for agents and humans): [docs/world-protocol.md](../../docs/world-protocol.md).

This development branch ships candidate declarations for plans, modules, anchors and the kits.
`definePlan()` retains inferred custom fields; `WorldModule<Plan, Shared>` types module contexts.
TypeScript consumers need Three's declarations. Coverage, nullable results and the deferred packed-consumer
checks are described in [the type handoff](../../docs/TYPES.md). These declarations have not been compiled on the development Air.

```js
import { createWorldRenderer } from '@mirage/core';
import { buildWorld } from '@mirage/world';

const world = createWorldRenderer({ canvas, place, time: 'golden' });
const { plan, modules, anchors, report } = await buildWorld(world, { plan: myPlan, modules: [ground, walls, props], shared: { tex } });
// report: { modules: [{ name, ok, ms, tris, anchors }], failed: [{ name, phase, error }], anchors: { key: count }, ambientVolumes, ms }
await world.prepare();
```

| export | |
|---|---|
| `@mirage/world/plan.schema.json` | JSON Schema for site plans. The loader and `mirage-validate-plan` also enforce coordinate ordering and report each invalid field. |
| `buildWorld(world, { plan, modules, shared, log })` | build, anchors, finalize; returns `{ plan, modules, anchors, report }` |
| `buildWorld(..., { slice: true \| { budgetMs, yield } })` | opt-in time slicing for a world built while another runs: yields to the frame between modules once `budgetMs` (8) of building ran; `report.slices` = `{ yields, longestMs, longModules, longTasks }` |
| `createStreamer(world, { plan, modules, ... })`, `regionOf(root)` | opt-in: modules streamed in and out by distance (below) |
| `definePlan(plan)` | validate + defaults (`units 'm'`, `walk: { yMin: -1, yMax: 12 }`, `seed = name`); throws listing every problem |
| `contains(shape, x, z)`, `bbox(shape)`, `pathLength(path)`, `along(path, s)` | plan geometry helpers |
| `LAYER` | `{ VIEW: 0, COLLIDE: 2 }` (collision-only proxies live on layer 2) |

Module: `{ name, build(ctx), finalize?(ctx), anchors?, consumes?, ambientVolumes? }`.
Use `consumes: { required: ['lamps'], optional: ['seats'] }` to report available anchors before finalization.
Both lists can be omitted. See [the world protocol](../../docs/world-protocol.md#3-anchors) for examples and failure behavior.
`ctx` adds to the core's `world.ctx`: `plan, name, root (= scene), R, rng(sub), anchors, modules, shared, onUpdate, collider(mesh), log, world`.

`NOTES.template.md`: the per-world notes file modules use to talk to each other. `npm test -w @mirage/world` runs
`check.mjs` (plan checks, order, anchors, failure isolation, per-module rng; no GPU).

## Streaming modules in and out (`createStreamer`, experimental, opt-in)

```js
import { createStreamer } from '@mirage/world';
import { bakeWalkGridAsync } from '@mirage/play';
const streamer = createStreamer(world, { plan, shared: { tex }, modules: [{ name: 'hall', center: [40, 12], radius: 30, build }],
  onChange: (name, inScene, region) => bakeWalkGridAsync(world, { into: play.grid, region }) });
// once a frame, before the draw:
streamer.update(world.camera.position);
```

A streamed module is `{ name, center: [x, z], radius, build(ctx) }`; `ctx` is a buildWorld module's (own root, seeded
`R`, `collider`, `onUpdate`, `log`; no anchors: those are resolved once, at load). Within `radius` it is queued
(nearest first, `concurrency` 1), built in a task of its own, compiled with `renderer.compileAsync` against the
world's scene and the pipeline's target (programs link off the main thread), its textures uploaded through an
upload budget (`uploadBytes` 8 MB a frame), then added in one step; `onChange` gets its XZ region (re-bake the walk
grid there). Beyond `radius x hysteresis` (1.25) it leaves the scene and stays in an LRU of `budget` bytes (256 MB),
so walking back shows it at once; over budget the least recently near is freed (geometry, materials, and textures
nothing in the scene still samples). `{ sync: true }` loads in the frame it comes in range: the baseline.
Limits: a module's own `build` is one task (keep streamed modules small); no anchors or finalize; a new light in a
streamed module recompiles every program in the scene (three keys programs on the light count): use emissive
lamps or lights that exist from the start. Demo and measurements: `examples/demos/streaming`.

## Vegetation

Import `addTreeCanopies` and `addGrass` from `@mirage/world/kits/vegetation` inside a world module.

```js
const trees = addTreeCanopies(ctx, {
  trees: [{ pos: [2.5, 0, 0], height: 8.2, trunkRadius: 0.46 }], cardsPerTree: 96,
});
const grass = addGrass(ctx, {
  bounds: [-8, -12, 8, 12], count: 1200, height: 0.42,
  include: (x, z) => Math.abs(x) > 1, heightAt: (x, z) => 0,
});
```

Both functions attach instanced meshes to `ctx.root`. Tree positions are the bases of the trunks in metres.
Capped trunks collide. Boughs, leaf cards and grass allow passage. Grass returns its mesh, or `null` if the
area yields no tufts. Placement makes at most eight attempts per requested tuft. Use its actual `count` on
heavily excluded terrain. An optional `seed` names the RNG stream within the world module. See the
[Woodland Path example](../../examples/woodland-path) for a path exclusion and camera positions.

## Fur, short grass and moss (shells)

```js
import { addFur } from '@mirage/world/kits/fur';

// Inside build(ctx): a lawn panel, or moss on any mesh with normals (world space).
const lawn = addFur(ctx, { rect: [6.5, 18.9, 31, 32], y: 0.061, length: 0.07, density: 900, shells: 16 });
const moss = addFur(ctx, { geometry: rockGeometry, length: 0.025, density: 3000, thickness: 0.55, wind: 0.3 });
```

The patch's triangles drawn `shells` times in ONE draw call (an `InstancedBufferGeometry`, `gl_InstanceID` lifts
shell i by (i + 1) / shells x `length` along the normal). Each shell keeps only the pixels inside a strand: one strand
per cell of a jittered 3D lattice (`density` per m²), measured in the surface's plane (no projection seams on a
rock), each with its own height (`spread`) and a radius that tapers to the tip (`thickness` at the root). The rest
is discarded before the lighting (alpha-tested, depth written: no sorting). Kept pixels shade from `root` to `tip`
(a cheap occlusion toward the ground) and lean their normal out from the strand's axis (round strands); the tips
bend with the world's wind (`mgWind`, x layer²; `wind` 1: about 0.4 x length in a full gust). It is a patched
Standard material: three's lighting, shadows received, Mirage's fog, TAA; `hooks` adds more patch() hooks after the
fur's own. Where a strand falls under about a pixel the strands thicken and shorten into a solid lower shell, so a
far lawn reads as a surface, not a shimmer. Options: `base` (an opaque layer at the surface too), `shadows` (cast:
a depth material with the same lift and holes), `fins` (upright cards along rows every `fins` m (rect) or along the
mesh's edges, shown only where the view grazes: a second draw), `segments` / `heightAt` (a rect following the
ground), `seed`, `name`. Returns `{ shells, fins }`; neither collides.

Against the tuft cards (`addGrass`) on walled-garden's lower east lawn (321 m² inside the hedge, `?lawn=tufts |
fur | fur-fins`, 1440x900, Apple M4 Pro shared with other jobs, 60 moving TAA frames x 3 interleaved rounds):

| | draw calls | triangles | frame ms (two sessions) |
|---|---|---|---|
| no turf | 58 | 405,524 | 4.03–4.14 / 4.45–4.50 |
| tufts, 30 per m² (9,629) | +1 | +144,435 | 4.37–4.65 / 5.15–5.21 |
| fur, 16 shells | +1 | +32 | 4.10–4.17 / 3.76–4.73 |
| fur + fins (0.3 m) | +2 | +2,236 | 4.21–4.41 / 4.09–4.90 |

Stills: [tufts left, fur right](../../docs/media/looks/lawn-tufts-vs-fur.jpg), [moss on a rock](../../docs/media/looks/moss.jpg).
The fur costs ~0.1 ms where the tufts cost ~0.4–0.7 ms here, at 1/4500 of the triangles. Look: up close the shells
read as dense short turf with lit and shaded strands; from walking height a few metres away they become an even
felt (the far solid shell), where the tufts keep separate blades. Limits: no single blades standing above the
turf, grazing views show the shell layers (fins help, at a cost), strands are cut at their lattice cell (no
neighbour search), the pattern is in world space (a moving mesh slides through it), and alpha-tested edges rely on
TAA / the still path's sub-frames for anti-aliasing.

## Terrain and water

```js
import { addTerrain } from '@mirage/world/kits/terrain';
import { addWater } from '@mirage/world/kits/water';

// Inside build(ctx).
const bed = addTerrain(ctx, {
  bounds: [-12, -8, 12, 8], segments: [96, 64],
  sample: (x, z) => Math.min(1.1, -0.7 + 0.13 * x * x), surface: 'gravel',
});
const creek = addWater(ctx, {
  outline: [[-5,-8], [5,-8], [5,8], [-5,8]], level: 0, flow: [0, 0.25],
});
```

`addTerrain` attaches a static mesh to the module root. Bounds are metres in the XZ plane. Segments are cell
counts on those axes, with a limit of 1,048,576 vertices per mesh. Each grid vertex samples the supplied function
once. Use the returned `heightAt(x,z)` to place vegetation and props on the same triangles the walker and Rapier
see. It includes the outer edges and returns `null` outside. Keep the terrain's transform fixed after construction.
The optional `material` supplies the ground surface material.

`addWater` returns a level mesh from one simple polygon without holes. Supply shoreline vertices in XZ order,
a surface height in metres and a flow velocity in metres per second. Its normal ripples use the world's existing
clock. `color`, `ripple` and `opacity` adjust its appearance. Terrain above the waterline occludes the surface.
The water contributes no ground or Rapier collision. The bed sets wading depth. See [River Ford](../../examples/river-ford).

## Rain

```js
import { setWetness, setRain, withWet } from '@mirage/core';
import { addRain } from '@mirage/world/kits/rain';

// Inside build(ctx), or with { ...world.ctx, root: world.scene } after building.
const rain = addRain(ctx, { count: 6000, intensity: 1 });   // intensity: calls setRain(1)
```

`addRain` adds falling streaks in a box around the camera (`box` [22, 14, 22] m): one instanced draw call, no
shadow, no collision, no depth writes, hidden from the environment capture. Each streak keeps its place in the world
and falls with the world's clock (`G.uTime`, tilted by the wind), wrapped into the box, so walking does not drag the
rain along and a still frame is the same on every run. A streak spans `streak` seconds of travel (0.035 s at
`speed` 8.5 m/s), is at least one pixel wide (a thinner one gets less alpha), faint, and lit by the sky and, looking
toward it, the key light (lamps add a little at night). Its density follows core's `setRain(level)`, which also
drives the rain rings on puddles; wet ground itself is core's `withWet` / `setWetness` (core README, "Wet surfaces
and rain"). In an orthographic view the box is centred where the view axis meets y = `ground` (0), and a streak
thinner than a pixel keeps at least `minAlpha` (0.25). The fall runs on the scene clock wrapped to 64 s on the CPU
(each streak falls a whole number of box heights per period), so it stays smooth after hours; the wind drifts a
streak only since it left the top of its column, so a change of wind does not throw the rain across the sky.
Under reduced motion (core's `world.setReducedMotion`, @mirage/play's `prefers-reduced-motion`) it falls at
`ctx.motion.rain` x `speed` (0.4: 8.5 -> 3.4 m/s, shorter streaks). Limits: no splashes, and no shelter: streaks fall
inside arcades and rooms wherever the box reaches (hide the mesh indoors). Remove it with `mesh.removeFromParent()` and dispose its geometry and material.
Limits: no splashes, and no shelter: streaks fall inside arcades and rooms wherever the box reaches (hide the mesh
indoors). Remove it with `mesh.removeFromParent()` and dispose its geometry and material.

## Gaussian splats

```js
import { addSplats, loadSplats, splatEffects } from '@mirage/world/kits/splat';

// Inside build(ctx), or with { ...world.ctx, root: world.scene } after building.
const data = await loadSplats('scan.ply');   // .splat | 3DGS .ply | SOG meta.json (its webp files beside it)
const splats = addSplats(ctx, data, { position: [0, 0, -4], effect: splatEffects.reveal() });
createPlay(world, { ..., onStep: () => splats.changed() });   // a still view is drawn again when a fresh sort lands
```

An opt-in kit (8.8 KB min + gzip, three external; nothing else imports it). Loaders: antimatter15's `.splat`
(32 bytes a splat), an uncompressed 3D Gaussian Splatting `.ply` (binary little endian; the view-independent SH0
colour, higher harmonics ignored) and SOG versions 1-3 (PlayCanvas's `meta.json` + lossless webp: 16-bit log-space
means, codebooks, quaternions; `shN` ignored). The parsed data (`{ count, center, scale, rot, color }`) is packed into
one RGBA32UI texture (two texels a splat: centre floats + rgba8, smallest-three rotation + half-float scales).

`addSplats` draws one instanced quad per splat (128 a draw instance) with one ShaderMaterial, back to front: a
counting sort on view depth (2^10..2^20 buckets, about eight per visible splat, three quarters spread by a 32-bin
depth histogram) runs in a Worker made from a Blob, so a single-file page works and no SharedArrayBuffer (COOP/COEP)
is needed; the index buffer travels as a transferable, a camera that moved less than `resort` (1e-3) is not sorted
again, splats behind the eye are left out, and the first frame is sorted on the main thread before it is drawn. The
vertex shader culls splats behind the camera, off the frustum and smaller than `minPixelSize` (1 px) before the eigen
decomposition, adds the 0.3 px low-pass (with opacity compensation when `antialias`, set from SOG
`model: 'antialiased'`) and sizes each quad to where the splat falls under 1/255 (at most 3 sigma). The fragment
applies the world's aerial perspective, so splats sit in its air. Splat colours are lit like a matte object of that
colour by the world's key light and sky on average over its sides (`light: false`: the golden-hour level at any
time; `gain` scales both). The mesh is transparent (depth test on, no depth write), drawn after the opaque meshes into
the pipeline's scene target, casts no shadow, and stays out of the environment capture, the walk grid, physics and
GLB export; `see` in the playtest counts it (as camera-facing squares of 1.5 sigma).

Effects are GLSL run per splat in the vertex shader on `c` (model-space centre), `q` (rotation xyzw), `s` (sigma
per axis) and `col` (sRGB + opacity), with `c0` (the original centre), `sid` (a 0..1 hash of the splat), `uFx.x` (the
`progress`) and the effect's own `uFx.yzw` / `uFx2`: `{ decl, center, color, scale, params, bind(bounds), uniforms,
rest }`. Two ship: `splatEffects.reveal({ origin, width, glow })` grows the splats in from `origin` behind a bright
front as progress goes 0 -> 1, and `splatEffects.dissolve({ rise, glow })` lifts, warms, shrinks and fades each
splat in its own quarter of the time. At rest (reveal 1, dissolve 0) both draw exactly the plain image.

The handle: `progress`, `setEffect(fx)`, `changed()` (true once after an effect, its progress, or a sort that landed
for a view drawn with an older one; at most twice per resting view, so a moving lens cannot loop), `sortNow(camera)`
(main thread, for tests and one-off stills), `sorted()`, `stats` (sorts, ms, visible) and `dispose()`.

Splats write no depth. Measured on the demo (examples/demos/splats): the SSAO and the temporal AA's reprojection see
whatever is behind a splat. The TAA's neighbourhood clip hides it: after a 0.24 m-a-frame strafe past the tree the
splat pixels keep their detail (Laplacian 3.80 vs 3.87 still) with or without depth. The SSAO of the surface behind
does show through (0.03 levels of darkening on the hill over a flat meadow, but a splat in front of a wall corner gets
the corner's occlusion). `depth: 0.5` adds a depth-only second pass where a splat is at least that opaque, after the
colour pass: the SSAO then works on the splat surface (3.9 levels of contact darkening), at about +60 % of the splat
cost (1M splats: 30 -> 53 ms); a capture already carries its own occlusion, so it is off by default.

Limits: no spherical harmonics beyond SH0 (no view-dependent colour), no shadows cast or received, splats are lit
by an orientation-free average (baked shading in a capture is multiplied by the world's light), no SOG `.sog` zip
bundles and no compressed `.ply`. Opacity above 1 (SOG v3 merged splats) is clamped. Remove the splats with
`splats.dispose()`. Demo, procedural test asset and checks: [examples/demos/splats](../../examples/demos/splats)
(`make-fixtures.mjs` saves the asset in all three formats; `splat-check.mjs` checks it in the browser).

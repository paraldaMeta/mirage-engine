# Big worlds

Everything here is **opt-in and experimental**. A world that calls none of it renders exactly as before (checked:
see "Off means off"). It is what a large world needs so that the frame draws only what the viewer can see, at
the detail the viewer can see: spatial chunks, automatic LOD, culled instances with impostors, occlusion culling,
streaming cells with HLOD proxies and a floating origin. All of it is Mirage's own code on plain three.js 0.186
and WebGL2.

| module | import | what it does |
|---|---|---|
| `chunk.js` | `chunkGeometry`, `chunkObject`, `MeshBatch.finish({ chunk })` | cuts a merged mesh into compact pieces with tight bounds and a vertex budget, so the frustum (and occlusion) can reject them |
| `simplify.js` | `createSimplifier`, `simplify`, `createChain` | quadric-error-metric edge collapse with attribute quadrics (normals, UVs, colours), locked borders and seams, a time budget |
| `autolod.js` | `createAutoLod`, `buildProxy`, `buildProxyAsync`, `createSimplifyWorkers` | a chain of simplified copies per static mesh, built in workers or in slices; screen-size selection with hysteresis and a dithered cross-fade; merged proxies (HLOD) |
| `instancing.js` | `createInstances` | instances in a grid: per-cell then per-instance frustum culling, per-instance LOD, an impostor as the last level |
| `impostor.js` | `bakeImpostor`, `impostorMaterial` | hemi-octahedral impostor atlas (albedo + normals), lit by the live sun |
| `hiz.js` | `createOcclusion` | occlusion culling against the depth pyramid of the frame before (asynchronous readback, CPU test) |
| `frame.js` | `onView` | the per-view hook the three above run on |
| `@miragekit/world` `partition.js` | `createPartition`, `createFloatingOrigin` | streaming cells with load / unload radii, an HLOD proxy for every cell that is out, floating-origin rebasing |
| `bigworld.js` | `applyBigWorld` (`@miragekit/core/bigworld`) | chunks + LOD + occlusion for a scene that is already built, in one call |

Each module's header has its usage block and its limits.

## The short way: an existing world

```js
import { applyBigWorld } from '@miragekit/core/bigworld';
const big = applyBigWorld(world, world.scene, { chunk: true, lod: true, occ: true });   // after the build, before world.prepare()
```

Every example takes it as a URL flag: `?perf=chunk,lod,occ` (any subset). It leaves instanced, skinned and
multi-material meshes alone, and any mesh with `userData.chunk`, `userData.lod` or `userData.occlude` set to
`false`. Moving objects must be excluded from occlusion: bounds are taken once.

## The long way: a large world

`examples/demos/bigworld` is a world generated in code: 4096 x 4096 m of hills in 256 cells of 256 m (terrain and
rocks), a walled town of merged buildings in the middle (703 072 triangles in 5 materials) and 30 000 trees of 740
triangles: 5.8 million source triangles that a plain three.js scene submits as 45-47 million triangles a frame
(the trees are instanced; the shadow pass draws them again).

```
node examples/demos/bigworld/bigworld-check.mjs            # builds it to out/dist, then smoke, stills, popping, A/B
npx vite examples/demos/bigworld                           # to fly it by hand: W A S D + drag, Shift fast
```

URL flags: `?base=1` turns everything off (all cells loaded, one batch per material, three's `InstancedMesh`, no
LOD); with `base=1` a part is turned on by `part=1`, `hlod=1`, `chunk=1`, `lod=1`, `inst=1`, `imp=1`, `occ=1`,
`origin=1`; without it, a part is turned off by `=0`. `?trees=N`, `?load=metres`, `?w=&h=`, `?auto=1` flies the
test path.

The order in a world's own code:

```js
const part = createPartition(world, { bounds, size: 256, build(cell, ctx) { ... }, load: 600, hysteresis: 1.25,
  proxy: { ratio: 0.04, workers: 2 }, origin: { threshold: 1024 },
  onCell(cell, inScene, root) { inScene ? (lod.add(root), occ.add(root)) : (lod.remove(root), occ.remove(root)); },
  onRebase(shift) { trees.object.position.sub(shift); occ.shift(-shift.x, -shift.y, -shift.z); } });
chunkObject(town, { maxSize: 40 });                    // static merged batches
const lod = createAutoLod(world, { workers: 2 }), occ = createOcclusion(world);
const trees = createInstances(world, { source: tree, matrices, impostor: true });
// per frame, before world.renderFrame: part.update(world.camera)
```

## Numbers

This machine (Apple silicon, headless Chrome with the GPU), 1280 x 720, quality `medium`, the moving path
(`world.renderFrame` with `taa`), 150 frames per stretch after a warm-up. "frame" is the time until the GPU has
finished the frame (a 1-pixel readback after it); "cpu" is the JavaScript time of the draw. Variants are
interleaved; mean (min-max) over the runs. Draw calls and triangles are three's `renderer.info` for the whole
frame: shadow pass and post included. Everything below is the **steady state**: the check waits until the HLOD
proxies are baked (13-21 s after the page is ready, in two workers; `--baking` measures without waiting). Other
jobs share this GPU; runs whose base frame time left its usual 27-29 ms were taken again.

**A/B, 3 runs** (`--only ab`):

| stretch | variant | draw calls | triangles | cpu ms | frame ms |
|---|---|---|---|---|---|
| town (walking between buildings) | base | 189.5 | 47.48 M | 0.72 (0.68-0.78) | 28.83 (28.75-28.92) |
| | all on | 382.3 | 1.26 M | 1.83 (1.72-1.89) | 9.21 (8.14-10.66) |
| leaving (flying out over the wall) | base | 158.8 | 46.42 M | 0.66 (0.63-0.68) | 27.85 (27.82-27.89) |
| | all on | 192.9 | 0.65 M | 1.52 (1.46-1.62) | 8.33 (7.46-9.04) |
| hills (2 km out) | base | 77.4 | 44.96 M | 0.53 (0.52-0.54) | 26.68 (26.65-26.70) |
| | all on | 65.1 | 0.34 M | 1.07 (0.97-1.19) | 7.46 (6.86-7.99) |

Frame time is 3.1-3.6 x shorter and 97-99 % of the triangles are gone. Read it with these in mind:

- **Chunking raises draw calls in the town** (189 -> 382): 5 batches became 198 chunks, of which the view and the
  shadow pass draw a part each. It is what lets the frustum, the LOD and the occlusion test work on the town.
- **The CPU cost of a frame rises** from 0.5-0.7 ms to 1.1-1.8 ms: culling 30 000 instances, testing the proxies
  and the loaded chunks, selecting LODs. The GPU saves far more than that here; a scene that was not limited by
  triangles gets the cost without the gain (see the examples below).
- **Most of the win in this world is the trees**: instance culling, per-instance LOD and impostors.
- **While the proxies bake** the frame costs more: runs taken during the bake read cpu 3.4-3.9 ms and frame about
  8 ms (and 14.7-17.6 ms under the 4x CPU throttle): the bake's main-thread share, not the proxies themselves.

**One part off at a time, 3 runs** (`--only parts`; town | leaving | hills; frame times from the runs where the
GPU was quiet):

| off | what changes against "all on" (cpu 2.0 \| 1.6 \| 1.05 ms in this run) |
|---|---|
| `inst=0` | 45.66 M \| 45.01 M \| 44.73 M triangles, frame 31.9 \| 27.0 \| 28.2 ms: the base again. This is the part that matters most here. cpu 1.05 \| 0.79 \| 0.67 ms, so culling 30 000 instances costs 0.4-0.9 ms a frame |
| `imp=0` | triangles 2.38 M \| 1.52 M \| 0.56 M (x 1.6-1.9); frame time about the same (8.4 \| 7.6 \| 7.3 ms): the GPU has room |
| `part=0` | all 256 cells loaded: 424 \| 243 \| 78 calls, 2.06 M \| 1.50 M \| 0.56 M triangles, cpu 2.2 \| 2.0 \| 1.5 ms, frame 9.8 \| 8.2 \| 7.3 ms |
| `hlod=0` | cells that are out show nothing (holes in the distance): 330 \| 140 \| 53 calls, cpu 1.6 \| 1.35 \| 0.8 ms. The proxies cost 0.25-0.4 ms of CPU a frame |
| `chunk=0` | town 111 calls, 1.78 M triangles (leaving: 110 calls, 0.99 M); cpu 1.3 \| 1.3 \| 0.9 ms |
| `lod=0` | 1.34 M \| 0.69 M \| 0.34 M triangles: automatic LOD saves about 5 % here, because the terrain is already coarse and the trees have their own LOD |
| `occ=0` | 1.288 M against 1.264-1.283 M triangles in the town, the same frame time: occlusion hides at most 66 chunks in this town. It earns its keep only where walls hide a lot |

**Slow machines, 3 runs** (`--only slow`; Chrome's CPU throttle through the DevTools protocol, and a smaller
canvas; frame ms, town | leaving | hills):

| | base | all on | all on, p95 | all on, cpu ms |
|---|---|---|---|---|
| as measured above | 28.8 \| 27.9 \| 26.7 | 9.2 \| 8.3 \| 7.5 | not kept for this run | 1.8 \| 1.5 \| 1.1 |
| 4x CPU throttle | 29.5 \| 28.7 \| 26.9 | 11.5 \| 10.5 \| 7.6 | 14.6 \| 13.1 \| 9.4 | 4.7 \| 3.8 \| 2.1 |
| 640 x 400 | 26.2 \| 25.6 \| 24.6 | 8.05 \| 5.82 \| 4.43 | 9.7 \| 7.7 \| 6.6 | 1.8 \| 1.3 \| 1.0 |
| 640 x 400 and 4x CPU throttle | 30.1 \| 29.3 \| 27.9 | 10.6 \| 8.7 \| 6.5 | 13.1 \| 10.5 \| 8.0 | 5.0 \| 4.2 \| 2.5 |

The base barely gets faster at a quarter of the pixels: it is limited by vertices. With everything on, a CPU four
times slower stays under 16.7 ms, the 95th percentile included, once the proxies are baked; the culling's CPU
work is then 30-45 % of the frame. That is the cost a GPU-driven path would remove (see "Left out").

**Start-up.** Ready to draw with everything on (the 16 cells near the viewer): 3.2 s in a quiet run, 6.6 s in a
busy one; the base (all 256 cells): 7.7 s and 17.8 s. Chunking the town: 122-141 ms. The 256 HLOD proxies
(5 233 920 triangles to 209 050) then bake in the background, nearest first: 13 s of wall time after ready, 28 s
of worker time in two workers. Until a cell's proxy is there, that cell shows nothing when it is out.

**Simplifier** (Node, `packages/core/bigworld.check.mjs`): a sphere of 12 096 triangles to 1 208 in 66 ms,
never more than 0.03 off a radius of 2; a 7 680-triangle knot to 3 840, 1 920 and 768; built in 2 ms slices the
chain is identical to the one built at once.

## The examples, before and after

`node examples/demos/bigworld/examples-check.mjs`: every example as it is and with `?perf=chunk,lod,occ`,
interleaved, 3 runs; the viewer stands at the spawn and turns once around in 240 moving frames, 1280 x 720. Mean
(min-max over the runs). Other jobs were using this GPU during these runs, so the frame times of some rows are
spread too widely to compare: the draw calls, triangles and CPU times are the reliable columns.

| example | | draw calls | triangles | cpu ms | frame ms |
|---|---|---|---|---|---|
| hello-courtyard | off | 49.5 | 129 k | 0.57 (0.53-0.62) | 28.6 (19.8-36.0) |
| | on | 97.1 | 65 k | 0.79 (0.73-0.84) | 23.2 (5.2-36.2) |
| walled-garden | off | 56.5 | 351 k | 0.46 (0.43-0.48) | 4.43 (3.62-5.10) |
| | on | 150.6 | 238 k | 0.69 (0.65-0.75) | 4.27 (3.46-5.83) |
| garden-quest | off | 94.3 | 355 k | 0.47 (0.46-0.48) | 3.49 (3.29-3.74) |
| | on | 187.2 | 242 k | 0.69 (0.68-0.71) | 6.37 (6.10-6.92) |
| agent-trial | off | 80.6 | 77 k | 0.71 (0.62-0.86) | 32.6 (19.2-48.8) |
| | on | 105.0 | 49 k | 0.79 (0.74-0.83) | 26.4 (15.4-34.6) |
| river-ford | off | 31.0 | 181 k | 0.45 (0.43-0.48) | 21.2 (18.0-25.3) |
| | on | 39.3 | 162 k | 0.50 (0.49-0.52) | 21.8 (18.2-24.0) |
| snow-hut | off | 48.0 | 331 k | 0.75 (0.72-0.78) | 37.8 (26.1-45.9) |
| | on | 111.8 | 238 k | 0.91 (0.85-0.96) | 36.4 (10.6-59.6) |
| woodland-path | off | 32.0 | 357 k | 0.32 (0.31-0.32) | 4.23 (3.22-5.86) |
| | on | 37.0 | 357 k | 0.37 (0.33-0.41) | 7.88 (6.55-10.42) |

**These scenes are too small to gain from it.** Chunking a 40 m scene cuts the triangles submitted by 10-50 % and
about doubles the draw calls (hello-courtyard: 20 batches become 150 chunks); the CPU cost of a frame rises by
0.05-0.25 ms; the frame time does not improve where it can be read (walled-garden: the same; garden-quest and
woodland-path: 3-4 ms worse, which is more than the CPU cost explains and was not investigated further: the
occlusion pass's depth pyramid and readback are the likely part). Automatic LOD switched nothing or little (0 to
15 switches): nothing is far away. Occlusion hid nothing from the spawn. The switch is for worlds whose frame is
limited by geometry, like the one above; it stays off by default.

## Allocation in the frame loop

`node examples/demos/bigworld/alloc-check.mjs`: Chrome's sampling heap profiler (objects already collected
included) while the page runs its own loop, W held and the view turning; bytes of JavaScript heap allocated per
frame, mean (min-max) of 3 runs.

| example | base commit | this branch |
|---|---|---|
| hello-courtyard | 42 641 (42 247-43 163) | 36 083 (35 743-36 475) |
| walled-garden | 44 363 (43 782-44 803) | 37 292 (37 180-37 444) |

15-16 % less. What went: the walker's support test returned a new array for each of its ~30 samples a step
(`walkgrid.support(x, z, y, step, out)` now fills the caller's array; the largest single allocator of Mirage's own
code), vectors and option objects in `play.js`'s loop and in `world.renderFrame`, the TAA jitter's `map`. What is
left is mostly inside three's renderer (the program cache key and parameter object it builds for every object
drawn: about 6.6 KB a frame; uniform caches) and was left alone: three stays unpatched. So this is a modest cut,
not an allocation-free loop. Minor-GC pauses were not measured separately.

The walk-grid bake was already asynchronous before this round (`bakeWalkGridAsync`: `fenceSync`, pixel-buffer
readback, bit-identical to the synchronous bake by its own check). Nothing was changed there.

## Does it show?

`--only stills` renders four places of the path as stills with a part on and with it off, and counts pixels that
differ by more than 8 display levels (two identical renders: 0).

| part | pixels over 8 levels (of 921 600) | mean difference |
|---|---|---|
| chunks | 0 (largest difference 1 level) | <= 0.016 levels |
| occlusion | 0 (largest 1 level) | <= 0.0001 levels |
| automatic LOD (errorPx 1) | 0 (largest 1 level) | <= 0.0007 levels |
| impostors | 223 to 2 472 | <= 0.11 levels |

The stills wait for the proxies and for cross-fades to end: an earlier version of the check did not, and two
identical pages then differed by thousands of pixels depending on how far the bake had got.

Impostors read slightly brighter than the trees they stand for (the atlas holds albedo lit by the live sun on a
flat quad: the tree's self-shadowing is lost). That is the visible limit of this implementation.

**Popping.** `--only pop` moves along the path and, every 5th frame, renders the same frame a second time with
occlusion bypassed (`occ.bypass`), and compares the two. Anything occlusion hid that should have been seen
shows as differing pixels.

| motion | comparisons | hidden objects, mean (max) | worst differing pixels |
|---|---|---|---|
| walk through the town, 6 m/s | 415 | 22.4 (42) | 0 |
| run, 12 m/s | 208 | 25.8 (66) | 0 |
| fly out, 40 m/s | 117 | 3.2 (19) | 0 |
| fly over the hills, 60 m/s | 63 | 0 (0) | 0 |

The noise floor of two renders of one frame is at most 2 pixels. The check fails above 0.2 % of the frame.

`npm run test:still-pop` (hello-courtyard, walled-garden, garden-quest, agent-trial as they ship, no flag): ok.
It checks the still refinement of the default path, so it shows these modules changed nothing there; the popping
of occlusion itself is the table above.

## Off means off

`snap.mjs --baseline` on hello-courtyard (6 views) and walled-garden (9 views), 1280 x 720, 8 spp: built from the
base commit (`bbd91f6`) and built from this branch with no flag: region SSIM 1.000 and worst cell 0 in all 15
views. The same comparison covers the allocation edits above.

## Tests

- `node packages/core/bigworld.check.mjs` (in `npm test`): simplifier, chain slicing, chunks, proxy, impostor
  directions, floating origin. No GPU.
- `node examples/demos/bigworld/bigworld-check.mjs [--only smoke,stills,pop,ab,parts,slow] [--runs 3] [--baking]`:
  the demo in headless Chrome. Fails on a page error, on a chunk or occlusion still that differs, on popping.
- `node examples/demos/bigworld/examples-check.mjs`, `alloc-check.mjs`: the two tables above.
- `npm run test:types` was not run: it needs the test machine's set-up.

## Left out, and limits

- **GPU-driven instancing**: not built. WebGL2 has no compute shaders and no indirect draws, and transform
  feedback cannot drop or route primitives without a geometry shader, so the visible set would have to come back
  to the CPU anyway to set instance counts. The CPU path is what is measured above. On WebGPU this would be the
  first thing to move.
- **HLOD proxies are baked at run time**, by building each cell once. A shipped game would bake them offline.
  They have vertex colours, no textures.
- **Occlusion** uses bounds taken once (static objects), needs one to three frames to show an object again after
  it comes into view (the margins cover that at the speeds measured above), and only opaque geometry occludes.
- **Automatic LOD** handles static meshes with one opaque material. The error is the simplifier's estimate, not a
  strict bound. No skinned meshes.
- **Impostors**: no parallax between views, no shadows cast, brighter than the mesh (above).
- **Floating origin**: materials that derive their look from world position shift on a rebase unless their period
  divides the snap; physics colliders are the game's to move.
- No virtualised geometry (Nanite), no virtual shadow maps, no data layers, no editor: see the comparison in the
  round's report.

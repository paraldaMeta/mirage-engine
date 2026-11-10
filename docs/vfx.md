# Visual effects (experimental, opt-in)

`createVfx` in `@mirage/core` is a GPU particle system for WebGL2 with the things that go around one: trails,
beams and lightning, decals, a library of ten ready effects. An effect is plain JSON. Nothing runs until
`createVfx` is called; a world without it renders exactly as before (the built bundles of `hello-courtyard` and
`snow-hut` are byte-identical to the ones built from the commit before this work, and so are their stills).

```js
import { createVfx, VFX_LIBRARY } from '@mirage/core';
const vfx = createVfx(world);                       // hooks the world's clock
const fire = vfx.spawn(VFX_LIBRARY.fire, { position: [0, 0, 0] });   // looping: returns a handle
vfx.burst(VFX_LIBRARY.explosion, [4, 1, 0]);                         // one-shot: allocates nothing
fire.move({ position: [1, 0, 0] });  fire.stop();                    // what is in the air lives out its life
vfx.spawn({ name: 'mine', rate: 40, life: [1, 2], shape: { type: 'cone', angle: 20 },
  velocity: { speed: [2, 3] }, gravity: -4, color: [[0, '#ffd27a'], [1, '#ff5a1e']], alpha: [[0, 1], [1, 0]] });
```

Outside a world: `createVfx({ renderer, scene, camera })`, then call `vfx.update(seconds)` once a frame.

## How it works

Each emitter is one pool: three RGBA32F textures (position + age, velocity + life, random / rotation / flags /
size) in a ping-pong pair, advanced by one fragment pass per fixed step (60 Hz by default, however often the page
draws). Slots are a ring, random numbers are a hash of slot and spawn count, curves and gradients are baked into
a 64-texel lookup row. One instanced mesh draws the pool, so every instance of an effect shares one draw call.
The state is a function of the step count, the effect and its instances' transforms: the browser check reads the
state back and gets the same hash on two page loads and at 30 updates a second instead of 60.

## The effect format

`defineEffect(json)` validates and fills defaults in Node or the browser; an unknown key throws with its path.
A number is a constant, `[a, b]` a per-particle random range, `[[t, v], ...]` a curve over life, and a gradient
is `[[t, '#rrggbb'], ...]`. An effect is one emitter or `{ name, emitters: [...] }`.

| Key | What |
|---|---|
| `rate`, `bursts: [{ time, count, every }]`, `duration`, `loop`, `delay`, `capacity`, `seed` | spawning; `capacity` is per instance |
| `life`, `size`, `rotation`, `spin` | per-particle ranges |
| `shape` | `point`, `sphere` (`radius`, `shell`, `hemisphere`), `box` (`size`), `cone` (`angle`, `length`), `ring`, `edge` (`a`, `b`), `mesh` (surface of a mesh from `vfx.registerMesh`) |
| `velocity` | `dir`, `speed`, `spread` (degrees), `normal` (along the shape's normal), `random`, `inherit` (the emitter's own motion) |
| `gravity`, `drag`, `wind`, `turbulence: { strength, scale, speed }` | forces; turbulence is curl noise, `wind` follows the world's wind |
| `attractors: [{ position, strength, radius, spin }]`, `field: { name, strength, min, size }` | up to 4 attractors; a 3D vector field from `vfx.registerField` |
| `sizeOverLife`, `color`, `alpha`, `emissive`, `spinOverLife` | curves and gradients over life |
| `render` | `type` (`billboard`, `stretched`, `horizontal`, `mesh`), `blend` (`alpha`, `add`, `premultiplied`), `sort` (`none`, `oldest`, `youngest`, `distance`), `lit`, `soft` (metres of depth fade), `sprite`, `flipbook: { sheet, cols, rows, fps, blend }`, `stretch`, `mesh`, `nearFade`, `order` |
| `collision` | `mode` (`bounce`, `kill`, `stick`), `depth` (the rendered depth buffer), `ground` (a height texture from `vfx.setGround(walkGrid)`), `planes`, `bounce`, `friction`, `radius`, `lifeLoss`, `thickness` |
| `sub: [{ on, count, rate, emitter, inherit }]` | sub-emitters on `birth`, `death`, `collision` or `life`; one level deep |
| `trail: { segments, every, width, taper }` | a ribbon behind each particle |
| `lod: { near, far, min, cull, minPixels }`, `bounds`, `pauseOffscreen` | budgets, below |

Lit particles take the sun, the cascaded shadow, the sky light and Mirage's fog. Sprites (`soft`, `disc`, `ring`,
`spark`, `star`, `leaf`, `flake`, `drop`) and the `smoke` / `flame` flipbook sheets are drawn in code.

`vfx.beam({ from, to, width, color, jitter, branches, life })` is a beam, or with `jitter` a lightning bolt whose
shape replays from its seed. `vfx.decal({ position, normal, size, pattern, life })` paints `scorch`, `splat`,
`crack`, `ring` or `soft` on whatever is under it, from the scene depth.

## Budgets

- `capacity` caps an emitter; `createVfx(world, { maxParticles })` (200 000) caps everything: above it every
  emitter's rate is scaled by the same factor (`vfx.stats.budget`).
- `lod.near` / `lod.far` thin the spawn rate with distance down to `lod.min`; `lod.cull` stops it; `lod.minPixels`
  drops sprites smaller than that on screen. `bounds` culls the draw; `pauseOffscreen` also stops the simulation.
- One-shots (`vfx.burst`) reuse pooled instances: 200 bursts create no texture, geometry or record.
- `vfx.stats`: pools, particles, capacity, spawned, dropped, steps, instances, budget, simMs, sortPasses.

## The gallery page

`examples/demos/vfx` (`node packages/tools/src/package.mjs examples/demos/vfx --out out/vfx.html` writes one
self-contained page): a small yard with an effect selector, live counters (alive, capacity, spawned, dropped, pools,
budget, simulation ms) and a parameter panel that edits the running effect and prints its JSON.

`?fx=fire|smoke|sparks|dust|splash|snow|leaves|fireflies|magic|explosion|lightning|all|none`, `?time=dusk|HH:MM`,
`?mode=orbit|walk`, `?dpr=1|2`, `?max=N` (the global cap), `?ui=0`, `?panel=0`, `?vfx=0` (no effect system).

## Checks

- `packages/core/vfx.check.mjs` (part of `npm test`): the format: defaults, errors with paths, curve baking,
  every library effect defines and survives a JSON round trip.
- `node examples/demos/vfx/vfx-check.mjs` (headless Chrome): the same state hash on two loads and at 30 updates a
  second; all ten library effects alive; the GPU sort's order against depths computed on the CPU; ground and
  plane collision in `kill`, `bounce` and `stick`; the per-emitter and global caps; 200 bursts with no new
  texture; distance LOD, cull and pause; death and collision sub-emitters; the depth copy inside a world.
- `node examples/demos/vfx/vfx-bench.mjs [--kind plain|lit]`: the table below.

## Measured

Apple M4 Pro, headless Chrome, 1280 x 720 CSS pixels, the yard at 15:00, one sample a frame.
Particles are 3 to 6 cm sprites filling a 12 x 4 x 8 m box in view with turbulence, gravity and drag; `plain` is
additive and unlit, `lit` is alpha-blended with sun, shadow, sky light, fog and soft depth fade. Headless Chrome
presents at 60 Hz at most, so a phase is 12 frames back to back ending in a one-pixel readback; the four phases
are interleaved in each of 7 rounds. Milliseconds a frame, median (min to max where it matters). Other work was
running on the machine: read the spread.

| pixel ratio, kind | N | yard alone | draw | simulation step | step + frame |
|---|---|---|---|---|---|
| 1, plain | 100 000 | 1.8 | 0.92 | 0.13 | 2.67 |
| | 500 000 | 1.8 | 3.05 | 0.40 | 5.63 |
| | 1 000 000 | 1.9 | 6.29 | 0.70 (0.66 to 1.27) | 9.73 (9.50 to 9.98) |
| | 2 000 000 | 1.9 | 14.01 | 1.43 | 19.32 (16.69 to 20.09) |
| 1, lit | 100 000 | 1.8 | 1.50 | 0.14 | 3.49 |
| | 500 000 | 1.8 | 8.81 | 0.41 | 11.53 (11.27 to 12.59) |
| | 1 000 000 | 1.9 | 21.12 | 0.82 (0.66 to 1.74) | 24.85 (24.62 to 29.63) |
| 2, plain | 100 000 | 8.6 to 10.3 | 2.98 | 0.56 | 14.27 |
| | 500 000 | | 6.89 | 0.70 | 17.55 |
| | 1 000 000 | | 12.93 | 1.16 | 26.39 |
| 2, lit | 100 000 | 5.1 | 3.49 | 0.14 | 8.64 |
| | 500 000 | 9.9 (8.6 to 11.8) | 17.98 | 0.76 | 30.72 (29.43 to 90.62) |
| | 1 000 000 | 10.0 | 42.22 | 1.24 | 52.86 (48.76 to 67.48) |

The largest count that fits a frame, linear between the two measured counts either side of the budget. "With
the yard" includes the scene's own frame; "alone" is the particles' own cost against the whole budget.

| | 60 fps, with the yard | 60 fps, alone | 120 fps, with the yard | 120 fps, alone |
|---|---|---|---|---|
| pixel ratio 1, plain | 1 720 000 | 1 930 000 | 830 000 | 1 050 000 |
| pixel ratio 1, lit | 690 000 | 760 000 | 350 000 | 435 000 |
| pixel ratio 2, plain | 440 000 | 960 000 | under 25 000 (the yard alone is over 8.3 ms) | 460 000 |
| pixel ratio 2, lit | 300 000 | 420 000 | 87 000 | 260 000 |

The pixel-ratio-2 rows moved with the machine's other load (the yard alone read 5 ms in one run and 10 ms in the
other); treat them as within a factor of two. Draw cost is fill: larger sprites cost in proportion to the pixels
they cover. Distance sorting adds 91 passes over the state texture for an 8192-slot pool; its cost was not
measured separately.

## Limits

- WebGL2 fragment passes, not compute: no WebGPU path, no particle-to-particle forces, no fluid.
- No node-graph editor: effects are JSON and the gallery's panel.
- Particles cast no shadows and receive no point lights; lit means sun, shadow, sky and fog.
- Sorting is per pool (`render.order` orders pools), bitonic, log² N passes: use it on small pools.
- Depth collision reads the rendered frame: view-dependent, one surface deep, and outside the determinism
  promise. Ground and plane collision are deterministic.
- Sub-emitters go one level deep; at most 8 spawning sources reach a pool in one step.
- Trails are a ribbon per particle; there is no ribbon joining successive particles of an emitter.
- Spawn positions are not interpolated inside a step: a fast emitter leaves 1/60 s gaps.
- Decals are multiply or add only (no normal or roughness change), 128 per blend.
- `wind` pulls velocity toward the wind on all axes. Unlit colours are display-referred (scaled against exposure).
- `lod.minPixels`, soft fade, depth collision, trails, beams and decals were checked by eye, not by a test.
- The `.d.ts` files were written by hand and not run through a type checker.
- Determinism is bit-for-bit on one GPU and driver; across GPUs it was not measured.

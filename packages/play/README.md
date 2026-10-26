# @mirage/play

Walk, fly, an isometric game view and orbit over a world built with `@mirage/world`; collision and ground from a
walk grid baked from the real geometry; progressive refinement when the view stops; an embed API for games.

```js
import { createPlay } from '@mirage/play';
const play = createPlay(world, { plan, canvas, mode: 'walk', spp: 6, refine: [6, 16] });
```

| keys | |
|---|---|
| WASD / arrows, mouse (click captures the pointer, or drag) | walk and look; Shift runs, Space jumps |
| F | fly (Space / E up, C / Q down, Shift fast) |
| G | game view: orthographic, from the south-east, following a figure; WASD relative to the screen; wheel zooms |
| O | orbit (three's OrbitControls; the stills view) |
| 1–9, R, H | the plan's viewpoints, back to the spawn, hide the help |

Options for games (`@mirage/game` uses them): `walker` (any object with the walker's shape — `pos`, `onGround`,
`blocked`, `body`, `update(dt, input)`, `place(p)` — replaces the grid walker; the grid stays for ground queries),
`input(dt)` (returns `{ x, z, up, run, jump }` instead of reading the keys), `devKeys: false` (no F / G / O / R / H /
digits), `onStep(dt)` (runs after each step; truthy = the scene moved, so the frame is not treated as still).

`play`: `place(eye, look, mode)`, `viewpoint(i)`, `setMode(m)`, `state()`, `render({ moving, spp, frameIndex })`,
`step(dt)`, `stop()`, `start()`, `turn(dx, dy, k)`, `lookAt(p)`, `yaw` / `pitch`, `keys` (a Set of held `KeyboardEvent.code`s), `grid`, `walker`, `stats`.
Moving frames: one jittered sub-frame resolved by the core's temporal AA. When the view stops: the core's still
path at `refine[0]` sub-frames, later `refine[1]`, then nothing until something moves. Each still frame fades in
over 10 frames from the image before it, so stopping does not pop the image sharp; the last fade frame is the still
frame itself. `npm run test:still-pop` measures the change per frame after stopping. The scene clock (wind, water, clouds,
`ctx.onUpdate`) runs on the frames the player drives (keys, stick, looking) and stands still with the view;
`place()` sets it to 0, so a viewpoint looks as it always did (`play.clock`; `animate: true` runs it on real time). Shadows follow the view,
their centre snapped to whole shadow texels.

## The walk grid (`bakeWalkGrid(world, { bounds, cell = 0.125, dy = 0.1, yMin, yMax })`)

Baked in the page at load (~0.06 s for the courtyard, ~0.27 s for the 80 × 94 m garden on an M4 Pro). The height
range is cut into 0.1 m slabs; each slab is one orthographic top-down render of the solid layer-0 meshes (plus
collider proxies), DoubleSide, through an override material that counts front and back faces (additive) and keeps
the first crossing's depth (min blending). Down each 0.125 m column the winding number (fronts − backs) is
non-zero inside solids, so overlapping boxes, walls without bottoms and inverted meshes are all solid. Where it
turns non-zero is a floor (exact height from the min depth), where it turns back a ceiling. Up to 4 floors per
column, each with its ceiling. `grid.layers(x, z)`, `grid.support(x, z, y, step)`, `grid.groundAt(x, z, y)`.

Rules for modules: `userData.collide = false` leaves a mesh (and its children) out; open meshes need a closed
proxy (`ctx.collider(mesh)`, layer 2): a vertical face is never seen from above.

## The walker (`createWalker(grid, { pos, body })`)

A cylinder (r 0.28 m, head 1.8 m, eye 1.62 m) that steps up ≤ 0.4 m (0.12 m in the air), falls under gravity,
jumps (4.2 m/s: apex ≈ 0.9 m), and slides along what blocks it (sub-steps of 5 cm). Pure JS: `npm test -w @mirage/play`
runs it on a hand-made grid in node.

## Embedding (`mountWorld`)

```js
const mw = await mountWorld({ renderer, plan, modules, world: { place, time, shadow, envProbe, fog }, shared: (world) => ({ tex }) });
mw.root.add(player);                 // lit, shadowed and hazed with the world (root has collide = false)
const w = mw.walker([x, y, z]);      // the host's characters on the baked grid
mw.update(dt); mw.render(hostCamera, { target, moving });
```
The host camera is never modified (the core jitters its projection and restores it). The core takes over the
shared renderer's tone mapping (off) and shadow settings. Example: `examples/hello-courtyard/embed.html`.

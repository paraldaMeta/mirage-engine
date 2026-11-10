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
| touch | a finger on the left half is a stick around where it went down (dragged past 80 px it runs); one on the right half looks; buttons top left: Walk / Orbit and View (the next viewpoint). Orbit keeps OrbitControls' touch. `touch: false` turns it off; games (`opts.input`) use their own overlay |

Options for games (`@mirage/game` uses them): `walker` (any object with the walker's shape — `pos`, `onGround`,
`blocked`, `body`, `update(dt, input)`, `place(p)` — replaces the grid walker; the grid stays for ground queries),
`input(dt)` (returns `{ x, z, up, run, jump }` instead of reading the keys), `devKeys: false` (no F / G / O / R / H /
digits), `onStep(dt)` (runs after each step; truthy = the scene moved, so the frame is not treated as still).

`play`: `place(eye, look, mode)`, `viewpoint(i)`, `setMode(m)`, `state()`, `render({ moving, spp, frameIndex })`,
`step(dt)`, `stop()`, `start()`, `dispose()` (see below), `turn(dx, dy, k)`, `lookAt(p)`, `yaw` / `pitch`, `keys` (a Set of held `KeyboardEvent.code`s), `grid`, `walker`, `stats`,
`xrInput` (`(input, dt) => input`, merged into each step's input; set by `createXR`).
Moving frames: one jittered sub-frame resolved by the core's temporal AA. When the view stops: the core's still
path at `refine[0]` sub-frames, later `refine[1]`, then nothing until something moves. Each still frame fades in
over 10 frames from the image before it, so stopping does not pop the image sharp; the last fade frame is the still
frame itself. `npm run test:still-pop` measures the change per frame after stopping. The scene clock (wind, water, clouds,
`ctx.onUpdate`) runs on the frames the player drives (keys, stick, looking) and stands still with the view;
`place()` sets it to 0, so a viewpoint looks as it always did (`play.clock`; `animate: true` runs it on real time). Shadows follow the view,
their centre snapped to whole shadow texels.

## WebXR: VR and AR (`createXR(play, opts)`, experimental)

```js
import { createPlay, createXR, xrSupport } from '@mirage/play';
const xrs = await xrSupport();                                  // before the world: its context gets MSAA for XR
const world = createWorldRenderer({ ..., xr: xrs.vr || xrs.ar });
const play = createPlay(world, { plan, canvas });               // or a game's g.play
const xr = createXR(play, { support: xrs, game: g });           // "Enter VR" / "Enter AR" when the browser offers them
```

In the headset the same walker (or a game's physics character) walks: collisions, steps and ground follow are the
desktop's (the check below replays the XR frames through the desktop path and gets the same end position).
Left stick walks where you look, left grip runs, right stick turns (snap 30°) or, pushed forward, aims a teleport arc
onto walkable ground; A jumps; the trigger is a game's E, prompts and messages float in the world. AR puts the world
on the floor or a table as a model. The frame is one plain stereo draw (`world.renderDirect`) graded by the
renderer's tone mapping to match the desktop look (no SSAO / TAA / bloom; a measured stand-in for the bloom).
Everything else — options, controls, the grade, limits — is in [docs/xr.md](../../docs/xr.md). Without a headset:
`node packages/tools/src/xr-check.mjs examples/hello-courtyard/dist` (Meta's iwer emulator in headless Chrome).

## The player character

Game view shows an original low-poly traveller with a cropped jacket, scarf and backpack. It uses one
vertex-coloured skinned mesh and one material. Walk, fly and orbit hide the figure. The walker or Rapier
character supplies the feet and collision. Actual distance drives the gait. A stopped player settles into a
repeatable pose so progressive rendering can finish.

`createPlay(world, { plan, appearance: { palette: { scarf: 0xd98645 } } })` selects colours; `startGame`
accepts the same appearance option. The palette also accepts `jacket`, `trousers`, `leather`, `skin` and
`hair`. `play.figure` is the existing Three.js group. `play.avatar.state` exposes `idle`, `walk`, `run`,
`jump`, `fall` or `land`.

Hosts can import `createCharacter` from `@mirage/play` and attach its `root` to their own scene. The origin
is at the soles in metres and forward is +Z. Call `update(dt, { distance, run, onGround, verticalSpeed })`
with horizontal displacement since the previous frame, seconds and vertical speed in m/s. `reset()` settles
the pose after a teleport. `dispose()` detaches the root and releases its owned resources.

## The walk grid (`bakeWalkGrid(world, { bounds, cell = 0.125, dy = 0.1, yMin, yMax })`)

Baked in the page at load (~0.06 s for the courtyard, ~0.27 s for the 80 × 94 m garden on an M4 Pro). The height
range is cut into 0.1 m slabs; each slab is one orthographic top-down render of the solid layer-0 meshes (plus
collider proxies), DoubleSide, through an override material that counts front and back faces (additive) and keeps
the first crossing's depth (min blending). Down each 0.125 m column the winding number (fronts − backs) is
non-zero inside solids, so overlapping boxes, walls without bottoms and inverted meshes are all solid. Where it
turns non-zero is a floor (exact height from the min depth), where it turns back a ceiling. Up to 4 floors per
column, each with its ceiling. `grid.layers(x, z)`, `grid.support(x, z, y, step)`, `grid.groundAt(x, z, y)`.

Rules for modules: `userData.collide = false` leaves a mesh (and its children) out; open meshes need a closed
proxy (`ctx.collider(mesh)`, layer 2): a vertical face is never seen from above. Each 0.125 m cell is sampled at
its centre, so a solid thinner than a cell (a railing, a post, a rope) can fall between samples: if it must block,
give it a proxy box at least 0.2 m thick. `node packages/tools/bake-check.mjs` shows both (needs Chrome).

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
mw.dispose();                        // the world's GPU resources; your objects in root are left to you
```
The host camera is never modified (the core jitters its projection and restores it). The core takes over the
shared renderer's tone mapping (off) and shadow settings. Example: `examples/hello-courtyard/embed.html`.

## Type declarations (candidate)

The root and current JS subpaths ship adjacent declarations; compilation is pending on the test machine.
See [consumer checks](../../docs/TYPES.md) and [lifecycle / ownership](../../docs/LIFECYCLE.md).
Use `play.stop()` to pause and `play.dispose()` to release the controls, overlays, character and render targets. The host retains the world.

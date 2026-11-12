# @miragekit/play

Walk, fly, an isometric game view and orbit over a world built with `@miragekit/world`; collision and ground from a
walk grid baked from the real geometry; progressive refinement when the view stops; an embed API for games.

```js
import { createPlay } from '@miragekit/play';
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

Options for games (`@miragekit/game` uses them): `walker` (any object with the walker's shape — `pos`, `onGround`,
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

## Reduced motion (`reducedMotion`)

`createPlay(world, { reducedMotion })`: `'auto'` (the default) follows the user's `prefers-reduced-motion`, live (a
change of the system setting applies at once); `true`, `false` or `{ sway, rain }` override it; `play.reducedMotion`
reads whether it is on and takes the same values later. On, the world's wind sway (x 0.25) and rain (x 0.4) slow
down and still frames get no shutter motion blur (core's `world.setReducedMotion`), and the walking eye eases over
steps and jumps instead of following them exactly (there is no head bob to remove). Without the system setting
`'auto'` changes nothing (the frames are bit-identical); `'auto'` only switches off what it switched on, so a world
created with `reducedMotion` keeps it; `dispose()` gives the world back its setting. The switch is in
`src/motion.js` (`resolveReducedMotion`, `followReducedMotion`; Node-tested in `check.mjs`, live in Chrome with
emulated media in `packages/tools/looks.check.mjs`). `play.render({ transparent: true })` returns the current view
as a transparent still (core's `world.renderTransparent`).

## WebXR: VR and AR (`createXR(play, opts)`, experimental)

```js
import { createPlay, createXR, xrSupport } from '@miragekit/play';
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

Hosts can import `createCharacter` from `@miragekit/play` and attach its `root` to their own scene. The origin
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

Over frames, and in parts (opt-in): `await bakeWalkGridAsync(world, { bounds, ...plan.walk, budgetMs = 4, inflight = 8,
tile = 1024 })` makes the same arrays bit for bit (the same draws through the same camera; tiles only scissor them),
reading the slabs through pixel-pack buffers polled with fences, so the page keeps drawing (async bakes into one
grid run in turn; a tile starts again when the scene changes under it; `signal` aborts); pass the grid to
`createPlay(world, { grid })`. `{ region: [x0, z0, x1, z1], into: grid }` (sync or async) re-bakes only the cells
under a region of an earlier bake, in place, e.g. after a streamed module came in. The scene is sampled as it is in
each frame: change it during an async bake and re-bake that region afterwards.

## The walker (`createWalker(grid, { pos, body })`)

A cylinder (r 0.28 m, head 1.8 m, eye 1.62 m) that steps up ≤ 0.4 m (0.12 m in the air), falls under gravity,
jumps (4.2 m/s: apex ≈ 0.9 m), and slides along what blocks it (sub-steps of 5 cm). Pure JS: `npm test -w @miragekit/play`
runs it on a hand-made grid in node.

## NPC navigation (`createNavGrid(grid, opts)`, experimental)

```js
import { createNavGrid, createNavAgent, createNavCrowd } from '@miragekit/play';
const nav = createNavGrid(play.grid);                              // ~85 ms for the 80 x 94 m garden
const path = nav.findPath([x, y, z], [x, y, z], { radius: 0.2 });  // [[x, y, z], ...] feet waypoints, or null
const door = nav.block({ box: [x0, y0, z0, x1, y1, z1] });         // or { cylinder: [x, z, r, y0, y1] }; nav.unblock(door)
const dog = createNavAgent(nav, { radius: 0.2, speed: 3, pos }); dog.setGoal(goal); dog.update(dt);
const field = nav.flowField(goal);                                  // many agents, one goal: agent.setGoal(field)
const crowd = createNavCrowd(nav, { separation: 2 }); crowd.add(dog); crowd.update(dt);
```

No second mesh: NPCs path on the grid the player walks on. Every floor of every cell carries a fit bit per
radius, computed by the walker's own test (its disc of cells, each within `step` 0.4 m of the feet with `head`
1.8 m of air) at the floor's height and where the feet settle; since the disc offsets are whole cells, the bit is
the walker's answer anywhere in the cell (`npm test -w @miragekit/play` compares them floor by floor; on
walled-garden 20 000 of 20 000). A move lands on the next cell's highest floor within a step (drops up to `drop`,
default a step), so stairs join floors and a slab above keeps its own nodes. Paths: A* over coarse blocks
(`coarse` cells a side, each split into its connected pieces), then cell A* inside that corridor, then string
pulling with a cell walk that follows heights. `block` / `unblock` edit the fit bits and pieces around the
obstacle only (~1 ms); walkers made on `nav.grid` collide with it too. Agents are walkers (`nav.grid`, their own
radius), so they climb stairs and follow the ground as the player does. Numbers and limits: the CHANGELOG entry;
the browser check `node packages/tools/nav-check.mjs` (walled-garden; `?npc=N` there shows N travellers).

## 2.5D: sprite actors, the iso camera, click to move (experimental, opt-in)

2D sprite figures in the lit world, a high camera, and picking the ground on the walk grid. Guide and atlas format:
[docs/sprites-25d.md](../../docs/sprites-25d.md); example: `examples/sprite-yard`.

```js
const atlas = await loadAtlas('/sprites/hero/atlas.json', { placeholder: { shape: 'humanoid' } });
const hero = createSpriteActor(world, atlas, { silhouette: true });
const iso = createIsoCamera({ pitch: 52, yaw: 35, min: 10, max: 34 }); iso.bind(canvas);
canvas.onpointerdown = (e) => {
  ray.setFromCamera(ndc(e), world.camera);
  const p = pickWalkGrid(grid, ray.ray, { nav, radius: 0.3 });
  if (p) reachableGoal(nav, p, { from: agent.pos, tryGoal: (q) => agent.setGoal(q) });
};
// each frame: iso.follow(feet).update(dt).apply(world.camera); hero.group.position.set(...agent.pos);
//             hero.setFacing(Math.atan2(agent.heading[0], agent.heading[1])); hero.update(dt, iso.yaw);
```

The card material is `world.mat.std` with `patch()` hooks, so the sun, its shadows, the sky light, lamps, fog and the
grade all light the figure; one program for every sprite. Pure parts without three: `spriteDirection`,
`drawnDirection`, `parseAtlas`, `createSpriteAnim`, `createIsoCamera`, `pickWalkGrid`, `reachableGoal`
(`sprites.check.mjs`). Subpaths: `@miragekit/play/sprites`, `/iso-camera`, `/walk-pick`.

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

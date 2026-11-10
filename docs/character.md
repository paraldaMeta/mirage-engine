# Character control

Everything here is **opt-in and experimental**, in `@mirage/play`. `createWalker`, `createPlay` and every example
that does not import the new modules behave and render exactly as before (see "Off means off"). All of it is plain
JS on the walk grid: no three import in the movement code, no physics dependency, the same result for the same
inputs at a fixed step.

| module | import | what it does |
|---|---|---|
| `solids.js` | `createSolids`, `gridRay`, `volumeAt` | a walk grid with moving shapes composed in at query time: doors, lifts, turntables, crates; ladder and water volumes |
| `mover.js` | `createMover`, `driveAnimator`, `MOVER`, `MODES` | the walker plus coyote time, jump buffering, variable jump height, sprint, crouch, slope slide, ladders, swimming, mantling, platforms, pushing |
| `follow-camera.js` | `createFollowCamera` | third-person spring arm that shortens against the grid and its solids; first-person eye that follows a crouch |
| `physics-link.js` | `linkSolids` | the same solids mirrored into a Rapier world (`@mirage/game` `createPhysics`, or any `{ R, world }`) |

Each module's header has its usage block and its limits. The demo is `examples/demos/charnav`.

## The loop

```js
import { createSolids, createMover, createFollowCamera, linkSolids, driveAnimator } from '@mirage/play';

const space = createSolids(grid);                                   // grid: bakeWalkGrid(...) or play.grid
const lift  = space.add({ box: [1.2, 0.1, 1.2], pos: [4, 0.1, 0], kind: 'kinematic' });   // half extents, centre
const crate = space.add({ box: [0.4, 0.4, 0.4], pos: [0, 0.4, 3], kind: 'dynamic', mass: 30 });
space.addVolume({ type: 'ladder', box: [x0, y0, z0, x1, y1, z1], facing: [0, 1] });
space.addVolume({ type: 'water', box: [x0, y0, z0, x1, y1, z1] });

const mover = createMover(space, { pos: [0, 0, 0], body: { sprint: 6.5 } });
const cam   = createFollowCamera(space, { mode: 'third', distance: 4.5 });
const link  = linkSolids(space, phys);  link.addMover(mover);       // optional: only when Rapier is in the game

// every fixed step (1/60 s)
lift.set({ pos: [4, liftY(t), 0] });                                // the game moves kinematic solids
link.pre(); phys.step(dt); link.post();                             // Rapier moves dynamic ones
mover.update(dt, { x, z, run, sprint, crouch, jump });              // x / z: wanted direction in the world
cam.update(dt, mover); cam.apply(camera);
driveAnimator(mover, animator);                                     // speed / grounded / crouch / mode, 'jump' / 'land'
```

`space` IS a walk grid (it answers `support`, `groundAt`, the layers), so `createWalker(space)`, cameras and sight
rays collide with the solids too. `createMover` has the walker's shape (`pos`, `vy`, `onGround`, `update`, `place`,
`fits`), so `createPlay({ walker: mover })` and `@mirage/net`'s `applyInput` take it unchanged; `mover.intent =
{ crouch, sprint }` is merged into every input for hosts that only pass `x / z / run / jump`.

## The one rule for two collision worlds

The walker collides with the grid; crates and ragdolls collide in Rapier. They are kept in agreement by one rule:

> **A moving solid is described once, as a shape and a pose in `createSolids`, and has one owner of that pose.**
> `kind: 'kinematic'` (doors, lifts, turntables): the game calls `solid.set()`; `link.pre()` copies it to Rapier
> before its step. `kind: 'dynamic'` (crates, barrels): Rapier integrates it; `link.post()` copies the pose back
> with `solid.set()` after its step. Nothing else moves a solid.

The walker, the camera, sight rays and the navigation carve read the list; Rapier gets a collider built from the
same half extents. A mover pushes a dynamic solid through `space.push` (an impulse of `body.push` newtons x dt
while it walks into the solid), which arrives in Rapier as an impulse; the mover itself is a kinematic capsule
there (`link.addMover`), so crates stop at it. What can still differ is the grid's sampling (a cell, 0.125 m; a
solid is half a cell fatter sideways for standing and blocking) and one step of latency.

Tested in `packages/play/mover.check.mjs` against real Rapier: after 4000 random probes round a door and crates the
grid and Rapier agree on blocked / free in 3999; a kinematic pose differs by 0 after `pre()`; a dynamic crate's
pose differs by 0 after `post()`; a walker pushes a 30 kg crate 2.69 m in the test run and stops 0.045 m short of a
crate Rapier holds against a wall. In the browser demo the crate is pushed 1.61 m with a Rapier-to-solid gap of 0.

## What the mover adds

Each one is off when its input or its data is absent. The numbers are the defaults in `MOVER` (override with
`body`).

| feature | how | defaults |
|---|---|---|
| jump | coyote time after walking off an edge, a press buffered before landing, releasing early cuts the rise; a held jump does not repeat | `coyote` 0.1 s, `buffer` 0.12 s, `jumpCut` 0.45 |
| sprint / crouch | `input.sprint`, `input.crouch`; standing up needs the head room, else it stays crouched | `sprint` 6.2 m/s, `crouchSpeed` 1.1, `crouchHead` 1.1 m, `crouchEye` 0.95 m |
| slopes | steeper than `slope`: slides down, cannot walk up; a stair riser is a step, not a slope | `slope` 42 degrees, `slideMax` 7 m/s |
| step up / down | the walker's own: `body.step` up without a jump, snapped down the same height | walker `BODY` |
| platforms | stands on a solid and is carried by its translation and its turn (`mover.carry` = `[dx, dy, dz, dyaw]`; the follow camera adds the turn) | |
| blocking | pushed out of and stopped by solids: a closed door is a wall | |
| pushing | walking into a dynamic solid pushes it | `push` 260 N |
| ladders | `{ type: 'ladder', box, facing }`: into the wall climbs, away climbs down, jump lets go | `climb` 1.6 m/s |
| swimming | `{ type: 'water', box }` deeper than `swimDepth`: swims, jump rises, crouch dives | `swim` 2.2 m/s, `swimDepth` 1.2 m |
| mantling | holding jump against a ledge between `step` and `mantleMax` above the feet, in the air or in water, pulls the body up when it fits | `mantleMax` 1.9 m, `mantleTime` 0.5 s |

`mover.mode` is one of `idle walk run sprint crouch jump fall slide climb swim mantle`. `driveAnimator(mover,
animator)` sets `speed`, `vy`, `grounded`, `crouch`, `mode` (the index in `MODES`) and one 0 / 1 number per mode
name on a `@mirage/core` animator, and triggers the mover's events (`jump`, `land`); anything with a chainable
`set(name, value)` and `trigger(name)` works.

## Cameras

`createFollowCamera(space, { mode: 'third' | 'first', distance, height, shoulder })`. Third person: five rays from
the pivot marched through the grid and its solids; the shortest clear one sets the boom. It shortens at once and
lengthens eased, so a post passing by does not pump it. First person: the eye at `mover.eye`, which eases down in a
crouch. `cam.turn(dYaw, dPitch)` from the mouse, `cam.forward()` to steer input by, `cam.apply(camera)`. Riding a
turntable turns the camera with the body. Measured in the demo: boom 4.5 m in the open, 0.50 m with a wall behind;
eye 1.62 m standing, 0.95 m crouched.

## Determinism and prediction

At a fixed step the mover is a pure function of its state and its inputs. `mover.save()` / `mover.restore(s)` hold
everything a replay needs (timers for coyote and buffer, the jump edge, the mode, the platform it rides). The check
restores a save taken at step 2500 (through JSON) and replays: the same 2500 steps, bit for bit; and runs 2000
quantised inputs through `@mirage/net`'s `applyInput` on two movers: identical, and `saveWalker` / `restoreWalker`
apply. The net input still carries one jump bit: the mover takes the edge from the held
state. Moving solids are part of the world state: a predicting client must have them at the same pose on the same
tick (drive kinematic ones from the tick number, as the demo does; dynamic ones are the server's, corrected like
any other replicated body).

## Cost

Node, one core of this machine, median of 5 runs (min-max), per `update`:

| | microseconds |
|---|---|
| `createWalker` (before) | 1.04 (1.02-1.07) |
| `createMover` on a plain grid | 1.33 (1.33-1.36) |
| `createMover` on `createSolids` with 20 solids | 3.08 (3.05-3.10) |

In the demo page (headless Chrome, a 320 x 320 grid, a lift, a turntable, a door, three crates): mover 4.8 us a
step by the page's own timer, Rapier 0.012 ms, both far below a frame.

## Demo

`examples/demos/charnav`: a lift to a deck (and a ladder up the same deck), a turntable, a sliding door, three
crates to push, a fenced yard to jump into. WASD, Shift sprint, C crouch, Space jump, V first / third person, E the
door (`?door=manual`), G debug. Flags: `?physics=0` (no Rapier: crates become static, everything else works),
`?cam=first`, `?door=manual`, `?debug=1`, `?agents=N`. Check: `node examples/demos/charnav/charnav-check.mjs`.

## Off means off

Nothing new is imported by `createPlay`, the walker or any example but `demos/charnav`. Stills of
`hello-courtyard` and `walled-garden` (whose NPC uses the navigation grid that gained areas and links) before and
after this work are bit-identical: see the changelog entry.

## What Unity and Unreal still have

- Unreal's `CharacterMovementComponent` and Unity's `CharacterController` sweep a capsule against arbitrary
  triangle and convex geometry. Here the body is a cylinder sampled on a 0.125 m grid: it stops up to a cell and a
  half short of a moving solid's true face, and moving solids are boxes, cylinders and spheres only.
- Acceleration, braking and friction curves, root motion, and network smoothing of other players' movers are the
  game's to add: speed here is the input's.
- Motion matching and the animation side of traversal (hand IK on a ledge, ladder rungs under the hands): the mover
  exposes the mode and the timing; nothing picks poses from a motion database.
- A ladder is a box with a facing and water is a box: no splines, no buoyancy for bodies, no currents.
- A slope must be at least three cells wide to read as one.

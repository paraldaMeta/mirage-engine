# Physics: bodies, joints, ragdolls, vehicles, forces

All of this is in `@miragekit/game`, on Rapier 0.19 (the same WASM `createPhysics` already loads), experimental and
opt-in: a game that does not call `createPhysicsKit` runs none of it, and `createPhysics` (props, doors, the
character) works as before. To see it: `examples/demos/physics` (flags at the end). Numbers on this page were
measured on one machine (Apple silicon laptop, Node 22, headless Chrome); how is said next to each.

```js
import { createPhysics, createPhysicsKit, createJoints, createForces, createVehicle, createRagdoll, createPhysicsDebug } from '@miragekit/game';

const phys = await createPhysics(scene); phys.addStatic(world.scene);        // as before
const kit = createPhysicsKit(phys, { hz: 60, layers: ['world', 'prop', 'debris', 'ragdoll'] });
// each frame:
anim?.update(dt); kit.advance(dt); ragdoll?.update(dt);
```

`phys.addStatic(root)` turns every visible solid mesh under `root` into a fixed triangle mesh, so keep the meshes
of moving bodies outside that root (or give them `userData.collide = false`).

## Bodies

```js
const crate = kit.rigid(mesh, { material: 'wood' });                          // a box from the mesh's bounds
const ball = kit.rigid(mesh, { shape: 'ball', material: 'rubber', ccd: true, events: true, layer: 'debris', mask: ['world'] });
const rock = kit.rigid(mesh, { shape: 'hull' });                              // convex hull of the vertices
const table = kit.rigid(group, { colliders: [{ shape: 'box', half: [1, 0.05, 0.6], pos: [0, 0.8, 0] }, /* legs */] });
const wall = kit.rigid(mesh, { type: 'fixed', shape: 'mesh' });               // triangle mesh: fixed or kinematic only
```

Shapes: `box`, `ball`, `capsule`, `cylinder`, `cone`, `hull`, `mesh`, `compound` (one collider per child mesh, or
`colliders` by hand). Sizes come from the geometry unless given. `mass` in kg, or the material's density times
the volume. A body has `pos`, `quat`, `velocity`, `spin`, `mass`, `sleeping`, `impulse(j, at)`, `twist(j)`,
`teleport`, `moveTo` (kinematic), `wake`, `sleep`, `setLayer`, `setCcd`, `setEvents`, `remove`; `body.body` is
Rapier's own.

- **Materials.** `PHYSICS_MATERIALS` has `default`, `wood`, `stone`, `metal`, `rubber`, `ice`; `kit.material(name,
  { friction, restitution, density, frictionCombine, restitutionCombine })` adds one; the combine rules are
  `average`, `min`, `multiply`, `max` (the higher-ranked rule of the two colliders wins, as in Rapier). Measured in the Node
  check: dropped from 2 m, a rubber ball comes back to 1.33 m and a stone one to 0.24 m; pushed off at 6 m/s, a
  box slides 11.0 m on ice, 2.6 m on wood and 0.9 m on a high-friction floor.
- **Layers.** Up to 16 names; `kit.layers.collide('debris', 'ragdoll', false)` edits the matrix; `layer` and `mask`
  per body. Queries take `{ layers, exclude, sensors, fixed, dynamic, kinematic, test }`.
- **CCD.** `ccd: true` sweeps the body; `ccd: 'soft'` is Rapier's cheaper predictive kind. Measured: a 4 cm wall
  lets a ball at 300 m/s through without it and stops it with it (Node check); in the demo page the same at
  150 m/s, `?ccd=0` to see it fail.
- **Sleeping** is Rapier's (`canSleep: false` to opt a body out); `kit.stats().awake` counts what is not.
- **Kinematic** bodies are moved with `moveTo(p, q)` and push dynamic ones; see platforms below.

## Events, sensors, queries

```js
kit.on('contact', (e) => { if (e.impulse > 30) thud(e.point, e.impulse); });   // bodies made with events: true
const gate = kit.sensor({ shape: 'box', half: [3, 1.5, 0.3], pos: [0, 1.5, 9] }, { name: 'gate' });
gate.onEnter = (e) => ...; gate.onExit = (e) => ...; gate.count;    // e.body; also kit.on('enter' | 'exit')
kit.ray(from, dir, max, filter); kit.rayAll(...); kit.shapeCast(shape, from, dir, max, filter);
kit.overlap(shape, pos, filter); kit.closest(point, filter);
```

A contact event carries `impulse` (N s, summed over the step it began in), `force`, `point`, `normal`, `speed`
and both bodies. Measured: 19.98 N s for a 2 kg ball landing at 9.57 m/s with restitution 0 (19.1 expected from
m v, plus one step of weight). `contactEnd`, `enter`, `exit`, `break`, `step` (before each fixed step) and
`stepped` are the other events. A sensor counts bodies that are awake when they cross it.

## Fixed step, interpolation, determinism

`kit.advance(frameDt)` takes fixed steps of `1 / hz` from an accumulator (at most `maxSteps` per frame, the rest
of a long frame is dropped) and then places the objects between the last two steps, so a 144 Hz display of a 60 Hz
simulation does not judder (`interpolate: false`, or `?interp=0` in the demo, to see the difference). `kit.hash()`
hashes every body's pose and velocity. `phys.snapshot()` / `phys.restore()` carry the kit, the joints, the forces
and the ragdolls with them. Checked: the same build and the same calls give the same hash, and restore plus the
same 120 steps (with an explosion) ends on the same hash, in Node and in Chrome. That is determinism on one
machine and build; across CPU architectures it is not checked here (Rapier has a separate deterministic build,
which this package does not ship).

## Joints

```js
const joints = createJoints(kit);
joints.fixed(null, plank, { anchor, breakForce: 400 });                      // null = the world
joints.ball(a, b, { anchor });  joints.cone(a, b, { anchor, axis, swing: 1, twist: 0.4 });
const door = joints.hinge(null, leaf, { anchor, axis: [0, 1, 0], limits: [-1.2, 1.2], motor: { speed: 1.2, strength: 40 } });
joints.slider(null, lift, { anchor, axis: [0, 1, 0], limits: [0, 1.6], motor: { target: 1.2, stiffness: 400, damping: 40 } });
joints.spring(a, b, { anchorA, anchorB, rest: 1, stiffness: 300, damping: 12 });
joints.rope(a, b, { anchorA, anchorB, length: 2 });
joints.sixDof(a, b, { anchor, axis, linear: { x: 'locked', y: [-0.4, 0.1], z: 'locked' }, angular: { x: 'free' } });
kit.on('break', ({ joint, force }) => ...);
```

A joint has `alive`, `force` (N), `angle` (hinge), `travel` (slider), `length`, `setLimits`, `setMotor`, `remove`.
Measured in the Node check: a hanging chain of four 5 kg links reads 196.2 / 147.15 / 98.1 / 49.05 N; a hinge
with limits [-0.6, 0.9] stops at 0.902 and -0.6; a cone of 0.5 rad swing and 0.3 twist is exceeded by 0.011 and
0.063 under load.

Limits of this, all from what Rapier's JavaScript build offers:

- hinge, slider and six-axis joints take one axis for both bodies, so the two bodies must have the same
  orientation when the joint is made (it throws otherwise; a joint to the world is always fine);
- `cone` is a soft stop computed here (a few degrees of give), because a ball joint's three per-axis limits do not
  hold when two angles are large at once;
- Rapier does not report the force in a joint, so `force` and `breakForce` use an estimate from each body's
  change of velocity and its contacts: exact for chains and trees, least-norm for loops, and 0 while both bodies
  sleep. There is no break torque;
- joints stretch under hard hits (up to about 12 cm between ragdoll parts in a fall).

## Ragdoll

```js
const rag = createRagdoll(kit, rig.root, { layer: 'ragdoll' });   // RAGDOLL_HUMANOID: 14 parts, 13 joints, 75 kg
rag.ragdoll({ velocity });            // falls, keeping the speed the animation gave each part
rag.animate({ blend: 0.6 });          // back to the animation from wherever it lies
rag.partial(['LeftArm'], true);       // that limb limp, the rest animated
rag.drive(0.6, 0.3);                  // active ragdoll: pulled towards the animated pose
rag.impulse('Chest', [0, 0, -300]);   rag.partOf(hit.body);   rag.pose();   rag.atRest;
```

While animated the parts are kinematic bodies that follow the bones: hit boxes for rays, and they push props. To
get up, put the character's root at `rag.pose().pos` and call `animate`. `parts` describes other rigs (bone, parent,
capsule / box / ball, joint and limits). Measured: bones follow bodies within 0.124 m in a fall; an active
ragdoll pushed with 150 N s is 0.034 m off its pose and 0.001 m a second later.

Not there: an authored get-up clip (the blend goes straight into whatever the animator plays; pick your own clip by
`pose().faceUp`), and muscles with a strength per joint (`drive` is one strength for the whole figure).

## Vehicle

```js
const car = createVehicle(kit, chassis, { half: [0.85, 0.3, 1.9], mass: 1200, topSpeed: 30,
  wheels: [{ pos: [0.8, -0.2, 1.3], steer: true, obj: wheelFL }, /* ... */] });
car.controls.throttle = 1; car.controls.steer = -0.4; car.controls.brake = 0; car.controls.handbrake = false;
```

One ray per wheel, a spring and damper along it, tyre forces at the contact clamped by grip times load; no wheel
bodies. Forward is the chassis' +z. Measured with the defaults: 15.7 m/s after 3 s, 28.7 m/s top (30 asked),
from there to a stop in 2.07 s over 29 m. The demo has the follow camera (`C`, or `?cam=follow`). Not there:
gears and an engine curve, a tyre model with slip curves (it is a friction clamp), anti-roll bars, tracked or
two-wheeled vehicles.

## Forces

```js
const forces = createForces(kit);
forces.water({ min, max }, { density: 1000, drag: 1.5, flow: [0.5, 0, 0] });   // buoyancy by displaced volume
forces.explosion(at, { radius: 6, impulse: 400, falloff: 'linear', upward: 0.5, occlude: true });   // -> hits
forces.platform(obj, { path: [[2, 0.1, 6], [2, 2.6, 6], [7, 2.6, 6]], speed: 1.5 });   // carries what stands on it
forces.carry(character);                                                       // phys.character() rides it too
```

Measured: a wood cube (600 kg/m3) in water floats with its centre at 1.921 where 1.9 is exact; an explosion of
50 N s and 5 m radius gave three boxes 40 / 25 / 10 N s, falling with distance, and nothing to one behind a wall
with `occlude`. The water
is a box with a flat surface: no waves, no flow field, no fluid simulation.

## Debug draw and stats

`createPhysicsDebug(kit, scene, { colliders, joints, contacts, stats })`: collider outlines (Rapier's debug
render), joints (red near their break force), contact ticks, and a text line. `kit.stats()` gives `{ bodies,
dynamic, awake, colliders, joints, sensors, stepMs, stepMsAvg, rapierMs, steps }` (`profile: true` for
`rapierMs`). `G` or `?debug=1` in the demo.

## Performance

`node packages/game/physics-bench.mjs` (Node 22, 3 rounds interleaved; ms per 1/60 s step, median of the rounds
with the lowest and highest round). Boxes of 0.8 m dropped as a loose 10 x 10 column that collapses into a heap;
ragdolls dropped on one spot.

| scene | falling (first 3 s) | worst step | last second of 10 | awake at 10 s |
| --- | --- | --- | --- | --- |
| 500 boxes | 0.75 (0.75-0.77) | 2.26 (2.07-2.40) | 0.03 (0.02-0.03) | 0 of 500 |
| 2000 boxes | 3.19 (3.18-3.28) | 7.19 (6.86-28.23) | 5.55 (5.47-5.70) | 1996 of 2000 |
| 5000 boxes | 6.79 (6.74-7.22) | 33.14 (29.11-33.50) | 22.30 (22.17-22.53) | 4737 of 5000 |
| 20 ragdolls (280 bodies) | 0.93 (0.91-1.07) | 3.82 (3.81-5.38) | 1.65 (1.64-1.69) | 280 of 280 |

So 500 boxes are cheap and go to sleep; 2000 fit a 60 Hz frame with room; 5000 in one heap do not (22 ms a step
with nearly all of them still awake). A pile of 20 ragdolls costs 1.7 ms and had not gone to
sleep after 10 s. In headless Chrome (the demo page, pyramids of 36 thrown by one explosion, 240 steps, two
runs): 500 boxes median 0.6 ms, 95th percentile 1.5-1.6; 2000 boxes median 0.6, 95th percentile 4.7-6.5. Rapier
runs on one thread here. For tall piles `phys.world.numSolverIterations = 8` (default 4) trades time for
stiffness; not measured.

## What Unity and Unreal have that this does not

Cloth, soft bodies, destruction / fracture (Chaos, pre-fractured meshes), fluid simulation, GPU physics, and
multi-threaded stepping. Also missing next to PhysX / Chaos: height-field colliders (use a triangle mesh), a
wheel collider with slip curves, articulations (reduced-coordinate joints: these joints stretch instead), break
torque, cross-platform determinism, and an editor for any of it.

## The demo

`examples/demos/physics` — `node examples/demos/physics/physics-check.mjs` runs it headless (23 checks).

| flag | |
| --- | --- |
| `?show=stack,joints,ragdoll,vehicle,water,platform` | which stations (default all) |
| `?physics=0` | the yard with no physics world |
| `?boxes=N` | boxes in the stack (36) |
| `?ragdolls=N`, `?fall=T`, `?boom=T` | more figures; ragdoll or explosion at T seconds |
| `?cam=follow`, `?auto=1` | camera behind the car; the car drives a circle by itself |
| `?debug=1`, `?hz=`, `?interp=0`, `?ccd=0` | debug draw, step rate, no interpolation, bullets without CCD |

Keys: WASD drive, Space handbrake, R ragdoll / get up, P limp arm, T active ragdoll, E explosion, B shoot, C
camera, G debug.

# Navigation and AI

Everything here is **opt-in and experimental**, in `@mirage/play`. It extends the navigation grid
(`createNavGrid`: nodes are the walk grid's cells, one per floor) that NPCs already used; a game that calls none of
the new methods gets the paths it got before. Plain JS, no wasm, no second mesh to bake or ship.

| module | import | what it does |
|---|---|---|
| `navgrid.js` | `createNavGrid` (extended) | areas with costs, off-mesh links, turned-box obstacles, `fits`, `nearest`, `profile`, `version` |
| `nav-carve.js` | `carveSolids` | every moving solid of a `createSolids` space becomes an obstacle that follows it; incremental re-bake |
| `nav-path.js` | `createPathQueue`, `smoothPath`, `pathLength` | path queries on a per-frame budget; corners rounded into arcs |
| `crowd.js` | `createCrowd` | ORCA local avoidance for hundreds to thousands of agents with different radii, in typed arrays |
| `ai.js` | `createBehaviorTree`, `bt`, `createSenses`, `patrol`, `chase`, `flee`, `investigate`, `follow`, `guard`, `agentActor` | behaviour trees with a blackboard, sight and hearing, ready behaviours |
| `nav-debug.js` | `createNavDebug` | draw the grid by area, carved cells, links, paths, crowd velocities, a tree as text |

Each module's header has its usage block and its limits. The demo is `examples/demos/charnav`.

## Areas, links, obstacles

```js
const nav = createNavGrid(grid, { coarse: 4 });
nav.setArea({ box: [x0, y0, z0, x1, y1, z1] }, 2);  nav.setAreaCost(2, 4);     // mud: a metre there costs four
nav.findPath(a, b, { radius: 0.3, costs: { 2: Infinity } });                    // per query: this agent may not enter
const id = nav.link({ from: [10, 0, 5.2], to: [10, 0, 6.8], type: 'jump', bidirectional: true, time: 0.7,
  canEnter: (actor, link) => true, traverse: (f, link, actor) => [x, y, z] });  // callbacks are optional
nav.block({ obb: [cx, cz, hx, hz, yaw, y0, y1] });   nav.unblock(id);           // also { box } and { cylinder }
```

A waypoint that lands on a link's far end carries `.link`. `createCrowd` and `createNavAgent` cross it in
`link.time` seconds (default: its length at the agent's speed) along `link.traverse(f, link, actor)` or a straight
line with a hop for `type: 'jump'`; `link.canEnter() === false` holds the agent at the near end (a door still
shut); `crowd.onLink = (i, link, 'start' | 'end') => {}` is where a game plays the jump animation. `canUse` in the
path options says which links an agent may take at all.

`nav.block` / `nav.unblock` recompute fit bits and coarse pieces only in the cells round the shape, and bump
`nav.version`; agents and crowds watch the version and ask for a new path.

## Carving moving solids

```js
const carve = carveSolids(nav, space);        // space: createSolids (docs/character.md)
// each step, after link.post():
carve.update();                               // re-blocks what moved more than half a cell or turned 0.05 rad
```

A door leaf, a pushed crate, a barrel Rapier rolled: the same description the walker and Rapier collide with is cut
out of the navigation. A solid that agents should walk on, not round (a lift), gets `data: { carve: false }` and a
`nav.link` between its landings.

## Queries on a budget, smoother paths

```js
const queue = createPathQueue(nav, { budgetMs: 2 });
const path = await queue.request(from, to, { radius, priority: 1 });      // or { then: (path) => ... } for fixed-step code
queue.update();                                                           // each frame: best priority first, until the budget is spent
smoothPath(nav, path, { radius, corner: 0.6 });                           // corners become arcs nav.visible() accepts
```

The budget decides how many queries start in a frame; one query is not sliced (bound it with `maxNodes`). `{ origin:
() => pos | null }` lets a query that waited start from where the asker is now, or drop out.

## Crowds

```js
const crowd = createCrowd(nav, { max: 2048 });
const i = crowd.add({ pos, radius: 0.22 + Math.random() * 0.16, speed: 1.4 });
crowd.setGoal(i, goal);            // queued path; or setField(i, nav.flowField(goal)) / setVelocity(i, vx, vz)
const me = crowd.add({ pos, radius: 0.35, fixed: true });  crowd.move(me, x, y, z);   // the player: avoided, never steered
crowd.update(dt);                  // crowd.x[i], y, z, vx, vz, crowd.arrived(i)
```

Each step: neighbours from a hash grid, one half-plane of allowed velocities per neighbour (reciprocal: each of a
pair takes half the detour, so nobody oscillates), the velocity nearest the wished one by a small linear program,
then the move kept on cells the radius fits. Radii differ per agent; the navigation keeps one fit profile per
distinct radius, so for paths and the wall clamp a radius is rounded up to `radiusStep` (0.05 m).

The default path budget is wall-clock milliseconds, so under load agents get their paths later and a run is not
bit-exact. For replays pass a counted queue: `createCrowd(nav, { queue: createPathQueue(nav, { budgetMs: Infinity,
max: 8 }) })` and call `queue.update()` before `crowd.update(dt)`.

## Behaviour trees and senses

```js
const senses = createSenses(space);
const brain = createBehaviorTree(guard({ points, chaseSpeed: 3.4, onCatch }), {
  actor: crowd.actor(i), nav, senses,
  perception: { targets: () => [mover], range: 16, fov: 120, memory: 2 } });
// each step
senses.update(dt);  brain.tick(dt);                     // 'running' | 'success' | 'failure'
senses.noise(pos, { radius: 9, tag: 'step', source: mover });
brain.blackboard.get('target');  brain.describe();      // the tree as text, each node with its last status
```

Nodes (`bt.*`): `sequence`, `selector` (a higher branch interrupts a lower one; the interrupted branch is reset and
its running actions get their abort), `parallel`, `invert`, `succeed`, `repeat`, `cooldown`, `timeout`, `wait`,
`condition`, `action`. Sight is a cone with range, occluded by two rays (head and chest) through the walk grid and
its solids: a closed door hides the player. Hearing is a radius with one occlusion test. Perception writes `target`,
`lastKnown` and `heard` to the blackboard. Ready behaviours: `patrol`, `chase`, `flee`, `investigate`, `follow`,
and `guard` (chase what it sees, look where it last saw or heard something, else patrol). They drive anything with
`{ pos, heading, moveTo, stop, arrived }`: `crowd.actor(i)` or `agentActor(createNavAgent(...))`.

## Debug draw

```js
const debug = createNavDebug(nav, { radius: 0.28 });  scene.add(debug.group);
debug.grid(); debug.links(); debug.paths([path]); debug.crowd(crowd); debug.tree(brain, preElement);
```

Nothing is drawn until a method is called. In the demo: `?debug=1` or the G key.

## Measured

Node, one core of this machine, median of 5 runs (min-max) unless said otherwise. The grids are generated yards
with walls and pillars, 0.125 m cells.

| | 160 x 160 cells | 512 x 512 cells |
|---|---|---|
| `createNavGrid` | 6 ms | 63 ms |
| `findPath`, 300 random pairs, mean | 0.141 ms (0.141-0.145) | 0.740 ms (0.713-0.747) |
| p95 / worst | 0.389 / 0.675 ms | 1.678 / 2.282 ms |
| with area costs (no coarse corridor) | not measured | about 2.7 ms |
| `flowField` over the whole floor | 21.4 ms | not measured |
| block + unblock a door leaf | 0.077 ms (0.074-0.095) | 0.074 ms (0.071-0.079) |
| re-carve a pushed crate | 0.174 ms (0.163-0.179) | not measured |

`crowd.update` per step, agents (radii 0.25 to 0.35 m) spread over the 512 x 512 grid (64 m, pillars on 8% of it),
each walking to a far goal through the others, paths excluded: 200 agents 0.085 ms (0.079-0.120), 500: 0.286
(0.272-0.300), 1000: 0.909 (0.842-0.936), 2000: 2.682 (2.571-2.724).

The demo page in headless Chrome at 1280 x 720 (320 x 320 cells, 102 426 nav nodes, agents drawn as instanced
capsules, no skinned figures), two rounds of 5 s each:

| agents | frames per second | `crowd.update` per step |
|---|---|---|
| 240 | 60 | 0.28-0.29 ms |
| 500 | 60 | 0.59-0.68 ms |
| 1000 | 60 | 1.56-1.69 ms |
| 2000 | 60 | 4.48-4.79 ms |

The page is capped at the display's 60, so 2000 is the largest count tried, not a ceiling that was found. In the
240-agent check run the deepest overlap between two agents over 10 s was 3 mm and 232 of 240 moved more than a
metre; the door's open-and-close cycle re-blocks 46 times at 0.019 ms a step on average. Guard: sees the player,
crosses the jump link into the yard and is within 1.16 m in 5.3 s. With the door shut the path to the far side is
12.69 m, open 5.5 m.

A dense test (300 agents crossing through each other) costs 0.46-0.53 ms a step with a deepest overlap of 8-10 mm;
220 to 293 of 300 had arrived after 70 s depending on the run, because the path budget is wall-clock and the
machine was shared. Forty agents swapping sides of a circle all arrive in 30.5 s.

## Limits

- Walls are not velocity obstacles: the navigation clamp stops an agent at them, so a dense crowd pressed into a
  corner packs instead of flowing round, and can deadlock at a narrow gap taken from both sides.
- A carved solid is a hole, not a floor: agents do not ride lifts or walk over a fallen crate without a link.
- Area costs switch the coarse corridor off for that query (about 3.5 times slower on 512 x 512).
- One query is not sliced across frames.
- Sight and hearing see only what the walk grid holds: foliage and glass neither hide nor reveal; sound does not
  travel round corners.
- No utility scoring, no planner (GOAP / HTN), no visual editor for trees.

## What Unity and Unreal still have

- **True navmesh polygons.** Recast-style meshes (Unity AI Navigation, Unreal's NavMesh) cover open ground with a
  few large polygons and give exact corridor edges. This is a grid of 0.125 m cells: memory and search grow with
  area, paths are string-pulled across cells, and clearance comes in steps of a cell.
- **Hierarchical and streamed navmesh.** Tiled navmesh that loads with world-partition cells, navigation invokers,
  and long-distance hierarchical queries. Here one grid covers one baked region; the two-level search (coarse
  blocks, then cells) is the only hierarchy, and nothing streams.
- **Mass-entity crowds.** Unreal's Mass and Unity's ECS run tens of thousands of agents across cores with LOD on
  simulation and animation. This is one thread and typed arrays: 2000 agents at 60 fps drawn as capsules, measured;
  skinned figures for that many are a rendering question this work did not address.
- **Motion matching** and the rest of the animation side of locomotion: see `docs/character.md`.
- Smart objects, environment queries (EQS), navmesh-based cover and jump-link generation: links here are placed by
  hand.

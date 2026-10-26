# The world protocol

How a Mirage world is put together so that several agents (or people) can build it at once without stepping on
each other. Package: `@mirage/world`. Examples: `examples/hello-courtyard` (4 modules), `examples/walled-garden`
(6 modules).

```
plan.js            the site plan: every shared position, in metres
modules/*.js       one file per module: { name, build, finalize?, anchors?, ambientVolumes? }
modules/index.js   the build order
NOTES.md           one section per module: what it offers, what it asks of others (append-only)
main.js            createWorldRenderer -> buildWorld(world, { plan, modules }) -> prepare -> createPlay
```

## 1. The site plan is the single source of positions

A plain object (JSON-able), checked by `definePlan()`; errors list every problem at once.

| field | meaning |
|---|---|
| `name`, `seed` | the world; `seed` (default `name`) seeds every module's randomness |
| units, axes | metres; +X east, +Y up, +Z south (north is −Z), the core's frame |
| `bounds: [x0, z0, x1, z1]` | the playable rectangle (the walk grid covers it) |
| `walk: { yMin, yMax }` | height range of anything walkable, plus head room |
| `regions`, `footprints` | named shapes `{ rect: [x0, z0, x1, z1] }`, `{ circle: [x, z, r] }`, `{ poly: [[x, z], …] }`, optional `y` |
| `paths` | `{ points: [[x, z], …], width }` |
| `points` | named spots `[x, y, z]` |
| `viewpoints`, `spawn`, `gameView` | `{ name, eye, look, mode? }` (keys 1–9 in play) |
| anything else | module parameters that more than one module reads (wall height, terrace levels, stair runs) |

Rule: if two modules need the same number, it goes in the plan. A module never measures another module's
geometry to find where something is. Helpers: `contains(shape, x, z)`, `bbox(shape)`, `pathLength(path)`,
`along(path, s)`.

## 2. Modules

```js
export default {
  name: 'walls',
  build(ctx) { /* add geometry to ctx.root; return anything (kept as ctx.modules.walls) */ },
  anchors: (ctx, built) => ({ lamps: [{ pos: [x, y, z], rotY, kind: 'wall' }] }),   // or a plain object
  finalize(ctx) { /* runs after every build: read ctx.anchors */ },
  ambientVolumes: (ctx, built) => [{ min: [x, y, z], max: [x, y, z], factor: 0.35, soft: 0.6 }],
};
```

`ctx` = the core's world context (`THREE, renderer, camera, G, keyDir, mat, geom, quality, place`) plus
`plan`, `name`, `root` (= `scene`: this module's own group), `R` (this module's seeded stream), `rng(sub)`,
`anchors` (merged so far; complete in finalize), `modules` (what earlier builds returned), `shared` (what
main.js passes, e.g. the texture layer), `onUpdate(fn)`, `collider(mesh)`, `log(...)`, `world`.

- **Order**: modules build in the order of the list; every `finalize` runs after all builds, in the same order.
  Producers first, consumers last (props).
- **Failure isolation**: a module that throws in `build`, `anchors` or `finalize` is logged
  (`[world] module "x" failed in build and was skipped`), its group and its `onUpdate` callbacks are dropped, and
  every other module builds as usual. `buildWorld` returns `report.failed`.
- **Randomness**: `ctx.R` is seeded by `plan.seed/name`, so adding draws in one module never moves another
  module's trees. Never use `Math.random`.
- **Ambient volumes**: boxes where the image-based light is scaled by `factor` (interiors); the loader hands them
  to the core (`world.setAmbientVolumes`), at most 8.

## 3. Anchors

Points one module offers so that another can put things there, without either knowing the other's code.

- Entry: `{ pos: [x, y, z], rotY, ...extra }` in world metres; the loader adds `from: <module>`.
- Facing: local +Z = `(sin rotY, 0, cos rotY)` points **out** of the wall / door into the open air.
- Each key has a documented meaning in the producer's NOTES section (where exactly `pos` is, which extras).

| key (examples) | pos is | extra |
|---|---|---|
| `lamps` | the lantern's ring (`kind: 'wall'`: the bracket plate on the wall face; `'hanging'`: the hook) | `kind`, `drop` |
| `posts` | the ground point at the foot of a lamp post | |
| `seats` | the ground point under a bench's centre, facing `rotY` | |
| `urns` | the ground point under a plinth | |

## 4. Collision conventions (the walk grid, `@mirage/play`)

The walk grid is baked from the real geometry seen from above, so modules declare nothing for ordinary solids.

- Layer 0 meshes that write depth are solid. `userData.collide = false` (on the mesh or any parent) leaves a
  mesh out: foliage, glass, water surfaces, the player's figure.
- A solid is a **closed** mesh. Open meshes (a vertical tube without caps, a single plane over a pool) get
  `collide = false` and a closed proxy: `ctx.collider(new THREE.Mesh(geometry))` (invisible, layer 2).
- The bake samples each 0.125 m cell at its centre, so a solid thinner than a cell (railings, posts, ropes) can be
  missed. One that must block gets a proxy box at least 0.2 m thick around it.
- A wall is a floor far above the walker's feet; a gate is a floor with a ceiling above head height; stairs are
  floors at most `step` (0.4 m) apart; anything 0.4–1.0 m high can be jumped onto.

## 5. NOTES.md between modules

Each world has a `NOTES.md` next to its modules. Template: `packages/world/NOTES.template.md`.

- One `## <module>` section per module, written only by that module's owner. Re-read before editing.
- **Append-only**: add dated entries; never rewrite someone else's section, never delete history (mark it
  "superseded by …").
- In your section: what you build, the anchors you offer (a table like the one above), the plan fields you read
  or own, what others must keep clear.
- **Requests** go in a `### Requests` list inside *your* section, addressed by name (`- **pavilion**: please …`).
  The addressee answers in its own section and links back.
- Numbers, not adjectives: heights, clearances, coordinates in plan terms.

# @mirage/world

The world protocol: a site plan as the single source of positions, a module interface, and a loader that builds
modules in order with failure isolation, merged anchors, ambient volumes and seeded randomness per module.
Full convention (for agents and humans): [docs/world-protocol.md](../../docs/world-protocol.md).

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
| `definePlan(plan)` | validate + defaults (`units 'm'`, `walk: { yMin: -1, yMax: 12 }`, `seed = name`); throws listing every problem |
| `contains(shape, x, z)`, `bbox(shape)`, `pathLength(path)`, `along(path, s)` | plan geometry helpers |
| `LAYER` | `{ VIEW: 0, COLLIDE: 2 }` (collision-only proxies live on layer 2) |

Module: `{ name, build(ctx), finalize?(ctx), anchors?, consumes?, ambientVolumes? }`.
Use `consumes: { required: ['lamps'], optional: ['seats'] }` to report available anchors before finalization.
Both lists can be omitted. See [the world protocol](../../docs/world-protocol.md#3-anchors) for examples and failure behavior.
`ctx` adds to the core's `world.ctx`: `plan, name, root (= scene), R, rng(sub), anchors, modules, shared, onUpdate, collider(mesh), log, world`.

`NOTES.template.md`: the per-world notes file modules use to talk to each other. `npm test -w @mirage/world` runs
`check.mjs` (plan checks, order, anchors, failure isolation, per-module rng; no GPU).

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

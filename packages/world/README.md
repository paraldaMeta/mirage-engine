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
| `buildWorld(world, { plan, modules, shared, log })` | build, anchors, finalize; returns `{ plan, modules, anchors, report }` |
| `definePlan(plan)` | validate + defaults (`units 'm'`, `walk: { yMin: -1, yMax: 12 }`, `seed = name`); throws listing every problem |
| `contains(shape, x, z)`, `bbox(shape)`, `pathLength(path)`, `along(path, s)` | plan geometry helpers |
| `LAYER` | `{ VIEW: 0, COLLIDE: 2 }` (collision-only proxies live on layer 2) |

Module: `{ name, build(ctx), finalize?(ctx), anchors?: object | (ctx, built) => object, ambientVolumes?: array | (ctx, built) => array }`.
`ctx` adds to the core's `world.ctx`: `plan, name, root (= scene), R, rng(sub), anchors, modules, shared, onUpdate, collider(mesh), log, world`.

`NOTES.template.md`: the per-world notes file modules use to talk to each other. `npm test -w @mirage/world` runs
`check.mjs` (plan checks, order, anchors, failure isolation, per-module rng; no GPU).

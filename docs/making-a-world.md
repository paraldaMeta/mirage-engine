# Making your own world

The examples are finished places. This page is the shortest path from an empty folder to a room you can walk
into, test and ship, typed by hand, then the things people walk into on the way. Every file below was built and
playtested as written (Chrome, macOS, M-series GPU: all five steps pass, no diagnostics, frame cost 1.66 ms as the
median of three parts 1.84 / 1.66 / 1.63). The contract behind it is [world-protocol.md](world-protocol.md).

## 1. Copy the skeleton

A world is a folder in `examples/` (the workspace gives it `three`, `vite` and the `@miragekit/*` packages; nothing to
install).

```sh
cp -R agent/mirage-brief-to-plan/assets/skeleton examples/my-world
cd examples/my-world            # set "name" in package.json and the title in index.html
```

You now have `main.js` (creates the world, builds the modules, starts play), `modules/materials.js` (shared
materials), `modules/index.js` (the build order), `scenarios/playtest.json` and the npm scripts.

## 2. The plan: every shared position, once

`plan.js`. Metres; +X east, +Y up, +Z south. Modules read positions from here and never measure each other.

```js
export default {
  name: 'my-world',
  bounds: [-12, -12, 12, 12],                 // the walkable area
  walk: { yMin: -1, yMax: 5 },
  render: { time: { elevation: 28, azimuth: 215 }, shadow: { center: [0, 1, 0], radius: 16 }, post: { exposure: 0.5 } },
  room: { rect: [-3, -6, 3, -1], height: 2.6, wall: 0.3, door: { x: 0, width: 1.2, height: 2.1 } },
  points: { lamp: [0, 2.2, -3.5] },           // one [x, y, z] per name
  viewpoints: [
    { name: 'arrival', eye: [4, 1.62, 7], look: [0, 1.4, -3] },
    { name: 'inside', eye: [0, 1.62, -2], look: [0, 1.5, -6] },
  ],
  spawn: { eye: [0, 1.62, 6], look: [0, 1.5, -3], mode: 'walk' },
};
```

`plan.points` takes one `[x, y, z]` per name. A list of spots (`lamps: [[..], [..]]`) is reported as MG102: give
each its own name, or keep the list as your own top-level field (`plan.lamps`, read as `ctx.plan.lamps`). Fields
the protocol does not know (`room` here) are yours.

## 3. Two modules

`modules/ground.js`: anything you add to `ctx.root` is drawn and collided with.

```js
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'ground',
  build(ctx) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 60), materials(ctx).stone);
    mesh.position.y = -0.1; mesh.receiveShadow = true;
    ctx.root.add(mesh);
  },
};
```

`modules/room.js`: four walls, a door, a roof, a lamp.

```js
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'room',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx);
    const { rect: [x0, z0, x1, z1], height, wall: T, door } = plan.room;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, b = new geom.MeshBatch();
    // geom.wall runs along local +X, centred
    b.add(geom.wall({ length: x1 - x0 + T, height, thickness: T, openings: [{ ...door, arch: 'flat' }] }), M.plaster, geom.compose([cx, 0, z1]));
    b.add(geom.wall({ length: x1 - x0 + T, height, thickness: T }), M.plaster, geom.compose([cx, 0, z0]));
    for (const x of [x0, x1]) b.add(geom.wall({ length: z1 - z0, height, thickness: T }), M.plaster, geom.compose([x, 0, cz], [0, Math.PI / 2, 0]));
    b.box(M.wood, [x1 - x0 + 0.6, 0.15, z1 - z0 + 0.6], [cx, height + 0.075, cz]);   // the roof
    const [lx, ly, lz] = plan.points.lamp;
    b.add(new THREE.SphereGeometry(0.1, 16, 12), M.lamp, geom.compose([lx, ly, lz]));
    root.add(b.finish({ name: 'room' }));
    const light = new THREE.PointLight(0xffb070, 10, 8, 2); light.position.set(lx, ly - 0.15, lz);
    root.add(light);
  },
  // inside this box the sky light is multiplied by factor (see "A dark room" below)
  ambientVolumes: (ctx) => { const { rect: [x0, z0, x1, z1], height } = ctx.plan.room; return [{ min: [x0, 0, z0], max: [x1, height, z1], factor: 0.35, soft: 0.6 }]; },
};
```

List both in `modules/index.js` (`export default [ground, room];`) and give `modules/materials.js` the three
materials used: `stone: mat.std({ roughness: 0.85 }, PROC.stone())`, `plaster: mat.std({ roughness: 0.92 },
PROC.plaster())`, `wood`, and `lamp: mat.glow([1.0, 0.58, 0.26], 14)`.

## 4. Run, test, ship

```sh
npm run dev                     # http://localhost:5190: WASD + mouse; ?mode=fly to fly
npm run build && npm run playtest
npm run package                 # release/my-world.html, opens from disk
```

`scenarios/playtest.json` is the test you keep. One that walks through the door, leans on a wall, looks at the
room and times a view:

```json
{
  "title": "my-world: whole world",
  "query": "mode=walk&ui=0&grain=0",
  "w": 960, "h": 600,
  "steps": [
    { "name": "spawn", "ms": 300, "expect": { "errors": "== 0", "onGround": "== true" } },
    { "name": "through-the-door", "walkTo": [[0, 0], [0, -3]], "expect": { "z": "~ -3 0.4" } },
    { "name": "wall-blocks", "place": { "eye": [0, 1.62, -3.5], "look": [10, 1.62, -3.5], "mode": "walk" }, "keys": ["KeyW"], "ms": 2500, "expect": { "x": "< 2.9" } },
    { "name": "inside", "viewpoint": 1, "expect": { "errors": "== 0" } },
    { "name": "frame-cost", "viewpoint": 0, "perf": { "frames": 120 }, "expect": { "frameMs": "< 16.7" } }
  ]
}
```

Read `out/playtest/report.md` and look at `sheet.png`: a passing report over a wrong picture is still wrong.
Diagnostics in the report carry a code and a fix ([diagnostics.md](diagnostics.md)).

## What people walk into

**A door taller than its wall (MG206).** An opening's `height` is where its arch *springs*, and `arch` defaults to
`'round'`, so the top of the opening is `height + width / 2`: a 1.2 m door with `height: 2.1` tops out at 2.7 m and
cuts through a 2.6 m wall. For a rectangular door say `arch: 'flat'` (the lintel is at `height`); for a round one
lower `height` to the springing. Windows are the same with a `sill`. `geom.wall` warns once per distinct case and
the playtest lists it as MG206; `geom.openingProblem(opening, wallHeight)` returns the same text.

**A dark room (MG442).** `ambientVolumes` multiplies the sky and image-based light inside a box so an interior
is not lit like a field. With `factor: 0.35` and no light of its own the room above measured a mean luma of 25 to
33 of 255 on the inside view; with the lamp (a PointLight of intensity 10), 55 to 76. A volume is half of an interior: the other half is a
lamp, a window that lets the key light in, or a higher `factor`. The playtest reports MG442 when a step's eye is
inside a volume and the screenshot's mean luma is under 40. Baked probe GI ([lighting.md](lighting.md)) is the
other route; do not declare volumes for a room it already covers.

**What a `perf` step measures.** `perf: { frames: N }` renders N frames through the same `play.step` as the game
and reports the median of three consecutive parts with their spread (`frameMsRuns`, `frameMsSpread`). Held `keys`
therefore walk and collide in walk and game mode (N / 60 seconds of walking), and move freely in fly mode, where
nothing collides. Measured in the room above with `keys: ["KeyW"]` for 120 frames from x 0 towards the east wall
(inner face x 2.85): walk mode stopped at x 2.63, fly mode ended at x 17.6. So time a view with `perf`, test a
wall with `walkTo` or `keys` + `ms` in walk mode. A spread over 25 % means another process had the machine: the
diagnostic (MG501) says so and does not blame triangles unless the view is over `plan.budget`.

## Escape hatches

Mirage is three.js with conventions; everything underneath stays reachable.

| you want | do | what you keep and lose |
|---|---|---|
| a plain three material | `new THREE.MeshStandardMaterial({ ... })` on any mesh | lit, shadowed and fogged like the rest (those patches are on three's shader chunks) and adopted by the opt-in lighting features; **not** dimmed by `ambientVolumes` and no wind or `PROC` surface. `ctx.mat.std(params)` with no hooks is the same material with those |
| your own shader on three's lighting | `ctx.mat.patch(material, { albedo, roughness, normal, vertexWorld, ... })` | everything; the hook table is at the top of `packages/core/src/materials.js` |
| a raw `ShaderMaterial` | add it to `ctx.root` | drawn, depth-tested and post-processed; fog, shadows, lights and ambient volumes only if you write them (include three's chunks and pass `fog: true` / `lights: true`). Use it for skies, screens and effects, not for walls |
| a model from a file | `createAssets(world).load(url)` from `@miragekit/core/assets` ([import.md](import.md)) | a cache with reference counts, colliders and Draco / meshopt / KTX2; three's `GLTFLoader` from `three/addons` still works, then disposal and collision are yours |
| animation | `createAnimator(root, clips, ...)` from `@miragekit/play` ([animation.md](animation.md)) | state machines, blend spaces, root motion on the fixed step; a bare `THREE.AnimationMixer` updated in `ctx.onUpdate((dt) => mixer.update(dt))` is fine for a spinning sign |
| to wait for something while building | `async build(ctx)` / `async finalize(ctx)` | modules build in order and each is awaited, so a slow fetch delays the ones after it; `anchors` and `ambientVolumes` callbacks are synchronous |
| per-frame code | `const stop = ctx.onUpdate((dt, t) => { ... })` | called every rendered frame; `stop()` unsubscribes, and the world drops every subscription on dispose ([LIFECYCLE.md](LIFECYCLE.md)) |
| the renderer, scene, camera | `world.renderer`, `world.scene`, `world.camera` | yours to read; changing the tone mapping or the render target fights the post chain ([post.md](post.md)) |

Imports come from the package roots and the subpaths each `package.json` lists under `exports`
([api.md](api.md)); a path that is not listed fails at build time, and `node scripts/check-imports.mjs` says which.

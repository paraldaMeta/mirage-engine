---
name: mirage-module
description: Write or fix one Mirage world module (modules/<name>.js) that follows the world protocol - positions only from the site plan, seeded randomness, anchors offered and consumed, NOTES.md requests, walk-grid collision and collider proxies, materials through patch() hooks or the texture layer, triangle and draw-call budgets, and a self-test. Use when asked to "build the pier / walls / terrain / trees module", "add X to the world", when a sub-agent is given one module of a Mirage world, or when a module fails, leaks, flickers or blocks the walk.
---

# One module

You own `modules/<name>.js`, `scenarios/<name>.json` and the `## <name>` section of `NOTES.md`. Nothing else.
Before writing: read `BRIEF.md` (your module brief), `plan.js`, `NOTES.md` (all of it), and
`$MIRAGE/docs/world-protocol.md`. Start from `references/module-template.js` (next to this file).

## Shape

```js
export default {
  name: 'pier',
  build(ctx) { /* geometry into ctx.root; return anything (others see it as ctx.modules.pier) */ },
  anchors: (ctx, built) => ({ lamps: [{ pos: [x, y, z], rotY }] }),      // optional: what you offer
  finalize(ctx) { /* optional: runs after every build; ctx.anchors has everyone's anchors */ },
  ambientVolumes: (ctx) => [{ min, max, factor: 0.35 }],                  // optional: interiors
};
```

`ctx`: `THREE, plan, R` (your seeded random stream), `rng(sub)`, `geom`, `mat`, `root`, `anchors`, `modules`,
`shared` (what main.js passes, e.g. `tex`; `materials(ctx)` caches `mats` there), `onUpdate(fn(t))`, `collider(mesh)`, `world` (`world.G` uniforms,
`world.camera`), `log`.

## Rules (each one has broken a world before)

1. **Positions from the plan only.** `const { deck } = ctx.plan`. A number another module could need (a height,
   an edge, a door) belongs in the plan: ask the lead (NOTES request) instead of inventing it. Stay inside the
   footprints / regions your brief says you own.
2. **`ctx.R`, never `Math.random`.** `R.range(a, b)`, `R.int`, `R.pick`, `R.chance`, `R.inDisc()`; `ctx.rng('x')`
   for an independent stream. Same seed → same world on every load and in every agent's screenshot.
3. **Batch.** `const b = new ctx.geom.MeshBatch(); b.box(mat, [w, h, d], pos, rot, bevel?); b.cylinder(mat, rTop,
   rBot, h, pos, rot, seg?); b.add(geo, mat, matrix); root.add(b.finish({ name }))` — one draw call per material;
   `finish()` returns a Group (set `userData.collide = false` on it to leave the whole batch out of collision).
   `rot` is `[x, y, z]` Euler radians, order YXZ (`geom.compose(pos, rot, scale)` makes the same matrix). Repeats of
   one shape: `geom.instances(geo, mat, matrices)`. `geom.lathe([[radius, y], …] bottom to top, segments)` (put
   radius 0 at both ends to close it), `geom.taperedTube(points, radii)`, `geom.wall({ length, height, thickness,
   openings: [{ x, width, height, sill?, arch? }] })`, `geom.smoothstep`.
4. **Materials through hooks, never `ShaderMaterial`.** `ctx.mat.std(params, hooks)` / `mat.phys(...)`, hooks
   are GLSL strings (`albedo` edits `diffuseColor`, `normal` uses `mgBump`, noise `mgFbm3(p, oct)`,
   `mgWorldPos`). Ready sets from `@mirage/core`: `PROC.plaster(base, { wear, foot })`, `PROC.stone(base, { course, block })`,
   `PROC.wood(base, axis 'x' | 'y' | 'z' = grain)`, `PROC.terracotta(base)` (`base` a GLSL `vec3(...)` string); each returns a
   plain hooks object you may extend (append to its `albedo` string). Water: `mat.phys({ color, roughness: 0.04, ior:
   1.33 }, { normal: 'normal = mgBump(normal, mgFbm2(mgWorldPos.xz * 3.0, 3) * 0.6, 0.002);' })`, `collide = false`. Shared
   materials: `import { materials } from './materials.js'; const M = materials(ctx)` (lead-owned, made once per
   world); module-only ones stay in your file. Lamps: `mat.glow(rgb, intensity)` follows day/night; a `PointLight`'s intensity follows
   `world.G.uLampGain.value` in `ctx.onUpdate`. Photo textures are optional (`ctx.shared.tex`, core README).
5. **Collision is baked from your geometry** (top-down, 0.125 m cells). Layer-0 meshes that write depth are solid.
   - `mesh.userData.collide = false` for foliage, water, glass, ropes, anything decorative you can walk through.
   - Solids must be **closed** (boxes, capped cylinders, lathes closed at the axis). An open mesh (a tube, a
     single plane, a lathe not closed at the axis) is invisible to the bake: set `collide = false` and add a
     closed proxy: `ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(...).translate(x, y, z)))`.
   - Thinner than 0.125 m and must block (railings, posts, ropes)? Add a proxy box ≥ 0.2 m thick.
   - The walker is a cylinder r 0.28 m, 1.8 m tall: it stops ~0.3 m short of anything solid, so a 1.2 m gap is
     the narrowest comfortable passage (0.6 m the narrowest at all).
   - Floors ≤ 0.4 m apart are stairs; 0.4–1.0 m can be **jumped onto** (a 0.9 m parapet does not stop anyone);
     a barrier must be > 1.0 m tall, or carry a proxy ≥ 1.1 m. Overhangs (bench seats, copings) are fine: the
     walker lands on their edge. Water must not be a floor:
     `collide = false` plus a 1.6 m proxy box (or a barrier) keeps walkers out.
6. **No coplanar faces.** Two surfaces at the same height or plane z-fight and flicker: offset 1–2 cm.
7. **Anchors**: `{ pos: [x, y, z], rotY, ...extra }` in world metres; local +Z = `(sin rotY, 0, cos rotY)` points
   out into the open air. Document each key in NOTES (what `pos` is exactly). Consume others' anchors only in
   `finalize`, and handle `ctx.anchors.key` being missing (`|| []`): the producer may have failed.
8. **Budget**: stay inside your brief's share (default ≤ 150 k triangles, ≤ 8 materials). Distant scenery
   coarse: lathe 8–12 segments, terrain ≤ 256² vertices, no detail under 2 px at its nearest view.
   `built.report.modules` (in the page: `__mirage.built.report`) lists `tris` and `ms` per module.
9. **Throwing is contained** (the loader skips a failing module) but it is a failure: the playtest fails on the
   console error. Validate your inputs and throw a message that names the plan field.

## NOTES.md (append-only)

Re-read the file, then write only in your section: what you built (numbers), plan fields you read / own,
anchors offered (table: key | pos is | extra | count), keep-clear volumes. Need something from another module or
the lead? Add `- **<addressee>** (date): <what, with numbers>` to *your* `### Requests`. Answer requests to you
in your own section and link back. Never edit another section, never delete; mark old entries "superseded".

## Self-test, then hand back

```bash
cd $MIRAGE/examples/<world>
npx vite build --outDir out/dist-<name> --emptyOutDir          # your own dist: parallel builds don't collide
node ../../packages/tools/src/playtest.mjs scenarios/<name>.json out/dist-<name> --out out/playtest-<name>
```

`scenarios/<name>.json` (mirage-playtest): `"query": "mode=walk&ui=0&grain=0&modules=<producers you need>,<name>"`,
steps that walk on your floors, hit your walls, check your proxies, one `flicker` along your part of the route,
`"shot"` views of what you built. Read `out/playtest-<name>/report.md` and look at `sheet.png` — the picture is
part of the test (wrong scale, floating parts, black materials show only there). Fix and rerun until it passes.
Hand back: the report path, triangles, anchors offered, open requests, anything you could not do.

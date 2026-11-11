// ground: the carriageway and the alley (asphalt, y = 0), the pavements and the plaza (a kerb higher), kerb
// stones, drain grates and manhole covers. All of it opts into the wet layer: this is where the puddles pool.
// Offers `steam` (the vent grates of plan.vents: the game puts a steam emitter on each).
import { materials } from './materials.js';
import { slab, decor } from './lib.js';

export default {
  name: 'ground',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), K = plan.levels.kerb;
    const [sx0, sz0, sx1, sz1] = plan.street.rect, [r0, r1] = plan.street.road, [ax0, az0, ax1, az1] = plan.alley.rect;
    const b = new geom.MeshBatch();
    // one big dark base so nothing beyond the block is a hole, a few centimetres under everything else
    slab(b, M.roofing, [-140, -140, 140, 140], -0.6, -0.05);
    // asphalt: the carriageway (beyond the walkable ends too) and the alley
    slab(b, M.asphalt, [sx0 - 8, r0, sx1 + 8, r1], -0.4, 0);
    slab(b, M.asphalt, [ax0, r1, ax1, az1 + 6], -0.4, 0);                    // through the dropped kerb at its mouth
    // pavements: north and south of the road; the south one is cut by the alley's mouth
    slab(b, M.pavement, [sx0 - 8, sz0, sx1 + 8, r0 - 0.16], -0.4, K);
    slab(b, M.pavement, [sx0 - 8, r1 + 0.16, ax0, sz1], -0.4, K);
    slab(b, M.pavement, [ax1, r1 + 0.16, sx1 + 8, sz1], -0.4, K);
    // kerb stones (1 cm proud of the paving: no coplanar tops)
    slab(b, M.kerb, [sx0 - 8, r0 - 0.16, sx1 + 8, r0], -0.4, K + 0.01, 0.02);
    slab(b, M.kerb, [sx0 - 8, r1, ax0, r1 + 0.16], -0.4, K + 0.01, 0.02);
    slab(b, M.kerb, [ax1, r1, sx1 + 8, r1 + 0.16], -0.4, K + 0.01, 0.02);
    // the plaza: dark polished slabs
    const [px0, pz0, px1, pz1] = plan.plaza.rect;
    slab(b, M.plaza, [px0, pz0, px1, pz1], -0.4, K + 0.002);
    root.add(b.finish({ name: 'ground', castShadow: false }));

    // drain grates along the kerbs and manhole covers: flat metal, flush (decor: nothing to trip on)
    const d = new geom.MeshBatch();
    for (const x of [-30, -18, -6, 6, 18, 30]) for (const z of [r0 + 0.22, r1 - 0.22]) d.box(M.grate, [0.9, 0.02, 0.36], [x + (z < 6 ? 0 : 3), 0.012, z]);
    for (const [x, z] of [[-14, 6.1], [12, 5.9], [-22, 22]]) d.cylinder(M.grate, 0.42, 0.42, 0.02, [x, 0.012, z], [0, 0, 0], 28);
    for (const [x, y, z] of plan.vents) d.box(M.grate, [1.0, 0.03, 0.7], [x, y + 0.018, z]);
    root.add(decor(d.finish({ name: 'grates', castShadow: false })));
  },
  anchors: (ctx) => ({ steam: ctx.plan.vents.map(([x, y, z]) => ({ pos: [x, y + 0.05, z], rotY: 0 })) }),
};

// ground: the carriageway and the alley (asphalt, y = 0), the pavements and the plaza (a kerb higher), kerb
// stones, drain grates and manhole covers. All of it opts into the wet layer: this is where the puddles pool.
// Offers `steam` (the vent grates of plan.vents: the game puts a steam emitter on each).
// The water channel (plan.waterStrip): an open concrete channel cut into the carriageway's south gutter, running water
// in it (core channelWater: the cross-section traced in the shader, Nizwa's falaj technique), fed by a pipe at its
// east end, gone under a grate at its west end. Its floor stays walkable (a collider flush with the road over it).
import * as THREE from 'three';
import { channelWater } from '@miragekit/core';
import { materials } from './materials.js';
import { slab, decor } from './lib.js';

// the rects of r with the hole h cut out (axis-aligned [x0, z0, x1, z1])
const cut = (r, h) => {
  if (h[0] >= r[2] || h[2] <= r[0] || h[1] >= r[3] || h[3] <= r[1]) return [r];
  return [[r[0], r[1], r[2], h[1]], [r[0], h[3], r[2], r[3]], [r[0], Math.max(r[1], h[1]), h[0], Math.min(r[3], h[3])], [h[2], Math.max(r[1], h[1]), r[2], Math.min(r[3], h[3])]]
    .filter(([x0, z0, x1, z1]) => x1 - x0 > 1e-6 && z1 - z0 > 1e-6);
};

export default {
  name: 'ground',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), K = plan.levels.kerb;
    const [sx0, sz0, sx1, sz1] = plan.street.rect, [r0, r1] = plan.street.road, [ax0, az0, ax1, az1] = plan.alley.rect;
    const b = new geom.MeshBatch();
    const ws = plan.waterStrip, [wx0, wz0, wx1, wz1] = ws.rect, edge = 0.1, hole = [wx0 - edge, wz0 - edge, wx1 + edge, r1];
    // one big dark base so nothing beyond the block is a hole, a few centimetres under everything else
    for (const r of cut([-140, -140, 140, 140], hole)) slab(b, M.roofing, r, -0.6, -0.05);
    // asphalt: the carriageway (beyond the walkable ends too) and the alley
    for (const r of cut([sx0 - 8, r0, sx1 + 8, r1], hole)) slab(b, M.asphalt, r, -0.4, 0);
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

    // ---- the water channel: a concrete edge round it (flush, 1 cm proud), its walls and bed, end walls, the inflow
    // pipe at the east end and a grate over the west end; drawn only (a collider keeps the road's floor over it)
    const c = new geom.MeshBatch(), zc = (wz0 + wz1) / 2, D = 0.35;
    // (the long edges are a lid 1 cm thick: no face of theirs lies in the channel's walls)
    slab(c, M.concrete, [wx0 - edge, wz0 - edge, wx1 + edge, wz0], 0, 0.01);
    slab(c, M.concrete, [wx0 - edge, wz1, wx1 + edge, r1], 0, 0.01);
    slab(c, M.concrete, [wx0 - edge, wz0, wx0, wz1], -0.4, 0.01);
    slab(c, M.concrete, [wx1, wz0, wx1 + edge, wz1], -0.4, 0.01);
    c.cylinder(M.grate, 0.06, 0.06, 0.16, [wx1 - 0.04, -0.13, zc], [0, 0, Math.PI / 2], 14);
    c.box(M.grate, [0.42, 0.025, wz1 - wz0], [wx0 + 0.21, -0.012, zc]);
    const ch = channelWater(ctx.world, { from: [wx1, zc], to: [wx0, zc], y: ws.y, width: wz1 - wz0, depth: D, water: 0.12, speed: 0.55, turbulence: 0.6, foam: 0.85,
      wall: [0.27, 0.265, 0.25], bed: [0.2, 0.19, 0.17] });
    // the walls and bed: damp cast concrete, mottled (not the facades' concrete: its run-off streaks and rills comb a wall
    // this low), darker toward the bed
    const wallM = ctx.world.mat.std({ color: 0x77736c, roughness: 0.7, metalness: 0 }, { albedo: 'diffuseColor.rgb *= (0.62 + 0.3 * (mgFbm2(vec2(mgWorldPos.x * 2.5 + mgWorldPos.z * 2.5, mgWorldPos.y * 7.0), 3) * 0.5 + 0.5)) * mix(0.55, 1.0, smoothstep(-0.3, 0.0, mgWorldPos.y));' });
    c.add(ch.body, wallM);
    root.add(decor(c.finish({ name: 'channel', castShadow: false, receiveShadow: false })));   // (no sun reaches these walls but at grazing: no shadow acne)
    ch.water.name = 'channel-water';
    root.add(decor(ch.water));
    const floor = new THREE.Mesh(new THREE.BoxGeometry(wx1 - wx0 + 2 * edge, 0.2, wz1 - wz0 + edge));
    floor.position.set((wx0 + wx1) / 2, -0.1, (wz0 - edge + wz1) / 2); ctx.collider(floor);

    // drain grates along the kerbs and manhole covers: flat metal, flush (decor: nothing to trip on)
    const d = new geom.MeshBatch();
    for (const x of [-30, -18, -6, 6, 18, 30]) for (const z of [r0 + 0.22, r1 - 0.22]) if (!(z > 6 && x + 3 > wx0 - 1 && x + 3 < wx1 + 1)) d.box(M.grate, [0.9, 0.02, 0.36], [x + (z < 6 ? 0 : 3), 0.012, z]);
    for (const [x, z] of [[-14, 6.1], [12, 5.9], [-22, 22]]) d.cylinder(M.grate, 0.42, 0.42, 0.02, [x, 0.012, z], [0, 0, 0], 28);
    for (const [x, y, z] of plan.vents) d.box(M.grate, [1.0, 0.03, 0.7], [x, y + 0.018, z]);
    root.add(decor(d.finish({ name: 'grates', castShadow: false })));
  },
  anchors: (ctx) => ({ steam: ctx.plan.vents.map(([x, y, z]) => ({ pos: [x, y + 0.05, z], rotY: 0 })) }),
};

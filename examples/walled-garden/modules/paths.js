// paths: paved walks (axis and cross paths on every terrace, the approach outside the gate), the round basin
// on the lower terrace, the two pools on the middle terrace, lawn panels edged with clipped hedges.
// Offers `seats` (benches facing the cross paths) and `urns` (at the path ends by the walls).
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'paths',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch();
    const inner = plan.enclosure.half - plan.enclosure.thickness / 2;
    for (const p of Object.values(plan.paths)) {
      const [[x0, z0], [x1, z1]] = p.points;
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const L = along ? Math.min(Math.abs(x1 - x0), 2 * inner) : Math.abs(z1 - z0);
      b.box(M.paving, along ? [L, 0.08, p.width] : [p.width, 0.08, L], [along ? 0 : x0, p.y + 0.01, along ? z0 : (z0 + z1) / 2]);
      // a stone kerb along both edges
      for (const s of [-1, 1]) b.box(M.ashlar, along ? [L, 0.12, 0.16] : [0.16, 0.12, L], [along ? 0 : x0 + s * (p.width / 2 + 0.08), p.y + 0.03, along ? z0 + s * (p.width / 2 + 0.08) : (z0 + z1) / 2]);
    }
    // the basin: a paved round, a stone rim, water, a spout
    const { center: [bx, by, bz], r, paving } = plan.basin;
    b.add(new THREE.CylinderGeometry(paving, paving, 0.08, 64), M.paving, geom.compose([bx, by + 0.012, bz]));
    b.add(geom.lathe([[r, 0], [r, 0.5], [r + 0.08, 0.54], [r + 0.08, 0.62], [r - 0.32, 0.62], [r - 0.34, 0.56], [r - 0.34, 0.2], [0.01, 0.2]], 72), M.ashlar, geom.compose([bx, by, bz]));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(r - 0.34, 72).rotateX(-Math.PI / 2).translate(bx, by + 0.46, bz), M.water);
    pond.receiveShadow = true; pond.userData.collide = false;
    root.add(pond);
    ctx.collider(new THREE.Mesh(new THREE.CylinderGeometry(r - 0.3, r - 0.3, 1.6, 32).translate(bx, by + 0.8, bz)));
    b.add(geom.lathe([[0.5, 0.2], [0.4, 0.5], [0.16, 0.7], [0.12, 1.3], [0.32, 1.38], [0.36, 1.46], [0.1, 1.5], [0.08, 1.8], [0.16, 1.86], [0.01, 1.9]], 32), M.ashlar, geom.compose([bx, by, bz]));
    // pools: a kerb, water just below it; the water is not ground, a proxy keeps walkers out
    for (const { rect: [x0, z0, x1, z1], y } of plan.pools) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      for (const s of [-1, 1]) {
        b.box(M.ashlar, [w + 0.5, 0.45, 0.25], [cx, y + 0.225, cz + s * (d / 2 + 0.125)], [0, 0, 0], 0.02);
        b.box(M.ashlar, [0.25, 0.45, d], [cx + s * (w / 2 + 0.125), y + 0.225, cz], [0, 0, 0], 0.02);
      }
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(cx, y + 0.34, cz), M.water);
      water.receiveShadow = true; water.userData.collide = false;
      root.add(water);
      b.box(M.ashlar, [w, 0.02, d], [cx, y + 0.01, cz]);   // the pool floor shows through the water
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d).translate(cx, y + 0.8, cz)));
    }
    // lawns: a slightly raised panel, edged by a clipped hedge (0.55 m: too high to step over)
    const hedges = new geom.MeshBatch();
    for (const { rect: [x0, z0, x1, z1], y } of plan.lawns) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      b.box(M.lawn, [w, 0.06, d], [cx, y + 0.03, cz]);
      for (const s of [-1, 1]) {
        hedges.box(M.hedge, [w, 0.55, 0.45], [cx, y + 0.275, cz + s * (d / 2 - 0.225)], [0, 0, 0], 0.12);
        hedges.box(M.hedge, [0.45, 0.55, d - 0.9], [cx + s * (w / 2 - 0.225), y + 0.275, cz], [0, 0, 0], 0.12);
      }
    }
    root.add(b.finish({ name: 'paths' }), hedges.finish({ name: 'hedges' }));
  },
  anchors: (ctx) => {
    const { plan } = ctx, seats = [], urns = [];
    for (const key of ['lowerCross', 'middleCross', 'upperCross']) {
      const p = plan.paths[key], z = p.points[0][1];
      for (const x of [-22, -12, 12, 22]) for (const s of [-1, 1]) {
        // between the path's kerb and the hedge behind, facing the path
        seats.push({ pos: [x, p.y, z + s * (p.width / 2 + 0.65)], rotY: s > 0 ? Math.PI : 0 });
      }
      for (const x of [-33.6, 33.6]) urns.push({ pos: [x, p.y, z], rotY: 0 });
    }
    return { seats, urns };
  },
};

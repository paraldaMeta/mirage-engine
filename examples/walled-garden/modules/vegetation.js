// vegetation: shade trees (a tapering trunk, a crown of lumpy leaf masses) on the lawns, cypresses along the
// walls and outside. Crowns and the open trunk tubes do not collide; each trunk gets a closed proxy.
import * as THREE from 'three';
import { fbm2 } from '@mirage/core';
import { materials } from './materials.js';

// a leaf mass: an icosphere pushed in and out by two octaves of value noise (seeded by its position)
function lump(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.1 + seed, v.z * 1.1 + v.y * 0.9 - seed, 3), f = fbm2(v.x * 4.3 - v.y * 2.1 + seed, v.z * 4.3 + seed * 0.7, 2);
    v.multiplyScalar(0.75 + 0.4 * n + 0.2 * f);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export default {
  name: 'vegetation',
  build(ctx) {
    const { geom, root, plan, R } = ctx, M = materials(ctx);
    const level = (x, z) => (plan.terraces.find((t) => z >= t.z[0] && z <= t.z[1] && Math.abs(x) < plan.enclosure.half) || { y: 0 }).y;
    const trunks = new geom.MeshBatch(), crowns = new geom.MeshBatch(), cyp = new geom.MeshBatch();
    const clumps = [0, 1, 2, 3].map((k) => lump(1, k * 7.3));   // unit clumps, scaled per use
    for (const [x, z, s] of plan.trees) {
      const y = level(x, z), lean = R.range(0, 6.28), H = 3.2 * s;
      const pts = [[x, y - 0.1, z], [x + 0.15 * Math.cos(lean), y + H * 0.45, z + 0.15 * Math.sin(lean)], [x + 0.35 * Math.cos(lean), y + H, z + 0.35 * Math.sin(lean)]];
      trunks.add(geom.taperedTube(pts, [0.32 * s, 0.22 * s, 0.14 * s], { radial: 12 }), M.bark);
      // three limbs into the crown
      for (let k = 0; k < 3; k++) {
        const a = lean + k * 2.1 + R.range(-0.3, 0.3), l = R.range(1.2, 1.8) * s;
        trunks.add(geom.taperedTube([pts[2], [pts[2][0] + Math.cos(a) * l, pts[2][1] + l * 0.9, pts[2][2] + Math.sin(a) * l]], [0.13 * s, 0.05 * s], { radial: 8 }), M.bark);
      }
      // the crown: ~90 small leaf clumps in an ellipsoid shell (denser outside), each a seeded noisy icosphere
      const c = [pts[2][0], y + H + 1.7 * s, pts[2][2]];
      for (let k = 0; k < 90; k++) {
        const [ux, uy, uz] = R.onSphere(), sh = Math.pow(R.float(), 0.35), r = R.range(0.38, 0.62) * s;
        crowns.add(clumps[k % clumps.length], M.foliage, geom.compose([c[0] + ux * 2.5 * s * sh, c[1] + uy * 1.8 * s * sh, c[2] + uz * 2.5 * s * sh], [R.range(0, 6), R.range(0, 6), 0], r));
      }
      ctx.collider(new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.34 * s, 2.4, 10).translate(x, y + 1.2, z)));
    }
    for (const [x, z, s = 1] of plan.cypresses) {
      const y = level(x, z), h = R.range(7, 9.5) * s;
      cyp.add(geom.lathe([[0.05, 0], [0.75, 0.45], [0.95 * s, h * 0.3], [0.75 * s, h * 0.65], [0.32, h * 0.92], [0.02, h]], 20), M.cypress, geom.compose([x, y, z], [0, R.range(0, 6), 0]));
    }
    const t = trunks.finish({ name: 'trunks' }), cr = crowns.finish({ name: 'crowns' });
    t.traverse((o) => { o.userData.collide = false; });
    cr.traverse((o) => { o.userData.collide = false; });
    root.add(t, cr, cyp.finish({ name: 'cypresses' }));
  },
};

// ground: the land around (flat by the walls, rising into hazy hills), the paving and the basin in the middle.
import * as THREE from 'three';
import { fbm2 } from '@mirage/core';
import { materials } from './materials.js';

export default {
  name: 'ground',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), S = plan.court.half;
    const b = new geom.MeshBatch();
    b.box(M.paving, [2 * S, 0.12, 2 * S], [0, -0.06, 0]);
    const [bx, bz, br] = plan.footprints.basin.circle;
    b.add(geom.lathe([[br - 0.06, 0], [br - 0.06, 0.48], [br, 0.52], [br, 0.6], [1.52, 0.6], [1.5, 0.55], [1.5, 0.25], [0.01, 0.25]], 64), M.ashlar, geom.compose([bx, 0, bz]));
    b.add(new THREE.CircleGeometry(1.5, 64).rotateX(-Math.PI / 2), M.water, geom.compose([bx, 0.47, bz]));
    b.add(geom.lathe([[0.3, 0.25], [0.24, 0.5], [0.12, 0.62], [0.08, 1.0], [0.18, 1.08], [0.01, 1.12]], 24), M.ashlar, geom.compose([bx, 0, bz]));   // the spout
    root.add(b.finish({ name: 'ground' }));
    const landGeo = new THREE.PlaneGeometry(2400, 2400, 220, 220).rotateX(-Math.PI / 2);
    const lp = landGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), z = lp.getZ(i), d = Math.hypot(x, z);
      lp.setY(i, -0.02 + Math.pow(geom.smoothstep(40, 700, d), 1.4) * (fbm2(x / 260, z / 260, 5) * 150 - 20) + (fbm2(x / 9, z / 9, 3) - 0.5) * 0.25 * geom.smoothstep(9, 14, d));
    }
    landGeo.computeVertexNormals();
    root.add(Object.assign(new THREE.Mesh(landGeo, M.land), { receiveShadow: true, name: 'land' }));
  },
};

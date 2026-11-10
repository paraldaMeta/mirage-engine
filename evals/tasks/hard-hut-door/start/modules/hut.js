// hut: a one-room hut at plan.hut (four walls, a flat roof), the door a gap in the south wall with a lintel above it.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'hut',
  build(ctx) {
    const { center: [cx, cz], size: [sx, sz], height: H, wall: T, door: [dw, dh] } = ctx.plan.hut;
    const mats = materials(ctx);
    const box = (name, w, h, d, x, y, z, m = mats.plaster) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.name = name; mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      ctx.root.add(mesh);
      return mesh;
    };
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    box('hut-wall-n', sx, H, T, cx, H / 2, z0 + T / 2);
    box('hut-wall-w', T, H, sz, x0 + T / 2, H / 2, cz);
    box('hut-wall-e', T, H, sz, x1 - T / 2, H / 2, cz);
    // the south wall: two leaves beside the door and a lintel over it
    const side = (sx - dw) / 2;
    box('hut-wall-s-a', side, H, T, x0 + side / 2, H / 2, z1 - T / 2);
    box('hut-wall-s-b', side, H, T, x1 - side / 2, H / 2, z1 - T / 2);
    box('hut-lintel', dw, H - dh, T, cx, (H - dh) / 2, z1 - T / 2);
    box('hut-roof', sx + 0.3, 0.15, sz + 0.3, cx, H + 0.075, cz, mats.wood);
    box('hut-table', 0.9, 0.75, 0.6, cx, 0.375, cz - 0.6, mats.wood);
  },
};

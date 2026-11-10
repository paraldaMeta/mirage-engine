// walls: four walls around the yard (plan.yard), the gate a gap in the middle of the south wall.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'walls',
  build(ctx) {
    const { half: S, wallHeight: H, thickness: T, gate } = ctx.plan.yard;
    const m = materials(ctx).plaster;
    // a wall segment from (ax, az) to (bx, bz) along one axis, T thick, H high
    const wall = (name, ax, az, bx, bz) => {
      const along = Math.abs(bx - ax) > Math.abs(bz - az);
      const len = along ? Math.abs(bx - ax) : Math.abs(bz - az);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(along ? len : T, H, along ? T : len), m);
      mesh.name = name;
      mesh.position.set((ax + bx) / 2, H / 2, (az + bz) / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      ctx.root.add(mesh);
    };
    const e = S + T / 2;   // the corners overlap by half a thickness
    // the north wall in two leaves that meet in the middle
    wall('wall-n-a', -e, -S, -1, -S);
    wall('wall-n-b', 1, -S, e, -S);
    wall('wall-e', S, -e, S, e);
    wall('wall-w', -S, -e, -S, e);
    wall('wall-s-a', -e, S, -gate / 2, S);
    wall('wall-s-b', gate / 2, S, e, S);
  },
};

// crate: one wooden crate standing on the ground at plan.points.crate.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'crate',
  build(ctx) {
    const p = ctx.plan.points.box, size = ctx.plan.crate.size;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials(ctx).wood);
    crate.name = 'crate';
    crate.position.set(p[0], p[1] + size / 2, p[2]);   // its bottom on the ground
    crate.rotation.y = 0.3;
    crate.castShadow = crate.receiveShadow = true;
    ctx.root.add(crate);
  },
};

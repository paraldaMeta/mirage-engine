// paving: a paved square inside the gate (plan.paving), flat on the ground.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'paving',
  build(ctx) {
    const [x0, z0, x1, z1] = ctx.plan.paving.rect;
    const square = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), materials(ctx).paving);
    square.name = 'square';
    square.rotation.x = -Math.PI / 2;
    square.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);   // 1 cm above the ground: coplanar faces flicker
    square.receiveShadow = true;
    ctx.root.add(square);
  },
};

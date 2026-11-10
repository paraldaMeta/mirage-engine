// ground: one solid slab over plan.bounds, its top at y = 0.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'ground',
  build(ctx) {
    const [x0, z0, x1, z1] = ctx.plan.bounds;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1, z1 - z0), materials(ctx).stone);
    slab.name = 'slab';
    slab.position.set((x0 + x1) / 2, -0.5, (z0 + z1) / 2);
    slab.receiveShadow = true;
    ctx.root.add(slab);
  },
};

// lamps: a post with a glowing globe at each plan.lamps point.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'lamps',
  build(ctx) {
    const mats = materials(ctx), H = 2.2, R = 0.16;
    const globe = new THREE.SphereGeometry(R, 320, 256);   // smooth globes
    for (const [x, z] of ctx.plan.lamps) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, H, 12), mats.iron);
      post.name = 'lamp-post'; post.position.set(x, H / 2, z); post.castShadow = true;
      const light = new THREE.Mesh(globe, mats.lamp);
      light.name = 'globe'; light.position.set(x, H + R * 0.8, z);
      ctx.root.add(post, light);
    }
  },
};

// rail: an iron railing along plan.paths.rail (posts every metre, a top bar and a middle bar). The bars and posts
// are thinner than a walk-grid cell, so a collision proxy (ctx.collider) stands in for the whole railing.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'rail',
  build(ctx) {
    const { points, height } = ctx.plan.paths.rail;
    const [[ax, az], [bx, bz]] = points;
    const len = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, rotY = -Math.atan2(bz - az, bx - ax);
    const m = materials(ctx).iron;
    const group = new THREE.Group();
    group.position.set(cx, 0, cz); group.rotation.y = rotY;
    for (const [name, y, h] of [['rail-top', height, 0.05], ['rail-mid', height / 2, 0.04]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.05), m);
      bar.name = name; bar.position.y = y; bar.castShadow = true;
      group.add(bar);
    }
    for (let s = 0; s <= len + 1e-6; s += 1) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, height, 0.06), m);
      post.name = 'post'; post.position.set(s - len / 2, height / 2, 0); post.castShadow = true;
      group.add(post);
    }
    ctx.root.add(group);
    // the collision proxy: one box 0.2 m thick along the whole railing
    const proxy = ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.2, height, len)));
    proxy.position.set(cx, height / 2, cz); proxy.rotation.y = rotY;
  },
};

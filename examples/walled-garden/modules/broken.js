// A deliberately broken module (?broken=1): it adds a red box, registers an update, then throws. The loader
// must log it, drop the box and the update, and build every other module as usual.
import * as THREE from 'three';
export default {
  name: 'broken',
  build(ctx) {
    ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3).translate(0, 1.5, 0), new THREE.MeshBasicMaterial({ color: 0xff0000 })));
    ctx.onUpdate(() => { throw new Error('this update must never run'); });
    throw new Error('deliberate failure (?broken=1)');
  },
};

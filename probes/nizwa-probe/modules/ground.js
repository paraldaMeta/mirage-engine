// ground: what Nizwa's main.js lays under a module shown without its terrain (the `fallbackGround`): a disc in the
// library's granite (400 m there; 3000 m here: Mirage's sky is dark below the horizon, Nizwa's haze hides the rim). Mirage-side code; the material comes from Nizwa's library through the bridge.
import * as THREE from 'three';

export default {
  name: 'ground',
  build(ctx) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(3000, 96).rotateX(-Math.PI / 2), ctx.shared.nz.M.granite);
    g.receiveShadow = true; g.name = 'fallbackGround';
    g.userData.mgLampCast = false;   // light2: a ground plane casts no lamp shadow
    ctx.root.add(g);
  },
};

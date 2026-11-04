import * as THREE from 'three';
import { along, pathLength } from '@mirage/world';

export default {
  name: 'ground',
  build({ plan, mat, root, geom, rng }) {
    const earth = mat.std({ color: 0x696349, roughness: 0.98 }, {
      albedo: 'diffuseColor.rgb *= 0.66 + 0.52 * mgFbm3(mgWorldPos * 1.2, 3) + 0.18 * mgFbm3(mgWorldPos * 20.0, 2);',
    });
    const soil = new THREE.Mesh(new THREE.BoxGeometry(130, 1, 130).translate(0, -0.5, 0), earth);
    soil.name = 'forest-floor'; soil.receiveShadow = true;
    root.add(soil);

    const trail = plan.paths.trail, length = pathLength(trail), segments = Math.ceil(length / 0.65);
    const positions = [], indices = [], R = rng('path-edges');
    for (let i = 0; i <= segments; i++) {
      const p = along(trail, length * i / segments);
      for (const side of [-1, 1]) {
        const offset = side * trail.width * 0.5 * R.range(0.91, 1.07);
        positions.push(p.x - p.dz * offset, 0.014, p.z + p.dx * offset);
      }
      if (i < segments) { const k = i * 2; indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    ribbon.setIndex(indices);
    ribbon.computeVertexNormals();
    const dirt = mat.std({ color: 0x9c815c, roughness: 1 }, {
      albedo: 'diffuseColor.rgb *= 0.70 + 0.38 * mgFbm3(mgWorldPos * 5.0, 3) + 0.17 * mgFbm3(mgWorldPos * 70.0, 2);',
    });
    const surface = new THREE.Mesh(ribbon, dirt);
    surface.name = 'footpath'; surface.userData.collide = false; surface.receiveShadow = true;
    root.add(surface);

    const flints = [], stones = rng('trail-gravel');
    for (let i = 0; i < 320; i++) {
      const p = along(trail, stones.range(0, length)), offset = stones.range(-1, 1) * trail.width * 0.58;
      const size = stones.range(0.018, 0.065);
      flints.push(geom.compose([p.x - p.dz * offset, 0.02, p.z + p.dx * offset],
        [0, stones.range(0, 6.28), 0], [size, size * 0.33, size * 0.70]));
    }
    const chips = geom.instances(new THREE.IcosahedronGeometry(1, 0), mat.std({ color: 0xae9978, roughness: 0.95 }), flints, { castShadow: false });
    chips.name = 'trail-gravel'; chips.userData.collide = false;
    root.add(chips);
  },
};

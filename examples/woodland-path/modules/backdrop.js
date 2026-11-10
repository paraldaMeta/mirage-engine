import * as THREE from 'three';

// The wood beyond the walkable meadow: low, untextured crowns and trunks in rings from 26 m out to 170 m, so the
// horizon is a tree line in haze instead of the edge of the ground. Nothing here collides or casts a shadow.
export default {
  name: 'backdrop',
  build({ plan, mat, root, geom, rng, quality }) {
    const R = rng('far-wood'), [x0, z0, x1, z1] = plan.bounds;
    const keepOut = (x, z) => x > x0 - 9 && x < x1 + 9 && z > z0 - 9 && z < z1 + 9;
    const crowns = [], trunks = [], count = quality === 'low' ? 420 : 760;
    for (let tries = 0; crowns.length < count && tries < count * 8; tries++) {
      // more trees near the meadow, thinning out toward the haze
      const r = 26 + 144 * Math.pow(R.next(), 1.7), a = R.range(0, Math.PI * 2);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (keepOut(x, z)) continue;
      const h = R.range(7.5, 12.5), w = R.range(2.6, 4.4);
      crowns.push(geom.compose([x, h - w * 0.55, z], [0, R.range(0, 6.28), 0], [w, w * R.range(1.05, 1.35), w]));
      trunks.push(geom.compose([x, (h - w) * 0.5, z], [0, 0, 0], [0.32, h - w, 0.32]));
    }
    const leaves = mat.std({ color: 0x51693a, roughness: 0.92 }, {
      albedo: 'diffuseColor.rgb *= 0.62 + 0.55 * mgFbm3(mgWorldPos * 0.35, 3);',
    });
    const bark = mat.std({ color: 0x4a3c2e, roughness: 0.95 });
    const far = geom.instances(new THREE.IcosahedronGeometry(1, 1), leaves, crowns, { castShadow: false });
    far.name = 'far-crowns'; far.userData.collide = false;
    const stems = geom.instances(new THREE.CylinderGeometry(0.7, 1, 1, 6), bark, trunks, { castShadow: false });
    stems.name = 'far-trunks'; stems.userData.collide = false;
    root.add(far, stems);
    return { farTrees: crowns.length };
  },
};

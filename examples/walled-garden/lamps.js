// Mirage original code.
// ?lights=N: N small coloured lamps scattered over a box, for the clustered-light demo and its measurements
// (docs/lighting.md). ?lshadows=K gives the first K a tile of the shadow atlas; ?stock=1 leaves them to three's
// own light loop instead (the comparison path).
import * as THREE from 'three';

export function addLamps(world, { n, min, max, first = [], shadows = 0, stock = false, range = 6, intensity = 14 }) {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lamps = [];
  for (let i = 0; i < n; i++) {
    const p = first[i] || [min[0] + rnd() * (max[0] - min[0]), min[1] + rnd() * (max[1] - min[1]), min[2] + rnd() * (max[2] - min[2])];
    const l = new THREE.PointLight(new THREE.Color().setHSL(rnd(), 0.75, 0.6), intensity, range, 2);
    l.position.set(p[0], p[1], p[2]);
    world.scene.add(l);
    if (!stock) world.lighting.addLight(l, { shadow: i < shadows });
    lamps.push(l);
  }
  return lamps;
}

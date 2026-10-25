// props: consumes every module's anchors in finalize — lanterns on `lamps` (wall brackets or hanging),
// lamp posts on `posts`, stone benches on `seats`, terracotta urns on `urns`. Lit lanterns get a warm point
// light that follows the day–night lamp level.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'props',
  build() {},
  finalize(ctx) {
    const { geom, root, world, anchors: A, R } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch();
    const lantern = (x, y, z) => {   // y: the ring at the lantern's waist
      b.add(geom.lathe([[0.001, 0.4], [0.15, 0.33], [0.18, 0.29], [0.001, 0.29]], 8), M.iron, geom.compose([x, y - 0.15, z]));
      b.add(geom.lathe([[0.001, 0], [0.11, 0.05], [0.14, 0.15], [0.11, 0.27], [0.001, 0.29]], 8), M.glass, geom.compose([x, y - 0.15, z]));
      b.add(new THREE.TorusGeometry(0.13, 0.012, 4, 8).rotateX(Math.PI / 2), M.iron, geom.compose([x, y, z]));
      const l = new THREE.PointLight(0xff9a50, 0, 11, 2);
      l.position.set(x, y, z);
      root.add(l);
      ctx.onUpdate(() => { l.intensity = 2.6 * world.G.uLampGain.value; });
    };
    for (const a of A.lamps || []) {
      const [x, y, z] = a.pos, ox = Math.sin(a.rotY), oz = Math.cos(a.rotY);
      if (a.kind === 'hanging') {
        b.add(new THREE.CylinderGeometry(0.008, 0.008, a.drop || 0.6, 4), M.iron, geom.compose([x, y - (a.drop || 0.6) / 2, z]));
        lantern(x, y - (a.drop || 0.6) - 0.25, z);
      } else {   // a wall bracket: plate on the wall, an arm out, the lantern hanging from it
        b.box(M.iron, [0.16, 0.3, 0.03], [x, y + 0.3, z], [0, a.rotY, 0]);
        b.box(M.iron, [0.03, 0.03, 0.45], [x + ox * 0.22, y + 0.42, z + oz * 0.22], [0, a.rotY, 0]);
        lantern(x + ox * 0.42, y, z + oz * 0.42);
      }
    }
    for (const { pos: [x, y, z] } of A.posts || []) {   // a stone post with a lantern on top
      b.box(M.ashlar, [0.42, 0.25, 0.42], [x, y + 0.125, z]);
      b.add(new THREE.CylinderGeometry(0.09, 0.12, 1.7, 10), M.iron, geom.compose([x, y + 1.1, z]));
      lantern(x, y + 2.18, z);
    }
    for (const { pos: [x, y, z], rotY } of A.seats || []) {   // slab on two blocks
      b.box(M.ashlar, [1.7, 0.1, 0.48], [x, y + 0.43, z], [0, rotY, 0], 0.02);
      for (const s of [-1, 1]) b.box(M.ashlar, [0.2, 0.38, 0.4], [x + Math.cos(rotY) * s * 0.6, y + 0.19, z - Math.sin(rotY) * s * 0.6], [0, rotY, 0]);
    }
    for (const { pos: [x, y, z] } of A.urns || []) {   // an urn on a square plinth (seeded proportions)
      const h = R.range(0.75, 0.95), w = R.range(0.3, 0.36);
      b.box(M.ashlar, [0.62, 0.5, 0.62], [x, y + 0.25, z], [0, 0, 0], 0.02);
      b.add(geom.lathe([[0.001, 0], [0.16, 0.02], [0.14, 0.1], [w, h * 0.45], [w * 0.95, h * 0.7], [w * 0.6, h * 0.9], [w * 0.85, h], [w * 0.7, h * 1.03], [w * 0.5, h * 0.98]], 28), M.clay, geom.compose([x, y + 0.5, z], [0, R.range(0, 6), 0]));
    }
    root.add(b.finish({ name: 'props' }));
  },
};

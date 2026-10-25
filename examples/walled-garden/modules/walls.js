// walls: the plastered perimeter wall (stepped up with the terraces, buttresses, stone plinth and coping) and
// the gate: a taller segment with a round-arched opening, two piers with caps.
// Offers `lamps` (wall lanterns either side of the gate, inside: { pos on the wall face, rotY out of it }).
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'walls',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx);
    const { half: A, height: HW, thickness: T } = plan.enclosure, G = plan.gate;
    const b = new geom.MeshBatch();
    // one wall run from a to b (along x or z) standing on level y with height h
    const run = (x0, z0, x1, z1, y, h) => {
      const len = Math.hypot(x1 - x0, z1 - z0), rot = Math.atan2(-(z1 - z0), x1 - x0);
      const m = geom.compose([(x0 + x1) / 2, 0, (z0 + z1) / 2], [0, rot, 0]);
      b.add(geom.wall({ length: len, height: y + h, thickness: T }), M.plaster, m);
      b.add(new THREE.BoxGeometry(len + 0.12, 0.16, T + 0.14), M.ashlar, m.clone().multiply(geom.compose([0, y + h + 0.08, 0])));
      b.add(new THREE.BoxGeometry(len, 0.5, T + 0.08), M.ashlar, m.clone().multiply(geom.compose([0, y + 0.25, 0])));   // plinth at the inner level
      for (let s = 4.5; s < len - 1; s += 9) b.add(new THREE.BoxGeometry(0.7, y + h - 0.4, T + 0.5), M.plaster, m.clone().multiply(geom.compose([s - len / 2, (y + h - 0.4) / 2, 0])));   // buttresses
    };
    // east and west walls step up with the terraces; north wall at the top level; south wall either side of the gate
    for (const t of plan.terraces) for (const x of [-A, A]) run(x, Math.max(t.z[0], -A), x, Math.min(t.z[1], A), t.y, HW);
    run(-A - T / 2, -A, A + T / 2, -A, plan.levels[2], HW);
    run(-A - T / 2, A, G.x - G.segment / 2, A, 0, HW);
    run(G.x + G.segment / 2, A, A + T / 2, A, 0, HW);
    // the gate segment and its piers
    const g = geom.compose([G.x, 0, G.z]);
    b.add(geom.wall({ length: G.segment, height: G.height, thickness: G.thickness, openings: [{ x: 0, width: G.width, height: G.spring, arch: 'round' }] }), M.plaster, g);
    b.add(new THREE.BoxGeometry(G.segment + 0.2, 0.2, G.thickness + 0.2), M.ashlar, g.clone().multiply(geom.compose([0, G.height + 0.1, 0])));
    for (const s of [-1, 1]) {
      const p = g.clone().multiply(geom.compose([s * (G.segment / 2 + 0.5), 0, 0]));
      b.add(new THREE.BoxGeometry(1.0, G.height + 0.6, 1.1), M.ashlar, p.clone().multiply(geom.compose([0, (G.height + 0.6) / 2, 0])));
      b.add(new THREE.BoxGeometry(1.25, 0.25, 1.35), M.ashlar, p.clone().multiply(geom.compose([0, G.height + 0.72, 0])));
      b.add(geom.lathe([[0.4, 0], [0.35, 0.2], [0.12, 0.5], [0.16, 0.62], [0.01, 0.75]], 16), M.ashlar, p.clone().multiply(geom.compose([0, G.height + 0.85, 0])));
      // the arch's jambs: a stone frame
      b.add(new THREE.BoxGeometry(0.3, G.spring, G.thickness + 0.1), M.ashlar, g.clone().multiply(geom.compose([s * (G.width / 2 + 0.15), G.spring / 2, 0])));
    }
    root.add(b.finish({ name: 'walls' }));
  },
  anchors: (ctx) => {
    const G = ctx.plan.gate;
    return { lamps: [-1, 1].map((s) => ({ pos: [G.x + s * (G.width / 2 + 0.9), 3.0, G.z - G.thickness / 2], rotY: Math.PI, kind: 'wall' })) };
  },
};

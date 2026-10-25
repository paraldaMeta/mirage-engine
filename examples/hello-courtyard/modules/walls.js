// walls: the four plastered walls (a pointed gate south, a round-arched arcade west, windows north and east),
// coping, a stone plinth broken by the doors, the gate's frame and open leaves, the bench and the pergola.
// Offers `lamps` anchors: { pos (the lantern's ring), rotY } on the pergola posts, an arcade pier and the gate wall.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'walls',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx);
    const { half: S, wallHeight: HW, thickness: T } = plan.court;
    const b = new geom.MeshBatch();
    const walls = [
      { pos: [0, 0, S], rot: 0, open: [{ x: 0, width: 2.4, height: 2.3, arch: 'pointed', rise: 0.62 }] },
      { pos: [0, 0, -S], rot: Math.PI, open: [-4, 0, 4].map((x) => ({ x, width: 1.1, height: 2.6, sill: 1.3, arch: 'round' })) },
      { pos: [S, 0, 0], rot: Math.PI / 2, open: [-3, 3].map((x) => ({ x, width: 1.1, height: 2.6, sill: 1.3, arch: 'round' })) },
      { pos: [-S, 0, 0], rot: -Math.PI / 2, open: [-4.2, -1.4, 1.4, 4.2].map((x) => ({ x, width: 1.9, height: 1.9, arch: 'round' })) },   // the low sun comes through
    ];
    for (const w of walls) {
      const m = geom.compose(w.pos, [0, w.rot, 0]);
      b.add(geom.wall({ length: 2 * S + T, height: HW, thickness: T, openings: w.open }), M.plaster, m);
      b.add(new THREE.BoxGeometry(2 * S + T + 0.12, 0.18, T + 0.14), M.ashlar, m.clone().multiply(geom.compose([0, HW + 0.09, 0])));   // coping
      let x0 = -S - T / 2 - 0.03;   // a stone plinth, broken by the doors
      for (const o of [...w.open.filter((o) => !o.sill), { x: S + T / 2 + 0.03, width: 0 }]) {
        const x1 = o.x - o.width / 2;
        b.add(new THREE.BoxGeometry(x1 - x0, 0.55, T + 0.08), M.ashlar, m.clone().multiply(geom.compose([(x0 + x1) / 2, 0.275, 0])));
        x0 = o.x + o.width / 2;
      }
      for (const o of w.open) if (o.sill) b.add(new THREE.BoxGeometry(o.width + 0.2, 0.08, T + 0.1), M.ashlar, m.clone().multiply(geom.compose([o.x, o.sill, 0])));
    }
    // the gate: a stone frame, and two timber leaves standing open
    const gate = geom.compose(plan.points.gate);
    for (const s of [-1, 1]) {
      b.add(new THREE.BoxGeometry(0.25, 2.6, T + 0.08), M.ashlar, gate.clone().multiply(geom.compose([s * 1.32, 1.3, 0])));
      b.add(new THREE.BoxGeometry(1.15, 2.5, 0.08), M.planks, geom.compose([s * 1.2, 1.25, S - T / 2], [0, -s * 1.2, 0]).multiply(geom.compose([-s * 0.58, 0, 0])));   // hinged, swung in
    }
    // a bench along the north wall under a timber pergola
    b.box(M.ashlar, [6, 0.45, 0.5], [0, 0.225, -S + 0.55], [0, 0, 0], 0.04);
    for (const x of [-3.2, -1.07, 1.07, 3.2]) b.box(M.planks, [0.18, 2.9, 0.18], [x, 1.45, -S + 2.3]);                  // posts
    for (const z of [-S + 0.5, -S + 2.3]) b.box(M.planks, [7.2, 0.2, 0.16], [0, 2.95, z]);                              // beams
    for (let i = 0; i < 17; i++) b.box(M.planks, [0.08, 0.14, 2.5], [-3.4 + i * 0.425, 3.12, -S + 1.45]);              // rafters: striped shade
    root.add(b.finish({ name: 'walls' }));
  },
  // facing convention: rotY turns local +Z (out of the surface into the open air) to (sin rotY, 0, cos rotY)
  anchors: (ctx) => {
    const S = ctx.plan.court.half;
    return { lamps: [
      { pos: [-1.07, 2.35, -S + 2.54], rotY: 0 }, { pos: [1.07, 2.35, -S + 2.54], rotY: 0 },
      { pos: [-S + 0.42, 2.45, 0], rotY: Math.PI / 2 }, { pos: [3.3, 2.45, S - 0.42], rotY: Math.PI },
    ] };
  },
};

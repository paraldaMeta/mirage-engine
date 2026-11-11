// blocks: the buildings round the street and the plaza (solid boxes under one facade material per style: the
// windows and the lit rooms are in the shader), their roofs (parapets, plant rooms, tanks, masts) and the skyline
// beyond the walkable block. Offers `signs` (one per entry of plan.blocks[i].signs, on the face it names),
// `beacons` (the red lamp on top of each mast) and `holos` (the board on the tallest skyline tower).
import { materials } from './materials.js';
import * as THREE from 'three';
import { slab, lamp } from './lib.js';

// a point on a block's face and the way it looks: local +Z out of the wall
const FACE = { s: (r, a) => [[a, r[3]], 0], n: (r, a) => [[a, r[1]], Math.PI], e: (r, a) => [[r[2], a], Math.PI / 2], w: (r, a) => [[r[0], a], -Math.PI / 2] };

export default {
  name: 'blocks',
  build(ctx) {
    const { geom, root, plan, R } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch(), roofs = new geom.MeshBatch(), beacons = [];
    for (const k of plan.blocks) {
      const [x0, z0, x1, z1] = k.rect, y0 = k.y || 0;
      slab(b, M.facade[k.style], k.rect, y0, k.h);
      if (!y0) {   // the ground storey: a dark plinth, a string course at the first floor, on some a line of light under it
        slab(b, M.concrete, [x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05], 0, 0.75);
        slab(b, M.darkMetal, [x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1], 4.16, 4.38);
        const tint = { s1: 'pink', c: 'cyan', e: 'violet', sw: 'amber', s3: 'cyan', w: 'pink' }[k.name];
        if (tint) {
          for (const [a2, c2, d2, e2] of [[x0 - 0.12, z0 - 0.13, x1 + 0.12, z0 - 0.1], [x0 - 0.12, z1 + 0.1, x1 + 0.12, z1 + 0.13], [x0 - 0.13, z0 - 0.1, x0 - 0.1, z1 + 0.1], [x1 + 0.1, z0 - 0.1, x1 + 0.13, z1 + 0.1]]) slab(roofs, M.neon[tint], [a2, c2, d2, e2], 4.08, 4.13);
          // the line lights the wall and the pavement under it: a pool lamp every 5 m, only on faces the player can stand by
          const col = new THREE.Color().setRGB(...M.NEON[tint]), B = plan.bounds, inside = (x, z) => x > B[0] - 1 && x < B[2] + 1 && z > B[1] - 1 && z < B[3] + 1;
          for (const [ax, az, bx, bz, nx, nz] of [[x0, z0, x1, z0, 0, -1], [x0, z1, x1, z1, 0, 1], [x0, z0, x0, z1, -1, 0], [x1, z0, x1, z1, 1, 0]]) {
            const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 6));
            for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = ax + (bx - ax) * t + nx * 0.5, z = az + (bz - az) * t + nz * 0.5; if (inside(x, z)) lamp(ctx, { pos: [x, 3.8, z], color: col, intensity: 3.4, range: 6, normal: [nx, 0, nz], back: 0.5 }); }
          }
        }
      }
      // the roof: a dark deck, a parapet, plant rooms, a tank or a mast
      slab(roofs, M.roofing, [x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3], k.h, k.h + 0.06);
      for (const [a, c, d, e] of [[x0, z0, x1, z0 + 0.3], [x0, z1 - 0.3, x1, z1], [x0, z0 + 0.3, x0 + 0.3, z1 - 0.3], [x1 - 0.3, z0 + 0.3, x1, z1 - 0.3]]) slab(roofs, M.concrete, [a, c, d, e], k.h, k.h + 0.9);
      const w = x1 - x0, d = z1 - z0, Q = R.fork ? R.fork(k.name) : R;
      const n = w * d > 150 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const bw = Q.range(2, Math.min(5, w * 0.4)), bd = Q.range(2, Math.min(5, d * 0.4)), bh = Q.range(1.4, 3.2);
        const cx = Q.range(x0 + 1 + bw / 2, x1 - 1 - bw / 2), cz = Q.range(z0 + 1 + bd / 2, z1 - 1 - bd / 2);
        roofs.box(Q.chance(0.5) ? M.sheet : M.concrete, [bw, bh, bd], [cx, k.h + 0.06 + bh / 2, cz]);
      }
      if (k.h > 18) {   // a mast with a beacon
        const mx = Q.range(x0 + 2, x1 - 2), mz = Q.range(z0 + 2, z1 - 2), mh = Q.range(5, 10);
        roofs.cylinder(M.darkMetal, 0.06, 0.12, mh, [mx, k.h + mh / 2, mz], [0, 0, 0], 8);
        for (const t of [0.35, 0.6, 0.85]) roofs.box(M.darkMetal, [1.2 * (1 - t) + 0.3, 0.05, 0.05], [mx, k.h + mh * t, mz], [0, Q.range(0, 3), 0]);
        beacons.push({ pos: [mx, k.h + mh + 0.12, mz], rotY: 0 });
      } else roofs.cylinder(M.sheet, 1.1, 1.1, 2.2, [Q.range(x0 + 2, x1 - 2), k.h + 1.6, Q.range(z0 + 2, z1 - 2)], [0, 0, 0], 16);
    }
    root.add(b.finish({ name: 'blocks' }));
    const roofMesh = roofs.finish({ name: 'roofs' });
    roofMesh.userData.collide = false;   // nobody gets up there: keep the roof clutter out of the walk grid's slabs
    root.add(roofMesh);

    // the skyline: taller towers out of reach, dimmer (they sit in the haze), a crown strip on some
    const sky = new geom.MeshBatch(), styles = ['glass', 'panel', 'concrete'];
    plan.skyline.forEach((t, i) => {
      slab(sky, M.facade[styles[i % 3]], t.rect, 0, t.h);
      const [x0, z0, x1, z1] = t.rect;
      if (i % 2 === 0) for (const [a, c, d, e] of [[x0, z0 - 0.1, x1, z0], [x0, z1, x1, z1 + 0.1], [x0 - 0.1, z0, x0, z1], [x1, z0, x1 + 0.1, z1]]) slab(sky, M.neon[['cyan', 'pink', 'violet', 'amber'][(i / 2) % 4 | 0]], [a, c, d, e], t.h - 1.2, t.h - 0.9);
      if (t.h > 60) beacons.push({ pos: [(x0 + x1) / 2, t.h + 0.3, (z0 + z1) / 2], rotY: 0 });
    });
    const far = sky.finish({ name: 'skyline', castShadow: false });
    far.userData.collide = false;
    root.add(far);
    return { beacons };
  },
  anchors: (ctx, built) => {
    const signs = [];
    for (const k of ctx.plan.blocks) for (const s of k.signs || []) {
      const [[x, z], rotY] = FACE[s.face](k.rect, s.at);
      signs.push({ pos: [x, s.y, z], rotY, w: s.w, h: s.h, text: s.text, color: s.color, kind: s.kind || 'board', vertical: !!s.vertical, second: s.second });
    }
    const [bx, by, bz] = ctx.plan.points.billboard;
    return { signs, beacons: built.beacons, holos: [{ pos: [bx, by, bz], rotY: 0, kind: 'board', w: 13, h: 7.5 }] };
  },
};

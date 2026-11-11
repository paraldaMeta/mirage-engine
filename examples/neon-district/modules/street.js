// street: what stands on the open ground. Lamp posts (each a shadowed lamp), concrete barriers and planters (the
// cover of plan.cover), parked cars, shop shutters and awnings along the pavements, wall plant (AC units, conduits,
// pipes), vending machines, the alley's clutter (dumpsters, crates, a fence, cables with bulbs) and the barricades
// that close both ends of the street.
// Offers `signs` (the barricades' boards), `sparks` (two broken fittings) and `cars` (for the game's alarm lights).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor } from './lib.js';

export default {
  name: 'street',
  build(ctx) {
    const { geom, root, plan, R } = ctx, M = materials(ctx), K = plan.levels.kerb;
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch();   // fx: decor (no collision): tubes, strips, cables
    const proxy = (size, pos) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size)); m.position.set(...pos); ctx.collider(m); };

    // ---- lamp posts: a post on the pavement, an arm over the road, a light panel under the head
    for (const [x, z, side] of plan.lamps) {
      const y = K, H = 5.4;
      b.cylinder(M.darkMetal, 0.07, 0.11, H, [x, y + H / 2, z], [0, 0, 0], 10);
      b.box(M.darkMetal, [0.36, 0.5, 0.36], [x, y + 0.25, z], [0, 0, 0], 0.04);
      b.box(M.darkMetal, [0.09, 0.09, 1.7], [x, y + H - 0.05, z + side * 0.8]);
      b.box(M.blackMetal, [0.34, 0.1, 0.8], [x, y + H - 0.08, z + side * 1.45], [0, 0, 0], 0.03);
      fx.box(M.neon.warm, [0.24, 0.02, 0.62], [x, y + H - 0.14, z + side * 1.45]);
      proxy([0.3, H, 0.3], [x, y + H / 2, z]);
      lamp(ctx, { pos: [x, y + H - 0.5, z + side * 1.45], color: 0xffc58a, intensity: 10, range: 14, shadow: true, vol: true });
    }

    // ---- cover: jersey barriers on the road, planters on the plaza
    for (const [x, z, rot, len] of plan.cover) {
      const onPlaza = z < 2, y = onPlaza ? K : (z > 3.6 && z < 8.4 ? 0 : K);
      if (onPlaza) {
        b.box(M.concrete, [len, 0.95, 1.0], [x, y + 0.475, z], [0, rot, 0], 0.05);
        b.box(M.blackMetal, [len - 0.24, 0.06, 0.76], [x, y + 0.96, z], [0, rot, 0]);
        const c = Math.cos(rot), s = Math.sin(rot);
        for (const k of [-1, 1]) fx.box(M.neon.cyan, [len - 0.2, 0.025, 0.02], [x + k * s * 0.515, y + 0.12, z + k * c * 0.515], [0, rot, 0]);
      } else {
        b.box(M.concrete, [len, 0.62, 0.62], [x, y + 0.31, z], [0, rot, 0], 0.05);
        b.box(M.concrete, [len, 0.36, 0.3], [x, y + 0.78, z], [0, rot, 0], 0.04);
        b.box(M.yellow, [len * 0.5, 0.1, 0.32], [x, y + 0.9, z], [0, rot, 0]);
      }
    }

    // ---- parked cars: low, boxy, a light bar front and back
    const cars = [];
    for (const [x, z, rot, paint] of plan.cars) {
      const m = geom.compose([x, 0, z], [0, rot, 0]), at = (p) => new THREE.Vector3(...p).applyMatrix4(m).toArray();
      const add = (mat, size, p, bev = 0) => b.add(bev ? new geom.RoundedBoxGeometry(size[0], size[1], size[2], 2, bev) : new THREE.BoxGeometry(...size), mat, m.clone().multiply(geom.compose(p)));
      // the body and the cabin are side profiles pushed across the car's width
      const profile = (pts, width) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(px, py))), { depth: width, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -width / 2);
      b.add(profile([[-2.26, 0.3], [2.18, 0.3], [2.3, 0.5], [2.12, 0.7], [0.95, 0.87], [-2.0, 0.93], [-2.3, 0.8]], 1.82), M.car[paint], m);
      b.add(profile([[0.8, 0.86], [0.12, 1.3], [-1.2, 1.36], [-1.92, 0.94]], 1.56), M.blackMetal, m);          // the cabin: dark glass all round
      add(M.car[paint], [1.2, 0.03, 1.5], [-0.55, 1.39, 0]);
      add(M.blackMetal, [4.3, 0.16, 1.7], [0, 0.26, 0]);
      for (const sx of [-1.45, 1.45]) for (const sz of [-0.86, 0.86]) b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18).rotateX(Math.PI / 2), M.rubber, m.clone().multiply(geom.compose([sx, 0.34, sz])));
      const f = (mat, size, p) => fx.add(new THREE.BoxGeometry(...size), mat, m.clone().multiply(geom.compose(p)));
      f(M.neon.white, [0.03, 0.05, 1.5], [2.3, 0.6, 0]);
      f(M.neon.red, [0.03, 0.06, 1.6], [-2.35, 0.84, 0]);
      cars.push({ pos: at([0, 1.6, 0]), rotY: rot });
      lamp(ctx, { pos: at([-2.7, 0.6, 0]), color: 0xff2010, intensity: 1.4, range: 4.5 });
    }

    // ---- shop fronts along both pavements: shutters, awnings, steps, wall plant
    const S = plan.street.rect, shops = [];
    for (let x = -32; x < 33; x += 4.2) {
      if (x > -23 && x < -9.5) continue;                                   // the bar's own front
      if (x > 5 && x < 30) continue;                                       // the plaza opens here
      shops.push([x, S[1], 1]);
    }
    for (let x = -32; x < 33; x += 4.2) { if (x > -25.5 && x < -19) continue; shops.push([x, S[3], -1]); }
    for (const [x, z, out] of shops) {   // out: +1 the wall faces south, -1 north
      const kind = R.int(0, 3);
      if (kind < 2) {   // a roller shutter in a frame, sometimes an awning
        b.box(kind ? M.sheet : M.sheetRed, [3.0, 2.9, 0.1], [x + 2.1, K + 1.45, z + out * 0.05]);
        b.box(M.darkMetal, [3.3, 0.22, 0.26], [x + 2.1, K + 3.0, z + out * 0.13]);
        if (R.chance(0.6)) fx.add(new THREE.BoxGeometry(3.4, 0.05, 1.3).rotateX(-out * 0.32), M.plastic, geom.compose([x + 2.1, K + 2.9, z + out * 0.7]));
      } else {          // a recessed glass door with a light strip over it
        b.box(M.blackMetal, [1.5, 2.5, 0.08], [x + 2.1, K + 1.25, z + out * 0.04]);
        fx.box(M.neon[R.pick(['cyan', 'amber', 'pink', 'white'])], [1.5, 0.05, 0.05], [x + 2.1, K + 2.62, z + out * 0.1]);
      }
      // wall plant above: an AC unit, a conduit
      if (R.chance(0.7)) { const ax = x + R.range(0.4, 3.6), ay = K + R.range(3.4, 4.1); fx.box(M.sheet, [0.9, 0.6, 0.42], [ax, ay, z + out * 0.21], [0, 0, 0], 0.03); fx.cylinder(M.blackMetal, 0.2, 0.2, 0.03, [ax, ay, z + out * 0.43], [Math.PI / 2, 0, 0], 16); }
      fx.cylinder(M.darkMetal, 0.045, 0.045, 9, [x + R.range(0.1, 0.5), K + 4.5, z + out * 0.07], [0, 0, 0], 8);
    }

    // ---- vending machines: a lit front, a little light of their own
    for (const [x, y, z, rot, tint] of [[-25.2, K, 2.5, 0, 'cyan'], [3.4, K, 9.5, Math.PI, 'pink'], [29.3, K, -2.2, -Math.PI / 2, 'amber'], [-23.55, 0, 16.5, Math.PI / 2, 'green']]) {
      const m = geom.compose([x, y, z], [0, rot, 0]);
      b.add(new geom.RoundedBoxGeometry(1.0, 1.95, 0.8, 2, 0.04), M.blackMetal, m.clone().multiply(geom.compose([0, 0.975, 0])));
      fx.add(new THREE.BoxGeometry(0.84, 1.3, 0.02), M.neonSoft[tint], m.clone().multiply(geom.compose([0, 1.15, 0.405])));
      fx.add(new THREE.BoxGeometry(0.6, 0.18, 0.02), M.blackMetal, m.clone().multiply(geom.compose([0, 0.28, 0.405])));
      const p = new THREE.Vector3(0, 1.2, 0.9).applyMatrix4(m);
      lamp(ctx, { pos: p.toArray(), color: new THREE.Color().setRGB(...M.NEON[tint]), intensity: 2.6, range: 6 });
    }

    // ---- bollards along the plaza's street edge (a proxy each: they are thinner than a walk-grid cell)
    for (let x = 7.5; x < 29.6; x += 2.75) {
      if (Math.abs(x - 18) < 2.2) continue;   // the way in
      b.cylinder(M.darkMetal, 0.11, 0.13, 0.9, [x, K + 0.45, 1.6], [0, 0, 0], 12);
      fx.cylinder(M.neonSoft.amber, 0.115, 0.115, 0.05, [x, K + 0.82, 1.6], [0, 0, 0], 12);
      proxy([0.3, 0.9, 0.3], [x, K + 0.45, 1.6]);
    }

    // ---- the alley: dumpsters, crates, a fence, pipes on the walls, a string of bulbs overhead
    const [ax0, az0, ax1] = plan.alley.rect, fence = plan.alley.fence;
    b.add(new geom.RoundedBoxGeometry(1.9, 1.25, 1.05, 2, 0.05), M.sheetRed, geom.compose([ax1 - 0.6, 0.625, 25.4], [0, Math.PI / 2, 0]));
    b.box(M.blackMetal, [1.1, 0.06, 1.95], [ax1 - 0.6, 1.28, 25.4]);
    b.add(new geom.RoundedBoxGeometry(1.9, 1.25, 1.05, 2, 0.05), M.sheet, geom.compose([ax0 + 0.6, 0.625, 17.6], [0, Math.PI / 2, 0]));
    b.box(M.blackMetal, [1.1, 0.06, 1.95], [ax0 + 0.6, 1.28, 17.6]);
    for (const [x, y, z, s, r] of [[ax0 + 0.55, 0, 21.4, 0.9, 0.2], [ax0 + 0.6, 0.9, 21.3, 0.7, -0.3], [ax1 - 0.5, 0, 12.2, 0.8, 0.1], [ax0 + 0.5, 0, 12.6, 0.7, 0.5], [ax1 - 0.55, 0, 19.4, 1.0, -0.1]]) b.box(M.crate, [s, s, s], [x, y + s / 2, z], [0, r, 0], 0.03);
    b.box(M.sheet, [ax1 - ax0, 3.2, 0.2], [(ax0 + ax1) / 2, 1.6, fence + 0.1]);                 // the gate that closes it
    fx.box(M.yellow, [ax1 - ax0, 0.14, 0.03], [(ax0 + ax1) / 2, 1.2, fence - 0.02]);
    for (const [x, o] of [[ax0, 1], [ax1, -1]]) {
      for (const zz of [13, 19.5, 27]) fx.cylinder(M.darkMetal, 0.07, 0.07, 12, [x + o * 0.1, 6, zz + o], [0, 0, 0], 8);
      fx.add(new THREE.CylinderGeometry(0.05, 0.05, plan.alley.rect[3] - az0, 8).rotateX(Math.PI / 2), M.sheet, geom.compose([x + o * 0.09, 2.7, (az0 + plan.alley.rect[3]) / 2]));
    }
    // bulbs on sagging cables across the alley and across the street by the bar
    const bulb = new THREE.SphereGeometry(0.055, 8, 6);
    const string = (a, c, sag, n, tint) => {
      const pts = [];
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t]); }
      fx.add(geom.taperedTube(pts, pts.map(() => 0.012), { radial: 5 }), M.blackMetal);
      for (let i = 1; i < n; i++) fx.add(bulb, M.neon[tint[i % tint.length]], geom.compose(pts[i].map((v, k) => (k === 1 ? v - 0.07 : v))));
      return pts[Math.floor(n / 2)];
    };
    for (const [z, tint] of [[14, ['warm']], [20.5, ['warm', 'pink']], [26.5, ['warm']]]) {
      const mid = string([ax0, 4.4, z], [ax1, 4.2, z + 1.2], 0.45, 9, tint);
      lamp(ctx, { pos: [mid[0], mid[1] - 0.3, mid[2]], color: 0xffb070, intensity: 3.2, range: 7 });
    }
    for (const x of [-19.5, -12.5]) string([x, 5.2, S[1]], [x + 1.5, 5.0, S[3]], 0.7, 16, ['amber', 'pink', 'cyan']);

    // ---- both ends of the street: a wall of sheet and barriers
    for (const [x, o] of [[S[0] + 1.0, 1], [S[2] - 1.0, -1]]) {
      b.box(M.sheet, [0.25, 3.4, S[3] - S[1]], [x - o * 0.4, 1.7, (S[1] + S[3]) / 2]);
      for (const z of [4.1, 6.0, 7.9]) { b.box(M.concrete, [0.6, 0.62, 1.7], [x + o * 0.5, 0.31, z], [0, 0, 0], 0.05); b.box(M.yellow, [0.3, 0.3, 1.7], [x + o * 0.5, 0.77, z], [0, 0, 0], 0.03); }
    }
    root.add(b.finish({ name: 'street' }));
    root.add(decor(fx.finish({ name: 'street-decor', castShadow: false })));
    return { cars };
  },
  anchors: (ctx, built) => {
    const S = ctx.plan.street.rect, mid = (S[1] + S[3]) / 2;
    return {
      signs: [
        { pos: [S[0] + 0.74, 2.2, mid], rotY: Math.PI / 2, w: 3.6, h: 1.1, text: '封鎖 CLOSED', color: 'red', kind: 'board' },
        { pos: [S[2] - 0.74, 2.2, mid], rotY: -Math.PI / 2, w: 3.6, h: 1.1, text: '封鎖 CLOSED', color: 'red', kind: 'board' },
      ],
      sparks: [{ pos: [-20.25, 4.3, 10.6], rotY: 0 }, { pos: [29.7, 5.2, -10.5], rotY: 0 }],
      cars: built.cars,
    };
  },
};

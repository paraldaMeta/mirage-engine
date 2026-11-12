// street: what stands on the open ground. Lamp posts (each a shadowed lamp), concrete barriers and planters (the
// cover of plan.cover), parked cars, shop shutters and awnings along the pavements, wall plant (AC units, conduits,
// pipes), vending machines, the alley's clutter (dumpsters, crates, a fence, cables with bulbs) and the barricades
// that close both ends of the street.
// Offers `signs` (the barricades' boards), `sparks` (two broken fittings) and `cars` (for the game's alarm lights).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor } from './lib.js';
import { shopFronts } from './shopfronts.js';
import { propKit, recorder, track, trackLamps, breakablesLamp } from './props-kit.js';
import { streetLamp, bulbString } from './props-lights.js';
import { jersey, bollard, crate } from './props-street.js';
import { parkedCars } from './cars.js';

export default {
  name: 'street',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), K = plan.levels.kerb;
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch();   // fx: decor (no collision): tubes, strips, cables
    const P = propKit(ctx), pb = new geom.MeshBatch();   // pb: the close-up props (props-*.js), decor
    const proxy = (size, pos) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size)); m.position.set(...pos); ctx.collider(m); return m; };
    const rec = recorder(ctx);   // destructibles (game/destruct.js): lamp lenses, bulbs, crates, barriers, pipes

    // ---- lamp posts: a post on the pavement, an arm over the road, a light panel under the head
    for (const [i, [x, z, side]] of plan.lamps.entries()) {
      const y = K, H = 5.4;
      const sl = streetLamp(P, pb, geom, [x, y, z], H - 0.1, [0, side], 1.45);
      proxy([0.3, H, 0.3], [x, y + H / 2, z]); proxy([0.36, 0.5, 0.36], [x, y + 0.25, z]);   // the old post and base
      const lamps = trackLamps(ctx, () => lamp(ctx, { pos: [x, y + H - 0.5, z + side * 1.45], color: 0xffe4ce, intensity: 18, range: 16, shadow: true, vol: true }));
      rec.add({ id: 'streetlamp-' + i, fam: 'streetlamp', hack: 'lamp' + i, box: sl.head, parts: [[pb, sl.lens, 'glow']], lamps });
    }

    // ---- cover: jersey barriers on the road, planters on the plaza
    for (const [x, z, rot, len] of plan.cover) {
      const onPlaza = z < 2, y = onPlaza ? K : (z > 3.6 && z < 8.4 ? 0 : K);
      if (onPlaza) {
        b.box(M.concrete, [len, 0.95, 1.0], [x, y + 0.475, z], [0, rot, 0], 0.05);
        b.box(M.blackMetal, [len - 0.24, 0.06, 0.76], [x, y + 0.96, z], [0, rot, 0]);
        const c = Math.cos(rot), s = Math.sin(rot);
        for (const k of [-1, 1]) {
          const r = track(fx, () => fx.box(M.neon.cyan, [len - 0.2, 0.025, 0.02], [x + k * s * 0.515, y + 0.12, z + k * c * 0.515], [0, rot, 0]));
          rec.add({ id: `planter-neon-${x}-${k}`, fam: 'neon', color: 'cyan', box: { center: [x + k * s * 0.515, y + 0.12, z + k * c * 0.515], half: [(len - 0.2) / 2, 0.02, 0.02], yaw: rot }, parts: [[fx, r, 'draw']] });
        }
      } else {
        jersey(P, pb, geom, geom.compose([x, y, z], [0, rot, 0]), len);   // drawn; the old blocks collide
        const px = [];
        for (const [sz, py] of [[[len, 0.62, 0.62], 0.31], [[len, 0.36, 0.3], 0.78]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(...sz)); c.applyMatrix4(geom.compose([x, y + py, z], [0, rot, 0])); ctx.collider(c); px.push(c); }
        rec.add({ id: `jersey-${x}-${z}`, fam: 'jersey', box: { center: [x, y + 0.47, z], half: [len / 2, 0.47, 0.31], yaw: rot }, proxies: px, keepProxies: true });
      }
    }

    // ---- parked cars (cars.js): three designs, the scene's material showcase; each keeps the old car's volume
    const carBox = (size, matrix) => { const c = new THREE.Mesh(new THREE.BoxGeometry(...size)); c.applyMatrix4(matrix); ctx.collider(c); return c; };
    const cars = parkedCars(ctx, P, pb, plan.cars, carBox);

    // ---- shop fronts along both pavements (shopfronts.js): open shops, shutters, doors, awnings, wall plant
    const S = plan.street.rect, shops = [];
    for (let x = -32; x < 33; x += 4.2) {
      if (x + 3.6 > -22 && x + 0.6 < -10) continue;                          // the bar's own front
      if (x > 5 && x < 30) continue;                                       // the plaza opens here
      shops.push([x, S[1], 1]);
    }
    for (let x = -32; x < 33; x += 4.2) { if (x > -25.5 && x < -19) continue; shops.push([x, S[3], -1]); }
    shopFronts(ctx, fx, shops);

    // (the vending machines are vending.js's)

    // ---- bollards along the plaza's street edge (a proxy each: they are thinner than a walk-grid cell)
    for (let x = 7.5; x < 29.6; x += 2.75) {
      if (Math.abs(x - 18) < 2.2) continue;   // the way in
      bollard(P, pb, geom, geom.compose([x, K, 1.6]));
      proxy([0.3, 0.9, 0.3], [x, K + 0.45, 1.6]);
    }

    // ---- the alley: dumpsters, crates, a fence, pipes on the walls, a string of bulbs overhead
    const [ax0, az0, ax1] = plan.alley.rect, fence = plan.alley.fence;
    b.add(new geom.RoundedBoxGeometry(1.9, 1.25, 1.05, 2, 0.05), M.sheetRed, geom.compose([ax1 - 0.6, 0.625, 25.4], [0, Math.PI / 2, 0]));
    b.box(M.blackMetal, [1.1, 0.06, 1.95], [ax1 - 0.6, 1.28, 25.4]);
    b.add(new geom.RoundedBoxGeometry(1.9, 1.25, 1.05, 2, 0.05), M.sheet, geom.compose([ax0 + 0.6, 0.625, 17.6], [0, Math.PI / 2, 0]));
    b.box(M.blackMetal, [1.1, 0.06, 1.95], [ax0 + 0.6, 1.28, 17.6]);
    for (const [i, [x, y, z, s, r]] of [[ax0 + 0.55, 0, 21.4, 0.9, 0.2], [ax0 + 0.6, 0.9, 21.3, 0.7, -0.3], [ax1 - 0.5, 0, 12.2, 0.8, 0.1], [ax0 + 0.5, 0, 12.6, 0.7, 0.5], [ax1 - 0.55, 0, 19.4, 1.0, -0.1]].entries()) {
      const cr = track(pb, () => crate(P, pb, geom, geom.compose([x, y, z], [0, r, 0], [1 / 1.2, 1, 1]), s, [0.3, 0.2, 0.1], Math.round(z) & 1));   // slatted (decor); the old cube collides
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s)); c.applyMatrix4(geom.compose([x, y + s / 2, z], [0, r, 0])); ctx.collider(c);
      rec.add({ id: 'crate-alley-' + i, fam: 'crate', box: { center: [x, y + s / 2, z], half: [s / 2, s / 2, s / 2], yaw: r }, parts: [[pb, cr, 'draw']], proxies: [c], rests: i === 1 ? 'crate-alley-0' : null });
    }
    // the dumpsters' lids, wheels, grab bars and stencils (their bodies are the solid boxes above)
    for (const [x, z, col] of [[ax1 - 0.6, 25.4, [0.42, 0.1, 0.08]], [ax0 + 0.6, 17.6, [0.32, 0.34, 0.38]]]) {
      for (const s of [-1, 1]) P.put(pb, new geom.RoundedBoxGeometry(1.08, 0.05, 0.96, 2, 0.02), P.mats.paint, geom.compose([x, 1.31 + (s > 0 ? 0.0 : 0.05), z + s * 0.48], [s > 0 ? 0.05 : -0.18, 0, 0]), [0.02, 0.02, 0.022]);
      for (const sx of [-0.4, 0.4]) for (const sz of [-0.8, 0.8]) { P.put(pb, new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12).rotateZ(Math.PI / 2), P.mats.paint, geom.compose([x + sx, 0.06, z + sz]), [0.02, 0.02, 0.02]); P.put(pb, new THREE.BoxGeometry(0.06, 0.06, 0.06), P.mats.metal, geom.compose([x + sx, 0.1, z + sz]), [0.2, 0.2, 0.22]); }
      for (const sx of [-1, 1]) P.put(pb, geom.taperedTube([[x + sx * 0.56, 1.0, z - 0.6], [x + sx * 0.62, 1.0, z - 0.55], [x + sx * 0.62, 1.0, z + 0.55], [x + sx * 0.56, 1.0, z + 0.6]], [0.018, 0.018, 0.018, 0.018], { radial: 6 }), P.mats.metal, null, [0.3, 0.3, 0.32]);
      for (const sx of [-1, 1]) P.put(pb, new THREE.PlaneGeometry(1.0, 0.5).rotateY(sx * Math.PI / 2), P.mats.paint, geom.compose([x + sx * 0.53, 0.75, z]), col.map((c) => c * 2.2), P.R['stencil' + (sx > 0 ? 1 : 0)]);
    }
    b.box(M.sheet, [ax1 - ax0, 3.2, 0.2], [(ax0 + ax1) / 2, 1.6, fence + 0.1]);                 // the gate that closes it
    fx.box(M.yellow, [ax1 - ax0, 0.14, 0.03], [(ax0 + ax1) / 2, 1.2, fence - 0.02]);
    for (const [x, o] of [[ax0, 1], [ax1, -1]]) {
      for (const zz of [13, 19.5, x === ax0 ? 24.2 : 27]) {
        fx.cylinder(M.darkMetal, 0.07, 0.07, 12, [x + o * 0.1, 6, zz + o], [0, 0, 0], 8);
        rec.add({ id: `steampipe-${x}-${zz}`, fam: 'steampipe', box: { center: [x + o * 0.1, 3.5, zz + o], half: [0.08, 3.5, 0.08] }, out: [o, 0, 0] });   // its reachable lower half
      }
      fx.add(new THREE.CylinderGeometry(0.05, 0.05, plan.alley.rect[3] - az0, 8).rotateX(Math.PI / 2), M.sheet, geom.compose([x + o * 0.09, 2.7, (az0 + plan.alley.rect[3]) / 2]));
    }
    // bulbs on sagging cables across the alley and across the street by the bar
    // (each bulb a breakable of its own; a string's bulbs pop one after another, its lamp goes with the last: destruct.js)
    let strings = 0;
    const string = (a, c, sag, n, tint) => {
      const pts = [], group = 'bulbs-' + strings++;
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t]); }
      const bs = bulbString(P, pb, geom, a, c, sag, n, tint.map((t) => M.NEON[t]));
      bs.bulbs.forEach((bu, i) => rec.add({ id: `${group}-${i}`, fam: 'bulb', group, chainIndex: i, lampGroup: group, sphere: { center: bu.pos, radius: 0.05 }, parts: [[pb, bu.lit, 'draw']] }));
      return [pts[Math.floor(n / 2)], group];
    };
    for (const [z, tint] of [[14, ['warm']], [20.5, ['warm', 'pink']], [26.5, ['warm']]]) {
      const [mid, group] = string([ax0, z > 25 ? 6.1 : 4.4, z], [ax1, 4.2, z + 1.2], 0.45, 9, tint);
      breakablesLamp(ctx, group, trackLamps(ctx, () => lamp(ctx, { pos: [mid[0], mid[1] - 0.3, mid[2]], color: 0xffb070, intensity: 3.2, range: 7 })));
    }
    for (const x of [-19.5, -8.4]) string([x, 5.2, S[1]], [x + 1.5, 5.0, S[3]], 0.7, 16, ['amber', 'pink', 'cyan']);

    // ---- both ends of the street: a wall of sheet and barriers
    for (const [x, o] of [[S[0] + 1.0, 1], [S[2] - 1.0, -1]]) {
      b.box(M.sheet, [0.25, 3.4, S[3] - S[1]], [x - o * 0.4, 1.7, (S[1] + S[3]) / 2]);
      for (const z of [4.1, 6.0, 7.9]) { b.box(M.concrete, [0.6, 0.62, 1.7], [x + o * 0.5, 0.31, z], [0, 0, 0], 0.05); b.box(M.yellow, [0.3, 0.3, 1.7], [x + o * 0.5, 0.77, z], [0, 0, 0], 0.03); }
    }
    root.add(b.finish({ name: 'street' }));
    root.add(decor(rec.finished(fx, fx.finish({ name: 'street-decor', castShadow: false }))), decor(rec.finished(pb, pb.finish({ name: 'street-props', castShadow: false }))));
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

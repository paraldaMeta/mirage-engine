// clutter: what a lived-in street leaves about. Rubbish bags, cardboard boxes and pallets against the walls, traffic
// cones, bins, two scooters, a noodle cart with a striped canopy, a signal gantry over the plaza's entrance, cables
// across the street at three heights, washing on lines over the alley, a closed underpass entrance, newspaper boxes,
// a hydrant. Small soft things are decor (walked through); anything a person would walk round is solid.
// Offers `signs` (the cart, the underpass) and `steam` (the cart's pot).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor } from './lib.js';

export default {
  name: 'clutter',
  build(ctx) {
    const { geom, root, plan, mat, R } = ctx, M = materials(ctx), K = plan.levels.kerb, S = plan.street.rect;
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch();
    const std = (r, g, bl, o = {}) => mat.std({ color: new THREE.Color(r, g, bl), roughness: 0.7, ...o });
    const bag = std(0.012, 0.012, 0.014, { roughness: 0.25 }), card = std(0.34, 0.25, 0.15, { roughness: 0.9 }), cone = std(0.75, 0.2, 0.03), pallet = std(0.25, 0.18, 0.1, { roughness: 0.85 });
    const cloth = [std(0.5, 0.48, 0.42), std(0.2, 0.3, 0.45), std(0.5, 0.15, 0.15), std(0.75, 0.7, 0.6), std(0.15, 0.35, 0.3)];
    for (const c of cloth) c.side = THREE.DoubleSide;
    const proxy = (size, pos, rot = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size)); m.position.set(...pos); m.rotation.y = rot; ctx.collider(m); };

    // ---- heaps against the walls: bags, boxes, a pallet. [x, z, ground y, how many]
    const heaps = [[-23.4, 13.8, 0, 6], [-20.6, 22.6, 0, 7], [-23.3, 28.2, 0, 5], [-30.5, 2.5, K, 5], [-7.6, 2.45, K, 6], [4.2, 2.5, K, 4], [-18.2, 9.5, K, 5], [9.2, 9.55, K, 6], [30.2, 9.5, K, 5],
      [6.5, -15, K, 6], [29.4, -6.5, K, 5], [20.5, -19.4, K, 4], [7.2, -19.2, K, 5], [6.9, -28.6, plan.levels.roof, 3]];
    const bagGeo = new THREE.SphereGeometry(0.3, 10, 7);
    for (const [hx, hz, y, n] of heaps) {
      const Q = R.fork('heap' + hx + hz);
      for (let i = 0; i < n; i++) {
        const x = hx + Q.range(-0.7, 0.7), z = hz + Q.range(-0.35, 0.35), r = Q.next();
        if (r < 0.5) fx.add(bagGeo, bag, geom.compose([x, y + 0.2, z], [Q.range(-0.3, 0.3), Q.range(0, 3), 0], [Q.range(0.8, 1.2), Q.range(0.6, 0.85), Q.range(0.8, 1.1)]));
        else if (r < 0.85) { const s = Q.range(0.3, 0.55); fx.box(card, [s, s * Q.range(0.6, 1), s * Q.range(0.7, 1.1)], [x, y + s * 0.4, z], [0, Q.range(0, 1.5), 0]); }
        else { fx.box(pallet, [1.1, 0.12, 0.9], [x, y + 0.06, z], [0, Q.range(0, 0.4), 0]); for (const k of [-0.4, 0, 0.4]) fx.box(pallet, [1.1, 0.03, 0.12], [x, y + 0.135, z + k], [0, 0, 0]); }
      }
      for (let i = 0; i < 4; i++) fx.box(card, [Q.range(0.15, 0.3), 0.004, Q.range(0.1, 0.22)], [hx + Q.range(-1.6, 1.6), y + 0.004, hz + Q.range(-0.9, 0.9)], [0, Q.range(0, 3), 0]);   // litter
    }
    // ---- cones round the barriers and the closed ends
    const coneGeo = geom.lathe([[0.16, 0], [0.16, 0.03], [0.1, 0.05], [0.025, 0.5], [0.02, 0.52]], 12);
    for (const [x, z] of [[-13.4, 7.6], [-10.6, 6.2], [-0.2, 4.2], [8.2, 7.9], [11, 6.8], [-31.5, 5], [-31.4, 7], [31.4, 5.1], [31.5, 6.9], [17, 2.8], [19.2, 2.9]]) {
      fx.add(coneGeo, cone, geom.compose([x, z > 3.6 && z < 8.4 ? 0 : K, z]));
      fx.cylinder(M.neonSoft.white, 0.075, 0.09, 0.07, [x, (z > 3.6 && z < 8.4 ? 0 : K) + 0.3, z], [0, 0, 0], 10);
    }
    // ---- bins, newspaper boxes, a hydrant
    for (const [x, z] of [[-26.8, 2.5], [-3.5, 9.5], [13, 2.45], [24.5, 9.5], [8.4, -1.2], [28.4, -18.6]]) { b.cylinder(M.darkMetal, 0.26, 0.22, 0.85, [x, K + 0.425, z], [0, 0, 0], 12); fx.cylinder(M.neonSoft.green, 0.265, 0.265, 0.03, [x, K + 0.7, z], [0, 0, 0], 12); }
    for (const [x, z, t] of [[-8.6, 9.45, 'red'], [-7.9, 9.45, 'cyan'], [20.6, 2.5, 'amber']]) { b.box(t === 'red' ? M.sheetRed : M.sheet, [0.5, 1.0, 0.42], [x, K + 0.5, z], [0, 0, 0], 0.03); fx.box(M.neonSoft[t], [0.36, 0.3, 0.02], [x, K + 0.72, z + (z > 6 ? -0.215 : 0.215)]); }
    b.cylinder(M.sheetRed, 0.11, 0.13, 0.62, [-2.2, K + 0.31, 2.6], [0, 0, 0], 10); b.cylinder(M.sheetRed, 0.07, 0.07, 0.36, [-2.2, K + 0.42, 2.6], [Math.PI / 2, 0, 0], 8);
    proxy([0.3, 0.7, 0.3], [-2.2, K + 0.35, 2.6]);

    // ---- two scooters on the pavement
    for (const [x, z, rot, paint] of [[-9.2, 2.75, 0.3, M.car.teal], [26.2, 9.25, -2.6, M.sheetRed]]) {
      const m = geom.compose([x, K, z], [0, rot, 0]), add = (bt, geo, material, p, r = [0, 0, 0]) => bt.add(geo, material, m.clone().multiply(geom.compose(p, r)));
      for (const wx of [-0.62, 0.62]) add(b, new THREE.CylinderGeometry(0.24, 0.24, 0.11, 16).rotateX(Math.PI / 2), M.rubber, [wx, 0.24, 0]);
      add(b, new geom.RoundedBoxGeometry(0.9, 0.16, 0.34, 2, 0.05), paint, [-0.05, 0.36, 0]);
      add(b, new geom.RoundedBoxGeometry(0.5, 0.3, 0.3, 2, 0.08), paint, [-0.4, 0.62, 0]);
      add(b, new geom.RoundedBoxGeometry(0.56, 0.09, 0.28, 2, 0.04), M.rubber, [-0.36, 0.82, 0]);
      add(b, new geom.RoundedBoxGeometry(0.16, 0.7, 0.32, 2, 0.05), paint, [0.52, 0.66, 0], [0, 0, -0.25]);
      add(b, new THREE.CylinderGeometry(0.018, 0.018, 0.56, 6).rotateX(Math.PI / 2), M.blackMetal, [0.43, 1.04, 0]);
      add(fx, new THREE.BoxGeometry(0.03, 0.08, 0.12), M.neon.white, [0.63, 0.86, 0]); add(fx, new THREE.BoxGeometry(0.03, 0.05, 0.14), M.neon.red, [-0.67, 0.66, 0]);
      proxy([1.5, 1.0, 0.45], [x, K + 0.5, z], rot);
    }

    // ---- the noodle cart on the plaza's edge: a box on wheels, a counter, a striped canopy, a pot that steams
    const cart = [24.2, K, -0.4], cm = geom.compose(cart, [0, 0.12, 0]), cadd = (bt, geo, material, p, r = [0, 0, 0]) => bt.add(geo, material, cm.clone().multiply(geom.compose(p, r)));
    cadd(b, new geom.RoundedBoxGeometry(2.0, 0.8, 0.95, 2, 0.03), M.sheet, [0, 0.62, 0]);
    cadd(b, new THREE.BoxGeometry(2.2, 0.05, 1.15), M.wood, [0, 1.05, 0]);
    for (const wx of [-0.75, 0.75]) cadd(b, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14).rotateX(Math.PI / 2), M.rubber, [wx, 0.22, 0.5]);
    for (const [px, pz] of [[-1.0, -0.5], [1.0, -0.5], [-1.0, 0.5], [1.0, 0.5]]) cadd(b, new THREE.BoxGeometry(0.05, 1.25, 0.05), M.darkMetal, [px, 1.7, pz]);
    for (let i = 0; i < 8; i++) cadd(fx, new THREE.BoxGeometry(0.29, 0.04, 1.5), i % 2 ? M.sheetRed : cloth[3], [-1.02 + i * 0.29, 2.36 - Math.abs(i - 3.5) * 0.012, 0], [0.12, 0, 0]);
    cadd(b, new THREE.CylinderGeometry(0.24, 0.2, 0.3, 16), M.steel, [0.45, 1.23, -0.1]); cadd(b, new THREE.CylinderGeometry(0.17, 0.15, 0.22, 14), M.blackMetal, [-0.35, 1.19, 0.05]);
    for (const [px, t] of [[-0.9, 'amber'], [-0.55, 'red'], [0.9, 'amber']]) cadd(fx, new THREE.SphereGeometry(0.09, 10, 8), M.neonSoft[t], [px, 2.12, 0.55]);
    const cp = new THREE.Vector3(0, 2.0, 0.3).applyMatrix4(cm);
    lamp(ctx, { pos: cp.toArray(), color: 0xffb060, intensity: 5, range: 7 });
    proxy([2.2, 1.1, 1.15], [cart[0], K + 0.55, cart[2]], 0.12);

    // ---- a signal gantry over the way into the plaza, and a lamp cluster hanging over the crossing
    b.cylinder(M.darkMetal, 0.09, 0.12, 5.6, [15.3, K + 2.8, 2.5], [0, 0, 0], 10); b.box(M.darkMetal, [5.6, 0.12, 0.12], [18, K + 5.5, 2.5]);
    proxy([0.3, 5, 0.3], [15.3, K + 2.5, 2.5]);
    for (const [x, t] of [[17, ['red', 'amber', 'green']], [19.4, ['green', 'amber', 'red']]]) {
      b.box(M.blackMetal, [0.34, 0.95, 0.26], [x, K + 4.95, 2.5], [0, 0, 0], 0.03);
      t.forEach((c, i) => fx.cylinder(i === 0 ? M.neon[c] : M.neonSoft[c], 0.09, 0.09, 0.03, [x, K + 5.25 - i * 0.3, 2.64], [Math.PI / 2, 0, 0], 12));
    }
    lamp(ctx, { pos: [18, K + 4.6, 3.2], color: 0xff3020, intensity: 3, range: 7 });

    // ---- cables across the street at three heights: thin, sagging, a junction ball on some
    const cable = (a, c, sag, r = 0.014) => { const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t]); } fx.add(geom.taperedTube(pts, pts.map(() => r), { radial: 4 }), M.blackMetal); return pts[5]; };
    for (let x = -31; x < 33; x += R.range(3.5, 6.5)) { const y = R.pick([5.4, 6.8, 8.6, 11.5]), mid = cable([x, y, S[1]], [x + R.range(-2.5, 2.5), y + R.range(-0.6, 0.6), S[3]], R.range(0.4, 1.1), R.pick([0.012, 0.02, 0.03])); if (R.chance(0.3)) fx.add(new THREE.SphereGeometry(0.09, 8, 6), M.sheet, geom.compose(mid)); }
    // ---- washing over the alley: two lines, cloth that hangs a little differently each
    const [ax0, , ax1] = plan.alley.rect;
    for (const [z, y] of [[18.6, 5.6], [23.6, 6.6], [28.4, 6.9]]) {
      cable([ax0, y, z], [ax1, y - 0.2, z + 0.5], 0.25, 0.008);
      for (let x = ax0 + 0.5; x < ax1 - 0.4; x += R.range(0.55, 0.85)) {
        const w = R.range(0.35, 0.6), h = R.range(0.45, 0.85), t = (x - ax0) / (ax1 - ax0), sag = 0.25 * 4 * t * (1 - t);
        fx.add(new THREE.PlaneGeometry(w, h, 2, 3), R.pick(cloth), geom.compose([x, y - sag - h / 2 - 0.02 - 0.2 * t, z + 0.5 * t], [R.range(-0.12, 0.12), R.range(-0.2, 0.2), 0]));
      }
    }
    // ---- a closed underpass entrance on the south pavement: a hooded stair head behind a shutter
    const ux = 29.4, uz = 9.2;
    b.box(M.concrete, [3.2, 1.1, 0.25], [ux, K + 0.55, uz - 0.7]); b.box(M.concrete, [0.25, 1.1, 1.5], [ux - 1.5, K + 0.55, uz]); b.box(M.concrete, [0.25, 1.1, 1.5], [ux + 1.5, K + 0.55, uz]);
    b.box(M.sheet, [2.8, 1.0, 0.08], [ux, K + 0.5, uz + 0.7]); b.box(M.blackMetal, [3.4, 0.12, 1.9], [ux, K + 2.45, uz], [0.06, 0, 0]);
    for (const s of [-1.55, 1.55]) b.box(M.darkMetal, [0.08, 1.4, 0.08], [ux + s, K + 1.75, uz - 0.6]);
    root.add(b.finish({ name: 'clutter' }));
    root.add(decor(fx.finish({ name: 'clutter-decor', castShadow: false })));
    return { cart: [cp.x, K + 1.45, cp.z - 0.35] };
  },
  anchors: (ctx, built) => ({
    signs: [
      { pos: [24.3, ctx.plan.levels.kerb + 2.62, 0.36], rotY: 0.12, w: 1.9, h: 0.42, text: '牛肉麵 NOODLES', color: 'amber', kind: 'board', bare: true },
      { pos: [29.4, ctx.plan.levels.kerb + 2.0, 8.3], rotY: Math.PI, w: 2.6, h: 0.6, text: '地下道 UNDERPASS', color: 'cyan', kind: 'board' },
    ],
    steam: [{ pos: built.cart, rotY: 0 }],
  }),
};

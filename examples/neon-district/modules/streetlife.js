// streetlife: the machines and the trade of the street (plan.streetlife). The street life is robots (the cyber kit's buildMachines):
// service androids in soft liveries standing under the awnings in twos and threes, talking (heads turn, a hand
// gestures), at the noodle cart, the stall and the vending machines, some under umbrellas with lit rims; androids and
// a wheeled parcel courier on a loop along the far pavement east of the fight; a vendor on a rail in the stall and one
// on a pedestal behind the cart; a sweeper on the north kerb; a queue totem by the clinic; units that broke down
// against a wall. A converted shipping container under the plaza's gallery is a yakitori stall (real corrugated
// walls, the side flap propped up as an awning, a lit inside, lanterns, a pot that steams). Two rows of vending
// machines with lit faces: in the alley by the spawn and by the plaza. The machines are decor (walked and shot
// through, out of the walk grid); the container and the vending machines are solid.
// Offers `steam` (the stall's pot).
import * as THREE from 'three';
import { materials, surfaceLib } from './materials.js';
import { lamp, decor, signTexture } from './lib.js';
import { detail, thin, corrugated, textAtlas, atlasQuad } from './kit.js';
import { buildMachines, propKit, recorder, track, trackLamps, breakablesLamp, paperLantern, spiritBottle, jar, pot, skewers, bowls, chopsticks, riceCooker, gasBottle, extinguisher } from '@miragekit/assets/kits/cyber';

export default {
  name: 'streetlife',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, M = materials(ctx), K = plan.levels.kerb, L = plan.streetlife || {}, D = detail(ctx);
    const group = new THREE.Group(); group.name = 'street-life'; decor(group);

    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), rec = recorder(ctx);   // rec: the stall's destructibles
    // ---- the yakitori container under the gallery
    const S = L.stall;
    let steam = null;
    if (S) {
      const [sx, sz] = S.at, len = 6.0, wid = 2.44, hh = 2.6, rot = S.rotY ?? 0, cm = geom.compose([sx, K, sz], [0, rot, 0]), at = (p, r = [0, 0, 0]) => cm.clone().multiply(geom.compose(p, r));
      // local frame: +x the open long side (towards the plaza), z along its length
      const { painted } = surfaceLib(ctx), paint = painted([0.36, 0.08, 0.05], { side: THREE.DoubleSide });   // painted steel (the library's), chipped and rusted
      const blue = painted([0.06, 0.16, 0.28], { side: THREE.DoubleSide });
      const ribsV = corrugated(len, hh - 0.2, { pitch: 0.28, depth: 0.04, ribs: 'v' }), ribsE = corrugated(wid - 0.2, hh - 0.2, { pitch: 0.28, depth: 0.035, ribs: 'v' });
      b.add(ribsV, paint, at([-wid / 2 + 0.04, 0.1, 0], [0, Math.PI / 2, 0]));            // the back wall
      for (const s of [-1, 1]) b.add(ribsE, paint, at([0, 0.1, s * (len / 2 - 0.04)], [0, s > 0 ? 0 : Math.PI, 0]));   // the ends
      b.add(corrugated(len, 1.0, { pitch: 0.28, depth: 0.04, ribs: 'v' }), paint, at([wid / 2 - 0.04, 0.1, 0], [0, -Math.PI / 2 + Math.PI, 0]));  // under the counter
      // the frame: corner posts, rails, the roof
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(new geom.RoundedBoxGeometry(0.16, hh, 0.16, 2, 0.02), paint, at([x * (wid / 2 - 0.08), hh / 2, z * (len / 2 - 0.08)]));
      for (const y of [0.06, hh - 0.06]) for (const x of [-1, 1]) b.add(new THREE.BoxGeometry(0.14, 0.12, len), paint, at([x * (wid / 2 - 0.07), y, 0]));
      b.add(corrugated(len, wid, { pitch: 0.3, depth: 0.025, ribs: 'v' }).translate(0, -wid / 2, 0).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), paint, at([0, hh, 0]));
      b.add(new THREE.BoxGeometry(wid - 0.1, 0.05, len - 0.1), M.wood, at([0, 0.08, 0]));
      // the flap, propped up as an awning; struts; the counter (destructibles: a rocket knocks the struts out and the
      // flap swings down on its hinge, game/destruct.js)
      const flap = track(fx, () => fx.add(corrugated(len - 0.3, 1.4, { pitch: 0.28, depth: 0.04, ribs: 'v' }), blue, at([wid / 2, hh - 0.05, 0], [Math.PI / 2 - 0.35, Math.PI / 2, 0])));
      const struts = track(fx, () => { for (const z of [-2.4, 2.4]) fx.add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), M.darkMetal, at([wid / 2 + 0.55, hh - 0.6, z], [0, 0, 0.75])); });
      rec.add({ id: 'stall-flap', fam: 'canopy', parts: [[fx, flap, 'flap'], [fx, struts, 'draw']], hinge: { at: new THREE.Vector3(wid / 2, hh - 0.05, 0).applyMatrix4(cm).toArray(), axis: new THREE.Vector3(0, 0, 1).transformDirection(cm).toArray() },
        box: { center: new THREE.Vector3(wid / 2 + 0.7, hh + 0.2, 0).applyMatrix4(cm).toArray(), half: [0.7, 0.3, (len - 0.3) / 2], yaw: rot } });
      b.add(new geom.RoundedBoxGeometry(0.5, 0.06, len - 0.4, 2, 0.02), M.wood, at([wid / 2 + 0.05, 1.12, 0]));
      // inside: a back wall of shelves and a lit menu, a grill, pots
      const menu = textAtlas([{ text: ['焼鳥 YAKITORI', 'つくね ¥180 · 皮 ¥150', '啤酒 BEER ¥400'], style: 'box', bg: '#f2e6c8', w: 1024, h: 384 }]);
      fx.add(atlasQuad(2.4, 0.9, menu.rect(0)), mat.patch(new THREE.MeshBasicMaterial({ map: menu.texture }), { output: 'outgoingLight *= 1.4 * max(uLampGain, 0.35);' }), at([-wid / 2 + 0.12, 1.85, -1.2], [0, Math.PI / 2, 0]));
      for (const y of [1.3, 1.62]) fx.add(new THREE.BoxGeometry(0.3, 0.03, 2.2), M.wood, at([-wid / 2 + 0.25, y, 1.4]));
      const PK = propKit(ctx), pb = new geom.MeshBatch();   // the stall's goods (props-goods.js)
      for (let i = 0; i < 12; i++) {
        const lp = [-wid / 2 + 0.25, 1.315 + (i % 2) * 0.32, 0.45 + (i >> 1) * 0.36], m0 = at(lp, [0, i, 0]), c = new THREE.Vector3(lp[0], lp[1] + 0.12, lp[2]).applyMatrix4(cm).toArray();
        const rg = track(pb, () => { if (i % 3 === 2) jar(PK, pb, geom, m0, i); else spiritBottle(PK, pb, geom, m0, { r: 0.032, h: 0.24, label: i, liquid: [[0.45, 0.18, 0.03], [0.9, 0.9, 0.85], [0.6, 0.08, 0.1]][i % 3], glass: [0.45, 0.55, 0.4], fill: 0.4 + 0.1 * (i % 5) }); });
        rec.add({ id: 'stall-goods-' + i, fam: i % 3 === 2 ? 'jar' : 'bottle', box: { center: c, half: [0.045, 0.12, 0.045] }, parts: [[pb, rg, 'draw']] });
      }
      // the gas bottle under the grill (it feeds the coals: shot, it burns, then goes off) and an extinguisher on the
      // end wall (shot, a white cloud no sentinel sees through)
      const gp = [wid / 2 + 0.6, 0, len / 2 - 0.45], gas = track(pb, () => gasBottle(PK, pb, geom, at(gp)));
      rec.add({ id: 'stall-gas', fam: 'gas', box: { center: new THREE.Vector3(gp[0], gp[1] + 0.32, gp[2]).applyMatrix4(cm).toArray(), half: [0.16, 0.32, 0.16] }, parts: [[pb, gas, 'draw']] });
      const ep = [wid / 2 - 0.4, 0.62, len / 2 + 0.04], ext = track(pb, () => extinguisher(PK, pb, geom, at(ep)));
      rec.add({ id: 'stall-extinguisher', fam: 'extinguisher', box: { center: new THREE.Vector3(ep[0], ep[1] + 0.26, ep[2] + 0.09).applyMatrix4(cm).toArray(), half: [0.09, 0.3, 0.09] }, parts: [[pb, ext, 'draw']] });
      skewers(PK, pb, geom, at([0.2, 0.96, 0.8], [0, Math.PI / 2, 0]), 10, 1.3);
      pot(PK, pb, geom, at([0.2, 0.93, -1.0]), 0.2, 0.26, false);
      riceCooker(PK, pb, geom, at([-0.5, 0.13, -2.2], [0, 1.2, 0]));
      bowls(PK, pb, geom, at([wid / 2 + 0.05, 1.15, -1.9]), 5, [0.88, 0.85, 0.78], 0.075);
      for (const z of [-0.6, 0.9, 2.1]) chopsticks(PK, pb, geom, at([wid / 2 + 0.12, 1.15, z]));
      b.add(new geom.RoundedBoxGeometry(0.6, 0.85, 1.6, 2, 0.03), M.steel, at([0.2, 0.5, 0.8]));
      fx.add(new THREE.BoxGeometry(0.5, 0.02, 1.4), mat.glow([1.0, 0.32, 0.06], 2.2), at([0.2, 0.92, 0.8]));   // the coals, under a grate
      for (let k = 0; k < 15; k++) fx.add(new THREE.BoxGeometry(0.54, 0.008, 0.008), M.steel, at([0.2, 0.945, 0.1 + k * 0.1]));
      fx.add(new THREE.BoxGeometry(wid - 0.4, 0.03, 0.25), M.neonSoft.warm, at([0, hh - 0.12, 0]));            // the strip light inside
      steam = new THREE.Vector3(0.2, 1.3, -1.0).applyMatrix4(cm).toArray();
      // lanterns along the flap's edge, the name on the roof
      const edge = (z) => new THREE.Vector3(wid / 2 + 1.25, hh + 0.3, z).applyMatrix4(cm);
      for (let z = -2.4, i = 0; z <= 2.41; z += 0.8, i++) {
        const p = edge(z), pl = paperLantern(PK, pb, geom, [p.x, p.y - 0.05, p.z], { r: 0.15, h: 0.36, print: i % 4, color: i % 2 ? [1.0, 0.16, 0.08] : [1.0, 0.5, 0.22], k: 1.7, cord: 0.27, tilt: ((i * 5) % 3 - 1) * 0.05, yaw: i });
        rec.add({ id: 'stall-lantern-' + i, fam: 'lantern', sphere: { center: pl.center, radius: pl.r }, parts: [[pb, pl.paper, 'glow']], lampGroup: 'stall-lanterns', hangs: 'stall-flap' });
      }
      root.add(decor(rec.finished(pb, pb.finish({ name: 'stall-goods', castShadow: false }))));
      const tex = signTexture(['屋台 · やきとり', 'YATAI 07'], { color: '#ffb347', second: '#ffffff', w: 1024, h: 256 });
      const nm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), mat.glow([1, 1, 1], 2.4, { map: tex }));
      nm.applyMatrix4(at([wid / 2 - 0.3, hh + 0.55, 0], [0, Math.PI / 2, 0])); group.add(nm);
      rec.add({ id: 'stall-sign', fam: 'sign', object: nm, text: 'YATAI 07' });
      b.add(new THREE.BoxGeometry(0.12, 1.0, 3.8), M.blackMetal, at([wid / 2 - 0.38, hh + 0.55, 0]));
      // a stencilled code on each end
      const code = textAtlas([{ text: ['NDXU 207318 4', '22G1  MAX 30480'], style: 'neon', color: '#e8e2d0', w: 512, h: 160 }]);
      const codeMat = mat.std({ map: code.texture, transparent: true, depthWrite: false, roughness: 0.8, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [-1, 1]) fx.add(atlasQuad(1.5, 0.47, code.rect(0)), codeMat, at([0, 2.05, s * (len / 2 + 0.01)], [0, s > 0 ? 0 : Math.PI, 0]));
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(wid, hh, len)); proxy.applyMatrix4(at([0, hh / 2, 0])); ctx.collider(proxy);
      proxy.userData.destructible = 'stall';   // rounds go by its walls (solid above), not this box: the goods inside can be hit
      breakablesLamp(ctx, 'stall-lanterns', trackLamps(ctx, () => lamp(ctx, { pos: new THREE.Vector3(wid / 2 + 1.2, 2.0, 0).applyMatrix4(cm).toArray(), color: 0xffa050, intensity: 6, range: 6.5 })));
    }

    // (the vending machines are vending.js's)
    // ---- the machines (the cyber kit's buildMachines): bystanders, walkers and a courier on the east pavement's loop, the vendors, a
    //      sweeper, the clinic's queue totem, units that broke down, a queue charging at the plaza's drink machine. Decor: walked and shot through, out of the walk grid.
    const people = thin(ctx, L.people || [], 4), walkers = thin(ctx, L.walkers || [], 1), w0 = (L.walkers || [])[0];
    const machines = buildMachines(ctx, {
      stand: people.map((p) => ({ x: p[0], z: p[1], yaw: p[2], umb: !!p[3], y: p[4] ?? K })),
      // one loop (the first walker's), one pace, evenly spaced: nobody walks through anybody at the ends
      walkers: w0 && { loop: w0, y: K, n: walkers.length, speed: walkers.reduce((s, w) => s + w.speed, 0) / walkers.length, courier: walkers.length > 1 ? 1 : -1 },
      stall: S && { m: geom.compose([S.at[0], K, S.at[1]], [0, S.rotY ?? 0, 0]) },
      cart: L.cartVendor && { m: geom.compose([L.cartVendor[0], K, L.cartVendor[1]], [0, L.cartVendor[2], 0]) },
      sweeper: L.sweeper && D > 0.5 && { a: L.sweeper[0], b: L.sweeper[1], y: K },   // not at low detail
      totem: L.totem && [L.totem[0], K, L.totem[1], L.totem[2]],
      queue: L.queue && { slots: L.queue.slots, y: K, socket: [L.queue.socket[0], K + L.queue.socket[1], L.queue.socket[2]] },
      broken: thin(ctx, L.broken || [], 1).map(([x, z, yaw, y]) => [x, y ?? K, z, yaw]),
      detail: D,
    });
    group.add(machines.group);
    ctx.onUpdate(machines.update);
    root.add(group, b.finish({ name: 'street-life-solid', castShadow: false }), decor(rec.finished(fx, fx.finish({ name: 'street-life-decor', castShadow: false }))));
    return { steam, n: machines.count, tris: machines.tris, D };
  },
  anchors: (ctx, built) => ({ steam: built.steam ? [{ pos: built.steam, rotY: 0 }] : [] }),
};

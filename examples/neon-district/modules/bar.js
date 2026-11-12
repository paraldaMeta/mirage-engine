// bar: the noodle bar on the north side of the street (plan.bar). A tiled room behind a shop front with a door and
// two windows: a counter with stools, a back shelf of bottles, a hood over the stove, three booths, paper lanterns.
// The warm room is the world's probe-GI box and one of its reflection probes (main.js reads plan.bar.rect), so the
// lanterns' light bounces off the tiles and the lacquer. Without the probes (ctx.shared.gi false) it declares an
// ambient volume instead. Offers `signs` (two neon signs on its walls) and `lanterns` (for the game's flicker).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, slab, decor } from './lib.js';
import { propKit, recorder, track, trackLamps, breakablesLamp, paperLantern, tubeFixture, spiritBottle, tumbler, bowls, pot, noodleBasket, riceCooker, chopsticks, stool } from '@miragekit/assets/kits/cyber';
import { detail } from './kit.js';
import { shafts } from './shafts.js';

export default {
  name: 'bar',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), B = plan.bar, F = plan.levels.floor, K = plan.levels.kerb;
    const [x0, z0, x1, z1] = B.rect, T = B.wall, H = B.height, cx = (x0 + x1) / 2;
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), P = propKit(ctx), pb = new geom.MeshBatch(), D = detail(ctx);
    const at = (p, r = [0, 0, 0], s = 1) => geom.compose(p, r, s);
    // destructibles (game/destruct.js): the windows, bottles, glasses, bowls, lanterns, tubes; nothing by the pass
    const rec = recorder(ctx), nearPass = (p) => Math.hypot(p[0] - B.pass[0], p[2] - B.pass[2]) < 0.45;
    let nb = 0;
    const bottle = (fam, m0, o, pos, h, r) => {
      const rg = track(pb, () => (fam === 'glassware' ? tumbler(P, pb, geom, m0) : spiritBottle(P, pb, geom, m0, o)));
      if (!nearPass(pos)) rec.add({ id: `bar-${fam}-${nb++}`, fam, box: { center: [pos[0], pos[1] + h / 2, pos[2]], half: [r + 0.004, h / 2, r + 0.004] }, parts: [[pb, rg, 'draw']] });
    };
    // the floor (through the doorway), the ceiling, three lined walls
    slab(b, M.tile, [x0 + T, z0 + T, x1 - T, z1], -0.2, F);
    slab(b, M.plaster, [x0, z0, x1, z1 - T], H, H + 0.3);
    slab(b, M.plaster, [x0, z0, x0 + T, z1 - T], 0, H);
    slab(b, M.plaster, [x1 - T, z0, x1, z1 - T], 0, H);
    slab(b, M.plaster, [x0 + T, z0, x1 - T, z0 + T], 0, H);
    for (const x of [x0 + T + 0.02, x1 - T - 0.02]) b.box(M.wood, [0.04, 1.0, z1 - z0 - 2 * T], [x, F + 0.5, (z0 + z1 - T) / 2]);   // a dado
    // the shop front: a door and two windows in one wall
    const openings = [{ x: B.door.x - cx, width: B.door.width, height: B.door.height, arch: 'flat' },
      ...B.windows.map((w) => ({ x: w.x - cx, width: w.width, height: 2.5, sill: 0.9, arch: 'flat' }))];
    b.add(geom.wall({ length: x1 - x0, height: H + 0.3, thickness: T, openings }), M.concrete, geom.compose([cx, 0, z1 - T / 2]));
    for (const w of B.windows) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w.width, 1.6, 0.03), M.glassDirty);
      pane.position.set(w.x, 1.7, z1 - T / 2); pane.name = 'bar-window'; root.add(pane);
      const p = new THREE.Mesh(new THREE.BoxGeometry(w.width, 1.6, 0.2)); p.position.copy(pane.position); ctx.collider(p);   // glass you cannot walk or shoot through (until it is shot out)
      rec.add({ id: 'bar-window-' + B.windows.indexOf(w), fam: 'bar-window', object: pane, proxies: [p] });
      b.box(M.blackMetal, [w.width + 0.1, 0.07, T + 0.1], [w.x, 0.9, z1 - T / 2]);
      for (const k of [-0.5, 0, 0.5]) fx.box(M.blackMetal, [0.04, 1.6, 0.05], [w.x + k * w.width * 0.66, 1.7, z1 - T / 2]);
    }
    // the door's short curtain (two cloths) and the canopy over the pavement
    for (const s of [-1, 1]) fx.box(M.lacquer, [B.door.width / 2 - 0.04, 0.75, 0.02], [B.door.x + s * B.door.width / 4, B.door.height - 0.38, z1 - T / 2]);
    b.box(M.blackMetal, [x1 - x0 - 1, 0.1, 1.2], [cx, H - 0.1, z1 + 0.6]);
    const canopy = tubeFixture(P, pb, geom, at([cx, H - 0.19, z1 + 1.05]), x1 - x0 - 1.4, [1.0, 0.72, 0.42], 5);
    rec.add({ id: 'bar-canopy-tube', fam: 'tube', box: canopy.box, parts: [[pb, canopy.tube, 'glow']], lamps: trackLamps(ctx, () => lamp(ctx, { pos: [cx, H - 0.5, z1 + 0.9], color: 0xffb070, intensity: 4, range: 8, shadow: true })) });

    // ---- the counter, stools, the kitchen behind
    const [c0, d0, c1, d1] = B.counter.rect, ch = B.counter.height;
    slab(b, M.lacquer, [c0, d0 + 0.08, c1, d1 - 0.08], F, F + ch - 0.05);
    slab(b, M.wood, [c0 - 0.05, d0 - 0.06, c1 + 0.08, d1 + 0.14], F + ch - 0.05, F + ch, 0.02);
    const strip = track(fx, () => fx.box(M.neon.amber, [c1 - c0 - 0.2, 0.025, 0.02], [(c0 + c1) / 2, F + 0.09, d1 - 0.06]));                       // a strip under its foot
    rec.add({ id: 'bar-counter-neon', fam: 'neon', color: 'amber', box: { center: [(c0 + c1) / 2, F + 0.09, d1 - 0.06], half: [(c1 - c0 - 0.2) / 2, 0.02, 0.02] }, parts: [[fx, strip, 'draw']] });
    for (let x = c0 + 0.8; x < c1 - 0.3; x += 1.25) {
      stool(P, pb, geom, at([x, F, d1 + 0.62], [0, x, 0]), 0.695);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.7, 16)); sp.position.set(x, F + 0.35, d1 + 0.62); ctx.collider(sp);   // the old stool's volume
    }
    // back counter and the shelf of bottles: small glowing colours that the probes pick up
    slab(b, M.steel, [x0 + T, z0 + T, c1 - 1.2, z0 + T + 0.7], F, F + 0.9);
    for (const y of [1.55, 2.05, 2.55]) slab(b, M.wood, [x0 + T + 0.3, z0 + T, c1 - 1.6, z0 + T + 0.3], F + y, F + y + 0.04);
    // real bottles on the shelves: glass, the spirit at its level, a label, a cap; an LED strip under each shelf
    const glassT = [[0.55, 0.45, 0.25], [0.3, 0.55, 0.35], [0.8, 0.85, 0.9], [0.4, 0.25, 0.15], [0.75, 0.8, 0.85], [0.35, 0.6, 0.6]];
    const liq = [[0.45, 0.18, 0.03], [0.85, 0.8, 0.6], [0.6, 0.08, 0.12], [0.9, 0.92, 0.95], [0.75, 0.55, 0.1], [0.5, 0.75, 0.65]];
    let n = 0;
    for (const y of [1.59, 2.09, 2.59]) {
      tubeFixture(P, pb, geom, at([(x0 + T + 0.3 + c1 - 1.6) / 2, F + y - 0.035, z0 + T + 0.26], [Math.PI, 0, 0]), c1 - 1.6 - x0 - T - 0.5, [1.0, 0.75, 0.45], 3);
      for (let x = x0 + T + 0.5; x < c1 - 1.75; x += 0.21 + 0.05 * ((n * 7) % 3) / 2) {
        n++;
        if (n % 7 === 0 || (D < 0.7 && n % 2)) continue;
        const k = (n * 5 + (n >> 1)) % 6, h = 0.26 + 0.06 * (n % 3), r = 0.034 + 0.008 * (n % 2), pos = [x, F + y + 0.04, z0 + T + 0.15];
        bottle('bottle', at(pos, [0, (n % 5) * 0.4 - 0.8, 0]), { r, h, glass: glassT[k], liquid: liq[k], fill: 0.25 + 0.7 * (((n * 37) % 10) / 10), label: n, square: n % 4 === 1, cap: n % 3 ? [0.6, 0.5, 0.2] : [0.05, 0.05, 0.05] }, pos, h, r);
      }
    }
    slab(b, M.steel, [c0 + 2.2, z0 + T, c0 + 4.6, z0 + T + 0.9], F + 2.2, F + 2.75);                                 // the hood
    const hood = tubeFixture(P, pb, geom, at([c0 + 3.4, F + 2.17, z0 + T + 0.5]), 2.0, [0.85, 0.92, 1.0], 5);
    // the kitchen: a stock pot with baskets in it, a lidded pot, a rice cooker, bowls and ladles at the pass
    pot(P, pb, geom, at([c0 + 2.9, F + 0.9, z0 + T + 0.4]), 0.2, 0.26, false);
    for (const [dx, a] of [[-0.07, 0.4], [0.08, -0.5], [0.0, 2.8]]) noodleBasket(P, pb, geom, at([c0 + 2.9 + dx, F + 0.98, z0 + T + 0.4 + dx], [0, a, 0]));
    pot(P, pb, geom, at([c0 + 3.9, F + 0.9, z0 + T + 0.4]), 0.18, 0.22, true);
    riceCooker(P, pb, geom, at([c0 + 1.4, F + 0.9, z0 + T + 0.35], [0, 0.3, 0]));
    for (const [x, nbw] of [[c0 + 4.9, 5], [c0 + 5.2, 3], [c0 + 0.6, 4]]) {
      const rg = track(pb, () => bowls(P, pb, geom, at([x, F + 0.9, z0 + T + 0.45]), nbw, [0.88, 0.85, 0.78]));
      rec.add({ id: `bar-bowls-${nb++}`, fam: 'bowls', box: { center: [x, F + 0.9 + 0.04 + nbw * 0.012, z0 + T + 0.45], half: [0.09, 0.04 + nbw * 0.012, 0.09] }, parts: [[pb, rg, 'draw']] });
    }
    for (let i = 0; i < 4; i++) P.put(pb, new THREE.CylinderGeometry(0.006, 0.006, 0.4, 5), P.mats.metal, at([c0 + 2.3 + i * 0.12, F + 2.0, z0 + T + 0.85]), [0.6, 0.6, 0.62]);   // ladles on the hood's rail
    for (let i = 0; i < 4; i++) P.put(pb, new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), P.mats.metal, at([c0 + 2.3 + i * 0.12, F + 1.8, z0 + T + 0.85]), [0.6, 0.6, 0.62]);
    // on the counter: bowls, chopstick holders, cups and a bottle or two where people sit; its worn front edge
    P.put(pb, new geom.RoundedBoxGeometry(c1 - c0 + 0.1, 0.03, 0.05, 1, 0.012), P.mats.metal, at([(c0 + c1) / 2, F + ch - 0.035, d1 + 0.13]), [0.42, 0.33, 0.2]);
    for (let x = c0 + 0.8, i = 0; x < c1 - 0.3; x += 1.25, i++) {
      chopsticks(P, pb, geom, at([x + 0.35, F + ch, d1 - 0.12]));
      if (i % 2 === 0) {
        const bp = [x - 0.05, F + ch, d1 - 0.05], rg = track(pb, () => bowls(P, pb, geom, at(bp), 1, [0.15, 0.06, 0.04], 0.09));
        if (!nearPass(bp)) rec.add({ id: `bar-bowls-${nb++}`, fam: 'bowls', box: { center: [bp[0], bp[1] + 0.04, bp[2]], half: [0.095, 0.04, 0.095] }, parts: [[pb, rg, 'draw']] });
      }
      bottle('glassware', at([x - 0.3, F + ch, d1 - 0.02]), null, [x - 0.3, F + ch, d1 - 0.02], 0.09, 0.034);
      if (i % 3 === 1) bottle('bottle', at([x + 0.15, F + ch, d1 - 0.25]), { r: 0.035, h: 0.22, label: 1, liquid: [0.85, 0.8, 0.6], glass: [0.8, 0.85, 0.9], fill: 0.5 }, [x + 0.15, F + ch, d1 - 0.25], 0.22, 0.035);
    }
    // menus: the day's board over the pass, the list on the east wall
    P.put(pb, new THREE.PlaneGeometry(1.2, 0.9), P.mats.glow, at([c0 + 6.95, F + 2.25, z0 + T + 0.02]), [0.9, 0.85, 0.75], P.R.menuB);
    P.put(pb, new geom.RoundedBoxGeometry(1.28, 0.98, 0.03, 1, 0.01), P.mats.paint, at([c0 + 6.95, F + 2.25, z0 + T + 0.005]), [0.12, 0.06, 0.03]);
    P.put(pb, new THREE.PlaneGeometry(1.4, 1.05).rotateY(-Math.PI / 2), P.mats.paint, at([x1 - T - 0.02, F + 2.1, -7.2]), [1.4, 1.35, 1.25], P.R.menuA);

    // ---- three booths along the east wall
    for (const z of [-6.3, -3.6, -0.9]) {
      const bx = x1 - T - 0.75;
      slab(b, M.wood, [bx - 0.6, z - 0.38, bx + 0.6, z + 0.38], F + 0.72, F + 0.77, 0.015);
      b.cylinder(M.steel, 0.04, 0.04, 0.72, [bx, F + 0.36, z], [0, 0, 0], 8);
      for (const s of [-1, 1]) { slab(b, M.lacquer, [bx - 0.6, z + s * 0.72 - 0.22, bx + 0.6, z + s * 0.72 + 0.22], F, F + 0.45, 0.03); slab(b, M.lacquer, [bx - 0.6, z + s * 0.95 - 0.05, bx + 0.6, z + s * 0.95 + 0.05], F + 0.45, F + 1.1, 0.02); }
    }
    b.box(M.screenAmber, [0.06, 1.0, 2.0], [x1 - T - 0.04, F + 2.3, -3.6]);                                           // the menu screen

    // ---- paper lanterns: a warm glow each, three of them real lamps
    const lanterns = [];
    const lantern = (id, pl, lamps, lampGroup) => rec.add({ id, fam: 'lantern', sphere: { center: pl.center, radius: pl.r * 0.95 }, parts: [[pb, pl.paper, 'glow']], lamps, lampGroup });
    [[-19.6, -2.6, 1], [-16, -3.2, 0], [-12.6, -2.4, 1], [-18, -7.3, 0], [-11.6, -6.6, 1], [-14.6, 0.2, 0]].forEach(([x, z, real], i) => {
      const pl = paperLantern(P, pb, geom, [x, H, z], { r: 0.2, h: 0.46, print: i % 4, color: [1.0, 0.62, 0.32], k: 1.5, cord: H - F - 2.55 - 0.28, tilt: (i % 3 - 1) * 0.03, yaw: i * 0.9 });
      const lp = real ? trackLamps(ctx, () => lamp(ctx, { indoor: true, live: true, pos: [x, F + 2.4, z], color: 0xff9c4a, intensity: 1.7, range: 7, shadow: i === 0 })) : null;
      if (lp) lanterns.push(lp.result);
      lantern('bar-lantern-' + i, pl, lp);
    });
    rec.add({ id: 'bar-hood-tube', fam: 'tube', box: hood.box, parts: [[pb, hood.tube, 'glow']], lamps: trackLamps(ctx, () => lamp(ctx, { indoor: true, pos: [c0 + 3.4, F + 2.0, z0 + T + 0.6], color: 0xd8ecff, intensity: 3.5, range: 5 })) });   // under the hood
    // two red lanterns outside, either side of the door (one lamp between them: it goes with the second)
    for (const s of [-1, 1]) {
      lantern('bar-door-lantern-' + (s + 1) / 2, paperLantern(P, pb, geom, [B.door.x + s * 1.35, H - 0.15, z1 + 0.32], { r: 0.22, h: 0.52, print: s < 0 ? 1 : 2, color: [1.0, 0.2, 0.1], k: 1.8, cord: H - 0.15 - K - 2.25 - 0.31, tilt: s * 0.03 }), null, 'bar-door-lanterns');
    }
    breakablesLamp(ctx, 'bar-door-lanterns', trackLamps(ctx, () => lamp(ctx, { pos: [B.door.x, K + 2.1, z1 + 0.7], color: 0xff3a20, intensity: 2.4, range: 5 })));
    // ---- light in the air (shafts.js): the street lamps across the road through the shop windows and the door by
    // night, warm-white with the steam and dust of the kitchen in it; the sun or the moon when it shines in
    const SH = shafts(ctx), room = [x0 + T, 0, z0 + T, x1 - T, H, z1];
    const streetLamps = plan.lamps.filter(([, z]) => z > 5).map(([x, z, side]) => [x, K + 4.9, z + side * 1.45]);
    const near = (x) => streetLamps.reduce((a, l) => (Math.abs(l[0] - x) < Math.abs(a[0] - x) ? l : a));
    for (const w of B.windows) {
      const ap = { o: [w.x - w.width / 2, 0.9, z1], e1: [w.width, 0, 0], e2: [0, 1.6, 0], out: [0, 0, 1], depth: T, floorY: F, clip: room };
      SH.add({ ...ap, kind: 'spill', src: near(w.x), color: [1, 0.89, 0.81], power: 1.5, dens: 0.045, motes: 140 });
      SH.add({ ...ap, kind: 'key', dens: 0.04, motes: 0 });
    }
    SH.add({ o: [B.door.x - B.door.width / 2, F, z1], e1: [B.door.width, 0, 0], e2: [0, B.door.height - F, 0], out: [0, 0, 1], depth: T, floorY: F, clip: room, kind: 'spill', src: near(B.door.x), color: [1, 0.89, 0.81], power: 1.5, dens: 0.04, motes: 0 });
    root.add(b.finish({ name: 'bar' }));
    root.add(decor(rec.finished(fx, fx.finish({ name: 'bar-decor', castShadow: false }))), decor(rec.finished(pb, pb.finish({ name: 'bar-props', castShadow: false }))));
    return { lanterns };
  },
  anchors: (ctx, built) => {
    const B = ctx.plan.bar, [x0, z0, , z1] = B.rect, T = B.wall, F = ctx.plan.levels.floor;
    return {
      signs: [
        { pos: [x0 + T + 0.01, F + 2.45, -2.2], rotY: Math.PI / 2, w: 2.4, h: 0.8, text: '營業中', color: 'green', kind: 'board', bare: true },
        { pos: [x0 + T + 3.4, F + 2.98, z0 + T + 0.02], rotY: 0, w: 1.5, h: 0.42, text: 'RAMEN', color: 'cyan', kind: 'board', bare: true },
      ],
      lanterns: built.lanterns.map((l) => ({ pos: l.position.toArray(), rotY: 0, light: l })),
      interiors: [{ pos: [(x0 + B.rect[2]) / 2, F, (z0 + z1) / 2], rotY: 0, name: 'bar' }],
    };
  },
  ambientVolumes: (ctx) => {
    if (ctx.shared.gi) return [];   // the probe volume lights this room: dimming the sky light as well would darken it twice
    const B = ctx.plan.bar, [x0, z0, x1, z1] = B.rect;
    return [{ min: [x0, 0, z0], max: [x1, B.height, z1], factor: 0.25, soft: 0.6 }];
  },
};

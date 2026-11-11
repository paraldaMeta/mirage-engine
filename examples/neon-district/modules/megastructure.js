// megastructure: the city above the street. Four skybridges between the blocks (glass corridors with lit ceilings
// over Kestrel Street and the alley, a road deck from the bar's roof), a gallery along the plaza's west wall, setbacks,
// spires and light fins on the skyline towers, a ring of megatowers further out, and behind the relay a viaduct with a
// train that crosses on the scene clock. Seen from the street it is the layering overhead; nothing here is walked on.
// Offers `trains` (the train's lamp, for anything that wants to follow it).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, slab, decor } from './lib.js';

export default {
  name: 'megastructure',
  build(ctx) {
    const { geom, root, plan, R } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch(), far = new geom.MeshBatch(), fx = new geom.MeshBatch(), glass = [];   // far: beyond the block, casts no shadow
    const S = plan.street.rect;

    // ---- skybridges across the street: [x0, x1, y (floor), height, kind, tint]
    const bridge = (x0, x1, z0, z1, y, h, tint, alongX = false) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, span = alongX ? w : d, wide = alongX ? d : w;
      slab(b, M.darkMetal, [x0, z0, x1, z1], y - 0.35, y);                                   // the deck, deep enough to carry
      slab(b, M.darkMetal, [x0, z0, x1, z1], y + h, y + h + 0.25);
      for (let i = 0; i <= Math.round(span / 2.2); i++) {                                    // frames every 2.2 m
        const t = -span / 2 + (i * span) / Math.round(span / 2.2);
        for (const s of [-1, 1]) b.box(M.blackMetal, alongX ? [0.12, h, 0.12] : [0.12, h, 0.12], alongX ? [cx + t, y + h / 2, cz + s * (wide / 2 - 0.06)] : [cx + s * (wide / 2 - 0.06), y + h / 2, cz + t]);
      }
      for (const s of [-1, 1]) {                                                             // glazing, a rail inside, a strut under
        glass.push([alongX ? [span, h - 0.2, 0.04] : [0.04, h - 0.2, span], alongX ? [cx, y + h / 2, cz + s * (wide / 2 - 0.05)] : [cx + s * (wide / 2 - 0.05), y + h / 2, cz]]);
        b.box(M.blackMetal, alongX ? [span, 0.3, 0.14] : [0.14, 0.3, span], alongX ? [cx, y - 0.5, cz + s * (wide / 2 - 0.2)] : [cx + s * (wide / 2 - 0.2), y - 0.5, cz]);
        fx.box(M.neon[tint], alongX ? [span, 0.05, 0.04] : [0.04, 0.05, span], alongX ? [cx, y - 0.37, cz + s * (wide / 2)] : [cx + s * (wide / 2), y - 0.37, cz]);
      }
      fx.box(M.neonSoft.white, alongX ? [span - 0.6, 0.03, 0.3] : [0.3, 0.03, span - 0.6], [cx, y + h - 0.02, cz]);   // the lit ceiling
      const col = new THREE.Color().setRGB(...M.NEON[tint]);
      for (let i = 0; i < 2; i++) { const t = (i + 0.5) / 2 - 0.5; lamp(ctx, { pos: alongX ? [cx + t * span, y - 0.7, cz] : [cx, y - 0.7, cz + t * span], color: col, intensity: 5, range: 9 }); }
    };
    bridge(-29.5, -26.5, S[1], S[3], 7.6, 2.8, 'cyan');
    bridge(-1.5, 2.5, S[1], S[3], 10.4, 3.0, 'pink');
    bridge(plan.alley.rect[0], plan.alley.rect[2], 15.4, 17.8, 8.2, 2.6, 'violet', true);
    // a road deck from the bar's roof to the block across the street: wider, open, with a parapet and lamp strips
    const [rx0, rx1, ry] = [-18.5, -13.5, 14];
    slab(b, M.concrete, [rx0, S[1] - 0.5, rx1, S[3] + 0.5], ry - 0.7, ry);
    for (const x of [rx0, rx1]) { slab(b, M.concrete, [x - 0.15, S[1] - 0.5, x + 0.15, S[3] + 0.5], ry, ry + 0.9); fx.box(M.neon.amber, [0.03, 0.05, S[3] - S[1]], [x + (x < -16 ? -0.17 : 0.17), ry - 0.2, (S[1] + S[3]) / 2]); }
    lamp(ctx, { pos: [(rx0 + rx1) / 2, ry - 1.2, 6], color: 0xffa040, intensity: 6, range: 13 });

    // ---- the plaza's west gallery: a walkway on brackets at first-floor height, railing, a row of shop lights
    const P = plan.plaza.rect, gx = P[0], gy = 4.6;
    slab(b, M.darkMetal, [gx, P[1] + 1, gx + 1.5, P[3] - 1], gy - 0.2, gy);
    for (let z = P[1] + 2; z < P[3] - 1; z += 3.2) { b.box(M.blackMetal, [1.6, 0.12, 0.12], [gx + 0.75, gy - 0.6, z], [0, 0, 0.5]); fx.box(M.neonSoft[['amber', 'pink', 'cyan', 'green'][Math.round(z) & 3]], [0.03, 0.9, 1.6], [gx + 0.04, gy + 1.5, z + 1.2]); }
    for (const h of [0.5, 1.05]) b.box(M.blackMetal, [0.04, 0.04, P[3] - P[1] - 2], [gx + 1.48, gy + h, (P[1] + P[3]) / 2]);
    for (let z = P[1] + 3; z < P[3] - 2; z += 5.5) lamp(ctx, { pos: [gx + 1.0, gy + 1.6, z], color: 0xffb070, intensity: 3.5, range: 8, normal: [1, 0, 0], back: 1.0 });

    // ---- the skyline towers: two setbacks, a spire, light fins up the corners
    const styles = ['glass', 'panel', 'concrete'];
    plan.skyline.forEach((t, i) => {
      const [x0, z0, x1, z1] = t.rect, w = x1 - x0, d = z1 - z0, Q = R.fork('sky' + i);
      let y = t.h, k = 1;
      for (let s = 0; s < 2; s++) { k *= Q.range(0.62, 0.8); const hh = t.h * Q.range(0.18, 0.34); slab(far, M.facade[styles[(i + s + 1) % 3]], [x0 + w * (1 - k) / 2, z0 + d * (1 - k) / 2, x1 - w * (1 - k) / 2, z1 - d * (1 - k) / 2], y, y + hh); y += hh; }
      far.cylinder(M.darkMetal, 0.15, 0.6, t.h * 0.22, [(x0 + x1) / 2, y + t.h * 0.11, (z0 + z1) / 2], [0, 0, 0], 8);
      const tint = ['cyan', 'pink', 'amber', 'violet'][i % 4];
      for (const [fxx, fzz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) if (Q.chance(0.7)) fx.box(M.neon[tint], [0.35, t.h * 0.9, 0.35], [fxx, t.h * 0.5, fzz]);
    });
    // ---- megatowers beyond: fewer, taller, stepped, most of them dark; they are the silhouettes over the roofs
    for (let i = 0; i < 16; i++) {
      const Q = R.fork('mega' + i), a = (i / 16) * Math.PI * 2 + Q.range(-0.15, 0.15), r = Q.range(120, 210), x = Math.cos(a) * r, z = Math.sin(a) * r;
      let w = Q.range(26, 48), d = Q.range(26, 48), y = 0, h = Q.range(90, 150);
      for (let s = 0; s < 3; s++) { slab(far, M.facade[styles[(i + s) % 3]], [x - w / 2, z - d / 2, x + w / 2, z + d / 2], y, y + h); y += h; w *= Q.range(0.55, 0.78); d *= Q.range(0.55, 0.78); h *= Q.range(0.35, 0.6); }
      fx.box(M.neon[['red', 'cyan', 'pink', 'amber'][i % 4]], [w * 1.4, 1.2, d * 1.4], [x, y - 0.6, z]);                 // a crown
      if (i % 3 === 0) fx.box(M.neon.white, [1.0, y * 0.5, 1.0], [x + w * 0.3, y * 0.7, z]);
    }

    // ---- the viaduct behind the relay and its train
    const vz = plan.relay.rect[1] - 7, vy = 13;
    slab(far, M.concrete, [-110, vz - 2.2, 110, vz + 2.2], vy - 1.2, vy);
    for (const z of [vz - 2.3, vz + 2.3]) slab(far, M.concrete, [-110, z - 0.15, 110, z + 0.15], vy, vy + 0.8);
    for (let x = -100; x <= 100; x += 18) { far.box(M.concrete, [2.2, vy - 1.2, 2.6], [x, (vy - 1.2) / 2, vz], [0, 0, 0], 0.1); far.box(M.concrete, [1.4, 1.0, 5.4], [x, vy - 1.7, vz]); }
    fx.box(M.neon.cyan, [220, 0.06, 0.05], [0, vy - 0.4, vz + 2.36]);
    const train = new THREE.Group(); train.name = 'train'; decor(train);
    for (let c = 0; c < 5; c++) {
      const car = new THREE.Mesh(new geom.RoundedBoxGeometry(11.4, 2.7, 2.9, 2, 0.35), M.sheet); car.position.set(c * 12, 1.55, 0); car.castShadow = false;
      const win = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.8, 2.94), M.neonSoft.warm); win.position.set(c * 12, 1.95, 0);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(11.42, 0.12, 2.93), M.neon.pink); stripe.position.set(c * 12, 0.75, 0);
      train.add(car, win, stripe);
    }
    for (const o of train.children) o.userData.occlude = false;
    train.position.set(-200, vy, vz); root.add(train);
    // it crosses every 24 s of scene clock, alternating ways
    ctx.onUpdate((t) => { const n = Math.floor(t / 24), u = (t % 24) / 9, dir = n % 2 ? -1 : 1; train.visible = u < 1; train.position.x = dir * (-190 + 380 * u) - (dir > 0 ? 48 : 0); });

    // glazing: one transparent material, not in the walk grid by the engine's rule
    const g = new geom.MeshBatch();
    for (const [size, pos] of glass) if (size.every((v) => v > 0.02)) g.box(M.glass, size, pos);
    // overhead and out of reach: not in the walk grid (a deck 8 m up would be one more floor in every column under it)
    root.add(decor(b.finish({ name: 'megastructure' })), decor(far.finish({ name: 'megastructure-far', castShadow: false })));
    const d2 = fx.finish({ name: 'megastructure-decor', castShadow: false }), d3 = g.finish({ name: 'megastructure-glass', castShadow: false });
    root.add(decor(d2), decor(d3));
    return { train };
  },
  anchors: (ctx, built) => ({ trains: [{ pos: built.train.position.toArray(), rotY: 0, object: built.train }] }),
};

// vending: every vending machine of the district (the rows of plan.streetlife.vending and the four on their own along
// the street), modelled for a look from half a metre. A cabinet of side panels, a top, a back and a lit brand header
// round a real window: behind its glass, wire shelves with modelled products standing on them (cans, PET bottles,
// cartons, noodle cups, snack packs in spiral feeders, capsule toys: instanced, each with its own printed label from
// the props atlas), price tags and a lit selection button under each, a light box behind and a strip light over
// them. Below: the coin / card panel with a small LCD, a keypad of real keys (or the capsule cranks), a delivery
// flap hinged in a recess with depth, a vented kick plate over the compressor, levelling feet, a power cable to the
// wall, stickers and grime. Five kinds: cold drinks, hot food, snacks, capsule toys, parts / ammo. A couple of cans
// lie on the ground by the first one. The cabinet is drawn as decor; an invisible box of the old size collides, so
// the walk grid and the cover stay what they were. One lamp a row (the old ones, unchanged).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor } from './lib.js';
import { detail } from './kit.js';
import { propKit, hex, canGeo, bottleGeo, cupGeo, boxGeo, packGeo, capsuleGeo, spiralGeo } from '@miragekit/world/kits/cyber';

// the singles along the street: [x, y, z, rotY, lamp tint, kind]
const SINGLES = [[-25.2, 'K', 2.5, 0, 'cyan', 'drinks'], [3.4, 'K', 9.5, Math.PI, 'pink', 'snack'], [29.3, 'K', -2.2, -Math.PI / 2, 'amber', 'hot'], [-23.55, 0, 16.5, Math.PI / 2, 'green', 'drinks']];
const ROW_KINDS = [['drinks', 'parts', 'capsule'], ['hot', 'drinks']];
const BODY = { drinks: [0.82, 0.84, 0.86], hot: [0.55, 0.04, 0.04], snack: [0.08, 0.1, 0.12], capsule: [0.85, 0.82, 0.1], parts: [0.1, 0.11, 0.1] };
const HEADER = { drinks: 0, hot: 1, snack: 2, capsule: 3, parts: 4 };

export default {
  name: 'vending',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), P = propKit(ctx), { R, mats, put } = P, K = plan.levels.kerb, D = detail(ctx);
    const b = new geom.MeshBatch(), glass = new geom.MeshBatch();
    const items = { can: [], bottle: [], cup: [], box: [], pack: [], cap: [], spiral: [] };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const rbox = (w, h, d, r = 0.012, seg = 1) => new geom.RoundedBoxGeometry(w, h, d, seg, r);
    const quad = (w, h) => new THREE.PlaneGeometry(w, h);
    let seed = 0;

    const machine = (m, kind, d) => {
      const f = d / 2, at = (p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s)), body = BODY[kind], dark = [0.03, 0.032, 0.036];
      const S = ++seed, rnd = (k) => { const x = Math.sin(S * 91.7 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
      // ---- the cabinet: sides, top, back, the header's frame
      for (const s of [-1, 1]) put(b, rbox(0.07, 1.95, d, 0.02, 2), mats.paint, at([s * 0.465, 0.975, 0]), body);
      put(b, rbox(1.0, 0.1, d, 0.03, 2), mats.paint, at([0, 1.9, 0]), body);
      put(b, box(0.88, 1.86, 0.03), mats.paint, at([0, 0.95, -f + 0.02]), body);
      put(b, rbox(0.88, 0.27, 0.06, 0.01), mats.paint, at([0, 1.72, f - 0.03]), dark);
      put(b, quad(0.82, 0.21), mats.glow, at([0, 1.72, f + 0.002]), [2.2, 2.2, 2.2], R['header' + HEADER[kind]]);
      // ---- the window: a frame of four bars, the glass, a strip light, the light box behind, the floor of the cavity
      const wy0 = 0.98, wy1 = 1.585, wx = 0.42;
      put(b, rbox(0.86, 0.035, 0.05, 0.008), mats.metal, at([0, wy1 + 0.0, f - 0.02]), [0.6, 0.62, 0.65]);
      put(b, rbox(0.86, 0.035, 0.05, 0.008), mats.metal, at([0, wy0 - 0.01, f - 0.02]), [0.6, 0.62, 0.65]);
      for (const s of [-1, 1]) put(b, rbox(0.035, wy1 - wy0, 0.05, 0.008), mats.metal, at([s * wx, (wy0 + wy1) / 2, f - 0.02]), [0.6, 0.62, 0.65]);
      glass.add(quad(0.82, wy1 - wy0), M.glass, at([0, (wy0 + wy1) / 2, f - 0.012]));
      put(b, box(0.8, 0.012, 0.03), mats.glow, at([0, wy1 - 0.03, f - 0.06]), [3.5, 3.6, 3.8]);
      const back = kind === 'hot' ? [1.5, 0.9, 0.7] : kind === 'capsule' ? [1.3, 0.8, 1.5] : [0.85, 1.05, 1.4];
      put(b, quad(0.84, wy1 - wy0), mats.glow, at([0, (wy0 + wy1) / 2, -0.12]), back, R.backlit);
      put(b, box(0.84, 0.02, f + 0.12), mats.paint, at([0, wy0 - 0.01, (f - 0.12) / 2 - 0.06]), dark);
      // ---- inside: shelves and products by kind
      if (kind === 'drinks' || kind === 'hot') {
        const rows = [wy0 + 0.012, wy0 + 0.205, wy0 + 0.4], n = 7, dx = 0.112;
        rows.forEach((y, r) => {
          put(b, box(0.82, 0.006, 0.22), mats.metal, at([0, y - 0.003, f - 0.16]), [0.55, 0.56, 0.58]);                       // the shelf
          put(b, new THREE.CylinderGeometry(0.004, 0.004, 0.82, 5).rotateZ(Math.PI / 2), mats.metal, at([0, y + 0.012, f - 0.05]), [0.7, 0.7, 0.72]);   // its wire lip
          for (let i = 0; i < n; i++) {
            const x = -0.336 + i * dx, k = Math.floor(rnd(r * 10 + i) * 100);
            let shape, lab;
            if (kind === 'hot') { shape = r === 1 ? 'cup' : 'can'; lab = shape === 'cup' ? 'can' + (8 + (k % 3)) : 'can' + (8 + (k % 3)); }
            else if (r === 1) { shape = 'bottle'; lab = 'bottle' + (k % 8); }
            else if (r === 2 && i > 4) { shape = 'box'; lab = 'box' + (k % 4); }
            else { shape = 'can'; lab = 'can' + (k % 8); }
            items[shape].push({ m: at([x, y, f - 0.1], [0, (rnd(r + i * 3) - 0.5) * 0.3, 0]), lab });
            put(b, quad(0.08, 0.033), mats.paint, at([x, y - 0.02, f - 0.044], [-0.2, 0, 0]), [1.2, 1.2, 1.2], R['price' + (kind === 'hot' ? 4 + (k % 3) : k % 4)]);
            put(b, box(0.03, 0.014, 0.014), mats.glow, at([x, y - 0.05, f - 0.04]), kind === 'hot' ? [2.4, 0.3, 0.2] : [0.3, 1.2, 2.6]);   // the selection button
          }
        });
      } else if (kind === 'snack' || kind === 'parts') {
        const rows = [wy0 + 0.015, wy0 + 0.165, wy0 + 0.315, wy0 + 0.465].slice(0, 4), n = 5, dx = 0.162;
        rows.forEach((y, r) => {
          put(b, box(0.82, 0.006, f + 0.08), mats.metal, at([0, y - 0.003, (f - 0.08) / 2 - 0.08]), [0.45, 0.46, 0.48]);
          for (let i = 0; i < n; i++) {
            const x = -0.324 + i * dx, k = Math.floor(rnd(r * 10 + i) * 100);
            items.spiral.push({ m: at([x, y, f - 0.03]) });
            const shape = kind === 'snack' ? 'pack' : (k % 3 === 0 ? 'can' : 'box'), lab = kind === 'snack' ? 'pack' + (k % 6) : shape === 'can' ? 'can' + (11 + (k % 2)) : 'box' + (4 + (k % 2));
            for (let j = 0; j < 1; j++) items[shape].push({ m: at([x, y + (shape === 'pack' ? 0.004 : 0), f - 0.09 - j * 0.085], [shape === 'pack' ? -0.12 : 0, shape === 'can' ? 0 : 0, 0], shape === 'box' ? [1.2, 0.9, 1.3] : 1), lab });
            put(b, quad(0.07, 0.03), mats.paint, at([x, y - 0.018, f - 0.025]), [1.2, 1.2, 1.2], R['price' + (k % 4)]);
          }
        });
      } else {   // capsules heaped behind the glass
        let i = 0;
        for (let l = 0; l < 5; l++) for (let dz = 0; dz < 2; dz++) for (let c = 0; c < 11 - (l & 1); c++, i++) {   // packed in layers, a mound
          const x = -0.36 + c * 0.072 + (l & 1) * 0.036 + (rnd(i) - 0.5) * 0.01, y = wy0 + 0.034 + l * 0.056, z = f - 0.06 - dz * 0.068 - (l & 1) * 0.034;
          if (y > wy0 + 0.16 + 0.1 * Math.cos(x * 4.5) - 0.05 * dz) continue;
          items.cap.push({ m: at([x, y, z], [rnd(i + 1) * 3, rnd(i + 2) * 3, 0]), lab: 'cap' + (i % 4) });
        }
      }
      // ---- the panel below the window: three pieces round the delivery opening, the payment panel, keys
      const py0 = 0.1, py1 = wy0 - 0.03, oy0 = 0.17, oy1 = 0.4, ox = 0.3;
      put(b, rbox(0.86, py1 - oy1, 0.05, 0.008), mats.paint, at([0, (oy1 + py1) / 2, f - 0.025]), body);
      put(b, rbox(0.86, oy0 - py0, 0.05, 0.008), mats.paint, at([0, (py0 + oy0) / 2, f - 0.025]), body);
      for (const s of [-1, 1]) put(b, box(0.43 - ox, oy1 - oy0, 0.05), mats.paint, at([s * (ox + (0.43 - ox) / 2), (oy0 + oy1) / 2, f - 0.025]), body);
      // the recess: five inward faces, dark; the flap hinged at its top, pushed in a little; a steel frame
      const rd = 0.16;
      put(b, quad(2 * ox, oy1 - oy0), mats.paint, at([0, (oy0 + oy1) / 2, f - rd]), [0.02, 0.02, 0.022]);
      put(b, quad(2 * ox, rd).rotateX(-Math.PI / 2), mats.paint, at([0, oy1, f - rd / 2]), [0.03, 0.03, 0.03]);
      put(b, quad(2 * ox, rd).rotateX(Math.PI / 2), mats.metal, at([0, oy0, f - rd / 2]), [0.25, 0.25, 0.27]);
      for (const s of [-1, 1]) put(b, quad(rd, oy1 - oy0).rotateY(-s * Math.PI / 2), mats.paint, at([s * ox, (oy0 + oy1) / 2, f - rd / 2]), [0.025, 0.025, 0.028]);
      put(b, box(2 * ox - 0.02, oy1 - oy0 - 0.015, 0.008).translate(0, -(oy1 - oy0) / 2, 0), mats.paint, at([0, oy1 - 0.005, f - 0.035], [-0.22, 0, 0]), [0.06, 0.065, 0.07]);
      put(b, quad(0.28, 0.06).translate(0, -(oy1 - oy0) * 0.45, 0.005), mats.paint, at([0, oy1 - 0.005, f - 0.035], [-0.22, 0, 0]), [1, 1, 1], R.push);
      for (const [w, h, x, y] of [[2 * ox + 0.04, 0.02, 0, oy1 + 0.01], [2 * ox + 0.04, 0.02, 0, oy0 - 0.01], [0.02, oy1 - oy0, -ox - 0.01, (oy0 + oy1) / 2], [0.02, oy1 - oy0, ox + 0.01, (oy0 + oy1) / 2]]) put(b, rbox(w, h, 0.02, 0.006), mats.metal, at([x, y, f + 0.004]), [0.55, 0.56, 0.6]);
      // the payment panel (right), proud of the face
      const cx = 0.27, cy = 0.72;
      put(b, rbox(0.2, 0.42, 0.04, 0.01), mats.metal, at([cx, cy, f + 0.01]), [0.35, 0.36, 0.38]);
      put(b, quad(0.17, 0.3), mats.paint, at([cx, cy + 0.04, f + 0.031]), [1, 1, 1], R.coin);
      put(b, quad(0.12, 0.035), mats.glow, at([cx, cy + 0.16, f + 0.032]), [1.6, 1.6, 1.6], R.lcd);
      put(b, rbox(0.03, 0.05, 0.02, 0.006), mats.metal, at([cx + 0.06, cy - 0.15, f + 0.04]), [0.7, 0.7, 0.72]);   // the return lever
      if (kind === 'capsule') {   // four cranks instead of keys
        for (let i = 0; i < 4; i++) {
          const x = -0.33 + i * 0.12, y = 0.6;
          put(b, new THREE.CylinderGeometry(0.045, 0.048, 0.03, 16).rotateX(Math.PI / 2), mats.metal, at([x, y, f + 0.015]), [0.75, 0.75, 0.78]);
          put(b, rbox(0.018, 0.075, 0.03, 0.008), mats.paint, at([x, y, f + 0.04], [0, 0, i * 0.7]), hex(['#ff3060', '#30b0ff', '#ffd020', '#60e080'][i]));
          put(b, quad(0.1, 0.075), mats.paint, at([x, y + 0.13, f + 0.001]), [1, 1, 1], R['cap' + i]);
        }
      } else {   // a keypad: 3 x 4 keys
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) put(b, box(0.032, 0.022, 0.012), mats.paint, at([-0.1 + c * 0.042, 0.82 - r * 0.032, f + 0.004]), r === 3 && c !== 1 ? [0.9, 0.3, 0.2] : [0.82, 0.83, 0.85], R.keypad);
        put(b, quad(0.18, 0.13), mats.paint, at([-0.29, 0.75, f + 0.001]), [1, 1, 1], R['sticker' + (S % 4)]);
      }
      // ---- the kick plate over the compressor: dark, slatted; feet; a sticker on the side; a cable to the wall
      put(b, box(0.86, 0.1, 0.02), mats.paint, at([0, 0.05, f - 0.06]), [0.015, 0.015, 0.017]);
      for (let i = 0; i < 5; i++) put(b, box(0.84, 0.008, 0.02), mats.metal, at([0, 0.015 + i * 0.018, f - 0.04], [0.5, 0, 0]), [0.3, 0.3, 0.32]);
      for (const sx of [-0.42, 0.42]) for (const sz of [-f + 0.06, f - 0.06]) put(b, new THREE.CylinderGeometry(0.022, 0.026, 0.03, 8), mats.metal, at([sx, 0.012, sz]), [0.4, 0.4, 0.42]);
      put(b, quad(0.17, 0.13).rotateY(Math.PI / 2), mats.paint, at([0.501, 1.3 - rnd(5) * 0.4, -0.1 + rnd(6) * 0.2], [rnd(8) * 0.2 - 0.1, 0, 0]), [1, 1, 1], R['sticker' + ((S + 2) % 4)]);
      const cable = geom.taperedTube([[0.4, 0.1, -f + 0.04], [0.52, 0.03, -f + 0.02], [0.56, 0.012, -f - 0.04], [0.6, 0.18, -f - 0.09], [0.6, 0.32, -f - 0.09]], [0.007, 0.007, 0.007, 0.007, 0.007], { radial: 5, segments: 14 });
      put(b, cable, mats.paint, at([0, 0, 0]), [0.02, 0.02, 0.02]);
      put(b, rbox(0.06, 0.09, 0.04, 0.01), mats.paint, at([0.6, 0.35, -f - 0.09]), [0.7, 0.7, 0.66]);   // the socket on the wall
    };

    const proxy = (m, d) => { const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.95, d)); p.applyMatrix4(m.clone().multiply(geom.compose([0, 0.975, 0]))); ctx.collider(p); };
    const L = plan.streetlife || {};
    (L.vending || []).forEach(([x0, z0, dx, dz, nV, rotY, tint], r) => {
      for (let i = 0; i < nV; i++) {
        const m = geom.compose([x0 + dx * i, K * (z0 < 10 ? 1 : 0), z0 + dz * i], [0, rotY, 0]);
        machine(m, (ROW_KINDS[r] || ROW_KINDS[0])[i % 3], 0.75); proxy(m, 0.75);
      }
      const mid = [x0 + dx * (nV - 1) / 2, 0, z0 + dz * (nV - 1) / 2], n2 = [Math.sin(rotY), 0, Math.cos(rotY)];
      lamp(ctx, { pos: [mid[0] + n2[0] * 1.1, 1.3, mid[2] + n2[2] * 1.1], color: tint, intensity: 3.2, range: 5, normal: n2, back: 1.1 });
    });
    for (const [x, y0, z, rot, tint, kind] of SINGLES) {
      const y = y0 === 'K' ? K : y0, m = geom.compose([x, y, z], [0, rot, 0]);
      machine(m, kind, 0.8); proxy(m, 0.8);
      const p = new THREE.Vector3(0, 1.2, 0.9).applyMatrix4(m);
      lamp(ctx, { pos: p.toArray(), color: new THREE.Color().setRGB(...M.NEON[tint]), intensity: 6, range: 7, normal: [Math.sin(rot), 0, Math.cos(rot)], back: 0.5 });
    }
    // two cans dropped on the ground by the first machine of the alley row
    const v0 = (L.vending || [])[0];
    if (v0 && D > 0.5) {
      items.can.push({ m: geom.compose([v0[0] - 0.75, 0.033, v0[1] - 0.45], [Math.PI / 2, 0.6, 0]), lab: 'can1' });
      items.can.push({ m: geom.compose([v0[0] - 1.1, 0.03, v0[1] + 0.3], [Math.PI / 2 - 0.1, 2.2, 0], [1, 0.82, 1]), lab: 'can3' });
    }

    const out = new THREE.Group(); out.name = 'vending';
    const shapes = { can: [canGeo(R.can0), 'can0'], bottle: [bottleGeo(R.bottle0), 'bottle0'], cup: [cupGeo(R.can0), 'can0'], box: [boxGeo(R.box0), 'box0'], pack: [packGeo(R.pack0), 'pack0'], cap: [capsuleGeo(R.cap0), 'cap0'] };
    for (const [k, [geo, base]] of Object.entries(shapes)) { const im = P.instanced(geo, base, items[k], { name: 'vending-' + k }); if (im) out.add(im); }
    if (items.spiral.length) { const sp = geom.instances(spiralGeo(), mats.metal, items.spiral.map((s) => s.m), { castShadow: false }); tintInstanced(sp); sp.name = 'vending-spirals'; out.add(sp); }
    out.add(b.finish({ name: 'vending-body', castShadow: false }), glass.finish({ name: 'vending-glass', castShadow: false }));
    out.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    root.add(decor(out));
    return {};
  },
};
// the spirals use the metal material, which reads a vertex colour: give their geometry one
function tintInstanced(mesh) {
  const g = mesh.geometry, n = g.attributes.position.count, c = new Float32Array(n * 3).fill(0.75);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
}

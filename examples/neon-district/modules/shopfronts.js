// shopfronts: the ground storey along both pavements of Kestrel Street (built by street.js, not a module of its own).
// Each bay is 3 m between two bevelled piers under a fascia, one of three kinds:
//  - open: a lit shop seen through its glass (lib-free interior mapping, kit.js: shelves, a counter, the keeper),
//    the roller shutter part way down, often an awning, a light-box name over it, its light on the pavement;
//  - shut: a corrugated roller shutter all the way down (real ribs), worn paint, rust run down from the slats;
//  - door: a recessed door with a lit wired-glass light and a strip over it.
// One bay is the street doctor's: a clinic with a cold interior and its own sign. Everything flat against the wall
// stays solid (piers, shutters: they are walls); steps, awnings and signs are decor.
import * as THREE from 'three';
import { lamp } from './lib.js';
import { materials } from './materials.js';
import { corrugated, canopy, worn, interiorMaterial, textAtlas, atlasQuad, signRects, inFrontOfSign } from './kit.js';
import { propKit, acUnit } from '@miragekit/world/kits/cyber';

const NAMES = [
  ['珍寶電器', 'DENKI'], ['金魚茶室'], ['喫茶 夜', 'KISSA'], ['24H 便利', 'コンビニ'], ['鍵匠 LOCKS'], ['眼鏡 OPTIC'], ['涼茶舖'],
  ['ラーメン 丸'], ['手機維修', 'PHONE FIX'], ['藥 PHARMA'], ['寿司 SUSHI'], ['漫画 MANGA'], ['電池 CELLS'], ['麻將館'],
  ['カラオケ', 'KARAOKE'], ['燒臘 BBQ'], ['花 FLORIST'], ['五金 HARDWARE'], ['點心 DIMSUM'], ['古着 USED'],
];
const BOX = ['#ffd23a', '#f4f1e8', '#ff4f6d', '#2fd1c5', '#ff8a2a', '#9ad14b'];

export function shopFronts(ctx, fx, shops) {
  const { geom, root, plan, mat, R } = ctx, M = materials(ctx), K = plan.levels.kerb, Q = R.fork('shopfronts');
  const signsOnWalls = signRects(plan), clinicAt = plan.shopfronts?.clinic;
  const W = 2.92, H = 2.45;
  const P = propKit(ctx), pb = new geom.MeshBatch();   // close-up props (props-*.js): AC units, the doors' wired glass
  // ---- materials (shared by every bay)
  const shutterMats = ['vec3(0.36, 0.37, 0.39)', 'vec3(0.42, 0.1, 0.07)', 'vec3(0.08, 0.3, 0.3)', 'vec3(0.5, 0.36, 0.08)', 'vec3(0.24, 0.27, 0.33)']
    .map((c, i) => mat.std({ roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }, worn(c, { rows: 0.38, chip: [0.45, 0.7, 0.55, 0.6, 0.4][i], rust: [0.5, 0.8, 0.6, 0.7, 0.45][i] })));
  const frameMat = mat.std({ roughness: 0.6, metalness: 0.3 }, worn('vec3(0.11, 0.115, 0.12)', { rows: 1.4, chip: 0.35, rust: 0.35 }));
  const awnings = [['vec3(0.5, 0.06, 0.05)', 'vec3(0.6, 0.58, 0.5)'], ['vec3(0.05, 0.25, 0.22)', 'vec3(0.55, 0.52, 0.45)'], ['vec3(0.55, 0.38, 0.04)', 'vec3(0.06, 0.06, 0.06)'], ['vec3(0.12, 0.16, 0.35)', 'vec3(0.5, 0.5, 0.48)']]
    .map(([a, c]) => mat.std({ roughness: 0.62, side: THREE.DoubleSide }, {
      fragmentDecl: 'float ndH;',
      albedo: `{ vec3 p = mgWorldPos; float u = abs(normalize(mgWorldNormal).x) > 0.5 ? p.z : p.x; float s = step(0.5, fract(u / 0.5));
        float dirt = mgFbm3(p * vec3(1.5, 4.0, 1.5), 3); ndH = 0.5 + 0.5 * sin(u * 25.1);
        diffuseColor.rgb *= mix(${a}, ${c}, s) * (0.7 + 0.4 * dirt) * (1.0 - 0.35 * smoothstep(0.3, 0.9, mgFbm3(p * vec3(4.0, 0.6, 0.6) + 3.0, 3))); }`,
      normal: 'normal = mgBump(normal, ndH, 0.002);',
    }));
  const interior = interiorMaterial(ctx, { W, H }), clinic = interiorMaterial(ctx, { W, H, kind: 'clinic' });
  const darkGlass = mat.std({ color: new THREE.Color(0.01, 0.012, 0.015), roughness: 0.08, metalness: 0.2 });
  // ---- names: one atlas for every light box
  const labels = NAMES.map((n, i) => ({ text: n, style: i % 4 === 3 ? 'neon' : 'box', bg: BOX[i % BOX.length], color: ['#ff4fa0', '#2fe0ff', '#ffb347', '#7dff9a'][i % 4], w: 512, h: 96 }));
  labels.push({ text: ['義體診所 · CLINIC 24'], style: 'box', bg: '#e9fbff', ink: '#05343a', w: 512, h: 96 });
  const atlas = textAtlas(labels, { width: 2048 });
  const signMat = mat.patch(new THREE.MeshBasicMaterial({ map: atlas.texture }), { output: 'outgoingLight *= 1.7 * max(uLampGain, 0.32);' });
  const signs = new geom.MeshBatch(), glass = new geom.MeshBatch(), insides = new geom.MeshBatch(), b = new geom.MeshBatch();   // b: solid, flat on the walls (no shadows: nothing to cast)
  const bevel = (bt, m, size, p, r = 0.025) => bt.add(new geom.RoundedBoxGeometry(size[0], size[1], size[2], 1, r), m, p);
  const shutterGeo = new Map(), shutter = (h) => { const k = h.toFixed(2); if (!shutterGeo.has(k)) shutterGeo.set(k, corrugated(W, h, { pitch: 0.085, depth: 0.022, ribs: 'h' })); return shutterGeo.get(k); };
  let open = 0, nameAt = 0;
  for (const [x, z, out] of shops) {
    const cx = x + 2.1, yaw = out > 0 ? 0 : Math.PI, m = geom.compose([cx, K, z], [0, yaw, 0]);
    const at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
    const isClinic = clinicAt && Math.abs(cx - clinicAt[0]) < 1.5 && Math.abs(z - clinicAt[1]) < 0.5;
    const r = Q.next(), kind = isClinic ? 'open' : r < 0.42 ? 'open' : r < 0.86 ? 'shut' : 'door';
    // piers and the fascia
    for (const s of [-1, 1]) bevel(b, frameMat, [0.28, 3.05, 0.2], at([s * 1.6, 1.525, 0.1]), 0.03);
    bevel(b, frameMat, [3.5, 0.5, 0.26], at([0, 2.92 + 0.25, 0.13]), 0.035);
    if (kind === 'open') {
      insides.add(new THREE.PlaneGeometry(W, H), isClinic ? clinic : interior, at([0, 0.05 + H / 2, 0.012]));
      glass.add(new THREE.PlaneGeometry(W, H), M.glass, at([0, 0.05 + H / 2, 0.05]));
      fx.add(new THREE.BoxGeometry(0.05, H, 0.06), M.blackMetal, at([-0.45, 0.05 + H / 2, 0.06]));        // the door's frame
      fx.add(new THREE.BoxGeometry(W, 0.05, 0.06), M.blackMetal, at([0, 2.1, 0.06]));
      const hs = isClinic ? 0.35 : Q.range(0.35, 0.95);
      b.add(shutter(hs), shutterMats[Q.int(0, 4)], at([0, 2.5 - hs, 0.07]));
      fx.add(new THREE.BoxGeometry(W + 0.02, 0.07, 0.07), M.darkMetal, at([0, 2.5 - hs, 0.1]));             // the shutter's bottom bar
      fx.add(new geom.RoundedBoxGeometry(3.3, 0.12, 0.4, 2, 0.03), M.concrete, at([0, 0.06, 0.2]));         // the step
      const tint = isClinic ? 0x8ff6ff : [0xffb070, 0x9fd0ff, 0xff8ac0, 0xa0ffc0][Math.floor(Q.next() * 4)];
      lamp(ctx, { pos: new THREE.Vector3(0, 1.9, 0.9).applyMatrix4(m).toArray(), color: tint, intensity: 4, range: 4.5, normal: [0, 0, out], back: 0.9 });
      open++;
    } else if (kind === 'shut') {
      b.add(shutter(2.8), shutterMats[Q.int(0, 4)], at([0, 0.02, 0.03]));
      bevel(b, frameMat, [3.2, 0.42, 0.34], at([0, 2.95, 0.17]), 0.04);                                      // the roller's housing
      fx.add(new THREE.BoxGeometry(W + 0.02, 0.08, 0.08), M.darkMetal, at([0, 0.06, 0.07]));
      for (const s of [-1, 1]) fx.add(new THREE.BoxGeometry(0.06, 2.8, 0.09), M.darkMetal, at([s * 1.47, 1.42, 0.05]));
      for (const s of [-0.9, 0.9]) fx.add(new geom.RoundedBoxGeometry(0.07, 0.09, 0.04, 2, 0.012), M.steel, at([s, 0.16, 0.12]));   // padlocks
    } else {
      fx.add(new THREE.BoxGeometry(W, 2.75, 0.04), frameMat, at([0, 1.4, 0.01]));
      b.add(new geom.RoundedBoxGeometry(1.1, 2.3, 0.08, 2, 0.02), darkGlass, at([0.5, 1.15, 0.04]));
      P.put(pb, new THREE.PlaneGeometry(0.46, 0.31), P.mats.glow, at([0.5, 1.75, 0.085]), [1.0, 0.72, 0.42]);   // the door's wired glass, lit from inside
      P.put(pb, new geom.RoundedBoxGeometry(0.52, 0.37, 0.02, 1, 0.006), P.mats.metal, at([0.5, 1.75, 0.075]), [0.08, 0.08, 0.085]);
      for (let k = 1; k < 5; k++) P.put(pb, new THREE.BoxGeometry(0.004, 0.31, 0.004), P.mats.metal, at([0.5 - 0.23 + k * 0.092, 1.75, 0.088]), [0.3, 0.3, 0.3]);
      for (let k = 1; k < 4; k++) P.put(pb, new THREE.BoxGeometry(0.46, 0.004, 0.004), P.mats.metal, at([0.5, 1.75 - 0.155 + k * 0.0775, 0.088]), [0.3, 0.3, 0.3]);
      fx.add(new THREE.BoxGeometry(1.2, 0.04, 0.05), M.neon[Q.pick(['cyan', 'amber', 'pink', 'white'])], at([0.5, 2.38, 0.1]));
      fx.add(new geom.RoundedBoxGeometry(0.16, 0.24, 0.05, 2, 0.015), M.steel, at([-0.3, 1.35, 0.04]));   // an intercom
    }
    // the name over it (an open shop always, the others sometimes); the clinic's own
    if (kind === 'open' || Q.chance(0.4)) {
      const i = isClinic ? labels.length - 1 : (nameAt++ % NAMES.length);
      signs.add(atlasQuad(2.9, 0.42, atlas.rect(i)), signMat, at([0, 3.17, 0.265]));
    }
    // an awning over most open shops
    if (kind !== 'door' && (kind === 'open' ? Q.chance(0.75) : Q.chance(0.3))) {
      const am = awnings[Q.int(0, awnings.length - 1)], d = Q.range(0.9, 1.3);
      fx.add(canopy(3.4, d, 0.38, 6), am, at([0, 2.86, 0.27]));
      fx.add(new THREE.BoxGeometry(3.4, 0.22, 0.02), am, at([0, 2.86 - 0.38 - 0.11, 0.27 + d]));
      for (const s of [-1, 1]) fx.add(new THREE.CylinderGeometry(0.012, 0.012, Math.hypot(d, 0.6), 5), M.darkMetal, at([s * 1.55, 2.86 + 0.08, 0.27 + d / 2], [Math.atan2(d, 0.6), 0, 0]));
    }
    // wall plant above: an AC unit, a conduit (not in front of a sign)
    if (Q.chance(0.6)) { const ax = cx + Q.range(-1.4, 1.4), ay = K + Q.range(3.6, 4.0); acUnit(P, pb, geom, geom.compose([ax, ay, z - out * 0.04], [0, yaw, 0]), [0.55, 0.56, 0.54]); }
    const px = x + Q.range(0.1, 0.5);
    if (!inFrontOfSign(signsOnWalls, { plane: z, nx: 0, nz: out, along: px, y0: K, y1: K + 9 })) fx.cylinder(M.darkMetal, 0.045, 0.045, 9, [px, K + 4.5, z + out * 0.07], [0, 0, 0], 8);
  }
  const s = signs.finish({ name: 'shop-names', castShadow: false }), gl = glass.finish({ name: 'shop-glass', castShadow: false }), ins = insides.finish({ name: 'shop-interiors', castShadow: false });
  for (const o of [s, gl, ins]) o.traverse((c) => { c.userData.collide = false; c.receiveShadow = false; });
  root.add(s, gl, ins, b.finish({ name: 'shopfronts', castShadow: false }));
  const pr = pb.finish({ name: 'shop-props', castShadow: false }); pr.traverse((c) => { c.userData.collide = false; }); root.add(pr);
  return { open };
}

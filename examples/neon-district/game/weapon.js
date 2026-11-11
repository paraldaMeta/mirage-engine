// The carbine: a view model modelled in code (extruded profiles, lathes) that rides the camera, hit-scan rounds against Rapier (the world)
// and the sentinels' hit spheres, a recoil that climbs and recovers, spread that blooms with heat, aiming down the
// sight (the camera's field of view narrows), a reload with the magazine leaving the gun, a muzzle light and flash,
// tracers, sparks and a scorch where a round lands.
// The engine has no weapon layer: the view model is an ordinary lit object placed from the camera's matrix before
// every sub-frame (world.ctx.onUpdate), so the neon lights it and the temporal passes see its motion.
import * as THREE from 'three';
import { FX } from './fx.js';

export const GUN = { mag: 24, reserve: 96, max: 168, rate: 0.095, damage: 22, reload: 1.7, fov: 62, adsFov: 44 };

export function createWeapon({ world, root, vfx, sfx, physics, M, player, targets, hud, stats, onReload }) {
  const { mat, camera } = world;
  const holder = new THREE.Group(); holder.name = 'viewmodel'; root.add(holder);
  const gun = new THREE.Group(); holder.add(gun);
  const steel = M.steel, dark = mat.std({ color: new THREE.Color(0.028, 0.03, 0.036), roughness: 0.55, metalness: 0.6 }), body = mat.std({ color: new THREE.Color(0.07, 0.076, 0.088), roughness: 0.42, metalness: 0.75 });
  const glove = mat.std({ color: new THREE.Color(0.1, 0.1, 0.11), roughness: 0.62 }), sleeve = mat.std({ color: new THREE.Color(0.16, 0.18, 0.21), roughness: 0.85 });
  const part = (geo, m, p, r = [0, 0, 0], parent = gun) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; o.userData.occlude = false; parent.add(o); return o; };
  const RB = (w, h, d, r = 0.004) => new world.geom.RoundedBoxGeometry(w, h, d, 1, Math.min(r, 0.45 * Math.min(w, h, d)));
  // the gun points along -Z (the camera's view); metres. It is modelled, not stacked: side silhouettes extruded
  // across the width with chamfered edges (`side`), cross-sections extruded along the barrel (`sect`), lathed
  // rounds (`lathe`), a few boxes; the static geometry is merged into one mesh per material.
  const poly = mat.std({ color: new THREE.Color(0.1, 0.105, 0.115), roughness: 0.68, metalness: 0.15 });           // furniture: guard, grip, stock
  const glass = mat.std({ color: new THREE.Color(0.35, 0.75, 0.9), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false });
  const HP = Math.PI / 2, v2 = (pts) => pts.map(([a, b]) => new THREE.Vector2(a, b));
  const ext = (pts, w, b = 0.003, holes = []) => {
    const s = new THREE.Shape(v2(pts)), d = w - 2 * b;
    for (const h of holes) s.holes.push(new THREE.Path(v2(h)));
    return new THREE.ExtrudeGeometry(s, { depth: d, steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1 }).translate(0, 0, -d / 2);
  };
  const side = (pts, w, b, holes) => ext(pts, w, b, holes).rotateY(-HP);                 // a profile in (z, y), w wide
  const sect = (pts, len, b, holes) => ext(pts, len, b, holes);                          // a profile in (x, y), len long
  const lathe = (pts, n = 12) => new THREE.LatheGeometry(v2(pts), n).rotateX(HP);        // [radius, z] pairs, z rising
  const cylX = (r, len, n = 8) => new THREE.CylinderGeometry(r, r, len, n).rotateZ(HP), cylZ = (r, len, n = 10, r2 = r) => new THREE.CylinderGeometry(r2, r, len, n).rotateX(HP);
  const L = { body: [], dark: [], steel: [], poly: [], glove: [], sleeve: [], plate: [], lGlove: [], lSleeve: [], lPlate: [] };
  const put = (list, geo, p = [0, 0, 0], r = [0, 0, 0], basis = null) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1)));
    if (basis) g.applyMatrix4(basis);
    list.push(g);
  };
  const fuse = (list, m, parent = gun) => part(world.geom.mergeGeometries(list, false), m, [0, 0, 0], [0, 0, 0], parent);
  const hex = (r, len) => new THREE.CylinderGeometry(r, r, len, 6).rotateZ(HP);          // a fastener's head, axis X
  // receiver: an upper and a lower with a seam between their chamfers, raised panels, pins, controls
  put(L.body, side([[0.13, -0.004], [0.13, 0.026], [0.118, 0.04], [-0.17, 0.04], [-0.17, -0.004]], 0.046, 0.007));
  put(L.dark, side([[0.13, -0.004], [0.13, -0.026], [0.11, -0.04], [-0.018, -0.04], [-0.022, -0.066], [-0.1, -0.074], [-0.108, -0.036], [-0.17, -0.026], [-0.17, -0.004]], 0.044, 0.004));
  put(L.body, side([[0.1, 0.004], [0.1, 0.022], [0.086, 0.031], [-0.02, 0.031], [-0.034, 0.02], [-0.034, 0.004]], 0.004, 0.0015), [-0.0235, 0, 0]);   // left panel
  put(L.body, side([[0.1, 0.004], [0.1, 0.031], [0.03, 0.031], [0.03, 0.004]], 0.004, 0.0015), [0.0235, 0, 0]);
  put(L.dark, side([[-0.108, -0.03], [-0.03, -0.03], [-0.026, -0.058], [-0.1, -0.064]], 0.048, 0.002));                // the magazine well's collar
  for (const z of [0.105, -0.14]) put(L.steel, cylX(0.0036, 0.047), [0, -0.018, z]);                                    // take-down pins
  put(L.steel, cylX(0.0055, 0.004, 10), [-0.0238, -0.02, 0.066]); put(L.steel, new THREE.BoxGeometry(0.003, 0.0045, 0.022), [-0.0262, -0.017, 0.056], [0.35, 0, 0]);   // selector
  put(L.steel, new THREE.BoxGeometry(0.003, 0.018, 0.009), [-0.0232, -0.015, -0.05]);                                 // bolt catch
  put(L.steel, cylX(0.005, 0.005, 8), [0.0238, -0.022, -0.008]);                                                       // magazine release
  // charging handle (left, forward): a slot and a knurled knob
  put(L.dark, new THREE.BoxGeometry(0.001, 0.007, 0.11), [-0.0232, 0.019, -0.105]);
  put(L.body, new THREE.BoxGeometry(0.006, 0.013, 0.016), [-0.0255, 0.019, -0.075]);
  put(L.steel, cylX(0.0048, 0.02, 8), [-0.036, 0.019, -0.075]);
  for (const x of [-0.031, -0.036, -0.041]) put(L.dark, cylX(0.0054, 0.0018, 8), [x, 0.019, -0.075]);
  // ejection port (right): the opening, the bolt behind it, a dust cover folded down, a deflector
  put(L.dark, new THREE.BoxGeometry(0.001, 0.017, 0.064), [0.0232, 0.018, -0.07]);
  put(L.steel, new THREE.BoxGeometry(0.001, 0.011, 0.054), [0.0236, 0.018, -0.07]);
  put(L.body, new THREE.BoxGeometry(0.003, 0.016, 0.066), [0.027, 0.002, -0.07], [0, 0, -0.6]);
  put(L.body, side([[-0.018, 0.008], [-0.018, 0.03], [-0.034, 0.019]], 0.008, 0.002), [0.025, 0, 0]);
  // hand guard: slots cut through (the barrel and gas tube show), ribs low on the sides, a collar at the receiver
  const slot = (z, y, len, h) => [[z - len / 2 + h / 2, y - h / 2], [z + len / 2 - h / 2, y - h / 2], [z + len / 2, y], [z + len / 2 - h / 2, y + h / 2], [z - len / 2 + h / 2, y + h / 2], [z - len / 2, y]];
  put(L.poly, side([[-0.172, -0.024], [-0.172, 0.04], [-0.5, 0.04], [-0.5, 0.01], [-0.468, -0.024]], 0.044, 0.008, [0, 1, 2, 3, 4].map((i) => slot(-0.216 - i * 0.056, 0.019, 0.042, 0.011))));
  for (let i = 0; i < 20; i++) put(L.dark, new THREE.BoxGeometry(0.048, 0.011, 0.0055), [0, -0.0125, -0.2 - i * 0.0135]);
  put(L.dark, sect([[-0.024, -0.02], [-0.024, 0.034], [-0.017, 0.043], [0.017, 0.043], [0.024, 0.034], [0.024, -0.02], [0.017, -0.027], [-0.017, -0.027]], 0.012, 0.002), [0, 0, -0.178]);
  for (const s of [-1, 1]) part(RB(0.003, 0.006, 0.25, 0), M.neon.cyan, [s * 0.0212, 0.001, -0.32]);                  // light strips
  // barrel, gas tube and block, a muzzle brake with three baffles
  put(L.steel, cylZ(0.009, 0.46), [0, 0.008, -0.395]);
  put(L.steel, cylZ(0.0038, 0.34, 6), [0, 0.0255, -0.345]);
  put(L.dark, cylZ(0.0145, 0.03, 8), [0, 0.008, -0.53]); put(L.dark, new THREE.BoxGeometry(0.012, 0.016, 0.022), [0, 0.022, -0.526]);
  put(L.dark, lathe([[0.0062, -0.69], [0.0125, -0.698], [0.0168, -0.694], [0.0168, -0.685], [0.0112, -0.683], [0.0112, -0.675], [0.0168, -0.673], [0.0168, -0.664], [0.0112, -0.662], [0.0112, -0.654], [0.0168, -0.652],
    [0.0168, -0.638], [0.0132, -0.632], [0.0132, -0.617], [0.0098, -0.613]]), [0, 0.008, 0]);
  // top rail: one crenellated profile, receiver to the guard's nose
  const rail = [[0.1, 0.039]];
  for (let z = 0.098; z > -0.485; z -= 0.0155) rail.push([z, 0.0515], [z - 0.009, 0.0515], [z - 0.009, 0.0452], [z - 0.0155, 0.0452]);
  rail.push([rail[rail.length - 1][0], 0.039]);
  put(L.dark, side(rail, 0.022, 0.002));
  // the sight: a clamp on the rail, a hood raked back, a lens; the dot is only lit when aiming
  put(L.dark, side([[-0.03, 0.046], [-0.03, 0.055], [-0.038, 0.06], [-0.1, 0.06], [-0.108, 0.055], [-0.108, 0.046]], 0.036, 0.003));
  for (const s of [-1, 1]) put(L.body, side([[-0.046, 0.058], [-0.06, 0.1], [-0.094, 0.1], [-0.094, 0.058]], 0.0045, 0.0015), [s * 0.0188, 0, 0]);
  put(L.body, sect([[-0.021, 0.097], [-0.021, 0.1], [-0.016, 0.104], [0.016, 0.104], [0.021, 0.1], [0.021, 0.097]], 0.036, 0.0015), [0, 0, -0.077]);
  put(L.steel, cylX(0.007, 0.008, 8), [-0.0215, 0.055, -0.07]); put(L.dark, cylX(0.008, 0.007, 10), [0.0215, 0.072, -0.076]);
  for (const s of [-1, 1]) put(L.steel, hex(0.0026, 0.002), [s * 0.0212, 0.07, -0.086]);
  part(new THREE.BoxGeometry(0.034, 0.034, 0.0015), glass, [0, 0.0805, -0.089], [-0.08, 0, 0]);
  const dot = part(new THREE.SphereGeometry(0.0018, 8, 6), mat.glow([1, 0.1, 0.05], 12), [0, 0.0765, -0.07]);
  // stock: a skeleton profile with a cheek rest and a butt pad
  put(L.poly, side([[0.128, 0.03], [0.2, 0.03], [0.214, 0.041], [0.312, 0.041], [0.326, 0.03], [0.344, 0.03], [0.344, -0.082], [0.326, -0.082], [0.2, -0.032], [0.128, -0.026]], 0.036, 0.006,
    [[[0.216, -0.016], [0.314, -0.054], [0.314, 0.012], [0.216, 0.012]]]));
  put(L.dark, side([[0.21, 0.036], [0.222, 0.047], [0.302, 0.047], [0.314, 0.036]], 0.041, 0.004));
  put(L.dark, RB(0.042, 0.122, 0.018, 0.006), [0, -0.026, 0.352]);
  // grip, trigger guard, trigger
  put(L.poly, side([[0.048, -0.038], [0.104, -0.038], [0.119, -0.03], [0.123, -0.05], [0.113, -0.07], [0.139, -0.14], [0.09, -0.147], [0.062, -0.076], [0.05, -0.06]], 0.03, 0.007));
  put(L.dark, side([[-0.02, -0.04], [0.05, -0.04], [0.059, -0.07], [0.047, -0.079], [-0.014, -0.079], [-0.02, -0.07]], 0.012, 0.0015,
    [[[-0.0125, -0.0445], [0.046, -0.0445], [0.051, -0.068], [0.044, -0.074], [-0.0105, -0.074], [-0.0145, -0.066]]]));
  put(L.steel, side([[0.012, -0.04], [0.02, -0.04], [0.016, -0.055], [0.008, -0.066], [0.004, -0.064], [0.011, -0.054]], 0.006, 0.001));
  // fasteners on both sides
  for (const s of [-1, 1]) {
    for (const [z, y] of [[-0.186, 0.02], [-0.186, -0.006], [-0.482, 0.022]]) put(L.steel, hex(0.003, 0.002), [s * 0.0225, y, z]);
    put(L.steel, hex(0.003, 0.002), [s * 0.0185, 0, 0.15]); put(L.steel, hex(0.0032, 0.002), [s * 0.0155, -0.1, 0.096]);
  }
  for (const [k, m] of [['body', body], ['dark', dark], ['steel', steel], ['poly', poly]]) fuse(L[k], m);
  // the magazine: it leaves the gun in the reload (ribbed sides, a base plate)
  const magParts = [side([[-0.028, 0.066], [0.028, 0.066], [0.029, 0], [0.026, -0.06], [-0.03, -0.06], [-0.029, 0]], 0.026, 0.003)];
  for (const z of [-0.015, 0, 0.015]) magParts.push(new THREE.BoxGeometry(0.0285, 0.098, 0.006).translate(0, -0.008, z).toNonIndexed());
  const magazine = part(world.geom.mergeGeometries(magParts, false), body, [0, -0.1, -0.06], [0.14, 0, 0]); magazine.name = 'magazine';
  part(side([[-0.034, -0.058], [0.03, -0.058], [0.032, -0.066], [0.03, -0.075], [-0.034, -0.075], [-0.037, -0.066]], 0.032, 0.003), poly, [0, 0, 0], [0, 0, 0], magazine);
  const magHome = magazine.position.clone();
  // hands: gloved, the right round the grip, the left cupping the guard from below; each on a cuffed, sleeved forearm
  const hands = new THREE.Group(); gun.add(hands);
  const left = new THREE.Group(); hands.add(left);
  const Y = new THREE.Vector3(0, 1, 0);
  const seg = (list, a, b, r) => {   // one phalanx: a capsule from a to b
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CapsuleGeometry(r, len, 2, 7).toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), new THREE.Vector3(1, 1, 1)));
    list.push(g);
  };
  const finger = (list, pts, r0 = 0.0098, taper = 0.0007) => { for (let i = 0; i + 1 < pts.length; i++) seg(list, pts[i], pts[i + 1], r0 - i * taper); };
  // a forearm from the wrist toward the elbow: a glove cuff with a strap, a sleeve with folds, a plate on the side facing `out`
  const forearm = (gl, sl, pl, wrist, elbow, out) => {
    const o = new THREE.Vector3(...out), y = new THREE.Vector3(...elbow).sub(new THREE.Vector3(...wrist)).normalize(), z = o.addScaledVector(y, -y.dot(o)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(...wrist);
    put(gl, new THREE.LatheGeometry(v2([[0.0245, -0.012], [0.0265, 0.004], [0.0285, 0.03], [0.032, 0.052], [0.0335, 0.058], [0.031, 0.061]]), 10), [0, 0, 0], [0, 0, 0], m);
    put(pl, new THREE.TorusGeometry(0.0295, 0.0038, 5, 12).rotateX(HP), [0, 0.022, 0], [0, 0, 0], m);
    put(sl, new THREE.LatheGeometry(v2([[0.027, 0.045], [0.034, 0.066], [0.0375, 0.092], [0.0325, 0.106], [0.04, 0.124], [0.0415, 0.16], [0.036, 0.176], [0.0445, 0.196], [0.047, 0.255], [0.042, 0.272], [0.051, 0.294], [0.054, 0.44]]), 10), [0, 0, 0], [0, 0, 0], m);
    put(pl, sect([[-0.022, -0.07], [0.022, -0.07], [0.026, -0.05], [0.02, 0.07], [-0.02, 0.07], [-0.026, -0.05]], 0.009, 0.003), [0, 0.155, 0.0425], [0.05, 0, 0], m);
    for (const sx of [-1, 1]) put(pl, new THREE.CylinderGeometry(0.003, 0.003, 0.003, 6).rotateX(HP), [sx * 0.014, 0.115, 0.0455], [0, 0, 0], m);
  };
  // right hand: the back of the hand on the grip's right, three fingers round its front, the index on the trigger, the thumb over the top
  put(L.glove, RB(0.028, 0.086, 0.074, 0.012), [0.03, -0.092, 0.108], [-0.43, 0, 0]);
  put(L.plate, RB(0.006, 0.05, 0.042, 0.002), [0.0455, -0.086, 0.1], [-0.43, 0, 0]);
  for (const [i, y] of [-0.079, -0.1, -0.121].entries()) {
    const zf = 0.05 + (-0.06 - y) * 0.465;
    finger(L.glove, [[0.027, y, zf + 0.016], [0.02, y - 0.001, zf - 0.009], [-0.006, y - 0.002, zf - 0.0115], [-0.0245, y - 0.002, zf + 0.005 + i * 0.001]]);
  }
  finger(L.glove, [[0.026, -0.057, 0.072], [0.019, -0.057, 0.046], [0.004, -0.058, 0.028], [-0.011, -0.058, 0.03]], 0.0092);
  seg(L.glove, [0.018, -0.056, 0.13], [-0.012, -0.054, 0.13], 0.012);
  finger(L.glove, [[-0.017, -0.052, 0.124], [-0.0255, -0.047, 0.096], [-0.0255, -0.045, 0.07]], 0.0108, 0.001);
  forearm(L.glove, L.sleeve, L.plate, [0.031, -0.108, 0.148], [0.085, -0.3, 0.5], [-0.6, 0.7, 0.2]);
  // left hand: the palm under the guard, the fingers up its far side, the thumb forward along the near side
  put(L.lGlove, RB(0.054, 0.027, 0.09, 0.012), [-0.036, -0.03, -0.302], [0, 0, -0.5]);
  for (const [i, z] of [-0.3345, -0.313, -0.2915, -0.27].entries()) {
    const up = [0.016, 0.018, 0.014, 0.006][i];
    finger(L.lGlove, [[-0.016, -0.0345, z], [0.019, -0.0355, z], [0.0345, -0.013, z], [0.0335, up, z - 0.002]]);
  }
  seg(L.lGlove, [-0.054, -0.02, -0.288], [-0.047, -0.019, -0.324], 0.0145);
  finger(L.lGlove, [[-0.047, -0.019, -0.324], [-0.039, -0.003, -0.346], [-0.0355, 0.006, -0.367]], 0.0112, 0.0012);
  forearm(L.lGlove, L.lSleeve, L.lPlate, [-0.064, -0.022, -0.292], [-0.3, -0.19, 0.0], [-0.2, 0.9, 0.35]);
  fuse(L.glove, glove, hands); fuse(L.sleeve, sleeve, hands); fuse(L.plate, body, hands);
  fuse(L.lGlove, glove, left); fuse(L.lSleeve, sleeve, left); fuse(L.lPlate, body, left);
  gun.scale.setScalar(0.92);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.006, -0.7); gun.add(muzzle);
  // the muzzle light: one clustered lamp, dark between shots
  const flash = new THREE.PointLight(0xffb060, 0, 9, 2); root.add(flash);
  world.lighting?.addLight(flash);
  const flashGain = 14;
  // a small fill light that travels with the gun, so it reads against a dark street
  const fill = new THREE.PointLight(0x9fd8ff, 0, 1.4, 2); root.add(fill);
  world.lighting?.addLight(fill);

  const S = {
    mag: GUN.mag, reserve: GUN.reserve, cool: 0, heat: 0, reloading: 0, ads: 0, kick: 0, kickRot: 0, debt: 0, flashT: 0, bob: 0, swayX: 0, swayY: 0, tuck: 0, sprint: 0, draw: 1,
    fire: false, aim: false, wantReload: false, lastYaw: 0, lastPitch: 0, walked: 0, fov: GUN.fov, lean: 0, wantLean: 0, jab: 0,
  };
  let play = null, rnd = 0x1234567;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const applied = new THREE.Vector3(1e9, 0, 0);
  const fwd = new THREE.Vector3(), from = new THREE.Vector3(), mz = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function reload() {
    if (S.reloading > 0 || S.mag >= GUN.mag || S.reserve <= 0) return false;
    S.reloading = GUN.reload; sfx.play('nd_reload', { gain: 0.7 });
    return true;
  }
  function shoot() {
    S.mag--; S.cool = GUN.rate; stats.shots++;
    // where the round goes: the view direction, opened by the spread (tighter when aiming, wider when hot or moving)
    const spread = ((0.008 - 0.0055 * S.ads) + S.heat * 0.012 * (1 - 0.55 * S.ads) + Math.min(player.speed, 5) * 0.002) * (1 - 0.3 * player.crouch);
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spread;
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    right.crossVectors(fwd, up).normalize(); const upv = new THREE.Vector3().crossVectors(right, fwd);
    fwd.addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
    from.copy(camera.position);
    const o = from.toArray(), d = fwd.toArray();
    // the world (Rapier, with the normal for the sparks), then whoever stands in front of it
    const hit = physics.world.castRayAndGetNormal(new physics.R.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), 120, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider());
    const wt = hit ? hit.timeOfImpact ?? hit.toi : 120;
    const eh = targets.rayHit(o, d, wt);
    const t = eh ? eh.t : wt, end = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    muzzle.getWorldPosition(mz);
    vfx.beam({ from: mz.toArray(), to: end, width: 0.022, color: '#ffd9a0', intensity: 4, life: 0.055 });
    vfx.burst(FX.muzzle, mz, { direction: d, scale: 1 - 0.65 * S.ads });   // smaller down the sight: it sits in the middle of the view
    if (eh) {
      stats.lastHead = !!eh.head;
      const killed = eh.owner.damage(eh.e, GUN.damage, eh.head, eh.point, d);
      stats.hits++; if (eh.head) stats.heads++;
      hud.hit(killed ? 'kill' : eh.head ? 'head' : 'hit');
      sfx.play(killed ? 'nd_kill' : 'nd_hit', { gain: killed ? 0.8 : 0.55 });
    } else if (hit) {
      const n = hit.normal;
      vfx.burst(FX.impact, end, { direction: [n.x, n.y, n.z] });
      vfx.decal({ position: [end[0] + n.x * 0.02, end[1] + n.y * 0.02, end[2] + n.z * 0.02], normal: [n.x, n.y, n.z], size: 0.16 + R() * 0.08, depth: 0.2, pattern: 'scorch', life: 25, fade: 4, opacity: 0.85 });
      if (R() < 0.6) sfx.play('nd_impact', { at: end, gain: 0.5, ref: 3 });
    }
    sfx.play('nd_shot', { gain: 0.6, rate: 0.96 + R() * 0.08 });
    targets.noise(player.feet, 26);
    // recoil: the view climbs and wanders; most of the climb comes back (S.debt)
    const k = 1 - 0.4 * S.ads, climb = (0.0085 + 0.004 * Math.min(S.heat, 1)) * k, drift = (R() - 0.5) * 0.007 * k;
    play.pitch = Math.min(1.45, play.pitch + climb); play.yaw += drift; S.debt += climb * 0.85;
    S.kick = Math.min(1.6, S.kick + 1); S.heat = Math.min(1.4, S.heat + 0.16); S.flashT = 0.05;
    player.shake(0.25);
  }

  /** a strike with the stock: whoever is within arm's reach in front, hard; 0.6 s before the next */
  function melee() {
    if (S.jab > 0 || S.reloading > 0 || !play) return false;
    S.jab = 0.6; S.cool = Math.max(S.cool, 0.45);
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    const o = camera.position.toArray(), d = fwd.toArray(), eh = targets.rayHit(o, d, 2.3);
    sfx.play('nd_impact', { gain: eh ? 0.9 : 0.35, rate: 0.5 });
    if (eh) { stats.lastHead = false; const killed = eh.owner.damage(eh.e, 85, false, eh.point, d); hud.hit(killed ? 'kill' : 'hit'); player.shake(0.5); stats.melee = (stats.melee || 0) + 1; }
    return true;
  }
  /** one fixed step of the game */
  function update(dt, alive) {
    S.cool -= dt; S.heat = Math.max(0, S.heat - dt * 1.3);
    if (S.debt > 0) { const b = Math.min(S.debt, dt * 0.09 + S.debt * dt * 5); play.pitch -= b; S.debt -= b; }
    if (S.reloading > 0) {
      S.reloading -= dt;
      if (S.reloading <= 0) { const n = Math.min(GUN.mag - S.mag, S.reserve); S.mag += n; S.reserve -= n; S.reloading = 0; onReload?.(); }
    }
    if (alive) {
      if (S.wantReload) { reload(); S.wantReload = false; }
      if (S.fire && S.reloading <= 0 && S.cool <= 0 && S.draw <= 0) {
        if (S.mag > 0) shoot();
        else { S.cool = 0.3; if (!reload()) sfx.play('nd_dry', { gain: 0.6 }); }
      }
    }
    const wantAds = alive && S.aim && S.reloading <= 0 ? 1 : 0;
    S.ads += (wantAds - S.ads) * Math.min(1, dt * 12);
    S.kick = Math.max(0, S.kick - dt * 9); S.flashT -= dt; S.jab = Math.max(0, S.jab - dt);
    S.draw = Math.max(0, S.draw - dt * 1.6);
    const sprinting = player.speed > 4.4 && !S.fire && !S.aim && S.reloading <= 0 ? 1 : 0;
    S.sprint += (sprinting - S.sprint) * Math.min(1, dt * 8);
    S.walked += player.speed * dt;
    return S.jab > 0 || S.kick > 0.001 || S.flashT > 0 || S.reloading > 0 || Math.abs(wantAds - S.ads) > 0.001;
  }

  /** before every sub-frame: put the view model on the camera and set the lens */
  function pose(dt) {
    if (!play) return;
    // the lens: aiming narrows it (after play wrote its own field of view for the frame)
    const fov = S.fov + (S.fov * (GUN.adsFov / GUN.fov) - S.fov) * S.ads;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // crouching and leaning move the eye: play writes the camera every frame, so the offset goes on once per frame
    // (a frame's later sub-frames find the camera where this left it)
    S.lean += (S.wantLean - S.lean) * Math.min(1, dt * 9);
    if (!camera.position.equals(applied) && (player.crouch > 0.001 || Math.abs(S.lean) > 0.001)) {
      right.set(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      // a lean stops short of a wall
      const side = physics.ray(camera.position.toArray(), right.clone().multiplyScalar(Math.sign(S.lean) || 1).toArray(), 0.7, player.collider());
      const reach = Math.min(0.42, side ? Math.max(0, side.distance - 0.22) : 0.42);
      camera.position.addScaledVector(right, S.lean * reach); camera.position.y -= player.crouch * 0.6;
      camera.rotateZ(-S.lean * 0.13); camera.updateMatrixWorld();
      applied.copy(camera.position);
    }
    holder.position.copy(camera.position); holder.quaternion.copy(camera.quaternion);
    // sway: the gun lags behind the view's turn, bobs with the walk
    const dy = play.yaw - S.lastYaw, dp = play.pitch - S.lastPitch; S.lastYaw = play.yaw; S.lastPitch = play.pitch;
    const k = Math.min(1, dt * 10);
    S.swayX += (THREE.MathUtils.clamp(-dy * 1.2, -0.05, 0.05) - S.swayX) * k; S.swayY += (THREE.MathUtils.clamp(dp * 1.2, -0.05, 0.05) - S.swayY) * k;
    const bobK = Math.min(player.speed / 3.4, 1.4) * (1 - 0.85 * S.ads), ph = S.walked * 2.3;
    const bx = Math.sin(ph) * 0.006 * bobK, by = -Math.abs(Math.cos(ph)) * 0.007 * bobK;
    // near a wall the gun comes back so the barrel does not go through it
    const ahead = physics.ray(camera.position.toArray(), camera.getWorldDirection(fwd).toArray(), 1.2, player.collider());
    const tuck = ahead ? THREE.MathUtils.clamp((0.95 - ahead.distance) / 0.6, 0, 1) : 0;
    S.tuck += (tuck - S.tuck) * Math.min(1, dt * 12);
    // the reload: tilt, magazine out and back, level again
    let tilt = 0, magOut = 0;
    if (S.reloading > 0) { const u = 1 - S.reloading / GUN.reload; tilt = THREE.MathUtils.smoothstep(u, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1)); magOut = THREE.MathUtils.smoothstep(u, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(u, 0.5, 0.68)); }
    const a = S.ads, low = Math.max(S.sprint, S.draw), jab = S.jab > 0 ? Math.sin(Math.PI * Math.min(1, (0.6 - S.jab) / 0.32)) * (S.jab > 0.28 ? 1 : 0) : 0;
    gun.position.set(THREE.MathUtils.lerp(0.17, 0, a) + bx + S.swayX * 0.6 + tilt * 0.03, THREE.MathUtils.lerp(-0.17, -0.0704, a) + by + S.swayY * 0.4 - tilt * 0.05 - low * 0.11 - S.tuck * 0.03,
      THREE.MathUtils.lerp(-0.28, -0.12, a) + S.kick * 0.022 * (1 - 0.5 * a) + S.tuck * 0.2 - jab * 0.22);
    gun.rotation.set(S.kick * 0.03 * (1 - 0.6 * a) + S.swayY + tilt * 0.35 - low * 0.5 + S.tuck * 0.5 + jab * 0.25, S.swayX + tilt * 0.3 + low * 0.45 + (1 - a) * 0.03 + jab * 0.9, -tilt * 0.6 + S.swayX * 1.5 + low * 0.2);
    magazine.position.copy(magHome); magazine.position.y -= magOut * 0.22; magazine.visible = magOut < 0.98;
    left.position.set(0, -magOut * 0.2, magOut * 0.2);
    dot.visible = a > 0.5;
    holder.updateMatrixWorld(true);
    muzzle.getWorldPosition(mz);
    fill.position.copy(holder.position).addScaledVector(fwd.set(0.25, 0.12, -0.25).applyQuaternion(holder.quaternion), 1);
    flash.position.copy(mz); const room = Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);   // these two do not go out by day
    fill.intensity = 0.16 * room;
    flash.intensity = S.flashT > 0 ? flashGain * room * (0.6 + 0.4 * R()) * (1 - 0.6 * S.ads) : 0;
  }
  let last = -1;
  const off = world.ctx.onUpdate((t) => { const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, t - last)); last = t; pose(dt); });

  return {
    S, holder, reload, update, melee,
    start(p) { play = p; S.lastYaw = p.yaw; S.lastPitch = p.pitch; },
    give(n) { const b = S.reserve; S.reserve = Math.min(GUN.max, S.reserve + n); return S.reserve - b; },
    save: () => ({ mag: S.mag, reserve: S.reserve }),
    load(s) { S.mag = s.mag; S.reserve = s.reserve; S.reloading = 0; S.heat = 0; S.kick = 0; S.debt = 0; S.draw = 1; },
    dispose() { off(); },
  };
}

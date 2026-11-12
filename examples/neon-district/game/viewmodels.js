// The guns' view models, modelled in code: side silhouettes extruded across the width with chamfered edges (`side`),
// cross-sections extruded along the barrel (`sect`), lathed rounds (`lathe`), rounded boxes; the static geometry of a
// gun is merged into one mesh per material. Each builder returns { group, muzzle, port, hip, ads, sight, parts... }:
// the moving parts (a magazine, a slide, a pump, a spinning barrel cluster, the rocket in the tube) are their own
// meshes so weapon.js can animate them. Every gun points along -Z (the camera's view); metres.
// The gloved hands are modelled round the carbine (the right hand on its grip, the left under its guard) and moved
// onto each gun's own grip and support point (`hands`), the fingers opened or closed per gun: each finger one smooth
// tube tapering to a rounded tip (knuckle pads on the back), a palm and a back of the hand, a cuff; dark leather
// gloves and a nylon sleeve. Materials are the surface library's (object space: the pattern rides on the gun).
import * as THREE from 'three';
import { SURFACES } from '@miragekit/core';
import { robotSurfaces as surfaceLib } from '@miragekit/world/kits/cyber';

const HP = Math.PI / 2, v2 = (pts) => pts.map(([a, b]) => new THREE.Vector2(a, b));

export function createModels({ world, M }) {
  const { mat } = world;
  const C = (r, g, b) => new THREE.Color(r, g, b);
  // materials: the surface library's, in the gun's own space (coatings dielectric, worn edges show the metal; a
  // little lighter than black, so the form reads by the fill light at night: weapon.js)
  const lib = surfaceLib(world), L = (spec, params) => lib.material(spec, { space: 'object', ...(params ? { params } : {}) });
  const mats = {
    body: L(SURFACES.powderCoat({ variant: 'cerakote', color: [0.075, 0.08, 0.09], edgeWear: 0.5 })),
    dark: L(SURFACES.powderCoat({ variant: 'powder', color: [0.04, 0.042, 0.048] })),
    steel: M.steel,
    poly: L(SURFACES.plastic({ variant: 'textured', color: [0.1, 0.104, 0.112] })),
    glove: L(SURFACES.leather({ variant: 'leather', color: [0.032, 0.029, 0.027], roughness: 0.55, grain: 0.0012 })),
    sleeve: L(SURFACES.fabric({ variant: 'cotton', color: [0.04, 0.045, 0.055], roughness: 0.94 }), { sheen: 0 }),   // (a full sheen read as a pale sleeve under the gun's fill light)
    olive: L(SURFACES.powderCoat({ variant: 'cerakote', color: [0.14, 0.15, 0.1] })),
    brass: L(SURFACES.metal({ metal: 'brass', variant: 'machined' })),
    hullRed: L(SURFACES.plastic({ variant: 'abs', color: [0.3, 0.03, 0.03] })),
    warhead: L(SURFACES.powderCoat({ variant: 'cerakote', color: [0.14, 0.15, 0.1] })),
  };
  const glass = mat.std({ color: C(0.35, 0.75, 0.9), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false });
  const geo = {
    ext(pts, w, b = 0.003, holes = []) {
      const s = new THREE.Shape(v2(pts)), d = w - 2 * b;
      for (const h of holes) s.holes.push(new THREE.Path(v2(h)));
      return new THREE.ExtrudeGeometry(s, { depth: d, steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1 }).translate(0, 0, -d / 2);
    },
    side: (pts, w, b, holes) => geo.ext(pts, w, b, holes).rotateY(-HP),                 // a profile in (z, y), w wide
    sect: (pts, len, b, holes) => geo.ext(pts, len, b, holes),                          // a profile in (x, y), len long
    lathe: (pts, n = 12) => new THREE.LatheGeometry(v2(pts), n).rotateX(HP),            // [radius, z] pairs, z rising
    cylX: (r, len, n = 8) => new THREE.CylinderGeometry(r, r, len, n).rotateZ(HP),
    cylZ: (r, len, n = 10, r2 = r) => new THREE.CylinderGeometry(r2, r, len, n).rotateX(HP),
    hex: (r, len) => new THREE.CylinderGeometry(r, r, len, 6).rotateZ(HP),             // a fastener's head, axis X
    RB: (w, h, d, r = 0.004) => new world.geom.RoundedBoxGeometry(w, h, d, 1, Math.min(r, 0.45 * Math.min(w, h, d))),
  };
  const { side, sect, lathe, cylX, cylZ, hex, RB } = geo;
  const part = (g, m, p, r = [0, 0, 0], parent) => { const o = new THREE.Mesh(g, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; o.userData.occlude = false; parent.add(o); return o; };
  /** a list per material; put() bakes a transform into a geometry and files it; fuse() merges a list into one mesh */
  const kit = () => {
    const L = {};
    const put = (k, g, p = [0, 0, 0], r = [0, 0, 0], basis = null) => {
      const x = g.index ? g.toNonIndexed() : g;
      x.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1)));
      if (basis) x.applyMatrix4(basis);
      (L[k] ||= []).push(x);
    };
    const fuse = (parent, only) => { for (const [k, list] of Object.entries(L)) if (list.length && (!only || only.includes(k))) { part(world.geom.mergeGeometries(list, false), mats[k], [0, 0, 0], [0, 0, 0], parent); L[k] = []; } };
    return { L, put, fuse };
  };

  // ---- the hands: modelled round the carbine's grip (G0) and guard (L0), then moved onto each gun's ----------------
  const G0 = new THREE.Vector3(0.0, -0.09, 0.1), L0 = new THREE.Vector3(0, -0.03, -0.3);
  function handGeo(right, open = 0) {
    const k = kit(), { put } = k, glove = 'glove', sleeve = 'sleeve', plate = 'body';
    // a finger: one tube through its joints, tapering to a rounded tip; `open` straightens it toward its first
    // segment's line (0 as modelled round the carbine, 1 straight)
    const finger = (pts, r0 = 0.0086, taper = 0.0006) => {
      let P = pts.map((p) => new THREE.Vector3(...p));
      if (open) { const d0 = P[1].clone().sub(P[0]).normalize(); let acc = 0; P = P.map((p, i) => { if (i) acc += pts[i - 1] ? new THREE.Vector3(...pts[i]).distanceTo(new THREE.Vector3(...pts[i - 1])) : 0; return p.clone().lerp(P[0].clone().addScaledVector(d0, acc), open); }); }
      const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal'), n = 10, rad = 7;
      const g = new THREE.TubeGeometry(curve, n, r0, rad, false), pos = g.attributes.position, c = new THREE.Vector3();
      for (let i = 0; i <= n; i++) {   // taper ring by ring toward the tip, a slight flattening across the nail
        curve.getPointAt(i / n, c); const f = 1 - (taper / r0) * (P.length - 1) * (i / n);
        for (let j = 0; j <= rad; j++) { const q = i * (rad + 1) + j; pos.setXYZ(q, c.x + (pos.getX(q) - c.x) * f, c.y + (pos.getY(q) - c.y) * f * 0.88, c.z + (pos.getZ(q) - c.z) * f); }
      }
      g.computeVertexNormals();
      (k.L[glove] ||= []).push(g.toNonIndexed());
      const tip = P.at(-1), rt = r0 * (1 - (taper / r0) * (P.length - 1));
      put(glove, new THREE.SphereGeometry(rt, 7, 5), tip.toArray());
      put(glove, new THREE.SphereGeometry(r0 * 1.08, 7, 5).scale(1, 0.85, 1), P[0].toArray());   // the knuckle
    };
    const seg = (a, b, r) => finger([a, b], r, 0);
    // a forearm from the wrist toward the elbow: a glove cuff with a strap, a sleeve with folds, a plate on the side facing `out`
    const forearm = (wrist, elbow, out) => {
      const o = new THREE.Vector3(...out), y = new THREE.Vector3(...elbow).sub(new THREE.Vector3(...wrist)).normalize(), z = o.addScaledVector(y, -y.dot(o)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
      const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(...wrist);
      put(glove, new THREE.LatheGeometry(v2([[0.0235, -0.012], [0.025, 0.004], [0.027, 0.03], [0.03, 0.052], [0.031, 0.058], [0.029, 0.061]]), 14), [0, 0, 0], [0, 0, 0], m);
      put(plate, new THREE.TorusGeometry(0.0282, 0.0034, 5, 16).rotateX(HP), [0, 0.022, 0], [0, 0, 0], m);
      put(sleeve, new THREE.LatheGeometry(v2([[0.026, 0.045], [0.033, 0.066], [0.036, 0.092], [0.0315, 0.106], [0.039, 0.124], [0.04, 0.16], [0.035, 0.176], [0.043, 0.196], [0.045, 0.255], [0.041, 0.272], [0.049, 0.294], [0.052, 0.44]]), 14), [0, 0, 0], [0, 0, 0], m);
      put(plate, sect([[-0.02, -0.065], [0.02, -0.065], [0.024, -0.046], [0.018, 0.065], [-0.018, 0.065], [-0.024, -0.046]], 0.008, 0.003), [0, 0.155, 0.041], [0.05, 0, 0], m);
    };
    if (right) {   // the back of the hand on the grip's right, three fingers round its front, the index on the trigger, the thumb over the top
      put(glove, RB(0.026, 0.08, 0.07, 0.012), [0.029, -0.09, 0.106], [-0.43, 0, 0]);
      put(glove, RB(0.012, 0.07, 0.06, 0.005), [0.014, -0.088, 0.104], [-0.43, 0, 0]);   // the palm's heel against the grip
      for (const [i, y] of [-0.079, -0.099, -0.118].entries()) {
        const zf = 0.05 + (-0.06 - y) * 0.465;
        finger([[0.026, y, zf + 0.016], [0.019, y - 0.001, zf - 0.009], [-0.006, y - 0.002, zf - 0.0115], [-0.0235, y - 0.002, zf + 0.004 + i * 0.001]], 0.0084 - i * 0.0004);
      }
      finger([[0.025, -0.058, 0.072], [0.018, -0.058, 0.047], [0.004, -0.059, 0.03], [-0.009, -0.059, 0.031]], 0.0082);
      seg([0.017, -0.056, 0.128], [-0.011, -0.054, 0.128], 0.0105);
      finger([[-0.016, -0.052, 0.122], [-0.024, -0.048, 0.096], [-0.024, -0.046, 0.072]], 0.0098, 0.0009);
      forearm([0.03, -0.106, 0.146], [0.085, -0.3, 0.5], [-0.6, 0.7, 0.2]);
    } else {   // the palm under the guard, the fingers up its far side, the thumb forward along the near side
      put(glove, RB(0.05, 0.025, 0.084, 0.011), [-0.035, -0.03, -0.302], [0, 0, -0.5]);
      for (const [i, z] of [-0.333, -0.3125, -0.292, -0.272].entries()) {
        const up = [0.015, 0.017, 0.013, 0.006][i];
        finger([[-0.016, -0.0335, z], [0.018, -0.0345, z], [0.033, -0.013, z], [0.032, up, z - 0.002]], 0.0084 - (i === 3 ? 0.0012 : 0), 0.0006);
      }
      seg([-0.052, -0.02, -0.288], [-0.046, -0.019, -0.322], 0.013);
      finger([[-0.046, -0.019, -0.322], [-0.039, -0.004, -0.344], [-0.0355, 0.005, -0.364]], 0.0102, 0.001);
      forearm([-0.062, -0.022, -0.292], [-0.3, -0.19, 0.0], [-0.2, 0.9, 0.35]);
    }
    return k.L;
  }
  const handCache = new Map(), handOf = (right, open) => { const key = right + ':' + open; if (!handCache.has(key)) handCache.set(key, handGeo(right, open)); return handCache.get(key); };
  /** the hands onto a gun: right at its grip (rotated by rr), left at its support (rotated by lr); left: the group that
   *  carries the left hand (a pump moves it); open: [right, left] fingers opened (0 round a carbine-sized grip) */
  function hands(parent, { grip, gripRot = [0, 0, 0], support, supportRot = [0, 0, 0], leftParent = parent, leftOrigin = [0, 0, 0], open = [0, 0] }) {
    const place = (lists, at, rot, from, origin, to) => {
      const m = new THREE.Matrix4().makeTranslation(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2])
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot))).multiply(new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z));
      for (const [k, list] of Object.entries(lists)) { if (!list.length) continue; const g = world.geom.mergeGeometries(list.map((x) => x.clone()), false); g.applyMatrix4(m); part(g, mats[k], [0, 0, 0], [0, 0, 0], to); }
    };
    const R = new THREE.Group(); parent.add(R);
    place(handOf(true, open[0]), grip, gripRot, G0, [0, 0, 0], R);
    const Lg = new THREE.Group(); leftParent.add(Lg);
    place(handOf(false, open[1]), support, supportRot, L0, leftOrigin, Lg);
    return { right: R, left: Lg };
  }
  const glowDot = () => mat.glow([1, 0.1, 0.05], 12);

  // ---- the carbine (the K-7: the game's first gun, kept as it was modelled) ---------------------------------------
  function carbine() {
    const gun = new THREE.Group(), { put, fuse } = kit();
    put('body', side([[0.13, -0.004], [0.13, 0.026], [0.118, 0.04], [-0.17, 0.04], [-0.17, -0.004]], 0.046, 0.007));
    put('dark', side([[0.13, -0.004], [0.13, -0.026], [0.11, -0.04], [-0.018, -0.04], [-0.022, -0.066], [-0.1, -0.074], [-0.108, -0.036], [-0.17, -0.026], [-0.17, -0.004]], 0.044, 0.004));
    put('body', side([[0.1, 0.004], [0.1, 0.022], [0.086, 0.031], [-0.02, 0.031], [-0.034, 0.02], [-0.034, 0.004]], 0.004, 0.0015), [-0.0235, 0, 0]);
    put('body', side([[0.1, 0.004], [0.1, 0.031], [0.03, 0.031], [0.03, 0.004]], 0.004, 0.0015), [0.0235, 0, 0]);
    put('dark', side([[-0.108, -0.03], [-0.03, -0.03], [-0.026, -0.058], [-0.1, -0.064]], 0.048, 0.002));
    for (const z of [0.105, -0.14]) put('steel', cylX(0.0036, 0.047), [0, -0.018, z]);
    put('steel', cylX(0.0055, 0.004, 10), [-0.0238, -0.02, 0.066]); put('steel', new THREE.BoxGeometry(0.003, 0.0045, 0.022), [-0.0262, -0.017, 0.056], [0.35, 0, 0]);
    put('steel', new THREE.BoxGeometry(0.003, 0.018, 0.009), [-0.0232, -0.015, -0.05]);
    put('steel', cylX(0.005, 0.005, 8), [0.0238, -0.022, -0.008]);
    put('dark', new THREE.BoxGeometry(0.001, 0.007, 0.11), [-0.0232, 0.019, -0.105]);
    put('body', new THREE.BoxGeometry(0.006, 0.013, 0.016), [-0.0255, 0.019, -0.075]);
    put('steel', cylX(0.0048, 0.02, 8), [-0.036, 0.019, -0.075]);
    for (const x of [-0.031, -0.036, -0.041]) put('dark', cylX(0.0054, 0.0018, 8), [x, 0.019, -0.075]);
    put('dark', new THREE.BoxGeometry(0.001, 0.017, 0.064), [0.0232, 0.018, -0.07]);
    put('steel', new THREE.BoxGeometry(0.001, 0.011, 0.054), [0.0236, 0.018, -0.07]);
    put('body', new THREE.BoxGeometry(0.003, 0.016, 0.066), [0.027, 0.002, -0.07], [0, 0, -0.6]);
    put('body', side([[-0.018, 0.008], [-0.018, 0.03], [-0.034, 0.019]], 0.008, 0.002), [0.025, 0, 0]);
    const slot = (z, y, len, h) => [[z - len / 2 + h / 2, y - h / 2], [z + len / 2 - h / 2, y - h / 2], [z + len / 2, y], [z + len / 2 - h / 2, y + h / 2], [z - len / 2 + h / 2, y + h / 2], [z - len / 2, y]];
    put('poly', side([[-0.172, -0.024], [-0.172, 0.04], [-0.5, 0.04], [-0.5, 0.01], [-0.468, -0.024]], 0.044, 0.008, [0, 1, 2, 3, 4].map((i) => slot(-0.216 - i * 0.056, 0.019, 0.042, 0.011))));
    for (let i = 0; i < 20; i++) put('dark', new THREE.BoxGeometry(0.048, 0.011, 0.0055), [0, -0.0125, -0.2 - i * 0.0135]);
    put('dark', sect([[-0.024, -0.02], [-0.024, 0.034], [-0.017, 0.043], [0.017, 0.043], [0.024, 0.034], [0.024, -0.02], [0.017, -0.027], [-0.017, -0.027]], 0.012, 0.002), [0, 0, -0.178]);
    for (const s of [-1, 1]) part(RB(0.003, 0.006, 0.25, 0), M.neon.cyan, [s * 0.0212, 0.001, -0.32], [0, 0, 0], gun);
    put('steel', cylZ(0.009, 0.46), [0, 0.008, -0.395]);
    put('steel', cylZ(0.0038, 0.34, 6), [0, 0.0255, -0.345]);
    put('dark', cylZ(0.0145, 0.03, 8), [0, 0.008, -0.53]); put('dark', new THREE.BoxGeometry(0.012, 0.016, 0.022), [0, 0.022, -0.526]);
    put('dark', lathe([[0.0062, -0.69], [0.0125, -0.698], [0.0168, -0.694], [0.0168, -0.685], [0.0112, -0.683], [0.0112, -0.675], [0.0168, -0.673], [0.0168, -0.664], [0.0112, -0.662], [0.0112, -0.654], [0.0168, -0.652],
      [0.0168, -0.638], [0.0132, -0.632], [0.0132, -0.617], [0.0098, -0.613]]), [0, 0.008, 0]);
    const rail = [[0.1, 0.039]];
    for (let z = 0.098; z > -0.485; z -= 0.0155) rail.push([z, 0.0515], [z - 0.009, 0.0515], [z - 0.009, 0.0452], [z - 0.0155, 0.0452]);
    rail.push([rail[rail.length - 1][0], 0.039]);
    put('dark', side(rail, 0.022, 0.002));
    put('dark', side([[-0.03, 0.046], [-0.03, 0.055], [-0.038, 0.06], [-0.1, 0.06], [-0.108, 0.055], [-0.108, 0.046]], 0.036, 0.003));
    for (const s of [-1, 1]) put('body', side([[-0.046, 0.058], [-0.06, 0.1], [-0.094, 0.1], [-0.094, 0.058]], 0.0045, 0.0015), [s * 0.0188, 0, 0]);
    put('body', sect([[-0.021, 0.097], [-0.021, 0.1], [-0.016, 0.104], [0.016, 0.104], [0.021, 0.1], [0.021, 0.097]], 0.036, 0.0015), [0, 0, -0.077]);
    put('steel', cylX(0.007, 0.008, 8), [-0.0215, 0.055, -0.07]); put('dark', cylX(0.008, 0.007, 10), [0.0215, 0.072, -0.076]);
    for (const s of [-1, 1]) put('steel', hex(0.0026, 0.002), [s * 0.0212, 0.07, -0.086]);
    part(new THREE.BoxGeometry(0.034, 0.034, 0.0015), glass, [0, 0.0805, -0.089], [-0.08, 0, 0], gun);
    const dot = part(new THREE.SphereGeometry(0.0018, 8, 6), glowDot(), [0, 0.0765, -0.07], [0, 0, 0], gun);
    put('poly', side([[0.128, 0.03], [0.2, 0.03], [0.214, 0.041], [0.312, 0.041], [0.326, 0.03], [0.344, 0.03], [0.344, -0.082], [0.326, -0.082], [0.2, -0.032], [0.128, -0.026]], 0.036, 0.006,
      [[[0.216, -0.016], [0.314, -0.054], [0.314, 0.012], [0.216, 0.012]]]));
    put('dark', side([[0.21, 0.036], [0.222, 0.047], [0.302, 0.047], [0.314, 0.036]], 0.041, 0.004));
    put('dark', RB(0.042, 0.122, 0.018, 0.006), [0, -0.026, 0.352]);
    put('poly', side([[0.048, -0.038], [0.104, -0.038], [0.119, -0.03], [0.123, -0.05], [0.113, -0.07], [0.139, -0.14], [0.09, -0.147], [0.062, -0.076], [0.05, -0.06]], 0.03, 0.007));
    put('dark', side([[-0.02, -0.04], [0.05, -0.04], [0.059, -0.07], [0.047, -0.079], [-0.014, -0.079], [-0.02, -0.07]], 0.012, 0.0015,
      [[[-0.0125, -0.0445], [0.046, -0.0445], [0.051, -0.068], [0.044, -0.074], [-0.0105, -0.074], [-0.0145, -0.066]]]));
    put('steel', side([[0.012, -0.04], [0.02, -0.04], [0.016, -0.055], [0.008, -0.066], [0.004, -0.064], [0.011, -0.054]], 0.006, 0.001));
    for (const s of [-1, 1]) {
      for (const [z, y] of [[-0.186, 0.02], [-0.186, -0.006], [-0.482, 0.022]]) put('steel', hex(0.003, 0.002), [s * 0.0225, y, z]);
      put('steel', hex(0.003, 0.002), [s * 0.0185, 0, 0.15]); put('steel', hex(0.0032, 0.002), [s * 0.0155, -0.1, 0.096]);
    }
    fuse(gun);
    const magParts = [side([[-0.028, 0.066], [0.028, 0.066], [0.029, 0], [0.026, -0.06], [-0.03, -0.06], [-0.029, 0]], 0.026, 0.003)];
    for (const z of [-0.015, 0, 0.015]) magParts.push(new THREE.BoxGeometry(0.0285, 0.098, 0.006).translate(0, -0.008, z).toNonIndexed());
    const magazine = part(world.geom.mergeGeometries(magParts, false), mats.body, [0, -0.1, -0.06], [0.14, 0, 0], gun); magazine.name = 'magazine';
    part(side([[-0.034, -0.058], [0.03, -0.058], [0.032, -0.066], [0.03, -0.075], [-0.034, -0.075], [-0.037, -0.066]], 0.032, 0.003), mats.poly, [0, 0, 0], [0, 0, 0], magazine);
    const h = hands(gun, { grip: G0.toArray(), support: L0.toArray() });
    return { group: gun, scale: 0.92, dot, magazine, magHome: magazine.position.clone(), left: h.left, muzzle: [0, 0.006, -0.7], port: [0.03, 0.018, -0.07], hip: [0.17, -0.17, -0.28], ads: [0, -0.0704, -0.12] };
  }

  // ---- the sidearm: a polymer-framed pistol with a steel slide, a red dot on the slide, held in both hands ---------
  function pistol() {
    const gun = new THREE.Group(), { put, fuse } = kit();
    const slideG = new THREE.Group(); gun.add(slideG);
    const sk = kit();
    // the slide: a chamfered top, cocking serrations at the back, an ejection port on the right, sights, a lit strip
    sk.put('body', side([[0.055, 0.0], [0.055, 0.026], [0.046, 0.033], [-0.118, 0.033], [-0.126, 0.026], [-0.128, 0.004], [-0.122, 0.0]], 0.026, 0.004));
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) sk.put('dark', new THREE.BoxGeometry(0.002, 0.018, 0.0028), [s * 0.0131, 0.016, 0.044 - i * 0.0055]);
    sk.put('dark', new THREE.BoxGeometry(0.001, 0.012, 0.036), [0.0131, 0.021, -0.02]);
    sk.put('steel', new THREE.BoxGeometry(0.001, 0.008, 0.03), [0.0134, 0.021, -0.02]);
    sk.put('dark', side([[-0.112, 0.033], [-0.112, 0.041], [-0.118, 0.041], [-0.12, 0.033]], 0.004, 0.0008));
    sk.put('dark', side([[0.04, 0.033], [0.04, 0.042], [0.05, 0.042], [0.052, 0.033]], 0.02, 0.0015, [[[0.043, 0.036], [0.049, 0.036], [0.049, 0.043], [0.043, 0.043]]]));
    // a micro red-dot on the slide (the dot is lit only down the sight)
    sk.put('dark', side([[-0.002, 0.033], [-0.002, 0.04], [-0.006, 0.054], [-0.032, 0.054], [-0.038, 0.04], [-0.038, 0.033]], 0.024, 0.003, [[[-0.008, 0.038], [-0.03, 0.038], [-0.03, 0.05], [-0.01, 0.05]]]));
    sk.fuse(slideG);
    part(new THREE.BoxGeometry(0.018, 0.012, 0.001), glass, [0, 0.044, -0.02], [0, 0, 0], slideG);
    const dot = part(new THREE.SphereGeometry(0.0012, 8, 6), glowDot(), [0, 0.0445, -0.004], [0, 0, 0], slideG);
    for (const s of [-1, 1]) part(RB(0.0016, 0.0035, 0.07, 0), M.neon.cyan, [s * 0.0133, 0.006, -0.07], [0, 0, 0], slideG);
    put('steel', cylZ(0.0062, 0.03, 10), [0, 0.016, -0.128]);
    put('dark', lathe([[0.0048, -0.145], [0.0068, -0.142], [0.0068, -0.128]], 10), [0, 0.016, 0]);
    // the frame: a dust cover with a rail, the trigger guard, the grip raked back with a texture and a beavertail
    put('poly', side([[0.05, 0.0], [0.05, -0.012], [0.03, -0.016], [-0.02, -0.016], [-0.04, -0.012], [-0.122, -0.012], [-0.122, 0.0]], 0.024, 0.003));
    for (let i = 0; i < 3; i++) put('dark', new THREE.BoxGeometry(0.02, 0.004, 0.006), [0, -0.0145, -0.07 - i * 0.016]);
    put('poly', side([[0.0, -0.016], [-0.042, -0.016], [-0.05, -0.024], [-0.048, -0.046], [-0.04, -0.05], [0.01, -0.05], [0.014, -0.04]], 0.012, 0.002, [[[-0.004, -0.02], [-0.04, -0.02], [-0.044, -0.026], [-0.042, -0.043], [-0.036, -0.046], [0.006, -0.046], [0.008, -0.035]]]));
    put('poly', side([[0.05, -0.012], [0.068, -0.006], [0.072, -0.014], [0.062, -0.022], [0.082, -0.11], [0.074, -0.122], [0.034, -0.122], [0.024, -0.112], [0.014, -0.05], [0.012, -0.016]], 0.03, 0.006));
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) put('dark', RB(0.002, 0.012, 0.03, 0.001), [s * 0.0151, -0.04 - i * 0.015, 0.045 + i * 0.0035], [0.2, 0, 0]);
    put('steel', side([[-0.008, -0.016], [-0.002, -0.016], [-0.006, -0.03], [-0.014, -0.038], [-0.016, -0.034], [-0.01, -0.028]], 0.005, 0.001));
    put('steel', cylX(0.004, 0.028, 8), [0, -0.006, 0.0]); put('steel', cylX(0.0035, 0.028, 8), [0, -0.006, -0.06]);
    put('steel', side([[0.054, 0.012], [0.062, 0.016], [0.066, 0.008], [0.058, 0.004]], 0.008, 0.001));   // the hammer
    fuse(gun);
    const magazine = new THREE.Group(); magazine.position.set(0, -0.06, 0.05); magazine.rotation.x = 0.2; gun.add(magazine);
    part(side([[-0.013, 0.04], [0.013, 0.04], [0.014, -0.064], [-0.016, -0.064]], 0.022, 0.002), mats.body, [0, 0, 0], [0, 0, 0], magazine);
    part(side([[-0.02, -0.062], [0.018, -0.062], [0.02, -0.07], [-0.022, -0.07]], 0.032, 0.003), mats.poly, [0, 0, 0], [0, 0, 0], magazine);
    // both hands: the right on the grip, the left wrapped under it, its forearm in from the left
    const h = hands(gun, { grip: [0.0, -0.062, 0.05], gripRot: [0.2, 0, 0], support: [-0.006, -0.118, 0.036], supportRot: [0.1, -0.15, -0.25], open: [-0.08, -0.12] });
    return { group: gun, scale: 0.95, dot, slide: slideG, magazine, magHome: magazine.position.clone(), left: h.left, muzzle: [0, 0.016, -0.15], port: [0.015, 0.021, -0.02], hip: [0.11, -0.105, -0.3], ads: [0, -0.0423, -0.25] };
  }

  // ---- the shotgun: a pump gun with a tube magazine under the barrel, a ribbed pump, a side saddle of shells -------
  function shotgun() {
    const gun = new THREE.Group(), { put, fuse } = kit();
    // receiver: a long, slab-sided block with a loading port underneath and an ejection port on the right
    put('body', side([[0.11, -0.03], [0.11, 0.02], [0.098, 0.03], [-0.13, 0.03], [-0.14, 0.02], [-0.14, -0.03], [-0.12, -0.036], [0.09, -0.036]], 0.042, 0.006));
    put('dark', new THREE.BoxGeometry(0.001, 0.02, 0.07), [0.0212, 0.008, -0.05]);
    put('steel', new THREE.BoxGeometry(0.001, 0.014, 0.06), [0.0216, 0.008, -0.05]);
    put('dark', side([[0.1, 0.03], [0.1, 0.038], [-0.14, 0.038], [-0.14, 0.03]], 0.014, 0.002));   // a rib on top
    put('steel', cylX(0.0035, 0.044), [0, -0.02, 0.08]); put('steel', cylX(0.0035, 0.044), [0, -0.02, -0.11]);
    // barrel and magazine tube, a bead at the muzzle, a clamp
    put('steel', cylZ(0.0115, 0.5, 12), [0, 0.012, -0.39]);
    put('dark', lathe([[0.0132, -0.655], [0.0132, -0.63], [0.0118, -0.62]], 12), [0, 0.012, 0]);
    put('body', cylZ(0.0108, 0.42, 12), [0, -0.017, -0.35]);
    put('dark', lathe([[0.0, -0.565], [0.009, -0.563], [0.0118, -0.556], [0.0118, -0.545]], 12), [0, -0.017, 0]);
    put('dark', sect([[-0.016, -0.03], [0.016, -0.03], [0.018, 0.0], [0.016, 0.026], [-0.016, 0.026], [-0.018, 0.0]], 0.02, 0.003), [0, 0, -0.53]);
    part(new THREE.SphereGeometry(0.0028, 8, 6), M.neon.amber, [0, 0.026, -0.64], [0, 0, 0], gun);
    // the side saddle: four shells on the left of the receiver (red hulls, brass heads)
    const shellGeo = lathe([[0.0, 0.0], [0.0105, 0.0], [0.0105, 0.012], [0.0098, 0.013], [0.0098, 0.068], [0.0, 0.068]], 10);
    put('dark', side([[0.03, -0.034], [0.03, 0.0], [-0.07, 0.0], [-0.07, -0.034]], 0.01, 0.003), [-0.025, 0, 0]);
    for (let i = 0; i < 4; i++) { put('hullRed', shellGeo.clone().scale(0.85, 0.85, 0.7).rotateX(-HP), [-0.034, -0.05, 0.02 - i * 0.024]); put('brass', new THREE.CylinderGeometry(0.0092, 0.0092, 0.01, 10), [-0.034, -0.046, 0.02 - i * 0.024]); }
    // stock with a pistol grip, a cheek riser, a thick recoil pad
    put('poly', side([[0.105, 0.028], [0.17, 0.02], [0.34, 0.03], [0.358, 0.024], [0.358, -0.09], [0.34, -0.094], [0.2, -0.046], [0.15, -0.05], [0.13, -0.068], [0.148, -0.14], [0.104, -0.148], [0.08, -0.064], [0.105, -0.032]], 0.04, 0.008,
      [[[0.21, -0.02], [0.32, -0.064], [0.32, 0.0], [0.21, 0.004]]]));
    put('dark', RB(0.046, 0.128, 0.022, 0.008), [0, -0.032, 0.368]);
    put('dark', side([[-0.0, -0.036], [0.07, -0.036], [0.078, -0.064], [0.066, -0.072], [0.006, -0.072], [-0.002, -0.064]], 0.012, 0.0015, [[[0.007, -0.04], [0.066, -0.04], [0.071, -0.062], [0.063, -0.067], [0.01, -0.067], [0.004, -0.06]]]));
    put('steel', side([[0.03, -0.036], [0.038, -0.036], [0.034, -0.05], [0.026, -0.06], [0.022, -0.058], [0.029, -0.049]], 0.006, 0.001));
    for (const s of [-1, 1]) for (const z of [-0.1, 0.06]) put('steel', hex(0.003, 0.002), [s * 0.0214, -0.02, z]);
    for (const s of [-1, 1]) part(RB(0.002, 0.004, 0.16, 0), M.neon.amber, [s * 0.0215, 0.022, -0.02], [0, 0, 0], gun);
    fuse(gun);
    // the pump: a ribbed lathe round the tube; it slides back and forward with the left hand
    const pump = new THREE.Group(); pump.position.set(0, -0.017, -0.3); gun.add(pump);
    const pk = kit(); const rib = [];
    for (let i = 0; i <= 10; i++) { const z = -0.075 + i * 0.015; rib.push([0.0235, z - 0.004], [0.0255, z], [0.0235, z + 0.004]); }
    pk.put('poly', lathe([[0.012, -0.085], [0.021, -0.082], ...rib, [0.021, 0.082], [0.012, 0.085]], 14).scale(1.05, 0.9, 1));
    pk.put('dark', cylZ(0.0026, 0.2, 6), [0.012, 0.022, 0.08]);   // the action bar
    pk.fuse(pump);
    const shell = part(shellGeo.clone(), mats.hullRed, [0, -0.032, 0.02], [HP * 0.2, 0, 0], gun); shell.visible = false;   // the shell being loaded
    const h = hands(gun, { grip: [0.0, -0.1, 0.12], gripRot: [-0.08, 0, 0], support: [0, -0.042, 0.0], supportRot: [0, 0, 0], leftParent: pump, leftOrigin: [0, -0.017, -0.3] });
    return { group: gun, scale: 0.92, pump, pumpHome: pump.position.clone(), shell, left: h.left, muzzle: [0, 0.012, -0.66], port: [0.025, 0.008, -0.05], hip: [0.15, -0.155, -0.3], ads: [0, -0.03, -0.27], dot: null };
  }

  // ---- the rocket launcher: a tube on the right shoulder, two grips under it, a ring sight, the round in its mouth -
  function rocket() {
    const gun = new THREE.Group(), { put, fuse } = kit();
    // the tube: a lathe with a flared venturi at the back, a lip at the front, a heat shield where the cheek goes
    put('olive', lathe([[0.075, 0.42], [0.06, 0.38], [0.052, 0.34], [0.052, -0.42], [0.056, -0.44], [0.056, -0.48], [0.05, -0.49]], 20));
    put('dark', lathe([[0.05, 0.43], [0.05, -0.488]], 20));   // the bore, seen from either end
    for (const z of [0.3, -0.05, -0.38]) put('dark', lathe([[0.0548, z - 0.012], [0.0565, z - 0.008], [0.0565, z + 0.008], [0.0548, z + 0.012]], 20));
    put('poly', sect([[-0.058, -0.02], [-0.06, 0.03], [-0.045, 0.058], [-0.02, 0.064], [-0.02, 0.052], [-0.04, 0.046], [-0.05, 0.026], [-0.048, -0.02]], 0.26, 0.004), [0, 0, 0.13]);   // the cheek shield (left)
    // a ring sight near the eye and a post at the front, offset left so the eye sees past the tube
    put('dark', side([[0.1, 0.05], [0.1, 0.07], [0.06, 0.07], [0.06, 0.05]], 0.01, 0.002), [-0.04, 0, 0]);
    put('dark', new THREE.TorusGeometry(0.013, 0.0022, 6, 18), [-0.04, 0.083, 0.08]);
    put('dark', side([[-0.1, 0.05], [-0.1, 0.075], [-0.115, 0.083], [-0.13, 0.075], [-0.13, 0.05]], 0.008, 0.002), [-0.04, 0, 0]);
    const dot = part(new THREE.SphereGeometry(0.0018, 8, 6), M.neon.amber, [-0.04, 0.083, -0.115], [0, 0, 0], gun);
    // the fire-control box under the tube, two grips, the trigger, a status lamp
    put('body', side([[0.12, -0.05], [0.12, -0.078], [0.1, -0.088], [-0.12, -0.088], [-0.13, -0.074], [-0.13, -0.05]], 0.05, 0.006));
    put('poly', side([[0.06, -0.086], [0.098, -0.086], [0.108, -0.1], [0.122, -0.18], [0.084, -0.186], [0.064, -0.11]], 0.032, 0.007));
    put('poly', side([[-0.17, -0.054], [-0.13, -0.054], [-0.128, -0.07], [-0.13, -0.17], [-0.162, -0.172], [-0.168, -0.08]], 0.034, 0.007));
    put('dark', side([[0.02, -0.088], [0.064, -0.088], [0.07, -0.11], [0.06, -0.118], [0.024, -0.118], [0.018, -0.108]], 0.012, 0.0015, [[[0.026, -0.092], [0.06, -0.092], [0.064, -0.108], [0.056, -0.113], [0.028, -0.113], [0.024, -0.104]]]));
    put('steel', side([[0.04, -0.088], [0.047, -0.088], [0.044, -0.1], [0.037, -0.108], [0.033, -0.106], [0.039, -0.099]], 0.006, 0.001));
    for (const s of [-1, 1]) for (const z of [-0.1, 0.0, 0.1]) put('steel', hex(0.003, 0.002), [s * 0.026, -0.068, z]);
    for (const z of [0.2, -0.25]) put('dark', lathe([[0.0565, z - 0.02], [0.06, z - 0.016], [0.06, z + 0.016], [0.0565, z + 0.02]], 20));   // the straps' clamps
    fuse(gun);
    const lamp = part(RB(0.012, 0.004, 0.03, 0.001), M.neon.amber, [0.026, -0.064, -0.06], [0, 0, 0], gun);
    // the round, its warhead out of the mouth: a cone with a red band and a fuse tip
    const round = new THREE.Group(); round.position.set(0, 0, -0.47); gun.add(round);
    const rk = kit();
    rk.put('warhead', lathe([[0.0, -0.2], [0.006, -0.198], [0.012, -0.19], [0.03, -0.15], [0.046, -0.09], [0.048, -0.04], [0.048, 0.0], [0.04, 0.04]], 18));
    rk.put('hullRed', lathe([[0.0485, -0.07], [0.0485, -0.05]], 18));
    rk.put('steel', lathe([[0.0, -0.212], [0.004, -0.211], [0.006, -0.198]], 10));
    rk.fuse(round);
    const h = hands(gun, { grip: [0.0, -0.12, 0.09], gripRot: [0.05, 0, 0], support: [0, -0.1, -0.15], supportRot: [0, 0, 0] });
    return { group: gun, scale: 0.9, dot: null, sightPost: dot, round, lamp, left: h.left, muzzle: [0, 0, -0.68], back: [0, 0, 0.45], hip: [0.16, -0.115, -0.25], ads: [0.036, -0.0747, -0.2], port: null };
  }

  // ---- the gatling: six barrels on a rotor, a motor housing, a drum on the left feeding through a chute ------------
  function gatling() {
    const gun = new THREE.Group(), { put, fuse } = kit();
    // housing and motor: a lathe drum with cooling fins
    const fins = []; for (let i = 0; i < 9; i++) { const z = 0.02 + i * 0.016; fins.push([0.056, z], [0.062, z + 0.004], [0.062, z + 0.009], [0.056, z + 0.013]); }
    put('body', lathe([[0.03, -0.06], [0.05, -0.058], [0.056, -0.05], [0.056, 0.02], ...fins, [0.056, 0.17], [0.046, 0.19], [0.028, 0.2]], 18));
    put('dark', lathe([[0.058, -0.03], [0.064, -0.026], [0.064, -0.006], [0.058, -0.002]], 18));
    // the rotor at the front of the housing; the barrels and their clamps spin with it (spin)
    const spin = new THREE.Group(); spin.position.set(0, 0, -0.06); gun.add(spin);
    const sk = kit();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, x = Math.cos(a) * 0.026, y = Math.sin(a) * 0.026; sk.put('steel', cylZ(0.0078, 0.56, 8), [x, y, -0.28]); sk.put('dark', lathe([[0.0032, -0.566], [0.0092, -0.562], [0.0092, -0.54]], 8), [x, y, 0]); }
    sk.put('dark', lathe([[0.012, -0.04], [0.04, -0.036], [0.04, 0.0], [0.03, 0.006]], 18));
    for (const z of [-0.22, -0.44]) sk.put('dark', lathe([[0.012, z - 0.012], [0.039, z - 0.01], [0.039, z + 0.01], [0.012, z + 0.012]], 18));
    sk.put('body', cylZ(0.009, 0.5, 8), [0, 0, -0.27]);
    sk.fuse(spin);
    const heat = mat.std({ color: new THREE.Color(0.3, 0.27, 0.25), roughness: 0.4, metalness: 1, emissive: new THREE.Color(1, 0.28, 0.05), emissiveIntensity: 0 });   // heat-blued steel (F0)
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; part(cylZ(0.0081, 0.16, 8), heat, [Math.cos(a) * 0.026, Math.sin(a) * 0.026, -0.5], [0, 0, 0], spin); }
    // the drum on the left, its chute into the housing, a carry handle on top, the rear grip and a front grip below
    put('olive', new THREE.CylinderGeometry(0.085, 0.085, 0.075, 22).rotateZ(HP), [-0.11, -0.07, 0.06]);
    put('dark', lathe([[0.0, -0.04], [0.088, -0.04], [0.088, -0.034], [0.0, -0.034]], 22).rotateY(HP), [-0.11, -0.07, 0.06]);
    put('dark', lathe([[0.0, 0.034], [0.088, 0.034], [0.088, 0.04], [0.0, 0.04]], 22).rotateY(HP), [-0.11, -0.07, 0.06]);
    put('steel', cylX(0.012, 0.09, 10), [-0.11, -0.07, 0.06]);
    put('dark', new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.1, -0.0, 0.07), new THREE.Vector3(-0.07, 0.03, 0.06), new THREE.Vector3(-0.04, 0.04, 0.04)]), 8, 0.014, 8, false));
    put('dark', new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI).rotateY(HP), [0, 0.06, 0.05]);
    put('poly', side([[0.17, -0.03], [0.21, -0.03], [0.22, -0.04], [0.234, -0.12], [0.196, -0.128], [0.176, -0.06]], 0.032, 0.007));
    put('dark', side([[0.2, -0.02], [0.2, 0.03], [0.17, 0.03], [0.17, -0.02]], 0.03, 0.004));
    put('poly', side([[-0.075, -0.052], [-0.035, -0.052], [-0.038, -0.16], [-0.07, -0.16]], 0.03, 0.008));
    put('body', side([[-0.08, -0.05], [-0.02, -0.05], [-0.02, -0.06], [-0.08, -0.06]], 0.04, 0.003));
    put('steel', side([[0.15, -0.03], [0.158, -0.03], [0.155, -0.045], [0.148, -0.055], [0.144, -0.052], [0.15, -0.044]], 0.006, 0.001));
    for (const s of [-1, 1]) for (const z of [0.0, 0.1]) put('steel', hex(0.004, 0.003), [s * 0.057, 0, z]);
    fuse(gun);
    const glowRing = part(new THREE.TorusGeometry(0.058, 0.002, 4, 24), M.neon.cyan, [0, 0, -0.016], [0, 0, 0], gun);
    const h = hands(gun, { grip: [0.0, -0.086, 0.2], gripRot: [0.15, 0, 0], support: [0, -0.07, -0.055], supportRot: [0, 0, 0.2], open: [0, 0.18] });
    return { group: gun, scale: 0.92, spin, heat, glowRing, left: h.left, muzzle: [0, 0, -0.64], port: [0.04, -0.03, 0.06], hip: [0.15, -0.165, -0.27], ads: [0.0, -0.1, -0.22], dot: null };
  }

  return { mats, carbine, pistol, shotgun, rocket, gatling };
}

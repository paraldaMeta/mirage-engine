// Mirage original code.

// ---------------------------------------------------------------------------
// A rigged humanoid authored in code: the engine's test asset for import, animation, IK and retargeting.
//
//   import { createRigModel } from '@miragekit/play';
//   import { writeGLB } from '@miragekit/core';
//   const rig = createRigModel();                       // { root, mesh, bones, clips }
//   const glb = writeGLB(rig.root, { clips: rig.clips });   // what examples/demos/anim loads (written in the page)
//
// Deliberately unlike the procedural player (character-model.js): a T-pose rest, 20 bones under a ground `Root`
// bone with Mixamo-style names, so retargeting between the two has real work to do (other names, other rest pose).
// Faces +Z, feet at y = 0, metres. Every bone's rest rotation is identity, so clip rotations read as world axes:
// X pitches (negative swings a hanging limb forward), Z rolls the arms down from the T.
//
// Clips (30 samples per second, first and last key equal on loops): idle, walk, run, walkBack, strafeL, strafeR,
// jump, wave (arm only: for a masked layer), lean (authored as an offset from idle: for an additive layer).
// Locomotion clips carry their travel as a translation track on `Root` (root motion) and foot-fall events in
// clip.userData.events = [{ time, name }].
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// [name, parent, rest position in rig space]
const SKELETON = [
  ['Root', null, [0, 0, 0]], ['Hips', 'Root', [0, 0.95, 0]], ['Spine', 'Hips', [0, 1.08, 0]], ['Chest', 'Spine', [0, 1.25, 0]],
  ['Neck', 'Chest', [0, 1.46, 0]], ['Head', 'Neck', [0, 1.54, 0]],
  ...[['Left', 1], ['Right', -1]].flatMap(([s, x]) => [
    [`${s}UpLeg`, 'Hips', [0.1 * x, 0.92, 0]], [`${s}Leg`, `${s}UpLeg`, [0.1 * x, 0.5, 0]], [`${s}Foot`, `${s}Leg`, [0.1 * x, 0.08, 0]],
    [`${s}Toe`, `${s}Foot`, [0.1 * x, 0.02, 0.13]],
    [`${s}Arm`, 'Chest', [0.19 * x, 1.4, 0]], [`${s}ForeArm`, `${s}Arm`, [0.47 * x, 1.4, 0]], [`${s}Hand`, `${s}ForeArm`, [0.73 * x, 1.4, 0]],
  ]),
];
/** leg length hip to ankle (two-bone IK and stride maths use it) */
export const RIG = { hip: 0.92, thigh: 0.42, shin: 0.42, ankle: 0.08, walk: 1.5, run: 4.2 };

const COLORS = { skin: 0xd9a383, shirt: 0x2f6f8f, trousers: 0x3a3f4a, boots: 0x2a2018, hair: 0x2b1d14 };

// a tube between two points with `rings` rings; ring t is weighted between the parent joint's bone and this one
function limb(parts, a, b, r0, r1, bone, parent, color, rings = 4, sides = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), axis = B.clone().sub(A), len = axis.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  const pos = [], nor = [], w = [], idx = [], v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = r0 + (r1 - r0) * t;
    // the first ring sits on the joint and bends half with the parent: no crack, a soft crease
    const wp = parent == null ? 0 : i === 0 ? 0.5 : i === 1 && rings > 2 ? 0.15 : 0;
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      v.set(Math.cos(ang) * r, t * len, Math.sin(ang) * r).applyQuaternion(q).add(A); pos.push(v.x, v.y, v.z);
      v.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(q); nor.push(v.x, v.y, v.z);
      w.push([bone, 1 - wp, parent ?? bone, wp]);
    }
  }
  // closed ends, so joints never show a hole from any angle
  for (const [t, n] of [[0, -1], [1, 1]]) {
    v.set(0, t * len, 0).applyQuaternion(q).add(A); pos.push(v.x, v.y, v.z);
    v.set(0, n, 0).applyQuaternion(q); nor.push(v.x, v.y, v.z);
    w.push([bone, t === 0 && parent != null ? 0.5 : 1, parent ?? bone, t === 0 && parent != null ? 0.5 : 0]);
  }
  for (let i = 0; i < rings; i++) for (let s = 0; s < sides; s++) {
    const p = i * sides + s, n = i * sides + (s + 1) % sides;
    idx.push(p, p + sides, n, n, p + sides, n + sides);
  }
  const c0 = (rings + 1) * sides, c1 = c0 + 1;
  for (let s = 0; s < sides; s++) { const n = (s + 1) % sides; idx.push(c0, s, n, c1, rings * sides + n, rings * sides + s); }
  parts.push({ pos, nor, w, idx, color });
}

function ball(parts, c, r, bone, color, scale = [1, 1, 1]) {
  const g = new THREE.SphereGeometry(r, 12, 8).scale(...scale).translate(...c);
  parts.push({ pos: [...g.attributes.position.array], nor: [...g.attributes.normal.array], idx: [...g.index.array], color,
    w: Array.from({ length: g.attributes.position.count }, () => [bone, 1, bone, 0]) });
}
function block(parts, min, max, bone, color) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  parts.push({ pos: [...g.attributes.position.array], nor: [...g.attributes.normal.array], idx: [...g.index.array], color,
    w: Array.from({ length: g.attributes.position.count }, () => [bone, 1, bone, 0]) });
}

// ---- clips -----------------------------------------------------------------------------------------------
const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qy = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const TAU = Math.PI * 2;
const ARM_DOWN = 1.32;   // radians from the T to hanging

// A pose is { bone: Quaternion, 'bone.position': Vector3 }; `fn(p)` returns one for phase p in [0, 1].
function bake(name, duration, rest, fn, { fps = 30, events = [], loop = true } = {}) {
  const n = Math.max(2, Math.round(duration * fps)), times = Float32Array.from({ length: n + 1 }, (_, i) => (i / n) * duration);
  const samples = Array.from({ length: n + 1 }, (_, i) => fn(loop && i === n ? 0 : i / n, i / n));
  const tracks = [];
  for (const key of Object.keys(samples[0])) {
    if (key.endsWith('.position')) {
      const r = rest[key.slice(0, -9)];
      tracks.push(new THREE.VectorKeyframeTrack(key, times, samples.flatMap((s) => [r.x + s[key].x, r.y + s[key].y, r.z + s[key].z])));
    } else {
      // neighbouring keys on the same hemisphere, so linear interpolation takes the short way
      const vals = []; let prev = null;
      for (const s of samples) { const q = s[key].clone(); if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); vals.push(q.x, q.y, q.z, q.w); prev = q; }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${key}.quaternion`, times, vals));
    }
  }
  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.userData = { loop, ...(events.length ? { events } : {}) };
  return clip;
}

const armsDown = (swingL = 0, swingR = 0, bend = 0.25) => ({
  LeftArm: qx(swingL).multiply(qz(-ARM_DOWN)), RightArm: qx(swingR).multiply(qz(ARM_DOWN)),
  LeftForeArm: qy(-bend), RightForeArm: qy(bend), LeftHand: new THREE.Quaternion(), RightHand: new THREE.Quaternion(),
});
const still = () => ({ Hips: new THREE.Quaternion(), Spine: new THREE.Quaternion(), Chest: new THREE.Quaternion(), Neck: new THREE.Quaternion(), Head: new THREE.Quaternion(),
  LeftUpLeg: new THREE.Quaternion(), RightUpLeg: new THREE.Quaternion(), LeftLeg: new THREE.Quaternion(), RightLeg: new THREE.Quaternion(),
  LeftFoot: new THREE.Quaternion(), RightFoot: new THREE.Quaternion(), ...armsDown(),
  'Hips.position': new THREE.Vector3(), 'Root.position': new THREE.Vector3() });

// one gait for walking forwards, backwards and running: `dir` +1 / -1, A thigh swing, K knee lift
function gait(p, { A, K, arm, bob, lean, dist, dir = 1, bend = 0.25 }, u) {
  const s = still();
  for (const [side, off] of [['Left', 0], ['Right', 0.5]]) {
    const ph = TAU * (p + off), thigh = -A * Math.sin(ph) * dir, knee = K * Math.max(0, Math.cos(ph)) ** 2;
    s[`${side}UpLeg`] = qx(thigh - knee * 0.35);
    s[`${side}Leg`] = qx(knee);
    s[`${side}Foot`] = qx(-thigh * 0.5 - knee * 0.3);
  }
  const sw = arm * Math.sin(TAU * p) * dir;
  Object.assign(s, armsDown(sw, -sw, bend));
  s.Hips = qx(lean).multiply(qy(0.12 * Math.sin(TAU * p) * dir));
  s.Chest = qy(-0.2 * Math.sin(TAU * p) * dir);
  s['Hips.position'].set(0, -bob * (0.5 + 0.5 * Math.cos(2 * TAU * p)) - (1 - Math.cos(A)) * 0.4, 0);
  s['Root.position'].set(0, 0, dist * u * dir);
  return s;
}
function strafe(p, sign, u) {
  const s = still();
  for (const [side, off, x] of [['Left', 0, 1], ['Right', 0.5, -1]]) {
    const ph = TAU * (p + off), out = 0.2 * Math.sin(ph) * sign, lift = 0.5 * Math.max(0, Math.cos(ph)) ** 2;
    s[`${side}UpLeg`] = qz(out).multiply(qx(-lift * 0.5));
    s[`${side}Leg`] = qx(lift);
    s[`${side}Foot`] = qz(-out).multiply(qx(-lift * 0.5));
  }
  s.Hips = qz(0.04 * Math.sin(TAU * p) * sign);
  s['Hips.position'].set(0, -0.015 * (0.5 + 0.5 * Math.cos(2 * TAU * p)) - 0.012, 0);
  s['Root.position'].set(1.2 * u * sign, 0, 0);
  return s;
}

function makeClips(rest) {
  const steps = (d) => [{ time: 0.25 * d, name: 'footL' }, { time: 0.75 * d, name: 'footR' }];
  const idle = (p) => {
    const s = still(), b = Math.sin(TAU * p);
    s.Chest = qx(-0.02 * b); s.Spine = qx(0.012 * b); s.Head = qy(0.05 * Math.sin(TAU * p + 1)).multiply(qx(0.01 * b));
    Object.assign(s, armsDown(0.03 * b, 0.03 * b, 0.22 + 0.03 * b));
    s['Hips.position'].set(0, -0.004 * (1 - b), 0);
    return s;
  };
  const clips = [
    bake('idle', 2.4, rest, idle),
    bake('walk', 1.0, rest, (p, u) => gait(p, { A: 0.46, K: 0.9, arm: 0.5, bob: 0.022, lean: 0.03, dist: RIG.walk }, u), { events: steps(1.0) }),
    bake('run', 0.6, rest, (p, u) => gait(p, { A: 0.72, K: 1.7, arm: 0.95, bob: 0.05, lean: 0.2, dist: RIG.run * 0.6, bend: 1.3 }, u), { events: steps(0.6) }),
    bake('walkBack', 1.1, rest, (p, u) => gait(p, { A: 0.34, K: 0.7, arm: 0.3, bob: 0.018, lean: -0.03, dist: 1.1, dir: -1 }, u), { events: steps(1.1) }),
    bake('strafeL', 1.0, rest, (p, u) => strafe(p, 1, u), { events: steps(1.0) }),
    bake('strafeR', 1.0, rest, (p, u) => strafe(p, -1, u), { events: steps(1.0) }),
    bake('jump', 0.7, rest, (p) => {
      const s = still(), crouch = Math.sin(Math.PI * Math.min(1, p / 0.3)) * (p < 0.3 ? 1 : 0), air = p < 0.3 ? 0 : Math.sin(Math.PI * (p - 0.3) / 0.7);
      const k = 0.9 * crouch + 0.7 * air;
      for (const side of ['Left', 'Right']) { s[`${side}UpLeg`] = qx(-k * 0.6); s[`${side}Leg`] = qx(k * 1.2); s[`${side}Foot`] = qx(-k * 0.6 + 0.4 * air); }
      s.Hips = qx(0.25 * crouch); s['Hips.position'].set(0, -0.2 * crouch, 0);
      Object.assign(s, armsDown(0.6 * crouch - 1.2 * air, 0.6 * crouch - 1.2 * air, 0.4));
      return s;
    }, { loop: false, events: [{ time: 0.21, name: 'takeoff' }] }),
    // wave: only the right arm and head are keyed, so the clip also works without a mask
    bake('wave', 1.6, rest, (p) => {
      const up = Math.min(1, Math.min(p, 1 - p) / 0.2), e = up * up * (3 - 2 * up);
      return { RightArm: qz(ARM_DOWN * (1 - e) - 0.9 * e), RightForeArm: qy(0.25 + e * (1.0 + 0.5 * Math.sin(TAU * 3 * p))), RightHand: qx(0), Head: qy(-0.15 * e) };
    }, { loop: false, events: [{ time: 0.8, name: 'waveTop' }] }),
    // lean: the first key is the idle pose it is an offset from (animator additive layers subtract key 0)
    bake('lean', 1.0, rest, (p, u) => ({ Spine: qz(-0.22 * u), Chest: qz(-0.18 * u), Head: qz(0.2 * u) }), { loop: false }),
  ];
  return clips;
}

/** The rig: `root` (a Group holding the bone tree and the skinned mesh), `bones` by name, `clips`. */
export function createRigModel({ material, colors = {} } = {}) {
  const C = { ...COLORS, ...colors }, bones = {}, rest = {}, list = [];
  for (const [name, parent, p] of SKELETON) {
    const b = new THREE.Bone(); b.name = name;
    rest[name] = new THREE.Vector3(...p);
    if (parent) { b.position.copy(rest[name]).sub(rest[parent]); bones[parent].add(b); } else b.position.copy(rest[name]);
    bones[name] = b; list.push(b);
  }
  const localRest = Object.fromEntries(list.map((b) => [b.name, b.position.clone()]));
  const id = (n) => list.indexOf(bones[n]), P = (n) => rest[n].toArray(), parts = [];
  limb(parts, [0, 0.9, 0], P('Spine'), 0.15, 0.14, id('Hips'), null, C.trousers, 2, 10);
  limb(parts, P('Spine'), P('Chest'), 0.14, 0.16, id('Spine'), id('Hips'), C.shirt, 3, 10);
  limb(parts, P('Chest'), [0, 1.45, 0], 0.16, 0.13, id('Chest'), id('Spine'), C.shirt, 3, 10);
  limb(parts, P('Neck'), P('Head'), 0.05, 0.05, id('Neck'), id('Chest'), C.skin, 2);
  ball(parts, [0, 1.65, 0.01], 0.11, id('Head'), C.skin, [0.95, 1.1, 1]);
  ball(parts, [0, 1.69, -0.02], 0.112, id('Head'), C.hair, [1, 0.95, 1]);
  block(parts, [-0.015, 1.62, 0.1], [0.015, 1.66, 0.13], id('Head'), C.skin);   // a nose: which way it faces
  for (const [s, x] of [['Left', 1], ['Right', -1]]) {
    limb(parts, P(`${s}UpLeg`), P(`${s}Leg`), 0.085, 0.06, id(`${s}UpLeg`), id('Hips'), C.trousers);
    limb(parts, P(`${s}Leg`), P(`${s}Foot`), 0.06, 0.045, id(`${s}Leg`), id(`${s}UpLeg`), C.trousers);
    block(parts, [0.1 * x - 0.05, 0, -0.07], [0.1 * x + 0.05, 0.09, 0.13], id(`${s}Foot`), C.boots);
    block(parts, [0.1 * x - 0.048, 0, 0.13], [0.1 * x + 0.048, 0.06, 0.2], id(`${s}Toe`), C.boots);
    limb(parts, P(`${s}Arm`), P(`${s}ForeArm`), 0.055, 0.042, id(`${s}Arm`), id('Chest'), C.shirt);
    limb(parts, P(`${s}ForeArm`), P(`${s}Hand`), 0.042, 0.032, id(`${s}ForeArm`), id(`${s}Arm`), C.skin);
    block(parts, [Math.min(0.73 * x, 0.83 * x), 1.385, -0.035], [Math.max(0.73 * x, 0.83 * x), 1.415, 0.035], id(`${s}Hand`), C.skin);
  }
  const pos = [], nor = [], col = [], si = [], sw = [], idx = [], c = new THREE.Color();
  for (const part of parts) {
    const base = pos.length / 3; c.set(part.color);
    pos.push(...part.pos); nor.push(...part.nor);
    for (const w of part.w) { col.push(c.r, c.g, c.b); si.push(w[0], w[2], 0, 0); sw.push(w[1], w[3], 0, 0); }
    for (const i of part.idx) idx.push(base + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setIndex(idx);
  const root = new THREE.Group(); root.name = 'Rig';
  const mesh = new THREE.SkinnedMesh(geometry, material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, name: 'RigCloth' }));
  mesh.name = 'RigBody'; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  root.add(bones.Root, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  return { root, mesh, bones, clips: makeClips(localRest) };
}

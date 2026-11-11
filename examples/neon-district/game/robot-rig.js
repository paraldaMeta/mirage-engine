// robot-rig: the enemies' bodies from the robot kit (modules/robot-kit.js).
//   humanoidMeshes  the kit's humanoid parts skinned rigidly to @miragekit/play's rig (each part to its bone), merged
//                   per material: shell, metal, lights; three levels of detail, the geometry shared per kind
//   robotClips      idle, walk and run for the rig from the kit's gait (stance feet fixed to the ground, heel strike
//                   and toe-off, bent knees, the hip as low as the stance leg reaches, sway and arm swing); the clips
//                   carry their travel (root motion), so playback can be scaled to the ground covered
//   createHound     a robot dog on its own skeleton (a body, four legs of two links, a turret's yaw), skinned the same
//                   way; posed in code each frame: a trot from the distance travelled, a crouch, a leap, a fall
import * as THREE from 'three';
import { humanoid, humanoidRig, quadruped, quadrupedDims, mergeParts, moved, bipedLegs, trotLegs, legIK, GAITS, LEN } from '../modules/robot-kit.js';

const TAU = Math.PI * 2, ARM_DOWN = 1.32;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const qx = (a) => new THREE.Quaternion().setFromAxisAngle(X, a), qy = (a) => new THREE.Quaternion().setFromAxisAngle(Y, a), qz = (a) => new THREE.Quaternion().setFromAxisAngle(Z, a);

// ---------------------------------------------------------------------------------------------------------------
/** skin attributes: every vertex of a part list to one bone */
function skinned(list, bi) {
  const g = mergeParts(list), n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}
function bySlot(perBone, boneIndex) {
  const out = { s: [], m: [], l: [] };
  for (const [bone, list] of Object.entries(perBone)) for (const slot of ['s', 'm', 'l']) {
    const L = list.filter((p) => p.slot === slot);
    if (L.length) out[slot].push(skinned(L, boneIndex(bone)));
  }
  const merge = (gs) => { if (!gs.length) return null; const all = new THREE.BufferGeometry(), n = gs.reduce((s, g) => s + g.attributes.position.count, 0);
    for (const [k, w, T] of [['position', 3, Float32Array], ['normal', 3, Float32Array], ['uv', 2, Float32Array], ['color', 3, Float32Array], ['ndR', 1, Float32Array], ['ndD', 3, Float32Array], ['skinIndex', 4, Uint16Array], ['skinWeight', 4, Float32Array]]) {
      const a = new T(n * w); let o = 0; for (const g of gs) { a.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } all.setAttribute(k, new THREE.BufferAttribute(a, w));
    }
    return all; };
  return { s: merge(out.s), m: merge(out.m), l: merge(out.l) };
}
const GEO = new Map();
/** the geometry of a humanoid enemy (cached per look, level and number): { s, m, l } skinned to the rig's bones */
export function humanoidMeshes(look, lod, kit, boneNames) {
  const key = [look, lod, JSON.stringify(kit)].join(':');
  if (!GEO.has(key)) GEO.set(key, bySlot(humanoidRig(humanoid(look, lod, kit)), (b) => boneNames.indexOf(b)));
  return GEO.get(key);
}
export const tris = (g) => (g ? g.attributes.position.count / 3 : 0);

// ---------------------------------------------------------------------------------------------------------------
/** idle, walk and run for the rig (T-pose rest, X pitches, Z rolls the arms down) from the kit's gait */
export function robotClips() {
  const bake = (name, dur, fn, fps = 30, events = []) => {
    const n = Math.max(2, Math.round(dur * fps)), times = Float32Array.from({ length: n + 1 }, (_, i) => (i / n) * dur);
    const samples = Array.from({ length: n + 1 }, (_, i) => fn(i === n ? 0 : i / n, i / n));
    const tracks = [];
    for (const key of Object.keys(samples[0])) {
      if (key.endsWith('.position')) tracks.push(new THREE.VectorKeyframeTrack(key, times, samples.flatMap((s) => s[key])));
      else { const v = []; let prev = null; for (const s of samples) { const q = s[key].clone(); if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); v.push(q.x, q.y, q.z, q.w); prev = q; } tracks.push(new THREE.QuaternionKeyframeTrack(key + '.quaternion', times, v)); }
    }
    const c = new THREE.AnimationClip(name, dur, tracks); c.userData = { loop: true, events };
    return c;
  };
  const legs = { hipY: 0, legs: [{}, {}] };
  // the pose from leg angles, the pelvis (sway sideways, roll, yaw), the trunk and the arms
  const pose = (L, { sway = 0, roll = 0, yaw = 0, lean = 0, hipY, armF = [0, 0], elbow = 0.35, head = 0, travel = 0 }) => {
    const s = {}, lift = hipY - 0.92;
    s['Root.position'] = [0, 0, travel];
    s['Hips.position'] = [sway, 0.95 + lift, 0];
    s.Hips = qy(yaw).multiply(qz(roll)).multiply(qx(lean * 0.4));
    // the legs: the kit's angles; a small roll at the hip keeps the feet under the hips while the pelvis sways
    const k = Math.asin(Math.max(-0.2, Math.min(0.2, -sway / 0.84)));
    ['Left', 'Right'].forEach((S, i) => {
      const l = L[i];
      s[S + 'UpLeg'] = qz(k - roll).multiply(qy(-yaw)).multiply(qx(-l.up));
      s[S + 'Leg'] = qx(l.bend); s[S + 'Foot'] = qx(l.foot); s[S + 'Toe'] = qx(l.toe);
    });
    s.Spine = qy(-yaw * 0.6).multiply(qx(lean * 0.3)); s.Chest = qy(-yaw * 0.5).multiply(qz(-roll * 0.6)).multiply(qx(lean * 0.3));
    s.Neck = qx(-lean * 0.5); s.Head = qy(yaw * 0.4 + head).multiply(qx(-lean * 0.2));
    s.LeftArm = qx(-armF[0]).multiply(qz(-ARM_DOWN + 0.06)); s.RightArm = qx(-armF[1]).multiply(qz(ARM_DOWN - 0.06));
    s.LeftForeArm = qy(-(elbow + 0.25 * Math.max(0, armF[0]))); s.RightForeArm = qy(elbow + 0.25 * Math.max(0, armF[1]));
    s.LeftHand = qx(0.1); s.RightHand = qx(0.1);
    return s;
  };
  const gaitClip = (name, G, { arm, elbow, lean, sway, yaw }) => bake(name, G.T, (p, u) => {
    bipedLegs(p, G, legs);
    const c = Math.cos(TAU * p);
    return pose(legs.legs, { hipY: legs.hipY, sway: sway * Math.cos(TAU * (p - G.duty / 2)), roll: -0.035 * Math.cos(TAU * (p - G.duty / 2)), yaw: yaw * Math.sin(TAU * p), lean, armF: [-arm * c, arm * c], elbow, travel: G.v * G.T * u });
  }, 30, [{ time: 0, name: 'footL' }, { time: G.T / 2, name: 'footR' }]);
  const idle = bake('idle', 3.2, (p) => {   // standing with soft knees, the weight shifting from foot to foot
    const w = Math.sin(TAU * p), hipY = 0.92 - 0.045 + 0.006 * Math.abs(w), L = [0, 1].map(() => { const [up, bend] = legIK(0.0, 0.08 - hipY, LEN.thigh, LEN.shin, 1); return { up, bend, foot: up - bend, toe: 0 }; });
    return pose(L, { hipY, sway: 0.018 * w, roll: -0.02 * w, yaw: 0.02 * Math.sin(TAU * p + 1), armF: [0.05 + 0.02 * w, 0.05 - 0.02 * w], elbow: 0.32, head: 0.06 * Math.sin(TAU * p * 2 + 0.5) });
  });
  return [idle, gaitClip('walk', GAITS.walk, { arm: 0.32, elbow: 0.4, lean: 0.05, sway: 0.025, yaw: 0.07 }), gaitClip('run', GAITS.run, { arm: 0.7, elbow: 1.25, lean: 0.22, sway: 0.012, yaw: 0.1 })];
}
/** how fast each of the three clips covers the ground (m/s) and how long a cycle is: for scaling playback */
export const CLIP_SPEED = { idle: [0, 3.2], walk: [GAITS.walk.v, GAITS.walk.T], run: [GAITS.run.v, GAITS.run.T] };

// ---------------------------------------------------------------------------------------------------------------
// the hound: a robot dog on its own little skeleton
const HOUND_GEO = new Map();
function houndGeometry(style, lod, boneOf, D) {
  const key = style + lod;
  if (HOUND_GEO.has(key)) return HOUND_GEO.get(key);
  const Q = quadruped(style, lod), per = { body: moved(Q.body, new THREE.Matrix4().makeTranslation(0, D.stand, 0)) };
  LEGS.forEach(([name, sx, sz]) => {
    const hx = sx * (D.W / 2 + 0.035), hz = sz * D.hipZ;
    per[name + 'U'] = moved(Q.upper, new THREE.Matrix4().makeTranslation(hx, D.stand, hz));
    per[name + 'L'] = moved(Q.lower, new THREE.Matrix4().makeTranslation(hx, D.stand - D.thigh, hz));
  });
  if (style === 'hauler') { per.turret = per.body.filter((p) => p.turret); per.body = per.body.filter((p) => !p.turret); }
  const g = bySlot(per, boneOf);
  HOUND_GEO.set(key, g);
  return g;
}
const LEGS = [['FL', 1, 1], ['FR', -1, 1], ['HL', 1, -1], ['HR', -1, -1]];

/**
 * A robot dog: { root, model, bones, meshes: [[s, m, l] per lod], tip, D, pose(state, dt) }. style 'scout' | 'hauler'.
 * pose: { speed (m/s), dist (m travelled, drives the trot), crouch 0..1, leap 0..1 (in the air), dead (s since), aim
 * (the turret's yaw offset) }
 */
export function createHound({ style, mats, light }) {
  const D = quadrupedDims(style);
  const names = ['root', 'body', 'turret', ...LEGS.flatMap(([n]) => [n + 'U', n + 'L'])], bones = {};
  const rest = { root: [0, 0, 0], body: [0, D.stand, 0], turret: [0, D.stand, 0] };
  LEGS.forEach(([n, sx, sz]) => { rest[n + 'U'] = [sx * (D.W / 2 + 0.035), D.stand, sz * D.hipZ]; rest[n + 'L'] = [sx * (D.W / 2 + 0.035), D.stand - D.thigh, sz * D.hipZ]; });
  const parent = (n) => (n === 'root' ? null : n === 'body' || n === 'turret' ? 'root' : n.endsWith('U') ? 'body' : n.slice(0, 2) + 'U');
  for (const n of names) { const b = new THREE.Bone(); b.name = 'hound_' + n; bones[n] = b; }
  for (const n of names) { const p = parent(n); const r = new THREE.Vector3(...rest[n]); if (p) { r.sub(new THREE.Vector3(...rest[p])); bones[p].add(bones[n]); } bones[n].position.copy(r); }
  const root = new THREE.Group(), model = new THREE.Group(); root.add(model); model.add(bones.root);
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(names.map((n) => bones[n]));
  const boneOf = (n) => names.indexOf(n);
  const reach = new THREE.Sphere(new THREE.Vector3(0, D.stand * 0.7, 0.05), D.L * 0.85 + 0.25);
  const meshes = [0, 1, 2].map((lod) => {
    const g = houndGeometry(style, lod, boneOf, D);
    return [['s', mats.shell], ['m', mats.metal], ['l', light]].filter(([k]) => g[k]).map(([k, m]) => {
      const sm = new THREE.SkinnedMesh(g[k], m); sm.bind(skeleton, new THREE.Matrix4());
      sm.boundingSphere = reach; sm.frustumCulled = true; sm.castShadow = k === 's' && lod < 2; sm.receiveShadow = true; sm.visible = lod === 0;
      model.add(sm); return sm;
    });
  });
  // the muzzle (the hauler's turret) or the head (the scout's: it does not shoot)
  const tip = new THREE.Object3D(); (style === 'hauler' ? bones.turret : bones.body).add(tip);
  tip.position.set(0, style === 'hauler' ? D.H / 2 + 0.12 : 0, style === 'hauler' ? 0.46 : D.L / 2 + 0.03);
  const L = [[0, 0], [0, 0], [0, 0], [0, 0]], G = { v: style === 'hauler' ? 1.15 : 0.9, T: 1, duty: 0.42, lift: style === 'hauler' ? 0.09 : 0.07 };
  let lod = 0, smooth = 0;
  function setLod(l) { if (l === lod) return; lod = l; meshes.forEach((set, i) => set.forEach((m) => { m.visible = i === l; })); }
  function pose(s, dt) {
    const B = bones, sp = Math.min(1, s.speed / 1.2);
    smooth += (sp - smooth) * Math.min(1, dt * 6);
    const crouch = (s.crouch || 0) * D.stand * 0.28 + (s.dead ? Math.min(1, s.dead / 0.5) * (D.stand - D.H / 2 - 0.02) : 0);
    // the trot: phase from the distance covered; standing, the feet come under the hips
    const g = { ...G, lift: G.lift * smooth, v: G.v };
    trotLegs(s.dist / G.v, D, g, crouch, L);
    if (smooth < 0.05 && !s.dead) for (const l of L) { const [u, b] = legIK(0, D.foot - (D.stand - crouch), D.thigh, D.calf, -1); l[0] = u; l[1] = b; }
    const leap = s.leap || 0;
    LEGS.forEach(([n, sx, sz], i) => {
      let up = L[i][0], bend = L[i][1];
      if (leap > 0) { const e = Math.sin(Math.PI * leap); up += (sz > 0 ? 0.9 : -0.7) * e; bend *= 1 - 0.6 * e; }
      if (s.dead) { const k = Math.min(1, s.dead / 0.6); up += sx * 0.0 + (sz > 0 ? 0.6 : -0.6) * k; bend += 0.5 * k; }
      B[n + 'U'].quaternion.copy(qx(-up)).premultiply(qz(sx * (s.dead ? -0.5 * Math.min(1, s.dead / 0.6) : 0.04)));
      B[n + 'L'].quaternion.copy(qx(-bend));
    });
    const bob = smooth * 0.012 * Math.cos(TAU * 2 * s.dist / G.v), hop = leap > 0 ? Math.sin(Math.PI * leap) * 0.45 : 0;
    B.body.position.set(0, D.stand - crouch + bob + hop, 0);
    B.body.quaternion.copy(qx((s.crouch || 0) * 0.12 - (leap > 0 ? 0.25 * Math.cos(Math.PI * leap) : 0) + smooth * 0.04)).premultiply(qz(s.dead ? Math.min(1, s.dead / 0.7) * 1.15 : 0));
    B.turret.position.copy(B.body.position); B.turret.quaternion.copy(B.body.quaternion).multiply(qy(s.aim || 0));
  }
  pose({ speed: 0, dist: 0 }, 1);
  return { root, model, bones, meshes, tip, D, pose, setLod, get lod() { return lod; }, skeleton };
}

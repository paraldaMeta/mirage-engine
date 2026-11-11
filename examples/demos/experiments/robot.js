// Experiment (img2threejs method by hand): a full-size general-purpose humanoid robot: slim limbs, exposed joint
// actuators, a visor head. createRobot({ pass, visor }) -> THREE.Group. Procedural geometry only.
//
// The joints are the pivots, and they ARE createRigModel's skeleton: the same 20 names, the same rest positions
// (a T-pose, +Z forward, the robot's left on +X), rest rotations identity. So every clip of the rig (and every
// clip retargeted onto it, e.g. walk/ual-clips.js) plays on this robot as it is:
//   new THREE.AnimationMixer(robot).clipAction(clip).play()
// Hierarchy: robot > Root > Hips > Spine > Chest > Neck > Head; Hips > {Left,Right}UpLeg > Leg > Foot > Toe;
//            Chest > {Left,Right}Arm > ForeArm > Hand. Rigid parts hang on their joint (no skin deformation).
// Passes: 1 blockout (a capsule per segment)  2 structure (proportioned shells, joint housings, the pivot test)
//         3 form (chest shield, visor head, actuators, hands, feet, thigh insets)  4 material  5 optimise (one rigidly
//         skinned mesh per material: the joints become a Skeleton, draw calls = materials)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// createRigModel's skeleton (packages/play/src/rig-model.js): [name, parent, rest position in model space]
const SKELETON = [
  ['Root', null, [0, 0, 0]], ['Hips', 'Root', [0, 0.95, 0]], ['Spine', 'Hips', [0, 1.08, 0]], ['Chest', 'Spine', [0, 1.25, 0]],
  ['Neck', 'Chest', [0, 1.46, 0]], ['Head', 'Neck', [0, 1.54, 0]],
  ...[['Left', 1], ['Right', -1]].flatMap(([s, x]) => [
    [`${s}UpLeg`, 'Hips', [0.1 * x, 0.92, 0]], [`${s}Leg`, `${s}UpLeg`, [0.1 * x, 0.5, 0]], [`${s}Foot`, `${s}Leg`, [0.1 * x, 0.08, 0]],
    [`${s}Toe`, `${s}Foot`, [0.1 * x, 0.02, 0.13]],
    [`${s}Arm`, 'Chest', [0.19 * x, 1.4, 0]], [`${s}ForeArm`, `${s}Arm`, [0.47 * x, 1.4, 0]], [`${s}Hand`, `${s}ForeArm`, [0.73 * x, 1.4, 0]],
  ]),
];
export const ROBOT = { height: 1.76, shoulderWidth: 0.5, hip: 0.95, knee: 0.5, ankle: 0.08 };

const MATS = (pass, visor) => {
  if (pass < 4) {
    const g = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1 });
    return { shell: g(0xb8b8b8), silver: g(0x9a9a9a), black: g(0x2a2a2c), visor: g(0x111111), glow: g(0x6699aa) };
  }
  return {
    shell: new THREE.MeshPhysicalMaterial({ color: 0xc9cacc, roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25, name: 'shellPolymer' }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc0c3c7, roughness: 0.22, metalness: 1, name: 'satinAluminium' }),
    black: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.55, metalness: 0.35, name: 'actuatorBlack' }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.05, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02, name: 'visorGloss' }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(...visor), emissiveIntensity: 2.5, name: 'visorGlow' }),
  };
};

// ---- shapes ----------------------------------------------------------------------------------------------------
const V = (a) => new THREE.Vector3(...a);
/** a turned shell from a to b: profile [[t 0..1, radius], ...]; `squash` scales the section across (x / z) */
function turned(a, b, profile, { seg = 16, squash = [1, 1] } = {}) {
  const A = V(a), B = V(b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.LatheGeometry(profile.map(([t, r]) => new THREE.Vector2(Math.max(r, 1e-4), t * len)), seg);
  g.scale(squash[0], 1, squash[1]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(A.x, A.y, A.z);
  return g;
}
const cyl = (c, r, len, axis = 'x', seg = 16) => { const g = new THREE.CylinderGeometry(r, r, len, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); return g.translate(...c); };
const rbox = (c, s, r = 0.01) => new RoundedBoxGeometry(s[0], s[1], s[2], 2, Math.min(r, Math.min(...s) * 0.45)).translate(...c);
const rod = (a, b, r = 0.008) => turned(a, b, [[0, r], [1, r]], { seg: 6 });

// ---- the parts, per joint, in model space (T-pose rest); { bone: [[geometry, material key], ...] } --------------
function parts(pass) {
  const P = {}; const put = (bone, g, m) => (P[bone] ||= []).push([g, m]);
  if (pass === 1) {   // blockout: a capsule per segment, a box per mass
    const cap = (a, b, r) => turned(a, b, [[0, 0], [0.02, r * 0.7], [0.1, r], [0.9, r], [0.98, r * 0.7], [1, 0]], { seg: 10 });
    put('Chest', rbox([0, 1.3, 0], [0.42, 0.32, 0.22], 0.03), 'shell'); put('Hips', rbox([0, 0.98, 0], [0.3, 0.14, 0.18], 0.03), 'black');
    put('Head', new THREE.SphereGeometry(0.11, 12, 10).scale(0.9, 1.15, 1).translate(0, 1.65, 0), 'black');
    for (const [s, x] of [['Left', 1], ['Right', -1]]) {
      put(`${s}UpLeg`, cap([0.1 * x, 0.92, 0], [0.1 * x, 0.5, 0], 0.07), 'silver'); put(`${s}Leg`, cap([0.1 * x, 0.5, 0], [0.1 * x, 0.08, 0], 0.05), 'silver');
      put(`${s}Foot`, rbox([0.1 * x, 0.04, 0.06], [0.1, 0.08, 0.26]), 'silver');
      put(`${s}Arm`, cap([0.19 * x, 1.4, 0], [0.47 * x, 1.4, 0], 0.05), 'silver'); put(`${s}ForeArm`, cap([0.47 * x, 1.4, 0], [0.73 * x, 1.4, 0], 0.04), 'silver');
      put(`${s}Hand`, rbox([0.79 * x, 1.4, 0], [0.12, 0.03, 0.08]), 'black');
    }
    return P;
  }
  // ---- torso: a shield-shaped chest shell (wide shoulders, narrowing to the waist), bevelled; a back pack
  const shield = new THREE.Shape();
  [[-0.215, 0.2], [0.215, 0.2], [0.2, 0.02], [0.13, -0.17], [-0.13, -0.17], [-0.2, 0.02]].forEach(([x, y], i) => (i ? shield.lineTo(x, y) : shield.moveTo(x, y)));
  const chest = new THREE.ExtrudeGeometry(shield, { depth: 0.15, bevelEnabled: true, bevelSize: pass >= 3 ? 0.03 : 0.005, bevelThickness: pass >= 3 ? 0.045 : 0.005, bevelSegments: pass >= 3 ? 2 : 1 });
  chest.translate(0, 1.27, -0.075);
  put('Chest', chest, 'shell');
  if (pass >= 3) {
    put('Chest', rbox([0, 1.29, -0.12], [0.3, 0.26, 0.08], 0.025), 'black');                     // battery pack on the back
    put('Chest', rbox([0, 1.47, 0], [0.34, 0.035, 0.14], 0.012), 'black');                        // the shoulder yoke
    put('Chest', cyl([0, 1.115, 0], 0.07, 0.06, 'y', 18), 'black');                                // chest-to-waist collar
  }
  // waist: the exposed spine column and its belt; the pelvis housing with the hip actuators and a front disc
  put('Spine', turned([0, 1.06, 0], [0, 1.2, 0], [[0, 0.06], [0.3, 0.05], [0.7, 0.05], [1, 0.065]], { seg: 16, squash: [1.4, 1] }), 'silver');
  put('Hips', rbox([0, 0.985, -0.005], [0.27, 0.13, 0.17], 0.035), 'black');
  if (pass >= 3) {
    put('Hips', cyl([0, 0.99, 0.092], 0.05, 0.02, 'z', 24), 'silver');                              // the front disc (actuator cover)
    put('Hips', cyl([0, 0.99, 0.104], 0.032, 0.006, 'z', 6), 'black');
    for (const x of [-1, 1]) put('Hips', cyl([0.135 * x, 0.94, 0], 0.055, 0.05, 'x', 18), 'black');   // hip pitch actuators
    put('Spine', cyl([0, 1.09, 0], 0.075, 0.035, 'y', 18), 'black');                                  // the belt ring
  }
  // ---- head: an egg-shaped helmet, a full-face gloss visor, the neck column with its actuator
  put('Neck', turned([0, 1.44, 0], [0, 1.56, 0], [[0, 0.045], [0.5, 0.035], [1, 0.04]], { seg: 12 }), 'silver');
  const helmet = new THREE.SphereGeometry(0.105, 24, 18).scale(0.92, 1.22, 1.06).translate(0, 1.645, -0.005);
  put('Head', helmet, pass >= 3 ? 'black' : 'black');
  if (pass >= 3) {
    // the visor: the front of a slightly larger ellipsoid, the face area only
    put('Head', new THREE.SphereGeometry(0.108, 24, 14, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.2, Math.PI * 0.42).scale(0.93, 1.2, 1.08).translate(0, 1.64, 0), 'visor');
    put('Head', new THREE.BoxGeometry(0.11, 0.008, 0.004).translate(0, 1.66, 0.117), 'glow');   // a thin sensor line behind the visor
    put('Neck', cyl([0, 1.5, -0.03], 0.02, 0.07, 'x', 10), 'black');
  }
  // ---- arms (along +/-X in the T-pose): a shoulder housing, upper arm and forearm shells, an elbow actuator,
  // exposed rods along the forearm, a hand with four two-part fingers and a thumb
  for (const [s, x] of [['Left', 1], ['Right', -1]]) {
    const X = (v) => v * x;
    put(`${s}Arm`, new THREE.SphereGeometry(0.078, 18, 12).translate(X(0.225), 1.4, 0), 'shell');
    put(`${s}Arm`, turned([X(0.24), 1.4, 0], [X(0.44), 1.4, 0], [[0, 0.052], [0.4, 0.048], [1, 0.04]], { seg: 16 }), 'silver');
    put(`${s}ForeArm`, cyl([X(0.47), 1.4, 0], 0.042, 0.07, 'z', 18), 'black');                     // elbow actuator (pitches the forearm)
    put(`${s}ForeArm`, turned([X(0.5), 1.4, 0], [X(0.71), 1.4, 0], [[0, 0.038], [0.35, 0.036], [1, 0.027]], { seg: 14, squash: [1, 0.85] }), 'silver');
    if (pass >= 3) {
      put(`${s}Arm`, rbox([X(0.34), 1.4, -0.05], [0.14, 0.03, 0.025], 0.008), 'black');           // the upper arm's actuator housing
      for (const z of [-0.03, 0.03]) put(`${s}ForeArm`, rod([X(0.5), 1.385, z], [X(0.7), 1.385, z * 0.7], 0.006), 'black');
      put(`${s}Hand`, cyl([X(0.735), 1.4, 0], 0.024, 0.04, 'x', 10), 'black');                    // wrist
      put(`${s}Hand`, rbox([X(0.79), 1.4, 0], [0.085, 0.028, 0.075], 0.008), 'silver');            // palm
      for (let f = 0; f < 4; f++) {
        const z = -0.027 + f * 0.018, l1 = 0.04 - (f === 3 ? 0.008 : 0);
        put(`${s}Hand`, rbox([X(0.833 + l1 / 2), 1.398, z], [l1, 0.016, 0.014], 0.005), 'black');
        put(`${s}Hand`, rbox([X(0.833 + l1 + 0.016), 1.394, z], [0.03, 0.014, 0.013], 0.005), 'silver');
      }
      put(`${s}Hand`, rbox([X(0.78), 1.39, 0.048], [0.02, 0.016, 0.045], 0.006), 'black');        // thumb
    }
  }
  // ---- legs: thigh shell with a black front inset, a knee actuator, a slim shin with two exposed rods behind
  // to the ankle, an ankle joint, a shoe-like foot with a separate toe cap
  for (const [s, x] of [['Left', 1], ['Right', -1]]) {
    const X = (v) => v * x;
    put(`${s}UpLeg`, turned([X(0.1), 0.9, 0], [X(0.1), 0.54, 0], [[0, 0.086], [0.25, 0.09], [0.8, 0.068], [1, 0.056]], { seg: 20, squash: [0.92, 1.08] }), 'silver');
    put(`${s}Leg`, cyl([X(0.1), 0.5, 0], 0.048, 0.1, 'x', 18), 'black');                          // knee actuator
    put(`${s}Leg`, turned([X(0.1), 0.47, 0.005], [X(0.1), 0.12, 0.005], [[0, 0.046], [0.3, 0.044], [1, 0.03]], { seg: 14, squash: [0.85, 1] }), 'silver');
    put(`${s}Foot`, cyl([X(0.1), 0.08, 0], 0.03, 0.07, 'x', 12), 'black');                         // ankle
    put(`${s}Foot`, rbox([X(0.1), 0.045, 0.045], [0.095, 0.075, 0.2], 0.025), 'silver');
    put(`${s}Toe`, rbox([X(0.1), 0.028, 0.165], [0.09, 0.05, 0.07], 0.02), 'silver');
    if (pass >= 3) {
      put(`${s}UpLeg`, rbox([X(0.1), 0.72, 0.088], [0.06, 0.28, 0.02], 0.008), 'black');           // the thigh's front inset
      put(`${s}UpLeg`, rbox([X(0.1 + 0.07), 0.86, 0], [0.025, 0.08, 0.08], 0.01), 'black');         // hip roll housing
      for (const dx of [-0.018, 0.018]) put(`${s}Leg`, rod([X(0.1 + dx), 0.44, -0.05], [X(0.1 + dx), 0.12, -0.035], 0.007), 'black');   // calf rods
      put(`${s}Leg`, rbox([X(0.1), 0.4, -0.055], [0.05, 0.08, 0.03], 0.01), 'black');             // their motor block
      put(`${s}Foot`, rbox([X(0.1), 0.006, 0.06], [0.1, 0.012, 0.27], 0.004), 'black');            // the sole
    }
  }
  return P;
}

/** The robot. pass 1..5; visor: the sensor line's colour (rgb 0..1) */
export function createRobot({ pass = 5, visor = [0.3, 0.85, 1.0] } = {}) {
  const M = MATS(pass, visor);
  const root = new THREE.Group(); root.name = 'robot';
  const bones = {}, rest = {}, list = [];
  for (const [name, parent, p] of SKELETON) {
    const b = new THREE.Bone(); b.name = name; rest[name] = V(p);
    if (parent) { b.position.copy(rest[name]).sub(rest[parent]); bones[parent].add(b); } else { b.position.copy(rest[name]); root.add(b); }
    bones[name] = b; list.push(b);
  }
  const P = parts(pass);
  if (pass < 5) {
    // a mesh per part on its joint (joint-local coordinates)
    for (const [bone, items] of Object.entries(P)) for (const [g, m] of items) { const mesh = new THREE.Mesh(g.translate(-rest[bone].x, -rest[bone].y, -rest[bone].z), M[m]); bones[bone].add(mesh); }
  } else {
    // one rigidly skinned mesh per material: every vertex weighs 1 on its joint
    const byMat = {};
    for (const [bone, items] of Object.entries(P)) for (const [g, m] of items) {
      const n = (g.index ? g.toNonIndexed() : g); n.deleteAttribute('uv'); if (!n.attributes.normal) n.computeVertexNormals();
      const k = n.attributes.position.count, bi = list.indexOf(bones[bone]);
      n.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(k * 4).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
      n.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(k * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      (byMat[m] ||= []).push(n);
    }
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(list);
    for (const [m, geos] of Object.entries(byMat)) {
      const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), M[m]); mesh.name = 'robot:' + m; mesh.frustumCulled = false;
      root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
    }
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  root.userData.bones = bones;
  return root;
}

/** the arms down from the T (createRigModel's ARM_DOWN), a slight elbow bend: the display pose */
export function standPose(robot) {
  const b = robot.userData.bones, q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  b.LeftArm.quaternion.copy(q(0, 0, -1.32)); b.RightArm.quaternion.copy(q(0, 0, 1.32));
  b.LeftForeArm.quaternion.copy(q(0, -0.2, 0)); b.RightForeArm.quaternion.copy(q(0, 0.2, 0));
  return robot;
}

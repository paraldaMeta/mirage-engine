// Mirage original code. kit/cyber's close-combat kit: blades, a scabbard, the swordsman's armour and the moves of the
// robots that fight hand to hand, as keyframed poses for @miragekit/play's rig (posed in code, no motion capture).
//   bladeParts(kind)  'katana' (a long curved blade, a guard, a wrapped grip) or 'sabre' (a straight short blade): parts
//                     in the sword's own frame (the guard at the origin, the blade along +y, its edge toward +z, the
//                     grip along -y); { s, m, l } by slot (shell, metal, lights)
//   scabbardParts()   the scabbard in its frame (the mouth at the origin, the blade's way in along +y)
//   roninParts()      the swordsman's silhouette on the rig, in the rig's T-pose space by bone: a broad sensor hat
//                     with a lit ring under the brim, shoulder plates, hanging hip plates
//   MOVES             the moves as keys in body space (+x the robot's left, +y up, +z forward, metres at scale 1):
//                       hip [dx, dy, dz] from the hips' rest, turn (the hips' yaw), lean (the trunk's pitch), twist
//                       (the chest's yaw on the hips), side (roll); lf / rf a foot [x, z, lift]; rh / lh a hand
//                       [x, y, z], or 'hilt' (on the grip in the scabbard), 'saya' (the left on the scabbard's mouth),
//                       'grip' (the left under the right); dir the blade's way, cut the swing ('lr', 'rl', 'down', 'up':
//                       the edge leads it), ldir the left hand's way (the scabbard swung as a club); sheath: the blade
//                       in the scabbard pulled out by that many metres (null: in the hand); saya 'hip' | 'hand'.
//                     A key leaves out what it does not change; a move fills each field forward. ev: [time, name].
//   samplePoseKeys(move, t, out)  the pose at t: numbers and arrays eased between keys, the rest stepped
// The moves take their design from sword and fist fighting in general (a draw from the scabbard, a flick of the
// blade, the slow return to the scabbard, a guard with crossed forearms); every name here is our own.
import * as THREE from 'three';
import { part, tf, ext, mergeParts, COL } from './robot-kit.js';

// ---------------------------------------------------------------------------------------------------------------
/** a blade: 'katana' (0.8 m, curved) or 'sabre' (0.64 m, straight); { s, m, l } geometries (null where empty) */
export function bladeParts(kind = 'katana') {
  const long = kind === 'katana', L = long ? 0.8 : 0.64, curve = long ? 0.05 : 0, w0 = long ? 0.032 : 0.04, w1 = long ? 0.026 : 0.034;
  const S = [], M = [], Lt = [];
  // the blade: a profile in the zy plane (z the width, the edge at +z), thin across x; it curves back toward the spine
  const N = 10, spine = [], edge = [];
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * L * (long ? 0.94 : 0.9), k = curve * (y / L) ** 2, w = w0 + (w1 - w0) * (i / N);
    spine.push([-k - w * 0.4, y]); edge.push([-k + w * 0.6, y]);
  }
  const tip = [-curve - (long ? 0.006 : 0), L];
  M.push(part(ext([...spine, tip, ...edge.reverse()], 0.008, 0.003, 'zy', 1), 'm', COL.natural, { r: 0.18 }));
  // the lit edge (a hair-line on the cutting side: the glint and the swing's trail read off it)
  const lit = [];
  for (let i = 0; i <= N; i++) { const y = (i / N) * L * 0.9 + 0.02, k = curve * (y / L) ** 2, w = w0 + (w1 - w0) * (i / N); lit.push([-k + w * 0.6 - 0.003, y]); }
  Lt.push(part(ext([...lit, ...lit.slice().reverse().map(([z, y]) => [z + 0.004, y])], 0.0095, 0, 'zy', 1), 'l', [1, 1, 1]));
  // the collar, the guard (an oval plate), the grip with its wrap and a cap
  M.push(part(tf(new THREE.BoxGeometry(0.012, 0.03, w0 + 0.008), [0, 0.015, 0.003]), 'm', COL.dark));
  S.push(part(tf(new THREE.CylinderGeometry(long ? 0.045 : 0.012, long ? 0.045 : 0.012, long ? 0.01 : 0.16, long ? 12 : 6), [0, 0, 0], long ? [0, 0, 0] : [Math.PI / 2, 0, 0], long ? [0.8, 1, 1] : [1, 1, 1]), 's', COL.graphite));
  const gl = long ? 0.25 : 0.14;
  S.push(part(tf(new THREE.CylinderGeometry(0.016, 0.017, gl, 8), [0, -gl / 2 - 0.005, 0], [0, 0, 0], [0.85, 1, 1.15]), 's', COL.rubber, { r: 0.8 }));
  if (long) for (let i = 0; i < 6; i++) S.push(part(tf(new THREE.TorusGeometry(0.0175, 0.0035, 3, 8), [0, -0.025 - i * 0.04, 0], [Math.PI / 2, 0, (i % 2 ? 0.6 : -0.6)], [0.85, 1.15, 1]), 's', COL.amber));
  S.push(part(tf(new THREE.CylinderGeometry(0.019, 0.017, 0.022, 8), [0, -gl - 0.012, 0], [0, 0, 0], [0.85, 1, 1.15]), 's', COL.graphite));
  return { s: mergeParts(S), m: mergeParts(M), l: mergeParts(Lt) };
}

/** the scabbard: the mouth at the origin, the blade's way in along +y, the edge side toward +z; { s, l } */
export function scabbardParts() {
  const S = [], Lt = [], L = 0.84;
  S.push(part(tf(new THREE.CylinderGeometry(0.02, 0.023, L, 10, 1, true), [0, L / 2, 0], [0, 0, 0], [0.8, 1, 1.5]), 's', COL.carbon, { r: 0.3 }));
  S.push(part(tf(new THREE.CylinderGeometry(0.027, 0.027, 0.04, 10), [0, 0.02, 0], [0, 0, 0], [0.8, 1, 1.5]), 's', COL.graphite));
  S.push(part(tf(new THREE.SphereGeometry(0.024, 10, 6), [0, L, 0], [0, 0, 0], [0.8, 1.2, 1.5]), 's', COL.graphite));
  S.push(part(tf(new THREE.BoxGeometry(0.03, 0.05, 0.02), [0, 0.12, -0.035]), 's', COL.graphite));   // the belt clip
  // a lit seam along the back: the scabbard reads in the dark; it flares with the draw's click
  Lt.push(part(tf(new THREE.BoxGeometry(0.006, L * 0.8, 0.004), [0, L * 0.5, -0.035]), 'l', [1, 1, 1]));
  return { s: mergeParts(S), l: mergeParts(Lt) };
}

/** the swordsman's silhouette, by bone, in the rig's T-pose space (parts for humanoidMeshes' `extra`) */
export function roninParts() {
  const head = [], chest = [], hips = [];
  // a broad, shallow sensor hat: a cone with a rolled rim, a lit ring under the brim (red: a hostile robot's light)
  head.push(part(tf(new THREE.CylinderGeometry(0.035, 0.31, 0.11, 18, 1, true), [0, 1.775, 0.01], [0.06, 0, 0]), 's', COL.graphite, { r: 0.55 }));
  head.push(part(tf(new THREE.CylinderGeometry(0.31, 0.31, 0.012, 18, 1), [0, 1.718, 0.007], [0.06, 0, 0]), 's', COL.carbon));
  head.push(part(tf(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), [0, 1.84, 0.015], [0.06, 0, 0]), 's', COL.dark));
  head.push(part(tf(new THREE.TorusGeometry(0.2, 0.005, 3, 24), [0, 1.712, 0.005], [Math.PI / 2 + 0.06, 0, 0]), 'l', [1, 1, 1]));
  // shoulder plates: three lames each side, stepped down and out
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const g = ext([[-0.1, 0], [0.1, 0], [0.09, -0.07], [-0.09, -0.07]], 0.012, 0.004, 'xy', 1).rotateY(s * Math.PI / 2).rotateZ(s * (0.5 + i * 0.1)).translate(s * (0.25 + i * 0.03), 1.47 - i * 0.055, 0);
    chest.push(part(g, 's', i === 1 ? COL.graphite : COL.carbon));
  }
  // hip plates: the back and the two sides (none in front: the thighs come forward on a lunge)
  for (const [a, w] of [[Math.PI, 0.2], [Math.PI / 2, 0.16], [-Math.PI / 2, 0.16]]) for (let i = 0; i < 2; i++) {
    const r = 0.18 + i * 0.012, x = Math.sin(a) * r, z = Math.cos(a) * r;
    const g = ext([[-w / 2, 0], [w / 2, 0], [w / 2 * 0.9, -0.17], [-w / 2 * 0.9, -0.17]], 0.012, 0.004, 'xy', 1).rotateX(-0.15).rotateY(a).translate(x, 0.93 - i * 0.12, z);
    hips.push(part(g, 's', i ? COL.graphite : COL.carbon));
  }
  return { Head: head, Chest: chest, Hips: hips };
}

// ---------------------------------------------------------------------------------------------------------------
// the moves
const REST = { hip: [0, 0, 0], turn: 0, lean: 0.05, twist: 0, side: 0, lf: [0.11, 0.03, 0], rf: [-0.11, -0.03, 0], rh: 'hilt', lh: 'saya', dir: [0, 0, 1], cut: 'lr', ldir: null, sheath: 0, saya: 'hip' };
// the draw stance: low, the right foot forward, the hips open, the right hand on the grip, the left on the mouth
const READY = { hip: [0, -0.2, 0], turn: 0.32, lean: 0.3, twist: -0.22, lf: [0.18, -0.3, 0], rf: [-0.16, 0.34, 0], rh: 'hilt', lh: 'saya', sheath: 0 };
const DRAW0 = { sheath: null, rh: [0.06, 1.0, 0.42], dir: [0.75, 0.05, 0.65], cut: 'lr' };
const DRAW1 = { rh: [-0.5, 1.2, 0.24], dir: [-0.92, 0.12, 0.3], cut: 'lr', turn: -0.5, twist: -0.3, lean: 0.25, hip: [0, -0.25, 0.15], rf: [-0.2, 0.55, 0], lf: [0.2, -0.45, 0] };
const FLICK = { rh: [-0.42, 1.0, 0.3], dir: [-0.4, -0.55, 0.73], cut: 'down', turn: -0.2, twist: 0, lean: 0.15, hip: [0, -0.15, 0], lh: 'saya', saya: 'hip' };
const NOTO = { sheath: 0.3, lh: 'saya', turn: 0.25, twist: 0.15, lean: 0.2, hip: [0, -0.12, 0], lf: [0.16, -0.12, 0], rf: [-0.14, 0.16, 0] };
/** the blade flicked clean, put to the scabbard's mouth and slid home slowly (the click at the end): keys from t0 */
const tail = (t0, slide = 0.9) => [[t0 + 0.35, FLICK], [t0 + 0.75, NOTO], [t0 + 0.75 + slide, { sheath: 0 }, 'lin'], [t0 + 1.05 + slide, REST]];
const tailEv = (t0, slide = 0.9) => [[t0 + 0.75 + slide, 'chin'], [t0 + 1.05 + slide, 'end']];
const stance = { lf: [0.16, 0.18, 0], rf: [-0.14, -0.2, 0] };

// fists: a guard at the face, jab (left), cross (right), a front kick
const FIST = { hip: [0, -0.06, 0], turn: 0.12, lean: 0.12, twist: 0, side: 0, ...stance, rh: [-0.12, 1.42, 0.24], lh: [0.12, 1.47, 0.28], dir: null, sheath: null, saya: 'none' };
// the heavy chassis: wide and low, the fists up at the chest
const HEAVY = { hip: [0, -0.1, 0], turn: 0, lean: 0.15, twist: 0, side: 0, lf: [0.2, 0.15, 0], rf: [-0.2, -0.15, 0], rh: [-0.22, 1.25, 0.3], lh: [0.22, 1.25, 0.3], dir: null, ldir: null, sheath: null, saya: 'none' };
// the sabre's guard: the blade up and forward
const SABRE = { hip: [0, -0.08, 0], turn: 0.1, lean: 0.1, twist: 0, side: 0, ...stance, rh: [-0.18, 1.12, 0.32], lh: null, dir: [0.15, 0.6, 0.78], cut: 'down', sheath: null, saya: 'none' };

const nine = [];
for (let i = 0; i < 9; i++) {
  const a = i * 2.44 + 0.4, last = i === 8;
  nine.push([0.6 + i * 0.04, last ? { rh: [-0.05, 1.25, 0.52], dir: [0, 0.02, 1], cut: 'down' } : { rh: [-0.05 + 0.24 * Math.cos(a), 1.22 + 0.22 * Math.sin(a), 0.44], dir: [0.75 * Math.cos(a + 1.6), 0.75 * Math.sin(a + 1.6), 0.6], cut: 'lr' }, 'lin']);
}

export const MOVES = {
  // ---- the swordsman (the boss): a draw from the scabbard in every move, the blade back in it after each
  guard: { dur: 1, loop: true, arms: true, keys: [[0, { rh: 'hilt', lh: 'saya', sheath: 0, saya: 'hip' }]], ev: [] },
  rainpierce: { dur: 4.4, keys: [[0, REST], [0.6, READY], [1.05, { hip: [0, -0.28, 0.1], lean: 0.42 }], [1.19, DRAW0, 'lin'], [1.27, DRAW1, 'out'], [1.95, {}], ...tail(1.95, 1.1)],
    ev: [[0, 'call'], [0.6, 'click'], [0.62, 'glint'], [0.76, 'breath'], [1.05, 'dash'], [1.19, 'cut'], [1.27, 'open'], ...tailEv(1.95, 1.1)] },
  stormdrop: { dur: 3.9, keys: [[0, REST], [0.12, { sheath: null, rh: [-0.05, 1.3, 0.35], dir: [0.3, 0.9, 0.3], cut: 'down' }], [0.3, { rh: [-0.1, 1.9, 0.05], dir: [0, 0.35, -0.94], cut: 'down', lh: 'grip', hip: [0, -0.3, 0], lean: 0.15, turn: 0, twist: 0, lf: [0.15, 0.05, 0], rf: [-0.15, -0.1, 0] }],
    [0.55, { hip: [0, -0.4, 0] }], [0.72, { hip: [0, 0, 0], lean: 0, lf: [0.15, 0.15, 0.35], rf: [-0.15, -0.05, 0.25] }], [0.95, { rh: [-0.08, 1.6, 0.45], dir: [0, 0.75, 0.66] }],
    [1.05, { rh: [-0.06, 0.8, 0.5], dir: [0, -0.7, 0.7], hip: [0, -0.35, 0.1], lean: 0.5, lf: [0.18, 0.3, 0], rf: [-0.18, -0.35, 0] }, 'out'], [1.9, {}], ...tail(1.9, 0.7)],
    ev: [[0, 'call'], [0.55, 'leap'], [1.05, 'cut'], [1.1, 'open'], ...tailEv(1.9, 0.7)] },
  risingtide: { dur: 3.2, keys: [[0, REST], [0.45, { hip: [0, -0.35, 0], lean: 0.35, turn: 0.5, twist: 0.3, lf: [0.2, 0.25, 0], rf: [-0.18, -0.3, 0] }],
    [0.46, { sheath: null, rh: [0.0, 0.75, 0.4], dir: [0.2, -0.55, 0.8], cut: 'up' }, 'lin'],
    [0.6, { rh: [-0.2, 1.85, 0.2], dir: [-0.1, 0.9, 0.4], cut: 'up', hip: [0, 0.08, 0.15], lean: -0.15, turn: -0.2, twist: -0.2, lf: [0.15, 0.1, 0], rf: [-0.15, 0.35, 0] }, 'out'], [1.3, {}], ...tail(1.3, 0.6)],
    ev: [[0, 'call'], [0.25, 'click'], [0.52, 'cut'], [0.6, 'open'], ...tailEv(1.3, 0.6)] },
  stonewake: { dur: 3.4, keys: [[0, REST], [0.3, { sheath: null, rh: [-0.3, 1.75, 0.05], dir: [-0.3, 0.5, -0.8], cut: 'down', lh: 'grip', hip: [0, -0.1, 0], turn: -0.3, twist: -0.2, lean: 0 }],
    [0.65, { hip: [0, -0.15, -0.05], lean: -0.1 }], [0.78, { rh: [-0.1, 0.72, 0.55], dir: [0, -0.85, 0.5], hip: [0, -0.38, 0.15], lean: 0.6, turn: 0, twist: 0, lf: [0.2, 0.35, 0], rf: [-0.18, -0.35, 0] }, 'out'], [1.5, {}], ...tail(1.5, 0.7)],
    ev: [[0, 'call'], [0.78, 'wake'], [0.85, 'open'], ...tailEv(1.5, 0.7)] },
  ninefold: { dur: 3.7, keys: [[0, REST], [0.15, { sheath: null, rh: [-0.05, 1.2, 0.38], dir: [0, 0.5, 0.86], cut: 'down', lh: 'grip', hip: [0, -0.2, 0], lean: 0.2, lf: [0.15, 0.25, 0], rf: [-0.15, -0.25, 0] }], [0.58, { hip: [0, -0.24, 0.05] }],
    ...nine, [0.98, { hip: [0, -0.2, 0.3], lean: 0.3 }], [1.8, {}], ...tail(1.8, 0.8)],
    ev: [[0, 'call'], [0.05, 'nine'], [0.62, 'cut'], [0.96, 'open'], ...tailEv(1.8, 0.8)] },
  twinsheath: { dur: 3.6, keys: [[0, REST], [0.35, READY], [0.45, DRAW0, 'lin'], [0.53, DRAW1, 'out'], [0.6, { lh: [0.25, 1.0, 0.25], ldir: [0.7, 0.2, 0.7], saya: 'hand' }],
    [0.78, { lh: [-0.35, 1.3, 0.4], ldir: [-0.7, 0.3, 0.6], turn: -0.75, twist: -0.4 }, 'out'], [1.5, {}], [1.75, { lh: 'saya', ldir: null, saya: 'hip', turn: -0.2, twist: 0 }], ...tail(1.75, 0.8)],
    ev: [[0, 'call'], [0.2, 'click'], [0.5, 'cut'], [0.74, 'cut2'], [0.8, 'open'], ...tailEv(1.75, 0.8)] },
  ebbdraw: { dur: 3.8, keys: [[0, REST], [0.5, { ...READY, twist: -0.45 }], [0.62, { sheath: null, rh: [-0.5, 1.25, 0.3], dir: [-0.95, 0.15, 0.25], cut: 'lr', turn: -0.7, hip: [0, -0.3, 0.3], rf: [-0.2, 0.7, 0], lf: [0.2, -0.4, 0] }, 'out'],
    [0.95, { rh: [-0.45, 1.3, 0.1], dir: [-0.6, 0.3, -0.7], turn: -0.8 }], [1.08, { rh: [0.25, 1.15, 0.4], dir: [0.9, 0.1, 0.4], cut: 'rl', turn: 0.4, twist: 0.3 }, 'out'], [1.8, {}], ...tail(1.8, 0.8)],
    ev: [[0, 'call'], [0.3, 'click'], [0.5, 'step'], [0.62, 'pull'], [1.04, 'cut'], [1.1, 'open'], ...tailEv(1.8, 0.8)] },
  kneel: { dur: 4.5, keys: [[0, { ...REST, sheath: null, rh: [-0.3, 0.9, 0.3], dir: [-0.2, -0.6, 0.8], cut: 'down' }], [0.6, { hip: [0, -0.5, 0], lean: 0.35, lf: [0.16, 0.3, 0], rf: [-0.14, -0.35, 0.3] }],
    [1.6, FLICK], [2.0, { ...NOTO, hip: [0, -0.5, 0], lf: [0.16, 0.3, 0], rf: [-0.14, -0.35, 0.3] }], [2.8, { sheath: 0 }, 'lin'], [3.4, { lean: 0.8 }], [4.5, { lean: 0.8 }]],
    ev: [[2.8, 'chin'], [3.4, 'bow']] },
  rise: { dur: 1.0, keys: [[0, { ...REST, hip: [0, -0.5, 0], lean: 0.8, lf: [0.16, 0.3, 0], rf: [-0.14, -0.35, 0.3] }], [1.0, REST]], ev: [] },
  // ---- fists
  fists: { dur: 1, loop: true, arms: true, keys: [[0, FIST]], ev: [] },
  jab: { dur: 0.5, keys: [[0, FIST], [0.2, { lh: [0.14, 1.44, 0.14], turn: 0.25 }], [0.3, { lh: [0.08, 1.45, 0.64], turn: -0.2, hip: [0, -0.06, 0.1] }, 'out'], [0.5, FIST]], ev: [[0.27, 'hit']] },
  cross: { dur: 0.62, keys: [[0, FIST], [0.26, { rh: [-0.17, 1.4, 0.08], turn: -0.25 }], [0.38, { rh: [-0.06, 1.45, 0.64], turn: 0.4, lean: 0.18, hip: [0, -0.08, 0.14] }, 'out'], [0.62, FIST]], ev: [[0.35, 'hit']] },
  kick: { dur: 0.9, keys: [[0, FIST], [0.36, { hip: [0, -0.04, -0.06], lean: -0.1 }], [0.5, { rf: [-0.12, 0.62, 0.85], lean: -0.28, turn: -0.3 }, 'out'], [0.68, { rf: [-0.12, 0.3, 0.25] }], [0.9, FIST]], ev: [[0.48, 'hit']] },
  block: { dur: 1, loop: true, keys: [[0, { ...FIST, lh: [0.06, 1.52, 0.3], rh: [-0.06, 1.46, 0.31], lean: 0.2, hip: [0, -0.1, 0] }]], ev: [] },
  // ---- the sabre
  sabre: { dur: 1, loop: true, arms: true, keys: [[0, SABRE]], ev: [] },
  slash: { dur: 0.8, keys: [[0, SABRE], [0.4, { rh: [-0.3, 1.72, 0.05], dir: [-0.2, 0.6, -0.75], turn: -0.2 }], [0.5, { rh: [0.1, 0.95, 0.45], dir: [0.6, -0.4, 0.7], turn: 0.35, lean: 0.25, hip: [0, -0.15, 0.12] }, 'out'], [0.8, SABRE]], ev: [[0.46, 'hit']] },
  sweep: { dur: 0.75, keys: [[0, SABRE], [0.36, { rh: [0.25, 1.2, 0.25], dir: [0.9, 0.1, 0.3], cut: 'lr', turn: 0.45 }], [0.48, { rh: [-0.45, 1.2, 0.3], dir: [-0.9, 0.1, 0.35], cut: 'lr', turn: -0.45 }, 'out'], [0.75, SABRE]], ev: [[0.44, 'hit']] },
  thrust: { dur: 0.85, keys: [[0, SABRE], [0.4, { rh: [-0.2, 1.25, 0.0], dir: [0, 0.1, 1], turn: 0.3, lean: 0 }], [0.52, { rh: [-0.1, 1.3, 0.55], dir: [0, 0, 1], hip: [0, -0.1, 0.3], lean: 0.25, turn: -0.1, rf: [-0.14, 0.45, 0] }, 'out'], [0.85, SABRE]], ev: [[0.5, 'hit']] },
  // ---- the heavy chassis: a wide, low stance; the cannon on the left forearm, the gun on the right
  hguard: { dur: 1, loop: true, arms: true, keys: [[0, HEAVY]], ev: [] },
  hcannon: { dur: 1.7, keys: [[0, HEAVY], [0.3, { lh: [0.1, 1.42, 0.5], ldir: [0, 0, 1], turn: -0.35, lean: 0.05, lf: [0.2, 0.25, 0], rf: [-0.22, -0.35, 0] }], [1.25, {}],
    [1.32, { lh: [0.18, 1.58, 0.28], lean: -0.15, hip: [0, -0.06, -0.14] }, 'out'], [1.7, HEAVY]], ev: [[0, 'call'], [0.6, 'charge'], [1.0, 'lock'], [1.25, 'fire']] },
  hslide: { dur: 1.25, keys: [[0, HEAVY], [0.3, { hip: [0, -0.36, 0], lean: 0.5, lf: [0.22, 0.35, 0], rf: [-0.22, -0.4, 0] }], [0.36, { lean: 0.62 }], [0.62, { hip: [0, -0.42, -0.05], lean: -0.12, side: 0.12, lf: [0.26, 0.55, 0], rf: [-0.25, -0.5, 0] }, 'out'], [1.25, HEAVY]],
    ev: [[0, 'call'], [0.3, 'dash'], [0.6, 'stop'], [1.05, 'end']] },
  hjump: { dur: 1.0, keys: [[0, HEAVY], [0.32, { hip: [0, -0.46, 0], lean: 0.4, rh: [-0.3, 1.0, 0.12], lh: [0.3, 1.0, 0.12] }], [0.45, { hip: [0, 0, 0], lean: 0, lf: [0.2, 0.1, 0.45], rf: [-0.2, -0.1, 0.35], rh: [-0.42, 1.62, 0.2], lh: [0.42, 1.62, 0.2] }, 'out'], [1.0, {}]], ev: [[0.32, 'jump']] },
  hperch: { dur: 1, loop: true, keys: [[0, { ...HEAVY, hip: [0, -0.4, 0], lean: 0.45, lf: [0.24, 0.2, 0], rf: [-0.24, -0.2, 0], rh: [-0.3, 0.75, 0.35], lh: [0.3, 0.8, 0.3] }]], ev: [] },
  hland: { dur: 1.2, keys: [[0, { ...HEAVY, hip: [0, -0.56, 0.05], lean: 0.6, lf: [0.3, 0.35, 0], rf: [-0.3, -0.35, 0], rh: [-0.32, 0.4, 0.5], lh: [0.32, 0.45, 0.45] }], [0.55, {}], [1.2, HEAVY]], ev: [] },
  hgrab: { dur: 2.7, keys: [[0, HEAVY], [0.45, { rh: [-0.6, 1.35, 0.35], lh: [0.6, 1.35, 0.35], lean: 0.1 }], [0.6, { rh: [-0.12, 1.45, 0.78], lh: [0.12, 1.45, 0.78], lean: 0.25, hip: [0, -0.1, 0.2] }, 'out'],
    [0.9, { rh: [-0.12, 1.95, 0.42], lh: [0.12, 1.95, 0.42], lean: -0.15, hip: [0, 0, 0] }], [1.9, {}], [2.05, { rh: [-0.1, 1.5, 0.8], lh: [0.1, 1.5, 0.8], lean: 0.35 }, 'out'], [2.7, HEAVY]],
    ev: [[0, 'call'], [0.58, 'grab'], [0.9, 'hold'], [2.0, 'throw']] },
  hbarrage: { dur: 2.6, keys: [[0, HEAVY], [0.3, { rh: [-0.14, 1.36, 0.56], dir: [0, 0, 1], turn: 0.25, lh: [0.25, 1.2, 0.25] }], [2.2, {}], [2.6, HEAVY]], ev: [[0, 'call'], [0.45, 'fire'], [1.9, 'cease']] },
  hsalvo: { dur: 1.9, keys: [[0, HEAVY], [0.4, { lean: -0.28, hip: [0, -0.2, 0], rh: [-0.38, 1.1, 0.18], lh: [0.38, 1.1, 0.18] }], [1.4, {}], [1.9, HEAVY]], ev: [[0, 'call'], [0.55, 'launch']] },
  hpunch: { dur: 0.85, keys: [[0, HEAVY], [0.32, { rh: [-0.32, 1.4, -0.15], turn: -0.45, lean: 0 }], [0.44, { rh: [-0.05, 1.45, 0.78], turn: 0.45, lean: 0.25, hip: [0, -0.12, 0.2] }, 'out'], [0.85, HEAVY]], ev: [[0.42, 'hit']] },
  hcharge: { dur: 1.6, keys: [[0, HEAVY], [0.4, { turn: 0.9, twist: 0.2, lean: 0.38, hip: [0, -0.25, 0], lh: [0.15, 1.35, 0.15], rh: [-0.25, 1.2, 0.05], lf: [0.2, 0.35, 0], rf: [-0.2, -0.4, 0] }], [0.95, {}], [1.6, HEAVY]],
    ev: [[0, 'call'], [0.4, 'charge'], [0.9, 'stop']] },
  hstagger: { dur: 1.5, keys: [[0, HEAVY], [0.2, { lean: -0.35, hip: [0, -0.2, -0.15], side: 0.2, rh: [-0.45, 1.0, 0.0], lh: [0.45, 1.1, 0.0] }], [1.1, {}], [1.5, HEAVY]], ev: [[0, 'open'], [1.3, 'close']] },
};
// every key complete: fields carried forward (the first key over REST for the swordsman's moves, else as written)
for (const m of Object.values(MOVES)) {
  let prev = m.keys[0][1].saya === 'none' ? {} : REST;
  for (const k of m.keys) { k[1] = { ...prev, ...k[1] }; prev = k[1]; }
}

const ease = { io: (u) => u * u * (3 - 2 * u), out: (u) => 1 - (1 - u) ** 3, lin: (u) => u };
const mix = (a, b, u) => (typeof a === 'number' && typeof b === 'number' ? a + (b - a) * u
  : Array.isArray(a) && Array.isArray(b) ? a.map((x, i) => x + (b[i] - x) * u) : a);
/** the pose of `move` (MOVES[name]) at t seconds into `out` (an object, reused) */
export function samplePoseKeys(move, t, out = {}) {
  const K = move.keys;
  if (move.loop || K.length === 1) return Object.assign(out, K[0][1]);
  let i = 0;
  while (i < K.length - 1 && K[i + 1][0] <= t) i++;
  const a = K[i], b = K[i + 1];
  if (!b) return Object.assign(out, a[1]);
  const u = ease[b[2] || 'io'](Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-6, b[0] - a[0]))));
  for (const k of Object.keys(a[1])) out[k] = mix(a[1][k], b[1][k], u);
  return out;
}
/** the cut's axis in body space: the edge leads the swing (edge = dir x axis) */
export const CUT_AXIS = { lr: [0, 1, 0], rl: [0, -1, 0], down: [-1, 0, 0], up: [1, 0, 0] };

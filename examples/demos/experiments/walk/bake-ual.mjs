// Bake: retarget Quaternius' Universal Animation Library (CC0) clips onto createRigModel's skeleton and re-encode them
// small for the cyber kit. Reads the downloaded GLBs (never shipped in the repo), writes
// packages/assets/src/kits/cyber/motion-data.js and out/bake-report.json.
//   node examples/demos/experiments/walk/bake-ual.mjs <UAL1 .glb> <UAL2 .glb>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRigModel } from '../../../../packages/play/src/rig-model.js';
import { retargetClip } from '../../../../packages/play/src/retarget.js';
import { decodeMotion } from '../../../../packages/assets/src/kits/cyber/motion-clips.js';
import { encodeClips, toB64 } from './clip-codec.js';
import { gaitMetrics } from './gait-metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url)), outDir = path.join(here, '..', 'out');
const dataFile = path.join(here, '../../../../packages/assets/src/kits/cyber/motion-data.js');
fs.mkdirSync(outDir, { recursive: true });
const [ual1, ual2] = process.argv.slice(2);
if (!ual1 || !ual2) { console.error('usage: bake-ual.mjs <UAL1.glb> <UAL2.glb>'); process.exit(2); }

function glbJson(buf) { const len = buf.readUInt32LE(12); return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')); }
async function load(file) {
  const b = fs.readFileSync(file), ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const g = await new GLTFLoader().parseAsync(ab, '');
  const json = glbJson(b), NC = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  // bytes of keyframe data per clip as stored in the GLB (each accessor once: inputs are shared between channels)
  const rawBytes = Object.fromEntries(json.animations.map((an) => {
    const ids = new Set(an.samplers.flatMap((s) => [s.input, s.output]));
    return [an.name, [...ids].reduce((t, i) => t + json.accessors[i].count * NC[json.accessors[i].type] * 4, 0)];
  }));
  return { scene: g.scene, clips: g.animations, rawBytes, fileBytes: b.length };
}
const A = await load(ual1), B = await load(ual2);

// the bone map: UAL's Rigify-style DEF bones -> createRigModel's names. Unmapped source bones (spine.002,
// shoulders, fingers) still animate the source, so their turn is carried in the children's model-space turn.
const MAP1 = { root: 'Root', 'DEF-hips': 'Hips', 'DEF-spine.001': 'Spine', 'DEF-spine.003': 'Chest', 'DEF-neck': 'Neck', 'DEF-head': 'Head' };
for (const [s, t] of [['L', 'Left'], ['R', 'Right']]) Object.assign(MAP1, { [`DEF-thigh.${s}`]: `${t}UpLeg`, [`DEF-shin.${s}`]: `${t}Leg`, [`DEF-foot.${s}`]: `${t}Foot`, [`DEF-toe.${s}`]: `${t}Toe`,
  [`DEF-upper_arm.${s}`]: `${t}Arm`, [`DEF-forearm.${s}`]: `${t}ForeArm`, [`DEF-hand.${s}`]: `${t}Hand` });
// UAL2: the same skeleton (same rest positions) under Unreal-style names
const MAP2 = { root: 'Root', pelvis: 'Hips', spine_01: 'Spine', spine_03: 'Chest', neck_01: 'Neck', Head: 'Head' };
for (const [s, t] of [['l', 'Left'], ['r', 'Right']]) Object.assign(MAP2, { [`thigh_${s}`]: `${t}UpLeg`, [`calf_${s}`]: `${t}Leg`, [`foot_${s}`]: `${t}Foot`, [`ball_${s}`]: `${t}Toe`,
  [`upperarm_${s}`]: `${t}Arm`, [`lowerarm_${s}`]: `${t}ForeArm`, [`hand_${s}`]: `${t}Hand` });
// GLTFLoader names nodes through PropertyBinding.sanitizeNodeName ('DEF-thigh.L' -> 'DEF-thighL')
const clean = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [THREE.PropertyBinding.sanitizeNodeName(k), v]));
A.map = clean(MAP1); B.map = clean(MAP2);

// [source, clip, out name, travels?, loop?]  (no strafe, turn-in-place or second death in the free packs)
const WANT = [
  [A, 'Idle_Loop', 'idle', false, true], [A, 'Walk_Loop', 'walk', true, true], [A, 'Jog_Fwd_Loop', 'run', true, true],
  [A, 'Crouch_Fwd_Loop', 'crouchWalk', true, true], [B, 'Zombie_Walk_Fwd_Loop', 'brokenWalk', true, true],
  [A, 'Hit_Chest', 'hitChest', false, false], [A, 'Hit_Head', 'hitHead', false, false], [B, 'Hit_Knockback', 'hitKnockback', false, false], [A, 'Death01', 'die', false, false],
];

const rig = createRigModel(), target = rig.root;
const rest = {}; target.traverse((o) => { if (o.isBone) rest[o.name] = o.position.toArray(); });
target.updateMatrixWorld(true);
const report = { source: { ual1: path.basename(ual1), ual1Bytes: A.fileBytes, ual2: path.basename(ual2), ual2Bytes: B.fileBytes }, clips: [] };

// the source's rest: the node transforms as loaded (a T-pose, like ours)
const strip = (clip) => new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => t.name.endsWith('.quaternion') || /^(root|DEF-hips|pelvis)\.position$/.test(t.name)));
const baked = [];
let groundFix = 0;
for (const [src, name, out, travel, loop] of WANT) {
  const clip0 = src.clips.find((c) => c.name === name);
  if (!clip0) { console.log('missing', name); continue; }
  const clip = retargetClip(strip(clip0), src.scene, target, { map: src.map, fps: 60, name: out });
  // the source's root never travels in these (in-place) clips: drop its track
  clip.tracks = clip.tracks.filter((t) => t.name !== 'Root.position' && t.name !== 'Root.quaternion');
  // feet on the ground: one hips-height correction for the whole set, measured on idle (scale by hip height
  // brings the legs within a few mm; this takes out the rest)
  if (out === 'idle') groundFix = -gaitMetrics(target, clip, { travel: false }).groundCm / 100;
  const ht = clip.tracks.find((t) => t.name === 'Hips.position');
  if (ht) for (let i = 1; i < ht.values.length; i += 3) ht.values[i] += groundFix;
  let speed = 0;
  if (travel) {
    // root motion from the feet: the speed at which the planted foot stands still
    speed = -gaitMetrics(target, clip, { travel: false }).plantedVzMedian;
    for (let it = 0; it < 3; it++) {
      const withRoot = new THREE.AnimationClip(out, clip.duration, [...clip.tracks, new THREE.VectorKeyframeTrack('Root.position', [0, clip.duration], [0, 0, 0, 0, 0, speed * clip.duration])]);
      speed -= gaitMetrics(target, withRoot).plantedVzMedian;
    }
  }
  baked.push({ clip, speed, loop, src: name, file: src === A ? 'UAL1' : 'UAL2', raw: src.rawBytes[name] });
}

const ship = encodeClips(baked, { hipsRest: rest.Hips });
const b64 = toB64(ship.bytes);
const decoded = decodeMotion({ meta: ship.meta, b64 }).clips;
let offset = 0;
for (const [i, b] of baked.entries()) {
  const m = ship.meta[i], dec = decoded[i];
  const n = dec.tracks.reduce((t, tr) => t + (tr.name === 'Root.position' ? 0 : tr.times.length * 3 * 2), 0);
  const bin = ship.bytes.subarray(offset, offset + n); offset += n;
  // decode error: worst bone angle between the float bake and the decoded clip
  let worst = 0;
  for (const tr of dec.tracks) {
    if (!tr.name.endsWith('.quaternion')) continue;
    const ref = b.clip.tracks.find((t) => t.name === tr.name); if (!ref) continue;
    const ia = tr.createInterpolant(), ib = ref.createInterpolant();
    for (let k = 0; k <= 60; k++) { const t = (k / 60) * dec.duration, qa = new THREE.Quaternion().fromArray(ia.evaluate(t)).normalize(), qb = new THREE.Quaternion().fromArray(ib.evaluate(t)).normalize(); worst = Math.max(worst, THREE.MathUtils.radToDeg(qa.angleTo(qb))); }
  }
  const metrics = b.speed ? gaitMetrics(target, dec) : null;
  const row = { name: m[0], from: `${b.file}:${b.src}`, duration: m[1], speed: m[2], loop: !!m[3], bytes: { glbAllTracks: b.raw, keys: n, gzip: zlib.gzipSync(bin, { level: 9 }).length }, worstAngleDeg: +worst.toFixed(2), metrics };
  report.clips.push(row);
  console.log(row.name.padEnd(13), String(row.duration).padStart(6), 's', 'speed', String(row.speed).padStart(6), 'bytes', row.bytes, 'err', row.worstAngleDeg, metrics ? `slide ${metrics.slideMean}/${metrics.slideMedian}/${metrics.slideP95} cm/s knee ${metrics.kneeL} bob ${metrics.bobCm}` : '');
}
const metaJson = JSON.stringify(ship.meta);
const mod = `// Generated by examples/demos/experiments/walk/bake-ual.mjs; decoded by motion-clips.js. Data, not code to edit.
//
// Source: Quaternius, "Universal Animation Library" [Standard] and "Universal Animation Library 2" [Standard], from
// OpenGameArt, where the author uploaded them: https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
// (${A.fileBytes.toLocaleString('en')} B GLB used: AnimationLibrary_Godot_Standard.glb) and
// https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip (UAL2_Standard.glb), downloaded
// 2026-11-12 (archive contents dated 2025-03-19 and 2026-01-23).
// Licence, as the License.txt in each archive reads: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
// https://creativecommons.org/publicdomain/zero/1.0/ ... Models by @Quaternius". (The author's site now publishes a
// later licence that says it does not apply to assets obtained under an earlier one.)
// Clips (source name -> ours): ${baked.map((b) => `${b.src} -> ${b.clip.name}`).join(', ')}.
// Retargeted onto createRigModel's skeleton (@miragekit/play retargetClip), 30 Hz, int16 rotations; ${ship.bytes.length} bytes of keys.
export const MOTION = { meta: ${metaJson}, b64: '${b64}' };
`;
fs.writeFileSync(dataFile, mod);
report.total = { clips: baked.length, keys: ship.bytes.length, meta: metaJson.length, base64: b64.length, jsModule: Buffer.byteLength(mod), gzipModule: zlib.gzipSync(mod, { level: 9 }).length, groundFixCm: +(groundFix * 100).toFixed(2) };
fs.writeFileSync(path.join(outDir, 'bake-report.json'), JSON.stringify(report, null, 1));
console.log('total', report.total);

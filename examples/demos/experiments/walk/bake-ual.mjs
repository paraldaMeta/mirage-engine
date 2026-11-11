// Experiment: retarget Quaternius' Universal Animation Library (CC0) clips onto createRigModel's skeleton and
// re-encode them small. Reads the downloaded GLBs (never shipped in the repo), writes walk/ual-clips.js and
// out/bake-report.json.
//   node examples/demos/experiments/walk/bake-ual.mjs <UAL1 .glb> <UAL2 .glb>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRigModel } from '../../../../packages/play/src/rig-model.js';
import { retargetClip } from '../../../../packages/play/src/retarget.js';
import { encodeClips, decodeClips, toB64 } from './clip-codec.js';
import { gaitMetrics } from './gait-metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url)), outDir = path.join(here, '..', 'out');
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

// [source, out name, travels?, loop?]
const WANT = [
  [A, 'Idle_Loop', 'idle', false, true], [A, 'Walk_Loop', 'walk', true, true], [A, 'Jog_Fwd_Loop', 'run', true, true], [A, 'Sprint_Loop', 'sprint', true, true],
  [A, 'Crouch_Fwd_Loop', 'crouchWalk', true, true], [B, 'Zombie_Walk_Fwd_Loop', 'brokenWalk', true, true],
  [A, 'Pistol_Aim_Neutral', 'aimPistol', false, true], [A, 'Hit_Chest', 'hitChest', false, false], [A, 'Hit_Head', 'hitHead', false, false],
  [B, 'Hit_Knockback', 'hitKnockback', false, false], [A, 'Death01', 'die', false, false],
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
  let clip = retargetClip(strip(clip0), src.scene, target, { map: src.map, fps: 60, name: out });
  // the source's root never travels in these (in-place) clips: drop its track
  clip.tracks = clip.tracks.filter((t) => t.name !== 'Root.position' && t.name !== 'Root.quaternion');
  // feet on the ground: one hips-height correction for the whole set, measured on idle (scale by hip height
  // brings the legs within a few mm; this takes out the rest)
  const hipsT = () => clip.tracks.find((t) => t.name === 'Hips.position');
  if (out === 'idle') groundFix = -gaitMetrics(target, clip, { travel: false }).groundCm / 100;
  const ht = hipsT(); if (ht) for (let i = 1; i < ht.values.length; i += 3) ht.values[i] += groundFix;
  let speed = 0, m0 = null;
  if (travel) {
    // root motion from the feet: the speed at which the planted foot stands still
    m0 = gaitMetrics(target, clip, { travel: false });
    speed = -m0.plantedVzMedian;
    for (let it = 0; it < 3; it++) {
      const withRoot = new THREE.AnimationClip(out, clip.duration, [...clip.tracks, new THREE.VectorKeyframeTrack('Root.position', [0, clip.duration], [0, 0, 0, 0, 0, speed * clip.duration])]);
      speed -= gaitMetrics(target, withRoot).plantedVzMedian;
    }
  }
  const events = travel ? (m0 || gaitMetrics(target, clip, { travel: false })).downs : [];
  baked.push({ clip, speed, loop, events, src: name, file: src === A ? 'UAL1' : 'UAL2', raw: src.rawBytes[name] });
}

// encode at three rates; the 30 Hz one ships
const sizes = {};
for (const fps of [15, 20, 30]) {
  const enc = encodeClips(baked, { fps, rest });
  sizes[fps] = enc;
}
const ship = sizes[30];
const decoded = decodeClips(ship, rest);
// per clip: bytes and quality
let offset = 0;
for (const [i, b] of baked.entries()) {
  const per = {};
  for (const fps of [15, 20, 30]) {
    const m = sizes[fps].meta[i];
    const n = m.tracks.reduce((t, tr) => t + (tr.c ? 1 : m.keys) * 3 * 2, 0), metaBytes = JSON.stringify(m).length;
    per[fps] = { keys: n, meta: metaBytes, total: n + metaBytes };
  }
  const m = ship.meta[i], n = per[30].keys;
  const bin = ship.bytes.subarray(offset, offset + n); offset += n;
  const floatKept = b.clip.tracks.reduce((t, tr) => t + (tr.times.length / 2) * 4 + (tr.values.length / 2) * 4, 0);   // the kept tracks at 30 Hz as float32 (the 60 Hz bake halved)
  // decode error: worst bone angle between the float bake and the decoded clip
  const dec = decoded[i];
  let worst = 0;
  for (const tr of dec.tracks) {
    if (!tr.name.endsWith('.quaternion')) continue;
    const ref = b.clip.tracks.find((t) => t.name === tr.name); if (!ref) continue;
    const ia = tr.createInterpolant(), ib = ref.createInterpolant();
    for (let k = 0; k <= 60; k++) { const t = (k / 60) * dec.duration, qa = new THREE.Quaternion().fromArray(ia.evaluate(t)).normalize(), qb = new THREE.Quaternion().fromArray(ib.evaluate(t)).normalize(); worst = Math.max(worst, THREE.MathUtils.radToDeg(qa.angleTo(qb))); }
  }
  const metrics = b.speed ? gaitMetrics(target, dec) : null;
  const row = {
    name: m.name, from: `${b.file}:${b.src}`, duration: m.duration, speed: m.speed, loop: m.loop,
    tracks: { animated: m.tracks.filter((t) => !t.c).length, constant: m.tracks.filter((t) => t.c).length },
    bytes: { glbAllTracks: b.raw, float32Kept30Hz: Math.round(floatKept), enc15: per[15].total, enc20: per[20].total, enc30: per[30].total, enc30Gzip: zlib.gzipSync(bin, { level: 9 }).length + per[30].meta },
    worstAngleDeg30Hz: +worst.toFixed(2), events: m.events.length, metrics,
  };
  report.clips.push(row);
  console.log(row.name.padEnd(13), String(row.duration).padStart(6), 's', 'speed', String(row.speed).padStart(6), 'tracks', row.tracks, 'bytes', row.bytes, 'err', row.worstAngleDeg30Hz, metrics ? `slide ${metrics.slideMean}/${metrics.slideP95}/${metrics.slidePeak} cm/s knee ${metrics.kneeL} bob ${metrics.bobCm}` : '');
}
const b64 = toB64(ship.bytes), metaJson = JSON.stringify(ship.meta);
report.total = {
  clips: baked.length, keys: ship.bytes.length, meta: metaJson.length, base64: b64.length, jsModule: 0,
  gzipKeys: zlib.gzipSync(ship.bytes, { level: 9 }).length, gzipModule: 0, groundFixCm: +(groundFix * 100).toFixed(2),
  glbBoth: A.fileBytes + B.fileBytes, glbRawSelected: baked.reduce((t, b) => t + b.raw, 0),
};
const mod = `// Generated by bake-ual.mjs from Quaternius' Universal Animation Library 1 and 2 [Standard] (CC0 1.0,
// https://creativecommons.org/publicdomain/zero/1.0/), retargeted onto createRigModel's skeleton and re-encoded
// (clip-codec.js): ${baked.length} clips, ${ship.bytes.length} bytes of keys at 30 Hz. Experiment data, not engine code.
export default { meta: ${metaJson}, b64: '${b64}' };
`;
fs.writeFileSync(path.join(here, 'ual-clips.js'), mod);
report.total.jsModule = Buffer.byteLength(mod); report.total.gzipModule = zlib.gzipSync(mod, { level: 9 }).length;
fs.writeFileSync(path.join(outDir, 'bake-report.json'), JSON.stringify(report, null, 1));
console.log('total', report.total);

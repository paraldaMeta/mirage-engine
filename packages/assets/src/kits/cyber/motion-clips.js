// kit/cyber's borrowed motion: locomotion, hits and a death captured by Quaternius (Universal Animation Library 1 and 2,
// CC0; motion-data.js says where from), retargeted onto @miragekit/play's rig (createRigModel: 20 bones, T-pose rest,
// +Z forward) and re-encoded small. This file decodes them.
//   motionClips()        { clips: [THREE.AnimationClip] for the rig (Root.position rebuilt from the clip's speed, so
//                        createAnimator's rootMotion works), byName: { name: { clip, frames, keys, duration, speed, loop } } }
//   samplePose(m, t, out) the pose of byName[name] at t (looped when the clip loops) into out: per MOTION_BONES a
//                        quaternion (x, y, z, w), then the hips' position; for bodies posed in code (the civilians)
// Clips: idle, walk (1.13 m/s), run (a jog, 5.8 m/s), crouchWalk, brokenWalk (a zombie's), hitChest, hitHead,
// hitKnockback, die.
import * as THREE from 'three';
import { MOTION } from './motion-data.js';

/** the rotation tracks' bone order (the hips' position is the last track) */
export const MOTION_BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
export const MOTION_FPS = 30;
const NB = MOTION_BONES.length, STRIDE = NB * 4 + 3, HIPS = [0, 0.95, 0];

let cache = null;
export const motionClips = () => (cache ||= decodeMotion(MOTION));
/** { meta, b64 } (motion-data.js's form) -> { clips, byName } */
export function decodeMotion(data) {
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(data.b64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(data.b64, 'base64'));
  const i16 = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength >> 1), clips = [], byName = {};
  let k = 0;
  for (const [name, duration, speed, loop, mask] of data.meta) {
    const keys = Math.max(1, Math.round(duration * MOTION_FPS)) + 1, frames = new Float32Array(keys * STRIDE);
    const times = Float32Array.from({ length: keys }, (_, i) => (i / (keys - 1)) * duration), tracks = [];
    for (let ti = 0; ti <= NB; ti++) {
      const c = (mask >> ti) & 1, n = c ? 1 : keys;
      if (ti < NB) {
        let px = 0, py = 0, pz = 0, pw = 1;
        for (let i = 0; i < keys; i++) {
          const j = c ? 0 : i, x = i16[k + j * 3] / 32767, y = i16[k + j * 3 + 1] / 32767, z = i16[k + j * 3 + 2] / 32767;
          let w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)), qx = x, qy = y, qz = z;
          if (i && qx * px + qy * py + qz * pz + w * pw < 0) { qx = -qx; qy = -qy; qz = -qz; w = -w; }   // one hemisphere
          frames.set([qx, qy, qz, w], i * STRIDE + ti * 4); px = qx; py = qy; pz = qz; pw = w;
        }
        const v = new Float32Array(n * 4); for (let i = 0; i < n; i++) v.set(frames.subarray(i * STRIDE + ti * 4, i * STRIDE + ti * 4 + 4), i * 4);
        tracks.push(new THREE.QuaternionKeyframeTrack(MOTION_BONES[ti] + '.quaternion', c ? [0] : times, v));
      } else {
        for (let i = 0; i < keys; i++) { const j = c ? 0 : i; for (let a = 0; a < 3; a++) frames[i * STRIDE + NB * 4 + a] = HIPS[a] + i16[k + j * 3 + a] / 10000; }
        const v = new Float32Array(n * 3); for (let i = 0; i < n; i++) v.set(frames.subarray(i * STRIDE + NB * 4, i * STRIDE + NB * 4 + 3), i * 3);
        tracks.push(new THREE.VectorKeyframeTrack('Hips.position', c ? [0] : times, v));
      }
      k += n * 3;
    }
    if (speed) tracks.push(new THREE.VectorKeyframeTrack('Root.position', [0, duration], [0, 0, 0, 0, 0, speed * duration]));
    const clip = new THREE.AnimationClip(name, duration, tracks);
    clip.userData = { loop: !!loop, source: 'ual' };
    clips.push(clip);
    byName[name] = { clip, frames, keys, duration, speed, loop: !!loop };
  }
  return { clips, byName };
}

/** the pose of one decoded clip (motionClips().byName[name]) at t seconds into out (Float32Array(MOTION_BONES.length * 4 + 3)) */
export function samplePose(m, t, out) {
  const d = m.duration, u = m.loop ? ((t % d) + d) % d : Math.min(Math.max(t, 0), d), f = (u / d) * (m.keys - 1);
  const i0 = Math.min(m.keys - 1, Math.floor(f)), i1 = Math.min(m.keys - 1, i0 + 1), a = f - i0, F = m.frames, o0 = i0 * STRIDE, o1 = i1 * STRIDE;
  for (let b = 0; b < NB; b++) {
    const p = o0 + b * 4, q = o1 + b * 4;
    const s = F[p] * F[q] + F[p + 1] * F[q + 1] + F[p + 2] * F[q + 2] + F[p + 3] * F[q + 3] < 0 ? -a : a;
    let x = F[p] * (1 - a) + F[q] * s, y = F[p + 1] * (1 - a) + F[q + 1] * s, z = F[p + 2] * (1 - a) + F[q + 2] * s, w = F[p + 3] * (1 - a) + F[q + 3] * s;
    const l = 1 / Math.hypot(x, y, z, w); x *= l; y *= l; z *= l; w *= l;
    out[b * 4] = x; out[b * 4 + 1] = y; out[b * 4 + 2] = z; out[b * 4 + 3] = w;
  }
  for (let c = 0; c < 3; c++) out[NB * 4 + c] = F[o0 + NB * 4 + c] * (1 - a) + F[o1 + NB * 4 + c] * a;
  return out;
}

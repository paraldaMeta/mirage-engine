// The encoder for the cyber kit's motion clips (packages/assets/src/kits/cyber/motion-clips.js holds the decoder and
// the data). One clip = evenly spaced keys at 30 Hz on a fixed bone order (MOTION_BONES), per track either one
// constant key or a key per frame:
//   rotation  a quaternion with w >= 0, stored as x, y, z in int16 (v * 32767); w = sqrt(1 - x^2 - y^2 - z^2)
//   position  Hips only (the last track), the offset from the rig's rest position in int16 tenths of a millimetre
//   travel    not stored as keys: `speed` (m/s along +Z) re-creates the Root.position track on decode
// Per clip the metadata is one row: [name, duration, speed, loop, constant-track mask].
import * as THREE from 'three';
import { MOTION_BONES, MOTION_FPS } from '../../../../packages/assets/src/kits/cyber/motion-clips.js';

const Q16 = 32767, P16 = 10000;   // position unit: 0.1 mm

/** clips: [{ clip (AnimationClip on createRigModel's skeleton), speed, loop }] -> { meta, bytes: Uint8Array } */
export function encodeClips(list, { tolDeg = 0.25, hipsRest = [0, 0.95, 0] } = {}) {
  const out = [], meta = [];
  const tol = Math.cos((tolDeg * Math.PI) / 180 / 2);
  for (const { clip, speed = 0, loop = true } of list) {
    const n = Math.max(1, Math.round(clip.duration * MOTION_FPS));
    let mask = 0;
    const tracks = [...MOTION_BONES.map((b) => [b + '.quaternion', 'q']), ['Hips.position', 'p']];
    tracks.forEach(([name, p], ti) => {
      const tr = clip.tracks.find((t) => t.name === name);
      const it = tr?.createInterpolant(), samples = [];
      for (let i = 0; i <= n; i++) samples.push(it ? Array.from(it.evaluate(Math.min(clip.duration, (i / n) * clip.duration))) : p === 'q' ? [0, 0, 0, 1] : hipsRest.slice());
      if (p === 'q') {
        const q0 = new THREE.Quaternion().fromArray(samples[0]).normalize();
        const constant = samples.every((s) => Math.abs(q0.dot(new THREE.Quaternion().fromArray(s).normalize())) >= tol);
        if (constant) mask |= 1 << ti;
        for (const s of constant ? [samples[0]] : samples) { const q = new THREE.Quaternion().fromArray(s).normalize(); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); out.push(Math.round(q.x * Q16), Math.round(q.y * Q16), Math.round(q.z * Q16)); }
      } else {
        const constant = samples.every((s) => Math.hypot(s[0] - samples[0][0], s[1] - samples[0][1], s[2] - samples[0][2]) < 0.0005);
        if (constant) mask |= 1 << ti;
        for (const s of constant ? [samples[0]] : samples) out.push(...[0, 1, 2].map((k) => Math.max(-32768, Math.min(32767, Math.round((s[k] - hipsRest[k]) * P16)))));
      }
    });
    meta.push([clip.name, +clip.duration.toFixed(4), +speed.toFixed(4), loop ? 1 : 0, mask]);
  }
  const i16 = Int16Array.from(out);
  return { meta, bytes: new Uint8Array(i16.buffer) };
}

export const toB64 = (u8) => Buffer.from(u8).toString('base64');

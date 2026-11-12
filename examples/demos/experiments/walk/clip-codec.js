// Experiment: a small clip format for the code-authored rig (createRigModel's bone names).
//
// One clip = evenly spaced keys at `fps`; per bone either one constant key or a key per frame.
//   rotation  a quaternion with w >= 0, stored as x, y, z in int16 (v * 32767); w = sqrt(1 - x^2 - y^2 - z^2)
//   position  Hips only, the offset from the rig's rest position in int16 tenths of a millimetre (+/- 3.27 m)
//   travel    not stored as keys: `speed` (m/s along +Z) re-creates the Root.position track on decode, the
//             form createAnimator's rootMotion reads, so loops are seamless and the feet match the travel.
// The metadata (names, counts, flags, events) is a small JSON object; the keys are one Int16Array, base64'd.
import * as THREE from 'three';

const Q16 = 32767, P16 = 10000;   // position unit: 0.1 mm

/** clips: [{ clip (AnimationClip on the rig), speed, loop, events }] -> { meta, bytes: Uint8Array } */
export function encodeClips(list, { fps = 30, tolDeg = 0.25, rest } = {}) {
  const out = [], meta = [];
  const tol = Math.cos((tolDeg * Math.PI) / 180 / 2);
  for (const { clip, speed = 0, loop = true, events = [] } of list) {
    const n = Math.max(1, Math.round(clip.duration * fps)), m = { name: clip.name, duration: +clip.duration.toFixed(4), fps, keys: n + 1, speed: +speed.toFixed(4), loop, events, tracks: [] };
    for (const tr of clip.tracks) {
      const dot = tr.name.lastIndexOf('.'), bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
      if (bone === 'Root' && prop === 'position') continue;   // travel is `speed`
      if (prop === 'position' && bone !== 'Hips') continue;
      const it = tr.createInterpolant(), size = prop === 'quaternion' ? 4 : 3, samples = [];
      for (let i = 0; i <= n; i++) samples.push(Array.from(it.evaluate(Math.min(clip.duration, (i / n) * clip.duration))));
      if (prop === 'quaternion') {
        const q0 = new THREE.Quaternion().fromArray(samples[0]).normalize();
        const constant = samples.every((s) => Math.abs(q0.dot(new THREE.Quaternion().fromArray(s).normalize())) >= tol);
        const use = constant ? [samples[0]] : samples;
        m.tracks.push({ bone, p: 'q', c: constant ? 1 : 0 });
        for (const s of use) { const q = new THREE.Quaternion().fromArray(s).normalize(); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); out.push(Math.round(q.x * Q16), Math.round(q.y * Q16), Math.round(q.z * Q16)); }
      } else {
        const r = rest[bone], constant = samples.every((s) => Math.hypot(s[0] - samples[0][0], s[1] - samples[0][1], s[2] - samples[0][2]) < 0.0005);
        const use = constant ? [samples[0]] : samples;
        m.tracks.push({ bone, p: 'p', c: constant ? 1 : 0 });
        for (const s of use) out.push(...[0, 1, 2].map((k) => Math.max(-32768, Math.min(32767, Math.round((s[k] - r[k]) * P16)))));
      }
      void size;
    }
    meta.push(m);
  }
  const i16 = Int16Array.from(out);
  return { meta, bytes: new Uint8Array(i16.buffer) };
}

/** -> [AnimationClip] for createRigModel's skeleton (or any with the same names); rest = { bone: [x, y, z] } local rest positions */
export function decodeClips({ meta, bytes }, rest) {
  const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  let k = 0;
  const clips = [];
  for (const m of meta) {
    const times = Float32Array.from({ length: m.keys }, (_, i) => (i / (m.keys - 1)) * m.duration), tracks = [];
    for (const t of m.tracks) {
      const n = t.c ? 1 : m.keys;
      if (t.p === 'q') {
        const v = new Float32Array(m.keys * 4);
        let px = 0, py = 0, pz = 0, pw = 1;
        for (let i = 0; i < m.keys; i++) {
          const j = t.c ? 0 : i, x = i16[k + j * 3] / Q16, y = i16[k + j * 3 + 1] / Q16, z = i16[k + j * 3 + 2] / Q16;
          let w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)), qx = x, qy = y, qz = z;
          if (i && qx * px + qy * py + qz * pz + w * pw < 0) { qx = -qx; qy = -qy; qz = -qz; w = -w; }   // one hemisphere
          v.set([qx, qy, qz, w], i * 4); px = qx; py = qy; pz = qz; pw = w;
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${t.bone}.quaternion`, times, v));
        k += n * 3;
      } else {
        const r = rest[t.bone], v = new Float32Array(m.keys * 3);
        for (let i = 0; i < m.keys; i++) { const j = t.c ? 0 : i; for (let c = 0; c < 3; c++) v[i * 3 + c] = r[c] + i16[k + j * 3 + c] / P16; }
        tracks.push(new THREE.VectorKeyframeTrack(`${t.bone}.position`, times, v));
        k += n * 3;
      }
    }
    if (m.speed) tracks.push(new THREE.VectorKeyframeTrack('Root.position', [0, m.duration], [0, 0, 0, 0, 0, m.speed * m.duration]));
    const clip = new THREE.AnimationClip(m.name, m.duration, tracks);
    clip.userData = { loop: m.loop, ...(m.events?.length ? { events: m.events } : {}), source: 'ual' };
    clips.push(clip);
  }
  return clips;
}

export const toB64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(String.fromCharCode(...u8)));
export const fromB64 = (s) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

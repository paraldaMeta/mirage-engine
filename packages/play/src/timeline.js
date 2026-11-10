// Mirage original code.

// ---------------------------------------------------------------------------
// A small sequencer: camera moves, object transforms, animation clips, audio cues and events on one clock.
//
//   import { createTimeline } from '@mirage/play';
//   const tl = createTimeline({ duration: 8, tracks: [
//     { type: 'camera', target: world.camera, keys: [
//       { t: 0, position: [0, 2, 6], lookAt: [0, 1, 0], fov: 50 }, { t: 4, position: [5, 2, 3], lookAt: [0, 1, 0], fov: 35, ease: 'inOut' }] },
//     { type: 'transform', target: door, keys: [{ t: 1, rotation: [0, 0, 0] }, { t: 2, rotation: [0, 1.6, 0], ease: 'out' }] },
//     { type: 'animation', animator: anim, clips: [{ t: 0, clip: 'walk', duration: 3 }, { t: 3, clip: 'wave', fade: 0.3 }] },
//     { type: 'audio', cues: [{ t: 1, sound: 'creak' }], play: (cue, offset) => sfx.play(cue.sound, { offset }) },
//     { type: 'event', keys: [{ t: 2, name: 'doorOpen' }] },
//   ] });
//   tl.on('doorOpen', (e) => ...); tl.play();
//   each frame: tl.update(dt);            scrub: tl.seek(3.2);
//
// What is seen at time t (transforms, camera, bones) is a function of t alone: seek(t) gives the same picture
// whatever was shown before, which is what makes scrubbing and frame-exact capture work. What happens at a time
// (events, audio cues) fires when playback crosses it, in time order; seek() does not fire them unless asked to
// ({ fire: true } fires everything between the old time and the new one when moving forwards).
// While a timeline is driving an animator, do not also call that animator's update().
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const EASE = {
  linear: (u) => u, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), inOut: (u) => u * u * (3 - 2 * u), step: (u) => (u < 1 ? 0 : 1),
};
const vec = (v) => (v == null ? null : v.isVector3 ? v.clone() : new THREE.Vector3(...v));
const quat = (k) => (k.quaternion ? (k.quaternion.isQuaternion ? k.quaternion.clone() : new THREE.Quaternion(...k.quaternion))
  : k.rotation ? new THREE.Quaternion().setFromEuler(k.rotation.isEuler ? k.rotation : new THREE.Euler(...k.rotation)) : null);
const _a = new THREE.Vector3(), _m = new THREE.Matrix4();

// the keys either side of t that carry `field`, and how far between them (eased by the later key)
function span(keys, field, t) {
  let a = null, b = null;
  for (const k of keys) { if (k[field] == null) continue; if (k.t <= t) a = k; else { b = k; break; } }
  if (!a) return b ? [b, b, 0] : null;
  if (!b) return [a, a, 0];
  const u = (t - a.t) / (b.t - a.t);
  return [a, b, (typeof b.ease === 'function' ? b.ease : EASE[b.ease || 'linear'])(u)];
}

function transformTrack(def, camera) {
  const target = def.target;
  const keys = def.keys.map((k) => ({ t: k.t, ease: k.ease, position: vec(k.position), quaternion: quat(k), scale: vec(k.scale), lookAt: vec(k.lookAt), fov: k.fov })).sort((a, b) => a.t - b.t);
  const withPos = keys.filter((k) => k.position);
  return {
    end: keys.length ? keys[keys.length - 1].t : 0,
    apply(t) {
      let s = span(keys, 'position', t);
      if (s) {
        if (def.curve === 'smooth' && s[0] !== s[1]) {
          // Catmull-Rom through the neighbouring keys: a camera path without corners
          const i = withPos.indexOf(s[0]), p0 = withPos[Math.max(0, i - 1)].position, p3 = withPos[Math.min(withPos.length - 1, i + 2)].position, p1 = s[0].position, p2 = s[1].position, u = s[2], u2 = u * u, u3 = u2 * u;
          for (const c of ['x', 'y', 'z']) target.position[c] = 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * u3);
        } else target.position.lerpVectors(s[0].position, s[1].position, s[2]);
      }
      if ((s = span(keys, 'scale', t))) target.scale.lerpVectors(s[0].scale, s[1].scale, s[2]);
      if ((s = span(keys, 'lookAt', t))) {
        _a.lerpVectors(s[0].lookAt, s[1].lookAt, s[2]);
        // as Object3D.lookAt, without reading a parent's matrix: cameras look down -Z, other objects along +Z
        if (target.isCamera || target.isLight) _m.lookAt(target.position, _a, target.up); else _m.lookAt(_a, target.position, target.up);
        target.quaternion.setFromRotationMatrix(_m);
      } else if ((s = span(keys, 'quaternion', t))) target.quaternion.slerpQuaternions(s[0].quaternion, s[1].quaternion, s[2]);
      if (camera && (s = span(keys, 'fov', t)) && target.isPerspectiveCamera) {
        const fov = s[0].fov + (s[1].fov - s[0].fov) * s[2];
        if (fov !== target.fov) { target.fov = fov; target.updateProjectionMatrix(); }
      }
      target.updateMatrixWorld();
    },
  };
}

function animationTrack(def) {
  const anim = def.animator;
  const clips = def.clips.map((c) => { const cd = anim.clips.get(c.clip); if (!cd) throw new Error(`timeline: no clip "${c.clip}"`); return { t: c.t, clip: c.clip, speed: c.speed ?? 1, offset: c.offset ?? 0, fade: c.fade ?? 0, over: c.over ?? null, duration: c.duration ?? cd.duration / (c.speed ?? 1) }; }).sort((a, b) => a.t - b.t);
  return {
    end: clips.reduce((m, c) => Math.max(m, c.t + c.duration), 0),
    apply(t) {
      // the clip under the playhead, and the one before it while this one fades in
      let i = -1;
      for (let j = 0; j < clips.length; j++) if (clips[j].t <= t) i = j;
      if (i < 0) { if (def.rest !== false) anim.reset(); return; }
      const c = clips[i], local = (x, tt) => Math.min(tt - x.t, x.duration) * x.speed + x.offset;
      const w = c.fade > 0 && i > 0 ? Math.min(1, (t - c.t) / c.fade) : 1;
      // `over`: a clip that keys part of the body (a wave) plays over another one (idle) instead of over the bind pose
      const under = (x, k) => { if (x.over) { if (!anim.clips.get(x.over)) throw new Error(`timeline: no clip "${x.over}"`); anim.poseClip(x.over, t - x.t, k, false); } };
      if (w < 1) { const p = clips[i - 1]; under(p, 1); anim.poseClip(p.clip, local(p, t), 1, false, !!p.over); under(c, w); anim.poseClip(c.clip, local(c, t), w); }
      else { under(c, 1); anim.poseClip(c.clip, local(c, t), 1, true, !!c.over); }
    },
  };
}

/** A timeline over `tracks`. `duration` defaults to the last key or clip end. */
export function createTimeline({ tracks = [], duration = null, loop = false, speed = 1 } = {}) {
  const visual = [], points = [], listeners = new Map();
  let end = 0;
  for (const def of tracks) {
    if (def.type === 'transform' || def.type === 'camera') { const tr = transformTrack(def, def.type === 'camera'); visual.push(tr); end = Math.max(end, tr.end); }
    else if (def.type === 'animation') { const tr = animationTrack(def); visual.push(tr); end = Math.max(end, tr.end); }
    else if (def.type === 'event') for (const k of def.keys) { points.push({ t: k.t, fire: () => emit({ ...k, time: k.t }) }); end = Math.max(end, k.t); }
    else if (def.type === 'audio') for (const cue of def.cues) { points.push({ t: cue.t, audio: true, cue, def, fire: (offset) => { def.play?.(cue, offset); emit({ name: 'audio', cue, offset, time: cue.t }); } }); end = Math.max(end, cue.t); }
    else throw new Error(`timeline: unknown track type "${def.type}"`);
  }
  points.sort((a, b) => a.t - b.t);
  function emit(e) { for (const k of [e.name, '*']) for (const fn of listeners.get(k) || []) fn(e); }
  // everything in (from, to], or [0, to] when playback starts from the very beginning
  function fire(from, to, first) { for (const p of points) if ((p.t > from || (first && p.t === from)) && p.t <= to) p.fire(Math.max(0, to - p.t)); }
  let time = 0, playing = false, fresh = true;
  const api = {
    duration: duration ?? end, loop, speed,
    get time() { return time; },
    get playing() { return playing; },
    play(from) { if (from != null) { time = from; fresh = true; } playing = true; return api; },
    pause() { playing = false; return api; },
    stop() { playing = false; for (const def of tracks) if (def.type === 'audio') def.stop?.(); return api; },
    /** Show time t. Events and cues between are skipped unless `fire` (forwards only). */
    seek(t, { fire: f = false } = {}) {
      t = Math.min(Math.max(t, 0), api.duration);
      if (f && t > time) fire(time, t, fresh && time === 0);
      time = t; fresh = t === 0;
      for (const tr of visual) tr.apply(time);
      return api;
    },
    /** Advance while playing. Returns true when the picture changed. */
    update(dt) {
      if (!playing || !(dt > 0)) return false;
      let t = time + dt * api.speed;
      if (t >= api.duration) {
        fire(time, api.duration, fresh);
        if (api.loop && api.duration > 0) { t %= api.duration; fresh = true; fire(0, t, true); fresh = false; }
        else { t = api.duration; playing = false; emit({ name: 'end', time: t }); }
      } else { fire(time, t, fresh); }
      fresh = false; time = t;
      for (const tr of visual) tr.apply(time);
      return true;
    },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
  };
  return api;
}

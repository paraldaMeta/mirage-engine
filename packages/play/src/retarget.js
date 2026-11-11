// Mirage original code.

// ---------------------------------------------------------------------------
// Retargeting: play a clip made for one humanoid skeleton on another.
//
//   import { humanoidMap, retargetClip } from '@mirage/play';
//   const map = humanoidMap(sourceRoot, targetRoot);            // { sourceBone: targetBone } by humanoid role
//   const clip = retargetClip(walk, sourceRoot, targetRoot, { map });
//   const anim = createAnimator(targetRoot, [clip], ...);
//
// Both models must be in their rest pose when this is called. Two corrections make differing rigs agree:
//   - bone frames: each bone's turn away from its rest pose is carried over in model space, so it does not matter
//     which way the two rigs' bone axes point, or that one has bones the other lacks (those keep their rest);
//   - rest pose: where the rests differ (a T-pose source, a target modelled with its arms down), the target limb
//     is first swung onto the source limb's rest direction, so the same clip gives the same silhouette.
// Translations (hips bob, root travel) are scaled by the ratio of hip heights.
// The result is baked at `fps` keys per second; clip.userData (loop flag, events) is carried over.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// humanoid roles, each with the name fragments that mean it, most specific first; the side is found separately
const ROLES = [
  ['root', ['root', 'armature']], ['hips', ['hips', 'pelvis', 'hip']], ['chest', ['chest', 'spine2', 'spine1', 'upperchest']], ['spine', ['spine', 'torso']],
  ['neck', ['neck']], ['head', ['head']],
  ['upperLeg', ['upleg', 'upperleg', 'thigh', 'hip'], true], ['lowerLeg', ['lowerleg', 'leg', 'calf', 'shin', 'knee'], true],
  ['toe', ['toebase', 'toe', 'ball'], true], ['foot', ['foot', 'ankle'], true],
  ['lowerArm', ['forearm', 'lowerarm', 'elbow'], true], ['upperArm', ['upperarm', 'arm', 'shoulder'], true], ['hand', ['hand', 'wrist'], true],
];
function roleOf(name) {
  let n = name.replace(/^mixamorig:?/i, '');
  let side = '';
  const m = /^(left|right)|(left|right)$|[._\- ]([lr])$|^([lr])[._\- ]/i.exec(n);
  const c = m ? null : /([a-z])([LR])$/.exec(n);   // hipL: what a loader makes of hip.L
  if (m) { side = (m[1] || m[2] || m[3] || m[4])[0].toUpperCase(); n = n.replace(m[0], ''); } else if (c) { side = c[2]; n = n.slice(0, -1); }
  n = n.toLowerCase().replace(/[^a-z0-9]/g, '');
  return { side, n };
}
/** The humanoid roles found under a model: { hips: node, upperLegL: node, ... }. */
export function humanoidRoles(root) {
  const out = {}, rank = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const { side, n } = roleOf(o.name);
    for (const [role, keys, sided] of ROLES) {
      if (!!sided !== !!side) continue;
      const i = keys.indexOf(n);
      if (i < 0) continue;
      const key = role + side;
      // one bone per role; a better-ranked name wins ('arm' over 'shoulder' where a rig has both)
      if (!(key in out) || i < rank[key]) { out[key] = o; rank[key] = i; }
      break;
    }
  });
  return out;
}
/** { source bone name: target bone name } for every humanoid role both models have. */
export function humanoidMap(source, target) {
  const a = humanoidRoles(source), b = humanoidRoles(target), map = {};
  for (const k of Object.keys(a)) if (b[k]) map[a[k].name] = b[k].name;
  return map;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

/** `clip` (for the skeleton under `source`) as a new clip for the skeleton under `target`. Options: `map`
 *  ({ sourceBone: targetBone }, default humanoidMap), `fps` (30), `scale` (translation scale, default the ratio
 *  of hip heights), `matchRest` (true: swing target limbs onto the source's rest directions first), `name`. */
export function retargetClip(clip, source, target, { map = null, fps = 30, scale = null, matchRest = true, name = clip.name } = {}) {
  map = map || humanoidMap(source, target);
  const pairs = [];
  for (const [sn, tn] of Object.entries(map)) {
    const s = source.name === sn ? source : source.getObjectByName(sn), t = target.name === tn ? target : target.getObjectByName(tn);
    if (s && t) pairs.push({ s, t });
  }
  if (!pairs.length) throw new Error('retarget: no bone of the map exists in both models');
  // parents before children, so a target bone's parent is final when its local rotation is derived
  const depth = (o) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
  pairs.sort((a, b) => depth(a.t) - depth(b.t));
  const pairOfS = new Map(pairs.map((p) => [p.s, p])), pairOfT = new Map(pairs.map((p) => [p.t, p]));

  // model space = relative to each model's root, so where the models stand in their scenes does not matter
  const inv = { s: new THREE.Matrix4(), t: new THREE.Matrix4() };
  const frame = () => { source.updateWorldMatrix(true, true); target.updateWorldMatrix(true, true); inv.s.copy(source.matrixWorld).invert(); inv.t.copy(target.matrixWorld).invert(); };
  const modelQ = (o, which, out) => { _m.multiplyMatrices(inv[which], o.matrixWorld).decompose(_p, out, _s); return out; };
  const modelP = (o, which, out) => out.setFromMatrixPosition(_m.multiplyMatrices(inv[which], o.matrixWorld));
  frame();
  const sNodes = [], tNodes = [];
  source.traverse((o) => sNodes.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  target.traverse((o) => tNodes.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  const put = (list) => { for (const n of list) { n.o.position.copy(n.p); n.o.quaternion.copy(n.q); n.o.scale.copy(n.s); } };

  for (const pr of pairs) {
    pr.sRest = modelQ(pr.s, 's', new THREE.Quaternion()); pr.tRest = modelQ(pr.t, 't', new THREE.Quaternion());
    pr.sPos = modelP(pr.s, 's', new THREE.Vector3()); pr.tPos = modelP(pr.t, 't', new THREE.Vector3());
    pr.fix = new THREE.Quaternion();
  }
  if (matchRest) {
    // a limb's rest direction: towards its mapped child, where exactly one child is mapped (a spine that forks
    // into arms and neck has no single direction; the hips are left alone). The last bone of a limb has no
    // child to aim at and takes its parent's correction: a forearm whose rig has no hand hangs as its upper arm does.
    const kidsOf = (pr, which) => pairs.filter((c) => { for (let p = c[which].parent; p; p = p.parent) { if (p === pr[which]) return true; if ((which === 's' ? pairOfS : pairOfT).has(p)) return false; } return false; });
    for (const pr of pairs) {
      const ks = kidsOf(pr, 's'), kt = kidsOf(pr, 't');
      if (ks.length === 1 && kt.length === 1 && ks[0] === kt[0]) {
        const ds = ks[0].sPos.clone().sub(pr.sPos), dt = ks[0].tPos.clone().sub(pr.tPos);
        if (ds.lengthSq() > 1e-10 && dt.lengthSq() > 1e-10) pr.fix.setFromUnitVectors(dt.normalize(), ds.normalize());
      } else if (!kt.length) {
        for (let p = pr.t.parent; p; p = p.parent) if (pairOfT.has(p)) { pr.fix.copy(pairOfT.get(p).fix); break; }
      }
    }
  }
  const hipS = pairs.find((p) => /hip|pelvis/i.test(p.s.name)) || pairs[0];
  const k = scale ?? (hipS.sPos.y > 1e-6 && hipS.tPos.y > 1e-6 ? hipS.tPos.y / hipS.sPos.y : 1);

  // the source tracks, sampled into the source nodes
  const tracks = [];
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.'), prop = tr.name.slice(dot + 1), nm = tr.name.slice(0, dot);
    const node = source.name === nm ? source : source.getObjectByName(nm);
    if (node && (prop === 'position' || prop === 'quaternion' || prop === 'scale')) tracks.push({ node, prop, interp: tr.createInterpolant(undefined) });
  }
  const moved = new Set(tracks.filter((t) => t.prop === 'position' && pairOfS.has(t.node)).map((t) => pairOfS.get(t.node)));
  const n = Math.max(1, Math.round(clip.duration * fps)), times = new Float32Array(n + 1);
  const out = pairs.map((pr) => ({ pr, q: new Float32Array((n + 1) * 4), p: moved.has(pr) ? new Float32Array((n + 1) * 3) : null, last: null }));
  const delta = new THREE.Quaternion(), want = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), loc = new THREE.Quaternion();
  try {
    for (let i = 0; i <= n; i++) {
      const t = times[i] = (i / n) * clip.duration;
      for (const tr of tracks) tr.node[tr.prop].fromArray(tr.interp.evaluate(t));
      put(tNodes);
      source.updateWorldMatrix(false, true);
      for (const o of out) {
        const { pr } = o;
        // how far the source bone has turned from its rest, in model space; the same turn on the corrected target
        delta.copy(modelQ(pr.s, 's', _q)).multiply(want.copy(pr.sRest).invert());
        want.copy(delta).multiply(pr.fix).multiply(pr.tRest);
        if (o.p) {
          modelP(pr.s, 's', _v).sub(pr.sPos).multiplyScalar(k).add(pr.tPos);
          // model-space point into the target parent's frame
          if (pr.t.parent && pr.t !== target) { pr.t.parent.updateWorldMatrix(true, false); _v.applyMatrix4(target.matrixWorld).applyMatrix4(_m.copy(pr.t.parent.matrixWorld).invert()); }
          pr.t.position.copy(_v); _v.toArray(o.p, i * 3);
        }
        if (pr.t.parent && pr.t !== target) { pr.t.parent.updateWorldMatrix(true, false); _m.multiplyMatrices(inv.t, pr.t.parent.matrixWorld).decompose(_p, parentQ, _s); loc.copy(parentQ).invert().multiply(want); } else loc.copy(want);
        if (o.last && o.last.dot(loc) < 0) loc.set(-loc.x, -loc.y, -loc.z, -loc.w);   // keys on one hemisphere
        (o.last ||= new THREE.Quaternion()).copy(loc);
        pr.t.quaternion.copy(loc); loc.toArray(o.q, i * 4);
      }
    }
  } finally { put(sNodes); put(tNodes); source.updateWorldMatrix(false, true); target.updateWorldMatrix(false, true); }
  const made = [];
  for (const o of out) {
    made.push(new THREE.QuaternionKeyframeTrack(`${o.pr.t.name}.quaternion`, times, o.q));
    if (o.p) made.push(new THREE.VectorKeyframeTrack(`${o.pr.t.name}.position`, times, o.p));
  }
  const result = new THREE.AnimationClip(name, clip.duration, made);
  result.userData = { ...(clip.userData || {}), retargeted: { scale: k, bones: pairs.length } };
  return result;
}

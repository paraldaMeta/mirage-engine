// Mirage original code.

// ---------------------------------------------------------------------------
// Inverse kinematics on top of an animated pose: two-bone limbs, look-at chains, feet on the ground.
//
//   import { solveTwoBone, solveLookAt, createFootIK } from '@mirage/play';
//   solveTwoBone(arm, foreArm, hand, target, { pole: elbowHint });       // hand reaches target (world space)
//   solveLookAt([neck, head], target, { share: [0.35, 0.65], limit: 1.2 });
//   const feet = createFootIK(model, { ground: (x, z, y) => grid.groundAt(x, z, y, 0.4),
//     hips: 'Hips', legs: [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']] });
//   anim.post.push((a) => { feet.update(a.dt); solveLookAt(...); });   // after every pose the animator writes
//
// All solvers read the pose that is there (the animation), change as little of it as reaches the goal, and blend
// by `weight`; none keeps hidden state except the foot solver's smoothing. Targets are in world space. The solvers
// refresh the world matrices they need, so they can run straight after bones were written.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), T = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), N = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

// rotate `bone` by the world-space rotation `q`, about its own origin
function rotateWorld(bone, q) {
  // world' = q * world  =>  local' = parent^-1 * q * parent * local
  if (bone.parent) { bone.parent.getWorldQuaternion(q2); q3.copy(q2).invert().multiply(q).multiply(q2); } else q3.copy(q);
  bone.quaternion.premultiply(q3);
  bone.updateWorldMatrix(false, true);
}

/** Bend the chain upper -> lower -> end so `end` reaches `target` (world). The bend plane stays the pose's own
 *  unless `pole` (a world point the middle joint should point towards) is given; a straight limb with no pole
 *  has no plane of its own and bends towards `hint` (a world direction; default the upper bone's local +Z).
 *  Out of reach, the limb straightens towards the target. Returns how far `end` is from the target afterwards. */
export function solveTwoBone(upper, lower, end, target, { pole = null, weight = 1, hint = null, stretch = 0.999 } = {}) {
  if (weight <= 0) return 0;
  const u0 = weight < 1 ? upper.quaternion.clone() : null, l0 = weight < 1 ? lower.quaternion.clone() : null;
  upper.updateWorldMatrix(true, true);
  A.setFromMatrixPosition(upper.matrixWorld); B.setFromMatrixPosition(lower.matrixWorld); C.setFromMatrixPosition(end.matrixWorld);
  const lab = A.distanceTo(B), lbc = B.distanceTo(C);
  T.copy(target).sub(A);
  // never bent further than `stretch` allows, but a pose the animation left straighter than that is kept
  const reach = Math.max((lab + lbc) * stretch, Math.min(A.distanceTo(C), lab + lbc)), lat = Math.min(Math.max(T.length(), Math.abs(lab - lbc) + 1e-6), reach);
  if (T.lengthSq() < 1e-12) T.set(0, -1, 0);
  T.normalize();
  // the plane the limb bends in: through the target direction and the pole, else the pose's own carried over
  v1.copy(C).sub(A); v2.copy(B).sub(A);
  if (pole) N.copy(v3.copy(pole).sub(A)).cross(T).negate();   // T x pole
  else {
    N.copy(v1).cross(v2);
    if (N.lengthSq() < 1e-8 * lab * lab * lbc * lbc) N.copy(T).cross(hint || v3.set(0, 0, 1).transformDirection(upper.matrixWorld));
    else if (v1.lengthSq() > 1e-12) N.applyQuaternion(q1.setFromUnitVectors(v3.copy(v1).normalize(), T));
  }
  // remove what of the normal lies along the target direction, so the two are square
  N.addScaledVector(T, -N.dot(T));
  if (N.lengthSq() < 1e-12) { N.set(1, 0, 0).addScaledVector(T, -T.x); if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(T, -T.z); }
  N.normalize();
  const perp = v3.copy(N).cross(T);   // in the plane, towards the middle joint
  const cosA = Math.min(1, Math.max(-1, (lab * lab + lat * lat - lbc * lbc) / (2 * lab * lat))), sinA = Math.sqrt(1 - cosA * cosA);
  // where the middle joint goes, then swing each bone onto its new direction (twist stays the animation's)
  const mid = v1.copy(T).multiplyScalar(cosA * lab).addScaledVector(perp, sinA * lab);
  rotateWorld(upper, q1.setFromUnitVectors(v2.normalize(), v3.copy(mid).normalize()));
  B.setFromMatrixPosition(lower.matrixWorld); C.setFromMatrixPosition(end.matrixWorld);
  v2.copy(C).sub(B).normalize();
  v3.copy(T).multiplyScalar(lat).add(A).sub(B).normalize();
  rotateWorld(lower, q1.setFromUnitVectors(v2, v3));
  if (weight < 1) { upper.quaternion.copy(u0.slerp(upper.quaternion, weight)); lower.quaternion.copy(l0.slerp(lower.quaternion, weight)); upper.updateWorldMatrix(false, true); }
  return C.setFromMatrixPosition(end.matrixWorld).distanceTo(target);
}

/** Turn a bone, or a chain of them (parent first), so the last one's `forward` axis faces `target` (world).
 *  `share` splits the turn along the chain; `limit` (radians) caps the total turn away from the animated pose.
 *  Returns the angle that was left over (0 when the target was within the limit). */
export function solveLookAt(bones, target, { forward = null, share = null, limit = Math.PI, weight = 1 } = {}) {
  const chain = Array.isArray(bones) ? bones : [bones], last = chain[chain.length - 1];
  if (weight <= 0) return 0;
  let left = 0, budget = limit;
  for (let i = 0; i < chain.length; i++) {
    const bone = chain[i];
    bone.updateWorldMatrix(i === 0, true);
    let rest = 0; for (let j = i; j < chain.length; j++) rest += share ? share[j] : 1;
    const part = (share ? share[i] : 1) / rest;   // the last bone takes all that remains
    v1.copy(forward || v3.set(0, 0, 1)).transformDirection(last.matrixWorld);
    v2.copy(target).sub(A.setFromMatrixPosition(last.matrixWorld));
    if (v2.lengthSq() < 1e-12) return 0;
    v2.normalize();
    const full = v1.angleTo(v2);
    if (full < 1e-7) continue;
    let ang = full * part * weight;
    const cap = Math.max(0, i === chain.length - 1 ? budget : budget * part);
    if (ang > cap) ang = cap;
    budget -= ang;
    if (i === chain.length - 1) left = full * weight - ang;
    N.copy(v1).cross(v2);
    if (N.lengthSq() < 1e-12) N.set(0, 1, 0); else N.normalize();   // straight behind: turn about the vertical
    rotateWorld(bone, q1.setFromAxisAngle(N, ang));
  }
  return left;
}

/** Feet on uneven ground. `ground(x, z, y)` returns the floor height under a point for a body whose feet are at
 *  y (NaN or null where there is none; a walk grid's groundAt fits). Each update, from the pose just written:
 *  every foot is moved up or down by how far the floor under it is from the character's own ground level (the
 *  root's y), the hips drop to let the lowest foot reach, and the foot pitches to the slope. Offsets ease at
 *  `rate` per second so steps do not pop. `legs` = [[upper, lower, foot], ...] as nodes or names under `root`. */
export function createFootIK(root, { ground, legs, hips, maxStep = 0.4, maxDrop = 0.35, rate = 12, tilt = 0.5, footLength = 0.2, weight = 1, forward = null } = {}) {
  const node = (n) => (typeof n === 'string' ? root.getObjectByName(n) || (() => { throw new Error(`ik: no bone "${n}"`); })() : n);
  const L = legs.map((l) => ({ upper: node(l[0]), lower: node(l[1]), foot: node(l[2]), offset: 0, pitch: 0, target: new THREE.Vector3(), rot: new THREE.Quaternion() }));
  const hip = node(hips), P = new THREE.Vector3(), S = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  const api = {
    weight, legs: L, hipOffset: 0,
    /** forget the eased offsets (after a teleport) */
    reset() { api.hipOffset = 0; for (const l of L) l.offset = l.pitch = 0; },
    update(dt = 1 / 60) {
      if (api.weight <= 0) return;
      root.updateWorldMatrix(true, true);
      const y0 = P.setFromMatrixPosition(root.matrixWorld).y, k = dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
      fwd.copy(forward || S.set(0, 0, 1)).transformDirection(root.matrixWorld); fwd.y = 0; fwd.normalize();
      side.set(fwd.z, 0, -fwd.x);
      const at = (x, z) => { const g = ground(x, z, y0); return g == null || Number.isNaN(g) ? y0 : Math.min(Math.max(g, y0 - maxDrop), y0 + maxStep); };
      let low = Infinity;
      for (const l of L) {
        l.target.setFromMatrixPosition(l.foot.matrixWorld); l.foot.getWorldQuaternion(l.rot);
        const want = at(l.target.x, l.target.z) - y0;
        l.offset += (want - l.offset) * k;
        // slope under the sole, from the floor a foot length ahead and behind; a step edge is not a slope
        let pitch = 0;
        if (tilt > 0) {
          const h = footLength / 2, a = at(l.target.x + fwd.x * h, l.target.z + fwd.z * h), b = at(l.target.x - fwd.x * h, l.target.z - fwd.z * h);
          if (Math.abs(a - b) < footLength * Math.tan(tilt)) pitch = -Math.atan2(a - b, footLength);
        }
        l.pitch += (pitch - l.pitch) * k;
        low = Math.min(low, l.offset);
      }
      api.hipOffset = Math.min(0, low);   // already eased, being the lowest of eased offsets
      const w = api.weight;
      if (api.hipOffset) {
        // the hips' parent may be scaled or tilted: move by what a world metre down is in its frame
        S.set(0, api.hipOffset * w, 0);
        if (hip.parent) S.transformDirection(m1.copy(hip.parent.matrixWorld).invert()).multiplyScalar(Math.abs(api.hipOffset * w) / hip.parent.getWorldScale(P).y);
        hip.position.add(S); hip.updateWorldMatrix(false, true);
      }
      for (const l of L) {
        l.target.y += l.offset * w;
        solveTwoBone(l.upper, l.lower, l.foot, l.target, { hint: fwd });   // a straight leg bends its knee forwards
        // the foot keeps the direction the animation gave it (the leg above it has turned), plus the slope
        l.foot.parent.getWorldQuaternion(q2);
        if (l.pitch) q1.setFromAxisAngle(side, l.pitch * w).multiply(l.rot); else q1.copy(l.rot);
        l.foot.quaternion.copy(q2.invert().multiply(q1));
        l.foot.updateWorldMatrix(false, true);
      }
    },
  };
  return api;
}

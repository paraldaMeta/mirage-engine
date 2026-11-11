// Mirage original code. A ragdoll for a skinned rig: one body per bone, limited joints between them, and the
// switch between "the animation moves the bodies" and "the bodies move the bones".
// ---------------------------------------------------------------------------
// const rag = createRagdoll(kit, model);                 model: the rig's root (createRigModel().root, a loaded glTF)
//   each frame, in this order:   anim.update(dt);  kit.advance(dt);  rag.update(dt);
//   rag.ragdoll()                           every part falls, keeping the speed the animation gave it
//   rag.animate({ blend: 0.5 })             back to the animation over half a second, from wherever it lies
//   rag.partial(['LeftArm'], true)          that bone and the parts below it go limp; the rest stays animated
//   rag.drive(0.6, 0.3)                     active ragdoll: dynamic parts are pulled towards the animated pose
//                                           (strength 0..1 for rotation, pin 0..1 for position); 0 lets go
//   rag.impulse('Chest', [0, 0, -300], at)  N s on one part        rag.partOf(hit.body) -> 'Head' | null
//   rag.pose()                              { pos, yaw, faceUp }: where the body lies, to put the character there
//   rag.atRest                              every part asleep or slower than 5 cm/s
// A fallen ragdoll is helped to rest: when its mass-weighted speed has been under `settle.speed` (0.35 m/s) for
// `settle.time` (0.8 s) it is damped, then put to sleep. `settle: false` leaves that to Rapier alone, which for a
// jointed heap usually means never. A figure moved more than `jump` (0.6 m) in one step is placed, not swept.
// While animated the parts are kinematic bodies that follow the bones one frame behind: they push props and can
// be hit by rays (hit boxes). `hitboxes: false` switches their colliders off until the ragdoll takes over.
//
// `parts` describes the rig; the default fits the bone names of createRigModel (and of most humanoid exports):
//   { bone: 'LeftLeg', parent: 'LeftUpLeg', to: 'LeftFoot', radius: 0.055, mass: 0.045,
//     joint: 'hinge', axis: [1, 0, 0], limits: [0, 2.3] }          a capsule from the bone to `to`
//   { bone: 'Hips', shape: 'box', half: [0.16, 0.1, 0.1], offset: [0, 0.03, 0], mass: 0.14 }
//   { bone: 'Head', parent: 'Chest', pivot: 'Neck', shape: 'ball', radius: 0.11, offset: [0, 0.11, 0],
//     joint: 'ball', axis: [0, 1, 0], swing: 0.6, twist: 0.8 }          a cone: see joints.cone
//   { bone: 'LeftUpLeg', parent: 'Hips', to: 'LeftLeg', radius: 0.075, joint: 'ball', centre: [0.15, -0.85, 0.5], swing: 1, twist: 0.4 }
// Sizes, offsets, axes and limits are in the bind pose's own space (the skin's): every body has the same
// orientation in the bind pose, which is what Rapier's one-axis joints need and what limits are measured from.
// `mass` is a share of the whole (`mass: 75` kg in the options). Bones without a part (neck, toes, hands) keep
// following the animation relative to their parent.
// There is no authored get-up clip in the rig: animate() blends from the lying pose into whatever the animator
// plays. For a proper get-up, play your own clip chosen by pose().faceUp before calling animate().
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createJoints } from './physics-joints.js';

const side = (s, x) => [
  { bone: `${s}UpLeg`, parent: 'Hips', to: `${s}Leg`, radius: 0.065, mass: 0.1, joint: 'ball', centre: [0.15 * x, -0.85, 0.5], swing: 1.0, twist: 0.4 },
  { bone: `${s}Leg`, parent: `${s}UpLeg`, to: `${s}Foot`, radius: 0.055, mass: 0.045, joint: 'hinge', axis: [1, 0, 0], limits: [0, 2.3] },
  { bone: `${s}Foot`, parent: `${s}Leg`, shape: 'box', half: [0.05, 0.04, 0.12], offset: [0, -0.04, 0.05], mass: 0.015, joint: 'hinge', axis: [1, 0, 0], limits: [-0.7, 0.7] },
  { bone: `${s}Arm`, parent: 'Chest', to: `${s}ForeArm`, radius: 0.045, mass: 0.03, joint: 'ball', centre: [x, -0.6, 0.5], swing: 1.25, twist: 0.8 },
  { bone: `${s}ForeArm`, parent: `${s}Arm`, to: `${s}Hand`, extend: 0.08, radius: 0.04, mass: 0.025, joint: 'hinge', axis: [0, 1, 0], limits: x > 0 ? [-2.3, 0] : [0, 2.3] },
];
/** the parts for createRigModel's skeleton (Hips, Spine, Chest, Neck, Head, Left/Right UpLeg, Leg, Foot, Arm, ForeArm) */
export const RAGDOLL_HUMANOID = [
  { bone: 'Hips', shape: 'box', half: [0.13, 0.09, 0.1], offset: [0, 0.03, 0], mass: 0.14 },
  { bone: 'Spine', parent: 'Hips', shape: 'box', half: [0.125, 0.085, 0.1], offset: [0, 0.085, 0], mass: 0.13, joint: 'ball', axis: [0, 1, 0], centre: [0, 1, 0.15], swing: 0.4, twist: 0.3 },
  { bone: 'Chest', parent: 'Spine', shape: 'box', half: [0.135, 0.1, 0.11], offset: [0, 0.1, 0], mass: 0.2, joint: 'ball', axis: [0, 1, 0], centre: [0, 1, 0.1], swing: 0.4, twist: 0.4 },
  { bone: 'Head', parent: 'Chest', pivot: 'Neck', shape: 'ball', radius: 0.11, offset: [0, 0.11, 0], mass: 0.07, joint: 'ball', axis: [0, 1, 0], swing: 0.6, twist: 0.8 },
  ...side('Left', 1), ...side('Right', -1),
];

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);

export function createRagdoll(kit, root, o = {}) {
  const settle = o.settle === false ? null : { speed: 0.35, time: 0.8, ...o.settle };
  const jump = o.jump ?? 0.6;   // metres in one step that count as being moved, not as moving
  const { phys, R } = kit, ext = phys.ext, joints = createJoints(kit);
  const spec = o.parts || RAGDOLL_HUMANOID, total = o.mass ?? 75;
  const find = (n) => root.getObjectByName(n) || (() => { throw new Error(`createRagdoll: no bone named "${n}" under the model`); })();
  root.updateMatrixWorld(true);
  let skinned = null; root.traverse((c) => { if (!skinned && c.isSkinnedMesh) skinned = c; });
  // the bind pose of a bone in the skin's space: from the skeleton when there is one (the model may already be
  // mid-stride), else the pose it has now
  const base = (skinned || root).matrixWorld.clone(), baseInv = base.clone().invert();
  const bind = (bone) => {
    const i = skinned ? skinned.skeleton.bones.indexOf(bone) : -1, m = new THREE.Matrix4();
    if (i >= 0) m.copy(skinned.skeleton.boneInverses[i]).invert(); else m.multiplyMatrices(baseInv, bone.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, _s);
    return { p, q };
  };
  base.decompose(_v, _q, _s);
  const scale = _s.x, baseQ = _q.clone(), sum = spec.reduce((a, p) => a + (p.mass ?? 0.05), 0);
  const toWorld = (p) => _v.copy(p).applyMatrix4(base).toArray();

  const parts = {}, list = [];
  for (const d of spec) {
    const bone = find(d.bone), b = bind(bone);
    let col, along = d.axis;
    if (d.to) {
      // a capsule from this bone to the next, a little short of both joints so neighbours do not start in contact
      const e = bind(find(d.to)).p.sub(b.p), len = e.length() + (d.extend || 0), dir = e.normalize(), r = d.radius ?? 0.05;
      along ||= dir.toArray();
      col = { shape: 'capsule', radius: r * scale, height: Math.max(len * scale, 2 * r * scale + 2e-3), pos: dir.clone().multiplyScalar(len * scale / 2).toArray(), rot: new THREE.Quaternion().setFromUnitVectors(_Y, dir).toArray() };
    } else {
      const off = (d.offset || [0, 0, 0]).map((x) => x * scale);
      col = d.shape === 'ball' ? { shape: 'ball', radius: (d.radius ?? 0.1) * scale, pos: off } : d.shape === 'capsule' ? { shape: 'capsule', radius: d.radius * scale, height: d.height * scale, axis: d.axis || 'y', pos: off }
        : { shape: 'box', half: (d.half || [0.1, 0.1, 0.1]).map((x) => x * scale), pos: off };
    }
    // made dynamic (so the mass is worked out), in the bind pose (so joints see equal orientations), then handed to the animation
    const body = kit.rigid(null, { colliders: [col], pos: toWorld(b.p), quat: baseQ.toArray(), mass: total * (d.mass ?? 0.05) / sum, material: o.material || { friction: 0.8, restitution: 0.05 },
      layer: o.layer, mask: o.mask, damping: o.damping ?? 0.05, angularDamping: o.angularDamping ?? 0.8, ccd: o.ccd, name: d.bone, events: o.events, userData: { ragdoll: true, bone: d.bone } });
    const part = { name: d.bone, bone, body, parent: d.parent ? parts[d.parent] : null, joint: null, dynamic: false, w: 0, fade: 0,
      bq: b.q.clone(), bqInv: b.q.clone().invert(),
      aq: new THREE.Quaternion(), ap: new THREE.Vector3(),   // the animation's pose of this bone, world
      fq: new THREE.Quaternion(), fp: new THREE.Vector3(),   // the pose it was finally given
      cq: new THREE.Quaternion(), cp: new THREE.Vector3() }; // where it lay when the animation took it back
    if (d.parent && !part.parent) throw new Error(`createRagdoll: part "${d.bone}" names parent "${d.parent}", which must come before it`);
    if (part.parent) {
      const anchor = toWorld(d.pivot ? bind(find(d.pivot)).p : b.p), jo = { anchor, contacts: false, name: d.bone };
      if (d.joint === 'hinge') part.joint = joints.hinge(part.parent.body, body, { ...jo, axis: _v2.set(...(d.axis || [1, 0, 0])).applyQuaternion(baseQ).toArray(), limits: d.limits });
      else if (d.joint === 'fixed') part.joint = joints.fixed(part.parent.body, body, jo);
      else if (d.swing != null) { const w = (a) => _v2.set(...a).applyQuaternion(baseQ).toArray(); part.joint = joints.cone(part.parent.body, body, { ...jo, axis: w(along || [0, 1, 0]), centre: w(d.centre || along || [0, 1, 0]), swing: d.swing, twist: d.twist }); }
      else part.joint = joints.ball(part.parent.body, body, { ...jo, limits: d.limits });
    }
    parts[d.bone] = part; list.push(part);
  }
  const byBody = new Map(list.map((p) => [p.body.id, p]));
  const KIN = R.RigidBodyType.KinematicPositionBased, DYN = R.RigidBodyType.Dynamic;
  const hit = o.hitboxes !== false;
  const setDynamic = (p, on) => {
    if (p.dynamic === on) return;
    p.dynamic = on; p.body.type = on ? 'dynamic' : 'kinematic';
    p.body._b.setBodyType(on ? DYN : KIN, true);
    if (!hit) for (const c of p.body.colliders) phys.world.getCollider(c).setEnabled(on);
  };
  for (const p of list) { p.dynamic = true; setDynamic(p, false); }

  const rag = { parts, list, root, strength: 0, pin: 0, calm: 0, mode: 'animated' };
  const refresh = () => { const n = list.filter((p) => p.dynamic).length; rag.mode = n === list.length ? 'ragdoll' : n ? 'partial' : list.some((p) => p.w > 0) ? 'blending' : 'animated'; };

  /** the bones' world pose as the animation left it */
  const readAnim = () => {
    root.updateMatrixWorld(true);
    for (const p of list) { p.bone.matrixWorld.decompose(p.ap, p.aq, _s); }
  };
  /** where the physics has a part: the body between its last two steps, as a bone pose */
  const bodyPose = (p, q, v) => {
    const b = p.body, a = b.rest ? 1 : kit.alpha, c = b.cur, pr = b.prev;
    if (a >= 1) { v.set(c[0], c[1], c[2]); q.set(c[3], c[4], c[5], c[6]); }
    else { v.set(pr[0] + (c[0] - pr[0]) * a, pr[1] + (c[1] - pr[1]) * a, pr[2] + (c[2] - pr[2]) * a); q.set(pr[3], pr[4], pr[5], pr[6]).slerp(_q3.set(c[3], c[4], c[5], c[6]), a); }
    q.multiply(p.bq);
  };
  const exact = (p, q, v) => { const t = p.body._b.translation(), r = p.body._b.rotation(); v.set(t.x, t.y, t.z); q.set(r.x, r.y, r.z, r.w).multiply(p.bq); };

  /** once a frame, after the animator and after kit.advance: gives the bones their final pose */
  rag.update = (dt = 0) => {
    readAnim();
    let any = false;
    for (const p of list) {
      if (p.dynamic) { p.w = 1; bodyPose(p, p.fq, p.fp); }
      else if (p.w > 0) {
        p.w = p.fade > 0 ? Math.max(0, p.w - dt / p.fade) : 0;
        const k = smooth(p.w);
        p.fq.copy(p.aq).slerp(p.cq, k); p.fp.copy(p.ap).lerp(p.cp, k);
        if (p.w === 0) any = true;
      } else { p.fq.copy(p.aq); p.fp.copy(p.ap); continue; }
      // parents come first in the list, so the parent's world matrix below already has their new pose
      const par = p.bone.parent;
      par.updateWorldMatrix(true, false);
      par.matrixWorld.decompose(_v, _q, _s);
      p.bone.quaternion.copy(_q.invert()).multiply(p.fq);
      // only a part that hangs on nothing is placed; the others stay on their parent bone (bone lengths are kept)
      if (!p.parent || (p.dynamic && !p.parent.dynamic && !p.joint?.alive)) p.bone.position.copy(p.fp).applyMatrix4(_m.copy(par.matrixWorld).invert());
    }
    if (rag.mode !== 'animated') root.updateMatrixWorld(true);
    if (any) refresh();
  };

  // before every physics step: animated parts go where the bones were last put; driven parts are pulled to the animation
  const step = (dt) => {
    // settling: a heap of jointed bodies under its own weight never quite stops in an iterative solver (a knee on
    // its stop under the hips keeps trembling). Once every part has been slow for a while the ragdoll is damped
    // harder and harder, then put to sleep; anything that hits it wakes it as usual.
    if (settle && rag.mode === 'ragdoll' && !(rag.strength > 0 || rag.pin > 0)) {
      // "slow" is the mass-weighted speed: a trembling foot must not keep the whole body awake
      let e = 0, m = 0, awake = false;
      for (const p of list) { const rb = p.body._b; if (rb.isSleeping()) continue; awake = true; const v = rb.linvel(), pm = rb.mass(); e += pm * (v.x * v.x + v.y * v.y + v.z * v.z); m += pm; }
      if (!awake || e > m * settle.speed * settle.speed) rag.calm = 0;
      else {
        rag.calm += dt;
        if (rag.calm >= settle.time) { for (const p of list) p.body._b.sleep(); rag.calm = 0; }
        else {
          const u = rag.calm / settle.time, k = 1 - 0.5 * u * u;
          for (const p of list) { const rb = p.body._b; if (rb.isSleeping()) continue; const v = rb.linvel(), w = rb.angvel(); rb.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, false); rb.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, false); }
        }
      }
    } else rag.calm = 0;
    // a figure that was moved outright (a looping clip without root motion, a respawn) is not swept there: a kinematic
    // body that covers metres in one step would whip whatever hangs on it. Everything is put there instead.
    let warp = null;
    for (const p of list) if (!p.dynamic) { const t = p.body._b.translation(), dx = p.fp.x - t.x, dy = p.fp.y - t.y, dz = p.fp.z - t.z; if (dx * dx + dy * dy + dz * dz > jump * jump) warp = [dx, dy, dz]; break; }
    for (const p of list) {
      const rb = p.body._b;
      if (!p.dynamic) {
        _q.copy(p.fq).multiply(p.bqInv);
        if (warp) { rb.setTranslation(p.fp, true); rb.setRotation(_q, true); }
        rb.setNextKinematicTranslation(p.fp); rb.setNextKinematicRotation(_q);
        continue;
      }
      if (warp) { const t = rb.translation(); rb.setTranslation({ x: t.x + warp[0], y: t.y + warp[1], z: t.z + warp[2] }, true); }
      if (!(rag.strength > 0 || rag.pin > 0) || p.limp) continue;
      const r = rb.rotation(), t = rb.translation();
      if (rag.strength > 0) {
        // the turn from where it is to where the animation has it, as a speed that would close a third of it per step
        _q.copy(p.aq).multiply(p.bqInv).multiply(_q2.set(r.x, r.y, r.z, r.w).invert());
        if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
        const sn = Math.hypot(_q.x, _q.y, _q.z), ang = 2 * Math.atan2(sn, _q.w), k = sn > 1e-9 ? Math.min(ang * 0.3 / dt, 25) / sn : 0, w = rb.angvel(), s = rag.strength;
        rb.setAngvel({ x: w.x + (_q.x * k - w.x) * s, y: w.y + (_q.y * k - w.y) * s, z: w.z + (_q.z * k - w.z) * s }, true);
      }
      if (rag.pin > 0) {
        const v = rb.linvel(), s = rag.pin, k = 0.3 / dt;
        rb.setLinvel({ x: v.x + ((p.ap.x - t.x) * k - v.x) * s, y: v.y + ((p.ap.y - t.y) * k - v.y) * s, z: v.z + ((p.ap.z - t.z) * k - v.z) * s }, true);
      }
    }
  };
  const off = kit.on('step', step);

  const names = (sel, below = true) => {
    if (!sel) return list;
    const want = new Set([].concat(sel));
    return list.filter((p) => { for (let q = p; q; q = below ? q.parent : null) if (want.has(q.name)) return true; return false; });
  };
  /** let the physics have the whole body. `velocity` is added to what the animation was doing. */
  rag.ragdoll = ({ velocity } = {}) => {
    for (const p of list) { setDynamic(p, true); p.w = 1; p.limp = false; if (velocity) { const v = p.body._b.linvel(); p.body._b.setLinvel({ x: v.x + velocity[0], y: v.y + velocity[1], z: v.z + velocity[2] }, true); } }
    refresh(); return rag;
  };
  /** these bones (and the parts below them) go to the physics, or back; `limp` parts ignore drive() */
  rag.partial = (sel, on = true, { below = true, blend = 0.25, limp = true } = {}) => {
    for (const p of names(sel, below)) {
      if (on) { setDynamic(p, true); p.w = 1; p.limp = limp; }
      else if (p.dynamic) { exact(p, p.cq, p.cp); p.fq.copy(p.cq); p.fp.copy(p.cp); setDynamic(p, false); p.fade = blend; p.w = blend > 0 ? 1 : 0; }
    }
    refresh(); return rag;
  };
  /** the animation takes every part back, blending from where it lies over `blend` seconds */
  rag.animate = ({ blend = 0.4 } = {}) => rag.partial(null, false, { blend });
  /** active ragdoll: pull dynamic parts towards the animated pose. strength: rotation, pin: position, both 0..1 */
  rag.drive = (strength = 0, pin = 0) => { rag.strength = strength; rag.pin = pin; if (strength > 0 || pin > 0) for (const p of list) if (p.dynamic) p.body.wake(); return rag; };
  rag.impulse = (name, j, at) => { const p = parts[name]; if (!p) throw new Error(`ragdoll: no part "${name}"`); p.body.impulse(j, at); return rag; };
  rag.partOf = (body) => byBody.get(body?.id ?? body)?.name || null;
  /** where it lies: the hips' position, which way the head end points (yaw, as a character's facing) and whether it is on its back */
  rag.pose = () => {
    const h = list[0], t = h.body._b.translation(), r = h.body._b.rotation();
    _q.set(r.x, r.y, r.z, r.w).multiply(_q2.copy(baseQ).invert());   // the turn since the bind pose
    const up = _v.set(0, 1, 0).applyQuaternion(_q), fw = _v2.set(0, 0, 1).applyQuaternion(_q);
    const lying = Math.abs(up.y) < 0.6, faceUp = fw.y > 0;
    // standing: where the chest faces; lying: feet-to-head turned so the character would face along its body
    const yaw = lying ? Math.atan2(faceUp ? -up.x : up.x, faceUp ? -up.z : up.z) : Math.atan2(fw.x, fw.z);
    return { pos: [t.x, t.y, t.z], yaw, faceUp, lying };
  };
  Object.defineProperty(rag, 'atRest', { get: () => list.every((p) => { if (!p.dynamic || p.body.sleeping) return true; const v = p.body._b.linvel(); return Math.hypot(v.x, v.y, v.z) < 0.05; }) });

  // the bodies start where the bones are now
  readAnim();
  for (const p of list) { p.fq.copy(p.aq); p.fp.copy(p.ap); p.body.teleport(p.fp.toArray(), _q.copy(p.fq).multiply(p.bqInv).toArray(), true); }

  const key = 'ragdoll' + (kit.ragdolls = (kit.ragdolls || 0) + 1);
  const A = (q) => q.toArray();
  ext.save[key] = () => ({ strength: rag.strength, pin: rag.pin, calm: rag.calm, parts: list.map((p) => [p.dynamic, p.w, p.fade, !!p.limp, A(p.fq), A(p.fp), A(p.cq), A(p.cp), A(p.aq), A(p.ap)]) });
  ext.load[key] = (s) => {
    rag.strength = s.strength; rag.pin = s.pin; rag.calm = s.calm || 0;
    s.parts.forEach(([dyn, w, fade, limp, fq, fp, cq, cp, aq, ap], i) => { const p = list[i]; p.dynamic = dyn; p.body.type = dyn ? 'dynamic' : 'kinematic'; p.w = w; p.fade = fade; p.limp = limp; p.fq.fromArray(fq); p.fp.fromArray(fp); p.cq.fromArray(cq); p.cp.fromArray(cp); p.aq.fromArray(aq); p.ap.fromArray(ap); });
    refresh();
  };
  rag.dispose = () => { off(); delete ext.save[key]; delete ext.load[key]; for (const p of list) { p.joint?.remove(); p.body.remove(); } };
  return rag;
}

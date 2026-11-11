// What sits on top of the animator, on the code-authored rig: IK solvers, retargeting onto the procedural
// traveller's skeleton, the timeline, and the rig as the play character.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { createEnv, createMaterials } from '@mirage/core';
import { createRigModel, RIG } from './src/rig-model.js';
import { createAnimator } from './src/anim.js';
import { solveTwoBone, solveLookAt, createFootIK } from './src/ik.js';
import { humanoidRoles, humanoidMap, retargetClip } from './src/retarget.js';
import { createTimeline } from './src/timeline.js';
import { createRigCharacter } from './src/rig-character.js';
import { createCharacter } from './src/character.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const wp = (o) => { o.updateWorldMatrix(true, false); return V().setFromMatrixPosition(o.matrixWorld); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const fresh = () => { const r = createRigModel(); r.root.updateMatrixWorld(true); return { ...r, bone: (n) => r.root.getObjectByName(n) }; };

// --- two-bone
{
  const { bone } = fresh(), arm = bone('LeftArm'), fore = bone('LeftForeArm'), hand = bone('LeftHand');
  const a = wp(arm), la = a.distanceTo(wp(fore)), lb = wp(fore).distanceTo(wp(hand));
  let worst = 0;
  for (const t of [V(0.5, 1.2, 0.25), V(0.3, 1.6, 0.2), V(0.45, 1.0, -0.1), V(0.6, 1.45, 0.3), V(0.25, 1.3, 0.35)]) {
    worst = Math.max(worst, solveTwoBone(arm, fore, hand, t));
    near(wp(arm).distanceTo(wp(fore)), la, 1e-6, 'upper length kept'); near(wp(fore).distanceTo(wp(hand)), lb, 1e-6, 'lower length kept');
  }
  assert.ok(worst < 1e-5, `two-bone reaches: ${worst}`);
  // the pole picks the side the elbow is on
  const t = V(0.45, 1.3, 0.2);
  for (const side of [-1, 1]) {
    solveTwoBone(arm, fore, hand, t, { pole: V(0.3, 1.3 + side, 0) });
    const mid = a.clone().add(t).multiplyScalar(0.5), e = wp(fore);
    assert.ok((e.y - mid.y) * side > 0.05, `elbow on the pole's side (${side}): ${e.y - mid.y}`);
    assert.ok(wp(hand).distanceTo(t) < 1e-5);
  }
  // out of reach: straight at the target, short by what is out of reach
  const far = V(3, 1.4, 1), left = solveTwoBone(arm, fore, hand, far);
  near(left, far.distanceTo(a) - (la + lb) * 0.999, 1e-5, 'out of reach residual');
  assert.ok(wp(hand).sub(a).normalize().dot(far.clone().sub(a).normalize()) > 1 - 1e-9, 'straightened towards the target');
  // weight 0.5 goes part of the way; weight 0 leaves the pose
  const f2 = fresh(), q0 = f2.bone('LeftArm').quaternion.clone();
  assert.equal(solveTwoBone(f2.bone('LeftArm'), f2.bone('LeftForeArm'), f2.bone('LeftHand'), t, { weight: 0 }), 0); assert.ok(f2.bone('LeftArm').quaternion.equals(q0));
  const half = solveTwoBone(f2.bone('LeftArm'), f2.bone('LeftForeArm'), f2.bone('LeftHand'), t, { weight: 0.5 }), f3 = fresh();
  solveTwoBone(f3.bone('LeftArm'), f3.bone('LeftForeArm'), f3.bone('LeftHand'), t);
  assert.ok(half > 0.05, `half weight stops short: ${half}`);
  near(f2.bone('LeftArm').quaternion.angleTo(q0), f3.bone('LeftArm').quaternion.angleTo(q0) / 2, 1e-6, 'half weight is half the turn');
  // a straight leg lifted from the floor bends its knee forwards (+Z), not back
  const g = fresh(), foot = wp(g.bone('LeftFoot'));
  solveTwoBone(g.bone('LeftUpLeg'), g.bone('LeftLeg'), g.bone('LeftFoot'), foot.clone().add(V(0, 0.2, 0)));
  assert.ok(wp(g.bone('LeftLeg')).z > 0.1, `knee forwards: ${wp(g.bone('LeftLeg')).z}`);
}

// --- look-at
{
  const { bone } = fresh(), neck = bone('Neck'), head = bone('Head');
  const aim = (t) => V(0, 0, 1).transformDirection(head.matrixWorld).angleTo(t.clone().sub(wp(head)));
  const t = V(1.5, 2.2, 2);
  assert.equal(solveLookAt([neck, head], t, { share: [0.35, 0.65] }), 0);
  assert.ok(aim(t) < 1e-4, `head faces the target: ${aim(t)}`);
  assert.ok(neck.quaternion.angleTo(new THREE.Quaternion()) > 0.05, 'the neck took its share');
  const b = fresh(), side = V(5, 1.6, 0.0001), full = Math.PI / 2;
  const left = solveLookAt([b.bone('Neck'), b.bone('Head')], side, { share: [0.35, 0.65], limit: 0.8 });
  near(left, full - 0.8, 2e-3, 'limit leaves the rest of the turn');
  near(V(0, 0, 1).transformDirection(b.bone('Head').matrixWorld).angleTo(V(0, 0, 1)), 0.8, 2e-3, 'turned by the limit');
}

// --- feet on the ground, after the animator's pose
{
  const { root, clips, bone } = fresh();
  const anim = createAnimator(root, clips, { layers: [] }), hip0 = wp(bone('Hips')).y;
  let floor = () => 0;
  const feet = createFootIK(root, { ground: (x, z) => floor(x, z), hips: 'Hips', legs: [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']], rate: 1e6 });
  anim.post.push(() => feet.update(anim.dt || 1 / 60));
  anim.evaluate();
  near(wp(bone('LeftFoot')).y, RIG.ankle, 1e-4, 'flat floor leaves the foot');
  near(wp(bone('Hips')).y, hip0, 1e-6, 'flat floor leaves the hips');
  floor = (x) => (x > 0 ? 0.15 : 0);                     // a kerb under the left foot
  anim.evaluate();
  near(wp(bone('LeftFoot')).y, RIG.ankle + 0.15, 2e-3, 'left foot on the kerb');
  near(wp(bone('RightFoot')).y, RIG.ankle, 2e-3, 'right foot stays');
  assert.ok(wp(bone('LeftLeg')).z > 0.05, 'the lifted knee bends forwards');
  near(wp(bone('Hips')).y, hip0, 1e-6, 'hips do not rise');
  floor = (x) => (x > 0 ? -0.15 : 0);                    // and a hole
  anim.evaluate();
  near(wp(bone('Hips')).y, hip0 - 0.15, 2e-3, 'hips drop for the lowest foot');
  near(wp(bone('LeftFoot')).y, RIG.ankle - 0.15, 3e-3, 'left foot reaches down');
  near(wp(bone('RightFoot')).y, RIG.ankle, 3e-3, 'right foot stays on its floor');
  floor = (x, z) => 0.3 * z;                             // a ramp rising ahead
  anim.evaluate();
  const toe = wp(bone('LeftToe')), heel = wp(bone('LeftFoot'));
  near(Math.atan2(toe.y - heel.y, toe.z - heel.z) - Math.atan2(0 - RIG.ankle, 1) * 0 , Math.atan(0.3) + Math.atan2(wpRest('LeftToe').y - RIG.ankle, wpRest('LeftToe').z - wpRest('LeftFoot').z), 0.02, 'foot pitched to the ramp');
  floor = () => NaN; feet.reset(); anim.evaluate();
  near(wp(bone('LeftFoot')).y, RIG.ankle, 1e-4, 'no floor: the animation stands');
  feet.weight = 0; floor = () => 0.2; anim.evaluate(); near(wp(bone('LeftFoot')).y, RIG.ankle, 1e-6, 'weight 0 is off');
  function wpRest(n) { return wp(fresh().bone(n)); }
}

// --- retargeting: the rig's clips on the procedural traveller's skeleton
let retargetNote = '';
{
  const src = fresh(), tgt = createCharacter({ mat: createMaterials(createEnv().G) });
  tgt.root.updateMatrixWorld(true);
  const map = humanoidMap(src.root, tgt.root);
  const want = { Hips: 'hips', Spine: 'spine', Head: 'head', LeftUpLeg: 'hip.L', LeftLeg: 'knee.L', LeftFoot: 'ankle.L', RightUpLeg: 'hip.R', RightLeg: 'knee.R', RightFoot: 'ankle.R',
    LeftArm: 'shoulder.L', LeftForeArm: 'elbow.L', RightArm: 'shoulder.R', RightForeArm: 'elbow.R' };
  for (const [s, t] of Object.entries(want)) assert.equal(map[s], t, `map ${s}`);
  const r = humanoidRoles(src.root); assert.equal(r.chest.name, 'Chest'); assert.equal(r.toeL.name, 'LeftToe'); assert.equal(r.handR.name, 'RightHand'); assert.equal(r.root.name, 'Root');
  const before = []; tgt.root.traverse((o) => before.push(...o.quaternion.toArray(), ...o.position.toArray()));
  const walk = src.clips.find((c) => c.name === 'walk');
  const clip = retargetClip(walk, src.root, tgt.root), raw = retargetClip(walk, src.root, tgt.root, { matchRest: false });
  const after = []; tgt.root.traverse((o) => after.push(...o.quaternion.toArray(), ...o.position.toArray()));
  assert.deepEqual(after, before, 'the target is left in its rest pose');
  assert.deepEqual(clip.userData.events, walk.userData.events); assert.equal(clip.duration, walk.duration);
  // the same limbs point the same way at the same time
  const sa = createAnimator(src.root, src.clips, { layers: [] }), ta = createAnimator(tgt.root, [clip], { layers: [] }), tr = createAnimator(createCharacter({ mat: createMaterials(createEnv().G) }).root, [raw], { layers: [] });
  const dir = (root, a, b) => wp(root.getObjectByName(b)).sub(wp(root.getObjectByName(a))).normalize();
  let worst = 0, rawWorst = 0;
  for (const t of [0, 0.2, 0.45, 0.7, 0.95].map((u) => u * walk.duration)) {
    sa.poseClip('walk', t); ta.poseClip('walk', t); tr.poseClip('walk', t);
    for (const [a, b, c, d] of [['LeftUpLeg', 'LeftLeg', 'hip.L', 'knee.L'], ['RightLeg', 'RightFoot', 'knee.R', 'ankle.R'], ['LeftArm', 'LeftForeArm', 'shoulder.L', 'elbow.L'], ['RightArm', 'RightForeArm', 'shoulder.R', 'elbow.R']]) {
      const ds = dir(src.root, a, b);
      worst = Math.max(worst, ds.angleTo(dir(tgt.root, c, d)));
      if (a.endsWith('Arm')) rawWorst = Math.max(rawWorst, ds.angleTo(dir(tr.root, c, d)));
    }
  }
  assert.ok(worst < 0.02, `retargeted limbs follow the source: ${worst} rad`);
  assert.ok(rawWorst > 1, `without rest matching the arms-down target is far off: ${rawWorst} rad`);
  // root travel: this target has no root bone, so the travel lands on its hips, scaled by hip height
  const k = clip.userData.retargeted.scale;
  const ra = createAnimator(tgt.root, [clip], { rootMotion: { bone: 'hips' }, layers: [{ name: 'base', start: 'walk', states: { walk: { clip: 'walk' } } }] });
  let z = 0; for (let i = 0; i < 120; i++) z += ra.update(1 / 60).z;
  near(z / 2, RIG.walk * k, 0.02, 'retargeted root motion');
  assert.ok(k > 0.8 && k < 1.2, `hip-height scale ${k}`);
  retargetNote = `retarget ${clip.userData.retargeted.bones} bones, scale ${k.toFixed(3)}, limb error ${worst.toExponential(1)} rad (${rawWorst.toFixed(2)} rad without rest matching)`;
  ra.reset();
}

// --- timeline
{
  const { root, clips, bone } = fresh(), anim = createAnimator(root, clips, { layers: [] });
  const cam = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100), door = new THREE.Object3D(), heard = [], log = [];
  const tl = createTimeline({ tracks: [
    { type: 'camera', target: cam, keys: [{ t: 0, position: [0, 2, 6], lookAt: [0, 1, 0], fov: 50 }, { t: 4, position: [5, 2, 3], lookAt: [0, 1, 0], fov: 30, ease: 'inOut' }] },
    { type: 'transform', target: door, keys: [{ t: 1, rotation: [0, 0, 0], position: [0, 0, 0] }, { t: 2, rotation: [0, 1.6, 0], position: [2, 0, 0], ease: 'out' }] },
    { type: 'animation', animator: anim, clips: [{ t: 0, clip: 'walk', duration: 2 }, { t: 2, clip: 'wave', fade: 0.4 }] },
    { type: 'audio', cues: [{ t: 1, sound: 'creak' }, { t: 3.5, sound: 'thud' }], play: (cue, offset) => heard.push([cue.sound, +offset.toFixed(4)]) },
    { type: 'event', keys: [{ t: 0, name: 'start' }, { t: 2, name: 'doorOpen', who: 'door' }, { t: 4, name: 'last' }] },
  ] });
  tl.on('*', (e) => log.push(e.name));
  assert.equal(tl.duration, 4);
  const shot = () => [...cam.position.toArray(), ...cam.quaternion.toArray(), cam.fov, ...door.position.toArray(), ...door.quaternion.toArray(), ...anim.pose()];
  // the picture is a function of time alone
  tl.seek(3.1); const a = shot(); tl.seek(0.4); tl.seek(3.9); tl.seek(3.1); assert.deepEqual(shot(), a, 'seek is exact whatever was shown before');
  assert.deepEqual(log, [], 'seek fires nothing');
  tl.seek(2);
  near(cam.fov, 40, 1e-9, 'fov eased'); near(cam.position.x, 2.5, 1e-9, 'camera half way');
  assert.ok(V(0, 0, -1).applyQuaternion(cam.quaternion).angleTo(V(0, 1, 0).sub(cam.position)) < 1e-6, 'camera looks at its target');
  tl.seek(1.5); near(door.position.x, 1.5, 1e-9, 'ease out'); tl.seek(0.5); near(door.position.x, 0, 1e-9, 'before its first key an object rests on it');
  // the animation track is the clip at the playhead; a fade is a blend of the two
  tl.seek(1.3); const viaTl = [...anim.pose()]; anim.poseClip('walk', 1.3); assert.deepEqual([...anim.pose()], viaTl);
  tl.seek(3.2); const w = [...anim.pose()]; anim.poseClip('wave', 1.2); assert.deepEqual([...anim.pose()], w);
  tl.seek(2.2); const mid = [...anim.pose()]; anim.poseClip('walk', 2); const p0 = [...anim.pose()]; anim.poseClip('wave', 0.2); const p1 = [...anim.pose()];
  assert.ok(mid.some((v, i) => Math.abs(v - p0[i]) > 1e-3) && mid.some((v, i) => Math.abs(v - p1[i]) > 1e-3), 'mid fade is neither clip');
  assert.ok(bone('RightArm'), 'rig');
  // playback: events and cues once each, in order, with how late the cue is
  tl.play(0); let frames = 0; while (tl.playing && frames < 1000) { tl.update(1 / 30); frames++; }
  assert.deepEqual(log, ['start', 'audio', 'doorOpen', 'audio', 'last', 'end']);
  assert.equal(heard.length, 2); assert.equal(heard[0][0], 'creak'); assert.ok(heard[0][1] >= 0 && heard[0][1] < 1 / 30 + 1e-6);
  assert.equal(tl.time, 4); near(frames, 120, 1, 'frames to the end');
  // seek with fire, and looping
  log.length = 0; tl.seek(0); tl.seek(2.5, { fire: true }); assert.deepEqual(log, ['start', 'audio', 'doorOpen']);
  const loop = createTimeline({ duration: 1, loop: true, tracks: [{ type: 'event', keys: [{ t: 0.5, name: 'tick' }] }] }); let ticks = 0; loop.on('tick', () => ticks++);
  loop.play(); for (let i = 0; i < 330; i++) loop.update(0.01);
  assert.equal(ticks, 3, 'a looping timeline fires each pass'); assert.ok(loop.playing);
  assert.throws(() => createTimeline({ tracks: [{ type: 'nope' }] }));
}

// --- the rig as the play character
{
  const { root, clips, bone } = fresh();
  const hero = createRigCharacter(root, clips);
  assert.equal(hero.state, 'idle'); assert.ok(hero.mesh.isSkinnedMesh); root.traverse((o) => assert.equal(o.userData.collide, false));
  const step = (secs, v, extra = {}) => { for (let i = 0; i < Math.round(secs * 60); i++) hero.update(1 / 60, { distance: v / 60, ...extra }); };
  step(1, 0); assert.equal(hero.state, 'idle');
  near(wp(bone('Root')).length(), 0, 1e-9, 'the clip does not move the model: the walker does');
  step(1.5, 1.5); assert.equal(hero.state, 'walk'); near(hero.animator.get('speed'), 1.5, 1e-6, 'speed follows the walker');
  let wts = Object.fromEntries(hero.animator.weights()); near(wts.walk, 1, 1e-6, 'walking is the walk clip'); near(hero.animator.get('rate'), 1, 1e-6, 'at the clip\'s own pace');
  step(1.5, 2.85); const rate = hero.animator.get('rate');
  near(rate, 2.85 / 2.512, 0.01, 'between clips playback is scaled to the ground covered');
  step(1.5, 4.2, { run: true }); assert.equal(hero.state, 'run'); wts = Object.fromEntries(hero.animator.weights()); near(wts.run, 1, 1e-6, 'running is the run clip');
  hero.update(1 / 60, { distance: 0.05, onGround: false, verticalSpeed: 3 }); assert.equal(hero.state, 'jump'); assert.equal(hero.animator.state(), 'air');
  step(0.3, 3, { onGround: false, verticalSpeed: -2 }); assert.equal(hero.state, 'fall');
  step(0.5, 0); assert.equal(hero.animator.state(), 'move'); step(1, 0); assert.equal(hero.state, 'idle');
  // foot placement and look-at are off until asked for
  const idleFoot = wp(bone('LeftFoot')).y;
  hero.ground = (x) => (x > 0 ? 0.12 : 0); step(1, 0);
  near(wp(bone('LeftFoot')).y - idleFoot, 0.12, 0.015, 'with ground set the foot follows it (the idle breathes a few mm)');
  hero.ground = null; hero.lookTarget = V(3, 1.6, 3); step(0.2, 0);
  assert.ok(V(0, 0, 1).transformDirection(bone('Head').matrixWorld).x > 0.5, 'the head turns to the look target');
  hero.lookTarget = null; hero.reset(); assert.equal(hero.state, 'idle');
  const parent = new THREE.Group(); parent.add(root); let gone = 0; const h2 = createRigCharacter(root, clips, { onDispose: () => gone++ }); h2.dispose(); h2.dispose(); assert.equal(gone, 1); assert.equal(root.parent, null);
  assert.throws(() => createRigCharacter(fresh().root, []), /no clip "idle"/);
}

console.log(`rig check: ok (two-bone, look-at, foot IK, timeline, rig character; ${retargetNote})`);

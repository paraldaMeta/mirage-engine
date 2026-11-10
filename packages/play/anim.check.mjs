// Animator contracts on the code-authored rig after a GLB round trip: blend spaces, the state machine, masked and
// additive layers, root motion (and the walker driven by it), clip events, determinism.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import validator from 'gltf-validator';
import { createEnv, createMaterials, writeGLB } from '@mirage/core';
import { createAssets } from '@mirage/core/assets';
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createWalker } from './src/walker.js';
import { createRigModel, RIG } from './src/rig-model.js';
import { createAnimator, blend1d, blend2d, rootMotionInput } from './src/anim.js';

// --- blend spaces
assert.deepEqual([...blend1d([0, 1.5, 4.2], 0.75)], [0.5, 0.5, 0]);
assert.deepEqual([...blend1d([0, 1.5, 4.2], 9)], [0, 0, 1]);
const P = [[0, 0], [0, 1.5], [0, -1.1], [1.2, 0], [-1.2, 0], [0, 4.2]];
for (const mode of ['cartesian', 'directional']) {
  P.forEach((p, i) => { const w = blend2d(P, p[0], p[1], mode); assert.ok(Math.abs(w[i] - 1) < 1e-6, `${mode}: a sample is itself`); });
  for (const [x, y] of [[0.3, 0.9], [-0.7, 2], [1, -0.5], [0.01, 0.01]]) {
    const w = blend2d(P, x, y, mode), sum = w.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6 && w.every((v) => v >= 0), `${mode}: weights are a partition at ${x},${y}`);
  }
}
const diag = blend2d(P, 0.6, 0.75, 'cartesian'); assert.ok(diag[1] > 0.2 && diag[3] > 0.2 && diag[2] === 0 && diag[4] === 0, 'a forward-right diagonal blends walk and strafe');

// --- the rig, through the writer, the Khronos validator and the importer
const rig = createRigModel();
const glb = writeGLB(rig.root, { clips: rig.clips }), glbM = writeGLB(rig.root, { clips: rig.clips, meshopt: true });
const report = await validator.validateBytes(glb);
assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages.filter((m) => m.severity === 0).slice(0, 5)));
const world = { G: createEnv().G }; world.mat = createMaterials(world.G);
const assets = createAssets(world);
const model = await assets.load(glb, { key: 'rig' }), modelM = await assets.load(glbM, { key: 'rig-meshopt' });
assert.equal(model.skinned, true); assert.equal(model.collide, false);
assert.deepEqual(model.animations.map((c) => c.name), rig.clips.map((c) => c.name));
assert.deepEqual(model.animations.find((c) => c.name === 'walk').userData.events, [{ time: 0.25, name: 'footL' }, { time: 0.75, name: 'footR' }], 'clip events survive the file');
const meshM = modelM.scene.getObjectByProperty('isSkinnedMesh', true), mesh0 = model.scene.getObjectByProperty('isSkinnedMesh', true);
for (const a of ['position', 'normal', 'skinIndex', 'skinWeight']) assert.deepEqual(meshM.geometry.attributes[a].array, mesh0.geometry.attributes[a].array, `meshopt ${a}`);
assert.equal(mesh0.skeleton.bones.length, 20);

const LAYERS = () => [
  { name: 'base', start: 'move',
    states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [RIG.walk, 'walk'], [RIG.run, 'run']] } }, jump: { clip: 'jump', loop: false },
      free: { blend2d: { x: 'vx', y: 'vz', mode: 'directional', points: [[0, 0, 'idle'], [0, 1.5, 'walk'], [0, -1.1, 'walkBack'], [1.2, 0, 'strafeL'], [-1.2, 0, 'strafeR'], [0, 4.2, 'run']] } } },
    transitions: [{ from: '*', to: 'jump', when: ['jump'], duration: 0.1 }, { from: 'jump', to: 'move', exitTime: 0.8, duration: 0.2 },
      { from: 'move', to: 'free', when: ['strafing'], duration: 0.2 }, { from: 'free', to: 'move', when: ['!strafing'], duration: 0.2 }] },
  { name: 'arm', mask: ['RightArm', 'Head'], start: 'none', states: { none: {}, wave: { clip: 'wave', loop: false } },
    transitions: [{ from: 'none', to: 'wave', when: ['wave'], duration: 0.15 }, { from: 'wave', to: 'none', exitTime: 0.85, duration: 0.25 }] },
  { name: 'lean', additive: true, weight: 0, start: 'lean', states: { lean: { clip: 'lean', loop: false, speed: 0, time: 1 } } },
];
const make = (extra = {}) => {
  const root = assets.instantiate(model);
  const anim = createAnimator(root, model.animations, { parameters: { speed: 0, vx: 0, vz: 0, strafing: false, jump: 'trigger', wave: 'trigger' }, rootMotion: { bone: 'Root' }, layers: LAYERS(), ...extra });
  return { root, anim, bone: (n) => root.getObjectByName(n) };
};
const run = (anim, secs, dt = 1 / 60) => { const m = { x: 0, y: 0, z: 0 }; for (let i = 0, n = Math.round(secs / dt); i < n; i++) { const d = anim.update(dt); m.x += d.x; m.y += d.y; m.z += d.z; } return m; };

// instances own their bones: posing one leaves the other and the template alone
{
  const A = make(), B = make();
  assert.equal(A.anim.unbound.length, 0);
  A.anim.set('speed', RIG.walk); run(A.anim, 0.4);
  assert.notDeepEqual(A.bone('LeftUpLeg').quaternion.toArray(), B.bone('LeftUpLeg').quaternion.toArray());
  assert.deepEqual(model.scene.getObjectByName('LeftUpLeg').quaternion.toArray(), [0, 0, 0, 1]);
  assert.notEqual(A.root.getObjectByProperty('isSkinnedMesh', true).skeleton, B.root.getObjectByProperty('isSkinnedMesh', true).skeleton);
}

// --- root motion: the clips' travel comes out of update(), the root bone stays put
const speeds = {};
for (const [speed, want] of [[0, 0], [RIG.walk, RIG.walk], [RIG.run, RIG.run], [2.85, null]]) {
  const { anim, bone } = make(); anim.set('speed', speed);
  const m = run(anim, 2); speeds[speed] = m.z / 2;
  if (want != null) assert.ok(Math.abs(m.z / 2 - want) < 1e-3, `speed ${speed}: ${(m.z / 2).toFixed(4)} m/s`);
  assert.ok(Math.abs(m.x) < 1e-6 && bone('Root').position.z === 0 && bone('Root').position.x === 0);
}
assert.ok(speeds[2.85] > RIG.walk && speeds[2.85] < RIG.run, `a blend travels between its clips (${speeds[2.85].toFixed(3)} m/s)`);
{ // the walker driven by it covers the same ground
  const nx = 160, nz = 160, floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz).fill(1);
  for (let k = 0; k < nx * nz; k++) floors[k * MAXL * 2 + 1] = Infinity;
  const grid = makeGrid({ nx, nz, x0: -10, z0: -10, cell: 0.125, floors, count }), w = createWalker(grid, { pos: [0, 0, 0] });
  const { anim, root } = make(); anim.set('speed', RIG.walk); root.rotation.y = Math.PI / 2;   // facing +X
  const input = {};
  for (let i = 0; i < 120; i++) w.update(1 / 60, rootMotionInput(anim.update(1 / 60), root.rotation.y, w.body, 1 / 60, input));
  assert.ok(Math.abs(w.pos[0] - 2 * RIG.walk) < 2e-3 && Math.abs(w.pos[2]) < 1e-6, `walker by root motion: ${w.pos[0].toFixed(4)} m in 2 s`);
}

// --- events: one footL and one footR per cycle, also where two clips carrying them are blended
for (const speed of [RIG.walk, 2.85]) {
  const { anim } = make(); anim.set('speed', speed);
  const seen = []; anim.on('*', (e) => { if (e.name.startsWith('foot')) seen.push(e.name); });
  run(anim, 1 / 60); const cycle = anim.weights().reduce((s, [n, w]) => s + w * anim.clips.get(n).duration, 0);
  run(anim, 3 * cycle - 1 / 60);
  assert.deepEqual(seen, ['footL', 'footR', 'footL', 'footR', 'footL', 'footR'], `speed ${speed}: ${seen.join(' ')}`);
}

// --- state machine: any-state trigger, exit time, crossfade weights, enter / exit events
{
  const { anim } = make(); const log = [];
  anim.on('enter', (e) => e.layer === 'base' && log.push(`+${e.state}`)); anim.on('exit', (e) => e.layer === 'base' && log.push(`-${e.state}`)); anim.on('takeoff', () => log.push('takeoff'));
  anim.set('speed', RIG.walk); run(anim, 0.5);
  anim.trigger('jump'); anim.update(1 / 60);
  assert.equal(anim.state(), 'jump'); assert.ok(anim.transitioning()); assert.equal(anim.get('jump'), false, 'the trigger is consumed');
  run(anim, 0.2); assert.ok(!anim.transitioning());
  run(anim, 0.7 * 0.8 - 0.2); assert.equal(anim.state(), 'move', 'exit time returns'); assert.ok(anim.transitioning());
  run(anim, 0.3); assert.ok(!anim.transitioning());
  assert.deepEqual(log, ['+move', '-move', '+jump', 'takeoff', '-jump', '+move']);
  anim.set('strafing', true).set('vx', 1.2); run(anim, 1);
  assert.equal(anim.state(), 'free'); const w = Object.fromEntries(anim.weights()); assert.ok(Math.abs(w.strafeL - 1) < 1e-6);
  const m = run(anim, 1); assert.ok(Math.abs(m.x - 1.2) < 1e-3 && Math.abs(m.z) < 1e-6, `strafe travels sideways (${m.x.toFixed(3)} m)`);
}

// --- layers: a masked override touches only its bones; an additive layer adds its offset to whatever plays
{
  const A = make(), B = make();
  for (const x of [A, B]) x.anim.set('speed', RIG.walk);
  A.anim.trigger('wave'); run(A.anim, 0.8); run(B.anim, 0.8);
  const q = (x, n) => x.bone(n).quaternion.toArray();
  for (const n of ['LeftUpLeg', 'RightLeg', 'LeftArm', 'Hips', 'Chest']) assert.deepEqual(q(A, n), q(B, n), `${n} is not in the mask`);
  assert.ok(A.bone('RightArm').quaternion.angleTo(B.bone('RightArm').quaternion) > 1, 'the waving arm is far from the walking one');
  run(A.anim, 1.2); run(B.anim, 1.2);
  assert.equal(A.anim.state('arm'), 'none'); assert.deepEqual(q(A, 'RightArm'), q(B, 'RightArm'), 'and returns to it');
  A.anim.setLayerWeight('lean', 1); A.anim.evaluate();
  const d = B.bone('Spine').quaternion.clone().invert().multiply(A.bone('Spine').quaternion), e = new THREE.Euler().setFromQuaternion(d);
  assert.ok(Math.abs(e.z + 0.22) < 1e-4 && Math.abs(e.x) < 1e-4, `additive lean adds its offset (${e.z.toFixed(4)} rad)`);
  assert.deepEqual(q(A, 'LeftUpLeg'), q(B, 'LeftUpLeg'));
  A.anim.setLayerWeight('lean', 0.5); A.anim.evaluate();
  assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(B.bone('Spine').quaternion.clone().invert().multiply(A.bone('Spine').quaternion)).z + 0.11) < 1e-4);
}

// --- determinism: the same dt sequence gives the same bones bit for bit; snapshot / restore continues exactly;
// with fixedStep the pose does not depend on how the frames slice the time
{
  const script = (x, dts) => { x.anim.set('speed', 2.2); let i = 0; for (const dt of dts) { if (i === 20) x.anim.trigger('jump'); if (i === 40) x.anim.trigger('wave'); if (i === 70) x.anim.set('speed', 4); x.anim.update(dt); i++; } return Float32Array.from(x.anim.pose()); };
  const dts = Array.from({ length: 140 }, (_, i) => 1 / 60 + ((i * 7919) % 13) * 1e-4);
  const a = script(make(), dts), b = script(make(), dts);
  assert.deepEqual(a, b, 'same inputs, same pose');
  const X = make(), Y = make();
  script(X, dts.slice(0, 90)); const snap = JSON.parse(JSON.stringify(X.anim.snapshot()));
  script(Y, dts.slice(0, 30)); Y.anim.restore(snap);
  for (const dt of dts.slice(90)) { X.anim.update(dt); Y.anim.update(dt); }
  assert.deepEqual(Float32Array.from(X.anim.pose()), Float32Array.from(Y.anim.pose()), 'restore continues bit-identically');
  const F = make({ fixedStep: 1 / 120 }), G = make({ fixedStep: 1 / 120 });
  F.anim.set('speed', 3); G.anim.set('speed', 3);
  let mf = 0, mg = 0;
  for (let i = 0; i < 60; i++) mf += F.anim.update(1 / 60).z;
  for (let i = 0; i < 24; i++) mg += G.anim.update(i % 2 ? 1 / 30 : 1 / 20).z;
  assert.equal(F.anim.time, G.anim.time);
  assert.deepEqual(Float32Array.from(F.anim.pose()), Float32Array.from(G.anim.pose()), 'fixed step: frame slicing does not matter');
  assert.ok(Math.abs(mf - mg) < 1e-9);
}

// --- scrubbing one clip outside the state machine
{
  const { anim, bone } = make();
  anim.poseClip('wave', 0.8); const top = bone('RightArm').quaternion.toArray();
  anim.poseClip('wave', 0.1); anim.poseClip('wave', 0.8);
  assert.deepEqual(bone('RightArm').quaternion.toArray(), top, 'a scrubbed time is a pose, whatever came before');
  anim.reset(); assert.deepEqual(bone('RightArm').quaternion.toArray(), [0, 0, 0, 1]);
}
assets.dispose();
console.log(`anim check: ok (rig ${glb.length} B plain, ${glbM.length} B meshopt, ${mesh0.geometry.attributes.position.count} vertices, ${rig.clips.length} clips; blend 2.85 -> ${speeds[2.85].toFixed(3)} m/s)`);

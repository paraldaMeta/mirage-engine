// Test-machine contracts for the procedural player. Mesh extents here use bind-pose metres.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnv, createMaterials } from '@mirage/core';
import { createCharacter } from './src/index.js';

const world = { mat: createMaterials(createEnv().G) };
const avatar = createCharacter(world), { root, mesh } = avatar;
const painted = createCharacter(world, { palette: { jacket: 0xfc9020 } });
assert.notDeepEqual(mesh.geometry.attributes.color.array, painted.mesh.geometry.attributes.color.array);
const drawables = [];
root.traverse(o => { assert.equal(o.userData.collide, false); if (o.isMesh) drawables.push(o); });
assert.deepEqual(drawables, [mesh]); assert.ok(mesh.isSkinnedMesh && !Array.isArray(mesh.material));
assert.ok(mesh.castShadow && mesh.receiveShadow);
mesh.geometry.computeBoundingBox();
assert.ok(Math.abs(mesh.geometry.boundingBox.min.y) < 0.002 && mesh.geometry.boundingBox.max.y > 1.73 && mesh.geometry.boundingBox.max.y < 1.82);
const { position, skinWeight, skinIndex } = mesh.geometry.attributes;
for (let i = 0; i < position.count; i++) {
  assert.ok(Math.abs(skinWeight.getX(i) + skinWeight.getY(i) - 1) < 1e-5);
  assert.ok(skinIndex.getX(i) < mesh.skeleton.bones.length && skinIndex.getY(i) < mesh.skeleton.bones.length);
}
const pose = () => mesh.skeleton.bones.flatMap(b => b.quaternion.toArray());
const idle = pose();
const sole = new THREE.Vector3();
function bootVertices() {
  root.updateMatrixWorld(true);
  const boot = mesh.skeleton.bones.indexOf(mesh.skeleton.getBoneByName('ankle.L'));
  const vertices = [];
  for (let i = 0; i < position.count; i++) {
    if (skinIndex.getX(i) === boot) vertices.push(...mesh.getVertexPosition(i, sole).toArray());
  }
  return vertices;
}
const planted = bootVertices();
assert.ok(planted.length > 0);
assert.equal(avatar.update(1 / 60), false);
const frame = (distance, options) => avatar.update(1 / 60, { distance, ...options });
for (let i = 0; i < 25; i++) frame(1.5 / 60);
assert.equal(avatar.state, 'walk'); assert.notDeepEqual(pose(), idle);
assert.notDeepEqual(bootVertices(), planted, 'skin follows the animated joints');
const calf = mesh.skeleton.getBoneByName('knee.L'), calfOther = mesh.skeleton.getBoneByName('knee.R');
assert.notEqual(calf.rotation.x, calfOther.rotation.x);
for (let i = 0; i < 20; i++) frame(4.2 / 60, { run: true });
assert.equal(avatar.state, 'run');
frame(0, { onGround: false, verticalSpeed: 3 }); assert.equal(avatar.state, 'jump');
frame(0, { onGround: false, verticalSpeed: -3 }); assert.equal(avatar.state, 'fall');
frame(0); assert.equal(avatar.state, 'land');
for (let i = 0; i < 90; i++) frame(0);
assert.equal(avatar.state, 'idle'); assert.deepEqual(pose(), idle);
assert.deepEqual(bootVertices(), planted, 'settled boots return to the same posed vertices');
assert.equal(frame(0, { run: true }), false, 'holding run against a wall does not advance the stride');
const replay = hz => {
  avatar.reset();
  for (let i = 0; i < hz; i++) avatar.update(1 / hz, { distance: 1.5 / hz });
  return root.userData.phase;
};
assert.ok(Math.abs(replay(30) - replay(144)) < 1e-8);
assert.deepEqual(root.position.toArray(), [0,0,0]);
const group = new THREE.Group(); group.add(root);
avatar.dispose(); painted.dispose(); assert.equal(root.parent, null);
console.log('Character rig, palette, collision exclusion, locomotion, reset and deterministic idle OK.');

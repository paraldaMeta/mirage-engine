// Test-machine checks using real mesh raycasts; no renderer is needed for these geometry contracts.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { createEnv, createMaterials } from '@miragekit/core';
import { addTerrain } from '@miragekit/world/kits/terrain';
import { addWater } from '@miragekit/world/kits/water';

const ctx = { root: new THREE.Group(), mat: createMaterials(createEnv().G) };
const options = { bounds: [10, -4, 12, -2], segments: [1, 1], sample: (x, z) => (x - 10) * (z + 4) };
let samples = 0;
const terrain = addTerrain(ctx, { ...options, sample(x,z) { samples++; return options.sample(x,z); } });
const waterOptions = { level: 0.8, outline: [[10,-4],[12,-4],[12,-3.5],[10.5,-3.5],[10.5,-2],[10,-2]] };
const water = addWater(ctx, waterOptions);
ctx.root.updateMatrixWorld(true);
function hitY(mesh, x, z) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 12, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(mesh, false)[0]?.point.y;
}

for (const [x, z, expected] of [[10,-4,0], [11,-3,0], [11.5,-2.5,2], [12,-2,4], [12,-3,2], [10.2,-3.8,0]]) {
  assert.ok(Math.abs(terrain.heightAt(x,z) - expected) < 1e-6);
  assert.ok(Math.abs(hitY(terrain.mesh,x,z) - expected) < 1e-6);
}
assert.equal(samples, 4);
assert.equal(terrain.heightAt(9,-3), null);
assert.equal(terrain.heightAt(NaN,-3), null);
assert.notEqual(terrain.mesh.userData.collide, false);
assert.equal(water.userData.collide, false);
assert.ok(Math.abs(hitY(water,11,-3.8) - 0.8) < 1e-6);
assert.equal(hitY(water,11,-3), undefined, 'concave notch remains dry');
assert.equal(ctx.root.children.length, 2);
for (const invalid of [{ segments: [0,2] }, { segments: [100000,100000] }, { sample: () => Infinity }]) {
  assert.throws(() => addTerrain(ctx, { ...options, ...invalid }), RangeError);
}
for (const invalid of [{ level: NaN }, { flow: [0,Infinity] }, { outline: [[0,0],[1,0],[2,0]] }]) {
  assert.throws(() => addWater(ctx, { ...waterOptions, ...invalid }), RangeError);
}
assert.equal(ctx.root.children.length, 2, 'bad input never attaches a partial mesh');
console.log('Terrain triangle heights, water polygon and collision flags OK.');

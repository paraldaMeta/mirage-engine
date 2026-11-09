// CPU-side layout and collision contract. The example's walk scenario checks the baked grid on the GPU.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnv, createMaterials, geom, rng } from '@mirage/core';
import { addGrass, addTreeCanopies } from '@mirage/world/kits/vegetation';

function layout(seed) {
  const ctx = { root: new THREE.Group(), geom, mat: createMaterials(createEnv().G), rng: name => rng(seed + '/' + name) };
  const trees = addTreeCanopies(ctx, { trees: [{ pos: [0, 0, 0], height: 6 }], cardsPerTree: 6 });
  const grass = addGrass(ctx, { bounds: [-2, -2, 2, 2], count: 12, include: x => x > 0, heightAt: x => x / 4 });
  assert.equal(addGrass(ctx, { bounds: [-1, -1, 1, 1], count: 5, include: () => false }), null);
  assert.throws(() => addGrass(ctx, { bounds: [0, 0, 1, 1], count: Infinity }), /count/);
  return { ...trees, grass };
}

const first = layout('edge'), repeat = layout('edge'), other = layout('meadow');
assert.equal(first.trunks.count, 1);
assert.equal(first.crowns.count, 6);
assert.equal(first.grass.count, 12);
assert.notEqual(first.trunks.userData.collide, false);
for (const key of ['branches', 'crowns', 'grass']) {
  assert.equal(first[key].isInstancedMesh, true);
  assert.equal(first[key].userData.collide, false);
  assert.deepEqual(first[key].instanceMatrix.array, repeat[key].instanceMatrix.array);
  assert.notDeepEqual(first[key].instanceMatrix.array, other[key].instanceMatrix.array);
}
const matrix = new THREE.Matrix4();
for (let i = 0; i < first.grass.count; i++) {
  first.grass.getMatrixAt(i, matrix);
  const [x, y] = matrix.elements.slice(12, 14);
  assert.ok(x > 0 && Math.abs(y - x / 4) < 1e-6);
}
console.log('Vegetation exports, seed replay, terrain height and collision flags OK.');

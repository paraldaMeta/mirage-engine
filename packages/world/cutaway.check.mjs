// Mirage original code.
// The cutaway and the edge colliders without a GPU (`node packages/world/cutaway.check.mjs`, part of `npm test` in
// world): the hooks a material gets, one program for every cutaway, re-patching a material that exists, the CPU
// test against the same geometry, and the merged collider meshes. What the GPU draws: examples/sprite-yard.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { createMaterials, createEnv, PROC } from '@miragekit/core';
import { createCutaway } from './src/kits/cutaway.js';
import { addPerimeter, addBarrier } from './src/kits/edge.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const G = createEnv({}).G, kit = createMaterials(G);
const compile = (m) => { const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} }; m.onBeforeCompile(sh); return sh; };

// ---- hooks ----
{
  const cut = createCutaway({ radius: 2 });
  const base = PROC.plaster();
  const h = cut.hooks(base);
  assert.ok(h.albedo.startsWith('{') && h.albedo.includes('discard') && h.albedo.endsWith(base.albedo), 'the cut runs before the albedo it was given');
  assert.ok(h.fragmentDecl.includes('uniform vec4 uMgCut;'));
  assert.equal(h.uniforms.uMgCut, cut.uniforms.uMgCut, 'the uniform is shared by reference');
  assert.equal(base.albedo, PROC.plaster().albedo, 'the hooks given are not changed');
  const m = kit.std({ color: 0xffffff }, h), sh = compile(m);
  assert.ok(sh.fragmentShader.includes('uMgCutShape.x') && sh.uniforms.uMgCut === cut.uniforms.uMgCut, 'compiled in, uniforms bound');
  // one program for every cutaway and every colour; another radius is a uniform
  const other = createCutaway({ radius: 5, near: 0.1 });
  assert.equal(kit.std({ color: 0xff0000 }, other.hooks(PROC.plaster())).customProgramCacheKey(), m.customProgramCacheKey(), 'one program');
  assert.notEqual(kit.std({}, PROC.plaster()).customProgramCacheKey(), m.customProgramCacheKey(), 'unmarked materials keep their own program');
  // apply(): a material that exists keeps its hooks and gains the cut
  const roof = kit.std({ roughness: 0.7 }, PROC.terracotta());
  const before = roof.userData.hooks.albedo;
  assert.equal(cut.apply(kit, roof), roof);
  assert.ok(roof.userData.hooks.albedo.endsWith(before) && roof.userData.hooks.albedo.includes('uMgCut'), 'apply() keeps the hooks');
  assert.ok(compile(roof).fragmentShader.includes('uMgCut'));
  const plain = cut.apply(kit, new THREE.MeshStandardMaterial());
  assert.ok(compile(plain).fragmentShader.includes('uMgCut'), 'apply() on an unpatched material');
  // a depth material made from the hooks is untouched: the cut walls keep their shadows
  const depth = kit.depth(h);
  assert.ok(!(depth.userData.hooks.albedo || '').includes('uMgCut'), 'shadows are not cut');
}

// ---- the CPU test ----
{
  const cut = createCutaway({ radius: 2 });
  const eye = new THREE.Vector3(0, 11, 10);
  assert.equal(cut.on, false); assert.equal(cut.hides(0, 6, 5, eye), false, 'off until set()');
  cut.set(0, 1, 0);
  assert.equal(cut.on, true);
  assert.equal(cut.hides(0, 6, 5, eye), true, 'on the line of sight, half way');
  assert.equal(cut.hides(1.5, 6, 5, [0, 11, 10]), true, 'inside the radius');
  assert.equal(cut.hides(2.5, 6, 5, eye), false, 'outside the radius');
  assert.equal(cut.hides(0, 0.3, 0.5, eye), false, 'below the target by more than 0.6 m: the ground stays');
  assert.equal(cut.hides(0, 1, -0.5, eye), false, 'behind the target');
  assert.equal(cut.hides(0, 10.9, 9.9, eye), false, 'at the eye (before `near`)');
  cut.set(0, 1, 0, 0.5); assert.equal(cut.hides(1.5, 6, 5, eye), false, 'a smaller radius');
  cut.off(); assert.equal(cut.hides(0, 6, 5, eye), false, 'off');
}

// ---- edge colliders ----
{
  const made = [];
  const ctx = { collider: (m) => { made.push(m); m.userData.collider = true; return m; } };
  const ring = addPerimeter(ctx, [-10, -5, 10, 5], { thickness: 0.5, y0: -2, y1: 6 });
  assert.equal(made.length, 1, 'one mesh for the ring');
  ring.geometry.computeBoundingBox();
  const b = ring.geometry.boundingBox;
  assert.ok(near(b.min.x, -10) && near(b.max.x, 10) && near(b.min.z, -5) && near(b.max.z, 5) && near(b.min.y, -2) && near(b.max.y, 6), 'the ring fills the bounds from inside');
  const inside = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)).intersectObject(ring)[0];
  assert.ok(inside && near(inside.point.x, 9.5, 1e-4), 'the inner face is `thickness` inside the edge');
  const bank = addBarrier(ctx, [[0, 0], [4, 0], [4, 3], [4, 3]]);
  assert.equal(made.length, 2, 'one mesh for a polyline (repeated points skipped)');
  bank.geometry.computeBoundingBox();
  const c = bank.geometry.boundingBox;
  assert.ok(near(c.min.x, -0.2, 1e-5) && near(c.max.x, 4.2, 1e-5) && near(c.max.z, 3.2, 1e-5) && near(c.min.y, -6) && near(c.max.y, 4), 'the wall covers the line and closes its corners');
  assert.equal(addBarrier(ctx, [[1, 1]]), null, 'one point: nothing');
  assert.equal(made.length, 2);
}
console.log('cutaway check: done');

// Mirage original code.
// The surface library without a GPU (`node packages/core/surfaces.check.mjs`, also run by `npm test` in core): every
// kind and variant makes hooks for every mapping and both paths, its defaults sit in its documented reference ranges,
// materials that differ only by numbers share a program key, specs are deterministic, the wet layer takes the kind's
// porosity. What the GPU draws (compiles, ranges read back from a bake, baked == procedural, bake time) is checked in
// Chrome by packages/tools/src/surfaces-check.mjs.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { SURFACES, SURFACE_KINDS, METALS, surfaceHooks, createMaterials, createEnv, withWet } from './src/index.js';

const G = createEnv({}).G, kit = createMaterials(G);
const tex = { c: new THREE.Texture(), n: new THREE.Texture() };
const keyOf = (h, phys = false) => (phys ? kit.phys({}, h) : kit.std({}, h)).customProgramCacheKey();
let n = 0;

// --- every kind, every variant, every mapping, both paths
for (const [k, K] of Object.entries(SURFACE_KINDS)) {
  assert.ok(K.variants.length >= 1 && K.tile > 0 && K.depth > 0, `${k}: variants, tile, depth`);
  assert.ok(K.refs && Array.isArray(K.refs.albedo) && Array.isArray(K.refs.rough) && typeof K.refs.note === 'string', `${k}: reference ranges documented`);
  for (const v of K.variants) {
    const spec = SURFACES[k]({ variant: v });
    assert.equal(spec.kind, k); assert.equal(spec.variant, v);
    for (const mapping of ['tri', 'wall', 'ground', 'grain', 'uv']) for (const mode of K.live ? ['procedural'] : ['procedural', 'baked']) {
      const h = surfaceHooks(spec, { mapping, mode, baked: tex, grain: mapping === 'grain' ? [1, 0, 0] : 'x' });
      assert.ok(h.fragmentDecl.includes(`ms_${k}(`) && h.albedo.includes('diffuseColor.rgb *= msAlb'), `${k}:${v} ${mapping} ${mode}: the recipe and the albedo`);
      assert.ok(h.uniforms.msA.value.isVector4 && h.uniforms.msX.value.x === spec.tile, `${k}:${v}: parameters are uniforms`);
      if (mode === 'baked') assert.ok(h.uniforms.msTC.value === tex.c && h.normal.includes('msNWo'), `${k}:${v}: baked taps the set, its normal`);
      n++;
    }
    // the defaults in the documented ranges (A.rgb the albedo / F0, A.a the roughness where the kind has one)
    const R = (K.refs.variants || {})[v] || K.refs, A = spec.uniforms.A;
    if (!K.live && !['glass', 'carPaint'].includes(k)) {
      const L = Math.max(A[0], A[1], A[2]);
      assert.ok(L >= R.albedo[0] && L <= R.albedo[1], `${k}:${v}: default albedo ${L} in ${R.albedo}`);
      assert.ok(A[3] >= R.rough[0] && A[3] <= R.rough[1], `${k}:${v}: default roughness ${A[3]} in ${R.rough}`);
    }
  }
}
assert.ok(Object.keys(SURFACE_KINDS).length >= 30, 'at least 30 kinds');
assert.ok(Object.values(METALS).every((c) => c.length === 3 && Math.max(...c) > 0.4 && c.every((x) => x <= 1)), 'metal F0 above 0.4 (no dark "metals")');

// --- programs: numbers are uniforms; the mapping, the path and the wet layer are not
{
  const a = keyOf(surfaceHooks(SURFACES.concrete({ color: [0.2, 0.2, 0.2], age: 0.1, seed: 4 }), { mapping: 'wall' }));
  const b = keyOf(surfaceHooks(SURFACES.concrete({ variant: 'precast', color: [0.4, 0.3, 0.2], age: 0.9, seed: 9, scale: 2 }), { mapping: 'wall', ground: 3 }));
  assert.equal(a, b, 'two concretes with other numbers and variants: one program');
  assert.notEqual(a, keyOf(surfaceHooks(SURFACES.concrete(), { mapping: 'tri' })), 'another mapping: another program');
  assert.notEqual(a, keyOf(surfaceHooks(SURFACES.concrete(), { mapping: 'wall', mode: 'baked', baked: tex })), 'baked: another program');
  assert.notEqual(a, keyOf(surfaceHooks(SURFACES.asphalt(), { mapping: 'wall' })), 'another kind: another program');
  const w1 = withWet(surfaceHooks(SURFACES.asphalt({ seed: 1 }), {}), { porosity: 0.35 }), w2 = withWet(surfaceHooks(SURFACES.asphalt({ seed: 2 }), {}), { porosity: 0.5 });
  assert.equal(keyOf(w1), keyOf(w2), 'wet asphalts with other porosity and seeds: one program');
}

// --- specs: deterministic, validated
{
  assert.equal(SURFACES.brick({ seed: 3 }).bakeKey, SURFACES.brick({ seed: 3 }).bakeKey, 'the same spec, the same bake key');
  assert.notEqual(SURFACES.brick({ seed: 3 }).bakeKey, SURFACES.brick({ seed: 4 }).bakeKey, 'another seed, another bake');
  assert.equal(SURFACES.brick({ seed: 3, dirt: 0.9, edgeWear: 0.1 }).bakeKey, SURFACES.brick({ seed: 3 }).bakeKey, 'the runtime layer does not re-bake');
  assert.throws(() => SURFACES.concrete({ variant: 'marble' }), RangeError);
  assert.throws(() => surfaceHooks(SURFACES.concrete(), { mapping: 'sphere' }), RangeError);
  assert.throws(() => surfaceHooks(SURFACES.concrete(), { mode: 'baked' }), Error);
  assert.throws(() => surfaceHooks({}, {}), TypeError);
  const hex = SURFACES.plastic({ color: '#ff0000' }).uniforms.A;
  assert.ok(Math.abs(hex[0] - 1) < 1e-6 && hex[1] === 0, 'a hex colour is sRGB, converted to linear');
  assert.ok(SURFACES.metal({ metal: 'copper' }).uniforms.A[0] > 0.9, 'metal: F0 from the table');
}

// --- options that change the program text
{
  const h = surfaceHooks(SURFACES.asphalt(), { mapping: 'ground', paint: 'step(abs(mgWorldPos.z), 0.06)' });
  assert.ok(h.albedo.includes('msRoadPaint(msS, msPW.xz, step(abs(mgWorldPos.z), 0.06))'), 'asphalt: road paint by a mask');
  const d = surfaceHooks(SURFACES.render(), { mapping: 'wall', decals: { rills: { top: 3, length: 1 }, damp: 0.6, leaks: { spacing: 1.2 } } });
  assert.ok(d.uniforms.msDa.value.toArray().join() === '3,1,0.6,0.6' && d.uniforms.msDb.value.w === 1.2, 'decals: the rules as uniforms');
  const o = surfaceHooks(SURFACES.wood(), { space: 'object' });
  assert.ok(o.vertexWorld.includes('msOP =') && o.fragmentDecl.includes('varying vec3 msOP'), 'object space: the varyings');
  const e = surfaceHooks(SURFACES.paintedMetal(), { edges: 'attribute' });
  assert.ok(e.vertexDecl.includes('attribute float edge') && e.albedo.includes('msEdgeK = msEdgeV'), 'edge wear from a vertex attribute');
  const dbg = surfaceHooks(SURFACES.concrete(), { debug: 'rough' });
  assert.ok(dbg.output.includes('vec3(msR)'), 'debug output');
  const g = surfaceHooks(SURFACES.glass(), {});
  assert.ok(g.output.includes('outgoingLight /= a'), 'glass: premultiplied, Fresnel alpha');
  const bx = surfaceHooks(SURFACES.paintedMetal(), { edges: 'box', edgeWidth: 0.05 });
  assert.ok(bx.vertexWorld.includes('msBP = position') && typeof bx.attach === 'function' && bx.uniforms.msBoxS.value.w === 0.05, 'edge wear from the box: the local position, the bounds per draw');
  const gt = surfaceHooks(SURFACES.glass({ variant: 'tinted' }), { transmission: true });
  assert.ok(gt.output.includes('transmitted.rgb') && gt.fragmentDecl.includes('msTrans'), 'glass with transmission: the per-pixel share at the output');
  assert.deepEqual(SURFACES.corrugated({ gravity: [-1, 0] }).uniforms.D.slice(0, 2), [-1, 0], 'gravity: an axis of the plane');
  assert.deepEqual(SURFACES.paintedMetal({ gravity: [0.3, -0.9] }).uniforms.D.slice(2), [0, -1], 'gravity: snapped to the nearest axis');
  const wv = SURFACES.wood({ along: 'v', board: [0.2, 1.2] }), wu = SURFACES.wood({ board: [0.2, 1.2] });
  assert.ok(wv.uniforms.B[3] === 1 && wu.uniforms.B[3] === 0 && wv.quantum[0] === wu.quantum[1] && wv.quantum[1] === wu.quantum[0], 'wood: boards along v, the breaker module turned with them');
  assert.ok(SURFACES.paving({ variant: 'hex' }).quantum[1] > 0 && SURFACES.render({ spall: 0.5 }).uniforms.B[0] === 0.5, 'paving hex, render spall');
  const cp = surfaceHooks(SURFACES.carPaint({ variant: 'metallic' }), {});
  assert.ok(cp.emissive.includes('clearcoatNormal'), 'car paint: the clear coat has its own orange peel');
}
console.log(`surfaces.check: ${n} hook sets, ${Object.keys(SURFACE_KINDS).length} kinds`);

// Mirage original code.
// The wet layer's options without a GPU (`node packages/core/wet.check.mjs`, also run by `npm test` in core): rain
// rings, specular AA, wear / shelter / rim. What the GPU draws is checked in Chrome by
// packages/tools/src/wet-check.mjs on hello-courtyard (README "Wet surfaces and rain").
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { withWet, WET_GLSL, setWetness, setRain, SPEC_AA_GLSL, createMaterials, createEnv, PROC } from './src/index.js';

const G = createEnv({}).G, kit = createMaterials(G);
const fragOf = (h) => {
  const m = kit.std({ roughness: 0.8 }, h), sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
  m.onBeforeCompile(sh); return { m, fs: sh.fragmentShader, u: sh.uniforms };
};
const key = (h) => kit.std({}, h).customProgramCacheKey();
setWetness(0); setRain(0);

// --- defaults: the options that did not exist before leave the default program's numbers where they were
{
  const w = withWet({});
  const Q = w.uniforms.mgWetQ.value;
  assert.deepEqual(Q.toArray(), [1, 1, 0, 0], 'mgWetQ defaults: ripples 1, specAA 1, shelter 0, rim 0');
  assert.ok(w.metalness.includes(', 0.0, 1.0, 0.0, diffuseColor.rgb'), 'no wear: bed bias 0.0, noise share 1.0, shelter 0.0 (literals, no new term)');
  assert.ok(!w.fragmentDecl.includes('mgWetShelter'), 'no shelter uniform unless asked for');
  assert.deepEqual(withWet({}, { wear: 'mgW' }).uniforms.mgWetQ.value.w, 1, 'wear turns the rim on by default');
  assert.deepEqual(withWet({}, { shelter: 0.3 }).uniforms.mgWetQ.value.toArray(), [1, 1, 0.3, 1], 'a numeric shelter: in mgWetQ.z, rim on');
  assert.equal(withWet({}, { wear: 'mgW', rim: 0 }).uniforms.mgWetQ.value.w, 0, 'rim: 0 overrides');
  assert.equal(withWet({}, { specAA: false }).uniforms.mgWetQ.value.y, 0, 'specAA: false');
  assert.equal(withWet({}, { specAA: true }).uniforms.mgWetQ.value.y, 1, 'specAA: true');
  assert.equal(withWet({}, { ripples: -2 }).uniforms.mgWetQ.value.x, 0, 'ripples clamp at 0');
  assert.throws(() => withWet({}, { shelter: [1] }), TypeError);
  assert.throws(() => withWet({}, { specAA: Infinity }), RangeError);
  assert.throws(() => withWet({}, { wearDepth: NaN }), RangeError);
}

// --- wear: a rut below the unworn bed, the bed's noise halved; shelter: an expression or a uniform
{
  const w = withWet({}, { wear: 'mgRut', wearDepth: 0.02, height: 'mgS.h' });
  assert.ok(w.metalness.includes('0.012 * ((mgS.h) - 0.5) + 0.02 * (0.35 - clamp((mgRut), 0.0, 1.0)), 0.5,'), 'wear: + depth * (0.35 - wear), noise share 0.5');
  const s = withWet({}, { shelter: 'mgCover' });
  assert.ok(s.metalness.includes('max(mgWetQ.z, clamp((mgCover), 0.0, 1.0))'), 'a GLSL shelter, with the constant as a floor');
  const U = { value: 0.5 }, su = withWet({}, { shelter: U });
  assert.ok(su.uniforms.mgWetShelter === U && su.fragmentDecl.includes('uniform float mgWetShelter;') && su.metalness.includes('clamp((mgWetShelter)'), 'a { value } shelter is a uniform kept by reference');
  assert.ok(/#ifdef MG_WET\nuniform float mgWetShelter;\n#endif/.test(su.fragmentDecl), 'its declaration only while wet');
  // in the GLSL: sheltered = dry (the ramp scaled away), the rim and the meniscus are no-ops at rim 0
  assert.ok(WET_GLSL.includes('s *= 1.0 - shel;') && WET_GLSL.includes('float men = 0.002 * mgWetQ.w') && WET_GLSL.includes('float rim = mgWetQ.w *'), 'shelter, meniscus and rim in the ramp');
}

// --- rain rings: off by the option, scaled by the rain, zero-cost without rain
{
  assert.ok(WET_GLSL.includes('if (uRain > 0.0 && mgWetRip > 0.0 && mgWetQ.x > 0.0)'), 'the rings are skipped without rain, far away or with ripples 0');
  assert.ok(WET_GLSL.includes('mgWetQ.x * (0.5 + 0.5 * uRain)'), 'their strength follows the rain and the option');
  assert.ok(WET_GLSL.includes('0.06 * uRain * min(mgWetQ.x, 1.0)'), "ripples 0: the pool's rain roughness goes too (the frame of rain 0)");
  assert.ok(WET_GLSL.includes('float pr = 0.75 * clamp(uRain, 0.0, 1.0);'), 'drop density from the rain');
  assert.ok(WET_GLSL.includes('mgWetRings(x, 0.3, 0.6, pr, 1.0) + mgWetRings(x + vec2(0.13, 0.37), 0.21, 0.45, pr, 2.0)'), 'two octaves of cell size, in world metres');
  assert.ok(!/uFrame|gl_FragCoord|vUv/.test(WET_GLSL), 'world space and uTime only (no UVs, no frame counter)');
}

// --- specular AA: after the wet normal, once; the dry material's own AA steps aside while wet
{
  const { fs } = fragOf(withWet(PROC.stone()));
  const at = (s) => fs.indexOf(s);
  assert.ok(at('mgWetNormal(normal, nonPerturbedNormal') > 0 && at('mgWetNormal(normal, nonPerturbedNormal') < at('roughnessFactor = mgSpecAA(roughnessFactor, normal, mgWetQ.y'), 'the wet AA follows the wet normal and the rings');
  assert.ok(fs.includes('mgWetQ.y * (1.0 + 3.0 * uRain * min(mgWetQ.x, 1.0) * mgWetPond)'), 'stronger on rippled standing water only, exactly mgWetQ.y without rain');
  assert.ok(/#if !defined\(MG_WET\)\nroughnessFactor = mgSpecAA\(roughnessFactor, normal\);\n#endif/.test(fs), "patch()'s AA only while dry");
  assert.ok(!fragOf(withWet(PROC.stone(), { specAA: 0 })).fs.includes('mgWetQ.y'), 'specAA 0: no wet AA line');
  const optedOut = fragOf(withWet({ albedo: 'roughnessFactor;', specAA: false })).fs;
  assert.ok(!optedOut.includes('mgSpecAA(roughnessFactor'), 'hooks that opted out of the AA stay without it when wet (as before)');
  // the helper: exported, guarded (pasting it twice compiles), overloaded with a strength
  assert.ok(SPEC_AA_GLSL.startsWith('#ifndef MG_SPEC_AA') && /float mgSpecAA\(float r, vec3 n, float k\)/.test(SPEC_AA_GLSL), 'SPEC_AA_GLSL: guarded, with a strength');
  assert.ok(fs.includes(SPEC_AA_GLSL), 'every patched lit material carries it');
  // patch() takes a number as the strength, and specAAIf as an extra #if
  assert.ok(fragOf({ specAA: 2.5 }).fs.includes('roughnessFactor = mgSpecAA(roughnessFactor, normal, 2.5000);'), 'hooks.specAA: a number = always, that strength');
  assert.ok(!fragOf({ specAA: 0 }).fs.includes('mgSpecAA(roughnessFactor'), 'hooks.specAA: 0 = none');
  assert.ok(fragOf({ specAA: 'defined(A)', specAAIf: '!defined(B)' }).fs.includes('#if (defined(A)) && (!defined(B))'), 'specAA string and specAAIf combine');
}

// --- programs: per-material numbers do not make programs
{
  const base = PROC.plaster();
  const k0 = key(withWet(base));
  for (const o of [{ porosity: 0.1 }, { ripples: 3 }, { ripples: 0 }, { specAA: 0.3 }, { rim: 0.5 }, { band: 2, ground: 4, puddles: 2 }])
    assert.equal(key(withWet(base, o)), k0, `${JSON.stringify(o)} shares the program`);
  const ks = key(withWet(base, { shelter: 0.2 }));
  assert.equal(key(withWet(base, { shelter: 0.9, porosity: 0.3 })), ks, 'numeric shelters share one program');
  assert.equal(key(withWet(base, { shelter: { value: 0.1 } })), key(withWet(base, { shelter: { value: 0.7 } })), 'uniform shelters share one program');
  assert.notEqual(key(withWet(base, { wear: 'mgA' })), key(withWet(base, { wear: 'mgB' })), 'a different GLSL wear is its own program (like height)');
}

// --- re-applying: the options travel with the hooks
{
  const w = withWet(PROC.plaster(), { wear: 'mgW', porosity: 0.3 });
  assert.equal(w.__wetOptions.wear, 'mgW');
  assert.ok(!Object.keys(w).includes('__wetOptions'), 'not enumerable (not in the program key)');
  const again = withWet(w, { ...w.__wetOptions, ripples: 2 });
  assert.equal(again.metalness.match(/mgWetApply\(/g).length, 1, 're-wrapped, one wet layer');
}
console.log('wet check: ok');

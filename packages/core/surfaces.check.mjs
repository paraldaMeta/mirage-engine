// Mirage original code.
// The surface framework without a GPU and without the library's recipes (`node packages/core/surfaces.check.mjs`, also
// run by `npm test` in core): with nothing registered it loads and makes an empty library; a kind registered with its
// table entry and recipe gets specs, hooks for every mapping and both paths, and its own program pieces; the decals
// need registered decals. The library's 35 kinds are checked by packages/assets/surfaces.check.mjs.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { registerSurfaceKinds, registerSurfaceDecals, surfaceKinds, surfaceSpec, surfaceHooks, createSurfaces, createMaterials, createEnv } from './src/index.js';
import * as glsl from './src/surface-glsl.js';

const G = createEnv({}).G, kit = createMaterials(G);
const tex = { c: new THREE.Texture(), n: new THREE.Texture() };

// --- nothing registered: the framework loads, the library is empty, specs need a kind
assert.deepEqual(Object.keys(surfaceKinds()), [], 'no kinds built in');
assert.deepEqual(Object.keys(glsl), ['MS_COMMON'], 'surface-glsl: only the shared helpers');
const empty = createSurfaces({ renderer: null, mat: kit });
assert.ok(typeof empty.material === 'function' && Object.keys(empty.SURFACES).length === 0 && Object.keys(empty.KINDS).length === 0, 'an empty library');
assert.throws(() => surfaceSpec('concrete'), Error);
assert.throws(() => registerSurfaceKinds({ kinds: { bare: {} } }), Error);

// --- a kind of one's own: a flat tinted plane
registerSurfaceKinds({
  kinds: {
    flat: {
      family: 'coating', variants: ['matte', 'gloss'], tile: 1, depth: 0.001, size: 256, porosity: 0.2,
      refs: { albedo: [0, 1], rough: [0, 1], metal: 0, note: 'a test kind' },
      defaults: { color: [0.5, 0.5, 0.5], roughness: 0.6 },
      pack: (o) => ({ A: [...o.color, o.roughness], B: [0, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
      body: () => '  msS.r *= 1.0;\n',
      hooks: (h) => { h.emissive = '/* flat */'; },
      prepare: (base) => { base.transparent = true; return true; },
    },
  },
  glsl: { flat: 'MsS ms_flat(vec2 u){ return MsS(msA.rgb, msA.a, 0.5, 0.0, 1.0); }' },
});
assert.deepEqual(Object.keys(surfaceKinds()), ['flat'], 'the registered kind is listed');
const spec = surfaceSpec('flat', { variant: 'gloss', color: '#ff0000' });
assert.ok(spec.isSurface && spec.kind === 'flat' && spec.variant === 'gloss' && Math.abs(spec.uniforms.A[0] - 1) < 1e-6, 'a spec of the registered kind');
let n = 0;
for (const mapping of ['tri', 'wall', 'ground', 'grain', 'uv']) for (const mode of ['procedural', 'baked']) {
  const h = surfaceHooks(spec, { mapping, mode, baked: tex });
  assert.ok(h.fragmentDecl.includes('ms_flat(') && h.fragmentDecl.includes('#define MS_COMMON') && h.albedo.includes('msS.r *= 1.0'), `${mapping} ${mode}: the recipe, the helpers, the kind's body`);
  assert.equal(h.emissive, '/* flat */', 'the kind\'s hooks');
  n++;
}
const lib = createSurfaces({ renderer: null, mat: kit }, { mode: 'procedural' });
const m = lib.material(spec);
assert.ok(m.isMeshPhysicalMaterial && m.transparent && m.name === 'surface-flat-gloss' && m.userData.surface === 'gravel', 'prepare: a physical, transparent material; footsteps by family');
assert.throws(() => surfaceHooks(spec, { decals: { damp: 0.5 } }), Error);
registerSurfaceDecals({ glsl: 'void msDecals(inout MsS s, vec3 p, vec3 n){}', fragment: 'void main(){}', uniforms: () => ({ msDa: { value: new THREE.Vector4() } }) });
const d = surfaceHooks(spec, { decals: { damp: 0.5 } });
assert.ok(d.fragmentDecl.includes('void msDecals') && d.uniforms.msDa && 'msDecalAtlas' in d.uniforms, 'registered decals: their GLSL and uniforms');
console.log(`surfaces framework check: ${n} hook sets, a kind of one's own`);

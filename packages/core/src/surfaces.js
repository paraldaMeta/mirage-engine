// Mirage original code.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { hash32 } from './rng.js';
import { withWet } from './wet.js';
import { MS_COMMON } from './surface-glsl.js';

// ---------------------------------------------------------------------------
// The surface framework: physically plausible materials made in code from registered recipes.
//
//   import { SURFACES, createSurfaces } from '@miragekit/assets/surfaces';   // the library's recipes (BUSL-1.1)
//   const lib = createSurfaces(world);                           // baked by default (falls back to procedural)
//   const wall = lib.material(SURFACES.concrete({ variant: 'cast', age: 0.5 }), { mapping: 'wall', wet: true });
//   const deck = lib.material(SURFACES.wood({ variant: 'planks' }), { mapping: 'grain', grain: [1, 0, 0] });
//
// A surface is a recipe (registered: registerSurfaceKinds) plus numbers. Two paths behind one call:
//   procedural  the recipe runs per pixel (its octaves cut by the pixel's footprint: far pixels cost less)
//   baked       the recipe is rendered once into a tileable texture set on the GPU (albedo + roughness, normal +
//               height + metalness; mipmapped, anisotropic), sampled with the same mapping, a repetition breaker and
//               the same world-space macro layer on top. Several times cheaper per pixel. Deterministic (seeded).
// Both go through patch(): lighting, shadows, image-based light, fog, the wet layer (withWet, porosity from the
// kind), planar and screen-space reflections, probes and the lamp pool all keep working.
//
// Runtime layer (both paths, live uniforms; not baked): macro variation in world space (hides the tile), dirt in
// cavities / at the foot / on top faces, run-off streaks (age), edge wear from the surface's curvature or a vertex
// attribute, weathering decals placed by rules (rills under a ledge, damp at the base, leaks under fixings, stains,
// soot, cracks), the asphalt's road paint.
// ---------------------------------------------------------------------------

const lin = (c, d) => {
  if (c == null) return d;
  if (Array.isArray(c)) return c.map(Number);
  const k = new THREE.Color(c); return [k.r, k.g, k.b];
};
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));

const DIRT = [0.11, 0.095, 0.08];
// the footstep sound a family walks with (@miragekit/game's surfaces; metal rattles like gravel)
const FOOTSTEP = { wood: 'wood', metal: 'gravel', coating: 'gravel', composite: 'gravel', ground: 'stone', masonry: 'stone', ceramic: 'stone' };
// ---- the registry ---------------------------------------------------------------------------------------------------
// The kinds are registered, not built in: a kind is its table entry (family, variants, tile, depth, size, porosity, refs,
// defaults, pack, quantum, edge, material; optional: cheap, live, physical, mapping, micro, variantDefaults, and the
// program hooks body(spec, options) -> GLSL added to the evaluation, hooks(h, spec, options) to adjust the hooks,
// prepare(base, spec, options) -> true for a MeshPhysicalMaterial) and its GLSL recipe (`glsl`: baked or per pixel;
// `liveGlsl`: per pixel only, writing msEmit). @miragekit/assets/surfaces registers the library's 35 kinds and its
// weathering decals. With nothing registered the framework still loads; a spec needs a registered kind.
const KINDS = {};
const KIND_GLSL = {};
const LIVE_GLSL = {};
let DECALS = null;
/** Register surface kinds: { kinds: { name: entry }, glsl: { name: recipe }, liveGlsl: { name: recipe } }. A name
 *  registered again is replaced. */
export function registerSurfaceKinds({ kinds = {}, glsl = {}, liveGlsl = {} } = {}) {
  for (const [k, v] of Object.entries(kinds)) {
    if (!glsl[k] && !liveGlsl[k]) throw new Error(`registerSurfaceKinds: "${k}" has no recipe`);
    KINDS[k] = v; delete KIND_GLSL[k]; delete LIVE_GLSL[k];
    if (liveGlsl[k]) LIVE_GLSL[k] = liveGlsl[k]; else KIND_GLSL[k] = glsl[k];
  }
}
/** Register the weathering decals (options.decals): { glsl (declares msDecals(inout MsS, vec3, vec3)), fragment (the
 *  atlas baker's fragment shader, GLSL3, uniform msN), uniforms(decals) -> { name: { value } } }. */
export function registerSurfaceDecals(decals) { DECALS = decals; }
/** Everything the framework knows about each registered kind (family, variants, tile, depth, porosity, reference
 *  ranges, defaults). */
export function surfaceKinds() {
  return Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, {
    family: v.family, variants: [...v.variants], tile: v.tile, cheap: !!v.cheap, depth: v.depth, size: v.size || 0, porosity: v.porosity, live: !!v.live, physical: !!v.physical,
    refs: v.refs, defaults: v.defaults,
  }]));
}

// ---- specs ----------------------------------------------------------------------------------------------------------
// common options: variant, scale (pattern size multiplier), seed, age 0..1, dirt 0..1, edgeWear 0..1, variation (macro
// tone, 0..1), dirtColor, tile (m: the bake / repeat period)
function makeSpec(kind, opt = {}) {
  const K = KINDS[kind];
  if (!K) throw new Error(`[mirage/surfaces] unknown kind "${kind}"`);
  const vName = opt.variant ?? K.variants[0];
  const v = typeof vName === 'number' ? vName : K.variants.indexOf(vName);
  if (v < 0 || v >= K.variants.length) throw new RangeError(`[mirage/surfaces] ${kind}: unknown variant "${vName}" (have: ${K.variants.join(', ')})`);
  const o = { ...K.defaults, ...((K.variantDefaults || {})[K.variants[v]] || {}), ...opt };
  for (const k of ['color', 'stone', 'paint', 'primer', 'jointColor', 'mortarColor', 'groutColor', 'altColor', 'patchColor', 'rustColor', 'tarnishColor', 'flakeColor', 'dirtColor', 'stripe', 'latewood', 'glow', 'bare']) {
    if (k in o && o[k] != null) o[k] = lin(o[k]);
  }
  const P = K.pack(o);
  const T = +(opt.tile ?? K.tile), seed = +(opt.seed ?? 1) % 997;
  const common = {
    X: [T, seed, v, +(opt.scale ?? 1)],
    W: [clamp01(opt.age ?? 0.35), clamp01(opt.dirt ?? (K.family === 'metal' || K.family === 'coating' ? 0.15 : 0.3)), clamp01(opt.edgeWear ?? (K.live ? 0 : K.family === 'coating' || K.family === 'metal' ? 0.25 : 0.5)), clamp01(opt.variation ?? 0.5)],
    G: [...lin(opt.dirtColor, DIRT), 0],
  };
  const e = K.edge ? K.edge(o, v) : { rgb: [1, 1, 1], rough: 0.5, metal: 0, mode: -1, chip: 0.01 };
  const q = K.quantum ? K.quantum(o, T, v) : [0, 0];
  const spec = {
    isSurface: true, kind, variant: K.variants[v], options: o, uniforms: { ...P, ...common, E: [...e.rgb, e.rough], F: [e.metal, e.mode, e.chip, 1] },
    quantum: q, tile: T, depth: K.depth * +(opt.scale ?? 1), porosity: opt.porosity ?? K.porosity, live: !!K.live, physical: !!K.physical,
    material: K.material ? K.material(o, v) : {}, size: K.size || 0,
  };
  // the numbers the baked texture depends on (the runtime layer's are live)
  spec.bakeKey = kind + ':' + hash32(JSON.stringify([P, common.X, common.W[0], K.size]));
  return spec;
}
/** surfaceSpec(kind, options) -> a surface spec of a registered kind (data: kind, variant, the packed numbers); see
 *  surfaceKinds() for the kinds, their variants and defaults. */
export function surfaceSpec(kind, opt) { return makeSpec(kind, opt); }
const specMakers = () => Object.fromEntries(Object.keys(KINDS).map((k) => [k, (opt) => makeSpec(k, opt)]));

// ---- hooks ----------------------------------------------------------------------------------------------------------
const MAPPINGS = ['tri', 'wall', 'ground', 'grain', 'uv'];
const AXES = { x: 1, y: 2, z: 3 };

// the frames: up to three planar projections; T, B = the world directions of u and v
const FRAME_GLSL = /* glsl */ `
vec3 msFrameT[3]; vec3 msFrameB[3]; vec3 msFrameW;
void msFrames(vec3 p, vec3 n, int mapping){
  float g = msY.x;
  if (mapping == 2) {          // ground
    msFrameT[0] = g > 2.5 ? vec3(0, 0, 1) : vec3(1, 0, 0); msFrameB[0] = g > 2.5 ? vec3(1, 0, 0) : vec3(0, 0, 1); msFrameW = vec3(1, 0, 0);
  } else if (mapping == 1) {   // wall: u along the wall, v up; the ground projection on tops
    vec3 T = vec3(-n.z, 0.0, n.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1, 0, 0);
    bool up = g > 1.5 && g < 2.5;
    msFrameT[0] = up ? vec3(0, 1, 0) : T; msFrameB[0] = up ? T : vec3(0, 1, 0);
    msFrameT[1] = vec3(1, 0, 0); msFrameB[1] = vec3(0, 0, 1);
    float wy = smoothstep(0.6, 0.8, abs(n.y));
    msFrameW = vec3(1.0 - wy, wy, 0.0);
  } else if (mapping == 3) {   // grain: u along the grain vector projected into the face (any orientation, one tap)
    vec3 gv = msGrainV, t = cross(n, gv); float tl = length(t);
    vec3 alt = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
    t = tl > 0.2 ? t / tl : alt;
    msFrameT[0] = normalize(cross(t, n)); msFrameB[0] = t; msFrameW = vec3(1, 0, 0);
  } else {                     // triplanar, the grain axis kept as u where it lies in the plane
    msFrameT[0] = g > 1.5 && g < 2.5 ? vec3(0, 1, 0) : vec3(0, 0, 1); msFrameB[0] = g > 1.5 && g < 2.5 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    msFrameT[1] = g > 2.5 ? vec3(0, 0, 1) : vec3(1, 0, 0); msFrameB[1] = g > 2.5 ? vec3(1, 0, 0) : vec3(0, 0, 1);
    msFrameT[2] = g > 1.5 && g < 2.5 ? vec3(0, 1, 0) : vec3(1, 0, 0); msFrameB[2] = g > 1.5 && g < 2.5 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    vec3 w = pow(abs(n), vec3(8.0)); w /= w.x + w.y + w.z;
    w = max(w - 0.04, 0.0); msFrameW = w / (w.x + w.y + w.z);
  }
}
MsS msZero(){ return MsS(vec3(0.0), 0.0, 0.0, 0.0, 0.0); }
void msAcc(inout MsS o, MsS s, float w){ o.a += s.a * w; o.r += s.r * w; o.h += s.h * w; o.m += s.m * w; o.ao += s.ao * w; }
`;

// the runtime layer: macro variation, dirt, streaks, edge wear (both paths)
const FINISH_GLSL = /* glsl */ `
// the runtime layer's noise: four independent tileable fractal channels in one small texture (noiseTexture()), read
// in a plane across the world's diagonal (no axis-aligned face sees it edge-on): a few taps instead of hashing
uniform sampler2D msNoiseT;
vec2 msNQ(vec3 p){ return vec2(dot(p, vec3(0.7071, 0.0, -0.7071)), dot(p, vec3(-0.4082, 0.8165, -0.4082))); }
vec4 msN4(vec3 p, float f){ return texture(msNoiseT, msNQ(p) * (f * 0.125)) * 2.0 - 1.0; }
void msFinish(inout MsS s, vec3 wp, vec3 wn, float fpw){
  vec4 n1 = msN4(wp + msX.y, 0.23), n2 = msN4(wp + 3.1, 1.7);
  float v1 = 0.65 * n1.r + 0.35 * n1.g, v2 = n2.b;
  if (msW.w > 0.0) {   // macro variation: hides the tile
    s.a *= max(1.0 + msW.w * (0.3 * v1 + 0.1 * v2), 0.2);
    s.r = clamp(s.r + msW.w * 0.06 * v1, 0.02, 1.0);
  }
  if (msW.y > 0.0) {   // dirt: in the cavities, at the foot, on top faces; run-off streaks down walls with age
    float up = clamp(wn.y, 0.0, 1.0), wall = 1.0 - abs(wn.y);
    float foot = 1.0 - smoothstep(0.0, 0.45 + 0.4 * (v1 * 0.5 + 0.5), wp.y - msG.w);
    float cav = clamp((0.5 - s.h) * 2.2, 0.0, 1.0);
    float d = msW.y * clamp(0.6 * cav * (0.7 + 0.3 * v2) + 0.55 * foot + 0.3 * up * smoothstep(-0.2, 0.6, n2.a), 0.0, 1.0);
    vec3 T = vec3(-wn.z, 0.0, wn.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1.0, 0.0, 0.0);
    vec4 sn = texture(msNoiseT, vec2(dot(wp, T) * 0.3, wp.y * 0.02 + msX.y));
    float st = sn.r * 0.6 + sn.g * 0.4;
    d = clamp(d + 0.5 * msW.x * msW.y * smoothstep(0.45, 0.8, st) * wall, 0.0, 1.0);
    s.a = mix(s.a, msG.rgb * (0.85 + 0.3 * (v2 * 0.5 + 0.5)), d * 0.8);
    s.r = mix(s.r, 0.9, d * 0.75);
    s.m *= 1.0 - d;
  }
  if (msF.y >= 0.0 && msW.z > 0.0 && msEdgeK > 0.02) {   // edge wear, broken into chips
    float cs = msF.z;
    vec2 cq = msNQ(wp) / cs * 0.125;
    float lod = log2(max(fpw / cs * 32.0, 1.0));
    vec4 cnv = textureLod(msNoiseT, cq, lod);
    float cn = 0.7 * cnv.r + 0.3 * cnv.a;
    float e = clamp(msEdgeK * msW.z * 1.6, 0.0, 1.0);
    float ex = smoothstep(0.55, 0.6, e * 0.6 + (cn - 0.5) * 1.2 + 0.05);
    if (msF.y < 0.5) { s.a = mix(s.a, msE.rgb, ex); s.m = mix(s.m, msF.x, ex); }
    else s.a = mix(s.a, s.a * msE.rgb, ex);
    s.r = mix(s.r, msE.a, ex);
    s.h -= 0.15 * ex;
  }
}
`;

// four tileable fractal value-noise channels (256 x 256, eight base cells per tile), made once in JS (deterministic)
let NOISE_TEX = null;
/** The runtime layer's shared noise texture (RGBA8, 256 x 256, repeat, mipmapped; four independent channels). */
export function noiseTexture() {
  if (NOISE_TEX) return NOISE_TEX;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x, y, c) => { let h = Math.imul(x * 374761393 + y * 668265263 + c * 2147483647, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const val = (x, y, P, c) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const h = (i, j) => hash(((xi + i) % P + P) % P, ((yi + j) % P + P) % P, c);
    return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fy) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 4; c++) {
    let s = 0, a = 0.5, tot = 0;
    for (let o = 0, P = 8; o < 5; o++, P *= 2, a *= 0.5) { s += a * val(x / N * P + c * 0.37, y / N * P + c * 0.71, P, c * 7 + o); tot += a; }
    const v = (s / tot - 0.5) * 1.9 + 0.5;   // contrast back what the octaves average away
    data[4 * (y * N + x) + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; t.name = 'surface-noise';
  return (NOISE_TEX = t);
}

// road paint on asphalt (options.paint: a GLSL float 0..1, the marking's mask; its colour msPaint)
const PAINT_GLSL = /* glsl */ `
uniform vec4 msPaint;
void msRoadPaint(inout MsS s, vec2 u, float mask){
  // thermoplastic: a raised film with glass beads (fine glints), worn in the wheel paths and on the aggregate tops
  float wear = smoothstep(0.35, 0.75, mgFbm3(vec3(u * 1.6, 2.0), 3) * 0.5 + 0.5 + 0.35 * (s.h - 0.5));
  float m = clamp(mask, 0.0, 1.0) * (1.0 - wear * msPaint.a);
  float bead = step(0.82, mgHash3(vec3(floor(u * 900.0), 4.0)).x) * clamp(0.0009 / max(msFP, 1e-6) - 0.5, 0.0, 1.0);
  s.a = mix(s.a, msPaint.rgb * (0.9 + 0.1 * mgFbm3(vec3(u * 40.0, 1.0), 2)), m);
  s.r = mix(s.r, mix(0.55, 0.2, bead), m);
  s.h = mix(s.h, max(s.h, 0.62), m);
}
`;

const fmt = (v) => { const n = +(+v).toFixed(6); return Number.isInteger(n) ? n.toFixed(1) : String(n); };
const v4 = (a) => new THREE.Vector4(...a);

/**
 * The patch() hooks of a surface. options: mode 'procedural' | 'baked' (needs baked: { c, n } textures),
 * mapping 'tri' | 'wall' | 'ground' | 'grain' | 'uv', grain ([x, y, z] for 'grain'; 'x' | 'y' | 'z' keeps that world
 * axis as u in 'tri' / 'wall' / 'ground'), space 'world' | 'object', uvScale (m per uv unit), ground (m: the foot),
 * breaker (baked: hide the repeat, true), edges 'curvature' | 'attribute' (vertex attribute `edge` 0..1),
 * decals { rills: { top, length, density }, damp, stains, cracks, soot, leaks }, paint (asphalt: a GLSL float mask),
 * paintColor, debug ('albedo' | 'rough' | 'height' | 'metal'), lod (footprints per wavelength under which detail is
 * dropped: 3; 2 matches a bake).
 */
export function surfaceHooks(spec, options = {}) {
  if (!spec || !spec.isSurface) throw new TypeError('surfaceHooks: pass a spec from SURFACES.<kind>(...)');
  const K = KINDS[spec.kind];
  if (!K) throw new Error(`surfaceHooks: the kind "${spec.kind}" is not registered`);
  const o = { mapping: K.mapping || 'tri', mode: 'procedural', space: 'world', breaker: true, edges: 'curvature', ...options };
  if (!MAPPINGS.includes(o.mapping)) throw new RangeError(`surfaceHooks: mapping must be one of ${MAPPINGS.join(', ')}`);
  const live = spec.live, baked = !live && o.mode === 'baked';
  if (baked && !(o.baked && o.baked.c && o.baked.n)) throw new Error('surfaceHooks: mode "baked" needs options.baked { c, n } (createSurfaces bakes them)');
  const U = spec.uniforms;
  const grainVec = Array.isArray(o.grain) ? new THREE.Vector3(...o.grain).normalize() : new THREE.Vector3(1, 0, 0);
  const grainAxis = typeof o.grain === 'string' ? AXES[o.grain] || 0 : 0;
  const Y = [grainAxis, spec.depth, spec.quantum[0] || 0, spec.quantum[1] || 0];
  const F = [...U.F]; F[3] = o.breaker === false ? 0 : 1;
  const G = [...U.G]; G[3] = +(o.ground ?? 0);
  const uniforms = {
    msX: { value: v4(U.X) }, msY: { value: v4(Y) }, msW: { value: v4(U.W) }, msA: { value: v4(U.A) }, msB: { value: v4(U.B) }, msC: { value: v4(U.C) },
    msD: { value: v4(U.D) }, msE: { value: v4(U.E) }, msF: { value: v4(F) }, msG: { value: v4(G) }, msGrainV: { value: grainVec }, msUVScale: { value: +(o.uvScale ?? 1) }, msNoiseT: { value: noiseTexture() },
  };
  const mapIdx = { tri: 0, wall: 1, ground: 2, grain: 3, uv: 4 }[o.mapping];
  const objectSpace = o.space === 'object';
  const fn = 'ms_' + spec.kind;
  let decl = MS_COMMON + 'uniform vec3 msGrainV; uniform float msUVScale; varying vec2 msUVraw;\n' + (objectSpace ? 'varying vec3 msOP; varying vec3 msON;\n' : '')
    + (o.edges === 'attribute' ? 'varying float msEdgeV;\n' : '') + (o.edges === 'box' ? 'varying vec3 msBP; uniform vec3 msBoxLo; uniform vec3 msBoxHi; uniform vec4 msBoxS;\n' : '')
    + FRAME_GLSL + FINISH_GLSL + (LIVE_GLSL[spec.kind] || KIND_GLSL[spec.kind]);
  if (baked) {
    uniforms.msTC = { value: o.baked.c }; uniforms.msTN = { value: o.baked.n };
    // close up, where a pixel is finer than the set's texel: the kind's grain as a runtime detail layer over the bake
    uniforms.msMi = { value: new THREE.Vector4(...(K.micro || [0, 0, 0, 0])) };
    uniforms.msBakeN = { value: o.baked.size || (o.baked.c.image && o.baked.c.image.width) || 1024 };
    decl += /* glsl */ `
uniform sampler2D msTC; uniform sampler2D msTN; uniform vec4 msMi; uniform float msBakeN; float msMicroH = 0.0;
// one baked tap: the tile at uv (m), a repetition breaker (offsets in whole pattern modules, cross-faded by height)
void msTap(vec2 uv, vec2 gx, vec2 gy, out vec4 c, out vec4 n){
  vec2 t = uv / msT, tx = gx / msT, ty = gy / msT;
  if (msF.w > 0.5) {
    // patches of ~3 tiles pick one of six offsets (whole pattern modules); neighbours cross-fade, the seam steered by
    // the two heights; where one offset rules alone (most pixels) only its two taps are read
    float v = textureGrad(msNoiseT, t * 0.046 + msSeed * 0.013, tx * 0.046, ty * 0.046).r * 6.0, i = floor(v), f = fract(v);
    vec2 oa = mgHash3(vec3(i, 7.0, msSeed)).xy * 17.0, ob = mgHash3(vec3(i + 1.0, 7.0, msSeed)).xy * 17.0;
    vec2 q = msY.zw / msT;
    oa = vec2(q.x > 0.0 ? floor(oa.x / q.x) * q.x : oa.x, q.y > 0.0 ? floor(oa.y / q.y) * q.y : oa.y);
    ob = vec2(q.x > 0.0 ? floor(ob.x / q.x) * q.x : ob.x, q.y > 0.0 ? floor(ob.y / q.y) * q.y : ob.y);
    float w0 = smoothstep(0.25, 0.75, f);
    if (w0 <= 0.0) { c = textureGrad(msTC, t + oa, tx, ty); n = textureGrad(msTN, t + oa, tx, ty); }
    else if (w0 >= 1.0) { c = textureGrad(msTC, t + ob, tx, ty); n = textureGrad(msTN, t + ob, tx, ty); }
    else {
      vec4 na = textureGrad(msTN, t + oa, tx, ty), nb = textureGrad(msTN, t + ob, tx, ty);
      float w = smoothstep(0.25, 0.75, f + 0.5 * (nb.b - na.b));
      c = mix(textureGrad(msTC, t + oa, tx, ty), textureGrad(msTC, t + ob, tx, ty), w);
      n = mix(na, nb, w);
    }
  } else { c = textureGrad(msTC, t, tx, ty); n = textureGrad(msTN, t, tx, ty); }
}`;
  }
  if (o.decals) {
    if (!DECALS) throw new Error('surfaceHooks: options.decals needs registered decals (registerSurfaceDecals; @miragekit/assets/surfaces has them)');
    decl += DECALS.glsl;
  }
  if (o.paint) decl += PAINT_GLSL;
  // the evaluation: in uniform flow the footprint, the edge measure and the projected gradients; then the taps
  const pos = objectSpace ? 'msOP' : 'mgWorldPos', nrm = objectSpace ? 'normalize(msON)' : 'normalize(mgWorldNormal)';
  const tapProc = (i, uv) => `msAcc(msS, ${fn}(${uv}), msFrameW[${i}]);`;
  const tapBaked = (i, uv) => `{ vec4 c, n; msTap(${uv}, msGx[${i}], msGy[${i}], c, n); vec2 t = n.xy * 2.0 - 1.0;
      msAcc(msS, MsS(c.rgb, c.a, n.b, n.a, 1.0), msFrameW[${i}]);
      msNW += (msFrameT[${i}] * t.x + msFrameB[${i}] * t.y + msWN * sqrt(max(1.0 - dot(t, t), 0.0))) * msFrameW[${i}]; }`;
  const nTaps = { tri: 3, wall: 2, ground: 1, grain: 1, uv: 1 }[o.mapping];
  let body = /* glsl */ `
  msT = msX.x; msSeed = msX.y; msLodA = ${fmt(o.lod ?? 3)};
  vec3 msP0 = ${pos}, msWN = ${nrm};
  vec3 msPW = mgWorldPos, msNWorld = normalize(mgWorldNormal);
  float msFPW = max(length(dFdx(mgWorldPos)), length(dFdy(mgWorldPos)));
  msFP = msFPW / msX.w;
  ${o.edges === 'attribute' ? 'msEdgeK = msEdgeV;' : 'msEdgeK = smoothstep(4.0, 30.0, length(fwidth(msNWorld)) / max(length(fwidth(msPW)), 1e-5));'}
  ${o.edges === 'box' ? `{ // the object's own box: distance to its edges (two of the three face pairs near), in metres; wear within msBoxS.w
    vec3 bd = min(msBP - msBoxLo, msBoxHi - msBP) * msBoxS.xyz;
    float e2 = max(min(bd.x, bd.y), min(max(bd.x, bd.y), bd.z));
    msEdgeK = max(msEdgeK, 1.0 - smoothstep(0.0, msBoxS.w, e2)); }` : ''}
  msFrames(msP0, msWN, ${mapIdx});
  vec2 msU[3]; vec2 msGx[3]; vec2 msGy[3];
  vec3 msDX = dFdx(msP0) / msX.w, msDY = dFdy(msP0) / msX.w;
  for (int i = 0; i < ${nTaps}; i++) {
    msU[i] = vec2(dot(msP0, msFrameT[i]), dot(msP0, msFrameB[i])) / msX.w;
    msGx[i] = vec2(dot(msDX, msFrameT[i]), dot(msDX, msFrameB[i])); msGy[i] = vec2(dot(msDY, msFrameT[i]), dot(msDY, msFrameB[i]));
  }`;
  if (o.mapping === 'uv') {
    body += /* glsl */ `
  msU[0] = msUVraw * msUVScale / msX.w; msGx[0] = dFdx(msU[0]); msGy[0] = dFdy(msU[0]); msFrameW = vec3(1, 0, 0);
  { vec3 dp1 = dFdx(msPW), dp2 = dFdy(msPW); vec2 du1 = dFdx(msUVraw), du2 = dFdy(msUVraw);
    vec3 a1 = cross(dp2, msNWorld), a2 = cross(msNWorld, dp1);
    vec3 Tt = a1 * du1.x + a2 * du2.x, Bt = a1 * du1.y + a2 * du2.y;
    float s = inversesqrt(max(max(dot(Tt, Tt), dot(Bt, Bt)), 1e-12));
    msFrameT[0] = Tt * s; msFrameB[0] = Bt * s; }`;
  }
  body += '\n  MsS msS = msZero(); vec3 msNW = vec3(0.0);\n';
  for (let i = 0; i < nTaps; i++) body += `  if (msFrameW[${i}] > 0.0) ${(baked ? tapBaked : tapProc)(i, `msU[${i}]`)}\n`;
  if (!baked) body += '  msS.a *= msS.ao;\n';   // the bake folds the cavity into the albedo
  else body += `  if (msMi.x > 0.0) {
    vec2 mq = msNQ(msPW) / msMi.x * 0.125;
    vec2 mq2 = mat2(0.8, 0.6, -0.6, 0.8) * mq * 2.37 + 0.31;
    vec4 md = (textureGrad(msNoiseT, mq, dFdx(mq), dFdy(mq)) + textureGrad(msNoiseT, mq2, dFdx(mq2), dFdy(mq2))) * 0.5 - 0.5;
    float mk = clamp(msT / msBakeN / max(msFP, 1e-6) - 1.0, 0.0, 1.0);
    float g = (md.r * 0.7 + md.g * 0.3) * mk;
    msS.a *= 1.0 + msMi.y * g * 2.5; msS.r = clamp(msS.r + msMi.w * g * 2.0, 0.02, 1.0); msMicroH = msMi.z * g * 0.4;
  }\n`;
  // the kind's own evaluation step, before the runtime layer (glass: the transmitted share)
  if (K.body) body += K.body(spec, o);
  if (o.paint) body += `  msRoadPaint(msS, msPW.xz, ${o.paint});\n`;
  if (o.decals) body += '  msDecals(msS, msPW, msNWorld);\n';
  if (!live) body += '  msFinish(msS, msPW, msNWorld, msFPW);\n';
  body += '  msH = clamp(msS.h, 0.0, 1.0); msM = clamp(msS.m, 0.0, 1.0); msR = clamp(msS.r, 0.02, 1.0); msAlb = msS.a;\n';
  if (baked) body += '  msNWo = msNW;\n';
  const h = {
    fragmentDecl: decl + '\nvec3 msAlb = vec3(0.5); vec3 msNWo = vec3(0.0);\n',
    albedo: `{${body}\n  diffuseColor.rgb *= msAlb; }`,
    roughness: 'roughnessFactor = msR;',
    metalness: 'metalnessFactor = msM;',
    normal: baked
      ? 'if (dot(msNWo, msNWo) > 0.0) { vec3 wn = normalize(mgWorldNormal); normal = normalize(normal + (viewMatrix * vec4(normalize(msNWo) - wn, 0.0)).xyz); }\nnormal = mgBump(normal, msMicroH * msY.y, 1.0);'
      : 'normal = mgBump(normal, msH * msY.y, 1.0);',
    uniforms,
    vertexDecl: 'varying vec2 msUVraw;' + (objectSpace ? ' varying vec3 msOP; varying vec3 msON;' : '') + (o.edges === 'attribute' ? ' attribute float edge; varying float msEdgeV;' : '') + (o.edges === 'box' ? ' varying vec3 msBP;' : ''),
    vertexWorld: 'msUVraw = uv;' + (o.edges === 'box' ? ' msBP = position;' : '') + (objectSpace ? ` msOP = mgW4.xyz * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      msON = vec3(0.0, 1.0, 0.0);
      #ifdef USE_INSTANCING
        msON = mat3(instanceMatrix) * normal;
      #else
        msON = normal;
      #endif` : '') + (o.edges === 'attribute' ? ' msEdgeV = edge;' : ''),
  };
  // the kind's own program pieces (car paint: the clear coat; water: its normal; glass: the output)
  if (K.hooks) K.hooks(h, spec, o);
  if (LIVE_GLSL[spec.kind]) {
    h.emissive = (h.emissive ? h.emissive + '\n' : '') + 'totalEmissiveRadiance += msEmit * max(uLampGain, msD.x);';
  }
  if (o.decals) {
    Object.assign(uniforms, DECALS.uniforms(o.decals));
    uniforms.msDecalAtlas = { value: o.decalAtlas || null };
  }
  if (o.paint) uniforms.msPaint = { value: new THREE.Vector4(...lin(o.paintColor, [0.62, 0.6, 0.55]), +(o.paintWear ?? 0.6)) };
  if (o.edges === 'box') {
    // edge wear without bevels or attributes: the distance to the edges of the drawn geometry's bounding box (crates,
    // containers, slabs, walls: any box-like mesh), refreshed per draw from the geometry and the object's scale
    uniforms.msBoxLo = { value: new THREE.Vector3(-0.5, -0.5, -0.5) }; uniforms.msBoxHi = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
    uniforms.msBoxS = { value: new THREE.Vector4(1, 1, 1, +(o.edgeWidth ?? 0.03)) };
    const sc = new THREE.Vector3();
    h.attach = (m) => {
      const prev = m.onBeforeRender;
      m.onBeforeRender = function (r, s, c, geo, obj, grp) {
        if (prev) prev.call(this, r, s, c, geo, obj, grp);
        if (!geo.boundingBox) geo.computeBoundingBox();
        uniforms.msBoxLo.value.copy(geo.boundingBox.min); uniforms.msBoxHi.value.copy(geo.boundingBox.max);
        obj.getWorldScale(sc); uniforms.msBoxS.value.set(sc.x, sc.y, sc.z, +(o.edgeWidth ?? 0.03));
        this.uniformsNeedUpdate = true;
      };
    };
  }
  if (o.debug) {
    const out = { albedo: 'msAlb', rough: 'vec3(msR)', height: 'vec3(msH)', metal: 'vec3(msM)' }[o.debug];
    if (!out) throw new RangeError("surfaceHooks: debug must be 'albedo' | 'rough' | 'height' | 'metal'");
    h.output = `outgoingLight = ${out}; diffuseColor.a = 1.0;`;
  }
  return h;
}

// ---- the baker ------------------------------------------------------------------------------------------------------
const BAKE_VS = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const bakeFS1 = (kind) => `precision highp float; precision highp int;
uniform float msN; uniform float uTime; uniform vec3 cameraPosition;
${NOISE_GLSL}
${MS_COMMON}
vec3 mgWorldPos = vec3(0.0), mgWorldNormal = vec3(0.0, 1.0, 0.0);
${KIND_GLSL[kind]}
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main(){
  msT = msX.x; msSeed = msX.y; msFP = msT / msN; msLodA = 2.0;
  vec2 u = gl_FragCoord.xy / msN * msT;
  MsS s = ms_${kind}(u);
  o0 = vec4(max(s.a, 0.0), clamp(s.r, 0.02, 1.0));
  o1 = vec4(clamp(s.h, 0.0, 1.0), clamp(s.m, 0.0, 1.0), clamp(s.ao, 0.0, 1.0), 1.0);
}`;
const BAKE_FS2 = `precision highp float; precision highp int;
uniform sampler2D t0; uniform sampler2D t1; uniform float msN; uniform vec4 msX; uniform vec4 msY;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
float hAt(ivec2 p){ int N = int(msN); return texelFetch(t1, ivec2((p.x + N) % N, (p.y + N) % N), 0).r; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float texel = msX.x / msN;
  vec2 g = vec2(hAt(p + ivec2(1, 0)) - hAt(p - ivec2(1, 0)), hAt(p + ivec2(0, 1)) - hAt(p - ivec2(0, 1))) / (2.0 * texel) * msY.y;
  vec3 n = normalize(vec3(-g, 1.0));
  vec4 a = texelFetch(t0, p, 0), b = texelFetch(t1, p, 0);
  o0 = vec4(a.rgb * b.b, a.a);
  o1 = vec4(n.xy * 0.5 + 0.5, b.r, b.g);
}`;

const BAKERS = new WeakMap();
/** Render a surface's tile into a texture set: { c: albedo (sRGB, cavity folded in) + roughness (A), n: normal xy +
 *  height + metalness, size, ms (CPU-side time of the bake call; the GPU work is flushed), bytes }. */
export function bakeSurface(renderer, spec, { size = 0, anisotropy = 8 } = {}) {
  if (spec.live) throw new Error(`bakeSurface: ${spec.kind} is a live surface (per pixel only)`);
  if (!KIND_GLSL[spec.kind]) throw new Error(`bakeSurface: the kind "${spec.kind}" is not registered`);
  const N = size || spec.size || 1024;
  const t0 = performance.now();
  const rt1 = new THREE.WebGLRenderTarget(N, N, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const rt2 = new THREE.WebGLRenderTarget(N, N, { count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
  const aniso = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  rt2.textures.forEach((t, i) => {
    t.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = aniso;
    t.name = `surface-${spec.kind}-${i ? 'n' : 'c'}`;
  });
  const U = spec.uniforms;
  // the two passes' materials, kept per renderer and kind (a second bake of a kind compiles nothing)
  let per = BAKERS.get(renderer);
  if (!per) BAKERS.set(renderer, (per = { quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), kinds: {}, m2: null }));
  if (!per.kinds[spec.kind]) {
    const uni = { msN: { value: 0 }, uTime: { value: 0 }, cameraPosition: { value: new THREE.Vector3() } };
    for (const k of ['X', 'Y', 'W', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) uni['ms' + k] = { value: new THREE.Vector4() };
    per.kinds[spec.kind] = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: bakeFS1(spec.kind), uniforms: uni });
  }
  if (!per.m2) per.m2 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: BAKE_FS2,
    uniforms: { t0: { value: null }, t1: { value: null }, msN: { value: 0 }, msX: { value: new THREE.Vector4() }, msY: { value: new THREE.Vector4() } } });
  const m1 = per.kinds[spec.kind], m2 = per.m2, uni = m1.uniforms;
  uni.msN.value = N;
  for (const k of ['X', 'W', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) uni['ms' + k].value.fromArray(U[k]);
  uni.msY.value.set(0, spec.depth, 0, 0);
  m2.uniforms.t0.value = rt1.textures[0]; m2.uniforms.t1.value = rt1.textures[1]; m2.uniforms.msN.value = N;
  m2.uniforms.msX.value.copy(uni.msX.value); m2.uniforms.msY.value.copy(uni.msY.value);
  const quad = per.quad; quad.material = m1; quad.frustumCulled = false;
  const cam = per.cam;
  const prev = renderer.getRenderTarget(), prevXR = renderer.xr.enabled, prevAuto = renderer.autoClear;
  renderer.xr.enabled = false; renderer.autoClear = false;
  renderer.setRenderTarget(rt1); renderer.render(quad, cam);
  quad.material = m2; renderer.setRenderTarget(rt2); renderer.render(quad, cam);
  renderer.setRenderTarget(prev); renderer.xr.enabled = prevXR; renderer.autoClear = prevAuto;
  rt1.dispose();
  const ms = performance.now() - t0;
  return { c: rt2.textures[0], n: rt2.textures[1], target: rt2, size: N, ms, bytes: Math.round(N * N * 8 * 4 / 3) };
}

// ---- the decal atlas ------------------------------------------------------------------------------------------------
/** The registered weathering decal masks rendered once into an atlas (4 x 2 cells), for options.decals. */
export function bakeDecalAtlas(renderer, size = 1024) {
  if (!DECALS) throw new Error('bakeDecalAtlas: no decals registered (registerSurfaceDecals; @miragekit/assets/surfaces has them)');
  const rt = new THREE.WebGLRenderTarget(size, size / 2, { type: THREE.UnsignedByteType, depthBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false; rt.texture.name = 'surface-decals';
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: DECALS.fragment, uniforms: { msN: { value: size } } });
  m.fragmentShader = m.fragmentShader.replace('vec2 px = gl_FragCoord.xy / msN;', 'vec2 px = gl_FragCoord.xy / vec2(msN, msN * 0.5);');
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); renderer.setRenderTarget(prev);
  m.dispose(); quad.geometry.dispose();
  return rt;
}

// ---- the library bound to a world -----------------------------------------------------------------------------------
/**
 * createSurfaces(world, { mode = 'auto' | 'baked' | 'procedural', size, anisotropy, tier = 'high' | 'low' }) -> {
 *   (tier 'low': every set at half its kind's size, a quarter of the memory; 'auto': baked, except
 *   the kinds cheaper per pixel than their taps: tile, stainless, chrome, metal, carPaint, rubber, bamboo, carbonFibre)
 *   material(spec, options)  a ready MeshStandard / MeshPhysical material (options: see surfaceHooks, plus wet: true |
 *                            withWet options, mode, size, and three material parameters in `params`)
 *   hooks(spec, options)     the hooks (baked on demand), to combine yourself
 *   bake(spec, size?)        the texture set (cached per kind, numbers and size)
 *   stats()                  { baked, ms, bytes, materials }
 *   dispose()
 * }
 */
export function createSurfaces(world, { mode = 'auto', size = 0, anisotropy = 8, tier = 'high' } = {}) {
  const renderer = world.renderer, kit = world.mat;
  const cache = new Map();
  let atlas = null, bakeMs = 0, made = 0;
  // 'auto': bake the kinds whose recipe costs more than its texture taps; the cheap ones (a grid, a few lines) run per pixel
  const pathOf = (spec, m) => (spec.live ? 'procedural' : m === 'auto' ? (KINDS[spec.kind].cheap ? 'procedural' : 'baked') : m);
  // the set's size: an explicit one, else the kind's own (its detail needs it); tier 'low' halves it (a quarter of the
  // memory: phones), never under 256
  const sizeOf = (spec, sz) => sz || (tier === 'low' ? Math.max(256, (spec.size || 1024) >> 1) : spec.size || 1024);
  const bake = (spec, sz = size) => {
    const N = sizeOf(spec, sz), key = spec.bakeKey + ':' + N;
    if (!cache.has(key)) { const b = bakeSurface(renderer, spec, { size: N, anisotropy }); bakeMs += b.ms; cache.set(key, b); }
    return cache.get(key);
  };
  const hooks = (spec, o = {}) => {
    const m = pathOf(spec, o.mode || mode);
    const extra = {};
    if (m === 'baked') extra.baked = bake(spec, o.size || size);
    if (o.decals) extra.decalAtlas = (atlas ??= bakeDecalAtlas(renderer)).texture;
    let h = surfaceHooks(spec, { ...o, ...extra, mode: m });
    if (o.wet) h = withWet(h, { porosity: spec.porosity, height: 'msH', heightMid: 0.5, heightScale: Math.max(spec.depth, 0.004), ground: o.ground ?? 0, ...(o.wet === true ? {} : o.wet) });
    return h;
  };
  const material = (spec, o = {}) => {
    const h = hooks(spec, o);
    const base = { roughness: 1, metalness: 1, ...spec.material, ...(o.params || {}) };
    // the kind's own material parameters (glass: blending, or the transmission path); true: a physical material
    const K = KINDS[spec.kind], phys = K.prepare ? K.prepare(base, spec, o) : false;
    const m = spec.physical || phys ? kit.phys(base, h) : kit.std(base, h);
    m.name = `surface-${spec.kind}-${spec.variant}`;
    // footsteps (@miragekit/game reads userData.surface: 'stone' | 'gravel' | 'grass' | 'wood'); the spec beside it
    m.userData.surface = FOOTSTEP[KINDS[spec.kind].family] || 'stone';
    m.userData.surfaceKind = { kind: spec.kind, variant: spec.variant, mode: pathOf(spec, o.mode || mode) };
    made++;
    return m;
  };
  const stats = () => ({ baked: cache.size, ms: +bakeMs.toFixed(2), bytes: [...cache.values()].reduce((s, b) => s + b.bytes, 0) + (atlas ? atlas.width * atlas.height * 4 : 0), materials: made });
  const dispose = () => { for (const b of cache.values()) b.target.dispose(); cache.clear(); if (atlas) atlas.dispose(); atlas = null; };
  return { material, hooks, bake, stats, dispose, SURFACES: specMakers(), KINDS: surfaceKinds() };
}

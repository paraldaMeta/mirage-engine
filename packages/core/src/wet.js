// Mirage original code.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Optional wet surfaces, puddles and rain ripples. Nothing here is compiled into a material unless it opts in with
// withWet(hooks, options); worlds that do not ask for it build exactly the shaders they did before.
//
//   import { withWet, setWetness, setRain } from '@miragekit/core';
//   const paving = world.mat.std({ roughness: 0.8 }, withWet(myHooks, { porosity: 0.5, height: 'mgS.h' }));
//   world.mat.patch(m, withWet(m.userData.hooks, { porosity: 0.85, puddles: 0 }));  // an existing material
//   setWetness(0.8); setRain(1);           // page-global
//
// Off: a wet material compiles its wet code only while the wetness is above 0 (the define MG_WET; setWetness
// recompiles the opted-in materials when it crosses 0, like setAmbientVolumes), so at setWetness(0) its program is
// the dry one and the image is bit-identical. Changes between levels above 0 recompile nothing.
//
// One continuous ramp per fragment, s = 0 dry .. 1 damp .. 2 soaked .. 3 standing water:
//   damp      darker (porous materials more: `porosity`), a little more saturated, roughness 0.42..0.56 (never
//             below the light2 reflection threshold: a sheen, not a mirror)
//   soaked    a water film: roughness 0.1..0.2 in the lighting, the micro relief partly filled (normal flattened)
//   standing  a level water surface (roughness ~0.05, normal = up); the wet bed shows through at a shallow rim, the
//             deeper water is murkier (never black). Rain rings on it while setRain(> 0).
// Where: up-facing surfaces soak from the low spots up and pool where they are level (a world-space height field:
// pools at ~2 m, shorelines at ~40 / 15 / 5 cm, plus an optional height expression of the material, e.g. a photo
// set's mgS.h so the joints fill first); vertical surfaces get streaky run-off; undersides stay dry; a damp band
// rises from the ground (`ground`: a height, an Object3D or a THREE.Plane; `band` metres).
// The material can say where: `wear` (a GLSL float 0..1: ruts, joints, round drains) sinks the bed by `wearDepth` so
// the water gathers there first; `shelter` (0..1: under an awning, indoors) keeps it dry and matte; `rim` draws a thin
// darker damp band round each puddle and eases the water's edge (a meniscus, not one cut level).
// Reflections: under light2 only standing water is flagged for screen-space reflection; a soaked film keeps its
// low roughness for the image-based light and the sun but is floored at 0.42 for the reflection flag.
// Stability: every pattern is in world space (metres); octaves finer than the pixel footprint fade out, the
// shorelines are antialiased by the height's screen derivative, the ripples fade into a rougher surface with
// distance, and the specular AA (mgSpecAA, strength `specAA`) widens the lobe by the screen-space variance of the
// normal once the wet layer and the ripples have bent it (patch()'s own AA steps aside while wet). Ripples: rings
// from cell-hashed drops in two cell sizes, as many as the rain is heavy, in world space, on uTime only (stills fix it).
// Applies to Standard / Physical materials (it edits roughnessFactor and metalnessFactor's hook).
// ponytail: the two uniforms are shared by every world on the page, like the relief's.
// ---------------------------------------------------------------------------

/** The wetness's page-global uniforms (kept by reference in every material that opts in). */
export const WET = {
  uWet: { value: 0 },     // 0 dry (wet code not compiled) .. 1 puddles at their fullest
  uRain: { value: 0 },    // 0 no rain .. 1 heavy: ripples on standing water (and addRain's streaks)
};
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
// changes since load: worlds watch these in tick() (a wetness change refreshes the environment capture, any change
// asks for a redraw). Set the levels through setWetness / setRain: writing WET.*.value directly skips both.
const VERSION = { wet: 0, rain: 0 };
/** { wet, rain }: how many times the wetness / rain level changed (createWorldRenderer's tick() watches them). */
export const wetVersion = () => ({ ...VERSION });
// the opted-in materials (weakly held): MG_WET follows the wetness
const wetMats = new Set();
function syncWet(m) {
  const on = WET.uWet.value > 0, has = !!m.defines && 'MG_WET' in m.defines;
  if (on === has) return;
  if (on) m.defines = { ...(m.defines || {}), MG_WET: '' };
  else { const { MG_WET, ...rest } = m.defines; m.defines = rest; }
  m.needsUpdate = true;
}
/** 0 = dry (off: the wet code is not compiled), 1 = soaked with full puddles. Crossing 0 recompiles the wet materials.
 *  Returns the clamped level. */
export function setWetness(level = 1) {
  const v = clamp01(level);
  if (v !== WET.uWet.value) VERSION.wet++;
  WET.uWet.value = v;
  pruneSync(true);
  return v;
}
function pruneSync(sync) { for (const r of wetMats) { const m = r.deref(); if (!m) wetMats.delete(r); else if (sync) syncWet(m); } }
/** 0 = no rain, 1 = heavy rain (ripple density; the rain kit's streak density). Returns the clamped level. */
export function setRain(intensity = 1) {
  const v = clamp01(intensity);
  if (v !== WET.uRain.value) VERSION.rain++;
  return (WET.uRain.value = v);
}

// all of it inside MG_WET (defined only while wet): with it undefined the preprocessor leaves the dry program.
// Internal to withWet (which sets MG_WET through setWetness): pasted on its own it compiles to nothing.
export const WET_GLSL = /* glsl */ `
#ifdef MG_WET
#ifndef MG_WET_GLSL
#define MG_WET_GLSL
uniform float uWet;
uniform float uRain;
uniform vec4 mgWetP;            // porosity, ground y (m), damp band height (m), puddles
uniform vec4 mgWetQ;            // ripples (strength), specular AA (strength), shelter (0..1), puddle rim (0..1)
// the normal of the face being seen: mgWorldNormal is the geometry's, never flipped for back faces
vec3 mgWetFaceN(vec3 n){
#if defined( DOUBLE_SIDED )
  return gl_FrontFacing ? n : -n;
#elif defined( FLIP_SIDED )
  return -n;
#else
  return n;
#endif
}
float mgWetS = 0.0;             // 0 dry .. 1 damp .. 2 soaked .. 3 standing water
float mgWetPond = 0.0;          // standing water 0..1
float mgWetRip = 0.0;           // how much of the rain rings the pixel can hold (footprint fade)
float mgWetR0 = 1.0;            // the dry roughness (for the reflection flag)
// the bed's height (m) about 0: pools at ~2 m, shorelines at ~40 / 15 / 5 cm; octaves finer than the pixel footprint
// fp (m) fade out, so far shores do not sparkle
float mgWetH(vec2 x, float fp){
  float h = 0.010 * mgGrad2(x * 0.45 + 3.1);
  h += 0.006 * mgGrad2(x * 2.5 + 7.7) * (1.0 - smoothstep(0.12, 0.3, fp));
  h += 0.0035 * mgGrad2(x * 6.7 + 1.3) * (1.0 - smoothstep(0.04, 0.1, fp));
  h += 0.0015 * mgGrad2(x * 20.0 + 5.9) * (1.0 - smoothstep(0.012, 0.03, fp));
  return h;
}
// p, n: world position and normal; hb: the material's height bias (m, the wear's ruts included); nk: the bed noise's
// share (1; 0.5 with a wear mask, which then says where the water goes); shel: where the rain
// does not reach (0..1: the material's shelter with the constant mgWetQ.z); edits the albedo and roughness (call it
// in uniform control flow: it takes screen derivatives)
void mgWetApply(vec3 p, vec3 n, float hb, float nk, float shel, inout vec3 albedo, inout float rough, float metal){
  float w = uWet;
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  float H = mgWetH(p.xz, fp) * nk + hb;
  float e = max(fwidth(H), 3e-4);
  float up = n.y;
  float top = smoothstep(0.55, 0.9, up), level = smoothstep(0.93, 0.985, up), under = smoothstep(0.15, 0.6, -up);
  // tops: damp everywhere first, then soaked from the low spots up, then water standing in the level ones
  float damp = smoothstep(0.0, 0.25, w);
  float Ls = mix(-0.026, 0.026, smoothstep(0.25, 0.95, w));
  float Lp = mgWetP.w > 0.0 ? mix(-0.012, 0.002 + 0.006 * (mgWetP.w - 1.0), sqrt(clamp((w - 0.45) / 0.55, 0.0, 1.0))) : -1.0;
  float soak = smoothstep(-0.004, 0.004, Ls - H) * smoothstep(0.15, 0.4, w);
  // pools a pixel cannot resolve (far, grazing) thin out to a soaked sheen instead of a shimmering lake
  // the water's edge: a meniscus eased over ~2 mm of bed height with the rim (mgWetQ.w), not cut at one level
  float men = 0.002 * mgWetQ.w, edge = smoothstep(-e - men, e + men, Lp - H);
  float pond = min(edge * level, soak) * (1.0 - 0.7 * smoothstep(0.03, 0.15, fp));
  float sTop = damp + soak + pond;
  // walls: run-off in thin vertical streaks (along the wall's own horizontal direction, stretched down it), denser
  // in some stretches of wall than in others
  vec2 T = normalize(vec2(-n.z, n.x) + vec2(1e-5, 0.0));
  float u = dot(p.xz, T);
  float st = mgFbm2(vec2(u * 5.0, p.y * 0.3) + 4.1, 3), big = 0.5 + 0.5 * mgGrad2(vec2(u * 0.4, p.y * 0.3) + 9.3);
  float streak = smoothstep(0.05, 0.45, st + 0.25 * (big - 0.5));
  float sWall = damp * (0.45 + 0.2 * big + 0.35 * streak) + smoothstep(0.45, 1.0, w) * streak * 0.6;
  float s = mix(sWall, sTop, top) * (1.0 - under);
  // a damp band where the ground wicks up and splashes, its edge ragged
  float band = 1.0 - smoothstep(0.0, mgWetP.z, p.y - mgWetP.y - 0.25 * mgWetP.z * st);
  s = max(s, band * smoothstep(0.0, 0.35, w) * (1.0 + 0.3 * band));
  // a puddle's rim (mgWetQ.w): the bed a few mm above the water line soaked and darker, a thin band round the water
  float rim = mgWetQ.w * level * smoothstep(-0.0045, -0.0008, Lp - H) * (1.0 - edge) * smoothstep(0.45, 0.8, w);
  s = mix(s, max(s, 2.0), rim);
  // sheltered (under cover, indoors): dry and matte
  s *= 1.0 - shel;
  float dK = clamp(s, 0.0, 1.0), sK = clamp(s - 1.0, 0.0, 1.0), pK = clamp(s - 2.0, 0.0, 1.0);
  // porous: water fills the pores, less light scatters back out (darker, a little more saturated); metals only
  // get smoother
  float por = mgWetP.x * (1.0 - metal);
  vec3 c = albedo * (1.0 - (0.08 + 0.42 * por) * dK - 0.12 * por * sK);
  c *= 1.0 - (0.1 + 0.15 * por) * rim * (1.0 - shel);
  c = max(mix(vec3(mgLuma(c)), c, 1.0 + 0.2 * por * dK), 0.0);
  // standing water: the bed at a shallow rim, murkier with depth, never a black hole
  float depth = max(Lp - H, 0.0);
  c *= 1.0 - 0.18 * pK;
  c = mix(c, c * 0.45 + vec3(0.008, 0.009, 0.008), pK * (1.0 - exp(-depth / 0.006)));
  albedo = c;
  // ripples are ~2 cm waves: gone where a pixel covers more than ~1 cm, rain then reads as a rougher pool
  mgWetRip = 1.0 - smoothstep(0.004, 0.012, fp);
  float r0 = rough;
  float rD = min(r0, clamp(r0 * 0.62, 0.42, 0.56)), rS = min(rD, 0.1 + 0.1 * r0);
  rough = mix(mix(mix(r0, rD, dK), rS, sK), 0.05 + 0.06 * uRain * min(mgWetQ.x, 1.0) * (1.0 - mgWetRip), pK);
  mgWetS = s; mgWetPond = pK; mgWetR0 = r0;
}
// one sparse layer of rain rings: cells of C metres, each with at most one drop per period P (s), landing at a new
// spot every cycle (a hash of the cell and the cycle). Drops sit in the middle half of their cell and a ring reaches
// 0.4 C, so the 2 x 2 nearest cells hold every ring that can touch x. Returns the water's slope (dh/dx, dh/dz).
vec2 mgWetRings(vec2 x, float C, float P, float prob, float seed){
  vec2 q = x / C, ci = floor(q), cs = step(0.5, q - ci) * 2.0 - 1.0, g = vec2(0.0);
  const float K = 314.159;                 // 2 cm waves
  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
    vec2 c = ci + vec2(float(i), float(j)) * cs;
    float t = uTime / P + mgHash3(vec3(c, seed)).x;
    float cyc = floor(t), age = t - cyc;
    vec3 r = mgHash3(vec3(c, seed * 8192.0 + mod(cyc, 8192.0) + 64.0));
    if (r.z >= prob) continue;
    vec2 d = x - (c + 0.25 + 0.5 * r.xy) * C;
    float dist = length(d), u = dist - age * 0.4 * C, wd = 0.006 + 0.012 * age;
    float a = (1.0 - age) * (1.0 - age) * 0.3 / K;          // slope at most ~0.3, dying as the ring spreads
    float dh = a * exp(-u * u / (wd * wd)) * (K * cos(K * u) - 2.0 * u / (wd * wd) * sin(K * u));
    g += dh * d / max(dist, 1e-4);
  }
  return g;
}
vec2 mgWetRipples(vec2 x){
  float pr = 0.75 * clamp(uRain, 0.0, 1.0);
  return mgWetRings(x, 0.3, 0.6, pr, 1.0) + mgWetRings(x + vec2(0.13, 0.37), 0.21, 0.45, pr, 2.0);
}
// the normal (view space): a soaked film fills the micro relief, standing water is level, rain rings on it
void mgWetNormal(inout vec3 nV, vec3 nFlat, vec3 p){
  nV = normalize(mix(nV, nFlat, 0.6 * clamp(mgWetS - 1.0, 0.0, 1.0)));
  if (mgWetPond <= 0.0) return;
  vec3 n = normalize(mix(nV, normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)), mgWetPond));
  if (uRain > 0.0 && mgWetRip > 0.0 && mgWetQ.x > 0.0) {
    // their strength follows the rain (half of it at a drizzle) and the material's ripples option
    vec2 g = mgWetRipples(p.xz) * mgWetRip * mgWetPond * (mgWetQ.x * (0.5 + 0.5 * uRain));
    n = normalize(n - mat3(viewMatrix) * vec3(g.x, 0.0, g.y));
  }
  nV = n;
}
#endif
#endif
`;

// The reflection flag (light2): a soaked film is floored at 0.42 (no screen-space mirror); standing water is not.
// Never above the dry roughness, so a surface that was smooth when dry keeps its flag.
const WET_SSR = '#ifdef STANDARD\nif (uWet > 0.0) material.roughness = max(material.roughness, min(mgWetR0, 0.42 * (1.0 - mgWetPond)));\n#endif';
const onlyWet = (glsl) => `#ifdef MG_WET\n${glsl}\n#endif`;

const FRAG_KEYS = ['fragmentDecl', 'albedo', 'roughness', 'metalness', 'normal', 'emissive', 'lighting', 'output'];
const glf = (v) => { const n = +(+v).toFixed(5); return Number.isInteger(n) ? n.toFixed(1) : String(n); };
function groundY(g) {
  if (typeof g === 'number') return g;
  if (g && g.isPlane) return Math.abs(g.normal.y) > 1e-6 ? -g.constant / g.normal.y : 0;
  if (g && g.isObject3D) { g.updateWorldMatrix(true, false); return g.matrixWorld.elements[13]; }
  throw new TypeError('withWet: ground must be a number, an Object3D or a THREE.Plane');
}

const isUniform = (v) => !!v && typeof v === 'object' && 'value' in v;

/** Wetness on a hooks object (Standard / Physical materials). options: porosity 0..1 (how much darker it gets wet;
 *  0.6), ground (height, Object3D or Plane: the damp band's foot; 0), band (m; 0.3), puddles (0 none, 1 default,
 *  more: fuller), height (a GLSL float 0..1 of the material, e.g. 'mgS.h'; low parts fill first), heightMid (its
 *  mean, e.g. the set's hMean; 0.5), heightScale (m of bed height per unit of it; 0.012), wear (a GLSL float 0..1:
 *  worn ruts, joints, round drains; the water gathers there: the bed's noise is halved and a rut sits up to wearDepth
 *  m, 0.016, below the unworn bed), shelter (0..1 where the rain
 *  does not reach: a number, a GLSL float or a { value } uniform; dry and matte there), rim (0..1: the darker damp
 *  band round a puddle and its eased edge; 1 when wear or shelter is given, else 0), ripples (rain rings' strength:
 *  0 off, 1), specAA (the specular AA's strength while wet: 0 / false off, 1). The per-material numbers are two
 *  uniforms (mgWetP, mgWetQ): materials that differ only in them share a program. */
export function withWet(hIn = {}, { porosity = 0.6, ground = 0, band = 0.3, puddles = 1, height = null, heightMid = 0.5, heightScale = 0.012,
  wear = null, wearDepth = 0.016, shelter = null, rim = null, ripples = 1, specAA: aaK = null } = {}) {
  // already wet (re-applied to change the options): wrap the dry hooks again instead of stacking a second wet layer
  const h = hIn.__wetBase || hIn;
  const P = new THREE.Vector4(clamp01(porosity), groundY(ground), Math.max(0.01, +band || 0), Math.max(0, +puddles || 0));
  const shelterK = typeof shelter === 'number' ? clamp01(shelter) : 0;
  // specAA: 1 by default, 0 for hooks that opted out of the AA (hooks.specAA === false), as before
  const aa = aaK == null ? (h.specAA === false ? 0 : 1) : aaK === true ? 1 : aaK === false ? 0 : Math.max(0, +aaK);
  const Q = new THREE.Vector4(Math.max(0, +ripples || 0), aa, shelterK, clamp01(rim ?? (wear || shelter != null ? 1 : 0)));
  if (![P.x, P.y, P.z, P.w, Q.y, heightScale, heightMid, wearDepth].every(Number.isFinite)) throw new RangeError('withWet: options must be finite numbers');
  if (shelter != null && !['number', 'string'].includes(typeof shelter) && !isUniform(shelter)) throw new TypeError('withWet: shelter must be a number, a GLSL float or a { value } uniform');
  let hb = height ? `${glf(heightScale)} * ((${height}) - ${glf(heightMid)})` : '0.0';
  // with a wear mask the water goes where it says: the bed's own noise is halved (mgWetApply's nk), the unworn bed sits
  // 0.35 wearDepth higher and a fully worn rut 0.65 wearDepth lower
  if (wear) hb += ` + ${glf(wearDepth)} * (0.35 - clamp((${wear}), 0.0, 1.0))`;
  const shel = shelter == null ? '0.0' : typeof shelter === 'number' ? 'mgWetQ.z' : `max(mgWetQ.z, clamp((${isUniform(shelter) ? 'mgWetShelter' : shelter}), 0.0, 1.0))`;
  const add = (a, b) => (a ? a + '\n' : '') + onlyWet(b);
  // patch()'s specular AA as the dry material had it (it follows a mention of roughnessFactor in the hooks, which the
  // wet code adds) while dry; while wet the wet layer applies its own after its normal (strength mgWetQ.y), once
  const had = h.specAA ?? FRAG_KEYS.some((k) => typeof h[k] === 'string' && h[k].includes('roughnessFactor'));
  const dryAA = had === false || had === 0 ? { specAA: false } : { specAA: had, specAAIf: '!defined(MG_WET)' };
  const out = {
    ...h,
    ...dryAA,
    fragmentDecl: WET_GLSL + (isUniform(shelter) ? onlyWet('uniform float mgWetShelter;') + '\n' : '') + (h.fragmentDecl || ''),
    metalness: add(h.metalness, `if (uWet > 0.0) mgWetApply(mgWorldPos, mgWetFaceN(normalize(mgWorldNormal)), ${hb}, ${wear ? '0.5' : '1.0'}, ${shel}, diffuseColor.rgb, roughnessFactor, metalnessFactor);`),
    normal: add(h.normal, 'if (mgWetS > 1.0) mgWetNormal(normal, nonPerturbedNormal, mgWorldPos);' + (aa > 0 ? '\nroughnessFactor = mgSpecAA(roughnessFactor, normal, mgWetQ.y * (1.0 + 3.0 * uRain * min(mgWetQ.x, 1.0) * mgWetPond));' : '')),
    output: add(h.output, WET_SSR),
    uniforms: { ...(h.uniforms || {}), ...WET, mgWetP: { value: P }, mgWetQ: { value: Q }, ...(isUniform(shelter) ? { mgWetShelter: shelter } : {}) },
    // patch() hands over the material: MG_WET follows setWetness from now on
    attach: (m) => { pruneSync(false); wetMats.add(new WeakRef(m)); syncWet(m); if (h.attach) h.attach(m); },
  };
  Object.defineProperty(out, '__wetBase', { value: h, enumerable: false });   // not in JSON: the program key ignores it
  Object.defineProperty(out, '__wetOptions', { value: { porosity, ground, band, puddles, height, heightMid, heightScale, wear, wearDepth, shelter, rim, ripples, specAA: aaK }, enumerable: false });
  return out;
}

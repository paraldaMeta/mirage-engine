// Mirage code adapted from the author's own earlier texture layer (no Golden Temple code in it); GLSL rewritten.
import * as THREE from 'three';
import { RELIEF_GLSL, RELIEF, RELIEF_LIGHT, renderHeight, renderShade } from './relief.js';

// ---------------------------------------------------------------------------
// Optional real-material layer: photo-scanned PBR sets (CC0) sampled in WORLD space from patch() hooks, so
// procedural geometry needs no UVs. The project supplies the manifest and the files (packages/tools/tex/pack.py
// makes both); the engine ships no textures.
//
//   const tex = createTextures(world, { manifest, url: (file) => urls[file] });
//   const wall = tex.material('plaster', { mapping: 'wall', tint: [0.8, 0.7, 0.56], detail: 1 });
//   const mixed = world.mat.std({ roughness: 0.9 }, tex.hooks(['plaster', 'ashlar'], { fragmentDecl, albedo, normal }));
//   await tex.ready();                               // before world.prepare(): the environment sees them
//
// A set is two textures: <name>_c (albedo, sRGB, AO folded in) and <name>_n (RG = tangent normal, OpenGL;
// B = height 0..1). Manifest entry: { tile (m per repeat), mean (linear albedo), hMean, rough, roughSlope, files }.
//
// GLSL (in scope after hooks()): MG_TEX_<name> expands to the set's arguments (glslName(name) for names with - or .).
//   MgTex mgTexTri(MG_TEX_x, vec3 p, vec3 wn, float tile, float k)     triplanar, any shape
//   MgTex mgTexWall(MG_TEX_x, vec3 p, vec3 wn, float tile, float k)    one projection along a vertical wall's
//                                                                      own normal (+ ground projection on tops)
//   MgTex mgTexGround(MG_TEX_x, vec3 p, vec3 wn, float tile, float k)  planar XZ: floors, terrain
//      p, wn: world position and normal; tile <= 0: the manifest's tile; k: normal strength
//   MgTex { vec3 albedo; vec3 n; float h; float r; vec3 mean; }  n = perturbed world normal, r = roughness offset
//   vec3 mgTexTint(MgTex s, vec3 base, float k)    keep your palette: base * (albedo / mean)^k
//   vec3 mgTexNormal(vec3 normalView, MgTex s, vec3 wn)    apply the detail normal in the `normal` hook
//   float mgTexBlend(float m, float hA, float hB, float soft)   height-aware weight of B over A for a mask m
//   mgSpecAA(roughness, normalView) is applied by patch() to every Standard / Physical material.
// Every tap uses textureGrad with the projection's own derivatives (no mip seams at the repetition breaker or
// inside branches) and the textures are anisotropic.
//
// Optional close-range relief (relief.js): tex.material(name, { relief: depthMetres, render: undulationMetres }),
// or tex.hooks(names, h, { relief: true }) and in your GLSL (uniform control flow):
//   MgTex mgTexTriRelief | mgTexWallRelief | mgTexGroundRelief(MG_TEX_x, p, wn, tile, k, depth)
//      = the mapping above seen through a relief `depth` metres deep: one parallax step on the set's height
//        (sampled again at the shifted point with the UNSHIFTED gradients, so TAA stays stable) and the relief's
//        own shadow toward the key light (mgRlSh; the lighting hook RELIEF_LIGHT applies it), both faded out by
//        mgRlFade (8 m; off in orthographic views and with setRelief(0)). Materials that do not opt in compile
//        exactly as before.
// ---------------------------------------------------------------------------

export const TEX_GLSL = /* glsl */ `
#ifndef MG_TEX
#define MG_TEX
struct MgTex { vec3 albedo; vec3 n; float h; float r; vec3 mean; };
// one planar tap that hides the repeat: a slow value noise picks one of 8 random offsets per patch, and
// neighbouring patches cross-fade, the seam steered by the two heights so it follows the material's forms
void mgTexTap(sampler2D C, sampler2D N, vec2 uv, vec2 gx, vec2 gy, out vec3 c, out vec3 nh){
  float v = mgValue2(uv * 0.37 + 1.3) * 8.0, i = floor(v), f = fract(v);
  vec2 oa = mgHash3(vec3(i, 7.0, 3.0)).xy * 17.0, ob = mgHash3(vec3(i + 1.0, 7.0, 3.0)).xy * 17.0;
  vec3 na = textureGrad(N, uv + oa, gx, gy).rgb, nb = textureGrad(N, uv + ob, gx, gy).rgb;
  float w = smoothstep(0.3, 0.7, f + 0.4 * (nb.b - na.b));
  c = mix(textureGrad(C, uv + oa, gx, gy).rgb, textureGrad(C, uv + ob, gx, gy).rgb, w);
  nh = mix(na, nb, w);
}
// accumulate one projection with weight w; T, B = world directions of the image's u and v
void mgTexAdd(sampler2D C, sampler2D N, vec2 uv, vec2 gx, vec2 gy, vec3 T, vec3 B, vec3 wn, float w, float k,
              inout vec3 c, inout vec3 nW, inout float h){
  vec3 cc, nh; mgTexTap(C, N, uv, gx, gy, cc, nh);
  vec2 t = (nh.rg * 2.0 - 1.0) * k;
  c += cc * w; h += nh.b * w;
  nW += (T * t.x + B * t.y + wn * sqrt(max(1.0 - dot(t, t), 0.0))) * w;
}
MgTex mgTexEnd(vec3 c, vec3 nW, float h, vec4 A, vec4 B){
  return MgTex(c, normalize(nW), h, B.z * (h - A.w), A.rgb);
}
MgTex mgTexGround(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k){
  vec2 uv = p.xz / (tile > 0.0 ? tile : B.x), gx = dFdx(uv), gy = dFdy(uv);
  vec3 c = vec3(0.0), nW = vec3(0.0); float h = 0.0;
  mgTexAdd(C, N, uv, gx, gy, vec3(1, 0, 0), vec3(0, 0, 1), wn, 1.0, k, c, nW, h);
  return mgTexEnd(c, nW, h, A, B);
}
MgTex mgTexWall(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k){
  float s = tile > 0.0 ? tile : B.x;
  vec3 T = vec3(-wn.z, 0.0, wn.x); T /= max(length(T), 1e-4);
  vec2 uw = vec2(dot(p, T), p.y) / s, ug = p.xz / s;
  vec2 gxw = dFdx(uw), gyw = dFdy(uw), gxg = dFdx(ug), gyg = dFdy(ug);
  float wy = smoothstep(0.6, 0.8, abs(wn.y));
  vec3 c = vec3(0.0), nW = vec3(0.0); float h = 0.0;
  if (wy < 1.0) mgTexAdd(C, N, uw, gxw, gyw, T, vec3(0, 1, 0), wn, 1.0 - wy, k, c, nW, h);
  if (wy > 0.0) mgTexAdd(C, N, ug, gxg, gyg, vec3(1, 0, 0), vec3(0, 0, 1), wn, wy, k, c, nW, h);
  return mgTexEnd(c, nW, h, A, B);
}
MgTex mgTexTri(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k){
  vec3 q = p / (tile > 0.0 ? tile : B.x), dx = dFdx(q), dy = dFdy(q);
  vec3 w = pow(abs(wn), vec3(6.0)); w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0); w /= w.x + w.y + w.z;      // drop slivers: at most two taps on most pixels
  vec3 c = vec3(0.0), nW = vec3(0.0); float h = 0.0;
  if (w.x > 0.0) mgTexAdd(C, N, q.zy, dx.zy, dy.zy, vec3(0, 0, 1), vec3(0, 1, 0), wn, w.x, k, c, nW, h);
  if (w.y > 0.0) mgTexAdd(C, N, q.xz, dx.xz, dy.xz, vec3(1, 0, 0), vec3(0, 0, 1), wn, w.y, k, c, nW, h);
  if (w.z > 0.0) mgTexAdd(C, N, q.xy, dx.xy, dy.xy, vec3(1, 0, 0), vec3(0, 1, 0), wn, w.z, k, c, nW, h);
  return mgTexEnd(c, nW, h, A, B);
}
vec3 mgTexTint(MgTex s, vec3 base, float k){ return base * pow(max(s.albedo / max(s.mean, vec3(1e-4)), vec3(0.0)), vec3(k)); }
vec3 mgTexNormal(vec3 nV, MgTex s, vec3 wn){ return normalize(nV + (viewMatrix * vec4(s.n - wn, 0.0)).xyz); }
float mgTexBlend(float m, float hA, float hB, float soft){
  float a = hA + 1.0 - m, b = hB + m, t = max(a, b) - soft;
  float wa = max(a - t, 0.0), wb = max(b - t, 0.0);
  return wb / max(wa + wb, 1e-5);
}
#endif
`;

// The relief taps (compiled in only by the relief opt-ins): the same projections as mgTexTri / Wall / Ground, read at
// a shifted point with the uv gradients of the UNSHIFTED surface (dFdx / dFdy of its projected uv, taken in uniform
// control flow), so the shifted samples keep their mip level and no derivative is taken inside a
// branch. The repetition breaker's patch choice is made once, at the unshifted point, and shared by the three reads
// (probe, sample, light probe) of one fragment.
export const TEX_RELIEF_GLSL = /* glsl */ `
#ifndef MG_TEX_RELIEF
#define MG_TEX_RELIEF
vec3 mgTexWallT(vec3 wn){ vec3 T = vec3(-wn.z, 0.0, wn.x); return T / max(length(T), 1e-4); }
// map 0 tri, 1 wall, 2 ground: up to three planar uv sets; linear in p for a given normal, so the same call on dFdx(p)
// gives the uv gradients
void mgTexProj(int map, vec3 p, vec3 wn, float s, out vec2 u0, out vec2 u1, out vec2 u2){
  vec3 q = p / s;
  if (map == 2) { u0 = q.xz; u1 = u0; u2 = u0; }
  else if (map == 1) { u0 = vec2(dot(q, mgTexWallT(wn)), q.y); u1 = q.xz; u2 = u1; }
  else { u0 = q.zy; u1 = q.xz; u2 = q.xy; }
}
vec3 mgTexProjW(int map, vec3 wn){
  if (map == 2) return vec3(1.0, 0.0, 0.0);
  if (map == 1) { float wy = smoothstep(0.6, 0.8, abs(wn.y)); return vec3(1.0 - wy, wy, 0.0); }
  vec3 w = pow(abs(wn), vec3(6.0)); w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0); return w / (w.x + w.y + w.z);
}
// one projection with its patch value v given (mgTexTap's breaker, taken elsewhere); full = false: the height only
void mgTexAddV(bool full, sampler2D C, sampler2D N, float v, vec2 uv, vec2 gx, vec2 gy, vec3 T, vec3 B, vec3 wn, float w, float k,
               inout vec3 c, inout vec3 nW, inout float h){
  float i = floor(v), f = fract(v);
  vec2 oa = mgHash3(vec3(i, 7.0, 3.0)).xy * 17.0, ob = mgHash3(vec3(i + 1.0, 7.0, 3.0)).xy * 17.0;
  vec3 na = textureGrad(N, uv + oa, gx, gy).rgb, nb = textureGrad(N, uv + ob, gx, gy).rgb;
  float m = smoothstep(0.3, 0.7, f + 0.4 * (nb.b - na.b));
  vec3 nh = mix(na, nb, m);
  h += nh.b * w;
  if (full) {
    vec2 t = (nh.rg * 2.0 - 1.0) * k;
    c += mix(textureGrad(C, uv + oa, gx, gy).rgb, textureGrad(C, uv + ob, gx, gy).rgb, m) * w;
    nW += (T * t.x + B * t.y + wn * sqrt(max(1.0 - dot(t, t), 0.0))) * w;
  }
}
MgTex mgTexAt(int map, bool full, sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec2 x0, vec2 x1, vec2 x2, vec2 y0, vec2 y1, vec2 y2, vec3 wn, float s, float k, vec3 w, vec3 bv){
  vec2 u0, u1, u2;
  mgTexProj(map, p, wn, s, u0, u1, u2);
  vec3 T0 = map == 2 ? vec3(1, 0, 0) : map == 1 ? mgTexWallT(wn) : vec3(0, 0, 1), B0 = map == 2 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  vec3 c = vec3(0.0), nW = vec3(0.0); float h = 0.0;
  if (w.x > 0.0) mgTexAddV(full, C, N, bv.x, u0, x0, y0, T0, B0, wn, w.x, k, c, nW, h);
  if (w.y > 0.0) mgTexAddV(full, C, N, bv.y, u1, x1, y1, vec3(1, 0, 0), vec3(0, 0, 1), wn, w.y, k, c, nW, h);
  if (w.z > 0.0) mgTexAddV(full, C, N, bv.z, u2, x2, y2, vec3(1, 0, 0), vec3(0, 1, 0), wn, w.z, k, c, nW, h);
  if (!full) return MgTex(vec3(0.0), wn, h, 0.0, A.rgb);
  return mgTexEnd(c, nW, h, A, B);
}
// one parallax step on the set's own height, then the relief's shadow toward the key light (into mgRlSh)
MgTex mgTexRelief(int map, sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k, float depth){
  float s = tile > 0.0 ? tile : B.x;
  vec3 w = mgTexProjW(map, wn);
  vec2 u0, u1, u2; mgTexProj(map, p, wn, s, u0, u1, u2);
  // the uv gradients of the unshifted surface, taken here in uniform flow (they include a turning tangent: smooth
  // normals on rounded edges)
  vec2 x0 = dFdx(u0), x1 = dFdx(u1), x2 = dFdx(u2), y0 = dFdy(u0), y1 = dFdy(u1), y2 = dFdy(u2);
  vec3 fn = gl_FrontFacing ? wn : -wn;   // the side seen (DoubleSide): the relief is cut into it
  vec3 bv = vec3(w.x > 0.0 ? mgValue2(u0 * 0.37 + 1.3) * 8.0 : 0.0, w.y > 0.0 ? mgValue2(u1 * 0.37 + 1.3) * 8.0 : 0.0,
                 w.z > 0.0 ? mgValue2(u2 * 0.37 + 1.3) * 8.0 : 0.0);
  float fade = mgRlFade(p), D = depth * fade;
  vec3 q = p;
  if (D > 0.0) q += mgRlShift(p, fn, mgTexAt(map, false, C, N, A, B, p, x0, x1, x2, y0, y1, y2, wn, s, k, w, bv).h, D);
  MgTex t = mgTexAt(map, true, C, N, A, B, q, x0, x1, x2, y0, y1, y2, wn, s, k, w, bv);
  float kw = mgRlKeyW();
  if (D > 0.0 && kw > 0.0 && dot(uKeyDir, fn) > 0.0) {
    float hL = mgTexAt(map, false, C, N, A, B, mgRlSunProbe(q, fn, D, 0.4), x0, x1, x2, y0, y1, y2, wn, s, k, w, bv).h;
    mgRlSh = min(mgRlSh, mix(1.0, mgRlSelfShadow(fn, t.h, hL, 0.4, 0.2), fade * kw));
  }
  return t;
}
MgTex mgTexTriRelief(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k, float depth){ return mgTexRelief(0, C, N, A, B, p, wn, tile, k, depth); }
MgTex mgTexWallRelief(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k, float depth){ return mgTexRelief(1, C, N, A, B, p, wn, tile, k, depth); }
MgTex mgTexGroundRelief(sampler2D C, sampler2D N, vec4 A, vec4 B, vec3 p, vec3 wn, float tile, float k, float depth){ return mgTexRelief(2, C, N, A, B, p, wn, tile, k, depth); }
#endif
`;

// a GLSL float literal (never an int: 0 for a tiny relief would not compile)
const f = (v) => { const n = +(+v).toFixed(5); return Number.isInteger(n) ? n.toFixed(1) : String(n); };
const vec4 = (a) => `vec4(${a.map(f).join(', ')})`;
/** The GLSL spelling of a set name in MG_TEX_<name>: letters, digits and _ stay; anything else ('stone-wall') becomes
 *  _<hex code>_ (stone_2d_wall), so any manifest name compiles. */
export const glslName = (name) => String(name).replace(/[^A-Za-z0-9_]/g, (c) => '_' + c.codePointAt(0).toString(16) + '_');

export function createTextures(world, { manifest, url, anisotropy = 8 }) {
  const { renderer, mat } = world;
  const aniso = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  const toUrl = typeof url === 'function' ? url : (file) => String(url).replace(/\/?$/, '/') + file;
  const loader = new THREE.TextureLoader();
  const sets = new Map(), loads = [];
  const info = (name) => {
    const m = manifest.sets[name];
    if (!m) throw new Error(`[mirage/textures] unknown set "${name}" (have: ${Object.keys(manifest.sets).join(', ')})`);
    return m;
  };
  function load(file, srgb) {
    let t;
    loads.push(new Promise((res) => { t = loader.load(toUrl(file), res, undefined, (e) => { console.error('[mirage/textures] failed to load', file, e); res(); }); }));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  }
  function get(name) {
    if (!sets.has(name)) {
      const m = info(name);
      sets.set(name, { c: { value: load(m.files.c, true) }, n: { value: load(m.files.n, false) } });
    }
    return sets.get(name);
  }
  /** merge the GLSL library and the sets `names` into a patch() hooks object (one call per material);
   *  { relief: true } adds the relief taps (mgTex*Relief), the relief GLSL and its self-shadow on the direct light */
  function hooks(names, h = {}, { relief = false } = {}) {
    const uniforms = { ...(h.uniforms || {}), ...(relief ? RELIEF : {}) };
    let decl = relief ? RELIEF_GLSL + TEX_GLSL + TEX_RELIEF_GLSL : TEX_GLSL;
    for (const n of names) {
      const m = info(n), s = get(n);
      const id = glslName(n);
      uniforms[`mgT_${id}_c`] = s.c; uniforms[`mgT_${id}_n`] = s.n;
      decl += `uniform sampler2D mgT_${id}_c; uniform sampler2D mgT_${id}_n;\n`;
      decl += `#define MG_TEX_${id} mgT_${id}_c, mgT_${id}_n, ${vec4([...m.mean, m.hMean])}, ${vec4([m.tile, m.rough, m.roughSlope ?? 0, 0])}\n`;
    }
    const out = { ...h, fragmentDecl: decl + (h.fragmentDecl || ''), uniforms };
    if (relief) out.lighting = (h.lighting ? h.lighting + '\n' : '') + RELIEF_LIGHT;
    return out;
  }
  /** a ready MeshStandardMaterial: one set, mapping 'tri' | 'wall' | 'ground', optional palette tint (linear);
   *  relief: depth (m) of the close-range relief, render: undulation (m) of a hand-applied render (both opt-in) */
  function material(name, o = {}) {
    const m = info(name);
    const fn = { tri: 'mgTexTri', wall: 'mgTexWall', ground: 'mgTexGround' }[o.mapping || 'tri'];
    const col = o.tint ? `mgTexTint(mgS, vec3(${o.tint.map(f).join(', ')}), ${f(o.detail ?? 1)})` : 'mgS.albedo';
    const { mapping, tile, tint, detail, normal, relief, render, ...params } = o;
    const h = {
      fragmentDecl: 'MgTex mgS;',
      albedo: `mgS = ${fn}(MG_TEX_${glslName(name)}, mgWorldPos, normalize(mgWorldNormal), ${f(tile ?? 0)}, ${f(normal ?? 1)}); diffuseColor.rgb *= ${col};`,
      roughness: 'roughnessFactor = clamp(roughnessFactor + mgS.r, 0.04, 1.0);',
      normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
    };
    const rl = relief > 0 || render > 0;
    if (relief > 0) h.albedo = h.albedo.replace(`${fn}(`, `${fn}Relief(`).replace(/\); diffuse/, `, ${f(relief)}); diffuse`);
    if (render > 0) {
      h.fragmentDecl += ' float mgRR;';
      h.albedo += ` { ${renderHeight('rr', render)} mgRR = rr; }`;
      h.normal += ' normal = mgBump(normal, mgRR, 1.0);';
      h.output = renderShade('mgRR');
    }
    const out = mat.std({ roughness: m.rough, ...params }, hooks([name], h, { relief: rl }));
    out.name = 'tex-' + name;
    return out;
  }
  const ready = () => Promise.all(loads);
  const dispose = () => { for (const s of sets.values()) { s.c.value.dispose(); s.n.value.dispose(); } };
  return { names: Object.keys(manifest.sets), info, hooks, material, ready, dispose, glslName };
}

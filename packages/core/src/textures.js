// Mirage code adapted from the author's own earlier texture layer (no Golden Temple code in it); GLSL rewritten.
import * as THREE from 'three';

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
// GLSL (in scope after hooks()): MG_TEX_<name> expands to the set's arguments.
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

const f = (v) => (Number.isInteger(+v) ? (+v).toFixed(1) : String(+(+v).toFixed(5)));
const vec4 = (a) => `vec4(${a.map(f).join(', ')})`;

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
  /** merge the GLSL library and the sets `names` into a patch() hooks object (one call per material) */
  function hooks(names, h = {}) {
    const uniforms = { ...(h.uniforms || {}) };
    let decl = TEX_GLSL;
    for (const n of names) {
      const m = info(n), s = get(n);
      uniforms[`mgT_${n}_c`] = s.c; uniforms[`mgT_${n}_n`] = s.n;
      decl += `uniform sampler2D mgT_${n}_c; uniform sampler2D mgT_${n}_n;\n`;
      decl += `#define MG_TEX_${n} mgT_${n}_c, mgT_${n}_n, ${vec4([...m.mean, m.hMean])}, ${vec4([m.tile, m.rough, m.roughSlope ?? 0, 0])}\n`;
    }
    return { ...h, fragmentDecl: decl + (h.fragmentDecl || ''), uniforms };
  }
  /** a ready MeshStandardMaterial: one set, mapping 'tri' | 'wall' | 'ground', optional palette tint (linear) */
  function material(name, o = {}) {
    const m = info(name);
    const fn = { tri: 'mgTexTri', wall: 'mgTexWall', ground: 'mgTexGround' }[o.mapping || 'tri'];
    const col = o.tint ? `mgTexTint(mgS, vec3(${o.tint.map(f).join(', ')}), ${f(o.detail ?? 1)})` : 'mgS.albedo';
    const { mapping, tile, tint, detail, normal, ...params } = o;
    const out = mat.std({ roughness: m.rough, ...params }, hooks([name], {
      fragmentDecl: 'MgTex mgS;',
      albedo: `mgS = ${fn}(MG_TEX_${name}, mgWorldPos, normalize(mgWorldNormal), ${f(tile ?? 0)}, ${f(normal ?? 1)}); diffuseColor.rgb *= ${col};`,
      roughness: 'roughnessFactor = clamp(roughnessFactor + mgS.r, 0.04, 1.0);',
      normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
    }));
    out.name = 'tex-' + name;
    return out;
  }
  const ready = () => Promise.all(loads);
  const dispose = () => { for (const s of sets.values()) { s.c.value.dispose(); s.n.value.dispose(); } };
  return { names: Object.keys(manifest.sets), info, hooks, material, ready, dispose };
}

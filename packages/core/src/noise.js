// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
// ---------------------------------------------------------------------------
// The GLSL noise library every patched material gets (WebGL 2 / GLSL ES 3.00). Prefix `mg`.
//
//   float mgHash(vec2|vec3 p)          0..1, integer-lattice hash (pcg3d, Jarzynski & Olano 2020)
//   vec3  mgHash3(vec3 p)              0..1 per component
//   float mgHashBits(vec3 p)           0..1 from the exact float bits (for per-pixel noise: gl_FragCoord + frame)
//   float mgValue2(vec2) / mgValue3(vec3)      value noise 0..1 (quintic fade)
//   float mgGrad2(vec2) / mgGrad3(vec3)        gradient noise ~-1..1
//   float mgFbm2(vec2, int oct) / mgFbm3(vec3, int oct)   fractal gradient noise ~-1..1 (up to 8 octaves)
//   float mgRidge3(vec3, int oct)      ridged fractal 0..1
//   vec2  mgCell2(vec2) / mgCell3(vec3)        cellular distances (F1, F2)
//   vec3  mgTriWeights(vec3 n, float k)        triplanar blend weights from a normal
//   float mgLuma(vec3)
// The block is include-guarded (MG_NOISE), so it may appear twice in one shader.
// ---------------------------------------------------------------------------

export const NOISE_GLSL = /* glsl */ `
#ifndef MG_NOISE
#define MG_NOISE
uvec3 mgPcg3(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
const float MG_U2F = 1.0 / 4294967296.0;
vec3 mgHash3(vec3 p){ return vec3(mgPcg3(uvec3(ivec3(floor(p))))) * MG_U2F; }
float mgHash(vec3 p){ return mgHash3(p).x; }
float mgHash(vec2 p){ return mgHash3(vec3(p, 17.0)).x; }
float mgHashBits(vec3 p){ return float(mgPcg3(floatBitsToUint(p)).x) * MG_U2F; }

vec3 mgFade(vec3 t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
vec2 mgFade(vec2 t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float mgValue3(vec3 p){
  vec3 i = floor(p), f = p - i, u = mgFade(f);
  float x00 = mix(mgHash(i), mgHash(i + vec3(1, 0, 0)), u.x);
  float x10 = mix(mgHash(i + vec3(0, 1, 0)), mgHash(i + vec3(1, 1, 0)), u.x);
  float x01 = mix(mgHash(i + vec3(0, 0, 1)), mgHash(i + vec3(1, 0, 1)), u.x);
  float x11 = mix(mgHash(i + vec3(0, 1, 1)), mgHash(i + vec3(1, 1, 1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
float mgValue2(vec2 p){ return mgValue3(vec3(p, 0.5)); }

// gradient (Perlin-style) noise with hashed corner gradients
float mgCorner3(vec3 i, vec3 f, vec3 o){ vec3 g = mgHash3(i + o) * 2.0 - 1.0; return dot(g, f - o); }
float mgGrad3(vec3 p){
  vec3 i = floor(p), f = p - i, u = mgFade(f);
  float a = mgCorner3(i, f, vec3(0, 0, 0)), b = mgCorner3(i, f, vec3(1, 0, 0));
  float c = mgCorner3(i, f, vec3(0, 1, 0)), d = mgCorner3(i, f, vec3(1, 1, 0));
  float e = mgCorner3(i, f, vec3(0, 0, 1)), g = mgCorner3(i, f, vec3(1, 0, 1));
  float h = mgCorner3(i, f, vec3(0, 1, 1)), k = mgCorner3(i, f, vec3(1, 1, 1));
  return 1.6 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float mgCorner2(vec2 i, vec2 f, vec2 o){ vec2 g = mgHash3(vec3(i + o, 3.0)).xy * 2.0 - 1.0; return dot(g, f - o); }
float mgGrad2(vec2 p){
  vec2 i = floor(p), f = p - i, u = mgFade(f);
  float a = mgCorner2(i, f, vec2(0, 0)), b = mgCorner2(i, f, vec2(1, 0));
  float c = mgCorner2(i, f, vec2(0, 1)), d = mgCorner2(i, f, vec2(1, 1));
  return 1.9 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// octaves are rotated and offset so lattice artefacts do not line up
const mat3 MG_OCT3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64) * 2.02;
const mat2 MG_OCT2 = mat2(0.80, 0.60, -0.60, 0.80) * 2.02;
float mgFbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * mgGrad3(p); n += a; p = MG_OCT3 * p + 11.3; a *= 0.5; }
  return s / max(n, 1e-4);
}
float mgFbm2(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * mgGrad2(p); n += a; p = MG_OCT2 * p + 7.7; a *= 0.5; }
  return s / max(n, 1e-4);
}
float mgRidge3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; float r = 1.0 - abs(mgGrad3(p)); s += a * r * r; n += a; p = MG_OCT3 * p + 5.1; a *= 0.5; }
  return s / max(n, 1e-4);
}
vec2 mgCell3(vec3 p){
  vec3 i = floor(p), f = p - i;
  vec2 d = vec2(9.0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 o = vec3(x, y, z);
    vec3 r = o + mgHash3(i + o) - f;
    float q = dot(r, r);
    d = q < d.x ? vec2(q, d.x) : vec2(d.x, min(d.y, q));
  }
  return sqrt(d);
}
vec2 mgCell2(vec2 p){
  vec2 i = floor(p), f = p - i;
  vec2 d = vec2(9.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(x, y);
    vec2 r = o + mgHash3(vec3(i + o, 9.0)).xy - f;
    float q = dot(r, r);
    d = q < d.x ? vec2(q, d.x) : vec2(d.x, min(d.y, q));
  }
  return sqrt(d);
}
vec3 mgTriWeights(vec3 n, float k){ vec3 w = pow(abs(n), vec3(k)); return w / max(w.x + w.y + w.z, 1e-5); }
float mgLuma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
#endif
`;

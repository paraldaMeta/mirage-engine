// Mirage original code.
// ---------------------------------------------------------------------------
// The GLSL of the surface framework (surfaces.js): the shared periodic noise and pattern helpers every recipe uses.
// The recipes themselves (one per surface kind) are registered (registerSurfaceKinds; @miragekit/assets/surfaces has
// the library's). A recipe is `MsS ms_<kind>(vec2 u)`: u is a point of the surface in metres (the mapping's own plane,
// u along the grain where the kind has one), the result is the surface there: linear albedo (metals: F0), roughness,
// height 0..1 (the kind's `depth` metres from 0 to 1), metalness and cavity occlusion.
//
// Every pattern repeats exactly over the tile (msT metres, both axes): lattice noise hashes its cell modulo the
// tile's cell count, grids snap their module to a whole number per tile. That is what lets the same recipe be
// evaluated per pixel (procedural) or rendered once into a tileable texture set (baked) and give the same values.
// Level of detail: msFP is the footprint of a pixel (or a texel when baking) in metres; octaves and features below
// ~3 footprints are not evaluated (msLod), so far pixels are cheaper and do not shimmer, and a bake is the
// band-limited surface its mip chain expects.
//
// Per-material numbers are uniforms (msX .. msG), so materials of one kind that differ only by parameters share a
// program. The variant is msX.z (a uniform branch).
// ---------------------------------------------------------------------------

export const MS_COMMON = /* glsl */ `
#ifndef MS_COMMON
#define MS_COMMON
uniform vec4 msX;   // tile (m), seed, variant, scale
uniform vec4 msY;   // grain mode, depth (m), breaker quantum (m), breaker on
uniform vec4 msW;   // age, dirt, edge wear, macro variation
uniform vec4 msA; uniform vec4 msB; uniform vec4 msC; uniform vec4 msD;
uniform vec4 msE;   // exposed at worn edges: rgb, roughness
uniform vec4 msF;   // exposed: metalness, mode (0 replace, 1 multiply, <0 none), chip size (m), grain vector index
uniform vec4 msG;   // dirt colour rgb, ground height (m)
float msT = 1.0; float msSeed = 0.0; float msFP = 0.001; vec2 msCellSize = vec2(1.0);
float msH = 0.5; float msM = 0.0; float msR = 0.5; float msEdgeK = 0.0;
struct MsS { vec3 a; float r; float h; float m; float ao; };
const float MS_PI = 3.14159265;

vec3 msH3(vec2 i, vec2 P){ return mgHash3(vec3(mod(i, P), msSeed)); }
vec3 msCH(vec2 id, float k){ return mgHash3(vec3(id, msSeed * 7.0 + k)); }
float msP(float f){ return max(1.0, floor(msT * f + 0.5)); }
// 1 while a feature of wavelength wl (m) spans 3+ footprints, fading to 0 below ~2
// msLodA: 0 below that many footprints per wavelength, 1 from msLodA + 1.5 (a bake keeps 2-texel features: its mips
// filter them; per pixel 3 is the floor)
float msLodA = 3.0;
float msLod(float wl){ return clamp((wl / max(msFP, 1e-6) - msLodA) / 1.5, 0.0, 1.0); }
float msGradP(vec2 p, vec2 P){
  vec2 i = floor(p), f = p - i, w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(msH3(i, P).xy * 2.0 - 1.0, f);
  float b = dot(msH3(i + vec2(1.0, 0.0), P).xy * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(msH3(i + vec2(0.0, 1.0), P).xy * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(msH3(i + vec2(1.0, 1.0), P).xy * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return 1.9 * mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
float msValP(vec2 p, vec2 P){
  vec2 i = floor(p), f = p - i, w = f * f * (3.0 - 2.0 * f);
  return mix(mix(msH3(i, P).x, msH3(i + vec2(1.0, 0.0), P).x, w.x), mix(msH3(i + vec2(0.0, 1.0), P).x, msH3(i + vec2(1.0, 1.0), P).x, w.x), w.y);
}
// fractal gradient noise ~-1..1 over the tile; f: base frequency per axis (1/m); finer octaves than the footprint skip
float msFbm2(vec2 u, vec2 f, int oct){
  vec2 P = vec2(msP(f.x), msP(f.y));
  vec2 p = u * P / msT;
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++){
    if (i >= oct) break;
    float k = msLod(msT / max(P.x, P.y));
    if (k <= 0.0) break;
    s += a * k * msGradP(p + float(i) * 7.31, P);
    p *= 2.0; P *= 2.0; a *= 0.5;
  }
  return s / (1.0 - pow(0.5, float(oct)));
}
float msFbm(vec2 u, float f, int oct){ return msFbm2(u, vec2(f), oct); }
// value noise 0..1 (one octave), faded to 0.5 below the footprint
float msVal2(vec2 u, vec2 f){ vec2 P = vec2(msP(f.x), msP(f.y)); return mix(0.5, msValP(u * P / msT, P), msLod(msT / max(P.x, P.y))); }
// cellular: F1, F2 (in cells), a hash of the nearest cell and another; jit 0 = a grid, 1 = fully random
vec4 msCell2(vec2 u, vec2 f, float jit){
  vec2 P = vec2(msP(f.x), msP(f.y)), p = u * P / msT;
  vec2 i = floor(p), fr = p - i, id = vec2(0.0);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec3 h = msH3(i + o, P);
    vec2 r = o + 0.5 + jit * (h.xy - 0.5) - fr;
    float q = dot(r, r);
    if (q < d1){ d2 = d1; d1 = q; id = i + o; } else d2 = min(d2, q);
  }
  vec3 hh = mgHash3(vec3(mod(id, P), msSeed + 5.0));
  return vec4(sqrt(d1), sqrt(d2), hh.x, hh.y);
}
vec4 msCell(vec2 u, float f, float jit){ return msCell2(u, vec2(f), jit); }
// a line d metres from its centre, half-width w, antialiased by the footprint
float msLine(float d, float w){ float e = max(msFP, 1e-5); return 1.0 - smoothstep(w - 0.5 * e, w + e, abs(d)); }
// a grid of cells snapped to the tile (cell ~ m, alternate rows shifted by shift cells): xy = metres inside the cell,
// zw = the cell's id (wrapped); msCellSize = the snapped cell size
vec4 msGrid(vec2 u, vec2 cell, float shift){
  float nx = max(1.0, floor(msT / cell.x + 0.5)), ny = max(1.0, floor(msT / cell.y + 0.5));
  if (shift != 0.0) ny = max(2.0, 2.0 * floor(ny * 0.5 + 0.5));
  vec2 s = vec2(msT / nx, msT / ny);
  float row = floor(u.y / s.y);
  float x = u.x / s.x + shift * mod(row, 2.0);
  msCellSize = s;
  return vec4(fract(x) * s.x, u.y - row * s.y, mod(vec2(floor(x), row), vec2(nx, ny)));
}
float bh0(vec2 id){ return mgHash3(vec3(id, msSeed + 11.0)).x; }
float msEdgeD(vec4 g){ vec2 e = min(g.xy, msCellSize - g.xy); return min(e.x, e.y); }
// snap a spacing to the tile
float msSnap(float s){ return msT / max(1.0, floor(msT / s + 0.5)); }
// layered wear on a coating: n is a 0..1 wear field, amt the share worn: 0 intact .. 1 chip edge .. 2 primer .. 3 bare
float msLayers(float n, float amt){
  float th = 1.0 - amt;
  return smoothstep(th - 0.02, th, n) + smoothstep(th + 0.05, th + 0.07, n) + smoothstep(th + 0.12, th + 0.14, n);
}
// domain warp: u pushed by two fractal fields of base frequency f (1/m), amt metres
vec2 msWarp(vec2 u, float f, float amt){ return u + amt * vec2(msFbm(u + 17.3, f, 3), msFbm(u + 41.7, f, 3)); }
// a 0..1 field cut at th with an edge soft wide in field units: crisp layered edges (paint islands, spalls)
float msCut(float n, float th, float soft){ return smoothstep(th - soft, th + soft, n); }
// ridged fractal 0..1 (creases, flakes, torn crusts): bright ridges where the noise crosses zero
float msRidge(vec2 u, vec2 f, int oct){ return 1.0 - abs(msFbm2(u, f, oct)); }
// signed distance to a rounded box (half size hs, corner radius r) centred at the origin; < 0 inside
float msBox(vec2 p, vec2 hs, float r){ vec2 d = abs(p) - hs + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
// speckle: sparse grains (cells of 1/f m), a share amt of them on, each its own 0..1 tone in .y; faded by the LOD
vec2 msSpeck(vec2 u, float f, float amt, float rad, float k){
  vec4 c = msCell(u + k, f, 1.0);
  return vec2((1.0 - smoothstep(rad * 0.6, rad, c.x)) * step(1.0 - amt, c.z) * msLod(1.0 / f), c.w);
}
vec3 msRustCol(float n){ n = clamp(n, 0.0, 1.0); return mix(mix(vec3(0.07, 0.03, 0.015), vec3(0.2, 0.08, 0.03), smoothstep(0.0, 0.5, n)), vec3(0.38, 0.16, 0.06), smoothstep(0.55, 1.0, n)); }
#endif
`;

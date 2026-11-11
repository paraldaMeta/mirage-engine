// Mirage original code.
// ---------------------------------------------------------------------------
// The GLSL of the surface library (surfaces.js): the shared periodic noise and pattern helpers and one recipe per
// surface kind. A recipe is `MsS ms_<kind>(vec2 u)`: u is a point of the surface in metres (the mapping's own plane,
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
vec3 msRustCol(float n){ n = clamp(n, 0.0, 1.0); return mix(mix(vec3(0.07, 0.03, 0.015), vec3(0.2, 0.08, 0.03), smoothstep(0.0, 0.5, n)), vec3(0.38, 0.16, 0.06), smoothstep(0.55, 1.0, n)); }
#endif
`;

// ---- one recipe per kind -------------------------------------------------------------------------------------------
// Parameter vectors per kind are documented next to each recipe (and packed in surfaces.js). Albedo comes in linear.
export const KIND_GLSL = {
  // A: base rgb, roughness   B: panel w, panel h, tie spacing, board height   C: paint rgb, peel   D: aggregate, pores, cold joint, efflorescence
  concrete: /* glsl */ `
MsS ms_concrete(vec2 u){
  float V = msX.z; vec3 base = msA.rgb;
  float m1 = msFbm(u, 0.8, 3), m2 = msFbm(u + 3.7, 6.0, 3), sand = msFbm(u + 1.3, 120.0, 2);
  // air voids (bug holes): sparse pits 2..8 mm with a lighter rim, their sizes by the cell's hash
  vec4 pc = msCell(u + 0.006 * vec2(msFbm(u, 70.0, 2), msFbm(u + 2.0, 70.0, 2)), 26.0, 1.0);
  float pr = 0.035 + 0.15 * pc.w * pc.w * pc.w;
  float pore = (1.0 - smoothstep(pr * 0.7, pr, pc.x)) * step(1.0 - 0.32 * msD.y, pc.z) * msLod(0.012);
  float prim = (1.0 - smoothstep(pr, pr * 1.6, pc.x)) * step(1.0 - 0.32 * msD.y, pc.z) * msLod(0.02) - pore;
  // fine aggregate showing in the laitance: grains 1.5..5 mm of their own tone
  vec4 ag = msCell(u + 5.1, 160.0, 1.0);
  float agg = msD.x * (1.0 - smoothstep(0.18, 0.34, ag.x)) * step(0.45, ag.z) * msLod(0.005);
  // cloudy laitance: soft darker and paler clouds 10..60 cm, a faint warm / cool drift between them
  float cl = msFbm(u + 6.1, 2.6, 4);
  vec3 col = base * (0.88 + 0.16 * m1 + 0.12 * cl + 0.08 * m2 + 0.07 * sand) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), 0.5 + 0.5 * m1);
  col = mix(col, base * (0.62 + 0.75 * ag.w) * vec3(1.05, 1.0, 0.93), agg * 0.75);
  col *= 1.0 + 0.1 * prim;
  float h = 0.6 + 0.07 * m2 + 0.05 * sand + 0.04 * agg - 0.5 * pore;
  float r = msA.a + 0.04 * m1 + 0.04 * sand + 0.06 * pore;
  float ao = 1.0 - 0.7 * pore;
  if (V < 0.5 || V > 2.5) {
    vec4 g = msGrid(u, msB.xy, 0.0); float de = msEdgeD(g); vec3 ph = msCH(g.zw, 4.0);
    col *= 0.93 + 0.12 * ph.x;                                    // each panel of the pour a shade apart
    if (V < 0.5) {
      // formwork joint: a thin fin of grout that leaked between the panels, a dark line beside it
      float seam = msLine(de, 0.001), fin = (1.0 - smoothstep(0.0015, 0.008, de)) * (0.6 + 0.4 * msFbm(u * 3.0, 9.0, 2));
      h += 0.12 * fin - 0.25 * seam; col *= (1.0 - 0.35 * seam) * (1.0 + 0.06 * fin); ao *= 1.0 - 0.35 * seam;
      // the plywood face printed in: faint grain along the panel, and the panel's own patchy release-agent tone
      col *= 1.0 + 0.045 * msFbm2(u + ph.yz * 3.0, vec2(1.2, 22.0), 3) + 0.05 * msFbm(u + ph.xy * 5.0, 2.2, 2);
      // tie holes: a cone recess, a darker ring where the plastic cone sat, rust bleeding from some of them
      float sp = msSnap(msB.z);
      vec2 cell = floor(u / sp), tq = u - (cell + 0.5) * sp;
      float rr = length(tq);
      float hole = 1.0 - smoothstep(0.011, 0.0135 + msFP, rr), cone = (1.0 - smoothstep(0.0135, 0.022, rr));
      float ring = (1.0 - smoothstep(0.022, 0.034, rr)) * (1.0 - cone);
      vec3 hh = mgHash3(vec3(mod(cell, vec2(msT / sp)), msSeed + 9.0));
      float bleed = step(0.45, hh.x) * (1.0 - smoothstep(0.003, 0.009 + 0.004 * hh.y, abs(tq.x + 0.002 * sand))) * step(tq.y, -0.01)
                  * (1.0 - smoothstep(0.0, 0.06 + 0.3 * hh.z, -tq.y - 0.01));
      h -= 0.45 * hole + 0.15 * (cone - hole); col *= (1.0 - 0.7 * hole) * (1.0 - 0.12 * (cone - hole)) * (1.0 - 0.06 * ring);
      ao *= 1.0 - 0.6 * hole;
      col = mix(col, vec3(0.2, 0.085, 0.035), 0.6 * bleed * clamp(msW.x * 1.5, 0.0, 1.0));
    } else {
      // precast: smoother, chamfered V joints, lifting-anchor recesses
      float ch = 1.0 - smoothstep(0.0, 0.016, de);
      h = mix(h, 0.08 + 0.4 * de / 0.016, ch); col *= 1.0 - 0.18 * ch; ao *= 1.0 - 0.4 * ch; r -= 0.06;
      vec2 an = g.xy - msCellSize * vec2(0.5, 0.85); float ad = length(an);
      float anchor = 1.0 - smoothstep(0.03, 0.034 + msFP, ad);
      h -= 0.3 * anchor; col *= 1.0 - 0.3 * anchor; ao *= 1.0 - 0.4 * anchor;
    }
  } else if (V < 1.5) {
    // board-formed: horizontal boards, each set a little deeper or shallower; their grain and edges printed in
    float nb = max(1.0, floor(msT / msB.w + 0.5)), bh = msT / nb, row = floor(u.y / bh), fy = u.y - row * bh;
    vec3 b3 = mgHash3(vec3(mod(row, nb), 3.0, msSeed));
    float warp = msFbm2(u + vec2(0.0, row * 0.37), vec2(1.0, 18.0), 3);
    float ringc = (fy - bh * (0.3 + 0.4 * b3.x)) + 0.015 * warp;
    float rings = sin(ringc * 210.0 + b3.y * 20.0) * msLod(0.03);
    float joint = msLine(min(fy, bh - fy), 0.0018);
    float lip = (1.0 - smoothstep(0.0, 0.006, min(fy, bh - fy))) * (1.0 - joint);
    h += 0.16 * (b3.y - 0.5) + 0.07 * rings + 0.05 * warp - 0.3 * joint + 0.06 * lip;
    col *= (0.9 + 0.16 * b3.z) * (1.0 + 0.05 * rings) * (1.0 - 0.32 * joint);
    ao *= 1.0 - 0.35 * joint;
  } else {
    // painted (masonry paint), flaking where it has aged: film -> lifted rim -> bare concrete
    float pn = msFbm(u + 9.0, 2.0, 5) * 0.75 + msFbm(u, 16.0, 2) * 0.25;
    float th = 0.62 - 0.6 * msC.a;
    float bare = smoothstep(th, th + 0.012, pn), rim = smoothstep(th - 0.06, th, pn) * (1.0 - bare);
    vec3 paint = msC.rgb * (0.96 + 0.05 * m2 + 0.03 * m1);
    col = mix(paint, col * 0.92, bare); col = mix(col, paint * 1.07, rim * 0.6);
    r = mix(0.6 + 0.05 * m1, r, bare);
    h = mix(0.6 + 0.04 * m2 + 0.02 * sand - 0.25 * pore, h - 0.08, bare) + 0.05 * rim;
    ao = mix(1.0 - 0.35 * pore, ao, bare) * (1.0 - 0.2 * smoothstep(th, th + 0.03, pn) * (1.0 - smoothstep(th + 0.03, th + 0.08, pn)));
  }
  // a cold joint between two pours (a wavy horizontal line) and efflorescence below it
  if (msD.z > 0.0) {
    float cj = u.y - msT * 0.62 - 0.03 * msFbm(vec2(u.x, 0.0), 2.0, 3);
    float line = msLine(cj, 0.0015) * msD.z;
    float eff = msD.w * (1.0 - smoothstep(0.0, 0.18 + 0.2 * (msFbm2(u, vec2(9.0, 0.6), 2) * 0.5 + 0.5), -cj)) * step(cj, 0.0) * smoothstep(0.0, 0.5, msFbm2(u + 2.0, vec2(14.0, 1.2), 3) + 0.2);
    col = mix(col * (1.0 - 0.4 * line), vec3(0.62, 0.61, 0.58), eff * 0.55);
    h -= 0.2 * line; r += 0.05 * eff;
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: binder rgb, roughness   B: stone rgb, stone size (m)   C: patch, cracks, oil, polish   D: -
  asphalt: /* glsl */ `
MsS ms_asphalt(vec2 u){
  float V = msX.z;
  float lodS = msLod(msB.a);
  // packed aggregate: two sieve sizes of stones, each its own albedo (greys, a few brown or white)
  vec4 st = msCell(u, 1.0 / msB.a, 0.95), s2 = msCell(u + 0.37, 2.3 / msB.a, 0.95);
  float dome = 1.0 - smoothstep(0.0, 0.62, st.x), dome2 = 1.0 - smoothstep(0.0, 0.6, s2.x);
  float level = V < 0.5 ? 0.66 : 0.3;                       // the binder's level: fresh covers most of each stone
  float stone = smoothstep(level, level + 0.05, dome) * lodS;
  float stone2 = smoothstep(level + 0.1, level + 0.15, dome2) * msLod(msB.a / 2.3) * (1.0 - stone);
  float fines = msFbm(u + 2.0, 160.0, 2), m1 = msFbm(u, 0.9, 3);
  vec3 tone = mix(vec3(1.0), mix(vec3(1.18, 1.02, 0.86), vec3(1.25, 1.24, 1.22), step(0.85, st.w)), step(0.62, st.w));
  vec3 sc = msB.rgb * (0.5 + 0.95 * st.z) * tone, sc2 = msB.rgb * (0.55 + 0.8 * s2.z);
  vec3 binder = msA.rgb * (0.88 + 0.14 * fines + 0.08 * m1);
  float cov = V < 0.5 ? 0.06 : 0.36;                       // far: the share of stone the eye averages
  vec3 col = mix(binder, sc, stone);
  col = mix(col, sc2, stone2 * 0.9);
  col = mix(mix(binder, msB.rgb * 0.95, cov), col, lodS);
  float pol = msC.w;                                       // tyres polish the stone tops
  float r = mix(msA.a + 0.04 * fines, 0.7 - 0.25 * pol + 0.12 * st.z, stone);
  r = mix(r, 0.75 - 0.2 * pol, stone2);
  // between exposed stones: voids (worn): darker, deeper
  float voids = V < 0.5 ? 0.0 : (1.0 - smoothstep(level - 0.32, level - 0.05, dome)) * (1.0 - stone2) * lodS;
  float h = 0.42 + 0.4 * max(dome - level, 0.0) / (1.0 - level) * lodS + 0.25 * stone2 * (dome2 - level - 0.1) + 0.04 * fines - 0.18 * voids;
  float ao = 1.0 - 0.45 * voids;
  // cracks: a network (edges of big cells), opened only where a slow field allows, varying in width
  float cs = msT / msP(0.9);
  vec4 ck = msCell(u + 7.0 + 0.04 * vec2(msFbm(u, 6.0, 2), msFbm(u + 3.0, 6.0, 2)), 0.9, 1.0);
  float open_ = smoothstep(0.15, 0.5, msFbm(u + 4.0, 1.3, 2) * 0.5 + 0.5 + msC.y - 0.55);
  float cw = 0.0012 + 0.003 * (msFbm(u + 1.0, 8.0, 2) * 0.5 + 0.5);
  float crack = msLine((ck.y - ck.x) * cs * 0.5, cw) * open_;
  h -= 0.3 * crack; col *= 1.0 - 0.65 * crack; ao *= 1.0 - 0.5 * crack;
  if (V > 1.5) {
    // patched: crack sealant (glossy tar bands poured along the cracks) and a rectangle of newer asphalt
    float seal = msLine((ck.y - ck.x) * cs * 0.5, 0.018 + 0.008 * msFbm(u, 5.0, 2)) * smoothstep(0.3, 0.6, open_ + 0.3);
    col = mix(col, vec3(0.022, 0.021, 0.02), seal * 0.95); r = mix(r, 0.32, seal); h = mix(h, 0.5, seal); ao = mix(ao, 1.0, seal);
    vec2 pc = abs(u - msT * vec2(0.52, 0.47)) - msT * vec2(0.27, 0.19) * (0.6 + 0.4 * msC.x);
    float inside = 1.0 - smoothstep(-msFP, msFP, max(pc.x, pc.y));
    float pedge = msLine(max(pc.x, pc.y), 0.004);
    float fstone = smoothstep(0.66, 0.71, dome) * lodS;
    vec3 fresh = mix(msA.rgb * 0.75 * (0.9 + 0.14 * fines), sc, fstone);
    col = mix(col, fresh, inside); r = mix(r, mix(0.62, 0.7, fstone), inside);
    h = mix(h, 0.45 + 0.3 * max(dome - 0.66, 0.0) / 0.34 * lodS, inside);
    col = mix(col, vec3(0.02), pedge * 0.9); r = mix(r, 0.35, pedge);
  }
  // oil drips: dark, glossier stains where vehicles stand
  if (msC.z > 0.0) {
    vec4 od = msCell(u + 11.0, 2.2, 1.0);
    float drop = (1.0 - smoothstep(0.08, 0.3 + 0.25 * od.w, od.x + 0.12 * msFbm(u * 2.0, 8.0, 2))) * step(1.0 - 0.45 * msC.z, od.z);
    col *= 1.0 - 0.45 * drop; r = mix(r, 0.45, drop * 0.8);
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: stone rgb, roughness   B: cell w, cell h, joint width, row shift   C: joint rgb, tilt   D: chips, speckle, -, -
  paving: /* glsl */ `
MsS ms_paving(vec2 u){
  float V = msX.z;
  vec4 g = msGrid(u, msB.xy, msB.w);
  vec2 s = msCellSize, q = g.xy, c = q - 0.5 * s;
  float de = msEdgeD(g);
  vec3 ph = msCH(g.zw, 2.0), ph2 = msCH(g.zw, 6.0);
  float jw = msB.z * 0.5;
  float m1 = msFbm(u, 1.0, 3), fines = msFbm(u + 3.0, 90.0, 2);
  vec3 col; float h, r, ao = 1.0;
  if (V < 0.5) {
    // concrete flags: exposed fine aggregate, a slab-wide tilt (rocked slabs catch the light apart), chipped arrises
    vec4 ag = msCell(u + 1.7, 150.0, 1.0);
    float sp = (1.0 - smoothstep(0.22, 0.4, ag.x)) * msLod(0.006) * msD.y;
    float stain = msFbm(u + ph.xy * 5.0, 3.5, 4), blot = smoothstep(0.25, 0.7, msFbm(u + ph.zx * 7.0, 1.6, 3));
    col = msA.rgb * (0.84 + 0.28 * ph.x) * (0.9 + 0.1 * m1 + 0.1 * stain + 0.07 * fines) * (1.0 - 0.18 * blot);
    col = mix(col, msA.rgb * (0.45 + 1.1 * ag.z) * mix(vec3(1.0), vec3(1.08, 1.0, 0.9), ag.w), sp * 0.7);
    float chipN = msFbm(u + 7.0, 18.0, 3) * 0.5 + 0.5;
    float chip = smoothstep(0.62 - 0.25 * msD.x, 0.66 - 0.25 * msD.x, chipN + (0.02 - min(de - jw, 0.02)) * 22.0 - 0.45) * step(jw, de);
    float bevel = smoothstep(jw, jw + 0.004, de);
    h = 0.62 + dot(c, (ph2.xy - 0.5)) * msC.a * 2.0 + 0.04 * fines + 0.04 * sp - 0.2 * chip;
    h = mix(0.15, h, bevel);
    col = mix(col, msA.rgb * 1.12, chip * 0.6);
    r = msA.a + 0.06 * (ph.y - 0.5) + 0.04 * fines + 0.05 * chip;
  } else if (V < 1.5) {
    // setts / cobbles: domed stones, tops polished smooth by wheels and feet, granite speckle
    float dome = sqrt(clamp(de / (0.35 * min(s.x, s.y)), 0.0, 1.0));
    vec4 gr = msCell(u + 2.3, 260.0, 1.0);
    vec3 min3 = mix(vec3(0.95), mix(vec3(0.35), vec3(1.25, 1.05, 0.95), step(0.5, gr.z)), step(0.35, gr.z));
    col = msA.rgb * (0.75 + 0.5 * ph.x) * mix(vec3(1.0), min3, msLod(0.003) * msD.y);
    h = (0.15 + 0.75 * dome) * smoothstep(jw, jw + 0.006, de) + 0.03 * fines;
    r = mix(msA.a + 0.1, msA.a - 0.25, dome * dome) + 0.05 * ph.y;
    ao = 0.6 + 0.4 * smoothstep(jw, jw + 0.02, de);
  } else {
    // polished stone (granite tiles): crystals of three minerals, scratches, a thin grout line
    vec4 gr = msCell(u + 2.3, 230.0, 1.0), gr2 = msCell(u + 5.9, 90.0, 0.9);
    float k = msLod(0.004);
    vec3 min3 = gr.z < 0.25 ? vec3(0.32) : gr.z < 0.6 ? vec3(1.0) : vec3(1.35, 1.2, 1.12);
    vec3 big = gr2.z < 0.15 ? vec3(0.4) : vec3(1.0);
    col = msA.rgb * mix(vec3(1.0), min3 * big, k * msD.y) * (0.95 + 0.1 * ph.x);
    float scr = msLine(fract(dot(u, vec2(0.8, 0.6)) * 37.0 + msFbm(u, 3.0, 2)) - 0.5, 0.004) * step(0.7, msFbm(u + 8.0, 4.0, 2) * 0.5 + 0.5);
    h = 0.6 * smoothstep(jw, jw + 0.0015, de) + 0.02 * gr.x * k;
    r = msA.a + 0.04 * (gr.w - 0.5) * k + 0.12 * scr * msLod(0.002);
  }
  // the joint: sand, grit, dirt
  float joint = 1.0 - smoothstep(jw - 0.5 * msFP, jw + msFP, de);
  col = mix(col, msC.rgb * (0.75 + 0.5 * (msFbm(u, 60.0, 2) * 0.5 + 0.5)), joint);
  r = mix(r, 0.95, joint); h = mix(h, 0.05 + 0.05 * fines, joint);
  ao *= 1.0 - 0.45 * joint;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: brick rgb, roughness   B: brick w, course h, mortar w, recess (share of depth)   C: mortar rgb, burnt share   D: paint rgb, paint
  brick: /* glsl */ `
MsS ms_brick(vec2 u){
  float V = msX.z;
  float ero = 0.25 + 0.75 * msW.x;                                 // weathering: eroded arrises, a rougher face
  vec2 wob = vec2(msFbm(u + 1.7, 9.0, 3), msFbm(u + 4.2, 9.0, 3));
  vec4 g = msGrid(u + wob * 0.004 * ero, msB.xy, 0.5);
  vec2 s = msCellSize, q = g.xy;
  float mw = msB.z * 0.5;
  // the brick's outline: its edge distance broken by erosion (deeper on the corners), so no two bricks are the same box
  float er = (msFbm(u + 13.0, 8.0, 4) * 0.5 + 0.5) * 0.009 * ero + (msFbm(u + 2.0, 45.0, 2) * 0.5 + 0.5) * 0.003 * ero;
  float de = msEdgeD(g) - er;
  vec3 b = msCH(g.zw, 3.0), b2 = msCH(g.zw, 8.0);
  float sand = msFbm(u + 2.0, 160.0, 2), m3 = msFbm(u + b.xy * 3.0, 14.0, 4), m2 = msFbm(u + b.zx * 5.0, 5.0, 3);
  // fired clay: every brick its own shade and hue (kiln position), some over-burnt, some pale; within a brick a
  // mottle at 1..5 cm and flashing toward one end
  vec3 hue = mix(vec3(1.0), mix(vec3(1.18, 0.92, 0.72), vec3(0.88, 1.0, 1.12), b2.y), 0.35 * b2.z);
  vec3 tone = mix(vec3(1.0), vec3(0.6, 0.55, 0.58), step(1.0 - msC.a, b.x)) * mix(vec3(1.0), vec3(1.15, 1.12, 1.06), step(0.88, b.y));
  float flash = smoothstep(0.2, 1.0, (q.x / s.x - 0.5) * (b2.x - 0.5) * 4.0);
  float mh = msFbm(u + b.yx * 9.0, 22.0, 3);
  vec3 mott = mix(vec3(1.0), mix(vec3(1.2, 0.86, 0.62), vec3(0.86, 1.04, 1.2), mh * 0.5 + 0.5), 0.3 * ero);
  vec3 col = msA.rgb * hue * tone * mott * (0.8 + 0.32 * b.z) * (0.82 + 0.28 * m3 + 0.1 * m2 + 0.07 * sand) * (1.0 - 0.15 * flash);
  if (V > 2.5) {   // stock bricks: dark cinder specks and kiss marks
    vec4 sp = msCell(u + 4.1, 110.0, 1.0);
    col *= 1.0 - 0.5 * (1.0 - smoothstep(0.1, 0.22, sp.x)) * step(0.65, sp.z) * msLod(0.006);
    col *= 1.0 - 0.2 * smoothstep(0.2, 0.7, msFbm(u + b.zx * 4.0, 5.0, 2));
  }
  // the face: sanded texture, shallow dents of all sizes, fire cracks
  vec4 dt = msCell(u + 1.1, 12.0, 1.0);
  float dent = (1.0 - smoothstep(0.0, 0.5, dt.x + 0.25 * msFbm(u, 60.0, 2))) * step(0.72, dt.z) * (0.4 + 0.6 * dt.w);
  float flake = msFbm(u + b.xy * 7.0, 30.0, 5), ridge = 1.0 - abs(msFbm(u + b.zy * 3.0, 55.0, 3));
  vec4 fc = msCell(u + 5.5, 7.0, 1.0);
  float fcrack = msLine((fc.y - fc.x) * msT / msP(7.0) * 0.5, 0.0005) * step(0.8, fc.z) * msLod(0.006) * smoothstep(0.2, 0.6, msFbm(u + 8.0, 9.0, 2));
  float face = smoothstep(mw, mw + 0.002 + 0.005 * ero, de);
  float hf = 0.78 + 0.05 * (b2.x - 0.5) + 0.05 * m3 * ero + 0.03 * sand + ero * (0.05 * flake + 0.025 * ridge) - 0.12 * dent * ero - 0.08 * fcrack;
  float h = mix(0.35, hf, face);
  col *= (1.0 - 0.08 * dent - 0.12 * fcrack) * (1.0 + 0.12 * ero * flake);
  col = mix(col * 0.82, col, face);                                  // the rounded arris catches grime
  float r = msA.a + 0.06 * (b.y - 0.5) - 0.12 * step(1.0 - msC.a, b.x) + 0.04 * sand;
  float ao = 1.0 - 0.3 * dent * ero;
  // mortar: recessed (msB.w of the depth), sandy and grainy, lighter, lime blooms
  float mort = 1.0 - smoothstep(mw - 0.0015, mw + 0.0005, de);
  vec4 sg = msCell(u + 9.0, 280.0, 1.0);
  float grit = (1.0 - smoothstep(0.1, 0.45, sg.x)) * msLod(0.003);
  float mrel = msFbm(u + 3.0, 60.0, 3);
  vec3 mc = msC.rgb * (0.82 + 0.25 * (msFbm(u + 6.0, 40.0, 3) * 0.5 + 0.5)) * mix(1.0, 0.85 + 0.3 * sg.z, grit);
  col = mix(col, mc, mort); r = mix(r, 0.93, mort);
  h = mix(h, 1.0 - msB.w + 0.04 * mrel + 0.03 * grit, mort);
  ao *= 1.0 - 0.25 * mort - 0.25 * (1.0 - face) * (1.0 - mort);
  if (V > 1.5 && V < 2.5) {   // painted brick: the film follows every dent, worn off on the arrises first
    float pn = msFbm(u + 3.0, 3.0, 4) * 0.7 + (1.0 - face) * 0.5;
    float bare = smoothstep(0.75 - 0.5 * msD.a, 0.78 - 0.5 * msD.a, pn * 0.5 + 0.5);
    col = mix(msD.rgb * (0.94 + 0.06 * m2 + 0.04 * m3) * mix(1.0, 0.9, mort), col, bare);
    r = mix(0.72, r, bare);
  }
  if (V > 0.5 && V < 1.5) r -= 0.12;   // engineering brick: dense, a little glossy
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: render rgb, roughness   B: -, crack amount, patch amount, -   C: patch rgb, -
  render: /* glsl */ `
MsS ms_render(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 0.7, 3), m2 = msFbm(u + 2.0, 4.0, 3), fine = msFbm(u + 4.0, 70.0, 3);
  // trowel: overlapping arcs of a float, wide soft ridges where two strokes meet
  vec4 tc = msCell2(u + 0.3 * vec2(m2, m1), vec2(2.4, 3.2), 1.0);
  float stroke = smoothstep(0.0, 0.25, tc.y - tc.x);
  vec3 col = msA.rgb * (0.94 + 0.08 * m1 + 0.05 * m2 + 0.04 * fine) * (0.97 + 0.06 * tc.z);
  float h = 0.55 + 0.08 * stroke + 0.06 * m2 + 0.04 * fine;
  float r = msA.a + 0.03 * m1 + 0.04 * fine - 0.05 * (1.0 - stroke);
  float ao = 1.0;
  if (V > 0.5 && V < 1.5) {
    // pebbledash: small pebbles 3..8 mm pressed into the coat, each its own colour
    vec4 pb = msCell(u, 140.0, 0.9);
    float rr = 0.32 + 0.12 * pb.w, dome = 1.0 - smoothstep(0.0, rr, pb.x), peb = smoothstep(0.0, 0.15, dome) * msLod(0.007);
    vec3 pcol = mix(vec3(0.42, 0.38, 0.33), vec3(0.7, 0.66, 0.6), pb.z) * mix(vec3(1.0), vec3(0.6, 0.55, 0.5), step(0.85, pb.w));
    col = mix(col, pcol, peb); h = mix(h * 0.6, 0.55 + 0.45 * sqrt(dome), peb); r = mix(r, 0.75, peb);
    ao = 1.0 - 0.45 * (1.0 - peb) * msLod(0.007);
  } else if (V > 1.5 && V < 2.5) {
    // roughcast / scraped texture: a raised, torn crust
    float cr = msFbm(u + 6.0, 45.0, 4);
    float crust = smoothstep(-0.1, 0.3, cr);
    h = 0.35 + 0.5 * crust + 0.05 * fine; col *= 0.9 + 0.14 * crust; r = msA.a + 0.06 * (1.0 - crust);
    ao = 0.7 + 0.3 * crust;
  }
  // cracks (shrinkage map and a few long settlement cracks) and repairs in another tone
  if (msB.y > 0.0) {
    vec4 ck = msCell(u + 0.02 * vec2(msFbm(u, 14.0, 2), msFbm(u + 1.0, 14.0, 2)), 2.2, 1.0);
    float cs = msT / msP(2.2);
    float crack = msLine((ck.y - ck.x) * cs * 0.5, 0.0006 + 0.0012 * (msFbm(u, 5.0, 2) * 0.5 + 0.5)) * smoothstep(0.55 - 0.5 * msB.y, 0.75 - 0.5 * msB.y, msFbm(u + 9.0, 1.1, 2) * 0.5 + 0.5);
    col *= 1.0 - 0.6 * crack; h -= 0.25 * crack; ao *= 1.0 - 0.4 * crack;
  }
  if (msB.z > 0.0) {
    float pn = msFbm(u + 12.0, 0.9, 4) * 0.5 + 0.5;
    float pt = smoothstep(1.0 - 0.45 * msB.z, 1.02 - 0.45 * msB.z, pn);
    float pr = msLine(pn - (1.0 - 0.45 * msB.z), 0.004);
    col = mix(col, msC.rgb * (0.95 + 0.08 * m2), pt); col *= 1.0 - 0.15 * pr; h += 0.06 * pt + 0.04 * pr; r = mix(r, msA.a - 0.06, pt);
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: glaze rgb, roughness   B: tile w, tile h, grout w, bevel   C: grout rgb, alt share   D: alt rgb, crazing
  tile: /* glsl */ `
MsS ms_tile(vec2 u){
  float V = msX.z;
  vec4 g = msGrid(u, msB.xy, V < 0.5 ? 0.5 : 0.0);
  vec2 s = msCellSize, q = g.xy, c = q / s - 0.5;
  float de = msEdgeD(g), gw = msB.z * 0.5;
  vec3 t = msCH(g.zw, 1.0), t2 = msCH(g.zw, 5.0);
  bool alt = V > 2.5 ? mod(g.z + g.w, 2.0) > 0.5 : t.x < msC.a;
  vec3 glaze = (alt ? msD.rgb : msA.rgb) * (0.94 + 0.1 * t.y);
  if (V > 1.5 && V < 2.5) glaze *= 0.8 + 0.4 * t.z;   // mosaic: every chip its own shade
  // no tile is flat: each sits at its own tilt with a slight dish, so reflections break tile to tile
  float bev = msB.w;
  float edge = smoothstep(gw, gw + max(bev, 0.0008), de);
  float h = 0.55 * sqrt(edge) + 0.3 + dot(c, t2.xy - 0.5) * 0.08 - dot(c, c) * 0.05;
  float r = msA.a + 0.03 * msFbm(u, 25.0, 2);
  if (V > 2.5) { r = msA.a; h += 0.02 * msFbm(u, 160.0, 2); }   // floor tiles: matte, a fine grit
  // crazing in old glaze
  if (msD.a > 0.0) {
    vec4 cz = msCell(u + t.xy, 30.0, 1.0);
    float craze = msLine((cz.y - cz.x) * msT / msP(30.0) * 0.5, 0.00025) * msD.a * msLod(0.01);
    glaze *= 1.0 - 0.25 * craze; r += 0.15 * craze;
  }
  float grout = 1.0 - smoothstep(gw - 0.4 * msFP, gw + msFP, de);
  vec3 gc = msC.rgb * (0.85 + 0.25 * (msFbm(u + 3.0, 80.0, 2) * 0.5 + 0.5));
  vec3 col = mix(glaze, gc, grout);
  r = mix(r, 0.92, grout); h = mix(h, 0.12, grout);
  float ao = 1.0 - 0.45 * grout - 0.15 * (1.0 - edge) * (1.0 - grout);
  return MsS(col, clamp(r, 0.03, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: paint rgb, roughness   B: pitch, sheet width, fixing spacing, profile (0 sine, 1 box)   C: rust amount, chips, white rust, -
  corrugated: /* glsl */ `
MsS ms_corrugated(vec2 u){
  float V = msX.z;
  float pitch = msSnap(msB.x), x = u.x / pitch, fx = fract(x);
  float prof = msB.w < 0.5 ? 0.5 + 0.5 * cos(2.0 * MS_PI * fx) : smoothstep(0.18, 0.32, abs(fx - 0.5)) ;
  float crest = smoothstep(0.75, 1.0, prof);
  float sw = msSnap(msB.y);
  float lap = msLine(u.x - floor(u.x / sw + 0.5) * sw, 0.0015);
  float fsp = msSnap(msB.z);
  vec2 fq = vec2((fract(x) - 0.0) * pitch, mod(u.y, fsp) - 0.5 * fsp);
  float fix = (1.0 - smoothstep(0.006, 0.0075 + msFP, length(vec2(min(fq.x, pitch - fq.x), fq.y)))) * step(0.5, mod(floor(x), 2.0));
  float m1 = msFbm(u, 0.8, 3), m2 = msFbm(u + 2.0, 5.0, 3), fine = msFbm(u + 3.0, 150.0, 2);
  // runs from each fixing downward and along the valleys
  float run = (1.0 - smoothstep(0.003, 0.012, min(fq.x, pitch - fq.x))) * step(0.5, mod(floor(x), 2.0)) * step(fq.y, -0.006)
            * (1.0 - smoothstep(0.0, 0.08 + 0.35 * (msFbm(vec2(u.x, 0.0) * 3.0, 9.0, 2) * 0.5 + 0.5), -fq.y));
  float valley = 1.0 - smoothstep(0.0, 0.3, prof);
  vec3 col; float r, met = 0.0;
  float rn = msFbm(u + 5.0, 3.5, 4) * 0.5 + 0.5 + 0.15 * valley;
  if (V < 0.5) {
    // galvanised: spangle cells, white rust in the valleys and under the fixings
    vec4 sp = msCell(u, 55.0, 1.0);
    col = vec3(0.64, 0.66, 0.68) * (0.82 + 0.24 * sp.z) * (0.95 + 0.06 * m1);
    r = 0.32 + 0.22 * sp.w + 0.05 * m2;
    met = 1.0;
    float wr = smoothstep(0.7 - 0.4 * msC.z, 0.78 - 0.4 * msC.z, rn + 0.4 * run);
    col = mix(col, vec3(0.58, 0.58, 0.55) * (0.85 + 0.2 * fine), wr); r = mix(r, 0.9, wr); met *= 1.0 - wr;
    float rs = smoothstep(0.86 - 0.35 * msC.x, 0.9 - 0.35 * msC.x, rn + 0.5 * run);
    col = mix(col, msRustCol(m2 * 0.5 + 0.5), rs); r = mix(r, 0.9, rs); met *= 1.0 - rs;
  } else if (V < 1.5) {
    // painted: the film wears through on the crests first (to zinc), rust where the zinc has gone
    col = msA.rgb * (0.94 + 0.06 * m1 + 0.04 * m2);
    r = msA.a + 0.04 * fine;
    float wn = msFbm(u + 9.0, 9.0, 3) * 0.45 + msFbm(u + 2.0, 40.0, 2) * 0.12 + 0.5 + 0.12 * crest + 0.2 * lap;
    float L = msLayers(wn, msC.y);
    float zinc = clamp(L - 1.0, 0.0, 1.0);
    col = mix(col, col * 1.12, clamp(L, 0.0, 1.0) * (1.0 - zinc));
    col = mix(col, vec3(0.6, 0.62, 0.64), zinc); r = mix(r, 0.45, zinc); met = zinc;
    float rs = clamp(smoothstep(0.82 - 0.4 * msC.x, 0.88 - 0.4 * msC.x, rn) + run * msC.x + clamp(L - 2.0, 0.0, 1.0) * msC.x, 0.0, 1.0);
    col = mix(col, msRustCol(m2 * 0.5 + 0.5), rs); r = mix(r, 0.88, rs); met *= 1.0 - rs;
  } else {
    // rusted through: scale and pitting, a ghost of the paint in places
    float scale_ = msFbm(u + 1.0, 40.0, 3);
    col = msRustCol(0.45 + 0.4 * m2 + 0.2 * scale_) * (0.9 + 0.15 * m1);
    col = mix(col, vec3(0.06, 0.035, 0.025), smoothstep(0.3, 0.6, scale_) * 0.5);
    float ghost = smoothstep(0.55, 0.6, msFbm(u + 7.0, 2.0, 3) * 0.5 + 0.5);
    col = mix(col, msA.rgb * 0.7, ghost * 0.85); r = mix(0.86 + 0.06 * scale_, 0.7, ghost);
  }
  float h = prof * 0.9 + 0.05 * fine + 0.06 * fix;
  col *= 1.0 - 0.35 * lap;
  col = mix(col, vec3(0.5, 0.5, 0.52), fix * 0.6);
  float ao = 1.0 - 0.25 * valley - 0.3 * lap;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, ao);
}`,

  // A: paint rgb, roughness   B: primer rgb, chips   C: panel w, panel h, bolt spacing, rust   D: streaks, gloss, -, -
  paintedMetal: /* glsl */ `
MsS ms_paintedMetal(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 0.8, 2), m2 = msFbm(u + 2.0, 5.0, 3);
  float peel = msFbm(u + 5.0, 260.0, 2) * msLod(0.006);           // orange peel: the film's own micro relief
  float seam = 0.0, bolt = 0.0, near = 0.0, drip = 0.0;
  if (V > 0.5 && V < 1.5) {
    // panels joined at seams, a bolt row along each panel's top and bottom
    vec4 g = msGrid(u, msC.xy, 0.0); vec2 s = msCellSize, q = g.xy;
    seam = msLine(msEdgeD(g), 0.0012);
    float sp = s.x / max(1.0, floor(s.x / msC.z + 0.5));
    float bx = mod(q.x, sp) - 0.5 * sp;
    float by = min(abs(q.y - 0.035), abs(q.y - (s.y - 0.035)));
    float d = length(vec2(bx, by));
    bolt = 1.0 - smoothstep(0.0085, 0.0095 + msFP, d);
    near = (1.0 - smoothstep(0.01, 0.03 + 0.05 * (msFbm(u + 3.3, 30.0, 2) * 0.5 + 0.5), d)) * step(0.35, bh0(g.zw + floor(q.x / sp) * 0.137));
    vec3 bh = msCH(g.zw + floor(q.x / sp) * 0.137, 3.0);
    float below = (s.y - 0.035) - q.y;
    drip = (1.0 - smoothstep(0.002, 0.007 + 0.006 * bh.y, abs(bx + 0.003 * m2))) * step(0.012, below) * (1.0 - smoothstep(0.0, 0.08 + 0.5 * bh.x, below)) * step(0.4, bh.z);
  }
  // wear: a chip field (layered: paint -> lifted edge -> primer -> bare steel), more round fixings
  float wn = msFbm(u + 11.0, 6.0, 4) * 0.42 + msFbm(u + 3.0, 32.0, 3) * 0.12 + 0.5 + 0.35 * near;
  float amt = msB.a * (V > 1.5 ? 0.35 : 1.0);
  float L = msLayers(wn, amt);
  float lip = clamp(L, 0.0, 1.0) * (1.0 - clamp(L - 1.0, 0.0, 1.0));
  float primer = clamp(L - 1.0, 0.0, 1.0) * (1.0 - clamp(L - 2.0, 0.0, 1.0));
  float bare = clamp(L - 2.0, 0.0, 1.0);
  // rust: it grows out of the bare steel and the fixings into patches of its own (blistering the paint round them),
  // and what washes off it runs down the sheet (gravity: along -v, from the rust above)
  float rk = msC.a;
  // the rust field: patchy at every scale (a 25 cm cluster, 4 cm pits, 1 cm speckle) and drawn out downward
  float rfine = msFbm(u + 1.0, 90.0, 3);
  float rf = 0.5 + 0.5 * (0.45 * msFbm(u + 7.0, 3.0, 4) + 0.3 * msFbm(u + 2.0, 16.0, 3) + 0.15 * rfine + 0.2 * msFbm2(u + 5.0, vec2(22.0, 1.6), 3));
  float rp = smoothstep(0.72 - 0.3 * rk, 0.76 - 0.3 * rk, rf) * step(0.01, rk);
  float rust = clamp(max(bare * (0.4 + 0.6 * rk) * smoothstep(0.3, 0.6, rf + 0.25), rp) + drip * rk * 0.9 + near * rk * 0.5 * smoothstep(0.4, 0.7, rf), 0.0, 1.0);
  float blister = smoothstep(0.66 - 0.3 * rk, 0.72 - 0.3 * rk, rf) * (1.0 - rust);
  float above = max(smoothstep(0.7 - 0.4 * rk, 0.85 - 0.4 * rk, msFbm(u + vec2(7.0, 7.06), 3.0, 3) * 0.5 + 0.5), smoothstep(0.7 - 0.4 * rk, 0.85 - 0.4 * rk, msFbm(u + vec2(7.0, 7.18), 3.0, 3) * 0.5 + 0.5));
  float runs = smoothstep(0.45, 0.85, msFbm2(u + 4.0, vec2(16.0, 0.9), 3) * 0.5 + 0.5) * above * (0.4 + 0.6 * msD.x) * (1.0 - rust);
  vec3 rc = msRustCol(0.25 + 0.7 * (msFbm(u + 2.0, 25.0, 3) * 0.5 + 0.5)) * (0.85 + 0.3 * rfine);
  vec3 col = msA.rgb * (0.96 + 0.05 * m1 + 0.03 * m2);
  col = mix(col, col * 1.1, lip);
  col = mix(col, msB.rgb * (0.92 + 0.1 * m2), primer * (1.0 - smoothstep(0.3, 0.9, rk)));
  col = mix(col, vec3(0.53, 0.53, 0.54) * (0.9 + 0.12 * rf), bare);
  col = mix(col, mix(col, msRustCol(0.55), 0.55), runs * rk);
  float halo = smoothstep(0.5 - 0.3 * rk, 0.72 - 0.3 * rk, rf) * (1.0 - rust) * rk;
  col = mix(col, col * vec3(0.9, 0.8, 0.7), blister * 0.6);
  col = mix(col, mix(col, msRustCol(0.7), 0.5), halo * (0.5 + 0.5 * rfine));
  col = mix(col, rc, rust);
  col = mix(col, msA.rgb * 0.8, bolt * 0.6);
  col *= 1.0 - 0.45 * seam;
  float r = msA.a - 0.2 * msD.y + 0.05 * peel;
  r = mix(r, 0.7, primer); r = mix(r, 0.42, bare); r = mix(r, 0.6 + 0.2 * runs, runs * rk); r = mix(r, 0.88 + 0.08 * rfine, rust);
  float met = bare * (1.0 - rust);
  float h = 0.55 + 0.03 * peel + 0.04 * lip - 0.1 * clamp(L - 1.0, 0.0, 1.0) - 0.06 * bare + rust * (0.12 + 0.12 * rfine + 0.1 * rf) + 0.06 * blister - 0.35 * seam + 0.3 * bolt;
  float ao = 1.0 - 0.35 * seam - 0.15 * rust * (0.5 - 0.5 * rfine);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, ao);
}`,

  // A: F0 rgb, roughness   B: grain length, scratch density, polish swirls, -   (metal 1)
  stainless: /* glsl */ `
MsS ms_stainless(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 1.2, 2);
  vec3 col = msA.rgb * (0.97 + 0.04 * m1);
  float r = msA.a, h = 0.5;
  if (V < 0.5) {
    // brushed: many parallel hairlines of random length along the grain (u), a few deeper ones
    float hair = msFbm2(u, vec2(3.0 / msB.x, 1400.0), 3);
    float deep = msFbm2(u + 3.0, vec2(1.0 / msB.x, 260.0), 2);
    float k = msLod(0.0015);
    h = 0.5 + 0.3 * hair * k + 0.15 * deep;
    r = msA.a * (0.8 + 0.5 * (hair * 0.5 + 0.5) * k + 0.2 * (deep * 0.5 + 0.5));
    col *= 0.96 + 0.06 * hair * k;
  } else if (V < 1.5) {
    // polished: near mirror, polishing swirls only
    vec4 sw = msCell(u, 9.0, 1.0);
    float swirl = msLine(fract(sw.x * 6.0) - 0.5, 0.06) * msB.z * msLod(0.01);
    r = msA.a + 0.06 * swirl; h = 0.5 + 0.05 * swirl;
  } else {
    // bead-blasted: a dense isotropic micro dimpling, satin
    float d = msFbm(u, 500.0, 2) * msLod(0.002);
    h = 0.5 + 0.3 * d; r = msA.a + 0.05 * d;
  }
  // sparse cross scratches (any direction), brighter and smoother
  vec4 sc = msCell(u + 1.0, 4.0, 1.0);
  float ang = sc.z * MS_PI;
  vec2 dir = vec2(cos(ang), sin(ang));
  float sd = abs(dot(u - (floor(u * msP(4.0) / msT) + 0.5) * msT / msP(4.0), vec2(-dir.y, dir.x)));
  float scr = msLine(sd, 0.00012) * step(1.0 - msB.y, sc.w) * msLod(0.0008);
  r = mix(r, msA.a * 0.5, scr); h -= 0.2 * scr;
  return MsS(col, clamp(r, 0.03, 1.0), clamp(h, 0.0, 1.0), 1.0, 1.0);
}`,

  // A: F0 rgb, roughness   B: spangle size (m), white rust, -, -
  galvanised: /* glsl */ `
MsS ms_galvanised(vec2 u){
  float V = msX.z;
  // spangle: zinc crystals 5..25 mm, each reflecting a little apart (brightness, roughness, a tilt)
  vec4 sp = msCell(u + 0.004 * vec2(msFbm(u, 60.0, 2), msFbm(u + 1.0, 60.0, 2)), 1.0 / msB.x, 1.0);
  float k = msLod(msB.x);
  float dend = msFbm(u + sp.zw * 9.0, 300.0, 2) * msLod(0.002);
  vec3 col = msA.rgb * mix(1.0, 0.82 + 0.3 * sp.z, k) * (0.97 + 0.04 * dend);
  float r = msA.a + mix(0.0, 0.25 * (sp.w - 0.5), k) + 0.04 * dend;
  float h = 0.5 + 0.2 * (sp.z - 0.5) * k + 0.25 * msLine((sp.y - sp.x) * msB.x * 0.5, 0.0002) * k + 0.05 * dend;
  float met = 1.0;
  float m1 = msFbm(u, 1.5, 3), m2 = msFbm(u + 4.0, 11.0, 3);
  if (V > 0.5) {
    // weathered: the zinc dulls to a grey carbonate patina, white rust gathers in spots
    float pat = smoothstep(-0.3, 0.4, m1);
    col = mix(col, vec3(0.42, 0.43, 0.44), pat * 0.7); r = mix(r, 0.62, pat);
  }
  float wr = smoothstep(0.75 - 0.35 * msB.y, 0.8 - 0.35 * msB.y, m2 * 0.5 + 0.5 + 0.25 * m1);
  col = mix(col, vec3(0.62, 0.62, 0.6) * (0.85 + 0.2 * m2), wr); r = mix(r, 0.92, wr); met = 1.0 - wr;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, 1.0);
}`,

  // A: iron F0 rgb, roughness of the worn tops   B: rust rgb, rust   C: cover diameter, bar pitch, -, -
  castIron: /* glsl */ `
MsS ms_castIron(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 3.0, 3), sand = msFbm(u + 2.0, 220.0, 2) * msLod(0.004), m2 = msFbm(u + 6.0, 14.0, 3);
  float raised = 1.0, recess = 0.0, hole = 0.0;
  if (V < 0.5) {
    // manhole cover: a disc in its frame, a raised diamond tread inside, a lettered ring, two lifting slots
    vec2 c = u - 0.5 * msT; float rr = length(c), R = 0.5 * msC.x;
    float rim = msLine(rr - R, 0.004);
    float pitch = msC.y;
    vec2 d = abs(fract(vec2(c.x + c.y, c.x - c.y) / (pitch * 1.4142)) - 0.5);
    float dia = smoothstep(0.32, 0.3, max(d.x, d.y));
    float ring = step(R * 0.72, rr) * step(rr, R * 0.86);
    float glyph = step(0.5, msVal2(vec2(atan(c.y, c.x) * R * 3.0, rr * 4.0), vec2(40.0, 12.0)));
    raised = rr < R * 0.72 ? dia : (ring > 0.5 ? glyph * 0.8 + 0.2 : 1.0);
    vec2 slot = abs(c - vec2(R * 0.5, 0.0)) - vec2(0.018, 0.006);
    hole = (1.0 - step(0.0, max(slot.x, slot.y))) + (1.0 - step(0.0, max(abs(c.x + R * 0.5) - 0.018, abs(c.y) - 0.006)));
    raised *= 1.0 - rim;
    if (rr > R + 0.006) raised = 0.8 + 0.2 * m2;   // the frame
  } else if (V > 1.5) {
    // grate: bars along u, open slots between
    float pitch = msSnap(msC.y), fy = fract(u.y / pitch);
    float bar = smoothstep(0.08, 0.12, fy) * (1.0 - smoothstep(0.55, 0.59, fy));
    hole = 1.0 - bar; raised = bar;
  } else {
    raised = 0.85 + 0.15 * m1;
  }
  recess = 1.0 - raised;
  float rust = clamp(msB.a * (smoothstep(0.2, 0.7, recess + 0.3 * m2) + 0.25 * (m1 * 0.5 + 0.5)), 0.0, 1.0);
  vec3 bare = msA.rgb * (0.85 + 0.15 * sand);
  vec3 dirt = mix(vec3(0.04, 0.035, 0.03), msB.rgb, rust);
  float wornTop = smoothstep(0.6, 0.95, raised);
  vec3 col = mix(dirt * (0.8 + 0.3 * sand), bare, wornTop * (1.0 - 0.6 * rust * (1.0 - wornTop)));
  float met = wornTop * (1.0 - 0.7 * rust * (1.0 - wornTop));
  float r = mix(0.88 + 0.05 * sand, msA.a + 0.08 * sand, wornTop);
  float h = 0.25 + 0.6 * raised + 0.04 * sand;
  float ao = 1.0 - 0.5 * recess;
  col = mix(col, vec3(0.006), clamp(hole, 0.0, 1.0)); h = mix(h, 0.0, clamp(hole, 0.0, 1.0)); ao *= 1.0 - 0.9 * clamp(hole, 0.0, 1.0); met *= 1.0 - clamp(hole, 0.0, 1.0);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, ao);
}`,

  // A: F0 rgb (tint for anodised), roughness   B: tread pitch, oxide, -, -
  aluminium: /* glsl */ `
MsS ms_aluminium(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 1.5, 2), fine = msFbm(u + 3.0, 300.0, 2) * msLod(0.003);
  vec3 col = msA.rgb * (0.97 + 0.03 * m1);
  float r = msA.a + 0.03 * fine, h = 0.5 + 0.1 * fine, ao = 1.0, met = 1.0;
  if (V > 0.5 && V < 1.5) {
    // extruded: die lines along the length (u)
    float die = msFbm2(u, vec2(0.6, 900.0), 3) * msLod(0.0012);
    h = 0.5 + 0.25 * die; r = msA.a * (0.85 + 0.35 * (die * 0.5 + 0.5));
  } else if (V > 1.5 && V < 2.5) {
    // tread plate: raised lozenges in a herringbone, tops polished by boots, grime between
    float p = msSnap(msB.x);
    vec2 q = u / p, id = floor(q), f = fract(q) - 0.5;
    float a = mod(id.x + id.y, 2.0) < 0.5 ? 0.785 : -0.785;
    vec2 rf = mat2(cos(a), -sin(a), sin(a), cos(a)) * f;
    float loz = 1.0 - smoothstep(0.0, 0.06, length(max(abs(rf) - vec2(0.3, 0.03), 0.0)) * p - 0.0005);
    h = 0.3 + 0.6 * loz + 0.04 * fine;
    r = mix(0.5 + 0.1 * m1, msA.a * 0.7, loz);
    ao = 1.0 - 0.35 * (1.0 - loz);
  } else if (V > 2.5) {
    // cast / bead-blast: dull, fine pitting
    float d = msFbm(u, 400.0, 2) * msLod(0.002);
    r = 0.5 + 0.08 * d; h = 0.5 + 0.3 * d;
  }
  // oxide: grey bloom where it has weathered
  float ox = smoothstep(0.6 - 0.4 * msB.y, 0.7 - 0.4 * msB.y, msFbm(u + 5.0, 3.0, 3) * 0.5 + 0.5);
  ox = step(0.5, ox);
  col = mix(col, vec3(0.5, 0.5, 0.5), ox * 0.6); r = mix(r, 0.75, ox); met = 1.0 - ox;
  return MsS(col, clamp(r, 0.03, 1.0), clamp(h, 0.0, 1.0), met, ao);
}`,

  // A: F0 rgb, roughness   B: pitting, water spots, -, -
  chrome: /* glsl */ `
MsS ms_chrome(vec2 u){
  vec3 col = msA.rgb; float r = msA.a, h = 0.5, met = 1.0;
  vec4 sp = msCell(u, 70.0, 1.0);
  float spot = (1.0 - smoothstep(0.25, 0.42, sp.x)) * step(1.0 - 0.5 * msB.y, sp.z) * msLod(0.008);
  float ring = msLine(sp.x - 0.4, 0.04) * step(1.0 - 0.5 * msB.y, sp.z) * msLod(0.008);
  r += 0.12 * spot + 0.08 * ring; col *= 1.0 - 0.06 * ring;
  vec4 pt = msCell(u + 3.0, 240.0, 1.0);
  float pit = (1.0 - smoothstep(0.1, 0.22, pt.x)) * step(1.0 - 0.25 * msB.x, pt.z) * msLod(0.003);
  col = mix(col, msRustCol(pt.w), pit); r = mix(r, 0.85, pit); met = 1.0 - pit; h -= 0.3 * pit;
  return MsS(col, clamp(r, 0.02, 1.0), clamp(h, 0.0, 1.0), met, 1.0);
}`,

  // A: F0 rgb, roughness   B: tarnish rgb, tarnish   (variant 0 machined, 1 cast, 2 worn)
  metal: /* glsl */ `
MsS ms_metal(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 2.0, 3), fine = msFbm(u + 1.0, 250.0, 2) * msLod(0.004);
  vec3 col = msA.rgb; float r = msA.a, h = 0.5;
  if (V < 0.5) { float lathe = msFbm2(u, vec2(0.5, 700.0), 2) * msLod(0.0015); h += 0.25 * lathe; r *= 0.85 + 0.3 * (lathe * 0.5 + 0.5); }
  else if (V < 1.5) { h += 0.3 * fine; r += 0.12 + 0.05 * fine; }
  else { r += 0.08 * m1; h += 0.1 * fine; }
  float tn = smoothstep(0.55 - 0.45 * msB.a, 0.75 - 0.45 * msB.a, msFbm(u + 5.0, 4.0, 3) * 0.5 + 0.5);
  col = mix(col, col * msB.rgb, tn); r = mix(r, r + 0.2, tn);
  return MsS(col, clamp(r, 0.03, 1.0), clamp(h, 0.0, 1.0), 1.0, 1.0);
}`,

  // A: colour rgb, roughness   B: peel scale (m), texture, -, -
  powderCoat: /* glsl */ `
MsS ms_powderCoat(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 1.0, 2), fine = msFbm(u + 2.0, 180.0, 2) * msLod(0.004);
  vec3 col = msA.rgb * (0.97 + 0.04 * m1);
  float r = msA.a, h = 0.5;
  if (V < 0.5) {
    // powder coat: orange peel, a slow wave a few mm long
    float op = msFbm(u, 1.0 / msB.x, 3) * msLod(msB.x * 0.5);
    h = 0.5 + 0.35 * op; r += 0.04 * fine;
  } else if (V < 1.5) {
    // matte ceramic coating (gun parts): a fine satin grain and a faint mottle
    h = 0.5 + 0.3 * fine; r += 0.05 * fine; col *= 0.97 + 0.05 * msFbm(u + 3.0, 12.0, 2);
  } else {
    // wrinkle / texture finish: a crinkled skin
    vec4 w = msCell(u, 1.0 / msB.x, 1.0);
    float wr = smoothstep(0.0, 0.3, w.y - w.x) * msLod(msB.x);
    h = 0.3 + 0.5 * wr; r += 0.08 * (1.0 - wr); col *= 0.92 + 0.1 * wr;
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, 1.0);
}`,

  // A: colour rgb, flake share   B: flake F0 rgb, flake size   C: swirl marks, -, -, -     (physical: clearcoat)
  carPaint: /* glsl */ `
MsS ms_carPaint(vec2 u){
  float V = msX.z;
  vec3 col = msA.rgb; float r = V > 2.5 ? 0.48 : 0.42, met = 0.0, h = 0.5;
  if (V > 0.5 && V < 2.5) {
    // metallic flakes: aluminium platelets in the base coat, each tilted its own way (a facet per cell)
    vec4 fl = msCell(u, 1.0 / msB.a, 1.0);
    float on = step(1.0 - msA.a, fl.z), k = msLod(msB.a);
    vec2 tilt = (vec2(fl.w, fract(fl.z * 13.7)) - 0.5);
    vec2 cs = vec2(msT / msP(1.0 / msB.a));
    vec2 lp = u - (floor(u / cs) + 0.5) * cs;
    h = 0.5 + on * k * dot(lp, tilt) / msB.a * 0.8;
    met = mix(msA.a, on, k);                              // a sub-pixel mixture at range: the platelets' share
    vec3 tint = msA.rgb / max(max(msA.r, max(msA.g, msA.b)), 1e-3);
    col = mix(col, msB.rgb * mix(vec3(1.0), tint, 0.75), met);
    r = mix(0.4, mix(0.42, 0.12, on), k);
  }
  // swirl marks from washing: fine arcs in the clear coat (in the base roughness here)
  float sw = msC.x * msLine(fract(msCell(u, 3.0, 1.0).x * 9.0) - 0.5, 0.05) * msLod(0.003);
  r += 0.05 * sw;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, 1.0);
}`,

  // A: tint rgb, opacity   B: dirt rgb, dirt   C: wire pitch, -, -, -      (transparent; alpha from msAlpha)
  glass: /* glsl */ `
float msAlpha = 0.1;
MsS ms_glass(vec2 u){
  float V = msX.z;
  vec3 col = msA.rgb; float r = 0.02, h = 0.5, met = 0.0;
  msAlpha = msA.a;
  float m1 = msFbm(u, 1.6, 3), fine = msFbm(u + 2.0, 90.0, 2);
  if (V > 1.5 && V < 2.5) { h = 0.5 + 0.4 * msFbm(u, 400.0, 2) * msLod(0.002); r = 0.3; msAlpha = max(msAlpha, 0.45); col = vec3(0.7) * 50.0; }
  if (V > 2.5 && V < 3.5) {
    float p = msSnap(msC.x);
    vec2 f = abs(fract(u / p) - 0.5) * p;
    float wire = msLine(min(f.x, f.y) - 0.5 * p + 0.0004, 0.0004) * msLod(0.003);
    col = mix(col, vec3(0.3, 0.3, 0.31), wire); met = wire; r = mix(r, 0.35, wire); msAlpha = mix(msAlpha, 1.0, wire);
  }
  // dirt: a film of dust thicker at the bottom of each pane-height band, smears, dried drop rings
  float dirt = msB.a * clamp(0.35 + 0.5 * m1 + 0.25 * fine, 0.0, 1.0);
  if (V > 3.5) {
    // the wiper's sweep: two arcs from pivots on the tile's lower edge, clean inside, a crust at their rim
    vec2 c1 = u - msT * vec2(0.3, 0.0), c2 = u - msT * vec2(0.82, 0.0);
    float R = msT * 0.6, a1 = length(c1), a2 = length(c2);
    float swept = max(1.0 - smoothstep(R - 0.01, R + 0.01, a1), 1.0 - smoothstep(R - 0.01, R + 0.01, a2));
    float lip = max(msLine(a1 - R - 0.01, 0.008), msLine(a2 - R - 0.01, 0.008));
    float arcs = (1.0 - swept) * 0.5 + 0.25 * swept * (0.5 + 0.5 * sin(a1 * 900.0)) * msLod(0.005);
    dirt = msB.a * clamp(0.25 + arcs + 0.6 * lip + 0.3 * m1, 0.0, 1.0);
    // rain streaks: dried runs down the glass
    float runs = smoothstep(0.6, 0.9, msFbm2(u, vec2(30.0, 1.4), 3) * 0.5 + 0.5) * (1.0 - swept);
    dirt = max(dirt, runs * msB.a);
  }
  vec4 dr = msCell(u + 4.0, 45.0, 1.0);
  float drop = msLine(dr.x - 0.28 - 0.1 * dr.w, 0.035) * step(0.55, dr.z) * msLod(0.006) * msB.a;
  dirt = clamp(dirt + 0.6 * drop, 0.0, 1.0);
  col = mix(col * 0.02, msB.rgb, dirt); r = mix(r, 0.75, dirt);
  msAlpha = mix(msAlpha, 0.8, dirt * 0.7);
  return MsS(col, clamp(r, 0.02, 1.0), clamp(h, 0.0, 1.0), met, 1.0);
}`,

  // A: colour rgb, roughness   B: texture size (m), scuffs, chalking, -
  plastic: /* glsl */ `
MsS ms_plastic(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 1.5, 3), fine = msFbm(u + 3.0, 300.0, 2) * msLod(0.003);
  vec3 col = msA.rgb * (0.98 + 0.03 * m1);
  float r = msA.a, h = 0.5;
  if (V < 0.5) {
    // glossy ABS: flow lines from the mould and faint sink marks
    float flow = msFbm2(u, vec2(1.5, 40.0), 2);
    r += 0.03 * flow; h += 0.05 * flow;
  } else if (V < 1.5 || V > 2.5) {
    // moulded texture (spark-eroded): a dense stipple, matte; HDPE (variant 3) waxier
    vec4 st = msCell(u, 1.0 / msB.x, 1.0);
    float bump = (1.0 - smoothstep(0.0, 0.6, st.x)) * msLod(msB.x);
    h = 0.4 + 0.4 * bump; r += 0.05 * (1.0 - bump) - (V > 2.5 ? 0.05 : 0.0);
    if (V > 2.5) col *= 0.97 + 0.06 * msFbm2(u, vec2(6.0, 2.0), 3);   // HDPE swirl from the melt
  } else {
    // diffuser (opal acrylic): milky, faint prismatic texture
    float pr = msFbm(u, 120.0, 2) * msLod(0.006);
    h = 0.5 + 0.2 * pr; r = msA.a + 0.04 * pr;
  }
  // scuffs: short random strokes, whitened and rougher
  vec4 sc = msCell(u + 2.0, 6.0, 1.0);
  float a = sc.z * MS_PI; vec2 cs = vec2(msT / msP(6.0));
  vec2 lp = u - (floor(u / cs) + 0.5) * cs;
  vec2 rl = vec2(dot(lp, vec2(cos(a), sin(a))), dot(lp, vec2(-sin(a), cos(a))));
  float scuff = (1.0 - smoothstep(0.0003, 0.0012, abs(rl.y + 0.002 * sin(rl.x * 60.0)))) * (1.0 - smoothstep(0.02, 0.05 + 0.04 * sc.w, abs(rl.x))) * step(1.0 - msB.y, sc.w) * msLod(0.002);
  col = mix(col, col * 1.25 + 0.04, scuff); r = mix(r, 0.7, scuff);
  // chalking: sun-faded, a powdery bloom
  float ch = msB.z * (0.7 + 0.3 * m1);
  col = mix(col, mix(col, vec3(dot(col, vec3(0.33))) * 1.2 + 0.03, 0.6), ch); r = mix(r, 0.75, ch);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, 1.0);
}`,

  // A: rubber rgb, roughness   B: tread pitch, groove width, bloom, -
  rubber: /* glsl */ `
MsS ms_rubber(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 2.0, 3), fine = msFbm(u + 1.0, 250.0, 2) * msLod(0.004);
  vec3 col = msA.rgb * (0.95 + 0.08 * m1);
  float r = msA.a + 0.04 * fine, h = 0.55 + 0.05 * fine, ao = 1.0;
  if (V < 0.5) {
    // tread: circumferential grooves (along u) and zig-zag lateral sipes between blocks
    float p = msSnap(msB.x);
    float gy = abs(fract(u.y / 0.05) - 0.5) * 0.05;                                   // ribs 50 mm across
    float rib = smoothstep(msB.y * 0.5, msB.y * 0.5 + 0.0015, gy);
    float zz = u.x / p + 0.25 * abs(fract(u.y / 0.025) - 0.5);
    float sipe = msLine((fract(zz) - 0.5) * p, 0.0015) * rib;
    float blk = rib * (1.0 - sipe);
    h = 0.15 + 0.8 * blk + 0.03 * fine;
    r = mix(0.85, msA.a - 0.08, blk);   // the road polishes the block faces
    ao = 0.55 + 0.45 * blk;
  } else if (V < 1.5) {
    // sidewall: fine concentric ribs, moulded lettering blocks, mould vents
    float ribs = sin(u.y * 2.0 * MS_PI / 0.0012) * msLod(0.0015);
    float band = step(0.35, fract(u.y / 0.12)) * step(fract(u.y / 0.12), 0.6);
    vec2 gq = vec2(u.x / 0.018, u.y / 0.024);
    float glyph = band * step(0.55, msVal2(floor(gq) * vec2(0.018, 0.024) + 0.009, vec2(110.0, 80.0))) * step(0.15, fract(gq.x)) * step(fract(gq.x), 0.85);
    h = 0.5 + 0.06 * ribs * (1.0 - band) + 0.35 * glyph;
    r = msA.a - 0.1 * glyph;
  } else if (V > 2.5) {
    // ribbed mat
    float rb = 0.5 + 0.5 * cos(2.0 * MS_PI * u.y / msSnap(0.012));
    h = 0.2 + 0.7 * rb; ao = 0.7 + 0.3 * rb;
  } else {
    // moulded or extruded: faint extrusion lines along u
    h += 0.08 * msFbm2(u, vec2(0.5, 300.0), 2);
  }
  // bloom: the waxy grey film rubber grows as it ages, on exposed faces
  float bl = msB.z * smoothstep(0.3, 0.8, m1 * 0.5 + 0.5 + 0.3 * (h - 0.5));
  col = mix(col, vec3(0.13, 0.13, 0.14), bl * 0.6); r = mix(r, 0.95, bl * 0.5);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: colour rgb, roughness   B: stripe rgb, stripe width (0 none)   C: thread pitch, fuzz, -, -
  fabric: /* glsl */ `
MsS ms_fabric(vec2 u){
  float V = msX.z;
  float p = msSnap(msC.x);
  vec2 q = u / p, c = floor(q), f = fract(q);
  float k = msLod(p);
  // plain weave: warp threads along v, weft along u, over and under in a checker; each thread a slightly different tone
  float over = mod(c.x + c.y, 2.0);
  float warp = sin(MS_PI * f.x) * (0.75 + 0.25 * sin(MS_PI * f.y + MS_PI * over));
  float weft = sin(MS_PI * f.y) * (0.75 + 0.25 * sin(MS_PI * f.x + MS_PI * (1.0 - over)));
  float wh = over > 0.5 ? max(warp, weft * 0.7) : max(weft, warp * 0.7);
  float th = mgHash3(vec3(mod(over > 0.5 ? c.x : c.y + 1000.0, msT / p), 2.0, msSeed)).x;
  float fuzz = msFbm(u, 900.0, 2) * msLod(0.0006) * msC.y;
  float m1 = msFbm(u, 1.2, 3), slub = msFbm2(u, vec2(2.0, 60.0), 2);
  vec3 base = msA.rgb;
  if (msB.a > 0.0) base = mix(msA.rgb, msB.rgb, step(0.5, fract(u.x / (2.0 * msSnap(msB.a)))));
  float slub2 = msFbm2(u + 5.0, vec2(0.8, 25.0), 3), slub3 = msFbm2(u + 9.0, vec2(25.0, 0.8), 3);
  vec3 col = base * (0.9 + 0.08 * m1 + 0.1 * slub + 0.08 * slub2 + 0.08 * slub3) * mix(1.0, 0.8 + 0.28 * wh + 0.1 * (th - 0.5), k);
  // the cloth is never flat: soft creases and puckers at 3..15 cm
  float crease = msFbm(u + 2.0, 9.0, 4);
  float h = mix(0.5, 0.25 + 0.55 * wh, k) * 0.7 + 0.25 * (crease * 0.5 + 0.5) + 0.05 * fuzz + 0.04 * slub;
  float r = msA.a + 0.04 * fuzz;
  float ao = mix(1.0, 0.75 + 0.25 * wh, k);
  if (V > 0.5 && V < 1.5) {
    // tarpaulin: a PVC coat over a coarse scrim: the grid shows faintly through, glossier
    float sp = msSnap(0.004);
    vec2 g = abs(fract(u / sp) - 0.5);
    float grid = (1.0 - smoothstep(0.08, 0.2, min(g.x, g.y))) * msLod(sp);
    h = 0.5 + 0.12 * grid + 0.05 * m1; ao = 1.0 - 0.1 * grid; col = base * (0.95 + 0.06 * m1 + 0.04 * grid);
    r = msA.a + 0.05 * grid;
  } else if (V > 2.5) {
    // nylon ripstop: a reinforcing grid every ~5 mm
    float sp = msSnap(0.005);
    vec2 g = abs(fract(u / sp) - 0.5);
    float grid = (1.0 - smoothstep(0.02, 0.07, min(g.x, g.y))) * msLod(sp);
    h += 0.15 * grid; r -= 0.05 * grid;
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: colour rgb, roughness   B: flute pitch, print, -, -
  paper: /* glsl */ `
MsS ms_paper(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 2.0, 3);
  // fibres: short dark and light strands in all directions
  vec4 fb = msCell(u, 180.0, 1.0);
  float a = fb.z * MS_PI; vec2 cs = vec2(msT / msP(180.0));
  vec2 lp = u - (floor(u / cs) + 0.5) * cs;
  float strand = (1.0 - smoothstep(0.00006, 0.00018, abs(dot(lp, vec2(-sin(a), cos(a)))))) * msLod(0.002);
  float fib = msFbm(u, 400.0, 2) * msLod(0.0015);
  vec3 col = msA.rgb * (0.95 + 0.06 * m1 + 0.05 * fib) * (1.0 + 0.2 * (fb.w - 0.5) * strand);
  float r = msA.a + 0.03 * fib, h = 0.5 + 0.15 * fib + 0.1 * strand, ao = 1.0;
  if (V < 0.5) {
    // kraft board: the flutes under the liner show as soft ridges along u
    float fl = 0.5 + 0.5 * cos(2.0 * MS_PI * u.y / msSnap(msB.x));
    h += 0.12 * fl; col *= 0.97 + 0.04 * fl;
  } else if (V < 1.5) {
    // cut edge of stacked board: liners and the wave of the flute between them, dark voids
    float th = msSnap(0.004), y = fract(u.y / th) * th;
    float liner = step(y, 0.0004) + step(th - 0.0004, y);
    float wave = 0.0004 + (th - 0.0008) * (0.5 + 0.5 * sin(2.0 * MS_PI * u.x / msSnap(msB.x)));
    float flute = msLine(y - wave, 0.00018);
    float solid = clamp(liner + flute, 0.0, 1.0);
    float kk = msLod(0.0008);
    col = mix(col, mix(vec3(0.02), col * 0.85, solid), kk); h = mix(h, 0.2 + 0.6 * solid, kk); ao = mix(1.0, 0.35 + 0.65 * solid, kk);
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: wood rgb, roughness   B: board width, board length, gap, -   C: paint rgb, paint   D: latewood rgb, knots
  wood: /* glsl */ `
MsS ms_wood(vec2 u){
  float V = msX.z;
  // boards: rows across v, staggered butt joints along u (the grain runs along u)
  float bw = msSnap(msB.x), row = floor(u.y / bw), fy = u.y - row * bw;
  float nr = msT / bw;
  vec3 b = mgHash3(vec3(mod(row, nr), 1.0, msSeed));
  float bl = V > 0.5 && V < 1.5 ? msT : msT / max(1.0, floor(msT / msB.y + 0.5));
  float xu = u.x + b.x * bl, seg = floor(xu / bl), fx = xu - seg * bl;
  vec3 bb = mgHash3(vec3(mod(row, nr), mod(seg, msT / bl), msSeed + 3.0));
  if (V > 0.5 && V < 1.5) bb = vec3(0.5, 0.3, 0.5);   // plywood: one sheet
  // growth rings: a flat-sawn board cuts the log off-centre: rings are the distance from the pith (under the
  // board) warped along the grain, so they draw arches; knots bend them
  float pithY = (bb.y - 0.5) * bw * 3.0, pithZ = 0.03 + 0.12 * bb.z;
  vec2 kc = vec2(bl * (0.2 + 0.6 * bb.x), bw * (0.25 + 0.5 * bb.z));
  vec2 kd = vec2(fx, fy) - kc; float kr = length(kd * vec2(0.6, 1.0));
  float knot = step(1.0 - msD.a, bb.x * 0.7 + bb.z * 0.3) * (1.0 - smoothstep(0.004, 0.014, kr));
  float flow = step(1.0 - msD.a, bb.x * 0.7 + bb.z * 0.3) * 0.012 / (kr + 0.01);
  float warp = msFbm2(u + b.yz * 7.0, vec2(0.7, 6.0), 3);
  float d = length(vec2(fy - bw * 0.5 - pithY + 0.006 * warp + flow * sign(kd.y) * 0.004, pithZ + 0.015 * msFbm2(u + 3.0, vec2(0.4, 2.0), 2)));
  float spacing = V > 0.5 && V < 1.5 ? 0.009 : 0.0035 + 0.003 * bb.y;
  float ring = fract(d / spacing);
  float late = smoothstep(0.55, 0.85, ring) * (1.0 - smoothstep(0.92, 1.0, ring));
  float k = msLod(spacing);
  late = mix(0.3, late, k);
  // rays and pores: short dashes along the grain
  float pores = msFbm2(u + b.xz * 5.0, vec2(30.0, 700.0), 2) * msLod(0.001);
  vec3 tone = msA.rgb * (0.78 + 0.4 * bb.z) * mix(vec3(1.0), vec3(1.08, 0.97, 0.88), bb.y) * (0.93 + 0.12 * msFbm2(u + bb.xy * 3.0, vec2(0.6, 4.0), 3));
  vec3 col = mix(tone, tone * msD.rgb * 0.85, late) * (1.0 + 0.12 * pores);
  col = mix(col, tone * msD.rgb * 0.6, knot);
  float r = msA.a + 0.04 * pores - 0.05 * late;
  float h = 0.6 + 0.04 * pores - 0.05 * late;
  float ao = 1.0;
  if (V > 2.5 && V < 3.5) {
    // weathered: silvered, earlywood eroded so the latewood stands proud, checks along the grain
    float lum = dot(col, vec3(0.33));
    col = mix(col, vec3(0.32, 0.31, 0.29) * (lum / max(dot(tone, vec3(0.33)), 1e-3)) * 0.85 + 0.03, 0.8);
    h = 0.4 + 0.35 * late + 0.06 * pores; r = 0.86;
    float check = msLine(fy - bw * (0.3 + 0.4 * bb.x) - 0.004 * warp, 0.0006) * step(0.4, msFbm2(u + b.xy * 4.0, vec2(1.5, 3.0), 2) * 0.5 + 0.5);
    col *= 1.0 - 0.6 * check; h -= 0.3 * check; ao *= 1.0 - 0.5 * check;
  }
  if (V > 4.5) { h += 0.12 * msFbm2(u, vec2(8.0, 90.0), 3); r = max(r, 0.82); }   // rough-sawn
  if (V > 3.5 && V < 4.5) { r = msA.a + 0.03 * pores; }                         // varnished: one smooth film
  // gaps between boards and butt joints
  float gap = msB.z * 0.5;
  float joint = 1.0 - smoothstep(gap, gap + msFP + 0.0004, min(min(fy, bw - fy), V > 0.5 && V < 1.5 ? 1.0 : min(fx, bl - fx)));
  float arris = (1.0 - smoothstep(gap, gap + 0.003, min(fy, bw - fy))) * (1.0 - joint);
  col *= (1.0 - 0.8 * joint) * (1.0 - 0.12 * arris); h = mix(h - 0.1 * arris, 0.0, joint); ao *= 1.0 - 0.7 * joint;
  if (V > 1.5 && V < 2.5) {
    // painted: the film cracks along the grain and flakes, grey wood underneath
    float pn = msFbm2(u + 7.0, vec2(3.0, 18.0), 4) * 0.6 + late * 0.25 + arris * 0.4;
    float bare = smoothstep(0.62 - 0.5 * msC.a, 0.65 - 0.5 * msC.a, pn * 0.5 + 0.5);
    vec3 under = mix(col, vec3(0.3, 0.28, 0.25), 0.6);
    col = mix(msC.rgb * (0.95 + 0.05 * msFbm(u, 4.0, 2)), under, bare);
    r = mix(0.55, 0.85, bare); h = mix(h * 0.6 + 0.3, h - 0.08, bare);
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: culm rgb, roughness   B: diameter / slat width, node spacing, -, -
  bamboo: /* glsl */ `
MsS ms_bamboo(vec2 u){
  float V = msX.z;
  float w = msSnap(msB.x), row = floor(u.y / w), fy = (u.y - row * w) / w;
  float nr = msT / w;
  vec3 b = mgHash3(vec3(mod(row, nr), 4.0, msSeed));
  float ns = msT / max(1.0, floor(msT / msB.y + 0.5));
  float nx = fract(u.x / ns + b.x);
  float node = msLine((nx - 0.5) * ns, 0.003) ;
  float ridge = msLine((nx - 0.5) * ns - 0.006, 0.0015);
  float prof = V < 0.5 ? sqrt(max(1.0 - pow(2.0 * fy - 1.0, 2.0), 0.0)) : smoothstep(0.0, 0.08, fy) * (1.0 - smoothstep(0.92, 1.0, fy));
  float fibre = msFbm2(u + b.yz * 3.0, vec2(3.0, 500.0), 2) * msLod(0.0015);
  vec3 col = msA.rgb * (0.85 + 0.3 * b.y) * (0.94 + 0.06 * fibre) * mix(vec3(1.0), vec3(0.8, 0.82, 0.7), node * 0.8);
  col *= 1.0 - 0.25 * smoothstep(0.3, 0.8, msFbm2(u + b.zx, vec2(2.0, 10.0), 2)) * msW.x;   // dark mottle with age
  float h = 0.15 + 0.75 * prof + 0.08 * ridge + 0.03 * fibre;
  float r = msA.a + 0.06 * fibre + 0.1 * node;
  float ao = 0.5 + 0.5 * smoothstep(0.0, 0.25, prof);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: colour rgb, roughness   B: grain size, pleat width, stitch, -   (0 leather, 1 vinyl seat, 2 suede, 3 cracked)
  leather: /* glsl */ `
MsS ms_leather(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 3.0, 3);
  vec4 gr = msCell(u + 0.002 * vec2(msFbm(u, 40.0, 2), msFbm(u + 1.0, 40.0, 2)), 1.0 / msB.x, 1.0);
  float k = msLod(msB.x);
  float crease = smoothstep(0.0, 0.25, gr.y - gr.x);
  vec3 col = msA.rgb * (0.9 + 0.15 * m1) * mix(1.0, 0.88 + 0.18 * crease, k);
  float h = mix(0.5, 0.3 + 0.5 * crease, k), r = msA.a + mix(0.0, 0.08 * (1.0 - crease), k), ao = mix(1.0, 0.8 + 0.2 * crease, k);
  if (V > 0.5 && V < 1.5) {
    // vinyl seat: a finer embossed grain, channels (pleats) with a stitch line either side
    float pw = msSnap(msB.y), py = fract(u.y / pw);
    float pleat = sin(MS_PI * py);
    float stitch = (msLine((py - 0.04) * pw, 0.0006) + msLine((py - 0.96) * pw, 0.0006)) * step(0.4, fract(u.x / msSnap(0.006)));
    h = 0.2 + 0.6 * pow(pleat, 0.4) + 0.08 * (h - 0.5); ao *= 0.6 + 0.4 * pow(pleat, 0.3);
    col = mix(col, col * 0.7, stitch); h += 0.05 * stitch;
  } else if (V > 1.5 && V < 2.5) {
    // suede: a nap, direction-dependent tone
    float nap = msFbm(u, 600.0, 2) * msLod(0.001);
    col = msA.rgb * (0.85 + 0.2 * msFbm(u, 6.0, 3) + 0.1 * nap); r = 0.95; h = 0.5 + 0.2 * nap;
  } else if (V > 2.5) {
    // aged: the finish cracks in a network, the base shows lighter
    vec4 ck = msCell(u, 70.0, 1.0);
    float crack = msLine((ck.y - ck.x) * msT / msP(70.0) * 0.5, 0.0003) * msLod(0.006);
    col = mix(col, col * 1.5 + 0.03, crack); r += 0.2 * crack; h -= 0.25 * crack;
  }
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: resin tint rgb, roughness   B: tow width, -, -, -   (physical: clearcoat)
  carbonFibre: /* glsl */ `
MsS ms_carbonFibre(vec2 u){
  float w = msSnap(msB.x);
  vec2 q = u / w, c = floor(q), f = fract(q);
  // 2x2 twill: a tow goes over two and under two, shifted one per row
  float over = step(mod(c.x - c.y, 4.0), 1.5);
  float k = msLod(w);
  // across each tow a cylindrical crown; fibres along it as fine lines
  float across = over > 0.5 ? f.y : f.x;
  float crown = sin(MS_PI * across);
  float fib = msFbm2(over > 0.5 ? u : u.yx, vec2(2.0, 2000.0), 2) * msLod(0.0008);
  float h = mix(0.5, 0.3 + 0.5 * crown + 0.08 * fib, k);
  vec3 col = msA.rgb * mix(1.0, 0.8 + 0.4 * crown + 0.15 * (over - 0.5), k);
  vec3 tw = mgHash3(vec3(mod(c, vec2(msT / w)), msSeed));             // each tow a little apart (resin, tension)
  col *= 0.94 + 0.12 * tw.x;
  float r = msA.a + mix(0.0, 0.15 * (1.0 - crown), k) + 0.04 * (tw.y - 0.5);
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, 1.0);
}`,

  // A: glaze rgb, roughness   B: crazing, -, -, -      (0 glazed porcelain, 1 bisque, 2 vitreous enamel)
  ceramic: /* glsl */ `
MsS ms_ceramic(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 4.0, 3), fine = msFbm(u + 2.0, 250.0, 2) * msLod(0.003);
  vec3 col = msA.rgb * (0.96 + 0.06 * m1);
  float r = msA.a, h = 0.5 + 0.06 * m1;
  if (V > 0.5 && V < 1.5) { h += 0.3 * fine; r = max(r, 0.7) + 0.05 * fine; col *= 0.95 + 0.08 * fine; }
  // glaze: thicker in hollows (a darker pool), crazing network
  vec4 cz = msCell(u, 40.0, 1.0);
  float craze = msLine((cz.y - cz.x) * msT / msP(40.0) * 0.5, 0.0002) * msB.x * msLod(0.008) * step(V, 1.5) * (1.0 - step(0.5, V) * step(V, 1.5));
  col *= 1.0 - 0.3 * craze; r += 0.1 * craze;
  vec4 pin = msCell(u + 3.0, 120.0, 1.0);
  float pinhole = (1.0 - smoothstep(0.06, 0.12, pin.x)) * step(0.9, pin.z) * msLod(0.004);
  col *= 1.0 - 0.4 * pinhole; h -= 0.2 * pinhole;
  return MsS(col, clamp(r, 0.02, 1.0), clamp(h, 0.0, 1.0), 0.0, 1.0);
}`,

  // A: colour rgb, roughness   B: roll width, granule size, -, -   (0 mineral felt, 1 EPDM, 2 gravel ballast)
  roofing: /* glsl */ `
MsS ms_roofing(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 0.8, 3), m2 = msFbm(u + 2.0, 6.0, 3);
  float rw = msSnap(msB.x), fy = fract(u.y / rw) * rw;
  float lap = msLine(fy - 0.0, 0.004), bead = (1.0 - smoothstep(0.004, 0.016, fy)) * (1.0 - lap);
  vec3 col; float r, h, ao = 1.0;
  if (V < 0.5) {
    vec4 gr = msCell(u, 1.0 / msB.y, 1.0);
    float dome = 1.0 - smoothstep(0.0, 0.55, gr.x), k = msLod(msB.y);
    col = msA.rgb * mix(1.0, 0.6 + 0.8 * gr.z, k) * (0.92 + 0.1 * m1 + 0.05 * m2);
    h = mix(0.5, 0.25 + 0.6 * dome, k); r = msA.a + mix(0.0, 0.06 * (1.0 - dome), k); ao = mix(1.0, 0.7 + 0.3 * dome, k);
    col = mix(col, vec3(0.025), bead * 0.9); r = mix(r, 0.45, bead); h = mix(h, 0.7, bead);
  } else if (V < 1.5) {
    col = msA.rgb * (0.94 + 0.08 * m1 + 0.04 * m2); r = msA.a + 0.04 * m2; h = 0.5 + 0.05 * m2 + 0.15 * bead;
    col *= 1.0 + 0.15 * bead;
  } else {
    vec4 pb = msCell(u, 40.0, 1.0);
    float dome = sqrt(max(1.0 - pb.x * pb.x * 2.6, 0.0)), k = msLod(0.03);
    col = mix(vec3(0.3, 0.29, 0.27), vec3(0.55, 0.52, 0.48), pb.z) * mix(vec3(1.0), vec3(0.75, 0.68, 0.6), step(0.8, pb.w));
    col = mix(msA.rgb * 3.0 * 0.5, col, k);
    h = mix(0.5, 0.1 + 0.85 * dome, k); r = 0.82 - 0.1 * dome * k; ao = mix(1.0, 0.5 + 0.5 * dome, k);
  }
  col *= 1.0 - 0.4 * lap; h -= 0.2 * lap;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,
};

// ---- emissive and liquid kinds: per-pixel only (they move, or depend on the view), never baked --------------------
// Each writes msEmit (linear radiance, before the lamp gain) next to the usual MsS; mapping as any surface.
export const LIVE_GLSL = {
  // A: colour rgb, intensity   B: on (0..1), tube radius, -, -
  neon: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_neon(vec2 u){
  // the gas column glows brightest along the tube's axis (where the view meets the glass head-on); the glass
  // round it is clear and reflects; the colour stays saturated, a hot core whitens a little
  vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
  float c = abs(dot(V, N));
  float core = pow(c, 3.0), body = smoothstep(0.0, 0.6, c);
  msEmit = msA.rgb * msA.a * msB.x * (0.15 + 0.55 * body + 0.6 * core) + vec3(1.0) * msA.a * msB.x * 0.08 * pow(c, 12.0);
  return MsS(mix(vec3(0.02), msA.rgb * 0.6, msB.x), 0.06, 0.5, 0.0, 1.0);
}`,
  // A: colour rgb, intensity   B: on, end darkening, -, -
  fluorescent: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_fluorescent(vec2 u){
  vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
  float c = abs(dot(V, N));
  // a phosphor coat diffuses the light: almost flat across the tube, a faint bright band, slight lengthwise mottle
  float mott = 1.0 + 0.04 * msFbm(u, 3.0, 2);
  msEmit = msA.rgb * msA.a * msB.x * (0.75 + 0.25 * c) * mott;
  return MsS(vec3(0.82, 0.83, 0.82), 0.25, 0.5, 0.0, 1.0);
}`,
  // A: colour rgb, intensity   B: pixel pitch, diffuser (0 bare .. 1), fill, -   C: content mode, speed, -, -
  ledPanel: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_ledPanel(vec2 u){
  float p = msB.x;
  vec2 q = u / p, c = floor(q), f = fract(q) - 0.5;
  float k = msLod(p);
  float dotm = 1.0 - smoothstep(0.22, 0.3, length(f));
  float lit = mix(msB.z, dotm, k * (1.0 - msB.y));
  // content: 0 solid, 1 a slow noise image, 2 scrolling bars
  vec3 img = msA.rgb;
  if (msC.x > 0.5 && msC.x < 1.5) img *= 0.25 + 0.9 * (mgFbm3(vec3(c * p * 1.5, uTime * 0.2 * msC.y), 3) * 0.5 + 0.5);
  if (msC.x > 1.5) img *= step(0.5, fract(c.y * p * 2.0 - uTime * msC.y));
  msEmit = img * msA.a * lit;
  float louvre = (1.0 - k * (1.0 - msB.y)) * 0.0 + k * (1.0 - msB.y) * (1.0 - dotm);
  return MsS(mix(vec3(0.6), vec3(0.025), louvre * 0.95 + (1.0 - msB.y) * 0.5), mix(0.15, 0.6, 1.0 - msB.y), 0.5 - 0.3 * louvre, 0.0, 1.0);
}`,
  // A: colour rgb, intensity   B: subpixel pitch, -, -, -   C: content mode, speed
  lcd: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_lcd(vec2 u){
  float p = msB.x;
  vec2 q = u / p, c = floor(q), f = fract(q);
  float k = msLod(p / 3.0);
  // RGB stripes inside each pixel, a black matrix between
  float sub = floor(f.x * 3.0), sf = fract(f.x * 3.0);
  vec3 mask = vec3(sub < 0.5 ? 1.0 : 0.0, sub > 0.5 && sub < 1.5 ? 1.0 : 0.0, sub > 1.5 ? 1.0 : 0.0) * 3.0;
  float bm = smoothstep(0.08, 0.16, sf) * (1.0 - smoothstep(0.84, 0.92, sf)) * smoothstep(0.05, 0.1, f.y) * (1.0 - smoothstep(0.9, 0.95, f.y));
  vec3 img = msA.rgb;
  if (msC.x > 0.5 && msC.x < 1.5) img *= 0.2 + (mgFbm3(vec3(c * p * 2.0, uTime * 0.25 * msC.y), 3) * 0.5 + 0.5);
  if (msC.x > 1.5) img *= 0.3 + 0.7 * step(0.5, fract(c.y * p * 4.0 - uTime * msC.y));
  msEmit = img * msA.a * mix(vec3(0.72), mask * bm, k);
  return MsS(vec3(0.01), 0.05, 0.5, 0.0, 1.0);
}`,
  // A: colour rgb, intensity   B: LED row spacing, hotspot, edge falloff, -   (uv mapping: 0..1 across the face)
  lightbox: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_lightbox(vec2 u){
  // backlit acrylic: LED rows behind the face show as soft bright bands; the corners fall off
  float rows = 0.5 + 0.5 * cos(2.0 * MS_PI * u.y / msB.x);
  float bands = 1.0 - msB.y + msB.y * rows * rows;
  vec2 e = min(fract(msUVraw), 1.0 - fract(msUVraw));
  float edge = smoothstep(0.0, msB.z, min(e.x, e.y));
  msEmit = msA.rgb * msA.a * bands * (0.55 + 0.45 * edge);
  return MsS(msA.rgb * 0.7 + 0.1, 0.08, 0.5, 0.0, 1.0);
}`,
  // A: paper rgb, intensity   B: glow rgb, rib spacing   (lit from inside: a translucent washi with ribs)
  paperLantern: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_paperLantern(vec2 u){
  float rib = msLine(fract(u.y / msB.a) - 0.5, 0.05) ;
  float fib = msFbm2(u, vec2(12.0, 35.0), 3), fib2 = msFbm2(u.yx, vec2(20.0, 50.0), 2);
  float t = (0.75 + 0.2 * fib + 0.1 * fib2) * (1.0 - 0.7 * rib);
  vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
  float c = abs(dot(V, N));
  msEmit = msB.rgb * msA.a * t * (0.35 + 0.9 * c * c);
  return MsS(msA.rgb * (0.95 + 0.05 * fib) * (1.0 - 0.5 * rib), 0.85, 0.5 + 0.2 * rib, 0.0, 1.0);
}`,
  // A: bed rgb, -   B: depth (0 film .. 1 standing), ripples, -, -
  water: /* glsl */ `
vec3 msEmit = vec3(0.0);
MsS ms_water(vec2 u){
  // a water surface: near-black body (the bed under it, darkened), a smooth surface with slow wind wavelets
  float t = uTime;
  float w = mgFbm3(vec3(u * 3.0, t * 0.35), 3) * 0.6 + mgFbm3(vec3(u * 11.0 + 3.0, t * 0.8), 2) * 0.4 * msLod(0.03);
  vec3 col = mix(msA.rgb * 0.45, vec3(0.012, 0.014, 0.016), msB.x);
  return MsS(col, 0.03, 0.5 + 0.5 * w * msB.y, 0.0, 1.0);
}`,
  // A: base rgb, -   B: film thickness (nm) min, max, swirl scale, -   (physical: iridescence; the film thickness
  // replaces the iridescenceThicknessMaximum uniform)
  oil: /* glsl */ `
vec3 msEmit = vec3(0.0);
float msOilT = 400.0;
#define iridescenceThicknessMaximum msOilT
MsS ms_oil(vec2 u){
  float s = mgFbm3(vec3(u / msB.z, 0.0), 4) * 0.5 + 0.5;
  float sw = fract(s * 2.2 + 0.25 * mgFbm3(vec3(u / msB.z * 3.0, 1.0), 2));
  msOilT = mix(msB.x, msB.y, sw);
  return MsS(msA.rgb, 0.04, 0.5, 0.0, 1.0);
}`,
};

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

// ---- one recipe per kind -------------------------------------------------------------------------------------------
// Parameter vectors per kind are documented next to each recipe (and packed in surfaces.js). Albedo comes in linear.
export const KIND_GLSL = {
  // A: base rgb, roughness   B: panel w, panel h, tie spacing, board height   C: paint rgb, peel   D: aggregate, pores, cold joint, efflorescence
  concrete: /* glsl */ `
MsS ms_concrete(vec2 u){
  float V = msX.z; vec3 base = msA.rgb;
  float m1 = msFbm(msWarp(u, 1.5, 0.08), 0.8, 4), m2 = msFbm(u + 3.7, 6.0, 3), sand = msFbm(u + 1.3, 120.0, 2);
  // air voids (bug holes): clustered (a slow density field: they gather in bands and patches where the vibration was
  // poor), their sizes spread (most 1..3 mm, a few 5..15 mm), their outlines irregular (a warped distance), a lighter
  // rim of laitance; pin pores below a millimetre everywhere
  float dens = smoothstep(0.25, 0.75, msFbm2(u + 4.4, vec2(1.2, 3.0), 3) * 0.5 + 0.5) * msD.y;
  vec4 pc = msCell(u + 0.008 * vec2(msFbm(u, 60.0, 2), msFbm(u + 2.0, 60.0, 2)), 26.0, 1.0);
  float big = step(0.96, pc.w);
  float pr = mix(0.06 + 0.12 * pc.w * pc.w, 0.22 + 0.2 * fract(pc.w * 17.0), big);
  float on = step(1.0 - (0.05 + 0.6 * dens) * (big > 0.5 ? 1.6 : 1.0), pc.z);
  float pore = (1.0 - smoothstep(pr * 0.65, pr, pc.x)) * on * msLod(0.01);
  float prim = (1.0 - smoothstep(pr, pr * 1.6, pc.x)) * on * msLod(0.02) - pore;
  vec2 pin = msSpeck(u + 8.0, 300.0, 0.08 + 0.2 * dens, 0.4, 1.0);
  pore = max(pore, pin.x * 0.6);
  // fine aggregate showing in the laitance: grains 1.5..5 mm of their own tone
  vec4 ag = msCell(u + 5.1, 160.0, 1.0);
  float agg = msD.x * (1.0 - smoothstep(0.18, 0.34, ag.x)) * step(0.45, ag.z) * msLod(0.005);
  // cloudy laitance: soft darker and paler clouds 10..60 cm, a faint warm / cool drift between them
  float cl = msFbm(u + 6.1, 2.6, 4);
  // water marks: darker tide-edged blotches (the form's release agent and the cure), a few paler bleached ones
  float wm = msFbm(msWarp(u + 2.0, 3.0, 0.05), 1.8, 4);
  float blot = smoothstep(0.15, 0.4, wm) * (0.6 + 0.4 * smoothstep(0.38, 0.42, wm));
  vec3 col = base * (0.86 + 0.32 * m1 + 0.18 * cl + 0.09 * m2 + 0.07 * sand) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), 0.5 + 0.5 * m1) * (1.0 - 0.2 * blot);
  col = mix(col, base * (0.62 + 0.75 * ag.w) * vec3(1.05, 1.0, 0.93), agg * 0.75);
  col *= (1.0 + 0.1 * prim) * (1.0 - 0.5 * pore);
  // relief: the pour's slow waves (the form bowed under the pressure), the sand skin, the voids cut into it
  float bow = msFbm(u + 5.5, 2.0, 3);
  float h = 0.6 + 0.16 * bow + 0.1 * m2 + 0.035 * sand + 0.04 * agg - 0.45 * pore + 0.03 * prim;
  float r = msA.a + 0.04 * m1 + 0.04 * sand + 0.06 * pore - 0.05 * blot;
  float ao = 1.0 - 0.6 * pore;
  if (V < 0.5 || V > 2.5) {
    vec4 g = msGrid(u, msB.xy, 0.0); float de = msEdgeD(g); vec3 ph = msCH(g.zw, 4.0);
    col *= 0.93 + 0.12 * ph.x;                                    // each panel of the pour a shade apart
    h += 0.1 * (ph.y - 0.5) + dot(g.xy / msCellSize - 0.5, ph.zx - 0.5) * 0.08;   // and a little out of plane
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
  // hairline cracks (shrinkage, a few long ones), more with age; dark threads with depth
  {
    vec4 ck = msCell(msWarp(u, 4.0, 0.03) + 1.9, 1.6, 1.0);
    float open_ = smoothstep(0.75 - 0.35 * msW.x, 0.9 - 0.35 * msW.x, msFbm(u + 6.6, 1.0, 3) * 0.5 + 0.5);
    float crack = msLine((ck.y - ck.x) * msT / msP(1.6) * 0.5, 0.0003 + 0.0006 * (msFbm(u, 6.0, 2) * 0.5 + 0.5)) * open_ * msLod(0.002);
    col *= 1.0 - 0.55 * crack; h -= 0.3 * crack; ao *= 1.0 - 0.4 * crack;
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
  // packed crushed aggregate: angular stones (Voronoi cells of a warped plane: flat faces, sharp corners) of three
  // sieve sizes, each its own grey (a few pale quartz, a few brown, a few near black), set in the binder; the binder's
  // level decides how much of each stone shows (fresh: tips only; worn: whole faces, voids between)
  vec2 uw = msWarp(u, 1.0 / (msB.a * 1.4), msB.a * 0.15);
  vec4 st = msCell(uw, 1.0 / msB.a, 1.0), s2 = msCell(uw + 0.37, 1.9 / msB.a, 1.0), s3 = msCell(u + 0.71, 3.6 / msB.a, 1.0);
  float e1 = st.y - st.x, e2 = s2.y - s2.x, e3 = s3.y - s3.x;          // distance to the stone's edge (cells)
  float present = step(0.3, st.z);                                    // not every cell holds a coarse stone
  float top1 = clamp(min(e1 * 2.6, (0.52 - st.x) * 3.2), 0.0, 1.0) * present, top2 = clamp(min(e2 * 2.6, (0.5 - s2.x) * 3.2), 0.0, 1.0), top3 = clamp(min(e3 * 3.0, (0.5 - s3.x) * 3.4), 0.0, 1.0);
  float level = V < 0.5 ? 0.62 : 0.24;
  float stone = smoothstep(level, level + 0.06, top1) * lodS;
  float stone2 = smoothstep(level + 0.12, level + 0.18, top2) * msLod(msB.a / 1.9) * (1.0 - stone);
  float stone3 = smoothstep(level + 0.22, level + 0.3, top3) * msLod(msB.a / 3.6) * (1.0 - stone) * (1.0 - stone2) * step(0.45, s3.z);
  float fines = msFbm(u + 2.0, 160.0, 2), m1 = msFbm(msWarp(u, 1.2, 0.1), 0.9, 4);
  vec2 sand = msSpeck(u + 1.3, 1.2 / msB.a * 4.0, 0.35, 0.4, 2.0);
  // stone tones: a grey ramp by the cell's hash, a few pale, brown or dark ones; faces a little apart (lit unevenly)
  float k1 = st.w, k2 = s2.w;
  vec3 tint1 = k1 > 0.9 ? vec3(1.6, 1.58, 1.52) : k1 > 0.8 ? vec3(1.15, 0.98, 0.82) : k1 < 0.1 ? vec3(0.5) : vec3(1.0);
  vec3 sc = msB.rgb * (0.55 + 0.8 * st.z) * tint1 * (0.92 + 0.12 * fines);
  vec3 sc2 = msB.rgb * (0.5 + 0.8 * s2.z) * (k2 > 0.88 ? vec3(1.4) : vec3(1.0)), sc3 = msB.rgb * (0.6 + 0.6 * s3.w);
  vec3 binder = msA.rgb * (0.85 + 0.14 * fines + 0.12 * m1) * mix(1.0, 1.6 + sand.y, sand.x * 0.6);
  float cov = V < 0.5 ? 0.08 : 0.42;                                  // far: the share of stone the eye averages
  vec3 col = mix(binder, sc, stone);
  col = mix(col, sc2, stone2 * 0.92); col = mix(col, sc3, stone3 * 0.85);
  col = mix(mix(binder, msB.rgb * 0.9, cov), col, lodS);
  col *= 0.88 + 0.22 * (m1 * 0.5 + 0.5);
  float pol = msC.w;                                                  // tyres polish the stone tops
  float r = mix(msA.a + 0.04 * fines, 0.68 - 0.25 * pol * top1 + 0.1 * st.z, stone);
  r = mix(r, 0.74 - 0.2 * pol, stone2); r = mix(r, 0.8, stone3);
  // between exposed stones: voids (worn): darker, deeper
  float voids = V < 0.5 ? 0.0 : (1.0 - smoothstep(0.02, 0.12, max(max(top1, top2), top3 * step(0.45, s3.z)))) * lodS;
  float h = 0.4 + 0.45 * max(top1 - level, 0.0) / (1.0 - level) * stone + 0.3 * max(top2 - level - 0.12, 0.0) * stone2 + 0.15 * stone3
          + 0.04 * fines + 0.03 * sand.x - 0.25 * voids;
  col *= 1.0 - 0.45 * voids;
  float ao = 1.0 - 0.5 * voids;
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
    float fstone = smoothstep(0.62, 0.68, top1) * lodS;
    vec3 fresh = mix(msA.rgb * 0.75 * (0.9 + 0.14 * fines), sc, fstone);
    col = mix(col, fresh, inside); r = mix(r, mix(0.62, 0.7, fstone), inside);
    h = mix(h, 0.45 + 0.3 * max(top1 - 0.62, 0.0) / 0.38 * lodS, inside);
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
  if (V > 2.5) {
    // hexagonal pavers (cell.x = across the flats): a hex lattice snapped to the tile (an even number of rows)
    float nx = max(1.0, floor(msT / msB.x + 0.5)), ny = max(2.0, 2.0 * floor(msT / (msB.x * 0.866) * 0.5 + 0.5));
    vec2 hq = u / vec2(msT / nx, msT / ny) * vec2(1.7320508, 1.5);
    vec2 rr = vec2(1.7320508, 3.0), hh = rr * 0.5;
    vec2 a = mod(hq, rr) - hh, b = mod(hq - hh, rr) - hh;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = mod(floor((hq - gv) / vec2(0.8660254, 1.5) + 0.5), vec2(2.0 * nx, ny));
    float R = 0.5 * (msT / nx / 1.7320508 + msT / ny / 1.5);
    de = (0.8660254 - max(abs(gv.x), dot(abs(gv), vec2(0.5, 0.8660254)))) * R;
    c = gv * R; ph = msCH(id, 2.0); ph2 = msCH(id, 6.0);
    s = vec2(1.7320508 * R);
  }
  float jw = msB.z * 0.5;
  float m1 = msFbm(msWarp(u, 1.2, 0.08), 1.0, 4), fines = msFbm(u + 3.0, 90.0, 2);
  vec3 col; float h, r, ao = 1.0;
  if (V < 0.5 || V > 2.5) {
    // concrete flags / pavers: exposed fine aggregate, worn and stained each its own way, a tilt per slab (rocked slabs
    // catch the light apart), chipped and spalled arrises, a few cracked slabs, chewing gum, dirt worked in at the edges
    vec4 ag = msCell(u + 1.7, 150.0, 1.0);
    float sp = (1.0 - smoothstep(0.22, 0.4, ag.x)) * msLod(0.006) * msD.y;
    float stain = msFbm(u + ph.xy * 5.0, 3.5, 4), blot = smoothstep(0.2, 0.65, msFbm(msWarp(u + ph.zx * 7.0, 4.0, 0.03), 1.6, 4));
    float worn = smoothstep(0.3, 0.8, msFbm(u + ph.yz * 3.0, 2.5, 3) * 0.5 + 0.5);
    float edgeDirt = 1.0 - smoothstep(jw, jw + 0.03 + 0.03 * ph.z, de);
    col = msA.rgb * (0.8 + 0.34 * ph.x) * (0.88 + 0.16 * m1 + 0.14 * stain + 0.07 * fines) * (1.0 - 0.25 * blot) * (1.0 - 0.25 * edgeDirt * (0.5 + 0.5 * fines));
    col = mix(col, msA.rgb * (0.45 + 1.1 * ag.z) * mix(vec3(1.0), vec3(1.08, 1.0, 0.9), ag.w), sp * (0.45 + 0.4 * worn));
    float chipN = msFbm(u + 7.0, 18.0, 3) * 0.5 + 0.5 + 0.15 * msFbm(u + 1.0, 60.0, 2);
    float chip = msCut(chipN + (0.025 - min(de - jw, 0.025)) * 20.0 - 0.45, 0.64 - 0.25 * msD.x, 0.01) * step(jw, de);
    float bevel = smoothstep(jw, jw + 0.004, de);
    // a cracked slab: one wandering line across it, its two halves a little apart in height
    float crk = 0.0, side = 0.0;
    if (ph2.z > 0.82) {
      float ang = ph2.x * 6.2832; vec2 dir = vec2(cos(ang), sin(ang));
      float dd = dot(c, vec2(-dir.y, dir.x)) + 0.012 * msFbm(u + ph.xy, 14.0, 3);
      crk = msLine(dd, 0.0008 + 0.0008 * ph.y) * msLod(0.002); side = step(0.0, dd);
    }
    vec2 gum = msSpeck(u + 6.0, 9.0, 0.08 * msD.x, 0.12, 3.0);
    h = 0.62 + dot(c, (ph2.xy - 0.5)) * msC.a * 2.0 + 0.06 * fines + 0.05 * sp - 0.22 * chip + 0.1 * m1 + 0.04 * side - 0.3 * crk + 0.05 * gum.x;
    h = mix(0.15, h, bevel);
    col = mix(col, msA.rgb * 1.1 * (0.8 + 0.2 * fines), chip * 0.7);
    col = mix(col, mix(vec3(0.12, 0.115, 0.11), vec3(0.42, 0.4, 0.38), gum.y), gum.x * 0.85);
    col *= 1.0 - 0.6 * crk;
    r = msA.a + 0.06 * (ph.y - 0.5) + 0.04 * fines + 0.05 * chip - 0.1 * worn * msD.y - 0.08 * blot - 0.25 * gum.x;
    ao *= 1.0 - 0.5 * crk;
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
  float ero = 0.25 + 0.75 * msW.x;                                 // weathering: eroded arrises, spalled faces
  vec2 wob = vec2(msFbm(u + 1.7, 5.0, 3), msFbm(u + 4.2, 5.0, 3));
  vec4 g = msGrid(u + wob * 0.004, msB.xy, 0.5);
  vec2 s = msCellSize, q = g.xy;
  vec3 b = msCH(g.zw, 3.0), b2 = msCH(g.zw, 8.0), b3 = msCH(g.zw, 13.0);
  float mw = msB.z * 0.5;
  // every brick its own box inside its cell: each side set back by its own amount (joints 0.5x..1.7x the nominal),
  // its own corner radius, its outline bitten by erosion (deepest at the corners) and a few broken-off corners
  vec4 ins = mw * (0.5 + (0.35 + 0.85 * ero) * vec4(b.x, b.y, b2.x, b2.y));
  vec2 lo = ins.xz, hi = s - ins.yw, c = 0.5 * (lo + hi), hs = 0.5 * (hi - lo);
  vec2 lp = q - c;
  float rad = min(hs.y * 0.8, 0.002 + 0.01 * b3.x * ero);
  vec2 ed = hs - abs(lp);                                          // distance to the two nearest sides
  float corner = exp(-(ed.x + ed.y) / 0.02);
  float bite = (msFbm(u + 13.0, 7.0, 4) * 0.5 + 0.5) * 0.01 + (msFbm(u + 2.0, 40.0, 3) * 0.5 + 0.5) * 0.003;
  vec4 ch = msCell(u + 7.7, 9.0, 1.0);
  float chip = (1.0 - smoothstep(0.25, 0.5, ch.x)) * step(1.0 - 0.45 * ero, ch.z) * 0.012;
  float sd = msBox(lp, hs, rad) + ero * (bite * (0.6 + 1.6 * corner)) + chip * (0.4 + corner);
  float face = smoothstep(-0.001, 0.006 + 0.01 * ero, -sd);          // the arris rolls off over 0.5..1.5 cm
  face = face * (2.0 - face);
  float body = 1.0 - smoothstep(-0.5 * msFP, 0.5 * msFP, sd);
  // the fired clay: a palette per brick (buff, pink, ochre, pale, over-burnt), a mottle at 1..5 cm, flashing to one end
  float pk = b.z;
  vec3 pal = pk < 0.3 ? vec3(1.0) : pk < 0.5 ? vec3(1.1, 0.84, 0.78) : pk < 0.68 ? vec3(1.1, 1.04, 0.72) : pk < 0.84 ? vec3(1.18, 1.1, 0.98) : vec3(0.92, 0.8, 0.72);
  pal = mix(pal, vec3(0.62, 0.55, 0.58), step(1.0 - msC.a, b2.z));
  float mh = msFbm(u + b.yx * 9.0, 16.0, 3), m2 = msFbm(u + b.zx * 5.0, 5.0, 3);
  vec3 mott = mix(vec3(0.9, 1.0, 1.1), vec3(1.1, 0.96, 0.84), mh * 0.5 + 0.5);
  float flash = smoothstep(0.1, 1.0, (lp.x / max(hs.x, 1e-3)) * (b2.x - 0.5) * 2.0);
  vec3 col = msA.rgb * pal * mix(vec3(1.0), mott, 0.55) * (0.82 + 0.3 * b3.y) * (1.0 + 0.12 * m2) * (1.0 - 0.18 * flash);
  // the face: tilted (laid out of plane), spalled (flakes off in sheets, a crisp step, the fresh clay paler and rougher),
  // a torn, crinkled sanded texture (the mould's sand), pits; the relief darkens its own hollows
  float tilt = dot(lp, (b3.yz - 0.5) * 2.0) * 0.9;
  vec4 sp = msCell(msWarp(u, 20.0, 0.004) + b.xy, 11.0, 1.0);
  float spall = msCut(1.0 - sp.x + 0.12 * msFbm(u, 60.0, 2), 0.62, 0.015) * step(1.0 - 0.5 * ero, sp.z);
  float cn = msFbm2(msWarp(u, 24.0, 0.004) + b.zy * 4.0, vec2(16.0, 42.0), 4);
  float crink = 1.0 - abs(cn), crev = (1.0 - smoothstep(0.0, 0.1, abs(cn))) * msLod(0.004);
  float tex = msFbm(u + b.xz * 6.0, 40.0, 4), sand = msFbm(u + 2.0, 220.0, 2);
  vec2 pit = msSpeck(u, 140.0, 0.1 + 0.15 * ero, 0.3, 3.1);
  float cr = smoothstep(0.35, 1.0, crink);
  float rel = ero * (0.05 * tex + 0.05 * cr - 0.03 - 0.04 * crev) + 0.004 * sand - 0.12 * spall - 0.03 * pit.x;
  float hf = 0.8 + 0.05 * (b2.y - 0.5) + tilt + rel;
  col *= (1.0 + ero * (0.5 * cr - 0.3 + 0.25 * tex)) * (1.0 - 0.4 * ero * crev) * (1.0 + 0.08 * sand) * (1.0 - 0.15 * pit.x);
  col = mix(col, col * vec3(1.12, 1.06, 1.0), spall * 0.7);
  float h = mix(0.32, hf, face);
  col = mix(col * vec3(1.08, 1.06, 1.02), col, face);                 // the worn arris: paler, rougher
  float r = msA.a + 0.06 * (b.y - 0.5) - 0.12 * step(1.0 - msC.a, b2.z) + 0.05 * sand + 0.06 * spall;
  float ao = 1.0 - 0.35 * pit.x;
  // mortar: recessed (msB.w of the depth), sandy: grains standing out of it, smeared over the arrises in places
  float smear = msCut(msFbm(u + 6.0, 12.0, 3) * 0.5 + 0.5 + 0.6 * (1.0 - smoothstep(-0.012, 0.0, sd)) - 0.15, 0.75, 0.03) * smoothstep(-0.014, -0.003, sd);
  float mort = max(1.0 - body, smear * body);
  vec2 sg = msSpeck(u + 9.0, 300.0, 0.6, 0.55, 0.0);
  float mrel = msFbm(u + 3.0, 50.0, 3), mtone = msFbm(u + 6.0, 25.0, 3);
  vec3 mc = msC.rgb * (0.92 + 0.22 * mtone) * mix(1.0, 0.75 + 0.6 * sg.y, sg.x);
  float hm = 1.0 - msB.w + 0.03 * mrel + 0.015 * sg.x;
  col = mix(col, mc, mort); r = mix(r, 0.92, mort);
  h = mix(h, max(hm, h * smear), mort);
  ao *= 1.0 - 0.12 * mort * (1.0 - sg.x) * (1.0 - smoothstep(0.0, 0.01, sd));
  if (V > 2.5) {   // stock bricks: dark cinder specks and kiss marks
    vec2 ci = msSpeck(u + 4.1, 110.0, 0.35, 0.22, 1.0);
    col *= (1.0 - 0.5 * ci.x * (1.0 - mort)) * (1.0 - 0.2 * smoothstep(0.2, 0.7, msFbm(u + b.zx * 4.0, 5.0, 2)) * (1.0 - mort));
  }
  if (V > 1.5 && V < 2.5) {   // painted brick: the film follows every dent, worn off on the arrises first
    float pn = msFbm(u + 3.0, 3.0, 4) * 0.7 + (1.0 - face) * 0.5;
    float bare = smoothstep(0.75 - 0.5 * msD.a, 0.78 - 0.5 * msD.a, pn * 0.5 + 0.5);
    col = mix(msD.rgb * (0.94 + 0.06 * m2 + 0.04 * mh) * mix(1.0, 0.9, mort), col, bare);
    r = mix(0.72, r, bare);
  }
  if (V > 0.5 && V < 1.5) r -= 0.12;   // engineering brick: dense, a little glossy
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), 0.0, ao);
}`,

  // A: render rgb, roughness   B: spall (broken-off top coat), crack amount, patch amount, -   C: patch rgb, -
  render: /* glsl */ `
MsS ms_render(vec2 u){
  float V = msX.z, age = msW.x;
  vec2 uw = msWarp(u, 1.6, 0.08);
  float m1 = msFbm(uw, 0.7, 4), m2 = msFbm(uw + 2.0, 3.5, 4), m3 = msFbm(u + 5.0, 12.0, 3), fine = msFbm(u + 4.0, 70.0, 3);
  // stains: soft dark clouds (damp, dirt), a few paler bleached ones; the coat's own blotchy tone
  float stain = smoothstep(0.1, 0.7, msFbm(msWarp(u + 9.0, 3.0, 0.05), 1.3, 5) + 0.25 * age);
  float bleach = smoothstep(0.35, 0.8, msFbm(u + 3.0, 2.2, 4));
  vec3 col = msA.rgb * (0.94 + 0.26 * m1 + 0.16 * m2 + 0.07 * m3 + 0.05 * fine) * (1.0 - (0.22 + 0.15 * age) * stain) * (1.0 + 0.14 * bleach);
  // trowel: overlapping arcs of the float, faint ridges where strokes meet, each stroke a slightly other sheen
  vec4 tc = msCell2(u + 0.25 * vec2(m2, m1), vec2(2.4, 3.2), 1.0);
  float stroke = smoothstep(0.0, 0.2, tc.y - tc.x);
  // the coat undulates (it was laid by hand): slow swells, a fine sand grain, pits (air bubbles, lost grains) with a rim
  vec2 pit = msSpeck(u + 1.0, 14.0, 0.025 + 0.03 * age, 0.12, 0.0), pit2 = msSpeck(u + 4.0, 45.0, 0.012, 0.2, 5.0);
  float pits = max(pit.x, pit2.x * 0.8), rim = msSpeck(u + 1.0, 14.0, 0.025 + 0.03 * age, 0.2, 0.0).x - pit.x;
  float h = 0.5 + 0.22 * m2 + 0.14 * m3 + 0.05 * fine + 0.04 * stroke - 0.3 * pits + 0.04 * rim;
  col *= (1.0 - 0.55 * pits) * (1.0 + 0.04 * rim) * (0.97 + 0.06 * tc.z);
  float sheen = msFbm(u + 8.0, 1.1, 3);
  float r = msA.a + 0.06 * sheen + 0.03 * fine - 0.04 * (1.0 - stroke) + 0.1 * pits;
  float ao = 1.0 - 0.5 * pits;
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
  // broken-off top coat: islands where it fell away, a crisp torn step down to the darker, rougher scratch coat
  if (msB.x > 0.0) {
    float sn = msFbm(msWarp(u + 13.0, 4.0, 0.03), 2.2, 3) * 0.5 + 0.5 + 0.04 * msFbm(u + 2.0, 30.0, 2);
    float th = 0.78 - 0.4 * msB.x;
    float off = msCut(sn, th, 0.006), lip = msLine(sn - th, 0.006) * (1.0 - off);
    vec3 under = msA.rgb * vec3(0.62, 0.64, 0.68) * (0.85 + 0.25 * msFbm(u + 1.0, 25.0, 3)) * (1.0 - 0.25 * stain);
    col = mix(col, under, off); col *= 1.0 - 0.3 * lip;
    h = mix(h, 0.15 + 0.12 * msFbm(u + 6.0, 40.0, 3) + 0.08 * fine, off) + 0.05 * lip;
    r = mix(r, 0.93, off); ao *= 1.0 - 0.35 * off * (1.0 - smoothstep(th, th + 0.08, sn)) - 0.3 * lip;
  }
  // hairline cracks: a few long wandering cracks (settlement) and a fine map (shrinkage), opened where a slow field
  // allows, each a dark thread with depth
  if (msB.y > 0.0) {
    vec2 cu = msWarp(u, 4.0, 0.035);
    vec4 ck = msCell(cu, 2.2, 1.0);
    float cs = msT / msP(2.2);
    float open_ = smoothstep(0.62 - 0.45 * msB.y, 0.8 - 0.45 * msB.y, msFbm(u + 9.0, 1.1, 3) * 0.5 + 0.5);
    float crack = msLine((ck.y - ck.x) * cs * 0.5, 0.0004 + 0.0009 * (msFbm(u, 5.0, 2) * 0.5 + 0.5)) * open_;
    vec4 cm = msCell(msWarp(u + 3.0, 14.0, 0.006), 11.0, 1.0);
    float craze = msLine((cm.y - cm.x) * msT / msP(11.0) * 0.5, 0.00025) * smoothstep(0.7, 0.9, msFbm(u + 2.0, 2.0, 3) * 0.5 + 0.5 + 0.3 * msB.y) * msLod(0.004);
    crack = max(crack, craze * 0.7);
    col *= 1.0 - 0.6 * crack; h -= 0.35 * crack; ao *= 1.0 - 0.5 * crack;
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
  // D: gravity in the surface plane (xy: an axis, [0, -1] = down v), -, -
  corrugated: /* glsl */ `
MsS ms_corrugated(vec2 u){
  float V = msX.z;
  float pitch = msSnap(msB.x), x = u.x / pitch, fx = fract(x);
  float prof = msB.w < 0.5 ? 0.5 + 0.5 * cos(2.0 * MS_PI * fx) : smoothstep(0.18, 0.32, abs(fx - 0.5));
  float crest = smoothstep(0.75, 1.0, prof), valley = 1.0 - smoothstep(0.0, 0.3, prof);
  float sw = msSnap(msB.y);
  float lapD = u.x - floor(u.x / sw + 0.5) * sw;
  float lap = msLine(lapD, 0.0015), nearLap = 1.0 - smoothstep(0.0, 0.05, abs(lapD));
  float fsp = msSnap(msB.z);
  vec2 fq = vec2(fx * pitch, mod(u.y, fsp) - 0.5 * fsp);
  float fd = length(vec2(min(fq.x, pitch - fq.x), fq.y)), fOn = step(0.5, mod(floor(x), 2.0));
  float fix = (1.0 - smoothstep(0.006, 0.0075 + msFP, fd)) * fOn;
  // the frame gravity acts in: g = the fall direction (an axis of the plane); a = along the fall (+ = further down),
  // c = across it
  vec2 G = msD.xy, Cg = vec2(-G.y, G.x);
  float a = dot(u, G), c = dot(u, Cg);
  float fa = dot(vec2(fq.x - (fq.x > 0.5 * pitch ? pitch : 0.0), fq.y), G), fc = dot(vec2(fq.x - (fq.x > 0.5 * pitch ? pitch : 0.0), fq.y), Cg);
  float m1 = msFbm(msWarp(u, 1.5, 0.06), 0.8, 4), m2 = msFbm(u + 2.0, 5.0, 3), fine = msFbm(u + 3.0, 150.0, 2);
  // water runs down along the fall and gathers where the profile holds it (the valleys when the ribs run down the
  // fall); a streak field drawn out along the fall, strongest in the wet channels and under every source above
  float lines = msFbm2(vec2(c, a) + 4.0, vec2(60.0, 1.2), 3) * 0.6 + msFbm2(vec2(c, a) + 8.0, vec2(160.0, 2.5), 2) * 0.4;
  float chan = mix(1.0, valley * 0.8 + 0.2, abs(G.y));               // ribs along the fall: water in the valleys
  // sources: fixings (a run hanging under each, of its own length), the laps, rust patches above
  float runF = (1.0 - smoothstep(0.002, 0.006 + 0.004 * smoothstep(0.0, 0.2, fa), abs(fc))) * step(0.004, fa)
             * (1.0 - smoothstep(0.0, 0.08 + 0.4 * (msFbm(vec2(c, 0.0) * 3.0, 9.0, 2) * 0.5 + 0.5), fa)) * fOn;
  float rk = msC.x;
  float rf = 0.5 + 0.5 * (0.45 * msFbm(msWarp(u, 6.0, 0.03) + 5.0, 2.8, 4) + 0.3 * msFbm(u + 2.0, 14.0, 3) + 0.25 * msFbm(u + 9.0, 70.0, 2))
           + 0.15 * valley * abs(G.y) + 0.25 * nearLap + 0.3 * (1.0 - smoothstep(0.0, 0.03, fd)) * fOn;
  float above = 0.0;
  for (int i = 1; i <= 3; i++) {
    vec2 ua = u - G * (0.04 * float(i * i));
    float ra = 0.5 + 0.5 * (0.45 * msFbm(msWarp(ua, 6.0, 0.03) + 5.0, 2.8, 3) + 0.3 * msFbm(ua + 2.0, 14.0, 2));
    above = max(above, smoothstep(0.74 - 0.32 * rk, 0.8 - 0.32 * rk, ra) * (1.0 - 0.22 * float(i)));
  }
  float streak = smoothstep(0.05, 0.45, lines + 0.5 * above + 0.3 * nearLap - 0.2) * clamp(above + 0.35 * nearLap + 0.2 * rk, 0.0, 1.0) * chan;
  vec3 col; float r, met = 0.0;
  float rt = msFbm(u + 2.0, 25.0, 3) * 0.5 + 0.5;
  vec3 rc = msRustCol(0.3 + 0.65 * rt) * (0.8 + 0.4 * (fine * 0.5 + 0.5)) * vec3(1.15, 0.95, 0.8);
  if (V < 0.5) {
    // galvanised: spangle cells, white rust in the wet channels and under the fixings, red rust where the zinc is gone
    vec4 sp = msCell(u, 55.0, 1.0);
    col = vec3(0.64, 0.66, 0.68) * (0.82 + 0.24 * sp.z) * (0.95 + 0.06 * m1);
    r = 0.32 + 0.22 * sp.w + 0.05 * m2;
    met = 1.0;
    float wr = smoothstep(0.66 - 0.4 * msC.z, 0.74 - 0.4 * msC.z, rf * 0.8 + 0.3 * streak + 0.4 * runF);
    col = mix(col, vec3(0.58, 0.58, 0.55) * (0.85 + 0.2 * fine), wr); r = mix(r, 0.9, wr); met *= 1.0 - wr;
    float rs = msCut(rf + 0.3 * runF, 0.82 - 0.32 * rk, 0.01);
    col = mix(col, rc, rs); r = mix(r, 0.9, rs); met *= 1.0 - rs;
    col = mix(col, col * vec3(0.85, 0.72, 0.6), streak * rk * 0.7 * (1.0 - rs));
  } else if (V < 1.5) {
    // painted: the film chips where it is knocked (the crests, the laps, round the fixings) in crisp layered flakes
    // (paint -> primer -> zinc), rust where the zinc has gone; runs hang under the fixings and the chips, down the fall
    col = msA.rgb * (0.93 + 0.08 * m1 + 0.05 * m2) * (1.0 + 0.06 * lines * rk);
    r = msA.a + 0.04 * fine + 0.04 * m1;
    float wn = msFbm(msWarp(u + 9.0, 20.0, 0.006), 7.0, 4) * 0.45 + msFbm(u + 2.0, 40.0, 2) * 0.12 + 0.5 + 0.14 * crest + 0.25 * nearLap + 0.2 * (1.0 - smoothstep(0.0, 0.02, fd)) * fOn;
    float L = msLayers(wn, msC.y * 0.42);
    float zinc = clamp(L - 1.0, 0.0, 1.0);
    col = mix(col, col * 1.1, clamp(L, 0.0, 1.0) * (1.0 - zinc));
    col = mix(col, vec3(0.6, 0.62, 0.64), zinc); r = mix(r, 0.45, zinc); met = zinc;
    float rs = clamp(msCut(rf, 0.8 - 0.32 * rk, 0.008) + clamp(L - 2.0, 0.0, 1.0) * smoothstep(0.3, 0.6, rf + 0.3 * rk), 0.0, 1.0);
    vec2 spk = msSpeck(u + 3.0, 70.0, clamp(rk * smoothstep(0.6, 0.85, rf) * 1.4, 0.0, 1.0), 0.45, 0.0);
    rs = max(rs, spk.x);
    col = mix(col, mix(col, rc, 0.6) * vec3(1.05, 0.95, 0.9), clamp(streak * rk + runF * rk, 0.0, 1.0) * (1.0 - rs));
    r = mix(r, r + 0.12, streak * rk);
    col = mix(col, rc, rs); r = mix(r, 0.86, rs); met *= 1.0 - rs;
  } else {
    // rusted through: scale and pitting, a ghost of the paint in places, darker runs down the fall
    float scale_ = msFbm(u + 1.0, 40.0, 3);
    col = rc * (0.75 + 0.3 * m1);
    col = mix(col, vec3(0.06, 0.035, 0.025), smoothstep(0.3, 0.6, scale_) * 0.5);
    col *= 1.0 - 0.3 * streak;
    float ghost = msCut(msFbm(u + 7.0, 2.0, 3) * 0.5 + 0.5 + 0.05 * fine, 0.62, 0.006);
    col = mix(col, msA.rgb * 0.7, ghost * 0.85); r = mix(0.86 + 0.06 * scale_, 0.7, ghost);
  }
  vec2 pit = msSpeck(u + 5.0, 200.0, 0.4, 0.5, 4.0);
  float rustAmt = V < 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.6, abs(r - 0.86) * 10.0);
  float h = prof * 0.9 + 0.04 * fine + 0.06 * fix - 0.04 * pit.x * rustAmt;
  col *= 1.0 - 0.35 * lap;
  col = mix(col, vec3(0.5, 0.5, 0.52), fix * 0.6);
  float ao = 1.0 - 0.25 * valley - 0.3 * lap;
  return MsS(col, clamp(r, 0.04, 1.0), clamp(h, 0.0, 1.0), met, ao);
}`,

  // A: paint rgb, roughness   B: primer rgb, chips   C: panel w, panel h, bolt spacing, rust   D: streaks, gloss, gravity (an axis of the plane, [0, -1] = down v)
  paintedMetal: /* glsl */ `
MsS ms_paintedMetal(vec2 u){
  float V = msX.z;
  float m1 = msFbm(u, 0.8, 2), m2 = msFbm(u + 2.0, 5.0, 3);
  float peel = msFbm(u + 5.0, 260.0, 2) * msLod(0.006);           // orange peel: the film's own micro relief
  float seam = 0.0, bolt = 0.0, near = 0.0;
  if (V > 0.5 && V < 1.5) {
    // panels joined at seams, a bolt row along each panel's top and bottom
    vec4 g = msGrid(u, msC.xy, 0.0); vec2 s = msCellSize, q = g.xy;
    seam = msLine(msEdgeD(g), 0.0012);
    float sp = s.x / max(1.0, floor(s.x / msC.z + 0.5));
    float bx = mod(q.x, sp) - 0.5 * sp;
    float by = min(abs(q.y - 0.035), abs(q.y - (s.y - 0.035)));
    bolt = 1.0 - smoothstep(0.0085, 0.0095 + msFP, length(vec2(bx, by)));
    // the bloom round a fixing: ragged (its radius pushed by noise), not round every fixing
    float dw = length(vec2(bx, by)) * (0.7 + 0.8 * (msFbm(u + 3.3, 35.0, 3) * 0.5 + 0.5));
    near = (1.0 - smoothstep(0.008, 0.045, dw)) * step(0.35, bh0(g.zw + floor(q.x / sp) * 0.137));
  }
  // rust: patches at every scale (a 30 cm cluster, 5 cm islands, 1 cm specks), the edges warped and cut crisp; new
  // rust nucleates as many small spots round the patches that merge into them
  float rk = msC.a;
  float rbig = msFbm(msWarp(u, 6.0, 0.03) + 7.0, 2.6, 4), rmid = msFbm(msWarp(u, 25.0, 0.006) + 2.0, 12.0, 3), rfine = msFbm(u + 1.0, 70.0, 3);
  float rgrain = msFbm(u + 6.0, 180.0, 2);
  vec2 G = msD.zw, ug = vec2(dot(u, vec2(-G.y, G.x)), dot(u, G));    // the plane turned so gravity is -v
  float rvert = msFbm2(ug + 3.0, vec2(45.0, 2.5), 3) * msD.x;      // drawn out downward by the wash
  float rf = 0.5 + 0.5 * (0.36 * rbig + 0.26 * rmid + 0.3 * rfine + 0.2 * rgrain + 0.26 * rvert) + 0.35 * near;
  float th = 0.8 - 0.28 * rk;
  float patchR = msCut(rf, th, 0.004);
  float halo = smoothstep(th - 0.16, th, rf);                        // the ring round a patch where spots seed
  vec2 sp1 = msSpeck(u + 3.0, 55.0, clamp(rk * (0.02 + 0.7 * halo), 0.0, 1.0), 0.4 + 0.4 * halo, 0.0);
  vec2 sp2 = msSpeck(u + 9.0, 160.0, clamp(rk * (0.04 + 0.8 * halo), 0.0, 1.0), 0.5, 2.0);
  float rust = clamp(max(patchR, max(sp1.x, sp2.x * 0.9)), 0.0, 1.0);
  // the paint over it: lifts and flakes in islands with crisp ragged edges (paint -> lifted rim -> primer -> bare),
  // more round the rust and the fixings
  float wn = msFbm(msWarp(u, 18.0, 0.008) + 11.0, 5.0, 5) * 0.42 + msFbm(u + 3.0, 32.0, 3) * 0.12 + 0.5 + 0.3 * near + 0.12 * halo;
  float amt = msB.a * (V > 1.5 ? 0.35 : 1.0);
  float L = msLayers(wn, amt);
  float lip = clamp(L, 0.0, 1.0) * (1.0 - clamp(L - 1.0, 0.0, 1.0));
  float primer = clamp(L - 1.0, 0.0, 1.0) * (1.0 - clamp(L - 2.0, 0.0, 1.0));
  float bare = clamp(L - 2.0, 0.0, 1.0);
  rust = max(rust, bare * smoothstep(0.35, 0.65, rf + 0.3 * rk));     // bare steel rusts
  // gravity: what washes off the rust runs straight down (along -v) in thin streaks of varying length
  float above = 0.0;
  for (int i = 1; i <= 4; i++) {
    float dy = 0.025 * float(i * i);
    vec2 ua = u - G * dy;
    float ra = 0.5 + 0.5 * (0.55 * msFbm(msWarp(ua, 6.0, 0.03) + 7.0, 2.6, 3) + 0.3 * msFbm(ua + 2.0, 12.0, 2));
    above = max(above, msCut(ra, th, 0.04) * (1.0 - 0.18 * float(i)));
  }
  float lines = msFbm2(ug + 4.0, vec2(55.0, 1.1), 3) * 0.6 + msFbm2(ug + 8.0, vec2(140.0, 2.5), 2) * 0.4;
  float runs = smoothstep(0.0, 0.35, lines + 0.8 * above - 0.25) * above * (0.5 + 0.5 * msD.x) * (1.0 - rust);
  // colour
  float rt = msFbm(u + 2.0, 25.0, 3) * 0.5 + 0.5;
  vec3 rc = msRustCol(0.35 + 0.6 * rt + 0.2 * sp2.y) * (0.8 + 0.4 * (rfine * 0.5 + 0.5)) * vec3(1.2, 0.95, 0.75);
  rc = mix(rc, rc * vec3(0.55, 0.5, 0.48), smoothstep(0.65, 0.9, rf) * 0.6);   // old scale: darker, browner
  float wash = msFbm2(ug + 13.0, vec2(30.0, 0.8), 3) * 0.6 + msFbm2(ug + 17.0, vec2(160.0, 1.5), 2) * 0.4;   // weathered in washes down the fall
  vec3 col = msA.rgb * (0.95 + 0.05 * m1 + 0.04 * m2 + 0.03 * rfine + 0.14 * wash * msD.x);
  col = mix(col, col * 1.08, lip);
  col = mix(col, msB.rgb * (0.92 + 0.1 * m2), primer * (1.0 - smoothstep(0.3, 0.9, rk)));
  col = mix(col, vec3(0.53, 0.53, 0.54) * (0.9 + 0.12 * rfine), bare);
  col = mix(col, col * vec3(0.92, 0.72, 0.55), halo * rk * 0.4 * (1.0 - rust));   // a stain round it
  col = mix(col, mix(col, rc, 0.55) * vec3(1.1, 1.0, 0.95), runs * rk);
  col = mix(col, rc, rust);
  col = mix(col, msA.rgb * 0.8, bolt * 0.6);
  col *= 1.0 - 0.45 * seam;
  float r = msA.a - 0.2 * msD.y + 0.05 * peel;
  r = mix(r, 0.7, primer); r = mix(r, 0.42, bare); r = mix(r, r + 0.15, runs * rk); r = mix(r, 0.82 + 0.12 * rfine, rust);
  float met = bare * (1.0 - rust);
  // relief: the paint film proud of the primer and steel by its thickness (crisp lips), the rust scale pitted and
  // lumpy, the paint blistered round the rust
  vec2 pit = msSpeck(u + 5.0, 220.0, 0.5, 0.5, 4.0);
  float blister = msCut(rf, th - 0.06, 0.01) * (1.0 - patchR) * smoothstep(0.2, 0.6, rmid * 0.5 + 0.5);
  float h = 0.6 + 0.02 * peel + 0.06 * lip - 0.12 * clamp(L - 1.0, 0.0, 1.0) - 0.06 * bare;
  h = mix(h, 0.42 + 0.18 * (rfine * 0.5 + 0.5) + 0.12 * rmid - 0.18 * pit.x, rust) + 0.08 * blister - 0.35 * seam + 0.3 * bolt;
  float ao = 1.0 - 0.35 * seam - 0.25 * rust * pit.x;
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
    // brushed: many parallel hairlines of random length along the grain (u), a few deeper ones; the belt's passes
    // overlap in bands a few cm wide, each a little brighter or duller; the lines wander a hair off straight
    vec2 ub = u + vec2(0.0, 0.0015 * msFbm(u + 7.0, 1.5, 2));
    float hair = msFbm2(ub, vec2(3.0 / msB.x, 1400.0), 3);
    float deep = msFbm2(ub + 3.0, vec2(1.0 / msB.x, 260.0), 2);
    float pass = msFbm2(ub + 5.0, vec2(0.3, 22.0), 2);
    float k = msLod(0.0015);
    h = 0.5 + 0.3 * hair * k + 0.15 * deep;
    r = msA.a * (0.8 + 0.5 * (hair * 0.5 + 0.5) * k + 0.2 * (deep * 0.5 + 0.5) + 0.25 * pass);
    col *= (0.96 + 0.06 * hair * k) * (1.0 + 0.04 * pass);
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
  // water spots: dried rings (a duller rim, a clean centre), and smudges (fingers, wiping): roughness only
  vec2 ws = msSpeck(u + 4.0, 30.0, 0.25 * msB.z, 0.45, 3.0);
  vec2 wr = msSpeck(u + 4.0, 30.0, 0.25 * msB.z, 0.55, 3.0);
  float ring = clamp(wr.x - ws.x, 0.0, 1.0);
  float smudge = smoothstep(0.55, 0.85, msFbm(msWarp(u, 6.0, 0.02) + 9.0, 4.0, 3) * 0.5 + 0.5) * msB.z;
  r += 0.06 * ring + 0.03 * ws.x + 0.08 * smudge;
  return MsS(col, clamp(r, 0.03, 1.0), clamp(h, 0.0, 1.0), 1.0, 1.0);
}`,

  // A: F0 rgb, roughness   B: spangle size (m), white rust, -, -
  galvanised: /* glsl */ `
MsS ms_galvanised(vec2 u){
  float V = msX.z;
  // spangle: zinc crystals 5..25 mm, each reflecting a little apart (brightness, roughness, a tilt)
  vec4 sp = msCell(u + 0.004 * vec2(msFbm(u, 60.0, 2), msFbm(u + 1.0, 60.0, 2)), 1.0 / msB.x, 1.0);
  float k = msLod(msB.x);
  // each crystal a facet of its own tilt (a slow ramp of its own direction across it: it flashes at its own angle),
  // dendrite feathering inside, the grain boundaries a fine groove; some crystals bright and smooth, some dull
  float dend = msFbm2(u + sp.zw * 9.0, vec2(300.0, 120.0), 2) * msLod(0.002);
  float facet = msFbm(u + sp.zw * 37.0, 0.5 / msB.x, 1);
  float bright = step(0.5, sp.z);
  vec3 col = msA.rgb * mix(1.0, mix(0.8 + 0.12 * sp.w, 1.02 + 0.06 * sp.w, bright), k) * (0.97 + 0.05 * dend);
  float r = msA.a + mix(0.0, mix(0.12, -0.14, bright) + 0.08 * (sp.w - 0.5), k) + 0.05 * dend;
  float h = 0.5 + 0.55 * facet * k - 0.3 * msLine((sp.y - sp.x) * msB.x * 0.5, 0.00025) * k + 0.06 * dend;
  float met = 1.0;
  float m1 = msFbm(msWarp(u, 2.0, 0.05), 1.5, 4), m2 = msFbm(u + 4.0, 11.0, 3);
  if (V > 0.5) {
    // weathered: the zinc dulls to a grey carbonate patina in clouds, the spangle fading under it
    float pat = smoothstep(-0.35, 0.35, m1);
    col = mix(col, vec3(0.42, 0.43, 0.44) * (0.92 + 0.12 * m2), pat * 0.75); r = mix(r, 0.62 + 0.08 * m2, pat);
  }
  // white rust: a powdery bloom in small clusters of specks, denser where water stood (a slow field), soft-edged
  float wf = smoothstep(0.45, 0.8, m2 * 0.5 + 0.5 + 0.3 * m1);
  vec2 ws = msSpeck(u + 2.0, 90.0, clamp(msB.y * (0.01 + 0.5 * wf * wf), 0.0, 1.0), 0.6, 1.0);
  float wr = clamp(max(ws.x * (0.6 + 0.4 * ws.y), msB.y * smoothstep(0.75, 0.95, wf + 0.1 * msFbm(u, 40.0, 2)) * 0.7), 0.0, 1.0);
  col = mix(col, vec3(0.64, 0.64, 0.62) * (0.88 + 0.16 * m2), wr); r = mix(r, 0.92, wr); met = 1.0 - step(0.5, wr);
  h += 0.08 * ws.x;
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
    // extruded: die lines along the length (u): a dense fine set, a few deep ones that run the whole tile (a nick in
    // the die), and stop marks across (the press paused): bands a few mm wide, a hair duller
    float die = msFbm2(u, vec2(0.6, 900.0), 3) * msLod(0.0012);
    float deepL = msFbm2(u + 2.0, vec2(0.25, 140.0), 2);
    float nick = (1.0 - smoothstep(0.0, 0.06, abs(deepL))) * msLod(0.002);
    float stopM = msLine((fract(u.x / msSnap(0.45)) - 0.5) * msSnap(0.45) + 0.002 * msFbm(vec2(0.0, u.y), 3.0, 2), 0.003) * msLod(0.003);
    h = 0.5 + 0.25 * die - 0.25 * nick + 0.05 * stopM; r = msA.a * (0.85 + 0.35 * (die * 0.5 + 0.5)) + 0.05 * stopM + 0.06 * nick;
    col *= (1.0 - 0.06 * nick) * (1.0 - 0.04 * stopM);
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
  // weathering: the surface dulls in soft clouds (roughness, not colour), white pits of corrosion powder gather in them
  float cloud = smoothstep(0.35, 0.8, msFbm(msWarp(u + 5.0, 3.0, 0.04), 3.0, 4) * 0.5 + 0.5) * msB.y * 2.0;
  r = mix(r, max(r, 0.55), clamp(cloud, 0.0, 1.0));
  vec2 pit = msSpeck(u + 1.0, 140.0, clamp(msB.y * (0.05 + 1.5 * cloud), 0.0, 0.9), 0.4, 2.0);
  float ox = step(0.5, pit.x);
  col = mix(col, vec3(0.62, 0.62, 0.6), ox); r = mix(r, 0.85, ox); met = 1.0 - ox; h -= 0.08 * pit.x;
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
  // use: a dense field of hairline micro-scratches (any direction, a few mm long: seen as a haze in the highlight),
  // smudges and wiped patches (roughness only), dust settled in the texture, a few dents
  vec4 ms = msCell(u + 5.0, 45.0, 1.0);
  float ma = ms.z * MS_PI; vec2 mcs = vec2(msT / msP(45.0));
  vec2 ml = u - (floor(u / mcs) + 0.5) * mcs;
  float mrl = dot(ml, vec2(-sin(ma), cos(ma))), mrx = dot(ml, vec2(cos(ma), sin(ma)));
  float micro = msLine(mrl, 0.00005) * (1.0 - smoothstep(0.002, 0.008 * (0.5 + ms.w), abs(mrx))) * step(0.35, ms.w) * msLod(0.0006) * (0.3 + msB.y);
  float smudge = smoothstep(0.5, 0.85, msFbm(msWarp(u + 3.0, 5.0, 0.03), 3.0, 4) * 0.5 + 0.5);
  r = clamp(r + 0.18 * micro + 0.1 * smudge * (1.0 - 0.6 * step(0.4, msA.a)), 0.04, 1.0);
  col *= 1.0 + 0.08 * micro;
  float dust = (1.0 - h) * smoothstep(0.3, 0.8, msFbm(u + 6.0, 2.0, 3) * 0.5 + 0.5) * 0.5;
  col = mix(col, vec3(0.32, 0.3, 0.27) * (0.4 + col), dust * 0.35); r = mix(r, 0.85, dust * 0.4);
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
  // age: ozone cracking (short fine cracks across the stretch, on exposed faces), scuffs that polish and grey it,
  // grit and dust in the grooves
  vec4 oz = msCell2(u + 3.0, vec2(60.0, 20.0), 1.0);
  float ozone = msLine((oz.y - oz.x) * msT / msP(60.0) * 0.5, 0.00012) * step(0.55, oz.z) * msLod(0.0015) * msW.x * smoothstep(0.4, 0.6, h);
  vec4 sc = msCell(u + 7.0, 9.0, 1.0);
  float scuff = (1.0 - smoothstep(0.15, 0.45, sc.x + 0.2 * msFbm2(u, vec2(80.0, 8.0), 2))) * step(0.7, sc.z) * msLod(0.01);
  float grit = (1.0 - smoothstep(0.3, 0.5, h)) * smoothstep(0.4, 0.8, msFbm(u + 2.0, 30.0, 3) * 0.5 + 0.5);
  col = mix(col, vec3(0.08, 0.075, 0.07), scuff * 0.5) * (1.0 - 0.4 * ozone);
  col = mix(col, vec3(0.16, 0.14, 0.12), grit * 0.6);
  r = mix(r, msA.a - 0.15, scuff * 0.6); r = mix(r, 0.95, grit * 0.5); h -= 0.15 * ozone;
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
  // every thread its own thickness along its length (slubs: thick runs 1..4 cm, thin stretches), so the crowns
  // swell and shrink and the weave reads irregular from a metre away
  float tW = mgHash3(vec3(mod(c.x, msT / p), 2.0, msSeed)).x, tF = mgHash3(vec3(mod(c.y, msT / p), 5.0, msSeed)).x;
  float sW = msFbm2(vec2(u.x, u.y) + vec2(tW * 9.0, 0.0), vec2(0.5 / p, 30.0), 2), sF = msFbm2(u + vec2(0.0, tF * 9.0), vec2(30.0, 0.5 / p), 2);
  float gW = clamp(0.8 + 0.5 * sW + 0.25 * (tW - 0.5), 0.45, 1.3), gF = clamp(0.8 + 0.5 * sF + 0.25 * (tF - 0.5), 0.45, 1.3);
  float warp = pow(max(sin(MS_PI * f.x), 0.0), 1.0 / gW) * gW * (0.7 + 0.3 * sin(MS_PI * f.y + MS_PI * over));
  float weft = pow(max(sin(MS_PI * f.y), 0.0), 1.0 / gF) * gF * (0.7 + 0.3 * sin(MS_PI * f.x + MS_PI * (1.0 - over)));
  float wh = over > 0.5 ? max(warp, weft * 0.65) : max(weft, warp * 0.65);
  float th = over > 0.5 ? tW : tF;
  float fuzz = msFbm(u, 900.0, 2) * msLod(0.0006) * msC.y;
  float m1 = msFbm(msWarp(u, 2.0, 0.03), 1.2, 4), slub = msFbm2(u, vec2(2.0, 60.0), 2);
  vec3 base = msA.rgb;
  if (msB.a > 0.0) base = mix(msA.rgb, msB.rgb, step(0.5, fract(u.x / (2.0 * msSnap(msB.a)))));
  // tone: thread to thread, along the slubs (thick runs a little paler), a few dark flecks (dirt, seeds), grime in
  // the creases
  vec2 fleck = msSpeck(u + 3.0, 60.0, 0.035, 0.25, 1.0);
  vec3 col = base * (0.97 + 0.1 * m1 + 0.06 * slub) * mix(1.0, (0.88 + 0.6 * (wh - 0.5) + 0.3 * (th - 0.5)) * (1.0 + 0.2 * ((over > 0.5 ? sW : sF))), k);
  col *= 1.0 - 0.45 * fleck.x * (0.5 + fleck.y);
  // the cloth is never flat: puckers and crumple at 1..15 cm, a few sharp creases (folded and pressed)
  float crumple = msFbm(msWarp(u + 2.0, 12.0, 0.01), 9.0, 5);
  vec4 cr = msCell(msWarp(u + 6.0, 5.0, 0.02), 4.0, 1.0);
  float crease = msLine((cr.y - cr.x) * msT / msP(4.0) * 0.5, 0.0012) * smoothstep(0.5, 0.8, msFbm(u + 1.0, 2.0, 2) * 0.5 + 0.5);
  float h = mix(0.5, 0.2 + 0.6 * wh, k) * 0.62 + 0.3 * (crumple * 0.5 + 0.5) + 0.05 * fuzz + 0.04 * slub - 0.2 * crease;
  col *= (1.0 - 0.18 * crease) * (0.94 + 0.12 * (crumple * 0.5 + 0.5));
  float r = msA.a + 0.04 * fuzz + 0.06 * (1.0 - wh) * k;
  float ao = mix(1.0, 0.82 + 0.18 * wh, k) * (1.0 - 0.3 * crease);
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

  // A: wood rgb, roughness   B: board width, board length, gap, boards run along v (1) / u (0)   C: paint rgb, paint   D: latewood rgb, knots
  wood: /* glsl */ `
MsS ms_wood(vec2 u){
  float V = msX.z;
  if (msB.w > 0.5) u = vec2(u.y, -u.x);                            // boards up the surface (v) instead of along it
  bool ply = V > 0.5 && V < 1.5;
  float age = msW.x;
  // boards: rows across v, staggered butt joints along u (the grain runs along u)
  float bw = msSnap(msB.x), row = floor(u.y / bw), fy = u.y - row * bw;
  float nr = msT / bw;
  vec3 b = mgHash3(vec3(mod(row, nr), 1.0, msSeed));
  float bl = ply ? msT : msT / max(1.0, floor(msT / msB.y + 0.5));
  float xu = u.x + b.x * bl, seg = floor(xu / bl), fx = xu - seg * bl;
  vec3 bb = mgHash3(vec3(mod(row, nr), mod(seg, msT / bl), msSeed + 3.0));
  vec3 b4 = mgHash3(vec3(mod(row, nr), mod(seg, msT / bl), msSeed + 9.0));
  if (ply) bb = vec3(0.5, 0.3, 0.5);
  // knots: one or two per board where the knot share allows; the grain flows round them (the across coordinate pushed
  // aside near a knot, the rings closing round it)
  vec2 kc = vec2(bl * (0.15 + 0.7 * bb.x), bw * (0.2 + 0.6 * bb.z)), kc2 = vec2(bl * fract(bb.x + 0.47), bw * (0.25 + 0.5 * b4.x));
  vec2 kd = vec2(fx, fy) - kc, kd2 = vec2(fx, fy) - kc2;
  float kOn = step(1.0 - msD.a, bb.x * 0.7 + bb.z * 0.3), kOn2 = step(1.0 - 0.6 * msD.a, b4.y);
  float ks = 0.006 + 0.01 * b4.z;
  float kr = length(kd * vec2(0.45, 1.0)), kr2 = length(kd2 * vec2(0.45, 1.0));
  float knot = max(kOn * (1.0 - smoothstep(ks * 0.7, ks, kr)), kOn2 * (1.0 - smoothstep(ks * 0.5, ks * 0.7, kr2)));
  float push = kOn * ks * 2.2 * kd.y / (kr * kr / (ks * 3.0) + ks * 1.5) * exp(-kr / (ks * 6.0))
             + kOn2 * ks * 1.5 * kd2.y / (kr2 * kr2 / (ks * 3.0) + ks) * exp(-kr2 / (ks * 5.0));
  // growth rings: a flat-sawn board cuts the log off-centre: rings are the distance from the pith (under the board)
  // warped along the grain, so they draw arches; each board its own flow (a slow wander of the fibre)
  float pithY = (bb.y - 0.5) * bw * 3.0, pithZ = 0.03 + 0.12 * bb.z;
  float warp = msFbm2(u + b.yz * 7.0, vec2(0.6, 5.0), 3) + 0.6 * msFbm2(u + bb.zx * 3.0, vec2(2.0, 14.0), 2);
  float ac = fy - bw * 0.5 - pithY + 0.007 * warp + push;
  float d = length(vec2(ac, pithZ + 0.015 * msFbm2(u + 3.0, vec2(0.4, 2.0), 2)));
  float spacing = ply ? 0.009 : 0.0035 + 0.003 * bb.y;
  float ring = fract(d / spacing);
  float late = smoothstep(0.55, 0.85, ring) * (1.0 - smoothstep(0.92, 1.0, ring));
  late = mix(0.3, late, msLod(spacing));
  late = max(late, smoothstep(ks * 1.6, ks * 0.9, max(kr, 0.0)) * kOn * 0.7);
  // fibre: long thin lines along the grain (pores, rays), dark mineral streaks
  float across = fy + push + 0.004 * warp;
  float fib = msFbm2(vec2(u.x, across) + b.xz * 5.0, vec2(4.0, 420.0), 3) * msLod(0.0012);
  float streak = smoothstep(0.45, 0.85, msFbm2(vec2(u.x, across) + bb.xy * 9.0, vec2(1.0, 38.0), 4) * 0.5 + 0.5);
  vec3 tone = msA.rgb * (0.72 + 0.5 * bb.z) * mix(vec3(1.0), vec3(1.08, 0.96, 0.86), bb.y) * (0.92 + 0.14 * msFbm2(u + bb.xy * 3.0, vec2(0.6, 4.0), 3));
  vec3 col = mix(tone, tone * msD.rgb * 0.85, late) * (1.0 + 0.14 * fib) * (1.0 - 0.3 * streak * (0.4 + 0.6 * age));
  col = mix(col, tone * msD.rgb * 0.45, knot);
  float r = msA.a + 0.04 * fib - 0.05 * late;
  // relief: weathering wears the soft earlywood, the latewood stands proud (raised grain); fibres; a board cups
  float cup = (fy / bw - 0.5); cup = cup * cup * 4.0;
  float wavy = msFbm2(vec2(u.x, across) + bb.yz * 2.0, vec2(2.0, 22.0), 3);
  float h = 0.6 + (0.04 + 0.12 * age) * late + 0.05 * fib - 0.3 * cup * (0.3 + age) + 0.08 * knot - 0.12 * streak * age + 0.22 * wavy;
  float ao = 1.0;
  // checks: cracks along the grain, of random length, opening at the board ends
  vec4 ck = msCell2(vec2(u.x, across) + bb.zy, vec2(0.5, 1.0 / max(bw * 0.25, 0.01)), 1.0);
  float cline = msLine((ck.y - ck.x) * bw * 0.25 * 0.5, 0.0006 + 0.0008 * ck.w);
  float check = cline * step(0.55 - 0.35 * age, ck.z) * msLod(0.004) * smoothstep(0.1, 0.5, msFbm2(u + bb.xy, vec2(1.5, 6.0), 2) * 0.5 + 0.5 + 0.3 * age);
  col *= 1.0 - 0.7 * check; h -= 0.35 * check; ao *= 1.0 - 0.6 * check;
  if (V > 2.5 && V < 3.5) {
    // weathered: silvered, the earlywood eroded deep so the latewood stands proud
    float lum = dot(col, vec3(0.33));
    col = mix(col, vec3(0.32, 0.31, 0.29) * (lum / max(dot(tone, vec3(0.33)), 1e-3)) * 0.85 + 0.03, 0.8);
    h += 0.12 * late; r = 0.86;
  } else if (!ply && V < 3.5) {
    // grey weathering creeping in on old boards: patchy, along the grain
    float gr = age * smoothstep(0.3, 0.8, msFbm2(u + bb.yx * 4.0, vec2(1.2, 9.0), 3) * 0.5 + 0.5 + 0.25 * (age - 0.5));
    col = mix(col, vec3(dot(col, vec3(0.3, 0.45, 0.25))) * vec3(1.02, 1.0, 0.97) * 1.05, gr * 0.5);
  }
  if (V > 4.5) { h += 0.12 * msFbm2(u, vec2(8.0, 90.0), 3); r = max(r, 0.82); }   // rough-sawn
  // use and age: dents, gouges along the grain, nails with a rust halo near the board ends and at the joists
  if (age > 0.0 && !(V > 3.5 && V < 4.5)) {
    vec4 dn = msCell(u + b.xy * 3.0, 14.0, 1.0);
    float dent = (1.0 - smoothstep(0.0, 0.22, dn.x + 0.15 * msFbm(u, 80.0, 2))) * step(1.0 - 0.1 * age, dn.z) * msLod(0.01);
    float gouge = smoothstep(0.8, 0.86, msFbm2(u + bb.zx * 5.0, vec2(5.0, 160.0), 2) * 0.5 + 0.5) * age * msLod(0.002);
    float js = msSnap(0.6);                                          // joists under the boards every ~60 cm
    float jx = mod(u.x + 0.5 * js, js) - 0.5 * js;
    vec2 nq = vec2(jx, min(abs(fy - bw * 0.25), abs(fy - bw * 0.75)));
    float nd = length(nq), nOn = step(0.3, age) * (ply ? 0.0 : 1.0) * step(0.2, fract(b4.x * 7.0 + floor(u.x / js) * 0.37));
    float nail = (1.0 - smoothstep(0.0022, 0.003 + msFP, nd)) * nOn;
    float halo = (1.0 - smoothstep(0.003, 0.012 + 0.008 * b4.z, nd * (0.8 + 0.4 * (msFbm(u, 90.0, 2) * 0.5 + 0.5)))) * nOn * (1.0 - nail);
    col *= (1.0 - 0.15 * dent) * (1.0 - 0.45 * gouge);
    col = mix(col, col * vec3(0.7, 0.5, 0.35), halo * 0.8);
    col = mix(col, msRustCol(0.35 + 0.3 * b4.z) * 0.8, nail);
    h += 0.06 * nail - 0.25 * dent - 0.15 * gouge; ao *= (1.0 - 0.3 * dent);
    r += 0.06 * dent; r = mix(r, 0.75, nail);
  }
  if (V > 3.5 && V < 4.5) { r = msA.a + 0.03 * fib; }                         // varnished: one smooth film
  // gaps between boards (deep, dark) and butt joints; the arrises rounded and worn
  float gap = msB.z * 0.5;
  float ee = min(min(fy, bw - fy), ply ? 1.0 : min(fx, bl - fx));
  float joint = 1.0 - smoothstep(gap, gap + msFP + 0.0004, ee);
  float arris = (1.0 - smoothstep(gap, gap + 0.003 + 0.009 * age * (0.6 + 0.4 * (msFbm(u, 20.0, 2) * 0.5 + 0.5)), min(fy, bw - fy))) * (1.0 - joint);
  col *= (1.0 - 0.85 * joint) * (1.0 - 0.15 * arris); h = mix(h - 0.4 * arris * arris, 0.0, joint); ao *= 1.0 - 0.8 * joint - 0.2 * arris;
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
  // use: wrinkles where it flexes (long soft folds, a few deep), the finish worn paler and duller on the high spots,
  // darker where hands and oil polish it, fine scuffs
  float wrk = msRidge(msWarp(u, 6.0, 0.01) + 4.0, vec2(14.0, 4.0), 3);
  float fold = smoothstep(0.75, 0.98, wrk);
  float wear = smoothstep(0.55, 0.85, msFbm(u + 2.0, 3.0, 3) * 0.5 + 0.5 + 0.2 * fold) * (0.2 + 0.6 * msW.x);
  float polish = smoothstep(0.5, 0.8, msFbm(u + 8.0, 2.0, 3) * 0.5 + 0.5) * (1.0 - wear);
  h = h - 0.25 * fold + 0.06 * wrk; ao *= 1.0 - 0.3 * fold;
  col = mix(col, col * vec3(1.15, 1.12, 1.08) + 0.005, wear * 0.35) * (1.0 - 0.06 * polish) * (1.0 - 0.12 * fold);
  r = mix(r, r + 0.15, wear) - 0.12 * polish;
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
    col = msA.rgb * mix(0.6, 1.5, pb.z) * mix(vec3(1.0), vec3(0.75, 0.68, 0.6), step(0.8, pb.w)) * (0.9 + 0.2 * msFbm(u + pb.zw * 9.0, 60.0, 2));
    col = mix(msA.rgb, col, k);
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

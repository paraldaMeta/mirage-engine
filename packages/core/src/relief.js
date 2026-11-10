// Mirage code adapted from the author's own earlier close-range relief layer (no Golden Temple code in it); GLSL
// rewritten on Mirage's uniforms and noise.
// ---------------------------------------------------------------------------
// Optional close-range relief ("detail") for walls, floors and plaster at 1–3 m. Pure math on top of whatever a
// material already samples: heights in, shifted positions and light factors out. Nothing here is compiled into a
// material unless it opts in (tex.material(name, { relief }), tex.hooks(names, h, { relief: true }),
// PROC.plaster(base, { render }), or withRelief(hooks) for your own GLSL), so worlds that do not ask for it build
// exactly the shaders they did before.
//
// GLSL (fragment stage, after withRelief / the opt-ins above); h is a relief height 0 (deep) .. 0.5 (mean) .. 1 (top):
//   float mgRlFade(vec3 wp)                         1 near the camera .. 0 beyond uReliefFar; 0 in orthographic views
//                                                   (the game camera) and while switched off (setRelief(0))
//   vec3  mgRlShift(vec3 wp, vec3 N, float h, float depth)   one parallax step: the world-space offset of the point a
//                                                   relief `depth` metres deep shows along the view ray; offset-limited
//                                                   (no smear at grazing views). Sample again at wp + shift with the
//                                                   UNSHIFTED gradients (textureGrad), so the mip level never jumps.
//   vec3  mgRlSunProbe(vec3 wp, vec3 N, float depth, float reach)  where to read the height toward the key light
//   float mgRlSelfShadow(vec3 N, float h, float hL, float reach, float soft)   1 lit .. 0 in the relief's own shadow;
//                                                   scale the DIRECT light by it (RELIEF_LIGHT)
//   vec2  mgRlGradQ(fx, fy, qx, qy) / mgRlLip(m, g, sunQ, ln, lip)   a recess cut by a smooth mask field: the lip's
//                                                   cast shadow (.x) and the edge occlusion (.y) from screen derivatives
//   float mgRlArris(vec3 wn, vec3 T)                0 on a wall face, 1 across a rounded corner / chamfered reveal
//                                                   (T = the wall's along direction)
//   float mgRlRenderH(vec3 wp, vec3 wn, float und, float swp)   a hand-applied render's height in METRES: slow
//                                                   undulation (amplitude und) plus overlapping trowel swipes (swp);
//                                                   use as mgBump(normal, h, 1.0)
//   float mgRlRenderK(vec3 wp)                      its distance fade (no derivatives: safe in branches)
//   float mgRlSh                                    the self-shadow the texture layer's relief taps leave (1 = lit)
// Switch and reach: setRelief(level) (0 off: every relief branch is skipped by one uniform test; 1 full; between
// shortens the fade distance). ponytail: the two uniforms are shared by every world on the page; give each world
// its own object if two worlds ever need different settings.
// ---------------------------------------------------------------------------

/** The relief's uniforms (kept by reference in every material that opts in). */
export const RELIEF = {
  uRelief: { value: 1 },
  uReliefFar: { value: 8 },        // metres: parallax and self-shadow fade between 0.6 x far and far
};

/** 0 = off (the relief code still compiled, skipped by one test), 1 = full; in between shortens the reach. */
export function setRelief(level = 1) {
  const l = Math.max(0, Math.min(1, +level || 0));
  RELIEF.uRelief.value = l > 0 ? 1 : 0;
  RELIEF.uReliefFar.value = 8 * Math.max(0.4, l);
  return l;
}

export const RELIEF_GLSL = /* glsl */ `
#ifndef MG_RELIEF
#define MG_RELIEF
uniform float uRelief;
uniform float uReliefFar;
float mgRlSh = 1.0;
float mgRlFade(vec3 wp){
  if (isOrthographic || uRelief <= 0.0) return 0.0;
  return 1.0 - smoothstep(uReliefFar * 0.6, uReliefFar, length(cameraPosition - wp));
}
vec3 mgRlShift(vec3 wp, vec3 N, float h, float depth){
  vec3 V = normalize(cameraPosition - wp);
  float vn = dot(V, N);
  return -(V - N * vn) / max(vn, 0.4) * (0.5 - h) * depth;     // never more than ~2.5 depths sideways
}
// the key light's direction along the surface, scaled to rise one unit per unit run along the normal
vec3 mgRlSunT(vec3 N, out float ln){
  ln = dot(uKeyDir, N);
  return (uKeyDir - N * ln) / max(ln, 0.12);
}
vec3 mgRlSunProbe(vec3 wp, vec3 N, float depth, float reach){
  float ln; vec3 t = mgRlSunT(N, ln) * depth * reach;
  float l = length(t);
  return wp + (l > 0.07 ? t * (0.07 / l) : t);                 // capped at 7 cm sideways
}
// the ray toward the light is 'reach' (in depth units) higher at the probe: shadowed where the relief there (hL)
// stands above it. Faces turned from the light return 1 (already dark).
float mgRlSelfShadow(vec3 N, float h, float hL, float reach, float soft){
  if (dot(uKeyDir, N) <= 0.0) return 1.0;
  return 1.0 - smoothstep(0.0, soft, hL - h - reach);
}
// gradient of a smooth field f in surface coordinates q, from f's and q's screen derivatives (taken in uniform
// control flow by the caller): df/dq per metre
vec2 mgRlGradQ(float fx, float fy, vec2 qx, vec2 qy){
  float det = qx.x * qy.y - qx.y * qy.x;
  if (abs(det) < 1e-12) return vec2(0.0);
  return vec2(qy.y * fx - qx.y * fy, -qy.x * fx + qx.x * fy) / det;
}
// a recess where m = f - threshold > 0, g = df/dq, sunQ = the light's direction in q, ln its incidence on the face,
// lip = the recess depth (m). .x = the lip's shadow on the recess floor (1 lit .. 0), .y = edge occlusion (1 .. 0)
vec2 mgRlLip(float m, vec2 g, vec2 sunQ, float ln, float lip){
  float gl = length(g);
  if (m <= 0.0 || gl < 1e-4) return vec2(1.0);
  float occ = smoothstep(0.0, lip * 1.8, m / gl);
  float sl = length(sunQ);
  if (ln <= 0.02 || sl < 1e-4) return vec2(1.0, occ);
  float toward = -dot(g, sunQ / sl);
  if (toward <= 1e-4) return vec2(1.0, occ);
  float shadowLen = lip * sl / max(ln, 0.12);
  return vec2(smoothstep(0.75, 1.15, (m / toward) / max(shadowLen, 1e-4)), occ);
}
float mgRlArris(vec3 wn, vec3 T){
  float a = abs(dot(normalize(wn.xz + 1e-6), normalize(T.xz + 1e-6)));
  return smoothstep(0.12, 0.42, a) * (1.0 - smoothstep(0.86, 0.97, a)) * (1.0 - smoothstep(0.55, 0.8, abs(wn.y)));
}
// 2-D value noise 0..1 on four lattice hashes (mgValue2 goes through the 3-D one: eight)
float mgRlValue2(vec2 p){
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float a = mgHash3(vec3(i, 5.0)).x, b = mgHash3(vec3(i + vec2(1, 0), 5.0)).x;
  float c = mgHash3(vec3(i + vec2(0, 1), 5.0)).x, d = mgHash3(vec3(i + vec2(1, 1), 5.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// the hand-applied render: two octaves of slow undulation (~0.5 and ~0.22 m, what a raking light picks out) and
// overlapping fan-shaped trowel strokes (~0.3 x 0.2 m cells, each thick at its leading edge, soft lap lines).
// Wall coordinates (along the wall, y) on walls, xz on tops. Height in metres.
float mgRlRenderH(vec3 wp, vec3 wn, float und, float swp){
  vec2 tg = normalize(vec2(-wn.z, wn.x) + vec2(1e-5, 0.0));
  vec2 q = abs(wn.y) < 0.7 ? vec2(dot(wp.xz, tg), wp.y) : wp.xz;
  float h = und * (0.65 * (mgRlValue2(q * 2.1 + 3.7) * 2.0 - 1.0) + 0.35 * (mgRlValue2(q * 4.6 + 11.3) * 2.0 - 1.0));
  if (swp > 0.0) {
    vec2 cq = q / vec2(0.3, 0.17);
    vec2 ci = floor(cq), cs = step(0.5, fract(cq)) * 2.0 - 1.0;   // only the 2 x 2 nearest cells
    float best = 0.0, bm = 0.0;
    for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j)) * cs;
      vec3 r = mgHash3(vec3(c, 7.0));
      vec2 ctr = (c + 0.2 + 0.6 * r.xy) * vec2(0.3, 0.17);
      float a = r.z * 6.2831853;
      vec2 dir = normalize(vec2(cos(a), sin(a) * 0.6 + 0.4));      // mostly sideways and up, as an arm sweeps
      vec2 p = q - ctr;
      float al = dot(p, dir) / 0.3, ac = dot(p, vec2(-dir.y, dir.x)) / 0.1;
      // a stroke reaches at most 0.7 cells from its centre: the 2 x 2 set never drops one that still shows, and
      // every term below is 0 at the stroke's rim, so the height has no steps (a step bumps into a 1-px line)
      vec2 e = abs(p) / vec2(0.3, 0.17);
      float m = (1.0 - smoothstep(0.55, 1.0, length(vec2(al, ac * (1.0 + 0.35 * al)))))
              * (1.0 - smoothstep(0.45, 0.7, e.x)) * (1.0 - smoothstep(0.45, 0.7, e.y));
      if (m <= 0.0) continue;
      float v = m * (0.5 + 0.5 * clamp(al, -1.0, 1.0) + r.x * 0.2);
      best = max(best, v) + 0.08 * exp(-abs(best - v) * 14.0) * min(m, bm);   // a soft ridge where one laps the next
      bm = max(bm, m);
    }
    h += swp * best;
  }
  return h;
}
// full to 4 m, gone by 10 m, off in orthographic views and while switched off
float mgRlRenderK(vec3 wp){
  if (isOrthographic || uRelief <= 0.0) return 0.0;
  return 1.0 - smoothstep(4.0, 10.0, length(cameraPosition - wp));
}
#endif
`;

/** `lighting` hook snippet: the relief's self-shadow on the direct light (key light and lamps; ambient stays). */
export const RELIEF_LIGHT = 'reflectedLight.directDiffuse *= mgRlSh; reflectedLight.directSpecular *= mgRlSh;';

/** The relief GLSL and uniforms put in front of a hooks object's fragmentDecl (for materials with their own GLSL). */
export function withRelief(h = {}) {
  return { ...h, fragmentDecl: RELIEF_GLSL + (h.fragmentDecl || ''), uniforms: { ...(h.uniforms || {}), ...RELIEF } };
}

/** GLSL statements for a render relief on a hooks object: `float <v>` = the render's height (m), faded; 0 far away.
 *  und / swipe in metres (e.g. 0.009 / 0.006 for lime plaster, 0.008 / 0.0056 for mud). Bump it in the `normal` hook
 *  with mgBump(normal, v, 1.0) and shade the hollows with renderShade(v) in `output`. */
export function renderHeight(v, und, swipe = und * 0.7, wp = 'mgWorldPos', wn = 'normalize(mgWorldNormal)') {
  const n = (x) => (+x).toFixed(5);
  return `float ${v} = 0.0; { float k = mgRlRenderK(${wp}); if (k > 0.0) ${v} = k * mgRlRenderH(${wp}, ${wn}, ${n(und)}, ${n(swipe)}); }`;
}
/** `output` hook snippet: a little shade in the render's hollows (h in metres from renderHeight). */
export const renderShade = (v) => `outgoingLight *= 1.0 + 4.0 * ${v};`;

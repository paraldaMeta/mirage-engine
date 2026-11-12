// Mirage original code.
// ---------------------------------------------------------------------------
// The surface library's weathering decals: the rules that place them (rills under a ledge, damp at the base, leaks
// under fixings, stains, soot, cracks) as GLSL for the surface hooks, the eight masks the atlas is baked from, and the
// rules' options as uniforms. Registered with the framework (registerSurfaceDecals) by index.js.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { NOISE_GLSL } from '@miragekit/core/noise';

// decals placed by rules (DECAL_GLSL): only with options.decals (a define; uniforms msDa, msDb)
export const DECAL_GLSL = /* glsl */ `
uniform vec4 msDa;   // rills: top (m), length (m), density;  damp height (m)
uniform vec4 msDb;   // stains, cracks, soot, leaks spacing (m)
uniform sampler2D msDecalAtlas;
// one cell of the atlas (4 x 2 masks): id 0 crack, 1 crack net, 2 rill, 3 drip, 4 soot, 5 stain, 6 leak, 7 splash
float msDecal(int id, vec2 q){
  if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return 0.0;
  vec2 c = vec2(float(id % 4), float(id / 4));
  return textureLod(msDecalAtlas, (c + clamp(q, 0.004, 0.996)) / vec2(4.0, 2.0), 0.0).r;
}
float msDecalScatter(int id, vec2 q, vec2 cell, vec2 size, float density, float seed){
  vec2 id2 = floor(q / cell), f = q - id2 * cell;
  vec3 h = mgHash3(vec3(id2, seed));
  if (h.z > density) return 0.0;
  vec2 o = (cell - size) * h.xy;
  return msDecal(id, (f - o) / size);
}
void msDecals(inout MsS s, vec3 wp, vec3 wn){
  vec3 T = vec3(-wn.z, 0.0, wn.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1, 0, 0);
  vec2 q = vec2(dot(wp, T), wp.y);
  float wall = smoothstep(0.3, 0.6, 1.0 - abs(wn.y));
  float dark = 0.0, rust = 0.0, white = 0.0, wet = 0.0, crackM = 0.0;
  if (msDa.z > 0.0) {   // rain rills hanging from a ledge at msDa.x
    float y = (msDa.x - q.y) / msDa.y;
    float r = msDecalScatter(2, vec2(q.x, y * 0.7), vec2(0.35, 1.0), vec2(0.3, 0.7), msDa.z, 3.0);
    dark = max(dark, r * step(0.0, y) * 0.8);
  }
  if (msDa.w > 0.0) {   // damp rising from the ground, a salt tide line on top
    float hy = wp.y - msG.w, top = msDa.w * (0.75 + 0.35 * (mgFbm3(wp * vec3(1.2, 0.0, 1.2), 3) * 0.5 + 0.5));
    float damp = 1.0 - smoothstep(top - 0.06, top, hy);
    float tide = (1.0 - smoothstep(0.0, 0.025, abs(hy - top + 0.02)));
    dark = max(dark, damp * 0.6); white = max(white, tide * 0.5); wet = max(wet, damp);
  }
  if (msDb.x > 0.0) dark = max(dark, 0.55 * msDecalScatter(5, q, vec2(2.2, 2.0), vec2(1.0, 1.0), msDb.x, 5.0));
  if (msDb.y > 0.0) crackM = max(msDecalScatter(0, q, vec2(3.0, 2.6), vec2(1.6, 2.2), msDb.y, 7.0), msDecalScatter(1, q + 1.3, vec2(2.4, 2.4), vec2(1.2, 1.2), msDb.y * 0.5, 8.0));
  if (msDb.z > 0.0) dark = max(dark, 0.85 * msDecalScatter(4, q, vec2(4.0, 3.5), vec2(1.4, 2.6), msDb.z, 9.0));
  if (msDb.w > 0.0) {   // leaks under fixings: every msDb.w metres along the wall, a rust run below a fixing row at msDa.x
    float y = (msDa.x - 0.05 - q.y);
    vec2 lq = vec2(mod(q.x, msDb.w) - 0.5 * msDb.w + 0.05, y) / vec2(0.12, 0.8) + vec2(0.5, 0.0);
    rust = max(rust, msDecal(6, lq) * step(0.4, mgHash3(vec3(floor(q.x / msDb.w), 3.0, 1.0)).x));
  }
  dark *= wall; rust *= wall; white *= wall; crackM *= wall;
  s.a *= 1.0 - 0.55 * dark;
  s.r = mix(s.r, max(s.r - 0.15, 0.3), wet * wall);
  s.a = mix(s.a, vec3(0.62, 0.6, 0.55), white);
  s.a = mix(s.a, msRustCol(0.4), rust * 0.85); s.r = mix(s.r, 0.9, rust); s.m *= 1.0 - rust;
  s.a *= 1.0 - 0.75 * crackM; s.h -= 0.3 * crackM; s.ao *= 1.0 - 0.5 * crackM;
}
`;

// the atlas baker: eight masks in 4 x 2 cells (bakeDecalAtlas renders it once)
export const DECAL_FS = `precision highp float; precision highp int;
uniform float msN;
${NOISE_GLSL}
layout(location = 0) out vec4 o0;
float fbm(vec2 p, int o){ return mgFbm2(p, o); }
void main(){
  vec2 px = gl_FragCoord.xy / msN;              // atlas 0..1 (4 x 2 cells)
  vec2 cell = floor(px * vec2(4.0, 2.0)), q = fract(px * vec2(4.0, 2.0));
  int id = int(cell.x + 4.0 * cell.y);
  float m = 0.0, fade = smoothstep(0.0, 0.08, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y)));
  if (id == 0) {        // one long crack, wandering down, a branch, its width varying
    float x = 0.5 + 0.18 * fbm(vec2(q.y * 3.0, 1.0), 4);
    float w = 0.004 + 0.006 * (fbm(vec2(q.y * 9.0, 4.0), 2) * 0.5 + 0.5);
    m = 1.0 - smoothstep(w, w + 0.004, abs(q.x - x));
    float bx = x + (q.y - 0.55) * 0.6 + 0.05 * fbm(vec2(q.y * 8.0, 7.0), 3);
    m = max(m, (1.0 - smoothstep(0.003, 0.006, abs(q.x - bx))) * step(q.y, 0.55) * step(0.25, q.y));
  } else if (id == 1) { // a crack network (shrinkage)
    vec2 p = q * 5.0 + 0.15 * vec2(fbm(q * 8.0, 2), fbm(q * 8.0 + 3.0, 2));
    vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(float(x), float(y)); vec2 r = o + mgHash3(vec3(i + o, 2.0)).xy - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else d2 = min(d2, d); }
    m = 1.0 - smoothstep(0.02, 0.05, sqrt(d2) - sqrt(d1));
    m *= smoothstep(0.55, 0.3, length(q - 0.5));
  } else if (id == 2) { // rain rills from a ledge: thin dark runs of random length, joined at the top
    float x = q.x * 9.0, k = floor(x), f = fract(x) - 0.5 + 0.12 * fbm(vec2(q.y * 4.0, k), 2);
    float len = 0.35 + 0.65 * mgHash3(vec3(k, 1.0, 2.0)).x;
    m = (1.0 - smoothstep(0.1, 0.3, abs(f))) * (1.0 - smoothstep(len * 0.7, len, q.y)) + (1.0 - smoothstep(0.0, 0.12, q.y)) * 0.6;
    m *= 0.6 + 0.4 * (fbm(q * vec2(6.0, 30.0), 2) * 0.5 + 0.5);
  } else if (id == 3) { // a drip: a long run with a bulb at its end
    float f = abs(q.x - 0.5 - 0.02 * fbm(vec2(q.y * 5.0, 3.0), 2));
    m = (1.0 - smoothstep(0.02, 0.05, f)) * step(q.y, 0.85) + (1.0 - smoothstep(0.05, 0.08, length(q - vec2(0.5, 0.88))));
  } else if (id == 4) { // soot plume: from a source at the bottom, spreading upward
    float spread = 0.08 + 0.35 * q.y;
    float n = fbm(q * vec2(3.0, 2.0) + vec2(0.0, -q.y), 4) * 0.5 + 0.5;
    m = (1.0 - smoothstep(spread * 0.4, spread, abs(q.x - 0.5))) * (1.0 - smoothstep(0.6, 1.0, q.y)) * (0.5 + 0.7 * n);
  } else if (id == 5) { // a water stain with a tide ring
    float r = length(q - 0.5) * 2.0 + 0.15 * fbm(q * 5.0, 3);
    m = (1.0 - smoothstep(0.7, 0.85, r)) * 0.45 + (1.0 - smoothstep(0.0, 0.05, abs(r - 0.8))) * 0.6;
  } else if (id == 6) { // a rust leak under a fixing: dense at the top, thinning down
    float f = abs(q.x - 0.5 - 0.04 * fbm(vec2(q.y * 4.0, 5.0), 2));
    m = (1.0 - smoothstep(0.04 + 0.12 * q.y, 0.08 + 0.2 * q.y, f)) * (1.0 - smoothstep(0.2, 1.0, q.y)) * (0.7 + 0.3 * fbm(q * 12.0, 2));
  } else {              // splash-back: speckle along the bottom edge
    m = step(0.75, fbm(q * 40.0, 2) * 0.5 + 0.5 + 0.4 * (1.0 - q.y)) * (1.0 - smoothstep(0.0, 0.5, q.y));
  }
  o0 = vec4(clamp(m, 0.0, 1.0) * fade, 0.0, 0.0, 1.0);
}`;

/** options.decals { rills: { top, length, density }, damp, stains, cracks, soot, leaks } as the rules' uniforms */
export function decalUniforms(d) {
  const r = d.rills || {}, lk = d.leaks || {};
  return {
    msDa: { value: new THREE.Vector4(+(r.top ?? lk.top ?? 3), +(r.length ?? 1.2), +(r.density ?? (d.rills ? 0.6 : 0)), +(d.damp ?? 0)) },
    msDb: { value: new THREE.Vector4(+(d.stains ?? 0), +(d.cracks ?? 0), +(d.soot ?? 0), +(typeof lk === 'number' ? lk : lk.spacing ?? 0)) },
  };
}

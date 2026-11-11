// rain-beads: rain on a smooth object's surface, as material hooks (not a module). rainBeads(hooks, options) returns
// the hooks with beads and runs added (compose it inside withWet, which then adds its wet film on top):
//  - beads: two sizes of hashed drops in world space (1.4 cm and 0.6 cm cells), each a lens: its normal bends out
//    from the centre (so every bead carries its own small highlight of each lamp and sign) and its roughness drops
//    to a mirror; denser on flat tops, fewer and pulled long on vertical panels;
//  - runs: on steep panels some drops run down their own column slowly (uTime), leaving a thin wet track above;
//  - splashes: rings opening on up-facing panels, as many as the rain is heavy (the page's rain level, WET.uRain);
//  - a wet film darker and glossier at the foot of vertical panels.
// Stability: all of it is in metres on the surface; where a cell gets smaller than about a pixel the beads fade into
// a uniformly wet (lower roughness) surface instead of sparkling, and patch()'s specular AA widens what is left.
// Options: scale (cell size factor), density (0..1), run (0..1 the share of running drops), film (0..1).
import { WET } from '@miragekit/core';

const DECL = /* glsl */ `
vec3 ndBeadW; float ndBeadC; float ndTrack;
vec2 ndH2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float ndH1(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
// one layer of beads on the plane (u, v), cell size c (m); returns the lens's slope (in u, v) and coverage in .z
vec3 ndBeadLayer(vec2 uv, float c, float dens, float stretch){
  vec2 g = uv / c, id = floor(g), f = fract(g) - 0.5;
  vec2 h = ndH2(id); float hz = ndH1(id + 7.3);
  if (hz > dens) return vec3(0.0);
  vec2 d = f - (h - 0.5) * 0.45; d.y /= stretch;
  float r = 0.16 + 0.24 * fract(hz * 13.7);
  float q = length(d) / r;
  if (q > 1.0) return vec3(0.0);
  float edge = smoothstep(1.0, 0.82, q);
  return vec3(d / r * (0.6 + 0.9 * q), edge);
}`;

export function rainBeads(h = {}, { scale = 1, density = 0.62, run = 0.5, film = 0.6, strength = 1 } = {}) {
  const S = scale.toFixed(3), N = density.toFixed(3), RU = run.toFixed(3), FI = film.toFixed(3), K = strength.toFixed(3);
  const albedo = /* glsl */ `{
    vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
    float up = n.y;
    // a frame on the surface: t across, b up the slope (on a flat top: x and z)
    vec3 t = abs(up) > 0.92 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 b = normalize(cross(n, t));
    vec2 uv = vec2(dot(p, t), dot(p, b));
    float steep = 1.0 - smoothstep(0.35, 0.85, abs(up));
    float stretch = 1.0 + 0.6 * steep;
    float wetK = clamp(ndRain * 1.5 + 0.35, 0.0, 1.0);
    vec3 a = ndBeadLayer(uv, 0.014 * ${S}, ${N} * mix(1.0, 0.55, steep) * wetK, stretch);
    vec3 c = ndBeadLayer(uv + 3.7, 0.006 * ${S}, ${N} * 0.9 * wetK, stretch);
    vec3 L = a.z >= c.z ? a : c;
    // runs: in columns 7 mm wide, a drop slides down its column; the track above it stays wet
    ndTrack = 0.0;
    if (steep > 0.2) {
      float col = floor(uv.x / (0.007 * ${S})), hc = ndH1(vec2(col, 3.1));
      if (hc < ${RU} * 0.35 * wetK) {
        float sp = 0.012 + 0.03 * fract(hc * 91.0), y = uv.y + uTime * sp + hc * 40.0;
        float cell = 0.09 + 0.12 * fract(hc * 17.0), fy = fract(y / cell) * cell, fx = fract(uv.x / (0.007 * ${S})) - 0.5;
        vec2 dd = vec2(fx * 0.007 * ${S}, (fy - 0.01) * 0.6) / 0.0032;
        float head = length(dd);
        if (head < 1.0) L = vec3(dd * 0.9, smoothstep(1.0, 0.8, head));
        ndTrack = step(abs(fx), 0.22) * smoothstep(0.0, cell * 0.8, fy) * (1.0 - step(cell * 0.8, fy)) * 0.7;
      }
    }
    // splashes: rings that open and fade on up-facing panels
    if (up > 0.6 && ndRain > 0.0) {
      vec2 g = uv / 0.05, id = floor(g), f = fract(g) - 0.5 - (ndH2(id + 1.3) - 0.5) * 0.6;
      float ph = fract(uTime * (0.7 + 0.6 * ndH1(id)) + ndH1(id + 9.1)), rr = ph * 0.45, d = length(f);
      float ring = smoothstep(0.035, 0.0, abs(d - rr)) * (1.0 - ph) * step(ndH1(id + 4.4), ndRain * 0.8);
      L.xy += normalize(f + 1e-4) * ring * 1.5; L.z = max(L.z, ring * 0.6);
    }
    // fade the pattern out where a small cell is under a pixel: a uniformly wet surface instead of sparkle
    float px = max(length(fwidth(uv)) / (0.006 * ${S}), 0.0);
    float vis = 1.0 - smoothstep(0.35, 1.1, px);
    ndBeadC = L.z * vis;
    ndBeadW = (t * L.x + b * L.y) * ${K} * vis;
    // the beads darken what is under them a little; a wet film gathers at the foot of a vertical panel
    float foot = steep * smoothstep(0.75, 0.2, p.y) * ${FI};
    diffuseColor.rgb *= (1.0 - 0.18 * ndBeadC) * (1.0 - 0.25 * foot);
    ndTrack = max(ndTrack * vis, foot * 0.6);
  }`;
  const roughness = 'roughnessFactor = mix(mix(roughnessFactor, roughnessFactor * 0.55, ndTrack), 0.03, ndBeadC);';
  const normal = '{ vec3 nw = normalize(normalize(mgWorldNormal) + ndBeadW * 1.6); vec3 nv = normalize((viewMatrix * vec4(nw, 0.0)).xyz); normal = normalize(mix(normal, nv, clamp(ndBeadC * 1.4, 0.0, 1.0))); }';
  const join = (a, b) => (a ? a + '\n' + b : b);
  return {
    ...h,
    fragmentDecl: 'uniform float ndRain;\n' + DECL + (h.fragmentDecl || ''),
    albedo: join(h.albedo, albedo),
    roughness: join(h.roughness, roughness),
    normal: join(h.normal, normal),
    uniforms: { ...(h.uniforms || {}), ndRain: WET.uRain },
  };
}

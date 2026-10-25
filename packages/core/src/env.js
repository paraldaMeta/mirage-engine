// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The light state of ONE world.
//
//   const env = createEnv({ wind: { dir: [0.8, 0.6], strength: 1 } });
//   env.keyDir   THREE.Vector3 toward the key light (the Sun by day, the Moon at night), rewritten in place
//   env.G        shared uniforms ({ value } objects). Every patch()ed material of this world references these
//                same objects, so one write reaches every shader.
//
// Frame: metres, +X east, +Y up, +Z south (north is -Z). Azimuths are compass bearings (0 north, 90 east).
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;
export const AMB_MAX = 8;

/** The reference "golden hour": a low sun in the west-south-west. Exposure and the legacy look are tuned here. */
export const GOLDEN = Object.freeze({ elevation: 6.8, azimuth: 250 });

/** Unit vector (engine frame) toward elevation / compass azimuth in degrees. */
export function dirFromElevAz(elevation, azimuth, out = new THREE.Vector3()) {
  const ce = Math.cos(elevation * D2R);
  return out.set(ce * Math.sin(azimuth * D2R), Math.sin(elevation * D2R), -ce * Math.cos(azimuth * D2R));
}
/** Elevation / azimuth (degrees) of a direction. */
export function elevAzOf(d) {
  const v = d.isVector3 ? d : new THREE.Vector3(...d);
  return { elevation: Math.asin(Math.max(-1, Math.min(1, v.y))) / D2R, azimuth: ((Math.atan2(v.x, -v.z) / D2R) + 360) % 360 };
}

export function createEnv({ wind = {} } = {}) {
  const keyDir = dirFromElevAz(GOLDEN.elevation, GOLDEN.azimuth);
  const w = wind.dir || [0.8, 0.6];
  const G = {
    uTime: { value: 0 },                                   // seconds (animation, wind)
    uFrame: { value: 0 },                                  // sub-frame counter (rarely needed in materials)
    uWind: { value: new THREE.Vector3(w[0] / Math.hypot(w[0], w[1]), w[1] / Math.hypot(w[0], w[1]), wind.strength ?? 1) },   // (dir.x, dir.z, strength)
    uKeyDir: { value: keyDir.clone() },                    // toward the key light
    uKeyColor: { value: new THREE.Vector3(7.0, 4.9, 3.0) },// key radiance (linear RGB x intensity)
    uLamp: { value: 1 },        // lamps / lit windows: 0 off (day) .. 1 lit (night)
    uLampGain: { value: 1 },    // emissive multiplier for lamps (follows the night exposure)
    uSkyLight: { value: 1 },    // sky light relative to the golden hour (for hand-made ambient terms)
    uNight: { value: 0 },       // 0 day .. 1 night
    uUser: { value: new THREE.Vector4() },  // free for the host
    // ambient volumes (world.setAmbientVolumes): boxes where the image-based light is scaled down (interiors)
    uAmbN: { value: 0 },
    uAmbLo: { value: Array.from({ length: AMB_MAX }, () => new THREE.Vector4()) },   // min corner, soft edge (m)
    uAmbHi: { value: Array.from({ length: AMB_MAX }, () => new THREE.Vector4()) },   // max corner, factor inside
  };
  return { keyDir, G };
}

// Ambient volumes: 1 outside every box, `factor` inside, a smooth ramp over `soft` metres outside the box.
// With no volumes the loop does not run and the result is exactly 1.0 (images stay bit-identical).
export const AMBIENT_GLSL = /* glsl */ `
float mgAmbient(vec3 p){
  float k = 1.0;
  for (int i = 0; i < ${AMB_MAX}; i++){
    if (float(i) >= uAmbN) break;
    vec4 lo = uAmbLo[i], hi = uAmbHi[i];
    float d = length(max(max(lo.xyz - p, p - hi.xyz), 0.0));
    k *= mix(hi.w, 1.0, smoothstep(0.0, max(lo.w, 1e-3), d));
  }
  return k;
}
`;

// Wind sway for vertex hooks: mgWind(worldPos, flex) -> world-space offset (flex 0 at the root, 1 at the tips).
// Two travelling gust waves along the wind, a slower sway and a small high-frequency flutter.
export const WIND_GLSL = /* glsl */ `
vec3 mgWind(vec3 p, float flex){
  vec2 d = uWind.xy;
  float along = dot(p.xz, d);
  float gust = 0.6 + 0.4 * sin(uTime * 0.41 - along * 0.07) * cos(uTime * 0.19 + p.x * 0.013 - p.z * 0.017);
  float sway = sin(uTime * 1.17 - along * 0.21 + p.y * 0.3) * 0.7 + sin(uTime * 1.93 + p.x * 0.27 - p.z * 0.31) * 0.3;
  float flut = sin(uTime * 6.3 + dot(p, vec3(2.3, 1.9, 2.7))) * 0.6 + sin(uTime * 9.7 + dot(p, vec3(3.1, 2.2, 1.7))) * 0.4;
  vec3 o = vec3(d.x, 0.0, d.y) * (0.05 * gust + 0.045 * sway) + vec3(-d.y, 0.6, d.x) * flut * 0.012;
  return o * flex * uWind.z;
}
`;

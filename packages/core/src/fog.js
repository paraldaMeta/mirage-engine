// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Aerial perspective and height fog inside every material (so reflections, sprites and particles get the same
// haze as the direct view). It replaces three's fog chunks ONLY for scenes with THREE.FogExp2: a scene with
// linear THREE.Fog or no fog compiles three's stock code unchanged. Same for the shadow filter below.
//
//   scene.fog = new THREE.FogExp2(color, 1)   color = ambient haze colour, density = a multiplier (1 = as set)
//   FOG.params: [groundDensity /m, scale height m, air density /m, ground level y]
//   FOG.light:  [toward-light x, y, z, Henyey–Greenstein g]   FOG.glow: rgb glow toward the light
//
// The three arrays are added to three's built-in uniform sets as typed arrays, which three keeps by reference
// when it clones uniforms per material: one write reaches every program. They are page-global (three's chunks
// are), so the world renderer writes its own fog state into them before it renders.
// ---------------------------------------------------------------------------

export const FOG = {
  params: new Float32Array([0.0016, 18, 0.00012, 0]),
  light: new Float32Array([0, 1, 0, 0.76]),
  glow: new Float32Array([0, 0, 0]),
};

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  for (const lib of [THREE.UniformsLib.fog, ...Object.values(THREE.ShaderLib).map((s) => s.uniforms)]) {
    if (lib && lib.fogColor && !lib.mgFogP) { lib.mgFogP = { value: FOG.params }; lib.mgFogL = { value: FOG.light }; lib.mgFogGlow = { value: FOG.glow }; }
  }
  const C = THREE.ShaderChunk;
  const only = (mine, stock) => `#if defined( USE_FOG ) && defined( FOG_EXP2 )\n${mine}\n#else\n${stock}\n#endif\n`;
  C.fog_pars_vertex = only('varying vec3 mgFogPos;', C.fog_pars_vertex);
  // world position from the view-space one (works for meshes, instances, points and sprites alike)
  C.fog_vertex = only('mgFogPos = cameraPosition + mvPosition.xyz * mat3( viewMatrix );', C.fog_vertex);
  C.fog_pars_fragment = only(/* glsl */ `
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec4 mgFogP, mgFogL;
uniform vec3 mgFogGlow;
varying vec3 mgFogPos;
vec3 mgAerial(vec3 c, vec3 wp){
  vec3 V = wp - cameraPosition;
  float dist = length(V);
  float H = mgFogP.y;
  float k = V.y / H;
  // integral of the exponential height layer along the segment, plus thin uniform air
  float layer = exp(-(cameraPosition.y - mgFogP.w) / H) * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k);
  float od = (mgFogP.x * layer + mgFogP.z) * dist * fogDensity;
  float T = exp(-od);
  float mu = dot(V / max(dist, 1e-4), mgFogL.xyz);
  float g = mgFogL.w;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5);
  vec3 inscatter = fogColor + mgFogGlow * min(hg * 0.25, 6.0);
  return c * T + inscatter * (1.0 - T);
}`, C.fog_pars_fragment);
  C.fog_fragment = only('gl_FragColor.rgb = mgAerial( gl_FragColor.rgb, mgFogPos );', C.fog_fragment);
  // three rotates its PCF taps with per-pixel screen noise, which crawls when the camera moves. Mirage's
  // softness comes from moving the light across the solar disc between sub-frames, so use a fixed rotation.
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replaceAll(
    'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;',
    '#ifdef FOG_EXP2\nfloat phi = 0.7;\n#else\nfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;\n#endif');
}

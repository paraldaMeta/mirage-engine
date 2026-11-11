// The bridge between the two material systems. Nizwa's world code calls ctx.mat.patch / std / phys with ITS hook
// names and writes GLSL against ITS names; this hands the same hooks to Mirage's patch(), so those materials are
// Mirage materials: Mirage's fog, ambient volumes, light2 lamp shadows, soft sun shadows and day–night uniforms
// apply to them, and Nizwa's own patch() never runs (vite.config.js routes it here).
//
//   Nizwa hook      Mirage hook        note
//   vertexHead      vertexDecl
//   vertexWorld     vertexWorld        Nizwa edits `vec4 wPos4`, Mirage `vec3 mgWorld`: wrapped
//   fragHead        fragmentDecl
//   fragColor       albedo             fragRough -> roughness, fragMetal -> metalness, fragNormal -> normal,
//   fragEmissive    emissive           fragLight -> lighting, fragEnd -> output
//   fragPhysical    (none)             Mirage has no hook after <lights_physical_fragment>: reported, not applied
//
//   Nizwa name      Mirage name        vWPos -> mgWorldPos, vWNrm -> mgWorldNormal, uSunDir -> uKeyDir,
//                                      uSunColor -> uKeyColor (#define); uTime, uLamp, uNight are the same names
//   uWindDir, uWindStrength, uShot, uLampE, uAmbK, uBakedSun: Nizwa's own uniform objects, kept in step with
//   Mirage's by compat/ctx.js (uWind, uLampGain, uSkyLight)
//   the n_* noise library and windOffset(): Nizwa's GLSL, added to the declarations (Mirage's are mg*)
import { NOISE } from '@nizwa/core/glsl.js';
import { G as NZG, WIND_GLSL } from '@nizwa/core/env.js';

const NAMES = /* glsl */ `
#define vWPos mgWorldPos
#define vWNrm mgWorldNormal
#define uSunDir uKeyDir
#define uSunColor uKeyColor
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uShot;
uniform float uLampE;
uniform float uAmbK;
uniform float uBakedSun;
${NOISE}
`;
const FRAG_UTIL = /* glsl */ `
vec3 n_bumpView(vec3 p, vec3 n, float h, float strength){
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - strength * grad);
}
vec3 n_worldNormalFromView(vec3 nv){ return normalize((vec4(nv, 0.0) * viewMatrix).xyz); }
`;
const UNIFORMS = { uWindDir: NZG.uWindDir, uWindStrength: NZG.uWindStrength, uShot: NZG.uShot, uLampE: NZG.uLampE, uAmbK: NZG.uAmbK, uBakedSun: NZG.uBakedSun };

let kit = null;
export const stats = { patched: 0, fragPhysical: 0, hooks: {} };
/** the Mirage world whose material kit (and uniforms) the bridged materials use */
export function bind(world) { kit = world.mat; }

export function patch(mat, o = {}) {
  if (!kit) throw new Error('nizwa-probe: compat/patch.js used before bind(world)');
  mat.userData.patch = o;   // Nizwa code reads a material's hooks back (town-doors.js doorMaterial)
  stats.patched++;
  for (const k of Object.keys(o)) if (o[k]) stats.hooks[k] = (stats.hooks[k] || 0) + 1;
  if (o.fragPhysical) stats.fragPhysical++;
  return kit.patch(mat, {
    vertexDecl: NAMES + WIND_GLSL + (o.vertexHead || ''),
    vertexWorld: o.vertexWorld ? `vec4 wPos4 = vec4( mgWorld, 1.0 );\n${o.vertexWorld}\nmgWorld = wPos4.xyz;` : '',
    fragmentDecl: NAMES + FRAG_UTIL + (o.fragHead || ''),
    albedo: o.fragColor, roughness: o.fragRough, metalness: o.fragMetal, normal: o.fragNormal,
    emissive: o.fragEmissive, lighting: o.fragLight, output: o.fragEnd,
    uniforms: { ...UNIFORMS, ...(o.uniforms || {}) }, defines: o.defines,
    specAA: false,   // Nizwa's materials call their own nzSpecAA where they want it
  });
}

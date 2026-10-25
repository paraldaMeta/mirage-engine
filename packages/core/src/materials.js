// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { WIND_GLSL, AMBIENT_GLSL } from './env.js';
import { hash32 } from './rng.js';

// ---------------------------------------------------------------------------
// patch(material, hooks, G): procedural GLSL inside three's own Standard / Physical / Lambert / Basic / Depth
// materials, so surfaces keep three's lighting, shadows, image-based light and Mirage's fog.
//
// In scope in both stages: varying vec3 mgWorldPos, mgWorldNormal (normalise it); the uniforms of G (uTime,
// uWind, uKeyDir, uKeyColor, uLamp, uLampGain, uSkyLight, uNight, uUser, uFrame) and the mg* noise library.
// Vertex: mgWind(worldPos, flex). Fragment: mgBump(normal, height, strength) -> bumped view-space normal.
//
//   hook          runs                               edit
//   vertexDecl    vertex declarations                attributes, varyings, functions
//   vertexWorld   after the world transform          vec3 mgWorld (world position; wind, sway)
//   fragmentDecl  fragment declarations              globals shared between hooks
//   albedo        after <color_fragment>             diffuseColor (linear)
//   roughness     after <roughnessmap_fragment>      roughnessFactor
//   metalness     after <metalnessmap_fragment>      metalnessFactor
//   normal        after <normal_fragment_maps>       normal (view space)
//   emissive      after <emissivemap_fragment>       totalEmissiveRadiance
//   lighting      after <lights_fragment_end>        reflectedLight (e.g. translucency)
//   output        before <opaque_fragment>           outgoingLight
//   uniforms, defines                                extra uniforms (kept by reference) and defines
// Materials with identical hooks share one program (the cache key is a hash of the hooks).
// ---------------------------------------------------------------------------

const FRAG_HOOKS = {
  albedo: '#include <color_fragment>', roughness: '#include <roughnessmap_fragment>', metalness: '#include <metalnessmap_fragment>',
  normal: '#include <normal_fragment_maps>', emissive: '#include <emissivemap_fragment>', lighting: '#include <lights_fragment_end>',
};

const BUMP_GLSL = /* glsl */ `
vec3 mgBump(vec3 n, float h, float k){
  vec3 p = -vViewPosition, dpx = dFdx(p), dpy = dFdy(p);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - k * g);
}
// specular anti-aliasing: widen the lobe by the normal's variance across the pixel, so bumped glossy surfaces
// (water, polished stone) stop sparkling when the camera moves (Kaplanyan-style screen-space variance)
float mgSpecAA(float r, vec3 n){
  vec3 a = dFdx(n), b = dFdy(n);
  return sqrt(clamp(r * r + min(0.5 * (dot(a, a) + dot(b, b)), 0.18), 0.0, 1.0));
}
`;

function uniformDecls(G, amb) {
  const type = (v) => (typeof v === 'number' ? 'float' : v.isVector2 ? 'vec2' : v.isVector3 ? 'vec3' : v.isVector4 ? 'vec4' : v.isMatrix3 ? 'mat3' : 'mat4');
  return Object.entries(G).filter(([k]) => amb || !k.startsWith('uAmb')).map(([k, u]) => Array.isArray(u.value) ? `uniform ${type(u.value[0])} ${k}[${u.value.length}];` : `uniform ${type(u.value)} ${k};`).join('\n');
}

export function patch(material, hooks, G) {
  const key = 'mg' + hash32(JSON.stringify([hooks, Object.keys(G)], (k, v) => (k === 'uniforms' ? Object.keys(v) : v)));
  // ambient-volume code is compiled in only while the world has volumes (setAmbientVolumes recompiles), so a
  // world without them compiles exactly the shaders it did before
  const amb = () => !!(G.uAmbN && G.uAmbN.value > 0);
  if (hooks.defines) material.defines = { ...(material.defines || {}), ...hooks.defines };
  material.userData.hooks = hooks;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G, hooks.uniforms || {});
    const A = amb();
    const head = `varying vec3 mgWorldPos;\nvarying vec3 mgWorldNormal;\n${uniformDecls(G, A)}\n${NOISE_GLSL}\n${A ? AMBIENT_GLSL : ''}\n`;
    let vs = shader.vertexShader;
    const hasNormal = !material.isMeshBasicMaterial && !material.isMeshDepthMaterial && vs.includes('#include <defaultnormal_vertex>');
    vs = vs.replace('#include <common>', `#include <common>\n${head}${WIND_GLSL}\n${hooks.vertexDecl || ''}`);
    vs = vs.replace('#include <project_vertex>', /* glsl */ `
      vec4 mgW4 = vec4( transformed, 1.0 );
      mat3 mgN = mat3( modelMatrix );
      #ifdef USE_BATCHING
        mgW4 = batchingMatrix * mgW4; mgN = mgN * mat3( batchingMatrix );
      #endif
      #ifdef USE_INSTANCING
        mgW4 = instanceMatrix * mgW4; mgN = mgN * mat3( instanceMatrix );
      #endif
      vec3 mgWorld = ( modelMatrix * mgW4 ).xyz;
      mgWorldNormal = ${hasNormal ? 'mgN * objectNormal' : 'vec3( 0.0, 1.0, 0.0 )'};
      ${hooks.vertexWorld || ''}
      mgWorldPos = mgWorld;
      vec4 mvPosition = viewMatrix * vec4( mgWorld, 1.0 );
      gl_Position = projectionMatrix * mvPosition;`);
    // three's world position (shadow coordinates, env maps) must see the displaced point too
    vs = vs.replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( mgWorld, 1.0 );');
    shader.vertexShader = vs;
    const bump = shader.fragmentShader.includes('vViewPosition') ? BUMP_GLSL : '';
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${head}${bump}\n${hooks.fragmentDecl || ''}`);
    // ambient volumes scale the image-based light (sky + world capture) inside interiors
    if (A) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float mgAmb = mgAmbient(mgWorldPos); reflectedLight.indirectDiffuse *= mgAmb; reflectedLight.indirectSpecular *= mgAmb; }');
    for (const [name, inc] of Object.entries(FRAG_HOOKS)) if (hooks[name]) fs = fs.replace(inc, `${inc}\n${hooks[name]}`);
    if (bump && fs.includes('roughnessFactor')) fs = fs.replace('#include <emissivemap_fragment>', 'roughnessFactor = mgSpecAA(roughnessFactor, normal);\n#include <emissivemap_fragment>');
    if (hooks.output) fs = fs.replace('#include <opaque_fragment>', `${hooks.output}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => key + (amb() ? 'a' : '');
  material.needsUpdate = true;
  return material;
}

/** A material kit bound to one world's uniforms. */
export function createMaterials(G) {
  const kit = {
    patch: (m, hooks) => patch(m, hooks, G),
    std: (params, hooks) => kit.patch(new THREE.MeshStandardMaterial(params), hooks || {}),
    phys: (params, hooks) => kit.patch(new THREE.MeshPhysicalMaterial(params), hooks || {}),
    /** a shadow-casting depth material with the same vertex hooks (wind-swayed leaves cast moving shadows) */
    depth: (hooks) => kit.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { vertexDecl: hooks.vertexDecl, vertexWorld: hooks.vertexWorld }),
    /** an emissive lamp: linear RGB x intensity, follows the day–night lamp level (dim glass by day) */
    glow: (rgb, intensity = 6, params = {}) => kit.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity), ...params }),
      { output: 'outgoingLight *= max(uLampGain, 0.03);' }),
    PROC,
  };
  return kit;
}

// ---------------------------------------------------------------------------
// Generic procedural surfaces: functions returning hooks. `base` is a GLSL vec3 expression (linear albedo).
// They declare `float mgH;` (height for the bump) — combine at most one PROC per material.
// ---------------------------------------------------------------------------
export const PROC = {
  /** lime plaster / render: soft trowel waves, rain streaks, a damp foot, scattered chips */
  plaster: (base = 'vec3(0.72, 0.66, 0.56)', { wear = 1, foot = 0.6 } = {}) => ({
    fragmentDecl: 'float mgH;',
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos; vec3 n = normalize(mgWorldNormal);
      float big = mgFbm3(p * 0.3, 4), trowel = mgFbm3(p * vec3(1.4, 3.8, 1.4), 3);
      float wall = 1.0 - smoothstep(0.4, 0.8, abs(n.y));
      float streak = smoothstep(0.1, 0.8, mgFbm3(p * vec3(2.4, 0.16, 2.4) + 3.0, 3)) * wall;
      float chip = smoothstep(0.38, 0.46, mgFbm3(p * 1.6 + 9.0, 4)) * wall * ${(+wear).toFixed(3)};
      vec3 c = ${base} * (0.92 + 0.1 * big + 0.04 * trowel);
      c *= 1.0 - 0.13 * streak * ${(+wear).toFixed(3)};
      c *= mix(1.0 - 0.22 * ${(+foot).toFixed(3)}, 1.0, smoothstep(0.0, 0.9, p.y));
      c = mix(c, ${base} * vec3(0.78, 0.72, 0.66), chip);
      diffuseColor.rgb *= c;
      mgH = trowel * 0.5 + big * 0.3 - chip * 0.7 + mgGrad3(p * 24.0) * 0.05;
    }`,
    normal: 'normal = mgBump(normal, mgH, 0.004);',
  }),
  /** stone blocks in courses (ashlar): per-block tone, recessed joints, worn arrises */
  stone: (base = 'vec3(0.46, 0.41, 0.34)', { course = 0.32, block = 0.62 } = {}) => ({
    fragmentDecl: 'float mgH;',
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos; vec3 n = normalize(mgWorldNormal);
      float u = abs(n.x) > abs(n.z) ? p.z : p.x;
      if (abs(n.y) > 0.7) u = p.x;
      float v = abs(n.y) > 0.7 ? p.z : p.y;
      float row = floor(v / ${course.toFixed(3)});
      vec2 q = vec2(u / ${block.toFixed(3)} + fract(row * 0.618) , v / ${course.toFixed(3)});
      vec2 id = floor(q), fq = fract(q);
      vec2 e = min(fq, 1.0 - fq) * vec2(${block.toFixed(3)}, ${course.toFixed(3)});
      float joint = 1.0 - smoothstep(0.004, 0.018, min(e.x, e.y));
      float tone = mgHash(id + row * 7.0);
      float grain = mgFbm3(p * 5.0, 3);
      vec3 c = ${base} * (0.8 + 0.32 * tone) * (0.92 + 0.1 * grain);
      c = mix(c, ${base} * 0.55, joint * 0.8);
      diffuseColor.rgb *= c;
      mgH = (1.0 - joint) * 0.8 + grain * 0.15;
    }`,
    roughness: 'roughnessFactor = clamp(roughnessFactor + 0.08 * (1.0 - mgH), 0.0, 1.0);',
    normal: 'normal = mgBump(normal, mgH, 0.006);',
  }),
  /** weathered timber; axis 'x' | 'y' | 'z' is the grain direction */
  wood: (base = 'vec3(0.26, 0.16, 0.09)', axis = 'y') => {
    const s = { x: 'vec3(0.35, 12.0, 12.0)', y: 'vec3(12.0, 0.35, 12.0)', z: 'vec3(12.0, 12.0, 0.35)' }[axis];
    return {
      fragmentDecl: 'float mgH;',
      albedo: /* glsl */ `{
        vec3 p = mgWorldPos;
        float g = mgFbm3(p * ${s}, 4);
        float rings = 0.5 + 0.5 * sin(g * 16.0);
        rings = mix(rings, 0.5, clamp(fwidth(g * 16.0), 0.0, 1.0));   // fade the lines before they alias
        vec3 c = ${base} * (0.75 + 0.35 * rings + 0.12 * mgFbm3(p * 0.6, 2));
        diffuseColor.rgb *= c;
        mgH = rings * 0.4 + g * 0.3;
      }`,
      normal: 'normal = mgBump(normal, mgH, 0.002);',
    };
  },
  /** fired clay: mottled, a paler slip band, dust settling on top */
  terracotta: (base = 'vec3(0.50, 0.25, 0.13)') => ({
    fragmentDecl: 'float mgH;',
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos; vec3 n = normalize(mgWorldNormal);
      float m = mgFbm3(p * 3.5, 4) * 0.5 + 0.5;
      vec3 c = ${base} * (0.8 + 0.4 * m);
      c = mix(c, ${base} * 1.4 + 0.05, smoothstep(0.55, 0.8, mgFbm3(p * 1.3 + 5.0, 3) * 0.5 + 0.5) * 0.45);
      c = mix(c, vec3(0.55, 0.47, 0.38), smoothstep(0.5, 1.0, n.y) * 0.35);
      diffuseColor.rgb *= c;
      mgH = m * 0.5 + mgGrad3(p * 40.0) * 0.04;
    }`,
    normal: 'normal = mgBump(normal, mgH, 0.0015);',
  }),
};

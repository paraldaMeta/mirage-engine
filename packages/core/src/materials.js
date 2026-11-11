// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { WIND_GLSL, AMB_UNIFORMS, ambientMode, ambientGLSL, CHUNK_EPOCH } from './env.js';
import { hash32 } from './rng.js';
import { RELIEF_GLSL, RELIEF, renderHeight, renderShade } from './relief.js';

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
//   specAA                                           mgSpecAA on the roughness: by default where a hook mentions
//                                                    roughnessFactor; false never; a string: an #if expression;
//                                                    a number: always, with that strength (1 = the default)
//   attach(material)                                 called once patched (wet.js keeps its define in step)
// Materials with identical hooks share one program (the cache key is a hash of the hooks).
// ---------------------------------------------------------------------------

const FRAG_HOOKS = {
  albedo: '#include <color_fragment>', roughness: '#include <roughnessmap_fragment>', metalness: '#include <metalnessmap_fragment>',
  normal: '#include <normal_fragment_maps>', emissive: '#include <emissivemap_fragment>', lighting: '#include <lights_fragment_end>',
};

// specular anti-aliasing: widen the lobe by the normal's variance across the pixel, so bumped glossy surfaces
// (water, polished stone, rippled puddles) stop sparkling when the camera moves (Kaplanyan & Hoffman / Tokuyoshi:
// the screen-space variance of the shading normal, 0.25 (|dn/dx|^2 + |dn/dy|^2), added twice to the squared
// roughness and clamped). k scales the added variance (1 = the default, 0 = none).
const SPEC_AA_GLSL_BODY = /* glsl */ `#ifndef MG_SPEC_AA
#define MG_SPEC_AA
float mgSpecAA(float r, vec3 n){
  vec3 a = dFdx(n), b = dFdy(n);
  return sqrt(clamp(r * r + min(0.5 * (dot(a, a) + dot(b, b)), 0.18), 0.0, 1.0));
}
float mgSpecAA(float r, vec3 n, float k){
  vec3 a = dFdx(n), b = dFdy(n);
  return sqrt(clamp(r * r + min(0.5 * k * (dot(a, a) + dot(b, b)), 0.18), 0.0, 1.0));
}
#endif`;
/** The specular AA GLSL (mgSpecAA(roughness, viewNormal[, strength])), guarded: every patch()ed lit material has it
 *  already; paste it into a ShaderMaterial or onBeforeCompile of your own and call it after the last normal edit,
 *  e.g. roughnessFactor = mgSpecAA(roughnessFactor, normal, 1.0); */
export const SPEC_AA_GLSL = SPEC_AA_GLSL_BODY;

const BUMP_GLSL = /* glsl */ `
vec3 mgBump(vec3 n, float h, float k){
  vec3 p = -vViewPosition, dpx = dFdx(p), dpy = dFdy(p);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - k * g);
}
${SPEC_AA_GLSL_BODY}
`;

function uniformDecls(G, amb) {
  const type = (v) => (typeof v === 'number' ? 'float' : v.isVector2 ? 'vec2' : v.isVector3 ? 'vec3' : v.isVector4 ? 'vec4' : v.isMatrix3 ? 'mat3' : v.isTexture ? 'highp sampler2D' : 'mat4');
  // of the ambient-volume uniforms only those of the world's path (none without volumes)
  return Object.entries(G).filter(([k]) => !k.startsWith('uAmb') || AMB_UNIFORMS[amb].includes(k)).map(([k, u]) => Array.isArray(u.value) ? `uniform ${type(u.value[0])} ${k}[${u.value.length}];` : `uniform ${type(u.value)} ${k};`).join('\n');
}

export function patch(material, hooks, G) {
  const key = 'mg' + hash32(JSON.stringify([hooks, Object.keys(G)], (k, v) => (k === 'uniforms' ? Object.keys(v) : v)));
  // ambient-volume code is compiled in only while the world has volumes (setAmbientVolumes recompiles when the path
  // changes), so a world without them compiles exactly the shaders it did before; 1 the uniform path, 2 the grid
  const amb = () => ambientMode(G);
  if (hooks.defines) material.defines = { ...(material.defines || {}), ...hooks.defines };
  material.userData.hooks = hooks;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G, hooks.uniforms || {});
    const A = amb();
    const headOf = (m) => `varying vec3 mgWorldPos;\nvarying vec3 mgWorldNormal;\n${uniformDecls(G, m)}\n${NOISE_GLSL}\n${ambientGLSL(m)}\n`;
    // the grid's texture and lookup are fragment-only (the uniform path keeps its code in both stages, as before)
    const head = headOf(A), vhead = A === 2 ? headOf(0) : head;
    let vs = shader.vertexShader;
    const hasNormal = !material.isMeshBasicMaterial && !material.isMeshDepthMaterial && vs.includes('#include <defaultnormal_vertex>');
    vs = vs.replace('#include <common>', `#include <common>\n${vhead}${WIND_GLSL}\n${hooks.vertexDecl || ''}`);
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
    // ambient volumes scale the image-based light (sky + world capture) inside interiors (per channel on the grid)
    if (A === 1) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float mgAmb = mgAmbient(mgWorldPos); reflectedLight.indirectDiffuse *= mgAmb; reflectedLight.indirectSpecular *= mgAmb; }');
    if (A === 2) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ vec3 mgAmb = mgAmbientRGB(mgWorldPos); reflectedLight.indirectDiffuse *= mgAmb; reflectedLight.indirectSpecular *= mgAmb; }');
    for (const [name, inc] of Object.entries(FRAG_HOOKS)) if (hooks[name]) fs = fs.replace(inc, `${inc}\n${hooks[name]}`);
    // specular AA where the hooks touch the roughness; hooks.specAA overrides: false never, a string is a preprocessor
    // #if expression; a number: on with that strength (0 = off); hooks.specAAIf: an #if expression it is wrapped in
    // as well (wet.js: '!defined(MG_WET)', the wet layer then applies its own after its normal)
    const aa0 = hooks.specAA ?? fs.includes('roughnessFactor'), aa = typeof aa0 === 'number' ? aa0 > 0 : aa0;
    const sa = typeof aa0 === 'number' ? `roughnessFactor = mgSpecAA(roughnessFactor, normal, ${(+aa0).toFixed(4)});` : 'roughnessFactor = mgSpecAA(roughnessFactor, normal);';
    const cond = [typeof aa === 'string' ? aa : '', hooks.specAAIf || ''].filter(Boolean), ifx = cond.length > 1 ? cond.map((c) => `(${c})`).join(' && ') : cond[0];
    if (bump && aa) fs = fs.replace('#include <emissivemap_fragment>', (ifx ? `#if ${ifx}\n${sa}\n#endif` : sa) + '\n#include <emissivemap_fragment>');
    if (hooks.output) fs = fs.replace('#include <opaque_fragment>', `${hooks.output}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => key + ['', 'a', 'g'][amb()] + (CHUNK_EPOCH.n ? 'e' + CHUNK_EPOCH.n : '');
  material.needsUpdate = true;
  if (typeof hooks.attach === 'function') hooks.attach(material);
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
  /** lime plaster / render: soft trowel waves, rain streaks, a damp foot, scattered chips; render: the close-range
   *  relief of a hand-applied render (undulation in metres, e.g. 0.009; mud / adobe ~0.008, or [und, swipe]), opt-in */
  plaster: (base = 'vec3(0.72, 0.66, 0.56)', { wear = 1, foot = 0.6, render = 0 } = {}) => withRender({
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
  }, render, 0.004),
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
  // Metals: use them on a metallic material (mat.std({ metalness: 1, roughness: 0.3 }, PROC.brushed())); `base` is the
  // metal's reflectance colour (linear). Tuned under the world's captured sky light, where a metal is mostly its
  // environment reflection: the pattern lives in the roughness and the normal more than in the colour.
  /** brushed metal: streaks and fine hairlines along `axis` ('x' | 'y' | 'z'), stretched noise in the roughness and the
   *  normal so highlights smear across the brushing; scale > 1 is finer, wear 0..1 adds fingerprint-like smudges */
  brushed: (base = 'vec3(0.56, 0.57, 0.58)', { axis = 'x', scale = 1, wear = 1 } = {}) => {
    const k = +scale, along = (a, x) => ({ x: `vec3(${a}, ${x}, ${x})`, y: `vec3(${x}, ${a}, ${x})`, z: `vec3(${x}, ${x}, ${a})` }[axis]);
    if (!along('0', '0')) throw new RangeError("PROC.brushed axis must be 'x', 'y' or 'z'");
    const S = along((0.9 * k).toFixed(3), (160 * k).toFixed(3)), F = along((4 * k).toFixed(3), (1400 * k).toFixed(3));
    return {
      fragmentDecl: 'float mgH; float mgB; float mgS;',
      albedo: /* glsl */ `{
        vec3 p = mgWorldPos;
        float streak = smoothstep(0.25, 0.75, mgFbm3(p * ${S}, 3) * 0.5 + 0.5);
        vec3 q = p * ${F};
        float hair = mgValue3(q);
        hair = mix(hair, 0.5, clamp(length(fwidth(q)) * 0.6 - 0.2, 0.0, 1.0));   // fade the hairlines before they alias
        mgS = smoothstep(0.45, 0.85, mgFbm3(p * ${(2.3 * k).toFixed(3)} + 4.0, 3) * 0.5 + 0.5) * ${(+wear).toFixed(3)};
        mgB = streak * 0.6 + hair * 0.4;
        diffuseColor.rgb *= ${base} * (0.88 + 0.18 * mgB) * (1.0 - 0.05 * mgS);
        mgH = streak + 0.25 * hair;   // the streaks (millimetres apart) tilt the normal across the brushing: the highlight smears
      }`,
      roughness: 'roughnessFactor = clamp(roughnessFactor * (0.7 + 0.6 * mgB) + 0.12 * mgS, 0.03, 1.0);',
      normal: `normal = mgBump(normal, mgH, ${(0.0011 / k).toFixed(6)});`,
    };
  },
  /** hammered / beaten metal: overlapping dimples (cells `size` m across, 0.035), polished ridges between them, the
   *  hollows a little rougher and darker; depth scales the relief */
  hammered: (base = 'vec3(0.62, 0.60, 0.56)', { size = 0.035, depth = 1 } = {}) => ({
    fragmentDecl: 'float mgH; float mgD;',
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos / ${(+size).toFixed(4)};
      vec2 c = mgCell3(p);
      float ridge = 1.0 - smoothstep(0.0, 0.12, c.y - c.x);   // where two dimples meet
      mgD = 1.0 - clamp(c.x * c.x * 1.6, 0.0, 1.0);          // 1 at a dimple's bottom
      float tone = mgFbm3(p * 0.21, 3) * 0.5 + 0.5;
      diffuseColor.rgb *= ${base} * (0.86 + 0.12 * tone + 0.1 * ridge - 0.06 * mgD);
      mgH = -mgD + 0.35 * ridge;
    }`,
    roughness: 'roughnessFactor = clamp(roughnessFactor + 0.1 * mgD - 0.06 * (1.0 - mgD), 0.03, 1.0);',
    normal: `normal = mgBump(normal, mgH, ${(0.22 * size * depth).toFixed(6)});`,
  }),
  /** patina: verdigris on copper / bronze. amount 0..1 (0.5) of the surface turned green-blue, gathering on top faces
   *  and running down walls; the bare metal oxidised darker; the verdigris rough and not metallic. base: the metal
   *  (copper; bronze ~ 'vec3(0.55, 0.38, 0.2)'), verdigris: its colour */
  patina: (base = 'vec3(0.78, 0.42, 0.27)', { amount = 0.5, verdigris = 'vec3(0.17, 0.42, 0.33)' } = {}) => ({
    fragmentDecl: 'float mgH; float mgP;',
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos; vec3 n = normalize(mgWorldNormal);
      float big = mgFbm3(p * 2.2, 4) * 0.5 + 0.5, fine = mgFbm3(p * 16.0, 3) * 0.5 + 0.5;
      float runs = (mgFbm3(p * vec3(7.0, 0.6, 7.0) + 3.0, 3) * 0.5 + 0.5) * (1.0 - abs(n.y));
      float m = big * 0.6 + fine * 0.25 + runs * 0.35 + smoothstep(0.2, 0.95, n.y) * 0.2;
      float t = ${(0.92 - 0.65 * Math.min(Math.max(+amount, 0), 1)).toFixed(4)};
      mgP = smoothstep(t - 0.05, t + 0.05, m);
      vec3 metal = ${base} * (0.5 + 0.3 * fine + 0.2 * big);
      vec3 green = mix(${verdigris}, ${verdigris} * vec3(1.35, 1.25, 1.2) + 0.04, smoothstep(0.4, 0.8, fine));
      diffuseColor.rgb *= mix(metal, green, mgP);
      mgH = mgP * 0.7 + fine * 0.3;
    }`,
    roughness: 'roughnessFactor = mix(roughnessFactor, 0.88, mgP);',
    metalness: 'metalnessFactor *= 1.0 - mgP;',
    normal: 'normal = mgBump(normal, mgH, 0.0012);',
  }),
};

// the render relief on a PROC set that bumps mgH with strength k: one bump of mgH * k + the render's height (m), a
// little shade in its hollows; without `render` the hooks are returned untouched (the same program as before)
function withRender(h, render, k) {
  const [und, swipe] = Array.isArray(render) ? render : [render, render * 0.7];
  if (!(und > 0)) return h;
  return {
    ...h,
    fragmentDecl: RELIEF_GLSL + h.fragmentDecl + ' float mgRR;',
    albedo: h.albedo + `\n{ ${renderHeight('rr', und, swipe)} mgRR = rr; }`,
    normal: `normal = mgBump(normal, mgH * ${k} + mgRR, 1.0);`,
    output: renderShade('mgRR'),
    uniforms: { ...RELIEF },
  };
}

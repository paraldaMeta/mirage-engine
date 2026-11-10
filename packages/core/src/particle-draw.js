// Mirage original code.
// Drawing a ParticlePool: one instanced mesh whose vertex shader reads the simulation textures by gl_InstanceID,
// built with patch() so particles get the same fog, sun, shadow and sky light as every other Mirage material.
//
//   import { createParticleMesh } from './particle-draw.js';   // internal (not in the export map): reached through createVfx (vfx.js)
//   const mesh = createParticleMesh(pool, { G, lut, depth, sheets, meshes });
//   scene.add(mesh);                           // mesh.userData.sync(time) once per frame after the pool stepped
//
// Kinds (render.type): 'billboard' faces the camera and spins in the view plane; 'stretched' is aligned to the
// velocity and lengthened by speed (sparks, rain streaks); 'horizontal' lies flat (ripples, ground rings); 'mesh'
// instances a small geometry that tumbles.
// Blending (render.blend): 'alpha' is straight alpha with the scene's fog; 'premultiplied' adds `additive` (0..1) to
// slide between alpha and additive in ONE draw, so fire can sit inside its own smoke without a sort between two
// layers; 'add' is pure additive, attenuated by the fog's transmittance (light that crosses haze dims, it does not
// take the haze's colour).
// Lighting (render.lit 0..1): 0 is unlit radiance; above 0 the material is a MeshStandardMaterial (rough, non-metal)
// so the sun, its shadow map, the image-based sky light and ambient volumes all apply. A billboard has no real
// normal: it gets a rounded one bent toward the key light, a cheap stand-in for light scattering through a puff.
// Soft particles (render.soft, metres): alpha fades where the particle nears the opaque scene behind it, read
// from the vfx depth copy (vfx.js). Without a copy (rendering straight to the canvas) the fade is skipped.
import * as THREE from 'three';
import { patch } from './materials.js';
import { FOG } from './fog.js';
import { VFX_LUT_W } from './vfx-data.js';

const D2R = Math.PI / 180;
// alpha of the built-in procedural sprites over q in [-1, 1]²; `sh` is a shading factor on the colour
const SPRITES = {
  soft: 'float r = length(q); a = smoothstep(1.0, 0.0, r); a *= a;',
  disc: 'float r = length(q); a = smoothstep(1.0, 0.86, r);',
  ring: 'float r = length(q); a = smoothstep(1.0, 0.9, r) * smoothstep(0.62, 0.78, r);',
  spark: 'a = smoothstep(1.0, 0.0, abs(q.x)) * smoothstep(1.0, 0.1, abs(q.y)); a *= a;',
  star: 'float r = length(q); a = clamp(0.035 / (abs(q.x * q.y) + 0.03) - 0.25, 0.0, 1.0) * smoothstep(1.0, 0.2, r) + smoothstep(0.35, 0.0, r);',
  // a pointed leaf: two arcs meeting at the tips, a darker midrib
  leaf: 'float w = 0.55 * (1.0 - q.y * q.y); a = smoothstep(w, w - 0.08, abs(q.x)) * step(abs(q.y), 1.0); sh = 0.75 + 0.25 * smoothstep(0.0, 0.12, abs(q.x));',
  flake: 'float r = length(q), an = atan(q.y, q.x); float arm = abs(fract(an * 0.9549297 + 0.5) - 0.5) * r; a = smoothstep(0.07, 0.02, arm) * smoothstep(1.0, 0.8, r) + smoothstep(0.3, 0.0, r);',
  drop: 'float r = length(q); a = smoothstep(1.0, 0.8, r); sh = 0.7 + 0.6 * smoothstep(0.5, 0.0, length(q - vec2(-0.3, 0.35)));',
};

/** GLSL: needs `uniform vec4 uVFogP; uniform float uVFogD;` (FOG.params and the scene fog's density); declares uVGain */
export const VFX_FOG_T = /* glsl */ `
uniform float uVGain;   // what turns a display-referred colour (1 = white on screen) into scene light at this exposure
// the fog's transmittance alone (fog.js mgAerial without the in-scatter): for additive light
float vfxFogT(vec3 wp){
  vec3 V = wp - cameraPosition; float dist = length(V), H = uVFogP.y, k = V.y / H;
  float layer = exp(-(cameraPosition.y - uVFogP.w) / H) * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k);
  return exp(-(uVFogP.x * layer + uVFogP.z) * dist * uVFogD);
}`;
const VERT_DECL = /* glsl */ `
uniform highp sampler2D tVP, tVV, tVX, tVSort; uniform sampler2D tVLut;
uniform vec4 uVWin, uVA, uVB;      // base, count, state width, capacity | lead s, spin min, spin max, youngest first | stretch, near fade, min pixels, pixels per (m at 1 m)
uniform float uVSortW;
varying vec4 vPc, vPq; varying vec3 vPs;
vec2 vfxRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;
function vertexWorld(e, isMesh) {
  const type = e.render.type;
  const place = type === 'stretched' ? /* glsl */ `
    float sp = length(vv); vec3 ax = sp > 1e-4 ? vv / sp : vfxU, sd = cross(ax, normalize(cameraPosition - vc));
    sd = dot(sd, sd) > 1e-8 ? normalize(sd) : vfxR;
    mgWorld = vc + sd * (position.x * hs) + ax * (position.y * (hs + sp * uVB.x));`
    : type === 'horizontal' ? /* glsl */ `
    vec2 hq = vfxRot(position.xy, rot) * hs; mgWorld = vc + vec3(hq.x, 0.0, hq.y); mgWorldNormal = vec3(0.0, 1.0, 0.0);`
    : type === 'mesh' ? /* glsl */ `
    // tumble about an axis that is the particle's own (from its random), by Rodrigues' formula
    float za = sX.x * 2.0 - 1.0, aa = fract(sX.x * 91.7) * 6.2831853; vec3 k = vec3(sqrt(max(0.0, 1.0 - za * za)) * vec2(cos(aa), sin(aa)), za);
    float cr = cos(rot), sr = sin(rot); vec3 lp = position * (hs * 2.0);
    mgWorld = vc + lp * cr + cross(k, lp) * sr + k * dot(k, lp) * (1.0 - cr);
    ${isMesh ? 'vec3 ln = objectNormal; mgWorldNormal = ln * cr + cross(k, ln) * sr + k * dot(k, ln) * (1.0 - cr); vNormal = normalize(mat3(viewMatrix) * mgWorldNormal);' : ''}`
    : /* glsl */ `
    vec2 bq = vfxRot(position.xy, rot) * hs; mgWorld = vc + vfxR * bq.x + vfxU * bq.y;`;
  return /* glsl */ `
  {
    int vj = gl_InstanceID, vn = int(uVWin.y), vcap = int(uVWin.w), vw = int(uVWin.z);
    int slot = uVSortW > 0.5 ? int(texelFetch(tVSort, ivec2(vj % int(uVSortW), vj / int(uVSortW)), 0).y + 0.5)
      : (int(uVWin.x) + (uVA.w > 0.5 ? vn - 1 - vj : vj)) % vcap;
    ivec2 st = ivec2(slot % vw, slot / vw);
    vec4 sP = texelFetch(tVP, st, 0), sV = texelFetch(tVV, st, 0), sX = texelFetch(tVX, st, 0);
    float life = max(sV.w, 1e-4), age = sP.w + uVA.x, lt = clamp(age / life, 0.0, 1.0);
    bool alive = sV.w > 0.0 && sP.w < sV.w && age >= 0.0;
    bool stuck = (int(sX.z + 0.5) & 8) != 0;
    vec3 vv = stuck ? vec3(0.0) : sV.xyz, vc = sP.xyz + vv * uVA.x;       // extrapolated to the frame's own time
    float lu = lt * ${(1 - 1 / VFX_LUT_W).toFixed(6)} + ${(0.5 / VFX_LUT_W).toFixed(6)};
    vec4 l0 = texture2D(tVLut, vec2(lu, 0.25)), l1 = texture2D(tVLut, vec2(lu, 0.75));
    float hs = alive ? 0.5 * sX.w * l1.x : 0.0;
    float rot = sX.y + mix(uVA.y, uVA.z, fract(sX.x * 7.31)) * life * l1.w;
    vec3 vfxR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), vfxU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    ${place}
    float vz = -(viewMatrix * vec4(vc, 1.0)).z, fade = 1.0;
    if (isPerspectiveMatrix(projectionMatrix)) {
      fade *= uVB.y > 0.0 ? smoothstep(0.0, uVB.y, vz - hs) : 1.0;         // no popping, and no screen-filling quad, at the lens
      fade *= uVB.z > 0.0 ? smoothstep(0.5 * uVB.z, uVB.z, 2.0 * hs * uVB.w / max(vz, 1e-3)) : 1.0;   // too small to see: fade out
    }
    if (fade <= 0.0) mgWorld = vc;
    vPc = vec4(l0.rgb, l0.a * fade); vPq = vec4(${type === 'mesh' ? 'uv * 2.0 - 1.0' : 'position.xy'}, lt, l1.y);
    vPs = vec3(sX.x, age, -(viewMatrix * vec4(mgWorld, 1.0)).z);
  }`;
}

function fragmentDecl(e, o) {
  const fb = e.render.flipbook;
  return /* glsl */ `
uniform vec4 uVC, uVProj, uVSheet;   // lit, soft distance, additive, emissive gain | near, far, ortho, depth copy valid | cols, rows, fps, frame blend
uniform highp sampler2D tVDepth; uniform sampler2D tVSheet;
uniform vec4 uVFogP; uniform float uVFogD;
varying vec4 vPc, vPq; varying vec3 vPs;
float vfxSprite(vec2 q, out float sh){ float a = 0.0; sh = 1.0; ${SPRITES[e.render.sprite]} return clamp(a, 0.0, 1.0); }
${fb ? /* glsl */ `vec4 vfxFrame(float f, vec2 uv){ float n = uVSheet.x * uVSheet.y; f = mod(f, n); float cx = mod(f, uVSheet.x), cy = floor(f / uVSheet.x);
  // half a texel in from the cell edge: a frame must not bleed into its neighbour under linear filtering
  vec2 ts = 1.0 / vec2(textureSize(tVSheet, 0)); vec2 cu = clamp(uv, ts * uVSheet.xy * 0.5, 1.0 - ts * uVSheet.xy * 0.5);
  return texture2D(tVSheet, (vec2(cx, uVSheet.y - 1.0 - cy) + cu) / uVSheet.xy); }` : ''}
float vfxDepth(float d){ return uVProj.z > 0.5 ? mix(uVProj.x, uVProj.y, d) : 2.0 * uVProj.x * uVProj.y / (uVProj.y + uVProj.x - (d * 2.0 - 1.0) * (uVProj.y - uVProj.x)); }
${VFX_FOG_T}`;
}
function albedo(e) {
  const fb = e.render.flipbook;
  return /* glsl */ `
  {
    float sh = 1.0, pa;
    ${fb ? /* glsl */ `float n = uVSheet.x * uVSheet.y, f = uVSheet.z > 0.0 ? vPs.y * uVSheet.z + floor(vPs.x * n) : vPq.z * (n - 1.0);
    vec2 fu = vPq.xy * 0.5 + 0.5; vec4 fa = vfxFrame(floor(f), fu);
    if (uVSheet.w > 0.5) fa = mix(fa, vfxFrame(floor(f) + 1.0, fu), fract(f));     // cross-fade to the next frame: smooth at any fps
    pa = fa.a; diffuseColor.rgb = vPc.rgb * fa.rgb;` : 'pa = vfxSprite(vPq.xy, sh); diffuseColor.rgb = vPc.rgb * sh;'}
    pa *= vPc.a;
    if (uVC.y > 0.0 && uVProj.w > 0.5) pa *= clamp((vfxDepth(texelFetch(tVDepth, ivec2(gl_FragCoord.xy), 0).r) - vPs.z) / uVC.y, 0.0, 1.0);
    if (pa < 0.003) discard;
    diffuseColor.a = pa;
  }`;
}

/** the instanced geometry of a pool: a quad, or the registered mesh for render.type 'mesh' */
function particleGeometry(e, meshes) {
  const g = new THREE.InstancedBufferGeometry();
  let src;
  if (e.render.type === 'mesh') {
    src = meshes && meshes.get(e.render.mesh);
    if (!src) throw new Error(`vfx: emitter ${e.name} draws mesh "${e.render.mesh}", which is not registered (vfx.registerMesh)`);
    src = src.geometry;
  } else src = particleGeometry.quad || (particleGeometry.quad = new THREE.PlaneGeometry(2, 2));
  g.index = src.index;
  for (const k of ['position', 'normal', 'uv']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e-3);
  return g;
}

/** o: { G, lut (texture), depth (the vfx depth copy state), sheets, meshes (Maps), fogState } */
export function createParticleMesh(pool, o) {
  const e = pool.e, r = e.render, lit = r.lit > 0, isMesh = r.type === 'mesh';
  const sheet = r.flipbook ? o.sheets && o.sheets.get(r.flipbook.sheet) : null;
  if (r.flipbook && !sheet) throw new Error(`vfx: emitter ${e.name} uses flipbook sheet "${r.flipbook.sheet}", which is not registered (vfx.registerSheet)`);
  const U = {
    tVP: { value: null }, tVV: { value: null }, tVX: { value: null }, tVSort: { value: null }, tVLut: { value: o.lut }, uVSortW: { value: 0 },
    uVWin: { value: new THREE.Vector4(0, 0, pool.W, pool.cap) }, uVA: { value: new THREE.Vector4(0, e.spin[0] * D2R, e.spin[1] * D2R, r.sort === 'youngest' ? 1 : 0) },
    uVB: { value: new THREE.Vector4(r.stretch, r.nearFade, e.lod.minPixels, 1000) }, uVC: { value: new THREE.Vector4(r.lit, r.soft, Math.min(r.additive, 0.98), 1) },
    uVProj: { value: new THREE.Vector4(0.1, 1000, 0, 0) }, uVSheet: { value: new THREE.Vector4(1, 1, 0, 0) }, tVDepth: { value: null }, tVSheet: { value: sheet ? sheet.texture : null },
    uVFogP: { value: FOG.params }, uVFogD: { value: 0 }, uVGain: o.gain || { value: 1 },
  };
  if (r.flipbook) U.uVSheet.value.set(sheet.cols || r.flipbook.cols, sheet.rows || r.flipbook.rows, r.flipbook.fps, r.flipbook.blend ? 1 : 0);
  const add = r.blend === 'add', pre = r.blend === 'premultiplied';
  const base = { transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: !add,
    blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, premultipliedAlpha: pre };
  const material = lit ? new THREE.MeshStandardMaterial({ ...base, roughness: 1, metalness: 0 }) : new THREE.MeshBasicMaterial(base);
  const hooks = {
    vertexDecl: VERT_DECL, vertexWorld: vertexWorld(e, isMesh && lit), fragmentDecl: fragmentDecl(e, o), albedo: albedo(e), uniforms: U, specAA: false,
    // unlit colour is the particle's own radiance; lit colour is what the scene's light makes of it; emissive adds on top
    output: /* glsl */ `
    { vec3 own = diffuseColor.rgb * uVGain;
      outgoingLight = ${lit ? 'mix(own, outgoingLight, uVC.x)' : 'own'} + own * vPq.w;
      ${add ? 'outgoingLight *= diffuseColor.a * vfxFogT(mgWorldPos); diffuseColor.a = 1.0;' : ''}
      ${pre ? 'outgoingLight /= (1.0 - uVC.z); diffuseColor.a *= (1.0 - uVC.z);' : ''} }`,
  };
  // a rounded normal in view space, bent toward the key light: front-lit puffs are not flat, back-lit ones not black
  if (lit && !isMesh) hooks.normal = r.type === 'horizontal' ? 'normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));'
    : 'normal = normalize(vec3(vPq.xy * 0.75, 1.0) + 0.6 * (mat3(viewMatrix) * uKeyDir));';
  patch(material, hooks, o.G);
  const mesh = new THREE.Mesh(particleGeometry(e, o.meshes), material);
  mesh.name = `vfx:${e.name}`;
  mesh.castShadow = false; mesh.receiveShadow = lit;
  mesh.userData.collide = false; mesh.userData.mgNoCapture = true;      // not a walk-grid solid, not in the sky-light capture
  mesh.renderOrder = 10 + r.order + (add ? 1 : 0);
  mesh.matrixAutoUpdate = false;
  mesh.userData.U = U; mesh.userData.pool = pool;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const t = pool.state.textures, d = o.depth;
    U.tVP.value = t[0]; U.tVV.value = t[1]; U.tVX.value = t[2];
    // the frame's time may sit between two fixed steps (sub-frame motion blur, 120 Hz displays): extrapolate
    U.uVA.value.x = Math.max(-0.1, Math.min(0.1, o.G.uTime.value - (pool.step + pool.lag) * pool.dt));
    const rt = renderer.getRenderTarget(); if (rt) size.set(rt.width, rt.height); else renderer.getDrawingBufferSize(size);
    U.uVB.value.w = camera.isPerspectiveCamera ? size.y / (2 * Math.tan(camera.fov * D2R / 2)) : 1e6;
    U.uVProj.value.set(camera.near, camera.far, camera.isOrthographicCamera ? 1 : 0, d && d.valid ? 1 : 0);
    U.tVDepth.value = d && d.valid ? d.texture : null;
    U.uVFogD.value = scene.fog && scene.fog.isFogExp2 ? scene.fog.density : 0;
  };
  return mesh;
}

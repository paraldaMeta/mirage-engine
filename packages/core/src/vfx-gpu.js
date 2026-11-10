// Mirage original code.
// GPU helpers of the effect system (vfx.js): everything here builds a texture in code, nothing is loaded.
//
//   sampleMesh(geometry, 2048)            points + normals spread evenly over a mesh's surface, for shape 'mesh'
//   heightTexture(renderer, grid)         the walk grid (or any heightAt function) as a collision height map
//   createSorter(renderer)                back-to-front order of a pool by a bitonic network on the GPU
//   makeSheet(renderer, 'smoke' | 'flame')  a flipbook sheet drawn from noise
//   createDepthCopy()                     the scene's depth buffer copied mid-frame, for soft particles, depth
//                                         collision and decals
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { gpuPass, SIM_VERTEX } from './particles.js';

const raw = (fragmentShader, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SIM_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
/** a small seeded generator (mulberry32): the same seed gives the same points on every machine */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** `count` points spread by area over a geometry's triangles: { texture (count × 2: row 0 position, row 1 normal), count, data } */
export function sampleMesh(geometry, count = 2048, seed = 7) {
  const pos = geometry.attributes.position, idx = geometry.index, tris = idx ? idx.count / 3 : pos.count / 3;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), cdf = new Float64Array(tris);
  const tri = (t) => { const i = (k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k); A.fromBufferAttribute(pos, i(0)); B.fromBufferAttribute(pos, i(1)); C.fromBufferAttribute(pos, i(2)); };
  let total = 0;
  for (let t = 0; t < tris; t++) { tri(t); total += N.subVectors(B, A).cross(C.clone().sub(A)).length() * 0.5; cdf[t] = total; }
  if (!(total > 0)) throw new Error('vfx.registerMesh: the geometry has no surface area');
  const rnd = seeded(seed), data = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const u = rnd() * total; let lo = 0, hi = tris - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
    tri(lo);
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }        // fold the square onto the triangle: uniform
    N.subVectors(B, A).cross(C.clone().sub(A)).normalize();
    data.set([A.x + (B.x - A.x) * a + (C.x - A.x) * b, A.y + (B.y - A.y) * a + (C.y - A.y) * b, A.z + (B.z - A.z) * a + (C.z - A.z) * b, 1], i * 4);
    data.set([N.x, N.y, N.z, 0], (count + i) * 4);
  }
  const texture = new THREE.DataTexture(data, count, 2, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return { texture, count, data };
}

/** a height map for ground collision. `grid`: a walk grid from @mirage/play's bakeWalkGrid (nx, nz, x0, z0, cell,
 *  groundAt), or { min: [x, z], size: [w, d], res: [nx, nz], heightAt(x, z) }. Cells with no ground hold -1e4. */
export function heightTexture(renderer, grid) {
  const g = grid.groundAt ? { nx: grid.nx, nz: grid.nz, x0: grid.x0, z0: grid.z0, w: grid.nx * grid.cell, d: grid.nz * grid.cell, at: (x, z) => grid.groundAt(x, z) }
    : { nx: grid.res[0], nz: grid.res[1], x0: grid.min[0], z0: grid.min[1], w: grid.size[0], d: grid.size[1], at: grid.heightAt };
  const data = new Float32Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) { const y = g.at(g.x0 + (i + 0.5) * g.w / g.nx, g.z0 + (j + 0.5) * g.d / g.nz); data[j * g.nx + i] = Number.isFinite(y) ? y : -1e4; }
  const texture = new THREE.DataTexture(data, g.nx, g.nz, THREE.RedFormat, THREE.FloatType);
  // bilinear heights where the GPU can filter float textures (every desktop GPU); stepped cells otherwise
  if (renderer.extensions.has('OES_texture_float_linear')) texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, rect: new THREE.Vector4(g.x0, g.z0, 1 / g.w, 1 / g.d), data };
}

// --- back-to-front sort --------------------------------------------------------------------------------------------
// A bitonic sorting network: log2(N)·(log2(N)+1)/2 passes over an N-texel (key, slot) texture, each texel comparing
// itself with one fixed partner. No readback, and the order is exact every frame (ties broken by slot, so it is a
// pure function of the particle state and the camera). The cost is the pass count: 78 for 4096, 136 for 65536.
const SORT_KEY = /* glsl */ `precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 o; uniform sampler2D tP, tV; uniform int uSW, uW, uCap; uniform vec4 uViewZ;
void main(){ ivec2 px = ivec2(gl_FragCoord.xy); int i = px.y * uSW + px.x; float key = 1e30;
  if (i < uCap) { ivec2 st = ivec2(i % uW, i / uW); vec4 P = texelFetch(tP, st, 0); float life = texelFetch(tV, st, 0).w; if (life > 0.0 && P.w < life) key = -dot(uViewZ, vec4(P.xyz, 1.0)); }
  o = vec4(key, float(i), 0.0, 1.0); }`;
const SORT_PASS = /* glsl */ `precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 o; uniform sampler2D tS; uniform int uSW, uB, uD;
void main(){ ivec2 px = ivec2(gl_FragCoord.xy); int i = px.y * uSW + px.x, j; bool low;
  // the first pass of a stage pairs each element with its mirror in the block; the rest pair at distance uD
  if (uD == 0) { int k = i & (uB - 1); j = i - k + (uB - 1 - k); low = k < uB / 2; } else { low = (i & uD) == 0; j = low ? i + uD : i - uD; }
  vec2 a = texelFetch(tS, px, 0).xy, b = texelFetch(tS, ivec2(j % uSW, j / uSW), 0).xy;
  bool less = a.x < b.x || (a.x == b.x && a.y < b.y);
  o = vec4(less == low ? a : b, 0.0, 1.0); }`;
export function createSorter(renderer) {
  const keyU = { tP: { value: null }, tV: { value: null }, uSW: { value: 1 }, uW: { value: 1 }, uCap: { value: 1 }, uViewZ: { value: new THREE.Vector4() } };
  const passU = { tS: { value: null }, uSW: { value: 1 }, uB: { value: 2 }, uD: { value: 0 } };
  const keyM = raw(SORT_KEY, keyU), passM = raw(SORT_PASS, passU), targets = new Map();
  const make = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  return {
    passes: 0,
    /** sort `pool` by distance along the camera's view axis, farthest first; returns { texture, width } */
    sort(pool, camera) {
      let t = targets.get(pool);
      if (!t) { const n = 2 ** Math.ceil(Math.log2(Math.max(2, pool.cap))), w = 2 ** Math.ceil(Math.log2(n) / 2); t = { n, w, a: make(w, n / w), b: make(w, n / w) }; targets.set(pool, t); }
      const e = camera.matrixWorldInverse.elements, s = pool.state.textures;
      keyU.tP.value = s[0]; keyU.tV.value = s[1]; keyU.uSW.value = t.w; keyU.uW.value = pool.W; keyU.uCap.value = pool.cap; keyU.uViewZ.value.set(-e[2], -e[6], -e[10], -e[14]);
      gpuPass(renderer, keyM, t.a);
      passU.uSW.value = t.w;
      for (let B = 2; B <= t.n; B *= 2) for (let D = 0; D === 0 || D >= 1; D = D === 0 ? B / 4 : D / 2) {
        if (D !== 0 && D < 1) break;
        passU.tS.value = t.a.texture; passU.uB.value = B; passU.uD.value = D;
        gpuPass(renderer, passM, t.b); const sw = t.a; t.a = t.b; t.b = sw; this.passes++;
        if (D === 0 && B < 4) break;
      }
      return { texture: t.a.texture, width: t.w, target: t.a };
    },
    forget(pool) { const t = targets.get(pool); if (t) { t.a.dispose(); t.b.dispose(); targets.delete(pool); } },
    dispose() { for (const t of targets.values()) { t.a.dispose(); t.b.dispose(); } targets.clear(); keyM.dispose(); passM.dispose(); },
  };
}

// --- flipbook sheets -----------------------------------------------------------------------------------------------
// rgb is a shading factor on the particle's colour, a its coverage. 'smoke' plays once (frame = age / life): a puff
// that billows and thins. 'flame' loops (the last frame runs into the first): a tongue that licks upward.
const SHEET = /* glsl */ `precision highp float; precision highp int;
layout(location = 0) out vec4 o; uniform vec4 uGrid; uniform vec2 uRes;
${NOISE_GLSL}
float flame(vec2 uv, float t){ return mgFbm3(vec3(uv.x * 2.4, uv.y * 1.7 - t * 3.0, t * 0.8 + 3.0), 4); }
void main(){
  vec2 g = gl_FragCoord.xy / uRes * uGrid.xy, cell = floor(g), uv = fract(g) * 2.0 - 1.0;
  float n = uGrid.x * uGrid.y, t = (cell.x + (uGrid.y - 1.0 - cell.y) * uGrid.x) / n, r = length(uv);
  if (uGrid.z < 0.5) {
    vec3 p = vec3(uv * 1.5, t * 1.4) + 7.0;
    float d = mgFbm3(p, 5) * 0.5 + 0.5, dl = mgFbm3(p + vec3(-0.16, 0.2, 0.0), 5) * 0.5 + 0.5;
    float a = smoothstep(1.0, 0.3, r + (d - 0.5) * 1.1) * smoothstep(0.2 + 0.25 * t, 0.62 + 0.2 * t, d + 0.3 * (1.0 - r));
    o = vec4(vec3(clamp(0.8 + (d - dl) * 2.6 + uv.y * 0.12, 0.4, 1.2)), a);     // lighter where density falls toward the light
  } else {
    float nz = mix(flame(uv, t), flame(uv, t - 1.0), t), y = uv.y * 0.5 + 0.5, w = mix(0.7, 0.04, y * y);
    float x = abs(uv.x + nz * 0.5 * y), a = smoothstep(w, w * 0.3, x) * smoothstep(1.0, 0.55, y + nz * 0.35) * smoothstep(-1.0, -0.85, uv.y);
    o = vec4(vec3(0.55 + 0.9 * a * (1.15 - y)), a);                              // hotter at the core and the base
  }
}`;
export function makeSheet(renderer, kind = 'smoke', { cols = 8, rows = 8, cell = 64 } = {}) {
  const w = cols * cell, h = rows * cell, rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const m = raw(SHEET, { uGrid: { value: new THREE.Vector4(cols, rows, kind === 'flame' ? 1 : 0, 0) }, uRes: { value: new THREE.Vector2(w, h) } });
  gpuPass(renderer, m, rt); m.dispose();
  return { texture: rt.texture, cols, rows, target: rt };
}

// --- depth copy ----------------------------------------------------------------------------------------------------
// Transparent particles cannot sample the depth buffer they are being tested against, so the opaque depth is copied
// once per render, after the opaque pass and before the first particle draws: a mesh with renderOrder below every
// pool does the copy in its onBeforeRender (a blit, which also resolves a multisampled target). The copy and the
// camera that made it stay valid until the next frame, where the simulation uses them for depth collision.
export function createDepthCopy() {
  const D = { valid: false, ready: false, texture: null, rt: null, vp: new THREE.Matrix4(), invVp: new THREE.Matrix4(), viewZ: new THREE.Vector4(), eye: new THREE.Vector3(), copies: 0, failed: false };
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false, fog: false }));
  mesh.name = 'vfx:depth-copy'; mesh.frustumCulled = false; mesh.renderOrder = -100; mesh.userData.collide = false; mesh.userData.mgNoCapture = true;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    D.valid = false;
    if (D.failed || !rt || !rt.depthTexture || rt.isWebGLCubeRenderTarget) return;
    const w = rt.width, h = rt.height, gl = renderer.getContext(), pp = renderer.properties.get(rt), src = pp.__webglMultisampledFramebuffer || pp.__webglFramebuffer;
    if (!src || Array.isArray(src)) return;
    if (!D.rt || D.rt.width !== w || D.rt.height !== h || D.texture.type !== rt.depthTexture.type) {
      if (D.rt) D.rt.dispose();
      const dt = new THREE.DepthTexture(w, h, rt.depthTexture.type); dt.format = rt.depthTexture.format;
      D.rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, stencilBuffer: rt.stencilBuffer, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      renderer.initRenderTarget(D.rt);
      renderer.state.bindFramebuffer(gl.FRAMEBUFFER, src);        // creating a target leaves nothing bound, mid-frame
      D.texture = dt;
    }
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);                   // a blit is clipped by the scissor box
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, renderer.properties.get(D.rt).__webglFramebuffer);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    // exactly the bindings three believes are current, so its state cache stays true
    gl.bindFramebuffer(gl.FRAMEBUFFER, src);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    if (D.copies === 0 && gl.getError() !== gl.NO_ERROR) { D.failed = true; return; }   // formats that will not blit: features off, not a broken frame
    D.copies++; D.valid = true; D.ready = true;
    const e = camera.matrixWorldInverse.elements;
    D.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); D.invVp.copy(D.vp).invert();
    D.viewZ.set(-e[2], -e[6], -e[10], -e[14]); D.eye.setFromMatrixPosition(camera.matrixWorld);
    D.near = camera.near; D.far = camera.far; D.ortho = !!camera.isOrthographicCamera;
  };
  D.mesh = mesh;
  D.dispose = () => { if (D.rt) D.rt.dispose(); geo.dispose(); mesh.material.dispose(); };
  return D;
}

// Mirage original code.
// The parts of the effect system that are not point particles (reached through createVfx, vfx.js):
//
//   emitter.trail = { segments: 12, every: 2, width: 0.5, taper: 1 }    a ribbon behind every particle of an emitter
//   vfx.beam({ from, to, width: 0.08, color: '#9cf', jitter: 0.6, branches: 2, life: 0.3 })   a beam or a lightning bolt
//   vfx.decal({ position, normal, size: 2, pattern: 'scorch', life: 20 })                    a mark on the scene
//
// Trails keep each particle's last `segments` positions in one more float texture (a band per sample, written every
// `every` steps by a pass that touches only that band) and draw one instanced strip per particle.
// Beams are polylines built on the CPU from a seed (midpoint displacement for lightning) and drawn as camera-facing
// additive ribbons; a bolt's shape is a function of its seed and floor(time × rate), so it replays exactly.
// Decals are boxes whose fragments look up the scene depth copy, rebuild the world position under the pixel and
// paint a procedural pattern where it falls inside the box: they wrap whatever is there, with no mesh of their own.
import * as THREE from 'three';
import { patch } from './materials.js';
import { FOG } from './fog.js';
import { NOISE_GLSL } from './noise.js';
import { VFX_LUT_W, parseColor } from './vfx-data.js';
import { gpuPass, SIM_VERTEX } from './particles.js';
import { VFX_FOG_T } from './particle-draw.js';
import { seeded } from './vfx-gpu.js';

const fogU = (U, gain) => Object.assign(U, { uVFogP: { value: FOG.params }, uVFogD: { value: 0 }, uVGain: gain || { value: 1 } });
const fogD = (scene) => (scene.fog && scene.fog.isFogExp2 ? scene.fog.density : 0);
// a strip of `rows` cross-sections: position.x = side (-1 | 1), position.y = row
function strip(rows) {
  const g = new THREE.InstancedBufferGeometry(), p = new Float32Array(rows * 2 * 3), ix = [];
  for (let r = 0; r < rows; r++) { p.set([-1, r, 0, 1, r, 0], r * 6); if (r) ix.push(2 * r - 2, 2 * r - 1, 2 * r, 2 * r, 2 * r - 1, 2 * r + 1); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setIndex(ix);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e-3); g.instanceCount = 0;
  return g;
}
const ribbonMaterial = (add) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: !add, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
function ribbonMesh(geometry, material, name, order) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = false; mesh.userData.collide = false; mesh.userData.mgNoCapture = true;
  mesh.renderOrder = order; mesh.matrixAutoUpdate = false;
  return mesh;
}

// --- trails --------------------------------------------------------------------------------------------------------
const TRAIL_CAPTURE = /* glsl */ `precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 o; uniform sampler2D tP; uniform int uBandY;
void main(){ o = texelFetch(tP, ivec2(gl_FragCoord.xy) - ivec2(0, uBandY), 0); }`;
export function createTrailMesh(pool, o) {
  const e = pool.e, tr = e.trail, S = tr.segments, add = e.render.blend === 'add';
  const hist = new THREE.WebGLRenderTarget(pool.W, pool.H * S, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  hist.scissorTest = true;
  const capU = { tP: { value: null }, uBandY: { value: 0 } };
  const capM = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SIM_VERTEX, fragmentShader: TRAIL_CAPTURE, uniforms: capU, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  let band = 0, capStep = -1e9;
  // after each simulation step: every `every`-th one copies the positions (and ages) into the next band
  pool.onStep = () => {
    if (pool.step % tr.every) return;
    band = (pool.step / tr.every) % S; capStep = pool.step;
    hist.viewport.set(0, band * pool.H, pool.W, pool.H); hist.scissor.copy(hist.viewport);
    capU.tP.value = pool.state.textures[0]; capU.uBandY.value = band * pool.H;
    gpuPass(pool.renderer, capM, hist);
  };
  const U = fogU({
    tVP: { value: null }, tVV: { value: null }, tVX: { value: null }, tVLut: { value: o.lut }, tTH: { value: hist.texture },
    uVWin: { value: new THREE.Vector4(0, 0, pool.W, pool.cap) }, uTA: { value: new THREE.Vector4(0, 0, 0, pool.dt) },   // lead s, newest band, steps since it was written, dt
    uTB: { value: new THREE.Vector4(S, tr.every, tr.width, tr.taper) }, uTH: { value: pool.H },
  }, o.gain);
  const material = ribbonMaterial(add);
  patch(material, { uniforms: U, specAA: false,
    vertexDecl: /* glsl */ `
uniform highp sampler2D tVP, tVV, tVX, tTH; uniform sampler2D tVLut; uniform vec4 uVWin, uTA, uTB; uniform float uTH;
varying vec4 vPc; varying vec2 vPq;
ivec2 trSt; vec3 trHead; float trAge; int trMax;
// the trail's r-th point: 0 is the particle now, r >= 1 its position r - 1 samples back. Samples older than the
// particle belong to the slot's previous occupant: the row is clamped to the oldest that is its own.
vec3 trPoint(int r){
  int j = min(r - 1, trMax); if (r == 0 || j < 0) return trHead;
  int b = int(uTA.y) - j; b = ((b % int(uTB.x)) + int(uTB.x)) % int(uTB.x);
  return texelFetch(tTH, ivec2(trSt.x, trSt.y + b * int(uTH)), 0).xyz;
}`,
    vertexWorld: /* glsl */ `
  {
    int vcap = int(uVWin.w), vw = int(uVWin.z), slot = (int(uVWin.x) + gl_InstanceID) % vcap, row = int(position.y + 0.5);
    trSt = ivec2(slot % vw, slot / vw);
    vec4 sP = texelFetch(tVP, trSt, 0), sV = texelFetch(tVV, trSt, 0), sX = texelFetch(tVX, trSt, 0);
    float life = max(sV.w, 1e-4), lt = clamp((sP.w + uTA.x) / life, 0.0, 1.0);
    bool alive = sV.w > 0.0 && sP.w < sV.w;
    trAge = sP.w; trHead = sP.xyz + sV.xyz * uTA.x * ((int(sX.z + 0.5) & 8) != 0 ? 0.0 : 1.0);
    trMax = min(int(uTB.x) - 1, int(floor((sP.w / uTA.w - uTA.z - 0.01) / uTB.y)));
    vec3 p = trPoint(row), d = row == 0 ? trHead - trPoint(1) : trPoint(row - 1) - p;
    if (dot(d, d) < 1e-10) d = sV.xyz;
    vec3 sd = cross(d, cameraPosition - p); sd = dot(sd, sd) > 1e-12 ? normalize(sd) : vec3(0.0);
    float lu = lt * ${(1 - 1 / VFX_LUT_W).toFixed(6)} + ${(0.5 / VFX_LUT_W).toFixed(6)}, along = float(row) / uTB.x;
    vec4 l0 = texture2D(tVLut, vec2(lu, 0.25)), l1 = texture2D(tVLut, vec2(lu, 0.75));
    float w = alive ? 0.5 * sX.w * l1.x * uTB.z * (1.0 - uTB.w * along) : 0.0;
    mgWorld = p + sd * (position.x * w);
    vPc = vec4(l0.rgb * (1.0 + l1.y), l0.a * (1.0 - along)); vPq = vec2(position.x, along);
  }`,
    fragmentDecl: /* glsl */ `varying vec4 vPc; varying vec2 vPq; uniform vec4 uVFogP; uniform float uVFogD;${VFX_FOG_T}`,
    albedo: 'diffuseColor = vec4(vPc.rgb, vPc.a * (1.0 - vPq.x * vPq.x)); if (diffuseColor.a < 0.003) discard;',
    output: add ? 'outgoingLight = diffuseColor.rgb * uVGain * diffuseColor.a * vfxFogT(mgWorldPos); diffuseColor.a = 1.0;' : 'outgoingLight = diffuseColor.rgb * uVGain;',
  }, o.G);
  const mesh = ribbonMesh(strip(S + 1), material, `vfx:${e.name}:trail`, 10 + e.render.order + (add ? 1 : 0));
  mesh.onBeforeRender = (renderer, scene) => {
    const t = pool.state.textures; U.tVP.value = t[0]; U.tVV.value = t[1]; U.tVX.value = t[2];
    U.uTA.value.set(Math.max(-0.1, Math.min(0.1, o.G.uTime.value - (pool.step + pool.lag) * pool.dt)), band, pool.step - capStep, pool.dt);
    U.uVFogD.value = fogD(scene);
  };
  mesh.userData.sync = (w, sphere, visible) => {
    mesh.geometry.instanceCount = w.count; U.uVWin.value.x = w.base; U.uVWin.value.y = w.count; mesh.visible = visible;
    if (visible) mesh.geometry.boundingSphere.copy(sphere);
  };
  mesh.userData.dispose = () => { hist.dispose(); capM.dispose(); mesh.geometry.dispose(); material.dispose(); pool.onStep = null; };
  return mesh;
}

// --- beams and lightning -------------------------------------------------------------------------------------------
const BEAMS = 48, BEAM_PTS = 48;
/** ctx: { scene, camera, G, root }. add(o): from, to ([x, y, z] or Vector3: kept, so moving them moves the beam),
 *  width (0.08 m), color, intensity (4), life (0.3 s; 0 = until remove()), jitter (0: straight; metres of sideways
 *  displacement for lightning), rate (24 new shapes per second), branches (0..4), seed, order */
export function createBeams(ctx) {
  const pts = new Float32Array(BEAMS * BEAM_PTS * 4), cols = new Float32Array(BEAMS * 4), list = [];
  const tP = new THREE.DataTexture(pts, BEAM_PTS, BEAMS, THREE.RGBAFormat, THREE.FloatType), tC = new THREE.DataTexture(cols, BEAMS, 1, THREE.RGBAFormat, THREE.FloatType);
  const U = fogU({ tBP: { value: tP }, tBC: { value: tC } }, ctx.gain);
  const material = ribbonMaterial(true);
  patch(material, { uniforms: U, specAA: false,
    vertexDecl: 'uniform highp sampler2D tBP, tBC; varying vec4 vPc; varying float vPx;',
    vertexWorld: /* glsl */ `
  {
    int row = int(position.y + 0.5), last = ${BEAM_PTS - 1};
    vec4 p = texelFetch(tBP, ivec2(row, gl_InstanceID), 0);
    vec3 d = texelFetch(tBP, ivec2(min(row + 1, last), gl_InstanceID), 0).xyz - texelFetch(tBP, ivec2(max(row - 1, 0), gl_InstanceID), 0).xyz;
    vec3 sd = cross(d, cameraPosition - p.xyz); sd = dot(sd, sd) > 1e-12 ? normalize(sd) : vec3(0.0);
    mgWorld = p.xyz + sd * (position.x * p.w);
    vPc = texelFetch(tBC, ivec2(gl_InstanceID, 0), 0); vPx = position.x;
  }`,
    fragmentDecl: /* glsl */ `varying vec4 vPc; varying float vPx; uniform vec4 uVFogP; uniform float uVFogD;${VFX_FOG_T}`,
    // a white-hot core inside a wider glow of the beam's colour
    albedo: 'float bx = abs(vPx); diffuseColor = vec4(vPc.rgb * (exp(-bx * bx * 5.0) - 0.0067) + vec3(dot(vPc.rgb, vec3(0.3333))) * exp(-bx * bx * 60.0), vPc.a);',
    output: 'outgoingLight = max(diffuseColor.rgb, 0.0) * uVGain * diffuseColor.a * vfxFogT(mgWorldPos); diffuseColor.a = 1.0;',
  }, ctx.G);
  const mesh = ribbonMesh(strip(BEAM_PTS), material, 'vfx:beams', 12);
  mesh.frustumCulled = false; mesh.visible = false;
  mesh.onBeforeRender = (renderer, scene) => { U.uVFogD.value = fogD(scene); };
  ctx.root.add(mesh);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ax = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3(), off = new Float32Array(BEAM_PTS * 2);
  const v3 = (p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]));
  // one polyline into row `row`: from A to B, displaced sideways by midpoint subdivision (the ends stay put)
  function line(row, A, B, jitter, width, rnd) {
    ax.subVectors(B, A); const len = ax.length() || 1e-6; ax.multiplyScalar(1 / len);
    s1.set(0, 1, 0); if (Math.abs(ax.y) > 0.95) s1.set(1, 0, 0); s1.cross(ax).normalize(); s2.crossVectors(ax, s1);
    off.fill(0);
    // octaves of random offsets at 3, 5, 9, 17, 33 control points, joined by straight pieces: the kinked look of a spark
    if (jitter > 0) for (let n = 3, amp = jitter; n < BEAM_PTS; n = n * 2 - 1, amp *= 0.55) {
      let x0 = 0, y0 = 0, x1 = (rnd() * 2 - 1) * amp, y1 = (rnd() * 2 - 1) * amp, seg = 0;
      for (let i = 0; i < BEAM_PTS; i++) {
        const u = i / (BEAM_PTS - 1) * (n - 1), k = Math.min(n - 2, Math.floor(u)), f = u - k;
        while (seg < k) { x0 = x1; y0 = y1; x1 = (rnd() * 2 - 1) * amp; y1 = (rnd() * 2 - 1) * amp; seg++; }
        off[i * 2] += x0 + (x1 - x0) * f; off[i * 2 + 1] += y0 + (y1 - y0) * f;
      }
    }
    for (let i = 0; i < BEAM_PTS; i++) {
      const t = i / (BEAM_PTS - 1), o = (row * BEAM_PTS + i) * 4, e = Math.sin(Math.PI * t) ** 0.5;     // pinned at both ends
      pts[o] = A.x + (B.x - A.x) * t + (s1.x * off[i * 2] + s2.x * off[i * 2 + 1]) * e;
      pts[o + 1] = A.y + (B.y - A.y) * t + (s1.y * off[i * 2] + s2.y * off[i * 2 + 1]) * e;
      pts[o + 2] = A.z + (B.z - A.z) * t + (s1.z * off[i * 2] + s2.z * off[i * 2 + 1]) * e;
      pts[o + 3] = width * 0.5;
    }
  }
  return {
    list,
    add(o) {
      const q = { from: v3(o.from), to: v3(o.to), width: o.width ?? 0.08, color: parseColor(o.color ?? '#9cc8ff'), intensity: o.intensity ?? 4, life: o.life ?? 0.3, jitter: o.jitter ?? 0,
        rate: o.rate ?? 24, branches: Math.min(4, o.branches ?? 0), seed: o.seed ?? 1 + list.length * 7919, t0: null, done: false, remove() { q.done = true; } };
      list.push(q);
      return q;
    },
    update(T) {
      let row = 0;
      for (let i = 0; i < list.length; i++) {
        const q = list[i]; if (q.t0 === null) q.t0 = T;
        const age = T - q.t0;
        if (q.done || (q.life > 0 && (age >= q.life || age < 0))) { q.done = true; list.splice(i--, 1); continue; }
        if (row >= BEAMS) continue;
        const f = q.life > 0 ? 1 - age / q.life : 1, rnd = seeded(q.seed * 2654435761 + Math.floor(T * q.rate) * 40503);
        const flick = q.jitter > 0 ? 0.6 + 0.4 * rnd() : 1, put = (r, k) => { cols[r * 4] = q.color[0] * q.intensity * k; cols[r * 4 + 1] = q.color[1] * q.intensity * k; cols[r * 4 + 2] = q.color[2] * q.intensity * k; cols[r * 4 + 3] = f * f * flick; };
        const main = row; line(row, q.from, q.to, q.jitter, q.width, rnd); put(row++, 1);
        for (let k = 0; k < q.branches && row < BEAMS; k++) {
          // a branch leaves a point of the main bolt and runs off at an angle for a fraction of its length
          const at = 6 + Math.floor(rnd() * (BEAM_PTS - 16)), o = (main * BEAM_PTS + at) * 4, len = a.subVectors(q.to, q.from).length() * (0.15 + 0.25 * rnd());
          a.set(pts[o], pts[o + 1], pts[o + 2]);
          b.subVectors(q.to, q.from).normalize().add(s1.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.6)).normalize().multiplyScalar(len).add(a);
          line(row, a, b, q.jitter * 0.4, q.width * 0.55, rnd); put(row++, 0.5);
        }
      }
      mesh.visible = row > 0; mesh.geometry.instanceCount = row;
      if (row) tP.needsUpdate = tC.needsUpdate = true;
    },
    clear() { list.length = 0; mesh.visible = false; },
    dispose() { tP.dispose(); tC.dispose(); mesh.geometry.dispose(); material.dispose(); ctx.root.remove(mesh); },
  };
}

// --- decals --------------------------------------------------------------------------------------------------------
const DECALS = 128, PATTERNS = { soft: 0, scorch: 1, splat: 2, crack: 3, ring: 4 };
const DECAL_VERT = /* glsl */ `
in vec4 aInv0, aInv1, aInv2, aInv3, aColor, aParam; out vec4 vColor, vParam; out mat4 vInv;
void main(){ vInv = mat4(aInv0, aInv1, aInv2, aInv3); vColor = aColor; vParam = aParam; gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const DECAL_FRAG = /* glsl */ `precision highp float; precision highp int;
in vec4 vColor, vParam; in mat4 vInv; layout(location = 0) out vec4 o;
uniform highp sampler2D tVDepth; uniform mat4 uInvVP; uniform vec2 uRes; uniform float uAdd; uniform vec4 uVFogP; uniform float uVFogD;
${NOISE_GLSL}
${VFX_FOG_T}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; float d = texelFetch(tVDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (d >= 1.0) discard;                                          // sky
  vec4 w = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); w /= w.w;
  vec3 l = (vInv * w).xyz;                                        // the pixel's surface in the decal's unit box (y = its normal)
  if (any(greaterThan(abs(l), vec3(0.5)))) discard;
  // surfaces that face away from the decal's axis (the side of a kerb under a floor decal) are left alone
  vec3 n = normalize(cross(dFdx(w.xyz), dFdy(w.xyz))), up = normalize(vec3(vInv[0].y, vInv[1].y, vInv[2].y));
  float a = smoothstep(0.25, 0.5, abs(dot(n, up))) * smoothstep(0.5, 0.3, abs(l.y));
  vec2 q = l.xz * 2.0; float r = length(q), s = vParam.y, an = atan(q.y, q.x);
  int kind = int(vParam.x + 0.5);
  if (kind == 0) a *= smoothstep(1.0, 0.0, r);
  else if (kind == 1) { float nz = mgFbm3(vec3(q * 2.2, s), 4); a *= smoothstep(1.0, 0.25, r + nz * 0.45) * (0.75 + 0.25 * nz); }                       // soot: a ragged dark heart
  else if (kind == 2) { float lobes = 0.62 + 0.3 * mgFbm3(vec3(cos(an) * 1.7, sin(an) * 1.7, s), 3); a *= smoothstep(lobes, lobes - 0.07, r); }       // a splash with fingers
  else if (kind == 3) { float rays = abs(fract(an * 1.1141 + 0.35 * mgFbm3(vec3(q * 1.6, s), 3)) - 0.5); a *= smoothstep(0.035, 0.008, rays * r) * smoothstep(1.0, 0.35, r); }   // cracks from a point
  else a *= smoothstep(1.0, 0.9, r) * smoothstep(0.72, 0.82, r);                                                                                    // a ring
  a *= vColor.a * vParam.z;
  if (a < 0.003) discard;
  // multiply: the surface's own light scaled toward the decal's colour, right under any light. add: light of its own.
  o = uAdd > 0.5 ? vec4(vColor.rgb * uVGain * a * vfxFogT(w.xyz), 1.0) : vec4(mix(vec3(1.0), vColor.rgb, a), 1.0);
}`;
/** add(o): position, normal ([0, 1, 0]), size (metres across, or [w, d]), depth (0.5: how far it reaches along the
 *  normal), rotation (radians about the normal; from the seed when absent), pattern ('scorch' | 'splat' | 'crack' |
 *  'ring' | 'soft'), color, opacity (1), blend ('multiply' | 'add'), intensity (add: 2), life (0 = forever),
 *  fade (seconds of fade-out at the end of life), seed. At most 128 per blend; the oldest is recycled. */
export function createDecals(ctx) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const layer = (add) => {
    const g = new THREE.InstancedBufferGeometry(); g.index = box.index; g.setAttribute('position', box.attributes.position);
    const inv = [0, 1, 2, 3].map((i) => { const at = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 4), 4); g.setAttribute('aInv' + i, at); return at; });
    const color = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 4), 4), param = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 4), 4);
    g.setAttribute('aColor', color); g.setAttribute('aParam', param);
    const U = fogU({ tVDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uAdd: { value: add ? 1 : 0 } }, ctx.gain);
    const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, uniforms: U, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      blending: add ? THREE.AdditiveBlending : THREE.MultiplyBlending, premultipliedAlpha: !add });
    const mesh = new THREE.InstancedMesh(g, material, DECALS);
    mesh.name = add ? 'vfx:decals:add' : 'vfx:decals'; mesh.count = 0; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = add ? 6 : 5;
    mesh.castShadow = mesh.receiveShadow = false; mesh.userData.collide = false; mesh.userData.mgNoCapture = true;
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const d = ctx.depth, rt = renderer.getRenderTarget();
      U.tVDepth.value = d.valid ? d.texture : null; if (rt) U.uRes.value.set(rt.width, rt.height);
      U.uInvVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert(); U.uVFogD.value = fogD(scene);
      material.colorWrite = d.valid;                              // no depth copy (drawing straight to the canvas): no decals
    };
    ctx.root.add(mesh);
    return { add, mesh, g, inv, color, param, items: [], dirty: false };
  };
  const layers = [layer(false), layer(true)], m = new THREE.Matrix4(), mi = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), nrm = new THREE.Vector3(), sc = new THREE.Vector3();
  let now = 0;
  return {
    layers,
    add(o) {
      const L = layers[o.blend === 'add' ? 1 : 0], seed = o.seed ?? 1 + L.items.length * 31, size = Array.isArray(o.size) ? o.size : [o.size ?? 1, o.size ?? 1];
      const c = parseColor(o.color ?? (L.add ? '#ff9a3c' : '#1a1512')), k = L.add ? o.intensity ?? 2 : 1;
      const d = { position: [...(o.position.isVector3 ? o.position.toArray() : o.position)], normal: o.normal ? [...(o.normal.isVector3 ? o.normal.toArray() : o.normal)] : [0, 1, 0], size, depth: o.depth ?? 0.5,
        rotation: o.rotation ?? seeded(seed)() * Math.PI * 2, pattern: PATTERNS[o.pattern ?? 'scorch'] ?? 1, color: [c[0] * k, c[1] * k, c[2] * k], opacity: o.opacity ?? 1, life: o.life ?? 0, fade: o.fade ?? 1, seed, t0: now, done: false, remove() { d.done = true; L.dirty = true; } };
      if (L.items.length >= DECALS) L.items.shift();
      L.items.push(d); L.dirty = true;
      return d;
    },
    update(T) {
      now = T;
      for (const L of layers) {
        let fading = false;
        for (let i = 0; i < L.items.length; i++) { const d = L.items[i]; if (d.done || (d.life > 0 && T - d.t0 >= d.life)) { L.items.splice(i--, 1); L.dirty = true; } else if (d.life > 0 && T - d.t0 > d.life - d.fade) fading = true; }
        if (!L.dirty && !fading) continue;
        L.items.forEach((d, i) => {
          q.setFromUnitVectors(up, nrm.set(...d.normal).normalize()).multiply(q2.setFromAxisAngle(up, d.rotation));
          m.compose(p.set(...d.position), q, sc.set(d.size[0], d.depth, d.size[1])); mi.copy(m).invert();
          L.mesh.setMatrixAt(i, m);
          for (let c = 0; c < 4; c++) L.inv[c].setXYZW(i, mi.elements[c * 4], mi.elements[c * 4 + 1], mi.elements[c * 4 + 2], mi.elements[c * 4 + 3]);
          L.color.setXYZW(i, d.color[0], d.color[1], d.color[2], d.opacity);
          L.param.setXYZW(i, d.pattern, (d.seed % 97) * 1.37, d.life > 0 ? Math.min(1, Math.max(0, (d.life - (T - d.t0)) / Math.max(d.fade, 1e-3))) : 1, 0);
        });
        L.mesh.count = L.items.length; L.mesh.visible = L.items.length > 0; L.dirty = false;
        L.mesh.instanceMatrix.needsUpdate = L.color.needsUpdate = L.param.needsUpdate = true; for (const a of L.inv) a.needsUpdate = true;
      }
    },
    clear() { for (const L of layers) { L.items.length = 0; L.dirty = true; } },
    dispose() { for (const L of layers) { ctx.root.remove(L.mesh); L.g.dispose(); L.mesh.material.dispose(); } box.dispose(); },
  };
}

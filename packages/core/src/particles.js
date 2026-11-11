// Mirage original code.
// GPU particle simulation for WebGL2: one pool per emitter description, its state in three float textures that a
// fragment shader advances by a FIXED step. The CPU only decides how many particles each live instance spawns in a
// step and where its origin is; position, velocity, forces, collision and death all happen on the GPU.
//
//   import { ParticlePool, defineEffect } from '@miragekit/core';     // normally reached through createVfx (vfx.js)
//   const pool = new ParticlePool(renderer, defineEffect(desc).emitters[0], { hz: 60 });
//   const src = pool.addSource({ matrix, scale: 1 });              // an instance of the effect: no allocation
//   pool.advanceTo(step, env);                                     // run fixed steps up to an absolute step count
//   pool.state                                                     // { P, V, X } textures, pool.window for the draw
//
// State layout (RGBA32F, one texel per particle slot):
//   P  xyz world position, w age (s)          V  xyz world velocity, w life (s; 0 = free slot)
//   X  x per-particle random, y birth rotation (rad), z event flags of the LAST step, w birth size (m)
// Flags: 1 born, 2 collided, 4 died (a dying particle keeps its state for one more step so a sub-emitter can read
// where it died), 8 stuck to a surface.
// Slots are a ring: a step's spawns take the next slots in order, so "the particles alive now" is one contiguous
// window behind the cursor. That gives the draw its instance count and oldest/youngest order without a readback.
// The ring overwrites the oldest particle when an effect asks for more than its capacity.
// Why fixed steps: a still, a playtest and a replay must see the same particles. Each step's random numbers are a
// hash of (slot, step, seed), never of wall time, so the same step count gives the same texture bit for bit on
// the same GPU and driver.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { effectRadius } from './vfx-data.js';

export const MAX_SPAWN_SOURCES = 8;          // instances that can spawn in one step of one pool; the rest wait a step
const SHAPE_ID = { point: 0, sphere: 1, box: 2, cone: 3, ring: 4, edge: 5, mesh: 6 };
const EVENT_BIT = { birth: 1, collision: 2, death: 4 };

// Spawn position `lp` and outward normal `n` in the emitter's own space, from two random triples.
const SHAPE_GLSL = [
  /* point  */ 'lp = vec3(0.0); n = unit(r0.xy);',
  /* sphere */ 'n = unit(r0.xy); if (uShapeB.y > 0.5) n.y = abs(n.y); lp = n * uShapeA.x * mix(pow(r0.z, 1.0 / 3.0), 1.0, uShapeA.y);',
  /* box    */ 'lp = (r0 - 0.5) * uShapeA.xyz; n = vec3(0.0, 1.0, 0.0);',
  // cone: axis +Y from a base disc of `radius`; rays open by `angle`, particles start anywhere along `length`
  /* cone   */ 'float a = r0.x * 6.2831853, rr = sqrt(r0.y); vec2 c = vec2(cos(a), sin(a)); float t = tan(uShapeA.y) * rr;\n' +
               '    n = normalize(vec3(c.x * t, 1.0, c.y * t)); lp = vec3(c.x, 0.0, c.y) * uShapeA.x * rr + n * uShapeA.z * r0.z;',
  /* ring   */ 'float a = r0.x * 6.2831853; n = vec3(cos(a), 0.0, sin(a)); lp = n * uShapeA.x * mix(1.0, sqrt(r0.y), 1.0 - uShapeA.y);',
  /* edge   */ 'lp = mix(uShapeA.xyz, uShapeB.xyz, r0.x); n = vec3(0.0, 1.0, 0.0);',
  /* mesh   */ 'int mi = min(int(r0.x * float(uMeshN)), uMeshN - 1); lp = texelFetch(tMesh, ivec2(mi, 0), 0).xyz; n = texelFetch(tMesh, ivec2(mi, 1), 0).xyz;',
];

/** fragment shader of one emitter's step; `sub` = { on, count, rate } when the pool is fed by a parent pool */
export function simFragment(e, sub = null) {
  const c = e.collision, D = [];
  if (e.turbulence.strength > 0) D.push('TURB');
  if (e.wind > 0) D.push('WIND');
  if (e.attractors.length) D.push(`ATTR ${e.attractors.length}`);
  if (e.field) D.push('FIELD');
  if (c) { D.push(`COLLIDE ${['bounce', 'kill', 'stick'].indexOf(c.mode)}`); if (c.planes.length) D.push(`PLANES ${c.planes.length}`); if (c.ground) D.push('GROUND'); if (c.depth) D.push('DEPTHHIT'); }
  if (sub) D.push('SUB', sub.on === 'life' ? 'SUB_LIFE' : `SUB_BIT ${EVENT_BIT[sub.on]}`);
  return /* glsl */ `precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
${D.map((d) => `#define ${d}`).join('\n')}
layout(location = 0) out vec4 oP; layout(location = 1) out vec4 oV; layout(location = 2) out vec4 oX;
uniform sampler2D tP, tV, tX;
uniform int uW, uCap, uStep, uSeed, uReset;
uniform float uDt, uTime;
uniform int uSpawnStart, uSpawnTotal, uSrcEnd[${MAX_SPAWN_SOURCES}];
uniform mat4 uSrcMat[${MAX_SPAWN_SOURCES}];
uniform vec4 uSrcVel[${MAX_SPAWN_SOURCES}];
uniform vec4 uShapeA, uShapeB;             // per shape, see SHAPE_GLSL
uniform vec3 uOffset, uDir, uGravity;
uniform vec4 uSpeed;                        // speed min, max, cos(spread), inherit
uniform vec4 uKick;                         // normal min, max, random min, max
uniform vec4 uLifeSize;                     // life min, max, size min, max
uniform vec4 uRotDrag;                      // rotation min, max (rad), drag, wind coupling
uniform vec3 uTurb, uWindV;                 // strength, 1/scale, scroll speed; wind velocity (m/s)
uniform sampler2D tMesh; uniform int uMeshN;
#ifdef ATTR
uniform vec4 uAttr[ATTR]; uniform vec2 uAttrB[ATTR];   // xyz position, strength; radius, spin
#endif
#ifdef FIELD
uniform sampler3D tField; uniform vec3 uFieldMin, uFieldInv; uniform float uFieldK;
#endif
#ifdef COLLIDE
uniform vec4 uHit;                          // bounce, friction, radius, life loss
uniform float uThick;
#endif
#ifdef PLANES
uniform vec4 uPlane[PLANES];
#endif
#ifdef GROUND
uniform sampler2D tGround; uniform vec4 uGroundRect; uniform float uGroundOn;   // x0, z0, 1/width, 1/depth
#endif
#ifdef DEPTHHIT
uniform sampler2D tDepth; uniform mat4 uVP, uInvVP; uniform vec4 uViewZ; uniform vec3 uEye; uniform float uDepthOn;
#endif
#ifdef SUB
uniform sampler2D tPP, tPV, tPX; uniform int uPW, uK; uniform float uSubRate, uSubInherit;
#endif
${NOISE_GLSL}
uvec3 gS;
vec3 rnd3(){ gS = mgPcg3(gS); return vec3(gS) * MG_U2F; }
vec3 unit(vec2 u){ float z = u.x * 2.0 - 1.0, a = u.y * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z)); return vec3(r * cos(a), z, r * sin(a)); }
// a direction within the cone of half-angle acos(cs) about d
vec3 spread(vec3 d, float cs, vec2 u){
  float z = mix(1.0, cs, u.x), a = u.y * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z));
  vec3 t = normalize(abs(d.y) < 0.99 ? cross(d, vec3(0.0, 1.0, 0.0)) : vec3(1.0, 0.0, 0.0)), b = cross(d, t);
  return t * (r * cos(a)) + b * (r * sin(a)) + d * z;
}
#ifdef TURB
// curl of a vector potential made of three decorrelated gradient noises: divergence-free, so the flow swirls
// particles without bunching them up (forward differences: 9 noise taps instead of 18)
vec3 pot(vec3 p){ return vec3(mgGrad3(p), mgGrad3(p + vec3(31.4, 17.7, 5.2)), mgGrad3(p + vec3(-9.1, 43.3, 27.9))); }
vec3 curl(vec3 p){
  const float E = 0.12; vec3 o = pot(p), x = pot(p + vec3(E, 0.0, 0.0)) - o, y = pot(p + vec3(0.0, E, 0.0)) - o, z = pot(p + vec3(0.0, 0.0, E)) - o;
  return vec3(y.z - z.y, z.x - x.z, x.y - y.x) / E;
}
#endif
#ifdef DEPTHHIT
vec3 unproject(vec2 uv, float d){ vec4 w = uInvVP * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return w.xyz / w.w; }
#endif
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy); int i = px.y * uW + px.x;
  if (uReset == 1 || i >= uCap) { oP = vec4(0.0); oV = vec4(0.0); oX = vec4(0.0); return; }
  vec4 P = texelFetch(tP, px, 0), V = texelFetch(tV, px, 0), X = texelFetch(tX, px, 0);
  gS = uvec3(uint(i), uint(uStep), uint(uSeed));
  bool born = false; mat4 M = mat4(1.0); vec4 sv = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef SUB
  // slot = parent slot × K + k: every parent owns K children, so an event needs no allocation and no readback
  int pi = i / uK, k = i - pi * uK; ivec2 pp = ivec2(pi % uPW, pi / uPW);
  vec4 qP = texelFetch(tPP, pp, 0), qV = texelFetch(tPV, pp, 0), qX = texelFetch(tPX, pp, 0);
  #ifdef SUB_LIFE
  float n1 = floor(qP.w * uSubRate), n0 = floor((qP.w - uDt) * uSubRate);
  born = qV.w > 0.0 && qP.w < qV.w && qP.w > 0.0 && n1 > n0 && int(mod(n1, float(uK))) == k;
  #else
  born = qV.w > 0.0 && (int(qX.z + 0.5) & SUB_BIT) != 0;
  #endif
  M[3].xyz = qP.xyz; sv = vec4(qV.xyz * uSubInherit, 1.0);
#else
  int rel = i - uSpawnStart; if (rel < 0) rel += uCap;
  if (rel < uSpawnTotal) {
    born = true; int s = 0;
    for (int j = 0; j < ${MAX_SPAWN_SOURCES - 1}; j++) if (rel >= uSrcEnd[j]) s = j + 1;
    M = uSrcMat[s]; sv = uSrcVel[s];
  }
#endif
  if (born) {
    vec3 r0 = rnd3(), r1 = rnd3(), r2 = rnd3(), r3 = rnd3(), r4 = rnd3(), lp, n;
    { ${SHAPE_GLSL[SHAPE_ID[e.shape.type]]} }
    vec3 v = spread(uDir, uSpeed.z, r1.xy) * mix(uSpeed.x, uSpeed.y, r1.z) + n * mix(uKick.x, uKick.y, r2.x) + unit(r3.xy) * mix(uKick.z, uKick.w, r3.z);
    vec3 wp = (M * vec4(lp + uOffset, 1.0)).xyz, wv = mat3(M) * v + sv.xyz * uSpeed.w;
    // born at a random moment inside the step, not all on its boundary: a fast emitter leaves no 1/60 s banding
    float pre = r4.x * uDt;
    oP = vec4(wp + wv * pre, pre);
    oV = vec4(wv, mix(uLifeSize.x, uLifeSize.y, r2.y));
    oX = vec4(r4.y, mix(uRotDrag.x, uRotDrag.y, r2.z), 1.0, mix(uLifeSize.z, uLifeSize.w, r4.z) * sv.w);
    return;
  }
  float life = V.w; int fl = int(X.z + 0.5);
  if (life <= 0.0 || P.w >= life) { oP = P; oV = vec4(V.xyz, 0.0); oX = vec4(X.xy, 0.0, X.w); return; }   // free, or died last step
  fl &= 8;
  vec3 p = P.xyz, v = V.xyz;
  if (fl == 0) {
    vec3 acc = uGravity;
#ifdef TURB
    acc += curl(p * uTurb.y + vec3(0.0, uTime * uTurb.z, 0.0)) * uTurb.x;
#endif
#ifdef WIND
    acc += (uWindV - v) * uRotDrag.w;
#endif
#ifdef ATTR
    for (int j = 0; j < ATTR; j++) {
      vec3 d = uAttr[j].xyz - p; float r = length(d), f = 1.0 / (1.0 + (r * r) / (uAttrB[j].x * uAttrB[j].x)); d /= max(r, 1e-4);
      acc += (d * uAttr[j].w + cross(vec3(0.0, 1.0, 0.0), d) * uAttrB[j].y) * f;
    }
#endif
#ifdef FIELD
    vec3 fu = (p - uFieldMin) * uFieldInv;
    if (all(greaterThanEqual(fu, vec3(0.0))) && all(lessThanEqual(fu, vec3(1.0)))) acc += texture(tField, fu).xyz * uFieldK;
#endif
    v += acc * uDt; v *= exp(-uRotDrag.z * uDt);
    vec3 q = p + v * uDt;
#ifdef COLLIDE
    bool hit = false; vec3 hn = vec3(0.0, 1.0, 0.0);
  #ifdef PLANES
    for (int j = 0; j < PLANES; j++) { float d = dot(uPlane[j].xyz, q) + uPlane[j].w - uHit.z; if (d < 0.0) { hit = true; hn = uPlane[j].xyz; q -= hn * d; } }
  #endif
  #ifdef GROUND
    if (uGroundOn > 0.5) {
      vec2 gu = (q.xz - uGroundRect.xy) * uGroundRect.zw;
      if (all(greaterThan(gu, vec2(0.0))) && all(lessThan(gu, vec2(1.0)))) {
        vec2 ts = 1.0 / vec2(textureSize(tGround, 0)); float gy = texture(tGround, gu).r;
        if (gy > -5e3 && q.y - uHit.z < gy && q.y > gy - uThick) {
          float gx = texture(tGround, gu + vec2(ts.x, 0.0)).r, gz = texture(tGround, gu + vec2(0.0, ts.y)).r;
          vec3 gn = vec3(gx > -5e3 ? (gy - gx) * uGroundRect.z / ts.x : 0.0, 1.0, gz > -5e3 ? (gy - gz) * uGroundRect.w / ts.y : 0.0);
          hit = true; hn = normalize(vec3(clamp(gn.x, -2.0, 2.0), 1.0, clamp(gn.z, -2.0, 2.0))); q.y = gy + uHit.z;
        }
      }
    }
  #endif
  #ifdef DEPTHHIT
    // the scene's own depth buffer as the collider: whatever the camera saw last frame is solid. A particle that
    // is behind a surface by less than uThick has hit it; farther behind, it is passing behind an object
    if (uDepthOn > 0.5) {
      vec4 cp = uVP * vec4(q, 1.0);
      if (cp.w > 0.0 && all(lessThan(abs(cp.xy), vec2(cp.w * 0.98)))) {
        vec2 uv = cp.xy / cp.w * 0.5 + 0.5; float d = texture(tDepth, uv).r;
        if (d < 1.0) {
          vec3 S = unproject(uv, d); float zs = dot(uViewZ, vec4(S, 1.0)), zp = dot(uViewZ, vec4(q, 1.0));
          if (zp + uHit.z > zs && zp < zs + uThick) {
            vec2 e = 1.5 / vec2(textureSize(tDepth, 0));
            vec3 Sx = unproject(uv + vec2(e.x, 0.0), texture(tDepth, uv + vec2(e.x, 0.0)).r), Sy = unproject(uv + vec2(0.0, e.y), texture(tDepth, uv + vec2(0.0, e.y)).r);
            vec3 nn = cross(Sx - S, Sy - S);
            // a depth edge gives a sliver triangle and a wild normal: fall back to facing the eye there
            hn = dot(nn, nn) > 1e-12 && max(length(Sx - S), length(Sy - S)) < 0.02 + 0.02 * zs ? normalize(nn) : normalize(uEye - S);
            if (dot(hn, uEye - S) < 0.0) hn = -hn;
            hit = true; q = S + hn * uHit.z;
          }
        }
      }
    }
  #endif
    if (hit) {
      fl |= 2;
  #if COLLIDE == 1
      P.w = life;
  #elif COLLIDE == 2
      v = vec3(0.0); fl |= 8;
  #else
      float vn = dot(v, hn);
      if (vn < 0.0) { vec3 vt = v - hn * vn; v = vt * (1.0 - uHit.y) - hn * vn * uHit.x; }
      life -= life * uHit.w;
  #endif
    }
#endif
    p = q;
  }
  float age = P.w + uDt;
  if (age >= life) fl |= 4;
  oP = vec4(p, age); oV = vec4(v, max(life, 1e-4)); oX = vec4(X.xy, float(fl), X.w);
}`;
}
export const SIM_VERTEX = /* glsl */ 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';

const TRI = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
/** run one fullscreen pass of `material` into `target`, leaving the renderer's own state as it was */
export function gpuPass(renderer, material, target) {
  const pass = gpuPass.mesh || (gpuPass.mesh = Object.assign(new THREE.Mesh(TRI), { frustumCulled: false }));
  const scene = gpuPass.scene || (gpuPass.scene = new THREE.Scene().add(pass));
  const rt = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), xr = renderer.xr.enabled, ac = renderer.autoClear;
  renderer.xr.enabled = false; renderer.autoClear = false;     // every texel is written: nothing to clear
  pass.material = material;
  renderer.setRenderTarget(target);
  renderer.render(scene, CAM);
  renderer.setRenderTarget(rt, face, mip);
  renderer.xr.enabled = xr; renderer.autoClear = ac;
}
const stateTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, { count: 3, type: THREE.FloatType, format: THREE.RGBAFormat,
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
const D2R = Math.PI / 180, _m = new THREE.Matrix4(), _v = new THREE.Vector3();

export class ParticlePool {
  /** opts: hz (60), instances (1: capacity is e.capacity × this), parent + sub ({ on, count, rate, inherit }) for a sub-emitter pool, meshes / fields (Maps of
   *  registered emission meshes and vector fields) */
  constructor(renderer, e, opts = {}) {
    this.renderer = renderer; this.e = e; this.hz = opts.hz || 60; this.dt = 1 / this.hz;
    this.parent = opts.parent || null; this.sub = opts.sub || null; this.children = [];
    this.cap = this.parent ? this.parent.cap * this.sub.count : Math.ceil(e.capacity * (opts.instances || 1));
    if (this.cap > 1 << 22) throw new RangeError(`vfx: ${e.name} needs ${this.cap} slots (parent capacity × sub count); the limit is ${1 << 22}`);
    this.W = Math.min(2048, 2 ** Math.ceil(Math.log2(Math.sqrt(this.cap)))); this.H = Math.ceil(this.cap / this.W);
    this.a = stateTarget(this.W, this.H); this.b = stateTarget(this.W, this.H);
    this.maxLife = e.life[1];
    this.lifeSteps = Math.ceil(this.maxLife * this.hz) + 2;
    this.ring = new Int32Array(this.lifeSteps + 1);              // spawns per step; grown by addChild for its life
    this.sources = []; this.free = [];
    this.step = 0; this.lag = 0; this.cursor = 0; this.spawned = 0; this.dropped = 0; this.steps = 0;
    this.radius = effectRadius(e);
    const mesh = e.shape.type === 'mesh' ? opts.meshes && opts.meshes.get(e.shape.mesh) : null;
    if (e.shape.type === 'mesh' && !mesh) throw new Error(`vfx: emitter ${e.name} emits from mesh "${e.shape.mesh}", which is not registered (vfx.registerMesh)`);
    const field = e.field ? opts.fields && opts.fields.get(e.field.name) : null;
    if (e.field && !field) throw new Error(`vfx: emitter ${e.name} uses vector field "${e.field.name}", which is not registered (vfx.registerField)`);
    const s = e.shape, v = e.velocity, c = e.collision, N = MAX_SPAWN_SOURCES;
    const A = { point: [0, 0, 0, 0], sphere: [s.radius, s.shell, 0, 0], box: [...s.size, 0], cone: [s.radius, s.angle * D2R, s.length, 0], ring: [s.radius, s.shell, 0, 0], edge: [...s.a, 0], mesh: [0, 0, 0, 0] }[s.type];
    const B = s.type === 'edge' ? [...s.b, 0] : [0, s.hemisphere ? 1 : 0, 0, 0];
    const dir = new THREE.Vector3(...v.dir); if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0); dir.normalize();
    const U = this.U = {
      tP: { value: null }, tV: { value: null }, tX: { value: null }, uW: { value: this.W }, uCap: { value: this.cap }, uStep: { value: 0 },
      uSeed: { value: e.seed }, uReset: { value: 0 }, uDt: { value: this.dt }, uTime: { value: 0 },
      uSpawnStart: { value: 0 }, uSpawnTotal: { value: 0 }, uSrcEnd: { value: new Int32Array(N) }, uSrcMat: { value: new Float32Array(16 * N) }, uSrcVel: { value: new Float32Array(4 * N) },
      uShapeA: { value: new THREE.Vector4(...A) }, uShapeB: { value: new THREE.Vector4(...B) }, uOffset: { value: new THREE.Vector3(...s.offset) }, uDir: { value: dir },
      uGravity: { value: new THREE.Vector3(...e.gravity) }, uSpeed: { value: new THREE.Vector4(v.speed[0], v.speed[1], Math.cos(v.spread * D2R), v.inherit) },
      uKick: { value: new THREE.Vector4(v.normal[0], v.normal[1], v.random[0], v.random[1]) }, uLifeSize: { value: new THREE.Vector4(e.life[0], e.life[1], e.size[0], e.size[1]) },
      uRotDrag: { value: new THREE.Vector4(e.rotation[0] * D2R, e.rotation[1] * D2R, e.drag, e.wind) },
      uTurb: { value: new THREE.Vector3(e.turbulence.strength, 1 / e.turbulence.scale, e.turbulence.speed) }, uWindV: { value: new THREE.Vector3() },
      tMesh: { value: mesh ? mesh.texture : null }, uMeshN: { value: mesh ? mesh.count : 1 },
    };
    if (e.attractors.length) { U.uAttr = { value: new Float32Array(4 * e.attractors.length) }; U.uAttrB = { value: new Float32Array(e.attractors.flatMap((a) => [a.radius, a.spin])) }; }
    if (field) Object.assign(U, { tField: { value: field }, uFieldMin: { value: new THREE.Vector3(...e.field.min) }, uFieldInv: { value: new THREE.Vector3(...e.field.size.map((x) => 1 / x)) }, uFieldK: { value: e.field.strength } });
    if (c) {
      Object.assign(U, { uHit: { value: new THREE.Vector4(c.bounce, c.friction, c.radius, c.lifeLoss) }, uThick: { value: c.thickness } });
      if (c.planes.length) U.uPlane = { value: new Float32Array(c.planes.flatMap((p) => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return p.map((x) => x / l); })) };
      if (c.ground) Object.assign(U, { tGround: { value: null }, uGroundRect: { value: new THREE.Vector4() }, uGroundOn: { value: 0 } });
      if (c.depth) Object.assign(U, { tDepth: { value: null }, uVP: { value: new THREE.Matrix4() }, uInvVP: { value: new THREE.Matrix4() }, uViewZ: { value: new THREE.Vector4() }, uEye: { value: new THREE.Vector3() }, uDepthOn: { value: 0 } });
    }
    if (this.parent) {
      Object.assign(U, { tPP: { value: null }, tPV: { value: null }, tPX: { value: null }, uPW: { value: this.parent.W }, uK: { value: this.sub.count }, uSubRate: { value: this.sub.rate }, uSubInherit: { value: this.sub.inherit } });
      this.parent.children.push(this);
      // the parent's spawn history must reach back over its own life plus this child's: a child can outlive it
      const need = this.parent.lifeSteps + this.lifeSteps + 2;
      if (this.parent.ring.length < need) { const r = new Int32Array(need); r.set(this.parent.ring); this.parent.ring = r; }
    }
    this.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SIM_VERTEX, fragmentShader: simFragment(e, this.sub), uniforms: U,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.reset();
  }
  get state() { return this.a; }
  /** clear every slot and rewind to step 0 (live instances stay and emit again from their start step) */
  reset(step = 0) {
    this.U.uReset.value = 1; gpuPass(this.renderer, this.material, this.a); gpuPass(this.renderer, this.material, this.b); this.U.uReset.value = 0;
    this.step = step; this.cursor = 0; this.ring.fill(0);
    for (const s of this.sources) s.acc = 0;
    for (const c of this.children) c.reset(step);
  }
  /** a live instance of the effect. opts: matrix (Matrix4) or position / quaternion / scale, velocity (Vector3,
   *  inherited by velocity.inherit), rate (multiplier), start (absolute step, default now). Reuses a retired record. */
  addSource(opts = {}) {
    const s = this.free.pop() || { matrix: new THREE.Matrix4(), velocity: new THREE.Vector3(), position: new THREE.Vector3() };
    s.live = s.emitting = true; s.acc = 0; s.start = opts.start === undefined ? this.step : opts.start; s.stopAt = -1; s.rate = opts.rate === undefined ? 1 : opts.rate;
    s.lod = 1; s.scale = 1; s.done = false; s.onDone = opts.onDone || null;      // field by field: a reused record, no garbage per burst
    s.velocity.set(0, 0, 0); if (opts.velocity) s.velocity.copy(opts.velocity);
    s.position.set(0, 0, 0); (s.quaternion ||= new THREE.Quaternion()).identity();
    setSourceTransform(s, opts);
    this.sources.push(s);
    return s;
  }
  /** spawn count of source s in the step that starts at step index `n` (bursts are stateless: a function of time) */
  _emit(s, n) {
    const e = this.e, dt = this.dt, t = (n - s.start) * dt - e.delay;
    if (!s.emitting || t < -1e-9 || (s.stopAt >= 0 && n >= s.stopAt)) return 0;
    const on = e.loop || t < e.duration - 1e-9;
    if (on) s.acc += e.rate * dt * s.rate * s.lod;
    const span = e.loop && e.duration > 0 ? e.duration : 0, tm = span ? t % span : t;
    if (e.loop || t < Math.max(e.duration, dt)) {
      for (const b of e.bursts) {
        let k = 0;
        if (b.every > 0) k = Math.max(0, Math.floor((tm + dt - b.time) / b.every + 1e-9) + 1) - Math.max(0, Math.floor((tm - b.time) / b.every + 1e-9) + 1);
        else if (b.time >= tm - 1e-9 && b.time < tm + dt - 1e-9) k = 1;
        else if (span && tm + dt > span && b.time < tm + dt - span - 1e-9) k = 1;       // the loop wrapped inside this step
        s.acc += k * b.count * s.rate * s.lod;                 // LOD and the global budget thin bursts as they thin the rate
      }
    }
    const c = Math.floor(s.acc + 1e-6); s.acc -= c;
    return c;
  }
  _step(env) {
    const U = this.U, r = this.ring, n = this.step;
    let total = 0;
    if (!this.parent) {
      const ends = U.uSrcEnd.value, mats = U.uSrcMat.value, vels = U.uSrcVel.value; let k = 0;
      for (let i = 0; i < this.sources.length; i++) {
        const s = this.sources[i];
        let c = this._emit(s, n);
        if (c > 0 && k >= MAX_SPAWN_SOURCES) s.acc += c;           // more instances spawning in one step than the shader has slots: theirs wait a step
        else if (c > 0) {
          if (total + c > this.cap) { this.dropped += total + c - this.cap; c = this.cap - total; }
          if (c > 0) { total += c; ends[k] = total; s.matrix.toArray(mats, 16 * k); vels[4 * k] = s.velocity.x; vels[4 * k + 1] = s.velocity.y; vels[4 * k + 2] = s.velocity.z; vels[4 * k + 3] = s.scale; k++; }
        }
        // retired once it can emit nothing more and its last particle (and that particle's children) is gone
        const t = (n - s.start) * this.dt - this.e.delay, end = s.stopAt >= 0 ? (s.stopAt - s.start) * this.dt - this.e.delay : this.e.loop ? Infinity : Math.max(this.e.duration, this.dt);
        if (t > end + this.maxLife + this.childLife() + 2 * this.dt) { s.live = false; s.done = true; this.sources.splice(i--, 1); this.free.push(s); if (s.onDone) s.onDone(s); }
      }
      for (; k < MAX_SPAWN_SOURCES; k++) ends[k] = 0x7fffffff;
      U.uSpawnStart.value = this.cursor; U.uSpawnTotal.value = total;
      const last = this.sources[this.sources.length - 1];
      if (U.uAttr) this.e.attractors.forEach((a, i) => { _v.set(...a.position); if (last) _v.applyMatrix4(last.matrix); _v.toArray(U.uAttr.value, 4 * i); U.uAttr.value[4 * i + 3] = a.strength; });
    } else {
      const p = this.parent.a.textures; U.tPP.value = p[0]; U.tPV.value = p[1]; U.tPX.value = p[2];
    }
    if (env) {
      if (env.wind) U.uWindV.value.copy(env.wind);
      if (U.tGround) { U.uGroundOn.value = env.ground ? 1 : 0; if (env.ground) { U.tGround.value = env.ground.texture; U.uGroundRect.value.copy(env.ground.rect); } }
      if (U.tDepth) { const d = env.depth; U.uDepthOn.value = d && d.ready ? 1 : 0; if (d && d.ready) { U.tDepth.value = d.texture; U.uVP.value.copy(d.vp); U.uInvVP.value.copy(d.invVp); U.uViewZ.value.copy(d.viewZ); U.uEye.value.copy(d.eye); } }
    }
    const t = this.a.textures; U.tP.value = t[0]; U.tV.value = t[1]; U.tX.value = t[2];
    U.uStep.value = n; U.uTime.value = n * this.dt;
    gpuPass(this.renderer, this.material, this.b);
    const sw = this.a; this.a = this.b; this.b = sw;
    r[n % r.length] = total; this.cursor = (this.cursor + total) % this.cap; this.spawned += total; this.step = n + 1; this.steps++;
    if (total > 0 && !this.parent) {
      // the ring wrapped onto slots young enough to be alive: those particles are cut short, and counted as dropped
      let c = 0; for (let i = 1, m = Math.min(this.lifeSteps, r.length, this.step); i <= m; i++) c += r[(this.step - i) % r.length];
      if (c > this.cap) this.dropped += Math.min(total, c - this.cap);
    }
    if (this.onStep) this.onStep(this);                          // trails record their history here (vfx-extras.js)
    for (const c of this.children) c._step(env);
  }
  childLife() { let m = 0; for (const c of this.children) m = Math.max(m, c.maxLife); return m; }
  /** run fixed steps up to absolute step `n`; a jump backwards, or forwards by more than `catchUp` steps, restarts
   *  the pool `catchUp` steps before `n` so the result is still a function of `n` alone */
  advanceTo(n, env, catchUp = 600) {
    if (this.parent) return 0;
    if (n < this.step && this.step - n <= 4) return 0;          // a frame's sub-frames can start a step or two behind the last frame's end: wait
    if (n < this.step || n - this.step > catchUp) this.reset(Math.max(0, n - catchUp));
    const from = this.step;
    while (this.step < n) this._step(env);
    return this.step - from;
  }
  /** slots that can hold a live particle: `count` slots starting at `base` (mod cap), oldest first */
  window(steps = this.lifeSteps) {
    const p = this.parent;
    if (p) { const w = p.window(p.lifeSteps + this.lifeSteps); return { base: w.base * this.sub.count, count: w.count * this.sub.count }; }
    const r = this.ring; let c = 0;
    for (let i = 1, m = Math.min(steps, r.length, this.step); i <= m; i++) c += r[(this.step - i) % r.length];
    c = Math.min(c, this.cap);
    return { base: (this.cursor - c + this.cap) % this.cap, count: c };
  }
  /** read the state back (slow: a GPU sync). Returns { P, V, X } Float32Arrays of W×H×4 */
  read() {
    const out = {}, n = this.W * this.H * 4;
    ['P', 'V', 'X'].forEach((k, i) => { out[k] = new Float32Array(n); this.renderer.readRenderTargetPixels(this.a, 0, 0, this.W, this.H, out[k], undefined, i); });
    return out;
  }
  /** exact number of live particles (slow: reads the state back) */
  countAlive() { const { P, V } = this.read(); let c = 0; for (let i = 0; i < this.cap; i++) if (V[4 * i + 3] > 0 && P[4 * i + 3] < V[4 * i + 3]) c++; return c; }
  dispose() { this.a.dispose(); this.b.dispose(); this.material.dispose(); for (const c of this.children) c.dispose(); }
}
/** write a source's transform from opts: matrix, or position / quaternion / scale (uniform); absent parts keep */
export function setSourceTransform(s, opts) {
  if (opts.matrix) { s.matrix.copy(opts.matrix); s.position.setFromMatrixPosition(s.matrix); s.scale = _v.setFromMatrixColumn(s.matrix, 0).length(); return s; }
  if (opts.position) s.position.copy(opts.position);
  if (opts.quaternion) s.quaternion.copy(opts.quaternion);
  if (opts.scale !== undefined) s.scale = opts.scale;
  s.matrix.compose(s.position, s.quaternion, _v.set(s.scale, s.scale, s.scale));
  return s;
}

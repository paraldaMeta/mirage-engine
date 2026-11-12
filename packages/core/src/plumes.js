// Mirage original code. The technique (a plume's density field sampled on view-aligned slices through its box, lit by
// single scattering with a Henyey-Greenstein phase and a sun visibility measured on the CPU) follows the owner's Nizwa
// project (src/world/props-smoke.js), re-implemented as one instanced draw for many plumes.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';

// ---------------------------------------------------------------------------
// Lit steam and thin smoke (opt-in: nothing changes until you call createPlumes). One draw for every plume: each is
// an instance of `slices` camera-facing quads through its box, blended back to front; plumes are sorted far to near
// and only the nearest `budget` within `far` metres are drawn, fading out toward `far`.
//
//   const P = createPlumes(world, { budget: 8, slices: 16, far: 40 });
//   const id = P.add({ pos: [x, y, z], height: 2.4, radius: 0.5, density: 1, lean: [0.4, 0.1] });
//   P.set(id, { sun: [1, 0.6, 0.2], lamp: { pos, color: [r, g, b], power, range } });   // its light, when it changes
//   P.remove(id)        each frame: P.update(camera)
//
// Light, per sample: the key light (sun or moon: G.uKeyDir / uKeyColor) x a Henyey-Greenstein phase (forward and side
// lobes) x the plume's sun visibility at its foot, middle and top (`sun`, measured by the caller: a ray toward the
// sun), the lamp by it (position, colour x power x the world's lamp gain, inverse square inside `range`, a
// forward-leaning phase) and the ambient (`ambient`, linear RGB, live: the sky's / city's fill). The density: a
// column that widens and thins as it rises, bent by `lean` (m at the top, the wind), torn by warped, ridged noise
// advected upward on uTime only (stills are stable).
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute vec3 aSl;              // quad corner x, y (-1..1), slice index
attribute vec4 iSrc;             // foot x, y, z; height
attribute vec4 iShape;           // radius at the top, density, seed, fade (0..1)
attribute vec4 iLean;            // lean x, z (m at the top), rise speed (m/s), -
uniform float uN;
varying vec3 vW;
varying vec3 vDir;
varying float vSp;
varying vec4 vSrc; varying vec4 vShape; varying vec4 vLean;
varying float vI;
void main(){
  vec3 c = iSrc.xyz + vec3(iLean.x * 0.5, iSrc.w * 0.5, iLean.y * 0.5);
  vec3 h = vec3(iShape.x * 1.3 + abs(iLean.x) * 0.5, iSrc.w * 0.5, iShape.x * 1.3 + abs(iLean.y) * 0.5);
  vec3 dir = normalize(c - cameraPosition);
  vec3 up0 = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(dir, up0)), up = cross(right, dir);
  float ez = dot(abs(dir), h), ex = dot(abs(right), h), ey = dot(abs(up), h);
  float sp = 2.0 * ez / uN;
  vec3 wp = c + dir * (ez - (aSl.z + 0.5) * sp) + right * aSl.x * ex + up * aSl.y * ey;   // slice 0 the farthest
  vW = wp; vDir = dir; vSp = sp; vSrc = iSrc; vShape = iShape; vLean = iLean; vI = float(gl_InstanceID);
  gl_Position = iShape.w > 0.0 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime, uLampGain;
uniform vec3 uKeyDir, uKeyColor, uAmbient;
uniform vec4 uLight[48];         // per plume: sun visibility (foot, middle, top), -; the lamp's pos, range; its colour x power
varying vec3 vW;
varying vec3 vDir;
varying float vSp;
varying vec4 vSrc; varying vec4 vShape; varying vec4 vLean;
varying float vI;
${NOISE_GLSL}
float plDensity(vec3 w, out float h){
  vec3 p = w - vSrc.xyz;
  h = p.y / vSrc.w;
  if (h <= 0.0 || h >= 1.0) return 0.0;
  float t = uTime + vShape.z * 37.0;
  // the centre line: bent by the lean (the wind, growing with the square of the height), a slow meander
  vec2 cl = vLean.xy * h * h + 0.06 * h * vec2(sin(p.y * 2.3 - t * 0.9 + vShape.z * 6.0), cos(p.y * 1.9 - t * 0.7 + vShape.z * 4.0));
  vec2 q = p.xz - cl;
  float r = mix(0.35, 1.0, pow(h, 0.7)) * vShape.x;
  float r2 = dot(q, q) / (r * r);
  if (r2 > 2.5) return 0.0;
  // rising structure: advected up, warped, torn into ridged sheets as it rises
  vec3 np = vec3(q.x, p.y - t * vLean.z, q.y) / max(vShape.x, 0.05);
  vec3 wq = np * 1.6 + vShape.z * 13.0;
  vec3 warp = vec3(mgGrad3(wq), mgGrad3(wq + vec3(7.1, 0.0, 3.3)), mgGrad3(wq + vec3(0.0, 3.7, 11.0)));
  float ridge = 1.0 - abs(mgGrad3(np * 3.0 + warp * (0.4 + 1.2 * h)));
  float soft = mgGrad3(np * 1.2 + warp * 0.5) * 0.5 + 0.5;
  float body = mix(0.6 + 0.6 * soft, ridge * ridge * ridge * 2.2 + soft * soft * 0.2, smoothstep(0.03, 0.35, h));
  float d = exp(-r2 * 1.4) * body;
  d *= smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.35, 1.0, h)) * mix(1.6, 0.5, h);
  return d;
}
float plHG(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
void main(){
  float h;
  float d = plDensity(vW, h);
  if (d < 1e-3) discard;
  vec3 V = normalize(vW - cameraPosition);
  float a = (1.0 - exp(-d * vShape.y * 5.0 * vSp / max(dot(V, vDir), 0.3))) * vShape.w;
  int k = int(vI + 0.5) * 3;
  vec4 S = uLight[k];
  float vis = h < 0.5 ? mix(S.x, S.y, h * 2.0) : mix(S.y, S.z, h * 2.0 - 1.0);
  float mu = dot(V, normalize(uKeyDir));
  vec3 L = uKeyColor * (0.65 * plHG(mu, 0.7) + 0.35 * plHG(mu, 0.0)) * vis * 2.0 + uAmbient;
  // the lamp by it: inverse square, eased out at its range, a forward-leaning phase
  vec4 P = uLight[k + 1], C = uLight[k + 2];
  vec3 dl = P.xyz - vW; float dd = dot(dl, dl);
  if (P.w > 0.0 && dd < P.w * P.w) L += C.rgb * uLampGain * (1.0 - smoothstep(0.5, 1.0, sqrt(dd) / P.w)) / max(dd, 0.25) * (0.6 * plHG(dot(V, -normalize(dl)), 0.45) + 0.4 / 12.566) * 4.0;
  gl_FragColor = vec4(L * vec3(0.93, 0.95, 0.98) * a, a);
}`;

/** Lit volumetric plumes, one instanced draw (see the head of plumes.js). options: budget (plumes drawn, the nearest; 8),
 *  slices (per plume, 16), far (m: none beyond, fading over its last quarter; 40), ambient (linear RGB, live, [0.02, 0.022, 0.026]). */
export function createPlumes(world, { budget = 8, slices = 16, far = 40, ambient = [0.02, 0.022, 0.026] } = {}) {
  const MAX = 16;
  budget = Math.max(0, Math.min(MAX, budget | 0));
  const geo = new THREE.InstancedBufferGeometry(), P = [], A = [], I = [];
  for (let k = 0; k < slices; k++) {
    const b = k * 4;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(0, 0, 0); A.push(x, y, k); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aSl', new THREE.Float32BufferAttribute(A, 3));
  geo.setIndex(I);
  const iSrc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4), iShape = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4), iLean = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  for (const a of [iSrc, iShape, iLean]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iSrc', iSrc); geo.setAttribute('iShape', iShape); geo.setAttribute('iLean', iLean);
  geo.instanceCount = 0;
  const G = world.G;
  const uniforms = { uN: { value: slices }, uTime: G.uTime, uLampGain: G.uLampGain, uKeyDir: G.uKeyDir, uKeyColor: G.uKeyColor, uAmbient: { value: new THREE.Vector3(...ambient) },
    uLight: { value: Array.from({ length: MAX * 3 }, () => new THREE.Vector4()) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  mat.name = 'mg-plumes';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mg-plumes'; mesh.frustumCulled = false; mesh.renderOrder = 20; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.collide = false; mesh.userData.mgNoCapture = true;
  const list = new Map();
  let next = 1;
  const api = {
    mesh, uniforms,
    /** a plume: pos (its foot), height (2), radius (at the top, 0.5), density (1), lean ([x, z] m at the top), rise (m/s, 0.6),
     *  seed, sun ([foot, middle, top] visibility, [1, 1, 1]), lamp ({ pos, color, power, range } or null). Returns its id. */
    add(o) { const id = next++; list.set(id, { pos: [0, 0, 0], height: 2, radius: 0.5, density: 1, lean: [0, 0], rise: 0.6, seed: (id * 0.618) % 1, sun: [1, 1, 1], lamp: null, strength: 1, ...o }); return id; },
    /** change a plume (any field of add, plus strength 0..1: a fade the caller drives) */
    set(id, o) { const p = list.get(id); if (p) Object.assign(p, o); },
    get: (id) => list.get(id),
    remove(id) { list.delete(id); },
    get count() { return list.size; },
    /** the plumes near `camera`, sorted far to near, into the instance buffers (call once a frame) */
    update(camera) {
      const c = camera.position, near = [];
      for (const p of list.values()) { const d = Math.hypot(p.pos[0] - c.x, p.pos[1] + p.height * 0.5 - c.y, p.pos[2] - c.z); if (d < far && p.strength > 0) near.push([d, p]); }
      near.sort((a, b) => a[0] - b[0]);
      const draw = near.slice(0, budget).reverse();
      draw.forEach(([d, p], i) => {
        iSrc.setXYZW(i, p.pos[0], p.pos[1], p.pos[2], p.height);
        iShape.setXYZW(i, p.radius, p.density, p.seed, p.strength * (1 - THREE.MathUtils.smoothstep(d, far * 0.75, far)));
        iLean.setXYZW(i, p.lean[0], p.lean[1], p.rise, 0);
        const U = uniforms.uLight.value, l = p.lamp;
        U[i * 3].set(p.sun[0], p.sun[1], p.sun[2], 0);
        if (l) { U[i * 3 + 1].set(l.pos[0], l.pos[1], l.pos[2], l.range); U[i * 3 + 2].set(l.color[0] * l.power, l.color[1] * l.power, l.color[2] * l.power, 0); } else U[i * 3 + 1].set(0, 0, 0, 0);
      });
      geo.instanceCount = draw.length;
      iSrc.needsUpdate = iShape.needsUpdate = iLean.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); mesh.removeFromParent(); },
  };
  return api;
}

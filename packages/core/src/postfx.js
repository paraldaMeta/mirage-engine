// Mirage original code.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Opt-in passes of the frame pipeline (post.js owns the frame; this file owns everything that is off by default).
// Nothing here runs, compiles or allocates until a setting below is non-zero, so a frame with all of them at their
// defaults is the frame post.js always made.
//
//   createWorld(canvas, { post: { taa2: 1, upscale: 0.67, motionBlur: 0.5, bokeh: 1, dof: 0.02, bloomPyramid: 1 } })
//   world.post.lut = lutTexture(parseCube(text));          // a .cube file -> Data3DTexture
//   Object.assign(world.post, postFromQuery(new URLSearchParams(location.search)));   // ?taa2=1&upscale=0.67...
//
// per moving frame (one sub-frame, renderFrame({ taa })):
//   scene -> velocity (camera motion from depth, then moving / skinned objects drawn over it)
//         -> taa2: reproject by velocity, clip in YCoCg, write a full-size frame (the temporal upscaler when the
//            scene was rendered smaller: post.upscale, or dynamic resolution)
//         -> bokeh (lens blur from depth) -> motionBlur (along velocity) -> rcas -> godrays -> bloomPyramid -> lensDirt
//         -> streak -> flare -> grade (+ lut, chroma)
// Stills (spp > 1) never use the temporal passes: they integrate lens and shutter by accumulation and stay
// bit-identical run to run; godrays, bloomPyramid, lensDirt, streak, flare, lut and chroma apply to both.
// ---------------------------------------------------------------------------

/** Defaults of the opt-in passes (spread into DEFAULT_POST). 0 / null = off. */
export const FX_DEFAULTS = {
  taa2: 0,           // 1: velocity-buffer temporal AA (YCoCg variance clip, disocclusion test) instead of the depth-only one
  upscale: 0,        // 0.5..1: render the scene at this scale and reconstruct the output size in taa2 (0 = off)
  motionBlur: 0,     // shutter fraction 0..1 (0.5 = a 180 degree shutter): blur along the velocity buffer, moving frames
  motionBlurMax: 32, // longest blur, px at 1080p (scaled with the output height)
  bokeh: 0,          // 1: lens blur on moving frames from `dof` (lens radius, m) and `focus` (m); stills accumulate instead
  bokehMax: 16,      // largest circle of confusion (radius), px at 1080p
  bloomPyramid: 0,   // 1: bloom as a 6-level down / up-sample pyramid mixed in by `bloom` (replaces three's bloom pass)
  lut: null,         // a THREE.Data3DTexture (lutTexture()): display-referred colour lookup after the tone map
  lutStrength: 1,
  chroma: 0,         // chromatic aberration: the red / blue shift at the frame corner, in % of the frame's half diagonal
  rcas: 0,           // 0..1: contrast-adaptive sharpening of moving frames after the temporal resolve / upscaler (0 = off)
  godrays: 0,        // screen-space light shafts from the sun (the bright sky round it blurred toward it), strength; 0 = off
  godraysDecay: 0.965,   // fall-off per tap of the radial blur (24 taps a pass, 3 passes)
  godraysThreshold: 0.3, // sky dimmer than this x the sun's (key light's) luminance casts weaker shafts (clouds, the sky away from the sun)
  godraysVol: 0.35,  // weight of the god rays while light2's volumetric light marches the sun's own shafts (0 = leave them to it)
  flare: 0,          // the sun's lens flare (veiling glare, ghosts, halo), tested against the depth buffer, strength; 0 = off
  lensDirt: 0,       // 0..1: a dirty lens: a procedural smudge mask lit by a wide glow of the frame's bright light, added after the bloom; 0 = off
  lensDirtThreshold: 1,  // exposed luminance (after exposure and auto exposure, before the tone map) above which light lights the dirt
  streak: 0,         // 0..1: anamorphic streaks, bright pixels smeared horizontally and tinted, added before the grade; 0 = off
  streakThreshold: 3,    // exposed luminance (after exposure and auto exposure, before the tone map) above which a pixel streaks
  streakLength: 1,   // the streak's reach: 1 = about a third of the frame width each way
  streakTint: [0.5, 0.7, 1.0],   // linear RGB multiplier of the streak (a cool blue, as an anamorphic lens's coating gives)
};

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quadMat = (fs, uniforms, extra) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
// the render-size corner of a full-size target (post.js, SUB)
const SUB = /* glsl */ `
uniform vec4 uSub, uSubH;
vec4 texS(sampler2D t, vec2 uv){ return texture2D(t, min(uv * uSub.xy, uSub.zw)); }
vec4 texH(sampler2D t, vec2 uv){ return texture2D(t, min(uv * uSubH.xy, uSubH.zw)); }`;
const SQUASH = /* glsl */ `
vec3 squash(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 unsquash(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec3 toY(vec3 c){ return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromY(vec3 c){ return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }`;
const IGN = 'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';
// the grade's exposure (uExp) times the adapted auto exposure when it is on (post.js end(): the EV in tAE)
const EXPO = /* glsl */ `
uniform sampler2D tAE; uniform float uUseAE, uExp;
float expo(){ return uExp * (uUseAE > 0.5 ? exp2(texture2D(tAE, vec2(0.5)).r) : 1.0); }`;

/** Halton sequence, base b, index i >= 1. */
export function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

/** Lens radius (m) of a real lens: focal length in mm at f-stop N -> f / (2N). `post.dof` takes this. */
export const apertureRadius = (focalMm, fStop) => focalMm / 1000 / (2 * fStop);

/** Parse an Adobe / Resolve .cube 3D LUT. Returns { size, data: Float32Array(size^3 * 3) } (red fastest). */
export function parseCube(text) {
  let size = 0; const v = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(t);
    if (m) { size = +m[1]; continue; }
    if (/^[A-Za-z_]/.test(t)) { if (/^LUT_1D_SIZE/i.test(t)) throw new Error('parseCube: 1D LUTs are not supported'); continue; }
    const p = t.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) v.push(p[0], p[1], p[2]);
  }
  if (size < 2 || v.length !== size * size * size * 3) throw new Error(`parseCube: expected ${size}^3 rows, got ${v.length / 3}`);
  return { size, data: new Float32Array(v) };
}

/** A colour lookup as plain data: fn([r, g, b] in 0..1 display space) -> [r, g, b]. Same layout as parseCube(). */
export function makeLut(fn, size = 16) {
  const data = new Float32Array(size ** 3 * 3); let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
    data[i++] = o[0]; data[i++] = o[1]; data[i++] = o[2];
  }
  return { size, data };
}

/** { size, data } (parseCube / makeLut) -> a Data3DTexture for `post.lut` (half float, trilinear). */
export function lutTexture({ size, data }) {
  const px = new Uint16Array(size ** 3 * 4);
  for (let i = 0, n = size ** 3; i < n; i++) {
    for (let c = 0; c < 3; c++) px[4 * i + c] = THREE.DataUtils.toHalfFloat(Math.min(Math.max(data[3 * i + c], 0), 4));
    px[4 * i + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.Data3DTexture(px, size, size, size);
  t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

/** URL flags -> post settings (only the keys present): ?taa2=1&upscale=0.67&mb=0.5&bokeh=1&lens=0.03&focus=6&bloom=0.15
 *  &bloom2=1&chroma=0.6&lut=warm|cool|bleach&godrays=0.5&flare=1&dirt=0.6&streak=0.5&streakthr=3&streaklen=1.
 *  Q: a URLSearchParams. */
export function postFromQuery(Q) {
  const o = {}, num = (k, to = k) => { if (Q.has(k) && Number.isFinite(+Q.get(k))) o[to] = +Q.get(k); };
  num('taa2'); num('upscale'); num('mb', 'motionBlur'); num('bokeh'); num('lens', 'dof'); num('focus'); num('bloom'); num('bloom2', 'bloomPyramid'); num('chroma');
  num('godrays'); num('flare'); num('dirt', 'lensDirt'); num('streak'); num('streakthr', 'streakThreshold'); num('streaklen', 'streakLength');
  num('ssr', 'ssr2'); num('ssrrough', 'ssrRough'); num('ssgi'); num('girange', 'ssgiRange'); num('girays', 'ssgiRays'); num('contact'); num('rcas');   // screen.js (lighting.screen)
  const L = { warm: ([r, g, b]) => [r ** 0.92, g, b ** 1.12], cool: ([r, g, b]) => [r ** 1.1, g, b ** 0.9],
    bleach: ([r, g, b]) => { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, s = (x) => { const m = l + (x - l) * 0.55; return m * m * (3 - 2 * m); }; return [s(r), s(g), s(b)]; } }[Q.get('lut')];
  if (L) o.lut = lutTexture(makeLut(L));
  return o;
}

/** The lens-dirt mask (post.lensDirt) as plain data: one byte per texel, row 0 at the bottom, made in code from a
 *  seed (no image file): a faint mottle, soft blotches (some with the brighter rim of a dried drop), a few wiped
 *  streaks and specks of dust. Same seed, same bytes. */
export function lensDirtMask({ width = 512, height = 256, seed = 7 } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f = new Float32Array(width * height), H = height;
  // a faint mottle: four octaves of value noise on a coarse lattice
  for (let o = 0, cell = H / 3, amp = 0.05; o < 4; o++, cell /= 2, amp *= 0.6) {
    const gw = Math.ceil(width / cell) + 2, gh = Math.ceil(height / cell) + 2, g = Float32Array.from({ length: gw * gh }, rnd);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / cell, v = y / cell, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b);
      const n = (g[j * gw + i] * (1 - sa) + g[j * gw + i + 1] * sa) * (1 - sb) + (g[(j + 1) * gw + i] * (1 - sa) + g[(j + 1) * gw + i + 1] * sa) * sb;
      f[y * width + x] += amp * n;
    }
  }
  const stamp = (cx, cy, r, fn) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(height - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(width - 1, Math.ceil(cx + r)); x++) {
        const v = fn(x - cx, y - cy);
        if (v > 0) f[y * width + x] += v;
      }
  };
  // soft blotches: a Gaussian smudge, a fifth of them a dried drop (a ring brighter than its middle); squashed a little
  for (let i = 0; i < 34; i++) {
    const cx = rnd() * width, cy = rnd() * height, r = H * (0.03 + 0.16 * rnd() ** 2), k = 0.15 + 0.45 * rnd(), ring = rnd() < 0.2;
    const sq = 0.75 + 0.5 * rnd(), th = rnd() * Math.PI, c = Math.cos(th), sn = Math.sin(th);
    stamp(cx, cy, r * 1.4, (dx, dy) => {
      const u = (dx * c + dy * sn) / sq, v = (-dx * sn + dy * c) * sq, d = Math.sqrt(u * u + v * v) / r;
      return k * (ring ? 0.5 * Math.exp(-3 * d * d) + Math.exp(-((d - 0.8) ** 2) / 0.04) * 0.4 : Math.exp(-2.5 * d * d));
    });
  }
  // wiped streaks: a soft line, fading in and out along its length
  for (let i = 0; i < 6; i++) {
    const len = H * (0.3 + 0.7 * rnd()), wid = H * (0.006 + 0.014 * rnd()), k = 0.12 + 0.2 * rnd(), th = rnd() * Math.PI;
    const ax = Math.cos(th), ay = Math.sin(th), cx = rnd() * width, cy = rnd() * height;
    stamp(cx, cy, len / 2 + 3 * wid, (dx, dy) => {
      const t = dx * ax + dy * ay, n = -dx * ay + dy * ax;
      if (Math.abs(t) > len / 2) return 0;
      return k * Math.sin(Math.PI * (t / len + 0.5)) * Math.exp(-(n * n) / (2 * wid * wid));
    });
  }
  // specks of dust
  for (let i = 0; i < 140; i++) {
    const cx = rnd() * width, cy = rnd() * height, r = 0.6 + 1.6 * rnd() ** 2, k = 0.35 + 0.65 * rnd();
    stamp(cx, cy, r * 2.5, (dx, dy) => k * Math.exp(-(dx * dx + dy * dy) / (r * r)));
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(255 * Math.min(1, f[i]));
  return out;
}

// velocity of whatever moves on its own: the vertex is placed where the scene drew it (jittered projection) and
// carries its clip position now and one frame ago (both unjittered). There is no depth buffer to test against, so
// the fragment keeps itself only where the scene's depth is its own (cut-outs and occluders stay untouched).
const VEL_VS = /* glsl */ `
uniform mat4 uPrevModel, uCurVP, uPrevVP; varying vec4 vC, vP;
#include <skinning_pars_vertex>
#ifdef USE_SKINNING
uniform highp sampler2D tPrevBones;
mat4 prevBone(float i){
  int size = textureSize(tPrevBones, 0).x, j = int(i) * 4, x = j % size, y = j / size;
  return mat4(texelFetch(tPrevBones, ivec2(x, y), 0), texelFetch(tPrevBones, ivec2(x + 1, y), 0), texelFetch(tPrevBones, ivec2(x + 2, y), 0), texelFetch(tPrevBones, ivec2(x + 3, y), 0));
}
#endif
void main(){
  vec3 transformed = position; vec4 wp = vec4(position, 1.0);
  #ifdef USE_SKINNING
    #include <skinbase_vertex>
    #include <skinning_vertex>
    vec4 sv = bindMatrix * vec4(position, 1.0);
    wp = bindMatrixInverse * (prevBone(skinIndex.x) * sv * skinWeight.x + prevBone(skinIndex.y) * sv * skinWeight.y + prevBone(skinIndex.z) * sv * skinWeight.z + prevBone(skinIndex.w) * sv * skinWeight.w);
  #endif
  vec4 wc = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wc = instanceMatrix * wc; wp = instanceMatrix * wp;
  #endif
  wc = modelMatrix * wc; wp = uPrevModel * wp;
  vC = uCurVP * wc; vP = uPrevVP * wp;
  gl_Position = projectionMatrix * viewMatrix * wc;
}`;
const VEL_FS = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uMax; uniform vec3 uNF; varying vec4 vC, vP;
float lin(float d){ return uNF.z > 0.5 ? uNF.x + d * (uNF.y - uNF.x) : uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
void main(){
  float a = lin(gl_FragCoord.z), b = lin(texture2D(tDepth, gl_FragCoord.xy / uMax).x);
  if (abs(a - b) > 0.02 + 0.01 * a) discard;
  gl_FragColor = vec4((vP.xy / vP.w - vC.xy / vC.w) * 0.5, vP.w, vC.w);
}`;

export class PostFX {
  /** pp: the Pipeline (post.js creates this on first use: pipeline.fx). */
  constructor(pp) {
    this.pp = pp; this.r = pp.r; this.rts = {}; this.mats = {};
    this.jit = [0, 0]; this.ji = 0; this.valid = false; this.frame = 0;
    this.curVP = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4(); this.lastVP = new THREE.Matrix4(); this.invVP = new THREE.Matrix4(); this.pm = new THREE.Matrix4();
    this.objs = new WeakMap(); this.bones = new WeakMap(); this.pscene = new THREE.Scene(); this.pscene.matrixWorldAutoUpdate = false;
  }

  // a lazily made target, remade when its size changes (the output size: never per render scale)
  rt(name, w, h, o = {}) {
    let t = this.rts[name];
    if (t && (t.width !== w || t.height !== h)) { t.dispose(); t = null; }
    if (!t) t = this.rts[name] = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, ...o });
    return t;
  }
  mat(name, make) { return this.mats[name] || (this.mats[name] = make()); }
  // a full-size target used at the render size: the same corner as the scene target (post.js, _fit)
  corner(t, half) {
    const pp = this.pp, on = pp.rw !== pp.w || pp.rh !== pp.h, w = half ? pp.hw : pp.rw, h = half ? pp.hh : pp.rh;
    t.viewport.set(0, 0, w, h); t.scissor.set(0, 0, w, h); t.scissorTest = on;
    return t;
  }
  fit() { this.valid = this.valid && this.pp.w === this._w && this.pp.h === this._h; this._w = this.pp.w; this._h = this.pp.h; }
  /** Forget the history (a cut, a teleport, a resize). */
  reset() { this.valid = false; this.hist = {}; }

  /** The next sub-pixel offset of the projection, in render pixels (-0.5..0.5): Halton(2, 3), a longer sequence
   *  the smaller the scene is rendered (every output pixel needs its own samples). */
  jitter() {
    const s = this.pp.rw / this.pp.w, n = Math.min(64, Math.max(8, Math.round(8 / (s * s))));
    this.ji = (this.ji % n) + 1;
    return (this.jit = [halton(this.ji, 2) - 0.5, halton(this.ji, 3) - 0.5]);
  }

  /** The velocity buffer of the sub-frame just rendered: rg = where this pixel was one frame ago minus where it is
   *  (uv), b = its clip w then, a = its clip w now. Camera motion from depth, moving objects drawn over it. */
  velocity(scene, camera) {
    const pp = this.pp, ortho = !!camera.isOrthographicCamera;
    const v = this.corner(this.rt('vel', pp.w, pp.h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    const e = this.pm.copy(camera.projectionMatrix).elements, o = ortho ? 12 : 8;
    e[o] -= (2 * this.jit[0]) / pp.rw; e[o + 1] -= (2 * this.jit[1]) / pp.rh;   // the projection without its jitter
    if (this.valid) this.prevVP.copy(this.lastVP);
    this.curVP.multiplyMatrices(this.pm, camera.matrixWorldInverse);
    if (!this.valid) this.prevVP.copy(this.curVP);
    this.lastVP.copy(this.curVP);
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    const m = this.mat('velCam', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tDepth; uniform mat4 uInvVP, uCurVP, uPrevVP;
      ${SUB}
      void main(){
        vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, texS(tDepth, vUv).x * 2.0 - 1.0, 1.0); w /= w.w;
        vec4 c = uCurVP * w, p = uPrevVP * w;
        gl_FragColor = vec4((p.xy / p.w - c.xy / c.w) * 0.5, p.w, c.w);
      }`, { tDepth: { value: null }, uInvVP: { value: this.invVP }, uCurVP: { value: this.curVP }, uPrevVP: { value: this.prevVP }, ...pp.sub }));
    m.uniforms.tDepth.value = pp.sceneRT.depthTexture;
    pp._draw(m, v);
    this._objects(scene, camera, v, ortho);
    this.valid = true; this.frame++;
    return v;
  }

  _objects(scene, camera, v, ortho) {
    const pp = this.pp, list = this.pscene.children; list.length = 0;
    const vm = this.mat('velObj', () => new THREE.ShaderMaterial({ vertexShader: VEL_VS, fragmentShader: VEL_FS, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: { uPrevModel: { value: new THREE.Matrix4() }, uCurVP: { value: this.curVP }, uPrevVP: { value: this.prevVP }, tPrevBones: { value: null }, tDepth: { value: null }, uMax: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector3() } } }));
    const moved = [];
    scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry || o.isBatchedMesh || !o.layers.test(camera.layers)) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mt || mt.transparent || mt.depthWrite === false || mt.visible === false || o.morphTargetInfluences?.length) return;
      let en = this.objs.get(o);
      if (!en) this.objs.set(o, (en = { prev: o.matrixWorld.clone(), proxy: null, bones: null }));
      const sk = o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture ? o.skeleton : null;
      if (!sk && en.prev.equals(o.matrixWorld)) return;
      if (sk) {
        let b = this.bones.get(sk);
        if (!b || b.tex.image.data.length !== sk.boneMatrices.length) {
          const n = sk.boneTexture.image.width, tex = new THREE.DataTexture(new Float32Array(sk.boneMatrices), n, n, THREE.RGBAFormat, THREE.FloatType);
          tex.needsUpdate = true; b && b.tex.dispose(); this.bones.set(sk, (b = { tex, frame: -1 }));
        }
        en.bones = b;
      }
      if (!en.proxy || en.proxy.geometry !== o.geometry) en.proxy = this._proxy(o, en, vm);
      if (o.isInstancedMesh) en.proxy.count = o.count;
      // a skinned mesh that culls itself (frustumCulled with a bounding sphere: its own, or one it was given) is culled
      // by the same sphere here: what the scene pass did not draw has no pixel to write a velocity to
      if (o.isSkinnedMesh) { en.proxy.boundingSphere = o.boundingSphere; en.proxy.frustumCulled = o.frustumCulled && !!o.boundingSphere; }
      list.push(en.proxy); moved.push(o, en);
    });
    this.moved = list.length;   // how many objects had their own motion this frame (for the docs and the checks)
    if (!list.length) return;
    const u = vm.uniforms;
    u.tDepth.value = pp.sceneRT.depthTexture; u.uMax.value.set(pp.w, pp.h); u.uNF.value.set(camera.near, camera.far, ortho ? 1 : 0);
    const r = this.r, ac = r.autoClear, sm = r.shadowMap.autoUpdate;
    r.autoClear = false; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(v); r.render(this.pscene, camera);
    r.autoClear = ac; r.shadowMap.autoUpdate = sm;
    for (let i = 0; i < moved.length; i += 2) {
      const o = moved[i], en = moved[i + 1], b = en.bones;
      en.prev.copy(o.matrixWorld);
      if (b && b.frame !== this.frame) { b.tex.image.data.set(o.skeleton.boneMatrices); b.tex.needsUpdate = true; b.frame = this.frame; }
    }
    list.length = 0;
  }

  // a stand-in drawn with the velocity material: shares the geometry, the world matrix and the skeleton / instances
  _proxy(o, en, vm) {
    const p = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, vm) : o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, vm, 1) : new THREE.Mesh(o.geometry, vm);
    if (o.isSkinnedMesh) { p.skeleton = o.skeleton; p.bindMatrix = o.bindMatrix; p.bindMatrixInverse = o.bindMatrixInverse; p.bindMode = o.bindMode; }
    if (o.isInstancedMesh) { p.instanceMatrix.dispose?.(); p.instanceMatrix = o.instanceMatrix; }
    p.matrixAutoUpdate = p.matrixWorldAutoUpdate = false; p.matrixWorld = o.matrixWorld;
    p.frustumCulled = !(o.isSkinnedMesh || o.isInstancedMesh) && o.frustumCulled;
    p.onBeforeRender = () => { vm.uniforms.uPrevModel.value.copy(en.prev); vm.uniforms.tPrevBones.value = en.bones ? en.bones.tex : null; vm.uniformsNeedUpdate = true; };
    return p;
  }

  /** taa2: blend the sub-frame in pp.accRT (render size, jittered) into the history reprojected along the velocity
   *  buffer; writes a full-size frame back to pp.accRT. alpha = the weight of the new frame (1 = no history). */
  resolve(alpha) {
    const pp = this.pp, v = this.rts.vel;
    const m = this.mat('taa', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tCur, tHist, tVel, tDepth; uniform vec2 uRes, uOut, uJit; uniform float uAlpha, uConf, uK;
      ${SUB}
      ${SQUASH}
      // Catmull-Rom through 5 bilinear taps (the 4 corners of the 3 x 3 tap form carry almost nothing): sharper
      // than bilinear, so the history does not soften a little more with every reprojection
      vec3 hist(vec2 uv){
        vec2 p = uv * uOut, c = floor(p - 0.5) + 0.5, f = p - c;
        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = w1 + w2, t0 = (c - 1.0) / uOut, t3 = (c + 2.0) / uOut, t12 = (c + w2 / w12) / uOut;
        vec4 s = vec4(texture2D(tHist, vec2(t12.x, t0.y)).rgb, 1.0) * (w12.x * w0.y) + vec4(texture2D(tHist, vec2(t0.x, t12.y)).rgb, 1.0) * (w0.x * w12.y)
               + vec4(texture2D(tHist, t12).rgb, 1.0) * (w12.x * w12.y) + vec4(texture2D(tHist, vec2(t3.x, t12.y)).rgb, 1.0) * (w3.x * w12.y)
               + vec4(texture2D(tHist, vec2(t12.x, t3.y)).rgb, 1.0) * (w12.x * w3.y);
        return max(s.rgb / s.a, 0.0);
      }
      void main(){
        // this output pixel in the jittered render buffer, and the nearest texel centre there
        vec2 bp = vUv * uRes - uJit, bc = floor(bp) + 0.5;
        vec3 m1 = vec3(0.0), m2 = vec3(0.0), cur = vec3(0.0); float ws = 0.0, zn = 2.0; vec2 zo = vec2(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
          vec2 o = vec2(x, y), q = (bc + o) / uRes;
          vec3 c = toY(squash(texS(tCur, q).rgb)); m1 += c; m2 += c * c;
          vec2 d = bc + o - bp; float w = exp(-uK * dot(d, d)); cur += c * w; ws += w;   // the new sample, re-filtered at the output position
          float z = texS(tDepth, q).x; if (z < zn) { zn = z; zo = o; }
        }
        cur /= ws; m1 /= 9.0; vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
        vec4 v = texS(tVel, (bc + zo) / uRes);   // the velocity of the closest of the 3 x 3: edges move with what is in front
        vec2 q = vUv + v.xy;
        bool off = any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)));
        // disocclusion: the history remembers how far away its surface was; a pixel that was something else then
        // takes more of the new frame and a tighter clip
        float dis = off ? 1.0 : smoothstep(0.04, 0.12, abs(texture2D(tHist, q).a - v.b) / max(v.b, 1e-3));
        vec3 h = toY(squash(hist(q)));
        vec3 dv = h - m1, ext = mix(1.25, 0.6, dis) * sd + 1e-5, rr = abs(dv) / ext;   // variance clip toward the mean
        float mr = max(rr.x, max(rr.y, rr.z)); if (mr > 1.0) h = m1 + dv / mr;
        vec2 dd = bc - bp;
        float a = max(uAlpha * exp(-uConf * dot(dd, dd)), min(uAlpha, 0.03));   // upscaling: trust a sample by how close it fell
        a = off ? 1.0 : mix(a, max(a, 0.5), dis);
        gl_FragColor = vec4(unsquash(max(fromY(mix(h, cur, a)), 0.0)), v.a);
      }`, { tCur: { value: null }, tHist: { value: null }, tVel: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uOut: { value: new THREE.Vector2() }, uJit: { value: new THREE.Vector2() }, uAlpha: { value: 1 }, uConf: { value: 0 }, uK: { value: 2.29 }, ...pp.sub }));
    const u = m.uniforms, s = pp.rw / pp.w;
    u.tCur.value = pp.accRT.texture; u.tHist.value = pp.histA.texture; u.tVel.value = v.texture; u.tDepth.value = pp.sceneRT.depthTexture;
    u.uRes.value.set(pp.rw, pp.rh); u.uOut.value.set(pp.w, pp.h); u.uJit.value.set(this.jit[0], this.jit[1]);
    u.uAlpha.value = alpha; u.uConf.value = alpha >= 1 ? 0 : 2 * (1 / (s * s) - 1);   // no history: take the new frame everywhere
    u.uK.value = 2.29 / (s * s);   // a Gaussian of 0.47 OUTPUT pixels whatever the render scale
    this.cut = alpha >= 1;
    pp._draw(m, pp.histB);
    [pp.histA, pp.histB] = [pp.histB, pp.histA];
    pp.copyMat.uniforms.tColor.value = pp.histA.texture;
    pp._accView(false);
    pp._draw(pp.copyMat, pp.accRT);
  }

  // run a full-size pass that reads pp.accRT and put its result back there (scratch: histB, which holds nothing
  // the next resolve needs: it is the target that resolve overwrites)
  _apply(m) {
    const pp = this.pp;
    m.uniforms.tColor.value = pp.accRT.texture;
    pp._draw(m, pp.histB);
    pp.copyMat.uniforms.tColor.value = pp.histB.texture;
    pp._draw(pp.copyMat, pp.accRT);
  }

  /** bokeh: lens blur of the resolved frame. The circle of confusion is the thin lens's (lens radius P.dof, focus
   *  distance P.focus: the same lens the accumulated stills use), gathered at half resolution. */
  bokeh(P, camera) {
    const pp = this.pp;
    if (!(P.dof > 0) || !camera || !camera.isPerspectiveCamera) return;
    const half = this.rt('dof', Math.ceil(pp.w / 2), Math.ceil(pp.h / 2));
    const COC = /* glsl */ `
      uniform sampler2D tDepth; uniform vec4 uLens;   // near, far, 1 / focus, px per (1 / m) of defocus
      uniform float uMaxC;
      ${SUB}
      float depthOf(vec2 uv){ float d = texS(tDepth, uv).x; return uLens.x * uLens.y / (uLens.y - d * (uLens.y - uLens.x)); }
      float cocOf(float z){ return min(abs(uLens.w * (uLens.z - 1.0 / z)), uMaxC); }`;
    const U = () => ({ tColor: { value: null }, tDepth: { value: null }, uLens: { value: new THREE.Vector4() }, uMaxC: { value: 8 }, uOut: { value: new THREE.Vector2() }, uK: { value: 0 }, tHalf: { value: null }, ...pp.sub });
    const g = this.mat('dofGather', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uOut; uniform float uK;
      ${COC}
      ${IGN}
      void main(){
        float zc = depthOf(vUv), cc = cocOf(zc), rot = 6.2831853 * ign(gl_FragCoord.xy + uK * 5.588);
        vec4 s = vec4(texture2D(tColor, vUv).rgb, 1.0);
        const int N = 40;
        for (int i = 0; i < N; i++){
          // a sample reaches this pixel when its own circle is at least as wide as its distance; what lies behind
          // the pixel cannot spread over it further than the pixel itself is blurred (sharp things keep their edge)
          float rr = sqrt((float(i) + 0.5) / float(N)) * uMaxC, th = rot + float(i) * 2.3999632;
          vec2 q = vUv + vec2(cos(th), sin(th)) * rr / uOut;
          float zs = depthOf(q), cs = cocOf(zs);
          if (zs > zc) cs = min(cs, cc * 2.0);
          float w = clamp(cs - rr + 0.5, 0.0, 1.0);
          s += vec4(texture2D(tColor, q).rgb, 1.0) * w;
        }
        gl_FragColor = vec4(s.rgb / s.a, cc);
      }`, U()));
    const c = this.mat('dofMix', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor, tHalf; uniform vec2 uOut;
      ${COC}
      void main(){
        vec2 t = 1.0 / uOut;
        vec4 h = 0.25 * (texture2D(tHalf, vUv + t * vec2(1.0, 1.0)) + texture2D(tHalf, vUv + t * vec2(-1.0, 1.0)) + texture2D(tHalf, vUv + t * vec2(1.0, -1.0)) + texture2D(tHalf, vUv + t * vec2(-1.0, -1.0)));
        float k = smoothstep(0.5, 2.0, max(cocOf(depthOf(vUv)), h.a));   // a blurred neighbour in front spreads over a sharp pixel
        gl_FragColor = vec4(mix(texture2D(tColor, vUv).rgb, h.rgb, k), 1.0);
      }`, U()));
    const maxC = (P.bokehMax ?? 16) * pp.h / 1080;
    for (const m of [g, c]) {
      const u = m.uniforms;
      u.tDepth.value = pp.sceneRT.depthTexture; u.uOut.value.set(pp.w, pp.h); u.uMaxC.value = maxC; u.uK.value = this.frame % 64; u.tHalf.value = half.texture;
      u.uLens.value.set(camera.near, camera.far, 1 / Math.max(P.focus, 1e-3), 0.5 * pp.h * camera.projectionMatrix.elements[5] * P.dof);
    }
    g.uniforms.tColor.value = pp.accRT.texture;
    pp._draw(g, half);
    this._apply(c);
  }

  /** motionBlur: blur the resolved frame along the velocity buffer (camera and objects) over P.motionBlur of the
   *  frame interval. Tiles carry the longest velocity near a pixel, so a fast object also streaks over what is
   *  still behind it; samples are weighted by depth and by whether their own motion reaches the pixel. */
  motionBlur(P) {
    const pp = this.pp, v = this.rts.vel;
    if (!v || !this.valid || this.cut) return;   // after a cut the velocities compare two unrelated frames
    const tw = Math.ceil(pp.w / 16), th = Math.ceil(pp.h / 16), near = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    const A = this.rt('mbA', tw, th, near), B = this.rt('mbB', tw, th, near);
    const t1 = this.mat('mbTile', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tVel; uniform vec2 uTile;
      ${SUB}
      void main(){
        vec2 m = vec2(0.0);
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++){
          vec2 q = texS(tVel, vUv + (vec2(x, y) - 1.5) * 0.25 * uTile).xy; if (dot(q, q) > dot(m, m)) m = q;
        }
        gl_FragColor = vec4(m, 0.0, 1.0);
      }`, { tVel: { value: null }, uTile: { value: new THREE.Vector2() }, ...pp.sub }));
    const t2 = this.mat('mbMax', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tVel; uniform vec2 uTile;
      void main(){
        vec2 m = vec2(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 q = texture2D(tVel, vUv + vec2(x, y) * uTile).xy; if (dot(q, q) > dot(m, m)) m = q; }
        gl_FragColor = vec4(m, 0.0, 1.0);
      }`, { tVel: { value: null }, uTile: { value: new THREE.Vector2() } }));
    const g = this.mat('mbGather', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor, tVel, tTile; uniform vec2 uOut; uniform float uK, uMaxPx, uF;
      ${SUB}
      ${IGN}
      void main(){
        vec4 c0 = texture2D(tColor, vUv);
        vec2 vt = texture2D(tTile, vUv).xy * uK; float lt = length(vt * uOut);
        if (lt < 0.75) { gl_FragColor = c0; return; }
        if (lt > uMaxPx) { vt *= uMaxPx / lt; lt = uMaxPx; }
        vec4 vc = texS(tVel, vUv); float lc = min(length(vc.xy * uK * uOut), uMaxPx), zc = vc.a;
        float j = ign(gl_FragCoord.xy + uF * 5.588) - 0.5;
        vec3 sum = c0.rgb / max(lc, 0.5); float ws = 1.0 / max(lc, 0.5);
        const int N = 12;
        for (int i = 0; i < N; i++){
          float t = (float(i) + 0.5 + j) / float(N) - 0.5, d = abs(t) * lt;
          vec2 q = vUv + vt * t;
          vec4 vs = texS(tVel, q); float ls = min(length(vs.xy * uK * uOut), uMaxPx), zs = vs.a, zt = 0.05 * zc + 0.05;
          float front = clamp(1.0 - (zs - zc) / zt, 0.0, 1.0), back = clamp(1.0 - (zc - zs) / zt, 0.0, 1.0);
          // in front and moving far enough to reach us; or behind us while we move across it; or both sweep the spot
          float w = front * clamp(1.0 - d / max(ls, 1e-3), 0.0, 1.0) + back * clamp(1.0 - d / max(lc, 1e-3), 0.0, 1.0)
                  + 2.0 * (1.0 - smoothstep(0.95 * ls, 1.05 * ls + 1e-3, d)) * (1.0 - smoothstep(0.95 * lc, 1.05 * lc + 1e-3, d));
          sum += texture2D(tColor, q).rgb * w; ws += w;
        }
        gl_FragColor = vec4(sum / ws, 1.0);
      }`, { tColor: { value: null }, tVel: { value: null }, tTile: { value: null }, uOut: { value: new THREE.Vector2() }, uK: { value: 0 }, uMaxPx: { value: 32 }, uF: { value: 0 }, ...pp.sub }));
    t1.uniforms.tVel.value = v.texture; t1.uniforms.uTile.value.set(1 / tw, 1 / th); pp._draw(t1, A);
    t2.uniforms.tVel.value = A.texture; t2.uniforms.uTile.value.set(1 / tw, 1 / th); pp._draw(t2, B);
    const u = g.uniforms;
    u.tVel.value = v.texture; u.tTile.value = B.texture; u.uOut.value.set(pp.w, pp.h); u.uK.value = Math.min(1, P.motionBlur);
    u.uMaxPx.value = (P.motionBlurMax ?? 32) * pp.h / 1080; u.uF.value = this.frame % 64;
    this._apply(g);
  }

  /** rcas: contrast-adaptive sharpening of the resolved (upscaled) frame, before bloom and the grade. A 5-tap cross
   *  in a squashed (0..1) space: the negative lobe is as strong as the local range allows without leaving it (so a
   *  flat area and an edge that already spans the range are both left alone, and nothing rings), scaled by P.rcas.
   *  The history is not touched (it is pp.histA), so the sharpening does not feed back. */
  rcas(P) {
    const pp = this.pp;
    const m = this.mat('rcas', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel; uniform float uK;
      ${SQUASH}
      void main(){
        vec4 c0 = texture2D(tColor, vUv);
        vec3 c = squash(c0.rgb), n = squash(texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb), s = squash(texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb),
             e = squash(texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb), w = squash(texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb);
        vec3 lo = min(c, min(min(n, s), min(e, w))), hi = max(c, max(max(n, s), max(e, w)));
        // how far the centre may be pushed before the result leaves [0, 1]: little on a strong edge, none in noise-free flats
        vec3 room = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
        float k = -max(room.r, max(room.g, room.b)) * mix(0.125, 0.2, uK) * step(1e-4, uK);
        vec3 o = clamp((c + (n + s + e + w) * k) / (1.0 + 4.0 * k), lo, hi);
        gl_FragColor = vec4(unsquash(o), c0.a);
      }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uK: { value: 0 } }));
    m.uniforms.uTexel.value.set(1 / pp.w, 1 / pp.h); m.uniforms.uK.value = Math.min(1, P.rcas);
    this._apply(m);
  }

  // The sun on screen for the lens passes (godrays, flare), or null when there is none to draw: no sun given
  // (pp.lensSun = { dir, G }: the world renderer's sun direction and uniforms), the key light is the moon or off
  // (night, below the horizon), the camera is orthographic or faces away. uv: the sun's direction projected (it
  // may lie off screen); front: the cosine between it and the view axis; col: the key light's radiance (the sun
  // through the air: dims and reddens toward the horizon); lk: its luminance; rpx: the sun disc's radius in pixels.
  _sun(camera) {
    const L = this.pp.lensSun;
    if (!L || !camera || !camera.isPerspectiveCamera) return null;
    const kd = L.G.uKeyDir.value, col = L.G.uKeyColor.value, lk = 0.2126 * col.x + 0.7152 * col.y + 0.0722 * col.z;
    if (!(lk > 1e-4) || kd.dot(L.dir) < 0.999) return null;
    const v = (this._sv || (this._sv = new THREE.Vector3())).copy(L.dir).transformDirection(camera.matrixWorldInverse);
    const front = -v.z;
    if (front < 0.05) return null;
    const c = (this._sc || (this._sc = new THREE.Vector4())).set(v.x, v.y, v.z, 0).applyMatrix4(camera.projectionMatrix);
    const e5 = camera.projectionMatrix.elements[5];
    return { uv: [c.x / c.w * 0.5 + 0.5, c.y / c.w * 0.5 + 0.5], front, col, lk, rpx: 0.0047 * 0.5 * this.pp.h * e5 };   // 0.0047: sky.js's disc
  }

  // added into pp.accRT (the frame before the grade), its alpha (the weight sum) left alone
  _addMat(name, fs, uniforms) {
    return this.mat(name, () => quadMat(fs, uniforms, { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
  }

  // Moving frames only: ease a lens buffer (src) toward this frame through a history of its own, the history shifted by
  // how far the sun moved on screen when `follow` (the shafts hang on the sun). The depth the lens passes test is the
  // jittered sub-frame's, and they run after the temporal resolve, so without this a palm frond's edge would make
  // them shimmer. A still (live false: returns src, draws nothing), a resize or a jump of the sun starts again.
  _ease(name, src, uv, live, alpha, follow) {
    const e = (this.hist || (this.hist = {}))[name] || (this.hist[name] = { i: 0, valid: false, uv: [0, 0] });
    if (!live) { e.valid = false; return src; }
    const w = src.width, h = src.height, nf = src.texture.minFilter === THREE.NearestFilter ? { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } : {};
    const prev = this.rt(name + (e.i ? 1 : 0), w, h, nf), next = this.rt(name + (e.i ? 0 : 1), w, h, nf);
    const dx = uv[0] - e.uv[0], dy = uv[1] - e.uv[1];
    const ok = e.valid && e.w === w && e.h === h && Math.abs(dx) + Math.abs(dy) < 0.1;
    const m = this.mat('ease', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tCur, tHist; uniform vec2 uShift; uniform float uA;
      void main(){
        vec4 c = texture2D(tCur, vUv);
        vec2 q = vUv - uShift;
        bool off = uA >= 1.0 || any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)));
        gl_FragColor = off ? c : mix(texture2D(tHist, q), c, uA);
      }`, { tCur: { value: null }, tHist: { value: null }, uShift: { value: new THREE.Vector2() }, uA: { value: 1 } }));
    const u = m.uniforms;
    u.tCur.value = src.texture; u.tHist.value = prev.texture; u.uShift.value.set(follow ? dx : 0, follow ? dy : 0); u.uA.value = ok ? alpha : 1;
    this.pp._draw(m, next);
    Object.assign(e, { i: e.i ^ 1, valid: true, w, h, uv: [uv[0], uv[1]] });
    return next;
  }

  /** godrays: screen-space light shafts. At half resolution, a mask of the sky (depth at the far plane) round the
   *  sun's screen position (a Gaussian kernel, 1/e at a sixth of the frame height; sky dimmer than
   *  P.godraysThreshold x the sun's luminance counts less: clouds, the dark sky away from the sun) is blurred along
   *  the line to the sun in three passes (24 taps each, decaying by P.godraysDecay), with the same blur of the
   *  plain sky mask and of the kernel alone. Their ratio says how much of the sky round the sun something hides
   *  along a pixel's line to it: shafts only show there (an open sky keeps the glow its own aureole gives it, as
   *  light2's volumetric light does). The result is tinted by the key light's radiance (the sun through the air),
   *  faded with the distance from the sun and by the air in front of the surface (1 - exp(-z / 20 m): a near wall
   *  gets little, the sky all), and added before the bloom. The start of each blur is dithered by a per-pixel
   *  pattern stepped by `jk` (the sub-frame / TAA index: constant for a still, so stills stay bit-identical); moving
   *  frames (live) ease the result through a history that follows the sun. vol: light2's volumetric light marched the
   *  sun this frame (its own shafts are there already): the god rays are weighted by P.godraysVol instead of 1. */
  godrays(P, camera, jk = 0, vol = false, live = false) {
    const s = this._sun(camera);
    if (!s) return;
    const k = P.godrays * (vol ? Math.max(0, P.godraysVol ?? 0.35) : 1) * THREE.MathUtils.smoothstep(s.front, 0.05, 0.3);
    if (!(k > 0)) return;
    const pp = this.pp, hw = Math.ceil(pp.w / 2), hh = Math.ceil(pp.h / 2), A = this.rt('grA', hw, hh), B = this.rt('grB', hw, hh);
    const mask = this.mat('grMask', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 uSun, uPx, uNF; uniform float uAspect, uK;
      ${SUB}
      float zf;
      // x: the bright sky, y: the sky (whatever its brightness)
      vec2 tap(vec2 q){
        float z = texS(tDepth, q).x; zf = max(zf, z);
        if (z < 1.0) return vec2(0.0);   // something stands in front of the sky
        return vec2(min(dot(min(texture2D(tColor, q).rgb, vec3(32000.0)), vec3(0.2126, 0.7152, 0.0722)) * uK, 1.0), 1.0);
      }
      void main(){
        // the four output pixels under this half-size one
        zf = 0.0;
        vec2 m = tap(vUv + vec2(-0.5, -0.5) * uPx) + tap(vUv + vec2(0.5, -0.5) * uPx) + tap(vUv + vec2(-0.5, 0.5) * uPx) + tap(vUv + vec2(0.5, 0.5) * uPx);
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        float g = exp(-40.0 * dot(d, d));
        // w: how much air lies in front of the farthest of the four (the shafts hang in it: a near wall gets little of
        // them, the sky all; the farthest, so a thin frond counts as the sky behind it)
        float air = zf >= 1.0 ? 1.0 : 1.0 - exp(-uNF.x * uNF.y / (uNF.y - zf * (uNF.y - uNF.x)) / 20.0);
        gl_FragColor = vec4(0.25 * m * g, g, air);   // z: the kernel alone (an open sky everywhere)
      }`, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uPx: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uK: { value: 1 }, ...pp.sub }));
    const blur = this.mat('grBlur', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uSun; uniform float uStep, uDecay, uJ;
      ${IGN}
      void main(){
        vec2 dl = (uSun - vUv) * uStep;
        vec2 uv = vUv + dl * fract(ign(gl_FragCoord.xy) + uJ * 0.618034);
        vec3 s = vec3(0.0); float w = 1.0, ws = 0.0;
        for (int i = 0; i < 24; i++){ s += texture2D(tIn, uv).rgb * w; ws += w; w *= uDecay; uv += dl; }
        gl_FragColor = vec4(s / ws, texture2D(tIn, vUv).a);   // the air is the pixel's own, not blurred
      }`, { tIn: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 0.02 }, uDecay: { value: 0.965 }, uJ: { value: 0 } }));
    const add = this._addMat('grAdd', /* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn; uniform vec3 uTint; uniform vec2 uSun; uniform float uAspect;
      void main(){
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        // shafts only: the share of the kernel along this pixel's path to the sun that something hides (an open sky
        // already carries its own glow round the sun: light2's volumetric light makes the same choice)
        vec4 r = texture2D(tIn, vUv);
        float hid = smoothstep(0.05, 0.4, 1.0 - r.y / max(r.z, 1e-6));
        gl_FragColor = vec4(uTint * (r.x * hid * r.w * exp(-3.0 * dot(d, d))), 1.0);
      }`, { tIn: { value: null }, uTint: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    const m = mask.uniforms;
    m.tColor.value = pp.accRT.texture; m.tDepth.value = pp.sceneRT.depthTexture; m.uSun.value.fromArray(s.uv); m.uPx.value.set(1 / pp.w, 1 / pp.h);
    m.uNF.value.set(camera.near, camera.far); m.uAspect.value = pp.w / pp.h; m.uK.value = 1 / (s.lk * Math.max(1e-3, P.godraysThreshold ?? 0.3));
    pp._draw(mask, A);
    // three passes, each reaching further toward the sun (24 taps x step: 0.29, 0.72, 0.96 of the way)
    const b = blur.uniforms;
    b.uSun.value.fromArray(s.uv); b.uDecay.value = Math.min(1, Math.max(0.5, P.godraysDecay ?? 0.965)); b.uJ.value = jk % 8;
    [[A, B, 0.012], [B, A, 0.03], [A, B, 0.04]].forEach(([src, dst, st]) => { b.tIn.value = src.texture; b.uStep.value = st; pp._draw(blur, dst); });
    const R = this._ease('grH', B, s.uv, live, 0.2, true), u = add.uniforms;
    u.tIn.value = R.texture; u.uSun.value.fromArray(s.uv); u.uAspect.value = pp.w / pp.h; u.uTint.value.copy(s.col).multiplyScalar(k);
    pp._accView(false);
    pp._draw(add, pp.accRT);
  }

  /** flare: the sun's lens flare, added after the bloom. Its visibility is measured on the GPU (no read-back) by 16
   *  depth taps over a disc 1.25 x the sun's (a sun behind a wall or a palm frond, or off the frame, leaves none;
   *  half hidden, half the flare); the flare is a veiling glare round the sun, six ghosts along the line from the
   *  sun through the frame's centre and a faint halo ring, all x the key light's radiance (the sun through the air:
   *  weaker and redder toward the horizon, nothing at night; the moon makes none) x P.flare. No noise: stills stay
   *  bit-identical; moving frames (live) ease the visibility over a few frames (the depth taps are jittered). */
  flare(P, camera, live = false) {
    const s = this._sun(camera);
    if (!s || !(P.flare > 0)) return;
    const pp = this.pp, V = this.rt('flVis', 1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const vis = this.mat('flVis', () => quadMat(/* glsl */ `
      uniform sampler2D tDepth; uniform vec2 uSun, uR;
      ${SUB}
      void main(){
        float v = 0.0;
        for (int i = 0; i < 16; i++){
          float r = sqrt((float(i) + 0.5) / 16.0), a = float(i) * 2.3999632;
          vec2 q = uSun + vec2(cos(a), sin(a)) * r * uR;
          bool on = all(greaterThanEqual(q, vec2(0.0))) && all(lessThanEqual(q, vec2(1.0)));
          if (on && texS(tDepth, q).x >= 1.0) v += 1.0;
        }
        gl_FragColor = vec4(v / 16.0, 0.0, 0.0, 1.0);
      }`, { tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uR: { value: new THREE.Vector2() }, ...pp.sub }));
    const fl = this._addMat('flare', /* glsl */ `
      varying vec2 vUv; uniform sampler2D tVis; uniform vec2 uSun, uAsp; uniform vec3 uCol;
      void main(){
        float vis = texture2D(tVis, vec2(0.5)).r;
        if (vis <= 0.0) { gl_FragColor = vec4(0.0); return; }
        vec2 axis = vec2(0.5) - uSun;
        vec3 acc = vec3(0.0);
        // ghosts: discs along the line from the sun through the centre, a little brighter at the rim
        // (where along the line, radius) and colour
        vec2 gp[6]; gp[0] = vec2(0.55, 0.035); gp[1] = vec2(0.85, 0.06); gp[2] = vec2(1.15, 0.025); gp[3] = vec2(1.42, 0.11); gp[4] = vec2(1.75, 0.045); gp[5] = vec2(2.1, 0.16);
        vec3 gc[6]; gc[0] = vec3(1.0, 0.6, 0.25); gc[1] = vec3(0.35, 0.8, 0.6); gc[2] = vec3(1.0, 0.45, 0.3); gc[3] = vec3(0.4, 0.55, 1.0); gc[4] = vec3(0.9, 0.8, 0.4); gc[5] = vec3(0.5, 0.75, 1.0);
        for (int i = 0; i < 6; i++){
          float d = length((vUv - uSun - axis * gp[i].x) * uAsp), r = gp[i].y;
          acc += gc[i] * smoothstep(r, r * 0.75, d) * (0.35 + 0.65 * smoothstep(0.0, r, d)) * 0.05;
        }
        float ds = length((vUv - uSun) * uAsp);
        acc += vec3(1.0, 0.7, 0.4) * smoothstep(0.30, 0.34, ds) * smoothstep(0.40, 0.34, ds) * 0.008;   // a faint halo
        acc += vec3(1.0, 0.72, 0.45) * exp(-7.0 * ds) * 0.12;   // veiling glare
        gl_FragColor = vec4(acc * vis * uCol, 1.0);
      }`, { tVis: { value: null }, uSun: { value: new THREE.Vector2() }, uAsp: { value: new THREE.Vector2() }, uCol: { value: new THREE.Vector3() } });
    const r = Math.max(1.5, 1.25 * s.rpx);
    vis.uniforms.tDepth.value = pp.sceneRT.depthTexture; vis.uniforms.uSun.value.fromArray(s.uv); vis.uniforms.uR.value.set(r / pp.w, r / pp.h);
    pp._draw(vis, V);
    const u = fl.uniforms;
    u.tVis.value = this._ease('flH', V, s.uv, live, 0.3, false).texture; u.uSun.value.fromArray(s.uv); u.uAsp.value.set(pp.w / pp.h, 1); u.uCol.value.copy(s.col).multiplyScalar(P.flare);
    pp._accView(false);
    pp._draw(fl, pp.accRT);
  }

  /** bloomPyramid: halve the frame six times (13 taps; the first step weights by 1 / (1 + luma), so one very hot
   *  pixel does not flicker as a whole blob), walk back up through a 3 x 3 tent, each level mixed into the next
   *  finer one, and mix the result into pp.accRT by P.bloom. No threshold: energy is moved, not added. Returns
   *  the exposure factor for the grade. */
  bloom(P) {
    const pp = this.pp, N = 6, L = [];
    for (let i = 0, w = pp.w, h = pp.h; i < N; i++) { w = Math.max(2, Math.ceil(w / 2)); h = Math.max(2, Math.ceil(h / 2)); L.push(this.rt('bl' + i, w, h)); }
    const dn = this.mat('blDown', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uT; uniform float uKaris;
      vec4 tap(vec2 o, float w){ vec3 c = min(texture2D(tColor, vUv + o * uT).rgb, vec3(32000.0)); w /= 1.0 + uKaris * dot(c, vec3(0.2126, 0.7152, 0.0722)); return vec4(c * w, w); }
      void main(){
        vec4 s = tap(vec2(0.0), 0.125)
          + tap(vec2(-1.0, -1.0), 0.125) + tap(vec2(1.0, -1.0), 0.125) + tap(vec2(-1.0, 1.0), 0.125) + tap(vec2(1.0, 1.0), 0.125)
          + tap(vec2(-2.0, 0.0), 0.0625) + tap(vec2(2.0, 0.0), 0.0625) + tap(vec2(0.0, -2.0), 0.0625) + tap(vec2(0.0, 2.0), 0.0625)
          + tap(vec2(-2.0, -2.0), 0.03125) + tap(vec2(2.0, -2.0), 0.03125) + tap(vec2(-2.0, 2.0), 0.03125) + tap(vec2(2.0, 2.0), 0.03125);
        gl_FragColor = vec4(s.rgb / s.a, 1.0);
      }`, { tColor: { value: null }, uT: { value: new THREE.Vector2() }, uKaris: { value: 0 } }));
    const up = this.mat('blUp', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uT;
      void main(){
        vec3 s = texture2D(tColor, vUv).rgb * 4.0;
        s += (texture2D(tColor, vUv + vec2(uT.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uT.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(0.0, uT.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uT.y)).rgb) * 2.0;
        s += texture2D(tColor, vUv + uT).rgb + texture2D(tColor, vUv - uT).rgb + texture2D(tColor, vUv + vec2(uT.x, -uT.y)).rgb + texture2D(tColor, vUv + vec2(-uT.x, uT.y)).rgb;
        gl_FragColor = vec4(s / 16.0, 1.0);
      }`, { tColor: { value: null }, uT: { value: new THREE.Vector2() } },
    { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor }));
    let src = pp.accRT;
    for (let i = 0; i < N; i++) {
      dn.uniforms.tColor.value = src.texture; dn.uniforms.uT.value.set(1 / src.width, 1 / src.height); dn.uniforms.uKaris.value = i ? 0 : 1;
      pp._draw(dn, L[i]); src = L[i];
    }
    // bloomRadius: how much of each coarser level reaches the finer one (a wider or a tighter glow)
    const mixUp = Math.min(0.95, Math.max(0.05, 0.3 + 0.5 * (P.bloomRadius ?? 0.5)));
    for (let i = N - 2; i >= -1; i--) {
      const s = L[i + 1], dst = i < 0 ? pp.accRT : L[i];
      up.uniforms.tColor.value = s.texture; up.uniforms.uT.value.set(1 / s.width, 1 / s.height);
      up.blendAlpha = i < 0 ? Math.min(1, Math.max(1e-4, P.bloom)) : mixUp;   // never exactly 0 (three skips blendColor then)
      pp._draw(up, dst);
    }
    // the exposure the old additive bloom of P.bloom gave a flat image (post.js _bloom: 3 x its radius-mixed mip
    // weights), so switching the pyramid on keeps the mid-tones of a look tuned with the old bloom
    const expK = 1 + Math.max(0, P.bloom) * 3 * [1.0, 0.8, 0.6, 0.4, 0.2].reduce((t, f) => t + f + (1.2 - 2 * f) * (P.bloomRadius ?? 0.5), 0);
    return expK;
  }

  // the exposure the grade will apply (P.exposure x the bloom's factor x the adapted auto exposure, read on the GPU),
  // so a threshold can be set in exposed luminance: the light that will reach the tone map's shoulder
  _expo(m, P, exposure) {
    const u = m.uniforms;
    u.uExp.value = Number.isFinite(exposure) ? exposure : 1; u.uUseAE.value = P.autoExposure > 0 ? 1 : 0; u.tAE.value = this.pp.aeA.texture;
  }

  /** lensDirt: the lens's dirt lit by the light of bright things. The frame's light above P.lensDirtThreshold
   *  (exposed luminance, a soft knee per pixel: lamps, the sun, a bright sky; not a lit wall) is taken to 1/8 size,
   *  then 1/32, blurred there (a Gaussian of sigma 3 texels, ~100 output pixels: a smudge catches the light of a lamp
   *  a few hundred pixels away) and added into pp.accRT x the dirt mask (lensDirtMask, made once) x P.lensDirt, after
   *  whichever bloom ran. exposure: the grade's exposure. No noise: stills stay bit-identical. */
  lensDirt(P, exposure) {
    const pp = this.pp, w8 = Math.max(2, Math.ceil(pp.w / 8)), h8 = Math.max(2, Math.ceil(pp.h / 8)), w32 = Math.max(2, Math.ceil(pp.w / 32)), h32 = Math.max(2, Math.ceil(pp.h / 32));
    const A = this.rt('drA', w8, h8), B = this.rt('drB', w32, h32), C = this.rt('drC', w32, h32);
    if (!this.dirtTex) {
      const w = 512, h = 256, t = this.dirtTex = new THREE.DataTexture(lensDirtMask({ width: w, height: h }), w, h, THREE.RedFormat, THREE.UnsignedByteType);
      t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    }
    const pre = this.mat('drPre', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uPx; uniform float uThr;
      ${EXPO}
      void main(){
        // this texel covers 8 x 8 output pixels: 16 bilinear taps of 2 x 2, each thresholded on its own (a small hot
        // lamp keeps its light; the dim pixels round it add none)
        vec3 s = vec3(0.0); float e = expo();
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++){
          vec3 c = min(texture2D(tColor, vUv + (vec2(x, y) * 2.0 - 3.0) * uPx).rgb, vec3(32000.0));
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * e;
          s += c * (max(l - uThr, 0.0) / max(l, 1e-4));
        }
        gl_FragColor = vec4(s / 16.0, 1.0);
      }`, { tColor: { value: null }, uPx: { value: new THREE.Vector2() }, uThr: { value: 1 }, tAE: { value: null }, uUseAE: { value: 0 }, uExp: { value: 1 } }));
    const down = this.mat('drDown', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uT;
      void main(){ gl_FragColor = vec4(0.25 * (texture2D(tIn, vUv + uT * vec2(-1.0, -1.0)).rgb + texture2D(tIn, vUv + uT * vec2(1.0, -1.0)).rgb + texture2D(tIn, vUv + uT * vec2(-1.0, 1.0)).rgb + texture2D(tIn, vUv + uT).rgb), 1.0); }`,
    { tIn: { value: null }, uT: { value: new THREE.Vector2() } }));
    const blur = this.mat('drBlur', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uD;
      void main(){
        vec3 s = vec3(0.0); float ws = 0.0;
        for (int i = -4; i <= 4; i++){ float w = exp(-0.125 * float(i * i)); s += texture2D(tIn, vUv + float(i) * uD).rgb * w; ws += w; }
        gl_FragColor = vec4(s / ws, 1.0);
      }`, { tIn: { value: null }, uD: { value: new THREE.Vector2() } }));
    const add = this._addMat('drAdd', /* glsl */ `
      varying vec2 vUv; uniform sampler2D tFar, tDirt; uniform float uK;
      void main(){
        vec3 g = texture2D(tFar, vUv).rgb;
        gl_FragColor = vec4(g * (texture2D(tDirt, vUv).r * uK), 1.0);
      }`, { tFar: { value: null }, tDirt: { value: null }, uK: { value: 0 } });
    pre.uniforms.tColor.value = pp.accRT.texture; pre.uniforms.uPx.value.set(1 / pp.w, 1 / pp.h); pre.uniforms.uThr.value = Math.max(0, P.lensDirtThreshold ?? 1);
    this._expo(pre, P, exposure);
    pp._draw(pre, A);
    down.uniforms.tIn.value = A.texture; down.uniforms.uT.value.set(1 / w8, 1 / h8); pp._draw(down, B);
    blur.uniforms.tIn.value = B.texture; blur.uniforms.uD.value.set(1.5 / w32, 0); pp._draw(blur, C);
    blur.uniforms.tIn.value = C.texture; blur.uniforms.uD.value.set(0, 1.5 / h32); pp._draw(blur, B);
    const u = add.uniforms;
    u.tFar.value = B.texture; u.tDirt.value = this.dirtTex; u.uK.value = 20 * Math.min(2, P.lensDirt);
    pp._accView(false);
    pp._draw(add, pp.accRT);
  }

  /** streak: anamorphic streaks. Pixels brighter than P.streakThreshold (exposed luminance, soft knee) are taken at
   *  a quarter width and half height, smeared along x by three passes of 9 taps (steps 1, 4 and 16 texels x
   *  P.streakLength, weights falling off exponentially: a bright core and a long tail), mostly desaturated, tinted by
   *  P.streakTint and added into pp.accRT x P.streak (after the bloom, before the flare and the grade). exposure: the
   *  grade's exposure (P.exposure x the bloom's factor). No noise: stills stay bit-identical. */
  streak(P, exposure) {
    const pp = this.pp, w = Math.max(2, Math.ceil(pp.w / 4)), h = Math.max(2, Math.ceil(pp.h / 2)), A = this.rt('stA', w, h), B = this.rt('stB', w, h);
    const pre = this.mat('stPre', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uPx; uniform float uThr;
      ${EXPO}
      void main(){
        // this texel covers 4 x 2 output pixels: two bilinear taps of 2 x 2 each
        vec3 c = 0.5 * (min(texture2D(tColor, vUv - vec2(uPx.x, 0.0)).rgb, vec3(32000.0)) + min(texture2D(tColor, vUv + vec2(uPx.x, 0.0)).rgb, vec3(32000.0)));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * expo();
        gl_FragColor = vec4(c * (max(l - uThr, 0.0) / max(l, 1e-4)), 1.0);
      }`, { tColor: { value: null }, uPx: { value: new THREE.Vector2() }, uThr: { value: 1 }, tAE: { value: null }, uUseAE: { value: 0 }, uExp: { value: 1 } }));
    const blur = this.mat('stBlur', () => quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn; uniform float uStep;
      void main(){
        vec3 s = texture2D(tIn, vUv).rgb; float ws = 1.0;
        for (int i = 1; i <= 4; i++){
          float w = exp(-0.55 * float(i)); vec2 o = vec2(float(i) * uStep, 0.0);
          s += (texture2D(tIn, vUv + o).rgb + texture2D(tIn, vUv - o).rgb) * w; ws += 2.0 * w;
        }
        gl_FragColor = vec4(s / ws, 1.0);
      }`, { tIn: { value: null }, uStep: { value: 0 } }));
    const add = this._addMat('stAdd', /* glsl */ `
      varying vec2 vUv; uniform sampler2D tIn, tMid; uniform vec3 uTint;
      void main(){
        vec3 s = 0.5 * (texture2D(tIn, vUv).rgb + texture2D(tMid, vUv).rgb);   // a bright core (the second pass) and a long tail (the third)
        gl_FragColor = vec4(mix(vec3(dot(s, vec3(0.2126, 0.7152, 0.0722))), s, 0.3) * uTint, 1.0);
      }`, { tIn: { value: null }, tMid: { value: null }, uTint: { value: new THREE.Vector3() } });
    pre.uniforms.tColor.value = pp.accRT.texture; pre.uniforms.uPx.value.set(1 / pp.w, 1 / pp.h); pre.uniforms.uThr.value = Math.max(0, P.streakThreshold ?? 3);
    this._expo(pre, P, exposure);
    pp._draw(pre, A);
    const L = Math.min(4, Math.max(0.1, P.streakLength ?? 1));
    [[A, B, 1], [B, A, 4], [A, B, 16]].forEach(([src, dst, st]) => { blur.uniforms.tIn.value = src.texture; blur.uniforms.uStep.value = st * L / w; pp._draw(blur, dst); });
    const t = Array.isArray(P.streakTint) ? P.streakTint : [0.5, 0.7, 1.0];
    add.uniforms.tIn.value = B.texture; add.uniforms.tMid.value = A.texture; add.uniforms.uTint.value.set(t[0], t[1], t[2]).multiplyScalar(3 * Math.min(2, P.streak));
    pp._accView(false);
    pp._draw(add, pp.accRT);
  }

  /** The grade with a 3D LUT and / or chromatic aberration: the pipeline's own grade text, patched (the default
   *  grade program stays as it is). Returns null when neither is on. */
  grade(P) {
    if (!P.lut && !(P.chroma > 0)) return null;
    const m = this.mat('grade', () => {
      let fs = this.pp._gradeFS;
      const swap = (a, b) => { if (!fs.includes(a)) throw new Error('postfx: grade text changed, cannot patch it'); fs = fs.replace(a, b); };
      swap('uniform sampler2D tAE; uniform float uUseAE;', 'uniform sampler2D tAE; uniform float uUseAE; uniform highp sampler3D tLut; uniform float uLutK, uChroma; uniform vec2 uLutS;');
      // lateral colour: red and blue magnified a little differently about the centre, nothing at the centre
      swap('vec3 c = texture2D(tColor, vUv).rgb;', 'vec2 ca = (vUv - 0.5) * uChroma;\n        vec3 c = vec3(texture2D(tColor, vUv - ca).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv + ca).b);');
      swap('vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;', 'vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;\n        if (uLutK > 0.0) o = mix(o, texture(tLut, clamp(o, 0.0, 1.0) * uLutS.x + uLutS.y).rgb, uLutK);');
      return quadMat(fs, { ...this.pp._gradeU(), tLut: { value: null }, uLutK: { value: 0 }, uChroma: { value: 0 }, uLutS: { value: new THREE.Vector2(1, 0) } });
    });
    const u = m.uniforms, n = P.lut ? P.lut.image.width : 2;
    u.tLut.value = P.lut || null; u.uLutK.value = P.lut ? Math.min(1, Math.max(0, P.lutStrength ?? 1)) : 0;
    u.uLutS.value.set((n - 1) / n, 0.5 / n); u.uChroma.value = Math.max(0, P.chroma || 0) / 100;
    return m;
  }

  dispose() {
    for (const t of Object.values(this.rts)) t.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    if (this.dirtTex) { this.dirtTex.dispose(); this.dirtTex = null; }
    this.rts = {}; this.mats = {}; this.hist = {};
  }
}

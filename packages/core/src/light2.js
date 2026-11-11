// Mirage code adapted from the author's own Nizwa engine (oman-golden, "P11 LIGHT"); no Golden Temple code in it.
import * as THREE from 'three';
import { CHUNK_EPOCH } from './env.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { patch } from './materials.js';
import { onChunksRestored } from './fog.js';

// ---------------------------------------------------------------------------
// light2: lamp shadows, volumetric light, screen-space reflections and an energy-conserving bloom. Opt-in:
//
//   createWorldRenderer({ ..., light2: true })                 // or an object overriding LIGHT2_DEFAULTS below
//
// Without it nothing here runs and no shader chunk is touched: a world compiles exactly what it did before.
//
// Lamp shadows. Every visible PointLight of the scene (intensity > 0) and every source a module registers on its
// scene (`addLampSource(scene, fn)`, fn(camPos) -> [{ x, y, z, range, power, near?, col? }]) is a candidate; the
// `slots` best (power x falloff from the view, with hysteresis) get a shadow. Each slot is drawn as a cube by three's
// own shadow renderer (an off-scene PointLight: castShadow, layers, instancing, skinning, alpha test, side all
// honoured as for the sun) and folded into one octahedral tile of a float depth atlas. Every lit program samples ALL
// lamp shadows through ONE sampler2DShadow (hardware 2x2 PCF, 5 fixed taps: soft, stable under TAA); the light loop
// finds a lamp's slot by its position. New slots draw at once (perFrame), stale ones refresh every refreshS seconds,
// and the moving casters (top-level objects with userData.mgDynamic) one slot every dynEvery sub-frames.
// Top-level objects with userData.mgLampCast === false (terrain, big ground meshes) are left out of the cubes.
//
// The extra sampler is paid for by replacing three's DFG lookup table with its analytic fit (Karis 2014), and both
// are compiled only for Standard / Physical / Lambert / Phong materials under THREE.FogExp2 (every Mirage world).
// The chunks are page-global once installed: a second world on the same page without light2 sees no slot (one
// uniform test) but does get the analytic DFG (a tiny difference in the specular of rough surfaces).
//
// Reflections. Opaque Standard / Physical surfaces that are smooth (roughness < ~0.42) write -reflectance into
// the scene target's alpha; the pipeline marches those pixels in screen space at half resolution and mixes the hit
// in; misses keep the material's own environment reflection.
//
// Volumetric light. The key light (through its shadow map) and the best lamps (through the atlas) scatter in a thin
// dust layer near the ground, denser inside the world's ambient volumes (setAmbientVolumes: rooms, arcades); shafts
// only (an open, wholly lit ray is faded out, so there is no flat veil). Half resolution, jittered by the sub-frame.
//
// Bloom. The image is mixed toward its blurred self (k = day .. night by the lamp level) instead of the blur being
// added on top, so highlights glow without lifting the whole image; the exposure is raised by the lift the additive
// bloom gave, so mid-tones stay where they were.
// ---------------------------------------------------------------------------

export const LIGHT2_DEFAULTS = {
  // slots: lamps with a shadow (<= LS_N); tile / cube: atlas tile and cube face size (px); perFrame: new cubes per
  // sub-frame; refreshS: a static cube is redrawn this often anyway; dynEvery: a moving-caster cube every n sub-frames;
  // dayLevel: below this lamp level the scene's PointLights hold no slot; reach: m beyond a lamp's range it stays a
  // candidate; near: a PointLight's default near plane (m: a lantern's own glass and cage do not shadow its flame)
  ls: { on: true, slots: 4, tile: 512, cube: 256, perFrame: 2, refreshS: 20, dynEvery: 3, dayLevel: 0.15, reach: 22, near: 0.45 },
  // maxDist: march length (m), thick: a hit thicker than this is a ray passing behind (m), gain
  ssr: { on: true, maxDist: 30, gain: 1.0, thick: 0.35 },
  // sun / lamps: gains; dustOut: outdoor dust at the floor (1/m), height its scale height (m), golden: more dust toward
  // a low sun, dustIn: inside ambient volumes; lampDust / haloR: smoke round a flame; noise: drifting density;
  // g: the key light's phase; maxDist: key-light march (m); nearRoom: march the key light when this close to a volume;
  // lampReach: a lamp's in-scatter is marched within this radius (m) of its flame (nearly all of it is: 1/d^2)
  vol: { on: true, sun: 1.0, lamps: 2.0, dustOut: 0.003, golden: 4.0, height: 6.0, dustIn: 0.006, lampDust: 0.05, haloR: 1.1, noise: 0.5, g: 0.65, maxDist: 60, nearRoom: 2, lampReach: 5 },
  // share of the blurred image by day and at night (by the lamp level)
  bloom: { on: true, day: 0.07, night: 0.18 },
};

/** a full light2 config from `true` or a partial object */
export function light2Config(c) {
  if (!c) return null;
  const o = c === true ? {} : c;
  const out = {};
  for (const k of Object.keys(LIGHT2_DEFAULTS)) out[k] = o[k] === false ? { ...LIGHT2_DEFAULTS[k], on: false } : { ...LIGHT2_DEFAULTS[k], ...(o[k] || {}) };
  return out;
}

export const LS_N = 4;            // slots compiled into the shaders
export const VOL_LAMPS = 8;       // lamps the volumetric pass scatters

// shared uniforms (typed arrays and an un-clonable texture: three's cloneUniforms keeps both by reference)
export const LS_SHARED = {
  pos: new Float32Array(4 * LS_N),                          // xyz lamp (world), w = far (range); 0 = slot empty
  info: new Float32Array([0.16, 0.5, 0.5, 1 / 512]),        // -, 1/cols, 1/rows, 1/tile px
  info2: new Float32Array([0, 0, 0, 0]),                    // x: slots in use (the loop bound; 0 = skip)
  near: new Float32Array([0.16, 0.16, 0.16, 0.16]),         // each slot's near plane
  atlas: null,
};

const MATS = ['standard', 'physical', 'lambert', 'phong'];

// one page-global atlas (every world on the page shares the programs, so it shares the texture; OWNER: whose slots)
let ATLAS = null, OWNER = null;
function atlasFor(tile, cols, rows) {
  const w = tile * cols, h = tile * rows;
  if (ATLAS && ATLAS.width === w && ATLAS.height === h) return ATLAS;
  if (!ATLAS) {
    const dt = new THREE.DepthTexture(w, h, THREE.FloatType);
    dt.format = THREE.DepthFormat;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    ATLAS = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RedFormat, depthBuffer: true, depthTexture: dt, generateMipmaps: false });
    // shared with every program by reference: never uploaded from the CPU, never cloned
    dt.isRenderTargetTexture = false;
    dt.clone = function () { return this; };
    // allocated (with its compare mode) on first use, even when a program samples it before the atlas is drawn
    dt.needsUpdate = true;
    LS_SHARED.atlas = dt;
    for (const k of MATS) { const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms; if (u && u.mgLsAtlas) u.mgLsAtlas.value = dt; }
  } else ATLAS.setSize(w, h);
  return ATLAS;
}

const LS_GUARD = '#if defined( USE_FOG ) && defined( FOG_EXP2 ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) ) && !defined( MG_NO_LS )';
const LS_GLSL = /* glsl */ `
${LS_GUARD}
#define MG_LS
#define MG_LS_DECL
#define MG_LS_N ${LS_N}
uniform highp sampler2DShadow mgLsAtlas;
uniform vec4 mgLsPos[MG_LS_N];
uniform vec4 mgLsInfo;
uniform vec4 mgLsInfo2;    // x: slots in use (a run-time loop bound)
uniform vec4 mgLsNear;     // each slot's near plane
// octahedral map with the lower hemisphere (the floor under a lamp) in the centre diamond
vec2 mgLsOct(vec3 d){
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  vec2 o = d.xz;
  if (d.y > 0.0) o = (1.0 - abs(o.yx)) * vec2(o.x >= 0.0 ? 1.0 : -1.0, o.y >= 0.0 ? 1.0 : -1.0);
  return o * 0.5 + 0.5;
}
float mgLsTap(vec2 base, vec2 uv, float ref){
  vec2 t = clamp(uv, vec2(mgLsInfo.w * 1.5), vec2(1.0 - mgLsInfo.w * 1.5));
  return texture(mgLsAtlas, vec3((base + t) * mgLsInfo.yz, ref));
}
// visibility of slot s from pW (world), normal nW
float mgLsSlotVis(int s, vec3 pW, vec3 nW){
  vec4 L = mgLsPos[s];
  vec3 v = pW - L.xyz;
  float d0 = length(v);
  if (L.w <= 0.0 || d0 >= L.w) return 1.0;
  // normal offset grows with the distance (a texel's footprint), plus a little toward the lamp
  v += nW * (0.012 + 0.006 * d0) - v / max(d0, 1e-4) * (0.01 + 0.004 * d0);
  float d = length(v);
  float nr = mgLsNear[s];
  float ref = (d - nr) / (L.w - nr);
  vec2 uv = mgLsOct(v / d);
  float cols = 1.0 / mgLsInfo.y;
  vec2 base = vec2(mod(float(s), cols), floor(float(s) / cols));
  // 5 bilinear PCF taps in a fixed pattern (stable under the temporal AA), ~1.6 texels: a flame is not a point
  float r = mgLsInfo.w * 1.6;
  float sh = mgLsTap(base, uv, ref) * 2.0;
  sh += mgLsTap(base, uv + vec2(r, r * 0.35), ref);
  sh += mgLsTap(base, uv + vec2(-r * 0.35, r), ref);
  sh += mgLsTap(base, uv + vec2(-r, -r * 0.35), ref);
  sh += mgLsTap(base, uv + vec2(r * 0.35, -r), ref);
  return sh / 6.0;
}
int mgLsSlot(vec3 lampW){
  int s = -1;
  for (int i = 0; i < MG_LS_N; i++) { vec3 d = lampW - mgLsPos[i].xyz; if (mgLsPos[i].w > 0.0 && dot(d, d) < 4e-4) s = i; }
  return s;
}
/** visibility of the lamp at lampW from the world point pW (world normal nW); 1 when the lamp has no slot */
float mgLsVis(vec3 lampW, vec3 pW, vec3 nW){
  int s = mgLsSlot(lampW);
  return s < 0 ? 1.0 : mgLsSlotVis(s, pW, nW);
}
// view space (three's light loop) to world: p_w = R^T (p_v - t)
vec3 mgLsWorld(vec3 pV){ return (pV - viewMatrix[3].xyz) * mat3(viewMatrix); }
float mgLsVisV(vec3 lampV, vec3 pV, vec3 nV){ return mgLsVis(mgLsWorld(lampV), mgLsWorld(pV), nV * mat3(viewMatrix)); }
// analytic environment BRDF (Karis 2014) in place of three's DFG lookup table: frees the atlas's texture unit
vec2 mgDFG(float rough, float nv){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
#else
#ifndef MG_LS_DECL
#define MG_LS_DECL
float mgLsVis(vec3 lampW, vec3 pW, vec3 nW){ return 1.0; }
#endif
#endif
`;

let installed = false;
onChunksRestored(() => { installed = false; });   // the last world on the page was disposed (fog.js)
/** Patch three's chunks and uniform libraries (idempotent; createWorldRenderer calls it when light2 is on).
 *  Returns false when three's chunks are not the ones this was written against (nothing is patched then). */
export function installLight2() {
  if (installed) return true;
  const C = THREE.ShaderChunk;
  const hook = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  const dfgA = 'material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;';
  const dfgB = 'vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;';
  const outA = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
  const trA = 'material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );';
  if (!C.lights_fragment_begin.includes(hook) || !C.lights_fragment_begin.includes(dfgA) || !C.lights_physical_pars_fragment.includes(dfgB) || !C.opaque_fragment.includes(outA) || !C.transmission_fragment.includes(trA)) {
    console.warn('[light2] three\'s shader chunks changed: lamp shadows and reflections not installed');
    return false;
  }
  installed = true;
  CHUNK_EPOCH.n++;
  for (const k of MATS) {
    const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms;
    if (!u || u.mgLsPos) continue;
    u.mgLsAtlas = { value: null };
    u.mgLsPos = { value: LS_SHARED.pos };
    u.mgLsInfo = { value: LS_SHARED.info };
    u.mgLsInfo2 = { value: LS_SHARED.info2 };
    u.mgLsNear = { value: LS_SHARED.near };
  }
  atlasFor(512, 2, 2);
  C.common = C.common + LS_GLSL;
  C.lights_fragment_begin = C.lights_fragment_begin
    .replace(hook, hook + '\n\t\t#ifdef MG_LS\n\t\tif ( mgLsInfo2.x > 0.5 && receiveShadow ) directLight.color *= mgLsVisV( pointLight.position, geometryPosition, geometryNormal );\n\t\t#endif')
    .replace(dfgA, '#ifdef MG_LS\n\tmaterial.dfg = mgDFG( material.roughness, dotNVms );\n\t#else\n\t' + dfgA + '\n\t#endif');
  C.lights_physical_pars_fragment = C.lights_physical_pars_fragment.replace(dfgB, '#ifdef MG_LS\n\tvec2 fab = mgDFG( roughness, dotNV );\n\t#else\n\t' + dfgB + '\n\t#endif');
  // the reflectance of a smooth opaque surface goes out in the scene target's alpha as -w (below any real alpha:
  // transparent layers drawn over it, additive ones included, can only weaken it; a rough surface stays >= 0).
  // The share of the pixel that is emitted light is left out, so a reflection never dims a glowing surface.
  C.opaque_fragment = C.opaque_fragment.replace(outA, outA + `
#if defined( MG_LS ) && defined( STANDARD ) && defined( OPAQUE ) && !defined( PREMULTIPLIED_ALPHA ) && !defined( MG_NO_SSR )
{
  float mgNV = saturate( dot( geometryNormal, geometryViewDir ) );
  vec2 mgAB = mgDFG( material.roughness, mgNV );
  vec3 mgSp = material.specularColorBlended * mgAB.x + material.specularF90 * mgAB.y;
  float mgW = dot( mgSp, vec3( 0.2126, 0.7152, 0.0722 ) ) * ( 1.0 - smoothstep( 0.12, 0.42, material.roughness ) );
  float mgL = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
  mgW *= 1.0 - clamp( dot( totalEmissiveRadiance, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( mgL, 1e-4 ), 0.0, 1.0 );
  if ( mgW > 0.02 ) gl_FragColor.a = -clamp( mgW, 0.0, 1.0 );
}
#endif`);
  // glass reads the opaque scene behind it from the transmission target: a flagged pixel there is opaque
  C.transmission_fragment = C.transmission_fragment.replace(trA, '#ifdef MG_LS\n\ttransmitted.a = transmitted.a < 0.0 ? 1.0 : transmitted.a;\n\t#endif\n\t' + trA);
  return true;
}

/** a module registers its own lamp table: fn(camPos: Vector3) -> [{ x, y, z, range, power, near?, col? }] */
export function addLampSource(scene, fn) {
  if (scene) (scene.userData.mgLampSources ||= []).push(fn);
}

// ---------------------------------------------------------------- the renderer side
// three's WebGLShadowMap.render needs the state of a renderer.render call: it is wrapped once, and the armed
// LampShadows draws its cubes right after the scene's own shadows (the sun), inside the same render.
let ARMED = null;
function hookShadowMap(r) {
  const sm = r.shadowMap;
  if (sm.__mgLs) return;
  const orig = sm.render;
  sm.render = function (lights, scene, camera) {
    orig.call(this, lights, scene, camera);
    if (ARMED && ARMED.r === r && ARMED._pending) ARMED._drawPending(this, orig, scene, camera);
  };
  sm.__mgLs = true;
}
const OCT_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const OCT_FS = /* glsl */ `
varying vec2 vUv;
uniform samplerCube tCube;
uniform samplerCube tCubeD;
uniform float uDyn;
vec3 octDec(vec2 uv){
  vec2 o = uv * 2.0 - 1.0;
  vec3 d = vec3(o.x, -(1.0 - abs(o.x) - abs(o.y)), o.y);
  if (d.y > 0.0) d.xz = (1.0 - abs(d.zx)) * vec2(d.x >= 0.0 ? 1.0 : -1.0, d.z >= 0.0 ? 1.0 : -1.0);
  return normalize(d);
}
void main(){
  vec3 d = octDec(vUv);
  float v = textureCube(tCube, d).r;
  if (uDyn > 0.5) v = min(v, textureCube(tCubeD, d).r);
  gl_FragDepth = clamp(v, 0.0, 1.0);
  gl_FragColor = vec4(0.0);
}`;

export class LampShadows {
  /** cfg: LIGHT2_DEFAULTS.ls (on, refreshS, dynEvery, dayLevel, reach, near are read live; slots, tile, cube,
   *  perFrame at construction); lampLevel(): the world's lamp level (0 by day .. 1 at night); G: the world's
   *  uniforms (wind-swayed casters get a matching distance material) */
  constructor(renderer, cfg, lampLevel = () => 1, G = null) {
    this.r = renderer;
    this.cfg = cfg;
    this.lampLevel = lampLevel;
    this.G = G;
    this.slots = Math.max(1, Math.min(cfg.slots, LS_N));
    this.tile = cfg.tile; this.perFrame = cfg.perFrame;
    this.cols = 2; this.rows = Math.ceil(this.slots / 2);
    // off-scene PointLights, two per slot: the static casters (drawn when the slot takes a lamp, and every refreshS)
    // and the moving ones (redrawn round-robin); the fold keeps the nearer of the two
    const mk = () => {
      const l = new THREE.PointLight(0xffffff, 1, 8, 2);
      l.castShadow = true;
      l.shadow.camera.near = 0.16;
      l.shadow.autoUpdate = true;
      const rt = new THREE.WebGLCubeRenderTarget(cfg.cube, { type: THREE.HalfFloatType, format: THREE.RedFormat, generateMipmaps: false, depthBuffer: true });
      rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
      l.shadow.map = rt;
      l.shadow.mapSize.set(cfg.cube, cfg.cube);
      l.shadow.camera.updateProjectionMatrix();
      return l;
    };
    this.lights = []; this.lightsD = [];
    this.slot = [];
    for (let s = 0; s < this.slots; s++) {
      this.lights.push(mk()); this.lightsD.push(mk());
      this.slot.push({ key: '', x: 0, y: 0, z: 0, range: 0, near: 0.16, score: 0, valid: false, validS: false, validD: false, tS: 0 });
    }
    this.octMat = new THREE.ShaderMaterial({
      vertexShader: OCT_VS, fragmentShader: OCT_FS, uniforms: { tCube: { value: null }, tCubeD: { value: null }, uDyn: { value: 0 } },
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, colorWrite: false,
    });
    this.quad = new FullScreenQuad(this.octMat);
    this.rr = 0; this.fn = 0;
    this.top = [];
    this.stats = { slots: 0, drawn: 0, cands: 0, tris: 0 };
    this._cp = new THREE.Vector3(); this._v = new THREE.Vector3();
    this._plCache = null; this._plT = -1e9;
    this._dist = new Map();   // depth material -> its distance twin (wind-swayed casters)
    this._warned = false;
  }

  // every PointLight of the scene (rescanned every 2 s; a light removed since is dropped by the root check below)
  _pointLights(scene) {
    const now = performance.now();
    if (!this._plCache || now - this._plT > 2000) {
      const out = [];
      scene.traverse((o) => { if (o.isPointLight && !o.userData.mgClustered) out.push(o); });   // lights.js draws and shadows its own
      this._plCache = out; this._plT = now;
    }
    return this._plCache;
  }

  _candidates(scene, cp) {
    const c = [], v = this._v, cfg = this.cfg;
    // by day a PointLight is lost in the sunlight: no slot for it (registered sources keep theirs)
    if (this.lampLevel() >= cfg.dayLevel) {
      for (const l of this._pointLights(scene)) {
        if (!l.visible || l.intensity <= 0.02) continue;
        // visible all the way up, and still in this scene
        let p = l, vis = true;
        while (p.parent) { p = p.parent; if (!p.visible) { vis = false; break; } }
        if (!vis || p !== scene) continue;
        l.getWorldPosition(v);
        // distance 0 is three's "no cut-off": the shadow reaches where a decay-2 light falls to 1 % of 1 m
        const range = l.distance > 0 ? l.distance : Math.min(60, Math.sqrt(Math.max(l.intensity, 0) * 100));
        c.push({ id: l.uuid, x: v.x, y: v.y, z: v.z, range, power: l.intensity, near: l.userData.lsNear ?? cfg.near, col: [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity] });
      }
    }
    for (const fn of scene.userData.mgLampSources || []) {
      if (typeof fn !== 'function') continue;
      const a = fn(cp);
      if (a) for (const q of a) c.push({ ...q });
    }
    const out = [];
    for (const q of c) {
      if (!q.col) q.col = [q.power, q.power * 0.56, q.power * 0.25];
      if (!(q.near > 0)) q.near = cfg.near;
      if (!(q.range > q.near)) continue;
      const d = Math.hypot(q.x - cp.x, q.y - cp.y, q.z - cp.z);
      if (d > q.range + cfg.reach) continue;
      q.score = q.power * Math.min(1, q.range * 0.25) / (1 + (d / Math.max(4, q.range * 1.5)) ** 2);
      // a slot follows its lamp by identity (a PointLight's uuid, a source's id), else by position
      q.key = q.id != null ? String(q.id) : `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}`;
      out.push(q);
    }
    return out;
  }

  /** before the scene render: choose the slots, arm what is due, publish the uniforms.
   *  frame: { k: sub-frame index, still: a still frame of several sub-frames } (cube redraws then depend on k only) */
  update(scene, camera, frame = { k: 0, still: false }) {
    if (!this.cfg.on) { this.clear(); this.top = []; if (ARMED === this) ARMED = null; this._pending = null; return; }
    if (OWNER && OWNER !== this) {
      // one lamp-shadow atlas per page: a second light2 world gets no lamp shadows (its lamps still scatter)
      if (!this._warned) { this._warned = true; console.warn('[light2] another world on this page owns the lamp-shadow atlas: no lamp shadows here'); }
      this.clear(); this._pending = null;
      const cp = this._cp.setFromMatrixPosition(camera.matrixWorld);
      this.top = this._candidates(scene, cp).sort((a, b) => b.score - a.score).slice(0, VOL_LAMPS);
      for (const q of this.top) q.slotIdx = -1;
      return;
    }
    if (!OWNER) { OWNER = this; for (const s of this.slot) { s.valid = false; s.validS = false; s.validD = false; } }
    atlasFor(this.tile, this.cols, this.rows);
    const cp = this._cp.setFromMatrixPosition(camera.matrixWorld);
    const cand = this._candidates(scene, cp);
    this.stats.cands = cand.length;
    cand.sort((a, b) => b.score - a.score);
    this.top = cand.slice(0, VOL_LAMPS);
    // keep slots whose lamp is still a candidate (hysteresis 1.4x), fill the rest with the best new ones
    const byKey = new Map(cand.map((q) => [q.key, q]));
    const top = cand.slice(0, this.slots);
    const weakestTop = top.length ? top[top.length - 1].score : 0;
    const keep = new Set();
    for (const s of this.slot) {
      const q = s.key && byKey.get(s.key);
      if (q && (top.includes(q) || q.score * 1.4 > weakestTop)) {
        keep.add(q.key); s.score = q.score;
        // the lamp moved (2 cm) or its range / near plane changed: redraw (unpublished until then: lit, not wrong)
        if (Math.hypot(q.x - s.x, q.y - s.y, q.z - s.z) > 0.02 || Math.abs(q.range - s.range) > 1e-3 || Math.abs(q.near - s.near) > 1e-3) {
          Object.assign(s, { x: q.x, y: q.y, z: q.z, range: q.range, near: q.near, valid: false, validS: false, validD: false });
        }
      } else { s.key = ''; s.valid = false; s.validS = false; s.validD = false; }
    }
    let kept = keep.size;
    for (const q of cand) {
      if (kept >= this.slots) break;
      if (keep.has(q.key)) continue;
      const s = this.slot.find((t) => !t.key);
      if (!s) break;
      Object.assign(s, { key: q.key, x: q.x, y: q.y, z: q.z, range: q.range, near: q.near, score: q.score, valid: false, validS: false, validD: false });
      keep.add(q.key); kept++;
    }
    const now = performance.now() / 1000;
    const dynRoots = scene.children.filter((c) => c.visible && c.userData.mgDynamic);
    const stat = [], dyn = [], refold = [];
    const due = (i) => this.slot[i].key && !this.slot[i].validS;
    if (frame.still) {
      // a still frame: every due cube at once, and the moving casters at sub-frame 0 only (k decides, nothing else)
      for (let i = 0; i < this.slot.length; i++) if (due(i)) stat.push(i);
      if (frame.k === 0 && !stat.length) {
        let old = -1;
        for (let i = 0; i < this.slot.length; i++) if (this.slot[i].key && now - this.slot[i].tS > this.cfg.refreshS && (old < 0 || this.slot[i].tS < this.slot[old].tS)) old = i;
        if (old >= 0) stat.push(old);
      }
      if (dynRoots.length) for (let i = 0; i < this.slot.length; i++) if (this.slot[i].key && (stat.includes(i) || (frame.k === 0 && this.slot[i].validS))) dyn.push(i);
    } else {
      for (let i = 0; i < this.slot.length && stat.length < this.perFrame; i++) if (due(i)) stat.push(i);
      if (!stat.length) {
        let old = -1;
        for (let i = 0; i < this.slot.length; i++) if (this.slot[i].key && now - this.slot[i].tS > this.cfg.refreshS && (old < 0 || this.slot[i].tS < this.slot[old].tS)) old = i;
        if (old >= 0) stat.push(old);
      }
      this.fn++;
      if (dynRoots.length) {
        for (const i of stat) dyn.push(i);
        if (this.fn % Math.max(1, this.cfg.dynEvery) === 0)
          for (let k = 0; k < this.slot.length; k++) {
            const i = (this.rr + k) % this.slot.length;
            if (this.slot[i].key && this.slot[i].validS && !dyn.includes(i)) { dyn.push(i); this.rr = i + 1; break; }
          }
      }
    }
    // the last moving caster has gone: fold the slots again without its cube (else its shadow stays until a refresh)
    if (!dynRoots.length) for (let i = 0; i < this.slot.length; i++) if (this.slot[i].validD) { this.slot[i].validD = false; if (this.slot[i].validS) refold.push(i); }
    this.stats.drawn = stat.length + dyn.length;
    this._pending = stat.length || dyn.length || refold.length ? { scene, stat, dyn, refold, dynRoots, now } : null;
    for (const i of new Set([...stat, ...dyn])) {
      const s = this.slot[i];
      for (const l of [this.lights[i], this.lightsD[i]]) {
        l.position.set(s.x, s.y, s.z); l.distance = s.range; l.updateMatrixWorld(true);
        if (l.shadow.camera.near !== s.near) { l.shadow.camera.near = s.near; l.shadow.camera.updateProjectionMatrix(); }
      }
    }
    hookShadowMap(this.r);
    ARMED = this;
    this._publish();
  }

  // wind-swayed casters: a distance material with the same vertex hooks as their depth material (else the cubes
  // see them in their rest pose); made once per depth material
  _distanceTwins(roots) {
    if (!this.G) return;
    for (const root of roots) root.traverse((o) => {
      const dm = o.customDepthMaterial;
      if (!dm || o.customDistanceMaterial || !dm.userData.hooks || !dm.userData.hooks.vertexWorld) return;
      let m = this._dist.get(dm);
      if (!m) {
        m = patch(new THREE.MeshDistanceMaterial({ map: dm.map, alphaMap: dm.alphaMap, alphaTest: dm.alphaTest, side: dm.side }),
          { vertexDecl: dm.userData.hooks.vertexDecl, vertexWorld: dm.userData.hooks.vertexWorld }, this.G);
        this._dist.set(dm, m);
      }
      o.customDistanceMaterial = m;
    });
  }

  // inside renderer.render, after the sun's shadow map: the due cubes, folded into the atlas
  _drawPending(sm, orig, scene, camera) {
    const pend = this._pending;
    this._pending = null;
    if (!pend || pend.scene !== scene || !sm.enabled) return;   // shadow maps off: three would draw nothing
    const r = this.r, atlas = ATLAS;
    const prevNU = sm.needsUpdate, prevAU = sm.autoUpdate;
    const t0 = r.info.render.triangles;
    const kids = scene.children, vis = kids.map((c) => c.visible);
    const skip = (c) => c.userData.mgLampCast === false;
    if (pend.stat.length) {
      kids.forEach((c, k) => { c.visible = vis[k] && !skip(c) && !pend.dynRoots.includes(c); });
      this._distanceTwins(kids.filter((c) => c.visible));
      sm.needsUpdate = true; sm.autoUpdate = true;
      orig.call(sm, pend.stat.map((i) => this.lights[i]), scene, camera);
      for (const i of pend.stat) { this.slot[i].validS = true; this.slot[i].tS = pend.now; }
    }
    if (pend.dyn.length) {
      kids.forEach((c, k) => { c.visible = vis[k] && pend.dynRoots.includes(c); });
      this._distanceTwins(pend.dynRoots);
      sm.needsUpdate = true; sm.autoUpdate = true;
      orig.call(sm, pend.dyn.map((i) => this.lightsD[i]), scene, camera);
      for (const i of pend.dyn) this.slot[i].validD = true;
    }
    kids.forEach((c, k) => { c.visible = vis[k]; });
    sm.needsUpdate = prevNU; sm.autoUpdate = prevAU;
    this.stats.tris = r.info.render.triangles - t0;
    const prevRT = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel(), prevAuto = r.autoClear;
    r.autoClear = false;
    for (const i of new Set([...pend.stat, ...pend.dyn, ...pend.refold])) {
      if (!this.slot[i].validS) continue;
      const cx = i % this.cols, cy = Math.floor(i / this.cols);
      atlas.viewport.set(cx * this.tile, cy * this.tile, this.tile, this.tile);
      const u = this.octMat.uniforms;
      u.tCube.value = this.lights[i].shadow.map.texture;
      u.tCubeD.value = this.lightsD[i].shadow.map.texture;
      // the moving casters' cube only once it was drawn for this lamp (an undrawn cube would read as all shadow)
      u.uDyn.value = this.slot[i].validD ? 1 : 0;
      r.setRenderTarget(atlas);
      this.quad.render(r);
      this.slot[i].valid = true;
    }
    atlas.viewport.set(0, 0, atlas.width, atlas.height);
    r.setRenderTarget(prevRT, prevFace, prevMip);
    r.autoClear = prevAuto;
    this._publish();
  }

  _publish() {
    const P = LS_SHARED.pos;
    let n = 0, hi = 0;
    for (let i = 0; i < LS_N; i++) {
      const s = this.slot[i];
      if (s && s.key && s.valid) { P[i * 4] = s.x; P[i * 4 + 1] = s.y; P[i * 4 + 2] = s.z; P[i * 4 + 3] = s.range; LS_SHARED.near[i] = s.near; n++; hi = i + 1; }
      else { P[i * 4] = 0; P[i * 4 + 1] = -1e4; P[i * 4 + 2] = 0; P[i * 4 + 3] = 0; }
    }
    const I = LS_SHARED.info;
    I[1] = 1 / this.cols; I[2] = 1 / this.rows; I[3] = 1 / this.tile;
    LS_SHARED.info2[0] = hi;   // 0 by day (no lamp holds a slot): lit programs skip the lookup
    this.stats.slots = n;
    for (const q of this.top) q.slotIdx = this.slot.findIndex((t) => t.key === q.key && t.valid);
  }

  /** the scene render of this sub-frame is over: disarm */
  done() { if (ARMED === this) ARMED = null; this._pending = null; }

  /** publish no slot */
  clear() { lampShadowsIdle(); }

  dispose() {
    this.done();
    if (OWNER === this) {
      OWNER = null; this.clear();
      // the renderers drop their GL objects and listeners; the next owner (or a later use) allocates them again
      if (ATLAS) { ATLAS.dispose(); LS_SHARED.atlas.dispose(); }
    }
    for (const l of [...this.lights, ...this.lightsD]) { l.shadow.map.dispose(); l.dispose(); }
    for (const m of this._dist.values()) m.dispose();
    this._dist.clear();
    this.octMat.dispose(); this.quad.dispose();
  }
}

/** a world without lamp shadows draws next: no slot is published (the uniforms are page-global) */
export function lampShadowsIdle() {
  if (!installed) return;
  LS_SHARED.pos.fill(0); LS_SHARED.info2[0] = 0;
  for (let i = 0; i < LS_N; i++) LS_SHARED.pos[i * 4 + 1] = -1e4;
}

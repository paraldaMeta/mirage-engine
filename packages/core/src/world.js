// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { createEnv } from './env.js';
import { installFog, FOG, retainChunks, releaseChunks } from './fog.js';
import { createSky, createSkyUniforms, createSkyLut } from './sky.js';
import { createStars } from './stars.js';
import { skyState, lightAt } from './daynight.js';
import { Pipeline, DEFAULT_POST } from './post.js';
import { installLight2, light2Config } from './light2.js';
import { installSoftShadows, softShadowConfig, softShadowUniforms, softShadowsIdle } from './softshadow.js';
import { createMaterials } from './materials.js';
import { wetVersion } from './wet.js';
import { createEnvLight } from './envlight.js';
import { deviceProfile } from './device.js';
import { byteTargets } from './byte-targets.js';
import * as geom from './geom.js';
import { rng } from './rng.js';
import { createLighting } from './lighting.js';
import { lampPoolConfig, createLampPool } from './lamppool.js';

// ---------------------------------------------------------------------------
// createWorldRenderer(config): one world = renderer + scene + sky + key light + fog + pipeline + day/night,
// all from a config object (see README.md for every field). Build the world into `world.scene` with
// `world.mat` / `world.geom` / `world.rng`, `await world.prepare()`, then `world.renderFrame(T)` per frame.
// ---------------------------------------------------------------------------

const QUALITY = {
  high: { shadowMap: 4096, aoSamples: 12, spp: 4, envSize: 256 },
  medium: { shadowMap: 2048, aoSamples: 8, spp: 4, envSize: 256 },
  low: { shadowMap: 2048, aoSamples: 8, spp: 2, envSize: 128 },
};

// sub-frame patterns: functions of (k, spp) only — never of the frame number (no flicker on still views)
const R2 = [0.7548776662466927, 0.5698402909980532];          // Roberts' R2 low-discrepancy sequence
const aaOffset = (k) => [((0.5 + R2[0] * k) % 1) * 2 - 1, ((0.5 + R2[1] * k) % 1) * 2 - 1];   // pixels, 2-px footprint
function aaWeights(spp) {
  if (spp === 1) return [1];
  const w = Array.from({ length: spp }, (_, k) => { const [x, y] = aaOffset(k); return Math.exp(-(x * x + y * y) / (2 * 0.5 * 0.5)); });
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// shutter slot of sub-frame k: a stride coprime with spp decorrelates time from the AA offset
const shutterSlot = (k, spp) => { let p = 3; while (gcd(p, spp) !== 1) p += 2; return (k * p + 1) % spp; };

/** dynamicRes option -> settings or null: true or { target fps = 60, min scale = 0.6, step = 0.1 } */
export function dynamicResConfig(c) {
  if (!c) return null;
  const o = c === true ? {} : c;
  const n = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { target: n(o.target, 60, 10, 240), min: n(o.min, 0.6, 0.25, 1), step: n(o.step, 0.1, 0.02, 0.5) };
}

/** reducedMotion option -> settings or null: true or { sway = 0.25, rain = 0.4 } (the wind sway's and the rain's
 *  speed scales, 0..1); with it, renderFrame's default shutter is 0 (no motion blur in still frames) */
export function reducedMotionConfig(c) {
  if (!c) return null;
  const o = c === true ? {} : c;
  const n = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  return { sway: n(o.sway, 0.25), rain: n(o.rain, 0.4) };
}

export function createWorldRenderer(config = {}) {
  const {
    canvas, width = canvas?.clientWidth || 1280, height = canvas?.clientHeight || 720, pixelRatio = 1,
    quality = 'high', place: placeIn, time = 'golden',
    shadow = { center: [0, 0, 0], radius: 30 }, envProbe = [0, 3, 0], envIntensity = 0.5, wind, clouds = 0.35,
  } = config;
  // a partial place ({ lat: 35 }) keeps the other defaults instead of lighting the world with NaN
  const place = { lat: 0, lon: 0, height: 0, tzHours: 0, ...placeIn };
  const Q = QUALITY[quality] || QUALITY.high;
  const fogCfg = { density: 1, groundDensity: 0.0016, height: 18, air: 0.00012, level: 0, color: 1, glow: 1, ...config.fog };
  const post = { ...DEFAULT_POST, ...config.post };

  retainChunks();   // three's chunk table is page-global: dispose() gives it back with the last world (fog.js)
  installFog();
  // light2 (lamp shadows, reflections, volumetric light, mixed bloom): opt-in, patched before any material compiles
  let l2cfg = light2Config(config.light2);
  if (l2cfg && !installLight2()) l2cfg = null;
  // soft sun shadows (contact-hardening, per pixel; softshadow.js): opt-in, patched before any material compiles
  let sscfg = softShadowConfig(config.softShadows);
  if (sscfg && !installSoftShadows(sscfg)) sscfg = null;
  // [xr] config.xr: the context is made multisampled and XR-compatible, because three gives the headset's framebuffer
  // MSAA only when the canvas context has it (packages/play/src/xr.js); the pipeline never draws geometry to the canvas
  const renderer = config.renderer || new THREE.WebGLRenderer({ canvas, antialias: !!config.xr, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!config.preserveDrawingBuffer, ...(config.xr ? { xrCompatible: true } : {}) });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const device = deviceProfile(renderer, { force: !!config.mobile });
  device.byteTargets = byteTargets(renderer, !!config.byteTargets);   // no float render targets on this context: 8-bit ones, not a black canvas

  const env = createEnv({ wind });
  const { G, keyDir } = env;
  const scene = new THREE.Scene();
  scene.environmentIntensity = envIntensity;
  scene.fog = new THREE.FogExp2(0x8899aa, fogCfg.density);   // FogExp2 switches on Mirage's aerial perspective
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
  const skyU = createSkyUniforms();
  const skyLut = createSkyLut(renderer, skyU);   // the sky's air, baked per setTime instead of marched per pixel
  skyU.uCloudCover.value = clouds;
  const sky = createSky(skyU);
  const stars = createStars(skyU);
  scene.add(sky, stars);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(config.shadowMapSize || Q.shadowMap);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.02; sun.shadow.radius = 1;
  scene.add(sun, sun.target);
  // realtime lighting features (opt-in, lighting.js): cascades, probe GI, reflection probes, clustered local lights
  const lighting = config.lighting ? createLighting({ renderer, scene, sun, G, keyDir, quality, Q, soft: sscfg, envProbe, capture: lightCapture, skyVisible: (v) => { sky.visible = v; } }, config.lighting) : null;
  // the lamp pool (opt-in, lamppool.js): every lamp lights its surroundings, beyond the few real PointLights
  const lpcfg = lampPoolConfig(config.lampPool);
  const lampPool = lpcfg ? createLampPool({ renderer, scene, G, injector: lighting && lighting.injector, light2: l2cfg }, lpcfg) : null;

  const pipeline = new Pipeline(renderer, { width: width * pixelRatio, height: height * pixelRatio, msaa: device.msaa, aoSamples: Q.aoSamples });
  if (l2cfg) pipeline.useLight2(l2cfg, { sun, G });
  if (lighting && lighting.screen) pipeline.screen = lighting.screen;
  // dynamic resolution (opt-in, moving frames only): the pipeline renders at resScale x the canvas and the grade pass
  // stretches it; still frames always render at full size, so they stay bit-identical
  const dynRes = dynamicResConfig(config.dynamicRes);
  let resScale = 1;
  const dr = { last: 0, ema: 0, hold: 0, good: 0, wait: 2000, raisedAt: -1e9, lowered: null, clock: 0 };
  // the output size (pipeline.w / h) never changes with the scale: play keys its redraws, fades and aspect on it
  function fitPipeline(s) { if (pipeline.setRenderScale(s)) taaValid = false; }
  // the interval between moving frames drives it: over budget -> one step down; at budget for `wait` -> try one step
  // up (a step up that is undone within 2 s doubles the wait, up to 32 s); a step down that did not help (the frame
  // is limited by the CPU, not by pixels) is undone and the scaler rests for 30 s
  function dynamicStep(now) {
    const ms = dr.last ? now - dr.last : 0; dr.last = now;
    if (!ms || ms > 250) { dr.ema = 0; return; }   // the first frame, or after a pause (a hidden tab, a still view)
    dr.ema = dr.ema ? dr.ema + (ms - dr.ema) * 0.1 : ms;
    dr.clock += ms; dr.hold -= ms;
    if (dr.hold > 0) return;
    // cap: the app's own frame cap (play sets it from maxFps / the power saver); a capped app's interval says nothing
    // about the GPU, so the budget is never tighter than the cap
    const budget = 1000 / Math.min(dynRes.target, dynRes.cap || Infinity);
    if (dr.lowered) {
      const { from, ema } = dr.lowered; dr.lowered = null;
      if (dr.ema > ema * 0.97) { resScale = from; dr.hold = 30000; dr.ema = 0; return; }
    }
    if (dr.ema > budget * 1.12 && resScale > dynRes.min + 1e-6) {
      if (dr.clock - dr.raisedAt < 2000) dr.wait = Math.min(dr.wait * 2, 32000);
      dr.lowered = { from: resScale, ema: dr.ema };
      resScale = Math.max(dynRes.min, +(resScale - dynRes.step).toFixed(3)); dr.hold = 700; dr.good = 0; dr.ema = 0;
    } else if (dr.ema < budget * 1.03 && resScale < 1) {
      dr.good += ms;
      if (dr.good > dr.wait) { resScale = Math.min(1, +(resScale + dynRes.step).toFixed(3)); dr.raisedAt = dr.clock; dr.hold = 700; dr.good = 0; dr.ema = 0; }
    } else dr.good = 0;
  }
  const mat = createMaterials(G);
  let updates = [];   // replaced, never mutated, by subscribe / unsubscribe: a callback may unsubscribe during the frame
  // reduced motion (opt-in; @miragekit/play follows prefers-reduced-motion): the wind's strength is scaled while a frame
  // renders (every sway reads uWind.z: no shader changes, so with it off the images are the same), kits read
  // `motion` (the rain kit's fall speed), and the still path's shutter closes
  let reduced = reducedMotionConfig(config.reducedMotion);
  const motion = { reduced: !!reduced, sway: reduced ? reduced.sway : 1, rain: reduced ? reduced.rain : 1 };
  function setReducedMotion(option) {
    reduced = reducedMotionConfig(option);
    Object.assign(motion, { reduced: !!reduced, sway: reduced ? reduced.sway : 1, rain: reduced ? reduced.rain : 1 });
    return reduced;
  }
  const calm = (fn) => {
    if (!reduced) return fn();
    const w = G.uWind.value, z = w.z;
    w.z = z * reduced.sway;
    try { return fn(); } finally { w.z = z; }
  };
  const envLight = createEnvLight(renderer, { size: Q.envSize, fade: config.envFade ?? 1.5 });
  // envState: 'instant' = recapture (two passes) before the next frame; 'fade' = one capture + cross-fade in tick()
  let envState = 'instant', light = null, state = null, frameCounter = 0, exposure = 1, expTarget = 1;
  const lastCap = { dir: new THREE.Vector3(), lamp: -1, sky: -1 };
  // temporal AA state (moving camera): history validity, previous view-projection, jitter index.
  // ponytail: TAA rather than supersampling while moving: 4 sub-frames cost 4x (~3.4 ms each at 1440x900) and
  // still crawl on thin edges; TAA is one extra full-screen pass. Still views keep the exact sub-frame average.
  let taaValid = false, taaK = 0, lastMoving = 0, seenWet = wetVersion();
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(), invVP = new THREE.Matrix4();

  const setLampGain = () => { G.uLampGain.value = light.lamp * Math.pow(exposure, -0.9); };

  /** time: see README. { ease: true } for a running clock: exposure adapts over ~1 s, the image-based light is
   *  recaptured only when the light changed enough and cross-fades in tick(dt). Without it everything snaps. */
  function setTime(t, { ease = false } = {}) {
    state = skyState(t, place);
    light = lightAt(state);
    const L = light;
    keyDir.fromArray(L.keyDir).normalize();
    G.uKeyDir.value.copy(keyDir);
    G.uKeyColor.value.fromArray(L.keyRGB);
    const I = Math.max(...L.keyRGB, 1e-6);
    sun.color.setRGB(L.keyRGB[0] / I, L.keyRGB[1] / I, L.keyRGB[2] / I);
    sun.intensity = L.keyOn ? I : 0;
    skyU.uSunDir.value.fromArray(state.sun.dir); skyU.uSunI.value = L.sunSkyI;
    if (state.moon) skyU.uMoonDir.value.fromArray(state.moon.dir);
    skyU.uMoonI.value = L.moonSkyI; skyU.uMoonDisc.value = L.moonDisc; skyU.uMoonR.value = L.moonR;
    skyU.uNightGlow.value.fromArray(L.nightGlow).multiplyScalar(state.eqToWorld ? 1 : 0);
    skyU.uStarVis.value = L.starVis;
    if (L.eqToWorld) skyU.uEq.value.set(...L.eqToWorld);
    skyLut.bake();
    G.uLamp.value = L.lamp; G.uSkyLight.value = L.skyLight; G.uNight.value = L.night;
    expTarget = L.exposure;
    if (!ease) { exposure = expTarget; envState = 'instant'; }
    else if (envState !== 'instant') {
      const moved = keyDir.angleTo(lastCap.dir) > 0.5 * Math.PI / 180;
      if (moved || Math.abs(L.lamp - lastCap.lamp) > 0.03 || Math.abs(Math.log((L.skyLight + 1e-4) / (lastCap.sky + 1e-4))) > 0.04) envState = 'fade';
    }
    setLampGain();
    return L;
  }

  /** Advance eased exposure and the environment cross-fade by dt seconds. Returns true while anything changes. */
  function tick(dt) {
    let busy = false;
    // setWetness / setRain (page-global): a wetness change recaptures the environment from scratch (the capture
    // carries its previous self as the bounce, so a fresh one makes setWetness(0) give the dry image exactly); any
    // change asks the caller to draw again
    const wv = wetVersion();
    if (wv.wet !== seenWet.wet || wv.rain !== seenWet.rain) {
      if (wv.wet !== seenWet.wet && light) { scene.environment = null; envState = 'instant'; }
      seenWet = wv; busy = true;
    }
    if (light && Math.abs(Math.log(expTarget / exposure)) > 1e-4) {
      exposure = Math.exp(Math.log(exposure) + Math.log(expTarget / exposure) * Math.min(1, dt * 3));
      setLampGain(); busy = true;
    }
    if (envState === 'fade' && !envLight.fading) captureEnv(false);
    return envLight.tick(dt) || busy || envState === 'fade' || !!(lighting && lighting.busy);
  }

  function writeFog() {
    // three's fog chunks are page-global: every world writes its own state before it draws
    const L = light;
    FOG.params.set([fogCfg.groundDensity, fogCfg.height, fogCfg.air, fogCfg.level]);
    FOG.light.set([L.glowDir[0], L.glowDir[1], L.glowDir[2], 0.76]);
    FOG.glow.set(L.glow.map((v) => v * fogCfg.glow));
    scene.fog.color.setRGB(L.fog[0] * fogCfg.color, L.fog[1] * fogCfg.color, L.fog[2] * fogCfg.color);
    scene.fog.density = fogCfg.density;
  }

  const _sd = new THREE.Vector3(), _sr = new THREE.Vector3(), _su = new THREE.Vector3(), _sc = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);   // per-frame scratch
  const _pm = new Array(16).fill(0), _pos = new THREE.Vector3(), _lens = new THREE.Vector3();
  function fitShadow(center, radius, jitter, k = 0, view = null) {
    const d = _sd.copy(keyDir);
    if (jitter) {
      const right = _sr.crossVectors(d, Math.abs(d.y) > 0.99 ? _X : _Y).normalize();
      const up = _su.crossVectors(right, d);
      d.addScaledVector(right, jitter[0]).addScaledVector(up, jitter[1]).normalize();
    }
    const c = _sc.fromArray(center), D = radius * 3;
    sun.position.copy(c).addScaledVector(d, D);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -radius; cam.right = cam.top = radius;
    cam.near = Math.max(0.5, D - 2 * radius); cam.far = D + 2 * radius;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    softShadowUniforms(sscfg, cam, sun.shadow.mapSize, k);
    if (lighting) lighting.fitSun(d, view, center, radius, k);
  }

  function captureEnv(instant = true) {
    // image-based light: a PMREM of the sky AND the built world from the probe point (envlight.js). A snap
    // captures twice so the second pass already holds one bounce of the first; a fade captures once (the
    // scene still shows the previous light, which is the bounce).
    writeFog();
    fitShadow(shadow.center, shadow.radius, null);
    stars.visible = false; skyU.uCapture.value = 1;
    // objects marked userData.mgNoCapture (the rain kit's streaks) stay out of the image-based light
    const hidden = [];
    scene.traverse((o) => { if (o.userData.mgNoCapture && o.visible) { o.visible = false; hidden.push(o); } });
    for (let pass = 0; pass < (instant ? 2 : 1); pass++) {
      envLight.capture(scene, envProbe, { instant });
      scene.environment = envLight.texture;
    }
    stars.visible = true; skyU.uCapture.value = 0;
    for (const o of hidden) o.visible = true;
    softShadowsIdle();
    lastCap.dir.copy(keyDir); lastCap.lamp = light.lamp; lastCap.sky = light.skyLight;
    if (lighting) lighting.envCaptured(instant);
    envState = null;
  }

  // a probe capture of lighting.js: the scene as captureEnv draws it, the sun's shadow drawn once for all of fn's renders
  function lightCapture(fn) {
    writeFog();
    fitShadow(shadow.center, shadow.radius, null);
    const hidden = [], sm = renderer.shadowMap, auto = sm.autoUpdate;
    scene.traverse((o) => { if ((o.userData.mgNoCapture || (o.userData.mgDynamic && o.parent === scene)) && o.visible) { o.visible = false; hidden.push(o); } });
    stars.visible = false; skyU.uCapture.value = 1; sm.autoUpdate = false; sm.needsUpdate = true;
    try { return fn(); } finally {
      stars.visible = true; skyU.uCapture.value = 0; sm.autoUpdate = auto;
      for (const o of hidden) o.visible = true;
      softShadowsIdle();
    }
  }

  /** Compile every program the first frames need, capture the environment. { warm: true } (opt-in) also draws one
   *  frame and waits for the GPU (see warmUp); returns { warmMs } then. */
  async function prepare({ warm = false } = {}) {
    if (!light) setTime(time);
    scene.environment = null;
    camera.updateMatrixWorld();
    // Programs are compiled here in parallel (KHR_parallel_shader_compile); any program the first frames need that
    // is not ready is compiled one after another on the main thread instead, ~50 ms each on a cold start. Two things
    // decide which programs those are: the target (three keys a program on its output colour space: the screen is
    // sRGB, the pipeline's half-float targets and the capture cube are linear) and the environment (a lit material
    // with scene.environment set is another program). So compile against a pipeline target, once without the
    // environment (the first capture pass) and once with it; a throwaway capture makes the texture exist, and the
    // real capture below starts again from no environment, so the image is the same as before.
    const compile = () => { const saved = renderer.getRenderTarget(); renderer.setRenderTarget(pipeline.sceneRT); const p = renderer.compileAsync(scene, camera); renderer.setRenderTarget(saved); return p; };
    await Promise.all([compile(), pipeline.compileAsync()]);
    if (!envLight.texture) {
      envLight.capture(scene, envProbe, { instant: true });
      scene.environment = envLight.texture;
      await compile();
      scene.environment = null;
    }
    if (lighting) lighting.adopt();
    if (lampPool) lampPool.adopt();
    if (lighting || lampPool) await compile();
    captureEnv(true);
    if (warm) return { warmMs: warmUp() };
  }

  // Warm-up (prepare({ warm: true })): compileAsync links the programs, but the first frame that uses them still pays
  // the rest inside the driver: texture uploads (and an <img>'s decode), the shadow map's first allocation, the
  // pipeline targets' first clears, the first draw of each program. One discarded still frame (one sub-frame, the
  // same programs and output as a visible frame) followed by a 1-px readback pays all of it here, under the loading
  // screen. Then the canvas is cleared and the per-frame histories are put back, so the next frame is drawn exactly
  // as without the warm-up (still frames have no history; the moving ones restart theirs, as after a pause).
  function warmUp() {
    const t0 = performance.now(), fc = frameCounter;
    renderFrame(0, { spp: 1, frameIndex: 0 });
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const cc = new THREE.Color(), ca = renderer.getClearAlpha();
    renderer.getClearColor(cc); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, true); renderer.setClearColor(cc, ca);
    frameCounter = fc; taaValid = false; lastMoving = 0; dr.last = 0; dr.ema = 0;
    pipeline.resetExposure();
    return +(performance.now() - t0).toFixed(1);
  }

  /** Render the frame at time T (seconds). opts: { camera, getCamera(t), spp, dt, shutter, frameIndex, target, shadow,
   *  taa: true | alpha } — taa: one jittered sub-frame resolved against the reprojected history (moving cameras) */
  function renderFrame(T = 0, opts = {}) {
    let converge = null;
    calm(() => {
      const P = accumulate(T, opts);
      pipeline.end(P, opts.frameIndex ?? frameCounter++, opts.target ?? null, { dt: opts.taa ? (opts.dt ?? P.frameDt) : 0, still: !opts.taa });
      converge = P.converge;
    });
    softShadowsIdle();   // host scenes drawn after this world see the stock path
    if (converge) return converge;   // { spp, of, diffs } with opts.converge
  }

  // the sub-frames of one frame into the pipeline's accumulation (renderFrame, renderTransparent); returns the post
  // settings of the frame (with frameDt: the seconds since the last moving frame)
  function accumulate(T, opts) {
    if (!light) setTime(time);
    if (envState === 'instant') captureEnv(true);
    let spp = opts.spp ?? config.spp ?? Q.spp;
    const taa = !!opts.taa;
    if (taa) spp = 1; else taaValid = false;
    const dt = opts.dt ?? 1 / 60, shutter = opts.shutter ?? (reduced ? 0 : 0.5);
    const sh = opts.shadow || shadow;
    const P = { ...post, exposure: post.exposure * exposure, temperature: post.temperature + light.warmth };
    if (P.autoExposure > 0) P.aeKey = post.aeKey * Math.pow(2, -(post.aeNight || 0) * Math.min(1, Math.max(0, light.lamp)));
    const now = performance.now();
    // the seconds since the last moving frame, for auto exposure (still frames are metered on their own)
    const frameDt = taa ? (lastMoving ? Math.min((now - lastMoving) / 1000, 0.25) : 1 / 60) : 0;
    lastMoving = taa ? now : 0;
    if (dynRes) {
      if (taa) dynamicStep(now); else dr.last = 0;
      const rs = Math.min(resScale, dynRes.max ?? 1);   // max: a ceiling a governor may lower (platform.js); unset = 1
      fitPipeline(taa ? rs : 1);
      if (taa && rs < 1) P.sharpen = post.sharpen + (1 - rs) * 0.6;   // the stretch softens: sharpen a little more
    } else if (post.upscale > 0 || pipeline.renderScale !== 1) {
      // post.upscale: render smaller and let taa2 reconstruct the output size (moving frames only)
      fitPipeline(taa && post.taa2 > 0 && post.upscale > 0 ? Math.min(1, Math.max(0.5, post.upscale)) : 1);
    }
    writeFog();
    const W = aaWeights(spp);
    const w = pipeline.rw, h = pipeline.rh;   // the render size: sub-pixel jitter is in its pixels
    // converge (still frames, spp >= 8): every spp / 4 sub-frames compare the estimate with the one before; once the
    // mean change is <= converge (display levels 0..255, true = 0.25) stop and grade what is there. The sub-frames
    // drawn are the first ones of the full pattern, so the frame is the same frame with fewer samples (a smaller
    // penumbra and AA footprint until the pattern fills in). Off (the default): nothing below runs.
    const on = opts.converge !== undefined && opts.converge !== null && opts.converge !== false;   // 0 = stop only when nothing moves
    const cv = !taa && spp >= 8 && on ? { tol: opts.converge === true ? 0.25 : +opts.converge, every: Math.floor(spp / 4), wsum: 0, diffs: [], used: spp } : null;
    if (lighting) lighting.frame(opts.getCamera ? opts.getCamera(T) : opts.camera || camera, taa ? frameDt : 0);
    pipeline.begin();
    for (let k = 0; k < spp; k++) {
      const tk = T + (spp > 1 ? ((shutterSlot(k, spp) + 0.5) / spp - 0.5) * shutter * dt : 0);
      G.uTime.value = tk; G.uFrame.value = k;
      skyU.uCloudOffset.value.set(tk * 0.004, tk * 0.0015);
      for (const fn of updates) fn(tk);
      const cam = opts.getCamera ? opts.getCamera(tk) : opts.camera || camera;
      cam.updateMatrixWorld();
      const pm = cam.projectionMatrix.elements, saved = _pm, savedPos = _pos.copy(cam.position);
      for (let i = 0; i < 16; i++) saved[i] = pm[i];
      if (taa) curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);   // unjittered, for reprojection
      const o = cam.isOrthographicCamera ? 12 : 8;
      if (spp > 1 || taa) {
        // AA: a 2-px footprint across the sub-frames; a 1-px one across the frames of temporal AA
        const j = taa ? aaOffset((taaK = (taaK + 1) % 16)) : aaOffset(k), js = taa ? 0.5 : 1;   // (no .map: no array per frame; x0.5 and x2 are exact)
        let jx = j[0] * js, jy = j[1] * js;
        if (taa && P.taa2 > 0) [jx, jy] = pipeline.fxJitter();   // post.taa2: its own sequence (postfx.js)
        pm[o] += (2 * jx) / w; pm[o + 1] += (2 * jy) / h;
      }
      if (spp > 1 && P.dof > 0 && cam.isPerspectiveCamera) {
        // thin lens: move the eye over the aperture (Vogel spiral) and shear the frustum so the focus plane stays
        const r = Math.sqrt((k + 0.5) / spp) * P.dof, th = k * 2.39996323 + 1.1;
        const dx = r * Math.cos(th), dy = r * Math.sin(th);
        cam.position.add(_lens.set(dx, dy, 0).applyQuaternion(cam.quaternion));
        cam.updateMatrixWorld();
        pm[8] -= (pm[0] * dx) / P.focus; pm[9] -= (pm[5] * dy) / P.focus;
      }
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      // soft shadows: the light moves over the solar disc (Vogel spiral, 0.27° radius); with softShadows on, the
      // sun stays put and each pixel takes its own penumbra (pattern rotated by the sub-frame / TAA index)
      const r = spp > 1 && !sscfg?.on ? Math.sqrt((k + 0.5) / spp) * 0.0047 : 0, th = k * 2.39996323 + 0.5;
      fitShadow(sh.center, sh.radius, r ? [r * Math.cos(th), r * Math.sin(th)] : null, taa ? taaK : k, cam);
      pipeline.add(scene, cam, W[k], k, P, taa ? taaK : k, !taa && spp > 1);
      if (taa) {
        pipeline.taa(invVP.copy(curVP).invert(), prevVP, taaValid ? (typeof opts.taa === 'number' ? opts.taa : 0.12) : 1);
        prevVP.copy(curVP); taaValid = true;
      }
      for (let i = 0; i < 16; i++) pm[i] = saved[i];
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      if (!cam.position.equals(savedPos)) { cam.position.copy(savedPos); cam.updateMatrixWorld(); }
      if (cv) {
        cv.wsum += W[k];
        if ((k + 1) % cv.every === 0 && k + 1 < spp) {
          const d = pipeline.converge(cv.wsum, P.exposure, k + 1 === cv.every);
          if (d !== null) cv.diffs.push(+d.toFixed(3));
          if (d !== null && d <= cv.tol) { pipeline.scaleAccumulation(1 / cv.wsum); cv.used = k + 1; break; }
        }
      }
    }
    P.frameDt = frameDt;
    P.converge = cv ? { spp: cv.used, of: spp, diffs: cv.diffs } : null;   // adaptive spp (opts.converge): what it used
    return P;
  }

  /** A still with a transparent sky: the frame rendered twice, over black and over white (sky and stars hidden), and
   *  straight alpha recovered per pixel from the two linear sums (pipeline.endClear). opts: renderFrame's (still path:
   *  spp, shutter, frameIndex, camera, shadow). Returns { width, height, data } (RGBA8, straight alpha, top row first).
   *  The object's own bloom is kept (the sky's glow over it is not); no auto exposure. */
  function renderTransparent(T = 0, opts = {}) {
    const o = { ...opts, taa: false, target: null, converge: false }, hidden = [sky, stars].filter((m) => m.visible);
    for (const m of hidden) m.visible = false;
    const w = pipeline.w, h = pipeline.h, rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    const data = new Uint8Array(w * h * 4), K = 1;
    const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();   // the white pass leaves white
    try {
      calm(() => {
        pipeline.clearColor = 0;
        const P = accumulate(T, o);
        pipeline.keepBlack(P);
        pipeline.clearColor = K;
        accumulate(T, o);
        pipeline.endClear(P, opts.frameIndex ?? frameCounter++, rt, K);
      });
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, data);
    } finally {
      pipeline.clearColor = null;
      renderer.setClearColor(clear, clearAlpha);
      for (const m of hidden) m.visible = true;
      rt.dispose();
      softShadowsIdle();
    }
    const out = new Uint8Array(data.length), row = w * 4;   // GL rows run bottom-up
    for (let y = 0; y < h; y++) out.set(data.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { width: w, height: h, data: out };
  }

  // [xr] one plain draw of the scene into the current framebuffer (the headset's, inside an XR frame; see
  // packages/play/src/xr.js): renderFrame's frame state (scene clock, ctx.onUpdate, fog, shadow fit), none of the
  // pipeline. The renderer's tone mapping does the grade. A pending environment capture runs with XR off (its
  // full-screen passes would otherwise be drawn through the headset's cameras).
  function renderDirect(T = 0, opts = {}) { calm(() => direct(T, opts)); }
  function direct(T, opts) {
    if (!light) setTime(time);
    if (envState === 'instant') { const xe = renderer.xr.enabled; renderer.xr.enabled = false; try { captureEnv(true); } finally { renderer.xr.enabled = xe; } }
    writeFog();
    if (opts.fog !== undefined) scene.fog.density *= opts.fog;   // AR: a table model is seen through metres of air, not km
    G.uTime.value = T; G.uFrame.value = 0;
    skyU.uCloudOffset.value.set(T * 0.004, T * 0.0015);
    for (const fn of updates) fn(T);
    const sh = opts.shadow || shadow;
    if (lighting) lighting.frame(opts.camera || camera, 0);
    fitShadow(sh.center, sh.radius, null, 0, opts.camera || camera);
    renderer.render(scene, opts.camera || camera);
  }

  /** XR post (packages/play/src/xr-post.js): the state of one frame (fog, time, updates, the shadow fit) set once,
   *  then opts.draw(P) with the frame's post settings; the caller draws each view through its own Pipeline.
   *  opts: { camera (the head: shadow cascades fit to it), shadow, fog, dt, draw }. Nothing calls it otherwise. */
  function renderViews(T = 0, opts = {}) {
    calm(() => {
      if (!light) setTime(time);
      if (envState === 'instant') { const xe = renderer.xr.enabled; renderer.xr.enabled = false; try { captureEnv(true); } finally { renderer.xr.enabled = xe; } }
      const P = { ...post, exposure: post.exposure * exposure, temperature: post.temperature + light.warmth };
      if (P.autoExposure > 0) P.aeKey = post.aeKey * Math.pow(2, -(post.aeNight || 0) * Math.min(1, Math.max(0, light.lamp)));
      writeFog();
      if (opts.fog !== undefined) scene.fog.density *= opts.fog;
      G.uTime.value = T; G.uFrame.value = 0;
      skyU.uCloudOffset.value.set(T * 0.004, T * 0.0015);
      for (const fn of updates) fn(T);
      const sh = opts.shadow || shadow, cam = opts.camera || camera;
      if (lighting) lighting.frame(cam, opts.dt || 0);
      fitShadow(sh.center, sh.radius, null, 0, cam);
      opts.draw(P);
    });
  }

  /** Interiors: [{ min: [x,y,z], max: [x,y,z], factor = 0.3, soft = 0.6 }] scale the image-based light inside
   *  each box (up to 8). Recaptures the environment, so call it before prepare() or after building. */
  function setAmbientVolumes(list = []) {
    const n = Math.min(list.length, G.uAmbLo.value.length);
    for (let i = 0; i < n; i++) {
      const v = list[i];
      G.uAmbLo.value[i].set(v.min[0], v.min[1], v.min[2], v.soft ?? 0.6);
      G.uAmbHi.value[i].set(v.max[0], v.max[1], v.max[2], v.factor ?? 0.3);
    }
    const was = G.uAmbN.value > 0;
    G.uAmbN.value = n;
    if (was !== n > 0) scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (m.userData.hooks) m.needsUpdate = true; });
    envState = 'instant';
  }

  function resize(wd, ht) {
    renderer.setSize(wd, ht, false);
    pipeline.setSize(wd * pixelRatio, ht * pixelRatio);   // full size; the next moving frame applies the scale
    camera.aspect = wd / ht; camera.updateProjectionMatrix();
    taaValid = false;   // the history targets were reallocated (empty)
  }

  /** free what this world made on the GPU: geometries, materials (and their programs), the shadow map, the post and
   *  environment targets; and the renderer if the world created it. Take objects you still need out of the scene first. */
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    updates = [];   // a disposed world holds no callback (and what they close over) alive
    if (lampPool) lampPool.dispose();   // before lighting: both chain scene.onBeforeRender
    pipeline.dispose(); envLight.dispose(); skyLut.dispose(); if (lighting) lighting.dispose();
    const mats = new Set();
    scene.traverse((o) => { o.geometry && o.geometry.dispose(); for (const m of [].concat(o.material || [])) mats.add(m); });
    for (const m of mats) m.dispose();
    if (sun.shadow && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (!config.renderer) renderer.dispose();
    releaseChunks();
  }

  /** after `webglcontextrestored` (three has re-made its state; @miragekit/core/platform calls this): what lived only on
   *  the GPU is made again: the sky's air, the image-based light, the probe lighting; the histories start over */
  function contextRestored() {
    if (light) skyLut.bake();
    scene.environment = null; envState = 'instant'; taaValid = false; pipeline.resetExposure(); pipeline.fx?.reset?.();
    if (lighting) lighting.invalidate();
  }

  const ctx = { THREE, renderer, scene, camera, G, keyDir, mat, geom, rng, quality, place, motion, onUpdate: (fn) => {
    // returns an unsubscribe function (call it twice, or during a frame: both are safe); it was a count before
    updates = updates.concat(fn);
    let on = true;
    return () => { if (on) { on = false; const i = updates.lastIndexOf(fn); if (i >= 0) updates = updates.filter((_, k) => k !== i); } };
  } };
  return {
    renderer, scene, camera, sun, sky, stars, pipeline, ctx, G, keyDir, mat, geom, rng, post, device, light2: l2cfg, dynamicRes: dynRes, softShadows: sscfg, lighting, lampPool,
    /** the moving frames' render scale (1 = the canvas; below 1 only with `dynamicRes`) */
    get resolutionScale() { return resScale; },
    /** forget the adapted exposure (auto exposure): the next frame is metered on its own, e.g. after a teleport */
    resetExposure: () => pipeline.resetExposure(),
    get light() { return light; }, get state() { return state; }, get exposure() { return exposure; },
    /** reduced motion in use ({ sway, rain }), null when off; set it with setReducedMotion(true | { sway, rain } | false) */
    get reducedMotion() { return reduced; },
    setReducedMotion, renderTransparent,
    setTime, tick, prepare, renderFrame, renderDirect, renderViews, resize, dispose, captureEnv, setAmbientVolumes, contextRestored,
  };
}

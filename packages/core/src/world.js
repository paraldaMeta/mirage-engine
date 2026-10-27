// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { createEnv } from './env.js';
import { installFog, FOG } from './fog.js';
import { createSky, createSkyUniforms } from './sky.js';
import { createStars } from './stars.js';
import { skyState, lightAt } from './daynight.js';
import { Pipeline, DEFAULT_POST } from './post.js';
import { createMaterials } from './materials.js';
import { createEnvLight } from './envlight.js';
import { deviceProfile } from './device.js';
import * as geom from './geom.js';
import { rng } from './rng.js';

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

export function createWorldRenderer(config = {}) {
  const {
    canvas, width = canvas?.clientWidth || 1280, height = canvas?.clientHeight || 720, pixelRatio = 1,
    quality = 'high', place = { lat: 0, lon: 0, height: 0, tzHours: 0 }, time = 'golden',
    shadow = { center: [0, 0, 0], radius: 30 }, envProbe = [0, 3, 0], envIntensity = 0.5, wind, clouds = 0.35,
  } = config;
  const Q = QUALITY[quality] || QUALITY.high;
  const fogCfg = { density: 1, groundDensity: 0.0016, height: 18, air: 0.00012, level: 0, color: 1, glow: 1, ...config.fog };
  const post = { ...DEFAULT_POST, ...config.post };

  installFog();
  const renderer = config.renderer || new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!config.preserveDrawingBuffer });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const device = deviceProfile(renderer, { force: !!config.mobile });

  const env = createEnv({ wind });
  const { G, keyDir } = env;
  const scene = new THREE.Scene();
  scene.environmentIntensity = envIntensity;
  scene.fog = new THREE.FogExp2(0x8899aa, fogCfg.density);   // FogExp2 switches on Mirage's aerial perspective
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
  const skyU = createSkyUniforms();
  skyU.uCloudCover.value = clouds;
  const sky = createSky(skyU);
  const stars = createStars(skyU);
  scene.add(sky, stars);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(config.shadowMapSize || Q.shadowMap);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.02; sun.shadow.radius = 1;
  scene.add(sun, sun.target);

  const pipeline = new Pipeline(renderer, { width: width * pixelRatio, height: height * pixelRatio, msaa: device.msaa, aoSamples: Q.aoSamples });
  const mat = createMaterials(G);
  const updates = [];
  const envLight = createEnvLight(renderer, { size: Q.envSize, fade: config.envFade ?? 1.5 });
  // envState: 'instant' = recapture (two passes) before the next frame; 'fade' = one capture + cross-fade in tick()
  let envState = 'instant', light = null, state = null, frameCounter = 0, exposure = 1, expTarget = 1;
  const lastCap = { dir: new THREE.Vector3(), lamp: -1, sky: -1 };
  // temporal AA state (moving camera): history validity, previous view-projection, jitter index.
  // ponytail: TAA rather than supersampling while moving: 4 sub-frames cost 4x (~3.4 ms each at 1440x900) and
  // still crawl on thin edges; TAA is one extra full-screen pass. Still views keep the exact sub-frame average.
  let taaValid = false, taaK = 0;
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
    if (light && Math.abs(Math.log(expTarget / exposure)) > 1e-4) {
      exposure = Math.exp(Math.log(exposure) + Math.log(expTarget / exposure) * Math.min(1, dt * 3));
      setLampGain(); busy = true;
    }
    if (envState === 'fade' && !envLight.fading) captureEnv(false);
    return envLight.tick(dt) || busy || envState === 'fade';
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

  function fitShadow(center, radius, jitter) {
    const d = keyDir.clone();
    if (jitter) {
      const right = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, d);
      d.addScaledVector(right, jitter[0]).addScaledVector(up, jitter[1]).normalize();
    }
    const c = new THREE.Vector3().fromArray(center), D = radius * 3;
    sun.position.copy(c).addScaledVector(d, D);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -radius; cam.right = cam.top = radius;
    cam.near = Math.max(0.5, D - 2 * radius); cam.far = D + 2 * radius;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  function captureEnv(instant = true) {
    // image-based light: a PMREM of the sky AND the built world from the probe point (envlight.js). A snap
    // captures twice so the second pass already holds one bounce of the first; a fade captures once (the
    // scene still shows the previous light, which is the bounce).
    writeFog();
    fitShadow(shadow.center, shadow.radius, null);
    stars.visible = false; skyU.uCapture.value = 1;
    for (let pass = 0; pass < (instant ? 2 : 1); pass++) {
      envLight.capture(scene, envProbe, { instant });
      scene.environment = envLight.texture;
    }
    stars.visible = true; skyU.uCapture.value = 0;
    lastCap.dir.copy(keyDir); lastCap.lamp = light.lamp; lastCap.sky = light.skyLight;
    envState = null;
  }

  async function prepare() {
    if (!light) setTime(time);
    scene.environment = null;
    camera.updateMatrixWorld();
    await renderer.compileAsync(scene, camera);
    captureEnv(true);
  }

  /** Render the frame at time T (seconds). opts: { camera, getCamera(t), spp, dt, shutter, frameIndex, target, shadow,
   *  taa: true | alpha } — taa: one jittered sub-frame resolved against the reprojected history (moving cameras) */
  function renderFrame(T = 0, opts = {}) {
    if (!light) setTime(time);
    if (envState === 'instant') captureEnv(true);
    let spp = opts.spp ?? config.spp ?? Q.spp;
    const taa = !!opts.taa;
    if (taa) spp = 1; else taaValid = false;
    const dt = opts.dt ?? 1 / 60, shutter = opts.shutter ?? 0.5;
    const sh = opts.shadow || shadow;
    const P = { ...post, exposure: post.exposure * exposure, temperature: post.temperature + light.warmth };
    writeFog();
    const W = aaWeights(spp);
    const w = pipeline.w, h = pipeline.h;
    pipeline.begin();
    for (let k = 0; k < spp; k++) {
      const tk = T + (spp > 1 ? ((shutterSlot(k, spp) + 0.5) / spp - 0.5) * shutter * dt : 0);
      G.uTime.value = tk; G.uFrame.value = k;
      skyU.uCloudOffset.value.set(tk * 0.004, tk * 0.0015);
      for (const fn of updates) fn(tk);
      const cam = opts.getCamera ? opts.getCamera(tk) : opts.camera || camera;
      cam.updateMatrixWorld();
      const pm = cam.projectionMatrix.elements, saved = pm.slice(), savedPos = cam.position.clone();
      if (taa) curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);   // unjittered, for reprojection
      const o = cam.isOrthographicCamera ? 12 : 8;
      if (spp > 1 || taa) {
        // AA: a 2-px footprint across the sub-frames; a 1-px one across the frames of temporal AA
        const [jx, jy] = taa ? aaOffset((taaK = (taaK + 1) % 16)).map((v) => v * 0.5) : aaOffset(k);
        pm[o] += (2 * jx) / w; pm[o + 1] += (2 * jy) / h;
      }
      if (spp > 1 && P.dof > 0 && cam.isPerspectiveCamera) {
        // thin lens: move the eye over the aperture (Vogel spiral) and shear the frustum so the focus plane stays
        const r = Math.sqrt((k + 0.5) / spp) * P.dof, th = k * 2.39996323 + 1.1;
        const dx = r * Math.cos(th), dy = r * Math.sin(th);
        cam.position.add(new THREE.Vector3(dx, dy, 0).applyQuaternion(cam.quaternion));
        cam.updateMatrixWorld();
        pm[8] -= (pm[0] * dx) / P.focus; pm[9] -= (pm[5] * dy) / P.focus;
      }
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      // soft shadows: the light moves over the solar disc (Vogel spiral, 0.27° radius)
      const r = spp > 1 ? Math.sqrt((k + 0.5) / spp) * 0.0047 : 0, th = k * 2.39996323 + 0.5;
      fitShadow(sh.center, sh.radius, r ? [r * Math.cos(th), r * Math.sin(th)] : null);
      pipeline.add(scene, cam, W[k], k, P);
      if (taa) {
        pipeline.taa(invVP.copy(curVP).invert(), prevVP, taaValid ? (typeof opts.taa === 'number' ? opts.taa : 0.12) : 1);
        prevVP.copy(curVP); taaValid = true;
      }
      cam.projectionMatrix.elements.splice(0, 16, ...saved);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      if (!cam.position.equals(savedPos)) { cam.position.copy(savedPos); cam.updateMatrixWorld(); }
    }
    pipeline.end(P, opts.frameIndex ?? frameCounter++, opts.target ?? null);
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
    pipeline.setSize(wd * pixelRatio, ht * pixelRatio);
    camera.aspect = wd / ht; camera.updateProjectionMatrix();
    taaValid = false;   // the history targets were reallocated (empty)
  }

  function dispose() {
    pipeline.dispose(); envLight.dispose();
    scene.traverse((o) => { o.geometry && o.geometry.dispose(); });
    if (!config.renderer) renderer.dispose();
  }

  const ctx = { THREE, renderer, scene, camera, G, keyDir, mat, geom, rng, quality, place, onUpdate: (fn) => updates.push(fn) };
  return {
    renderer, scene, camera, sun, sky, stars, pipeline, ctx, G, keyDir, mat, geom, rng, post, device,
    get light() { return light; }, get state() { return state; }, get exposure() { return exposure; },
    setTime, tick, prepare, renderFrame, resize, dispose, captureEnv, setAmbientVolumes,
  };
}

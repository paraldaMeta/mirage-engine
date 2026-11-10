// Mirage original code. WebXR for a play: walk a mirage world in a VR headset (immersive-vr), or set it on a table
// at reduced scale (immersive-ar).
// ---------------------------------------------------------------------------
// const support = await xrSupport();                                  // { vr, ar }: before the world, for its context
// const world = createWorldRenderer({ ..., xr: support.vr || support.ar });   // MSAA in the headset (see world.js)
// const play = createPlay(world, { plan, ... });                       // or startGame(...).play
// const xr = createXR(play, { game: g });                              // "Enter VR" / "Enter AR" buttons when supported
//
// The frame (renderer.setAnimationLoop while presenting; play's own rAF loop is stopped):
//   controllers -> play.step(dt) (the same walker / physics character, collisions, steps and ground as on desktop;
//   the sticks come in through play.xrInput) -> the rig: feet on the walker's eased view position, the head over
//   them, head height from the headset -> world.tick (environment fades, exposure) with XR off -> world.renderDirect:
//   one plain stereo draw, graded by the renderer's tone mapping (below). No SSAO / TAA / bloom / sharpening / grain.
// The grade: renderer.toneMapping = CustomToneMapping, installed once (the world's tone map baked in) with a uniform
// array every program shares (XR_GRADE, written each frame): exposure, white balance (post.temperature + the light's
// warmth), saturation, contrast, lift as in post.js, and a stand-in for the bloom (gain + a veil of the view's mean
// radiance, measured by an asynchronous 32 x 32 meter; constants fitted by packages/tools/src/xr-fit.mjs).
// Sky and stars (ShaderMaterials that write linear colour) get three's tone-mapping and colour-space chunks appended.
// Controls (VR): left stick walks (head-relative), left grip runs, right stick left / right turns (snap 30° by
// default), right stick forward aims a teleport arc onto walkable ground (release to go), A jumps, either trigger is
// the game's interact (or closes a game message). Walking around the room moves the walker too (collisions included:
// the view is pushed back at walls). AR: the trigger puts the world on the hit-tested floor / table, the right stick
// turns (x) and scales (y) it.
// ponytail: one rig, one camera; no hand tracking gestures, no controller models from the WebXR input-profiles CDN
// (simple shapes instead), no in-XR pause menu; a game's DOM menu is not reachable in the headset.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const TM = { agx: 'AgXToneMapping', aces: 'ACESFilmicToneMapping', neutral: 'NeutralToneMapping' };
const SCALE = { high: 1, medium: 0.9, low: 0.75 };   // framebuffer scale by quality (1 = the headset's recommended size)
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/** { vr, ar }: which immersive sessions this browser offers (false without WebXR). */
export async function xrSupport(nav = globalThis.navigator) {
  const xr = nav && nav.xr;
  if (!xr || !xr.isSessionSupported) return { vr: false, ar: false };
  const q = (m) => xr.isSessionSupported(m).then((v) => !!v, () => false);
  const [vr, ar] = await Promise.all([q('immersive-vr'), q('immersive-ar')]);
  return { vr, ar };
}

// The XR grade's uniforms, one typed array shared by every program (three keeps typed-array uniform values by
// reference when it clones a material's uniforms; fog.js does the same): [0] exposure x white balance (rgb) and the
// bloom stand-in's gain, [1] the bloom stand-in's veil (rgb) and saturation, [2] contrast, lift.
export const XR_GRADE = new Float32Array(12);
const BLOOM_FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2];   // three's UnrealBloomPass mip weights
// the bloom blur as GAIN x the pixel + VEIL x the haze colour (VEIL_SAT of its saturation), fitted against the
// desktop pipeline from the same eye (packages/tools/src/xr-check.mjs; docs/xr.md)
export const XR_FIT = { GAIN: 1.4, VEIL: 1.0, VEIL_SAT: 0.5 };

/** Fill XR_GRADE from the world's post settings and light (see the top of this file). */
export function setGrade(world, { mean = null, out = XR_GRADE } = {}) {
  const P = world.post, L = world.light, E = P.exposure * world.exposure, t = P.temperature + (L ? L.warmth : 0);
  // UnrealBloomPass (threshold 0) adds strength x sum(mix(f, 1.2 - f, radius)) x a blurred copy of the frame; a blur
  // that wide is part the pixel itself (GAIN), part the frame's mean radiance (VEIL): `mean` (rgb, measured: the
  // meter in createXR), else the haze colour stands in
  const B = (P.bloom || 0) * BLOOM_FACTORS.reduce((s, f) => s + f + (1.2 - 2 * f) * (P.bloomRadius ?? 0), 0);
  const f = mean ? { r: mean[0], g: mean[1], b: mean[2] } : world.scene.fog ? world.scene.fog.color : { r: 0, g: 0, b: 0 };
  const l = 0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b;
  const veil = [f.r, f.g, f.b].map((c) => (l + (c - l) * XR_FIT.VEIL_SAT) * B * XR_FIT.VEIL);
  out.set([E * (1 + 0.1 * t), E, E * (1 - 0.12 * t), 1 + B * XR_FIT.GAIN, ...veil, P.saturation ?? 1, P.contrast ?? 1, P.lift ?? 0, 0, 0]);
  return out;
}

let gradeInstalled = null;
function installGrade(post) {
  if (gradeInstalled) return gradeInstalled;
  const tm = TM[post.tonemap] || TM.agx;
  const fn = /* glsl */ `
uniform vec4 mgXR[ 3 ];
vec3 CustomToneMapping( vec3 color ) {
	// Mirage XR grade (@mirage/play xr.js): renderFrame's grade without its screen-space parts
	if ( mgXR[ 0 ].w == 0.0 ) return ${tm}( color );   // a material compiled without the grade's uniforms
	color = ( color * mgXR[ 0 ].w + mgXR[ 1 ].rgb ) * mgXR[ 0 ].rgb;   // bloom stand-in, exposure, white balance
	color = ${tm}( color );
	float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = max( mix( vec3( l ), color, mgXR[ 1 ].w ), 0.0 );
	color = clamp( ( color - 0.5 ) * mgXR[ 2 ].x + 0.5, 0.0, 1.0 );
	return color + mgXR[ 2 ].y * ( 1.0 - color );
}`;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (chunk.includes(stub)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, '') + fn;
  for (const lib of Object.values(THREE.ShaderLib)) if (lib.uniforms && !lib.uniforms.mgXR) lib.uniforms.mgXR = { value: XR_GRADE };
  return (gradeInstalled = { tonemap: post.tonemap });
}

// ShaderMaterials: the grade's uniforms; those that write linear HDR without three's output chunks (sky, stars) get
// the chunks appended. Drawing into a linear render target (the pipeline, environment captures) the chunks compile
// to nothing, so the non-XR image is unchanged.
function patchShaders(scene) {
  scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      if (!m || !m.isShaderMaterial || m.isRawShaderMaterial || m.userData.mirageXR) continue;
      m.userData.mirageXR = true;
      if (m.uniforms && !m.uniforms.mgXR) m.uniforms.mgXR = { value: XR_GRADE };
      const fs = m.fragmentShader;
      if (!/gl_FragColor/.test(fs) || /colorspace_fragment/.test(fs)) continue;
      m.fragmentShader = fs.replace(/\}\s*$/, '\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}');
      m.needsUpdate = true;
    }
  });
}

// a text sprite: a rounded panel with an optional key chip, redrawn only when the text changes
function makeLabel({ width = 0.6, px = 1024, lines = 1 } = {}) {
  const c = document.createElement('canvas');
  const lh = 84, h = lines === 1 ? 128 : 64 + lh * lines;
  c.width = px; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  mat.userData.mirageXR = true;
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(width, (width * h) / px, 1);
  sprite.renderOrder = 2001; sprite.visible = false; sprite.userData.collide = false;
  let shown = null, said = null;
  const g = c.getContext('2d');
  const wrap = (t, max) => {
    const out = []; let line = '';
    for (const w of String(t).split(/\s+/)) {
      const next = line ? line + ' ' + w : w;
      if (g.measureText(next).width > max && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  return {
    sprite,
    /** what it shows, as plain text (null: hidden) */
    get text() { return sprite.visible ? said : null; },
    /** text: string | null; key: a chip before it ('Trigger'); head: a bold first line. The box fits the text
     *  (from the top of the sprite down; the rest stays transparent). */
    set(text, { key = '', head = '' } = {}) {
      const id = text ? `${key}|${head}|${text}` : null;
      sprite.visible = !!text;
      if (id === shown) return;
      shown = id;
      said = text ? [key && key + ':', head && head + ' -', text].filter(Boolean).join(' ') : null;
      if (!text) return;
      g.clearRect(0, 0, c.width, c.height);
      g.font = '56px system-ui, sans-serif';
      let kw = 0;
      if (key) { g.font = '600 44px ui-monospace, monospace'; kw = g.measureText(key).width + 36 + 24; g.font = '56px system-ui, sans-serif'; }
      const body = wrap(text, c.width - 80 - kw).slice(0, lines - (head ? 1 : 0));
      const n = body.length + (head ? 1 : 0), boxH = lines === 1 ? c.height : Math.min(c.height, 64 + lh * n);
      g.fillStyle = 'rgba(27,18,10,0.9)'; g.strokeStyle = 'rgba(255,207,110,0.6)'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(4, 4, c.width - 8, boxH - 8, 28); g.fill(); g.stroke();
      g.textBaseline = 'middle';
      let x = 40, y = lines === 1 ? c.height / 2 : 32 + lh / 2;
      if (head) { g.font = '600 52px system-ui, sans-serif'; g.fillStyle = '#ffcf6e'; g.fillText(head, x, y); y += lh; }
      if (key) {
        g.font = '600 44px ui-monospace, monospace';
        const w = g.measureText(key).width + 36;
        g.fillStyle = '#f6ecd8'; g.beginPath(); g.roundRect(x, y - 36, w, 72, 12); g.fill();
        g.fillStyle = '#1b120a'; g.fillText(key, x + 18, y + 2); x += w + 24;
      }
      g.font = '56px system-ui, sans-serif'; g.fillStyle = '#f6ecd8';
      for (const l of body) { g.fillText(l, x, y); y += lh; }
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); mat.dispose(); },
  };
}

/**
 * WebXR for a play. opts: { game, button = true, ar = true, teleport = true, snapTurn = 30 (degrees; 0 = smooth),
 * turnSpeed = 2.5 (rad/s, smooth turning), teleportMaxUp = 1.2 (m), vignette = true, framebufferScale, foveation = 1, frameRate,
 * referenceSpace = 'local-floor', arSize = 0.9 (m across), shadowRadius = 22, onSelect(hand), prompt() -> string | null }
 */
export function createXR(play, opts = {}) {
  const { world } = play;
  const { renderer, scene } = world;
  const xrm = renderer.xr;
  const B = play.walker.body;
  const o = { ar: true, teleport: true, teleportMaxUp: 1.2, snapTurn: 30, turnSpeed: 2.5, vignette: true, foveation: 1, referenceSpace: 'local-floor', arSize: 0.9, button: true, ...opts };
  const game = o.game || null;
  const listeners = [];
  const listen = (t, ev, fn) => { t.addEventListener(ev, fn); listeners.push(() => t.removeEventListener(ev, fn)); };

  // ---- the scene graph while presenting: root (world space) > rig (the reference space) > camera, controllers
  const root = new THREE.Group(); root.name = 'mirage-xr'; root.userData.collide = false;
  const rig = new THREE.Group(); rig.name = 'xr-rig';
  const cam = new THREE.PerspectiveCamera(70, 1, 0.08, 3000);
  rig.add(cam); root.add(rig);
  const own = [];   // geometries and materials to dispose

  // the meter: twice a second a 32 x 32 HDR view from the head (XR off, the shadow map reused, no tone mapping),
  // read back without a stall (pixel-pack buffer + fence, picked up a frame or more later): the mean radiance the
  // desktop bloom spreads over the frame (setGrade's veil), so lamps at dusk glow as they do on the desktop
  const meter = { rt: null, cam: new THREE.PerspectiveCamera(90, 1, 0.08, 3000), buf: null, sync: null, px: new Float32Array(32 * 32 * 4), mean: null, next: 0, dt: 1 };
  function meterFrame(time) {
    const gl = renderer.getContext();
    if (!gl.fenceSync) return;
    if (meter.sync) {
      const st = gl.clientWaitSync(meter.sync, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return;
      gl.deleteSync(meter.sync); meter.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, meter.px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const m = [0, 0, 0], n = meter.px.length / 4;
      for (let i = 0; i < meter.px.length; i += 4) for (let k = 0; k < 3; k++) { const v = meter.px[i + k]; if (v === v && v < 6e4) m[k] += v; }
      const now = m.map((v) => v / n);
      if (!meter.mean) meter.mean = now;
      else { const k = Math.min(1, meter.dt * 3); meter.mean = meter.mean.map((v, i) => v + (now[i] - v) * k); }
      return;
    }
    if (time < meter.next) return;
    meter.dt = meter.next ? (time - meter.next + 500) / 1000 : 1; meter.next = time + 500;
    if (!meter.rt) meter.rt = new THREE.WebGLRenderTarget(32, 32, { type: THREE.HalfFloatType, depthBuffer: true });
    cam.getWorldPosition(meter.cam.position); cam.getWorldQuaternion(meter.cam.quaternion); meter.cam.updateMatrixWorld();
    const saved = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate, vis = root.visible;
    xrm.enabled = false; renderer.shadowMap.autoUpdate = false; root.visible = false;
    // points (stars, snow) are at least one pixel each: at 32 x 32 they would weigh ten times what they do on screen
    const pts = []; scene.traverse((x) => { if (x.isPoints && x.visible) { pts.push(x); x.visible = false; } });
    try {
      renderer.setRenderTarget(meter.rt); renderer.clear(); renderer.render(scene, meter.cam);
      if (!meter.buf) { meter.buf = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, meter.px.byteLength, gl.STREAM_READ); }
      else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf);
      gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      meter.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    } finally {
      renderer.setRenderTarget(saved); renderer.shadowMap.autoUpdate = auto; root.visible = vis; xrm.enabled = true;
      for (const x of pts) x.visible = true;
    }
  }
  const keep = (x) => { if (x.material) x.material.userData.mirageXR = true; own.push(x.geometry, x.material); return x; };

  // comfort vignette (and the teleport blink): a black ring in front of the eyes
  const vig = keep(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uS: { value: 0 }, uBlack: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `varying vec2 vP; uniform float uS, uBlack;
      void main(){ float r = length(vP) / 0.15; float inner = mix(1.7, 0.6, uS);   // tan of the angle off the view axis
        float a = max(smoothstep(inner, inner + 0.6, r) * min(uS * 2.0, 1.0), uBlack); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  })));
  vig.position.z = -0.15; vig.renderOrder = 3000; vig.frustumCulled = false; vig.visible = false;
  cam.add(vig);

  // controllers: a ray and a small body; select = interact, the gamepad is read every frame
  const hands = [0, 1].map((i) => {
    const ray = xrm.getController(i), grip = xrm.getControllerGrip(i);
    const line = keep(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffe3a8, transparent: true, opacity: 0.55, fog: false, toneMapped: false })));
    line.scale.z = 1.2; ray.add(line);
    const body = keep(new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.09, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, fog: false })));
    body.rotation.x = Math.PI / 2 - 0.5; body.position.set(0, -0.01, 0.04); grip.add(body);
    rig.add(ray, grip);
    const h = { i, ray, grip, line, source: null, handedness: '' };
    listen(ray, 'connected', (e) => { h.source = e.data; h.handedness = e.data.handedness; });
    listen(ray, 'disconnected', () => { h.source = null; h.handedness = ''; });
    listen(ray, 'select', () => onSelect(h));
    return h;
  });

  // teleport arc and its landing ring
  const ARC = 64;
  const arc = keep(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC * 3), 3)),
    new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthTest: false, fog: false, toneMapped: false })));
  arc.frustumCulled = false; arc.renderOrder = 2002; arc.visible = false;
  const ring = keep(new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide })));
  ring.renderOrder = 2002; ring.visible = false;
  // AR placement reticle (in the reference space: a child of the rig, scaled back to real size)
  const reticle = keep(new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false, toneMapped: false })));
  reticle.renderOrder = 2003; reticle.visible = false; reticle.matrixAutoUpdate = false;
  rig.add(reticle);
  const prompt = makeLabel({ width: 0.8 }), panel = makeLabel({ width: 0.95, lines: 4 });
  root.add(arc, ring, prompt.sprite, panel.sprite);

  // ---- state
  let session = null, mode = null, last = 0, T = 0, rigYaw = 0, align = true, armed = true, ending = null, saved = null;
  const head = new THREE.Vector3(), headQ = new THREE.Quaternion(), prevHead = new THREE.Vector3();
  let hasHead = false;
  const tele = { aiming: false, valid: false, target: null, hand: null };
  const ar = { culled: null, placed: false, scale: 1, yaw: 0, at: new THREE.Vector3(), hitSource: null, hit: null, anchor: new THREE.Vector3(), extent: 1, since: 0 };
  const pads = { move: [0, 0], turn: [0, 0], run: false, jump: false, jumpPrev: false, jumpEdge: false };
  const stats = { frames: 0, ms: 0, sessions: 0 };
  let near = null, vigS = 0, blink = 0;
  let trace = null;   // tests: an array receives { dt, x, z, pos, blocked, yaw } per frame

  // ---- buttons
  let bar = null;
  const buttons = {};
  if (o.button && typeof document !== 'undefined') {
    bar = document.createElement('div');
    bar.className = 'mirage-xr';
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:30;display:flex;gap:8px;font:600 14px system-ui,sans-serif;';
    const css = 'min-height:40px;padding:0 18px;color:#1b120a;background:#f6ecd8;border:0;border-radius:20px;cursor:pointer;box-shadow:0 1px 6px #0008;';
    for (const [m, label] of [['immersive-vr', 'Enter VR'], ['immersive-ar', 'Enter AR']]) {
      if (m === 'immersive-ar' && !o.ar) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.style.cssText = css; b.hidden = true; b.dataset.mode = m;
      listen(b, 'click', () => { b.blur(); if (session) exit(); else enter(m).catch((err) => { b.title = String(err && err.message || err); console.warn('mirage xr:', err); }); });
      listen(b, 'keydown', (e) => e.stopPropagation());
      buttons[m] = b; bar.appendChild(b);
    }
    (o.button instanceof HTMLElement ? o.button : document.body).appendChild(bar);
  }
  const support = (o.support ? Promise.resolve(o.support) : xrSupport()).then((s) => {
    if (buttons['immersive-vr']) buttons['immersive-vr'].hidden = !s.vr;
    if (buttons['immersive-ar']) buttons['immersive-ar'].hidden = !(s.ar && o.ar);
    return s;
  });

  // ---- session
  async function enter(m = 'immersive-vr') {
    if (session) return session;
    if (!navigator.xr) throw new Error('WebXR is not available in this browser');
    const ar_ = m === 'immersive-ar';
    const init = ar_ ? { optionalFeatures: ['local-floor', 'hit-test'] } : { optionalFeatures: ['local-floor', 'bounded-floor', 'layers'] };
    const s = await navigator.xr.requestSession(m, init);
    try { await begin(s, m); } catch (err) { try { await s.end(); } catch { /* already ended */ } throw err; }
    return s;
  }

  async function begin(s, m) {
    const ctx = renderer.getContext();
    if (!ctx.getContextAttributes().antialias) console.warn('mirage xr: the canvas context has no MSAA, so the headset image will not either; create the world with { xr: true }');
    saved = {
      toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, xr: xrm.enabled, mode: play.mode,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), sky: world.sky.visible, stars: world.stars.visible,
      background: scene.background, clipping: renderer.clippingPlanes,
    };
    play.stop();
    session = s; mode = m === 'immersive-ar' ? 'ar' : 'vr';
    s.addEventListener('end', onEnd, { once: true });   // before anything can fail: ending always restores
    installGrade(world.post);
    patchShaders(scene);
    xrm.enabled = true;
    xrm.setReferenceSpaceType(o.referenceSpace);
    xrm.setFramebufferScaleFactor(o.framebufferScale ?? SCALE[world.ctx.quality] ?? 1);
    await xrm.setSession(s);
    xrm.setFoveation(o.foveation);
    if (o.frameRate && s.updateTargetFrameRate) s.updateTargetFrameRate(o.frameRate).catch(() => {});
    renderer.toneMapping = THREE.CustomToneMapping; renderer.toneMappingExposure = 1;
    scene.add(root);
    T = play.clock; last = 0; align = true; hasHead = false; armed = true; stats.sessions++; meter.mean = null; meter.next = 0;
    Object.assign(tele, { aiming: false, valid: false, target: null, hand: null });
    if (mode === 'vr') {
      if (play.mode !== 'walk') play.setMode('walk');
      play.xrInput = mergeInput;
      if (game && game.ui && !game.ui.started) game.ui.begin();   // the Enter VR click was the start screen's click
    } else startAR(s);
    vig.visible = o.vignette || o.teleport;
    renderer.setAnimationLoop(frame);
  }

  function onEnd() {
    renderer.setAnimationLoop(null);
    play.xrInput = null;
    scene.remove(root);
    if (ar.hitSource) { try { ar.hitSource.cancel(); } catch { /* gone with the session */ } ar.hitSource = null; }
    if (ar.culled) { for (const x of ar.culled) x.frustumCulled = true; ar.culled = null; }
    rig.scale.setScalar(1);
    if (saved) {
      renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.exposure;
      renderer.setClearColor(saved.clear, saved.alpha);
      world.sky.visible = saved.sky; world.stars.visible = saved.stars; scene.background = saved.background;
      renderer.clippingPlanes = saved.clipping;
      xrm.enabled = saved.xr;
      if (mode === 'vr' && saved.mode !== 'walk') play.setMode(saved.mode);
    }
    prompt.set(null); panel.set(null);
    session = null; mode = null; saved = null;
    play.syncWalkerView();
    play.start();
    if (ending) { ending(); ending = null; }
  }

  function exit() {
    if (!session) return Promise.resolve();
    return new Promise((r) => { ending = r; session.end().catch(() => onEnd()); });
  }

  // ---- input
  function readPads() {
    let move = [0, 0], turn = [0, 0], run = false, jump = false;
    for (const h of hands) {
      const src = h.source, gp = src && src.gamepad;
      if (!gp) continue;
      const a = gp.axes, st = a.length >= 4 ? [a[2] || 0, a[3] || 0] : [a[0] || 0, a[1] || 0];
      const btn = (k) => !!(gp.buttons[k] && (gp.buttons[k].pressed || gp.buttons[k].value > 0.5));
      const dz = (v) => { const l = Math.hypot(v[0], v[1]); if (l < 0.15) return [0, 0]; const k = Math.min(1, (l - 0.15) / 0.85) / l; return [v[0] * k, v[1] * k]; };
      if (h.handedness === 'left') { move = dz(st); run = run || btn(1) || btn(3); }
      else { turn = dz(st); jump = jump || btn(4); }
    }
    pads.move = move; pads.turn = turn; pads.run = run;
    pads.jumpEdge = jump && !pads.jumpPrev; pads.jumpPrev = jump; pads.jump = jump;
  }

  let roomMove = [0, 0];   // the head's walk around the room this frame, as stick units (see mergeInput)
  function mergeInput(base, dt) {
    const x = (base.x || 0) + pads.move[0] + roomMove[0], z = (base.z || 0) - pads.move[1] + roomMove[1];
    return { ...base, x, z, run: !!base.run || pads.run, jump: !!base.jump || pads.jump, jumpPressed: !!base.jumpPressed || pads.jumpEdge };
  }

  function haptic(h, v = 0.5, ms = 40) {
    const a = h && h.source && h.source.gamepad && h.source.gamepad.hapticActuators;
    if (a && a[0] && a[0].pulse) try { a[0].pulse(v, ms); } catch { /* not supported */ }
  }

  function onSelect(h) {
    if (!session) return;
    if (mode === 'ar') { if (ar.hit) placeAR(ar.hit); return; }
    if (tele.aiming) return;
    if (game) {
      const d = game.ui && game.ui.open;
      if (d) { d.close(); haptic(h, 0.3); return; }            // a message (or menu) is up: Continue
      if (game.input && near) { game.input.tap('interact'); haptic(h); }
    }
    if (o.onSelect) o.onSelect(h.handedness);
  }

  // ---- teleport: a ballistic arc over the walk grid (walls and roofs stop it, it lands where the walker fits)
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _vel = new THREE.Vector3();
  function aim(h) {
    h.ray.updateMatrixWorld(true);
    _p.setFromMatrixPosition(h.ray.matrixWorld);
    _d.set(0, 0, -1).transformDirection(h.ray.matrixWorld);
    _vel.copy(_d).multiplyScalar(8);
    const pos = arc.geometry.attributes.position, grid = play.grid, w = play.walker;
    let n = 0, hit = null;
    pos.setXYZ(n++, _p.x, _p.y, _p.z);
    for (let i = 1; i < ARC && !hit; i++) {
      const prevY = _p.y;
      for (let k = 0; k < 2; k++) { _vel.y -= 9.81 * 0.02; _p.addScaledVector(_vel, 0.02); }
      pos.setXYZ(n++, _p.x, _p.y, _p.z);
      const s = grid.support(_p.x, _p.z, _p.y, 0);
      if (!s || _p.y > s[1]) {
        // under every floor here: the arc went through one this step (land on it) or into a solid (stop)
        const up = grid.support(_p.x, _p.z, _p.y, Math.max(0.6, prevY - _p.y + 0.05));
        if (up && _vel.y < 0 && up[0] > _p.y && up[0] <= prevY + 0.05) hit = [_p.x, up[0], _p.z, up[1]];
        else break;
      }
    }
    for (let k = n; k < ARC; k++) pos.setXYZ(k, _p.x, _p.y, _p.z);
    pos.needsUpdate = true;
    let ok = !!hit;
    if (ok) ok = hit[1] - w.pos[1] <= o.teleportMaxUp;   // no roofs and wall tops: what a climb could not reach
    if (ok) ok = typeof w.fits === 'function' ? w.fits(hit[0], hit[2], hit[1]) : hit[3] - hit[1] >= B.head;
    tele.valid = ok; tele.target = hit ? [hit[0], hit[1], hit[2]] : null;
    arc.material.color.set(ok ? 0x9fe8ff : 0xff8a6a);
    ring.visible = ok;
    if (ok) ring.position.set(hit[0], hit[1] + 0.02, hit[2]);
    arc.visible = true;
  }
  function teleport(to) {
    const w = play.walker;
    if (typeof w.place === 'function') w.place([to[0], to[1] + 0.05, to[2]]);
    play.syncWalkerView();
    blink = 1;
  }

  // ---- AR: the world as a table model on the hit-tested floor (fallback: 1.2 m in front of you on the floor)
  function startAR(s) {
    const g = play.grid, x0 = g.x0, z0 = g.z0, x1 = g.x0 + g.nx * g.cell, z1 = g.z0 + g.nz * g.cell;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, gy = g.groundAt(cx, cz);
    ar.anchor.set(cx, Number.isNaN(gy) ? 0 : gy, cz);
    ar.extent = Math.max(x1 - x0, z1 - z0);
    ar.scale = ar.extent / o.arSize; ar.yaw = 0; ar.placed = false; ar.hit = null; ar.since = 0;
    world.sky.visible = false; world.stars.visible = false; scene.background = null;
    renderer.setClearColor(0x000000, 0);
    // three's stereo culling frustum (setProjectionFromUnion) mixes the eyes' world distance, scaled by the rig,
    // with view-space near / far: with a scaled rig it culls what is in view. The model is all in view anyway.
    ar.culled = [];
    scene.traverse((x) => { if (x.frustumCulled && x !== root) { ar.culled.push(x); x.frustumCulled = false; } });
    renderer.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0), new THREE.Plane(new THREE.Vector3(0, 0, -1), z1),
    ];
    if (s.requestHitTestSource) s.requestReferenceSpace('viewer')
      .then((space) => s.requestHitTestSource({ space }))
      .then((src) => { if (session === s) ar.hitSource = src; else src.cancel(); }, () => {});
  }
  function placeAR(p) { ar.at.copy(p); ar.placed = true; }
  function stepAR(dt, xrFrame) {
    ar.since += dt;
    ar.hit = null;
    if (ar.hitSource) {
      const r = xrFrame.getHitTestResults(ar.hitSource);
      const pose = r.length && r[0].getPose(xrm.getReferenceSpace());
      if (pose) { const t = pose.transform.position; ar.hit = new THREE.Vector3(t.x, t.y, t.z); }
    }
    if (!ar.placed && !ar.hit && ar.since > 1.5 && hasHead) {   // no hit test here: the floor in front of you
      const f = _v.set(0, 0, -1).applyQuaternion(headQ).setY(0);
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      placeAR(new THREE.Vector3(head.x + f.x * 1.2, 0, head.z + f.z * 1.2));
    }
    if (ar.hit && !ar.placed) placeAR(ar.hit);
    ar.yaw -= pads.turn[0] * 1.5 * dt;
    ar.scale *= Math.exp(pads.turn[1] * 1.2 * dt);
    // reference point H (ar.at) shows world point P (ar.anchor): rig = P - s * R(yaw) H
    rig.scale.setScalar(ar.scale);
    rig.rotation.set(0, ar.yaw, 0);
    _v.copy(ar.at).applyAxisAngle(THREE.Object3D.DEFAULT_UP, ar.yaw).multiplyScalar(ar.scale);
    rig.position.copy(ar.anchor).sub(_v);
    reticle.visible = !!ar.hit;
    if (ar.hit) { reticle.matrix.compose(ar.hit, _q.identity(), _v.setScalar(1 / ar.scale)); }
  }

  // ---- VR: the rig follows the walker
  const toWorld = (x, z) => { const c = Math.cos(rigYaw), s = Math.sin(rigYaw); return [x * c + z * s, -x * s + z * c]; };
  function stepVR(dt) {
    const h = hands.find((x) => x.handedness === 'right') || hands[1];
    const [tx, ty] = pads.turn;
    // right stick: forward aims a teleport, sideways turns
    if (o.teleport && (tele.aiming ? ty < -0.3 : ty < -0.7 && Math.abs(ty) > Math.abs(tx))) { tele.aiming = true; tele.hand = h; aim(h); }
    else if (tele.aiming) {
      tele.aiming = false; arc.visible = false; ring.visible = false;
      if (tele.valid && tele.target) { teleport(tele.target); haptic(h, 0.4, 30); }
    } else if (o.snapTurn > 0) {
      if (armed && Math.abs(tx) > 0.7) { rigYaw -= Math.sign(tx) * (o.snapTurn * Math.PI) / 180; armed = false; blink = Math.max(blink, 0.5); }
      if (Math.abs(tx) < 0.3) armed = true;
    } else rigYaw -= tx * o.turnSpeed * dt;
    // the head's yaw and pitch in the world drive play (walk direction, game's look direction, audio)
    const f = _v.set(0, 0, -1).applyQuaternion(headQ);
    const localYaw = Math.atan2(f.z, f.x);
    play.yaw = localYaw - rigYaw;
    play.pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
    // walking around the room: the head's move this frame, as stick units in play's frame (relative to play.yaw)
    roomMove = [0, 0];
    if (hasHead && dt > 0) {
      const dx = head.x - prevHead.x, dz = head.z - prevHead.z;
      if (Math.hypot(dx, dz) < 0.5) {   // larger: a reference-space reset, not a step
        const [wx, wz] = toWorld(dx, dz), sp = (pads.run ? B.run : B.walk) * dt;
        const fy = play.yaw, fwd = [Math.cos(fy), Math.sin(fy)], right = [-Math.sin(fy), Math.cos(fy)];
        roomMove = [(wx * right[0] + wz * right[1]) / sp, (wx * fwd[0] + wz * fwd[1]) / sp];
      }
    }
    prevHead.copy(head);
    const from = trace ? play.walker.pos.slice() : null;
    play.step(dt);
    // the rig: feet at the walker's eased view position, the head above them
    const c = world.camera.position, [ox, oz] = toWorld(head.x, head.z);
    rig.position.set(c.x - ox, c.y - B.eye, c.z - oz);
    rig.rotation.set(0, rigYaw, 0);
    rig.scale.setScalar(1);
    // in-world prompt and messages for a game
    near = null;
    if (game) {
      near = game.near || null;
      const ui = game.ui;
      let label = near ? (game.game.label ? game.game.label(near) : '') : null;
      if (o.prompt) label = o.prompt();
      prompt.set(label || null, { key: 'Trigger' });
      if (near && label) { const p = game.game.where(near); prompt.sprite.position.set(p[0], p[1] + 0.38, p[2]); }
      const r = ui && ui.root, d = ui && ui.open;
      let msg = null, headLine = '';
      if (d && r) { headLine = (d.querySelector('h2') || {}).textContent || ''; msg = d.classList.contains('mg-msg') ? (r.querySelector('.mg-msg-p') || {}).textContent || ' ' : 'Paused: trigger to resume'; }
      else if (r) { const t = r.querySelector('.mg-toast.on'); if (t && t.textContent) msg = t.textContent; }
      panel.set(msg, { head: headLine });
    } else if (o.prompt) {
      const label = o.prompt();
      prompt.set(label || null, { key: 'Trigger' });
      if (label) { cam.getWorldPosition(_v); const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)); prompt.sprite.position.copy(_v).addScaledVector(fw, 1.3).y -= 0.25; }
    }
    // comfort vignette: with stick motion and smooth turning
    const motion = o.vignette ? Math.min(1, Math.hypot(pads.move[0], pads.move[1]) * (pads.run ? 1 : 0.7) + (o.snapTurn > 0 ? 0 : Math.abs(tx) * 0.8)) : 0;
    vigS += (motion - vigS) * Math.min(1, dt * 6);
    if (trace) trace.push({ dt, x: pads.move[0], z: -pads.move[1], run: pads.run, from, pos: play.walker.pos.slice(), blocked: play.walker.blocked, onGround: play.walker.onGround, yaw: play.yaw });
  }

  // a shadow region around the view, snapped to whole shadow texels (as play.js does)
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function shadowAround(p, R) {
    const d = world.keyDir;
    _r.crossVectors(Y, d); if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0); _r.normalize();
    _u.crossVectors(d, _r);
    const step = ((2 * R) / world.sun.shadow.mapSize.x) * 8;
    const a = Math.round(p.dot(_r) / step) * step, b = Math.round(p.dot(_u) / step) * step, c = Math.round(p.dot(d) / 2) * 2;
    _c.set(0, 0, 0).addScaledVector(_r, a).addScaledVector(_u, b).addScaledVector(d, c);
    return { center: _c.toArray(), radius: R };
  }

  function frame(time, xrFrame) {
    if (!session || !xrFrame) return;
    const t0 = performance.now();
    const dt = last ? Math.max(0, Math.min((time - last) / 1000, 0.1)) : 0;
    last = time;
    const pose = xrFrame.getViewerPose(xrm.getReferenceSpace());
    if (pose) {
      const p = pose.transform.position, q = pose.transform.orientation;
      head.set(p.x, p.y, p.z); headQ.set(q.x, q.y, q.z, q.w);
      if (!hasHead) prevHead.copy(head);
      if (align) {   // face where the desktop view faced
        const f = _v.set(0, 0, -1).applyQuaternion(headQ);
        rigYaw = Math.atan2(f.z, f.x) - play.yaw; align = false;
      }
      hasHead = true;
    }
    readPads();
    if (mode === 'vr') stepVR(dt); else stepAR(dt, xrFrame);
    T += dt;
    blink = Math.max(0, blink - dt * 5);
    vig.material.uniforms.uS.value = vigS; vig.material.uniforms.uBlack.value = Math.min(1, blink * 1.5);
    vig.visible = vigS > 0.01 || blink > 0;
    // panel: lazily follows the head, 1.4 m out, a little below the eyes
    if (panel.sprite.visible) {
      cam.getWorldPosition(_v);
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)).setY(0).normalize();
      const want = _v.clone().addScaledVector(fw, 1.4 * rig.scale.x); want.y -= 0.18 * rig.scale.x;
      if (panel.sprite.position.distanceTo(want) > 0.5 * rig.scale.x || !panel.sprite.userData.placed) panel.sprite.userData.goal = want;
      panel.sprite.position.lerp(panel.sprite.userData.goal || want, panel.sprite.userData.placed ? Math.min(1, dt * 4) : 1);
      panel.sprite.userData.placed = true;
      panel.sprite.scale.set(0.95 * rig.scale.x, (0.95 * rig.scale.x * 400) / 1024, 1);
    } else panel.sprite.userData.placed = false;
    // light: eased exposure, environment fades (full-screen passes: XR off), then one stereo draw
    xrm.enabled = false;
    try { world.tick(dt); } finally { xrm.enabled = true; }
    if (mode === 'vr' && o.meter !== false) meterFrame(time);
    setGrade(world, { mean: mode === 'vr' ? meter.mean : [0, 0, 0] });
    let shadow;
    if (mode === 'ar') shadow = { center: ar.anchor.toArray(), radius: ar.extent * 0.75 };
    else {
      cam.getWorldPosition(_v);
      const fy = play.yaw, R = o.shadowRadius ?? 22;
      shadow = shadowAround(_v.set(_v.x + Math.cos(fy) * R * 0.45, play.walker.pos[1], _v.z + Math.sin(fy) * R * 0.45), R);
    }
    world.renderDirect(T, { camera: cam, shadow, ...(mode === 'ar' ? { fog: 1 / ar.scale } : {}) });
    stats.frames++; stats.ms = performance.now() - t0;
  }

  function dispose() {
    const done = exit();
    for (const off of listeners.splice(0)) off();
    if (bar) bar.remove();
    for (const x of own) if (x) x.dispose();
    if (meter.rt) meter.rt.dispose();
    if (meter.buf) { const gl = renderer.getContext(); if (meter.sync) gl.deleteSync(meter.sync); gl.deleteBuffer(meter.buf); meter.buf = meter.sync = null; }
    prompt.dispose(); panel.dispose();
    return done;
  }

  return {
    rig, camera: cam, root, buttons, stats, support,
    /** the bloom stand-in's constants (shared by every XR session on the page) */
    fit: XR_FIT,
    enter, exit, dispose,
    get session() { return session; }, get presenting() { return !!session; }, get mode() { return mode; },
    get near() { return near; },
    /** put the walker at `eye` and turn the rig so the headset faces `look` (like play.place) */
    place(eye, look) { play.place(eye, look, 'walk'); align = true; },
    /** tests: per-frame records of the stick, the walker and the yaw while `trace` is an array */
    get trace() { return trace; }, set trace(a) { trace = a; },
    /** a plain snapshot for tests */
    state: () => ({
      presenting: !!session, mode, rigYaw: +rigYaw.toFixed(4), rig: rig.position.toArray().map((v) => +v.toFixed(3)), scale: +rig.scale.x.toFixed(3),
      head: head.toArray().map((v) => +v.toFixed(3)), yaw: +play.yaw.toFixed(4), walker: play.walker.pos.map((v) => +v.toFixed(3)),
      onGround: play.walker.onGround, blocked: play.walker.blocked,
      teleport: { aiming: tele.aiming, valid: tele.valid, target: tele.target && tele.target.map((v) => +v.toFixed(3)) },
      prompt: prompt.text, panel: panel.text,
      near: near ? near.id : null, vignette: +vigS.toFixed(3), ar: { placed: ar.placed, scale: +ar.scale.toFixed(3), hit: !!ar.hit, hitTest: !!ar.hitSource },
      frames: stats.frames, size: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), meter: meter.mean && meter.mean.map((v) => +v.toFixed(4)),
    }),
  };
}

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
// turns (x) and scales (y) it. Hands (tracked, no controllers; xr-hands.js): pinch is the trigger, point with the
// index to aim the teleport arc and pinch to go; the ray comes from the index finger.
// Native hosts (a WebXR page run without a browser, e.g. webxr-to-native on Quest): where navigator.xr.offerSession
// exists the session is offered to the platform (its own Enter VR, or a host that enters on launch), so no DOM
// button is needed; labels draw with a built-in glyph font when Canvas 2D cannot draw text (glyphs.js).
// The frame allocates nothing in this file (scratch objects, positional calls; the DOM mirror of a game's toasts is
// read ten times a second): measured with mirage-xr-check --alloc.
// ponytail: one rig, one camera; no controller models from the WebXR input-profiles CDN (simple shapes instead),
// no in-XR pause menu; a game's DOM menu is not reachable in the headset; no multiview (three 0.186's WebGLRenderer
// draws the two eyes as two views).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { MAXL } from './walkgrid.js';
import { canvasTextWorks, createImage, clearImage, fillRoundRect, drawText, textWidth, glyphText } from './glyphs.js';
import { HAND_JOINTS, createHandGesture, indexRay } from './xr-hands.js';

const TM = { agx: 'AgXToneMapping', aces: 'ACESFilmicToneMapping', neutral: 'NeutralToneMapping' };
const SCALE = { high: 1, medium: 0.9, low: 0.75 };   // framebuffer scale by quality (1 = the headset's recommended size)
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _fw = new THREE.Vector3(), _w = new THREE.Vector3();
const ZERO3 = Object.freeze([0, 0, 0]);

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
export function setGrade(world, { mean = null, out = XR_GRADE } = {}) { return grade(world, mean, out); }
// the same, positional and allocation-free (the XR frame calls it every frame)
function grade(world, mean, out) {
  const P = world.post, L = world.light, E = P.exposure * world.exposure, t = P.temperature + (L ? L.warmth : 0);
  // UnrealBloomPass (threshold 0) adds strength x sum(mix(f, 1.2 - f, radius)) x a blurred copy of the frame; a blur
  // that wide is part the pixel itself (GAIN), part the frame's mean radiance (VEIL): `mean` (rgb, measured: the
  // meter in createXR), else the haze colour stands in
  let s = 0;
  for (let i = 0; i < BLOOM_FACTORS.length; i++) { const f = BLOOM_FACTORS[i]; s = s + f + (1.2 - 2 * f) * (P.bloomRadius ?? 0); }
  const B = (P.bloom || 0) * s;
  const fog = world.scene.fog, r = mean ? mean[0] : fog ? fog.color.r : 0, g = mean ? mean[1] : fog ? fog.color.g : 0, b = mean ? mean[2] : fog ? fog.color.b : 0;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out[0] = E * (1 + 0.1 * t); out[1] = E; out[2] = E * (1 - 0.12 * t); out[3] = 1 + B * XR_FIT.GAIN;
  out[4] = (l + (r - l) * XR_FIT.VEIL_SAT) * B * XR_FIT.VEIL; out[5] = (l + (g - l) * XR_FIT.VEIL_SAT) * B * XR_FIT.VEIL; out[6] = (l + (b - l) * XR_FIT.VEIL_SAT) * B * XR_FIT.VEIL;
  out[7] = P.saturation ?? 1; out[8] = P.contrast ?? 1; out[9] = P.lift ?? 0; out[10] = 0; out[11] = 0;
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

// a text sprite: a rounded panel with an optional key chip, redrawn only when the text changes. Canvas 2D where it
// draws text; else (glyphs: true, or a host whose fillText is a no-op) the built-in glyph font into a DataTexture,
// the same layout, no canvas or document needed.
const INK = [27, 18, 10, 1], CREAM = [246, 236, 216, 1], GOLD = [255, 207, 110, 1], PANEL = [27, 18, 10, 0.9], EDGE = [255, 207, 110, 0.6];
function roundRectPath(g, x, y, w, h, r) {
  if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, 0); g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI); g.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); g.closePath();
}
function makeLabel({ width = 0.6, px = 1024, lines = 1, glyphs = false } = {}) {
  const lh = 84, h = lines === 1 ? 128 : 64 + lh * lines;
  let c = null, g = null, img = null, tex;
  if (glyphs) {
    img = createImage(px, h);
    tex = new THREE.DataTexture(new Uint8Array(px * h * 4), px, h);   // rows bottom-up: copied flipped from img
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  } else {
    c = document.createElement('canvas');
    c.width = px; c.height = h;
    tex = new THREE.CanvasTexture(c);
    g = c.getContext('2d');
  }
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  mat.userData.mirageXR = true;
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(width, (width * h) / px, 1);
  sprite.renderOrder = 2001; sprite.visible = false; sprite.userData.collide = false;
  let sText = null, sKey = '', sHead = '', said = null;
  const BODY = 5.6, CHIP = 4.4, HEAD = 5.2;   // glyph cells for the canvas path's 56 / 44 / 52 px fonts
  const wrap = (t, max, measure) => {
    const out = []; let line = '';
    for (const w of String(t).split(/\s+/)) {
      const next = line ? line + ' ' + w : w;
      if (measure(next) > max && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  function drawCanvas(text, key, head) {
    g.clearRect(0, 0, c.width, c.height);
    g.font = '56px system-ui, sans-serif';
    let kw = 0;
    if (key) { g.font = '600 44px ui-monospace, monospace'; kw = g.measureText(key).width + 36 + 24; g.font = '56px system-ui, sans-serif'; }
    const body = wrap(text, c.width - 80 - kw, (s) => g.measureText(s).width).slice(0, lines - (head ? 1 : 0));
    const n = body.length + (head ? 1 : 0), boxH = lines === 1 ? c.height : Math.min(c.height, 64 + lh * n);
    g.fillStyle = 'rgba(27,18,10,0.9)'; g.strokeStyle = 'rgba(255,207,110,0.6)'; g.lineWidth = 4;
    g.beginPath(); roundRectPath(g, 4, 4, c.width - 8, boxH - 8, 28); g.fill(); g.stroke();
    g.textBaseline = 'middle';
    let x = 40, y = lines === 1 ? c.height / 2 : 32 + lh / 2;
    if (head) { g.font = '600 52px system-ui, sans-serif'; g.fillStyle = '#ffcf6e'; g.fillText(head, x, y); y += lh; }
    if (key) {
      g.font = '600 44px ui-monospace, monospace';
      const w = g.measureText(key).width + 36;
      g.fillStyle = '#f6ecd8'; g.beginPath(); roundRectPath(g, x, y - 36, w, 72, 12); g.fill();
      g.fillStyle = '#1b120a'; g.fillText(key, x + 18, y + 2); x += w + 24;
    }
    g.font = '56px system-ui, sans-serif'; g.fillStyle = '#f6ecd8';
    for (const l of body) { g.fillText(l, x, y); y += lh; }
  }
  function drawGlyphs(text, key, head) {
    clearImage(img);
    key = key && glyphText(key); head = head && glyphText(head);
    const kw = key ? textWidth(key, CHIP) + 36 + 24 : 0;
    const body = wrap(glyphText(text), px - 80 - kw, (s) => textWidth(s, BODY)).slice(0, lines - (head ? 1 : 0));
    const n = body.length + (head ? 1 : 0), boxH = lines === 1 ? h : Math.min(h, 64 + lh * n);
    fillRoundRect(img, 4, 4, px - 8, boxH - 8, 28, PANEL);
    fillRoundRect(img, 4, 4, px - 8, boxH - 8, 28, EDGE, 4);
    let x = 40, y = lines === 1 ? h / 2 : 32 + lh / 2;
    if (head) { drawText(img, head, x, y, HEAD, GOLD, true); y += lh; }
    if (key) {
      const w = textWidth(key, CHIP) + 36;
      fillRoundRect(img, x, y - 36, w, 72, 12, CREAM);
      drawText(img, key, x + 18, y + 2, CHIP, INK); x += w + 24;
    }
    for (const l of body) { drawText(img, l, x, y, BODY, CREAM); y += lh; }
    const src = img.data, dst = tex.image.data, row = px * 4;
    for (let r = 0; r < h; r++) dst.set(src.subarray(r * row, r * row + row), (h - 1 - r) * row);
  }
  return {
    sprite,
    /** 'canvas' or 'glyphs' */
    mode: glyphs ? 'glyphs' : 'canvas',
    /** what it shows, as plain text (null: hidden) */
    get text() { return sprite.visible ? said : null; },
    /** text: string | null; key: a chip before it ('Trigger'); head: a bold first line. The box fits the text
     *  (from the top of the sprite down; the rest stays transparent). Positional and compared field by field, so an
     *  unchanged label costs nothing per frame. */
    set(text, key = '', head = '') {
      sprite.visible = !!text;
      if (text === sText && key === sKey && head === sHead) return;
      sText = text; sKey = key; sHead = head;
      said = text ? [key && key + ':', head && head + ' -', text].filter(Boolean).join(' ') : null;
      if (!text) return;
      if (img) drawGlyphs(text, key, head); else drawCanvas(text, key, head);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); mat.dispose(); },
  };
}

/**
 * WebXR for a play. opts: { game, button = true, ar = true, teleport = true, snapTurn = 30 (degrees; 0 = smooth),
 * turnSpeed = 2.5 (rad/s, smooth turning), teleportMaxUp = 1.2 (m), vignette = true, framebufferScale, foveation = 1, frameRate,
 * referenceSpace = 'local-floor', arSize = 0.9 (m across), shadowRadius = 22, onSelect(hand), prompt() -> string | null,
 * offer = true (navigator.xr.offerSession where it exists), autoEnter = false, hands = true, text = 'auto' }
 */
export function createXR(play, opts = {}) {
  const { world } = play;
  const { renderer, scene } = world;
  const xrm = renderer.xr;
  const B = play.walker.body;
  const o = { ar: true, teleport: true, teleportMaxUp: 1.2, snapTurn: 30, turnSpeed: 2.5, vignette: true, foveation: 1, referenceSpace: 'local-floor', arSize: 0.9, button: true,
    offer: true, autoEnter: false, hands: true, text: 'auto', ...opts };
  const game = o.game || null;
  const useHands = o.hands !== false;
  const hasDoc = typeof document !== 'undefined' && !!document && typeof document.createElement === 'function';
  const glyphs = o.text === 'glyphs' || (o.text !== 'canvas' && (!hasDoc || !canvasTextWorks()));
  const listeners = [];
  const listen = (t, ev, fn) => { t.addEventListener(ev, fn); listeners.push(() => t.removeEventListener(ev, fn)); };
  const xrNav = () => (typeof navigator !== 'undefined' && navigator && navigator.xr) || null;

  // ---- the scene graph while presenting: root (world space) > rig (the reference space) > camera, controllers
  const root = new THREE.Group(); root.name = 'mirage-xr'; root.userData.collide = false;
  const rig = new THREE.Group(); rig.name = 'xr-rig';
  const cam = new THREE.PerspectiveCamera(70, 1, 0.08, 3000);
  rig.add(cam); root.add(rig);
  const own = [];   // geometries and materials to dispose

  // the meter: twice a second a 32 x 32 HDR view from the head (XR off, the shadow map reused, no tone mapping),
  // read back without a stall (pixel-pack buffer + fence, picked up a frame or more later): the mean radiance the
  // desktop bloom spreads over the frame (setGrade's veil), so lamps at dusk glow as they do on the desktop
  const meter = { rt: null, cam: new THREE.PerspectiveCamera(90, 1, 0.08, 3000), buf: null, sync: null, px: new Float32Array(32 * 32 * 4), mean: null, store: [0, 0, 0], next: 0, dt: 1, pts: [] };
  // points (stars, snow) are at least one pixel each: at 32 x 32 they would weigh ten times what they do on screen
  const hidePoints = (x) => { if (x.isPoints && x.visible) { meter.pts.push(x); x.visible = false; } };
  function meterFrame() {
    const time = F.time, gl = renderer.getContext();
    if (!gl.fenceSync) return;
    if (meter.sync) {
      const st = gl.clientWaitSync(meter.sync, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return;
      gl.deleteSync(meter.sync); meter.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, meter.px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const px = meter.px, n = px.length / 4;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) {
        const vr = px[i], vg = px[i + 1], vb = px[i + 2];
        if (vr === vr && vr < 6e4) r += vr;
        if (vg === vg && vg < 6e4) g += vg;
        if (vb === vb && vb < 6e4) b += vb;
      }
      const m = meter.store;
      if (!meter.mean) { m[0] = r / n; m[1] = g / n; m[2] = b / n; meter.mean = m; }
      else { const k = Math.min(1, meter.dt * 3); m[0] = m[0] + (r / n - m[0]) * k; m[1] = m[1] + (g / n - m[1]) * k; m[2] = m[2] + (b / n - m[2]) * k; }
      return;
    }
    if (time < meter.next) return;
    meter.dt = meter.next ? (time - meter.next + 500) / 1000 : 1; meter.next = time + 500;
    if (!meter.rt) meter.rt = new THREE.WebGLRenderTarget(32, 32, { type: THREE.HalfFloatType, depthBuffer: true });
    cam.getWorldPosition(meter.cam.position); cam.getWorldQuaternion(meter.cam.quaternion); meter.cam.updateMatrixWorld();
    const saved = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate, vis = root.visible;
    xrm.enabled = false; renderer.shadowMap.autoUpdate = false; root.visible = false;
    meter.pts.length = 0; scene.traverse(hidePoints);
    try {
      renderer.setRenderTarget(meter.rt); renderer.clear(); renderer.render(scene, meter.cam);
      if (!meter.buf) { meter.buf = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, meter.px.byteLength, gl.STREAM_READ); }
      else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meter.buf);
      gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      meter.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    } finally {
      renderer.setRenderTarget(saved); renderer.shadowMap.autoUpdate = auto; root.visible = vis; xrm.enabled = true;
      for (let i = 0; i < meter.pts.length; i++) meter.pts[i].visible = true;
      meter.pts.length = 0;
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

  // controllers: a ray and a small body; select = interact, the gamepad is read every frame. A tracked hand in the
  // same slot: three's hand joints (xrm.getHand, reference space; not in the scene), the gestures of xr-hands.js
  // and a ray from the index finger (a child of the rig) instead of the controller's ray and body.
  const hands = [0, 1].map((i) => {
    const ray = xrm.getController(i), grip = xrm.getControllerGrip(i);
    const line = keep(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffe3a8, transparent: true, opacity: 0.55, fog: false, toneMapped: false })));
    line.scale.z = 1.2; ray.add(line);
    const body = keep(new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.09, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, fog: false })));
    body.rotation.x = Math.PI / 2 - 0.5; body.position.set(0, -0.01, 0.04); grip.add(body);
    rig.add(ray, grip);
    const h = { i, ray, grip, line, body, source: null, handedness: '', isHand: false, tracked: false,
      hand: null, joints: null, gesture: null, pointer: null, rayLocal: null };
    if (useHands) {
      h.hand = xrm.getHand(i);
      h.joints = new Float32Array(HAND_JOINTS.length * 3);
      h.gesture = createHandGesture(o.handGesture);
      h.rayLocal = new Float32Array(6);
      h.pointer = keep(new THREE.Line(line.geometry.clone(), line.material.clone()));
      h.pointer.scale.z = 1.2; h.pointer.visible = false; h.pointer.frustumCulled = false;
      rig.add(h.pointer);
    }
    listen(ray, 'connected', (e) => {
      h.source = e.data; h.handedness = e.data.handedness; h.isHand = useHands && !!e.data.hand;
      line.visible = body.visible = !h.isHand;
    });
    listen(ray, 'disconnected', () => {
      h.source = null; h.handedness = ''; h.isHand = false; h.tracked = false; line.visible = body.visible = true;
      if (h.pointer) { h.pointer.visible = false; h.gesture.reset(); }
    });
    listen(ray, 'select', () => { if (!h.isHand) onSelect(h); });   // a tracked hand's pinch: the gestures below
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
  const prompt = makeLabel({ width: 0.8, glyphs }), panel = makeLabel({ width: 0.95, lines: 4, glyphs });
  root.add(arc, ring, prompt.sprite, panel.sprite);

  // ---- state
  let session = null, mode = null, align = true, armed = true, ending = null, saved = null;
  // the frame's numbers live on an object: a double in a closure variable is a new heap number at every write
  const F = { last: 0, T: 0, rigYaw: 0, vigS: 0, blink: 0, uiNext: 0, dt: 0, time: 0 };   // dt, time: this frame's (s, ms)
  const head = new THREE.Vector3(), headQ = new THREE.Quaternion(), prevHead = new THREE.Vector3();
  let hasHead = false;
  // teleport: by the right stick ('stick') or a pointing hand ('hand'); target is `at` (or null)
  const tele = { aiming: false, valid: false, target: null, hand: null, by: null, at: [0, 0, 0] };
  const ar = { culled: null, placed: false, scale: 1, yaw: 0, at: new THREE.Vector3(), hitSource: null, hit: null, hitV: new THREE.Vector3(), anchor: new THREE.Vector3(), extent: 1, since: 0 };
  const pads = { move: [0, 0], turn: [0, 0], run: false, jump: false, jumpPrev: false, jumpEdge: false };
  const stats = { frames: 0, ms: 0, sessions: 0 };
  let near = null, uiMsg = null, uiHead = '';
  let trace = null;   // tests: an array receives { dt, x, z, pos, blocked, yaw } per frame
  // scratch the frame reuses: the merged input, the shadow region, renderDirect's options, the panel's goal
  const merged = { x: 0, z: 0, up: 0, run: false, jump: false, jumpPressed: false };
  const roomMove = [0, 0];   // the head's walk around the room this frame, as stick units (see mergeInput)
  const shadowOpt = { center: [0, 0, 0], radius: 22 };
  const direct = { camera: cam, shadow: shadowOpt, fog: undefined };
  const panelGoal = new THREE.Vector3(), _want = new THREE.Vector3();
  let panelPlaced = false;

  // ---- buttons (none where the page has no document: a native host offers the session instead, below)
  let bar = null;
  const buttons = {};
  if (o.button && hasDoc && (document.body || (typeof HTMLElement !== 'undefined' && o.button instanceof HTMLElement))) {
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
    (typeof HTMLElement !== 'undefined' && o.button instanceof HTMLElement ? o.button : document.body).appendChild(bar);
  }
  let disposed = false;
  const support = (o.support ? Promise.resolve(o.support) : xrSupport()).then((s) => {
    if (buttons['immersive-vr']) buttons['immersive-vr'].hidden = !s.vr;
    if (buttons['immersive-ar']) buttons['immersive-ar'].hidden = !(s.ar && o.ar);
    autoStart(s);
    return s;
  });

  // ---- session
  const MODES = ['immersive-vr', 'immersive-ar'];
  const sessionInit = (m) => m === 'immersive-ar' ? { optionalFeatures: useHands ? ['local-floor', 'hit-test', 'hand-tracking'] : ['local-floor', 'hit-test'] }
    : { optionalFeatures: useHands ? ['local-floor', 'bounded-floor', 'layers', 'hand-tracking'] : ['local-floor', 'bounded-floor', 'layers'] };
  async function enter(m = 'immersive-vr') {
    if (session) return session;
    const x = xrNav();
    if (!x) throw new Error('WebXR is not available in this browser');
    const s = await x.requestSession(m, sessionInit(m));
    try { await begin(s, m); } catch (err) { try { await s.end(); } catch { /* already ended */ } throw err; }
    return s;
  }

  // offerSession: the platform starts the session (Quest Browser's own Enter VR; a native host that enters on
  // launch grants it at once). Offered again after each session ends; `autoEnter` offers, or (no offerSession)
  // requests a session as soon as support is known.
  const autoMode = MODES.includes(o.autoEnter) ? o.autoEnter : o.autoEnter ? 'immersive-vr' : null;
  const offerMode = autoMode || (MODES.includes(o.offer) ? o.offer : o.offer ? 'immersive-vr' : null);
  let offering = null, offers = 0, known = null;
  function offer() {
    const x = xrNav();
    if (disposed || session || offering || !offerMode || !known || !(offerMode === 'immersive-ar' ? known.ar : known.vr)) return false;
    if (!x || typeof x.offerSession !== 'function') return false;
    const m = offerMode;
    let p;
    try { p = x.offerSession(m, sessionInit(m)); } catch (err) { console.warn('mirage xr: offerSession', err); return false; }
    offering = p; offers++;
    p.then((s) => {
      if (offering === p) offering = null;
      if (disposed || session) { s.end().catch(() => {}); return; }
      begin(s, m).catch((err) => { console.warn('mirage xr:', err); s.end().catch(() => {}); });
    }, () => { if (offering === p) offering = null; });   // superseded, declined, or a session was already running
    return true;
  }
  function autoStart(s) {
    known = s;
    if (offer() || !autoMode || session || disposed) return;
    if (!(autoMode === 'immersive-ar' ? s.ar : s.vr)) return;
    enter(autoMode).catch((err) => console.warn('mirage xr: autoEnter needs a user gesture here; use the Enter VR button', err));
  }

  async function begin(s, m) {
    const ctx = renderer.getContext(), attrs = ctx.getContextAttributes && ctx.getContextAttributes();
    if (attrs && !attrs.antialias) console.warn('mirage xr: the canvas context has no MSAA, so the headset image will not either; create the world with { xr: true }');
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
    F.T = play.clock; F.last = 0; align = true; hasHead = false; armed = true; stats.sessions++; meter.mean = null; meter.next = 0;
    Object.assign(tele, { aiming: false, valid: false, target: null, hand: null, by: null });
    F.uiNext = 0; panelPlaced = false;
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
    for (const h of hands) { h.tracked = false; if (h.pointer) { h.pointer.visible = false; h.gesture.reset(); } }
    session = null; mode = null; saved = null;
    play.syncWalkerView();
    play.start();
    if (ending) { ending(); ending = null; }
    if (!disposed) offer();
  }

  function exit() {
    if (!session) return Promise.resolve();
    return new Promise((r) => { ending = r; session.end().catch(() => onEnd()); });
  }

  // ---- input
  const btn = (gp, k) => !!(gp.buttons[k] && (gp.buttons[k].pressed || gp.buttons[k].value > 0.5));
  function readPads() {
    let mx = 0, my = 0, tx = 0, ty = 0, run = false, jump = false;
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i], src = h.source, gp = src && src.gamepad;
      if (!gp || h.isHand) continue;
      const a = gp.axes, four = a.length >= 4, sx = (four ? a[2] : a[0]) || 0, sy = (four ? a[3] : a[1]) || 0;
      // dead zone 0.15, then 0..1 over the rest of the throw
      const l = Math.hypot(sx, sy), k = l < 0.15 ? 0 : Math.min(1, (l - 0.15) / 0.85) / l;
      if (h.handedness === 'left') { mx = k ? sx * k : 0; my = k ? sy * k : 0; run = run || btn(gp, 1) || btn(gp, 3); }
      else { tx = k ? sx * k : 0; ty = k ? sy * k : 0; jump = jump || btn(gp, 4); }
    }
    pads.move[0] = mx; pads.move[1] = my; pads.turn[0] = tx; pads.turn[1] = ty; pads.run = run;
    pads.jumpEdge = jump && !pads.jumpPrev; pads.jumpPrev = jump; pads.jump = jump;
  }

  function mergeInput(base, dt) {
    merged.x = (base.x || 0) + pads.move[0] + roomMove[0];
    merged.z = (base.z || 0) - pads.move[1] + roomMove[1];
    merged.up = base.up;
    merged.run = !!base.run || pads.run; merged.jump = !!base.jump || pads.jump; merged.jumpPressed = !!base.jumpPressed || pads.jumpEdge;
    return merged;
  }

  function haptic(h, v = 0.5, ms = 40) {
    const a = h && h.source && h.source.gamepad && h.source.gamepad.hapticActuators;
    if (a && a[0] && a[0].pulse) try { a[0].pulse(v, ms); } catch { /* not supported */ }
  }

  function onSelect(h) {
    if (!session) return;
    if (mode === 'ar') { if (ar.hit) placeAR(ar.hit); return; }
    if (tele.aiming) return;
    act(h);
  }
  // the game's interact (or Continue on its message), then the page's onSelect
  function act(h) {
    if (game) {
      const d = game.ui && game.ui.open;
      if (d) { d.close(); haptic(h, 0.3); F.uiNext = 0; return; }   // a message (or menu) is up: Continue
      if (game.input && near) { game.input.tap('interact'); haptic(h); F.uiNext = 0; }
    }
    if (o.onSelect) o.onSelect(h.handedness);
  }

  // ---- teleport: a ballistic arc over the walk grid (walls and roofs stop it, it lands where the walker fits)
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _vel = new THREE.Vector3(), sup = [0, 0];
  // grid.support without its array: the highest floor at most `step` above y and its ceiling, in sup
  function support2(grid, x, z, y, step) {
    // the arrays directly only on a plain grid: a view made over one (nav.grid with obstacles: Object.create(grid)) is asked through its supportAt
    if (!grid.floors || !grid.count || !grid.idx || Object.getPrototypeOf(grid) !== Object.prototype) { const s = grid.support(x, z, y, step); if (!s) return false; sup[0] = s[0]; sup[1] = s[1]; return true; }
    const k = grid.idx(x, z);
    if (k < 0) return false;
    for (let l = grid.count[k] - 1; l >= 0; l--) {
      const f = grid.floors[(k * MAXL + l) * 2];
      if (f <= y + step) { sup[0] = f; sup[1] = grid.floors[(k * MAXL + l) * 2 + 1]; return true; }
    }
    return false;
  }
  function aimRay(h) {
    h.ray.updateMatrixWorld(true);
    _p.setFromMatrixPosition(h.ray.matrixWorld);
    _d.set(0, 0, -1).transformDirection(h.ray.matrixWorld);
    aim(_p, _d);
  }
  // from p along d (world space; both overwritten)
  function aim(p, d) {
    _vel.copy(d).multiplyScalar(8);
    const pos = arc.geometry.attributes.position, grid = play.grid, w = play.walker;
    let n = 0, hit = false, hx = 0, hy = 0, hz = 0, hc = 0;
    pos.setXYZ(n++, p.x, p.y, p.z);
    for (let i = 1; i < ARC && !hit; i++) {
      const prevY = p.y;
      for (let k = 0; k < 2; k++) { _vel.y -= 9.81 * 0.02; p.addScaledVector(_vel, 0.02); }
      pos.setXYZ(n++, p.x, p.y, p.z);
      if (!support2(grid, p.x, p.z, p.y, 0) || p.y > sup[1]) {
        // under every floor here: the arc went through one this step (land on it) or into a solid (stop)
        if (support2(grid, p.x, p.z, p.y, Math.max(0.6, prevY - p.y + 0.05)) && _vel.y < 0 && sup[0] > p.y && sup[0] <= prevY + 0.05) { hit = true; hx = p.x; hy = sup[0]; hz = p.z; hc = sup[1]; }
        else break;
      }
    }
    for (let k = n; k < ARC; k++) pos.setXYZ(k, p.x, p.y, p.z);
    pos.needsUpdate = true;
    let ok = hit;
    if (ok) ok = hy - w.pos[1] <= o.teleportMaxUp;   // no roofs and wall tops: what a climb could not reach
    if (ok) ok = typeof w.fits === 'function' ? w.fits(hx, hz, hy) : hc - hy >= B.head;
    tele.valid = ok;
    if (hit) { tele.at[0] = hx; tele.at[1] = hy; tele.at[2] = hz; tele.target = tele.at; } else tele.target = null;
    arc.material.color.setHex(ok ? 0x9fe8ff : 0xff8a6a);
    ring.visible = ok;
    if (ok) ring.position.set(hx, hy + 0.02, hz);
    arc.visible = true;
  }
  function teleport(to) {
    const w = play.walker;
    if (typeof w.place === 'function') w.place([to[0], to[1] + 0.05, to[2]]);
    play.syncWalkerView();
    F.blink = 1;
  }
  function stopAim() { tele.aiming = false; tele.by = null; tele.hand = null; arc.visible = false; ring.visible = false; }

  // ---- hands: joints from three (reference space), gestures, the index ray; 'act' and 'teleport'
  function stepHands() {
    const time = F.time;
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      if (!h.pointer) continue;
      const J = h.isHand && h.hand.visible ? h.hand.joints : null;
      let ok = !!J;
      if (ok) for (let k = 0; k < HAND_JOINTS.length; k++) {
        const jt = J[HAND_JOINTS[k]];
        if (!jt || !jt.visible) { ok = false; break; }
        h.joints[k * 3] = jt.position.x; h.joints[k * 3 + 1] = jt.position.y; h.joints[k * 3 + 2] = jt.position.z;
      }
      if (!ok) {
        if (h.tracked) { h.tracked = false; h.gesture.reset(); h.pointer.visible = false; if (tele.hand === h) stopAim(); }
        continue;
      }
      h.tracked = true;
      const g = h.gesture, ev = g.update(h.joints, time / 1000), r = indexRay(h.joints, h.rayLocal);
      // the index ray, in the reference space (the rig)
      h.pointer.position.set(r[0], r[1], r[2]);
      h.pointer.quaternion.setFromUnitVectors(_fw.set(0, 0, -1), _w.set(r[3], r[4], r[5]));
      h.pointer.visible = !g.aiming && !g.armed;
      if (mode === 'vr' && o.teleport && (tele.by === null || tele.hand === h)) {
        if (g.aiming) {   // aim along the finger, in the world
          rig.localToWorld(_p.set(r[0], r[1], r[2]));
          _d.set(r[3], r[4], r[5]).transformDirection(rig.matrixWorld);
          tele.aiming = true; tele.by = 'hand'; tele.hand = h; aim(_p, _d);
        } else if (tele.by === 'hand' && !g.armed && ev !== 'teleport') stopAim();   // let go without a pinch
      }
      if (ev === 'teleport') {
        if (tele.hand === h && tele.valid && tele.target) teleport(tele.target);
        if (tele.hand === h) stopAim();
      } else if (ev === 'act') {
        if (mode === 'ar') { if (ar.hit) placeAR(ar.hit); } else if (!tele.aiming) act(h);
      }
    }
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
  function stepAR(xrFrame) {
    const dt = F.dt;
    ar.since += dt;
    ar.hit = null;
    if (ar.hitSource) {
      const r = xrFrame.getHitTestResults(ar.hitSource);
      const pose = r.length && r[0].getPose(xrm.getReferenceSpace());
      if (pose) { const t = pose.transform.position; ar.hit = ar.hitV.set(t.x, t.y, t.z); }
    }
    if (!ar.placed && !ar.hit && ar.since > 1.5 && hasHead) {   // no hit test here: the floor in front of you
      const f = _v.set(0, 0, -1).applyQuaternion(headQ).setY(0);
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      placeAR(_w.set(head.x + f.x * 1.2, 0, head.z + f.z * 1.2));
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
  function stepVR() {
    const dt = F.dt, time = F.time;
    let h = hands[1];
    for (let i = 0; i < hands.length; i++) if (hands[i].handedness === 'right') { h = hands[i]; break; }
    const tx = pads.turn[0], ty = pads.turn[1];
    // right stick: forward aims a teleport, sideways turns
    if (o.teleport && tele.by !== 'hand' && (tele.aiming ? ty < -0.3 : ty < -0.7 && Math.abs(ty) > Math.abs(tx))) { tele.aiming = true; tele.by = 'stick'; tele.hand = h; aimRay(h); }
    else if (tele.aiming && tele.by === 'stick') {
      const go = tele.valid && tele.target;
      stopAim();
      if (go) { teleport(tele.target); haptic(h, 0.4, 30); }
    } else if (o.snapTurn > 0) {
      if (armed && Math.abs(tx) > 0.7) { F.rigYaw -= Math.sign(tx) * (o.snapTurn * Math.PI) / 180; armed = false; F.blink = Math.max(F.blink, 0.5); }
      if (Math.abs(tx) < 0.3) armed = true;
    } else F.rigYaw -= tx * o.turnSpeed * dt;
    if (useHands) stepHands();
    // the head's yaw and pitch in the world drive play (walk direction, game's look direction, audio)
    const f = _v.set(0, 0, -1).applyQuaternion(headQ);
    const localYaw = Math.atan2(f.z, f.x);
    play.yaw = localYaw - F.rigYaw;
    play.pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
    // walking around the room: the head's move this frame, as stick units in play's frame (relative to play.yaw)
    roomMove[0] = 0; roomMove[1] = 0;
    const cy = Math.cos(F.rigYaw), sy = Math.sin(F.rigYaw);
    if (hasHead && dt > 0) {
      const dx = head.x - prevHead.x, dz = head.z - prevHead.z;
      if (Math.hypot(dx, dz) < 0.5) {   // larger: a reference-space reset, not a step
        const wx = dx * cy + dz * sy, wz = -dx * sy + dz * cy, sp = (pads.run ? B.run : B.walk) * dt;
        const fy = play.yaw, cf = Math.cos(fy), sf = Math.sin(fy);
        roomMove[0] = (wx * -sf + wz * cf) / sp; roomMove[1] = (wx * cf + wz * sf) / sp;
      }
    }
    prevHead.copy(head);
    const from = trace ? play.walker.pos.slice() : null;
    play.step(dt);
    // the rig: feet at the walker's eased view position, the head above them
    const c = world.camera.position, ox = head.x * cy + head.z * sy, oz = -head.x * sy + head.z * cy;
    rig.position.set(c.x - ox, c.y - B.eye, c.z - oz);
    rig.rotation.set(0, F.rigYaw, 0);
    rig.scale.setScalar(1);
    // in-world prompt and messages for a game
    near = null;
    const key = handsActive() ? 'Pinch' : 'Trigger';
    if (game) {
      near = game.near || null;
      const ui = game.ui;
      let label = near ? (game.game.label ? game.game.label(near) : '') : null;
      if (o.prompt) label = o.prompt();
      prompt.set(label || null, key);
      if (near && label) { const p = game.game.where(near); prompt.sprite.position.set(p[0], p[1] + 0.38, p[2]); }
      // the game's DOM (its message dialog, its toasts) mirrored on the panel, read ten times a second
      if (time >= F.uiNext) {
        F.uiNext = time + 100;
        const r = ui && ui.root, d = ui && ui.open;
        uiMsg = null; uiHead = '';
        if (d && r) { uiHead = (d.querySelector('h2') || {}).textContent || ''; uiMsg = d.classList.contains('mg-msg') ? (r.querySelector('.mg-msg-p') || {}).textContent || ' ' : handsActive() ? 'Paused: pinch to resume' : 'Paused: trigger to resume'; }
        else if (r) { const t = r.querySelector('.mg-toast.on'); if (t && t.textContent) uiMsg = t.textContent; }
      }
      panel.set(uiMsg, '', uiHead);
    } else if (o.prompt) {
      const label = o.prompt();
      prompt.set(label || null, key);
      if (label) { cam.getWorldPosition(_v); const fw = _fw.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)); prompt.sprite.position.copy(_v).addScaledVector(fw, 1.3).y -= 0.25; }
    }
    // comfort vignette: with stick motion and smooth turning
    const motion = o.vignette ? Math.min(1, Math.hypot(pads.move[0], pads.move[1]) * (pads.run ? 1 : 0.7) + (o.snapTurn > 0 ? 0 : Math.abs(tx) * 0.8)) : 0;
    F.vigS += (motion - F.vigS) * Math.min(1, dt * 6);
    if (trace) trace.push({ dt, x: pads.move[0], z: -pads.move[1], run: pads.run, from, pos: play.walker.pos.slice(), blocked: play.walker.blocked, onGround: play.walker.onGround, yaw: play.yaw });
  }
  // tracked hands and no controller: prompts say Pinch
  function handsActive() {
    let hand = false;
    for (let i = 0; i < hands.length; i++) { if (hands[i].source && !hands[i].isHand) return false; if (hands[i].tracked) hand = true; }
    return hand;
  }

  // a shadow region around the view, snapped to whole shadow texels (as play.js does), into shadowOpt
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function shadowAround(p, R) {
    const d = world.keyDir;
    _r.crossVectors(Y, d); if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0); _r.normalize();
    _u.crossVectors(d, _r);
    const step = ((2 * R) / world.sun.shadow.mapSize.x) * 8;
    const a = Math.round(p.dot(_r) / step) * step, b = Math.round(p.dot(_u) / step) * step, c = Math.round(p.dot(d) / 2) * 2;
    _c.set(0, 0, 0).addScaledVector(_r, a).addScaledVector(_u, b).addScaledVector(d, c);
    _c.toArray(shadowOpt.center); shadowOpt.radius = R;
    return shadowOpt;
  }

  function frame(time, xrFrame) {
    if (!session || !xrFrame) return;
    const t0 = performance.now();
    const dt = F.last ? Math.max(0, Math.min((time - F.last) / 1000, 0.1)) : 0;
    F.last = time; F.dt = dt; F.time = time;
    const pose = xrFrame.getViewerPose(xrm.getReferenceSpace());
    if (pose) {
      const p = pose.transform.position, q = pose.transform.orientation;
      head.set(p.x, p.y, p.z); headQ.set(q.x, q.y, q.z, q.w);
      if (!hasHead) prevHead.copy(head);
      if (align) {   // face where the desktop view faced
        const f = _v.set(0, 0, -1).applyQuaternion(headQ);
        F.rigYaw = Math.atan2(f.z, f.x) - play.yaw; align = false;
      }
      hasHead = true;
    }
    readPads();
    if (mode === 'vr') stepVR(); else { if (useHands) stepHands(); stepAR(xrFrame); }
    F.T += dt;
    F.blink = Math.max(0, F.blink - dt * 5);
    vig.material.uniforms.uS.value = F.vigS; vig.material.uniforms.uBlack.value = Math.min(1, F.blink * 1.5);
    vig.visible = F.vigS > 0.01 || F.blink > 0;
    // panel: lazily follows the head, 1.4 m out, a little below the eyes
    if (panel.sprite.visible) {
      const s = rig.scale.x;
      cam.getWorldPosition(_v);
      const fw = _fw.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)).setY(0).normalize();
      const want = _want.copy(_v).addScaledVector(fw, 1.4 * s); want.y -= 0.18 * s;
      if (panel.sprite.position.distanceTo(want) > 0.5 * s || !panelPlaced) panelGoal.copy(want);
      panel.sprite.position.lerp(panelGoal, panelPlaced ? Math.min(1, dt * 4) : 1);
      panelPlaced = true;
      panel.sprite.scale.set(0.95 * s, (0.95 * s * 400) / 1024, 1);
    } else panelPlaced = false;
    // light: eased exposure, environment fades (full-screen passes: XR off), then one stereo draw
    xrm.enabled = false;
    try { world.tick(dt); } finally { xrm.enabled = true; }
    if (mode === 'vr' && o.meter !== false) meterFrame();
    grade(world, mode === 'vr' ? meter.mean : ZERO3, XR_GRADE);
    if (mode === 'ar') { ar.anchor.toArray(shadowOpt.center); shadowOpt.radius = ar.extent * 0.75; direct.fog = 1 / ar.scale; }
    else {
      cam.getWorldPosition(_v);
      const fy = play.yaw, R = o.shadowRadius ?? 22;
      shadowAround(_v.set(_v.x + Math.cos(fy) * R * 0.45, play.walker.pos[1], _v.z + Math.sin(fy) * R * 0.45), R);
      direct.fog = undefined;
    }
    world.renderDirect(F.T, direct);
    stats.frames++; stats.ms = performance.now() - t0;
  }

  function dispose() {
    disposed = true;
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
    /** 'canvas' or 'glyphs': how the in-headset labels draw text */
    get text() { return prompt.mode; },
    /** a pending navigator.xr.offerSession (the platform may start the session), and how many were made */
    get offered() { return !!offering; }, get offers() { return offers; },
    /** put the walker at `eye` and turn the rig so the headset faces `look` (like play.place) */
    place(eye, look) { play.place(eye, look, 'walk'); align = true; },
    /** tests: per-frame records of the stick, the walker and the yaw while `trace` is an array */
    get trace() { return trace; }, set trace(a) { trace = a; },
    /** tests: the prompt and panel sprites (world space) */
    labels: { prompt: prompt.sprite, panel: panel.sprite },
    /** a plain snapshot for tests */
    state: () => ({
      presenting: !!session, mode, rigYaw: +F.rigYaw.toFixed(4), rig: rig.position.toArray().map((v) => +v.toFixed(3)), scale: +rig.scale.x.toFixed(3),
      head: head.toArray().map((v) => +v.toFixed(3)), yaw: +play.yaw.toFixed(4), walker: play.walker.pos.map((v) => +v.toFixed(3)),
      onGround: play.walker.onGround, blocked: play.walker.blocked,
      teleport: { aiming: tele.aiming, valid: tele.valid, target: tele.target && tele.target.map((v) => +v.toFixed(3)), by: tele.by },
      prompt: prompt.text, panel: panel.text, text: prompt.mode,
      hands: hands.map((h) => ({ handedness: h.handedness, hand: h.isHand, tracked: h.tracked, pinching: !!(h.gesture && h.gesture.pinching), pointing: !!(h.gesture && h.gesture.pointing), aiming: !!(h.gesture && h.gesture.aiming) })),
      near: near ? near.id : null, vignette: +F.vigS.toFixed(3), ar: { placed: ar.placed, scale: +ar.scale.toFixed(3), hit: !!ar.hit, hitTest: !!ar.hitSource },
      frames: stats.frames, size: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), meter: meter.mean && meter.mean.map((v) => +v.toFixed(4)),
    }),
  };
}

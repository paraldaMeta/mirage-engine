// Mirage original code. A WebXR device that is not there: the smallest navigator.xr that three's WebXRManager and
// @mirage/play's createXR can run a whole session against, so headless Chrome draws both eyes into a real
// framebuffer that a check can read back. Written for xr-stereo-check.mjs (which injects this file before the
// page's scripts); no code from any emulator.
// ---------------------------------------------------------------------------
// await page.evaluateOnNewDocument(`window.__XR_SHIM = ${JSON.stringify({ eyeW: 1024, eyeH: 1024 })};` + source);
// in the page:  const d = window.__xrShim;
//   d.head.p = [0, 1.6, 0]; d.head.q = [0, 0, 0, 1];          // the tracked poses, in the tracking origin's metres
//   d.controller('right', { p, q, trigger: 1, squeeze: 0, stick: [0, 0] });   d.hand('left', 'fist', { p, q })
//   d.manual = true; d.tick(1000 / 72);                       // one frame by hand (the governor's late frames)
//   d.jointLocal('point', 'right', 9) -> [x, y, z]            // where a joint is in the wrist's frame (to aim a fingertip)
//   d.readEye(0) -> { width, height, data: Uint8Array }       // rows bottom-up, as GL reads them
//   d.log -> { pulses, scales, rate, foveation, ... }         // what the page asked the device for
// ---------------------------------------------------------------------------
// What it is not: a compositor (no reprojection, no lens distortion, no timing of a real display: frames come from
// requestAnimationFrame or tick()), a conformance-level WebXR (only what the engine calls), or layers
// (XRWebGLBinding is hidden so three takes the XRWebGLLayer path: one framebuffer, the eyes side by side).
// ponytail: the layer's MSAA is a 4-sample renderbuffer resolved after each frame, which is what a headset's
// opaque framebuffer does but not necessarily with its sample count or resolve filter.
(() => {
  const C = { eyeW: 1024, eyeH: 1024, fovY: 90, ipd: 0.063, hz: 72, nativeScale: 1.2, vr: true, ar: true, hands: true, controllers: true,
    bounds: [[-1.5, -1], [1.5, -1], [1.5, 1], [-1.5, 1]], hitY: 0, samples: 4, ...(window.__XR_SHIM || {}) };
  // ---- rigid transforms (column-major 4 x 4, as WebXR gives them)
  const compose = (p, q) => {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
    return new Float32Array([1 - y * y2 - z * z2, x * y2 + w * z2, x * z2 - w * y2, 0, x * y2 - w * z2, 1 - x * x2 - z * z2, y * z2 + w * x2, 0,
      x * z2 + w * y2, y * z2 - w * x2, 1 - x * x2 - y * y2, 0, p[0], p[1], p[2], 1]);
  };
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const inv = (m) => {   // rotation + translation only
    const o = new Float32Array([m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]);
    o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]); o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]); o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
    return o;
  };
  const quatOf = (m) => {
    const t = m[0] + m[5] + m[10];
    let x, y, z, w;
    if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); w = 0.25 / s; x = (m[6] - m[9]) * s; y = (m[8] - m[2]) * s; z = (m[1] - m[4]) * s; }
    else if (m[0] > m[5] && m[0] > m[10]) { const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]); w = (m[6] - m[9]) / s; x = 0.25 * s; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
    else if (m[5] > m[10]) { const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]); w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = 0.25 * s; z = (m[9] + m[6]) / s; }
    else { const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]); w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = 0.25 * s; }
    return { x, y, z, w };
  };
  const rigid = (m) => ({ matrix: m, position: { x: m[12], y: m[13], z: m[14], w: 1 }, orientation: quatOf(m), get inverse() { return rigid(inv(m)); } });
  const I = () => compose([0, 0, 0], [0, 0, 0, 1]);
  const space = (get, extra) => ({ get, lost: false, getOffsetReferenceSpace(t) { return space(() => mul(get(), t.matrix), extra); }, addEventListener() {}, removeEventListener() {}, ...extra });
  const point = (x, y, z) => ({ x, y, z, w: 1 });

  // ---- a hand: 25 joints (the WebXR order) from finger curls; wrist at the origin, fingers along -z, palm down
  const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
    ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap((f) => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((s) => `${f}-${s}`))];
  const POSES = {   // curl per finger (0 straight .. 1 closed): index, middle, ring, pinky; thumb in (0 out .. 1 across the palm)
    relaxed: { curl: [0.12, 0.15, 0.18, 0.2], thumb: 0.1 }, fist: { curl: [1, 1, 1, 1], thumb: 0.9 },
    point: { curl: [0, 1, 1, 1], thumb: 0.9 }, pinch: { curl: [0.45, 0.2, 0.2, 0.25], thumb: 0.3, pinch: true },
  };
  function handJoints(pose, side) {
    const P = POSES[pose] || POSES.relaxed, sx = side === 'left' ? -1 : 1, out = [[0, 0, 0]];
    // the thumb: off the side of the palm, turning in with `thumb`
    { const a = 0.9 - P.thumb * 0.9, d = [Math.sin(a) * -sx, -0.25 * P.thumb, -Math.cos(a)]; let p = [-0.022 * sx, -0.005, -0.025];
      out.push(p.slice());
      for (const l of [0.034, 0.03, 0.024]) { p = [p[0] + d[0] * l, p[1] + d[1] * l, p[2] + d[2] * l]; out.push(p.slice()); } }
    const X = [-0.024, -0.004, 0.014, 0.03], META = [0.068, 0.066, 0.06, 0.054], SEG = [[0.04, 0.024, 0.02], [0.044, 0.028, 0.02], [0.04, 0.026, 0.02], [0.032, 0.02, 0.018]];
    for (let f = 0; f < 4; f++) {
      let p = [X[f] * sx, 0, -0.02]; out.push(p.slice());
      p = [X[f] * sx, 0, -0.02 - META[f]]; out.push(p.slice());   // the knuckle
      let a = 0;
      for (const l of SEG[f]) { a += P.curl[f] * 1.45; p = [p[0], p[1] - Math.sin(a) * l, p[2] - Math.cos(a) * l]; out.push(p.slice()); }
    }
    if (P.pinch) out[4] = out[9].map((v, i) => v + (i === 1 ? -0.004 : 0));   // thumb tip on the index tip
    return out;
  }

  // ---- the device's state (what a check moves)
  const mkPad = () => ({ mapping: 'xr-standard', connected: true, id: 'mirage-xr-shim', index: -1, timestamp: 0,
    buttons: Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0], hapticActuators: null, vibrationActuator: null });
  const D = {
    config: C, manual: false, head: { p: [0, 1.6, 0], q: [0, 0, 0, 1] }, session: null, frames: 0, time: 0,
    log: { pulses: [], scales: [], rate: null, foveation: null, init: null, spaces: [], anchors: 0, overlay: null },
    sources: [], anchors: new Set(), planes: new Set(),
    light: { direction: [0.3, 0.8, 0.52], intensity: [2.2, 2.0, 1.7], sh: new Float32Array(27).fill(0.25) },
    /** move / press a controller: { p, q, trigger, squeeze, stick: [x, y], click (the stick's), a, b } */
    controller(hand, s = {}) {
      const src = D.sources.find((x) => x.handedness === hand && !x.hand);
      if (!src) return null;
      if (s.p) src._p = s.p; if (s.q) src._q = s.q;
      const b = src.gamepad.buttons, set = (i, v) => { if (v !== undefined) { b[i].value = +v; b[i].pressed = v > 0.5; b[i].touched = v > 0; } };
      set(0, s.trigger); set(1, s.squeeze); set(3, s.click); set(4, s.a); set(5, s.b);
      if (s.stick) { src.gamepad.axes[2] = s.stick[0]; src.gamepad.axes[3] = s.stick[1]; }
      return src;
    },
    /** swap the input sources: 'controllers' | 'hands' | 'none' (an inputsourceschange at the next frame) */
    input(kind) { D._want = kind; },
    /** pose a tracked hand: pose 'relaxed' | 'fist' | 'point' | 'pinch'; { p, q } of the wrist */
    hand(side, pose, s = {}) {
      const src = D.sources.find((x) => x.handedness === side && x.hand);
      if (!src) return null;
      if (pose) src._pose = pose; if (s.p) src._p = s.p; if (s.q) src._q = s.q;
      return src;
    },
    /** a joint of `pose` in the wrist's frame (k: index in the WebXR joint order; 9 = the index fingertip) */
    jointLocal(pose, side, k = 9) { return handJoints(pose, side)[k].slice(); },
    /** a full trigger / pinch click on a source: selectstart, select, selectend */
    select(hand) {
      const s = D.session, src = D.sources.find((x) => x.handedness === hand);
      if (!s || !src) return false;
      for (const type of ['selectstart', 'select', 'selectend']) { const e = new Event(type); e.inputSource = src; e.frame = D._frame; s.dispatchEvent(e); }
      return true;
    },
    /** one frame now (manual mode): the time advances by dtMs */
    tick(dtMs = 1000 / C.hz) { if (D.session) D.session._frame(D.time + dtMs); },
    /** eye i of the last frame: { x, y, width, height, data } (RGBA8, rows bottom-up) */
    readEye(i) { const L = D.layer; return L ? L._read(i) : null; },
    /** the device corrects where it believes its anchors are (tracking refined): they all move by [dx, dy, dz] */
    shiftAnchors(d) { for (const a of D.anchors) { a._at = a._at.slice(); a._at[12] += d[0]; a._at[13] += d[1]; a._at[14] += d[2]; } },
    plane(poly, y = 0, orientation = 'horizontal') { const pl = { polygon: poly.map(([x, z]) => point(x, 0, z)), orientation, lastChangedTime: D.time, planeSpace: space(() => compose([0, y, 0], [0, 0, 0, 1])) }; D.planes.add(pl); return pl; },
  };
  window.__xrShim = D;

  function makeSources(kind) {
    const out = [];
    if (kind === 'none') return out;
    for (const hand of ['left', 'right']) {
      const sx = hand === 'left' ? -1 : 1, src = { handedness: hand, targetRayMode: 'tracked-pointer', profiles: [], _p: [0.2 * sx, 1.2, -0.35], _q: [0, 0, 0, 1], _pose: 'relaxed' };
      const pose = () => compose(src._p, src._q);
      if (kind === 'hands') {
        src.profiles = ['generic-hand'];
        const joints = JOINTS.map((jointName, k) => ({ jointName, _k: k, _src: src }));
        src.hand = { size: 25, values: () => joints[Symbol.iterator](), get: (n) => joints[JOINTS.indexOf(n)], [Symbol.iterator]: () => joints.map((j) => [j.jointName, j])[Symbol.iterator]() };
        src.gripSpace = space(pose);
        // the ray from the index knuckle, forward
        src.targetRaySpace = space(() => mul(pose(), compose(handJoints(src._pose, hand)[6], [0, 0, 0, 1])));
      } else {
        src.profiles = ['meta-quest-touch-plus', 'generic-trigger-squeeze-thumbstick'];
        src.gamepad = mkPad();
        src.gamepad.hapticActuators = [{ pulse(v, ms) { D.log.pulses.push({ hand, v: +(+v).toFixed(3), ms: +ms, frame: D.frames }); return Promise.resolve(true); } }];
        src.gripSpace = space(pose);
        src.targetRaySpace = space(pose);
      }
      out.push(src);
    }
    return out;
  }

  // ---- the layer: a framebuffer of its own (the eyes side by side), read back by the check
  class Layer {
    constructor(session, gl, init = {}) {
      const s = Math.min(C.nativeScale, Math.max(0.2, init.framebufferScaleFactor || 1));
      const w = Math.round(C.eyeW * s) * 2, h = Math.round(C.eyeH * s);
      this.framebufferWidth = w; this.framebufferHeight = h; this.antialias = init.antialias !== false; this.ignoreDepthValues = false; this._gl = gl; this._ff = 0;
      D.log.layer = { width: w, height: h, scale: s, antialias: this.antialias, alpha: init.alpha !== false };
      const keep = this._keep(), n = this.antialias ? Math.min(C.samples, gl.getParameter(gl.MAX_SAMPLES)) : 0;
      // the resolved image (a texture): what the compositor would be handed
      this._tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this._resolve = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this._resolve);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._tex, 0);
      const rb = (fmt) => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); if (n) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, fmt, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h); return r; };
      if (n) {
        this.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb(gl.RGBA8));
      } else this.framebuffer = this._resolve;
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb(gl.DEPTH24_STENCIL8));
      this._samples = n; D.log.layer.samples = n; D.log.layer.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      keep();
      D.layer = this;
    }
    // GL bindings this file touches, put back afterwards: three caches them and must not notice
    _keep() {
      const gl = this._gl, r = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), d = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), t = gl.getParameter(gl.TEXTURE_BINDING_2D),
        b = gl.getParameter(gl.RENDERBUFFER_BINDING), sc = gl.isEnabled(gl.SCISSOR_TEST), pk = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      return () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d); gl.bindTexture(gl.TEXTURE_2D, t); gl.bindRenderbuffer(gl.RENDERBUFFER, b);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pk); if (sc) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST); };
    }
    get fixedFoveation() { return this._ff; }
    set fixedFoveation(v) { this._ff = v; D.log.foveation = v; }
    getViewport(view) {
      const w = this.framebufferWidth / 2, k = view._scale;
      return { x: view.eye === 'right' ? w : 0, y: 0, width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(this.framebufferHeight * k)) };
    }
    // after the page's frame: resolve the samples
    _present() {
      const gl = this._gl, w = this.framebufferWidth, h = this.framebufferHeight, keep = this._keep();
      gl.disable(gl.SCISSOR_TEST);
      if (this._samples) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolve); gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
      keep();
    }
    _read(i) {
      const gl = this._gl, w = this.framebufferWidth / 2, k = D._scale[i] ?? 1, vw = Math.max(1, Math.round(w * k)), vh = Math.max(1, Math.round(this.framebufferHeight * k));
      const keep = this._keep(), data = new Uint8Array(vw * vh * 4);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolve); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.readPixels(i * w, 0, vw, vh, gl.RGBA, gl.UNSIGNED_BYTE, data);
      keep();
      return { x: i * w, y: 0, width: vw, height: vh, data };
    }
    static getNativeFramebufferScaleFactor() { return C.nativeScale; }
  }

  // ---- the session
  const SPACES = { viewer: () => space(() => compose(D.head.p, D.head.q)), local: () => space(() => compose([0, 1.6, 0], [0, 0, 0, 1])),
    'local-floor': () => space(I), 'bounded-floor': () => space(I, { boundsGeometry: C.bounds.map(([x, z]) => point(x, 0, z)) }) };
  class Session extends EventTarget {
    constructor(mode, init = {}) {
      super();
      const asked = [...(init.requiredFeatures || []), ...(init.optionalFeatures || [])];
      this._mode = mode; this._cbs = new Map(); this._id = 0; this._ended = false;
      this.enabledFeatures = ['viewer', 'local', ...asked.filter((f) => f !== 'layers' && (f !== 'hand-tracking' || C.hands) && (f !== 'bounded-floor' || C.bounds))];
      this.environmentBlendMode = mode === 'immersive-ar' ? 'alpha-blend' : 'opaque';
      this.visibilityState = 'visible'; this.interactionMode = 'world-space';
      this.frameRate = C.hz; this.supportedFrameRates = new Float32Array([72, 80, 90, 120]);
      this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000, inlineVerticalFieldOfView: null, layers: [] };
      this.domOverlayState = init.domOverlay && this.enabledFeatures.includes('dom-overlay') ? { type: 'screen' } : null;
      this.inputSources = [];
      D.log.init = { mode, features: asked, enabled: this.enabledFeatures }; D.log.overlay = this.domOverlayState && this.domOverlayState.type;
      D._want = C.controllers ? 'controllers' : C.hands ? 'hands' : 'none'; D._scale = [1, 1]; D._next = [1, 1];
      D.frames = 0; D.anchors.clear();
    }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    updateTargetFrameRate(hz) { D.log.rate = hz; this.frameRate = hz; return Promise.resolve(); }
    requestReferenceSpace(type) {
      D.log.spaces.push(type);
      if (!SPACES[type] || (type !== 'viewer' && type !== 'local' && !this.enabledFeatures.includes(type))) return Promise.reject(new DOMException(`${type} is not supported`, 'NotSupportedError'));
      return Promise.resolve(SPACES[type]());
    }
    requestAnimationFrame(cb) { const id = ++this._id; this._cbs.set(id, cb); this._pump(); return id; }
    cancelAnimationFrame(id) { this._cbs.delete(id); }
    requestHitTestSource() { return this.enabledFeatures.includes('hit-test') ? Promise.resolve({ _hit: true, cancel() {} }) : Promise.reject(new DOMException('hit-test', 'NotSupportedError')); }
    requestLightProbe() { return this.enabledFeatures.includes('light-estimation') ? Promise.resolve({ probeSpace: space(I), addEventListener() {}, removeEventListener() {} }) : Promise.reject(new DOMException('light-estimation', 'NotSupportedError')); }
    end() {
      if (this._ended) return Promise.resolve();
      this._ended = true; this._cbs.clear(); D.session = null; D.layer = null;
      this.dispatchEvent(new Event('end'));
      return Promise.resolve();
    }
    _pump() { if (!this._raf && !D.manual && !this._ended) this._raf = requestAnimationFrame((t) => { this._raf = 0; this._frame(t); }); }
    _frame(time) {
      if (this._ended) return;
      D.time = time;
      if (D._want) {   // the sources change between frames, with the event three listens for
        const removed = this.inputSources, added = makeSources(D._want); D._want = null;
        this.inputSources = D.sources = added;
        const e = new Event('inputsourceschange'); e.added = added; e.removed = removed; e.session = this; this.dispatchEvent(e);
      }
      D._scale = D._next.slice();
      const frame = D._frame = makeFrame(this), cbs = [...this._cbs.values()];
      this._cbs.clear();
      for (const cb of cbs) cb(time, frame);
      frame._live = false; D.frames++;
      if (this.renderState.baseLayer) this.renderState.baseLayer._present();
      if (this._cbs.size) this._pump();
    }
  }

  function makeFrame(session) {
    const rel = (sp, base) => mul(inv(base.get()), sp.get());
    const f = {
      session, _live: true, predictedDisplayTime: D.time,
      getViewerPose(base) {
        const near = session.renderState.depthNear, far = session.renderState.depthFar, t = 1 / Math.tan((C.fovY * Math.PI) / 360), a = C.eyeW / C.eyeH;
        // the same matrix three's PerspectiveCamera makes for this lens (so a check can compare like with like)
        const proj = new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, (-2 * far * near) / (far - near), 0]);
        const head = compose(D.head.p, D.head.q), b = inv(base.get());
        const views = ['left', 'right'].map((eye, i) => ({ eye, projectionMatrix: proj, _scale: D._scale[i], recommendedViewportScale: 1,
          transform: rigid(mul(b, mul(head, compose([(i ? 0.5 : -0.5) * C.ipd, 0, 0], [0, 0, 0, 1])))),
          requestViewportScale(s) { if (s > 0) { D._next[i] = Math.min(1, Math.max(0.1, s)); D.log.scales.push({ eye, s: +(+s).toFixed(3), frame: D.frames }); } } }));
        return { transform: rigid(mul(b, head)), views, emulatedPosition: false };
      },
      getPose(sp, base) { return !sp || sp.lost ? null : { transform: rigid(rel(sp, base)), emulatedPosition: false }; },
      getJointPose(joint, base) {
        const src = joint._src, p = handJoints(src._pose, src.handedness)[joint._k];
        return { transform: rigid(mul(inv(base.get()), mul(compose(src._p, src._q), compose(p, [0, 0, 0, 1])))), radius: 0.008 };
      },
      // where the head's forward ray meets the plane y = hitY (a floor or a table)
      getHitTestResults(src) {
        if (!src || !src._hit) return [];
        const m = compose(D.head.p, D.head.q), d = [-m[8], -m[9], -m[10]], o = D.head.p;
        if (d[1] > -0.05) return [];
        const k = (C.hitY - o[1]) / d[1], at = compose([o[0] + d[0] * k, C.hitY, o[2] + d[2] * k], [0, 0, 0, 1]), hit = space(() => at);
        return [{ getPose: (base) => ({ transform: rigid(rel(hit, base)) }), createAnchor: () => f.createAnchor(rigid(I()), hit) }];
      },
      createAnchor(pose, sp) {
        if (!session.enabledFeatures.includes('anchors')) return Promise.reject(new DOMException('anchors', 'NotSupportedError'));
        // _at: where the device believes the anchor is; a check moves it (D.shiftAnchors) as tracking that refines does
        const a = { _at: mul(sp.get(), pose.matrix), anchorSpace: space(() => a._at), delete() { D.anchors.delete(a); } };
        D.anchors.add(a); D.log.anchors++;
        return Promise.resolve(a);
      },
      get trackedAnchors() { return D.anchors; },
      getLightEstimate(probe) {
        if (!probe) return null;
        const L = D.light, n = Math.hypot(...L.direction);
        return { primaryLightDirection: { x: L.direction[0] / n, y: L.direction[1] / n, z: L.direction[2] / n, w: 0 }, primaryLightIntensity: { x: L.intensity[0], y: L.intensity[1], z: L.intensity[2], w: 1 }, sphericalHarmonicsCoefficients: L.sh };
      },
    };
    if (session.enabledFeatures.includes('plane-detection')) f.detectedPlanes = D.planes;
    return f;
  }

  // ---- installed over whatever the browser has
  const xr = new EventTarget();
  xr.isSessionSupported = (m) => Promise.resolve(m === 'immersive-vr' ? !!C.vr : m === 'immersive-ar' ? !!C.ar : m === 'inline');
  xr.requestSession = (m, init) => {
    if (D.session) return Promise.reject(new DOMException('a session is running', 'InvalidStateError'));
    if (!(m === 'immersive-vr' ? C.vr : m === 'immersive-ar' && C.ar)) return Promise.reject(new DOMException(m, 'NotSupportedError'));
    return Promise.resolve((D.session = new Session(m, init)));
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  const def = (k, v) => Object.defineProperty(window, k, { value: v, configurable: true, writable: true });
  def('XRWebGLLayer', Layer); def('XRWebGLBinding', undefined); def('XRSession', Session);
  def('XRRigidTransform', function XRRigidTransform(p = {}, q = {}) { return rigid(compose([p.x || 0, p.y || 0, p.z || 0], [q.x || 0, q.y || 0, q.z || 0, q.w ?? 1])); });
  for (const G of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) if (G) G.prototype.makeXRCompatible = () => Promise.resolve();
})();

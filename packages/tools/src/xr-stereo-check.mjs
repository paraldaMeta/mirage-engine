#!/usr/bin/env node
// Mirage original code. The XR mode's opt-in parts against an emulated session (xr-shim.js, injected before the
// page's scripts): headless Chrome draws both eyes into the shim's framebuffer and this check reads them back.
//   render    each eye of the direct path and of the per-eye post chain (?xrpost=1) against world.renderFrame of the
//             same camera (PSNR; "matched": the desktop frame with the passes a headset does not get switched off),
//             renderer.render passes and draw calls per stereo frame
//   time      the cost of a stereo frame, direct against post: two pages in one Chrome, rounds interleaved
//   governor  late frames step the quality ladder down (?xrbudget=1); on-time frames bring it back
//   interact  ?xrdemo=1: controller grab and throw, snap zone, two-handed turn and scale, poke, ray on a canvas
//             panel, haptic pulses; tracked hands: fingertip poke on the panel, fist grab, pinch
//   move      smooth turn and move with the comfort vignette, teleport, seated height calibration, bounds
//   ar        ?xrar=1: hit test, anchor, plane, light estimation, DOM overlay, transparent clear
// usage: mirage-xr-stereo-check <walled-garden dist> [--out dir] [--only render,time,...] [--eye 1024] [--quality high]
//        [--rounds 6] [--frames 40]
// Everything here is emulation: no compositor, no lens, no real tracking, a desktop GPU (docs/xr.md says so).
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!dir) { console.error('usage: mirage-xr-stereo-check <dist dir> [--out dir] [--only render,time,governor,interact,move,ar]'); process.exit(2); }
const OUT = path.resolve(flag('out', 'out/xr-stereo-check')), EYE = +flag('eye', 1024), QUALITY = flag('quality', 'high');
const ONLY = String(flag('only', 'render,time,governor,interact,move,ar')).split(','), ROUNDS = +flag('rounds', 6), FRAMES = +flag('frames', 40);
const W = 1280, H = 720;
const SHIM = fs.readFileSync(new URL('./xr-shim.js', import.meta.url), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const report = { emulator: 'packages/tools/src/xr-shim.js', eye: EYE, quality: QUALITY, checks: [] };
let failed = 0;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...detail }); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); };
const r3 = (v) => +(+v).toFixed(3);

// ---- in the page: window.__t
function helper() {
  const { world, play, xr } = window.__mirage, D = window.__xrShim, THREE = world.ctx.THREE, R = world.renderer, gl = R.getContext();
  const C = { on: false, passes: 0, calls: 0, tris: 0 }, render = R.render.bind(R);
  R.render = (s, c) => {
    const a = R.info.autoReset ? 0 : R.info.render.calls, t = R.info.autoReset ? 0 : R.info.render.triangles;
    render(s, c);
    if (C.on) { C.passes++; C.calls += R.info.render.calls - a; C.tris += R.info.render.triangles - t; }
  };
  const inv = new THREE.Matrix4(), V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const T = window.__t = {
    eyes: null,
    async enter(mode) { D.manual = true; await xr.enter(mode || 'immersive-vr'); },
    tick(n = 1, dt = 1000 / 72) { for (let i = 0; i < n; i++) D.tick(dt); },
    count(n, dt) { C.passes = C.calls = C.tris = 0; C.on = true; T.tick(n, dt); C.on = false; return { passes: C.passes / n, calls: C.calls / n, tris: Math.round(C.tris / n) }; },
    // world -> the reference space (what the device reports poses in)
    toRef(p) { xr.rig.updateMatrixWorld(true); return V(p).applyMatrix4(inv.copy(xr.rig.matrixWorld).invert()).toArray(); },
    qRef(q) { return xr.rig.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion(q[0], q[1], q[2], q[3])).toArray(); },
    // the orientation whose -z looks from `from` to `to`
    aimQ(from, to) { return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(V(from), V(to), new THREE.Vector3(0, 1, 0))).toArray(); },
    ctl(hand, s) { const o = { ...s }; if (s.p) o.p = T.toRef(s.p); if (s.q) o.q = T.qRef(s.q); return !!D.controller(hand, o); },
    hand(side, pose, s = {}) { const o = {}; if (s.p) o.p = T.toRef(s.p); if (s.q) o.q = T.qRef(s.q); return !!D.hand(side, pose, o); },
    wpos(obj) { obj.updateWorldMatrix(true, false); return obj.getWorldPosition(new THREE.Vector3()).toArray(); },
    // both eyes of the last frame, with the cameras that drew them
    capture() {
      xr.rig.updateMatrixWorld(true);
      const cams = R.xr.getCamera().cameras;
      T.eyes = [0, 1].map((i) => { const e = D.readEye(i); return { ...e, T: world.G.uTime.value, m: new THREE.Matrix4().multiplyMatrices(xr.rig.matrixWorld, cams[i].matrix).toArray(), p: cams[i].projectionMatrix.toArray() }; });
      return { width: T.eyes[0].width, height: T.eyes[0].height, T: T.eyes[0].T };
    },
    // the desktop frame of eye i's camera (after the session ended); off: post keys forced to 0 / null
    ref(i, o = {}) {
      const e = T.eyes[i], pr = R.getPixelRatio(), P = world.post, keep = {};
      world.resize(e.width / pr, e.height / pr);
      const cam = new THREE.PerspectiveCamera();
      new THREE.Matrix4().fromArray(e.m).decompose(cam.position, cam.quaternion, cam.scale);
      cam.updateMatrixWorld(); cam.projectionMatrix.fromArray(e.p); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      for (const k in o.off || {}) { keep[k] = P[k]; P[k] = o.off[k]; }
      C.passes = C.calls = C.tris = 0; C.on = true;
      try { world.renderFrame(e.T, { camera: cam, spp: o.spp || 1, frameIndex: 1 }); } finally { C.on = false; Object.assign(P, keep); }
      R.setRenderTarget(null);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, data = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      R.resetState();
      return { width: w, height: h, data, passes: C.passes, calls: C.calls, tris: C.tris };
    },
    psnr(a, b) {
      if (a.width !== b.width || a.height !== b.height) return { error: `sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}` };
      let se = 0, ad = 0; const ma = [0, 0, 0], mb = [0, 0, 0], x = a.data, y = b.data, n = a.width * a.height;
      for (let i = 0; i < x.length; i += 4) for (let k = 0; k < 3; k++) { const d = x[i + k] - y[i + k]; se += d * d; ad += Math.abs(d); ma[k] += x[i + k]; mb[k] += y[i + k]; }
      const mse = se / (n * 3);
      return { psnr: +(mse ? 10 * Math.log10(65025 / mse) : 99).toFixed(2), meanAbs: +(ad / (n * 3)).toFixed(2), meanA: ma.map((v) => +(v / n).toFixed(1)), meanB: mb.map((v) => +(v / n).toFixed(1)) };
    },
    png(img) {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'), id = g.createImageData(img.width, img.height), row = img.width * 4;
      for (let y = 0; y < img.height; y++) id.data.set(img.data.subarray((img.height - 1 - y) * row, (img.height - y) * row), y * row);
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
      g.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    },
    // N frames and the GPU's work done (a 1-pixel read of the layer): ms per frame
    timed(n, dt = 1000 / 72) {
      const px = new Uint8Array(4), t0 = performance.now();
      for (let i = 0; i < n; i++) D.tick(dt);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, D.layer._resolve); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      R.resetState();
      return (performance.now() - t0) / n;
    },
  };
}

async function openPage(browser, url, flags, cfg = {}) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(`window.__XR_SHIM = ${JSON.stringify({ eyeW: EYE, eyeH: EYE, ...cfg })};\n${SHIM}`);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.goto(`${url}?mode=walk&ui=0&hud=0&start=1&grain=0&quality=${QUALITY}&w=${W}&h=${H}${flags ? '&' + flags : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await page.evaluate(`(${helper})()`);
  return page;
}
const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const noErrors = (page, what) => check(`${what}: no page errors`, page.errors.length === 0, page.errors.length ? { errors: page.errors.slice(0, 4) } : undefined);

// ---- render: each eye against the desktop frame of the same camera
async function render(browser, url) {
  const out = {};
  for (const [id, flags] of [['direct', ''], ['post', 'xrpost=1'], ['post-no-ao-bloom', 'xrpost=1&xrao=0&xrbloom=0']]) {
    const page = await openPage(browser, url, flags, { controllers: false, hands: false });
    const r = await page.evaluate(async () => {
      const T = window.__t, { xr, world } = window.__mirage;
      await T.enter();
      T.tick(90);                         // 1.25 s: shaders, the eased exposure, the meter
      const count = T.count(20);
      T.tick(1, 0);                       // a frame with no time in it: metered on its own, like a still
      const cap = T.capture(), st = xr.state(), off = xr.post ? { ...xr.post.off } : null;
      if (off && xr.post.level.ao === false) off.ao = 0;
      if (off && xr.post.level.bloom === false) off.bloom = 0;
      const layer = { ...window.__xrShim.log.layer };
      await xr.exit();
      const res = { cap, count, layer, post: st.post, quality: st.quality, eyes: [], autoExposure: world.post.autoExposure || 0 };
      const OFF = off || { taa2: 0, upscale: 0, motionBlur: 0, bokeh: 0, chroma: 0, grain: 0, vignette: 0, dof: 0 };
      for (let i = 0; i < 2; i++) {
        const same = T.ref(i, { spp: 1, off: OFF }), same6 = T.ref(i, { spp: 6, off: OFF }), full = T.ref(i, { spp: 6 });
        res.eyes.push({ matched1: T.psnr(T.eyes[i], same), matched6: T.psnr(T.eyes[i], same6), desktop6: T.psnr(T.eyes[i], full), desktopCost: { passes: same.passes, calls: same.calls, tris: same.tris } });
        if (i === 0) res.png = { eye: T.png(T.eyes[0]), eyeR: T.png(T.eyes[1]), matched: T.png(same6), desktop: T.png(full) };
      }
      res.between = T.psnr(T.eyes[0], T.eyes[1]);
      res.noise = T.psnr(T.ref(0, { spp: 6, off: OFF }), T.ref(0, { spp: 1, off: OFF }));   // the desktop frame against itself: 6 sub-frames vs 1
      return res;
    });
    const png = r.png; delete r.png;
    save(`${id}-left.png`, png.eye); save(`${id}-right.png`, png.eyeR); save(`${id}-desktop-matched.png`, png.matched); save(`${id}-desktop.png`, png.desktop);
    out[id] = r;
    console.log(id, JSON.stringify(r, null, 1));
    noErrors(page, `render ${id}`);
    check(`render ${id}: both eyes drawn at the layer's eye size`, r.cap.width * 2 === r.layer.width && r.cap.height === r.layer.height && !r.eyes[0].matched1.error, { eye: [r.cap.width, r.cap.height], layer: r.layer });
    check(`render ${id}: the eyes differ (stereo) and are not blank`, r.between.psnr < 40 && r.between.meanA.some((v) => v > 8), { betweenEyes: r.between.psnr, mean: r.between.meanA });
    await page.close();
  }
  const p = (id, k) => out[id].eyes.map((e) => e[k].psnr);
  // the chain's eyes are the desktop frame without the temporal / lens passes: they have to be closer to it than the
  // direct path's fitted grade is, and close in absolute terms
  check('render post: each eye matches the desktop frame of its camera, same passes (PSNR >= 30 dB)', Math.min(...p('post', 'matched6')) >= 30, { post: p('post', 'matched6'), direct: p('direct', 'matched6'), desktopNoise: out.post.noise.psnr });
  check('render post: closer to the desktop frame than the direct path', Math.min(...p('post', 'matched6')) > Math.max(...p('direct', 'matched6')), { post: p('post', 'matched6'), direct: p('direct', 'matched6') });
  check('render post-no-ao-bloom: matches the desktop frame with AO and bloom off as well (PSNR >= 30 dB)', Math.min(...p('post-no-ao-bloom', 'matched6')) >= 30, { psnr: out['post-no-ao-bloom'].eyes.map((e) => e.matched6.psnr) });
  report.render = out;
}

// ---- time: direct against post, interleaved
async function time(browser, url) {
  const A = await openPage(browser, url, '', { controllers: false, hands: false }), B = await openPage(browser, url, 'xrpost=1', { controllers: false, hands: false });
  for (const pg of [A, B]) await pg.evaluate(async () => { await window.__t.enter(); window.__t.tick(60); });
  const a = [], b = [];
  for (let i = 0; i < ROUNDS; i++) {
    for (const [pg, list] of i % 2 ? [[B, b], [A, a]] : [[A, a], [B, b]]) { await pg.bringToFront(); list.push(await pg.evaluate((n) => window.__t.timed(n), FRAMES)); }
  }
  const stat = (v) => { const s = [...v].sort((x, y) => x - y); return { median: r3(s[s.length >> 1]), min: r3(s[0]), max: r3(s[s.length - 1]), rounds: v.map(r3) }; };
  const size = await B.evaluate(() => window.__mirage.xr.state().post);
  report.time = { framesPerRound: FRAMES, eye: [size.width, size.height], direct: stat(a), post: stat(b) };
  console.log('time', JSON.stringify(report.time));
  check('time: both paths measured', a.length === ROUNDS && b.length === ROUNDS, { directMs: report.time.direct.median, postMs: report.time.post.median });
  await A.close(); await B.close();
}

// ---- governor: late frames take quality away, calm frames give it back
async function governor(browser, url) {
  const page = await openPage(browser, url, 'xrpost=1&xrbudget=1', { controllers: false, hands: false });
  const r = await page.evaluate(async () => {
    const T = window.__t, D = window.__xrShim, { xr } = window.__mirage;
    await T.enter(); T.tick(100);   // past the governor's warm-up second
    const q = () => ({ ...xr.quality, governor: undefined, reason: xr.quality.governor.reason, eye: [xr.post.stats.width, xr.post.stats.height], resizes: xr.post.stats.resizes });
    const start = q(), down = [];
    let last = xr.quality.level;
    for (let i = 0; i < 600 && xr.quality.level < 5; i++) { T.tick(1, 32); if (xr.quality.level !== last) { last = xr.quality.level; T.tick(1, 32); down.push({ frame: i, ...q() }); } }   // 32 ms: every frame a missed vsync at 72 Hz
    T.tick(3, 32);
    const scales = D.log.scales.slice(-2), eyeAtFloor = D.readEye(0), cpu = xr.quality.governor.ema;
    const up = [];
    for (let i = 0; i < 3000 && xr.quality.level > 0; i++) { T.tick(1); if (xr.quality.level !== last) { last = xr.quality.level; up.push({ frame: i, level: last, reason: xr.quality.governor.reason }); } }
    T.tick(2);
    return { start, down, scales, floorEye: [eyeAtFloor.width, eyeAtFloor.height], cpuMs: +cpu.toFixed(2), up, end: q() };
  });
  report.governor = r;
  console.log('governor', JSON.stringify(r));
  noErrors(page, 'governor');
  check('governor: late frames walk the whole ladder down (scale, AO, bloom, then the direct path)', r.down.length === 5 && r.down[4].post === false && r.down.every((d) => d.reason === 'late' || d.reason === 'cpu'), { levels: r.down.map((d) => [d.frame, d.level, d.scale, d.eye.join('x'), d.reason]) });
  check('governor: the post targets shrink with the scale', r.down[0] && r.down[0].eye[0] < r.start.eye[0] && r.down[2].eye[0] < r.down[0].eye[0], { start: r.start.eye, l1: r.down[0] && r.down[0].eye, l3: r.down[2] && r.down[2].eye });
  check('governor: at the floor the direct path asks WebXR for a smaller viewport', r.scales.length > 0 && r.scales[0].s === 0.7 && r.floorEye[0] < r.start.eye[0], { requested: r.scales, eye: r.floorEye });
  check('governor: on-time frames bring the quality back', r.up.length > 0, { up: r.up.map((u) => [u.frame, u.level]), cpuMs: r.cpuMs, endLevel: r.end.level });
  await page.close();
}

// ---- interact: the demo stand by the spawn
async function interact(browser, url) {
  const page = await openPage(browser, url, 'xrdemo=1');
  const r = await page.evaluate(async () => {
    const T = window.__t, D = window.__xrShim, { xr, world } = window.__mirage, THREE = world.ctx.THREE, d = xr.interact.demo, out = {};
    const st = () => xr.state().interact, ptr = (hand) => { const i = xr.state().hands.findIndex((h) => h.handedness === hand); return st().pointers.find((p) => p.id === i) || {}; };
    const item = (n) => st().items.find((x) => x.name === n), add = (p, dx, dy, dz) => [p[0] + dx, p[1] + dy, p[2] + dz];
    await T.enter(); T.tick(5);
    const park = { left: add(T.wpos(d.group), -0.9, 1.0, 0.6), right: add(T.wpos(d.group), 0.9, 1.0, 0.6) };
    const rest = (hand) => T.ctl(hand, { p: park[hand], q: [0, 0, 0, 1], trigger: 0, squeeze: 0 });
    rest('left'); rest('right'); T.tick(3);
    // 1. grab the ball and throw it
    const ball0 = T.wpos(d.ball);
    T.ctl('right', { p: add(ball0, 0, 0.02, 0) }); T.tick(2);
    out.hover = { ...ptr('right'), pulses: D.log.pulses.length };
    T.ctl('right', { squeeze: 1 }); T.tick(2);
    out.grab = { ...ptr('right'), pulses: D.log.pulses.slice() };
    const v = [1.6, 1.2, 0.8], dt = 1 / 72; let p = add(ball0, 0, 0.25, 0.2);
    T.ctl('right', { p }); T.tick(4);
    for (let i = 0; i < 12; i++) { p = add(p, v[0] * dt, v[1] * dt, v[2] * dt); T.ctl('right', { p }); T.tick(1); }
    const rel = T.wpos(d.ball);
    T.ctl('right', { squeeze: 0 }); T.tick(1);
    out.thrown = { ...item('ball'), throws: st().throws };
    const after1 = T.wpos(d.ball); let frames = 1;
    while (item('ball').flying && frames < 400) { T.tick(1); frames++; }
    const land = T.wpos(d.ball), gy = land[1] - 0.06, h = rel[1] - land[1], tf = (v[1] + Math.sqrt(v[1] * v[1] + 2 * 9.81 * h)) / 9.81;
    out.throw = { release: rel, firstStep: [(after1[0] - rel[0]) / dt, (after1[1] - rel[1]) / dt, (after1[2] - rel[2]) / dt], land, frames, seconds: frames * dt, expectSeconds: tf, expectLand: [rel[0] + v[0] * tf, gy + 0.06, rel[2] + v[2] * tf] };
    // 2. pick it up and seat it in the snap zone
    T.ctl('right', { p: land }); T.tick(2); T.ctl('right', { squeeze: 1 }); T.tick(2);
    const zone = add(T.wpos(d.ring), 0, 0.06, 0);
    T.ctl('right', { p: add(zone, 0.05, 0.03, 0) }); T.tick(12);
    T.ctl('right', { squeeze: 0 }); T.tick(2);
    out.snap = { item: item('ball'), at: T.wpos(d.ball), zone, signal: d.state.snapped.value, snaps: st().snaps };
    rest('right'); T.tick(2);
    // 3. the crate with two hands: apart = bigger, around = turned
    const c0 = T.wpos(d.crate);
    T.ctl('right', { p: add(c0, 0.08, 0, 0) }); T.ctl('left', { p: add(c0, -0.08, 0, 0) }); T.tick(2);
    T.ctl('right', { squeeze: 1 }); T.tick(2); T.ctl('left', { squeeze: 1 }); T.tick(2);
    out.two = { holders: item('crate').holders };
    for (let i = 1; i <= 10; i++) { const k = 0.08 * (1 + i / 10); T.ctl('right', { p: add(c0, k, 0.1, 0) }); T.ctl('left', { p: add(c0, -k, 0.1, 0) }); T.tick(1); }
    out.two.scale = d.crate.scale.x;
    for (let i = 1; i <= 10; i++) { const a = (Math.PI / 2) * (i / 10), x = 0.16 * Math.cos(a), z = 0.16 * Math.sin(a); T.ctl('right', { p: add(c0, x, 0.1, -z) }); T.ctl('left', { p: add(c0, -x, 0.1, z) }); T.tick(1); }
    out.two.turn = 2 * Math.acos(Math.min(1, Math.abs(d.crate.getWorldQuaternion(new THREE.Quaternion()).w))); out.two.axisY = Math.abs(d.crate.getWorldQuaternion(new THREE.Quaternion()).y) > 0.6;
    T.tick(8);   // held still: released, it drops rather than flies
    T.ctl('left', { squeeze: 0 }); T.tick(1); out.two.oneLeft = item('crate').holders; T.ctl('right', { squeeze: 0 }); T.tick(1);
    rest('left'); rest('right'); for (let i = 0; i < 200 && item('crate').flying; i++) T.tick(1);
    out.two.dropped = item('crate');
    // 4. poke the button with the controller's tip
    const k0 = T.wpos(d.knob), pulses0 = D.log.pulses.length;
    T.ctl('right', { p: add(k0, 0, 0.15, 0) }); T.tick(2); T.ctl('right', { p: add(k0, 0, 0.01, 0) }); T.tick(2);
    out.poke = { pressed: d.state.pressed.value, knobY: d.knob.position.y, pulses: D.log.pulses.length - pulses0 };
    T.ctl('right', { p: add(k0, 0, 0.15, 0) }); T.tick(2); out.poke.releasedY = d.knob.position.y;
    rest('right'); T.tick(2);
    // 5. ray + trigger on the canvas panel: the toggle
    const g = d.screen.geometry.parameters, on = (box, back) => { const b = box; return d.screen.localToWorld(new THREE.Vector3(((b.x + b.w / 2) / 512 - 0.5) * g.width, (0.5 - (b.y + b.h / 2) / 352) * g.height, back)).toArray(); };
    const boxes = d.ui.boxes, tog = boxes.find((b) => b.node.type === 'toggle'), but = boxes.find((b) => b.node.type === 'button');
    out.boxes = boxes.map((b) => [b.node.type, b.x, b.y, b.w, b.h]);
    const from = on(tog, 0.5), to = on(tog, 0);
    T.ctl('right', { p: from, q: T.aimQ(from, to) }); T.tick(3);
    out.ray = { before: d.state.lit.value, panel: st().panels[0], busy: ptr('right').ui, want: boxes.indexOf(tog) };
    T.ctl('right', { trigger: 1 }); T.tick(2); T.ctl('right', { trigger: 0 }); T.tick(2);
    out.ray.after = d.state.lit.value; out.ray.focus = d.ui.focus.value; out.ray.size = d.state.size.value; out.ray.presses = st().presses; out.ray.emissive = d.ball.material.emissive.getHex();
    rest('right'); T.tick(2);
    out.controllerPulses = D.log.pulses.length;
    // 6. tracked hands: a fingertip on the panel's Reset button
    D.input('hands'); T.tick(4);
    out.hands = { sources: xr.state().hands.map((h) => [h.handedness, h.hand, h.tracked]) };
    const sq = d.screen.getWorldQuaternion(new THREE.Quaternion()), tipL = new THREE.Vector3(...D.jointLocal('point', 'right', 9)).applyQuaternion(sq);
    const wrist = (z) => { const t = on(but, z); return [t[0] - tipL.x, t[1] - tipL.y, t[2] - tipL.z]; };
    out.hands.pressedBefore = d.state.pressed.value;
    T.hand('left', 'relaxed', { p: park.left }); T.hand('right', 'point', { p: wrist(0.05), q: sq.toArray() }); T.tick(3);
    out.hands.pointing = xr.state().hands.find((h) => h.handedness === 'right'); out.hands.over = st().panels[0];
    T.hand('right', 'point', { p: wrist(-0.008) }); T.tick(2);
    T.hand('right', 'point', { p: wrist(0.05) }); T.tick(2);
    out.hands.pressedAfter = d.state.pressed.value; out.hands.presses = st().presses; out.hands.ballBack = d.ball.position.toArray();
    // 7. a fist takes the crate; opening the hand lets go
    T.hand('right', 'relaxed', { p: park.right, q: [0, 0, 0, 1] }); T.tick(2);
    const c1 = T.wpos(d.crate);
    T.hand('right', 'relaxed', { p: add(c1, 0, 0.05, 0.043) }); T.tick(2);
    out.fist = { hover: ptr('right').hover };
    T.hand('right', 'fist'); T.tick(2);
    out.fist.held = ptr('right').held; out.fist.grabbing = xr.state().hands.find((h) => h.handedness === 'right').grabbing;
    T.hand('right', 'fist', { p: add(c1, 0, 0.3, 0.043) }); T.tick(10);
    out.fist.lifted = T.wpos(d.crate)[1] - c1[1];
    T.hand('right', 'relaxed'); T.tick(2);
    out.fist.released = ptr('right').held;
    // 8. a pinch (the hand's select)
    T.hand('right', 'relaxed', { p: park.right }); T.tick(2); T.hand('right', 'pinch'); T.tick(2);
    out.pinch = xr.state().hands.find((h) => h.handedness === 'right');
    out.stats = st(); out.handPulses = D.log.pulses.length - out.controllerPulses;
    await xr.exit();
    return out;
  });
  report.interact = r;
  console.log('interact', JSON.stringify(r));
  noErrors(page, 'interact');
  const near = (a, b, e) => a.every((v, i) => Math.abs(v - b[i]) <= e);
  check('interact: hover by reach pulses the controller; squeeze grabs', r.hover.hover === 'ball' && !r.hover.far && r.hover.pulses >= 1 && r.grab.held === 'ball', { hover: r.hover, pulses: r.grab.pulses });
  check('interact: a throw leaves with the hand\'s velocity (1.6, 1.2, 0.8 m/s) and lands on the ballistic arc', r.thrown.flying && near(r.throw.firstStep, [1.6, 1.2 - 9.81 / 72, 0.8], 0.08) && near(r.throw.land, r.throw.expectLand, 0.12), { firstStep: r.throw.firstStep.map(r3), land: r.throw.land.map(r3), expect: r.throw.expectLand.map(r3), seconds: r3(r.throw.seconds), expectSeconds: r3(r.throw.expectSeconds) });
  check('interact: released in the snap zone the ball seats there', r.snap.item.snapped && near(r.snap.at, r.snap.zone, 0.002) && r.snap.signal === 'ball', { at: r.snap.at.map(r3), zone: r.snap.zone.map(r3), snaps: r.snap.snaps });
  check('interact: two hands scale (x2) and turn (90 degrees about y) the crate', r.two.holders === 2 && Math.abs(r.two.scale - 2) < 0.02 && Math.abs(r.two.turn - Math.PI / 2) < 0.03 && r.two.axisY && r.two.oneLeft === 1, { scale: r3(r.two.scale), turnDeg: r3((r.two.turn * 180) / Math.PI), afterOneHand: r.two.oneLeft, dropped: r.two.dropped });
  check('interact: the controller tip pokes the button (press, haptic, release)', r.poke.pressed === 1 && r.poke.knobY < r.poke.releasedY && r.poke.pulses >= 1, r.poke);
  check('interact: ray + trigger flips the canvas panel\'s toggle', r.ray.before === true && r.ray.after === false && r.ray.panel === 'ray' && r.ray.emissive === 0, r.ray);
  check('interact: hands tracked; a fingertip pokes the panel\'s Reset button', r.hands.sources.every((s) => s[1] && s[2]) && r.hands.over === 'poke' && r.hands.pressedBefore === 1 && r.hands.pressedAfter === 0 && near(r.hands.ballBack, [0.45, 0.96, 0.05], 1e-6), { ...r.hands, pointing: r.hands.pointing.pointing });
  check('interact: a fist grabs and lifts, an open hand lets go', r.fist.hover === 'crate' && r.fist.held === 'crate' && r.fist.grabbing && Math.abs(r.fist.lifted - 0.25) < 0.02 && r.fist.released === null, r.fist);
  check('interact: a pinch is detected', r.pinch.pinching === true, { pinch: r.pinch, stats: r.stats, controllerPulses: r.controllerPulses });
  await page.close();
}

// ---- move: smooth turn and move, teleport, seated calibration, bounds
async function move(browser, url) {
  const page = await openPage(browser, url, 'xrsmooth=1&xrposture=seated&xrbounds=1');
  const r = await page.evaluate(async () => {
    const T = window.__t, D = window.__xrShim, { xr, world, play } = window.__mirage, out = {};
    D.head.p = [0, 1.15, 0];   // sitting
    await T.enter(); T.tick(10);
    const s0 = xr.state();
    world.camera.updateMatrixWorld(); xr.rig.updateMatrixWorld(true);
    out.seated = { lift: s0.lift, posture: s0.posture, headY: 1.15, eyeWorldY: xr.rig.position.y + 1.15, walkerY: s0.walker[1], cameraY: world.camera.position.y };
    // leaning in the chair does not walk
    for (let i = 1; i <= 20; i++) { D.head.p = [0.3 * (i / 20), 1.15, 0]; T.tick(1); }
    out.seated.leanMoved = Math.hypot(xr.state().walker[0] - s0.walker[0], xr.state().walker[2] - s0.walker[2]);
    out.bounds0 = s0.bounds;
    D.head.p = [1.3, 1.15, 0]; T.tick(2); out.boundsNear = xr.state().bounds;
    D.head.p = [0, 1.25, 0]; T.tick(2); out.seated.recalibrated = xr.calibrateHeight(); out.boundsBack = xr.state().bounds;
    // smooth turn: the right stick sideways for half a second
    const y0 = xr.state().rigYaw;
    T.ctl('right', { stick: [1, 0] }); T.tick(36); out.turn = { yaw: xr.state().rigYaw - y0, vignette: xr.state().vignette };
    T.ctl('right', { stick: [0, 0] }); T.tick(60); out.turn.vignetteAfter = xr.state().vignette;
    // smooth move: the left stick forward for a second
    const w0 = xr.state().walker;
    T.ctl('left', { stick: [0, -1] }); T.tick(72); const w1 = xr.state().walker;
    out.walk = { metres: Math.hypot(w1[0] - w0[0], w1[2] - w0[2]), vignette: xr.state().vignette };
    T.ctl('left', { stick: [0, 0] }); T.tick(10);
    // teleport: the right stick forward aims the arc from the controller, letting go jumps
    const rig = xr.state(), sp = window.__mirage.built.plan.spawn;
    xr.place(sp.eye, sp.look); T.tick(4);
    const w2 = xr.state().walker;
    T.ctl('right', { p: [w2[0] + 0.2, w2[1] + 1.1, w2[2] - 0.3], q: T.aimQ([0, 0, 0], [0, 0.2, -1]), stick: [0, -1] }); T.tick(4);
    out.tele = { ...xr.state().teleport };
    T.ctl('right', { stick: [0, 0] }); T.tick(3);
    const w3 = xr.state().walker;
    out.tele.moved = Math.hypot(w3[0] - w2[0], w3[2] - w2[2]); out.tele.to = w3; out.tele.groundY = play.grid.groundAt(w3[0], w3[2], w3[1] + 1);
    out.init = D.log.init; out.spaces = D.log.spaces;
    await xr.exit();
    return out;
  });
  report.move = r;
  console.log('move', JSON.stringify(r));
  noErrors(page, 'move');
  check('move: seated, the eyes are at the character\'s height (lift = eye height - head)', Math.abs(r.seated.lift - (1.62 - 1.15)) < 0.02 && Math.abs(r.seated.eyeWorldY - r.seated.cameraY) < 0.03 && r.seated.leanMoved < 0.01 && Math.abs(r.seated.recalibrated - (1.62 - 1.25)) < 0.02, r.seated);
  check('move: the bounds fence shows near the edge of the play area only', r.bounds0 && r.bounds0.points === 4 && !r.bounds0.shown && r.boundsNear.shown && Math.abs(r.boundsNear.distance - 0.2) < 0.01 && !r.boundsBack.shown, { start: r.bounds0, near: r.boundsNear, back: r.boundsBack });
  check('move: smooth turn at 2.5 rad/s with the comfort vignette', Math.abs(Math.abs(r.turn.yaw) - 1.25) < 0.05 && r.turn.vignette > 0.5 && r.turn.vignetteAfter < 0.02, r.turn);
  check('move: smooth move walks, with the vignette', r.walk.metres > 0.8 && r.walk.vignette > 0.4, r.walk);
  check('move: the teleport arc lands on the walk grid and the walker goes there', r.tele.aiming && r.tele.valid && r.tele.moved > 1 && Math.abs(r.tele.to[1] - r.tele.groundY) < 0.1, r.tele);
  await page.close();
}

// ---- ar: hit test, anchor, plane, light, overlay, transparent clear
async function ar(browser, url) {
  const page = await openPage(browser, url, 'xrar=1', { controllers: false, hands: false });
  const r = await page.evaluate(async () => {
    const T = window.__t, D = window.__xrShim, { xr, world } = window.__mirage, out = {};
    const key0 = world.keyDir.toArray(), env0 = world.scene.environmentIntensity;
    const a = -Math.PI / 5; D.head.q = [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];   // looking 36 degrees down at the floor
    await T.enter('immersive-ar'); T.tick(4);
    await new Promise((r) => setTimeout(r, 50)); T.tick(4); await new Promise((r) => setTimeout(r, 50)); T.tick(4);   // the hit-test source, the anchor and the light probe are promises
    const s = xr.state();
    out.init = D.log.init; out.overlay = D.log.overlay; out.ar = s.ar; out.arx = s.arx; out.layer = D.log.layer;
    out.light = { before: key0, after: world.keyDir.toArray(), device: D.light.direction, env: [env0, world.scene.environmentIntensity], sun: world.sun.intensity };
    const rig0 = xr.rig.position.toArray(), sc = s.ar.scale;
    D.shiftAnchors([0.2, 0, 0.1]); T.tick(2);
    const rig1 = xr.rig.position.toArray();
    out.anchor = { anchors: D.log.anchors, rigMoved: [rig1[0] - rig0[0], rig1[1] - rig0[1], rig1[2] - rig0[2]], expect: [-0.2 * sc, 0, -0.1 * sc] };
    D.plane([[-1, -1], [1, -1], [1, 1], [-1, 1]], 0); T.tick(2);
    out.planes = xr.state().arx.planes; out.planeShadow = xr.ar.planes.values().next().value.mesh.receiveShadow;
    D.light.direction = [-0.6, 0.7, 0.2]; T.tick(2); out.light.moved = world.keyDir.toArray();
    // the image: the model over nothing (alpha 0 where the room shows through)
    const e = D.readEye(0); let clear = 0, solid = 0;
    for (let i = 3; i < e.data.length; i += 4) { if (e.data[i] === 0) clear++; else if (e.data[i] === 255) solid++; }
    out.alpha = { clear: clear / (e.width * e.height), solid: solid / (e.width * e.height) };
    out.ground = !!world.scene.getObjectByName('xr-shadow-ground');
    out.png = T.png(e);
    await xr.exit();
    out.restored = { key: world.keyDir.toArray(), env: world.scene.environmentIntensity };
    return out;
  });
  save('ar-left.png', r.png); delete r.png;
  report.ar = r;
  console.log('ar', JSON.stringify(r));
  noErrors(page, 'ar');
  const near = (a, b, e) => a.every((v, i) => Math.abs(v - b[i]) <= e), unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  check('ar: the session is asked for anchors, plane detection, light estimation and the DOM overlay', ['anchors', 'plane-detection', 'light-estimation', 'dom-overlay', 'hit-test'].every((f) => r.init.features.includes(f)) && r.overlay === 'screen' && r.arx.overlay === 'screen', { features: r.init.features, overlay: r.arx.overlay, blend: r.arx.blend });
  check('ar: the hit test places the model and anchors it', r.ar.hitTest && r.ar.placed && r.arx.anchors === 1 && r.arx.tracked === 1, { ar: r.ar, anchors: r.arx.anchors });
  check('ar: when the device moves the anchor the model follows', near(r.anchor.rigMoved, r.anchor.expect, 0.02 * Math.max(1, Math.abs(r.anchor.expect[0]))), { rigMoved: r.anchor.rigMoved.map(r3), expect: r.anchor.expect.map(r3) });
  check('ar: a detected plane becomes a shadow-catching mesh', r.planes === 1 && r.planeShadow === true, { planes: r.planes });
  check('ar: the light estimate drives the sun and dims the baked environment; restored after', near(r.light.after, unit(r.light.device), 0.01) && near(r.light.moved, unit([-0.6, 0.7, 0.2]), 0.01) && r.light.env[1] < r.light.env[0] && near(r.restored.key, r.light.before, 1e-6) && r.restored.env === r.light.env[0], { ...r.light, restored: r.restored });
  check('ar: transparent where there is no model, a shadows-only ground under it', r.alpha.clear > 0.5 && r.alpha.solid > 0.005 && r.ground, r.alpha);
  await page.close();
}

const srv = await serve(path.resolve(dir));
const browser = await launch({ w: W, h: H });
const PHASES = { render, time, governor, interact, move, ar };
try {
  for (const id of ONLY) {
    if (!PHASES[id]) { console.error('unknown phase', id); failed++; continue; }
    try { await PHASES[id](browser, srv.url); } catch (err) { failed++; console.log(`FAIL ${id}: ${err && err.stack || err}`); report.checks.push({ name: id + ' threw', ok: false, error: String(err && err.message || err) }); }
  }
} finally { await browser.close(); await srv.close(); }
report.failed = failed;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${report.checks.length} checks passed`, '->', path.join(OUT, 'report.json'));
process.exit(failed ? 1 : 0);

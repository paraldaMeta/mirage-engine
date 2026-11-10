#!/usr/bin/env node
// Mirage original code. WebXR without a headset: Meta's Immersive Web Emulation Runtime (iwer, MIT, a devDependency)
// is injected into the page before its scripts run, so navigator.xr offers an emulated Meta Quest 3. The check
// clicks the page's Enter VR button, drives the emulated controllers and asserts what the walker did, then replays
// the same frames through the desktop path (keys, play.step) and requires the same end position: XR locomotion is
// the desktop walker, collisions, steps and ground follow included. Also: snap turn, teleport, (games) the trigger
// as interact with the in-world prompt, AR placement, and both eyes saved as PNGs.
//
// usage: mirage-xr-check <dist dir> [more dist dirs] [--out dir] [--w 1600 --h 800] [--perf | --perf-only] [--perf-w 3360 --perf-h 1760]
//        [--native | --native-only] [--alloc | --alloc-only] [--alloc-frames 300]
//   --perf: one more short session at a Quest 3-like framebuffer (two 1680 x 1760 eyes side by side): the cost of
//           a stereo frame (CPU + GPU to a 1-pixel readback; GPU time from EXT_disjoint_timer_query when offered)
//   --native: one more page per world as a native WebXR host shows it (webxr-to-native on Quest: no layout engine,
//           Canvas 2D without text): fillText / strokeText draw nothing, roundRect is gone, everything but the canvas
//           is display:none. The session must start through navigator.xr.offerSession (granted as the platform
//           would), labels must use the built-in glyphs and show text in the eye image (a pixel check), and with
//           iwer's emulated hands a pinch interacts and point-then-pinch teleports.
//   --alloc: a heap sample (CDP HeapProfiler, objects collected by minor and major GCs included) over N steady VR
//           frames, standing and walking, plus the GCs in a trace of the same frames: bytes per frame by script and,
//           in an unminified build (vite build --minify false), by function, with createXR's own share; after a
//           10 s warm-up
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const BOOL = ['--perf', '--perf-only', '--native', '--native-only', '--alloc', '--alloc-only', '--native-control'];
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BOOL.includes(args[i - 1])));
if (!targets.length) { console.error('usage: mirage-xr-check <dist dir> [...] [--out dir] [--perf]'); process.exit(2); }
const W = +flag('w', 1600), H = +flag('h', 800), OUT = path.resolve(flag('out', 'out/xr-check'));
const PERF = !!flag('perf', false) || !!flag('perf-only', false), PW = +flag('perf-w', 3360), PH = +flag('perf-h', 1760);
const NATIVE = !!flag('native', false) || !!flag('native-only', false), ALLOC = !!flag('alloc', false) || !!flag('alloc-only', false), AF = +flag('alloc-frames', 300);
const CONTROL = !!flag('native-control', false);   // the negative control: a canvas label whose fillText draws nothing
const IWER = fs.readFileSync(createRequire(import.meta.url).resolve('iwer/build/iwer.min.js'), 'utf8');
// the emulated headset: Meta Quest 3, stereo, controllers connected
const INSTALL = `${IWER};
(() => { const d = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true }); d.installRuntime({ forceInstall: true }); window.__iwer = d; })();`;

// per-world walks (the desktop scenarios' own expectations where they exist) and the game's interactable
const CASES = {
  'hello-courtyard': {
    walks: [
      { name: 'wall-blocks', eye: [3, 1.62, 3], look: [10, 1.62, 3], ms: 3500, expect: (p) => Math.abs(p[0] - 6.9) < 0.15, want: 'x ~ 6.9 (the east wall; desktop scenario wall-blocks)' },
      { name: 'gate-passes', eye: [0, 1.62, 3], look: [0, 1.62, 20], ms: 4500, expect: (p) => p[2] > 8.6 && Math.abs(p[1]) < 0.1, want: 'z > 8.6, y ~ 0 (through the gate)' },
      { name: 'basin-blocks', eye: [0, 1.62, 4.5], look: [0, 1.6, 0], ms: 3000, expect: (p) => Math.abs(p[2] - 2.15) < 0.15, want: 'z ~ 2.15 (the basin rim)' },
    ],
    teleport: { eye: [3, 1.62, 3], look: [3, 1.62, -6] },
  },
  'walled-garden': { walks: [], teleport: null },
  'garden-quest': {
    walks: [
      { name: 'stairs-up-to-the-door', eye: [0, 0, -6], look: [0, 0, -20], ms: 4500, run: true, expect: (p) => p[1] > 3.4 && p[2] < -15, want: 'y > 3.4, z < -15 (up the terrace stairs, stopped by the locked pavilion door)' },
    ],
    teleport: { eye: [-4.6, 0, 26], look: [-4.6, 0, 16] },
    interact: { id: 'key', eye: [-21.6, 0, 16.4], flag: (s) => s.inventory.includes('key'), want: 'inventory has the key' },
  },
};

fs.mkdirSync(OUT, { recursive: true });
const report = { emulator: 'iwer ' + JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('iwer/package.json'), 'utf8')).version + ' (Meta Quest 3)', worlds: [] };
let failed = 0;
const check = (r, name, ok, detail) => { r.checks.push({ name, ok: !!ok, ...detail }); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.name}: ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, file) {
  const png = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  // not blank: the eyes differ from a flat colour
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 32);
    const d = g.getImageData(0, 0, 64, 32).data; let m = 0, m2 = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; m += l; m2 += l * l; }
    const n = d.length / 4; m /= n;
    return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(m2 / n - m * m, 0)).toFixed(1), width: img.width, height: img.height };
  }, png);
}

// the prompt label in the left eye of a saved frame: its sprite projected through the eye's camera, then over the
// text part of the label (right of the key chip, the middle rows) the share of panel-dark and text-light pixels and
// the most dark-to-light edges along one row. Text drawn: light 3-60 %, edges >= 6; a label whose text did not
// draw (a no-op fillText) has its panel and chip but no light pixels there.
const labelPixels = (page, file) => page.evaluate(async (src, W, H) => {
  const { world, xr } = window.__mirage, THREE = world.ctx.THREE, s = xr.labels.prompt;
  if (!s.visible) return { visible: false };
  const eye = world.renderer.xr.getCamera().cameras[0], inv = eye.matrixWorld.clone().invert();
  const right = new THREE.Vector3().setFromMatrixColumn(eye.matrixWorld, 0).normalize(), up = new THREE.Vector3().setFromMatrixColumn(eye.matrixWorld, 1).normalize();
  const c = s.getWorldPosition(new THREE.Vector3()), sc = s.getWorldScale(new THREE.Vector3());
  const at = (u, v) => { const p = c.clone().addScaledVector(right, (u - 0.5) * sc.x).addScaledVector(up, (0.5 - v) * sc.y).applyMatrix4(inv).applyMatrix4(eye.projectionMatrix); return [(p.x * 0.5 + 0.5) * (W / 2), (0.5 - p.y * 0.5) * H]; };
  const [x0, y0] = at(0, 0), [x1, y1] = at(1, 1);
  const img = new Image(); img.src = src; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const tx0 = Math.round(x0 + 0.3 * (x1 - x0)), tx1 = Math.round(x0 + 0.74 * (x1 - x0)), ty0 = Math.round(y0 + 0.3 * (y1 - y0)), ty1 = Math.round(y0 + 0.7 * (y1 - y0));
  if (tx1 - tx0 < 8 || ty1 - ty0 < 3 || tx0 < 0 || ty0 < 0 || tx1 > W / 2 || ty1 > H) return { visible: true, offscreen: true, box: [x0, y0, x1, y1].map(Math.round) };
  const d = g.getImageData(tx0, ty0, tx1 - tx0, ty1 - ty0).data, w = tx1 - tx0, h = ty1 - ty0;
  let dark = 0, light = 0, edges = 0;
  for (let y = 0; y < h; y++) {
    let e = 0, prev = false;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l < 80) dark++; if (l > 150) light++;
      const on = l > 120; if (on && !prev) e++; prev = on;
    }
    edges = Math.max(edges, e);
  }
  const n = w * h;
  return { visible: true, box: [x0, y0, x1, y1].map(Math.round), textArea: [w, h], dark: +(dark / n).toFixed(3), light: +(light / n).toFixed(3), edges };
}, 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'), W, H);
const textShows = (m) => m.visible && !m.offscreen && m.dark > 0.3 && m.light > 0.03 && m.light < 0.6 && m.edges >= 6;

async function enterXR(page, mode) {
  await page.waitForFunction((m) => { const b = window.__mirage.xr.buttons[m]; return b && !b.hidden; }, { timeout: 15000 }, mode);
  const f0 = await page.evaluate(() => window.__mirage.xr.stats.frames);
  await page.click(`.mirage-xr button[data-mode="${mode}"]`);
  await page.waitForFunction((m, f0) => window.__mirage.xr.mode === m && window.__mirage.xr.stats.frames > f0 + 10, { timeout: 30000, polling: 50 }, mode === 'immersive-ar' ? 'ar' : 'vr', f0);
}
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { const f0 = window.__mirage.xr.stats.frames; (function w() { if (window.__mirage.xr.stats.frames >= f0 + n) r(); else setTimeout(w, 5); })(); }), n);
const ctl = (page, hand, fn, ...a) => page.evaluate((hand, fn, a) => window.__iwer.controllers[hand][fn](...a), hand, fn, a);

async function run(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: W, h: H });
  const r = { dir, checks: [], shots: [] };
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTALL);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(srv.url + `?mode=walk&ui=0&hud=0&start=1&grain=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    r.name = await page.evaluate(() => window.__mirage.built.plan.name);
    const C = CASES[r.name] || { walks: [] };
    const game = await page.evaluate(() => !!window.__mirage.g);
    const support = await page.evaluate(() => window.__mirage.xr.support);
    check(r, 'xrSupport (emulated Quest 3)', support.vr && support.ar, support);
    const msaa = await page.evaluate(() => window.__mirage.world.renderer.getContext().getContextAttributes().antialias);
    check(r, 'world context made multisampled for XR', msaa);

    // the desktop still at the spawn, before any XR session and again after them: the XR install (grade chunk,
    // patched sky / stars, shared uniforms) must leave the non-XR image bit-identical
    const desktopStill = () => page.evaluate(() => {
      const { play, built } = window.__mirage, sp = built.plan.spawn;
      play.stop(); play.place(sp.eye, sp.look, 'walk');
      for (let k = 0; k < 40; k++) play.step(1 / 30);
      play.render({ moving: false, spp: 6, frameIndex: 1 });
      const png = document.querySelector('canvas').toDataURL('image/png');
      play.start();
      return png;
    });
    const still0 = await desktopStill(), still0b = await desktopStill();

    // ---- VR
    let leftEye = null;
    await enterXR(page, 'immersive-vr');
    const s0 = await page.evaluate(() => window.__mirage.xr.state());
    check(r, 'enter VR from the button', s0.presenting && s0.mode === 'vr', { size: s0.size, head: s0.head });
    const ground = (x, z) => page.evaluate((x, z) => window.__mirage.play.grid.groundAt(x, z), x, z);

    for (const wk of C.walks) {
      const eye = wk.eye.slice(), look = wk.look.slice();
      if (eye[1] === 0) { const g = await ground(eye[0], eye[2]); eye[1] = g + 1.62; look[1] = g + 1.62; }
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), eye, look);
      await sleep(400);
      const from = await page.evaluate(() => { const x = window.__mirage.xr; x.trace = []; return x.state().walker; });
      await ctl(page, 'left', 'updateAxes', 'thumbstick', 0, -1);
      if (wk.run) await ctl(page, 'left', 'updateButtonValue', 'squeeze', 1);
      await sleep(wk.ms);
      await ctl(page, 'left', 'updateAxes', 'thumbstick', 0, 0);
      if (wk.run) await ctl(page, 'left', 'updateButtonValue', 'squeeze', 0);
      await sleep(300);
      const t = await page.evaluate(() => { const x = window.__mirage.xr, t = x.trace; x.trace = null; return { trace: t, state: x.state() }; });
      const end = t.state.walker, moved = Math.hypot(end[0] - from[0], end[2] - from[2]);
      const blocked = t.trace.some((f) => f.blocked);
      check(r, `walk ${wk.name}: ${wk.want}`, wk.expect(end), { from, end, moved: +moved.toFixed(2), blockedFrames: t.trace.filter((f) => f.blocked).length, frames: t.trace.length });
      r[wk.name] = { from, end, blocked, frames: t.trace.length };
      wk.trace = t.trace; wk.from = t.trace[0] ? t.trace[0].from : from; wk.end = t.trace.at(-1).pos; wk.eyeUsed = eye; wk.lookUsed = look;
    }
    if (C.walks.length) {
      const vg = await page.evaluate(async () => { window.__iwer.controllers.left.updateAxes('thumbstick', 0, -1); await new Promise((r) => setTimeout(r, 600)); const v = window.__mirage.xr.state().vignette; window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0); return v; });
      check(r, 'comfort vignette while the stick moves', vg > 0.3, { vignette: vg });
      await sleep(300);
    }

    // snap turn: right stick right -> the view turns right by 30 degrees
    {
      const y0 = (await page.evaluate(() => window.__mirage.xr.state())).yaw;
      await ctl(page, 'right', 'updateAxes', 'thumbstick', 1, 0); await frames(page, 4);
      await ctl(page, 'right', 'updateAxes', 'thumbstick', 0, 0); await frames(page, 4);
      const y1 = (await page.evaluate(() => window.__mirage.xr.state())).yaw;
      let d = y1 - y0; d = Math.atan2(Math.sin(d), Math.cos(d));
      check(r, 'snap turn right: +30 degrees, once per push', Math.abs(d - Math.PI / 6) < 1e-3, { degrees: +(d * 180 / Math.PI).toFixed(2) });
    }

    // teleport: right stick forward aims, release goes
    if (C.teleport) {
      const eye = C.teleport.eye.slice(), look = C.teleport.look.slice();
      if (eye[1] === 0) { const g = await ground(eye[0], eye[2]); eye[1] = g + 1.62; look[1] = g + 1.62; }
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), eye, look);
      await sleep(400);
      const before = (await page.evaluate(() => window.__mirage.xr.state())).walker;
      await ctl(page, 'right', 'updateAxes', 'thumbstick', 0, -1); await frames(page, 6);
      const aim = await page.evaluate(() => window.__mirage.xr.state().teleport);
      r.shots.push({ file: `${r.name}-vr-teleport-aim.png`, ...(await shot(page, path.join(OUT, `${r.name}-vr-teleport-aim.png`))) });
      await ctl(page, 'right', 'updateAxes', 'thumbstick', 0, 0); await frames(page, 6);
      await sleep(300);
      const after = await page.evaluate(() => window.__mirage.xr.state());
      const hop = Math.hypot(after.walker[0] - before[0], after.walker[2] - before[2]);
      const onTarget = aim.target && Math.hypot(after.walker[0] - aim.target[0], after.walker[2] - aim.target[2]) < 0.3 && Math.abs(after.walker[1] - aim.target[1]) < 0.3;
      check(r, 'teleport: the arc lands on walkable ground and the walker goes there', aim.valid && onTarget && hop > 2 && after.onGround, { before, target: aim.target, after: after.walker, hop: +hop.toFixed(2) });
    }

    // a game: the trigger is E, the prompt floats over the thing
    if (game && C.interact) {
      const I = C.interact;
      const at = await page.evaluate((id) => { const g = window.__mirage.g; return g.game.where(g.game.entities.get(id)); }, I.id);
      const eye = I.eye.slice(); const gy = await ground(eye[0], eye[2]); eye[1] = gy + 1.62;
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), eye, at);
      // tilt the emulated headset down toward the thing (the game's look cone), as a player would
      const pitch = Math.atan2(at[1] - (gy + 1.6), Math.hypot(at[0] - eye[0], at[2] - eye[2]));
      await page.evaluate((p) => window.__iwer.quaternion.set(Math.sin(p / 2), 0, 0, Math.cos(p / 2)), pitch);
      await sleep(500);
      const p = await page.evaluate(() => window.__mirage.xr.state());
      r.shots.push({ file: `${r.name}-vr-prompt.png`, ...(await shot(page, path.join(OUT, `${r.name}-vr-prompt.png`))) });
      check(r, `in-world prompt over "${I.id}"`, p.near === I.id && !!p.prompt, { near: p.near, prompt: p.prompt });
      const lp = await labelPixels(page, path.join(OUT, `${r.name}-vr-prompt.png`));
      check(r, `the prompt's text shows in the eye image (${p.text} labels; pixel check)`, textShows(lp), lp);
      await ctl(page, 'right', 'updateButtonValue', 'trigger', 1); await frames(page, 3);
      await ctl(page, 'right', 'updateButtonValue', 'trigger', 0); await frames(page, 6);
      await sleep(200);
      const s = await page.evaluate(() => { const g = window.__mirage.g; return { inventory: g.game.inventory.items.map((i) => i.id), panel: window.__mirage.xr.state().panel }; });
      r.shots.push({ file: `${r.name}-vr-after-trigger.png`, ...(await shot(page, path.join(OUT, `${r.name}-vr-after-trigger.png`))) });
      check(r, `trigger interacts: ${I.want}`, I.flag(s), s);
      await page.evaluate(() => window.__iwer.quaternion.set(0, 0, 0, 1));
      await sleep(200);
    }

    // both eyes, the spawn view
    {
      const sp = await page.evaluate(() => window.__mirage.built.plan.spawn);
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), sp.eye, sp.look);
      await sleep(1200);
      const s = await shot(page, path.join(OUT, `${r.name}-vr-eyes.png`));
      r.shots.push({ file: `${r.name}-vr-eyes.png`, ...s });
      const lm = await page.evaluate(() => ({ meter: window.__mirage.xr.state().meter, fog: window.__mirage.world.scene.fog.color.toArray().map((v) => +v.toFixed(4)), exposure: +(window.__mirage.world.post.exposure * window.__mirage.world.exposure).toFixed(4) }));
      check(r, 'both eyes rendered (not blank)', s.sd > 8 && s.width === W, { ...s, ...lm });
      leftEye = await page.evaluate(() => { const c = window.__mirage.world.renderer.xr.getCamera().cameras[0]; return { m: c.matrixWorld.toArray(), p: c.projectionMatrix.toArray() }; });
    }
    await page.evaluate(() => window.__mirage.xr.exit());
    await page.waitForFunction(() => !window.__mirage.xr.presenting, { timeout: 10000 });

    // the desktop pipeline from the left eye's pose and lens (one eye's size): how close the XR grade comes
    if (leftEye) {
      await page.evaluate((e, w, h) => {
        const { world, play } = window.__mirage, THREE = world.ctx.THREE;
        play.stop();
        world.resize(w, h);
        const cam = new THREE.PerspectiveCamera();
        new THREE.Matrix4().fromArray(e.m).decompose(cam.position, cam.quaternion, cam.scale);
        cam.updateMatrixWorld(); cam.projectionMatrix.fromArray(e.p); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
        world.renderFrame(play.clock, { camera: cam, spp: 6, frameIndex: 1 });
      }, leftEye, W / 2, H);
      const d = await shot(page, path.join(OUT, `${r.name}-desktop-left-eye.png`));
      r.shots.push({ file: `${r.name}-desktop-left-eye.png`, ...d });
      const cmp = await page.evaluate(async (a, b) => {
        const load = async (f) => { const i = new Image(); i.src = f; await i.decode(); return i; };
        const [A, Bm] = [await load(a), await load(b)];
        const c = document.createElement('canvas'); c.width = 200; c.height = 200; const g = c.getContext('2d');
        const px = (img, sx, sw) => { g.clearRect(0, 0, 200, 200); g.drawImage(img, sx, 0, sw, img.height, 0, 0, 200, 200); return g.getImageData(0, 0, 200, 200).data; };
        const x = px(A, 0, A.width / 2), y = px(Bm, 0, Bm.width);
        let d = 0; const mx = [0, 0, 0], my = [0, 0, 0];
        for (let i = 0; i < x.length; i += 4) for (let k = 0; k < 3; k++) { d += Math.abs(x[i + k] - y[i + k]); mx[k] += x[i + k]; my[k] += y[i + k]; }
        const n = x.length / 4;
        return { meanAbsDiff: +(d / n / 3).toFixed(2), xrMeanRGB: mx.map((v) => +(v / n).toFixed(1)), desktopMeanRGB: my.map((v) => +(v / n).toFixed(1)) };
      }, 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, `${r.name}-vr-eyes.png`)).toString('base64'), 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, `${r.name}-desktop-left-eye.png`)).toString('base64'));
      r.look = cmp;
      check(r, 'XR grade vs the desktop pipeline, same eye (mean |diff| < 25 of 255; no stand-in: 26-35)', cmp.meanAbsDiff < 25, cmp);
      await page.evaluate((w, h) => window.__mirage.world.resize(w, h), W, H);
    }

    // the desktop path, same frames: keys, play.step(dt) for each recorded dt, from the same start
    for (const wk of C.walks) {
      const end = await page.evaluate((wk) => {
        const { play } = window.__mirage, w = play.walker;
        play.stop();
        play.place(wk.eyeUsed, wk.lookUsed, 'walk');
        if (window.__mirage.g) w.place(wk.from, { exact: true }); else { w.pos.splice(0, 3, ...wk.from); w.vy = 0; w.onGround = true; }
        play.syncWalkerView();
        play.yaw = wk.trace[0].yaw;
        // the keys each recorded frame had: W while the stick was forward, Shift while the grip was held
        const held = new Set(), set = (code, on) => {
          if (on === held.has(code)) return;
          if (on) held.add(code); else held.delete(code);
          window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code }));
        };
        for (const f of wk.trace) {
          if (f.x !== 0 || (f.z !== 0 && f.z !== 1)) throw new Error('replay: only a full forward stick maps to a key');
          set('KeyW', f.z === 1); set('ShiftLeft', f.run);
          play.step(f.dt);
        }
        set('KeyW', false); set('ShiftLeft', false);
        return w.pos.slice();
      }, { eyeUsed: wk.eyeUsed, lookUsed: wk.lookUsed, from: wk.from, trace: wk.trace });
      const d = Math.hypot(end[0] - wk.end[0], end[1] - wk.end[1], end[2] - wk.end[2]);
      check(r, `walk ${wk.name}: the desktop path ends where XR did`, d < (game ? 2e-2 : 1e-3), { xr: wk.end, desktop: end.map((v) => +v.toFixed(3)), diff: +d.toFixed(5) });
    }
    await page.evaluate(() => window.__mirage.play.start());

    // ---- AR: the world on the floor in front of you (no hit test in the emulator without its environment module)
    await page.evaluate(() => window.__iwer.quaternion.set(Math.sin(-0.35), 0, 0, Math.cos(-0.35)));   // look down at it
    await enterXR(page, 'immersive-ar');
    await sleep(2200);
    const a = await page.evaluate(() => window.__mirage.xr.state());
    const s = await shot(page, path.join(OUT, `${r.name}-ar.png`));
    r.shots.push({ file: `${r.name}-ar.png`, ...s });
    check(r, 'AR: the world placed as a table model', a.presenting && a.mode === 'ar' && a.ar.placed, { presenting: a.presenting, mode: a.mode, placed: a.ar.placed, scale: a.ar.scale, hitTest: a.ar.hitTest, image: s });
    await page.evaluate(() => window.__mirage.xr.exit());
    await page.waitForFunction(() => !window.__mirage.xr.presenting, { timeout: 10000 });
    await sleep(500);
    const back = await page.evaluate(() => ({ frames: window.__mirage.play.stats.frames, size: [document.querySelector('canvas').width, document.querySelector('canvas').height], tm: window.__mirage.world.renderer.toneMapping }));
    await sleep(500);
    const back2 = await page.evaluate(() => window.__mirage.play.stats.frames);
    check(r, 'after exit: the desktop loop runs again at the page size, no tone mapping on the renderer', back2 > back.frames && back.size[0] === W && back.tm === 0, { ...back, framesLater: back2 });
    const still1 = await desktopStill();
    fs.writeFileSync(path.join(OUT, `${r.name}-desktop-before-xr.png`), Buffer.from(still0.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, `${r.name}-desktop-after-xr.png`), Buffer.from(still1.split(',')[1], 'base64'));
    const compare = (a, b) => page.evaluate(async (a, b) => {
      const load = async (f) => { const i = new Image(); i.src = f; await i.decode(); return i; };
      const [A, B] = [await load(a), await load(b)], c = document.createElement('canvas'); c.width = A.width; c.height = A.height;
      const g = c.getContext('2d'), px = (i) => { g.clearRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const x = px(A), y = px(B); let n = 0, m = 0;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { n++; m = Math.max(m, Math.abs(x[i] - y[i])); }
      return { differing: n, maxDiff: m, size: [A.width, A.height] };
    }, a, b);
    const steady = await compare(still0, still0b);
    if (steady.differing) r.checks.push({ name: 'desktop still before / after XR: not comparable, the scene moves with the game clock (two stills before XR differ)', ok: true, skipped: true, ...steady });
    else {
      const same = await compare(still0, still1);
      check(r, 'desktop still at the spawn: bit-identical before and after the XR sessions', same.differing === 0, same);
    }
    check(r, 'no console errors', errors.length === 0, errors.length ? { errors: errors.slice(0, 5) } : undefined);
  } finally {
    await browser.close();
    srv.close();
  }
  report.worlds.push(r);
}

async function perf(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: PW, h: PH });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTALL);
    await page.setViewport({ width: PW, height: PH, deviceScaleFactor: 1 });
    await page.goto(srv.url + `?mode=walk&ui=0&hud=0&start=1&grain=0&w=${PW}&h=${PH}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    const name = await page.evaluate(() => window.__mirage.built.plan.name);
    await enterXR(page, 'immersive-vr');
    await sleep(800);
    const out = await page.evaluate(() => new Promise((resolve) => {
      const { world, xr } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4);
      const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const orig = world.renderDirect, cpu = [], gpu = [], pending = [];
      let calls = 0, tris = 0, n = 0;
      world.renderDirect = (...a) => {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // start from an idle GPU
        let q = null;
        if (tq) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
        const t = performance.now();
        orig(...a);
        if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push(q); }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        cpu.push(performance.now() - t);
        calls = world.renderer.info.render.calls; tris = world.renderer.info.render.triangles;
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(tq.GPU_DISJOINT_EXT)) { gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(p); pending.splice(i, 1); }
        }
        if (++n === 90) {
          world.renderDirect = orig;
          const stat = (ms) => { if (!ms.length) return null; ms = ms.slice(10).sort((a, b) => a - b); return { meanMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(2), n: ms.length }; };
          resolve({ size: world.renderer.getDrawingBufferSize(new world.ctx.THREE.Vector2()).toArray(), quality: world.ctx.quality, frameToReadback: stat(cpu), gpuTimer: tq ? stat(gpu) : 'EXT_disjoint_timer_query_webgl2 not offered', calls, triangles: tris,
            gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL), xrCpuMs: +xr.stats.ms.toFixed(2) });
        }
      };
    }));
    await page.evaluate(() => window.__mirage.xr.exit());
    report.perf = report.perf || [];
    report.perf.push({ name, ...out });
    console.log('perf', name, JSON.stringify(out));
  } finally {
    await browser.close();
    srv.close();
  }
}

// ---- --native: the page as a native WebXR host runs it (see the usage at the top)
const nativeStubs = (control) => `(() => {
  const no = function () {};
  const est = function (t) { const m = /(\\d+(?:\\.\\d+)?)px/.exec(this.font); const px = m ? +m[1] : 10; return { width: 0.6 * px * String(t).length }; };
  for (const P of [${control ? 'globalThis.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype' : 'globalThis.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, globalThis.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype'}]) {
    if (!P) continue;
    P.fillText = no; P.strokeText = no;${control ? '' : ' delete P.roundRect; P.measureText = est;'}
  }
  // no layout engine: nothing but the canvas is drawn (the Enter VR buttons, a game's DOM UI)
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'body > :not(canvas) { display: none !important; }'; document.head.appendChild(st); });
})();`;

async function native(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: W, h: H });
  const r = { dir, native: true, checks: [], shots: [] };
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTALL);
    await page.evaluateOnNewDocument(nativeStubs(CONTROL));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(srv.url + `?mode=walk&ui=0&hud=0&start=1&grain=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    r.name = (await page.evaluate(() => window.__mirage.built.plan.name)) + (CONTROL ? ' (control)' : ' (native)');
    const name = r.name.split(' ')[0], C = CASES[name] || { walks: [] }, tag = name + (CONTROL ? '-control' : '-native');
    const game = await page.evaluate(() => !!window.__mirage.g);
    // no layout: the buttons exist but take no space and are never pressed; the session comes from offerSession
    await page.waitForFunction(() => window.__mirage.xr.offered, { timeout: 15000 }).catch(() => {});
    const pre = await page.evaluate(() => {
      const xr = window.__mirage.xr, b = xr.buttons['immersive-vr'], box = b ? b.getBoundingClientRect() : null;
      return { offered: xr.offered, offers: xr.offers, text: xr.text, button: box ? [box.width, box.height] : null, presenting: xr.presenting };
    });
    check(r, 'no DOM layout: the Enter VR button takes no space; the page offers the session (navigator.xr.offerSession)', pre.offered && !pre.presenting && (!pre.button || pre.button[0] === 0), pre);
    check(r, CONTROL ? 'control: canvas labels (detection fooled: OffscreenCanvas draws text)' : 'labels use the built-in glyphs (Canvas 2D fillText draws nothing here)', pre.text === (CONTROL ? 'canvas' : 'glyphs'), { text: pre.text });
    const f0 = await page.evaluate(() => window.__mirage.xr.stats.frames);
    await page.evaluate(() => window.__iwer.grantOfferedSession());   // the platform's Enter VR (a native host: on launch)
    await page.waitForFunction((f0) => window.__mirage.xr.mode === 'vr' && window.__mirage.xr.stats.frames > f0 + 10, { timeout: 30000, polling: 50 }, f0);
    const s0 = await page.evaluate(() => window.__mirage.xr.state());
    check(r, 'the offered session starts with no click: VR presenting', s0.presenting && s0.mode === 'vr', { size: s0.size });

    // hands: iwer's emulated hands instead of the controllers (Quest hand tracking)
    await page.evaluate(() => { const d = window.__iwer; d.primaryInputMode = 'hand'; for (const h of [d.hands.left, d.hands.right]) { h.poseId = 'default'; h.updatePinchValue(0); } });
    await sleep(500);
    const hs = await page.evaluate(() => window.__mirage.xr.state().hands);
    check(r, 'hands tracked (iwer hand emulation): joints read, no controller', hs.filter((h) => h.hand && h.tracked).length === 2, { hands: hs });
    const right = hs.findIndex((h) => h.handedness === 'right');
    const pinch = async (v) => { await page.evaluate((v) => window.__iwer.hands.right.updatePinchValue(v), v); await frames(page, 4); };

    if (game && C.interact) {
      const I = C.interact;
      const at = await page.evaluate((id) => { const g = window.__mirage.g; return g.game.where(g.game.entities.get(id)); }, I.id);
      const eye = I.eye.slice(); const gy = await page.evaluate((x, z) => window.__mirage.play.grid.groundAt(x, z), eye[0], eye[2]); eye[1] = gy + 1.62;
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), eye, at);
      const pitch = Math.atan2(at[1] - (gy + 1.6), Math.hypot(at[0] - eye[0], at[2] - eye[2]));
      await page.evaluate((p) => window.__iwer.quaternion.set(Math.sin(p / 2), 0, 0, Math.cos(p / 2)), pitch);
      await sleep(600);
      const p = await page.evaluate(() => window.__mirage.xr.state());
      const file = path.join(OUT, `${tag}-prompt.png`);
      r.shots.push({ file: path.basename(file), ...(await shot(page, file)) });
      const lp = await labelPixels(page, file);
      check(r, CONTROL ? `control: the prompt over "${I.id}" shows no text (fillText draws nothing; the pixel check must fail)` : `the prompt over "${I.id}" shows its text in the eye image (glyphs; pixel check)`,
        CONTROL ? p.near === I.id && lp.visible && !textShows(lp) : p.near === I.id && /^Pinch: /.test(p.prompt || '') && textShows(lp), { prompt: p.prompt, ...lp });
      if (!CONTROL) {
        await pinch(1); await pinch(0); await sleep(300);
        const st = await page.evaluate(() => { const g = window.__mirage.g; return { inventory: g.game.inventory.items.map((i) => i.id), panel: window.__mirage.xr.state().panel }; });
        r.shots.push({ file: `${tag}-after-pinch.png`, ...(await shot(page, path.join(OUT, `${tag}-after-pinch.png`))) });
        check(r, `a pinch interacts (the trigger's job): ${I.want}; the toast on the panel`, I.flag(st) && !!st.panel, st);
      }
      await page.evaluate(() => window.__iwer.quaternion.set(0, 0, 0, 1));
      await sleep(200);
    }

    // point, then pinch: teleport along the index finger
    if (C.teleport && !CONTROL) {
      const eye = C.teleport.eye.slice(), look = C.teleport.look.slice();
      if (eye[1] === 0) { const g = await page.evaluate((x, z) => window.__mirage.play.grid.groundAt(x, z), eye[0], eye[2]); eye[1] = g + 1.62; look[1] = g + 1.62; }
      await page.evaluate((e, l) => window.__mirage.xr.place(e, l), eye, look);
      await page.evaluate(() => { const h = window.__iwer.hands.right; h.poseId = 'point'; h.quaternion.set(0, 0, 0, 1); });
      await sleep(300);
      // turn the hand so the index points ahead and 30 degrees down (three's joints are in the reference space)
      await page.evaluate((i) => {
        const { world } = window.__mirage, THREE = world.ctx.THREE, J = world.renderer.xr.getHand(i).joints;
        const dir = J['index-finger-tip'].position.clone().sub(J['index-finger-phalanx-proximal'].position).normalize();
        const want = new THREE.Vector3(0, -Math.sin(0.52), -Math.cos(0.52)), q = new THREE.Quaternion().setFromUnitVectors(dir, want);
        const h = window.__iwer.hands.right, hq = new THREE.Quaternion(h.quaternion.x, h.quaternion.y, h.quaternion.z, h.quaternion.w).premultiply(q);
        h.quaternion.set(hq.x, hq.y, hq.z, hq.w);
      }, right);
      await sleep(500);
      const before = await page.evaluate(() => window.__mirage.xr.state());
      r.shots.push({ file: `${tag}-hand-aim.png`, ...(await shot(page, path.join(OUT, `${tag}-hand-aim.png`))) });
      await pinch(1);
      await sleep(300);
      const after = await page.evaluate(() => window.__mirage.xr.state());
      await pinch(0);
      const t = before.teleport, hop = Math.hypot(after.walker[0] - before.walker[0], after.walker[2] - before.walker[2]);
      const onTarget = t.target && Math.hypot(after.walker[0] - t.target[0], after.walker[2] - t.target[2]) < 0.3;
      check(r, 'point aims the arc from the index finger; pinch teleports there', t.aiming && t.by === 'hand' && t.valid && onTarget && hop > 1.5 && !after.teleport.aiming,
        { aim: t, before: before.walker, after: after.walker, hop: +hop.toFixed(2) });
    }
    await page.evaluate(() => window.__mirage.xr.exit());
    await page.waitForFunction(() => !window.__mirage.xr.presenting, { timeout: 10000 });
    await sleep(300);
    const again = await page.evaluate(() => ({ offered: window.__mirage.xr.offered, offers: window.__mirage.xr.offers }));
    check(r, 'after the session ends the page offers again', again.offered && again.offers >= 2, again);
    const noise = errors.filter((e) => !/fillText|roundRect/.test(e));
    check(r, 'no console errors', noise.length === 0, noise.length ? { errors: noise.slice(0, 5) } : undefined);
  } finally {
    await browser.close();
    srv.close();
  }
  report.worlds.push(r);
}

// ---- --alloc: what a steady VR frame allocates (see the usage at the top)
async function alloc(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: W, h: H });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTALL);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(srv.url + `?mode=walk&ui=0&hud=0&start=1&grain=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    const name = await page.evaluate(() => window.__mirage.built.plan.name);
    // createXR's lines in an unminified bundle: from xrSupport to createXR's closing brace (+ glyphs.js, xr-hands.js)
    const regions = [];
    for (const f of fs.readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.js'))) {
      const L = fs.readFileSync(path.join(dir, 'assets', f), 'utf8').split('\n');
      const find = (re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i])) return i; return -1; };
      const close = (i) => find(/^}$/, i);
      const a = find(/^async function xrSupport\(/), cx = find(/^function createXR\(/);
      if (a >= 0 && cx >= 0) regions.push({ file: f, name: 'xr.js', from: find(/^const TM = /) >= 0 ? find(/^const TM = /) : a, to: close(cx) });
      const g0 = find(/^const FONT = /), g1 = find(/^const resetCanvasTextCheck/);
      if (g0 >= 0 && g1 >= 0) regions.push({ file: f, name: 'glyphs.js', from: g0, to: g1 });
      const h0 = find(/^const HAND_JOINTS = /), h1 = find(/^function createHandGesture\(/);
      if (h0 >= 0 && h1 >= 0) regions.push({ file: f, name: 'xr-hands.js', from: h0, to: close(h1) });
    }
    await enterXR(page, 'immersive-vr');
    const sp = await page.evaluate(() => window.__mirage.built.plan.spawn);
    await page.evaluate((e, l) => window.__mirage.xr.place(e, l), sp.eye, sp.look);
    // warm up (10 s of frames) so the frame's functions run optimised, as they do a few seconds into a session
    // (unoptimised code boxes every intermediate double: that would be measured instead of the code's own garbage)
    await frames(page, 600);
    const cdp = await page.target().createCDPSession();
    await cdp.send('HeapProfiler.enable');
    const out = { name, dir, frames: AF, regions: regions.map((g) => `${g.name} ${g.file}:${g.from + 1}-${g.to + 1}`), phases: {} };
    for (const phase of ['standing', 'walking']) {
      if (phase === 'walking') { await ctl(page, 'left', 'updateAxes', 'thumbstick', 0, -1); await sleep(300); }
      await cdp.send('HeapProfiler.collectGarbage');
      await page.tracing.start({ categories: ['devtools.timeline', 'v8'] });
      const t0 = await page.evaluate(() => ({ f: window.__mirage.xr.stats.frames, t: performance.now() }));
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await frames(page, AF);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const t1 = await page.evaluate(() => ({ f: window.__mirage.xr.stats.frames, t: performance.now() }));
      const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString("utf8"));
      const n = t1.f - t0.f;
      const byScript = {}, byFn = {}, byRegion = {};
      let total = 0;
      (function walk(node) {
        const cf = node.callFrame, sz = node.selfSize;
        if (sz) {
          total += sz;
          const file = cf.url ? cf.url.split('/').pop() : '(no url: iwer and other injected code, natives)';
          byScript[file] = (byScript[file] || 0) + sz;
          const reg = regions.find((g) => cf.url.endsWith(g.file) && cf.lineNumber >= g.from && cf.lineNumber <= g.to);
          const key = `${cf.functionName || '(anonymous)'} ${reg ? reg.name : file}:${cf.lineNumber + 1}`;
          byFn[key] = (byFn[key] || 0) + sz;
          if (reg) byRegion[reg.name] = (byRegion[reg.name] || 0) + sz;
        }
        for (const c of node.children) walk(c);
      })(profile.head);
      const gcs = { minor: 0, major: 0 };
      for (const e of trace.traceEvents) { if (e.name === 'MinorGC' && e.ph !== 'E') gcs.minor++; else if (e.name === 'MajorGC' && e.ph !== 'E') gcs.major++; }
      const per = (b) => Math.round(b / n);
      out.phases[phase] = {
        frames: n, seconds: +((t1.t - t0.t) / 1000).toFixed(2), bytesPerFrame: per(total),
        createXR: Object.fromEntries(Object.entries(byRegion).map(([k, v]) => [k, per(v)])),
        byScript: Object.fromEntries(Object.entries(byScript).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, per(v)])),
        top: Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, per(v)]),
        topCreateXR: Object.entries(byFn).filter(([k]) => regions.some((g) => k.includes(' ' + g.name + ':'))).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, per(v)]),
        gcs,
      };
      console.log('alloc', name, phase, JSON.stringify(out.phases[phase]));
    }
    await ctl(page, 'left', 'updateAxes', 'thumbstick', 0, 0);
    await page.evaluate(() => window.__mirage.xr.exit());
    report.alloc = report.alloc || [];
    report.alloc.push(out);
  } finally {
    await browser.close();
    srv.close();
  }
}

const only = flag('perf-only', false) || flag('native-only', false) || flag('alloc-only', false);
if (!only) for (const t of targets) await run(t);
if (NATIVE || CONTROL) for (const t of targets) await native(t);
if (ALLOC) for (const t of targets) await alloc(t);
if (PERF) for (const t of targets) await perf(t);
fs.writeFileSync(path.join(OUT, 'xr-check.json'), JSON.stringify(report, null, 1));
console.log(`xr-check: ${report.worlds.reduce((n, w) => n + w.checks.length, 0)} checks, ${failed} failed; ${path.join(OUT, 'xr-check.json')}`);
process.exit(failed ? 1 : 0);

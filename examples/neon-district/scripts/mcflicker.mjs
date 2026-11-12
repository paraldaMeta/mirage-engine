#!/usr/bin/env node
// Motion-compensated flicker: each odd frame of a captured sequence is predicted from its even neighbours by optical
// flow (ffmpeg minterpolate, motion-compensated interpolation) and compared with the real frame. Smooth motion (a pan,
// a walk, a gun's sway) is predicted away; shimmer, z-fighting, popping and per-frame flicker remain.
// Re-implemented after the Nizwa Golden Hour project's tools/mcflicker.mjs (the owner's own tool: the same metric:
// 640 x 360 grey frames, minterpolate mi_mode=mci mc_mode=aobmc me_mode=bidir vsbmc=1, the mean absolute residual
// over the frame less a 12 % border, and the share of pixels off by more than 12 levels). Here the frames come from
// the page (readPixels after each frame) instead of a film file, and ffmpeg reads them as raw grey video.
//   node scripts/mcflicker.mjs [dist] --mode world [--q medium] [--frames 48] [--query k=v]   the building vistas
//   node scripts/mcflicker.mjs [dist] --mode gun [--q medium] [--frames 60]                    the view model (game)
// world: the two vistas of scripts/stability.mjs, the camera still and panning 1 degree a second (stepped frames,
// 60 Hz, rain off); gun: the game at the spawn (robots parked, rain off), standing, walking, aiming (real time).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const MODE = flag('mode', 'world'), Q = flag('q', 'medium'), FRAMES = +flag('frames', MODE === 'gun' ? 60 : 48), TIME = flag('time', 'night');
const W = 960, H = 600, FW = 640, FH = 360, N = FW * FH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the metric on FRAMES grey frames (Uint8Array FW * FH each) */
function mcflicker(frames) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcf-')), raw = path.join(tmp, 'in.gray');
  fs.writeFileSync(raw, Buffer.concat(frames.map((f) => Buffer.from(f))));
  const grab = (vf) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${FW}x${FH}`, '-r', '60', '-i', raw, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
    if (r.error) { console.error(r.error.code === 'ENOENT' ? '[mcflicker] ffmpeg not found' : r.error.message); process.exit(1); }
    return r.stdout;
  };
  const orig = grab('format=gray');
  const pred = grab("select='not(mod(n\\,2))',minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=gray");
  fs.rmSync(tmp, { recursive: true, force: true });
  const nf = Math.min(orig.length, pred.length) / N | 0, mx = Math.round(FW * 0.12), my = Math.round(FH * 0.12);
  let s = 0, n = 0, hi = 0;
  const heat = new Float32Array(N);
  for (let f = 1; f < nf - 1; f += 2) {
    const o = orig.subarray(f * N, (f + 1) * N), p = pred.subarray(f * N, (f + 1) * N);
    let e = 0, big = 0, cnt = 0;
    for (let y = my; y < FH - my; y++) for (let x = mx; x < FW - mx; x++) { const i = y * FW + x, d = Math.abs(o[i] - p[i]); e += d; heat[i] += d; if (d > 12) big++; cnt++; }
    s += e / cnt; hi += big / cnt; n++;
  }
  for (let i = 0; i < N; i++) heat[i] /= Math.max(1, n);
  return { residual: s / n, over12: (100 * hi) / n, pairs: n, heat };
}
/** a heat map of the residual (white = 20 levels) beside the last frame, as PNG through ffmpeg */
function heatPng(file, heat, last) {
  const buf = Buffer.alloc(FW * 2 * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { buf[y * FW * 2 + x] = Math.min(255, heat[y * FW + x] * 12.75); buf[y * FW * 2 + FW + x] = last[y * FW + x]; }
  const tmp = path.join(os.tmpdir(), `mcf-heat-${process.pid}.gray`); fs.writeFileSync(tmp, buf);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${FW * 2}x${FH}`, '-i', tmp, file]);
  fs.rmSync(tmp, { force: true });
}

// in the page: the frame read back, flipped, to FW x FH grey (box filter)
const READ = `window.__grey = () => {
  const gl = window.__mirage.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = window.__px && window.__px.length === w * h * 4 ? window.__px : (window.__px = new Uint8Array(w * h * 4));
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Uint8Array(${FW} * ${FH}), sx = w / ${FW}, sy = h / ${FH};
  for (let y = 0; y < ${FH}; y++) for (let x = 0; x < ${FW}; x++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) { const j = ((h - 1 - yy) * w + xx) * 4; s += 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]; n++; }
    out[y * ${FW} + x] = Math.round(s / Math.max(1, n));
  }
  return Array.from(out);
};`;

const srv = await serve(dist), browser = await launch({ w: W, h: H });
const rows = [];
const OUT = flag('out');
if (MODE === 'world') {
  // --cams std: the standard cameras of scripts/timeshots.mjs instead of the two vistas
  const VISTAS = flag('cams') === 'std' ? [
    { name: 'street-up', eye: [-7, 1.62, 6.2], look: [12, 13, 3.5] },
    { name: 'skyline', eye: [21.5, 7.62, -21.6], look: [-24, 24, 22] },
    { name: 'shopfront', eye: [-14.2, 1.76, 8.6], look: [-16.6, 2.3, 2] },
    { name: 'street', eye: [-29.5, 1.62, 6.4], look: [8, 3.2, 5] },
    { name: 'plaza', eye: [10.2, 1.76, 0.9], look: [19, 3.6, -11] },
    { name: 'alley', eye: [-22, 1.62, 29.5], look: [-22, 4.5, 10] },
  ] : [
    { name: 'street, towers', eye: [0, 1.7, 8.5], look: [6, 42, -50] },
    { name: 'roof, plaza', eye: [9, 7.62, -21.3], look: [20, 2.5, 5] },
  ];
  const { page, errors } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&world=1&ui=0&quality=${Q}&rain=0&time=${TIME}${flag('query') ? '&' + flag('query') : ''}`);
  await page.evaluate(READ);
  for (const v of VISTAS) for (const pan of [0, 1]) {
    await page.evaluate((v) => {
      const { play, world } = window.__mirage; play.stop();
      for (let i = 0; i < 300 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
      play.place(v.eye, v.look, 'walk');
      for (let i = 0; i < 40; i++) { play.step(1 / 60); play.render({ moving: true }); }
    }, v);
    const frames = [];
    for (let f = 0; f < FRAMES; f++) {
      const g = await page.evaluate((pan) => { const { play } = window.__mirage; if (pan) play.turn(1, 0, (Math.PI / 180) / 60); play.step(1 / 60); play.render({ moving: true }); return window.__grey(); }, pan);
      frames.push(Uint8Array.from(g));
    }
    const r = mcflicker(frames);
    if (OUT) heatPng(path.join(OUT, `mcf-${Q}-${TIME}-${v.name.replace(/\W+/g, '-')}-${pan ? 'pan' : 'still'}.png`), r.heat, frames[frames.length - 1]);
    rows.push({ what: v.name, camera: pan ? 'pan 1°/s' : 'still', ...r });
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
} else {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.removeItem('mirage:neon-district:settings'));
  await page.goto(`${srv.url}?grain=0&hud=0&assist=1&quality=${Q}&start=1&lang=en&w=${W}&h=${H}&rain=0&time=${TIME}${flag('query') ? '&' + flag('query') : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(1500);
  await page.evaluate(READ);
  await page.evaluate(() => { const m = window.__mirage; for (const e of m.game.enemies.list) m.game.enemies.park?.(e); for (const e of m.game.drones.list) m.game.drones.park?.(e); m.game.weapon.select('carbine'); });
  for (const R of [{ name: 'still', keys: [] }, { name: 'walk', keys: ['KeyW'] }, { name: 'aim', keys: ['KeyQ'] }, { name: 'aim + walk', keys: ['KeyQ', 'KeyW'] }]) {
    await page.evaluate(() => { const m = window.__mirage, s = m.built.plan.spawn; m.play.place(s.eye, s.look, 'walk'); });
    await sleep(400);
    for (const k of R.keys) await page.keyboard.down(k);
    await sleep(600);
    // one frame per animation frame (the game draws once per animation frame)
    const frames = (await page.evaluate((n) => new Promise((res) => { const out = []; const t = () => { out.push(window.__grey()); if (out.length < n) requestAnimationFrame(t); else res(out); }; requestAnimationFrame(t); }), FRAMES)).map((a) => Uint8Array.from(a));
    for (const k of R.keys) await page.keyboard.up(k);
    const r = mcflicker(frames);
    if (OUT) heatPng(path.join(OUT, `mcf-gun-${Q}-${TIME}-${R.name.replace(/\W+/g, '-')}.png`), r.heat, frames[frames.length - 1]);
    rows.push({ what: 'view model, ' + R.name, camera: 'game', ...r });
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
}
await browser.close(); srv.close?.();
console.log(`neon-district motion-compensated flicker (after Nizwa's tools/mcflicker.mjs), ${MODE}, ${Q}, ${TIME}, ${FRAMES} frames at ${FW} x ${FH}\n`);
console.log('| what | camera | residual (/255) | pixels > 12 | pairs |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.what} | ${r.camera} | ${r.residual.toFixed(3)} | ${r.over12.toFixed(2)} % | ${r.pairs} |`);
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify(rows.map(({ heat, ...r }) => r), null, 1));
process.exit(0);

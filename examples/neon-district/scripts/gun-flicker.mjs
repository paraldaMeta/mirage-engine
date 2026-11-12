#!/usr/bin/env node
// Measure: how much the view model (the gun and the gloved hands) flickers. The real game in headless Chrome at the
// spawn (robots parked, rain off: its streaks would be the measurement), the carbine in hand; the gun's pixels are
// found by drawing the view with and without it (mean over 24 frames each, a luma difference over 10 levels, grown by
// 2 px). Then four runs of `frames` frames each: standing still, walking forward (W), aiming (Q held) and firing (F
// held, the muzzle flash flickers by design). Per run over the gun's pixels: the temporal standard deviation of luma
// (0..255; a still view should be near 0) and the RMS of its second difference in time (a smooth sway or bob
// cancels, a pixel that switches on and off does not), mean and 95th percentile.
//   node scripts/gun-flicker.mjs [dist] [--q medium] [--time night] [--frames 60] [--out out/gun] [--query k=v&..]
// --out writes per run a crop of the last frame and the heat map of the metric (white = 25 levels) side by side.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const W = 1280, H = 800, Q = flag('q', 'medium'), FRAMES = +flag('frames', 60), OUT = flag('out'), TIME = flag('time', 'night');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const page = await browser.newPage(), errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => localStorage.removeItem('mirage:neon-district:settings'));
await page.goto(`${srv.url}?grain=0&hud=0&assist=1&quality=${Q}&start=1&lang=en&w=${W}&h=${H}&rain=0&time=${TIME}${flag('query') ? '&' + flag('query') : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
await sleep(1500);
await page.evaluate(() => {
  const m = window.__mirage;
  for (const e of m.game.enemies.list) m.game.enemies.park?.(e);
  for (const e of m.game.drones.list) m.game.drones.park?.(e);
  const s = m.built.plan.spawn; m.play.place(s.eye, s.look, 'walk');
  m.game.weapon.select('carbine');
  // the crop the gun is in (the lower right of the view), GL rows bottom-up
  const gl = m.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const C = window.__crop = { x: Math.floor(w * 0.3), y: 0, w: Math.floor(w * 0.7), h: Math.floor(h * 0.62) };
  const px = new Uint8Array(C.w * C.h * 4), N = C.w * C.h;
  // n frames: per pixel the sum, the sum of squares and of the squared second difference; in isolated mode (the gun
  // alone on black) a pixel counts only on frames the gun covers it (lit above 2 levels: a, b and now): `n3` such triples
  window.__run = (n, keep = false, iso = false) => new Promise((res) => {
    const s1 = new Float64Array(N), s2 = new Float64Array(N), s3 = new Float64Array(N), n1 = new Uint16Array(N), n3 = new Uint16Array(N), a = new Float32Array(N), b = new Float32Array(N);
    let f = 0;
    const tick = () => {
      gl.readPixels(C.x, C.y, C.w, C.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const l = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
        if (!iso || l > 2) { s1[i] += l; s2[i] += l * l; n1[i]++; }
        if (f >= 2 && (!iso || (l > 2 && a[i] > 2 && b[i] > 2))) { const d = a[i] - 0.5 * (b[i] + l); s3[i] += d * d; n3[i]++; }
        b[i] = a[i]; a[i] = l;
      }
      if (++f < n) requestAnimationFrame(tick);
      else {
        const mean = new Float32Array(N), sd = new Float32Array(N), d2 = new Float32Array(N), ok = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          const k = Math.max(1, n1[i]); mean[i] = s1[i] / k; sd[i] = Math.sqrt(Math.max(0, s2[i] / k - mean[i] ** 2)); d2[i] = Math.sqrt(s3[i] / Math.max(1, n3[i]));
          ok[i] = iso ? (n1[i] === n ? 3 : 0) | (n3[i] >= (n - 2) * 0.5 ? 1 : 0) : 3;   // bit 1: sd valid (covered on every frame), bit 0: d2 valid (half the triples)
        }
        res({ mean, sd, d2, ok, last: keep ? px.slice() : null });
      }
    };
    requestAnimationFrame(tick);
  });
});
// the gun's pixels: with and without it
const mask = await page.evaluate(async () => {
  const m = window.__mirage, hold = m.game.weapon.holder, C = window.__crop, N = C.w * C.h;
  await window.__run(30);
  const on = await window.__run(24);
  hold.visible = false; await window.__run(30); const off = await window.__run(24); hold.visible = true;
  await window.__run(30);
  const k = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (Math.abs(on.mean[i] - off.mean[i]) > 10) k[i] = 1;
  const g = new Uint8Array(N);   // grown by 2 px
  for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) if (k[y * C.w + x]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < C.w && Y < C.h) g[Y * C.w + X] = 1; }
  window.__mask = g;
  let n = 0; for (let i = 0; i < N; i++) n += g[i];
  return n;
});
// isolated: the camera sees the view model alone (the gun on black; its lights, the image-based light and the grade stay)
await page.evaluate(() => {
  const m = window.__mirage, hold = m.game.weapon.holder, under = new Set();
  hold.traverse((o) => under.add(o));
  // by layer (the district's own culling sets visibility every frame): the camera sees layer 7 only, the gun and the
  // lights are on it too
  for (const o of under) o.layers.enable(7);
  m.world.scene.traverse((o) => { if (o.isLight) o.layers.enable(7); });
  const cam = m.world.camera;
  window.__iso = (on) => { if (on) cam.layers.set(7); else cam.layers.set(0); };
});
const rows = [];
const RUNS = [
  { name: 'still', keys: [] },
  { name: 'walk', keys: ['KeyW'] },
  { name: 'aim', keys: ['KeyQ'] },
  { name: 'fire', keys: ['KeyF'] },
  // against the alley's west wall, 0.8 m off it, walking into it: the gun pulls back toward the eye (the tuck)
  { name: 'wall', keys: ['KeyW'], eye: [-23.2, 1.62, 18], look: [-30, 1.5, 18.6] },
  { name: 'wall-aim', keys: ['KeyW', 'KeyQ'], eye: [-23.2, 1.62, 18], look: [-30, 1.5, 18.6] },
];
for (const mode of ['scene', 'iso']) for (const R of RUNS) {
  if (mode === 'scene' && (R.name === 'walk' || R.name === 'fire')) continue;
  if (mode === 'iso' && R.eye) continue;   // in the scene: the world moving or lit by the flash dominates
  await page.evaluate((iso, R) => { const m = window.__mirage, s = R.eye ? R : m.built.plan.spawn; window.__iso(false); m.play.place(s.eye, s.look, 'walk'); if (iso) window.__iso(true); }, mode === 'iso', R);
  await sleep(300);
  for (const k of R.keys) await page.keyboard.down(k);
  await sleep(R.name.includes('aim') || R.eye ? 600 : 150);
  const r = await page.evaluate(async (name, FRAMES, MAP, iso) => {
    const C = window.__crop, N = C.w * C.h, g = window.__mask;
    const res = await window.__run(FRAMES, true, iso);
    const sd = [], d2 = [], use = (i, bit) => (iso ? res.ok[i] & bit : g[i]);
    for (let i = 0; i < N; i++) { if (use(i, 2)) sd.push(res.sd[i]); if (use(i, 1)) d2.push(res.d2[i]); }
    const st = (v) => { v.sort((a, b) => a - b); return v.length ? { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, p95: v[Math.floor(v.length * 0.95)], p99: v[Math.floor(v.length * 0.99)] } : { n: 0, mean: NaN, p95: NaN, p99: NaN }; };
    let map = null;
    if (MAP) {
      const c = document.createElement('canvas'); c.width = C.w * 2; c.height = C.h; const ctx = c.getContext('2d'), im = ctx.createImageData(C.w * 2, C.h);
      for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) {
        const i = y * C.w + x, o = ((C.h - 1 - y) * C.w * 2 + x) * 4, o2 = o + C.w * 4, j = i * 4, inside = use(i, 1), v = Math.min(255, (iso ? res.d2[i] : res.sd[i]) * 10.2) * (iso && !inside ? 0 : 1);
        im.data[o2] = res.last[j]; im.data[o2 + 1] = res.last[j + 1]; im.data[o2 + 2] = res.last[j + 2]; im.data[o2 + 3] = 255;
        im.data[o] = v; im.data[o + 1] = inside ? v : v * 0.5; im.data[o + 2] = inside ? v : v * 0.5; im.data[o + 3] = 255;   // outside the gun: red
      }
      ctx.putImageData(im, 0, 0); map = c.toDataURL('image/png');
    }
    return { sd: st(sd), d2: st(d2), map };
  }, R.name, FRAMES, !!OUT, mode === 'iso');
  for (const k of R.keys) await page.keyboard.up(k);
  if (r.map) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `gun-${Q}-${TIME}-${mode}-${R.name}.png`), Buffer.from(r.map.split(',')[1], 'base64')); }
  const f = (x, k) => (Number.isFinite(x) ? +x.toFixed(k) : '-');
  rows.push({ mode, run: R.name, px: r.d2.n, sd: f(r.sd.mean, 3), sd95: f(r.sd.p95, 2), d2: f(r.d2.mean, 3), d295: f(r.d2.p95, 2), d299: f(r.d2.p99, 2) });
}
await browser.close(); srv.close?.();
console.log(`neon-district view model flicker, ${Q}, ${TIME}, ${W} x ${H}, ${FRAMES} frames, ${mask} gun pixels (0..255 luma)\n`);
console.log('scene: in the district, over the gun\'s pixels (with / without it); iso: the gun alone on black, over the pixels it covers\n');
console.log('| mode | run | pixels | temporal sd, mean | sd p95 | 2nd difference RMS, mean | p95 | p99 |\n|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.mode} | ${r.run} | ${r.px} | ${r.sd} | ${r.sd95} | ${r.d2} | ${r.d295} | ${r.d299} |`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ q: Q, time: TIME, mask, rows }, null, 1));
process.exit(0);

#!/usr/bin/env node
// Which part of a gun flickers while walking: the gun alone on black (camera layer 7), walking forward (W), one mesh of
// the gun visible at a time; per mesh the mean RMS of the second difference of luma in time over the pixels it covers
// on every frame (as gun-flicker.mjs's iso mode), its triangle count and its material.
//   node scripts/gun-parts.mjs [dist] --gun gatling [--frames 40] [--no-walk]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const W = 1280, H = 800, GUN = flag('gun', 'gatling'), FRAMES = +flag('frames', 40), WALK = !args.includes('--no-walk'), DROP = args.includes('--drop');   // --drop: all but one mesh visible
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.removeItem('mirage:neon-district:settings'));
await page.goto(`${srv.url}?grain=0&hud=0&assist=1&quality=medium&start=1&lang=en&w=${W}&h=${H}&rain=0&time=night`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
await sleep(1500);
await page.evaluate((GUN) => {
  const m = window.__mirage;
  for (const e of m.game.enemies.list) m.game.enemies.park?.(e);
  for (const e of m.game.drones.list) m.game.drones.park?.(e);
  const s = m.built.plan.spawn; m.play.place(s.eye, s.look, 'walk');
  if (GUN !== 'carbine') m.game.weapon.unlock(true);
  m.game.weapon.select(GUN);
  const hold = m.game.weapon.holder;
  hold.traverse((o) => o.layers.enable(7));
  m.world.scene.traverse((o) => { if (o.isLight) o.layers.enable(7); });
  m.world.camera.layers.set(7);
}, GUN);
await sleep(800);
if (WALK) await page.keyboard.down('KeyW');
await sleep(300);
const rows = await page.evaluate(async (FRAMES, DROP) => {
  const m = window.__mirage, hold = m.game.weapon.holder, gl = m.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, N = w * h, px = new Uint8Array(N * 4);
  const meshes = []; hold.traverse((o) => { if (o.isMesh) { let g = o; let on = true; while (g && g !== hold) { if (!g.visible) on = false; g = g.parent; } if (on) meshes.push(o); } });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const run = async () => {
    const s3 = new Float64Array(N), n3 = new Uint16Array(N), a = new Float32Array(N), b = new Float32Array(N), cov = new Uint16Array(N);
    for (let f = 0; f < FRAMES; f++) {
      await frame(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const l = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
        if (l > 2) cov[i]++;
        if (f >= 2 && l > 2 && a[i] > 2 && b[i] > 2) { const d = a[i] - 0.5 * (b[i] + l); s3[i] += d * d; n3[i]++; }
        b[i] = a[i]; a[i] = l;
      }
    }
    let sum = 0, n = 0, px95 = [];
    for (let i = 0; i < N; i++) if (cov[i] === FRAMES && n3[i] > FRAMES * 0.5) { const v = Math.sqrt(s3[i] / n3[i]); sum += v; n++; px95.push(v); }
    px95.sort((x, y) => x - y);
    return { n, mean: n ? sum / n : NaN, p95: n ? px95[Math.floor(n * 0.95)] : NaN };
  };
  const out = [];
  if (DROP) { for (const o of meshes) o.visible = true; const r = await run(); out.push({ name: 'all', tris: 0, mat: 'ALL VISIBLE', color: '', ...r }); }
  for (const mesh of meshes) {
    for (const o of meshes) o.visible = DROP ? o !== mesh : o === mesh;
    const r = await run(), mt = mesh.material;
    out.push({ name: mesh.parent?.name || '', tris: (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 | 0, mat: mt.name || mt.type, color: mt.color ? mt.color.getHexString() : '', metal: mt.metalness, rough: mt.roughness, ...r });
  }
  for (const o of meshes) o.visible = true;
  return out;
}, FRAMES, DROP);
if (WALK) await page.keyboard.up('KeyW');
const f = (x) => (Number.isFinite(x) ? +x.toFixed(2) : '-');
console.log(`${GUN}, ${WALK ? 'walking' : 'standing'}, ${DROP ? 'one mesh hidden at a time' : 'one mesh at a time'}\n| # | tris | material | colour | metal | rough | pixels | d2 mean | d2 p95 |\n|---|---|---|---|---|---|---|---|---|`);
rows.forEach((r, i) => console.log(`| ${i} | ${r.tris} | ${r.mat} | ${r.color} | ${f(r.metal)} | ${f(r.rough)} | ${r.n} | ${f(r.mean)} | ${f(r.p95)} |`));
await browser.close(); srv.close?.();
process.exit(0);

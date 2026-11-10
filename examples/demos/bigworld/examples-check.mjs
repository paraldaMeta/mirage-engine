// The big-world switches on the existing examples: ?perf=chunk,lod,occ against the page as it is, interleaved.
// node examples/demos/bigworld/examples-check.mjs [--runs 3] [--frames 240] [--perf chunk,lod,occ] [--only hello-courtyard,...] [--out file.json]
// Needs the examples built (npm run build:examples). Per example and variant: the viewer stands at the walk-mode
// spawn and turns once around in `frames` moving frames (world.renderFrame, taa); draw calls and triangles of the
// whole frame (shadow pass and post included), CPU ms of the draw, ms until the GPU finished it (1-px readback).
// Exit 1 if a page logs an error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), EX = path.join(here, '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const RUNS = +flag('runs', 3), FRAMES = +flag('frames', 240), PERF = flag('perf', 'chunk,lod,occ'), W = 1280, H = 720;
const NAMES = flag('only', 'hello-courtyard,walled-garden,garden-quest,agent-trial,river-ford,snow-hut,woodland-path').split(',');
const failures = [], results = {};

async function measure(url, query) {
  const browser = await launch({ w: W, h: H }), page = await browser.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?w=${W}&h=${H}&mode=walk&ui=0&hud=0&grain=0&${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 300000, polling: 100 });
  const out = await page.evaluate(async (frames) => {
    const m = window.__mirage, world = m.world, big = window.__big || null;
    m.play?.stop?.();
    if (big) await big.ready();
    const { renderer, camera } = world, info = renderer.info, gl = renderer.getContext(), px = new Uint8Array(4);
    info.autoReset = false;
    const cpu = [], full = [], calls = [], tris = [], up = camera.up.clone().set(0, 1, 0);
    let T = 0;
    for (let i = -40; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      camera.rotateOnWorldAxis(up, 2 * Math.PI / frames); camera.updateMatrixWorld(true); T += 1 / 60;
      info.reset();
      world.renderFrame(T, { taa: true, dt: 1 / 60 });
      const t1 = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 0) { cpu.push(t1 - t0); full.push(performance.now() - t0); calls.push(info.render.calls); tris.push(info.render.triangles); }
    }
    const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
    return { calls: mean(calls), triangles: mean(tris), cpuMs: mean(cpu), frameMs: mean(full), big: big && big.stats() };
  }, FRAMES);
  if (errors.length) { failures.push(`${url} ${query}: ${errors.slice(0, 3).join(' | ')}`); console.log('FAIL ' + failures.at(-1)); }
  await browser.close();
  return out;
}
const stat = (xs) => ({ mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), min: +Math.min(...xs).toFixed(2), max: +Math.max(...xs).toFixed(2) });

for (const name of NAMES) {
  const dist = path.join(EX, name, 'dist');
  if (!fs.existsSync(dist)) { console.log(`${name}: no dist (npm run build:examples)`); continue; }
  const srv = await serve(dist), acc = { off: {}, on: {} };
  let big = null;
  for (let r = 0; r < RUNS; r++) for (const [k, q] of [['off', ''], ['on', 'perf=' + PERF]]) {
    const m = await measure(srv.url, q);
    for (const key of ['calls', 'triangles', 'cpuMs', 'frameMs']) (acc[k][key] ??= []).push(m[key]);
    if (m.big) big = m.big;
  }
  srv.close();
  const row = { off: {}, on: {}, big };
  for (const k of ['off', 'on']) for (const key in acc[k]) row[k][key] = stat(acc[k][key]);
  results[name] = row;
  const f = (v) => `${v.calls.mean} calls, ${(v.triangles.mean / 1e3).toFixed(0)} k tris, cpu ${v.cpuMs.mean} ms (${v.cpuMs.min}-${v.cpuMs.max}), frame ${v.frameMs.mean} ms (${v.frameMs.min}-${v.frameMs.max})`;
  console.log(`${name}\n  off: ${f(row.off)}\n  on:  ${f(row.on)}\n  ${JSON.stringify(big)}`);
}
const out = flag('out', null);
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nexamples check: ok');
process.exit(failures.length ? 1 : 0);

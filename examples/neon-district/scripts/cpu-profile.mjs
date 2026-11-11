#!/usr/bin/env node
// Where a frame's CPU time goes: the DevTools sampling profiler over `frames` moving frames at a view (step + render
// + a 1-pixel read-back, as measure.mjs times them), self time per function and total time per top-level caller.
// Build unminified for names: npx vite build --minify false --outDir <dir>
//   node scripts/cpu-profile.mjs <dist> [--view "street west"] [--quality low] [--frames 240] [--world] [--top 40]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(here, '../dist'));
const W = 1440, H = 900, VIEW = flag('view', 'street west'), N = +flag('frames', 240), TOP = +flag('top', 40);
const query = (args.includes('--world') ? `world=1&ui=0&quality=${flag('quality', 'low')}` : `start=1&assist=1&quality=${flag('quality', 'low')}`) + (flag('q') ? '&' + flag('q') : '');
const srv = await serve(dist), browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&${query}`);
await page.evaluate((VIEW) => {
  const { play, built, world } = window.__mirage;
  play.stop();
  for (let i = 0; i < 900 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
  const v = built.plan.viewpoints.find((q) => q.name === VIEW); play.place(v.eye, v.look, 'walk');
  for (let i = 0; i < 30; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); }
}, VIEW);
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
const ms = await page.evaluate((N) => {
  const { play, world } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4), t0 = performance.now();
  let step = 0, render = 0, sync = 0;
  for (let i = 0; i < N; i++) {
    const a = performance.now(); play.turn(i % 120 < 60 ? 1 : -1, 0, 0.004); play.step(1 / 60);
    const b = performance.now(); play.render({ moving: true });
    const c = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const d = performance.now(); step += b - a; render += c - b; sync += d - c;
  }
  return { frame: (performance.now() - t0) / N, step: step / N, render: render / N, readback: sync / N };
}, N);
const { profile } = await cdp.send('Profiler.stop');
await browser.close(); srv.close?.();
const byId = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
const dt = profile.timeDeltas, total = dt.reduce((a, b) => a + b, 0) / 1000;
profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${path.basename(f.url || '')}:${f.lineNumber}`; self.set(k, (self.get(k) || 0) + dt[i] / 1000); });
console.log(`${VIEW}, ${query}: ${N} frames; ms a frame: ${Object.entries(ms).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}; profiled ${total.toFixed(0)} ms\nself time, ms a frame:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${(v / N).toFixed(3).padStart(7)}  ${k}`);

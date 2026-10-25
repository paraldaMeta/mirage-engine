#!/usr/bin/env node
// Mirage original code. Frame cost of a world's play modes in the real Chrome: the page's rAF loop is stopped and
// frames are driven synchronously (step + render + a 1-pixel readback, so the GPU work is inside the timing).
//
// usage: mirage-perf <dist dir | page.html> [--w 1440 --h 900] [--frames 120] [--query q]
// Walk (moving, temporal AA) along the spawn's view, the game view walking, fly, and the still path at spp 6 / 16.
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const W = +flag('w', 1440), H = +flag('h', 900), N = +flag('frames', 120);
const isFile = target.endsWith('.html');
const srv = isFile ? null : await serve(target);
const url = (isFile ? 'file://' + path.resolve(target) : srv.url) + `?mode=walk&ui=0&w=${W}&h=${H}` + (flag('query') ? '&' + flag('query') : '');
const browser = await launch({ w: W, h: H });
try {
  const { page, errors, loadMs } = await open(browser, url);
  const r = await page.evaluate((N) => {
    const { play, built } = window.__mirage, gl = play.world.renderer.getContext(), px = new Uint8Array(4);
    play.stop();
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const stat = (ms) => { ms.sort((a, b) => a - b); return { meanMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(2), n: ms.length }; };
    const run = (mode, keys, n = N) => {
      const sp = built.plan.spawn; play.place(sp.eye, sp.look, mode);
      play.keys.clear(); for (const k of keys) play.keys.add(k);
      for (let i = 0; i < 10; i++) { play.step(1 / 60); play.render({ moving: true }); } sync();
      const ms = [];
      for (let i = 0; i < n; i++) { const t = performance.now(); play.step(1 / 60); play.render({ moving: true }); sync(); ms.push(performance.now() - t); }
      const info = play.world.renderer.info; info.autoReset = false; info.reset();
      play.step(1 / 60); play.render({ moving: true }); sync();
      const c = { calls: info.render.calls, triangles: info.render.triangles }; info.autoReset = true;
      play.keys.clear();
      return { ...stat(ms), ...c };   // calls / triangles: one whole frame (scene + shadow map + post passes)
    };
    const out = { size: [play.world.pipeline.w, play.world.pipeline.h], gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) };
    out.walk = run('walk', ['KeyW']);
    out.game = run('game', ['KeyW']);
    out.fly = run('fly', ['KeyW', 'KeyE']);
    for (const spp of [6, 16]) {
      const ms = [];
      for (let i = 0; i < 8; i++) { sync(); const t = performance.now(); play.render({ moving: false, spp, frameIndex: 1 }); sync(); ms.push(performance.now() - t); }
      out['still_spp' + spp] = stat(ms);
    }
    out.grid = play.grid.stats;
    out.build = built.report.ms;
    return out;
  }, N);
  console.log(JSON.stringify({ url, loadMs, ...r, errors }, null, 1));
} finally {
  await browser.close();
  if (srv) srv.close();
}

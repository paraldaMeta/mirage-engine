#!/usr/bin/env node
// Frame cost of the walk view in both engines: the same spots and hours, Chrome without vsync or a frame-rate limit
// (so the frame interval is the real cost), the camera turning a little every frame (both engines then draw their
// moving path: one sub-frame + temporal AA). Per spot: the mean frame interval (ms; uncapped Chrome delivers frames
// in bursts, so the median is not the cost), its median and 90th percentile, over --frames
// frames after --warm ms. The two pages are measured one after the other, the idle one closed.
//   node tools/bench.mjs [--w 1440 --h 900] [--times 17:00,21:00] [--frames 240] [--warm 1500] [--repeat 3]
//        [--query "off=light2"] (the probe's) [--nizwa-modules fort] [--nizwa-query nolight2] [--only mirage|nizwa] [--out out/bench.json]
//        [--shots dir] (a screenshot of the moving view at each spot)
// Needs both dev servers (see compare.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +flag('w', 1440), H = +flag('h', 900), FRAMES = +flag('frames', 240), WARM = +flag('warm', 1500), REPEAT = +flag('repeat', 3);
const DATE = '2026-10-25', only = flag('only');
const SPOTS = [
  { name: 'forecourt', eye: [36, 1.62, 40], look: [44, 4, 17] },
  { name: 'wall', eye: [20.5, 1.62, 21.5], look: [34, 3.2, 16.4] },
  { name: 'tower foot', eye: [-6, 1.62, 30], look: [0, 12, 0] },
  { name: 'far', eye: [-18, 1.62, 58], look: [26, 11, 0] },
];
const ENGINES = {
  nizwa: {
    url: (time) => `http://localhost:${process.env.NIZWA_PORT || 5190}/?mode=walk&scale=1&modules=${flag('nizwa-modules', 'fort')}&w=${W}&h=${H}&time=${time}&date=${DATE}&clock=0` + (flag('nizwa-query') ? '&' + flag('nizwa-query') : ''),
    place: (s) => { window.__walk.place(s.eye, s.look, 'walk'); }, turn: (d) => { window.__walk.nudge(d); },
    info: () => ({ ...window.__info, calls: window.__walk.prof.calls, tris: window.__walk.prof.tris }),
  },
  mirage: {
    url: (time) => `http://localhost:${process.env.VITE_PORT || 5291}/?mode=walk&ui=0&maxfps=100000&w=${W}&h=${H}&time=${time}` + (flag('query') ? '&' + flag('query') : ''),
    place: (s) => { window.__mirage.play.place(s.eye, s.look, 'walk'); }, turn: (d) => { window.__mirage.play.turn(d, 0, 1); },
    info: () => ({ walker: window.__mirage.play.walker.pos.map((v) => +v.toFixed(2)), onGround: window.__mirage.play.walker.onGround }),
  },
};
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)], p90 = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.9)];
const rows = [];
const browser = await launch({ w: W, h: H, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  for (const time of flag('times', '17:00,21:00').split(',')) for (const [name, E] of Object.entries(ENGINES)) {
    if (only && only !== name) continue;
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`[${name}:error] ${e.message}`));
    const t0 = Date.now();
    await page.goto(E.url(time), { waitUntil: 'domcontentloaded', timeout: 0 });
    await page.waitForFunction('window.__READY === true', { timeout: 900000, polling: 300 });
    const loadS = (Date.now() - t0) / 1000;
    await page.mouse.click(W / 2, H / 2);
    for (const s of SPOTS) {
      let best = null;
      for (let r = 0; r < REPEAT; r++) {
        const dts = await page.evaluate(async (place, turn, s, warm, n) => {
          (0, eval)(`(${place})`)(s);
          const T = (0, eval)(`(${turn})`);
          let k = 0;
          const spin = () => { T(Math.sin(k++ * 0.05) * 0.0015); };
          await new Promise((res) => { const t1 = performance.now(); const f = () => { spin(); if (performance.now() - t1 > warm) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
          const ts = [];
          await new Promise((res) => { const f = () => { spin(); ts.push(performance.now()); if (ts.length > n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
          return ts.slice(1).map((t, i) => t - ts[i]);
        }, E.place.toString(), E.turn.toString(), s, WARM, FRAMES);
        const m = { ms: +(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(2), med: +med(dts).toFixed(2), p90: +p90(dts).toFixed(2) };
        if (!best || m.ms < best.ms) best = m;
      }
      const info = await page.evaluate(E.info);
      const row = { engine: name, time, spot: s.name, ...best, fps: +(1000 / best.ms).toFixed(0), ...(info.calls ? { calls: info.calls, mtris: +(info.tris / 1e6).toFixed(2) } : {}), ...(info.walker ? { walker: info.walker, onGround: info.onGround } : {}), loadS: +loadS.toFixed(1) };
      rows.push(row); console.log(JSON.stringify(row));
      if (flag('shots')) { fs.mkdirSync(path.resolve(flag('shots')), { recursive: true }); await page.screenshot({ path: path.join(path.resolve(flag('shots')), `${name}-${s.name.replace(' ', '-')}-${time.replace(':', '')}.png`) }); }
    }
    await page.close();
  }
} finally { await browser.close(); }
if (flag('out')) { fs.mkdirSync(path.dirname(path.resolve(flag('out'))), { recursive: true }); fs.writeFileSync(path.resolve(flag('out')), JSON.stringify({ w: W, h: H, frames: FRAMES, rows }, null, 1)); }

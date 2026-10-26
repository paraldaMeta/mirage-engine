#!/usr/bin/env node
// B1: how much the image jumps when the view stops. Drives play's own frame loop (requestAnimationFrame is
// replaced by a queue flushed with 60 Hz timestamps), walks forward for `--walk` s, lets go and grabs every
// frame until the final still frame. Per frame: the change from the frame before (mean / max, luma 0-255).
// "pop" is the largest change after the view stopped; before B1's fade it is the TAA -> still frame switch.
// Fails when the view did not move or never settled, when a frame after the first still one changes by more than
// --limit (mean, default 1), or when the image the loop ends on is not the still frame drawn directly.
//   node packages/tools/src/still-pop.mjs <dist dir>... [--walk 1.5] [--view 0] [--limit 1] [--out out/still-pop]
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!targets.length) { console.error('usage: still-pop.mjs <dist dir>... [--walk s] [--view i] [--limit mean] [--out dir]'); process.exit(2); }
const OUT = path.resolve(flag('out', 'out/still-pop'));
const walk = +flag('walk', 1.5), view = +flag('view', 0), limit = +flag('limit', 1);
const FRAMES = 130;   // after letting go: a game camera eases for a while, then the final still frame (45) and its fade

async function measure(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: 1440, h: 900 });
  try {
    const { page, errors } = await open(browser, srv.url + '?hud=0');
    // play's loop asks for the next frame every frame: from here on it goes into the queue
    await page.evaluate(() => { window.__raf = { q: [] }; window.requestAnimationFrame = (cb) => (window.__raf.q.push(cb), 1); });
    await new Promise((r) => setTimeout(r, 300));   // the frame in flight queues itself
    await page.evaluate(({ view }) => {
      const { play, built } = window.__mirage;
      const vps = built?.plan?.viewpoints || [];
      if (vps[view]) play.place(vps[view].eye, vps[view].look, 'walk');
      const gl = play.world.renderer.domElement, c2 = document.createElement('canvas');
      c2.width = gl.width; c2.height = gl.height;
      const g2 = c2.getContext('2d', { willReadFrequently: true });
      const W = c2.width, H = c2.height;
      let t = performance.now();
      window.__pop = {
        W, H,
        grab: () => { g2.drawImage(gl, 0, 0); const d = g2.getImageData(0, 0, W, H).data, L = new Float32Array(W * H); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return L; },
        diff: (a, b) => { let s = 0, m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; } return { mean: +(s / a.length).toFixed(3), max: +m.toFixed(1) }; },
        tick: (n = 1) => { for (let i = 0; i < n; i++) { const q = window.__raf.q.splice(0); t += 1000 / 60; for (const cb of q) cb(t); } },
      };
    }, { view });
    // games start on any key (the start screen); walking goes through real key events (games read their action map)
    await page.keyboard.press('KeyX');
    await page.evaluate(() => window.__pop.tick(5));
    const from = await page.evaluate(() => window.__mirage.play.state().pos);
    await page.keyboard.down('KeyW');
    await page.evaluate((n) => window.__pop.tick(n), Math.round(walk * 60));
    await page.keyboard.up('KeyW');
    const R = await page.evaluate(({ from, FRAMES }) => {
      const { play } = window.__mirage, P = window.__pop;
      const to = play.state().pos;
      const frames = [];
      let prev = P.grab(), first = null, last = null;
      for (let i = 0; i < FRAMES; i++) {
        P.tick();
        const L = P.grab(), still = play.still;
        if (still === 1) first = L;
        frames.push({ still, ...P.diff(prev, L) });
        prev = last = L;
      }
      const after = frames.filter((f) => f.still >= 1);
      const pop = after.reduce((a, f) => (f.mean > a.mean ? f : a), { mean: -1 });
      play.render({ moving: false, spp: play.refine[1], frameIndex: 1 });
      const direct = P.grab();
      return {
        size: [P.W, P.H], refine: play.refine, walked: +Math.hypot(to[0] - from[0], to[2] - from[2]).toFixed(2), lastStill: play.still,
        paused: window.__mirage.g ? window.__mirage.g.game.paused : null,
        pop, 'stop->final': first && P.diff(first, last), 'last frame vs direct final': P.diff(last, direct), frames,
      };
    }, { from, FRAMES });
    R.errors = errors;
    return R;
  } finally {
    await browser.close();
    srv.close();
  }
}

let failed = 0;
for (const dir of targets) {
  const name = path.basename(path.dirname(path.resolve(dir)));
  const R = await measure(dir);
  fs.mkdirSync(path.join(OUT, name), { recursive: true });
  fs.writeFileSync(path.join(OUT, name, 'report.json'), JSON.stringify(R, null, 2) + '\n');
  const { frames, ...head } = R;
  console.log(name, JSON.stringify(head));
  console.log('  changes after stopping (still: mean/max):', frames.filter((f) => f.still >= 1 && f.mean > 0).map((f) => `${f.still}: ${f.mean}/${f.max}`).join('  '));
  const fail = [];
  if (R.walked < 0.5) fail.push(`the view did not move (walked ${R.walked} m)`);
  if (R.lastStill < 60) fail.push(`the view never settled (still ${R.lastStill} after ${FRAMES} frames)`);
  const big = frames.filter((f) => f.still >= 2 && f.mean > limit);
  if (big.length) fail.push(`a still frame switches in one step: ${big.map((f) => `still ${f.still} ${f.mean}`).join(', ')} > ${limit}`);
  if (R['last frame vs direct final'].max !== 0) fail.push(`the final image is not the still frame (max ${R['last frame vs direct final'].max})`);
  if (R.errors.length) fail.push(`console errors: ${R.errors.length}`);
  if (fail.length) failed++;
  console.log(fail.length ? `  FAIL\n    ${fail.join('\n    ')}` : '  ok');
}
console.log(failed ? `still-pop: ${failed} failing` : 'still-pop: ok');
process.exit(failed ? 1 : 0);

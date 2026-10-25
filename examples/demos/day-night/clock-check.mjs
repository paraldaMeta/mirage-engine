// Check: the day-night demo starts at ?from= and its image keeps up with its clock (B19).
// node examples/demos/day-night/clock-check.mjs   (packages the demo into out/, opens it in headless Chrome)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const html = path.join(here, 'out/day-night.html');
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: 'inherit' });

const FROM = 6 * 60 + 30, RATE = 40;
const b = await launch({ w: 960, h: 600 });
const page = await b.newPage(), errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument(() => {   // the hud's very first text
  new MutationObserver((_, obs) => {
    const hud = document.querySelector('#hud');
    if (hud && hud.textContent) { window.__firstHud = hud.textContent.split('\n')[0]; obs.disconnect(); }
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
await page.goto(pathToFileURL(html) + `?from=06:30&rate=${RATE}&w=960&h=600`);
await page.waitForFunction('window.__READY === true && window.__firstHud', { timeout: 120000, polling: 50 });
const firstHud = await page.evaluate(() => window.__firstHud);
const rows = await page.evaluate(async () => {
  const w = window.__mirage.world, rows = [], t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((r) => requestAnimationFrame(r));
    const [h, m] = document.querySelector('#hud').textContent.split('\n')[0].split(':').map(Number);
    rows.push({ t: performance.now() - t0, hud: h * 60 + m, target: w.light.exposure, exp: w.exposure });
  }
  return rows;
});
await b.close();

// lag: how many clock minutes ago the target exposure was what the frame shows (the clock from the hud, a
// least-squares line through the minute readings)
const n = rows.length, mt = rows.reduce((s, r) => s + r.t, 0) / n, mh = rows.reduce((s, r) => s + r.hud, 0) / n;
const k = rows.reduce((s, r) => s + (r.t - mt) * (r.hud - mh), 0) / rows.reduce((s, r) => s + (r.t - mt) ** 2, 0);
for (const r of rows) r.clock = mh + k * (r.t - mt);
let lag = 0;
for (let i = 0; i < n; i++) {
  const r = rows[i];
  if (Math.abs(Math.log(r.exp / r.target)) < 1e-3) continue;   // shown = target (the eased value stops 1e-4 short)
  for (let j = i; j > 0; j--) {
    const a = rows[j - 1], c = rows[j];
    if ((a.target - r.exp) * (c.target - r.exp) <= 0) {
      const f = (r.exp - a.target) / ((c.target - a.target) || 1);
      lag = Math.max(lag, r.clock - (a.clock + f * (c.clock - a.clock)));
      break;
    }
  }
}
const [fh, fm] = firstHud.split(':').map(Number), first = fh * 60 + fm - FROM, fps = rows.length / 3;
const ok = Math.abs(first) <= 1 && lag <= 1 && errors.length === 0;
console.log(`day-night clock: first frame ${first >= 0 ? '+' : ''}${first} min from ?from=, exposure lag max ${lag.toFixed(2)} clock min, ` +
  `${fps.toFixed(0)} fps, errors ${errors.length} -> ${ok ? 'ok' : 'FAIL'}`);
process.exit(ok ? 0 : 1);

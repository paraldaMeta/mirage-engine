#!/usr/bin/env node
// Headless stills of the probe from its dev server (npm run dev, port 5291), through the page's own still():
//   node tools/snap.mjs [--query "off=light2"] [--w 1280 --h 720] [--spp 8] [--out out/snap]
//        [--view name[@HH:MM]]...        the plan's viewpoints (default: every one at 17:00)
//        [--cam "x,y,z" --look "x,y,z" --focal 24 --time 17:00 --name shot]   one explicit camera
// Writes <out>/<name>-<time>.png and prints the page's info and each still's render time.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const all = (k) => args.flatMap((a, i) => (a === '--' + k ? [args[i + 1]] : []));
const W = +flag('w', 1280), H = +flag('h', 720), SPP = +flag('spp', 8), OUT = path.resolve(flag('out', 'out/snap')), PORT = process.env.VITE_PORT || 5291;
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch({ w: W, h: H });
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { const s = m.text(); if (m.type() === 'error' || /^\[(info|world|fort|lamps|ground)\]/.test(s) || /failed|THREE\.WebGLProgram/.test(s)) { console.log(`[page:${m.type()}] ${s.slice(0, 3000)}`); if (m.type() === 'error') errors.push(s); } });
  page.on('pageerror', (e) => { console.log('[page:error] ' + e.message); errors.push(e.message); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?mode=orbit&ui=0&w=${W}&h=${H}&spp=${SPP}` + (flag('query') ? '&' + flag('query') : ''), { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction('window.__READY === true', { timeout: 600000, polling: 300 });
  console.log(`[snap] ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const plan = await page.evaluate(() => window.__mirage.plan.viewpoints);
  let shots = all('view').map((s) => { const [name, time] = s.split('@'); const v = plan.find((p) => p.name === name); if (!v) throw new Error('no viewpoint ' + name); return { ...v, time: time || '17:00' }; });
  if (flag('cam')) shots.push({ name: flag('name', 'shot'), eye: flag('cam').split(',').map(Number), look: flag('look', '0,0,0').split(',').map(Number), focal: +flag('focal', 35), time: flag('time', '17:00') });
  if (!shots.length) shots = plan.map((v) => ({ ...v, time: '17:00' }));
  for (const v of shots) {
    const r = await page.evaluate((view) => window.__mirage.still(view), { ...v, spp: SPP });
    const file = path.join(OUT, `${v.name}-${v.time.replace(':', '')}.png`);
    fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(`[snap] ${path.relative(process.cwd(), file)}  ${r.ms} ms, ${r.calls} calls`);
  }
  failed = errors.length > 0;
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);

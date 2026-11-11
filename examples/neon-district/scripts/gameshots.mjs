#!/usr/bin/env node
// Frames of the running game for a contact sheet: the HUD, the view model, sentinels, tracers and effects as a
// player sees them (mirage-snap draws the plan's viewpoints as clean stills; this is the other half).
//   node scripts/gameshots.mjs [dist] [--out out/shots] [--quality high] [--w 1600 --h 900]
// Writes <out>/NN-name.png and <out>/sheet.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/shots'))), W = +flag('w', 1600), H = +flag('h', 900), quality = flag('quality', 'high');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// eye, look; keys held for `hold` ms before the frame; `js` runs in the page first
const SHOTS = [
  { name: 'the alley', eye: [-22, 1.62, 29.5], look: [-22, 2.2, 10] },
  { name: 'first contact', eye: [-22.6, 1.62, 22.5], look: 'g0', keys: ['KeyF'], hold: 260 },
  { name: 'Kestrel Street', eye: [-29.5, 1.62, 6.4], look: [8, 3.2, 5] },
  { name: 'down the sight', eye: [-13, 1.62, 6.2], look: 'g2', keys: ['KeyQ', 'KeyF'], hold: 420 },
  { name: 'the noodle bar', eye: [-13.2, 1.76, 9.3], look: [-16.4, 2.1, 2] },
  { name: 'inside the bar', eye: [-11.4, 1.78, 0.6], look: [-19, 1.3, -6.5] },
  { name: 'the plaza', eye: [10.2, 1.76, 0.9], look: [19, 3.6, -11] },
  { name: 'the hologram', eye: [23.6, 1.76, -3.6], look: [17.6, 3.8, -9.5], keys: ['KeyF'], hold: 200 },
  { name: 'the relay', eye: [8.4, 1.78, -22.6], look: [19, 1.5, -27], js: "window.__mirage.game.enemies.wake('relay')" },
  { name: 'the stairwell', eye: [24.5, 1.78, -21.9], look: [24.6, 2.6, -27] },
  { name: 'the roof', eye: [20.6, 7.62, -21.6], look: [9, 6.9, -26.5] },
  { name: 'over the plaza', eye: [9, 7.62, -21.3], look: [20, 2.5, 5] },
];
const srv = await serve(dist), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&hud=0&quality=${quality}`);
await sleep(2500);
const files = [];
for (const [i, s] of SHOTS.entries()) {
  if (s.js) await page.evaluate(s.js);
  await page.evaluate((s) => { const m = window.__mirage, look = typeof s.look === 'string' ? m.g.game.where(m.g.game.entities.get(s.look)) : s.look; m.play.place(s.eye, look, 'walk'); }, s);
  await sleep(1600);   // the temporal passes settle, the emitters start again after the jump
  if (typeof s.look === 'string') await page.evaluate((id) => { const m = window.__mirage, e = m.g.game.entities.get(id); if (e) m.play.lookAt(m.g.game.where(e)); }, s.look);
  for (const k of s.keys || []) await page.keyboard.down(k);
  await sleep(s.hold || 0);
  const file = `${String(i + 1).padStart(2, '0')}-${s.name.replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  for (const k of s.keys || []) await page.keyboard.up(k);
  files.push({ file, name: s.name });
  console.log(file);
}
// the sheet: thumbnails with labels, drawn in a page's 2D canvas
const sheet = await b.newPage(), cols = 4, tw = 640, th = Math.round(tw * H / W), pad = 10, lab = 26, rows = Math.ceil(files.length / cols);
await sheet.setViewport({ width: cols * (tw + pad) + pad, height: rows * (th + lab + pad) + pad });
await sheet.setContent(`<body style="margin:0;background:#0d0f12"><canvas id=c width=${cols * (tw + pad) + pad} height=${rows * (th + lab + pad) + pad}></canvas></body>`);
for (const [i, f] of files.entries()) {
  const data = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f.file)).toString('base64');
  await sheet.evaluate(async (data, i, name, cols, tw, th, pad, lab) => {
    const img = new Image(); img.src = data; await img.decode();
    const g = document.getElementById('c').getContext('2d'), x = pad + (i % cols) * (tw + pad), y = pad + Math.floor(i / cols) * (th + lab + pad);
    g.drawImage(img, x, y, tw, th); g.fillStyle = '#cfd8e3'; g.font = '14px ui-monospace, Menlo, monospace'; g.fillText(`${i + 1}  ${name}`, x + 2, y + th + 18);
  }, data, i, f.name, cols, tw, th, pad, lab);
}
await sheet.screenshot({ path: path.join(OUT, 'sheet.png') });
await b.close(); srv.close?.();
for (const e of errors) console.log('ERR ' + e);
console.log(`${files.length} frames, sheet ${path.join(OUT, 'sheet.png')}, console errors ${errors.length}`);

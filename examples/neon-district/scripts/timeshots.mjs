#!/usr/bin/env node
// The same cameras at day, dusk and night, for before / after comparisons: frames of the running game with the
// HUD hidden.   node scripts/timeshots.mjs [dist] --out out/before [--quality high] [--times day,dusk,night]
// Writes <out>/<camera>-<time>.png and <out>/sheet.png (one row per camera, one column per time).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/times'))), W = 1600, H = 900, quality = flag('quality', 'high'), TIMES = flag('times', 'day,dusk,night').split(',');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAMS = [
  { name: 'street-up', eye: [-7, 1.62, 6.2], look: [12, 13, 3.5] },
  { name: 'skyline', eye: [21.5, 7.62, -21.6], look: [-24, 24, 22] },
  { name: 'shopfront', eye: [-14.2, 1.76, 8.6], look: [-16.6, 2.3, 2] },
  { name: 'street', eye: [-29.5, 1.62, 6.4], look: [8, 3.2, 5] },
  { name: 'plaza', eye: [10.2, 1.76, 0.9], look: [19, 3.6, -11] },
  { name: 'robot', look: 'g2' },
  { name: 'alley', eye: [-22, 1.62, 29.5], look: [-22, 4.5, 10] },
];
const srv = await serve(dist), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const files = [];
for (const time of TIMES) {
  const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&hud=0&lang=en&quality=${quality}&time=${time}`);
  await page.addStyleTag({ content: '.nd, .mg-ui { display: none !important; }' });
  await page.evaluate(() => { window.__mirage.game.weapon.holder.visible = false; });
  await sleep(2500);
  for (const c of CAMS) {
    // a camera that looks at an entity stands 2.6 m from wherever it is now
    await page.evaluate((c) => { const m = window.__mirage; if (typeof c.look === 'string') { const p = m.g.game.where(m.g.game.entities.get(c.look)); m.play.place([p[0] - 1.9, p[1] + 0.25, p[2] + 1.8], p, 'walk'); } else m.play.place(c.eye, c.look, 'walk'); }, c);
    await sleep(typeof c.look === 'string' ? 500 : 1800);
    if (typeof c.look === 'string') { await page.evaluate((id) => { const m = window.__mirage; m.play.lookAt(m.g.game.where(m.g.game.entities.get(id))); }, c.look); await sleep(250); }
    const file = `${c.name}-${time}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    files.push({ file, cam: c.name, time });
  }
  for (const e of errors) console.log('ERR ' + e);
  await page.close();
}
const sheet = await b.newPage(), tw = 560, th = Math.round(tw * H / W), pad = 8, lab = 22;
const cw = TIMES.length * (tw + pad) + pad, ch = CAMS.length * (th + lab + pad) + pad;
await sheet.setViewport({ width: cw, height: ch });
await sheet.setContent(`<body style="margin:0;background:#0d0f12"><canvas id=c width=${cw} height=${ch}></canvas></body>`);
for (const f of files) {
  const data = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f.file)).toString('base64');
  await sheet.evaluate(async (data, col, row, name, tw, th, pad, lab) => {
    const img = new Image(); img.src = data; await img.decode();
    const g = document.getElementById('c').getContext('2d'), x = pad + col * (tw + pad), y = pad + row * (th + lab + pad);
    g.drawImage(img, x, y, tw, th); g.fillStyle = '#cfd8e3'; g.font = '13px ui-monospace, Menlo, monospace'; g.fillText(name, x + 2, y + th + 16);
  }, data, TIMES.indexOf(f.time), CAMS.findIndex((c) => c.name === f.cam), `${f.cam} · ${f.time}`, tw, th, pad, lab);
}
await sheet.screenshot({ path: path.join(OUT, 'sheet.png') });
await b.close(); srv.close?.();
console.log(`${files.length} frames, sheet ${path.join(OUT, 'sheet.png')}`);

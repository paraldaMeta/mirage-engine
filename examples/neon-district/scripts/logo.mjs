#!/usr/bin/env node
// The logo files from game/logo.js: public/logo.svg (the lockup), public/icon.svg (the mark on its tile), the PNG icons
// (192, 512, 512 maskable, 180 apple-touch, 32 favicon) drawn by headless Chrome from the SVGs, the loading card's
// inline mark in index.html (between <!--logo--> and <!--/logo-->), and a look sheet: out/logo/sheet.png (the icon at
// 16, 32, 64 and 192 px on dark and light, the small ones also blown up 4x, the maskable one with its safe circle).
// usage: node scripts/logo.mjs [--no-png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mark, lockup } from '../game/logo.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public'), out = path.join(root, 'out/logo');
fs.mkdirSync(pub, { recursive: true }); fs.mkdirSync(out, { recursive: true });
const svg = { icon: mark(), logo: lockup(), full: mark({ full: true }), apple: mark({ full: true, scale: 1.04 }) };
fs.writeFileSync(path.join(pub, 'icon.svg'), svg.icon + '\n');
fs.writeFileSync(path.join(pub, 'logo.svg'), svg.logo + '\n');

const html = path.join(root, 'index.html');
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<!--logo-->[\s\S]*?<!--\/logo-->/, () => `<!--logo-->${mark({ id: 'ndb', tile: false })}<!--/logo-->`));
console.log('[logo] public/icon.svg, public/logo.svg, index.html');
if (process.argv.includes('--no-png')) process.exit(0);

const { launch } = await import('../../../packages/tools/src/chrome.mjs');
const browser = await launch({ w: 1200, h: 900 });
try {
  const page = await browser.newPage();
  const uri = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
  /** an SVG drawn at n x n px, transparent around it */
  async function png(s, n, file) {
    await page.setViewport({ width: n, height: n, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${uri(s)}" width="${n}" height="${n}">`);
    await page.waitForFunction(() => document.images[0].complete);
    const b = await page.screenshot({ omitBackground: true, type: 'png' });
    if (file) fs.writeFileSync(path.join(pub, file), b);
    return 'data:image/png;base64,' + Buffer.from(b).toString('base64');
  }
  const P = {};
  P[192] = await png(svg.icon, 192, 'icon-192.png');
  P[512] = await png(svg.icon, 512, 'icon-512.png');
  P.mask = await png(svg.full, 512, 'icon-maskable-512.png');
  P.apple = await png(svg.apple, 180, 'apple-touch-icon.png');
  P[32] = await png(svg.icon, 32, 'favicon.png');
  P[16] = await png(svg.icon, 16);
  P[64] = await png(svg.icon, 64);
  const cell = (bg, fg) => `<div class="row" style="background:${bg};color:${fg}">${[16, 32, 64, 192].map((n) => `<figure><img src="${P[n]}" width="${n}"><figcaption>${n}</figcaption></figure>`).join('')}`
    + `<figure><img class="px" src="${P[16]}" width="64"><figcaption>16 ×4</figcaption></figure><figure><img class="px" src="${P[32]}" width="128"><figcaption>32 ×4</figcaption></figure></div>`;
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
  await page.setContent(`<style>body{margin:0;font:12px ui-monospace,monospace;background:#222}.row{display:flex;align-items:flex-end;gap:28px;padding:20px 24px}
    figure{margin:0;text-align:center}figcaption{opacity:.6;margin-top:6px}.px{image-rendering:pixelated}.mask{position:relative;width:256px;height:256px}
    .mask img{width:256px;height:256px;border-radius:50%}.mask i{position:absolute;inset:25.6px;border:1px dashed #fff8;border-radius:50%}</style>
    ${cell('#05070d', '#cfe')}${cell('#f4f4f2', '#333')}
    <div class="row" style="background:#05070d;color:#cfe;align-items:center"><img src="${uri(svg.logo)}" width="680">
    <figure><div class="mask"><img src="${P.mask}"><i></i></div><figcaption>maskable (circle crop, safe zone dashed)</figcaption></figure>
    <figure><img src="${P.apple}" width="90" style="border-radius:20px"><figcaption>apple 180</figcaption></figure></div>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: 1200, height: h, deviceScaleFactor: 1 });
  fs.writeFileSync(path.join(out, 'sheet.png'), await page.screenshot({ type: 'png' }));
  console.log('[logo] PNG icons in public/, sheet out/logo/sheet.png');
} finally { await browser.close(); }

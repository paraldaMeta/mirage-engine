#!/usr/bin/env node
// The poster in index.html (between <!--poster--> and <!--/poster-->): the title's first shot as the game draws it
// at the first visit's hour (the golden hour), quality low (a phone's), a WebP of at most 45 KB inlined as a data URI, so the first paint shows the district
// before any code has loaded. Also out/poster.webp. Build first (npm run build).
//   node scripts/poster.mjs [dist]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] || path.join(root, 'dist')), MAX = 45000, W = 1280, H = 720;
const srv = await serve(dist), b = await launch({ w: W, h: H });
try {
  const page = await b.newPage();
  await page.goto(`${srv.url}?quality=low&grain=0&lang=en&intro=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__READY === true && !document.getElementById("boot")', { timeout: 300000, polling: 100 });
  await new Promise((r) => setTimeout(r, 3000));   // (the exposure adapted: what a player sees a second in)
  const uri = await page.evaluate(async (MAX) => {
    const src = document.querySelector('canvas'), c = document.createElement('canvas');
    c.width = 960; c.height = 540;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    for (let q = 0.8; ; q -= 0.05) { const u = c.toDataURL('image/webp', q); if (u.length * 0.75 <= MAX || q < 0.3) return u; }
  }, MAX);
  const bytes = Buffer.from(uri.split(',')[1], 'base64');
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'out/poster.webp'), bytes);
  const html = path.join(root, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<!--poster-->[\s\S]*?<!--\/poster-->/, () => `<!--poster--><style>#boot { background-image: url(${uri}) }</style><!--/poster-->`));
  console.log(`[poster] ${bytes.length} bytes -> index.html, out/poster.webp`);
} finally { await b.close(); srv.close(); }

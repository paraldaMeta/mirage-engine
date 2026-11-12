// clarity-check: a phone-sized page (touch, devicePixelRatio 2.5) at each clarity: the canvas's backing size, the
// sharpening, the options button's label, and a crop of each to compare. Usage: node scripts/clarity-check.mjs [dist]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist')), out = path.join(here, '../out/clarity');
fs.mkdirSync(out, { recursive: true });
const srv = await serve(dist), browser = await launch({ w: 900, h: 560 });
const W = 900, H = 560, DPR = 2.5, want = { standard: 1, sharp: 1.5, max: 2 };
let failed = 0;
for (const c of ['', 'standard', 'sharp', 'max']) {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, isLandscape: true });
  if (c) await page.evaluateOnNewDocument((c) => localStorage.setItem('nd.clarity', c), c);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.url}?grain=0&quality=low&start=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await new Promise((r) => setTimeout(r, 1500));
  const r = await page.evaluate(() => { const cv = document.querySelector('canvas'); return { w: cv.width, css: cv.clientWidth, clarity: document.documentElement.dataset.clarity, rcas: window.__mirage.world.post?.rcas ?? null }; });
  const name = c || 'default', got = r.w / r.css, exp = want[r.clarity];
  const ok = !errors.length && Math.abs(got - exp) < 0.02 && (c ? r.clarity === c : r.clarity === 'sharp');
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: clarity ${r.clarity}, canvas ${r.w} for ${r.css} css px (${got.toFixed(2)}x, want ${exp}x), rcas ${r.rcas}${errors.length ? ' errors: ' + errors.join('; ') : ''}`);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 250, y: 120, width: 400, height: 280 } });
  await page.close();
}
await browser.close(); srv.close();
console.log(failed ? `clarity-check: ${failed} failed` : 'clarity-check: ok');
process.exit(failed ? 1 : 0);

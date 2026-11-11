#!/usr/bin/env node
// Screens of the game in its three languages, for a person to look at (overflow, missing glyphs, bad line breaks):
// the title, the HUD in play, the options, the engine's pause menu, an end card, the opening seconds (the cold open,
// then the radio), and the touch HUD on phones and tablets.
//   node scripts/i18nshots.mjs [dist] [--out out/i18n] [--langs zh,en,ja] [--only desktop,phone,tablet]
// Writes <out>/<lang>-<screen>-<w>x<h>.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/i18n'))), LANGS = flag('langs', 'zh,en,ja').split(','), ONLY = flag('only', 'desktop,phone,tablet').split(',');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist);
const b = await launch({ w: 1440, h: 900, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let n = 0;
async function page(query, { w, h, touch = false }) {
  const p = await b.newPage();
  if (touch) await p.emulate({ viewport: { width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: w > h }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  else await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${srv.url}?grain=0&assist=1&quality=low&fullscreen=0&${query}`, { waitUntil: 'load', timeout: 180000 });
  await p.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(800);
  return p;
}
// a step that does not come back in 45 s is skipped (a busy machine's GPU can stall a frame; the run goes on)
const within = (pr, what) => { let done = false, timer; return Promise.race([Promise.resolve(pr).catch((e) => { errors.push(`${what}: ${e.message}`); }).finally(() => { done = true; clearTimeout(timer); }), new Promise((r) => { timer = setTimeout(() => { if (!done) errors.push(`timed out: ${what}`); r(); }, 45000); })]); };
const shot = async (p, name) => within((async () => { const { w, h } = await within(p.evaluate(() => ({ w: innerWidth, h: innerHeight })), 'evaluate'); const f = path.join(OUT, `${name}-${w}x${h}.png`); await p.screenshot({ path: f }); n++; console.log(path.relative(process.cwd(), f)); })(), name);
const street = (p) => within(p.evaluate(() => { const m = window.__mirage; m.play.place([-13, 1.62, 6.2], [8, 2.6, 5], 'walk'); }), 'street');
const endCard = (p) => within(p.evaluate(() => { const m = window.__mirage, T = m.game.text; m.g.ui.message(T.doneTitle, T.doneBody({ diff: T.front.diffs.hard, rating: T.ratings[2], min: 6, sec: 41, kills: 37, acc: 44, shots: 412, heads: 9, deaths: 1 }), T.doneBtn); }), 'end card');
const busy = (p) => within(p.evaluate(() => { const m = window.__mirage; m.game.hud.radio(m.game.text.xt.radio.teach); m.g.ui.toast(`${m.game.text.ammo} · ${m.game.text.arms.short.carbine} +48`); m.g.ui.objective(...m.game.text.obj.pass); }), 'busy');

for (const lang of LANGS) {
  if (ONLY.includes('desktop')) {
    const W = 1440, H = 900;
    let p = await page(`lang=${lang}`, { w: W, h: H });
    await sleep(1200); await shot(p, `${lang}-title`);
    await p.keyboard.press('KeyO'); await sleep(300); await shot(p, `${lang}-title-options`); await p.keyboard.press('KeyO');
    await within(p.close(), "close");
    p = await page(`lang=${lang}&start=1`, { w: W, h: H });
    await sleep(1500); await shot(p, `${lang}-opening-1s`);
    await sleep(9500); await shot(p, `${lang}-opening-11s`);
    await street(p); await busy(p); await sleep(900); await shot(p, `${lang}-hud`);
    await p.keyboard.press('KeyO'); await sleep(300); await shot(p, `${lang}-options`); await p.keyboard.press('KeyO'); await sleep(200);
    await within(p.evaluate(() => window.__mirage.g.ui.openMenu()), 'evaluate'); await sleep(300); await shot(p, `${lang}-pause`);
    await within(p.evaluate(() => window.__mirage.g.ui.openMenu('sound')), 'evaluate'); await sleep(200); await shot(p, `${lang}-pause-sound`);
    await within(p.evaluate(() => window.__mirage.g.ui.openMenu('controls')), 'evaluate'); await sleep(200); await shot(p, `${lang}-pause-controls`);
    await within(p.evaluate(() => window.__mirage.g.ui.openMenu('save')), 'evaluate'); await sleep(200); await shot(p, `${lang}-pause-save`);
    await within(p.evaluate(() => document.querySelector('.mg-menu').close()), 'evaluate'); await sleep(200);
    await endCard(p); await sleep(400); await shot(p, `${lang}-endcard`);
    await within(p.close(), "close");
  }
  const touchSizes = [...(ONLY.includes('phone') ? [[844, 390], [667, 375]] : []), ...(ONLY.includes('tablet') ? [[1024, 768], [1180, 820], [1366, 1024], [820, 1180]] : [])];
  for (const [w, h] of touchSizes) {
    let p = await page(`lang=${lang}`, { w, h, touch: true });
    await sleep(800); await shot(p, `${lang}-touch-title`);
    await within(p.close(), "close");
    p = await page(`lang=${lang}&start=1`, { w, h, touch: true });
    await p.touchscreen.tap(Math.round(w * 0.6), Math.round(h * 0.3)); await sleep(1500);
    await shot(p, `${lang}-touch-opening`);
    await within(p.evaluate(() => { const m = window.__mirage; m.game.kit.overlay.card([], 0); }), 'evaluate');
    await street(p); await sleep(300); await busy(p); await sleep(900); await shot(p, `${lang}-touch-hud`);
    if (w === 844 || w === 1180) {
      await within(p.evaluate(() => window.__mirage.game.toggleOptions()), 'evaluate'); await sleep(300); await shot(p, `${lang}-touch-options`);
      await within(p.evaluate(() => window.__mirage.game.toggleOptions()), 'evaluate'); await sleep(200);
      await within(p.evaluate(() => window.__mirage.g.ui.openMenu()), 'evaluate'); await sleep(300); await shot(p, `${lang}-touch-pause`);
      await within(p.evaluate(() => document.querySelector('.mg-menu').close()), 'evaluate'); await sleep(200);
      await endCard(p); await sleep(400); await shot(p, `${lang}-touch-endcard`);
    }
    await within(p.close(), "close");
  }
}
await b.close(); srv.close?.();
for (const e of errors) console.log('ERR ' + e);
console.log(`${n} screens in ${OUT}, console errors ${errors.length}`);
process.exit(errors.length ? 1 : 0);

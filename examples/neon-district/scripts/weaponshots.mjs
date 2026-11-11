#!/usr/bin/env node
// Frames of the arsenal (out/weapons): every gun's view model at the hip and down the sight, at night and at dusk; the
// rocket in flight and its burst; the gatling firing; the touch HUD with the kit's buttons and the gun strip in English
// and Traditional Chinese. Driven with real keys (1-5, 0, Q held, F held); the page's API places the view.
//   node scripts/weaponshots.mjs [dist] [--out out/weapons] [--quality medium]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/weapons'))), W = 1280, H = 720, quality = flag('quality', 'medium');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean), want = (p) => !ONLY.length || ONLY.includes(p);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist);
const errs = [];
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log(name + '.png'); };
const place = (page, eye, look) => page.evaluate((eye, look) => window.__mirage.play.place(eye, look, 'walk'), eye, look);
const state = (page) => page.evaluate(() => { const m = window.__mirage, w = m.game.weapon; return { id: w.id, mag: w.S.mag, reserve: w.S.reserve, spin: +w.S.spin.toFixed(2), heat: +w.S.heat.toFixed(2), flags: { ...m.g.game.flags }, pending: m.game.sfx.pending }; });

if (want('desk')) {
  const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&quality=${quality}&lang=en&time=night`);
  await sleep(2500);
  await page.mouse.click(640, 360); await sleep(300);   // a gesture: the mixer, and the sounds being made
  await page.keyboard.press('Digit0'); await sleep(400);
  const GUNS = ['sidearm', 'carbine', 'shotgun', 'rocket', 'gatling'];
  for (const hour of ['night', 'dusk']) {
    await page.evaluate((h) => window.__mirage.setHour(h), hour); await sleep(hour === 'night' ? 300 : 2600);
    await place(page, [-21.2, 1.62, 22], [-22.5, 1.5, 12]);   // the alley, a lit wall to the side
    for (const [i, id] of GUNS.entries()) {
      await page.keyboard.press('Digit' + (i + 1)); await sleep(900);
      await shot(page, `${id}-${hour}-hip`);
      await page.keyboard.down('KeyQ'); await sleep(600);
      await shot(page, `${id}-${hour}-aim`);
      await page.keyboard.up('KeyQ'); await sleep(300);
    }
  }
  console.log(JSON.stringify(await state(page)));
  // the rocket in flight down the street, then its burst on the far wall
  await page.evaluate(() => window.__mirage.setHour('night')); await sleep(400);
  await place(page, [-29.5, 1.62, 6.4], [8, 2.2, 6.4]);
  await page.keyboard.press('Digit4'); await sleep(900);
  await page.keyboard.down('KeyF'); await sleep(60); await page.keyboard.up('KeyF');
  await sleep(240); await shot(page, 'rocket-in-flight');
  await sleep(160); await shot(page, 'rocket-in-flight-2');
  await place(page, [-24, 1.62, 6.4], [-12, 1.2, 1.5]);
  await page.keyboard.press('KeyR'); await sleep(3000);
  await page.keyboard.down('KeyF'); await sleep(60); await page.keyboard.up('KeyF');
  await sleep(430); await shot(page, 'rocket-explosion');
  await sleep(250); await shot(page, 'rocket-explosion-smoke');
  // the gatling: spun up and firing down the street
  await place(page, [-29.5, 1.62, 6.4], [8, 1.6, 7]);
  await page.keyboard.press('Digit5'); await sleep(900);
  await page.keyboard.down('KeyF'); await sleep(1500); await shot(page, 'gatling-firing'); await sleep(400); await shot(page, 'gatling-firing-2');
  await sleep(2600); await shot(page, 'gatling-hot'); await page.keyboard.up('KeyF');
  console.log(JSON.stringify(await state(page)));
  errs.push(...errors);
  await b.close();
}
if (want('touch')) for (const lang of ['en', 'zh']) {
  const b = await launch({ w: 844, h: 390, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await b.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.emulate({ viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  await page.goto(`${srv.url}?start=1&assist=1&grain=0&quality=low&lang=${lang}&time=night`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(1500);
  await page.touchscreen.tap(520, 120); await sleep(800);
  await page.evaluate(() => { const m = window.__mirage; m.game.weapon.unlock(true); m.play.place([-14.5, 1.62, 8.4], [-17, 4.0, 7.85], 'walk'); });
  await sleep(600);
  // hold HACK on a street lamp: the ring fills
  const hack = await page.evaluate(() => { const r = document.querySelector('.ndt [data-b=hack]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: hack[0], y: hack[1] }] }); await sleep(450);
  await shot(page, `touch-hud-${lang}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  await page.evaluate(() => { const m = window.__mirage; m.game.kit.abilities.use('dash'); m.game.kit.abilities.use('grenade'); m.game.weapon.select('gatling'); });
  await sleep(1200); await shot(page, `touch-hud-${lang}-cooldowns`);
  errs.push(...errors);
  await b.close();
}
srv.close?.();
console.log(errs.length ? 'errors:\n' + errs.join('\n') : 'no console errors');

#!/usr/bin/env node
// Stills of the weather (one browser, one view after another): the water channel by day (close, 4 m, backlit down the
// street), at dusk and by night; a lightning strike by night (before / during, the wet ground's glint); the storm sky;
// the steam plumes by day and night. The district alone (?world=1), the camera placed, the flash driven by hand.
//   node scripts/weather.mjs [dist] [out dir (out/weather)] [only: comma-separated names]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist')), out = path.resolve(process.argv[3] || path.join(here, '../out/weather'));
const only = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(out, { recursive: true });
const W = 1280, H = 720, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = [
  { name: 'channel-day-1m', time: 'day', eye: [11.4, 1.2, 7.05], look: [12.3, -0.22, 8.1] },
  { name: 'channel-day-4m', time: 'day', eye: [15.6, 1.65, 6.4], look: [12, -0.2, 8.1] },
  { name: 'channel-day-backlit', time: 'day', eye: [19.2, 1.65, 8.0], look: [2, -0.2, 8.1] },
  { name: 'channel-day-inflow', time: 'day', eye: [16.2, 1.2, 9.0], look: [17.3, -0.2, 8.1] },
  { name: 'channel-dusk-4m', time: 'dusk', eye: [15.6, 1.65, 6.4], look: [12, -0.2, 8.1] },
  { name: 'channel-night-4m', time: 'night', eye: [15.6, 1.65, 6.4], look: [12, -0.2, 8.1] },
  { name: 'channel-night-backlit', time: 'night', eye: [19.2, 1.65, 8.0], look: [2, -0.2, 8.1] },
  { name: 'lightning-before', time: 'night', eye: [-6, 1.7, 6.2], look: [14, 2.5, 5.5] },
  { name: 'lightning-during', time: 'night', eye: [-6, 1.7, 6.2], look: [14, 2.5, 5.5], flash: 1 },
  { name: 'lightning-ground', time: 'night', eye: [0, 1.7, 5], look: [12, -0.5, 6.5], flash: 1 },
  { name: 'storm-sky', time: 'night', eye: [0, 1.7, 6], look: [30, 40, 4] },
  { name: 'storm-sky-flash', time: 'night', eye: [0, 1.7, 6], look: [30, 40, 4], flash: 1 },
  { name: 'steam-day', time: 'day', eye: [-3, 1.7, 7], look: [-9, 1.0, 9.2] },
  { name: 'steam-night', time: 'night', eye: [-17.5, 1.7, 9.5], look: [-20.8, 1.2, 14.5] },
  { name: 'steam-night-street', time: 'night', eye: [-3, 1.7, 7], look: [-9, 1.0, 9.2] },
].filter((s) => !only || only.includes(s.name));

const srv = await serve(dist), b = await launch({ w: W, h: H });
const times = [...new Set(SHOTS.map((s) => s.time))];
for (const time of times) {
  const page = await b.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: W, height: H });
  await page.goto(`${srv.url}?world=1&mode=fly&ui=0&hud=0&grain=0&quality=high&w=${W}&h=${H}&time=${time}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 200 });
  await sleep(4000);
  for (const s of SHOTS.filter((x) => x.time === time)) {
    await page.evaluate((s) => {
      const m = window.__mirage, f = m.world.flash;
      m.play.place(s.eye, s.look, 'fly');
      if (f) {
        if (s.flash) { const c = s.eye; f.strike([c[0] + 140, 330, c[2] - 260], [c[0] + 120, 25, c[2] - 230], 7, c); f.set(s.flash, [0.4, 0.6, -0.7]); } else f.set(0);
      }
    }, s);
    await sleep(s.flash ? 2500 : 3500);
    await page.screenshot({ path: path.join(out, s.name + '.png') });
    console.log(s.name, errors.length ? 'ERR ' + errors.slice(0, 2).join(' | ') : 'ok');
  }
  await page.close();
}
await b.close(); srv.close?.();

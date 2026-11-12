#!/usr/bin/env node
// A close look at a flicker hotspot: the district (?world=1, rain off) at one camera, `frames` stepped moving frames
// (60 Hz, temporal AA), and per pixel at full resolution the temporal sd of luma; writes the sd map (white = 16
// levels) and the last frame of a crop side by side, and prints the crop's mean sd and its 99th percentile.
//   node scripts/flickerzoom.mjs [dist] --eye x,y,z --look x,y,z --crop x0,y0,x1,y1 (0..1 of the frame) [--q high]
//        [--time day] [--frames 32] [--out out/nizwa-light/zoom/name.png] [--query k=v&..]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const nums = (s) => s.split(',').map(Number);
const W = 1440, H = 900, eye = nums(flag('eye')), look = nums(flag('look')), crop = nums(flag('crop', '0,0,1,1'));
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const { page, errors } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&world=1&ui=0&quality=${flag('q', 'high')}&rain=0&time=${flag('time', 'day')}${flag('query') ? '&' + flag('query') : ''}`);
const r = await page.evaluate((eye, look, crop, F) => {
  const { play, world } = window.__mirage; play.stop();
  for (let i = 0; i < 300 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
  play.place(eye, look, 'walk');
  for (let i = 0; i < 40; i++) { play.step(1 / 60); play.render({ moving: true }); }
  const gl = world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  const x0 = Math.floor(crop[0] * w), x1 = Math.floor(crop[2] * w), y0 = Math.floor(crop[1] * h), y1 = Math.floor(crop[3] * h), cw = x1 - x0, ch = y1 - y0;
  const s1 = new Float64Array(cw * ch), s2 = new Float64Array(cw * ch);
  for (let f = 0; f < F; f++) {
    play.step(1 / 60); play.render({ moving: true });
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const j = ((h - 1 - (y0 + y)) * w + x0 + x) * 4, l = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2], i = y * cw + x; s1[i] += l; s2[i] += l * l; }
  }
  const c = document.createElement('canvas'); c.width = cw * 2; c.height = ch; const g = c.getContext('2d'), im = g.createImageData(cw * 2, ch);
  const sds = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x, m = s1[i] / F, sd = Math.sqrt(Math.max(0, s2[i] / F - m * m)); sds.push(sd);
    const o = (y * cw * 2 + x) * 4, o2 = o + cw * 4, j = ((h - 1 - (y0 + y)) * w + x0 + x) * 4, v = Math.min(255, sd * 16);
    im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255;
    im.data[o2] = px[j]; im.data[o2 + 1] = px[j + 1]; im.data[o2 + 2] = px[j + 2]; im.data[o2 + 3] = 255;
  }
  g.putImageData(im, 0, 0); sds.sort((a, b) => a - b);
  return { url: c.toDataURL('image/png'), mean: sds.reduce((a, b) => a + b, 0) / sds.length, p99: sds[Math.floor(sds.length * 0.99)] };
}, eye, look, crop, +flag('frames', 32));
const out = flag('out', path.join(here, '../out/nizwa-light/zoom/zoom.png'));
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(r.url.split(',')[1], 'base64'));
console.log(`${path.basename(out)}: crop sd mean ${r.mean.toFixed(3)}, p99 ${r.p99.toFixed(2)} (0..255)`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
await browser.close(); srv.close?.();
process.exit(0);

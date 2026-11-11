#!/usr/bin/env node
// Image stability of the far field: how much the upper half of the frame shimmers from one frame to the next.
//   node scripts/stability.mjs [dist] [--q medium] [--frames 48] [--out out/stability.json]
// At two vistas (the street looking up at the towers; the relay's roof over the plaza) the district is drawn (?world=1: no robots firing across the view) for `frames`
// moving (temporal AA) frames with the camera still, then again with a slow pan of 1 degree a second (rain off: its
// streaks would be the measurement). Still: the per-pixel temporal standard deviation of luma (0..255). Pan: the RMS
// of the per-pixel second difference in time, l(t) - (l(t-1) + l(t+1)) / 2, which a steady slide of the image (0.26
// px a frame) leaves near zero and a twinkle does not. Reported: the mean over the upper half (far: towers, skyline,
// signs high up), its 99th percentile, and the mean over the lower half (near).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const W = 960, H = 600, Q = flag('q', 'medium'), FRAMES = +flag('frames', 48);
const VISTAS = [
  { name: 'street, towers', eye: [0, 1.7, 8.5], look: [6, 42, -50] },
  { name: 'roof, plaza', eye: [9, 7.62, -21.3], look: [20, 2.5, 5] },
];
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const { page, errors } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&world=1&ui=0&quality=${Q}&rain=0${flag("query") ? "&" + flag("query") : ""}`);   // rain off: its streaks would be the measurement
const rows = [];
for (const v of VISTAS) for (const pan of [0, 1]) {
  const r = await page.evaluate((v, pan, FRAMES, MAP) => {
    const { play, world } = window.__mirage; play.stop();
    for (let i = 0; i < 300 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
    play.place(v.eye, v.look, 'walk');
    for (let i = 0; i < 40; i++) { play.step(1 / 60); play.render({ moving: true }); }   // the history fills
    const gl = world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    const s1 = new Float64Array(w * h), s2 = new Float64Array(w * h), s3 = new Float64Array(w * h), a = new Float32Array(w * h), b = new Float32Array(w * h);
    for (let f = 0; f < FRAMES; f++) {
      if (pan) play.turn(1, 0, (Math.PI / 180) / 60);   // 1 degree a second
      play.step(1 / 60); play.render({ moving: true });
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        const l = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]; s1[i] += l; s2[i] += l * l;
        if (f >= 2) { const d = a[i] - 0.5 * (b[i] + l); s3[i] += d * d; }   // the second difference: a steady pan cancels, a twinkle does not
        b[i] = a[i]; a[i] = l;
      }
    }
    const sd = pan ? (i) => Math.sqrt(s3[i] / (FRAMES - 2)) : (i) => Math.sqrt(Math.max(0, s2[i] / FRAMES - (s1[i] / FRAMES) ** 2));
    // GL rows run bottom-up: the upper half of the image is rows h/2 .. h
    const up = [], lowSum = [0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, d = sd(i); if (y >= h / 2) up.push(d); else { lowSum[0] += d; lowSum[1]++; } }
    up.sort((a, b) => a - b);
    let map = null;
    if (MAP) {   // --map: the metric as an image (white = 25 levels), with the last frame beside it
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w * 2, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, o = ((h - 1 - y) * w * 2 + x) * 4, v = Math.min(255, sd(i) * 10.2), o2 = o + w * 4, j = i * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; im.data[o2] = px[j]; im.data[o2 + 1] = px[j + 1]; im.data[o2 + 2] = px[j + 2]; im.data[o2 + 3] = 255; }
      g.putImageData(im, 0, 0); map = c.toDataURL('image/png');
    }
    return { map, far: up.reduce((a, b) => a + b, 0) / up.length, far99: up[Math.floor(up.length * 0.99)], near: lowSum[0] / lowSum[1] };
  }, v, pan, FRAMES, !!flag('map'));
  if (r.map) { const f = path.join(flag('map'), `${v.name.replace(/\W+/g, '-')}-${pan ? 'pan' : 'still'}.png`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(r.map.split(',')[1], 'base64')); }
  rows.push({ vista: v.name, camera: pan ? 'pan 1°/s' : 'still', far: +r.far.toFixed(3), far99: +r.far99.toFixed(2), near: +r.near.toFixed(3) });
}
await browser.close(); srv.close?.();
console.log(`neon-district image stability, ${Q}, ${W} x ${H}, ${FRAMES} frames: still: temporal sd of luma, pan: RMS second difference (0..255)\n`);
console.log('| vista | camera | far half, mean | far half, p99 | near half, mean |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.vista} | ${r.camera} | ${r.far} | ${r.far99} | ${r.near} |`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
const out = flag('out');
if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ q: Q, frames: FRAMES, rows }, null, 1)); }
process.exit(0);

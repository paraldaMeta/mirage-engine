#!/usr/bin/env node
// A tablet's view at low quality, pixel ratio 1: still frames of given views plus a shimmer measure. For each view the
// camera is placed, then moved 0.4 cm sideways per frame over `frames` frames (a slow walk past); per pixel the RMS of
// the second difference of luma in time (a smooth change cancels, a pixel that switches does not). Prints the share of
// pixels over 6 levels (the shimmer) and writes the last frame as a PNG (--crop x,y,w,h in the 1280 x 800 view).
//   node scripts/mobile-flicker.mjs [dist] --views "name:ex,ey,ez:lx,ly,lz;.." --out dir [--q low] [--frames 40] [--tag before]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const W = 1280, H = 800, Q = flag('q', 'low'), FRAMES = +flag('frames', 40), OUT = flag('out', 'out/mobile'), TAG = flag('tag', 'now');
const views = flag('views').split(';').map((v) => { const [n, e, l] = v.split(':'); return { n, eye: e.split(',').map(Number), look: l.split(',').map(Number) }; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.removeItem('mirage:neon-district:settings'));
await page.goto(`${srv.url}?hud=0&assist=1&quality=${Q}&start=1&lang=en&w=${W}&h=${H}&time=night`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
await sleep(1500);
fs.mkdirSync(OUT, { recursive: true });
for (const v of views) {
  const r = await page.evaluate(async (v, FRAMES) => {
    const m = window.__mirage; for (const e of m.game.enemies.list) m.game.enemies.park?.(e); for (const e of m.game.drones.list) m.game.drones.park?.(e);
    m.play.place(v.eye, v.look, 'walk'); m.game.weapon.holder.visible = false;
    await new Promise((res) => setTimeout(res, 800));
    const gl = m.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, N = w * h, px = new Uint8Array(N * 4);
    const s3 = new Float64Array(N), a = new Float32Array(N), b = new Float32Array(N), last = new Uint8Array(N * 4);
    const dx = v.look[0] - v.eye[0], dz = v.look[2] - v.eye[2], L = Math.hypot(dx, dz) || 1, rx = -dz / L, rz = dx / L;   // sideways, in the ground plane
    for (let f = 0; f < FRAMES; f++) {
      await new Promise((res) => requestAnimationFrame(res));
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0, j = 0; i < N; i++, j += 4) { const l = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]; if (f >= 2) { const d = a[i] - 0.5 * (b[i] + l); s3[i] += d * d; } b[i] = a[i]; a[i] = l; }
      last.set(px);
      const k = (f + 1) * 0.004;
      m.play.place([v.eye[0] + rx * k, v.eye[1], v.eye[2] + rz * k], [v.look[0] + rx * k, v.look[1], v.look[2] + rz * k], 'walk');
    }
    let over = 0; for (let i = 0; i < N; i++) if (Math.sqrt(s3[i] / (FRAMES - 2)) > 6) over++;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'), im = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) im.data.set(last.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
    ctx.putImageData(im, 0, 0);
    return { share: over / N, w, h, png: c.toDataURL('image/png') };
  }, v, FRAMES);
  fs.writeFileSync(path.join(OUT, `${TAG}-${v.n}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`${TAG} ${v.n}: ${r.w}x${r.h}, ${(r.share * 100).toFixed(3)} % of pixels shimmer > 6 levels`);
}
await browser.close(); srv.close?.();
process.exit(0);

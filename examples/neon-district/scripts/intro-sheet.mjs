#!/usr/bin/env node
// The map's introduction (game/intro.js) as stills: one per shot key, the flat and the opened frame side by side, the
// swap before and after, on one sheet; optionally a low-resolution frame sequence of the whole tour (and an mp4 when
// ffmpeg is on the PATH) and the frame time of the tour's frames.
//   node scripts/intro-sheet.mjs [dist] [--out out/intro] [--quality high] [--time night] [--w 1280 --h 720]
//        [--at 0.5,4.6]   (only these tour times, as t-<s>.png: for tuning)
//        [--video 12]     (a frame sequence at 12 fps, 640 x 360, in <out>/frames, and <out>/intro.mp4)
//        [--measure]      (moving frames timed across the tour: median and p95 ms, driven synchronously)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--measure')) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/intro'))), quality = flag('quality', 'high'), time = flag('time', 'night');
const W = +flag('w', 1280), H = +flag('h', 720);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = await serve(dist), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
async function start(w, h, extra = '') {
  const { page, errors } = await open(b, `${srv.url}?w=${w}&h=${h}&intro=1&grain=0&lang=en&quality=${quality}&time=${time}&fullscreen=0${extra}`);
  await page.waitForFunction(() => window.__mirage?.game?.title?.shown, { timeout: 60000 });
  await sleep(800);
  await page.keyboard.press('Enter');   // DEPLOY: the intro plays
  await page.waitForFunction(() => window.__mirage.game.intro.playing, { timeout: 10000 });
  await page.evaluate(() => { window.__mirage.game.intro.hold.on = true; });
  return { page, errors };
}
const shotAt = async (page, t, file, wait = 1400) => {
  await page.evaluate((t) => window.__mirage.game.intro.seek(t), t);
  await sleep(wait);
  await page.screenshot({ path: file });
};

const { page, errors } = await start(W, H);
const shots = await page.evaluate(() => window.__mirage.game.intro.shots);
const total = await page.evaluate(() => window.__mirage.game.intro.length);
console.log(`tour ${total.toFixed(1)} s: ` + shots.map((s) => `${s.area} ${s.start.toFixed(1)}+${s.len.toFixed(1)}`).join(', '));

if (flag('at')) {
  for (const t of flag('at').split(',').map(Number)) await shotAt(page, t, path.join(OUT, `t-${t.toFixed(2)}.png`));
} else if (args.includes('--measure')) {
  // the tour's frames timed: step + render + a 1-pixel readback (the GPU's work inside the timing), every 0.1 s
  const r = await page.evaluate(async (total) => {
    const m = window.__mirage, play = m.play, gl = m.world.renderer.getContext(), px = new Uint8Array(4), ms = [];
    play.stop();
    m.game.intro.hold.on = false;
    for (let t = 0; t < total - 0.2; t += 0.1) {
      m.game.intro.seek(t); m.game.intro.hold.on = true;
      const t0 = performance.now();
      play.step(1 / 60); play.render({ moving: true }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
    }
    const s = ms.slice(5).sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
  }, total);
  console.log(`${quality}: ${JSON.stringify(r)}`);
  fs.writeFileSync(path.join(OUT, `measure-${quality}.json`), JSON.stringify(r));
} else {
  // the sheet: per shot its flat and its open key (the street: twice, the swap's before and after)
  const rows = [];
  for (const s of shots) {
    if (s.area === 'street') {
      rows.push({ label: 'street · flat / open (the row)', ts: [s.start + 0.8, s.start + 5.0] });
      rows.push({ label: 'street · flat (the swap) / open (the diagonal)', ts: [s.start + 7.5, s.start + 10.6] });
    } else if (s.area === 'alley') rows.push({ label: 'alley · flat / down / the spawn view', ts: [s.start + 0.8, s.start + 4.2, s.start + s.len] });
    else rows.push({ label: `${s.area} · flat / open`, ts: [s.start + 0.8, s.start + s.len - 0.5] });
  }
  const files = [];
  for (const [ri, r] of rows.entries()) for (const [ci, t] of r.ts.entries()) { const f = path.join(OUT, `k${ri}-${ci}.png`); await shotAt(page, t, f); files.push({ f, ri, ci, t }); }
  const sheet = await b.newPage(), tw = 480, th = Math.round(tw * H / W), pad = 8, lab = 22, cols = 3;
  const cw = cols * (tw + pad) + pad, ch = rows.length * (th + lab + pad) + pad;
  await sheet.setViewport({ width: cw, height: ch });
  await sheet.setContent(`<body style="margin:0;background:#0d0f12"><canvas id=c width=${cw} height=${ch}></canvas></body>`);
  for (const x of files) {
    const data = 'data:image/png;base64,' + fs.readFileSync(x.f).toString('base64');
    await sheet.evaluate(async (data, col, row, name, tw, th, pad, lab) => {
      const img = new Image(); img.src = data; await img.decode();
      const g = document.getElementById('c').getContext('2d'), x = pad + col * (tw + pad), y = pad + row * (th + lab + pad);
      g.drawImage(img, x, y, tw, th); g.fillStyle = '#cfd8e3'; g.font = '12px ui-monospace, Menlo, monospace'; g.fillText(name, x + 2, y + th + 15);
    }, data, x.ci, x.ri, `${rows[x.ri].label.split(' · ')[0]} · t ${x.t.toFixed(1)} s`, tw, th, pad, lab);
  }
  await sheet.screenshot({ path: path.join(OUT, 'sheet.png') });
  console.log(`sheet ${path.join(OUT, 'sheet.png')} (${files.length} stills)`);
}
for (const e of errors) console.log('ERR ' + e);
await page.close();

if (flag('video')) {
  const fps = +flag('video'), dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const v = await start(640, 360);
  let n = 0;
  for (let t = 0; t <= total; t += 1 / fps) { await v.page.evaluate((t) => window.__mirage.game.intro.seek(t), t); await sleep(140); await v.page.screenshot({ path: path.join(dir, `f${String(n++).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 }); }
  await v.page.close();
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.jpg'), '-pix_fmt', 'yuv420p', '-vf', 'scale=640:-2', path.join(OUT, 'intro.mp4')]); console.log(`video ${path.join(OUT, 'intro.mp4')}`); } catch { console.log(`frames in ${dir} (no ffmpeg)`); }
}
await b.close(); srv.close?.();

#!/usr/bin/env node
// The light by day, measured: the game (HUD and gun hidden) at a few cameras with an 18 % grey card held in view
// (a matte card 0.5 m square, 1.4 m ahead of the eye, turned to face it), and per view: the card's mean sRGB (its
// balance: (R + B) / 2 - G > 0 is a magenta cast), the frame's mean sRGB and the share of clipped pixels (any channel
// at 254+). Variants are URL flags (A/B of the suspects of a colour cast).
//   node scripts/daylight.mjs [dist] [--out out/nizwa-light/day] [--quality high] [--time day]
//        [--variants "base;grade=0;dusk=0"] [--views street-east,plaza-west,...] [--card 0|1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/nizwa-light/day'))), W = 1440, H = 900, Q = flag('quality', 'high'), TIME = flag('time', 'day');
const VIEWS = {
  'street-east': { eye: [30, 1.62, 6.2], look: [-40, 3.2, 6] },          // the street from its east end, looking west (backlit)
  'plaza-west': { eye: [18, 1.76, 1.4], look: [-40, 4.5, 6] },
  'strip': { eye: [13, 1.7, 4.2], look: [8.5, 0, 8.1] },                   // the sunlit strip reserved for the water channel (plan.js waterStrip)
  'street-sun': { eye: [24, 1.62, 6.6], look: [-40, 8.5, 6] },           // the same, a little higher: the sun's disc in the street's end        // from the plaza's corner, down the street to the west
  'street-up': { eye: [-7, 1.62, 6.2], look: [12, 13, 3.5] },
  'bar': { eye: [-11.2, 1.6, 0.9], look: [-20, 1.5, -7] },
  'relay': { eye: [21.4, 1.6, -21.2], look: [9, 1.4, -28.5] },
  'stair': { eye: [24.0, 7.6, -22.0], look: [27.5, 6.0, -27.5] },
  'street': { eye: [-29.5, 1.62, 6.4], look: [8, 3.2, 5] },
  'plaza': { eye: [10.2, 1.76, 0.9], look: [19, 3.6, -11] },
  'skyline': { eye: [21.5, 7.62, -21.6], look: [-24, 24, 22] },
  'alley': { eye: [-22, 1.62, 29.5], look: [-22, 4.5, 10] },
};
const views = flag('views', 'street-east,plaza-west,street-up,street,plaza').split(',');
const variants = flag('variants', 'base').split(';');
const CARD = flag('card', '1') !== '0';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist), b = await launch({ w: W, h: H });
const rows = [];
for (const vq of variants) {
  const extra = vq === 'base' ? '' : '&' + vq;
  const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&hud=0&lang=en&quality=${Q}&time=${TIME}${extra}`);
  await page.addStyleTag({ content: '.nd, .ndx, .mg-ui { display: none !important; }' });
  await page.evaluate((CARD) => {
    const m = window.__mirage, w = m.world;
    m.game.weapon.holder.visible = false;
    for (const e of m.game.enemies.list) m.game.enemies.park?.(e);
    for (const e of m.game.drones.list) m.game.drones.park?.(e);
    if (!CARD) return;
    // the card: 18 % reflectance (linear 0.18), matte, no wetness; a mesh class and a geometry from what the world has
    const Mesh = w.scene.children.find((o) => o.isMesh).constructor;
    const mat = w.mat.std({ roughness: 1, metalness: 0 }); mat.color.setRGB(0.18, 0.18, 0.18); mat.envMapIntensity = 1;
    const card = new Mesh(new w.geom.RoundedBoxGeometry(0.5, 0.5, 0.01, 1, 0.002), mat);
    card.castShadow = false; card.receiveShadow = true; card.name = 'grey-card';
    w.scene.add(card); window.__card = card;
  }, CARD);
  await sleep(2500);
  for (const name of views) {
    const v = VIEWS[name];
    await page.evaluate((v) => { const m = window.__mirage; m.play.place(v.eye, v.look, 'walk'); }, v);
    await sleep(1500);
    // the card: 1.4 m ahead, 0.35 m right and 0.3 m down of the view's centre, square to the eye
    const r = await page.evaluate(async (CARD) => {
      const m = window.__mirage, cam = m.world.camera, card = window.__card;
      if (card) {
        const f = cam.getWorldDirection(card.position.clone()), rt = f.clone().cross(cam.up).normalize(), up = rt.clone().cross(f).normalize();
        card.position.copy(cam.position).addScaledVector(f, 1.4).addScaledVector(rt, 0.35).addScaledVector(up, -0.3);
        card.lookAt(cam.position);
      }
      await new Promise((res) => { let n = 0; const t = () => (++n < 40 ? requestAnimationFrame(t) : res()); requestAnimationFrame(t); });
      const gl = m.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const mean = [0, 0, 0]; let clip = 0;
      for (let i = 0; i < w * h; i++) { const j = i * 4; mean[0] += px[j]; mean[1] += px[j + 1]; mean[2] += px[j + 2]; if (px[j] >= 254 || px[j + 1] >= 254 || px[j + 2] >= 254) clip++; }
      let c = null;
      if (card) {   // the card's centre on screen, a 16 x 16 px patch
        const p = card.position.clone().project(cam), cx = Math.round((p.x * 0.5 + 0.5) * w), cy = Math.round((p.y * 0.5 + 0.5) * h);
        c = [0, 0, 0]; let n = 0;
        for (let y = cy - 8; y < cy + 8; y++) for (let x = cx - 8; x < cx + 8; x++) { const j = (y * w + x) * 4; c[0] += px[j]; c[1] += px[j + 1]; c[2] += px[j + 2]; n++; }
        c = c.map((v) => v / n);
        card.visible = false;
        await new Promise((res) => { let n = 0; const t = () => (++n < 3 ? requestAnimationFrame(t) : res()); requestAnimationFrame(t); });
      }
      return { mean: mean.map((v) => v / (w * h)), clip: clip / (w * h), card: c };
    }, CARD);
    const file = `${name}-${TIME}${vq === 'base' ? '' : '-' + vq.replace(/[^\w.]+/g, '_')}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    await page.evaluate(() => { if (window.__card) window.__card.visible = true; });
    const f1 = (a) => a.map((x) => x.toFixed(1)).join(' / ');
    rows.push({ variant: vq, view: name, card: r.card ? f1(r.card) : '-', cast: r.card ? ((r.card[0] + r.card[2]) / 2 - r.card[1]).toFixed(1) : '-', frame: f1(r.mean), fcast: ((r.mean[0] + r.mean[2]) / 2 - r.mean[1]).toFixed(1), clip: (100 * r.clip).toFixed(2) + ' %', file });
  }
  for (const e of errors.slice(0, 3)) console.log('ERR ' + e);
  await page.close();
}
await b.close(); srv.close?.();
console.log(`neon-district by day: ${TIME}, ${Q}, ${W} x ${H}; card: an 18 % grey card in view (sRGB 0..255), cast = (R + B) / 2 - G\n`);
console.log('| variant | view | card R / G / B | card cast | frame R / G / B | frame cast | clipped |\n|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.variant} | ${r.view} | ${r.card} | ${r.cast} | ${r.frame} | ${r.fcast} | ${r.clip} |`);
fs.writeFileSync(path.join(OUT, `daylight-${TIME}.json`), JSON.stringify(rows, null, 1));
process.exit(0);

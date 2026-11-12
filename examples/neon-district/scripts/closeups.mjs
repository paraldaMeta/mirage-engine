#!/usr/bin/env node
// Stills at about a metre from the close-up props, for before / after comparisons of a performance change (nothing a
// player can walk up to may get poorer): a vending machine, a parked car, the bar's back shelf, a stall lantern, plus
// the street and the alley at eye height. The district alone (?world=1), night, 4 sub-frames a still.
//   node scripts/closeups.mjs [dist] --out out/close-after [--quality medium] [--query "ssr=0"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/close'))), W = 1280, H = 800, Q = flag('quality', 'medium');
const CAMS = [
  { name: 'vending', eye: [-21.45, 1.45, 27.3], look: [-20.4, 1.2, 26.9] },
  { name: 'car', eye: [-20.1, 1.15, 8.75], look: [-21.6, 0.7, 7.4] },
  { name: 'bar-shelf', eye: [-17, 1.65, -7.3], look: [-17.4, 1.45, -8.6] },
  { name: 'lantern', eye: [10.9, 2.75, -5.2], look: [9.75, 2.6, -5.55] },
  { name: 'street', eye: [-29.5, 1.62, 6.4], look: [8, 3.2, 5] },
  { name: 'alley', eye: [-22, 1.62, 29.5], look: [-22, 2.4, 10] },
];
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(dist), b = await launch({ w: W, h: H });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&world=1&ui=0&grain=0&hud=0&quality=${Q}&time=night${flag('query') ? '&' + flag('query') : ''}`);
for (const c of CAMS) {
  const png = await page.evaluate((c) => {
    const { play, world } = window.__mirage; play.stop();
    play.place(c.eye, c.look, 'fly');
    for (let i = 0; i < 60 || (world.lighting?.busy && i < 600); i++) { play.step(1 / 60); play.render({ moving: true }); }
    play.render({ moving: false, spp: 4, frameIndex: 1 });
    return document.querySelector('canvas').toDataURL('image/png');
  }, c);
  fs.writeFileSync(path.join(OUT, c.name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
}
console.log(`closeups: ${CAMS.length} stills in ${OUT}${errors.length ? ' (page errors: ' + errors.slice(0, 2).join(' | ') + ')' : ''}`);
await b.close(); srv.close?.();
process.exit(0);

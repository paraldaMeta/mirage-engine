#!/usr/bin/env node
// The lamp pool's settings against frame time and the picture, in one page (NOTES.md "Frame budget", low): each
// variant's frames come right after the base's (paired, so the machine's load lands on both), and a still of each at
// the view (out/pool-ab/<variant>.png) to compare. Variants set world.lampPool.cfg at run time.
//   node scripts/pool-ab.mjs [dist] [--quality low] [--view "street west"] [--rounds 7] [--frames 24] [--world]
//     [--variants "far=200,fade=40;far=70,fade=21;perCell=12"]   (the first is the base)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(here, '../dist'));
const W = 1440, H = 900, Q = flag('quality', 'low'), VIEW = flag('view', 'street west'), R = +flag('rounds', 7), F = +flag('frames', 24);
const OUT = path.resolve(flag('out', path.join(here, '../out/pool-ab')));
const variants = flag('variants', 'far=200,fade=40;far=70,fade=21;far=50,fade=15;perCell=12').split(';').map((v) => Object.fromEntries(v.split(',').map((kv) => { const [k, x] = kv.split('='); return [k, +x]; })));
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(dist), b = await launch({ w: W, h: H });
const { page } = await open(b, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&quality=${Q}&${args.includes('--world') ? 'world=1&ui=0' : 'start=1&assist=1'}${flag('q') ? '&' + flag('q') : ''}`);
const res = await page.evaluate((VIEW, R, F, variants) => {
  const { play, built, world } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4), P = world.lampPool;
  play.stop();
  for (let i = 0; i < 600 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
  const v = built.plan.viewpoints.find((q) => q.name === VIEW);
  const set = (o) => { Object.assign(P.cfg, o); P.uniforms.mgPA.value.z = P.cfg.far - P.cfg.fade; P.uniforms.mgPA.value.w = P.cfg.far; if (P.uniforms.mgPD) P.uniforms.mgPD.value = P.cfg.cut || 0; play.place(v.eye, v.look, 'walk'); };
  const run = (o) => {
    set(o);
    for (let i = 0; i < 8; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = [];
    for (let i = 0; i < F; i++) { const t = performance.now(); play.turn(i < F / 2 ? 1 : -1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b); return ms[ms.length >> 1];
  };
  const base = variants[0], out = variants.map(() => []), bases = [];
  for (let r = 0; r < R; r++) for (let i = 1; i < variants.length; i++) { const a = run(base), c = run({ ...base, ...variants[i] }); bases.push(a); out[i].push(a - c); }
  // stills: the view, no turn, a few frames to settle (the base, then each variant)
  const shots = variants.map((o, i) => { set({ ...base, ...o }); for (let k = 0; k < 12; k++) { play.step(1 / 60); play.render({ moving: false }); } return world.renderer.domElement.toDataURL('image/png'); });
  set(base);
  return { bases, out, shots, info: { active: P.info.active, indices: P.info.indices, clipped: P.info.clipped } };
}, VIEW, R, F, variants);
await b.close(); srv.close?.();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const name = (o) => Object.entries(o).map(([k, x]) => `${k}=${x}`).join(',');
console.log(`${VIEW}, ${Q}: base (${name(variants[0])}) ${med(res.bases).toFixed(2)} ms [${Math.min(...res.bases).toFixed(2)}-${Math.max(...res.bases).toFixed(2)}]; saving of each (median of paired differences) [min-max]`);
variants.forEach((o, i) => { fs.writeFileSync(path.join(OUT, `${i}-${name(o) || 'base'}.png`), Buffer.from(res.shots[i].split(',')[1], 'base64')); if (i) console.log(`${name(o).padEnd(24)} ${med(res.out[i]).toFixed(2)} [${Math.min(...res.out[i]).toFixed(2)}-${Math.max(...res.out[i]).toFixed(2)}]`); });
console.log('stills in', OUT, JSON.stringify(res.info));

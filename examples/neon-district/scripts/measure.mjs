#!/usr/bin/env node
// Frame time of neon-district on this machine, per quality level and per feature.
//   node scripts/measure.mjs [dist] [--w 1440 --h 900] [--rounds 6] [--frames 40] [--ab] [--out out/measure.json]
//   [--query time=day] (added to every variant's URL)  [--vs other-dist] [--only game]: the same variants of another build too, in the same rounds (before / after on a
//   machine that is not quiet: both see the same load), its rows marked `vs`; --only keeps the variants whose name
//   starts with that (several: 'game, medium;world, medium')
// Every variant is its own page in one Chrome; the rounds go round-robin over the pages (A/B interleaved), so a
// busy moment on the machine lands on every variant alike. In a round each view is walked for `frames` moving
// (temporal AA) frames with a slow pan, driven synchronously (step + render + a 1-pixel readback: the GPU work is
// inside the timing). A number is the median of the round medians; the bracket is their lowest and highest.
// Variants: the three quality levels in the game (enemies thinking and animating, the view model, effects), the
// world alone at each level, and with --ab every feature of `high` switched off in turn.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--ab')) || path.join(here, '../dist'));
const vs = flag('vs') ? path.resolve(flag('vs')) : null;
const W = +flag('w', 1440), H = +flag('h', 900), ROUNDS = +flag('rounds', 6), FRAMES = +flag('frames', 40);
const VIEWS = ['alley', 'street west', 'bar inside', 'plaza', 'roof vista'];
// (a page is a WebGL context and Chrome keeps 16 alive: --ab is its own run, with `world, high` as its baseline)
const variants = args.includes('--ab') ? [{ name: 'world, high', query: 'world=1&ui=0&quality=high' },
  ... ['ssr=0', 'ssgi=0', 'contact=0', 'gi=0&probes=0', 'csm=0', 'shadows=0', 'vol=0', 'taa2=0', 'mb=0', 'rain=0', 'big=0', 'big=chunk,occ', 'big=chunk,occ,lod', 'lamps=100']
    .map((f) => ({ name: `world, high, ${f}`, query: `world=1&ui=0&quality=high&${f}` }))] : [
  ...['low', 'medium', 'high'].map((q) => ({ name: `game, ${q}`, query: `start=1&assist=1&quality=${q}` })),
  ...['low', 'medium', 'high'].map((q) => ({ name: `world, ${q}`, query: `world=1&ui=0&quality=${q}` })),
];
if (flag('only')) variants.splice(0, variants.length, ...variants.filter((v) => flag('only').split(';').some((o) => v.name.startsWith(o))));
if (vs) variants.splice(0, variants.length, ...variants.flatMap((v) => [{ ...v, vs: true, name: 'vs ' + v.name }, v]));
const srv = await serve(dist), srv2 = vs ? await serve(vs) : null, browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [];
for (const v of variants) {
  const { page, errors, loadMs } = await open(browser, `${(v.vs ? srv2 : srv).url}?w=${W}&h=${H}&grain=0&hud=0&${v.query}${flag('query') ? '&' + flag('query') : ''}`);
  // stop the page's own loop, then draw until the probe volume and the reflection probes have settled
  await page.evaluate(() => { const { play, world } = window.__mirage; play.stop(); for (let i = 0; i < 900 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); } });
  pages.push({ ...v, page, errors, loadMs, rounds: Object.fromEntries(VIEWS.map((n) => [n, []])) });
}
for (let r = 0; r < ROUNDS; r++) {
  for (const p of pages) {
    const got = await p.page.evaluate((VIEWS, FRAMES) => {
      const { play, built, world } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4), out = {};
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (const name of VIEWS) {
        const v = built.plan.viewpoints.find((q) => q.name === name);
        play.place(v.eye, v.look, 'walk');
        for (let i = 0; i < 12; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); } sync();
        const ms = [];
        for (let i = 0; i < FRAMES; i++) { const t = performance.now(); play.turn(i < FRAMES / 2 ? 1 : -1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); sync(); ms.push(performance.now() - t); }
        ms.sort((a, b) => a - b);
        const info = world.renderer.info; info.autoReset = false; info.reset(); play.step(1 / 60); play.render({ moving: true }); sync();
        out[name] = { ms: ms[ms.length >> 1], calls: info.render.calls, triangles: info.render.triangles }; info.autoReset = true;
      }
      return out;
    }, VIEWS, FRAMES);
    for (const n of VIEWS) p.rounds[n].push(got[n]);
  }
  process.stderr.write(`round ${r + 1} / ${ROUNDS}\n`);
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rows = pages.map((p) => ({ name: p.name, query: p.query, loadMs: p.loadMs, errors: p.errors.length,
  views: Object.fromEntries(VIEWS.map((n) => { const ms = p.rounds[n].map((x) => x.ms); return [n, { ms: +med(ms).toFixed(2), min: +Math.min(...ms).toFixed(2), max: +Math.max(...ms).toFixed(2), calls: p.rounds[n].at(-1).calls, triangles: p.rounds[n].at(-1).triangles }]; })) }));
const gpu = await pages[0].page.evaluate(() => { const gl = window.__mirage.world.renderer.getContext(); return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); });
await browser.close(); srv.close?.(); srv2?.close?.();
const cell = (v) => `${v.ms.toFixed(1)} [${v.min.toFixed(1)}-${v.max.toFixed(1)}]`;
console.log(`neon-district, ${W} x ${H}, ${ROUNDS} interleaved rounds of ${FRAMES} moving frames per view, ms per frame: median [min-max]\n${gpu}\n`);
console.log(`| variant | ${VIEWS.join(' | ')} | calls, triangles (street) |\n|---|${VIEWS.map(() => '---').join('|')}|---|`);
for (const r of rows) console.log(`| ${r.name} | ${VIEWS.map((n) => cell(r.views[n])).join(' | ')} | ${r.views['street west'].calls}, ${(r.views['street west'].triangles / 1000).toFixed(0)} k |`);
const out = flag('out');
if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), size: [W, H], rounds: ROUNDS, frames: FRAMES, gpu, rows }, null, 1)); }

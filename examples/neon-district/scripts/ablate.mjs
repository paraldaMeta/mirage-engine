#!/usr/bin/env node
// What each part of the game costs on the GPU and CPU, by hiding it: frame time (step + render + 1-px read-back) at a
// view with the part hidden, interleaved over rounds (median of round medians). The game keeps running underneath.
//   node scripts/ablate.mjs [dist] [--quality low] [--view "street west"] [--rounds 5] [--frames 40]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(here, '../dist'));
const W = 1440, H = 900, VIEW = flag('view', 'street west'), R = +flag('rounds', 5), F = +flag('frames', 40), Q = flag('quality', 'low');
const srv = await serve(dist), browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&start=1&assist=1&quality=${Q}${flag('q') ? '&' + flag('q') : ''}`);
const parts = ['none', 'viewmodel', 'sentinels', 'hounds', 'kites', 'civilians', 'cars', 'robots+civ', 'game all'];
const out = await page.evaluate((VIEW, R, F, parts) => {
  const { play, built, world, game } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4), sc = world.scene;
  play.stop();
  for (let i = 0; i < 900 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
  const v = built.plan.viewpoints.find((q) => q.name === VIEW);
  const objs = {
    viewmodel: [game.weapon.holder],
    sentinels: game.enemies.list.filter((e) => !e.dog).map((e) => e.rig.root),
    hounds: game.enemies.list.filter((e) => e.dog).map((e) => e.rig.root),
    kites: game.drones.list.map((e) => e.o),
    civilians: [sc.getObjectByName('machines')].filter(Boolean),
    cars: [],
  };
  sc.traverse((o) => { if (/^cars/.test(o.name)) objs.cars.push(o); });
  objs['robots+civ'] = [...objs.sentinels, ...objs.hounds, ...objs.kites, ...objs.civilians];
  objs['game all'] = [...objs['robots+civ'], ...objs.viewmodel];
  objs.none = [];
  const res = Object.fromEntries(parts.map((p) => [p, []]));
  for (let r = 0; r < R; r++) for (const p of parts) {
    const hid = objs[p].filter((o) => o.visible); for (const o of hid) o.visible = false;
    // keep them hidden through the game's own per-step visibility writes
    const keep = () => { for (const o of hid) o.visible = false; };
    play.place(v.eye, v.look, 'walk');
    for (let i = 0; i < 10; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); keep(); play.render({ moving: true }); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = [];
    for (let i = 0; i < F; i++) { const t = performance.now(); play.turn(i < F / 2 ? 1 : -1, 0, 0.004); play.step(1 / 60); keep(); play.render({ moving: true }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t); }
    for (const o of hid) o.visible = true;
    ms.sort((a, b) => a - b); res[p].push(ms[ms.length >> 1]);
  }
  return { res, n: Object.fromEntries(Object.entries(objs).map(([k, v]) => [k, v.length])) };
}, VIEW, R, F, parts);
await browser.close(); srv.close?.();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const base = med(out.res.none);
console.log(`${VIEW}, quality ${Q}, ${R} rounds x ${F} frames: ms a frame (median of rounds) [min-max], saving against nothing hidden`);
for (const p of parts) console.log(`${p.padEnd(12)} ${med(out.res[p]).toFixed(2)} [${Math.min(...out.res[p]).toFixed(2)}-${Math.max(...out.res[p]).toFixed(2)}]  ${(base - med(out.res[p])).toFixed(2)}  (${out.n[p] ?? 0} objects)`);

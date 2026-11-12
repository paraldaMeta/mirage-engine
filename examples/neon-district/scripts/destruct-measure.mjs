#!/usr/bin/env node
// Frame time of the breakable props (game/destruct.js) under load, per quality level, driven synchronously like
// scripts/measure.mjs (step + render + a 1-pixel readback, the GPU work inside the timing):
//   idle      the street west view, nothing broken
//   sweep     the same view while a gatling's rounds sweep the street (one round a frame, 60 a second: more than the
//             gun's 24) for 3 s: glass, lights, cardboard, signs, a car
//   rocket    the stall from the plaza: a rocket's blast into it (the flap folds, the gas bottle, the lanterns, the
//             goods), the 2 s after it
//   node scripts/destruct-measure.mjs [dist] [--w 1440 --h 900] [--rounds 3]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const W = +flag('w', 1440), H = +flag('h', 900), ROUNDS = +flag('rounds', 3);
const srv = await serve(dist), browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const rows = [];
for (const q of ['low', 'medium', 'high']) {
  const { page } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&start=1&assist=1&quality=${q}&fullscreen=0`);
  await page.evaluate(() => { const { play, world } = window.__mirage; play.stop(); for (let i = 0; i < 900 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); } });
  const acc = { idle: [], sweep: [], rocket: [] }, caps = [];
  for (let r = 0; r < ROUNDS; r++) {
    const got = await page.evaluate(() => {
      const { play, built, world, game } = window.__mirage, P = game.props, d = P.d, gl = world.renderer.getContext(), px = new Uint8Array(4);
      for (const e of game.enemies.list) game.enemies.park(e); for (const e of game.drones.list) game.drones.park(e);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const frame = (fn) => { const t = performance.now(); fn?.(); play.step(1 / 60); play.render({ moving: true }); sync(); return performance.now() - t; };
      const v = built.plan.viewpoints.find((x) => x.name === 'street west');
      d.reset(); play.place(v.eye, v.look, 'walk');
      for (let i = 0; i < 20; i++) frame();
      const idle = [], sweep = [], rocket = [];
      for (let i = 0; i < 90; i++) idle.push(frame());
      const eye = [v.eye[0], v.eye[1], v.eye[2]], look = [v.look[0] - v.eye[0], v.look[2] - v.eye[2]], yaw0 = Math.atan2(look[1], look[0]);
      let a = 0, maxD = 0, maxM = 0;
      for (let i = 0; i < 180; i++) sweep.push(frame(() => { a += 0.05; const yaw = yaw0 + 0.5 * Math.sin(a * 1.7), pitch = 0.02 + 0.18 * Math.sin(a * 4.3); P.shoot(eye, [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)], 80, 11, 1, 'gatling'); maxD = Math.max(maxD, d.stats.debris); maxM = Math.max(maxM, d.stats.marks); }));
      const broke = d.tally.count;
      d.reset(); play.place([14, 1.7, -1], [7.5, 1.6, -5.6], 'walk');
      for (let i = 0; i < 20; i++) frame();
      rocket.push(frame(() => P.blast([9.0, 1.2, -5.2], 5.5, 220)));
      for (let i = 0; i < 120; i++) rocket.push(frame(() => { maxD = Math.max(maxD, d.stats.debris); maxM = Math.max(maxM, d.stats.marks); }));
      const cap = { debris: maxD, capD: d.cfg.maxDebris, marks: maxM, capM: d.cfg.maxDecals, broke, rocketBroke: d.tally.count };
      d.reset();
      return { idle, sweep, rocket, cap };
    });
    for (const k of ['idle', 'sweep', 'rocket']) acc[k].push(...got[k]);
    caps.push(got.cap);
  }
  const st = (a) => { const s = [...a].sort((x, y) => x - y); return { med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
  rows.push({ q, idle: st(acc.idle), sweep: st(acc.sweep), rocket: st(acc.rocket), cap: caps.at(-1) });
  await page.close();
}
await browser.close(); srv.close?.();
const c = (s) => `${s.med.toFixed(1)} / ${s.p95.toFixed(1)} / ${s.max.toFixed(1)}`;
console.log(`destructibles under load, ${W} x ${H}, ${ROUNDS} rounds, ms per frame: median / p95 / worst\n`);
console.log('| quality | idle (street west) | gatling sweep, 3 s | rocket into the stall, 2 s | debris, marks at most (cap) | broken (sweep, rocket) |\n|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.q} | ${c(r.idle)} | ${c(r.sweep)} | ${c(r.rocket)} | ${r.cap.debris} (${r.cap.capD}), ${r.cap.marks} (${r.cap.capM}) | ${r.cap.broke}, ${r.cap.rocketBroke} |`);

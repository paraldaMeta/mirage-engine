#!/usr/bin/env node
// Picture strips of the robots' behaviours (game/behaviours.js, the cyber kit's robot-behaviours.js): eight frames each
// from a fixed camera, then one contact sheet of every strip. The robots are posed in the real game (?time=day for
// legibility), the rest parked; each behaviour is started by enemies.behave or machines.userData.act/sync.
//   node scripts/behaviour-shots.mjs [dist] [--out out/behaviours] [--only repair,scan]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const ONLY = flag('only', null), OUT = path.resolve(flag('out', path.join(here, '../out/behaviours'))), W = 1280, H = 720;
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(dist), b = await launch({ w: W, h: H });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&hud=0&quality=medium&time=day&lang=en&fullscreen=0`, { timeout: 150000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(({ W, H }) => {
  const m = window.__mirage, G = m.game, E = G.enemies, play = m.play;
  play.stop();
  E.env.blind = () => true;
  for (const d of G.drones.list) G.drones.park(d);
  let T = 1;   // the scene clock the civilians run on (play.step does not advance it)
  const step = (n = 1) => { for (let i = 0; i < n; i++) { G.player.hp = 100; G.player.dead = false; play.step(1 / 60); T += 1 / 60; } };
  const v3 = () => new (m.world.camera.position.constructor)();
  const machines = m.world.scene.getObjectByName('machines').userData;
  /** robots `ids` revived at `at` (+ offsets along x), facing yaw, not on patrol; the rest parked */
  const subjects = (ids, at, yaw, gap = 1.8) => {
    for (const e of E.list) E.park(e);
    return ids.map((id, i) => {
      const e = E.list.find((x) => x.id === id);
      e.drill = true; e.def = { ...e.def, patrol: null };
      E.revive(e, [at[0] + (i - (ids.length - 1) / 2) * gap, at[1], at[2]]); e.yaw = yaw; e.heading[0] = Math.sin(yaw); e.heading[1] = Math.cos(yaw); e.state = 'post';
      return e;
    });
  };
  const go = (e, to, speed) => { e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = speed; e.agent.setGoal(E.nav.nearest(to, { snap: 2 }) || to); };
  /** the camera at p + [dx, dy, dz] looking at p + [0, ly, 0] */
  const cam = (p, d, ly = 0.9) => { play.place([p[0] + d[0], p[1] + d[1], p[2] + d[2]], [p[0], p[1] + ly, p[2]], 'fly'); step(1); };   // (a step puts the camera there)
  const tiles = [];
  const vm = m.world.scene.getObjectByName('viewmodel');
  /** draw, then cut a tw x th tile round the point p (+ 0.85 m) */
  const shoot = (p, tw = 260, th = 340, dy = 0.85) => {
    if (vm) vm.visible = false;
    for (let i = 0; i < 3; i++) m.world.renderFrame(T, { camera: m.world.camera, taa: true });
    const c = m.world.camera; c.updateMatrixWorld();
    const s = v3().set(p[0], p[1] + dy, p[2]).project(c), cx = (s.x * 0.5 + 0.5) * W, cy = (1 - (s.y * 0.5 + 0.5)) * H;
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(document.querySelector('canvas'), cx - tw / 2, cy - th / 2, tw, th, 0, 0, tw, th);
    tiles.push(t);
  };
  const strips = [];
  const strip = (label) => {
    const c = document.createElement('canvas'); c.width = tiles.reduce((s, t) => s + t.width, 0); c.height = Math.max(...tiles.map((t) => t.height));
    const g = c.getContext('2d'); let x = 0; for (const t of tiles) { g.drawImage(t, x, 0); x += t.width; }
    g.font = '16px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(label, 8, 22); g.fillText(label, 8, 22);
    tiles.length = 0; strips.push(c);
    return c.toDataURL('image/png');
  };
  const sheet = () => {
    const w = Math.max(...strips.map((s) => s.width)), c = document.createElement('canvas'); c.width = w; c.height = strips.reduce((s, x) => s + x.height, 0);
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); let y = 0; for (const s of strips) { g.drawImage(s, 0, y); y += s.height; }
    return c.toDataURL('image/png');
  };
  window.__bh = { m, G, E, step, subjects, go, cam, shoot, strip, sheet, machines, get T() { return T; }, set T(x) { T = x; } };
}, { W, H });

const save = (name, url) => fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
const A = [10, 0.14, -12], Bp = [10, 0.14, -17];
const shots = {
  // 1. self-repair: it stops, the forearm panel opens, the joint jitters, it carries on
  repair: ({ E, step, subjects, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(30);
    cam(e.pos, [-1.2, 0.45, -1.2], 1.15); E.behave(e, 'repair');
    for (let k = 0; k < 8; k++) { step(k ? 31 : 6); shoot(e.pos, 300, 340, 1.0); }
    return strip('1 self-repair: forearm panel open, servo jitter');
  },
  // 2. network sync: one hit, the others freeze on that frame, then all heads turn to the player together
  sync: ({ E, step, subjects, cam, shoot, strip }) => {
    const rs = subjects(['g6', 'g5', 'g8'], A, Math.PI, 1.9); step(40);
    const c = rs[1];
    cam(c.pos, [-2.4, 1.3, -4.2], 1.0);
    const seq = [0, 2, 10, 10, 6, 6, 10, 20];
    for (let k = 0; k < 8; k++) {
      if (k === 1) { const f = [Math.sin(c.yaw), Math.cos(c.yaw)]; c.hp = 9999; E.damage(c, 15, false, [c.pos[0] + f[0] * 0.25, c.pos[1] + 1.3, c.pos[2] + f[1] * 0.25], [-f[0], 0, -f[1]], {}); }
      step(seq[k]); shoot(c.pos, 640, 330, 1.0);
    }
    return strip('2 network sync: hit -> all freeze 0.4 s -> heads turn together');
  },
  // 3. clumsy imitation: a pair bows (the second copies the first half a second late), then a probe "smoked", a wave
  imitation: ({ m, step, cam, shoot, strip, machines }) => {
    const bh = window.__bh, w = machines.where;
    const a = w('stand', 0), b = w('stand', 1), mid = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
    for (const e of bh.E.list) bh.E.park(e);
    cam(mid, [0.2, 0.55, -3.4], 0.9);
    const at = (dt) => { bh.T += dt; m.world.renderFrame(bh.T, { camera: m.world.camera, taa: true }); };
    at(0.05); machines.act(0, 'bow'); at(0.55); machines.act(1, 'bow');
    for (const dt of [0.3, 0.6, 0.6, 1.0]) { at(dt); shoot(mid, 420, 340, 0.75); }
    at(2.4); machines.act(0, 'smoke'); machines.act(1, 'wave');
    for (const dt of [0.5, 0.4, 0.5, 0.6]) { at(dt); shoot(mid, 420, 340, 0.75); }
    void step;
    return strip('3 imitation: a bow copied late, a probe smoked, an off-tempo wave');
  },
  // 4. firmware glitch: the free arm goes limp and snaps back; a pose loops and stutters
  glitch: ({ E, step, subjects, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(30);
    cam(e.pos, [-2.2, 0.5, -1.6], 1.0); E.behave(e, 'limp');
    for (let k = 0; k < 4; k++) { step(k ? 30 : 10); shoot(e.pos, 300, 340, 1.0); }
    step(40); E.behave(e, 'loop');
    for (let k = 0; k < 4; k++) { step(k === 0 ? 20 : 7); shoot(e.pos, 300, 340, 1.0); }
    return strip('4 firmware glitch: limp arm, snap back | pose loop stutter');
  },
  // 5. a leg lost: it crawls on its arms and keeps after the player
  crawl: ({ E, step, subjects, go, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(30);
    E.behave(e, 'crawl'); step(30); go(e, Bp, 0.9); step(30);
    for (let k = 0; k < 8; k++) { step(14); cam(e.pos, [-2.6, 1.3, -1.4], 0.3); shoot(e.pos, 300, 300, 0.4); }
    return strip('5 a leg shot off: crawls on its arms after the player');
  },
  // 6. scavenging: one falls; another walks over, kneels, pulls the head off and carries it away
  scavenge: ({ E, step, subjects, cam, shoot, strip }) => {
    const [d, s] = subjects(['g5', 'g6'], A, Math.PI, 3.2); s.drill = false; s.yaw = -Math.PI / 2; step(40);
    const mid = [(d.pos[0] + s.pos[0]) / 2, d.pos[1], d.pos[2]];
    cam(mid, [0.6, 1.5, -4.4], 0.4);
    E.behave(d, 'scavenge'); const f = [Math.sin(d.yaw), Math.cos(d.yaw)]; E.damage(d, 999, false, [d.pos[0] + f[0] * 0.25, d.pos[1] + 1.2, d.pos[2] + f[1] * 0.25], [-f[0], 0, -f[1]], {});
    s.state = 'post'; s.seenT = -1e9;   // (the kill alerted it: as if the shooting had long stopped)
    for (const n of [50, 60, 50, 40, 50, 60, 60, 70]) { step(n); shoot(mid, 640, 330, 0.75); }
    return strip('6 scavenging: walks to the fallen one, pulls its head off, carries it away');
  },
  // 7. queueing to charge at the drink machine; walk close and they turn their heads round to stare
  queue: ({ m, cam, shoot, strip, machines }) => {
    const bh = window.__bh;
    const at = (dt) => { bh.T += dt; m.world.renderFrame(bh.T, { camera: m.world.camera, taa: true }); };
    const c = [28.25, 0.14, -2.55];
    for (const dd of [7.5, 6.5, 5.5, 4.6, 3.8, 3.2, 2.9, 2.9]) { cam(c, [-dd, 1.45, 0.4], 0.9); at(0.35); shoot(c, 360, 380, 0.9); }
    return strip('7 queue to charge: the front one plugged in; come close and heads turn to stare');
  },
  // 8. inhuman motion: the trunk turns 180° and walks on backwards; the head locks on while the body turns slowly
  inhuman: ({ E, step, subjects, go, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(20);
    go(e, Bp, 1.3); step(40); E.behave(e, 'spin');
    for (let k = 0; k < 4; k++) { step(k ? 14 : 2); cam(e.pos, [-3.0, 0.8, -0.6], 1.0); shoot(e.pos, 300, 340, 1.0); }
    const [f] = subjects(['g6'], A, Math.PI); step(20);
    cam(f.pos, [-3.0, 0.7, -1.5], 1.0);
    f.state = 'alert'; f.t = 0; f.wait = 99; f.lastSeen = [f.pos[0] - 3, f.pos[1], f.pos[2] + 3];
    for (let k = 0; k < 4; k++) { step(k ? 9 : 2); shoot(f.pos, 300, 340, 1.0); }
    return strip('8 inhuman: torso 180, walks backwards | head locks, body turns after');
  },
  // 9. scanning: before it aggros the head tilts in steps and a laser grid sweeps the player
  scan: ({ E, step, subjects, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(30);
    const tgt = [e.pos[0] - 1.0, e.pos[1], e.pos[2] - 5.5];
    cam(e.pos, [-3.2, 1.2, 2.2], 1.0);
    E.behave(e, 'scan', tgt);
    for (let k = 0; k < 8; k++) { step(k ? 9 : 3); shoot([e.pos[0] - 0.3, e.pos[1], e.pos[2] - 1.2], 520, 380, 1.0); }
    return strip('9 scan: head tilts like a lens focusing, a laser grid sweeps the player');
  },
  // 10. playing dead: eyes dark, they flicker back on, it climbs up the wrong way and fights again
  reboot: ({ E, step, subjects, cam, shoot, strip }) => {
    const [e] = subjects(['g5'], A, Math.PI); step(30);
    const f = [Math.sin(e.yaw), Math.cos(e.yaw)]; E.damage(e, 999, false, [e.pos[0] + f[0] * 0.25, e.pos[1] + 1.2, e.pos[2] + f[1] * 0.25], [-f[0], 0, -f[1]], {});
    step(150); e.reboot = e.deadT + 0.3;
    cam(e.pos, [2.8, 0.9, -1.6], 0.6);
    for (const n of [1, 30, 30, 30, 30, 30, 40, 50]) { step(n); shoot(e.pos, 320, 340, 0.6); }
    return strip(`10 playing dead -> reboot: eyes back on, rises the wrong way, its kill counted once`);
  },
};
for (const [name, fn] of Object.entries(shots)) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  const url = await page.evaluate(`(() => { const A = ${JSON.stringify(A)}, Bp = ${JSON.stringify(Bp)}; return (${fn.toString()})(window.__bh); })()`);
  save(name, url); console.log('behaviour-shots:', name);
}
save('sheet', await page.evaluate(() => window.__bh.sheet()));
console.log(`behaviour-shots: ${Object.keys(shots).length} strips and sheet.png in ${OUT}${errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''}`);
await b.close(); srv.close?.();
process.exit(0);

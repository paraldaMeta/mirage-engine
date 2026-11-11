#!/usr/bin/env node
// Stills for the realism pass (robots, cars, civilians): each subject posed and shot from several sides, at night,
// dusk and day. The enemies are taken out of play (inactive), put in a line on the street and posed by hand (a
// walk at a phase, the aim, a hound's trot, crouch and leap); the civilians and the cars are shot where they stand.
//   node scripts/realism.mjs [--only robots|cars|civ|compare] [--time dusk,night,day] [--out out/realism] [--game 1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(flag('out', path.join(here, '../out/realism'))), W = +flag('w', 1280), H = +flag('h', 800), Q = flag('quality', 'high');
const only = flag('only', 'robots,cars,civ,compare').split(','), times = flag('time', 'dusk').split(','), match = flag('match', '');
fs.mkdirSync(OUT, { recursive: true });

// ---- the shots. pose(): runs in the page with (m, E, put, ...) and returns nothing; eye / look in world metres
const L = [-8, 0, 6.2];   // the line-up's centre on the street
const at = (dx, dz = 0) => [L[0] + dx, 0, L[2] + dz];
const robots = [];
const ROBOTS = [['grunt', 'g1'], ['heavy', 'g3'], ['shield', 'g11'], ['marksman', 'g12'], ['hound', 'h0'], ['hauler', 'h1']];
for (const [name, id] of ROBOTS) {
  const dog = name === 'hound' || name === 'hauler', h = dog ? 0.45 : 1.15, d = dog ? 1.3 : 1.6;
  for (const [side, a] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI], ['three', 0.7]]) {
    robots.push({ name: `robot-${name}-${side}`, ids: [id], place: [[id, at(0), 0]], pose: dog ? 'trot' : 'idle', eye: [L[0] + Math.sin(a) * d, h + 0.15, L[2] + Math.cos(a) * d], look: [L[0], h, L[2]] });
  }
  robots.push({ name: `robot-${name}-${dog ? 'trot' : 'walk'}`, ids: [id], place: [[id, at(0), 0]], pose: dog ? 'trot' : 'walk', phase: 0.3, eye: [L[0] + 2.0, h + 0.1, L[2] + 0.9], look: [L[0], h * 0.85, L[2]] });
  robots.push({ name: `robot-${name}-${dog ? 'lunge' : 'aim'}`, ids: [id], place: [[id, at(0), 0]], pose: dog ? 'lunge' : 'aim', eye: [L[0] + 1.2, h + 0.2, L[2] + 1.6], look: [L[0], h, L[2]] });
}
robots.push({ name: 'robot-walk-sequence', ids: ['g1', 'g2', 'g4', 'g5'], place: [['g1', at(-1.5), Math.PI], ['g2', at(-0.5), Math.PI], ['g4', at(0.5), Math.PI], ['g5', at(1.5), Math.PI]], pose: 'walkseq', eye: [L[0] + 0.0, 1.0, L[2] - 4.2], look: [L[0], 0.8, L[2]] });
robots.push({ name: 'robot-walk-side-sequence', ids: ['g1', 'g2', 'g4', 'g5'], place: [['g1', at(-2.4), Math.PI / 2], ['g2', at(-0.8), Math.PI / 2], ['g4', at(0.8), Math.PI / 2], ['g5', at(2.4), Math.PI / 2]], pose: 'walkseq', eye: [L[0], 0.9, L[2] - 4.0], look: [L[0], 0.75, L[2]] });
robots.push({ name: 'robot-lineup', ids: ROBOTS.map((r) => r[1]), place: ROBOTS.map(([, id], i) => [id, at(3 - i * 1.2), Math.PI]), pose: 'idle', eye: [L[0], 1.3, L[2] - 5.0], look: [L[0], 0.8, L[2]] });

const SHOTS = { robots, cars: [], civ: [], compare: [] };
// ---- the cars (plan.cars: [x, z, rotY]); `car(i, eye-offset in the car's frame, look offset)` resolves in the page
const CARS = [[-21.5, 7.3, 0.03], [2.5, 4.7, 3.12], [22, 7.25, -0.04]];
// (the road is on each car's -z side: the cameras stand there, clear of the pavement's clutter)
const carShot = (i, name, e, l) => { const [x, z, r] = CARS[i], c = Math.cos(r), s = Math.sin(r), w = ([a, y, b]) => [x + a * c - b * s, y, z - a * s - b * c]; return { name: `car${i}-${name}`, eye: w(e), look: w(l) }; };
for (const i of [0, 1, 2]) {
  SHOTS.cars.push(carShot(i, 'front34', [3.6, 1.35, 2.6], [0, 0.7, 0]), carShot(i, 'rear34', [-3.6, 1.35, 2.4], [0, 0.7, 0]), carShot(i, 'side', [0, 1.0, 4.4], [0, 0.75, 0]),
    carShot(i, 'top', [0.2, 4.6, 0.6], [0, 0.6, 0]), carShot(i, 'wheel-f', [1.45, 0.45, 1.75], [1.45, 0.38, 0.9]), carShot(i, 'wheel-r', [-1.45, 0.45, 1.75], [-1.45, 0.38, 0.9]),
    carShot(i, 'nose', [4.4, 0.9, 0], [0, 0.7, 0]), carShot(i, 'tail', [-4.4, 0.95, 0], [0, 0.8, 0]), carShot(i, 'beads', [0.4, 1.5, 0.75], [0.2, 1.05, 0.55]),
    carShot(i, 'canopy-side', [-0.3, 1.05, 2.3], [-0.3, 0.85, 0]), carShot(i, 'canopy-top', [-0.25, 2.9, 0.15], [-0.3, 0.8, 0]), carShot(i, 'canopy-34', [0.9, 1.6, 1.8], [-0.3, 0.85, 0]));
}
// ---- the civilians: where they stand (the machines' own `where`)
// unit: a machines unit id (machineUnits); a: the camera's angle from the unit's front; d, h: distance and height
for (const [u, d, h, look] of [['pedestrian-0', 1.5, 1.2, 0.85], ['pedestrian-2', 1.5, 1.2, 0.85], ['pedestrian-5', 1.5, 1.2, 0.85], ['walker-0', 1.6, 1.2, 0.85], ['walker-1', 1.6, 1.2, 0.85], ['courier-0', 1.3, 0.75, 0.4],
  ['sweeper-0', 1.5, 0.8, 0.25], ['totem-0', 2.0, 1.6, 1.5], ['broken-0', 1.4, 0.8, 0.4], ['broken-1', 1.4, 0.8, 0.4], ['vendor-0', 1.4, 1.5, 1.25], ['vendor-1', 1.4, 1.5, 1.25]]) {
  for (const [side, a] of [['front', 0.35], ['side', 1.57], ['back', 2.9]]) SHOTS.civ.push({ name: `civ-${u}-${side}`, unit: u, a, d, h, lookH: look });
}
// ---- the comparison: a sentinel posed beside a civilian
SHOTS.compare.push({ name: 'compare-sentinel-civilian', ids: ['g1'], place: [['g1', 'civ', 0]], pose: 'idle', civ: true });

const srv = await serve(path.join(here, '../dist')), b = await launch({ w: W, h: H });
let n = 0;
for (const time of times) {
  const game = only.some((o) => o === 'robots' || o === 'compare') || flag('game', '0') === '1';
  const q = `w=${W}&h=${H}&ui=0&hud=0&grain=0&quality=${Q}&time=${time}&fullscreen=0` + (game ? '&start=1&assist=1' : '&world=1');
  const { page, errors } = await open(b, `${srv.url}?${q}`);
  await page.waitForFunction(() => window.__mirage && window.__mirage.play && (!window.__mirage.game || window.__mirage.game.enemies), { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  for (const kind of only) for (const s of SHOTS[kind] || []) {
    if (match && !match.split(',').some((k) => s.name.includes(k))) continue;
    const png = await page.evaluate(async (s) => {
      const m = window.__mirage, { play, world } = m, E = m.game?.enemies;
      play.stop();
      // the subjects: out of play, placed, posed
      let civAt = null;
      if (s.civ) { const g = world.scene.getObjectByName('machines'); civAt = g?.userData.where('stand', 2) || [-16, 0.14, 10.8]; }
      if (E) for (const e of E.list) if (e.__shot && !(s.ids || []).includes(e.id)) { e.rig.root.visible = false; e.__shot = false; }
      if (E && s.place) {
        for (const e of E.list) if (s.ids.includes(e.id)) e.__shot = true;
        for (const e of E.list) if (s.ids.includes(e.id)) { e.active = false; e.dead = false; e.rig.root.visible = true; e.rig.root.scale.setScalar(e.K.scale); }
        for (let [id, p, yaw] of s.place) {
          const e = E.list.find((x) => x.id === id); if (!e) continue;
          const P = p === 'civ' ? [civAt[0] + 0.95, civAt[1], civAt[2]] : p;
          if (p === 'civ') yaw = Math.sign(6 - civAt[2]) > 0 ? 0 : Math.PI;
          e.pos = P.slice(); e.yaw = yaw; e.rig.root.position.set(...P); e.rig.root.rotation.y = yaw; e.heading = [Math.sin(yaw), Math.cos(yaw)];
          e.lod = -1; for (const [i, set] of (e.sets || []).entries()) for (const mm of set) mm.visible = i === 0;
          const A = e.anim; A.reset?.();
          const k = s.place.findIndex((x) => x[0] === id);
          if (e.dog) {
            Object.assign(e.pose, { speed: s.pose === 'trot' ? 2.2 : 0, dist: 0.37 + k * 0.1, crouch: 0, leap: s.pose === 'lunge' ? 0.45 : 0, dead: 0, aim: 0 });
            A.update(0.016);
          } else {
            A.set('dead', false).set('speed', 0).set('rate', 1).setLayerWeight('aim', s.pose === 'aim' ? 1 : 0).setLayerWeight('scan', 0); e.watch = 0;
            const sp = s.pose === 'walk' || s.pose === 'walkseq' ? 1.5 : 0, steps = s.pose === 'walkseq' ? 6 + k * 8 : s.pose === 'walk' ? Math.round((s.phase || 0) * 30) + 30 : 10;
            A.set('speed', sp); for (let i = 0; i < steps; i++) A.update(1 / 30);
          }
          e.rig.root.updateMatrixWorld(true);
        }
      }
      let eye = s.eye, look = s.look;
      if (s.civ) { const k = Math.sign(6 - civAt[2]) || 1; eye = [civAt[0] + 0.45, civAt[1] + 1.25, civAt[2] + k * 2.6]; look = [civAt[0] + 0.45, civAt[1] + 0.85, civAt[2]]; }
      if (s.unit) {
        const g = world.scene.getObjectByName('machines'), u = g?.userData.units?.().find((x) => x.id === s.unit); if (!u) return null;
        const P = new m.world.camera.position.constructor().setFromMatrixPosition(u.frame), e = u.frame.elements, yaw = Math.atan2(e[8], e[10]) + s.a;
        const base = u.kind === 'vendor' ? P.y - 1.2 : u.kind === 'courier' ? P.y - 0.4 : u.kind === 'sweeper' || u.kind === 'totem' ? P.y : P.y - 0.75;
        eye = [P.x + Math.sin(yaw) * s.d, base + s.h, P.z + Math.cos(yaw) * s.d]; look = [P.x, base + s.lookH, P.z];
      }
      play.place(eye, look, 'fly'); play.step(1 / 60);
      const vm = world.scene.getObjectByName('viewmodel'); if (vm) vm.visible = false;
      if (E && s.place) for (const e of E.list) if (s.ids.includes(e.id)) { e.rig.root.position.set(...e.pos); e.rig.root.rotation.y = e.yaw; }
      for (let i = 0; i < 24 || (world.lighting?.busy && i < 400); i++) play.render({ moving: true });
      play.render({ moving: false, spp: 4, frameIndex: 1 });
      return document.querySelector('canvas').toDataURL('image/png');
    }, s).catch((err) => { console.log('fail ' + s.name + ': ' + err.message.slice(0, 200)); return null; });
    if (png) { fs.writeFileSync(path.join(OUT, `${s.name}-${time}.png`), Buffer.from(png.split(',')[1], 'base64')); n++; }
  }
  if (errors.length) console.log('page errors: ' + errors.slice(0, 3).join(' | '));
  await page.close();
}
console.log(`realism: ${n} stills in ${OUT}`);
await b.close(); srv.close?.();
process.exit(0);

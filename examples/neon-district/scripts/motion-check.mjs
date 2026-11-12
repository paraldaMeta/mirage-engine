#!/usr/bin/env node
// Measure: how the view moves that the player did not ask for (NOTES.md "Comfort"). The real game in headless Chrome,
// a scripted 20 s run with no look input at all: walk, sprint, strafe, fire each of the five guns, take three hits,
// dash, a rocket into the ground nearby. Every rendered frame the final camera is recorded (after the gun's offsets:
// shake, flinch, roll, bob, dip, the field-of-view punch). Then a turn test: the mouse turning at a steady rate (a
// synthetic 1000 Hz mouse, 5 px an event) with the display at 50, 60 and 120 Hz, sensitivity 1 and 2.5: how evenly
// the view advances frame to frame.
// Reported per comfort preset (and for a build given as BEFORE=<dist>: the game before the comfort pass):
//   angular velocity of the camera, peak and RMS (deg/s; none of it from look input), the part from the offsets alone,
//   the offsets' peak (shake + flinch, deg), the peak roll (deg), the field of view's peak punch (deg over the base),
//   the head bob's vertical peak-to-peak (cm) and frequency (Hz) walking and sprinting, the recoil climb (deg) and,
//   for the turn test, how far the camera's heading is from what the mouse had sent by that frame (deg).
// Gates (the default, comfort): offsets' peak <= 1.5 deg, roll <= 0.05 deg outside the lean, punch <= 1 deg, bob <= 2 cm,
// nothing the player did not cause still moving the view 150 ms after its cause has stopped (offsets < 0.1 deg),
// the camera within 0.3 deg of the mouse on every frame.
// usage: node scripts/motion-check.mjs [dist]   BEFORE=<old dist> adds its column; PRESETS=comfort,standard,intense
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1280, H = 720, D = 180 / Math.PI;
const PRESETS = (process.env.PRESETS || 'comfort,standard,intense').split(',');

async function open(b, srv, query, hz = 0) {
  const page = await b.newPage(), errors = [];
  await page.evaluateOnNewDocument((hz) => {
    localStorage.removeItem('mirage:neon-district:settings');
    if (hz) {   // a display at hz: animation frames on a timer of that period (the game caps itself at 60)
      const T = 1000 / hz; let next = performance.now();
      window.requestAnimationFrame = (cb) => { next = Math.max(next + T, performance.now() + 0.5); return setTimeout(() => cb(performance.now()), next - performance.now()); };
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  }, hz);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.url}?grain=0&assist=1&quality=medium&start=1&lang=en&w=${W}&h=${H}&${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(800);
  await page.evaluate(() => {
    const m = window.__mirage;
    for (const e of m.game.enemies.list) m.game.enemies.park?.(e);
    for (const e of m.game.drones.list) m.game.drones.park?.(e);
    // the recorder: after the gun's own per-frame pose (registered later, so it runs after), once a frame
    const cam = m.world.camera, rec = window.__rec = [];
    let last = -1;
    m.world.ctx.onUpdate(() => {
      const t = performance.now();
      if (t - last < 2) return;
      last = t;
      const e = cam.matrixWorld.elements, S = m.game.weapon.S;
      rec.push([t, -e[8], -e[9], -e[10], e[4], e[5], e[6], e[12], e[13], e[14], m.play.yaw, m.play.pitch, cam.fov, m.game.player.speed, S.lean, m.game.player.feet[1], m.game.player.height, S.shake, S.flinchP, S.bobY ?? NaN, window.__px || 0]);
    });
  });
  return { page, errors };
}

/** the scripted run: no look input, only what a player does with the keys */
async function run(page) {
  const k = page.keyboard, mark = (s) => page.evaluate((s) => { window.__marks = window.__marks || []; window.__marks.push([performance.now(), s]); }, s);
  await page.evaluate(() => { const m = window.__mirage, s = m.built.plan.spawn; m.play.place(s.eye, s.look, 'walk'); window.__rec.length = 0; });
  await k.press('Digit0'); await sleep(300);
  await mark('walk'); await k.down('KeyW'); await sleep(3000);
  await mark('sprint'); await k.down('ShiftLeft'); await sleep(2500); await k.up('ShiftLeft');
  await k.up('KeyW');
  await mark('strafe'); await k.down('KeyA'); await sleep(1200); await k.up('KeyA'); await k.down('KeyD'); await sleep(1200); await k.up('KeyD');
  await mark('stand'); await sleep(600);
  for (const [slot, ms] of [[1, 900], [2, 1300], [3, 1700], [5, 2200]]) {
    await k.press(`Digit${slot}`); await sleep(650);
    await mark('fire' + slot); await k.down('KeyF'); await sleep(ms); await k.up('KeyF');
    await mark('after' + slot); await sleep(500);
  }
  await mark('hits');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => { const m = window.__mirage, f = m.game.player.feet; m.game.player.hurt(9, [f[0] + 4, f[1] + 1, f[2] - 2]); }); await sleep(450); }
  await mark('dash'); await page.evaluate(() => window.__mirage.game.kit.abilities.use('dash')); await sleep(900);
  // a rocket into the street 4-5 m ahead
  await k.press('Digit4'); await sleep(800);
  await page.evaluate(() => { window.__mirage.play.pitch = -0.42; });
  await sleep(200);
  await mark('rocket'); await k.press('KeyF'); await sleep(1600);
  await mark('end');
  return page.evaluate(() => ({ rec: window.__rec.slice(), marks: window.__marks.slice() }));
}

const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
function analyse({ rec, marks }) {
  const seg = (t) => { let s = ''; for (const [mt, name] of marks) if (t >= mt) s = name; return s; };
  const f = rec.map((r) => {
    const fw = [r[1], r[2], r[3]], up = [r[4], r[5], r[6]], base = [Math.cos(r[11]) * Math.cos(r[10]), Math.sin(r[11]), Math.cos(r[11]) * Math.sin(r[10])];
    const right = norm(cross(fw, [0, 1, 0])), up0 = cross(right, fw);
    const roll = Math.atan2(dot(cross(up0, up), fw), dot(up0, up));
    return { t: r[0], fw, base, roll, pos: [r[7], r[8], r[9]], fov: r[12], speed: r[13], lean: r[14], eyeRel: r[8] - r[15] - r[16], bobY: r[19], seg: seg(r[0]), pitch: r[11], yaw: r[10] };
  }).filter((x) => x.seg && x.seg !== 'end');
  const vel = [], offVel = [], offs = [], rolls = [];
  for (let i = 1; i < f.length; i++) {
    const dt = (f[i].t - f[i - 1].t) / 1000; if (dt <= 0) continue;
    const off = (x) => ang(x.fw, x.base);
    if (ang(f[i].base, f[i - 1].base) > 0.08) continue;   // the script's own jumps (place, the pitch set for the rocket)
    vel.push(Math.hypot(ang(f[i].fw, f[i - 1].fw), f[i].roll - f[i - 1].roll) / dt * D);
    offVel.push(Math.abs(off(f[i]) - off(f[i - 1])) / dt * D);
  }
  for (const x of f) { offs.push(ang(x.fw, x.base) * D); if (Math.abs(x.lean) < 0.01) rolls.push(Math.abs(x.roll) * D); }
  // the field of view's punch: over the lowest field of view in the same stretch (aiming never happens here)
  let punch = 0;
  for (const s of new Set(f.map((x) => x.seg))) { const fs = f.filter((x) => x.seg === s).map((x) => x.fov); punch = Math.max(punch, Math.max(...fs) - Math.min(...fs)); }
  // the bob: the eye's height over the feet, less its own 0.6 s mean, walking and sprinting
  const bob = (name) => {
    const xs = f.filter((x) => x.seg === name && x.speed > 1).slice(20);
    if (xs.length < 30) return { pp: 0, hz: 0 };
    // the gun's own bob offset where the build reports it (S.bobY), else the eye over the feet less its 0.6 s mean
    // (which also holds the steps and kerbs the walk crosses)
    const own = xs.every((x) => Number.isFinite(x.bobY));
    const y = own ? xs.map((x) => x.bobY) : xs.map((x, i) => { const w = xs.slice(Math.max(0, i - 18), i + 18); return x.eyeRel - w.reduce((s, v) => s + v.eyeRel, 0) / w.length; });
    if (own) { const m = y.reduce((s, v) => s + v, 0) / y.length; for (let i = 0; i < y.length; i++) y[i] -= m; }
    let crossings = 0; for (let i = 1; i < y.length; i++) if (Math.sign(y[i]) !== Math.sign(y[i - 1]) && y[i] !== 0) crossings++;
    const sec = (xs[xs.length - 1].t - xs[0].t) / 1000;
    return { pp: (Math.max(...y) - Math.min(...y)) * 100, hz: crossings / 2 / sec };
  };
  // recoil: the pitch's rise during each burst (no look input: all of it is the gun's), and its tail after the trigger
  let climb = 0;
  for (const s of ['fire1', 'fire2', 'fire3', 'fire5']) { const ps = f.filter((x) => x.seg === s).map((x) => x.pitch); if (ps.length) climb = Math.max(climb, (Math.max(...ps) - ps[0]) * D); }
  // what still moves 150 ms after its cause stopped (a trigger let go, a hit, the dash, the blast): offsets over 0.1 deg
  let tail = 0;
  for (const [i, [mt, name]] of marks.entries()) {
    if (!/^(after|dash$|rocket$)/.test(name) && name !== 'hits') continue;
    // from the cause's end (the trigger let go; the last of the three hits; the dash's 0.2 s; the rocket's flight,
    // about 0.15 s to the street) to the next thing the script does
    const end = marks[i + 1]?.[0] ?? Infinity, from = mt + (name === 'hits' ? 900 : name === 'rocket' ? 300 : name === 'dash' ? 200 : 0);
    const xs = f.filter((x) => x.t > from && x.t < end);
    let lastBig = 0; for (const x of xs.slice(0, 200)) if (ang(x.fw, x.base) * D > 0.1) lastBig = x.t;
    if (lastBig) tail = Math.max(tail, lastBig - (xs[0]?.t ?? lastBig));
  }
  return {
    peakVel: Math.max(...vel), rmsVel: rms(vel), peakOffVel: Math.max(...offVel), rmsOffVel: rms(offVel), offPeak: Math.max(...offs), offRms: rms(offs),
    rollPeak: Math.max(...rolls), punch, walk: bob('walk'), sprint: bob('sprint'), climb, tail, frames: f.length,
  };
}

/** a steady turn: a synthetic 1000 Hz mouse, 5 px an event, for 3 s, at a display of hz. Every rendered frame the
 *  camera's heading is compared with what the mouse had sent by then (heading0 + px x 0.0022 x sens): the error is
 *  the look landing late or unevenly (a turn rescaled in the game's fixed tick showed unscaled on a frame without a
 *  tick). Returns the RMS and the largest error in degrees, and the spread of the per-frame turn (RMS / mean, %). */
async function turnJitter(b, srv, hz, sens, extra = '') {
  const { page } = await open(b, srv, `sens=${sens}&${extra}`, hz);
  await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction('!!document.pointerLockElement', { timeout: 3000 }).catch(() => {});
  await sleep(300);
  const out = await page.evaluate(() => new Promise((done) => {
    const rec = window.__rec; window.__px = 0; rec.length = 0;
    const id = setInterval(() => { window.__px += 5; document.dispatchEvent(new MouseEvent('mousemove', { movementX: 5, movementY: 0, bubbles: true })); }, 1);
    setTimeout(() => { clearInterval(id); done(rec.slice()); }, 3000);
  }));
  await page.close();
  const rows = out.slice(5).map((r) => ({ t: r[0], h: Math.atan2(r[3], r[1]), px: r[20] }));
  // the heading is unwrapped against what the mouse had sent (not against the frame before): at 5000 px/s a frame
  // that comes 114 ms late (sens 2.5; 285 ms at sens 1: a shader compiled as a new robot turns into view) turns the
  // view more than half a circle, and unwrapping frame to frame then books whole turns as error (the 997 deg the
  // check reported after the cars and robots went in: a measurement fault, the camera was on the mouse)
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const hs = rows.map((r) => { const want = rows[0].h + (r.px - rows[0].px) * 0.0022 * sens; return want + wrap(r.h - want); });
  const err = rows.map((r, i) => (hs[i] - hs[0] - (r.px - rows[0].px) * 0.0022 * sens) * D);
  const gap = rows.reduce((m, r, i) => (i ? Math.max(m, r.t - rows[i - 1].t) : m), 0);
  if (process.env.VERBOSE) console.log(`turn ${hz} Hz, sens ${sens}: ${rows.length} frames, the longest gap ${gap.toFixed(0)} ms, largest error ${Math.max(...err.map(Math.abs)).toFixed(3)} deg`);
  const steps = []; for (let i = 1; i < rows.length; i++) { const dt = (rows[i].t - rows[i - 1].t) / 1000; if (dt > 0) steps.push((hs[i] - hs[i - 1]) / dt); }
  const mean = steps.reduce((a, v) => a + v, 0) / steps.length;
  return { err: rms(err), errMax: Math.max(...err.map(Math.abs)), spread: Math.abs(rms(steps.map((v) => v - mean)) / mean) * 100 };
}

const cols = [];
async function measure(label, root, query) {
  const srv = await serve(root), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, srv, query);
  const a = analyse(await run(page));
  await page.close();
  const j = {};
  for (const hz of [50, 60, 120]) for (const sens of [1, 2.5]) j[`${hz}/${sens}`] = await turnJitter(b, srv, hz, sens, query);
  await b.close(); srv.close?.();
  cols.push({ label, a, j, errors });
}
if (process.env.BEFORE) await measure('before', path.resolve(process.env.BEFORE), '');
for (const p of PRESETS) await measure(p, dist, `comfort=${p}`);

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) : '-');
const rowsOut = [
  ['camera angular velocity, peak (deg/s)', (c) => c.a.peakVel], ['camera angular velocity, RMS (deg/s)', (c) => c.a.rmsVel],
  ['offsets\' angular velocity, peak (deg/s)', (c) => c.a.peakOffVel], ['offsets\' angular velocity, RMS (deg/s)', (c) => c.a.rmsOffVel],
  ['shake + flinch offset, peak (deg)', (c) => c.a.offPeak], ['shake + flinch offset, RMS (deg)', (c) => c.a.offRms],
  ['roll outside the lean, peak (deg)', (c) => c.a.rollPeak], ['field-of-view punch, peak (deg)', (c) => c.a.punch],
  ['recoil climb in a burst, peak (deg)', (c) => c.a.climb], ['offsets > 0.1 deg after the cause (ms)', (c) => c.a.tail],
  ['head bob walking, peak-to-peak (cm)', (c) => c.a.walk.pp], ['head bob walking (Hz)', (c) => c.a.walk.hz],
  ['head bob sprinting, peak-to-peak (cm)', (c) => c.a.sprint.pp], ['head bob sprinting (Hz)', (c) => c.a.sprint.hz],
  ...['50/1', '60/1', '120/1', '50/2.5', '60/2.5', '120/2.5'].map((k) => [`look vs mouse, ${k.replace('/', ' Hz, sens ')}: largest error (deg)`, (c) => c.j[k].errMax]),
  ...['60/1', '60/2.5'].map((k) => [`look vs mouse, ${k.replace('/', ' Hz, sens ')}: RMS error (deg)`, (c) => c.j[k].err]),
];
console.log(`| measure | ${cols.map((c) => c.label).join(' | ')} |\n|---|${cols.map(() => '---:').join('|')}|`);
for (const [name, fn] of rowsOut) console.log(`| ${name} | ${cols.map((c) => f1(fn(c))).join(' | ')} |`);
let failed = 0;
const gate = (ok, what) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const c = cols.find((x) => x.label === 'comfort');
if (c) {
  gate(c.a.offPeak <= 1.5, `comfort: shake + flinch offset peak ${f1(c.a.offPeak)} deg <= 1.5`);
  gate(c.a.rollPeak <= 0.05, `comfort: roll outside the lean ${f1(c.a.rollPeak)} deg <= 0.05`);
  gate(c.a.punch <= 1.01, `comfort: field-of-view punch ${f1(c.a.punch)} deg <= 1`);
  gate(c.a.walk.pp <= 2 && c.a.sprint.pp <= 2, `comfort: head bob ${f1(c.a.walk.pp)} / ${f1(c.a.sprint.pp)} cm <= 2`);
  gate(c.a.tail <= 150, `comfort: offsets still over 0.1 deg ${f1(c.a.tail)} ms after their cause <= 150`);
  const worst = Math.max(...Object.values(c.j).map((x) => x.errMax));
  gate(worst <= 0.3, `comfort: the camera follows the mouse on the frame (largest error at 50 / 60 / 120 Hz, sens 1 / 2.5: ${f1(worst)} deg <= 0.3)`);
}
for (const x of cols) gate(x.errors.length === 0, `${x.label}: no console errors ${x.errors[0] || ''}`);
console.log(`\nmotion-check: ${failed ? failed + ' FAILED' : 'all gates passed'}`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Check: the view never sticks at the top (the owner's playtest: "if I carelessly look up, the view gets stuck
// looking up"). In the real Chrome with real input events over the DevTools protocol: look fully up, hold, look
// down; the pitch must follow the input and come back below the horizon, and the camera must point where the pitch
// says (the shake, flinch and recoil offsets on it never drift the aim).
//   mouse   pointer lock and CDP mouse moves (movementX / Y as a real mouse gives them), long looks in strokes with
//           the pointer let go and captured again in between; invert off / on x sensitivity 0.3 / 1 / 2.5 x each of
//           the five guns, the trigger held through the look and not; then, per invert x sensitivity: after a hit,
//           after a dash, after a checkpoint is loaded (the saved pitch comes back as saved), after the options
//           (pause) and back, after the pointer is let go (as leaving full screen does) and captured again; a burst of
//           one huge movementY right on capture (the browsers' pointer-lock glitch) is not a look
//   touch   a phone (844 x 390) and a tablet (1180 x 820): a finger on the look area (CDP multi-touch), invert x
//           sensitivity, the FIRE button held by a second finger and not; a look finger cancelled by the system
//           (pointercancel) leaves no look behind
//   pad     an injected Gamepad API pad: standard mapping (right stick up, hold, down) for invert x sensitivity; a
//           non-standard device whose axes 2 / 3 rest at -1 (triggers, a wheel's pedals) and a standard pad with
//           stick drift beyond the dead zone and one resting at full deflection: the view must not climb by itself
// usage: node scripts/look-check.mjs [dist]     ONLY=mouse,touch,pad,extra    (build first: npm run build -w neon-district)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let failed = 0;
const want = (part) => !process.env.ONLY || process.env.ONLY.split(',').includes(part);
const check = (part, name, ok, info = '') => { rows.push(`${ok ? 'pass' : 'FAIL'}  ${part}/${name}  ${info}`); if (!ok) failed++; if (process.env.VERBOSE || !ok) console.log(rows[rows.length - 1]); };
const TOP = 1.45, MOUSE_K = 0.0022, TOUCH_K = 0.0062, PAD_RATE = 2.6;
const SENS = (process.env.SENS || '0.3,1,2.5').split(',').map(Number), INVERT = [false, true];
const GUNS = ['sidearm', 'carbine', 'shotgun', 'rocket', 'gatling'];

async function open(browser, { w = 1280, h = 720, mobile = false, pad = null, opts = {}, query = '' } = {}) {
  const page = await browser.newPage(), errors = [];
  if (mobile) await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: w > h });
  await page.evaluateOnNewDocument((o, pad) => {
    localStorage.setItem('mirage:neon-district:settings', JSON.stringify({ nd: o }));
    if (pad) {
      window.__pad = { mapping: pad.mapping, axes: pad.axes.slice(), buttons: new Array(17).fill(0) };
      navigator.getGamepads = () => [{ id: pad.id, index: 0, connected: true, mapping: window.__pad.mapping, timestamp: performance.now(),
        axes: window.__pad.axes.slice(), buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
    }
  }, opts, pad);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.url}?grain=0&assist=1&quality=low&start=1&w=${w}&h=${h}&${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(600);
  // nobody shoots the tester: the robots stay parked (a hit is a case of its own)
  await page.evaluate(() => { const m = window.__mirage; for (const e of m.game.enemies.list) m.game.enemies.park?.(e); for (const e of m.game.drones.list) m.game.drones.park?.(e); });
  return { page, errors };
}
/** the pitch the game holds, and the one the camera shows (its forward's elevation) */
const view = (page) => page.evaluate(() => {
  const m = window.__mirage, d = m.world.camera.getWorldDirection(new m.world.camera.position.constructor());
  return { pitch: m.play.pitch, cam: Math.asin(Math.max(-1, Math.min(1, d.y))), yaw: m.play.yaw, paused: m.g.game.paused, lock: !!document.pointerLockElement, gun: m.game.weapon.id, shots: m.g.game.flags['shots_' + m.game.weapon.id] || 0 };
});
const setPitch = (page, p) => page.evaluate((p) => { const m = window.__mirage; m.play.pitch = p; m.game.resetLook?.(); }, p);

// ---- the mouse: pointer lock, strokes of real moves; between strokes the pointer is let go and captured again
async function lockAt(page, x, y) {
  // letting the pointer go opens the engine's pause menu (as Escape does): Resume, then a click captures it again
  await page.evaluate(() => document.exitPointerLock()); await sleep(60);
  await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); }); await sleep(30);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction('!!document.pointerLockElement', { timeout: 3000, polling: 20 }).catch(() => {});
  await sleep(60);
}
/** move the mouse by dy px in total (negative: up), the mouse held still for `fire` with the button down */
async function mouseLook(page, dy, { W = 1280, H = 720, fire = false } = {}) {
  let left = dy;
  while (Math.abs(left) > 0.5) {
    const span = H - 80, step = Math.sign(left) * Math.min(Math.abs(left), span), y0 = step < 0 ? H - 40 : 40;
    await lockAt(page, W / 2, y0);
    if (fire) await page.mouse.down();
    const n = Math.max(4, Math.ceil(Math.abs(step) / 30));
    for (let i = 1; i <= n; i++) { await page.mouse.move(W / 2, y0 + step * i / n); await sleep(10); }
    if (fire) await page.mouse.up();
    left -= step;
  }
}
/** the case: look fully up (by twice what reaches the top), hold, look down by what should end at `end` rad */
async function mouseCase(page, part, name, { sens, invert, fire = false, end = -0.3, W, H, before }) {
  const sgn = invert ? -1 : 1, k = MOUSE_K * sens;
  await setPitch(page, 0); await sleep(100);
  if (before) await before();
  await mouseLook(page, -sgn * (2 * TOP / k), { W, H, fire });
  if (fire) { await page.mouse.down(); await sleep(400); await page.mouse.up(); }
  await sleep(400);
  const up = await view(page);
  await sleep(fire ? 900 : 200);   // a burst's climb comes back by itself
  const top = await view(page);
  await mouseLook(page, sgn * ((top.pitch - end) / k), { W, H });
  await sleep(250);
  const v = await view(page);
  const ok = up.pitch > 1.3 && v.pitch < 0 && Math.abs(v.pitch - end) < 0.12 && Math.abs(v.cam - v.pitch) < 0.1 && Number.isFinite(v.pitch);
  check(part, name, ok, `up ${up.pitch.toFixed(3)}, top ${top.pitch.toFixed(3)}, down ${v.pitch.toFixed(3)} (want ${end}), camera ${v.cam.toFixed(3)}${fire ? `, shots ${v.shots}` : ''}`);
  return v;
}
if (want('mouse') || want('extra')) {
  const W = 1280, H = 720;
  for (const invert of INVERT) for (const sens of SENS) {
    const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
    const { page, errors } = await open(b, { w: W, h: H, opts: { sens, invert, unlocked: true } });
    const tag = `invert ${invert ? 'on' : 'off'}, sens ${sens}`;
    if (want('mouse')) for (const gun of GUNS) for (const fire of [false, true]) {
      await page.keyboard.press(`Digit${GUNS.indexOf(gun) + 1}`); await sleep(700);
      await page.evaluate(() => { const S = window.__mirage.game.weapon.S; S.mag = 999; });
      await mouseCase(page, 'mouse', `${tag}, ${gun}${fire ? ', firing' : ''}`, { sens, invert, fire, W, H });
    }
    if (want('extra')) {
      await page.keyboard.press('Digit2'); await sleep(600);
      await mouseCase(page, 'extra', `${tag}, after a hit`, { sens, invert, W, H, before: () => page.evaluate(() => { const m = window.__mirage, f = m.game.player.feet; m.game.player.hurt(14, [f[0] + 3, f[1] + 1, f[2] + 1]); }) });
      await mouseCase(page, 'extra', `${tag}, after a dash`, { sens, invert, W, H, before: async () => { await page.evaluate(() => { const k = window.__mirage.game.kit.abilities; k.reset(); k.use('dash'); }); await sleep(400); } });
      // a checkpoint: saved looking down at -0.5; looked up; a death loads it: the saved pitch comes back as saved
      await setPitch(page, -0.5); await sleep(150);
      await page.evaluate(() => window.__mirage.g.save('auto'));
      await mouseLook(page, -(invert ? -1 : 1) * (TOP / (MOUSE_K * sens)), { W, H }); await sleep(200);
      await page.evaluate(() => { window.__mirage.g.load('auto'); }); await sleep(300);
      const cp = await view(page);
      check('extra', `${tag}, a checkpoint load gives back the saved pitch`, Math.abs(cp.pitch + 0.5) < 0.02 && Math.abs(cp.cam - cp.pitch) < 0.1, `pitch ${cp.pitch.toFixed(3)} (saved -0.5), camera ${cp.cam.toFixed(3)}`);
      await mouseCase(page, 'extra', `${tag}, after a checkpoint load`, { sens, invert, W, H });
      // the options panel pauses; mouse moves while it is open are not looks; closed again, the look works
      await mouseCase(page, 'extra', `${tag}, after a pause and back`, { sens, invert, W, H, before: async () => {
        await page.keyboard.press('KeyO'); await sleep(250);
        await page.mouse.move(200, 200); await page.mouse.move(300, 600); await sleep(100);
        await page.keyboard.press('KeyO'); await sleep(250);
      } });
      // leaving full screen lets the pointer go (and the browsers often report a jump on the way back in)
      await mouseCase(page, 'extra', `${tag}, after the pointer is let go and captured again`, { sens, invert, W, H, before: async () => {
        await page.evaluate(() => document.exitPointerLock()); await sleep(150);
        await page.mouse.move(100, 100); await page.mouse.move(1100, 650); await sleep(100);
      } });
      // the glitch: on capture one mousemove of hundreds of px (Chrome on some systems, Safari on focus return)
      await setPitch(page, 0); await sleep(100);
      await lockAt(page, W / 2, H / 2);
      await page.evaluate(() => { document.dispatchEvent(new MouseEvent('mousemove', { movementX: 3, movementY: -900, bubbles: true })); });
      await sleep(150);
      const gl = await view(page);
      check('extra', `${tag}, a 900 px jump right on capture is not a look`, Math.abs(gl.pitch) < 0.3, `pitch ${gl.pitch.toFixed(3)}`);
    }
    check(want('mouse') ? 'mouse' : 'extra', `${tag}: no console errors`, errors.length === 0, errors[0] || '');
    await b.close();
  }
}

// ---- touch: CDP multi-touch on the look area (the right of the screen), a second finger on FIRE
async function fingersOf(page) {
  const cdp = await page.createCDPSession(), on = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [...on].map(([id, [x, y]]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
  const f = {
    down: (id, x, y) => { on.set(id, [x, y]); return send('touchStart'); },
    move: (id, x, y) => { on.set(id, [x, y]); return send('touchMove'); },
    up: (id) => { on.delete(id); return send(on.size ? 'touchMove' : 'touchEnd'); },
    cancel: () => { on.clear(); return send('touchCancel'); },
    async drag(id, x, y, dx, dy, ms = 200, steps = 14) { await f.down(id, x, y); for (let i = 1; i <= steps; i++) { await f.move(id, x + dx * i / steps, y + dy * i / steps); await sleep(ms / steps); } await f.up(id); },
  };
  return f;
}
const centre = (page, id) => page.evaluate((id) => { const r = document.querySelector(`.ndt [data-b="${id}"]`)?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, id);
async function touchLook(f, page, dy, W, H) {
  let left = dy;
  const x = W * 0.66, span = H * 0.6;
  while (Math.abs(left) > 0.5) {
    const step = Math.sign(left) * Math.min(Math.abs(left), span), y0 = step < 0 ? H * 0.8 : H * 0.2;
    await f.drag(1, x, y0, 0, step); await sleep(40);
    left -= step;
  }
}
if (want('touch')) {
  for (const [W, H, dev] of [[844, 390, 'phone'], [1180, 820, 'tablet']]) for (const invert of INVERT) for (const sens of SENS) {
    const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
    const { page, errors } = await open(b, { w: W, h: H, mobile: true, opts: { sens, invert } });
    const f = await fingersOf(page);
    await f.drag(1, W * 0.66, H * 0.5, 4, 0, 50, 2); await sleep(500);   // the first finger brings the touch controls up
    const tag = `${dev}, invert ${invert ? 'on' : 'off'}, sens ${sens}`, sgn = invert ? -1 : 1;
    for (const fire of [false, true]) {
      await setPitch(page, 0); await sleep(100);
      const at = fire ? await centre(page, 'fire') : null;
      if (at) await f.down(5, at[0], at[1]);
      await touchLook(f, page, -sgn * (2 * TOP / TOUCH_K), W, H); await sleep(300);
      const up = await view(page);
      if (at) await f.up(5);
      await sleep(fire ? 900 : 200);
      const top = await view(page);
      await touchLook(f, page, sgn * ((top.pitch + 0.3) / TOUCH_K), W, H); await sleep(250);
      const v = await view(page);
      check('touch', `${tag}${fire ? ', FIRE held' : ''}`, up.pitch > 1.3 && v.pitch < 0 && v.pitch > -0.75 && Math.abs(v.cam - v.pitch) < 0.1, `up ${up.pitch.toFixed(3)}, top ${top.pitch.toFixed(3)}, down ${v.pitch.toFixed(3)} (want about -0.3), camera ${v.cam.toFixed(3)}${fire ? `, shots ${v.shots}` : ''}`);
    }
    // a system gesture cancels the look finger mid-drag: nothing keeps turning, the next finger looks as usual
    await setPitch(page, 0); await sleep(100);
    await f.down(1, W * 0.66, H * 0.7); for (let i = 1; i <= 6; i++) { await f.move(1, W * 0.66, H * 0.7 - i * 15); await sleep(16); }
    await f.cancel(); await sleep(100);
    const c0 = await view(page); await sleep(500); const c1 = await view(page);
    await touchLook(f, page, sgn * (0.4 / TOUCH_K), W, H); await sleep(200);
    const c2 = await view(page);
    check('touch', `${tag}, a cancelled finger leaves no look behind`, Math.abs(c1.pitch - c0.pitch) < 0.01 && c2.pitch < c1.pitch - 0.25, `after cancel ${c0.pitch.toFixed(3)} -> ${c1.pitch.toFixed(3)} in 0.5 s, next drag ${c2.pitch.toFixed(3)}`);
    check('touch', `${tag}: no console errors`, errors.length === 0, errors[0] || '');
    await b.close();
  }
}

// ---- the pad: an injected Gamepad API
const padSet = (page, o) => page.evaluate((o) => { if (o.axes) window.__pad.axes = o.axes; for (const [k, v] of Object.entries(o.buttons || {})) window.__pad.buttons[k] = v; }, o);
if (want('pad')) {
  const W = 1280, H = 720;
  for (const invert of INVERT) for (const sens of SENS) {
    const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
    const { page, errors } = await open(b, { w: W, h: H, opts: { sens, invert }, pad: { id: 'Mirage test pad (standard)', mapping: 'standard', axes: [0, 0, 0, 0] } });
    const tag = `standard, invert ${invert ? 'on' : 'off'}, sens ${sens}`, sgn = invert ? -1 : 1, rate = PAD_RATE * sens;
    for (const fire of [false, true]) {
      await setPitch(page, 0); await sleep(100);
      await padSet(page, { axes: [0, 0, 0, -sgn], buttons: { 7: fire ? 1 : 0 } }); await sleep(Math.min(6000, 1000 * 2 * TOP / rate + 300));
      const up = await view(page);
      await padSet(page, { axes: [0, 0, 0, 0], buttons: { 7: 0 } }); await sleep(fire ? 900 : 300);
      const top = await view(page);
      await padSet(page, { axes: [0, 0, 0, sgn] }); await sleep(1000 * (top.pitch + 0.3) / rate * 1.15);
      await padSet(page, { axes: [0, 0, 0, 0] }); await sleep(200);
      const v = await view(page);
      check('pad', `${tag}${fire ? ', trigger held' : ''}`, up.pitch > 1.3 && v.pitch < 0 && v.pitch > -0.9 && Math.abs(v.cam - v.pitch) < 0.1, `up ${up.pitch.toFixed(3)}, top ${top.pitch.toFixed(3)}, down ${v.pitch.toFixed(3)} (want about -0.3), camera ${v.cam.toFixed(3)}`);
    }
    check('pad', `${tag}: no console errors`, errors.length === 0, errors[0] || '');
    await b.close();
  }
  // a pad on the desk while the player uses the mouse and keys: its right stick starts drifting (0.3 up, past the
  // dead zone) after it has been at rest; after a moment the creep must stop
  {
    const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
    const { page, errors } = await open(b, { w: W, h: H, pad: { id: 'Desk pad (standard)', mapping: 'standard', axes: [0, 0, 0, 0] } });
    await setPitch(page, 0); await sleep(300);
    await padSet(page, { axes: [0.01, 0.02, 0.04, -0.3] });
    const tap = async (ms) => { const t = Date.now(); while (Date.now() - t < ms) { await page.keyboard.press('ShiftLeft'); await sleep(150); } };
    await tap(2200); const a = await view(page); await tap(3000); const z = await view(page);
    check('pad', 'a drift that starts while the mouse and keys are in use stops creeping', Math.abs(z.pitch - a.pitch) < 0.02 && a.pitch < 0.25, `crept ${a.pitch.toFixed(3)} rad in the first 2.2 s, then ${(z.pitch - a.pitch).toFixed(3)} in 3 s`);
    await padSet(page, { axes: [0, 0, 0, 0] }); await sleep(200);
    await setPitch(page, 0); await padSet(page, { axes: [0, 0, 0, -1] }); await sleep(500); const s = await view(page); await padSet(page, { axes: [0, 0, 0, 0] });
    check('pad', 'after the drift, the stick pushed fully still looks', s.pitch > 0.6, `pitch ${s.pitch.toFixed(3)} after 0.5 s`);
    check('pad', 'desk pad: no console errors', errors.length === 0, errors[0] || '');
    await b.close();
  }
  // devices that are not a game pad, or a worn one: nobody touches anything, the view must stay where it is
  for (const [name, pad] of [
    ['a non-standard device, axes 2 and 3 resting at -1 (triggers, pedals)', { id: 'USB Joystick (Vendor: 0079 Product: 0006)', mapping: '', axes: [0, 0, -1, -1, 0, 0] }],
    ['a non-standard device, axes 2 and 3 resting at +1', { id: 'Generic HID (Vendor: 1234 Product: 5678)', mapping: '', axes: [0.004, -0.004, 1, 1] }],
    ['a standard pad with right-stick drift (0.3 up)', { id: 'Worn pad (standard)', mapping: 'standard', axes: [0.02, 0.03, 0.05, -0.3] }],
    ['a standard pad reporting the right stick pinned up from the start', { id: 'Broken pad (standard)', mapping: 'standard', axes: [0, 0, 0, -1] }],
  ]) {
    const b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
    const { page, errors } = await open(b, { w: W, h: H, pad });
    await setPitch(page, 0); await sleep(100);
    const a = await view(page); await sleep(4000); const z = await view(page);
    check('pad', `${name}: the view stays put`, Math.abs(z.pitch - a.pitch) < 0.05 && Math.abs(z.yaw - a.yaw) < 0.05, `pitch ${a.pitch.toFixed(3)} -> ${z.pitch.toFixed(3)}, yaw ${(z.yaw - a.yaw).toFixed(3)} in 4 s`);
    // the mouse still turns it down from the top
    await mouseCase(page, 'pad', `${name}: the mouse still looks up and down`, { sens: 1, invert: false, W, H });
    check('pad', `${name}: no console errors`, errors.length === 0, errors[0] || '');
    await b.close();
  }
}

srv.close?.();
const passed = rows.filter((r) => r.startsWith('pass')).length;
if (!process.env.VERBOSE) for (const r of rows) if (r.startsWith('pass')) console.log(r);
console.log(`\nlook-check: ${passed} / ${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);

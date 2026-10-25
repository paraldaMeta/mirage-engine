#!/usr/bin/env node
// A scripted playthrough of garden-quest in the real Chrome (headless, GPU on), with real input events:
//   main   walk to the key, pick it up, unlock and open the door, save, reload the page, load, enter, take the
//          taper, light the four lanterns, the "done" message; footsteps by surface, sounds, no console errors
//   pad    the same controls through an injected Gamepad API shim (stick, look, A jump, X use, Start / d-pad / B menu)
//   touch  an emulated phone (390 x 844, touch): the virtual stick, drag-look, Jump and Use buttons
// usage: node scripts/playthrough.mjs <dist dir | page.html> [--out dir] [--part main,pad,touch]
// Writes <out>/<part>-NN-step.png and <out>/report.json; exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const OUT = path.resolve(flag('out', 'out/playthrough'));
const PARTS = flag('part', 'main,pad,touch').split(',');
fs.mkdirSync(OUT, { recursive: true });
const isFile = target.endsWith('.html');
const srv = isFile ? null : await serve(target);
const base = isFile ? 'file://' + path.resolve(target) : srv.url;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { target: base, parts: {} };
let failed = 0;

async function session(part, { query = '', mobile = false, pad = false, page: reuse } = {}) {
  const steps = [];
  const W = mobile ? 390 : 1440, H = mobile ? 844 : 900;
  const browser = reuse ? null : await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
  const pages = [];
  let n = 0;
  const S = {
    browser, steps,
    async open(q = query) {
      const url = base + `?w=${W}&h=${H}&grain=0` + (q ? '&' + q : '');
      const o = await openPage(browser, url, { mobile, pad, W, H });
      pages.push(o);
      S.page = o.page; S.errors = o.errors; S.loadMs = o.loadMs;
      return o;
    },
    state: () => S.page.evaluate(() => {
      const { g } = window.__mirage, p = g.play.state();
      return { ...p, near: g.near && g.near.id, flags: g.game.flags, inv: g.game.inventory.items.map((i) => i.id), paused: g.game.paused,
        dialog: g.ui.open ? g.ui.open.className : null, prompt: document.querySelector('.mg-prompt').hidden ? null : document.querySelector('.mg-prompt').textContent,
        objective: document.querySelector('.mg-obj').textContent, audio: g.audio.stats.played, audioState: g.audio.stats.state, frames: g.play.stats.frames,
        door: window.__mirage.quest.leaves.map((l) => +l.angle.toFixed(3)) };
    }),
    async step(name, fn, check) {
      const t0 = Date.now();
      let ok = false, info = {}, err = null;
      try { await fn(); info = await S.state(); ok = !!(await check(info)); } catch (e) { err = String(e.stack || e); }
      const shot = `${part}-${String(++n).padStart(2, '0')}-${name}.png`;
      try { await S.page.screenshot({ path: path.join(OUT, shot) }); } catch { /* page gone */ }
      const row = { name, ok, ms: Date.now() - t0, shot, pos: info.pos, flags: info.flags, inv: info.inv, prompt: info.prompt, objective: info.objective, ...(err ? { err } : {}) };
      steps.push(row);
      if (!ok) failed++;
      console.log(`${ok ? 'pass' : 'FAIL'}  ${part}/${name}  ${info.pos ? info.pos.join(', ') : ''}  ${info.prompt || ''}${err ? '  ' + err.split('\n')[0] : ''}`);
      return info;
    },
    /** hold W (and Shift) and steer toward each waypoint [x, z] by turning the view (play.lookAt) */
    async walk(points, { run = true, tol = 0.35, timeout = 30000 } = {}) {
      await S.page.keyboard.down('KeyW'); if (run) await S.page.keyboard.down('ShiftLeft');
      try {
        for (const [k, [x, z]] of points.entries()) {
          const t0 = Date.now();
          for (;;) {
            const p = await S.page.evaluate((x, z) => { const { play } = window.__mirage, s = play.state(); play.lookAt([x, s.eye[1], z]); return s.pos; }, x, z);
            const d = Math.hypot(p[0] - x, p[2] - z);
            if (d < (k < points.length - 1 ? Math.max(tol, 0.8) : tol)) break;   // corners can be cut
            if (Date.now() - t0 > timeout) throw new Error(`stuck at ${p.map((v) => v.toFixed(2))} on the way to ${x}, ${z}`);
            if (d < 1.2 && run) { await S.page.keyboard.up('ShiftLeft'); run = false; }
            await sleep(40);
          }
        }
      } finally { await S.page.keyboard.up('KeyW'); await S.page.keyboard.up('ShiftLeft'); }
      await sleep(250);
    },
    look: (p) => S.page.evaluate((p) => window.__mirage.play.lookAt(p), p),
    where: (id) => S.page.evaluate((id) => window.__mirage.g.game.where(window.__mirage.g.game.entities.get(id)), id),
    async press(code, ms = 80) { await S.page.keyboard.down(code); await sleep(ms); await S.page.keyboard.up(code); await sleep(200); },
    async close() { if (browser) await browser.close(); },
    errorsAll: () => pages.flatMap((p) => p.errors),
  };
  return S;
}

async function openPage(browser, url, { mobile, pad, W, H }) {
  const page = await browser.newPage();
  if (mobile) await page.emulate({ viewport: { width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  if (pad) await page.evaluateOnNewDocument(() => {
    // a standard-mapping gamepad whose axes and buttons the test sets through window.__pad
    window.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
    navigator.getGamepads = () => [{ id: 'Mirage test pad (standard)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: window.__pad.axes.slice(), buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
  });
  const errors = [];
  page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(600);
  return { page, errors, loadMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
if (PARTS.includes('main')) {
  const S = await session('main');
  await S.open();
  const R = { loadMs: S.loadMs };
  await S.step('start', async () => { await S.press('KeyW', 60); }, (s) => s.audioState === 'running' && /Find the key/.test(s.objective) && !s.dialog);
  await S.step('walk-to-the-key', () => S.walk([[0, 33.5], [-4.6, 28], [-4.6, 16.4], [-21.6, 16.4]]), (s) => Math.hypot(s.pos[0] + 21.6, s.pos[2] - 16.4) < 0.6);
  await S.step('see-the-prompt', async () => { await S.look(await S.where('key')); await sleep(300); }, (s) => s.near === 'key' && /Pick up the key/.test(s.prompt || ''));
  await S.step('pick-up-the-key', () => S.press('KeyE'), (s) => s.inv.includes('key') && s.audio.pickup === 1 && /Climb to the upper terrace/.test(s.objective));
  await S.step('walk-to-the-pavilion', () => S.walk([[-4.6, 16.4], [0, 13.2], [0, -6], [0, -10], [0, -16], [0, -19.9]]), (s) => s.pos[1] > 3.4 && s.pos[2] < -19.5);
  await S.step('door-prompt', async () => { await S.look(await S.where('door')); await sleep(300); }, (s) => s.near === 'door' && /Unlock the door/.test(s.prompt || ''));
  await S.step('door-opens', async () => { await S.press('KeyE'); await sleep(1600); }, (s) => s.flags.doorOpen && Math.abs(s.door[0]) > 1.4 && Math.abs(s.door[1]) > 1.4 && s.audio.door === 1);
  // A5: close the door on the player standing in the doorway: no leaf inside the body, not stuck, then open again
  const inLeaves = () => S.page.evaluate(() => {
    const { g, quest } = window.__mirage, me = g.character.collider.handle;
    return quest.leaves.filter((l) => { const c = l.body.collider(0); return g.physics.world.intersectionWithShape(c.translation(), c.rotation(), c.shape, undefined, undefined, c, l.body, (k) => k.handle === me); }).length;
  });
  await S.step('door-closes-on-the-player', async () => {
    await S.page.evaluate(() => { const { play, built } = window.__mirage, d = built.anchors.doors[0].pos; play.place([d[0], d[1] + 1.62, d[2]], [d[0], d[1] + 1.3, d[2] + 3], 'walk'); });
    await sleep(400); await S.look(await S.where('door')); await sleep(300); await S.press('KeyE');
    let worst = 0; for (let t = 0; t < 40; t++) { worst = Math.max(worst, await inLeaves()); await sleep(50); }
    S.pinch = worst;
  }, (s) => !s.flags.doorOpen && S.pinch === 0);
  await S.step('walks-off-after-the-door', () => S.walk([[0, -18.5]], { run: false }), (s) => Math.hypot(s.pos[0], s.pos[2] + 18.5) < 0.5);
  await S.step('door-opens-again', async () => { await S.walk([[0, -19.9]], { run: false }); await S.look(await S.where('door')); await sleep(300); await S.press('KeyE'); await sleep(1600); },
    (s) => s.flags.doorOpen && Math.abs(s.door[0]) > 1.4 && Math.abs(s.door[1]) > 1.4);
  const saved = await S.step('save-slot-1', async () => {
    await S.press('Escape'); await sleep(300);
    await S.page.click('.mg-menu button[data-p="save"]'); await sleep(200);
    await S.page.click('.mg-menu button[data-save="1"]'); await sleep(200);
  }, (s) => s.paused && s.dialog === 'mg-menu');
  const savedJSON = await S.page.evaluate(() => localStorage.getItem('mirage:garden-quest:1'));
  await S.step('resume', async () => { await S.press('Escape'); await sleep(200); }, (s) => !s.paused && !s.dialog);
  // reload: a fresh page, then load slot 1 from the menu
  const before = { pos: saved.pos, flags: saved.flags, inv: saved.inv, door: saved.door };
  const audio1 = (await S.state()).audio;
  await S.page.reload({ waitUntil: 'load' });
  await S.page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(600);
  await S.step('reloaded-fresh', async () => { await S.press('KeyP', 60); await sleep(200); }, (s) => !s.inv.length && !s.flags.doorOpen && s.dialog === 'mg-menu');
  const loaded = await S.step('load-slot-1', async () => {
    await S.page.click('.mg-menu button[data-p="load"]'); await sleep(200);
    await S.page.click('.mg-menu button[data-load="1"]'); await sleep(1200);
  }, (s) => !s.paused && s.inv.join() === before.inv.join() && s.flags.doorOpen && Math.abs(s.door[0]) > 1.4 &&
    Math.hypot(s.pos[0] - before.pos[0], s.pos[2] - before.pos[2]) < 0.05 && Math.abs(s.pos[1] - before.pos[1]) < 0.05);
  R.saveLoad = { saved: before, loaded: { pos: loaded.pos, flags: loaded.flags, inv: loaded.inv, door: loaded.door }, bytes: savedJSON && savedJSON.length };
  await S.step('enter-the-pavilion', () => S.walk([[0, -22.5], [0.6, -27.7]], { run: false }), (s) => s.pos[2] < -27 && s.pos[1] > 3.6);
  await S.step('take-the-taper', async () => { await S.look(await S.where('taper')); await sleep(300); await S.press('KeyE'); }, (s) => s.inv.includes('taper') && /Lanterns 0 \/ 4/.test(s.objective));
  for (const [i, wp] of [[0, [-1.6, -23.1]], [1, [1.6, -23.1]]]) {
    await S.step(`light-lantern-${i}`, async () => { await S.walk([wp], { run: false, tol: 0.3 }); await S.look(await S.where('lantern' + i)); await sleep(300); await S.press('KeyE'); await sleep(300); }, (s) => s.flags['lit' + i]);
  }
  for (const [i, wp] of [[2, [-1.95, -19.1]], [3, [1.95, -19.1]]]) {
    await S.step(`light-lantern-${i}`, async () => { await S.walk([[0, -21.8], [0, -19.6], wp], { run: false, tol: 0.3 }); await S.look(await S.where('lantern' + i)); await sleep(300); await S.press('KeyE'); await sleep(500); }, (s) => s.flags['lit' + i]);
  }
  await S.step('done-message', async () => { await sleep(400); }, (s) => s.flags.done && s.dialog === 'mg-msg' && s.audio.done === 1);
  await S.step('looking-back', async () => { await S.press('Enter'); await S.walk([[0, -19.2], [0, -16.5]], { run: false }); await S.look([0, 4.6, -22]); await sleep(1500); }, (s) => !s.dialog && s.flags.done);
  const last = await S.state();
  R.audio = Object.fromEntries([...new Set([...Object.keys(audio1), ...Object.keys(last.audio)])].map((k) => [k, (audio1[k] || 0) + (last.audio[k] || 0)]));   // both page loads
  R.surfaces = Object.fromEntries(Object.entries(R.audio).filter(([k]) => k.startsWith('step_')));
  R.errors = S.errorsAll();
  if (R.errors.length) { failed++; console.log('console errors:', R.errors); }
  if (!(R.surfaces.step_stone && R.surfaces.step_gravel)) { failed++; console.log('FAIL footsteps: expected stone and gravel', R.surfaces); }
  R.steps = S.steps;
  report.parts.main = R;
  await S.close();
}

if (PARTS.includes('pad')) {
  const S = await session('pad', { pad: true });
  await S.open();
  const set = (o) => S.page.evaluate((o) => { if (o.axes) window.__pad.axes = o.axes; if (o.b) for (const [i, v] of Object.entries(o.b)) window.__pad.buttons[i] = v; }, o);
  const tap = async (i) => { await set({ b: { [i]: 1 } }); await sleep(120); await set({ b: { [i]: 0 } }); await sleep(250); };
  const p0 = (await S.state()).pos;
  let startY = -Infinity;   // A held on the start screen starts the game and must not also jump (B10)
  await S.step('a-starts', async () => {
    await set({ b: { 0: 1 } });
    for (let t = 0; t < 15; t++) { startY = Math.max(startY, (await S.state()).pos[1]); await sleep(40); }
    await set({ b: { 0: 0 } }); await sleep(250);
  }, (s) => s.audioState === 'running' && !s.dialog && startY - p0[1] < 0.05);
  await S.step('left-stick-walks', async () => { await set({ axes: [0, -1, 0, 0] }); await sleep(2000); await set({ axes: [0, 0, 0, 0] }); await sleep(200); }, (s) => p0[2] - s.pos[2] > 2.2);
  const y0 = (await S.state()).yaw;
  await S.step('right-stick-looks', async () => { await set({ axes: [0, 0, 1, 0] }); await sleep(500); await set({ axes: [0, 0, 0, 0] }); await sleep(200); }, (s) => s.yaw - y0 > 0.6);
  let maxY = 0;
  await S.step('a-jumps', async () => {
    await set({ b: { 0: 1 } });
    for (let t = 0; t < 12; t++) { maxY = Math.max(maxY, (await S.state()).pos[1]); await sleep(40); }
    await set({ b: { 0: 0 } }); await sleep(900);
  }, (s) => maxY > 0.6 && s.pos[1] < 0.15);
  await S.step('x-picks-up', async () => {
    await S.page.evaluate(() => { const { play } = window.__mirage; play.place([-22, 1.62, 16.5], [-22, 0.56, 17.95], 'walk'); });
    await sleep(400); await S.look(await S.where('key')); await sleep(300); await tap(2);
  }, (s) => s.inv.includes('key'));
  await S.step('y-opens-the-bag', () => tap(3), (s) => s.dialog === 'mg-inv' && s.paused);
  await S.step('b-closes', () => tap(1), (s) => !s.dialog && !s.paused);
  await S.step('start-opens-the-menu', () => tap(9), (s) => s.dialog === 'mg-menu' && s.paused);
  await S.step('dpad-moves-focus', async () => { await tap(13); await tap(13); }, async () => (await S.page.evaluate(() => document.activeElement.textContent)) === 'Load');
  await S.step('a-presses-focused', () => tap(0), async () => (await S.page.evaluate(() => document.querySelector('#mg-menu-h').textContent)) === 'Load');
  await S.step('b-resumes', () => tap(1), (s) => !s.dialog && !s.paused);
  report.parts.pad = { steps: S.steps, errors: S.errorsAll() };
  if (S.errorsAll().length) { failed++; console.log('console errors:', S.errorsAll()); }
  await S.close();
}

if (PARTS.includes('touch')) {
  const S = await session('touch', { mobile: true });
  await S.open();
  const box = async (sel) => { const r = await S.page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); return r; };
  const tapEl = async (sel) => { const [x, y] = await box(sel); await S.page.touchscreen.tap(x, y); await sleep(300); };
  await S.step('touch-ui-shown', async () => { await S.page.touchscreen.tap(195, 300); await sleep(400); }, async (s) => s.audioState === 'running' && (await S.page.$eval('.mg-touch', (e) => !e.hidden)));
  const p0 = (await S.state()).pos;
  await S.step('stick-walks', async () => {
    const [x, y] = await box('.mg-stick');
    await S.page.touchscreen.touchStart(x, y); await S.page.touchscreen.touchMove(x, y - 30); await S.page.touchscreen.touchMove(x, y - 60);
    await sleep(2000); await S.page.touchscreen.touchEnd(); await sleep(200);
  }, (s) => p0[2] - s.pos[2] > 2.2);
  const y0 = (await S.state()).yaw;
  await S.step('drag-looks', async () => {
    await S.page.touchscreen.touchStart(260, 300); for (let i = 1; i <= 8; i++) await S.page.touchscreen.touchMove(260 + i * 12, 300); await S.page.touchscreen.touchEnd(); await sleep(200);
  }, (s) => s.yaw - y0 > 0.3);
  let maxY = 0;
  await S.step('jump-button', async () => {
    const [x, y] = await box('.mg-btns button[data-a="jump"]');
    await S.page.touchscreen.touchStart(x, y);
    for (let t = 0; t < 10; t++) { maxY = Math.max(maxY, (await S.state()).pos[1]); await sleep(40); }
    await S.page.touchscreen.touchEnd(); await sleep(900);
  }, () => maxY > 0.6);
  await S.step('use-button-picks-up', async () => {
    await S.page.evaluate(() => { window.__mirage.play.place([-22, 1.62, 16.5], [-22, 0.56, 17.95], 'walk'); });
    await sleep(400); await S.look(await S.where('key')); await sleep(300); await tapEl('.mg-btns button[data-a="interact"]');
  }, (s) => s.inv.includes('key'));
  await S.step('menu-button', () => tapEl('.mg-menubtn'), (s) => s.dialog === 'mg-menu' && s.paused);
  await S.step('resume-button', () => tapEl('.mg-menu button[data-do="resume"]'), (s) => !s.dialog && !s.paused);
  report.parts.touch = { steps: S.steps, errors: S.errorsAll() };
  if (S.errorsAll().length) { failed++; console.log('console errors:', S.errorsAll()); }
  await S.close();
}

report.failed = failed;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`playthrough: ${failed ? failed + ' failure(s)' : 'all steps pass'} -> ${OUT}`);
if (srv) srv.close();
process.exit(failed ? 1 : 0);

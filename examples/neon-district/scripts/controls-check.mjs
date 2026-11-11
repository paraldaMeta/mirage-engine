#!/usr/bin/env node
// Check: the shooter's front end and controls beyond the keyboard, in the real Chrome with real events.
//   title  without ?start=1: the title is up, the game paused and harmless, the camera flies; the keys change the
//          mode and the difficulty (kept in the settings), Enter on DEPLOY starts the holdout on the relay roof
//   holdout  ?start=1&mode=holdout&assist=1 for 40 s, a scripted gunner on the roof: a wave cleared or under way
//   keys   C crouches, X leans, O opens the options panel (and a setting applies); the guns: 1-3 select, 4 is locked,
//          0 unlocks 4 and 5 with a full load (kept in the settings), 0 again within a minute does not refill, 5
//          selects the gatling, the mouse wheel cycles, the sidearm fires 30 rounds and never runs dry; the hit-stop
//          and shake options are kept
//   pad    a standard-mapping gamepad (an injected Gamepad API shim): the d-pad works the title, A deploys, the stick walks, the right trigger fires, the
//          left trigger aims, the right bumper reloads, Start opens the menu and B closes it, Y cycles the guns,
//          both sticks clicked together unlock slots 4 and 5 (and do not strike)
//   touch  an emulated phone held sideways (844 x 390, touch events with several fingers at once): the title fits, a
//          tap on DEPLOY starts; at 844 x 390, 667 x 375 and 932 x 430 no control overlaps another or leaves the
//          screen; a drag on the right turns; the floating stick walks; the sprint lock holds and ends; a finger on
//          FIRE fires and turns; AIM tap toggles and hold aims; the stick and FIRE together; the left FIRE; RELOAD,
//          CROUCH, LEAN (hold and toggle), MELEE, JUMP; USE appears at the relay door with its label and opens it;
//          the options' touch settings are kept and applied; HACK held (dimmed with a reason on nothing, the ring
//          fills and the hack lands on a street lamp), DASH, GRENADE and OVERDRIVE with their cooldown / charge, the
//          gun strip (a tap selects, a locked slot stays locked, a swipe cycles), the 0 field in the options unlocks;
//          no world marker drawn on a button. Then the same HUD in Chinese. Screenshots: out/touch-*.png
// usage: node scripts/controls-check.mjs [dist]      (build first: npm run build -w neon-district)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let failed = 0;
// ONLY=title,touch runs those parts alone
const want = (part) => !process.env.ONLY || process.env.ONLY.split(',').includes(part);
const check = (part, name, ok, info = '') => { rows.push(`${ok ? 'pass' : 'FAIL'}  ${part}/${name}  ${info}`); if (!ok) failed++; };
const state = (page) => page.evaluate(() => { const m = window.__mirage, S = m.game.weapon.S; return { mag: S.mag, ads: +S.ads.toFixed(2), reloading: S.reloading > 0, reloads: m.g.game.flags.reloads || 0, pos: m.play.state().pos, paused: m.g.game.paused, source: m.g.input.source, touch: m.g.ui.touch, started: m.g.ui.started }; });
async function open(browser, query, { mobile = false, pad = false } = {}) {
  const page = await browser.newPage(), errors = [];
  if (mobile) await page.emulate({ viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  if (pad) await page.evaluateOnNewDocument(() => {
    window.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
    navigator.getGamepads = () => [{ id: 'Mirage test pad (standard)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: window.__pad.axes.slice(), buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.url}?grain=0&assist=1&quality=low&${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await sleep(500);
  return { page, errors };
}
const padSet = (page, o) => page.evaluate((o) => { for (const [k, v] of Object.entries(o.buttons || {})) window.__pad.buttons[k] = v; if (o.axes) window.__pad.axes = o.axes; }, o);
const padTap = async (page, i) => { await padSet(page, { buttons: { [i]: 1 } }); await sleep(200); await padSet(page, { buttons: { [i]: 0 } }); await sleep(200); };
const front = (page) => page.evaluate(() => { const m = window.__mirage, t = document.querySelector('.nt'), r = t?.getBoundingClientRect(); return { title: !!t && !t.hidden && !t.classList.contains('out') && r.width > 0, sel: m.game.title.selected, run: { ...m.game.run }, kept: JSON.parse(localStorage.getItem('mirage:neon-district:settings') || '{}').ndRun || null, started: m.g.ui.started, paused: m.g.game.paused, hp: m.game.player.hp, eye: m.world.camera.position.toArray(), gun: m.game.weapon.holder.visible, card: getComputedStyle(document.querySelector('.mg-start')).display, mode: m.play.mode, flags: { ...m.g.game.flags }, feet: m.game.player.feet.slice(), tally: document.querySelector('.nd-tally')?.textContent || '', wave: m.game.holdout.wave, state: m.game.holdout.state }; });

if (want('title')) { // ---- the title: up, paused and harmless; the keys choose; Enter deploys
  const b = await launch({ w: 1280, h: 720, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'w=1280&h=720&lang=en');
  let s = await front(page);
  await sleep(3000);
  const s2 = await front(page);
  check('title', 'the title is up, the engine card hidden', s.title && s.card === 'none' && !s.started, `card ${s.card}`);
  check('title', 'the game waits paused, nothing hurts the player', s2.paused && s2.hp === 100 && !s2.gun, `hp ${s2.hp}, view model ${s2.gun}`);
  check('title', 'the camera flies the district', s.mode === 'orbit' && Math.hypot(s2.eye[0] - s.eye[0], s2.eye[1] - s.eye[1], s2.eye[2] - s.eye[2]) > 2, `moved ${Math.hypot(s2.eye[0] - s.eye[0], s2.eye[2] - s.eye[2]).toFixed(1)} m`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(200);
  s = await front(page);
  check('title', 'arrows and Tab change the mode and the difficulty', s.run.mode === 'holdout' && s.run.difficulty === 'brutal' && s.sel === 'difficulty', `${s.run.mode} / ${s.run.difficulty}, on ${s.sel}`);
  check('title', 'the choice is kept in the settings', s.kept && s.kept.mode === 'holdout' && s.kept.difficulty === 'brutal', JSON.stringify(s.kept));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await sleep(100);
  s = await front(page);
  check('title', 'still on the title, back on DEPLOY', !s.started && s.paused && s.sel === 'deploy' && s.run.difficulty === 'hard', `${s.sel}, ${s.run.difficulty}`);
  await page.keyboard.press('Enter'); await sleep(1500);
  s = await front(page);
  check('title', 'Enter on DEPLOY starts the run', s.started && !s.paused && !s.title && s.gun && s.mode === 'walk', `started ${s.started}, paused ${s.paused}`);
  check('title', 'the holdout puts the player on the relay roof', s.flags.holdout && Math.abs(s.feet[1] - 6) < 0.4, `feet ${s.feet.map((v) => v.toFixed(1))}`);
  await sleep(6000);
  s = await front(page);
  check('title', 'the game runs: a wave comes, the HUD shows it', s.wave >= 1 && /WAVE 1/.test(s.tally) && /HARD/.test(s.tally), `wave ${s.wave} (${s.state}), tally "${s.tally}"`);
  check('title', 'no console errors', errors.length === 0, errors[0] || '');
  await page.screenshot({ path: path.join(here, '../out/title-deployed.png') }).catch(() => {});
  await b.close();
}
if (want('holdout')) { // ---- the holdout, 40 s, a scripted gunner: it turns to the nearest sentinel or kite on the roof and holds F
  const b = await launch({ w: 1280, h: 720, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'w=1280&h=720&start=1&mode=holdout&lang=en');
  const t0 = Date.now();
  let firing = false, most = 0;
  while (Date.now() - t0 < 40000) {
    const aim = await page.evaluate(() => {
      const m = window.__mirage, H = m.game.holdout, p = m.world.camera.position;
      let best = null, bd = 26;
      for (const e of H.foes) {
        if (e.dead) continue;
        const k = e.rig ? e.K.scale : 0, q = [e.pos[0], e.pos[1] + (e.rig ? 1.25 * k : 0), e.pos[2]], d = Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z);
        if (Math.abs(e.pos[1] - (m.game.player.feet[1])) > 3.5 && e.rig) continue;   // still in the building
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) return false;
      const dx = best[0] - p.x, dy = best[1] - p.y, dz = best[2] - p.z;
      m.play.yaw = Math.atan2(dz, dx); m.play.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      return true;
    });
    if (aim !== firing) { firing = aim; if (aim) await page.keyboard.down('KeyF'); else await page.keyboard.up('KeyF'); }
    most = Math.max(most, await page.evaluate(() => window.__mirage.game.holdout.wave));
    await sleep(120);
  }
  await page.keyboard.up('KeyF');
  const s = await front(page);
  check('holdout', 'waves come and are fought (one cleared or one under way)', (s.flags.waves || 0) >= 1 || (s.wave >= 1 && s.state === 'fight'), `wave ${s.wave} (${s.state}), cleared ${s.flags.waves || 0}, kills ${s.flags.kills || 0}`);
  check('holdout', 'the player is alive on the roof', !s.flags.over && s.hp > 0 && Math.abs(s.feet[1] - 6) < 0.6, `hp ${Math.round(s.hp)}, feet ${s.feet.map((v) => v.toFixed(1))}`);
  check('holdout', 'no console errors', errors.length === 0, errors[0] || '');
  await page.screenshot({ path: path.join(here, '../out/holdout.png') }).catch(() => {});
  await b.close();
}

if (want('keys')) { // ---- keyboard extras: crouch, lean, the options panel
  const b = await launch({ w: 1280, h: 720, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'w=1280&h=720&start=1&lang=en');
  const more = () => page.evaluate(() => { const m = window.__mirage; return { height: +m.game.player.height.toFixed(2), lean: +m.game.weapon.S.lean.toFixed(2), paused: m.g.game.paused, panel: !!document.querySelector('.nd-opt'), fov: m.game.weapon.S.fov, eyeY: +m.world.camera.position.y.toFixed(2) }; });
  const y0 = (await more()).eyeY;
  await page.keyboard.press('KeyC'); await sleep(500);
  let s = await more();
  check('keys', 'C crouches', s.height < 1.1 && s.eyeY < y0 - 0.5, `eye ${y0} -> ${s.eyeY}`);
  await page.keyboard.press('KeyC'); await page.keyboard.down('KeyX'); await sleep(500);
  s = await more();
  check('keys', 'X leans', s.lean > 0.8, `lean ${s.lean}`);
  await page.keyboard.up('KeyX'); await page.keyboard.press('KeyO'); await sleep(300);
  s = await more();
  check('keys', 'O opens the options and pauses', s.panel && s.paused);
  await page.evaluate(() => { const r = document.querySelector('.nd-opt input[data-k=fov]'); r.value = 80; r.dispatchEvent(new Event('input')); });
  await page.keyboard.press('KeyO'); await sleep(300);
  s = await more();
  check('keys', 'the field of view setting applies, O closes', !s.panel && !s.paused && s.fov === 80, `fov ${s.fov}`);
  // the guns
  const armsOf = () => page.evaluate(() => { const m = window.__mirage, w = m.game.weapon; return { id: w.id, unlocked: w.unlocked, rocket: { ...w.W.rocket }, gatling: { ...w.W.gatling }, sidearm: { mag: w.W.sidearm.mag, inf: w.W.sidearm.reserve === Infinity }, flags: { ...m.g.game.flags }, kept: JSON.parse(localStorage.getItem('mirage:neon-district:settings') || '{}').nd || {} }; });
  await page.keyboard.press('Digit3'); await sleep(700);
  let a = await armsOf();
  const three = a.id;
  await page.keyboard.press('Digit1'); await sleep(700);
  a = await armsOf();
  check('keys', '3 selects the shotgun, 1 the sidearm', three === 'shotgun' && a.id === 'sidearm', `${three}, ${a.id}`);
  await page.keyboard.press('Digit4'); await sleep(600);
  a = await armsOf();
  check('keys', '4 is locked before the unlock', a.id === 'sidearm' && !a.rocket.owned, `in hand ${a.id}`);
  await page.keyboard.press('Digit0'); await sleep(400);
  a = await armsOf();
  check('keys', '0 unlocks 4 and 5 with a full load, kept in the settings', a.unlocked && a.rocket.owned && a.rocket.mag === 1 && a.rocket.reserve === 6 && a.gatling.mag === 200 && a.gatling.reserve === 400 && a.kept.unlocked === true, JSON.stringify({ rocket: a.rocket, gatling: a.gatling, kept: a.kept.unlocked }));
  await page.evaluate(() => { window.__mirage.game.weapon.W.gatling.reserve = 0; });
  await page.keyboard.press('Digit0'); await sleep(300);
  a = await armsOf();
  check('keys', '0 again within a minute does not refill', a.gatling.reserve === 0, `gatling reserve ${a.gatling.reserve}`);
  await page.keyboard.press('Digit5'); await sleep(700);
  const five = (await armsOf()).id;
  await page.mouse.move(640, 360); await page.mouse.wheel({ deltaY: 120 }); await sleep(700);
  const w1 = (await armsOf()).id;
  await page.mouse.wheel({ deltaY: -120 }); await sleep(700);
  const w2 = (await armsOf()).id;
  check('keys', '5 selects the gatling; the wheel cycles (down: on, up: back)', five === 'gatling' && w1 === 'sidearm' && w2 === 'gatling', `${five} -> ${w1} -> ${w2}`);
  await page.keyboard.press('Digit1'); await sleep(700);
  for (let i = 0; i < 30; i++) { await page.keyboard.down('KeyF'); await sleep(40); await page.keyboard.up('KeyF'); await sleep(i % 12 === 11 ? 1500 : 140); }
  await sleep(1500);
  a = await armsOf();
  check('keys', 'the sidearm fires 30 rounds and never runs dry', (a.flags.shots_sidearm || 0) >= 28 && a.sidearm.inf && a.sidearm.mag > 0, `shots ${a.flags.shots_sidearm}, magazine ${a.sidearm.mag}, reserve endless ${a.sidearm.inf}`);
  check('keys', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
if (want('pad')) { // ---- gamepad
  const b = await launch({ w: 1280, h: 720, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'w=1280&h=720', { pad: true });
  await padTap(page, 13); await padTap(page, 13); await padTap(page, 15);
  let f = await front(page);
  check('pad', 'the d-pad works the title', f.title && !f.started && f.sel === 'difficulty' && f.run.difficulty === 'hard', `on ${f.sel}, ${f.run.difficulty}`);
  await padTap(page, 12); await padTap(page, 12);
  await padSet(page, { buttons: { 0: 1 } }); await sleep(250); await padSet(page, { buttons: { 0: 0 } }); await sleep(300);
  let s = await state(page);
  f = await front(page);
  check('pad', 'A on DEPLOY starts the game', s.started && !s.paused && !f.title, `source ${s.source}`);
  const p0 = s.pos;
  await padSet(page, { axes: [0, -1, 0, 0] }); await sleep(900); await padSet(page, { axes: [0, 0, 0, 0] }); await sleep(200);
  s = await state(page);
  check('pad', 'left stick walks', Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]) > 1.2, `moved ${Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]).toFixed(2)} m`);
  await padSet(page, { buttons: { 7: 1 } }); await sleep(600); await padSet(page, { buttons: { 7: 0 } }); await sleep(150);
  s = await state(page);
  check('pad', 'right trigger fires', s.mag < 24 && s.mag > 10, `magazine ${s.mag}`);
  await padSet(page, { buttons: { 6: 1 } }); await sleep(500);
  s = await state(page);
  check('pad', 'left trigger aims', s.ads > 0.8, `aim ${s.ads}`);
  await padSet(page, { buttons: { 6: 0, 5: 1 } }); await sleep(150); await padSet(page, { buttons: { 5: 0 } }); await sleep(2100);
  s = await state(page);
  check('pad', 'right bumper reloads', s.mag === 24 && s.reloads === 1, `magazine ${s.mag}, reloads ${s.reloads}`);
  await padSet(page, { buttons: { 9: 1 } }); await sleep(200); await padSet(page, { buttons: { 9: 0 } }); await sleep(300);
  s = await state(page);
  check('pad', 'Start opens the menu', s.paused);
  await padSet(page, { buttons: { 1: 1 } }); await sleep(200); await padSet(page, { buttons: { 1: 0 } }); await sleep(300);
  s = await state(page);
  check('pad', 'B closes it', !s.paused);
  const gun = () => page.evaluate(() => { const w = window.__mirage.game.weapon; return { id: w.switchingTo || w.id, unlocked: w.unlocked, jab: w.S.jab, inv: !!document.querySelector('.mg-dialog[open], dialog[open]') }; });
  const g0 = await gun();
  await padTap(page, 3); await sleep(500);
  const g1 = await gun();
  check('pad', 'Y cycles the guns (and opens no bag)', g0.id === 'carbine' && g1.id === 'shotgun' && !g1.inv, `${g0.id} -> ${g1.id}`);
  await padSet(page, { buttons: { 10: 1, 11: 1 } }); await sleep(250); await padSet(page, { buttons: { 10: 0, 11: 0 } }); await sleep(300);
  const g2 = await gun();
  check('pad', 'both sticks clicked together unlock 4 and 5 (no strike)', g2.unlocked && g2.jab === 0, `unlocked ${g2.unlocked}, jab ${g2.jab}`);
  check('pad', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
// ---- touch: real multi-finger touch events (CDP Input.dispatchTouchEvent; each finger its own id)
const phone = (page, width, height) => page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
async function fingersOf(page) {
  const cdp = await page.createCDPSession(), on = new Map();
  // a touchStart / touchMove carries every finger still down; one left out of the list is lifted
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [...on].map(([id, [x, y]]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
  const f = {
    down: (id, x, y) => { on.set(id, [x, y]); return send('touchStart'); },
    move: (id, x, y) => { on.set(id, [x, y]); return send('touchMove'); },
    up: (id) => { on.delete(id); return send(on.size ? 'touchMove' : 'touchEnd'); },
    async drag(id, x, y, dx, dy, ms, steps = 12) { for (let i = 1; i <= steps; i++) { await f.move(id, x + dx * i / steps, y + dy * i / steps); await sleep(ms / steps); } },
    async tap(id, at, hold = 60) { await f.down(id, at[0], at[1]); await sleep(hold); await f.up(id); },
  };
  return f;
}
const tstate = (page) => page.evaluate(() => {
  const m = window.__mirage, t = m.game.touch, S = m.game.weapon.S, u = document.querySelector('.ndt-use');
  return { yaw: m.play.yaw, pitch: m.play.pitch, mag: S.mag, ads: +S.ads.toFixed(2), reloads: m.g.game.flags.reloads || 0, pos: m.play.state().pos, height: +m.game.player.height.toFixed(2),
    lean: +S.lean.toFixed(2), jab: +S.jab.toFixed(2), speed: +m.game.player.speed.toFixed(2), run: m.g.input.down('run'), locked: !!t?.sprintLocked, aimOn: !!t?.aim, eyeY: m.world.camera.position.y,
    use: u && !u.hidden ? u.textContent.trim() : null, door: !!m.g.game.flags.doorOpen, paused: m.g.game.paused, panel: !!document.querySelector('.nd-opt'), lockClass: document.querySelector('.ndt-lock')?.className || '' };
});
const centre = (page, id) => page.evaluate((id) => { const r = document.querySelector(`.ndt [data-b="${id}"]`)?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2, r.width] : null; }, id);
// every control's rectangle on screen: none outside the viewport, no two overlapping (the HUD's health and gun too)
const layoutOf = (page) => page.evaluate(() => {
  const rs = window.__mirage.game.touch.rects(), W = innerWidth, H = innerHeight;
  for (const s of ['.nd-vit', '.nd-ammo']) { const r = document.querySelector(s).getBoundingClientRect(); rs.push([s, r.left, r.top, r.right, r.bottom]); }
  const out = rs.filter(([, l, t, r, b]) => l < 0 || t < 0 || r > W || b > H).map((r) => r[0]), over = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]) over.push(`${a[0]}x${b[0]}`);
  }
  return { n: rs.length, out, over, W, H };
});
const toSpawn = async (page) => { await page.evaluate(() => { const m = window.__mirage, s = m.built.plan.spawn; m.play.place(s.eye, s.look, 'walk'); }); await sleep(300); };
const doorFront = (page) => page.evaluate(() => {
  const m = window.__mirage, d = m.g.game.entities.get('door').pos, feet = d[1] - 1.3;
  m.play.place([d[0], feet + 1.62, d[2] + 1.7], [d[0], feet + 1.5, d[2] - 1], 'walk');
});
if (want('touch')) {
  const b = await launch({ w: 844, h: 390, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'lang=en', { mobile: true });
  const fits = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), m = r('.nt-main'), l = r('.nt-legend'), rows = [...document.querySelectorAll('.nt-row')].map((e) => e.getBoundingClientRect());
    return { inside: [m, l].every((b) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight), apart: l.left >= m.right || l.top >= m.bottom, rows: Math.min(...rows.map((b) => b.height)) }; });
  check('touch', 'the title fits a phone held sideways', fits.inside && fits.apart && fits.rows >= 34, JSON.stringify(fits));
  await phone(page, 667, 375); await sleep(300);
  const small = await page.evaluate(() => { const l = document.querySelector('.nt-legend'), r = l.getBoundingClientRect(), m = document.querySelector('.nt-main').getBoundingClientRect(), go = document.querySelector('.nt-row.go').getBoundingClientRect();
    return { inside: r.right <= innerWidth && m.bottom <= innerHeight, whole: l.scrollWidth <= l.clientWidth + 1, apart: r.left >= m.right || r.top >= m.bottom, deploy: go.height >= 34 }; });
  check('touch', 'the title fits 667 x 375 too, its legend whole', small.inside && small.whole && small.apart && small.deploy, JSON.stringify(small));
  await phone(page, 844, 390); await sleep(300);
  const go =await page.evaluate(() => { const r = document.querySelector('.nt-row.go').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(go[0], go[1]); await sleep(700);
  let s = await state(page);
  check('touch', 'a tap on DEPLOY starts the game, the touch controls appear', s.started && s.touch && await page.evaluate(() => !!window.__mirage.game.touch), `touch overlay ${s.touch}`);
  const f = await fingersOf(page);
  // the layout at three phone sizes
  for (const [w, h] of [[844, 390], [667, 375], [932, 430]]) {
    await phone(page, w, h); await sleep(400);
    const L = await layoutOf(page);
    check('touch', `${w} x ${h}: ${L.n} controls inside the screen, none overlapping`, L.W === w && !L.out.length && !L.over.length, JSON.stringify({ out: L.out, over: L.over }));
    if (w === 667) await page.screenshot({ path: path.join(here, '../out/touch-667.png') }).catch(() => {});
  }
  await phone(page, 844, 390); await sleep(400);
  await page.screenshot({ path: path.join(here, '../out/touch-en.png') }).catch(() => {});
  const C = {};
  for (const id of ['fire', 'fireL', 'aim', 'reload', 'crouch', 'jump', 'melee', 'leanL', 'leanR', 'opt']) C[id] = await centre(page, id);
  // drag on open ground on the right: the view turns
  s = await tstate(page);
  await f.down(1, 520, 140); await f.drag(1, 520, 140, 90, 0, 300); await f.up(1); await sleep(150);
  let s2 = await tstate(page);
  check('touch', 'a drag on the right half turns the view', Math.abs(s2.yaw - s.yaw) > 0.2, `yaw ${(s2.yaw - s.yaw).toFixed(2)} rad`);
  // the floating stick: wherever the thumb lands in the lower left
  s = s2;
  await f.down(1, 150, 300); await f.drag(1, 150, 300, 0, -45, 120, 4); await sleep(900); await f.up(1); await sleep(200);
  s2 = await tstate(page);
  const moved = (a, b) => Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  check('touch', 'the floating stick walks (from where the thumb lands)', moved(s, s2) > 0.8, `moved ${moved(s, s2).toFixed(2)} m`);
  // sprint lock: pushed far up, let go: the run holds; a touch on the stick ends it
  await toSpawn(page); s = await tstate(page);
  await f.down(1, 140, 310); await f.drag(1, 140, 310, 0, -130, 200, 8); await sleep(150);
  const armed = (await tstate(page)).lockClass.includes('armed');
  await f.up(1); await sleep(800);
  s2 = await tstate(page);
  check('touch', 'sprint lock: far up arms the padlock, let go and the run holds', armed && s2.locked && s2.run && s2.speed > 4.4 && moved(s, s2) > 2, `armed ${armed}, locked ${s2.locked}, speed ${s2.speed} m/s, moved ${moved(s, s2).toFixed(1)} m`);
  await f.tap(1, [140, 310]); await sleep(500);
  let s3 = await tstate(page); await sleep(300); const s4 = await tstate(page);
  check('touch', 'sprint lock: a touch on the stick ends it', !s3.locked && !s4.run && moved(s3, s4) < 0.3, `locked ${s3.locked}, moved ${moved(s3, s4).toFixed(2)} m in 0.3 s`);
  // FIRE: a finger on it fires and, dragged, turns the view
  s = await tstate(page);
  await f.down(2, C.fire[0], C.fire[1]); await sleep(100); await f.drag(2, C.fire[0], C.fire[1], -70, -20, 500); await f.up(2); await sleep(150);
  s2 = await tstate(page);
  check('touch', 'a finger on FIRE fires and turns the view as it drags', s2.mag < s.mag - 3 && Math.abs(s2.yaw - s.yaw) > 0.15, `magazine ${s.mag} -> ${s2.mag}, yaw ${(s2.yaw - s.yaw).toFixed(2)} rad`);
  // AIM: a quick tap toggles; held, it aims while held and turns the view
  await f.tap(2, C.aim, 60); await sleep(500);
  s = await tstate(page);
  await f.tap(2, C.aim, 60); await sleep(500);
  s2 = await tstate(page);
  check('touch', 'AIM: a quick tap toggles the sight on, another off', s.ads > 0.8 && s.aimOn && s2.ads < 0.2 && !s2.aimOn, `aim ${s.ads} -> ${s2.ads}`);
  const y0 = s2.yaw;
  await f.down(2, C.aim[0], C.aim[1]); await sleep(450);
  s = await tstate(page);
  await f.drag(2, C.aim[0], C.aim[1], -60, 0, 300); s2 = await tstate(page); await f.up(2); await sleep(500);
  s3 = await tstate(page);
  check('touch', 'AIM held: aims while held (and turns, slower), lets go on release', s.ads > 0.8 && Math.abs(s2.yaw - y0) > 0.08 && s3.ads < 0.2, `aim ${s.ads} held, ${s3.ads} after; yaw ${(s2.yaw - y0).toFixed(2)} rad`);
  // two fingers at once: the stick and FIRE
  await toSpawn(page); s = await tstate(page);
  await f.down(1, 150, 300); await f.move(1, 150, 260); await f.down(2, C.fire[0], C.fire[1]); await sleep(800);
  const both = await page.evaluate(() => ({ fire: window.__mirage.game.weapon.S.fire, busy: window.__mirage.game.touch.busy }));
  await f.up(2); await f.up(1); await sleep(200);
  s2 = await tstate(page);
  check('touch', 'two fingers at once: the stick walks while FIRE fires', both.fire && both.busy === 2 && moved(s, s2) > 0.6 && s2.mag < s.mag, `fingers ${both.busy}, moved ${moved(s, s2).toFixed(2)} m, magazine ${s.mag} -> ${s2.mag}`);
  // the left FIRE
  s = await tstate(page);
  await f.down(3, C.fireL[0], C.fireL[1]); await sleep(500); await f.up(3); await sleep(150);
  s2 = await tstate(page);
  check('touch', 'the left FIRE fires', s2.mag < s.mag || (s.mag === 0 && s2.reloads > s.reloads), `magazine ${s.mag} -> ${s2.mag}`);
  // reload, crouch, lean, strike, jump
  s = await tstate(page);
  await f.tap(2, C.reload); await sleep(2200);
  s2 = await tstate(page);
  check('touch', 'RELOAD reloads', s2.mag === 24 && s2.reloads === s.reloads + 1, `magazine ${s2.mag}, reloads ${s.reloads} -> ${s2.reloads}`);
  await f.tap(2, C.crouch); await sleep(500);
  s = await tstate(page);
  await f.tap(2, C.crouch); await sleep(500);
  s2 = await tstate(page);
  check('touch', 'CROUCH toggles a crouch', s.height < 1.1 && s2.height > 1.5, `height ${s.height} -> ${s2.height}`);
  await f.down(4, C.leanR[0], C.leanR[1]); await sleep(500);
  s = await tstate(page);
  await f.up(4); await sleep(500);
  s2 = await tstate(page);
  await f.tap(4, C.leanL); await sleep(500);
  s3 = await tstate(page);
  await f.tap(4, C.leanL); await sleep(500);
  const s5 = await tstate(page);
  check('touch', 'LEAN: held right leans right, a tap on left toggles a left lean', s.lean > 0.8 && Math.abs(s2.lean) < 0.2 && s3.lean < -0.8 && Math.abs(s5.lean) < 0.2, `held ${s.lean}, let go ${s2.lean}, toggled ${s3.lean}, off ${s5.lean}`);
  await f.tap(2, C.melee, 40); await sleep(60);
  s = await tstate(page);
  check('touch', 'MELEE strikes', s.jab > 0.2, `jab ${s.jab}`);
  const yJ = (await tstate(page)).eyeY;
  await f.down(2, C.jump[0], C.jump[1]); let top = yJ;
  for (let i = 0; i < 8; i++) { await sleep(60); top = Math.max(top, (await tstate(page)).eyeY); }
  await f.up(2); await sleep(600);
  check('touch', 'JUMP jumps', top > yJ + 0.25, `eye rose ${(top - yJ).toFixed(2)} m`);
  // USE: nothing at hand, no button; at the relay door it appears with its label and works
  s = await tstate(page);
  const away = s.use;
  await doorFront(page); await sleep(700);
  s = await tstate(page);
  await page.evaluate(() => window.__mirage.g.game.inventory.add({ id: 'pass', name: 'Relay pass' })); await sleep(400);
  s2 = await tstate(page);
  await page.screenshot({ path: path.join(here, '../out/touch-en-use.png') }).catch(() => {});
  const use = await centre(page, 'use');
  if (use) await f.tap(2, use); await sleep(500);
  s3 = await tstate(page);
  check('touch', 'USE: hidden with nothing at hand, at the door with its label, a tap opens it', away === null && /Locked/.test(s.use || '') && /Open the relay/.test(s2.use || '') && s3.door && s3.use === null, `away ${away}, locked "${s.use}", with the pass "${s2.use}", open ${s3.door}`);
  // the options: the touch settings, kept with the others
  await f.tap(2, C.opt); await sleep(300);
  s = await tstate(page);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.nd-opt [data-k], .nd-opt [data-b]')].map((e) => e.dataset.k || e.dataset.b));
  const fit = await page.evaluate(() => { const r = document.querySelector('.nd-opt').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  await page.evaluate(() => { const r = document.querySelector('.nd-opt input[data-k=tScale]'); r.value = 1.2; r.dispatchEvent(new Event('input')); });
  const close = await page.evaluate(() => { const r = document.querySelector('.nd-opt [data-b=close]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(close[0], close[1]); await sleep(300);
  s2 = await tstate(page);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('mirage:neon-district:settings') || '{}').nd || {});
  const big = await centre(page, 'fire');
  check('touch', 'options: touch sensitivity, opacity, size, left fire, sprint lock; fit the screen; kept; applied', s.panel && s.paused && fit && ['tSens', 'tOpacity', 'tScale', 'leftFire', 'sprintLock'].every((k) => rows.includes(k)) && !s2.panel && !s2.paused && kept.tScale === 1.2 && big[2] > C.fire[2] * 1.15,
    `rows ${rows.join(',')}, fits ${fit}, kept ${JSON.stringify(kept)}, FIRE ${C.fire[2].toFixed(0)} -> ${big[2].toFixed(0)} px`);
  const L = await layoutOf(page);
  check('touch', 'at the largest button size still nothing overlaps at 844 x 390', !L.out.length && !L.over.length, JSON.stringify({ out: L.out, over: L.over }));
  await page.screenshot({ path: path.join(here, '../out/touch-en-125.png') }).catch(() => {});
  // the kit: HACK, DASH, GRENADE, OVERDRIVE
  for (const id of ['hack', 'dash', 'grenade', 'over']) C[id] = await centre(page, id);
  const kitOf = () => page.evaluate(() => { const m = window.__mirage, k = m.game.kit, q = (id) => document.querySelector(`.ndt [data-b="${id}"]`);
    return { held: k.hack.held, prog: k.hack.progress, hacks: m.g.game.flags.hacks || 0, dim: q('hack').classList.contains('dim'), why: q('hack').querySelector('em').textContent, pips: q('hack').querySelectorAll('i u.on').length,
      dash: k.abilities.left('dash'), dashes: m.g.game.flags.dashes || 0, nade: k.abilities.left('grenade'), cd: getComputedStyle(q('dash')).getPropertyValue('--cd'), over: k.abilities.active, overReady: q('over').classList.contains('ready'), overs: m.g.game.flags.overdrives || 0 }; });
  await toSpawn(page); await page.evaluate(() => window.__mirage.play.lookAt([-22, 40, 0])); await sleep(300);
  await f.down(5, C.hack[0], C.hack[1]); await sleep(400);
  let k1 = await kitOf();
  await f.up(5); await sleep(200);
  check('touch', 'HACK held on nothing: dimmed, with the reason', k1.held && k1.dim && k1.why.length > 0 && k1.pips === 3, JSON.stringify({ held: k1.held, dim: k1.dim, why: k1.why, pips: k1.pips }));
  await page.evaluate(() => window.__mirage.play.place([-14.5, 1.62, 8.4], [-17, 5.0, 7.85], 'walk')); await sleep(500);
  await f.down(5, C.hack[0], C.hack[1]); await sleep(450);
  k1 = await kitOf(); await sleep(700);
  const k2 = await kitOf();
  await f.up(5); await sleep(300);
  check('touch', 'HACK held on a street lamp: the ring fills, the hack lands', k1.prog > 0.2 && !k1.dim && k2.hacks >= 1, `ring ${k1.prog.toFixed(2)}, hacks ${k2.hacks}, pips ${k2.pips}`);
  await f.tap(5, C.dash); await sleep(300);
  k1 = await kitOf();
  check('touch', 'DASH dashes, its sweep shows the cooldown', k1.dashes >= 1 && k1.dash > 3 && parseFloat(k1.cd) > 40, `dashes ${k1.dashes}, left ${k1.dash.toFixed(1)} s, sweep ${k1.cd}`);
  await f.tap(5, C.grenade); await sleep(300);
  k1 = await kitOf();
  check('touch', 'GRENADE throws, cooling down', k1.nade > 10, `left ${k1.nade.toFixed(1)} s`);
  await page.evaluate(() => window.__mirage.game.kit.abilities.gain(1)); await sleep(200);
  const ready = (await kitOf()).overReady;
  await f.tap(5, C.over); await sleep(300);
  k1 = await kitOf();
  check('touch', 'OVERDRIVE: its ring full and lit, a tap starts it', ready && k1.over && k1.overs >= 1, `ready ${ready}, active ${k1.over}`);
  // the gun strip: a tap selects, a locked slot stays locked, a swipe cycles
  const slot = (id) => page.evaluate((id) => { const r = document.querySelector(`.ndt-guns [data-g="${id}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
  const held = () => page.evaluate(() => window.__mirage.game.weapon.switchingTo || window.__mirage.game.weapon.id);
  await f.tap(6, await slot('sidearm')); await sleep(700);
  const t1 = await held();
  await f.tap(6, await slot('rocket')); await sleep(700);
  const t2 = await held();
  const sp = await slot('carbine');
  await f.down(6, sp[0] - 30, sp[1]); await f.drag(6, sp[0] - 30, sp[1], 64, 0, 200, 6); await f.up(6); await sleep(700);
  const t3 = await held();
  check('touch', 'the gun strip: a tap selects, a locked slot stays, a swipe cycles', t1 === 'sidearm' && t2 === 'sidearm' && t3 !== 'sidearm', `${t1}, locked tap -> ${t2}, swipe -> ${t3}`);
  // the 0 field in the options
  await f.tap(2, C.opt); await sleep(300);
  await page.evaluate(() => { const i = document.querySelector('.nd-opt [data-c=code]'); i.value = '0'; i.dispatchEvent(new Event('input')); });
  await sleep(200);
  await f.tap(2, C.opt); await sleep(300);
  await f.tap(6, await slot('rocket')); await sleep(800);
  const t4 = await page.evaluate(() => ({ id: window.__mirage.game.weapon.id, unlocked: window.__mirage.game.weapon.unlocked, locked: document.querySelector('.ndt-guns [data-g="rocket"]').classList.contains('locked') }));
  check('touch', 'the options\' code field: 0 unlocks, the strip\'s slot 4 opens and selects', t4.unlocked && !t4.locked && t4.id === 'rocket', JSON.stringify(t4));
  // world markers keep off the buttons: turn round the spawn, the objective's marker never sits on a control
  await toSpawn(page);
  let onButton = 0, shown = 0;
  for (let i = 0; i < 16; i++) {
    const r = await page.evaluate((i) => { const m = window.__mirage; m.play.yaw = i * Math.PI / 8; m.play.pitch = -0.35 + (i % 4) * 0.15; return true; }, i); void r;
    await sleep(120);
    const hit = await page.evaluate(() => { const el = document.querySelector('.nd-mark'); if (!el || el.hidden) return null; const b = el.getBoundingClientRect(), op = +getComputedStyle(el).opacity; const rs = window.__mirage.game.touch.rects(); return { op, on: rs.filter(([n]) => n !== 'stick' && n !== 'lock').some(([, l, t, r, bb]) => b.left < r && l < b.right && b.top < bb && t < b.bottom) }; });
    if (hit) { shown++; if (hit.on && hit.op > 0.3) onButton++; }
  }
  check('touch', 'no world marker drawn on a button (it moves above it or fades)', shown > 0 && onButton === 0, `shown in ${shown} of 16 views, on a button ${onButton}`);
  check('touch', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
if (want('touch')) { // ---- the same HUD in Traditional Chinese: the screenshots, the USE label
  const b = await launch({ w: 844, h: 390, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, 'start=1&lang=zh', { mobile: true });
  const f = await fingersOf(page);
  await f.tap(1, [520, 140]); await sleep(600);
  const L = await layoutOf(page);
  await page.screenshot({ path: path.join(here, '../out/touch-zh.png') }).catch(() => {});
  await doorFront(page); await sleep(700);
  const s = await tstate(page);
  const fit = await page.evaluate(() => { const u = document.querySelector('.ndt-use'), r = u.getBoundingClientRect(), t = u.querySelector('span'); return r.left >= 0 && r.right <= innerWidth && t.scrollHeight <= t.clientHeight + 1; });
  await page.screenshot({ path: path.join(here, '../out/touch-zh-use.png') }).catch(() => {});
  check('touch-zh', 'the touch HUD in Chinese: nothing overlaps, USE shows its label whole', !L.out.length && !L.over.length && /上鎖/.test(s.use || '') && fit, `use "${s.use}", ${JSON.stringify({ out: L.out, over: L.over })}`);
  check('touch-zh', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
srv.close?.();
console.log(rows.join('\n'));
console.log(`neon-district controls: ${rows.length - failed} / ${rows.length} -> ${failed ? 'FAIL' : 'ok'}`);
process.exit(failed ? 1 : 0);

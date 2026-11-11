#!/usr/bin/env node
// Check: the shooter's front end and controls beyond the keyboard, in the real Chrome with real events.
//   title  without ?start=1: the title is up, the game paused and harmless, the camera flies; the keys change the
//          mode and the difficulty (kept in the settings), Enter on DEPLOY starts the holdout on the relay roof
//   holdout  ?start=1&mode=holdout&assist=1 for 40 s, a scripted gunner on the roof: a wave cleared or under way
//   keys   C crouches, X leans, O opens the options panel (and a setting applies)
//   pad    a standard-mapping gamepad (an injected Gamepad API shim): the d-pad works the title, A deploys, the stick walks, the right trigger fires, the
//          left trigger aims, the right bumper reloads, Start opens the menu and B closes it
//   touch  an emulated phone held sideways (844 x 390, touch): the title fits, a tap on DEPLOY starts, the overlay's stick, the example's
//          FIRE (held), AIM (toggle) and RLD buttons
// usage: node scripts/controls-check.mjs [dist]      (build first: npm run build -w neon-district)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let failed = 0;
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

{ // ---- the title: up, paused and harmless; the keys choose; Enter deploys
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
{ // ---- the holdout, 40 s, a scripted gunner: it turns to the nearest sentinel or kite on the roof and holds F
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

{ // ---- keyboard extras: crouch, lean, the options panel
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
  check('keys', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
{ // ---- gamepad
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
  check('pad', 'no console errors', errors.length === 0, errors[0] || '');
  await b.close();
}
{ // ---- touch
  const b = await launch({ w: 844, h: 390, args: ['--autoplay-policy=no-user-gesture-required'] });
  const { page, errors } = await open(b, '', { mobile: true });
  const fits = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), m = r('.nt-main'), l = r('.nt-legend'), rows = [...document.querySelectorAll('.nt-row')].map((e) => e.getBoundingClientRect());
    return { inside: [m, l].every((b) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight), apart: l.left >= m.right || l.top >= m.bottom, rows: Math.min(...rows.map((b) => b.height)) }; });
  check('touch', 'the title fits a phone held sideways', fits.inside && fits.apart && fits.rows >= 34, JSON.stringify(fits));
  const go = await page.evaluate(() => { const r = document.querySelector('.nt-row.go').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(go[0], go[1]); await sleep(500);
  let s = await state(page);
  check('touch', 'a tap on DEPLOY starts the game', s.started && s.touch, `touch overlay ${s.touch}`);
  const box = async (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2, r.width] : null; }, sel);
  const fire = await box('.nd-fire'), aim = await box('.nd-aim'), rel = await box('.nd-rel'), stick = await box('.mg-stick');
  check('touch', 'FIRE, AIM and RLD are on screen', !!(fire && aim && rel) && fire[0] < 844 && fire[1] < 390 && fire[2] >= 60, JSON.stringify({ fire, aim, rel }));
  if (fire && stick) {
    const p0 = s.pos;
    await page.touchscreen.touchStart(stick[0], stick[1]); await page.touchscreen.touchMove(stick[0], stick[1] - stick[2] * 0.45); await sleep(900); await page.touchscreen.touchEnd(); await sleep(200);
    s = await state(page);
    check('touch', 'the stick walks', Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]) > 0.8, `moved ${Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]).toFixed(2)} m`);
    await page.touchscreen.touchStart(fire[0], fire[1]); await sleep(600); await page.touchscreen.touchEnd(); await sleep(150);
    s = await state(page);
    check('touch', 'FIRE held fires', s.mag < 24 && s.mag > 10, `magazine ${s.mag}`);
    await page.touchscreen.tap(aim[0], aim[1]); await sleep(500);
    s = await state(page);
    check('touch', 'AIM toggles the sight', s.ads > 0.8, `aim ${s.ads}`);
    await page.touchscreen.tap(aim[0], aim[1]); await sleep(100);
    await page.touchscreen.tap(rel[0], rel[1]); await sleep(2100);
    s = await state(page);
    check('touch', 'RLD reloads', s.mag === 24 && s.reloads === 1, `magazine ${s.mag}, reloads ${s.reloads}`);
  }
  check('touch', 'no console errors', errors.length === 0, errors[0] || '');
  await page.screenshot({ path: path.join(here, '../out/touch.png') }).catch(() => {});
  await b.close();
}
srv.close?.();
console.log(rows.join('\n'));
console.log(`neon-district controls: ${rows.length - failed} / ${rows.length} -> ${failed ? 'FAIL' : 'ok'}`);
process.exit(failed ? 1 : 0);

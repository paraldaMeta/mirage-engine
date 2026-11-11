// Check and measurements of the UI toolkit's demo (examples/demos/ui): the whole flow played three times, with a
// keyboard, a touch screen and a (faked) gamepad, then the languages, and what the HUD costs a frame.
// node examples/demos/ui/ui-check.mjs [--only keyboard,touch,gamepad,locale,perf] [--rounds 5] [--frames 180] [--out file.json]
// Builds the page into out/dist (vite), serves it, opens it in headless Chrome (GPU on) and:
//   keyboard  walk, prompt, dialogue with a choice, inventory pick-and-place, focus trap, settings (tabs, language,
//             theme, text size, key rebinding, a 2000-row virtual list, text input), quick wheel, the screen in the world
//   touch     touch controls (stick, buttons), inventory drag and drop with a finger, touch target sizes
//   gamepad   Start / d-pad / A / B / RB / Y / X through navigator.getGamepads (a fake pad), glyphs follow the device
//   locale    zh-Hant and ar: lang, dir, mirrored layout, the font stack, no key left untranslated
//   perf      layouts and style recalculations per frame with the HUD idle and moving (Chrome's own counters), and
//             the frame's cost with the HUD on, hidden and absent (?hud=0), interleaved
//   menu      (only when named: --only menu; needs examples/snow-hut/dist) createKitUI as startGame's overlay on
//             snow-hut ?ui=kit: start screen, HUD, pause menu and its tabs, a message, with the keyboard
// Exit 1 if a step fails or a page logs an error.
/* global __ui, __mirage, __pad */   // page globals, used inside page.evaluate()
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = flag('only', 'keyboard,touch,gamepad,locale,perf').split(','), ROUNDS = +flag('rounds', 5), FRAMES = +flag('frames', 180);
const DIST = path.join(here, 'out/dist'), W = 1280, H = 720;
const failures = [], results = {};
const fail = (m) => { failures.push(m); console.log('FAIL ' + m); };
const ok = (cond, m) => { if (cond) console.log('  ok  ' + m); else fail(m); return !!cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await build({ root: here, logLevel: 'warn', configFile: false, build: { outDir: DIST, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1e5 } });
const srv = await serve(DIST);
const browser = await launch({ w: W, h: H });

async function open(query, { viewport, before } = {}) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  if (before) await page.evaluateOnNewDocument(before);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(srv.url + '?' + query, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 30000 });
  const p = {
    page, errors,
    ev: (f, ...a) => page.evaluate(f, ...a),
    frames: (n = 2) => page.evaluate((k) => new Promise((r) => { const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n),
    until: (f, ms = 3000, ...a) => page.waitForFunction(f, { timeout: ms, polling: 50 }, ...a).then(() => true, () => false),
    key: async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k, { delay: 40 }); await p.frames(2); } },
    place: (x, z, yaw = 0) => page.evaluate((x2, z2, y2) => { Object.assign(__ui.player, { x: x2, z: z2, yaw: y2, pitch: 0 }); }, x, z, yaw).then(() => p.frames(3)),
    centre: (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }, sel),
    done: async (name) => { ok(errors.length === 0, `${name}: no page errors${errors.length ? ' (' + errors.slice(0, 3).join(' | ') + ')' : ''}`); await page.close(); },
  };
  return p;
}
const focusIn = (sel) => { const a = document.activeElement; return !!(a && a.closest(sel)); };
const slotIds = () => __ui.state.slots.peek().map((s) => (s ? s.id : ''));

// ---------------------------------------------------------------- keyboard
if (ONLY.includes('keyboard')) {
  console.log('keyboard');
  const p = await open('');
  ok(await p.ev(() => document.querySelectorAll('.mk-layer-hud [role=meter]').length === 2 && !!document.querySelector('.mk-minimap') && document.querySelectorAll('.mk-objectives li').length === 3), 'HUD: two meters, minimap, three objectives');
  ok(await p.ev(() => document.querySelectorAll('.mk-root [aria-live]').length >= 2), 'live regions for screen readers');
  const z0 = await p.ev(() => __ui.player.z);
  await p.page.keyboard.down('KeyW'); await sleep(400); await p.page.keyboard.up('KeyW');
  ok(await p.ev((z) => __ui.player.z < z - 0.5, z0), 'W walks forward');
  await p.place(-3, 1.6);
  ok(await p.until(() => { const e = document.querySelector('.mk-layer-hud .mk-prompt'); return e && /Talk to Ana/.test(e.textContent) && /^E/.test(e.textContent); }), 'near Ana: the prompt shows "E Talk to Ana"');
  await p.key('KeyE');
  ok(await p.until(() => !!document.querySelector('.mk-dialogue') && __ui.kit.nav.depth === 1), 'E opens the dialogue (a focus scope)');
  ok(await p.ev(() => document.querySelector('.mk-layer-hud').hasAttribute('inert') || __ui.kit.nav.depth === 1), 'the game does not get the keys while it is open');
  const shownEarly = await p.ev(() => document.querySelector('.mk-dialogue-text span').textContent.length);
  await p.key('Enter');   // completes the typing
  ok(await p.ev(() => document.querySelector('.mk-dialogue-text .mk-unseen').textContent === ''), `Enter completes the typewriter (was at ${shownEarly} characters)`);
  await p.key('Enter');   // next line
  await p.key('Enter');   // completes it: the choices appear
  ok(await p.until(() => document.querySelectorAll('.mk-choices button').length === 2 && document.activeElement === document.querySelector('.mk-choices button')), 'two choices, the first focused');
  await p.key('ArrowDown');
  ok(await p.ev(() => document.activeElement === document.querySelectorAll('.mk-choices button')[1]), 'arrow down moves to the second choice');
  await p.key('Enter');
  ok(await p.until(() => /herbs/.test(document.querySelector('.mk-dialogue-text')?.getAttribute('aria-label') || '')), 'the answer to the second choice');
  await p.key('Enter'); await p.key('Enter');
  ok(await p.until(() => !document.querySelector('.mk-dialogue') && __ui.kit.nav.depth === 0), 'the dialogue closes after its last line');
  ok(await p.ev(() => __ui.state.done.peek().talk === true && __ui.state.slots.peek().some((s) => s && s.id === 'key') && document.querySelector('.mk-objectives li.mk-done') !== null), 'objective done, the key is in the inventory');
  ok(await p.ev(() => /Gate key/.test(document.querySelector('.mk-toasts')?.textContent || '')), 'a notification says so');

  // inventory: pick-and-place, focus trap
  await p.key('KeyI');
  ok(await p.until(() => !!document.querySelector('.mk-modal[role=dialog][aria-modal=true] .mk-inv') && document.querySelector('.mk-layer-hud').hasAttribute('inert')), 'I opens the inventory: a modal dialog, the HUD inert');
  await p.ev(() => document.querySelector('[data-slot="0"]').focus());
  const before = await p.ev(slotIds);
  await p.key('Enter'); await p.key('ArrowRight', 2); await p.key('ArrowDown');
  ok(await p.ev(() => document.activeElement.dataset.slot === '7'), 'arrows move over the grid by geometry (slot 1 -> right, right, down -> slot 8)');
  await p.key('ArrowLeft'); await p.key('Enter');
  const after = await p.ev(slotIds);
  ok(before[0] === 'lamp' && after[0] === '' && after[6] === 'lamp', 'Enter picks the lamp up and puts it down in slot 7');
  let trapped = true;
  for (let i = 0; i < 26 && trapped; i++) { await p.page.keyboard.press('Tab'); trapped = await p.ev(focusIn, '.mk-modal'); }
  ok(trapped, 'Tab stays inside the modal (26 presses)');
  // mouse drag: slot 2 (rope) onto slot 10
  const a = await p.centre('[data-slot="1"]'), b = await p.centre('[data-slot="10"]');
  await p.page.mouse.move(a[0], a[1]); await p.page.mouse.down(); await p.page.mouse.move(a[0] + 12, a[1] + 12, { steps: 3 });
  const ghost = await p.ev(() => !!document.querySelector('.mk-drag-ghost'));
  await p.page.mouse.move(b[0], b[1], { steps: 6 }); await p.page.mouse.up(); await p.frames(2);
  ok(ghost && (await p.ev(slotIds))[10] === 'rope', 'the mouse drags the rope to slot 11 (a ghost follows)');
  await p.key('Escape');
  ok(await p.until(() => __ui.kit.nav.depth === 0 && !document.querySelector('.mk-layer-hud').hasAttribute('inert')), 'Escape closes it');

  // settings
  await p.key('Escape');
  ok(await p.until(() => !!document.querySelector('.mk-demo-menu') && document.activeElement?.dataset.menu === 'resume'), 'Escape opens the settings, Resume focused');
  ok(await p.ev(() => document.querySelectorAll('[role=tab]').length === 4 && document.querySelector('[role=tab][aria-selected=true]').textContent === 'Display'), 'four tabs');
  await p.ev(() => document.querySelector('[data-setting=textScale] [role=slider]').focus());
  const fs0 = await p.ev(() => parseFloat(getComputedStyle(__ui.kit.root).fontSize));
  await p.key('ArrowRight', 3);
  const fs1 = await p.ev(() => parseFloat(getComputedStyle(__ui.kit.root).fontSize));
  ok(Math.abs(fs1 / fs0 - 1.3) < 0.02, `text size slider: ${fs0.toFixed(1)} px -> ${fs1.toFixed(1)} px`);
  await p.key('ArrowLeft', 3);
  await p.ev(() => document.querySelector('[data-setting=theme] [role=spinbutton]').focus());
  await p.key('ArrowRight');
  ok(await p.ev(() => __ui.kit.root.dataset.theme === 'light' && getComputedStyle(__ui.kit.root).colorScheme === 'light'), 'theme select: light');
  await p.key('ArrowLeft');
  await p.ev(() => document.querySelector('[data-setting=motion]').click());
  ok(await p.ev(() => __ui.kit.root.dataset.motion === 'reduced'), 'reduce motion');
  await p.ev(() => document.querySelector('[data-setting=motion]').click());
  await p.ev(() => document.querySelector('.mk-input').focus());
  await p.page.keyboard.type('Wei q e');
  ok(await p.ev(() => __ui.state.name.peek() === 'Wei q e' && document.querySelector('[role=tab][aria-selected=true]').textContent === 'Display'), 'text input takes letters that are shortcuts elsewhere (q, e)');
  await p.ev(() => document.querySelector('[data-menu=resume]').focus());
  await p.key('KeyE');
  ok(await p.ev(() => document.querySelector('[role=tab][aria-selected=true]').textContent === 'Controls' && !!document.querySelector('.mk-rebind')), 'E goes to the next tab');
  await p.ev(() => document.querySelector('.mk-key[data-action=jump]').focus());
  await p.key('Enter');
  ok(await p.ev(() => /Press a key/.test(document.querySelector('.mk-key[data-action=jump]').textContent)), 'rebinding waits for a key');
  await p.key('KeyJ');
  ok(await p.ev(() => __ui.input.bindings.jump[0] === 'KeyJ' && document.querySelector('.mk-key[data-action=jump]').textContent === 'J'), 'jump is now J');
  await p.ev(() => document.querySelector('.mk-key[data-action=inventory]').focus());
  await p.key('Enter'); await p.key('ArrowUp');
  ok(await p.ev(() => __ui.input.bindings.inventory[0] === 'ArrowUp' && document.activeElement.dataset.action === 'inventory'), 'an arrow can be bound (it does not move focus while captured)');
  await p.key('Enter'); await p.key('KeyI');
  await p.key('KeyE', 2);
  ok(await p.ev(() => document.querySelector('[role=tab][aria-selected=true]').textContent === 'Log'), 'two tabs on: the log');
  ok(await p.ev(() => { const n = document.querySelectorAll('.mk-vrow').length; return n > 4 && n < 20 && +document.querySelector('.mk-vrow').getAttribute('aria-setsize') === 2000; }), 'the list of 2000 mounts fewer than 20 rows');
  await p.ev(() => document.querySelector('.mk-vlist').focus());
  await p.key('End');
  ok(await p.until(() => [...document.querySelectorAll('.mk-vrow')].some((r) => /2,000/.test(r.textContent)) && document.querySelector('.mk-vlist').scrollTop > 1000), 'End reveals row 2,000');
  await p.key('Escape');
  ok(await p.until(() => __ui.kit.nav.depth === 0), 'Escape closes the settings');

  // quick wheel
  await p.key('KeyQ');
  ok(await p.until(() => document.querySelectorAll('.mk-radial-item[role=menuitem]').length === 6), 'Q opens the wheel');
  await p.key('ArrowRight', 2); await p.key('Enter');
  ok(await p.until(() => __ui.kit.nav.depth === 0 && /You chose/.test(document.querySelector('.mk-toasts').textContent)), 'arrows and Enter pick from it');

  // the screen in the world
  await p.place(0, -3.3);
  ok(await p.until(() => __ui.state.near.peek() === 'use'), 'near the generator');
  const paints0 = await p.ev(() => __ui.screen.stats.paints);
  await p.key('KeyE');
  ok(await p.until(() => __ui.state.power.peek() === true && __ui.state.done.peek().power === true), 'E presses the focused widget of the canvas panel: power on');
  const hit = await p.ev(() => {   // the Vent button's centre, from the panel's boxes through the mesh to the screen
    const s = __ui.screen, b = s.boxes.find((x) => x.node.type === 'button'), m = __ui.panel;
    const g = m.geometry.parameters, v = m.localToWorld(new m.position.constructor(((b.x + b.w / 2) / 512 - 0.5) * g.width, (0.5 - (b.y + b.h / 2) / 320) * g.height, 0)).project(__ui.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  });
  await p.page.mouse.click(hit[0], hit[1]); await p.frames(3);
  ok(await p.until(() => /Vented/.test(document.querySelector('.mk-toasts').textContent)), 'a mouse click on the panel in the world presses its button (raycast -> uv -> widget)');
  ok(await p.ev((n) => __ui.screen.stats.paints > n && __ui.screen.stats.paints < n + 12, paints0), 'the panel repaints only when something changed');
  fs.mkdirSync(path.join(here, 'out'), { recursive: true });
  await p.page.screenshot({ path: path.join(here, 'out/keyboard-end.png') });
  await p.done('keyboard');
}

// ---------------------------------------------------------------- touch
if (ONLY.includes('touch')) {
  console.log('touch');
  const p = await open('touch=1', { viewport: { width: 844, height: 390, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } });
  const T = p.page.touchscreen;
  ok(await p.ev(() => !!document.querySelector('[data-touch=stick]') && !!document.querySelector('[data-touch=inventory]') && !!document.querySelector('[data-touch=interact]')), 'touch controls on screen');
  const s = await p.centre('[data-touch=stick]'), z0 = await p.ev(() => __ui.player.z);
  await T.touchStart(s[0], s[1]); await T.touchMove(s[0], s[1] - 45); await sleep(450); await T.touchEnd(); await p.frames(3);
  const z1 = await p.ev(() => __ui.player.z);
  ok(z1 < z0 - 0.4, `the stick walks (${(z0 - z1).toFixed(2)} m)`);
  await sleep(150);
  ok(Math.abs((await p.ev(() => __ui.player.z)) - z1) < 0.05, 'and stops when the finger lifts');
  ok(await p.ev(() => __ui.kit.root.dataset.device === 'touch'), 'device: touch');
  const tap = async (sel) => { const c = await p.centre(sel); await T.tap(c[0], c[1]); await p.frames(3); };
  await p.place(-3, 1.6);
  await tap('[data-touch=interact]');
  ok(await p.until(() => !!document.querySelector('.mk-dialogue')), 'the interact button talks');
  await tap('.mk-dialogue-text'); await tap('.mk-dialogue-text'); await tap('.mk-dialogue-text');
  ok(await p.until(() => document.querySelectorAll('.mk-choices button').length === 2), 'taps on the box go through the lines to the choices');
  await tap('.mk-choices button'); await tap('.mk-dialogue-text'); await tap('.mk-dialogue-text');
  ok(await p.until(() => !document.querySelector('.mk-dialogue') && __ui.state.done.peek().talk), 'a tap chooses; the dialogue ends');
  await tap('[data-touch=inventory]');
  ok(await p.until(() => !!document.querySelector('.mk-modal .mk-inv')), 'the bag button opens the inventory');
  await sleep(300);   // the modal's entrance scales it: measure it at rest
  const small = await p.ev(() => [...document.querySelectorAll('.mk-modal button, .mk-layer-hud button, .mk-tbtn')].filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h2]) => w < 44 || h2 < 44));
  ok(small.length === 0, 'every button is at least 44 x 44 px under a finger' + (small.length ? ' (' + JSON.stringify(small.slice(0, 4)) + ')' : ''));
  const a = await p.centre('[data-slot="0"]'), b = await p.centre('[data-slot="9"]');
  await T.touchStart(a[0], a[1]);
  for (let i = 1; i <= 6; i++) { await T.touchMove(a[0] + (b[0] - a[0]) * i / 6, a[1] + (b[1] - a[1]) * i / 6); await sleep(16); }
  const ghost = await p.ev(() => !!document.querySelector('.mk-drag-ghost'));
  await T.touchEnd(); await p.frames(3);
  ok(ghost && (await p.ev(slotIds))[9] === 'lamp', 'a finger drags the lamp from slot 1 to slot 10');
  await tap('.mk-modal .mk-btn');
  ok(await p.until(() => __ui.kit.nav.depth === 0), 'Close closes');
  await tap('[data-touch=wheel]');
  ok(await p.until(() => document.querySelectorAll('.mk-radial-item').length === 6), 'the wheel opens');
  await tap('.mk-radial-item:nth-child(3)');
  ok(await p.until(() => __ui.kit.nav.depth === 0 && /You chose: Map/.test(document.querySelector('.mk-toasts').textContent)), 'a tap picks from it');
  await p.page.screenshot({ path: path.join(here, 'out/touch-end.png') });
  await p.done('touch');
}

// ---------------------------------------------------------------- gamepad
if (ONLY.includes('gamepad')) {
  console.log('gamepad');
  const p = await open('', { before: () => {
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null];
  } });
  const press = async (i, n = 1) => { for (let k = 0; k < n; k++) { await p.ev((b) => { __pad.buttons[b] = { pressed: true, value: 1, touched: true }; }, i); await p.frames(3); await p.ev((b) => { __pad.buttons[b] = { pressed: false, value: 0, touched: false }; }, i); await p.frames(3); } };
  await p.place(-3, 1.6);
  await press(2);
  ok(await p.until(() => !!document.querySelector('.mk-dialogue') && __ui.kit.root.dataset.device === 'gamepad'), 'X talks; device: gamepad');
  ok(await p.ev(() => document.querySelector('.mk-dialogue-foot .mk-glyph').textContent === 'A'), 'the Continue button shows the A glyph');
  await press(0, 3);
  ok(await p.until(() => document.querySelectorAll('.mk-choices button').length === 2), 'A goes through the lines');
  await press(0); await press(0, 2);
  ok(await p.until(() => !document.querySelector('.mk-dialogue') && __ui.state.done.peek().talk), 'A chooses and ends it');
  await p.frames(4);
  ok(await p.ev(() => /^Y/.test(document.querySelector('[data-hud=hints] .mk-prompt').textContent)), 'HUD hints switched to pad glyphs (Y Inventory)');
  await press(3);
  ok(await p.until(() => !!document.querySelector('.mk-modal .mk-inv')), 'Y opens the inventory');
  await p.ev(() => document.querySelector('[data-slot="0"]').focus());
  await press(0); await press(15, 2); await press(0);
  ok((await p.ev(slotIds))[2] === 'lamp', 'A picks up, d-pad moves, A puts down');
  await press(1);
  ok(await p.until(() => __ui.kit.nav.depth === 0), 'B closes');
  await press(9);
  ok(await p.until(() => !!document.querySelector('.mk-demo-menu')), 'Start opens the settings');
  await press(5);
  ok(await p.ev(() => document.querySelector('[role=tab][aria-selected=true]').textContent === 'Controls'), 'RB: next tab');
  await press(4);
  await p.ev(() => document.querySelector('[data-setting=language] [role=spinbutton]').focus());
  await press(15);
  ok(await p.ev(() => __ui.kit.root.lang === 'zh-Hant' && document.querySelector('[role=tab][aria-selected=true]').textContent === '顯示'), 'd-pad right on the language: Traditional Chinese at once');
  await press(14);
  // held, not timed by frames: the repeat runs on the clock, and a slow headless frame would carry focus past the
  // buttons and round again
  await p.ev(() => { __pad.axes[1] = 1; });
  const reached = await p.until(() => !!document.activeElement.dataset.menu);
  await p.ev(() => { __pad.axes[1] = 0; });
  ok(reached, 'the held stick repeats down to the buttons');
  await press(1);
  ok(await p.until(() => __ui.kit.nav.depth === 0), 'B closes the settings');
  const z0 = await p.ev(() => __ui.player.z);
  await p.ev(() => { __pad.axes[1] = -1; }); await p.frames(25); await p.ev(() => { __pad.axes[1] = 0; });
  ok(await p.ev((z) => __ui.player.z < z - 0.5, z0), 'and the stick is the game\'s again');
  await p.done('gamepad');
}

// ---------------------------------------------------------------- languages
if (ONLY.includes('locale')) {
  console.log('locale');
  for (const [lang, dir, word] of [['zh-Hant', 'ltr', '目標'], ['ar', 'rtl', 'الأهداف']]) {
    const p = await open('lang=' + lang);
    ok(await p.ev((l, d) => __ui.kit.root.lang === l && __ui.kit.root.dir === d, lang, dir), `${lang}: lang and dir=${dir}`);
    ok(await p.ev((w) => document.querySelector('.mk-objectives h3').textContent === w, word), `${lang}: the tracker's title is ${word}`);
    const bars = await p.centre('[data-hud=bars]'), map = await p.centre('.mk-minimap');
    ok(dir === 'rtl' ? bars[0] > W / 2 && map[0] < W / 2 : bars[0] < W / 2 && map[0] > W / 2, `${lang}: the bars are at the ${dir === 'rtl' ? 'right' : 'left'}, the minimap opposite`);
    const miss = await p.ev(() => [...__ui.kit.i18n.missing]);
    ok(miss.length === 0, `${lang}: no key fell back to English${miss.length ? ' (' + miss.slice(0, 6).join(', ') + ')' : ''}`);
    const font = await p.ev(() => getComputedStyle(__ui.kit.root).fontFamily);
    ok(lang === 'ar' ? /Arab|Naskh|Geeza/i.test(font) : /TC|JhengHei|PingFang/i.test(font), `${lang}: the font stack names fonts of the script (${font.slice(0, 60)}…)`);
    await p.place(-3, 1.6); await p.key('KeyE'); await p.key('Enter');
    ok(await p.ev(() => document.querySelector('.mk-dialogue-text .mk-unseen').textContent === '' && document.querySelector('.mk-dialogue-text span').textContent.length > 10), `${lang}: the dialogue line shows`);
    if (lang === 'zh-Hant') {
      const lines = await p.ev(() => { const e = document.querySelector('.mk-dialogue-text'), s = getComputedStyle(e); return [s.lineBreak, s.wordBreak, e.getClientRects().length, e.scrollWidth <= e.clientWidth + 1]; });
      ok(lines[3], `zh-Hant: the line wraps inside the box (line-break: ${lines[0]})`);
    }
    await p.page.screenshot({ path: path.join(here, `out/locale-${lang}.png`) });
    await p.done(lang);
  }
}

// ---------------------------------------------------------------- what it costs
if (ONLY.includes('perf')) {
  console.log('perf');
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const spread = (a) => `${med(a).toFixed(3)} (${Math.min(...a).toFixed(3)}-${Math.max(...a).toFixed(3)})`;
  // one stretch of n frames: Chrome's counters and the page's own timers, per frame
  const stretch = async (p, n) => {
    await p.frames(20);
    const m0 = await p.page.metrics(), f0 = await p.ev(() => ({ ...__ui.frame, w: window.__kitWrites ? 0 : 0 }));
    await p.frames(n);
    const m1 = await p.page.metrics(), f1 = await p.ev(() => ({ ...__ui.frame }));
    const k = f1.n - f0.n;
    return { frames: k, layouts: (m1.LayoutCount - m0.LayoutCount) / k, recalcs: (m1.RecalcStyleCount - m0.RecalcStyleCount) / k, layoutMs: (m1.LayoutDuration - m0.LayoutDuration) * 1000 / k, styleMs: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 / k,
      scriptMs: (m1.ScriptDuration - m0.ScriptDuration) * 1000 / k, taskMs: (m1.TaskDuration - m0.TaskDuration) * 1000 / k, uiMs: (f1.ui - f0.ui) / k, frameMs: (f1.total - f0.total) / k };
  };
  const p = await open('');
  await sleep(4500);   // the first toasts and transitions are over
  const idle = await stretch(p, FRAMES);
  ok(idle.layouts === 0, `HUD idle (the world bar animating): ${idle.layouts.toFixed(3)} layouts and ${idle.recalcs.toFixed(3)} style recalculations a frame over ${idle.frames} frames`);
  await p.ev(() => __ui.setAuto(true));
  const moving = await stretch(p, FRAMES);
  console.log(`  info moving (labels, minimap, a distance read-out in metres): ${moving.layouts.toFixed(3)} layouts a frame (${moving.layoutMs.toFixed(4)} ms), ${moving.recalcs.toFixed(3)} style recalculations (${moving.styleMs.toFixed(4)} ms)`);
  ok(moving.layouts <= 0.25, 'moving: a layout at most every fourth frame (the distance text changing; nothing else)');
  // HUD shown against hidden, in turn, in the same page; and a page without the toolkit as the floor
  const q = await open('hud=0&auto=1');
  const on = [], off = [], none = [];
  for (let r = 0; r < ROUNDS; r++) {
    await p.page.bringToFront();   // a page behind another gets no frames
    await p.ev(() => __ui.setHud(true)); on.push(await stretch(p, FRAMES));
    await p.ev(() => __ui.setHud(false)); off.push(await stretch(p, FRAMES));
    await q.page.bringToFront(); none.push(await stretch(q, FRAMES)); await p.page.bringToFront();
  }
  const col = (a, k) => a.map((x) => x[k]);
  console.log(`  info HUD on:     UI work ${spread(col(on, 'uiMs'))} ms a frame, frame callback ${spread(col(on, 'frameMs'))} ms, main thread ${spread(col(on, 'taskMs'))} ms`);
  console.log(`  info HUD hidden: UI work ${spread(col(off, 'uiMs'))} ms a frame, frame callback ${spread(col(off, 'frameMs'))} ms, main thread ${spread(col(off, 'taskMs'))} ms`);
  console.log(`  info no toolkit: frame callback ${spread(col(none, 'frameMs'))} ms, main thread ${spread(col(none, 'taskMs'))} ms   (median (min-max) of ${ROUNDS} rounds of ${FRAMES} frames)`);
  ok(med(col(on, 'uiMs')) < 1, `the HUD's own work is under 1 ms a frame (${med(col(on, 'uiMs')).toFixed(3)} ms)`);
  results.perf = { rounds: ROUNDS, frames: FRAMES, idle, moving, on, off, none };
  await q.done('no toolkit');
  await p.done('perf');
}

// ---------------------------------------------------------------- the toolkit's overlay through startGame
if (ONLY.includes('menu')) {
  console.log('menu');
  const hut = path.join(here, '../../snow-hut/dist');
  if (!fs.existsSync(path.join(hut, 'index.html'))) fail('menu: build examples/snow-hut first (npm run build -w snow-hut)');
  else {
    const hs = await serve(hut), page = await browser.newPage(), errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(hs.url + '?ui=kit&spp=2', { waitUntil: 'load' });
    await page.waitForFunction('window.__READY === true', { timeout: 120000 });
    const ev = (f, ...a) => page.evaluate(f, ...a), until = (f, ms = 4000) => page.waitForFunction(f, { timeout: ms, polling: 50 }).then(() => true, () => false);
    ok(await ev(() => !!document.querySelector('.mk-root .mk-start') && !__mirage.g.ui.started && document.activeElement.tagName === 'BUTTON'), 'the start screen is the toolkit\'s, its button focused');
    await page.keyboard.press('Enter');
    ok(await until(() => __mirage.g.ui.started && __mirage.g.ui.kit.nav.depth === 0 && !__mirage.g.game.paused), 'Enter starts');
    ok(await ev(() => !!document.querySelector('.mk-objective') && document.querySelector('.mk-objective').textContent.length > 3), 'the objective shows');
    await page.keyboard.press('Escape');
    ok(await until(() => __mirage.g.ui.open && __mirage.g.game.paused && document.activeElement.dataset.menu === 'resume'), 'Escape pauses; Resume is focused');
    ok(await ev(() => document.querySelector('[data-menu=resume] .mk-glyph').textContent === 'Esc'), 'Resume shows Esc (not the walk-back key)');
    const tabs = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyE'); await sleep(200); tabs.push(await ev(() => [document.querySelector('[role=tab][aria-selected=true]').textContent, document.querySelector('[role=tabpanel]').innerText.length])); }
    ok(tabs.map((x) => x[0]).join() === 'Controls,Audio,Display' && tabs.every((x) => x[1] > 20), `E walks the tabs (${tabs.map((x) => x[0]).join(', ')})`);
    await page.keyboard.press('Escape');
    ok(await until(() => !__mirage.g.ui.open && !__mirage.g.game.paused && __mirage.g.input.enabled), 'Escape resumes; the keys are the game\'s again');
    await ev(() => __mirage.g.ui.message('A note', 'Pinned to the door.', 'Close'));
    ok(await until(() => __mirage.g.ui.open && /Pinned to the door/.test(document.querySelector('[role=dialog]').textContent)), 'message() opens a dialog');
    await page.keyboard.press('Enter');
    ok(await until(() => !__mirage.g.ui.open && !__mirage.g.game.paused), 'Enter closes it');
    await page.screenshot({ path: path.join(here, 'out/menu-end.png') });
    ok(errors.length === 0, `menu: no page errors${errors.length ? ' (' + errors.slice(0, 3).join(' | ') + ')' : ''}`);
    await page.close(); hs.close();
  }
}

await browser.close(); srv.close();
if (flag('out')) fs.writeFileSync(flag('out'), JSON.stringify(results, null, 1));
console.log(failures.length ? `\n${failures.length} FAILED:\n  ` + failures.join('\n  ') : '\nui check: all passed');
process.exit(failures.length ? 1 : 0);

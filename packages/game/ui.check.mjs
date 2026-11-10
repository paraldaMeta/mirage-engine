// Node checks of the UI toolkit's layout-independent logic: the reactive core, localisation (plural rules, RTL,
// line breaking), the focus graph, glyphs, inventory moves, the virtual list window, the radial sectors, world-space
// projection, the canvas panel (layout, input, repaint only on change) and the themes' contrast and colour-blind
// separation. No DOM: the demo's browser check (examples/demos/ui/ui-check.mjs) covers what needs one.
import * as THREE from 'three';
import { signal, computed, memo, effect, batch, scope, store, untracked } from './src/ui-reactive.js';
import { createI18n, wrapText, breakPieces, graphemes, textDirection, fontStack } from './src/ui-i18n.js';
import { LOCALES, LOCALE_NAMES } from './src/ui-locales.js';
import { nextFocus, buildFocusGraph, glyphFor, padKind } from './src/ui-nav.js';
import { DEFAULT_BINDINGS } from './src/input.js';
import { THEMES, contrastRatio, over, simulateCVD, colorDistance, computeScale, themeCSS, parseColor } from './src/ui-kit.js';
import { moveItem, virtualRange, radialIndex, revealCount } from './src/ui-widgets.js';
import { projectPoint, clampToEdge, worldFade } from './src/ui-world.js';
import { createCanvasUI, cv, layoutCanvas } from './src/ui-canvas.js';

import { ok } from '../../scripts/soft-assert.mjs';   // reports every failure with a count, not only the first
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (${JSON.stringify(a)})`);

// ---- binding
{
  const a = signal(1), b = signal(2), sum = computed(() => a.value + b.value);
  let runs = 0, seen;
  const stop = effect(() => { runs++; seen = sum.value; });
  batch(() => { a.value = 5; b.value = 6; });
  ok(runs === 2 && seen === 11, 'a batch of two writes runs a dependent effect once');
  a.value = 5; ok(runs === 2, 'writing the same value runs nothing');
  const parity = memo(() => a.value % 2); let pr = 0; const stop2 = effect(() => { parity.value; pr++; });
  a.value = 7; ok(pr === 1 && runs === 3, 'a memo with an unchanged result does not wake its readers');
  a.value = 8; ok(pr === 2, 'and wakes them when it changes');
  let peeked = 0; const stop3 = effect(() => { untracked(() => b.value); peeked++; }); b.value = 9; ok(peeked === 1, 'untracked reads do not subscribe');
  stop(); stop2(); stop3(); const before = runs; a.value = 2; ok(runs === before, 'a stopped effect stays stopped');
  const s = store({ hp: 10 }); let hp; const [, dispose] = scope(() => effect(() => { hp = s.hp; }));
  s.hp = 7; ok(hp === 7, 'a store field is a signal');
  dispose(); s.hp = 3; ok(hp === 7, 'disposing a scope stops the effects made in it');
  // a branch that is no longer read is no longer a dependency
  const flag = signal(true), x = signal(0); let n = 0; const st = effect(() => { n++; if (flag.value) x.value; });
  flag.value = false; x.value = 1; ok(n === 2, 'dependencies are re-collected on every run'); st();
}

// ---- localisation
{
  const i = createI18n({ tables: {
    en: { bag: '{n, plural, =0 {none} one {# item} other {# items}} for {name}', q: "it''s '{x'}", nth: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', who: '{g, select, f {she} m {he} other {they}}', pct: '{v, number, percent}', only: 'English only' },
    'zh-Hant': { bag: '{name}的 {n} 件物品' },
    ar: { bag: '{n, plural, zero {لا شيء} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}} {name}' },
  } });
  eq([i.t('bag', { n: 0, name: 'Ana' }), i.t('bag', { n: 1, name: 'Ana' }), i.t('bag', { n: 1200, name: 'Ana' })], ['none for Ana', '1 item for Ana', '1,200 items for Ana'], 'English plurals, exact match and grouped #');
  ok(i.t('q') === "it's {x}", 'quoted braces and apostrophes');
  eq([1, 2, 3, 4, 11, 22].map((n) => i.t('nth', { n })), ['1st', '2nd', '3rd', '4th', '11th', '22nd'], 'ordinals');
  eq([i.t('who', { g: 'f' }), i.t('who', { g: 'x' }), i.t('pct', { v: 0.42 })], ['she', 'they', '42%'], 'select and number styles');
  let texts = []; const stop = effect(() => { texts.push(i.t('bag', { n: 3, name: 'Ana' })); });
  i.setLocale('zh-Hant-TW');
  ok(texts.length === 2 && texts[1] === 'Ana的 3 件物品', `a bound text follows the language switch, zh-Hant-TW falls back to zh-Hant (${texts[1]})`);
  ok(i.t('only') === 'English only' && i.missing.has('zh-Hant-TW:only'), 'a string the language lacks falls back to English and is recorded');
  ok(i.t('nowhere') === 'nowhere' && i.missing.has('zh-Hant-TW:nowhere'), 'an unknown key shows itself');
  i.setLocale('ar'); stop();
  const cats = [0, 1, 2, 5, 11, 100].map((n) => i.t('bag', { n, name: 'Ana' }).replace(/[⁨⁩]/g, '').split(' Ana')[0]);
  ok(new Set(cats).size === 6 && cats[0] === 'لا شيء' && cats[2] === 'عنصران', `Arabic uses all six plural categories (${cats.join(' | ')})`);
  ok(i.t('bag', { n: 1, name: 'Ana (3)' }).includes('⁨Ana (3)⁩'), 'a Latin name inside Arabic is isolated');
  ok(i.dir.value === 'rtl' && textDirection('zh-Hant') === 'ltr' && textDirection('he') === 'rtl' && textDirection('en-GB') === 'ltr', 'text direction');
  ok(/PingFang TC.*Noto Sans TC/.test(fontStack('zh-Hant')) && !/PingFang SC/.test(fontStack('zh-Hant')) && /Noto Sans Arabic/.test(fontStack('ar')) && /Hiragino/.test(fontStack('ja')), 'font stacks by script (Traditional Chinese gets TC faces)');
  i.add('fr', { bag: '{n, plural, one {# objet} other {# objets}}' }); i.setLocale('fr');
  ok(i.locales().includes('fr') && i.t('bag', { n: 1 }) === '1 objet' && i.t('bag', { n: 2 }) === '2 objets', 'a table added at runtime');
  // line breaking
  const m = (s) => [...s].length * 10;
  const zh = wrapText('他說：「你好，世界。」然後走了', 60, m, 'zh-Hant');
  ok(zh.length >= 3 && zh.join('') === '他說：「你好，世界。」然後走了', `CJK wraps without spaces and loses nothing (${zh.join(' / ')})`);
  ok(zh.every((l) => !/^[，。」：、！？）]/.test(l) && !/[「（]$/.test(l)), 'no line starts with closing punctuation or ends with an opening bracket');
  eq(wrapText('The quick brown fox', 100, m), ['The quick', 'brown fox'], 'Latin wraps at spaces');
  ok(wrapText('supercalifragilistic', 80, m).every((l) => m(l) <= 80), 'a word wider than the line is split');
  ok(breakPieces('สวัสดีชาวโลก', 'th').length > 1, 'Thai breaks at dictionary words');
  eq(graphemes('👨‍👩‍👧é🇹🇼'), ['👨‍👩‍👧', 'é', '🇹🇼'], 'graphemes keep clusters whole');
  // the shipped tables
  const keys = (t) => Object.keys(t).sort().join(',');
  ok(keys(LOCALES.en) === keys(LOCALES['zh-Hant']) && keys(LOCALES.en) === keys(LOCALES.ar), `en, zh-Hant and ar tables have the same ${Object.keys(LOCALES.en).length} keys`);
  ok(Object.keys(LOCALES).every((l) => LOCALE_NAMES[l]), 'every language has its own name');
  const all = createI18n({ tables: LOCALES }); let bad = '';
  const params = { n: 3, count: 12, item: 'x', action: 'Jump', key: 'J', value: 40, max: 100, text: 't', when: 'now', error: 'e' };
  for (const l of Object.keys(LOCALES)) { all.setLocale(l); for (const k of Object.keys(LOCALES.en)) { try { const s = all.t(k, params); if (/[{}]/.test(s)) bad += ` ${l}:${k}`; } catch (e) { bad += ` ${l}:${k}(${e.message})`; } } }
  ok(!bad && all.missing.size === 0, `every shipped message parses and fills in all three languages${bad}`);
  all.setLocale('ar'); ok(new Set([0, 1, 2, 3, 11, 100].map((n) => all.t('ui.items', { n }))).size === 6, 'the shipped Arabic item count has six forms');
}

// ---- focus graph
{
  // a 3 x 2 grid of buttons, a wide one under it, and one far off to the right
  const r = []; for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) r.push({ x: x * 100, y: y * 50, w: 80, h: 30 });
  r.push({ x: 0, y: 100, w: 280, h: 30 }); r.push({ x: 600, y: 0, w: 80, h: 30 });
  const g = buildFocusGraph(r);
  eq(g[0], { up: -1, down: 3, left: -1, right: 1 }, 'top-left: nothing up or left');
  eq(g[4], { up: 1, down: 6, left: 3, right: 5 }, 'the middle of the second row');
  ok(g[3].down === 6 && g[5].down === 6 && g[6].up === 4, 'down from any column reaches the wide button; up from it goes to what is above its middle');
  ok(g[2].right === 7 && g[7].left === 2 && g[7].down === -1, 'a far button is reached in line, and is not "down" from anything');
  const w = buildFocusGraph(r, { wrap: true });
  ok(w[0].up === 6 && w[6].down === 0 && w[0].left === 7 && w[7].right === 0, 'wrap goes to the far end of the same line');
  ok(nextFocus(r, -1, 'down') === 0, 'no current focus: the top-left-most');
  const sparse = [r[0], null, r[2]]; ok(nextFocus(sparse, 0, 'right') === 2 && buildFocusGraph(sparse)[1] === null, 'hidden entries are skipped');
  // every edge of the graph points at something that exists, and never at itself
  ok(w.every((n, i) => Object.values(n).every((j) => j !== i && j >= -1 && j < r.length)), 'no self links');
  eq([glyphFor('interact', { device: 'gamepad' }).text, glyphFor('interact', { device: 'gamepad', padKind: padKind('DualSense Wireless Controller (054c)') }).text, glyphFor('confirm', { device: 'gamepad', padKind: padKind('Nintendo Switch Pro Controller') }).text], ['X', '□', 'B'], 'pad glyphs by position per pad family');
  eq([glyphFor('jump', { bindings: { jump: ['Space'] } }).text, glyphFor('interact', { bindings: { interact: ['KeyE'] } }).text, glyphFor('cancel', {}).text, glyphFor('interact', { device: 'touch' }).text], ['␣', 'E', 'Esc', 'Use'], 'key and touch glyphs');
  eq([glyphFor('cancel', { bindings: DEFAULT_BINDINGS }).text, glyphFor('back', { bindings: DEFAULT_BINDINGS }).text, glyphFor('cancel', { device: 'gamepad' }).text], ['Esc', 'S', 'B'], 'the way out of a menu is not the walk-back key');
}

// ---- widget logic
{
  const slots = [{ id: 'herb', count: 60 }, { id: 'herb', count: 50 }, { id: 'key' }, null];
  const s1 = moveItem(slots, 0, 1);
  eq([s1[0].count, s1[1].count], [11, 99], 'stacks merge up to the limit, the rest stays');
  ok(slots[0].count === 60 && s1 !== slots, 'the input is not changed');
  const s2 = moveItem(slots, 2, 3); ok(s2[3].id === 'key' && s2[2] === null, 'into an empty slot');
  const s3 = moveItem(slots, 2, 0); ok(s3[0].id === 'key' && s3[2].id === 'herb', 'different items swap');
  ok(moveItem(slots, 3, 0) === slots && moveItem(slots, 1, 1) === slots && moveItem(slots, 0, 9) === slots, 'empty source, same slot and out of range do nothing');
  ok(moveItem([{ id: 'a', count: 99 }, { id: 'a', count: 5 }], 1, 0) [0].count === 99, 'a full stack takes nothing');
  eq(virtualRange(0, 20, 200, 2000, 2), { first: 0, last: 11 }, 'virtual window at the top');
  eq(virtualRange(39990, 20, 200, 2000, 2), { first: 1997, last: 1999 }, 'and at the end');
  const mid = virtualRange(5000, 20, 200, 2000, 2); ok(mid.last - mid.first + 1 <= 15 && mid.first <= 250 && mid.last >= 259, 'a 2000 row list keeps under 15 rows mounted');
  eq(virtualRange(0, 20, 200, 0), { first: 0, last: -1 }, 'an empty list');
  eq([radialIndex(0, -1, 4), radialIndex(1, 0, 4), radialIndex(0, 1, 4), radialIndex(-1, 0, 4), radialIndex(0.1, 0.1, 4), radialIndex(-0.05, -1, 6)], [0, 1, 2, 3, -1, 0], 'radial sectors: up first, clockwise, a dead zone');
  eq([revealCount(0.5, 40, 100), revealCount(9, 40, 100), revealCount(0.1, 0, 100)], [20, 100, 100], 'typewriter count (speed 0: all at once)');
  eq([computeScale(1920, 1080), computeScale(640, 720), computeScale(320, 200), computeScale(2560, 720, { mode: 'fill' })], [1.5, 0.7, 0.7, 2], 'scale with the screen, clamped');
  ok(themeCSS({ accent: '#fc6', onAccent: '#000' }) === '--mk-accent:#fc6;--mk-on-accent:#000', 'tokens become CSS variables');
}

// ---- accessibility: contrast and colour-blind separation of every theme
{
  for (const [name, t] of Object.entries(THEMES)) {
    const aaa = name === 'contrast', need = aaa ? 7 : 4.5, pairs = [];
    for (const bg of ['bg', 'surface', 'surface2']) for (const fg of ['text', 'muted']) pairs.push([fg, bg, contrastRatio(t[fg], t[bg])]);
    pairs.push(['onAccent', 'accent', contrastRatio(t.onAccent, t.accent)]);
    for (const fg of ['good', 'warn', 'bad', 'info', 'accent']) pairs.push([fg, 'surface', contrastRatio(t[fg], t.surface)]);
    const worst = pairs.reduce((a, b) => (b[2] < a[2] ? b : a));
    ok(worst[2] >= need, `${name}: text pairs at ${need}:1 or better (worst ${worst[0]} on ${worst[1]} ${worst[2].toFixed(2)})`);
    // non-text: borders, the focus ring and bar fills against what they sit on (WCAG 1.4.11: 3:1)
    const track = over(t.track, t.surface), parts = [['border', contrastRatio(t.border, t.surface)], ['focus', contrastRatio(t.focus, t.surface)], ['focus on bg', contrastRatio(t.focus, t.bg)],
      ['health on track', contrastRatio(parseColor(t.health).slice(0, 3), track)], ['stamina on track', contrastRatio(parseColor(t.stamina).slice(0, 3), track)]];
    const wp = parts.reduce((a, b) => (b[1] < a[1] ? b : a));
    ok(wp[1] >= 3, `${name}: borders, focus ring and bars at 3:1 or better (worst ${wp[0]} ${wp[1].toFixed(2)})`);
  }
  const cb = THEMES.colorblind; let worst = [Infinity, ''];
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) {
    const d = colorDistance(simulateCVD(cb.good, type), simulateCVD(cb.bad, type)); if (d < worst[0]) worst = [d, type];
  }
  ok(worst[0] >= 20, `colour-blind theme: good and bad stay apart under all three dichromacies (least ${worst[0].toFixed(1)} dE, ${worst[1]})`);
  const dk = THEMES.dark, dDark = Math.min(...['protanopia', 'deuteranopia'].map((t) => colorDistance(simulateCVD(dk.good, t), simulateCVD(dk.bad, t))));
  ok(worst[0] > dDark, `and further apart than the default theme's green and red (${dDark.toFixed(1)} dE under red-green dichromacy)`);
  ok(contrastRatio('#fff', '#000') === 21 && Math.abs(contrastRatio('#777', '#fff') - 4.48) < 0.01, 'contrast maths against known values');
}

// ---- world-space projection
{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100); cam.position.set(0, 0, 5); cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
  const c = projectPoint(vp, 0, 0, 0, 1280, 720);
  ok(Math.abs(c.x - 640) < 1e-6 && Math.abs(c.y - 360) < 1e-6 && c.front && Math.abs(c.w - 5) < 1e-6, 'a point on the view axis lands in the middle, 5 m deep');
  const v = new THREE.Vector3(1.5, 1, -2).project(cam), p = projectPoint(vp, 1.5, 1, -2, 1280, 720);
  ok(Math.abs(p.x - (v.x * 0.5 + 0.5) * 1280) < 1e-3 && Math.abs(p.y - (-v.y * 0.5 + 0.5) * 720) < 1e-3, 'matches three.js project()');
  const behind = projectPoint(vp, 1, 0, 10, 1280, 720); ok(!behind.front, 'a point behind the camera is flagged');
  const e = clampToEdge(2000, 300, true, 1280, 720, 24); ok(e.x === 1256 && e.y > 24 && e.y < 696 && e.clamped, 'an off-screen marker clamps to the edge');
  const b = clampToEdge(behind.x, behind.y, false, 1280, 720, 24); ok(b.clamped && (b.x === 24 || b.x === 1256 || b.y === 24 || b.y === 696), 'a marker behind the camera goes to an edge too');
  ok(!clampToEdge(640, 360, true, 1280, 720, 24).clamped, 'an on-screen marker is left alone');
  eq([worldFade(10, 60), worldFade(60, 60), +worldFade(52.5, 60).toFixed(2)], [1, 0, 0.5], 'distance fade over the last quarter');
}

// ---- canvas panel (the glyph backend: no canvas in Node)
{
  const on = signal(false), level = signal(0.4); let pressed = 0;
  const ui = createCanvasUI({ backend: 'glyphs', description: () => cv.panel({ title: 'Generator' }, cv.toggle({ value: on, label: 'Power' }), cv.slider({ value: level, label: 'Output' }),
    cv.bar({ value: () => level.value * 100, max: 100 }), cv.row({}, cv.button({ label: 'Vent', onPress: () => pressed++ }), cv.button({ label: 'Close' }))) });
  ok(ui.update() === true && ui.update() === false && ui.stats.paints === 1, 'paints once, then not again while nothing changes');
  eq(ui.boxes.map((b) => b.node.type), ['toggle', 'slider', 'button', 'button'], 'the focusable boxes in order');
  ok(ui.boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 512 && b.y + b.h <= 320), 'everything inside the panel');
  ok(ui.boxes[2].y === ui.boxes[3].y && ui.boxes[3].x > ui.boxes[2].x, 'a row lays its buttons side by side');
  ui.focus.value = 0; ui.activate(); ok(on.value === true && ui.update() === true, 'activate flips the focused toggle and the panel repaints');
  const layouts = ui.stats.layouts; level.value = 0.5; ui.update();
  ok(ui.stats.paints === 3, 'a value change repaints');
  const b = ui.boxes[2]; ui.pointer((b.x + 5) / 512, (b.y + 5) / 320, true); ui.pointer((b.x + 5) / 512, (b.y + 5) / 320, false);
  ok(pressed === 1, 'a pointer press and release on a button presses it');
  const s = ui.boxes[1]; ui.pointer((s.track[0] + s.track[1]) / 512, (s.y + s.h / 2) / 320, true); ui.pointer(-1, -1, false);
  ok(level.value === 1, `dragging the slider to the end of its track sets the value (${level.value})`);
  ui.focus.value = 2; ui.move('right'); ok(ui.focus.value === 3, 'directional focus inside the panel'); ui.move('up'); ok(ui.focus.value === 1, 'and back up');
  let lit = 0; for (let i = 3; i < ui.image.data.length; i += 4) if (ui.image.data[i]) lit++;
  ok(lit > 512 * 320 * 0.5 && ui.texture && ui.texture.isTexture, 'pixels were drawn into a texture');
  const rtl = layoutCanvas(cv.panel({}, cv.toggle({ value: on, label: 'Power' })), { rtl: true }), ltr = layoutCanvas(cv.panel({}, cv.toggle({ value: on, label: 'Power' })), {});
  ok(JSON.stringify(rtl) !== JSON.stringify(ltr), 'right-to-left mirrors the layout');
  ok(layouts >= 1, 'laid out'); ui.dispose();
}
console.log('ui check: ok');

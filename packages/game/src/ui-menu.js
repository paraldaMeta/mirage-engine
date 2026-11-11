// Mirage original code. The game overlay of ui.js (start screen, HUD, pause menu, inventory, message dialog, touch
// controls) rebuilt on the UI toolkit (ui-kit.js + ui-widgets.js): the same options and the same returned object as
// createUI(), so a game switches by passing it to startGame. What it adds over createUI: spatial focus with a
// gamepad in every panel, glyphs that follow the device, a language / theme / text size / reduced motion tab,
// right-to-left layout, and `ui.kit` to mount a game's own HUD into the same root.
// ---------------------------------------------------------------------------
// import { startGame } from '@miragekit/game';
// import { createKitUI } from '@miragekit/game/ui-menu';
// const g = await startGame(world, { plan, ui: createKitUI });                       // opt-in; the default stays createUI
// const g = await startGame(world, { plan, ui: (o) => createKitUI({ ...o, theme: 'contrast', locale: 'zh-Hant' }) });
// g.ui.kit.mount(h(Bar, { value: hp, max: 100 }));                                    // the game's own widgets
// h(TouchControls, { input })   the stick, look area and buttons alone, for a HUD of your own
// Options beyond createUI's: kit (an existing createUIKit(); not disposed with the overlay), i18n, locale, theme,
// kitOptions (passed to createUIKit). The player's language, theme, text size and motion choice are kept in
// game.settings.ui (saved with game.saveSettings(), like bindings and volumes).
// ---------------------------------------------------------------------------
import { createLifetime } from '@miragekit/core/lifetime';
import { createUIKit, h, each, show, signal, stack, row, anchor, safeArea, onCleanup } from './ui-kit.js';
import { Button, Prompt, Slider, Toggle, Select, Tabs, RebindList, modals, toasts, confirm } from './ui-widgets.js';
import { LOCALE_NAMES } from './ui-locales.js';

const CSS = `
.mk-objective{display:flex;flex-direction:column;max-width:20em;padding:.5em .8em;background:var(--mk-surface);border:.06em solid var(--mk-border);border-radius:var(--mk-radius)}
.mk-objective b{font-size:.8em;letter-spacing:.06em;color:var(--mk-muted)}
.mk-strip{display:flex;flex-wrap:wrap;gap:.3em;max-width:20em}
.mk-chip{padding:.15em .6em;font-size:.85em;background:var(--mk-surface);border:.06em solid var(--mk-border);border-radius:1em}
.mk-crosshair{width:.4em;height:.4em;border-radius:50%;background:var(--mk-text);border:.06em solid var(--mk-bg);opacity:.8}
.mk-start{align-items:center;text-align:center}
.mk-start h1{font-size:2.2em;line-height:1.15}
.mk-muted{color:var(--mk-muted)}
.mk-note{min-height:1.45em;color:var(--mk-muted)}
.mk-slotrow{justify-content:space-between}
.mk-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4em}
.mk-items li{display:flex;flex-direction:column;padding:.4em .7em;background:var(--mk-surface2);border-radius:var(--mk-radius-sm)}
.mk-menu{width:min(100%,34em)}
.mk-touch{position:absolute;inset:0;pointer-events:none!important;touch-action:none}
.mk-touch>*{pointer-events:auto;touch-action:none}
.mk-look{position:absolute;inset-block:0;inset-inline-end:0;width:55%}
.mk-stick{position:absolute;inset-inline-start:max(1.5em,env(safe-area-inset-left));inset-block-end:max(1.5em,env(safe-area-inset-bottom));width:8em;height:8em;border-radius:50%;background:var(--mk-track);border:.09em solid var(--mk-border)}
.mk-nub{position:absolute;inset:30%;border-radius:50%;background:var(--mk-text);opacity:.7;will-change:transform}
.mk-tbtns{position:absolute;inset-inline-end:max(1.5em,env(safe-area-inset-right));inset-block-end:max(1.5em,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,max(4em,48px));gap:.6em}
.mk-tbtn{width:max(4em,48px);height:max(4em,48px);border-radius:50%;font:inherit;font-size:.9em;font-weight:700;color:var(--mk-text);background:var(--mk-surface);border:.09em solid var(--mk-border);opacity:.85}
.mk-tbtn:active{background:var(--mk-accent);color:var(--mk-on-accent)}
.mk-tmenu{position:absolute;inset-inline-end:max(1em,env(safe-area-inset-right));inset-block-start:max(4.5em,env(safe-area-inset-top));width:max(3.2em,44px);height:max(3.2em,44px)}
`;
const TABS = ['game', 'controls', 'audio', 'display'];
const BUSES = ['master', 'music', 'sfx', 'ambience'];

/** The overlay on the toolkit. Same options and result as createUI(), plus `kit` on the result. */
export function createKitUI(options) {
  const life = createLifetime();
  try {
    return mountKitUI(options, life);
  } catch (error) {
    life.dispose();
    throw error;
  }
}

/** The touch controls as a widget: a stick (bottom-start; pushed past its rim it runs), a look area over the far
 *  half, and jump / interact / inventory / menu buttons, all feeding `input` (stick, addLook, hold, tap).
 *  h(TouchControls, { input, actions: ['inventory', 'interact', 'jump'], menu: true, look: true }) */
export function TouchControls({ input, actions = ['inventory', 'interact', 'jump'], menu = true, look = true }, ctx) {
  const kit = ctx.kit;
  kit.addStyles('mk-menu-css', CSS);
  const ICON = { inventory: '▦', interact: '✋', jump: '⤒', menu: '☰', run: '»' };
  const drag = (el, e) => { el.setPointerCapture && el.setPointerCapture(e.pointerId); return el.getBoundingClientRect(); };   // one read per touch
  let stickRect = null, nub = null, lookAt = null, running = false;
  const setRun = (on) => { if (on !== running) { running = on; input.hold('run', on); } };
  const stickMove = (e) => {
    if (!stickRect) return;
    const R = stickRect.width / 2, dx = e.clientX - stickRect.left - R, dy = e.clientY - stickRect.top - R, l = Math.hypot(dx, dy) || 1, k = Math.min(1, R / l);
    if (nub) nub.style.transform = `translate(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px)`;
    input.stick((dx * k) / R, (-dy * k) / R); setRun(l > R * 1.25);
  };
  const stickEnd = () => { stickRect = null; if (nub) nub.style.transform = ''; input.stick(0, 0); setRun(false); };
  onCleanup(() => { stickEnd(); input.hold('jump', false); });
  const tbtn = (a, cls) => h('button', { type: 'button', class: ['mk-tbtn', cls], 'aria-label': kit.tx('action.' + a), 'data-touch': a,
    // jump is held from the touch down; the rest act on the click: a menu opened on the way down would get the
    // same finger's click on its scrim and close again
    onPointerdown: (e) => { e.preventDefault(); if (a === 'jump') input.hold('jump', true); },
    onPointerup: () => { if (a === 'jump') input.hold('jump', false); }, onPointercancel: () => { if (a === 'jump') input.hold('jump', false); },
    onClick: (e) => { if (a !== 'jump' || e.detail === 0) input.tap(a); } }, ICON[a] || a[0].toUpperCase());   // detail 0: a keyboard or switch-access activation
  return h('div', { class: 'mk-touch' },
    look ? h('div', { class: 'mk-look', 'aria-hidden': 'true',
      onPointerdown: (e) => { drag(e.currentTarget, e); lookAt = [e.clientX, e.clientY, e.pointerId]; },
      onPointermove: (e) => { if (lookAt && e.pointerId === lookAt[2]) { input.addLook((e.clientX - lookAt[0]) * 0.006, (e.clientY - lookAt[1]) * 0.006); lookAt[0] = e.clientX; lookAt[1] = e.clientY; } },
      onPointerup: () => { lookAt = null; }, onPointercancel: () => { lookAt = null; } }) : null,
    h('div', { class: 'mk-stick', 'aria-hidden': 'true', 'data-touch': 'stick', onPointerdown: (e) => { stickRect = drag(e.currentTarget, e); stickMove(e); }, onPointermove: stickMove, onPointerup: stickEnd, onPointercancel: stickEnd },
      h('div', { class: 'mk-nub', ref: (el) => { nub = el; } })),
    h('div', { class: 'mk-tbtns' }, actions.map((a) => tbtn(a))),
    menu ? tbtn('menu', 'mk-tmenu') : null);
}

function mountKitUI({ game, input, audio, title = 'Mirage', subtitle = '', slots = 3, onSave, onLoad, onRestart, canvas, kit: given, i18n, locale, theme, kitOptions = {} }, life) {
  const saved = (game.settings && game.settings.ui) || {};
  const kit = given || createUIKit({ input, i18n, theme: theme || saved.theme || 'dark', textScale: saved.textScale || 1, motion: saved.motion || 'auto', ...kitOptions });
  const doc = kit.doc, win = doc.defaultView, t = kit.i18n.t;
  kit.addStyles('mk-menu-css', CSS);
  const want = locale || saved.locale;
  if (want && kit.i18n.locales().includes(want)) kit.i18n.setLocale(want);
  const stops = [];
  const mountIn = (d, layer) => stops.push(kit.mount(d, layer));
  const keep = (patch) => { game.settings.ui = { ...(game.settings.ui || {}), ...patch }; game.saveSettings(); };

  const started = signal(false), touchOn = signal(false), promptText = signal(''), obj = signal(null), note = signal('');
  const items = signal([...game.inventory.items]), slotList = signal(game.slots(slots));
  const wasEnabled = input.enabled;
  let ownsPause = false, hadLock = false, lostAt = -1e9, cur = null, startModal = null;
  input.enabled = false;

  // ---- pause / resume: as createUI (the game stops and the keys are the menu's while anything is open)
  const pause = () => {
    if (!game.paused) ownsPause = true;
    game.pause(true); input.enabled = false; input.clear(); input.hold('run', false); input.stick(0, 0);
    if (doc.pointerLockElement) doc.exitPointerLock();
  };
  const resume = () => { ownsPause = false; game.pause(false); if (started.peek()) input.enabled = true; };
  // one of menu / inventory / message at a time; replacing one does not resume in between
  const openModal = (kind, content, opts = {}) => {
    if (cur) { const c = cur; cur = null; c.silent = true; c.m.close(); }
    pause();
    const me = { kind, silent: false, m: null };
    cur = me;
    me.m = modals(kit).open(content, { ...opts, onClose: () => { if (cur === me) cur = null; if (!me.silent && !cur && !life.disposed) resume(); } });
    return me.m;
  };

  // ---- HUD
  mountIn(safeArea({ pad: 1 },
    anchor({ at: 'top-start' }, stack({ gap: 0.5 },
      show(() => !!obj.value && !!(obj.value.head || obj.value.text), () => h('div', { class: 'mk-objective', role: 'status' }, h('b', null, () => (obj.value ? obj.value.head : '')), h('span', null, () => (obj.value ? obj.value.text : '')))),
      h('div', { class: 'mk-strip', role: 'list', 'aria-label': kit.tx('ui.inventory') }, each(items, (it, i) => it.id ?? i, (it) => h('span', { class: 'mk-chip', role: 'listitem' }, () => it.value.name))))),
    anchor({ at: 'center' }, show(() => started.value && !touchOn.value, () => h('div', { class: 'mk-crosshair', 'aria-hidden': 'true' }))),
    anchor({ at: 'bottom', offset: [0, 6] }, show(() => !!promptText.value, () => h(Prompt, { action: 'interact', label: () => promptText.value }), { transition: 'fade' }))), 'hud');
  life.defer(game.on('inventory', () => { items.value = [...game.inventory.items]; }));

  // ---- touch controls
  mountIn(show(() => touchOn.value && started.value, () => h(TouchControls, { input })), 'hud');
  const setTouch = (on) => { touchOn.value = !!on; };
  if (win.matchMedia && win.matchMedia('(pointer: coarse)').matches) setTouch(true);

  // ---- start screen
  function begin(e) {
    if (life.disposed || started.peek()) return;
    started.value = true;
    if (startModal) { startModal.close(); startModal = null; }
    audio.unlock(); input.enabled = true; input.spend(e && e.code);
    if (e && e.type === 'click' && canvas && !touchOn.peek() && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed here */ } }
    game.emit('start');
  }
  startModal = modals(kit).open(() => stack({ gap: 0.75, class: 'mk-start' },
    h('h1', null, title), subtitle ? h('p', { class: 'mk-muted' }, subtitle) : null,
    h(Button, { label: kit.tx('menu.start'), variant: 'primary', onPress: (e) => begin(e), 'data-autofocus': true, 'data-start': true }),
    h('p', { class: 'mk-muted' }, () => (touchOn.value ? t('menu.touchHint') : t('menu.startHint', { key: kit.glyph('confirm').text })))), { label: title, dismissable: false });
  life.listen(win, 'keydown', (e) => {
    if (started.peek() || life.disposed) return;
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || ''))) return;
    if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;   // a screen-reader or browser key is not "start"
    e.preventDefault(); begin(e);
  }, true);
  life.listen(win, 'pointerdown', (e) => { audio.unlock(); if (e.pointerType === 'touch') setTouch(true); }, true);
  life.listen(doc, 'pointerlockchange', () => {
    if (canvas && doc.pointerLockElement === canvas) hadLock = true;
    else if (hadLock && !game.paused && started.peek()) { hadLock = false; lostAt = win.performance.now(); openMenu(); }
  });

  // ---- pause menu
  const fail = (err) => { note.value = t('menu.error', { error: (err && err.message) || String(err) }); };
  const slotLabel = (s) => (s.at ? t('menu.slotSaved', { n: s.slot, when: kit.i18n.date(s.at) + (s.summary ? ' · ' + s.summary : '') }) : t('menu.slotEmpty', { n: s.slot }));
  const doSave = (n) => { try { onSave(n); slotList.value = game.slots(slots); note.value = t('menu.saved', { n }); toast(t('menu.saved', { n })); } catch (err) { fail(err); } };
  const doLoad = (n) => { try { onLoad(n); if (cur) cur.m.close(); toast(t('menu.loaded', { n })); } catch (err) { fail(err); } };
  const doExport = () => {
    try {
      const url = win.URL.createObjectURL(new win.Blob([onSave('export')], { type: 'application/json' })), a = doc.createElement('a');
      a.href = url; a.download = `${game.id}-save.json`; a.click();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    } catch (err) { fail(err); }
  };
  const doImport = () => {
    const f = doc.createElement('input'); f.type = 'file'; f.accept = 'application/json,.json';
    f.addEventListener('change', async () => {
      const file = f.files && f.files[0];
      if (!file || life.disposed) return;
      try { onLoad(await file.text()); if (cur) cur.m.close(); toast(t('menu.imported')); } catch (err) { fail(err); }
    });
    f.click();
  };
  const gameTab = (close) => stack({ gap: 0.5 },
    h(Button, { label: kit.tx('menu.resume'), variant: 'primary', glyph: 'cancel', onPress: () => close(), 'data-autofocus': true, 'data-menu': 'resume' }),
    each(slotList, (s) => s.slot, (s) => row({ gap: 0.5, class: 'mk-slotrow' },
      h('span', null, () => slotLabel(s.value)),
      row({ gap: 0.4 },
        h(Button, { label: kit.tx('menu.save'), 'aria-label': () => `${t('menu.save')}: ${t('menu.slot', { n: s.value.slot })}`, 'data-save': () => s.value.slot, onPress: () => doSave(s.peek().slot) }),
        h(Button, { label: kit.tx('menu.load'), 'aria-label': () => `${t('menu.load')}: ${t('menu.slot', { n: s.value.slot })}`, 'data-load': () => s.value.slot, disabled: () => !s.value.at, onPress: () => doLoad(s.peek().slot) })))),
    row({ gap: 0.4, wrap: true },
      h(Button, { label: kit.tx('menu.exportSave'), variant: 'ghost', onPress: doExport }),
      h(Button, { label: kit.tx('menu.importSave'), variant: 'ghost', onPress: doImport }),
      onRestart ? h(Button, { label: kit.tx('menu.restart'), variant: 'ghost', 'data-menu': 'restart', onPress: async () => { if (await confirm(kit, { title: kit.tx('menu.restart'), text: kit.tx('menu.restartAsk') })) onRestart(); } }) : null));
  const audioTab = () => stack({ gap: 0.5 }, BUSES.map((bus) => h(Slider, { value: signal(audio.volumes[bus] ?? 1), label: kit.tx('menu.' + bus), 'data-bus': bus,
    format: (v) => kit.i18n.number(v, { style: 'percent', maximumFractionDigits: 0 }),
    onChange: (v) => { audio.volume(bus, v); game.settings.volumes = audio.volumes; game.saveSettings(); } })));
  const displayTab = () => stack({ gap: 0.5 },
    h(Select, { value: signal(kit.i18n.locale.peek()), label: kit.tx('menu.language'), 'data-setting': 'language', options: kit.i18n.locales().map((l) => ({ value: l, label: LOCALE_NAMES[l] || l })),
      onChange: (l) => { kit.i18n.setLocale(l); keep({ locale: l }); } }),
    h(Select, { value: signal(kit.theme.peek()), label: kit.tx('menu.theme'), 'data-setting': 'theme', options: Object.keys(kit.themes).map((n) => ({ value: n, label: () => (kit.i18n.has('theme.' + n) ? t('theme.' + n) : n) })),
      onChange: (n) => { kit.setTheme(n); keep({ theme: n }); } }),
    h(Slider, { value: kit.textScale, min: 0.8, max: 1.6, step: 0.1, label: kit.tx('menu.textScale'), 'data-setting': 'textScale', format: (v) => kit.i18n.number(v, { style: 'percent', maximumFractionDigits: 0 }), onChange: (v) => keep({ textScale: v }) }),
    h(Toggle, { value: signal(kit.motion.peek() === 'reduced'), label: kit.tx('menu.reduceMotion'), 'data-setting': 'motion', onChange: (on) => { kit.setMotion(on ? 'reduced' : 'auto'); keep({ motion: on ? 'reduced' : 'auto' }); } }));
  function openMenu(panel = 'game') {
    if (life.disposed) return;
    slotList.value = game.slots(slots); note.value = '';
    openModal('menu', (close) => [h('h2', null, kit.tx('menu.paused')),
      h(Tabs, { value: signal(TABS.includes(panel) ? panel : 'game'), label: kit.tx('menu.settings'), tabs: [
        { id: 'game', label: kit.tx('menu.game'), content: () => gameTab(close) },
        { id: 'controls', label: kit.tx('menu.controls'), content: () => h(RebindList, { input, onChange: (b) => { game.settings.bindings = b; game.saveSettings(); } }) },
        { id: 'audio', label: kit.tx('menu.audio'), content: audioTab },
        { id: 'display', label: kit.tx('menu.display'), content: displayTab }] }),
      h('p', { class: 'mk-note', role: 'status' }, note)], { label: kit.tx('menu.paused'), class: 'mk-menu' });
  }
  function openInventory() {
    if (life.disposed) return;
    openModal('inv', (close) => [h('h2', null, kit.tx('ui.inventory')),
      h('p', { class: 'mk-muted' }, () => t('ui.items', { n: items.value.length })),
      h('ul', { class: 'mk-items' }, each(items, (it, i) => it.id ?? i, (it) => h('li', null, h('b', null, () => it.value.name), h('span', { class: 'mk-muted' }, () => it.value.text || '')))),
      h(Button, { label: kit.tx('ui.close'), glyph: 'cancel', onPress: () => close(), 'data-autofocus': true })], { label: kit.tx('ui.inventory') });
  }
  function message(head, text, button) {
    if (life.disposed) return;
    openModal('msg', (close) => [h('h2', null, head), h('p', null, text), h(Button, { label: button || kit.tx('ui.next'), variant: 'primary', onPress: () => close(), 'data-autofocus': true })], { label: head });
  }
  const toast = (s, ms = 2200) => { toasts(kit).push({ text: s, duration: ms / 1000 }); };
  const objective = (head, text) => { obj.value = { head, text }; };
  const prompt = (e) => { promptText.value = e ? String(game.label(e) || '') : ''; };

  function update() {
    if (life.disposed) return;
    const now = win.performance.now();
    kit.update(now);
    if (input.pressed('menu') && now - lostAt > 400) { if (cur) cur.m.close(); else if (started.peek()) openMenu(); else begin(); }
    else if (input.pressed('inventory') && started.peek()) { if (cur && cur.kind === 'inv') cur.m.close(); else if (!cur) openInventory(); }
    if (!started.peek() && (input.padPressed(0) || input.padPressed(9))) begin();
  }

  life.defer(() => {
    if (cur) { cur.silent = true; cur.m.close(); cur = null; }
    if (startModal) startModal.close();
    for (const s of stops.splice(0)) s();
    if (!given) kit.dispose();
    if (doc.pointerLockElement && doc.pointerLockElement === canvas) doc.exitPointerLock();
    input.clear(); input.enabled = wasEnabled;
    if (ownsPause) game.pause(false);
  });
  return { dispose: life.dispose, root: kit.root, kit, prompt, objective, toast, message, openMenu, openInventory, update, begin, setTouch,
    get started() { return started.peek(); }, get touch() { return touchOn.peek(); }, get open() { return !!cur; } };
}

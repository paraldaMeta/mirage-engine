// Demo: the UI toolkit of @mirage/game (docs/ui.md) end to end: a HUD (health, stamina, minimap, objectives, a
// prompt with the device's glyph), world-space labels / markers / a health bar, a screen in the world drawn into a
// texture, an inventory with drag and drop, a dialogue with choices, a quick wheel and a settings menu (language,
// theme, text size, motion, key rebinding). Keyboard, gamepad and touch play the same flow.
// URL: ?lang=en | zh-Hant | ar   ?theme=dark | light | contrast | colorblind   ?hud=0 (no UI at all: the baseline)
//      ?touch=1 (show the touch controls)   ?auto=1 (the player walks a circle: a steady moving HUD to measure)
//      ?motion=reduced   ?w=&h=
// Keys: WASD / arrows move, Shift run, mouse drag or right stick looks, E talk / open / use, I inventory, Q wheel,
//       Esc / P menu. Pad: A confirm, B back, X interact, Y inventory, LB / RB tabs, Start menu.
// Contract with ui-check.mjs: window.__ui = { kit, state, world, screen, input, frame, setHud, ... }, __READY.
// The scene is plain three.js on purpose: the page is about the overlay, and its frame cost must not drown in a
// world's.
import * as THREE from 'three';
import { createInput } from '@mirage/game';
import { createUIKit, createI18n, h, show, signal, memo, batch, stack, row, anchor, safeArea } from '@mirage/game/ui-kit';
import { Bar, Button, Prompt, Slider, Toggle, Select, Tabs, TextInput, Tooltip, VirtualList, InventoryGrid, MinimapFrame, ObjectiveTracker, RebindList, Progress,
  modals, toasts, dialogue, confirm, openRadial } from '@mirage/game/ui-widgets';
import { createWorldUI } from '@mirage/game/ui-world';
import { createCanvasUI, cv } from '@mirage/game/ui-canvas';
import { TouchControls } from '@mirage/game/ui-menu';
import { LOCALE_NAMES } from '@mirage/game/ui-locales';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, HUD = Q.get('hud') !== '0';
const canvas = document.querySelector('canvas');

// ---- the game's own strings (the toolkit's are in ui-locales.js)
const TABLES = {
  en: { 'd.title': 'Courtyard errand', 'd.ana': 'Ana', 'd.chest': 'Supply chest', 'd.terminal': 'Generator', 'd.dummy': 'Training post', 'd.beacon': 'North gate',
    'd.talk': 'Talk to Ana', 'd.open': 'Open the chest', 'd.use': 'Use the generator', 'd.o.talk': 'Talk to Ana', 'd.o.chest': 'Collect supplies', 'd.o.power': 'Switch the generator on',
    'd.l1': 'You made it. The generator went quiet last night, and the gate will not open without it.', 'd.l2': 'Take the key from me. Which way will you go?',
    'd.c1': 'Straight to the generator', 'd.c2': 'To the chest first', 'd.r1': 'Good. It is behind the pillars.', 'd.r2': 'Wise. There are herbs in it.',
    'd.key': 'Gate key', 'd.herb': 'Herb', 'd.lamp': 'Lamp', 'd.rope': 'Rope', 'd.bread': 'Bread', 'd.got': 'Received: {item}', 'd.used': 'Used: {item}', 'd.herbs': '{n, plural, one {# herb} other {# herbs}} collected',
    'd.power': 'Power', 'd.output': 'Output', 'd.vent': 'Vent', 'd.vented': 'Vented.', 'd.on': 'The generator hums.', 'd.hot': 'The ground here burns!', 'd.name': 'Your name', 'd.log': 'Log', 'd.entry': 'Entry {n, number}: all quiet',
    'd.wave': 'Wave', 'd.rest': 'Rest', 'd.map': 'Map', 'd.shout': 'Shout', 'd.eat': 'Eat', 'd.light': 'Light', 'd.did': 'You chose: {what}', 'd.hint': 'Quick wheel', 'd.tip': 'Drag items, or pick one up with {key} and put it down on another slot.' },
  'zh-Hant': { 'd.title': '庭院差事', 'd.ana': '安娜', 'd.chest': '補給箱', 'd.terminal': '發電機', 'd.dummy': '訓練木樁', 'd.beacon': '北門',
    'd.talk': '與安娜交談', 'd.open': '打開箱子', 'd.use': '使用發電機', 'd.o.talk': '與安娜交談', 'd.o.chest': '收集補給', 'd.o.power': '啟動發電機',
    'd.l1': '你來了。發電機昨晚就沒了聲音，沒有它，大門打不開。', 'd.l2': '這把鑰匙你拿著。你打算先去哪裡？',
    'd.c1': '直接去發電機', 'd.c2': '先去補給箱', 'd.r1': '很好，它就在柱子後面。', 'd.r2': '明智，裡面有藥草。',
    'd.key': '大門鑰匙', 'd.herb': '藥草', 'd.lamp': '提燈', 'd.rope': '繩索', 'd.bread': '麵包', 'd.got': '獲得：{item}', 'd.used': '已使用：{item}', 'd.herbs': '已收集 {n} 株藥草',
    'd.power': '電源', 'd.output': '輸出', 'd.vent': '排氣', 'd.vented': '已排氣。', 'd.on': '發電機開始嗡嗡作響。', 'd.hot': '這裡的地面很燙！', 'd.name': '你的名字', 'd.log': '紀錄', 'd.entry': '第 {n, number} 筆：一切平靜',
    'd.wave': '揮手', 'd.rest': '休息', 'd.map': '地圖', 'd.shout': '呼喊', 'd.eat': '進食', 'd.light': '點燈', 'd.did': '你選擇了：{what}', 'd.hint': '快捷選單', 'd.tip': '拖曳物品，或按 {key} 拿起後放到另一格。' },
  ar: { 'd.title': 'مهمة في الفناء', 'd.ana': 'آنا', 'd.chest': 'صندوق المؤن', 'd.terminal': 'المولّد', 'd.dummy': 'عمود التدريب', 'd.beacon': 'البوابة الشمالية',
    'd.talk': 'تحدّث إلى آنا', 'd.open': 'افتح الصندوق', 'd.use': 'استخدم المولّد', 'd.o.talk': 'تحدّث إلى آنا', 'd.o.chest': 'اجمع المؤن', 'd.o.power': 'شغّل المولّد',
    'd.l1': 'لقد وصلت. توقّف المولّد ليلة أمس، ولن تُفتح البوابة من دونه.', 'd.l2': 'خذ المفتاح منّي. إلى أين ستذهب أولًا؟',
    'd.c1': 'إلى المولّد مباشرة', 'd.c2': 'إلى الصندوق أولًا', 'd.r1': 'جيد. إنه خلف الأعمدة.', 'd.r2': 'حكيم. فيه أعشاب.',
    'd.key': 'مفتاح البوابة', 'd.herb': 'عشبة', 'd.lamp': 'مصباح', 'd.rope': 'حبل', 'd.bread': 'خبز', 'd.got': 'حصلت على: {item}', 'd.used': 'استُخدم: {item}', 'd.herbs': '{n, plural, one {جُمعت عشبة واحدة} two {جُمعت عشبتان} few {جُمعت # أعشاب} many {جُمعت # عشبة} other {جُمعت # عشبة}}',
    'd.power': 'الطاقة', 'd.output': 'الخرج', 'd.vent': 'تنفيس', 'd.vented': 'تم التنفيس.', 'd.on': 'بدأ المولّد يطنّ.', 'd.hot': 'الأرض هنا حارقة!', 'd.name': 'اسمك', 'd.log': 'السجل', 'd.entry': 'القيد {n, number}: كل شيء هادئ',
    'd.wave': 'تلويح', 'd.rest': 'استراحة', 'd.map': 'خريطة', 'd.shout': 'نداء', 'd.eat': 'أكل', 'd.light': 'إضاءة', 'd.did': 'اخترت: {what}', 'd.hint': 'القائمة السريعة', 'd.tip': 'اسحب العناصر، أو احمل عنصرًا بـ {key} وضعه في خانة أخرى.' },
};

// ---- a small scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fb7c9); scene.fog = new THREE.Fog(0x9fb7c9, 30, 90);
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x5a5146, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2); sun.position.set(6, 10, 4); scene.add(sun);
const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
const put = (geo, c, x, y, z) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); scene.add(m); return m; };
const ground = put(new THREE.PlaneGeometry(120, 120), 0x8a8f7a, 0, 0, 0); ground.rotation.x = -Math.PI / 2;
const hot = put(new THREE.CircleGeometry(1.6, 32), 0xb5482f, 5, 0.01, 3); hot.rotation.x = -Math.PI / 2;
const pillars = [[-1.6, -2.6], [1.6, -2.6], [-4.5, -6], [4.2, -3.2]].map(([x, z]) => put(new THREE.BoxGeometry(0.9, 3.4, 0.9), 0xb9b2a3, x, 1.7, z));
const npc = put(new THREE.CapsuleGeometry(0.32, 1.0, 4, 12), 0x3f6fa8, -3, 0.82, 0);
const chest = put(new THREE.BoxGeometry(0.9, 0.6, 0.6), 0x8a5a2b, 3, 0.3, -1);
const dummy = put(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 12), 0x6b5b45, 6, 0.85, -6);
const terminal = put(new THREE.BoxGeometry(1.5, 1.9, 0.3), 0x2c3138, 0, 0.95, -5.4);
const player = { x: 0, z: 6, yaw: 0, pitch: 0 };

const input = createInput();
const state = { hp: signal(82), stamina: signal(100), dummyHp: signal(50), power: signal(false), output: signal(0.4), name: signal(''), near: signal(null), heading: signal(0),
  slots: signal(Array.from({ length: 20 }, () => null)), done: signal({}), blips: signal([]), hud: signal(HUD), touch: signal(Q.has('touch')) };
const frame = { ui: 0, total: 0, n: 0 };   // ms spent in the UI's per-frame work, and in the whole frame callback
let kit = null, worldUI = null, screen = null, t = (k) => k;

if (HUD) {
  const i18n = createI18n({ locale: Q.get('lang') || 'en', tables: TABLES });
  kit = createUIKit({ input, i18n, theme: Q.get('theme') || 'dark', motion: Q.get('motion') || 'auto' });
  t = kit.i18n.t;
  const tx = kit.tx, item = (id, icon, count) => ({ id, icon, name: tx('d.' + id), ...(count ? { count } : {}) });
  state.slots.value = Object.assign(state.slots.peek().slice(), { 0: item('lamp', '🏮'), 1: item('rope', '➰'), 3: item('bread', '🍞', 2), 7: item('herb', '🌿', 1) });
  const give = (it) => { const s = state.slots.peek().slice(); let i = it.count ? s.findIndex((x) => x && x.id === it.id) : -1;
    if (i >= 0) s[i] = { ...s[i], count: s[i].count + it.count }; else { i = s.findIndex((x) => !x); if (i < 0) return; s[i] = it; }
    state.slots.value = s; toasts(kit).push({ text: t('d.got', { item: t('d.' + it.id) }), tone: 'good' }); };
  const finish = (id) => { if (!state.done.peek()[id]) { state.done.value = { ...state.done.peek(), [id]: true }; kit.announce(t('ui.objectiveDone', { text: t('d.o.' + id) })); } };
  const objectives = memo(() => ['talk', 'chest', 'power'].map((id) => ({ id, text: tx('d.o.' + id), done: !!state.done.value[id] })), (a, b) => a.every((o, i) => o.done === b[i].done));

  // ---- HUD: everything that changes per frame is a transform or a custom property
  kit.mount(show(state.hud, () => safeArea({ pad: 1 },
    anchor({ at: 'top-start' }, stack({ gap: 0.4, 'data-hud': 'bars' },
      h(Bar, { value: state.hp, max: 100, label: tx('ui.health'), tone: 'health', icon: '♥' }),
      h(Bar, { value: state.stamina, max: 100, label: tx('ui.stamina'), tone: 'stamina', icon: '⚡', showValue: false }))),
    anchor({ at: 'top-end' }, stack({ gap: 0.6, align: 'flex-end' },
      h(MinimapFrame, { size: 8, heading: state.heading, markers: state.blips }),
      h(ObjectiveTracker, { objectives }))),
    anchor({ at: 'bottom', offset: [0, 5] }, show(() => !!state.near.value, () => h(Prompt, { action: 'interact', label: () => (state.near.value ? t('d.' + state.near.value) : '') }), { transition: 'fade' })),
    anchor({ at: 'bottom-start' }, show(() => !state.touch.value, () => row({ gap: 0.8, class: 'mk-muted', 'data-hud': 'hints' },
      h(Prompt, { action: 'inventory', label: tx('ui.inventory') }), h(Prompt, { action: 'menu', label: tx('menu.settings') }))))), 'hud'));
  kit.mount(show(() => state.touch.value && state.hud.value, () => [h(TouchControls, { input, actions: ['inventory', 'interact'] }),
    h('div', { style: 'position:absolute;inset-inline-end:5.2em;inset-block-start:4.5em' }, h(Button, { label: '◔', 'aria-label': tx('d.hint'), 'data-touch': 'wheel', onPress: () => wheel() }))]), 'hud');

  // ---- world-space UI
  worldUI = createWorldUI({ kit, camera, occluders: [...pillars, terminal], maxDistance: 40 });
  worldUI.label({ object: npc, offset: [0, 1.15, 0], text: tx('d.ana') });
  worldUI.label({ object: chest, offset: [0, 0.75, 0], text: tx('d.chest') });
  worldUI.healthBar({ object: dummy, offset: [0, 1.2, 0], value: state.dummyHp, max: 50, label: tx('d.dummy') });
  worldUI.marker({ position: [0, 2, -34], label: tx('d.beacon'), clamp: true, maxDistance: 400 });

  // ---- a screen in the world, drawn into a texture (the path XR uses: no DOM there)
  screen = createCanvasUI({ width: 512, height: 320, kit, description: () => cv.panel({ title: t('d.terminal') },
    cv.toggle({ value: state.power, label: t('d.power'), onChange: (on) => { if (on) { finish('power'); toasts(kit).push({ text: t('d.on'), tone: 'good' }); } } }),
    cv.slider({ value: state.output, label: t('d.output') }),
    cv.bar({ value: () => (state.power.value ? state.output.value * 100 : 0), max: 100, tone: 'good' }),
    cv.button({ label: t('d.vent'), onPress: () => toasts(kit).push({ text: t('d.vented') }) })) });
  const panel = screen.mesh({ width: 1.3 }); panel.position.set(0, 1.15, -5.24); scene.add(panel);
  screen.focus.value = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const aim = (e, down) => { ndc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1); ray.setFromCamera(ndc, camera); return screen.raycast(ray, down); };

  // ---- inventory, dialogue, wheel, settings
  const useItem = (it) => { if (!it) return; toasts(kit).push({ text: t('d.used', { item: t('d.' + it.id) }) }); if (it.id === 'bread' || it.id === 'herb') state.hp.value = Math.min(100, state.hp.peek() + 15); };
  let inv = null;
  const inventory = () => { if (inv) { inv.close(); return; } inv = modals(kit).open((close) => [h('h2', null, tx('ui.inventory')),
    h(InventoryGrid, { slots: state.slots, cols: 5, onUse: useItem }), h('p', { class: 'mk-muted' }, () => t('d.tip', { key: kit.glyph('confirm').text })),
    row({ gap: 0.5, justify: 'flex-end' }, h(Button, { label: tx('ui.close'), glyph: 'cancel', onPress: () => close() }))], { label: tx('ui.inventory'), onClose: () => { inv = null; } }); };
  const talk = async () => {
    const d = dialogue(kit), who = tx('d.ana');
    await d.say({ speaker: who, text: t('d.l1') });
    const pick = await d.say({ speaker: who, text: t('d.l2'), choices: [t('d.c1'), t('d.c2')] });
    if (pick < 0) return;
    await d.say({ speaker: who, text: t(pick === 0 ? 'd.r1' : 'd.r2') });
    if (!state.done.peek().talk) give(item('key', '🗝'));
    finish('talk');
  };
  const wheel = () => openRadial(kit, { items: ['wave', 'rest', 'map', 'shout', 'eat', 'light'].map((id, i) => ({ id, label: tx('d.' + id), icon: '👋💤🗺📣🍞🔦'.match(/./gu)[i] })),
    onPick: (it) => { toasts(kit).push({ text: t('d.did', { what: t('d.' + it.id) }) }); if (it.id === 'rest') state.stamina.value = 100; } });
  const log = Array.from({ length: 2000 }, (_, i) => i + 1), vol = { master: signal(0.8), music: signal(0.6), sfx: signal(0.9) };
  let menu = null;
  const settings = () => { if (menu) { menu.close(); return; } menu = modals(kit).open((close) => [h('h2', null, tx('menu.settings')),
    h(Tabs, { label: tx('menu.settings'), tabs: [
      { id: 'display', label: tx('menu.display'), content: () => stack({ gap: 0.5 },
        h(Select, { value: signal(kit.i18n.locale.peek()), label: tx('menu.language'), 'data-setting': 'language', options: kit.i18n.locales().map((l) => ({ value: l, label: LOCALE_NAMES[l] || l })), onChange: (l) => kit.i18n.setLocale(l) }),
        h(Select, { value: signal(kit.theme.peek()), label: tx('menu.theme'), 'data-setting': 'theme', options: Object.keys(kit.themes).map((n) => ({ value: n, label: tx('theme.' + n) })), onChange: (n) => kit.setTheme(n) }),
        h(Slider, { value: kit.textScale, min: 0.8, max: 1.6, step: 0.1, label: tx('menu.textScale'), 'data-setting': 'textScale', format: (v) => kit.i18n.number(v, { style: 'percent' }) }),
        h(Toggle, { value: signal(kit.motion.peek() === 'reduced'), label: tx('menu.reduceMotion'), 'data-setting': 'motion', onChange: (on) => kit.setMotion(on ? 'reduced' : 'auto') }),
        h(TextInput, { value: state.name, label: tx('d.name'), maxLength: 24 })) },
      { id: 'controls', label: tx('menu.controls'), content: () => h(RebindList, { input }) },
      { id: 'audio', label: tx('menu.audio'), content: () => stack({ gap: 0.5 }, Object.keys(vol).map((b) => h(Slider, { value: vol[b], label: tx('menu.' + b), format: (v) => kit.i18n.number(v, { style: 'percent' }) })),
        h(Progress, { value: vol.master, label: tx('menu.master') })) },
      { id: 'log', label: tx('d.log'), content: () => h(VirtualList, { items: log, label: tx('d.log'), height: 12, render: (n) => h('span', null, () => t('d.entry', { n: n.value })) }) }] }),
    row({ gap: 0.5, justify: 'flex-end' },
      h(Tooltip, { text: tx('menu.restartAsk') }, h(Button, { label: tx('menu.restart'), variant: 'ghost', 'data-menu': 'restart', onPress: async () => { if (await confirm(kit, { title: tx('menu.restart'), text: tx('menu.restartAsk') })) { batch(() => { state.done.value = {}; state.hp.value = 82; state.power.value = false; }); player.x = 0; player.z = 6; player.yaw = 0; close(); } } })),
      h(Button, { label: tx('menu.resume'), variant: 'primary', glyph: 'cancel', 'data-menu': 'resume', 'data-autofocus': true, onPress: () => close() }))], { label: tx('menu.settings'), class: 'mk-demo-menu', onClose: () => { menu = null; } }); };
  kit.addStyles('mk-demo-css', '.mk-demo-menu{width:min(100%,36em)}.mk-muted{color:var(--mk-muted)}');

  // mouse: drag on the picture looks; a click on the screen in the world presses its widgets
  let dragLook = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { state.touch.value = true; return; } if (!aim(e, true)) dragLook = [e.clientX, e.clientY]; });
  addEventListener('pointermove', (e) => { if (dragLook) { input.addLook((e.clientX - dragLook[0]) * 0.005, (e.clientY - dragLook[1]) * 0.005); dragLook = [e.clientX, e.clientY]; } else if (e.target === canvas) aim(e, e.buttons === 1); });
  addEventListener('pointerup', (e) => { dragLook = null; if (e.target === canvas && e.pointerType !== 'touch') aim(e, false); });
  let hotSaid = false;
  Object.assign(state, { inventory, settings, talk, wheel, give, finish, panel, invOpen: () => !!inv,
    interact() { const n = state.near.peek(); if (n === 'talk') talk(); else if (n === 'open') { give(item('herb', '🌿', 3)); finish('chest'); kit.announce(t('d.herbs', { n: 3 })); } else if (n === 'use') screen.activate(); },
    hotZone(inside) { if (inside && !hotSaid) toasts(kit).push({ text: t('d.hot'), tone: 'bad' }); hotSaid = inside; } });
}

// ---- the loop
const SPOTS = [['talk', npc], ['open', chest], ['use', terminal]], BLIPS = [['ana', npc, 'poi'], ['chest', chest, 'poi'], ['gen', terminal, 'goal'], ['post', dummy, 'enemy']];
let last = performance.now(), auto = Q.has('auto'), blipKey = '';
function tick(now) {
  const t0 = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  input.poll();
  const free = !kit || kit.nav.depth === 0;   // a modal or the dialogue owns the keys
  let moving = false, running = false;
  if (auto) { player.yaw += dt * 0.5; player.x = Math.sin(player.yaw) * 6; player.z = Math.cos(player.yaw) * 6; moving = true; }
  else if (free) {
    const m = input.move(), [lx, ly] = input.look(dt);
    player.yaw -= lx; player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - ly));
    running = input.down('run') && state.stamina.peek() > 1; moving = !!(m.x || m.z);
    const v = (running ? 6.5 : 3.2) * dt, s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    player.x += (m.x * c - m.z * s) * v; player.z += (-m.x * s - m.z * c) * v;
  }
  camera.position.set(player.x, 1.65, player.z); camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  const t1 = performance.now();
  if (kit && state.hud.peek()) {
    // game state into signals: rounded where a finer value would not show, so an unchanged HUD writes nothing
    const st = state.stamina.peek(); state.stamina.value = Math.round(Math.max(0, Math.min(100, st + (running && moving ? -22 : 12) * dt)) * 10) / 10;
    const inHot = Math.hypot(player.x - 5, player.z - 3) < 1.6; state.hotZone(inHot);
    state.hp.value = Math.round(Math.max(1, Math.min(100, state.hp.peek() + (inHot ? -14 : state.hp.peek() < 82 ? 2 : 0) * dt)) * 10) / 10;
    state.dummyHp.value = Math.round(25 + 25 * Math.cos(now / 2500));
    let near = null, best = 2.6;
    for (const [id, o] of SPOTS) { const d = Math.hypot(o.position.x - player.x, o.position.z - player.z); if (d < best) { best = d; near = id; } }
    state.near.value = near;
    state.heading.value = Math.round(-player.yaw * 200) / 200;
    const blips = BLIPS.map(([id, o, kind]) => { const dx = (o.position.x - player.x) / 14, dy = (o.position.z - player.z) / 14, l = Math.max(1, Math.hypot(dx, dy) / 0.85); return { id, kind, x: Math.round((dx / l) * 100) / 100, y: Math.round((dy / l) * 100) / 100 }; });
    const key = blips.map((b) => b.x + ',' + b.y).join(';'); if (key !== blipKey) { blipKey = key; state.blips.value = blips; }
    if (free) { if (input.pressed('interact')) state.interact(); if (input.pressed('inventory')) state.inventory(); if (input.pressed('menu')) state.settings(); }
    else if (input.pressed('inventory') && state.invOpen()) state.inventory();   // the same key closes it
    kit.update(now); worldUI.update(now); screen.update();
  }
  const t2 = performance.now();
  renderer.render(scene, camera);
  frame.ui += t2 - t1; frame.total += performance.now() - t0; frame.n++;
  requestAnimationFrame(tick);
}
if (kit) addEventListener('keydown', (e) => { if (e.code === 'KeyQ' && kit.nav.depth === 0 && !e.repeat) state.wheel(); });
window.__ui = { kit, state, world: worldUI, screen, input, frame, player, camera, panel: state.panel,
  setHud(on) { state.hud.value = !!on; if (kit) kit.root.style.display = on ? '' : 'none'; }, setAuto(on) { auto = !!on; } };
requestAnimationFrame(tick);
requestAnimationFrame(() => requestAnimationFrame(() => { window.__READY = true; }));

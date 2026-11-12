// The game of neon-district, spawned from the plan and the modules' anchors:
//   the carbine (weapon.js) and the sentinels (enemies.js), health that comes back a little, ammunition and med
//   pickups, the relay pass on the bar's counter, the relay's locked door (two hinged leaves in its `doors` anchor),
//   the uplink console on the roof (its `consoles` anchor) and the wave that answers it, three checkpoints
//   (plan.checkpoints: the game saves there and a death loads the last one), the HUD (hud.js), the sounds (sfx.js),
//   steam on the `steam` anchors, sparks on `sparks`, motes round the hologram, rain rings round the player.
// Input beyond the engine's action map: fire (mouse button, F, right trigger, touch), aim (right button, left
// trigger, Q, touch hold or toggle), reload (R, right bumper, touch), a strike with the stock (V, right stick click,
// touch), lean (Z / X, touch), crouch (C, touch), the options panel (O, touch), the guns (1-5, the mouse wheel, pad Y
// cycles, touch: the strip), the 0 unlock (0, both sticks clicked together, touch: a field in the options). The
// touch controls are in touch.js; the feel (rumble, buzz, heartbeat, hit-stop) in feel.js.
import * as THREE from 'three';
import { FX } from './fx.js';
import { createSfx } from './sfx.js';
import { createHud } from './hud.js';
import { createWeapon } from './weapon.js';
import { ARMS } from './arms.js';
import { createFeel, COMFORT, COMFORT_KEYS, COMFORT_RANGES, comfortPreset, cleanOptions } from './feel.js';
import { createEnemies } from './enemies.js';
import { createDrones } from './drones.js';
import { createTitle } from './title.js';
import { createTouch } from './touch.js';
import { setupKit } from './kit.js';
import { setupDestruct, shotTap } from './destruct.js';
import { T, lang, setLang, nextLang, pickLang, onLang, LANG_ORDER, LANG_NAMES, TABLES } from './text.js';
import { createAudioEngine, zonesFromPlan, PAD } from '@miragekit/game';
import { WET, flashEnvelope } from '@miragekit/core';

export const VERSION = 1;
const UPLINK_S = 40;
export { T, lang };
// the modes and the difficulty (kept in the settings; ?mode= and ?difficulty= set them for one visit)
export const MODES = ['mission', 'holdout'], DIFFS = ['standard', 'hard', 'brutal'], TITLE_HOURS = ['night', 'dusk', 'day'];
/** factors on the damage the player takes, the enemies' health and their accuracy */
export const TUNE = { standard: { dmg: 1, hp: 1, acc: 1 }, hard: { dmg: 1.4, hp: 1.3, acc: 1.15 }, brutal: { dmg: 2, hp: 1.6, acc: 1.35 } };
// the holdout: sentinels come from the stair foot and the relay room, kites out of the air over the plaza
const STAIR_FOOT = [[24.5, 0.16, -22], [26.2, 0.16, -22.2], [20, 0.16, -26], [16, 0.16, -22], [19, 0.16, -22.6], [12, 0.16, -27]];
const SKY = [[13, 10.5, -17], [19, 11, -16], [16, 10, -10], [23, 10.5, -11], [10, 10, -8]];
const BREAK_S = 9;

export function setupGame(ctx, { shared, vfx, Q, quality, relight, setHour, hour }) {
  const { game, physics, audio, root, plan, anchors, world, onDispose, input } = ctx;
  // the language: ?lang= for one visit, else the player's saved choice, else the browser's (text.js pickLang)
  const want = pickLang(Q, game.settings.ndLang);
  if (want !== lang) setLang(want);
  const M = shared.mats, { mat } = world, K = plan.levels;
  const sfx = createSfx(audio), assist = Q.get('assist') === '1';
  const stats = { shots: 0, hits: 0, heads: 0, kills: 0, deaths: 0 };
  const hud = createHud({ camera: world.camera, onDispose, T });
  let g = null, play = null, weapon = null, seed = 0x51ed270b, uplinkT = 0, sparkT = 2, lastFeet = null;
  const R = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) ^ (seed << 7)) >>> 0) / 4294967296);
  const player = {
    hp: 100, dead: false, speed: 0, exposed: 0, height: 1.62, crouch: 0, wantCrouch: false, feet: [plan.spawn.eye[0], plan.spawn.eye[1] - 1.62, plan.spawn.eye[2]], lastHurt: -99,
    collider: () => (g ? g.character.collider : undefined),
    shake(k) { weapon?.addShake(k); },
    hurt(amount, from) {
      if (player.dead || game.flags.done) return;
      player.hp -= amount; player.lastHurt = game.time; hud.hurt(from, amount); sfx.play('nd_hurt', { gain: 0.7 }); weapon.flinch(from, Math.min(1.6, 0.5 + amount / 15)); feel.hurt(amount);
      if (player.hp <= 0) die();
    },
  };
  // the run's choices: mode, difficulty and the title's hour, from the settings; the URL can set the first two
  const kept = game.settings.ndRun || {};
  const run = { mode: MODES.includes(kept.mode) ? kept.mode : 'mission', difficulty: DIFFS.includes(kept.difficulty) ? kept.difficulty : 'standard', hour: TITLE_HOURS.includes(kept.hour) ? kept.hour : 'night' };
  if (MODES.includes(Q.get('mode'))) run.mode = Q.get('mode');
  if (DIFFS.includes(Q.get('difficulty'))) run.difficulty = Q.get('difficulty');
  const saveRun = () => { game.settings.ndRun = { mode: run.mode, difficulty: run.difficulty, hour: run.hour }; game.saveSettings(); };
  const tune = { ...TUNE[run.difficulty] };
  // (the robots draw their rounds through a tap: destruct.js puts each round through the props on its line)
  const robotVfx = shotTap(vfx);
  const enemies = createEnemies({ world, game, physics, plan, vfx: robotVfx, sfx, player, assist, onDispose, tune });
  const drones = createDrones({ world, game, physics, plan, vfx: robotVfx, sfx, player, assist, onDispose, tune });
  // what a round can hit: the nearer of a sentinel and a kite; a hit knows whose it is (hit.owner.damage)
  const targets = { rayHit(o, d, max) { const a = enemies.rayHit(o, d, max), b = drones.rayHit(o, d, max); return a && b ? (a.t < b.t ? a : b) : a || b; }, noise: (p, r) => enemies.noise(p, r) };
  const wake = (zone) => { enemies.wake(zone, player.feet); drones.wake(zone); };
  // the player's own settings (kept with the key bindings and volumes, not in a save)
  // touch: its own look sensitivity, the buttons' opacity and size, the left FIRE, the sprint lock
  // feel: vibration (0-1) and the comfort preset with its values (feel.js COMFORT: shake, bob, punch, roll, kick,
  // settle, hit-stop, blur, flashes); prefers-reduced-motion: the comfort preset with the flashes down.
  // Kept settings are cleaned (an old or hand-edited one: NaN, strings, out of range) before use.
  const calm = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const coarse = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  const opts = cleanOptions(game.settings.nd, { reduced: calm, touch: coarse });
  // the comic hit words are off unless the player turned them on (pops: true); full screen on deploy unless turned off
  if (opts.pops !== true) opts.pops = false;
  if (opts.fullscreen !== false) opts.fullscreen = true;
  if (Q.get('fov') && Number.isFinite(+Q.get('fov'))) opts.fov = Math.min(90, Math.max(50, +Q.get('fov')));
  if (Q.get('sens') && Number.isFinite(+Q.get('sens'))) opts.sens = Math.min(5, Math.max(0.1, +Q.get('sens')));
  if (Q.get('comfort') in COMFORT) Object.assign(opts, comfortPreset(Q.get('comfort'), calm), { comfort: Q.get('comfort') });
  // the world's motion blur at the quality level's strength; the comfort's `blur` is a factor on it
  const blur0 = world.post?.motionBlur || 0;
  /** the look and the comfort values to where they act (once a tick: the options and the tests write opts) */
  function applyLook() {
    if (!play) return;
    const s = +opts.sens;
    play.look.sens = Number.isFinite(s) && s > 0 ? Math.min(5, s) : 1;
    play.look.invert = opts.invert === true;
    if (world.post) world.post.motionBlur = blur0 * Math.max(0, Math.min(1, +opts.blur || 0));
  }
  const feel = createFeel({ opts, input, sfx, canvas: world.renderer.domElement, game });
  // which room the shots ring in: the audio engine's zones (the bar, the relay) are indoors, the alley is the alley,
  // the rest (the street, the plaza, the roofs) is open
  const room = () => {
    const z = reverb?.stats?.zones || {};
    if (Object.values(z).some((w) => w > 0.5)) return 'indoor';
    const p = player.feet, a = plan.alley.rect;
    return p[0] > a[0] - 0.5 && p[0] < a[2] + 0.5 && p[2] > a[1] && p[2] < a[3] + 0.5 && p[1] < 3 ? 'alley' : 'open';
  };
  const saveOpts = () => { game.settings.nd = { ...opts }; game.saveSettings(); };
  // the comfort setting, for the options panel (window.__mirage.game.comfort): a preset sets every value together;
  // one value changed on its own makes the preset 'custom'. Both apply at once and are kept in the settings.
  const comfort = {
    presets: Object.keys(COMFORT), keys: COMFORT_KEYS, ranges: COMFORT_RANGES, table: COMFORT, reducedMotion: calm,
    get preset() { return opts.comfort; },
    get values() { return Object.fromEntries(COMFORT_KEYS.map((k) => [k, opts[k]])); },
    set(name) { if (!(name in COMFORT)) return false; Object.assign(opts, comfortPreset(name, calm), { comfort: name }); saveOpts(); applyLook(); return true; },
    setValue(k, v) {
      if (k === 'hitStop') opts.hitStop = v === true || v === 'true';
      else { const r = COMFORT_RANGES.find((x) => x[0] === k), x = +v; if (!r || !Number.isFinite(x)) return false; opts[k] = Math.min(r[2], Math.max(r[1], x)); }
      opts.comfort = 'custom'; saveOpts(); applyLook(); return true;
    },
  };
  const onUnlock = (r) => {
    if (r === 'unlocked') { opts.unlocked = true; saveOpts(); game.ui.toast(T.arms.unlocked); hud.radio(T.arms.unlockRadio); }
    else if (r === 'refilled') game.ui.toast(T.arms.refilled);
    else game.ui.toast(T.arms.wait(r));
  };
  weapon = createWeapon({ world, root, vfx, sfx, physics, M, player, targets, hud, stats, game, opts, feel, room, enemies, drones, onUnlock, assist, onReload: () => game.set('reloads', (game.flags.reloads || 0) + 1) });
  onDispose(() => weapon.dispose());
  weapon.S.fov = opts.fov;
  game.on('kill', (e) => { stats.kills++; game.set('kills', stats.kills); hud.feed(`${T.kinds[e.K.name]} ${T.destroyed}${stats.lastHead && e.K.name !== 'drone' ? ' · ' + T.weak : ''}`, stats.lastHead && e.K.name !== 'drone'); });

  // ---- input: held flags from the mouse, the keys, the pad and the touch buttons
  const held = { mouse: false, key: false, pad: false, aimMouse: false, aimKey: false, aimPad: false, leanL: false, leanR: false };
  // pad Y cycles the guns here, so the engine's Y (the inventory panel) is taken off it (the bag stays on I)
  PAD.inventory.length = 0;
  const SLOT = Object.fromEntries(ARMS.map((a) => ['Digit' + a.slot, a.id]));
  let wheelT = 0;
  const drill = Q.get('drill') === '1';
  let touch = null, touchOk = false, lastMag = 0, fallV = 0, wasAir = false;
  const look = new THREE.Vector3();
  const live = () => g && g.ui.started && !game.paused && !player.dead;
  const canvas = world.renderer.domElement;
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); onDispose(() => t.removeEventListener(ev, fn, o)); };
  listen(document, 'mousedown', (e) => { if (document.pointerLockElement !== canvas) return; if (e.button === 0) held.mouse = held.tap = true; if (e.button === 2) held.aimMouse = true; });
  listen(document, 'mouseup', (e) => { if (e.button === 0) held.mouse = false; if (e.button === 2) held.aimMouse = false; });
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(window, 'keydown', (e) => { if (e.repeat || !live()) return; if (e.code === 'KeyF') held.key = held.tap = true; if (e.code === 'KeyQ') held.aimKey = true; if (e.code === 'KeyR') weapon.S.wantReload = true;
    if (e.code === 'KeyV') weapon.melee(); if (e.code === 'KeyZ') held.leanL = true; if (e.code === 'KeyX') held.leanR = true; if (e.code === 'KeyC' || e.code === 'ControlLeft') player.wantCrouch = !player.wantCrouch;
    if (SLOT[e.code]) { if (!weapon.select(SLOT[e.code]) && !weapon.W[SLOT[e.code]].owned) game.ui.toast(T.arms.locked); }
    if (e.code === 'Digit0' || e.code === 'Numpad0') weapon.unlock();
    // the tests' drill (?drill=1): J stands the street's shield sentinel 8 m ahead, K a sentinel 4 m ahead, facing the player
    if (drill && (e.code === 'KeyJ' || e.code === 'KeyK')) {
      const en = enemies.list.find((x) => x.id === (e.code === 'KeyJ' ? 'g11' : 'g1')), d = e.code === 'KeyJ' ? 8 : 4, at = [player.feet[0] + Math.cos(play.yaw) * d, player.feet[1], player.feet[2] + Math.sin(play.yaw) * d];
      en.yaw = Math.atan2(player.feet[0] - at[0], player.feet[2] - at[2]); enemies.revive(en, at, 1); en.drill = true; if (e.code === 'KeyK') enemies.stun(en, 4); game.set('drills', (game.flags.drills || 0) + 1);
    }
    // U: the street's kite 5 m ahead and 1.3 m over the eye, held still for 3 s (a hack's target); L: an ammo cell 2.5 m ahead
    if (drill && (e.code === 'KeyU' || e.code === 'KeyL')) {
      const d = e.code === 'KeyU' ? 5 : 2.5, at = [player.feet[0] + Math.cos(play.yaw) * d, player.feet[1], player.feet[2] + Math.sin(play.yaw) * d];
      if (e.code === 'KeyU') { const k = drones.list.find((x) => x.id === 'd0'); k.drill = true; at[1] += player.height + 1.3; drones.revive(k, at, 1); k.grip = 3; }
      else kit.ammo.drop(at, 24);
      game.set('drills', (game.flags.drills || 0) + 1);
    } });
  listen(window, 'wheel', (e) => { if (!live() || hud.optionsOpen || performance.now() - wheelT < 120 || Math.abs(e.deltaY) < 1) return; wheelT = performance.now(); weapon.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  listen(window, 'keydown', (e) => { if (e.code === 'KeyT' && !e.repeat && live()) { const order = ['night', 'dawn', 'day', 'dusk'], next = order[(order.indexOf(hour()) + 1) % 4]; setHour(next); game.ui.toast(T.hours[next]); }
    if (e.code === 'KeyO' && !e.repeat && g && g.ui.started && !player.dead && (hud.optionsOpen || !game.paused)) toggleOptions(); });
  listen(window, 'keyup', (e) => { if (e.code === 'KeyF') held.key = false; if (e.code === 'KeyQ') held.aimKey = false; if (e.code === 'KeyZ') held.leanL = false; if (e.code === 'KeyX') held.leanR = false; });
  listen(window, 'blur', () => { for (const k of Object.keys(held)) held[k] = false; });
  let padReload = false, padMelee = false, padCycle = false, padBoth = false;
  // the options panel pauses the game; its values apply at once and are kept in the settings
  function toggleOptions() {
    const open = hud.options({ values: { ...opts, lang, hour: hour() }, touch: !!touch, onHour: (h) => setHour(h),
      onChange: (k, v) => {
        if (k === 'code') { if (/0/.test(String(v))) weapon.unlock(); return; }
        if (k === 'comfort') { comfort.set(v); return; }
        if (COMFORT_KEYS.includes(k)) { comfort.setValue(k, v); return; }
        opts[k] = v; if (k === 'fov') weapon.S.fov = v; saveOpts(); applyLook(); touch?.apply();
      },
      onFull: (on) => { opts.fullscreen = on; saveOpts(); return on ? enterFull(true) : exitFull(); },
      onClose: () => { if (!title.shown) game.pause(false); title.render(); },
      onLang: () => switchLang(nextLang()) });
    if (open) { game.pause(true); touch?.reset(); if (document.pointerLockElement) document.exitPointerLock(); }
  }

  // ---- the language at run time: the tables swap in place (text.js); what was drawn once is drawn again here
  function switchLang(l) {
    if (!TABLES[l]) return;
    run.lang = l;   // before the listeners: the title redraws its LANGUAGE row from it
    setLang(l);
    game.settings.ndLang = l; game.saveSettings();
    const u = new URL(location.href);   // the choice is kept: a ?lang= left in the address would override it on reload
    if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); history.replaceState(history.state, '', u.href); }
  }
  onDispose(onLang(() => {
    hud.relang(); title?.relang(); touch?.relang(); kit?.story.relang();
    if (g) { g.ui.setStrings?.({ ...T.engine }); g.ui.objective(...objective(game)); }
    const it = game.inventory.items.find((i) => i.id === 'pass');
    if (it) { it.name = T.passName; it.text = T.passText; game.emit('inventory', {}); }
  }));

  // ---- full screen: asked for on DEPLOY (a user gesture: browsers allow it nowhere else), kept off once the player
  // turns it off, ?fullscreen=0 for one visit (the headless checks). A phone also tries to lock landscape. iPhone
  // Safari has no element full screen: a one-line hint to add the page to the Home Screen instead.
  const fullAllowed = () => Q.get('fullscreen') !== '0' && opts.fullscreen !== false;
  const fs = { asked: 0, hinted: false, left: false };
  function enterFull(force = false) {
    if (!force && !fullAllowed()) return Promise.resolve(false);
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) {
      if (!fs.hinted && /iPhone|iPod/.test(navigator.userAgent)) { fs.hinted = true; setTimeout(() => game.ui.toast(T.opt.fullHint, 5000), 400); }
      return Promise.resolve(false);
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) return Promise.resolve(true);
    fs.asked++;
    let p;
    try { p = req.call(el, { navigationUI: 'hide' }); } catch { return Promise.resolve(false); }
    return Promise.resolve(p).then(() => {
      if (matchMedia('(pointer: coarse)').matches) screen.orientation?.lock?.('landscape')?.catch?.(() => {});
      return true;
    }, () => false);
  }
  function exitFull() { try { const p = document.fullscreenElement && document.exitFullscreen?.(); Promise.resolve(p).catch(() => {}); } catch { /* not in it */ } return Promise.resolve(false); }
  // left with Esc while playing: the engine pauses (pointer lock goes with it); its menu offers the way back
  listen(document, 'fullscreenchange', () => { fs.left = !document.fullscreenElement && fs.asked > 0 && opts.fullscreen !== false; });
  const menuWatch = new MutationObserver(() => {
    const body = document.querySelector('.mg-menu[open] .mg-body');
    if (!body || !fs.left || document.fullscreenElement || body.querySelector('[data-nd=full]') || !body.querySelector('[data-do=resume]')) return;
    const b = document.createElement('button'); b.dataset.nd = 'full'; b.textContent = T.opt.fullBack;
    b.addEventListener('click', () => { enterFull(true).then((ok) => { if (ok) b.remove(); }); });
    body.querySelector('[data-do=resume]').after(b);
  });
  onDispose(() => menuWatch.disconnect());

  // ---- the relay pass, on the bar's counter
  const pass = new THREE.Group();
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.1), mat.std({ color: new THREE.Color(0.02, 0.03, 0.04), roughness: 0.3, metalness: 0.8 }));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.05), M.neon.cyan); chip.position.y = 0.009;
  pass.add(card, chip); pass.position.set(...plan.bar.pass); root.add(pass);
  let passT = 0;
  game.on('place', () => { passT = 0; });
  game.add({ id: 'pass', object: pass,
    interact: { label: () => T.passLabel, reach: 2.6, use: (gm, e) => {
      gm.inventory.add({ id: 'pass', name: T.passName, text: T.passText });
      audio.play('pickup', { at: plan.bar.pass }); vfx.burst(FX.take, plan.bar.pass); gm.remove(e); game.ui.toast(T.passToast); hud.radio(T.radio.pass);
    } },
    update: (dt) => { passT += dt; pass.rotation.y = passT * 1.4; pass.position.y = plan.bar.pass[1] + 0.06 + Math.sin(passT * 2.2) * 0.02; } });

  // ---- the relay's door: two leaves on kinematic hinges, locked until the pass is carried
  const d = anchors.doors[0], hw = d.width / 2, doorMat = mat.std({ color: new THREE.Color(0.05, 0.06, 0.075), roughness: 0.35, metalness: 0.85 });
  const leaves = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(d.pos[0] + s * hw, d.pos[1] + d.height / 2, d.pos[2]);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(hw - 0.02, d.height, 0.09), doorMat); leaf.position.x = -s * hw / 2; leaf.castShadow = leaf.receiveShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, d.height * 0.7, 0.1), M.neon.red); strip.position.x = -s * (hw - 0.1);
    pivot.add(leaf, strip); root.add(pivot);
    return { strip, hinge: physics.hinge(pivot, { half: [hw / 2 - 0.01, d.height / 2, 0.045], offset: [-s * hw / 2, 0, 0], swing: s * d.swing, speed: 1.5 }) };
  });
  const doorAt = [d.pos[0], d.pos[1] + 1.3, d.pos[2] + 0.4];
  const showDoor = (open) => { for (const l of leaves) { l.hinge.set(open); l.strip.material = open ? M.neon.green : M.neon.red; } };
  game.add({ id: 'door', pos: doorAt,
    interact: { reach: 3, can: (gm) => !gm.flags.doorOpen,
      label: (gm) => (gm.inventory.has('pass') ? T.doorOpen : T.doorLocked),
      use: (gm) => {
        if (!gm.inventory.has('pass')) { audio.play('locked', { at: doorAt }); game.ui.toast(T.doorToast); return; }
        for (const l of leaves) { l.hinge.open(); l.strip.material = M.neon.green; }
        audio.play('door', { at: doorAt }); sfx.play('nd_alarm', { at: doorAt, gain: 0.7, ref: 6 }); gm.set('doorOpen', true);
        wake('relay'); hud.radio(T.radio.door);
      } },
    save: () => ({ open: !!game.flags.doorOpen }), load: (s) => showDoor(s.open) });

  // ---- the uplink console on the roof
  const con = anchors.consoles[0];
  game.add({ id: 'uplink', pos: con.pos,
    interact: { reach: 2.8, can: (gm) => !gm.flags.uplink, label: () => T.uplinkLabel,
      use: (gm) => {
        gm.set('uplink', true); uplinkT = 0; sfx.play('nd_alarm', { gain: 0.6 });
        wake('wave'); game.ui.toast(T.uplinkToast); hud.radio(T.radio.hold);
      } },
    save: () => ({ t: +uplinkT.toFixed(1) }), load: (s) => { uplinkT = s.t || 0; } });

  // ---- pickups: walk over one to take it (when it is of use)
  const crateMat = mat.std({ color: new THREE.Color(0.1, 0.11, 0.09), roughness: 0.5, metalness: 0.6 }), white = mat.std({ color: new THREE.Color(0.6, 0.62, 0.64), roughness: 0.4 });
  const pickups = {};
  for (const p of plan.pickups) {
    const o = new THREE.Group(), ammo = p.kind === 'ammo';
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), ammo ? crateMat : white); box.castShadow = true;
    // (the med kit's cross is one mesh of its two bars)
    const tag = new THREE.Mesh(ammo ? new THREE.BoxGeometry(0.345, 0.04, 0.225) : world.geom.mergeGeometries([new THREE.BoxGeometry(0.12, 0.205, 0.04), new THREE.BoxGeometry(0.04, 0.205, 0.12)], false), ammo ? M.neon.amber : M.neon.green);
    o.add(box, tag);
    o.position.set(p.at[0], p.at[1] + 0.32, p.at[2]); root.add(o);
    let t = R() * 6;
    game.add(pickups[p.id] = { id: p.id, object: o, update: (dt, gm) => {
      t += dt; o.rotation.y = t * 1.1; o.position.y = p.at[1] + 0.34 + Math.sin(t * 2) * 0.04;
      if (player.dead || Math.hypot(player.feet[0] - p.at[0], player.feet[2] - p.at[2]) > 0.95 || Math.abs(player.feet[1] - p.at[1]) > 1.2) return;
      if (ammo) { const got = weapon.give(48, true); if (!got) return; sfx.play('nd_ammo', { gain: 0.8 }); game.ui.toast(`${T.ammo} · ${T.arms.short[weapon.lastGive]} +${got}`); }
      else { if (player.hp >= 100) return; player.hp = Math.min(100, player.hp + 45); sfx.play('nd_med', { gain: 0.8 }); game.ui.toast(T.med); }
      vfx.burst(FX.take, [p.at[0], p.at[1] + 0.3, p.at[2]]); gm.remove(p.id);
    } });
  }

  // ---- checkpoints: cross the box, the game saves; a death loads it
  const checkpoint = (id, quiet) => { if (H.on) return; game.set('cp_' + id, true); try { g.save('auto'); if (!quiet) game.ui.toast(T.checkpoint); if (id === 'roof') hud.radio(T.radio.roof); } catch { /* storage full or blocked: play on without it */ } };
  for (const c of plan.checkpoints) game.zone({ id: 'cp-' + c.id, box: c.box, once: true, enter: () => checkpoint(c.id) });
  game.add({ id: 'player',
    save: () => ({ hp: Math.round(player.hp), gun: weapon.save(), stats: { ...stats } }),
    load: (s) => { player.hp = Math.max(s.hp, 60); player.dead = false; player.lastHurt = -99; player.wantCrouch = false; weapon.load(s.gun); Object.assign(stats, s.stats, { deaths: stats.deaths }); stats.kills = game.flags.kills || 0; for (const k of Object.keys(held)) held[k] = false; touch?.reset(); } });
  function die() {
    player.dead = true; stats.deaths++; sfx.play('nd_death', { gain: 0.6 });
    if (H.on) return holdoutOver();
    game.ui.message(T.deadTitle, T.deadBody, T.deadBtn);
    const dlg = document.querySelector('.mg-msg');
    const back = () => { dlg.removeEventListener('close', back); try { g.load('auto'); } catch { location.reload(); } };
    dlg.addEventListener('close', back);
  }

  // ---- scenery that the game animates: steam, sparks, the hologram's motes, lamps that pulse, rain rings
  const tints = ['#7fd0e0', '#d070a0', '#c8a070', '#70c8a0', '#9080d0'];
  // looping emitters, kept so they can be started again: when a tool jumps the view (play.place) the scene clock
  // goes back to 0, the particle pools rewind, and an emitter spawned at a later step would wait for that step
  const loops = [];
  const emit = (fx, o) => { const l = { fx, o, h: vfx.spawn(fx, o) }; loops.push(l); return l; };
  let rewound = 0;
  game.on('place', () => { rewound = 3; });
  // (the steam is modules/steam.js: lit volumetric plumes; the particle puffs only without it)
  if (!shared.plumes) (anchors.steam || []).forEach((a, i) => emit(FX.steam(tints[i % tints.length]), { position: a.pos }));
  for (const h of (anchors.holos || []).filter((a) => a.kind === 'figure')) emit(FX.motes, { position: h.pos });
  const sparkLight = new THREE.PointLight(0xffd090, 0, 8, 2); root.add(sparkLight); world.lighting?.addLight(sparkLight);
  const feet = new THREE.Object3D(); root.add(feet);
  const splash = quality === 'low' ? null : emit(FX.splash, { follow: feet });
  const strobes = anchors.strobes || [], lanterns = anchors.lanterns || [];
  sfx.loop('nd_rain', { bus: 'ambience', gain: 0.5 });
  sfx.loop('nd_score', { bus: 'music', gain: 0.9 });
  (anchors.steam || []).slice(0, 3).forEach((a) => sfx.loop('nd_steam', { at: a.pos, gain: 0.35, ref: 2.5 }));
  for (const s of (anchors.signs || []).filter((s) => s.w * s.h > 5).slice(0, 5)) sfx.loop('nd_hum', { at: s.pos, gain: 0.5, ref: 3 });

  // ---- weather and sound: a lamp high over the block for the lightning, the audio engine for the rooms' reverb
  // with world.flash (main.js, core weather.js) the flash is a uniform every wet surface and the storm sky read, and a
  // bolt drawn in the sky; without it a clustered lamp high over the block
  const flash = world.flash, sky = flash ? null : new THREE.PointLight(0xcfe0ff, 0, 600, 2);
  if (sky) { root.add(sky); world.lighting?.addLight(sky); }
  const skyGain = 26000, said = { spotted: false, hurtT: -99 }, bolt = { t: 99, dir: [0, 1, 0] };
  let boltT = 9, thunderT = 0, reverb = null;
  /** a strike now (stills, checks): a bolt r m away at bearing a (radians) */
  const strike = (a = R() * 6.28, r = 260 + R() * 200) => {
    const c = world.camera.position, bx = c.x + Math.cos(a) * r, bz = c.z + Math.sin(a) * r;
    if (flash) flash.strike([bx + (R() - 0.5) * 60, 330, bz + (R() - 0.5) * 60], [bx, 25, bz], R() * 1000, c.toArray());
    bolt.dir = [bx - c.x, 160, bz - c.z]; bolt.t = 0; boltT = Math.max(boltT, 16);
    if (sky) { sky.position.set(c.x + (bx - c.x) * 0.4, 110, c.z + (bz - c.z) * 0.4); sky.userData.t = 0.38; }
    thunderT = 0.15 + Math.hypot(r, 200) / 343;   // sound at 343 m/s from the bolt's middle
  };
  game.weather = { strike, get flash() { return flash ? flash.level : sky ? sky.intensity : 0; } };
  try { reverb = createAudioEngine({ audio, voices: 24, zones: zonesFromPlan(plan), zoneOptions: { ambient: { reverb: 'outdoor', wet: 0.16 } } }); onDispose(() => reverb.dispose()); } catch { reverb = null; }
  game.on('start', () => hud.radio(H.on ? T.radio.holdStart : T.radio.start));

  // ---- one fixed step
  game.system((dt) => {
    sfx.poll();
    if (!g) return;
    const gains = relight();   // the hour's lamp level into every clustered lamp (the hour can change, and eases)
    play.turn(0, 0, 0);            // the scene clock (rain, effects, screens) runs only on frames the player drives: keep it running
    game.dirty = true;
    const p = g.character.pos;
    player.speed = lastFeet ? Math.hypot(p[0] - lastFeet[0], p[2] - lastFeet[2]) / dt : 0;
    lastFeet = [p[0], p[1], p[2]]; player.feet[0] = p[0]; player.feet[1] = p[1]; player.feet[2] = p[2];
    // input
    const pad = input.pad, pb = (i) => !!(pad && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
    held.pad = pb(7); held.aimPad = pb(6);
    if (pb(5) && !padReload) weapon.S.wantReload = true;
    padReload = pb(5);
    if (pb(11) && !padMelee && live() && !pb(10)) weapon.melee();
    padMelee = pb(11);
    if (pb(3) && !padCycle && live()) weapon.cycle(1);
    padCycle = pb(3);
    if (pb(10) && pb(11) && !padBoth && live()) weapon.unlock();   // both sticks clicked together
    padBoth = pb(10) && pb(11);
    if (g.ui.touch && !touch) {   // the touch controls, once a finger is seen (or the screen is a touch screen)
      hud.touch();
      touch = createTouch({ T, input, opts, parent: document.querySelector('.mg-touch'), onDispose, ready: () => g.ui.started, paused: () => game.paused || player.dead, kit, weapon, live,
        on: { reload: () => { weapon.S.wantReload = true; }, crouch: () => { player.wantCrouch = !player.wantCrouch; }, melee: () => { if (live()) weapon.melee(); }, options: toggleOptions,
          select: (id) => { if (!live()) return; if (!weapon.select(id) && !weapon.W[id].owned) game.ui.toast(T.arms.locked); }, cycle: (d) => { if (live()) weapon.cycle(d); } } });
      hud.avoid(() => touch.rects()); kit.overlay.avoid(hud.under);
    }
    const ok = live();
    if (touch) {
      if (touchOk && !ok) touch.reset();   // a death or a pause: every finger let go
      touchOk = ok;
      touch.use(ok && g.near ? game.label(g.near) : null);
      if (touch.sprintLocked) { input.stick(0, 1); input.hold('run', true); }   // the overlay's own menu clears the input
      // the aim assist (touch only): the turn slows while the crosshair is on a target the world does not hide
      touch.slow = 1;
      if (ok && touch.busy) {
        const o = world.camera.position.toArray(), dv = world.camera.getWorldDirection(look).toArray(), on = targets.rayHit(o, dv, 70);
        if (on && !physics.ray(o, dv, on.t, player.collider())) touch.slow = 0.45;
      }
      touch.paint();
    }
    if (weapon.S.mag === 0 && lastMag > 0 && weapon.S.reloading <= 0) feel.empty();   // the magazine ran dry
    lastMag = weapon.S.mag;
    weapon.S.fire = ok && (held.mouse || held.key || held.pad || held.tap || !!touch?.fire);   // tap: a press shorter than a step still fires once
    held.tap = false;
    weapon.S.aim = ok && (held.aimMouse || held.aimKey || held.aimPad || !!touch?.aim);
    if (assist && weapon.S.reserve < weapon.arm.mag) weapon.S.reserve = weapon.arm.mag;   // the easy mode never runs dry (one magazine in reserve: low enough for ammo.js's marker)
    // the look: the player's sensitivity and inverted axis go to play, which applies them to each turn as it arrives.
    // (They used to rescale here, once a tick, what had turned since the last tick: play had clamped the pitch first,
    // so with the axis inverted the view latched at the top or the bottom for good, the scaled turn landed a frame
    // late at 120 Hz, and a checkpoint's pitch was rescaled as if it were a turn.)
    applyLook();
    // crouching: a lower eye and a slower walk (the body's collider keeps its height: no crawling under things)
    player.crouch += ((ok && player.wantCrouch ? 1 : 0) - player.crouch) * Math.min(1, dt * 10); player.height = 1.62 - 0.6 * player.crouch;
    // the gun's weight: the gatling slows the walk, more while it spins
    const heavy = weapon.arm.walkFiring && weapon.S.spin > 0.3 ? weapon.arm.walkFiring : weapon.arm.walk;
    g.character.body.walk = (player.crouch > 0.5 ? 1.7 : 3.3) * heavy; g.character.body.run = (player.crouch > 0.5 ? 1.7 : 5.4) * heavy;
    // a landing: a thump, a dip of the view, a rumble
    const ch = g.character;
    if (!ch.onGround) fallV = Math.min(fallV, ch.vy);
    else if (wasAir) { if (fallV < -3.2) { weapon.land(-fallV); feel.land(-fallV); game.flags.landings = (game.flags.landings || 0) + 1; } fallV = 0; }
    wasAir = !ch.onGround;
    weapon.S.wantLean = ok ? Math.max(-1, Math.min(1, (held.leanR ? 1 : 0) - (held.leanL ? 1 : 0) + (touch?.lean || 0))) : 0;
    weapon.update(dt, ok);
    feel.update(dt, player.hp, player.dead);
    // a hit-stop: for a few hundredths of a second after a kill the robots hold still
    const edt = feel.stopping ? dt * 0.08 : dt;   // not 0: the robots divide by their step
    enemies.update(edt); drones.update(edt);
    reverb?.update(dt, world.camera);
    if (!said.spotted && enemies.list.some((e) => e.state === 'fight')) { said.spotted = true; hud.radio(T.radio.spotted); }
    if (player.hp < 35 && !player.dead && game.time - said.hurtT > 40) { said.hurtT = game.time; hud.radio(T.radio.hurt); }
    // weather: while it rains, now and then a bolt beyond the roofs, the block lit cold for a moment, thunder by distance
    if ((boltT -= dt) <= 0) { boltT = 16 + R() * 22; if (WET.uRain.value > 0.2) strike(); }
    // the flash: at flashes 1 a leader, the return stroke and a re-strike (three pulses in 0.4 s, Nizwa's shape); below
    // 1 one smooth pulse at the flashes' strength (no flicker; reduced motion caps it at 0.3, feel.js)
    const fl = Math.max(0.2, Math.min(1, +opts.flashes || 0.6));
    bolt.t += dt;
    if (flash) flash.set(flash.envelope(bolt.t, fl), bolt.dir);
    else { const st = sky.userData.t = (sky.userData.t || 0) - dt; sky.intensity = st <= 0 ? 0 : skyGain * gains.room * flashEnvelope(0.38 - st, fl); }
    if (thunderT > 0 && (thunderT -= dt) <= 0) sfx.play('nd_thunder', { bus: 'ambience', gain: 0.9 });
    // health: a little of it comes back out of a fight
    if (!player.dead && assist) player.hp = Math.min(100, player.hp + dt * 6);
    else if (!player.dead && player.hp < 50 && game.time - player.lastHurt > 5) player.hp = Math.min(50, player.hp + dt * 9);
    // the uplink: it runs for UPLINK_S seconds, and ends when the wave is down too
    if (H.on) holdout(dt);
    else if (game.flags.uplink && !game.flags.done) {
      uplinkT = Math.min(UPLINK_S, uplinkT + dt);
      const left = enemies.byZone.wave.filter((e) => !e.dead).length + (drones.byZone.wave || []).filter((e) => !e.dead).length;
      if (uplinkT >= UPLINK_S && left === 0) {
        game.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.9 });
        const acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0, points = props.rate((stats.deaths === 0 ? 1 : 0) + (acc >= 35 ? 1 : 0) + (game.time < 420 ? 1 : 0));   // (casualties: never the top rating, destruct.js)
        game.ui.message(T.doneTitle, T.doneBody({ diff: T.front.diffs[run.difficulty], rating: T.ratings[points], min: Math.floor(game.time / 60), sec: Math.round(game.time % 60), kills: stats.kills, acc, shots: stats.shots, heads: stats.heads, deaths: stats.deaths }) + cardLines(), T.doneBtn);
        hud.radio(T.radio.done); game.set('rating', points);
        checkpoint('done', true);
      } else if (Math.floor(uplinkT) !== Math.floor(uplinkT - dt) && uplinkT < UPLINK_S) sfx.play('nd_tick', { gain: 0.25 });
    }
    // scenery: a broken fitting spits sparks, lamps pulse, rain rings follow the player outdoors
    if ((sparkT -= dt) <= 0) {
      const list = anchors.sparks || [];
      if (list.length) { const a = list[Math.floor(R() * list.length)]; vfx.burst(FX.sparks, a.pos, { direction: [0, -1, 0], scale: 0.7 }); sparkLight.position.set(...a.pos); sparkLight.userData.t = 0.12; sfx.play('nd_impact', { at: a.pos, gain: 0.5, ref: 4 }); }
      sparkT = 2.5 + R() * 5;
    }
    sparkLight.userData.t = (sparkLight.userData.t || 0) - dt; sparkLight.intensity = sparkLight.userData.t > 0 ? 40 * gains.room * (fl >= 1 ? R() : fl * sparkLight.userData.t / 0.12) : 0;
    // a sign that flickers: raw, a random dip a tick (4 %); below 1 a slow half dip now and then (every 4.8 s, 0.6 s long)
    for (const s of strobes) s.light.intensity = s.light.userData.base * (s.flicker ? (fl >= 1 ? (R() < 0.04 ? 0.25 : 1) : 1 - 0.5 * Math.max(0, Math.sin(game.time * 1.3 + s.light.id) - 0.92) / 0.08) : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(game.time * (game.flags.uplink ? 9 : 3.2)), 2));
    for (const [i, l] of lanterns.entries()) l.light.intensity = l.light.userData.base * (0.93 + 0.07 * Math.sin(game.time * (5 + i) + i));
    const indoors = (p[1] < 4 && ((p[0] > plan.bar.rect[0] && p[0] < plan.bar.rect[2] && p[2] > plan.bar.rect[1] && p[2] < plan.bar.rect[3]) || (p[0] > plan.relay.rect[0] && p[2] < plan.relay.rect[3])));
    feet.position.set(p[0], Math.round(p[1] * 50) / 50 + 0.03, p[2]);
    if (rewound > 0 && --rewound === 0) for (const l of loops) { l.h.stop(); l.h = vfx.spawn(l.fx, l.o); }
    if (splash) splash.h.move({ position: feet.position, rate: indoors ? 0 : 1 });   // rate: a factor on the effect's own
    // the HUD
    const S = weapon.S;
    hud.update(dt, { hp: player.hp, dead: player.dead, mag: S.mag, reserve: S.reserve, reloading: S.reloading > 0, ads: S.ads, pos: p, yaw: play.yaw,
      spread: weapon.spread(), arm: weapon.arm, gun: { id: weapon.id, to: weapon.switchingTo, heat: S.heat, vent: S.vent, spin: S.spin, owned: weapon.W },
      tally: `${H.on ? T.waveN(Math.max(1, H.wave)) + ' · ' : ''}${stats.kills} ${T.down} · ${T.front.diffs[run.difficulty]}${assist ? ' · ' + T.assist : ''}${stats.civilians ? ' · ' + T.dx.tally(stats.civilians, stats.penalty) : ''}`,
      ...(H.on ? waveBar() : { uplink: game.flags.uplink && !game.flags.done ? uplinkT / UPLINK_S : null, uplinkText: uplinkT >= UPLINK_S ? T.uplinkReady : `${T.uplink} ${Math.round(100 * uplinkT / UPLINK_S)} %` }), goal: goal(game) });
  });

  // ---- the holdout: endless waves at the relay roof, the uplink already running. The enemy and kite lists are fixed
  // pools: a wave revives the dead (enemies.revive / drones.revive) instead of building new rigs.
  const H = { on: false, wave: 0, state: 'break', t: 5, foes: [], queue: [], total: 0, spawnT: 0, callT: 0 };
  const roof = plan.viewpoints.find((v) => v.name === 'roof'), roofAt = [roof.eye[0], K.roof, roof.eye[2]];
  const roofKit = plan.pickups.filter((p) => Math.abs(p.at[1] - K.roof) < 0.5).map((p) => p.id);
  const bestOf = () => (game.settings.ndBest || {})[run.difficulty] || 0;
  function startHoldout() {
    H.on = true; H.wave = 0; H.state = 'break'; H.t = 5; H.foes = []; H.queue = [];
    for (const e of enemies.list) enemies.park(e);
    for (const e of drones.list) drones.park(e);
    game.set('holdout', true); game.set('uplink', true); game.set('cp_roof', true);
    play.place(roof.eye, roof.look, 'walk');
  }
  const free = (list, shown) => list.filter((e) => e.dead && (!shown(e) || e.deadT > 3));
  const reviveKite = (d, i, w, hp) => () => { drones.revive(d, SKY[(i + w) % SKY.length], hp); H.foes.push(d); };
  function startWave() {
    const w = ++H.wave;
    game.set('wave', w);
    // the jobs come in order: shield sentinels from the second wave, marksmen from the third, menders from the fourth
    const allowed = (e) => (e.K.name === 'shield' ? w >= 2 : e.K.name === 'marksman' ? w >= 3 : e.K.name === 'mender' ? w >= 4 : true);
    const pool = free(enemies.list, (e) => e.rig.root.visible).filter(allowed), sky = free(drones.list, (e) => e.o.visible).filter(allowed).sort((a, b) => (b.kind === 'mender') - (a.kind === 'mender'));
    const n = Math.min(pool.length, 2 + w), heavies = Math.min(Math.floor((w - 1) / 2), n - 1), kites = Math.min(sky.length, 1 + Math.floor((w - 1) / 2));
    const hp = 1 + 0.07 * (w - 1);   // past the pool's size a wave grows in toughness
    const big = pool.filter((e) => e.K.name === 'heavy'), jobs = pool.filter((e) => e.K.name === 'shield' || e.K.name === 'marksman'), small = pool.filter((e) => e.K.name === 'grunt');
    const pick = [...jobs.slice(0, Math.min(1 + Math.floor((w - 2) / 2), n - 1)), ...big.slice(0, heavies)];
    for (const e of [...small, ...big.slice(heavies), ...jobs]) if (pick.length < n && !pick.includes(e)) pick.push(e);
    H.queue = []; H.foes = []; H.total = pick.length + kites;
    pick.forEach((e, i) => {
      H.queue.push(() => { enemies.revive(e, STAIR_FOOT[i % STAIR_FOOT.length], hp); e.home = roofAt.slice(); enemies.alert(e, player.feet, 0.3 + R() * 0.5); H.foes.push(e); });
      if (i < kites) H.queue.push(reviveKite(sky[i], i, w, hp));
    });
    for (let i = pick.length; i < kites; i++) H.queue.push(reviveKite(sky[i], i, w, hp));
    H.state = 'fight'; H.spawnT = 0.4; H.callT = 2;
    hud.radio(T.radio.wave(w)); game.ui.toast(T.waveN(w)); sfx.play('nd_alarm', { gain: 0.5 });
  }
  function holdout(dt) {
    if (player.dead) return;
    if (H.state === 'break') { if ((H.t -= dt) <= 0) startWave(); return; }
    if (H.queue.length && (H.spawnT -= dt) <= 0) { H.queue.shift()(); H.spawnT = 0.9; }
    // they know where the player is: whoever stands about, or has reached the last place it looked, comes again
    if ((H.callT -= dt) <= 0) {
      H.callT = 1.5;
      for (const e of H.foes) if (e.rig && !e.dead && (e.state === 'post' || (e.state === 'search' && (e.agent.arrived || !e.agent.path)))) enemies.alert(e, player.feet, R() * 0.4);
    }
    if (!H.queue.length && H.foes.every((e) => e.dead)) {
      H.state = 'break'; H.t = BREAK_S; game.set('waves', H.wave);
      if (H.wave > bestOf()) { game.settings.ndBest = { ...(game.settings.ndBest || {}), [run.difficulty]: H.wave }; game.saveSettings(); }
      for (const id of roofKit) if (!game.entities.has(id)) { const ent = pickups[id]; game.removed.delete(id); root.add(ent.object); game.add(ent); vfx.burst(FX.take, ent.object.position.toArray()); }
      hud.radio(T.radio.cleared); game.ui.toast(T.waveClear); audio.play('done', { bus: 'sfx', gain: 0.6 });
    }
  }
  const waveBar = () => {
    if (H.state === 'fight') { const left = H.queue.length + H.foes.filter((e) => !e.dead).length; return { uplink: H.total ? 1 - left / H.total : 0, uplinkText: `${T.waveN(H.wave)} · ${T.hostiles(left)}` }; }
    return { uplink: 1 - Math.max(0, H.t) / (H.wave ? BREAK_S : 5), uplinkText: T.nextWave(H.wave + 1, Math.ceil(Math.max(0, H.t))) };
  };
  function holdoutOver() {
    const waves = game.flags.waves || 0, acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0;
    game.ui.message(T.holdTitle, T.holdBody({ diff: T.front.diffs[run.difficulty], waves, kills: stats.kills, acc, shots: stats.shots, rating: T.ratings[props.rate(Math.min(3, Math.floor(waves / 3)))], best: Math.max(waves, bestOf()) }) + cardLines(), T.holdBtn);
    game.set('over', true);
    const dlg = document.querySelector('.mg-msg');
    const back = () => { dlg.removeEventListener('close', back); const u = new URL(location.href); u.searchParams.delete('start'); location.href = u.href; };
    dlg.addEventListener('close', back);
  }

  // ---- the title: the camera flies the district, the game waits paused, DEPLOY starts the chosen run
  run.lang = lang;
  const title = createTitle({ T, plan, world, values: run, choices: { mode: MODES, difficulty: DIFFS, hour: TITLE_HOURS, lang: LANG_ORDER }, names: { lang: LANG_NAMES }, best: bestOf, onDispose,
    optionsOpen: () => hud.optionsOpen, onOptions: toggleOptions,
    onChange: (k, v) => { if (k === 'lang') { switchLang(v); return; } if (k === 'difficulty') Object.assign(tune, TUNE[v]); if (k === 'hour') setHour(v); saveRun(); },
    onFrame: () => { play.turn(0, 0, 0); relight(); weapon.holder.visible = false; },
    // the pointer lock is asked for before the full screen: the full screen takes the click's user activation, and a
    // lock asked for after it in the same click was refused (the mouse did not look until a second click)
    onDeploy: (ev) => { begin(); g.ui.begin(ev); enterFull(); } });
  onDispose(onLang((l) => { run.lang = l; }));
  /** the run as chosen: the difficulty's health on everyone, the holdout's roof or the mission's spawn */
  function begin() {
    Object.assign(tune, TUNE[run.difficulty]); enemies.retune(); drones.retune();
    weapon.holder.visible = true;
    if (run.mode === 'holdout') startHoldout();
    else if (play.mode !== 'walk') play.place(plan.spawn.eye, plan.spawn.look, 'walk');
    applyLook();
    game.pause(false);
  }

  const goal = (gm) => {
    if (gm.flags.done) return null;
    if (gm.flags.uplink) return null;
    if (gm.flags.cp_roof) return con.pos;
    if (gm.flags.doorOpen) return [plan.relay.stair.rect[0] + 1.2, K.floor + 1.2, plan.relay.stair.foot + 0.6];
    if (gm.inventory.has('pass')) return doorAt;
    if (gm.flags.cp_street) return [plan.bar.door.x, K.kerb + 1.4, plan.bar.rect[3] + 0.3];
    return [plan.alley.rect[0] + 2, 1.4, plan.alley.rect[1]];
  };

  // ---- ?debug=look: what the view is doing, on screen, for a screenshot when it misbehaves: the pitch the game holds
  // and the one the camera shows, the last turn (its device and size), dropped pointer-lock jumps, the pad as the
  // browser reports it and what the game reads of it, the touch fingers down, the offsets on the camera
  function lookDebug() {
    const el = document.createElement('pre'), dir = new THREE.Vector3();
    el.style.cssText = 'position:fixed;left:8px;top:96px;z-index:60;margin:0;padding:6px 8px;font:11px/1.4 ui-monospace,monospace;color:#bff;background:#000b;pointer-events:none;white-space:pre';
    document.body.appendChild(el); onDispose(() => el.remove());
    const deg = (r) => (r * 180 / Math.PI).toFixed(1).padStart(6), f2 = (v) => (+v).toFixed(2);
    const tick = () => {
      if (!el.isConnected) return;
      requestAnimationFrame(tick);
      const t = play.lastTurn, p = input.pad, d = world.camera.getWorldDirection(dir), S = weapon.S;
      el.textContent = [
        `pitch ${deg(play.pitch)} deg   camera ${deg(Math.asin(Math.max(-1, Math.min(1, d.y))))} deg   yaw ${deg(play.yaw % (2 * Math.PI))} deg`,
        `last turn ${t.source || '-'}  dx ${deg(t.dx)}  dy ${deg(t.dy)} deg  ${t.at ? Math.round(performance.now() - t.at) + ' ms ago' : ''}   lock jumps dropped ${t.dropped}`,
        `sens ${f2(play.look.sens)}  invert ${play.look.invert}  pointer lock ${!!document.pointerLockElement}  paused ${game.paused}  input ${input.source}`,
        p ? `pad "${String(p.id).slice(0, 44)}" ${p.mapping || 'non-standard'}  axes ${[...p.axes].slice(0, 6).map(f2).join(' ')}  read L ${input.sticks.left.map(f2)} R ${input.sticks.right.map(f2)}` : 'pad none',
        `touch fingers ${touch?.busy || 0}   shake ${f2(S.shake)}  flinch ${f2(S.flinchP)}  recoil debt ${f2(S.debtP)}  comfort ${opts.comfort}`,
      ].join('\n');
    };
    tick();
  }

  // ---- the city as a weapon: hacks, abilities, ammunition that can be found, the story (kit.js)
  const kit = setupKit({ ctx, shared, vfx, Q, T, player, weapon, enemies, drones, hud, sfx, stats, opts, holdout: H, live });

  // ---- the props that break (destruct.js): the weapon puts its rounds through them; the end cards' bill and casualties
  const props = setupDestruct({ ctx, shared, vfx, sfx, player, weapon, enemies, drones, hud, stats, kit, T, holdout: H, tap: robotVfx, assist });
  weapon.props = props; onDispose(() => props.dispose());
  /** the end card's lines under the figures: property damage, civilian casualties, the remark on the bill */
  const cardLines = () => { const c = props.card(); return `\n\n${T.dx.props(c.bill)}\n${T.dx.civ(c.civilians, c.points)}\n${T.dx.remarks[c.remark]}`; };

  return {
    player, weapon, enemies, drones, stats, hud, sfx, leaves, opts, toggleOptions, run, tune, title, holdout: H, kit, props, cardLines: () => cardLines(), switchLang, fullscreen: fs, text: T, get lang() { return lang; }, get touch() { return touch; },
    comfort, applyOpts: applyLook,
    /** once startGame has made the character and play */
    start(game_) {
      g = game_; play = g.play;
      g.character.body.walk = 3.3; g.character.body.run = 5.4;      // a shooter's pace (the engine's walker strolls at 1.5 m/s)
      weapon.start(play); enemies.start(play.grid); drones.start(play.grid); applyLook();
      kit.start(g);
      if (Q.get('debug') === 'look') lookDebug();
      vfx.setGround(play.grid);
      checkpoint('start', true);
      hud.relang(); g.ui.setStrings?.({ ...T.engine });   // the corner of @miragekit/play (made by now); the engine's pause menu, panels and message button in the language
      const menu = document.querySelector('.mg-menu');
      if (menu) menuWatch.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
      if (Q.has('start')) {   // the tests: straight in (main.js starts the overlay); full screen on the first click or tap
        begin();
        // (the pointer lock first, in the same click: the full screen takes the click's activation, see onDeploy)
        const first = (e) => {
          removeEventListener('pointerdown', first, true);
          if (e.pointerType === 'mouse' && e.target === canvas && !touch && document.pointerLockElement !== canvas) { try { Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}); } catch { /* the next click locks */ } }
          enterFull();
        };
        addEventListener('pointerdown', first, true); onDispose(() => removeEventListener('pointerdown', first, true));
      }
      // a tool's still (mirage-snap, the determinism check: ?ui=0): the game waits paused and no title flies the camera
      // (the title's flight runs on the wall clock, so a still after it was never the same twice)
      else if (Q.get('ui') === '0') game.pause(true);
      else {
        if (!Q.get('time') && run.hour !== hour()) setHour(run.hour);
        game.pause(true); title.show(g);
      }
    },
  };
}

/** the overlay's objective line, from the flags and the inventory */
export function objective(gm) {
  const o = T.obj;
  if (gm.flags.holdout) return [gm.flags.wave ? `${o.holdout[0]} · ${T.waveN(gm.flags.wave)}` : o.holdout[0], o.holdout[1]];
  if (gm.flags.done) return o.done;
  if (gm.flags.uplink) return o.hold;
  if (gm.flags.cp_roof) return o.console;
  if (gm.flags.doorOpen) return o.relay;
  if (gm.inventory.has('pass')) return o.plaza;
  if (gm.flags.cp_street) return o.pass;
  return o.alley;
}
export const summary = (gm) => objective(gm)[0];

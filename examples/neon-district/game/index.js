// The game of neon-district, spawned from the plan and the modules' anchors:
//   the carbine (weapon.js) and the sentinels (enemies.js), health that comes back a little, ammunition and med
//   pickups, the relay pass on the bar's counter, the relay's locked door (two hinged leaves in its `doors` anchor),
//   the uplink console on the roof (its `consoles` anchor) and the wave that answers it, three checkpoints
//   (plan.checkpoints: the game saves there and a death loads the last one), the HUD (hud.js), the sounds (sfx.js),
//   steam on the `steam` anchors, sparks on `sparks`, motes round the hologram, rain rings round the player.
// Input beyond the engine's action map: fire (mouse button, F, right trigger, touch), aim (right button, left
// trigger, Q, touch toggle), reload (R, right bumper, touch), a strike with the stock (V, right stick click), lean (Z / X),
// crouch (C), the options panel (O).
import * as THREE from 'three';
import { FX } from './fx.js';
import { createSfx } from './sfx.js';
import { createHud } from './hud.js';
import { createWeapon } from './weapon.js';
import { createEnemies } from './enemies.js';
import { createDrones } from './drones.js';
import { LANGS, pickLang } from './text.js';
import { createAudioEngine, zonesFromPlan } from '@miragekit/game';

export const VERSION = 1;
const UPLINK_S = 40;
export const lang = pickLang(new URLSearchParams(globalThis.location?.search || '')), T = LANGS[lang];

export function setupGame(ctx, { shared, vfx, Q, quality }) {
  const { game, physics, audio, root, plan, anchors, world, onDispose, input } = ctx;
  const M = shared.mats, { mat } = world, K = plan.levels;
  const sfx = createSfx(audio), assist = Q.get('assist') === '1';
  const stats = { shots: 0, hits: 0, heads: 0, kills: 0, deaths: 0 };
  const hud = createHud({ camera: world.camera, onDispose, T });
  let g = null, play = null, shake = 0, seed = 0x51ed270b, uplinkT = 0, sparkT = 2, lastFeet = null;
  const R = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) ^ (seed << 7)) >>> 0) / 4294967296);
  const player = {
    hp: 100, dead: false, speed: 0, exposed: 0, height: 1.62, crouch: 0, wantCrouch: false, feet: [plan.spawn.eye[0], plan.spawn.eye[1] - 1.62, plan.spawn.eye[2]], lastHurt: -99,
    collider: () => (g ? g.character.collider : undefined),
    shake(k) { shake = Math.min(1.5, shake + k); },
    hurt(amount, from) {
      if (player.dead || game.flags.done) return;
      player.hp -= amount; player.lastHurt = game.time; hud.hurt(from); sfx.play('nd_hurt', { gain: 0.7 }); player.shake(0.8);
      if (player.hp <= 0) die();
    },
  };
  const enemies = createEnemies({ world, game, physics, plan, vfx, sfx, player, assist, onDispose });
  const drones = createDrones({ world, game, physics, plan, vfx, sfx, player, assist, onDispose });
  // what a round can hit: the nearer of a sentinel and a kite; a hit knows whose it is (hit.owner.damage)
  const targets = { rayHit(o, d, max) { const a = enemies.rayHit(o, d, max), b = drones.rayHit(o, d, max); return a && b ? (a.t < b.t ? a : b) : a || b; }, noise: (p, r) => enemies.noise(p, r) };
  const wake = (zone) => { enemies.wake(zone, player.feet); drones.wake(zone); };
  // the player's own settings (kept with the key bindings and volumes, not in a save)
  const opts = { sens: 1, fov: 62, invert: false, ...(game.settings.nd || {}) };
  if (Q.get('fov')) opts.fov = Math.min(90, Math.max(50, +Q.get('fov')));
  if (Q.get('sens')) opts.sens = +Q.get('sens');
  const weapon = createWeapon({ world, root, vfx, sfx, physics, M, player, targets, hud, stats, onReload: () => game.set('reloads', (game.flags.reloads || 0) + 1) });
  onDispose(() => weapon.dispose());
  weapon.S.fov = opts.fov;
  game.on('kill', (e) => { stats.kills++; game.set('kills', stats.kills); hud.feed(`${T.kinds[e.K.name]} ${T.destroyed}${stats.lastHead && e.K.name !== 'drone' ? ' · ' + T.weak : ''}`, stats.lastHead && e.K.name !== 'drone'); });

  // ---- input: held flags from the mouse, the keys, the pad and the touch buttons
  const held = { mouse: false, key: false, pad: false, touch: false, aimMouse: false, aimKey: false, aimPad: false, aimTouch: false, leanL: false, leanR: false };
  const live = () => g && g.ui.started && !game.paused && !player.dead;
  const canvas = world.renderer.domElement;
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); onDispose(() => t.removeEventListener(ev, fn, o)); };
  listen(document, 'mousedown', (e) => { if (document.pointerLockElement !== canvas) return; if (e.button === 0) held.mouse = true; if (e.button === 2) held.aimMouse = true; });
  listen(document, 'mouseup', (e) => { if (e.button === 0) held.mouse = false; if (e.button === 2) held.aimMouse = false; });
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(window, 'keydown', (e) => { if (e.repeat || !live()) return; if (e.code === 'KeyF') held.key = true; if (e.code === 'KeyQ') held.aimKey = true; if (e.code === 'KeyR') weapon.S.wantReload = true;
    if (e.code === 'KeyV') weapon.melee(); if (e.code === 'KeyZ') held.leanL = true; if (e.code === 'KeyX') held.leanR = true; if (e.code === 'KeyC' || e.code === 'ControlLeft') player.wantCrouch = !player.wantCrouch; });
  listen(window, 'keydown', (e) => { if (e.code === 'KeyO' && !e.repeat && g && g.ui.started && !player.dead && (hud.optionsOpen || !game.paused)) toggleOptions(); });
  listen(window, 'keyup', (e) => { if (e.code === 'KeyF') held.key = false; if (e.code === 'KeyQ') held.aimKey = false; if (e.code === 'KeyZ') held.leanL = false; if (e.code === 'KeyX') held.leanR = false; });
  listen(window, 'blur', () => { for (const k of Object.keys(held)) held[k] = false; });
  let padReload = false, padMelee = false;
  // the options panel pauses the game; its values apply at once and are kept in the settings
  function toggleOptions() {
    const open = hud.options({ values: { ...opts, lang },
      onChange: (k, v) => { opts[k] = v; if (k === 'fov') weapon.S.fov = v; game.settings.nd = { ...opts }; game.saveSettings(); },
      onClose: () => game.pause(false),
      onLang: () => { const u = new URL(location.href); u.searchParams.set('lang', lang === 'zh' ? 'en' : 'zh'); location.href = u.href; } });
    if (open) { game.pause(true); if (document.pointerLockElement) document.exitPointerLock(); }
  }

  // ---- the relay pass, on the bar's counter
  const pass = new THREE.Group();
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.1), mat.std({ color: new THREE.Color(0.02, 0.03, 0.04), roughness: 0.3, metalness: 0.8 }));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.05), M.neon.cyan); chip.position.y = 0.009;
  pass.add(card, chip); pass.position.set(...plan.bar.pass); root.add(pass);
  let passT = 0;
  game.on('place', () => { passT = 0; });
  game.add({ id: 'pass', object: pass,
    interact: { label: T.passLabel, reach: 2.6, use: (gm, e) => {
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
    interact: { reach: 2.8, can: (gm) => !gm.flags.uplink, label: T.uplinkLabel,
      use: (gm) => {
        gm.set('uplink', true); uplinkT = 0; sfx.play('nd_alarm', { gain: 0.6 });
        wake('wave'); game.ui.toast(T.uplinkToast); hud.radio(T.radio.hold);
      } },
    save: () => ({ t: +uplinkT.toFixed(1) }), load: (s) => { uplinkT = s.t || 0; } });

  // ---- pickups: walk over one to take it (when it is of use)
  const crateMat = mat.std({ color: new THREE.Color(0.1, 0.11, 0.09), roughness: 0.5, metalness: 0.6 }), white = mat.std({ color: new THREE.Color(0.6, 0.62, 0.64), roughness: 0.4 });
  for (const p of plan.pickups) {
    const o = new THREE.Group(), ammo = p.kind === 'ammo';
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), ammo ? crateMat : white); box.castShadow = true;
    const tag = new THREE.Mesh(ammo ? new THREE.BoxGeometry(0.345, 0.04, 0.225) : new THREE.BoxGeometry(0.12, 0.205, 0.04), ammo ? M.neon.amber : M.neon.green);
    o.add(box, tag); if (!ammo) { const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.205, 0.12), M.neon.green); o.add(t2); }
    o.position.set(p.at[0], p.at[1] + 0.32, p.at[2]); root.add(o);
    let t = R() * 6;
    game.add({ id: p.id, object: o, update: (dt, gm) => {
      t += dt; o.rotation.y = t * 1.1; o.position.y = p.at[1] + 0.34 + Math.sin(t * 2) * 0.04;
      if (player.dead || Math.hypot(player.feet[0] - p.at[0], player.feet[2] - p.at[2]) > 0.95 || Math.abs(player.feet[1] - p.at[1]) > 1.2) return;
      if (ammo) { if (!weapon.give(48)) return; sfx.play('nd_ammo', { gain: 0.8 }); game.ui.toast(T.ammo); }
      else { if (player.hp >= 100) return; player.hp = Math.min(100, player.hp + 45); sfx.play('nd_med', { gain: 0.8 }); game.ui.toast(T.med); }
      vfx.burst(FX.take, [p.at[0], p.at[1] + 0.3, p.at[2]]); gm.remove(p.id);
    } });
  }

  // ---- checkpoints: cross the box, the game saves; a death loads it
  const checkpoint = (id, quiet) => { game.set('cp_' + id, true); try { g.save('auto'); if (!quiet) game.ui.toast(T.checkpoint); if (id === 'roof') hud.radio(T.radio.roof); } catch { /* storage full or blocked: play on without it */ } };
  for (const c of plan.checkpoints) game.zone({ id: 'cp-' + c.id, box: c.box, once: true, enter: () => checkpoint(c.id) });
  game.add({ id: 'player',
    save: () => ({ hp: Math.round(player.hp), gun: weapon.save(), stats: { ...stats } }),
    load: (s) => { player.hp = Math.max(s.hp, 60); player.dead = false; player.lastHurt = -99; player.wantCrouch = false; weapon.load(s.gun); Object.assign(stats, s.stats, { deaths: stats.deaths }); stats.kills = game.flags.kills || 0; for (const k of Object.keys(held)) held[k] = false; } });
  function die() {
    player.dead = true; stats.deaths++; sfx.play('nd_death', { gain: 0.6 });
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
  (anchors.steam || []).forEach((a, i) => emit(FX.steam(tints[i % tints.length]), { position: a.pos }));
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
  const sky = new THREE.PointLight(0xcfe0ff, 0, 600, 2); root.add(sky); world.lighting?.addLight(sky);
  const skyGain = 26000 * world.G.uLampGain.value, said = { spotted: false, hurtT: -99 };
  let boltT = 9, thunderT = 0, endYaw = 0, endPitch = 0, reverb = null;
  try { reverb = createAudioEngine({ audio, voices: 24, zones: zonesFromPlan(plan), zoneOptions: { ambient: { reverb: 'outdoor', wet: 0.16 } } }); onDispose(() => reverb.dispose()); } catch { reverb = null; }
  game.on('start', () => hud.radio(T.radio.start));

  // ---- one fixed step
  game.system((dt) => {
    sfx.poll();
    if (!g) return;
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
    if (pb(11) && !padMelee && live()) weapon.melee();
    padMelee = pb(11);
    if (g.ui.touch) hud.touch(true, { fire: (on) => { held.touch = on; }, aim: () => (held.aimTouch = !held.aimTouch), reload: () => { weapon.S.wantReload = true; }, options: toggleOptions });
    const ok = live();
    weapon.S.fire = ok && (held.mouse || held.key || held.pad || held.touch);
    weapon.S.aim = ok && (held.aimMouse || held.aimKey || held.aimPad || held.aimTouch);
    if (assist && weapon.S.reserve < 48) weapon.S.reserve = 48;   // the easy mode never runs dry
    // the look: the player's sensitivity and the inverted axis, applied to what the mouse and the stick turned since
    // the last tick (play turns the view itself, at a fixed rate)
    if (opts.sens !== 1 || opts.invert) { play.yaw = endYaw + (play.yaw - endYaw) * opts.sens; play.pitch = Math.max(-1.45, Math.min(1.45, endPitch + (play.pitch - endPitch) * opts.sens * (opts.invert ? -1 : 1))); }
    // crouching: a lower eye and a slower walk (the body's collider keeps its height: no crawling under things)
    player.crouch += ((ok && player.wantCrouch ? 1 : 0) - player.crouch) * Math.min(1, dt * 10); player.height = 1.62 - 0.6 * player.crouch;
    g.character.body.walk = player.crouch > 0.5 ? 1.7 : 3.3; g.character.body.run = player.crouch > 0.5 ? 1.7 : 5.4;
    weapon.S.wantLean = ok ? (held.leanR ? 1 : 0) - (held.leanL ? 1 : 0) : 0;
    weapon.update(dt, ok);
    enemies.update(dt); drones.update(dt);
    reverb?.update(dt, world.camera);
    if (!said.spotted && enemies.list.some((e) => e.state === 'fight')) { said.spotted = true; hud.radio(T.radio.spotted); }
    if (player.hp < 35 && !player.dead && game.time - said.hurtT > 40) { said.hurtT = game.time; hud.radio(T.radio.hurt); }
    // weather: now and then a bolt beyond the roofs, a moment of white light over the block, thunder a second later
    if ((boltT -= dt) <= 0) {
      boltT = 16 + R() * 22;
      const a = R() * 6.28, r = 150 + R() * 80, bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      vfx.beam({ from: [bx + (R() - 0.5) * 30, 150, bz + (R() - 0.5) * 30], to: [bx, 38 + R() * 20, bz], width: 1.6, color: '#cfe0ff', intensity: 7, jitter: 16, branches: 3, life: 0.4 });
      sky.position.set(bx * 0.4, 110, bz * 0.4); sky.userData.t = 0.38; thunderT = 0.7 + r / 340;
    }
    sky.userData.t = (sky.userData.t || 0) - dt; sky.intensity = sky.userData.t > 0 ? skyGain * (0.35 + 0.65 * R()) * Math.min(1, sky.userData.t * 6) : 0;
    if (thunderT > 0 && (thunderT -= dt) <= 0) sfx.play('nd_thunder', { bus: 'ambience', gain: 0.9 });
    // health: a little of it comes back out of a fight
    if (!player.dead && assist) player.hp = Math.min(100, player.hp + dt * 6);
    else if (!player.dead && player.hp < 50 && game.time - player.lastHurt > 5) player.hp = Math.min(50, player.hp + dt * 9);
    if (shake > 0.01) { play.yaw += (R() - 0.5) * shake * 0.006; play.pitch += (R() - 0.5) * shake * 0.006; shake *= Math.exp(-dt * 9); }
    // the uplink: it runs for UPLINK_S seconds, and ends when the wave is down too
    if (game.flags.uplink && !game.flags.done) {
      uplinkT = Math.min(UPLINK_S, uplinkT + dt);
      const left = enemies.byZone.wave.filter((e) => !e.dead).length + (drones.byZone.wave || []).filter((e) => !e.dead).length;
      if (uplinkT >= UPLINK_S && left === 0) {
        game.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.9 });
        const acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0, points = (stats.deaths === 0 ? 1 : 0) + (acc >= 35 ? 1 : 0) + (game.time < 420 ? 1 : 0);
        game.ui.message(T.doneTitle, T.doneBody({ rating: T.ratings[points], min: Math.floor(game.time / 60), sec: Math.round(game.time % 60), kills: stats.kills, acc, shots: stats.shots, heads: stats.heads, deaths: stats.deaths }), T.doneBtn);
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
    sparkLight.userData.t = (sparkLight.userData.t || 0) - dt; sparkLight.intensity = sparkLight.userData.t > 0 ? 40 * world.G.uLampGain.value * R() : 0;
    for (const s of strobes) s.light.intensity = s.light.userData.base * (s.flicker ? (R() < 0.04 ? 0.25 : 1) : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(game.time * (game.flags.uplink ? 9 : 3.2)), 2));
    for (const [i, l] of lanterns.entries()) l.light.intensity = l.light.userData.base * (0.93 + 0.07 * Math.sin(game.time * (5 + i) + i));
    const indoors = (p[1] < 4 && ((p[0] > plan.bar.rect[0] && p[0] < plan.bar.rect[2] && p[2] > plan.bar.rect[1] && p[2] < plan.bar.rect[3]) || (p[0] > plan.relay.rect[0] && p[2] < plan.relay.rect[3])));
    feet.position.set(p[0], Math.round(p[1] * 50) / 50 + 0.03, p[2]);
    if (rewound > 0 && --rewound === 0) for (const l of loops) { l.h.stop(); l.h = vfx.spawn(l.fx, l.o); }
    if (splash) splash.h.move({ position: feet.position, rate: indoors ? 0 : 1 });   // rate: a factor on the effect's own
    endYaw = play.yaw; endPitch = play.pitch;
    // the HUD
    const S = weapon.S;
    hud.update(dt, { hp: player.hp, dead: player.dead, mag: S.mag, reserve: S.reserve, reloading: S.reloading > 0, ads: S.ads, pos: p, yaw: play.yaw,
      spread: (0.008 - 0.0055 * S.ads) + S.heat * 0.012 + Math.min(player.speed, 5) * 0.002, tally: `${stats.kills} ${T.down}${assist ? ' · ' + T.assist : ''}`,
      uplink: game.flags.uplink && !game.flags.done ? uplinkT / UPLINK_S : null, uplinkText: uplinkT >= UPLINK_S ? T.uplinkReady : `${T.uplink} ${Math.round(100 * uplinkT / UPLINK_S)} %`, goal: goal(game) });
  });

  const goal = (gm) => {
    if (gm.flags.done) return null;
    if (gm.flags.uplink) return null;
    if (gm.flags.cp_roof) return con.pos;
    if (gm.flags.doorOpen) return [plan.relay.stair.rect[0] + 1.2, K.floor + 1.2, plan.relay.stair.foot + 0.6];
    if (gm.inventory.has('pass')) return doorAt;
    if (gm.flags.cp_street) return [plan.bar.door.x, K.kerb + 1.4, plan.bar.rect[3] + 0.3];
    return [plan.alley.rect[0] + 2, 1.4, plan.alley.rect[1]];
  };

  return {
    player, weapon, enemies, drones, stats, hud, sfx, leaves, opts, toggleOptions,
    /** once startGame has made the character and play */
    start(game_) {
      g = game_; play = g.play;
      g.character.body.walk = 3.3; g.character.body.run = 5.4;      // a shooter's pace (the engine's walker strolls at 1.5 m/s)
      weapon.start(play); enemies.start(play.grid); drones.start(play.grid); endYaw = play.yaw; endPitch = play.pitch;
      vfx.setGround(play.grid);
      checkpoint('start', true);
    },
  };
}

/** the overlay's objective line, from the flags and the inventory */
export function objective(gm) {
  const o = T.obj;
  if (gm.flags.done) return o.done;
  if (gm.flags.uplink) return o.hold;
  if (gm.flags.cp_roof) return o.console;
  if (gm.flags.doorOpen) return o.relay;
  if (gm.inventory.has('pass')) return o.plaza;
  if (gm.flags.cp_street) return o.pass;
  return o.alley;
}
export const summary = (gm) => objective(gm)[0];

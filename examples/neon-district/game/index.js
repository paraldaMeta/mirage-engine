// The game of neon-district, spawned from the plan and the modules' anchors:
//   the carbine (weapon.js) and the sentinels (enemies.js), health that comes back a little, ammunition and med
//   pickups, the relay pass on the bar's counter, the relay's locked door (two hinged leaves in its `doors` anchor),
//   the uplink console on the roof (its `consoles` anchor) and the wave that answers it, three checkpoints
//   (plan.checkpoints: the game saves there and a death loads the last one), the HUD (hud.js), the sounds (sfx.js),
//   steam on the `steam` anchors, sparks on `sparks`, motes round the hologram, rain rings round the player.
// Input beyond the engine's action map: fire (mouse button, F, right trigger, touch), aim (right button, left
// trigger, Q, touch toggle), reload (R, right bumper, touch).
import * as THREE from 'three';
import { FX } from './fx.js';
import { createSfx } from './sfx.js';
import { createHud } from './hud.js';
import { createWeapon } from './weapon.js';
import { createEnemies } from './enemies.js';

export const VERSION = 1;
const UPLINK_S = 40;

export function setupGame(ctx, { shared, vfx, Q, quality }) {
  const { game, physics, audio, root, plan, anchors, world, onDispose, input } = ctx;
  const M = shared.mats, { mat } = world, K = plan.levels;
  const sfx = createSfx(audio), assist = Q.get('assist') === '1';
  const stats = { shots: 0, hits: 0, heads: 0, kills: 0, deaths: 0 };
  const hud = createHud({ camera: world.camera, onDispose });
  let g = null, play = null, shake = 0, seed = 0x51ed270b, uplinkT = 0, sparkT = 2, lastFeet = null;
  const R = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) ^ (seed << 7)) >>> 0) / 4294967296);
  const player = {
    hp: 100, dead: false, speed: 0, exposed: 0, feet: [plan.spawn.eye[0], plan.spawn.eye[1] - 1.62, plan.spawn.eye[2]], lastHurt: -99,
    collider: () => (g ? g.character.collider : undefined),
    shake(k) { shake = Math.min(1.5, shake + k); },
    hurt(amount, from) {
      if (player.dead || game.flags.done) return;
      player.hp -= amount; player.lastHurt = game.time; hud.hurt(from); sfx.play('nd_hurt', { gain: 0.7 }); player.shake(0.8);
      if (player.hp <= 0) die();
    },
  };
  const enemies = createEnemies({ world, game, physics, plan, vfx, sfx, player, assist, onDispose });
  const weapon = createWeapon({ world, root, vfx, sfx, physics, M, player, enemies, hud, stats, onReload: () => game.set('reloads', (game.flags.reloads || 0) + 1) });
  onDispose(() => weapon.dispose());
  game.on('kill', () => { stats.kills++; game.set('kills', stats.kills); });

  // ---- input: held flags from the mouse, the keys, the pad and the touch buttons
  const held = { mouse: false, key: false, pad: false, touch: false, aimMouse: false, aimKey: false, aimPad: false, aimTouch: false };
  const live = () => g && g.ui.started && !game.paused && !player.dead;
  const canvas = world.renderer.domElement;
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); onDispose(() => t.removeEventListener(ev, fn, o)); };
  listen(document, 'mousedown', (e) => { if (document.pointerLockElement !== canvas) return; if (e.button === 0) held.mouse = true; if (e.button === 2) held.aimMouse = true; });
  listen(document, 'mouseup', (e) => { if (e.button === 0) held.mouse = false; if (e.button === 2) held.aimMouse = false; });
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(window, 'keydown', (e) => { if (e.repeat || !live()) return; if (e.code === 'KeyF') held.key = true; if (e.code === 'KeyQ') held.aimKey = true; if (e.code === 'KeyR') weapon.S.wantReload = true; });
  listen(window, 'keyup', (e) => { if (e.code === 'KeyF') held.key = false; if (e.code === 'KeyQ') held.aimKey = false; });
  listen(window, 'blur', () => { for (const k of Object.keys(held)) held[k] = false; });
  let padReload = false;

  // ---- the relay pass, on the bar's counter
  const pass = new THREE.Group();
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.1), mat.std({ color: new THREE.Color(0.02, 0.03, 0.04), roughness: 0.3, metalness: 0.8 }));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.05), M.neon.cyan); chip.position.y = 0.009;
  pass.add(card, chip); pass.position.set(...plan.bar.pass); root.add(pass);
  let passT = 0;
  game.on('place', () => { passT = 0; });
  game.add({ id: 'pass', object: pass,
    interact: { label: 'Take the relay pass', reach: 2.6, use: (gm, e) => {
      gm.inventory.add({ id: 'pass', name: 'Relay pass', text: 'opens the relay on the plaza' });
      audio.play('pickup', { at: plan.bar.pass }); vfx.burst(FX.take, plan.bar.pass); gm.remove(e); game.ui.toast('Relay pass taken. The relay is across the plaza.');
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
      label: (gm) => (gm.inventory.has('pass') ? 'Open the relay' : 'Locked: needs a relay pass'),
      use: (gm) => {
        if (!gm.inventory.has('pass')) { audio.play('locked', { at: doorAt }); game.ui.toast('Locked. The pass is in the noodle bar on the street.'); return; }
        for (const l of leaves) { l.hinge.open(); l.strip.material = M.neon.green; }
        audio.play('door', { at: doorAt }); sfx.play('nd_alarm', { at: doorAt, gain: 0.7, ref: 6 }); gm.set('doorOpen', true);
        enemies.wake('relay', player.feet);
      } },
    save: () => ({ open: !!game.flags.doorOpen }), load: (s) => showDoor(s.open) });

  // ---- the uplink console on the roof
  const con = anchors.consoles[0];
  game.add({ id: 'uplink', pos: con.pos,
    interact: { reach: 2.8, can: (gm) => !gm.flags.uplink, label: 'Start the uplink',
      use: (gm) => {
        gm.set('uplink', true); uplinkT = 0; sfx.play('nd_alarm', { gain: 0.6 });
        enemies.wake('wave', player.feet); game.ui.toast('Uplink running. They are coming up the stairs.');
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
      if (ammo) { if (!weapon.give(48)) return; sfx.play('nd_ammo', { gain: 0.8 }); game.ui.toast('Ammunition'); }
      else { if (player.hp >= 100) return; player.hp = Math.min(100, player.hp + 45); sfx.play('nd_med', { gain: 0.8 }); game.ui.toast('Vitals restored'); }
      vfx.burst(FX.take, [p.at[0], p.at[1] + 0.3, p.at[2]]); gm.remove(p.id);
    } });
  }

  // ---- checkpoints: cross the box, the game saves; a death loads it
  const checkpoint = (id, quiet) => { game.set('cp_' + id, true); try { g.save('auto'); if (!quiet) game.ui.toast('Checkpoint'); } catch { /* storage full or blocked: play on without it */ } };
  for (const c of plan.checkpoints) game.zone({ id: 'cp-' + c.id, box: c.box, once: true, enter: () => checkpoint(c.id) });
  game.add({ id: 'player',
    save: () => ({ hp: Math.round(player.hp), gun: weapon.save(), stats: { ...stats } }),
    load: (s) => { player.hp = Math.max(s.hp, 60); player.dead = false; player.lastHurt = -99; weapon.load(s.gun); Object.assign(stats, s.stats, { deaths: stats.deaths }); stats.kills = game.flags.kills || 0; for (const k of Object.keys(held)) held[k] = false; } });
  function die() {
    player.dead = true; stats.deaths++; sfx.play('nd_death', { gain: 0.6 });
    game.ui.message('Down', 'The sentinels hold the district. You wake at the last checkpoint.', 'Try again');
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
    if (g.ui.touch) hud.touch(true, { fire: (on) => { held.touch = on; }, aim: () => (held.aimTouch = !held.aimTouch), reload: () => { weapon.S.wantReload = true; } });
    const ok = live();
    weapon.S.fire = ok && (held.mouse || held.key || held.pad || held.touch);
    weapon.S.aim = ok && (held.aimMouse || held.aimKey || held.aimPad || held.aimTouch);
    if (assist && weapon.S.reserve < 48) weapon.S.reserve = 48;   // the easy mode never runs dry
    weapon.update(dt, ok);
    enemies.update(dt);
    // health: a little of it comes back out of a fight
    if (!player.dead && assist) player.hp = Math.min(100, player.hp + dt * 6);
    else if (!player.dead && player.hp < 50 && game.time - player.lastHurt > 5) player.hp = Math.min(50, player.hp + dt * 9);
    if (shake > 0.01) { play.yaw += (R() - 0.5) * shake * 0.006; play.pitch += (R() - 0.5) * shake * 0.006; shake *= Math.exp(-dt * 9); }
    // the uplink: it runs for UPLINK_S seconds, and ends when the wave is down too
    if (game.flags.uplink && !game.flags.done) {
      uplinkT = Math.min(UPLINK_S, uplinkT + dt);
      const left = enemies.byZone.wave.filter((e) => !e.dead).length;
      if (uplinkT >= UPLINK_S && left === 0) {
        game.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.9 });
        const acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0;
        game.ui.message('Uplink complete', `The district's feed is yours. ${Math.floor(game.time / 60)} min ${Math.round(game.time % 60)} s · ${stats.kills} sentinels down · ${acc} % of ${stats.shots} rounds on target · ${stats.deaths} deaths.`, 'Stay a while');
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
    // the HUD
    const S = weapon.S;
    hud.update(dt, { hp: player.hp, dead: player.dead, mag: S.mag, reserve: S.reserve, reloading: S.reloading > 0, ads: S.ads, pos: p, yaw: play.yaw,
      spread: (0.008 - 0.0055 * S.ads) + S.heat * 0.012 + Math.min(player.speed, 5) * 0.002, tally: `${stats.kills} DOWN${assist ? ' · ASSIST' : ''}`,
      uplink: game.flags.uplink && !game.flags.done ? uplinkT / UPLINK_S : null, uplinkText: uplinkT >= UPLINK_S ? 'UPLINK READY · CLEAR THE ROOF' : `UPLINK ${Math.round(100 * uplinkT / UPLINK_S)} %`, goal: goal(game) });
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
    player, weapon, enemies, stats, hud, sfx, leaves,
    /** once startGame has made the character and play */
    start(game_) {
      g = game_; play = g.play;
      g.character.body.walk = 3.3; g.character.body.run = 5.4;      // a shooter's pace (the engine's walker strolls at 1.5 m/s)
      weapon.start(play); enemies.start(play.grid);
      vfx.setGround(play.grid);
      checkpoint('start', true);
    },
  };
}

/** the overlay's objective line, from the flags and the inventory */
export function objective(gm) {
  if (gm.flags.done) return ['Uplink complete', 'The district is yours. Walk it as long as you like.'];
  if (gm.flags.uplink) return ['Hold the roof', 'The uplink needs forty seconds. Sentinels are coming up the stairs.'];
  if (gm.flags.cp_roof) return ['The uplink', 'Start the console by the mast.'];
  if (gm.flags.doorOpen) return ['The relay', 'Clear the server room and take the stairs to the roof.'];
  if (gm.inventory.has('pass')) return ['The relay', 'Cross the plaza. The relay door is on its north side.'];
  if (gm.flags.cp_street) return ['The relay pass', 'It was left on the counter of the noodle bar, across the street.'];
  return ['Kestrel Street', 'Get out of the alley.'];
}
export const summary = (gm) => objective(gm)[0];

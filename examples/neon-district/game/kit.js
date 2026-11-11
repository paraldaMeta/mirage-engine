// The city as a weapon, wired into the game: the hack (hack.js), the abilities (abilities.js), ammunition that can
// always be found (ammo.js), the story and the robots' voice (story.js), their HUD (overlay.js), the lamp pool as
// the hacks change it (lamps.js), their sounds (sfx-city.js). index.js calls setupKit once in setup and kit.start(g)
// once startGame has made the character; everything else happens in the system this file registers.
//
// Keys:    G (hold) hack · Alt dash · H EMP grenade · B overdrive · mouse back / forward buttons: dash / grenade
//          (1-5 are the guns' slots now: weapon.js)
// Gamepad: B (hold) hack · d-pad left dash · d-pad right grenade · d-pad up overdrive
// Touch (touch.js): HACK (hold), DASH, GRENADE, OVERDRIVE through kit.hack.start() / cancel() / target() / charges /
//   max / progress and kit.abilities.use(name) / left(name) / cooldown(name) / charge / active.
import { createLamps } from './lamps.js';
import { createOverlay } from './overlay.js';
import { createHack } from './hack.js';
import { createAbilities } from './abilities.js';
import { createAmmo } from './ammo.js';
import { createStory } from './story.js';
import { addCitySounds } from './sfx-city.js';

export function setupKit({ ctx, shared, vfx, Q, T, player, weapon, enemies, drones, hud, sfx, stats, opts, holdout, live }) {
  const { game, physics, audio, root, plan, anchors, world, onDispose } = ctx;
  const X = T.xt;
  const lamps = createLamps({ world, shared });
  const overlay = createOverlay({ camera: world.camera, onDispose, T, hudRoot: hud.root });
  let story = null;
  const onPop = (kind, pos) => story?.pop(kind, pos);
  const hack = createHack({ world, game, plan, anchors, shared, lamps, enemies, drones, player, vfx, sfx, physics, root, T, overlay, onPop });
  const abilities = createAbilities({ world, game, player, enemies, drones, vfx, sfx, physics, root, weapon, hack, overlay, onPop, opts });
  const ammo = createAmmo({ world, game, plan, weapon, player, vfx, sfx, lamps, root, stats, hud, T, overlay });
  story = createStory({ game, enemies, hud, overlay, sfx, player, T, hack, opts, holdout });
  // one thing in the middle of the screen at a time: the radio waits while a story card is up (the cold open)
  hud.holdRadio(() => overlay.cardOn); overlay.busy(() => hud.radioOn);   // and a prompt waits for the card and the radio
  drones.allies = enemies;
  game.add({ id: 'abilities', save: () => ({}), load: () => abilities.reset() });

  // a dash's moment of grace covers every hurt, not only the sentinels' rounds
  const hurt = player.hurt;
  player.hurt = (amount, from) => { if (player.iframe > game.time) return; hurt(amount, from); };
  // what charges the overdrive: damage dealt by the player (600 points), kills, hacks
  const dealt = (amount, e, hit) => { if (hit?.friendly) game.set('kiteHits', (game.flags.kiteHits || 0) + 1); else abilities.gain(amount / 600); };
  enemies.on.dealt = dealt; drones.on.dealt = dealt;
  game.on('kill', () => abilities.gain(0.06));
  const said = { teach: false, dark: false, over: false };
  hack.onHack = (t) => { abilities.gain(0.12); if (t.kind === 'lights' && !said.dark) { said.dark = true; hud.radio(X.radio.dark); } };

  // ---- input: keys, mouse side buttons, the pad (edges in the system)
  const listen = (t, ev, fn) => { t.addEventListener(ev, fn); onDispose(() => t.removeEventListener(ev, fn)); };
  listen(window, 'keydown', (e) => {
    if (e.repeat || !live()) return;
    if (e.code === 'KeyG') hack.start();
    else if (e.code === 'AltLeft' || e.code === 'AltRight') { e.preventDefault(); abilities.use('dash'); }
    else if (e.code === 'KeyH') abilities.use('grenade');
    else if (e.code === 'KeyB') abilities.use('overdrive');
  });
  listen(window, 'keyup', (e) => { if (e.code === 'KeyG') hack.cancel(); });
  listen(window, 'blur', () => hack.cancel());
  listen(document, 'mousedown', (e) => { if (!live() || document.pointerLockElement !== world.renderer.domElement) return; if (e.button === 3) abilities.use('dash'); if (e.button === 4) abilities.use('grenade'); });
  const padWas = {};
  const padEdge = (pad, i) => { const on = !!(pad && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4)), was = padWas[i]; padWas[i] = on; return [on, on && !was, !on && was]; };

  let g = null, made = false;
  const setF = (k, v) => { if (game.flags[k] !== v) game.set(k, v); };
  game.system((dt) => {
    if (!made && audio.ctx && audio.buffers) { addCitySounds(audio); made = true; }
    if (!g) return;
    const ok = live();
    const pad = ctx.input.pad;
    const [, hDown, hUp] = padEdge(pad, 1);
    if (hDown && ok) hack.start(); if (hUp) hack.cancel();
    if (padEdge(pad, 14)[1] && ok) abilities.use('dash');
    if (padEdge(pad, 15)[1] && ok) abilities.use('grenade');
    if (padEdge(pad, 12)[1] && ok) abilities.use('overdrive');
    if (!ok && hack.held && player.dead) hack.cancel();
    hack.update(dt, ok);
    abilities.update(dt);
    ammo.update(dt);
    story.update(dt);
    lamps.flush();
    // the visor: robots' rims raised in the dark, while scanning or in overdrive; who is marked through walls
    const inDark = hack.dark(player.feet) > 0, over = abilities.active, scan = hack.scanning;
    enemies.env.rim = Math.max(enemies.env.rim * Math.exp(-dt * 4), inDark || over ? 1 : scan ? 0.6 : 0);
    const marks = [];
    for (const e of enemies.list) {
      if (e.dead || !e.active || !e.rig.root.visible) continue;
      const d = Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]);
      if (over || (scan && d < 30) || (hack.dark(e.pos) && d < 30)) marks.push({ pos: [e.pos[0], e.pos[1] + 2.1 * e.K.scale, e.pos[2]], kind: e.K.name });
    }
    for (const e of drones.list) if (!e.dead && e.o.visible && !(e.turned > 0) && (over || (scan && Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) < 30))) marks.push({ pos: [e.pos[0], e.pos[1] + 0.4, e.pos[2]], kind: e.kind === 'mender' ? 'mender' : 'kite' });
    overlay.marks(marks);
    setF('marked', marks.length); setF('darkNow', hack.darkZones); setF('turnedNow', drones.list.filter((e) => e.turned > 0).length);
    // teach it once, at the first fight of the mission; tell the player once when the overdrive is full
    if (!said.teach && !holdout.on && enemies.list.some((e) => e.state === 'fight')) { said.teach = true; hud.radio(X.radio.teach); overlay.prompt(X.teach, 9); game.set('taught', true); }
    if (!said.over && abilities.charge >= 1) { said.over = true; hud.radio(X.radio.over); overlay.prompt(X.overHint, 5); }
    // the HUD
    hack.draw();
    overlay.bar({ charges: hack.charges, frac: hack.chargeFrac, free: hack.free, dash: { left: abilities.left('dash'), cd: abilities.cooldown('dash') }, grenade: { left: abilities.left('grenade'), cd: abilities.cooldown('grenade') },
      over: { charge: abilities.charge, active: abilities.active, left: abilities.overLeft, len: abilities.overLen } });
    ammo.draw(g.play.yaw);
    overlay.update(dt);
  });

  return {
    hack, abilities, ammo, story, overlay, lamps,
    /** once startGame has made the character and play */
    start(g_) {
      g = g_; abilities.start(g); ammo.start(g.play.grid);
      if (Q.has('reserve')) weapon.S.reserve = Math.max(0, +Q.get('reserve') || 0);   // the tests: start low on ammunition
    },
  };
}

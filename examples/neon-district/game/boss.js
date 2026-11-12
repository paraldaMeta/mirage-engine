// The swordsman (kind 'ronin'): the boss on the relay's roof, built round the draw from the scabbard.
//   guard        between moves it stands or circles with its hand on the grip and turns rounds from the front aside
//                with the blade (sparks, a clang): no damage. From behind, and while a move recovers or the blade goes
//                back into the scabbard (slowly, a click at the end), it takes the damage, a third more in the return.
//   moves        each is called out at its telegraph (callout.js) with a short shout; the names are our own
//     rainpierce   7-20 m, a clear line: the draw stance, a glint on the scabbard's mouth, a quiet click then a breath;
//                  0.45 s later it crosses the distance at once (a streak), draws and cuts low: the player is thrown
//                  (a launch, the camera kicked, a slow beat). Dash (the grace) or jump in the window; punish the
//                  1.6 s return to the scabbard
//     stormdrop    4-10 m, a leap at where the player stood and a cut down on landing: step aside after it jumps
//     risingtide   under 3 m, a low crouch, then a rising cut that lifts the player: back off in the crouch
//     stonewake    5-15 m, the blade into the ground: a wave of rubble runs along it: step aside or jump it
//     ninefold     (from the second stance) under 4 m, nine glints round the blade, nine cuts at once: get out of reach
//     twinsheath   (from the second stance) under 3.5 m, a draw and then the scabbard itself as a second blow: dash
//                  through the first, back off from the second
//     ebbdraw      3.5-8 m, a step and a wide draw that pulls the player in, then the return cut: dash out of the pull
//   phases       the second stance at 60 % health: the flurry and the double draw join the rest, shorter pauses
//   defeat       it does not die: it kneels, cleans the blade, sheathes it, bows, and joins the player (the run's flag
//                bossBeaten, kept in the checkpoints; the settings' ndAlly.unlocked: New Game+)
//   the ally     follows 3-5 m behind the player, fights the hostile robots with the same moves and callouts on a
//                cooldown (it does not take every kill: its blows count as the player's for the score), never hurts the
//                player or a civilian, is never hurt (enemies.js: the player's rounds pass it by), comes back to the
//                player when it is left behind or stuck
//   New Game+    a run that starts with ndAlly.unlocked has the swordsman from the start and the heavy chassis
//                (heavy.js) in its place on the roof
//   the ending   after the story's closing card: a black card (callout.js endCard) held until a click or a key, then
//                the next run (New Game+)
import * as THREE from 'three';
import { T } from './text.js';

const CD = { rainpierce: 6, stormdrop: 5, ebbdraw: 7, stonewake: 6, risingtide: 3, ninefold: 7, twinsheath: 6 };
const RANGE = { rainpierce: [7, 20], stormdrop: [4, 10], ebbdraw: [3.5, 8], stonewake: [5, 15], risingtide: [0, 3], ninefold: [0, 4], twinsheath: [0, 3.5] };
const PHASE2 = ['ninefold', 'twinsheath'];
const LOCK = { rainpierce: 0.9, stormdrop: 0.55, risingtide: 0.4, stonewake: 0.7, ninefold: 0.55, twinsheath: 0.4, ebbdraw: 0.5, kneel: 0, rise: 0 };
// at the player: reach (m at scale 1), half-arc, damage, knock-back, lift (kept low: the roof's parapet must hold a
// thrown player); low: a jump clears it. dmgAlly: on robots
const HIT = {
  rainpierce: { reach: 2.4, arc: 1.6, dmg: 42, knock: 11, up: 3.5, low: true, slow: 0.4, dmgAlly: 75, posture: 110 },
  stormdrop: { reach: 1.7, arc: 3.2, dmg: 30, knock: 6, up: 3.5, dmgAlly: 45 },
  risingtide: { reach: 2.1, arc: 1.2, dmg: 20, knock: 3, up: 4.5, dmgAlly: 35 },
  ninefold: { reach: 2.7, arc: 1.3, dmg: 27, knock: 4, dmgAlly: 50 },
  twinsheath: { reach: 2.2, arc: 1.4, dmg: 14, knock: 2, dmgAlly: 25 },
  twinsheath2: { reach: 2.5, arc: 1.5, dmg: 14, knock: 8, up: 3, dmgAlly: 25, posture: 60 },
  ebbdraw: { reach: 2.4, arc: 1.6, dmg: 24, knock: 9, up: 3, slow: 0.3, dmgAlly: 40 },
  wave: { dmg: 16, knock: 5, up: 3, low: true, dmgAlly: 30 },
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const NG_KEY = 'ndAlly';
const Q = new URLSearchParams(globalThis.location?.search || ''), TEST = Q.has('start'), ENDING = Q.get('ending') === '1';

export function createBoss(X) {
  const { game, player, vfx, sfx, R, list, ui, on, start, step, strikePlayer, strikeRobots, launch, slow, glint, trail, flag, MFX, plan, edgeMat } = X;
  const nav = () => X.nav();
  const rect = plan.relay.rect, roofY = plan.relay.roof;
  const inArena = (p) => p[1] > roofY - 0.8 && p[0] > rect[0] - 0.5 && p[0] < rect[2] + 0.5 && p[2] > rect[1] - 0.5 && p[2] < rect[3] + 0.5;
  /** New Game+: the settings' unlock as it was when this run (this page) began; the reset clears it */
  const unlocked = () => !!game.settings[NG_KEY]?.unlocked;
  let ngRun = unlocked();
  const waves = [];
  let me = null, endT = -1, endShown = false, glow = 0;
  const boss = () => (me ||= list.find((x) => x.K.melee === 'iai'));
  const say = (e, key) => on.say(e, T.melee.lines[key]);
  const at = (e, h = 1.2) => [e.pos[0], e.pos[1] + h * e.K.scale, e.pos[2]];
  const place = (e, p) => { const to = nav().nearest(p, { snap: 1.2 }); if (to) { e.agent.place(to); e.pos = e.agent.pos; } return !!to; };
  function turn(e, face, dt, rate = 7) {
    if (face) { const want = Math.atan2(face[0] - e.pos[0], face[2] - e.pos[2]); e.yaw += wrap(want - e.yaw) * Math.min(1, dt * rate); }
    e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw);
  }
  const go = (e, p, speed) => { e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = speed; const g = nav().nearest(p, { snap: 2 }); if (g) e.agent.setGoal(g); };

  // ---- a move in progress (as the boss at the player, or as the ally at a robot: tgt { pos, robot })
  function run(e, dt, tgt) {
    const m = e.mm, name = m.move, foe = !e.ally, sc = e.K.scale;
    if (m.t < m.lockAt && tgt) m.face = tgt.pos.slice();
    const hit = (key) => {
      const s = HIT[key];
      if (foe) { const r = strikePlayer(e, s); if (r === 'hit' && s.slow) slow(s.slow); sfx.play(r === 'hit' ? 'md_slash' : 'md_swish', { at: at(e), gain: 1, ref: 6 }); }
      else { strikeRobots(e, { ...s, dmg: s.dmgAlly, posture: s.posture }); sfx.play('md_slash', { at: at(e), gain: 0.9, ref: 6 }); }
      m.trailT = 0.16;
    };
    // continuous: the dash, the leap, the step, the pull, the flurry's lunge
    const k = (a, b) => Math.min(1, Math.max(0, (m.t - a) / (b - a)));
    if (name === 'rainpierce' && m.dash && m.t <= 1.21) {
      const u = k(1.05, 1.19), a = m.dash[0], b = m.dash[1];
      place(e, [a[0] + (b[0] - a[0]) * u, b[1], a[2] + (b[2] - a[2]) * u]);
    }
    if (name === 'stormdrop' && m.leap && m.t > 0.55 && m.t <= 1.07) {
      const u = k(0.55, 1.05), a = m.leap[0], b = m.leap[1];
      place(e, [a[0] + (b[0] - a[0]) * u, b[1], a[2] + (b[2] - a[2]) * u]); m.lift = 2.3 * Math.sin(Math.PI * u) * (u < 1 ? 1 : 0);
    }
    if (name === 'ebbdraw' && m.t > 0.5 && m.t < 0.62) place(e, [e.pos[0] + e.heading[0] * 13 * dt, e.pos[1], e.pos[2] + e.heading[1] * 13 * dt]);
    if (name === 'ninefold' && m.t > 0.58 && m.t < 0.98 && tgt && Math.hypot(tgt.pos[0] - e.pos[0], tgt.pos[2] - e.pos[2]) > 1.8) place(e, [e.pos[0] + e.heading[0] * 3 * dt, e.pos[1], e.pos[2] + e.heading[1] * 3 * dt]);
    if (name === 'ebbdraw' && foe && m.t > 0.62 && m.t < 1.0 && player.body && !(player.iframe > game.time)) {
      const dx = e.pos[0] - player.feet[0], dz = e.pos[2] - player.feet[2], d = Math.hypot(dx, dz);
      if (d < 10 && d > 1.3) { player.body.push = [dx / d * 7, dz / d * 7]; if (Math.random() < dt * 20) vfx.beam({ from: [player.feet[0] + (Math.random() - 0.5) * 3, player.feet[1] + 0.4 + Math.random() * 1.4, player.feet[2] + (Math.random() - 0.5) * 3], to: at(e, 1.1), width: 0.02, color: '#cfe8ff', intensity: 3, life: 0.12 }); }
    }
    m.trailT = Math.max(0, (m.trailT || 0) - dt);
    trail(e, m.trailT > 0 || (name === 'ninefold' && m.t > 0.58 && m.t < 0.98), e.ally ? '#8ff4ff' : '#dff2ff');
    const done = step(e, dt, (ev) => {
      if (ev === 'call') { ui.call(T.melee.moves[name], e.ally, e.ally ? T.melee.allyTag : T.melee.boss); sfx.play('md_shout', { at: at(e, 1.6), gain: 1, ref: 8 }); flag('callouts'); e.charge = 1; }
      else if (ev === 'click') { sfx.play('md_click', { at: at(e, 1), gain: 0.7, ref: 5 }); glow = 0.5; }
      else if (ev === 'glint') { glint(m.saya ? m.saya.getWorldPosition(new THREE.Vector3()).toArray() : at(e), 1.3); glow = 0.6; flag('glints'); }
      else if (ev === 'breath') sfx.play('md_breath', { at: at(e, 1.5), gain: 0.9, ref: 6 });
      else if (ev === 'dash') {
        const p = tgt ? tgt.pos : e.pos, dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz) || 1, stop = Math.max(0, d - 1.1);
        let to = [e.pos[0] + dx / d * stop, p[1], e.pos[2] + dz / d * stop];
        if (!nav().visible(e.pos, to)) to = e.pos.slice();
        m.dash = [e.pos.slice(), to];
        sfx.play('md_draw', { at: at(e), gain: 1.1, ref: 8 });
        for (const h of [0.45, 1.05, 1.6]) vfx.beam({ from: [e.pos[0], e.pos[1] + h * sc, e.pos[2]], to: [to[0], to[1] + h * sc, to[2]], width: h === 1.05 ? 0.16 : 0.07, color: e.ally ? '#7af0ff' : '#ff5a6a', intensity: 7, life: 0.32 });
        flag('dashes_boss');
      } else if (ev === 'leap') {
        const p = tgt ? tgt.pos : e.pos, dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz) || 1;
        m.leap = [e.pos.slice(), nav().nearest([p[0] - dx / d * 0.9, p[1], p[2] - dz / d * 0.9], { snap: 2 }) || e.pos.slice()];
        sfx.play('md_swish', { at: at(e), gain: 1, ref: 6, rate: 0.6 });
      } else if (ev === 'cut' || ev === 'cut2') {
        e.charge = 0;
        if (name === 'rainpierce') { glow = 1; slow(0.12, 0.4); }
        if (name === 'stormdrop') { m.lift = 0; vfx.burst(MFX.rubble, [e.pos[0] + e.heading[0], e.pos[1] + 0.1, e.pos[2] + e.heading[1]], { direction: [0, 1, 0], scale: 1.4 }); sfx.play('md_rumble', { at: e.pos, gain: 0.9, ref: 8 }); player.shake?.(0.8); }
        hit(ev === 'cut2' ? 'twinsheath2' : name);
      } else if (ev === 'wake') {
        e.charge = 0;
        const d = m.face ? Math.hypot(m.face[0] - e.pos[0], m.face[2] - e.pos[2]) : 0;
        waves.push({ e, foe, pos: [e.pos[0] + e.heading[0] * 1.2, e.pos[1], e.pos[2] + e.heading[1] * 1.2], dir: [e.heading[0], e.heading[1]], t: 0, len: Math.max(8, d + 3), puff: 0, hit: new Set() });
        sfx.play('md_rumble', { at: e.pos, gain: 1, ref: 10 }); player.shake?.(0.6); flag('waves');
      } else if (ev === 'nine') {
        for (let i = 0; i < 9; i++) { const a = i * 0.7, r = i === 8 ? 0 : 0.55; glint([e.pos[0] + e.heading[0] * 1.3 * sc + Math.cos(a) * e.heading[1] * r, e.pos[1] + (1.3 + Math.sin(a) * r) * sc, e.pos[2] + e.heading[1] * 1.3 * sc - Math.cos(a) * e.heading[0] * r], 0.7); }
        sfx.play('md_draw', { at: at(e), gain: 0.8, ref: 6, rate: 1.3 });
      } else if (ev === 'step') sfx.play('md_wind', { at: at(e), gain: 1, ref: 8 });
      else if (ev === 'open') { m.open = true; e.charge = 0; }
      else if (ev === 'chin') { sfx.play('md_chin', { at: at(e, 1), gain: 1, ref: 7 }); m.open = false; flag('sheathes'); }
      else if (ev === 'bow') { /* the kneel's end: see think() */ }
    });
    turn(e, m.face, dt, m.t < m.lockAt ? 8 : 1.5);
    return done;
  }
  // the rubble waves: along the ground, puffs of rubble, a hit on whoever they cross (low: a jump clears them)
  function waveStep(dt) {
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], adv = 15 * dt;
      w.t += adv; w.pos[0] += w.dir[0] * adv; w.pos[2] += w.dir[1] * adv;
      if ((w.puff -= dt) <= 0) { w.puff = 0.05; vfx.burst(MFX.rubble, [w.pos[0], w.pos[1] + 0.05, w.pos[2]], { direction: [w.dir[0] * 0.5, 1, w.dir[1] * 0.5], scale: 0.9 }); }
      const s = HIT.wave;
      if (w.foe) {
        const p = player.feet, dx = p[0] - w.pos[0], dz = p[2] - w.pos[2];
        if (!w.hit.has('p') && Math.hypot(dx, dz) < 1.1 && Math.abs(p[1] - w.pos[1]) < 1.2) {
          w.hit.add('p');
          if (player.iframe > game.time) flag('meleeDodges');
          else if (player.body && !player.body.onGround && p[1] - w.pos[1] > 0.25) flag('meleeJumps');
          else { player.hurt(s.dmg * (X.assist ? 0.12 : 1) * X.tune.dmg, w.pos); launch(w.dir[0], w.dir[1], s.knock, s.up); flag('meleeHits'); }
        }
      } else for (const o of list) {
        if (o.dead || o.ally || !o.active || w.hit.has(o) || Math.hypot(o.pos[0] - w.pos[0], o.pos[2] - w.pos[2]) > 1.2 * o.K.scale) continue;
        w.hit.add(o); X.damage(o, s.dmgAlly, false, [o.pos[0], o.pos[1] + 0.6, o.pos[2]], [w.dir[0], 0.3, w.dir[1]], { friendly: true, from: w.e.pos.slice(), melee: true, ally: true, posture: 40 });
      }
      if (w.t > w.len) waves.splice(i, 1);
    }
  }
  function choose(e, dist, ally = false) {
    const m = e.mm, c = [];
    for (const [name, [a, b]] of Object.entries(RANGE)) {
      if (dist < a || dist > b || (m.cd[name] || 0) > 0) continue;
      if (!ally && PHASE2.includes(name) && m.phase < 2) continue;
      if (ally && name === 'ebbdraw') continue;
      if (name === 'rainpierce' && !nav().visible(e.pos, ally ? m.tgt.pos : player.feet)) continue;
      for (let i = 0; i < (name === 'rainpierce' ? 3 : 1.5) * 2; i++) c.push(name);
    }
    return c.length ? c[Math.floor(R() * c.length)] : null;
  }
  function begin(e, name) { const m = e.mm; start(e, name, LOCK[name] ?? 0.4); m.cd[name] = CD[name] || 0; m.dash = null; m.leap = null; flag('bossMoves'); flag('move_' + name); }

  // ---- the boss's brain (enemies.js think() hands it over)
  function think(e, dt) {
    const m = e.mm;
    m.cd ||= {}; for (const k in m.cd) m.cd[k] = Math.max(0, m.cd[k] - dt);
    if (e.ally) return ally(e, dt);
    if (ngRun || game.flags.bossBeaten) { join(e, true); return; }   // New Game+, or a checkpoint after it was beaten
    if (m.move === 'kneel') { if (run(e, dt, null)) join(e, false); return; }
    const p = player.feet, here = inArena(p) && !player.dead;
    if (!m.awake) {
      e.state = 'post'; turn(e, null, dt);
      if (!here) return;
      m.awake = true; m.gap = 1.2; game.set('bossAwake', true); on.radio('wake'); say(e, 'wake');
    }
    if (m.move) { run(e, dt, { pos: p }); return; }
    if (!here) { e.state = 'post'; if (Math.hypot(e.pos[0] - e.home[0], e.pos[2] - e.home[2]) > 1 && (e.agent.arrived || !e.agent.path)) go(e, e.home, 2.2); turn(e, e.agent.moving ? [e.pos[0] + e.agent.heading[0], 0, e.pos[2] + e.agent.heading[1]] : null, dt, 4); return; }
    e.state = 'fight'; e.seenT = game.time; e.lastSeen = p.slice();
    const ph = e.hp / e.maxHp <= 0.6 ? 2 : 1;
    if (ph !== (m.phase || 1)) { m.phase = ph; if (ph === 2) { on.radio('phase'); ui.call(T.melee.stance2, false, T.melee.boss); sfx.play('md_shout', { at: at(e, 1.6), gain: 1.1, ref: 8, rate: 0.85 }); m.gap = 1.4; flag('bossPhase2'); } }
    m.phase ||= 1;
    const dist = Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]);
    if ((m.gap -= dt) <= 0 && Math.abs(p[1] - e.pos[1]) < 1.5) {
      const name = choose(e, dist);
      if (name) { begin(e, name); m.gap = (m.phase === 2 ? 0.5 : 0.9) + R() * 0.6; return; }
    }
    // between moves: keep to the draw's distance, circling; back off from a close player when nothing close is ready
    if ((e.shift -= dt) <= 0 || e.agent.arrived) {
      e.shift = 0.7 + R() * 0.5;
      const a = Math.atan2(e.pos[2] - p[2], e.pos[0] - p[0]) + (m.side ||= R() < 0.5 ? 1 : -1) * 0.5, r = dist < 4 ? 8 : dist > 12 ? 7 : 8.5;
      if (R() < 0.15) m.side = -m.side;
      go(e, [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], dist < 4 || dist > 12 ? e.K.speed : 1.8);
    }
    turn(e, p, dt, 6);
  }
  /** a hit on the boss: turned aside in guard from the front; the return to the scabbard takes a third more; at the
   *  end of its health it kneels instead of falling */
  function guard(e, amount, head, point, dir, hit) {
    const m = e.mm;
    if (m.move === 'kneel') return 0;
    const front = -(dir[0] * e.heading[0] + dir[2] * e.heading[1]) > 0.26;   // within 75 degrees of its face
    if (!m.awake || !m.open && front && !hit?.splash && (!m.move || m.t < (m.lockAt || 0))) {
      const c = [e.pos[0] + e.heading[0] * 0.5 * e.K.scale, e.pos[1] + 1.25 * e.K.scale, e.pos[2] + e.heading[1] * 0.5 * e.K.scale];
      vfx.burst(MFX.clash, c, { direction: [-dir[0], 0.4, -dir[2]], scale: 0.8 });
      if (game.time - (m.clangT || -1) > 0.07) { m.clangT = game.time; sfx.play('md_clang', { at: c, gain: 0.7, ref: 6, rate: 0.9 + Math.random() * 0.25 }); }
      glow = Math.max(glow, 0.3); flag('deflects');
      return 0;
    }
    const k = (m.open ? 1.35 : 1) * (hit?.splash ? 0.6 : 1), dealt = amount * k * (head ? 2.2 : 1);
    if (e.hp - dealt <= 1) { kneel(e); return 0; }
    if (m.open) flag('punishes');
    return k;
  }
  /** beaten: it kneels (then join() when the bow is done) */
  function kneel(e) {
    const m = e.mm;
    e.hp = 1; m.queue = []; m.awake = true; begin(e, 'kneel'); m.open = false; e.agent.stop(); waves.length = 0; e.charge = 0;
    ui.call(T.melee.yield, false, T.melee.boss); on.radio('beaten'); flag('bossKneels');
  }
  /** it joins: the run's flag, the settings' unlock, a line; quiet: put by the player (a load, New Game+) */
  function join(e, quiet) {
    const m = e.mm;
    e.ally = true; e.hp = e.maxHp; e.dead = false; e.active = true; e.rig.root.visible = true; e.state = 'ally'; e.charge = 0;
    m.move = quiet ? null : 'rise'; m.t = 0; m.ev = 0; m.awake = true; m.allyCd = 2; m.stuck = 0;
    if (!game.flags.bossBeaten && !ngRun) game.set('bossBeaten', true);
    if (!unlocked()) { game.settings[NG_KEY] = { unlocked: true }; try { game.saveSettings(); } catch { /* storage blocked: this run only */ } }
    if (quiet) { if (Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) > 8) bring(e); }
    else { say(e, 'join'); on.radio('join'); }
    flag('allyJoined');
  }
  /** back beside the player (behind and to the right), with a glint where it arrives */
  function bring(e) {
    const p = player.feet, yaw = player.yaw ? player.yaw() : 0, bx = -Math.cos(yaw), bz = -Math.sin(yaw);
    for (const r of [3.5, 2.5, 5, 1.6]) if (place(e, [p[0] + bx * r - bz * 1.2, p[1], p[2] + bz * r + bx * 1.2])) break;
    e.yaw = Math.atan2(p[0] - e.pos[0], p[2] - e.pos[2]); e.rig.root.position.set(...e.pos);
    glint(at(e, 1.2), 1.2); flag('allyTeleports');
  }
  // ---- the ally
  function ally(e, dt) {
    const m = e.mm, p = player.feet;
    e.state = 'ally'; e.stun = 0; e.jam = 0; e.stagger = 0; e.hp = e.maxHp;
    if (!e.rig.root.visible) { e.rig.root.visible = true; e.active = true; }
    if (game.flags.holdout) return;
    if (m.move === 'rise' || m.move === 'kneel') { run(e, dt, null); return; }
    m.allyCd = Math.max(0, (m.allyCd ?? 2) - dt);
    // the nearest hostile robot near the player (a boss first)
    if (!m.move) {
      let best = null, bd = 1e9;
      for (const o of list) {
        if (o === e || o.dead || o.ally || !o.active || !o.rig.root.visible || (o.K.boss ? !o.mm?.awake : o.state === 'post')) continue;
        const d = Math.hypot(o.pos[0] - e.pos[0], o.pos[2] - e.pos[2]), dp = Math.hypot(o.pos[0] - p[0], o.pos[2] - p[2]);
        if (dp > 24 || d > 28 || Math.abs(o.pos[1] - e.pos[1]) > 2.5) continue;
        const score = d - (o.K.boss ? 8 : 0);
        if (score < bd) { bd = score; best = o; }
      }
      m.tgt = best;
    }
    if (m.move) { run(e, dt, m.tgt && !m.tgt.dead ? { pos: m.tgt.pos, robot: m.tgt } : null); return; }
    // left behind or stuck: back by the player
    const dp = Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]);
    m.stuck = e.agent.moving || dp < 6 ? 0 : (m.stuck || 0) + dt;
    if (dp > 30 || Math.abs(p[1] - e.pos[1]) > 3.5 && dp > 6 || m.stuck > 3) { bring(e); m.stuck = 0; return; }
    const t = m.tgt;
    if (t) {
      const d = Math.hypot(t.pos[0] - e.pos[0], t.pos[2] - e.pos[2]);
      if (m.allyCd <= 0) { const name = choose(e, d, true); if (name) { begin(e, name); m.allyCd = 4.5 + R() * 2.5; flag('allyMoves'); return; } }
      if (d > 3 && (e.shift -= dt) <= 0) { e.shift = 0.5; const l = d || 1; go(e, [t.pos[0] - (t.pos[0] - e.pos[0]) / l * 2.5, t.pos[1], t.pos[2] - (t.pos[2] - e.pos[2]) / l * 2.5], e.K.speed * 1.2); }
      turn(e, t.pos, dt, 6);
      return;
    }
    // follow: 3-5 m off the player
    if ((e.shift -= dt) <= 0) {
      e.shift = 0.6;
      if (dp > 5) { const yaw = player.yaw ? player.yaw() : 0; go(e, [p[0] - Math.cos(yaw) * 3.2 + Math.sin(yaw) * 1.4, p[1], p[2] - Math.sin(yaw) * 3.2 - Math.cos(yaw) * 1.4], dp > 10 ? 5.2 : 3.4); }
      else if (dp < 3) e.agent.stop();
    }
    turn(e, e.agent.moving ? [e.pos[0] + e.agent.heading[0], 0, e.pos[2] + e.agent.heading[1]] : p, dt, 5);
  }

  // ---- once a step (real time): the rubble, the blade's glint, the bar, New Game+ and the ending
  let ngSaid = false;
  function tick(dt) {
    const e = boss(); if (!e) return;
    waveStep(dt * X.S.slow);
    glow = Math.max(0, glow - dt * 1.6);
    edgeMat.color.setRGB(0.55, 0.85, 1.0).multiplyScalar(3 + 40 * glow);
    const m = e.mm, show = m.awake && !e.ally && !e.dead && e.rig.root.visible && Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) < 40;
    if (show) ui.bar({ name: T.melee.boss, frac: e.hp / e.maxHp, marks: [0.6], note: m.open ? T.melee.open : m.phase === 2 ? T.melee.stance2 : '' });
    else if (!X.heavy?.barOn) ui.bar(null);
    if (ngRun && e.ally && !ngSaid && inArena(player.feet)) { ngSaid = true; say(e, 'roof'); }
    // the ending: after the story's closing card (12 s), the black card; then the next run
    // (the tests' runs, ?start=1, see it only with ?ending=1: it holds the screen until a key)
    if (game.flags.closed && endT < 0 && (!TEST || ENDING)) endT = 12.5;
    if (endT > 0 && (endT -= dt) <= 0 && !endShown) {
      endShown = true; flag('endCards');
      if (!unlocked()) { game.settings[NG_KEY] = { unlocked: true }; try { game.saveSettings(); } catch { /* blocked */ } }
      game.pause(true);   // the world holds still behind the card
      ui.endCard(() => { game.set('ngReady', true); game.pause(false); if (!TEST) location.reload(); });
    }
  }
  /** the title's reset: the swordsman a foe again, the heavy chassis back to its rest, New Game+ off */
  function resetAlly() {
    delete game.settings[NG_KEY]; try { game.saveSettings(); } catch { /* blocked */ }
    ngRun = false; ngSaid = false;
    const e = boss(); if (!e) return;
    e.ally = false; e.state = 'post'; e.hp = e.maxHp; e.mm.awake = false; e.mm.move = null; place(e, e.home); e.yaw = e.def.face ?? 0;
    game.set('bossBeaten', false);
  }
  /** the tests' drill (?drill=1, N): the swordsman beaten where it stands */
  const drillBeat = () => { const e = boss(); if (e && !e.ally && !e.dead && e.mm.move !== 'kneel') kneel(e); };
  /** the tests: a move now (awake, at the player) */
  const force = (name, target = null) => { const e = boss(); e.mm.awake = true; e.mm.cd ||= {}; if (target) e.mm.tgt = target; begin(e, name); };
  return { think, guard, tick, resetAlly, drillBeat, kneel, force, get ngRun() { return ngRun; }, get entity() { return boss(); }, waves, inArena, HIT };
}

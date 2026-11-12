// The heavy chassis (kind 'bulwark'): New Game+'s boss on the relay's roof, in the swordsman's place (the swordsman is
// the player's ally by then). A body like a small tank that moves with startling speed: the whole point is the
// contrast. Learned from heavy armoured boss design in general; the chassis, its names and its moves are our own.
//   armour     small arms barely scratch it (a quarter of the damage, no flinch); the cooling vents (two on the back,
//              one on top of each shoulder plate, lit orange) take two and a half times as much; a rocket's blast, the
//              stock and the ally's blade wear its posture down: at 100 it staggers (1.4 s, the vents wide open, x3)
//   moves      every one called out at its telegraph, every one with a counter
//     railslide    a crouch with the vents flaring, then a ground dash past the player and a sliding stop in sparks:
//                  side-step (it runs a straight line, 1 m wide)
//     cityfall     a leap onto a roof unit, a moment crouched there, then down onto where the player was (a red
//                  ring marks it 0.55 s ahead): the landing cracks the roof and throws a shockwave 4.5 m out; leave the
//                  ring or be in the air when it lands
//     embrace      within 3 m: arms wide (0.45 s), a clap that grabs; caught, the player is lifted: mash any key or
//                  button 7 times in 1.1 s to break free (it staggers), else thrown
//     breachcannon a slow charge with a red line on the player that locks 0.25 s before the shot: step off the line
//     houndswarm   a burst of rounds from the right arm that bend toward the player in flight: run across them, or cover
//     hornetsalvo  eight micro-rockets up out of the back, each down on a spot marked round the player: keep moving
//     rampart      within 3.5 m: a hook, then a shoulder charge along a straight line: dash aside, punish the stop
//   phases     faster with each third of its health lost (its moves play quicker, shorter pauses)
import * as THREE from 'three';
import { part, tf, ext, COL } from '@miragekit/assets/kits/cyber';
import { T } from './text.js';
import { FX } from './fx.js';

// strikes at scale 1 (the chassis is 1.42): reach, half-arc, damage, knock-back, lift
const HIT = {
  punch: { reach: 1.6, arc: 0.8, dmg: 14, knock: 4, up: 1.5 },
  charge: { reach: 1.1, arc: 1.4, dmg: 20, knock: 10, up: 4, slow: 0.2 },
  slide: { reach: 0.9, arc: 3.2, dmg: 16, knock: 7, up: 2 },
};
const CD = { railslide: 2.6, cityfall: 11, embrace: 8, breachcannon: 6, houndswarm: 7, hornetsalvo: 9, rampart: 3.2 };
const MOVE = { railslide: 'hslide', cityfall: 'hjump', embrace: 'hgrab', breachcannon: 'hcannon', houndswarm: 'hbarrage', hornetsalvo: 'hsalvo', rampart: 'hpunch' };
// the vents in the Chest bone's frame (rig metres): back pair, shoulder tops
export const VENTS = [[0.1, 0.1, -0.33], [-0.1, 0.1, -0.33], [0.33, 0.3, 0], [-0.33, 0.3, 0]];

/** the chassis' armour by bone, in the rig's T-pose space (humanoidMeshes' extra): shoulder slabs, a back pack with two
 *  rocket pods, the vents (lit: they glow with the visor), a cannon under the left forearm, a gun under the right */
export function heavyParts() {
  const C = [], L = [], Rf = [], H = [];
  const box = (w, h, d, p, c, list, slot = 's', r = [0, 0, 0]) => list.push(part(tf(new THREE.BoxGeometry(w, h, d), p, r), slot, c));
  for (const s of [-1, 1]) {
    box(0.26, 0.15, 0.3, [s * 0.34, 1.47, 0], COL.graphite, C, 's', [0, 0, s * 0.18]);                 // the shoulder slab
    box(0.22, 0.04, 0.24, [s * 0.34, 1.565, 0], COL.carbon, C, 's', [0, 0, s * 0.18]);
    box(0.1, 0.012, 0.14, [s * 0.33, 1.585, 0], [1, 1, 1], C, 'l', [0, 0, s * 0.18]);                    // a vent on top
    box(0.16, 0.24, 0.16, [s * 0.15, 1.6, -0.27], COL.carbon, C);                                          // a rocket pod
    for (let i = 0; i < 4; i++) box(0.03, 0.012, 0.03, [s * 0.15 + (i % 2 ? 0.035 : -0.035), 1.725, -0.27 + (i < 2 ? 0.035 : -0.035)], [1, 1, 1], C, 'l');
    box(0.08, 0.1, 0.012, [s * 0.1, 1.35, -0.33], [1, 1, 1], C, 'l');                                     // a back vent
    for (let i = 0; i < 3; i++) box(0.09, 0.008, 0.02, [s * 0.1, 1.315 + i * 0.035, -0.34], COL.carbon, C);
  }
  box(0.42, 0.3, 0.12, [0, 1.38, -0.28], COL.graphite, C);                                                 // the pack
  // the cannon under the left forearm (the arm along +x in the T-pose), its muzzle lit
  L.push(part(tf(new THREE.CylinderGeometry(0.065, 0.075, 0.46, 12).rotateZ(Math.PI / 2), [0.72, 1.33, 0]), 's', COL.graphite));
  L.push(part(tf(new THREE.TorusGeometry(0.05, 0.012, 4, 12).rotateY(Math.PI / 2), [0.955, 1.33, 0]), 'l', [1, 1, 1]));
  // the gun under the right forearm: three barrels
  for (let i = 0; i < 3; i++) { const a = i * 2.09; Rf.push(part(tf(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6).rotateZ(Math.PI / 2), [-0.78, 1.34 + Math.sin(a) * 0.03, Math.cos(a) * 0.03]), 's', COL.dark)); }
  Rf.push(part(tf(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10).rotateZ(Math.PI / 2), [-0.6, 1.34, 0]), 's', COL.carbon));
  // a skirt of plates
  for (const a of [0, Math.PI]) H.push(part(ext([[-0.16, 0], [0.16, 0], [0.13, -0.2], [-0.13, -0.2]], 0.02, 0.006, 'xy', 1).rotateX(-0.12).rotateY(a).translate(Math.sin(a) * 0.2, 0.93, Math.cos(a) * 0.2), 's', COL.graphite));
  return { Chest: C, LeftForeArm: L, RightForeArm: Rf, Hips: H };
}

export function createHeavy(X) {
  const { game, player, vfx, sfx, R, list, ui, on, start, step, strikePlayer, launch, slow, glint, flag, MFX, plan, physics } = X;
  const nav = () => X.nav();
  const shots = [], rockets = [];
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  let me = null, mash = 0, mashT = 0;
  const heavy = () => (me ||= list.find((x) => x.K.melee === 'heavy'));
  const at = (e, h = 1.2) => [e.pos[0], e.pos[1] + h * e.K.scale, e.pos[2]];
  const place = (e, p) => { const to = nav().nearest(p, { snap: 1.2 }); if (to) { e.agent.place(to); e.pos = e.agent.pos; } return !!to; };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const turn = (e, face, dt, rate) => { if (face) { const want = Math.atan2(face[0] - e.pos[0], face[2] - e.pos[2]); e.yaw += wrap(want - e.yaw) * Math.min(1, dt * rate); } e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw); };
  const hurt = (dmg, from) => { if (player.iframe > game.time) { flag('meleeDodges'); return false; } player.hurt(dmg * (X.assist ? 0.12 : 1) * X.tune.dmg, from); flag('heavyHits'); return true; };
  const chest = (p) => [p[0], p[1] + 1.15, p[2]];
  // the landing ring: a flat red ring on the roof where the leap comes down
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.05).multiplyScalar(3), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.visible = false; ring.renderOrder = 3; ring.userData.occlude = false; ring.userData.collide = false; X.world.scene.add(ring);
  // the perches: the roof units' tops (plan.roofUnits: [x, z, length, height])
  const perches = (plan.roofUnits || []).map(([x, z, , h]) => [x, plan.relay.roof + h, z]);
  // any key, button or tap while held counts toward breaking free
  const press = () => { mash++; };
  addEventListener('keydown', press, true); addEventListener('pointerdown', press, true);
  X.onDispose?.(() => { removeEventListener('keydown', press, true); removeEventListener('pointerdown', press, true); ring.removeFromParent(); });

  function begin(e, name) {
    const m = e.mm;
    start(e, MOVE[name], name === 'breachcannon' ? 1.0 : name === 'cityfall' ? 0.3 : 0.32);
    m.name = name; m.cd[name] = CD[name] / (m.speed || 1); flag('heavyMoves'); flag('move_' + name);
    { ui.call(T.melee.moves[name], false, T.melee.heavy); sfx.play('md_roar', { at: at(e, 1.8), gain: 1.1, ref: 10 }); flag('callouts'); }
    e.charge = 1; m.fired = 0; m.dash = null;
  }
  const cannonTip = (e) => { e.rig.bones.LeftHand.getWorldPosition(v); return v.toArray(); };
  const gunTip = (e) => { e.rig.bones.RightHand.getWorldPosition(v); return [v.x + e.heading[0] * 0.3, v.y, v.z + e.heading[1] * 0.3]; };
  function run(e, dt) {
    const m = e.mm, p = player.feet, sc = e.K.scale;
    const dts = dt * (m.speed || 1);
    if (m.t < m.lockAt) m.face = p.slice();
    // the cannon's line: tracking, then locked
    if (m.name === 'breachcannon' && m.t > 0.3 && m.t < 1.25) {
      const from = cannonTip(e), to = m.t < 1.0 ? chest(p) : m.aim;
      if (m.t >= 1.0 && !m.aim) m.aim = chest(p);
      vfx.beam({ from, to: m.aim || to, width: m.t < 1.0 ? 0.012 : 0.025, color: '#ff2020', intensity: m.t < 1.0 ? 3 : 7, life: 0.05 });
    }
    // the barrage: a round every 0.07 s, bending toward the player in flight
    if (m.name === 'houndswarm' && m.firing && (m.fired += dts) > 0.07) {
      m.fired = 0; const from = gunTip(e), to = chest(p), d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1, s = 26;
      shots.push({ p: from, v: [(to[0] - from[0]) / d * s + (R() - 0.5) * 6, (to[1] - from[1]) / d * s + (R() - 0.3) * 3, (to[2] - from[2]) / d * s + (R() - 0.5) * 6], t: 0 });
      sfx.play('nd_bolt', { at: from, gain: 0.5, ref: 6, rate: 0.6 + R() * 0.1 });
    }
    // the slide: 0.3 s across the ground at speed, then sliding to a stop in sparks
    if (m.dash && m.t > 0.3 && m.t < 0.95) {
      const u = Math.min(1, (m.t - 0.3) / 0.3), ease = m.t < 0.6 ? u : 1, a = m.dash[0], b = m.dash[1];
      const slideK = m.t < 0.6 ? 0 : Math.min(1, (m.t - 0.6) / 0.35), over = (1 - (1 - slideK) ** 2) * 1.6;
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      place(e, [a[0] + dx * ease + dx / l * over, b[1], a[2] + dz * ease + dz / l * over]);
      if (m.t > 0.55 && (m.spark = (m.spark || 0) - dt) <= 0) { m.spark = 0.05; vfx.burst(FX.impact, [e.pos[0], e.pos[1] + 0.05, e.pos[2]], { direction: [-dx / l, 0.6, -dz / l], scale: 1.6 }); }
      if (!m.hitDone.slide && Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]) < HIT.slide.reach * sc && m.t < 0.62) { m.hitDone.slide = true; strikePlayer(e, HIT.slide); }
    }
    // the shoulder charge: along its heading from 0.4 to 0.9
    if (m.move === 'hcharge' && m.t > 0.4 && m.t < 0.9) {
      place(e, [e.pos[0] + e.heading[0] * 12 * dts, e.pos[1], e.pos[2] + e.heading[1] * 12 * dts]);
      if (!m.hitDone.charge && Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]) < HIT.charge.reach * sc) { m.hitDone.charge = true; if (strikePlayer(e, HIT.charge) === 'hit') slow(HIT.charge.slow); sfx.play('md_thud', { at: at(e), gain: 1.2, ref: 8, rate: 0.6 }); }
    }
    // the leap: up onto a perch, a moment there, down at the player
    if (m.name === 'cityfall') return leap(e, dt);
    // the grab: held while the player struggles
    if (m.move === 'hgrab' && m.held) {
      const hx = e.pos[0] + e.heading[0] * 1.0 * sc, hz = e.pos[2] + e.heading[1] * 1.0 * sc;
      player.body?.place([hx, e.pos[1] + 0.9 * sc, hz], { exact: true }); if (player.body) { player.body.push = null; player.body.vy = 0; }
      if (game.time - mashT > 1.1) { mashT = game.time; mash = 0; }
      if (mash >= 7) {   // free: dropped, and it reels
        m.held = false; flag('grabEscapes'); launch(-e.heading[0], -e.heading[1], 4, 2); m.move = null; stagger(e); return;
      }
      if (m.t > 1.95) { m.held = false; m.t = 2.0; hurt(28, e.pos); launch(e.heading[0], e.heading[1], 10, 3.5); slow(0.3); sfx.play('md_thud', { at: at(e), gain: 1.3, ref: 8, rate: 0.5 }); flag('grabThrows'); }
    }
    const done = step(e, dts, (ev) => {
      if (ev === 'charge') { glint(m.name === 'breachcannon' ? cannonTip(e) : at(e, 1.4), m.name === 'breachcannon' ? 1.4 : 1); sfx.play(m.name === 'breachcannon' ? 'nd_charge' : 'md_wind', { at: at(e), gain: 1, ref: 10, rate: 0.7 }); }
      else if (ev === 'fire' && m.name === 'breachcannon') {
        e.charge = 0; const from = cannonTip(e), to = m.aim || chest(p), d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d) || 1, dir = d.map((x) => x / l);
        const w = physics.ray(from, dir, 60, player.collider()); const end = w ? w.point : from.map((x, i) => x + dir[i] * 60);
        // the player on the line?
        const pc = chest(p), k = Math.max(0, (pc[0] - from[0]) * dir[0] + (pc[1] - from[1]) * dir[1] + (pc[2] - from[2]) * dir[2]);
        const off = Math.hypot(from[0] + dir[0] * k - pc[0], from[1] + dir[1] * k - pc[1], from[2] + dir[2] * k - pc[2]);
        let endAt = end;
        if (off < 0.9 && (!w || k < w.distance)) { endAt = pc; if (hurt(34, from)) { launch(dir[0], dir[2], 9, 3); slow(0.2); } }
        vfx.beam({ from, to: endAt, width: 0.22, color: '#ffb060', intensity: 10, life: 0.18 });
        vfx.burst(FX.explosion, endAt, { scale: 0.6 }); sfx.play('nd_rkt_boom_open', { at: endAt, gain: 1, ref: 10 }); sfx.play('nd_snipe', { at: from, gain: 1, ref: 10, rate: 0.6 });
        player.shake?.(1.2); m.aim = null;
      } else if (ev === 'fire') { m.firing = true; e.charge = 0; sfx.play('nd_gat_motor', { at: at(e), gain: 0.8, ref: 8 }); }
      else if (ev === 'cease') m.firing = false;
      else if (ev === 'launch') {
        e.charge = 0;
        for (let i = 0; i < 8; i++) {
          const a = R() * Math.PI * 2, r = i === 0 ? 0 : 1.2 + R() * 2.6, to = [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r];
          const g = nav().nearest(to, { snap: 2 }) || to;
          rockets.push({ from: [e.pos[0] + (R() - 0.5) * 0.5, e.pos[1] + 2.5 * sc, e.pos[2] + (R() - 0.5) * 0.5], to: g, t: -i * 0.05, len: 1.1 + R() * 0.35, last: null, marked: false });
        }
        sfx.play('nd_rkt_load', { at: at(e, 2), gain: 1, ref: 10 }); flag('salvos');
      } else if (ev === 'dash') {
        const dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz) || 1, side = R() < 0.5 ? 1 : -1, len = Math.min(d + 2.5, 11);
        let to = [e.pos[0] + dx / d * len - dz / d * side * 1.0, p[1], e.pos[2] + dz / d * len + dx / d * side * 1.0];
        if (!nav().visible(e.pos, to)) to = nav().nearest([e.pos[0] + dx / d * Math.min(4, d), p[1], e.pos[2] + dz / d * Math.min(4, d)], { snap: 1.5 }) || e.pos.slice();
        m.dash = [e.pos.slice(), to]; e.charge = 0; sfx.play('md_wind', { at: at(e), gain: 1.2, ref: 10, rate: 1.3 }); flag('heavyDashes');
      } else if (ev === 'stop') sfx.play('md_rumble', { at: e.pos, gain: 0.6, ref: 8, rate: 1.6 });
      else if (ev === 'grab') {
        e.charge = 0; const dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz);
        if (d < 2.1 * sc && (dx * e.heading[0] + dz * e.heading[1]) / (d || 1) > 0.3 && Math.abs(p[1] - e.pos[1]) < 1.5 && !player.dead) {
          if (player.iframe > game.time) flag('meleeDodges');
          else { m.held = true; mash = 0; mashT = game.time; flag('grabs'); ui.call(T.melee.struggle, false, ''); sfx.play('md_thud', { at: at(e), gain: 1, ref: 6 }); }
        } else sfx.play('md_swish', { at: at(e), gain: 0.9, ref: 6, rate: 0.6 });
        if (!m.held) m.t = 2.05;   // a miss: straight to the recovery
      } else if (ev === 'hit') {
        e.charge = 0; const r = strikePlayer(e, HIT.punch); sfx.play(r === 'hit' ? 'md_thud' : 'md_swish', { at: at(e), gain: 1, ref: 7, rate: 0.7 });
      } else if (ev === 'open') { m.open = true; } else if (ev === 'close') { m.open = false; }
    });
    // the hook rolls into the shoulder charge
    if (done && m.name === 'rampart' && m.move === null && !m.chained) { m.chained = true; start(e, 'hcharge', 0.4); ui.call(T.melee.moves.rampart, false, T.melee.heavy); sfx.play('md_roar', { at: at(e, 1.8), gain: 1.1, ref: 10 }); }
    else if (done) m.chained = false;
    turn(e, m.face, dt, m.t < m.lockAt ? 7 : 1.2);
  }
  function leap(e, dt) {
    const m = e.mm, p = player.feet;
    m.lt = (m.lt || 0) + dt * (m.speed || 1);
    if (!m.perchAt) {   // pick the perch nearest the player's side that is not under it
      const c = perches.filter((q) => Math.hypot(q[0] - e.pos[0], q[2] - e.pos[2]) < 18);
      m.perchAt = (c.length ? c : perches)[Math.floor(R() * Math.max(1, (c.length ? c : perches).length))] || [e.pos[0], e.pos[1] + 2.5, e.pos[2]];
      m.from = e.pos.slice(); m.phase2 = 0; sfx.play('md_wind', { at: at(e), gain: 1, ref: 10, rate: 0.6 });
    }
    const t = m.lt, U = 0.32, UP = 0.6, WAIT = 0.9 / (m.speed || 1), DOWN = 0.55;
    if (t < U) { m.move = 'hjump'; m.t = t; }
    else if (t < U + UP) {   // up
      const u = (t - U) / UP, a = m.from, b = m.perchAt;
      e.pos = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + 3 * Math.sin(Math.PI * u), a[2] + (b[2] - a[2]) * u];
      m.move = 'hjump'; m.t = 0.45 + u * 0.5; m.perch = e.pos;
    } else if (t < U + UP + WAIT) {   // on the perch, watching
      e.pos = m.perchAt.slice(); m.perch = e.pos; m.move = 'hperch'; m.t = 0; m.face = p.slice();
      if (!m.land) { m.land = nav().nearest(p, { snap: 2 }) || p.slice(); }
      if (t > U + UP + WAIT - 0.3) m.land = m.land || p.slice();
      if (t > U + UP + WAIT - 0.02 && !m.called) { m.called = true; ui.call(T.melee.moves.cityfall, false, T.melee.heavy); sfx.play('md_roar', { at: at(e, 1.8), gain: 1.2, ref: 12 }); m.land = nav().nearest(p, { snap: 2 }) || p.slice(); }
    } else if (t < U + UP + WAIT + DOWN) {   // down at the ring
      const u = (t - U - UP - WAIT) / DOWN, a = m.perchAt, b = m.land;
      ring.visible = true; ring.position.set(b[0], b[1] + 0.03, b[2]); ring.material.opacity = 0.35 + 0.4 * u;
      e.pos = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + 2 * Math.sin(Math.PI * u), a[2] + (b[2] - a[2]) * u];
      m.perch = e.pos; m.move = 'hjump'; m.t = 0.95;
    } else {   // the landing: a crack, a shockwave
      ring.visible = false; m.perch = null; place(e, m.land); m.rest = m.rest ?? 0;
      if (!m.landed) {
        m.landed = true; flag('heavyLandings');
        vfx.decal({ position: [e.pos[0], e.pos[1] + 0.2, e.pos[2]], normal: [0, 1, 0], size: 4.2, depth: 0.6, pattern: 'crack', life: 30, fade: 6, opacity: 0.95 });
        for (let i = 0; i < 8; i++) { const a = i * 0.785; vfx.burst(MFX.rubble, [e.pos[0] + Math.cos(a) * 1.6, e.pos[1] + 0.05, e.pos[2] + Math.sin(a) * 1.6], { direction: [Math.cos(a), 0.8, Math.sin(a)], scale: 1.2 }); }
        vfx.burst(FX.impact, [e.pos[0], e.pos[1] + 0.1, e.pos[2]], { direction: [0, 1, 0], scale: 3 });
        sfx.play('md_rumble', { at: e.pos, gain: 1.4, ref: 14, rate: 0.7 }); player.shake?.(2);
        const dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz);
        if (d < 4.5 && Math.abs(p[1] - e.pos[1]) < 1.5) {
          if (player.body && !player.body.onGround && p[1] - e.pos[1] > 0.25) flag('meleeJumps');
          else if (hurt(26 * (1 - d / 6), e.pos)) launch(d > 0.1 ? dx / d : 1, d > 0.1 ? dz / d : 0, 7, 4);
        }
      }
      m.move = 'hland'; m.t = t - (U + UP + WAIT + DOWN);
      if (m.t > 1.2) { m.move = null; m.name = null; m.lt = 0; m.perchAt = null; m.land = null; m.landed = false; m.called = false; e.charge = 0; return true; }
    }
    return false;
  }
  function stagger(e) { const m = e.mm; m.posture = 0; m.held = false; start(e, 'hstagger', 0); m.name = 'stagger'; flag('heavyStaggers'); sfx.play('md_clang', { at: at(e, 1.6), gain: 1.2, ref: 10, rate: 0.6 }); }

  function think(e, dt) {
    const m = e.mm;
    m.cd ||= {}; for (const k in m.cd) m.cd[k] = Math.max(0, m.cd[k] - dt);
    if (!X.boss.ngRun) { if (!e.dead) X.park(e); return; }
    const p = player.feet, here = X.boss.inArena(p) && !player.dead;
    if (!m.awake) { e.state = 'post'; turn(e, null, dt, 1); if (!here) return; m.awake = true; m.gap = 1.0; game.set('heavyAwake', true); on.radio('heavy'); X.boss.entity && on.say(X.boss.entity, T.melee.lines.heavy); }
    const frac = e.hp / e.maxHp; m.speed = frac > 0.66 ? 1 : frac > 0.33 ? 1.18 : 1.36;
    if (m.move) { run(e, dt); return; }
    ring.visible = false;
    if (!here) { e.state = 'post'; if (Math.hypot(e.pos[0] - e.home[0], e.pos[2] - e.home[2]) > 1 && (e.agent.arrived || !e.agent.path)) { e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = 2.5; e.agent.setGoal(e.home); } turn(e, null, dt, 3); return; }
    e.state = 'fight'; e.seenT = game.time; e.lastSeen = p.slice();
    const dist = Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]);
    if ((m.gap -= dt) <= 0) {
      const c = [];
      const ok = (n, a, b, w) => { if (dist >= a && dist <= b && !(m.cd[n] > 0)) for (let i = 0; i < w; i++) c.push(n); };
      ok('embrace', 0, 3, 2); ok('rampart', 0, 3.5, 3); ok('railslide', 5, 18, 3); ok('cityfall', 5, 20, perches.length ? 1 : 0);
      if (nav().visible(e.pos, p)) { ok('breachcannon', 6, 30, 2); ok('houndswarm', 5, 24, 2); }
      ok('hornetsalvo', 5, 26, 1 + (m.speed > 1.1 ? 1 : 0));
      if (c.length) { begin(e, c[Math.floor(R() * c.length)]); m.gap = (1.1 + R() * 0.6) / m.speed; return; }
    }
    // between moves: a heavy walk in, circling
    if ((e.shift -= dt) <= 0 || e.agent.arrived) {
      e.shift = 0.6 + R() * 0.4;
      const a = Math.atan2(e.pos[2] - p[2], e.pos[0] - p[0]) + (R() < 0.5 ? 0.6 : -0.6), r = dist > 9 ? 5 : 7;
      e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed * m.speed;
      const g = nav().nearest([p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], { snap: 2 }); if (g) e.agent.setGoal(g);
    }
    turn(e, p, dt, 5);
  }
  const ventW = new THREE.Vector3();
  /** a hit: the armour, the vents, the posture */
  function guard(e, amount, head, point, dir, hit) {
    const m = e.mm, B = e.rig.bones;
    if (!X.boss.ngRun) return 1;
    let vent = false;
    for (const c of VENTS) { B.Chest.localToWorld(ventW.set(...c)); if (ventW.distanceTo(v2.set(...point)) < 0.3 * e.K.scale) { vent = true; break; } }
    const heavyHit = hit?.splash || hit?.melee || hit?.ally;
    if (heavyHit) { m.posture = (m.posture || 0) + (hit.posture || (hit.splash ? 35 : 25)); if (m.posture >= 100 && m.move !== 'hstagger' && !m.perch) { if (hit?.ally) flag('allyStaggers'); m.move = null; ring.visible = false; m.lt = 0; m.perchAt = null; stagger(e); } }
    if (vent) { flag('ventHits'); vfx.burst(MFX.clash, point, { direction: [-dir[0], 0.4, -dir[2]], scale: 1 }); }
    else if (!heavyHit && game.time - (m.tinkT || -1) > 0.08) { m.tinkT = game.time; vfx.burst(FX.impact, point, { direction: [-dir[0], -dir[1] + 0.3, -dir[2]], scale: 0.7 }); sfx.play('nd_imp_armour', { at: point, gain: 0.6, ref: 5 }); }
    const k = (vent ? 2.5 : heavyHit ? 1 : 0.25) * (m.open ? (vent ? 1.2 : 1.6) : 1);
    if (e.hp - amount * k <= 0 && !m.boom) { m.boom = true; on.radio('heavyDown'); game.set('bulwarkDown', true); for (let i = 0; i < 4; i++) setTimeout(() => vfx.burst(FX.explosion, [e.pos[0] + (R() - 0.5) * 2, e.pos[1] + 1 + R() * 1.5, e.pos[2] + (R() - 0.5) * 2], { scale: 0.7 }), i * 160); }
    return k;
  }
  // rounds and rockets in flight (real time, the slow beat applied)
  function tick(dt) {
    const e = heavy(); if (!e) return;
    const k = dt * X.S.slow, p = player.feet, pc = chest(p);
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; s.t += k;
      // bend toward the player: up to 1.1 rad/s
      const sp = Math.hypot(...s.v), want = [pc[0] - s.p[0], pc[1] - s.p[1], pc[2] - s.p[2]], wl = Math.hypot(...want) || 1;
      for (let j = 0; j < 3; j++) s.v[j] += (want[j] / wl * sp - s.v[j]) * Math.min(1, 1.1 * k);
      const step = sp * k, dir = s.v.map((x) => x / sp), w = physics.ray(s.p, dir, step, player.collider());
      const np = w ? w.point : s.p.map((x, j) => x + dir[j] * step);
      vfx.beam({ from: s.p, to: np, width: 0.035, color: '#ffa040', intensity: 6, life: 0.06 });
      const near = Math.hypot(np[0] - pc[0], np[1] - pc[1], np[2] - pc[2]) < 0.55;
      if (near) { hurt(3, s.p); shots.splice(i, 1); continue; }
      if (w || s.t > 1.6) { if (w) vfx.burst(FX.impact, w.point, { direction: [-dir[0], -dir[1], -dir[2]] }); shots.splice(i, 1); continue; }
      s.p = np;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]; r.t += k;
      if (r.t < 0) continue;
      if (!r.marked) { r.marked = true; glint([r.to[0], r.to[1] + 0.15, r.to[2]], 0.9); }
      const u = Math.min(1, r.t / r.len), a = r.from, b = r.to, h = 6;
      const pos = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + h * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3), a[2] + (b[2] - a[2]) * u];
      if (r.last) vfx.beam({ from: r.last, to: pos, width: 0.05, color: '#ffd0a0', intensity: 5, life: 0.25 });
      r.last = pos;
      if (u >= 1) {
        vfx.burst(FX.explosion, b, { scale: 0.45 }); sfx.play('nd_rkt_boom_open', { at: b, gain: 0.6, ref: 8, rate: 1.3 });
        const d = Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]);
        if (d < 2.2 && hurt(12 * (1 - d / 3), b)) launch((p[0] - b[0]) / (d || 1), (p[2] - b[2]) / (d || 1), 4, 2.5);
        rockets.splice(i, 1);
      }
    }
    const m = e.mm, show = X.boss.ngRun && m.awake && !e.dead && Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]) < 45;
    api.barOn = show;
    if (show) ui.bar({ name: T.melee.heavy, frac: e.hp / e.maxHp, marks: [0.66, 0.33], note: m.move === 'hstagger' || m.open ? T.melee.open : T.melee.armour });
  }
  const force = (name) => { const e = heavy(); e.mm.awake = true; e.mm.cd ||= {}; e.mm.lt = 0; e.mm.perchAt = null; begin(e, name); };
  const api = { force, think, guard, tick, barOn: false, shots, rockets, get entity() { return heavy(); }, VENTS };
  return api;
}

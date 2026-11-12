// What makes the sentinels read as machines, not soldiers: small state machines and bone offsets on top of their
// clips (enemies.js hooks them in a few lines; the rig clips are the cyber kit's behaviourClips()).
//   repair    at its post, now and then: it stops, a forearm panel swings open over a lit board, the joint jitters
//             like a servo being trimmed, sparks; then it carries on
//   glitch    at its post, now and then: a pose loops and stutters (the animator's state replayed), or the free arm
//             goes limp and swings, then snaps back
//   sync      one is hit: every other within 14 m freezes on the same frame for 0.4 s, then all turn their heads to
//             the player at once (the street's civilians too: machines.userData.sync)
//   crawl     a leg hit that leaves it under 60 % (one in two; not the shield carrier): the shin is gone, sparks, and it crawls
//             on its arms after the player and keeps shooting
//   scavenge  three in five that fall stay down (up to 25 s) until one of their kind, at its post or searching with the
//             player unseen for 3 s, comes within 14 m: it walks over, kneels, pulls the head off and carries it away
//   inhuman   searching with the player behind it: the trunk turns 180° and it walks on backwards; noticing
//             something, the head locks onto it while the body turns slowly round; a rebooted one gets up the wrong way
//   scan      seeing the player from its post: before it aggros, the head tilts in steps like a lens focusing and a
//             laser grid sweeps over the player (1.2 s)
//   reboot    one in eight that falls (not a wave's, never the last of its zone): its eyes come back on and it gets
//             up. The kill was counted when it fell and is not counted again
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { solveLookAt } from '@miragekit/play';
import { robotMaterials, part, mergeParts, tf, COL } from '@miragekit/assets/kits/cyber';
import { FX } from './fx.js';

// the animator's extra states and layer (enemies.js spreads them into its own)
export const STATES = { crawl: { clip: 'crawl', speedParam: 'rate' }, kneel: { clip: 'kneel' }, rise: { clip: 'rise', loop: false } };
export const TRANSITIONS = [{ from: 'rise', to: 'move', exitTime: 0.95, duration: 0.3 }];
export const LAYER = { name: 'act', mask: ['Spine'], weight: 0, start: 'repair', states: { repair: { clip: 'repair' } } };
/** a crawler's hit volumes: [height, radius, head, forward] */
export const CRAWL_HIT = [[0.3, 0.26, false, -0.25], [0.32, 0.24, false, 0.2], [0.42, 0.14, true, 0.62]];

const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3();
const turn = (b, ax, a) => { if (a) b.quaternion.premultiply(_q.setFromAxisAngle(ax, a)); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const env = (t, d, a = 0.4) => Math.max(0, Math.min(1, t / a, (d - t) / a));
const HANG = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.45)), ONE = new THREE.Quaternion();
const TILT = [0.32, 0.32, -0.14, -0.14, 0.24, 0.24, 0.06, 0.06];   // the lens focusing: steps, not a sway
const LEN = { repair: 4.2, loop: 1.4, limp: 2.2 };

/** en: { list, player, game, vfx, sfx, R, alert, nav(), crowd(), shellOf, plain, glow (per kind), rim, onDispose } */
export function createBehaviours(world, en) {
  const { list, player, game, vfx, sfx, R } = en, eyeAt = new THREE.Vector3();
  const kk = (e) => e.def.kind || 'grunt';
  const machines = () => world.scene.getObjectByName('machines')?.userData;
  // the eyes off: a shell whose lights are dark (one for every kind), swapped in while it lies dead
  const deadShell = robotMaterials(world, { rim: en.rim, key: 'enemies-dead', glow: { value: new THREE.Color(0, 0, 0) } }).shell;
  const eyes = (e, on) => { for (const set of e.sets) for (const m of set) if (m.name === 'robot-s') m.material = on ? en.shellOf[kk(e)] : deadShell; };
  // ---- the laser grid: two fans of beams from the scanner's eye, one sweeping the player head to foot, one across
  const fan = (() => { const p = []; for (let i = 0; i < 9; i++) { const x = -0.5 + i / 8; p.push(0, 0, 0, x - 0.012, 0, 1, x + 0.012, 0, 1); } return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); })();
  const laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.06, 0.03).multiplyScalar(5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fans = [fan, fan.clone().rotateZ(Math.PI / 2)].map((g) => {
    const m = new THREE.Mesh(g, laserMat); m.visible = false; m.frustumCulled = false; m.userData.occlude = false; m.userData.collide = false; m.castShadow = false;
    world.scene.add(m); en.onDispose(() => m.removeFromParent()); return m;
  });
  // ---- parts made when first needed: a forearm panel (a lid on a hinge over a lit board), a pulled-off head
  const lidGeo = mergeParts([part(new THREE.BoxGeometry(0.15, 0.012, 0.075).translate(0, 0, -0.0375), 's', COL.pale)]);
  const boardGeo = mergeParts([part(new THREE.BoxGeometry(0.11, 0.008, 0.05), 'l', [1, 1, 1])]);
  const headGeo = mergeParts([part(new RoundedBoxGeometry(0.2, 0.22, 0.23, 2, 0.05), 's', COL.carbon), part(tf(new THREE.BoxGeometry(0.16, 0.04, 0.02), [0, 0.03, 0.115]), 's', COL.glass),
    part(tf(new THREE.CylinderGeometry(0.012, 0.008, 0.16, 5), [0.03, -0.18, 0], [0, 0, 0.3]), 's', COL.joint)]);
  function panelOf(e) {
    if (e.panel) return e.panel;
    const g = new THREE.Group(), lid = new THREE.Mesh(lidGeo, en.plain.shell), board = new THREE.Mesh(boardGeo, en.glow[kk(e)]);
    g.add(lid); g.position.set(0.14, 0.05, 0.0375); board.position.set(0.14, 0.046, 0);
    const o = new THREE.Group(); o.add(g, board); o.userData.lid = g; e.rig.bones.LeftForeArm.add(o);
    return (e.panel = o);
  }
  function headOf(e) {
    if (!e.trophy) { e.trophy = new THREE.Mesh(headGeo, en.plain.shell); e.trophy.position.set(0.1, -0.13, 0); e.trophy.castShadow = true; e.rig.bones.LeftHand.add(e.trophy); }
    return e.trophy;
  }
  const spark = (p, s = 0.6) => vfx.burst(FX.hit, [p.x, p.y, p.z], { direction: [0, 1, 0], scale: s });

  /** build(): after the robot's own post hook */
  function attach(e) { e.mo.spin = 0; e.n = list.indexOf(e); e.anim.post.push(() => post(e)); }
  // ---- after the clips, the foot solver and the look: the offsets that are the behaviours
  function post(e) {
    if (e.dead && !e.reboot) return;
    const B = e.rig.bones, a = e.act, m = e.mo;
    if (m.spin > 0.01) { turn(B.Spine, UP, Math.PI * 0.45 * m.spin); turn(B.Chest, UP, Math.PI * 0.55 * m.spin); }
    if (a?.kind === 'repair') {
      const op = env(a.t - 0.5, 3.2, 0.3);
      panelOf(e).userData.lid.rotation.x = -1.9 * op;
      if (a.t > 1.1 && a.t < 3.3) { const j = Math.floor(game.time * 24) + e.n * 13; turn(B.LeftForeArm, XA, 0.16 * (hash(j) - 0.5)); turn(B.LeftHand, ZA, 0.3 * (hash(j + 5) - 0.5)); turn(B.Head, ZA, 0.08 * (hash(j + 9) - 0.5)); }
    } else if (a?.kind === 'limp') {
      const w = a.t < LEN.limp - 0.12 ? Math.min(1, a.t / 0.15) : 0, sw = Math.sin(a.t * 3.4) * Math.exp(-a.t * 0.8);
      B.LeftArm.quaternion.slerp(HANG, w); turn(B.LeftArm, XA, 0.4 * sw * w); B.LeftForeArm.quaternion.slerp(ONE, w); turn(B.Neck, ZA, -0.45 * w);
    }
    if (e.state === 'scan') turn(B.Head, ZA, TILT[Math.floor(e.t * 7) % TILT.length]);
    // a head that locks on: the stare after a sync (the player), noticing something (the head first, the body after)
    const look = e.stareT > game.time ? player.feet : e.state === 'alert' && e.lastSeen ? e.lastSeen : null;
    if (look && !e.dead) solveLookAt([B.Neck, B.Head], eyeAt.set(look[0], look[1] + (look === player.feet ? player.height : 1.4), look[2]), { share: [0.35, 0.65], limit: 2.4 });
  }

  // ---- the step's thinking (enemies.js think, after a stun or a stagger): true when a behaviour took the step
  function think(e, dt) {
    if (e.dog) return false;
    const m = e.mo, p = player.feet, dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], d = Math.hypot(dx, dz);
    const behind = e.forceSpin || (e.state === 'search' && e.speed > 0.4 && d < 22 && (dx * e.heading[0] + dz * e.heading[1]) / (d || 1) < -0.3);
    m.spin += ((behind ? 1 : 0) - m.spin) * Math.min(1, dt * 5);
    if (e.legless) e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = 0.9;
    if (e.act && e.state !== 'post') end(e);
    // scavenging: at its post or searching, the player unseen for 3 s, a fallen one of its kind within 14 m
    if (!e.act && !e.legless && !e.drill && (e.state === 'post' || e.state === 'search') && game.time - e.seenT > 3) {
      let c = null, bd = 14;
      for (const o of list) { if (!o.dead || !o.scav || o.dog || !o.rig.root.visible || o.deadT < 1) continue; const dd = Math.hypot(o.pos[0] - e.pos[0], o.pos[2] - e.pos[2]); if (dd < bd && Math.abs(o.pos[1] - e.pos[1]) < 2) { bd = dd; c = o; } }
      if (c) {
        e.state = 'post'; e.t = 0; start(e, 'scavenge'); Object.assign(e.act, { corpse: c, phase: 'go' }); c.held = true; c.scav = false;
        const l = bd || 1, at = [c.pos[0] + (e.pos[0] - c.pos[0]) / l * 0.85, c.pos[1], c.pos[2] + (e.pos[2] - c.pos[2]) / l * 0.85];
        e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = 1.4;
        e.agent.setGoal(en.nav().nearest(at, { snap: 2 }) || at);
      }
    }
    if (e.syncT > game.time) { e.agent.stop(); return true; }
    if (e.rise > 0) { e.rise -= dt; e.agent.stop(); e.aim = 0; if (e.rise <= 0) en.alert(e, p); return true; }
    if (e.state === 'scan') {
      e.agent.stop(); e.aim += (0 - e.aim) * Math.min(1, dt * 7);
      const w = Math.atan2(dx, dz), dd = Math.atan2(Math.sin(w - e.yaw), Math.cos(w - e.yaw));
      e.yaw += dd * Math.min(1, dt * 2.5); e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw);
      if (e.t > 1.2) { e.state = 'post'; en.alert(e, p); for (const o of list) if (o !== e && o.def.zone === e.def.zone) en.alert(o, p, 0.5 + R() * 0.6); }
      return true;
    }
    return false;
  }
  /** at its post the player came into sight: a biped scans first. True: scanning */
  function spot(e) {
    if (e.dog || e.legless || e.drill || e.K?.boss) return false;   // drill targets and bosses go straight in
    end(e); e.state = 'scan'; e.t = 0; e.agent.stop();
    sfx.play('nd_charge', { at: [e.pos[0], e.pos[1] + 1.6, e.pos[2]], gain: 0.6, ref: 6, rate: 1.7 });
    return true;
  }
  /** at its post, nobody in sight: an act now and then, or the one under way. True: busy (no patrol this step) */
  function idle(e, dt) {
    if (e.dog || e.legless) return false;
    let a = e.act;
    if (!a) {
      if (e.drill || e.revived || e.def.zone === 'wave') return false;
      if (e.speed < 0.2 && (!e.def.patrol || e.agent.arrived || !e.agent.path)) e.idleT = (e.idleT || 0) + dt;
      if ((e.idleT || 0) < (e.nextAct ??= 8 + R() * 20)) return false;
      const r = R(); start(e, r < 0.45 ? 'repair' : r < 0.7 ? 'loop' : 'limp');
      a = e.act;
    }
    a.t += dt;
    if (a.kind === 'scavenge') return scavenge(e, a, dt);
    e.agent.stop();
    if (a.kind === 'repair') {
      e.anim.setLayerWeight('act', env(a.t, LEN.repair));
      if ((a.t > 1.4 && a.t - dt <= 1.4) || (a.t > 2.5 && a.t - dt <= 2.5)) { e.panel.getWorldPosition(_v); spark(_v, 0.35); sfx.play('nd_hit', { at: _v.toArray(), gain: 0.35, ref: 3, rate: 1.8 }); }
    } else if (a.kind === 'loop' && a.t > 0.25 && (a.t % 0.2) < dt) e.anim.restore(a.snap);   // the same fifth of a second again
    if (a.t > LEN[a.kind]) end(e);
    return true;
  }
  function start(e, kind) {
    end(e);
    e.act = { kind, t: 0 }; e.idleT = 0; e.nextAct = 15 + R() * 25;
    if (kind === 'repair') { panelOf(e).visible = true; sfx.play('nd_charge', { at: [e.pos[0], e.pos[1] + 1.2, e.pos[2]], gain: 0.4, ref: 4, rate: 2.2 }); }
    if (kind === 'loop') e.act.snap = e.anim.snapshot();
  }
  function end(e) {
    const a = e.act; if (!a) return;
    e.act = null;
    if (a.kind === 'repair') { e.anim.setLayerWeight('act', 0); if (e.panel) e.panel.visible = false; }
    if (a.kind === 'scavenge') { if (a.corpse) a.corpse.held = false; if (a.phase === 'pull') e.anim.play('move', { duration: 0.3 }); }
  }
  // walk over to the fallen one, kneel, pull its head off, carry it away
  function scavenge(e, a, dt) {
    const c = a.corpse, nav = en.nav();
    if (a.phase !== 'leave' && (!c.dead || !c.rig.root.visible)) { end(e); return false; }
    const d = Math.hypot(c.pos[0] - e.pos[0], c.pos[2] - e.pos[2]);
    if (a.phase === 'go') {
      if (d < 1.15 || (a.t > 1 && (e.agent.arrived || !e.agent.path))) {
        if (d > 2) { end(e); return false; }
        a.phase = 'pull'; a.t = 0; e.agent.stop(); e.anim.play('kneel', { duration: 0.4 });
      }
      if (a.t > 14) end(e);
      return true;
    }
    if (a.phase === 'pull') {
      e.agent.stop(); e.yaw = Math.atan2(c.pos[0] - e.pos[0], c.pos[2] - e.pos[2]); e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw);
      if (a.t > 1.5 && !a.took) {
        a.took = true; c.rig.bones.Head.scale.setScalar(0.001); c.boneV++;
        headOf(e).visible = true; c.rig.bones.Neck.getWorldPosition(_v); spark(_v, 0.9);
        sfx.play('nd_shatter', { at: _v.toArray(), gain: 0.5, ref: 4, rate: 1.4 });
      }
      if (a.t > 2.6) {
        a.phase = 'leave'; a.t = 0; c.held = false; e.anim.play('move', { duration: 0.4 });
        const away = [e.pos[0] + (e.pos[0] - c.pos[0]) * 6, e.pos[1], e.pos[2] + (e.pos[2] - c.pos[2]) * 6];
        e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = 1.3;
        e.agent.setGoal(nav.nearest(away, { snap: 3 }) || e.home);
      }
      return true;
    }
    if (e.agent.arrived || !e.agent.path || a.t > 10) end(e);
    return true;
  }

  // ---- hits, falls, the dead
  /** after a hit's damage (before the death check) */
  function hit(e, head, point) {
    if (e.dog) return;
    for (const o of list) {
      if (o === e || o.dog || o.dead || !o.active || !o.rig.root.visible || o.syncCool > game.time || Math.hypot(o.pos[0] - e.pos[0], o.pos[2] - e.pos[2]) > 14) continue;
      o.syncT = game.time + 0.4; o.syncCool = game.time + 6; o.stareT = game.time + 2;
    }
    machines()?.sync?.(e.pos, 12, 0.4);
    const legs = !head && (point[1] - e.pos[1]) / e.K.scale < 0.95;
    if (legs && !e.legless && !e.shield && e.hp > 0 && e.hp < e.maxHp * 0.6 && R() < 0.5) {
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      loseLeg(e, (point[0] - e.pos[0]) * c - (point[2] - e.pos[2]) * s > 0 ? 'Left' : 'Right');
    }
  }
  function loseLeg(e, S) {
    end(e);
    e.legless = S; e.stagger = 0; e.mo.hipYaw = 0;
    const B = e.rig.bones; B[S + 'Leg'].getWorldPosition(_v); B[S + 'Leg'].scale.setScalar(0.001);
    spark(_v, 1.3); vfx.burst(FX.down, [_v.x, _v.y, _v.z]); sfx.play('nd_shatter', { at: _v.toArray(), gain: 0.8, ref: 5, rate: 0.8 });
    e.anim.play('crawl', { duration: 0.45 });
  }
  /** the fall: a crawler stays down as it lay (its crawl frozen). True: handled */
  function fall(e) {
    eyes(e, false);
    if (!e.legless) return false;
    e.anim.set('rate', 0); e.fallTw = 0; e.fallYaw = e.yaw; e.fallLen = 0.6; e.lift = 0; e.sparked = 0; e.mo.hit = null;
    return true;
  }
  /** a death: whether it counts as a kill (only the first time); a reboot maybe; a scavenger maybe */
  function killed(e) {
    if (e.dog) return true;
    const first = !e.counted; e.counted = true;
    end(e);
    const kin = list.filter((o) => o !== e && !o.dead && o.active && !o.dog && o.def.zone === e.def.zone);
    if (first && kin.length && !e.drill && !e.revived && e.def.zone !== 'wave' && !game.flags.holdout && (e.forceReboot || R() < 0.125)) { e.reboot = 2.8 + R() * 1.3; return first; }
    e.scav = !!(e.forceScavenge || R() < 0.6); e.scavT = 0;   // a part for whoever of its kind comes by once the shooting stops
    return first;
  }
  /** a dead one's step (before it fades): kept (up to 25 s) for a scavenger; a reboot's flicker and rise. True: up again */
  function dead(e, dt) {
    if (e.dog) return false;
    e.scavT = (e.scavT || 0) + dt;
    if ((e.held || (e.scav && e.scavT < 25)) && e.deadT > 6.5) e.deadT = 6.5;
    if (!e.reboot || e.deadT < e.reboot) return false;
    const k = e.deadT - e.reboot;
    eyes(e, k > 0.9 || hash(Math.floor(game.time * 14) + e.n) > 0.55);
    if (!e.flickered) { e.flickered = true; e.rig.bones.Head.getWorldPosition(_v); spark(_v, 0.5); sfx.play('nd_charge', { at: _v.toArray(), gain: 0.7, ref: 6, rate: 0.7 }); }
    if (k < 1) return false;
    // up again: on its feet the wrong way, then back in the fight
    const r = e.rig.root;
    Object.assign(e, { reboot: 0, flickered: false, dead: false, state: 'post', deadT: 0, hp: e.maxHp * 0.4, rise: 2.7, lift: 0, burst: 0, tele: 0, stun: 0, t: 0 });
    e.yaw = r.rotation.y; e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw); r.position.y = e.pos[1];
    en.crowd().add(e.agent); e.agent.stop();
    eyes(e, true); e.anim.set('rate', 1); e.anim.play('rise', { duration: 0.35 });
    game.set('reboots', (game.flags.reboots || 0) + 1);
    return true;
  }
  /** just before the animator's step (enemies.js update): true skips it (frozen by a sync) */
  function pose(e) {
    if (e.dog) return false;
    if (e.syncT > game.time) return true;
    if (e.stareT > game.time || e.state === 'scan') e.watch = 1;
    if (e.legless) { e.anim.set('rate', Math.max(0.15, Math.min(2, e.speed / 0.55))); e.anim.setLayerWeight('aim', 0); }
    if (e.legless || e.rise > 0 || e.act?.phase === 'pull') e.mo.ik = false;
    return false;
  }
  /** the step's end: the laser grid on the nearest scanner */
  function update() {
    let s = null, sd = 1e9;
    for (const e of list) if (e.state === 'scan' && !e.dead && e.rig.root.visible) { const d = Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]); if (d < sd) { sd = d; s = e; } }
    fans[0].visible = fans[1].visible = !!s;
    if (!s) return;
    s.rig.bones.Head.getWorldPosition(_v); _v.y += 0.04;
    const p = s.scanAt || player.feet, h = player.height, u = (s.t * 1.6) % 1, side = ((s.t * 1.6 + 0.5) % 1) - 0.5;
    _w.set(p[0] - _v.x, 0, p[2] - _v.z).normalize();
    fans[0].position.copy(_v); fans[0].lookAt(_t.set(p[0], p[1] + h * (1.05 - u), p[2]));
    fans[1].position.copy(_v); fans[1].lookAt(_t.set(p[0] - _w.z * side * 1.2, p[1] + h * 0.6, p[2] + _w.x * side * 1.2));
    for (const f of fans) f.scale.set(1.1, 1.1, f.position.distanceTo(_t.set(p[0], p[1] + h * 0.6, p[2])));
  }
  /** back to rest (a checkpoint, a revive, parked) */
  function calm(e) {
    if (e.dog) return;
    end(e);
    const B = e.rig.bones;
    for (const n of ['LeftLeg', 'RightLeg', 'Head']) B[n].scale.setScalar(1);
    if (e.trophy) e.trophy.visible = false;
    Object.assign(e, { legless: null, held: false, scav: false, reboot: 0, flickered: false, rise: 0, syncT: 0, stareT: 0, counted: false, forceSpin: false, idleT: 0 });
    e.mo.spin = 0; e.anim.setLayerWeight('act', 0); e.anim.set('rate', 1);
    eyes(e, true);
  }
  /** for scripts (the behaviour strips): start one on robot e: repair | loop | limp | scan | crawl | spin | reboot | scavenge
   *  (at: where a scan's grid sweeps, instead of the player) */
  function force(e, kind, at = null) {
    e.scanAt = at;
    if (LEN[kind]) start(e, kind);
    else if (kind === 'scan') spot(e);
    else if (kind === 'crawl') { e.hp = Math.min(e.hp, e.maxHp * 0.5); loseLeg(e, 'Left'); }
    else if (kind === 'spin') e.forceSpin = true;
    else if (kind === 'reboot') e.forceReboot = true;
    else if (kind === 'scavenge') e.forceScavenge = true;
  }
  return { attach, think, spot, idle, hit, fall, killed, dead, pose, update, calm, force };
}

// The kites: small flying drones. They do not walk the navgrid: each hovers on a slow orbit round the player, a few
// metres up, stays out of solids by asking the walk grid whether a point is in the air (airAt), fires a single bolt
// when the grid gives it a line to the player (gridRay), and falls when shot. Entities with save / load, like the
// sentinels, and top-level mgDynamic objects (left out of the probe bakes; they cast no shadow, see build).
// Two jobs: a kite (`kind` absent) shoots; a mender (`kind: 'mender'`, a green eye and a ring under it) shoots nothing
// and mends damaged sentinels with a beam, keeping away from the player: kill it or hack it first.
// A hacked kite is turned (turn(e, s)): its eye goes cyan, it hunts sentinels for `s` seconds and then burns out.
import * as THREE from 'three';
import { airAt, gridRay } from '@miragekit/play';
import { FX } from './fx.js';

const EYE = { kite: [1.0, 0.55, 0.1], mender: [0.25, 1.0, 0.45], turned: [0.2, 0.9, 1.0] };

export function createDrones({ world, game, physics, plan, vfx, sfx, player, assist, onDispose, tune = { dmg: 1, hp: 1, acc: 1 } }) {
  const { mat } = world;
  const shell = mat.std({ color: new THREE.Color(0.06, 0.065, 0.08), roughness: 0.35, metalness: 0.85 });
  const list = [], byZone = {};
  let grid = null, rnd = 0x7f4a7c15;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const HP = { kite: 40, mender: 50 }, RADIUS = 0.36;
  /** hooks set by the game: env.dark(pos), on.dealt(amount), on.pop(word, pos); allies: the sentinels (enemies.js) */
  const env = { dark: () => 0 }, on = { dealt: () => {}, pop: () => {} };
  let allies = null;

  for (const def of plan.drones || []) {
    const kind = def.kind === 'mender' ? 'mender' : 'kite';
    const o = new THREE.Group(); o.name = def.id;
    const eyeMat = mat.glow(EYE[kind], 8);   // one each: a turned kite's eye changes colour
    const add = (geo, m, p = [0, 0, 0], r = [0, 0, 0], cast = false) => { const k = new THREE.Mesh(geo, m); k.position.set(...p); k.rotation.set(...r); k.castShadow = cast; k.userData.occlude = false; o.add(k); return k; };
    // the parts that never move against the body are baked into one mesh per material (the shell; the eye and its
    // ring or fin): a kite is six draws, not fifteen, in each of the passes it is drawn in. The rotors spin on their own.
    const parts = { shell: [], eye: [] };
    const bake = (k, geo, p = [0, 0, 0], r = [0, 0, 0]) => parts[k].push(geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1))));
    bake('shell', new THREE.SphereGeometry(0.2, 18, 12).scale(1, 0.72, 1.25));
    bake('eye', new THREE.SphereGeometry(0.07, 12, 8), [0, -0.03, 0.22]);
    const rotors = [];
    for (const [x, z] of [[-0.34, 0.2], [0.34, 0.2], [-0.34, -0.24], [0.34, -0.24]]) {
      bake('shell', new THREE.TorusGeometry(0.13, 0.014, 6, 20), [x, 0.03, z], [Math.PI / 2, 0, 0]);
      bake('shell', new THREE.BoxGeometry(Math.abs(x) - 0.08, 0.02, 0.03), [x / 2, 0.01, z * 0.8]);
      rotors.push(add(new THREE.BoxGeometry(0.24, 0.006, 0.02), shell, [x, 0.04, z]));
    }
    if (kind === 'mender') bake('eye', new THREE.TorusGeometry(0.16, 0.012, 6, 24), [0, -0.17, 0], [Math.PI / 2, 0, 0]);   // the mender's ring
    else bake('eye', new THREE.BoxGeometry(0.04, 0.02, 0.12), [0, -0.14, -0.05]);
    // no shadow: a 0.4 m body 5-11 m up casts a blob nobody sees, and a moving caster near a shadowed lamp redraws that
    // lamp's six shadow faces every frame (core lights.js leaves objects that cast nothing out of that)
    add(world.geom.mergeGeometries(parts.shell, false), shell, [0, 0, 0], [0, 0, 0], false);
    add(world.geom.mergeGeometries(parts.eye, false), eyeMat, [0, 0, 0], [0, 0, 0], false);
    o.userData.mgDynamic = true; o.userData.collide = false;
    o.position.set(...def.at);
    world.scene.add(o); onDispose(() => o.removeFromParent());
    const e = { id: def.id, def, kind, K: { name: kind === 'mender' ? 'mender' : 'drone', scale: 1 }, o, rotors, eyeMat, hp: HP[kind], maxHp: HP[kind], dead: false, deadT: 0, active: false, pos: def.at.slice(), vel: [0, 0, 0], yaw: 0, ang: R() * 6.28, next: 1.5 + R() * 2, tele: 0, vy: 0, seenT: -1e9,
      turned: 0, stun: 0, grip: 0, target: null, healT: 0, burnt: false };
    o.visible = def.zone !== 'wave' && def.zone !== 'reserve';
    game.add({ id: def.id, interact: { can: () => false, label: '', at: () => e.pos },
      save: () => ({ hp: e.hp, dead: e.dead, pos: e.pos.map((v) => +v.toFixed(2)), active: e.active, shown: o.visible }),
      load: (s) => { e.hp = s.hp; e.dead = s.dead; e.pos = s.pos.slice(); e.active = s.active; e.deadT = s.dead ? 99 : 0; e.tele = 0; e.vel = [0, 0, 0]; e.turned = 0; e.stun = 0; e.target = null; paint(e); o.visible = s.shown && !s.dead; o.position.set(...e.pos); o.rotation.set(0, 0, 0); } });
    list.push(e); (byZone[def.zone] ||= []).push(e);
  }
  const eyeBase = (e) => EYE[e.turned > 0 ? 'turned' : e.kind];
  const paint = (e, k = 1) => e.eyeMat.color.setRGB(...eyeBase(e)).multiplyScalar(8 * k);
  const head = [0, 0, 0];
  const sees = (e) => { head[0] = player.feet[0]; head[1] = player.feet[1] + player.height * 0.85; head[2] = player.feet[2]; return gridRay(grid, e.pos, head, 0.25) === 1; };
  const clear = (a, b) => gridRay(grid, a, b, 0.25) === 1;
  function wake(zone) { for (const e of byZone[zone] || []) if (!e.dead) { e.active = true; e.o.visible = true; } }
  function die(e) {
    e.dead = true; e.deadT = 0; e.vy = 1.5; e.turned = 0; e.target = null;
    vfx.burst(FX.down, e.pos, { scale: 0.7 });
    sfx.play('nd_death', { at: e.pos, gain: 0.8, rate: 1.5, ref: 4 });
    game.emit('kill', e);
  }
  function damage(e, amount, headShot, point, dir) {
    if (e.dead) return false;
    on.dealt(Math.min(e.hp, amount), e);
    e.hp -= amount; e.active = true;
    vfx.burst(FX.hit, point, { direction: [-dir[0], -dir[1] + 0.3, -dir[2]] });
    if (e.hp > 0) return false;
    die(e);
    return true;
  }
  /** a hack: the kite works for the player for `s` seconds, then burns out */
  function turn(e, s = 15) { if (e.dead) return false; e.turned = s; e.active = true; e.o.visible = true; e.target = null; e.next = 0.6; e.tele = 0; paint(e); return true; }
  /** an EMP: kites within r of pos drop and drift for t seconds */
  function stunAt(pos, r, t) { let n = 0; for (const e of list) if (!e.dead && e.o.visible && Math.hypot(e.pos[0] - pos[0], e.pos[1] - pos[1], e.pos[2] - pos[2]) < r) { e.stun = Math.max(e.stun, t); e.tele = 0; n++; } return n; }
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
  function rayHit(origin, dir, max) {
    let best = null;
    _o.fromArray(origin); _d.fromArray(dir);
    for (const e of list) {
      if (e.dead || !e.o.visible) continue;
      _c.fromArray(e.pos).sub(_o);
      const tc = _c.dot(_d); if (tc < 0 || tc - RADIUS > max) continue;
      const d2 = _c.lengthSq() - tc * tc; if (d2 > RADIUS * RADIUS) continue;
      const t = tc - Math.sqrt(RADIUS * RADIUS - d2);
      if (t > 0 && t < max && (!best || t < best.t)) best = { e, t, head: false, owner: api };
    }
    if (best) best.point = [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t];
    return best;
  }
  /** steer toward `want` (the orbit or the station), one axis at a time so it slides along a wall */
  function fly(e, want, dt, cap = 5.5) {
    const p = e.pos;
    for (let k = 0; k < 3; k++) { const a = (want[k] - p[k]) * 1.6 - e.vel[k] * 1.8; e.vel[k] += a * dt; }
    const sp = Math.hypot(...e.vel); if (sp > cap) for (let k = 0; k < 3; k++) e.vel[k] *= cap / sp;
    for (let k = 0; k < 3; k++) { const q = p.slice(); q[k] += e.vel[k] * dt; if (airAt(grid, q[0], q[1] - 0.3, q[2]) && airAt(grid, q[0], q[1] + 0.3, q[2])) p[k] = q[k]; else e.vel[k] *= -0.3; }
    return sp;
  }
  const chestOf = (s) => [s.pos[0], s.pos[1] + 1.25 * s.K.scale, s.pos[2]];
  /** a turned kite: hunts the nearest sentinel it can see, a bolt every 0.8 s */
  function hunt(e, dt) {
    const p = e.pos;
    if (!e.target || e.target.dead || (e.healT -= dt) <= 0) {
      e.healT = 0.8; e.target = null; let bd = 26;
      for (const s of allies?.list || []) if (!s.dead && s.active && s.rig.root.visible) { const d = Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2]); if (d < bd) { bd = d; e.target = s; } }
    }
    const s = e.target, c = s ? chestOf(s) : player.feet;
    e.ang += dt * 0.6;
    const want = s ? [c[0] + Math.cos(e.ang) * 4.5, c[1] + 2.4, c[2] + Math.sin(e.ang) * 4.5] : [player.feet[0] + Math.cos(e.ang) * 2.5, player.feet[1] + 3, player.feet[2] + Math.sin(e.ang) * 2.5];
    const sp = fly(e, want, dt, 6.5);
    e.yaw = Math.atan2(c[0] - p[0], c[2] - p[2]);
    e.o.rotation.set(Math.min(0.5, sp * 0.06), e.yaw, 0);
    if (s && (e.next -= dt) <= 0 && clear(p, c)) {
      e.next = 0.8;
      const from = [p[0] + Math.sin(e.yaw) * 0.25, p[1] - 0.05, p[2] + Math.cos(e.yaw) * 0.25], dir = [c[0] - from[0], c[1] - from[1], c[2] - from[2]], l = Math.hypot(...dir);
      vfx.beam({ from, to: c, width: 0.045, color: '#40e8ff', intensity: 7, life: 0.16 });
      sfx.play('nd_bolt', { at: from, gain: 0.6, rate: 1.7, ref: 5 });
      allies.damage(s, 16, false, c, dir.map((v) => v / l), { friendly: true, from: p.slice() });
    }
  }
  /** a mender: to the most damaged sentinel in reach, a beam that puts its health back; never near the player */
  function mend(e, dt) {
    const p = e.pos;
    if (!e.target || e.target.dead || e.target.hp >= e.target.maxHp || (e.healT -= dt) <= 0) {
      e.healT = 1; e.target = null; let worst = 0.98;
      for (const s of allies?.list || []) if (!s.dead && s.active && s.rig.root.visible && Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2]) < 28) { const k = s.hp / s.maxHp; if (k < worst) { worst = k; e.target = s; } }
    }
    e.ang += dt * 0.5;
    const s = e.target;
    let want;
    if (s) { const away = Math.atan2(s.pos[2] - player.feet[2], s.pos[0] - player.feet[0]); want = [s.pos[0] + Math.cos(away + Math.sin(e.ang) * 0.6) * 2.2, s.pos[1] + 3.1, s.pos[2] + Math.sin(away + Math.sin(e.ang) * 0.6) * 2.2]; }
    else { const r = 10 + 2 * Math.sin(e.ang); want = [player.feet[0] + Math.cos(e.ang) * r, player.feet[1] + 5, player.feet[2] + Math.sin(e.ang) * r]; }
    const sp = fly(e, want, dt, 4.5);
    const c = s ? chestOf(s) : player.feet;
    e.yaw = Math.atan2(c[0] - p[0], c[2] - p[2]);
    e.o.rotation.set(Math.min(0.4, sp * 0.05), e.yaw, 0);
    if (s && Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < 7 && clear(p, c)) {
      s.hp = Math.min(s.maxHp, s.hp + dt * 16);
      if ((e.next -= dt) <= 0) { e.next = 0.08; vfx.beam({ from: [p[0], p[1] - 0.17, p[2]], to: c, width: 0.05, color: '#50ff90', intensity: 4, life: 0.1, jitter: 0.05 }); }
      return 1;
    }
    return 0;
  }
  function update(dt) {
    if (!grid) return;
    let hot = 0;
    for (const e of list) {
      if (!e.o.visible) continue;
      const p = e.pos;
      if (e.dead) {   // it drops, spinning, and lies where it lands
        e.deadT += dt;
        if (e.deadT < 6) {
          const g = grid.groundAt(p[0], p[2], p[1]);
          if (!Number.isNaN(g) && p[1] > g + 0.16) { e.vy -= 9.8 * dt; p[1] = Math.max(g + 0.15, p[1] + e.vy * dt); e.o.rotation.x += dt * 5; e.o.rotation.z += dt * 3; }
        } else if (e.deadT > 7) e.o.visible = false;
        e.o.position.set(p[0], p[1], p[2]);
        continue;
      }
      for (const r of e.rotors) r.rotation.y += dt * (e.stun > 0 ? 8 : 60);
      if (e.grip > 0) { e.grip -= dt; e.vel = [0, 0, 0]; e.tele = 0; paint(e, Math.sin(game.time * 30) > 0 ? 1.5 : 0.4); continue; }   // a hack has hold of it: it hangs where it is
      if (e.stun > 0) {   // stunned: it sags and drifts, its eye stutters
        e.stun -= dt; e.vel[1] = -0.4;
        fly(e, [p[0], p[1] - 0.4, p[2]], dt, 1); e.o.position.set(p[0], p[1], p[2]); e.o.rotation.z = Math.sin(game.time * 9) * 0.3;
        paint(e, Math.sin(game.time * 25) > 0 ? 1 : 0.1);
        continue;
      }
      if (e.turned > 0) {   // working for the player until it burns out
        e.turned -= dt;
        hunt(e, dt); e.o.position.set(p[0], p[1], p[2]);
        paint(e, e.turned < 3 ? (Math.sin(game.time * 30) > 0 ? 1.4 : 0.3) : 1);
        if (e.turned <= 0) { e.burnt = true; vfx.burst(FX.sparks, p, { scale: 0.6 }); die(e); }
        continue;
      }
      const dx = player.feet[0] - p[0], dz = player.feet[2] - p[2], dist = Math.hypot(dx, dz), reach = 1 - 0.6 * env.dark(player.feet);
      if (!e.active) { if (dist < 24 * reach && !player.dead && sees(e)) e.active = true; else { e.o.position.y = p[1] + Math.sin(game.time * 1.3 + e.ang) * 0.06; continue; } }
      if (e.kind === 'mender') { mend(e, dt); e.o.position.set(p[0], p[1], p[2]); paint(e, 1 + 0.5 * Math.sin(game.time * 6)); continue; }
      // the place it wants: on a slow orbit round the player, above head height
      e.ang += dt * 0.35;
      const rad = 6.5 + 2 * Math.sin(e.ang * 0.7), ground = player.feet[1];
      const sp = fly(e, [player.feet[0] + Math.cos(e.ang) * rad, ground + 3.4 + Math.sin(e.ang * 1.3) * 0.5, player.feet[2] + Math.sin(e.ang) * rad], dt);
      e.yaw = Math.atan2(dx, dz);
      e.o.position.set(p[0], p[1], p[2]); e.o.rotation.set(Math.min(0.5, sp * 0.06), e.yaw, 0);
      // one bolt at a time, after the eye flares
      const can = !player.dead && dist < 22 * reach && sees(e);
      if (e.tele > 0) {
        hot = 1;
        if ((e.tele -= dt) <= 0) {
          const from = [p[0] + Math.sin(e.yaw) * 0.25, p[1] - 0.05, p[2] + Math.cos(e.yaw) * 0.25], to = [player.feet[0], player.feet[1] + player.height * 0.7, player.feet[2]];
          const hit = can && !(player.iframe > game.time) && R() < reach * Math.min(0.6 + 0.15 * (tune.acc - 1), tune.acc * (0.5 - dist * 0.012) * (player.speed > 2.5 ? 0.6 : 1) * (0.4 + 0.6 * Math.min(1, player.exposed / 2.5)));
          if (!hit) { to[0] += (R() - 0.5) * 2.4; to[1] -= 0.6 + R(); to[2] += (R() - 0.5) * 2.4; }
          const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d) || 1, dir = d.map((v) => v / l);
          let end = to;
          if (!hit) { const w = physics.ray(from, dir, 60, player.collider()); if (w) { end = w.point; vfx.burst(FX.impact, w.point, { direction: dir.map((v) => -v) }); } }
          vfx.beam({ from, to: end, width: 0.03, color: '#ffb040', intensity: 5, life: 0.09 });
          sfx.play('nd_bolt', { at: from, gain: 0.6, rate: 1.4, ref: 5 });
          if (hit) player.hurt(5 * (assist ? 0.12 : 1) * tune.dmg, p);
          e.next = 2.2 + R() * 1.6;
        }
      } else if (can && (e.next -= dt) <= 0) e.tele = 0.5;
      paint(e, 1 + 2.5 * (e.tele > 0 ? 1 : 0) * (0.6 + 0.4 * Math.sin(game.time * 40)));
    }
    return hot;
  }
  /** a fallen (or parked) kite in the air again at `at`, awake (the holdout's waves); hp: a factor over the difficulty's */
  function revive(e, at, hp = 1) {
    Object.assign(e, { maxHp: HP[e.kind] * tune.hp * hp, hp: HP[e.kind] * tune.hp * hp, dead: false, deadT: 0, active: true, pos: at.slice(), vel: [0, 0, 0], vy: 0, tele: 0, next: 1.5 + R() * 2, ang: R() * 6.28, turned: 0, stun: 0, target: null, burnt: false });
    paint(e); e.o.visible = true; e.o.position.set(...at); e.o.rotation.set(0, 0, 0);
    return e;
  }
  /** out of play and out of sight, counted as dead: a free slot for revive() */
  function park(e) { Object.assign(e, { dead: true, deadT: 99, active: false, tele: 0, turned: 0, stun: 0, target: null }); paint(e); e.o.visible = false; }
  function retune() { for (const e of list) { e.maxHp = HP[e.kind] * tune.hp; if (!e.dead) e.hp = e.maxHp; } }
  const api = { list, byZone, wake, damage, rayHit, update, revive, park, retune, turn, stunAt, env, on,
    start(g) { grid = g; }, set allies(a) { allies = a; }, get alive() { return list.filter((e) => !e.dead && e.active).length; } };
  return api;
}

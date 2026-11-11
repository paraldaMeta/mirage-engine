// The kites: small flying drones. They do not walk the navgrid: each hovers on a slow orbit round the player, a few
// metres up, stays out of solids by asking the walk grid whether a point is in the air (airAt), fires a single bolt
// when the grid gives it a line to the player (gridRay), and falls when shot. Entities with save / load, like the
// sentinels, and top-level mgDynamic objects so the lamps' shadow tiles follow them.
import * as THREE from 'three';
import { airAt, gridRay } from '@miragekit/play';
import { FX } from './fx.js';

export function createDrones({ world, game, physics, plan, vfx, sfx, player, assist, onDispose, tune = { dmg: 1, hp: 1, acc: 1 } }) {
  const { mat } = world;
  const shell = mat.std({ color: new THREE.Color(0.06, 0.065, 0.08), roughness: 0.35, metalness: 0.85 });
  const eyeMat = mat.glow([1.0, 0.55, 0.1], 8), eyeBase = eyeMat.color.clone();
  const list = [], byZone = {};
  let grid = null, rnd = 0x7f4a7c15;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const HP = 40, RADIUS = 0.36;

  for (const def of plan.drones || []) {
    const o = new THREE.Group(); o.name = def.id;
    const add = (geo, m, p = [0, 0, 0], r = [0, 0, 0]) => { const k = new THREE.Mesh(geo, m); k.position.set(...p); k.rotation.set(...r); k.castShadow = true; k.userData.occlude = false; o.add(k); return k; };
    add(new THREE.SphereGeometry(0.2, 18, 12).scale(1, 0.72, 1.25), shell);
    add(new THREE.SphereGeometry(0.07, 12, 8), eyeMat, [0, -0.03, 0.22]);
    const rotors = [];
    for (const [x, z] of [[-0.34, 0.2], [0.34, 0.2], [-0.34, -0.24], [0.34, -0.24]]) {
      add(new THREE.TorusGeometry(0.13, 0.014, 6, 20), shell, [x, 0.03, z], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(Math.abs(x) - 0.08, 0.02, 0.03), shell, [x / 2, 0.01, z * 0.8]);
      rotors.push(add(new THREE.BoxGeometry(0.24, 0.006, 0.02), shell, [x, 0.04, z]));
    }
    add(new THREE.BoxGeometry(0.04, 0.02, 0.12), eyeMat, [0, -0.14, -0.05]);
    o.userData.mgDynamic = true; o.userData.collide = false;
    o.position.set(...def.at);
    world.scene.add(o); onDispose(() => o.removeFromParent());
    const e = { id: def.id, def, K: { name: 'drone', scale: 1 }, o, rotors, hp: HP, dead: false, deadT: 0, active: false, pos: def.at.slice(), vel: [0, 0, 0], yaw: 0, ang: R() * 6.28, next: 1.5 + R() * 2, tele: 0, vy: 0, seenT: -1e9 };
    o.visible = def.zone !== 'wave';
    game.add({ id: def.id, interact: { can: () => false, label: '', at: () => e.pos },
      save: () => ({ hp: e.hp, dead: e.dead, pos: e.pos.map((v) => +v.toFixed(2)), active: e.active, shown: o.visible }),
      load: (s) => { e.hp = s.hp; e.dead = s.dead; e.pos = s.pos.slice(); e.active = s.active; e.deadT = s.dead ? 99 : 0; e.tele = 0; e.vel = [0, 0, 0]; o.visible = s.shown && !s.dead; o.position.set(...e.pos); o.rotation.set(0, 0, 0); } });
    list.push(e); (byZone[def.zone] ||= []).push(e);
  }
  const head = [0, 0, 0];
  const sees = (e) => { head[0] = player.feet[0]; head[1] = player.feet[1] + player.height * 0.85; head[2] = player.feet[2]; return gridRay(grid, e.pos, head, 0.25) === 1; };
  function wake(zone) { for (const e of byZone[zone] || []) if (!e.dead) { e.active = true; e.o.visible = true; } }
  function damage(e, amount, headShot, point, dir) {
    if (e.dead) return false;
    e.hp -= amount; e.active = true;
    vfx.burst(FX.hit, point, { direction: [-dir[0], -dir[1] + 0.3, -dir[2]] });
    if (e.hp > 0) return false;
    e.dead = true; e.deadT = 0; e.vy = 1.5;
    vfx.burst(FX.down, e.pos, { scale: 0.7 });
    sfx.play('nd_death', { at: e.pos, gain: 0.8, rate: 1.5, ref: 4 });
    game.emit('kill', e);
    return true;
  }
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
      const dx = player.feet[0] - p[0], dz = player.feet[2] - p[2], dist = Math.hypot(dx, dz);
      if (!e.active) { if (dist < 24 && !player.dead && sees(e)) e.active = true; else { e.o.position.y = p[1] + Math.sin(game.time * 1.3 + e.ang) * 0.06; for (const r of e.rotors) r.rotation.y += dt * 30; continue; } }
      // the place it wants: on a slow orbit round the player, above head height
      e.ang += dt * 0.35;
      const rad = 6.5 + 2 * Math.sin(e.ang * 0.7), ground = player.feet[1];
      const want = [player.feet[0] + Math.cos(e.ang) * rad, ground + 3.4 + Math.sin(e.ang * 1.3) * 0.5, player.feet[2] + Math.sin(e.ang) * rad];
      for (let k = 0; k < 3; k++) { const a = (want[k] - p[k]) * 1.6 - e.vel[k] * 1.8; e.vel[k] += a * dt; }
      const sp = Math.hypot(...e.vel), cap = 5.5; if (sp > cap) for (let k = 0; k < 3; k++) e.vel[k] *= cap / sp;
      // one axis at a time, so it slides along a wall instead of stopping at it
      for (let k = 0; k < 3; k++) { const q = p.slice(); q[k] += e.vel[k] * dt; if (airAt(grid, q[0], q[1] - 0.3, q[2]) && airAt(grid, q[0], q[1] + 0.3, q[2])) p[k] = q[k]; else e.vel[k] *= -0.3; }
      e.yaw = Math.atan2(dx, dz);
      e.o.position.set(p[0], p[1], p[2]); e.o.rotation.set(Math.min(0.5, sp * 0.06), e.yaw, 0);
      for (const r of e.rotors) r.rotation.y += dt * 60;
      // one bolt at a time, after the eye flares
      const can = !player.dead && dist < 22 && sees(e);
      if (e.tele > 0) {
        hot = 1;
        if ((e.tele -= dt) <= 0) {
          const from = [p[0] + Math.sin(e.yaw) * 0.25, p[1] - 0.05, p[2] + Math.cos(e.yaw) * 0.25], to = [player.feet[0], player.feet[1] + player.height * 0.7, player.feet[2]];
          const hit = can && R() < Math.min(0.6 + 0.15 * (tune.acc - 1), tune.acc * (0.5 - dist * 0.012) * (player.speed > 2.5 ? 0.6 : 1) * (0.4 + 0.6 * Math.min(1, player.exposed / 2.5)));
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
    }
    eyeMat.color.copy(eyeBase).multiplyScalar(1 + 2.5 * hot * (0.6 + 0.4 * Math.sin(game.time * 40)));
  }
  /** a fallen (or parked) kite in the air again at `at`, awake (the holdout's waves); hp: a factor over the difficulty's */
  function revive(e, at, hp = 1) {
    Object.assign(e, { hp: HP * tune.hp * hp, dead: false, deadT: 0, active: true, pos: at.slice(), vel: [0, 0, 0], vy: 0, tele: 0, next: 1.5 + R() * 2, ang: R() * 6.28 });
    e.o.visible = true; e.o.position.set(...at); e.o.rotation.set(0, 0, 0);
    return e;
  }
  /** out of play and out of sight, counted as dead: a free slot for revive() */
  function park(e) { Object.assign(e, { dead: true, deadT: 99, active: false, tele: 0 }); e.o.visible = false; }
  function retune() { for (const e of list) if (!e.dead) e.hp = HP * tune.hp; }
  const api = { list, byZone, wake, damage, rayHit, update, revive, park, retune, start(g) { grid = g; }, get alive() { return list.filter((e) => !e.dead && e.active).length; } };
  return api;
}

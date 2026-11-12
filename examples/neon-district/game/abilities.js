// Abilities on cooldown, and the ultimate:
//   dash       5 m the way the player is moving (forward when standing), in 0.2 s, through Rapier's character
//              controller (walls stop it); 0.35 s in which every shot misses; 5 s cooldown
//   grenade    an EMP thrown in an arc; it bursts on what it touches (or after 2.2 s, or next to a robot) and stuns
//              every robot within 5 m for 4 s; 12 s cooldown
//   overdrive  charged by damage dealt (600 points fill it), kills and hacks; when full, 8 s of robots marked
//              through walls, fire 1.7 times as fast, reloads in half the time, and hacks that cost nothing
// API (touch buttons): use('dash' | 'grenade' | 'overdrive'), left(name) (seconds of cooldown left), cooldown(name)
// (the full cooldown), charge (0..1), active (overdrive running), overLeft.
import * as THREE from 'three';
import { FXC } from './hack.js';

const CD = { dash: 5, grenade: 12 }, DASH = { len: 5, time: 0.2, grace: 0.35 }, OVER = 8;

export function createAbilities({ world, game, player, enemies, drones, vfx, sfx, physics, root, weapon, hack, overlay, onPop, opts = {} }) {
  const left = { dash: 0, grenade: 0 };
  const S = { charge: 0, over: 0, dashT: 0, dir: [0, 0], counts: { dash: 0, grenade: 0, over: 0 } };
  let g = null, play = null, input = null;
  const nade = { live: false, pos: [0, 0, 0], vel: [0, 0, 0], t: 0 };
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), world.mat.glow([0.3, 0.8, 1], 9)); ball.visible = false; ball.userData.collide = false; root.add(ball);
  const boom = new THREE.PointLight(0x80c8ff, 0, 12, 2); root.add(boom); world.lighting?.addLight(boom);
  let boomT = 0;
  const room = () => Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);
  const fwd = () => [Math.cos(play.yaw), Math.sin(play.yaw)];
  // the screen's tint on a dash or the overdrive, at the comfort's flashes (feel.js): 1 as it was, 0.6 about a third
  const tint = (k) => { const f = Number.isFinite(+opts.flashes) && opts.flashes !== undefined ? Math.max(0.2, Math.min(1, +opts.flashes)) : 1; return k * (f >= 1 ? 1 : f * f); };

  function dash() {
    const m = input ? input.move() : { x: 0, z: 0 }, f = fwd(), r = [-f[1], f[0]];
    let x = r[0] * m.x + f[0] * m.z, z = r[1] * m.x + f[1] * m.z;
    const l = Math.hypot(x, z);
    if (l < 0.2) { x = f[0]; z = f[1]; } else { x /= l; z /= l; }
    S.dir = [x, z]; S.dashT = DASH.time; player.iframe = game.time + DASH.grace;
    sfx.play('nd_dash', { gain: 0.8 }); overlay.flash('#9ff4ff', tint(0.18));
    vfx.burst(FXC.zap, [player.feet[0], player.feet[1] + 0.9, player.feet[2]], { scale: 0.7 });
    S.counts.dash++; game.set('dashes', S.counts.dash);
    return true;
  }
  function grenade() {
    const c = world.camera.position, d = world.camera.getWorldDirection(new THREE.Vector3());
    nade.live = true; nade.t = 0; nade.pos = [c.x + d.x * 0.4, c.y + d.y * 0.4 - 0.1, c.z + d.z * 0.4];
    nade.vel = [d.x * 15, d.y * 15 + 3.2, d.z * 15];
    ball.visible = true; sfx.play('nd_throw', { gain: 0.7 });
    return true;
  }
  function burst(p) {
    nade.live = false; ball.visible = false;
    const n = enemies.stunAt(p, 5, 4) + drones.stunAt(p, 5, 4);
    vfx.burst(FXC.emp, p); boom.position.set(...p); boomT = 0.3;
    sfx.play('nd_emp', { at: p, gain: 1, ref: 8 }); onPop('emp', [p[0], p[1] + 0.8, p[2]]);
    S.counts.grenade++; game.set('emps', S.counts.grenade); game.set('empStunned', (game.flags.empStunned || 0) + n);
  }
  function overdrive() {
    S.charge = 0; S.over = OVER; weapon.S.boost = true; hack.free = true;
    sfx.play('nd_overdrive', { gain: 0.9 }); overlay.flash('#ff6ac8', tint(0.4));
    S.counts.over++; game.set('overdrives', S.counts.over);
    return true;
  }
  /** use an ability; false when it is cooling down, not charged, or the player cannot act */
  function use(name) {
    if (!play || player.dead || game.paused) return false;
    if (name === 'overdrive') return S.charge >= 1 && S.over <= 0 ? overdrive() : false;
    if (!(name in left) || left[name] > 0) return false;
    left[name] = CD[name];
    return name === 'dash' ? dash() : grenade();
  }
  /** what charges the overdrive */
  const gain = (k) => { if (S.over <= 0) S.charge = Math.min(1, S.charge + k); };

  function update(dt) {
    for (const k in left) left[k] = Math.max(0, left[k] - dt);
    if (S.over > 0 && (S.over -= dt) <= 0) { S.over = 0; weapon.S.boost = false; hack.free = false; }
    if (S.dashT > 0) S.dashT -= dt;
    boomT = Math.max(0, boomT - dt); boom.intensity = boomT > 0 ? 300 * room() * boomT : 0;
    if (nade.live) {   // a ballistic step, a ray along it for what it touches
      nade.t += dt; nade.vel[1] -= 12 * dt;
      const p = nade.pos, s = nade.vel.map((v) => v * dt), len = Math.hypot(...s), dir = s.map((v) => v / (len || 1));
      const hit = physics.ray(p, dir, len + 0.08, player.collider());
      let near = false;
      for (const e of enemies.list) if (!e.dead && e.active && Math.hypot(e.pos[0] - p[0], e.pos[1] + 1 - p[1], e.pos[2] - p[2]) < 1.3) near = true;
      if (hit) burst([hit.point[0] + (hit.normal?.[0] || -dir[0]) * 0.2, hit.point[1] + (hit.normal?.[1] || -dir[1]) * 0.2 + 0.1, hit.point[2] + (hit.normal?.[2] || -dir[2]) * 0.2]);
      else if (near || nade.t > 2.2) burst(p.slice());
      else { for (let k = 0; k < 3; k++) p[k] += s[k]; ball.position.set(...p); }
    }
  }
  return {
    S, use, update, gain,
    /** once startGame has made the character: the dash rides the character's own update (speed and direction) */
    start(g_) {
      g = g_; play = g.play; input = g.input;
      const ch = g.character, orig = ch.update;
      ch.update = (dt, inp = {}) => {
        if (S.dashT <= 0) return orig(dt, inp);
        const B = ch.body, w = B.walk, r = B.run, v = DASH.len / DASH.time;
        B.walk = B.run = v;
        try { return orig(dt, { ...inp, x: S.dir[0], z: S.dir[1], run: false, jump: false }); } finally { B.walk = w; B.run = r; }
      };
    },
    left: (n) => left[n] ?? 0, cooldown: (n) => CD[n] ?? 0,
    get charge() { return S.charge; }, get active() { return S.over > 0; }, get overLeft() { return S.over; }, overLen: OVER,
    /** after a checkpoint */
    reset() { left.dash = left.grenade = 0; S.over = 0; S.dashT = 0; weapon.S.boost = false; hack.free = false; nade.live = false; ball.visible = false; },
  };
}

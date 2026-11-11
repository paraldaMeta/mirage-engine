// The arsenal: five guns from data (arms.js), each with its own view model (viewmodels.js), rounds, sounds, muzzle
// flash, tracer or projectile, recoil pattern and crosshair. Slot 1 the sidearm (never runs dry), 2 the carbine, 3 the
// shotgun (pellets, shell by shell, hard on shields up close), 4 the rocket launcher and 5 the gatling (both locked
// until the 0 key). Hit-scan rounds go against Rapier (physics.ray, with the surface normal and the collider's
// object) and the robots' hit spheres; rockets fly as projectiles with a smoke trail and a lamp and burst with splash.
// Feel: a patterned climb (a fixed side pattern per gun plus a little noise) that comes back after the burst unless
// the player pulled against it; the gun kicks back and rolls; a short field-of-view punch; spread that blooms (the
// crosshair shows it); a screen shake, a view flinch and a landing dip, all offsets on the camera that never drift
// the aim; a muzzle lamp strong enough to light the walls for two frames; casings that fall and tinkle.
// The engine has no weapon layer: the view model is an ordinary lit object placed from the camera's matrix before
// every sub-frame (world.ctx.onUpdate), so the neon lights it and the temporal passes see its motion.
import * as THREE from 'three';
import { FX } from './fx.js';
import { ARMS, ARM } from './arms.js';
import { createModels } from './viewmodels.js';

/** the carbine's numbers, as before the arsenal (the field of view's base too) */
export const GUN = { mag: 24, reserve: 96, max: 168, rate: 0.095, damage: 22, reload: 1.7, fov: 62, adsFov: 44 };
const ORDER = ARMS.map((a) => a.id);

export function createWeapon({ world, root, vfx, sfx, physics, M, player, targets, hud, stats, onReload, game, opts = {}, feel = null, room = () => 'open', enemies = null, drones = null, onUnlock = null, assist = false }) {
  const { camera } = world;
  const holder = new THREE.Group(); holder.name = 'viewmodel'; root.add(holder);
  const build = createModels({ world, M });
  const models = {};
  for (const a of ARMS) { const m = build[a.model](); m.group.scale.setScalar(m.scale); m.group.visible = false; holder.add(m.group); models[a.id] = m; m.muzzleObj = new THREE.Object3D(); m.muzzleObj.position.set(...m.muzzle); m.group.add(m.muzzleObj); if (m.port) { m.portObj = new THREE.Object3D(); m.portObj.position.set(...m.port); m.group.add(m.portObj); } }
  // the muzzle lamp: one clustered lamp, dark between shots; strong and wide enough to light the walls round the player
  const flash = new THREE.PointLight(0xffb060, 0, 11, 2); root.add(flash);
  world.lighting?.addLight(flash);
  // a fill light that travels with the gun so its form reads on a dark street, and a cooler rim from below-left
  const fill = new THREE.PointLight(0xb8e2ff, 0, 2.4, 2); root.add(fill);
  const rim = new THREE.PointLight(0xff6ac8, 0, 1.6, 2); root.add(rim);
  world.lighting?.addLight(fill); world.lighting?.addLight(rim);

  // ---- per-gun rounds; S is the state of the gun in hand (S.mag / S.reserve read and write the current gun's)
  const W = {};
  for (const a of ARMS) W[a.id] = { mag: a.locked ? 0 : a.mag, reserve: a.locked ? 0 : a.reserve, owned: !a.locked };
  let cur = 'carbine', A = ARM[cur], V = models[cur];
  V.group.visible = true;
  const S = {
    get mag() { return W[cur].mag; }, set mag(v) { W[cur].mag = v; },
    get reserve() { return W[cur].reserve; }, set reserve(v) { if (W[cur].reserve !== Infinity) W[cur].reserve = Math.max(0, v); },
    get id() { return cur; },
    cool: 0, bloom: 0, reloading: 0, reloadLen: 0, reloadStep: '', ads: 0, kick: 0, roll: 0, rollSign: 1, fovPunch: 0, debtP: 0, debtY: 0, markP: 0, markY: 0, flashT: 0, sprint: 0, draw: 1,
    fire: false, fireWas: false, aim: false, wantReload: false, lastYaw: 0, lastPitch: 0, walked: 0, fov: GUN.fov, lean: 0, wantLean: 0, jab: 0, boost: false, burst: 0, sinceShot: 9,
    spin: 0, heat: 0, vent: false, firing: false, switching: null, autoReload: 0, tuck: 0, swayX: 0, swayY: 0, shake: 0, flinchP: 0, flinchY: 0, dip: 0, pumpT: 0, slideT: 0, magOutAt: 0, reloadSaid: 0,
  };
  let play = null, grid = null, rnd = 0x1234567, unlocked = false, refillAt = -1e9;
  // the comfort values (feel.js COMFORT), read where they act; without them (opts {}) the old feel, factor 1
  const cv = (key, d, lo, hi) => { const v = +opts[key]; return opts[key] !== undefined && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const C = { shake: () => cv('shake', 1, 0, 1.5), bob: () => cv('bob', 1, 0, 1.5), punch: () => cv('punch', 1, 0, 1), roll: () => cv('roll', 1, 0, 1), kick: () => cv('kick', 1, 0.4, 1), settle: () => cv('settle', 1, 1, 2.5) };
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const fwd = new THREE.Vector3(), mz = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  const flags = (k, d = 1) => { game.flags[k] = (game.flags[k] || 0) + d; };   // test counters: written straight (no 'flag' event a round)

  // ---- sounds: a name per room ('nd_shot_carbine_open'); before the buffers exist, the old carbine sound
  const shotSound = (gun, o) => sfx.play([`nd_shot_${gun}_${room()}`, 'nd_shot'], o);
  const say = (name, o) => sfx.play(name, o);

  // ---- switching guns: holster (0.2 s), the other one up (about 0.35 s)
  function select(id) {
    if (!ARM[id] || !W[id].owned || (id === cur && !S.switching) || !play) return false;
    if (S.switching?.to === id) return true;
    S.reloading = 0; S.reloadStep = ''; S.autoReload = 0; S.switching = { to: id, phase: 'out' }; S.fire = false;
    stopGatling(true);
    say('nd_draw', { gain: 0.45 });
    return true;
  }
  function cycle(dir) {
    const owned = ORDER.filter((id) => W[id].owned);
    const at = owned.indexOf(S.switching?.to || cur);
    return select(owned[(at + dir + owned.length) % owned.length]);
  }
  function swap(id) {
    V.group.visible = false; cur = id; A = ARM[id]; V = models[id]; V.group.visible = true;
    S.bloom = 0; S.burst = 0; S.spin = 0; S.vent = false; S.pumpT = 0; S.slideT = 0; S.cool = 0.1;
    game.set('weapon', id); flags('switches');
  }

  // ---- reloading: a magazine (out, in, the bolt if it was empty), shell by shell (the shotgun), a rocket
  function reload() {
    if (S.reloading > 0 || S.switching || S.mag >= A.mag || S.reserve <= 0) return false;
    const k = S.boost ? 0.5 : 1;
    if (A.shellByShell) { S.reloadStep = 'lift'; S.reloading = A.reloadFirst * k; }
    else { S.reloadStep = 'mag'; S.reloading = A.reload * k; S.wasEmpty = S.mag === 0; }
    S.reloadLen = S.reloading; S.reloadSaid = 0;
    say(A.id === 'rocket' ? 'nd_rkt_load' : A.shellByShell ? 'nd_slide' : 'nd_mag_out', { gain: 0.6 });
    if (A.id === 'gatling') say('nd_gat_vent', { gain: 0.35 });
    return true;
  }
  function endReload() { S.reloading = 0; S.reloadStep = ''; onReload?.(); feel?.reloaded(); flags('reloads_' + cur); }
  function stepReload(dt) {
    if (S.reloading <= 0) return;
    S.reloading -= dt;
    const u = 1 - S.reloading / (S.reloadLen || 1);
    if (S.reloadStep === 'mag') {
      if (u > 0.55 && S.reloadSaid < 1) { S.reloadSaid = 1; say('nd_mag_in', { gain: 0.65 }); }
      if (u > 0.82 && S.reloadSaid < 2 && S.wasEmpty) { S.reloadSaid = 2; say(A.id === 'sidearm' ? 'nd_slide' : 'nd_bolt_rack', { gain: 0.6 }); }
      if (S.reloading <= 0) { const n = Math.min(A.mag - S.mag, S.reserve); S.mag += n; if (W[cur].reserve !== Infinity) W[cur].reserve -= n; endReload(); }
    } else if (S.reloading <= 0) {   // shell by shell: one in, then the next, until full or empty or the trigger
      if (S.reloadStep === 'shell') { S.mag++; W[cur].reserve--; }
      if (S.mag < A.mag && S.reserve > 0) { S.reloadStep = 'shell'; S.reloading = S.reloadLen = A.reload * (S.boost ? 0.5 : 1); say('nd_shell_in', { gain: 0.6 }); }
      else { endReload(); S.pumpT = 0.4; say('nd_pump', { gain: 0.65 }); }
    }
  }

  // ---- where a round goes: the view direction opened by the spread
  const spread = () => {
    const s = A.spread;
    return Math.min(s.max, s.hip + (s.ads - s.hip) * S.ads + S.bloom * (1 - 0.5 * S.ads) + Math.min(player.speed, 5) * s.move) * (1 - 0.3 * player.crouch);
  };
  function aimDir(sp, out) {
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    right.crossVectors(fwd, up).normalize(); tmp.crossVectors(right, fwd);
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * sp;
    return out.copy(fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(tmp, Math.sin(a) * r).normalize();
  }
  /** what a surface is made of, for its impact sound: metal, glass or concrete */
  function surfaceOf(hit) {
    const m = [].concat(hit.object?.material)[0];
    if (!m) return 'concrete';
    if (m.transparent && m.opacity < 0.8) return 'glass';
    if (/glass|window|pane/i.test(hit.object.name + (m.name || ''))) return 'glass';
    return (m.metalness ?? 0) > 0.5 ? 'metal' : 'concrete';
  }
  /** one ray: the world, then whoever stands in front of it */
  function cast(d, range) {
    const o = camera.position.toArray(), dv = d.toArray();
    const hit = physics.ray(o, dv, range, player.collider());
    const wt = hit ? hit.distance : range;
    const eh = targets.rayHit(o, dv, wt);
    const t = eh ? eh.t : wt;
    return { o, d: dv, hit: eh ? null : hit, eh, t, end: [o[0] + dv[0] * t, o[1] + dv[1] * t, o[2] + dv[2] * t] };
  }
  const RANK = { hit: 0, head: 1, shield: 2, kill: 3 };
  function shoot() {
    S.mag--; S.cool = A.rate * (S.boost ? 0.6 : 1); stats.shots++; S.sinceShot = 0; S.firing = true;   // overdrive (abilities.js): faster fire
    const n = S.burst++;
    V.muzzleObj.getWorldPosition(mz);
    flags('shots_' + cur);
    if (A.kind === 'rocket') launch();
    else {
      const sp = spread(), pellets = A.pellets || 1, results = new Map();
      let mark = null, decals = 0;
      for (let k = 0; k < pellets; k++) {
        const r = cast(aimDir(sp, tmp.clone()), A.range);
        if (!A.tracer?.every || n % A.tracer.every === 0) if (k < 4 || R() < 0.4) vfx.beam({ from: mz.toArray(), to: r.end, width: A.tracer.width, color: A.tracer.color, intensity: 4, life: A.tracer.life });
        if (r.eh) {
          const eh = r.eh, fall = A.falloff ? (eh.t < A.falloff[0] ? 1 : eh.t > A.falloff[1] ? A.falloff[2] : 1 - (1 - A.falloff[2]) * (eh.t - A.falloff[0]) / (A.falloff[1] - A.falloff[0])) : 1;
          const info = { ...eh, shieldK: A.shieldK && eh.t < A.shieldRange ? A.shieldK : 1 };
          stats.lastHead = !!eh.head;
          const killed = eh.owner.damage(eh.e, A.damage * fall, eh.head, eh.point, r.d, info), kind = killed ? 'kill' : eh.part ? 'shield' : eh.head ? 'head' : 'hit';
          stats.hits += pellets > 1 ? 1 / pellets : 1; if (eh.head && pellets === 1) stats.heads++;
          const was = results.get(eh.e);
          if (!was || RANK[kind] > RANK[was.kind]) results.set(eh.e, { kind, point: eh.point, eh });
          if (killed) { flags('kills_' + cur); if (A.id === 'shotgun' && eh.t < 8) flags('shotgunCloseKills'); }
          if (!mark || RANK[kind] > RANK[mark]) mark = kind;
        } else if (r.hit) {
          const h = r.hit, nrm = h.normal;
          vfx.burst(FX.impact, r.end, { direction: nrm, scale: pellets > 1 ? 0.6 : 1 });
          if (decals++ < (pellets > 1 ? 3 : 1)) vfx.decal({ position: [r.end[0] + nrm[0] * 0.02, r.end[1] + nrm[1] * 0.02, r.end[2] + nrm[2] * 0.02], normal: nrm, size: (pellets > 1 ? 0.09 : 0.16) + R() * 0.06, depth: 0.2, pattern: 'scorch', life: 25, fade: 4, opacity: 0.85 });
          if (k < 2 && R() < 0.7) say('nd_imp_' + surfaceOf(h), { at: r.end, gain: 0.55, ref: 3, rate: 0.95 + R() * 0.1 });
        }
      }
      for (const { kind, point } of results.values()) {
        sfx.play(kind === 'kill' ? 'nd_kill' : kind === 'shield' ? 'nd_shieldhit' : kind === 'head' ? 'nd_head' : 'nd_hit', { gain: kind === 'kill' ? 0.8 : 0.55 });
        if (kind !== 'shield') say('nd_imp_armour', { at: point, gain: 0.45, ref: 3 });
      }
      if (mark) { hud.hit(mark); if (mark === 'kill') feel?.kill(); }
      vfx.burst(FX.muzzle, mz, { direction: [fwd.x, fwd.y, fwd.z], scale: A.flash.scale * (1 - 0.6 * S.ads) });   // smaller down the sight: it sits in the middle of the view
      if (A.id === 'gatling') { if (!gatLoop) { gatLoop = sfx.loop2(`nd_gat_loop_${room()}`, { gain: 0.75, bus: 'sfx' }); } }
      else shotSound(A.sound, { gain: A.id === 'shotgun' ? 0.85 : 0.75, rate: 1 });
      if (A.id === 'shotgun') S.pumpT = 0.62;   // the pump goes back and forward after the shot
      if (A.id === 'sidearm') S.slideT = 0.07;
      if (A.shell && A.id !== 'shotgun') eject(A.shell);
    }
    targets.noise(player.feet, A.id === 'shotgun' || A.id === 'rocket' ? 34 : 26);
    // recoil: a climb that rises through a burst, the gun's side pattern, a little noise; most of it comes back
    // comfort (feel.js): `kick` is the camera's share of the climb, what it gives up goes to the gun model's kick
    const cam = C.kick(), P = A.recoil, k = (1 - 0.35 * S.ads) * (S.boost ? 0.85 : 1) * cam;
    // (the climb a burst has piled up is capped: without that a long burst, the gatling's above all, walked the view
    // up to the vertical and pinned it there for as long as the trigger was held)
    const climb = Math.min(P.climb * (1 + Math.min(n, 10) * P.ramp) * k, Math.max(0, (P.cap ?? 0.2) * cam - S.debtP)), side = (P.side[n % P.side.length] * P.climb * 0.7 + (R() - 0.5) * P.rand) * k;
    // the debt is what the view actually climbed: at the top of the clamp a climb that did not happen is not paid back
    // (it pulled the view below where the player had put it)
    const was = play.pitch;
    play.pitch = Math.min(1.45, was + climb); play.yaw += side; S.debtP += Math.max(0, play.pitch - was); S.debtY += side;
    const punch = C.punch();
    S.kick = Math.min(1.6 + (1 - cam), S.kick + 1 + 0.8 * (1 - cam)); S.roll = Math.min(1.5, S.roll + 1); S.rollSign = R() < 0.5 ? -1 : 1; S.fovPunch = Math.min(P.fov * 1.6 * punch, S.fovPunch + P.fov * punch);
    S.bloom = Math.min(A.spread.max, S.bloom + A.spread.bloom); S.flashT = 0.04;
    flash.distance = A.flash.gain > 30 ? 14 : 10;
    S.shake = Math.min(3, S.shake + P.shake);
    if (A.id === 'gatling') S.heat = Math.min(1.2, S.heat + A.heatPer);
    if (S.mag === 0 && S.reserve > 0) S.autoReload = 0.28;   // the last round: the reload starts by itself
    feel?.fire(A);
  }

  // ---- casings: a small pool, ejected to the right, falling, bouncing, tinkling where they land
  const brassMat = world.mat.std({ color: new THREE.Color(0.55, 0.38, 0.13), roughness: 0.3, metalness: 1 }), hullMat = world.mat.std({ color: new THREE.Color(0.32, 0.03, 0.03), roughness: 0.5 });
  const brassGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.02, 6), hullGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 0.064, 8);
  const shells = Array.from({ length: 18 }, () => { const o = new THREE.Mesh(brassGeo, brassMat); o.visible = false; o.castShadow = false; o.userData.collide = false; root.add(o); return { o, live: false, vel: [0, 0, 0], spin: [0, 0, 0], t: 0, bounces: 0, kind: 'brass' }; });
  let shellAt = 0;
  function eject(kind) {
    if (!V.portObj) return;
    const s = shells[shellAt++ % shells.length];
    V.portObj.getWorldPosition(tmp);
    const q = camera.quaternion, r = new THREE.Vector3(1, 0, 0).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q), f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    s.o.geometry = kind === 'hull' ? hullGeo : brassGeo; s.o.material = kind === 'hull' ? hullMat : brassMat; s.kind = kind;
    s.o.position.copy(tmp); s.live = true; s.t = 0; s.bounces = 0; s.o.visible = true;
    const v = r.multiplyScalar(1.6 + R() * 0.9).addScaledVector(u, 1.4 + R() * 0.8).addScaledVector(f, -0.4 + R() * 0.3);
    s.vel = [v.x, v.y, v.z]; s.spin = [(R() - 0.5) * 30, (R() - 0.5) * 30, (R() - 0.5) * 30];
  }
  function stepShells(dt) {
    for (const s of shells) {
      if (!s.live) continue;
      s.t += dt;
      if (s.t > 5) { s.live = false; s.o.visible = false; continue; }
      if (s.bounces > 2) continue;
      s.vel[1] -= 9.8 * dt;
      const p = s.o.position; p.x += s.vel[0] * dt; p.y += s.vel[1] * dt; p.z += s.vel[2] * dt;
      s.o.rotation.x += s.spin[0] * dt; s.o.rotation.y += s.spin[1] * dt; s.o.rotation.z += s.spin[2] * dt;
      const g = grid ? grid.groundAt(p.x, p.z, p.y + 0.4) : NaN;
      if (!Number.isNaN(g) && p.y < g + 0.006 && s.vel[1] < 0) {
        p.y = g + 0.006;
        if (s.bounces === 0) say(s.kind === 'hull' ? 'nd_hull' : 'nd_brass', { at: p.toArray(), gain: 0.4, ref: 1.6, rate: 0.95 + R() * 0.1 });
        s.vel[1] = -s.vel[1] * 0.32; s.vel[0] *= 0.5; s.vel[2] *= 0.5; s.spin = s.spin.map((v) => v * 0.4); s.bounces++;
        if (s.bounces > 2) { s.o.rotation.set(Math.PI / 2, 0, R() * 6.28); }
      }
    }
  }

  // ---- the rocket: a projectile with a lamp and a smoke trail; on what it touches, a blast with splash
  const rocketMat = world.mat.std({ color: new THREE.Color(0.16, 0.17, 0.12), roughness: 0.45, metalness: 0.5 });
  const rocketGeo = new THREE.LatheGeometry([[0, 0.22], [0.012, 0.21], [0.04, 0.15], [0.048, 0.08], [0.048, -0.12], [0.03, -0.16], [0.03, -0.2]].map(([a, b]) => new THREE.Vector2(a, b)), 14).rotateX(-Math.PI / 2);
  const glowMat = world.mat.glow([1, 0.55, 0.15], 14);
  const rockets = Array.from({ length: 3 }, () => {
    const o = new THREE.Group(), body = new THREE.Mesh(rocketGeo, rocketMat), tail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat);
    tail.position.z = 0.2; tail.scale.set(1, 1, 2.2); o.add(body, tail); o.visible = false; o.traverse((m) => { m.userData.collide = false; m.castShadow = false; }); root.add(o);
    const light = new THREE.PointLight(0xffa040, 0, 9, 2); root.add(light); world.lighting?.addLight(light);
    return { o, light, live: false, pos: [0, 0, 0], vel: [0, 0, 0], t: 0, trail: null };
  });
  const boom = new THREE.PointLight(0xffb070, 0, 22, 2); root.add(boom); world.lighting?.addLight(boom);
  let boomT = 0;
  function launch() {
    const r = rockets.find((x) => !x.live) || rockets[0];
    // from the muzzle toward what the crosshair is on (the tube sits off the eye's line), so the rocket goes where aimed
    const d = aimDir(spread(), new THREE.Vector3()), c = cast(d, A.range), e = new THREE.Vector3(...c.end);
    if (c.t > 1.5) d.copy(e.sub(mz).normalize());
    r.live = true; r.t = 0; r.pos = [mz.x + d.x * 0.1, mz.y + d.y * 0.1, mz.z + d.z * 0.1]; r.vel = [d.x * A.speed, d.y * A.speed, d.z * A.speed];
    r.o.position.set(...r.pos); r.o.lookAt(r.pos[0] + d.x, r.pos[1] + d.y, r.pos[2] + d.z); r.o.visible = true;
    r.trail?.stop(); r.trail = vfx.spawn(FX.rocketTrail, { follow: r.o });
    vfx.burst(FX.muzzle, mz, { direction: d.toArray(), scale: 1.4 });
    tmp.set(...V.back); V.group.localToWorld(tmp);
    vfx.burst(FX.backblast, tmp, { direction: [-d.x, -d.y, -d.z] });
    say(`nd_rkt_launch_${room()}`, { gain: 0.85 });
    flags('rockets');
  }
  function stepRockets(dt) {
    for (const r of rockets) {
      if (!r.live) continue;
      r.t += dt;
      const s = r.vel.map((v) => v * dt), len = Math.hypot(...s), dir = s.map((v) => v / (len || 1));
      const hit = physics.ray(r.pos, dir, len + 0.05, player.collider()), eh = targets.rayHit(r.pos, dir, hit ? hit.distance : len + 0.05) || near(r.pos);
      if (eh) { explode(eh.point, dir, eh); r.live = false; }
      else if (hit) { explode([hit.point[0] + hit.normal[0] * 0.25, hit.point[1] + hit.normal[1] * 0.25, hit.point[2] + hit.normal[2] * 0.25], dir, null, hit.normal); r.live = false; }
      else if (r.t > 4) { explode(r.pos.slice(), dir); r.live = false; }
      else { for (let k = 0; k < 3; k++) r.pos[k] += s[k]; r.o.position.set(...r.pos); }
      r.light.position.copy(r.o.position); r.light.intensity = r.live ? 30 * lampRoom() * (0.8 + 0.2 * R()) : 0;
      if (!r.live) { r.o.visible = false; r.trail?.stop(); r.trail = null; }
    }
    boomT = Math.max(0, boomT - dt); boom.intensity = boomT > 0 ? 900 * lampRoom() * boomT * boomT : 0;
  }
  /** a proximity fuse: a robot within 0.9 m of the rocket (its chest) sets it off */
  function near(p) {
    for (const e of enemies?.list || []) if (!e.dead && e.rig.root.visible && Math.hypot(e.pos[0] - p[0], e.pos[1] + 1.1 * e.K.scale - p[1], e.pos[2] - p[2]) < 0.9) return { e, point: p.slice(), owner: enemies };
    for (const e of drones?.list || []) if (!e.dead && e.o.visible && Math.hypot(e.pos[0] - p[0], e.pos[1] - p[1], e.pos[2] - p[2]) < 0.9) return { e, point: p.slice(), owner: drones };
    return null;
  }
  /** the blast: splash with falloff, behind cover no damage; every shield in reach breaks; the player too */
  function explode(p, dir, direct, normal) {
    const r = ARM.rocket.splash, dmg = ARM.rocket.damage;
    vfx.burst(FX.explosion, p); boom.position.set(...p); boomT = 0.55;
    if (normal) vfx.decal({ position: [p[0] - normal[0] * 0.2, p[1] - normal[1] * 0.2, p[2] - normal[2] * 0.2], normal, size: 2.2, depth: 0.6, pattern: 'scorch', life: 40, fade: 6, opacity: 0.95 });
    say(`nd_rkt_boom_${room()}`, { at: p, gain: 1.2, ref: 9 });
    let kills = 0, hits = 0, broke = 0;
    const blastAt = (e, c, owner) => {
      const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2], d = Math.hypot(dx, dy, dz);
      if (d > r) return;
      if (d > 0.4) { const w = physics.ray(p, [dx / d, dy / d, dz / d], d, player.collider()); if (w && w.distance < d - 0.35) return; }   // behind a wall
      if (owner === enemies && e.shield && e.shieldOff <= 0 && enemies.breakShield) { enemies.breakShield(e, c); broke++; }
      const amount = dmg * Math.max(0.12, 1 - Math.pow(d / r, 1.3)) * (direct && direct.e === e ? 1.25 : 1);
      stats.lastHead = false;
      if (owner.damage(e, amount, false, c, d > 0.01 ? [dx / d, dy / d, dz / d] : dir, { splash: true })) kills++;
      hits++;
    };
    for (const e of enemies?.list || []) if (!e.dead && e.rig.root.visible) blastAt(e, [e.pos[0], e.pos[1] + 1.0 * e.K.scale, e.pos[2]], enemies);
    for (const e of drones?.list || []) if (!e.dead && e.o.visible) blastAt(e, e.pos, drones);
    // the player is not spared
    const pf = [player.feet[0], player.feet[1] + 1, player.feet[2]], dp = Math.hypot(pf[0] - p[0], pf[1] - p[1], pf[2] - p[2]);
    if (dp < r) { const self = dmg * ARM.rocket.selfK * (1 - dp / r) * (assist ? 0.15 : 1); if (self > 0.5) { player.hurt(self, p); flags('selfDamage', Math.round(self)); } }
    if (hits) hud.hit(kills ? 'kill' : 'hit');
    if (kills) feel?.kill();
    const dc = camera.position.distanceTo(tmp.set(...p));
    S.shake = Math.min(4, S.shake + 3.2 * Math.max(0, 1 - dc / 34));
    feel?.explosion(dc);
    flags('rocketHits', hits); flags('rocketKills', kills); flags('shieldBreaks', broke);
    if (kills) flags('splashKills', kills);
  }
  const lampRoom = () => Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);   // lamps that do not go out by day

  // ---- the gatling: spin up before it fires, heat that forces a cool-down, a motor that whines with the spin
  let gatLoop = null, motor = null;
  function stopGatling(quiet) {
    if (gatLoop) { gatLoop.stop(); gatLoop = null; if (!quiet) say(`nd_gat_tail_${room()}`, { gain: 0.75 }); }
  }
  function stepGatling(dt, alive) {
    const G = ARM.gatling;
    const want = cur === 'gatling' && alive && !S.switching && S.reloading <= 0 && (S.fire || S.aim) ? 1 : 0;
    if (want) S.spin = Math.min(1, S.spin + dt / (G.spinUp * (S.boost ? 0.6 : 1)));
    else { if (S.spin > 0.6 && S.spin - dt / G.spinDown <= 0.6) say('nd_gat_spindown', { gain: 0.5 }); S.spin = Math.max(0, S.spin - dt / G.spinDown); }
    W.gatling.heat = S.heat = Math.max(0, S.heat - dt * G.cool * (S.firing && cur === 'gatling' ? 0.25 : 1));
    if (S.heat >= 1 && !S.vent) { S.vent = true; stopGatling(); say('nd_gat_vent', { gain: 0.7 }); flags('overheats'); hud.flashHeat?.(); }
    if (S.vent && S.heat <= G.ventTo) S.vent = false;
    if (cur === 'gatling' && S.spin > 0.95) game.flags.spunUp = 1;
    // the motor: a loop whose rate follows the spin
    if (cur === 'gatling' && S.spin > 0.04) { if (!motor) motor = sfx.loop2('nd_gat_motor', { gain: 0.32, bus: 'sfx' }); motor?.rate(0.35 + 0.75 * S.spin); }
    else if (motor) { motor.stop(); motor = null; }
    if (cur === 'gatling') { V.spin.rotation.z += S.spin * dt * 42; V.heat.emissiveIntensity = Math.pow(Math.max(0, S.heat - 0.25) / 0.75, 2) * 6; }
  }

  /** a strike with the stock: whoever is within arm's reach in front, hard; 0.6 s before the next */
  function melee() {
    if (S.jab > 0 || S.reloading > 0 || S.switching || !play) return false;
    S.jab = 0.6; S.cool = Math.max(S.cool, 0.45);
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    const o = camera.position.toArray(), d = fwd.toArray(), eh = targets.rayHit(o, d, 2.3);
    say(eh ? 'nd_imp_armour' : 'nd_impact', { gain: eh ? 0.9 : 0.35, rate: eh ? 0.8 : 0.5 });
    if (eh) { stats.lastHead = false; stats.meleeNow = true; const killed = eh.owner.damage(eh.e, 85, false, eh.point, d, { ...eh, melee: true }); stats.meleeNow = false; hud.hit(killed ? 'kill' : 'hit'); S.shake += 0.6; feel?.hit(0.5); stats.melee = (stats.melee || 0) + 1; if (killed) feel?.kill(); }
    return true;
  }

  /** one fixed step of the game */
  function update(dt, alive) {
    if (!play) return false;
    // the player's own pull against the climb: what they turned down (or back across) since the last step is paid off
    const uP = play.pitch - S.markP, uY = play.yaw - S.markY;
    if (S.debtP > 0 && uP < 0) S.debtP = Math.max(0, S.debtP + uP);
    if (S.debtY && uY && Math.sign(uY) !== Math.sign(S.debtY)) S.debtY = Math.sign(S.debtY) * Math.max(0, Math.abs(S.debtY) - Math.abs(uY));
    S.cool -= dt; S.sinceShot += dt;
    S.bloom *= Math.exp(-dt * A.spread.decay);
    if (S.sinceShot > 0.32) S.burst = 0;
    // recentre after the burst
    // (during a burst over half of it springs back, so a long burst climbs but does not run away)
    if (S.debtP > 1e-5 || Math.abs(S.debtY) > 1e-5) {
      const k = 1 - Math.exp(-dt * A.recoil.recover * (S.sinceShot > 0.12 ? 1 : 0.6)), bp = Math.min(S.debtP, S.debtP * k + dt * 0.01), by = S.debtY * k;
      play.pitch -= bp; S.debtP -= bp; play.yaw -= by; S.debtY -= by;
    }
    // switching
    if (S.switching) {
      if (S.switching.phase === 'out') { S.draw = Math.min(1, S.draw + dt / 0.2); if (S.draw >= 1) { swap(S.switching.to); S.switching.phase = 'in'; } }
      else { S.draw = Math.max(0, S.draw - dt / 0.33); if (S.draw <= 0) S.switching = null; }
    } else S.draw = Math.max(0, S.draw - dt * 2.4);
    stepReload(dt);
    stepGatling(dt, alive);
    const edge = S.fire && !S.fireWas; S.fireWas = S.fire;
    if (alive) {
      if (S.wantReload) { reload(); S.wantReload = false; }
      if (S.autoReload > 0 && (S.autoReload -= dt) <= 0) { S.autoReload = 0; if (S.mag === 0) reload(); }
      // the shotgun: the trigger stops a reload (a shell in the tube is enough)
      if (edge && A.shellByShell && S.reloading > 0 && S.mag > 0) { S.reloading = 0; S.reloadStep = ''; S.pumpT = 0.4; say('nd_pump', { gain: 0.6 }); S.cool = 0.32; }
      const ready = !S.switching && S.reloading <= 0 && S.draw <= 0.08 && S.cool <= 0;
      if (S.fire && ready) {
        if (A.id === 'gatling' && (S.vent || S.spin < 0.95)) { if (S.vent && edge) say('nd_dry_heavy', { gain: 0.5 }); }
        else if (S.mag > 0) { if (A.auto || edge || S.sinceShot >= A.hold) shoot(); }
        else if (edge || A.auto) { S.cool = 0.3; if (!reload()) { say(A.dry, { gain: 0.6 }); feel?.empty(); } }
      }
    }
    if (!(S.fire && alive) || S.mag <= 0 || S.vent || (A.id === 'gatling' && S.spin < 0.95)) { if (S.firing && A.id === 'gatling') stopGatling(); S.firing = false; }
    if (cur !== 'gatling' && gatLoop) stopGatling();
    stepRockets(dt); stepShells(dt);
    if (V.round) V.round.visible = S.mag > 0 && !(S.reloading > 0 && (1 - S.reloading / (S.reloadLen || 1)) < 0.6);
    const wantAds = alive && S.aim && S.reloading <= 0 && !S.switching ? 1 : 0;
    S.ads += (wantAds - S.ads) * Math.min(1, dt * 12);
    S.kick = Math.max(0, S.kick - dt * 9); S.roll = Math.max(0, S.roll - dt * 8); S.fovPunch = Math.max(0, S.fovPunch - dt * 30 * Math.max(1, S.fovPunch)); S.flashT -= dt; S.jab = Math.max(0, S.jab - dt);
    S.pumpT = Math.max(0, S.pumpT - dt); S.slideT = Math.max(0, S.slideT - dt);
    if (A.id === 'shotgun' && S.pumpT > 0 && S.pumpT < 0.38 && S.pumpT + dt >= 0.38 && S.sinceShot < 0.6) { say('nd_pump', { gain: 0.6 }); eject('hull'); }
    const st = C.settle();   // comfort: the shake, the flinch and the dip die away `settle` times as fast
    S.shake *= Math.exp(-dt * 7 * st); S.flinchP *= Math.exp(-dt * 10 * st); S.flinchY *= Math.exp(-dt * 10 * st); S.dip *= Math.exp(-dt * 9 * st);
    const sprinting = player.speed > 4.4 && !S.fire && !S.aim && S.reloading <= 0 ? 1 : 0;
    S.sprint += (sprinting - S.sprint) * Math.min(1, dt * 8);
    S.walked += player.speed * dt;
    S.markP = play.pitch; S.markY = play.yaw;
    return true;
  }

  // ---- before every sub-frame: the lens, the camera's offsets (once a frame), the view model on the camera
  const left = { pos: new THREE.Vector3(1e9, 0, 0), q: new THREE.Quaternion() }, UP = new THREE.Vector3(0, 1, 0);
  let clock = 0;
  function pose(dt) {
    if (!play) return;
    clock += dt;
    // the lens: aiming narrows it, a shot punches it for a moment (after play wrote its own field of view)
    const fov = S.fov + (S.fov * (A.adsFov / GUN.fov) - S.fov) * S.ads + S.fovPunch;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    S.lean += (S.wantLean - S.lean) * Math.min(1, dt * 9);
    // the camera's offsets go on once a frame: play writes the camera every frame, so a camera that is not where these
    // left it is a new frame (a frame's later sub-frames find it where they left it)
    // comfort: the shake's strength, the bob's (it used to follow the shake setting), the roll's share
    const k = C.shake(), rl = C.roll(), bobK = Math.min(player.speed / 3.4, 1.5) * (1 - 0.8 * S.ads) * C.bob(), ph = S.walked * 2.3;
    const sh = S.shake * 0.0055 * k, t = clock;
    S.bobY = -Math.abs(Math.cos(ph)) * 0.022 * bobK;   // (kept for the measurements: scripts/motion-check.mjs)
    const offY = S.bobY - player.crouch * 0.6 - S.dip;
    const pitch = (Math.sin(t * 41) + Math.sin(t * 67 + 1.3)) * sh + S.flinchP, yaw = (Math.sin(t * 37 + 0.7) + Math.sin(t * 59 + 2.1)) * sh * 0.8 + S.flinchY;
    const roll = -S.lean * 0.13 + rl * (Math.sin(ph) * 0.004 * bobK + S.roll * A.recoil.roll * S.rollSign * k * 0.35 + Math.sin(t * 29) * sh * 0.6);
    const any = Math.abs(offY) + Math.abs(S.lean) + Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll) > 1e-5;
    if (any && !(camera.position.equals(left.pos) && camera.quaternion.equals(left.q))) {
      right.set(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      let reach = 0;
      if (Math.abs(S.lean) > 0.001) {   // a lean stops short of a wall
        const side = physics.ray(camera.position.toArray(), right.clone().multiplyScalar(Math.sign(S.lean) || 1).toArray(), 0.7, player.collider());
        reach = Math.min(0.42, side ? Math.max(0, side.distance - 0.22) : 0.42);
      }
      camera.position.addScaledVector(right, S.lean * reach); camera.position.y += offY;
      // the yaw offset turns about the world's vertical (about the camera's own, on a view pitched up or down, it tilted
      // the horizon), the pitch about the camera's level right axis: only `roll` rolls the view
      camera.rotateOnWorldAxis(UP, yaw); camera.rotateX(pitch); camera.rotateZ(roll); camera.updateMatrixWorld();
      left.pos.copy(camera.position); left.q.copy(camera.quaternion);
    }
    holder.position.copy(camera.position); holder.quaternion.copy(camera.quaternion);
    // sway: the gun lags behind the view's turn, bobs with the walk
    const dy = play.yaw - S.lastYaw, dp = play.pitch - S.lastPitch; S.lastYaw = play.yaw; S.lastPitch = play.pitch;
    const kk = Math.min(1, dt * 10);
    S.swayX += (THREE.MathUtils.clamp(-dy * 1.2, -0.05, 0.05) - S.swayX) * kk; S.swayY += (THREE.MathUtils.clamp(dp * 1.2, -0.05, 0.05) - S.swayY) * kk;
    const gb = Math.min(player.speed / 3.4, 1.4) * (1 - 0.85 * S.ads), bx = Math.sin(ph) * 0.006 * gb, by = -Math.abs(Math.cos(ph)) * 0.007 * gb;
    // near a wall the gun comes back so the barrel does not go through it
    const ahead = physics.ray(camera.position.toArray(), camera.getWorldDirection(fwd).toArray(), 1.2, player.collider());
    const tuck = ahead ? THREE.MathUtils.clamp((0.95 - ahead.distance) / 0.6, 0, 1) : 0;
    S.tuck += (tuck - S.tuck) * Math.min(1, dt * 12);
    // the reload: tilt, magazine out and back (or a shell at the port, or the rocket going in), level again
    let tilt = 0, magOut = 0, shellUp = 0;
    if (S.reloading > 0 || S.reloadStep) {
      const u = 1 - S.reloading / (S.reloadLen || 1);
      if (A.shellByShell) { tilt = 0.7; shellUp = S.reloadStep === 'shell' ? Math.sin(Math.PI * Math.min(1, u)) : 0; }
      else { tilt = THREE.MathUtils.smoothstep(u, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1)); magOut = THREE.MathUtils.smoothstep(u, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(u, 0.5, 0.68)); }
    }
    const a = S.ads, low = Math.max(S.sprint, S.draw), jab = S.jab > 0 ? Math.sin(Math.PI * Math.min(1, (0.6 - S.jab) / 0.32)) * (S.jab > 0.28 ? 1 : 0) : 0;
    const P = A.recoil, kick = S.kick * P.back * (1 - 0.5 * a), H = V.hip, D = V.ads;
    const g = V.group;
    g.position.set(THREE.MathUtils.lerp(H[0], D[0], a) + bx + S.swayX * 0.6 + tilt * 0.03, THREE.MathUtils.lerp(H[1], D[1], a) + by + S.swayY * 0.4 - tilt * 0.05 - low * 0.11 - S.tuck * 0.03,
      THREE.MathUtils.lerp(H[2], D[2], a) + kick * 0.75 + S.tuck * 0.2 - jab * 0.22);
    g.rotation.set(S.kick * (0.03 + P.back * 0.9) * (1 - 0.6 * a) + S.swayY + tilt * 0.35 - low * 0.5 + S.tuck * 0.5 + jab * 0.25, S.swayX + tilt * 0.3 + low * 0.45 + (1 - a) * 0.03 + jab * 0.9,
      -tilt * 0.6 + S.swayX * 1.5 + low * 0.2 + S.roll * P.roll * S.rollSign);
    if (V.magazine) { V.magazine.position.copy(V.magHome); V.magazine.position.y -= magOut * 0.22; V.magazine.visible = magOut < 0.98; }
    V.left.position.set(0, -magOut * 0.2, magOut * 0.2);
    if (V.pump) { const pu = S.pumpT > 0 ? Math.sin(Math.PI * Math.min(1, (0.62 - Math.min(0.62, S.pumpT)) / 0.4)) : 0; V.pump.position.copy(V.pumpHome); V.pump.position.z += pu * 0.09; }
    if (V.shell) { V.shell.visible = shellUp > 0.05; V.shell.position.set(0, -0.06 + shellUp * 0.03, 0.0); }
    if (V.slide) V.slide.position.z = S.slideT > 0 ? Math.sin(Math.PI * S.slideT / 0.07) * 0.03 : S.mag === 0 && cur === 'sidearm' && S.reloading <= 0 ? 0.028 : 0;
    if (V.glowRing) V.glowRing.visible = S.spin > 0.05;
    if (V.dot) V.dot.visible = a > 0.5;
    holder.updateMatrixWorld(true);
    V.muzzleObj.getWorldPosition(mz);
    const rk = lampRoom();
    fill.position.copy(holder.position).addScaledVector(fwd.set(-0.16, 0.18, 0.04).applyQuaternion(holder.quaternion), 1);
    rim.position.copy(holder.position).addScaledVector(fwd.set(0.3, -0.25, -0.25).applyQuaternion(holder.quaternion), 1);
    fill.intensity = 1.1 * rk; rim.intensity = 0.35 * rk;
    flash.position.copy(mz);
    flash.intensity = S.flashT > 0 ? A.flash.gain * rk * (0.7 + 0.3 * R()) * (1 - 0.5 * S.ads) : 0;
  }
  let last = -1;
  const off = world.ctx.onUpdate((tk) => { const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, tk - last)); last = tk; pose(dt); });

  // ---- ammunition: given in units (a cell 24, a crate 48), to the gun in hand or the emptiest
  const takes = (id) => W[id].owned && W[id].reserve !== Infinity && ARM[id].per > 0 && W[id].reserve < ARM[id].max;
  function emptiest() { let best = null, bk = 2; for (const id of ORDER) if (takes(id)) { const k = W[id].reserve / ARM[id].max; if (k < bk) { bk = k; best = id; } } return best; }
  function fill1(id, units) { const a = ARM[id], w = W[id], n = Math.min(a.max - w.reserve, Math.max(1, Math.round(units * a.per))); w.reserve += n; return n; }
  const api = {
    S, holder, models, reload, update, melee, select, cycle, spread, W, ARMS, eject,
    get id() { return cur; }, get arm() { return A; }, get switchingTo() { return S.switching?.to || null; }, get unlocked() { return unlocked; },
    start(p) { play = p; grid = p.grid; S.lastYaw = S.markY = p.yaw; S.lastPitch = S.markP = p.pitch; },
    /** units of ammunition to the gun in hand (or the emptiest that takes them); all: half as much to the others too.
     *  Returns rounds given to the first; api.lastGive is that gun's id */
    give(units, all = false) {
      const id = takes(cur) ? cur : emptiest();
      if (!id) return 0;
      const n = fill1(id, units); api.lastGive = id;
      if (all) for (const o of ORDER) if (o !== id && takes(o)) fill1(o, units * 0.5);
      return n;
    },
    /** does any gun want ammunition */
    wants: () => ORDER.some(takes),
    /** the reserve that counts for the low-ammo marker: the gun in hand, or with the sidearm, the emptiest real gun */
    lowInfo() { const id = W[cur].reserve === Infinity ? emptiest() || cur : cur; return { id, reserve: W[id].reserve, mag: W[id].mag, low: ARM[id].mag * 2 }; },
    /** the 0 key: slots 4 and 5 with a full load; again: a refill, at most once a minute. Returns 'unlocked' | 'refilled' | seconds to wait */
    unlock(quiet = false) {
      const fillAll = () => { for (const id of ['rocket', 'gatling']) { W[id].owned = true; W[id].mag = ARM[id].mag; W[id].reserve = ARM[id].max; } };
      if (!unlocked) { unlocked = true; fillAll(); refillAt = game.time; if (!quiet) { say('nd_unlock', { gain: 0.8 }); onUnlock?.('unlocked'); flags('unlocks'); } return 'unlocked'; }
      const wait = 60 - (game.time - refillAt);
      if (wait > 0) { onUnlock?.(Math.ceil(wait)); return Math.ceil(wait); }
      fillAll(); refillAt = game.time; say('nd_unlock', { gain: 0.6 }); onUnlock?.('refilled'); flags('refills');
      return 'refilled';
    },
    /** the low-health / hurt feel on the camera: a flinch away from where the hit came from */
    flinch(from, k = 1) {
      if (!play) return;
      const m = C.shake();
      let side = 0;
      if (from) { const a = Math.atan2(from[2] - player.feet[2], from[0] - player.feet[0]); side = Math.sin(a - play.yaw); }
      S.flinchP += 0.035 * k * m; S.flinchY += -side * 0.03 * k * m; S.shake = Math.min(3, S.shake + 0.5 * k);
    },
    land(v) { const b = Math.max(0.4, Math.min(1, C.bob() + 0.3)); S.dip = Math.min(0.16 * b, S.dip + v * 0.012 * b); S.shake += Math.min(0.8, v * 0.05); },
    addShake(k) { S.shake = Math.min(4, S.shake + k); },
    save: () => ({ cur, arms: Object.fromEntries(ORDER.map((id) => [id, { mag: W[id].mag, reserve: W[id].reserve === Infinity ? -1 : W[id].reserve, owned: W[id].owned }])), mag: W.carbine.mag, reserve: W.carbine.reserve }),
    load(s) {
      if (s?.arms) for (const id of ORDER) { const x = s.arms[id]; if (!x) continue; W[id].mag = x.mag; W[id].reserve = x.reserve < 0 ? Infinity : x.reserve; W[id].owned = x.owned || (!ARM[id].locked); }
      else if (s) { W.carbine.mag = s.mag; W.carbine.reserve = s.reserve; }
      if (unlocked) for (const id of ['rocket', 'gatling']) W[id].owned = true;
      stopGatling(true); if (motor) { motor.stop(); motor = null; }
      const want = s?.cur && W[s.cur]?.owned ? s.cur : 'carbine';
      if (want !== cur) swap(want);
      Object.assign(S, { reloading: 0, reloadStep: '', bloom: 0, kick: 0, debtP: 0, debtY: 0, draw: 1, switching: null, spin: 0, heat: 0, vent: false, firing: false });
      for (const r of rockets) { r.live = false; r.o.visible = false; r.trail?.stop(); r.trail = null; }
    },
    dispose() { off(); stopGatling(true); motor?.stop(); },
  };
  game.set('weapon', cur);
  if (opts.unlocked) api.unlock(true);
  return api;
}

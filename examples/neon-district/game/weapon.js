// The carbine: a view model built from boxes that rides the camera, hit-scan rounds against Rapier (the world)
// and the sentinels' hit spheres, a recoil that climbs and recovers, spread that blooms with heat, aiming down the
// sight (the camera's field of view narrows), a reload with the magazine leaving the gun, a muzzle light and flash,
// tracers, sparks and a scorch where a round lands.
// The engine has no weapon layer: the view model is an ordinary lit object placed from the camera's matrix before
// every sub-frame (world.ctx.onUpdate), so the neon lights it and the temporal passes see its motion.
import * as THREE from 'three';
import { FX } from './fx.js';

export const GUN = { mag: 24, reserve: 96, max: 168, rate: 0.095, damage: 22, reload: 1.7, fov: 62, adsFov: 44 };

export function createWeapon({ world, root, vfx, sfx, physics, M, player, targets, hud, stats, onReload }) {
  const { mat, camera } = world;
  const holder = new THREE.Group(); holder.name = 'viewmodel'; root.add(holder);
  const gun = new THREE.Group(); holder.add(gun);
  const steel = M.steel, dark = mat.std({ color: new THREE.Color(0.028, 0.03, 0.036), roughness: 0.55, metalness: 0.6 }), body = mat.std({ color: new THREE.Color(0.07, 0.076, 0.088), roughness: 0.42, metalness: 0.75 });
  const glove = mat.std({ color: new THREE.Color(0.03, 0.03, 0.034), roughness: 0.75 }), sleeve = mat.std({ color: new THREE.Color(0.075, 0.085, 0.11), roughness: 0.9 });
  const part = (geo, m, p, r = [0, 0, 0], parent = gun) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; o.userData.occlude = false; parent.add(o); return o; };
  const RB = (w, h, d, r = 0.004) => new world.geom.RoundedBoxGeometry(w, h, d, 1, Math.min(r, 0.45 * Math.min(w, h, d)));
  // the gun points along -Z (the camera's view); metres
  part(RB(0.046, 0.07, 0.3, 0.008), body, [0, 0, -0.02]);                             // receiver
  part(RB(0.05, 0.03, 0.12), dark, [0, -0.02, -0.05]);                                // magazine well
  part(RB(0.04, 0.046, 0.3, 0.008), dark, [0, 0.006, -0.32]);                         // hand guard
  for (let i = 0; i < 5; i++) part(RB(0.042, 0.012, 0.022, 0.002), body, [0, 0.022, -0.2 - i * 0.055]);   // its vents
  part(new THREE.CylinderGeometry(0.0105, 0.0105, 0.22, 10).rotateX(Math.PI / 2), steel, [0, 0.008, -0.55]);
  part(new THREE.CylinderGeometry(0.017, 0.015, 0.075, 10).rotateX(Math.PI / 2), dark, [0, 0.008, -0.655]);   // muzzle brake
  part(RB(0.026, 0.01, 0.44, 0.002), dark, [0, 0.04, -0.13]);                         // top rail
  for (let i = 0; i < 9; i++) part(RB(0.03, 0.006, 0.014, 0.001), body, [0, 0.047, 0.05 - i * 0.045]);    // its teeth
  part(RB(0.04, 0.052, 0.2, 0.008), body, [0, -0.012, 0.215]);                        // stock
  part(RB(0.046, 0.085, 0.028, 0.006), dark, [0, -0.02, 0.325]);
  part(RB(0.034, 0.1, 0.044, 0.008), dark, [0, -0.076, 0.07], [0.3, 0, 0]);           // grip
  part(RB(0.012, 0.012, 0.05, 0.002), steel, [0.03, 0.012, 0.03]);                    // charging handle
  for (const s of [-1, 1]) part(RB(0.003, 0.007, 0.25, 0), M.neon.cyan, [s * 0.0212, 0.0, -0.32]);       // light strips
  // the sight: a hooded frame and a dot that is only lit when aiming
  part(RB(0.036, 0.016, 0.05, 0.003), dark, [0, 0.054, -0.07]);
  for (const s of [-1, 1]) part(RB(0.004, 0.036, 0.036, 0.001), dark, [s * 0.018, 0.078, -0.07]);
  part(RB(0.04, 0.004, 0.036, 0.001), dark, [0, 0.097, -0.07]);
  const dot = part(new THREE.SphereGeometry(0.0018, 8, 6), mat.glow([1, 0.1, 0.05], 12), [0, 0.0765, -0.07]);
  // the magazine: it leaves the gun in the reload
  const magazine = part(RB(0.028, 0.13, 0.058, 0.004), body, [0, -0.1, -0.06], [0.14, 0, 0]);
  const magHome = magazine.position.clone();
  // hands: the right on the grip, the left under the guard, a sleeve behind each
  const hands = new THREE.Group(); gun.add(hands);
  part(RB(0.05, 0.07, 0.08, 0.014), glove, [0.004, -0.082, 0.078], [0.3, 0, 0], hands);
  part(new THREE.CylinderGeometry(0.034, 0.046, 0.36, 12), sleeve, [0.045, -0.2, 0.235], [0.9, 0, -0.25], hands);
  const left = new THREE.Group(); hands.add(left);
  part(RB(0.058, 0.046, 0.1, 0.014), glove, [-0.008, -0.036, -0.3], [0, 0, 0.2], left);
  part(new THREE.CylinderGeometry(0.034, 0.046, 0.4, 12), sleeve, [-0.125, -0.155, -0.14], [1.1, 0, 0.75], left);
  gun.scale.setScalar(0.92);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.006, -0.7); gun.add(muzzle);
  // the muzzle light: one clustered lamp, dark between shots
  const flash = new THREE.PointLight(0xffb060, 0, 9, 2); root.add(flash);
  world.lighting?.addLight(flash);
  const flashGain = 14;
  // a small fill light that travels with the gun, so it reads against a dark street
  const fill = new THREE.PointLight(0x9fd8ff, 0, 1.4, 2); root.add(fill);
  world.lighting?.addLight(fill);

  const S = {
    mag: GUN.mag, reserve: GUN.reserve, cool: 0, heat: 0, reloading: 0, ads: 0, kick: 0, kickRot: 0, debt: 0, flashT: 0, bob: 0, swayX: 0, swayY: 0, tuck: 0, sprint: 0, draw: 1,
    fire: false, aim: false, wantReload: false, lastYaw: 0, lastPitch: 0, walked: 0, fov: GUN.fov, lean: 0, wantLean: 0, jab: 0,
  };
  let play = null, rnd = 0x1234567;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const applied = new THREE.Vector3(1e9, 0, 0);
  const fwd = new THREE.Vector3(), from = new THREE.Vector3(), mz = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function reload() {
    if (S.reloading > 0 || S.mag >= GUN.mag || S.reserve <= 0) return false;
    S.reloading = GUN.reload; sfx.play('nd_reload', { gain: 0.7 });
    return true;
  }
  function shoot() {
    S.mag--; S.cool = GUN.rate; stats.shots++;
    // where the round goes: the view direction, opened by the spread (tighter when aiming, wider when hot or moving)
    const spread = ((0.008 - 0.0055 * S.ads) + S.heat * 0.012 * (1 - 0.55 * S.ads) + Math.min(player.speed, 5) * 0.002) * (1 - 0.3 * player.crouch);
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spread;
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    right.crossVectors(fwd, up).normalize(); const upv = new THREE.Vector3().crossVectors(right, fwd);
    fwd.addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
    from.copy(camera.position);
    const o = from.toArray(), d = fwd.toArray();
    // the world (Rapier, with the normal for the sparks), then whoever stands in front of it
    const hit = physics.world.castRayAndGetNormal(new physics.R.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), 120, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider());
    const wt = hit ? hit.timeOfImpact ?? hit.toi : 120;
    const eh = targets.rayHit(o, d, wt);
    const t = eh ? eh.t : wt, end = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    muzzle.getWorldPosition(mz);
    vfx.beam({ from: mz.toArray(), to: end, width: 0.022, color: '#ffd9a0', intensity: 4, life: 0.055 });
    vfx.burst(FX.muzzle, mz, { direction: d, scale: 1 - 0.65 * S.ads });   // smaller down the sight: it sits in the middle of the view
    if (eh) {
      stats.lastHead = !!eh.head;
      const killed = eh.owner.damage(eh.e, GUN.damage, eh.head, eh.point, d);
      stats.hits++; if (eh.head) stats.heads++;
      hud.hit(killed ? 'kill' : eh.head ? 'head' : 'hit');
      sfx.play(killed ? 'nd_kill' : 'nd_hit', { gain: killed ? 0.8 : 0.55 });
    } else if (hit) {
      const n = hit.normal;
      vfx.burst(FX.impact, end, { direction: [n.x, n.y, n.z] });
      vfx.decal({ position: [end[0] + n.x * 0.02, end[1] + n.y * 0.02, end[2] + n.z * 0.02], normal: [n.x, n.y, n.z], size: 0.16 + R() * 0.08, depth: 0.2, pattern: 'scorch', life: 25, fade: 4, opacity: 0.85 });
      if (R() < 0.6) sfx.play('nd_impact', { at: end, gain: 0.5, ref: 3 });
    }
    sfx.play('nd_shot', { gain: 0.6, rate: 0.96 + R() * 0.08 });
    targets.noise(player.feet, 26);
    // recoil: the view climbs and wanders; most of the climb comes back (S.debt)
    const k = 1 - 0.4 * S.ads, climb = (0.0085 + 0.004 * Math.min(S.heat, 1)) * k, drift = (R() - 0.5) * 0.007 * k;
    play.pitch = Math.min(1.45, play.pitch + climb); play.yaw += drift; S.debt += climb * 0.85;
    S.kick = Math.min(1.6, S.kick + 1); S.heat = Math.min(1.4, S.heat + 0.16); S.flashT = 0.05;
    player.shake(0.25);
  }

  /** a strike with the stock: whoever is within arm's reach in front, hard; 0.6 s before the next */
  function melee() {
    if (S.jab > 0 || S.reloading > 0 || !play) return false;
    S.jab = 0.6; S.cool = Math.max(S.cool, 0.45);
    fwd.set(Math.cos(play.pitch) * Math.cos(play.yaw), Math.sin(play.pitch), Math.cos(play.pitch) * Math.sin(play.yaw));
    const o = camera.position.toArray(), d = fwd.toArray(), eh = targets.rayHit(o, d, 2.3);
    sfx.play('nd_impact', { gain: eh ? 0.9 : 0.35, rate: 0.5 });
    if (eh) { stats.lastHead = false; const killed = eh.owner.damage(eh.e, 85, false, eh.point, d); hud.hit(killed ? 'kill' : 'hit'); player.shake(0.5); stats.melee = (stats.melee || 0) + 1; }
    return true;
  }
  /** one fixed step of the game */
  function update(dt, alive) {
    S.cool -= dt; S.heat = Math.max(0, S.heat - dt * 1.3);
    if (S.debt > 0) { const b = Math.min(S.debt, dt * 0.09 + S.debt * dt * 5); play.pitch -= b; S.debt -= b; }
    if (S.reloading > 0) {
      S.reloading -= dt;
      if (S.reloading <= 0) { const n = Math.min(GUN.mag - S.mag, S.reserve); S.mag += n; S.reserve -= n; S.reloading = 0; onReload?.(); }
    }
    if (alive) {
      if (S.wantReload) { reload(); S.wantReload = false; }
      if (S.fire && S.reloading <= 0 && S.cool <= 0 && S.draw <= 0) {
        if (S.mag > 0) shoot();
        else { S.cool = 0.3; if (!reload()) sfx.play('nd_dry', { gain: 0.6 }); }
      }
    }
    const wantAds = alive && S.aim && S.reloading <= 0 ? 1 : 0;
    S.ads += (wantAds - S.ads) * Math.min(1, dt * 12);
    S.kick = Math.max(0, S.kick - dt * 9); S.flashT -= dt; S.jab = Math.max(0, S.jab - dt);
    S.draw = Math.max(0, S.draw - dt * 1.6);
    const sprinting = player.speed > 4.4 && !S.fire && !S.aim && S.reloading <= 0 ? 1 : 0;
    S.sprint += (sprinting - S.sprint) * Math.min(1, dt * 8);
    S.walked += player.speed * dt;
    return S.jab > 0 || S.kick > 0.001 || S.flashT > 0 || S.reloading > 0 || Math.abs(wantAds - S.ads) > 0.001;
  }

  /** before every sub-frame: put the view model on the camera and set the lens */
  function pose(dt) {
    if (!play) return;
    // the lens: aiming narrows it (after play wrote its own field of view for the frame)
    const fov = S.fov + (S.fov * (GUN.adsFov / GUN.fov) - S.fov) * S.ads;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // crouching and leaning move the eye: play writes the camera every frame, so the offset goes on once per frame
    // (a frame's later sub-frames find the camera where this left it)
    S.lean += (S.wantLean - S.lean) * Math.min(1, dt * 9);
    if (!camera.position.equals(applied) && (player.crouch > 0.001 || Math.abs(S.lean) > 0.001)) {
      right.set(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      // a lean stops short of a wall
      const side = physics.ray(camera.position.toArray(), right.clone().multiplyScalar(Math.sign(S.lean) || 1).toArray(), 0.7, player.collider());
      const reach = Math.min(0.42, side ? Math.max(0, side.distance - 0.22) : 0.42);
      camera.position.addScaledVector(right, S.lean * reach); camera.position.y -= player.crouch * 0.6;
      camera.rotateZ(-S.lean * 0.13); camera.updateMatrixWorld();
      applied.copy(camera.position);
    }
    holder.position.copy(camera.position); holder.quaternion.copy(camera.quaternion);
    // sway: the gun lags behind the view's turn, bobs with the walk
    const dy = play.yaw - S.lastYaw, dp = play.pitch - S.lastPitch; S.lastYaw = play.yaw; S.lastPitch = play.pitch;
    const k = Math.min(1, dt * 10);
    S.swayX += (THREE.MathUtils.clamp(-dy * 1.2, -0.05, 0.05) - S.swayX) * k; S.swayY += (THREE.MathUtils.clamp(dp * 1.2, -0.05, 0.05) - S.swayY) * k;
    const bobK = Math.min(player.speed / 3.4, 1.4) * (1 - 0.85 * S.ads), ph = S.walked * 2.3;
    const bx = Math.sin(ph) * 0.006 * bobK, by = -Math.abs(Math.cos(ph)) * 0.007 * bobK;
    // near a wall the gun comes back so the barrel does not go through it
    const ahead = physics.ray(camera.position.toArray(), camera.getWorldDirection(fwd).toArray(), 1.2, player.collider());
    const tuck = ahead ? THREE.MathUtils.clamp((0.95 - ahead.distance) / 0.6, 0, 1) : 0;
    S.tuck += (tuck - S.tuck) * Math.min(1, dt * 12);
    // the reload: tilt, magazine out and back, level again
    let tilt = 0, magOut = 0;
    if (S.reloading > 0) { const u = 1 - S.reloading / GUN.reload; tilt = THREE.MathUtils.smoothstep(u, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1)); magOut = THREE.MathUtils.smoothstep(u, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(u, 0.5, 0.68)); }
    const a = S.ads, low = Math.max(S.sprint, S.draw), jab = S.jab > 0 ? Math.sin(Math.PI * Math.min(1, (0.6 - S.jab) / 0.32)) * (S.jab > 0.28 ? 1 : 0) : 0;
    gun.position.set(THREE.MathUtils.lerp(0.17, 0, a) + bx + S.swayX * 0.6 + tilt * 0.03, THREE.MathUtils.lerp(-0.17, -0.0704, a) + by + S.swayY * 0.4 - tilt * 0.05 - low * 0.11 - S.tuck * 0.03,
      THREE.MathUtils.lerp(-0.28, -0.12, a) + S.kick * 0.022 * (1 - 0.5 * a) + S.tuck * 0.2 - jab * 0.22);
    gun.rotation.set(S.kick * 0.03 * (1 - 0.6 * a) + S.swayY + tilt * 0.35 - low * 0.5 + S.tuck * 0.5 + jab * 0.25, S.swayX + tilt * 0.3 + low * 0.45 + (1 - a) * 0.03 + jab * 0.9, -tilt * 0.6 + S.swayX * 1.5 + low * 0.2);
    magazine.position.copy(magHome); magazine.position.y -= magOut * 0.22; magazine.visible = magOut < 0.98;
    left.position.set(0, -magOut * 0.2, magOut * 0.2);
    dot.visible = a > 0.5;
    holder.updateMatrixWorld(true);
    muzzle.getWorldPosition(mz);
    fill.position.copy(holder.position).addScaledVector(fwd.set(0.25, 0.12, -0.25).applyQuaternion(holder.quaternion), 1);
    flash.position.copy(mz); const room = Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);   // these two do not go out by day
    fill.intensity = 0.16 * room;
    flash.intensity = S.flashT > 0 ? flashGain * room * (0.6 + 0.4 * R()) * (1 - 0.6 * S.ads) : 0;
  }
  let last = -1;
  const off = world.ctx.onUpdate((t) => { const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, t - last)); last = t; pose(dt); });

  return {
    S, holder, reload, update, melee,
    start(p) { play = p; S.lastYaw = p.yaw; S.lastPitch = p.pitch; },
    give(n) { const b = S.reserve; S.reserve = Math.min(GUN.max, S.reserve + n); return S.reserve - b; },
    save: () => ({ mag: S.mag, reserve: S.reserve }),
    load(s) { S.mag = s.mag; S.reserve = s.reserve; S.reloading = 0; S.heat = 0; S.kick = 0; S.debt = 0; S.draw = 1; },
    dispose() { off(); },
  };
}

// The hack: the signature of neon-district. Hold the hack key while looking at something of the city's within 25 m:
// a ring fills (0.8 s) and the city does it. A charge meter (three pips, one back every 8 s) pays for it.
//   lights    a street lamp, or a breaker box (a room, the alley, the roof): every lamp in that zone goes out for 12 s,
//             the pool lamps and the clustered lights and the signs' faces with them. In the dark the sentinels see a
//             third as far, hit far less, and those fighting near it lose the player and go looking (enemies.darken);
//             the player's visor raises the robots' rim and marks the ones in the dark.
//   sign      an overload: the sign bursts in an EMP that stuns every robot within 6 m for 4 s (sparks, aim dropped,
//             shields down), and goes dark itself for a while
//   vent      a steam cloud for 10 s that no sentinel sees through (enemies.env.blind)
//   car       the alarm: whoever is awake within 26 m and not on the player goes to look at the car for a while
//   kite      turned for 15 s: it hunts sentinels, then burns out (drones.turn)
//   sentinel  two pips: its weapon jams for 5 s (a shield drops with it); a warden only from behind or stunned
// While the key is held the scan view is on: holo brackets on what can be hacked, robots within 30 m marked through
// walls (and for 2 s after). API for touch buttons: start(), cancel(), target(), charges, max, progress, held.
import * as THREE from 'three';
import { FX } from './fx.js';

const RANGE = 25, FILL = 0.8, MAX = 3, REGEN = 8, DARK_S = 12;
export const FXC = {
  // the cloud a vent blows: dense, slow, big
  cloud: { name: 'nd-cloud', rate: 34, life: [3, 4.5], shape: { type: 'sphere', radius: 1.2 }, velocity: { speed: [0.3, 0.9], spread: 80 }, gravity: 0.15, drag: 0.8, turbulence: { strength: 0.5, scale: 1.4, speed: 0.4 },
    size: [1.1, 1.7], sizeOverLife: [[0, 0.5], [0.4, 1.4], [1, 2.2]], color: [[0, '#b8c8d4'], [1, '#6a747e']], alpha: [[0, 0], [0.15, 0.32], [0.7, 0.22], [1, 0]], rotation: [0, 360], spin: [-12, 12],
    render: { blend: 'alpha', soft: 0.8, nearFade: 1.2, sort: 'oldest', flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
  // an EMP: a ring of blue sparks along the ground and a flash
  emp: { name: 'nd-emp', emitters: [
    { name: 'ring', bursts: [{ time: 0, count: 90 }], duration: 0.05, life: [0.3, 0.7], shape: { type: 'ring', radius: 0.3 }, velocity: { speed: [6, 11], normal: [0, 0.4], spread: 6 }, drag: 3, size: [0.02, 0.04],
      color: [[0, '#e8fbff'], [0.5, '#58b8ff'], [1, '#2030c0']], alpha: [[0, 1], [1, 0]], emissive: 9, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.03 } },
    { name: 'flash', bursts: [{ time: 0, count: 3 }], duration: 0.05, life: [0.12, 0.2], size: [1.6, 2.6], color: '#9fdcff', alpha: [[0, 0.9], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'soft' } },
  ] },
  // the hack landing: a few cyan motes at the target
  zap: { name: 'nd-zap', bursts: [{ time: 0, count: 24 }], duration: 0.05, life: [0.25, 0.5], shape: { type: 'sphere', radius: 0.25 }, velocity: { speed: [0.5, 2.5], spread: 180 }, drag: 2, size: [0.02, 0.04],
    color: [[0, '#ffffff'], [1, '#19d8ff']], alpha: [[0, 1], [1, 0]], emissive: 8, render: { blend: 'add', sprite: 'star' } },
};

export function createHack({ world, game, plan, anchors, shared, lamps, enemies, drones, player, vfx, sfx, physics, root, T, overlay, onPop }) {
  const K = plan.levels, X = T.xt, camera = world.camera;
  const targets = [];
  const sq = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  // ---- what can be hacked: the city's own things (the modules' anchors and the plan), and the robots
  const faces = [];
  world.scene.getObjectByName('sign-faces')?.traverse((o) => { if (o.isMesh && o.material?.color) { const p = o.getWorldPosition(new THREE.Vector3()).toArray(); faces.push({ mesh: o, pos: p, c0: o.material.color.clone(), k: 1 }); } });
  const clustered = (shared.lamps || []).map(({ light }) => ({ light, pos: light.position.toArray(), nd: light.userData.nd }));
  const inZone = (z, p) => z.rect ? p[0] > z.rect[0] && p[0] < z.rect[2] && p[2] > z.rect[1] && p[2] < z.rect[3] && p[1] > z.y[0] && p[1] < z.y[1] : sq(p, z.c) < z.r && p[1] < z.y1;
  const lightTarget = (id, pos, zone) => {
    const t = { id, kind: 'lights', pos, zone, dark: 0, cool: 0, k: 1, pool: [], lights: [], faces: [] };
    lamps.base.forEach((l, i) => { if (inZone(zone, l.pos)) t.pool.push(i); });
    for (const c of clustered) if (inZone(zone, c.pos)) t.lights.push(c);
    for (const f of faces) if (inZone(zone, f.pos)) t.faces.push(f);
    targets.push(t);
  };
  // a street lamp's panel is a shared neon material: a dark cover slides under it while its zone is out
  const coverMat = world.mat.std({ color: new THREE.Color(0.01, 0.01, 0.012), roughness: 0.6 });
  for (const [i, [x, z, side]] of plan.lamps.entries()) {
    lightTarget('lamp' + i, [x, K.kerb + 4.86, z + side * 1.45], { c: [x, z + side * 1.45], r: 8.5, y1: 9 });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.66), coverMat); cover.position.set(x, K.kerb + 5.4 - 0.155, z + side * 1.45); cover.visible = false; cover.userData.collide = false; root.add(cover);
    targets[targets.length - 1].cover = cover;
  }
  // breaker boxes: a grey box on the wall with a lit status strip (green: live, red: tripped)
  const boxMat = world.mat.std({ color: new THREE.Color(0.12, 0.13, 0.14), roughness: 0.5, metalness: 0.7 });
  const ledOn = world.mat.glow([0.2, 1, 0.4], 6), ledOff = world.mat.glow([1, 0.15, 0.1], 6);
  for (const b of plan.hack?.breakers || []) {
    const g = new THREE.Group(), yaw = Math.atan2(b.face[0], b.face[2]);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.14), boxMat); box.position.z = 0.07;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.02), ledOn); led.position.set(0, 0.18, 0.15);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.02), ledOn); bolt.position.set(0, -0.04, 0.15); bolt.rotation.z = 0.5;
    g.add(box, led, bolt); g.position.set(...b.at); g.rotation.y = yaw; g.traverse((o) => { o.userData.collide = false; }); root.add(g);
    lightTarget('breaker-' + b.id, [b.at[0] + b.face[0] * 0.15, b.at[1], b.at[2] + b.face[2] * 0.15], { rect: b.rect, y: b.y });
    targets[targets.length - 1].leds = [led, bolt];
  }
  for (const [i, s] of (anchors.signs || []).entries()) if (s.pos[1] < 9.5) targets.push({ id: 'sign' + i, kind: 'sign', pos: s.pos, cool: 0, faces: faces.filter((f) => Math.hypot(f.pos[0] - s.pos[0], f.pos[1] - s.pos[1], f.pos[2] - s.pos[2]) < Math.max(s.w, s.h) * 0.6 + 0.6) });
  for (const [i, a] of (anchors.steam || []).entries()) targets.push({ id: 'vent' + i, kind: 'vent', pos: a.pos, cool: 0 });
  for (const [i, c] of (anchors.cars || []).entries()) targets.push({ id: 'car' + i, kind: 'car', pos: [c.pos[0], c.pos[1] - 0.7, c.pos[2]], cool: 0 });
  const robots = () => {
    const out = [];
    for (const e of drones.list) if (!e.dead && e.o.visible && !(e.turned > 0)) out.push({ id: e.id, kind: 'kite', pos: e.pos, e, cost: 1 });
    for (const e of enemies.list) if (!e.dead && e.active && e.rig.root.visible) out.push({ id: e.id, kind: 'sentinel', pos: [e.pos[0], e.pos[1] + 1.3 * e.K.scale, e.pos[2]], e, cost: 2 });
    return out;
  };

  // ---- the state
  const S = { charge: MAX, held: false, spent: false, cur: null, prog: 0, scanT: 0, free: false, refused: '', refuseT: 0, count: 0 };
  const clouds = [], alarms = [];
  const alarmLight = new THREE.PointLight(0xffa020, 0, 9, 2); root.add(alarmLight); world.lighting?.addLight(alarmLight);
  const flashLight = new THREE.PointLight(0x80c8ff, 0, 12, 2); root.add(flashLight); world.lighting?.addLight(flashLight);
  let flashT = 0;
  const room = () => Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);

  // the dark: a zone's factor k eases out with a stutter and comes back with one
  const darkFactor = (t) => {
    if (t.dark <= 0) return 1;
    const age = DARK_S - t.dark;
    if (age < 0.5) return Math.sin(age * 60) > 0 ? 0.6 : 0.05;     // the stutter as it goes
    if (t.dark < 0.7) return Math.sin(t.dark * 45) > 0 ? 0.8 : 0.1; // and as it comes back
    return 0.03;
  };
  function applyLights() {
    const ks = new Map(), fk = new Map(), pk = new Float32Array(lamps.scale.length).fill(1);
    for (const t of targets) {
      if (t.kind !== 'lights') continue;
      const k = darkFactor(t);
      if (k === t.k && k === 1) continue;
      t.k = k;
      for (const i of t.pool) pk[i] = Math.min(pk[i], k);
      for (const c of t.lights) ks.set(c, Math.min(ks.get(c) ?? 1, k));
      for (const f of t.faces) fk.set(f, Math.min(fk.get(f) ?? 1, Math.max(k, 0.05)));
      if (t.leds) for (const l of t.leds) l.material = t.dark > 0 ? ledOff : ledOn;
      if (t.cover) t.cover.visible = k < 0.5;
    }
    let changed = false;
    for (let i = 0; i < pk.length; i++) if (lamps.scale[i] !== pk[i]) { lamps.scale[i] = pk[i]; changed = true; }
    if (changed) lamps.touch();
    // (ndOff and f.off: what the destructibles set for a lamp or a sign face that was shot out, destruct.js; a hack's
    // lights coming back leave those dark)
    for (const c of clustered) c.light.userData.nd = c.nd * (ks.get(c) ?? 1) * (c.light.userData.ndOff ?? 1);   // main.js relight() turns nd into the lamp's intensity
    for (const f of faces) { const k = Math.min(fk.get(f) ?? 1, f.k) * (f.off ?? 1); f.mesh.material.color.copy(f.c0).multiplyScalar(k); }
  }
  /** 0..1: is this point in a dark zone (a hack's, or one whose lamps were shot out: api.extraDark, destruct.js) */
  function dark(p) { for (const t of targets) if (t.kind === 'lights' && t.dark > 0.7 && DARK_S - t.dark > 0.3 && inZone(t.zone, p)) return 1; return api.extraDark ? api.extraDark(p) : 0; }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  /** does the segment from a sentinel's eye to the player cross a steam cloud */
  function blind(from, to) {
    if (api.extraBlind && api.extraBlind(from, to)) return true;   // steam, spray or an extinguisher's cloud from a prop that was shot (destruct.js)
    if (!clouds.length) return false;
    _a.set(from[0], from[1] + 1.5, from[2]); _b.set(to[0], to[1] + 1.2, to[2]);
    const len = _a.distanceTo(_b), d = _b.sub(_a).divideScalar(len || 1);
    for (const c of clouds) {
      _c.fromArray(c.pos).sub(_a); const t = Math.max(0, Math.min(len, _c.dot(d)));
      if (_c.addScaledVector(d, -t).length() < c.r) return true;
    }
    return false;
  }
  enemies.env.dark = dark; enemies.env.blind = blind; drones.env.dark = dark;

  // ---- doing it
  function fire(t) {
    const p = t.pos;
    vfx.burst(FXC.zap, p);
    sfx.play('nd_hacked', { gain: 0.7 });
    if (t.kind === 'lights') {
      t.dark = DARK_S; t.cool = DARK_S + 3; sfx.play('nd_dark', { at: p, gain: 1, ref: 8 });
      const c = t.zone.rect ? [(t.zone.rect[0] + t.zone.rect[2]) / 2, p[1], (t.zone.rect[1] + t.zone.rect[3]) / 2] : [t.zone.c[0], p[1], t.zone.c[1]];
      enemies.darken(c, t.zone.rect ? Math.hypot(t.zone.rect[2] - t.zone.rect[0], t.zone.rect[3] - t.zone.rect[1]) / 2 : t.zone.r);
      game.set('hackLights', (game.flags.hackLights || 0) + 1);
    } else if (t.kind === 'sign') {
      t.cool = 20; t.dark = 5;
      const n = enemies.stunAt(p, 6.5, 4) + drones.stunAt(p, 6.5, 4);
      vfx.burst(FXC.emp, [p[0], Math.max(p[1] - 1.5, player.feet[1] + 0.5), p[2]]); vfx.burst(FX.sparks, p, { direction: [0, -1, 0] });
      flashLight.position.set(...p); flashT = 0.25; sfx.play('nd_emp', { at: p, gain: 1, ref: 8 }); onPop('overload', p);
      game.set('stunned', (game.flags.stunned || 0) + n);
    } else if (t.kind === 'vent') {
      t.cool = 16;
      const at = [p[0], p[1] + 1.4, p[2]], h = vfx.spawn(FXC.cloud, { position: at });
      clouds.push({ pos: at, r: 3.2, t: 10, h }); sfx.play('nd_steam', { at, gain: 1.2, ref: 5 });
      game.set('hackVents', (game.flags.hackVents || 0) + 1);
    } else if (t.kind === 'car') {
      t.cool = 25;
      alarms.push({ pos: [p[0], p[1] + 0.4, p[2]], t: 8, beep: 0 });
      game.set('lured', (game.flags.lured || 0) + enemies.lure(p, 26));
    } else if (t.kind === 'kite') {
      drones.turn(t.e, 15); game.set('kitesTurned', (game.flags.kitesTurned || 0) + 1);
    } else if (t.kind === 'sentinel') {
      enemies.jam(t.e, 5); game.set('jammed', (game.flags.jammed || 0) + 1);
    }
    S.count++; game.set('hacks', S.count);
    api.onHack?.(t);
  }
  /** the target under the crosshair: the nearest in angle within its own size, with a line of sight (sticky: the one
   *  being filled holds while it stays within twice that) */
  function pick() {
    const cam = camera.position, fwd = camera.getWorldDirection(_a);
    let best = null, bestK = 1;
    const consider = (t) => {
      const dx = t.pos[0] - cam.x, dy = t.pos[1] - cam.y, dz = t.pos[2] - cam.z, d = Math.hypot(dx, dy, dz);
      if (d > RANGE || d < 0.3) return;
      const ang = Math.acos(Math.min(1, (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d)), size = Math.atan((t.kind === 'lights' || t.kind === 'car' ? 1.3 : 0.9) / d) + 0.04;
      const k = ang / (size * (S.cur && S.cur.id === t.id ? 2.4 : 1));
      if (k >= bestK) return;
      const hit = physics.ray([cam.x, cam.y, cam.z], [dx / d, dy / d, dz / d], d, player.collider());
      if (hit && hit.distance < d - 0.9) return;
      best = t; bestK = k;
    };
    for (const t of targets) consider(t);
    for (const t of robots()) consider(t);
    return best;
  }
  const costOf = (t) => (t.cost || 1);
  /** why it cannot be hacked now ('' if it can) */
  function refusal(t) {
    if (t.cool > 0) return X.cooling;
    if (t.kind === 'sentinel' && !enemies.hackable(t.e, player.feet)) return X.front;
    if (!S.free && Math.floor(S.charge) < costOf(t)) return X.noCharge;
    return '';
  }

  /** one fixed step; live: the player can act */
  function update(dt, live) {
    S.charge = Math.min(MAX, S.charge + dt / REGEN);
    for (const t of targets) { t.cool = Math.max(0, t.cool - dt); if (t.dark > 0) t.dark -= dt; }
    // a sign that overloaded flickers dark, then lights again
    for (const t of targets) if (t.kind === 'sign') { const k = t.dark > 0 ? (Math.sin(game.time * 37 + t.dark * 9) > 0.6 ? 0.5 : 0.04) : 1; for (const f of t.faces) f.k = k; }
    applyLights();
    for (let i = clouds.length - 1; i >= 0; i--) if ((clouds[i].t -= dt) <= 0) { clouds[i].h.stop(); clouds.splice(i, 1); }
    let blink = 0;
    for (let i = alarms.length - 1; i >= 0; i--) {
      const a = alarms[i]; a.t -= dt;
      if ((a.beep -= dt) <= 0) { a.beep = 0.8; sfx.play('nd_caralarm', { at: a.pos, gain: 1, ref: 7 }); }
      alarmLight.position.set(...a.pos); blink = Math.sin(game.time * 14) > 0 ? 1 : 0;
      if (a.t <= 0) alarms.splice(i, 1);
    }
    alarmLight.intensity = blink * 18 * room();
    flashT = Math.max(0, flashT - dt); flashLight.intensity = flashT > 0 ? 260 * room() * flashT : 0;
    S.refuseT = Math.max(0, S.refuseT - dt);
    S.scanT = Math.max(0, S.scanT - dt);
    if (!live || !S.held) { S.cur = null; S.prog = 0; return; }
    S.scanT = 2;
    if (S.spent) return;
    const t = pick();
    if (!t || !S.cur || t.id !== S.cur.id) { S.cur = t; S.prog = 0; if (t) sfx.play('nd_hack', { gain: 0.5 }); }
    if (!t) return;
    if (t.kind === 'kite') t.e.grip = 0.15;   // the hack holds a kite still while the ring fills
    const why = refusal(t);
    if (why) { S.prog = 0; S.refused = why; return; }
    S.refused = '';
    S.prog += dt / FILL;
    if (S.prog >= 1) {
      if (!S.free) S.charge -= costOf(t);
      fire(t); S.prog = 0; S.spent = true; S.cur = null;
    }
  }
  /** the HUD's part, once a display frame */
  function draw() {
    const scan = S.held || S.scanT > 0;
    const items = scan ? [...targets.map((t) => ({ pos: t.pos, kind: t.kind, used: t.cool > 0, sel: S.cur?.id === t.id })), ...robots().map((t) => ({ pos: t.pos, kind: t.kind, sel: S.cur?.id === t.id }))] : [];
    const t = S.held ? S.cur : null, why = t ? refusal(t) : '';
    overlay.hack({ scan: S.held, items, progress: t ? S.prog : null, label: t ? X.kinds[t.kind] : '', sub: t ? (why || (S.free ? X.over : X.cost(costOf(t)))) : '', bad: !!why });
  }
  /** after a checkpoint: lights on, clouds and alarms gone, the meter full */
  function reset() {
    for (const t of targets) { t.dark = 0; t.cool = 0; }
    for (const c of clouds) c.h.stop();
    clouds.length = 0; alarms.length = 0; S.charge = MAX; S.held = false; S.spent = false; S.cur = null; S.prog = 0;
    for (const f of faces) f.k = 1;
    applyLights();
  }
  game.add({ id: 'hack', save: () => ({ n: S.count }), load: () => reset() });

  const api = {
    S, targets, update, draw, reset, dark, blind, faces, clustered, inZone, applyLights, extraDark: null, extraBlind: null,
    /** touch / keys: start holding the hack; cancel() lets go */
    start() { S.held = true; S.spent = false; },
    cancel() { S.held = false; S.spent = false; S.cur = null; S.prog = 0; },
    /** what the crosshair is on now: { id, kind, cost, refusal } or null */
    target() { const t = S.cur; return t ? { id: t.id, kind: t.kind, cost: costOf(t), refusal: refusal(t) } : null; },
    get held() { return S.held; }, get progress() { return S.prog; },
    get charges() { return Math.floor(S.charge); }, get chargeFrac() { return S.charge % 1; }, max: MAX,
    get free() { return S.free; }, set free(v) { S.free = v; },
    /** robots the scan marks through walls */
    get scanning() { return S.held || S.scanT > 0; },
    /** how many zones are dark now */
    get darkZones() { return targets.filter((t) => t.kind === 'lights' && t.dark > 0).length; },
    /** every sign on the street stutters for `sec` seconds (the story's ending) */
    flickerAll(sec) { for (const t of targets) if (t.kind === 'sign') t.dark = Math.max(t.dark, sec); },
    onHack: null,
  };
  return api;
}

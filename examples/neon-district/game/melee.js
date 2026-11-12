// Close combat: the robots that fight hand to hand, on enemies.js's rigs, brains and hits (it calls in here at a few
// places: a kind's build, its fight, a hit taken, the boss's whole brain).
//   brawler   martial-arts robot: closes in, chains 2-3 strikes (jab, cross, a front kick that knocks back), raises a
//             crossed-forearm guard against fire from the front (a fifth of the damage; three blocked hits or a heavy
//             one break it: a stagger), staggers like the rest
//   blade     sword robot: closes in, a diagonal slash and a sweep, or a lunging thrust from further out
//   ronin     the swordsman (boss.js): a draw from the scabbard in every move; the player's ally once beaten
//   bulwark   the heavy chassis of New Game+ (heavy.js)
// Every strike: a wind-up the player can read (the visor flares, a swish), an active moment checked once against
// reach and an arc in front, a recovery. Dodged by the dash's grace, a low cut also by being in the air.
// Poses: the cyber kit's MOVES (keyframed, body space) put on the rig after the clips each step (two-bone IK for arms
// and legs, the hand turned so the blade points where the key says), blended in and out.
// The player's side: a launch (the character's opt-in `push`, @miragekit/game), the camera kicked, a short slow beat.
import * as THREE from 'three';
import { solveTwoBone } from '@miragekit/play';
import { bladeParts, scabbardParts, roninParts, MOVES, samplePoseKeys, CUT_AXIS } from '@miragekit/assets/kits/cyber';
import { FX } from './fx.js';
import { createBoss } from './boss.js';
import { createHeavy, heavyParts } from './heavy.js';
import { createCallouts } from './callout.js';

const COLORS = { skin: 0x14171b, shirt: 0x1b2026, trousers: 0x181c21, boots: 0x0c0d0f, hair: 0x14171b };
const base = { damage: 0, burst: 0, fire: 0, colors: COLORS };
export const MELEE_KIND = {
  brawler: { ...base, name: 'brawler', look: 'sentinel', melee: 'fist', kit: { grip: 1, grip2: 1 }, numbers: ['n6', 'n7'], hp: 75, speed: 3.9, tele: 0.3, range: 22, visor: [1.0, 0.45, 0.04], scale: 1.0 },
  blade: { ...base, name: 'blade', look: 'sentinel', melee: 'sword', kit: { grip: 0.95 }, numbers: ['n2', 'n5'], hp: 80, speed: 3.4, tele: 0.4, range: 22, visor: [1.0, 0.1, 0.16], scale: 1.02 },
  ronin: { ...base, name: 'ronin', look: 'sentinel', melee: 'iai', boss: true, kit: { grip: 0.95, grip2: 0.7 }, numbers: ['n7'], hp: 700, speed: 3.1, tele: 0.45, range: 34, visor: [1.0, 0.05, 0.12], scale: 1.12, eye: 1.75 },
  bulwark: { ...base, name: 'bulwark', look: 'warden', melee: 'heavy', boss: true, kit: { grip: 1, grip2: 1 }, numbers: ['n4'], hp: 1500, speed: 3.4, tele: 0.5, range: 40, visor: [1.0, 0.35, 0.02], scale: 1.42, eye: 2.3 },
};
// a strike's reach (m at scale 1), half-arc (rad), damage, knock-back (m/s) and lift (m/s); low: a jump clears it
const STRIKE = {
  jab: { reach: 1.75, arc: 0.9, dmg: 6 }, cross: { reach: 1.8, arc: 0.9, dmg: 8 }, kick: { reach: 1.9, arc: 0.8, dmg: 12, knock: 5, up: 2 },
  slash: { reach: 2.2, arc: 1.1, dmg: 10 }, sweep: { reach: 2.3, arc: 1.4, dmg: 12, low: true }, thrust: { reach: 2.0, arc: 0.45, dmg: 14, knock: 3 },
};
const COMBOS = { fist: [['jab', 'cross'], ['jab', 'jab', 'cross'], ['cross', 'kick'], ['jab', 'cross', 'kick']], sword: [['slash', 'sweep'], ['sweep', 'slash'], ['slash']] };
const LUNGE = { thrust: [0.4, 0.52, 1.9], kick: [0.36, 0.5, 0.4], slash: [0.4, 0.5, 0.5], cross: [0.26, 0.38, 0.3] };   // [from, to, metres]
// the bones a pose writes (and blends back over the clips' pose)
const POSED = ['Hips', 'Spine', 'Chest', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];

/** close combat for createEnemies; ctx: { world, game, player, vfx, sfx, tune, assist, plain, R, list, damage, nav(), walk(), on } */
export function createMelee(ctx) {
  const { world, game, player, vfx, sfx, tune, assist, plain, R, list } = ctx;
  const mat = world.mat;
  const edgeMat = mat.glow([0.55, 0.85, 1.0], 3, {}), redMat = mat.glow([1.0, 0.08, 0.1], 5, {}), sabreEdge = mat.glow([1.0, 0.15, 0.1], 3, {});
  const ui = createCallouts();
  ctx.onDispose?.(() => ui.dispose());
  const S = { slow: 1, slowT: 0, flags: {} };
  const on = { radio: () => {}, say: () => {} };   // story.js: the radio and a line over a robot's head
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), E = new THREE.Euler();
  const flag = (k, n = 1) => game.set(k, (game.flags[k] || 0) + n);

  // ---- the kit on the rig
  /** what goes into humanoidMeshes' extra for a kind: { extra, key } */
  function extraParts(K) {
    if (K.melee === 'iai') return { extra: roninParts(), key: 'ronin' };
    if (K.melee === 'heavy') return { extra: heavyParts(), key: 'bulwark' };
    return { extra: {}, key: 'melee-' + K.melee };
  }
  const meshes = (g, mats) => { const o = new THREE.Group(); for (const [k, m] of mats) if (g[k]) { const x = new THREE.Mesh(g[k], m); x.castShadow = k !== 'l'; x.userData.occlude = false; x.userData.collide = false; x.name = 'robot-gun'; o.add(x); } return o; };
  const KATANA = bladeParts('katana'), SABRE = bladeParts('sabre'), SAYA = scabbardParts();
  // the scabbard on the left hip, mouth forward and up a little, edge up (in the Hips bone's frame)
  const SAYA_POS = new THREE.Vector3(0.17, -0.03, 0.11);
  const SAYA_Q = new THREE.Quaternion();
  { const y = new THREE.Vector3(0.06, -0.33, -1).normalize(), z = new THREE.Vector3(0, 1, 0).addScaledVector(y, -y.y).normalize(), x = new THREE.Vector3().crossVectors(y, z); SAYA_Q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); }
  /** after build(): the blades, the scabbard, the pose layer (on the animator's post hooks, after the clips and the feet) */
  function equip(e) {
    const K = e.K, B = e.rig.bones;
    const m = e.mm = { move: null, t: 0, w: 0, base: K.melee === 'fist' || K.melee === 'heavy' ? 'fists' : K.melee === 'sword' ? 'sabre' : 'guard', P: {}, ev: 0, cool: 1 + R(), block: 0, blockCool: 0, blocked: 0, queue: [], face: null, lift: 0, sheathed: null, sayaAt: null, tipPrev: null, trail: 0, perch: null };
    if (K.melee === 'sword') { m.sword = meshes(SABRE, [['s', plain.shell], ['m', plain.metal], ['l', sabreEdge]]); B.RightHand.add(m.sword); m.sword.position.set(0, 0.1, 0); m.blade = 0.62; }
    if (K.melee === 'iai') {
      m.sword = meshes(KATANA, [['s', plain.shell], ['m', plain.metal], ['l', edgeMat]]); m.blade = 0.8;
      m.saya = meshes(SAYA, [['s', plain.shell], ['l', redMat]]);
      B.Hips.add(m.saya); m.saya.position.copy(SAYA_POS); m.saya.quaternion.copy(SAYA_Q); m.sayaAt = 'hip';
      m.saya.add(m.sword); m.sheathed = 0;
    }
    e.anim.post.push((a) => pose(e, a.dt));
    game.add({ id: 'melee-' + e.id, save: () => ({}), load: () => reset(e) });
  }
  function reset(e) { const m = e.mm; m.move = null; m.t = 0; m.queue.length = 0; m.block = 0; m.lift = 0; m.perch = null; e.charge = 0; m.open = false; }
  /** the current pose on the bones (the move's, else the kind's guard), blended over what the clips made */
  const baseQ = Object.fromEntries(POSED.map((n) => [n, new THREE.Quaternion()])), baseHip = new THREE.Vector3();
  function pose(e, dt) {
    const m = e.mm;
    if (m.lift) { e.rig.root.position.y += m.lift; }
    if (m.perch) e.rig.root.position.set(m.perch[0], m.perch[1], m.perch[2]);
    const want = e.dead && !m.move ? 0 : e.stagger > 0 || e.stun > 0 ? 0 : 1;
    if ((e.stagger > 0 || e.dead) && m.move && !e.K.boss) { m.move = null; m.queue.length = 0; e.charge = 0; }
    m.w += (want - m.w) * Math.min(1, dt * 12);
    if (m.w < 0.01) { placeKit(e, null); return; }
    const mv = MOVES[m.move || m.base];
    samplePoseKeys(mv, m.t, m.P);
    apply(e, m.P, m.w, !!mv.arms);
  }
  const tq = new THREE.Quaternion();
  function apply(e, P, w, armsOnly) {
    const B = e.rig.bones, root = e.rig.root, m = e.mm;
    for (const n of POSED) baseQ[n].copy(B[n].quaternion);
    baseHip.copy(B.Hips.position);
    if (!armsOnly) {
      B.Hips.position.set(P.hip[0], 0.95 + P.hip[1], P.hip[2]);
      B.Hips.quaternion.setFromEuler(E.set(P.lean * 0.4, P.turn, P.side, 'YXZ'));
      B.Spine.quaternion.setFromEuler(E.set(P.lean * 0.3, P.twist * 0.5, 0, 'YXZ'));
      B.Chest.quaternion.setFromEuler(E.set(P.lean * 0.3, P.twist * 0.5, 0, 'YXZ'));
    }
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(q2);   // the body's frame in the world
    if (!armsOnly) for (const [S, f] of [['Left', P.lf], ['Right', P.rf]]) {
      if (!f) continue;
      const up = B[S + 'UpLeg'], foot = B[S + 'Foot'];
      solveTwoBone(up, B[S + 'Leg'], foot, root.localToWorld(v.set(f[0], 0.08 + (f[2] || 0), f[1])), { pole: root.localToWorld(v2.set(f[0], 0.6, f[1] + 0.9)) });
      foot.parent.getWorldQuaternion(q).invert(); foot.quaternion.copy(q).multiply(q2); B[S + 'Toe'].quaternion.identity();
      foot.updateWorldMatrix(false, true);
    }
    // the kit where the key says (the blade in the hand or the scabbard, the scabbard on the hip or in the left hand)
    placeKit(e, P);
    // the right hand
    let rt = null, rq = null;
    if (m.saya && P.sheath != null && m.sayaAt === 'hip') {
      m.saya.updateWorldMatrix(true, false);
      rt = m.saya.localToWorld(v3.set(0, -0.1 - P.sheath, 0)); rq = m.saya.getWorldQuaternion(q);
    } else if (Array.isArray(P.rh)) { rt = root.localToWorld(v3.set(...P.rh)); if (P.dir) rq = basis(P.dir, P.cut, q2, q); }
    if (rt) arm(e, 'Right', rt, rq);
    // the left hand
    let lt = null, lq = null;
    if (P.lh === 'saya' && m.saya && m.sayaAt === 'hip') { m.saya.updateWorldMatrix(true, false); lt = m.saya.localToWorld(v3.set(0.0, 0.07, 0.03)); }
    else if (P.lh === 'grip') { B.RightHand.getWorldPosition(v3); B.RightHand.getWorldQuaternion(tq); lt = v3.addScaledVector(Y.set(0, 1, 0).applyQuaternion(tq), -0.11); lq = tq; }
    else if (Array.isArray(P.lh)) { lt = root.localToWorld(v3.set(...P.lh)); if (P.ldir) lq = basis(P.ldir, 'lr', q2, q); }
    if (lt) arm(e, 'Left', lt, lq);
    // blended over the clips' pose
    for (const n of POSED) { tq.copy(B[n].quaternion); B[n].quaternion.copy(baseQ[n]).slerp(tq, w); }
    B.Hips.position.lerpVectors(baseHip, B.Hips.position, w);
    root.updateMatrixWorld(true);
  }
  const pole = new THREE.Vector3();
  function arm(e, S, target, hq) {
    const B = e.rig.bones, s = S === 'Left' ? 1 : -1;
    solveTwoBone(B[S + 'Arm'], B[S + 'ForeArm'], B[S + 'Hand'], target, { pole: e.rig.root.localToWorld(pole.set(s * 0.6, 0.85, -0.4)) });
    if (hq) { const h = B[S + 'Hand']; h.parent.getWorldQuaternion(tq).invert(); h.quaternion.copy(tq).multiply(hq); h.updateWorldMatrix(false, true); }
  }
  /** the hand's world rotation: +y along dir, +z the edge (leading the cut), from body space through bodyQ */
  function basis(dir, cut, bodyQ, out) {
    Y.set(...dir).normalize(); Z.crossVectors(Y, X.set(...(CUT_AXIS[cut] || CUT_AXIS.lr)));
    if (Z.lengthSq() < 1e-6) Z.set(0, 1, 0).cross(Y);
    Z.addScaledVector(Y, -Z.dot(Y)).normalize(); X.crossVectors(Y, Z);
    out.setFromRotationMatrix(m4.makeBasis(X, Y, Z)).premultiply(bodyQ);
    return out;
  }
  function placeKit(e, P) {
    const m = e.mm, B = e.rig.bones;
    if (!m.saya) return;
    const sh = P ? P.sheath : m.sheathed, at = P ? (P.saya === 'hand' ? 'hand' : 'hip') : m.sayaAt;
    if (at !== m.sayaAt) {
      m.sayaAt = at;
      if (at === 'hip') { B.Hips.add(m.saya); m.saya.position.copy(SAYA_POS); m.saya.quaternion.copy(SAYA_Q); }
      else { B.LeftHand.add(m.saya); m.saya.position.set(0, -0.03, 0); m.saya.quaternion.identity(); }
    }
    if (sh == null) { if (m.sword.parent !== B.RightHand) { B.RightHand.add(m.sword); m.sword.position.set(0, 0.1, 0); m.sword.quaternion.identity(); } }
    else { if (m.sword.parent !== m.saya) { m.saya.add(m.sword); m.sword.quaternion.identity(); } m.sword.position.set(0, -sh, 0); }
    m.sheathed = sh;
  }

  // ---- moves, events, strikes
  /** start a move: its keys from t = 0; face: where it turns to (tracked until `lock` seconds in) */
  function start(e, name, lock = 0.3) {
    const m = e.mm;
    m.move = name; m.t = 0; m.ev = 0; m.lockAt = lock; m.from = e.pos.slice(); m.open = false; m.hitDone = {};
    e.agent.stop();
  }
  /** a step of the move: time on, events fired once each through fn(name), done at its end */
  function step(e, dt, fn) {
    const m = e.mm, mv = MOVES[m.move];
    m.t += dt;
    while (m.ev < mv.ev.length && mv.ev[m.ev][0] <= m.t) fn(mv.ev[m.ev++][1]);
    if (m.t >= mv.dur) { m.move = null; m.open = false; e.charge = 0; return true; }
    return false;
  }
  /** the blade's tip in the world (for the trail) */
  const tipOf = (e, out) => (e.mm.sword ? e.mm.sword.localToWorld(out.set(0, e.mm.blade, 0)) : e.rig.bones.RightHand.getWorldPosition(out));
  /** the swing's trail: a streak from the tip's last place to this one, while `on` */
  function trail(e, on, color = '#bfe8ff') {
    const m = e.mm;
    if (!on) { m.tipPrev = null; return; }
    const p = tipOf(e, v).toArray();
    if (m.tipPrev) vfx.beam({ from: m.tipPrev, to: p, width: 0.05, color, intensity: 6, life: 0.14 });
    m.tipPrev = p;
  }
  const airborne = () => player.body && !player.body.onGround;
  /** a strike at the player from e: reach and arc in front; returns 'hit' | 'dodged' | 'jumped' | null */
  function strikePlayer(e, s, from = e.pos, heading = e.heading) {
    if (player.dead || game.flags.done) return null;
    const p = player.feet, dx = p[0] - from[0], dz = p[2] - from[2], d = Math.hypot(dx, dz), k = e.K.scale;
    if (d > s.reach * k + 0.3 || Math.abs(p[1] - from[1]) > 1.6 * k) return null;
    if (d > 0.5 && Math.acos(Math.max(-1, Math.min(1, (dx * heading[0] + dz * heading[1]) / d))) > s.arc) return null;
    if (player.iframe > game.time) { flag('meleeDodges'); return 'dodged'; }
    if (s.low && airborne() && p[1] - from[1] > 0.2) { flag('meleeJumps'); return 'jumped'; }
    player.hurt(s.dmg * (assist ? 0.12 : 1) * tune.dmg, from);
    flag('meleeHits');
    if (s.knock || s.up) launch(d > 0.01 ? dx / d : heading[0], d > 0.01 ? dz / d : heading[1], s.knock || 0, s.up || 0);
    return 'hit';
  }
  /** the player thrown: horizontal (x, z) unit, speed m/s, lift m/s; the camera kicked */
  function launch(x, z, speed, up) {
    const b = player.body; if (!b) return;
    b.push = [x * speed, z * speed];
    if (up) { b.vy = up; b.onGround = false; }
    player.shake?.(Math.min(2.5, 0.4 + speed * 0.12));
    flag('launches');
  }
  /** a short slow beat for the robots and the effects of the world (not the player's own hands) */
  const slow = (sec, k = 0.25) => { S.slowT = Math.max(S.slowT, sec); S.k = k; flag('slowBeats'); };
  const glint = (p, scale = 1) => vfx.burst(MFX.glint, p, { scale });
  /** robots struck by an ally's blade from `from`: reach, arc; a heavy hit (it staggers); returns how many */
  function strikeRobots(e, s, from = e.pos, heading = e.heading) {
    let n = 0;
    for (const o of list) {
      if (o === e || o.dead || o.ally || !o.active || !o.rig.root.visible) continue;
      const dx = o.pos[0] - from[0], dz = o.pos[2] - from[2], d = Math.hypot(dx, dz);
      if (d > s.reach * e.K.scale + 0.4 * o.K.scale || Math.abs(o.pos[1] - from[1]) > 2) continue;
      if (d > 0.5 && Math.acos(Math.max(-1, Math.min(1, (dx * heading[0] + dz * heading[1]) / d))) > s.arc) continue;
      const pt = [o.pos[0], o.pos[1] + 1.1 * o.K.scale, o.pos[2]];
      ctx.damage(o, s.dmg, false, pt, [dx / (d || 1), 0, dz / (d || 1)], { friendly: true, from: e.pos.slice(), melee: true, ally: true, posture: s.posture || 40 });
      vfx.burst(FX.hit, pt, { direction: [-dx / (d || 1), 0.3, -dz / (d || 1)], scale: 1.3 });
      n++; flag('allyHits');
    }
    return n;
  }

  // ---- the brawler and the sword robot in a fight (enemies.js think(), state 'fight'): returns what it faces
  function fight(e, dt, sees, dist) {
    if (e.K.boss) return null;
    const m = e.mm, p = player.feet;
    m.blockCool = Math.max(0, m.blockCool - dt);
    if (game.time - e.seenT > 5 && !m.move) { e.state = 'search'; e.t = 0; if (e.lastSeen) e.agent.setGoal(ctx.nav().nearest(e.lastSeen, { snap: 2 }) || e.lastSeen); return null; }
    if (m.move) {
      const s = STRIKE[m.move], name = m.move;
      if (m.t < m.lockAt) m.face = p.slice();
      const hitAt = MOVES[name].ev[0][0];
      e.charge = m.t < hitAt ? 1 : 0;   // the visor flares through the wind-up
      if (LUNGE[name]) { const [a, b, len] = LUNGE[name]; if (m.t > a && m.t < b) { const k = (len * dt) / (b - a); const to = ctx.nav().nearest([e.pos[0] + e.heading[0] * k, e.pos[1], e.pos[2] + e.heading[1] * k], { snap: 0.6 }); if (to && dist > 1.1) { e.agent.place(to); e.pos = e.agent.pos; } } }
      if (e.K.melee === 'sword') trail(e, m.t > hitAt - 0.08 && m.t < hitAt + 0.08, '#ff6a50');
      if (step(e, dt, (ev) => { if (ev === 'hit') { const r = strikePlayer(e, s); sfx.play(r === 'hit' ? (e.K.melee === 'sword' ? 'md_slash' : 'md_thud') : 'md_swish', { at: [e.pos[0], e.pos[1] + 1.2, e.pos[2]], gain: 0.9, ref: 5 }); } })) {
        if (m.queue.length && dist < (STRIKE[m.queue[0]].reach + 0.9) * e.K.scale) { begin(e, m.queue.shift()); } else { m.queue.length = 0; m.cool = 0.9 + R() * 0.6; }
      }
      return m.face;
    }
    if (m.block > 0) { m.block -= dt; e.agent.stop(); if (m.block <= 0) m.base = 'fists'; return p; }
    m.cool -= dt;
    const reach = e.K.melee === 'sword' ? 2.0 : 1.6, dy = Math.abs(p[1] - e.pos[1]);
    if (sees && m.cool <= 0 && dy < 1.2 && e.jam <= 0) {
      if (dist < reach + 0.2) { const c = COMBOS[e.K.melee][Math.floor(R() * COMBOS[e.K.melee].length)]; m.queue = c.slice(1); begin(e, c[0]); return p; }
      if (e.K.melee === 'sword' && dist > 2.6 && dist < 4.2 && R() < 0.5 * dt * 4) { m.queue = []; begin(e, 'thrust'); return p; }
    }
    // close in: to a point 1.2 m short of the player, again every 0.4 s
    if ((e.shift -= dt) <= 0 || e.agent.arrived || !e.agent.path) {
      e.shift = 0.4;
      e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed;
      if (dist > reach * 0.8) { const l = Math.max(dist, 0.01); e.agent.setGoal(ctx.nav().nearest([p[0] - (p[0] - e.pos[0]) / l * 1.2, p[1], p[2] - (p[2] - e.pos[2]) / l * 1.2], { snap: 2 }) || e.lastSeen || p); }
      else e.agent.stop();
    }
    return sees ? p : e.lastSeen;
  }
  function begin(e, name) { start(e, name, MOVES[name].ev[0][0] - 0.12); sfx.play('md_swish', { at: [e.pos[0], e.pos[1] + 1.2, e.pos[2]], gain: 0.5, ref: 4, rate: 0.7 }); }

  /** a hit taken (enemies.js damage(), before it lands): a factor on the damage, 0 when it is stopped here */
  function guard(e, amount, head, point, dir, hit) {
    if (e.ally) return 0;   // the player's rounds and blasts pass the ally by
    if (e.K.melee === 'iai') return boss.guard(e, amount, head, point, dir, hit);
    if (e.K.melee === 'heavy') return heavy.guard(e, amount, head, point, dir, hit);
    const m = e.mm, front = -(dir[0] * e.heading[0] + dir[2] * e.heading[1]) > 0.5;
    if (e.K.melee !== 'fist' || !front || e.stun > 0 || hit?.splash) return 1;
    if (m.block > 0 || (!m.move && m.blockCool <= 0 && e.state === 'fight')) {
      if (m.block <= 0) { m.block = 1.1; m.blocked = 0; m.base = 'block'; m.blockCool = 3.5; e.agent.stop(); flag('blocks'); }
      m.blocked++;
      vfx.burst(MFX.clash, point, { direction: [-dir[0], 0.3, -dir[2]], scale: 0.6 });
      sfx.play('md_clang', { at: point, gain: 0.45, ref: 4, rate: 1.4 });
      if (m.blocked >= 3 || hit?.melee) { m.block = 0; m.base = 'fists'; e.stagger = 1.0; e.anim.play('stagger', { duration: 0.08 }); flag('guardBreaks'); return 0.5; }
      return 0.2;
    }
    return 1;
  }

  // ---- a step of the whole thing (the game's system, real time): the slow beat, the bosses' bars, the callouts
  game.system((dt) => {
    S.slowT = Math.max(0, S.slowT - dt); S.slow = S.slowT > 0 ? S.k : 1;
    boss.tick(dt); heavy.tick(dt);
    ui.update(dt);
  });

  const X2 = { ...ctx, on, ui, S, start, step, strikePlayer, strikeRobots, launch, slow, glint, trail, flag, tipOf, edgeMat, redMat, MFX };
  const boss = createBoss(X2), heavy = createHeavy(X2);
  X2.boss = boss; X2.heavy = heavy;
  /** a boss's own brain (enemies.js think() hands it over whole) */
  const think = (e, dt) => (e.K.melee === 'heavy' ? heavy.think(e, dt) : boss.think(e, dt));
  /** the tests: a robot's combo now (names in order), in a fight */
  const combo = (e, names) => { e.state = 'fight'; e.mm.queue = names.slice(1); begin(e, names[0]); };
  return { equip, extraParts, fight, guard, think, combo, boss, heavy, ui, on, S, get slow() { return S.slow; } };
}

// effects of close combat (@miragekit/core's effect format, as fx.js)
export const MFX = {
  glint: { name: 'md-glint', bursts: [{ time: 0, count: 2 }], duration: 0.05, life: [0.3, 0.4], size: [0.3, 0.45], sizeOverLife: [[0, 0.2], [0.25, 1], [1, 0]], rotation: [0, 90],
    color: '#eaf8ff', alpha: [[0, 1], [1, 0]], emissive: 14, render: { blend: 'add', sprite: 'star' } },
  clash: { name: 'md-clash', bursts: [{ time: 0, count: 24 }], duration: 0.04, life: [0.15, 0.45], velocity: { speed: [2, 8], spread: 60 }, gravity: -9.8, drag: 0.8, size: [0.012, 0.026],
    color: [[0, '#fffbe8'], [0.4, '#ffd070'], [1, '#d04010']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 9, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.025 } },
  rubble: { name: 'md-rubble', emitters: [
    { name: 'chunks', bursts: [{ time: 0, count: 10 }], duration: 0.05, life: [0.5, 1.0], velocity: { speed: [2.5, 6], spread: 40 }, gravity: -9.8, drag: 0.3, size: [0.05, 0.12], color: '#3a3c40', alpha: [[0, 1], [0.85, 1], [1, 0]],
      rotation: [0, 360], spin: [-300, 300], render: { blend: 'alpha' }, collision: { mode: 'bounce', depth: true, bounce: 0.3, friction: 0.5, lifeLoss: 0.2, radius: 0.04 } },
    { name: 'dust', bursts: [{ time: 0, count: 4 }], duration: 0.05, life: [0.6, 1.2], velocity: { speed: [0.5, 1.5], spread: 50 }, drag: 2, size: [0.4, 0.7], sizeOverLife: [[0, 0.5], [1, 2]],
      color: '#5c5a58', alpha: [[0, 0.35], [1, 0]], rotation: [0, 360], render: { blend: 'alpha', soft: 0.4, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
  ] },
};

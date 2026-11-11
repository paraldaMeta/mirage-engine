// The sentinels: security robots on the district's walk grid.
//   body       general-purpose humanoid robots from the robot kit (modules/robot-kit.js: exposed rotary actuators,
//              dark powder-coated shells with panel gaps, a sensor head, a battery pack, unit numbers and warning
//              labels), skinned to @miragekit/play's rig (createRigModel; its own body is not drawn) in three levels of
//              detail; animated by createAnimator: a speed blend of the kit's gait (idle / walk / run: planted feet,
//              heel strike and toe-off, playback scaled to the ground covered), an aim pose on a masked upper body
//              layer, an additive flinch, a fall. The four extra clips are authored below. The hounds (robot dogs)
//              are posed in code (game/robot-rig.js).
//   moving     createNavGrid on the player's own walk grid, one createNavAgent each, createNavCrowd keeps them apart
//   seeing     createSenses: sight cones the walk grid occludes, and the noise of the player's shots
//   thinking   a small state machine: post / patrol -> alert -> fight (close in, hold and fire bursts, shift) -> search
// They are game entities with save / load, so a checkpoint restores who is down and where the others stand.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRigModel, createAnimator, createNavGrid, createNavAgent, createNavCrowd, createSenses, solveLookAt, blend1d } from '@miragekit/play';
import { FX } from './fx.js';
import { robotMaterials, part, mergeParts, ext, tf, COL } from '../modules/robot-kit.js';
import { humanoidMeshes, robotClips, CLIP_SPEED, createHound } from './robot-rig.js';

const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const hold = (name, tracks, dur = 1) => new THREE.AnimationClip(name, dur, Object.entries(tracks).map(([bone, v]) => new THREE.QuaternionKeyframeTrack(bone + '.quaternion', [0, dur], [...v, ...v])));
/** the four clips the rig does not ship: bone names and axes are the rig's (T-pose rest, +Z forward, X pitches) */
function extraClips() {
  // rifle up: the right arm forward and bent, the left hand across to the fore-end
  const aim = hold('aim', { RightArm: q(0.12, 1.35, 0.2), RightForeArm: q(0, 0.5, 0), LeftArm: q(0.25, -1.0, -0.35), LeftForeArm: q(0, -1.15, 0), Chest: q(0.06, -0.22, 0), Neck: q(0, 0.18, 0) });
  // a flinch: authored as an offset from its first key (an additive layer)
  const I = [0, 0, 0, 1], flinch = new THREE.AnimationClip('flinch', 0.36, [
    new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 0.07, 0.36], [...I, ...q(-0.3, 0.12, 0), ...I]),
    new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 0.09, 0.36], [...I, ...q(-0.25, -0.2, 0), ...I]),
  ]);
  // going down backwards: the hips drop and pitch, the limbs go slack
  const T = [0, 0.18, 0.5, 0.8], die = new THREE.AnimationClip('die', 0.8, [
    new THREE.VectorKeyframeTrack('Hips.position', T, [0, 0.95, 0, 0, 0.8, -0.08, 0, 0.3, -0.3, 0, 0.17, -0.34]),
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', T, [...I, ...q(-0.35, 0, 0.05), ...q(-1.2, 0, 0.12), ...q(-1.5, 0, 0.12)]),
    new THREE.QuaternionKeyframeTrack('Spine.quaternion', T, [...I, ...q(0.2, 0, 0), ...q(0.1, 0, 0), ...q(-0.05, 0, 0)]),
    new THREE.QuaternionKeyframeTrack('LeftUpLeg.quaternion', T, [...I, ...q(-0.5, 0, 0), ...q(-0.2, 0, 0.2), ...q(0.05, 0, 0.25)]),
    new THREE.QuaternionKeyframeTrack('RightUpLeg.quaternion', T, [...I, ...q(-0.3, 0, 0), ...q(-0.6, 0, -0.1), ...q(-0.25, 0, -0.2)]),
    new THREE.QuaternionKeyframeTrack('RightLeg.quaternion', T, [...I, ...q(0.6, 0, 0), ...q(0.9, 0, 0), ...q(0.5, 0, 0)]),
    new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', T, [...q(0, 0, -1.2), ...q(-0.4, 0, -0.5), ...q(-0.2, 0.3, -0.2), ...q(0, 0.4, -0.3)]),
    new THREE.QuaternionKeyframeTrack('RightArm.quaternion', T, [...q(0, 0, 1.2), ...q(-0.5, 0, 0.4), ...q(-0.2, -0.4, 0.2), ...q(0, -0.5, 0.35)]),
    new THREE.QuaternionKeyframeTrack('Head.quaternion', T, [...I, ...q(-0.3, 0, 0), ...q(0.2, 0.2, 0), ...q(0.1, 0.3, 0)]),
  ]);
  // looking about on its post: an offset on the neck, for an additive layer
  const scan = new THREE.AnimationClip('scan', 6, [new THREE.QuaternionKeyframeTrack('Neck.quaternion', [0, 1.4, 2.6, 4.2, 5.2, 6], [...I, ...q(0, 0.55, 0), ...q(0.08, 0.5, 0), ...q(0, -0.6, 0), ...q(-0.05, -0.45, 0), ...I])]);
  return [aim, flinch, die, scan];
}

// Four jobs on two rigs: they differ by kit, accent colour, behaviour and a tell the player can read.
//   grunt     the sentinel: closes in, side-steps, fires bursts
//   heavy     the warden: a red light and a rising whine 0.8 s before a long suppressing burst; cannot be hacked
//             from the front
//   shield    a sentinel with an amber energy shield in front that stops rounds; open it from the side, with an
//             EMP, a hack, or by shooting the emitter on the shield's lower rim
//   marksman  holds its post on high ground; a violet beam tightens on the player for 1.2 s before a heavy shot
//   hound     a robot dog (K.type 'hound', counted as a sentinel by the rest of the game): the scout flanks, closes in
//             and lunges after a tell (it crouches, its lights flare, a charge sound, 0.6 s); the hauler carries a
//             small turret that fires bursts, and lunges too. Low: hard to hit over cover. In the holdout from wave 3.
// Their lights are red or amber (the civilians' are white and blue); the shells dark; a dim rim outline in the dark.
const GRUNT_COLORS = { skin: 0x14171b, shirt: 0x1b2026, trousers: 0x181c21, boots: 0x0c0d0f, hair: 0x14171b };
const KIND = {
  grunt: { name: 'grunt', look: 'sentinel', numbers: ['n0', 'n1', 'n2', 'n3'], hp: 60, speed: 3.0, damage: 5, burst: 3, tele: 0.42, range: 24, fire: 19, visor: [1.0, 0.09, 0.04], colors: GRUNT_COLORS, scale: 1 },
  heavy: { name: 'heavy', look: 'warden', numbers: ['n4', 'n5'], hp: 135, speed: 2.3, damage: 7, burst: 9, gap: 0.09, tele: 0.8, range: 24, fire: 19, visor: [1.0, 0.2, 0.05], colors: GRUNT_COLORS, scale: 1.1 },
  shield: { name: 'shield', look: 'sentinel', kit: { shield: true }, numbers: ['n2', 'n3'], hp: 70, speed: 2.5, damage: 5, burst: 3, tele: 0.5, range: 24, fire: 17, visor: [1.0, 0.62, 0.08], accent: 0xffa020, shieldHp: 170, colors: GRUNT_COLORS, scale: 1.02 },
  marksman: { name: 'marksman', look: 'sentinel', kit: { mast: true }, numbers: ['n1'], hp: 55, speed: 2.4, damage: 30, burst: 1, tele: 1.2, range: 44, fire: 42, visor: [1.0, 0.08, 0.22], accent: 0xb050ff, eye: 1.8, colors: GRUNT_COLORS, scale: 0.98 },
  hound: { name: 'grunt', type: 'hound', style: 'scout', hp: 40, speed: 4.6, damage: 0, bite: 9, burst: 0, tele: 0.62, range: 22, fire: 0, visor: [1.0, 0.3, 0.04], eye: 0.42, scale: 0.5 },
  hauler: { name: 'grunt', type: 'hound', style: 'hauler', hp: 85, speed: 3.0, damage: 4, bite: 11, burst: 4, gap: 0.11, tele: 0.62, range: 24, fire: 16, visor: [1.0, 0.14, 0.04], eye: 0.66, scale: 0.6 },
};
// hit volumes: [height, radius, head, forward] (bipeds: times the scale; hounds: metres)
const HIT = {
  biped: [[1.66, 0.17, true, 0], [1.25, 0.3, false, 0], [0.85, 0.3, false, 0], [0.4, 0.27, false, 0]],
  scout: [[0.37, 0.17, false, 0.12], [0.37, 0.16, false, -0.17], [0.39, 0.1, true, 0.33]],
  hauler: [[0.53, 0.24, false, 0.2], [0.53, 0.24, false, -0.24], [0.55, 0.12, true, 0.52], [0.72, 0.1, false, 0.05]],
};
const FOV = 130;

// tune: the difficulty, { dmg, hp, acc } factors on damage dealt to the player, health and accuracy (all 1: as built)
export function createEnemies({ world, game, physics, plan, vfx, sfx, player, assist, onDispose, tune = { dmg: 1, hp: 1, acc: 1 } }) {
  const { mat } = world;
  // a dim rim on the armour so a robot reads against a dark street; the visor (a dark zone, overdrive) raises it
  const rim = { value: new THREE.Vector3(0.05, 0.11, 0.14) };
  const mats = robotMaterials(world, { rim, key: 'enemies' });
  const shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.08).multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.2, 1.0).multiplyScalar(4), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  // the warden's tell: one clustered lamp, put on whichever warden is winding up
  const tell = new THREE.PointLight(0xff3010, 0, 9, 2); world.scene.add(tell); world.lighting?.addLight(tell);
  /** hooks the rest of the game sets: env.dark(pos) 0..1, env.blind(from, to) (smoke), on.bark(e, key), on.pop(word, pos), on.dealt(amount) */
  const env = { dark: () => 0, blind: () => false, rim: 0 }, on = { bark: () => {}, pop: () => {}, dealt: () => {} };
  const visorMat = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, mat.glow(v.visor, 7, { vertexColors: true })]));
  const extra = extraClips(), CLIPS = robotClips(), BLEND = [0, CLIP_SPEED.walk[0], CLIP_SPEED.run[0]], bw = new Float32Array(3);
  const list = [], byZone = {}, hounds = [];
  let nav = null, crowd = null, senses = null, rnd = 0x9e3779b9;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  // the parts are the robot kit's (modules/robot-kit.js), skinned rigidly to the rig's bones (game/robot-rig.js):
  // three meshes (shell, metal, lights) at each of three levels of detail, the geometry shared per kind
  function build(def) {
    const kk = def.kind || 'grunt', K = KIND[kk];
    if (K.type === 'hound') return buildHound(def, K, kk);
    const rig = createRigModel({ material: mats.shell, colors: K.colors });
    rig.root.scale.setScalar(K.scale);
    rig.mesh.visible = false;   // the rig's own body is not drawn: the robot's parts are
    const B = rig.bones, names = rig.mesh.skeleton.bones.map((b) => b.name);
    const kit = { ...(K.kit || {}), number: K.numbers[list.length % K.numbers.length] };
    // culled by one fixed sphere in the rig's own space that holds every pose (arms out, the aim, lying on its back
    // after the fall): without it every skinned part was drawn in every pass (each lamp's six shadow faces, the
    // mirror, the sun) wherever the robot stood
    const reach = new THREE.Sphere(new THREE.Vector3(0, 0.85, -0.25), 1.9);
    const sets = [0, 1, 2].map((lod) => {
      const g = humanoidMeshes(K.look, lod, kit, names);
      return [['s', mats.shell], ['m', mats.metal], ['l', visorMat[kk]]].filter(([k]) => g[k]).map(([k, m]) => {
        const sm = new THREE.SkinnedMesh(g[k], m); sm.bind(rig.mesh.skeleton, rig.mesh.bindMatrix);
        sm.boundingSphere = reach; sm.frustumCulled = true; sm.castShadow = k === 's'; sm.receiveShadow = true; sm.visible = lod === 0;
        rig.root.add(sm); return sm;
      });
    });
    // the rifle in the right hand, along the hand's own -X (the arm's axis): a receiver, a shroud, a magazine, a stock,
    // an optic (the marksman: a long barrel, a scope and a folded bipod); the muzzle's tip lit
    const gun = new THREE.Group(); B.RightHand.add(gun); gun.position.set(-0.1, -0.02, 0.02);
    const sniper = K.name === 'marksman';
    const gunMesh = new THREE.Mesh(rifle(sniper), mats.shell); gunMesh.castShadow = false; gun.add(gunMesh);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8).rotateZ(Math.PI / 2), visorMat[kk]); tip.position.set(sniper ? -0.98 : -0.6, 0.03, 0); gun.add(tip);
    // the shield sentinel's kit: a curved energy shield carried in front, its emitter a lit node on the lower rim
    let shield = null, emitter = null, beam = null;
    if (K.name === 'shield') {
      shield = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.55, 16, 1, true, -0.62, 1.24).translate(0, 0, -0.9 + 0.62), shieldMat);
      shield.position.set(0, 1.12, 0); shield.rotation.y = 0; shield.renderOrder = 2; shield.userData.occlude = false; shield.castShadow = false;
      emitter = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), visorMat.shield); emitter.position.set(0, 0.42, 0.63);
      const frame = new THREE.Mesh(projector(), mats.shell); frame.position.set(0, 0.36, 0.6); frame.castShadow = false;
      rig.root.add(shield, emitter, frame);
    }
    // the marksman's tell: a beam from the muzzle to the player that tightens before the shot
    if (sniper) { beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), beamMat.clone()); beam.visible = false; beam.frustumCulled = false; beam.userData.occlude = false; beam.userData.collide = false; world.scene.add(beam); onDispose(() => beam.removeFromParent()); }
    place(rig.root, def);
    const anim = createAnimator(rig.root, [...CLIPS, ...extra], {
      parameters: { speed: 0, rate: 1, flinch: 'trigger', dead: false }, rootMotion: { bone: 'Root' },
      layers: [
        { name: 'base', start: 'move', states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [CLIP_SPEED.walk[0], 'walk'], [CLIP_SPEED.run[0], 'run']] }, speedParam: 'rate' }, die: { clip: 'die', loop: false } },
          transitions: [{ from: 'move', to: 'die', when: ['dead'], duration: 0.08 }] },
        { name: 'aim', mask: ['Chest'], weight: 0, start: 'aim', states: { aim: { clip: 'aim' } } },
        { name: 'flinch', additive: true, start: 'none', states: { none: {}, flinch: { clip: 'flinch', loop: false } },
          transitions: [{ from: '*', to: 'flinch', when: ['flinch'], duration: 0.03 }, { from: 'flinch', to: 'none', exitTime: 0.95, duration: 0.05 }] },
        { name: 'scan', additive: true, weight: 1, start: 'scan', states: { scan: { clip: 'scan' } } },
      ],
    });
    const e = entity(def, K, { rig, anim, tip, shield, emitter, beam, sets });
    // the head follows the player once it knows of them (after the clips have posed the bones)
    const eyeAt = new THREE.Vector3();
    anim.post.push(() => { if (e.watch && !e.dead) solveLookAt([B.Neck, B.Head], eyeAt.set(player.feet[0], player.feet[1] + player.height, player.feet[2]), { share: [0.4, 0.6], limit: 0.9 }); });
    anim.update(0);
    return e;
  }
  /** into the scene: a top-level object marked mgDynamic (the lamps' cached shadow tiles are drawn again when it
   *  moves near them, the probe bakes leave it out); collide = false keeps it out of the walk grid */
  function place(root, def) {
    root.traverse((o) => { o.userData.occlude = false; });
    root.userData.mgDynamic = true; root.userData.collide = false; root.name = def.id;
    world.scene.add(root);
    onDispose(() => root.removeFromParent());
  }
  /** the state every robot carries, registered as a game entity (the playtest looks at it by id, a checkpoint saves it) */
  function entity(def, K, o) {
    const e = {
      id: def.id, def, K, ...o, hp: K.hp, state: 'post', home: def.at.slice(), pos: def.at.slice(), yaw: def.face ?? 0, agent: null,
      aim: 0, watch: 0, t: 0, wait: 0, burst: 0, next: 1 + R() * 1.5, tele: 0, lastSeen: null, seenT: -1e9, shift: 0, patrolI: 0, dead: false, deadT: 0, active: !['wave', 'relay', 'holdout'].includes(def.zone), speed: 0,
      heading: [Math.sin(def.face ?? 0), Math.cos(def.face ?? 0)],
      maxHp: K.hp, stun: 0, jam: 0, shieldHp: K.shieldHp || 0, shieldOff: 0, charge: 0, barkT: 0, lureT: 0, sparkT: 0, lod: 0, leapT: 0, cool: 0,
    };
    e.rig.root.position.set(...e.pos); e.rig.root.rotation.y = e.yaw; e.rig.root.visible = e.active;   // the wave and the relay's two are not drawn until they are woken
    game.add({ id: def.id, enemy: e, interact: { can: () => false, label: '', at: () => [e.pos[0], e.pos[1] + (K.type === 'hound' ? 0.8 : 1.2) * K.scale, e.pos[2]] },   // not usable: `at` lets tools look at it by id
      save: () => ({ hp: e.hp, dead: e.dead, pos: e.pos.map((v) => +v.toFixed(2)), yaw: +e.yaw.toFixed(2), active: e.active, shown: e.rig.root.visible }),
      load: (s) => restore(e, s) });
    list.push(e); (byZone[def.zone] ||= []).push(e);
    if (K.type === 'hound') hounds.push(e);
    return e;
  }
  /** a hound (a robot dog, game/robot-rig.js): no rig, no animator; a stand-in for the animator's calls that poses
   *  the dog in code from its speed, the distance it covered, a crouch (the tell), a leap and a fall */
  function buildHound(def, K, kk) {
    const dog = createHound({ style: K.style, mats, light: visorMat[kk] });
    dog.root.scale.setScalar(K.scale); dog.model.scale.setScalar(1 / K.scale);
    const st = { speed: 0, dist: 0, crouch: 0, leap: 0, dead: 0, aim: 0 };
    const anim = { post: [], dt: 0,
      set(k, v) { if (k === 'dead') st.dead = v ? 1e-3 : 0; else if (k === 'speed') st.speed = v; return anim; },
      trigger() { return anim; }, setLayerWeight() { return anim; },
      reset() { st.dead = 0; st.leap = 0; st.crouch = 0; return anim; },
      update(dt) { st.dist += st.speed * dt; if (st.dead) st.dead += dt; dog.pose(st, dt); return anim; } };
    place(dog.root, def);
    const e = entity(def, K, { rig: { root: dog.root, bones: dog.bones }, anim, tip: dog.tip, dog, pose: st, sets: dog.meshes });
    anim.update(0);
    return e;
  }
  /** the rifle's geometry (shell material, vertex colours): extruded profiles along -x, a shroud, a magazine, an optic */
  function rifle(sniper) {
    const k = [];
    const put = (g, c, p = [0, 0, 0], r = [0, 0, 0]) => k.push(part(tf(g, p, r), 's', c));
    put(ext([[0.14, -0.03], [0.14, 0.035], [0.02, 0.055], [-0.2, 0.055], [-0.24, 0.03], [-0.24, -0.02], [-0.06, -0.04]], 0.05, 0.008), COL.carbon);
    put(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 10).rotateZ(Math.PI / 2), COL.graphite, [-0.34, 0.02, 0]);
    put(new THREE.CylinderGeometry(0.011, 0.011, sniper ? 0.62 : 0.16, 8).rotateZ(Math.PI / 2), COL.gun, [sniper ? -0.65 : -0.52, 0.025, 0]);
    put(ext([[0.0, 0.0], [0.04, 0.0], [0.05, -0.15], [0.01, -0.16]], 0.03, 0.006), COL.graphite, [-0.04, -0.02, 0]);
    put(ext([[0.14, 0.035], [0.32, 0.03], [0.34, -0.06], [0.3, -0.07], [0.22, -0.015], [0.14, -0.02]], 0.04, 0.008), COL.carbon);
    put(new RoundedBoxGeometry(0.1, 0.04, 0.035, 1, 0.01), COL.carbon, [-0.06, 0.08, 0]);
    put(new THREE.CylinderGeometry(sniper ? 0.024 : 0.016, sniper ? 0.024 : 0.016, sniper ? 0.22 : 0.06, 10).rotateZ(Math.PI / 2), COL.glass, [-0.06, sniper ? 0.11 : 0.105, 0]);
    if (sniper) for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.006, 0.005, 0.24, 5).rotateZ(Math.PI / 2 - 0.08), COL.graphite, [-0.72, -0.005, s * 0.018]);   // the bipod, folded along the barrel
    return mergeParts(k);
  }
  /** the shield's projector on the lower rim: a rounded housing */
  function projector() { return mergeParts([part(new RoundedBoxGeometry(0.46, 0.06, 0.07, 2, 0.02), 's', COL.carbon), part(tf(new RoundedBoxGeometry(0.3, 0.02, 0.02, 1, 0.008), [0, 0.04, 0.01]), 's', COL.amber)]); }
  /** the kit's timers back to rest (a checkpoint, a revive) */
  const calm = (e) => { e.stun = 0; e.jam = 0; e.shieldOff = 0; e.shieldHp = e.K.shieldHp || 0; e.charge = 0; e.lureT = 0; e.leapT = 0; e.cool = 0; if (e.beam) e.beam.visible = false; };
  function restore(e, s) {
    calm(e);
    e.hp = s.hp; e.dead = s.dead; e.pos = s.pos.slice(); e.yaw = s.yaw; e.active = s.active; e.state = s.dead ? 'dead' : 'post'; e.aim = 0; e.burst = 0; e.tele = 0; e.lastSeen = null; e.deadT = s.dead ? 99 : 0;
    e.rig.root.visible = s.shown && !s.dead; e.rig.root.position.set(...e.pos); e.rig.root.rotation.y = e.yaw; e.rig.root.scale.setScalar(e.K.scale);
    e.anim.reset(); e.anim.set('dead', false); e.anim.set('speed', 0); e.anim.setLayerWeight('aim', 0); e.anim.update(0);
    if (e.agent) { e.agent.stop(); e.agent.walker.place(e.pos); e.pos = e.agent.pos; crowd.remove(e.agent); if (!e.dead) crowd.add(e.agent); }   // the agent's own array again, back in the crowd
  }
  /** a dead (or parked) sentinel back on its feet at `at`, awake: the holdout's waves reuse the pool instead of
   *  building new rigs. hp: a factor on its health over the difficulty's */
  function revive(e, at, hp = 1) {
    const p = (nav && nav.nearest(at, { snap: 2 })) || at.slice();
    calm(e);
    Object.assign(e, { maxHp: e.K.hp * tune.hp * hp, hp: e.K.hp * tune.hp * hp, dead: false, deadT: 0, state: 'post', aim: 0, burst: 0, tele: 0, next: 1 + R() * 1.5, lastSeen: null, seenT: -1e9, shift: 0, wait: 0, t: 0, active: true, watch: 0, speed: 0 });
    if (e.agent) { e.agent.stop(); e.agent.walker.place(p); e.pos = e.agent.pos; e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed; crowd.remove(e.agent); crowd.add(e.agent); } else e.pos = p.slice();
    e.home = e.pos.slice();
    const r = e.rig.root; r.visible = true; r.position.set(...e.pos); r.rotation.y = e.yaw; r.scale.setScalar(e.K.scale);
    e.anim.reset(); e.anim.set('dead', false); e.anim.set('speed', 0); e.anim.setLayerWeight('aim', 0); e.anim.update(0);
    return e;
  }
  /** out of play and out of sight, counted as dead: a free slot for revive() */
  function park(e) {
    Object.assign(e, { dead: true, state: 'dead', deadT: 99, active: false, burst: 0, tele: 0 });
    calm(e);
    e.rig.root.visible = false;
    if (e.agent) { e.agent.stop(); crowd.remove(e.agent); }
  }
  /** the difficulty's health on every sentinel still standing (called when the player deploys) */
  function retune() { for (const e of list) { e.maxHp = e.K.hp * tune.hp; if (!e.dead) e.hp = e.maxHp; } }
  for (const def of plan.enemies) build(def);

  /** once play exists: navigation on the player's walk grid */
  function start(grid) {
    nav = createNavGrid(grid, { coarse: 4 });
    crowd = createNavCrowd(nav, { separation: 1.6, range: 0.5 });
    senses = createSenses(nav.grid);
    for (const e of list) {
      const at = nav.nearest(e.pos, { snap: 2 }) || e.pos;
      e.agent = crowd.add(createNavAgent(nav, { pos: at, speed: e.K.speed, radius: 0.3, arrive: 0.3 }));
      e.pos = e.agent.pos; e.home = at.slice();
    }
  }

  const eyeOf = (e, out) => out.set(e.pos[0], e.pos[1] + 1.5 * e.K.scale, e.pos[2]);
  // the dark: a sentinel sees a third as far into a dark zone and less far out of one; steam blocks a line of sight
  const sightOf = (e) => e.K.range * (1 - 0.65 * env.dark(player.feet)) * (1 - 0.3 * env.dark(e.pos));
  const seesPlayer = (e) => !env.blind(e.pos, player.feet) && senses.sees({ pos: e.pos, heading: e.heading }, { pos: player.feet }, { range: sightOf(e), fov: e.state === 'fight' ? 300 : FOV, near: 2.5, eye: e.K.eye || 1.55, height: player.height * 0.93 });
  /** a short line on the radio band (story.js shows it over the speaker's head), at most one per `gap` seconds each */
  const bark = (e, key, gap = 4) => { if (game.time - e.barkT < gap) return; e.barkT = game.time; on.bark(e, key); };
  function alert(e, where, delay = 0) {
    if (e.dead || !e.active || e.state === 'fight' || e.state === 'alert') return;
    e.state = 'alert'; e.t = 0; e.wait = 0.35 + delay + R() * 0.3; e.lastSeen = where ? where.slice() : null;
    bark(e, 'alert', 8);
  }
  /** a noise at `pos` (the player's shots): whoever is awake within `radius` turns to it */
  function noise(pos, radius = 22) {
    for (const e of list) if (!e.dead && e.active && Math.hypot(e.pos[0] - pos[0], e.pos[2] - pos[2]) < radius && Math.abs(e.pos[1] - pos[1]) < 5) alert(e, pos, 0.15);
  }
  function wake(zone, where) { for (const e of byZone[zone] || []) if (!e.dead) { e.active = true; e.rig.root.visible = true; if (where) alert(e, where, R() * 0.8); } }

  // ---- what the city does to them (hack.js, abilities.js)
  /** stunned for t seconds (an EMP): no aim, no shot, the shield down, sparks */
  function stun(e, t) {
    if (e.dead) return;
    e.stun = Math.max(e.stun, t); e.burst = 0; e.tele = 0; e.charge = 0; e.active = true;
    if (e.shield) e.shieldOff = Math.max(e.shieldOff, t + 1);
    e.agent?.stop(); e.anim.trigger('flinch'); bark(e, 'stun', 2);
  }
  /** every robot within r of pos (feet + 1 m), stunned; returns how many */
  function stunAt(pos, r, t) {
    let n = 0;
    for (const e of list) if (!e.dead && e.rig.root.visible && Math.hypot(e.pos[0] - pos[0], e.pos[1] + 1 - pos[1], e.pos[2] - pos[2]) < r) { stun(e, t); n++; }
    return n;
  }
  /** a hack on the robot itself: its weapon jams for t seconds and a shield drops */
  function jam(e, t) {
    e.jam = Math.max(e.jam, t); e.burst = 0; e.tele = 0; e.charge = 0;
    if (e.shield) e.shieldOff = Math.max(e.shieldOff, t);
    bark(e, 'hacked', 1); alert(e, player.feet, 0.5);
  }
  /** can the player hack it from `from`: a warden only from behind, or while it is stunned */
  function hackable(e, from) {
    if (e.dead || !e.active || !e.rig.root.visible) return false;
    if (e.K.name !== 'heavy' || e.stun > 0) return true;
    const dx = from[0] - e.pos[0], dz = from[2] - e.pos[2], l = Math.hypot(dx, dz) || 1;
    return (dx * e.heading[0] + dz * e.heading[1]) / l < -0.2;
  }
  /** a zone goes dark: whoever was fighting near it loses the player and goes to look round where they were */
  function darken(pos, r) {
    for (const e of list) {
      if (e.dead || !e.active || Math.hypot(e.pos[0] - pos[0], e.pos[2] - pos[2]) > r + 8 || (e.state !== 'fight' && e.state !== 'alert')) continue;
      e.state = 'search'; e.t = 0; e.burst = 0; e.tele = 0; e.charge = 0; e.seenT = -1e9;
      const g = [player.feet[0] + (R() - 0.5) * 7, player.feet[1], player.feet[2] + (R() - 0.5) * 7];
      if (nav) e.agent.setGoal(nav.nearest(g, { snap: 2 }) || g);
      bark(e, 'dark', 1);
    }
  }
  /** a lure (a car alarm): whoever is awake within r and not on the player now goes to look */
  function lure(pos, r) {
    let n = 0;
    for (const e of list) {
      if (e.dead || !e.active || Math.hypot(e.pos[0] - pos[0], e.pos[2] - pos[2]) > r || (e.state === 'fight' && game.time - e.seenT < 1)) continue;
      e.state = 'search'; e.t = 0; e.lureT = 8; e.lastSeen = pos.slice(); e.burst = 0; e.tele = 0; e.charge = 0;
      if (nav) { e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed; e.agent.setGoal(nav.nearest(pos, { snap: 3 }) || pos); }
      bark(e, 'lure', 1); n++;
    }
    return n;
  }

  /** the shield breaks (rounds through it, or a rocket's blast): off for 9 s */
  function breakShield(e, point) {
    if (!e.shield) return;
    e.shieldOff = 9; e.shieldHp = e.K.shieldHp; on.pop('shield', point); bark(e, 'shieldDown', 1); sfx.play('nd_shatter', { at: point, gain: 0.8, ref: 4 });
    game.flags.shieldsBroken = (game.flags.shieldsBroken || 0) + 1;
  }
  /** hit: what rayHit returned ({ part: 'shield' | 'emitter' }) plus { melee, friendly, from, shieldK, splash } */
  function damage(e, amount, head, point, dir, hit) {
    if (e.dead) return false;
    const part = hit?.part;
    if (part === 'shield' || part === 'emitter') {   // the shield takes it; the emitter takes four times as much
      e.shieldHp -= amount * (part === 'emitter' ? 4 : 1) * (hit.shieldK || 1); e.active = true;   // shieldK: the shotgun up close
      vfx.burst(FX.hit, point, { direction: [-dir[0], -dir[1] + 0.4, -dir[2]], scale: 0.6 });
      alert(e, hit.friendly ? hit.from : player.feet);
      if (e.shieldHp <= 0) breakShield(e, point);
      return false;
    }
    let k = head ? 2.2 : 1;
    if (hit?.melee && e.stun > 0) k *= 2.4;   // a stunned robot falls to the stock in one or two strikes
    on.dealt(Math.max(0, Math.min(e.hp, amount * k)), e, hit);
    e.hp -= amount * k;
    if (head && !hit?.friendly) on.pop('head', point);
    e.anim.trigger('flinch');
    vfx.burst(FX.hit, point, { direction: [-dir[0], -dir[1] + 0.4, -dir[2]] });
    e.active = true; alert(e, hit?.friendly ? hit.from : player.feet);
    for (const o of byZone[e.def.zone] || []) if (o !== e) alert(o, player.feet, 0.3 + R() * 0.5);
    if (e.hp <= 0) {
      e.dead = true; e.state = 'dead'; e.deadT = 0; e.anim.set('dead', true); e.anim.setLayerWeight('aim', 0); e.agent.stop(); crowd.remove(e.agent);
      e.charge = 0; e.tele = 0; e.stun = 0;
      vfx.burst(FX.down, [e.pos[0], e.pos[1] + 1.1, e.pos[2]]);
      sfx.play('nd_death', { at: [e.pos[0], e.pos[1] + 1, e.pos[2]], gain: 0.9, ref: 4 });
      game.emit('kill', e);
      return true;
    }
    bark(e, 'hurt', 6);
    return false;
  }

  /** the nearest sentinel a ray hits before `max`: { e, t, head, point, part? } (three body spheres and a head; a
   *  shield sentinel's shield first, from the front) */
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
  function rayHit(origin, dir, max) {
    let best = null;
    _o.fromArray(origin); _d.fromArray(dir);
    for (const e of list) {
      if (e.dead || !e.rig.root.visible) continue;
      const s = e.K.scale;
      if (e.shield && e.shieldOff <= 0 && e.stun <= 0) {
        const hx = e.heading[0], hz = e.heading[1], cx = e.pos[0] + hx * 0.62 * s, cz = e.pos[2] + hz * 0.62 * s, den = dir[0] * hx + dir[2] * hz;
        if (den < -0.05) {   // only from in front: a flank goes past it
          const t = ((cx - origin[0]) * hx + (cz - origin[2]) * hz) / den;
          if (t > 0 && t < max && (!best || t < best.t)) {
            const px = origin[0] + dir[0] * t, py = origin[1] + dir[1] * t, pz = origin[2] + dir[2] * t;
            const lat = (px - cx) * hz - (pz - cz) * hx, h = py - e.pos[1];
            if (Math.abs(lat) < 0.6 * s && h > 0.34 * s && h < 1.9 * s) best = { e, t, head: false, owner: api, part: Math.hypot(lat, h - 0.42 * s) < 0.14 ? 'emitter' : 'shield' };
          }
        }
      }
      const dog = e.K.type === 'hound', k = dog ? 1 : s;
      for (const [h0, r0, head, f] of HIT[dog ? e.K.style : 'biped']) {
        const h = h0 * k, r = r0 * k;
        _c.set(e.pos[0] + e.heading[0] * f, e.pos[1] + h, e.pos[2] + e.heading[1] * f).sub(_o);
        const tc = _c.dot(_d); if (tc < 0 || tc - r > max) continue;
        const d2 = _c.lengthSq() - tc * tc; if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t > 0 && t < max && (!best || t < best.t)) best = { e, t, head, owner: api };
      }
    }
    if (best) best.point = [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t];
    return best;
  }

  const TRACER = { grunt: '#50d8ff', heavy: '#ff5030', shield: '#ffb040', marksman: '#c060ff' };
  function fire(e) {
    const from = e.tip.getWorldPosition(new THREE.Vector3()), aimAt = new THREE.Vector3(player.feet[0], player.feet[1] + player.height * 0.77, player.feet[2]);
    const dist = from.distanceTo(aimAt), moving = player.speed > 2.5 ? 0.7 : 1, sniper = e.K.name === 'marksman';
    const dark = 1 - 0.65 * env.dark(player.feet);   // in a dark zone they shoot at shapes
    // the longer the player stands in their sight the surer the shot: leaning out of cover for a moment is cheap
    const chance = dark * (sniper ? Math.min(0.92, 0.85 * tune.acc)
      : Math.min(0.7 + 0.15 * (tune.acc - 1), tune.acc * (0.5 - dist * 0.011) * moving * (e.K === KIND.heavy ? 0.85 : 1) * (0.3 + 0.7 * Math.min(1, player.exposed / 2.5)) * (player.crouch > 0.5 ? 0.7 : 1)));
    const hit = !(player.iframe > game.time) && R() < chance && seesPlayer(e);   // a dash's moment of grace: every shot misses
    if (!hit) aimAt.add(tmp.set(R() - 0.5, R() - 0.3, R() - 0.5).multiplyScalar(1.6 + dist * 0.06));
    const dir = aimAt.clone().sub(from).normalize();
    let end = aimAt;
    if (!hit) {   // a miss goes on to whatever is behind
      const w = physics.ray(from.toArray(), dir.toArray(), 60, player.collider());
      end = w ? new THREE.Vector3(...w.point) : from.clone().addScaledVector(dir, 60);
      if (w) vfx.burst(FX.impact, w.point, { direction: [-dir.x, -dir.y, -dir.z] });
    }
    vfx.beam({ from: from.toArray(), to: end.toArray(), width: sniper ? 0.07 : 0.035, color: TRACER[e.K.name], intensity: sniper ? 8 : 5, life: sniper ? 0.2 : 0.09 });
    // the shot as heard: near, a crack; far, duller and quieter (a low-passed version with more of the street in it)
    const heard = Math.hypot(from.x - player.feet[0], from.y - player.feet[1] - 1.5, from.z - player.feet[2]);
    if (sniper) sfx.play('nd_snipe', { at: from.toArray(), gain: heard > 20 ? 0.75 : 1, ref: 8 });
    else sfx.play(heard > 16 ? ['nd_bolt_far', 'nd_bolt'] : 'nd_bolt', { at: from.toArray(), gain: heard > 16 ? 0.85 : 0.8, ref: heard > 16 ? 9 : 5 });
    // a miss that passes within a metre and a half of the head: the round's whizz, where it passed
    if (!hit) {
      const head = tmp2.set(player.feet[0], player.feet[1] + player.height, player.feet[2]), k = Math.max(0, Math.min(end.distanceTo(from), head.clone().sub(from).dot(dir)));
      const near = from.clone().addScaledVector(dir, k);
      if (k > 2 && near.distanceTo(head) < 1.5) { sfx.play('nd_whizz', { at: near.toArray(), gain: 0.9, ref: 1.5, rate: 0.9 + R() * 0.2 }); game.flags.whizzes = (game.flags.whizzes || 0) + 1; }
    }
    if (hit) player.hurt(e.K.damage * (assist ? 0.12 : 1) * tune.dmg, e.pos);
    game.dirty = true;
  }

  /** the marksman in a fight: holds its post, lines up one heavy shot at a time behind a tightening beam */
  function snipe(e, dt, sees, dist) {
    if (game.time - e.seenT > 6) { e.state = 'post'; e.charge = 0; e.agent.setGoal(e.home); return; }
    if (Math.hypot(e.pos[0] - e.home[0], e.pos[2] - e.home[2]) > 1.5 && (e.agent.arrived || !e.agent.path)) e.agent.setGoal(e.home);
    const can = sees && dist < e.K.fire && e.jam <= 0;
    if (can && (e.next -= dt) <= 0) {
      if (e.charge === 0) { sfx.play('nd_charge', { at: e.pos, gain: 0.8, ref: 7 }); bark(e, 'aim', 9); }
      e.charge += dt;
      if (e.charge >= e.K.tele) { fire(e); e.charge = 0; e.next = 2.2 + R(); }
    } else if (!can) e.charge = Math.max(0, e.charge - dt * 3);
  }

  /** the hound in a fight: flank and close in; within reach a tell (a crouch, the lights flare, a charge sound), then
   *  a leap at where the player stood; the hauler's turret fires bursts on the way. Returns what it faces */
  const LEAP = 0.42;
  function hunt(e, dt, sees, dist) {
    const p = player.feet, K = e.K;
    e.cool = Math.max(0, e.cool - dt);
    if (game.time - e.seenT > 5 && e.leapT <= 0 && e.charge <= 0) { e.state = 'search'; e.t = 0; if (e.lastSeen) e.agent.setGoal(nav.nearest(e.lastSeen, { snap: 2 }) || e.lastSeen); return null; }
    if (e.leapT > 0) {   // in the air: along a straight line to where it aimed, kept on the walk grid
      e.leapT += dt;
      const k = Math.min(1, e.leapT / LEAP), a = e.leapFrom, b = e.leapTo;
      e.agent.place([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      e.pos = e.agent.pos;
      if (k >= 1) {
        e.leapT = 0; e.cool = 2.4 + R();
        if (Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]) < 1.35 && Math.abs(p[1] - e.pos[1]) < 1.2 && !(player.iframe > game.time) && !player.dead) {
          player.hurt(K.bite * (assist ? 0.12 : 1) * tune.dmg, e.pos); sfx.play('nd_bolt', { at: [e.pos[0], e.pos[1] + 0.4, e.pos[2]], gain: 0.7, ref: 4, rate: 0.6 });
        }
        // back off a few metres to come again
        const away = nav.nearest([e.pos[0] - e.heading[0] * 3.5, e.pos[1], e.pos[2] - e.heading[1] * 3.5], { snap: 2 }); if (away) e.agent.setGoal(away);
      }
      return e.leapTo;
    }
    if (e.charge > 0) {   // the tell: crouched, facing the player, then the leap
      e.agent.stop(); e.charge += dt;
      if (e.charge >= K.tele) {
        e.charge = 0;
        if (sees && dist < 4.6 && e.jam <= 0) {
          const l = Math.max(dist, 0.01), to = [p[0] - (p[0] - e.pos[0]) / l * 0.7, p[1], p[2] - (p[2] - e.pos[2]) / l * 0.7];
          e.leapFrom = e.pos.slice(); e.leapTo = nav.nearest(to, { snap: 1.5 }) || e.pos.slice(); e.leapT = 1e-4;
          sfx.play('nd_whizz', { at: [e.pos[0], e.pos[1] + 0.4, e.pos[2]], gain: 0.8, ref: 4, rate: 0.55 });
        } else e.cool = 0.8;
      }
      return p;
    }
    if (sees && dist < 3.6 && e.cool <= 0 && e.jam <= 0 && Math.abs(p[1] - e.pos[1]) < 1.2) {
      e.charge = 1e-4; sfx.play('nd_charge', { at: [e.pos[0], e.pos[1] + 0.4, e.pos[2]], gain: 0.85, ref: 6, rate: 1.4 }); bark(e, 'aim', 6);
      return p;
    }
    // the hauler's turret: bursts like a sentinel's (two robots fire at a time)
    if (K.burst && e.burst > 0) { if ((e.next -= dt) <= 0) { fire(e); e.burst--; e.next = K.gap || 0.13; if (e.burst === 0) e.next = 1.6 + R() * 1.4; } }
    else if (K.burst && sees && dist < K.fire && e.jam <= 0 && (e.next -= dt) <= 0) { if (firing() < 2) e.burst = K.burst; else e.next = 0.3 + R() * 0.4; }
    // flank: a point beside the player, on the side the hound is already on, coming round as it closes
    if ((e.shift -= dt) <= 0 || e.agent.arrived || !e.agent.path) {
      e.shift = 0.5 + R() * 0.3;
      const from = Math.atan2(e.pos[2] - p[2], e.pos[0] - p[0]), side = e.side ??= R() < 0.5 ? 1 : -1, r = dist > 7 ? 3.2 : 1.6;
      const a = from + side * (dist > 7 ? 0.9 : 0.35);
      e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = K.speed;
      e.agent.setGoal(nav.nearest([p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], { snap: 2 }) || e.lastSeen || p);
    }
    return sees && dist < 9 ? p : null;
  }
  const firing = () => { let n = 0; for (const o of list) if (!o.dead && (o.burst > 0 || o.tele > 0)) n++; return n; };
  function think(e, dt) {
    const p = player.feet, dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], dist = Math.hypot(dx, dz);
    e.t += dt;
    e.jam = Math.max(0, e.jam - dt); e.shieldOff = Math.max(0, e.shieldOff - dt);
    if (e.stun > 0) {   // stunned: arms down, sparks, nothing else
      e.stun -= dt; e.agent.stop(); e.aim += (0 - e.aim) * Math.min(1, dt * 7);
      if ((e.sparkT -= dt) <= 0) { e.sparkT = 0.3 + R() * 0.3; vfx.burst(FX.hit, [e.pos[0] + (R() - 0.5) * 0.4, e.pos[1] + 1.2 + R() * 0.5, e.pos[2] + (R() - 0.5) * 0.4], { direction: [0, 1, 0], scale: 0.5 }); }
      return;
    }
    const sees = !player.dead && dist < e.K.range + 4 && seesPlayer(e);
    if (sees) { e.lastSeen = p.slice(); e.seenT = game.time; }
    let face = null, wantAim = 0;
    switch (e.state) {
      case 'post': {   // stand, or walk the patrol
        if (sees) { alert(e, p); for (const o of byZone[e.def.zone] || []) if (o !== e) alert(o, p, 0.5 + R() * 0.6); break; }
        const pts = e.def.patrol;
        if (pts && (e.agent.arrived || !e.agent.path)) { if ((e.wait -= dt) <= 0) { const [x, z] = pts[e.patrolI++ % pts.length]; e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = 1.3; e.agent.setGoal([x, e.pos[1], z]); e.wait = 1.5 + R() * 2; } }
        break;
      }
      case 'alert': {   // noticed something: turn to it, then fight or go and look
        e.agent.stop();
        if (e.lastSeen) face = e.lastSeen;
        wantAim = 0.5;
        if (e.t > e.wait) {
          e.state = sees || game.time - e.seenT < 2 ? 'fight' : 'search'; e.t = 0; e.shift = 0; e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed;
          if (e.state === 'search' && e.lastSeen && e.K.name !== 'marksman') e.agent.setGoal(nav.nearest(e.lastSeen, { snap: 2 }) || e.lastSeen);
          if (e.state === 'fight') bark(e, 'fight', 10);
        }
        break;
      }
      case 'fight': {
        if (player.dead) { e.state = 'post'; e.agent.stop(); break; }
        if (e.K.name === 'marksman') { snipe(e, dt, sees, dist); face = e.lastSeen || p; wantAim = sees ? 1 : 0.5; break; }
        if (e.K.type === 'hound') { face = hunt(e, dt, sees, dist); wantAim = sees ? 1 : 0; break; }
        const lost = game.time - e.seenT;
        if (lost > 5) { e.state = 'search'; e.t = 0; bark(e, 'search', 8); if (e.lastSeen) e.agent.setGoal(nav.nearest(e.lastSeen, { snap: 2 }) || e.lastSeen); break; }
        const canFire = sees && dist < e.K.fire && e.jam <= 0;
        if (canFire) { face = p; wantAim = 1; }
        if (e.burst > 0 || e.tele > 0) {   // committed: stand and shoot
          e.agent.stop(); face = e.lastSeen || p; wantAim = 1;
          if (e.tele > 0) { e.tele -= dt; if (e.tele <= 0) e.next = 0; }
          else if ((e.next -= dt) <= 0) { fire(e); e.burst--; e.next = e.K.gap || 0.13; if (e.burst === 0) { e.next = 1.7 + R() * 1.5; e.shift = 0; } }
        } else if (canFire) {
          if ((e.next -= dt) <= 0 && e.aim > 0.8) {
            if (firing() < 2) {   // two fire at a time; the visor flares before the burst (a warden's whine and red light: 0.8 s)
              e.burst = e.K.burst; e.tele = e.K.tele;
              if (e.K.name === 'heavy') { sfx.play('nd_warn', { at: [e.pos[0], e.pos[1] + 1.5, e.pos[2]], gain: 0.9, ref: 6 }); bark(e, 'suppress', 7); }
            } else e.next = 0.3 + R() * 0.4;
          }
          // between bursts: side-step to a spot nearby now and then
          if ((e.shift -= dt) <= 0 && (e.agent.arrived || !e.agent.path)) {
            e.shift = 1.8 + R() * 2;
            const a = Math.atan2(dz, dx) + (R() < 0.5 ? 1 : -1) * (1.1 + R() * 0.6), r = 2 + R() * 2.5, want = dist > 11 ? -0.5 : dist < 5 ? 0.6 : 0;
            const g = nav.nearest([e.pos[0] + Math.cos(a) * r - (dx / dist) * want * 3, e.pos[1], e.pos[2] + Math.sin(a) * r - (dz / dist) * want * 3], { snap: 1.5 });
            if (g) e.agent.setGoal(g);
          }
        } else if (e.lastSeen && (e.agent.arrived || !e.agent.path || (e.shift -= dt) <= 0)) {   // no line of fire: close in on where the player was seen
          e.shift = 0.8;
          e.agent.setGoal(nav.nearest(sees ? p : e.lastSeen, { snap: 2 }) || e.lastSeen);
        }
        break;
      }
      case 'search': {   // at the last place it knew: look round, then go home (a lure holds them there a while)
        if (sees) { e.state = 'fight'; e.t = 0; e.lureT = 0; bark(e, 'fight', 6); break; }
        if (e.lureT > 0) { e.lureT -= dt; if (e.agent.arrived || !e.agent.path) e.yaw += dt * 1.2; break; }
        if (e.agent.arrived || !e.agent.path || e.t > 9) { if (e.t > 3) { e.state = 'post'; e.t = 0; e.agent.setGoal(e.home); } else e.yaw += dt * 1.6; }
        break;
      }
    }
    // turn: toward what it faces, else along its walk
    const hx = e.agent.heading[0], hz = e.agent.heading[1];
    let want = e.yaw;
    if (face) want = Math.atan2(face[0] - e.pos[0], face[2] - e.pos[2]);
    else if (e.agent.moving) want = Math.atan2(hx, hz);
    let d = want - e.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    e.yaw += d * Math.min(1, dt * (face ? 9 : 6));
    e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw);
    e.aim += (wantAim - e.aim) * Math.min(1, dt * 7);
  }

  /** one fixed step */
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  /** the level of detail by distance, with hysteresis (near within 12 m, the far version past 30 m) */
  function setLod(e, d) {
    const want = d > (e.lod === 2 ? 28 : 31) ? 2 : d > (e.lod >= 1 ? 11 : 13) ? 1 : 0;
    if (want === e.lod) return;
    e.lod = want; e.sets.forEach((set, i) => { for (const m of set) m.visible = i === want; });
  }
  /** the holdout keeps its hounds back until the third wave (released once the second is called), then sends them
   *  first among the small fry: the holdout picks from the list in its order */
  let houndsFirst = false;
  function reserve() {
    const w = game.flags.wave || 0;
    for (const e of hounds) {
      if (w < 2 && e.dead && !e.rig.root.visible && !e.reserved) { e.reserved = true; e.dead = false; e.active = false; }
      else if (w >= 2 && e.reserved) { e.reserved = false; e.dead = true; e.deadT = 99; }
    }
    if (w >= 2 && !houndsFirst) { houndsFirst = true; const rest = list.filter((e) => !hounds.includes(e)); list.length = 0; list.push(...hounds, ...rest); }
  }
  function update(dt) {
    if (!nav) return false;
    if (game.flags.holdout && hounds.length) reserve();
    let moved = false;
    senses.update(dt);
    let seen = false;
    for (const e of list) if (!e.dead && e.active) { think(e, dt); if (e.state === 'fight' && game.time - e.seenT < 0.1) seen = true; }
    player.exposed = seen ? player.exposed + dt : Math.max(0, player.exposed - dt * 2);
    crowd.update(dt);
    let teller = null, tellD = 1e9;
    for (const e of list) {
      const rootObj = e.rig.root;
      const kit = !e.dead && rootObj.visible && e.shieldOff <= 0 && e.stun <= 0;
      if (e.shield) { e.shield.visible = kit; e.emitter.visible = kit; }
      if (e.beam) e.beam.visible = false;
      if (!rootObj.visible) continue;
      if (e.dead) {
        e.deadT += dt;
        if (e.deadT < 1.2) { e.anim.update(dt); moved = true; }
        else if (e.deadT > 7) { const k = Math.max(0, 1 - (e.deadT - 7) / 1.2); rootObj.scale.setScalar(e.K.scale * (0.6 + 0.4 * k)); rootObj.position.y = e.pos[1] - (1 - k) * 0.5; if (k <= 0) rootObj.visible = false; moved = true; }
        continue;
      }
      if (!e.active) continue;
      const far = Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) > 60;
      const px = rootObj.position.x, pz = rootObj.position.z;
      rootObj.position.set(e.pos[0], e.pos[1], e.pos[2]); rootObj.rotation.y = e.yaw;
      const sp = Math.hypot(e.pos[0] - px, e.pos[2] - pz) / dt;
      e.speed += (Math.min(sp, 4.4) - e.speed) * Math.min(1, dt * 8);
      if (e.K.name === 'heavy' && e.tele > 0) { const dd = Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]); if (dd < tellD) { tellD = dd; teller = e; } }
      if (e.beam && e.charge > 0) {   // the beam: from the muzzle to the player, wide and loose at first, a thread at the end
        const k = Math.min(1, e.charge / e.K.tele), w = 0.06 * (1 - k) + 0.01, j = (1 - k) * 0.6;
        e.tip.getWorldPosition(_a); _b.set(player.feet[0] + Math.sin(game.time * 3.1) * j, player.feet[1] + player.height * 0.8 + Math.sin(game.time * 4.3) * j * 0.5, player.feet[2] + Math.cos(game.time * 2.7) * j);
        const len = Math.max(0.5, _a.distanceTo(_b) - 1.4);   // it stops short of the eye, so it reads as a line, not a wall
        e.beam.position.copy(_a); e.beam.lookAt(_b); e.beam.scale.set(w, w, len); e.beam.visible = true;
        e.beam.material.opacity = 0.25 + 0.7 * k * (k > 0.85 ? 0.6 + 0.4 * Math.sin(game.time * 50) : 1);
      }
      if (far) continue;
      setLod(e, Math.hypot(e.pos[0] - player.feet[0], e.pos[1] - player.feet[1], e.pos[2] - player.feet[2]));
      if (e.dog) {   // the hound's pose: the tell's crouch, the leap, the turret on the player
        const P = e.pose, ta = Math.atan2(player.feet[0] - e.pos[0], player.feet[2] - e.pos[2]) - e.yaw;
        P.crouch = e.charge > 0 ? Math.min(1, e.charge / 0.2) : e.stun > 0 ? 0.6 : 0;
        P.leap = e.leapT > 0 ? Math.min(1, e.leapT / LEAP) : 0;
        P.aim += (Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(ta), Math.cos(ta)))) * (e.state === 'fight' ? 1 : 0) - P.aim) * Math.min(1, dt * 6);
      } else {   // playback scaled to the ground covered: the blend's own speed is the clips' travel over their length
        blend1d(BLEND, e.speed, bw);
        const W = CLIP_SPEED, v = (bw[1] * W.walk[0] * W.walk[1] + bw[2] * W.run[0] * W.run[1]) / (bw[0] * W.idle[1] + bw[1] * W.walk[1] + bw[2] * W.run[1]);
        e.anim.set('rate', v > 0.05 ? Math.min(2.4, Math.max(0.5, e.speed / v)) : 1);
      }
      e.anim.set('speed', e.speed); e.anim.setLayerWeight('aim', e.aim); e.anim.setLayerWeight('scan', e.state === 'post' ? 1 : 0);
      e.watch = e.state === 'fight' || e.state === 'alert' ? 1 : 0;
      e.anim.update(dt);
      moved = true;
    }
    // the warden's tell: a red lamp on its chest, pulsing fast while it winds up
    if (teller) {
      const room = Math.pow(Math.max(world.gradeLook ? world.exposure * world.gradeLook.exposure : world.exposure, 1e-4), -0.9);
      tell.position.set(teller.pos[0] + teller.heading[0] * 0.5, teller.pos[1] + 1.4, teller.pos[2] + teller.heading[1] * 0.5);
      tell.intensity = 26 * room * (0.55 + 0.45 * Math.sin(game.time * 34)) * (1 - teller.tele / teller.K.tele * 0.5);
    } else tell.intensity = 0;
    // the visors flare while a burst is being lined up (one shared material per kind: the nearest one drives it); a
    // jammed or stunned robot's visor stutters
    for (const k of Object.keys(KIND)) {
      let hot = 0, jammed = 0;
      for (const e of list) if (!e.dead && e.K === KIND[k]) { if (e.tele > 0 || e.charge > 0) hot = 1; if (e.jam > 0 || e.stun > 0) jammed = 1; }
      visorMat[k].color.setRGB(...KIND[k].visor).multiplyScalar(7 * (1 + 2.2 * hot * (0.6 + 0.4 * Math.sin(game.time * 40))) * (jammed && Math.sin(game.time * 23) > 0.3 ? 0.15 : 1));
    }
    rim.value.set(0.05, 0.11, 0.14).multiplyScalar(1 + 5 * env.rim);
    return moved;
  }
  const api = { list, byZone, start, update, damage, breakShield, rayHit, noise, wake, alert, eyeOf, revive, park, retune, tune, env, on, stun, stunAt, jam, hackable, darken, lure, KIND,
    get alive() { return list.filter((e) => !e.dead && e.active).length; }, get nav() { return nav; } };
  return api;
}

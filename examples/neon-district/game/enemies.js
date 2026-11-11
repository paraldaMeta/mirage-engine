// The sentinels: security androids on the district's walk grid.
//   body       @miragekit/play's code-authored rig (createRigModel) in armour colours, a visor, plates and a rifle on
//              its bones; animated by createAnimator: a speed blend (idle / walk / run), an aim pose on a masked upper
//              body layer, an additive flinch, a fall. The four extra clips are authored below.
//   moving     createNavGrid on the player's own walk grid, one createNavAgent each, createNavCrowd keeps them apart
//   seeing     createSenses: sight cones the walk grid occludes, and the noise of the player's shots
//   thinking   a small state machine: post / patrol -> alert -> fight (close in, hold and fire bursts, shift) -> search
// They are game entities with save / load, so a checkpoint restores who is down and where the others stand.
import * as THREE from 'three';
import { createRigModel, createAnimator, createNavGrid, createNavAgent, createNavCrowd, createSenses, solveLookAt, RIG } from '@miragekit/play';
import { FX } from './fx.js';

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

const KIND = {
  grunt: { name: 'grunt', hp: 60, speed: 3.0, damage: 5, burst: 3, visor: [0.1, 0.9, 1.0], colors: { skin: 0x14171b, shirt: 0x1b2026, trousers: 0x181c21, boots: 0x0c0d0f, hair: 0x14171b }, scale: 1 },
  heavy: { name: 'heavy', hp: 135, speed: 2.3, damage: 8, burst: 5, visor: [1.0, 0.16, 0.1], colors: { skin: 0x141211, shirt: 0x1d1917, trousers: 0x191514, boots: 0x0c0d0f, hair: 0x141211 }, scale: 1.1 },
};
const RANGE = 24, FOV = 130, FIRE_RANGE = 19;

export function createEnemies({ world, game, physics, plan, vfx, sfx, player, assist, onDispose }) {
  const { mat } = world;
  const armour = mat.std({ vertexColors: true, roughness: 0.42, metalness: 0.45 });
  const plate = mat.std({ color: new THREE.Color(0.03, 0.035, 0.045), roughness: 0.35, metalness: 0.9 });
  const visorMat = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, mat.glow(v.visor, 7)]));
  const extra = extraClips();
  const list = [], byZone = {};
  let nav = null, crowd = null, senses = null, rnd = 0x9e3779b9;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const tmp = new THREE.Vector3();

  function build(def) {
    const K = KIND[def.kind || 'grunt'], rig = createRigModel({ material: armour, colors: K.colors });
    rig.root.scale.setScalar(K.scale);
    // ---- the armour: plates, joints and lights authored in the rig's own space (T-pose, +Z forward, +X its left) and
    // skinned rigidly, each part to one bone. Two extra skinned meshes on the rig's skeleton (plates, lights) instead
    // of a mesh per part: a sentinel is four draws however many parts it has.
    const B = rig.bones, bones = rig.mesh.skeleton.bones, heavy = def.kind === 'heavy';
    const plates = [], lights = [], col = new THREE.Color();
    const part = (list, bone, geo, p, color, r = [0, 0, 0]) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1)));
      const n = g.attributes.position.count, c = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), bi = bones.indexOf(B[bone]);
      col.set(color);
      for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.deleteAttribute('uv');
      list.push(g);
    };
    // rounded only where it reads (helmet, breastplate, pauldrons, thighs): a chamfered box is 108 triangles, a plain one 12
    const RBx = (w, h, d, r = 0.02) => (r >= 0.04 ? new world.geom.RoundedBoxGeometry(w, h, d, 1, Math.min(r, 0.45 * Math.min(w, h, d))) : new THREE.BoxGeometry(w, h, d));
    const C = heavy ? { a: 0x5c4a44, b: 0x9a4a32, c: 0xe0703c, d: 0x1c1b1c } : { a: 0x56626f, b: 0x8593a2, c: 0xe2e8ee, d: 0x1c2026 };   // shell, plate, accent, joint
    // head: a helmet with a brow, cheek guards, a chin, ear pods, an antenna; the visor is a lit band (one eye on a warden)
    part(plates, 'Head', RBx(0.25, 0.25, 0.28, 0.07), [0, 1.675, -0.005], C.a);
    part(plates, 'Head', RBx(0.27, 0.06, 0.2, 0.02), [0, 1.755, 0.05], C.b, [0.25, 0, 0]);
    part(plates, 'Head', RBx(0.2, 0.09, 0.1, 0.03), [0, 1.585, 0.085], C.b, [-0.2, 0, 0]);
    for (const s of [-1, 1]) { part(plates, 'Head', new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateZ(Math.PI / 2), [s * 0.135, 1.66, -0.02], C.d); part(plates, 'Head', RBx(0.03, 0.12, 0.14, 0.01), [s * 0.125, 1.63, 0.07], C.b); }
    part(plates, 'Head', RBx(0.012, 0.2, 0.012, 0), [0.1, 1.88, -0.07], C.d);
    part(plates, 'Head', RBx(0.05, 0.16, 0.2, 0.02), [0, 1.8, -0.03], C.c);                                              // a crest
    if (heavy) part(lights, 'Head', new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14).rotateX(Math.PI / 2), [0, 1.675, 0.14], 0xffffff);
    else part(lights, 'Head', RBx(0.21, 0.04, 0.03, 0.01), [0, 1.685, 0.135], 0xffffff);
    part(plates, 'Neck', new THREE.CylinderGeometry(0.075, 0.095, 0.1, 10), [0, 1.5, 0], C.d);
    // torso: a layered breastplate, a collar yoke, a core light, ribbed abdomen, a pelvis block with hip plates
    part(plates, 'Chest', RBx(heavy ? 0.5 : 0.43, 0.3, 0.26, 0.05), [0, 1.34, 0.01], C.a);
    for (const s of [-1, 1]) part(plates, 'Chest', RBx(0.19, 0.17, 0.06, 0.02), [s * 0.105, 1.37, 0.14], C.b, [-0.12, s * 0.2, 0]);
    part(plates, 'Chest', RBx(heavy ? 0.56 : 0.48, 0.07, 0.24, 0.02), [0, 1.485, 0], C.b);
    part(plates, 'Chest', RBx(0.1, 0.03, 0.02, 0), [0.1, 1.44, 0.165], C.c); part(plates, 'Chest', RBx(0.16, 0.012, 0.012, 0), [-0.1, 1.29, 0.165], C.c);
    part(lights, 'Chest', RBx(0.05, 0.05, 0.02, 0.005), [0, 1.34, 0.168], 0xffffff);
    for (const y of [1.06, 1.12, 1.18]) part(plates, 'Spine', RBx(0.31 - (1.18 - y) * 0.4, 0.045, 0.2, 0.015), [0, y, 0.005], y === 1.12 ? C.d : C.b);
    part(plates, 'Hips', RBx(0.35, 0.15, 0.23, 0.04), [0, 0.945, 0], C.a);
    for (const s of [-1, 1]) part(plates, 'Hips', RBx(0.05, 0.2, 0.2, 0.02), [s * 0.185, 0.9, 0], C.b, [0, 0, s * 0.12]);
    part(plates, 'Hips', RBx(0.12, 0.12, 0.06, 0.02), [0, 0.9, 0.12], C.b);
    // the pack: a power unit with two canisters and heat vents that glow
    part(plates, 'Chest', RBx(0.32, 0.36, 0.15, 0.03), [0, 1.3, -0.2], C.b);
    for (const s of [-1, 1]) part(plates, 'Chest', new THREE.CylinderGeometry(0.045, 0.045, 0.3, 10), [s * 0.11, 1.33, -0.29], C.d);
    for (const y of [1.2, 1.25]) part(lights, 'Chest', RBx(0.2, 0.016, 0.012, 0), [0, y, -0.277], 0xffffff);
    part(plates, 'Chest', RBx(0.3, 0.04, 0.16, 0.01), [0, 1.5, -0.2], C.c);
    // arms and legs, both sides: pauldron, upper plate, elbow, gauntlet; thigh, knee, shin, boot; a light at each joint
    for (const [side, x] of [['Left', 1], ['Right', -1]]) {
      part(plates, `${side}Arm`, RBx(heavy ? 0.27 : 0.22, heavy ? 0.2 : 0.16, 0.24, 0.06), [x * 0.245, 1.45, 0], C.b, [0, 0, x * -0.25]);
      part(plates, `${side}Arm`, RBx(0.05, 0.035, 0.25, 0.01), [x * 0.255, 1.53, 0], C.c);
      part(plates, `${side}Arm`, RBx(0.17, 0.105, 0.11, 0.03), [x * 0.36, 1.4, 0], C.a);
      part(plates, `${side}ForeArm`, new THREE.CylinderGeometry(0.052, 0.052, 0.07, 10).rotateX(Math.PI / 2), [x * 0.47, 1.4, 0], C.d);
      part(lights, `${side}ForeArm`, RBx(0.025, 0.025, 0.115, 0), [x * 0.47, 1.4, 0], 0xffffff);
      part(plates, `${side}ForeArm`, RBx(0.2, 0.095, 0.1, 0.03), [x * 0.6, 1.4, 0], C.b);
      part(plates, `${side}ForeArm`, RBx(0.12, 0.03, 0.105, 0.01), [x * 0.6, 1.455, 0], C.c);
      part(plates, `${side}Hand`, RBx(0.1, 0.06, 0.08, 0.02), [x * 0.78, 1.4, 0], C.d);
      part(plates, `${side}UpLeg`, RBx(0.155, 0.32, 0.17, 0.04), [x * 0.1, 0.73, 0.012], C.a);
      part(plates, `${side}UpLeg`, RBx(0.1, 0.2, 0.03, 0.01), [x * 0.1, 0.76, 0.1], C.b);
      part(plates, `${side}Leg`, RBx(0.115, 0.11, 0.09, 0.03), [x * 0.1, 0.5, 0.065], C.b);
      part(lights, `${side}Leg`, RBx(0.125, 0.02, 0.02, 0), [x * 0.1, 0.5, 0.112], 0xffffff);
      part(plates, `${side}Leg`, RBx(0.125, 0.3, 0.135, 0.035), [x * 0.1, 0.29, 0.008], C.a);
      part(plates, `${side}Leg`, RBx(0.05, 0.22, 0.03, 0.01), [x * 0.1, 0.3, -0.075], C.d);
      part(plates, `${side}Foot`, RBx(0.135, 0.105, 0.27, 0.03), [x * 0.1, 0.052, 0.04], C.d);
      part(plates, `${side}Foot`, RBx(0.14, 0.03, 0.1, 0.01), [x * 0.1, 0.11, 0.1], C.b);
    }
    if (heavy) {   // a warden carries a light bar on the left shoulder and thicker shins
      part(plates, 'LeftArm', RBx(0.1, 0.12, 0.3, 0.02), [0.27, 1.6, -0.02], C.a);
      part(lights, 'LeftArm', RBx(0.08, 0.05, 0.02, 0), [0.27, 1.61, 0.135], 0xffffff);
      for (const x of [-1, 1]) part(plates, x > 0 ? 'LeftLeg' : 'RightLeg', RBx(0.15, 0.16, 0.16, 0.03), [x * 0.1, 0.36, 0.02], C.b);
    }
    const skin = (list, material) => { const m = new THREE.SkinnedMesh(world.geom.mergeGeometries(list, false), material); m.bind(rig.mesh.skeleton, rig.mesh.bindMatrix); m.frustumCulled = false; m.castShadow = material === armour; m.receiveShadow = true; rig.root.add(m); return m; };
    skin(plates, armour); skin(lights, visorMat[def.kind || 'grunt']);
    // the rifle lies along the right hand's own -X (the arm's axis): receiver, barrel, magazine, stock, a lit muzzle
    const gun = new THREE.Group(); B.RightHand.add(gun); gun.position.set(-0.1, -0.02, 0.02);
    const gparts = [[RBx(0.5, 0.085, 0.055, 0.01), [-0.06, 0.02, 0]], [new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8).rotateZ(Math.PI / 2), [-0.42, 0.03, 0]], [RBx(0.07, 0.16, 0.04, 0.01), [0.02, -0.08, 0]], [RBx(0.2, 0.06, 0.045, 0.01), [0.27, 0.0, 0]], [RBx(0.16, 0.03, 0.03, 0), [-0.1, 0.075, 0]]]
      .map(([g, p]) => g.translate(...p).toNonIndexed());
    const gunMesh = new THREE.Mesh(world.geom.mergeGeometries(gparts, false), plate); gunMesh.castShadow = true; gun.add(gunMesh);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), visorMat[def.kind || 'grunt']); tip.position.set(-0.58, 0.03, 0); gun.add(tip);
    rig.root.traverse((o) => { o.userData.occlude = false; });
    // a top-level object marked mgDynamic: the lamps' cached shadow tiles are drawn again when it moves near them,
    // and the probe bakes leave it out; collide = false keeps it out of the walk grid (it is not under the game's group)
    rig.root.userData.mgDynamic = true; rig.root.userData.collide = false; rig.root.name = def.id;
    world.scene.add(rig.root);
    onDispose(() => rig.root.removeFromParent());
    const anim = createAnimator(rig.root, [...rig.clips, ...extra], {
      parameters: { speed: 0, flinch: 'trigger', dead: false }, rootMotion: { bone: 'Root' },
      layers: [
        { name: 'base', start: 'move', states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [RIG.walk, 'walk'], [RIG.run, 'run']] } }, die: { clip: 'die', loop: false } },
          transitions: [{ from: 'move', to: 'die', when: ['dead'], duration: 0.08 }] },
        { name: 'aim', mask: ['Chest'], weight: 0, start: 'aim', states: { aim: { clip: 'aim' } } },
        { name: 'flinch', additive: true, start: 'none', states: { none: {}, flinch: { clip: 'flinch', loop: false } },
          transitions: [{ from: '*', to: 'flinch', when: ['flinch'], duration: 0.03 }, { from: 'flinch', to: 'none', exitTime: 0.95, duration: 0.05 }] },
        { name: 'scan', additive: true, weight: 1, start: 'scan', states: { scan: { clip: 'scan' } } },
      ],
    });
    const e = {
      id: def.id, def, K, rig, anim, tip, hp: K.hp, state: 'post', home: def.at.slice(), pos: def.at.slice(), yaw: def.face ?? 0, agent: null,
      aim: 0, watch: 0, t: 0, wait: 0, burst: 0, next: 1 + R() * 1.5, tele: 0, lastSeen: null, seenT: -1e9, shift: 0, patrolI: 0, dead: false, deadT: 0, active: def.zone !== 'wave' && def.zone !== 'relay', speed: 0,
      heading: [Math.sin(def.face ?? 0), Math.cos(def.face ?? 0)],
    };
    // the head follows the player once it knows of them (after the clips have posed the bones)
    const eyeAt = new THREE.Vector3();
    anim.post.push(() => { if (e.watch && !e.dead) solveLookAt([B.Neck, B.Head], eyeAt.set(player.feet[0], player.feet[1] + player.height, player.feet[2]), { share: [0.4, 0.6], limit: 0.9 }); });
    rig.root.position.set(...e.pos); rig.root.rotation.y = e.yaw; rig.root.visible = e.active;   // the wave and the relay's two are not drawn until they are woken
    anim.update(0);
    // an entity: the playtest can look at it by id, and a checkpoint saves it
    game.add({ id: def.id, enemy: e, interact: { can: () => false, label: '', at: () => [e.pos[0], e.pos[1] + 1.2 * K.scale, e.pos[2]] },   // not usable: `at` lets tools look at it by id
      save: () => ({ hp: e.hp, dead: e.dead, pos: e.pos.map((v) => +v.toFixed(2)), yaw: +e.yaw.toFixed(2), active: e.active, shown: rig.root.visible }),
      load: (s) => restore(e, s) });
    list.push(e); (byZone[def.zone] ||= []).push(e);
    return e;
  }
  function restore(e, s) {
    e.hp = s.hp; e.dead = s.dead; e.pos = s.pos.slice(); e.yaw = s.yaw; e.active = s.active; e.state = s.dead ? 'dead' : 'post'; e.aim = 0; e.burst = 0; e.tele = 0; e.lastSeen = null; e.deadT = s.dead ? 99 : 0;
    e.rig.root.visible = s.shown && !s.dead; e.rig.root.position.set(...e.pos); e.rig.root.rotation.y = e.yaw; e.rig.root.scale.setScalar(e.K.scale);
    e.anim.reset(); e.anim.set('dead', false); e.anim.set('speed', 0); e.anim.setLayerWeight('aim', 0); e.anim.update(0);
    if (e.agent) { e.agent.stop(); e.agent.walker.place(e.pos); }
  }
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
  const seesPlayer = (e) => senses.sees({ pos: e.pos, heading: e.heading }, { pos: player.feet }, { range: RANGE, fov: e.state === 'fight' ? 300 : FOV, near: 2.5, eye: 1.55, height: player.height * 0.93 });
  function alert(e, where, delay = 0) {
    if (e.dead || !e.active || e.state === 'fight' || e.state === 'alert') return;
    e.state = 'alert'; e.t = 0; e.wait = 0.35 + delay + R() * 0.3; e.lastSeen = where ? where.slice() : null;
  }
  /** a noise at `pos` (the player's shots): whoever is awake within `radius` turns to it */
  function noise(pos, radius = 22) {
    for (const e of list) if (!e.dead && e.active && Math.hypot(e.pos[0] - pos[0], e.pos[2] - pos[2]) < radius && Math.abs(e.pos[1] - pos[1]) < 5) alert(e, pos, 0.15);
  }
  function wake(zone, where) { for (const e of byZone[zone] || []) if (!e.dead) { e.active = true; e.rig.root.visible = true; if (where) alert(e, where, R() * 0.8); } }

  function damage(e, amount, head, point, dir) {
    if (e.dead) return false;
    e.hp -= amount * (head ? 2.2 : 1);
    e.anim.trigger('flinch');
    vfx.burst(FX.hit, point, { direction: [-dir[0], -dir[1] + 0.4, -dir[2]] });
    e.active = true; alert(e, player.feet);
    for (const o of byZone[e.def.zone] || []) if (o !== e) alert(o, player.feet, 0.3 + R() * 0.5);
    if (e.hp <= 0) {
      e.dead = true; e.state = 'dead'; e.deadT = 0; e.anim.set('dead', true); e.anim.setLayerWeight('aim', 0); e.agent.stop(); crowd.remove(e.agent);
      vfx.burst(FX.down, [e.pos[0], e.pos[1] + 1.1, e.pos[2]]);
      sfx.play('nd_death', { at: [e.pos[0], e.pos[1] + 1, e.pos[2]], gain: 0.9, ref: 4 });
      game.emit('kill', e);
      return true;
    }
    return false;
  }

  /** the nearest sentinel a ray hits before `max`: { e, t, head, point } (three body spheres and a head) */
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
  function rayHit(origin, dir, max) {
    let best = null;
    _o.fromArray(origin); _d.fromArray(dir);
    for (const e of list) {
      if (e.dead || !e.rig.root.visible) continue;
      const s = e.K.scale;
      for (const [h, r, head] of [[1.66 * s, 0.17 * s, true], [1.25 * s, 0.3 * s, false], [0.85 * s, 0.3 * s, false], [0.4 * s, 0.27 * s, false]]) {
        _c.set(e.pos[0], e.pos[1] + h, e.pos[2]).sub(_o);
        const tc = _c.dot(_d); if (tc < 0 || tc - r > max) continue;
        const d2 = _c.lengthSq() - tc * tc; if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t > 0 && t < max && (!best || t < best.t)) best = { e, t, head, owner: api };
      }
    }
    if (best) best.point = [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t];
    return best;
  }

  function fire(e) {
    const from = e.tip.getWorldPosition(new THREE.Vector3()), aimAt = new THREE.Vector3(player.feet[0], player.feet[1] + player.height * 0.77, player.feet[2]);
    const dist = from.distanceTo(aimAt), moving = player.speed > 2.5 ? 0.7 : 1;
    // the longer the player stands in their sight the surer the shot: leaning out of cover for a moment is cheap
    const chance = Math.min(0.7, (0.5 - dist * 0.011) * moving * (e.K === KIND.heavy ? 0.85 : 1) * (0.3 + 0.7 * Math.min(1, player.exposed / 2.5)) * (player.crouch > 0.5 ? 0.7 : 1));
    const hit = R() < chance && seesPlayer(e);
    if (!hit) aimAt.add(tmp.set(R() - 0.5, R() - 0.3, R() - 0.5).multiplyScalar(1.6 + dist * 0.06));
    const dir = aimAt.clone().sub(from).normalize();
    let end = aimAt;
    if (!hit) {   // a miss goes on to whatever is behind
      const w = physics.ray(from.toArray(), dir.toArray(), 60, player.collider());
      end = w ? new THREE.Vector3(...w.point) : from.clone().addScaledVector(dir, 60);
      if (w) vfx.burst(FX.impact, w.point, { direction: [-dir.x, -dir.y, -dir.z] });
    }
    vfx.beam({ from: from.toArray(), to: end.toArray(), width: 0.035, color: e.K === KIND.heavy ? '#ff5030' : '#50d8ff', intensity: 5, life: 0.09 });
    sfx.play('nd_bolt', { at: from.toArray(), gain: 0.8, ref: 5 });
    if (hit) player.hurt(e.K.damage * (assist ? 0.12 : 1), e.pos);
    game.dirty = true;
  }

  const firing = () => { let n = 0; for (const o of list) if (!o.dead && (o.burst > 0 || o.tele > 0)) n++; return n; };
  function think(e, dt) {
    const p = player.feet, dx = p[0] - e.pos[0], dz = p[2] - e.pos[2], dist = Math.hypot(dx, dz);
    e.t += dt;
    const sees = !player.dead && dist < RANGE + 4 && seesPlayer(e);
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
        if (e.t > e.wait) { e.state = sees || game.time - e.seenT < 2 ? 'fight' : 'search'; e.t = 0; e.shift = 0; e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = e.K.speed; if (e.state === 'search' && e.lastSeen) e.agent.setGoal(nav.nearest(e.lastSeen, { snap: 2 }) || e.lastSeen); }
        break;
      }
      case 'fight': {
        if (player.dead) { e.state = 'post'; e.agent.stop(); break; }
        const lost = game.time - e.seenT;
        if (lost > 5) { e.state = 'search'; e.t = 0; if (e.lastSeen) e.agent.setGoal(nav.nearest(e.lastSeen, { snap: 2 }) || e.lastSeen); break; }
        const canFire = sees && dist < FIRE_RANGE;
        if (canFire) { face = p; wantAim = 1; }
        if (e.burst > 0 || e.tele > 0) {   // committed: stand and shoot
          e.agent.stop(); face = e.lastSeen || p; wantAim = 1;
          if (e.tele > 0) { e.tele -= dt; if (e.tele <= 0) e.next = 0; }
          else if ((e.next -= dt) <= 0) { fire(e); e.burst--; e.next = 0.13; if (e.burst === 0) { e.next = 1.7 + R() * 1.5; e.shift = 0; } }
        } else if (canFire) {
          if ((e.next -= dt) <= 0 && e.aim > 0.8) { if (firing() < 2) { e.burst = e.K.burst; e.tele = 0.42; } else e.next = 0.3 + R() * 0.4; }   // two fire at a time; the visor flares before the burst   // the visor flares before the burst
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
      case 'search': {   // at the last place it knew: look round, then go home
        if (sees) { e.state = 'fight'; e.t = 0; break; }
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
  function update(dt) {
    if (!nav) return false;
    let moved = false;
    senses.update(dt);
    let seen = false;
    for (const e of list) if (!e.dead && e.active) { think(e, dt); if (e.state === 'fight' && game.time - e.seenT < 0.1) seen = true; }
    player.exposed = seen ? player.exposed + dt : Math.max(0, player.exposed - dt * 2);
    crowd.update(dt);
    for (const e of list) {
      const rootObj = e.rig.root;
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
      if (far) continue;
      e.anim.set('speed', e.speed); e.anim.setLayerWeight('aim', e.aim); e.anim.setLayerWeight('scan', e.state === 'post' ? 1 : 0);
      e.watch = e.state === 'fight' || e.state === 'alert' ? 1 : 0;
      e.anim.update(dt);
      moved = true;
    }
    // the visors flare while a burst is being lined up (one shared material per kind: the nearest one drives it)
    for (const k of Object.keys(KIND)) {
      let hot = 0;
      for (const e of list) if (!e.dead && e.K === KIND[k] && e.tele > 0) hot = 1;
      visorMat[k].color.setRGB(...KIND[k].visor).multiplyScalar(7 * (1 + 2.2 * hot * (0.6 + 0.4 * Math.sin(game.time * 40))));
    }
    return moved;
  }
  const api = { list, byZone, start, update, damage, rayHit, noise, wake, alert, eyeOf, get alive() { return list.filter((e) => !e.dead && e.active).length; }, get nav() { return nav; } };
  return api;
}

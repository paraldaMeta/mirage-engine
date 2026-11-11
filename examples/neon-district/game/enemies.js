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

// Four jobs on two rigs: they differ by kit, accent colour, behaviour and a tell the player can read.
//   grunt     the sentinel: closes in, side-steps, fires bursts
//   heavy     the warden: a red light and a rising whine 0.8 s before a long suppressing burst; cannot be hacked
//             from the front
//   shield    a sentinel with an amber energy shield in front that stops rounds; open it from the side, with an
//             EMP, a hack, or by shooting the emitter on the shield's lower rim
//   marksman  holds its post on high ground; a violet beam tightens on the player for 1.2 s before a heavy shot
const GRUNT_COLORS = { skin: 0x14171b, shirt: 0x1b2026, trousers: 0x181c21, boots: 0x0c0d0f, hair: 0x14171b };
const KIND = {
  grunt: { name: 'grunt', rig: 'grunt', hp: 60, speed: 3.0, damage: 5, burst: 3, tele: 0.42, range: 24, fire: 19, visor: [0.1, 0.9, 1.0], colors: GRUNT_COLORS, scale: 1 },
  heavy: { name: 'heavy', rig: 'heavy', hp: 135, speed: 2.3, damage: 7, burst: 9, gap: 0.09, tele: 0.8, range: 24, fire: 19, visor: [1.0, 0.16, 0.1], colors: { skin: 0x141211, shirt: 0x1d1917, trousers: 0x191514, boots: 0x0c0d0f, hair: 0x141211 }, scale: 1.1 },
  shield: { name: 'shield', rig: 'grunt', hp: 70, speed: 2.5, damage: 5, burst: 3, tele: 0.5, range: 24, fire: 17, visor: [1.0, 0.62, 0.08], accent: 0xffa020, shieldHp: 170, colors: GRUNT_COLORS, scale: 1.02 },
  marksman: { name: 'marksman', rig: 'grunt', hp: 55, speed: 2.4, damage: 30, burst: 1, tele: 1.2, range: 44, fire: 42, visor: [0.72, 0.2, 1.0], accent: 0xb050ff, eye: 1.8, colors: GRUNT_COLORS, scale: 0.98 },
};
const FOV = 130;

// tune: the difficulty, { dmg, hp, acc } factors on damage dealt to the player, health and accuracy (all 1: as built)
export function createEnemies({ world, game, physics, plan, vfx, sfx, player, assist, onDispose, tune = { dmg: 1, hp: 1, acc: 1 } }) {
  const { mat } = world;
  // a dim rim on the armour so a robot reads against a dark street; the visor (a dark zone, overdrive) raises it
  const rim = { value: new THREE.Vector3(0.05, 0.11, 0.14) };
  const armour = mat.std({ vertexColors: true, roughness: 0.42, metalness: 0.45 }, {
    uniforms: { uNdRim: rim }, fragmentDecl: 'uniform vec3 uNdRim;',
    output: 'outgoingLight += uNdRim * pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);' });
  const shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.08).multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.2, 1.0).multiplyScalar(4), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  // the warden's tell: one clustered lamp, put on whichever warden is winding up
  const tell = new THREE.PointLight(0xff3010, 0, 9, 2); world.scene.add(tell); world.lighting?.addLight(tell);
  /** hooks the rest of the game sets: env.dark(pos) 0..1, env.blind(from, to) (smoke), on.bark(e, key), on.pop(word, pos), on.dealt(amount) */
  const env = { dark: () => 0, blind: () => false, rim: 0 }, on = { bark: () => {}, pop: () => {}, dealt: () => {} };
  const plate = mat.std({ color: new THREE.Color(0.03, 0.035, 0.045), roughness: 0.35, metalness: 0.9 });
  const visorMat = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, mat.glow(v.visor, 7)]));
  const extra = extraClips();
  const list = [], byZone = {};
  let nav = null, crowd = null, senses = null, rnd = 0x9e3779b9;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  function build(def) {
    const K = KIND[def.kind || 'grunt'], rig = createRigModel({ material: armour, colors: K.colors });
    rig.root.scale.setScalar(K.scale);
    // ---- the armour: plates, joints and lights authored in the rig's own space (T-pose, +Z forward, +X its left) and
    // skinned rigidly, each part to one bone. Two extra skinned meshes on the rig's skeleton (plates, lights) instead
    // of a mesh per part: a sentinel is four draws however many parts it has.
    const B = rig.bones, bones = rig.mesh.skeleton.bones, heavy = K.rig === 'heavy';
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
    // shaped where it reads: silhouettes extruded with chamfered edges (side: a (z, y) profile across the width;
    // front: (x, y) through the depth; top: (x, z) through the height), lathed rings, tapered six-sided limbs.
    // An n-point chamfered profile is 8n - 4 triangles, so the profiles stay short.
    const HP = Math.PI / 2, O = [0, 0, 0], v2 = (pts) => pts.map(([a, b]) => new THREE.Vector2(a, b)), mx = (pts, s) => pts.map(([a, b]) => [a * s, b]);
    const front = (pts, d, b = 0.02) => new THREE.ExtrudeGeometry(new THREE.Shape(v2(pts)), { depth: d - 2 * b, steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1 }).translate(0, 0, -(d - 2 * b) / 2);
    const side = (pts, w, b) => front(pts, w, b).rotateY(-HP), top = (pts, h, b) => front(pts, h, b).rotateX(HP);
    const ring = (pts, n = 8) => new THREE.LatheGeometry(v2(pts), n, Math.PI / n);
    const limb = (r0, r1, len, x) => new THREE.CylinderGeometry(r1, r0, len, 6).rotateZ(-x * HP);   // along X: r0 at the body's end, r1 at the far end
    const RBx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const C = heavy ? { a: 0x5c4a44, b: 0x9a4a32, c: 0xe0703c, d: 0x1c1b1c } : { a: 0x56626f, b: 0x8593a2, c: K.accent ?? 0xe2e8ee, d: 0x1c2026 };   // shell, plate, accent, joint
    const W = heavy ? 0.25 : 0.215, hw = heavy ? 0.27 : 0.24, k = heavy ? 1.2 : 1;
    // head: a faceted helmet, a brow over the visor, a jaw with a grille, ear pods, a crest; the visor is a lit band
    // in three facets (a warden has one round eye in a socket, and a heavier jaw)
    part(plates, 'Head', side([[0.1, 1.6], [0.135, 1.64], [0.14, 1.71], [0.1, 1.775], [0, 1.81], [-0.1, 1.79], [-0.15, 1.72], [-0.15, 1.63], [-0.11, 1.565], [0.02, 1.555]], hw, 0.045), O, C.a);
    part(plates, 'Head', top([[-0.118, 0.085], [-0.07, 0.166], [0.07, 0.166], [0.118, 0.085], [0.1, 0.05], [-0.1, 0.05]], 0.034, 0.008), [0, 1.74, 0], C.b, [0.14, 0, 0]);
    part(plates, 'Head', top([[-0.102, 0.06], [-0.052, 0.158], [0.052, 0.158], [0.102, 0.06], [0.085, 0.02], [-0.085, 0.02]], heavy ? 0.1 : 0.07, 0.012), [0, heavy ? 1.59 : 1.6, 0], C.b);
    part(plates, 'Head', RBx(0.07, 0.022, 0.01), [0, 1.6, 0.16], C.d);
    for (const s of [-1, 1]) part(plates, 'Head', new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8).rotateZ(HP), [s * (hw / 2 + 0.008), 1.67, -0.02], C.d);
    part(plates, 'Head', side([[0.1, 1.775], [0.03, 1.842], [-0.1, 1.836], [-0.135, 1.765]], 0.045, 0.012), O, C.c);
    if (heavy) {
      part(plates, 'Head', new THREE.CylinderGeometry(0.064, 0.064, 0.05, 10).rotateX(HP), [0, 1.678, 0.128], C.d);
      part(lights, 'Head', new THREE.CylinderGeometry(0.042, 0.042, 0.02, 12).rotateX(HP), [0, 1.678, 0.148], 0xffffff);
    } else {
      part(lights, 'Head', top([[-0.108, 0.098], [-0.06, 0.153], [0.06, 0.153], [0.108, 0.098], [0.09, 0.08], [-0.09, 0.08]], 0.048, 0), [0, 1.68, 0], 0xffffff);
      part(plates, 'Head', RBx(0.012, 0.2, 0.012), [0.1, 1.88, -0.07], C.d);
    }
    part(plates, 'Neck', new THREE.CylinderGeometry(0.07, 0.09, 0.1, 8), [0, 1.5, 0], C.d);
    // torso: a chest that tapers to the waist, two breast plates, a sternum ridge with the core light, a collar ring,
    // three abdomen rings, a pelvis with hip plates
    part(plates, 'Chest', front([[-W, 1.47], [W, 1.47], [W + 0.01, 1.38], [0.165, 1.2], [-0.165, 1.2], [-W - 0.01, 1.38]], 0.32, 0.04), [0, 0, 0.005], C.a);
    for (const s of [-1, 1]) part(plates, 'Chest', front(mx([[-0.09, 0.08], [0.075, 0.075], [0.095, 0.01], [0.01, -0.1], [-0.09, -0.07]], s * W / 0.215), 0.05, 0.015), [s * 0.105 * W / 0.215, 1.37, 0.172], C.b, [-0.1, s * 0.18, 0]);
    part(plates, 'Chest', side([[0.15, 1.455], [0.205, 1.43], [0.218, 1.33], [0.19, 1.235], [0.15, 1.235]], 0.04, 0.01), O, C.d);
    part(lights, 'Chest', RBx(0.028, 0.05, 0.012), [0, 1.37, 0.215], 0xffffff, [-0.12, 0, 0]);
    part(plates, 'Chest', ring(heavy ? [[0.105, 1.455], [0.15, 1.475], [0.15, 1.555], [0.128, 1.58], [0.1, 1.55]] : [[0.1, 1.455], [0.135, 1.47], [0.13, 1.512], [0.108, 1.528], [0.088, 1.5]]).scale(1.25, 1, 1.05), O, C.b);
    for (const [i, y] of [1.03, 1.09, 1.15].entries()) { const r = 0.168 + i * 0.007; part(plates, 'Spine', ring([[r - 0.024, y], [r, y + 0.01], [r, y + 0.034], [r - 0.024, y + 0.044]]).scale(1, 1, 0.97), O, C.b); }
    part(plates, 'Hips', front([[-0.17, 1.0], [0.17, 1.0], [0.18, 0.93], [0.07, 0.85], [-0.07, 0.85], [-0.18, 0.93]], 0.32, 0.03), O, C.a);
    for (const s of [-1, 1]) part(plates, 'Hips', front(mx([[-0.02, 0.1], [0.025, 0.1], [0.04, -0.02], [0.02, -0.12], [-0.015, -0.1]], s), 0.24, 0.012), [s * 0.185, 0.9, 0], C.b, [0, 0, s * 0.1]);
    part(plates, 'Hips', side([[0.135, 0.995], [0.18, 0.975], [0.186, 0.91], [0.15, 0.85], [0.125, 0.86]], 0.11, 0.015), O, C.b);
    // the pack: a power unit with two canisters and lit vents; cables run from it to the helmet (a warden has two
    // exhaust stacks with hot tips instead of the antenna)
    part(plates, 'Chest', side([[-0.14, 1.47], [-0.265, 1.455], [-0.3, 1.39], [-0.3, 1.2], [-0.255, 1.13], [-0.14, 1.15]], 0.3, 0.03), O, C.b);
    for (const s of [-1, 1]) {
      part(plates, 'Chest', new THREE.CylinderGeometry(0.045, 0.045, 0.27, 8), [s * 0.1, 1.31, -0.315], C.d);
      part(plates, 'Chest', new THREE.CylinderGeometry(0.026, 0.045, 0.03, 8, 1, true), [s * 0.1, 1.46, -0.315], C.c);
      part(plates, 'Chest', new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.1, 1.47, -0.23), new THREE.Vector3(s * 0.14, 1.575, -0.235), new THREE.Vector3(s * 0.1, 1.645, -0.125)]), 5, 0.013, 4, false), O, C.d);
      if (heavy) {
        part(plates, 'Chest', new THREE.CylinderGeometry(0.03, 0.036, 0.34, 6), [s * 0.19, 1.6, -0.23], C.d);
        part(lights, 'Chest', new THREE.CylinderGeometry(0.022, 0.022, 0.012, 6), [s * 0.19, 1.772, -0.23], 0xffffff);
      }
    }
    for (const y of [1.2, 1.235, 1.27]) part(lights, 'Chest', RBx(0.09, 0.014, 0.012), [0, y, -0.304], 0xffffff);
    part(plates, 'Chest', RBx(0.26, 0.03, 0.13), [0, 1.485, -0.215], C.a);
    // arms and legs, both sides: a rimmed pauldron, tapered upper arm, elbow, gauntlet with a blade, a hand with three
    // fingers and a thumb; a tapered thigh and its plate, a pointed knee, a greave with a calf, a foot with a toe cap
    // and a heel; a light at each elbow and knee
    for (const [sd, x] of [['Left', 1], ['Right', -1]]) {
      part(plates, `${sd}Arm`, front(mx([[-0.085, -0.01], [-0.07, 0.075], [0.03, 0.1], [0.11, 0.06], [0.14, -0.04], [0.105, -0.065], [0, -0.03]], x), 0.25, 0.025).scale(k, k, k), [x * 0.25, 1.44, 0], C.b);
      part(plates, `${sd}Arm`, RBx(0.056, 0.022, 0.256 * k), [x * (0.25 + 0.126 * k), 1.44 - 0.056 * k, 0], C.c, [0, 0, x * 0.62]);
      part(plates, `${sd}Arm`, limb(0.068, 0.056, 0.17, x), [x * 0.365, 1.4, 0], C.a);
      part(plates, `${sd}ForeArm`, new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8).rotateX(HP), [x * 0.47, 1.4, 0], C.d);
      part(lights, `${sd}ForeArm`, RBx(0.026, 0.026, 0.115), [x * 0.47, 1.4, 0], 0xffffff);
      part(plates, `${sd}ForeArm`, limb(0.058, 0.044, 0.2, x), [x * 0.6, 1.4, 0], C.b);
      part(plates, `${sd}ForeArm`, front(mx([[-0.075, 0], [0.06, 0], [0.08, 0.018], [-0.045, 0.04]], x), 0.05, 0.008), [x * 0.6, 1.443, 0], C.c);
      part(plates, `${sd}Hand`, RBx(0.07, 0.04, 0.085), [x * 0.77, 1.4, 0], C.d);
      part(plates, `${sd}Hand`, RBx(0.045, 0.012, 0.08), [x * 0.775, 1.424, 0], C.b);
      for (const z of [-0.03, 0, 0.03]) part(plates, `${sd}Hand`, RBx(0.055, 0.024, 0.022), [x * 0.825, 1.39, z], C.d, [0, 0, -x * 0.45]);
      part(plates, `${sd}Hand`, RBx(0.022, 0.022, 0.05), [x * 0.775, 1.386, 0.058], C.d, [0, x * 0.5, 0]);
      part(plates, `${sd}UpLeg`, front(mx([[-0.08, 0.17], [0.085, 0.17], [0.095, 0.06], [0.068, -0.17], [-0.062, -0.17], [-0.085, 0.06]], x), 0.175, 0.035).scale(k, 1, k), [x * 0.1, 0.72, 0.01], C.a);
      part(plates, `${sd}UpLeg`, front([[-0.05, 0.12], [0.05, 0.12], [0.042, -0.09], [0, -0.13], [-0.042, -0.09]], 0.03, 0.01), [x * 0.1, 0.745, 0.085 + 0.0875 * (k - 1) + 0.01], C.b);
      part(plates, `${sd}Leg`, side([[0, 0.065], [0.06, 0.045], [0.09, 0], [0.07, -0.055], [0, -0.07]], 0.115, 0.02), [x * 0.1, 0.5, 0.035], C.a);
      part(lights, `${sd}Leg`, RBx(0.085, 0.018, 0.014), [x * 0.1, 0.5, 0.127], 0xffffff);
      part(plates, `${sd}Leg`, side([[0.075, 0.44], [0.09, 0.36], [0.068, 0.14], [0.03, 0.105], [-0.05, 0.115], [-0.08, 0.3], [-0.06, 0.44]], heavy ? 0.165 : 0.125, 0.03), [x * 0.1, 0, 0], C.b);
      part(plates, `${sd}Leg`, RBx(0.03, 0.2, 0.016), [x * 0.1, 0.255, 0.082], C.c, [0.1, 0, 0]);
      part(plates, `${sd}Leg`, RBx(0.028, 0.2, 0.028), [x * 0.1, 0.27, -0.078], C.d);
      part(plates, `${sd}Foot`, side([[-0.09, 0], [0.13, 0], [0.13, 0.085], [0.07, 0.105], [0.03, 0.135], [-0.05, 0.135], [-0.1, 0.07]], heavy ? 0.155 : 0.13, 0.015), [x * 0.1, 0, 0], C.d);
      part(plates, `${sd}Toe`, side([[0.118, 0], [0.19, 0], [0.208, 0.028], [0.17, 0.074], [0.118, 0.094]], heavy ? 0.161 : 0.136, 0.015), [x * 0.1, 0, 0], C.b);
      part(plates, `${sd}Foot`, RBx(0.1, 0.05, 0.03), [x * 0.1, 0.06, -0.097], C.b, [-0.3, 0, 0]);
      if (heavy) {   // heavier legs: an outer plate on the shin and on the thigh
        part(plates, `${sd}Leg`, front(mx([[0, 0.13], [0.03, 0.105], [0.035, -0.1], [0, -0.14]], x), 0.13, 0.01), [x * 0.185, 0.3, 0], C.b);
        part(plates, `${sd}UpLeg`, front(mx([[0, 0.12], [0.03, 0.1], [0.03, -0.08], [0, -0.12]], x), 0.14, 0.01), [x * 0.205, 0.74, 0.01], C.b);
      }
    }
    if (heavy) {   // a warden carries a light bar on the left shoulder
      part(plates, 'LeftArm', side([[0.14, 0], [0.14, 0.06], [0.1, 0.085], [-0.14, 0.085], [-0.16, 0]], 0.1, 0.015), [0.3, 1.55, 0], C.a);
      part(lights, 'LeftArm', RBx(0.076, 0.036, 0.012), [0.3, 1.592, 0.142], 0xffffff);
    }
    const skin = (list, material) => { const m = new THREE.SkinnedMesh(world.geom.mergeGeometries(list, false), material); m.bind(rig.mesh.skeleton, rig.mesh.bindMatrix); m.frustumCulled = false; m.castShadow = material === armour; m.receiveShadow = true; rig.root.add(m); return m; };
    skin(plates, armour); skin(lights, visorMat[def.kind || 'grunt']);
    // the rifle lies along the right hand's own -X (the arm's axis): receiver, barrel, magazine, stock, a lit muzzle
    const gun = new THREE.Group(); B.RightHand.add(gun); gun.position.set(-0.1, -0.02, 0.02);
    const gparts = [[RBx(0.5, 0.085, 0.055, 0.01), [-0.06, 0.02, 0]], [new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8).rotateZ(Math.PI / 2), [-0.42, 0.03, 0]], [RBx(0.07, 0.16, 0.04, 0.01), [0.02, -0.08, 0]], [RBx(0.2, 0.06, 0.045, 0.01), [0.27, 0.0, 0]], [RBx(0.16, 0.03, 0.03, 0), [-0.1, 0.075, 0]]]
      .map(([g, p]) => g.translate(...p).toNonIndexed());
    const sniper = K.name === 'marksman';
    if (sniper) gparts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8).rotateZ(Math.PI / 2).translate(-0.72, 0.03, 0).toNonIndexed(), new THREE.CylinderGeometry(0.026, 0.026, 0.2, 10).rotateZ(Math.PI / 2).translate(-0.1, 0.11, 0).toNonIndexed());   // a long barrel, a scope
    const gunMesh = new THREE.Mesh(world.geom.mergeGeometries(gparts, false), plate); gunMesh.castShadow = true; gun.add(gunMesh);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), visorMat[def.kind || 'grunt']); tip.position.set(sniper ? -0.98 : -0.58, 0.03, 0); gun.add(tip);
    // the shield sentinel's kit: a curved energy shield carried in front, its emitter a lit node on the lower rim
    let shield = null, emitter = null, beam = null;
    if (K.name === 'shield') {
      shield = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.55, 16, 1, true, -0.62, 1.24).translate(0, 0, -0.9 + 0.62), shieldMat);
      shield.position.set(0, 1.12, 0); shield.rotation.y = 0; shield.renderOrder = 2; shield.userData.occlude = false; shield.castShadow = false;
      emitter = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), visorMat.shield); emitter.position.set(0, 0.42, 0.63);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), plate); frame.position.set(0, 0.36, 0.6);
      rig.root.add(shield, emitter, frame);
    }
    // the marksman's tell: a beam from the muzzle to the player that tightens before the shot
    if (sniper) { beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), beamMat.clone()); beam.visible = false; beam.frustumCulled = false; beam.userData.occlude = false; beam.userData.collide = false; world.scene.add(beam); onDispose(() => beam.removeFromParent()); }
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
      maxHp: K.hp, stun: 0, jam: 0, shield, emitter, beam, shieldHp: K.shieldHp || 0, shieldOff: 0, charge: 0, barkT: 0, lureT: 0, sparkT: 0,
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
  /** the kit's timers back to rest (a checkpoint, a revive) */
  const calm = (e) => { e.stun = 0; e.jam = 0; e.shieldOff = 0; e.shieldHp = e.K.shieldHp || 0; e.charge = 0; e.lureT = 0; if (e.beam) e.beam.visible = false; };
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
  function update(dt) {
    if (!nav) return false;
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

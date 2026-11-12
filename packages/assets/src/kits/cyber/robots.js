// Mirage original code. kit/cyber's civilian robots: buildMachines(ctx, spec). Built from the robot kit
// (robot-kit.js) like the sentinels, but nothing like them: light shells (white, pale grey), black joints under fabric
// boots, a dark glass face plate with a soft white or blue status light, no weapons; the sentinels are carbon black
// with red and amber sensors.
//   pedestrian  a compact domestic humanoid (the kit's 'home' body at 0.82 scale); standing ones shift their weight and
//               talk in pairs (heads turn, one gestures); walkers stroll a loop on borrowed motion capture (motion-clips.js:
//               the walk, played at the rate the distance walked asks for); a scared one jogs, a damaged one limps on
//               (the broken walk), cross-faded (`group.userData.gait(id, 'walk' | 'jog' | 'broken')`); some carry an
//               umbrella, only while it rains
//   courier     a robot dog with a parcel box on its back, trotting the walkers' loop
//   vendors     a humanoid upper body on a ceiling rail (the yakitori container) or a pedestal (the noodle cart)
//   sweeper     a floor scrubber: a rounded hull, two disc brushes with bristle tufts, a squeegee, a lidar puck, a
//               blue beacon, a wet-floor sign
//   totem       a signage kiosk on a mast (four notices in English, 繁中 and kana, paging), a camera, a status ring
//   broken      a pedestrian slumped against a wall, grimy, an out-of-order sticker, its status light flickering
//   queue       pedestrians in line at a drink machine to charge: the first plugged in by a lit cable, its light
//               pulsing; come close (or disturb them: group.userData.disturb(pos, r)) and they turn their heads round,
//               further than a neck should go, and stare
// Standing pedestrians now and then imitate people, a little off: a bow in servo steps, a wave on a slipping tempo, a
// probe held to the face plate like a cigarette, a forearm repaired, a pose that loops and stutters, an arm gone limp
// (robot-behaviours.js civilianAct); one of a pair sometimes copies the other half a second late.
// group.userData.sync(pos, r, hold): everyone standing within r freezes on the same frame for `hold` s, then all stare.
// Every part is an instance of one of four THREE.BatchedMesh: the shells (the kit's powder coat), the printed decals
// (the kit's decal atlas, cut out), the lights (unlit; the notices' atlas) and the umbrella canopies (translucent). Parts move by their
// instance matrices (each segment of a body posed in code), levels of detail swap the instances' geometry.
// `machineUnits(group)` (or the returned `units()`) lists every unit's batch instance ids and its body frame.
import * as THREE from 'three';
import { WET } from '@miragekit/core';
import { FONT } from './kit.js';
import { humanoid, quadruped, quadrupedDims, mergeParts, moved, part, tf, cover, drum, decal, ext, robotMaterials, decalTexture, trotLegs, legIK, COL } from './robot-kit.js';
import { motionClips, samplePose, MOTION_BONES } from './motion-clips.js';
import { civilianAct, CIV_ACTS, ACT_LEN } from './robot-behaviours.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------
// the lights' atlas: a white cell (every light) and the totem's four notices
const AT = 1024, RECT = { white: [0, 0, 32, 32] };
for (let i = 0; i < 4; i++) RECT['page' + i] = [256 * i, 288, 256, 352];
const uvOf = (k, inset = 3) => { const [x, y, w, h] = RECT[k]; return [(x + inset) / AT, 1 - (y + h - inset) / AT, (x + w - inset) / AT, 1 - (y + inset) / AT]; };
function drawAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = AT;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, AT, AT); g.fillStyle = '#fff'; g.fillRect(...RECT.white);
  const cell = (k, fn) => { const [x, y, w, h] = RECT[k]; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(w, h); g.restore(); };
  const text = (s, x, y, size, color, { weight = 800, max = 0 } = {}) => {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (max) { const m = g.measureText(s).width; if (m > max) g.font = `${weight} ${size * max / m}px ${FONT}`; }
    g.fillText(s, x, y);
  };
  const page = (i, head, headInk, draw) => cell('page' + i, (w, h) => {
    g.fillStyle = '#071219'; g.fillRect(0, 0, w, h); g.fillStyle = head; g.fillRect(0, 0, w, 54);
    text(headInk[0], w / 2, 28, 26, headInk[1], { weight: 900, max: w - 20 }); draw(w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  });
  page(0, '#7fd3ff', ['義體診所 · CLINIC 24', '#05202a'], (w) => {
    text('診療中', w / 2, 112, 62, '#ffffff', { weight: 900 }); text('OPEN', w / 2, 170, 44, '#9fe3ff', { weight: 900 });
    text('どうぞ お入りください', w / 2, 214, 22, '#cfeff2', { max: w - 24 }); text('義肢保養 ¥980 / 30分', w / 2, 256, 22, '#e8f4ff', { max: w - 24 });
    g.fillStyle = '#7fd3ff'; g.fillRect(16, 292, w - 32, 40); text('NO. 047 → 窓口 2', w / 2, 312, 24, '#04121a', { weight: 900, max: w - 40 });
  });
  page(1, '#e8f4ff', ['PLEASE QUEUE', '#0a1a24'], (w) => {
    text('請排隊', w / 2, 110, 60, '#fff', { weight: 900 }); text('順番にお並びください', w / 2, 160, 22, '#cfe6f5', { max: w - 24 });
    g.fillStyle = '#9fd4ff'; for (let k = 0; k < 3; k++) { const x = 52 + k * 58; g.beginPath(); g.arc(x, 222, 15, 0, 7); g.fill(); g.beginPath(); g.roundRect(x - 17, 242, 34, 44, 10); g.fill(); }
    g.beginPath(); g.moveTo(206, 236); g.lineTo(238, 262); g.lineTo(206, 288); g.fill(); text('NEXT  048', w / 2, 320, 26, '#9fe3ff', { weight: 900 });
  });
  page(2, '#ffd23a', ['注意 CAUTION', '#111'], (w) => {
    g.strokeStyle = '#ffd23a'; g.fillStyle = '#ffd23a'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w / 2, 76); g.lineTo(w / 2 + 62, 186); g.lineTo(w / 2 - 62, 186); g.closePath(); g.stroke(); g.beginPath(); g.arc(w / 2 + 6, 114, 9, 0, 7); g.fill();
    g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2 + 2, 126); g.lineTo(w / 2 - 10, 152); g.lineTo(w / 2 + 14, 168); g.moveTo(w / 2 - 10, 152); g.lineTo(w / 2 - 30, 170); g.stroke();
    text('小心地滑', w / 2, 224, 44, '#fff', { weight: 900 }); text('MIND THE WET FLOOR', w / 2, 266, 22, '#ffd23a', { weight: 900, max: w - 24 }); text('足元にご注意ください', w / 2, 304, 20, '#e8e8e8', { max: w - 24 });
  });
  page(3, '#9fd4ff', ['歡迎光臨', '#06141c'], (w) => {
    text('WELCOME', w / 2, 140, 46, '#fff', { weight: 900 }); text('いらっしゃいませ', w / 2, 200, 26, '#d8ecff', { max: w - 24 });
    text('雨天傘架 → 左', w / 2, 262, 22, '#9fe8ff', { max: w - 24 }); text('UMBRELLA STAND ←', w / 2, 300, 18, '#9fe8ff', { max: w - 24 });
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
/** A batch collected before it is built: geometries and instances (with a colour), then one THREE.BatchedMesh. */
class Batch {
  constructor() { this.geos = []; this.inst = []; }
  geo(g) { this.geos.push(g); return this.geos.length - 1; }
  add(geo, color = WHITE) { this.inst.push({ geo, color: color.clone() }); return this.inst.length - 1; }
  finish(material, name) {
    const v = this.geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const m = new THREE.BatchedMesh(Math.max(1, this.inst.length), Math.max(3, v), 0, material);
    const ids = this.geos.map((g) => m.addGeometry(g));
    for (const { geo, color } of this.inst) m.setColorAt(m.addInstance(ids[geo]), color);
    m.name = name; m.sortObjects = !!material.transparent; m.perObjectFrustumCulled = true; m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = false; m.userData.collide = false; m.userData.occlude = false;
    this.mesh = m;
    return m;
  }
}
const WHITE = new THREE.Color(1, 1, 1);
/** lights: parts whose uv points at the atlas's white cell */
function glowGeo(list) {
  const g = mergeParts(list), [u0, v0, u1, v1] = uvOf('white', 8), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + u1) / 2, (v0 + v1) / 2);
  return g;
}
/** the printed decals go to their own batch (a plain material with the decal atlas: the kit's shell with its decal
 *  sampler is one texture unit too many next to the batch's own textures); their uv is the atlas cell */
const noDecals = (list) => list.filter((p) => !p.decal), decalsOf = (list) => list.filter((p) => p.decal);
function decalGeo(list) {
  const g = mergeParts(list), uv = g.attributes.uv, d = g.attributes.ndD;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, d.getX(i), d.getY(i));
  return g;
}
const shellGeo = (list) => mergeParts(list.length ? list : [part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)).setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3)), 's')]);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mod = (a, n) => ((a % n) + n) % n;
const steps3 = (k) => Math.round(k * 3) / 3;   // the clock can start a hair under 0 (the motion-blur shutter)

// the home humanoid's segments, posed from the body frame (feet at the origin, +z forward): [name, parent, offset]
const SEG = [['Hips', null, [0, 0, 0]], ['Spine', 'Hips', [0, 0.13, 0]], ['Chest', 'Spine', [0, 0.17, 0]], ['Neck', 'Chest', [0, 0.21, 0]], ['Head', 'Neck', [0, 0.08, 0]],
  ['LeftArm', 'Chest', [0.19, 0.15, 0]], ['LeftForeArm', 'LeftArm', [0, -0.28, 0]], ['LeftHand', 'LeftForeArm', [0, -0.26, 0]],
  ['RightArm', 'Chest', [-0.19, 0.15, 0]], ['RightForeArm', 'RightArm', [0, -0.28, 0]], ['RightHand', 'RightForeArm', [0, -0.26, 0]],
  ['LeftUpLeg', 'Hips', [0.1, -0.03, 0]], ['LeftLeg', 'LeftUpLeg', [0, -0.42, 0]], ['LeftFoot', 'LeftLeg', [0, -0.42, 0]],
  ['RightUpLeg', 'Hips', [-0.1, -0.03, 0]], ['RightLeg', 'RightUpLeg', [0, -0.42, 0]], ['RightFoot', 'RightLeg', [0, -0.42, 0]]];
const SEG_I = Object.fromEntries(SEG.map(([n], i) => [n, i]));
// for the borrowed clips (on @miragekit/play's rig: the same bones and lengths, the arms out along +-x in its rest):
// each segment's rig offset, its track, and the quarter turn about Z between a rig arm and the body's hanging one
const RIG_OFF = SEG.map(([n, , off]) => (/(ForeArm|Hand)$/.test(n) ? [(n.startsWith('Left') ? 1 : -1) * -off[1], 0, 0] : off));
const CLIP_I = SEG.map(([n]) => MOTION_BONES.indexOf(n)), HIPS_P = MOTION_BONES.length * 4;
const ARM_R = SEG.map(([n]) => (/(Arm|Hand)$/.test(n) ? new THREE.Matrix4().makeRotationZ((n.startsWith('Left') ? 1 : -1) * Math.PI / 2) : null));
const ARM_RI = ARM_R.map((m) => m && m.clone().invert());
// a walker's gaits: [clip, weight] blends at a speed in the street (m/s); the jog's own stride is a sprinter's, so a
// scared walker's run is half walk; walk's speed is the spec's
const GAIT = { walk: [[1, 0, 0], 0], jog: [[0.45, 0.55, 0], 2.8], broken: [[0, 0, 1], 0.55] };
const CIV_SCALE = 0.82;
/** the home body's geometry per segment (shells, lights), its toes folded into its feet */
function homeSegments(lod, kit) {
  const P = humanoid('home', lod, kit);
  for (const S of ['Left', 'Right']) { P[S + 'Foot'].push(...moved(P[S + 'Toe'], new THREE.Matrix4().makeTranslation(0, -0.06, 0.13))); delete P[S + 'Toe']; }
  return SEG.map(([n]) => ({ s: noDecals((P[n] || []).filter((p) => p.slot === 's')), d: decalsOf(P[n] || []), l: (P[n] || []).filter((p) => p.slot === 'l') }));
}

/**
 * Build the machines. `spec`: { stand: [{ x, y, z, yaw, umb }], walkers: { loop: { x0, x1, z0, z1 }, speed, n, courier },
 * stall: { m (Matrix4: the container's frame) }, cart: { m }, sweeper: { a, b, y }, totem: [x, y, z, yaw], broken: [[x, y, z, yaw]],
 * queue: { slots: [[x, z, yaw]] (the first at the machine), y, socket: [x, y, z] }, detail }.
 * Returns { group, update(t), count, tris, units() }.
 */
export function buildMachines(ctx, spec) {
  const cam = ctx.camera;
  // where a body is drawn in full, where in its middle and far levels (closer in at lower detail), with hysteresis
  const det = (spec.detail ?? 1) ** 2, LN = Math.max(7, 13 * det), LF = Math.max(18, 32 * det);
  const atlas = drawAtlas();
  const S = new Batch(), G = new Batch(), U = new Batch(), D = new Batch();
  // ---- the home body: three levels, four printed IDs on the near level, an umbrella grip variant
  const geoSet = (lod, kit) => homeSegments(lod, kit).map((x) => ({ s: S.geo(shellGeo(x.s)), l: x.l.length ? G.geo(glowGeo(x.l)) : -1, d: x.d.length ? D.geo(decalGeo(x.d)) : -1 }));
  const HOME = [0, 1, 2, 3].map((k) => geoSet(0, { id: 'home' + k, grip: 0.35, grip2: 0.35 }));
  const HOME_UMB = geoSet(0, { id: 'home1', grip: 0.95, grip2: 0.35 });
  const HOME_MID = geoSet(1, { grip: 0.35 }), HOME_FAR = geoSet(2, {});
  // an umbrella in the hand's frame (the shaft up from the hand): canopy (U), ribs and shaft (S), a thin lit rim (G)
  const ribs = [], canopyPts = [[0, 0.88], [0.3, 0.84], [0.5, 0.75], [0.56, 0.7]];
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ribs.push(part(tf(new THREE.CylinderGeometry(0.004, 0.004, 0.58, 3).rotateZ(-1.37), [Math.cos(a) * 0.28, 0.79, Math.sin(a) * 0.28], [0, -a, 0]), 's', COL.joint)); }
  const gCanopy = U.geo(mergeParts([part(new THREE.LatheGeometry(canopyPts.map(([r, y]) => new THREE.Vector2(r, y)), 16), 's', [1, 1, 1])]));
  const gShaft = S.geo(mergeParts([part(tf(new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5), [0, 0.42, 0]), 's', COL.joint), part(tf(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 6), [0, -0.03, 0]), 's', COL.rubber, { r: 0.8 }), ...ribs]));
  const gRim = G.geo(glowGeo([part(new THREE.TorusGeometry(0.56, 0.005, 3, 24).rotateX(HP).translate(0, 0.7, 0), 'l', [1, 1, 1])]));

  const robots = [], m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const TR = (out, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => out.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc.setScalar(s));
  const set = (B, id, m) => B.mesh.setMatrixAt(id, m);

  // ---- a pedestrian: an instance per segment (and its lights); poseBody() sets them from joint angles
  const LIVERY = ['#e9e8e4', '#d9dcdf', '#ecebe6', '#cfd6dc', '#e4e1da', '#d3d8d6'].map((c) => new THREE.Color(c));
  const LIGHT = [[0.75, 0.9, 1.0], [0.55, 0.8, 1.0], [0.9, 0.95, 1.0], [0.45, 0.72, 1.0]];
  function body(o) {
    const n = robots.length, liv = o.livery ?? LIVERY[n % LIVERY.length], set0 = o.umb ? HOME_UMB : HOME[n % 4];
    const r = { kind: o.kind || 'pedestrian', o, lod: 0, set0, seed: hash(n + 3.7) * 100, light: o.light ?? LIGHT[n % LIGHT.length], shell: [], lights: [], decals: [] };
    for (let i = 0; i < SEG.length; i++) { r.shell.push(S.add(set0[i].s, liv)); if (set0[i].l >= 0) r.lights.push([i, G.add(set0[i].l, WHITE)]); if (set0[i].d >= 0) r.decals.push([i, D.add(set0[i].d, WHITE)]); }
    if (o.umb) { r.canopy = U.add(gCanopy, [new THREE.Color('#2b3440'), new THREE.Color('#e8e6e0'), new THREE.Color('#5a6470')][n % 3]); r.rim = G.add(gRim, new THREE.Color(0.6, 0.8, 1.0)); r.shaft = S.add(gShaft, WHITE); }
    robots.push(r);
    return r;
  }
  const W4 = SEG.map(() => new THREE.Matrix4()), R4 = new THREE.Matrix4();
  /** pose a body from B (the body frame, feet at the origin) and p: { hipY, sway, roll, yaw, pitch, spine, chest:
   *  [x, y, z], head: [x, y, z], arms: [[fwd, out, twist, elbow] x2], legs: [{ up, bend, foot } x2], legRoll } */
  function poseBody(r, B, p) {
    const h = p.head || [0, 0, 0], ch = p.chest || [0, 0, 0];
    for (let i = 0; i < SEG.length; i++) {
      const [name, parent, off] = SEG[i], W = W4[i];
      if (!parent) { W.copy(B).multiply(TR(m4, p.sway || 0, p.hipY ?? 0.92, 0, p.pitch || 0, p.yaw || 0, p.roll || 0)); }
      else {
        W.copy(W4[SEG_I[parent]]).multiply(m4.makeTranslation(off[0], off[1], off[2]));
        const side = name.startsWith('Left') ? 0 : 1, sgn = side ? -1 : 1, base = name.replace(/^(Left|Right)/, '');
        if (name === 'Spine') W.multiply(TR(m4, 0, 0, 0, p.spine || 0, -(p.yaw || 0) * 0.6, 0));
        else if (name === 'Chest') W.multiply(TR(m4, 0, 0, 0, ch[0], ch[1] - (p.yaw || 0) * 0.5, ch[2] - (p.roll || 0) * 0.6));
        else if (name === 'Head') W.multiply(TR(m4, 0, 0, 0, h[0], h[1], h[2]));
        else if (base === 'Arm') { const a = p.arms?.[side] || [0, 0, 0, 0.3]; W.multiply(R4.makeRotationZ(sgn * (0.07 + a[1]))).multiply(m4.makeRotationX(-a[0])).multiply(m5.makeRotationY(sgn * (a[2] || 0))); }
        else if (base === 'ForeArm') W.multiply(m4.makeRotationX(-(p.arms?.[side]?.[3] ?? 0.3)));
        else if (base === 'UpLeg') { const l = p.legs?.[side] || { up: 0 }; W.multiply(R4.makeRotationZ(p.legRoll || 0)).multiply(m4.makeRotationX(-l.up)); }
        else if (base === 'Leg') W.multiply(m4.makeRotationX(p.legs?.[side]?.bend || 0));
        else if (base === 'Foot') W.multiply(m4.makeRotationX(p.legs?.[side]?.foot || 0));
      }
      set(S, r.shell[i], W);
    }
    for (const [i, id] of r.lights) set(G, id, W4[i]);
    for (const [i, id] of r.decals) set(D, id, W4[i]);
    if (r.canopy !== undefined) {   // the umbrella stands up out of the right hand
      v.set(0, -0.1, 0.03).applyMatrix4(W4[SEG_I.RightHand]); const hp = v.clone();
      e.setFromRotationMatrix(B, 'YXZ');
      m4.compose(hp, q.setFromEuler(e.set(0.08, e.y, -0.1, 'YXZ')), sc.setScalar(CIV_SCALE));
      set(U, r.canopy, m4); set(G, r.rim, m4); set(S, r.shaft, m4);
    }
  }
  // the borrowed walk, jog and broken walk, blended at one phase u (0..1 of each cycle)
  const MC = motionClips().byName, WALKS = [MC.walk, MC.run, MC.brokenWalk], PA = new Float32Array(HIPS_P + 3), PB = new Float32Array(HIPS_P + 3);
  function blendPose(w, u) {
    let first = true;
    for (let i = 0; i < 3; i++) {
      if (w[i] < 0.01) continue;
      samplePose(WALKS[i], u * WALKS[i].duration, first ? PA : PB);
      if (first) { for (let j = 0; j < PA.length; j++) PA[j] *= w[i]; first = false; continue; }
      for (let b = 0; b < HIPS_P; b += 4) { const sg = PA[b] * PB[b] + PA[b + 1] * PB[b + 1] + PA[b + 2] * PB[b + 2] + PA[b + 3] * PB[b + 3] < 0 ? -w[i] : w[i]; for (let c = 0; c < 4; c++) PA[b + c] += PB[b + c] * sg; }
      for (let c = 0; c < 3; c++) PA[HIPS_P + c] += PB[HIPS_P + c] * w[i];
    }
    let ws = 0; for (let i = 0; i < 3; i++) if (w[i] >= 0.01) ws += w[i];
    for (let b = 0; b < HIPS_P; b += 4) { const l = 1 / Math.hypot(PA[b], PA[b + 1], PA[b + 2], PA[b + 3]); for (let c = 0; c < 4; c++) PA[b + c] *= l; }
    for (let c = 0; c < 3; c++) PA[HIPS_P + c] /= ws;
    return PA;
  }
  /** pose a body from B and a rig pose (samplePose's layout): the rig's T-pose arms are the body's hanging ones turned
   *  a quarter round Z, so the arm chain is worked in the rig's frame and turned back per segment. umb: the right
   *  hand up holding the umbrella */
  function poseClip(r, B, P, umb) {
    for (let i = 0; i < SEG.length; i++) {
      const [name, parent] = SEG[i], W = W4[i], o = RIG_OFF[i], b = CLIP_I[i];
      q.set(P[b * 4], P[b * 4 + 1], P[b * 4 + 2], P[b * 4 + 3]);
      if (!parent) W.copy(B).multiply(m4.compose(v.set(P[HIPS_P], P[HIPS_P + 1], P[HIPS_P + 2]), q, sc.setScalar(1)));
      else {
        // the parent's rig frame (an arm segment's own frame is its rig frame turned by ARM_R)
        W.copy(W4[SEG_I[parent]]); if (ARM_R[SEG_I[parent]]) W.multiply(ARM_RI[SEG_I[parent]]);
        W.multiply(m4.compose(v.set(o[0], o[1], o[2]), q, sc.setScalar(1)));
        if (ARM_R[i]) W.multiply(ARM_R[i]);
      }
    }
    if (umb) {   // as poseBody holds it
      const i = SEG_I.RightArm, a = [0.55, 0.05, 0.2, 1.25];
      W4[i].copy(W4[SEG_I.Chest]).multiply(m4.makeTranslation(-0.19, 0.15, 0)).multiply(R4.makeRotationZ(-(0.07 + a[1]))).multiply(m4.makeRotationX(-a[0])).multiply(m5.makeRotationY(-a[2]));
      W4[i + 1].copy(W4[i]).multiply(m4.makeTranslation(0, -0.28, 0)).multiply(R4.makeRotationX(-a[3]));
      W4[i + 2].copy(W4[i + 1]).multiply(m4.makeTranslation(0, -0.26, 0));
    }
    for (let i = 0; i < SEG.length; i++) set(S, r.shell[i], W4[i]);
    for (const [i, id] of r.lights) set(G, id, W4[i]);
    for (const [i, id] of r.decals) set(D, id, W4[i]);
    if (r.canopy !== undefined) {
      v.set(0, -0.1, 0.03).applyMatrix4(W4[SEG_I.RightHand]); const hp = v.clone();
      e.setFromRotationMatrix(B, 'YXZ');
      m4.compose(hp, q.setFromEuler(e.set(0.08, e.y, -0.1, 'YXZ')), sc.setScalar(CIV_SCALE));
      set(U, r.canopy, m4); set(G, r.rim, m4); set(S, r.shaft, m4);
    }
  }
  const setLod = (r, d) => {
    const want = d > (r.lod === 2 ? LF - 4 : LF) ? 2 : d > (r.lod >= 1 ? LN - 2 : LN) ? 1 : 0;
    if (want === r.lod) return;
    r.lod = want; const g = want === 2 ? HOME_FAR : want === 1 ? HOME_MID : r.set0;
    for (let i = 0; i < SEG.length; i++) S.mesh.setGeometryIdAt(r.shell[i], g[i].s);
    for (const [i, id] of r.lights) if (g[i].l >= 0) G.mesh.setGeometryIdAt(id, g[i].l);
    for (const [, id] of r.decals) D.mesh.setVisibleAt(id, want === 0);   // printing is for the near level only
  };
  // the status light: a slow breath, a blink now and then
  const breathe = (r, t, k = 1) => { const b = (0.75 + 0.25 * Math.sin(t * 1.3 + r.seed)) * (mod(t + r.seed, 6.3) < 0.12 ? 0.2 : 1) * k; for (const [, id] of r.lights) G.mesh.setColorAt(id, v.set(r.light[0] * 2.2 * b, r.light[1] * 2.2 * b, r.light[2] * 2.2 * b)); };
  // standing: soft knees, the weight on one foot then the other
  const stance = (hipY, shift) => { const L = [0, 1].map((k) => { const [up, bend] = legIK(0.0, 0.08 - (hipY + (k ? -shift : shift) * 0.01), 0.42, 0.42, 1); return { up, bend, foot: up - bend }; }); return L; };

  // ---- standing pedestrians: pairs and threes talk (heads turn to each other, a hand gesture), the rest look about
  const Qs = spec.queue, stand = [...(spec.stand || []), ...(Qs?.slots || []).map(([x, z, yaw], i) => ({ x, z, yaw, y: Qs.y, queue: i }))].map((p) => body({ ...p, kind: 'pedestrian' }));
  // a probe in each hand (shown while it smokes); the queue's charging cable
  const gProbe = G.geo(glowGeo([part(tf(new THREE.CylinderGeometry(0.006, 0.008, 0.11, 5), [0, -0.05, 0.06], [HP, 0, 0]), 'l', [1, 1, 1])]));
  const gCable = G.geo(glowGeo([part(tf(new THREE.CylinderGeometry(0.01, 0.01, 1, 5), [0, 0.5, 0]), 'l', [1, 1, 1])]));
  for (const r of stand) { if (r.o.queue === undefined) r.probe = G.add(gProbe, WHITE); else if (r.o.queue === 0) r.cable = G.add(gCable, WHITE); r.freezeT = r.stareT = -1; }
  stand.forEach((r) => {
    let best = null, bd = 1.7;
    for (const o of stand) { if (o === r || o.o.queue !== undefined || r.o.queue !== undefined) continue; const d = Math.hypot(o.o.x - r.o.x, o.o.z - r.o.z); if (d < bd) { bd = d; best = o; } }
    r.partner = best; r.B = TR(new THREE.Matrix4(), r.o.x, r.o.y, r.o.z, 0, r.o.yaw, 0, CIV_SCALE * (r.o.scale ?? 1));
  });
  // ---- walkers: one loop, one speed, evenly spaced (they never meet); the courier rides it too
  const Wk = spec.walkers, walkers = [];
  let courier = null;
  if (Wk && Wk.n > 0) {
    const L = Wk.loop, len = Math.abs(L.x1 - L.x0), rr = Math.abs(L.z1 - L.z0) / 2, per = 2 * len + 2 * Math.PI * rr;
    const at = (s0) => {   // position and heading at arc length s along the loop
      const s = ((s0 % per) + per) % per, dir = Math.sign(L.x1 - L.x0), sz = Math.sign(L.z1 - L.z0), zc = (L.z0 + L.z1) / 2, half = Math.PI * rr;
      if (s < len) return [L.x0 + dir * s, L.z0, Math.atan2(dir, 0)];
      if (s < len + half) { const th = (s - len) / rr; return [L.x1 + dir * rr * Math.sin(th), zc - sz * rr * Math.cos(th), Math.atan2(dir * Math.cos(th), sz * Math.sin(th))]; }
      if (s < 2 * len + half) return [L.x1 - dir * (s - len - half), L.z1, Math.atan2(-dir, 0)];
      const th = (s - 2 * len - half) / rr; return [L.x0 - dir * rr * Math.sin(th), zc + sz * rr * Math.cos(th), Math.atan2(-dir * Math.cos(th), -sz * Math.sin(th))];
    };
    Wk.at = at; Wk.per = per;
    for (let i = 0; i < Wk.n; i++) {
      if (i === Wk.courier) { courier = { s0: per * i / Wk.n }; continue; }
      walkers.push(Object.assign(body({ umb: i % 2 === 0, kind: 'walker' }), { s0: per * i / Wk.n, gait: 'walk', w: [1, 0, 0], v: Wk.speed, ds: 0, uOff: 0 }));
    }
  }
  // ---- broken units: grimy, sat against a wall, an out-of-order sticker on the chest, the light flickering
  const grime = [new THREE.Color('#8a857a'), new THREE.Color('#7f8279')];
  const gOos = D.geo(decalGeo([decal('oos', 0.09, 0.045, [0.0, 0.12, 0.134], [0, 0, 0])]));
  const broken = (spec.broken || []).map(([x, y, z, yaw], i) => {
    const r = body({ kind: 'broken', livery: grime[i % 2], light: [1.0, 0.95, 0.85] }); r.B = TR(new THREE.Matrix4(), x, y, z, 0, yaw, 0, CIV_SCALE);
    r.sticker = D.add(gOos, WHITE); return r;
  });

  // ---- the vendors: a home upper body (spine up, arms) on a ceiling rail or a pedestal
  const vendors = [];
  const vendor = (kind, frame, apron) => {
    const near = homeSegments(0, { id: 'home2', grip: 0.55, grip2: 0.55 }), mid = homeSegments(1, { grip: 0.55 });
    const upper = SEG.map(([n], i) => (['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].includes(n) ? null : i)).filter((i) => i !== null);
    const r = { kind: 'vendor', mount: kind, frame, seed: hash(vendors.length + 40) * 100, light: [0.7, 0.9, 1.0], lod: 0, shell: [], lights: [], decals: [], idx: upper, near: [], mid: [] };
    for (const i of upper) {
      const nearG = S.geo(shellGeo(near[i].s)), dl = i === SEG_I.Chest ? [...near[i].d, decal(apron, 0.1, 0.13, [0, 0.07, 0.137], [-0.12, 0, 0])] : near[i].d;
      if (dl.length) r.decals.push([i, D.add(D.geo(decalGeo(dl)), WHITE)]);
      r.near.push(nearG); r.mid.push(S.geo(shellGeo(mid[i].s)));
      r.shell.push(S.add(nearG, new THREE.Color('#e6e5e0')));
      if (near[i].l.length) r.lights.push([i, G.add(G.geo(glowGeo(near[i].l)), WHITE)]);
    }
    if (kind === 'rail') {
      r.rail = S.add(S.geo(mergeParts([part(tf(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8).rotateX(HP), [0, 0, 0]), 'm', COL.dark), ...[-1.4, 0, 1.4].map((z) => part(tf(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), [0, 0.1, z]), 's', COL.joint)).map((p) => ({ ...p, slot: 's' }))].map((p) => ({ ...p, slot: 's' })))));
      r.carriage = S.add(S.geo(mergeParts([part(tf(ext([[-0.07, -0.04], [0.07, -0.04], [0.07, 0.03], [-0.07, 0.03]], 0.22, 0.012), [0, -0.05, 0]), 's', COL.pale),
        part(tf(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8), [0, -0.38, 0]), 's', COL.joint), part(tf(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8), [0, -0.86, 0]), 's', COL.dark),
        ...drum(0.045, 0.06, 2, 'z', [0, -1.07, 0], { housing: COL.pale }), part(tf(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8).rotateX(HP), [0, -1.07, 0.07]), 's', COL.joint)])));
    } else {
      r.carriage = S.add(S.geo(mergeParts([part(new THREE.LatheGeometry([[0, 0.002], [0.24, 0.002], [0.25, 0.025], [0.2, 0.06], [0.07, 0.08], [0, 0.08]].map(([a, b]) => new THREE.Vector2(a, b)), 16), 's', COL.pale),
        part(tf(new THREE.CylinderGeometry(0.045, 0.05, 0.84, 10), [0, 0.5, 0]), 's', COL.joint), part(tf(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), [0, 0.92, 0]), 's', COL.pale)])));
    }
    vendors.push(r); return r;
  };
  if (spec.stall) vendor('rail', spec.stall.m, 'apron0');
  if (spec.cart) vendor('pedestal', spec.cart.m, 'apron1');

  // ---- the courier: a robot dog with a parcel box on its back
  let cr = null;
  const CD = quadrupedDims('courier');
  if (courier) {
    const lv = [0, 1, 2].map((lod) => { const Q = quadruped('courier', lod, { light: [0.7, 0.9, 1.0] }); return { body: S.geo(shellGeo(noDecals(Q.body.filter((p) => p.slot !== 'l')))), decal: lod ? -1 : D.geo(decalGeo(decalsOf(Q.body))), light: G.geo(glowGeo(Q.body.filter((p) => p.slot === 'l'))), upper: S.geo(shellGeo(Q.upper)), lower: S.geo(shellGeo(Q.lower)) }; });
    cr = Object.assign(courier, { kind: 'courier', lv, lod: 0, body: S.add(lv[0].body), light: G.add(lv[0].light, new THREE.Color(1.6, 1.9, 2.2)), upper: [0, 1, 2, 3].map(() => S.add(lv[0].upper)), lower: [0, 1, 2, 3].map(() => S.add(lv[0].lower)), decal: D.add(lv[0].decal), L: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  }

  // ---- the sweeper: a floor scrubber
  let sw = null;
  if (spec.sweeper) {
    const Y = [0.82, 0.83, 0.8], body = [
      part(tf(new THREE.LatheGeometry([[0, 0.06], [0.36, 0.06], [0.4, 0.09], [0.41, 0.2], [0.39, 0.28], [0.32, 0.32], [0, 0.325]].map(([a, b]) => new THREE.Vector2(a, b)), 20), [0, 0, 0], [0, 0, 0], [1, 1, 0.78]), 's', Y),
      part(tf(new THREE.TorusGeometry(0.405, 0.022, 4, 24).rotateX(HP), [0, 0.1, 0], [0, 0, 0], [1, 1, 0.78]), 's', COL.rubber, { r: 0.8 }),   // the bumper
      ...cover([[0, 0.32], [0.16, 0.322], [0.2, 0.34], [0.19, 0.4], [0.12, 0.42], [0, 0.42]], 14, COL.pale, 1, 1, [0, 0, -0.06]),   // the tank lid
      part(tf(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 12), [0.12, 0.44, 0.12]), 's', COL.joint), part(tf(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 12), [0.12, 0.47, 0.12]), 's', COL.glass, { r: 0.05 }),   // a lidar puck
      part(tf(ext([[-0.36, -0.02], [0.36, -0.02], [0.36, 0.03], [-0.36, 0.03]], 0.03, 0.01), [0, 0.05, -0.36]), 's', COL.rubber, { r: 0.8 }),   // the squeegee
      ...[-1, 1].map((s) => part(tf(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10).rotateZ(HP), [s * 0.34, 0.06, -0.36]), 's', COL.joint)),
      decal('wet', 0.12, 0.16, [0, 0.21, -0.317], [0, Math.PI, 0]), decal('homePlate', 0.2, 0.05, [0.0, 0.2, 0.318], [0, 0, 0]),
      ...[-1, 1].map((s) => decal('kiosk', 0.2, 0.055, [s * 0.408, 0.2, 0.0], [0, s * HP, 0])),
    ];
    // a disc brush: a hub, a ring of bristle tufts splayed out and down
    const brush = [part(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), 's', COL.joint), part(tf(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), [0, 0.025, 0]), 'm', COL.dark)];
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; brush.push(part(tf(new THREE.CylinderGeometry(0.008, 0.012, 0.075, 3), [Math.cos(a) * 0.115, -0.03, Math.sin(a) * 0.115], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]), 's', [0.06, 0.055, 0.05], { r: 0.9 })); }
    const lights = [part(tf(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), [-0.14, 0.46, 0.08]), 'l', [1, 1, 1]), part(tf(ext([[-0.12, -0.006], [0.12, -0.006], [0.12, 0.006], [-0.12, 0.006]], 0.004, 0.001), [0, 0.27, 0.315]), 'l', [1, 1, 1])];
    sw = { kind: 'sweeper', seed: 12.9, body: S.add(S.geo(shellGeo(noDecals(body)))), decal: D.add(D.geo(decalGeo(decalsOf(body)))), brushes: [0, 1].map(() => S.add(S.geo(shellGeo(brush)))), beacon: G.add(G.geo(glowGeo(lights)), new THREE.Color(0.6, 1.2, 3.0)), ...spec.sweeper };
  }

  // ---- the signage kiosk on a mast
  let tt = null;
  if (spec.totem) {
    const body = [
      part(new THREE.LatheGeometry([[0, 0.003], [0.24, 0.003], [0.25, 0.02], [0.22, 0.045], [0.06, 0.06], [0, 0.06]].map(([a, b]) => new THREE.Vector2(a, b)), 16), 's', COL.grey),
      part(tf(new THREE.CylinderGeometry(0.045, 0.05, 1.5, 10), [0, 0.8, 0]), 'm', COL.dark),
      part(tf(ext([[-0.27, -0.36], [0.27, -0.36], [0.27, 0.36], [-0.27, 0.36]], 0.09, 0.025), [0, 1.86, -0.03]), 's', COL.pale),
      part(tf(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10).rotateX(HP), [0, 2.27, 0.03]), 's', COL.joint), part(tf(new THREE.SphereGeometry(0.03, 8, 5, 0, TAU, 0, HP).rotateX(HP), [0, 2.27, 0.05]), 's', COL.glass, { r: 0.04 }),
      decal('kiosk', 0.36, 0.08, [0, 1.86, -0.0765], [0, Math.PI, 0]), decal('homePlate', 0.12, 0.03, [0, 0.4, 0.052], [0, 0, 0]),
    ];
    const ring = [part(tf(new THREE.TorusGeometry(0.052, 0.006, 4, 16).rotateX(HP), [0, 1.08, 0]), 'l', [1, 1, 1])];
    const pages = [0, 1, 2, 3].map((i) => {   // the notices: a screen with its own uv into the atlas
      const g = new THREE.PlaneGeometry(0.48, 0.66).toNonIndexed(), r = uvOf('page' + i), uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, r[0] + uv.getX(k) * (r[2] - r[0]), r[1] + uv.getY(k) * (r[3] - r[1]));
      const keep = uv.array.slice(), out = mergeParts([part(g, 'l', [1, 1, 1])]); out.attributes.uv.array.set(keep); out.translate(0, 1.86, 0.016); return G.geo(out);
    });
    tt = { kind: 'totem', pages, page: 0, body: S.add(S.geo(shellGeo(noDecals(body)))), decal: D.add(D.geo(decalGeo(decalsOf(body)))), ring: G.add(G.geo(glowGeo(ring)), new THREE.Color(0.7, 1.4, 2.6)), screen: G.add(pages[0], new THREE.Color(1.4, 1.4, 1.4)), B: TR(new THREE.Matrix4(), ...spec.totem.slice(0, 3), 0, spec.totem[3], 0) };
  }

  // ---- the batches
  const shell = robotMaterials(ctx, { key: 'civ', decals: false, wear: 0.12 }).shell;
  const lights = ctx.mat.patch(new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true }), { output: 'outgoingLight *= max(uLampGain, 0.35);' });
  const canopy = ctx.mat.std({ vertexColors: true, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false });
  const group = new THREE.Group(); group.name = 'machines';
  const printed = ctx.mat.std({ map: decalTexture(), alphaTest: 0.5, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  group.add(S.finish(shell, 'machines-shell'), G.finish(lights, 'machines-lights'), D.finish(printed, 'machines-decals'));
  if (U.inst.length) group.add(U.finish(canopy, 'machines-umbrellas'));

  // ---- the acts: each standing unit's own schedule from the clock (none half the time); one of a pair copies the
  // other's act half a second late, some of the time
  const actOf = (r, t) => {
    if (r.force && t >= r.force.t0 && t - r.force.t0 < ACT_LEN) return { name: r.force.name, u: t - r.force.t0, slot: -1 };
    const lead = r.partner && r.partner.seed > r.seed ? r.partner : null;
    if (lead) { const a = actOf(lead, t - 0.55); if (a && a.name !== 'stutter' && a.name !== 'limp' && hash(a.slot + lead.seed) > 0.3) return a; }
    const P = 10 + 7 * hash(r.seed), s = t + r.seed * 3, slot = Math.floor(s / P), u = s - slot * P, pick = hash(slot * 7.13 + r.seed);
    return u < ACT_LEN && pick > 0.5 ? { name: CIV_ACTS[Math.floor((pick - 0.5) * 2 * CIV_ACTS.length)], u, slot } : null;
  };
  const qv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // ---- the poses
  const camPos = new THREE.Vector3(), B = new THREE.Matrix4(), Bv = new THREE.Matrix4();
  let lastT = Infinity, raining = null;
  const update = (t) => {
    // a jump of the view (play.place sets the scene clock back to 0): the LODs are chosen afresh
    if (t < lastT - 0.25) {
      for (const r of [...robots, ...vendors, ...(cr ? [cr] : [])]) r.lod = -1;
      for (const r of walkers) Object.assign(r, { gait: 'walk', w: [1, 0, 0], v: Wk.speed, ds: 0, uOff: 0 });   // where the clock says, walking
      for (const r of stand) { r.freezeT = r.stareT = -1; r.force = null; }
    }
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    if (cam) camPos.setFromMatrixPosition(cam.matrixWorld);
    // umbrellas only while it rains (the day is dry)
    const wet = WET.uRain.value > 0.05;
    if (wet !== raining) { raining = wet; for (const r of robots) if (r.canopy !== undefined) { U.mesh.setVisibleAt(r.canopy, wet); G.mesh.setVisibleAt(r.rim, wet); S.mesh.setVisibleAt(r.shaft, wet); } }
    const tNow = t;
    for (const r of stand) {
      if (r.freezeT > tNow) continue;   // the network's hold: the frame it froze on stays
      const o = r.o, ph = r.seed, t0 = tNow, dc = camPos.distanceTo(v.set(o.x, o.y + 1, o.z)), a = o.queue === undefined ? actOf(r, t0) : null;
      setLod(r, dc);
      // a stutter: the clock loops a fifth of a second
      const t = a?.name === 'stutter' && a.u > 0.6 && a.u < ACT_LEN - 0.3 ? t0 - a.u + 0.6 + mod(a.u, 0.21) : t0;
      let hy = 0.5 * Math.sin(t * 0.17 + ph) + 0.22 * Math.sin(t * 0.41 + ph * 2), hp = 0.06 * Math.sin(t * 0.23 + ph), gest = 0;
      if (r.partner) {
        const rel = wrap(Math.atan2(r.partner.o.x - o.x, r.partner.o.z - o.z) - o.yaw), speaking = Math.sin(t * 0.45 + (r.seed > r.partner.seed ? 0 : Math.PI)) > 0;
        hy = Math.max(-0.9, Math.min(0.9, rel)) * 0.8 + 0.1 * Math.sin(t * 0.37 + ph); hp = speaking ? 0.04 * Math.sin(t * 2.3 + ph) : 0.08;
        gest = speaking ? 0.5 + 0.4 * Math.sin(t * 1.9 + ph) : 0;
      }
      const umb = r.canopy !== undefined && raining, w = Math.sin(t * 0.31 + ph), hipY = 0.92 - 0.035;
      const arms = [[0.05 + 0.25 * gest, 0.04 + 0.05 * gest, 0.3 * gest, 0.3 + 1.1 * gest], umb ? [0.55, 0.05, 0.2, 1.25] : [0.05 + 0.02 * Math.sin(t * 0.5 + ph), 0.04, 0, 0.32]];
      const P = { hipY, sway: 0.016 * w, roll: -0.02 * w, legRoll: 0.018 * w, yaw: 0.04 * Math.sin(t * 0.13 + ph), legs: stance(hipY, w), head: [hp, hy, 0.04 * Math.sin(t * 0.29 + ph)], arms, chest: [0.02, 0.05 * gest * Math.sin(t * 1.1 + ph), 0] };
      if (o.queue === 0) { P.arms = [arms[0], [1.35, 0.02, 0, 0.15]]; P.head = [0.3, 0, 0]; }   // plugged in: a hand on the machine
      else if (o.queue !== undefined) P.head = [0.12, (mod(t + ph, 9) < 1.2 ? 0.5 : 0) * Math.sign(Math.sin(ph)), mod(t + ph, 9) < 1.2 ? 0.25 : 0];   // a look round the one ahead
      const glow = a ? civilianAct(a.name, a.u, t, ph, P) : 0;
      // staring: disturbed (or the viewer within 3.4 m of the queue), the head swung round to the camera in three steps
      const stare = r.stareT > t0 || (o.queue !== undefined && dc < 3.4);
      if (stare && !r.staring) r.stareA = Math.max(t0, r.stareA > t0 ? r.stareA : t0);
      r.staring = stare;
      if (stare) {
        const k = steps3(Math.min(1, Math.max(0, t0 - r.stareA) * 5)), d = Math.hypot(camPos.x - o.x, camPos.z - o.z);
        const yaw = Math.max(-2.6, Math.min(2.6, wrap(Math.atan2(camPos.x - o.x, camPos.z - o.z) - o.yaw))), pitch = Math.atan2(o.y + 1.25 - camPos.y, d);
        P.head = [P.head[0] + (pitch - P.head[0]) * k, P.head[1] + (yaw - P.head[1]) * k, P.head[2] * (1 - k)];
      }
      poseBody(r, r.B, P);
      if (r.probe !== undefined) {
        if ((glow > 0) !== r.probeOn) { r.probeOn = glow > 0; G.mesh.setVisibleAt(r.probe, r.probeOn); }
        if (glow > 0) { set(G, r.probe, W4[SEG_I.RightHand]); G.mesh.setColorAt(r.probe, v.set(1.6 * glow, 0.5 * glow, 0.15 * glow)); }
      }
      if (r.cable !== undefined) {   // chest port -> the machine's socket
        const so = Qs.socket; v.set(0, 0.1, 0.13).applyMatrix4(W4[SEG_I.Chest]); qv.set(so[0], so[1], so[2]).sub(v);
        const len = qv.length(); m4.compose(v, q.setFromUnitVectors(up, qv.normalize()), sc.set(1, len, 1)); set(G, r.cable, m4);
        G.mesh.setColorAt(r.cable, v.set(0.4, 1.6, 2.4).multiplyScalar(0.6 + 0.4 * Math.sin(t * 5)));
      }
      breathe(r, t, o.queue === 0 ? 1.4 + 0.6 * Math.sin(t * 5) : 1);
    }
    if (Wk && Wk.n > 0) {
      // the walk's phase runs on the distance walked (its stance foot stays put); a jog or a limp covers the ground at
      // its own pace, the extra distance and phase kept per walker (ds, uOff) so a plain walk is where the clock says
      const sp = Wk.speed, walkCyc = MC.walk.speed * MC.walk.duration * CIV_SCALE, k = Math.min(1, dt * 2.5);
      for (const r of walkers) {
        const g = GAIT[r.gait];
        let cyc = 0;
        for (let i = 0; i < 3; i++) { r.w[i] += (g[0][i] - r.w[i]) * k; cyc += r.w[i] * WALKS[i].speed * WALKS[i].duration * CIV_SCALE; }
        r.v += ((r.gait === 'walk' ? sp : g[1]) - r.v) * k;
        r.ds += (r.v - sp) * dt; r.uOff += (r.v * dt) / cyc - (sp * dt) / walkCyc;
        const s = t * sp + r.s0 + r.ds, [x, z, yaw] = Wk.at(s), u = mod((t * sp + r.s0) / walkCyc + r.seed + r.uOff, 1);
        setLod(r, camPos.distanceTo(v.set(x, Wk.y + 1, z)));
        TR(B, x, Wk.y, z, 0, yaw, 0, CIV_SCALE);
        poseClip(r, B, blendPose(r.w, u), r.canopy !== undefined && raining && r.gait === 'walk');
        breathe(r, t);
      }
      if (cr) {   // the courier trots: its legs' cycle from the distance it covered
        const s = t * sp + cr.s0, [x, z, yaw] = Wk.at(s);
        const d = camPos.distanceTo(v.set(x, Wk.y + 0.4, z)), want = d > (cr.lod === 2 ? LF - 4 : LF) ? 2 : d > (cr.lod >= 1 ? LN - 2 : LN) ? 1 : 0;
        if (want !== cr.lod) { cr.lod = want; const g = cr.lv[want]; S.mesh.setGeometryIdAt(cr.body, g.body); G.mesh.setGeometryIdAt(cr.light, g.light); for (let i = 0; i < 4; i++) { S.mesh.setGeometryIdAt(cr.upper[i], g.upper); S.mesh.setGeometryIdAt(cr.lower[i], g.lower); } }
        const Gt = { v: 0.62, T: 1, duty: 0.55, lift: 0.05 };
        trotLegs(s / Gt.v, CD, Gt, 0, cr.L);
        TR(B, x, Wk.y + CD.stand + 0.006 * Math.cos(TAU * 2 * s / Gt.v), z, 0.02, yaw, 0);
        set(S, cr.body, B); set(G, cr.light, B); set(D, cr.decal, B); D.mesh.setVisibleAt(cr.decal, cr.lod === 0);
        [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
          m4.copy(B).multiply(m5.makeTranslation(sx * (CD.W / 2 + 0.035), 0, sz * CD.hipZ)).multiply(R4.makeRotationX(-cr.L[i][0])); set(S, cr.upper[i], m4);
          m4.multiply(m5.makeTranslation(0, -CD.thigh, 0)).multiply(R4.makeRotationX(-cr.L[i][1])); set(S, cr.lower[i], m4);
        });
      }
    }
    for (const r of broken) {
      setLod(r, camPos.distanceTo(v.setFromMatrixPosition(r.B)));
      const tw = Math.sin(t * 0.07 + r.seed) * 0.03, jerk = hash(Math.floor(t * 1.3 + r.seed)) > 0.93 ? 0.06 : 0;
      poseBody(r, r.B, { hipY: 0.12, pitch: -0.3, roll: 0.06, chest: [0.25, 0.1, 0.05], head: [0.55 + jerk, 0.3 + tw, 0.32], arms: [[0.1, 0.25, 0, 0.1], [0.65, 0.05, 0.3, 0.9]], legs: [{ up: 1.42, bend: 0.25, foot: -0.4 }, { up: 1.3, bend: 0.55, foot: -0.2 }] });
      set(D, r.sticker, W4[SEG_I.Chest]);
      const f = hash(Math.floor(t * 9 + r.seed)) > 0.35 ? (hash(Math.floor(t * 2.3) + r.seed) > 0.2 ? 1 : 0.15) : 0.05;
      for (const [, id] of r.lights) G.mesh.setColorAt(id, v.set(0.9 * f, 0.88 * f, 0.8 * f));
    }
    for (const r of vendors) {
      const cyc = r.mount === 'rail' ? 18 : 14, u = mod(t + r.seed, cyc);
      let pos = 0, arms, head = [0.25, 0, 0];
      if (r.mount === 'rail') {   // the grill (z 0.8) .. the pot (z -1.0): turning skewers, then stirring
        const w = sstep(6, 8.5, u) - sstep(14, 16.5, u); pos = 0.8 - 1.8 * w;
        const atGrill = u < 6 || u > 16.5, atPot = u > 8.5 && u < 14;
        if (atGrill) { const k = Math.sin(t * 3.2); arms = [[0.9, 0.05, 0.2, 0.5 + 0.25 * k], [0.9, 0.05, 0.2, 0.5 - 0.25 * k]]; head = [0.45, 0.1 * Math.sin(t * 0.7), 0]; }
        else if (atPot) { const a = t * 2.4; arms = [[0.25, 0.1, 0, 0.6], [0.75 + 0.12 * Math.sin(a), 0.1 + 0.1 * Math.cos(a), 0.2, 0.6]]; head = [0.35, -0.2, 0]; }
        else { arms = [[0.1, 0.1, 0, 0.6], [0.1, 0.1, 0, 0.6]]; head = [0.05, -0.6 * Math.sin((u - 6) * 0.4), 0]; }
        if (u > 3 && u < 4.6) head = [0.0, 0.0, 0.1];   // a look at the customers
        B.copy(r.frame).multiply(TR(m4, -0.3, 2.37, 0)); set(S, r.rail, B);
        B.multiply(TR(m4, 0, 0, pos, 0, HP, 0)); set(S, r.carriage, B);
        Bv.copy(B).multiply(TR(m4, 0, -1.31, 0.15, 0, 0, 0.03 * Math.sin(t * 1.1)));
      } else {   // the pedestal behind the cart: stirring the big pot, wiping the counter, a look at the customers
        B.copy(r.frame); set(S, r.carriage, B);
        const stir = u < 6, wipe = u > 7 && u < 12;
        if (stir) { const a = t * 2.2; arms = [[0.25, 0.1, 0, 0.6], [1.1 + 0.1 * Math.sin(a), 0.12 + 0.1 * Math.cos(a), 0.2, 0.3]]; head = [0.32, 0.4, 0]; }
        else if (wipe) { const k = Math.sin(t * 2.6); arms = [[0.95, 0.3 + 0.3 * k, 0.2, 0.25], [0.2, 0.1, 0, 0.5]]; head = [0.35, -0.25 + 0.2 * k, 0]; }
        else { arms = [[0.15, 0.08, 0, 0.5], [0.15, 0.08, 0, 0.5]]; head = [0.0, 0.3 * Math.sin(t * 0.5), 0]; }
        Bv.copy(B).multiply(TR(m4, 0, 0.94, 0, 0, 0.12 * Math.sin(t * 0.21 + r.seed), 0));
      }
      // the upper body: the spine's frame on the mount; the segments below it are left out
      Bv.multiply(m4.makeScale(CIV_SCALE, CIV_SCALE, CIV_SCALE));
      const d = camPos.distanceTo(v.setFromMatrixPosition(Bv)), want = d > (r.lod >= 1 ? LN - 2 : LN) ? 1 : 0;
      if (want !== r.lod) { r.lod = want; r.idx.forEach((i, k) => S.mesh.setGeometryIdAt(r.shell[k], want ? r.mid[k] : r.near[k])); }
      // the vendor's body frame: its spine joint (1.08) at Bv
      W4[SEG_I.Hips].copy(Bv).multiply(m4.makeTranslation(0, -0.13, 0));
      for (let i = 1; i < SEG.length; i++) {
        const [name, parent, off] = SEG[i];
        if (!r.idx.includes(i)) continue;
        const W = W4[i].copy(W4[SEG_I[parent]]).multiply(m4.makeTranslation(off[0], off[1], off[2])), side = name.startsWith('Left') ? 0 : 1, sgn = side ? -1 : 1, base = name.replace(/^(Left|Right)/, '');
        if (name === 'Head') W.multiply(TR(m4, 0, 0, 0, head[0], head[1], head[2]));
        else if (base === 'Arm') { const a = arms[side]; W.multiply(R4.makeRotationZ(sgn * (0.07 + a[1]))).multiply(m4.makeRotationX(-a[0])).multiply(m5.makeRotationY(sgn * a[2])); }
        else if (base === 'ForeArm') W.multiply(m4.makeRotationX(-arms[side][3]));
      }
      r.idx.forEach((i, k) => set(S, r.shell[k], W4[i]));
      for (const [i, id] of r.lights) set(G, id, W4[i]);
      for (const [i, id] of r.decals) set(D, id, W4[i]);
    }
    if (sw) {   // up and down its beat at a walking pace's third, turning on the spot at each end
      const L = Math.hypot(sw.b[0] - sw.a[0], sw.b[1] - sw.a[1]), vv = 0.3, tl = L / vv, tr = 3, cyc = 2 * (tl + tr), u = mod(t, cyc);
      const base = Math.atan2(sw.b[0] - sw.a[0], sw.b[1] - sw.a[1]);
      let f, yaw;
      if (u < tl) { f = u / tl; yaw = base; } else if (u < tl + tr) { f = 1; yaw = base + Math.PI * sstep(0, 1, (u - tl) / tr); } else if (u < 2 * tl + tr) { f = 1 - (u - tl - tr) / tl; yaw = base + Math.PI; } else { f = 0; yaw = base + Math.PI + Math.PI * sstep(0, 1, (u - 2 * tl - tr) / tr); }
      TR(B, sw.a[0] + (sw.b[0] - sw.a[0]) * f, sw.y, sw.a[1] + (sw.b[1] - sw.a[1]) * f, 0, yaw, 0);
      set(S, sw.body, B); set(G, sw.beacon, B); set(D, sw.decal, B);
      for (const k of [0, 1]) { const s = k ? 1 : -1; m4.copy(B).multiply(TR(m5, s * 0.27, 0.06, 0.24, 0, s * t * 5.5, 0)); set(S, sw.brushes[k], m4); }
      G.mesh.setColorAt(sw.beacon, v.set(0.6, 1.2, 3.0).multiplyScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 3.4))));
    }
    if (tt) {
      set(S, tt.body, tt.B); set(D, tt.decal, tt.B); set(G, tt.ring, tt.B); set(G, tt.screen, tt.B);
      const pg = mod(Math.floor(t / 5), tt.pages.length);
      if (pg !== tt.page) { tt.page = pg; G.mesh.setGeometryIdAt(tt.screen, tt.pages[pg]); }
    }
  };
  update(0);
  // where a machine is now (for scripts: close-ups, tests)
  const pos = (Bt, id) => { Bt.mesh.getMatrixAt(id, m4); return v.setFromMatrixPosition(m4).toArray().map((x) => +x.toFixed(2)); };
  group.userData.where = (kind, i = 0) => ({ sweeper: () => sw && pos(S, sw.body), courier: () => cr && pos(S, cr.body), walker: () => walkers[i] && pos(S, walkers[i].shell[SEG_I.LeftFoot]).map((x, k) => (k === 1 ? x - 0.0 : x)),
    stand: () => stand[i] && [stand[i].o.x, stand[i].o.y, stand[i].o.z], totem: () => tt && pos(S, tt.body), vendor: () => vendors[i] && pos(S, vendors[i].shell[0]), broken: () => broken[i] && pos(S, broken[i].shell[0]) })[kind]?.();
  // every unit's batch instances and body frame (for the destructible civilians: hide, swap or move them by id)
  const units = () => {
    const out = [], frame = (id) => { const m = new THREE.Matrix4(); S.mesh.getMatrixAt(id, m); return m; };
    const human = (r, i) => ({ id: `${r.kind}-${i}`, kind: r.kind, shell: r.shell.slice(), lights: [...r.lights.map(([, id]) => id), ...[r.probe, r.cable].filter((x) => x !== undefined)], decals: r.decals.map(([, id]) => id), canopy: r.canopy !== undefined ? [r.canopy, r.shaft, r.rim] : [], frame: frame(r.shell[0]) });
    stand.forEach((r, i) => out.push(human(r, i))); walkers.forEach((r, i) => out.push(human(r, i)));
    broken.forEach((r, i) => { const u = human(r, i); u.decals.push(r.sticker); out.push(u); });
    vendors.forEach((r, i) => out.push({ id: `vendor-${i}`, kind: 'vendor', shell: [...r.shell, r.carriage, ...(r.rail !== undefined ? [r.rail] : [])], lights: r.lights.map(([, id]) => id), decals: r.decals.map(([, id]) => id), canopy: [], frame: frame(r.shell[0]) }));
    if (cr) out.push({ id: 'courier-0', kind: 'courier', shell: [cr.body, ...cr.upper, ...cr.lower], lights: [cr.light], decals: [cr.decal], canopy: [], frame: frame(cr.body) });
    if (sw) out.push({ id: 'sweeper-0', kind: 'sweeper', shell: [sw.body, ...sw.brushes], lights: [sw.beacon], decals: [sw.decal], canopy: [], frame: frame(sw.body) });
    if (tt) out.push({ id: 'totem-0', kind: 'totem', shell: [tt.body], lights: [tt.ring, tt.screen], decals: [tt.decal], canopy: [], frame: frame(tt.body) });
    return out;
  };
  group.userData.units = units;
  /** a walker's gait by its unit id ('walker-2'): 'walk', 'jog' (scared), 'broken' (damaged); cross-faded */
  group.userData.gait = (id, g) => { const r = walkers[+(/^walker-(\d+)$/.exec(id)?.[1] ?? -1)]; if (r && GAIT[g]) r.gait = g; };
  const near = (pos, rad) => stand.filter((r) => Math.hypot(r.o.x - pos[0], r.o.z - pos[2]) < rad && Math.abs(r.o.y - pos[1]) < 4);
  /** everyone standing within rad of pos freezes on this frame for `hold` s, then all turn their heads to the camera */
  group.userData.sync = (pos, rad = 12, hold = 0.4) => { for (const r of near(pos, rad)) { r.freezeT = lastT + hold; r.stareT = lastT + hold + 2.2; r.stareA = lastT + hold; } };
  /** the queue near pos (a shot, a blast) turns round and stares for a while */
  group.userData.disturb = (pos, rad = 8) => { for (const r of near(pos, rad)) if (r.o.queue !== undefined && r.stareT < lastT) { r.stareT = lastT + 3; r.stareA = lastT; } };
  /** for scripts: standing unit i begins act `name` now */
  group.userData.act = (i, name) => { if (stand[i]) stand[i].force = { name, t0: lastT }; };
  group.userData.batches = { shell: S.mesh, lights: G.mesh, decals: D.mesh, canopy: U.mesh || null };
  let tris = 0; for (const b of [S, G, U, D]) for (const i of b.inst) tris += b.geos[i.geo].attributes.position.count / 3;
  return { group, update, units, count: stand.length + walkers.length + broken.length + vendors.length + (cr ? 1 : 0) + (sw ? 1 : 0) + (tt ? 1 : 0), tris: Math.round(tris) };
}
/** the civilian units of a machines group (buildMachines' group, found as scene.getObjectByName('machines')):
 *  [{ id, kind, shell: [instance ids in batches.shell], lights: [ids in batches.lights], decals: [ids in
 *  batches.decals], canopy: [canopy id (batches.canopy), shaft id (shell), rim id (lights)], frame: Matrix4 (the
 *  body's root segment now) }]; the meshes are group.userData.batches { shell, lights, decals, canopy } */
export const machineUnits = (group) => (group?.userData.units ? group.userData.units() : []);

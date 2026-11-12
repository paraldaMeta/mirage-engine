// Mirage original code. kit/cyber's robot behaviours: the poses that make a machine read as a machine, not a person.
//   behaviourClips()   clips for @miragekit/play's rig (T-pose rest, +Z forward; X pitches: + the trunk forward, - a
//                      thigh forward, + a knee's bend): 'repair' (upper body: a forearm held up and worked on, the
//                      head down over it), 'kneel' (one knee down, reaching to the ground and pulling, looped),
//                      'crawl' (prone, pulled along on the arms, the legs dragged, looped), 'rise' (up off its back
//                      with the knees and elbows bent the wrong way, the head turned round, then upright at once)
//   civilianAct(name, u, t, seed, p)  a domestic robot's imitation of people, u seconds into an act of ACT_LEN, written
//                      over buildMachines' pose parameters p: 'bow' (down in servo steps, held too long, up at once),
//                      'wave' (the hand's swing on a tempo that slips), 'smoke' (a probe to the face plate and away;
//                      returns how bright its tip is), 'repair' (a forearm across, worked on, the joint jittering),
//                      'stutter' (the head flicks; the caller loops the clock), 'limp' (an arm hangs dead, snaps back)
import * as THREE from 'three';

const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
/** a clip from key poses: T the key times; per bone [x, y, z] euler angles per key (or a position for 'Hips.position') */
function keyed(name, T, tracks, loop = true) {
  const out = Object.entries(tracks).map(([k, v]) => (k.endsWith('.position')
    ? new THREE.VectorKeyframeTrack(k, T, T.flatMap((_, i) => v[Math.min(i, v.length - 1)]))
    : new THREE.QuaternionKeyframeTrack(k + '.quaternion', T, T.flatMap((_, i) => q(...v[Math.min(i, v.length - 1)])))));
  const c = new THREE.AnimationClip(name, T[T.length - 1], out); c.userData = { loop };
  return c;
}
let clips = null;
export function behaviourClips() {
  if (clips) return clips;
  const repair = keyed('repair', [0, 1, 2], {
    Chest: [[0.12, 0, 0], [0.15, 0.05, 0], [0.12, 0, 0]], Neck: [[0.35, 0.12, 0], [0.42, 0.18, 0.06], [0.35, 0.12, 0]], Head: [[0.25, 0.1, 0], [0.3, 0.12, 0.1], [0.25, 0.1, 0]],
    LeftArm: [[0, -0.95, -0.95]], LeftForeArm: [[0, -1.55, 0]], LeftHand: [[1.2, 0, 0]],
    RightArm: [[0, 1.05, 0.85], [0, 1.12, 0.78], [0, 1.05, 0.85]], RightForeArm: [[0, 1.75, 0], [0, 1.55, 0], [0, 1.75, 0]],
  });
  // one knee on the ground, the other foot planted ahead; both hands down in front, reaching then pulling back
  const kneel = keyed('kneel', [0, 0.8, 1.6], {
    'Hips.position': [[0, 0.5, -0.05]], Hips: [[0.35, 0, 0]], Spine: [[0.3, 0, 0], [0.12, 0, 0], [0.3, 0, 0]], Chest: [[0.25, 0, 0], [0.05, 0, 0], [0.25, 0, 0]], Neck: [[0.3, 0, 0]], Head: [[0.25, 0, 0]],
    LeftUpLeg: [[-1.65, 0, 0]], LeftLeg: [[1.3, 0, 0]], LeftFoot: [[0, 0, 0]], RightUpLeg: [[-0.2, 0, 0]], RightLeg: [[1.42, 0, 0]], RightFoot: [[-0.5, 0, 0]],
    LeftArm: [[0, -1.2, -1.0], [0, -0.8, -0.7], [0, -1.2, -1.0]], LeftForeArm: [[0, -0.2, 0], [0, -1.4, 0], [0, -0.2, 0]],
    RightArm: [[0, 1.2, 1.0], [0, 0.8, 0.7], [0, 1.2, 1.0]], RightForeArm: [[0, 0.2, 0], [0, 1.4, 0], [0, 0.2, 0]],
  });
  // prone, the head up: one arm reaches ahead while the other pulls under the chest, the hips wag, the legs trail
  const crawl = keyed('crawl', [0, 0.7, 1.4], {
    'Hips.position': [[0, 0.26, -0.3]], Hips: [[1.42, 0.12, 0], [1.42, -0.12, 0], [1.42, 0.12, 0]], Spine: [[-0.1, 0, 0]], Chest: [[-0.15, -0.08, 0], [-0.15, 0.08, 0], [-0.15, -0.08, 0]],
    Neck: [[-0.7, 0, 0]], Head: [[-0.35, 0, 0]],
    LeftUpLeg: [[0.05, 0, 0.15], [0.15, 0, 0.1], [0.05, 0, 0.15]], LeftLeg: [[0.2, 0, 0], [0.45, 0, 0], [0.2, 0, 0]], RightUpLeg: [[0.15, 0, -0.1], [0.05, 0, -0.15], [0.15, 0, -0.1]], RightLeg: [[0.45, 0, 0], [0.2, 0, 0], [0.45, 0, 0]],
    LeftArm: [[0, -0.4, 1.0], [0, -1.3, -0.3], [0, -0.4, 1.0]], LeftForeArm: [[0, -0.3, 0], [0, -1.4, 0], [0, -0.3, 0]],
    RightArm: [[0, 1.3, 0.3], [0, 0.4, -1.0], [0, 1.3, 0.3]], RightForeArm: [[0, 1.4, 0], [0, 0.3, 0], [0, 1.4, 0]],
  });
  // up off its back the wrong way: the elbows push backwards, the knees fold forwards (bird legs), the head turned
  // round to look behind it; upright, the head snaps back last
  const T = [0, 0.5, 1.1, 1.8, 2.25, 2.4, 2.6];
  const rise = keyed('rise', T, {
    'Hips.position': [[0, 0.2, 0], [0, 0.26, 0], [0, 0.5, 0.05], [0, 0.72, 0.03], [0, 0.9, 0], [0, 0.95, 0], [0, 0.95, 0]],
    Hips: [[-1.45, 0, 0], [-1.45, 0, 0.1], [-0.9, 0, 0], [-0.3, 0, 0], [-0.05, 0, 0], [0, 0, 0], [0, 0, 0]],
    Spine: [[0, 0, 0], [0.2, 0, 0], [0.3, 0, 0], [0.25, 0, 0], [0.1, 0, 0], [0, 0, 0], [0, 0, 0]],
    Neck: [[0, 0, 0], [0.3, 0.6, 0], [0.4, 1.4, 0], [0.2, 1.4, 0], [0.1, 1.4, 0], [0, 0, 0], [0, 0, 0]],
    Head: [[0, 0, 0], [0.2, 0.6, 0.3], [0.2, 1.4, 0.4], [0, 1.4, 0.2], [0, 1.4, 0], [0, 0, 0], [0, 0, 0]],
    ...Object.fromEntries(['Left', 'Right'].flatMap((S, k) => {
      const s = k ? -1 : 1;
      return [[S + 'UpLeg', [[0, 0, s * 0.1], [0.6, 0, s * 0.15], [1.3, 0, s * 0.15], [0.9, 0, s * 0.1], [0.3, 0, 0], [0, 0, 0], [0, 0, 0]]],
        [S + 'Leg', [[0, 0, 0], [-1.2, 0, 0], [-1.6, 0, 0], [-1.2, 0, 0], [-0.3, 0, 0], [0, 0, 0], [0, 0, 0]]],
        [S + 'Arm', [[0, 0, s * -0.3], [0, s * 0.6, s * -1.2], [0, s * 0.9, s * -1.0], [0, s * 0.3, s * -1.3], [0, 0, s * -1.35], [0, 0, s * -1.3], [0, 0, s * -1.3]]],
        [S + 'ForeArm', [[0, 0, 0], [0, s * 1.2, 0], [0, s * 1.4, 0], [0, s * 0.6, 0], [0, 0, 0], [0, s * -0.25, 0], [0, s * -0.25, 0]]]];
    })),
  }, false);
  return (clips = [repair, kneel, crawl, rise]);
}

export const CIV_ACTS = ['bow', 'wave', 'smoke', 'repair', 'stutter', 'limp'];
export const ACT_LEN = 4.5;
const mix = (a, b, k) => a + (b - a) * k, mixArm = (a, b, k) => a.map((v, i) => mix(v, b[i], k));
const steps = (k, n) => Math.round(k * n) / n;   // a servo's steps, not a muscle's ease
/** write act `name` (u s in) over pose parameters p (buildMachines' poseBody form). Returns the probe tip's
 *  brightness (0: no probe in the hand) */
export function civilianAct(name, u, t, seed, p) {
  const k = Math.max(0, Math.min(1, u / 0.45, (ACT_LEN - u) / 0.45)), h = p.head || [0, 0, 0], arms = p.arms;
  if (name === 'bow') {
    const kk = u < ACT_LEN - 0.6 ? steps(Math.min(1, u / 1.4), 4) : Math.max(0, 1 - (u - ACT_LEN + 0.6) / 0.15);
    p.spine = mix(p.spine || 0, 0.6, kk); p.chest = [mix(p.chest?.[0] || 0, 0.45, kk), 0, 0]; p.head = [mix(h[0], -0.4, kk), h[1] * (1 - kk), 0];
    p.arms = arms.map((a) => mixArm(a, [0.05, -0.02, 0, 0.05], kk));
  } else if (name === 'wave') {
    const ph = steps(((t * 1.15 + 0.3 * Math.sin(t * 1.7 + seed)) % 1 + 1) % 1, 7);
    p.arms = [arms[0], mixArm(arms[1], [0.35, 2.2, 0.2, 0.65 + 0.55 * Math.sin(ph * Math.PI * 2)], k)];
    p.head = [h[0], h[1], mix(h[2], 0.28, k)];
  } else if (name === 'smoke') {
    const c = u % 3, up = c < 0.6 ? c / 0.6 : c < 1.5 ? 1 : c < 2.1 ? 1 - (c - 1.5) / 0.6 : 0;
    p.arms = [mixArm(arms[0], [0.5, 0.05, 0.5, 1.5], k), mixArm(arms[1], mixArm([0.5, 0.08, 0, 1.3], [1.3, 0.12, -0.5, 2.2], up), k)];
    if (c > 1.6 && c < 2.6) p.head = [mix(h[0], -0.28, k), h[1], h[2]];
    return k > 0.05 ? 0.6 + 1.6 * (c > 0.6 && c < 1.5 ? 1 : 0) : 0;
  } else if (name === 'repair') {
    const j = u > 1.2 && u < 3.2 ? Math.sign(Math.sin(t * 47)) : 0;
    p.arms = [mixArm(arms[0], [0.95, 0.0, 0.55, 1.55 + 0.12 * j], k), mixArm(arms[1], [0.95, 0.0, -0.55, 1.7], k)];
    p.head = [mix(h[0], 0.6, k), mix(h[1], 0.15, k), 0.06 * j * Math.sign(Math.sin(t * 31))];
  } else if (name === 'stutter') {
    p.head = [h[0], h[1], h[2] + 0.18 * k * Math.sign(Math.sin(t * 19))];
  } else if (name === 'limp') {
    const kk = u < ACT_LEN - 0.3 ? Math.min(1, u / 0.2) : 0, sw = Math.sin(u * 3.1) * Math.exp(-u * 0.5);
    p.arms = [mixArm(arms[0], [-0.1 + 0.35 * sw, -0.1, 0, 0], kk), u > ACT_LEN - 0.3 && u < ACT_LEN - 0.15 ? [arms[1][0], arms[1][1] + 0.25, arms[1][2], arms[1][3]] : arms[1]];
    p.head = [mix(h[0], 0.45, kk), h[1], mix(h[2], 0.5, kk)];
    p.chest = [p.chest?.[0] || 0, p.chest?.[1] || 0, 0.14 * kk];
  }
  return 0;
}

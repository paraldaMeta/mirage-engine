// Mirage original code. Hand-tracking gestures for the XR mode (packages/play/src/xr.js), from WebXR hand joints
// (XRHand, 25 joints, positions in metres in any one frame): pure logic, no three.js, nothing allocated per update.
// ---------------------------------------------------------------------------
// const g = createHandGesture();               // one per hand
// g.update(joints, t)  -> 'act' | 'teleport' | null   joints: 75 numbers (HAND_JOINTS order, x y z each); t: seconds
// g.pinching, g.pointing, g.aiming, g.armed    // state after the update
// g.grabbing                                    // a fist (handCurl under grabOn): holds what xr-interact.js grabs
// handCurl(joints), palmFrame(joints, out)      // the fist measure; the palm's centre and axes (the hand's grip)
// indexRay(joints, out)                         // out[0..2] the index fingertip, out[3..5] the finger's direction
//
// The gestures (thresholds in HAND_GESTURE, measured on Meta's captured hand poses in iwer: docs/xr.md):
//   pinch    thumb tip to index tip under 2 cm (released over 4 cm): a pinch from an open or relaxed hand is the
//            game's interact ('act', the controller trigger's job).
//   point    index straight and reaching out, middle and ring fingers curled: held 0.15 s it aims ('aiming'); the
//            caller draws the teleport arc along indexRay.
//   point, then pinch: curling the index onto the thumb within 0.6 s of aiming ('armed': the aim is frozen while
//            the finger moves) is 'teleport' to where the hand last pointed.
// ponytail: one hand at a time decides; no two-hand gestures, no palm-up menu, no gesture for snap turn or walking
// (with hands: teleport and walking around the room).

export const HAND_JOINTS = ['wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];
const WRIST = 0, THUMB_TIP = 4, I_PROX = 6, I_INT = 7, I_DIST = 8, I_TIP = 9, M_PROX = 11, M_TIP = 14, R_PROX = 16, R_TIP = 19, P_PROX = 21, P_TIP = 24;

/** pinchOn / pinchOff (m), pointHold / armWindow (s); straight: the index's chord over its bone lengths; reach:
 *  index tip to wrist over its knuckle to wrist; curl: the same ratio under which middle and ring count as curled. */
export const HAND_GESTURE = { pinchOn: 0.02, pinchOff: 0.04, pointHold: 0.15, armWindow: 0.6, straight: 0.9, reach: 1.5, curl: 1.15, grabOn: 0.9, grabOff: 1.02 };

const dist = (j, a, b) => Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);

/** The index finger's ray: out[0..2] its tip, out[3..5] the unit direction from its knuckle to the tip. */
export function indexRay(j, out) {
  const x = j[I_TIP * 3] - j[I_PROX * 3], y = j[I_TIP * 3 + 1] - j[I_PROX * 3 + 1], z = j[I_TIP * 3 + 2] - j[I_PROX * 3 + 2];
  const l = Math.hypot(x, y, z) || 1;
  out[0] = j[I_TIP * 3]; out[1] = j[I_TIP * 3 + 1]; out[2] = j[I_TIP * 3 + 2];
  out[3] = x / l; out[4] = y / l; out[5] = z / l;
  return out;
}

/** The measures the gestures use, for tests and tuning: { pinch (m), straight, reach, middle, ring }. */
export function handMeasures(j) {
  return {
    pinch: dist(j, THUMB_TIP, I_TIP),
    straight: dist(j, I_PROX, I_TIP) / (dist(j, I_PROX, I_INT) + dist(j, I_INT, I_DIST) + dist(j, I_DIST, I_TIP)),
    reach: dist(j, I_TIP, WRIST) / dist(j, I_PROX, WRIST),
    middle: dist(j, M_TIP, WRIST) / dist(j, M_PROX, WRIST),
    ring: dist(j, R_TIP, WRIST) / dist(j, R_PROX, WRIST),
  };
}

/** Grab (a fist): the mean over the four fingers of tip-to-wrist over knuckle-to-wrist. Meta's captured poses: fist
 *  0.74, point 1.06, finger gun 1.00, relaxed 1.9. Under grabOn (0.9) the hand grabs; it lets go over grabOff (1.02). */
export function handCurl(j) {
  return (dist(j, I_TIP, WRIST) / dist(j, I_PROX, WRIST) + dist(j, M_TIP, WRIST) / dist(j, M_PROX, WRIST)
    + dist(j, R_TIP, WRIST) / dist(j, R_PROX, WRIST) + dist(j, P_TIP, WRIST) / dist(j, P_PROX, WRIST)) / 4;
}

/** The palm's frame for holding things: out[0..2] its centre (between the wrist and the middle knuckle), out[3..5]
 *  the unit axis wrist -> middle knuckle, out[6..8] the unit axis index knuckle -> pinky knuckle made square to it. */
export function palmFrame(j, out) {
  const w = WRIST * 3, m = M_PROX * 3, a = I_PROX * 3, b = P_PROX * 3;
  out[0] = (j[w] + j[m]) / 2; out[1] = (j[w + 1] + j[m + 1]) / 2; out[2] = (j[w + 2] + j[m + 2]) / 2;
  let fx = j[m] - j[w], fy = j[m + 1] - j[w + 1], fz = j[m + 2] - j[w + 2], l = Math.hypot(fx, fy, fz) || 1;
  fx /= l; fy /= l; fz /= l;
  let sx = j[b] - j[a], sy = j[b + 1] - j[a + 1], sz = j[b + 2] - j[a + 2];
  const d = sx * fx + sy * fy + sz * fz;
  sx -= fx * d; sy -= fy * d; sz -= fz * d; l = Math.hypot(sx, sy, sz) || 1;
  out[3] = fx; out[4] = fy; out[5] = fz; out[6] = sx / l; out[7] = sy / l; out[8] = sz / l;
  return out;
}

export function createHandGesture(opts = {}) {
  const c = { ...HAND_GESTURE, ...opts };
  let since = 0, armedUntil = -1;
  const g = {
    pinching: false, pointing: false, aiming: false, armed: false, grabbing: false, event: null,
    update(j, t) {
      const curl = handCurl(j);
      g.grabbing = g.grabbing ? curl < c.grabOff : curl < c.grabOn;   // a fist holds (xr-interact.js); it fires no event
      const was = g.pinching, d = dist(j, THUMB_TIP, I_TIP);
      g.pinching = was ? d < c.pinchOff : d < c.pinchOn;
      const seg = dist(j, I_PROX, I_INT) + dist(j, I_INT, I_DIST) + dist(j, I_DIST, I_TIP);
      const pointing = !g.pinching && dist(j, I_PROX, I_TIP) > c.straight * seg
        && dist(j, I_TIP, WRIST) > c.reach * dist(j, I_PROX, WRIST)
        && dist(j, M_TIP, WRIST) < c.curl * dist(j, M_PROX, WRIST) && dist(j, R_TIP, WRIST) < c.curl * dist(j, R_PROX, WRIST);
      if (pointing) {
        if (!g.pointing) since = t;
        g.aiming = t - since >= c.pointHold;
      } else if (g.aiming) { armedUntil = t + c.armWindow; g.aiming = false; }
      g.pointing = pointing;
      g.armed = !g.aiming && t <= armedUntil;
      g.event = null;
      if (g.pinching && !was) {
        if (g.armed) { g.event = 'teleport'; armedUntil = -1; g.armed = false; } else g.event = 'act';
      }
      return g.event;
    },
    /** The hand was lost: forget the gesture. */
    reset() { g.pinching = g.pointing = g.aiming = g.armed = g.grabbing = false; g.event = null; armedUntil = -1; },
  };
  return g;
}

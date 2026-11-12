// Mirage original code. Brought in from a game built on Mirage (a click-to-move game with a high camera).
// ---------------------------------------------------------------------------
// The 2.5D camera: a perspective camera at a fixed high pitch looking down at a target, turned around it in yaw,
// zoomed in and out within limits. It follows one point the game sets each frame (the player's feet), smoothed on
// its own, so path-following jitter never reaches the view. No walls are dodged: pair it with a sprite silhouette
// (sprites.js) or the cutaway (@miragekit/world/kits/cutaway) for what stands in front.
//
//   const iso = createIsoCamera({ pitch: 52, yaw: 35, distance: 22, min: 10, max: 34 });
//   const unbind = iso.bind(canvas);            // optional input: right-drag / Q E turn, wheel zooms, two-finger
//                                               // twist and pinch; unbind() (or iso.dispose()) removes every listener
//   each frame: iso.follow(feet); iso.update(dt); iso.apply(world.camera);
//   iso.yaw -> what sprites pick their direction row with
// Yaw: radians, 0 = the camera south (+Z) of its target looking north (the follow camera's convention). Pitch:
// radians above the horizon. No three import: it writes numbers and, in apply(), a camera.
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Options (angles in degrees): pitch (52), pitchMin / pitchMax (= pitch: fixed), yaw (35), yawMin / yawMax (free),
 * distance (22), min / max (10 / 34: the zoom range, metres), fov (30), near (0.5), far (600), lookHeight (1: the
 * point looked at above the target), follow (8: 1/s, Infinity = rigid), zoomEase (10: 1/s), turnSpeed (1.8 rad/s
 * for the keys).
 */
export function createIsoCamera(opts = {}) {
  const o = { pitch: 52, yaw: 35, distance: 22, min: 10, max: 34, fov: 30, near: 0.5, far: 600, lookHeight: 1, follow: 8, zoomEase: 10, turnSpeed: 1.8, ...opts };
  const pitchMin = (o.pitchMin ?? o.pitch) * RAD, pitchMax = (o.pitchMax ?? o.pitch) * RAD;
  const yawMin = o.yawMin != null ? o.yawMin * RAD : -Infinity, yawMax = o.yawMax != null ? o.yawMax * RAD : Infinity;
  const target = [0, 0, 0], smooth = [0, 0, 0];
  let first = true;
  const keys = { left: false, right: false };
  const unbinders = new Set();

  const iso = {
    yaw: clamp(o.yaw * RAD, yawMin, yawMax),
    pitch: clamp(o.pitch * RAD, pitchMin, pitchMax),
    /** the boom now and the one it eases to (m) */
    distance: clamp(o.distance, o.min, o.max),
    want: clamp(o.distance, o.min, o.max),
    min: o.min, max: o.max, fov: o.fov, near: o.near, far: o.far, lookHeight: o.lookHeight,
    /** where the camera is and what it looks at, after update() */
    position: [0, 0, 0], look: [0, 0, 0],
    /** the point to look at (the player's feet): [x, y, z] or anything with x, y, z */
    follow(p) {
      if (Array.isArray(p) || ArrayBuffer.isView(p)) { target[0] = p[0]; target[1] = p[1]; target[2] = p[2]; } else { target[0] = p.x; target[1] = p.y; target[2] = p.z; }
      return iso;
    },
    /** jump to the target on the next update (after a teleport, a new map) */
    snap() { first = true; return iso; },
    /** turn by dYaw and tilt by dPitch radians, within the limits */
    turn(dYaw, dPitch = 0) { iso.yaw = clamp(iso.yaw + dYaw, yawMin, yawMax); iso.pitch = clamp(iso.pitch + dPitch, pitchMin, pitchMax); return iso; },
    /** multiply the wanted distance by `factor` (>1 out), within min..max */
    zoom(factor) { iso.want = clamp(iso.want * factor, iso.min, iso.max); return iso; },
    update(dt) {
      if (keys.left) iso.turn(dt * o.turnSpeed);
      if (keys.right) iso.turn(-dt * o.turnSpeed);
      iso.distance += (iso.want - iso.distance) * Math.min(1, dt * o.zoomEase);
      const k = first ? 1 : Math.min(1, dt * o.follow);
      for (let i = 0; i < 3; i++) smooth[i] += (target[i] - smooth[i]) * k;
      first = false;
      const c = Math.cos(iso.pitch), s = Math.sin(iso.pitch), d = iso.distance;
      iso.look[0] = smooth[0]; iso.look[1] = smooth[1] + iso.lookHeight; iso.look[2] = smooth[2];
      iso.position[0] = iso.look[0] + Math.sin(iso.yaw) * c * d;
      iso.position[1] = iso.look[1] + s * d;
      iso.position[2] = iso.look[2] + Math.cos(iso.yaw) * c * d;
      return iso;
    },
    /** place a THREE.PerspectiveCamera (fov, near, far, position, lookAt, matrices) */
    apply(camera) {
      if (camera.fov !== iso.fov || camera.near !== iso.near || camera.far !== iso.far) {
        camera.fov = iso.fov; camera.near = iso.near; camera.far = iso.far;
        camera.updateProjectionMatrix();
      }
      camera.position.set(iso.position[0], iso.position[1], iso.position[2]);
      camera.lookAt(iso.look[0], iso.look[1], iso.look[2]);
      camera.updateMatrixWorld();
      return camera;
    },
    /**
     * Input on `dom` (a canvas): right-drag turns (and tilts, if the pitch has a range), the wheel zooms, Q / E turn
     * (keys on `keyTarget`, default window), two fingers twist and pinch. Returns unbind().
     */
    bind(dom, { keyTarget = globalThis, keys: [kl, kr] = ['q', 'e'], dragButton = 2, drag = 0.006, wheel = 0.0012, touch = true } = {}) {
      const on = [];
      const add = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); on.push([t, type, fn, opt]); };
      let dragging = null;
      const pointers = new Map();
      let two = null;
      const pair = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; };
      add(dom, 'contextmenu', (e) => { if (dragButton === 2) e.preventDefault(); });
      add(dom, 'pointerdown', (e) => {
        if (touch && e.pointerType === 'touch') {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) two = pair();
          return;
        }
        if (e.button === dragButton) { dragging = { x: e.clientX, y: e.clientY }; dom.setPointerCapture?.(e.pointerId); }
      });
      add(dom, 'pointermove', (e) => {
        if (pointers.has(e.pointerId)) {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2 && two) {
            const now = pair();
            let da = now.a - two.a; da = Math.atan2(Math.sin(da), Math.cos(da));
            iso.turn(-da);
            if (now.d > 1 && two.d > 1) iso.zoom(two.d / now.d);
            two = now;
          }
          return;
        }
        if (!dragging) return;
        iso.turn(-(e.clientX - dragging.x) * drag, (e.clientY - dragging.y) * drag);
        dragging.x = e.clientX; dragging.y = e.clientY;
      });
      const up = (e) => {
        if (pointers.delete(e.pointerId)) { two = pointers.size === 2 ? pair() : null; return; }
        if (e.button === dragButton) dragging = null;
      };
      add(dom, 'pointerup', up); add(dom, 'pointercancel', up);
      add(dom, 'wheel', (e) => { e.preventDefault(); iso.zoom(Math.exp(e.deltaY * wheel)); }, { passive: false });
      const typing = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
      const key = (down) => (e) => {
        if (down && typing(e)) return;
        const k = (e.key || '').toLowerCase();
        if (k === kl) keys.left = down;
        if (k === kr) keys.right = down;
      };
      add(keyTarget, 'keydown', key(true)); add(keyTarget, 'keyup', key(false));
      add(keyTarget, 'blur', () => { keys.left = keys.right = false; });
      const unbind = () => {
        if (!unbinders.has(unbind)) return;
        unbinders.delete(unbind);
        for (const [t, type, fn, opt] of on) t.removeEventListener(type, fn, opt);
        keys.left = keys.right = false; dragging = null; pointers.clear(); two = null;
      };
      unbinders.add(unbind);
      return unbind;
    },
    /** remove every listener bind() added */
    dispose() { for (const u of [...unbinders]) u(); },
  };
  return iso;
}

// Mirage original code. XR quality without three.js: the device profile table (what a headset gets by default) and
// the frame-time governor that takes quality away before frames are dropped. Pure logic, Node-tested.
// ---------------------------------------------------------------------------
// const p = xrProfile();                       // from navigator.userAgent; or xrProfile('quest-2'), xrProfile(ua)
// createXR(play, { profile: 'auto' })          // applies p.framebufferScale, p.foveation, p.frameRate, p.post, p.msaa
// const gov = createXRGovernor({ hz: 90 });    // createXR(play, { budget: true }) makes one
// gov.update(cpuMs, intervalMs) -> level index (0 = full); gov.level -> { scale, ao, bloom, post }
// ---------------------------------------------------------------------------
// NOT TESTED ON HARDWARE: no headset was available. The profiles are defaults chosen from the vendors' published
// panel sizes and refresh rates and from what this engine's passes cost on a desktop GPU; they are a starting
// point to be measured on the device, not measurements.

/** Default quality per device class. post: the per-eye post chain (xr-post.js); false = the one-pass direct path
 *  with the fitted grade (xr.js). scale: XR framebuffer scale; foveation: 0..1 fixed foveation; msaa: samples of the
 *  post pipeline's scene target (the direct path uses the layer's own MSAA). tested: none of them on hardware. */
export const XR_PROFILES = {
  'quest-2': { name: 'Meta Quest 2 (Quest Browser)', match: /Quest 2|OculusBrowser/i, framebufferScale: 0.8, foveation: 1, frameRate: 72, post: false, msaa: 4, ao: false, bloom: false, hands: true, ar: false, tested: false,
    note: 'XR2 Gen 1, 1832 x 1920 per eye: the direct path only; a half-float MSAA scene target per eye is out of its budget' },
  'quest-3': { name: 'Meta Quest 3 / 3S (Quest Browser)', match: /Quest 3|Quest Pro/i, framebufferScale: 1, foveation: 1, frameRate: 72, post: false, msaa: 4, ao: false, bloom: true, hands: true, ar: true, tested: false,
    note: 'XR2 Gen 2, 2064 x 2208 per eye: direct path by default; post: true (no AO) is the thing to try first at 72 Hz with the governor on' },
  'vision-pro': { name: 'Apple Vision Pro (Safari, visionOS 2+)', match: /visionOS|Vision ?Pro|Macintosh(?!.*(Chrome|Firefox)).*Safari/i, framebufferScale: 1, foveation: 0, frameRate: 0, post: false, msaa: 4, ao: false, bloom: true, hands: true, ar: false, tested: false,
    note: 'immersive-vr only, no controllers (transient-pointer gaze and pinch, hand tracking); foveation is the system\'s own; frame rate is not settable' },
  pcvr: { name: 'PC VR (Chrome / Edge through OpenXR: SteamVR, Link, WMR)', match: /Windows NT|X11; Linux x86_64|Macintosh.*Chrome/i, framebufferScale: 1, foveation: 0, frameRate: 90, post: true, msaa: 4, ao: true, bloom: true, hands: false, ar: false, tested: false,
    note: 'a desktop GPU: the full per-eye chain at the headset\'s recommended size; hand tracking depends on the runtime' },
  default: { name: 'unknown headset', match: null, framebufferScale: 0.9, foveation: 1, frameRate: 0, post: false, msaa: 4, ao: false, bloom: true, hands: true, ar: true, tested: false, note: 'the direct path at 0.9 x the recommended size' },
};

/** The profile for a name ('quest-2' | 'quest-3' | 'vision-pro' | 'pcvr') or a user-agent string (default: this
 *  browser's). Returns { id, ...XR_PROFILES[id] }. A desktop browser with an emulator reads as 'pcvr'. visionOS Safari
 *  sends a Mac's user agent: a Safari "Mac" that offers WebXR is taken to be a Vision Pro (macOS Safari has no WebXR). */
export function xrProfile(what) {
  const ua = what ?? (typeof navigator !== 'undefined' && navigator ? navigator.userAgent || '' : '');
  if (XR_PROFILES[ua]) return { id: ua, ...XR_PROFILES[ua] };
  for (const id of ['quest-3', 'quest-2', 'vision-pro', 'pcvr']) if (XR_PROFILES[id].match.test(ua)) return { id, ...XR_PROFILES[id] };
  return { id: 'default', ...XR_PROFILES.default };
}

/** The ladder the governor walks down, cheapest loss first: resolution, then AO, then more resolution, then bloom,
 *  then (post: false) the one-pass direct path. */
export const XR_LEVELS = [
  { scale: 1, ao: true, bloom: true, post: true },
  { scale: 0.85, ao: true, bloom: true, post: true },
  { scale: 0.85, ao: false, bloom: true, post: true },
  { scale: 0.7, ao: false, bloom: true, post: true },
  { scale: 0.7, ao: false, bloom: false, post: true },
  { scale: 0.7, ao: false, bloom: false, post: false },
];

/** The ladder without the post chain (the direct path): resolution only, through WebXR's dynamic viewport scale. */
export const XR_SCALE_LEVELS = [{ scale: 1 }, { scale: 0.85 }, { scale: 0.7 }, { scale: 0.55 }];

/** Frame-time governor. A WebXR page cannot read the compositor's GPU time, so it watches two things it can see:
 *  the CPU time of its own frame callback (cpuMs) and the interval between callbacks (intervalMs: a missed vsync
 *  shows as an interval of two periods). It steps DOWN when the smoothed CPU time passes `high` x the period (before
 *  a frame is dropped) or when more than `drops` of the last `window` intervals were late (after: the GPU was the
 *  limit, which only shows that way), and steps UP after `calm` s under `low` x the period with no late frame.
 *  opts: { hz = 72, levels = XR_LEVELS, high = 0.8, low = 0.55, window = 45, drops = 3, calm = 4, hold = 1 (s after a
 *  step before the next), warm = 1 (s ignored at the start: a session's first frames compile shaders), start = 0 }. update() returns the level index; .level is the entry; .steps counts changes. */
export function createXRGovernor(opts = {}) {
  const c = { hz: 72, levels: XR_LEVELS, high: 0.8, low: 0.55, window: 45, drops: 3, calm: 4, hold: 1, warm: 1, start: 0, ...opts };
  const late = new Uint8Array(c.window);
  let k = 0, ema = 0, hold = 0, calm = 0, lateN = 0, seen = 0, warm = c.warm;
  const g = {
    index: Math.min(c.levels.length - 1, Math.max(0, c.start)), steps: 0, ema: 0, late: 0, reason: '',
    levels: c.levels,
    get level() { return c.levels[g.index]; },
    get period() { return 1000 / c.hz; },
    setRate(hz) { if (hz > 0) c.hz = hz; },
    update(cpuMs, intervalMs) {
      const period = 1000 / c.hz, dt = Math.min(0.25, Math.max(0, (intervalMs || period) / 1000));
      if (warm > 0) { warm -= dt; return g.index; }   // a session's first frames compile shaders: not the steady cost
      ema = seen ? ema + (cpuMs - ema) * 0.15 : cpuMs; seen++;
      const isLate = intervalMs > period * 1.5 ? 1 : 0;
      lateN += isLate - late[k]; late[k] = isLate; k = (k + 1) % c.window;
      g.ema = ema; g.late = lateN;
      hold = Math.max(0, hold - dt);
      const over = ema > c.high * period, dropping = lateN > c.drops;
      if ((over || dropping) && hold === 0 && g.index < c.levels.length - 1) {
        g.index++; g.steps++; g.reason = over ? 'cpu' : 'late'; hold = c.hold; calm = 0; late.fill(0); lateN = 0;
      } else if (!over && !isLate && ema < c.low * period && lateN === 0) {
        calm += dt;
        if (calm >= c.calm && hold === 0 && g.index > 0) { g.index--; g.steps++; g.reason = 'calm'; hold = c.hold; calm = 0; }
      } else calm = 0;
      return g.index;
    },
    reset() { late.fill(0); k = 0; ema = 0; hold = 0; calm = 0; lateN = 0; seen = 0; warm = c.warm; g.index = Math.min(c.levels.length - 1, Math.max(0, c.start)); g.steps = 0; g.reason = ''; },
  };
  return g;
}

/** Standing / seated height: the rig's lift (m) that puts a head measured at `headY` (m above the reference floor)
 *  at the character's eye height `eye`. 'room': the real height is kept (0). 'standing' and 'seated' calibrate. */
export function heightOffset(posture, eye, headY) {
  return posture === 'room' || !(headY > 0) ? 0 : eye - headY;
}

/** Distance (m, positive inside) from (x, z) to the nearest edge of a boundary polygon [[x, z], ...] (the
 *  bounded-floor space's boundsGeometry); -distance outside; Infinity for fewer than 3 points. */
export function boundsDistance(poly, x, z) {
  const n = poly ? poly.length : 0;
  if (n < 3) return Infinity;
  let d = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
    const ex = bx - ax, ez = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside ? d : -d;
}

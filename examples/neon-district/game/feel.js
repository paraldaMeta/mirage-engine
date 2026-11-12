// What the body feels: rumble on a gamepad (the Gamepad API's vibrationActuator.playEffect('dual-rumble')), a buzz on a
// phone (navigator.vibrate, throttled for automatic fire), the heartbeat and the colour going out of the world when
// nearly dead, a landing thump, and a hit-stop of a few hundredths of a second on a kill (the robots and the view
// model hold still; the options turn it off). The options' strengths apply: opts.vibrate (0-1), opts.hitStop.
// Nothing here can be felt in a headless browser: the calls are made and counted (stats), not verified on hardware.
//
// Comfort (NOTES.md "Comfort"): one setting, three presets, that set together everything that moves or flashes the
// view without the player asking for it. The individual values stay settings of their own (a preset writes them;
// changing one after makes the preset 'custom'):
//   shake    0..1.5  screen shake (shots, hits, explosions, landings) and the view's flinch when hit
//   bob      0..1.5  the walk's head bob (vertical; its sideways roll goes with `roll`) and the landing dip
//   punch    0..1    the field-of-view punch a shot gives (degrees per shot = the gun's x punch; at 0.25 at most 1)
//   roll     0..1    the camera's roll from recoil, the walk and the shake (the lean's tilt is the player's: it stays)
//   kick     0.4..1  the camera's share of the recoil climb (the rest goes to the gun model and the crosshair)
//   settle   1..2.5  how fast the shake, the flinch and the dip die away (2 = twice as fast as the old feel)
//   hitStop  bool    the robots freeze for 55 ms on a kill
//   blur     0..1    factor on the quality level's motion blur
//   flashes  0.2..1  lightning, sparks, flickering signs, the dash / overdrive screen flash: below 1 they are smooth
//                    (no per-tick random flicker) and dimmer; 1 is the old raw flicker
// (The dash has no field-of-view warp or speed lines in any preset: a 0.2 s move and a faint tint.)
// 'intense' is the feel as it was before the comfort pass, 'comfort' the default; prefers-reduced-motion picks
// 'comfort' with the flashes down to 0.3.
export const COMFORT = {
  comfort: { shake: 0.45, bob: 0.35, punch: 0.25, roll: 0, kick: 0.6, settle: 2, hitStop: false, blur: 0, flashes: 0.6 },
  standard: { shake: 0.75, bob: 0.7, punch: 0.6, roll: 0.5, kick: 0.85, settle: 1.4, hitStop: true, blur: 0.5, flashes: 0.8 },
  intense: { shake: 1, bob: 1, punch: 1, roll: 1, kick: 1, settle: 1, hitStop: true, blur: 1, flashes: 1 },
};
export const COMFORT_KEYS = ['shake', 'bob', 'punch', 'roll', 'kick', 'settle', 'hitStop', 'blur', 'flashes'];
/** the sliders' ranges, for the options panel: [key, min, max, step] (hitStop is a toggle) */
export const COMFORT_RANGES = [['shake', 0, 1.5, 0.05], ['bob', 0, 1.5, 0.05], ['punch', 0, 1, 0.05], ['roll', 0, 1, 0.05], ['kick', 0.4, 1, 0.05], ['settle', 1, 2.5, 0.1], ['blur', 0, 1, 0.05], ['flashes', 0.2, 1, 0.05]];
const num = (v, lo, hi, d) => { const x = typeof v === 'string' && v.trim() !== '' ? +v : v; return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const bool = (v, d) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : d);
/** the comfort values of a preset name ('comfort' for anything unknown), reduced motion turning the flashes down */
export function comfortPreset(name, reduced = false) {
  const p = { ...(COMFORT[name] || COMFORT.comfort) };
  if (reduced) p.flashes = Math.min(p.flashes, 0.3);
  return p;
}
/** settings as kept (any shape: an old save, a hand-edited one, ?sens=abc) -> values the game can use. Settings
 *  older than version 2 (before the comfort pass) keep the player's look and touch choices; the feel and the field
 *  of view go to the new defaults. */
export function cleanOptions(kept, { reduced = false, touch = false } = {}) {
  const k = kept && typeof kept === 'object' ? kept : {}, old = !(k.v >= 2);
  const fov0 = touch ? 62 : 75;   // vertical degrees: 75 is 107.5 horizontal at 16:9 (a phone held sideways, about 2.1:1, gets 105 from 62)
  const o = {
    v: 2, sens: num(k.sens, 0.1, 5, 1), invert: bool(k.invert, false), fov: old ? fov0 : num(k.fov, 50, 90, fov0),
    tSens: num(k.tSens, 0.1, 5, 1), tOpacity: num(k.tOpacity, 0.1, 1, 0.7), tScale: num(k.tScale, 0.6, 1.5, 1), leftFire: bool(k.leftFire, true), sprintLock: bool(k.sprintLock, true),
    vibrate: num(k.vibrate, 0, 1, 1), unlocked: bool(k.unlocked, false), comfort: old || !(k.comfort in COMFORT || k.comfort === 'custom') ? 'comfort' : k.comfort,
  };
  if (k.pops !== undefined) o.pops = bool(k.pops, true);
  const base = comfortPreset(o.comfort === 'custom' ? 'comfort' : o.comfort, reduced);
  for (const [key, lo, hi] of COMFORT_RANGES) o[key] = old || o.comfort !== 'custom' ? base[key] : num(k[key], lo, hi, base[key]);
  o.hitStop = old || o.comfort !== 'custom' ? base.hitStop : bool(k.hitStop, base.hitStop);
  for (const key of Object.keys(k)) if (!(key in o)) o[key] = k[key];   // whatever else the other parts keep there
  return o;
}

export function createFeel({ opts, input, sfx, canvas, game }) {
  const stats = { rumbles: 0, buzzes: 0, beats: 0, stops: 0, lands: 0 };
  let lastRumble = 0, lastBuzz = 0, beatT = 0, stopT = 0, sat = 1;
  const vib = () => Math.max(0, Math.min(1, opts.vibrate ?? 1));
  const phone = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  /** a dual rumble on the pad in use: strong / weak magnitudes 0..1, ms; `gap` throttles automatic fire */
  function rumble(strong, weak, ms, gap = 0) {
    const k = vib(), now = performance.now();
    if (k <= 0 || now - lastRumble < gap) return;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [], pad = input?.pad && pads.find((p) => p.index === input.pad.index) || pads[0];
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    lastRumble = now; stats.rumbles++;
    try { const p = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) }); p?.catch?.(() => {}); } catch { /* not allowed */ }
  }
  /** a phone buzz (a number or a pattern of ms), shortened by the strength; `gap` throttles it */
  function buzz(pattern, gap = 0) {
    const k = vib(), now = performance.now();
    if (!phone || k <= 0 || now - lastBuzz < gap) return;
    lastBuzz = now; stats.buzzes++;
    const p = [].concat(pattern).map((v, i) => (i % 2 ? v : Math.max(4, Math.round(v * (0.35 + 0.65 * k)))));
    try { navigator.vibrate(p.length === 1 ? p[0] : p); } catch { /* not before a gesture */ }
  }
  return {
    stats, rumble, buzz,
    /** a round fired (arms.js haptic: strong, weak, ms, phone) */
    fire(A) { const h = A.haptic; rumble(h.strong, h.weak, h.ms, A.auto ? 70 : 0); buzz(h.phone, A.auto ? 110 : 0); },
    hurt(amount) { const k = Math.min(1, amount / 20); rumble(0.5 + 0.5 * k, 0.4, 120 + 120 * k); buzz(amount > 12 ? [60, 30, 40] : 35); },
    explosion(dist) { const k = Math.max(0, 1 - dist / 36); if (k <= 0) return; rumble(k, k * 0.8, 260 + 300 * k); buzz([Math.round(90 * k), 40, Math.round(60 * k)]); },
    empty() { rumble(0, 0.25, 40); buzz([30, 40, 30]); },
    reloaded() { rumble(0.1, 0.3, 50); buzz(15); },
    hit(k = 0.4) { rumble(k, k, 60); },
    land(v) { stats.lands++; const k = Math.min(1, v / 9); rumble(0.4 * k, 0.6 * k, 90); buzz(Math.round(30 * k)); sfx.play('nd_land', { gain: 0.35 + 0.45 * k, rate: 0.95 + Math.random() * 0.1 }); },
    /** a kill: a hit-stop (when on) and a tick of rumble */
    kill() { rumble(0.3, 0.7, 80); if (opts.hitStop !== false) { stopT = 0.055; stats.stops++; game.flags.hitStops = stats.stops; } },
    /** seconds of hit-stop left (the game freezes the robots and the view model meanwhile) */
    get stopping() { return stopT > 0; },
    /** once a step: the heartbeat and the colour, from health */
    update(dt, hp, dead) {
      stopT = Math.max(0, stopT - dt);
      // nearly dead: the heart, faster as it gets worse
      if (!dead && hp < 25) { beatT -= dt; if (beatT <= 0) { beatT = 0.55 + 0.5 * Math.max(0, hp) / 25; sfx.play('nd_heart', { gain: 0.55 + 0.4 * (1 - hp / 25) }); rumble(0.25, 0, 70); stats.beats++; } }
      else beatT = 0;
      // the colour goes out of the world below 30 (a CSS filter on the canvas: no change to the frame's own grade)
      const want = dead ? 0.25 : hp < 30 ? 0.35 + 0.65 * Math.max(0, hp) / 30 : 1;
      sat += (want - sat) * Math.min(1, dt * 4);
      const v = Math.abs(sat - 1) < 0.01 ? '' : `saturate(${sat.toFixed(2)})`;
      if (canvas && canvas.style.filter !== v) canvas.style.filter = v;
    },
  };
}

// What the body feels: rumble on a gamepad (the Gamepad API's vibrationActuator.playEffect('dual-rumble')), a buzz on a
// phone (navigator.vibrate, throttled for automatic fire), the heartbeat and the colour going out of the world when
// nearly dead, a landing thump, and a hit-stop of a few hundredths of a second on a kill (the robots and the view
// model hold still; the options turn it off). The options' strengths apply: opts.vibrate (0-1), opts.hitStop.
// Nothing here can be felt in a headless browser: the calls are made and counted (stats), not verified on hardware.
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

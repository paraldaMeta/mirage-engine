// The game's own sounds, made in code like the engine's (no files): pickups, the uplink's alarm, hurt, thunder, and
// four loops (rain, a sign's hum, a vent's hiss, the score), given to the mixer with audio.add at the first gesture.
// The guns, their mechanics, casings, impacts, the robots' rifles and the rest of the feel's sounds are layered
// syntheses in gunsound.js: rendered offline, a buffer at a time over the first second or two after the first gesture
// (about 1.3 s of work in all, in the browser's idle time between frames, the carbine first), each handed to audio.add as it is done. Until a
// gun's own buffers exist its shots fall back to `nd_shot` (the first carbine sound, kept below).
import { SOUNDS, ORDER } from './gunsound.js';
import { MELEE_SOUNDS } from './melee-sound.js';
const TAU = Math.PI * 2;

export function createSfx(audio) {
  let ready = false, started = false;
  const waiting = [], loops = [];
  // the buffer table as the old code wrote it: every write goes to the mixer through audio.add
  const B = new Proxy({}, { set: (o, k, v) => { audio.add(k, v); return true; } });
  let queue = null;
  function renderSome(budgetMs) {
    const t0 = performance.now(), ctx = audio.maker, SR = ctx.sampleRate;
    while (queue.length && performance.now() - t0 < budgetMs) {
      const job = queue.shift(), data = SOUNDS[job.name].render(SR, job.v), b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      job.list.push(b);
      audio.add(job.name, job.list.length > 1 ? job.list.slice() : job.list[0]);
    }
  }
  // one idle slice after another until the queue is empty (setTimeout where requestIdleCallback is missing)
  function idle() {
    if (!queue?.length) return;
    const go = (d) => { renderSome(Math.max(1, Math.min(8, d && d.timeRemaining ? d.timeRemaining() - 1 : 4))); idle(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 250 }); else setTimeout(go, 16);
  }
  // one buffer a step (a generator), the steps in the browser's idle time: the whole set is ~2 s of a phone's main
  // thread, which in one piece held the title (or the first frame of play) that long
  function* steps() {
    const ctx = audio.maker, SR = ctx.sampleRate;
    let seed = 0x2545f491;
    const rnd = () => ((seed = (seed ^ (seed << 13)) >>> 0, seed = (seed ^ (seed >>> 17)) >>> 0, seed = (seed ^ (seed << 5)) >>> 0) / 4294967296);
    const noise = () => rnd() * 2 - 1;
    const lp = (a) => { let y = 0; return (x) => (y += a * (x - y)); };
    const buf = (sec, fn, ch = 1) => { const b = ctx.createBuffer(ch, Math.ceil(sec * SR), SR); for (let c = 0; c < ch; c++) fn(b.getChannelData(c), c); return b; };
    const loop = (sec, fn, ch = 2, fade = 0.8) => buf(sec, (d, c) => {
      const n = d.length, f = Math.floor(fade * SR), tmp = new Float32Array(n + f);
      fn(tmp, c);
      for (let i = 0; i < n; i++) d[i] = tmp[i];
      for (let i = 0; i < f; i++) { const k = i / f; d[i] = tmp[i] * k + tmp[n + i] * (1 - k); }
    }, ch);
    const sat = (x) => Math.tanh(x);
    // the carbine: a crack, a body thump, a short metallic ring, a tail of filtered noise (four variants)
    B.nd_shot = [0, 1, 2, 3].map((v) => buf(0.42, (d) => {
      const l = lp(0.35), l2 = lp(0.06), f = 118 - v * 6;
      for (let i = 0; i < d.length; i++) {
        const t = i / SR, x = noise();
        const crack = (x - l(x)) * Math.exp(-t / 0.004) * 1.4, body = Math.sin(TAU * (f * t - 40 * t * t)) * Math.exp(-t / 0.05) * 1.1;
        const ring = Math.sin(TAU * (2310 + v * 90) * t) * Math.exp(-t / 0.03) * 0.18, tail = l2(x) * Math.exp(-t / 0.12) * 1.6;
        d[i] = sat((crack + body + ring + tail) * 1.2) * 0.75;
      }
    }));
    // a sentinel's bolt: a falling sine with a buzz, brighter and thinner than the carbine
    yield;
    B.nd_bolt = [0, 1, 2].map((v) => buf(0.3, (d) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) { const t = i / SR, f = 1500 * Math.exp(-t / 0.05) + 260 + v * 30; ph += TAU * f / SR; d[i] = sat((Math.sin(ph) + 0.5 * Math.sign(Math.sin(ph * 0.5))) * 1.5) * Math.exp(-t / 0.07) * 0.5 + noise() * Math.exp(-t / 0.006) * 0.4; }
    }));
    const click = (d, t0, f, amp, dec) => { for (let i = Math.floor(t0 * SR); i < d.length; i++) { const t = i / SR - t0; d[i] += amp * Math.exp(-t / dec) * (Math.sin(TAU * f * t) + 0.6 * noise() * Math.exp(-t / 0.003)); } };
    yield;
    B.nd_reload = buf(1.5, (d) => { click(d, 0.02, 1900, 0.35, 0.012); click(d, 0.2, 620, 0.3, 0.03); const l = lp(0.2); for (let i = Math.floor(0.45 * SR); i < 0.8 * SR; i++) d[i] += l(noise()) * 0.12 * Math.sin(Math.PI * (i / SR - 0.45) / 0.35); click(d, 0.95, 880, 0.4, 0.02); click(d, 1.22, 2600, 0.45, 0.01); click(d, 1.27, 1400, 0.35, 0.02); });
    yield;
    B.nd_dry = buf(0.12, (d) => click(d, 0, 2400, 0.3, 0.008));
    yield;
    B.nd_hit = buf(0.09, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (Math.sin(TAU * 1750 * t) + 0.5 * Math.sin(TAU * 3500 * t)) * Math.exp(-t / 0.018) * 0.4; } });
    yield;
    B.nd_kill = buf(0.4, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (Math.sin(TAU * 880 * t) * Math.exp(-t / 0.05) + Math.sin(TAU * 1320 * t) * Math.exp(-Math.max(t - 0.07, 0) / 0.09) * (t > 0.07 ? 1 : 0)) * 0.3; } });
    yield;
    B.nd_impact = [0, 1, 2].map((v) => buf(0.3, (d) => { const l = lp(0.5); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = (x - l(x)) * Math.exp(-t / 0.01) * 0.7 + Math.sin(TAU * (3100 + v * 700) * t * (1 - 0.6 * t)) * Math.exp(-t / 0.06) * 0.22; } }));
    yield;
    B.nd_hurt = buf(0.35, (d) => { const l = lp(0.04); for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = sat((Math.sin(TAU * (90 - 80 * t) * t) * 1.2 + l(noise()) * 2) * Math.exp(-t / 0.09)) * 0.7; } });
    yield;
    B.nd_ammo = buf(0.4, (d) => { click(d, 0, 1300, 0.3, 0.02); click(d, 0.09, 1900, 0.3, 0.02); click(d, 0.16, 900, 0.25, 0.04); });
    yield;
    B.nd_med = buf(0.7, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (Math.sin(TAU * (420 + 500 * t) * t) * 0.25 + Math.sin(TAU * 1260 * t) * 0.08) * Math.sin(Math.PI * Math.min(t / 0.7, 1)); } });
    yield;
    B.nd_alarm = buf(1.6, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR, u = t % 0.8; d[i] = sat(Math.sin(TAU * (520 + 260 * (u < 0.4 ? u / 0.4 : 0)) * t) * 2) * 0.22 * (u < 0.6 ? 1 : 0) * Math.min(1, (1.6 - t) * 8); } });
    yield;
    B.nd_tick = buf(0.14, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = Math.sin(TAU * 1480 * t) * Math.exp(-t / 0.03) * 0.25; } });
    yield;
    B.nd_death = buf(0.9, (d) => { let ph = 0; const l = lp(0.1); for (let i = 0; i < d.length; i++) { const t = i / SR; ph += TAU * (300 * Math.exp(-t / 0.25) + 40) / SR; d[i] = sat(Math.sin(ph) * 2 + l(noise()) * 1.5) * Math.exp(-t / 0.3) * 0.4 * (0.6 + 0.4 * Math.sign(Math.sin(t * 90))); } });
    yield;
    B.nd_thunder = buf(3.6, (d, c) => { const l = lp(0.012), l2 = lp(0.05); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = sat((l(x) * 9 + l2(x) * 1.5 * Math.exp(-t / 0.25)) * (Math.exp(-t / 1.1) + 0.35 * Math.exp(-Math.abs(t - 1.2 - c * 0.15) / 0.3))) * 0.8; } }, 2);
    // loops
    yield;
    B.nd_rain = loop(7, (d, c) => {
      const a = lp(0.5), b2 = lp(0.07), drops = Array.from({ length: 260 }, () => [rnd() * 7.6, 2000 + rnd() * 5000, 0.2 + rnd() * 0.8 * (c ? rnd() : 1)]);
      for (let i = 0; i < d.length; i++) { const x = noise(); d[i] = (a(x) - b2(x)) * 0.5; }
      for (const [t0, f, amp] of drops) for (let i = Math.floor(t0 * SR), n = Math.min(d.length, i + 0.012 * SR); i < n; i++) { const t = i / SR - t0; d[i] += amp * 0.12 * Math.sin(TAU * f * t) * Math.exp(-t / 0.003); }
    });
    yield;
    B.nd_hum = loop(4, (d) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (Math.sin(TAU * 100 * t) * 0.5 + Math.sin(TAU * 200 * t) * 0.3 + Math.sin(TAU * 300 * t) * 0.12 + Math.sin(TAU * 7900 * t) * 0.012) * (0.85 + 0.15 * Math.sin(TAU * 0.75 * t)) * 0.3; } }, 1, 0.5);
    yield;
    B.nd_steam = loop(5, (d) => { const a = lp(0.6), b2 = lp(0.2); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = (a(x) - b2(x)) * (0.55 + 0.25 * Math.sin(t * 1.7) + 0.2 * Math.sin(t * 4.1)); } }, 1, 0.6);
    // the score: a low drone in D minor, a slow filter swell, a pulse on the fifth
    yield;
    B.nd_score = loop(16, (d, c) => {
      const l = lp(0.02);
      for (let i = 0; i < d.length; i++) {
        const t = i / SR, det = c ? 1.003 : 0.997, sw = 0.5 + 0.5 * Math.sin(TAU * t / 16 - 1.2);
        let s = 0;
        for (const [f, a] of [[36.71, 0.9], [73.42, 0.7], [110, 0.35 * sw], [146.83, 0.3], [174.61, 0.22 * sw], [220, 0.12 * sw]]) s += a * Math.sin(TAU * f * det * t + 0.4 * Math.sin(TAU * f * 0.5 * t));
        const beat = (t * 1.75) % 1, pulse = Math.sin(TAU * 110 * t) * Math.exp(-beat / 0.12) * 0.35 * (Math.floor(t * 1.75) % 4 === 3 ? 0.4 : 1);
        d[i] = l(sat(s * 0.6) * 0.5 + pulse * 0.4 + noise() * 0.015) * 2.2;
      }
    });
    // close combat (melee-sound.js)
    const one = ([sec, fill]) => buf(sec, (d) => fill(d, SR, noise, lp));
    yield;
    for (const [k, v] of Object.entries(MELEE_SOUNDS)) { B[k] = Array.isArray(v[0]) ? v.map(one) : one(v); yield; }
    ready = true;
    queue = [];
    for (const name of ORDER) { const list = []; for (let v = 0; v < SOUNDS[name].n; v++) queue.push({ name, v, list }); }
    for (const fn of waiting.splice(0)) fn();
    idle();
  }
  function make() {
    const it = steps();
    const go = (d) => {
      const until = performance.now() + Math.max(4, d && d.timeRemaining ? d.timeRemaining() - 1 : 8);
      while (!it.next().done) if (performance.now() >= until) { later(go); return; }
    };
    go();
  }
  const later = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 16));
  const has = (n) => !!audio.buffers?.[n];
  return {
    /** call once a step: builds the sounds when the mixer first exists (after the first gesture), then the guns' a few ms at a time */
    // (the guns' buffers are made in the browser's idle time, not inside a step: a step's few ms were a frame's few ms)
    poll() { if (!started && audio.maker && audio.buffers) { started = true; make(); } },
    get ready() { return ready; },
    /** how many of the layered sounds are still to be made */
    get pending() { return queue ? queue.length : -1; },
    has,
    /** a name, or a list of names: the first one that exists plays */
    play(name, o) { if (!ready) return null; const n = Array.isArray(name) ? name.find(has) : name; return n ? audio.play(n, o) : null; },
    /** a loop that starts as soon as the sounds exist */
    loop(name, o) { const start = () => loops.push(audio.loop(name, o)); if (ready) start(); else waiting.push(start); },
    /** a flat loop with a handle: stop(), rate(r); null while its buffer is not made yet */
    loop2(name, o = {}) {
      if (!ready || !has(name)) return null;
      const h = audio.loop(name, { bus: 'sfx', ...o });
      return { stop() { try { h.src?.stop(); } catch { /* already stopped */ } }, rate(r) { if (h.src) h.src.playbackRate.value = r; } };
    },
  };
}

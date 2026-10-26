// Mirage original code. A Web Audio mixer (master -> music, sfx, ambience buses), sounds made in code at
// start-up (no files: footsteps per surface, pickup, lock, door creak, ignition, a chime, wind with birds, water,
// a pad), one-shots and loops placed in 3D (PannerNode, inverse distance) and a listener that follows the camera.
// ---------------------------------------------------------------------------
// const audio = createAudio({ volumes: { master: 0.9, music: 0.35 } });
// audio.unlock()                      call from a user gesture (browsers keep audio off until one); idempotent
// audio.play('pickup', { at: [x, y, z], bus: 'sfx', gain, rate })      audio.footstep('gravel', run)
// audio.loop('water', { at, bus: 'ambience', gain, ref })              a 3D loop; without `at` a flat one
// audio.listen(camera)                once per frame; audio.volume('music', 0.5); audio.volumes; audio.stats
// audio.suspend(true | false)         the device off / on again (a hidden tab)
// ponytail: PannerNode + buffers made in JS instead of three's PositionalAudio (which wraps the same nodes and
// needs the camera in the scene graph); no reverb, no occlusion; sounds are generated once (~0.2 s) on unlock.
// ---------------------------------------------------------------------------
import { sfc32, hash32 } from '@mirage/core/rng';

export const SURFACES = ['stone', 'gravel', 'grass', 'wood'];

export function createAudio({ volumes = {} } = {}) {
  const vol = { master: 0.9, music: 0.3, sfx: 0.8, ambience: 0.6, ...volumes };
  const stats = { played: {}, skipped: 0, state: 'locked', genMs: 0 };
  let ctx = null, buses = null, bufs = null;
  const pendingLoops = [], J = sfc32(hash32('mirage/audio/jitter'));   // variant and pitch jitter
  const a = {
    get ctx() { return ctx; }, stats, get volumes() { return { ...vol }; },
    unlock() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const master = ctx.createGain(); master.connect(ctx.destination);
      buses = { master };
      for (const b of ['music', 'sfx', 'ambience']) { buses[b] = ctx.createGain(); buses[b].connect(master); }
      for (const [k, v] of Object.entries(vol)) a.volume(k, v);
      const t0 = performance.now();
      bufs = makeSounds(ctx);
      stats.genMs = +(performance.now() - t0).toFixed(1);
      const resumed = () => { stats.state = ctx.state; };
      ctx.onstatechange = resumed; resumed();
      if (ctx.state === 'suspended') ctx.resume();
      for (const l of pendingLoops.splice(0)) l.start();
    },
    /** stop the device while the page is hidden (play's onVisibility); resumes on false */
    suspend(on) {
      if (!ctx) return;
      const p = on ? ctx.suspend() : ctx.resume();
      if (p && p.catch) p.catch(() => {});
    },
    volume(bus, v) { vol[bus] = v; if (buses && buses[bus]) buses[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    play(name, { at, bus = 'sfx', gain = 1, rate = 1, ref = 2 } = {}) {
      if (!ctx || !bufs[name]) { stats.skipped++; return null; }
      const src = ctx.createBufferSource(), g = ctx.createGain();
      const list = [].concat(bufs[name]);
      src.buffer = list[Math.floor(J() * list.length)];
      src.playbackRate.value = rate; g.gain.value = gain;
      src.connect(g); g.connect(at ? panner(at, ref, buses[bus]) : buses[bus]);
      src.start();
      stats.played[name] = (stats.played[name] || 0) + 1;
      return src;
    },
    footstep(surface, run) {
      const s = SURFACES.includes(surface) ? surface : 'stone';
      a.play('step_' + s, { gain: (run ? 0.9 : 0.6) * (0.85 + 0.3 * J()), rate: 0.92 + 0.16 * J() });
    },
    loop(name, { at, bus = 'ambience', gain = 1, ref = 3 } = {}) {
      const h = { name, src: null, start() {
        h.src = ctx.createBufferSource(); h.src.buffer = bufs[name]; h.src.loop = true;
        const g = ctx.createGain(); g.gain.value = gain; h.src.connect(g);
        g.connect(at ? panner(at, ref, buses[bus]) : buses[bus]);
        h.src.start(); stats.played[name] = (stats.played[name] || 0) + 1;
      } };
      if (ctx) h.start(); else pendingLoops.push(h);
      return h;
    },
    listen(cam) {
      if (!ctx) return;
      const L = ctx.listener, e = cam.matrixWorld.elements, t = ctx.currentTime;
      // forward = -Z column, up = Y column of the camera's world matrix
      if (L.positionX) {
        L.positionX.setValueAtTime(e[12], t); L.positionY.setValueAtTime(e[13], t); L.positionZ.setValueAtTime(e[14], t);
        L.forwardX.setValueAtTime(-e[8], t); L.forwardY.setValueAtTime(-e[9], t); L.forwardZ.setValueAtTime(-e[10], t);
        L.upX.setValueAtTime(e[4], t); L.upY.setValueAtTime(e[5], t); L.upZ.setValueAtTime(e[6], t);
      } else { L.setPosition(e[12], e[13], e[14]); L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }
    },
  };
  function panner([x, y, z], ref, out = buses.sfx) {
    const p = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, maxDistance: 80, rolloffFactor: 1.2, positionX: x, positionY: y, positionZ: z });
    p.connect(out);
    return p;
  }
  return a;
}

// ---- the sounds, made from noise and sines -------------------------------------------------------------
function makeSounds(ctx) {
  const SR = ctx.sampleRate;
  const R = sfc32(hash32('mirage/audio'));
  const noise = () => R() * 2 - 1;
  const buf = (sec, fn, ch = 1) => {
    const b = ctx.createBuffer(ch, Math.ceil(sec * SR), SR);
    for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); fn(d, c); }
    return b;
  };
  const lp = (a) => { let y = 0; return (x) => (y += a * (x - y)); };          // one-pole low-pass, a = 0..1
  const env = (t, at, dec) => (t < at ? t / at : Math.exp(-(t - at) / dec));
  // a seamless loop: render `sec + fade` seconds and fold the tail over the head
  const loop = (sec, fn, ch = 2, fade = 1) => buf(sec, (d, c) => {
    const n = d.length, f = Math.floor(fade * SR), tmp = new Float32Array(n + f);
    fn(tmp, c);
    for (let i = 0; i < n; i++) d[i] = tmp[i];
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = tmp[i] * k + tmp[n + i] * (1 - k); }
  }, ch);

  const variants = (n, make) => Array.from({ length: n }, (_, v) => make(v));
  const S = {};
  S.step_stone = variants(4, (v) => buf(0.14, (d) => {
    const l = lp(0.25), f = 80 + v * 9;
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = 0.5 * (x - l(x)) * Math.exp(-t / 0.006) + 0.5 * l(x) * Math.exp(-t / 0.03) + 0.4 * Math.sin(6.283 * f * t) * Math.exp(-t / 0.025); }
  }));
  S.step_gravel = variants(4, () => buf(0.26, (d) => {
    const l = lp(0.5);
    const grains = Array.from({ length: 34 }, () => [R() * 0.2 * R() + 0.005, 0.3 + 0.7 * R()]);
    for (let i = 0; i < d.length; i++) {
      const t = i / SR, x = noise(); let g = 0;
      for (const [gt, ga] of grains) { const u = t - gt; if (u > 0 && u < 0.004) g += ga * Math.exp(-u / 0.0012); }
      d[i] = (x - l(x)) * g * 0.6 + l(x) * env(t, 0.01, 0.06) * 0.25;
    }
  }));
  S.step_grass = variants(4, () => buf(0.28, (d) => {
    const l = lp(0.08), l2 = lp(0.02);
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = l(noise()); d[i] = (x - l2(x)) * 2.2 * env(t, 0.03, 0.07) * (0.6 + 0.4 * Math.abs(Math.sin(t * 140))); }
  }));
  S.step_wood = variants(4, (v) => buf(0.2, (d) => {
    const l = lp(0.3), f = 150 + v * 12;
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = 0.5 * (Math.sin(6.283 * f * t) + 0.5 * Math.sin(6.283 * f * 2.3 * t)) * Math.exp(-t / 0.05) + 0.3 * (x - l(x)) * Math.exp(-t / 0.004); }
  }));
  const bell = (d, f, t0, amp, dec) => {
    for (let i = Math.floor(t0 * SR); i < d.length; i++) { const t = i / SR - t0; d[i] += amp * Math.exp(-t / dec) * (Math.sin(6.283 * f * t) + 0.35 * Math.sin(6.283 * f * 2.76 * t) * Math.exp(-t / (dec * 0.3)) + 0.2 * Math.sin(6.283 * f * 5.4 * t) * Math.exp(-t / (dec * 0.12))); }
  };
  S.pickup = buf(0.9, (d) => { bell(d, 1046.5, 0, 0.3, 0.25); bell(d, 1568, 0.08, 0.26, 0.35); });
  S.done = buf(3.2, (d) => { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => bell(d, f, k * 0.16, 0.2, 0.9)); });
  S.locked = buf(0.4, (d) => {
    const l = lp(0.4);
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); let s = 0; for (const t0 of [0, 0.11]) { const u = t - t0; if (u > 0) s += ((x - l(x)) * 0.6 + 0.4 * Math.sin(6.283 * 2350 * u)) * Math.exp(-u / 0.012); } d[i] = s * 0.7; }
  });
  S.door = buf(1.9, (d) => {
    let ph = 0; const l = lp(0.05), jit = lp(0.002);
    for (let i = 0; i < d.length; i++) {
      const t = i / SR, f = 95 + 70 * Math.sin(Math.min(t / 1.3, 1) * Math.PI) + 15 * jit(noise());
      ph += (6.283 * f) / SR;
      let s = 0; for (let k = 1; k < 9; k++) s += Math.sin(ph * k) / k;
      const slip = 0.5 + 0.5 * Math.sin(t * 6.283 * 11 + 3 * Math.sin(t * 5));
      const a = t < 1.35 ? Math.min(t / 0.08, 1) * (0.25 + 0.75 * slip) * 0.18 : 0;
      const thud = t > 1.45 ? Math.exp(-(t - 1.45) / 0.06) * (0.5 * Math.sin(6.283 * 60 * (t - 1.45)) + 0.4 * l(noise())) : 0;
      d[i] = s * a + thud * 0.8;
    }
  });
  S.ignite = buf(1.2, (d) => {
    const l = lp(0.1), l2 = lp(0.01);
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(), b = l(x) - l2(x); d[i] = b * 2.2 * env(t, 0.18, 0.3) + (R() < 0.0009 ? (R() - 0.5) * 1.2 : 0) * Math.exp(-t / 0.6); }
  });
  S.wind = loop(14, (d, c) => {
    const l = lp(0.012), l2 = lp(0.0008);
    const SRf = SR, birds = Array.from({ length: 7 }, () => [R() * 13, 2400 + R() * 1800, 2 + Math.floor(R() * 3), c === 0 ? 0.6 + 0.4 * R() : 0.2 + 0.4 * R()]);
    for (let i = 0; i < d.length; i++) {
      const t = i / SRf, x = l(noise()); const w = (x - l2(x)) * 9 * (0.55 + 0.3 * Math.sin(t * 0.45 + c) + 0.15 * Math.sin(t * 1.3));
      let b = 0;
      for (const [bt, bf, n, amp] of birds) for (let k = 0; k < n; k++) { const u = t - bt - k * 0.14; if (u > 0 && u < 0.07) b += amp * 0.12 * Math.sin(6.283 * (bf + 12000 * u) * u) * Math.sin(Math.PI * u / 0.07); }
      d[i] = w * 0.5 + b;
    }
  });
  S.water = loop(6, (d) => {
    const l = lp(0.3), l2 = lp(0.05);
    for (let i = 0; i < d.length; i++) { const t = i / SR, x = l(noise()); d[i] = (x - l2(x)) * 0.9 * (0.75 + 0.25 * Math.sin(t * 7.1) * Math.sin(t * 2.3)) + (R() < 0.0015 ? (R() - 0.5) * 0.5 : 0); }
  }, 1, 0.5);
  S.pad = loop(16, (d, c) => {
    const chords = [[220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23]];   // A minor, F major
    for (let i = 0; i < d.length; i++) {
      const t = i / SR, k = Math.floor(t / 8) % 2, u = t % 8, e = Math.min(u / 2.5, 1) * Math.min((8 - u) / 2.5 + 0.2, 1);
      let s = 0; for (const f of chords[k]) s += Math.sin(6.283 * f * (1 + (c ? 0.0021 : -0.0017)) * t) + 0.3 * Math.sin(6.283 * f * 2.001 * t);
      d[i] = s * e * 0.045;
    }
  });
  return S;
}

// Mirage original code. The audio engine on top of the mixer graph: sound files (decoded into a reference-counted
// cache, or streamed through a media element), voices with a cap, priorities, stealing and virtual voices that keep
// time while inaudible, 3D placement (HRTF or equal-power, distance models and curves, cones, Doppler, spread),
// reverb zones blended by where the listener stands, occlusion by rays with a budget, and sound cues. Opt-in: nothing
// here runs unless a page calls createAudioEngine. Given the legacy mixer (createAudio) it shares that mixer's
// context, buses, volumes and procedural sounds, and audio.play / loop / footstep keep working through the new buses.
// ---------------------------------------------------------------------------
// const engine = createAudioEngine({ audio: g.audio, voices: 32,
//   buses: { reverb: { effects: [{ type: 'eq', low: -4 }] }, dialogue: {} }, snapshots: { cave: { ambience: { gain: 0.3 } } } });
// engine.unlock()                               from a user gesture (or let audio.unlock() do it)
// await engine.load(url, { name: 'bark' })      decode into the cache (+1 reference); engine.release('bark')
// await engine.preload('level1', { bark: url, hum: url2 }, (done, total) => {})        engine.unload('level1')
// engine.add('beep', audioBuffer)               a buffer made in code
// const s = engine.stream(url, { bus: 'music', loop: true, fadeIn: 2 })      long music; s.pause() s.seek(t) s.stop(1)
// const v = engine.play('bark', { at: [x, y, z] | object3D | () => [x, y, z], bus, gain, rate, loop, priority,
//   model: 'inverse' | 'linear' | 'exponential' | 'custom', ref, max, rolloff, curve, panning: 'HRTF' | 'equalpower',
//   dir, inner, outer, outerGain, spread, blend, doppler, occlude, reverb, delay, offset, fadeIn, virtual, onEnd });
// v.set({ gain, rate, at, dir, priority }, seconds)   v.stop(fadeSeconds)   v.real   v.time   v.audibility
// engine.cue('step', { sounds: ['a', 'b', 'c'], mode: 'shuffle', gain: [0.7, 1], pitch: [-1, 1], cooldown: 0.1, instances: 4 })
// engine.zones([{ name: 'hall', box: [x0, y0, z0, x1, y1, z1], fade: 2, reverb: 'hall', wet: 0.8, snapshot: 'indoors' }])
// engine.occlusion({ test: gridOccluder(grid), rays: 3, budget: 8, interval: 0.15 })
// engine.update(dt, camera)                     once per frame: listener, voices, zones, occlusion, music
// engine.stats                                  voices, virtual, stolen, rays, zones, assets (docs/audio.md)
// Decisions (which voices sound, cue picks, cooldowns, zone weights, the ray schedule) depend only on the calls made
// and the dt passed to update, never on the wall clock or Math.random, so a scripted run repeats exactly.
// ponytail: distance, cone, occlusion and Doppler are set once per update and smoothed (30 ms), not per sample; a
// voice that comes back from virtual resumes within one update of where it would be; streams are not spatial and
// are never virtual; occlusion bends nothing (no diffraction or transmission by material).
// ---------------------------------------------------------------------------
import { sfc32, hash32 } from '@miragekit/core/rng';
import { createMixer, reverbBuffer } from './audio-mixer.js';
import { distanceGain, coneGain, dopplerRatio, occlusionResponse, reverbParams, decodeWav, dataUrlBytes } from './audio-dsp.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FADE = 0.015;   // seconds: voices that are cut (stolen, stopped, resumed) fade this long so they do not click

// ---- reverb zones: shapes and weights (no Web Audio; Node checks these) ------------------------------------
/** [{ box | sphere | shape + min/max/center/size/radius, fade, reverb, wet, priority, snapshot, name }] in one form */
export function normalizeZones(list = []) {
  return list.map((z, i) => {
    let box = z.box, sphere = z.sphere;
    if (!box && !sphere) {
      if (z.shape === 'sphere' || z.radius != null) sphere = [...z.center, z.radius];
      else if (z.min && z.max) box = [...z.min, ...z.max];
      else if (z.center && z.size) { const s = typeof z.size === 'number' ? [z.size, z.size, z.size] : z.size; box = [0, 1, 2].map((k) => z.center[k] - s[k] / 2).concat([0, 1, 2].map((k) => z.center[k] + s[k] / 2)); }
      else throw new Error(`audio zone ${z.name || i}: needs box [x0, y0, z0, x1, y1, z1], sphere [x, y, z, r], or shape with min / max / center / size / radius`);
    }
    if (box) box = [Math.min(box[0], box[3]), Math.min(box[1], box[4]), Math.min(box[2], box[5]), Math.max(box[0], box[3]), Math.max(box[1], box[4]), Math.max(box[2], box[5])];
    return { name: z.name || 'zone' + i, box: box || null, sphere: sphere || null, fade: Math.max(z.fade ?? 2, 1e-3), reverb: z.reverb ?? 'room', wet: z.wet ?? 1, priority: z.priority ?? 0, snapshot: z.snapshot || null };
  });
}
/** zones in a world plan: plan.audio.zones (docs/audio.md) */
export const zonesFromPlan = (plan) => normalizeZones(plan?.audio?.zones || []);
/** Weight of each (normalised) zone for a listener at pos: 1 inside, falling to 0 over `fade` metres outside. Higher
 *  priority zones take their share first; what is left over (out[zones.length]) belongs to the ambient reverb. */
export function zoneWeights(zones, pos, out = []) {
  let left = 1;
  const order = zones.map((z, i) => i).sort((a, b) => zones[b].priority - zones[a].priority || a - b);
  for (const i of order) {
    const z = zones[i];
    let d;
    if (z.sphere) d = Math.hypot(pos[0] - z.sphere[0], pos[1] - z.sphere[1], pos[2] - z.sphere[2]) - z.sphere[3];
    else {
      const b = z.box, dx = Math.max(b[0] - pos[0], 0, pos[0] - b[3]), dy = Math.max(b[1] - pos[1], 0, pos[1] - b[4]), dz = Math.max(b[2] - pos[2], 0, pos[2] - b[5]);
      d = Math.hypot(dx, dy, dz);
    }
    const w = Math.min(clamp(1 - d / z.fade, 0, 1), left);
    out[i] = w; left -= w;
  }
  out[zones.length] = left; out.length = zones.length + 1;
  return out;
}

const posOf = (at, out) => {
  const p = typeof at === 'function' ? at() : at;
  if (Array.isArray(p) || ArrayBuffer.isView(p)) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; }
  else if (p.matrixWorld) { const e = p.matrixWorld.elements; out[0] = e[12]; out[1] = e[13]; out[2] = e[14]; }
  else { const q = p.position || p; out[0] = q.x; out[1] = q.y; out[2] = q.z; }
  return out;
};

export function createAudioEngine(opts = {}) {
  const { audio = null, hrtfVoices = 8, seed = 'mirage/audio-engine', speedOfSound = 343, silent = 0.001 } = opts;
  let cap = opts.voices ?? 32, panning = opts.panning || 'HRTF', dopplerFactor = opts.doppler ?? 1;
  let ctx = opts.context || null, mixer = null, zoneIn = null, disposed = false, time = 0, ids = 0, own = null;
  const R = sfc32(hash32(seed));
  const L = { pos: [0, 0, 0], fwd: [0, 0, -1], up: [0, 1, 0], vel: [0, 0, 0], placed: false };
  const live = [], waiting = [], systems = new Set(), streams = new Set(), cues = new Map(), cache = new Map(), groups = new Map();
  const stats = { time: 0, voices: 0, virtual: 0, total: 0, peak: 0, hrtf: 0, started: 0, ended: 0, stolen: 0, culled: 0, resumed: 0, dropped: 0, skipped: 0, cooled: 0,
    rays: 0, raysTotal: 0, streams: 0, zones: {}, assets: { count: 0, bytes: 0, decodeMs: 0 }, state: 'locked' };
  let occ = null, occCursor = 0, zones = [], zoneOpts = {}, returns = new Map(), zw = [], snapW = '';
  const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // ---- start-up: the context may only exist after a user gesture ---------------------------------------
  function init() {
    if (mixer) return true;
    if (disposed) return false;
    if (!ctx && audio?.ctx) ctx = audio.ctx;
    if (!ctx) return false;
    const old = audio?.buses;
    mixer = createMixer(ctx, { output: old ? old.master : ctx.destination });
    for (const b of ['music', 'sfx', 'ambience']) {
      const bus = mixer.bus(b, {});
      // the legacy bus gain (the player's volume setting) becomes the last stage of the new bus
      if (old) { old[b].disconnect(); bus.setTail(old[b]); }
    }
    if (audio) audio.route = (b) => (b !== 'master' && mixer?.has(b) ? mixer.bus(b).input : null);
    for (const [name, spec] of Object.entries(opts.buses || {})) mixer.bus(name, { ...spec, sends: undefined });
    for (const [name, spec] of Object.entries(opts.buses || {})) if (spec.sends) mixer.bus(name, { sends: spec.sends });   // every target exists by now
    for (const [name, v] of Object.entries(opts.snapshots || {})) mixer.snapshot(name, v);
    for (const d of opts.ducks || []) mixer.duck(d.target, d.source, d);
    zoneIn = G();
    buildReturns();
    stats.state = ctx.state || 'running';
    for (const fn of waiting.splice(0)) fn();
    return true;
  }
  const whenReady = (fn) => { if (init()) fn(); else if (!disposed) waiting.push(fn); };

  // ---- sound files ---------------------------------------------------------------------------------------
  let decoder = null;
  const decodeCtx = () => ctx || (decoder ??= new OfflineAudioContext(2, 1, 48000));   // decoding needs no gesture
  async function bytesOf(url) {
    if (url.startsWith('data:')) return dataUrlBytes(url).buffer;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.arrayBuffer();
    } catch (e) {
      // a page opened from file:// cannot fetch its neighbours; XMLHttpRequest sometimes may
      return await new Promise((res, rej) => {
        const fail = () => rej(new Error(`audio: cannot read ${url.slice(0, 80)} (${e.message}). From file://, inline the sound as a data: URL (the single-file build does)`));
        if (typeof XMLHttpRequest === 'undefined') return fail();
        const x = new XMLHttpRequest();
        x.open('GET', url); x.responseType = 'arraybuffer';
        x.onload = () => (x.response && x.response.byteLength && (x.status === 200 || x.status === 0) ? res(x.response) : fail());
        x.onerror = fail; x.send();
      });
    }
  }
  async function decode(bytes) {
    const c = decodeCtx(), t0 = performance.now();
    let buffer;
    try { buffer = await c.decodeAudioData(bytes.slice(0)); }
    catch (e) {   // not a format this browser decodes: plain WAV is read here
      let w;
      try { w = decodeWav(bytes); } catch { throw new Error('audio: the browser could not decode this file (' + (e?.message || e) + ')'); }
      buffer = c.createBuffer(w.channels.length, w.channels[0].length, w.sampleRate);
      w.channels.forEach((d, i) => buffer.getChannelData(i).set(d));
    }
    stats.assets.decodeMs += performance.now() - t0;
    return buffer;
  }
  const count = () => { let n = 0, bytes = 0; for (const e of cache.values()) if (e.buffer) { n++; bytes += e.bytes; } stats.assets.count = n; stats.assets.bytes = bytes; };
  const toBuffer = (data) => {
    if (data && typeof data.getChannelData === 'function') return data;
    const ch = ArrayBuffer.isView(data) ? [data] : data.channels, c = decodeCtx();
    const b = c.createBuffer(ch.length, ch[0].length, data.sampleRate || c.sampleRate);
    ch.forEach((d, i) => b.getChannelData(i).set(d));
    return b;
  };
  /** a buffer made in code (an AudioBuffer, a Float32Array, or { channels, sampleRate }) under a name; one reference */
  function add(name, data) {
    const buffer = toBuffer(data), e = cache.get(name);
    if (e) { e.buffer = buffer; e.promise = Promise.resolve(buffer); e.refs++; } else cache.set(name, { name, url: null, buffer, promise: Promise.resolve(buffer), refs: 1, bytes: buffer.length * buffer.numberOfChannels * 4 });
    count();
    return buffer;
  }
  /** fetch and decode once; every call takes a reference, release(name) gives it back */
  function load(url, { name = url, group } = {}) {
    let e = cache.get(name);
    if (e) e.refs++;
    else {
      e = { name, url, buffer: null, refs: 1, bytes: 0, promise: null };
      e.promise = bytesOf(url).then(decode).then((b) => { e.buffer = b; e.bytes = b.length * b.numberOfChannels * 4; count(); return b; },
        (err) => { if (cache.get(name) === e) cache.delete(name); throw err; });
      cache.set(name, e);
    }
    if (group) { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(name); }
    return e.promise;
  }
  /** drop one reference; at zero the buffer leaves the cache (voices already playing it finish) */
  function release(name) {
    const e = cache.get(name);
    if (!e) return 0;
    if (--e.refs <= 0) { cache.delete(name); count(); return 0; }
    return e.refs;
  }
  /** items: { name: url } or [url | { name, url }]; resolves when all are decoded; progress(done, total, name) */
  function preload(group, items, progress) {
    const list = Array.isArray(items) ? items.map((i) => (typeof i === 'string' ? { name: i, url: i } : i)) : Object.entries(items).map(([name, url]) => ({ name, url }));
    let done = 0;
    return Promise.all(list.map((i) => load(i.url, { name: i.name, group }).then((b) => { progress?.(++done, list.length, i.name); return b; })));
  }
  function unload(group) { for (const n of groups.get(group) || []) release(n); groups.delete(group); }
  /** the buffer a name plays: the cache first, then the legacy mixer's procedural sounds (a random variant) */
  function bufferOf(name) {
    const e = cache.get(name);
    if (e) return e.buffer;
    const old = audio?.buffers?.[name];
    return old ? (Array.isArray(old) ? old[Math.floor(R() * old.length)] : old) : null;
  }

  // ---- streams: long files through a media element --------------------------------------------------------
  function stream(url, { bus = 'music', gain = 1, loop = false, autoplay = true, fadeIn = 0, name = url } = {}) {
    const el = new Audio();
    el.preload = 'auto'; el.loop = loop;
    if (/^https?:/i.test(url) && typeof location !== 'undefined' && new URL(url, location.href).origin !== location.origin) el.crossOrigin = 'anonymous';
    el.src = url;
    const s = {
      name, el, node: null, direct: false, error: null, state: 'loading', gain,
      get time() { return el.currentTime; }, get duration() { return el.duration; }, get paused() { return el.paused; },
      play() { s.state = 'playing'; const p = el.play(); if (p?.catch) p.catch((e) => { s.error = e; s.state = 'blocked'; }); return s; },
      pause() { el.pause(); s.state = 'paused'; return s; },
      seek(t) { el.currentTime = t; return s; },
      /** the stream's own gain, over sec seconds */
      fade(to, sec = 0) { s.gain = to; if (s.g) mixer.ramp(s.g.gain, to, sec); else el.volume = clamp(to, 0, 1); return s; },
      stop(sec = 0) {
        if (s.state === 'stopped') return;
        s.state = 'stopped'; streams.delete(s); stats.streams = streams.size;
        const end = () => { el.pause(); el.removeAttribute('src'); el.load?.(); s.node?.disconnect(); s.g?.disconnect(); };
        if (sec > 0 && s.g) { mixer.ramp(s.g.gain, 0, sec); setTimeout(end, sec * 1000 + 30); } else end();
      },
    };
    el.addEventListener('ended', () => { if (s.state === 'playing') s.state = 'ended'; });
    el.addEventListener('error', () => { s.error = el.error || new Error('media error'); if (s.state !== 'stopped') s.state = 'error'; });
    streams.add(s); stats.streams = streams.size;
    whenReady(() => {
      if (s.state === 'stopped') return;
      try {
        s.node = ctx.createMediaElementSource(el); s.g = G(fadeIn > 0 ? 0 : gain);
        s.node.connect(s.g); s.g.connect(mixer.bus(mixer.has(bus) ? bus : 'music').input);
        if (fadeIn > 0) mixer.ramp(s.g.gain, gain, fadeIn);
      } catch { s.direct = true; el.volume = clamp(gain, 0, 1); }   // no media-element source here: plays past the mixer
      if (autoplay) s.play();
    });
    return s;
  }

  // ---- voices --------------------------------------------------------------------------------------------
  const Voice = {
    get real() { return !!this.n; }, get playing() { return this.state !== 'ended'; }, get time() { return this.loop && this.dur ? ((this.t % this.dur) + this.dur) % this.dur : this.t; },
    get audibility() { return this.aud; },
    /** stop after a fade of sec seconds (0: at once, with the click-free 15 ms) */
    stop(sec = 0) {
      if (this.state === 'ended') return;
      if (sec > 0) { this.fade = { from: this.level, to: 0, t0: time, dur: sec, end: true }; if (this.n) mixer.ramp(this.n.g.gain, 0, sec); } else end(this, false);
    },
    set(o, sec = 0) {
      if (this.state === 'ended') return this;
      if (o.gain !== undefined) { this.gain = o.gain; if (this.n) mixer.ramp(this.n.g.gain, this.gain * (this.fade ? this.fade.to : this.level), sec); }
      if (o.rate !== undefined) this.rate = o.rate;
      if (o.at !== undefined) { this.at = o.at; if (!this.pos) throw new Error('audio: a voice started without `at` is not spatial; start it with a position'); }
      if (o.dir !== undefined) this.dir = o.dir;
      if (o.priority !== undefined) this.priority = o.priority;
      return this;
    },
  };
  /** play a cue, a named sound or an AudioBuffer; null when nothing can play (unknown name, cooldown, dropped) */
  function play(sound, o = {}) {
    if (disposed) return null;
    init();
    const cue = typeof sound === 'string' ? cues.get(sound) : null;
    if (cue) return playCue(cue, o);
    const buffer = typeof sound === 'string' ? bufferOf(sound) : sound;
    if (!buffer) { stats.skipped++; return null; }
    return start(buffer, typeof sound === 'string' ? sound : o.name || 'buffer', o, null);
  }
  function start(buffer, name, o, cue) {
    const spatial = o.at != null, v = Object.create(Voice);
    Object.assign(v, {
      id: ++ids, name, cue, buffer, dur: buffer.duration, bus: o.bus || 'sfx', gain: o.gain ?? 1, rate: o.rate ?? 1, loop: !!o.loop, priority: o.priority ?? 128,
      at: o.at ?? null, pos: spatial ? [0, 0, 0] : null, vel: [0, 0, 0], seen: false, dist: 0, att: 1, aud: 0, dop: 1,
      model: o.model || 'inverse', ref: o.ref ?? 1, max: o.max ?? 10000, rolloff: o.rolloff ?? 1, curve: o.curve || null,
      panning: o.panning || null, dir: o.dir || null, inner: o.inner ?? 360, outer: o.outer ?? 360, outerGain: o.outerGain ?? 0,
      spread: clamp(o.spread ?? 0, 0, 1), blend: clamp(o.blend ?? 1, 0, 1), doppler: o.doppler ?? dopplerFactor,
      occlude: spatial && o.occlude !== false, occ: 0, occTo: 0, wetOcc: 0, wetTo: 0, occAt: -1e9, reverb: o.reverb ?? (spatial ? 1 : 0),
      mode: o.virtual || 'resume', t: o.offset || 0, wait: Math.max(o.delay || 0, 0), level: o.fadeIn > 0 ? 0 : 1,
      fade: o.fadeIn > 0 ? { from: 0, to: 1, t0: time, dur: o.fadeIn } : null, state: 'virtual', n: null, onEnd: o.onEnd || null, fresh: true,
    });
    if (v.model === 'custom' && !v.curve) throw new Error('audio: model "custom" needs a curve: [[distance, gain], ...] or a function');
    if (spatial) {
      posOf(v.at, v.pos);
      if (v.occlude && occ) { v.occ = v.occTo = trace(v, 1); v.occAt = time; }   // one ray now, so a sound behind a wall starts muffled
    }
    hear(v);
    let ok = !!mixer && v.aud >= silent;
    if (ok && stats.voices >= cap) {
      let weak = null;
      for (const u of live) if (u.n && (!weak || before(weak, u))) weak = u;
      if (weak && (v.priority > weak.priority || (v.priority === weak.priority && v.aud > weak.aud * 1.2))) { stats.stolen++; if (weak.mode === 'stop') end(weak, false); else unrealise(weak); }
      else ok = false;
    }
    if (!ok && v.mode === 'stop') { stats.dropped++; return null; }
    live.push(v); stats.started++;
    if (ok) realise(v);
    tally();
    return v;
  }
  // a sorts before b: higher priority, then louder (a voice that is already sounding gets a 20 % head start), then older
  const score = (v) => v.aud * (v.n ? 1.2 : 1);
  const before = (a, b) => (a.priority !== b.priority ? a.priority > b.priority : score(a) !== score(b) ? score(a) > score(b) : a.id < b.id);
  function hear(v) {
    const lvl = v.fade ? Math.max(v.level, v.fade.to) : v.level;
    if (!v.pos) { v.att = 1; return (v.aud = v.gain * lvl); }
    const dx = L.pos[0] - v.pos[0], dy = L.pos[1] - v.pos[1], dz = L.pos[2] - v.pos[2];
    v.dist = Math.hypot(dx, dy, dz);
    const g = distanceGain(v.dist, v) * (v.dir ? coneGain(v.dir, [dx, dy, dz], v.inner, v.outer, v.outerGain) : 1);
    v.att = 1 + (g - 1) * v.blend;   // blend 0: a flat (2D) sound, 1: fully in the world
    return (v.aud = v.gain * lvl * v.att * (v.occlude && occ ? occlusionResponse(v.occ, occ).gain : 1));
  }
  function realise(v) {
    const now = ctx.currentTime, bus = mixer.bus(mixer.has(v.bus) ? v.bus : 'sfx');
    if (v.mode === 'restart' && !v.fresh) { v.t = 0; }
    let off = v.loop ? ((v.t % v.dur) + v.dur) % v.dur : v.t;
    if (!(off < v.dur)) off = 0;
    const src = ctx.createBufferSource(), g = G(0), n = { src, g, lp: null, dist: null, pan: null, pg: null, byp: null, send: null, hrtf: false, dv: -1, lf: -1, rv: -1, sv: -1 };
    src.buffer = v.buffer; src.loop = v.loop; src.playbackRate.value = n.rv = v.rate * v.dop;
    const target = v.gain * (v.fade ? v.fade.to : v.level), from = v.gain * v.level;
    // a new sound starts at full level on its first sample; one that resumes mid-way fades in
    if (v.fresh && !v.fade) g.gain.value = target;
    else if (v.fade) { g.gain.value = from; mixer.ramp(g.gain, target, Math.max(v.fade.t0 + v.fade.dur - time, 0)); }
    else mixer.ramp(g.gain, target, FADE);
    src.connect(g);
    let tail = g;
    const R0 = occ && v.occlude ? occlusionResponse(v.occ, occ) : null;
    if (R0) { n.lp = ctx.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.Q.value = -3; n.lp.frequency.value = n.lf = R0.freq; tail.connect(n.lp); tail = n.lp; }
    if (v.pos) {
      n.dist = G(n.dv = v.att * (R0 ? R0.gain : 1)); tail.connect(n.dist);
      n.hrtf = (v.panning || panning) === 'HRTF' && stats.hrtf < hrtfVoices;   // HRTF convolution is the costly part: a budget of its own
      if (n.hrtf) stats.hrtf++;
      // rolloffFactor 0: the panner only pans; distance, cone and occlusion are in n.dist, where curves can be anything
      n.pan = ctx.createPanner(); n.pan.panningModel = n.hrtf ? 'HRTF' : 'equalpower'; n.pan.distanceModel = 'inverse'; n.pan.rolloffFactor = 0;
      setXYZ(n.pan, 'position', v.pos, 0);
      const amount = v.blend * (1 - v.spread);
      if (amount < 1) {   // spread / blend: part of the signal goes past the panner, equal power between the two
        n.pg = G(Math.sin((amount * Math.PI) / 2)); n.byp = G(Math.cos((amount * Math.PI) / 2));
        n.dist.connect(n.pg); n.pg.connect(n.pan); n.dist.connect(n.byp); n.byp.connect(bus.input);
      } else n.dist.connect(n.pan);
      n.pan.connect(bus.input);
    } else tail.connect(bus.input);
    if (v.reverb > 0 && zones.length + (zoneOpts.ambient ? 1 : 0)) { n.send = G(n.sv = sendGain(v)); tail.connect(n.send); n.send.connect(zoneIn); }
    src.start(now + v.wait, off);
    v.n = n; v.state = 'real'; if (!v.fresh) stats.resumed++;
    v.fresh = false;
  }
  // the reverb send falls off with the square root of the direct sound, so far sources are wetter, as in a room
  const sendGain = (v) => v.reverb * (v.pos ? Math.sqrt(Math.max(v.att, 0)) : 1) * (occ && v.occlude ? 1 + (occ.wet - 1) * v.wetOcc : 1);
  function setXYZ(node, what, p, tc) {
    const now = ctx.currentTime;
    for (let k = 0; k < 3; k++) { const a = node[what + 'XYZ'[k]]; if (tc > 0) a.setTargetAtTime(p[k], now, tc); else a.value = p[k]; }
  }
  function unrealise(v, cut = FADE) {
    const n = v.n;
    if (!n) return;
    v.n = null; v.state = 'virtual';
    if (n.hrtf) stats.hrtf--;
    const now = ctx.currentTime, off = () => { for (const k of ['src', 'g', 'lp', 'dist', 'pan', 'pg', 'byp', 'send']) n[k]?.disconnect(); };
    if (cut > 0) {
      mixer.ramp(n.g.gain, 0, cut);
      try { n.src.stop(now + cut + 0.005); } catch { /* never started */ }
      n.src.onended = off;
    } else if (cut < 0) n.src.onended = off;   // it has played out by the engine's clock: the last samples are the source's to finish
    else { try { n.src.stop(); } catch { /* never started */ } off(); }
  }
  function end(v, natural) {
    if (v.state === 'ended') return;
    unrealise(v, natural ? -1 : FADE);
    v.state = 'ended';
    const i = live.indexOf(v);
    if (i >= 0) live.splice(i, 1);
    stats.ended++;
    tally();
    v.onEnd?.(v, natural);
    if (natural && v.cue?.then) play(v.cue.then, v.pos ? { at: v.pos.slice() } : {});
  }
  function tally() {
    let r = 0;
    for (const v of live) if (v.n) r++;
    stats.voices = r; stats.virtual = live.length - r; stats.total = live.length;
    if (r > stats.peak) stats.peak = r;
  }

  // ---- cues ----------------------------------------------------------------------------------------------
  const range = (x, d) => (x == null ? d : Array.isArray(x) ? x[0] + (x[1] - x[0]) * R() : x);
  function cue(name, spec) {
    const { sounds, mode = 'random', gain, rate, pitch, cooldown = 0, instances = Infinity, steal = true, delay, then, ...defaults } = spec;
    if (!sounds?.length) throw new Error(`audio cue "${name}": sounds is empty`);
    if (!['random', 'shuffle', 'sequence'].includes(mode)) throw new Error(`audio cue "${name}": mode ${mode} (random, shuffle, sequence)`);
    const c = { name, variants: sounds.map((s) => (typeof s === 'object' && s.sound !== undefined ? { weight: 1, gain: 1, rate: 1, ...s } : { sound: s, weight: 1, gain: 1, rate: 1 })),
      mode, gain, rate, pitch, cooldown, instances, steal, delay, then, defaults, last: -1e9, prev: -1, step: 0, bag: [], played: 0 };
    cues.set(name, c);
    return c;
  }
  function pick(c) {
    const n = c.variants.length;
    if (n === 1) return 0;
    if (c.mode === 'sequence') return c.step++ % n;
    if (c.mode === 'shuffle') {   // every variant once before any repeats; a new bag never opens with the last one played
      if (!c.bag.length) {
        c.bag = c.variants.map((_, i) => i);
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [c.bag[i], c.bag[j]] = [c.bag[j], c.bag[i]]; }
        if (c.bag[n - 1] === c.prev) [c.bag[0], c.bag[n - 1]] = [c.bag[n - 1], c.bag[0]];
      }
      return c.bag.pop();
    }
    let total = 0;
    for (let i = 0; i < n; i++) if (i !== c.prev) total += c.variants[i].weight;   // never the same variant twice running
    let x = R() * total;
    for (let i = 0; i < n; i++) if (i !== c.prev && (x -= c.variants[i].weight) < 0) return i;
    return (c.prev + 1) % n;
  }
  function playCue(c, o) {
    if (time - c.last < c.cooldown) { stats.cooled++; return null; }
    if (c.instances < Infinity) {
      const mine = live.filter((v) => v.cue === c);
      if (mine.length >= c.instances) { if (!c.steal) { stats.dropped++; return null; } end(mine[0], false); stats.stolen++; }
    }
    const i = pick(c), va = c.variants[i];
    c.prev = i;
    const buffer = typeof va.sound === 'string' ? bufferOf(va.sound) : va.sound;
    if (!buffer) { stats.skipped++; return null; }
    const v = start(buffer, c.name, { ...c.defaults, ...o,
      gain: range(c.gain, 1) * va.gain * (o.gain ?? 1), rate: range(c.rate, 1) * 2 ** (range(c.pitch, 0) / 12) * va.rate * (o.rate ?? 1),
      delay: range(c.delay, 0) + (o.delay || 0) }, c);
    if (v) { c.last = time; c.played++; v.variant = i; }
    return v;
  }

  // ---- reverb zones --------------------------------------------------------------------------------------
  function buildReturns() {
    for (const r of returns.values()) { r.in.disconnect(); r.conv.disconnect(); }
    returns = new Map();
    if (!mixer || !(zones.length || zoneOpts.ambient)) return;
    const busName = zoneOpts.bus || 'reverb';
    const bus = mixer.has(busName) ? mixer.bus(busName) : mixer.bus(busName, {});
    const all = zoneOpts.ambient ? [...zones, { reverb: zoneOpts.ambient.reverb ?? 'outdoor' }] : zones;
    for (const z of all) {   // one convolver per distinct room, shared by every zone that names it; made now, not mid-game
      const key = JSON.stringify(reverbParams(z.reverb));
      z.key = key;
      if (returns.has(key)) continue;
      const r = { in: G(0), conv: ctx.createConvolver(), gain: 0 };
      r.conv.normalize = false; r.conv.buffer = reverbBuffer(ctx, z.reverb);
      zoneIn.connect(r.in); r.in.connect(r.conv); r.conv.connect(bus.input);
      returns.set(key, r);
    }
    if (zoneOpts.ambient) zoneOpts.ambient.key = all[all.length - 1].key;
  }
  /** set the zones (see normalizeZones); ambient: the reverb where no zone reaches, { reverb, wet }; bus: where returns go */
  function setZones(list, o = {}) {
    zones = normalizeZones(list); zoneOpts = { ...o }; snapW = '';
    stats.zones = {};
    buildReturns();
    return zones;
  }
  function updateZones() {
    if (!(zones.length || zoneOpts.ambient)) return;
    zoneWeights(zones, L.pos, zw);
    const now = ctx.currentTime, snaps = {};
    for (const r of returns.values()) r.want = 0;
    const rest = zw[zones.length];
    let any = false;
    zones.forEach((z, i) => {
      stats.zones[z.name] = +zw[i].toFixed(3);
      returns.get(z.key).want += zw[i] * z.wet;
      if (z.snapshot) { snaps[z.snapshot] = (snaps[z.snapshot] || 0) + zw[i]; any = true; }
    });
    if (zoneOpts.ambient) returns.get(zoneOpts.ambient.key).want += rest * (zoneOpts.ambient.wet ?? 0.3);
    for (const r of returns.values()) if (Math.abs(r.want - r.gain) > 0.002) { r.gain = r.want; r.in.gain.setTargetAtTime(r.want, now, 0.08); }
    if (any) {   // zones can carry a mixer snapshot (wind low-passed indoors): its weight is the zone's
      const used = Object.values(snaps).reduce((a, b) => a + b, 0);
      const w = { default: Math.max(1 - used, 0), ...snaps }, key = Object.entries(w).map(([k, x]) => k + ':' + x.toFixed(2)).join();
      if (key !== snapW) { snapW = key; for (const k of Object.keys(w)) if (!(w[k] > 0)) delete w[k]; mixer.transition(w, 0.15); }
    }
  }

  // ---- occlusion -----------------------------------------------------------------------------------------
  /** { test(from, to) -> 0..1 (or a boolean), rays: 1 | 3 | 5, radius, interval, budget, gain, freq, wet, smooth, max } or null */
  function occlusion(o) {
    occ = o ? { rays: 3, radius: 0.5, interval: 0.15, budget: 8, gain: 0.3, freq: 700, open: 20000, wet: 0.5, smooth: 0.12, max: 80, ...o } : null;
    if (occ && typeof occ.test !== 'function') throw new Error('audio occlusion: test(from, to) is required (gridOccluder, physicsOccluder, sceneOccluder)');
    return occ;
  }
  const A = [0, 0, 0], B = [0, 0, 0];
  // rays from the source (and offsets beside it) to the listener: the direct one decides whether anything is in the way,
  // the others how much gets round it. Returns 0..1 and leaves the wet (all paths shut) share in v.wetTo.
  function trace(v, rays) {
    const one = (from, to) => { stats.rays++; stats.raysTotal++; const r = occ.test(from, to); return r === true ? 1 : r ? +r : 0; };
    const direct = one(v.pos, L.pos);
    if (rays <= 1 || !direct) { v.wetTo = rays <= 1 ? direct : 0; return direct; }
    // sideways: perpendicular to the path, in the ground plane
    const dx = L.pos[0] - v.pos[0], dz = L.pos[2] - v.pos[2], l = Math.hypot(dx, dz) || 1, rx = (-dz / l) * occ.radius, rz = (dx / l) * occ.radius;
    let sum = 0, min = 1, n = 0;
    const side = (px, py, pz, q, fromSource) => {
      A[0] = px; A[1] = py; A[2] = pz;
      const r = fromSource ? one(A, q) : one(q, A);
      sum += r; n++; if (r < min) min = r;
    };
    side(v.pos[0] + rx, v.pos[1], v.pos[2] + rz, L.pos, true); side(v.pos[0] - rx, v.pos[1], v.pos[2] - rz, L.pos, true);
    if (rays >= 5) { side(v.pos[0], v.pos[1] + occ.radius, v.pos[2], L.pos, true); B[0] = v.pos[0]; B[1] = v.pos[1]; B[2] = v.pos[2]; side(L.pos[0], L.pos[1] + occ.radius, L.pos[2], B, false); }
    v.wetTo = direct * min;
    return direct * (0.5 + (0.5 * sum) / n);
  }
  function updateOcclusion(dt) {
    stats.rays = 0;
    if (!occ) return;
    const n = live.length;
    let i = 0;
    for (; i < n && stats.rays + occ.rays <= occ.budget; i++) {
      const v = live[(occCursor + i) % n];
      if (!v.occlude || v.dist > occ.max || time - v.occAt < occ.interval) continue;
      v.occTo = trace(v, occ.rays); v.occAt = time;
    }
    occCursor = n ? (occCursor + i) % n : 0;   // the next update starts where this one ran out of rays
    const k = 1 - Math.exp(-dt / Math.max(occ.smooth, 1e-3));
    for (const v of live) if (v.occlude) { v.occ += (v.occTo - v.occ) * k; v.wetOcc += (v.wetTo - v.wetOcc) * k; }
  }

  // ---- the frame -----------------------------------------------------------------------------------------
  const prevL = [0, 0, 0], np = [0, 0, 0];
  /** where the ears are: a camera (matrixWorld) or { pos, forward, up }. update(dt, camera) calls this. */
  function listener(cam, dt = 0) {
    prevL[0] = L.pos[0]; prevL[1] = L.pos[1]; prevL[2] = L.pos[2];
    if (cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      L.pos[0] = e[12]; L.pos[1] = e[13]; L.pos[2] = e[14]; L.fwd[0] = -e[8]; L.fwd[1] = -e[9]; L.fwd[2] = -e[10]; L.up[0] = e[4]; L.up[1] = e[5]; L.up[2] = e[6];
    } else { for (let k = 0; k < 3; k++) { L.pos[k] = cam.pos[k]; if (cam.forward) L.fwd[k] = cam.forward[k]; if (cam.up) L.up[k] = cam.up[k]; } }
    velocity(L.vel, L.pos, prevL, dt, L.placed);
    L.placed = true;
    if (!ctx) return;
    const A = ctx.listener;
    if (A.positionX) { for (let k = 0; k < 3; k++) { A['position' + 'XYZ'[k]].value = L.pos[k]; A['forward' + 'XYZ'[k]].value = L.fwd[k]; A['up' + 'XYZ'[k]].value = L.up[k]; } }
    else if (A.setPosition) { A.setPosition(...L.pos); A.setOrientation(...L.fwd, ...L.up); }
  }
  // metres per second from two positions; a jump of more than 100 m/s is a teleport, not motion
  function velocity(out, p, q, dt, valid) {
    for (let k = 0; k < 3; k++) out[k] = valid && dt > 0 ? (p[k] - q[k]) / dt : 0;
    if (Math.hypot(out[0], out[1], out[2]) > 100) out[0] = out[1] = out[2] = 0;
  }
  function update(dt = 0, camera) {
    if (disposed) return;
    init();
    dt = clamp(dt || 0, 0, 0.25);
    time += dt; stats.time = time;
    if (camera) listener(camera, dt);
    // 1. clocks, fades, positions
    for (let i = live.length - 1; i >= 0; i--) {
      const v = live[i];
      let d = dt;
      if (v.wait > 0) { v.wait -= dt; d = v.wait < 0 ? -v.wait : 0; if (v.wait < 0) v.wait = 0; }
      if (d > 0) { v.t += d * v.rate * v.dop; if (!v.n) v.fresh = false; }   // it has run unheard: coming in now is a resume
      if (v.fade) {
        const k = v.fade.dur > 0 ? (time - v.fade.t0) / v.fade.dur : 1;
        v.level = k >= 1 ? v.fade.to : v.fade.from + (v.fade.to - v.fade.from) * k;
        if (k >= 1) { const done = v.fade.end; v.fade = null; if (done) { end(v, false); continue; } }
      }
      if (!v.loop && v.t >= v.dur) { end(v, true); continue; }
      if (v.pos) {
        posOf(v.at, np);
        velocity(v.vel, np, v.pos, dt, v.seen);
        v.pos[0] = np[0]; v.pos[1] = np[1]; v.pos[2] = np[2]; v.seen = true;
        v.dop = v.doppler ? dopplerRatio(v.pos, v.vel, L.pos, L.vel, speedOfSound, v.doppler) : 1;
      }
    }
    for (const v of live) hear(v);   // distances for the ray budget
    updateOcclusion(dt);
    if (mixer) updateZones();
    // 2. who sounds: the first `cap` by priority then loudness, and nothing below the silence threshold
    for (const v of live) hear(v);
    if (mixer) {
      const order = live.slice().sort((a, b) => (before(a, b) ? -1 : 1));
      let room = cap;
      const wake = [];
      for (const v of order) {
        const want = room > 0 && v.aud >= silent;
        if (want) room--;
        if (v.n && !want) { if (v.aud >= silent) stats.stolen++; else stats.culled++; if (v.mode === 'stop') end(v, false); else unrealise(v); }
        else if (!v.n && want) wake.push(v);
      }
      for (const v of wake) realise(v);   // after the cuts, so the count never passes the cap
      // 3. what the sounding voices sound like now
      const now = ctx.currentTime;
      for (const v of live) {
        const n = v.n;
        if (!n) continue;
        const rv = v.rate * v.dop;
        if (Math.abs(rv - n.rv) > 1e-4) { n.rv = rv; n.src.playbackRate.setTargetAtTime(rv, now, 0.03); }
        const R0 = n.lp ? occlusionResponse(v.occ, occ || undefined) : null;
        if (R0 && Math.abs(R0.freq - n.lf) > 1) { n.lf = R0.freq; n.lp.frequency.setTargetAtTime(R0.freq, now, 0.03); }
        if (n.dist) {
          const dv = v.att * (R0 ? R0.gain : 1);
          if (Math.abs(dv - n.dv) > 1e-4) { n.dv = dv; n.dist.gain.setTargetAtTime(dv, now, 0.03); }
          setXYZ(n.pan, 'position', v.pos, 0.03);
        }
        if (n.send) { const sv = sendGain(v); if (Math.abs(sv - n.sv) > 1e-3) { n.sv = sv; n.send.gain.setTargetAtTime(sv, now, 0.05); } }
      }
      stats.state = ctx.state || 'running';
    }
    for (const s of systems) s.update(dt);
    tally();
  }

  const engine = {
    stats, get ctx() { return ctx; }, get mixer() { init(); return mixer; }, get time() { return time; }, get ready() { return init(); },
    get voices() { return live.slice(); }, get cap() { return cap; }, set cap(n) { cap = n; }, get panning() { return panning; },
    get listenerPosition() { return L.pos; }, get rng() { return R; }, systems,
    /** make (or adopt) the context; call from a user gesture. With the legacy mixer, audio.unlock() does the same. */
    unlock() {
      if (disposed) return;
      if (audio) audio.unlock();
      else if (!ctx) { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (AC) ctx = own = new AC(); }
      if (ctx?.state === 'suspended') ctx.resume?.().catch?.(() => {});
      init();
      for (const s of streams) if (s.state === 'blocked') s.play();
    },
    whenReady, load, add, release, preload, unload, buffer: bufferOf, has: (name) => !!cache.get(name)?.buffer, stream,
    play, cue, zones: setZones, occlusion, listener, update,
    /** the bus `name` of the mixer (made on first use with a spec); null before the context exists */
    bus(name, spec) { return init() ? mixer.bus(name, spec) : null; },
    /** HRTF or equalpower for voices started from now on (voices that are sounding switch too) */
    setPanning(model) {
      panning = model;
      for (const v of live) if (v.n?.pan && !v.panning) { const h = model === 'HRTF'; if (h !== v.n.hrtf) { stats.hrtf += h ? 1 : -1; v.n.hrtf = h; v.n.pan.panningModel = model; } }
    },
    stopAll(sec = 0) { for (const v of live.slice()) v.stop(sec); },
    /** levels of every bus: { name: { peak, rms, peakDb, rmsDb } } */
    meters() { const o = {}; if (init()) for (const b of mixer.buses) o[b] = mixer.meter(b); return o; },
    dispose() {
      if (disposed) return;
      for (const v of live.slice()) end(v, false);
      for (const s of [...streams]) s.stop();
      for (const s of systems) s.dispose?.();
      disposed = true;
      waiting.length = 0; cache.clear(); groups.clear(); cues.clear(); systems.clear();
      if (mixer) {
        for (const r of returns.values()) { r.in.disconnect(); r.conv.disconnect(); }
        zoneIn.disconnect();
        const old = audio?.buses;
        if (old) for (const b of ['music', 'sfx', 'ambience']) { mixer.bus(b).setTail(null); old[b].disconnect(); old[b].connect(old.master); }   // the legacy mixer as it was
        mixer.dispose();
      }
      if (audio) audio.route = null;
      if (own && own.state !== 'closed') own.close?.();
      mixer = null;
    },
  };
  if (opts.zones) setZones(opts.zones, opts.zoneOptions);
  if (opts.occlusion) occlusion(opts.occlusion);
  for (const [name, spec] of Object.entries(opts.cues || {})) cue(name, spec);
  init();
  return engine;
}

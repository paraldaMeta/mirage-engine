// Mirage original code. A mixer graph on Web Audio nodes: a tree of buses, an effect chain on each bus (EQ, filters,
// compressor / limiter, delay, convolution reverb whose impulse response is made in code, drive, pan), sends between
// buses, snapshots blended over time, side-chain ducking that runs at audio rate, and meters. It takes any
// BaseAudioContext, so an OfflineAudioContext renders the same graph for exact checks.
// ---------------------------------------------------------------------------
// const mixer = createMixer(ctx);                               'master' exists and goes to ctx.destination
// mixer.bus('music', { parent: 'master', gain: 0.8, effects: [{ id: 'lp', type: 'lowpass', freq: 20000 }] });
// mixer.bus('reverb', { effects: [{ type: 'reverb', preset: 'hall', wet: 1, dry: 0 }] });
// mixer.bus('sfx', { sends: { reverb: 0.25 } });               post-fader; { reverb: { gain: 0.25, pre: true } } before it
// mixer.bus('music').input                                      connect sources here
// mixer.bus('music').gain(0.5, 2)                               over 2 s        .effect('lp').set({ freq: 800 }, 1)
// mixer.snapshot('indoors', { music: { gain: 0.4, lp: { freq: 900 } }, sfx: { sends: { reverb: 0.6 } } });
// mixer.transition('indoors', 1.5)        mixer.transition({ indoors: 0.3, default: 0.7 }, 0.2)   weights blend
// mixer.duck('music', 'dialogue', { amount: 0.25, threshold: 0.02, attack: 0.05, release: 0.5 })   -> { remove() }
// mixer.meter('music') -> { peak, rms, peakDb, rmsDb }          mixer.dispose()
// Effect types: eq (low / mid / high, or bands), lowpass highpass bandpass notch peaking lowshelf highshelf,
// compressor, limiter, delay, reverb, drive, pan, gain. Every effect also takes wet, dry, mix and bypass.
// ponytail: the reverb's impulse response and the drive curve change in one step (no cross-fade between two
// convolvers); ducking follows the level of the whole key bus with one smoothing filter pair, not a look-ahead
// compressor; snapshot blends are linear in the value (frequencies ramp exponentially in time, but weights mix
// them linearly); no per-bus latency compensation.
// ---------------------------------------------------------------------------
import { dbToGain, gainToDb, impulseResponse, reverbParams } from './audio-dsp.js';

const irCache = new Map();   // impulse responses by parameters: zones and buses with the same room share the samples
/** the AudioBuffer of an impulse response (predelay is left to a DelayNode, so it can change without a rebuild) */
export function reverbBuffer(ctx, params) {
  const p = { ...reverbParams(params), predelay: 0, sampleRate: ctx.sampleRate };
  const key = JSON.stringify([p.seconds, p.decay, p.damping, p.early, p.width, p.seed, p.sampleRate]);
  let ir = irCache.get(key);
  if (!ir) {
    if (irCache.size >= 24) irCache.delete(irCache.keys().next().value);
    irCache.set(key, ir = impulseResponse(p));
  }
  const b = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
  b.getChannelData(0).set(ir[0]); b.getChannelData(1).set(ir[1]);
  return b;
}

/** Parameter moves that start from where the value really is. Web Audio ramps start at the previous event, however old,
 *  and param.value is not kept up to date before an offline render, so the last move of each param is remembered here. */
export function createRamps(ctx) {
  const last = new WeakMap();
  const valueAt = (p, t) => {
    const a = last.get(p);
    if (!a) return p.value;
    if (t >= a.t1) return a.v1;
    const k = (t - a.t0) / (a.t1 - a.t0);
    return a.exp ? a.v0 * (a.v1 / a.v0) ** k : a.v0 + (a.v1 - a.v0) * k;
  };
  /** move p to v over sec seconds from now (0: at once); exp: a ramp in octaves, for frequencies */
  function ramp(p, v, sec = 0, exp = false) {
    const t = ctx.currentTime, cur = valueAt(p, t);
    p.cancelScheduledValues(t);
    p.setValueAtTime(cur, t);
    const e = exp && cur > 0 && v > 0;
    if (sec > 0) { if (e) p.exponentialRampToValueAtTime(v, t + sec); else p.linearRampToValueAtTime(v, t + sec); } else p.setValueAtTime(v, t);
    last.set(p, { v0: cur, t0: t, v1: v, t1: t + Math.max(sec, 0), exp: e });
  }
  ramp.valueAt = valueAt;
  return ramp;
}

const BIQUADS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass'];
export const EFFECT_TYPES = ['eq', ...BIQUADS, 'compressor', 'limiter', 'delay', 'reverb', 'drive', 'pan', 'gain'];

export function createMixer(ctx, { output = ctx.destination } = {}) {
  const ramp = createRamps(ctx);
  const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const buses = new Map(), snapshots = new Map([['default', new Map()]]), base = new Map(), controls = new Map(), ducks = new Set();
  let active = { default: 1 }, disposed = false;
  const stats = { buses: 0, effects: 0, ducks: 0 };

  // ---- effects: input -> [process] -> wet -> output, input -> dry -> output --------------------------------
  function makeEffect(spec) {
    const type = spec.type, id = spec.id || type;
    if (!EFFECT_TYPES.includes(type)) throw new Error(`audio mixer: unknown effect type "${type}" (${EFFECT_TYPES.join(', ')})`);
    const input = G(), outNode = G(), wet = G(), dry = G(0);
    input.connect(dry); dry.connect(outNode); wet.connect(outNode);
    const P = {}, own = [input, outNode, wet, dry], init = {};
    const par = (name, p, value, o = {}) => { P[name] = { p, value, ...o }; init[name] = value; };
    const biquad = (t, f, q, g) => { const b = ctx.createBiquadFilter(); b.type = t; b.frequency.value = f; b.Q.value = q; b.gain.value = g; own.push(b); return b; };
    let head, tail, wet0 = 1, dry0 = 0;
    if (type === 'eq') {
      const bands = spec.bands || [
        { name: 'low', type: 'lowshelf', freq: spec.lowFreq ?? 250, gain: 0 },
        { name: 'mid', type: 'peaking', freq: spec.midFreq ?? 1200, q: spec.midQ ?? 0.8, gain: 0 },
        { name: 'high', type: 'highshelf', freq: spec.highFreq ?? 4000, gain: 0 }];
      bands.forEach((b, i) => {
        const f = biquad(b.type || 'peaking', b.freq ?? 1000, b.q ?? 1, b.gain ?? 0), n = b.name || 'b' + i;
        if (tail) tail.connect(f); else head = f;
        tail = f;
        par(n, f.gain, b.gain ?? 0); par(n + 'Freq', f.frequency, b.freq ?? 1000, { exp: true }); par(n + 'Q', f.Q, b.q ?? 1);
      });
    } else if (BIQUADS.includes(type)) {
      // Web Audio's low/high-pass Q is in dB of resonance: -3 is the flat (Butterworth) corner
      head = tail = biquad(type, 1000, type === 'lowpass' || type === 'highpass' ? -3 : 1, 0);
      par('freq', head.frequency, type === 'lowpass' ? 20000 : type === 'highpass' ? 20 : 1000, { exp: true });
      par('q', head.Q, head.Q.value); par('gain', head.gain, 0);
    } else if (type === 'compressor' || type === 'limiter') {
      const c = ctx.createDynamicsCompressor(), m = G(), lim = type === 'limiter';
      c.connect(m); head = c; tail = m; own.push(c, m);
      par('threshold', c.threshold, lim ? -3 : -24); par('knee', c.knee, lim ? 0 : 12); par('ratio', c.ratio, lim ? 20 : 4);
      par('attack', c.attack, lim ? 0.002 : 0.01); par('release', c.release, lim ? 0.08 : 0.25);
      par('makeup', m.gain, 0, { map: dbToGain });
      P.reduction = { read: () => c.reduction };   // dB of gain reduction right now (0 or negative)
    } else if (type === 'delay') {
      const d = ctx.createDelay(spec.maxTime ?? 2), damp = biquad('lowpass', 6000, -3, 0), fb = G(0);
      d.connect(damp); damp.connect(fb); fb.connect(d); head = tail = d; own.push(d, fb);
      par('time', d.delayTime, 0.3); par('feedback', fb.gain, 0.35, { map: (v) => Math.min(Math.max(v, 0), 0.95) });
      par('damp', damp.frequency, 6000, { exp: true });
      wet0 = 0.35; dry0 = 1;
    } else if (type === 'reverb') {
      const pre = ctx.createDelay(1), conv = ctx.createConvolver();
      conv.normalize = false;   // impulseResponse is already normalised; Chrome's own scaling would change the level per room
      pre.connect(conv); head = pre; tail = conv; own.push(pre, conv);
      const room = { ...reverbParams(spec.preset ? { preset: spec.preset } : null) };
      let dirty = true;
      const shape = (k) => { P[k] = { value: room[k], apply(v) { room[k] = v; dirty = true; } }; };
      for (const k of ['seconds', 'decay', 'damping', 'early', 'width', 'seed']) shape(k);
      P.preset = { value: spec.preset || 'room', apply(v) { Object.assign(room, reverbParams(v)); for (const k of ['seconds', 'decay', 'damping', 'early', 'width']) P[k].value = room[k]; dirty = true; } };
      par('predelay', pre.delayTime, room.predelay);
      P.$flush = () => { if (dirty) { dirty = false; conv.buffer = reverbBuffer(ctx, room); } };
      wet0 = 0.3; dry0 = 1;
    } else if (type === 'drive') {
      const pre = G(), sh = ctx.createWaveShaper(), post = G();
      const N = 1025, curve = new Float32Array(N);
      for (let i = 0; i < N; i++) curve[i] = Math.tanh((i / (N - 1)) * 2 - 1) / Math.tanh(1);
      sh.curve = curve; sh.oversample = '2x';
      pre.connect(sh); sh.connect(post); head = pre; tail = post; own.push(pre, sh, post);
      // amount 0..1: gain into the tanh curve, and the inverse after it so the level stays about where it was
      P.amount = { value: 0.5, apply(v, sec) { const g = 1 + 9 * Math.min(Math.max(v, 0), 1); ramp(pre.gain, g, sec); ramp(post.gain, 1 / Math.sqrt(g), sec); } };
      init.amount = 0.5;
    } else if (type === 'pan') {
      head = tail = ctx.createStereoPanner(); own.push(head); par('pan', head.pan, 0);
    } else { head = tail = G(); own.push(head); par('gain', head.gain, 1); }
    input.connect(head); tail.connect(wet);
    par('wet', wet.gain, wet0); par('dry', dry.gain, dry0);
    let bypassed = false;
    const fx = {
      id, type, input, output: outNode, params: P, get bypassed() { return bypassed; },
      /** values by parameter name; sec: seconds to get there (shape parameters of the reverb change at once) */
      set(values, sec = 0) {
        for (const [k, v0] of Object.entries(values)) {
          if (k === 'type' || k === 'id' || k === 'bands' || k === 'maxTime' || v0 === undefined) continue;
          if (k === 'mix') { fx.set({ wet: v0, dry: 1 - v0 }, sec); continue; }
          if (k === 'bypass') { bypassed = !!v0; ramp(wet.gain, bypassed ? 0 : P.wet.value, 0.02); ramp(dry.gain, bypassed ? 1 : P.dry.value, 0.02); continue; }
          const d = P[k];
          if (!d || k[0] === '$' || d.read) { throw new Error(`audio mixer: effect "${id}" (${type}) has no parameter "${k}" (${Object.keys(P).filter((n) => n[0] !== '$').join(', ')})`); }
          d.value = v0;
          if (d.apply) d.apply(v0, sec);
          else if (!(bypassed && (k === 'wet' || k === 'dry'))) ramp(d.p, d.map ? d.map(v0) : v0, sec, d.exp);
        }
        P.$flush?.();
        return fx;
      },
      get(name) { const d = P[name]; return d ? (d.read ? d.read() : d.value) : undefined; },
      dispose() { for (const n of own) n.disconnect(); },
    };
    // the preset is already in `room`; everything else the spec names goes through set (which throws on a typo)
    const first = { ...init };
    for (const k of Object.keys(spec)) if (k !== 'preset' && !/^(low|mid|high)(Freq|Q)$/.test(k)) first[k] = spec[k];
    fx.set(first);
    stats.effects++;
    return fx;
  }

  // ---- buses ---------------------------------------------------------------------------------------------
  const control = (key, value, apply) => { controls.set(key, apply); base.set(key, value); };
  function makeBus(name, spec = {}) {
    const input = G(), post = G(), fader = G(spec.gain ?? 1), out = G();
    post.connect(fader); fader.connect(out);
    const chain = [], gates = [], sends = new Map();
    let parent = null, tail = null, analyser = null, data = null, muted = false;
    const wire = () => {
      // effects are wired inside; link each stage's last node to the next stage's first
      const outs = [input, ...chain.map((f) => f.output), ...gates], ins = [...chain.map((f) => f.input), ...gates, post];
      for (let i = 0; i < outs.length; i++) { outs[i].disconnect(); outs[i].connect(ins[i]); }
    };
    const b = {
      name, input, output: out, fader, post, get parent() { return parent; }, get effects() { return chain.slice(); }, get muted() { return muted; },
      /** the fader: v over sec seconds; without arguments, the value last asked for */
      gain(v, sec = 0) { if (v === undefined) return base.get(name + '.gain'); base.set(name + '.gain', v); ramp(fader.gain, v, sec); return b; },
      mute(on = true) { muted = !!on; ramp(out.gain, muted ? 0 : 1, 0.02); return b; },
      route(to) {
        if (name === 'master') throw new Error('audio mixer: master has no parent');
        const p = get(to);
        for (let q = p; q; q = q.parent && buses.get(q.parent)) if (q === b) throw new Error(`audio mixer: routing "${name}" into "${to}" would make a loop`);
        if (parent) out.disconnect(buses.get(parent).input);
        parent = to; out.connect(p.input);
        return b;
      },
      effect(id) { return chain.find((f) => f.id === id) || null; },
      /** append (or insert at index) an effect; the id defaults to the type and must be unique on the bus */
      addEffect(fxSpec, index = chain.length) {
        const fx = makeEffect(fxSpec);
        if (b.effect(fx.id)) { fx.dispose(); stats.effects--; throw new Error(`audio mixer: bus "${name}" already has an effect "${fx.id}"; give this one an id`); }
        chain.splice(index, 0, fx); wire();
        const set = fx.set;   // snapshots move the effect through this one; the host's own calls also become the default
        for (const [k, d] of Object.entries(fx.params)) if (k[0] !== '$' && !d.read) control(`${name}.${fx.id}.${k}`, d.value, (v, sec) => set({ [k]: v }, sec));
        fx.set = (values, sec) => { for (const [k, v] of Object.entries(values)) if (base.has(`${name}.${fx.id}.${k}`)) base.set(`${name}.${fx.id}.${k}`, v); return set(values, sec); };
        return fx;
      },
      removeEffect(id) {
        const i = chain.findIndex((f) => f.id === id);
        if (i < 0) return false;
        const [fx] = chain.splice(i, 1);
        wire(); fx.dispose(); stats.effects--;
        for (const k of [...controls.keys()]) if (k.startsWith(`${name}.${id}.`)) { controls.delete(k); base.delete(k); }
        return true;
      },
      /** a send to another bus: gain 0 keeps it (snapshots can open it); pre: taken before the fader */
      send(to, gain = 1, { pre = false } = {}) {
        const target = get(to), key = `${name}>${to}`;
        for (let q = target; q; q = q.parent && buses.get(q.parent)) if (q === b) throw new Error(`audio mixer: a send from "${name}" to "${to}" would feed back into itself`);
        let s = sends.get(to);
        if (!s) {
          s = { node: G(gain), pre };
          (pre ? post : out).connect(s.node); s.node.connect(target.input);
          sends.set(to, s);
          controls.set(key, (v, sec) => ramp(s.node.gain, v, sec));
        } else ramp(s.node.gain, gain, 0.02);
        base.set(key, gain);
        return b;
      },
      /** level of the bus after its fader: linear and dB, over the last ~21 ms (the analyser is made on first use) */
      meter() {
        if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 1024; data = new Float32Array(1024); out.connect(analyser); }
        analyser.getFloatTimeDomainData(data);
        let pk = 0, s = 0;
        for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > pk) pk = a; s += a * a; }
        const r = Math.sqrt(s / data.length);
        return { peak: pk, rms: r, peakDb: gainToDb(pk), rmsDb: gainToDb(r) };
      },
      /** a node of the host's between the fader and the output (the legacy mixer's volume gain) */
      setTail(node) {
        if (tail) { fader.disconnect(tail); tail.disconnect(out); } else fader.disconnect(out);
        tail = node || null;
        if (tail) { fader.connect(tail); tail.connect(out); } else fader.connect(out);
      },
      _gate(g, on) { if (on) gates.push(g); else gates.splice(gates.indexOf(g), 1); wire(); },
      _dispose() {
        for (const f of chain) f.dispose();
        for (const s of sends.values()) s.node.disconnect();
        for (const n of [input, post, fader, out, analyser, ...gates]) n?.disconnect();
      },
    };
    buses.set(name, b); stats.buses++;
    controls.set(name + '.gain', (v, sec) => ramp(fader.gain, v, sec)); base.set(name + '.gain', spec.gain ?? 1);
    wire();
    if (name === 'master') out.connect(output); else b.route(spec.parent || 'master');
    return b;
  }
  const get = (name) => { const b = buses.get(name); if (!b) throw new Error(`audio mixer: no bus "${name}" (${[...buses.keys()].join(', ')})`); return b; };
  function applySpec(b, spec) {
    for (const fx of spec.effects || []) if (!b.effect(fx.id || fx.type)) b.addEffect(fx);
    for (const [to, s] of Object.entries(spec.sends || {})) { if (typeof s === 'number') b.send(to, s); else b.send(to, s.gain ?? 1, s); }
  }

  // ---- snapshots -----------------------------------------------------------------------------------------
  // { bus: { gain, effectId: { param: value }, sends: { to: gain } } } -> 'bus.gain', 'bus.effectId.param', 'bus>to'
  function flatten(values) {
    const m = new Map();
    for (const [bus, v] of Object.entries(values)) for (const [k, x] of Object.entries(v)) {
      if (k === 'gain') m.set(`${bus}.gain`, x);
      else if (k === 'sends') for (const [to, g] of Object.entries(x)) m.set(`${bus}>${to}`, g);
      else for (const [p, y] of Object.entries(x)) { if (p === 'mix') { m.set(`${bus}.${k}.wet`, y); m.set(`${bus}.${k}.dry`, 1 - y); } else m.set(`${bus}.${k}.${p}`, y); }
    }
    return m;
  }

  const mixer = {
    ctx, stats, ramp,
    get buses() { return [...buses.keys()]; }, get snapshots() { return [...snapshots.keys()]; }, get active() { return { ...active }; },
    has: (name) => buses.has(name),
    /** the bus `name`, made on first use; a spec on an existing bus adds what it does not have yet */
    bus(name, spec) {
      let b = buses.get(name);
      if (!b) { if (!spec && name !== 'master') get(name); b = makeBus(name, spec || {}); }
      else if (spec && spec.gain !== undefined) b.gain(spec.gain);
      if (spec) applySpec(b, spec);
      return b;
    },
    snapshot(name, values) {
      if (name === 'default') throw new Error('audio mixer: "default" is the mix as it was set up; name the snapshot something else');
      snapshots.set(name, flatten(values));
      return mixer;
    },
    /** to one snapshot, or to a weighted blend { name: weight }; every value a snapshot does not name is the default's */
    transition(target, seconds = 0.5) {
      const w = typeof target === 'string' ? { [target]: 1 } : target;
      let sum = 0;
      for (const [n, x] of Object.entries(w)) { if (!snapshots.has(n)) throw new Error(`audio mixer: no snapshot "${n}"`); sum += x; }
      if (!(sum > 0)) throw new Error('audio mixer: snapshot weights add up to nothing');
      const keys = new Set();
      for (const s of snapshots.values()) for (const k of s.keys()) keys.add(k);
      for (const k of keys) {
        const apply = controls.get(k);
        if (!apply) continue;   // a snapshot may name a bus or effect that is not there (yet)
        let v = 0;
        for (const [n, x] of Object.entries(w)) v += (x / sum) * (snapshots.get(n).get(k) ?? base.get(k));
        apply(v, seconds);
      }
      active = Object.fromEntries(Object.entries(w).map(([n, x]) => [n, x / sum]));
      return mixer;
    },
    /** `target` goes down to `amount` (a gain) while `source` is louder than `threshold` (its mean absolute level). All
     *  of it runs in the audio graph: rectifier -> smoothing -> soft gate -> fast attack / slow release -> the gain. */
    duck(target, source, { amount = 0.25, threshold = 0.02, knee = 3, attack = 0.05, release = 0.5 } = {}) {
      const T = get(target), S = get(source);
      const N = 8193, abs = new Float32Array(N), gate = new Float32Array(N);
      const hi = threshold * Math.max(knee, 1.01);
      for (let i = 0; i < N; i++) {
        const x = Math.abs((i / (N - 1)) * 2 - 1), k = Math.min(Math.max((x - threshold) / (hi - threshold), 0), 1);
        abs[i] = x; gate[i] = k * k * (3 - 2 * k);
      }
      const shaper = (curve) => { const s = ctx.createWaveShaper(); s.curve = curve; return s; };
      const lp = (hz) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hz; f.Q.value = -6.02; return f; };   // critically damped: a Butterworth step overshoots 4 %, which would duck past amount
      const mono = G(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
      const rect = shaper(abs), env = lp(25), open = shaper(gate), fast = lp(0.35 / Math.max(attack, 0.002)), slow = lp(0.35 / Math.max(release, 0.01));
      // max(fast, slow) = (fast + slow + |fast - slow|) / 2: the quick filter opens it, the slow one holds it
      const neg = G(-1), diff = G(), dabs = shaper(abs), depth = G(-(1 - amount) / 2), g = G(1);
      S.output.connect(mono); mono.connect(rect); rect.connect(env); env.connect(open); open.connect(fast); open.connect(slow);
      fast.connect(depth); slow.connect(depth);
      fast.connect(diff); slow.connect(neg); neg.connect(diff); diff.connect(dabs); dabs.connect(depth);
      depth.connect(g.gain);
      T._gate(g, true);
      const nodes = [mono, rect, env, open, fast, slow, neg, diff, dabs, depth];
      const d = { target, source, amount, remove() {
        if (!ducks.delete(d)) return;
        S.output.disconnect(mono); for (const n of nodes) n.disconnect();
        T._gate(g, false); g.disconnect(); stats.ducks--;
      } };
      ducks.add(d); stats.ducks++;
      return d;
    },
    meter: (name) => get(name).meter(),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const d of [...ducks]) d.remove();
      for (const b of buses.values()) b._dispose();
      buses.clear(); controls.clear();
    },
  };
  mixer.bus('master');
  return mixer;
}

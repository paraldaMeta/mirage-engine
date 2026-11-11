// Mirage original code. Adaptive music for the audio engine: sections made of stems (layers) that loop together,
// transitions that land on the next beat or bar of the playing section, cross-fades, stingers, and stem levels that
// follow the game. Everything is scheduled on the audio clock with start(time), so a transition lands on the sample.
// ---------------------------------------------------------------------------
// const music = createMusic(engine, { bpm: 96, beatsPerBar: 4, bus: 'music', sections: {
//   calm:   { bars: 4, stems: { pad: 'pad_a', pulse: { sound: 'pulse_a', gain: 0.6 } } },
//   battle: { bars: 2, stems: { pad: 'pad_b', drums: 'drums_b' }, bpm: 120 } } });
// music.play('calm')                                    starts now (or when the context is unlocked)
// music.to('battle', { quantize: 'bar', fade: 0.4, stinger: 'hit' })    -> the audio time it will happen at
// music.layer('drums', 0, 1.5)                          a stem's level (kept across sections that have the stem)
// music.stop(2)        music.section   music.position -> { bar, beat, phase, time }      music.onBeat = (beat, bar) => {}
// quantize: 'bar' (default), 'beat', 'end' (when the section's loop comes round), 'now'.
// ponytail: tempo is fixed within a section (no tempo maps, no time-signature changes mid-section); stems are whole
// loops of `bars` bars decoded in memory, not streams; one transition can be pending, a new to() replaces it; music
// follows the audio clock, not the dt given to engine.update (a paused game does not pause it: call music.stop).
// ---------------------------------------------------------------------------
export function createMusic(engine, { bpm = 120, beatsPerBar = 4, bus = 'music', sections = {}, gain = 1 } = {}) {
  const levels = new Map();          // stem name -> level set by layer()
  const old = [];                    // sections fading out: disconnected once they are silent
  let cur = null, next = null, out = null, lastBeat = -1, stopped = true, want = null;
  const S = (name) => { const s = sections[name]; if (!s) throw new Error(`music: no section "${name}" (${Object.keys(sections).join(', ')})`); return s; };
  const beatOf = (s) => 60 / (s.bpm || bpm), barOf = (s) => beatOf(s) * (s.beatsPerBar || beatsPerBar);
  const ctx = () => engine.ctx;
  function output() {
    if (!out) { out = ctx().createGain(); out.gain.value = gain; out.connect(engine.bus(engine.mixer.has(bus) ? bus : 'music').input); }
    return out;
  }
  // every stem of a section on one start time; each has its own gain (the layer level) under a section gain (the fade)
  function build(name, at, fade) {
    const s = S(name), c = ctx(), g = c.createGain(), stems = {};
    if (fade > 0) { g.gain.value = 0; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + fade); }
    g.connect(output());
    const len = s.bars ? s.bars * barOf(s) : 0;
    for (const [stem, def] of Object.entries(s.stems)) {
      const d = typeof def === 'object' && def && def.sound !== undefined ? def : { sound: def };
      const buffer = typeof d.sound === 'string' ? engine.buffer(d.sound) : d.sound;
      if (!buffer) throw new Error(`music: section "${name}" stem "${stem}": sound ${d.sound} is not loaded`);
      const src = c.createBufferSource(), sg = c.createGain(), base = d.gain ?? 1;
      src.buffer = buffer; src.loop = s.loop !== false;
      if (len && len <= buffer.duration) { src.loopStart = 0; src.loopEnd = len; }   // loop on the bar line, not on the file's tail
      sg.gain.value = base * (levels.get(stem) ?? d.level ?? 1);
      src.connect(sg); sg.connect(g); src.start(at);
      stems[stem] = { src, g: sg, base };
    }
    return { name, s, g, stems, at };
  }
  function drop(sec, at, fade) {
    const c = ctx(), now = c.currentTime, t = Math.max(at, now);
    sec.g.gain.cancelScheduledValues(now);
    if (fade > 0) { sec.g.gain.setValueAtTime(1, t); sec.g.gain.linearRampToValueAtTime(0, t + fade); } else sec.g.gain.setValueAtTime(0, t);
    for (const st of Object.values(sec.stems)) { try { st.src.stop(t + fade + 0.01); } catch { /* not started */ } }
    sec.gone = t + fade + 0.05;
  }
  const free = (sec) => { for (const st of Object.values(sec.stems)) { st.src.disconnect(); st.g.disconnect(); } sec.g.disconnect(); };
  function boundary(quantize, now) {
    if (!cur || quantize === 'now') return now;
    const unit = quantize === 'beat' ? beatOf(cur.s) : quantize === 'end' && cur.s.bars ? cur.s.bars * barOf(cur.s) : barOf(cur.s);
    // 5 ms of margin: a boundary that is already upon us cannot be scheduled any more, take the next one
    return cur.at + Math.max(Math.ceil((now + 0.005 - cur.at) / unit), 0) * unit;
  }
  const music = {
    sections, get section() { return cur?.name || null; }, get pending() { return next?.name || null; }, get playing() { return !stopped; }, onBeat: null, onSection: null,
    /** where the playing section is: whole bars and beats since it started, phase 0..1 within the beat */
    get position() {
      if (!cur || !ctx()) return { bar: 0, beat: 0, phase: 0, time: 0 };
      const t = Math.max(ctx().currentTime - cur.at, 0), b = t / beatOf(cur.s), n = cur.s.beatsPerBar || beatsPerBar;
      return { bar: Math.floor(b / n), beat: Math.floor(b) % n, phase: b - Math.floor(b), time: t };
    },
    play(name, o = {}) { return music.to(name, { quantize: 'now', fade: 0, ...o }); },
    /** go to a section on the next boundary; returns the audio time of the change (null while the context is locked) */
    to(name, { quantize = 'bar', fade = 0.25, stinger = null, stingerGain = 1 } = {}) {
      S(name);
      stopped = false;
      if (!engine.ready) {
        const first = !want;
        want = [name, { quantize: 'now', fade, stinger, stingerGain }];
        if (first) engine.whenReady(() => { if (want) { const w = want; want = null; music.to(...w); } });
        return null;
      }
      const c = ctx(), now = c.currentTime;
      music.update();
      if (next) {   // replace the pending change: silence what was scheduled, give the playing section its level back
        for (const st of Object.values(next.stems)) { try { st.src.stop(); } catch { /* not started */ } }
        free(next); next.sting?.stop?.();
        if (cur) { cur.g.gain.cancelScheduledValues(now); cur.g.gain.setValueAtTime(1, now); for (const st of Object.values(cur.stems)) { try { st.src.stop(1e9); } catch { /* ended */ } } }
        next = null;
      }
      const at = boundary(quantize, now);
      next = build(name, at, cur ? fade : 0);
      if (cur) { drop(cur, at, fade); next.from = cur; }
      // the stinger covers the join: it starts on the boundary itself
      if (stinger) next.sting = engine.play(stinger, { bus, gain: stingerGain, delay: Math.max(at - now, 0), priority: 255, virtual: 'stop' });
      if (at <= now) music.update();
      return at;
    },
    /** the level of a stem, in every section that has one of that name, over `fade` seconds */
    layer(stem, level, fade = 0.5) {
      levels.set(stem, level);
      for (const sec of [cur, next]) { const st = sec?.stems[stem]; if (st) engine.mixer.ramp(st.g.gain, st.base * level, fade); }
      return music;
    },
    stop(fade = 0.5) {
      want = null; stopped = true;
      if (!ctx()) return;
      const now = ctx().currentTime;
      for (const sec of [cur, next]) if (sec) { drop(sec, now, fade); old.push(sec); }
      cur = next = null; lastBeat = -1;
    },
    /** called by engine.update: hands over at the boundary, reports beats, frees what has faded out */
    update() {
      const c = ctx();
      if (!c) return;
      const now = c.currentTime;
      if (next && now >= next.at) { if (next.from) old.push(next.from); cur = next; cur.from = null; next = null; lastBeat = -1; music.onSection?.(cur.name); }
      for (let i = old.length - 1; i >= 0; i--) if (now >= old[i].gone) { free(old[i]); old.splice(i, 1); }
      if (cur && music.onBeat) {
        const b = Math.floor((now - cur.at) / beatOf(cur.s)), n = cur.s.beatsPerBar || beatsPerBar;
        if (b > lastBeat) { lastBeat = b; music.onBeat(b % n, Math.floor(b / n), cur.name); }
      }
    },
    dispose() { music.stop(0); for (const s of old.splice(0)) free(s); engine.systems.delete(music); out?.disconnect(); out = null; },
  };
  engine.systems.add(music);
  return music;
}

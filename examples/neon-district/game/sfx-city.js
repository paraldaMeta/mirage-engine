// The sounds of the city as a weapon, made in code like sfx.js and given to the mixer (audio.add) once it exists
// (the first gesture): the hack's ring and its landing, a power-down and a power-up, an EMP, a car alarm, the
// dash, the throw, the overdrive, the robots' radio blip (their voice), and the new jobs' tells: the marksman's
// charge and shot, the warden's whine, a shield taking a round and breaking, a head shot, an ammo cell.
const TAU = Math.PI * 2;

export function addCitySounds(audio) {
  const ctx = audio.ctx, SR = ctx.sampleRate, B = new Proxy({}, { set: (o, k, v) => { audio.add(k, v); return true; } });
  let seed = 0x6a09e667;
  const rnd = () => ((seed = (seed ^ (seed << 13)) >>> 0, seed = (seed ^ (seed >>> 17)) >>> 0, seed = (seed ^ (seed << 5)) >>> 0) / 4294967296);
  const noise = () => rnd() * 2 - 1;
  const lp = (a) => { let y = 0; return (x) => (y += a * (x - y)); };
  const sat = Math.tanh;
  const buf = (sec, fn) => { const b = ctx.createBuffer(1, Math.ceil(sec * SR), SR); fn(b.getChannelData(0)); return b; };
  const each = (sec, fn) => buf(sec, (d) => { for (let i = 0; i < d.length; i++) d[i] = fn(i / SR, i); });
  // the hack: a soft rising chirp while the ring fills (played once at the start), a two-note landing, a refusal
  B.nd_hack = each(0.8, (t) => Math.sin(TAU * (600 * t + 900 * t * t)) * 0.12 * Math.min(1, t * 20) * (0.6 + 0.4 * Math.sin(TAU * 18 * t)));
  B.nd_hacked = each(0.35, (t) => (Math.sin(TAU * 1320 * t) * (t < 0.1 ? 1 : 0) + Math.sin(TAU * 1980 * t) * (t >= 0.1 ? 1 : 0)) * Math.exp(-Math.max(0, t - 0.1) / 0.08) * 0.3);
  B.nd_denied = each(0.3, (t) => sat(Math.sin(TAU * 180 * t) * 3) * 0.18 * (t < 0.12 || (t > 0.16 && t < 0.28) ? 1 : 0));
  // the power going: a falling hum and a thunk; coming back: a rising hum
  B.nd_dark = (() => { const l = lp(0.1); return each(1.2, (t) => (Math.sin(TAU * (120 * Math.exp(-t * 2.2) + 30) * t) * 0.5 + l(noise()) * 0.6 * Math.exp(-t / 0.05)) * Math.exp(-t / 0.5) * 0.6); })();
  B.nd_power = each(1.0, (t) => Math.sin(TAU * (60 + 70 * t) * t) * 0.3 * Math.min(1, t * 4) * Math.exp(-Math.max(0, t - 0.6) / 0.15) + Math.sin(TAU * 7800 * t) * 0.01);
  // an EMP: a deep thump, a crackle, a falling whine
  B.nd_emp = (() => { const l = lp(0.3); return each(1.3, (t) => sat(Math.sin(TAU * 55 * t) * 2 * Math.exp(-t / 0.25) + (noise() - l(noise())) * 0.8 * Math.exp(-t / 0.18) * (rnd() < 0.3 ? 1 : 0.2) + Math.sin(TAU * (2400 * Math.exp(-t * 2) + 200) * t) * 0.25 * Math.exp(-t / 0.5)) * 0.6); })();
  // a car alarm: two tones, alternating (a pass is 0.8 s)
  B.nd_caralarm = each(0.8, (t) => sat(Math.sin(TAU * ((t % 0.4) < 0.2 ? 880 : 660) * t) * 2.5) * 0.2);
  // the dash: a whoosh; the throw: a short swish and a click; the grenade's bounce tick
  B.nd_dash = (() => { const a = lp(0.25), b = lp(0.05); return each(0.35, (t) => (a(noise()) - b(noise())) * Math.sin(Math.PI * t / 0.35) * 1.2); })();
  B.nd_throw = (() => { const a = lp(0.3); return each(0.25, (t) => a(noise()) * Math.sin(Math.PI * Math.min(1, t / 0.18)) * 0.5 + (t > 0.2 ? Math.sin(TAU * 2600 * t) * Math.exp(-(t - 0.2) / 0.01) * 0.3 : 0)); })();
  // the overdrive: a rising sweep with a beat
  B.nd_overdrive = each(1.4, (t) => sat((Math.sin(TAU * (110 + 220 * t) * t) + 0.5 * Math.sin(TAU * (220 + 440 * t) * t)) * 1.5) * 0.25 * Math.min(1, t * 6) * Math.exp(-Math.max(0, t - 1) / 0.2));
  // the robots' voice: a burst of modulated square blips (three pitches, story.js picks by speaker)
  B.nd_blip = [0, 1, 2].map((v) => each(0.42, (t) => { const f = [520, 680, 410][v] * (1 + 0.25 * Math.sign(Math.sin(TAU * (9 + v * 2) * t))); return Math.sign(Math.sin(TAU * f * t)) * 0.07 * (Math.floor(t * 22) % 3 !== 2 ? 1 : 0) * Math.min(1, (0.42 - t) * 20); }));
  // the marksman: a rising charge, then a heavy crack with a long tail
  B.nd_charge = each(1.25, (t) => Math.sin(TAU * (300 * t + 700 * t * t)) * 0.2 * Math.min(1, t * 3) * (0.7 + 0.3 * Math.sin(TAU * (8 + 20 * t) * t)));
  B.nd_snipe = (() => { const l = lp(0.05); return each(1.0, (t) => sat((noise() * Math.exp(-t / 0.006) * 1.5 + Math.sin(TAU * (900 * Math.exp(-t / 0.03) + 70) * t) * Math.exp(-t / 0.12) + l(noise()) * 2 * Math.exp(-t / 0.35)) * 1.3) * 0.8); })();
  // the warden's wind-up: a whine that climbs for 0.8 s
  B.nd_warn = each(0.85, (t) => sat(Math.sin(TAU * (400 * t + 900 * t * t)) * 2) * 0.22 * Math.min(1, t * 8) * (0.65 + 0.35 * Math.sign(Math.sin(TAU * 14 * t))));
  // a shield taking a round (a glassy ping), a shield breaking (a crash and a falling shimmer), a head shot (a hard tick)
  B.nd_shieldhit = each(0.18, (t) => (Math.sin(TAU * 2900 * t) + 0.6 * Math.sin(TAU * 4100 * t)) * Math.exp(-t / 0.04) * 0.28);
  B.nd_shatter = (() => { const l = lp(0.6); return each(0.9, (t) => ((noise() - l(noise())) * Math.exp(-t / 0.12) * 0.7 + Math.sin(TAU * (3000 - 2000 * t) * t) * 0.2 * Math.exp(-t / 0.4))); })();
  B.nd_head = each(0.12, (t) => (Math.sin(TAU * 2400 * t) + Math.sin(TAU * 3600 * t)) * Math.exp(-t / 0.02) * 0.3 + noise() * Math.exp(-t / 0.003) * 0.3);
  B.nd_cell = each(0.3, (t) => Math.sin(TAU * (900 + 900 * Math.min(1, t * 6)) * t) * Math.exp(-t / 0.1) * 0.3);
}

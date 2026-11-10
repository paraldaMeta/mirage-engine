// Mirage original code.
// ---------------------------------------------------------------------------
// The protocol two peers share: entity schemas, RPCs (client to server) and events (server to client), and the
// quantised, delta-compressed encoding of their fields.
//
//   const protocol = defineProtocol({
//     bounds: plan.bounds, y: [-2, 12],                       // the playable box: positions are quantised into it
//     player: [field.u('score', 12)],                         // extra replicated fields of the built-in player
//     entities: { pickup: [field.pos(), field.u('kind', 3)] },
//     rpcs:   { chat: [field.str('text', 200)], use: [] },    // what a client may ask; the server validates all of it
//     events: { chat: [field.u('from', 16), field.str('text', 200)] },
//   });
//
// Field kinds: field.q(name, min, max, step) a real number on a grid of `step` (bits follow from the range),
// field.angle(name, bits = 10) radians, wrapping; field.u(name, bits) unsigned; field.bool(name); field.f32(name);
// field.str(name, maxBytes); field.pos() = x, y, z quantised into the protocol's box at 1/256 m.
// A field with { owner: false } is not sent to the client that owns the entity (it predicts those itself).
//
// States are kept quantised (an array of integers, strings for `str`), so "changed" is an integer compare and both
// ends agree on every bit. A delta against a baseline is, per field: 1 bit changed?; for numbers of 6 bits or more
// 1 bit small?, then a signed difference in half the field's bits, or the whole value. A full state is every field.
// Both ends compute the same `protocol.hash` from the definition; the server refuses a client whose hash differs.
// ---------------------------------------------------------------------------
import { hash32 } from '@mirage/core/rng';
import { cleanText } from './wire.js';

const TAU = Math.PI * 2;
export const field = {
  q: (name, min, max, step = 1 / 256, o = {}) => ({ name, t: 'q', min, max, bits: Math.max(1, Math.min(32, Math.ceil(Math.log2((max - min) / step + 1)))), ...o }),
  angle: (name, bits = 10, o = {}) => ({ name, t: 'angle', bits, ...o }),
  u: (name, bits = 8, o = {}) => ({ name, t: 'u', bits, ...o }),
  bool: (name, o = {}) => ({ name, t: 'u', bits: 1, bool: true, ...o }),
  f32: (name, o = {}) => ({ name, t: 'f32', ...o }),
  str: (name, max = 64, o = {}) => ({ name, t: 'str', max, ...o }),
  pos: (o = {}) => [{ name: 'x', t: 'pos', axis: 0, ...o }, { name: 'y', t: 'pos', axis: 1, ...o }, { name: 'z', t: 'pos', axis: 2, ...o }],
};

function compile(name, id, fields, box) {
  const list = fields.flat().map((f) => {
    if (f.t === 'pos') { const [min, max] = box[f.axis]; return { ...field.q(f.name, min, max, 1 / 256), owner: f.owner }; }
    return { ...f };
  });
  if (list.length > 32) throw new Error(`mirage net: schema "${name}" has ${list.length} fields (32 at most)`);
  for (const f of list) {
    if (f.t === 'q') { f.levels = 2 ** f.bits - 1; f.scale = f.levels / (f.max - f.min); }
    f.small = (f.t === 'q' || f.t === 'angle' || f.t === 'u') && f.bits >= 6 ? Math.max(2, f.bits >> 1) : 0;
    f.lerp = f.t === 'q' || f.t === 'f32' ? 1 : f.t === 'angle' ? 2 : 0;
  }
  const index = Object.fromEntries(list.map((f, i) => [f.name, i]));
  return { name, id, fields: list, index };
}

/** a value -> what is stored and compared */
export function quantise(f, v) {
  switch (f.t) {
    case 'q': { const n = Math.round((Math.min(f.max, Math.max(f.min, +v || 0)) - f.min) * f.scale); return n; }
    case 'angle': { const m = 2 ** f.bits; return ((Math.round(((+v || 0) / TAU) * m) % m) + m) % m; }
    case 'u': return f.bool ? (v ? 1 : 0) : Math.min(2 ** f.bits - 1, Math.max(0, Math.round(+v || 0))) >>> 0;
    case 'f32': return Math.fround(+v || 0);
    default: return cleanText(v, f.max);
  }
}
export function dequantise(f, n) {
  switch (f.t) {
    case 'q': return f.min + Math.min(n, f.levels) / f.scale;
    case 'angle': return (n / 2 ** f.bits) * TAU;
    case 'u': return f.bool ? n === 1 : n;
    default: return n;
  }
}
const writeFull = (w, f, v) => { if (f.t === 'f32') w.f32(v); else if (f.t === 'str') w.str(v, f.max); else w.bits(v, f.bits); };
const readFull = (r, f) => (f.t === 'f32' ? r.f32() : f.t === 'str' ? cleanText(r.str(f.max), f.max) : r.bits(f.bits));

/** every field (own: skip the fields the owner predicts) */
export function encodeFull(w, s, q, own = false) { for (let i = 0; i < s.fields.length; i++) { const f = s.fields[i]; if (!(own && f.owner === false)) writeFull(w, f, q[i]); } }
export function decodeFull(r, s, own = false) {
  const q = new Array(s.fields.length);
  for (let i = 0; i < q.length; i++) { const f = s.fields[i]; q[i] = own && f.owner === false ? (f.t === 'str' ? '' : 0) : readFull(r, f); }
  return q;
}
/** true when `q` differs from `base` in a field this receiver gets */
export function differs(s, q, base, own = false) {
  for (let i = 0; i < q.length; i++) if (q[i] !== base[i] && !(own && s.fields[i].owner === false)) return true;
  return false;
}
export function encodeDelta(w, s, q, base, own = false) {
  for (let i = 0; i < s.fields.length; i++) {
    const f = s.fields[i];
    if (own && f.owner === false) continue;
    if (q[i] === base[i]) { w.bits(0, 1); continue; }
    w.bits(1, 1);
    if (f.small) {
      const m = 2 ** f.bits, half = 2 ** (f.small - 1);
      let d = q[i] - base[i];
      if (f.t === 'angle') d = ((d + m / 2 + m) % m) - m / 2;   // the short way round
      if (d >= -half && d < half) { w.bits(1, 1); w.bits(d + half, f.small); continue; }
      w.bits(0, 1);
    }
    writeFull(w, f, q[i]);
  }
}
export function decodeDelta(r, s, base, own = false) {
  const q = base.slice();
  for (let i = 0; i < s.fields.length; i++) {
    const f = s.fields[i];
    if ((own && f.owner === false) || !r.bits(1)) continue;
    if (f.small && r.bits(1)) {
      const m = 2 ** f.bits, v = base[i] + r.bits(f.small) - 2 ** (f.small - 1);
      q[i] = f.t === 'angle' ? ((v % m) + m) % m : Math.min(m - 1, Math.max(0, v));
    } else q[i] = readFull(r, f);
  }
  return q;
}
/** { name: value } -> quantised array, and back */
export const pack = (s, o) => s.fields.map((f) => quantise(f, o[f.name]));
export const unpack = (s, q, into = {}) => { for (let i = 0; i < q.length; i++) into[s.fields[i].name] = dequantise(s.fields[i], q[i]); return into; };

export const PLAYER = 'player';
export function defineProtocol({ bounds = [-64, -64, 64, 64], y = [-8, 56], player = [], entities = {}, rpcs = {}, events = {}, version = 1 } = {}) {
  // the box is padded: a walker pushed just outside the plan's bounds still has a position
  const box = [[bounds[0] - 4, bounds[2] + 4], [y[0], y[1]], [bounds[1] - 4, bounds[3] + 4]];
  const all = { [PLAYER]: [field.pos({ owner: false }), field.angle('yaw', 10, { owner: false }), field.bool('onGround', { owner: false }), field.bool('run', { owner: false }),
    field.bool('away'), field.str('name', 24), ...player], ...entities };
  const names = [PLAYER, ...Object.keys(entities).filter((n) => n !== PLAYER).sort()];
  if (names.length > 16) throw new Error('mirage net: 16 entity types at most');
  const types = names.map((n, i) => compile(n, i, all[n], box));
  const table = (o) => Object.keys(o).sort().map((n, i) => compile(n, i, o[n], box));
  const R = table(rpcs), E = table(events);
  if (R.length > 64 || E.length > 64) throw new Error('mirage net: 64 rpcs and 64 events at most');
  const hash = hash32(JSON.stringify([version, box, types.map((t) => [t.name, t.fields]), R.map((t) => [t.name, t.fields]), E.map((t) => [t.name, t.fields])]));
  const by = (list) => Object.fromEntries(list.map((t) => [t.name, t]));
  return { version, hash, box, bounds, types, type: by(types), rpcs: R, rpc: by(R), events: E, event: by(E) };
}

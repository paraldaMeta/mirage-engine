// Mirage original code.
// ---------------------------------------------------------------------------
// The wire format's two tools: a bit writer and a bit reader over a Uint8Array (least significant bit first).
//
//   const w = new BitWriter(1200);  w.bits(5, 3); w.varu(300); w.str('hi', 32); const bytes = w.bytes();
//   const r = new BitReader(bytes); r.bits(3); r.varu(); r.str(32); if (!r.ok) drop the packet
//
// The reader never throws and never allocates more than its input: reading past the end returns 0 and clears
// `ok`, a string longer than its cap clears `ok`. Every decoder in this package reads a whole message and then
// tests `ok` once, so a truncated or hostile packet costs one early return (docs/multiplayer.md, "Hostile input").
// The writer grows up to `max` bytes and then sets `full` (the caller drops what did not fit).
// ---------------------------------------------------------------------------

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: false });
const F = new Float32Array(1), U = new Uint32Array(F.buffer);

export class BitWriter {
  constructor(max = 1200, start = Math.min(max, 256)) { this.b = new Uint8Array(start); this.n = 0; this.max = max; this.full = false; }
  /** the low n bits of v (n 0..32) */
  bits(v, n) {
    if (this.full) return this;
    const need = (this.n + n + 7) >> 3;
    if (need > this.b.length) {
      if (need > this.max) { this.full = true; return this; }
      const g = new Uint8Array(Math.min(this.max, Math.max(need, this.b.length * 2))); g.set(this.b); this.b = g;
    }
    v >>>= 0;
    while (n > 0) {
      const o = this.n & 7, k = Math.min(8 - o, n);
      this.b[this.n >> 3] |= (v & ((1 << k) - 1)) << o;
      v >>>= k; this.n += k; n -= k;
    }
    return this;
  }
  bool(v) { return this.bits(v ? 1 : 0, 1); }
  /** unsigned, 7 bits a group, at most 5 groups */
  varu(v) { v >>>= 0; while (v > 127) { this.bits((v & 127) | 128, 8); v >>>= 7; } return this.bits(v, 8); }
  /** signed, zigzag */
  vari(v) { return this.varu((v << 1) ^ (v >> 31)); }
  f32(v) { F[0] = v; return this.bits(U[0], 32); }
  /** utf-8, at most `max` bytes (longer strings are cut at a character boundary) */
  str(s, max = 255) {
    let u = enc.encode(String(s));
    if (u.length > max) { let e = max; while (e > 0 && (u[e] & 0xc0) === 0x80) e--; u = u.subarray(0, e); }
    this.varu(u.length);
    for (let i = 0; i < u.length; i++) this.bits(u[i], 8);
    return this;
  }
  raw(u) { for (let i = 0; i < u.length; i++) this.bits(u[i], 8); return this; }
  /** go back to an earlier bit position (what was written after it is erased): an entity that did not fit */
  rewind(n) {
    for (let i = (n + 7) >> 3; i < this.b.length && i <= (this.n >> 3); i++) this.b[i] = 0;
    if (n & 7) this.b[n >> 3] &= (1 << (n & 7)) - 1;
    this.n = n; this.full = false;
  }
  get size() { return (this.n + 7) >> 3; }
  bytes() { return this.b.slice(0, this.size); }
}

export class BitReader {
  constructor(u) { this.b = u; this.n = 0; this.end = u.length * 8; this.ok = true; }
  bits(n) {
    if (this.n + n > this.end) { this.ok = false; this.n = this.end; return 0; }
    let v = 0, s = 0;
    while (n > 0) {
      const o = this.n & 7, k = Math.min(8 - o, n);
      v |= ((this.b[this.n >> 3] >> o) & ((1 << k) - 1)) << s;
      s += k; this.n += k; n -= k;
    }
    return v >>> 0;
  }
  bool() { return this.bits(1) === 1; }
  varu() {
    let v = 0;
    for (let s = 0; s < 35; s += 7) { const b = this.bits(8); v |= (b & 127) << s; if (b < 128) return v >>> 0; }
    this.ok = false; return 0;
  }
  vari() { const u = this.varu(); return (u >>> 1) ^ -(u & 1); }
  f32() { U[0] = this.bits(32); return F[0]; }
  str(max = 255) {
    const len = this.varu();
    if (len > max || this.n + len * 8 > this.end) { this.ok = false; return ''; }
    const u = new Uint8Array(len);
    for (let i = 0; i < len; i++) u[i] = this.bits(8);
    return dec.decode(u);
  }
  raw(len) {
    if (len < 0 || this.n + len * 8 > this.end) { this.ok = false; return new Uint8Array(0); }
    const u = new Uint8Array(len);
    for (let i = 0; i < len; i++) u[i] = this.bits(8);
    return u;
  }
  get left() { return this.end - this.n; }
}

/** message kinds. Unreliable payloads start with 2 bits, reliable messages with 4 (STATE: one whole byte, then the blob). */
export const MSG = { INPUT: 0, SNAP: 1, HELLO: 1, RPC: 2, RESYNC: 3, WELCOME: 1, EVENT: 2, KICK: 3, STATE: 4 };
/** a - b for 16-bit sequence numbers that wrap (-32768..32767) */
export const seqDiff = (a, b) => ((a - b + 32768) & 65535) - 32768;
/** strip control and direction-override characters and clamp: for names and chat (show them with textContent) */
// (property classes, not ranges: control, format (zero width, direction overrides, BOM) and line/paragraph separators)
export const cleanText = (s, max) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, max);

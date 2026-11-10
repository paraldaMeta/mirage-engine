// Mirage original code. A small lossless WebP (VP8L) encoder for data textures (the SOG fixtures): no transforms,
// no backward references, no colour cache, one prefix-code group whose five codes come from the image's own
// histograms (length-limited by package-merge). Bit-exact RGBA in, a valid .webp out; it compresses only by entropy
// (a constant channel costs nothing). Format: RFC 9649.

const ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

class Bits {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; this.acc = 0; this.k = 0; }
  put(v, nb) {
    this.acc = (this.acc | (v << this.k)) >>> 0; this.k += nb;
    while (this.k >= 8) {
      if (this.n === this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
      this.buf[this.n++] = this.acc & 255; this.acc >>>= 8; this.k -= 8;
    }
  }
  bytes() { if (this.k) this.put(0, 8 - this.k); return this.buf.subarray(0, this.n); }
}

// optimal code lengths no longer than maxLen (package-merge); a lone symbol gets length 1
function lengths(freq, maxLen) {
  const out = new Uint8Array(freq.length), leaves = [];
  freq.forEach((f, s) => { if (f > 0) leaves.push({ w: f, s: [s] }); });
  if (leaves.length === 1) out[leaves[0].s[0]] = 1;
  if (leaves.length < 2) return out;
  leaves.sort((a, b) => a.w - b.w);
  let list = leaves;
  for (let l = 1; l < maxLen; l++) {
    const pk = [];
    for (let i = 0; i + 1 < list.length; i += 2) pk.push({ w: list[i].w + list[i + 1].w, s: list[i].s.concat(list[i + 1].s) });
    const m = [];
    let a = 0, b = 0;
    while (a < leaves.length || b < pk.length) m.push(b >= pk.length || (a < leaves.length && leaves[a].w <= pk[b].w) ? leaves[a++] : pk[b++]);
    list = m;
  }
  for (let i = 0; i < 2 * leaves.length - 2; i++) for (const s of list[i].s) out[s]++;
  return out;
}

// canonical codes, bit-reversed (the stream is read LSB first, a code MSB first)
function codes(len) {
  const cnt = new Uint32Array(17), next = new Uint32Array(17), out = new Uint32Array(len.length);
  for (const l of len) if (l) cnt[l]++;
  for (let b = 1, c = 0; b <= 16; b++) { c = (c + cnt[b - 1]) << 1; next[b] = c; }
  len.forEach((l, s) => {
    if (!l) return;
    let c = next[l]++, r = 0;
    for (let i = 0; i < l; i++) { r = (r << 1) | (c & 1); c >>= 1; }
    out[s] = r;
  });
  return out;
}

// one prefix code; returns [lengths, reversed codes] for the symbols
function writeCode(bw, freq) {
  const used = [];
  freq.forEach((f, s) => { if (f) used.push(s); });
  if (used.length <= 2 && used.every((s) => s < 256)) {
    // simple code: one symbol (0 bits each) or two (1 bit each)
    const s = used.length ? used : [0];
    bw.put(1, 1); bw.put(s.length - 1, 1);
    if (s[0] < 2) { bw.put(0, 1); bw.put(s[0], 1); } else { bw.put(1, 1); bw.put(s[0], 8); }
    if (s.length === 2) bw.put(s[1], 8);
    const len = new Uint8Array(freq.length);
    if (s.length === 2) len[s[0]] = len[s[1]] = 1;
    return [len, codes(len)];
  }
  const len = lengths(freq, 15), tok = [];
  // the code lengths, run-length coded: 17 / 18 for zero runs, 16 to repeat the previous non-zero length
  let prev = 8;
  for (let i = 0; i < len.length;) {
    const v = len[i];
    let r = 1;
    while (i + r < len.length && len[i + r] === v) r++;
    if (v === 0 && r >= 3) { const k = Math.min(r, 138); tok.push(k >= 11 ? [18, k - 11, 7] : [17, k - 3, 3]); i += k; continue; }
    if (v !== 0 && v === prev && r >= 3) { const k = Math.min(r, 6); tok.push([16, k - 3, 2]); i += k; continue; }
    tok.push([v, 0, 0]); if (v) prev = v; i++;
  }
  const cf = new Uint32Array(19);
  for (const [s] of tok) cf[s]++;
  const cl = lengths(cf, 7);
  if (cl.filter(Boolean).length === 1) cl[cl[0] ? 1 : 0] = 1;   // two symbols at least: a complete code
  let nc = 19;
  while (nc > 4 && !cl[ORDER[nc - 1]]) nc--;
  bw.put(0, 1); bw.put(nc - 4, 4);
  for (let i = 0; i < nc; i++) bw.put(cl[ORDER[i]], 3);
  bw.put(0, 1);   // every symbol's length is coded
  const cc = codes(cl);
  for (const [s, x, nb] of tok) { bw.put(cc[s], cl[s]); if (nb) bw.put(x, nb); }
  return [len, codes(len)];
}

/** RGBA bytes (w x h) -> a lossless .webp (Uint8Array). */
export function encodeWebpLossless(rgba, w, h) {
  if (w < 1 || h < 1 || w > 16384 || h > 16384) throw new RangeError('webp: 1..16384 pixels a side');
  const n = w * h, F = [new Uint32Array(280), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(40)];
  for (let i = 0; i < n; i++) { F[0][rgba[i * 4 + 1]]++; F[1][rgba[i * 4]]++; F[2][rgba[i * 4 + 2]]++; F[3][rgba[i * 4 + 3]]++; }
  const bw = new Bits();
  bw.put(0x2f, 8); bw.put(w - 1, 14); bw.put(h - 1, 14); bw.put(1, 1); bw.put(0, 3);
  bw.put(0, 1);   // no transform
  bw.put(0, 1);   // no colour cache
  bw.put(0, 1);   // one prefix-code group
  const C = F.map((f) => writeCode(bw, f));
  const [g, r, b, a] = C;
  for (let i = 0; i < n; i++) {
    const G = rgba[i * 4 + 1], R = rgba[i * 4], B = rgba[i * 4 + 2], A = rgba[i * 4 + 3];
    bw.put(g[1][G], g[0][G]); bw.put(r[1][R], r[0][R]); bw.put(b[1][B], b[0][B]); bw.put(a[1][A], a[0][A]);
  }
  const data = bw.bytes(), pad = data.length & 1, out = new Uint8Array(20 + data.length + pad), v = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0); v.setUint32(4, 12 + data.length + pad, true); out.set([87, 69, 66, 80, 86, 80, 56, 76], 8);
  v.setUint32(16, data.length, true); out.set(data, 20);
  return out;
}

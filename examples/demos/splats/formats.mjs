// Mirage original code. Writers for the three splat formats the kit reads (@miragekit/world/kits/splat), used to save
// the procedural test asset: antimatter15's .splat, an uncompressed 3DGS .ply (SH0 only) and SOG version 2
// (meta.json + lossless webp textures: 16-bit means split low / high, 256-entry codebooks for the log-scales and
// the SH0 colour, smallest-three quaternions).
import { encodeWebpLossless } from './webp.mjs';

const SH_C0 = 0.28209479177387814;

/** data -> .splat bytes (32 a splat) */
export function writeSplat(D) {
  const out = new ArrayBuffer(D.count * 32), f = new Float32Array(out), u = new Uint8Array(out);
  for (let i = 0; i < D.count; i++) {
    f.set(D.center.subarray(i * 3, i * 3 + 3), i * 8); f.set(D.scale.subarray(i * 3, i * 3 + 3), i * 8 + 3);
    u.set(D.color.subarray(i * 4, i * 4 + 4), i * 32 + 24);
    const [x, y, z, w] = D.rot.subarray(i * 4, i * 4 + 4), q = (v) => Math.max(0, Math.min(255, Math.round(v * 128 + 128)));
    u.set([q(w), q(x), q(y), q(z)], i * 32 + 28);
  }
  return new Uint8Array(out);
}

/** data -> binary little-endian .ply with the 3DGS SH0 properties (normals written as 0) */
export function writePly(D) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${D.count}\n${props.map((p) => `property float ${p}\n`).join('')}end_header\n`);
  const out = new Uint8Array(head.length + D.count * props.length * 4), v = new DataView(out.buffer);
  out.set(head);
  let o = head.length;
  const put = (x) => { v.setFloat32(o, x, true); o += 4; };
  for (let i = 0; i < D.count; i++) {
    for (let k = 0; k < 3; k++) put(D.center[i * 3 + k]);
    put(0); put(0); put(0);
    for (let k = 0; k < 3; k++) put((D.color[i * 4 + k] / 255 - 0.5) / SH_C0);
    const a = Math.min(Math.max(D.color[i * 4 + 3] / 255, 0.5 / 255), 254.5 / 255);
    put(Math.log(a / (1 - a)));
    for (let k = 0; k < 3; k++) put(Math.log(Math.max(D.scale[i * 3 + k], 1e-12)));
    put(D.rot[i * 4 + 3]); put(D.rot[i * 4]); put(D.rot[i * 4 + 1]); put(D.rot[i * 4 + 2]);
  }
  return out;
}

// 256 levels for a set of values: quantiles, then a few rounds of 1-D k-means; returns [codebook, index of a value]
function codebook(values) {
  const step = Math.max(1, Math.floor(values.length / 200000)), sample = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  let cb = Array.from({ length: 256 }, (_, k) => sample[Math.min(sample.length - 1, Math.floor((k + 0.5) / 256 * sample.length))]);
  const near = (x) => { let lo = 0, hi = 255; while (lo < hi) { const m = (lo + hi) >> 1; if (cb[m] < x) lo = m + 1; else hi = m; } return lo > 0 && x - cb[lo - 1] < cb[lo] - x ? lo - 1 : lo; };
  for (let it = 0; it < 4; it++) {
    const s = new Float64Array(256), c = new Uint32Array(256);
    for (const x of sample) { const k = near(x); s[k] += x; c[k]++; }
    cb = cb.map((v, k) => (c[k] ? s[k] / c[k] : v)).sort((a, b) => a - b);
  }
  return [cb, near];
}

/** data -> { meta (meta.json object), files: { name: webp bytes }, raw: { name: RGBA bytes }, width, height } in SOG
 *  version 2 (encode false: the RGBA only) */
export function writeSog(D, { encode = true } = {}) {
  const n = D.count, w = Math.max(4, Math.ceil(Math.sqrt(n) / 4) * 4), h = Math.ceil(n / w), px = () => new Uint8Array(w * h * 4);
  const L = px(), U = px(), S = px(), Q = px(), C = px();
  // means: sign(x) log(|x| + 1), 16 bits over the range
  const lg = (x) => Math.sign(x) * Math.log(Math.abs(x) + 1), mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = lg(D.center[i * 3 + k]); mins[k] = Math.min(mins[k], v); maxs[k] = Math.max(maxs[k], v); }
  const logS = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) logS[i] = Math.log(Math.max(D.scale[i], 1e-12));
  // the colours are bytes already: a codebook of all 256 byte values keeps them exact
  const [sCb, sAt] = codebook(logS), cCb = Array.from({ length: 256 }, (_, k) => (k / 255 - 0.5) / SH_C0);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    for (let k = 0; k < 3; k++) {
      const q = Math.round((lg(D.center[i * 3 + k]) - mins[k]) / Math.max(maxs[k] - mins[k], 1e-12) * 65535);
      L[p + k] = q & 255; U[p + k] = q >> 8;
      S[p + k] = sAt(logS[i * 3 + k]); C[p + k] = D.color[p + k];
    }
    L[p + 3] = U[p + 3] = S[p + 3] = 255; C[p + 3] = D.color[p + 3];
    // smallest three of (w, x, y, z): the largest dropped (made positive), its index in alpha (252 + m)
    const q = [D.rot[p + 3], D.rot[p], D.rot[p + 1], D.rot[p + 2]];
    let m = 0;
    for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[m])) m = k;
    const sg = q[m] < 0 ? -1 : 1;
    let j = 0;
    for (let k = 0; k < 4; k++) if (k !== m) Q[p + j++] = Math.max(0, Math.min(255, Math.round((sg * q[k] / Math.SQRT2 + 0.5) * 255)));
    Q[p + 3] = 252 + m;
  }
  const meta = {
    version: 2, count: n,
    means: { mins, maxs, files: ['means_l.webp', 'means_u.webp'] },
    scales: { codebook: sCb, files: ['scales.webp'] },
    quats: { files: ['quats.webp'] },
    sh0: { codebook: cCb, files: ['sh0.webp'] },
  };
  const raw = { 'means_l.webp': L, 'means_u.webp': U, 'scales.webp': S, 'quats.webp': Q, 'sh0.webp': C }, files = {};
  for (const k of Object.keys(raw)) files[k] = encode ? encodeWebpLossless(raw[k], w, h) : null;
  return { meta, files, raw, width: w, height: h };
}

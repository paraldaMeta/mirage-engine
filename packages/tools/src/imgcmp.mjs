// Mirage original code. Plain-node image comparison for the tools (no dependencies beyond node:zlib): read and write
// 8-bit PNGs, region SSIM against a baseline (the frame cut into a 4 x 4 grid of cells: a moved or missing object
// drags one cell, not the frame), bit-identical checks, a boxed cell for the report.
//
//   decodePNG(buf) -> { w, h, data: RGBA Uint8Array }     encodePNG({ w, h, data }) -> Buffer
//   regionSSIM(a, b, { grid: 4 }) -> { mean, p05, cell, worst: { i, roi: [x0, y0, x1, y1], ssim }, cells: [16] }
//   ssimVerdict(scores, thresholds) -> { pass, fails: ['mean 0.81 < 0.92', ...] }
//   pixelDiff(a, b) -> { same, differing, max, mean }      boxed(img, roi) -> a copy with the box drawn
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------------------------------- PNG
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** An 8-bit, non-interlaced PNG (grey, grey + alpha, RGB, RGBA: what Chrome writes) as RGBA. */
export function decodePNG(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0, pos = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`PNG: only 8-bit grey / RGB / RGBA without interlace (got depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = (src[i] + p) & 0xff;
    }
    prev = row;
  }
  if (ch === 4) return { w, h, data: px };
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch;
    if (ch >= 3) { out[4 * i] = px[s]; out[4 * i + 1] = px[s + 1]; out[4 * i + 2] = px[s + 2]; out[4 * i + 3] = 255; }
    else { out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = px[s]; out[4 * i + 3] = ch === 2 ? px[s + 1] : 255; }
  }
  return { w, h, data: out };
}

/** RGBA -> PNG (filter Sub on every row: small enough for screenshots, simple). */
export function encodePNG({ w, h, data }) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1); raw[o] = 1;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (data[y * stride + i] - (i >= 4 ? data[y * stride + i - 4] : 0)) & 0xff;
  }
  const chunk = (kind, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(kind, 4, 'latin1'); body.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A data:image/png;base64 URL or a Buffer / file bytes -> decoded image. */
export const readPNG = (x) => decodePNG(typeof x === 'string' && x.startsWith('data:') ? Buffer.from(x.split(',')[1], 'base64') : x);

// ---------------------------------------------------------------------------------------------------- SSIM
export const SSIM_THRESHOLDS = { mean: 0.92, p05: 0.85, cell: 0.75 };
const luma = ({ w, h, data }) => { const L = new Float32Array(w * h); for (let i = 0; i < L.length; i++) L[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2]; return L; };

/** SSIM of luma over 8 x 8 windows every 4 px; per window, then the mean, the 5th percentile of the windows and the
 *  mean of each cell of a grid x grid split (a window belongs to the cell holding its centre). Same size required. */
export function regionSSIM(a, b, { grid = 4, win = 8, stride = 4 } = {}) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`regionSSIM: sizes differ (${a.w}x${a.h} vs ${b.w}x${b.h})`);
  const { w, h } = a, A = luma(a), B = luma(b), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, n = win * win;
  const all = [], sum = new Float64Array(grid * grid), cnt = new Uint32Array(grid * grid);
  for (let y = 0; y + win <= h; y += stride) for (let x = 0; x + win <= w; x += stride) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let j = 0; j < win; j++) { let k = (y + j) * w + x; for (let i = 0; i < win; i++, k++) { const p = A[k], q = B[k]; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; } }
    const ma = sa / n, mb = sb / n, va = saa / n - ma * ma, vb = sbb / n - mb * mb, cv = sab / n - ma * mb;
    const s = ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    all.push(s);
    const c = Math.min(grid - 1, Math.floor(((y + win / 2) / h) * grid)) * grid + Math.min(grid - 1, Math.floor(((x + win / 2) / w) * grid));
    sum[c] += s; cnt[c]++;
  }
  const cells = Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : 1));
  const worst = cells.indexOf(Math.min(...cells)), cw = w / grid, ch = h / grid;
  const sorted = Float64Array.from(all).sort();
  const r = (v) => +v.toFixed(4);
  return {
    mean: r(all.reduce((s, v) => s + v, 0) / all.length), p05: r(sorted[Math.floor(0.05 * (sorted.length - 1))]), cell: r(cells[worst]),
    worst: { i: worst, roi: [Math.round((worst % grid) * cw), Math.round(Math.floor(worst / grid) * ch), Math.round((worst % grid + 1) * cw), Math.round((Math.floor(worst / grid) + 1) * ch)], ssim: r(cells[worst]) },
    cells: cells.map(r),
  };
}

/** Which thresholds the scores miss. */
export function ssimVerdict(s, t = {}) {
  const T = { ...SSIM_THRESHOLDS, ...t }, fails = [];
  if (s.mean < T.mean) fails.push(`mean ${s.mean} < ${T.mean}`);
  if (s.p05 < T.p05) fails.push(`p05 ${s.p05} < ${T.p05}`);
  if (s.cell < T.cell) fails.push(`worst cell ${s.cell} < ${T.cell}`);
  return { pass: !fails.length, fails, thresholds: T };
}

/** "0.92,0.85,0.75" (mean, p05, cell; any may be empty) -> thresholds */
export const parseThresholds = (s) => { const [mean, p05, cell] = String(s || '').split(',').map((v) => (v === '' || v === undefined ? undefined : +v)); return Object.fromEntries(Object.entries({ mean, p05, cell }).filter(([, v]) => Number.isFinite(v))); };

// ---------------------------------------------------------------------------------------------------- pixels
/** RGB difference (alpha ignored): same = bit-identical colour, differing = pixels with any channel off. */
export function pixelDiff(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { same: false, size: [[a.w, a.h], [b.w, b.h]], differing: Infinity, max: 255, mean: 255 };
  let differing = 0, max = 0, sum = 0;
  for (let i = 0, n = a.w * a.h; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[4 * i + c] - b.data[4 * i + c]); sum += d; if (d > m) m = d; }
    if (m) { differing++; if (m > max) max = m; }
  }
  return { same: differing === 0, differing, max, mean: +(sum / (a.w * a.h * 3)).toFixed(4) };
}

/** A copy of the image with a box (default red, 3 px) around roi = [x0, y0, x1, y1]. */
export function boxed({ w, h, data }, roi, { rgb = [255, 40, 40], px = 3 } = {}) {
  const out = new Uint8Array(data);
  const [x0, y0, x1, y1] = roi.map(Math.round);
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
    if (x - x0 < px || x1 - 1 - x < px || y - y0 < px || y1 - 1 - y < px) { const k = 4 * (y * w + x); out[k] = rgb[0]; out[k + 1] = rgb[1]; out[k + 2] = rgb[2]; out[k + 3] = 255; }
  }
  return { w, h, data: out };
}

/** Two images of one height side by side (a gap of `gap` px). */
export function sideBySide(a, b, gap = 8) {
  const w = a.w + gap + b.w, h = Math.max(a.h, b.h), data = new Uint8Array(w * h * 4).fill(0);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [img, ox] of [[a, 0], [b, a.w + gap]]) for (let y = 0; y < img.h; y++) data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), (y * w + ox) * 4);
  return { w, h, data };
}

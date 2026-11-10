// Mirage original code. A minimal PNG encoder and decoder for 8-bit RGBA (straight alpha), so transparent stills are
// written exactly (a 2D canvas premultiplies, which loses the colour of faint pixels).
import zlib from 'node:zlib';

const TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), t = Buffer.from(type, 'latin1');
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}

/** RGBA8 rows (top first) -> PNG bytes */
export function encodePNG(width, height, rgba) {
  const row = width * 4, raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (row + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8 bit, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG bytes (8-bit RGBA or RGB, not interlaced) -> { width, height, data: RGBA8 } (for checks) */
export function decodePNG(buf) {
  let p = 8, width = 0, height = 0, type = 6;
  const idat = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8 || d[12] || (type !== 6 && type !== 2)) throw new Error('decodePNG: only 8-bit RGB / RGBA, not interlaced'); }
    if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const bpp = type === 6 ? 4 : 3, row = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (row + 1)], src = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), o = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - row + x] : 0, c = x >= bpp && y ? px[o - row + x - bpp] : 0;
      const pr = () => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      px[o + x] = src[x] + [0, a, b, (a + b) >> 1, f === 4 ? pr() : 0][f];
    }
  }
  if (bpp === 4) return { width, height, data: px };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { data[j] = px[i]; data[j + 1] = px[i + 1]; data[j + 2] = px[i + 2]; data[j + 3] = 255; }
  return { width, height, data };
}

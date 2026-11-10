// Mirage original code. Node checks of mirage-snap's offline encoders and sequence options (src/snap-seq.mjs).
// usage: node snap-seq.check.mjs
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { halfToFloat, floatToHalf, encodePNG16, encodeEXR, encodeIVF, seqOptions } from './src/snap-seq.mjs';

// half floats: exact values, round trip of every finite half, overflow and NaN
for (const [v, h] of [[0, 0], [1, 0x3c00], [-2, 0xc000], [0.5, 0x3800], [65504, 0x7bff], [2 ** -24, 1]]) { assert.equal(floatToHalf(v), h, `floatToHalf(${v})`); assert.equal(halfToFloat(h), v); }
for (let h = 0; h < 0x7c00; h += 7) assert.equal(floatToHalf(halfToFloat(h)), h, `round trip ${h}`);
assert.equal(floatToHalf(1e9), 0x7bff); assert.equal(floatToHalf(-1e9), 0xfbff); assert.equal(floatToHalf(NaN), 0);
assert.equal(halfToFloat(0x7c00), Infinity);

// PNG 16: the signature, an RGB 16-bit header, and the samples back out of the IDAT
{
  const w = 3, h = 2, d = new Float32Array(w * h * 4); for (let i = 0; i < d.length; i++) d[i] = i / (d.length - 1);
  d[0] = -1; d[1] = 2;   // clamped
  const png = encodePNG16(w, h, d);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('latin1', 12, 16), 'IHDR'); assert.equal(png.readUInt32BE(16), w); assert.equal(png.readUInt32BE(20), h); assert.equal(png[24], 16); assert.equal(png[25], 2);
  const at = png.indexOf('IDAT', 0, 'latin1'), raw = zlib.inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
  assert.equal(raw.length, (w * 6 + 1) * h);
  assert.equal(raw[0], 0); assert.equal(raw.readUInt16BE(1), 0); assert.equal(raw.readUInt16BE(3), 65535);
  assert.equal(raw.readUInt16BE(1 + 6 + 4), Math.round(d[6] * 65535), 'pixel 1 blue');
  assert.equal(raw.readUInt16BE((w * 6 + 1) + 1), Math.round(d[w * 4] * 65535), 'row 1 starts after its filter byte');
  assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
}

// EXR: magic, version 2, the offset table points at the scanlines, channels stored B G R
{
  const w = 2, h = 2, half = new Uint16Array(w * h * 4); for (let i = 0; i < w * h; i++) { half[i * 4] = floatToHalf(i + 0.25); half[i * 4 + 1] = floatToHalf(10 + i); half[i * 4 + 2] = floatToHalf(100 + i); }
  const exr = encodeEXR(w, h, half);
  assert.equal(exr.readUInt32LE(0), 20000630); assert.equal(exr.readUInt32LE(4), 2);
  for (const k of ['channels\0chlist\0', 'compression\0compression\0', 'dataWindow\0box2i\0', 'lineOrder\0lineOrder\0']) assert.ok(exr.includes(Buffer.from(k, 'latin1')), k);
  const line = 8 + w * 6, t0 = exr.length - h * line - 8 * h;
  for (let y = 0; y < h; y++) {
    const o = Number(exr.readBigUInt64LE(t0 + y * 8));
    assert.equal(o, t0 + 8 * h + y * line); assert.equal(exr.readInt32LE(o), y); assert.equal(exr.readInt32LE(o + 4), w * 6);
    assert.equal(halfToFloat(exr.readUInt16LE(o + 8)), 100 + y * w, 'B first');
    assert.equal(halfToFloat(exr.readUInt16LE(o + 8 + 4 * w + 2)), y * w + 1.25, 'R last');
  }
}

// IVF: header fields, a 12-byte frame header before every frame
{
  const frames = [Buffer.from([1, 2, 3]), Buffer.from([4, 5])], ivf = encodeIVF({ w: 640, h: 360, fps: 30, frames });
  assert.equal(ivf.toString('latin1', 0, 4), 'DKIF'); assert.equal(ivf.readUInt16LE(6), 32); assert.equal(ivf.toString('latin1', 8, 12), 'VP90');
  assert.deepEqual([ivf.readUInt16LE(12), ivf.readUInt16LE(14), ivf.readUInt32LE(16), ivf.readUInt32LE(20), ivf.readUInt32LE(24)], [640, 360, 30, 1, 2]);
  assert.equal(ivf.length, 32 + 12 + 3 + 12 + 2); assert.equal(ivf.readUInt32LE(32), 3); assert.equal(ivf.readUInt32LE(32 + 12 + 3), 2); assert.equal(Number(ivf.readBigUInt64LE(32 + 12 + 3 + 4)), 1);
}

// options: defaults, a fixed camera when --to is absent, errors that say what is wrong
{
  const F = (o) => (k, d) => (k in o ? o[k] : d);
  assert.equal(seqOptions(F({})).n, 0);
  assert.deepEqual(seqOptions(F({ seq: '24', from: '2', video: true, png16: true })), { n: 24, fps: 30, shutter: 0.5, from: 2, to: 2, video: 'sequence', encoder: 'auto', png16: true, exr: false });
  assert.equal(seqOptions(F({ seq: '2', video: 'a.mp4' })).video, 'a.mp4');
  assert.throws(() => seqOptions(F({ seq: '0' })), /--seq/); assert.throws(() => seqOptions(F({ seq: '1.5' })), /--seq/);
  assert.throws(() => seqOptions(F({ seq: '2', fps: '0' })), /--fps/); assert.throws(() => seqOptions(F({ seq: '2', shutter: '2' })), /--shutter/);
}
console.log('snap-seq check: ok');

// Mirage original code. mirage-snap's offline output: a deterministic image sequence with integrated motion blur
// and depth of field, a video of it, and stills deeper than 8 bits.
//
// usage (through snap.mjs):
//   mirage-snap <dist> --seq 90 [--fps 30] [--from 0 --to 1] [--shutter 0.5] [--spp 16] [--video [out.mp4]]
//                                      frames <out>/frame-0000.png ...: the camera travels from viewpoint --from to
//                                      --to at a constant speed (the same one = a fixed camera); every frame is the
//                                      still path, whose sub-frames spread over the shutter (a fraction of the frame
//                                      time: 0.5 = a 180 degree shutter) and over the lens (post.dof), so motion blur
//                                      and depth of field are integrated, not filtered. Frame f is drawn at T = f / fps
//                                      with frameIndex f: the same command gives the same bytes.
//   --video [file]                     encode the frames: ffmpeg when one is on the PATH (H.264 .mp4), otherwise
//                                      Chrome's own WebCodecs VP9 encoder into an .ivf file (--encoder webcodecs
//                                      forces that one). Nothing is downloaded.
//   --png16                            every still / frame also as <name>.16.png: the grade drawn into a half-float
//                                      target, 16 bits per channel
//   --exr                              every still / frame also as <name>.exr: the linear scene-referred frame before
//                                      exposure and tone mapping (bloom in), OpenEXR half float, uncompressed
// A page may expose window.__mirage.step(dt): the sequence calls it once per frame (its own actors).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

// ---- encoders (pure: snap-seq.check.mjs)

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** a half float's 16 bits -> number */
export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  return s * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15));
}
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
/** number -> the 16 bits of the nearest half float (overflow -> the largest finite half, NaN -> 0) */
export function floatToHalf(v) {
  if (Number.isNaN(v)) return 0;
  F32[0] = v;
  const x = U32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | (((m | 0x800000) >> (1 - e)) + 0x1000 >> 13);
  if (e >= 31) return s | 0x7bff;
  const h = s | (e << 10) | (m >> 13);
  return m & 0x1000 ? Math.min(h + 1, s | 0x7bff) : h;
}

/** RGB 16 bits per channel PNG. data: w * h * 4 values in 0..1 (anything with [i]), top row first; alpha dropped. */
export function encodePNG16(w, h, data) {
  const stride = w * 6, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    let o = y * (stride + 1) + 1;   // filter 0: deflate does well enough on 16-bit samples, and the file stays simple
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++, o += 2) raw.writeUInt16BE(Math.round(Math.min(1, Math.max(0, data[(y * w + x) * 4 + c] || 0)) * 65535), o);
  }
  const chunk = (kind, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(kind, 4, 'latin1'); body.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 16; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** OpenEXR, scanlines, no compression, channels B G R as half floats. half: Uint16Array of w * h * 4 half bits, top
 *  row first (alpha dropped). The file layout follows the OpenEXR file-layout document. */
export function encodeEXR(w, h, half) {
  const parts = [Buffer.from([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0])];
  const attr = (name, type, body) => { const s = Buffer.alloc(4); s.writeInt32LE(body.length); parts.push(Buffer.from(name + '\0' + type + '\0', 'latin1'), s, body); };
  const i32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeInt32LE(x, i * 4)); return b; };
  const f32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
  const ch = (n) => Buffer.concat([Buffer.from(n + '\0', 'latin1'), i32(1), Buffer.from([0, 0, 0, 0]), i32(1, 1)]);   // HALF, not perceptually linear, sampling 1 x 1
  attr('channels', 'chlist', Buffer.concat([ch('B'), ch('G'), ch('R'), Buffer.from([0])]));
  attr('compression', 'compression', Buffer.from([0]));
  attr('dataWindow', 'box2i', i32(0, 0, w - 1, h - 1));
  attr('displayWindow', 'box2i', i32(0, 0, w - 1, h - 1));
  attr('lineOrder', 'lineOrder', Buffer.from([0]));
  attr('pixelAspectRatio', 'float', f32(1));
  attr('screenWindowCenter', 'v2f', f32(0, 0));
  attr('screenWindowWidth', 'float', f32(1));
  parts.push(Buffer.from([0]));
  const head = Buffer.concat(parts), line = 8 + w * 6, table = Buffer.alloc(8 * h), body = Buffer.alloc(line * h);
  for (let y = 0; y < h; y++) {
    table.writeBigUInt64LE(BigInt(head.length + table.length + y * line), y * 8);
    let o = y * line; body.writeInt32LE(y, o); body.writeInt32LE(w * 6, o + 4); o += 8;
    for (const c of [2, 1, 0]) for (let x = 0; x < w; x++, o += 2) body.writeUInt16LE(half[(y * w + x) * 4 + c], o);
  }
  return Buffer.concat([head, table, body]);
}

/** IVF (the plain container of VP8 / VP9 / AV1 streams): a 32-byte header, then size + timestamp before every frame */
export function encodeIVF({ w, h, fps, fourcc = 'VP90', frames }) {
  const head = Buffer.alloc(32);
  head.write('DKIF', 0, 'latin1'); head.writeUInt16LE(0, 4); head.writeUInt16LE(32, 6); head.write(fourcc, 8, 'latin1');
  head.writeUInt16LE(w, 12); head.writeUInt16LE(h, 14); head.writeUInt32LE(fps, 16); head.writeUInt32LE(1, 20); head.writeUInt32LE(frames.length, 24);
  const out = [head];
  frames.forEach((f, i) => { const b = Buffer.alloc(12); b.writeUInt32LE(f.length, 0); b.writeBigUInt64LE(BigInt(i), 4); out.push(b, f); });
  return Buffer.concat(out);
}

/** the sequence's options from mirage-snap's flag(): throws on what cannot be drawn */
export function seqOptions(flag) {
  const n = flag('seq') === undefined ? 0 : +flag('seq'), fps = +flag('fps', 30), shutter = +flag('shutter', 0.5);
  if (flag('seq') !== undefined && !(Number.isInteger(n) && n > 0 && n <= 100000)) throw new Error('mirage-snap: --seq takes a number of frames (1 .. 100000)');
  if (!(fps > 0 && fps <= 240)) throw new Error('mirage-snap: --fps takes 1 .. 240');
  if (!(shutter >= 0 && shutter <= 1)) throw new Error('mirage-snap: --shutter is a fraction of the frame time (0 .. 1)');
  const video = flag('video');
  return { n, fps, shutter, from: +flag('from', 0), to: +flag('to', flag('from', 0)), video: video === undefined ? null : video === true ? 'sequence' : String(video),
    encoder: flag('encoder', 'auto'), png16: !!flag('png16'), exr: !!flag('exr') };
}

export const hasFfmpeg = () => { try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };

// ---- in the page

/** Runs in the page: draw the placed view again into a half-float target (png16) and / or read the linear frame
 *  (exr). o: { spp, png16, exr, frame?: { T, dt, shutter, frameIndex } } — without frame, play's own still. Returns
 *  base64 of the half bits (RGBA, bottom row first, as WebGL reads). */
export async function deepInPage(o) {
  const M = window.__mirage, { play, world } = M, pp = world.pipeline, r = world.renderer;
  const b64 = (u16) => { const u8 = new Uint8Array(u16.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const read = (rt) => { const px = new Uint16Array(rt.width * rt.height * 4); r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px); return b64(px); };
  const draw = (target) => (o.frame ? world.renderFrame(o.frame.T, { spp: o.spp, dt: o.frame.dt, shutter: o.frame.shutter, frameIndex: o.frame.frameIndex, getCamera: M.__seqCam, target })
    : play.render({ moving: false, spp: o.spp, frameIndex: 1, target }));
  const out = { w: pp.accRT.width, h: pp.accRT.height };
  if (o.png16) {
    const rt = (M.__deepRT ||= pp.accRT.clone());   // the grade's own numbers, before the canvas rounds them to 8 bits
    if (rt.width !== out.w || rt.height !== out.h) rt.setSize(out.w, out.h);
    draw(rt); out.png16 = read(rt);
  }
  if (o.exr) { if (!o.png16) draw(null); out.exr = read(pp.accRT); }   // what the grade read: linear, bloom in
  r.setRenderTarget(null);
  return out;
}

/** Runs in the page: frame o.f of the sequence on the canvas; returns its PNG. o.f === 0 sets the path up. */
export async function seqFrameInPage(o) {
  const M = window.__mirage, { play, world } = M;
  if (o.f === 0) {
    play.stop();
    const pose = (i) => { play.viewpoint(i); for (let k = 0; k < 40; k++) play.step(1 / 30); world.camera.updateMatrixWorld(); return { p: world.camera.position.clone(), q: world.camera.quaternion.clone() }; };
    const b = pose(o.to), a = pose(o.from), cam = world.camera.clone(), dur = Math.max(1, o.n - 1) / o.fps;
    // unclamped: the shutter of the first and the last frame reaches a little past the ends of the path
    M.__seqCam = (t) => { const u = o.to === o.from ? 0 : t / dur; cam.position.lerpVectors(a.p, b.p, u); cam.quaternion.slerpQuaternions(a.q, b.q, u); return cam; };
    M.__seqEnc = null;
    if (o.webcodecs) {
      const chunks = [], err = [];
      const enc = new VideoEncoder({ output: (c) => { const u = new Uint8Array(c.byteLength); c.copyTo(u); chunks.push(u); }, error: (e) => err.push(String(e)) });
      const cv = document.querySelector('canvas');
      enc.configure({ codec: 'vp09.00.10.08', width: cv.width, height: cv.height, framerate: o.fps, bitrate: o.bitrate, latencyMode: 'quality' });
      M.__seqEnc = { enc, chunks, err };
    }
  }
  const T = o.f / o.fps, dt = 1 / o.fps;
  if (M.step) M.step(dt);
  const t = performance.now();
  world.renderFrame(T, { spp: o.spp, dt, shutter: o.shutter, frameIndex: o.f, getCamera: M.__seqCam });
  const cv = document.querySelector('canvas'), gl = world.renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const ms = +(performance.now() - t).toFixed(1), png = cv.toDataURL('image/png');
  const E = M.__seqEnc;
  if (E) { const vf = new VideoFrame(cv, { timestamp: Math.round(o.f * 1e6 / o.fps) }); E.enc.encode(vf, { keyFrame: o.f % 60 === 0 }); vf.close(); }
  let video = null;
  if (E && o.f === o.n - 1) {
    await E.enc.flush(); E.enc.close();
    video = { err: E.err, frames: E.chunks.map((u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }) };
  }
  return { png, ms, video, frame: { T, dt, shutter: o.shutter, frameIndex: o.f } };
}

// ---- in Node

/** write <base>.16.png / <base>.exr from deepInPage's answer */
export function writeDeep(base, d) {
  const files = [], flip = (b64) => {   // WebGL reads bottom row first
    const src = new Uint16Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer), out = new Uint16Array(src.length), row = d.w * 4;
    for (let y = 0; y < d.h; y++) out.set(src.subarray((d.h - 1 - y) * row, (d.h - y) * row), y * row);
    return out;
  };
  if (d.png16) { const h = flip(d.png16), f = new Float32Array(h.length); for (let i = 0; i < h.length; i++) f[i] = halfToFloat(h[i]); fs.writeFileSync(base + '.16.png', encodePNG16(d.w, d.h, f)); files.push(base + '.16.png'); }
  if (d.exr) { fs.writeFileSync(base + '.exr', encodeEXR(d.w, d.h, flip(d.exr))); files.push(base + '.exr'); }
  return files;
}

/** the --seq run: frames, then the video; returns the report's `sequence` entry */
export async function runSequence(page, S, { out, spp, w, h, log = console.log }) {
  const nv = await page.evaluate(() => window.__mirage.built.plan.viewpoints.length);
  if (!(S.from >= 0 && S.from < nv && S.to >= 0 && S.to < nv)) throw new Error(`mirage-snap: --from / --to take a viewpoint 0 .. ${nv - 1}`);
  const ff = S.video && S.encoder !== 'webcodecs' && hasFfmpeg();
  if (S.video && S.encoder === 'ffmpeg' && !ff) throw new Error('mirage-snap: --encoder ffmpeg, but no ffmpeg on the PATH');
  const webcodecs = !!S.video && !ff, ms = [], name = (f) => `frame-${String(f).padStart(4, '0')}`;
  let video = null;
  for (let f = 0; f < S.n; f++) {
    const r = await page.evaluate(seqFrameInPage, { f, n: S.n, fps: S.fps, shutter: S.shutter, from: S.from, to: S.to, spp, webcodecs, bitrate: Math.round(w * h * S.fps * 0.25) });
    fs.writeFileSync(path.join(out, name(f) + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    if (S.png16 || S.exr) writeDeep(path.join(out, name(f)), await page.evaluate(deepInPage, { spp, png16: S.png16, exr: S.exr, frame: r.frame }));
    ms.push(r.ms);
    if (r.video) video = r.video;
  }
  const rep = { frames: S.n, fps: S.fps, shutter: S.shutter, spp, from: S.from, to: S.to, frameMs: ms.slice().sort((a, b) => a - b)[ms.length >> 1] };
  if (S.video) {
    const stem = path.resolve(out, S.video.replace(/\.(mp4|ivf)$/, ''));
    if (ff) {
      const file = stem + '.mp4';
      // yuv420p + even sizes: what every player reads; crf 16: visually lossless for a rendered frame
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(S.fps), '-i', path.join(out, 'frame-%04d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', file], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('mirage-snap: ffmpeg failed: ' + String(r.stderr).slice(0, 400));
      Object.assign(rep, { video: file, encoder: 'ffmpeg libx264', videoBytes: fs.statSync(file).size });
    } else {
      if (!video || video.err.length || video.frames.length !== S.n) throw new Error('mirage-snap: WebCodecs gave ' + (video ? `${video.frames.length} of ${S.n} frames ${video.err.join('; ')}` : 'no video') + ' (install ffmpeg, or drop --video and encode the frames elsewhere)');
      const file = stem + '.ivf';
      fs.writeFileSync(file, encodeIVF({ w, h, fps: S.fps, frames: video.frames.map((b) => Buffer.from(b, 'base64')) }));
      Object.assign(rep, { video: file, encoder: 'WebCodecs vp09.00.10.08 (ivf)', videoBytes: fs.statSync(file).size });
    }
  }
  log(JSON.stringify(rep));
  return rep;
}

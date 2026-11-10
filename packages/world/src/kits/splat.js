// Mirage original code. Techniques informed by the PlayCanvas engine's Gaussian splat renderer (MIT): the counting
// sort with histogram-spread buckets, the corner shader's early culls and the SOG texture layout. See NOTICE.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Gaussian splats in a Mirage world: an opt-in kit, one instanced draw with one ShaderMaterial.
//
//   const data = await loadSplats('scan.ply');            // .splat | .ply (3DGS, SH0) | SOG meta.json (+ webp)
//   const s = addSplats(ctx, data, { position: [0, 0, -4], effect: splatEffects.reveal() });
//   createPlay(world, { ..., onStep: () => s.changed() });  // redraw a still view when a fresh sort lands
//
// Data: { count, center (xyz), scale (linear sigma, xyz), rot (unit quaternion xyzw), color (sRGB rgb + opacity,
// bytes) }. It is packed into one RGBA32UI texture, two texels a splat: [centre x, y, z as float bits, rgba8] and
// [rotation as smallest-three 2+10+10+10 bits, scale x|y and z as half floats]. The draw order is a second texture
// (R32UI), written by a counting sort on view depth that runs in a Worker made from a Blob (no extra file, no
// SharedArrayBuffer: single-file pages work); the index buffer goes there and back as a transferable. The sort
// spreads its buckets over a 32-bin histogram of the depths (dense depth ranges get more buckets), skips when the
// camera has not moved, and leaves out splats behind the camera. A quad is drawn per splat (128 quads an instance);
// the vertex shader culls splats under minPixelSize and off the frustum before the eigen decomposition, applies
// the 0.3 px low-pass (with opacity compensation for anti-aliased captures), and the fragment applies the world's
// aerial perspective, so splats sit in the same air as the meshes. Drawn after the opaque meshes into the
// pipeline's scene target: depth test on, depth write off, no shadow, left out of the environment capture, the
// walk grid and GLB export.
// ---------------------------------------------------------------------------

const BATCH = 128;              // quads per instance
// light: the key light's and the sky's share, fitted so that a splat sphere matches a diffuse mesh sphere of the same
// albedo (std material, roughness 1) averaged over six views, at five times of day (spread 0.58 .. 0.65 before)
const KEY = 0.069, SKY = 0.26, AMB = 0.012, GOLD = { x: 8.15, y: 6.09, z: 3.85 };   // GOLD: the key light at the golden hour
const SH_C0 = 0.28209479177387814;

// ---- the sort (one self-contained function: its source text is also the worker's)
export function splatSorter() {
  let C = null, n = 0, depth = null, key = null, count = null, last = null;
  const hist = new Uint32Array(32), base = new Uint32Array(33), width = new Uint32Array(32);
  return {
    init(centers) { C = centers; n = centers.length / 3 | 0; depth = new Float32Array(n); key = new Uint32Array(n); last = null; },
    // d: the view direction in model space (any length), o: the offset so that depth = dot(c, d) + o (metres in
    // front of the eye); eps: skip when d and o moved less than this since the last sort (returns null)
    sort(d, o, out, eps = 1e-3) {
      if (!C) return null;
      if (last && Math.abs(d[0] - last[0]) < eps && Math.abs(d[1] - last[1]) < eps && Math.abs(d[2] - last[2]) < eps && Math.abs(o - last[3]) < eps) return null;
      last = [d[0], d[1], d[2], o];
      const t0 = performance.now(), dx = d[0], dy = d[1], dz = d[2];
      let lo = Infinity, hi = -Infinity, vis = 0;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const z = C[j] * dx + C[j + 1] * dy + C[j + 2] * dz + o;
        depth[i] = z;
        if (z > 0) { vis++; if (z < lo) lo = z; if (z > hi) hi = z; }
      }
      if (!vis) return { count: 0, ms: performance.now() - t0 };
      // buckets: 2^10 .. 2^20, about 8 per visible splat; 3/4 of them follow the depth histogram, 1/4 spread evenly
      const bits = Math.max(10, Math.min(20, Math.ceil(Math.log2(vis)) + 3)), B = 1 << bits;
      if (!count || count.length !== B) count = new Uint32Array(B); else count.fill(0);
      const span = Math.max(hi - lo, 1e-6), toBin = 32 / span;
      hist.fill(0);
      for (let i = 0; i < n; i++) { const z = depth[i]; if (z > 0) hist[Math.min(31, (z - lo) * toBin | 0)]++; }
      let s = 0;
      for (let b = 0; b < 32; b++) { width[b] = Math.max(1, Math.floor(B * (0.75 * hist[b] / vis + 0.25 / 32))); base[b] = s; s += width[b]; }
      const top = Math.min(s, B) - 1;
      for (let i = 0; i < n; i++) {
        const z = depth[i];
        if (!(z > 0)) { key[i] = 0xffffffff; continue; }
        const t = (z - lo) * toBin, b = Math.min(31, t | 0);
        const k = Math.min(top, base[b] + Math.min(width[b] - 1, (t - b) * width[b] | 0));
        key[i] = k; count[k]++;
      }
      // far first: a bucket's first slot is the number of splats in the buckets beyond it
      for (let k = B - 1, acc = 0; k >= 0; k--) { const c = count[k]; count[k] = acc; acc += c; }
      for (let i = 0; i < n; i++) { const k = key[i]; if (k !== 0xffffffff) out[count[k]++] = i; }
      return { count: vis, buckets: B, ms: performance.now() - t0 };
    },
  };
}

// ---- formats
const finite = (v) => (Number.isFinite(v) ? v : 0);
function alloc(count) {
  return { count, center: new Float32Array(count * 3), scale: new Float32Array(count * 3), rot: new Float32Array(count * 4), color: new Uint8Array(count * 4) };
}
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** antimatter15's .splat: 32 bytes a splat (position f32 x3, scale f32 x3, rgba u8, rotation u8 x4 as w x y z). */
export function parseSplat(buffer) {
  const n = Math.floor(buffer.byteLength / 32);
  if (!n || buffer.byteLength % 32) throw new Error('splat: a .splat file is a whole number of 32-byte records');
  const f = new Float32Array(buffer, 0, n * 8), u = new Uint8Array(buffer), D = alloc(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { D.center[i * 3 + k] = finite(f[i * 8 + k]); D.scale[i * 3 + k] = finite(f[i * 8 + 3 + k]); }
    for (let k = 0; k < 4; k++) D.color[i * 4 + k] = u[i * 32 + 24 + k];
    const q = u.subarray(i * 32 + 28, i * 32 + 32);
    setQuat(D.rot, i, (q[1] - 128) / 128, (q[2] - 128) / 128, (q[3] - 128) / 128, (q[0] - 128) / 128);
  }
  return D;
}

function setQuat(rot, i, x, y, z, w) {
  const l = Math.hypot(x, y, z, w);
  if (!(l > 1e-8)) { rot.set([0, 0, 0, 1], i * 4); return; }
  rot[i * 4] = x / l; rot[i * 4 + 1] = y / l; rot[i * 4 + 2] = z / l; rot[i * 4 + 3] = w / l;
}

const PLY_TYPES = { char: 'Int8', uchar: 'Uint8', short: 'Int16', ushort: 'Uint16', int: 'Int32', uint: 'Uint32', float: 'Float32', double: 'Float64',
  int8: 'Int8', uint8: 'Uint8', int16: 'Int16', uint16: 'Uint16', int32: 'Int32', uint32: 'Uint32', float32: 'Float32', float64: 'Float64' };
const PLY_SIZE = { Int8: 1, Uint8: 1, Int16: 2, Uint16: 2, Int32: 4, Uint32: 4, Float32: 4, Float64: 8 };

/** An uncompressed 3D Gaussian Splatting .ply (binary little endian): x y z, f_dc_0..2, opacity (logit), scale_0..2
 *  (log), rot_0..3 (w x y z). Higher spherical harmonics are ignored (the colour is the view-independent SH0). */
export function parsePly(buffer) {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
  const end = head.indexOf('end_header');
  if (!head.startsWith('ply') || end < 0) throw new Error('splat: not a .ply file');
  const lines = head.slice(0, end).split(/\r?\n/).map((l) => l.trim().split(/\s+/));
  if (!lines.some((l) => l[0] === 'format' && l[1] === 'binary_little_endian')) throw new Error('splat: only binary_little_endian .ply is supported');
  let offset = head.indexOf('\n', end) + 1, el = null;
  const els = [];
  for (const l of lines) {
    if (l[0] === 'element') els.push(el = { name: l[1], n: +l[2], props: [], stride: 0 });
    else if (l[0] === 'property' && el) {
      if (l[1] === 'list') throw new Error(`splat: .ply list property "${l[4]}" is not supported`);
      const t = PLY_TYPES[l[1]];
      if (!t) throw new Error(`splat: .ply property type "${l[1]}" is not supported`);
      el.props.push({ name: l[2], t, at: el.stride }); el.stride += PLY_SIZE[t];
    }
  }
  for (const e of els) { if (e.name === 'vertex') { el = e; break; } offset += e.n * e.stride; }
  if (!el || el.name !== 'vertex') throw new Error('splat: .ply has no vertex element');
  const P = Object.fromEntries(el.props.map((p) => [p.name, p]));
  const need = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const miss = need.filter((k) => !P[k]);
  if (miss.length) throw new Error(`splat: .ply is not an uncompressed 3DGS file (missing ${miss.join(', ')})`);
  if (offset + el.n * el.stride > buffer.byteLength) throw new Error('splat: .ply is truncated');
  const v = new DataView(buffer), D = alloc(el.n), s = el.stride;
  const rd = need.map((k) => { const p = P[k], g = v['get' + p.t].bind(v); return (i) => g(offset + i * s + p.at, true); });
  const allF32 = need.every((k) => P[k].t === 'Float32') && offset % 4 === 0 && s % 4 === 0;
  const F = allF32 ? new Float32Array(buffer, offset, el.n * s / 4) : null, at = need.map((k) => P[k].at / 4), s4 = s / 4;
  const get = F ? (i, k) => F[i * s4 + at[k]] : (i, k) => rd[k](i);
  for (let i = 0; i < el.n; i++) {
    for (let k = 0; k < 3; k++) { D.center[i * 3 + k] = finite(get(i, k)); D.scale[i * 3 + k] = Math.exp(finite(get(i, 7 + k))); }
    for (let k = 0; k < 3; k++) D.color[i * 4 + k] = byte(0.5 + SH_C0 * finite(get(i, 3 + k)));
    D.color[i * 4 + 3] = byte(sigmoid(finite(get(i, 6))));
    setQuat(D.rot, i, get(i, 11), get(i, 12), get(i, 13), get(i, 10));
  }
  return D;
}

/** SOG (PlayCanvas's splat textures, version 1, 2 or 3): `meta` is meta.json, `images` maps each file name in it to
 *  { width, height, data: RGBA bytes }. Spherical harmonics beyond SH0 (shN) are ignored. */
export function parseSog(meta, images) {
  const v = meta.version ?? 1, n = v >= 2 ? meta.count : meta.means.shape[0];
  if (![1, 2, 3].includes(v)) throw new Error(`splat: SOG version ${v} is not supported`);
  const img = (k, j = 0) => { const f = meta[k] && meta[k].files[j], m = images[f]; if (!m) throw new Error(`splat: SOG image ${f || k} missing`); return m; };
  const L = img('means', 0).data, U = img('means', 1).data, S = img('scales').data, C = img('sh0').data, Q = v < 3 ? img('quats').data : null;
  const { mins, maxs } = meta.means, D = alloc(n), lerp = (a, b, t) => a + (b - a) * t;
  const cb = (k, i) => meta[k].codebook[i] ?? meta[k].codebook[1];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    for (let k = 0; k < 3; k++) {
      const m = lerp(mins[k], maxs[k], ((U[p + k] << 8) | L[p + k]) / 65535);
      D.center[i * 3 + k] = Math.sign(m) * (Math.exp(Math.abs(m)) - 1);
      D.scale[i * 3 + k] = Math.exp(v >= 2 ? cb('scales', S[p + k]) : lerp(meta.scales.mins[k], meta.scales.maxs[k], S[p + k] / 255));
      const f = v >= 2 ? cb('sh0', C[p + k]) : lerp(meta.sh0.mins[k], meta.sh0.maxs[k], C[p + k] / 255);
      D.color[i * 4 + k] = byte(0.5 + SH_C0 * f);
    }
    // opacity: v1 a logit range, v2 linear, v3 (1.25 b / 255)^2 (above 1 for merged splats: clamped)
    D.color[i * 4 + 3] = v === 1 ? byte(sigmoid(lerp(meta.sh0.mins[3], meta.sh0.maxs[3], C[p + 3] / 255))) : v === 2 ? C[p + 3] : byte((1.25 * C[p + 3] / 255) ** 2);
    if (Q) {
      // smallest three of (w, x, y, z), alpha = 252 + the index of the dropped (largest) one
      const a = (Q[p] / 255 - 0.5) * Math.SQRT2, b = (Q[p + 1] / 255 - 0.5) * Math.SQRT2, c = (Q[p + 2] / 255 - 0.5) * Math.SQRT2;
      const d = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c)), m = Q[p + 3] - 252;
      const [w, x, y, z] = m === 0 ? [d, a, b, c] : m === 1 ? [a, d, b, c] : m === 2 ? [a, b, d, c] : [a, b, c, d];
      setQuat(D.rot, i, x, y, z, w);
    } else {
      // v3: an exponential map in the alpha bytes of means_l, means_u and scales
      const x = (L[p + 3] - 128) / 127, y = (U[p + 3] - 128) / 127, z = (S[p + 3] - 128) / 127, l = Math.hypot(x, y, z), t = l * Math.PI / 2;
      const k = l > 1e-12 ? Math.sin(t) / l : Math.PI / 2;
      setQuat(D.rot, i, x * k, y * k, z * k, Math.cos(t));
    }
  }
  D.antialias = meta.model === 'antialiased';
  return D;
}

// RGBA bytes of an image, read without premultiplying or colour conversion (the SOG textures carry data in alpha)
async function imagePixels(blob) {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const gl = cv.getContext('webgl2');
  if (!gl) throw new Error('splat: WebGL2 is needed to read SOG images');
  try {
    const t = gl.createTexture(), fb = gl.createFramebuffer(), { width: w, height: h } = bmp, px = new Uint8Array(w * h * 4);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { width: w, height: h, data: px };
  } finally { bmp.close(); const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
}

/** Fetch and parse by extension: .splat, .ply, or a SOG meta.json (its webp files next to it). options.fetch: a
 *  fetch-like function (default globalThis.fetch). */
export async function loadSplats(url, { fetch: get = globalThis.fetch } = {}) {
  const u = String(url), ext = u.split(/[?#]/)[0].split('.').pop().toLowerCase();
  const ok = async (x) => { const r = await get(x); if (!r.ok) throw new Error(`splat: ${x}: HTTP ${r.status}`); return r; };
  if (ext === 'splat') return parseSplat(await (await ok(u)).arrayBuffer());
  if (ext === 'ply') return parsePly(await (await ok(u)).arrayBuffer());
  if (ext === 'json') {
    const meta = await (await ok(u)).json(), files = new Set();
    for (const k of ['means', 'scales', 'quats', 'sh0']) for (const f of (meta[k] && meta[k].files) || []) files.add(f);
    const base = new URL(u, globalThis.location ? globalThis.location.href : 'file:///'), images = {};
    await Promise.all([...files].map(async (f) => { images[f] = await imagePixels(await (await ok(new URL(f, base).href)).blob()); }));
    return parseSog(meta, images);
  }
  throw new Error(`splat: unknown format ".${ext}" (use .splat, .ply or a SOG meta.json)`);
}

// ---- packing
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v) {
  // float -> IEEE half bits (round to nearest; sub-normals kept, overflow -> max)
  f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 255) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >>> (1 - e + 13)) + (((m | 0x800000) >>> (13 - e)) & 1);
  if (e > 30) return s | 0x7bff;
  return s | Math.min(0x7bff, (e << 10) + (m >>> 13) + ((m >>> 12) & 1));
}
function packQuat(x, y, z, w) {
  const q = [x, y, z, w];
  let m = 0;
  for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[m])) m = k;
  const sg = q[m] < 0 ? -1 : 1, r = [];
  for (let k = 0; k < 4; k++) if (k !== m) r.push(Math.max(0, Math.min(1023, Math.round((sg * q[k] * Math.SQRT1_2 + 0.5) * 1023))));
  return ((m << 30) | (r[0] << 20) | (r[1] << 10) | r[2]) >>> 0;
}

/** The splat texture data (exported for tests): RGBA32UI, `row` splats a row (two texels each). */
export function packSplats(D, row) {
  const n = D.count, h = Math.max(1, Math.ceil(n / row)), out = new Uint32Array(row * 2 * h * 4), cu = new Uint32Array(D.center.buffer, D.center.byteOffset, n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 8, c = i * 4;
    out[o] = cu[i * 3]; out[o + 1] = cu[i * 3 + 1]; out[o + 2] = cu[i * 3 + 2];
    out[o + 3] = (D.color[c] | (D.color[c + 1] << 8) | (D.color[c + 2] << 16) | (D.color[c + 3] << 24)) >>> 0;
    out[o + 4] = packQuat(D.rot[c], D.rot[c + 1], D.rot[c + 2], D.rot[c + 3]);
    out[o + 5] = (half(D.scale[i * 3]) | (half(D.scale[i * 3 + 1]) << 16)) >>> 0;
    out[o + 6] = half(D.scale[i * 3 + 2]);
  }
  return { data: out, width: row * 2, height: h };
}

// ---- shaders
const VS = /* glsl */ `
precision highp usampler2D;
uniform usampler2D tSplat, tOrder;
uniform uint uCount;
uniform vec4 uView;      // target width, height (px), min footprint (px), anti-aliased (1) or not (0)
uniform vec3 uTint;      // sRGB -> world radiance: the world's light x gain
uniform vec4 uFx;        // effect: x progress, yzw the effect's own
uniform vec4 uFx2;
varying vec4 vCol;
varying vec2 vQ;
#include <fog_pars_vertex>
vec4 splatQuat(uint u) {
  vec3 v = (vec3(uvec3(u >> 20u, u >> 10u, u) & 1023u) / 1023.0 - 0.5) * 1.41421356;
  float w = sqrt(max(0.0, 1.0 - dot(v, v)));
  uint m = u >> 30u;
  return m == 0u ? vec4(w, v) : m == 1u ? vec4(v.x, w, v.yz) : m == 2u ? vec4(v.xy, w, v.z) : vec4(v, w);
}
float splatHash(uint x) { x = x * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; return float((x >> 22u) ^ x) / 4294967295.0; }
FX_DECL
void main() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // culled: outside the clip volume
  uint slot = uint(gl_InstanceID) * ${BATCH}u + uint(position.z);
  if (slot >= uCount) return;
  uint ow = uint(textureSize(tOrder, 0).x), id = texelFetch(tOrder, ivec2(slot % ow, slot / ow), 0).r;
  uint sw = uint(textureSize(tSplat, 0).x) >> 1;
  ivec2 uv = ivec2((id % sw) * 2u, id / sw);
  uvec4 A = texelFetch(tSplat, uv, 0), B = texelFetch(tSplat, uv + ivec2(1, 0), 0);
  vec3 c = uintBitsToFloat(A.xyz), c0 = c;
  vec4 col = vec4(uvec4(A.w, A.w >> 8, A.w >> 16, A.w >> 24) & 255u) / 255.0;
  vec4 q = splatQuat(B.x);
  vec3 s = vec3(unpackHalf2x16(B.y), unpackHalf2x16(B.z).x);
  float sid = splatHash(id);
  FX_CENTER
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0), clip = projectionMatrix * mvPosition;
  if (clip.w <= 0.0 || abs(clip.z) > clip.w) return;
  FX_COLOR
  if (col.a < 1.0 / 255.0) return;
  FX_SCALE
  // the footprint: Sigma' = J W R S S R' W' J' (W: model-view rotation, J: the projection's Jacobian, in pixels)
  float x = q.x, y = q.y, z = q.z, w = q.w;
  mat3 M = mat3(modelViewMatrix) * mat3(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + w * z), 2.0 * (x * z - w * y),
    2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + w * x),
    2.0 * (x * z + w * y), 2.0 * (y * z - w * x), 1.0 - 2.0 * (x * x + y * y));
  M[0] *= s.x; M[1] *= s.y; M[2] *= s.z;
  vec2 f = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * 0.5 * uView.xy;
  vec3 j0, j1;
  if (projectionMatrix[2][3] == 0.0) { j0 = vec3(f.x, 0.0, 0.0); j1 = vec3(0.0, f.y, 0.0); }
  else {
    float iz = -1.0 / mvPosition.z;
    vec2 lim = 1.3 / vec2(projectionMatrix[0][0], projectionMatrix[1][1]), t = clamp(mvPosition.xy * iz, -lim, lim);
    j0 = vec3(f.x * iz, 0.0, f.x * t.x * iz); j1 = vec3(0.0, f.y * iz, f.y * t.y * iz);
  }
  vec3 T0 = j0 * M, T1 = j1 * M;
  float a = dot(T0, T0), b = dot(T0, T1), d = dot(T1, T1);
  // extent: where the gaussian falls under 1/255 of opacity, at most 3 sigma (in sigmas squared)
  float k2 = min(2.0 * log(255.0 * min(col.a, 1.0)), 9.0);
  // too small to see: the largest radius is at most sqrt((a + d) k2), checked before the eigen decomposition
  if (4.0 * (a + d) * k2 < uView.z * uView.z) return;
  float det0 = a * d - b * b;
  a += 0.3; d += 0.3;
  if (uView.w > 0.5) { col.a *= sqrt(max(det0 / (a * d - b * b), 0.0)); k2 = min(2.0 * log(255.0 * min(col.a, 1.0)), 9.0); if (k2 <= 0.0) return; }
  float mid = 0.5 * (a + d), r = length(vec2(0.5 * (a - d), b)), l1 = mid + r, l2 = max(mid - r, 0.1);
  vec2 e = vec2(b, l1 - a);
  float el = length(e);
  e = el > 1e-12 ? e / el : vec2(1.0, 0.0);
  float r1 = min(sqrt(l1 * k2), 1024.0), r2 = min(sqrt(l2 * k2), 1024.0);
  vec2 px = clip.w * 2.0 / uView.xy;
  if (any(greaterThan(abs(clip.xy) - r1 * px, vec2(clip.w)))) return;   // off the frustum's sides
  vec2 off = position.x * r1 * e + position.y * r2 * vec2(-e.y, e.x);
  gl_Position = clip + vec4(off * px, 0.0, 0.0);
  vQ = position.xy * sqrt(k2);
  vec3 lin = mix(col.rgb / 12.92, pow((col.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, col.rgb));
  vCol = vec4(lin * uTint, col.a);
  #include <fog_vertex>
}`;
const FS = /* glsl */ `
varying vec4 vCol;
varying vec2 vQ;
#include <fog_pars_fragment>
void main() {
  float a = vCol.a * exp(-0.5 * dot(vQ, vQ));
  if (a < 1.0 / 255.0) discard;
  gl_FragColor = vec4(vCol.rgb, min(a, 1.0));
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// the depth pass (opt-in): after the colour pass, the same quads write depth where a splat is at least `depth`
// opaque, so the SSAO, the temporal AA's reprojection and later transparent layers see the splats' surface
const FS_DEPTH = /* glsl */ `
varying vec4 vCol;
varying vec2 vQ;
uniform float uDepthA;
void main() {
  if (vCol.a * exp(-0.5 * dot(vQ, vQ)) < uDepthA) discard;
  gl_FragColor = vec4(0.0);
}`;
// the stand-in the playtest's ID pass (tools/see.mjs) draws through the patch hooks: a camera-facing square of
// 1.5 sigma per splat that is at least a third opaque
const SEE_DECL = /* glsl */ `
precision highp usampler2D;
uniform usampler2D tSplat, tOrder;
uniform uint uCount;`;
const SEE_WORLD = /* glsl */ `{
  uint slot = uint(gl_InstanceID) * ${BATCH}u + uint(position.z), ow = uint(textureSize(tOrder, 0).x);
  mgWorld = vec3(0.0);
  if (slot < uCount) {
    uint id = texelFetch(tOrder, ivec2(slot % ow, slot / ow), 0).r, sw = uint(textureSize(tSplat, 0).x) >> 1;
    ivec2 uv = ivec2((id % sw) * 2u, id / sw);
    uvec4 A = texelFetch(tSplat, uv, 0), B = texelFetch(tSplat, uv + ivec2(1, 0), 0);
    vec3 s = vec3(unpackHalf2x16(B.y), unpackHalf2x16(B.z).x);
    float k = (A.w >> 24) > 85u ? 1.5 * max(s.x, max(s.y, s.z)) * length(modelMatrix[0].xyz) : 0.0;
    mgWorld = (modelMatrix * vec4(uintBitsToFloat(A.xyz), 1.0)).xyz
      + k * (position.x * vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) + position.y * vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  }
}`;

// ---- effects: GLSL run per splat in the vertex shader. In scope: vec3 c (model-space centre, editable), c0 (the
// original), vec4 q (rotation xyzw), vec3 s (sigma per axis), vec4 col (sRGB rgb + opacity), float sid (0..1, a
// hash of the splat), uint id, uniform vec4 uFx (x = progress) and uFx2 (the effect's own), and its `decl`.
export const splatEffects = {
  /** grow in from `origin` (model space; default the bounds' centre) as progress goes 0 -> 1, behind a bright front
   *  `width` (a share of the radius) wide; rests at 1 */
  reveal: ({ origin, width = 0.12, glow = 2 } = {}) => ({
    name: 'reveal', rest: 1, params: [width, glow, 0],
    bind: (info) => [...(origin || info.centre), info.radius * (1 + width)],
    center: 'float fxT = clamp((uFx.x * uFx2.w - length(c0 - uFx2.xyz)) / max(uFx.y * uFx2.w, 1e-4), 0.0, 1.0);',
    color: 'col.rgb = min(col.rgb * (1.0 + uFx.z * 4.0 * fxT * (1.0 - fxT)), vec3(1.0)); if (fxT <= 0.0) col.a = 0.0;',
    scale: 's *= fxT * fxT * (3.0 - 2.0 * fxT);',
  }),
  /** dissolve as progress goes 0 -> 1: each splat in its own quarter of the time rises `rise` metres, glows warm,
   *  shrinks and fades; rests at 0 */
  dissolve: ({ rise = 0.5, glow = 1 } = {}) => ({
    name: 'dissolve', rest: 0, params: [rise, glow, 0],
    center: 'float fxT = clamp((uFx.x - 0.75 * sid) * 4.0, 0.0, 1.0); c.y += uFx.y * fxT * fxT;',
    color: 'col.rgb = mix(col.rgb, vec3(1.0, 0.55, 0.2), uFx.z * 4.0 * fxT * (1.0 - fxT)); col.a *= 1.0 - fxT;',
    scale: 's *= 1.0 - fxT * fxT;',
  }),
};

// ---- the kit
// a Blob worker per splat set (the URL is shared): no file to deploy, nothing shared between threads
let workerUrl = null;
function makeWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  try {
    workerUrl ||= URL.createObjectURL(new Blob([`const S=(${splatSorter})();onmessage=(e)=>{const m=e.data;if(m.centers){S.init(m.centers);return;}` +
      'const out=new Uint32Array(m.out),r=S.sort(m.d,m.o,out,m.eps);postMessage({out:m.out,id:m.id,count:r?r.count:-1,ms:r?r.ms:0},[m.out]);};'], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  } catch { return null; }
}

/** Data bounds (model space): { min, max, centre, radius } (radius around the centre). */
export function splatBounds(D) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < D.count; i++) for (let k = 0; k < 3; k++) { const v = D.center[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  if (!D.count) return { min: [0, 0, 0], max: [0, 0, 0], centre: [0, 0, 0], radius: 0 };
  const centre = min.map((v, k) => (v + max[k]) / 2);
  let r2 = 0;
  for (let i = 0; i < D.count; i++) r2 = Math.max(r2, (D.center[i * 3] - centre[0]) ** 2 + (D.center[i * 3 + 1] - centre[1]) ** 2 + (D.center[i * 3 + 2] - centre[2]) ** 2);
  return { min, max, centre, radius: Math.sqrt(r2) };
}

/** Add splats to ctx.root. options: position, rotation (Euler, radians), scale (number or xyz), minPixelSize (1),
 *  antialias (data.antialias: opacity compensation for captures trained with the AA filter), gain (1), light (true:
 *  the splats' colours are lit by the world's key light and sky, false: as captured at the golden hour), effect
 *  (splatEffects.reveal() / .dissolve() / your own), progress (1), worker (true), resort (1e-3: metres / direction
 *  change below which the sort is kept), depth (false; a number such as 0.5: a second pass writes depth where a splat is at least that opaque,
 *  for the SSAO and the temporal AA, ~+60 % splat cost at 1M), name ('splats'). */
export function addSplats(ctx, D, opts = {}) {
  const { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, minPixelSize = 1, antialias = !!D.antialias, gain = 1, light = true,
    worker: useWorker = true, resort = 1e-3, depth = false, name = 'splats' } = opts;
  if (!D || !(D.count >= 0) || !D.center) throw new TypeError('addSplats: data must come from loadSplats / parse*');
  if (![minPixelSize, gain, resort].every(Number.isFinite) || !(depth === false || (depth > 0 && depth <= 1))) throw new RangeError('addSplats: minPixelSize, gain and resort must be finite, depth false or 0 < depth <= 1');
  const n = D.count, max = Math.min(4096, (ctx.renderer && ctx.renderer.capabilities.maxTextureSize) || 4096), row = max / 2;
  const packed = packSplats(D, row);
  const tSplat = new THREE.DataTexture(packed.data, packed.width, packed.height, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
  tSplat.internalFormat = 'RGBA32UI';
  const ow = max, oh = Math.max(1, Math.ceil(n / ow)), orderLen = ow * oh;
  let order = new Uint32Array(orderLen), spare = new Uint32Array(orderLen);
  const tOrder = new THREE.DataTexture(order, ow, oh, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  tOrder.internalFormat = 'R32UI';
  for (const t of [tSplat, tOrder]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }

  // one batched quad geometry: corner xy, quad index z
  const pos = new Float32Array(BATCH * 12), idx = new Uint32Array(BATCH * 6);
  for (let k = 0; k < BATCH; k++) {
    pos.set([-1, -1, k, 1, -1, k, 1, 1, k, -1, 1, k], k * 12);
    idx.set([0, 1, 2, 0, 2, 3].map((v) => v + k * 4), k * 6);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.instanceCount = 0;
  const bounds = splatBounds(D);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...bounds.centre), bounds.radius);

  const U = {
    tSplat: { value: tSplat }, tOrder: { value: tOrder }, uCount: { value: 0 },
    uView: { value: new THREE.Vector4(1, 1, minPixelSize, antialias ? 1 : 0) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFx: { value: new THREE.Vector4(1, 0, 0, 0) }, uFx2: { value: new THREE.Vector4() }, uDepthA: { value: depth || 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...U }, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthTest: true, depthWrite: false, fog: true, blending: THREE.NormalBlending, side: THREE.DoubleSide, forceSinglePass: true,
  });
  material.userData.hooks = { vertexDecl: SEE_DECL, vertexWorld: SEE_WORLD, uniforms: { tSplat: U.tSplat, tOrder: U.tOrder, uCount: U.uCount } };
  const depthMat = depth ? new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS_DEPTH, transparent: true, colorWrite: false,
    depthTest: true, depthWrite: true, side: THREE.DoubleSide, forceSinglePass: true }) : null;
  let effect = null;
  function setEffect(fx) {
    effect = fx || null;
    const g = (k) => (effect && effect[k]) || '';
    material.vertexShader = VS.replace('FX_DECL', g('decl')).replace('FX_CENTER', g('center')).replace('FX_COLOR', g('color')).replace('FX_SCALE', g('scale'));
    if (depthMat) { depthMat.vertexShader = material.vertexShader; depthMat.needsUpdate = true; }
    if (effect) {
      const p = effect.params || [0, 0, 0];
      U.uFx.value.set(U.uFx.value.x, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      U.uFx2.value.fromArray(effect.bind ? effect.bind({ ...bounds, count: n }) : [0, 0, 0, 0]);
      Object.assign(material.uniforms, effect.uniforms || {});
      if (depthMat) Object.assign(depthMat.uniforms, effect.uniforms || {});
    }
    material.needsUpdate = true; fxDirty = true;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 5; mesh.userData.collide = false; mesh.userData.mgNoCapture = true;
  mesh.position.fromArray(position); mesh.rotation.fromArray(rotation);
  if (Array.isArray(scale)) mesh.scale.fromArray(scale); else mesh.scale.setScalar(scale);
  if (depthMat) {
    // drawn right after the colour pass (a child: same transform, shown and hidden with it)
    const dm = new THREE.Mesh(geometry, depthMat);
    dm.name = name + ':depth'; dm.frustumCulled = false; dm.castShadow = dm.receiveShadow = false;
    dm.renderOrder = 5.5; dm.userData.collide = false; dm.userData.mgNoCapture = true;
    mesh.add(dm);
  }

  // ---- sorting: on the worker while frames go by, on this thread for the very first frame (or without workers)
  const centers = D.center.slice();
  let w = useWorker ? makeWorker() : null, local = null, pending = null, sortFresh = false, fxDirty = false, stale = false, flags = 0;
  const stats = { sorts: 0, skipped: 0, lastMs: 0, maxMs: 0, totalMs: 0, visible: 0, worker: !!w };
  let applied = null;
  const waiting = [], anchor = new THREE.Vector3(Infinity, 0, 0), cp = new THREE.Vector3(), cd = new THREE.Vector3();
  if (w) {
    w.onmessage = (e) => { const k = pending; pending = null; apply(new Uint32Array(e.data.out), e.data.count, e.data.ms, k); };
    w.onerror = () => { w.terminate(); w = null; stats.worker = false; pending = null; };
    const c = centers.slice();
    w.postMessage({ centers: c }, [c.buffer]);
  }
  function apply(arr, count, ms, k) {
    spare = order; order = arr;
    tOrder.image.data = order; tOrder.needsUpdate = true;
    U.uCount.value = count; geometry.instanceCount = Math.ceil(count / BATCH);
    applied = k;
    stats.sorts++; stats.lastMs = ms; stats.maxMs = Math.max(stats.maxMs, ms); stats.totalMs += ms; stats.visible = count;
    if (stale) { sortFresh = true; stale = false; }
    while (waiting.length) waiting.shift()();
  }
  // a model-space centre c lies dot(c, d) + o metres in front of the eye, d = (model 3x3)' x the view direction
  function viewKey(camera) {
    camera.getWorldPosition(cp); camera.getWorldDirection(cd);
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    return { d: [e[0] * cd.x + e[1] * cd.y + e[2] * cd.z, e[4] * cd.x + e[5] * cd.y + e[6] * cd.z, e[8] * cd.x + e[9] * cd.y + e[10] * cd.z],
      o: (e[12] - cp.x) * cd.x + (e[13] - cp.y) * cd.y + (e[14] - cp.z) * cd.z };
  }
  const near = (a, b) => !!a && Math.abs(a.d[0] - b.d[0]) < resort && Math.abs(a.d[1] - b.d[1]) < resort && Math.abs(a.d[2] - b.d[2]) < resort && Math.abs(a.o - b.o) < resort;
  const outBuffer = () => (spare.length === orderLen ? spare : new Uint32Array(orderLen));
  function sortSync(k) {
    if (!local) { local = splatSorter(); local.init(centers); }
    const out = outBuffer(), r = local.sort(k.d, k.o, out, 0);
    apply(out, r.count, r.ms, k);
    return r.ms;
  }
  function request(k) {
    if (near(applied, k) || (pending && near(pending, k))) { stats.skipped++; return; }
    if (pending) return;   // one sort in flight; the next frame asks again
    const out = outBuffer();
    spare = new Uint32Array(0); pending = k;
    w.postMessage({ d: k.d, o: k.o, eps: 0, out: out.buffer }, [out.buffer]);
  }
  const vsize = new THREE.Vector2(), G = ctx.G;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    if (rt) U.uView.value.set(rt.width, rt.height, minPixelSize, antialias ? 1 : 0);
    else { renderer.getDrawingBufferSize(vsize); U.uView.value.set(vsize.x, vsize.y, minPixelSize, antialias ? 1 : 0); }
    lightTint(U.uTint.value);
    // the sort follows the first sub-frame of a frame (the others only jitter the projection, or move the lens)
    if (G && G.uFrame.value !== 0 && applied) return;
    const k = viewKey(camera);
    // the first frame (and every frame without a worker) is sorted before it is drawn
    if (!applied || !w) { if (!near(applied, k)) sortSync(k); else stats.skipped++; return; }
    if (!near(applied, k)) {
      stale = true;
      camera.getWorldPosition(cp);
      if (cp.distanceTo(anchor) > 0.05) { anchor.copy(cp); flags = 0; }
    }
    request(k);
  };
  // light: the world's key light and sky as a matte object of that colour receives them on average over its sides
  // (splats have no normals); unlit: that level at the golden hour, whatever the time
  function lightTint(t) {
    const lit = light && G, k = lit ? G.uKeyColor.value : GOLD, sky = SKY * (lit ? G.uSkyLight.value : 1) + AMB;
    t.set(k.x * KEY + sky * 0.9, k.y * KEY + sky * 0.95, k.z * KEY + sky * 1.05).multiplyScalar(gain);
  }

  ctx.root.add(mesh);
  setEffect(opts.effect || null);
  U.uFx.value.x = opts.progress ?? (effect && effect.rest !== undefined ? effect.rest : 1);
  const handle = {
    mesh, count: n, bounds, stats,
    get progress() { return U.uFx.value.x; },
    set progress(v) { if (v !== U.uFx.value.x) { U.uFx.value.x = v; fxDirty = true; } },
    get effect() { return effect; },
    setEffect,
    /** true once after something changed the image: the progress, the effect, or a sort that landed for a view drawn
     *  with an older one (at most twice while the view stands still: a moving lens, depth of field, would otherwise
     *  ask for its sub-frames' sorts for ever). Return it from play's onStep so a still view is drawn again. */
    changed() {
      const sorted = sortFresh && flags < 2, r = fxDirty || sorted;
      if (sorted) flags++;
      sortFresh = fxDirty = false;
      return r;
    },
    /** sort now, on this thread, for `camera` (tests; a host that renders a single still): the ms it took */
    sortNow(camera) { stale = false; return sortSync(viewKey(camera)); },
    /** resolves once the sort in flight (if any) is in */
    sorted() { return pending ? new Promise((r) => waiting.push(r)) : Promise.resolve(); },
    dispose() {
      mesh.removeFromParent(); geometry.dispose(); material.dispose(); if (depthMat) depthMat.dispose(); tSplat.dispose(); tOrder.dispose();
      if (w) w.terminate();
      w = null;
    },
  };
  return handle;
}

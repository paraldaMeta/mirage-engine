// Node checks for the splat kit (kits/splat.js): the three parsers against the demo's writers (a round trip through
// each format), the texture packing (decoded the way the vertex shader decodes it), and the counting sort against a
// full CPU sort on small sets. The GPU side is examples/demos/splats/splat-check.mjs.
import * as THREE from 'three';
import { parseSplat, parsePly, parseSog, packSplats, splatSorter, splatBounds, addSplats, splatEffects } from './src/kits/splat.js';
import { makeHill } from '../../examples/demos/splats/hill.js';
import { writeSplat, writePly, writeSog } from '../../examples/demos/splats/formats.mjs';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };
const D = makeHill({ count: 6000, seed: 3 });
const again = makeHill({ count: 6000, seed: 3 });
ok(D.center.every((v, i) => v === again.center[i]) && D.color.every((v, i) => v === again.color[i]), 'the hill is deterministic');
ok(D.center.every(Number.isFinite) && D.scale.every((v) => v > 0) && D.rot.every(Number.isFinite), 'the hill is finite with positive scales');

// worst differences between two data sets
function diff(A, B) {
  const r = { pos: 0, scale: 0, rgb: 0, a: 0, rot: 0 };
  for (let i = 0; i < A.count; i++) {
    for (let k = 0; k < 3; k++) {
      r.pos = Math.max(r.pos, Math.abs(A.center[i * 3 + k] - B.center[i * 3 + k]));
      r.scale = Math.max(r.scale, Math.abs(Math.log(A.scale[i * 3 + k] / B.scale[i * 3 + k])));
      r.rgb = Math.max(r.rgb, Math.abs(A.color[i * 4 + k] - B.color[i * 4 + k]));
    }
    r.a = Math.max(r.a, Math.abs(A.color[i * 4 + 3] - B.color[i * 4 + 3]));
    let d = 0;
    for (let k = 0; k < 4; k++) d += A.rot[i * 4 + k] * B.rot[i * 4 + k];
    r.rot = Math.max(r.rot, 1 - Math.abs(d));
  }
  return r;
}
const sp = parseSplat(writeSplat(D).buffer), ds = diff(D, sp);
ok(sp.count === D.count && ds.pos === 0 && ds.scale === 0 && ds.rgb === 0 && ds.a === 0 && ds.rot < 2e-3, `.splat round trip ${JSON.stringify(ds)}`);
const ply = writePly(D), pp = parsePly(ply.buffer), dp = diff(D, pp);
ok(pp.count === D.count && dp.pos === 0 && dp.scale < 1e-6 && dp.rgb <= 1 && dp.a <= 1 && dp.rot < 1e-6, `.ply round trip ${JSON.stringify(dp)}`);
const sog = writeSog(D, { encode: false }), images = {};
for (const [f, data] of Object.entries(sog.raw)) images[f] = { width: sog.width, height: sog.height, data };
const sg = parseSog(JSON.parse(JSON.stringify(sog.meta)), images), dg = diff(D, sg);
// SOG is lossy: 16-bit log-space means, 256-level codebooks, 8-bit smallest-three rotations
ok(sg.count === D.count && dg.pos < 2e-3 && dg.scale < 0.08 && dg.rgb === 0 && dg.a === 0 && dg.rot < 2e-3, `SOG round trip ${JSON.stringify(dg)}`);
// a .ply with an extra element before the vertices, doubles, and higher SH columns (ignored)
{
  const props = ['double x', 'double y', 'double z', 'float f_dc_0', 'float f_dc_1', 'float f_dc_2', ...Array.from({ length: 9 }, (_, k) => `float f_rest_${k}`), 'float opacity', 'float scale_0', 'float scale_1', 'float scale_2', 'float rot_0', 'float rot_1', 'float rot_2', 'float rot_3'];
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment test\nelement extra 2\nproperty uchar k\nelement vertex 1\n${props.map((p) => `property ${p}\n`).join('')}end_header\n`);
  const buf = new ArrayBuffer(head.length + 2 + 3 * 8 + 20 * 4), v = new DataView(buf);
  new Uint8Array(buf).set(head);
  let o = head.length + 2;
  [1.5, -2, 3.25].forEach((x) => { v.setFloat64(o, x, true); o += 8; });
  [0, 0, 0, ...Array(9).fill(9), 0, Math.log(0.1), Math.log(0.2), Math.log(0.3), 1, 0, 0, 0].forEach((x) => { v.setFloat32(o, x, true); o += 4; });
  const p = parsePly(buf);
  ok(p.count === 1 && p.center[0] === 1.5 && p.center[1] === -2 && p.color[0] === 128 && p.color[3] === 128 && Math.abs(p.scale[2] - 0.3) < 1e-6 && p.rot[3] === 1, '.ply: other elements, doubles, f_rest ignored');
  let threw = 0;
  for (const bad of ['ply\nformat ascii 1.0\nelement vertex 0\nend_header\n', 'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n']) {
    try { parsePly(new TextEncoder().encode(bad).buffer); } catch { threw++; }
  }
  ok(threw === 2, '.ply: ascii and non-3DGS files throw');
  try { parseSplat(new ArrayBuffer(33)); } catch { threw++; }
  ok(threw === 3, '.splat: a partial record throws');
}

// packing, decoded as the vertex shader does
{
  const row = 64, P = packSplats(D, row), f = new Float32Array(1), u = new Uint32Array(f.buffer);
  const h2f = (h) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return s * (e ? 2 ** (e - 15) * (1 + m / 1024) : 2 ** -14 * (m / 1024)); };
  let worst = { pos: 0, scale: 0, rot: 0, rgba: 0 };
  for (let i = 0; i < D.count; i++) {
    const o = ((Math.floor(i / row) * row * 2) + (i % row) * 2) * 4, A = P.data.subarray(o, o + 4), B = P.data.subarray(o + 4, o + 8);
    for (let k = 0; k < 3; k++) { u[0] = A[k]; worst.pos = Math.max(worst.pos, Math.abs(f[0] - D.center[i * 3 + k])); }
    for (let k = 0; k < 4; k++) worst.rgba = Math.max(worst.rgba, Math.abs(((A[3] >>> (8 * k)) & 255) - D.color[i * 4 + k]));
    const s = [h2f(B[1] & 0xffff), h2f(B[1] >>> 16), h2f(B[2] & 0xffff)];
    for (let k = 0; k < 3; k++) worst.scale = Math.max(worst.scale, Math.abs(s[k] / D.scale[i * 3 + k] - 1));
    const v = [(B[0] >>> 20) & 1023, (B[0] >>> 10) & 1023, B[0] & 1023].map((x) => (x / 1023 - 0.5) * Math.SQRT2), w = Math.sqrt(Math.max(0, 1 - v[0] ** 2 - v[1] ** 2 - v[2] ** 2)), m = B[0] >>> 30;
    const q = m === 0 ? [w, ...v] : m === 1 ? [v[0], w, v[1], v[2]] : m === 2 ? [v[0], v[1], w, v[2]] : [...v, w];
    worst.rot = Math.max(worst.rot, 1 - Math.abs(q.reduce((a, x, k) => a + x * D.rot[i * 4 + k], 0)));
  }
  ok(P.width === row * 2 && P.height === Math.ceil(D.count / row), 'packed texture size');
  ok(worst.pos === 0 && worst.rgba === 0 && worst.scale < 1e-3 && worst.rot < 1e-5, `packing decodes ${JSON.stringify(worst)}`);
}

// the counting sort against a full sort (far first, nothing behind the eye)
function check(Dset, eye, look, label) {
  const dir = new THREE.Vector3(...look).sub(new THREE.Vector3(...eye)).normalize(), d = dir.toArray(), o = -dir.dot(new THREE.Vector3(...eye));
  const S = splatSorter(); S.init(Dset.center);
  const out = new Uint32Array(Dset.count), r = S.sort(d, o, out);
  const depth = (i) => Dset.center[i * 3] * d[0] + Dset.center[i * 3 + 1] * d[1] + Dset.center[i * 3 + 2] * d[2] + o;
  const ref = [...Array(Dset.count).keys()].filter((i) => depth(i) > 0).sort((a, b) => depth(b) - depth(a));
  const got = Array.from(out.subarray(0, r.count));
  const same = ref.length === got.length && new Set(got).size === got.length && got.every((i) => depth(i) > 0);
  let exact = 0, inv = 0, inPlace = 0;
  for (let k = 0; k < got.length; k++) { if (got[k] === ref[k]) exact++; if (k && depth(got[k]) > depth(got[k - 1])) { inPlace++; inv = Math.max(inv, depth(got[k]) - depth(got[k - 1])); } }
  const span = depth(ref[0]) - depth(ref[ref.length - 1]);
  ok(same, `${label}: the sort keeps every splat in front of the eye once (${got.length} of ${ref.length})`);
  ok(inv <= span * 4 / r.buckets + 1e-9, `${label}: order within a bucket's depth (worst inversion ${inv.toExponential(2)} m of ${span.toFixed(2)} m, ${inPlace} adjacent pairs swapped)`);
  ok(S.sort(d, o, out) === null && S.sort(d.map((x) => x + 5e-4), o, out) === null && S.sort(d, o + 0.01, out) !== null, `${label}: a still camera (< 1e-3) skips the sort`);
  return { exact: exact / got.length, inv, span };
}
const small = makeHill({ count: 2000, seed: 5 });
const r1 = check(small, [0, 1.7, 9], [0, 1, 0], 'outside');
const r2 = check(small, [0.3, 1.5, 0.2], [3, 1, -2], 'inside (half behind)');
const r3 = check(D, [-7, 3, 5], [0, 1, 0], '6000 splats');
console.log(`  sort vs a full CPU sort: exact positions ${(100 * r1.exact).toFixed(1)} % / ${(100 * r2.exact).toFixed(1)} % / ${(100 * r3.exact).toFixed(1)} %, worst inversion ${r3.inv.toExponential(1)} m`);
// timing on the main thread (Node): 1M splats
{
  const big = makeHill({ count: 1000000, seed: 2 }), S = splatSorter(), out = new Uint32Array(big.count);
  S.init(big.center);
  const ms = [];
  for (let k = 0; k < 6; k++) { const a = k * 0.4; ms.push(S.sort([Math.sin(a), -0.2, Math.cos(a)], 8, out).ms); }
  ms.sort((a, b) => a - b);
  console.log(`  sort 1M splats (Node, this machine): median ${ms[3].toFixed(1)} ms, best ${ms[0].toFixed(1)} ms`);
}

// addSplats without a GPU: the mesh, its options and the effects' shader text
{
  const root = new THREE.Group(), G = { uKeyColor: { value: new THREE.Vector3(7, 4.9, 3) }, uSkyLight: { value: 1 }, uFrame: { value: 0 } };
  const s = addSplats({ root, G }, small, { position: [1, 0, 2], effect: splatEffects.reveal(), worker: false });
  ok(root.children[0] === s.mesh && s.mesh.material.transparent && s.mesh.material.depthWrite === false && s.mesh.userData.mgNoCapture, 'one transparent mesh, no depth write, out of the capture');
  ok(s.progress === 1 && /fxT/.test(s.mesh.material.vertexShader) && !/FX_/.test(s.mesh.material.vertexShader), 'reveal rests at 1, its GLSL is in');
  s.setEffect(splatEffects.dissolve());
  ok(/c\.y \+=/.test(s.mesh.material.vertexShader) && s.changed() === true && s.changed() === false, 'setEffect swaps the GLSL and asks for one redraw');
  s.progress = 0.3;
  ok(s.changed() === true, 'progress asks for a redraw');
  const b = splatBounds(small);
  ok(s.mesh.geometry.boundingBox.min.x === b.min[0] && b.radius > 3, 'bounds from the data');
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 2, 12); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
  root.updateMatrixWorld(true);
  s.sortNow(cam);
  ok(s.stats.visible === small.count && s.mesh.material.uniforms.uCount.value === small.count && s.mesh.geometry.instanceCount === Math.ceil(small.count / 128), 'sortNow fills the order and the draw count');
  s.dispose();
  ok(root.children.length === 0, 'dispose removes the mesh');
  let threw = 0;
  try { addSplats({ root }, {}); } catch { threw++; }
  try { addSplats({ root }, small, { gain: NaN }); } catch { threw++; }
  ok(threw === 2, 'bad data and options throw');
}

if (fails) { console.error(`splat checks: ${fails} FAILED`); process.exit(1); }
console.log('splat checks: ok');

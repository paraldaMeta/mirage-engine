#!/usr/bin/env node
// Mirage original code. Headless check of the surface library (@miragekit/assets/surfaces on core's framework) on a real GPU, through
// the materials demo (examples/demos/materials, packaged into its out/ first).
//
// usage: node packages/tools/src/surfaces-check.mjs [--only concrete,asphalt] [--out dir]
//        (needs Chrome with a GPU: not in npm test; the GPU-free parts are packages/assets/surfaces.check.mjs)
// Checked:
//   - every kind and variant compiles, procedural and baked, on Standard / Physical, dry and wet (no shader error,
//     no page error);
//   - a baked set read back: its albedo (linear) and roughness sit in the kind's documented reference ranges (the
//     1st..99th percentile inside the range, widened by the cavity the bake folds into the albedo); metalness only
//     0 or 1 except where the kind says mixed;
//   - baked == procedural at the bake's scale: one tile drawn texel for texel through the real material path (the
//     debug output: albedo, roughness, height) with the runtime layer off: the mean difference under 1/100, the
//     99th percentile under 4/100;
//   - a bake is deterministic: the same spec twice gives the same bytes; another seed changes them (regular patterns:
//     a car's paint, a grate, little);
//   - materials that differ only by numbers share a program: five concretes with other colours, ages and seeds add
//     one program per mode;
//   - bake time: the twelve kinds a city street uses, baked from cold (compiles included), synced, in under 1 s;
//     the same in tier 'low' takes about a quarter of the memory;
//   - the opt-in paths compile: edge wear from the box (edges: 'box'), glass through the transmission pass.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demo = path.join(root, 'examples/demos/materials'), html = path.join(demo, 'out/materials.html');
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), demo, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });
let bad = 0;
const fail = (m) => { bad++; console.error('  FAIL ' + m); };

const b = await launch({ w: 640, h: 400 });
const page = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || /Shader Error|THREE\.WebGLProgram/.test(m.text())) errors.push(m.text().slice(0, 800)); });
await page.goto(pathToFileURL(html) + '?ui=0&w=640&h=400&spp=1');
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
const only = opt('only');

// 1. compile everything
const compiled = await page.evaluate((only) => {
  const { lib, SURFACES, SURFACE_KINDS, world, THREE } = window.__mirage, R = world.renderer;
  const scene = new THREE.Scene(), out = { materials: 0 };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const [k, K] of Object.entries(SURFACE_KINDS)) {
    if (only && !only.split(',').includes(k)) continue;
    for (const v of K.variants) for (const mode of K.live ? ['procedural'] : ['procedural', 'baked']) for (const wet of K.live || k === 'glass' ? [false] : [false, true]) {
      const m = lib.material(SURFACES[k]({ variant: v }), { mapping: 'tri', mode, wet });
      scene.add(new THREE.Mesh(geo, m)); out.materials++;
    }
  }
  // the opt-in paths: edge wear from the box (unbevelled meshes), glass through the transmission pass
  if (!only || only.split(',').includes('paintedMetal')) { scene.add(new THREE.Mesh(geo, lib.material(SURFACES.paintedMetal(), { mapping: 'tri', edges: 'box' }))); out.materials++; }
  if (!only || only.split(',').includes('glass')) for (const v of SURFACE_KINDS.glass.variants) { scene.add(new THREE.Mesh(geo, lib.material(SURFACES.glass({ variant: v }), { transmission: true }))); out.materials++; }
  window.__mirage.setWetness(0.6);
  R.compile(scene, world.camera);
  R.setRenderTarget(null); R.render(scene, world.camera);
  out.programs = R.info.programs.length;
  window.__mirage.setWetness(0);
  return out;
}, only);
console.log(`compile: ${compiled.materials} materials, ${compiled.programs} programs in the renderer`);
if (errors.length) fail('compile errors:\n' + [...new Set(errors)].slice(0, 4).join('\n---\n'));

// 2. ranges of a baked set; 3. baked == procedural; 4. determinism
const R2 = await page.evaluate((only) => {
  const { SURFACES, SURFACE_KINDS, bakeSurface, world, THREE, lib } = window.__mirage, R = world.renderer;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  const res = {};
  for (const [k, K] of Object.entries(SURFACE_KINDS)) {
    if (K.live || (only && !only.split(',').includes(k))) continue;
    for (const v of K.variants) {
      const spec = SURFACES[k]({ variant: v, variation: 0, dirt: 0, edgeWear: 0 });
      const N = 256;
      const s = bakeSurface(R, spec, { size: N });
      const c = new Uint8Array(N * N * 4), n = new Uint8Array(N * N * 4);
      R.readRenderTargetPixels(s.target, 0, 0, N, N, c, undefined, 0);
      R.readRenderTargetPixels(s.target, 0, 0, N, N, n, undefined, 1);
      const lum = [], rough = [], metal = new Set();
      for (let i = 0; i < N * N; i++) {
        lum.push(Math.max(lin(c[4 * i]), lin(c[4 * i + 1]), lin(c[4 * i + 2])));
        rough.push(c[4 * i + 3] / 255); metal.add(Math.round(n[4 * i + 3] / 255 * 4) / 4);
      }
      lum.sort((a, b) => a - b); rough.sort((a, b) => a - b);
      // determinism: the same again, byte for byte; another seed differs
      const s2 = bakeSurface(R, spec, { size: N }), c2 = new Uint8Array(N * N * 4);
      R.readRenderTargetPixels(s2.target, 0, 0, N, N, c2, undefined, 0);
      let same = true; for (let i = 0; i < c.length; i++) if (c[i] !== c2[i]) { same = false; break; }
      const s3 = bakeSurface(R, SURFACES[k]({ variant: v, seed: 77 }), { size: N }), c3 = new Uint8Array(N * N * 4);
      R.readRenderTargetPixels(s3.target, 0, 0, N, N, c3, undefined, 0);
      let diff = 0; for (let i = 0; i < c.length; i++) if (c[i] !== c3[i]) diff++;
      // baked == procedural: one tile through the material path, texel for texel (ortho camera over the ground)
      const T = spec.tile, rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType });
      const cam = new THREE.OrthographicCamera(0, T, T, 0, 0.1, 10); cam.position.set(0, 1, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
      cam.left = 0; cam.right = T; cam.top = 0; cam.bottom = -T; cam.updateProjectionMatrix();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(T, T).rotateX(-Math.PI / 2).translate(T / 2, 0, T / 2));
      const sc = new THREE.Scene(); sc.add(plane);
      const draw = (mode, debug) => {
        const m = lib.material(spec, { mapping: 'ground', mode, debug, breaker: false, lod: 2, size: N, params: { fog: false } });
        m.toneMapped = false; plane.material = m;
        R.setRenderTarget(rt); R.render(sc, cam); const f = new Float32Array(N * N * 4); R.readRenderTargetPixels(rt, 0, 0, N, N, f); R.setRenderTarget(null);
        m.dispose(); return f;
      };
      const cmp = {};
      for (const d of ['albedo', 'rough', 'height']) {
        const a = draw('procedural', d), bb = draw('baked', d), e = [];
        for (let i = 0; i < N * N; i++) e.push(Math.abs(a[4 * i] - bb[4 * i]) + Math.abs(a[4 * i + 1] - bb[4 * i + 1]) + Math.abs(a[4 * i + 2] - bb[4 * i + 2]));
        e.sort((x, y) => x - y);
        cmp[d] = { mean: e.reduce((x, y) => x + y, 0) / e.length / 3, p99: pct(e, 0.99) / 3 };
      }
      rt.dispose(); s.target.dispose(); s2.target.dispose(); s3.target.dispose();
      res[`${k}:${v}`] = { refs: (K.refs.variants || {})[v] || K.refs, lum: [pct(lum, 0.01), pct(lum, 0.5), pct(lum, 0.99)], rough: [pct(rough, 0.01), pct(rough, 0.99)], metal: [...metal].sort(), same, seedDiff: diff / c.length, cmp };
    }
  }
  return res;
}, only);
let worst = { mean: 0, p99: 0 };
for (const [name, r] of Object.entries(R2)) {
  const [lo, hi] = r.refs.albedo, [rlo, rhi] = r.refs.rough;
  if (r.lum[1] < lo * 0.7 || r.lum[1] > hi * 1.15) fail(`${name}: median albedo ${r.lum[1].toFixed(3)} outside ${lo}..${hi}`);
  if (r.lum[2] > Math.min(1, hi * 1.35)) fail(`${name}: 99th pct albedo ${r.lum[2].toFixed(3)} above ${hi}`);
  if (r.rough[0] < rlo - 0.08 || r.rough[1] > Math.min(1, rhi + 0.08)) fail(`${name}: roughness ${r.rough.map((x) => x.toFixed(2))} outside ${rlo}..${rhi}`);
  if (r.refs.metal === 0 && r.metal.some((m) => m > 0)) fail(`${name}: metalness ${r.metal} on a dielectric`);
  if (r.refs.metal === 1 && r.metal.some((m) => m < 1 && m > 0)) fail(`${name}: in-between metalness ${r.metal} on a metal`);
  if (!r.same) fail(`${name}: two bakes of the same spec differ`);
  if (!(r.seedDiff > 0.001)) fail(`${name}: another seed changed only ${(r.seedDiff * 100).toFixed(2)} % of the bytes`);
  for (const [d, e] of Object.entries(r.cmp)) {
    worst.mean = Math.max(worst.mean, e.mean); worst.p99 = Math.max(worst.p99, e.p99);
    if (e.mean > 0.01 || e.p99 > 0.04) fail(`${name}: baked vs procedural ${d}: mean ${e.mean.toFixed(4)}, p99 ${e.p99.toFixed(4)}`);
  }
}
console.log(`sets: ${Object.keys(R2).length} baked and read back; baked vs procedural worst mean ${worst.mean.toFixed(4)}, worst p99 ${worst.p99.toFixed(4)}`);

// 5. programs shared; 6. bake budget
const R3 = await page.evaluate(() => {
  const { SURFACES, world, THREE, lib, createSurfaces } = window.__mirage, R = world.renderer;
  const scene = new THREE.Scene(), geo = new THREE.BoxGeometry(1, 1, 1);
  const add = (m) => scene.add(new THREE.Mesh(geo, m));
  R.compile(scene, world.camera);
  const before = R.info.programs.length;
  for (const mode of ['procedural', 'baked']) for (let i = 0; i < 5; i++) add(lib.material(SURFACES.concrete({ color: [0.2 + 0.03 * i, 0.3, 0.3], age: i / 5, seed: 3 + i, variant: i % 2 ? 'cast' : 'precast' }), { mapping: 'wall', mode }));
  R.compile(scene, world.camera);
  const added = R.info.programs.length - before;
  // a street's kinds, from cold: a fresh library (its own cache), bakes synced by a readback
  const fresh = createSurfaces(world, { mode: 'baked' });
  const gl = R.getContext(), px = new Uint8Array(4);
  const street = ['asphalt', 'concrete', 'paving', 'brick', 'corrugated', 'paintedMetal', 'stainless', 'powderCoat', 'plastic', 'rubber', 'fabric', 'wood'];
  const t0 = performance.now();
  for (const k of street) { const s = fresh.bake(SURFACES[k]({ seed: 900 + k.length })); R.setRenderTarget(s.target); }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); R.setRenderTarget(null);
  const ms = performance.now() - t0, st = fresh.stats();
  fresh.dispose();
  // the low-memory tier: the same street, every set at half its size
  const low = createSurfaces(world, { mode: 'baked', tier: 'low' });
  const t1 = performance.now();
  for (const k of street) { const s = low.bake(SURFACES[k]({ seed: 900 + k.length })); R.setRenderTarget(s.target); }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); R.setRenderTarget(null);
  const msLow = performance.now() - t1, stLow = low.stats();
  low.dispose();
  return { added, ms, mb: st.bytes / 1048576, n: street.length, msLow, mbLow: stLow.bytes / 1048576 };
});
console.log(`programs: ten concretes (two variants, five numbers each, two modes) added ${R3.added}; a street's ${R3.n} kinds baked in ${R3.ms.toFixed(0)} ms, ${R3.mb.toFixed(0)} MB; tier 'low' ${R3.msLow.toFixed(0)} ms, ${R3.mbLow.toFixed(0)} MB`);
if (!(R3.mbLow < R3.mb * 0.3)) fail(`tier 'low' took ${R3.mbLow.toFixed(0)} MB (expected about a quarter of ${R3.mb.toFixed(0)})`);
if (R3.added !== 2) fail(`ten concrete materials added ${R3.added} programs (expected 2: one per mode)`);
if (R3.ms > 1000) fail(`baking ${R3.n} kinds took ${R3.ms.toFixed(0)} ms (budget 1000)`);
if (errors.length) fail('page errors:\n' + [...new Set(errors)].slice(0, 4).join('\n---\n'));
const outDir = opt('out');
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'surfaces-check.json'), JSON.stringify({ compiled, sets: R2, programs: R3 }, null, 1)); }
await b.close();
if (bad) { console.error(`surfaces-check: ${bad} FAILED`); process.exit(1); }
console.log('surfaces-check: ok');

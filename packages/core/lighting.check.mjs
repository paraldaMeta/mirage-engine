// Mirage original code.
// The pure parts of the lighting features (no GPU): `node packages/core/lighting.check.mjs`, also run by check.mjs.
// The GPU paths are checked in Chrome by packages/tools/src/lighting-check.mjs.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInjector, isLit } from './src/inject.js';
import { csmConfig, csmSplits, sliceSphere, snapToTexel, CSM_DEFAULTS } from './src/csm.js';
import { giConfig, giGrid, giCell, giTile, GI_DEFAULTS } from './src/gi.js';
import { lightsConfig, clusterSlice, sphereSpan, tileAllocator, CLUSTER, LIGHTS_DEFAULTS } from './src/lights.js';
import { probesConfig, boxExit, probeWeight, PROBES_MAX } from './src/probes.js';
import * as core from './src/index.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// --- cascades
assert.equal(csmConfig(false), null);
assert.equal(csmConfig(true).cascades, CSM_DEFAULTS.cascades);
assert.equal(csmConfig({ cascades: 9, lambda: 3 }).cascades, 4, 'cascades clamp to 4');
assert.equal(csmConfig({ cascades: 1 }).cascades, 2);
{
  const s = csmSplits(4, 1, 160, 0.8);
  assert.equal(s.length, 5);
  assert.ok(near(s[0], 1) && near(s[4], 160), 'splits run near..far');
  for (let i = 1; i < 5; i++) assert.ok(s[i] > s[i - 1], 'splits rise');
  assert.ok(s[1] - s[0] < s[4] - s[3], 'near cascades are shorter');
  const lin = csmSplits(4, 1, 161, 0);
  assert.ok(near(lin[1] - lin[0], 40) && near(lin[3] - lin[2], 40), 'lambda 0 is linear');
  const log = csmSplits(2, 1, 100, 1);
  assert.ok(near(log[1], 10), 'lambda 1 is logarithmic');
}
{
  // the sphere holds all eight corners of the slice, whatever the field of view
  for (const [n, f, tx, ty] of [[1, 10, 0.5, 0.3], [10, 40, 1.2, 0.7], [0.5, 160, 0.9, 0.5], [5, 6, 2.5, 1.5]]) {
    const { z, r } = sliceSphere(n, f, tx, ty);
    for (const d of [n, f]) assert.ok(Math.hypot(d * tx, d * ty, d - z) <= r + 1e-6, `corner at ${d} inside (${n}..${f})`);
    assert.ok(z <= f + 1e-9);
  }
}
{
  // snapping keeps the depth along the light and moves by less than a texel on its plane; a sub-texel move snaps to the same place
  const right = [1, 0, 0], up = [0, 0.6, 0.8], d = [0, -0.8, 0.6], texel = 0.25;
  const c = [3.13, 7.77, -2.41], s = snapToTexel(c, right, up, d, texel);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => a.map((v, i) => v - b[i]);
  assert.ok(near(dot(s, d), dot(c, d)), 'depth kept');
  assert.ok(Math.abs(dot(sub(s, c), right)) <= texel / 2 + 1e-9 && Math.abs(dot(sub(s, c), up)) <= texel / 2 + 1e-9);
  assert.ok(near(dot(s, right) / texel, Math.round(dot(s, right) / texel)), 'on the texel grid');
  const s2 = snapToTexel([3.13 + 0.01, 7.77, -2.41], right, up, d, texel);
  assert.ok(near(dot(s2, right), dot(s, right)), 'a sub-texel move does not move the map');
}

// --- probe volume
assert.equal(giConfig(null), null);
assert.equal(giConfig({ spacing: 2 }), null, 'no box, no volume');
{
  const cfg = giConfig({ min: [0, 0, 0], max: [6, 3, 4.5] }), g = giGrid(cfg);
  assert.equal(cfg.spacing, GI_DEFAULTS.spacing);
  assert.deepEqual(g.counts, [5, 3, 4]);
  assert.ok(near(g.step[0], 1.5) && near(g.step[1], 1.5) && near(g.step[2], 1.5));
  assert.equal(g.probes, 60);
  // every probe has its own cell and its own tiles, all inside the atlas
  const seen = new Set(), tiles = new Set();
  for (let i = 0; i < g.probes; i++) {
    const c = giCell(g, i);
    assert.ok(c.every((v, k) => v >= 0 && v < g.counts[k]));
    seen.add(c.join());
    for (const vis of [false, true]) {
      const [x, y, t] = giTile(g, c, vis);
      assert.ok(x >= 0 && y >= 0 && x + t <= g.width && y + t <= g.height, 'tile inside the atlas');
      assert.ok(vis ? y >= g.irrH : y + t <= g.irrH, 'irradiance above, distances below');
      tiles.add(x + ',' + y);
    }
  }
  assert.equal(seen.size, 60); assert.equal(tiles.size, 120);
  const big = giGrid(giConfig({ min: [0, 0, 0], max: [100, 50, 100], spacing: 1, maxProbes: 1000 }));
  assert.ok(big.probes <= 1000, 'the grid thins to stay under maxProbes');
}

// --- clustered lights
assert.equal(lightsConfig(0), null);
assert.equal(lightsConfig(true).max, LIGHTS_DEFAULTS.max);
{
  assert.equal(clusterSlice(0.01, 0.1, 500), 0);
  assert.equal(clusterSlice(1e6, 0.1, 500), CLUSTER.z - 1, 'beyond far lands in the last slice');
  let last = -1;
  for (let d = 0.1; d < 500; d *= 1.3) { const s = clusterSlice(d, 0.1, 500); assert.ok(s >= last); last = s; }
  assert.equal(last, CLUSTER.z - 1);
  // sphereSpan against brute force: project points of the circle (in the axis' plane) and compare the extent
  const p = 1.7;
  for (const [c, z, r] of [[0, 10, 1], [3, 8, 2], [-6, 5, 1.5], [1, 2, 0.5], [9, 3, 1]]) {
    const [lo, hi] = sphereSpan(c, z, r, p);
    let a = Infinity, b = -Infinity;
    for (let i = 0; i < 720; i++) { const t = (i / 720) * Math.PI * 2, x = c + r * Math.cos(t), zz = z + r * Math.sin(t); if (zz > 1e-3) { a = Math.min(a, (x / zz) * p); b = Math.max(b, (x / zz) * p); } }
    a = Math.max(-1, Math.min(1, a)); b = Math.max(-1, Math.min(1, b));
    assert.ok(lo <= a + 1e-3 && hi >= b - 1e-3, `span holds the sphere (${c},${z},${r}): ${lo}..${hi} vs ${a}..${b}`);
    assert.ok(lo >= a - 0.02 && hi <= b + 0.02, 'and is tight');
  }
  assert.deepEqual(sphereSpan(0, 0.5, 1, p), [-1, 1], 'the camera inside the sphere: the whole axis');
  assert.deepEqual(sphereSpan(0.2, -0.3, 1, p), [-1, 1]);
}
{
  // buddy tiles: no two overlap, the atlas fills exactly, a freed tile comes back
  const A = tileAllocator(256), got = [];
  const take = (s) => { const xy = A.alloc(s); if (xy) got.push({ s, xy }); return xy; };
  assert.ok(take(128)); for (let i = 0; i < 8; i++) assert.ok(take(64)); assert.ok(take(128));
  assert.equal(take(64), null, 'full'); assert.equal(A.alloc(512), null, 'larger than the atlas');
  for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++) {
    const a = got[i], b = got[j];
    assert.ok(a.xy[0] + a.s <= b.xy[0] || b.xy[0] + b.s <= a.xy[0] || a.xy[1] + a.s <= b.xy[1] || b.xy[1] + b.s <= a.xy[1], 'tiles do not overlap');
  }
  assert.equal(got.reduce((n, t) => n + t.s * t.s, 0), 256 * 256);
  const f = got[3]; A.free(f.s, f.xy);
  assert.deepEqual(A.alloc(64), f.xy);
}

// --- reflection probes
assert.equal(probesConfig([]), null);
{
  const list = probesConfig(Array.from({ length: 7 }, (_, i) => ({ min: [i, 0, 0], max: [i + 2, 4, 6] })));
  assert.equal(list.length, PROBES_MAX);
  assert.deepEqual(list[1].position, [2, 2, 3], 'the capture point defaults to the box centre');
  assert.ok(near(boxExit([0, 0, 0], [1, 0, 0], [-2, -1, -1], [3, 1, 1]), 3));
  assert.ok(near(boxExit([0, 0, 0], [0, -1, 0], [-2, -1, -1], [3, 1, 1]), 1));
  const d = [0.6, 0.8, 0], t = boxExit([1, 0, 0], d, [-2, -1, -1], [3, 2, 1]);
  assert.ok(near(1 + d[0] * t, 2.5) && near(d[1] * t, 2), 'leaves through the nearer face (y = 2)');
  assert.equal(probeWeight([0, 0, 0], [-2, -2, -2], [2, 2, 2], 1), 1);
  assert.ok(near(probeWeight([1.5, 0, 0], [-2, -2, -2], [2, 2, 2], 1), 0.5));
  assert.equal(probeWeight([2.5, 0, 0], [-2, -2, -2], [2, 2, 2], 1), 0);
}

// --- injector
{
  const FS = 'uniform float x;\nvoid main() {\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n}';
  const inj = createInjector();
  assert.equal(inj.preview(FS).fragmentShader, FS, 'no part: the source is not touched');
  const mat = new THREE.MeshStandardMaterial(), basic = new THREE.MeshBasicMaterial(), key0 = mat.customProgramCacheKey();
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat), new THREE.Mesh(new THREE.BufferGeometry(), basic));
  assert.ok(isLit(mat) && !isLit(basic));
  assert.equal(inj.adopt(scene), 1, 'only lit materials are wrapped'); assert.equal(inj.adopt(scene), 0, 'once');
  assert.equal(mat.customProgramCacheKey(), key0, 'no part: the program key is the stock one');
  { const s = { fragmentShader: FS, uniforms: {} }; mat.onBeforeCompile(s, null); assert.equal(s.fragmentShader, FS, 'and so is the shader'); }
  const v0 = mat.version;
  inj.add({ id: 'b', order: 2, pars: 'uniform float mgB;', uniforms: { mgB: { value: 2 } }, apply: (fs, t) => t.swap(fs, 'IncidentLight directLight;', 'IncidentLight directLight; /*b*/', 'b') });
  inj.add({ id: 'a', order: 1, key: 'k4', pars: 'uniform float mgA;' });
  assert.equal(inj.key, 'a:k4,b');
  assert.ok(mat.version > v0, 'adopted materials recompile when the parts change');
  assert.notEqual(mat.customProgramCacheKey(), key0);
  const s = { fragmentShader: FS, uniforms: {} }; mat.onBeforeCompile(s, null);
  assert.ok(!s.fragmentShader.includes('#include <lights_fragment_begin>') && s.fragmentShader.includes('/*b*/'), 'the chunk is expanded and edited in the material, not in THREE.ShaderChunk');
  assert.ok(s.fragmentShader.indexOf('mgA;') < s.fragmentShader.indexOf('mgB;') && s.fragmentShader.indexOf('mgB;') < s.fragmentShader.indexOf('void main'), 'pars in order, before main');
  assert.equal(s.uniforms.mgB.value, 2);
  assert.ok(!THREE.ShaderChunk.lights_fragment_begin.includes('/*b*/'), 'three\'s chunk is untouched');
  inj.remove('a'); inj.remove('b');
  assert.equal(mat.customProgramCacheKey(), key0, 'parts removed: the stock key again');
}

// --- the package exports
for (const k of ['createLighting', 'CSM_DEFAULTS', 'GI_DEFAULTS', 'LIGHTS_DEFAULTS', 'PROBE_DEFAULTS']) assert.ok(core[k], k + ' is exported');
console.log('lighting check: ok');

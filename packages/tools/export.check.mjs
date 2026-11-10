// Node checks of the exporter's pure parts (no browser): node packages/tools/export.check.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { unwrap, layout, atlasUV, resolveBake, dilate, zipAligned, zipOffsets } from '@mirage/core/export';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const soup = (geo) => (geo.index ? geo.toNonIndexed() : geo).attributes.position.array;

// a box: six charts, one per face, each a w x h rectangle in metres
const box = unwrap(soup(new THREE.BoxGeometry(2, 1, 0.5)));
assert.equal(box.charts.length, 6, 'a box unwraps to six charts');
const dims = box.charts.map((c) => [+(c.maxU - c.minU).toFixed(3), +(c.maxV - c.minV).toFixed(3)].sort().join('x')).sort();
assert.deepEqual(dims, ['0.5x1', '0.5x1', '0.5x2', '0.5x2', '1x2', '1x2'], 'charts keep metric size: ' + dims);

// projected triangles keep counter-clockwise winding (they draw front-facing into the atlas)
const sphere = soup(new THREE.SphereGeometry(1, 24, 16));
const un = unwrap(sphere);
assert.ok(un.charts.length >= 6 && un.charts.length <= 12, 'a sphere: about one chart per axis direction, got ' + un.charts.length);
const lay = layout(un.charts, { size: 256, density: 64, pad: 3 });
assert.ok(lay && lay.size <= 256 && lay.density > 0, 'the sphere packs');
const uv = atlasUV(un, lay, 3);
let ccw = 0, tris = uv.length / 6;
for (let t = 0; t < tris; t++) {
  const [ax, ay, bx, by, cx, cy] = uv.subarray(t * 6, t * 6 + 6);
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (area >= -1e-9) ccw++;
  for (const v of [ax, ay, bx, by, cx, cy]) assert.ok(v > 0 && v < 1, 'atlas UVs inside 0..1');
}
assert.equal(ccw, tris, 'every projected triangle is counter-clockwise');

// charts do not overlap in the atlas (their padded rectangles are disjoint)
const rects = un.charts.map((c) => [c.x, c.y, c.x + Math.ceil((c.maxU - c.minU) * lay.density) + 7, c.y + Math.ceil((c.maxV - c.minV) * lay.density) + 7]);
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const [a, b] = [rects[i], rects[j]];
  assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `charts ${i} and ${j} overlap`);
}
// a big area lowers the density instead of overflowing; thousands of tiny charts do not fit -> null (vertex colours)
const ground = unwrap(soup(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2)));
const gl = layout(ground.charts, { size: 1024, density: 64 });
assert.ok(gl.size === 1024 && gl.density < 2.6 && gl.density > 2, 'a 400 m ground gets ~2.5 texels/m at 1024: ' + gl.density);
const cards = [];
for (let i = 0; i < 20000; i++) cards.push(i * 3, 0, 0, i * 3 + 0.1, 0, 0, i * 3, 0.1, 0);
assert.equal(layout(unwrap(new Float32Array(cards)).charts, { size: 256, density: 64 }), null, 'too many charts for the atlas');

// resolve: 2x2 supersampled, coverage-weighted, flipped to image rows, gutters dilated
const S = 4, color = new Uint8Array(S * S * 4), cover = new Uint8Array(S * S * 4);
for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) { const p = (y * S + x) * 4; color.set([200, 100, 50, 255], p); cover[p] = 255; }
const r = resolveBake(color, cover, S, 2, 2);
assert.deepEqual([...r.rgba.subarray(4, 8)], [200, 100, 50, 255], 'dilated into the uncovered neighbour');
const bottomLeft = (2 - 1) * 2 + 0;   // GL row 0 is the image's last row
assert.equal(r.covered[bottomLeft], 1, 'the covered texel is the bottom-left one');
assert.deepEqual([...r.rgba.subarray(bottomLeft * 4, bottomLeft * 4 + 4)], [200, 100, 50, 255], 'only covered samples count');
const lone = new Uint8ClampedArray(9 * 4), m = new Uint8Array(9); lone.set([10, 20, 30, 255], 16); m[4] = 1;
dilate(lone, m, 3, 1);
assert.deepEqual([...lone.subarray(0, 4)], [10, 20, 30, 255], 'one ring reaches the corner');

// USDZ: every file's data on a 64-byte boundary, content intact
const enc = (t) => new TextEncoder().encode(t);
const files = { 'model.usda': enc('#usda 1.0\n'), 'geometries/Geometry_7.usda': enc('x'.repeat(1001)), 'textures/Texture_3_true.jpg': new Uint8Array(333).fill(7) };
const z = zipAligned(files), offs = zipOffsets(z);
assert.deepEqual(Object.keys(offs), Object.keys(files), 'order kept (model.usda first)');
for (const [name, at] of Object.entries(offs)) assert.equal(at % 64, 0, `${name} data at ${at}`);
assert.deepEqual(unzipSync(z)['geometries/Geometry_7.usda'], files['geometries/Geometry_7.usda'], 'content survives');
console.log('export check: ok');

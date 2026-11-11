// Mirage original code. Node checks of the big-world modules that need no GPU: the simplifier, the chunker, the
// HLOD proxy, the impostor's direction mapping and the floating origin. (The GPU paths: examples/demos/bigworld/bigworld-check.mjs.)
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { simplify, createChain, createSimplifier } from './src/simplify.js';
import { chunkGeometry, chunkObject } from './src/chunk.js';
import { meshInput, buildProxy } from './src/autolod.js';
import { hemiOctEncode, hemiOctDecode } from './src/impostor.js';
import { createFloatingOrigin } from '../world/src/partition.js';

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
// largest distance from the simplified vertices to a sphere of radius r: the surface must stay near the source
const offSphere = (pos, r) => { let m = 0; for (let i = 0; i < pos.length; i += 3) m = Math.max(m, Math.abs(Math.hypot(pos[i], pos[i + 1], pos[i + 2]) - r)); return m; };

{ // simplify: a sphere to a tenth, close to the surface, attributes kept, index valid
  const g = new THREE.SphereGeometry(2, 96, 64), input = meshInput(g);
  const src = tris(g), t0 = performance.now(), lv = simplify(input, { ratio: 0.1 }), ms = performance.now() - t0;
  assert.ok(lv.triangles <= src * 0.1 + 2 && lv.triangles > src * 0.05, `sphere ${src} -> ${lv.triangles}`);
  assert.equal(lv.index.length, lv.triangles * 3);
  assert.ok(Math.max(...lv.index) < lv.vertices);
  assert.equal(lv.positions.length, lv.vertices * 3);
  assert.equal(lv.attributes.length, input.attributes.length);
  for (let a = 0; a < lv.attributes.length; a++) assert.equal(lv.attributes[a].length, lv.vertices * input.attributes[a].itemSize);
  assert.ok(offSphere(lv.positions, 2) < 0.03, `sphere error ${offSphere(lv.positions, 2)}`);
  assert.ok(lv.error > 0 && lv.error < 0.1, `reported error ${lv.error}`);
  // no degenerate triangles
  for (let i = 0; i < lv.index.length; i += 3) assert.ok(lv.index[i] !== lv.index[i + 1] && lv.index[i + 1] !== lv.index[i + 2] && lv.index[i] !== lv.index[i + 2]);
  console.log(`  simplify: sphere ${src} -> ${lv.triangles} triangles in ${ms.toFixed(0)} ms, off the surface by at most ${offSphere(lv.positions, 2).toFixed(4)} of radius 2`);
}
{ // the error bound stops the collapse: a tight bound keeps more triangles than a loose one
  const input = meshInput(new THREE.SphereGeometry(2, 64, 48));
  const tight = simplify(input, { ratio: 0.02, error: 0.002 }), loose = simplify(input, { ratio: 0.02, error: 0.2 });
  assert.ok(tight.triangles > loose.triangles * 2, `${tight.triangles} vs ${loose.triangles}`);
  assert.ok(tight.error <= 0.002 + 1e-9);
}
{ // borders: an open grid with lockBorder keeps every border vertex where it was; locked[] vertices too
  const g = new THREE.PlaneGeometry(10, 10, 40, 40), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i)) * Math.cos(p.getY(i)));
  g.computeVertexNormals();
  const input = { ...meshInput(g), lockBorder: true }, lv = simplify(input, { ratio: 0.1 });
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`, have = new Set();
  for (let i = 0; i < lv.positions.length; i += 3) have.add(key(lv.positions[i], lv.positions[i + 1], lv.positions[i + 2]));
  let border = 0;
  for (let i = 0; i < p.count; i++) if (Math.abs(Math.abs(p.getX(i)) - 5) < 1e-6 || Math.abs(Math.abs(p.getY(i)) - 5) < 1e-6) { border++; assert.ok(have.has(key(p.getX(i), p.getY(i), p.getZ(i))), 'a border vertex moved'); }
  assert.equal(border, 160);
  assert.ok(lv.triangles < 3200 * 0.3, `grid 3200 -> ${lv.triangles}`);
}
{ // chain: levels shrink, errors grow, time-sliced building gives the same result as building at once
  const input = () => meshInput(new THREE.TorusKnotGeometry(1, 0.3, 160, 24));
  const a = createChain(input(), { ratios: [0.5, 0.25, 0.1] }); a.step(Infinity);
  const b = createChain(input(), { ratios: [0.5, 0.25, 0.1] }); let steps = 0; while (!b.step(2)) steps++;
  assert.equal(a.levels.length, 3); assert.equal(b.levels.length, 3);
  for (let i = 0; i < 3; i++) { assert.equal(a.levels[i].triangles, b.levels[i].triangles); assert.deepEqual(a.levels[i].index, b.levels[i].index); }
  assert.ok(a.levels[0].triangles > a.levels[1].triangles && a.levels[1].triangles > a.levels[2].triangles);
  assert.ok(a.levels[0].error <= a.levels[1].error && a.levels[1].error <= a.levels[2].error);
  assert.ok(steps > 2, 'a 2 ms budget must slice the build');
  const s = createSimplifier(input()); assert.equal(s.triangles, a.source);
  console.log(`  chain: ${a.source} -> ${a.levels.map((l) => l.triangles).join(', ')} triangles (errors ${a.levels.map((l) => l.error.toFixed(4)).join(', ')}), sliced into ${steps + 1} steps of 2 ms: identical`);
}
{ // chunks: every triangle lands in exactly one chunk, bounds are tight, budgets hold, seams are locked
  const parts = [];
  for (let i = 0; i < 400; i++) { const b = new THREE.BoxGeometry(2, 3, 2, 6, 6, 6); b.translate((i % 20) * 6, 0, Math.floor(i / 20) * 6); parts.push(b); }
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); for (const i of g.index.array) idx.push(i + o); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  const src = tris(g), chunks = chunkGeometry(g, { maxVertices: 20000, maxSize: 40 });
  assert.ok(chunks.length > 4, `${chunks.length} chunks`);
  assert.equal(chunks.reduce((a, c) => a + tris(c), 0), src);
  for (const c of chunks) {
    assert.ok(c.attributes.position.count <= 20000);
    assert.ok(c.attributes.normal && c.boundingBox && c.boundingSphere);
    const s = c.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.max(s.x, s.z) <= 40 + 6, `chunk ${s.x.toFixed(1)} x ${s.z.toFixed(1)} m`);
  }
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial()), root = new THREE.Group(); mesh.castShadow = true; mesh.userData.tag = 7; root.add(mesh);
  const st = chunkObject(root, { maxVertices: 20000, maxSize: 40 });
  assert.equal(st.split, 1); assert.equal(root.children.length, st.chunks);
  assert.ok(root.children.every((m) => m.castShadow && m.userData.tag === 7 && m.material === mesh.material));
  // off: a mesh that asks to be left alone stays
  const keep = new THREE.Group(), km = new THREE.Mesh(g.clone(), mesh.material); km.userData.chunk = false; keep.add(km);
  assert.equal(chunkObject(keep, { maxVertices: 20000, maxSize: 40 }).split, 0); assert.equal(keep.children[0], km);
  console.log(`  chunk: ${src} triangles in one mesh -> ${chunks.length} chunks, none over 20 000 vertices or 46 m`);
}
{ // HLOD proxy: two meshes with different materials become one vertex-coloured mesh with far fewer triangles
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 32), new THREE.MeshStandardMaterial({ color: 0xff0000 })); a.position.x = -5;
  const b = new THREE.Mesh(new THREE.TorusGeometry(3, 1, 32, 64), new THREE.MeshStandardMaterial({ color: 0x00ff00 })); b.position.x = 5;
  root.add(a, b); root.updateMatrixWorld(true);
  const proxy = buildProxy(root, { ratio: 0.1 });
  assert.ok(proxy && proxy.isMesh && proxy.geometry.attributes.color);
  const { sourceTriangles, triangles } = proxy.userData.proxy;
  assert.equal(sourceTriangles, tris(a.geometry) + tris(b.geometry));
  assert.ok(triangles <= sourceTriangles * 0.11 && triangles > 100, `${sourceTriangles} -> ${triangles}`);
  proxy.geometry.computeBoundingBox();
  assert.ok(Math.abs(proxy.geometry.boundingBox.min.x + 8) < 0.3 && Math.abs(proxy.geometry.boundingBox.max.x - 9) < 0.3, 'the proxy covers both meshes in world space');
  assert.equal(buildProxy(new THREE.Group(), {}), null);
  console.log(`  proxy: ${sourceTriangles} triangles of 2 meshes -> one mesh of ${triangles}`);
}
{ // impostor directions: encode(decode(uv)) is the identity on the upper hemisphere's square
  const v = new THREE.Vector3(), uv = new THREE.Vector2();
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    hemiOctDecode(i / 10, j / 10, v);
    assert.ok(Math.abs(v.length() - 1) < 1e-6 && v.y >= -1e-6);
    hemiOctEncode(v, uv);
    assert.ok(Math.abs(uv.x - i / 10) < 1e-5 && Math.abs(uv.y - j / 10) < 1e-5, `${i},${j} -> ${uv.x},${uv.y}`);
  }
}
{ // floating origin: the camera stays within the threshold, absolute position = scene + offset, roots follow
  const cam = new THREE.PerspectiveCamera(), root = new THREE.Group(), shifts = [];
  const fo = createFloatingOrigin({ roots: [root], threshold: 500, snap: 256, onRebase: (s) => shifts.push(s.clone()) });
  let ax = 0;
  for (let i = 0; i < 400; i++) { cam.position.x += 37; ax += 37; fo.update(cam); assert.ok(Math.abs(cam.position.x) <= 500 + 37); assert.equal(cam.position.x + fo.offset.x, ax); assert.ok(root.position.x + fo.offset.x === 0); }
  assert.ok(shifts.length > 10 && shifts.every((s) => s.x % 256 === 0 && s.y === 0));
}
console.log('bigworld check: ok');

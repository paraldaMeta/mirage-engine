// Model import contracts that need no GPU: the GLB writer, the meshopt vertex codec against three's decoder, the
// asset cache's reference counts, instancing and the collision conventions.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createEnv, createMaterials, writeGLB } from './src/index.js';
import { encodeMeshoptVertices } from './src/gltf-write.js';
import { createAssets, gltfExtensions } from './src/assets.js';

// --- meshopt vertex codec: three's decoder returns the bytes we encoded, for smooth, noisy and constant streams
await MeshoptDecoder.ready;
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const [count, size, kind] of [[1, 4, 'noise'], [17, 12, 'smooth'], [300, 12, 'smooth'], [1000, 16, 'noise'], [5000, 4, 'const'], [700, 8, 'steps']]) {
  const data = new Uint8Array(count * size);
  if (kind === 'noise') for (let i = 0; i < data.length; i++) data[i] = rnd() * 256;
  else if (kind === 'smooth') new Float32Array(data.buffer).forEach((_, i, a) => { a[i] = Math.sin(i * 0.01) * 3; });
  else if (kind === 'steps') for (let i = 0; i < data.length; i++) data[i] = (i / size | 0) % 7;
  else data.fill(9);
  const enc = encodeMeshoptVertices(data, count, size), dec = new Uint8Array(count * size);
  MeshoptDecoder.decodeVertexBuffer(dec, count, size, enc);
  assert.deepEqual(dec, data, `meshopt ${kind} ${count}x${size}`);
  if (kind === 'const') assert.ok(enc.length < data.length / 50, 'a constant stream nearly vanishes');
}

// --- a static model: two meshes under a group, written, read back, cached
const world = { G: createEnv().G };
world.mat = createMaterials(world.G);
function crate() {
  const g = new THREE.Group(); g.name = 'Crate';
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7, name: 'Wood' })); body.name = 'Body';
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 1.1), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 1, roughness: 0.4, name: 'Iron' })); lid.name = 'Lid';
  lid.position.set(0, 1.05, 0); lid.rotation.y = 0.3;
  g.add(body, lid);
  return g;
}
const glb = writeGLB(crate()), glbM = writeGLB(crate(), { meshopt: true });
assert.deepEqual(gltfExtensions(glb), []);
assert.deepEqual(gltfExtensions(glbM), ['EXT_meshopt_compression']);

const assets = createAssets(world);
const [a, b] = await Promise.all([assets.load(glb, { key: 'crate' }), assets.load(glb, { key: 'crate' })]);
assert.equal(a, b, 'one key, one model'); assert.equal(assets.refs(a), 2);
assert.equal(a.stats.meshes, 2); assert.equal(a.stats.triangles, 24); assert.equal(a.collide, 'mesh'); assert.equal(a.skinned, false);
assert.ok(Math.abs(a.bounds.max.y - 1.1) < 1e-5 && Math.abs(a.bounds.min.y) < 1e-6);
const lid = a.scene.getObjectByName('Lid');
assert.ok(lid.material.metalness === 1 && Math.abs(lid.rotation.y - 0.3) < 1e-6);
// adapted: patched into the world (hooks present), shadows on
a.scene.traverse((o) => { if (o.isMesh) { assert.ok(o.material.userData.hooks && o.material.onBeforeCompile && o.castShadow && o.receiveShadow); } });

// meshopt file decodes to the same vertices, bit for bit
const m = await assets.load(glbM, { key: 'crate-meshopt' });
for (const name of ['Body', 'Lid']) for (const attr of ['position', 'normal', 'uv']) {
  assert.deepEqual(m.scene.getObjectByName(name).geometry.attributes[attr].array, a.scene.getObjectByName(name).geometry.attributes[attr].array, `${name}.${attr}`);
}

// instances share geometry and material; releasing an instance keeps the model, the last reference frees it
const i1 = assets.instantiate(a), i2 = assets.instantiate('crate');
assert.equal(assets.refs(a), 4);
assert.equal(i1.getObjectByName('Body').geometry, a.scene.getObjectByName('Body').geometry);
assert.equal(i1.getObjectByName('Body').material, i2.getObjectByName('Body').material);
let disposed = 0; a.scene.getObjectByName('Body').geometry.addEventListener('dispose', () => disposed++);
const scene = new THREE.Scene(); scene.add(i1, i2);
assets.release(i1); assets.release(i1);   // a second release of the same instance is ignored
assert.equal(assets.refs(a), 3); assert.equal(i1.parent, null); assert.equal(disposed, 0);

const mats = [0, 1, 2].map((i) => new THREE.Matrix4().makeTranslation(i * 2, 0, 0));
const row = assets.instances(a, mats);
assert.equal(row.root.children.length, 2); assert.ok(row.root.children.every((c) => c.isInstancedMesh && c.count === 3));
const mm = new THREE.Matrix4(), p = new THREE.Vector3();
row.root.children.find((c) => c.name === 'Lid').getMatrixAt(2, mm); p.setFromMatrixPosition(mm);
assert.ok(Math.abs(p.x - 4) < 1e-6 && Math.abs(p.y - 1.05) < 1e-6, 'instance matrix = placement x node transform');
assets.release(row); assets.release(i2); assets.release(a); assert.equal(disposed, 0); assert.equal(assets.refs('crate'), 1);
assets.release(b); assert.equal(disposed, 1, 'the last reference disposes'); assert.equal(assets.get('crate'), undefined); assert.ok(a.disposed);
assert.throws(() => assets.instantiate(a));

// collision conventions: 'box' passes the render meshes through and adds one proxy on the collider layer
const boxed = await assets.load(glb, { key: 'crate-box', collide: 'box', scale: 2 });
const inst = assets.instantiate(boxed), proxies = [];
inst.traverse((o) => { if (o.userData.collider) proxies.push(o); else assert.equal(o.userData.collide, false); });
assert.equal(proxies.length, 1);
const proxy = proxies[0]; proxy.geometry.computeBoundingBox();
assert.ok(proxy.layers.mask === 1 << 2 && !proxy.material.colorWrite && !proxy.material.depthWrite && !proxy.castShadow);
assert.ok(Math.abs(proxy.geometry.boundingBox.max.y - 1.1) < 1e-5, 'the proxy is in model units; the root scale applies on top');
assert.equal(inst.scale.x, 2);
const hull = await assets.load(glb, { key: 'crate-hull', collide: 'hull' });
assert.ok(hull.collider.attributes.position.count >= 8);
const rowB = assets.instances(boxed, 4);
assert.equal(rowB.root.children.filter((c) => c.userData.collider).length, 1);
const off = await assets.load(glb, { key: 'crate-off', collide: false });
assert.equal(off.collider, null); off.scene.traverse((o) => assert.equal(o.userData.collide, false));

const st = assets.stats(); assert.equal(st.models, 4); assert.ok(st.bytes > 0);
assets.dispose(); assert.equal(assets.stats().models, 0); assert.ok(boxed.disposed && hull.disposed);
await assert.rejects(() => assets.load(new Uint8Array([1, 2, 3, 4]).buffer, { key: 'junk' }));
assert.equal(assets.stats().models, 0, 'a failed load leaves nothing cached');
console.log(`assets check: ok (meshopt round trip 6 streams; crate ${glb.length} B plain, ${glbM.length} B meshopt)`);

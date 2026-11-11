// Mirage original code.

// ---------------------------------------------------------------------------
// Opt-in model import: glTF / GLB files (with Draco, meshopt and KTX2 payloads) as engine citizens.
//
//   import { createAssets } from '@miragekit/core/assets';       // a subpath, not in the index: see below
//   import { decoders } from '@miragekit/core/assets-decoders';  // Vite projects: decoder files as bundled URLs
//   const assets = createAssets(world, { decoders });
//   const chair = await assets.load('/models/chair.glb', { collide: 'box' });
//   scene.add(assets.instantiate(chair));                     // a clone sharing geometry, materials, textures
//   const row = assets.instances(chair, matrices);            // one InstancedMesh per primitive
//   scene.add(row.root);
//   assets.release(row); assets.release(chair);               // the last reference frees the GPU resources
//
// What "adapted" means. Mirage's fog, shadow filtering and second light model live in three's shader chunks, the
// sky light is scene.environment and the grade is the post pipeline, so a stock glTF material already receives all
// four. What it lacks is what patch() adds: the world's uniforms and varyings, interior ambient volumes, and a
// place for hooks (withWet, withRelief). load() patches every Standard / Physical / Basic / Lambert material with
// empty hooks, sets shadow flags and texture anisotropy, and leaves anything else (ShaderMaterial) alone.
//
// Collision is the engine's one rule (walk grid and Rapier read the same scene): a visible, opaque, depth-writing
// mesh is solid. `collide` picks what an import contributes:
//   'mesh'  (default for static models) the render meshes themselves, triangle-exact
//   'box'   the meshes are passed through; one box proxy around the model stands in (cheap, good for props)
//   'hull'  as 'box' with the convex hull of the vertices
//   false   (default for skinned models) nothing: a figure that moves must not be baked into the grid
// Proxies follow the convention of @miragekit/world's colliderFor: layer 2, userData.collider, never drawn.
//
// Why a subpath: three's GLTFLoader and the decoders are imported dynamically, and a bundler emits a dynamic
// import's chunk even when the function around it is unused; kept out of the index, a project that imports no
// models ships none of this. Decoders load only when a file names their extension in `extensionsUsed`.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { patch } from './materials.js';
import { objectBytes, texturesOf } from './stream.js';

const COLLIDE_LAYER = 2;   // LAYER.COLLIDE in @miragekit/world (core cannot import it)
const DECODER_FILES = { draco: ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js'], basis: ['basis_transcoder.js', 'basis_transcoder.wasm'] };
let proxyMaterial = null;
const colliderMaterial = () => (proxyMaterial ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));

/** `extensionsUsed` of a .glb / .gltf buffer without parsing the rest (decides which decoders to fetch). */
export function gltfExtensions(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let text;
  if (u8.byteLength >= 20 && dv.getUint32(0, true) === 0x46546c67) text = new TextDecoder().decode(u8.subarray(20, 20 + dv.getUint32(12, true)));
  else text = new TextDecoder().decode(u8);
  try { return JSON.parse(text).extensionsUsed || []; } catch { return []; }
}

// A decoder entry is a folder URL (the loader appends its file names) or { js, wasm } with one URL per file; the
// second form goes through a LoadingManager URL modifier, which is what lets a single-file build carry the
// decoders as data: URLs.
function decoderManager(decoders) {
  const manager = new THREE.LoadingManager();
  const map = [];
  for (const [kind, files] of Object.entries(DECODER_FILES)) {
    const d = decoders[kind];
    if (d && typeof d === 'object') { if (d.js) map.push([files[0], d.js]); if (d.wasm) map.push([files[1], d.wasm]); }
  }
  manager.setURLModifier((url) => { for (const [name, to] of map) if (url.endsWith(name)) return to; return url; });
  return manager;
}
const decoderPath = (d) => (typeof d === 'string' ? d : './');

function adaptMaterial(m, world, opts) {
  if (m.userData.mgAdapted) return m;
  m.userData.mgAdapted = true;
  const aniso = Math.min(opts.anisotropy ?? 8, world.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  for (const v of Object.values(m)) if (v && v.isTexture && !v.isCompressedTexture && v.anisotropy < aniso) { v.anisotropy = aniso; v.needsUpdate = true; }
  const ok = m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial;
  if (ok && world.G && !m.userData.hooks) patch(m, {}, world.G);
  return m;
}

function measure(scene) {
  const geos = new Set(), mats = new Set(), texs = new Set();
  let meshes = 0, triangles = 0, skinned = false;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++; skinned ||= !!o.isSkinnedMesh;
    const g = o.geometry; geos.add(g);
    triangles += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    for (const m of [].concat(o.material)) mats.add(m);
    for (const t of texturesOf(o)) texs.add(t);
  });
  return { meshes, triangles, geometries: geos.size, materials: mats.size, textures: texs.size, bytes: objectBytes(scene), skinned };
}

// vertices of every static mesh in the template root's frame (for the box / hull proxy)
function rootPoints(scene) {
  const pts = [], v = new THREE.Vector3(), inv = new THREE.Matrix4(), m = new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  inv.copy(scene.matrixWorld).invert();
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone());
  });
  return pts;
}

async function buildCollider(scene, mode) {
  const pts = rootPoints(scene);
  if (pts.length < 4) return null;
  if (mode === 'hull') {
    const { ConvexGeometry } = await import('three/addons/geometries/ConvexGeometry.js');
    return new ConvexGeometry(pts);
  }
  const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  return new THREE.BoxGeometry(Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)).translate(c.x, c.y, c.z);
}

function proxyOf(geometry, count) {
  const p = count == null ? new THREE.Mesh(geometry, colliderMaterial()) : new THREE.InstancedMesh(geometry, colliderMaterial(), count);
  p.name = 'collider'; p.userData.collider = true; p.layers.set(COLLIDE_LAYER);
  p.castShadow = p.receiveShadow = false;
  return p;
}

/** Model cache for one world. `decoders`: { draco, basis } each a folder URL or { js, wasm } URLs. */
export function createAssets(world, options = {}) {
  const decoders = options.decoders || {};
  const cache = new Map();      // key -> { promise, model, refs }
  const owner = new WeakMap();  // instance root / instances handle / model -> { entry, kind }
  let loaders = null, counter = 0;
  const live = new Set();       // handles still holding a reference (dispose() frees them all)

  async function gltfLoader(used) {
    if (!loaders) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const manager = decoderManager(decoders);
      loaders = { manager, gltf: new GLTFLoader(manager) };
    }
    const L = loaders, has = (x) => used.includes(x);
    if (!L.meshopt && (has('EXT_meshopt_compression') || has('KHR_meshopt_compression'))) {
      L.meshopt = (await import('three/addons/libs/meshopt_decoder.module.js')).MeshoptDecoder;
      L.gltf.setMeshoptDecoder(L.meshopt);
    }
    if (!L.draco && has('KHR_draco_mesh_compression')) {
      if (!decoders.draco) throw new Error('assets: this file is Draco-compressed; pass createAssets(world, { decoders: { draco } })');
      const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
      L.draco = new DRACOLoader(L.manager).setDecoderPath(decoderPath(decoders.draco));
      L.gltf.setDRACOLoader(L.draco);
    }
    if (!L.ktx2 && has('KHR_texture_basisu')) {
      if (!world.renderer) throw new Error('assets: KTX2 textures need world.renderer');
      const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
      // uncompressed KTX2 never touches the transcoder, so a missing `basis` entry is only an error when one is needed
      L.ktx2 = new KTX2Loader(L.manager).setTranscoderPath(decoderPath(decoders.basis)).setWorkerLimit(options.workers ?? 2);
      L.ktx2.detectSupport(world.renderer);
      L.gltf.setKTX2Loader(L.ktx2);
    }
    return L.gltf;
  }

  async function build(key, src, opts) {
    const t0 = performance.now();
    let buffer = src, base = '';
    if (typeof src === 'string') {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`assets: ${src} -> HTTP ${res.status}`);
      buffer = await res.arrayBuffer();
      base = src.slice(0, src.lastIndexOf('/') + 1);
    } else if (ArrayBuffer.isView(src)) buffer = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    const extensions = gltfExtensions(buffer);
    const loader = await gltfLoader(extensions);
    const gltf = await new Promise((ok, fail) => loader.parse(buffer, opts.path ?? base, ok, fail));
    const scene = gltf.scene || gltf.scenes[0];
    scene.name ||= key;
    if (opts.scale) scene.scale.multiplyScalar(opts.scale);
    const adapt = opts.adapt ?? options.adapt ?? true, shadows = opts.shadows ?? true;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = shadows;
      if (o.isSkinnedMesh) o.frustumCulled = false;   // the bind-pose bounds say nothing about an animated pose
      if (adapt) {
        const each = (m) => { const r = typeof adapt === 'function' ? adapt(m, o) : null; return adaptMaterial(r || m, world, options); };
        o.material = Array.isArray(o.material) ? o.material.map(each) : each(o.material);
      }
    });
    const stats = measure(scene);
    const collide = opts.collide ?? (stats.skinned ? false : 'mesh');
    let collider = null;
    if (collide === 'box' || collide === 'hull') collider = await buildCollider(scene, collide);
    if (collide !== 'mesh') scene.traverse((o) => { o.userData.collide = false; });
    scene.updateMatrixWorld(true);
    const model = {
      key, scene, animations: gltf.animations || [], cameras: gltf.cameras || [], asset: gltf.asset || {}, collide, collider,
      bounds: new THREE.Box3().setFromObject(scene), skinned: stats.skinned,
      stats: { ...stats, extensions, ms: +(performance.now() - t0).toFixed(1) },
    };
    return model;
  }

  const entryOf = (x) => (typeof x === 'string' ? cache.get(x) : owner.get(x)?.entry);
  function drop(entry) {
    if (--entry.refs > 0 || !entry.model) return;
    cache.delete(entry.key);
    const tex = new Set();
    entry.model.scene.traverse((o) => {
      o.geometry?.dispose?.();
      for (const t of texturesOf(o)) tex.add(t);
      for (const m of [].concat(o.material || [])) m?.dispose?.();
      o.skeleton?.dispose?.();
    });
    for (const t of tex) t.dispose();
    entry.model.collider?.dispose();
    entry.model.disposed = true;
  }

  const api = {
    /** Load (or fetch from the cache) and take one reference. `src`: URL, ArrayBuffer or typed array (give a `key`). */
    async load(src, opts = {}) {
      const key = opts.key ?? (typeof src === 'string' ? src : `buffer:${++counter}`);
      let entry = cache.get(key);
      if (!entry) {
        entry = { key, refs: 0, model: null, promise: null };
        entry.promise = build(key, src, opts).then((m) => { entry.model = m; owner.set(m, { entry, kind: 'model' }); return m; },
          (e) => { cache.delete(key); throw e; });
        cache.set(key, entry);
      }
      entry.refs++;
      try { const m = await entry.promise; live.add(m); return m; } catch (e) { entry.refs--; throw e; }
    },
    /** the cached model for a key (no reference taken), or undefined */
    get: (key) => cache.get(key)?.model,
    /** A clone to add to the scene: shares geometry, materials and textures; skinned models get their own bones. */
    instantiate(model, { skeleton = true } = {}) {
      const entry = entryOf(model);
      if (!entry?.model || entry.model.disposed) throw new Error('assets: instantiate() of a model that is not loaded');
      const m = entry.model;
      // SkeletonUtils.clone rebinds every SkinnedMesh to the cloned bones; Object3D.clone would leave the copies
      // driving the template's skeleton
      const root = m.skinned && skeleton ? api._cloneSkinned(m.scene) : m.scene.clone(true);
      if (m.collider) root.add(proxyOf(m.collider));
      root.userData.asset = m.key;
      entry.refs++; owner.set(root, { entry, kind: 'instance' }); live.add(root);
      return root;
    },
    /** One InstancedMesh per primitive at `matrices` (Matrix4[] or a count to fill later with setMatrixAt). */
    instances(model, matrices) {
      const entry = entryOf(model);
      if (!entry?.model || entry.model.disposed) throw new Error('assets: instances() of a model that is not loaded');
      const m = entry.model;
      if (m.skinned) throw new Error('assets: skinned models cannot be instanced; instantiate() each');
      const n = typeof matrices === 'number' ? matrices : matrices.length;
      const root = new THREE.Group(); root.name = `${m.key}:instances`; root.userData.asset = m.key;
      const parts = [], inv = new THREE.Matrix4().copy(m.scene.matrixWorld).invert(), t = new THREE.Matrix4();
      m.scene.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, n);
        im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow; im.name = o.name;
        if (m.collide !== 'mesh') im.userData.collide = false;
        // the template root's own transform (opts.scale) is part of every instance
        parts.push({ im, local: new THREE.Matrix4().multiplyMatrices(m.scene.matrix, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)) });
        root.add(im);
      });
      if (m.collider) { const p = proxyOf(m.collider, n); parts.push({ im: p, local: m.scene.matrix.clone() }); root.add(p); }
      const handle = {
        root, count: n, model: m,
        setMatrixAt(i, matrix) { for (const p of parts) p.im.setMatrixAt(i, t.multiplyMatrices(matrix, p.local)); return handle; },
        /** call after a batch of setMatrixAt: uploads the matrices and refits the culling bounds */
        commit() { for (const p of parts) { p.im.instanceMatrix.needsUpdate = true; p.im.computeBoundingSphere(); p.im.computeBoundingBox(); } return handle; },
      };
      if (typeof matrices !== 'number') { matrices.forEach((mat, i) => handle.setMatrixAt(i, mat)); handle.commit(); }
      entry.refs++; owner.set(handle, { entry, kind: 'instances', parts }); owner.set(root, owner.get(handle)); live.add(handle);
      return handle;
    },
    /** Take another reference to a loaded model (a second system that will release() on its own). */
    retain(model) { const e = entryOf(model); if (e) e.refs++; return model; },
    /** Give a reference back: a model, an instantiate() root or an instances() handle. The last one disposes. */
    release(x) {
      const own = owner.get(x);
      if (!own) { const e = entryOf(x); if (e) drop(e); return; }
      if (own.kind === 'instance') {
        if (!live.has(x)) return;
        x.removeFromParent();
        x.traverse((o) => { if (o.isSkinnedMesh && o.skeleton?.boneTexture) o.skeleton.dispose(); });
      } else if (own.kind === 'instances') {
        const h = x.root ? x : [...live].find((l) => l.root === x);
        if (!h || !live.has(h)) return;
        h.root.removeFromParent(); for (const p of own.parts) p.im.dispose();
        x = h;
      }
      live.delete(x);
      drop(own.entry);
    },
    refs: (model) => entryOf(model)?.refs ?? 0,
    stats() {
      let bytes = 0, triangles = 0, refs = 0;
      for (const e of cache.values()) { refs += e.refs; if (e.model) { bytes += e.model.stats.bytes; triangles += e.model.stats.triangles; } }
      return { models: cache.size, refs, bytes, triangles };
    },
    /** free everything this cache loaded, whatever the counts say */
    dispose() {
      for (const x of [...live]) { const own = owner.get(x); if (own && own.kind !== 'model') api.release(x); }
      for (const e of [...cache.values()]) { e.refs = 1; if (e.model) drop(e); else cache.delete(e.key); }
      live.clear();
      loaders?.draco?.dispose(); loaders?.ktx2?.dispose(); loaders = null;
    },
    _cloneSkinned: null,
  };
  // SkeletonUtils is small and has no side effects; loaded with the first skinned model so instantiate() stays sync
  const load0 = api.load;
  api.load = async (src, opts) => {
    const m = await load0(src, opts);
    if (m.skinned && !api._cloneSkinned) api._cloneSkinned = (await import('three/addons/utils/SkeletonUtils.js')).clone;
    return m;
  };
  return api;
}

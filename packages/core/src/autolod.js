// Mirage original code.
// Automatic level of detail for any world: every static mesh gets a chain of simplified copies (simplify.js),
// built after load in workers or in small slices on the main thread, and the copy whose error is below a pixel
// threshold is the one drawn. Switches cross-fade through a screen-door dither, with hysteresis so a mesh at the
// boundary does not flicker. Opt-in: nothing happens to a world that never calls createAutoLod.
//
//   import { createAutoLod, buildProxy } from '@mirage/core/autolod';
//   const lod = createAutoLod(world, { errorPx: 1, ratios: [0.5, 0.25, 0.12], fade: 0.3, workers: 2 });
//   lod.add(built.root);            // after buildWorld (and chunkObject, if used): chains start building
//   await lod.ready();              // optional: selection works with whatever is built so far
//   lod.stats                       // { meshes, built, pending, levels, sourceTriangles, drawnTriangles, fading, buildMs }
//   lod.freeze(0) / lod.freeze(null)   // hold every mesh at one level (0 = source: do this around a walk-grid bake)
//   lod.dispose()                   // back to the source geometry, LOD geometry freed
// It updates itself before each render of world.camera (frame.js); `auto: false` and lod.update(camera, heightPx, dt)
// to drive it by hand.
//
// Selection: a level's error (metres, from the simplifier, times the mesh's world scale) is projected at the
// distance to the mesh's bounding sphere; the coarsest level under `errorPx` wins. Going coarser needs
// errorPx * (1 - hysteresis), going finer errorPx * (1 + hysteresis). While the camera stands still fades finish
// at once, so a still frame never accumulates a half-dithered mesh.
// The fade: the mesh draws its new level with a material that discards a growing share of pixels by a fixed
// screen pattern, and a partner mesh draws the old level with the complement, so each pixel is drawn by exactly one
// of them (no blending, no sorting, depth stays right). The fade materials inherit from the mesh's own material
// (prototype, so maps, colours and Mirage's shader hooks are the same objects) and share one extra program per
// source material. Shadows use the new level from the first frame of a fade.
// Limits: static meshes with one opaque material; InstancedMesh / skinned / morphing meshes are left alone
// (instancing.js has per-instance LOD); the error is the simplifier's RMS estimate, not a strict bound.
import * as THREE from 'three';
import { createChain } from './simplify.js';
import { onView } from './frame.js';

const WEIGHT = { normal: 0.3, uv: 0.3, color: 0.3 };
const _v = new THREE.Vector3(), _s = new THREE.Vector3();

// a BufferGeometry -> the simplifier's input (float attributes only; others are dropped from the LODs)
export function meshInput(geo, weights = WEIGHT) {
  const names = Object.keys(geo.attributes).filter((n) => n !== 'position' && !geo.attributes[n].isInterleavedBufferAttribute && geo.attributes[n].array instanceof Float32Array);
  return { names, positions: geo.attributes.position.array, index: geo.index ? geo.index.array : null, locked: geo.userData.locked || null,
    attributes: names.map((n) => ({ array: geo.attributes[n].array, itemSize: geo.attributes[n].itemSize, weight: weights[n] ?? 0.3 })) };
}
export function levelGeometry(level, names, like) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(level.positions, 3));
  names.forEach((n, i) => g.setAttribute(n, new THREE.BufferAttribute(level.attributes[i], like.attributes[n].itemSize)));
  g.setIndex(new THREE.BufferAttribute(level.index, 1));
  // the source's bounds: culling and LOD distance do not change with the level
  g.boundingBox = like.boundingBox.clone(); g.boundingSphere = like.boundingSphere.clone();
  return g;
}

const DITHER = 'uniform vec2 uLodFade;\nfloat mgLodNoise(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';
// a material that draws like `base` minus the pixels of the fade pattern; own identity (three keys programs and
// uniforms by the material object), everything else read through the prototype
function fadeMaterial(base) {
  const m = Object.create(base), probe = new THREE.Material();
  Object.defineProperty(m, 'id', { value: probe.id });
  m.uuid = probe.uuid; m._listeners = undefined; m.version = base.version;
  m.lodFade = { value: new THREE.Vector2(0, 1) };
  m.onBeforeCompile = function (shader, renderer) {
    base.onBeforeCompile.call(this, shader, renderer);
    shader.uniforms.uLodFade = m.lodFade;
    shader.fragmentShader = DITHER + shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, (s) => s + '\n  if (uLodFade.y * (mgLodNoise(gl_FragCoord.xy) - uLodFade.x) < 0.0) discard;');
  };
  m.customProgramCacheKey = function () { return base.customProgramCacheKey.call(this) + '|lodfade'; };
  return m;
}

export function createAutoLod(world, opts = {}) {
  const { ratios = [0.5, 0.25, 0.12], errorPx = 1, hysteresis = 0.2, fade = 0.3, minTriangles = 300, workers = 0, budgetMs = 3, maxError = Infinity, weights = WEIGHT, auto = true } = opts;
  const scene = world.scene || world, camera0 = world.camera;
  const entries = [], queue = [], waiting = new Map();
  const stats = { meshes: 0, built: 0, pending: 0, levels: 0, sourceTriangles: 0, drawnTriangles: 0, fading: 0, buildMs: 0, switches: 0 };
  let frozen = null, current = null, lastCam = new Float32Array(16), readyResolve = [], disposed = false, jobId = 0, last = 0;
  const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

  // ---- building: workers when asked for and available, otherwise slices of budgetMs inside update()
  let pool = [];
  if (workers > 0 && typeof Worker !== 'undefined') {
    try {
      for (let i = 0; i < workers; i++) {
        const w = new Worker(new URL('./simplify.worker.js', import.meta.url), { type: 'module' });
        w.busy = null;
        w.onmessage = (e) => { const en = w.busy; w.busy = null; if (en && !disposed) { if (e.data.error) { en.failed = e.data.error; finish(en, []); } else finish(en, e.data.levels); } pump(); };
        w.onerror = () => { const en = w.busy; pool = pool.filter((x) => x !== w); if (en) queue.unshift(en); };   // no module workers here (file://, a single-file build): the main thread takes over
        pool.push(w);
      }
    } catch { pool = []; }
  }
  const chainOpts = { ratios, error: maxError };
  function finish(en, levels) {
    for (const l of levels) { en.geos.push(levelGeometry(l, en.names, en.geos[0])); en.errs.push(l.error * en.scale); stats.levels++; }
    en.built = true; stats.built++; stats.pending--;
    if (!stats.pending) { for (const r of readyResolve) r(stats); readyResolve = []; }
  }
  function pump() {
    for (const w of pool) {
      if (w.busy || !queue.length) continue;
      const en = queue.shift(), input = meshInput(en.geos[0], weights), copy = (a) => a && a.slice();
      // copies go to the worker (the originals stay on the mesh)
      const mesh = { positions: copy(input.positions), index: copy(input.index), locked: copy(input.locked), attributes: input.attributes.map((a) => ({ ...a, array: copy(a.array) })) };
      w.busy = en;
      w.postMessage({ id: ++jobId, mesh, opts: chainOpts }, [mesh.positions.buffer, ...mesh.attributes.map((a) => a.array.buffer)]);
    }
  }
  function slice(ms) {
    const t0 = performance.now();
    while (!pool.length && (current || queue.length) && performance.now() - t0 < ms) {
      if (!current) { const en = queue.shift(); current = { en, chain: createChain(meshInput(en.geos[0], weights), chainOpts) }; }
      if (current.chain.step(Math.max(0.5, ms - (performance.now() - t0)))) { finish(current.en, current.chain.levels); current = null; }
    }
    stats.buildMs += performance.now() - t0;
  }

  function add(root) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || Array.isArray(o.material) || o.userData.lod === false || o.userData.lodPartner) return;
      const g = o.geometry;
      if (!g?.attributes.position || g.morphAttributes?.position || g.attributes.position.isInterleavedBufferAttribute || tris(g) < minTriangles || entries.some((e) => e.mesh === o)) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingBox) g.computeBoundingBox();
      const mat = o.material, en = { mesh: o, geos: [g], errs: [0], level: 0, built: false, scale: o.getWorldScale(_s).length() / Math.sqrt(3), names: meshInput(g).names,
        base: mat, canFade: fade > 0 && !mat.transparent && !mat.isShaderMaterial && !mat.isRawShaderMaterial, fadeT: 1, partner: null, mats: null };
      entries.push(en); queue.push(en); stats.meshes++; stats.pending++; stats.sourceTriangles += tris(g);
    });
    pump();
    return api;
  }

  function endFade(en) {
    if (!en.partner) return;
    en.partner.removeFromParent(); en.partner.geometry = en.geos[0];
    en.mesh.material = en.base; en.fadeT = 1; stats.fading--;
    partners.push(en.partner); en.partner = null;
  }
  const partners = [];
  function startFade(en, from) {
    if (!en.mats) en.mats = [fadeMaterial(en.base), fadeMaterial(en.base)];
    const m = en.mesh, p = partners.pop() || new THREE.Mesh();
    p.geometry = en.geos[from]; p.material = en.mats[1]; p.name = m.name + ':fade';
    p.matrixAutoUpdate = false; p.matrix.copy(m.matrix); p.matrixWorld.copy(m.matrixWorld); p.matrixWorldAutoUpdate = false;
    p.castShadow = false; p.receiveShadow = m.receiveShadow; p.layers.mask = m.layers.mask; p.renderOrder = m.renderOrder; p.frustumCulled = m.frustumCulled;
    p.userData.collide = false; p.userData.lodPartner = true; p.userData.lod = false;
    m.parent.add(p);
    m.material = en.mats[0]; en.partner = p; en.fadeT = 0; stats.fading++;
    en.mats[0].lodFade.value.set(0, -1); en.mats[1].lodFade.value.set(0, 1);
  }

  function update(camera = camera0, heightPx = 1080, dt) {
    if (disposed) return;
    const now = performance.now();
    if (dt === undefined) dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!pool.length && (current || queue.length)) slice(budgetMs); else pump();
    // a view that did not move: fades end now (still frames accumulate over many sub-frames of one image)
    const me = camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (lastCam[i] !== me[i]) { moved = true; lastCam[i] = me[i]; }
    const K = camera.isPerspectiveCamera ? heightPx / (2 * Math.tan(camera.fov * Math.PI / 360)) : 0;
    const orthoPx = camera.isOrthographicCamera ? heightPx * camera.zoom / (camera.top - camera.bottom) : 0;
    const cx = me[12], cy = me[13], cz = me[14], near = camera.near || 0.1;
    let drawn = 0;
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i], m = en.mesh;
      if (en.partner) {
        en.fadeT = moved ? en.fadeT + dt / fade : 1;
        if (en.fadeT >= 1 || !m.parent) endFade(en); else { en.mats[0].lodFade.value.x = en.fadeT; en.mats[1].lodFade.value.x = en.fadeT; }
      }
      const n = en.geos.length;
      if (n > 1 && !en.partner) {
        let want = 0;
        if (frozen !== null) want = Math.min(frozen, n - 1);
        else {
          const sp = en.geos[0].boundingSphere, e = m.matrixWorld.elements;
          _v.copy(sp.center).applyMatrix4(m.matrixWorld);
          const d = Math.max(Math.hypot(_v.x - cx, _v.y - cy, _v.z - cz) - sp.radius * Math.hypot(e[0], e[1], e[2]), near), px = K ? K / d : orthoPx;
          for (let l = n - 1; l > 0; l--) if (en.errs[l] * px <= errorPx * (l > en.level ? 1 - hysteresis : 1 + hysteresis)) { want = l; break; }
        }
        if (want !== en.level) {
          const from = en.level;
          en.level = want; m.geometry = en.geos[want]; stats.switches++;
          if (en.canFade && moved && frozen === null && m.visible && m.parent) startFade(en, from);
        }
      }
      drawn += tris(en.geos[en.level]);
    }
    stats.drawnTriangles = drawn;
  }
  const off = auto && scene.isScene ? onView(scene, camera0, (cam, h) => update(cam, h)) : null;

  const api = {
    add, update, stats, entries,
    ready: () => (stats.pending ? new Promise((r) => { readyResolve.push(r); if (!pool.length && !auto) { while (stats.pending) slice(50); } }) : Promise.resolve(stats)),
    // build everything now on this thread (tests, tools); with workers, await ready() instead
    buildNow() { while (!pool.length && (current || queue.length)) slice(1000); return stats; },
    freeze(level) { frozen = level; for (const en of entries) endFade(en); if (level !== null) for (const en of entries) { en.level = Math.min(level, en.geos.length - 1); en.mesh.geometry = en.geos[en.level]; } },
    settle() { for (const en of entries) endFade(en); },
    dispose() {
      disposed = true; off?.();
      for (const w of pool) w.terminate();
      for (const en of entries) { endFade(en); en.mesh.geometry = en.geos[0]; en.mesh.material = en.base; for (let i = 1; i < en.geos.length; i++) en.geos[i].dispose(); en.mats?.forEach((m) => m.dispose()); }
      entries.length = 0; queue.length = 0;
    },
  };
  return api;
}

// HLOD: one merged, simplified stand-in for a group of objects (a streaming cell seen from far away): every mesh
// under the roots (instances expanded) in the space of `origin` (a Matrix4 inverse is applied; default world space),
// its material's colour baked to vertex colours, simplified to `triangles` (or `ratio`). One draw call, one material
// (pass one with vertexColors: true). -> Mesh, with userData.proxy = { sourceTriangles, triangles, error }
export function buildProxy(roots, { material, triangles, ratio = 0.05, error = Infinity, origin = null, colorOf = null, lockBorder = false } = {}) {
  const P = [], N = [], C = [], col = new THREE.Color(), nm = new THREE.Matrix3(), mw = new THREE.Matrix4(), inv = origin ? origin.clone().invert() : null, n = new THREE.Vector3();
  const take = (o, matrix) => {
    const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, idx = g.index;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (colorOf) col.copy(colorOf(mat, o)); else if (mat.userData.proxyColor) col.copy(mat.userData.proxyColor); else if (mat.color) col.copy(mat.color); else col.set(0x808080);
    nm.getNormalMatrix(matrix);
    const count = idx ? idx.count : pa.count;
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      _v.fromBufferAttribute(pa, v).applyMatrix4(matrix); P.push(_v.x, _v.y, _v.z);
      if (na) n.fromBufferAttribute(na, v).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
      N.push(n.x, n.y, n.z);
      if (ca) C.push(col.r * ca.getX(v), col.g * ca.getY(v), col.b * ca.getZ(v)); else C.push(col.r, col.g, col.b);
    }
  };
  for (const root of [].concat(roots)) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.proxy === false || !o.geometry?.attributes.position) return;
      if (o.isInstancedMesh) { const im = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); mw.multiplyMatrices(o.matrixWorld, im); if (inv) mw.premultiply(inv); take(o, mw); } }
      else { mw.copy(o.matrixWorld); if (inv) mw.premultiply(inv); take(o, mw); }
    });
  }
  const positions = new Float32Array(P), src = positions.length / 9;
  const chain = createChain({ positions, attributes: [{ array: new Float32Array(N), itemSize: 3, weight: 0.05 }, { array: new Float32Array(C), itemSize: 3, weight: 0.2 }], lockBorder },
    { ratios: [triangles ? Math.min(1, triangles / Math.max(1, src)) : ratio], error, minGain: 0 });
  chain.step();
  const l = chain.levels[0], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(l.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(l.attributes[0], 3));
  g.setAttribute('color', new THREE.BufferAttribute(l.attributes[1], 3));
  g.setIndex(new THREE.BufferAttribute(l.index, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material || new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'hlod'; mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.userData = { collide: false, lod: false, chunk: false, proxy: { sourceTriangles: src, triangles: l.triangles, error: l.error } };
  return mesh;
}

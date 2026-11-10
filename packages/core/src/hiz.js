// Mirage original code.
// Occlusion culling against a hierarchical depth buffer (Hi-Z) of the frame before: what a wall hid last frame is
// very likely hidden now, so its draw calls and triangles are skipped. The technique is the one GPU-driven
// renderers use (Greene's hierarchical Z; Unreal's and Unity's "HZB" culling); in WebGL2 the test runs on the CPU
// from a small, asynchronous readback, because there are no indirect draws to consume a GPU-side result.
//
//   import { createOcclusion } from '@mirage/core/hiz';
//   const occ = createOcclusion(world, { margin: 1, cutMetres: 3, cutDegrees: 12, confirm: 2 });
//   occ.add(built.root);            // every mesh under it (best after chunkObject: a chunk is something a wall can hide)
//   occ.stats                       // { objects, tested, hidden, hiddenTriangles, age, cuts, readbacks, ms }
//   occ.enabled = false             // everything visible again; occ.dispose()
//
// Per frame, before world.camera's render:
// 1. The depth of the last render (world.pipeline.sceneRT.depthTexture) is reduced on the GPU to 1/16 size, keeping
//    the farthest depth of each 16 x 16 block, and read back through a pixel buffer and a fence (no stall); the
//    view-projection it was drawn with travels with it. The CPU builds the remaining mip levels (max).
// 2. Each object's world box is projected with THAT view-projection; it is occluded when its nearest depth lies
//    behind the farthest depth of every texel its screen rectangle touches (plus one texel all round, which also
//    covers MSAA edge samples the resolved depth cannot see).
// Conservative on purpose: the box is grown by how far the camera moved since the depth was drawn, the rectangle by
// how far it turned; a box that reaches off-screen or crosses the near plane is visible; after a camera cut (more
// than cutMetres / cutDegrees between depth and now, or no depth yet) everything is visible until depth of the
// new view arrives; an object must test occluded `confirm` times in a row to be hidden and is shown again on the
// first test that sees it. Hidden objects still cast their shadows (they are put back for the sun's pass), and
// they are visible to every other camera (walk-grid bake, probes): they are hidden only inside the view's render.
// Limits: a hidden object reappears one to three frames after it could first be seen (the readback's age,
// stats.age); the margins make that rare at walking speed, not impossible on a fast strafe past an edge. Only
// opaque geometry that writes depth occludes. docs/big-worlds.md has the measured popping.
import * as THREE from 'three';
import { onView } from './frame.js';

const VS = 'in vec3 position;\nvoid main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
// each output texel: the farthest of a 4 x 4 block (texels outside the source repeat its edge)
const FS = 'precision highp float;\nprecision highp sampler2D;\nuniform sampler2D tDepth;\nout vec4 o;\nvoid main(){\n  ivec2 size = textureSize(tDepth, 0), base = ivec2(gl_FragCoord.xy) * 4; float d = 0.0;\n  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) d = max(d, texelFetch(tDepth, min(base + ivec2(i, j), size - 1), 0).r);\n  o = vec4(d, 0.0, 0.0, 1.0);\n}';

export function createOcclusion(world, opts = {}) {
  const { margin = 1, cutMetres = 3, cutDegrees = 12, confirm = 2, minTriangles = 0, depth = () => world.pipeline?.sceneRT } = opts;
  const { renderer, scene, camera: camera0 } = world;
  const items = [];          // { o, box: Float32Array(6), tris, hit, hidden }
  const stats = { objects: 0, tested: 0, hidden: 0, hiddenTriangles: 0, age: 0, cuts: 0, readbacks: 0, ms: 0 };
  const quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)),
    new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: { tDepth: { value: null } }, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene(), qCam = new THREE.Camera();
  qScene.add(quad);
  let rtA = null, rtB = null, pending = false, frame = 0, disposed = false;
  let drawn = null;          // { vp: Float64Array(16), pos: [x,y,z], dir: [x,y,z], frame } of the depth now in the depth texture
  let have = null;           // the newest readback: { mips: [{ w, h, d: Float32Array }], vp, pos, dir, frame }
  const api = { enabled: true, stats, add, remove, dispose, test: null };

  function add(root) {
    root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.occlude === false || o.userData.lodPartner || !o.geometry?.attributes.position || items.some((it) => it.o === o)) return;
      const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (tris < minTriangles) return;
      if (!g.boundingBox) g.computeBoundingBox();
      b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      items.push({ o, box: new Float32Array([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]), tris, hit: 0, hidden: false });
    });
    stats.objects = items.length;
    return api;
  }
  function remove(root) {
    const gone = new Set(); root.traverse((o) => gone.add(o));
    for (let i = items.length - 1; i >= 0; i--) if (gone.has(items[i].o)) { if (items[i].hidden) items[i].o.visible = true; items.splice(i, 1); }
    stats.objects = items.length;
  }

  // ---- the reduction and its readback
  function reduce(src) {
    const w = Math.ceil(src.image.width / 4), h = Math.ceil(src.image.height / 4), w2 = Math.ceil(w / 4), h2 = Math.ceil(h / 4);
    if (!rtA || rtA.width !== w || rtA.height !== h) {
      rtA?.dispose(); rtB?.dispose();
      const o = { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
      rtA = new THREE.WebGLRenderTarget(w, h, o); rtB = new THREE.WebGLRenderTarget(w2, h2, o);
    }
    const keep = renderer.getRenderTarget(), auto = renderer.autoClear, xr = renderer.xr.enabled, sh = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false; renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    quad.material.uniforms.tDepth.value = src; renderer.setRenderTarget(rtA); renderer.render(qScene, qCam);
    quad.material.uniforms.tDepth.value = rtA.texture; renderer.setRenderTarget(rtB); renderer.render(qScene, qCam);
    renderer.setRenderTarget(keep); renderer.autoClear = auto; renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sh;
    const buf = new Float32Array(w2 * h2 * 4), tag = drawn;
    pending = true;
    renderer.readRenderTargetPixelsAsync(rtB, 0, 0, w2, h2, buf).then(() => {
      pending = false;
      if (disposed) return;
      const d0 = new Float32Array(w2 * h2);
      for (let i = 0; i < d0.length; i++) d0[i] = buf[i * 4];
      const mips = [{ w: w2, h: h2, d: d0 }];
      while (mips[mips.length - 1].w > 1 || mips[mips.length - 1].h > 1) {
        const s = mips[mips.length - 1], mw = Math.max(1, Math.ceil(s.w / 2)), mh = Math.max(1, Math.ceil(s.h / 2)), d = new Float32Array(mw * mh);
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
          const x1 = Math.min(x * 2 + 1, s.w - 1), y1 = Math.min(y * 2 + 1, s.h - 1);
          d[y * mw + x] = Math.max(s.d[y * 2 * s.w + x * 2], s.d[y * 2 * s.w + x1], s.d[y1 * s.w + x * 2], s.d[y1 * s.w + x1]);
        }
        mips.push({ w: mw, h: mh, d });
      }
      have = { mips, ...tag }; stats.readbacks++;
    }, () => { pending = false; });
  }

  // is the box (min/max, grown by `grow` metres) behind the depth in `have`? `pad` widens its rectangle (NDC units)
  function occluded(box, grow, pad) {
    const m = have.vp, base = have.mips[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zn = Infinity;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? box[3] + grow : box[0] - grow, y = c & 2 ? box[4] + grow : box[1] - grow, z = c & 4 ? box[5] + grow : box[2] - grow;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w < 1e-3) return false;                                   // touches the near plane or lies behind: no claim
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      if (nx < x0) x0 = nx; if (nx > x1) x1 = nx; if (ny < y0) y0 = ny; if (ny > y1) y1 = ny; if (nz < zn) zn = nz;
    }
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    if (x0 < -1 || x1 > 1 || y0 < -1 || y1 > 1) return false;       // reaches past the picture: nothing there was measured
    const z = zn * 0.5 + 0.5;
    // texel rectangle at the base level, one texel all round; then the level where it is at most 2 x 2... 3 x 3 texels
    let tx0 = Math.floor((x0 * 0.5 + 0.5) * base.w) - 1, tx1 = Math.floor((x1 * 0.5 + 0.5) * base.w) + 1, ty0 = Math.floor((y0 * 0.5 + 0.5) * base.h) - 1, ty1 = Math.floor((y1 * 0.5 + 0.5) * base.h) + 1;
    if (tx0 < 0 || ty0 < 0 || tx1 >= base.w || ty1 >= base.h) return false;
    let l = 0;
    while (l < have.mips.length - 1 && (tx1 - tx0 > 2 || ty1 - ty0 > 2)) { tx0 >>= 1; tx1 >>= 1; ty0 >>= 1; ty1 >>= 1; l++; }
    const mp = have.mips[l];
    for (let y = ty0; y <= ty1 && y < mp.h; y++) for (let x = tx0; x <= tx1 && x < mp.w; x++) if (mp.d[y * mp.w + x] >= z) return false;
    return true;
  }
  api.test = (box, grow = 0, pad = 0) => !!have && occluded(box, grow, pad);

  const _vp = new THREE.Matrix4(), _d = new THREE.Vector3();
  function showAll() { for (const it of items) { it.hit = 0; if (it.hidden) { it.hidden = false; it.o.visible = true; } } stats.hidden = 0; stats.hiddenTriangles = 0; }
  function before(cam, heightPx, r, target) {
    if (disposed) return;
    const t0 = performance.now();
    frame++;
    const rt = depth(), src = rt?.depthTexture;
    if (!api.enabled || !src) { if (stats.hidden) showAll(); drawn = null; have = null; return; }
    // 1. what the depth texture holds now was drawn with `drawn`: send it on its way
    if (drawn && !pending && src.image.width > 16) reduce(src);
    // 2. test against the newest readback
    const e = cam.matrixWorld.elements;
    cam.getWorldDirection(_d);
    let ok = !!have;
    if (ok) {
      const move = Math.hypot(e[12] - have.pos[0], e[13] - have.pos[1], e[14] - have.pos[2]), turn = Math.acos(Math.min(1, _d.x * have.dir[0] + _d.y * have.dir[1] + _d.z * have.dir[2]));
      stats.age = frame - have.frame;
      if (move > cutMetres || turn > cutDegrees * Math.PI / 180 || have.fov !== cam.fov) { ok = false; if (stats.hidden) stats.cuts++; }
      else {
        const grow = move * 1.5 + 0.02, pad = Math.tan(turn) * 2 / Math.tan((cam.fov || 50) * Math.PI / 360) * margin + 1e-3;
        let hidden = 0, tris = 0, tested = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i], o = it.o;
          if (!it.hidden && !o.visible) continue;                    // someone else hid it (streaming, a game)
          tested++;
          if (occluded(it.box, grow * margin, pad)) { if (++it.hit >= confirm && !it.hidden) { it.hidden = true; o.visible = false; } }
          else { it.hit = 0; if (it.hidden) { it.hidden = false; o.visible = true; } }
          if (it.hidden) { hidden++; tris += it.tris; }
        }
        stats.tested = tested; stats.hidden = hidden; stats.hiddenTriangles = tris;
      }
    }
    if (!ok && stats.hidden) showAll();
    // 3. this render's depth, for the next call (only renders into the pipeline's scene target count)
    if (target === rt) { _vp.multiplyMatrices(cam.projectionMatrix, _vp.copy(cam.matrixWorld).invert()); drawn = { vp: Float64Array.from(_vp.elements), pos: [e[12], e[13], e[14]], dir: [_d.x, _d.y, _d.z], frame, fov: cam.fov }; }
    stats.ms = performance.now() - t0;
  }
  // hidden only inside the view's own render: other cameras see everything, and so does the sun's shadow pass
  function after() { for (let i = 0; i < items.length; i++) if (items[i].hidden) items[i].o.visible = true; rehide = true; }
  let rehide = false;
  const off = onView(scene, camera0, (cam, h, r, target) => {
    if (rehide) { for (let i = 0; i < items.length; i++) if (items[i].hidden) items[i].o.visible = false; rehide = false; }
    before(cam, h, r, target);
  }, after);
  const sm = renderer.shadowMap, smRender = sm.render;
  sm.render = function (lights, sc, cam) {
    if (sc !== scene || cam !== camera0 || !stats.hidden) return smRender.call(this, lights, sc, cam);
    for (let i = 0; i < items.length; i++) if (items[i].hidden && items[i].o.castShadow) items[i].o.visible = true;
    try { return smRender.call(this, lights, sc, cam); } finally { for (let i = 0; i < items.length; i++) if (items[i].hidden) items[i].o.visible = false; }
  };
  function dispose() { disposed = true; off(); showAll(); if (sm.render !== smRender) sm.render = smRender; rtA?.dispose(); rtB?.dispose(); quad.geometry.dispose(); quad.material.dispose(); }
  return api;
}

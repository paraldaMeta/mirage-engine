// Mirage original code. Export a built world to glTF binary (GLB) and USDZ, with the procedural looks baked.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';

// ---------------------------------------------------------------------------
// exportWorld(world, opts) -> { glb: ArrayBuffer, usdz?: ArrayBuffer, report }
//
// Runs in the page, after buildWorld and world.prepare(). What goes in: every visible mesh on layer 0 under the
// scene (module groups keep their names). What stays out: the sky and stars (ShaderMaterial), collision proxies
// (layer 2, colorWrite false), points and lines, skinned meshes, and anything in opts.exclude (pass play.figure).
//
// Procedural surfaces (patch() hooks albedo / roughness / metalness / normal) are baked into textures:
//   1. unwrap(): triangles are grouped into charts: connected triangles whose face normal shares its dominant axis
//      (±X ±Y ±Z), each chart projected onto that axis plane (box projection; stretch at most 1.73x at 54.7°).
//   2. layout(): charts are shelf-packed into a power-of-two atlas, the texel density bisected so they fit
//      (at most opts.density texels per metre, at most opts.bake texels on a side).
//   3. bake: the mesh's own patched material is drawn with gl_Position = atlas UV, so every hook runs exactly as
//      in the world (world position, world normal, instance attributes, the real texture taps), and the end of
//      main() writes diffuseColor (sRGB), roughness/metalness (glTF ORM: G, B) or the hooked normal re-expressed
//      in the atlas tangent frame. 2x supersampled, then the gutters are dilated so mip maps do not bleed.
//   A mesh with too many charts for its atlas falls back to vertex colours (the same material drawn as points).
// Instanced meshes stay instanced in the GLB (EXT_mesh_gpu_instancing; one bake shared by every instance, drawn
// with instance 0). USDZ has no instancing in three's exporter and Quick Look ignores vertex colours, so the
// USDZ scene expands instances into merged meshes and bakes vertex colours into the atlas too.
//
// opts: { glb = true, usdz = false, bake = 1024, density = 64, maps = ['color', 'orm', 'normal'], jpeg = true,
//         ss = 2, pad = 3, usdzThin = 1 (share of each instanced mesh's instances kept in the USDZ), exclude = [],
//         onProgress(text) }
// Not exported: wind and other vertex animation (the rest pose is kept), lighting / output / emissive hooks
// (translucency, lamp flicker), fog and aerial perspective, post-processing, shadows-as-baked-light.
// ---------------------------------------------------------------------------

const KEEP = ['position', 'normal', 'uv', 'color'];
// [U, V] per dominant axis with U x V = the axis, so every projected triangle keeps counter-clockwise winding
const AXES = [
  [[0, 0, -1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]],   // +X, -X
  [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]],   // +Y, -Y
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]],   // +Z, -Z
];

/** Box-projection charts for a non-indexed triangle list (xyz per corner, metres).
 *  -> { uv: Float32Array (per corner, metres in the chart plane), chartOf: Int32Array (per triangle), charts } */
export function unwrap(pos, { weld = 1e-4 } = {}) {
  const T = Math.floor(pos.length / 9), ids = new Int32Array(T * 3), weldIds = new Map();
  for (let c = 0; c < T * 3; c++) {
    const k = Math.round(pos[c * 3] / weld) + ',' + Math.round(pos[c * 3 + 1] / weld) + ',' + Math.round(pos[c * 3 + 2] / weld);
    let id = weldIds.get(k);
    if (id === undefined) { id = weldIds.size; weldIds.set(k, id); }
    ids[c] = id;
  }
  const axis = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
    const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const X = Math.abs(nx), Y = Math.abs(ny), Z = Math.abs(nz);
    axis[t] = X >= Y && X >= Z ? (nx >= 0 ? 0 : 1) : Y >= Z ? (ny >= 0 ? 2 : 3) : (nz >= 0 ? 4 : 5);
  }
  const parent = new Int32Array(T);
  for (let t = 0; t < T; t++) parent[t] = t;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edges = new Map(), N = weldIds.size;
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const a = ids[t * 3 + e], b = ids[t * 3 + ((e + 1) % 3)];
    if (a === b) continue;
    const key = a < b ? a * N + b : b * N + a, o = edges.get(key);
    if (o === undefined) edges.set(key, t);
    else if (axis[o] === axis[t]) { const ra = find(o), rb = find(t); if (ra !== rb) parent[ra] = rb; }
  }
  const uv = new Float32Array(T * 6), chartOf = new Int32Array(T), charts = [], index = new Map();
  for (let t = 0; t < T; t++) {
    const r = find(t);
    let ci = index.get(r);
    if (ci === undefined) { ci = charts.length; index.set(r, ci); charts.push({ axis: axis[t], tris: 0, minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity }); }
    const ch = charts[ci], [U, V] = AXES[axis[t]];
    chartOf[t] = ci; ch.tris++;
    for (let k = 0; k < 3; k++) {
      const c = t * 3 + k, x = pos[c * 3], y = pos[c * 3 + 1], z = pos[c * 3 + 2];
      const u = x * U[0] + y * U[1] + z * U[2], v = x * V[0] + y * V[1] + z * V[2];
      uv[c * 2] = u; uv[c * 2 + 1] = v;
      if (u < ch.minU) ch.minU = u; if (u > ch.maxU) ch.maxU = u;
      if (v < ch.minV) ch.minV = v; if (v > ch.maxV) ch.maxV = v;
    }
  }
  return { uv, chartOf, charts };
}

function shelfPack(charts, order, size, s, pad) {
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const c = charts[i];
    const w = Math.ceil((c.maxU - c.minU) * s) + 2 * pad + 1, h = Math.ceil((c.maxV - c.minV) * s) + 2 * pad + 1;
    if (w > size) return false;
    if (x + w > size) { y += shelf; x = 0; shelf = 0; }
    if (y + h > size) return false;
    c.x = x; c.y = y; x += w; shelf = Math.max(shelf, h);
  }
  return true;
}

/** Place the charts in a power-of-two atlas: -> { size, density } (texels per metre), or null when even the
 *  largest atlas cannot hold them (too many charts for `size`). Writes chart.x, chart.y (texels). */
export function layout(charts, { size: maxSize = 1024, density = 64, pad = 3, minSize = 32 } = {}) {
  if (!charts.length) return null;
  const area = charts.reduce((s, c) => s + Math.max(c.maxU - c.minU, 1e-3) * Math.max(c.maxV - c.minV, 1e-3), 0);
  const want = Math.sqrt(area) * density * 1.25 + (2 * pad + 1) * Math.sqrt(charts.length) * 1.25;
  let size = minSize;
  while (size < want && size < maxSize) size *= 2;
  const order = charts.map((_, i) => i).sort((a, b) => (charts[b].maxV - charts[b].minV) - (charts[a].maxV - charts[a].minV));
  let best = 0;
  if (shelfPack(charts, order, size, density, pad)) best = density;
  else {
    let lo = 0, hi = density;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (shelfPack(charts, order, size, mid, pad)) { lo = mid; best = mid; } else hi = mid; }
  }
  // below one texel per chart edge the atlas carries nothing a vertex colour would not
  if (!(best > 0) || !shelfPack(charts, order, size, best, pad)) return null;
  return { size, density: best };
}

/** Atlas UVs in 0..1 from unwrap() + layout(). */
export function atlasUV({ uv, chartOf, charts }, { size, density }, pad = 3) {
  const out = new Float32Array(uv.length);
  for (let c = 0; c < uv.length / 2; c++) {
    const ch = charts[chartOf[Math.floor(c / 3)]];
    out[c * 2] = (ch.x + pad + 0.5 + (uv[c * 2] - ch.minU) * density) / size;
    out[c * 2 + 1] = (ch.y + pad + 0.5 + (uv[c * 2 + 1] - ch.minV) * density) / size;
  }
  return out;
}

/** Downsample an ss x ss supersampled RGBA8 bake (GL rows, bottom first) using a coverage buffer, flip it to
 *  image rows (top first) and grow the covered texels `grow` times into the gutters.
 *  -> { rgba: Uint8ClampedArray, covered: Uint8Array, cut } (cut: covered texels whose alpha < 0.5) */
export function resolveBake(color, cover, S, ss, grow = 4) {
  const n = S / ss, rgba = new Uint8ClampedArray(n * n * 4), covered = new Uint8Array(n * n);
  let cut = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0, k = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const p = ((y * ss + j) * S + (x * ss + i)) * 4;
      if (cover[p] > 127) { r += color[p]; g += color[p + 1]; b += color[p + 2]; a += color[p + 3]; k++; }
    }
    if (!k) continue;
    const o = (n - 1 - y) * n + x;
    rgba[o * 4] = r / k; rgba[o * 4 + 1] = g / k; rgba[o * 4 + 2] = b / k; rgba[o * 4 + 3] = a / k;
    covered[o] = 1;
    if (a / k < 128) cut++;
  }
  dilate(rgba, covered, n, grow);
  return { rgba, covered, cut };
}

/** Fill uncovered texels from the average of covered 8-neighbours, `passes` rings deep (in place). */
export function dilate(rgba, covered, n, passes) {
  let mask = covered.slice();
  for (let p = 0; p < passes; p++) {
    const next = mask.slice();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = y * n + x;
      if (mask[o]) continue;
      let r = 0, g = 0, b = 0, a = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= n || Y >= n || !mask[Y * n + X]) continue;
        const q = (Y * n + X) * 4;
        r += rgba[q]; g += rgba[q + 1]; b += rgba[q + 2]; a += rgba[q + 3]; k++;
      }
      if (!k) continue;
      rgba[o * 4] = r / k; rgba[o * 4 + 1] = g / k; rgba[o * 4 + 2] = b / k; rgba[o * 4 + 3] = a / k;
      next[o] = 1;
    }
    mask = next;
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// the page side
// ---------------------------------------------------------------------------

const BAKE_HEAD = /* glsl */ `
vec3 mgBakeSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
const BAKE_OUT = {
  color: 'gl_FragColor = vec4(mgBakeSRGB(diffuseColor.rgb), clamp(diffuseColor.a, 0.0, 1.0));',
  orm: 'gl_FragColor = vec4(1.0, clamp(roughnessFactor, 0.0, 1.0), clamp(metalnessFactor, 0.0, 1.0), 1.0);',
  // the hooked view-space normal in the frame three rebuilds from the atlas UVs (T = +u, B = +v, N = surface)
  normal: /* glsl */ `{
    vec3 mgN0 = normalize(vNormal) * faceDirection, mgP = -vViewPosition;
    vec3 mgT = dFdx(mgP), mgB = dFdy(mgP);
    mgT = normalize(mgT - mgN0 * dot(mgN0, mgT));
    vec3 mgB2 = normalize(cross(mgN0, mgT)); if (dot(mgB2, mgB) < 0.0) mgB2 = -mgB2;
    vec3 mgTs = normalize(vec3(dot(normal, mgT), dot(normal, mgB2), max(dot(normal, mgN0), 0.05)));
    gl_FragColor = vec4(mgTs * 0.5 + 0.5, 1.0);
  }`,
};
const endOfMain = (src, code) => src.replace(/\}\s*$/, `${code}\n}`);

/** a draw-into-the-atlas copy of a page material: same hooks, same program inputs, a different output */
function bakeMaterial(src, pass, vertexColors) {
  const ud = src.userData;
  src.userData = {};                                   // Material.copy JSON-clones userData (hook uniforms hold textures)
  let m;
  try { m = src.clone(); } finally { src.userData = ud; }
  m.userData = {};
  Object.assign(m, { side: THREE.FrontSide, transparent: false, blending: THREE.NoBlending, depthTest: false, depthWrite: false, alphaTest: 0, toneMapped: false, fog: false });
  if (vertexColors) m.vertexColors = true;
  m.onBeforeCompile = (shader, renderer) => {
    if (src.onBeforeCompile) src.onBeforeCompile.call(src, shader, renderer);
    shader.vertexShader = endOfMain(shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 mgBakeUV;'),
      'gl_Position = vec4(mgBakeUV * 2.0 - 1.0, 0.0, 1.0);\ngl_PointSize = 1.0;');
    shader.fragmentShader = endOfMain(shader.fragmentShader.replace('#include <common>', '#include <common>\n' + BAKE_HEAD), BAKE_OUT[pass]);
  };
  const base = src.customProgramCacheKey ? src.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => base + '|bake:' + pass + (vertexColors ? 'v' : '');
  m.needsUpdate = true;
  return m;
}

const COVER = new THREE.RawShaderMaterial({
  vertexShader: 'attribute vec2 mgBakeUV; attribute vec3 position; void main(){ gl_Position = vec4(mgBakeUV * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = 1.0; }',
  fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
  depthTest: false, depthWrite: false, side: THREE.DoubleSide,
});

/** a page geometry as a geometry of this module's three: every per-vertex attribute (`keep` names only, if given) */
function own(geo, keep = null) {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    if (a.isInstancedBufferAttribute || (keep && !keep.includes(name))) continue;
    let arr = a.array;
    if (a.isInterleavedBufferAttribute || arr.length !== a.count * a.itemSize) {
      arr = new a.array.constructor(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  if (geo.index) out.setIndex(new THREE.BufferAttribute(geo.index.array, 1));
  return out;
}

const hooksOf = (m) => (m && m.userData && m.userData.hooks) || {};
const isGlow = (m) => m.isMeshBasicMaterial && hooksOf(m).output && Math.max(m.color.r, m.color.g, m.color.b) > 1;

/** a plain three material for the exporters (no hooks, no userData), copied from a page material */
function plainMaterial(src, G) {
  if (isGlow(src)) {
    const k = Math.max(src.color.r, src.color.g, src.color.b), gain = Math.max(G && G.uLampGain ? G.uLampGain.value : 1, 0.03);
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, name: src.name || 'glow' });
    // at most 1: folded into the colour (USD has no emissive strength); above: KHR_materials_emissive_strength
    const e = k * gain, f = e <= 1 ? e / k : 1 / k;
    m.emissive.setRGB(src.color.r * f, src.color.g * f, src.color.b * f);
    m.emissiveIntensity = e <= 1 ? 1 : e;
    return m;
  }
  const Ctor = { MeshStandardMaterial: THREE.MeshStandardMaterial, MeshPhysicalMaterial: THREE.MeshPhysicalMaterial, MeshBasicMaterial: THREE.MeshBasicMaterial,
    MeshLambertMaterial: THREE.MeshLambertMaterial, MeshPhongMaterial: THREE.MeshPhongMaterial }[src.type] || THREE.MeshStandardMaterial;
  const m = new Ctor(), ud = src.userData;
  src.userData = {};
  try { m.copy(src); } finally { src.userData = ud; }
  m.userData = {};
  m.name = src.name || '';
  return m;
}

function canvasTexture(rgba, n, colorSpace, mimeType) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  c.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace;
  t.userData.mimeType = mimeType;
  return t;
}

const passesFor = (m, maps, bakeVertexColors, hasVC) => {
  const h = hooksOf(m), std = m.isMeshStandardMaterial, out = [];
  if (maps.includes('color') && (h.albedo || (bakeVertexColors && hasVC))) out.push('color');
  if (std && maps.includes('orm') && (h.roughness || h.metalness)) out.push('orm');
  if (std && maps.includes('normal') && h.normal) out.push('normal');
  return out;
};

/** three's USDZExporter writes no `doubleSided`: leaf cards and grass would be culled from behind. Re-open the
 *  archive, mark the meshes whose material is double-sided, and zip it again with USDZ's 64-byte alignment. */
function markDoubleSided(usdz, root) {
  const ids = new Set();
  root.traverse((m) => { if (m.isMesh && m.material.side === THREE.DoubleSide) ids.add(`geometries/Geometry_${m.geometry.id}.usda`); });
  if (!ids.size) return usdz;
  const files = unzipSync(usdz), enc = new TextEncoder(), dec = new TextDecoder();
  for (const f of ids) if (files[f]) files[f] = enc.encode(dec.decode(files[f]).replace(/def Mesh "Geometry"\s*\{/, (h) => `${h}\n\t\tuniform bool doubleSided = 1`));
  return zipAligned(files);
}

/** a stored (uncompressed) zip whose every file's data starts on a 64-byte boundary, as USDZ requires */
export function zipAligned(files) {
  let pos = 0;
  const out = {};
  for (const [name, data] of Object.entries(files)) {
    const base = pos + 30 + enc8(name).length;
    if (base % 64 === 0) { out[name] = data; pos = base + data.length; continue; }
    const pad = (64 - ((base + 4) % 64)) % 64;
    out[name] = [data, { extra: { 12345: new Uint8Array(pad) } }];
    pos = base + 4 + pad + data.length;
  }
  return zipSync(out, { level: 0 });
}
const enc8 = (t) => new TextEncoder().encode(t);

/** the data offsets of a stored zip's files (local headers walked in order): { name: offset } */
export function zipOffsets(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = {};
  let p = 0;
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), n = dv.getUint16(p + 26, true), x = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.subarray(p + 30, p + 30 + n));
    out[name] = p + 30 + n + x;
    p = out[name] + size;
  }
  return out;
}

export async function exportWorld(world, opts = {}) {
  const o = { glb: true, usdz: false, bake: 1024, density: 64, maps: ['color', 'orm', 'normal'], jpeg: true, ss: 2, pad: 3, usdzThin: 1, exclude: [], onProgress: () => {}, ...opts };
  const { scene, renderer, G } = world;
  const t0 = performance.now();
  const skip = new Set([world.sky, world.sky && world.sky.mesh, world.stars, world.stars && world.stars.points, ...o.exclude].filter(Boolean));
  const report = { meshes: [], skipped: [], lost: new Set(), bakeMs: 0, textures: 0, texels: 0 };

  // ---- what goes in
  const items = [];
  for (const top of scene.children) {
    if (skip.has(top) || top.isLight || top.isCamera) continue;
    top.traverseVisible((m) => {
      if (skip.has(m) || !(m.isMesh || m.isPoints || m.isLine || m.isSprite)) return;
      const why = !m.isMesh ? m.type : m.isSkinnedMesh ? 'skinned' : !(m.layers.mask & 1) ? 'not on layer 0' :
        Array.isArray(m.material) ? 'multi-material' : (m.material.isShaderMaterial || m.material.isRawShaderMaterial) ? 'ShaderMaterial' :
        m.material.colorWrite === false || m.material.visible === false ? 'invisible material' : m.isInstancedMesh && m.count === 0 ? 'no instances' : null;
      // a skipped subtree under a skipped object (the figure) is not listed one by one
      if (why) { if (why !== 'not on layer 0' && why !== 'invisible material') report.skipped.push({ name: m.name, module: top.name, why }); return; }
      items.push({ src: m, module: top.name || 'world' });
      for (const k of ['vertexWorld', 'lighting', 'output', 'emissive']) if (hooksOf(m.material)[k]) report.lost.add(k);
    });
  }

  if (G && G.uAmbN && G.uAmbN.value > 0) report.lost.add('ambientVolumes');

  // ---- baking
  const saved = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, xr: renderer.xr && renderer.xr.enabled };
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.updateMatrixWorld();
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, 8192);
  const bakeScene = new THREE.Scene();
  const targets = new Map();
  const target = (S) => {
    if (!targets.has(S)) targets.set(S, new THREE.WebGLRenderTarget(S, S, { depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    return targets.get(S);
  };
  const draw = (obj, S) => {
    const rt = target(S), px = new Uint8Array(S * S * 4);
    bakeScene.add(obj);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(bakeScene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
    bakeScene.remove(obj);
    return px;
  };
  // the object that draws `geo` with `material` placed like the source (instance 0 of an instanced source)
  const drawable = (src, geo, material, asPoints, instanced, place) => {
    let obj;
    if (asPoints) {
      obj = new THREE.Points(geo, material);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(place); obj.matrixWorld.copy(place);
      obj.frustumCulled = false;
      return obj;
    }
    if (instanced) {
      obj = new THREE.InstancedMesh(geo, material, 1);
      obj.instanceMatrix.array.set(src.instanceMatrix.array.subarray(0, 16));
      if (src.instanceColor) obj.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(src.instanceColor.array.subarray(0, 3)), 3);
      for (const [name, a] of Object.entries(src.geometry.attributes)) if (a.isInstancedBufferAttribute) geo.setAttribute(name, a);
    } else obj = new THREE.Mesh(geo, material);
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(src.matrixWorld);
    obj.matrixWorld.copy(src.matrixWorld);
    obj.frustumCulled = false;
    return obj;
  };

  const bakeCache = new Map();
  // bake one source: geo = this module's non-indexed geometry (all attributes), placed by `place` (world matrix of
  // the geometry's space) -> { geometry (export, indexed), maps: { color?, orm?, normal? }, cut, size, density, charts }
  async function bake(src, geo, passes, { instanced, vertexColors, place, palette }) {
    const tb = performance.now();
    const P = geo.attributes.position, wp = new Float32Array(P.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(place); wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z; }
    const un = unwrap(wp);
    const lay = layout(un.charts, { size: o.bake, density: o.density, pad: o.pad });
    const out = { maps: {}, cut: false, charts: un.charts.length };
    const blend = !!src.material.transparent;
    if (!lay) {
      // vertex colours: the material evaluated once per corner (drawn as points into a grid), then re-welded
      const n = P.count, side = Math.ceil(Math.sqrt(n)), S = THREE.MathUtils.ceilPowerOfTwo(side);
      const cell = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { cell[i * 2] = ((i % side) + 0.5) / S; cell[i * 2 + 1] = (Math.floor(i / side) + 0.5) / S; }
      geo.setAttribute('mgBakeUV', new THREE.BufferAttribute(cell, 2));
      const mat = bakeMaterial(src.material, 'color', vertexColors);
      const px = draw(drawable(src, geo, mat, true, instanced, place), S);
      mat.dispose();
      const col = new Float32Array(n * 3), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const p = ((Math.floor(i / side)) * S + (i % side)) * 4;
        c.setRGB(px[p] / 255, px[p + 1] / 255, px[p + 2] / 255, THREE.SRGBColorSpace);   // COLOR_0 is linear
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', geo.attributes.position);
      if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
      if (palette) {
        // Quick Look ignores vertex colours: one texel per chart (the mean of its corners), every corner's UV on
        // that texel's centre, so each chart (a leaf card, a blade) reads one flat colour and its vertices re-weld
        const C = un.charts.length, tside = Math.ceil(Math.sqrt(C)), TS = THREE.MathUtils.ceilPowerOfTwo(tside);
        const sum = new Float64Array(C * 4), tuv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          const ci = un.chartOf[Math.floor(i / 3)], p = ((Math.floor(i / side)) * S + (i % side)) * 4;
          sum[ci * 4] += px[p]; sum[ci * 4 + 1] += px[p + 1]; sum[ci * 4 + 2] += px[p + 2]; sum[ci * 4 + 3]++;
          tuv[i * 2] = ((ci % tside) + 0.5) / TS; tuv[i * 2 + 1] = (Math.floor(ci / tside) + 0.5) / TS;
        }
        const rgba = new Uint8ClampedArray(TS * TS * 4), cov = new Uint8Array(TS * TS);
        for (let ci = 0; ci < C; ci++) {
          const q = (TS - 1 - Math.floor(ci / tside)) * TS + (ci % tside), k = sum[ci * 4 + 3];
          rgba[q * 4] = sum[ci * 4] / k; rgba[q * 4 + 1] = sum[ci * 4 + 1] / k; rgba[q * 4 + 2] = sum[ci * 4 + 2] / k; rgba[q * 4 + 3] = 255; cov[q] = 1;
        }
        dilate(rgba, cov, TS, 2);
        g.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
        const tex = canvasTexture(rgba, TS, THREE.SRGBColorSpace, o.jpeg ? 'image/jpeg' : 'image/png');
        tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
        out.maps.color = tex; out.geometry = mergeVertices(g); out.fallback = 'flat colour per chart'; out.size = TS;
        report.textures++; report.texels += TS * TS;
      } else {
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        out.geometry = mergeVertices(g); out.vertexColors = true; out.fallback = 'vertex colours';
      }
      report.bakeMs += performance.now() - tb;
      return out;
    }
    const uv = atlasUV(un, lay, o.pad);
    geo.setAttribute('mgBakeUV', new THREE.BufferAttribute(uv, 2));
    const ss = Math.max(1, Math.min(o.ss, Math.floor(maxTex / lay.size))), S = lay.size * ss;
    const cover = draw(drawable(src, geo, COVER, false, instanced, place), S);
    for (const pass of passes) {
      const mat = bakeMaterial(src.material, pass, vertexColors);
      const px = draw(drawable(src, geo, mat, false, instanced, place), S);
      mat.dispose();
      const r = resolveBake(px, cover, S, ss, o.pad + 1);
      // alpha survives as a cut-out mask (alphaTest) or, for blended materials, as blended alpha
      const alpha = pass === 'color' && (blend || r.cut > 0.002 * r.covered.reduce((s, x) => s + x, 0));
      if (pass === 'color') out.cut = alpha && !blend;
      const mime = o.jpeg && !alpha ? 'image/jpeg' : 'image/png';
      out.maps[pass] = canvasTexture(r.rgba, lay.size, pass === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace, mime);
      report.textures++; report.texels += lay.size * lay.size;
      await new Promise((res) => setTimeout(res, 0));   // let the page breathe between passes
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (!passes.includes('color') && geo.attributes.color && vertexColors) g.setAttribute('color', geo.attributes.color);
    out.geometry = mergeVertices(g);
    Object.assign(out, { size: lay.size, density: +lay.density.toFixed(1) });
    report.bakeMs += performance.now() - tb;
    return out;
  }

  const plainCache = new Map();
  // the lamps' gain counts the time-of-day grade's exposure (world.gradeLook), which the export does not apply: take it out
  const gradeK = world.gradeLook && world.gradeLook.exposure > 0 ? Math.pow(world.gradeLook.exposure, 0.9) : 1;
  const GX = gradeK === 1 || !G || !G.uLampGain ? G : { ...G, uLampGain: { value: G.uLampGain.value * gradeK } };
  const plain = (m) => { if (!plainCache.has(m.uuid)) plainCache.set(m.uuid, plainMaterial(m, GX)); return plainCache.get(m.uuid); };
  const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

  // one export scene: kind 'glb' keeps instancing and vertex colours; 'usdz' expands and bakes vertex colours
  async function build(kind) {
    const root = new THREE.Scene(), groups = new Map();
    root.name = (world.plan && world.plan.name) || 'mirage-world';
    let k = 0;
    for (const { src, module } of items) {
      o.onProgress(`${kind} ${++k}/${items.length} ${module}/${src.name || src.type}`);
      if (!groups.has(module)) { const g = new THREE.Group(); g.name = module; groups.set(module, g); root.add(g); }
      src.updateWorldMatrix(true, false);
      const m = src.material, expand = kind === 'usdz' && src.isInstancedMesh;
      const hasVC = !!src.geometry.attributes.color && m.vertexColors, instColor = !!src.instanceColor;
      const passes = passesFor(m, o.maps, kind === 'usdz', hasVC || (expand && instColor));
      const row = { kind, name: src.name, module, material: m.name || m.type, instances: src.isInstancedMesh ? src.count : 0, passes };
      let geometry, material, node;
      // the geometry in its export space: expanded instances are merged in the mesh's own space
      const source = () => {
        if (!expand) return own(src.geometry);
        const parts = [], mtx = new THREE.Matrix4(), c = new THREE.Color();
        const base = own(src.geometry);
        for (const name of Object.keys(base.attributes)) if (!KEEP.includes(name)) base.deleteAttribute(name);
        if (!m.vertexColors) base.deleteAttribute('color');
        for (let i = 0; i < src.count; i++) {
          if (Math.floor((i + 1) * o.usdzThin) === Math.floor(i * o.usdzThin)) continue;   // keep an even share
          const g = base.clone().applyMatrix4(mtx.fromArray(src.instanceMatrix.array, i * 16));
          if (instColor) {
            c.fromArray(src.instanceColor.array, i * 3);
            const n = g.attributes.position.count, col = new Float32Array(n * 3), vc = g.attributes.color;
            for (let j = 0; j < n; j++) { col[j * 3] = (vc ? vc.getX(j) : 1) * c.r; col[j * 3 + 1] = (vc ? vc.getY(j) : 1) * c.g; col[j * 3 + 2] = (vc ? vc.getZ(j) : 1) * c.b; }
            g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          }
          parts.push(g.index ? g.toNonIndexed() : g);
        }
        return mergeGeometries(parts, false);
      };
      if (passes.length) {
        // a GLB bake serves the USDZ too, unless it fell back to vertex colours (Quick Look ignores those)
        const key = src.uuid + '|' + passes.join(',') + (expand ? '|x' : ''), prior = bakeCache.get(key);
        let b = prior && !(kind === 'usdz' && prior.vertexColors) ? prior : bakeCache.get(key + '|' + kind);
        if (!b) {
          let geo = source();
          if (geo.index) geo = geo.toNonIndexed();
          const instanced = src.isInstancedMesh && !expand;
          const place = src.matrixWorld.clone();
          if (instanced) place.multiply(new THREE.Matrix4().fromArray(src.instanceMatrix.array, 0));
          b = await bake(src, geo, passes, { instanced, vertexColors: expand && instColor, place: new THREE.Matrix4().copy(place), palette: kind === 'usdz' });
          bakeCache.set(bakeCache.has(key) ? key + '|' + kind : key, b);
        }
        geometry = b.geometry;
        material = plainMaterial(m, GX);
        if (b.vertexColors) { material.vertexColors = true; material.color.set(0xffffff); material.map = null; }
        if (b.maps.color) { material.map = b.maps.color; material.color.set(0xffffff); material.vertexColors = false; if (m.transparent) material.opacity = 1; }
        if (b.cut) { material.alphaTest = 0.5; material.transparent = false; }
        if (b.maps.orm) { material.roughnessMap = material.metalnessMap = b.maps.orm; material.roughness = 1; material.metalness = 1; }
        if (b.maps.normal) { material.normalMap = b.maps.normal; material.normalScale.set(1, 1); }
        Object.assign(row, { atlas: b.size, density: b.density, charts: b.charts, fallback: b.fallback, cutout: !!b.cut });
      } else {
        geometry = expand ? source() : own(src.geometry, KEEP);
        if (!(m.vertexColors || (expand && instColor))) geometry.deleteAttribute('color');
        material = plain(m);
        if (expand && instColor && !material.vertexColors) { material = plainMaterial(m, GX); material.vertexColors = true; }
      }
      if (src.isInstancedMesh && !expand) {
        node = new THREE.InstancedMesh(geometry, material, src.count);
        node.instanceMatrix.array.set(src.instanceMatrix.array.subarray(0, src.count * 16));
        if (src.instanceColor && !passes.includes('color')) node.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(src.instanceColor.array.subarray(0, src.count * 3)), 3);
      } else node = new THREE.Mesh(geometry, material);
      node.name = src.name || '';
      src.matrixWorld.decompose(node.position, node.quaternion, node.scale);
      node.castShadow = src.castShadow; node.receiveShadow = src.receiveShadow;
      groups.get(module).add(node);
      row.triangles = tris(geometry) * (node.isInstancedMesh ? node.count : 1);
      report.meshes.push(row);
    }
    root.updateMatrixWorld(true);   // USDZExporter writes object.matrix as it stands
    return root;
  }

  const result = { report };
  try {
    if (renderer.xr) renderer.xr.enabled = false;
    renderer.autoClear = false;
    if (o.glb) {
      const root = await build('glb');
      o.onProgress('writing GLB');
      result.glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: o.bake });
      result.glbScene = root;
    }
    if (o.usdz) {
      const root = await build('usdz');
      o.onProgress('writing USDZ');
      const usdz = markDoubleSided(await new USDZExporter().parseAsync(root, { maxTextureSize: o.bake, quickLookCompatible: true }), root);
      result.usdz = usdz.buffer.slice(usdz.byteOffset, usdz.byteOffset + usdz.byteLength);
    }
  } finally {
    renderer.setRenderTarget(saved.target);
    renderer.setClearColor(saved.color, saved.alpha);
    renderer.autoClear = saved.autoClear;
    if (renderer.xr) renderer.xr.enabled = saved.xr;
    for (const t of targets.values()) t.dispose();
  }
  report.lost = [...report.lost];
  report.ms = Math.round(performance.now() - t0);
  report.bakeMs = Math.round(report.bakeMs);
  return result;
}

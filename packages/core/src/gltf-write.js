// Mirage original code.

// ---------------------------------------------------------------------------
// A small GLB writer for what exportWorld (export.js) leaves out: skinned meshes and animation clips.
//
//   import { writeGLB } from '@mirage/core';
//   const bytes = writeGLB(rig.root, { clips: rig.clips });            // Uint8Array, runs in Node and the browser
//   const small = writeGLB(rig.root, { clips, meshopt: true });        // EXT_meshopt_compression vertex streams
//
// Written: the node tree under `root` (names, TRS), Mesh / SkinnedMesh geometry (position, normal, uv, colour,
// skin indices and weights, index), skins (joints, inverse bind matrices), MeshStandardMaterial factors, clips
// whose tracks are `<node name>.position | .quaternion | .scale`, and each clip's `userData` as animation extras
// (GLTFLoader gives it back as clip.userData: that is how clip events survive a round trip).
// A material whose map carries `userData.glb = { bytes, mimeType }` embeds those bytes as its base colour image
// ('image/ktx2' is written as KHR_texture_basisu). Not written: morph targets, cameras, lights, other texture slots.
//
// meshopt: the vertex codec (version 0) is implemented below so engine tests can produce a compressed file
// without an encoder dependency; three's decoder reads it back bit-exact (gltf-write.check.mjs). Index buffers and
// animation data stay uncompressed.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const F32 = 5126, U8 = 5121, U16 = 5123, U32 = 5125;

/** meshopt vertex codec v0: `data` holds `count` vertices of `size` bytes (size a multiple of 4, at most 256). */
export function encodeMeshoptVertices(data, count, size) {
  if (size % 4 || size > 256 || size < 4) throw new Error('meshopt: vertex size must be a multiple of 4 in 4..256');
  const out = [0xa0];
  const block = Math.min((8192 / size | 0) & ~15, 256);
  const last = data.slice(0, size), buf = new Uint8Array(256);
  const groupSize = (g, bits) => {   // encoded size of one 16-byte group with a 2- or 4-bit code
    const s = (1 << bits) - 1; let n = 16 * bits / 8;
    for (let i = 0; i < 16; i++) if (buf[g + i] >= s) n++;
    return n;
  };
  for (let v0 = 0; v0 < count; v0 += block) {
    const n = Math.min(block, count - v0), padded = (n + 15) & ~15;
    for (let k = 0; k < size; k++) {
      let p = last[k];
      for (let i = 0; i < n; i++) {
        const b = data[(v0 + i) * size + k], d = (b - p) << 24 >> 24;   // the delta as a signed byte
        buf[i] = ((d << 1) ^ (d >> 7)) & 255;                            // zigzag: small magnitudes, small codes
        p = b;
      }
      buf.fill(0, n, padded);
      const head = out.length, groups = padded / 16;
      for (let i = 0; i < ((groups + 3) >> 2); i++) out.push(0);
      for (let g = 0; g < groups; g++) {
        const o = g * 16;
        let zero = true; for (let i = 0; i < 16; i++) if (buf[o + i]) { zero = false; break; }
        let sel = 0;
        if (!zero) { const s2 = groupSize(o, 2), s4 = groupSize(o, 4); sel = s2 <= s4 && s2 < 16 ? 1 : s4 < 16 ? 2 : 3; }
        out[head + (g >> 2)] |= sel << ((g & 3) * 2);
        if (sel === 3) for (let i = 0; i < 16; i++) out.push(buf[o + i]);
        else if (sel) {
          const bits = sel * 2, s = (1 << bits) - 1, per = 8 / bits;
          for (let i = 0; i < 16; i += per) { let byte = 0; for (let k2 = 0; k2 < per; k2++) byte = (byte << bits) | Math.min(buf[o + i + k2], s); out.push(byte); }
          for (let i = 0; i < 16; i++) if (buf[o + i] >= s) out.push(buf[o + i]);
        }
      }
    }
    last.set(data.subarray((v0 + n - 1) * size, (v0 + n) * size));
  }
  // the tail: the decoder's starting "previous vertex", zero-padded in front to at least 32 bytes
  for (let i = Math.max(32, size) - size; i > 0; i--) out.push(0);
  for (let k = 0; k < size; k++) out.push(data[k]);
  return Uint8Array.from(out);
}

const isIdentity = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

/** Serialise `root` (and `clips`) to a binary glTF. */
export function writeGLB(root, { clips = [], meshopt = false, generator = 'mirage-engine writeGLB' } = {}) {
  const json = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], buffers: [], bufferViews: [], accessors: [] };
  const chunks = []; let offset = 0, fallback = 0;
  const used = new Set(), required = new Set();
  const pushBytes = (u8) => { const at = offset; chunks.push(u8); offset += u8.byteLength; const pad = (4 - (offset & 3)) & 3; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } return at; };
  const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  // one bufferView per accessor: simple, and each vertex stream is its own meshopt block
  function accessor(array, type, componentType, { vertex = false, index = false, normalized = false, minmax = false } = {}) {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type], count = array.length / comps, raw = bytesOf(array);
    const stride = array.BYTES_PER_ELEMENT * comps;
    let view;
    if (vertex && meshopt && stride % 4 === 0) {
      const enc = encodeMeshoptVertices(raw, count, stride);
      view = { buffer: 1, byteOffset: fallback, byteLength: raw.byteLength, byteStride: stride, target: 34962,
        extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: pushBytes(enc), byteLength: enc.byteLength, byteStride: stride, count, mode: 'ATTRIBUTES' } } };
      fallback += (raw.byteLength + 3) & ~3;
      used.add('EXT_meshopt_compression'); required.add('EXT_meshopt_compression');
    } else {
      view = { buffer: 0, byteOffset: pushBytes(raw), byteLength: raw.byteLength };
      if (vertex) view.target = 34962; else if (index) view.target = 34963;
    }
    json.bufferViews.push(view);
    const acc = { bufferView: json.bufferViews.length - 1, componentType, count, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const c = i % comps; if (array[i] < min[c]) min[c] = array[i]; if (array[i] > max[c]) max[c] = array[i]; }
      acc.min = min; acc.max = max;
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  }

  // nodes, depth first so a parent's index is known before its children
  const index = new Map(), byName = new Map(), order = [];
  (function walk(o) { index.set(o, order.length); order.push(o); if (o.name && !byName.has(o.name)) byName.set(o.name, o); o.children.forEach(walk); })(root);
  const materials = new Map(), meshes = new Map();
  function materialOf(m) {
    if (materials.has(m)) return materials.get(m);
    const def = { name: m.name || undefined, pbrMetallicRoughness: { baseColorFactor: [m.color?.r ?? 1, m.color?.g ?? 1, m.color?.b ?? 1, m.opacity ?? 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 1 } };
    if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) def.emissiveFactor = m.emissive.toArray().map((v) => Math.min(1, v * (m.emissiveIntensity ?? 1)));
    if (m.side === THREE.DoubleSide) def.doubleSided = true;
    if (m.transparent) def.alphaMode = 'BLEND';
    const img = m.map?.userData?.glb;
    if (img) {
      json.bufferViews.push({ buffer: 0, byteOffset: pushBytes(img.bytes), byteLength: img.bytes.byteLength });
      (json.images ||= []).push({ bufferView: json.bufferViews.length - 1, mimeType: img.mimeType });
      const source = json.images.length - 1, ktx = img.mimeType === 'image/ktx2';
      if (ktx) { used.add('KHR_texture_basisu'); required.add('KHR_texture_basisu'); }
      (json.textures ||= []).push(ktx ? { extensions: { KHR_texture_basisu: { source } } } : { source });
      def.pbrMetallicRoughness.baseColorTexture = { index: json.textures.length - 1 };
    }
    (json.materials ||= []).push(def);
    materials.set(m, json.materials.length - 1);
    return json.materials.length - 1;
  }
  function meshOf(o) {
    const g = o.geometry, key = g.uuid + '/' + [].concat(o.material).map((m) => m.uuid).join();
    if (meshes.has(key)) return meshes.get(key);
    const a = g.attributes, attributes = { POSITION: accessor(a.position.array, 'VEC3', F32, { vertex: true, minmax: true }) };
    if (a.normal) attributes.NORMAL = accessor(a.normal.array, 'VEC3', F32, { vertex: true });
    if (a.uv) attributes.TEXCOORD_0 = accessor(a.uv.array, 'VEC2', F32, { vertex: true });
    if (a.color) {   // RGBA8: a quarter of float colours, and a 4-byte stride meshopt accepts
      const n = a.color.count, c = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) { c[i * 4] = Math.round(a.color.getX(i) * 255); c[i * 4 + 1] = Math.round(a.color.getY(i) * 255); c[i * 4 + 2] = Math.round(a.color.getZ(i) * 255); c[i * 4 + 3] = 255; }
      attributes.COLOR_0 = accessor(c, 'VEC4', U8, { vertex: true, normalized: true });
    }
    if (o.isSkinnedMesh && a.skinIndex && a.skinWeight) {
      const n = a.skinIndex.count, j = new Uint8Array(n * 4), w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) { w[i * 4 + k] = a.skinWeight.getComponent(i, k); sum += w[i * 4 + k]; }
        // glTF wants unit weight sums and joint 0 where the weight is 0
        for (let k = 0; k < 4; k++) { w[i * 4 + k] /= sum || 1; j[i * 4 + k] = w[i * 4 + k] > 0 ? a.skinIndex.getComponent(i, k) : 0; }
      }
      attributes.JOINTS_0 = accessor(j, 'VEC4', U8, { vertex: true });
      attributes.WEIGHTS_0 = accessor(w, 'VEC4', F32, { vertex: true });
    }
    const prim = { attributes, mode: 4 };
    if (g.index) { const big = a.position.count > 65535; prim.indices = accessor(big ? Uint32Array.from(g.index.array) : Uint16Array.from(g.index.array), 'SCALAR', big ? U32 : U16, { index: true }); }
    const mat = [].concat(o.material)[0];
    if (mat) prim.material = materialOf(mat);
    (json.meshes ||= []).push({ name: o.name || undefined, primitives: [prim] });
    meshes.set(key, json.meshes.length - 1);
    return json.meshes.length - 1;
  }
  const skins = new Map();
  for (const o of order) {
    const def = {};
    if (o.name) def.name = o.name;
    if (!isIdentity(o.position.toArray(), [0, 0, 0])) def.translation = o.position.toArray();
    if (!isIdentity(o.quaternion.toArray(), [0, 0, 0, 1])) def.rotation = o.quaternion.toArray();
    if (!isIdentity(o.scale.toArray(), [1, 1, 1])) def.scale = o.scale.toArray();
    if (o.children.length) def.children = o.children.map((c) => index.get(c));
    if (o.isMesh && o.geometry?.attributes?.position) {
      def.mesh = meshOf(o);
      if (o.isSkinnedMesh && o.skeleton) {
        if (!skins.has(o.skeleton)) {
          const sk = o.skeleton, ibm = new Float32Array(sk.bones.length * 16);
          sk.boneInverses.forEach((m, i) => ibm.set(m.elements, i * 16));
          (json.skins ||= []).push({ joints: sk.bones.map((b) => index.get(b)), inverseBindMatrices: accessor(ibm, 'MAT4', F32) });
          skins.set(sk, json.skins.length - 1);
        }
        def.skin = skins.get(o.skeleton);
      }
    }
    json.nodes.push(def);
  }

  const PATH = { position: ['translation', 'VEC3'], quaternion: ['rotation', 'VEC4'], scale: ['scale', 'VEC3'] };
  for (const clip of clips) {
    const anim = { name: clip.name, channels: [], samplers: [] }, inputs = new Map();
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.'), node = byName.get(track.name.slice(0, dot)), path = PATH[track.name.slice(dot + 1)];
      if (!node || !path) continue;
      const tk = track.times.join();
      if (!inputs.has(tk)) inputs.set(tk, accessor(Float32Array.from(track.times), 'SCALAR', F32, { minmax: true }));
      anim.samplers.push({ input: inputs.get(tk), output: accessor(Float32Array.from(track.values), path[1], F32), interpolation: track.getInterpolation() === THREE.InterpolateDiscrete ? 'STEP' : 'LINEAR' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: index.get(node), path: path[0] } });
    }
    if (clip.userData && Object.keys(clip.userData).length) anim.extras = JSON.parse(JSON.stringify(clip.userData));
    if (anim.channels.length) (json.animations ||= []).push(anim);
  }

  json.buffers.push({ byteLength: offset });
  if (fallback) json.buffers.push({ byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } });
  if (used.size) json.extensionsUsed = [...used];
  if (required.size) json.extensionsRequired = [...required];
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (text.byteLength & 3)) & 3;
  const total = 12 + 8 + text.byteLength + jpad + 8 + offset, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, text.byteLength + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.byteLength, 20 + text.byteLength + jpad);
  let at = 20 + text.byteLength + jpad;
  dv.setUint32(at, offset, true); dv.setUint32(at + 4, 0x004e4942, true); at += 8;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

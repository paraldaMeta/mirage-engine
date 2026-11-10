// Mirage original code. Shell fur: the instanced-shell technique (one draw, the instance index lifts each shell
// along the normal, the layer fraction thins the strands and shades the root) as in aespinosadev's
// webgl-realtimefur-seddi (studied, not copied), written for Mirage's patched materials: alpha-tested with depth
// writes (no sorting), wind from mgWind, three's lighting, shadows and Mirage's fog.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// addFur(ctx, { rect | geometry, shells, length, density, ... }) -> { shells, fins }
//
// A patch of short grass, moss or fur in ONE draw call: the patch's triangles drawn `shells` times
// (InstancedBufferGeometry, instanceCount = shells), shell i lifted (i + 1) / shells x `length` along the normal.
// Each shell keeps the pixels inside a strand: strands sit one per cell of a jittered grid (`density` per m²), in
// world space on the plane the normal faces most (moss on a rock: three planes), each with its own height and a
// radius that tapers to the tip. Kept pixels are shaded from `root` to `tip` (a cheap occlusion toward the ground);
// the rest are discarded before the lighting. The tips bend with mgWind (the world's gusts, x layer²).
// Where a strand is under about a pixel the strands thicken and shorten into a solid lower shell, so a far lawn
// reads as a surface instead of a shimmer of sub-pixel holes.
// fins (opt-in): upright cards along rows (rect) or the mesh's edges, carrying the same strands, shown only where the
// view grazes the patch (the gaps between shells show there); a second draw.
// ---------------------------------------------------------------------------

const FUR_VS = /* glsl */ `
uniform vec4 uFur;          // shells, length (m), first-shell offset (0: a base layer at h = 0, 1: none), wind x length
varying float vFurH;
varying vec3 vFurP;
varying vec3 vFurN;
`;
const FUR_FS = /* glsl */ `
uniform vec4 uFurBlade;     // strands per metre, root radius (share of the cell), seed offset (x, z)
uniform vec4 uFurLod;       // x: the first shell's h (the far LOD keeps it), y: blade height spread
uniform vec3 uFurRoot, uFurTip;
varying float vFurH;
varying vec3 vFurP;
varying vec3 vFurN;
vec3 gFurShade, gFurTilt;
// discards the pixels between strands; gFurShade = the strand's colour at this height. q: the surface point (before
// the lift) in strand cells, n: its normal. One strand root per cell of a 3D lattice, jittered; the distance to it is
// measured in the surface's plane, so any surface (a lawn, a rock) gets strands without projection seams.
void mgFurClip(float h, vec3 q, vec3 n){
  gFurTilt = vec3(0.0);
  if (h <= 0.0) { gFurShade = uFurRoot; return; }   // the base layer (base: true) is the ground under the strands
  vec3 cell = floor(q), r = mgHash3(cell + 5.0), v = q - cell - (0.2 + 0.6 * r);
  v -= n * dot(v, n);
  float tall = 1.0 - uFurLod.y * r.z;
  float k = h / tall;
  // under a pixel per strand: thicker, shorter strands, then a solid lower shell
  float far = smoothstep(0.7, 1.8, length(fwidth(q)));
  float rad = mix(uFurBlade.y * (1.0 - k * k), 1.3, far);
  float top = mix(tall, uFurLod.x + 1e-3, far);
  if (h > top || length(v) > rad) discard;
  vec3 c = mix(uFurRoot, uFurTip, clamp(k, 0.0, 1.0)) * (0.82 + 0.36 * r.x);
  gFurShade = mix(c, mix(uFurRoot, uFurTip, 0.7), far);   // seen from afar (and low), mostly the tips show
  gFurTilt = v / max(rad, 1e-3) * 0.9 * (1.0 - far);       // round strands: the normal leans out from the strand's axis
}
`;
const SHELL_WORLD = /* glsl */ `{
  float h = (float(gl_InstanceID) + uFur.z) / (uFur.x - 1.0 + uFur.z);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vFurP = mgWorld; vFurN = n; vFurH = h;
  mgWorld += n * (h * uFur.y) + mgWind(mgWorld, h * h) * uFur.w;
}`;
const SHELL_CLIP = 'mgFurClip(vFurH, vFurP * uFurBlade.x + vec3(uFurBlade.z, 0.37, uFurBlade.w), normalize(vFurN));';

// fins: aFin = (metres along the row, 0 root .. 1 tip); the strands are stripes across the row
const FIN_VS = 'attribute vec2 aFin;\nvarying vec2 vFin;\n';
const FIN_WORLD = /* glsl */ `{
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vFurP = mgWorld; vFurN = n; vFurH = aFin.y; vFin = aFin;
  mgWorld += n * (aFin.y * uFur.y) + mgWind(mgWorld, aFin.y * aFin.y) * uFur.w;
}`;
const FIN_FS = 'varying vec2 vFin;\n';
// only where the view grazes the surface (|n.v| small): stripes across the row, one strand per cell, thinned out
// (by a per-strand hash) as the view rises
const FIN_CLIP = /* glsl */ `{
  float g = abs(dot(normalize(vFurN), normalize(cameraPosition - mgWorldPos)));
  float u = vFin.x * uFurBlade.x + uFurBlade.z, cell = floor(u);
  if (fwidth(u) > 0.6) discard;   // strands under two pixels: the shells' far layer covers it
  vec3 r = mgHash3(vec3(cell, uFurBlade.w, 7.0));
  float tall = 1.0 - uFurLod.y * r.z, k = vFin.y / tall;
  if (r.y > smoothstep(0.3, 0.1, g) || vFin.y > tall || abs(u - cell - 0.2 - 0.6 * r.x) > uFurBlade.y * (1.0 - k * k)) discard;
  gFurShade = mix(uFurRoot, uFurTip, k) * (0.82 + 0.36 * r.x); gFurTilt = vec3(0.0);
}`;

const finite = (...v) => v.every(Number.isFinite);
const rgb = (c) => (Array.isArray(c) ? new THREE.Vector3(...c) : new THREE.Vector3().setFromColor(new THREE.Color(c)));

// a rect patch: a grid following heightAt, normals from the surface
function rectGeometry([x0, z0, x1, z1], y, heightAt, segments) {
  const [sx, sz] = Array.isArray(segments) ? segments : [segments, segments];
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, y + heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

// fin rows: rect -> rows across x and z every `spacing`; any other geometry -> its unique triangle edges
function finGeometry(src, rect, spacing, y, heightAt) {
  const pos = [], nrm = [], fin = [], idx = [];
  const quad = (a, b, na, nb, u0, u1) => {
    const k = pos.length / 3;
    for (const [p, n, u, v] of [[a, na, u0, 0], [b, nb, u1, 0], [b, nb, u1, 1], [a, na, u0, 1]]) { pos.push(...p); nrm.push(...n); fin.push(u, v); }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  if (rect) {
    const [x0, z0, x1, z1] = rect, up = [0, 1, 0], at = (x, z) => [x, y + heightAt(x, z), z];
    const step = (a, b, f) => { const n = Math.max(1, Math.round((b - a) / 2)); for (let i = 0; i < n; i++) f(a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n); };
    for (let z = z0 + spacing / 2; z < z1; z += spacing) step(x0, x1, (a, b) => quad(at(a, z), at(b, z), up, up, a, b));
    for (let x = x0 + spacing / 2; x < x1; x += spacing) step(z0, z1, (a, b) => quad(at(x, a), at(x, b), up, up, a + 0.37, b + 0.37));
  } else {
    const P = src.attributes.position, N = src.attributes.normal, I = src.index;
    const seen = new Set(), tri = I ? I.count / 3 : P.count / 3, vi = (t, c) => (I ? I.getX(t * 3 + c) : t * 3 + c);
    const v = (i) => [P.getX(i), P.getY(i), P.getZ(i)], n = (i) => [N.getX(i), N.getY(i), N.getZ(i)];
    for (let t = 0; t < tri; t++) for (let c = 0; c < 3; c++) {
      const a = vi(t, c), b = vi(t, (c + 1) % 3), key = a < b ? a + ',' + b : b + ',' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = v(a), pb = v(b), len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      quad(pa, pb, n(a), n(b), 0, len);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 2));
  g.setIndex(idx);
  return g;
}

// the caller's hooks after the fur's own (strings joined, uniforms / defines merged)
function merge(own, extra = {}) {
  const out = { ...own };
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'uniforms' || k === 'defines') out[k] = { ...(own[k] || {}), ...v };
    else if (typeof v === 'string' && typeof own[k] === 'string') out[k] = own[k] + '\n' + v;
    else out[k] = v;
  }
  return out;
}

/** Shell fur / short grass / moss on a patch, one draw call (plus one for the optional fins). options:
 *  rect [x0, z0, x1, z1] (+ y 0, heightAt(x, z) => 0, segments 1) or geometry (BufferGeometry with normals, world
 *  space; the shells follow its normals), shells (16), length m (0.06), density strands per m² (900), thickness (root
 *  radius as a share of a strand's cell, 0.32), spread (strand height variation 0..1, 0.45), root / tip (linear RGB or
 *  a colour; a dark root, a pale tip), wind (1: a gust bends a tip by about 0.4 x length), base (false: also draw an
 *  opaque layer at the surface), shadows (false: cast shadows), fins (false | spacing in m for rect, true for the
 *  mesh's edges), roughness (0.9), hooks (more patch() hooks after the fur's), seed, name ('fur').
 *  Returns { shells, fins } (fins null when off); both added to ctx.root and never collide. */
export function addFur(ctx, {
  rect, geometry, y = 0, heightAt = () => 0, segments = 1, shells = 16, length = 0.06, density = 900, thickness = 0.32, spread = 0.45,
  root = [0.035, 0.06, 0.016], tip = [0.2, 0.25, 0.08], wind = 1, base = false, shadows = false, fins = false, roughness = 0.9,
  hooks, seed = 'fur', name = 'fur',
} = {}) {
  if (!rect === !geometry) throw new RangeError('fur needs exactly one of rect or geometry');
  if (rect && !(rect.length === 4 && finite(...rect) && rect[0] < rect[2] && rect[1] < rect[3])) throw new RangeError('fur.rect must be ordered [x0, z0, x1, z1]');
  if (geometry && !(geometry.attributes?.position && geometry.attributes?.normal)) throw new RangeError('fur.geometry needs position and normal attributes');
  if (!(Number.isInteger(shells) && shells >= 2 && shells <= 128)) throw new RangeError('fur.shells must be an integer 2..128');
  if (!(finite(length, density, thickness, spread, wind, y) && length > 0 && density > 0 && thickness > 0)) throw new RangeError('fur options must be finite, length / density / thickness > 0');
  const R = ctx.rng(seed), off = [R.range(0, 1000), R.range(0, 1000)];
  const src = rect ? rectGeometry(rect, y, heightAt, segments) : geometry;
  const U = {
    uFur: { value: new THREE.Vector4(shells, length, base ? 0 : 1, wind * length * 4) },
    uFurBlade: { value: new THREE.Vector4(Math.sqrt(density), Math.min(thickness, 0.9), off[0], off[1]) },
    uFurLod: { value: new THREE.Vector4(base ? 0 : 1 / shells, Math.min(Math.max(spread, 0), 0.9), 0, 0) },
    uFurRoot: { value: rgb(root) }, uFurTip: { value: rgb(tip) },
  };
  const own = (vsExtra, world, fsExtra, clip) => ({
    vertexDecl: FUR_VS + vsExtra, vertexWorld: world, fragmentDecl: FUR_FS + fsExtra,
    albedo: `${clip}\ndiffuseColor.rgb *= gFurShade;`, normal: 'normal = normalize(normal + mat3(viewMatrix) * gFurTilt);', uniforms: U,
  });
  const make = (geo, h, clip) => {
    const material = ctx.mat.std({ roughness }, merge(h, hooks));
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true; mesh.castShadow = !!shadows; mesh.userData.collide = false;
    if (shadows) {
      // the shadow pass needs the same lift and the same holes: a depth material with the vertex hooks, the strand
      // test called where three's alpha test would be
      const d = ctx.mat.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { vertexDecl: h.vertexDecl, vertexWorld: h.vertexWorld, fragmentDecl: h.fragmentDecl, uniforms: U });
      const prev = d.onBeforeCompile;
      d.onBeforeCompile = (s, r) => { prev(s, r); s.fragmentShader = s.fragmentShader.replace('#include <alphatest_fragment>', clip + '\n#include <alphatest_fragment>'); };
      mesh.customDepthMaterial = d;
    }
    return mesh;
  };
  const geo = new THREE.InstancedBufferGeometry();
  for (const k of ['position', 'normal']) geo.setAttribute(k, src.attributes[k]);
  if (src.index) geo.setIndex(src.index);
  geo.instanceCount = shells;
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += length * 1.6;   // the shells and their sway reach past the surface
  const shellMesh = make(geo, own('', SHELL_WORLD, '', SHELL_CLIP), SHELL_CLIP);
  shellMesh.name = name;
  ctx.root.add(shellMesh);
  let finMesh = null;
  if (fins) {
    const spacing = typeof fins === 'number' && fins > 0 ? fins : 0.35;
    const fg = finGeometry(src, rect, spacing, y, heightAt);
    fg.computeBoundingSphere(); fg.boundingSphere.radius += length * 1.6;
    finMesh = make(fg, own(FIN_VS, FIN_WORLD, FIN_FS, FIN_CLIP), FIN_CLIP);
    finMesh.material.side = THREE.DoubleSide;
    finMesh.name = name + '-fins';
    ctx.root.add(finMesh);
  }
  return { shells: shellMesh, fins: finMesh };
}

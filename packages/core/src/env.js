// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The light state of ONE world.
//
//   const env = createEnv({ wind: { dir: [0.8, 0.6], strength: 1 } });
//   env.keyDir   THREE.Vector3 toward the key light (the Sun by day, the Moon at night), rewritten in place
//   env.G        shared uniforms ({ value } objects). Every patch()ed material of this world references these
//                same objects, so one write reaches every shader.
//
// Frame: metres, +X east, +Y up, +Z south (north is -Z). Azimuths are compass bearings (0 north, 90 east).
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;
export const AMB_MAX = 8;
/** Bumped whenever a module patches three's shader chunks (light2, soft shadows): Mirage materials put it in their
 *  program cache key, because three's key does not see chunk text and a program compiled before the patch (another
 *  world on the same renderer) would otherwise be reused without it. 0 on pages that never patch (keys unchanged). */
export const CHUNK_EPOCH = { n: 0 };

/** The reference "golden hour": a low sun in the west-south-west. Exposure and the legacy look are tuned here. */
export const GOLDEN = Object.freeze({ elevation: 6.8, azimuth: 250 });

/** Unit vector (engine frame) toward elevation / compass azimuth in degrees. */
export function dirFromElevAz(elevation, azimuth, out = new THREE.Vector3()) {
  const ce = Math.cos(elevation * D2R);
  return out.set(ce * Math.sin(azimuth * D2R), Math.sin(elevation * D2R), -ce * Math.cos(azimuth * D2R));
}
/** Elevation / azimuth (degrees) of a direction. */
export function elevAzOf(d) {
  const v = d.isVector3 ? d : new THREE.Vector3(...d);
  return { elevation: Math.asin(Math.max(-1, Math.min(1, v.y))) / D2R, azimuth: ((Math.atan2(v.x, -v.z) / D2R) + 360) % 360 };
}

export function createEnv({ wind = {} } = {}) {
  const keyDir = dirFromElevAz(GOLDEN.elevation, GOLDEN.azimuth);
  const w = wind.dir || [0.8, 0.6];
  const G = {
    uTime: { value: 0 },                                   // seconds (animation, wind)
    uFrame: { value: 0 },                                  // sub-frame counter (rarely needed in materials)
    uWind: { value: new THREE.Vector3(w[0] / (Math.hypot(w[0], w[1]) || 1), w[1] / (Math.hypot(w[0], w[1]) || 1), wind.strength ?? 1) },   // (dir.x, dir.z, strength); dir [0, 0] = still air, not NaN
    uKeyDir: { value: keyDir.clone() },                    // toward the key light
    uKeyColor: { value: new THREE.Vector3(7.0, 4.9, 3.0) },// key radiance (linear RGB x intensity)
    uLamp: { value: 1 },        // lamps / lit windows: 0 off (day) .. 1 lit (night)
    uLampGain: { value: 1 },    // emissive multiplier for lamps (follows the night exposure)
    uSkyLight: { value: 1 },    // sky light relative to the golden hour (for hand-made ambient terms)
    uNight: { value: 0 },       // 0 day .. 1 night
    uUser: { value: new THREE.Vector4() },  // free for the host
    // ambient volumes (world.setAmbientVolumes): boxes where the image-based light is scaled down (interiors)
    uAmbN: { value: 0 },
    uAmbLo: { value: Array.from({ length: AMB_MAX }, () => new THREE.Vector4()) },   // min corner, soft edge (m)
    uAmbHi: { value: Array.from({ length: AMB_MAX }, () => new THREE.Vector4()) },   // max corner, factor inside
    // the grid path (more than AMB_MAX boxes, or a tint): see writeAmbientVolumes
    uAmbGrid: { value: new THREE.Vector4() },   // grid origin x, z (m), 1 / cell size (1/m), data texture width (texels)
    uAmbDim: { value: new THREE.Vector4() },    // cells along x, along z (x = 0: no grid)
    uAmbData: { value: null },                  // RGBA float texture: one texel per cell, then 3 per (cell, box)
  };
  return { keyDir, G };
}

// ---------------------------------------------------------------------------
// Ambient volumes: boxes where the image-based (sky) light is scaled down, interiors.
//
//   writeAmbientVolumes(G, [{ min, max, factor = 0.3, soft = 0.6, tint = [1, 1, 1] }], { grid })
//
// Two paths, chosen by the list:
//   uniform  at most AMB_MAX boxes and no tint: two vec4 arrays and a loop over all of them (the path every world
//            had before tints; it is kept as it was, so those worlds compile and draw exactly what they did)
//   grid     more boxes, or any tint (or { grid: true }): the boxes go into one float data texture behind a 2D grid
//            over x / z, and a point visits only the boxes listed in its cell (each box is listed in every cell its
//            footprint, grown by `soft`, touches). The cost per pixel is the boxes that overlap that cell, not the
//            boxes in the world: a town of 1,000 rooms costs what a street of 3 does. Inside a box the light is
//            scaled by factor x tint per channel (warm bounce off sunlit walls, cool blue shade).
// Overlapping boxes multiply on both paths. Outside every box the result is exactly 1.
// ---------------------------------------------------------------------------

/** GLSL uniforms each path declares (materials.js declares only these of the uAmb* uniforms) */
export const AMB_UNIFORMS = Object.freeze({ 0: [], 1: ['uAmbN', 'uAmbLo', 'uAmbHi'], 2: ['uAmbN', 'uAmbGrid', 'uAmbDim', 'uAmbData'] });
/** 0 no volumes, 1 the uniform path, 2 the grid path */
export const ambientMode = (G) => (!(G.uAmbN && G.uAmbN.value > 0) ? 0 : G.uAmbDim && G.uAmbDim.value.x > 0 ? 2 : 1);

const AMB_TEX_W = 1024;          // data texture width (texels)
/** the most boxes one grid cell lists (the shader loop's constant bound) */
export const AMB_PER_CELL = 16;
const AMB_CELLS = 256 * 256;     // most cells in a grid
const AMB_TEXELS = AMB_TEX_W * 1024;   // most texels (16 MB); a list past it gets coarser cells
const AMB_LIST = new WeakMap();  // G -> the boxes on the grid path (ambientNear)
const isWhite = (t) => !t || (t[0] === 1 && t[1] === 1 && t[2] === 1);

/** Write a list of ambient volumes into G. Returns { recompile } (the path changed: materials must recompile) and
 *  { info: { path, boxes, cells, maxPerCell, texels, cellSize } }. `grid: true` takes the grid path for any list. */
export function writeAmbientVolumes(G, list = [], { grid } = {}) {
  const before = ambientMode(G);
  const old = G.uAmbData.value;
  const useGrid = list.length > 0 && (grid === true || list.length > AMB_MAX || list.some((v) => !isWhite(v.tint)));
  let info;
  if (!useGrid) {
    // the uniform path, written as it always was
    const n = Math.min(list.length, G.uAmbLo.value.length);
    for (let i = 0; i < n; i++) {
      const v = list[i];
      G.uAmbLo.value[i].set(v.min[0], v.min[1], v.min[2], v.soft ?? 0.6);
      G.uAmbHi.value[i].set(v.max[0], v.max[1], v.max[2], v.factor ?? 0.3);
    }
    G.uAmbN.value = n;
    G.uAmbDim.value.set(0, 0, 0, 0); G.uAmbData.value = null;
    AMB_LIST.delete(G);
    info = { path: n ? 'uniform' : 'none', boxes: n, cells: 0, maxPerCell: n, overfull: 0, texels: 0, cellSize: 0 };
  } else {
    const g = ambientGrid(list);
    G.uAmbGrid.value.set(g.x0, g.z0, 1 / g.cell, AMB_TEX_W);
    G.uAmbDim.value.set(g.gw, g.gh, 0, 0);
    G.uAmbData.value = g.tex;
    G.uAmbN.value = g.boxes.length;
    AMB_LIST.set(G, g.boxes);
    info = { path: 'grid', boxes: g.boxes.length, cells: g.gw * g.gh, maxPerCell: g.maxPerCell, overfull: g.overfull, texels: g.texels, cellSize: g.cell };
  }
  if (old && old !== G.uAmbData.value) old.dispose();
  return { recompile: before !== ambientMode(G), info };
}

/** Free the grid path's texture (world.dispose). */
export function disposeAmbient(G) {
  if (G.uAmbData && G.uAmbData.value) { G.uAmbData.value.dispose(); G.uAmbData.value = null; }
}

// the grid: cells over the boxes' footprints (grown by soft) sized near the median footprint, so a room is listed in
// a few cells and a cell holds a few rooms; a big box (a whole vault) is listed in every cell it covers. Cells are made
// smaller while one lists more than AMB_PER_CELL boxes (the shader's loop has that constant bound: a loop bounded by a
// value read from the texture cost 5 - 7 ms a frame in the Nizwa probe on ANGLE / Metal, a constant bound 0.2 - 0.5);
// a cell still over it keeps its darkest AMB_PER_CELL boxes (info.overfull counts such cells).
function ambientGrid(list) {
  const boxes = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const foot = [];
  for (const v of list) {
    const soft = v.soft ?? 0.6, f = v.factor ?? 0.3, t = v.tint || [1, 1, 1];
    const b = { min: [v.min[0], v.min[1], v.min[2]], max: [v.max[0], v.max[1], v.max[2]], soft, val: [f * t[0], f * t[1], f * t[2]] };
    if (![...b.min, ...b.max, soft, ...b.val].every(Number.isFinite)) continue;
    boxes.push(b);
    x0 = Math.min(x0, b.min[0] - soft); z0 = Math.min(z0, b.min[2] - soft);
    x1 = Math.max(x1, b.max[0] + soft); z1 = Math.max(z1, b.max[2] + soft);
    foot.push(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) + 2 * soft);
  }
  if (!boxes.length) { x0 = z0 = 0; x1 = z1 = 1; foot.push(1); }
  foot.sort((a, b) => a - b);
  const pad = 1e-3, sx = x1 - x0 + 2 * pad, sz = z1 - z0 + 2 * pad;
  x0 -= pad; z0 -= pad;
  const layout = (cell) => {
    const gw = Math.max(1, Math.ceil(sx / cell)), gh = Math.max(1, Math.ceil(sz / cell));
    if (gw * gh > AMB_CELLS) return null;
    const lists = Array.from({ length: gw * gh }, () => []);
    const at = (x, n) => Math.min(n - 1, Math.max(0, Math.floor(x / cell)));
    let entries = 0, most = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], e = b.soft + cell * 1e-4;
      const cx0 = at(b.min[0] - e - x0, gw), cx1 = at(b.max[0] + e - x0, gw), cz0 = at(b.min[2] - e - z0, gh), cz1 = at(b.max[2] + e - z0, gh);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) { const L = lists[cz * gw + cx]; L.push(i); entries++; most = Math.max(most, L.length); }
    }
    const texels = gw * gh + 3 * Math.min(entries, gw * gh * AMB_PER_CELL);
    return texels > AMB_TEXELS ? null : { cell, gw, gh, lists, most, texels };
  };
  // the first layout that fits, coarser if the texture would be too big; then finer while a cell is over the bound
  const floor = Math.max(0.25, Math.sqrt((sx * sz) / AMB_CELLS));
  let cell = Math.max(foot[foot.length >> 1], floor), g = null;
  while (!(g = layout(cell))) cell *= 1.5;
  for (let c = g.cell * 0.7; g.most > AMB_PER_CELL && c >= floor; c *= 0.7) {
    const f = layout(c);
    if (!f) break;
    if (f.most < g.most) g = f;
  }
  const { gw, gh, lists } = g;
  const h = Math.max(1, Math.ceil(g.texels / AMB_TEX_W)), data = new Float32Array(AMB_TEX_W * h * 4);
  const dark = (i) => Math.min(...boxes[i].val);
  let e = gw * gh, maxPerCell = 0, overfull = 0;
  for (let c = 0; c < lists.length; c++) {
    let L = lists[c];
    if (L.length > AMB_PER_CELL) { overfull++; L = [...L].sort((a, b) => dark(a) - dark(b)).slice(0, AMB_PER_CELL).sort((a, b) => a - b); }
    // cell texel: first entry texel, box count, the lowest and highest y its boxes reach (with soft)
    let y0 = Infinity, y1 = -Infinity;
    for (const i of L) { y0 = Math.min(y0, boxes[i].min[1] - boxes[i].soft); y1 = Math.max(y1, boxes[i].max[1] + boxes[i].soft); }
    data.set([e, L.length, L.length ? y0 - 1e-3 : 0, L.length ? y1 + 1e-3 : 0], c * 4);
    maxPerCell = Math.max(maxPerCell, L.length);
    for (const i of L) {
      const b = boxes[i];
      data.set([b.min[0], b.min[1], b.min[2], b.soft, b.max[0], b.max[1], b.max[2], 0, b.val[0], b.val[1], b.val[2], 0], e * 4);
      e += 3;
    }
  }
  if (overfull) console.warn(`[mirage] setAmbientVolumes: ${overfull} grid cells list more than ${AMB_PER_CELL} overlapping boxes; each keeps its ${AMB_PER_CELL} darkest`);
  const tex = new THREE.DataTexture(data, AMB_TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  tex.name = 'mirage.ambientVolumes';
  return { boxes, x0, z0, cell: g.cell, gw, gh, tex, texels: e, maxPerCell, overfull };
}

/** Is p within d metres of an ambient volume? (light2's shafts march near rooms) */
export function ambientNear(G, p, d) {
  const L = ambientMode(G) === 2 ? AMB_LIST.get(G) : null;
  const n = L ? L.length : G.uAmbN.value;
  for (let i = 0; i < n; i++) {
    const lo = L ? L[i].min : G.uAmbLo.value[i], hi = L ? L[i].max : G.uAmbHi.value[i];
    const lx = L ? lo[0] : lo.x, ly = L ? lo[1] : lo.y, lz = L ? lo[2] : lo.z, hx = L ? hi[0] : hi.x, hy = L ? hi[1] : hi.y, hz = L ? hi[2] : hi.z;
    const dx = Math.max(lx - p.x, 0, p.x - hx), dy = Math.max(ly - p.y, 0, p.y - hy), dz = Math.max(lz - p.z, 0, p.z - hz);
    if (dx * dx + dy * dy + dz * dz < d * d) return true;
  }
  return false;
}

/** The ambient GLSL a material of this path compiles: '' (none), AMBIENT_GLSL (float mgAmbient), or the grid
 *  (vec3 mgAmbientRGB, and float mgAmbient = its luminance, for hooks that read one number). */
export const ambientGLSL = (mode) => (mode === 2 ? AMBIENT_GRID_GLSL + AMBIENT_GRID_API : mode === 1 ? AMBIENT_GLSL : '');

// The grid path. Needs uAmbGrid, uAmbDim (vec4) and uAmbData (highp sampler2D) declared: AMBIENT_GRID_DECL.
export const AMBIENT_GRID_DECL = 'uniform vec4 uAmbGrid; uniform vec4 uAmbDim; uniform highp sampler2D uAmbData;';
export const AMBIENT_GRID_GLSL = /* glsl */ `
vec4 mgAmbTexel(int i){ int w = int(uAmbGrid.w); return texelFetch(uAmbData, ivec2(i - (i / w) * w, i / w), 0); }
vec3 mgAmbientGrid(vec3 p){
  vec2 c = floor((p.xz - uAmbGrid.xy) * uAmbGrid.z);
  if (!(c.x >= 0.0 && c.y >= 0.0 && c.x < uAmbDim.x && c.y < uAmbDim.y)) return vec3(1.0);
  vec4 cell = mgAmbTexel(int(c.y * uAmbDim.x + c.x));
  int s = int(cell.x), n = p.y >= cell.z && p.y <= cell.w ? int(cell.y) : 0;
  vec3 k = vec3(1.0);
  for (int i = 0; i < ${AMB_PER_CELL}; i++){
    if (i >= n) break;
    int e = s + 3 * i;
    vec4 lo = mgAmbTexel(e), hi = mgAmbTexel(e + 1);
    float sf = max(lo.w, 1e-3);
    float d = length(max(max(lo.xyz - p, p - hi.xyz), 0.0));
    if (d >= sf) continue;
    k *= mix(mgAmbTexel(e + 2).rgb, vec3(1.0), smoothstep(0.0, sf, d));
  }
  return k;
}
`;
const AMBIENT_GRID_API = /* glsl */ `
vec3 mgAmbientRGB(vec3 p){ return mgAmbientGrid(p); }
float mgAmbient(vec3 p){ return dot(mgAmbientGrid(p), vec3(0.2126, 0.7152, 0.0722)); }
`;

// The uniform path: 1 outside every box, `factor` inside, a smooth ramp over `soft` metres outside the box.
// With no volumes the loop does not run and the result is exactly 1.0 (images stay bit-identical).
export const AMBIENT_GLSL = /* glsl */ `
float mgAmbient(vec3 p){
  float k = 1.0;
  for (int i = 0; i < ${AMB_MAX}; i++){
    if (float(i) >= uAmbN) break;
    vec4 lo = uAmbLo[i], hi = uAmbHi[i];
    float d = length(max(max(lo.xyz - p, p - hi.xyz), 0.0));
    k *= mix(hi.w, 1.0, smoothstep(0.0, max(lo.w, 1e-3), d));
  }
  return k;
}
`;

// Wind sway for vertex hooks: mgWind(worldPos, flex) -> world-space offset (flex 0 at the root, 1 at the tips).
// Two travelling gust waves along the wind, a slower sway and a small high-frequency flutter.
export const WIND_GLSL = /* glsl */ `
vec3 mgWind(vec3 p, float flex){
  vec2 d = uWind.xy;
  float along = dot(p.xz, d);
  float gust = 0.6 + 0.4 * sin(uTime * 0.41 - along * 0.07) * cos(uTime * 0.19 + p.x * 0.013 - p.z * 0.017);
  float sway = sin(uTime * 1.17 - along * 0.21 + p.y * 0.3) * 0.7 + sin(uTime * 1.93 + p.x * 0.27 - p.z * 0.31) * 0.3;
  float flut = sin(uTime * 6.3 + dot(p, vec3(2.3, 1.9, 2.7))) * 0.6 + sin(uTime * 9.7 + dot(p, vec3(3.1, 2.2, 1.7))) * 0.4;
  vec3 o = vec3(d.x, 0.0, d.y) * (0.05 * gust + 0.045 * sway) + vec3(-d.y, 0.6, d.x) * flut * 0.012;
  return o * flex * uWind.z;
}
`;

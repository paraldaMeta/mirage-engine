// Demo: a large world, generated in code: 4 x 4 km of hills in 256 streaming cells (terrain and rocks, about
// 5 million source triangles), a walled town of merged buildings at the centre and 30 000 trees. Every part of the
// big-world work has one URL switch, so bigworld-check.mjs can measure each against the plain three.js baseline.
// URL: ?base=1    everything off: all cells loaded, one batch per material, three's InstancedMesh, no LOD
//      ?part=0    no world partition (all cells loaded at start)       ?hlod=0  no proxies for cells that are out
//      ?chunk=0   the town stays one mesh per material                 ?lod=0   no automatic LOD (terrain, rocks, town)
//      ?inst=0    trees as one InstancedMesh per part                  ?imp=0   no impostors as the trees' last level
//      ?occ=0     no Hi-Z occlusion culling                            ?origin=0  no floating origin
//      ?trees=N (30000)  ?load=M (600 m)  ?w=&h=  ?quality=  ?auto=1 (fly the test path)  ?t=0..1 (start on the path)
// Keys: W A S D + drag to fly, Shift fast. window.__mirage = { world, part, lod, occ, trees, run(frames), still(t), ... }
import * as THREE from 'three';
import { createWorldRenderer, geom } from '@mirage/core';
import { createAutoLod } from '@mirage/core/autolod';
import { createInstances } from '@mirage/core/instancing';
import { createOcclusion } from '@mirage/core/hiz';
import { chunkObject } from '@mirage/core/chunk';
import { createPartition } from '@mirage/world';

const Q = new URLSearchParams(location.search);
const on = (k) => !Q.has('base') ? Q.get(k) !== '0' : Q.get(k) === '1';
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const SIZE = 4096, CELL = 256, HALF = SIZE / 2, SEG = 80, TREES = +(Q.get('trees') ?? 30000), LOAD = +Q.get('load') || 600;
const T0 = performance.now(), timing = {};

const world = createWorldRenderer({ quality: Q.get('quality') || 'medium', canvas, width: W, height: H, preserveDrawingBuffer: true,
  place: { lat: 46.5, lon: 9.8, height: 900, tzHours: 1 }, time: 'golden', shadow: { center: [0, 20, 0], radius: 140 }, envProbe: [0, 60, 0],
  fog: { groundDensity: 0.00035, height: 400 }, post: { grain: 0 } });
const { camera, scene, renderer } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.3; camera.far = 9000; camera.updateProjectionMatrix();

// ---- the land: value noise in octaves, flattened to a plateau where the town stands
const h2 = (x, z) => { let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, z) => { const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const TOWN = 150;
function height(x, z) {
  const hills = 150 * vnoise(x / 700 + 11.3, z / 700 + 4.1) + 45 * vnoise(x / 190 + 3.7, z / 190 + 8.2) + 9 * vnoise(x / 47, z / 47) + 1.2 * vnoise(x / 9, z / 9) - 60;
  const d = Math.hypot(x, z), k = geom.smoothstep(TOWN + 20, TOWN + 160, d);
  return 20 + (hills - 20) * k;
}
const matLand = world.mat.std({ vertexColors: true, roughness: 0.95, metalness: 0 });
const matRock = world.mat.std({ color: 0x77736c, roughness: 0.9, metalness: 0 });
const matWall = world.mat.std({ color: 0xb9a78c, roughness: 0.85, metalness: 0 });
const matRoof = world.mat.std({ color: 0x8a4a35, roughness: 0.8, metalness: 0 });
const matTrunk = world.mat.std({ color: 0x4a3626, roughness: 0.95, metalness: 0 });
const matLeaf = world.mat.std({ color: 0x35582c, roughness: 0.9, metalness: 0 });
const cGrass = new THREE.Color(0x4f6b34), cDry = new THREE.Color(0x8a8052), cRock = new THREE.Color(0x76716a), cSnow = new THREE.Color(0xe6e9ee), _c = new THREE.Color();
const rockGeo = new THREE.IcosahedronGeometry(1, 7);   // 20 * 8 * 8 = 1280 triangles

// a cell's content, around its own centre: terrain (borders locked so LODs of neighbours never crack) and rocks
function buildCell(cell, ctx) {
  const n = SEG + 1, pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), locked = new Uint8Array(n * n), idx = new Uint32Array(SEG * SEG * 6), st = CELL / SEG;
  for (let j = 0, v = 0; j < n; j++) for (let i = 0; i < n; i++, v++) {
    const lx = -CELL / 2 + i * st, lz = -CELL / 2 + j * st, ax = cell.x + lx, az = cell.z + lz, y = height(ax, az);
    const dx = height(ax + 1, az) - height(ax - 1, az), dz = height(ax, az + 1) - height(ax, az - 1), il = 1 / Math.hypot(dx, 2, dz);
    pos[v * 3] = lx; pos[v * 3 + 1] = y; pos[v * 3 + 2] = lz;
    nor[v * 3] = -dx * il; nor[v * 3 + 1] = 2 * il; nor[v * 3 + 2] = -dz * il;
    const slope = 1 - 2 * il, t = vnoise(ax / 31, az / 31);
    _c.copy(cGrass).lerp(cDry, t).lerp(cRock, geom.smoothstep(0.12, 0.3, slope)).lerp(cSnow, geom.smoothstep(95, 115, y + 12 * t) * (1 - geom.smoothstep(0.2, 0.45, slope)));
    col[v * 3] = _c.r; col[v * 3 + 1] = _c.g; col[v * 3 + 2] = _c.b;
    locked[v] = i === 0 || j === 0 || i === SEG || j === SEG ? 1 : 0;
  }
  for (let j = 0, k = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.userData.locked = locked;
  const land = new THREE.Mesh(g, matLand);
  land.name = cell.name + ':land'; land.receiveShadow = true; land.castShadow = true;
  ctx.root.add(land);
  // rocks: one merged mesh per cell
  const batch = new geom.MeshBatch();
  for (let r = 0; r < 6; r++) {
    const u = h2(cell.ix * 7 + r, cell.iz * 13 + 5), v = h2(cell.ix * 3 + 9, cell.iz * 11 + r), lx = (u - 0.5) * (CELL - 30), lz = (v - 0.5) * (CELL - 30);
    if (Math.hypot(cell.x + lx, cell.z + lz) < TOWN + 40) continue;
    const s = 3 + 9 * h2(cell.ix + r * 31, cell.iz - r * 17);
    batch.add(rockGeo, matRock, geom.compose([lx, height(cell.x + lx, cell.z + lz) + s * 0.25, lz], [u * 3, v * 6, u * v * 4], [s * (0.8 + 0.6 * u), s * (0.6 + 0.3 * v), s]));
  }
  const rocks = batch.finish({ name: cell.name + ':rocks' });
  ctx.root.add(rocks);
}

// ---- the town: 13 x 13 blocks of houses behind a wall, merged per material (the classic single batch)
function buildTown() {
  const b = new geom.MeshBatch(), y0 = 20;
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
    const x = i * 20, z = j * 20;
    if (Math.hypot(x, z) > TOWN - 22 || i === 0 || j === 0) continue;         // two streets cross at the centre
    const w = 11 + 5 * h2(i, j), d = 11 + 5 * h2(j, i + 40), hh = 6 + 9 * h2(i * 5, j * 3);
    b.add(new THREE.BoxGeometry(w, hh, d, 6, 8, 6), matWall, geom.compose([x, y0 + hh / 2, z]));
    b.add(new THREE.ConeGeometry(Math.hypot(w, d) * 0.56, 4, 4, 3), matRoof, geom.compose([x, y0 + hh + 2, z], [0, Math.PI / 4, 0]));
    for (let k = 0; k < 20; k++) {                                            // sills and shutters: small parts, many triangles
      const side = k & 3, a = ((k >> 2) + 0.5) / 5 - 0.5, yy = y0 + 1.5 + ((k * 7) % 5) / 5 * (hh - 3);
      const px = side === 0 ? w / 2 : side === 1 ? -w / 2 : a * w, pz = side === 2 ? d / 2 : side === 3 ? -d / 2 : a * d;
      b.box(matRoof, side < 2 ? [0.25, 1.2, 0.9] : [0.9, 1.2, 0.25], [x + px, yy, z + pz], [0, 0, 0], 0.04);
    }
  }
  for (let k = 0; k < 72; k++) {                                              // the wall, with two gates on the x street
    const a = k / 72 * Math.PI * 2, x = Math.cos(a) * (TOWN - 6), z = Math.sin(a) * (TOWN - 6);
    if (Math.abs(z) < 8) continue;
    b.add(new THREE.BoxGeometry(1.6, 9, 13.2, 2, 6, 8), matWall, geom.compose([x, y0 + 4.5, z], [0, -a, 0]));
  }
  b.add(new THREE.CylinderGeometry(TOWN + 20, TOWN + 20, 0.6, 96, 1), matWall, geom.compose([0, y0 - 0.25, 0]));
  return b.finish({ name: 'town' });
}

// ---- trees: one source (trunk + two crowns), 30 000 places
function buildTree() {
  const g = new THREE.Group();
  const crown = (r, y, sx) => { const c = new THREE.IcosahedronGeometry(r, 3); const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + 0.18 * Math.sin(p.getX(i) * 4.1 + sx) * Math.cos(p.getZ(i) * 3.7) + 0.1 * Math.sin(p.getY(i) * 6.3); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 1.25 + y, p.getZ(i) * k); }
    c.computeVertexNormals(); return c; };
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 4.2, 10, 4).translate(0, 2.1, 0), matTrunk));
  const lg = geom.mergeGeometries([crown(2.1, 5.2, 0), crown(1.5, 7.3, 2)]);
  g.add(new THREE.Mesh(lg, matLeaf));
  g.name = 'tree';
  return g;
}
function treeMatrices(n) {
  const out = new Float32Array(n * 16), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let i = 0; k < n && i < n * 20; i++) {
    const x = (h2(i, 17) - 0.5) * (SIZE - 20), z = (h2(91, i) - 0.5) * (SIZE - 20), y = height(x, z);
    if (Math.hypot(x, z) < TOWN + 30 || y > 92 || vnoise(x / 260 + 5, z / 260) < 0.38) continue;   // not in town, not on snow, in woods
    const sc = 0.7 + 0.9 * h2(i, i * 3 + 1);
    m.compose(p.set(x, y - 0.2, z), q.setFromAxisAngle(up, h2(i * 5, 3) * 6.283), s.setScalar(sc)).toArray(out, k++ * 16);
  }
  return out.subarray(0, k * 16);
}

// ---- assemble
const count = (root) => { let t = 0, m = 0; root.traverse((o) => { if (o.isMesh) { const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); m++; } }); return { triangles: t, meshes: m }; };
let t = performance.now();
const town = buildTown();
scene.add(town);
timing.town = { ...count(town), buildMs: +(performance.now() - t).toFixed(1) };
if (on('chunk')) { t = performance.now(); const c = chunkObject(town, { maxSize: 45 }); timing.chunk = { chunks: c.chunks, split: c.split, ms: +(performance.now() - t).toFixed(1) }; }
const lod = on('lod') ? createAutoLod(world, { errorPx: 1.2, workers: 2 }) : null;
const occ = on('occ') ? createOcclusion(world) : null;
lod?.add(town); occ?.add(town);

t = performance.now();
const matrices = treeMatrices(TREES), tree = buildTree();
let trees = null, plainTrees = null;
if (on('inst')) {
  trees = createInstances(world, { source: tree, matrices, impostor: on('imp'), impostorPx: 70, cell: 48, maxDistance: 3200 });
  scene.add(trees.object);
} else {
  plainTrees = new THREE.Group();
  tree.traverse((o) => { if (!o.isMesh) return; const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length / 16); im.instanceMatrix.array.set(matrices); im.castShadow = im.receiveShadow = true; im.userData.collide = false; plainTrees.add(im); });
  scene.add(plainTrees);
}
timing.trees = { instances: matrices.length / 16, sourceTriangles: count(tree).triangles, ms: +(performance.now() - t).toFixed(1) };

const partOn = on('part');
let cellTriangles = 0;
const part = createPartition(world, { bounds: [-HALF, -HALF, HALF, HALF], size: CELL, build: buildCell, load: partOn ? LOAD : 1e9,
  proxy: partOn && on('hlod') ? { ratio: 0.04, material: matLand, lockBorder: true, workers: 2, colorOf: (m) => (m === matLand ? _c.set(0xffffff) : m.color) } : null,
  origin: on('origin') ? { threshold: 1024 } : null,
  onCell(cell, inScene, root) { if (inScene) { lod?.add(root); occ?.add(root); cell.tris ??= (cellTriangles += count(root).triangles, 1); } else { lod?.remove(root); occ?.remove(root); } },
  onProxy(cell, mesh) { occ?.add(mesh); },
  onRebase(shift) { town.position.sub(shift); town.updateMatrixWorld(true); (trees ? trees.object : plainTrees).position.sub(shift); occ?.shift(-shift.x, -shift.y, -shift.z); } });

// ---- the test path (absolute metres): along the town's street, out of the gate, over the hills and back
const WAY = [[-120, 0], [-40, 0], [40, 2], [150, 0], [330, 120], [700, 420], [1250, 900], [1500, 1400], [900, 1500], [200, 900], [-300, 500], [-420, 60], [-200, 0]];
const curve = new THREE.CatmullRomCurve3(WAY.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const _p = new THREE.Vector3(), _q = new THREE.Vector3();
function onPath(u) {
  curve.getPointAt(Math.min(1, Math.max(0, u)), _p); curve.getPointAt(Math.min(1, Math.max(0, u) + 0.004), _q);
  const eye = (x, z) => height(x, z) + 1.8 + 22 * geom.smoothstep(TOWN + 60, TOWN + 400, Math.hypot(x, z));
  camera.position.set(_p.x - part.offset.x, eye(_p.x, _p.z), _p.z - part.offset.z);
  camera.lookAt(_q.x - part.offset.x, eye(_q.x, _q.z) - 1.5, _q.z - part.offset.z);
  camera.updateMatrixWorld(true);
}
let u = +Q.get('t') || 0, auto = Q.has('auto'), T = 0;
onPath(u);
const shadow = { center: [0, 0, 0], radius: 140 };
const info = renderer.info;
info.autoReset = false;
const gl = renderer.getContext(), px = new Uint8Array(4);
function draw(opts) {
  part.update(camera);
  camera.position.toArray(shadow.center);
  info.reset();
  world.renderFrame(T, { shadow, ...opts });
}
// settle: streaming idle, LODs built, every HLOD proxy baked (`proxies`: a still taken while they bake depends on how
// far the bake got, so two runs of one page differed), then frames until no cross-fade runs and occlusion is steady
async function settle(frames = 12, proxies = true) {
  for (let i = 0; i < 20000; i++) { draw({ taa: true }); await new Promise((r) => requestAnimationFrame(r)); const s = Object.values(part.streamer.state()); if (!s.includes('loading') && !(lod && lod.stats.pending) && !(proxies && part.stats.proxyQueue)) break; }
  for (let i = 0; i < frames || (lod && lod.stats.fading && i < frames + 240); i++) { draw({ taa: true }); await new Promise((r) => requestAnimationFrame(r)); }
}
const api = {
  world, part, lod, occ, trees, timing, onPath, settle, height,
  stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, cellsIn: part.stats.in, proxies: part.stats.proxies, rebases: part.stats.rebases,
    lod: lod && { ...lod.stats }, occ: occ && { ...occ.stats }, trees: trees && { ...trees.stats, perLevel: [...trees.stats.perLevel] } }),
  // a still frame at path position u (settled; deterministic for a given set of switches)
  async still(at, spp = 4, proxies = true) { auto = false; hold = true; u = at; onPath(u); await settle(12, proxies); onPath(u); draw({ spp, frameIndex: 1 }); const s = api.stats(); hold = false; return s; },
  // `frames` moving frames from path position a to b: per frame the CPU time of the draw, the time until the GPU
  // has finished it (1-px readback), draw calls and triangles (the whole frame: shadow pass and post included)
  async run(frames = 300, a = 0, b = 1, speed = 0) {
    if (speed) frames = Math.max(2, Math.round(curve.getLength() * (b - a) / speed * 60));
    auto = false; hold = true;
    const cpu = [], full = [], calls = [], tris = [], interval = [];
    let last = 0;
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      if (last) interval.push(t0 - last); last = t0;
      onPath(a + (b - a) * i / (frames - 1)); T += 1 / 60;
      draw({ taa: true, dt: 1 / 60 });
      cpu.push(performance.now() - t0);
      if (api.eachFrame) api.eachFrame(i);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      full.push(performance.now() - t0); calls.push(info.render.calls); tris.push(info.render.triangles);
    }
    hold = false;
    const S = (x) => { const s = [...x].sort((p, q) => p - q), n = s.length; return { mean: +(s.reduce((p, q) => p + q, 0) / n).toFixed(2), p50: +s[n >> 1].toFixed(2), p95: +s[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2), max: +s[n - 1].toFixed(2) }; };
    return { frames, cpuMs: S(cpu), frameMs: S(full), intervalMs: S(interval), calls: S(calls), triangles: S(tris), end: api.stats() };
  },
  // popping check: move from a to b at `speed` m/s; every `every`-th frame the same view is drawn twice as a 1-sample
  // still, with what occlusion hides and with nothing hidden (occ.bypass), and the two compared pixel by pixel
  async pop(a = 0, b = 0.04, speed = 6, every = 5) {
    const frames = Math.max(2, Math.round(curve.getLength() * (b - a) / speed * 60));
    auto = false; hold = true;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const grab = (to) => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, to); };
    let compared = 0, worst = 0, worstAt = 0, sum = 0, hiddenMax = 0, hiddenSum = 0, noise = 0;
    const differ = () => { let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 || Math.abs(A[i + 2] - B[i + 2]) > 12) n++; return n; };
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      onPath(a + (b - a) * i / (frames - 1)); T += 1 / 60;
      draw({ taa: true, dt: 1 / 60 });
      if (!occ || i % every) continue;
      const hid = occ.stats.hidden;
      draw({ spp: 1, frameIndex: 1 }); grab(A);
      occ.bypass = true; draw({ spp: 1, frameIndex: 1 }); grab(B);
      const n = differ();
      draw({ spp: 1, frameIndex: 1 }); grab(A); occ.bypass = false;       // the same frame twice: the noise floor
      noise = Math.max(noise, differ());
      compared++; sum += n; hiddenSum += hid; hiddenMax = Math.max(hiddenMax, hid);
      if (n > worst) { worst = n; worstAt = a + (b - a) * i / (frames - 1); }
    }
    hold = false;
    return { frames, compared, worstPixels: worst, worstFraction: worst / (w * h), worstAt: +worstAt.toFixed(4), meanPixels: +(sum / Math.max(1, compared)).toFixed(2), noisePixels: noise, hiddenMean: +(hiddenSum / Math.max(1, compared)).toFixed(1), hiddenMax, cuts: occ ? occ.stats.cuts : 0 };
  },
};
let hold = false;

// ---- fly controls (the demo's own: the world is far too large for a baked walk grid)
const keys = new Set();
let yaw = 0, pitch = 0, drag = false, manual = false;
addEventListener('keydown', (e) => { keys.add(e.code); if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { if (!manual) { const d = camera.getWorldDirection(new THREE.Vector3()); yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(d.y); } manual = true; auto = false; } });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', () => { drag = true; });
addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => { if (drag && manual) { yaw -= e.movementX * 0.003; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003)); } });
let prev = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (hold) return;
  if (auto) { u = (u + dt / 90) % 1; onPath(u); }
  else if (manual) {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    const sp = (keys.has('ShiftLeft') ? 120 : 25) * dt, f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    camera.translateZ(-f * sp); camera.translateX(r * sp);
    camera.position.y = Math.max(camera.position.y, height(camera.position.x + part.offset.x, camera.position.z + part.offset.z) + 1.7);
    camera.updateMatrixWorld(true);
  }
  T += dt;
  draw({ taa: true, dt });
}

t = performance.now();
part.update(camera);
await world.prepare();
timing.prepareMs = +(performance.now() - t).toFixed(1);
await settle(4, false);   // ready to draw: the proxies go on baking
timing.cells = { count: part.stats.cells, in: part.stats.in, trianglesEach: Math.round(cellTriangles / Math.max(1, part.stats.in)) };
timing.sourceTriangles = timing.cells.trianglesEach * part.stats.cells + timing.town.triangles;
timing.readyMs = +(performance.now() - T0).toFixed(1);
window.__mirage = api;
window.__READY = true;
requestAnimationFrame(tick);

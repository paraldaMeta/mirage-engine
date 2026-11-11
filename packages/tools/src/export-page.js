// Mirage original code. The page half of mirage-export: bundled by export.mjs (with its own copy of three, the
// same version as the page's) and injected into an example after window.__READY. Exposes window.__mirageExport.
import * as THREE from 'three';
import { exportWorld } from '@miragekit/core/export';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';

const store = { progress: '' };
const mirage = () => window.__mirage;
const worldOf = () => (mirage().play ? mirage().play.world : mirage().world);

async function run(opts) {
  const { play } = mirage();
  const r = await exportWorld(worldOf(), { ...opts, exclude: [play && play.figure].filter(Boolean), onProgress: (t) => { store.progress = t; } });
  store.glb = r.glb; store.usdz = r.usdz;
  return { report: r.report, glbBytes: r.glb ? r.glb.byteLength : 0, usdzBytes: r.usdz ? r.usdz.byteLength : 0 };
}

/** a slice of an exported file as base64 (CDP strings stay small) */
function chunk(name, start, end) {
  const blob = new Blob([new Uint8Array(store[name], start, Math.min(end, store[name].byteLength) - start)]);
  return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = rej; f.readAsDataURL(blob); });
}

function count(root) {
  const s = { meshes: 0, instanced: 0, instances: 0, triangles: 0, materials: new Set(), textures: new Set() };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    s.meshes++;
    if (o.isInstancedMesh) { s.instanced++; s.instances += o.count; }
    s.triangles += n * (o.isInstancedMesh ? o.count : 1);
    for (const m of [].concat(o.material)) {
      s.materials.add(m.uuid);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (m[k]) s.textures.add(m[k].uuid);
    }
  });
  root.updateMatrixWorld(true);
  const boxes = {};
  root.traverse((o) => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o, true); boxes[(o.name || o.parent?.name || 'mesh').replace(/[^\w]/g, '')] = [...b.min.toArray(), ...b.max.toArray()].map((v) => +v.toFixed(2)); } });
  return { ...s, materials: s.materials.size, textures: s.textures.size, triangles: Math.round(s.triangles), boxes };
}

async function reload() {
  const gltf = await new GLTFLoader().parseAsync(store.glb.slice(0), '');
  store.gltf = gltf;
  return { glb: count(gltf.scene), extensionsUsed: gltf.parser.json.extensionsUsed || [] };
}

async function usdCheck() {
  if (!store.usdz) return null;
  try {
    const group = new USDLoader().parse(store.usdz.slice(0));
    // textures arrive asynchronously (blob URLs): wait for their images, a few seconds at most
    const maps = [];
    group.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) maps.push(m[k]); });
    for (let t = 0; t < 50 && maps.some((x) => !x.image || (x.image.complete === false)); t++) await new Promise((r) => setTimeout(r, 100));
    maps.forEach((x) => { x.needsUpdate = true; });
    store.usd = group;
    return { ok: true, ...count(group), texturesReady: maps.filter((x) => x.image && x.image.complete !== false).length };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function readPng(src) {
  return new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.src = src; });
}

/** the live world and the re-imported GLB from the plan's viewpoints, through the world's own renderer and post */
async function compare({ views = 'all', spp = 4 } = {}) {
  const { play, built } = mirage(), world = worldOf(), { scene, renderer } = world;
  const root = store.gltf.scene;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const keep = new Set([world.sky, world.stars, play.figure].filter(Boolean));
  const originals = scene.children.filter((c) => !keep.has(c) && !c.isLight && !c.isCamera && c.type !== 'Object3D' && c.name !== 'sky' && c.name !== 'stars');
  const skyish = scene.children.filter((c) => keep.has(c) || c.name === 'sky' || c.name === 'stars');
  scene.add(root);
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), normals = new THREE.MeshNormalMaterial();
  const usd = store.usd || null;
  if (usd) { usd.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(usd); }
  const show = (live) => { for (const c of originals) c.visible = live === true; root.visible = live === false; if (usd) usd.visible = live === 'usd'; };
  const vps = built.plan.viewpoints;
  const pick = views === 'all' ? vps.map((_, i) => i) : String(views).split(',').map(Number);
  const pass = (override) => {
    const vis = skyish.map((c) => c.visible);
    for (const c of skyish) c.visible = false;
    const bg = scene.background; scene.background = null; scene.overrideMaterial = override;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, world.camera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(null); scene.overrideMaterial = null; scene.background = bg;
    skyish.forEach((c, i) => { c.visible = vis[i]; });
    return px;
  };
  const shot = async (i, live) => {
    show(live);
    play.stop();
    play.viewpoint(i);
    for (let k = 0; k < 40; k++) play.step(1 / 30);
    play.render({ moving: false, spp, frameIndex: 1 });
    const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const png = renderer.domElement.toDataURL('image/png');
    return { png, mask: pass(white), nrm: pass(normals) };
  };
  const out = [];
  try {
    for (const i of pick) {
      const a = await shot(i, true), b = await shot(i, false), u = usd ? await shot(i, 'usd') : null;
      // coverage: geometry against background; normals: agreement where both have geometry
      let inter = 0, union = 0, both = 0, agree = 0;
      for (let p = 0; p < W * H * 4; p += 4) {
        const ca = a.mask[p] > 127, cb = b.mask[p] > 127;
        if (ca || cb) union++;
        if (ca && cb) {
          inter++; both++;
          const d = Math.abs(a.nrm[p] - b.nrm[p]) + Math.abs(a.nrm[p + 1] - b.nrm[p + 1]) + Math.abs(a.nrm[p + 2] - b.nrm[p + 2]);
          if (d < 24) agree++;
        }
      }
      const ia = await readPng(a.png), ib = await readPng(b.png);
      const c = document.createElement('canvas'); c.width = W * 3; c.height = (H + 28) * (u ? 2 : 1);
      const g = c.getContext('2d');
      g.fillStyle = '#16130f'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(ia, 0, 0); g.drawImage(ib, W, 0);
      const da = g.getImageData(0, 0, W, H).data, db = g.getImageData(W, 0, W, H).data, diff = g.createImageData(W, H);
      let sum = 0, close = 0;
      for (let p = 0; p < da.length; p += 4) {
        const d = (Math.abs(da[p] - db[p]) + Math.abs(da[p + 1] - db[p + 1]) + Math.abs(da[p + 2] - db[p + 2])) / 3;
        sum += d; if (d < 16) close++;
        const v = Math.min(255, d * 4);
        diff.data[p] = v; diff.data[p + 1] = v * 0.6; diff.data[p + 2] = v * 0.2; diff.data[p + 3] = 255;
      }
      g.putImageData(diff, W * 2, 0);
      g.fillStyle = '#f0e2c4'; g.font = '15px system-ui, sans-serif';
      const row = { name: vps[i].name, coverageIoU: +(inter / Math.max(union, 1)).toFixed(4), normalAgree: +(agree / Math.max(both, 1)).toFixed(4),
        meanAbsDiff: +(sum / (W * H)).toFixed(2), within16: +(close / (W * H)).toFixed(4) };
      g.fillText(`live world  ·  ${row.name}`, 8, H + 19);
      g.fillText(`re-imported GLB  ·  coverage IoU ${row.coverageIoU}  ·  normals agree ${(row.normalAgree * 100).toFixed(1)}%`, W + 8, H + 19);
      g.fillText(`|difference| x4  ·  mean ${row.meanAbsDiff} / 255  ·  ${(row.within16 * 100).toFixed(1)}% within 16`, 2 * W + 8, H + 19);
      if (u) {
        const iu = await readPng(u.png), y = H + 28;
        g.drawImage(ia, 0, y); g.drawImage(iu, W, y);
        const du = g.getImageData(W, y, W, H).data, d2 = g.createImageData(W, H);
        let su = 0;
        for (let p = 0; p < da.length; p += 4) {
          const d = (Math.abs(da[p] - du[p]) + Math.abs(da[p + 1] - du[p + 1]) + Math.abs(da[p + 2] - du[p + 2])) / 3;
          su += d; const v = Math.min(255, d * 4);
          d2.data[p] = v; d2.data[p + 1] = v * 0.6; d2.data[p + 2] = v * 0.2; d2.data[p + 3] = 255;
        }
        g.putImageData(d2, W * 2, y);
        row.usdMeanAbsDiff = +(su / (W * H)).toFixed(2);
        g.fillStyle = '#f0e2c4';
        g.fillText('live world', 8, y + H + 19);
        g.fillText('USDZ re-imported with three\'s USDLoader (not Quick Look)', W + 8, y + H + 19);
        g.fillText(`|difference| x4  ·  mean ${row.usdMeanAbsDiff} / 255`, 2 * W + 8, y + H + 19);
      }
      row.png = c.toDataURL('image/png');
      out.push(row);
    }
  } finally {
    show(true); scene.remove(root); if (usd) scene.remove(usd); rt.dispose();
  }
  return out;
}

window.__mirageExport = { run, chunk, reload, usdCheck, compare, progress: () => store.progress };

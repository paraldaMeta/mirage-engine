// Demo: the surface library (@miragekit/core SURFACES / createSurfaces). One surface at a time on four test objects
// (a sphere, a bevelled cube, a 2 m wall panel, a ground patch) under three lightings, dry or wet, seen from 5 m or
// from 0.5 m; procedural or baked.
// URL: ?s=kind[:variant]   ?light=studio | golden | night   ?wet=0 | 1   ?view=far | near | wall | ground
//      ?mode=baked | procedural   ?w=&h=   ?ui=0   ?spp=N
// window.__mirage: show({ s, light, wet, view, mode, opts }), still(), bench(...), and the library itself (the
// gallery shooter examples/demos/materials/shoot.mjs, the bench and packages/tools/src/surfaces-check.mjs drive it).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createWorldRenderer, placeDate, SURFACES, SURFACE_KINDS, createSurfaces, surfaceHooks, bakeSurface, setWetness, setRain } from '@miragekit/core';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const place = { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 };
const TIMES = { studio: placeDate('2026-04-20', '12:30', 0), golden: 'golden', night: placeDate('2026-04-20', '23:30', 0) };
const world = createWorldRenderer({ canvas, width: W, height: H, place, time: TIMES[Q.get('light') || 'studio'] || TIMES.studio, preserveDrawingBuffer: true,
  pixelRatio: 1, quality: 'high', shadow: { center: [0, 1, 0], radius: 4 }, envProbe: [0, 1.4, 2.5], fog: { groundDensity: 0.0005, height: 30 }, post: { grain: 0 } });
const { scene, camera, renderer } = world;
camera.fov = 50; camera.near = 0.05; camera.far = 500; camera.aspect = W / H; camera.updateProjectionMatrix();

// the stage: a neutral floor, a backdrop far behind
const neutral = world.mat.std({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18), roughness: 0.9 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), neutral); floor.receiveShadow = true;
scene.add(floor);
// night: a white lamp and a coloured one
const lampW = new THREE.PointLight(new THREE.Color().setRGB(1, 0.86, 0.72), 0, 0, 2); lampW.position.set(-1.6, 2.3, 1.6);
const lampC = new THREE.PointLight(new THREE.Color().setRGB(0.2, 0.6, 1.0), 0, 0, 2); lampC.position.set(1.7, 1.2, 1.3);
lampW.castShadow = true; lampW.shadow.mapSize.set(1024, 1024); lampW.shadow.bias = -0.0005;
scene.add(lampW, lampC);

const lib = createSurfaces(world, { mode: Q.get('mode') || 'baked' });
const group = new THREE.Group(); scene.add(group);
// geometry with the edges the wear reads: rounded box, a wall slab with rounded arrises
const GEO = {
  sphere: new THREE.SphereGeometry(0.3, 96, 48),
  cube: new RoundedBoxGeometry(0.6, 0.6, 0.6, 6, 0.025),
  wall: new RoundedBoxGeometry(2.0, 2.0, 0.12, 4, 0.012),
  ground: new THREE.PlaneGeometry(3.2, 2.4, 1, 1).rotateX(-Math.PI / 2),
  tube: new THREE.CylinderGeometry(0.012, 0.012, 1.4, 32, 1).rotateZ(Math.PI / 2),
};
const VIEWS = {
  far: { eye: [0.0, 1.55, 4.6], look: [0, 0.75, -0.3] },
  near: { eye: [1.12, 0.78, 0.82], look: [0.72, 0.52, 0.42] },
  wall: { eye: [-0.25, 1.25, -0.35], look: [-0.2, 1.15, -0.95] },
  ground: { eye: [-0.9, 0.42, 0.95], look: [-0.75, 0.0, 0.62] },
};
// grain for the directional kinds: along the wall, along x on the cube
const GRAIN = { wood: 'x', stainless: 'x', corrugated: 'y', bamboo: 'x', fabric: 'y', carbonFibre: 'x', aluminium: 'x', rubber: 'x', paper: 'x' };

let current = null, mats = [];
function clear() {
  for (const c of [...group.children]) group.remove(c);
  for (const m of mats) m.dispose();
  mats = [];
}
/** build one surface's test row. s: 'kind[:variant]', opts: extra spec options, wet 0..1, mode baked | procedural */
function show({ s = 'concrete', light, wet = 0, view = 'far', mode = Q.get('mode') || 'baked', opts = {}, matOpts = {} } = {}) {
  clear();
  const [kind, variant] = s.split(':');
  const K = SURFACE_KINDS[kind];
  if (!K) throw new Error('unknown surface ' + kind);
  const spec = SURFACES[kind]({ ...(variant ? { variant } : {}), ...opts });
  const grain = GRAIN[kind];
  const wetO = wet > 0 && !K.live && kind !== 'glass';
  const mk = (mapping, extra = {}) => { const m = lib.material(spec, { mapping, mode, wet: wetO, grain: mapping === 'wall' ? (grain === 'y' ? 'y' : undefined) : grain, ...matOpts, ...extra }); mats.push(m); return m; };
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; group.add(o); return o; };
  add(GEO.ground, mk('ground'), 0, 0.002, -0.1);
  add(GEO.wall, mk('wall'), 0, 1.0, -1.0);
  add(GEO.sphere, mk('tri'), -0.6, 0.3, 0.35);
  add(GEO.cube, mk('tri'), 0.55, 0.3, 0.15);
  if (['neon', 'fluorescent'].includes(kind)) add(GEO.tube, mk('tri'), 0, 1.2, -0.5);
  if (light && light !== current?.light) world.setTime(TIMES[light]);
  const L = light || current?.light || Q.get('light') || 'studio';
  const night = L === 'night';
  lampW.intensity = night ? 9 : 0; lampC.intensity = night ? 5 : 0;
  setWetness(wet); setRain(0);
  const v = VIEWS[view] || VIEWS.far;
  camera.position.fromArray(v.eye); camera.lookAt(...v.look); camera.updateMatrixWorld();
  current = { s, light: L, wet, view, mode, spec };
  return { kind, variant: spec.variant, refs: K.refs, stats: lib.stats() };
}
function still(spp = +Q.get('spp') || 8) {
  world.renderFrame(0, { spp, frameIndex: 1, shutter: 0 });
  return canvas.toDataURL('image/png');
}

// ---- the cost of a surface: a full-screen quad (a wall 1.5 m away filling the view) --------------------------------
// FRAMES draws back to back, then a one-pixel readback waits for the GPU: wall time / FRAMES. base = a plain
// MeshStandardMaterial on the same quad (the cost of the lighting itself); the surface's cost is the difference.
const benchScene = new THREE.Scene();
benchScene.add(new THREE.HemisphereLight(0xbfd4ff, 0x404040, 0.6));
const bsun = new THREE.DirectionalLight(0xffffff, 2.5); bsun.position.set(1, 2, 3); benchScene.add(bsun);
const benchCam = new THREE.PerspectiveCamera(50, 1440 / 900, 0.05, 50); benchCam.position.set(0, 0, 1.5);
const benchQuad = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), neutral); benchScene.add(benchQuad);
function bench({ s, mode, frames = 30, w = 1440, h = 900, wet = 0, opts = {} }) {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
  let m = neutral;
  if (s) { const [kind, variant] = s.split(':'); m = lib.material(SURFACES[kind]({ ...(variant ? { variant } : {}), ...opts }), { mapping: 'wall', mode, wet: wet > 0 }); }
  benchQuad.material = m;
  setWetness(wet);
  const draw = (n) => { renderer.setRenderTarget(rt); for (let i = 0; i < n; i++) renderer.render(benchScene, benchCam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); renderer.setRenderTarget(null); };
  draw(3);   // compile, warm
  const t0 = performance.now(); draw(frames); const ms = (performance.now() - t0) / frames;
  benchQuad.material = neutral; if (m !== neutral) m.dispose(); rt.dispose();
  return ms;
}

await world.prepare();
const first = Q.get('s') || 'concrete:cast';
show({ s: first, light: Q.get('light') || 'studio', wet: +(Q.get('wet') || 0), view: Q.get('view') || 'far' });
if (Q.get('ui') !== '0') {
  const bar = document.getElementById('bar');
  const items = Object.entries(SURFACE_KINDS).flatMap(([k, K]) => K.variants.map((v) => `${k}:${v}`));
  const sel = Object.assign(document.createElement('select'), { innerHTML: items.map((i) => `<option${i === first ? ' selected' : ''}>${i}</option>`).join('') });
  const pick = (name, list) => { const e = Object.assign(document.createElement('select'), { innerHTML: list.map((i) => `<option>${i}</option>`).join('') }); e.dataset.k = name; return e; };
  const lights = pick('light', ['studio', 'golden', 'night']), wets = pick('wet', ['0', '0.8']), views = pick('view', ['far', 'near', 'wall', 'ground']), modes = pick('mode', ['baked', 'procedural']);
  bar.append(sel, lights, wets, views, modes);
  const go = () => { show({ s: sel.value, light: lights.value, wet: +wets.value, view: views.value, mode: modes.value }); document.getElementById('info').textContent = `${sel.value}  ${JSON.stringify(SURFACE_KINDS[sel.value.split(':')[0]].refs)}`; still(); };
  for (const e of [sel, lights, wets, views, modes]) e.onchange = go;
  go();
} else still();
window.__mirage = { world, THREE, lib, show, still, bench, SURFACES, SURFACE_KINDS, surfaceHooks, bakeSurface, setWetness, setRain, GEO, VIEWS };
window.__READY = true;

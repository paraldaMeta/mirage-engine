// Experiment: today's hand-written walk (createRigModel's clips) next to a borrowed one (Quaternius' Universal
// Animation Library, CC0, retargeted onto the same rig and re-encoded by walk/bake-ual.mjs) on the same rig.
// URL: ?clip=walk|run|idle|... (borrowed name; the baseline plays its clip of that name, else idle)
//      ?game=1 (the borrowed walk / run played at the game's speeds, 1.5 / 4.2 m/s, by rate)
// window.__strip({ base, ual, view }) draws 8 frames of a cycle, baseline over borrowed, and returns a PNG data URL.
import * as THREE from 'three';
import { createRigModel, RIG } from '../../../packages/play/src/rig-model.js';
import { decodeClips, fromB64 } from './walk/clip-codec.js';
import { gaitMetrics } from './walk/gait-metrics.js';
import data from './walk/ual-clips.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas'), hud = document.querySelector('#hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2c2f);
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3530, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 6, 4); scene.add(sun);
// a floor with a 25 cm grid: a planted foot should not move against it
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 1 }));
scene.add(floor);
const grid = new THREE.GridHelper(200, 800, 0x888c90, 0x6a6e72); grid.position.y = 0.001; scene.add(grid);

const robot = { skin: 0x8f969e, shirt: 0x3d6f8f, trousers: 0x4a5059, boots: 0x22252a, hair: 0x5b6168 };
const make = () => { const r = createRigModel({ colors: robot }); scene.add(r.root); return r; };
const A = make(), B = make();
const rest = {}; A.root.traverse((o) => { if (o.isBone) rest[o.name] = o.position.toArray(); });
const ual = Object.fromEntries(decodeClips({ meta: data.meta, bytes: fromB64(data.b64) }, rest).map((c) => [c.name, c]));
const base = Object.fromEntries(A.clips.map((c) => [c.name, c]));
const speedOf = (c) => { const t = c?.tracks.find((x) => x.name === 'Root.position'); return t ? (t.values[t.values.length - 1] - t.values[2]) / c.duration : 0; };
const atRate = (c, rate) => { const k = c.clone(); k.duration = c.duration / rate; for (const t of k.tracks) t.times = t.times.map((x) => x / rate); return k; };
const GAME = { walk: RIG.walk, run: RIG.run };
const pick = (name) => {
  let u = ual[name] || ual.walk;
  if (Q.get('game') === '1' && GAME[name]) u = atRate(u, GAME[name] / speedOf(u));
  return { b: base[name] || base.idle, u };
};

// live: both walk forwards side by side; the camera rides along
const clipName = Q.get('clip') || 'walk', live = pick(clipName);
const mixA = new THREE.AnimationMixer(A.root), mixB = new THREE.AnimationMixer(B.root);
mixA.clipAction(live.b).play(); mixB.clipAction(live.u).play();
A.root.position.x = -0.6; B.root.position.x = 0.6;
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 200);
const mA = gaitMetrics(A.root, live.b), mB = gaitMetrics(B.root, live.u);
const line = (m) => `slide ${m.slideMean} cm/s mean (median ${m.slideMedian}, p95 ${m.slideP95})  knee ${m.kneeL.join('-')} deg  bob ${m.bobCm} cm  ground ${m.groundCm} cm`;
hud.textContent = `${clipName}${Q.get('game') === '1' ? ' at game speed' : ''}\nleft  today's clip   ${line(mA)}\nright borrowed      ${line(mB)}\n${data.b64.length} base64 chars for ${data.meta.length} clips`;
let last = performance.now();
const travelOf = (root) => root.getObjectByName('Root').position.z;
function frame(dt) {
  mixA.update(dt); mixB.update(dt);
  // the Root bone carries the travel and wraps each cycle: fold the cycles into the figure's own position
  for (const [r, mix, clip] of [[A, mixA, live.b], [B, mixB, live.u]]) { const loops = Math.floor(mix.time / clip.duration); r.root.position.z = loops * speedOf(clip) * clip.duration; }
  const z = (A.root.position.z + travelOf(A.root) + B.root.position.z + travelOf(B.root)) / 2;
  camera.position.set(4.2, 1.3, z + 1.2); camera.lookAt(0, 0.85, z);
  renderer.render(scene, camera);
}
if (Q.get('still') !== '1') renderer.setAnimationLoop(() => { const now = performance.now(); frame(Math.min(0.05, (now - last) / 1000)); last = now; });

/** 8 frames of one cycle, today's clip on the top row and the borrowed one below; view 'side' | 'three' */
window.__strip = ({ base: bn = 'walk', ual: un = bn, view = 'side', frames = 8, tile = [170, 300], game = false } = {}) => {
  renderer.setAnimationLoop(null);
  const [tw, th] = tile, cw = tw * frames, ch = th * 2;
  renderer.setSize(cw, ch, false);
  // orthographic, 2.1 m tall, centred on the hips: proportions and heights compare across tiles
  const hh = 1.05, hw = hh * tw / th, cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 50);
  if (view === 'side') cam.position.set(10, 0.95, 0); else cam.position.set(6, 0.95 + 3.2, 6);   // from the figure's left / front-left above
  cam.lookAt(0, 0.95, 0);
  const ub = base[bn] || base.idle;
  let uu = ual[un]; if (game && GAME[un]) uu = atRate(uu, GAME[un] / speedOf(uu));
  A.root.position.set(0, 0, 0); B.root.position.set(0, 0, 0);
  renderer.setScissorTest(true);
  for (const [row, rig, clip] of [[0, A, ub], [1, B, uu]]) {
    const other = rig === A ? B : A; other.root.visible = false; rig.root.visible = true;
    const mix = new THREE.AnimationMixer(rig.root); mix.clipAction(clip).play();
    for (let i = 0; i < frames; i++) {
      mix.setTime((i / frames) * clip.duration);
      rig.root.getObjectByName('Root').position.set(0, 0, 0);   // in place: the grid shows where the feet are
      const x = i * tw, y = (1 - row) * th;
      renderer.setViewport(x, y, tw, th); renderer.setScissor(x, y, tw, th);
      renderer.render(scene, cam);
    }
    mix.stopAllAction();
  }
  renderer.setScissorTest(false); A.root.visible = B.root.visible = true;
  const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
  const g = c2.getContext('2d'); g.drawImage(renderer.domElement, 0, 0);
  g.font = '15px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff';
  g.fillText(`today: ${bn} (${ub.duration.toFixed(2)} s)`, 8, 20); g.fillText(`borrowed: ${un}${game ? ' @ game speed' : ''} (${uu.duration.toFixed(2)} s)`, 8, th + 20);
  g.strokeStyle = '#000'; for (let i = 1; i < frames; i++) { g.beginPath(); g.moveTo(i * tw + 0.5, 0); g.lineTo(i * tw + 0.5, ch); g.stroke(); }
  g.beginPath(); g.moveTo(0, th + 0.5); g.lineTo(cw, th + 0.5); g.stroke();
  return c2.toDataURL('image/png');
};
window.__metrics = () => ({ clip: clipName, base: mA, ual: mB, bytes: data.b64.length });
window.__READY = true;

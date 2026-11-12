// Experiment: the staged truck and robot (truck.js, robot.js) on a neutral stage, pass by pass, from four angles,
// next to what the example has today: the "Slab" pickup from examples/neon-district/modules/cars.js (imported
// read-only, with neutral stand-in materials) and the sentinel's body (createRigModel in the grunt colours; its
// plates, visor and rifle are added in enemies.js and are not here: see the in-game shots for those).
// URL: ?set=truck|robot|compare|walk (default all)  -> window.__shoot() returns { images: { name: dataURL }, stats }
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTruck, stats } from './truck.js';
import { createRobot, standPose } from './robot.js';
import { createRigModel } from '../../../packages/play/src/rig-model.js';
import * as geom from '../../../packages/core/src/geom.js';
// the cars now live in the cyber kit (@miragekit/assets, BUSL-1.1); rebuilt on the surface library, they need the
// engine's createSurfaces and a renderer, which this shim page does not give them (the comparison is of the old cars)
import { parkedCars } from '../../../packages/assets/src/kits/cyber/cars.js';
import { decodeClips, fromB64 } from './walk/clip-codec.js';
import ual from './walk/ual-clips.js';

const Q = new URLSearchParams(location.search), SET = Q.get('set');
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8d9298);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-4, 9, -6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 }); sun.shadow.bias = -0.0004;
scene.add(sun, new THREE.HemisphereLight(0xe8eef5, 0x55504a, 0.6));
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7c7f83, roughness: 0.95 }));
floor.receiveShadow = true; scene.add(floor);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
function shot(obj, views, [w, h], label) {
  scene.add(obj); obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
  const cols = 2, rows = Math.ceil(views.length / cols), sheet = document.createElement('canvas');
  sheet.width = w * cols; sheet.height = h * rows;
  const g = sheet.getContext('2d');
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  views.forEach(([name, eye, look], i) => {
    camera.position.set(...eye); camera.lookAt(...(look || c.toArray())); renderer.render(scene, camera);
    g.drawImage(renderer.domElement, (i % cols) * w, Math.floor(i / cols) * h);
    g.font = '16px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff'; g.fillText(`${label} · ${name}`, (i % cols) * w + 10, Math.floor(i / cols) * h + 22);
  });
  scene.remove(obj);
  return sheet.toDataURL('image/png');
}
const TRUCK_VIEWS = [
  ['rear 3/4 left (reference)', [-4.3, 1.25, -7.4], [0, 0.85, 0]], ['front 3/4 left', [6.4, 1.7, -6.0], [0, 0.85, 0]],
  ['left side', [0, 1.0, -10.5], [0, 0.85, 0]], ['rear', [-10.5, 1.3, 0], [0, 0.9, 0]],
];
const ROBOT_VIEWS = [
  ['front 3/4 (reference)', [1.3, 1.25, 3.9], [0, 0.9, 0]], ['front', [0, 1.0, 4.3], [0, 0.9, 0]],
  ['left side', [4.3, 1.0, 0], [0, 0.9, 0]], ['back 3/4', [-2.6, 1.4, -3.4], [0, 0.9, 0]],
];

// ---- today's truck: cars.js's builder with stand-in materials (the batch API it expects, nothing else)
function currentTruck() {
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xc4c6c8, metalness: 1, roughness: 0.34, vertexColors: true, name: 'stainless' });
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.5, roughness: 0.3, clearcoat: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0c0f, roughness: 0.04, clearcoat: 1, name: 'glass' });
  const mats = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, name: 'paint' }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9, name: 'metal' }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, name: 'glow' }),
  };
  // the atlas is not here: the tyre's rubber and lettering come from it in the game, so tint it dark instead
  const put = (batch, geo, m, matrix = null, color = [1, 1, 1], rect = null) => {
    if (rect === 'tyre') color = [0.05, 0.05, 0.05];
    const g = geo.index ? geo.toNonIndexed() : geo.clone(), n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(color.map((v) => Math.min(v, m === mats.glow ? 4 : 1)), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); batch.add(g, m, matrix); return g;
  };
  const root = new THREE.Group(), ctx = { geom, root, world: {}, shared: { carMats: { steel, pearl, glass }, quality: 'high' } };
  const pb = new geom.MeshBatch();
  parkedCars(ctx, { mats, put, R: new Proxy({}, { get: (_, k) => k }) }, pb, [[0, 0, 0]], () => {});
  root.add(pb.finish({ name: 'props' }));
  root.traverse((o) => { if (o.isLight) o.visible = false; if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return root;
}
// today's sentinel body: the rig in the grunt colours (enemies.js adds plates, a visor and a rifle on its bones)
function currentSentinel() {
  const rig = createRigModel({ colors: { skin: 0x14171b, shirt: 0x1b2026, trousers: 0x181c21, boots: 0x0c0d0f, hair: 0x14171b } });
  rig.mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.45 });
  const mix = new THREE.AnimationMixer(rig.root); mix.clipAction(rig.clips.find((c) => c.name === 'idle')).play(); mix.setTime(0);
  return rig.root;
}
function pose(robot, clip, t) { const mix = new THREE.AnimationMixer(robot); mix.clipAction(clip).play(); mix.setTime(t); return mix; }

window.__shoot = async () => {
  const images = {}, st = {};
  if (!SET || SET === 'truck') for (let p = 1; p <= 5; p++) { const t = createTruck({ pass: p, lights: p >= 4 ? 0.6 : 0 }); st['truck-p' + p] = stats(t); images['truck-p' + p] = shot(t, TRUCK_VIEWS, [800, 450], `truck pass ${p}`); }
  if (!SET || SET === 'robot') for (let p = 1; p <= 5; p++) { const r = standPose(createRobot({ pass: p })); st['robot-p' + p] = stats(r); images['robot-p' + p] = shot(r, ROBOT_VIEWS, [420, 560], `robot pass ${p}`); }
  if (!SET || SET === 'compare') {
    const cur = currentTruck(), mine = createTruck({ pass: 5, lights: 0.6 });
    st.currentTruck = stats(cur); st.truck = stats(mine);
    st.currentTruckSize = new THREE.Box3().setFromObject(cur).getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2));
    st.truckSize = new THREE.Box3().setFromObject(mine).getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2));
    images['compare-truck-current'] = shot(cur, TRUCK_VIEWS, [800, 450], 'today: cars.js Slab');
    images['compare-truck-staged'] = shot(mine, TRUCK_VIEWS, [800, 450], 'staged: truck.js');
    const sen = currentSentinel(), rob = standPose(createRobot({ pass: 5 }));
    st.currentSentinelBody = stats(sen); st.robot = stats(rob);
    images['compare-robot-current'] = shot(sen, ROBOT_VIEWS, [420, 560], 'today: sentinel body (rig)');
    images['compare-robot-staged'] = shot(rob, ROBOT_VIEWS, [420, 560], 'staged: robot.js');
  }
  if (!SET || SET === 'walk') {
    // the borrowed walk (Experiment 1) on the staged robot, no retargeting: the joints are the rig's
    const rob = createRobot({ pass: 5 }), rest = {};
    createRigModel().root.traverse((o) => { if (o.isBone) rest[o.name] = o.position.toArray(); });
    const clips = Object.fromEntries(decodeClips({ meta: ual.meta, bytes: fromB64(ual.b64) }, rest).map((c) => [c.name, c]));
    const frames = 8, w = 220, h = 360, sheet = document.createElement('canvas'); sheet.width = w * frames; sheet.height = h * 2;
    const g = sheet.getContext('2d'); renderer.setSize(w, h, false);
    const cam = new THREE.OrthographicCamera(-0.65, 0.65, 1.06, -1.06, 0.1, 50);
    scene.add(rob);
    for (const [row, name] of [[0, 'walk'], [1, 'run']]) {
      const clip = clips[name];
      for (let i = 0; i < frames; i++) {
        const mix = pose(rob, clip, (i / frames) * clip.duration); rob.getObjectByName('Root').position.set(0, 0, 0); rob.updateMatrixWorld(true);
        cam.position.set(row ? 6 : 10, 0.95 + (row ? 3.2 : 0), row ? 6 : 0); cam.lookAt(0, 0.95, 0); cam.updateProjectionMatrix();
        renderer.render(scene, cam); g.drawImage(renderer.domElement, i * w, row * h); mix.stopAllAction();
      }
      g.font = '15px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff'; g.fillText(`borrowed ${name} on robot.js (${row ? 'three-quarter' : 'side'})`, 8, row * h + 20);
    }
    scene.remove(rob);
    images['robot-walk'] = sheet.toDataURL('image/png');
  }
  return { images, stats: st };
};
window.__READY = true;

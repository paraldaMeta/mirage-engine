// A host program (a game) with its own renderer, camera and objects mounts the courtyard with @mirage/play's
// mountWorld: its objects go into the world's `root` (lit, shadowed and hazed with the world), its own
// characters walk on the world's baked walk grid, and it renders with its own camera.
import * as THREE from 'three';
import { createTextures } from '@mirage/core';
import { mountWorld } from '@mirage/play';
import manifest from './tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
// ---- the host's own three.js setup
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 3000);
const urls = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });
const mw = await mountWorld({
  renderer, plan, modules: modules(),
  world: { place: { lat: 35.01, lon: 135.77, height: 50, tzHours: 9 }, time: 'golden', shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0], fog: { groundDensity: 0.0022, height: 30 } },
  shared: (world) => ({ tex: createTextures(world, { manifest, url: (f) => urls['./tex/' + f] }) }),
});
// ---- host objects: a spinning knot on the basin's spout, and a "character" (a ball) walking the courtyard
const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.28, 0.08, 128, 16), new THREE.MeshStandardMaterial({ color: 0x2a6cf0, metalness: 0.3, roughness: 0.35 }));
knot.position.set(0, 1.6, 0); knot.castShadow = true;
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe03a20, roughness: 0.5 }));
ball.castShadow = true;
mw.root.add(knot, ball);
const walker = mw.walker([4, 0, 4]);
let t = 0, last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now; t += dt;
  knot.rotation.set(t * 0.7, t, 0);
  // the host's character: aims at points on a circle, the walk grid stops it at the basin rim and the walls
  const a = t * 0.35, gx = Math.cos(a) * 5.5, gz = Math.sin(a) * 5.5, dx = gx - walker.pos[0], dz = gz - walker.pos[2], d = Math.hypot(dx, dz) || 1;
  walker.update(dt, { x: dx / d, z: dz / d });
  ball.position.set(walker.pos[0], walker.pos[1] + 0.3, walker.pos[2]);
  camera.position.set(Math.cos(t * 0.1 + 0.8) * 10, 8.5, Math.sin(t * 0.1 + 0.8) * 10); camera.lookAt(0, 0.8, 0);
  mw.update(dt);
  mw.render(camera);                               // one TAA sub-frame of the world + host objects
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__embed = { mw, camera, walker, ball };
window.__READY = true;

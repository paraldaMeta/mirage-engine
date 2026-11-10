// Demo: the effect system (@mirage/core createVfx) in a small yard. Pick an effect, watch the counters, change its
// numbers in the panel and take the JSON away.
// URL: ?fx=fire | smoke | sparks | dust | splash | snow | leaves | fireflies | magic | explosion | lightning | all
//      ?time=dusk | golden | HH:MM   ?mode=orbit | walk   ?w=&h=  ?ui=0  ?spp=N  ?panel=0
//      ?fx=none (an empty yard with the system on: vfx-check.mjs and vfx-bench.mjs drive it)  ?dpr=1|2  ?max=N (the global cap)
//      ?vfx=0 (the yard with no effect system at all)
import * as THREE from 'three';
import { createWorldRenderer, placeDate, createVfx, defineEffect, VFX_LIBRARY } from '@mirage/core';
import { buildWorld, definePlan } from '@mirage/world';
import { createPlay } from '@mirage/play';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const place = { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 };
const t = Q.get('time') || 'dusk';
const world = createWorldRenderer({ canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate('2026-06-21', t === 'dusk' ? '20:05' : t, 0), preserveDrawingBuffer: true,
  pixelRatio: +Q.get('dpr') || undefined, quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 16 }, envProbe: [0, 1.6, 6], fog: { groundDensity: 0.004, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });

const plan = definePlan({
  name: 'vfx', seed: 'vfx', bounds: [-20, -20, 20, 20], walk: { yMin: -1, yMax: 3 },
  spawn: { eye: [0, 1.62, 9], look: [0, 1.1, 0], mode: 'walk' },
  viewpoints: [{ name: 'hero', eye: [4.5, 2.4, 8], look: [0, 1.2, 0] }, { name: 'low', eye: [2.5, 0.8, 5], look: [0, 0.9, 0] }, { name: 'wide', eye: [0, 5, 16], look: [0, 1.5, 0] }],
});
const modules = [{
  name: 'yard',
  build(ctx) {
    const std = (c, r = 0.9) => ctx.mat.std({ color: c, roughness: r });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), std(0x57523f, 0.95)); ground.receiveShadow = true; ground.name = 'ground';
    const box = (x, y, z, w, h, d, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(c)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 48, 24), std(0xa8a090, 0.8)); ball.position.set(2.6, 0.6, 1.2); ball.castShadow = ball.receiveShadow = true;
    // a wall behind, a step, a post and a ball: things for particles to be shadowed by, fade against and bounce off
    ctx.root.add(ground, box(0, 1.5, -4, 12, 3, 0.4, 0x8a7f70), box(-3, 0.25, 1, 2, 0.5, 2, 0x6f675a), box(-4.5, 1.2, -1.5, 0.3, 2.4, 0.3, 0x5a4630), ball);
  },
}];
const built = await buildWorld(world, { plan, modules, shared: {} });
const { camera } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();

const on = Q.get('vfx') !== '0';
const vfx = on ? createVfx(world, { maxParticles: +Q.get('max') || 2000000 }) : null;
const lib = JSON.parse(JSON.stringify(VFX_LIBRARY));           // the panel edits a copy
let current = Q.get('fx') || 'fire', handles = [], nextShot = 0, shots = 0;
const ONE_SHOT = ['sparks', 'dust', 'splash', 'magic', 'explosion'], NAMES = [...Object.keys(lib), 'lightning', 'all'];
const SPOT = { fire: [0, 0, 0], smoke: [0, 0, 0], sparks: [0, 1.4, 0], dust: [0, 0, 0.5], splash: [0, 0, 0.5], snow: [0, 0, 0], leaves: [0, 0, 0], fireflies: [0, 0, 0], magic: [0, 0, 0.5], explosion: [0, 0, 0] };
if (vfx) vfx.setGround({ min: [-40, -40], size: [80, 80], res: [8, 8], heightAt: () => 0 });

function strike(T) {
  // lightning: a bolt from the sky to a point on the ground, a scorch where it lands, and sparks
  const r = (k) => { const x = Math.sin((shots + 1) * 12.9898 * k) * 43758.5453; return x - Math.floor(x); };
  const at = [r(1) * 6 - 3, 0, r(2) * 4 - 1];
  vfx.beam({ from: [at[0] + r(3) * 4 - 2, 14, at[2] - 2], to: at, width: 0.14, jitter: 1.1, branches: 3, life: 0.35, intensity: 9, seed: shots + 1 });
  vfx.decal({ position: at, size: 1.6, depth: 1.4, pattern: 'scorch', life: 12, fade: 3, seed: shots + 1 });   // deep enough to mark the step's top too
  vfx.decal({ position: at, size: 0.9, depth: 1.4, pattern: 'soft', blend: 'add', color: '#ff7a2a', intensity: 3, life: 1.2, fade: 1.2 });
  vfx.burst(lib.sparks, [at[0], 0.1, at[2]]);
}
function start(name) {
  for (const h of handles) h.stop();
  handles = []; current = name; nextShot = -1;
  if (!vfx) return;
  const names = name === 'all' ? Object.keys(lib) : [name];
  names.forEach((n, i) => {
    if (!lib[n] || ONE_SHOT.includes(n)) return;
    const p = name === 'all' ? [(i % 5) * 4 - 8, 0, i < 5 ? 0 : 4] : SPOT[n];
    handles.push(vfx.spawn(lib[n], { position: p }));
  });
}
function tick(T) {
  if (!vfx || T < nextShot) return;
  if (nextShot < 0) { nextShot = T + 0.2; return; }
  nextShot = T + (current === 'lightning' ? 1.6 : 2.6); shots++;
  if (current === 'lightning') strike(T);
  else if (current === 'all') Object.keys(lib).forEach((n, i) => { if (ONE_SHOT.includes(n)) vfx.burst(lib[n], [(i % 5) * 4 - 8, n === 'sparks' ? 1.4 : 0, i < 5 ? 0 : 4]); });
  else if (ONE_SHOT.includes(current)) vfx.burst(lib[current], SPOT[current]);
}
if (vfx) world.ctx.onUpdate((tk) => tick(tk));

await world.prepare();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'orbit';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), hud: false, animate: true, onStep: () => !!vfx });
if (mode === 'orbit') { const v = plan.viewpoints[0]; play.place(v.eye, v.look, 'orbit'); }

// --- the selector, the counters and the parameter panel ---------------------------------------------------------------
const $ = (id) => document.getElementById(id), ui = Q.get('ui') !== '0' && Q.get('panel') !== '0' && !!vfx;
if (!ui) for (const id of ['bar', 'stats', 'panel']) $(id).style.display = 'none';
// the numbers worth a slider, as paths into the selected effect's first emitter: [label, path, min, max, step]
const KNOBS = [['rate', ['rate'], 0, 2000, 1], ['life max', ['life', 1], 0.1, 12, 0.1], ['speed max', ['velocity', 'speed', 1], 0, 15, 0.1], ['spread', ['velocity', 'spread'], 0, 180, 1],
  ['gravity', ['gravity'], -12, 4, 0.1], ['drag', ['drag'], 0, 5, 0.05], ['turbulence', ['turbulence', 'strength'], 0, 4, 0.05], ['wind', ['wind'], 0, 3, 0.05], ['size max', ['size', 1], 0.01, 3, 0.01]];
const first = (name) => (lib[name].emitters ? lib[name].emitters[lib[name].emitters.length > 1 ? 1 : 0] : lib[name]);
const peek = (o, p) => p.reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
function poke(o, p, v) {
  for (let i = 0; i < p.length - 1; i++) { if (typeof o[p[i]] !== 'object' || o[p[i]] === null) o[p[i]] = typeof p[i + 1] === 'number' ? [o[p[i]] ?? 0, o[p[i]] ?? 0] : {}; o = o[p[i]]; }
  o[p[p.length - 1]] = v;
  if (Array.isArray(o) && o[0] > o[1]) o[0] = o[1];
}
function panel(name) {
  if (!ui) return;
  const real = lib[name] ? name : 'sparks';
  $('title').textContent = real + (lib[real].emitters ? ` · emitter "${first(real).name}"` : '');
  $('sliders').innerHTML = ''; $('err').textContent = '';
  for (const [label, path, lo, hi, step] of KNOBS) {
    const v = peek(first(real), path); if (typeof v !== 'number') continue;
    const row = document.createElement('label'), r = Object.assign(document.createElement('input'), { type: 'range', min: lo, max: hi, step, value: v }), out = document.createElement('span');
    out.textContent = v; row.append(label, r, out); $('sliders').append(row);
    r.oninput = () => { out.textContent = r.value; const old = lib[real]; lib[real] = JSON.parse(JSON.stringify(old)); poke(first(real), path, +r.value); vfx.release(old); $('json').value = JSON.stringify(lib[real], null, 1); start(current); };
  }
  $('json').value = JSON.stringify(lib[real], null, 1);
  $('apply').onclick = () => {
    try { const next = JSON.parse($('json').value); vfx.define(next); vfx.release(lib[real]); lib[real] = next; $('err').textContent = ''; start(current); panel(current); } catch (e) { $('err').textContent = String(e.message || e); }
  };
  $('copy').onclick = () => console.log(JSON.stringify(lib[real]));
}
for (const n of NAMES) {
  const b = Object.assign(document.createElement('button'), { textContent: n });
  b.onclick = () => { start(n); panel(n); for (const x of $('bar').children) x.classList.toggle('on', x === b); };
  if (n === current) b.classList.add('on');
  $('bar').append(b);
}
start(current); panel(current);
let frames = 0, last = performance.now(), fps = 0;
(function hud() {
  requestAnimationFrame(hud); frames++;
  const now = performance.now();
  if (now - last < 500) return;
  fps = frames * 1000 / (now - last); frames = 0; last = now;
  if (!ui) return;
  const s = vfx.stats;
  $('stats').textContent = `${fps.toFixed(0)} fps   particles ${s.particles} of ${s.capacity} slots   pools ${s.pools}   instances ${s.instances}\nspawned ${s.spawned}   dropped ${s.dropped}   budget ${s.budget.toFixed(2)}   update ${s.simMs.toFixed(2)} ms (CPU side)   depth copy ${vfx.depth.valid ? 'on' : 'off'}`;
})();
window.__mirage = { world, built, play, vfx, lib, THREE, start, VFX_LIBRARY, createVfx, defineEffect, get fps() { return fps; }, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;

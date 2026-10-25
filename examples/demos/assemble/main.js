// Demo: "the world assembles itself". examples/walled-garden's six modules (plus its deliberately broken one) are
// built by @mirage/world as usual; then each module's objects rise out of the ground in build order while the
// loader's own report scrolls by: triangles, build time, anchors, and the broken module skipped without taking
// the world down. The camera circles the garden. One file (code + the courtyard's five CC0 texture sets).
// URL: ?step=1.6 (seconds per module)  ?w=&h=
import { createWorldRenderer, createTextures } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import manifest from '../../hello-courtyard/tex/manifest.json';
import plan from '../../walled-garden/plan.js';
import modules from '../../walled-garden/modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, STEP = +Q.get('step') || 1.6;
const canvas = document.querySelector('canvas'), log = document.querySelector('#log'), hud = document.querySelector('#hud');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({ canvas, width: W, height: H, preserveDrawingBuffer: true, place: { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 },
  time: 'golden', shadow: { center: [0, 2, 0], radius: 48 }, envProbe: [0, 4, 6], fog: { groundDensity: 0.0018, height: 40 }, post: { grain: 0.01 } });
const urls = import.meta.glob('../../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../../hello-courtyard/tex/' + f] });

// note what each module adds to the scene (the protocol: modules build into ctx.root)
const parts = {};
const watch = (name, fn) => (ctx, ...a) => { const n = ctx.root.children.length, r = fn(ctx, ...a); (parts[name] ||= []).push(...ctx.root.children.slice(n)); return r; };
const watched = modules({ broken: true }).map((m) => ({ ...m, build: watch(m.name, m.build), ...(m.finalize ? { finalize: watch(m.name, m.finalize) } : {}) }));
const built = await buildWorld(world, { plan, modules: watched, shared: { tex } });
const { camera } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();                                   // captures the light with everything standing
for (const list of Object.values(parts)) for (const o of list) o.visible = false;

const rep = built.report, line = (cls, s) => { log.innerHTML += `<span class="${cls}">${s}</span>\n`; };
const order = [...rep.modules.map((m) => m.name), ...rep.failed.map((f) => f.name)];
const queue = watched.map((m) => m.name).filter((n) => order.includes(n));
line('dim', `buildWorld(plan '${plan.name}', ${queue.length} modules)`);
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
let last = performance.now(), T = 0, shown = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now; T += dt;
  const k = Math.floor((T + STEP - 0.4) / STEP);            // the first module at 0.4 s
  while (shown <= k && shown < queue.length) {
    const name = queue[shown++], f = rep.failed.find((x) => x.name === name), m = !f && rep.modules.find((x) => x.name === name);
    if (m) {
      const anchors = Object.entries(m.anchors || {}).map(([a, c]) => `${a} ${c}`).join(', ');
      line('ok', `✓ ${name.padEnd(11)} ${(m.tris / 1000).toFixed(1).padStart(6)} k tris  ${String(m.ms).padStart(4)} ms${anchors ? '  anchors: ' + anchors : ''}`);
      for (const o of parts[name] || []) { o.visible = true; o.userData.rise = T; }
    } else line('bad', `✗ ${name.padEnd(11)} threw in ${f.phase}: ${String(f.error).slice(0, 60)} — skipped, the world goes on`);
    if (shown === queue.length) line('dim', `world ready: ${rep.modules.length - rep.failed.length} built, ${rep.failed.length} failed, ${(rep.modules.reduce((s, x) => s + x.tris, 0) / 1e6).toFixed(2)} M triangles, ${rep.ms} ms`);
  }
  for (const list of Object.values(parts)) for (const o of list) if (o.visible) o.scale.y = 0.001 + 0.999 * ease((T - o.userData.rise) / 1.1);
  if (T > STEP * (queue.length + 6)) { T = 0; shown = 0; log.innerHTML = ''; for (const list of Object.values(parts)) for (const o of list) o.visible = false; line('dim', `buildWorld(plan '${plan.name}', ${queue.length} modules)`); }
  const a = 0.6 + T * 0.05, r = 62;
  camera.position.set(Math.sin(a) * r, 30, 6 + Math.cos(a) * r); camera.lookAt(0, 1, 4); camera.updateMatrixWorld();
  world.renderFrame(T, { taa: true });
  hud.innerHTML = '<b>Mirage</b>\na world assembling itself, module by module';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__mirage = { world, built };
window.__READY = true;

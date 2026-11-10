#!/usr/bin/env node
// Mount and dispose a world with play five times in one page (an app that opens and closes a world): after each
// dispose the page must hold no more window / document listeners, DOM nodes, geometries, textures or shader
// programs than after the first one, and no play keeps reacting to keys.
// Needs Chrome with a GPU, so it is not in npm test:   node packages/tools/dispose-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { launch, serve, open } from './src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'out/dispose-check/src'), dist = path.join(here, 'out/dispose-check/dist');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><body style="margin:0"><canvas width="320" height="240"></canvas><script type="module" src="./main.js"></script>\n');
fs.writeFileSync(path.join(src, 'main.js'), `
import * as THREE from 'three';
import { createWorldRenderer, createVfx } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import { startGame } from '@mirage/game';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas });
const plan = { name: 'box', bounds: [-6, -6, 6, 6], spawn: { eye: [0, 1.62, 3], look: [0, 1.6, 0] }, viewpoints: [{ name: 'a', eye: [3, 2, 3], look: [0, 1, 0] }] };
const modules = [{ name: 'room', build(ctx) {
  const m = ctx.mat.std({ roughness: 0.9 });
  ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12).translate(0, -0.1, 0), m));
  ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).translate(0, 1, -2), m));
} }];
window.mountOnce = async () => {
  const world = createWorldRenderer({ renderer, width: 320, height: 240, quality: 'low' });
  const built = await buildWorld(world, { plan, modules, log: { log() {}, error: console.error } });
  await world.prepare();
  const play = createPlay(world, { plan: built.plan, canvas, hud: true, ui: true });
  await new Promise((r) => setTimeout(r, 300));
  const before = play.state().pos.join();
  if (play.dispose) play.dispose(); else play.stop();   // (before 1.0 there was only stop)
  world.dispose();
  return before;
};
// the same with the game layer: physics, input, audio, the overlay and play
window.mountGame = async () => {
  const world = createWorldRenderer({ renderer, width: 320, height: 240, quality: 'low' });
  const built = await buildWorld(world, { plan, modules, log: { log() {}, error: console.error } });
  const g = await startGame(world, { built, canvas, id: 'dispose-check', hud: true });
  g.ui.begin(); g.audio.unlock();
  await new Promise((r) => setTimeout(r, 300));
  if (g.dispose) await g.dispose(); else g.play.stop();
  world.dispose();
};
// embedding: the host's camera lens comes back on dispose, and keys typed into the host's text field do not walk
window.embed = async () => {
  const world = createWorldRenderer({ renderer, width: 320, height: 240, quality: 'low' });
  const built = await buildWorld(world, { plan, modules, log: { log() {}, error: console.error } });
  await world.prepare();
  const lens = [world.camera.fov, world.camera.near, world.camera.far].join();
  const play = createPlay(world, { plan: built.plan, canvas, hud: false, ui: false, mode: 'walk' });
  const field = document.createElement('input'); document.body.appendChild(field); field.focus();
  const start = play.state().pos.join();
  for (let i = 0; i < 30; i++) { field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); play.step(1 / 60); }
  field.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  const typed = play.state().pos.join();
  play.dispose(); field.remove();
  const after = [world.camera.fov, world.camera.near, world.camera.far].join();
  world.dispose();
  return { lens, after, start, typed };
};
// update callbacks: ctx.onUpdate returns an unsubscribe function, a callback may unsubscribe during the frame, a
// disposed vfx system and a disposed world keep none
window.subs = async () => {
  const world = createWorldRenderer({ renderer, width: 320, height: 240, quality: 'low' });
  await buildWorld(world, { plan, modules, log: { log() {}, error: console.error } });
  await world.prepare();
  const n = { a: 0, self: 0, c: 0, vfx: 0 };
  const offA = world.ctx.onUpdate(() => n.a++);
  const offSelf = world.ctx.onUpdate(() => { n.self++; offSelf(); });
  world.ctx.onUpdate(() => n.c++);
  const vfx = createVfx(world);   // hooks the world's clock, and lets go of it in dispose()
  world.renderFrame(0); world.renderFrame(0.1);
  const mid = { ...n, type: typeof offA };
  offA(); offA();
  vfx.dispose();
  let threw = null;
  try { world.renderFrame(0.2); world.renderDirect(0.3); } catch (e) { threw = String(e); }
  const after = { ...n };
  world.dispose();
  const disposedCalls = n.c;
  try { world.ctx.onUpdate(() => n.c++)(); } catch (e) { threw = String(e); }
  return { mid, after, threw, disposedCalls };
};
window.counts = () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length, nodes: document.body.querySelectorAll('*').length });
window.__READY = true;
`);
await build({ root: src, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });

const srv = await serve(dist);
const browser = await launch({ w: 320, h: 240 });
let failed = 0;
const check = (name, ok, v) => { if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(v)); };
try {
  const { page, errors } = await open(browser, srv.url);
  const cdp = await page.createCDPSession();
  const listeners = async (expr) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    const { listeners: l } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return l.length;
  };
  const snap = async () => ({ ...(await page.evaluate(() => window.counts())), window: await listeners('window'), document: await listeners('document') });
  for (const [label, fn] of [['play', 'mountOnce'], ['game', 'mountGame']]) {
    const rows = [];
    for (let i = 0; i < 5; i++) { await page.evaluate((f) => window[f](), fn); rows.push(await snap()); }
    console.log(`${label}: after each mount + dispose:`, JSON.stringify(rows));
    const [first, last] = [rows[0], rows.at(-1)];
    for (const k of ['window', 'document', 'nodes', 'geometries', 'textures', 'programs']) check(`${label}: ${k} do not grow (${first[k]} -> ${last[k]})`, last[k] <= first[k], rows.map((r) => r[k]));
  }
  const E = await page.evaluate(() => window.embed());
  check('typing W into a host text field does not walk', E.start === E.typed, E);
  check("dispose gives the world camera's lens back", E.lens === E.after, E);
  const S = await page.evaluate(() => window.subs());
  check('ctx.onUpdate returns an unsubscribe function', S.mid.type === 'function', S.mid);
  check('callbacks run each frame; one that unsubscribes itself runs once and does not skip its neighbour', S.mid.a >= 2 && S.mid.self === 1 && S.mid.c === S.mid.a, S.mid);   // (a frame is several sub-frames)
  check('an unsubscribed callback stops, the others go on, a disposed vfx system does not throw from the world clock', S.after.a === S.mid.a && S.after.c > S.mid.c && S.threw === null, S);
  // a disposed play does not walk: hold W, nothing to move and no errors
  await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 300)); await page.keyboard.up('KeyW');
  check('no console errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `dispose check: ${failed} failing` : 'dispose check: ok');
process.exit(failed ? 1 : 0);

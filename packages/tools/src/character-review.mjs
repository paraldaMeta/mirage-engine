// Off-machine review of the actual player installed by createPlay. Run against River Ford, served or offline.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, open, serve } from './chrome.mjs';

const target = path.resolve(process.argv[2] || 'examples/river-ford/dist');
const offline = target.endsWith('.html'), out = path.resolve(process.argv[3] || 'examples/river-ford/out/character-' + (offline ? 'file' : 'http'));
await mkdir(out, { recursive: true });
const server = offline ? null : await serve(target);
let browser;
try {
  browser = await launch({ w: 1280, h: 800 });
  const url = new URL(offline ? pathToFileURL(target) : server.url);
  url.search = 'mode=game&quality=medium&w=1280&h=800&hud=0&ui=0';
  const { page, errors, warnings } = await open(browser, url.href);
  const model = await page.evaluate(() => {
    const { play, world, built } = window.__mirage;
    if (built.plan.name !== 'river-ford') throw new Error('Character review expects the River Ford scene');
    play.stop();
    const gl = world.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const mesh = play.avatar.mesh;
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      rig: mesh.name, bones: mesh.skeleton.bones.length, triangles: mesh.geometry.index.count / 3 };
  });
  const shots = [];
  for (const [name, facing, frames, keys, expected] of [
    ['front', [1,1], 1, [], 'idle'], ['profile', [1,-1], 1, [], 'idle'], ['backpack', [-1,-1], 1, [], 'idle'],
    ['walking', [1,1], 19, ['KeyS'], 'walk'], ['running', [1,1], 18, ['KeyS','ShiftLeft'], 'run'],
    ['ascending', [1,1], 8, ['Space'], 'jump'], ['descending', [1,1], 34, ['Space'], 'fall'],
    ['standing-again', [1,1], 92, ['Space'], 'idle'],
  ]) {
    const shot = await page.evaluate(({ facing, frames, keys }) => {
      const { play } = window.__mirage;
      play.keys.clear(); play.viewSize = 1.85;
      play.place([-10,2.8,0], [-10 + facing[0],2.8,facing[1]], 'game');
      play.step(1 / 60);
      for (const k of keys) play.keys.add(k);
      for (let i = 0; i < frames; i++) {
        play.step(1 / 60); if (i === 0) play.keys.delete('Space');
      }
      play.keys.clear(); play.render({ moving: false, spp: 4, frameIndex: 1 });
      return { mode: play.mode, state: play.avatar.state, visible: play.figure.visible, feet: play.state().pos };
    }, { facing, frames, keys });
    await page.screenshot({ path: path.join(out, name + '.png') });
    shots.push({ name, expected, ...shot, pass: shot.mode === 'game' && shot.visible && shot.state === expected });
  }
  const visibility = await page.evaluate(() => {
    const { play } = window.__mirage;
    return Object.fromEntries(['walk', 'orbit', 'fly', 'game'].map(mode => {
      play.setMode(mode); play.step(1 / 60); return [mode, play.figure.visible];
    }));
  });
  const silhouettePixels = await page.evaluate(() => {
    const { play, world } = window.__mirage, gl = world.renderer.getContext();
    play.place([-10,2.8,0], [-9,2.8,1], 'game'); play.viewSize = 1.85; play.step(1 / 60);
    function capture(show) {
      play.figure.visible = show;
      play.render({ moving: false, spp: 4, frameIndex: 1 });
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return pixels;
    }
    const hidden = capture(false), visible = capture(true);
    let count = 0;
    for (let i = 0; i < hidden.length; i += 4) {
      if (Math.abs(hidden[i] - visible[i]) + Math.abs(hidden[i+1] - visible[i+1]) + Math.abs(hidden[i+2] - visible[i+2]) > 18) count++;
    }
    return count;
  });

  const timing = await page.evaluate(() => {
    const { play, world } = window.__mirage, renderer = world.renderer, gl = renderer.getContext();
    const px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const times = () => ({ render: [], frame: [] });
    const samples = { visible: times(), hidden: times() }, costs = {};
    const originalReset = renderer.info.autoReset;
    try {
      for (const show of [false, true, true, false]) {
        play.place([-10,2.8,0], [-9,2.8,1], 'game'); play.viewSize = 4; play.keys.add('KeyS');
        const key = show ? 'visible' : 'hidden';
        for (let i = 0; i < 60; i++) {
          // Same input and poses in both passes. Measure the incremental rendering cost, including shadows.
          const frameStart = performance.now();
          play.step(1 / 60); play.figure.visible = show;
          renderer.info.autoReset = false; renderer.info.reset();
          const start = performance.now(); play.render({ moving: true }); sync();
          const end = performance.now();
          if (i >= 15) { samples[key].render.push(end - start); samples[key].frame.push(end - frameStart); }
        }
        costs[key] = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        play.keys.clear();
      }
    } finally { renderer.info.autoReset = originalReset; play.keys.clear(); play.figure.visible = true; }
    for (const [key, series] of Object.entries(samples)) {
      for (const [part, ms] of Object.entries(series)) {
        ms.sort((a, b) => a - b);
        costs[key][part] = { n: ms.length, meanMs: ms.reduce((a, b) => a + b, 0) / ms.length, p95Ms: ms[Math.floor(ms.length * 0.95)] };
      }
    }
    return costs;
  });
  const result = { url: url.href, browser: await page.evaluate(() => navigator.userAgent), model, quality: 'medium', shots, visibility, silhouettePixels, timing, warnings, errors };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  assert.deepEqual(errors, []);
  assert.ok(shots.every(s => s.pass), 'Unexpected character state; see report.json');
  assert.deepEqual(visibility, { walk: false, orbit: false, fly: false, game: true });
  assert.ok(silhouettePixels > 1000, 'character must change visible image pixels in the close-up');
  assert.ok(timing.visible.triangles > timing.hidden.triangles && timing.visible.calls > timing.hidden.calls, 'character must contribute geometry');
  console.log('Character screenshots and metrics saved to ' + out);
} finally {
  try { if (browser) await browser.close(); } finally { if (server) await server.close(); }
}

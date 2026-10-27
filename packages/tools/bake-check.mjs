#!/usr/bin/env node
// The walk-grid bake in headless Chrome: a railing thinner than a cell (0.125 m) is missed (cells are sampled at
// their centres), and the documented fix, a ctx.collider proxy >= 0.2 m thick, holds the walker.
// Needs Chrome with a GPU, so it is not in npm test:   node packages/tools/bake-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { launch, serve, open } from './src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'out/bake-check/src'), dist = path.join(here, 'out/bake-check/dist');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><script type="module" src="./main.js"></script>\n');
fs.writeFileSync(path.join(src, 'main.js'), `
import * as THREE from 'three';
import { buildWorld } from '@mirage/world';
import { bakeWalkGrid, createWalker } from '@mirage/play';

const renderer = new THREE.WebGLRenderer();
const run = async (proxy) => {
  const scene = new THREE.Scene();
  const world = { scene, renderer, ctx: { onUpdate() {} } };
  const mat = new THREE.MeshStandardMaterial();
  const rail = {
    name: 'rail',
    build(ctx) {
      ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10).translate(0, -0.1, 0), mat));
      // 5 cm thick, between the cell centres at x = -0.0625 and 0.0625
      ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 6).translate(0, 0.5, 0), mat));
      if (proxy) ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 6).translate(0, 0.5, 0)));
    },
  };
  await buildWorld(world, { plan: { name: 'rail', seed: 1, bounds: [-5, -5, 5, 5] }, modules: [rail], log: { log() {}, error: console.error } });
  scene.updateMatrixWorld(true);
  const grid = bakeWalkGrid(world, { bounds: [-5, -5, 5, 5], yMin: -1, yMax: 3 });
  const w = createWalker(grid, { pos: [-1.5, 0, 0] }).place([-1.5, 1, 0]);
  for (let i = 0; i < 180; i++) w.update(1 / 60, { x: 1, z: 0 });
  return { x: +w.pos[0].toFixed(3), y: +w.pos[1].toFixed(3) };
};
window.__R = { bare: await run(false), proxy: await run(true) };
window.__READY = true;
`);
await build({ root: src, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });

const srv = await serve(dist);
const browser = await launch({ w: 320, h: 240 });
let failed = 0;
try {
  const { page, errors } = await open(browser, srv.url);
  const R = await page.evaluate(() => window.__R);
  const check = (name, ok, v) => { if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(v)); };
  check('a 5 cm railing without a proxy is missed (walker passes)', R.bare.x > 0.5, R.bare);
  check('with a 0.2 m ctx.collider proxy it blocks', R.proxy.x < -0.1 && R.proxy.x > -0.6, R.proxy);
  check('no console errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `bake check: ${failed} failing` : 'bake check: ok');
process.exit(failed ? 1 : 0);

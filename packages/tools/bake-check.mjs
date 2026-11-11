#!/usr/bin/env node
// The walk-grid bake in headless Chrome: a railing thinner than a cell (0.125 m) is missed (cells are sampled at
// their centres), and the documented fix, a ctx.collider proxy >= 0.2 m thick, holds the walker. A solid wall blocks
// whatever its parent is (a plain Object3D as glTF uses, a LOD); a transparent one does not.
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
import { buildWorld } from '@miragekit/world';
import { bakeWalkGrid, createWalker } from '@miragekit/play';

const renderer = new THREE.WebGLRenderer();
// kind: 'bare' | 'proxy' (the thin railing), 'object3d' | 'lod' | 'transparent' (a 0.4 m wall under that parent)
const run = async (kind) => {
  const scene = new THREE.Scene();
  const world = { scene, renderer, ctx: { onUpdate() {} } };
  const mat = new THREE.MeshStandardMaterial();
  const rail = {
    name: 'rail',
    build(ctx) {
      ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10).translate(0, -0.1, 0), mat));
      if (kind === 'shelves') {
        // nine plates above head height over x 0..5: with the ground that is ten floors in a column, more than the
        // eight the bake collects; the ground must be among the ones kept (it used to be the one dropped)
        for (let i = 0; i < 9; i++) ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(5, 0.05, 6).translate(2.5, 2.2 + i * 0.5, 0), mat));
        return;
      }
      if (kind === 'bare' || kind === 'proxy') {
        // 5 cm thick, between the cell centres at x = -0.0625 and 0.0625
        ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 6).translate(0, 0.5, 0), mat));
        if (kind === 'proxy') ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 6).translate(0, 0.5, 0)));
        return;
      }
      const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 6).translate(0, 0.75, 0), kind === 'transparent' ? glass : mat);
      const parent = kind === 'lod' ? new THREE.LOD() : new THREE.Object3D();
      if (kind === 'lod') parent.addLevel(wall, 0); else parent.add(wall);
      ctx.root.add(parent);
    },
  };
  await buildWorld(world, { plan: { name: 'rail', seed: 1, bounds: [-5, -5, 5, 5] }, modules: [rail], log: { log() {}, error: console.error } });
  scene.updateMatrixWorld(true);
  const grid = bakeWalkGrid(world, { bounds: [-5, -5, 5, 5], yMin: -1, yMax: kind === 'shelves' ? 7 : 3 });
  const w = createWalker(grid, { pos: [-1.5, 0, 0] }).place([-1.5, 1, 0]);
  for (let i = 0; i < 180; i++) w.update(1 / 60, { x: 1, z: 0 });
  return { x: +w.pos[0].toFixed(3), y: +w.pos[1].toFixed(3) };
};
window.__R = {};
for (const k of ['bare', 'proxy', 'object3d', 'lod', 'transparent', 'shelves']) window.__R[k] = await run(k);
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
  check('a wall under a plain Object3D blocks', R.object3d.x < -0.1 && R.object3d.x > -0.7, R.object3d);
  check('a wall under a LOD blocks', R.lod.x < -0.1 && R.lod.x > -0.7, R.lod);
  check('a transparent wall does not block', R.transparent.x > 0.5, R.transparent);
  check('under ten stacked floors the ground is kept (walks in at y 0)', R.shelves.x > 1 && Math.abs(R.shelves.y) < 0.05, R.shelves);
  check('no console errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `bake check: ${failed} failing` : 'bake check: ok');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Check: resizing the window resizes the canvas and redraws a still view (it was left blank at the old size).
// usage: node scripts/resize-check.mjs <dist dir | page.html>   (no ?w= / ?h=, so the page follows the window)
import path from 'node:path';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const target = process.argv[2] || 'dist';
const srv = target.endsWith('.html') ? null : await serve(target);
const url = srv ? srv.url : 'file://' + path.resolve(target);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ w: 1000, h: 700 });
const { page, errors } = await open(b, url + '?grain=0');
const look = () => page.evaluate(() => {
  const { world, play } = window.__mirage, c = world.renderer.domElement;
  const k = document.createElement('canvas'); k.width = 64; k.height = 64;
  const x = k.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return { w: c.width, h: c.height, css: c.style.width + ' x ' + c.style.height, still: play.still, refined: play.stats.refined, mean: sum / (d.length / 4) / 3 };
});
const waitStill = async (n) => { for (let t = 0; t < 200; t++) { if ((await look()).still >= n) return; await sleep(100); } };
await waitStill(50);
const a = await look();
await page.setViewport({ width: 800, height: 500, deviceScaleFactor: 1 });
await sleep(300);
await waitStill(50);
const z = await look();
await b.close(); if (srv) srv.close();
const ok = z.w === 800 && z.h === 500 && z.refined > a.refined && z.mean > 10 && errors.length === 0;
console.log(`resize: before ${a.w}x${a.h} (css ${a.css}) mean ${a.mean.toFixed(1)}; after ${z.w}x${z.h} (css ${z.css}) mean ${z.mean.toFixed(1)}, ` +
  `still refinements ${a.refined} -> ${z.refined}, errors ${errors.length} -> ${ok ? 'ok' : 'FAIL'}`);
process.exit(ok ? 0 : 1);

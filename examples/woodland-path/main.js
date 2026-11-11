import { createWorldRenderer, pickQuality } from '@miragekit/core';
import { buildWorld } from '@miragekit/world';
import { createPlay, createXR, xrSupport } from '@miragekit/play';
import plan from './plan.js';
import ground from './modules/ground.js';
import verge from './modules/verge.js';
import backdrop from './modules/backdrop.js';

const q = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const width = Number(q.get('w')) || innerWidth, height = Number(q.get('h')) || innerHeight;
const quality = q.get('quality') || (await pickQuality()).quality;
canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
const xrs = await xrSupport();   // a headset browser: an MSAA context for the headset, and the Enter VR / AR buttons
const world = createWorldRenderer({ ...plan.render, canvas, width, height, quality, preserveDrawingBuffer: true, xr: xrs.vr || xrs.ar });
const built = await buildWorld(world, { plan, modules: [ground, verge, backdrop] });
if (built.report.failed.length) throw new Error(built.report.failed.map(row => row.name + ': ' + row.error).join('\n'));
if (q.get('perf')) window.__big = (await import('@miragekit/core/bigworld')).applyBigWorld(world, world.scene, q.get('perf'));   // ?perf=chunk,lod,occ (docs/big-worlds.md)
await world.prepare();
const play = createPlay(world, { canvas, quality, plan: built.plan, mode: q.get('mode') || 'walk',
  spp: Number(q.get('spp')) || 6, fit: !q.has('w'), ui: q.get('ui') !== '0', hud: q.get('hud') !== '0' });
const view = plan.viewpoints.find(v => v.name === q.get('view'));
if (view) play.place(view.eye, view.look, view.mode);
const xr = createXR(play, { support: xrs });
window.__mirage = { world, built, play, xr };
window.__READY = true;

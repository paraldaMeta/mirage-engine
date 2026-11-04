import { createWorldRenderer, pickQuality } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import plan from './plan.js';
import modules from './modules.js';

const q = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const width = Number(q.get('w')) || innerWidth, height = Number(q.get('h')) || innerHeight;
const quality = q.get('quality') || (await pickQuality()).quality;
canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
const world = createWorldRenderer({ ...plan.render, canvas, width, height, quality, preserveDrawingBuffer: true });
const built = await buildWorld(world, { plan, modules });
if (built.report.failed.length) throw new Error(built.report.failed.map(row => row.name + ': ' + row.error).join('\n'));
await world.prepare();
const play = createPlay(world, { canvas, quality, plan: built.plan, mode: q.get('mode') || 'walk',
  spp: Number(q.get('spp')) || 6, fit: !q.has('w'), ui: q.get('ui') !== '0', hud: q.get('hud') !== '0' });
const view = plan.viewpoints.find(v => v.name === q.get('view'));
if (view) play.place(view.eye, view.look, view.mode);
window.__mirage = { world, built, play };
window.__READY = true;

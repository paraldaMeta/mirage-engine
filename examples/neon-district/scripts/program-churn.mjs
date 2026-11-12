#!/usr/bin/env node
// How often three looks a program up again (getProgram: getParameters + the cache key) in a frame, per material:
// counted through each material's customProgramCacheKey, which three calls on every such lookup. A material shared
// by a skinned and a plain mesh, or drawn under two light setups, is looked up again on every switch.
//   node scripts/program-churn.mjs [dist] [--quality medium] [--view "street west"] [--world]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(here, '../dist'));
const Q = flag('quality', 'medium'), VIEW = flag('view', 'street west');
const srv = await serve(dist), b = await launch({ w: 1440, h: 900 });
const { page } = await open(b, `${srv.url}?w=1440&h=900&grain=0&hud=0&quality=${Q}&${args.includes('--world') ? 'world=1&ui=0' : 'start=1&assist=1'}`);
const out = await page.evaluate((VIEW) => {
  const { play, built, world } = window.__mirage, r = world.renderer;
  play.stop();
  for (let i = 0; i < 600 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
  const v = built.plan.viewpoints.find((q) => q.name === VIEW); play.place(v.eye, v.look, 'walk');
  for (let i = 0; i < 30; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); }
  const count = new Map(), mats = new Set();
  world.scene.traverse((o) => { for (const m of [o.material].flat()) if (m) mats.add(m); });
  let cur = null;
  const rbd = r.renderBufferDirect;
  r.renderBufferDirect = function (cam, scene, geo, mat, obj) { cur = obj; return rbd.apply(this, arguments); };
  const un = [];
  for (const m of mats) {
    const f = m.customProgramCacheKey;
    m.customProgramCacheKey = function () { let top = cur; while (top?.parent && !top.parent.isScene) top = top.parent; const rt = r.getRenderTarget(); const k = `${m.name || m.type}#${m.id} on ${cur?.isSkinnedMesh ? 'skinned' : cur?.isBatchedMesh ? 'batched' : cur?.isInstancedMesh ? 'instanced' : 'mesh'} ${top?.name || '?'}/${cur?.name || ''} rt ${rt ? rt.width + (rt.isWebGLCubeRenderTarget ? 'c' : '') : 'scr'}`; count.set(k, (count.get(k) || 0) + 1); return f.call(this); };
    un.push(() => { m.customProgramCacheKey = f; });
  }
  const N = 30;
  for (let i = 0; i < N; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); }
  un.forEach((f) => f()); r.renderBufferDirect = rbd;
  const rows = [...count].map(([k, n]) => [k, n / N]).sort((a, b) => b[1] - a[1]);
  return { total: rows.reduce((s, x) => s + x[1], 0), rows: rows.slice(0, 60) };
}, VIEW);
await b.close(); srv.close?.();
console.log(`${VIEW}, ${Q}: ${out.total.toFixed(1)} program lookups a frame`);
for (const [k, n] of out.rows) console.log(`${n.toFixed(1).padStart(7)}  ${k}`);

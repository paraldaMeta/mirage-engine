#!/usr/bin/env node
// What a frame draws, pass by pass (NOTES.md "Frame budget"): renderer.info per render() call and per shadow-map
// update, grouped by the code that asked for it (the caller in core: the scene, the planar mirror, a lamp's shadow
// tile, the sun's map, the velocity buffer, the SSR G-buffer, post), averaged over a few moving frames at a view.
//   node scripts/passes.mjs [dist] [--view "street west"] [--quality medium] [--frames 8] [--world] [--q extra=1]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--world'].includes(args[i - 1]))) || path.join(here, '../dist'));
const W = 1440, H = 900, VIEW = flag('view', 'street west'), FR = +flag('frames', 12);
const variants = (flag('variants') || `${args.includes('--world') ? 'world' : 'game'}:${flag('quality', 'medium')}`).split(',');
const srv = await serve(dist), browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
for (const v of variants) {
  const [kind, q] = v.split(':');
  const query = (kind === 'world' ? `world=1&ui=0&quality=${q}` : `start=1&assist=1&quality=${q}`) + (flag('q') ? '&' + flag('q') : '');
  const { page } = await open(browser, `${srv.url}?w=${W}&h=${H}&grain=0&hud=0&${query}`);
  const rows = await page.evaluate((VIEW, FR, OBJ) => {
    const { play, built, world } = window.__mirage, r = world.renderer, info = r.info, gl = r.getContext(), px = new Uint8Array(4);
    play.stop();
    for (let i = 0; i < 900 && (i < 20 || world.lighting?.busy); i++) { play.step(1 / 60); play.render({ moving: true }); }
    const vp = built.plan.viewpoints.find((x) => x.name === VIEW);
    play.place(vp.eye, vp.look, 'walk');
    for (let i = 0; i < 30; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); }
    const acc = new Map(), stack = [];
    const label = (kind) => {
      const st = new Error().stack.split('\n').slice(3).map((l) => l.trim()).filter((l) => !/passes|render \(|WebGLRenderer|three\.module/.test(l));
      const at = (st[0] || '?').replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\/assets\/[^:]+:\d+:\d+\)?/, '').trim() || '?';
      const rt = r.getRenderTarget();
      return `${kind} ${at} ${rt ? rt.width + 'x' + rt.height + (rt.isWebGLCubeRenderTarget ? ' cube' : '') : 'screen'}`;
    };
    const wrap = (obj, key, kind) => {
      const f = obj[key].bind(obj);
      obj[key] = function (...a) {
        const s0 = [info.render.calls, info.render.triangles], k = label(kind + (a[0]?.overrideMaterial ? ' om' : ''));
        stack.push(0); const res = f(...a); const inner = stack.pop();
        const dc = info.render.calls - s0[0] - (inner ? inner[0] : 0), dt = info.render.triangles - s0[1] - (inner ? inner[1] : 0);
        const e = acc.get(k) || [0, 0, 0]; e[0] += dc; e[1] += dt; e[2]++; acc.set(k, e);
        if (stack.length) { const top = stack[stack.length - 1] || [0, 0]; stack[stack.length - 1] = [top[0] + info.render.calls - s0[0], top[1] + info.render.triangles - s0[1]]; }
        return res;
      };
      return () => { obj[key] = f; };
    };
    info.autoReset = false; info.reset();
    const un = [wrap(r, 'render', 'render'), wrap(r.shadowMap, 'render', 'shadowmap')];
    // --objects: the draws of each pass by the top-level object they belong to (its name, or the module's group)
    const objs = new Map(), rbd = r.renderBufferDirect, geoTop = new Map();
    for (const top of world.scene.children) top.traverse((o) => { if (o.geometry && !geoTop.has(o.geometry)) geoTop.set(o.geometry, (top.name || top.type) + '/' + (o.name || o.type)); });
    if (OBJ) {
      r.renderBufferDirect = function (cam, scene, geo, mat, obj, group) {
        let top = obj; while (top.parent && top.parent.parent && !top.parent.isScene) top = top.parent;
        if (top.parent !== world.scene && geoTop.has(geo)) top = { name: 'vel/' + geoTop.get(geo) };   // a stand-in (the velocity pass)
        else if (top.name === 'game') { let c = obj; while (c.parent && c.parent !== top) c = c.parent; let d = obj; while (d.parent && d.parent !== c) d = d.parent; top = { name: 'game/' + (c.name || c.type) + (c !== obj ? '/' + (d.name || d.type) : '') + ' ' + mat.type }; }
        const rt = r.getRenderTarget(), k = `${rt ? rt.width + 'x' + rt.height + (rt.isWebGLCubeRenderTarget ? 'c' : '') : 'scr'}${scene?.overrideMaterial ? ' om' : ''} | ${top.name || top.type}${obj.isSkinnedMesh ? ' (skinned)' : ''}`;
        const n = (geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3 * (obj.isInstancedMesh ? obj.count : 1);
        const e = objs.get(k) || [0, 0]; e[0]++; e[1] += n; objs.set(k, e);
        return rbd.call(this, cam, scene, geo, mat, obj, group);
      };
      un.push(() => { r.renderBufferDirect = rbd; });
    }
    for (let i = 0; i < FR; i++) { play.turn(1, 0, 0.004); play.step(1 / 60); play.render({ moving: true }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    un.forEach((f) => f()); info.autoReset = true;
    const tot = [0, 0];
    const out = [...acc].map(([k, [c, t, n]]) => { tot[0] += c; tot[1] += t; return [k, +(c / FR).toFixed(1), Math.round(t / FR / 100) / 10, +(n / FR).toFixed(2)]; }).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    out.push(['all', +(tot[0] / FR).toFixed(1), Math.round(tot[1] / FR / 100) / 10, 0]);
    if (OBJ) for (const [k, [c, t]] of [...objs].sort((a, b) => b[1][0] - a[1][0]).slice(0, OBJ)) out.push(['  obj ' + k, +(c / FR).toFixed(1), Math.round(t / FR / 100) / 10, 0]);
    return out;
  }, VIEW, FR, +flag('objects', 0));
  console.log(`\n${v} at ${VIEW}, per frame over ${FR} moving frames: draws, k triangles, calls a frame`);
  for (const [k, c, t, n] of rows) console.log(`${String(c).padStart(7)} ${String(t).padStart(8)} k ${String(n).padStart(5)}  ${k}`);
  await page.close();
}
await browser.close(); srv.close?.();

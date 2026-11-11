#!/usr/bin/env node
// Mirage original code. Headless check of the planar reflection (packages/core/src/planar.js) on a built example.
//
// usage: node packages/tools/src/planar-check.mjs <hello-courtyard dist> [--before=<the same dist built before planar>]
//          [--garden=<walled-garden dist>] [--garden-before=<it built before planar>] [--out=dir]
//        (needs Chrome with a GPU: not in npm test)
// Pages: ?wet=0.8 without and with &planar=1 (and one with &planar=1&ssr=1&taa2=1&lights=8&lamppool=1). Checked:
//   - the lit programs carry the part; the mirror pass draws and is counted (info: calls, ms, renders);
//   - a red emitter put above the frame, out of view, in the direction a wet patch of ground mirrors, shows red in
//     that patch with planar on and changes nothing with it off (the screen-space passes cannot see it);
//   - a still with planar on is the same still when drawn again after another view (run to run);
//   - moving frames with taa2, screen-space reflections, the clustered lights and the lamp pool: no GL error;
//   - no page errors, no GL errors, no shader-anchor warnings;
//   - --before: the page without planar draws byte-identical stills (two views, dry and wet) to the build from before;
//   - --garden: walled-garden's pools mirror with &planar=1, no errors; --garden-before: off is byte-identical there too.
// --out: the before / after stills (off, planar, ssr, both) are written there as PNG.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2), dist = args.find((a) => !a.startsWith('--'));
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
if (!dist) { console.error('usage: planar-check.mjs <hello-courtyard dist> [--before=<dist>] [--out=dir]'); process.exit(2); }
const before = opt('before'), outDir = opt('out');
const W = 960, H = 600, BASE = `?mode=walk&ui=0&hud=0&w=${W}&h=${H}&grain=0`;
let bad = 0;
const fail = (m) => { bad++; console.error('  FAIL ' + m); };
const save = (name, url) => { if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(url.split(',')[1], 'base64')); } };

// in the page: the view, the red marker's place, stills
const PAGE = async (o) => {
  const { play, world } = window.__mirage, THREE = world.ctx.THREE, cam = world.camera, gl = world.renderer.getContext(), cv = world.renderer.domElement;
  play.stop();
  world.post.grain = 0;
  const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  const place = (eye, look) => { cam.position.fromArray(eye); cam.lookAt(...look); cam.updateMatrixWorld(); };
  const still = (spp = 4) => { world.renderFrame(0, { spp, frameIndex: 1, shutter: 0 }); return cv.toDataURL('image/png'); };
  const red = (u, v, r) => {   // mean redness (r - (g + b) / 2) in a box of r px around (u, v) (0..1, v down)
    g2.drawImage(cv, 0, 0);
    const x0 = Math.round(u * cv.width - r), y0 = Math.round(v * cv.height - r), d = g2.getImageData(x0, y0, 2 * r, 2 * r).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] - (d[i + 1] + d[i + 2]) / 2;
    return +(s / (d.length / 4)).toFixed(2);
  };
  const out = { errors: [] };
  const src = () => world.renderer.info.programs.map((p) => gl.getShaderSource(p.fragmentShader) || '');
  // the view: from the court's corner, looking down across the wet floor
  // (20 degrees down: a ray to the frame's lower part is mirrored steeper than the frame's top edge rises)
  const eye = [5.2, 1.6, 5.4], look = [5.2 - 0.69, 1.6 - 0.364, 5.4 - 0.72];
  place(eye, look);
  // a ground point in the lower middle of the frame, and where its mirror ray goes
  const p = new THREE.Vector3(0, -0.72, 0.5).unproject(cam), d = p.sub(cam.position).normalize();
  const t = (0.0 - cam.position.y) / d.y, G = cam.position.clone().addScaledVector(d, t);
  const R = d.clone(); R.y = -R.y;
  const M = G.clone().addScaledVector(R, 6);
  const gp = G.clone().project(cam), U = (gp.x + 1) / 2, V = (1 - gp.y) / 2;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0, 0) }));
  box.position.copy(M); box.lookAt(G); box.updateMatrixWorld();
  // its lowest corner on screen: above the top edge means it is out of view
  let low = Infinity;
  for (let i = 0; i < 8; i++) low = Math.min(low, new THREE.Vector3(i & 1 ? 0.8 : -0.8, i & 2 ? 0.8 : -0.8, i & 4 ? 0.8 : -0.8).applyMatrix4(box.matrixWorld).project(cam).y);
  out.marker = { ground: G.toArray().map((v) => +v.toFixed(2)), at: M.toArray().map((v) => +v.toFixed(2)), ndcY: +low.toFixed(2) };
  const without = still(); const r0 = red(U, V, 24);
  world.scene.add(box);
  const withBox = still(); const r1 = red(U, V, 24);
  out.red = { without: r0, with: r1, at: [+U.toFixed(3), +V.toFixed(3)] };
  out.images = { without, withBox };
  world.scene.remove(box);
  out.programs = src().filter((s) => s.includes('mgPlT')).length;
  const P = world.lighting && world.lighting.planar;
  out.info = P ? { ...P.info } : null;
  // run to run: the same still after another view was drawn
  const a = still(8);
  place([-3, 1.7, -4], [2, 1, 3]); still(2); for (let i = 0; i < 6; i++) world.renderFrame(i / 60, { taa: true });
  place(eye, look);
  out.same = a === still(8);
  // the stock views (for --before and --out)
  out.views = {};
  for (const name of o.views) { play.viewpoint(window.__mirage.built.plan.viewpoints.findIndex((v) => v.name === name)); play.stop(); out.views[name] = still(6); }
  // moving frames
  if (o.moving) {
    place(eye, look);
    for (let i = 0; i < 40; i++) { cam.position.x -= 0.03; cam.updateMatrixWorld(); world.renderFrame(i / 60, { taa: true }); }
    out.moving = { gl: gl.getError(), info: P ? { ...P.info } : null, img: cv.toDataURL('image/png') };
  }
  out.gl = gl.getError();
  return out;
};

const browser = await launch({ w: W, h: H });
const run = async (srvUrl, q, o) => {
  const pg = await open(browser, srvUrl + BASE + q);
  try {
    const r = await pg.page.evaluate(PAGE, o);
    r.pageErrors = [...new Set(pg.errors)];
    r.anchor = pg.warnings.filter((w) => w.includes('[lighting]') || /GL_INVALID|WebGL: /.test(w));
    return r;
  } finally { await pg.page.close(); }
};
try {
  const srv = await serve(dist);
  try {
    const views = ['hero', 'gate'];
    const off = await run(srv.url, '&wet=0.8', { views });
    const on = await run(srv.url, '&wet=0.8&planar=1', { views, moving: true });
    const all = await run(srv.url, '&wet=0.8&planar=1&ssr=1&taa2=1&lights=8&lamppool=1', { views: [], moving: true });
    const ssr = await run(srv.url, '&wet=0.8&ssr=1', { views: ['hero'] });
    const both = await run(srv.url, '&wet=0.8&planar=1&ssr=1', { views: ['hero'] });
    console.log(dist);
    console.log('  marker', JSON.stringify(on.marker), ' info', JSON.stringify(on.info));
    console.log(`  same still run to run: off ${off.same}, planar ${on.same}`);
    console.log(`  redness in the wet patch: off ${off.red.without} -> ${off.red.with} with the marker; planar ${on.red.without} -> ${on.red.with}`);
    if (!(on.marker.ndcY > 1.05)) fail('the marker is not above the frame: ndc y ' + on.marker.ndcY);
    if (!on.programs) fail('no lit program carries the planar part');
    if (off.programs) fail('the page without planar has the part in ' + off.programs + ' programs');
    if (!(on.info && on.info.renders > 0 && on.info.calls > 0)) fail('the mirror pass did not draw: ' + JSON.stringify(on.info));
    if (!(on.red.with - on.red.without > 8)) fail('the marker above the frame does not show in the wet ground with planar on');
    if (Math.abs(off.red.with - off.red.without) > 0.5) fail('the marker changes the frame with planar off');
    if (!on.same) fail('a still with planar differs when drawn again after another view');
    for (const [name, r] of Object.entries({ off, on, all, ssr, both })) {
      if (r.gl) fail(`${name}: GL error ${r.gl}`);
      if (r.moving && r.moving.gl) fail(`${name}: GL error ${r.moving.gl} on moving frames`);
      if (r.pageErrors.length) fail(`${name}: page errors: ${r.pageErrors.slice(0, 4).join(' | ').slice(0, 1500)}`);
      if (r.anchor.length) fail(`${name}: warnings: ${r.anchor.slice(0, 4).join(' | ')}`);
    }
    if (!(all.moving && all.moving.info && all.moving.info.renders >= 40)) fail('moving frames with taa2 / ssr / lights / lamp pool did not draw the mirror each frame: ' + JSON.stringify(all.moving && all.moving.info));
    if (outDir) {
      save('hello-courtyard-wet-off', off.views.hero); save('hello-courtyard-wet-planar', on.views.hero);
      save('hello-courtyard-wet-ssr', ssr.views.hero); save('hello-courtyard-wet-planar-ssr', both.views.hero);
      save('hello-courtyard-gate-off', off.views.gate); save('hello-courtyard-gate-planar', on.views.gate);
      save('marker-off', off.images.withBox); save('marker-planar', on.images.withBox); save('marker-planar-without', on.images.without);
      save('moving-planar-taa2-ssr-lights-lamppool', all.moving.img);
    }
    if (before) {
      const sb = await serve(before);
      try {
        for (const q of ['', '&wet=0.8']) {
          const a = await run(sb.url, q, { views }), b = await run(srv.url, q, { views });
          for (const v of views) {
            const same = a.views[v] === b.views[v];
            console.log(`  off${q} ${v}: ${same ? 'byte-identical' : 'DIFFERS'} to the build before planar`);
            if (!same) fail(`off${q} ${v}: the still differs from the build before planar`);
          }
        }
      } finally { sb.close(); }
    }
  } finally { srv.close(); }
  // walled-garden: the two pools on the middle terrace (their water is the plane)
  const garden = opt('garden'), gBefore = opt('garden-before');
  if (garden) {
    const GARDEN = async () => {
      const { play, world } = window.__mirage, gl = world.renderer.getContext(), cv = world.renderer.domElement;
      play.stop(); world.post.grain = 0;
      const vps = window.__mirage.built.plan.viewpoints, out = { views: {} };
      for (const name of ['pools', 'gate', 'looking back']) { const v = vps.find((q) => q.name === name); world.camera.position.fromArray(v.eye); world.camera.lookAt(...v.look); world.camera.updateMatrixWorld(); world.renderFrame(0, { spp: 6, frameIndex: 1, shutter: 0 }); out.views[name] = cv.toDataURL('image/png'); }
      const P = world.lighting && world.lighting.planar;
      out.info = P ? { ...P.info } : null;
      out.programs = world.renderer.info.programs.filter((p) => (gl.getShaderSource(p.fragmentShader) || '').includes('mgPlT')).length;
      for (let i = 0; i < 20; i++) world.renderFrame(i / 60, { taa: true });
      out.gl = gl.getError();
      return out;
    };
    const gRun = async (url, q) => { const pg = await open(browser, url + BASE + q); try { const r = await pg.page.evaluate(GARDEN); r.pageErrors = [...new Set(pg.errors)]; r.warn = pg.warnings.filter((w) => w.includes('[lighting]') || /GL_INVALID|WebGL: /.test(w)); return r; } finally { await pg.page.close(); } };
    const gs = await serve(garden);
    try {
      const off = await gRun(gs.url, ''), on = await gRun(gs.url, '&planar=1');
      console.log(garden);
      console.log('  info', JSON.stringify(on.info), ' programs with the part', on.programs);
      if (!on.programs || !(on.info && on.info.renders > 0)) fail('walled-garden: the mirror is not drawn or not read');
      if (on.views.pools === off.views.pools) fail('walled-garden: the pools look the same with planar on');
      for (const [name, r] of Object.entries({ off, on })) {
        if (r.gl) fail(`walled-garden ${name}: GL error ${r.gl}`);
        if (r.pageErrors.length) fail(`walled-garden ${name}: page errors: ${r.pageErrors.slice(0, 4).join(' | ').slice(0, 1500)}`);
        if (r.warn.length) fail(`walled-garden ${name}: warnings: ${r.warn.slice(0, 4).join(' | ')}`);
      }
      if (outDir) { save('walled-garden-pools-off', off.views.pools); save('walled-garden-pools-planar', on.views.pools); }
      if (gBefore) {
        const sb = await serve(gBefore);
        try {
          const a = await gRun(sb.url, '');
          for (const v of ['pools', 'gate', 'looking back']) {
            const same = a.views[v] === off.views[v];
            console.log(`  walled-garden off ${v}: ${same ? 'byte-identical' : 'DIFFERS'} to the build before planar`);
            if (!same) fail(`walled-garden off ${v}: the still differs from the build before planar`);
          }
        } finally { sb.close(); }
      }
    } finally { gs.close(); }
  }
} finally { await browser.close(); }
console.log(bad ? `planar check: ${bad} failure(s)` : 'planar check: ok');
process.exit(bad ? 1 : 0);

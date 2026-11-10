// Check: the splat kit (@mirage/world/kits/splat) on the GPU, in the splats demo packaged as one HTML file and
// served without COOP/COEP headers (no SharedArrayBuffer: the sort runs in a Blob worker all the same).
//   node examples/demos/splats/splat-check.mjs [--quick]   (--quick: no 1M-splat timing)
// 1. the kit's size: minified + gzip, three external (what an app pays for addSplats + loadSplats + effects)
// 2. the three loaders: the generated hill saved by make-fixtures.mjs as .splat, .ply and SOG, loaded back in the
//    page and compared with the generator's own data
// 3. visible: the ID pass of the playtest's `see` (share of the frame), and the frame with vs without the splats
// 4. sorted: a worker sort of a small set against a full CPU sort; on the GPU two overlapping splats swap as the
//    camera goes round them (back to front)
// 5. effects: reveal at rest and dissolve at rest draw exactly the plain image; half way they differ
// 6. 1M splats: moving frames (temporal AA, a camera on an orbit, the worker sorting as it goes) with the splats
//    off / on without the depth pass / on with it, interleaved; the worker's sort time; the first (main-thread) sort
// Writes out/splat-check.json and out/splats-*.png.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';
import { seeInPage } from '../../../packages/tools/src/see.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..'), out = path.join(here, 'out');
const quick = process.argv.includes('--quick');
const checks = [], report = {};
const ok = (k, cond, v) => { checks.push({ k, ok: !!cond, v }); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${k}${v !== undefined ? ': ' + (typeof v === 'string' ? v : JSON.stringify(v)) : ''}`); };
fs.mkdirSync(out, { recursive: true });

// 1. size
const kit = path.join(root, 'packages/world/src/kits/splat.js');
async function size(names) {
  const src = names ? `export { ${names.join(', ')} } from ${JSON.stringify(kit)};` : `export * from ${JSON.stringify(kit)};`;
  const r = await build({ input: 'entry', external: ['three'], write: false, logLevel: 'silent', output: { format: 'esm', minify: true },
    plugins: [{ name: 'entry', resolveId: (id) => (id === 'entry' ? id : null), load: (id) => (id === 'entry' ? src : null) }] });
  const code = r.output[0].code;
  return { min: code.length, gzip: zlib.gzipSync(code, { level: 9 }).length };
}
report.size = { app: await size(['addSplats', 'loadSplats', 'splatEffects']), all: await size(null) };
ok('kit size (addSplats + loadSplats + splatEffects, min + gzip)', report.size.app.gzip < 20 * 1024, `${(report.size.app.min / 1024).toFixed(1)} KB min, ${(report.size.app.gzip / 1024).toFixed(1)} KB gzip (whole module ${(report.size.all.gzip / 1024).toFixed(1)} KB gzip)`);

// fixtures and the single-file page
const N = 300000;
execFileSync('node', [path.join(here, 'make-fixtures.mjs'), '--n', String(N), '--out', path.join(out, 'fixtures')], { stdio: 'inherit' });
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', path.join(out, 'splats.html')], { stdio: 'inherit' });
const srv = await serve(out), b = await launch({ w: 1280, h: 720 });
const page0 = async (q) => {
  const o = await open(b, srv.url + 'splats.html?w=1280&h=720&ui=0&grain=0&' + q);
  await o.page.evaluate(() => window.__mirage.play.stop());
  return o;
};
const shot = async (page, name) => { const d = await page.evaluate(() => window.__mirage.world.renderer.domElement.toDataURL()); fs.writeFileSync(path.join(out, name), Buffer.from(d.split(',')[1], 'base64')); };

try {
  const { page, errors } = await page0(`n=${N}`);
  const env = await page.evaluate(() => ({ coi: self.crossOriginIsolated, worker: window.__mirage.splats.stats.worker, first: window.__mirage.splats.stats.lastMs }));
  ok('no cross-origin isolation, the sort runs in a Blob worker', env.coi === false && env.worker === true, env);

  // 2. loaders
  const loads = await page.evaluate(async (n) => {
    const { kit } = window.__mirage, ref = kit.makeHill({ count: n, seed: 1 }), res = {};
    for (const [k, url] of [['splat', 'fixtures/hill.splat'], ['ply', 'fixtures/hill.ply'], ['sog', 'fixtures/hill-sog/meta.json']]) {
      const t0 = performance.now(), D = await kit.loadSplats(url), ms = performance.now() - t0;
      const r = { count: D.count, ms: Math.round(ms), pos: 0, scale: 0, rgb: 0, a: 0, rot: 0 };
      for (let i = 0; i < Math.min(D.count, ref.count); i++) {
        for (let j = 0; j < 3; j++) {
          r.pos = Math.max(r.pos, Math.abs(D.center[i * 3 + j] - ref.center[i * 3 + j]));
          r.scale = Math.max(r.scale, Math.abs(Math.log(D.scale[i * 3 + j] / ref.scale[i * 3 + j])));
          r.rgb = Math.max(r.rgb, Math.abs(D.color[i * 4 + j] - ref.color[i * 4 + j]));
        }
        r.a = Math.max(r.a, Math.abs(D.color[i * 4 + 3] - ref.color[i * 4 + 3]));
        let d = 0; for (let j = 0; j < 4; j++) d += D.rot[i * 4 + j] * ref.rot[i * 4 + j];
        r.rot = Math.max(r.rot, 1 - Math.abs(d));
      }
      res[k] = r;
    }
    return res;
  }, N);
  report.loaders = loads;
  ok('.splat loads back exactly (rotation 8-bit)', loads.splat.count === N && loads.splat.pos === 0 && loads.splat.rgb === 0 && loads.splat.rot < 2e-3, loads.splat);
  ok('.ply loads back (colour and opacity within a byte)', loads.ply.count === N && loads.ply.pos === 0 && loads.ply.rgb <= 1 && loads.ply.a <= 1 && loads.ply.scale < 1e-5, loads.ply);
  ok('SOG (webp) loads back within its quantisation', loads.sog.count === N && loads.sog.pos < 3e-3 && loads.sog.scale < 0.1 && loads.sog.rgb === 0 && loads.sog.a === 0 && loads.sog.rot < 3e-3, loads.sog);

  // 3. visible
  await page.evaluate(() => { const { world, play, splats } = window.__mirage; play.place([5.5, 2.6, 9.5], [0, 1.3, 0], 'orbit'); world.camera.updateMatrixWorld(); splats.sortNow(world.camera); window.__mirage.render(); });
  await shot(page, 'splats-300k.png');
  const seen = await page.evaluate(seeInPage, ['hill']);
  report.see = seen.names ? seen.names.hill : seen;
  ok('see: the hill covers part of the frame', seen.names && seen.names.hill.share > 0.1, report.see);
  const vis = await page.evaluate(() => {
    const { world, splats } = window.__mirage, gl = world.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    window.__mirage.render(); const a = grab();
    splats.mesh.visible = false; window.__mirage.render(); const b2 = grab(); splats.mesh.visible = true;
    let changed = 0;
    for (let i = 0; i < W * H; i++) if (Math.abs(a[i * 4] - b2[i * 4]) + Math.abs(a[i * 4 + 1] - b2[i * 4 + 1]) + Math.abs(a[i * 4 + 2] - b2[i * 4 + 2]) > 12) changed++;
    return { changed: +(changed / (W * H)).toFixed(3) };
  });
  ok('the splats change the frame', vis.changed > 0.1, vis);

  // 4. sorted: the worker against a full CPU sort
  const sorted = await page.evaluate(async () => {
    const { world, kit, THREE } = window.__mirage, small = kit.makeHill({ count: 3000, seed: 9 }), g = new THREE.Group();
    world.scene.add(g);
    const s = kit.addSplats({ ...world.ctx, root: g }, small, { position: [0.5, 0, -0.3] }), cam = world.camera;
    cam.position.set(6, 2, 7); cam.lookAt(0, 1, 0); cam.updateMatrixWorld(); window.__mirage.render();   // the first sort, on this thread
    cam.position.set(-5, 3, 2); cam.lookAt(0.5, 1.2, -0.3); cam.updateMatrixWorld(); window.__mirage.render({ spp: 1 });   // asks the worker
    const before = s.stats.sorts; await s.sorted();
    const order = s.mesh.material.uniforms.tOrder.value.image.data, count = s.mesh.material.uniforms.uCount.value;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const depth = (i) => new THREE.Vector3(small.center[i * 3] + 0.5, small.center[i * 3 + 1], small.center[i * 3 + 2] - 0.3).sub(cam.position).dot(dir);
    const ref = [...Array(small.count).keys()].filter((i) => depth(i) > 0).sort((a, b2) => depth(b2) - depth(a));
    let exact = 0, inv = 0;
    for (let k = 0; k < count; k++) { if (order[k] === ref[k]) exact++; if (k) inv = Math.max(inv, depth(order[k]) - depth(order[k - 1])); }
    const B = 2 ** Math.max(10, Math.min(20, Math.ceil(Math.log2(ref.length)) + 3)), span = depth(ref[0]) - depth(ref[ref.length - 1]);
    const r = { worker: s.stats.worker, sortsByWorker: s.stats.sorts - before, count, ref: ref.length, unique: new Set(order.subarray(0, count)).size, exact: +(exact / count).toFixed(3), worstInversion: +inv.toExponential(2), bound: +(4 * span / B).toExponential(2) };
    s.dispose(); g.removeFromParent();
    return r;
  });
  report.sorted = sorted;
  ok('worker sort = CPU reference (same splats, order within one bucket)', sorted.sortsByWorker === 1 && sorted.count === sorted.ref && sorted.unique === sorted.count && sorted.worstInversion <= sorted.bound, sorted);
  // on the GPU: a red splat and a blue one, overlapping, opaque; whichever is nearer must cover the centre
  const gpu = await page.evaluate(() => {
    const { world, kit, THREE } = window.__mirage, g = new THREE.Group(); world.scene.add(g);
    const D = { count: 2, center: new Float32Array([0, 1.5, 3, 0, 1.5, 3.6]), scale: new Float32Array([0.25, 0.25, 0.25, 0.25, 0.25, 0.25]), rot: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]), color: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const s = kit.addSplats({ ...world.ctx, root: g }, D, { depth: false }), cam = world.camera, gl = world.renderer.getContext(), px = new Uint8Array(4);
    world.scene.traverse((o) => { if (o.name === 'hill-splats') o.visible = false; });
    const look = (z) => { cam.position.set(0, 1.5, z); cam.lookAt(0, 1.5, 3.3); cam.updateMatrixWorld(); s.sortNow(cam); window.__mirage.render({ spp: 1 }); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px]; };
    const front = look(6.3), back = look(0.3);
    const r = { fromFront: front, fromBack: back };
    s.dispose(); g.removeFromParent();
    world.scene.traverse((o) => { if (o.name === 'hill-splats') o.visible = true; });
    return r;
  });
  ok('on the GPU the nearer splat covers the farther one, from either side', gpu.fromFront[2] > 2 * gpu.fromFront[0] && gpu.fromBack[0] > 2 * gpu.fromBack[2], gpu);

  // 5. effects
  const fx = await page.evaluate(() => {
    const { world, splats, kit, play } = window.__mirage, gl = world.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    play.place([5.5, 2.6, 9.5], [0, 1.3, 0], 'orbit'); world.camera.updateMatrixWorld(); splats.sortNow(world.camera);
    const grab = () => { window.__mirage.render(); const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const d = (a, b2) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b2[i]); return +(s / a.length).toFixed(3); };
    const base = grab(), r = {};
    splats.setEffect(kit.splatEffects.reveal({ origin: [0, 0, 0] })); splats.progress = 1; r.revealRest = d(grab(), base);
    splats.progress = 0.5; r.revealHalf = d(grab(), base); window.__fxA = world.renderer.domElement.toDataURL();
    splats.setEffect(kit.splatEffects.dissolve()); splats.progress = 0; r.dissolveRest = d(grab(), base);
    splats.progress = 0.5; r.dissolveHalf = d(grab(), base); window.__fxB = world.renderer.domElement.toDataURL();
    splats.setEffect(null); splats.progress = 1; r.off = d(grab(), base);
    return r;
  });
  for (const [k, n] of [['__fxA', 'splats-reveal.png'], ['__fxB', 'splats-dissolve.png']]) { const u = await page.evaluate((k2) => window[k2], k); fs.writeFileSync(path.join(out, n), Buffer.from(u.split(',')[1], 'base64')); }
  report.effects = fx;
  ok('effects at rest draw the plain image; half way they change it', fx.revealRest === 0 && fx.dissolveRest === 0 && fx.off === 0 && fx.revealHalf > 1 && fx.dissolveHalf > 1, fx);
  ok('no page errors (300k)', errors.length === 0, errors.slice(0, 3));
  await page.close();

  // 6. 1M splats
  if (!quick) {
    const M = 1000000, { page: p2, errors: e2 } = await page0(`n=${M}&depth=1`);
    const perf = await p2.evaluate(async () => {
      const { world, splats } = window.__mirage, first = splats.stats.lastMs, cam = world.camera, gl = world.renderer.getContext(), px = new Uint8Array(4);
      const depthMesh = splats.mesh.children[0];
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let a = 0;
      const frames = async (n, set) => {
        set(); const ms = [];
        for (let k = 0; k < n; k++) {
          a += 0.01; cam.position.set(Math.sin(a) * 9, 2.4, Math.cos(a) * 9); cam.lookAt(0, 1.2, 0); cam.updateMatrixWorld();
          sync(); const t = performance.now(); world.renderFrame(a, { taa: true, dt: 1 / 60 }); sync(); ms.push(performance.now() - t);
          await new Promise((r) => setTimeout(r, 0));   // the worker's reply lands between frames
        }
        return ms;
      };
      const modes = { off: () => { splats.mesh.visible = false; }, splats: () => { splats.mesh.visible = true; depthMesh.visible = false; }, depth: () => { splats.mesh.visible = true; depthMesh.visible = true; } };
      await frames(30, modes.depth);   // warm up
      const s0 = { ...splats.stats }, res = { off: [], splats: [], depth: [] };
      for (let round = 0; round < 6; round++) for (const k of Object.keys(modes)) res[k].push(...(await frames(20, modes[k])));
      const med = (v) => { const s = [...v].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
      const pct = (v, q) => { const s = [...v].sort((x, y) => x - y); return +s[Math.floor(s.length * q)].toFixed(2); };
      const st = splats.stats, sorts = st.sorts - s0.sorts;
      return {
        firstSortMs: +first.toFixed(1), visible: st.visible,
        frameMs: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { median: med(v), p10: pct(v, 0.1), p90: pct(v, 0.9) }])),
        workerSorts: sorts, workerSortMs: +((st.totalMs - s0.totalMs) / Math.max(1, sorts)).toFixed(1), workerSortMaxMs: +st.maxMs.toFixed(1),
        gpu: (() => { const x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?'; })(),
        size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    });
    await p2.evaluate(() => { const { world, splats } = window.__mirage; world.camera.position.set(6, 2.4, 8); world.camera.lookAt(0, 1.2, 0); world.camera.updateMatrixWorld(); splats.sortNow(world.camera); window.__mirage.render(); });
    await shot(p2, 'splats-1m.png');
    report.perf1M = perf;
    const f = perf.frameMs;
    ok('1M splats: moving frame time (TAA, 1280x720; off / splats / + depth pass, medians, interleaved)', f.splats.median < 60,
      `${f.off.median} / ${f.splats.median} / ${f.depth.median} ms (p10-p90 ${f.splats.p10}-${f.splats.p90}, ${f.depth.p10}-${f.depth.p90}) on ${perf.gpu}`);
    ok('1M splats: sort in the worker', perf.workerSorts > 10 && perf.workerSortMs < 60, `${perf.workerSortMs} ms mean over ${perf.workerSorts} sorts (max ${perf.workerSortMaxMs}), first sort on the main thread ${perf.firstSortMs} ms`);
    ok('no page errors (1M)', e2.length === 0, e2.slice(0, 3));
    await p2.close();
  }
} finally {
  await b.close(); srv.close();
}
fs.writeFileSync(path.join(out, 'splat-check.json'), JSON.stringify({ checks, report }, null, 2));
const bad = checks.filter((c) => !c.ok);
console.log(`splat check: ${bad.length ? bad.length + ' FAILED' : 'ok'} (${checks.length} checks) -> ${path.relative(root, path.join(out, 'splat-check.json'))}`);
process.exit(bad.length ? 1 : 0);

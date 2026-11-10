// Mirage original code. ctx.onUpdate returns an unsubscribe function: the loader's per-module one (before and after
// the module is committed, and for a module dropped by a failed finalize) and the streamer's, against a stand-in world
// whose list behaves like createWorldRenderer's. The real world's list is exercised in a page by
// packages/tools/dispose-check.mjs.   node scripts/checks/updates.check.mjs
import * as THREE from 'three';
import { ok } from '../soft-assert.mjs';
import { buildWorld, createStreamer } from '../../packages/world/src/index.js';

const mkWorld = () => {
  let list = [];
  const w = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), size: () => list.length, frame: (t = 0) => { for (const fn of list) fn(t); },
    renderer: { initTexture() {}, compileAsync: async () => {}, getRenderTarget: () => null, setRenderTarget() {} },
    ctx: { THREE, onUpdate: (fn) => { list = list.concat(fn); let on = true; return () => { if (on) { on = false; const i = list.lastIndexOf(fn); list = list.filter((_, k) => k !== i); } }; } } };
  return w;
};
const quiet = { log() {}, error() {} };

// ---- loader
{
  const w = mkWorld(), n = { early: 0, kept: 0, self: 0, late: 0, fin: 0 };
  let offKept, offLate;
  const built = await buildWorld(w, { plan: { name: 'u', bounds: [0, 0, 1, 1] }, log: quiet, modules: [
    { name: 'a', build(ctx) {
      const off = ctx.onUpdate(() => n.early++);
      ok(typeof off === 'function', 'ctx.onUpdate returns a function');
      off(); off();   // before the module is in the scene, twice
      offKept = ctx.onUpdate(() => n.kept++);
      const offSelf = ctx.onUpdate(() => { n.self++; offSelf(); });   // from inside the callback
    }, finalize(ctx) { offLate = ctx.onUpdate(() => n.fin++); } },
    { name: 'dropped', build(ctx) { ctx.onUpdate(() => n.late++); ctx.onUpdate(() => n.late++); }, finalize() { throw new Error('deliberate'); } },
  ] });
  ok(built.report.failed.length === 1, 'the module with the failing finalize was dropped');
  ok(w.size() === 3, 'the world holds only live callbacks: unsubscribed-before-commit and dropped-module ones are gone (' + w.size() + ')');
  w.frame(); w.frame(); w.frame();
  ok(n.early === 0, 'a callback unsubscribed during build never runs');
  ok(n.kept === 3 && n.fin === 3, 'the others run every frame');
  ok(n.self === 1, 'a callback that unsubscribes itself runs once, and the ones after it still ran that frame');
  ok(n.late === 0, "a dropped module's callbacks do not run");
  ok(w.size() === 2, 'self-unsubscribe left the list (' + w.size() + ')');
  offKept(); offLate(); offKept();
  w.frame();
  ok(n.kept === 3 && n.fin === 3 && w.size() === 0, 'unsubscribed after the build: no more calls, the list is empty');
}
// a host world whose onUpdate still returns a count keeps working (the disposer then silences the callback)
{
  const fns = [], w = { scene: new THREE.Scene(), ctx: { THREE, onUpdate: (f) => fns.push(f) } };
  let c = 0, off;
  await buildWorld(w, { plan: { name: 'v', bounds: [0, 0, 1, 1] }, log: quiet, modules: [{ name: 'a', build(ctx) { off = ctx.onUpdate(() => c++); } }] });
  fns.forEach((f) => f(0)); off(); fns.forEach((f) => f(0));
  ok(c === 1, 'count-returning host: the unsubscribed callback is silent');
}
// ---- streamer
{
  const w = mkWorld(), tick = () => new Promise((r) => setTimeout(r, 3));
  let a = 0, b = 0, offA;
  const st = createStreamer(w, { plan: { name: 's', bounds: [-50, -50, 50, 50] }, log: quiet, modules: [{ name: 'm', center: [0, 0], radius: 10, build(ctx) {
    ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    offA = ctx.onUpdate(() => a++); ctx.onUpdate(() => b++);
  } }] });
  ok(w.size() === 1, 'the streamer holds one world callback');
  for (let i = 0; i < 20; i++) { st.update([0, 0, 0]); await tick(); }
  w.frame();
  ok(a === 1 && b === 1, 'streamed callbacks run while the module is shown');
  offA(); offA(); w.frame();
  ok(a === 1 && b === 2, "a streamed module's unsubscribe stops that callback only");
  st.dispose(); w.frame();
  ok(w.size() === 0 && b === 2, 'streamer.dispose() takes its callback out of the world (' + w.size() + ')');
}
console.log('updates check: done');

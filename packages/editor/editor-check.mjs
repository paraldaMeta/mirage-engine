// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's browser check: drives the real editor in headless Chrome against an example and proves the round trip.
//
//   node packages/editor/editor-check.mjs                      # hello-courtyard and walled-garden
//   node packages/editor/editor-check.mjs hello-courtyard      # one example
//   node packages/editor/editor-check.mjs --shots              # also rewrite the screenshots in docs/media/editor
//
// Per example: start the server with --write, open the editor, click-select an object in the view, drag the gizmo
// with the mouse, undo / redo from the keyboard, duplicate / copy / paste / delete, place one of every object type,
// move a plan point (the modules rebuild), change the time and a post setting, make a timeline, play and stop,
// undo EVERYTHING (plan hash and still must be the first ones again), redo everything, save, reload, and compare
// the plan hash and a still with the ones before the reload. Then the page without the editor (?editor=0) must
// build the same edited world. The example's plan.edits.json is put back as it was whatever happens.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startEditor } from './src/server.mjs';
import { applyEdits, serializeLayer } from './src/index.js';
import { launch } from '../tools/src/chrome.mjs';
import { readPNG, encodePNG, regionSSIM, pixelDiff, sideBySide } from '../tools/src/imgcmp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), SHOTS = args.includes('--shots');
const names = args.filter((a) => !a.startsWith('--'));
const examples = names.length ? names : ['hello-courtyard', 'walled-garden'];
const outDir = SHOTS ? join(ROOT, 'docs', 'media', 'editor') : join(tmpdir(), 'mirage-editor-check');
mkdirSync(outDir, { recursive: true });

let failed = 0;
const numbers = {};
const ok = (cond, what, detail = '') => { if (!cond) failed++; console.log((cond ? '  ok    ' : '  FAIL  ') + what + (detail !== '' ? '  [' + detail + ']' : '')); return !!cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

async function openEditor(browser, url, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => { globalThis.__mirageEditorNoPrompt = true; });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('globalThis.__mirageEditor?.ready || globalThis.__mirageEditorError', { timeout: 180000 });
  const err = await page.evaluate('globalThis.__mirageEditorError || null');
  if (err) throw new Error('editor did not start: ' + err);
  await settle(page);
  return { page, ms: Date.now() - t0 };
}
const settle = async (page) => { const s = await page.evaluate(() => globalThis.__mirageEditor.settled()); if (!s) throw new Error('the editor never settled'); await sleep(60); };
const state = (page) => page.evaluate(() => {
  const A = globalThis.__mirageEditor, L = A.doc.layer;
  return { hash: A.hash(), sel: A.selection, mode: A.mode, objects: Object.keys(L.objects), layer: JSON.parse(A.doc.serialize()), history: A.doc.history(), dirty: A.doc.dirty,
    errors: A.logs.filter((l) => l.level === 'error').map((l) => l.text), diags: A.diagnostics.map((d) => d.code + ' ' + d.severity), stats: { ...A.stats } };
});
const still = async (page) => readPNG(await page.evaluate(() => globalThis.__mirageEditor.still({ spp: 4, view: 0 })));
const key = async (page, k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.reverse()) await page.keyboard.up(m); await sleep(40); };
async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from[0], from[1]); await sleep(60);   // hover first: the gizmo picks its axis on move
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await sleep(16); }
  await page.mouse.up(); await sleep(80);
}
// a failed comparison leaves the pair side by side next to the screenshots
const pair = (name, a, b) => { const f = join(outDir, name + '.png'); writeFileSync(f, encodePNG(sideBySide(a, b))); return f; };
// the gizmo handle to drag: of X and Z, the one that is longest on screen (the other may point at the camera)
const grip = (page, from = 0.3, to = 1.0) => page.evaluate((from, to) => {
  const v = globalThis.__mirageEditor.vp, len = (a) => { const p = v.handlePoint(a, from), q = v.handlePoint(a, to); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  const axis = len('X') >= len('Z') ? 'X' : 'Z';
  return { axis, i: axis === 'X' ? 0 : 2, a: v.handlePoint(axis, from), b: v.handlePoint(axis, to) };
}, from, to);
const compare = (a, b) => { const s = regionSSIM(a, b), d = pixelDiff(a, b); return { ssim: +s.mean.toFixed(4), cell: s.cell, differing: +(d.differing / (a.w * a.h) * 100).toFixed(3), max: d.max }; };

async function run(name, browser) {
  console.log('\n' + name);
  const root = join(ROOT, 'examples', name), file = join(root, 'plan.edits.json');
  const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const errors = [], N = numbers[name] = {};
  let ed = null;
  try {
    writeFileSync(file, '{}\n');
    ed = await startEditor({ root, port: 0, write: true, log: {} });
    let { page, ms } = await openEditor(browser, ed.url, errors);
    N.openMs = ms;
    const s0 = await state(page), still0 = await still(page);
    ok(s0.objects.length === 0 && !s0.dirty, 'opens on the plan with an empty layer', 'plan ' + s0.hash + ', ' + ms + ' ms');
    ok(s0.errors.length === 0 && s0.diags.filter((d) => d.endsWith('error')).length === 0, 'no errors in the console panel', s0.errors.concat(s0.diags).join('; '));
    N.draws = s0.stats.calls; N.triangles = s0.stats.triangles;

    // ---- place, click-select, gizmo
    const id = await page.evaluate(() => globalThis.__mirageEditor.cmd.add('primitive', { shape: 'box', color: '#c0562f' }));
    await settle(page);
    await page.evaluate(() => globalThis.__mirageEditor.select([]));
    const at = await page.evaluate((i) => { const A = globalThis.__mirageEditor; return A.vp.screenOf(A.doc.layer.objects[i].position); }, id);
    await page.mouse.click(at[0], at[1]); await sleep(80);
    let s = await state(page);
    ok(s.sel.length === 1 && s.sel[0] === 'obj:' + id, 'a click in the view selects the object under it', s.sel.join(','));
    const p0 = s.layer.objects[id].position, steps0 = s.history.done.length;
    const g1st = await grip(page, 0.3, 1.3), ax = g1st.i;
    await drag(page, g1st.a, g1st.b);
    await settle(page);
    s = await state(page);
    const p1 = s.layer.objects[id].position;
    ok(Math.abs(p1[ax] - p0[ax]) > 0.05 && [0, 1, 2].every((i) => i === ax || near(p1[i], p0[i])), 'dragging the ' + g1st.axis + ' arrow moves it along ' + g1st.axis + ' only', p0.join(' ') + ' -> ' + p1.join(' '));
    ok(s.history.done.length === steps0 + 1 && /^Move/.test(s.history.done.at(-1)), 'the drag is one undo step', s.history.done.at(-1));
    await page.screenshot({ path: join(outDir, name + '-gizmo.jpg'), type: 'jpeg', quality: 80 });
    await key(page, 'z', ['Control']); await settle(page);
    s = await state(page);
    ok(near(s.layer.objects[id].position[ax], p0[ax]), 'Ctrl+Z puts it back');
    await key(page, 'z', ['Control', 'Shift']); await settle(page);
    s = await state(page);
    ok(near(s.layer.objects[id].position[ax], p1[ax]), 'Ctrl+Shift+Z moves it again');

    // snapping: with the grid snap on, a move lands on the step
    await key(page, 'n');
    const gs = await grip(page, 0.3, 1.1);
    await drag(page, gs.a, gs.b); await settle(page);
    s = await state(page);
    const z = s.layer.objects[id].position[gs.i], step = await page.evaluate(() => globalThis.__mirageEditor.vp.gizmo.steps.move);
    ok(Math.abs(z - p1[gs.i]) > 1e-6 && near(z / step, Math.round(z / step), 1e-3), 'with snap on, the move lands on the grid', gs.axis + ' ' + p1[gs.i] + ' -> ' + z + ' (step ' + step + ')');
    await key(page, 'n');

    // scale and rotate handles
    await key(page, 'r');
    const gc = await grip(page);
    await drag(page, gc.a, gc.b); await settle(page);
    s = await state(page);
    ok(s.layer.objects[id].scale[gc.i] > 1.05 && [0, 1, 2].every((i) => i === gc.i || near(s.layer.objects[id].scale[i], 1)), 'the scale handle scales one axis', s.layer.objects[id].scale.join(' '));
    await key(page, 'e');
    ok(await page.evaluate(() => globalThis.__mirageEditor.vp.gizmo.mode) === 'rotate', 'E switches to rotate');
    await key(page, 'w');

    // ---- duplicate, copy / paste, multi-select, delete
    await key(page, 'd', ['Control']); await settle(page);
    s = await state(page);
    ok(s.objects.length === 2 && s.sel.length === 1 && s.sel[0] !== 'obj:' + id, 'Ctrl+D duplicates and selects the copy', s.objects.join(','));
    await key(page, 'c', ['Control']); await key(page, 'v', ['Control']); await settle(page);
    s = await state(page);
    ok(s.objects.length === 3, 'Ctrl+C / Ctrl+V pastes a third');
    await key(page, 'a', ['Control']);
    s = await state(page);
    ok(s.sel.length === 3, 'Ctrl+A selects all three');
    const gm = await grip(page, 0.3, 0.9), before = s.objects.map((k) => s.layer.objects[k].position[gm.i]);
    await drag(page, gm.a, gm.b); await settle(page);
    s = await state(page);
    const deltas = s.objects.map((k, i) => s.layer.objects[k].position[gm.i] - before[i]);
    ok(deltas.every((d) => Math.abs(d) > 0.02 && near(d, deltas[0], 2e-3)), 'a multi-selection moves as one', deltas.map((d) => d.toFixed(3)).join(' '));
    await page.evaluate((i) => globalThis.__mirageEditor.select(['obj:' + i]), s.objects[2]);
    await key(page, 'Delete'); await settle(page);
    s = await state(page);
    ok(s.objects.length === 2, 'Delete removes the selected object');
    await key(page, 'f');   // focus: just must not throw

    // ---- one of every object type, where the view meets the world
    const placedTypes = await page.evaluate(async () => {
      const A = globalThis.__mirageEditor, out = {}, c = A.viewCentre();
      const types = [['light', { kind: 'point', intensity: 6 }], ['probe', {}], ['gi', {}], ['audioZone', {}], ['vfx', {}], ['nav', {}], ['trigger', { event: 'door' }], ['spawnPoint', {}], ['wall', {}], ['model', { url: 'models/crate.gltf' }]];
      let i = 0;
      for (const [type, extra] of types) { out[type] = A.cmd.add(type, extra, [c[0] + (i % 4) * 1.2 - 1.8, c[1], c[2] + ((i / 4) | 0) * 1.2 - 1.2]); i++; }
      A.cmd.addViewpoint();
      return out;
    });
    await settle(page);
    s = await state(page);
    ok(Object.values(placedTypes).every(Boolean) && s.objects.length === 12, 'one of every object type is placed (light, probes, zones, effect, nav, trigger, spawn, wall, model)', s.objects.length + ' objects');
    ok(await page.evaluate((i) => { let n = 0; globalThis.__mirageEditor.placed.get(i)?.traverse((o) => { if (o.isMesh) n++; }); return n; }, placedTypes.model) > 0, 'the glTF model is in the scene');
    ok(s.errors.length === 0, 'placing them logs no error', s.errors.join('; '));

    // ---- a plan edit through the gizmo: the modules rebuild
    const el = await page.evaluate(() => { const A = globalThis.__mirageEditor; const e = A.elements().find((x) => x.kind === 'point') || A.elements().find((x) => x.kind === 'shape'); return e ? { id: e.id, path: e.path, value: A.item(e.id).value } : null; });
    if (ok(!!el, 'the plan has a point or shape to edit', el?.path)) {
      await page.evaluate((i) => { const A = globalThis.__mirageEditor; A.select([i]); A.cmd.focus(); }, el.id);
      await sleep(700); await settle(page);
      const gq = await grip(page), t0 = Date.now();
      await drag(page, gq.a, gq.b); await settle(page);
      N.rebuildMs = Date.now() - t0;
      s = await state(page);
      ok(s.layer.set[el.path] !== undefined && JSON.stringify(s.layer.set[el.path]) !== JSON.stringify(el.value), 'moving a plan element writes plan data and rebuilds the modules', el.path + ' = ' + JSON.stringify(s.layer.set[el.path]) + ', ' + N.rebuildMs + ' ms incl. settle');
      ok(s.errors.length === 0, 'the rebuild logs no error', s.errors.join('; '));
    }

    // ---- inspector (a typed number field), environment, post
    await page.evaluate((i) => globalThis.__mirageEditor.select(['obj:' + i]), id);
    await page.click('#mg-ed [data-tab="Inspector"]');
    const typed = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#mg-ed .mg-row[data-field]')].find((r) => /rough/i.test(r.dataset.field)) || null;
      const input = row?.querySelector('input.mg-in'); if (!input) return null;
      input.value = '0.35'; input.dispatchEvent(new Event('change', { bubbles: true }));
      return row.dataset.field;
    });
    await settle(page);
    s = await state(page);
    ok(typed && s.layer.objects[id][typed] === 0.35, 'typing in an inspector field edits the object', typed + ' = ' + s.layer.objects[id]?.[typed]);
    await page.click('#mg-ed [data-tab="World"]');
    await page.evaluate(() => { const A = globalThis.__mirageEditor; A.exec('Time of day', [{ section: 'env', key: 'time', value: '17:40' }]); A.exec('Exposure', [{ section: 'env', key: 'post.exposure', value: 1.3 }]); });
    await settle(page);
    ok(near(await page.evaluate(() => globalThis.__mirageEditor.world.post.exposure), 1.3), 'a post setting changes the live world');
    await page.screenshot({ path: join(outDir, name + '-world.jpg'), type: 'jpeg', quality: 80 });

    // ---- timeline: two keys on the box, scrubbed
    await page.click('#mg-ed [data-tab="Timeline"]');
    await page.click('#mg-ed [data-cmd="tl-new"]'); await sleep(60);
    await page.click('#mg-ed [data-cmd="tl-track"]'); await sleep(60);
    await page.click('#mg-ed [data-cmd="tl-key"]'); await sleep(60);
    const lane = await page.$eval('#mg-ed .mg-tl[data-track="0"]', (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; });
    await page.mouse.click(lane[0] + lane[2] * 0.5, lane[1]); await sleep(80);
    await page.evaluate((i) => { const A = globalThis.__mirageEditor, d = A.doc.layer.objects[i]; A.exec('Lift', [{ section: 'objects', key: i, value: { ...d, position: [d.position[0], d.position[1] + 1.5, d.position[2]] } }]); }, id);
    await settle(page);
    await page.click('#mg-ed [data-cmd="tl-key"]'); await sleep(80);
    await settle(page);
    s = await state(page);
    const tl = Object.values(s.layer.timelines)[0];
    ok(tl?.tracks?.[0]?.keys?.length === 2 && tl.tracks[0].keys[1].t > 1, 'the timeline editor keys the selected object twice', JSON.stringify(tl?.tracks?.[0]?.keys?.map((k) => k.t)));
    await page.mouse.click(lane[0] + lane[2] * 0.25, lane[1]); await sleep(120);
    const yMid = await page.evaluate((i) => globalThis.__mirageEditor.placed.get(i).position.y, id), yA = tl.tracks[0].keys[0].position[1], yB = tl.tracks[0].keys[1].position[1];
    ok(yMid > yA + 0.05 && yMid < yB - 0.05, 'scrubbing between the keys poses the object in between', yA + ' < ' + yMid.toFixed(3) + ' < ' + yB);
    await page.click('#mg-ed [data-cmd="tl-stop"]'); await sleep(80);
    await page.screenshot({ path: join(outDir, name + '-timeline.jpg'), type: 'jpeg', quality: 80 });
    await page.click('#mg-ed [data-tab="Console"]');

    // ---- play in editor and back
    const camBefore = await page.evaluate(() => globalThis.__mirageEditor.world.camera.position.toArray());
    const hashBefore = (await state(page)).hash;
    await key(page, 'Enter', ['Control']);
    await page.waitForFunction('globalThis.__mirageEditor.mode === "play"', { timeout: 30000 }).catch(() => {});
    const playing = await page.evaluate(() => globalThis.__mirageEditor.mode);
    await sleep(600);
    if (playing === 'play') await page.screenshot({ path: join(outDir, name + '-play.jpg'), type: 'jpeg', quality: 80 });
    await page.keyboard.press('w'); await sleep(200);
    await key(page, 'Enter', ['Control']);
    await page.waitForFunction('globalThis.__mirageEditor.mode !== "play"', { timeout: 30000 }).catch(() => {});
    await settle(page);
    s = await state(page);
    const camAfter = await page.evaluate(() => globalThis.__mirageEditor.world.camera.position.toArray());
    ok(playing === 'play' && s.mode !== 'play', 'Ctrl+Enter plays the project\'s own play mode, and again stops it', playing + ' -> ' + s.mode);
    ok(s.hash === hashBefore && camAfter.every((v, i) => near(v, camBefore[i], 1e-4)) && s.errors.length === 0, 'after stop the plan, the camera and the objects are as before', s.errors.join('; '));

    // ---- shortcuts sheet, hierarchy, assets
    await key(page, '?', ['Shift']);
    ok(await page.$('.mg-sheet') !== null, '? shows the shortcut sheet');
    await page.screenshot({ path: join(outDir, name + '-keys.jpg'), type: 'jpeg', quality: 80 });
    await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.mg-sheet')?.remove());
    ok(await page.$$eval('#mg-ed .mg-item[data-id]', (r) => r.length) >= s.objects.length, 'the hierarchy lists the plan elements and the placed objects');
    await page.click('#mg-ed [data-tab="Assets"]'); await sleep(400);
    const assets = await page.$$eval('#mg-ed .mg-asset[data-asset]', (r) => r.map((e) => e.dataset.asset));
    ok(assets.some((a) => a.startsWith('model:')) && assets.some((a) => a.startsWith('vfx:')), 'the asset browser lists the project\'s models and the effect library', assets.length + ' assets');
    await page.click('#mg-ed [data-tab="Hierarchy"]');
    await page.evaluate((i) => globalThis.__mirageEditor.select(['obj:' + i]), id);
    await page.click('#mg-ed [data-tab="Inspector"]');
    // the picture for the guide: from the plan's first viewpoint, pulled back a little
    await page.evaluate(() => { const A = globalThis.__mirageEditor, v = A.doc.plan.viewpoints[0], c = A.world.camera; c.position.set(v.eye[0] + (v.eye[0] - v.look[0]) * 0.15, v.eye[1] + 0.6, v.eye[2] + (v.eye[2] - v.look[2]) * 0.15); c.lookAt(v.look[0], v.look[1], v.look[2]); c.updateMatrixWorld(true); A.vp.touch(); A.kick(3); });
    await settle(page);
    await page.screenshot({ path: join(outDir, name + '-editor.jpg'), type: 'jpeg', quality: 80 });

    // ---- undo for every edit: all the way back is the plan we opened, all the way forward is this one
    const s1 = await state(page), still1 = await still(page);
    N.steps = s1.history.done.length;
    for (let i = 0; i < s1.history.done.length; i++) await page.evaluate(() => globalThis.__mirageEditor.cmd.undo());
    await settle(page);
    s = await state(page);
    const stillU = await still(page), back = compare(still0, stillU);
    if (back.ssim <= 0.985) pair(name + '-FAIL-undo', still0, stillU);
    ok(s.hash === s0.hash && s.objects.length === 0, 'undoing all ' + N.steps + ' steps gives the first plan hash', s.hash);
    ok(back.ssim > 0.985, 'and the first picture', JSON.stringify(back));
    N.undoAll = back;
    for (let i = 0; i < s1.history.done.length; i++) await page.evaluate(() => globalThis.__mirageEditor.cmd.redo());
    await settle(page);
    s = await state(page);
    const stillR = await still(page), fwd = compare(still1, stillR);
    if (fwd.ssim <= 0.985) pair(name + '-FAIL-redo', still1, stillR);
    ok(s.hash === s1.hash && JSON.stringify(s.layer) === JSON.stringify(s1.layer), 'redoing them all gives the edited plan again', s.hash);
    ok(fwd.ssim > 0.985, 'and the edited picture', JSON.stringify(fwd));
    ok(compare(still0, still1).ssim < 0.999, 'the edit is visible in the still (the two pictures differ)', JSON.stringify(compare(still0, still1)));

    // ---- save, reload, compare
    await key(page, 's', ['Control']);
    await page.waitForFunction('!globalThis.__mirageEditor.doc.dirty', { timeout: 10000 }).catch(() => {});
    const disk = readFileSync(file, 'utf8');
    ok(disk === serializeLayer(s1.layer), 'Ctrl+S writes the layer to ' + name + '/plan.edits.json', disk.length + ' bytes');
    N.layerBytes = disk.length;
    await page.close();
    ({ page, ms } = await openEditor(browser, ed.url, errors));
    N.reopenMs = ms;
    const s2 = await state(page), still2 = await still(page), rt = compare(still1, still2);
    ok(s2.hash === s1.hash, 'after a reload the plan hash is the same', s1.hash + ' = ' + s2.hash);
    ok(JSON.stringify(s2.layer) === JSON.stringify(s1.layer) && s2.history.done.length === 0 && !s2.dirty, 'the layer is the same and nothing is pending');
    // 0.97, not 0.985: a reflection probe and a GI volume placed in the session only light the world once the
    // renderer is created with them, which is this reload (the editor says so when they are placed)
    ok(rt.ssim > 0.97, 'the still after the reload matches the one before', JSON.stringify(rt));
    N.roundTrip = rt;
    if (rt.ssim <= 0.97) pair(name + '-FAIL-reload', still1, still2);
    ok(s2.errors.length === 0, 'the reloaded world logs no error', s2.errors.join('; '));
    await page.close();

    // ---- the project without the editor builds the same edited world
    const plain = await browser.newPage();
    plain.on('pageerror', (e) => errors.push('plain pageerror: ' + String(e.message || e)));
    await plain.setViewport({ width: 960, height: 600 });
    await plain.goto(ed.url + '?editor=0&ui=0', { waitUntil: 'domcontentloaded' });
    await plain.waitForFunction('window.__READY === true', { timeout: 180000 });
    await sleep(1500);
    const { default: basePlan } = await import(join(root, 'plan.js'));
    const vp0 = applyEdits(basePlan, JSON.parse(disk)).viewpoints[0];
    const pl = await plain.evaluate(({ eye, look }, w, h) => {
      const M = window.__mirage, W = M.world, g = W.scene.getObjectByName('placed'), c = W.camera;
      M.play?.dispose?.();   // its loop would draw over the still
      W.resize(w, h); c.aspect = w / h; c.updateProjectionMatrix();
      c.position.fromArray(eye); c.lookAt(look[0], look[1], look[2]); c.updateMatrixWorld(true);
      W.renderFrame(0, { camera: c, spp: 4, frameIndex: 1 });
      return { editor: !!document.querySelector('#mg-ed'), placed: g ? g.children.length : 0, fov: c.fov, still: W.renderer.domElement.toDataURL('image/png') };
    }, vp0, still2.w, still2.h);
    ok(!pl.editor && pl.placed === s1.objects.length, 'without the editor (?editor=0) the page places the same ' + s1.objects.length + ' objects', pl.placed);
    const stillP = readPNG(pl.still), pc = compare(still2, stillP);
    if (pc.ssim <= 0.97) pair(name + '-FAIL-plain', still2, stillP);
    ok(pc.ssim > 0.97, 'and draws the same edited world from the same viewpoint', JSON.stringify(pc));
    N.plain = pc;
    await plain.close();

    ok(errors.length === 0, 'no page error, failed request or console error in the whole run', errors.slice(0, 6).join(' | '));
  } finally {
    if (original === null) writeFileSync(file, '{}\n'); else writeFileSync(file, original);
    await ed?.close();
  }
}

const browser = await launch({ w: 1440, h: 900 });
try { for (const name of examples) await run(name, browser); }
catch (err) { failed++; console.log('  FAIL  ' + (err?.stack || err)); }
finally { await browser.close(); }
console.log('\nnumbers ' + JSON.stringify(numbers));
console.log(failed ? `\neditor check: ${failed} FAILED` : '\neditor check: all passed' + (SHOTS ? ' (screenshots in docs/media/editor)' : ' (screenshots in ' + outDir + ')'));
process.exit(failed ? 1 : 0);

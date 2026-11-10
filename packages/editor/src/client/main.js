// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's client: injected into the project's own page by the dev server (server.mjs), it takes the live world
// the project handed over with editable().attach() and puts a viewport, panels and a command stack around it.
//
//   npx mirage-editor examples/hello-courtyard --write       # then open the printed URL
//   globalThis.__mirageEditor                                 // the app, for the browser check and the console:
//     .select(ids, { add })  .cmd.undo() / redo() / save() / duplicate() / remove() / play() / stop() / add(type)
//     .doc (document.js)  .vp (viewport.js)  .settled()  .still({ spp, view })  .hash()
//
// One rule holds the whole thing together: nothing edits the world directly. The gizmo, the inspector, paste, delete
// and the draw tool each make one doc.exec(label, changes); the listener below is the only code that moves an
// object, overrides a node, applies an environment value or rebuilds the modules. So undo is "write the old values
// back and let the same listener run", and what is saved is exactly what was shown.
// Item ids: "plan:<path>" (a plan entry), "obj:<id>" (a placed object), "node:<scene path>" (a built node).
// ---------------------------------------------------------------------------
import planSchema from '@mirage/world/plan.schema.json';
import { h, CSS } from './dom.js';
import { createViewport } from './viewport.js';
import { createPanels } from './panels.js';
import { createDocument } from '../document.js';
import { clone, getPath, setPath, joinPath, planHash, stableStringify } from '../layer.js';
import { OBJECT_TYPES, newObject, planElements, elementMoved, elementScaled } from '../schema.js';
import { createPlaced, applyNodeOverride, applyNodes, applyEnv, createTimelines, createTriggers, getPose, resolveNode } from '../runtime.js';

export const SHORTCUTS = [
  ['Viewport', [['Right drag', 'look around'], ['Right drag + W A S D Q E', 'fly (Shift: faster)'], ['Alt + drag / middle drag', 'orbit'], ['Shift + middle drag', 'pan'], ['Wheel', 'dolly'], ['F', 'focus the selection']]],
  ['Selection', [['Click', 'select'], ['Shift / Ctrl + click', 'add or remove'], ['Ctrl + A', 'select every placed object'], ['Esc', 'deselect, cancel a drawing, stop play']]],
  ['Transform', [['W', 'move'], ['E', 'rotate'], ['R', 'scale'], ['X', 'local / world axes'], ['N', 'snap to the grid steps'], ['B', 'snap to the surface below'], ['End', 'drop the selection to the surface'], ['G', 'show / hide the grid']]],
  ['Edit', [['Ctrl + Z', 'undo'], ['Ctrl + Shift + Z / Ctrl + Y', 'redo'], ['Ctrl + D', 'duplicate'], ['Ctrl + C / Ctrl + V', 'copy / paste'], ['Delete', 'delete'], ['Enter', 'finish a drawing']]],
  ['File', [['Ctrl + S', 'save the edit layer'], ['Ctrl + Enter', 'play / stop'], ['?', 'this sheet']]],
];

const E = globalThis.__MIRAGE_EDITOR__;
if (E && !globalThis.__mirageEditor) boot().catch((e) => { console.error('[editor] could not start:', e); globalThis.__mirageEditorError = String(e?.stack || e); });

// the project calls attach() once its world is built; a page that never does still gets a (smaller) editor
function waitHost() {
  return new Promise((done) => {
    const take = () => { const H = globalThis.__mirageEditorHost; if (H) { done(H); return true; } return false; };
    if (take()) return;
    addEventListener('mirage-editor-host', take, { once: true });
    const poll = setInterval(() => {
      if (globalThis.__mirageEditorHost) { clearInterval(poll); return; }
      const M = globalThis.__mirage;
      if (globalThis.__READY && M?.world && M.built?.plan) { clearInterval(poll); done({ world: M.world, built: M.built, play: M.play, base: M.built.plan, layer: E.layer, placed: null, bare: true }); }
    }, 200);
  });
}

async function boot() {
  const host = await waitHost(), { world } = host, { camera, scene } = world, worldCanvas = world.renderer.domElement;
  const canvasHome = { parent: worldCanvas.parentNode, next: worldCanvas.nextSibling };
  try { host.play?.dispose?.(); } catch (e) { console.warn('[editor] the page\'s own controls did not stop cleanly:', e); }
  const doc = createDocument(host.base, host.layer);
  const placed = host.placed || createPlaced(world, { resolve: host.resolve });
  if (!host.placed) { for (const [id, def] of Object.entries(doc.layer.objects)) placed.set(id, def); applyNodes(scene, doc.layer.nodes); applyEnv(world, doc.layer.env); }

  // ---- console
  const logs = [];
  let panels = null;
  const log = (level, text) => { logs.push({ level, text: String(text), at: new Date().toTimeString().slice(0, 8) }); if (logs.length > 400) logs.shift(); panels?.refresh('console'); };
  addEventListener('error', (e) => log('error', e.message + (e.filename ? '  (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')));
  addEventListener('unhandledrejection', (e) => log('error', 'unhandled: ' + (e.reason?.message || e.reason)));

  // ---- layout
  document.head.append(h('style', null, CSS));
  const view = h('div', { class: 'mg-view' }), hint = h('div', { class: 'mg-hint' });
  const top = h('div', { class: 'mg-top' }), left = h('div', { class: 'mg-pane' }), right = h('div', { class: 'mg-pane mg-right' }), bottom = h('div', { class: 'mg-pane mg-bottom' });
  const root = h('div', { id: 'mg-ed' }, top, left, view, right, bottom);
  document.body.append(root);
  view.append(hint);

  // ---- items
  let sel = [], elPlan = null, elCache = [];
  const elements = () => (elPlan === doc.plan ? elCache : (elPlan = doc.plan, elCache = planElements(doc.plan)));
  const pickRoots = new Set();
  const moduleRoots = (built) => (built?.report?.modules || []).flatMap((m) => [m.name, m.name + ':finalize']);
  const setRoots = () => { pickRoots.clear(); for (const n of moduleRoots(host.built)) pickRoots.add(n); };
  setRoots();
  function item(id) {
    if (typeof id !== 'string') return null;
    if (id.startsWith('obj:')) { const key = id.slice(4), def = doc.layer.objects[key]; return def ? { id, kind: 'obj', key, def, handle: placed.get(key), label: def.name || key } : null; }
    if (id.startsWith('node:')) { const key = id.slice(5), o = resolveNode(scene, key); return o ? { id, kind: 'node', key, handle: o, label: o.name || key } : null; }
    if (id.startsWith('plan:')) { const el = elements().find((e) => e.id === id); return el ? { id, kind: 'plan', key: el.path, el, value: getPath(doc.plan, el.path), handle: vp.handleOf(id), label: el.label } : null; }
    return null;
  }

  let pending = 4, idle = 0;   // frame-loop state, up here because the viewport kicks a frame while it is being made
  // ---- viewport
  const vp = createViewport({
    world, view, pickRoots,
    onPick(id, { add }) { if (!id) { if (!add) select([]); } else if (add) select(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]); else select([id]); },
    onDrawPoint(p) { if (!drawing) return; drawing.points.push(p.map((n) => +n.toFixed(3))); vp.setDraw(drawing.points); showHint(); },
    onTransformEnd(items, mode) {
      const changes = [];
      for (const t of items) {
        const it = item(t.id);
        if (!it) continue;
        if (it.kind === 'obj') changes.push({ section: 'objects', key: it.key, value: { ...it.def, ...getPose(t.handle) } });
        else if (it.kind === 'node') changes.push({ section: 'nodes', key: it.key, value: { ...(doc.layer.nodes[it.key] || {}), ...getPose(t.handle) } });
        else {
          const d = t.handle.position.clone().sub(t.from), s = t.handle.scale, k = it.el.kind;
          changes.push({ section: 'set', key: it.key, value: elementScaled(k, elementMoved(k, it.value, [d.x, d.y, d.z]), [s.x / (t.fromScale.x || 1), s.z / (t.fromScale.z || 1)]) });
        }
      }
      const verb = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[mode] || 'Transform';
      if (!exec(verb + ' ' + (items.length === 1 ? item(items[0].id)?.label ?? '' : items.length + ' items'), changes)) syncHelpers();
    },
    onChange: () => kick(1),
  });
  function syncHelpers() {
    vp.sync({
      plan: elements().map((e) => ({ id: e.id, kind: e.kind, value: getPath(doc.plan, e.path) })),
      objects: Object.entries(doc.layer.objects).map(([k, def]) => ({ id: 'obj:' + k, def, root: placed.get(k) })).filter((o) => o.root),
    });
    applySelection();
  }
  function applySelection() {
    sel = sel.filter((id) => item(id));
    vp.select(sel.map((id) => { const it = item(id); return { id, handle: it.handle, plan: it.kind === 'plan' }; }));
    kick(1);
  }
  function select(ids, { add = false } = {}) {
    ids = [].concat(ids || []).filter((id) => item(id));
    sel = add ? [...new Set([...sel, ...ids])] : [...new Set(ids)];
    applySelection(); panels.refresh('selection');
  }

  // ---- edits
  let quiet = false;   // true while the inspector itself is the source of an edit: it must not be rebuilt under the pointer
  function exec(label, changes, opts) {
    try { return doc.exec(label, changes, opts); } catch (e) { log('error', label + ': ' + e.message); return false; }
  }
  const execQuiet = (label, changes, opts) => { quiet = true; try { return exec(label, changes, opts); } finally { quiet = false; } };
  let timelines = {}, tlBusy = null;
  async function rebuildTimelines() {
    const mine = tlBusy = createTimelines(doc.plan, world, placed).catch((e) => { log('error', 'timelines: ' + e.message); return {}; });
    const out = await mine;
    if (tlBusy === mine) { timelines = out; panels.refresh('timeline'); }
  }
  doc.on((e) => {
    const of = (s) => e.changes.filter((c) => c.section === s);
    if (e.kind === 'saved') { panels.refresh('top'); return; }
    for (const c of of('objects')) { placed.set(c.key, c.after); if (c.after && OBJECT_TYPES[c.after.type]?.reload && !c.before) log('info', `${OBJECT_TYPES[c.after.type].label} "${c.key}": the renderer reads plan.lighting when it is created, so it shows after Save and Reload.`); }
    for (const c of of('nodes')) { const o = resolveNode(scene, c.key); if (o) applyNodeOverride(o, c.after); }
    if (of('env').length) applyEnv(world, doc.layer.env, of('env').map((c) => c.key)).then(() => kick(3), (err) => log('error', 'environment: ' + err.message));
    if (of('set').length) scheduleRebuild();
    if (of('objects').length || of('timelines').length) rebuildTimelines();
    if (of('objects').some((c) => c.after?.type === 'model' || c.after?.type === 'vfx')) placed.ready().then(() => { syncHelpers(); kick(3); });
    world.lighting?.invalidate?.();
    syncHelpers();
    panels.refresh(quiet ? 'quiet' : 'all');
    kick(3);
  });

  // ---- rebuild in place: a plan edit runs the project's modules again on the edited plan
  let building = null, again = false, gen = 0, rebuildTimer = 0, lintSeq = 0;
  function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { rebuildTimer = 0; rebuild(); }, 220); }
  function rebuild() {
    if (!host.rebuild) { if (!rebuild.told) { rebuild.told = true; log('info', 'This page gave the editor no rebuild hook (attach({ rebuild })): plan edits show after Save and Reload.'); } lint(); return Promise.resolve(); }
    if (building) { again = true; return building; }
    building = (async () => {
      do {
        again = false;
        const my = ++gen, t0 = performance.now();
        try {
          const opts = host.rebuild(doc.plan);
          for (const name of moduleRoots(host.built)) for (const o of scene.children.filter((c) => c.name === name)) { scene.remove(o); o.traverse((n) => n.geometry?.dispose?.()); }
          // the modules register their per-frame callbacks on the world: the ones of a replaced build go quiet
          const proxy = Object.create(world);
          proxy.ctx = { ...world.ctx, onUpdate: (fn) => world.ctx.onUpdate((t) => my === gen && fn(t)) };
          const { buildWorld } = await import('@mirage/world');
          host.built = await buildWorld(proxy, opts);
          setRoots();
          const missing = applyNodes(scene, doc.layer.nodes);
          if (missing.length) log('warning', 'node overrides without a node after the rebuild: ' + missing.join(', '));
          world.lighting?.invalidate?.();
          log('info', `rebuilt ${host.built.report.modules.length} modules in ${Math.round(performance.now() - t0)} ms` + (host.built.report.failed.length ? `, ${host.built.report.failed.length} failed` : ''));
        } catch (err) { log('error', 'rebuild: ' + (err?.message || err)); }
      } while (again);
      building = null;
      await rebuildTimelines();
      syncHelpers(); panels.refresh('all'); lint(); kick(4);
    })();
    return building;
  }
  const jsonPlan = () => JSON.parse(stableStringify(doc.plan));
  async function post(path, body) {
    const r = await fetch('/__editor/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mirage-Editor-Token': E.token }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || 'HTTP ' + r.status);
    return out;
  }
  let diagnostics = [];
  async function lint() {
    const my = ++lintSeq, R = host.built?.report;
    try {
      const out = await post('lint', { plan: jsonPlan(), report: R ? { plan: R.plan, modules: R.modules, failed: (R.failed || []).map((f) => ({ name: f.name, phase: f.phase, error: String(f.error?.message || f.error) })) } : undefined, errors: [] });
      if (my !== lintSeq) return;
      diagnostics = out.diagnostics || [];
      panels.refresh('console');
    } catch (err) { log('warning', 'diagnostics: ' + err.message); }
  }

  // ---- commands
  let drawing = null, clipboard = [], animate = false, mode = 'edit', playing = null, triggers = null, camSnap = null, T = 0;
  const G = vp.gizmo;
  const viewCentre = () => { const r = view.getBoundingClientRect(); return vp.groundPoint(r.left + r.width / 2, r.top + r.height * 0.6) || [0, 0, 0]; };
  const freeKey = (group, name) => { let k = name, i = 1; while (getPath(doc.plan, joinPath([group, k])) !== undefined) k = name + '-' + (++i); return k; };
  const showHint = () => { hint.textContent = drawing ? `Drawing a ${drawing.kind}: click to add points (${drawing.points.length}), Enter to finish, Esc to cancel` : ''; hint.style.display = drawing ? '' : 'none'; };
  // pasted entries: placed objects get a new id, plan entries a new key in their group; both are nudged aside
  function pasteItems(list, label, offset = 0.5) {
    const changes = [], ids = [];
    for (const c of list) {
      if (c.kind === 'obj') { let id = c.key, i = 1; while (doc.layer.objects[id] || changes.some((x) => x.key === id)) id = c.key.replace(/-\d+$/, '') + '-' + (++i); const p = c.def.position || [0, 0, 0]; changes.push({ section: 'objects', key: id, value: { ...clone(c.def), position: [p[0] + offset, p[1], p[2] + offset] } }); ids.push('obj:' + id); }
      else if (c.kind === 'plan' && c.group !== 'viewpoints' && c.group !== 'views') { const key = freeKey(c.group, c.name), path = joinPath([c.group, key]); changes.push({ section: 'set', key: path, value: elementMoved(c.el, c.value, [offset, 0, offset]) }); ids.push('plan:' + path); }
    }
    if (!changes.length) return false;
    exec(label, changes); select(ids);
    return true;
  }
  const grab = () => sel.map((id) => { const it = item(id); return it?.kind === 'obj' ? { kind: 'obj', key: it.key, def: clone(it.def) } : it?.kind === 'plan' ? { kind: 'plan', group: it.el.group, name: it.el.label, el: it.el.kind, value: clone(it.value) } : null; }).filter(Boolean);
  const cmd = {
    undo() { if (!doc.undo()) log('info', 'nothing to undo'); }, redo() { if (!doc.redo()) log('info', 'nothing to redo'); },
    setMode(m) { G.mode = m; vp.applyGizmo(); panels.refresh('top'); },
    toggleSpace() { G.space = G.space === 'world' ? 'local' : 'world'; vp.applyGizmo(); panels.refresh('top'); },
    toggleSnap() { G.snap = !G.snap; vp.applyGizmo(); panels.refresh('top'); },
    toggleSurface() { G.surface = !G.surface; panels.refresh('top'); },
    toggleGrid() { vp.gridVisible = !vp.gridVisible; panels.refresh('top'); },
    toggleAnimate() { animate = !animate; panels.refresh('top'); kick(2); },
    focus() { const hs = sel.map((id) => item(id)?.handle).filter(Boolean); if (hs.length) { vp.focus(hs); kick(3); } },
    selectAll() { select(Object.keys(doc.layer.objects).map((k) => 'obj:' + k)); },
    /** Place a new object of a type at a point (default: where the middle of the view meets the world). */
    add(type, extra = {}, at) {
      const T0 = OBJECT_TYPES[type];
      if (!T0) { log('error', 'no object type "' + type + '"'); return null; }
      const p = [...(at || viewCentre())], def = newObject(type, p, extra);
      if (T0.volume) def.position[1] = +(p[1] + def.scale[1] / 2).toFixed(4);
      else if (type === 'primitive' && def.shape !== 'plane') def.position[1] = +(p[1] + 0.5).toFixed(4);
      else if (type === 'light') def.position[1] = +(p[1] + 2).toFixed(4);
      else if (type === 'plane') def.position[1] = +(p[1] + 0.01).toFixed(4);
      const id = doc.newId(type);
      if (!exec('Add ' + T0.label.toLowerCase(), [{ section: 'objects', key: id, value: def }])) return null;
      select(['obj:' + id]);
      return id;
    },
    addViewpoint() {
      const n = (doc.plan.viewpoints || []).length, d = camera.getWorldDirection(camera.position.clone().set(0, 0, 0)), r = (v) => +v.toFixed(3);
      const eye = camera.position.toArray().map(r), look = [r(eye[0] + d.x * 6), r(eye[1] + d.y * 6), r(eye[2] + d.z * 6)];
      if (exec('Add viewpoint', [{ section: 'set', key: 'viewpoints[' + n + ']', value: { name: 'view-' + (n + 1), eye, look } }])) select(['plan:viewpoints[' + n + ']']);
    },
    remove() {
      const changes = [];
      for (const id of sel) {
        const it = item(id);
        if (it.kind === 'obj') changes.push({ section: 'objects', key: it.key, value: undefined });
        else if (it.kind === 'node') changes.push({ section: 'nodes', key: it.key, value: { ...(doc.layer.nodes[it.key] || {}), visible: false } });
        else if (getPath(doc.base, it.key) !== undefined || (it.el.group === 'viewpoints' && it.key !== 'viewpoints[' + ((doc.plan.viewpoints || []).length - 1) + ']')) log('warning', `"${it.key}" is part of the plan file (or not the last viewpoint): the modules read it, so the editor does not delete it. Edit the plan to remove it.`);
        else changes.push({ section: 'set', key: it.key, value: undefined });
      }
      if (changes.length && exec('Delete ' + (changes.length === 1 ? item(sel[0])?.label ?? 'item' : changes.length + ' items'), changes)) panels.refresh('selection');
    },
    copy() { clipboard = grab(); if (clipboard.length) log('info', 'copied ' + clipboard.length + ' item(s)'); },
    paste() { if (!pasteItems(clipboard, 'Paste')) log('info', 'nothing to paste (placed objects, points, shapes and paths can be copied)'); },
    duplicate() { if (!pasteItems(grab(), 'Duplicate')) log('info', 'select placed objects, points, shapes or paths to duplicate'); },
    dropToSurface() {
      const skip = new Set(sel), changes = [];
      for (const id of sel) { const it = item(id); if (it?.kind !== 'obj') continue; const y = vp.dropY(it.handle.getWorldPosition(camera.position.clone()), skip); if (y !== null) changes.push({ section: 'objects', key: it.key, value: { ...it.def, position: [it.def.position[0], +y.toFixed(4), it.def.position[2]] } }); }
      if (changes.length) exec('Drop to surface', changes);
    },
    draw(kind) { if (!['wall', 'path', 'region'].includes(kind)) return; drawing = { kind, points: [] }; select([]); vp.setDraw([]); showHint(); },
    cancelDraw() { drawing = null; vp.setDraw(null); showHint(); },
    finishDraw() {
      if (!drawing) return;
      const { kind, points } = drawing, xz = points.map((p) => [p[0], p[2]]), y = points.length ? +Math.min(...points.map((p) => p[1])).toFixed(3) : 0;
      if (points.length < (kind === 'region' ? 3 : 2)) { log('warning', `a ${kind} needs ${kind === 'region' ? 3 : 2} points`); return; }
      cmd.cancelDraw();
      if (kind === 'wall') { const id = doc.newId('wall'); if (exec('Draw wall', [{ section: 'objects', key: id, value: newObject('wall', [0, y, 0], { points: xz }) }])) select(['obj:' + id]); return; }
      const group = kind === 'path' ? 'paths' : 'regions', path = joinPath([group, freeKey(group, 'drawn')]);
      if (exec('Draw ' + kind, [{ section: 'set', key: path, value: kind === 'path' ? { points: xz, ...(y ? { y } : {}) } : { poly: xz, ...(y ? { y } : {}) } }])) select(['plan:' + path]);
    },
    async save() {
      try { const out = await post('save', { layer: JSON.parse(doc.serialize()) }); doc.markSaved(); log('info', out.where === 'disk' ? `saved ${out.file} (${out.bytes} bytes), plan ${doc.hash()}` : `saved in the server's memory only (${out.bytes} bytes): start mirage-editor with --write to write ${out.file}`); return out; }
      catch (err) { log('error', 'save: ' + err.message); return null; }
    },
    async reload() { if (await cmd.save()) location.reload(); },
    play, stop,
    sheet() { const old = document.querySelector('.mg-sheet'); if (old) return old.remove(); const s = h('div', { class: 'mg-sheet', onclick: () => s.remove() }, h('div', null, h('h3', null, 'Keyboard and mouse'), SHORTCUTS.map(([name, rows]) => [h('div', { class: 'mg-head', style: { padding: '8px 0 2px' } }, name), rows.map(([k, what]) => h('p', null, h('span', null, what), h('kbd', null, k)))]))); document.body.append(s); },
  };

  // ---- play in the editor: the project's own createPlay on the edited world, and back
  async function play() {
    if (mode !== 'edit') return false;
    if (!host.makePlay) { log('warning', 'This page gave the editor no makePlay hook (attach({ makePlay })): it cannot start play mode here.'); return false; }
    if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = 0; rebuild(); }
    await building;
    cmd.cancelDraw();
    camSnap = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov, near: camera.near, far: camera.far };
    mode = 'play'; root.dataset.play = '1'; vp.enabled = false;
    document.body.insertBefore(worldCanvas, root);
    worldCanvas.style.width = innerWidth + 'px'; worldCanvas.style.height = innerHeight + 'px';
    world.resize(innerWidth, innerHeight);
    triggers = createTriggers(doc.plan, { onEnter: (t) => log('info', 'trigger enter: ' + t.event), onLeave: (t) => log('info', 'trigger leave: ' + t.event) });
    try { playing = host.makePlay({ plan: host.built.plan }); }
    catch (err) { log('error', 'play: ' + (err?.message || err)); playing = null; stop(); return false; }
    document.body.append(h('button', { id: 'mg-stop', onclick: () => stop(), title: 'Ctrl + Enter' }, '■ Stop (Ctrl + Enter)'));
    return true;
  }
  function stop() {
    if (mode !== 'play') return false;
    try { playing?.dispose?.(); } catch (err) { log('error', 'stop: ' + (err?.message || err)); }
    playing = null; triggers = null;
    document.exitPointerLock?.();
    document.getElementById('mg-stop')?.remove();
    view.prepend(worldCanvas);
    delete root.dataset.play; vp.enabled = true; vp.resize(true);
    // what play moved goes back to what the document says
    if (camSnap) { camera.position.copy(camSnap.p); camera.quaternion.copy(camSnap.q); camera.fov = camSnap.fov; camera.near = camSnap.near; camera.far = camSnap.far; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); }
    for (const [id, def] of Object.entries(doc.layer.objects)) placed.set(id, def);
    applyNodes(scene, doc.layer.nodes);
    applyEnv(world, doc.layer.env).then(() => kick(4));
    for (const t of Object.values(timelines)) t.stop().seek(0);
    mode = 'edit'; last = performance.now();
    applySelection(); panels.refresh('all'); kick(4);
    return true;
  }

  // ---- keys
  addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const run = (fn) => { e.preventDefault(); fn(); };
    if (ctrl && k === 'Enter') return run(() => (mode === 'play' ? stop() : play()));
    if (mode !== 'edit') { if (k === 'Escape' && !document.pointerLockElement) run(stop); return; }
    if (ctrl && k === 's') return run(cmd.save);
    if (typing) return;
    if (ctrl && k === 'z') return run(e.shiftKey ? cmd.redo : cmd.undo);
    if (ctrl && k === 'y') return run(cmd.redo);
    if (ctrl && k === 'd') return run(cmd.duplicate);
    if (ctrl && k === 'c') return run(cmd.copy);
    if (ctrl && k === 'v') return run(cmd.paste);
    if (ctrl && k === 'a') return run(cmd.selectAll);
    if (ctrl || e.altKey) return;
    const plain = { w: () => cmd.setMode('translate'), e: () => cmd.setMode('rotate'), r: () => cmd.setMode('scale'), x: cmd.toggleSpace, n: cmd.toggleSnap, b: cmd.toggleSurface, g: cmd.toggleGrid, f: cmd.focus,
      Delete: cmd.remove, Backspace: cmd.remove, End: cmd.dropToSurface, '?': cmd.sheet, Enter: () => drawing && cmd.finishDraw(),
      Escape: () => { if (document.querySelector('.mg-sheet')) cmd.sheet(); else if (drawing) cmd.cancelDraw(); else select([]); } }[k];
    if (plain) run(plain);
  });
  addEventListener('beforeunload', (e) => { if (doc.dirty && !globalThis.__mirageEditorNoPrompt) { e.preventDefault(); e.returnValue = ''; } });

  // ---- the frame: the world is drawn only when something changed, then once more as a clean still
  const info = world.renderer.info, stats = { calls: 0, triangles: 0, ms: 0, fps: 0, frames: 0 };
  let last = performance.now(), fpsAt = last, fpsN = 0;
  function kick(n = 2) { pending = Math.max(pending, n); idle = 0; }
  function draw(opts) {
    const keep = info.autoReset, t0 = performance.now();
    info.autoReset = false; info.reset();
    try { world.renderFrame(T, opts); } finally { stats.calls = info.render.calls; stats.triangles = info.render.triangles; info.autoReset = keep; }
    stats.ms = stats.ms ? stats.ms * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0;
    stats.frames++;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (mode === 'play') { triggers?.update(camera.position.toArray()); return; }
    if (vp.resize()) kick(3);
    const moved = vp.update(dt);
    let ran = false;
    for (const t of Object.values(timelines)) if (t.playing) { t.update(dt); ran = true; }
    if (animate) T += dt;
    const busy = world.tick(dt);
    if (moved || busy || animate || ran || vp.dragging) kick(2);
    if (ran) panels.refresh('playhead');
    if (pending > 0 && !building) {
      pending--;
      // moving frames are single-sample with temporal AA; the last one of a run is a multi-sample still
      draw(pending === 0 && !animate ? { camera, spp: 4 } : { camera, taa: true });
      vp.invalidate();
      fpsN++;
    } else idle++;
    if (now - fpsAt > 500) { stats.fps = Math.round(fpsN * 1000 / (now - fpsAt)); fpsAt = now; fpsN = 0; panels.stats(stats, { building: !!building, dirty: doc.dirty }); }
    if (vp.dirty) vp.render();
  }

  // ---- for the check, and for a console
  const app = globalThis.__mirageEditor = {
    host, world, doc, vp, placed, cmd, log, item, elements, schema: planSchema, boot: E, stats,
    get selection() { return [...sel]; }, get mode() { return mode; }, get logs() { return logs; }, get diagnostics() { return diagnostics; },
    get timelines() { return timelines; }, get drawing() { return drawing; }, get animate() { return animate; }, get building() { return !!building || !!rebuildTimer; },
    select, exec, execQuiet, kick, rebuild, rebuildTimelines, viewCentre, post,
    handle: (id) => item(id)?.handle || null,
    hash: () => doc.hash(), jsonPlan,
    /** every queued rebuild, model load and environment change has landed, and the last still is on screen */
    async settled() {
      for (let i = 0; i < 400; i++) {
        if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = 0; rebuild(); }
        if (building) await building;
        await placed.ready(); await tlBusy;
        if (!building && !rebuildTimer && pending === 0 && idle > 1 && !world.lighting?.busy) return true;
        await new Promise((r) => setTimeout(r, 30));
      }
      return false;
    },
    /** A still of the world alone (no overlay) as a PNG data URL, optionally from a plan viewpoint so that two
     *  sessions can be compared whatever their editor cameras were doing. */
    still({ spp = 4, view: v = null } = {}) {
      const keep = { p: camera.position.clone(), q: camera.quaternion.clone() };
      const vpnt = v === null ? null : (doc.plan.viewpoints || [])[v];
      if (vpnt) { camera.position.fromArray(vpnt.eye); camera.lookAt(vpnt.look[0], vpnt.look[1], vpnt.look[2]); camera.updateMatrixWorld(true); }
      world.renderFrame(0, { camera, spp, frameIndex: 1 });
      const url = worldCanvas.toDataURL('image/png');
      camera.position.copy(keep.p); camera.quaternion.copy(keep.q); camera.updateMatrixWorld(true);
      kick(3);
      return url;
    },
  };
  panels = createPanels(app, { top, left, right, bottom, schema: planSchema, canvasHome });

  // the page's own camera pose is whatever its controls left: start from the plan's first view
  const v0 = (doc.plan.viewpoints || [])[0] || doc.plan.spawn;
  if (v0?.eye && v0?.look) { camera.position.fromArray(v0.eye); camera.lookAt(v0.look[0], v0.look[1], v0.look[2]); camera.updateMatrixWorld(true); }
  showHint(); syncHelpers(); vp.applyGizmo();
  await rebuildTimelines();
  panels.refresh('all');
  log('info', `${E.name}: editing ${E.layerFile} (${E.write ? 'Save writes the file' : 'read-only server: Save keeps the layer in memory'}). Press ? for the keys.`);
  if (host.bare) log('warning', 'This page does not call editable().attach(): objects can be placed and saved, but plan edits and play mode need the three lines in docs/editor.md.');
  lint();
  requestAnimationFrame(frame);
  app.ready = true;
}

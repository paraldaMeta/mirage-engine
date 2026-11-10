// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's panels: toolbar, hierarchy, inspector, asset browser, world settings, console, timeline, animator
// viewer and history. They read the app (main.js) and change the world only through app.exec / app.cmd.
//
//   const panels = createPanels(app, { top, left, right, bottom, schema });
//   panels.refresh('all' | 'quiet' | 'selection' | 'console' | 'top' | 'timeline' | 'playhead');
//   panels.stats(stats, { building, dirty });
//
// 'quiet' is an edit that came from the inspector itself: everything but the inspector is redrawn, because
// replacing the input under the pointer would end the drag that is making the edit.
// Every control carries a data- attribute (data-cmd, data-id, data-field, data-tab) so the browser check drives the
// same elements a person does.
// ---------------------------------------------------------------------------
import { h, clear, fieldRow, tabs } from './dom.js';
import { clone, getPath, setPath } from '../layer.js';
import { OBJECT_TYPES, objectFields, schemaAt, fieldsFromSchema } from '../schema.js';
import { getPose, nodePath, nodeMaterial } from '../runtime.js';

const GROUPS = { points: 'Points', footprints: 'Footprints', regions: 'Regions', paths: 'Paths', viewpoints: 'Viewpoints', views: 'Views' };
const POSE_FIELDS = [{ key: 'position', step: 0.05 }, { key: 'rotation', step: 1, unit: '°' }, { key: 'scale', step: 0.05 }].map((f) => ({ ...f, path: f.key, label: f.key, type: 'vector', labels: ['x', 'y', 'z'] }));
const SIMPLE = new Set(['number', 'string', 'enum', 'bool', 'color', 'vector']);
const hhmm = (hrs) => String(Math.floor(hrs)).padStart(2, '0') + ':' + String(Math.round((hrs % 1) * 60)).padStart(2, '0');

export function createPanels(app, { top, left, right, bottom, schema }) {
  const { doc, cmd, world, vp } = app, { scene } = world;
  const btn = (label, name, fn, title) => h('button', { class: 'mg-btn', 'data-cmd': name, title: title || label, onclick: (e) => { e.currentTarget.blur(); fn(); } }, label);
  const note = (text) => h('div', { class: 'mg-note' }, text);
  const head = (text, ...kids) => h('div', { class: 'mg-head' }, text, kids);

  // ---- toolbar
  const B = {};
  const addMenu = h('select', { class: 'mg-in', 'data-cmd': 'add', style: { width: '92px' }, title: 'Place a new object where the middle of the view meets the world' },
    h('option', { value: '' }, '+ Add…'), Object.entries(OBJECT_TYPES).map(([k, T]) => h('option', { value: k }, T.label)), h('option', { value: '@view' }, 'Viewpoint (from camera)'));
  addMenu.addEventListener('change', () => { const v = addMenu.value; addMenu.value = ''; addMenu.blur(); if (v === '@view') cmd.addViewpoint(); else if (v) cmd.add(v); });
  const drawMenu = h('select', { class: 'mg-in', 'data-cmd': 'draw', style: { width: '80px' }, title: 'Click points in the view; Enter finishes' },
    h('option', { value: '' }, '✎ Draw…'), ['wall', 'path', 'region'].map((k) => h('option', { value: k }, k)));
  drawMenu.addEventListener('change', () => { const v = drawMenu.value; drawMenu.value = ''; drawMenu.blur(); if (v) cmd.draw(v); });
  const title = h('b', null, 'Mirage · ' + app.boot.name);
  top.append(title,
    B.translate = btn('Move', 'translate', () => cmd.setMode('translate'), 'Move (W)'), B.rotate = btn('Rotate', 'rotate', () => cmd.setMode('rotate'), 'Rotate (E)'), B.scale = btn('Scale', 'scale', () => cmd.setMode('scale'), 'Scale (R)'),
    h('div', { class: 'mg-sep' }),
    B.space = btn('World', 'space', cmd.toggleSpace, 'Local / world axes (X)'), B.snap = btn('Snap', 'snap', cmd.toggleSnap, 'Snap to the grid steps (N)'), B.surface = btn('Surface', 'surface', cmd.toggleSurface, 'Snap to the surface below (B)'), B.grid = btn('Grid', 'grid', cmd.toggleGrid, 'Grid (G)'),
    h('div', { class: 'mg-sep' }),
    B.undo = btn('↶', 'undo', cmd.undo, 'Undo (Ctrl+Z)'), B.redo = btn('↷', 'redo', cmd.redo, 'Redo (Ctrl+Shift+Z)'),
    h('div', { class: 'mg-sep' }), addMenu, drawMenu,
    h('div', { class: 'mg-sep' }),
    B.animate = btn('Animate', 'animate', cmd.toggleAnimate, 'Let the world\'s own motion run in the editor'), B.play = btn('▶ Play', 'play', cmd.play, 'Play in the editor (Ctrl+Enter)'),
    h('div', { class: 'mg-grow' }),
    B.save = btn('Save', 'save', cmd.save, 'Save the edit layer (Ctrl+S)'), btn('Save + Reload', 'reload', cmd.reload, 'Save, then load the page again from the saved layer'), btn('?', 'sheet', cmd.sheet, 'Keyboard and mouse'));
  function drawTop() {
    const G = vp.gizmo;
    for (const m of ['translate', 'rotate', 'scale']) B[m].toggleAttribute('data-on', G.mode === m);
    B.space.textContent = G.space === 'world' ? 'World' : 'Local';
    B.snap.toggleAttribute('data-on', !!G.snap); B.surface.toggleAttribute('data-on', !!G.surface); B.grid.toggleAttribute('data-on', !!vp.gridVisible); B.animate.toggleAttribute('data-on', app.animate);
    B.undo.disabled = !doc.canUndo; B.redo.disabled = !doc.canRedo;
    B.save.textContent = doc.dirty ? 'Save ●' : 'Save';
  }

  // ---- hierarchy
  const open = new Set(['@plan', '@placed']);
  const pick = (id) => (e) => { const s = app.selection, add = e.shiftKey || e.ctrlKey || e.metaKey; app.select(add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]); };
  const row = (id, label, depth, small, { twist, off } = {}) => h('div', { class: 'mg-item', 'data-id': id, 'data-sel': app.selection.includes(id), 'data-off': off, style: { paddingLeft: 6 + depth * 12 + 'px' }, onclick: pick(id), ondblclick: () => { app.select([id]); cmd.focus(); } },
    twist || h('span', { class: 'mg-tw' }), h('span', null, label), small ? h('small', null, small) : null);
  const twist = (key, has, redraw) => h('span', { class: 'mg-tw', onclick: (e) => { e.stopPropagation(); if (open.has(key)) open.delete(key); else open.add(key); redraw(); } }, has ? (open.has(key) ? '▾' : '▸') : '');
  const section = (key, label, count, redraw) => h('div', { class: 'mg-item', style: { paddingLeft: '6px', color: '#8f959c' }, onclick: () => { if (open.has(key)) open.delete(key); else open.add(key); redraw(); } }, h('span', { class: 'mg-tw' }, open.has(key) ? '▾' : '▸'), label, h('small', null, count));
  function hierarchy(body) {
    const redraw = () => { const y = body.scrollTop; clear(body); hierarchy(body); body.scrollTop = y; };
    const els = app.elements(), objs = Object.entries(doc.layer.objects);
    body.append(section('@plan', 'Plan · ' + (doc.plan.name || 'plan'), els.length, redraw));
    if (open.has('@plan')) for (const g of Object.keys(GROUPS)) {
      const list = els.filter((e) => e.group === g);
      if (!list.length) continue;
      body.append(h('div', { class: 'mg-head', style: { paddingLeft: '18px' } }, GROUPS[g]));
      for (const e of list) body.append(row(e.id, e.label, 1.5, e.kind));
    }
    body.append(section('@placed', 'Placed objects', objs.length, redraw));
    if (open.has('@placed')) {
      for (const [k, def] of objs) body.append(row('obj:' + k, def.name || k, 1, OBJECT_TYPES[def.type]?.label || def.type));
      if (!objs.length) body.append(note('Nothing placed yet: use + Add, or click an asset.'));
    }
    const roots = scene.children.filter((c) => vpRoots().has(c.name));
    body.append(section('@scene', 'Scene graph', roots.length, redraw));
    if (open.has('@scene')) {
      const walk = (o, depth) => {
        const id = 'node:' + nodePath(o, scene), kids = o.children.length;
        body.append(row(id, o.name || o.type, depth, o.isMesh ? 'mesh' : kids ? String(kids) : '', { twist: twist(id, kids, redraw), off: !o.visible }));
        if (open.has(id)) for (const c of o.children.slice(0, 400)) walk(c, depth + 1);
      };
      for (const r of roots) walk(r, 1);
    }
  }
  const vpRoots = () => new Set((app.host.built?.report?.modules || []).flatMap((m) => [m.name, m.name + ':finalize']));

  // ---- inspector
  let assets = { models: [], textures: [], audio: [] }, vfxNames = [];
  const ctx = { assets: (kind) => (kind === 'vfx' ? vfxNames : (assets[{ model: 'models', texture: 'textures', audio: 'audio' }[kind]] || []).map((a) => a.url)) };
  // a change that alters which fields exist (a light's kind, a shape) redraws the inspector; a scrub must not
  const structural = (f) => f.type === 'enum' || f.type === 'bool' || f.type === 'asset' || f.type === 'json' || f.type === 'points';
  const commit = (f, label, change) => (next, o = {}) => { app.execQuiet(label, [change(next)], { merge: o.merge }); if (structural(f) && !o.merge) R.current === 'Inspector' && R.show('Inspector'); };
  function inspector(body) {
    const sel = app.selection, it = sel.length ? app.item(sel[sel.length - 1]) : null;
    if (sel.length > 1) body.append(note(sel.length + ' items selected. The gizmo moves them together; the fields below edit the last one picked.'));
    if (!it) {
      body.append(head('Plan'), note('Nothing selected. Click something in the view or the hierarchy; these are the plan\'s own top-level values.'));
      for (const f of fieldsFromSchema(schema, schema, doc.plan).filter((f) => SIMPLE.has(f.type) && !f.path.includes('.') && !f.readonly && Object.hasOwn(doc.plan, f.path)))
        body.append(fieldRow(f, doc.plan[f.path], commit(f, 'Edit ' + f.path, (v) => ({ section: 'set', key: f.path, value: v })), ctx));
      return;
    }
    if (it.kind === 'obj') {
      const T = OBJECT_TYPES[it.def.type], now = () => doc.layer.objects[it.key] || it.def;
      body.append(head((T?.label || it.def.type) + ' · ' + it.key));
      for (const f of objectFields(it.def)) body.append(fieldRow(f, it.def[f.key], commit(f, 'Edit ' + f.key, (v) => { const d = { ...now() }; if (v === undefined) delete d[f.key]; else d[f.key] = v; return { section: 'objects', key: it.key, value: d }; }), ctx));
      if (T?.reload) body.append(note('The renderer reads this when it is created: it shows after Save + Reload.'));
      if (T?.volume) body.append(note('A volume: its size is the scale, in metres. The engine reads it axis-aligned.'));
      return;
    }
    if (it.kind === 'node') {
      const o = it.handle, ov = () => doc.layer.nodes[it.key] || {}, pose = getPose(o), mat = nodeMaterial(o);
      body.append(head('Node · ' + (o.name || o.type)), note(it.key + (doc.layer.nodes[it.key] ? '  (overridden)' : '')));
      for (const f of POSE_FIELDS) body.append(fieldRow(f, pose[f.key], commit(f, 'Edit ' + f.key, (v) => ({ section: 'nodes', key: it.key, value: { ...ov(), ...getPose(o), [f.key]: v } })), ctx));
      const fv = { path: 'visible', label: 'visible', type: 'bool' };
      body.append(fieldRow(fv, o.visible, commit(fv, 'Edit visible', (v) => ({ section: 'nodes', key: it.key, value: { ...ov(), visible: v } })), ctx));
      if (mat) {
        body.append(head('Material'));
        for (const [k, v] of Object.entries(mat)) {
          const f = typeof v === 'string' ? { type: 'color' } : { type: 'number', min: 0, max: k === 'emissiveIntensity' || k === 'envMapIntensity' ? 50 : 1, step: 0.01 };
          Object.assign(f, { path: 'material.' + k, label: k });
          body.append(fieldRow(f, v, commit(f, 'Edit ' + k, (x) => ({ section: 'nodes', key: it.key, value: { ...ov(), material: { ...(ov().material || {}), [k]: x } } })), ctx));
        }
        body.append(note('Overrides this node\'s material values. A material shared by several nodes changes for all of them.'));
      }
      body.append(h('div', { class: 'mg-row' }, h('label', null, ''), btn('Reset to built', 'node-reset', () => app.exec('Reset node', [{ section: 'nodes', key: it.key, value: undefined }]))));
      return;
    }
    const value = it.value, node = schemaAt(schema, it.key);
    body.append(head(it.el.kind + ' · ' + it.key));
    for (const f of fieldsFromSchema(schema, node, value))
      body.append(fieldRow(f, f.path === '' ? value : getPath(value, f.path), commit(f, 'Edit ' + it.key, (v) => { const cur = getPath(doc.plan, it.key); return { section: 'set', key: it.key, value: f.path === '' ? v : setPath(clone(cur), f.path, v) }; }), ctx));
    if (it.el.kind === 'view') {
      const cam = world.camera, r = (n) => +n.toFixed(3);
      body.append(h('div', { class: 'mg-row' }, h('label', null, ''), h('div', { class: 'mg-col' },
        btn('Look through', 'view-look', () => { cam.position.fromArray(value.eye); cam.lookAt(value.look[0], value.look[1], value.look[2]); cam.updateMatrixWorld(true); vp.touch(); app.kick(3); }),
        btn('Set from camera', 'view-set', () => { const d = cam.getWorldDirection(cam.position.clone()), e = cam.position.toArray().map(r); app.exec('Set view from camera', [{ section: 'set', key: it.key, value: { ...value, eye: e, look: [r(e[0] + d.x * 6), r(e[1] + d.y * 6), r(e[2] + d.z * 6)] } }]); }))));
    }
    if (getPath(doc.base, it.key) !== undefined && Object.hasOwn(doc.layer.set, it.key)) body.append(h('div', { class: 'mg-row' }, h('label', null, ''), btn('Reset to plan file', 'plan-reset', () => app.exec('Reset ' + it.key, [{ section: 'set', key: it.key, value: undefined }]))));
    body.append(note('A plan entry: the project\'s modules read it, so the world is rebuilt after an edit.'));
  }

  // ---- world: time, weather, post, lighting
  function worldTab(body) {
    const env = doc.layer.env;
    const set = (key, f) => commit(f, 'Set ' + key, (v) => ({ section: 'env', key, value: v }));
    const t = typeof env.time === 'string' && env.time.includes(':') ? +env.time.split(':')[0] + env.time.split(':')[1] / 60 : null;
    const slider = h('input', { type: 'range', min: 0, max: 24, step: 0.25, value: t ?? 17, style: { width: '100%' }, 'data-field': 'time' }), label = h('span', { style: { minWidth: '44px' } }, env.time ?? 'plan');
    const id = 'time' + Math.random();
    slider.addEventListener('input', () => { const v = hhmm(Math.min(23.99, +slider.value)); label.textContent = v; app.execQuiet('Set time', [{ section: 'env', key: 'time', value: v }], { merge: id }); });
    body.append(head('Time of day'), h('div', { class: 'mg-row' }, h('label', null, 'time'), h('div', { class: 'mg-col' }, slider, label)),
      h('div', { class: 'mg-row' }, h('label', null, ''), h('div', { class: 'mg-col' }, btn('Golden hour', 'time-golden', () => app.exec('Set time', [{ section: 'env', key: 'time', value: 'golden' }])), btn('As the plan', 'time-reset', () => app.exec('Reset time', [{ section: 'env', key: 'time', value: undefined }, { section: 'env', key: 'date', value: undefined }])))));
    const fd = { path: 'date', label: 'date', type: 'string', optional: true };
    body.append(fieldRow(fd, env.date, (v) => { if (v === undefined || /^\d{4}-\d\d-\d\d$/.test(v)) set('date', fd)(v); else app.log('warning', 'date: YYYY-MM-DD'); }, ctx));
    if (env.time === undefined && env.date === undefined) body.append(note('The world keeps the time its page set until you move the slider.'));
    body.append(head('Weather'));
    for (const k of ['wet', 'rain']) { const f = { path: k, label: k, type: 'number', min: 0, max: 1, step: 0.01, optional: true }; body.append(fieldRow(f, env[k], set(k, f), ctx)); }
    body.append(note('wet and rain drive @mirage/core/wet: they show on materials the world built with wet surfaces.'));
    body.append(head('Post (docs/post.md)'));
    for (const [k, v] of Object.entries(world.post || {})) {
      const key = 'post.' + k, f = k === 'tonemap' ? { type: 'enum', options: ['agx', 'aces', 'neutral'] } : typeof v === 'number' ? { type: 'number', step: 0.01 } : null;
      if (!f) continue;
      Object.assign(f, { path: key, label: k });
      body.append(fieldRow(f, env[key] ?? v, set(key, f), ctx));
    }
    body.append(head('Lighting'));
    const L = world.lighting, parts = L ? ['csm', 'gi', 'probes', 'lights'].filter((k) => L[k]) : [];
    body.append(note(L ? 'Realtime lighting on this page: ' + (parts.join(', ') || 'no feature') + '.' : 'This page created its world without the realtime lighting features (lighting: { ... }).'));
    if (L?.gi?.bake) body.append(h('div', { class: 'mg-row' }, h('label', null, 'probe GI'), btn('Bake again', 'gi-bake', () => { L.gi.bake(); app.kick(6); })));
    if (L) body.append(h('div', { class: 'mg-row' }, h('label', null, 'shadows'), btn('Invalidate caches', 'light-invalidate', () => { L.invalidate(); app.kick(6); })));
    if (world.light2) for (const [part, o] of Object.entries(world.light2)) {
      if (!o || typeof o !== 'object') continue;
      body.append(h('div', { class: 'mg-head', style: { paddingLeft: '14px' } }, 'light2 · ' + part));
      for (const [k, v] of Object.entries(o)) {
        const key = 'light2.' + part + '.' + k, f = typeof v === 'boolean' ? { type: 'bool' } : typeof v === 'number' ? { type: 'number', step: 0.01 } : null;
        if (!f) continue;
        Object.assign(f, { path: key, label: k });
        body.append(fieldRow(f, env[key] ?? v, set(key, f), ctx));
      }
    } else body.append(note('No light2 settings on this world (light2: true when it is created).'));
  }

  // ---- assets
  let assetsAsked = false;
  async function loadAssets() {
    try { assets = await (await fetch('/__editor/assets')).json(); } catch (e) { app.log('warning', 'assets: ' + e.message); }
    try { vfxNames = Object.keys((await import('@mirage/core/vfx-library')).VFX_LIBRARY); } catch { vfxNames = []; }
    if (Lft.current === 'Assets') Lft.show('Assets');
  }
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB');
  function assetsTab(body) {
    if (!assetsAsked) { assetsAsked = true; loadAssets(); }
    const item = (kind, name, small, fn, img) => h('div', { class: 'mg-asset', 'data-asset': kind + ':' + name, title: name, onclick: fn }, img ? h('img', { src: img, loading: 'lazy' }) : null, h('span', null, name.split('/').pop()), h('small', { style: { marginLeft: 'auto', color: '#8a8a8a' } }, small));
    body.append(head('Models (glTF)'));
    for (const a of assets.models) body.append(item('model', a.url, kb(a.bytes), () => cmd.add('model', { url: a.url })));
    if (!assets.models.length) body.append(note('No .glb / .gltf in the project folder. Put models under public/ so the built site serves them too.'));
    body.append(head('Textures'));
    for (const a of assets.textures.slice(0, 300)) body.append(item('texture', a.url, kb(a.bytes), () => {
      const sel = app.selection.map((id) => app.item(id)).find((i) => i?.kind === 'obj' && i.def.type === 'primitive');
      if (sel) app.exec('Set texture', [{ section: 'objects', key: sel.key, value: { ...sel.def, map: a.url } }]);
      else cmd.add('primitive', { shape: 'plane', map: a.url, color: '#ffffff', scale: [2, 1, 2], collide: false });
    }, /\.ktx2$/.test(a.url) ? null : a.url));
    if (!assets.textures.length) body.append(note('No texture files found.'));
    body.append(note('Click a texture to put it on the selected primitive, or on a new plane.'));
    body.append(head('VFX (VFX_LIBRARY)'));
    for (const n of vfxNames) body.append(item('vfx', n, 'effect', () => cmd.add('vfx', { effect: n })));
    body.append(head('Audio cues'));
    for (const a of assets.audio) body.append(item('audio', a.url, kb(a.bytes), () => cmd.add('sound', { url: a.url })));
    if (!assets.audio.length) body.append(note('No audio files found.'));
    body.append(h('div', { class: 'mg-row' }, h('label', null, ''), btn('Scan again', 'assets-scan', loadAssets)));
  }

  // ---- console, history
  function consoleTab(body) {
    const box = h('div', { class: 'mg-log' });
    for (const d of app.diagnostics) box.append(h('div', { 'data-l': d.severity, 'data-code': d.code }, `${d.code} ${d.severity}${d.target ? ' [' + d.target + ']' : ''}: ${d.message}${d.fix ? '\n      fix: ' + d.fix : ''}`));
    if (!app.diagnostics.length) box.append(h('div', null, 'diagnostics: none (lintPlan on the edited plan and the last build report)'));
    for (const l of app.logs) box.append(h('div', { 'data-l': l.level }, l.at + '  ' + l.text));
    body.append(box);
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }
  function historyTab(body) {
    const H = doc.history(), box = h('div', { class: 'mg-log' });
    H.done.forEach((l, i) => box.append(h('div', { 'data-l': i === H.done.length - 1 ? 'info' : '' }, (i + 1) + '  ' + l)));
    [...H.undone].reverse().forEach((l) => box.append(h('div', { style: { opacity: 0.45 } }, '↷  ' + l)));
    if (!H.done.length && !H.undone.length) box.append(h('div', null, 'No edits yet. Every edit is one entry here; Ctrl+Z walks back through them.'));
    body.append(box);
  }

  // ---- timeline editor (createTimeline of @mirage/play): tracks of keys on placed objects, scenery nodes, the camera
  const TL = { name: null, time: 0, track: 0, key: -1, head: null, clock: null };
  const tlDef = () => (TL.name && doc.layer.timelines[TL.name]) || null;
  const tlSave = (label, def, o) => app.exec(label, [{ section: 'timelines', key: TL.name, value: def }], o);
  const tlLength = (d) => d.duration || Math.max(1, ...(d.tracks || []).flatMap((t) => (t.keys || []).map((k) => k.t)));
  function tlSeek(t) { const d = tlDef(); if (!d) return; TL.time = Math.max(0, Math.min(tlLength(d), +t.toFixed(3))); app.timelines[TL.name]?.seek(TL.time); vp.touch(); app.kick(3); playhead(); }
  function playhead() {
    const d = tlDef(), live = app.timelines[TL.name];
    if (!d) return;
    if (live?.playing) TL.time = live.time;
    for (const u of bottom.querySelectorAll('.mg-tl u')) u.style.left = (TL.time / tlLength(d)) * 100 + '%';
    if (TL.clock) TL.clock.textContent = TL.time.toFixed(2) + ' / ' + tlLength(d).toFixed(2) + ' s';
  }
  function tlTarget() { const it = app.selection.length ? app.item(app.selection[app.selection.length - 1]) : null; return it && it.kind !== 'plan' ? it.id : null; }
  const tlHandle = (target) => (target === 'camera' ? world.camera : app.handle(target));
  function timelineTab(body) {
    const names = Object.keys(doc.layer.timelines);
    if (!names.includes(TL.name)) { TL.name = names[0] || null; TL.time = 0; TL.key = -1; }
    const d = tlDef(), live = d && app.timelines[TL.name];
    const pickTl = h('select', { class: 'mg-in', style: { width: '120px' }, 'data-cmd': 'tl-pick' }, names.map((n) => h('option', { value: n, selected: n === TL.name }, n)));
    pickTl.addEventListener('change', () => { TL.name = pickTl.value; TL.time = 0; TL.key = -1; B2.show('Timeline'); });
    const bar = h('div', { class: 'mg-row', style: { gridTemplateColumns: '1fr', display: 'flex', flexWrap: 'wrap' } }, names.length ? pickTl : null,
      btn('New', 'tl-new', () => { let i = 1, n = 'timeline'; while (doc.layer.timelines[n]) n = 'timeline-' + (++i); TL.name = n; TL.time = 0; tlSave('New timeline', { duration: 4, loop: false, tracks: [] }); }));
    body.append(bar);
    if (!d) { body.append(note('No timeline yet. New makes one; then select a placed object or a scenery node and add a track for it. Timelines are saved with the layer and built with createTimeline (@mirage/play).')); return; }
    const dur = h('input', { class: 'mg-in', style: { width: '54px' }, value: tlLength(d), title: 'duration (s)', 'data-cmd': 'tl-duration' });
    dur.addEventListener('change', () => { const v = +dur.value; if (v > 0) tlSave('Timeline duration', { ...d, duration: v }); });
    dur.addEventListener('keydown', (e) => e.stopPropagation());
    const loop = h('input', { type: 'checkbox', checked: !!d.loop, title: 'loop' });
    loop.addEventListener('change', () => tlSave('Timeline loop', { ...d, loop: loop.checked }));
    const addKey = () => {
      const tr = d.tracks[TL.track]; if (!tr) return app.log('warning', 'timeline: add a track first');
      const o = tlHandle(tr.target); if (!o) return app.log('warning', 'timeline: the track\'s target "' + tr.target + '" is not in the world');
      const p = getPose(o), key = tr.type === 'camera' ? { t: TL.time, position: p.position, rotation: p.rotation, fov: +world.camera.fov.toFixed(2) } : { t: TL.time, ...p };
      const keys = [...(tr.keys || []).filter((k) => Math.abs(k.t - TL.time) > 1e-3), key].sort((a, b) => a.t - b.t);
      TL.key = keys.indexOf(key);
      tlSave('Add key', { ...d, tracks: d.tracks.map((t, i) => (i === TL.track ? { ...t, keys } : t)) });
    };
    bar.append(dur, h('span', null, 's'), loop, h('span', null, 'loop'), h('div', { class: 'mg-sep' }),
      btn(live?.playing ? '❚❚' : '▶', 'tl-play', () => { const t = app.timelines[TL.name]; if (!t) return; if (t.playing) t.pause(); else t.play(TL.time >= tlLength(d) ? 0 : TL.time); app.kick(2); B2.show('Timeline'); }, 'Play / pause the timeline'),
      btn('■', 'tl-stop', () => { app.timelines[TL.name]?.stop(); TL.time = 0; for (const [id, def] of Object.entries(doc.layer.objects)) app.placed.set(id, def); app.kick(3); B2.show('Timeline'); }, 'Stop: objects go back to their saved pose'),
      h('div', { class: 'mg-sep' }),
      btn('+ Track', 'tl-track', () => { const target = tlTarget(); if (!target) return app.log('warning', 'timeline: select a placed object or a scenery node first (or use + Camera)'); TL.track = d.tracks.length; tlSave('Add track', { ...d, tracks: [...d.tracks, { type: 'transform', target, keys: [] }] }); }, 'A transform track for the selection'),
      btn('+ Camera', 'tl-camera', () => { TL.track = d.tracks.length; tlSave('Add camera track', { ...d, tracks: [...d.tracks, { type: 'camera', target: 'camera', keys: [] }] }); }),
      btn('+ Key', 'tl-key', addKey, 'Key the track\'s target as it is now, at the playhead'),
      btn('− Key', 'tl-delkey', () => { const tr = d.tracks[TL.track]; if (!tr || TL.key < 0) return; const k = TL.key; TL.key = -1; tlSave('Delete key', { ...d, tracks: d.tracks.map((t, i) => (i === TL.track ? { ...t, keys: t.keys.filter((_, n) => n !== k) } : t)) }); }),
      btn('− Track', 'tl-deltrack', () => { if (!d.tracks[TL.track]) return; const n = TL.track; TL.track = 0; TL.key = -1; tlSave('Delete track', { ...d, tracks: d.tracks.filter((_, i) => i !== n) }); }),
      btn('Delete', 'tl-delete', () => tlSave('Delete timeline', undefined)),
      TL.clock = h('span', { style: { marginLeft: 'auto', font: '11px ui-monospace, Menlo, monospace' } }, ''));
    const len = tlLength(d);
    d.tracks.forEach((tr, ti) => {
      const lane = h('div', { class: 'mg-tl', 'data-track': ti, style: ti === TL.track ? { borderColor: '#4a86d0' } : null }, h('span', { class: 'mg-tll', title: tr.target }, (tr.type === 'camera' ? 'camera' : tr.target)), h('u'));
      lane.addEventListener('pointerdown', (e) => { if (e.target !== lane) return; const r = lane.getBoundingClientRect(); TL.track = ti; TL.key = -1; tlSeek(((e.clientX - r.left) / r.width) * len); B2.show('Timeline'); });
      (tr.keys || []).forEach((k, ki) => {
        const b = h('b', { 'data-key': ki, title: 't = ' + k.t, style: { left: (k.t / len) * 100 + '%', background: ti === TL.track && ki === TL.key ? '#fff' : '' } });
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); b.setPointerCapture(e.pointerId);
          const r = lane.getBoundingClientRect(), id = 'key' + Math.random(); let moved = false;
          const move = (m) => { moved = true; TL.drag = true; const t = +Math.max(0, Math.min(len, ((m.clientX - r.left) / r.width) * len)).toFixed(2); b.style.left = (t / len) * 100 + '%'; app.execQuiet('Move key', [{ section: 'timelines', key: TL.name, value: { ...tlDef(), tracks: tlDef().tracks.map((x, i) => (i === ti ? { ...x, keys: x.keys.map((y, n) => (n === ki ? { ...y, t } : y)) } : x)) } }], { merge: id }); };
          const up = () => { b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); TL.drag = false; TL.track = ti; TL.key = ki; if (!moved) tlSeek(k.t); B2.show('Timeline'); };
          b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
        });
        lane.append(b);
      });
      body.append(lane);
    });
    if (!d.tracks.length) body.append(note('No tracks. Select something and press + Track, move the playhead (click a lane), pose the object and press + Key.'));
    playhead();
  }

  // ---- animator viewer: the state machines the project handed over (attach({ animators: { name: animator } }))
  let animTimer = 0;
  function animatorTab(body) {
    const A = app.host.animators || {}, names = Object.keys(A);
    if (!names.length) { body.append(note('The page handed over no animators. Pass them to attach({ animators: { hero: animator } }) (createAnimator of @mirage/play) to watch their states, blend weights and parameters here while the world runs. This is a viewer: states and transitions are edited in code.')); return; }
    const box = h('div', { class: 'mg-log' });
    const draw = () => {
      clear(box);
      for (const n of names) {
        const a = A[n], safe = (fn, d) => { try { return fn(); } catch { return d; } };
        const w = safe(() => a.weights(0), []) || [], p = a.parameters || {};
        box.append(h('div', { 'data-l': 'info' }, `${n}: state ${safe(() => a.state(0), '?')}  t ${(+safe(() => a.stateTime(0), 0)).toFixed(2)} s${safe(() => a.transitioning(0), false) ? '  (in transition)' : ''}`),
          h('div', null, '  weights  ' + (w.map(([c, x]) => `${c} ${(+x).toFixed(2)}`).join('   ') || '—')),
          h('div', null, '  params   ' + (Object.entries(p instanceof Map ? Object.fromEntries(p) : p).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`).join('   ') || '—')),
          h('div', null, '  clips    ' + ([...(a.clips?.keys?.() || [])].join(', ') || '—')));
      }
    };
    draw(); body.append(box);
    clearInterval(animTimer);
    animTimer = setInterval(() => { if (B2.current === 'Animator' && box.isConnected) draw(); else clearInterval(animTimer); }, 250);
  }

  // ---- assembly
  const statsEl = h('div', { class: 'mg-stats' }, '');
  const Lft = tabs({ Hierarchy: hierarchy, Assets: assetsTab }), R = tabs({ Inspector: inspector, World: worldTab });
  const B2 = tabs({ Console: consoleTab, Timeline: timelineTab, Animator: animatorTab, History: historyTab }, { extra: statsEl });
  left.append(Lft.strip, Lft.body); right.append(R.strip, R.body); bottom.append(B2.strip, B2.body);
  Lft.show('Hierarchy'); R.show('Inspector'); B2.show('Console');
  const redraw = (t) => { const y = t.body.scrollTop; t.show(t.current); t.body.scrollTop = y; };

  return {
    tabs: { left: Lft, right: R, bottom: B2 }, timeline: TL,
    refresh(what = 'all') {
      if (what === 'playhead') return playhead();
      if (what === 'top') return drawTop();
      if (what === 'console') { if (B2.current === 'Console') B2.show('Console'); return; }
      if (what === 'timeline') { if (B2.current === 'Timeline' && !TL.drag) redraw(B2); return; }
      drawTop();
      if (Lft.current === 'Hierarchy') redraw(Lft);
      if (what !== 'quiet') redraw(R);
      if (what !== 'selection' && (B2.current !== 'Timeline' || what !== 'quiet')) redraw(B2);
    },
    stats(s, { building, dirty }) {
      statsEl.textContent = `${s.calls} draws · ${s.triangles >= 1e6 ? (s.triangles / 1e6).toFixed(2) + ' M' : (s.triangles / 1e3).toFixed(1) + ' k'} tris · ${s.ms.toFixed(1)} ms CPU/frame · ${s.fps} fps drawn` + (building ? ' · rebuilding' : '') + (dirty ? ' · unsaved' : '');
    },
  };
}

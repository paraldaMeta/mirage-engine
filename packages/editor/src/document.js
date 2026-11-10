// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's document: one edit layer and a command stack over it.
//
//   const doc = createDocument(basePlan, layer);
//   doc.exec('Move palm', [{ section: 'set', key: 'points.palm', value: [1, 0, 2] }]);
//   doc.undo(); doc.redo(); doc.plan            // base plan + layer (cached until the next change)
//   doc.on(({ kind, label, changes }) => ...)   // kind: 'do' | 'undo' | 'redo' | 'load' | 'saved'
//
// Every edit, whatever made it (gizmo, inspector, paste, delete, the draw tool), is a list of
// { section, key, before, after } on the layer's flat maps; `after: undefined` removes the key. Undo writes the
// `before` values back. Nothing else changes the layer, so the stack is the whole history and save is the layer.
// `merge` folds a run of edits of one field (a number being dragged, a slider) into one undo step.
// ---------------------------------------------------------------------------
import { normalizeLayer, applyEdits, planHash, serializeLayer, clone, equal, SECTIONS } from './layer.js';

const clock = () => (globalThis.performance ? performance.now() : Date.now());

export function createDocument(basePlan, layer, { limit = 200 } = {}) {
  let L = normalizeLayer(layer), cache = null, saved = serializeLayer(L);
  const done = [], undone = [], listeners = new Set();
  const emit = (e) => { cache = null; for (const fn of [...listeners]) fn(e); };
  const write = (changes, side) => { for (const c of changes) { const v = c[side]; if (v === undefined) delete L[c.section][c.key]; else L[c.section][c.key] = clone(v); } };
  const doc = {
    base: basePlan,
    get layer() { return L; },
    get plan() { return cache ??= applyEdits(basePlan, L); },
    get(section, key) { return L[section]?.[key]; },
    /** Apply changes [{ section, key, value }] as one undo step. Returns false when nothing would change. */
    exec(label, changes, { merge } = {}) {
      const list = [];
      for (const c of [].concat(changes)) {
        if (!SECTIONS.includes(c.section) || typeof c.key !== 'string' || !c.key) throw new Error('document: bad change ' + JSON.stringify(c));
        const before = L[c.section][c.key], after = c.value === undefined ? undefined : clone(c.value);
        if (!equal(before, after)) list.push({ section: c.section, key: c.key, before: clone(before), after });
      }
      if (!list.length) return false;
      // reject a change that would not load again before anything is written
      const next = Object.fromEntries(SECTIONS.map((s) => [s, { ...L[s] }]));
      for (const c of list) { if (c.after === undefined) delete next[c.section][c.key]; else next[c.section][c.key] = c.after; }
      normalizeLayer(next);
      write(list, 'after');
      const top = done[done.length - 1];
      if (merge && top && top.merge === merge && clock() - top.at < 1500 && top.changes.length === list.length && top.changes.every((c, i) => c.section === list[i].section && c.key === list[i].key)) {
        top.changes.forEach((c, i) => { c.after = list[i].after; }); top.at = clock();
      } else { done.push({ label, changes: list, merge, at: clock() }); if (done.length > limit) done.shift(); }
      undone.length = 0;
      emit({ kind: 'do', label, changes: list });
      return true;
    },
    undo() { const c = done.pop(); if (!c) return false; write(c.changes, 'before'); c.merge = undefined; undone.push(c); emit({ kind: 'undo', label: c.label, changes: c.changes.map((x) => ({ ...x, before: x.after, after: x.before })) }); return true; },
    redo() { const c = undone.pop(); if (!c) return false; write(c.changes, 'after'); done.push(c); emit({ kind: 'redo', label: c.label, changes: c.changes }); return true; },
    get canUndo() { return done.length > 0; }, get canRedo() { return undone.length > 0; },
    history: () => ({ done: done.map((c) => c.label), undone: undone.map((c) => c.label) }),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** an id no object has: "light", "light-2", ... */
    newId(type) { let i = 1, id = type; while (L.objects[id]) id = type + '-' + (++i); return id; },
    serialize: () => serializeLayer(L),
    hash: () => planHash(doc.plan),
    get dirty() { return serializeLayer(L) !== saved; },
    markSaved() { saved = serializeLayer(L); emit({ kind: 'saved', changes: [] }); },
    /** Replace the layer (a reload from disk); the history is dropped. */
    load(layer) { L = normalizeLayer(layer); saved = serializeLayer(L); done.length = undone.length = 0; emit({ kind: 'load', changes: [] }); },
  };
  return doc;
}

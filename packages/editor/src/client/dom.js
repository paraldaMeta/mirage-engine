// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's DOM kit: an element helper, the style sheet and the typed field widgets of the inspector.
//
//   h('div', { class: 'mg-row', onclick }, 'text', child)
//   fieldRow(field, value, (next, { merge }) => ...)     // one row for a schema.js field
//
// Plain DOM on purpose. @mirage/game's ui-kit is a HUD toolkit (menus, bars, focus rings for a pad, drawn over the
// game canvas at game scale); an editor needs dense rows, trees and drag-to-scrub numbers, which it does not have,
// and a framework would be the engine's first UI dependency. Every widget reports through one callback with
// `merge` set while a value is being dragged, so a scrub is one undo step.
// ---------------------------------------------------------------------------

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

export const CSS = `
#mg-ed { position: fixed; inset: 0; display: grid; grid-template: 34px 1fr 190px / 250px 1fr 300px; font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #d6d6d6; background: #1b1c1e; z-index: 2147483000; user-select: none; }
#mg-ed * { box-sizing: border-box; }
#mg-ed[data-play] { display: none; }
.mg-top { grid-column: 1 / 4; display: flex; align-items: center; gap: 4px; padding: 0 8px; background: #26282b; border-bottom: 1px solid #111; white-space: nowrap; overflow: hidden; }
.mg-top b { margin-right: 8px; color: #fff; font-weight: 600; }
.mg-sep { width: 1px; height: 18px; background: #3a3d41; margin: 0 4px; }
.mg-grow { flex: 1; }
.mg-btn { height: 24px; padding: 0 8px; border: 1px solid #3a3d41; border-radius: 4px; background: #2e3135; color: inherit; font: inherit; cursor: pointer; }
.mg-btn:hover { background: #3a3e44; } .mg-btn[data-on] { background: #2f5f9e; border-color: #4a86d0; color: #fff; }
.mg-btn:disabled { opacity: .4; cursor: default; }
.mg-btn:focus-visible, .mg-in:focus-visible, .mg-item:focus-visible { outline: 2px solid #6aa8ff; outline-offset: -1px; }
.mg-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: #212325; border-right: 1px solid #111; }
.mg-right { border-right: 0; border-left: 1px solid #111; }
.mg-bottom { grid-column: 1 / 4; border-top: 1px solid #111; border-right: 0; }
.mg-tabs { display: flex; flex: none; background: #26282b; border-bottom: 1px solid #111; }
.mg-tab { padding: 5px 10px; border: 0; background: none; color: #9a9a9a; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
.mg-tab[data-on] { color: #fff; border-bottom-color: #4a86d0; }
.mg-body { flex: 1; overflow: auto; min-height: 0; padding: 4px 0; }
.mg-view { position: relative; overflow: hidden; background: #000; min-width: 0; min-height: 0; }
.mg-view canvas { position: absolute; left: 0; top: 0; display: block; }
.mg-view .mg-over { z-index: 2; outline: none; touch-action: none; }
.mg-hint { position: absolute; left: 8px; bottom: 6px; z-index: 3; padding: 2px 6px; border-radius: 3px; background: #000a; color: #ddd; pointer-events: none; }
.mg-item { display: flex; align-items: center; gap: 4px; height: 20px; padding-right: 6px; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mg-item:hover { background: #2c2f33; } .mg-item[data-sel] { background: #2f5f9e; color: #fff; }
.mg-item[data-off] { color: #6d6d6d; } .mg-item small { color: #8a8a8a; margin-left: auto; padding-left: 8px; }
.mg-item[data-sel] small { color: #cfe0f7; }
.mg-tw { width: 12px; text-align: center; color: #8a8a8a; flex: none; cursor: pointer; }
.mg-head { padding: 6px 8px 2px; color: #8f959c; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
.mg-row { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 6px; padding: 2px 8px; min-height: 24px; }
.mg-row > label { color: #a9a9a9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mg-row > label[data-drag] { cursor: ew-resize; }
.mg-in { width: 100%; min-width: 0; height: 20px; padding: 0 4px; border: 1px solid #3a3d41; border-radius: 3px; background: #17181a; color: #e6e6e6; font: inherit; user-select: text; }
textarea.mg-in { height: 64px; padding: 4px; font: 11px/1.3 ui-monospace, Menlo, monospace; resize: vertical; }
.mg-vec { display: flex; gap: 3px; } .mg-vec span { display: flex; flex: 1; min-width: 0; align-items: center; gap: 2px; }
.mg-vec i { font-style: normal; color: #8a8a8a; cursor: ew-resize; min-width: 9px; }
.mg-col { display: flex; gap: 4px; } .mg-col input[type=color] { width: 28px; height: 20px; padding: 0; border: 1px solid #3a3d41; background: none; }
.mg-note { padding: 6px 8px; color: #8f959c; white-space: normal; user-select: text; }
.mg-log { font: 11px/1.45 ui-monospace, Menlo, monospace; user-select: text; padding: 4px 8px; white-space: pre-wrap; }
.mg-log div[data-l=error] { color: #ff8a80; } .mg-log div[data-l=warning] { color: #ffd479; } .mg-log div[data-l=info] { color: #9ec1ff; }
.mg-stats { margin-left: auto; padding: 5px 10px; color: #a9a9a9; font: 11px ui-monospace, Menlo, monospace; }
.mg-asset { display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mg-asset:hover { background: #2c2f33; } .mg-asset img { width: 28px; height: 28px; object-fit: cover; border-radius: 2px; flex: none; background: #111; }
.mg-tl { position: relative; height: 22px; margin: 1px 8px 1px 100px; background: #17181a; border: 1px solid #2c2f33; }
.mg-tl b { position: absolute; top: 3px; width: 9px; height: 14px; margin-left: -4px; background: #e0a84a; border-radius: 2px; cursor: pointer; }
.mg-tl u { position: absolute; top: 0; bottom: 0; width: 1px; background: #ff5a4a; pointer-events: none; }
.mg-tll { position: absolute; left: -96px; width: 92px; top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a9a9a9; }
.mg-sheet { position: fixed; inset: 0; z-index: 2147483600; background: #000a; display: flex; align-items: center; justify-content: center; }
.mg-sheet > div { background: #26282b; border: 1px solid #44484d; border-radius: 6px; padding: 14px 18px; max-height: 84vh; overflow: auto; columns: 2; column-gap: 28px; width: min(760px, 92vw); font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; color: #d6d6d6; }
.mg-sheet h3 { margin: 0 0 6px; font-size: 13px; color: #fff; column-span: all; }
.mg-sheet p { margin: 0; display: flex; justify-content: space-between; gap: 12px; break-inside: avoid; }
.mg-sheet kbd, .mg-kbd { font: 11px ui-monospace, Menlo, monospace; padding: 0 4px; border: 1px solid #4a4e54; border-radius: 3px; background: #17181a; color: #e6e6e6; }
#mg-stop { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 2147483600; font: 12px ui-sans-serif, system-ui, sans-serif; padding: 5px 12px; border: 1px solid #c9544a; border-radius: 4px; background: #5a2622; color: #fff; cursor: pointer; }
`;

const round = (v, step) => { const d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step || 0.01)) + 1)); return +(+v).toFixed(d); };
const clampTo = (v, f) => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, v));

// drag on `grip` scrubs the number in `input`; typing and Enter / blur commit it
function scrub(grip, input, f, get, set) {
  grip.dataset.drag = '1';
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || f.readonly) return;
    e.preventDefault();
    const x0 = e.clientX, v0 = +get() || 0, step = f.step || 0.05, id = 'scrub' + Math.random();
    grip.setPointerCapture(e.pointerId);
    const move = (m) => { const v = round(clampTo(v0 + Math.round((m.clientX - x0) / 3) * step * (m.shiftKey ? 10 : 1), f), step); input.value = v; set(v, { merge: id }); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
}
function numberInput(f, value, set) {
  const input = h('input', { class: 'mg-in', type: 'text', inputMode: 'decimal', value: value ?? '', disabled: f.readonly, spellcheck: false, placeholder: f.optional ? '—' : '' });
  const commit = () => {
    if (input.value.trim() === '' && f.optional) return set(undefined, {});
    const v = Number(input.value);
    if (!Number.isFinite(v)) { input.value = value ?? ''; return; }
    set(clampTo(v, f), {});
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
  return input;
}

const WIDGETS = {
  number(f, value, set, label) { const i = numberInput(f, value, set); scrub(label, i, f, () => i.value, set); return i; },
  vector(f, value, set) {
    const labels = f.labels || ['x', 'y', 'z'].slice(0, value?.length || 3), v = Array.isArray(value) ? [...value] : labels.map(() => 0);
    return h('div', { class: 'mg-vec' }, labels.map((name, n) => {
      const put = (x, o) => { if (x === undefined) return; v[n] = x; set([...v], o); };
      const i = numberInput(f, v[n], put), grip = h('i', null, name);
      scrub(grip, i, f, () => i.value, put);
      return h('span', null, grip, i);
    }));
  },
  color(f, value, set) {
    const text = h('input', { class: 'mg-in', type: 'text', value: value || '', spellcheck: false });
    const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888' }), id = 'col' + Math.random();
    pick.addEventListener('input', () => { text.value = pick.value; set(pick.value, { merge: id }); });
    text.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) set(text.value.toLowerCase(), {}); else text.value = value || ''; });
    text.addEventListener('keydown', (e) => e.stopPropagation());
    return h('div', { class: 'mg-col' }, pick, text);
  },
  enum(f, value, set) {
    const opts = f.options.includes(value) || value === undefined ? f.options : [value, ...f.options];
    const s = h('select', { class: 'mg-in', disabled: f.readonly }, f.optional && value === undefined ? h('option', { value: '' }, '—') : null, opts.map((o) => h('option', { value: o, selected: o === value }, o === '' ? '(none)' : String(o))));
    s.addEventListener('change', () => set(f.options.find((o) => String(o) === s.value) ?? s.value, {}));
    return s;
  },
  bool(f, value, set) { const c = h('input', { type: 'checkbox', checked: !!value }); c.addEventListener('change', () => set(c.checked, {})); return c; },
  string(f, value, set) {
    const i = h('input', { class: 'mg-in', type: 'text', value: value ?? '', spellcheck: false, placeholder: f.optional ? '—' : '' });
    i.addEventListener('change', () => set(i.value === '' && f.optional ? undefined : i.value, {}));
    i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
    return i;
  },
  asset(f, value, set, label, ctx) {
    const list = ctx?.assets?.(f.kind) || [];
    const s = h('select', { class: 'mg-in' }, h('option', { value: '' }, '(none)'), (list.includes(value) || !value ? list : [value, ...list]).map((u) => h('option', { value: u, selected: u === value }, u)));
    s.addEventListener('change', () => set(s.value, {}));
    return s;
  },
  json(f, value, set) {
    const t = h('textarea', { class: 'mg-in', spellcheck: false, value: value === undefined ? '' : JSON.stringify(value) });
    t.addEventListener('change', () => { try { set(t.value.trim() === '' ? undefined : JSON.parse(t.value), {}); t.style.borderColor = ''; } catch { t.style.borderColor = '#c9544a'; } });
    t.addEventListener('keydown', (e) => e.stopPropagation());
    return t;
  },
};
WIDGETS.points = WIDGETS.json;

/** One inspector row for a field ({ type, label, ... } from schema.js). set(next, { merge }) is called on every change. */
export function fieldRow(f, value, set, ctx) {
  const label = h('label', { title: f.label + (f.unit ? ' (' + f.unit + ')' : '') }, f.label || '(value)');
  return h('div', { class: 'mg-row', 'data-field': f.path ?? f.label }, label, (WIDGETS[f.type] || WIDGETS.json)(f, value, set, label, ctx));
}

/** A tab strip over one body: tabs({ name: () => element | void }) -> { el, show(name), current } */
export function tabs(defs, { extra } = {}) {
  const body = h('div', { class: 'mg-body' }), strip = h('div', { class: 'mg-tabs' }), btns = {};
  const api = { el: null, current: null, body, show(name) { api.current = name; for (const k of Object.keys(btns)) btns[k].toggleAttribute('data-on', k === name); clear(body); const out = defs[name](body); if (out) body.append(out); } };
  for (const name of Object.keys(defs)) strip.append(btns[name] = h('button', { class: 'mg-tab', 'data-tab': name, onclick: () => api.show(name) }, name));
  if (extra) strip.append(extra);
  api.strip = strip;
  return api;
}

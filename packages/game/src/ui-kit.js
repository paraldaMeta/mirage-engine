// Mirage original code. A small retained UI toolkit on the DOM for a game's own HUD, menus, inventory and dialogue.
// The DOM is the substrate on purpose: text shaping, bidirectional text, IME, fonts and the accessibility tree come
// with it. Descriptions are plain data (h(tag, props, ...children)); anything that changes is a signal or a
// function, and each one is bound by its own effect to one text node, attribute, class or style property, so a
// change writes exactly that and an unchanged frame writes nothing (no diffing, no re-render of a subtree).
// ---------------------------------------------------------------------------
// import { createUIKit, h, signal, stack, anchor, each, show } from '@mirage/game/ui-kit';
// const kit = createUIKit({ input, i18n, theme: 'dark' });          // one root over the page; kit.dispose()
// const hp = signal(80);
// kit.mount(anchor({ at: 'top-start' }, stack({ gap: 0.5 },
//   h('b', null, 'Health'), h('span', null, () => `${hp.value} / 100`))));   // only the span's text node updates
// in the game loop: kit.update(now)                                  // gamepad focus, frame callbacks
// each(list, (item) => item.id, (item, index) => h('li', null, () => item.value.name))   keyed rows, moved not rebuilt
// show(open, () => h('div', ...), { transition: 'fade' })                               mount / unmount with a transition
// h(Component, props, ...children): Component(props, ctx) -> a description; ctx.kit is the kit
// Layout: stack (flex), grid, anchor (nine points, logical: mirrors in RTL), safeArea (notches), spacer. Sizes are
// in em of the root, whose font-size is 16 px x the screen scale (reference 1280 x 720) x the player's text scale.
// Themes are tokens (CSS custom properties): kit.setTheme('light' | 'contrast' | 'colorblind' | { ...tokens }).
// Steady state: nothing reads layout and nothing is written; animated things (bars, world labels) change
// transform / opacity only. docs/ui.md has the guide and the measured costs.
// ---------------------------------------------------------------------------
import { signal, effect, scope, untracked, read, isReactive, onCleanup, batch } from './ui-reactive.js';
import { createFocusNav, glyphFor } from './ui-nav.js';
import { createI18n } from './ui-i18n.js';
import { LOCALES } from './ui-locales.js';

export { signal, computed, memo, effect, batch, untracked, scope, onCleanup, read, store } from './ui-reactive.js';
export { createI18n } from './ui-i18n.js';

// ---- descriptions
/** An element or component description: plain data until it is mounted. */
export const h = (tag, props, ...children) => ({ tag, props: props || {}, children });
/** A keyed list region: rows are created once per key, moved when the order changes, disposed when their key goes.
 *  render(item, index) gets signals (the row is not rebuilt when its item object is replaced under the same key). */
export const each = (list, key, render) => (render ? { each: true, list, key, render } : { each: true, list, key: null, render: key });
/** A conditional region. options: { transition: 'fade' | 'pop' | 'rise' | 'slide', fallback: () => description } */
export const show = (when, render, options = {}) => ({ show: true, when, render, options });

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'g', 'line', 'rect', 'polygon', 'polyline', 'text', 'defs', 'use', 'ellipse']);
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'tabIndex', 'inert', 'selected', 'indeterminate', 'open', 'scrollTop']);
/** DOM writes made by bindings since the page started (the perf check reads it: 0 per steady frame). */
export const kitStats = { writes: 0, created: 0 };

function setAttr(el, k, v) {
  kitStats.writes++;
  if (PROPS.has(k)) { el[k] = k === 'value' ? (v ?? '') : v; return; }
  if (v == null || v === false) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? '' : String(v));
}
const cls = (v) => (Array.isArray(v) ? v.filter(Boolean).join(' ') : v || '');
function bindProps(el, props, ctx) {
  for (const k in props) {
    const v = props[k];
    if (v == null || k === 'children' || k === 'key') continue;
    if (k === 'ref') { if (v.isSignal) v.value = el; else v(el); continue; }
    if (k[0] === 'o' && k[1] === 'n' && typeof v === 'function' && (k[2] === ':' || (k[2] >= 'A' && k[2] <= 'Z'))) {
      const type = k[2] === ':' ? k.slice(3) : k.slice(2).toLowerCase();
      el.addEventListener(type, v, type === 'touchstart' || type === 'wheel' ? { passive: true } : undefined);
      continue;
    }
    if (k === 'class') {
      if (typeof v === 'object' && !Array.isArray(v) && !v.isSignal) {   // { name: boolean | reactive }
        for (const name in v) {
          const on = v[name];
          if (isReactive(on)) { let last; effect(() => { const b = !!read(on); if (b !== last) { last = b; kitStats.writes++; el.classList.toggle(name, b); } }); }
          else if (on) el.classList.add(...name.split(' '));
        }
      } else if (isReactive(v)) { let last; effect(() => { const s = cls(read(v)); if (s !== last) { last = s; kitStats.writes++; el.setAttribute('class', s); } }); }
      else el.setAttribute('class', cls(v));
      continue;
    }
    if (k === 'style') {
      if (typeof v === 'string') { el.setAttribute('style', v); continue; }
      for (const p in v) {
        const sv = v[p];
        const write = (x) => { kitStats.writes++; if (p[0] === '-' || p.includes('-')) el.style.setProperty(p, x == null ? '' : String(x)); else el.style[p] = x == null ? '' : x; };
        if (isReactive(sv)) { let last; effect(() => { const x = read(sv); if (x !== last) { last = x; write(x); } }); }
        else if (sv != null) write(sv);
      }
      continue;
    }
    if (isReactive(v)) { let last; effect(() => { const x = read(v); if (x !== last) { last = x; setAttr(el, k, x); } }); }
    else setAttr(el, k, v);
  }
}

const TRANSITION_MS = { fade: 160, pop: 180, rise: 200, slide: 220 };
function clearBetween(start, end) { for (let n = start.nextSibling; n && n !== end;) { const next = n.nextSibling; n.remove(); n = next; } }

// put `child` (anything a description may hold) into parent before `before`
function insert(parent, child, before, ctx) {
  if (child == null || child === false || child === true) return;
  const doc = ctx.doc;
  if (Array.isArray(child)) { for (const c of child) insert(parent, c, before, ctx); return; }
  if (typeof child === 'string' || typeof child === 'number') { parent.insertBefore(doc.createTextNode(String(child)), before); return; }
  if (child.nodeType) { parent.insertBefore(child, before); onCleanup(() => child.remove()); return; }
  if (isReactive(child)) return region(parent, before, ctx, child);
  if (child.each) return list(parent, before, ctx, child);
  if (child.show) return conditional(parent, before, ctx, child);
  if (typeof child.tag === 'function') { insert(parent, child.tag({ ...child.props, children: child.children }, ctx), before, ctx); return; }
  const svg = ctx.svg || child.tag === 'svg';
  const el = svg && SVG_TAGS.has(child.tag) ? doc.createElementNS(SVG_NS, child.tag) : doc.createElement(child.tag);
  kitStats.created++;
  const inner = svg === !!ctx.svg ? ctx : { ...ctx, svg };
  for (const c of child.children) insert(el, c, null, inner);
  bindProps(el, child.props, ctx);   // after the children: a <select>'s value needs its options
  parent.insertBefore(el, before);
}

// a function / signal child: a primitive result keeps one text node (data written in place); anything else replaces
// the nodes between two anchors
function region(parent, before, ctx, source) {
  const doc = ctx.doc;
  let text = null, start = null, end = null, drop = null;
  effect(() => {
    const v = read(source);
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const s = v == null || typeof v === 'boolean' ? '' : String(v);
      if (drop) { drop(); drop = null; clearBetween(start, end); }
      if (!text) { text = doc.createTextNode(s); (end ? end.parentNode : parent).insertBefore(text, end || before); }
      else if (text.data !== s) { kitStats.writes++; text.data = s; }
      return;
    }
    if (!start) {
      start = doc.createComment(''); end = doc.createComment('');
      const at = text || before, p = text ? text.parentNode : parent;
      p.insertBefore(start, at); p.insertBefore(end, at);
    }
    if (text) { text.remove(); text = null; }
    if (drop) { drop(); clearBetween(start, end); }
    kitStats.writes++;
    const frag = doc.createDocumentFragment();
    [, drop] = scope(() => insert(frag, v, null, ctx));
    end.parentNode.insertBefore(frag, end);
  });
  onCleanup(() => { if (drop) drop(); if (start) { clearBetween(start, end); start.remove(); end.remove(); } if (text) text.remove(); });
}

function conditional(parent, before, ctx, { when, render, options }) {
  const doc = ctx.doc, start = doc.createComment(''), end = doc.createComment('');
  parent.insertBefore(start, before); parent.insertBefore(end, before);
  const name = options.transition, ms = () => (name && ctx.kit && ctx.kit.motion.peek() !== 'reduced' ? TRANSITION_MS[name] || 160 : 0);
  let drop = null, shown = null, nodes = [];
  const build = (fn) => {
    const frag = doc.createDocumentFragment();
    [, drop] = scope(() => insert(frag, fn(), null, ctx));
    nodes = [...frag.childNodes];
    const d = ms();
    if (d) for (const n of nodes) if (n.nodeType === 1) n.classList.add('mk-t-' + name, 'mk-enter');
    end.parentNode.insertBefore(frag, end);
    if (d) { const mine = nodes; (doc.defaultView.requestAnimationFrame || setTimeout)(() => (doc.defaultView.requestAnimationFrame || setTimeout)(() => { for (const n of mine) if (n.nodeType === 1) n.classList.remove('mk-enter'); })); }
  };
  const leave = () => {
    if (drop) { drop(); drop = null; }
    const old = nodes, d = ms(); nodes = [];
    if (!d) { for (const n of old) n.remove(); return; }
    for (const n of old) if (n.nodeType === 1) { n.classList.add('mk-t-' + name, 'mk-leave'); n.setAttribute('inert', ''); } else n.remove();
    setTimeout(() => { for (const n of old) n.remove(); }, d);
  };
  effect(() => {
    const on = !!read(when);
    if (on === shown) return;
    shown = on; kitStats.writes++;
    untracked(() => { leave(); if (on) build(render); else if (options.fallback) build(options.fallback); });
  });
  onCleanup(() => { if (drop) drop(); for (const n of nodes) n.remove(); start.remove(); end.remove(); });
}

function list(parent, before, ctx, { list: source, key, render }) {
  const doc = ctx.doc, start = doc.createComment(''), end = doc.createComment('');
  parent.insertBefore(start, before); parent.insertBefore(end, before);
  let rows = new Map();   // key -> { first, last, item, index, drop }
  effect(() => {
    const items = read(source) || [];
    untracked(() => batch(() => {
      const next = new Map(), p = end.parentNode;
      for (let i = 0; i < items.length; i++) {
        const k = key ? key(items[i], i) : i;
        let row = rows.get(k);
        if (next.has(k)) throw new Error(`ui-kit each(): duplicate key ${String(k)}`);
        if (row) { row.item.value = items[i]; row.index.value = i; rows.delete(k); }
        else {
          row = { item: signal(items[i]), index: signal(i) };
          const frag = doc.createDocumentFragment();
          [, row.drop] = scope(() => insert(frag, render(row.item, row.index), null, ctx));
          if (frag.childNodes.length === 1 && frag.firstChild.nodeType === 1) row.first = row.last = frag.firstChild;
          else { row.first = doc.createComment(''); row.last = doc.createComment(''); frag.insertBefore(row.first, frag.firstChild); frag.appendChild(row.last); }
          row.frag = frag;
        }
        next.set(k, row);
      }
      for (const row of rows.values()) { row.drop(); for (let n = row.first; n;) { const nx = n === row.last ? null : n.nextSibling; n.remove(); n = nx; } kitStats.writes++; }
      // from the end backwards: a row already in place before its successor is left alone
      let at = end;
      const order = [...next.values()];
      for (let i = order.length - 1; i >= 0; i--) {
        const row = order[i];
        if (row.frag) { p.insertBefore(row.frag, at); row.frag = null; kitStats.writes++; }
        else if (row.last.nextSibling !== at) {
          kitStats.writes++;
          for (let n = row.first; n;) { const nx = n === row.last ? null : n.nextSibling; p.insertBefore(n, at); n = nx; }
        }
        at = row.first;
      }
      rows = next;
    }));
  });
  onCleanup(() => { for (const row of rows.values()) row.drop(); clearBetween(start, end); start.remove(); end.remove(); });
}

/** Mount a description into a DOM parent. Returns dispose(): removes its nodes, effects and listeners. */
export function mount(description, parent, ctx = {}) {
  const c = { doc: parent.ownerDocument, kit: null, ...ctx };
  const start = c.doc.createComment(''), end = c.doc.createComment('');
  parent.appendChild(start); parent.appendChild(end);
  const [, drop] = scope(() => insert(parent, description, end, c));
  return () => { drop(); clearBetween(start, end); start.remove(); end.remove(); };
}

// ---- layout primitives (descriptions with classes; all sizes in em)
const em = (v) => (typeof v === 'number' ? v + 'em' : v);
const pass = ({ dir, gap, align, justify, wrap, grow, cols, rows, min, at, offset, pad, ...rest }) => rest;
const merge = (base, props, style) => ({ ...pass(props), class: [base, props.class].flat(), style: { ...style, ...(typeof props.style === 'object' ? props.style : {}) } });
/** A flex row or column: { dir: 'col' | 'row', gap, align, justify, wrap, grow, pad } */
export const stack = (props, ...children) => { props ||= {}; return h(props.tag || 'div', merge(['mk-stack', props.dir === 'row' ? 'mk-row' : 'mk-col', props.wrap && 'mk-wrap'], props,
  { gap: props.gap != null ? em(props.gap) : null, alignItems: props.align, justifyContent: props.justify, flexGrow: props.grow, padding: props.pad != null ? em(props.pad) : null }), ...children); };
export const row = (props, ...children) => stack({ ...props, dir: 'row' }, ...children);
/** A grid: { cols: n | 'template', rows, gap, min: '6em' (auto-fill columns at least that wide) } */
export const grid = (props, ...children) => { props ||= {}; return h('div', merge('mk-grid', props, {
  gridTemplateColumns: props.min ? `repeat(auto-fill,minmax(${em(props.min)},1fr))` : typeof props.cols === 'number' ? `repeat(${props.cols},minmax(0,1fr))` : props.cols,
  gridTemplateRows: typeof props.rows === 'number' ? `repeat(${props.rows},minmax(0,1fr))` : props.rows, gap: props.gap != null ? em(props.gap) : null }), ...children); };
/** Pin children to one of nine points of the parent layer: 'top-start' | 'top' | 'top-end' | 'start' | 'center' |
 *  'end' | 'bottom-start' | 'bottom' | 'bottom-end' (start / end follow the text direction); offset: [x, y] em. */
export const anchor = (props, ...children) => { props ||= {}; const o = props.offset || [0, 0];
  return h('div', merge(['mk-anchor', 'mk-at-' + (props.at || 'center')], props, { '--mk-ox': em(o[0]), '--mk-oy': em(o[1]) }), ...children); };
/** A full-size box padded by the device's safe-area insets (notch, home bar, rounded corners) and `pad` em. */
export const safeArea = (props, ...children) => { props ||= {}; return h('div', merge('mk-safe', props, { '--mk-safe-pad': props.pad != null ? em(props.pad) : null }), ...children); };
export const spacer = (size) => h('div', { class: 'mk-spacer', style: size != null ? { flex: `0 0 ${em(size)}` } : null });

/** The UI scale for a viewport against a reference size. mode: 'fit' (the smaller ratio: nothing is cut off),
 *  'width', 'height', 'fill' (the larger ratio). Clamped to [min, max]. */
export function computeScale(width, height, { reference = [1280, 720], mode = 'fit', min = 0.7, max = 2.5 } = {}) {
  const sx = width / reference[0], sy = height / reference[1];
  const s = mode === 'width' ? sx : mode === 'height' ? sy : mode === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
  return Math.min(max, Math.max(min, s || 1));
}

// ---- themes: tokens only; widgets never name a colour
const BASE = { radius: '0.5em', radiusSm: '0.3em', pad: '0.75em', gap: '0.5em', touch: 'max(2.75em, 44px)', fast: '120ms', slow: '240ms',
  shadow: '0 0.25em 1em #0008', font: '', mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' };
export const THEMES = {
  dark: { ...BASE, scheme: 'dark', bg: '#14100c', surface: '#1e1711', surface2: '#2e241a', text: '#f6ecd8', muted: '#c9bca4', accent: '#ffcf6e', onAccent: '#1b120a',
    border: '#8a7557', focus: '#ffe08a', good: '#7bd88f', warn: '#ffb454', bad: '#ff8a7a', info: '#7cc4ff', health: '#e5564b', stamina: '#e9c04c', mana: '#5aa9f0', track: '#00000080', scrim: '#000000a6' },
  light: { ...BASE, scheme: 'light', bg: '#f4efe6', surface: '#fffaf0', surface2: '#ebe2d0', text: '#221a10', muted: '#5c5040', accent: '#8a4b00', onAccent: '#ffffff',
    border: '#7d6c55', focus: '#005fcc', good: '#1a7f37', warn: '#8a5a00', bad: '#c22b1b', info: '#0b62b8', health: '#c22b1b', stamina: '#8a5a00', mana: '#0b62b8', track: '#00000026', scrim: '#00000080', shadow: '0 0.25em 1em #0003' },
  // WCAG AAA: every text pair at 7:1 or better, borders at 4.5:1, a thick focus ring
  contrast: { ...BASE, scheme: 'dark', bg: '#000000', surface: '#000000', surface2: '#1a1a1a', text: '#ffffff', muted: '#e6e6e6', accent: '#ffff00', onAccent: '#000000',
    border: '#ffffff', focus: '#00ffff', good: '#5cff8a', warn: '#ffd24a', bad: '#ff9d94', info: '#8ad4ff', health: '#ff6b61', stamina: '#ffd24a', mana: '#8ad4ff', track: '#333333', scrim: '#000000e0' },
  // status colours from the Okabe-Ito set: told apart under protanopia, deuteranopia and tritanopia (ui.check.mjs
  // simulates the three); good / bad are blue / orange instead of green / red
  colorblind: { ...BASE, scheme: 'dark', bg: '#14100c', surface: '#1e1711', surface2: '#2e241a', text: '#f6ecd8', muted: '#c9bca4', accent: '#f0e442', onAccent: '#1b120a',
    border: '#8a7557', focus: '#f0e442', good: '#56b4e9', warn: '#f0e442', bad: '#e69f00', info: '#cc9fc4', health: '#e69f00', stamina: '#f0e442', mana: '#56b4e9', track: '#00000080', scrim: '#000000a6' },
};
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
/** Tokens as a CSS declaration block: { accent: '#fc6' } -> '--mk-accent:#fc6;' */
export const themeCSS = (tokens) => Object.entries(tokens).filter(([k, v]) => v !== '' && k !== 'scheme').map(([k, v]) => `--mk-${kebab(k)}:${v}`).join(';');

// ---- colour maths for the accessibility checks (WCAG 2.x)
export function parseColor(c) {
  let s = String(c).trim().replace('#', '');
  if (s.length === 3 || s.length === 4) s = [...s].map((x) => x + x).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1];
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** Relative luminance (0 black, 1 white) of '#rrggbb' or [r, g, b]. */
export const luminance = (c) => { const [r, g, b] = Array.isArray(c) ? c : parseColor(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG contrast ratio, 1 to 21. Text needs 4.5 (AA) or 7 (AAA); large text and graphics 3. */
export function contrastRatio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** A translucent colour over an opaque one, as [r, g, b]. */
export const over = (top, under) => { const t = parseColor(top), u = parseColor(under); return [0, 1, 2].map((i) => Math.round(t[i] * t[3] + u[i] * (1 - t[3]))); };
// dichromacy in linear RGB (Viénot, Brettel and Mollon 1999 for protan / deutan; Brettel 1997's single-plane
// approximation for tritan): what a colour looks like without one cone type
const CVD = {
  protanopia: [0.11238, 0.88762, 0, 0.11238, 0.88762, 0, 0.00401, -0.00401, 1],
  deuteranopia: [0.29275, 0.70725, 0, 0.29275, 0.70725, 0, -0.02234, 0.02234, 1],
  tritanopia: [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911],
};
/** [r, g, b] as seen with 'protanopia' | 'deuteranopia' | 'tritanopia'. */
export function simulateCVD(c, type) {
  const m = CVD[type], [r, g, b] = (Array.isArray(c) ? c : parseColor(c)).map(lin);
  const enc = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
  return [enc(m[0] * r + m[1] * g + m[2] * b), enc(m[3] * r + m[4] * g + m[5] * b), enc(m[6] * r + m[7] * g + m[8] * b)];
}
/** How far apart two colours are in CIELAB (delta E 1976): under ~10 they are easy to confuse in a HUD. */
export function colorDistance(a, b) {
  const lab = (c) => {
    const [r, g, bl] = (Array.isArray(c) ? c : parseColor(c)).map(lin);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl), z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const CSS = `
.mk-root{position:fixed;inset:0;pointer-events:none;z-index:20;font:1em/1.45 var(--mk-font);color:var(--mk-text);-webkit-text-size-adjust:100%;text-size-adjust:100%;overflow:hidden;contain:layout style;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.mk-root *,.mk-root *::before,.mk-root *::after{box-sizing:border-box}
.mk-root [hidden]{display:none!important}
.mk-root :lang(zh),.mk-root :lang(ja){line-break:strict;word-break:normal;overflow-wrap:anywhere;text-wrap:pretty}
.mk-root :lang(ko){word-break:keep-all}
.mk-root p,.mk-root h1,.mk-root h2,.mk-root h3{margin:0;text-wrap:pretty;overflow-wrap:anywhere}
.mk-layer{position:absolute;inset:0;pointer-events:none}
.mk-layer>*{pointer-events:auto}
.mk-layer>.mk-anchor,.mk-layer>.mk-safe{pointer-events:none}
.mk-anchor>*,.mk-safe>*{pointer-events:auto}
.mk-safe>.mk-anchor{pointer-events:none}
.mk-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mk-stack{display:flex;min-width:0}.mk-col{flex-direction:column}.mk-row{flex-direction:row;align-items:center}.mk-wrap{flex-wrap:wrap}
.mk-grid{display:grid}.mk-spacer{flex:1 1 0}
.mk-safe{position:absolute;inset:0;padding:max(var(--mk-safe-pad,1em),env(safe-area-inset-top)) max(var(--mk-safe-pad,1em),env(safe-area-inset-right)) max(var(--mk-safe-pad,1em),env(safe-area-inset-bottom)) max(var(--mk-safe-pad,1em),env(safe-area-inset-left))}
.mk-safe>.mk-anchor{margin:inherit}
.mk-anchor{position:absolute;display:flex;flex-direction:column;max-width:100%;max-height:100%}
.mk-safe>.mk-anchor{inset:max(var(--mk-safe-pad,1em),env(safe-area-inset-top)) max(var(--mk-safe-pad,1em),env(safe-area-inset-right)) max(var(--mk-safe-pad,1em),env(safe-area-inset-bottom)) max(var(--mk-safe-pad,1em),env(safe-area-inset-left));margin:0}
.mk-layer>.mk-anchor{inset:0}
.mk-anchor{padding-block:var(--mk-oy,0);padding-inline:var(--mk-ox,0)}
.mk-at-top-start{justify-content:flex-start;align-items:flex-start}.mk-at-top{justify-content:flex-start;align-items:center}.mk-at-top-end{justify-content:flex-start;align-items:flex-end}
.mk-at-start{justify-content:center;align-items:flex-start}.mk-at-center{justify-content:center;align-items:center}.mk-at-end{justify-content:center;align-items:flex-end}
.mk-at-bottom-start{justify-content:flex-end;align-items:flex-start}.mk-at-bottom{justify-content:flex-end;align-items:center}.mk-at-bottom-end{justify-content:flex-end;align-items:flex-end}
.mk-root :focus{outline:none}
.mk-root :focus-visible,.mk-root[data-device=gamepad] :focus{outline:0.19em solid var(--mk-focus);outline-offset:0.12em}
.mk-t-fade,.mk-t-pop,.mk-t-rise,.mk-t-slide{transition:opacity var(--mk-slow) ease,transform var(--mk-slow) cubic-bezier(.2,.8,.2,1)}
.mk-t-fade.mk-enter,.mk-t-fade.mk-leave{opacity:0}
.mk-t-pop.mk-enter,.mk-t-pop.mk-leave{opacity:0;transform:scale(.94)}
.mk-t-rise.mk-enter,.mk-t-rise.mk-leave{opacity:0;transform:translateY(0.75em)}
.mk-t-slide.mk-enter,.mk-t-slide.mk-leave{opacity:0;transform:translateX(1.5em)}
.mk-root[dir=rtl] .mk-t-slide.mk-enter,.mk-root[dir=rtl] .mk-t-slide.mk-leave{transform:translateX(-1.5em)}
.mk-root[data-motion=reduced] *,.mk-root[data-motion=reduced] *::before,.mk-root[data-motion=reduced] *::after{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}
`;
/** Add a stylesheet once per document (widgets bring their own). */
export function addStyles(doc, id, css) {
  if (doc.getElementById(id)) return;
  const s = doc.createElement('style'); s.id = id; s.textContent = css; doc.head.appendChild(s);
}

/** One UI root over the page (or inside `parent`). See the header for the tour.
 *  options: parent, theme (a name in THEMES or tokens), themes (more named themes), i18n (createI18n(); one in
 *  English is made otherwise), input (createInput(): bindings for glyphs, the device), scale ({ reference, mode,
 *  min, max } | false), textScale (1), motion ('auto' | 'full' | 'reduced'), nav (options for createFocusNav). */
export function createUIKit({ parent, theme = 'dark', themes = {}, i18n = null, input = null, scale: scaleOpts = {}, textScale: ts = 1, motion: motionOpt = 'auto', nav: navOpts = {}, id = '' } = {}) {
  const doc = (parent && parent.ownerDocument) || document, win = doc.defaultView;
  parent ||= doc.body;
  addStyles(doc, 'mk-css', CSS);
  const root = doc.createElement('div');
  root.className = 'mk-root'; if (id) root.id = id;
  const off = [], frames = new Set(), services = new Map();
  const all = { ...THEMES, ...themes };
  const themeName = signal(typeof theme === 'string' ? theme : 'custom'), tokens = signal(typeof theme === 'string' ? all[theme] || THEMES.dark : { ...THEMES.dark, ...theme });
  const textScale = signal(ts), scale = signal(1);
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const motion = signal(motionOpt === 'auto' ? (mq && mq.matches ? 'reduced' : 'full') : motionOpt);
  if (mq && motionOpt === 'auto') { const f = () => { if (kit.motionSetting === 'auto') motion.value = mq.matches ? 'reduced' : 'full'; }; mq.addEventListener('change', f); off.push(() => mq.removeEventListener('change', f)); }
  i18n ||= createI18n();
  for (const l in LOCALES) i18n.add(l, LOCALES[l], true);   // the widgets' own strings, under the game's
  const bindings = signal(0);
  const layers = {};
  for (const name of ['world', 'hud', 'modal', 'toast']) { const l = doc.createElement('div'); l.className = 'mk-layer mk-layer-' + name; root.appendChild(layers[name] = l); }
  // two live regions: polite for progress, assertive for what must interrupt; text is set a task after a clear so a
  // repeated message is read again
  const live = { polite: doc.createElement('div'), assertive: doc.createElement('div') };
  for (const k in live) { live[k].className = 'mk-sr'; live[k].setAttribute('aria-live', k); live[k].setAttribute('role', k === 'polite' ? 'status' : 'alert'); live[k].setAttribute('aria-atomic', 'true'); root.appendChild(live[k]); }
  parent.appendChild(root);
  const nav = createFocusNav({ root, input, ...navOpts });
  const size = () => { const fixed = win.getComputedStyle(root).position === 'fixed'; return fixed ? [win.innerWidth, win.innerHeight] : [root.clientWidth, root.clientHeight]; };
  const rescale = () => { if (scaleOpts === false) return; const [w, h2] = size(); scale.value = computeScale(w, h2, scaleOpts); };
  win.addEventListener('resize', rescale); off.push(() => win.removeEventListener('resize', rescale));
  rescale();
  const ctx = { doc, kit: null };
  const stops = [];
  const [, dropFx] = scope(() => {
    effect(() => { root.style.fontSize = (16 * scale.value * textScale.value).toFixed(3) + 'px'; });
    effect(() => { const t = tokens.value; root.setAttribute('style', themeCSS({ ...t, font: t.font || i18n.font.value }) + ';font-size:' + root.style.fontSize + ';color-scheme:' + (t.scheme || 'dark')); root.dataset.theme = themeName.peek(); });
    effect(() => { root.lang = i18n.lang.value; root.dir = i18n.dir.value; });
    effect(() => { root.dataset.motion = motion.value; });
  });
  const kit = {
    root, layers, doc, nav, i18n, input,
    /** the language's message, formatted: reactive when read inside a binding */
    t: (key, params) => i18n.t(key, params),
    /** a bound text: tx('menu.resume') -> a function child that follows the language */
    tx: (key, params) => () => i18n.t(key, typeof params === 'function' ? params() : params),
    device: nav.device,
    /** call after input.rebind() / reset(): glyphs on screen follow */
    rebound() { bindings.value++; },
    theme: themeName, tokens, textScale, scale, motion,
    motionSetting: motionOpt,
    themes: all,
    setTheme(t) { batch(() => { if (typeof t === 'string') { if (!all[t]) throw new Error(`ui-kit: no theme "${t}"`); themeName.value = t; tokens.value = all[t]; } else { themeName.value = 'custom'; tokens.value = { ...tokens.peek(), ...t }; } }); },
    /** 'auto' follows the system's reduced-motion setting */
    setMotion(m) { kit.motionSetting = m; motion.value = m === 'auto' ? (mq && mq.matches ? 'reduced' : 'full') : m; },
    /** Mount a description into a layer ('hud' | 'modal' | 'toast' | 'world') or an element. Returns dispose(). */
    mount(description, layer = 'hud') { const stop = mount(description, typeof layer === 'string' ? layers[layer] : layer, ctx); stops.push(stop); return () => { const i = stops.indexOf(stop); if (i >= 0) stops.splice(i, 1); stop(); }; },
    /** Say something to a screen reader without moving focus. assertive: interrupts (damage, failure). */
    announce(text, { assertive = false } = {}) {
      const el = live[assertive ? 'assertive' : 'polite'];
      el.textContent = '';
      win.setTimeout(() => { if (el.isConnected) el.textContent = String(text); }, 30);
    },
    /** The glyph for an action on the current device: { text, kind }. Reactive (device, pad family). */
    glyph: (action) => glyphFor(action, bindings.value < 0 ? {} : { device: nav.device.value === 'mouse' ? 'keyboard' : nav.device.value, bindings: input ? input.bindings : {}, padKind: nav.padKind.value }),
    /** fn(now, dt) every kit.update(); returns a function that stops it */
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    /** A lazily made per-kit singleton (the modal stack, toasts, tooltips): widgets share one of each. */
    service(name, make) { let s = services.get(name); if (!s) services.set(name, s = make(kit)); return s; },
    /** once per frame from the game loop (or kit.autoUpdate()) */
    update(now = win.performance.now()) {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
      nav.update(now);
      for (const f of frames) f(now, dt);
    },
    /** run update() on requestAnimationFrame (pages without a loop of their own); returns stop() */
    autoUpdate() { let id2 = 0; const tick = (now) => { kit.update(now); id2 = win.requestAnimationFrame(tick); }; id2 = win.requestAnimationFrame(tick); const stop = () => win.cancelAnimationFrame(id2); off.push(stop); return stop; },
    addStyles: (sid, css) => addStyles(doc, sid, css),
    dispose() {
      for (const s of stops.splice(0).reverse()) s();
      for (const s of services.values()) s.dispose?.();
      services.clear(); frames.clear(); dropFx(); nav.dispose();
      for (const f of off.splice(0)) f();
      root.remove();
    },
  };
  let last = win.performance.now();
  ctx.kit = kit;
  return kit;
}

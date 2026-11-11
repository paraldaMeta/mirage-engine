// Mirage original code. A UI panel drawn into a texture: for screens inside the world (a terminal, a shop sign) and
// for XR, where there is no DOM over the picture. A small subset of the toolkit's widgets (panel, col, row, text,
// button, toggle, slider, bar, spacer) is laid out by plain arithmetic into draw commands and painted with Canvas 2D,
// or with the built-in glyph font of @mirage/play where a host draws no canvas text (Latin only there).
// It shares the toolkit's signals, theme tokens, i18n (line breaking, right-to-left mirroring) and focus geometry;
// the texture is repainted only when something it shows has changed.
// ---------------------------------------------------------------------------
// import { createCanvasUI, cv } from '@mirage/game/ui-canvas';
// const power = signal(true), level = signal(0.4);
// const screen = createCanvasUI({ width: 512, height: 320, kit,           // kit: tokens and language; or { tokens, i18n }
//   description: () => cv.panel({ title: 'Generator' },
//     cv.toggle({ value: power, label: 'Power' }), cv.slider({ value: level, label: 'Output' }),
//     cv.bar({ value: () => level.value * 100, max: 100, tone: 'good' }), cv.button({ label: 'Vent', onPress: vent })) });
// scene.add(screen.mesh({ width: 1.2 }));                                  // a plane, 1.2 m wide, unlit
// every frame: screen.update()            -> true when the texture was repainted
// mouse / XR ray: screen.raycast(raycaster, pressed)  or  screen.pointFrom(controllerRay, pressed)
// gamepad: screen.move('down'); screen.activate();      pointer in panel space: screen.pointer(u, v, pressed)
// Pure part (Node-tested): layoutCanvas(description, options) -> { commands, boxes }.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { effect, signal, read, untracked } from './ui-reactive.js';
import { wrapText } from './ui-i18n.js';
import { nextFocus } from './ui-nav.js';
import { THEMES, parseColor } from './ui-kit.js';
import { createImage, clearImage, fillRoundRect, drawText, textWidth, canvasTextWorks } from '@mirage/play/glyphs';

const node = (type) => (props, ...children) => ({ type, props: props || {}, children: children.flat().filter(Boolean) });
/** The canvas widgets (descriptions, like h()): values may be signals or functions.
 *  panel { title, pad, gap }  col { gap }  row { gap }  text { text, size, color: token, bold, align }
 *  button { label, onPress, primary }  toggle { value: signal, label, onChange }
 *  slider { value: signal, min, max, step, label, onChange }  bar { value, max, tone: token, label }  spacer { size } */
export const cv = { panel: node('panel'), col: node('col'), row: node('row'), text: node('text'), button: node('button'), toggle: node('toggle'), slider: node('slider'), bar: node('bar'), spacer: node('spacer') };

const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));

/** Lay a description out in a width x height pixel box: { commands, boxes }.
 *  commands: { op: 'rect', x, y, w, h, r, fill, stroke, lineWidth } | { op: 'text', text, x, y (middle), size, color,
 *  bold, align: 'left' | 'center' | 'right' }, in paint order, colours resolved from `tokens`.
 *  boxes: the interactive widgets in order, { x, y, w, h, node, track? } (the focus graph and hit-testing use them).
 *  options: width, height, tokens, measure(text, size, bold) -> px, locale, rtl, size (base text px, 20), focus,
 *  hover, pressed (indices into boxes). Reads every reactive prop (inside an effect that makes it re-run). */
export function layoutCanvas(description, { width = 512, height = 320, tokens = THEMES.dark, measure = (t, s) => String(t).length * s * 0.55, locale = 'en', rtl = false, size: base = 20, focus = -1, hover = -1, pressed = -1 } = {}) {
  const commands = [], boxes = [];
  const col = (name, fallback = '#ffffff') => tokens[name] || (String(name)[0] === '#' ? name : fallback);
  const T = (n) => { const p = n.props, s = p.size || base; return { s, lh: s * 1.4, text: String(read(p.text ?? p.label) ?? '') }; };
  const lines = (n, w) => { const t = T(n); return n.props.wrap === false ? [t.text] : wrapText(t.text, Math.max(t.s, w), (x) => measure(x, t.s, !!n.props.bold), locale); };
  const ctl = base * 2.1;   // the height of a control: 42 px at the base size, a comfortable ray target
  // the width a node wants in a row; null: it takes what is left
  const widthOf = (n) => {
    const p = n.props;
    if (p.grow) return null;
    switch (n.type) {
      case 'text': return Math.ceil(measure(T(n).text, T(n).s, !!p.bold));
      case 'button': return Math.ceil(measure(T(n).text, base, true) + base * 1.6);
      case 'spacer': return p.size != null ? p.size : null;
      case 'row': { let w = 0; for (const c of n.children) { const cw = widthOf(c); if (cw == null) return null; w += cw; } return w + (p.gap ?? base * 0.5) * Math.max(0, n.children.length - 1); }
      default: return null;
    }
  };
  const rowWidths = (n, w) => {
    const gap = n.props.gap ?? base * 0.5, ws = n.children.map(widthOf);
    const free = w - gap * Math.max(0, ws.length - 1) - ws.reduce((a, b) => a + (b || 0), 0), flex = ws.filter((x) => x == null).length;
    return ws.map((x) => (x == null ? Math.max(0, free / flex) : x));
  };
  const heightOf = (n, w) => {
    const p = n.props;
    switch (n.type) {
      case 'panel': { const pad = p.pad ?? base * 0.8, gap = p.gap ?? base * 0.5; let hh = pad * 2 + (p.title != null ? base * 1.9 : 0); n.children.forEach((c, i) => { hh += heightOf(c, w - pad * 2) + (i ? gap : 0); }); return hh; }
      case 'col': { const gap = p.gap ?? base * 0.5; let hh = 0; n.children.forEach((c, i) => { hh += heightOf(c, w) + (i ? gap : 0); }); return hh; }
      case 'row': { const ws = rowWidths(n, w); return Math.max(0, ...n.children.map((c, i) => heightOf(c, ws[i]))); }
      case 'text': return lines(n, w).length * T(n).lh;
      case 'bar': return (p.label != null ? base * 1.3 : 0) + (p.height || base * 0.7);
      case 'spacer': return p.size != null ? p.size : 0;
      default: return ctl;
    }
  };
  const rect = (x, y, w, hh, r, fill, stroke, lineWidth) => commands.push({ op: 'rect', x, y, w, h: hh, r, fill: fill || null, stroke: stroke || null, lineWidth: lineWidth || 0 });
  const text = (s, x, y, size, color, bold, align) => { if (s !== '') commands.push({ op: 'text', text: s, x, y, size, color, bold: !!bold, align: align || 'left' }); };
  const interactive = (n, x, y, w, hh, extra) => { const i = boxes.length; boxes.push({ x, y, w, h: hh, node: n, ...extra }); return { i, focus: i === focus, hover: i === hover, pressed: i === pressed }; };
  const ring = (st, x, y, w, hh, r) => { if (st.focus) rect(x - 3, y - 3, w + 6, hh + 6, r + 3, null, col('focus'), 3); };
  const emit = (n, x, y, w, hh) => {
    const p = n.props;
    switch (n.type) {
      case 'panel': {
        const pad = p.pad ?? base * 0.8, gap = p.gap ?? base * 0.5;
        rect(0, 0, width, height, base * 0.6, col(p.fill || 'surface'), col('border'), 2);
        let cy = y + pad;
        if (p.title != null) { text(String(read(p.title)), x + pad, cy + base * 0.7, base * 1.25, col('accent'), true); rect(x + pad, cy + base * 1.5, w - pad * 2, 2, 0, col('border')); cy += base * 1.9; }
        for (const c of n.children) { const ch = heightOf(c, w - pad * 2); emit(c, x + pad, cy, w - pad * 2, ch); cy += ch + gap; }
        break;
      }
      case 'col': { const gap = p.gap ?? base * 0.5; let cy = y; for (const c of n.children) { const ch = heightOf(c, w); emit(c, x, cy, w, ch); cy += ch + gap; } break; }
      case 'row': { const gap = p.gap ?? base * 0.5, ws = rowWidths(n, w); let cx = x; n.children.forEach((c, i) => { const ch = heightOf(c, ws[i]); emit(c, cx, y + (hh - ch) / 2, ws[i], ch); cx += ws[i] + gap; }); break; }
      case 'text': { const t = T(n), a = p.align || 'left'; lines(n, w).forEach((l, i) => text(l, a === 'center' ? x + w / 2 : a === 'right' ? x + w : x, y + t.lh * (i + 0.5), t.s, col(p.color || 'text'), p.bold, a)); break; }
      case 'button': {
        const st = interactive(n, x, y, w, hh), prim = !!p.primary;
        rect(x, y, w, hh, base * 0.45, col(prim ? 'accent' : st.pressed ? 'bg' : st.hover ? 'border' : 'surface2'), col(prim ? 'accent' : 'border'), 2);
        text(T(n).text, x + w / 2, y + hh / 2, base, col(prim ? 'onAccent' : 'text'), true, 'center'); ring(st, x, y, w, hh, base * 0.45);
        break;
      }
      case 'toggle': {
        const st = interactive(n, x, y, w, hh), on = !!read(p.value), sw = base * 2.4, sh = base * 1.2, sx = x + w - sw - base * 0.6, sy = y + (hh - sh) / 2;
        rect(x, y, w, hh, base * 0.45, col(st.hover ? 'border' : 'surface2'), col('border'), 2);
        text(T(n).text, x + base * 0.7, y + hh / 2, base, col('text'));
        // the state in a word as well as a colour
        text(String(read(on ? p.on ?? 'On' : p.off ?? 'Off')), sx - base * 0.5, y + hh / 2, base * 0.8, col('muted'), false, 'right');
        rect(sx, sy, sw, sh, sh / 2, col(on ? 'accent' : 'track'), col('border'), 2);
        rect(on ? sx + sw - sh + 3 : sx + 3, sy + 3, sh - 6, sh - 6, (sh - 6) / 2, col(on ? 'onAccent' : 'muted'));
        ring(st, x, y, w, hh, base * 0.45);
        break;
      }
      case 'slider': {
        const min = p.min ?? 0, max = p.max ?? 1, v = clamp01((read(p.value) - min) / (max - min)), label = T(n).text;
        const lw = label ? Math.min(w * 0.45, measure(label, base, false) + base) : 0, tx = x + base * 0.7 + lw, tw = Math.max(20, w - lw - base * 1.4), ty = y + hh / 2;
        const st = interactive(n, x, y, w, hh, { track: [tx, tw] });
        rect(x, y, w, hh, base * 0.45, col(st.hover ? 'border' : 'surface2'), col('border'), 2);
        text(label, x + base * 0.7, y + hh / 2, base, col('text'));
        rect(tx, ty - 4, tw, 8, 4, col('track'), col('border'), 1); rect(tx, ty - 4, tw * v, 8, 4, col('accent'));
        rect(tx + tw * v - base * 0.45, ty - base * 0.45, base * 0.9, base * 0.9, base * 0.45, col('text'), col('bg'), 2);
        ring(st, x, y, w, hh, base * 0.45);
        break;
      }
      case 'bar': {
        const v = clamp01(read(p.value) / (read(p.max) || 1)), bh = p.height || base * 0.7; let by = y;
        if (p.label != null) { text(String(read(p.label)), x, y + base * 0.55, base * 0.8, col('muted')); by += base * 1.3; }
        rect(x, by, w, bh, bh / 2, col('track'), col('border'), 1); if (v > 0) rect(x, by, Math.max(bh, w * v), bh, bh / 2, col(p.tone || 'accent'));
        break;
      }
      default: break;
    }
  };
  if (description) emit(description, 0, 0, width, description.type === 'panel' ? height : heightOf(description, width));
  if (rtl) {   // laid out left to right, then mirrored: rows, switches and bar fills all run the other way
    for (const c of commands) { if (c.op === 'rect') c.x = width - c.x - c.w; else { c.x = width - c.x; c.align = c.align === 'left' ? 'right' : c.align === 'right' ? 'left' : 'center'; } }
    for (const b of boxes) { b.x = width - b.x - b.w; if (b.track) b.track = [width - b.track[0] - b.track[1], b.track[1]]; }
  }
  return { commands, boxes };
}

const rgba = (c) => { const [r, g, b, a] = parseColor(c); return [r, g, b, a]; };

/** A reactive panel in a texture. options: width, height (px), description (a cv node or a function returning one),
 *  kit (its tokens, language and direction are followed) or tokens / i18n, size (base text px, 20), backend:
 *  'auto' | 'canvas' | 'glyphs', font (CSS family for the canvas backend).
 *  -> { texture, canvas | image, boxes, focus (signal), update(), pointer(u, v, down), pointerUV(uv, down),
 *       raycast(raycaster, down), pointFrom(object3D, down), move(dir), activate(), mesh(opts), stats, dispose() } */
export function createCanvasUI({ width = 512, height = 320, description, kit = null, tokens = null, i18n = null, size = 20, backend = 'auto', font = null } = {}) {
  i18n ||= kit && kit.i18n;
  const doc = typeof document !== 'undefined' ? document : null;
  if (backend === 'auto') backend = doc && canvasTextWorks() ? 'canvas' : 'glyphs';
  const focus = signal(-1), hover = signal(-1), pressed = signal(-1);
  const stats = { layouts: 0, paints: 0 };
  let canvas = null, ctx = null, image = null, flipped = null, texture, layout = { commands: [], boxes: [] }, dirty = true, rtl = false, family = font || 'system-ui,sans-serif';
  const cell = (s) => Math.max(1, Math.round(s / 9));
  const widths = new Map();
  let measure;
  if (backend === 'canvas') {
    canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height; ctx = canvas.getContext('2d');
    texture = new THREE.CanvasTexture(canvas);
    measure = (t, s, bold) => { const k = `${bold ? 'b' : 'n'}${s}|${family}|${t}`; let w = widths.get(k); if (w === undefined) { ctx.font = `${bold ? '600 ' : ''}${s}px ${family}`; w = ctx.measureText(t).width; if (widths.size > 4000) widths.clear(); widths.set(k, w); } return w; };
  } else {
    image = createImage(width, height); flipped = new Uint8Array(width * height * 4);
    texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
    measure = (t, s) => textWidth(t, cell(s));
  }
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  // one effect: anything the description read (signals, the language, the theme, focus and hover) lays out again
  const stop = effect(() => {
    const tk = tokens || (kit ? kit.tokens.value : THEMES.dark);
    rtl = i18n ? i18n.dir.value === 'rtl' : false;
    if (!font && i18n) family = i18n.font.value;
    layout = layoutCanvas(typeof description === 'function' ? description() : description, { width, height, tokens: tk, measure, locale: i18n ? i18n.locale.value : 'en', rtl, size, focus: focus.value, hover: hover.value, pressed: pressed.value });
    stats.layouts++; dirty = true;
  });
  function paint() {
    if (ctx) {
      ctx.clearRect(0, 0, width, height); ctx.textBaseline = 'middle'; ctx.direction = rtl ? 'rtl' : 'ltr';
      for (const c of layout.commands) {
        if (c.op === 'rect') {
          const r = Math.max(0, Math.min(c.r, c.w / 2, c.h / 2));
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(c.x, c.y, c.w, c.h, r); else ctx.rect(c.x, c.y, c.w, c.h);
          if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
          if (c.stroke && c.lineWidth) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth; ctx.stroke(); }
        } else { ctx.font = `${c.bold ? '600 ' : ''}${c.size}px ${family}`; ctx.textAlign = c.align; ctx.fillStyle = c.color; ctx.fillText(c.text, c.x, c.y); }
      }
    } else {
      clearImage(image);
      for (const c of layout.commands) {
        if (c.op === 'rect') { if (c.fill) fillRoundRect(image, c.x, c.y, c.w, c.h, c.r, rgba(c.fill)); if (c.stroke && c.lineWidth) fillRoundRect(image, c.x, c.y, c.w, c.h, c.r, rgba(c.stroke), c.lineWidth); }
        else { const k = cell(c.size), w = textWidth(c.text, k); drawText(image, c.text, c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x, c.y, k, rgba(c.color), c.bold); }
      }
      const row = width * 4;   // a DataTexture's first row is the bottom one
      for (let r = 0; r < height; r++) flipped.set(image.data.subarray(r * row, r * row + row), (height - 1 - r) * row);
    }
    texture.needsUpdate = true; stats.paints++;
  }
  const hit = (x, y) => { const b = layout.boxes; for (let i = b.length - 1; i >= 0; i--) if (x >= b[i].x && x <= b[i].x + b[i].w && y >= b[i].y && y <= b[i].y + b[i].h) return i; return -1; };
  const setSlider = (b, v) => { const p = b.node.props, min = p.min ?? 0, max = p.max ?? 1, step = p.step ?? (max - min) / 20; v = +Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(6); if (v !== p.value.peek()) { p.value.value = v; p.onChange && p.onChange(v); } };
  const drag = (b, x) => { const p = b.node.props, t = clamp01((x - b.track[0]) / b.track[1]); setSlider(b, (p.min ?? 0) + (rtl ? 1 - t : t) * ((p.max ?? 1) - (p.min ?? 0))); };
  const fire = (i) => { const b = layout.boxes[i]; if (!b) return false; const p = b.node.props; if (b.node.type === 'button') p.onPress && p.onPress(); else if (b.node.type === 'toggle') { const v = !p.value.peek(); p.value.value = v; p.onChange && p.onChange(v); } else return false; return true; };
  let wasDown = false, meshes = [];
  const ray = new THREE.Raycaster(), hits = [];
  const api = {
    texture, canvas, image, stats, backend, width, height,
    /** the focused widget's index in boxes (a signal; -1: none) */
    focus,
    get boxes() { return layout.boxes; },
    get commands() { return layout.commands; },
    /** repaint if something changed; true when it did */
    update() { if (!dirty) return false; dirty = false; paint(); return true; },
    /** A pointer in panel space: u, v in 0..1 from the top left. down: the trigger / button is held. Returns the
     *  index under the pointer (-1: none). Pass u < 0 when the pointer leaves. */
    pointer(u, v, down = false) {
      const x = u * width, y = v * height, i = u < 0 || u > 1 || v < 0 || v > 1 ? -1 : hit(x, y);
      untracked(() => {
        hover.value = i;
        const held = pressed.peek(), hb = layout.boxes[held];
        if (down && !wasDown && i >= 0) { pressed.value = i; focus.value = i; if (layout.boxes[i].track) drag(layout.boxes[i], x); }
        else if (down && hb && hb.track) drag(hb, x);
        else if (!down && wasDown) { pressed.value = -1; if (held >= 0 && held === i) fire(i); }
        wasDown = down;
      });
      return i;
    },
    /** the same from a raycast hit's uv (v up) */
    pointerUV: (uv, down) => (uv ? api.pointer(uv.x, 1 - uv.y, down) : api.pointer(-1, -1, down)),
    /** Point a THREE.Raycaster at the panel's meshes: hover, press and drag follow. Returns whether it hit. */
    raycast(raycaster, down = false) { hits.length = 0; raycaster.intersectObjects(meshes, false, hits); api.pointerUV(hits.length ? hits[0].uv : null, down); return hits.length > 0; },
    /** The same from an XR controller's ray space (or any Object3D looking down its -z). */
    pointFrom(object, down = false) { object.updateWorldMatrix(true, false); ray.ray.origin.setFromMatrixPosition(object.matrixWorld); ray.ray.direction.set(0, 0, -1).transformDirection(object.matrixWorld); return api.raycast(ray, down); },
    /** Move focus: 'up' | 'down' | 'left' | 'right' (a focused slider takes left / right). */
    move(dir) {
      const b = layout.boxes, f = focus.peek();
      if (b[f] && b[f].track && (dir === 'left' || dir === 'right')) { const p = b[f].node.props, step = p.step ?? ((p.max ?? 1) - (p.min ?? 0)) / 20; setSlider(b[f], p.value.peek() + (dir === 'right' ? 1 : -1) * (rtl ? -1 : 1) * step); return true; }
      const i = nextFocus(b, f, dir, { wrap: true });
      if (i >= 0) focus.value = i;
      return i >= 0;
    },
    activate: () => fire(focus.peek()),
    /** A plane showing the panel: { width: metres (1), doubleSide }. Unlit and not tone mapped: a screen emits. */
    mesh({ width: w = 1, doubleSide = false } = {}) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * height) / width), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide }));
      m.name = 'canvas-ui'; meshes.push(m);
      return m;
    },
    dispose() { stop(); for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent(); } meshes = []; texture.dispose(); },
  };
  return api;
}

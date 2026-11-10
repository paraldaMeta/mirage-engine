// Mirage original code. Focus and navigation for the UI toolkit: spatial (directional) focus for keyboard arrows,
// d-pad and left stick, scopes that trap focus (modals) and give it back, the last-used device (so prompts show the
// right glyphs), and button glyphs per device and gamepad family.
// The geometry is pure (rectangles in, index out) and checked in Node; the DOM part reads rectangles only when a
// direction is pressed, never per frame.
// ---------------------------------------------------------------------------
// nextFocus(rects, from, 'right', { wrap })  -> index of the rectangle to move to, or -1
// buildFocusGraph(rects)                      -> [{ up, down, left, right }] (indices; for tests and debugging)
// const nav = createFocusNav({ root, input });  nav.update(now) once per frame (gamepad);  nav.device.value
//   const pop = nav.pushScope(panelEl, { onBack, trap: true });  ...  pop()      // a modal: focus stays inside
//   nav.move('down')  nav.activate()  nav.back()  nav.focusFirst()
// glyphFor('interact', { device, bindings, padKind }) -> { text: 'E' | 'X' | '□' | 'Use', kind }
// Elements can steer it: data-nav-up="#id" (and -down, -left, -right) names the neighbour; data-nav="skip" leaves
// an element out; a widget that uses a direction itself (a slider's left / right, a list's up / down) cancels the
// 'mk-nav' event it receives first: el.addEventListener('mk-nav', (e) => { if (e.detail.dir === 'left') { ...; e.preventDefault(); } })
// ---------------------------------------------------------------------------
import { signal } from './ui-reactive.js';
import { PAD, keyName } from './input.js';

const AXIS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
export const DIRS = ['up', 'down', 'left', 'right'];

/** The rectangle to move focus to from rects[from] in a direction: the nearest one ahead, preferring those that
 *  overlap the source's shadow in that direction (so "down" from a wide button goes to what is under it, not to a
 *  closer thing off to the side). rects: [{ x, y, w, h }] (null entries are skipped). -1 when nothing is ahead,
 *  unless `wrap`: then the farthest one behind, in line. from = -1: the top-left-most. */
export function nextFocus(rects, from, dir, { wrap = false } = {}) {
  const [dx, dy] = AXIS[dir] || AXIS.down;
  if (from < 0 || !rects[from]) {
    let best = -1;
    for (let i = 0; i < rects.length; i++) if (rects[i] && (best < 0 || rects[i].y < rects[best].y - 1 || (Math.abs(rects[i].y - rects[best].y) <= 1 && rects[i].x < rects[best].x))) best = i;
    return best;
  }
  const s = rects[from], sx = s.x + s.w / 2, sy = s.y + s.h / 2;
  let best = -1, bestScore = Infinity, back = -1, backScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const c = rects[i];
    if (!c || i === from) continue;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    // along the direction: from the source's leading edge to the candidate's near edge; across it: the gap between
    // the two spans (0 when they overlap)
    const ahead = dx ? (dx > 0 ? c.x - (s.x + s.w) : s.x - (c.x + c.w)) : (dy > 0 ? c.y - (s.y + s.h) : s.y - (c.y + c.h));
    const gap = dx ? Math.max(0, c.y - (s.y + s.h), s.y - (c.y + c.h)) : Math.max(0, c.x - (s.x + s.w), s.x - (c.x + c.w));
    const along = (cx - sx) * dx + (cy - sy) * dy, across = Math.abs((cx - sx) * dy) + Math.abs((cy - sy) * dx);
    if (along > 0.5 && ahead > -Math.min(dx ? s.w : s.h, dx ? c.w : c.h) * 0.5) {
      // out of line costs three times its distance, and anything outside a 45 degree cone is not "that way" at all
      if (gap > 0 && across > along * 2) continue;
      const score = Math.max(0, ahead) + gap * 3 + across * 0.05;
      if (score < bestScore) { bestScore = score; best = i; }
    } else if (wrap && along < -0.5) {
      const score = (gap > 0 ? 1e7 + gap * 3e3 : 0) + along;   // in line first, then the farthest behind
      if (score < backScore) { backScore = score; back = i; }
    }
  }
  return best >= 0 ? best : back;
}
/** Every rectangle's neighbour in the four directions. */
export function buildFocusGraph(rects, opts) {
  return rects.map((r, i) => (r ? Object.fromEntries(DIRS.map((d) => [d, nextFocus(rects, i, d, opts)])) : null));
}

// ---- glyphs: what to print for an action on the device in the player's hands
export const PAD_GLYPHS = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'],
  // the standard mapping is by position: Nintendo's letters sit the other way round
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→'],
};
/** 'xbox' | 'playstation' | 'switch' from a Gamepad's id string (unknown pads read as xbox: the standard layout). */
export function padKind(id = '') {
  const s = String(id).toLowerCase();
  if (/playstation|dualsense|dualshock|054c|sony/.test(s)) return 'playstation';
  if (/nintendo|switch|joy-con|057e/.test(s)) return 'switch';
  return 'xbox';
}
const TOUCH_LABELS = { interact: 'Use', jump: 'Jump', menu: '☰', inventory: 'Bag' };
// UI verbs that are not game actions (and share no name with one: 'back', 'left' and 'right' are movement, so the
// way out of a menu is 'cancel' and the directions are navUp..navRight)
const UI_PAD = { confirm: 0, cancel: 1, tabPrev: 4, tabNext: 5, navUp: 12, navDown: 13, navLeft: 14, navRight: 15 };
const UI_KEYS = { confirm: 'Enter', cancel: 'Escape', tabPrev: 'KeyQ', tabNext: 'KeyE', navUp: 'ArrowUp', navDown: 'ArrowDown', navLeft: 'ArrowLeft', navRight: 'ArrowRight' };
const KEY_SYMBOL = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Space: '␣', Esc: 'Esc' };
/** The label for an action (a game action from the bindings, or a UI verb: confirm, cancel, tabPrev, tabNext) on a
 *  device. kind: 'key' | 'pad' | 'touch' (the kit styles them apart). */
export function glyphFor(action, { device = 'keyboard', bindings = {}, padKind: kind = 'xbox', touchLabels = TOUCH_LABELS } = {}) {
  if (device === 'gamepad') {
    const b = PAD[action] ? PAD[action][0] : UI_PAD[action];
    if (b != null) return { text: (PAD_GLYPHS[kind] || PAD_GLYPHS.xbox)[b] || String(b), kind: 'pad', button: b };
  }
  if (device === 'touch') return { text: touchLabels[action] || (action === 'confirm' ? 'Tap' : action === 'cancel' ? 'Back' : action), kind: 'touch' };
  const code = (bindings[action] || [])[0] || UI_KEYS[action];
  const name = code ? keyName(code) : '?';
  return { text: KEY_SYMBOL[name] || name, kind: 'key', code };
}

// ---- the DOM part
const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]';
const isText = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|color|file)$/.test(el.type)));

/** Directional focus, scopes and the device signal for one UI root. dispose() removes its listeners.
 *  options: root (the kit's element), input (createInput(): its `source` is followed), getGamepads (tests),
 *  gamepad: 'scoped' (default: the pad drives the UI only while a scope is open, the game otherwise) | 'always' | false,
 *  repeat: [first, next] ms of a held direction. */
export function createFocusNav({ root, input = null, getGamepads, gamepad = 'scoped', repeat = [380, 110], wrap = true, doc = root.ownerDocument, win = doc.defaultView } = {}) {
  const device = signal(win.matchMedia && win.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard');
  const kind = signal('xbox');
  const scopes = [];   // { el, onBack, trap, last, restore }
  const off = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };
  const top = () => scopes[scopes.length - 1] || null;
  const scopeEl = () => (top() ? top().el : root);
  const visible = (el) => { if (el.closest('[inert],[hidden]')) return false; const r = el.getClientRects(); return r.length > 0 && r[0].width > 0 && r[0].height > 0; };
  const focusables = (el = scopeEl()) => [...el.querySelectorAll(FOCUSABLE)].filter((e) => !e.disabled && e.tabIndex >= 0 && e.dataset.nav !== 'skip' && visible(e));
  const current = () => { const a = doc.activeElement; return a && a !== doc.body && scopeEl().contains(a) ? a : null; };
  const focus = (el) => { if (!el) return false; el.focus({ preventScroll: false }); if (el.scrollIntoView && doc.activeElement === el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return doc.activeElement === el; };
  const setDevice = (d) => { if (device.peek() !== d) { device.value = d; root.dataset.device = d; } };
  root.dataset.device = device.peek();

  const nav = {
    /** 'keyboard' | 'mouse' | 'gamepad' | 'touch': the device last used (a signal) */
    device,
    /** 'xbox' | 'playstation' | 'switch': the connected pad's family (a signal) */
    padKind: kind,
    /** true while a rebinding widget waits for a key: keyboard handling stands aside */
    suspended: false,
    get scope() { return top(); },
    get depth() { return scopes.length; },
    focusables,
    focusFirst(el = scopeEl()) { const list = focusables(el); return focus(el.querySelector('[data-autofocus]:not(:disabled)') || list[0]); },
    /** Move focus in a direction. The focused element hears a cancelable 'mk-nav' first; then data-nav-<dir>;
     *  then geometry. Returns true when something consumed it or focus moved. */
    move(dir) {
      const a = current();
      if (!a) return nav.focusFirst();
      if (!a.dispatchEvent(new win.CustomEvent('mk-nav', { detail: { dir }, bubbles: true, cancelable: true }))) return true;
      const named = a.getAttribute('data-nav-' + dir);
      if (named) { const t = scopeEl().querySelector(named); if (t) return focus(t); }
      const list = focusables();
      // one read of every candidate's rectangle, then pure geometry: a forced layout at most once per press
      const rects = list.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const i = nextFocus(rects, list.indexOf(a), dir, { wrap });
      return i >= 0 ? focus(list[i]) : false;
    },
    activate() { const a = current(); if (a) a.click(); return !!a; },
    /** B / Escape: the focused element may cancel 'mk-back' (a dropdown closing itself); else the scope's onBack */
    back() {
      const a = current() || scopeEl();
      if (!a.dispatchEvent(new win.CustomEvent('mk-back', { bubbles: true, cancelable: true }))) return true;
      const s = top();
      if (s && s.onBack) { s.onBack(); return true; }
      return false;
    },
    /** LB / RB (and Q / E in a scope): the scope's tab strip listens for 'mk-tab' ({ step: -1 | 1 }) */
    tab(step) { return !scopeEl().dispatchEvent(new win.CustomEvent('mk-tab', { detail: { step }, bubbles: true, cancelable: true })); },
    /** Focus stays inside `el` until the returned function is called; focus then returns to where it was. */
    pushScope(el, { onBack = null, trap = true, autofocus = true } = {}) {
      const s = { el, onBack, trap, restore: doc.activeElement };
      scopes.push(s);
      if (autofocus && !el.contains(doc.activeElement)) nav.focusFirst(el) || (el.tabIndex = -1, el.focus());
      return () => {
        const i = scopes.indexOf(s);
        if (i < 0) return;
        scopes.splice(i, 1);
        if (s.restore && s.restore.isConnected && s.restore.focus && i === scopes.length) s.restore.focus();
      };
    },
    /** once per frame: gamepad directions (with repeat), A, B, LB / RB; and the input's own source */
    update(now = win.performance.now()) {
      if (input && input.source !== lastSource) { lastSource = input.source; setDevice(input.source); }
      if (gamepad === false) return;
      const pads = getGamepads ? getGamepads() : (win.navigator.getGamepads ? win.navigator.getGamepads() : []);
      let pad = null;
      for (const p of pads) if (p && p.connected !== false) { pad = p; break; }
      if (!pad) { prev.length = 0; held = null; return; }
      const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const dir = b(12) || ay < -0.6 ? 'up' : b(13) || ay > 0.6 ? 'down' : b(14) || ax < -0.6 ? 'left' : b(15) || ax > 0.6 ? 'right' : null;
      const edge = (i) => b(i) && !prev[i];
      let used = dir !== null;
      for (let i = 0; i < 16; i++) if (edge(i)) used = true;
      if (used) { setDevice('gamepad'); const k = padKind(pad.id); if (kind.peek() !== k) kind.value = k; }
      const active = gamepad === 'always' || scopes.length > 0;
      if (active) {
        if (dir !== held) { held = dir; nextAt = now + repeat[0]; if (dir) nav.move(dir); }
        else if (dir && now >= nextAt) { nextAt = now + repeat[1]; nav.move(dir); }
        if (edge(0)) nav.activate();
        if (edge(1)) nav.back();
        if (edge(4)) nav.tab(-1);
        if (edge(5)) nav.tab(1);
        for (const i of [2, 3, 9]) if (edge(i)) scopeEl().dispatchEvent(new win.CustomEvent('mk-pad', { detail: { button: i }, bubbles: true }));
      } else held = dir;   // a direction held when a scope opens does not fire at once
      for (let i = 0; i < 16; i++) prev[i] = b(i);
    },
    dispose() { for (const f of off.splice(0)) f(); scopes.length = 0; },
  };
  const prev = [];
  let held = null, nextAt = 0, lastSource = input ? input.source : null;

  on(doc, 'keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;   // an IME composing: its arrows and Enter are its own
    setDevice('keyboard');
    if (nav.suspended) return;   // a key is being captured for a binding: Escape and the arrows are answers, not commands
    const inside = scopeEl().contains(e.target) || e.target === doc.body;
    if (!inside && !top()) return;
    const t = e.target, k = e.key;
    if (k === 'Tab' && top() && top().trap) {   // cycle inside the scope
      const list = focusables(); if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(doc.activeElement), n = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      e.preventDefault(); focus(list[n]); return;
    }
    if (k === 'Escape' && top()) { if (nav.back()) { e.preventDefault(); e.stopPropagation(); } return; }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[k];
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!scopeEl().contains(t) && !top()) return;
    if (isText(t) && (dir === 'left' || dir === 'right' || t.tagName === 'TEXTAREA')) return;   // the caret's
    if (t.tagName === 'SELECT') return;
    if (!top() && !root.contains(doc.activeElement)) return;   // nothing of ours is focused: the game's arrows
    if (nav.move(dir)) e.preventDefault();
  }, true);
  // while a scope is open its keys are the UI's: they stop here, after the widgets and before the game's input on
  // the window (Enter on "Resume" must not also interact). The keys that toggle the menu and the inventory pass.
  on(root, 'keydown', (e) => {
    if (!top() || nav.suspended) return;
    const b = input && input.bindings;
    if (b && ((b.menu || []).includes(e.code) || (b.inventory || []).includes(e.code)) && !isText(e.target)) return;
    e.stopPropagation();
  });
  on(doc, 'pointerdown', (e) => setDevice(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse'), true);
  on(doc, 'pointermove', (e) => { if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) && device.peek() !== 'mouse' && device.peek() !== 'keyboard') setDevice('mouse'); }, true);
  // focus that escapes a trapping scope (a click on the page behind, a screen reader's jump) comes back
  on(doc, 'focusin', (e) => {
    const s = top();
    if (!s || !s.trap || s.el.contains(e.target)) { if (s && s.el.contains(e.target)) s.last = e.target; return; }
    if (s.last && s.last.isConnected) s.last.focus(); else nav.focusFirst(s.el);
  });
  return nav;
}

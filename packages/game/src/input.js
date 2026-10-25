// Mirage original code. An action map over the keyboard, the Gamepad API (standard mapping) and touch
// (the overlay's virtual stick and buttons feed it). Mouse look stays in @mirage/play (pointer lock or drag).
// ---------------------------------------------------------------------------
// const input = createInput({ bindings });   input.poll() once per frame, then:
//   input.down('jump'), input.pressed('interact') (this frame's edges), input.move() -> { x, z }, input.look(dt) -> [dx, dy]
//   input.source: 'keyboard' | 'gamepad' | 'touch' (the last one used; prompts show its glyphs)
//   input.rebind(action, code) / input.capture() -> Promise<code> / input.bindings (saved with the game)
//   touch: input.stick(x, z), input.hold(action, on), input.tap(action), input.addLook(dx, dy)
// ---------------------------------------------------------------------------

export const ACTIONS = ['forward', 'back', 'left', 'right', 'run', 'jump', 'interact', 'inventory', 'menu'];
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], interact: ['KeyE', 'Enter'], inventory: ['KeyI'], menu: ['Escape', 'KeyP'],
};
// standard gamepad: 0 A, 1 B, 2 X, 3 Y, 4 LB, 9 Start, 10 L3, 12-15 d-pad; axes 0/1 left stick, 2/3 right stick
export const PAD = { jump: [0], interact: [2], inventory: [3], menu: [9], run: [4, 10] };
export const PAD_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 9: 'Start', 10: 'L3' };
const LOOK_SPEED = 2.6;   // rad/s at full right-stick deflection

export function createInput({ target = globalThis, bindings = DEFAULT_BINDINGS, deadzone = 0.18 } = {}) {
  const keys = new Set(), edges = new Set(), queued = new Set(), held = new Set();
  const touch = { x: 0, z: 0, look: [0, 0] };
  let padPrev = [], pad = null, capturing = null;
  const inp = {
    bindings: structuredClone(bindings), source: 'keyboard', pad: null, enabled: true,
    down: (a) => inp.enabled && ((inp.bindings[a] || []).some((c) => keys.has(c)) || held.has(a) || padDown(a)),
    pressed: (a) => edges.has(a),
    /** pad buttons' edges this frame (menus use them: 12 up, 13 down, 0 A, 1 B) */
    padPressed: (i) => edges.has('pad' + i),
    move() {
      if (!inp.enabled) return { x: 0, z: 0 };
      let x = inp.down('right') - inp.down('left') + touch.x, z = inp.down('forward') - inp.down('back') + touch.z;
      if (pad) { const [ax, ay] = stick(pad.axes[0], pad.axes[1]); x += ax; z -= ay; }
      const l = Math.hypot(x, z);
      return l > 1 ? { x: x / l, z: z / l } : { x, z };
    },
    look(dt) {
      let dx = touch.look[0], dy = touch.look[1];
      touch.look = [0, 0];
      if (pad && inp.enabled) { const [ax, ay] = stick(pad.axes[2], pad.axes[3]); dx += ax * Math.abs(ax) * LOOK_SPEED * dt; dy += ay * Math.abs(ay) * LOOK_SPEED * dt; }
      return [dx, dy];
    },
    poll() {
      edges.clear();
      for (const a of queued) edges.add(a);
      queued.clear();
      const pads = globalThis.navigator && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      pad = inp.pad = pads.find((p) => p.connected !== false) || null;
      if (pad) {
        const now = pad.buttons.map((b) => b.pressed || b.value > 0.5);
        now.forEach((p, i) => { if (p && !padPrev[i]) { edges.add('pad' + i); inp.source = 'gamepad'; for (const [a, l] of Object.entries(PAD)) if (l.includes(i)) edges.add(a); } });
        if (Math.hypot(pad.axes[0] || 0, pad.axes[1] || 0) > 0.5) inp.source = 'gamepad';
        padPrev = now;
      }
      if (!inp.enabled) for (const a of ['jump', 'interact']) edges.delete(a);
    },
    rebind(action, code, slot = 0) {
      for (const a of ACTIONS) inp.bindings[a] = (inp.bindings[a] || []).filter((c) => c !== code);   // one action per key
      const l = inp.bindings[action] || (inp.bindings[action] = []);
      l[slot] = code;
      inp.bindings[action] = l.filter(Boolean);
    },
    reset() { inp.bindings = structuredClone(DEFAULT_BINDINGS); },
    /** resolves with the next key pressed (Escape cancels with null) */
    capture: () => new Promise((r) => { capturing = r; }),
    stick(x, z) { touch.x = x; touch.z = z; if (x || z) inp.source = 'touch'; },
    hold(a, on) { if (on) { held.add(a); queued.add(a); inp.source = 'touch'; } else held.delete(a); },
    tap(a) { queued.add(a); inp.source = 'touch'; },
    addLook(dx, dy) { touch.look[0] += dx; touch.look[1] += dy; },
    /** the label of an action on the current device: 'E', 'X', or the touch button's name */
    glyph(a) {
      if (inp.source === 'gamepad' && PAD[a]) return PAD_NAMES[PAD[a][0]];
      if (inp.source === 'touch') return { interact: 'Use', jump: 'Jump', menu: '☰', inventory: 'Bag' }[a] || a;
      return keyName((inp.bindings[a] || [])[0] || '?');
    },
    clear() { keys.clear(); held.clear(); touch.x = touch.z = 0; },
  };
  const padDown = (a) => !!(inp.enabled && pad && PAD[a] && PAD[a].some((i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5)));
  const stick = (x = 0, y = 0) => { const l = Math.hypot(x, y); if (l < deadzone) return [0, 0]; const k = Math.min(1, (l - deadzone) / (1 - deadzone)) / l; return [x * k, y * k]; };
  const inField = (e) => e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (target.addEventListener) {
    target.addEventListener('keydown', (e) => {
      if (capturing) { e.preventDefault(); const r = capturing; capturing = null; r(e.code === 'Escape' ? null : e.code); return; }
      if (inField(e)) return;
      inp.source = 'keyboard';
      // a key pressed inside a dialog belongs to the dialog (Enter on "Continue" must not also interact once it
      // closes); only the menu / inventory toggles pass, the UI closes dialogs through them
      const inDialog = e.target && e.target.closest && e.target.closest('dialog');
      if (!e.repeat) for (const a of ACTIONS) if ((inp.bindings[a] || []).includes(e.code) && (!inDialog || a === 'menu' || a === 'inventory')) queued.add(a);
      keys.add(e.code);
      if (!inDialog && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => keys.delete(e.code));
    target.addEventListener('blur', () => inp.clear());
  }
  return inp;
}

export const keyName = (code) => code.replace(/^Key|^Digit/, '').replace(/^Arrow/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'Space').replace('Escape', 'Esc');

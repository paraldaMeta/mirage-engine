// Mirage original code. The widget set of the UI toolkit (ui-kit.js): components are functions (props, ctx) ->
// description, services are one-per-kit objects (the modal stack, toasts, the dialogue box).
// Every widget works with a keyboard, a gamepad (spatial focus, A / B, LB / RB), a mouse and touch, carries its
// ARIA role and state, takes its colours from theme tokens and its words from the kit's i18n, lays out with
// logical properties (so it mirrors in right-to-left) and animates transform / opacity only.
// ---------------------------------------------------------------------------
// import { createUIKit, h, signal, stack } from '@mirage/game/ui-kit';
// import { Button, Slider, Toggle, Bar, modals, toasts, dialogue } from '@mirage/game/ui-widgets';
// const kit = createUIKit({ input });
// const volume = signal(0.8), hp = signal(80);
// kit.mount(h(Bar, { value: hp, max: 100, tone: 'health', label: kit.tx('ui.health') }));
// const menu = modals(kit).open((close) => stack({ gap: 0.5 },
//   h(Slider, { value: volume, label: 'Volume', onChange: (v) => audio.volume('master', v) }),
//   h(Button, { label: 'Resume', onPress: close, glyph: 'cancel' })), { label: 'Paused' });
// toasts(kit).push({ text: 'Key found', tone: 'good' });
// const pick = await dialogue(kit).say({ speaker: 'Ana', text: 'Which way?', choices: ['Left', 'Right'] });
// Components: Button Glyph Prompt Toggle Slider Select Tabs TextInput Progress Bar Tooltip VirtualList
//   InventoryGrid MinimapFrame ObjectiveTracker RebindList      Services: modals toasts dialogue; openRadial, confirm
// Pure logic (Node-tested): virtualRange, moveItem, radialIndex, revealCount.
// ---------------------------------------------------------------------------
import { h, each, show, signal, computed, memo, effect, untracked, read, onCleanup, batch } from './ui-kit.js';
import { graphemes, breakPieces } from './ui-i18n.js';
import { ACTIONS, keyName } from './input.js';

const CSS = `
.mk-root{--mk-sign:1}.mk-root[dir=rtl]{--mk-sign:-1}
.mk-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:2.5em;padding:.45em 1.1em;font:inherit;font-weight:600;color:var(--mk-text);background:var(--mk-surface2);border:.09em solid var(--mk-border);border-radius:var(--mk-radius);cursor:pointer;touch-action:manipulation;transition:transform var(--mk-fast) ease,opacity var(--mk-fast) ease}
.mk-btn:active{transform:scale(.97)}.mk-btn:disabled{opacity:.45;cursor:default}
.mk-btn-primary{background:var(--mk-accent);color:var(--mk-on-accent);border-color:var(--mk-accent)}
.mk-btn-ghost{background:transparent;border-color:transparent}
.mk-btn-wide{width:100%;justify-content:space-between}
.mk-root[data-device=touch] .mk-btn,.mk-root[data-device=touch] .mk-toggle,.mk-root[data-device=touch] .mk-select,.mk-root[data-device=touch] .mk-slider{min-height:var(--mk-touch)}
.mk-root[data-device=touch] .mk-btn{min-width:var(--mk-touch)}
.mk-glyph{display:inline-flex;align-items:center;justify-content:center;min-width:1.7em;height:1.7em;padding:0 .4em;font:600 .8em/1 var(--mk-mono);color:var(--mk-text);background:var(--mk-bg);border:.1em solid var(--mk-border);border-bottom-width:.2em;border-radius:var(--mk-radius-sm);direction:ltr}
.mk-glyph[data-kind=pad]{border-radius:1em;border-bottom-width:.1em;font-family:inherit}
.mk-glyph[data-kind=touch]{border-style:dashed;border-bottom-width:.1em;font-family:inherit}
.mk-prompt{display:inline-flex;align-items:center;gap:.5em;padding:.35em .8em;background:var(--mk-surface);border:.06em solid var(--mk-border);border-radius:2em}
.mk-toggle,.mk-select,.mk-slider{display:flex;align-items:center;justify-content:space-between;gap:1em;min-height:2.5em;width:100%;padding:.3em .75em;font:inherit;color:var(--mk-text);background:var(--mk-surface2);border:.09em solid var(--mk-border);border-radius:var(--mk-radius);text-align:start}
.mk-toggle{cursor:pointer}
.mk-switch{position:relative;flex:none;width:2.6em;height:1.4em;border-radius:1em;background:var(--mk-track);border:.09em solid var(--mk-border)}
.mk-knob{position:absolute;inset-block-start:.12em;inset-inline-start:.14em;width:1em;height:1em;border-radius:50%;background:var(--mk-muted);transition:transform var(--mk-fast) ease}
.mk-toggle[aria-checked=true] .mk-switch{background:var(--mk-accent)}
.mk-toggle[aria-checked=true] .mk-knob{transform:translateX(calc(1.2em * var(--mk-sign)));background:var(--mk-on-accent)}
.mk-toggle-state{min-width:2.2em;text-align:end;color:var(--mk-muted);font-size:.85em}
.mk-track{position:relative;flex:1 1 8em;min-width:6em;height:1.6em;cursor:pointer;touch-action:none;border-radius:var(--mk-radius-sm)}
.mk-track::before{content:"";position:absolute;inset:.55em 0;border-radius:1em;background:var(--mk-track);border:.06em solid var(--mk-border)}
.mk-track .mk-fill{position:absolute;inset:.55em 0;border-radius:1em;background:var(--mk-accent);transform:scaleX(var(--p,0));transform-origin:left}
.mk-root[dir=rtl] .mk-fill,.mk-root[dir=rtl] .mk-ghost{transform-origin:right}
.mk-rail{position:absolute;inset:0;margin-inline:.6em;transform:translateX(calc(var(--p,0) * 100% * var(--mk-sign)));pointer-events:none}
.mk-thumb{position:absolute;inset-block-start:.2em;inset-inline-start:-.6em;width:1.2em;height:1.2em;border-radius:50%;background:var(--mk-text);border:.12em solid var(--mk-bg)}
.mk-slider-value,.mk-select-value{min-width:3.2em;text-align:end;font-variant-numeric:tabular-nums}
.mk-slider-label,.mk-select-label,.mk-toggle-label{flex:0 1 auto}
.mk-select-box{display:flex;align-items:center;gap:.3em;border-radius:var(--mk-radius-sm);padding:.1em .2em;cursor:pointer}
.mk-select-value{min-width:6em;text-align:center}
.mk-select-arrow{font:inherit;color:var(--mk-text);background:none;border:0;padding:.2em .5em;cursor:pointer;min-width:2em;min-height:2em}
.mk-root[dir=rtl] .mk-select-arrow{transform:scaleX(-1)}
.mk-tabs{display:flex;flex-direction:column;gap:.75em;min-height:0}
.mk-tablist{display:flex;align-items:center;gap:.35em;border-block-end:.09em solid var(--mk-border);padding-block-end:.4em}
.mk-tab{font:inherit;font-weight:600;color:var(--mk-muted);background:none;border:0;border-block-end:.2em solid transparent;padding:.4em .9em;min-height:2.5em;cursor:pointer;border-radius:var(--mk-radius-sm)}
.mk-tab[aria-selected=true]{color:var(--mk-text);border-block-end-color:var(--mk-accent)}
.mk-tabpanel{min-height:0;overflow:auto}
.mk-field{display:flex;flex-direction:column;gap:.3em}
.mk-input{font:inherit;color:var(--mk-text);background:var(--mk-bg);border:.09em solid var(--mk-border);border-radius:var(--mk-radius-sm);padding:.5em .7em;min-height:2.5em;user-select:text;-webkit-user-select:text}
.mk-bar{position:relative;height:.9em;min-width:6em;border-radius:1em;background:var(--mk-track);border:.09em solid var(--mk-border);overflow:hidden;contain:strict}
.mk-bar .mk-fill,.mk-bar .mk-ghost{position:absolute;inset:0;background:var(--mk-tone,var(--mk-accent));transform:scaleX(var(--p,0));transform-origin:left;transition:transform var(--mk-fast) linear}
.mk-bar .mk-ghost{background:var(--mk-text);opacity:.55;transition:transform .5s ease-in .35s}
.mk-meter{display:flex;align-items:center;gap:.5em}
.mk-meter-icon{flex:none;width:1.2em;text-align:center}
.mk-meter .mk-bar{flex:1 1 auto}
.mk-meter-value{min-width:4.2em;text-align:end;font-variant-numeric:tabular-nums;font-size:.85em;text-shadow:0 .06em .2em #000a}
.mk-meter.mk-low .mk-bar{outline:.14em dashed var(--mk-bad);outline-offset:.1em}
.mk-tip-host{position:relative;display:inline-flex}
.mk-tip{position:absolute;inset-block-end:calc(100% + .5em);inset-inline-start:50%;transform:translateX(calc(-50% * var(--mk-sign))) translateY(.3em);width:max-content;max-width:16em;padding:.4em .7em;font-size:.85em;color:var(--mk-text);background:var(--mk-bg);border:.06em solid var(--mk-border);border-radius:var(--mk-radius-sm);box-shadow:var(--mk-shadow);opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--mk-fast) ease .25s,transform var(--mk-fast) ease .25s,visibility 0s linear .4s;z-index:5}
.mk-tip-bottom>.mk-tip{inset-block-end:auto;inset-block-start:calc(100% + .5em)}
.mk-tip-host:hover>.mk-tip,.mk-tip-host:focus-within>.mk-tip{opacity:1;visibility:visible;transform:translateX(calc(-50% * var(--mk-sign)));transition-delay:.25s,.25s,0s}
.mk-modal-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:max(1em,env(safe-area-inset-top)) max(1em,env(safe-area-inset-right)) max(1em,env(safe-area-inset-bottom)) max(1em,env(safe-area-inset-left));transition:opacity var(--mk-slow) ease}
.mk-scrim{position:absolute;inset:0;background:var(--mk-scrim)}
.mk-modal{position:relative;display:flex;flex-direction:column;gap:.75em;max-width:min(100%,40em);max-height:100%;min-width:min(100%,20em);overflow:auto;padding:1.25em;background:var(--mk-surface);border:.09em solid var(--mk-border);border-radius:calc(var(--mk-radius) * 1.5);box-shadow:var(--mk-shadow);transition:transform var(--mk-slow) cubic-bezier(.2,.8,.2,1);overscroll-behavior:contain}
.mk-modal-wrap.mk-enter,.mk-modal-wrap.mk-leave{opacity:0}
.mk-modal-wrap.mk-enter .mk-modal,.mk-modal-wrap.mk-leave .mk-modal{transform:scale(.95)}
.mk-modal h2{font-size:1.35em;line-height:1.2}
.mk-vlist{position:relative;overflow-y:auto;overscroll-behavior:contain;border:.09em solid var(--mk-border);border-radius:var(--mk-radius);background:var(--mk-bg);contain:strict}
.mk-vspace{position:relative;contain:layout size style}
.mk-vrow{position:absolute;inset-inline:0;inset-block-start:0;display:flex;align-items:center;padding-inline:.75em;contain:layout paint style;cursor:pointer}
.mk-vrow[aria-selected=true]{background:var(--mk-surface2);box-shadow:inset calc(.25em * var(--mk-sign)) 0 0 var(--mk-accent)}
.mk-inv{display:grid;gap:.4em;touch-action:none}
.mk-slot{position:relative;aspect-ratio:1;min-width:var(--mk-touch);font:inherit;font-size:1em;color:var(--mk-text);background:var(--mk-bg);border:.09em solid var(--mk-border);border-radius:var(--mk-radius-sm);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;touch-action:none}
.mk-slot.mk-filled{background:var(--mk-surface2)}
.mk-slot.mk-held{border:.19em dashed var(--mk-accent)}
.mk-slot.mk-drop{border:.19em solid var(--mk-accent)}
.mk-slot.mk-dragging>*{opacity:.3}
.mk-item-icon{font-size:1.5em;line-height:1;pointer-events:none}
.mk-count{position:absolute;inset-block-end:.1em;inset-inline-end:.3em;font-size:.75em;font-weight:700;font-variant-numeric:tabular-nums;pointer-events:none}
.mk-drag-ghost{position:fixed;left:0;top:0;z-index:50;pointer-events:none;font-size:2em;line-height:1;will-change:transform;filter:drop-shadow(0 .1em .2em #0008)}
.mk-dialogue-wrap{position:absolute;inset-inline:0;inset-block-end:0;display:flex;justify-content:center;padding:max(1em,env(safe-area-inset-bottom)) max(1em,env(safe-area-inset-right)) max(1em,env(safe-area-inset-bottom)) max(1em,env(safe-area-inset-left));pointer-events:none}
.mk-dialogue{pointer-events:auto;display:flex;flex-direction:column;gap:.5em;width:min(100%,44em);padding:1em 1.25em;background:var(--mk-surface);border:.09em solid var(--mk-border);border-radius:calc(var(--mk-radius) * 1.5);box-shadow:var(--mk-shadow)}
.mk-speaker{font-weight:700;color:var(--mk-accent)}
.mk-dialogue-text{font-size:1.1em;line-height:1.6;min-height:3.2em;white-space:pre-wrap}
.mk-unseen{visibility:hidden}
.mk-choices{display:flex;flex-direction:column;gap:.4em}
.mk-dialogue-foot{display:flex;justify-content:flex-end}
.mk-radial{position:relative;border-radius:50%;background:radial-gradient(closest-side,transparent 34%,var(--mk-scrim) 35%);touch-action:none}
.mk-radial-item{position:absolute;inset-inline-start:50%;inset-block-start:50%;left:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.1em;width:4.4em;height:4.4em;margin:-2.2em 0 0 -2.2em;font:inherit;font-size:.85em;color:var(--mk-text);background:var(--mk-surface2);border:.09em solid var(--mk-border);border-radius:50%;cursor:pointer;padding:.2em}
.mk-radial-item.mk-on{background:var(--mk-accent);color:var(--mk-on-accent);border-color:var(--mk-text)}
.mk-radial-icon{font-size:1.5em;line-height:1}
.mk-radial-centre{position:absolute;inset:38%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;pointer-events:none}
.mk-modal.mk-bare{background:none;border:0;box-shadow:none;padding:0;overflow:visible;min-width:0}
.mk-minimap{position:relative;border:.14em solid var(--mk-border);background:var(--mk-surface);overflow:hidden;contain:strict;box-shadow:var(--mk-shadow)}
.mk-minimap.mk-round{border-radius:50%}
.mk-minimap-map{position:absolute;inset:0;will-change:transform}
.mk-blip{position:absolute;left:50%;top:50%;width:.6em;height:.6em;margin:-.3em;border-radius:50%;background:var(--mk-info);border:.06em solid var(--mk-bg)}
.mk-blip-goal{background:var(--mk-accent);border-radius:0;rotate:45deg}
.mk-blip-enemy{background:var(--mk-bad);border-radius:0;clip-path:polygon(50% 0,100% 100%,0 100%)}
.mk-minimap-you{position:absolute;left:50%;top:50%;width:0;height:0;margin:-.45em -.35em;border-inline:.35em solid transparent;border-block-end:.9em solid var(--mk-text)}
.mk-minimap-north{position:absolute;left:50%;top:50%;width:1.2em;height:1.2em;margin:-.6em;display:flex;align-items:center;justify-content:center;font-size:.7em;font-weight:700;color:var(--mk-accent);text-shadow:0 0 .2em var(--mk-bg)}
.mk-objectives{min-width:12em;max-width:18em;padding:.6em .8em;background:var(--mk-surface);border:.06em solid var(--mk-border);border-radius:var(--mk-radius)}
.mk-objectives h3{font-size:.8em;letter-spacing:.06em;color:var(--mk-muted);margin-block-end:.3em}
.mk-objectives ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.25em}
.mk-objectives li{display:flex;gap:.5em;align-items:baseline}
.mk-objectives li.mk-done{color:var(--mk-muted);text-decoration:line-through}
.mk-check{flex:none;width:1em;color:var(--mk-good);text-decoration:none}
.mk-obj-count{margin-inline-start:auto;font-variant-numeric:tabular-nums;color:var(--mk-muted)}
.mk-toasts{display:flex;flex-direction:column;gap:.4em;align-items:flex-end;max-width:min(100%,22em)}
.mk-toast{display:flex;align-items:center;gap:.6em;padding:.5em .9em;background:var(--mk-surface);border:.06em solid var(--mk-border);border-inline-start:.3em solid var(--mk-tone,var(--mk-info));border-radius:var(--mk-radius-sm);box-shadow:var(--mk-shadow);animation:mk-toast-in var(--mk-slow) cubic-bezier(.2,.8,.2,1)}
@keyframes mk-toast-in{from{opacity:0;transform:translateY(-.6em)}}
.mk-toast-icon{flex:none;font-weight:700;color:var(--mk-tone,var(--mk-info))}
.mk-rebind{display:flex;flex-direction:column;gap:.3em}
.mk-rebind-row{display:flex;align-items:center;justify-content:space-between;gap:1em;padding-inline:.25em}
.mk-key{min-width:7em}
`;
const use = (ctx) => { const kit = ctx && ctx.kit; if (!kit) throw new Error('ui-widgets: mount through kit.mount() (the widgets need the kit)'); kit.addStyles('mk-widgets-css', CSS); return kit; };
let uid = 0;
const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));
const isRTL = (kit) => kit.i18n.dir.peek() === 'rtl';

// ---- small things
/** The button glyph of an action ('interact', 'jump', or a UI verb: 'confirm', 'cancel', 'tabPrev', 'tabNext') on the
 *  device in the player's hands. Follows the device, the pad family and rebinding. */
export function Glyph({ action, class: c }, ctx) {
  const kit = use(ctx);
  return h('kbd', { class: ['mk-glyph', c], 'data-kind': () => kit.glyph(read(action)).kind }, () => kit.glyph(read(action)).text);
}
/** "[E] Open the door": a glyph and a label. */
export function Prompt({ action, label }, ctx) { use(ctx); return h('div', { class: 'mk-prompt' }, h(Glyph, { action }), h('span', null, label)); }

/** { label, onPress, variant: 'primary' | 'ghost' | 'wide', glyph: action, icon, disabled } and any attribute. */
export function Button({ label, onPress, variant, glyph, icon, children, class: c, ...rest }, ctx) {
  use(ctx);
  return h('button', { type: 'button', class: ['mk-btn', variant && 'mk-btn-' + variant, c], onClick: (e) => onPress && onPress(e), ...rest },
    icon != null ? h('span', { class: 'mk-icon', 'aria-hidden': 'true' }, icon) : null,
    label != null ? h('span', { class: 'mk-btn-label' }, label) : null, ...(children || []),
    glyph ? h(Glyph, { action: glyph }) : null);
}

/** A switch: { value: signal(boolean), label, onChange } */
export function Toggle({ value, label, onChange, ...rest }, ctx) {
  const kit = use(ctx);
  return h('button', { type: 'button', role: 'switch', class: 'mk-toggle', 'aria-checked': () => String(!!value.value), onClick: () => { const v = !value.peek(); value.value = v; onChange && onChange(v); }, ...rest },
    h('span', { class: 'mk-toggle-label' }, label), h('span', { class: 'mk-spacer' }),
    h('span', { class: 'mk-toggle-state', 'aria-hidden': 'true' }, () => kit.t(value.value ? 'ui.on' : 'ui.off')),   // the state in words, not only a colour
    h('span', { class: 'mk-switch', 'aria-hidden': 'true' }, h('span', { class: 'mk-knob' })));
}

/** { value: signal(number), min, max, step, label, format(v), onChange }: drag, arrows / d-pad / stick, Home / End */
export function Slider({ value, min = 0, max = 1, step = 0.05, label, format, onChange, ...rest }, ctx) {
  const kit = use(ctx);
  const set = (v) => { v = +Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(6); if (v !== value.peek()) { value.value = v; onChange && onChange(v); } };
  const text = () => (format ? format(value.value) : kit.i18n.number(value.value, { maximumFractionDigits: 2 }));
  let rect = null;   // read once per drag
  const at = (e) => { const p = (e.clientX - rect.left) / rect.width; set(min + (isRTL(kit) ? 1 - p : p) * (max - min)); };
  return h('div', { class: 'mk-slider', ...rest },
    h('span', { class: 'mk-slider-label', 'aria-hidden': 'true' }, label),
    h('div', { class: 'mk-track', role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-orientation': 'horizontal', 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': () => value.value, 'aria-valuetext': text,
      style: { '--p': () => clamp01((value.value - min) / (max - min)).toFixed(4) },
      onPointerdown: (e) => { const t = e.currentTarget; rect = t.getBoundingClientRect(); t.setPointerCapture && t.setPointerCapture(e.pointerId); t.focus(); at(e); },
      onPointermove: (e) => { if (rect) at(e); }, onPointerup: () => { rect = null; }, onPointercancel: () => { rect = null; },
      onKeydown: (e) => { const big = (max - min) / 10; const v = { Home: min, End: max, PageUp: value.peek() + big, PageDown: value.peek() - big }[e.key]; if (v != null) { set(v); e.preventDefault(); } },
      'on:mk-nav': (e) => { const d = e.detail.dir; if (d !== 'left' && d !== 'right') return; set(value.peek() + (d === 'right' ? 1 : -1) * (isRTL(kit) ? -1 : 1) * step); e.preventDefault(); } },
      h('div', { class: 'mk-fill' }), h('div', { class: 'mk-rail' }, h('div', { class: 'mk-thumb' }))),
    h('span', { class: 'mk-slider-value', 'aria-hidden': 'true' }, text));
}

/** One of a few options, stepped with left / right: { value: signal, options: [{ value, label }] (may be reactive), label, onChange } */
export function Select({ value, options, label, onChange, ...rest }, ctx) {
  const kit = use(ctx);
  const index = () => Math.max(0, read(options).findIndex((o) => o.value === value.value));
  const current = () => { const o = read(options)[index()]; return o ? read(o.label) : ''; };
  const step = (d) => untracked(() => { const o = read(options), n = o[(index() + d + o.length) % o.length]; if (n && n.value !== value.peek()) { value.value = n.value; onChange && onChange(n.value); } });
  const dirStep = (d) => step(d * (isRTL(kit) ? -1 : 1));
  return h('div', { class: 'mk-select', ...rest },
    h('span', { class: 'mk-select-label', 'aria-hidden': 'true' }, label),
    h('div', { class: 'mk-select-box', role: 'spinbutton', tabIndex: 0, 'aria-label': label, 'aria-valuetext': current, 'aria-valuenow': index,
      onClick: (e) => { if (!e.target.closest('.mk-select-arrow')) step(1); },
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { step(1); e.preventDefault(); } },
      'on:mk-nav': (e) => { const d = e.detail.dir; if (d !== 'left' && d !== 'right') return; dirStep(d === 'right' ? 1 : -1); e.preventDefault(); } },
      h('button', { type: 'button', class: 'mk-select-arrow', tabIndex: -1, 'aria-label': kit.tx('ui.previous'), onClick: () => step(-1) }, '‹'),
      h('span', { class: 'mk-select-value' }, current),
      h('button', { type: 'button', class: 'mk-select-arrow', tabIndex: -1, 'aria-label': kit.tx('ui.following'), onClick: () => step(1) }, '›')));
}

/** { tabs: [{ id, label, content: () => description }], value: signal(id), label }. LB / RB and Q / E switch while
 *  the tabs are in the open scope; left / right on the strip; only the chosen panel is mounted. */
export function Tabs({ tabs, value, label, ...rest }, ctx) {
  const kit = use(ctx), id = 'mk-tabs-' + (++uid);
  value ||= signal(tabs[0].id);
  let el = null;
  const step = (d, focus) => { const i = tabs.findIndex((t) => t.id === value.peek()); value.value = tabs[(i + d + tabs.length) % tabs.length].id; const a = kit.doc.activeElement; if (el && (focus || !a || a === kit.doc.body || !a.isConnected)) { const b = el.querySelector('[aria-selected=true]'); if (b) b.focus(); } };   // the panel that held focus is gone: focus would fall to <body>, out of the scope
  const mine = () => el && el.isConnected && (!kit.nav.scope || kit.nav.scope.el.contains(el));
  const onTab = (e) => { if (mine()) { step(e.detail.step, el.contains(kit.doc.activeElement) && kit.doc.activeElement.getAttribute('role') === 'tab'); e.preventDefault(); } };
  const onKey = (e) => { if ((e.code === 'KeyQ' || e.code === 'KeyE') && kit.nav.depth && mine() && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !kit.nav.suspended) step(e.code === 'KeyE' ? 1 : -1, false); };
  kit.root.addEventListener('mk-tab', onTab); kit.root.addEventListener('keydown', onKey);
  onCleanup(() => { kit.root.removeEventListener('mk-tab', onTab); kit.root.removeEventListener('keydown', onKey); });
  return h('div', { class: 'mk-tabs', ref: (e) => { el = e; }, ...rest },
    h('div', { class: 'mk-tablist', role: 'tablist', 'aria-label': label },
      h(Glyph, { action: 'tabPrev', class: 'mk-tab-hint' }),
      tabs.map((t) => h('button', { type: 'button', role: 'tab', class: 'mk-tab', id: `${id}-${t.id}`, 'aria-controls': `${id}-panel`, 'aria-selected': () => String(value.value === t.id), tabIndex: () => (value.value === t.id ? 0 : -1),
        onClick: () => { value.value = t.id; },
        'on:mk-nav': (e) => { const d = e.detail.dir; if (d !== 'left' && d !== 'right') return; step((d === 'right' ? 1 : -1) * (isRTL(kit) ? -1 : 1), true); e.preventDefault(); } }, t.label)),
      h('span', { class: 'mk-spacer' }), h(Glyph, { action: 'tabNext', class: 'mk-tab-hint' })),
    h('div', { class: 'mk-tabpanel', role: 'tabpanel', id: `${id}-panel`, 'aria-labelledby': () => `${id}-${value.value}` },
      () => { const t = tabs.find((x) => x.id === value.value); return t ? untracked(() => t.content()) : null; }));
}

/** { value: signal(string), label, placeholder, maxLength, onSubmit }. The keys typed stay out of the game's input;
 *  IME composition is left alone (Enter that confirms a candidate does not submit). */
export function TextInput({ value, label, placeholder, maxLength, onSubmit, type = 'text', ...rest }, ctx) {
  use(ctx);
  return h('label', { class: 'mk-field' }, h('span', { class: 'mk-field-label' }, label),
    h('input', { class: 'mk-input', type, dir: 'auto', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder, maxlength: maxLength, value: () => value.value,
      onInput: (e) => { value.value = e.target.value; },
      onKeydown: (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && onSubmit) onSubmit(value.peek()); if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); },
      onKeyup: (e) => e.stopPropagation(), ...rest }));
}

/** A progress bar: { value: 0..1 (signal or function), label, tone: a token name ('accent', 'good', 'info') } */
export function Progress({ value, label, tone = 'accent', class: c, ...rest }, ctx) {
  use(ctx);
  return h('div', { class: ['mk-bar', c], role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': () => Math.round(clamp01(read(value)) * 100),
    style: { '--p': () => clamp01(read(value)).toFixed(4), '--mk-tone': `var(--mk-${tone})` }, ...rest }, h('div', { class: 'mk-fill' }));
}

/** A health / stamina bar: { value, max (numbers, signals or functions), label, tone: 'health' | 'stamina' | 'mana',
 *  icon, ghost: true (the lost part lingers, then drains), showValue: true, low: 0.25 (below it the bar is outlined
 *  with dashes: a shape cue, not only a colour) }. Only a transform changes when the value does. */
export function Bar({ value, max = 100, label, tone = 'health', icon, ghost = true, showValue = true, low = 0.25, class: c, ...rest }, ctx) {
  const kit = use(ctx);
  const ratio = () => clamp01(read(value) / (read(max) || 1));
  return h('div', { class: { 'mk-meter': true, ['mk-meter-' + tone]: true, 'mk-low': () => ratio() < low, ...(c ? { [c]: true } : {}) }, ...rest },
    icon != null ? h('span', { class: 'mk-meter-icon', 'aria-hidden': 'true' }, icon) : null,
    h('div', { class: 'mk-bar', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': () => read(max), 'aria-valuenow': () => Math.round(read(value)),
      style: { '--p': () => ratio().toFixed(4), '--mk-tone': `var(--mk-${tone})` } }, ghost ? h('div', { class: 'mk-ghost' }) : null, h('div', { class: 'mk-fill' })),
    showValue ? h('span', { class: 'mk-meter-value', 'aria-hidden': 'true' }, () => kit.t('ui.of', { value: Math.round(read(value)), max: read(max) })) : null);
}

/** Wrap something focusable: the text shows on hover and on focus (so a gamepad sees it too) and is its description. */
export function Tooltip({ text, placement = 'top', children }, ctx) {
  use(ctx);
  const id = 'mk-tip-' + (++uid);
  return h('span', { class: ['mk-tip-host', 'mk-tip-' + placement], ref: (el) => { const f = el.querySelector('button,[tabindex],input'); if (f) f.setAttribute('aria-describedby', id); } },
    ...(children || []), h('span', { class: 'mk-tip', role: 'tooltip', id }, text));
}

// ---- the modal stack
/** The kit's modal stack: modals(kit).open((close) => description, { label, onClose(result), dismissable: true,
 *  class }) -> { close(result), el, closed: Promise }. The top modal traps focus (Tab, arrows, gamepad), B / Escape
 *  / a click on the scrim close it, everything beneath is inert, and focus returns to where it was. */
export function modals(kit) {
  return kit.service('modals', () => {
    kit.addStyles('mk-widgets-css', CSS);
    const list = [], depth = signal(0), win = kit.doc.defaultView;
    const sync = () => {
      depth.value = list.length;
      for (const name of ['hud', 'world']) kit.layers[name].toggleAttribute('inert', list.length > 0);
      list.forEach((m, i) => m.wrap.toggleAttribute('inert', i < list.length - 1));
    };
    const svc = {
      /** how many are open (a signal: pause the game while it is not 0) */
      depth,
      open(content, { label, onClose, dismissable = true, class: c } = {}) {
        const m = { wrap: null, el: null, closed: false, pop: null };
        let done;
        const closed = new Promise((r) => { done = r; });
        const close = (result) => {
          if (m.closed) return;
          m.closed = true;
          list.splice(list.indexOf(m), 1); sync(); m.pop();
          const ms = kit.motion.peek() === 'reduced' ? 0 : 180;
          if (ms) { m.wrap.classList.add('mk-leave'); m.wrap.setAttribute('inert', ''); win.setTimeout(stop, ms); } else stop();
          onClose && onClose(result); done(result);
        };
        const stop = kit.mount(h('div', { class: 'mk-modal-wrap', ref: (e) => { m.wrap = e; } },
          h('div', { class: 'mk-scrim', onClick: () => dismissable && close() }),
          h('div', { class: ['mk-modal', c], role: 'dialog', 'aria-modal': 'true', 'aria-label': label, ref: (e) => { m.el = e; } }, content(close))), 'modal');
        if (kit.motion.peek() !== 'reduced') { m.wrap.classList.add('mk-enter'); m.wrap.getBoundingClientRect(); m.wrap.classList.remove('mk-enter'); }   // one style flush so the transition starts from the entered state
        list.push(m); sync();
        m.pop = kit.nav.pushScope(m.el, { onBack: dismissable ? () => close() : null });
        return { close, el: m.el, closed };
      },
      closeAll() { for (const m of [...list].reverse()) { m.closed = true; m.pop(); m.wrap.remove(); } list.length = 0; sync(); },
      dispose() { svc.closeAll(); },
    };
    return svc;
  });
}
/** A yes / no question: confirm(kit, { title, text, yes, no }) -> Promise<boolean> (B / Escape answer no). */
export function confirm(kit, { title, text, yes, no } = {}) {
  const m = modals(kit).open((close) => [title ? h('h2', null, title) : null, text ? h('p', null, text) : null,
    h('div', { class: 'mk-stack mk-row', style: { gap: '0.5em', justifyContent: 'flex-end' } },
      h(Button, { label: no || kit.tx('ui.cancel'), onPress: () => close(false), 'data-autofocus': true }),
      h(Button, { label: yes || kit.tx('ui.confirm'), variant: 'primary', onPress: () => close(true) }))], { label: title || text });
  return m.closed.then((r) => r === true);
}

// ---- a virtualised list
/** The rows to keep mounted: { first, last } (inclusive; last < first when empty). */
export function virtualRange(scrollTop, rowPx, viewPx, count, overscan = 2) {
  if (count <= 0 || rowPx <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.min(count - 1, Math.floor(scrollTop / rowPx) - overscan));
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewPx) / rowPx) - 1 + overscan);
  return { first, last: Math.max(first, last) };
}
/** A list of any length that mounts only the rows in view (plus overscan) and recycles them: scrolling by a row
 *  rebinds one row and moves it with a transform. { items (array, signal or function), render(item, index) (both
 *  signals), rowHeight and height in em, active: signal(index), onActivate(item, index), label }. Up / down, Home /
 *  End, PageUp / PageDown move the active row; Enter, A or a click activates it. */
export function VirtualList({ items, render, rowHeight = 2.5, height = 15, overscan = 3, active, onActivate, label, class: c, ...rest }, ctx) {
  const kit = use(ctx), id = 'mk-vl-' + (++uid);
  active ||= signal(0);
  const unit = () => 16 * kit.scale.value * kit.textScale.value, rowPx = () => rowHeight * unit(), viewPx = () => height * unit();
  const count = memo(() => read(items).length), top = signal(0);
  const pool = Math.ceil(height / rowHeight) + 2 * overscan + 1;
  const first = memo(() => virtualRange(top.value, rowPx(), viewPx(), count.value, overscan).first);
  let el = null;
  const reveal = (i) => untracked(() => {
    const y = i * rowPx(), t = top.peek(), v = viewPx();
    const to = y < t ? y : y + rowPx() > t + v ? y + rowPx() - v : t;
    if (to !== t && el) { el.scrollTop = to; top.value = to; }
  });
  const go = (i) => { const n = count.peek(); if (!n) return; i = Math.min(n - 1, Math.max(0, i)); active.value = i; reveal(i); };
  const fire = (i) => { const list = untracked(() => read(items)); if (list[i] !== undefined) { active.value = i; onActivate && onActivate(list[i], i); } };
  const rows = [];
  for (let s = 0; s < pool; s++) {
    // slot s shows the one index in [first, first + pool) that is s modulo pool: a row keeps its slot while in range
    const index = memo(() => { const f = first.value; return f + ((((s - f) % pool) + pool) % pool); });
    const item = computed(() => { const list = read(items); return list[Math.min(index.value, list.length - 1)]; });
    rows.push(h('div', { class: 'mk-vrow', role: 'option', id: `${id}-${s}`, hidden: () => index.value >= count.value, 'aria-selected': () => String(index.value === active.value),
      'aria-posinset': () => index.value + 1, 'aria-setsize': () => count.value,
      style: { transform: () => `translateY(${(index.value * rowPx()).toFixed(2)}px)`, height: () => rowPx().toFixed(2) + 'px' },
      onClick: () => fire(index.peek()) }, render(item, index)));
  }
  return h('div', { class: ['mk-vlist', c], role: 'listbox', tabIndex: 0, 'aria-label': label, 'aria-activedescendant': () => `${id}-${active.value % pool}`, ref: (e) => { el = e; },
    style: { height: () => viewPx().toFixed(2) + 'px' },
    onScroll: (e) => { top.value = e.target.scrollTop; },
    onKeydown: (e) => {
      const page = Math.max(1, Math.floor(height / rowHeight) - 1), a = active.peek();
      const to = { Home: 0, End: count.peek() - 1, PageUp: a - page, PageDown: a + page }[e.key];
      if (to != null) { go(to); e.preventDefault(); } else if (e.key === 'Enter' || e.key === ' ') { fire(a); e.preventDefault(); }
    },
    onClick: (e) => { if (e.target === e.currentTarget || e.detail === 0) fire(active.peek()); },   // detail 0: a synthetic click (gamepad A)
    'on:mk-nav': (e) => { const d = e.detail.dir, a = active.peek(); if (d === 'down' && a < count.peek() - 1) { go(a + 1); e.preventDefault(); } else if (d === 'up' && a > 0) { go(a - 1); e.preventDefault(); } }, ...rest },
    h('div', { class: 'mk-vspace', style: { height: () => (count.value * rowPx()).toFixed(2) + 'px' } }, show(() => count.value > 0, () => rows)));
}

// ---- inventory: drag and drop, and pick-and-place for keyboard and gamepad
/** Move the item in slot `from` to slot `to`: into an empty slot, onto the same stackable item (counts add up to
 *  maxStack, the rest stays), or swapping places. Returns a new array (the input is not changed); the same array
 *  when nothing moves. Items: { id, name, icon, count? } (a count makes an item stackable). */
export function moveItem(slots, from, to, { maxStack = 99 } = {}) {
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length || !slots[from]) return slots;
  const next = slots.slice(), a = next[from], b = next[to];
  if (b && b.id === a.id && a.count != null && b.count != null) {
    const total = a.count + b.count, put = Math.min(maxStack, total);
    if (put === b.count) return slots;   // the target stack is full
    next[to] = { ...b, count: put }; next[from] = total > put ? { ...a, count: total - put } : null;
  } else { next[to] = a; next[from] = b || null; }
  return next;
}
/** { slots: signal([item | null]), cols, label, onMove(from, to, slots), onUse(item, index), name(item), maxStack }.
 *  Mouse and touch drag an item onto a slot. Keyboard and gamepad: activate a slot to pick its item up, move, and
 *  activate another to put it down (B / Escape cancels; activating the same slot again uses the item). Each step is
 *  announced. */
export function InventoryGrid({ slots, cols = 5, label, onMove, onUse, name = (it) => read(it.name), maxStack = 99, class: c, ...rest }, ctx) {
  const kit = use(ctx), doc = kit.doc;
  const held = signal(-1), over = signal(-1), dragging = signal(-1);
  const n = slots.peek().length;
  const move = (from, to) => {
    const before = slots.peek(), next = moveItem(before, from, to, { maxStack });
    if (next === before) return false;
    const item = before[from];
    slots.value = next; onMove && onMove(from, to, next);
    kit.announce(kit.i18n.t('ui.moved', { item: untracked(() => name(item)), n: to + 1 }));
    return true;
  };
  const act = (i) => {
    const h0 = held.peek(), list = slots.peek();
    if (h0 < 0) { if (list[i]) { held.value = i; kit.announce(untracked(() => kit.i18n.t('ui.picked', { item: name(list[i]) }))); } return; }
    held.value = -1;
    if (h0 === i) { onUse && onUse(list[i], i); return; }
    move(h0, i);
  };
  // pointer drag: armed on pointerdown, started after 6 px, the ghost follows with a transform
  let drag = null, skipClick = false;
  const slotAt = (x, y) => { const e = doc.elementFromPoint(x, y), s = e && e.closest('[data-slot]'); return s && grid && grid.contains(s) ? +s.dataset.slot : -1; };
  const end = (e, cancelled) => {
    if (!drag) return;
    doc.removeEventListener('pointermove', onMoveP, true); doc.removeEventListener('pointerup', onUp, true); doc.removeEventListener('pointercancel', onCancel, true);
    const d = drag; drag = null;
    if (d.ghost) {
      d.ghost.remove(); skipClick = true; doc.defaultView.setTimeout(() => { skipClick = false; }, 0);
      const to = cancelled ? -1 : slotAt(e.clientX, e.clientY);
      batch(() => { dragging.value = -1; over.value = -1; });
      if (to >= 0) { move(d.from, to); const b = grid.querySelector(`[data-slot="${to}"]`); if (b) b.focus({ preventScroll: true }); }
    }
  };
  const onMoveP = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const item = slots.peek()[drag.from];
      drag.ghost = doc.createElement('div'); drag.ghost.className = 'mk-drag-ghost'; drag.ghost.textContent = String(read(item.icon) ?? name(item).slice(0, 1));
      kit.root.appendChild(drag.ghost);
      batch(() => { dragging.value = drag.from; held.value = -1; });
    }
    drag.ghost.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
    over.value = slotAt(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onUp = (e) => end(e, false), onCancel = (e) => end(e, true);
  onCleanup(() => end(null, true));
  let grid = null;
  const cells = [];
  for (let i = 0; i < n; i++) {
    cells.push(h('button', { type: 'button', 'data-slot': i, class: { 'mk-slot': true, 'mk-filled': () => !!slots.value[i], 'mk-held': () => held.value === i, 'mk-drop': () => over.value === i && dragging.value !== i, 'mk-dragging': () => dragging.value === i },
      'aria-label': () => { const it = slots.value[i]; return !it ? kit.t('ui.emptySlot', { n: i + 1 }) : it.count > 1 ? kit.t('ui.slotCount', { n: i + 1, item: name(it), count: it.count }) : kit.t('ui.slot', { n: i + 1, item: name(it) }); },
      'aria-pressed': () => (held.value === i ? 'true' : null),
      onClick: () => { if (!skipClick) act(i); },
      onPointerdown: (e) => {
        if (e.button > 0 || !slots.peek()[i] || drag) return;
        drag = { id: e.pointerId, from: i, x: e.clientX, y: e.clientY, ghost: null };
        if (e.target.releasePointerCapture && e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);   // touch captures implicitly: the slot under the finger must be hit-testable
        doc.addEventListener('pointermove', onMoveP, true); doc.addEventListener('pointerup', onUp, true); doc.addEventListener('pointercancel', onCancel, true);
      },
      'on:mk-back': (e) => { if (held.peek() >= 0) { held.value = -1; kit.announce(kit.i18n.t('ui.dropCancelled')); e.preventDefault(); } } },
    () => { const it = slots.value[i]; return it ? [h('span', { class: 'mk-item-icon', 'aria-hidden': 'true' }, read(it.icon) ?? untracked(() => name(it)).slice(0, 1)), it.count > 1 ? h('span', { class: 'mk-count', 'aria-hidden': 'true' }, kit.i18n.number(it.count)) : null] : null; }));
  }
  return h('div', { class: ['mk-inv', c], role: 'group', 'aria-label': label || kit.tx('ui.inventory'), style: { gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }, ref: (e) => { grid = e; }, ...rest }, cells);
}

// ---- dialogue
/** How many units of a typewriter text are visible after `elapsed` seconds at `perSecond` (0: all at once). */
export const revealCount = (elapsed, perSecond, total) => (perSecond <= 0 ? total : Math.min(total, Math.floor(elapsed * perSecond)));
const JOINED = /[֐-ࣿऀ-෿฀-໿יִ-﷿ﹰ-﻿]/;   // scripts whose letters join or stack: revealed a word at a time
/** The kit's dialogue box: await dialogue(kit).say({ speaker, text, choices: [text], speed: 40 }) -> the index of
 *  the choice (or -1 when there were none). The text types out by user-perceived character (by word in scripts
 *  whose letters join: Arabic, Devanagari, Thai), a press completes it, the next continues. The whole line is read
 *  to a screen reader at once; with reduced motion it appears at once. The box stays open between lines said back
 *  to back and closes when nothing follows. */
export function dialogue(kit) {
  return kit.service('dialogue', () => {
    kit.addStyles('mk-widgets-css', CSS);
    const line = signal(null), shown = signal(0), win = kit.doc.defaultView;
    const done = memo(() => !!line.value && shown.value >= line.value.units.length);
    let elapsed = 0, resolve = null, pop = null, box = null, closeTimer = 0;
    const finish = (r) => { const f = resolve; resolve = null; if (f) f(r); closeTimer = win.setTimeout(() => { if (!resolve) svc.close(); }, 0); };
    const refocus = () => win.queueMicrotask(() => { if (box && box.isConnected && pop) kit.nav.focusFirst(box); });
    const svc = {
      /** the line on screen (a signal; null when closed) */
      line,
      get open() { return !!line.peek(); },
      say({ speaker = '', text = '', choices = null, speed = 40 } = {}) {
        if (resolve) finish(-1);
        win.clearTimeout(closeTimer);
        const locale = kit.i18n.locale.peek(), s = String(text);
        const units = JOINED.test(s) ? breakPieces(s, locale) : graphemes(s, locale);
        elapsed = 0;
        batch(() => { shown.value = kit.motion.peek() === 'reduced' ? units.length : 0; line.value = { speaker, text: s, choices, units, speed }; });
        kit.announce(speaker ? `${read(speaker)}: ${s}` : s);
        if (!pop && box) pop = kit.nav.pushScope(box, { onBack: null });
        refocus();
        return new Promise((r) => { resolve = r; });
      },
      /** complete the typing, or (when complete and there are no choices) go on */
      advance() { const l = line.peek(); if (!l) return; if (!done.peek()) shown.value = l.units.length; else if (!l.choices || !l.choices.length) finish(-1); },
      choose(i) { if (done.peek()) finish(i); },
      close() { if (resolve) { const f = resolve; resolve = null; f(-1); } if (pop) { pop(); pop = null; } line.value = null; },
      dispose() { svc.close(); stopFrame(); stop(); stopFx(); },
    };
    const stopFrame = kit.onFrame((now, dt) => { const l = line.peek(); if (l && shown.peek() < l.units.length) { elapsed += dt; shown.value = revealCount(elapsed, l.speed, l.units.length); } });
    const stopFx = effect(() => { done.value; refocus(); });   // the footer was rebuilt (choices appeared): focus follows
    const stop = kit.mount(show(() => !!line.value, () => h('div', { class: 'mk-dialogue-wrap' },
      h('div', { class: 'mk-dialogue', role: 'dialog', 'aria-label': kit.tx('ui.dialogue'), ref: (e) => { box = e; }, onClick: (e) => { if (!e.target.closest('button')) svc.advance(); } },
        h('div', { class: 'mk-speaker' }, () => (line.value ? read(line.value.speaker) : '')),
        h('p', { class: 'mk-dialogue-text', 'aria-label': () => (line.value ? line.value.text : '') },
          h('span', { 'aria-hidden': 'true' }, () => (line.value ? line.value.units.slice(0, shown.value).join('') : '')),
          h('span', { class: 'mk-unseen', 'aria-hidden': 'true' }, () => (line.value ? line.value.units.slice(shown.value).join('') : ''))),
        () => {
          const l = line.value, d = done.value;
          if (l && d && l.choices && l.choices.length) return h('div', { class: 'mk-choices', role: 'group' }, l.choices.map((c, i) => h(Button, { label: c, variant: 'wide', onPress: () => svc.choose(i) })));
          return h('div', { class: 'mk-dialogue-foot' }, h(Button, { label: kit.tx(d ? 'ui.next' : 'ui.skip'), glyph: 'confirm', onPress: () => svc.advance() }));
        })), { transition: 'rise' }), 'modal');
    return svc;
  });
}

// ---- radial menu
/** The sector a direction points at: 0 is up, then clockwise; -1 inside the dead zone. (dx, dy): screen axes, y down. */
export function radialIndex(dx, dy, n, deadzone = 0.3) {
  if (n <= 0 || Math.hypot(dx, dy) < deadzone) return -1;
  const a = Math.atan2(dx, -dy), t = (a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2);
  return Math.round(t * n) % n;
}
/** A quick wheel: openRadial(kit, { items: [{ label, icon }], onPick(item, index), label, radius: 6 }) -> { close }.
 *  Point with the mouse or a finger, tilt the left stick, or step with arrows / d-pad; click, release a touch or
 *  press A to pick; B / Escape closes. */
export function openRadial(kit, { items, onPick, label, radius = 6 } = {}) {
  const n = items.length, sel = signal(-1), win = kit.doc.defaultView;
  let el = null, rect = null, stick = false;
  const focus = (i) => { sel.value = i; const b = el && el.children[i]; if (b && kit.doc.activeElement !== b) b.focus({ preventScroll: true }); };
  const point = (e) => { rect ||= el.getBoundingClientRect(); const R = rect.width / 2; return radialIndex((e.clientX - rect.left - R) / R, (e.clientY - rect.top - R) / R, n, 0.3); };
  const stopFrame = kit.onFrame(() => {
    const pads = win.navigator.getGamepads ? win.navigator.getGamepads() : [];
    let pad = null; for (const p of pads) if (p && p.connected !== false) { pad = p; break; }
    const i = pad ? radialIndex(pad.axes[0] || 0, pad.axes[1] || 0, n, 0.55) : -1;
    stick = i >= 0;
    if (stick && i !== sel.peek()) focus(i);
  });
  const m = modals(kit).open((close) => h('div', { class: 'mk-radial', role: 'menu', 'aria-label': label || kit.tx('ui.radial'), ref: (e) => { el = e; },
    style: { width: radius * 2 + 5 + 'em', height: radius * 2 + 5 + 'em' },
    onPointermove: (e) => { const i = point(e); if (i >= 0 && i !== sel.peek()) focus(i); },
    onPointerup: (e) => { if (e.pointerType === 'touch') { const i = point(e); if (i >= 0) { close(); onPick && onPick(items[i], i); } } },
    'on:mk-nav': (e) => { e.preventDefault(); if (stick) return; const d = e.detail.dir, s = sel.peek(); focus(s < 0 ? 0 : (s + (d === 'right' || d === 'down' ? 1 : -1) + n) % n); } },
    items.map((it, i) => { const a = (i / n) * Math.PI * 2; return h('button', { type: 'button', role: 'menuitem', class: { 'mk-radial-item': true, 'mk-on': () => sel.value === i },
      style: { transform: `translate(${(Math.sin(a) * radius).toFixed(3)}em,${(-Math.cos(a) * radius).toFixed(3)}em)` },
      onFocus: () => { sel.value = i; }, onClick: () => { close(); onPick && onPick(it, i); } },
      it.icon != null ? h('span', { class: 'mk-radial-icon', 'aria-hidden': 'true' }, it.icon) : null, h('span', null, it.label)); }),
    h('div', { class: 'mk-radial-centre', 'aria-hidden': 'true' }, () => (sel.value >= 0 ? read(items[sel.value].label) : ''))),
  { label: label || kit.tx('ui.radial'), class: 'mk-bare', onClose: () => stopFrame() });
  return m;
}

// ---- HUD pieces
/** A minimap frame: { size: em, round, heading: radians (signal or function; the map turns so "up" is ahead),
 *  markers: [{ id, x, y, kind: 'poi' | 'goal' | 'enemy' }] with x, y in -1..1 of the radius (reactive), label };
 *  children are the map itself (a canvas, an image). Kinds differ in shape as well as colour. */
export function MinimapFrame({ size = 9, round = true, heading = 0, markers = [], label, children, class: c, ...rest }, ctx) {
  const kit = use(ctx), half = size / 2;
  return h('div', { class: ['mk-minimap', round && 'mk-round', c], role: 'img', 'aria-label': label || kit.tx('ui.minimap'), style: { width: size + 'em', height: size + 'em' }, ...rest },
    h('div', { class: 'mk-minimap-map', style: { transform: () => `rotate(${(-read(heading)).toFixed(4)}rad)` } }, ...(children || []),
      each(markers, (m) => m.id, (m) => h('div', { class: () => 'mk-blip mk-blip-' + (m.value.kind || 'poi'), style: { transform: () => `translate(${(m.value.x * half).toFixed(3)}em,${(m.value.y * half).toFixed(3)}em)` } }))),
    h('div', { class: 'mk-minimap-north', 'aria-hidden': 'true', style: { transform: () => { const a = -read(heading); return `translate(${(Math.sin(a) * (half - 0.8) / 0.7).toFixed(3)}em,${(-Math.cos(a) * (half - 0.8) / 0.7).toFixed(3)}em)`; } } }, kit.tx('ui.north')),
    h('div', { class: 'mk-minimap-you', 'aria-hidden': 'true' }));
}

/** { objectives: [{ id, text, done, progress: '2 / 5' }] (reactive), title }. Rows are keyed: completing one
 *  restyles that row only. */
export function ObjectiveTracker({ objectives, title, class: c, ...rest }, ctx) {
  const kit = use(ctx);
  return h('section', { class: ['mk-objectives', c], 'aria-label': title || kit.tx('ui.objectives'), ...rest },
    h('h3', null, title || kit.tx('ui.objectives')),
    h('ul', { role: 'list' }, each(objectives, (o) => o.id, (o) => h('li', { class: { 'mk-done': () => !!o.value.done } },
      h('span', { class: 'mk-check', 'aria-hidden': 'true' }, () => (o.value.done ? '✓' : '○')),
      h('span', null, () => read(o.value.text)),
      h('span', { class: 'mk-obj-count' }, () => (o.value.progress != null && !o.value.done ? read(o.value.progress) : ''))))));
}

/** The kit's notifications: toasts(kit).push({ text, tone: 'info' | 'good' | 'warn' | 'bad', icon, duration: 4 })
 *  -> id; dismiss(id). At most `max` (4) show, the oldest goes first; each is announced (a 'bad' one interrupts). */
export function toasts(kit) {
  return kit.service('toasts', () => {
    kit.addStyles('mk-widgets-css', CSS);
    const list = signal([]), win = kit.doc.defaultView, timers = new Map();
    const ICON = { info: 'i', good: '✓', warn: '!', bad: '×' };
    let ids = 0;
    const svc = {
      list, max: 4,
      push({ text, tone = 'info', icon, duration = 4 } = {}) {
        const id = ++ids, s = String(read(text));
        list.value = [...list.peek(), { id, text: s, tone, icon: icon ?? ICON[tone] }].slice(-svc.max);
        kit.announce(s, { assertive: tone === 'bad' });
        if (duration > 0) timers.set(id, win.setTimeout(() => svc.dismiss(id), duration * 1000));
        return id;
      },
      dismiss(id) { win.clearTimeout(timers.get(id)); timers.delete(id); const l = list.peek(); if (l.some((t) => t.id === id)) list.value = l.filter((t) => t.id !== id); },
      dispose() { for (const t of timers.values()) win.clearTimeout(t); timers.clear(); stop(); },
    };
    const stop = kit.mount(h('div', { class: 'mk-safe' }, h('div', { class: 'mk-anchor mk-at-top-end' },
      h('div', { class: 'mk-toasts', role: 'log', 'aria-label': kit.tx('ui.notifications'), 'aria-live': 'off' },
        each(list, (t) => t.id, (t) => h('div', { class: 'mk-toast', style: { '--mk-tone': `var(--mk-${t.peek().tone})` } },
          h('span', { class: 'mk-toast-icon', 'aria-hidden': 'true' }, t.peek().icon), h('span', null, t.peek().text)))))), 'toast');
    return svc;
  });
}

/** Key rebinding as a widget: { input (createInput()), actions (default: all), onChange(bindings) }. A row per action;
 *  activating one waits for the next key (Escape cancels), rebinds it (a key serves one action) and says so. */
export function RebindList({ input, actions = ACTIONS, onChange, class: c, ...rest }, ctx) {
  const kit = use(ctx);
  const version = signal(0), waiting = signal(null);
  let abort = null;
  const changed = () => { version.value++; kit.rebound(); onChange && onChange(input.bindings); };
  const capture = async (a) => {
    if (abort) abort.abort();
    const mine = abort = new AbortController();
    waiting.value = a; kit.nav.suspended = true;
    const code = await input.capture(mine.signal);
    if (abort === mine) { abort = null; waiting.value = null; kit.nav.suspended = false; }
    if (!code) return;
    input.rebind(a, code); changed();
    kit.announce(kit.i18n.t('ui.rebound', { action: kit.i18n.t('action.' + a), key: keyName(code) }));
  };
  onCleanup(() => { if (abort) abort.abort(); kit.nav.suspended = false; });
  const key = (a) => (version.value, keyName((input.bindings[a] || [])[0] || '?'));
  return h('div', { class: ['mk-rebind', c], role: 'group', ...rest },
    actions.map((a) => h('div', { class: 'mk-rebind-row' }, h('span', { 'aria-hidden': 'true' }, kit.tx('action.' + a)),
      h('button', { type: 'button', class: 'mk-btn mk-key', 'data-action': a, 'aria-label': () => kit.t('ui.rebind', { action: kit.t('action.' + a), key: key(a) }), onClick: () => capture(a) },
        () => (waiting.value === a ? kit.t('ui.pressKey') : key(a))))),
    h(Button, { label: kit.tx('ui.reset'), variant: 'ghost', onPress: () => { input.reset(); changed(); } }));
}

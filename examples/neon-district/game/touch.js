// The touch controls, laid out the way mobile battle-royale shooters lay theirs out (the conventions only: the
// glyphs are drawn here, nothing is taken from any game's art):
//   left    a floating stick: it appears where the thumb lands in the lower left; pushed far up it locks a sprint
//           (a padlock above it lights, let go and the sprint holds; a new touch on the stick, or pulling back before
//           letting go, ends it). A second, smaller FIRE above it, and LEAN left / right beside that.
//   right   drag anywhere that is not a button to turn. FIRE big and low; AIM above it; RELOAD, CROUCH, JUMP in an arc
//           round FIRE; MELEE. A finger that starts on FIRE (either one) or AIM turns the view as it drags, so one thumb
//           fires and aims at once. AIM and LEAN: hold for as long as held, a quick tap toggles.
//   kit     a column left of RELOAD / CROUCH: HACK (hold on a target: its pips, the ring filling, dimmed with the
//           reason when nothing can be hacked), OVERDRIVE (a charge ring; lit when ready), GRENADE and DASH (cooldown
//           sweeps). The API they use: kit.hack.start() / cancel() / target() / charges / max / progress,
//           kit.abilities.use(name) / left(name) / cooldown(name) / charge / active.
//   guns    a strip of the five slots at the bottom centre: tap a slot to switch, swipe across it to cycle (locked
//           slots dashed; the 0 unlock is a field in the options panel).
//   USE     centre right (left of the kit column), only when there is something to use, with its label.
//   top right  the options panel and the overlay's menu. (The engine's quality / fps corner is hidden on touch: the
//           right edge belongs to the thumb; the title already hides it.)
// Every finger is its own pointer id (move, turn and fire together). It all feeds the engine's input (input.stick,
// hold, tap, addLook) and the flags this object exposes (fire, aim, lean); the overlay's own stick, look area and
// buttons are hidden under it. Turning is slower down the sight, and slower again while the crosshair is on a
// target (`slow`, set by the game each tick: a light aim assist, for touch only).
const CSS = `
.ndt{position:absolute;inset:0;pointer-events:auto;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;--o:.7}
.ndt *{box-sizing:border-box}
.ndt .ndt-b{position:absolute;display:grid;place-items:center;margin:0;padding:0;min-height:0;border-radius:50%;border:1.5px solid #8ff0ffb0;background:#03121acc;color:#e4fbff;opacity:var(--o);touch-action:none;transition:transform .06s,background .06s,opacity .15s;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;-webkit-tap-highlight-color:transparent;cursor:pointer}
.ndt .ndt-b svg{width:46%;height:46%;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.ndt .ndt-b.fire{border:2px solid #ff6a80d0;background:radial-gradient(circle,#ff31503a 0,#03121acc 70%);color:#ffe4e8}
.ndt .ndt-b.fire svg{width:40%;height:40%}
.ndt .ndt-b.lit{background:#19d8ff55;border-color:#c8f8ff;opacity:max(var(--o),.85)}
.ndt .ndt-b.on{transform:scale(.92);background:#19d8ff88;border-color:#fff;opacity:1}
.ndt .ndt-b.fire.on{background:#ff3150a0}
.ndt .ndt-b small{position:absolute;bottom:-1px;right:-1px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#03121a;border:1px solid #8ff0ff90;font-size:9px;line-height:13px;text-align:center}
.ndt .ndt-b[hidden]{display:none}
.ndt .ndt-b.kit{border-color:#7af0ffb0}
.ndt .ndt-b.kit:before{content:"";position:absolute;inset:-1px;border-radius:50%;background:conic-gradient(#02080ce0 var(--cd,0%),transparent 0);pointer-events:none}
.ndt .ndt-b.kit b{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:#fff;text-shadow:0 0 3px #000;pointer-events:none}
.ndt .ndt-b.kit.ready{border-color:#c8f8ff;box-shadow:0 0 8px #19d8ff80}
.ndt .ndt-b.over{border-color:#ff6ac8b0;color:#ffd8f0}
.ndt .ndt-b.over:before{background:conic-gradient(#ff3aa8 var(--ch,0%),transparent 0);-webkit-mask:radial-gradient(circle,transparent calc(50% - 4px),#000 calc(50% - 3px));mask:radial-gradient(circle,transparent calc(50% - 4px),#000 calc(50% - 3px))}
.ndt .ndt-b.over.ready{border-color:#ff8ad0;box-shadow:0 0 12px #ff3aa8a0;opacity:1}.ndt .ndt-b.over.active{background:#ff3aa860}
.ndt .ndt-b.hack{border-color:#19d8ffd0;color:#bff6ff}
.ndt .ndt-b.hack:before{background:conic-gradient(#19d8ff var(--hp,0%),transparent 0);-webkit-mask:radial-gradient(circle,transparent calc(50% - 4px),#000 calc(50% - 3px));mask:radial-gradient(circle,transparent calc(50% - 4px),#000 calc(50% - 3px))}
.ndt .ndt-b.hack.dim{opacity:calc(var(--o) * .5);border-color:#ff5a6a90;color:#ff9aa4}
.ndt .ndt-b.hack.dim:before{background:none}
.ndt .ndt-b.hack i{position:absolute;bottom:14%;left:50%;display:flex;gap:3px;transform:translateX(-50%);pointer-events:none}
.ndt .ndt-b.hack i u{width:5px;height:5px;transform:rotate(45deg);border:1px solid #19d8ff;background:#03121a}.ndt .ndt-b.hack i u.on{background:#19d8ff}
.ndt .ndt-b.hack em{position:absolute;right:calc(100% + 4px);top:50%;transform:translateY(-50%);font:600 9px/1.2 ui-monospace,monospace;letter-spacing:.06em;color:#ff9aa4;white-space:nowrap;font-style:normal;text-shadow:0 1px 2px #000;pointer-events:none}
.ndt .ndt-guns{position:absolute;display:flex;gap:3px;padding:0;margin:0;border:0;background:none;touch-action:none;opacity:var(--o)}
.ndt .ndt-guns i{position:relative;display:grid;place-items:center;width:30px;height:26px;border:1px solid #8ff0ff70;border-radius:5px;background:#03121acc;pointer-events:none}
.ndt .ndt-guns i svg{width:26px;height:14px;fill:none;stroke:#e4fbff;stroke-width:1.6;stroke-linejoin:round}
.ndt .ndt-guns i small{position:absolute;left:2px;top:0;font:600 7px/1 ui-monospace,monospace;opacity:.8}
.ndt .ndt-guns i.cur{border-color:#fff;background:#19d8ff66;box-shadow:0 0 6px #19d8ff}
.ndt .ndt-guns i.locked{opacity:.35;border-style:dashed}
.ndt .ndt-use{border-radius:26px;display:flex;align-items:center;gap:8px;padding:0 16px 0 6px;max-width:200px;border-color:#ffd34a;color:#fff3c8;background:#1a1404d8;opacity:max(var(--o),.9);font:600 12px/1.25 system-ui,-apple-system,var(--nd-cjk,"PingFang TC"),sans-serif;letter-spacing:.01em;text-align:left}
.ndt .ndt-use i{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#ffd34a;color:#1a1404}
.ndt .ndt-use i svg{width:62%;height:62%}
.ndt .ndt-use span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ndt-base{position:absolute;border-radius:50%;border:1.5px solid #8ff0ff70;background:radial-gradient(circle,#03121a40 0,#03121a90 100%);opacity:calc(var(--o) * .7);pointer-events:none;transition:opacity .15s}
.ndt-base.live{opacity:max(var(--o),.85)}
.ndt-base.run{border-color:#ffd34a}
.ndt-knob{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22%;border-radius:50%;background:#d8f6ffcc;box-shadow:0 0 10px #19d8ff80}
.ndt-lock{position:absolute;display:grid;place-items:center;border-radius:50%;border:1.5px dashed #8ff0ff60;color:#8ff0ffa0;pointer-events:none;opacity:0;transition:opacity .15s}
.ndt-lock svg{width:58%;height:58%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ndt-lock.show{opacity:calc(var(--o) * .9)}
.ndt-lock.armed{opacity:1;border-style:solid;border-color:#ffd34a;color:#ffd34a;background:#ffd34a30}
.ndt-lock.on{opacity:1;border-style:solid;border-color:#ffd34a;color:#1a1404;background:#ffd34ae0}
body.nd-touch,body.nd-touch canvas{overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body.nd-touch .mg-touch .mg-stick,body.nd-touch .mg-touch .mg-btns,body.nd-touch .mg-touch .mg-menubtn,body.nd-touch .mg-prompt{display:none!important}
body.nd-touch .mg-hud{right:auto;left:max(12px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));flex-direction:column;align-items:flex-start;gap:4px;max-width:min(30vw,280px)}
body.nd-touch .mg-obj{font-size:12px;line-height:1.3;padding:5px 9px}
body.nd-touch .mg-obj b{font-size:10px}
body.nd-touch .mg-items li{font-size:11px;padding:3px 7px}
body.nd-touch .mg-toast{top:calc(var(--ndt-zone-t,34%) + 8px);left:calc(50% + (var(--ndt-band-l,0px) - var(--ndt-band-r,0px)) / 2);width:max-content;max-width:calc(100vw - var(--ndt-band-l,0px) - var(--ndt-band-r,0px));font-size:14px;line-height:1.3}
body.nd-touch .mirage-hud{display:none!important}
body.nd-touch .ndx-bar{display:none!important}
`;

import { ICON } from './hud.js';

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const G = {
  fire: svg('<path d="M12 2.5c2.4 2.1 3.2 4.7 3.2 7.3v8.4H8.8V9.8c0-2.6.8-5.2 3.2-7.3z"/><path d="M8 21.5h8M8.8 11h6.4"/>'),
  aim: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r=".6"/>'),
  reload: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4h-4"/>'),
  crouch: svg('<path d="M12 3.5v11M7 10l5 5 5-5M4.5 20h15"/>'),
  jump: svg('<path d="M12 18V6.5M7 11l5-5 5 5M4.5 21h15"/>'),
  melee: svg('<path d="M4 20l9.5-9.5M13.5 10.5 19 4.5l.5 3.2-5 4.6M7 13.5l3.5 3.5"/>'),
  leanL: svg('<path d="M15.5 21 11 7.5"/><circle cx="10.4" cy="4.6" r="1.8"/><path d="M8 13H2.5M5 10.5 2.5 13 5 15.5"/>'),
  leanR: svg('<path d="M8.5 21 13 7.5"/><circle cx="13.6" cy="4.6" r="1.8"/><path d="M16 13h5.5M19 10.5l2.5 2.5-2.5 2.5"/>'),
  use: svg('<path d="M9 12.5V5a1.5 1.5 0 0 1 3 0v6M12 10a1.5 1.5 0 0 1 3 0v2M15 11a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-.8a5 5 0 0 1-4-2l-2.6-3.6a1.4 1.4 0 0 1 2.1-1.8L9 15.5"/>'),
  opt: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  lock: svg('<rect x="6" y="11" width="12" height="9" rx="1.6"/><path d="M9 11V8.2a3 3 0 0 1 6 0V11"/>'),
  hack: svg('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 12h6M12 9v6"/>'),
  dash: svg('<path d="M3 12h11M10 7l5 5-5 5M18 5v14"/>'),
  grenade: svg('<circle cx="12" cy="13.5" r="6"/><path d="M12 2.5v4M6 5l2.2 2.2M18 5l-2.2 2.2M9.5 13.5l1.7-2.5 1.7 3.5 1.6-2.5"/>'),
  over: svg('<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>'),
};

// the layout at a scale of 1 on a 844 x 390 screen: [id, side, a, b, r]. Side 'r': a is the centre's distance from
// the right safe edge, b from the bottom; 'l' the same from the left; 'tr' a from the right, b from the TOP. An arc
// round FIRE whose bounding squares do not overlap either (scripts/controls-check.mjs checks them at three sizes).
const LAYOUT = [
  ['fire', 'r', 96, 92, 46],
  ['dash', 'r', 232, 50, 22],
  ['grenade', 'r', 232, 104, 22],
  ['over', 'r', 232, 160, 24],
  ['hack', 'r', 232, 226, 28],
  ['crouch', 'r', 172, 66, 26],
  ['reload', 'r', 172, 150, 26],
  ['aim', 'r', 104, 176, 32],
  ['jump', 'r', 36, 168, 26],
  ['melee', 'r', 38, 232, 22],
  ['fireL', 'l', 52, 236, 32],
  ['leanL', 'l', 138, 232, 24],
  ['leanR', 'l', 198, 232, 24],
  ['opt', 'tr', 30, 30, 21],
  ['menu', 'tr', 82, 30, 21],
];
const STICK = { a: 100, b: 96, r: 56 }, USE = { a: 268, b: 205, h: 46 }, GUNS = { b: 6 }, EDGE = 10;
// the stick's zone (where a thumb that lands starts the floating stick): the lower left, at most ZONE.w px wide and
// ZONE.h px tall from the safe corner (on a tablet the thumb does not reach further), and never more than a share of
// the screen. Nothing informational is drawn there or under a button: the HUD keeps to the band between (--ndt-*).
const ZONE = { w: 300, h: 330, fw: 0.37, fh: 0.6 };
const KIT = ['hack', 'dash', 'grenade', 'over'], ARMS_IDS = ['sidearm', 'carbine', 'shotgun', 'rocket', 'gatling'];
const TAP_S = 0.22, TAP_PX = 14;   // a quick tap: shorter than this and moved less than this toggles AIM / LEAN

/**
 * @param o.T the language's table   o.input the engine's input   o.opts the player's settings (tSens, tOpacity,
 *   tScale, leftFire, sprintLock, sens)   o.parent the overlay's touch layer
 * @param o.on { reload(), crouch(), melee(), options(), select(id), cycle(dir) } the one-shot actions the game does itself
 * @param o.ready () => bool: the game has started (the title is gone)   o.paused () => bool
 * @param o.kit the city kit (kit.js: hack, abilities)   o.weapon the arsenal (weapon.js: W, id, switchingTo)
 */
export function createTouch({ T, input, opts, parent, on, ready, paused, onDispose, kit = null, weapon = null }) {
  if (!document.getElementById('ndt-css')) { const s = document.createElement('style'); s.id = 'ndt-css'; s.textContent = CSS; document.head.appendChild(s); }
  const L = T.touch;   // a live branch (text.js swaps its strings in place)
  const layer = document.createElement('div'); layer.className = 'ndt';
  const inner = (id) => (id === 'leanL' ? '<small>L</small>' : id === 'leanR' ? '<small>R</small>' : id === 'hack' ? '<i><u></u><u></u><u></u></i><em></em>' : KIT.includes(id) ? '<b></b>' : '');
  const cls = (id) => (id === 'fire' || id === 'fireL' ? 'fire' : id === 'hack' ? 'kit hack' : id === 'over' ? 'kit over' : KIT.includes(id) ? 'kit' : '');
  layer.innerHTML = LAYOUT.map(([id]) => `<button type="button" class="ndt-b ${cls(id)}" data-b="${id}" aria-label="${L[id]}">${G[id.startsWith('fire') ? 'fire' : id]}${inner(id)}</button>`).join('') +
    `<div class="ndt-guns" data-b="guns" role="toolbar" aria-label="${L.guns}">${ARMS_IDS.map((id, i) => `<i data-g="${id}"><small>${i + 1}</small>${ICON[id]}</i>`).join('')}</div>
     <button type="button" class="ndt-b ndt-use" data-b="use" hidden><i>${G.use}</i><span></span></button>
     <div class="ndt-base"><div class="ndt-knob"></div></div><div class="ndt-lock" aria-hidden="true">${G.lock}</div>
     <div class="ndt-probe" style="position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"></div>`;
  (parent || document.body).appendChild(layer);
  document.body.classList.add('nd-touch');
  const $ = (s) => layer.querySelector(s);
  const B = Object.fromEntries([...layer.querySelectorAll('[data-b]')].map((b) => [b.dataset.b, b]));
  const base = $('.ndt-base'), knob = $('.ndt-knob'), lockEl = $('.ndt-lock'), probe = $('.ndt-probe'), useText = $('.ndt-use span');
  const ptrs = new Map();   // pointer id -> { role, x, y, x0, y0, t0 }
  const st = { fire: 0, fireL: 0, aimHold: false, aimLatch: false, leanHold: 0, leanLatch: 0, locked: false, armed: false, slow: 1 };
  let k = 1, W = 0, H = 0, safe = { l: 0, r: 0, t: 0, b: 0 }, rest = [0, 0], R = STICK.r, baseAt = null, useLabel = null;
  const zone = { r: 0, t: 0 };
  const vibe = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  // ---- layout: from the viewport, the safe area and the player's size setting; again on resize and on a setting
  const place = (el, cx, cy, r) => { el.style.left = `${(cx - r).toFixed(1)}px`; el.style.top = `${(cy - r).toFixed(1)}px`; el.style.width = el.style.height = `${(2 * r).toFixed(1)}px`; };
  function layout() {
    W = innerWidth; H = innerHeight;
    const cs = getComputedStyle(probe);
    safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    k = (+opts.tScale || 1) * Math.min(1, Math.max(0.72, Math.min(H / 390, W / 760)));
    const right = W - Math.max(EDGE, safe.r), left = Math.max(EDGE, safe.l), bottom = H - Math.max(EDGE, safe.b), top = Math.max(EDGE, safe.t);
    for (const [id, side, a, b, r] of LAYOUT) {
      const cx = side === 'l' ? left + a * k : right - a * k, cy = side === 'tr' ? top + b * k : bottom - b * k;
      place(B[id], cx, cy, r * k);
    }
    B.fireL.hidden = opts.leftFire === false;
    const u = B.use; u.style.right = `${(W - right + USE.a * k).toFixed(1)}px`; u.style.top = `${(bottom - USE.b * k - USE.h / 2).toFixed(1)}px`; u.style.height = `${USE.h}px`;
    const gs = B.guns, gw = gs.offsetWidth || 162; gs.style.left = `${((W - gw) / 2).toFixed(1)}px`; gs.style.top = `${(H - Math.max(EDGE * 0.6, safe.b) - GUNS.b - 26).toFixed(1)}px`;
    R = STICK.r * k; rest = [left + STICK.a * k, bottom - STICK.b * k];
    zone.r = Math.min(W * ZONE.fw, left + ZONE.w * k); zone.t = Math.max(H * (1 - ZONE.fh), bottom - ZONE.h * k);
    // the free band for the HUD: right of the stick's zone, left of the right-hand cluster (the kit column and FIRE)
    let clusterL = W;
    for (const [id, side, a, , r] of LAYOUT) if (side === 'r' && !B[id].hidden) clusterL = Math.min(clusterL, right - a * k - r * k);
    const root = document.documentElement.style;
    root.setProperty('--ndt-band-l', `${Math.ceil(zone.r + 6)}px`); root.setProperty('--ndt-band-r', `${Math.ceil(W - clusterL + 6)}px`); root.setProperty('--ndt-zone-t', `${Math.floor(zone.t)}px`);
    if (!baseAt) showBase(rest);
    layer.style.setProperty('--o', String(+opts.tOpacity || 0.7));
  }
  function showBase(at) {
    place(base, at[0], at[1], R);
    place(lockEl, at[0], at[1] - R - 30 * k, 15 * k);
    lockEl.classList.toggle('show', opts.sprintLock !== false && !!baseAt);
  }
  layout();
  const relayout = () => layout();
  addEventListener('resize', relayout);
  const stopMenu = (e) => e.preventDefault();
  document.addEventListener('contextmenu', stopMenu);
  document.addEventListener('gesturestart', stopMenu);   // Safari's pinch
  onDispose?.(() => { for (const v of ['--ndt-band-l', '--ndt-band-r', '--ndt-zone-t']) document.documentElement.style.removeProperty(v); removeEventListener('resize', relayout); document.removeEventListener('contextmenu', stopMenu); document.removeEventListener('gesturestart', stopMenu); layer.remove(); document.body.classList.remove('nd-touch'); });

  // ---- the stick
  const inStickZone = (x, y) => x < zone.r && y > zone.t;
  function stickDown(p) {
    if (st.locked) unlock();
    baseAt = [Math.min(Math.max(p.x, Math.max(EDGE, safe.l) + R), Math.max(zone.r - R * 0.3, Math.max(EDGE, safe.l) + R)), Math.min(Math.max(p.y, zone.t + R), H - Math.max(EDGE, safe.b) - R)];
    showBase(baseAt); base.classList.add('live');
    stickMove(p);
  }
  function stickMove(p) {
    let dx = p.x - baseAt[0], dy = p.y - baseAt[1];
    const l = Math.hypot(dx, dy);
    st.armed = opts.sprintLock !== false && dy < -R * 1.6 && Math.abs(dx) < R * 1.1;
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    input.stick(dx / R, -dy / R);
    setRun(l > R * 1.25 || st.armed);
    lockEl.classList.toggle('armed', st.armed);
  }
  function stickUp() {
    if (st.armed) { st.armed = false; st.locked = true; lockEl.classList.remove('armed'); lockEl.classList.add('on'); input.stick(0, 1); setRun(true); knob.style.transform = `translate(0,${(-R).toFixed(1)}px)`; return; }
    endStick();
  }
  function endStick() { baseAt = null; base.classList.remove('live', 'run'); knob.style.transform = ''; input.stick(0, 0); setRun(false); lockEl.classList.remove('armed', 'on'); showBase(rest); }
  function unlock() { st.locked = false; endStick(); }
  let running = false;
  function setRun(v) { if (v !== running) { running = v; input.hold('run', v); } base.classList.toggle('run', v); }

  // ---- the look: what the finger moved, in radians, slower down the sight and over a target
  const turn = (p, e) => {
    const f = 0.0062 * (+opts.tSens || 1) * (st.aimHold || st.aimLatch ? 0.55 : 1) * st.slow / (+opts.sens || 1);   // the game scales every turn by the general sensitivity after: touch has its own, so undo that here
    input.addLook((e.clientX - p.x) * f, (e.clientY - p.y) * f);   // the inverted-look setting is applied after, as for the mouse
  };

  // ---- the pointers
  const leanOf = (id) => (id === 'leanL' ? -1 : 1);
  function down(e) {
    e.preventDefault();
    const b = e.target.closest?.('[data-b]'), id = b?.dataset.b;
    if (!ready()) return;
    if (paused() && id !== 'opt' && id !== 'menu') return;
    const role = id || (inStickZone(e.clientX, e.clientY) ? 'stick' : 'look');
    if (role === 'stick' && [...ptrs.values()].some((q) => q.role === 'stick')) return;
    try { layer.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    const p = { role, el: b, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
    ptrs.set(e.pointerId, p);
    b?.classList.add('on');
    switch (role) {
      case 'stick': stickDown(p); break;
      case 'fire': case 'fireL': st[role]++; break;
      case 'aim': st.aimHold = true; break;
      case 'leanL': case 'leanR': st.leanHold = leanOf(role); break;
      case 'reload': on.reload(); break;
      case 'crouch': on.crouch(); break;
      case 'melee': on.melee(); break;
      case 'jump': input.hold('jump', true); break;
      case 'use': input.tap('interact'); break;
      case 'opt': on.options(); ptrs.delete(e.pointerId); b.classList.remove('on'); break;
      case 'hack': kit?.hack.start(); break;
      case 'dash': case 'grenade': kit?.abilities.use(role); break;
      case 'over': kit?.abilities.use('overdrive'); break;
      case 'guns': p.step = e.clientX; p.slot = gunAt(e.clientX, e.clientY); p.swiped = false; break;
      case 'menu': input.tap('menu'); ptrs.delete(e.pointerId); b.classList.remove('on'); break;
    }
  }
  function move(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (p.role === 'stick') stickMove({ x: e.clientX, y: e.clientY });
    else if (p.role === 'guns') { const dx = e.clientX - p.step; if (Math.abs(dx) > 26) { on.cycle?.(Math.sign(dx)); p.step = e.clientX; p.swiped = true; } }
    else if (p.role === 'look' || p.role === 'fire' || p.role === 'fireL' || p.role === 'aim') turn(p, e);
    p.x = e.clientX; p.y = e.clientY;
  }
  function up(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    ptrs.delete(e.pointerId);
    p.el?.classList.remove('on');
    const tap = (performance.now() - p.t0) / 1000 < TAP_S && Math.hypot(p.x - p.x0, p.y - p.y0) < TAP_PX && e.type === 'pointerup';
    switch (p.role) {
      case 'stick': stickUp(); break;
      case 'fire': case 'fireL': st[p.role] = Math.max(0, st[p.role] - 1); break;
      case 'aim': st.aimHold = false; if (tap) st.aimLatch = !st.aimLatch; break;
      case 'leanL': case 'leanR': { const d = leanOf(p.role); st.leanHold = 0; if (tap) st.leanLatch = st.leanLatch === d ? 0 : d; break; }
      case 'jump': input.hold('jump', false); break;
      case 'hack': kit?.hack.cancel(); break;
      case 'guns': if (!p.swiped && p.slot && e.type === 'pointerup') on.select?.(p.slot); break;
    }
    paint();
  }
  layer.addEventListener('pointerdown', down);
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
  layer.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) up(e); });
  /** the slot under a point of the strip */
  const gunAt = (x, y) => { for (const el of B.guns.children) { const r = el.getBoundingClientRect(); if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 6 && y <= r.bottom + 6) return el.dataset.g; } return null; };
  const shown = new Map(), held = (role) => [...ptrs.values()].some((q) => q.role === role);
  const put = (el, k, v) => { let c = shown.get(el); if (!c) shown.set(el, (c = {})); if (c[k] === v) return; c[k] = v; if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v; else el.style.setProperty(k, v); };
  /** the kit's buttons and the gun strip, from the game's state (once a step) */
  function paintKit() {
    if (kit) {
      const h = kit.hack, a = kit.abilities, t = h.held ? h.target() : null, why = h.held ? (t ? t.refusal : T.xt.noTarget) : (h.charges <= 0 && !h.free ? T.xt.noCharge : '');
      put(B.hack, 'class', `ndt-b kit hack${why ? ' dim' : ''}${h.held ? ' on' : ''}`);
      put(B.hack, '--hp', `${Math.round((h.held ? h.progress : 0) * 100)}%`);
      put(B.hack.querySelector('em'), 'text', why);
      [...B.hack.querySelectorAll('i u')].forEach((u, i) => put(u, 'class', i < h.charges || h.free ? 'on' : ''));
      for (const n of ['dash', 'grenade']) {
        const left = a.left(n), cd = a.cooldown(n) || 1;
        put(B[n], 'class', `ndt-b kit${left <= 0 ? ' ready' : ''}${held(n) ? ' on' : ''}`); put(B[n], '--cd', `${Math.round(100 * left / cd)}%`); put(B[n].querySelector('b'), 'text', left > 0 ? String(Math.ceil(left)) : '');
      }
      put(B.over, 'class', `ndt-b kit over${a.charge >= 1 || a.active ? ' ready' : ''}${a.active ? ' active' : ''}${held('over') ? ' on' : ''}`); put(B.over, '--ch', `${Math.round(100 * (a.active ? 1 : a.charge))}%`);
      put(B.over.querySelector('b'), 'text', a.active ? `${Math.ceil(kit.abilities.overLeft || 0)}` : '');
    }
    if (weapon) for (const el of B.guns.children) { const id = el.dataset.g, w = weapon.W[id]; put(el, 'class', `${id === (weapon.switchingTo || weapon.id) ? 'cur' : ''}${w.owned ? '' : ' locked'}`); }
  }
  function paint() {
    B.aim.classList.toggle('lit', st.aimLatch);
    B.leanL.classList.toggle('lit', st.leanLatch === -1);
    B.leanR.classList.toggle('lit', st.leanLatch === 1);
  }

  const api = {
    layer,
    get fire() { return st.fire + st.fireL > 0; },
    get aim() { return st.aimHold || st.aimLatch; },
    get lean() { return st.leanHold || st.leanLatch; },
    get sprintLocked() { return st.locked; },
    get busy() { return ptrs.size; },
    /** the aim assist's factor on the turn rate, from the game each tick (1: none) */
    set slow(v) { st.slow = v; },
    get slow() { return st.slow; },
    /** the settings changed: the layout again */
    apply() { layout(); },
    /** once a step: the kit's cooldowns, the hack's ring and pips, the gun strip */
    paint: paintKit,
    /** every finger let go and every latch off (a pause, a death, a load) */
    reset() {
      for (const p of ptrs.values()) p.el?.classList.remove('on');
      ptrs.clear(); Object.assign(st, { fire: 0, fireL: 0, aimHold: false, aimLatch: false, leanHold: 0, leanLatch: 0, armed: false });
      if (st.locked) st.locked = false;
      endStick(); input.hold('jump', false); paint(); kit?.hack.cancel();
    },
    /** USE: shown with its label while something can be used (null: hidden) */
    use(label) {
      if (label === useLabel) return;
      useLabel = label; B.use.hidden = !label; if (label) useText.textContent = label;
    },
    /** a short buzz where the phone has one (a hit taken, an empty magazine) */
    buzz(pattern) { if (vibe) try { navigator.vibrate(pattern); } catch { /* not allowed before a gesture */ } },
    /** the language changed: the buttons' names for screen readers */
    relang() {
      for (const [id, el] of Object.entries(B)) if (L[id]) el.setAttribute('aria-label', L[id]);
      B.guns.setAttribute('aria-label', L.guns); useLabel = null;
    },
    /** the stick's zone: [left, top, right, bottom] in CSS px (where a thumb starts the floating stick) */
    zone() { return [0, zone.t, zone.r, H]; },
    /** the rectangles of every control on screen, for the check: [name, left, top, right, bottom] */
    rects() {
      const out = [];
      for (const [id, el] of Object.entries(B)) { if (el.hidden) continue; const r = el.getBoundingClientRect(); out.push([id, r.left, r.top, r.right, r.bottom]); }
      for (const [id, el] of [['stick', base], ['lock', lockEl]]) { const r = el.getBoundingClientRect(); out.push([id, r.left, r.top, r.right, r.bottom]); }
      return out;
    },
  };
  return api;
}

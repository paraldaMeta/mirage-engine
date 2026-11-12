// The title screen, in place of the engine overlay's plain start card (.mg-start, hidden here): the camera flies a
// slow loop through the district (a spline through a few of the plan's viewpoints, lifted off the ground) while the
// game stays paused, and a menu picks the mode, the difficulty and the hour before DEPLOY.
//   keyboard   ↑ ↓ / Tab / W S choose, ← → / A D change, Enter or Space select, O the options
//   gamepad    d-pad or the left stick choose and change, A select, Start deploys, B closes the options
//   touch      tap a row (or its arrows)
// While it is up it owns the keys (a window capture listener added before the overlay's, so a key does not start the
// game behind it) and the pad (the overlay's per-frame update, which starts the game on A, is held back).
import * as THREE from 'three';

const CSS = `
.nt{position:fixed;inset:0;z-index:30;pointer-events:none;color:#d8f6ff;font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;user-select:none;-webkit-user-select:none;transition:opacity .45s;--pad:max(28px,env(safe-area-inset-left));--cy:#19d8ff;--mg:#ff3fd2}
.nt.out{opacity:0}.nt[hidden]{display:none}
.nt *{box-sizing:border-box}
.nt-shade{position:absolute;inset:0;background:linear-gradient(90deg,#02060af5 0%,#02060ae0 26%,#02060a80 46%,#02060a00 66%),linear-gradient(0deg,#02060ad0 0%,#02060a00 34%),linear-gradient(180deg,#02060a99 0%,#02060a00 16%)}
.nt-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,#9ff4ff07 0 1px,transparent 1px 3px)}
.nt-top{position:absolute;left:var(--pad);right:max(28px,env(safe-area-inset-right));top:max(20px,env(safe-area-inset-top));display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.24em;color:#7af0ffb0}
.nt-top i{display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;background:var(--mg);box-shadow:0 0 8px var(--mg);animation:nt-blink 1.6s steps(2) infinite;vertical-align:1px}
.nt-top span:last-child{color:#d8f6ff80}
@keyframes nt-blink{50%{opacity:.15}}
.nt-main{position:absolute;left:var(--pad);top:50%;transform:translateY(-52%);width:min(430px,calc(100vw - 2 * var(--pad)))}
.nt-kicker{font-size:10px;letter-spacing:.32em;color:var(--mg);margin:0 0 10px;text-shadow:0 0 12px #ff3fd280}
.nt-h{margin:0;font:800 66px/.9 ui-monospace,SFMono-Regular,Menlo,var(--nd-cjk,"PingFang TC"),monospace;letter-spacing:.02em;color:#f4feff;text-shadow:-2px 0 #ff3fd270,2px 0 #19d8ff70,0 0 30px #19d8ff3a}
.nt-h span{display:block}
.nt-h.cjk{font-size:64px;letter-spacing:.12em;font-family:var(--nd-cjk,"PingFang TC"),system-ui,sans-serif;font-weight:700}
.nt-p{margin:16px 0 24px;padding-left:12px;border-left:2px solid var(--mg);font:400 14px/1.5 system-ui,-apple-system,var(--nd-cjk,"PingFang TC"),sans-serif;color:#d8f6ffd0;max-width:30em}
.nt-menu{display:flex;flex-direction:column;gap:5px;pointer-events:auto}
.nt-row{position:relative;display:grid;grid-template-columns:118px 34px 1fr 34px;align-items:center;height:40px;border:1px solid #19d8ff1c;background:linear-gradient(90deg,#071823d0,#07182340);cursor:pointer;transition:background .15s,border-color .15s}
.nt-row.on{border-color:#19d8ff70;background:linear-gradient(90deg,#19d8ff33,#19d8ff08)}
.nt-row.on:before{content:"";position:absolute;left:-1px;top:-1px;bottom:-1px;width:3px;background:var(--mg);box-shadow:0 0 12px var(--mg)}
.nt-row button{all:unset;cursor:pointer;height:100%;display:flex;align-items:center}
.nt-row .k{padding-left:16px;font-size:10px;letter-spacing:.22em;color:#7af0ffa0}
.nt-row .v{justify-content:center;font-size:14px;letter-spacing:.2em;color:#f4feff}
.nt-row .ar{justify-content:center;color:#7af0ff70;font-size:12px}
.nt-row.on .ar{color:var(--cy)}
.nt-row .ar:hover{color:#fff}
.nt-row[hidden]{display:none}.nt-row.solo{grid-template-columns:1fr}.nt-row.solo .k{font-size:11px;color:#d8f6ffd0}
.nt-row.go{height:52px;margin-bottom:6px;border-color:#19d8ff;background:linear-gradient(90deg,#19d8ffe8,#19d8ffb0 62%,#19d8ff30);box-shadow:0 0 24px #19d8ff30}
.nt-row.go .k{font-size:17px;letter-spacing:.42em;color:#02080d;font-weight:800;padding-left:18px}
.nt-row.go .k:before{content:"";display:inline-block;margin-right:16px;border:7px solid transparent;border-left:11px solid #02080d;border-right:0;vertical-align:-1px}
.nt-row.go.on{background:linear-gradient(90deg,#7af4ff,#19d8ffd0 62%,#19d8ff40);box-shadow:0 0 34px #19d8ff60}
.nt-row:focus-within{outline:none}.nt-row button:focus-visible{outline:none}
.nt-desc{margin:12px 0 0;min-height:2.9em;font:400 12px/1.45 system-ui,-apple-system,var(--nd-cjk,"PingFang TC"),sans-serif;color:#d8f6ffa8;max-width:32em}
.nt-desc b{font:600 10px ui-monospace,monospace;letter-spacing:.2em;color:#ffd34a;margin-left:6px}
.nt-legend{position:absolute;right:max(28px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));padding:12px 16px 10px;background:#02060ab8;border:1px solid #19d8ff2a;border-top:2px solid #19d8ff80;font-size:11px;letter-spacing:.04em}
.nt-legend h3{margin:0 0 8px;font-size:10px;letter-spacing:.3em;color:var(--mg)}
.nt-legend table{border-collapse:collapse}
.nt-legend th{font-size:9px;letter-spacing:.24em;color:#7af0ffb0;text-align:left;font-weight:600;padding:0 14px 6px 0}
.nt-legend td{padding:3px 14px 3px 0;color:#d8f6ffd8;white-space:nowrap;font-weight:500}
.nt-legend td:first-child{color:#d8f6ff80;font:400 11px system-ui,-apple-system,var(--nd-cjk,"PingFang TC"),sans-serif}
.nt-legend tr+tr td{border-top:1px solid #19d8ff12}
.nt-nav{position:absolute;left:var(--pad);bottom:max(22px,env(safe-area-inset-bottom));font-size:10px;letter-spacing:.2em;color:#7af0ff90}
@media (max-height:520px){
  .nt{--pad:max(18px,env(safe-area-inset-left))}
  .nt-top{top:max(10px,env(safe-area-inset-top))}
  .nt-main{top:max(30px,env(safe-area-inset-top));transform:none;width:min(390px,52vw)}
  .nt-kicker{display:none}
  .nt-h{font-size:30px}.nt-h span{display:inline}.nt-h span+span:before{content:" "}
  .nt-h.cjk{font-size:30px}
  .nt-p{margin:7px 0 10px;font-size:11.5px;line-height:1.35}
  .nt-menu{gap:3px}
  .nt-row{height:36px;grid-template-columns:96px 34px 1fr 34px}.nt-row .v{font-size:12.5px}
  .nt-row.go{height:40px;margin-bottom:3px}.nt-row.go .k{font-size:14px}
  .nt-desc{margin-top:6px;font-size:11px;min-height:2.7em}
  .nt-legend{top:max(36px,env(safe-area-inset-top));bottom:auto;right:max(18px,env(safe-area-inset-right));max-width:calc(100vw - min(390px,52vw) - 2 * var(--pad) - 18px);padding:9px 12px 7px;font-size:10px}
  .nt-legend h3{margin-bottom:5px}
  .nt-legend td{padding:2px 9px 2px 0}.nt-legend th{padding:0 9px 4px 0}.nt-legend td:first-child{font-size:10px}
  .nt-nav{display:none}
}
/* a small phone held sideways (667 x 375): six rows still fit, none under 34 px */
@media (max-height:400px){.nt-row{height:34px}.nt-row.go{height:38px}.nt-p{margin:5px 0 8px}.nt-desc{margin-top:4px}}
@media (max-width:700px) and (min-height:521px){.nt-legend{display:none}}
/* a phone held sideways: no keyboard there, and its column would push the touch one off the screen */
@media (pointer:coarse) and (max-height:520px){.nt-legend tr>:nth-child(2){display:none}.nt-legend td:last-child{white-space:normal;word-break:keep-all;overflow-wrap:anywhere}}
body.nd-titling .mg-ui>:not(dialog):not(style),body.nd-titling .mirage-hud{display:none!important}
body.nd-titling .nd>:not(.nd-opt):not(style){display:none!important}
body.nd-titling .nd{z-index:40}
.mg-ui .mg-start{display:none!important}
`;

// the fly-through: [viewpoint, eye offset, look] (the plan's ground-level eyes, lifted; a look below each eye)
const PATH = [
  ['street west', [0.5, 3.4, 0], [8, 2.2, 5]],
  ['bar front', [1, 2.6, -0.4], [-4, 2.2, 1]],
  ['plaza', [0, 3.6, 1.6], [19, 3, -11]],
  ['monument', [1, 4.4, 0], [17.6, 3.4, -9.5]],
  ['roof vista', [3, 2.6, 2.5], [20, 1.5, 6]],
  ['street east', [-1, 3.6, 1.2], [-10, 2.6, 6.5]],
  [null, [4, 6, 6.2], [-24, 2.2, 7]],
];
const SPEED = 2.6;   // metres a second along the eye's path

/**
 * @param o.T the language's table; o.values { mode, difficulty, hour }; o.choices { mode: [], difficulty: [], hour: [] }
 * @param o.onChange (key, value)   o.onDeploy (event-like | undefined)   o.onOptions ()   o.optionsOpen () => bool
 */
export function createTitle({ T, plan, world, values, choices, names = {}, best, onChange, onDeploy, onOptions, optionsOpen, onFrame, onDispose, ng = null }) {
  const F = T.front;   // a live branch: a language switch changes its strings in place (text.js)
  const root = document.createElement('div');
  root.className = 'nt'; root.hidden = true;
  root.setAttribute('role', 'dialog');
  const rows = [
    { id: 'deploy', solo: true, go: true, label: () => F.deploy },
    { id: 'mode', label: () => F.mode, list: choices.mode, name: (v) => F.modes[v] },
    { id: 'difficulty', label: () => F.difficulty, list: choices.difficulty, name: (v) => F.diffs[v] },
    { id: 'hour', label: () => F.hour, list: choices.hour, name: (v) => (T.hours[v] || v).toUpperCase() },
    ...(choices.lang ? [{ id: 'lang', label: () => F.lang, list: choices.lang, name: (v) => (names.lang && names.lang[v]) || v }] : []),
    { id: 'options', solo: true, label: () => F.options },
    // New Game+ (boss.js): the swordsman with the player from the start; a row to fight it again
    ...(ng ? [{ id: 'ngreset', solo: true, label: () => T.melee.front.reset }] : []),
  ];
  root.innerHTML = `<style>${CSS}</style><div class="nt-shade"></div><div class="nt-scan"></div>
    <div class="nt-top"><span><i></i><span class="nt-feed"></span></span><span class="nt-clock"></span></div>
    <div class="nt-main">
      <p class="nt-kicker"></p>
      <h1 class="nt-h"></h1>
      <p class="nt-p"></p>
      <div class="nt-menu" role="menu">${rows.map((r, i) => r.solo
        ? `<div class="nt-row solo${r.go ? ' go' : ''}" data-i="${i}" data-id="${r.id}"><button class="k" role="menuitem" data-a="main"></button></div>`
        : `<div class="nt-row" data-i="${i}" data-id="${r.id}"><span class="k"></span><button class="ar" data-a="-1">◀</button><button class="v" role="menuitem" data-a="main"></button><button class="ar" data-a="1">▶</button></div>`).join('')}</div>
      <p class="nt-desc" aria-live="polite"></p>
    </div>
    <div class="nt-legend"></div>
    <div class="nt-nav"></div>`;
  document.body.appendChild(root);
  const els = [...root.querySelectorAll('.nt-row')], desc = root.querySelector('.nt-desc'), nav = root.querySelector('.nt-nav'), clock = root.querySelector('.nt-clock');
  let sel = 0, shown = false, g = null, orig = null, t = 0, last = 0, stickT = 0, stickDir = 0, source = '';
  onDispose(() => { root.remove(); document.body.classList.remove('nd-titling'); });
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /** every fixed text, in the current language (again after a switch) */
  function texts() {
    const cjk = /[぀-ヿ一-鿿]/.test(T.title);
    root.setAttribute('aria-label', T.title);
    root.querySelector('.nt-feed').textContent = F.feed;
    root.querySelector('.nt-kicker').textContent = (ng?.on() ? T.melee.front.ngPlus + ' · ' : '') + F.kicker;
    const h = root.querySelector('.nt-h');
    h.className = 'nt-h' + (cjk ? ' cjk' : '');
    h.innerHTML = cjk ? `<span>${esc(T.title)}</span>` : T.title.split(' ').map((w) => `<span>${esc(w)}</span>`).join('');
    root.querySelector('.nt-p').textContent = F.premise;
    rows.forEach((r, i) => {
      const el = els[i];
      el.querySelector('.k').textContent = r.label();
      for (const a of el.querySelectorAll('.ar')) a.setAttribute('aria-label', `${r.label()} ${a.dataset.a === '1' ? '+' : '−'}`);
    });
    const legend = F.legend.map((r) => `<tr>${r.map((c) => `<td>${esc(c || '—')}</td>`).join('')}</tr>`).join('');
    const lg = root.querySelector('.nt-legend');
    lg.setAttribute('aria-label', F.controls);
    lg.innerHTML = `<h3>${esc(F.controls)}</h3><table><tr><th></th><th>${esc(F.keys)}</th><th>${esc(F.pad)}</th><th>${esc(F.touch)}</th></tr>${legend}</table>`;
    const src = source; source = ''; if (src) hint(src);
  }
  texts();

  function render() {
    rows.forEach((r, i) => {
      if (r.id === 'ngreset') els[i].hidden = !ng.on();
      els[i].classList.toggle('on', i === sel);
      if (r.list) { const v = els[i].querySelector('.v'); v.textContent = r.name(values[r.id]); if (r.id === 'lang') v.lang = { en: 'en', zh: 'zh-Hant-TW', ja: 'ja' }[values.lang] || ''; }
    });
    const r = rows[sel];
    const text = r.id === 'mode' ? F.modeText[values.mode] : r.id === 'difficulty' ? F.diffText[values.difficulty] : r.id === 'hour' ? F.hourText : r.id === 'options' ? F.optionsText : r.id === 'ngreset' ? T.melee.front.resetText : r.id === 'lang' ? F.langText : F.sum(F.modes[values.mode], F.diffs[values.difficulty], (T.hours[values.hour] || values.hour).toUpperCase());
    desc.textContent = text;
    const b = best();
    if (values.mode === 'holdout' && b > 0 && (r.id === 'mode' || r.id === 'deploy')) { const tag = document.createElement('b'); tag.textContent = F.best(b); desc.appendChild(tag); }
  }
  function select(i, focus = true) {
    const prev = sel; sel = (i + rows.length) % rows.length;
    if (rows[sel].id === 'ngreset' && !ng.on()) sel = i < 0 || i < prev ? sel - 1 : 0;   // skipped while hidden
    render();
    if (focus) els[sel].querySelector('[data-a=main]').focus({ preventScroll: true });
  }
  function change(i, d) {
    const r = rows[i];
    if (!r.list) return;
    const k = r.list.indexOf(values[r.id]);
    values[r.id] = r.list[((k < 0 ? 0 : k + d) + r.list.length) % r.list.length];
    onChange(r.id, values[r.id]); render();
  }
  function activate(i, ev) {
    const r = rows[i];
    if (r.id === 'deploy') deploy(ev);
    else if (r.id === 'options') onOptions();
    else if (r.id === 'ngreset') { ng.reset(); texts(); select(0); desc.textContent = T.melee.front.resetDone; }
    else change(i, 1);
  }
  function deploy(ev) {
    if (!shown) return;
    hide();
    onDeploy(ev);
  }
  // pointer and touch: a row is chosen under the pointer; its arrows and its value change it
  els.forEach((el, i) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && sel !== i) select(i, false); });
    el.addEventListener('click', (e) => {
      if (!shown || optionsOpen()) return;
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (sel !== i) select(i);
      if (a === '-1' || a === '1') change(i, +a);
      else activate(i, e.detail === 0 ? undefined : e);   // a click from Enter on the focused button comes through keydown
    });
  });

  // keys: while the title is up, every key stops here (the overlay would start the game on any key)
  const onKey = (e) => {
    if (!shown) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '') && !optionsOpen()) return;
    e.stopImmediatePropagation();
    g?.audio.unlock();
    if (optionsOpen()) { if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyO')) { e.preventDefault(); onOptions(); } return; }   // the panel's own keys work as usual
    const c = e.code;
    let used = true;
    if (c === 'ArrowUp' || c === 'KeyW' || (c === 'Tab' && e.shiftKey)) select(sel - 1);
    else if (c === 'ArrowDown' || c === 'KeyS' || c === 'Tab') select(sel + 1);
    else if (c === 'ArrowLeft' || c === 'KeyA') change(sel, -1);
    else if (c === 'ArrowRight' || c === 'KeyD') change(sel, 1);
    else if ((c === 'Enter' || c === 'NumpadEnter' || c === 'Space') && !e.repeat) activate(sel, { type: 'click', code: c });
    else if (c === 'KeyO' && !e.repeat) onOptions();
    else used = false;
    if (used) e.preventDefault();
    hint('keys');
  };
  window.addEventListener('keydown', onKey, true);
  onDispose(() => window.removeEventListener('keydown', onKey, true));

  function hint(src) {
    if (src === source) return;
    source = src; nav.textContent = src === 'pad' ? F.navPad : src === 'touch' ? F.navTouch : F.navKeys;
  }

  // the gamepad, read once a frame from the engine's input (edges: 12 up, 13 down, 14 left, 15 right, 0 A, 1 B, 9 Start)
  function pad(dt) {
    const I = g.input, P = I.pad;
    if (!P) return;
    const p = (i) => I.padPressed(i);
    if ([0, 1, 9, 12, 13, 14, 15].some(p)) { hint('pad'); g.audio.unlock(); }
    if (optionsOpen()) return panelPad(p, P, dt);
    if (p(12)) select(sel - 1); if (p(13)) select(sel + 1);
    if (p(14)) change(sel, -1); if (p(15)) change(sel, 1);
    // the left stick, with a repeat while held
    const ax = P.axes[0] || 0, ay = P.axes[1] || 0, dir = Math.abs(ay) > 0.6 ? (ay > 0 ? 2 : 1) : Math.abs(ax) > 0.6 ? (ax > 0 ? 4 : 3) : 0;
    let act = false;
    if (dir !== stickDir) { stickDir = dir; stickT = 0.4; act = !!dir; } else if (dir && (stickT -= dt) <= 0) { stickT = 0.16; act = true; }
    if (act) { if (dir === 1) select(sel - 1); if (dir === 2) select(sel + 1); if (dir === 3) change(sel, -1); if (dir === 4) change(sel, 1); hint('pad'); }
    if (p(0)) activate(sel); else if (p(9)) deploy();
  }
  // the options panel over the title, by pad: up / down move through it, left / right step a slider, A presses, B closes
  function panelPad(p, P) {
    const panel = document.querySelector('.nd-opt');
    if (!panel) return;
    const items = [...panel.querySelectorAll('input,button')], at = items.indexOf(document.activeElement);
    if (p(1) || p(9)) { onOptions(); return; }
    if (p(12) || p(13)) items[((at < 0 ? 0 : at + (p(13) ? 1 : -1)) + items.length) % items.length].focus();
    const cur = document.activeElement;
    if ((p(14) || p(15)) && cur && cur.type === 'range') { if (p(15)) cur.stepUp(); else cur.stepDown(); cur.dispatchEvent(new Event('input')); }
    if (p(0) && cur && cur.tagName === 'BUTTON') cur.click();
  }

  // the camera's loop
  const vp = (n) => plan.viewpoints.find((v) => v.name === n);
  const eyes = PATH.map(([n, o]) => { const e = n ? vp(n).eye : [0, 0, 0]; return new THREE.Vector3(e[0] + o[0], e[1] + o[1], e[2] + o[2]); });
  const looks = PATH.map((p) => new THREE.Vector3(...p[2]));
  const eyeC = new THREE.CatmullRomCurve3(eyes, true, 'centripetal'), lookC = new THREE.CatmullRomCurve3(looks, true, 'centripetal');
  const period = eyeC.getLength() / SPEED, eye = new THREE.Vector3(), at = new THREE.Vector3();
  function fly(dt) {
    t = (t + dt) % period;
    const u = t / period, k = eyeC.getUtoTmapping(u);
    eyeC.getPoint(k, eye); lookC.getPoint(k, at);
    if (at.y > eye.y - 0.3) at.y = eye.y - 0.3;   // the orbit camera keeps above what it looks at
    world.camera.position.copy(eye);
    g.play.controls.target.copy(at);
  }

  function frame() {
    const now = performance.now(), dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
    fly(dt);
    pad(dt);
    if (g.ui.touch && source !== 'pad') hint('touch');
    const h = values.hour;
    const s = Math.floor(t), tc = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`;
    clock.textContent = `${F.cam} 07 · ${(T.hours[h] || h).toUpperCase()} · ${tc}`;
    onFrame(dt);
  }

  function show(g_) {
    g = g_; shown = true; root.hidden = false; root.classList.remove('out');
    document.body.classList.add('nd-titling');
    if (document.pointerLockElement) document.exitPointerLock();
    g.play.setMode('orbit');
    t = period * 0.02; last = 0;
    orig = g.ui.update;
    g.ui.update = frame;   // the overlay's own update would start the game on the pad's A
    hint(g.ui.touch ? 'touch' : 'keys');
    select(0);
  }
  function hide() {
    if (!shown) return;
    shown = false;
    if (orig) g.ui.update = orig;
    document.body.classList.remove('nd-titling');
    root.classList.add('out');
    setTimeout(() => { if (!shown) root.hidden = true; }, 480);
  }
  /** the language changed: every text again */
  const relang = () => { texts(); render(); };
  return { show, hide, render, relang, get shown() { return shown; }, get selected() { return rows[sel].id; }, root };
}

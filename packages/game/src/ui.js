// Mirage original code. The HTML / CSS overlay: HUD (objective, inventory strip, crosshair, interaction prompt,
// toasts), a start screen, the pause menu (resume, save slots, load, export / import, controls with rebinding,
// sound volumes, restart), an inventory panel, a message dialog, and touch controls on coarse pointers.
// No framework: native <dialog> (modal, focus kept inside, labelled), real <button>s and <input type=range>, an
// aria-live region for prompts and toasts; gamepad d-pad / A / B move focus, press and close inside dialogs.
// ---------------------------------------------------------------------------
import { createLifetime } from '@mirage/core/lifetime';
import { ACTIONS, keyName } from './input.js';

const CSS = `
.mg-ui{position:fixed;inset:0;pointer-events:none;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f6ecd8;z-index:10}
.mg-ui *{box-sizing:border-box}
.mg-ui [hidden]{display:none!important}
.mg-ui :focus-visible{outline:3px solid #ffcf6e;outline-offset:2px}
.mg-hud{position:absolute;left:16px;right:16px;top:14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;text-shadow:0 1px 3px #000c}
.mg-obj{max-width:34em;background:#1b120acc;border:1px solid #ffffff22;padding:8px 12px;border-radius:8px}
.mg-obj b{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ffcf6e}
.mg-items{list-style:none;margin:0;padding:0;display:flex;gap:6px}
.mg-items li{background:#1b120acc;border:1px solid #ffffff22;border-radius:8px;padding:6px 10px;font-size:13px}
.mg-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff9;box-shadow:0 0 3px #000}
.mg-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);background:#1b120ae6;border:1px solid #ffcf6e88;border-radius:10px;padding:8px 14px;white-space:nowrap}
.mg-prompt kbd,.mg-ui kbd{display:inline-block;min-width:1.7em;text-align:center;padding:1px 6px;margin-right:6px;border-radius:5px;background:#f6ecd8;color:#1b120a;font:600 13px/1.4 ui-monospace,monospace}
.mg-toast{position:absolute;left:50%;top:22%;transform:translateX(-50%);text-align:center;font-size:18px;text-shadow:0 1px 4px #000;transition:opacity .4s;opacity:0}
.mg-toast.on{opacity:1}
.mg-start{position:absolute;inset:0;display:grid;place-items:center;background:#0008;pointer-events:auto;cursor:pointer;text-align:center}
.mg-start h1{font-weight:600;letter-spacing:.06em;margin:0 0 6px}
.mg-ui dialog{pointer-events:auto;background:#1b120af2;color:#f6ecd8;border:1px solid #ffcf6e66;border-radius:12px;padding:18px 20px;max-width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto}
.mg-ui dialog::backdrop{background:#0007}
.mg-ui h2{margin:0 0 12px;font-size:20px}
.mg-ui h3{margin:14px 0 6px;font-size:14px;letter-spacing:.1em;text-transform:uppercase;color:#ffcf6e}
.mg-ui button,.mg-ui .mg-file{font:inherit;color:#1b120a;background:#f6ecd8;border:0;border-radius:8px;padding:7px 12px;margin:3px 4px 3px 0;cursor:pointer;min-height:36px}
.mg-ui button.alt{background:#ffffff22;color:#f6ecd8}
.mg-ui button:disabled{opacity:.45;cursor:default}
.mg-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #ffffff14}
.mg-row span{flex:1}
.mg-ui input[type=range]{width:12em;accent-color:#ffcf6e}
.mg-file input{position:absolute;opacity:0;width:1px;height:1px}
.mg-touch{position:absolute;inset:0;pointer-events:auto;touch-action:none}
.mg-stick{position:absolute;left:24px;bottom:28px;width:132px;height:132px;border-radius:50%;background:#ffffff1c;border:2px solid #ffffff44}
.mg-stick.run{border-color:#ffcf6ecc}
.mg-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px;border-radius:50%;background:#f6ecd8aa}
.mg-btns{position:absolute;right:18px;bottom:24px;display:grid;grid-template-columns:repeat(2,72px);gap:12px}
.mg-btns button{width:72px;height:72px;border-radius:50%;margin:0;background:#f6ecd8cc;font-weight:600}
.mg-touch .mg-menubtn{position:absolute;right:16px;top:70px;width:52px;height:52px;border-radius:50%}
@media (max-width:640px){.mg-obj{font-size:13px}.mg-hud{flex-direction:column}}
`;

// text that comes from saves, settings or game content goes into markup escaped (an imported save is untrusted)
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createUI(options) {
  const life = createLifetime();
  try {
    return mountUI(options, life);
  } catch (error) {
    life.dispose();
    throw error;
  }
}

function mountUI({ game, input, audio, title = 'Mirage', subtitle = '', slots = 3, onSave, onLoad, onRestart, canvas } = {}, life) {
  const root = document.createElement('div');
  root.className = 'mg-ui';
  root.innerHTML = `
    <div class="mg-hud"><div class="mg-obj" role="status" aria-live="polite"></div><ul class="mg-items" aria-label="Carrying"></ul></div>
    <div class="mg-cross" aria-hidden="true"></div>
    <div class="mg-prompt" role="status" aria-live="polite" hidden></div>
    <div class="mg-toast" role="status" aria-live="assertive"></div>
    <div class="mg-touch" hidden>
      <div class="mg-look" style="position:absolute;inset:0"></div>
      <div class="mg-stick" aria-hidden="true"><div class="mg-knob"></div></div>
      <div class="mg-btns"><button data-a="inventory">Bag</button><button data-a="interact">Use</button><span></span><button data-a="jump">Jump</button></div>
      <button class="mg-menubtn" data-a="menu" aria-label="Menu">☰</button>
    </div>
    <div class="mg-start" role="button" tabindex="0" aria-label="Start"><div><h1></h1><p class="sub"></p><p><kbd>Click</kbd>, tap or press any key to start</p></div></div>
    <dialog class="mg-menu" aria-labelledby="mg-menu-h"><h2 id="mg-menu-h">Paused</h2><div class="mg-body"></div></dialog>
    <dialog class="mg-inv" aria-labelledby="mg-inv-h"><h2 id="mg-inv-h">Carrying</h2><ul class="mg-list"></ul><button data-close>Close</button></dialog>
    <dialog class="mg-msg" aria-labelledby="mg-msg-h"><h2 id="mg-msg-h"></h2><p class="mg-msg-p"></p><button data-close>Continue</button></dialog>`;
  if (!document.getElementById('mg-css')) {
    const style = document.createElement('style');
    style.textContent = CSS;
    root.prepend(style);
  }
  life.defer(() => root.remove());
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const menu = $('.mg-menu'), inv = $('.mg-inv'), msg = $('.mg-msg'), start = $('.mg-start');
  $('.mg-start h1').textContent = title; $('.mg-start .sub').textContent = subtitle;
  const open = () => [menu, inv, msg].find((d) => d.open);
  let started = false, toastT = 0, panel = 'main';
  const wasEnabled = input.enabled;
  let ownsPause = false;
  const files = new Map();
  const capture = new AbortController();
  life.defer(() => {
    capture.abort();
    for (const [url, timer] of files) { clearTimeout(timer); URL.revokeObjectURL(url); }
    files.clear();
    for (const dialog of [menu, inv, msg]) if (dialog.open) dialog.close();
    if (canvas && document.pointerLockElement === canvas) document.exitPointerLock();
    input.clear(); input.enabled = wasEnabled;
    if (ownsPause) game.pause(false);
  });
  input.enabled = false;   // nothing moves behind the start screen

  // ---- dialogs pause the game; Escape goes through the action map (the dialog's own cancel is suppressed)
  for (const d of [menu, inv, msg]) {
    life.listen(d, 'cancel', (e) => e.preventDefault());
    life.listen(d, 'close', () => { if (!open()) resume(); });
    life.listen(d, 'click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  }
  function pause() { if (!game.paused) ownsPause = true; game.pause(true); input.enabled = false; input.clear(); setRun(false); if (canvas && document.pointerLockElement === canvas) document.exitPointerLock(); }
  function resume() { if (open()) return; ownsPause = false; game.pause(false); input.enabled = true; }
  function show(d) { for (const o of [menu, inv, msg]) if (o !== d && o.open) o.close(); pause(); if (!d.open) d.showModal(); }

  // ---- start screen: unlocks audio and captures the pointer
  function begin(e) {
    if (life.disposed) return;
    if (started) return;
    started = true; start.hidden = true; audio.unlock(); input.enabled = true; input.spend(e && e.code);
    if (e && e.type === 'click' && canvas && canvas.requestPointerLock && !touchOn) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* drag to look */ }
    game.emit('start');
  }
  life.listen(start, 'click', begin);
  // any key starts, except one typed into the host page's own fields (an embedded game must not swallow those)
  life.listen(window, 'keydown', (e) => {
    if (started || (e.target && (e.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')))) return;
    e.preventDefault(); begin(e);
  }, true);
  life.listen(window, 'pointerdown', () => audio.unlock(), { capture: true });

  // ---- pointer lock lost while playing (Escape in Chrome): pause, and ignore the same Escape's menu edge
  let lostAt = -1e9;
  let hadLock = false;
  life.listen(document, 'pointerlockchange', () => {
    if (canvas && document.pointerLockElement === canvas) { hadLock = true; return; }
    if (hadLock && !game.paused && started) { hadLock = false; lostAt = performance.now(); openMenu(); }
  });

  // ---- touch controls
  let touchOn = false;
  const touch = $('.mg-touch'), stick = $('.mg-stick'), knob = $('.mg-knob');
  function setTouch(on) { touchOn = on; touch.hidden = !on; $('.mg-cross').hidden = on; }
  if (matchMedia('(pointer: coarse)').matches) setTouch(true);
  life.listen(window, 'pointerdown', (e) => { if (e.pointerType === 'touch' && !touchOn) setTouch(true); }, { capture: true });
  let stickId = null, lookId = null, last = null;
  life.listen(stick, 'pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); e.preventDefault(); });
  life.listen(stick, 'pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  let running = false;
  const setRun = (on) => { if (on !== running) { running = on; input.hold('run', on); stick.classList.toggle('run', on); } };
  const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; knob.style.transform = ''; input.stick(0, 0); setRun(false); };
  life.listen(stick, 'pointerup', endStick); life.listen(stick, 'pointercancel', endStick);
  function moveStick(e) {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    input.stick(dx / R, -dy / R);
    setRun(l > R * 1.25);   // pushed out past the rim: run
  }
  const look = $('.mg-look');
  life.listen(look, 'pointerdown', (e) => { if (!started) begin(e); lookId = e.pointerId; last = [e.clientX, e.clientY]; look.setPointerCapture(e.pointerId); });
  life.listen(look, 'pointermove', (e) => { if (e.pointerId !== lookId) return; input.addLook((e.clientX - last[0]) * 0.006, (e.clientY - last[1]) * 0.006); last = [e.clientX, e.clientY]; });
  life.listen(look, 'pointerup', () => { lookId = null; });
  for (const b of touch.querySelectorAll('button[data-a]')) {
    const a = b.dataset.a;
    life.listen(b, 'pointerdown', (e) => { e.preventDefault(); if (!started) { begin(e); return; } if (a === 'jump') input.hold(a, true); else input.tap(a); });
    life.listen(b, 'pointerup', () => input.hold(a, false));
    life.listen(b, 'click', (e) => { if (e.detail === 0) input.tap(a); });   // keyboard / screen reader activation
  }

  // ---- the pause menu (panels rendered on demand)
  function openMenu(p = 'main') { if (life.disposed) return; panel = p; renderMenu(); show(menu); const f = menu.querySelector('button:not(:disabled)'); if (f) f.focus(); }
  function renderMenu() {
    const body = $('.mg-body');
    $('#mg-menu-h').textContent = { main: 'Paused', save: 'Save', load: 'Load', controls: 'Controls', sound: 'Sound' }[panel];
    const back = '<button class="alt" data-p="main">Back</button>';
    if (panel === 'main') {
      body.innerHTML = `<button data-do="resume">Resume</button><button data-p="save">Save</button><button data-p="load">Load</button>
        <button data-p="controls">Controls</button><button data-p="sound">Sound</button><button class="alt" data-do="restart">Restart</button>`;
    } else if (panel === 'save' || panel === 'load') {
      const rows = game.slots(slots).map((s) => `<div class="mg-row"><span>Slot ${s.slot}: ${s.at ? `${esc(new Date(s.at).toLocaleString())} · ${esc(s.summary || '')}` : s.broken ? 'unreadable' : 'empty'}</span>
        <button data-${panel}="${s.slot}" ${panel === 'load' && !s.at ? 'disabled' : ''}>${panel === 'save' ? 'Save here' : 'Load'}</button></div>`).join('');
      body.innerHTML = rows + (panel === 'save' ? '<h3>File</h3><button data-do="export">Export to a file</button>'
        : '<h3>File</h3><label class="mg-file" tabindex="0">Import a file<input type="file" accept="application/json,.json"></label>') + `<p class="mg-note" role="status"></p>` + back;
    } else if (panel === 'controls') {
      body.innerHTML = ACTIONS.map((a) => `<div class="mg-row"><span>${a}</span><button data-bind="${a}" aria-label="${a}: ${esc((input.bindings[a] || []).join(', '))}. Press to change">${esc((input.bindings[a] || []).map(keyName).join(' / ')) || '—'}</button></div>`).join('') +
        '<p>Gamepad: left stick move, right stick look, A jump, X use, Y bag, LB run, Start menu. Touch: stick, drag to look, buttons.</p><button class="alt" data-do="defaults">Defaults</button>' + back;
    } else if (panel === 'sound') {
      body.innerHTML = ['master', 'music', 'sfx', 'ambience'].map((b) => `<div class="mg-row"><label for="mg-v-${b}"><span>${b}</span></label><input id="mg-v-${b}" type="range" min="0" max="1" step="0.05" value="${esc(audio.volumes[b])}" data-vol="${b}"></div>`).join('') + back;
    }
  }
  life.listen(menu, 'click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const note = (s) => { const n = menu.querySelector('.mg-note'); if (n) n.textContent = s; };
    if (t.dataset.p) { panel = t.dataset.p; renderMenu(); const f = menu.querySelector('button'); if (f) f.focus(); }
    if (t.dataset.do === 'resume') menu.close();
    if (t.dataset.do === 'restart' && onRestart) { menu.close(); onRestart(); }
    if (t.dataset.save) {
      try { onSave(+t.dataset.save); renderMenu(); note(`Saved to slot ${t.dataset.save}.`); toast(`Saved (slot ${t.dataset.save})`); } catch (err) { note('Could not save: ' + (err.message || err)); }
    }
    if (t.dataset.load) { try { onLoad(+t.dataset.load); menu.close(); toast(`Loaded slot ${t.dataset.load}`); } catch (err) { note(String(err.message || err)); } }
    if (t.dataset.do === 'export') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([onSave('export')], { type: 'application/json' }));
      a.download = `${game.id}-save.json`; const url = a.href;
      files.set(url, setTimeout(() => { files.delete(url); URL.revokeObjectURL(url); }, 1000));
      a.click();
    }
    if (t.dataset.bind) {
      t.textContent = 'press a key…';
      const code = await input.capture(capture.signal);
      if (life.disposed) return;
      if (code) { input.rebind(t.dataset.bind, code); game.settings.bindings = input.bindings; game.saveSettings(); }
      renderMenu(); const b = menu.querySelector(`[data-bind="${t.dataset.bind}"]`); if (b) b.focus();
    }
    if (t.dataset.do === 'defaults') { input.reset(); game.settings.bindings = input.bindings; game.saveSettings(); renderMenu(); }
  });
  life.listen(menu, 'input', (e) => { const b = e.target.dataset.vol; if (b) { audio.volume(b, +e.target.value); game.settings.volumes = audio.volumes; game.saveSettings(); } });
  life.listen(menu, 'change', async (e) => {
    if (e.target.type !== 'file' || !e.target.files[0]) return;
    try {
      const json = await e.target.files[0].text();
      if (life.disposed) return;
      onLoad(json); menu.close(); toast('Loaded from file');
    } catch (err) {
      const note = menu.querySelector('.mg-note');
      if (!life.disposed && note) note.textContent = 'Not a save of this game: ' + (err.message || err);
    }
  });

  // ---- inventory panel, messages, HUD
  function openInventory() {
    if (life.disposed) return;
    $('.mg-list').innerHTML = game.inventory.items.map((i) => `<li><b>${esc(i.name)}</b>${i.text ? ' — ' + esc(i.text) : ''}</li>`).join('') || '<li>Nothing yet.</li>';
    show(inv); $('.mg-inv button').focus();
  }
  function message(h, p, button = 'Continue') { if (life.disposed) return; $('#mg-msg-h').textContent = h; $('.mg-msg-p').textContent = p; $('.mg-msg button').textContent = button; show(msg); $('.mg-msg button').focus(); }
  function toast(s, ms = 2200) { const t = $('.mg-toast'); t.textContent = s; t.classList.add('on'); toastT = performance.now() + ms; }
  function objective(head, text) { $('.mg-obj').innerHTML = `<b></b><span></span>`; $('.mg-obj b').textContent = head; $('.mg-obj span').textContent = text; }
  function prompt(e) {
    const p = $('.mg-prompt');
    if (!e) { p.hidden = true; return; }
    const label = game.label(e), html = `<kbd>${esc(input.glyph('interact'))}</kbd>${esc(label)}`;
    if (p.hidden || p.innerHTML !== html) p.innerHTML = html;
    p.hidden = false;
  }
  const renderItems = () => { $('.mg-items').innerHTML = game.inventory.items.map((i) => `<li>${esc(i.name)}</li>`).join(''); };
  life.defer(game.on('inventory', renderItems));

  /** once per frame: action edges for the menus, gamepad focus moves, toast timeout */
  function update() {
    if (life.disposed) return;
    if (performance.now() > toastT) $('.mg-toast').classList.remove('on');
    const d = open();
    if (input.pressed('menu') && performance.now() - lostAt > 400) { if (d) d.close(); else if (started) openMenu(); else begin(); }
    else if (input.pressed('inventory') && started) { if (d === inv) inv.close(); else if (!d) openInventory(); }
    if (!started && (input.padPressed(0) || input.padPressed(9))) begin();
    if (d) {   // gamepad inside a dialog: d-pad moves focus, A presses, B closes, left / right nudge sliders
      const f = [...d.querySelectorAll('button:not(:disabled), input, .mg-file')];
      const i = f.indexOf(document.activeElement);
      if (input.padPressed(13) || input.padPressed(12)) (f[(i + (input.padPressed(13) ? 1 : f.length - 1)) % f.length] || f[0]).focus();
      if (input.padPressed(0) && document.activeElement && d.contains(document.activeElement)) document.activeElement.click();
      if (input.padPressed(1)) d.close();
      const r = document.activeElement;
      if (r && r.type === 'range' && (input.padPressed(14) || input.padPressed(15))) { input.padPressed(15) ? r.stepUp() : r.stepDown(); r.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }
  return { dispose: life.dispose, root, prompt, objective, toast, message, openMenu, openInventory, update, begin, setTouch, get started() { return started; }, get touch() { return touchOn; }, get open() { return open(); } };
}

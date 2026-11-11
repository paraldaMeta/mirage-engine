// The HUD of the city as a weapon, over hud.js (which it does not change, beyond a class on its ammo counter):
// the hack ring and its target's name, the scan view (holo brackets on what can be hacked, a tint), markers on
// robots seen through walls, the charge pips, two cooldown glyphs and the overdrive ring, the ammo waypoint (and its
// tick on the compass), comic hit words and the robots' lines in the world, and the story's cards.
// Every glyph is drawn here in CSS or inline SVG: no icon fonts, no images.
const CSS = `
.ndx{position:fixed;inset:0;pointer-events:none;z-index:6;font:600 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8f6ff;user-select:none;-webkit-user-select:none}
.ndx-scan{position:absolute;inset:0;opacity:0;transition:opacity .18s;background:radial-gradient(ellipse at center,transparent 45%,#0aa8c033 100%),repeating-linear-gradient(0deg,#19d8ff08 0 2px,transparent 2px 4px)}
.ndx-scan.on{opacity:1}
.ndx-over{position:absolute;inset:0;opacity:0;transition:opacity .3s;box-shadow:inset 0 0 120px #ff2a9a55}
.ndx-over.on{opacity:1}
.ndx-flash{position:absolute;inset:0;opacity:0;background:#9ff4ff}
.ndx-ring{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px;opacity:0}
.ndx-ring svg{width:64px;height:64px;transform:rotate(-90deg)}
.ndx-ring circle{fill:none;stroke-width:3}
.ndx-ring .bg{stroke:#19d8ff33}.ndx-ring .fg{stroke:#19d8ff;stroke-dasharray:176;stroke-dashoffset:176;filter:drop-shadow(0 0 3px #19d8ff)}
.ndx-ring.bad .fg{stroke:#ff4a5a}
.ndx-tgt{position:absolute;left:50%;top:calc(50% + 40px);transform:translateX(-50%);text-align:center;letter-spacing:.12em;font-size:11px;text-shadow:0 1px 3px #000;white-space:nowrap;opacity:0}
.ndx-tgt em{display:block;font-style:normal;font-size:10px;color:#ffd34a;margin-top:2px}.ndx-tgt.bad em{color:#ff5a6a}
.ndx-holo{position:absolute;left:0;top:0;width:26px;height:26px;margin:-13px;opacity:.75}
.ndx-holo:before,.ndx-holo:after{content:"";position:absolute;inset:0;border:2px solid #19d8ff;clip-path:polygon(0 0,35% 0,35% 12%,12% 12%,12% 35%,0 35%,0 0,100% 0,100% 35%,88% 35%,88% 12%,65% 12%,65% 0,100% 0,100% 100%,65% 100%,65% 88%,88% 88%,88% 65%,100% 65%,100% 100%,0 100%,0 65%,12% 65%,12% 88%,35% 88%,35% 100%,0 100%)}
.ndx-holo:after{border:0;inset:9px;background:#19d8ff;transform:rotate(45deg);clip-path:none;opacity:.6}
.ndx-holo.sel{opacity:1;transform:scale(1.35)}.ndx-holo.sel:before{border-color:#ffd34a}.ndx-holo.used{opacity:.25}
.ndx-holo.k-kite:after,.ndx-holo.k-sentinel:after{background:#ff5a8a}.ndx-holo.k-sign:after{background:#ff40c0}.ndx-holo.k-vent:after{background:#c8e8f0;border-radius:50%}.ndx-holo.k-car:after{background:#ffb020}
.ndx-mark{position:absolute;left:0;top:0;width:12px;height:12px;margin:-6px;border:2px solid #ff4a6a;transform:rotate(45deg);box-shadow:0 0 6px #ff2a5a}
.ndx-mark.k-shield{border-color:#ffb020}.ndx-mark.k-marksman{border-color:#c060ff}.ndx-mark.k-mender{border-color:#50ff90}.ndx-mark.k-heavy{border-color:#ff7030;width:15px;height:15px;margin:-7px}
.ndx-bar{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(64px,calc(env(safe-area-inset-bottom) + 64px));display:flex;gap:10px;align-items:flex-end}
.ndx-ab{position:relative;width:40px;height:40px;border:1px solid #6fe8ff88;background:#04141ccc;transform:skewX(-10deg)}
.ndx-ab svg{position:absolute;inset:6px;width:28px;height:28px;transform:skewX(10deg);stroke:#d8f6ff;fill:none;stroke-width:2}
.ndx-ab i{position:absolute;left:0;right:0;bottom:0;background:#04141c;opacity:.82}
.ndx-ab b{position:absolute;left:0;right:0;top:9px;text-align:center;font-size:17px;transform:skewX(10deg);text-shadow:0 0 4px #000}.ndx-ab.cool svg{opacity:.25}
.ndx-ab u{position:absolute;right:2px;bottom:1px;font-size:9px;text-decoration:none;opacity:.7;transform:skewX(10deg)}
.ndx-ab.ready{border-color:#7af0ff;box-shadow:0 0 8px #19d8ff66}
.ndx-pips{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.ndx-pips span{font-size:9px;letter-spacing:.14em;opacity:.8}
.ndx-pips div{display:flex;gap:4px}.ndx-pips i{width:12px;height:12px;border:1px solid #19d8ff;transform:rotate(45deg);background:#04141c;overflow:hidden;position:relative}
.ndx-pips i b{position:absolute;left:0;right:0;bottom:0;background:#19d8ff}
.ndx-ult{position:relative;width:52px;height:52px}
.ndx-ult svg{width:52px;height:52px;transform:rotate(-90deg)}.ndx-ult circle{fill:#04141ccc;stroke-width:4}
.ndx-ult .bg{stroke:#ff2a9a33}.ndx-ult .fg{stroke:#ff3aa8;fill:none;stroke-dasharray:138;stroke-dashoffset:138}
.ndx-ult b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px}
.ndx-ult u{position:absolute;right:-2px;bottom:-2px;font-size:9px;text-decoration:none;opacity:.7}
.ndx-ult.ready .fg{filter:drop-shadow(0 0 5px #ff3aa8)}.ndx-ult.ready b{color:#ff8ad0}
.ndx-way{position:absolute;left:0;top:0;transform:translate(-50%,-50%);text-align:center;color:#ffb020;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 3px #000}
.ndx-way:before{content:"";display:block;width:0;height:0;margin:0 auto 3px;border:7px solid transparent;border-top:10px solid #ffb020;filter:drop-shadow(0 0 3px #ffb020)}
.ndx-way.pulse{animation:ndxp .7s infinite alternate}@keyframes ndxp{to{transform:translate(-50%,-50%) scale(1.3);opacity:.6}}
.ndx-ctick{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;width:0;height:0;margin-left:-5px;border:5px solid transparent;border-top:8px solid #ffb020}
.ndx-hint{position:absolute;left:50%;bottom:max(150px,calc(env(safe-area-inset-bottom) + 150px));transform:translateX(-50%);padding:5px 12px;border:1px solid #ffb02088;background:#1c1004cc;color:#ffd080;font:600 12px system-ui,"PingFang TC","Noto Sans TC",sans-serif;letter-spacing:.04em;white-space:nowrap}
.ndx-prompt{position:absolute;left:50%;top:62%;transform:translateX(-50%);padding:6px 14px;border:1px solid #19d8ff;background:#04141cdd;letter-spacing:.14em;font-size:12px;box-shadow:0 0 12px #19d8ff55}
.ndx-pop{position:absolute;left:0;top:0;transform:translate(-50%,-50%);font:italic 900 26px/1 Impact,"Arial Black","PingFang TC","Noto Sans TC",sans-serif;letter-spacing:.02em;color:#fff35a;-webkit-text-stroke:2px #1a0010;paint-order:stroke;text-shadow:3px 3px 0 #ff2a7a}
.ndx-pop.k-shield{color:#ffb020}.ndx-pop.k-emp{color:#7af0ff;text-shadow:3px 3px 0 #2050ff}.ndx-pop.k-overload{color:#ff8ad0;text-shadow:3px 3px 0 #6020ff}
.ndx-say{position:absolute;left:0;top:0;transform:translate(-50%,-100%);max-width:260px;padding:3px 8px;background:#020a10c8;border-left:2px solid #50d8ff;font:500 12px/1.35 system-ui,"PingFang TC","Noto Sans TC",sans-serif;color:#cfefff;text-align:left}
.ndx-say b{display:block;font:600 9px ui-monospace,monospace;letter-spacing:.14em;color:#50d8ff}
.ndx-card{position:absolute;left:50%;top:30%;transform:translateX(-50%);width:min(620px,calc(100vw - 48px));text-align:center;font:500 17px/1.6 system-ui,"PingFang TC","Noto Sans TC",sans-serif;color:#e8f8ff;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .8s}
.ndx-card.on{opacity:1}.ndx-card p{margin:0 0 .5em}.ndx-card p.dim{opacity:.7;font-size:14px}
.nd-hit.shield:before,.nd-hit.shield:after{background:#ffb020}
.nd-ammo.ndx-low b{color:#ffb020}.nd-ammo.ndx-dry b{color:#ff5a6a}
`;

export function createOverlay({ camera, onDispose, T, hudRoot }) {
  const root = document.createElement('div'); root.className = 'ndx';
  const X = T.xt;
  root.innerHTML = `<style>${CSS}</style><div class="ndx-scan"></div><div class="ndx-over"></div><div class="ndx-flash"></div>
    <div class="ndx-ring"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="28"/><circle class="fg" cx="32" cy="32" r="28"/></svg></div><div class="ndx-tgt"><span></span><em></em></div>
    <div class="ndx-bar">
      <div class="ndx-pips"><span>${X.pips}</span><div><i><b></b></i><i><b></b></i><i><b></b></i></div><span class="ndx-gk">G</span></div>
      <div class="ndx-ab" data-a="dash"><svg viewBox="0 0 28 28"><path d="M4 14h13M12 8l6 6-6 6M20 6v16"/></svg><i></i><b></b><u>${X.keys.dash}</u></div>
      <div class="ndx-ab" data-a="grenade"><svg viewBox="0 0 28 28"><circle cx="14" cy="15" r="7"/><path d="M14 2v5M6 6l3 3M22 6l-3 3M11 15l2-3 2 4 2-3"/></svg><i></i><b></b><u>${X.keys.grenade}</u></div>
      <div class="ndx-ult"><svg viewBox="0 0 52 52"><circle class="bg" cx="26" cy="26" r="22"/><circle class="fg" cx="26" cy="26" r="22"/></svg><b>0%</b><u>${X.keys.over}</u></div>
    </div>
    <div class="ndx-ctick" hidden></div><div class="ndx-way" hidden></div><div class="ndx-hint" hidden></div><div class="ndx-prompt" hidden></div><div class="ndx-card"></div>`;
  document.body.appendChild(root);
  onDispose(() => root.remove());
  const $ = (s) => root.querySelector(s);
  const ring = $('.ndx-ring'), ringFg = $('.ndx-ring .fg'), tgt = $('.ndx-tgt'), scanEl = $('.ndx-scan'), overEl = $('.ndx-over'), flashEl = $('.ndx-flash');
  const pips = [...root.querySelectorAll('.ndx-pips i b')], abs = Object.fromEntries([...root.querySelectorAll('.ndx-ab')].map((el) => [el.dataset.a, el]));
  const ult = $('.ndx-ult'), ultFg = $('.ndx-ult .fg'), ultTx = $('.ndx-ult b'), way = $('.ndx-way'), ctick = $('.ndx-ctick'), hint = $('.ndx-hint'), promptEl = $('.ndx-prompt'), card = $('.ndx-card');
  const ammoEl = hudRoot?.querySelector('.nd-ammo');
  // pooled elements, placed each frame
  const pool = (cls, n) => Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = cls; d.style.display = 'none'; root.appendChild(d); return d; });
  const holos = pool('ndx-holo', 28), marks = pool('ndx-mark', 20), popEls = pool('ndx-pop', 5), sayEls = pool('ndx-say', 3);
  const pops = [], says = [];
  let flashT = 0, promptT = 0, cardT = 0, cardOn = false, under = () => null;
  /** world point -> { x, y } in CSS px, or null when behind the camera */
  const v = [0, 0, 0];
  function project(p, out = {}) {
    const e = camera.matrixWorldInverse.elements, m = camera.projectionMatrix.elements;
    v[0] = p[0]; v[1] = p[1]; v[2] = p[2];
    const vx = e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12], vy = e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13], vz = e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14];
    if (vz > -0.1) return null;
    out.x = ((m[0] * vx) / -vz * 0.5 + 0.5) * innerWidth; out.y = (0.5 - (m[5] * vy) / -vz * 0.5) * innerHeight; out.d = -vz; out.dist = Math.hypot(vx, vy, vz);
    return out;
  }
  const place = (el, p, kind) => { el.style.display = ''; el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; if (kind !== undefined && el.dataset.k !== kind) { el.dataset.k = kind; } };
  const P = {};
  return {
    root, project,
    /** on touch: (x, y) => the control's rect a point is under, or null (hud.under); markers keep off the buttons */
    avoid(fn) { under = fn; },
    /** the hack: scanning on/off; the ring's fill 0..1 (null: hidden); the target's line and cost line; bad: refused */
    hack({ scan, progress, label, sub, bad, items }) {
      scanEl.classList.toggle('on', !!scan);
      ring.style.opacity = progress != null ? '1' : '0';
      if (progress != null) ringFg.style.strokeDashoffset = String(176 * (1 - Math.min(1, progress)));
      ring.classList.toggle('bad', !!bad); tgt.classList.toggle('bad', !!bad);
      tgt.style.opacity = label ? '1' : '0';
      if (label) { tgt.firstChild.textContent = label; tgt.lastChild.textContent = sub || ''; }
      let n = 0;
      for (const it of scan ? items : []) {
        if (n >= holos.length) break;
        if (!project(it.pos, P) || P.dist > 30) continue;
        const el = holos[n++]; place(el, P);
        const cls = `ndx-holo k-${it.kind}${it.sel ? ' sel' : ''}${it.used ? ' used' : ''}`;
        if (el.className !== cls) el.className = cls;
      }
      for (; n < holos.length; n++) holos[n].style.display = 'none';
    },
    /** robots shown through walls: [{ pos, kind }] */
    marks(list) {
      let n = 0;
      for (const m of list) { if (n >= marks.length) break; if (!project(m.pos, P)) continue; const el = marks[n++]; place(el, P); el.style.opacity = under(P.x, P.y, 6) ? '0.2' : ''; const cls = 'ndx-mark k-' + m.kind; if (el.className !== cls) el.className = cls; }
      for (; n < marks.length; n++) marks[n].style.display = 'none';
    },
    /** the bar: pips { n (whole), frac (of the next), max }; dash / grenade { left, cd }; over { charge 0..1, active } */
    bar({ charges, frac, dash, grenade, over, free }) {
      pips.forEach((b, i) => { b.style.height = `${free ? 100 : i < charges ? 100 : i === charges ? Math.round(frac * 100) : 0}%`; });
      for (const [k, s] of [['dash', dash], ['grenade', grenade]]) {
        const el = abs[k]; el.querySelector('i').style.height = `${(100 * s.left / s.cd).toFixed(0)}%`;
        el.querySelector('b').textContent = s.left > 0 ? String(Math.ceil(s.left)) : ''; el.classList.toggle('ready', s.left <= 0); el.classList.toggle('cool', s.left > 0);
      }
      ultFg.style.strokeDashoffset = String(138 * (1 - (over.active ? over.left / over.len : over.charge)));
      ultTx.textContent = over.active ? `${Math.ceil(over.left)}s` : `${Math.floor(over.charge * 100)}%`;
      ult.classList.toggle('ready', over.charge >= 1 || over.active);
      overEl.classList.toggle('on', over.active);
    },
    /** the ammo: state 'ok' | 'low' | 'dry'; the nearest source { pos, label } or null; yaw for the compass tick */
    ammo(state, src, yaw) {
      ammoEl?.classList.toggle('ndx-low', state === 'low'); ammoEl?.classList.toggle('ndx-dry', state === 'dry');
      hint.hidden = state !== 'dry'; if (state === 'dry') hint.textContent = X.ammoHint;
      const show = state !== 'ok' && src;
      way.hidden = !show; ctick.hidden = !show;
      if (!show) return;
      way.classList.toggle('pulse', state === 'dry');
      const p = project(src.pos, P);
      let x, y;
      // on screen: over the source (kept clear of the radio line and the bars); behind: at the side it lies on
      if (p && p.x > 30 && p.x < innerWidth - 30) { x = p.x; y = Math.min(innerHeight - 200, Math.max(70, p.y)); }
      else { const side = Math.sin(Math.atan2(src.dz, src.dx) - yaw) >= 0 ? 1 : -1; x = side > 0 ? innerWidth - 70 : 70; y = innerHeight * 0.45; }
      const r = under(x, y); if (r) { y = r[2] - 30; if (under(x, y)) way.style.opacity = '0.25'; else way.style.opacity = ''; } else way.style.opacity = '';
      way.style.left = `${x.toFixed(0)}px`; way.style.top = `${y.toFixed(0)}px`;
      way.textContent = `${src.label} ${Math.round(src.dist)} ${T.metres}`;
      // the compass: hud.js slides 3 px a degree under a 300 px window; bearing 0 = north (-Z), clockwise
      const brgView = Math.atan2(Math.cos(yaw), -Math.sin(yaw)) * 180 / Math.PI, brgTo = Math.atan2(src.dx, -src.dz) * 180 / Math.PI;
      let d = ((brgTo - brgView + 540) % 360) - 180; d = Math.max(-50, Math.min(50, d));
      ctick.style.transform = `translateX(${(d * 3).toFixed(0)}px)`;
    },
    /** a comic word at a point for 0.7 s (at most five at once) */
    pop(word, pos, kind) {
      if (pops.length >= popEls.length) pops.shift().el.style.display = 'none';
      const el = popEls.find((e) => !pops.some((p) => p.el === e));
      el.textContent = word; el.className = 'ndx-pop k-' + kind;
      pops.push({ el, pos: pos.slice(), t: 0, r: (Math.random() - 0.5) * 24 });
    },
    /** a line over a speaker's head; who: a short tag */
    say(text, getPos, who, sec = 3) {
      if (says.length >= sayEls.length) says.shift().el.style.display = 'none';
      const el = sayEls.find((e) => !says.some((s) => s.el === e));
      el.innerHTML = ''; const b = document.createElement('b'); b.textContent = who; el.append(b, document.createTextNode(text));
      says.push({ el, getPos, t: sec });
    },
    hint(text) { hint.hidden = !text; if (text) hint.textContent = text; },
    prompt(text, sec = 6) { promptEl.hidden = false; promptEl.textContent = text; promptT = sec; },
    flash(color = '#9ff4ff', k = 0.35) { flashEl.style.background = color; flashT = k; },
    /** the story's card: lines (the last can be dim), shown for sec seconds */
    card(lines, sec = 8, dimLast = false) {
      card.innerHTML = ''; lines.forEach((l, i) => { const p = document.createElement('p'); p.textContent = l; if (dimLast && i === lines.length - 1) p.className = 'dim'; card.appendChild(p); });
      card.classList.add('on'); cardOn = true; cardT = sec;
    },
    get cardOn() { return cardOn; },
    /** once a display frame */
    update(dt) {
      flashT = Math.max(0, flashT - dt); flashEl.style.opacity = String(flashT.toFixed(3));
      if (promptT > 0 && (promptT -= dt) <= 0) promptEl.hidden = true;
      if (cardOn && (cardT -= dt) <= 0) { card.classList.remove('on'); cardOn = false; }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t += dt;
        if (p.t > 0.75 || !project(p.pos, P)) { p.el.style.display = 'none'; pops.splice(i, 1); continue; }
        const s = p.t < 0.12 ? 0.4 + p.t / 0.12 * 0.9 : 1.3 - Math.min(0.3, (p.t - 0.12) * 0.6);
        p.el.style.display = ''; p.el.style.opacity = String(Math.min(1, (0.75 - p.t) * 5).toFixed(2));
        p.el.style.transform = `translate(${P.x.toFixed(0)}px,${(P.y - p.t * 40).toFixed(0)}px) translate(-50%,-50%) rotate(${p.r.toFixed(0)}deg) scale(${s.toFixed(2)})`;
      }
      for (let i = says.length - 1; i >= 0; i--) {
        const s = says[i]; s.t -= dt;
        const at = s.getPos();
        if (s.t <= 0 || !at) { s.el.style.display = 'none'; says.splice(i, 1); continue; }
        if (!project(at, P) || P.dist > 30) { s.el.style.display = 'none'; continue; }
        s.el.style.display = ''; s.el.style.opacity = String(Math.min(1, s.t * 3).toFixed(2));
        s.el.style.transform = `translate(${P.x.toFixed(0)}px,${P.y.toFixed(0)}px) translate(-50%,-100%)`;
      }
    },
  };
}

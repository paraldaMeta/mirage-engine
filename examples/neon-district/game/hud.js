// The shooter's own HUD over @miragekit/game's overlay (which keeps the objective, prompts, toasts and menus):
// health and ammunition, a crosshair that opens with the spread, hit and kill markers, the direction a hit came
// from, a red edge when hurt, the uplink's progress, a marker on the next objective, and the options panel. On touch
// screens its pieces move out from under the thumbs (the touch controls are in touch.js).
const CSS = `
.nd{position:fixed;inset:0;pointer-events:none;font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8f6ff;z-index:5;user-select:none;-webkit-user-select:none}
.nd *{box-sizing:border-box}
.nd-vit{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(18px,env(safe-area-inset-bottom));width:230px}
.nd-vit i{display:block;height:9px;border:1px solid #6fe8ff88;background:#04141ccc;transform:skewX(-18deg)}
.nd-vit i b{display:block;height:100%;background:linear-gradient(90deg,#19d8ff,#7af0ff);transition:width .12s linear}
.nd-vit.low i b{background:linear-gradient(90deg,#ff2a5a,#ff7a5a)}
.nd-vit span{display:block;margin-bottom:5px;letter-spacing:.14em;font-size:11px;opacity:.85;text-shadow:0 1px 3px #000}
.nd-ammo{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(54px,calc(env(safe-area-inset-bottom) + 54px));text-align:right;text-shadow:0 1px 4px #000}
.nd-ammo b{font-size:38px;font-weight:700;letter-spacing:.02em}.nd-ammo span{font-size:16px;opacity:.75;margin-left:6px}
.nd-ammo em{display:block;font-style:normal;font-size:11px;letter-spacing:.14em;opacity:.8}
.nd-ammo.empty b{color:#ff5a6a}
.nd-x{position:absolute;left:50%;top:50%;width:0;height:0}
.nd-x i{position:absolute;background:#eaffffee;box-shadow:0 0 2px #000}
.nd-x i.h{width:9px;height:2px;top:-1px}.nd-x i.v{width:2px;height:9px;left:-1px}
.nd-x u{position:absolute;left:-1px;top:-1px;width:2px;height:2px;background:#fff;box-shadow:0 0 2px #000}
.nd-hit{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px;opacity:0;transform:rotate(45deg)}
.nd-hit:before,.nd-hit:after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}
.nd-hit:before{left:12px;top:0;width:2px;height:26px;clip-path:polygon(0 0,100% 0,100% 30%,0 30%,0 70%,100% 70%,100% 100%,0 100%)}
.nd-hit:after{top:12px;left:0;height:2px;width:26px;clip-path:polygon(0 0,30% 0,30% 100%,0 100%,0 0,70% 0,100% 0,100% 100%,70% 100%,70% 0)}
.nd-hit.head:before,.nd-hit.head:after{background:#ffd34a}.nd-hit.kill:before,.nd-hit.kill:after{background:#ff3a5a}
.nd-hurt{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 52%,#ff103088 100%)}
.nd-dir{position:absolute;left:50%;top:50%;width:190px;height:190px;margin:-95px;opacity:0}
.nd-dir:before{content:"";position:absolute;left:50%;top:0;margin-left:-22px;border:22px solid transparent;border-top:0;border-bottom:12px solid #ff3050dd;filter:drop-shadow(0 0 4px #ff3050)}
.nd-up{position:absolute;left:50%;top:max(62px,calc(env(safe-area-inset-top) + 62px));width:min(320px,60vw);transform:translateX(-50%);text-align:center;letter-spacing:.14em;font-size:11px;text-shadow:0 1px 3px #000}
.nd-up i{display:block;margin-top:5px;height:6px;border:1px solid #6fe8ff88;background:#04141ccc}.nd-up i b{display:block;height:100%;background:#19d8ff}
.nd-mark{position:absolute;left:0;top:0;transform:translate(-50%,-50%);text-align:center;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 3px #000;color:#ffd34a}
.nd-mark:before{content:"";display:block;width:10px;height:10px;margin:0 auto 3px;border:2px solid #ffd34a;transform:rotate(45deg)}
.nd-tally{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(128px,calc(env(safe-area-inset-bottom) + 128px));text-align:right;font-size:11px;letter-spacing:.12em;opacity:.8;text-shadow:0 1px 3px #000}
/* touch: health and the gun bottom centre, the compass top centre, the radio under it, nothing under a thumb */
.nd.touch .nd-vit{left:50%;bottom:max(8px,env(safe-area-inset-bottom));width:min(210px,28vw);transform:translateX(-50%)}
.nd.touch .nd-vit span{text-align:center;margin-bottom:3px;font-size:10px}
.nd.touch .nd-ammo{left:50%;right:auto;bottom:calc(max(8px,env(safe-area-inset-bottom)) + 30px);transform:translateX(-50%);text-align:center;white-space:nowrap}
.nd.touch .nd-ammo b{font-size:24px}.nd.touch .nd-ammo span{font-size:13px}.nd.touch .nd-ammo em{font-size:9px;margin-bottom:1px}
.nd.touch .nd-tally{display:none}
.nd.touch .nd-comp{width:220px;margin-left:-110px;top:max(6px,env(safe-area-inset-top))}
.nd.touch .nd-up{top:max(36px,calc(env(safe-area-inset-top) + 36px));width:min(260px,34vw)}
.nd.touch .nd-radio{bottom:auto;top:max(66px,calc(env(safe-area-inset-top) + 66px));max-width:min(400px,42vw);padding:6px 10px;font-size:12px;line-height:1.4}
.nd.touch .nd-feed{top:max(62px,calc(env(safe-area-inset-top) + 62px));right:max(12px,env(safe-area-inset-right))}
.nd-comp{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));width:300px;height:26px;margin-left:-150px;overflow:hidden;font-size:11px;letter-spacing:.12em;text-shadow:0 1px 3px #000;-webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)}
.nd-comp div{position:absolute;top:0;left:50%;height:100%;white-space:nowrap}
.nd-comp span{position:absolute;top:2px;width:60px;margin-left:-30px;text-align:center}.nd-comp span.t{top:17px;width:1px;height:6px;margin-left:0;background:#d8f6ff99}
.nd-comp:after{content:"";position:absolute;left:50%;top:0;width:1px;height:6px;background:#ffd34a}
.nd-radio{position:absolute;left:50%;bottom:max(96px,calc(env(safe-area-inset-bottom) + 96px));transform:translateX(-50%);max-width:min(640px,calc(100vw - 40px));padding:8px 14px;background:#04141cd9;border-left:2px solid #ffd34a;font:500 14px/1.45 system-ui,"PingFang TC","Noto Sans TC",sans-serif;letter-spacing:.01em;opacity:0;transition:opacity .35s}
.nd-radio.on{opacity:1}.nd-radio b{display:block;font:600 10px ui-monospace,monospace;letter-spacing:.16em;color:#ffd34a;margin-bottom:2px}
.nd-feed{position:absolute;right:max(18px,env(safe-area-inset-right));top:38%;text-align:right;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 3px #000}
.nd-feed div{margin:3px 0;transition:opacity .6s}.nd-feed div.head{color:#ffd34a}
.nd-opt{position:fixed;z-index:45;box-sizing:border-box;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:18px 20px;color:#d8f6ff;user-select:none;-webkit-user-select:none;background:#06161ef2;border:1px solid #6fe8ff66;pointer-events:auto;font:500 13px/1.4 system-ui,"PingFang TC","Noto Sans TC",sans-serif}
.nd-opt *{box-sizing:border-box}
.nd-opt.wide{width:min(680px,calc(100vw - 24px));padding:12px 18px}
.nd-opt.wide .cols{display:grid;grid-template-columns:1fr 1fr;column-gap:26px}
.nd-opt.wide label{margin:4px 0;min-height:34px}.nd-opt.wide input[type=range]{width:118px}.nd-opt.wide h2{margin-bottom:6px}.nd-opt.wide p{margin-top:6px}
.nd-opt h3{grid-column:1/-1;margin:8px 0 0;font:600 11px ui-monospace,monospace;letter-spacing:.16em;color:#ffd34a}
.nd-opt h2{margin:0 0 12px;font:600 13px ui-monospace,monospace;letter-spacing:.16em;color:#7af0ff}
.nd-opt label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0}
.nd-opt output{width:44px}
.nd-opt input[type=range]{width:150px;accent-color:#19d8ff}.nd-opt output{width:38px;text-align:right;font:600 12px ui-monospace,monospace}
.nd-opt button{min-height:32px;padding:0 12px;background:#04141c;color:#d8f6ff;border:1px solid #6fe8ff88;font:inherit;cursor:pointer}
.nd-opt button:focus-visible,.nd-opt input:focus-visible{outline:2px solid #ffd34a;outline-offset:2px}
.nd-opt p{margin:12px 0 0;font-size:11px;opacity:.7}
.mg-ui .mg-cross{display:none}
.mg-ui{--mg-accent:#19d8ff}
`;

const HOURS = { night: 23.25, dawn: 6.25, day: 13.5, dusk: 17 };
const hourValue = (h) => (h in HOURS ? HOURS[h] : (() => { const [a, b] = String(h).split(':'); return +a + (+b || 0) / 60; })());
const hourText = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;

export function createHud({ camera, onDispose, T }) {
  const root = document.createElement('div');
  root.className = 'nd';
  root.innerHTML = `<style>${CSS}</style>
    <div class="nd-hurt"></div><div class="nd-dir"></div>
    <div class="nd-x"><i class="h"></i><i class="h"></i><i class="v"></i><i class="v"></i><u></u></div><div class="nd-hit"></div>
    <div class="nd-vit" role="status" aria-label="Health"><span>${T.vitals} <b class="hp">100</b></span><i><b style="width:100%"></b></i></div>
    <div class="nd-ammo" role="status" aria-label="Ammunition"><em>${T.gun}</em><b>24</b><span>96</span></div>
    <div class="nd-up" hidden><span>${T.uplink}</span><i><b style="width:0"></b></i></div>
    <div class="nd-mark" hidden></div><div class="nd-tally"></div>
    <div class="nd-comp" aria-hidden="true"><div></div></div><div class="nd-feed" aria-live="polite"></div>
    <div class="nd-radio" role="status" aria-live="polite"><b></b><span></span></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const x = [...root.querySelectorAll('.nd-x i')], hitEl = $('.nd-hit'), hurtEl = $('.nd-hurt'), dirEl = $('.nd-dir'), vit = $('.nd-vit'), ammo = $('.nd-ammo'), up = $('.nd-up'), mark = $('.nd-mark');
  let hitT = 0, hurtT = 0, dirT = 0, dirFrom = null, radioT = 0, opt = null;
  // the compass: a strip of eight headings, three turns long, slid under a fixed window (3 px a degree)
  const strip = $('.nd-comp div'), PX = 3, radioQ = [], feed = $('.nd-feed'), radioEl = $('.nd-radio');
  for (let k = -8; k < 16; k++) { const s = document.createElement('span'); s.textContent = T.compass[((k % 8) + 8) % 8]; s.style.left = `${k * 45 * PX}px`; strip.appendChild(s); const t = document.createElement('span'); t.className = 't'; t.style.left = `${(k * 45 + 22.5) * PX}px`; strip.appendChild(t); }
  const shown = new WeakMap();
  const set = (el, k, v) => { let c = shown.get(el); if (!c) shown.set(el, (c = {})); if (c[k] !== v) { c[k] = v; if (k === 'text') el.textContent = v; else el.style[k] = v; } };
  onDispose(() => { root.remove(); opt?.remove(); });
  const v3 = { x: 0, y: 0, z: 0 };
  return {
    root,
    /** touch mode: the HUD's pieces move out from under the thumbs (the controls themselves are in touch.js) */
    touch() { root.classList.add('touch'); },
    hit(kind) { hitEl.className = 'nd-hit ' + kind; hitT = kind === 'kill' ? 0.4 : 0.2; },
    /** a line from control, shown under the crosshair for a few seconds; lines queue */
    radio(text) { radioQ.push(text); },
    /** a line in the kill feed (head: a head shot) */
    feed(text, head) { const d = document.createElement('div'); d.textContent = text; if (head) d.className = 'head'; feed.prepend(d); while (feed.children.length > 4) feed.lastChild.remove(); setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 3500); },
    get optionsOpen() { return !!opt; },
    /** the options panel: values { sens, fov, invert, hour, lang, and with touch: tSens, tOpacity, tScale, leftFire,
     *  sprintLock }, touch (show the touch rows), onChange(key, value), onHour(h), onClose(), onLang() */
    options(o) {
      if (opt) { opt.remove(); opt = null; o?.onClose?.(); return false; }
      if (!o) return false;
      const v = o.values, num = (k, x) => (k === 'fov' ? String(x) : k === 'tOpacity' ? `${Math.round(x * 100)}%` : (+x).toFixed(2));
      const range = (k, min, max, step, label) => `<label>${label}<span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"><output>${num(k, v[k])}</output></span></label>`;
      const flip = (k, label) => `<label>${label}<button data-b="${k}" aria-pressed="${!!v[k]}">${v[k] ? T.opt.on : T.opt.off}</button></label>`;
      opt = document.createElement('div'); opt.className = 'nd-opt' + (o.touch ? ' wide' : ''); opt.setAttribute('role', 'dialog'); opt.setAttribute('aria-label', T.opt.title);
      opt.innerHTML = `<h2>${T.opt.title}</h2><div class="cols">
        ${range('sens', 0.3, 2.5, 0.05, T.opt.sens)}${range('fov', 50, 90, 1, T.opt.fov)}
        <label>${T.opt.time}<span><input type="range" data-k="hour" min="0" max="23.75" step="0.25" value="${hourValue(v.hour)}"><output>${hourText(hourValue(v.hour))}</output></span></label>
        ${flip('invert', T.opt.invert)}
        <label>${T.opt.full}<button data-b="full">${document.fullscreenElement ? T.opt.on : T.opt.off}</button></label>
        <label>${T.opt.pops}<button data-b="pops">${v.pops === false ? T.opt.off : T.opt.on}</button></label>
        <label>${T.opt.lang}<button data-b="lang">${v.lang === 'zh' ? '繁體中文' : 'English'}</button></label>
        ${o.touch ? `<h3>${T.opt.touch}</h3>${range('tSens', 0.3, 2.5, 0.05, T.opt.tSens)}${range('tOpacity', 0.2, 1, 0.05, T.opt.tOpacity)}${range('tScale', 0.8, 1.25, 0.05, T.opt.tScale)}${flip('leftFire', T.opt.leftFire)}${flip('sprintLock', T.opt.sprintLock)}` : ''}
        <label><span></span><button data-b="close">${T.opt.close}</button></label></div><p>${o.touch ? T.opt.touchHint : T.opt.hint}</p>`;
      document.body.appendChild(opt);
      for (const r of opt.querySelectorAll('input')) r.addEventListener('input', () => {
        if (r.dataset.k === 'hour') { r.nextElementSibling.textContent = hourText(+r.value); o.onHour(hourText(+r.value)); return; }
        r.nextElementSibling.textContent = num(r.dataset.k, +r.value); o.onChange(r.dataset.k, +r.value);
      });
      for (const b of opt.querySelectorAll('button')) { b.addEventListener('keydown', (e) => e.stopPropagation()); b.addEventListener('click', () => {
        const k = b.dataset.b;
        if (k === 'close') { opt.remove(); opt = null; o.onClose(); }
        else if (k === 'invert' || k === 'leftFire' || k === 'sprintLock') { v[k] = !v[k]; b.textContent = v[k] ? T.opt.on : T.opt.off; b.setAttribute('aria-pressed', String(v[k])); o.onChange(k, v[k]); }
        else if (k === 'full') { const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); Promise.resolve(p).catch(() => {}).then(() => { b.textContent = document.fullscreenElement ? T.opt.on : T.opt.off; }); }
        else if (k === 'lang') o.onLang();
        else if (k === 'pops') { o.values.pops = o.values.pops === false; b.textContent = o.values.pops ? T.opt.on : T.opt.off; o.onChange('pops', o.values.pops); }
      }); }
      if (!o.touch) opt.querySelector('input').focus();   // on a phone a focused slider would take the first swipe
      return true;
    },
    hurt(from) { hurtT = 0.6; dirT = 1.2; dirFrom = from ? from.slice() : null; },
    /** once a display frame */
    update(dt, s) {
      const gap = 5 + s.spread * 1500;
      set(x[0], 'left', `${-gap - 9}px`); set(x[1], 'left', `${gap}px`); set(x[2], 'top', `${-gap - 9}px`); set(x[3], 'top', `${gap}px`);
      set($('.nd-x'), 'opacity', s.dead || s.ads > 0.6 ? '0' : '1');
      hitT = Math.max(0, hitT - dt); set(hitEl, 'opacity', String(Math.min(1, hitT * 8)));
      hurtT = Math.max(0, hurtT - dt); set(hurtEl, 'opacity', String(Math.max(Math.min(1, hurtT * 2), s.hp < 35 ? 0.55 * (1 - s.hp / 35) : 0).toFixed(2)));
      dirT = Math.max(0, dirT - dt);
      if (dirT > 0 && dirFrom) {   // the arrow points toward whoever hit you, relative to the view
        const a = Math.atan2(dirFrom[0] - s.pos[0], dirFrom[2] - s.pos[2]), view = Math.atan2(Math.cos(s.yaw), Math.sin(s.yaw));
        set(dirEl, 'transform', `rotate(${(-(a - view) * 180 / Math.PI).toFixed(0)}deg)`);
      }
      set(dirEl, 'opacity', String(Math.min(1, dirT).toFixed(2)));
      set($('.nd-vit i b'), 'width', `${Math.max(0, s.hp).toFixed(0)}%`); set($('.hp'), 'text', String(Math.ceil(Math.max(0, s.hp))));
      vit.classList.toggle('low', s.hp < 35);
      set($('.nd-ammo b'), 'text', s.reloading ? '--' : String(s.mag)); set($('.nd-ammo span'), 'text', String(s.reserve));
      ammo.classList.toggle('empty', s.mag === 0 && !s.reloading);
      set($('.nd-tally'), 'text', s.tally);
      // compass: bearing 0 = north (-Z), clockwise
      const brg = Math.atan2(Math.cos(s.yaw), -Math.sin(s.yaw)) * 180 / Math.PI;
      strip.style.transform = `translateX(${(-(((brg % 360) + 360) % 360) * PX).toFixed(1)}px)`;
      // the radio: one line at a time, six seconds or so each
      radioT -= dt;
      if (radioT <= 0 && radioEl.classList.contains('on')) radioEl.classList.remove('on');
      if (radioT <= -0.4 && radioQ.length) { const line = radioQ.shift(); radioEl.querySelector('b').textContent = T.control; radioEl.querySelector('span').textContent = line; radioEl.classList.add('on'); radioT = Math.min(8, 2.5 + line.length * (/[\u4e00-\u9fff]/.test(line) ? 0.14 : 0.055)); }
      up.hidden = s.uplink == null;
      if (s.uplink != null) { set($('.nd-up span'), 'text', s.uplinkText); set($('.nd-up i b'), 'width', `${(s.uplink * 100).toFixed(1)}%`); }
      // the objective's marker: its point projected to the screen, pinned to the edge when it is behind or outside
      mark.hidden = !s.goal;
      if (s.goal) {
        v3.x = s.goal[0]; v3.y = s.goal[1]; v3.z = s.goal[2];
        const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
        const vx = e[0] * v3.x + e[4] * v3.y + e[8] * v3.z + e[12], vy = e[1] * v3.x + e[5] * v3.y + e[9] * v3.z + e[13], vz = e[2] * v3.x + e[6] * v3.y + e[10] * v3.z + e[14];
        let nx = (p[0] * vx) / Math.max(-vz, 0.01), ny = (p[5] * vy) / Math.max(-vz, 0.01);
        if (vz > 0) { nx = -nx * 100; ny = -1; }
        const m = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.8, 1); nx /= m; ny /= m;
        mark.style.left = `${((nx * 0.5 + 0.5) * 100).toFixed(2)}%`; mark.style.top = `${((0.5 - ny * 0.5) * 100).toFixed(2)}%`;
        set(mark, 'text', `${Math.round(Math.hypot(vx, vy, vz))} ${T.metres}`);
      }
    },
  };
}

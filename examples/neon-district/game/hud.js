// The shooter's own HUD over @miragekit/game's overlay (which keeps the objective, prompts, toasts and menus):
// health and ammunition, the gun's name, its slot strip and the gatling's heat, a crosshair per gun that opens with
// the spread, hit and kill markers, the direction a hit came from, a red edge when hurt, the uplink's progress, a
// marker on the next objective, and the options panel. On touch screens its pieces move out from under the thumbs
// (the touch controls are in touch.js) and world markers keep off the buttons (avoid()).
const CSS = `
.nd{position:fixed;inset:0;pointer-events:none;font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,var(--nd-cjk,"PingFang TC"),monospace;color:#d8f6ff;z-index:5;user-select:none;-webkit-user-select:none}
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
.nd-dir{position:absolute;left:50%;top:50%;width:230px;height:230px;margin:-115px;opacity:0}
.nd-dir:before{content:"";position:absolute;left:50%;top:0;margin-left:-30px;border:30px solid transparent;border-top:0;border-bottom:16px solid #ff3050ee;filter:drop-shadow(0 0 6px #ff3050)}
.nd-dir:after{content:"";position:absolute;inset:0;border-radius:50%;border:5px solid transparent;border-top-color:#ff305099;filter:blur(1px)}
.nd-x{transition:opacity .1s}.nd-x i,.nd-x u{display:none}
.nd.cx-ticks .nd-x i,.nd.cx-ticks .nd-x u,.nd.cx-dot .nd-x u,.nd.cx-dot .nd-x i,.nd.cx-brackets .nd-x u{display:block}
.nd.cx-dot .nd-x i.h{width:5px}.nd.cx-dot .nd-x i.v{height:5px}.nd.cx-dot .nd-x u{width:3px;height:3px;left:-1.5px;top:-1.5px}
.nd-ring{position:absolute;left:50%;top:50%;border:2px solid #eaffffcc;border-radius:50%;box-shadow:0 0 2px #000,inset 0 0 2px #000;display:none}
.nd.cx-ring .nd-ring{display:block}.nd.cx-ring .nd-x u{display:block}
.nd-chev{position:absolute;left:50%;top:50%;width:0;height:0;display:none}
.nd-chev:before{content:"";position:absolute;left:-14px;top:2px;width:28px;height:14px;border:2px solid #eaffffee;border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -1px 2px #000}
.nd-chev:after{content:"";position:absolute;left:-1px;top:6px;width:2px;height:22px;background:repeating-linear-gradient(#eaffffee 0 2px,transparent 2px 6px)}
.nd.cx-chevron .nd-chev{display:block}.nd.cx-chevron .nd-x u{display:block}
.nd-brk{position:absolute;left:50%;top:50%;width:0;height:0;display:none}
.nd-brk i{position:absolute;top:-12px;width:7px;height:24px;border:2px solid #eaffffee;box-shadow:0 0 2px #000}
.nd-brk i:first-child{border-right:0}.nd-brk i:last-child{border-left:0}
.nd.cx-brackets .nd-brk{display:block}
.nd-spin{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px;border-radius:50%;opacity:0;background:conic-gradient(#7af0ff var(--p,0%),transparent 0);-webkit-mask:radial-gradient(circle,transparent 20px,#000 21px);mask:radial-gradient(circle,transparent 20px,#000 21px)}
.nd-slots{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(148px,calc(env(safe-area-inset-bottom) + 148px));display:flex;gap:4px}
.nd-slots b{position:relative;display:grid;place-items:center;width:46px;height:28px;border:1px solid #6fe8ff55;background:#04141ca8;transform:skewX(-12deg);opacity:.75}
.nd-slots b svg{width:34px;height:18px;transform:skewX(12deg);fill:none;stroke:#d8f6ff;stroke-width:1.6;stroke-linejoin:round}
.nd-slots b small{position:absolute;left:3px;top:1px;font-size:8px;transform:skewX(12deg);opacity:.8}
.nd-slots b.cur{border-color:#7af0ff;background:#0a3a4cd8;opacity:1;box-shadow:0 0 8px #19d8ff66}
.nd-slots b.locked{opacity:.3;border-style:dashed}.nd-slots b.empty svg{stroke:#ff6a7a}
.nd-heat{position:absolute;left:50%;top:calc(50% + 46px);width:150px;margin-left:-75px;font-size:9px;letter-spacing:.14em;text-align:center;text-shadow:0 1px 3px #000}
.nd-heat i{display:block;height:5px;margin-top:3px;border:1px solid #ffb02088;background:#1c1004cc}.nd-heat i b{display:block;height:100%;background:linear-gradient(90deg,#ffb020,#ff4a20)}
.nd-heat.vent{color:#ff5a3a}.nd-heat.vent i b{animation:ndvent .25s infinite alternate}@keyframes ndvent{to{opacity:.35}}
.nd.touch .nd-slots,.nd.touch .nd-tally{display:none}
.nd.touch .nd-heat{top:calc(50% + 40px);width:130px;margin-left:-65px}
.nd-up{position:absolute;left:50%;top:max(62px,calc(env(safe-area-inset-top) + 62px));width:min(320px,60vw);transform:translateX(-50%);text-align:center;letter-spacing:.14em;font-size:11px;text-shadow:0 1px 3px #000}
.nd-up i{display:block;margin-top:5px;height:6px;border:1px solid #6fe8ff88;background:#04141ccc}.nd-up i b{display:block;height:100%;background:#19d8ff}
.nd-mark{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;text-align:center;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 3px #000;color:#ffd34a}
.nd-mark:before{content:"";display:block;width:10px;height:10px;margin:0 auto 3px;border:2px solid #ffd34a;transform:rotate(45deg)}
.nd-tally{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(128px,calc(env(safe-area-inset-bottom) + 128px));text-align:right;font-size:11px;letter-spacing:.12em;opacity:.8;text-shadow:0 1px 3px #000}
/* touch: health and the gun bottom centre, the compass top centre, the radio under it, nothing under a thumb */
.nd.touch .nd-vit{left:calc(50% + (var(--ndt-band-l,0px) - var(--ndt-band-r,0px)) / 2);bottom:calc(max(8px,env(safe-area-inset-bottom)) + 36px);width:min(150px,calc(100vw - var(--ndt-band-l,0px) - var(--ndt-band-r,0px) - 8px));transform:translateX(-50%)}
.nd.touch .nd-vit span{text-align:center;margin-bottom:2px;font-size:9px}.nd.touch .nd-vit i{height:7px}
.nd.touch .nd-ammo{left:calc(50% + (var(--ndt-band-l,0px) - var(--ndt-band-r,0px)) / 2);right:auto;bottom:calc(max(8px,env(safe-area-inset-bottom)) + 62px);transform:translateX(-50%);text-align:center;white-space:nowrap}
.nd.touch .nd-ammo b{font-size:20px}.nd.touch .nd-ammo span{font-size:12px}.nd.touch .nd-ammo em{font-size:8px;margin-bottom:0}
.nd.touch .nd-tally{display:none}
.nd.touch .nd-comp{width:220px;margin-left:-110px;top:max(6px,env(safe-area-inset-top))}
.nd.touch .nd-up{top:max(36px,calc(env(safe-area-inset-top) + 36px));width:min(260px,34vw)}
/* touch: the radio (and the prompt and story card after it, overlay.js) in the strip above the buttons, right of the
   objective and left of the menu buttons */
.nd.touch .nd-radio{bottom:auto;top:max(62px,calc(env(safe-area-inset-top) + 62px));left:calc(min(30vw,280px) + max(18px,env(safe-area-inset-left)));right:max(116px,calc(env(safe-area-inset-right) + 116px));transform:none;max-width:none;padding:5px 10px;font-size:12px;line-height:1.4}
.nd.touch .nd-feed{top:max(62px,calc(env(safe-area-inset-top) + 62px));right:max(12px,env(safe-area-inset-right));max-width:calc(var(--ndt-band-r,200px) - 16px);font-size:10px}
.nd-comp{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));width:300px;height:26px;margin-left:-150px;overflow:hidden;font-size:11px;letter-spacing:.12em;text-shadow:0 1px 3px #000;-webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)}
.nd-comp div{position:absolute;top:0;left:50%;height:100%;white-space:nowrap}
.nd-comp span{position:absolute;top:2px;width:60px;margin-left:-30px;text-align:center}.nd-comp span.t{top:17px;width:1px;height:6px;margin-left:0;background:#d8f6ff99}
.nd-comp:after{content:"";position:absolute;left:50%;top:0;width:1px;height:6px;background:#ffd34a}
.nd-radio{position:absolute;left:50%;bottom:max(96px,calc(env(safe-area-inset-bottom) + 96px));transform:translateX(-50%);max-width:min(640px,calc(100vw - 40px));padding:8px 14px;background:#04141cd9;border-left:2px solid #ffd34a;font:500 14px/1.45 system-ui,var(--nd-cjk,"PingFang TC"),sans-serif;letter-spacing:.01em;opacity:0;transition:opacity .35s}
.nd-radio.on{opacity:1}.nd-radio b{display:block;font:600 10px ui-monospace,monospace;letter-spacing:.16em;color:#ffd34a;margin-bottom:2px}
.nd-feed{position:absolute;right:max(18px,env(safe-area-inset-right));top:38%;text-align:right;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 3px #000}
.nd-feed div{margin:3px 0;transition:opacity .6s}.nd-feed div.head{color:#ffd34a}
.nd-opt{position:fixed;z-index:45;box-sizing:border-box;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:18px 20px;color:#d8f6ff;user-select:none;-webkit-user-select:none;background:#06161ef2;border:1px solid #6fe8ff66;pointer-events:auto;font:500 13px/1.4 system-ui,var(--nd-cjk,"PingFang TC"),sans-serif}
.nd-opt *{box-sizing:border-box}
.nd-opt.wide{width:min(680px,calc(100vw - 24px));padding:12px 18px}
.nd-opt.wide .cols{display:grid;grid-template-columns:1fr 1fr;column-gap:26px}
.nd-opt.wide label{margin:4px 0;min-height:34px}.nd-opt.wide input[type=range]{width:118px}.nd-opt.wide h2{margin-bottom:6px}.nd-opt.wide p{margin-top:6px}
.nd-opt h3{grid-column:1/-1;margin:8px 0 0;font:600 11px ui-monospace,monospace;letter-spacing:.16em;color:#ffd34a}
.nd-opt h2{margin:0 0 12px;font:600 13px ui-monospace,monospace;letter-spacing:.16em;color:#7af0ff}
.nd-opt label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;line-height:1.25}
.nd-opt label button{flex:none;white-space:nowrap}
.nd-opt output{width:44px}
.nd-opt input[type=range]{width:150px;accent-color:#19d8ff}.nd-opt output{width:38px;text-align:right;font:600 12px ui-monospace,monospace}
.nd-opt button{min-height:32px;padding:0 12px;background:#04141c;color:#d8f6ff;border:1px solid #6fe8ff88;font:inherit;cursor:pointer}
.nd-opt button:focus-visible,.nd-opt input:focus-visible{outline:2px solid #ffd34a;outline-offset:2px}
.nd-opt p{margin:12px 0 0;font-size:11px;opacity:.7}
.nd-opt label.close{position:sticky;bottom:-12px;z-index:1;margin:0;padding:6px 0;background:#06161ef2}
.mg-ui .mg-cross{display:none}
.mg-ui{--mg-accent:#19d8ff;font-family:system-ui,-apple-system,"Segoe UI",var(--nd-cjk,"PingFang TC"),sans-serif}
.mg-ui dialog{max-width:min(560px,calc(100vw - 24px))}.mg-ui .mg-body button{white-space:nowrap}
/* sentences wrap at phrases, not inside a word (Japanese: by phrase, Chrome's auto-phrase) and without a lone last word */
.nd-radio span,.ndx-card p,.nt-p,.nt-desc,.mg-msg-p,.mg-obj span,.nd-opt p,.ndx-say,.ndx-prompt,.ndx-hint,.mg-toast{text-wrap:pretty;line-break:strict}
:lang(zh-Hant-TW) .mg-msg-p{word-break:keep-all;overflow-wrap:anywhere}   /* the end card's figures: break at its " · " */
:lang(ja) :is(.nd-radio span,.ndx-card p,.nt-p,.nt-desc,.mg-msg-p,.mg-obj span,.nd-opt p,.ndx-say,.ndx-prompt,.ndx-hint,.mg-toast){word-break:auto-phrase}
.mirage-hud{font-family:ui-monospace,monospace,var(--nd-cjk,"PingFang TC"),sans-serif!important}
`;

import { LANG_NAMES, HTML_LANG, lang } from './text.js';

const HOURS = { night: 23.25, dawn: 6.25, day: 13.5, dusk: 17 };
/** the guns' silhouettes, drawn here (the touch strip uses them too) */
export const ICON = {
  sidearm: '<svg viewBox="0 0 34 18"><path d="M5 5h20l1 3H15l-1 2h-3l-2 6H5l2-6-2-1z"/></svg>',
  carbine: '<svg viewBox="0 0 34 18"><path d="M1 6h7l1-2h12l1 2h11v2H23l-2 2h-4l-1 5h-3l1-5H9L5 12H1z"/></svg>',
  shotgun: '<svg viewBox="0 0 34 18"><path d="M1 6h21l1-1h10v2H22v3h-6l-1-1h-4l-2 5H6l2-5H1z"/><path d="M12 9h8"/></svg>',
  rocket: '<svg viewBox="0 0 34 18"><path d="M2 5h26l3 2-3 2H2zM12 9v6h3V9M20 9v4"/></svg>',
  gatling: '<svg viewBox="0 0 34 18"><path d="M14 4h19M14 7h19M14 10h19M6 3h8v9H6zM2 6h4M8 12a4 4 0 1 0 0 1"/></svg>',
};
const SLOTS = [['sidearm', 1], ['carbine', 2], ['shotgun', 3], ['rocket', 4], ['gatling', 5]];
const hourValue = (h) => (h in HOURS ? HOURS[h] : (() => { const [a, b] = String(h).split(':'); return +a + (+b || 0) / 60; })());
const hourText = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;

export function createHud({ camera, onDispose, T }) {
  const root = document.createElement('div');
  root.className = 'nd';
  root.innerHTML = `<style>${CSS}</style>
    <div class="nd-hurt"></div><div class="nd-dir"></div>
    <div class="nd-x"><i class="h"></i><i class="h"></i><i class="v"></i><i class="v"></i><u></u></div><div class="nd-ring"></div><div class="nd-chev"></div><div class="nd-brk"><i></i><i></i></div><div class="nd-spin"></div><div class="nd-hit"></div>
    <div class="nd-vit" role="status"><span><em class="lbl" style="font-style:normal">${T.vitals}</em> <b class="hp">100</b></span><i><b style="width:100%"></b></i></div>
    <div class="nd-ammo" role="status"><em>${T.gun}</em><b>24</b><span>96</span></div>
    <div class="nd-slots" aria-hidden="true">${SLOTS.map(([id, n]) => `<b data-s="${id}"><small>${n}</small>${ICON[id]}</b>`).join('')}</div>
    <div class="nd-heat" hidden><span></span><i><b style="width:0"></b></i></div>
    <div class="nd-up" hidden><span>${T.uplink}</span><i><b style="width:0"></b></i></div>
    <div class="nd-mark" hidden></div><div class="nd-tally"></div>
    <div class="nd-comp" aria-hidden="true"><div></div></div><div class="nd-feed" aria-live="polite"></div>
    <div class="nd-radio" role="status" aria-live="polite"><b></b><span></span></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const x = [...root.querySelectorAll('.nd-x i')], hitEl = $('.nd-hit'), hurtEl = $('.nd-hurt'), dirEl = $('.nd-dir'), vit = $('.nd-vit'), ammo = $('.nd-ammo'), up = $('.nd-up'), mark = $('.nd-mark');
  let hitT = 0, hurtT = 0, dirT = 0, dirFrom = null, radioT = 0, opt = null, optArgs = null, avoid = null, hurtK = 1, hold = () => false;
  const slotEls = Object.fromEntries([...root.querySelectorAll('.nd-slots b')].map((b) => [b.dataset.s, b])), heatEl = $('.nd-heat');
  /** is a screen point under a touch control (rects: [name, l, t, r, b]); returns the control's rect or null */
  const under = (x, y, pad = 14) => { for (const r of avoid ? avoid() : []) if (x > r[1] - pad && x < r[3] + pad && y > r[2] - pad && y < r[4] + pad) return r; return null; };
  // the compass: a strip of eight headings, three turns long, slid under a fixed window (3 px a degree)
  const strip = $('.nd-comp div'), PX = 3, radioQ = [], feed = $('.nd-feed'), radioEl = $('.nd-radio');
  const heads = [];
  for (let k = -8; k < 16; k++) { const s = document.createElement('span'); s.textContent = T.compass[((k % 8) + 8) % 8]; s.style.left = `${k * 45 * PX}px`; strip.appendChild(s); heads.push([s, ((k % 8) + 8) % 8]); const t = document.createElement('span'); t.className = 't'; t.style.left = `${(k * 45 + 22.5) * PX}px`; strip.appendChild(t); }
  /** the fixed labels, in the current language (again after a switch) */
  function labels() {
    vit.setAttribute('aria-label', T.vitals); ammo.setAttribute('aria-label', T.ammo);
    $('.nd-vit .lbl').textContent = T.vitals; $('.nd-up span').textContent = T.uplink;
    for (const [el, i] of heads) el.textContent = T.compass[i];
    shown.delete($('.nd-ammo em')); shown.delete($('.nd-heat span'));
    localiseCorner();
  }
  /** @miragekit/play's quality / fps corner: its select, its power saver button and its "idle", in the language */
  function localiseCorner() {
    const corner = document.querySelector('.mirage-hud');
    if (!corner) return;
    const sel = corner.querySelector('select'), btn = corner.querySelector('button'), f = corner.querySelector('.f');
    if (sel) {
      sel.title = T.corner.quality;
      for (const o of sel.options) { if (!o.dataset.q) { o.dataset.q = o.value; o.value = o.dataset.q; } o.textContent = T.corner.levels[o.dataset.q] || o.dataset.q; }
    }
    if (btn) btn.textContent = T.corner.saver;
    if (f && !f.dataset.nd) {
      f.dataset.nd = '1';
      // only a change rewrites it: writing the same text from the observer would wake it again, without end
      const fix = () => { if (f.textContent === 'idle' && T.corner.idle !== 'idle') f.textContent = T.corner.idle; };
      new MutationObserver(fix).observe(f, { childList: true, characterData: true, subtree: true }); fix();
    } else if (f && /^\D+$/.test(f.textContent) && f.textContent !== T.corner.idle) f.textContent = T.corner.idle;
  }
  const shown = new WeakMap();
  labels(); setTimeout(localiseCorner, 0);   // the corner is made after the game's setup
  const set = (el, k, v) => { let c = shown.get(el); if (!c) shown.set(el, (c = {})); if (c[k] !== v) { c[k] = v; if (k === 'text') el.textContent = v; else el.style[k] = v; } };
  onDispose(() => { root.remove(); opt?.remove(); });
  /** the options panel's content (again after a language switch; the values live in o.values) */
  function build(o) {
    const v = o.values, num = (k, x) => (k === 'fov' ? String(x) : k === 'tOpacity' ? `${Math.round(x * 100)}%` : (+x).toFixed(2));
    const onOff = (b) => (b ? T.opt.on : T.opt.off);
    const range = (k, min, max, step, label) => `<label><span>${label}</span><span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"><output>${num(k, v[k])}</output></span></label>`;
    const flip = (k, label, on = !!v[k]) => `<label><span>${label}</span><button data-b="${k}" aria-pressed="${on}">${onOff(on)}</button></label>`;
    const focused = document.activeElement && opt.contains(document.activeElement) ? (document.activeElement.dataset.b || document.activeElement.dataset.k) : null;
    const scroll = opt.scrollTop;
    opt.setAttribute('aria-label', T.opt.title);
    opt.innerHTML = `<h2>${T.opt.title}</h2><div class="cols">
      ${range('sens', 0.3, 2.5, 0.05, T.opt.sens)}${range('fov', 50, 90, 1, T.opt.fov)}
      <label><span>${T.opt.time}</span><span><input type="range" data-k="hour" min="0" max="23.75" step="0.25" value="${hourValue(v.hour)}"><output>${hourText(hourValue(v.hour))}</output></span></label>
      ${flip('invert', T.opt.invert)}
      ${flip('full', T.opt.full, v.fullscreen !== false)}
      ${flip('pops', T.opt.pops, v.pops === true)}
      <label><span>${T.opt.lang}</span><button data-b="lang" lang="${HTML_LANG[lang]}">${LANG_NAMES[lang]}</button></label>
      <h3>${T.opt.feel}</h3><label><span>${T.opt.comfort}</span><button data-b="comfort">${T.opt.comfortNames[v.comfort] || T.opt.comfortNames.custom}</button></label>${range('shake', 0, 1.5, 0.05, T.opt.shake)}${range('vibrate', 0, 1, 0.05, T.opt.vibrate)}
      ${flip('hitStop', T.opt.hitStop, v.hitStop !== false)}
      <label><span>${T.opt.code}</span><span><input type="text" inputmode="numeric" autocomplete="off" maxlength="4" data-c="code" placeholder="${T.opt.codeHint}" style="width:90px;min-height:30px;background:#04141c;color:#d8f6ff;border:1px solid #6fe8ff88;font:600 14px ui-monospace,monospace;text-align:center"></span></label>
      ${o.touch ? `<h3>${T.opt.touch}</h3>${range('tSens', 0.3, 2.5, 0.05, T.opt.tSens)}${range('tOpacity', 0.2, 1, 0.05, T.opt.tOpacity)}${range('tScale', 0.8, 1.25, 0.05, T.opt.tScale)}${flip('leftFire', T.opt.leftFire)}${flip('sprintLock', T.opt.sprintLock)}` : ''}
      <label class="close"><span></span><button data-b="close">${T.opt.close}</button></label></div><p>${o.touch ? T.opt.touchHint : T.opt.hint}</p>`;
    opt.scrollTop = scroll;
    const code = opt.querySelector('[data-c=code]');
    code.addEventListener('keydown', (e) => e.stopPropagation());
    code.addEventListener('input', () => { const val = code.value; if (/0/.test(val)) { code.value = ''; o.onChange('code', val); } });
    for (const r of opt.querySelectorAll('input[type=range]')) r.addEventListener('input', () => {
      if (r.dataset.k === 'hour') { r.nextElementSibling.textContent = hourText(+r.value); v.hour = hourText(+r.value); o.onHour(v.hour); return; }
      v[r.dataset.k] = +r.value; r.nextElementSibling.textContent = num(r.dataset.k, +r.value); o.onChange(r.dataset.k, +r.value);
    });
    const show = (b, on) => { b.textContent = onOff(on); b.setAttribute('aria-pressed', String(on)); };
    for (const b of opt.querySelectorAll('button')) {
      b.addEventListener('keydown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        const k = b.dataset.b;
        if (k === 'close') { opt.remove(); opt = null; optArgs = null; o.onClose(); }
        else if (k === 'invert' || k === 'leftFire' || k === 'sprintLock') { v[k] = !v[k]; show(b, v[k]); o.onChange(k, v[k]); }
        else if (k === 'full') { v.fullscreen = v.fullscreen === false; show(b, v.fullscreen); Promise.resolve(o.onFull?.(v.fullscreen)).catch(() => {}); }
        else if (k === 'hitStop') { v[k] = v[k] === false; show(b, v[k]); o.onChange(k, v[k]); }
        else if (k === 'lang') o.onLang();   // the switch rebuilds this panel (relang) with values.lang from the game
        else if (k === 'comfort') { const L = ['comfort', 'standard', 'intense']; v.comfort = L[(L.indexOf(v.comfort) + 1) % 3]; b.textContent = T.opt.comfortNames[v.comfort]; o.onChange('comfort', v.comfort); }
        else if (k === 'pops') { v.pops = v.pops !== true; show(b, v.pops); o.onChange('pops', v.pops); }
      });
    }
    if (focused) opt.querySelector(`[data-b="${focused}"],[data-k="${focused}"]`)?.focus();
  }
  const v3 = { x: 0, y: 0, z: 0 };
  return {
    root,
    /** touch mode: the HUD's pieces move out from under the thumbs (the controls themselves are in touch.js) */
    touch() { root.classList.add('touch'); },
    /** world markers keep off these rectangles (the touch controls): a function returning [name, l, t, r, b][] */
    avoid(fn) { avoid = fn; },
    under,
    hit(kind) { hitEl.className = 'nd-hit ' + kind; hitT = kind === 'kill' ? 0.4 : 0.2; },
    /** a line from control, shown under the crosshair for a few seconds; lines queue */
    radio(text) { radioQ.push(text); },
    /** the radio waits while fn() is true (a story card is up: one thing in the middle of the screen at a time) */
    holdRadio(fn) { hold = fn; },
    /** a radio line is on screen */
    get radioOn() { return radioEl.classList.contains('on'); },
    /** the language changed: the fixed labels, and the options panel if it is open */
    relang() { labels(); if (opt && optArgs) build(optArgs); },
    /** a line in the kill feed (head: a head shot) */
    feed(text, head) { const d = document.createElement('div'); d.textContent = text; if (head) d.className = 'head'; feed.prepend(d); while (feed.children.length > 4) feed.lastChild.remove(); setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 3500); },
    get optionsOpen() { return !!opt; },
    /** the options panel: values { sens, fov, invert, hour, lang, and with touch: tSens, tOpacity, tScale, leftFire,
     *  sprintLock }, touch (show the touch rows), onChange(key, value), onHour(h), onClose(), onLang() */
    options(o) {
      if (opt) { opt.remove(); opt = null; optArgs = null; o?.onClose?.(); return false; }
      if (!o) return false;
      optArgs = o;
      opt = document.createElement('div'); opt.className = 'nd-opt' + (o.touch ? ' wide' : ''); opt.setAttribute('role', 'dialog');
      document.body.appendChild(opt);
      build(o);
      if (!o.touch) opt.querySelector('input').focus();   // on a phone a focused slider would take the first swipe
      return true;
    },
    hurt(from, amount = 10) { hurtK = Math.min(1.6, 0.6 + amount / 12); hurtT = 0.45 + 0.35 * hurtK; dirT = 1.4 + 0.4 * hurtK; dirFrom = from ? from.slice() : null; },
    /** once a display frame */
    update(dt, s) {
      // the crosshair: the gun's own, opened by the spread (px for the spread's angle at the current lens)
      const pxPerRad = innerHeight / 2 / Math.tan((camera.fov * Math.PI / 180) / 2), gap = 4 + s.spread * pxPerRad;
      const cross = s.arm?.cross || 'ticks';
      if (root.dataset.cx !== cross) { root.classList.remove('cx-' + root.dataset.cx); root.dataset.cx = cross; root.classList.add('cx-' + cross); }
      set(x[0], 'left', `${-gap - 9}px`); set(x[1], 'left', `${gap}px`); set(x[2], 'top', `${-gap - 9}px`); set(x[3], 'top', `${gap}px`);
      const ring = $('.nd-ring'), rr = Math.max(8, gap); set(ring, 'width', `${2 * rr}px`); set(ring, 'height', `${2 * rr}px`); set(ring, 'margin', `${-rr}px 0 0 ${-rr}px`);
      const bk = $('.nd-brk').children; set(bk[0], 'left', `${-gap - 12}px`); set(bk[1], 'left', `${gap + 5}px`);
      const hide = s.dead || s.ads > 0.6 ? '0' : '1';
      for (const sel of ['.nd-x', '.nd-ring', '.nd-chev', '.nd-brk']) set($(sel), 'opacity', hide);
      // the gun: its name, the slot strip, the gatling's spin and heat
      if (s.gun) {
        const g = s.gun, id = g.to || g.id;
        set($('.nd-ammo em'), 'text', T.arms.names[id]);
        for (const [k, el] of Object.entries(slotEls)) { const w = g.owned[k], c = `${k === id ? 'cur' : ''}${w.owned ? '' : ' locked'}${w.owned && w.mag + w.reserve <= 0 ? ' empty' : ''}`; if (el.className !== c) el.className = c; }
        heatEl.hidden = id !== 'gatling';
        if (id === 'gatling') { set($('.nd-heat span'), 'text', g.vent ? T.arms.vent : `${T.arms.spin} ${Math.round(g.spin * 100)}% · ${T.arms.heat} ${Math.round(Math.min(1, g.heat) * 100)}%`); set($('.nd-heat i b'), 'width', `${Math.min(100, g.heat * 100).toFixed(0)}%`); heatEl.classList.toggle('vent', !!g.vent); }
        const sp = $('.nd-spin'); set(sp, 'opacity', id === 'gatling' && g.spin > 0.02 && g.spin < 0.99 && hide === '1' ? '0.8' : '0'); sp.style.setProperty('--p', `${(g.spin * 100).toFixed(0)}%`);
      }
      hitT = Math.max(0, hitT - dt); set(hitEl, 'opacity', String(Math.min(1, hitT * 8)));
      hurtT = Math.max(0, hurtT - dt); set(hurtEl, 'opacity', String(Math.max(Math.min(1, hurtT * 2.4 * hurtK), s.hp < 35 ? 0.4 + 0.45 * (1 - s.hp / 35) * (0.75 + 0.25 * Math.sin(performance.now() / 140)) : 0).toFixed(2)));
      dirT = Math.max(0, dirT - dt);
      if (dirT > 0 && dirFrom) {   // the arrow points toward whoever hit you, relative to the view
        const a = Math.atan2(dirFrom[0] - s.pos[0], dirFrom[2] - s.pos[2]), view = Math.atan2(Math.cos(s.yaw), Math.sin(s.yaw));
        set(dirEl, 'transform', `rotate(${(-(a - view) * 180 / Math.PI).toFixed(0)}deg)`);
      }
      set(dirEl, 'opacity', String(Math.min(1, dirT).toFixed(2)));
      set($('.nd-vit i b'), 'width', `${Math.max(0, s.hp).toFixed(0)}%`); set($('.hp'), 'text', String(Math.ceil(Math.max(0, s.hp))));
      vit.classList.toggle('low', s.hp < 35);
      set($('.nd-ammo b'), 'text', s.reloading ? '--' : String(s.mag)); set($('.nd-ammo span'), 'text', s.reserve === Infinity ? '∞' : String(s.reserve));
      ammo.classList.toggle('empty', s.mag === 0 && !s.reloading);
      set($('.nd-tally'), 'text', s.tally);
      // compass: bearing 0 = north (-Z), clockwise
      const brg = Math.atan2(Math.cos(s.yaw), -Math.sin(s.yaw)) * 180 / Math.PI;
      strip.style.transform = `translateX(${(-(((brg % 360) + 360) % 360) * PX).toFixed(1)}px)`;
      // the radio: one line at a time, six seconds or so each
      radioT -= dt;
      if (radioT <= 0 && radioEl.classList.contains('on')) radioEl.classList.remove('on');
      if (radioT <= -0.4 && radioQ.length && !hold()) { const line = radioQ.shift(); radioEl.querySelector('b').textContent = T.control; radioEl.querySelector('span').textContent = line; radioEl.classList.add('on'); radioT = Math.min(9, 2.5 + line.length * (/[\u3040-\u30ff\u4e00-\u9fff]/.test(line) ? 0.13 : 0.055)); }
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
        // on touch, a marker that would sit on a button goes above it, and fades if it still would
        let px = (nx * 0.5 + 0.5) * innerWidth, py = (0.5 - ny * 0.5) * innerHeight, fade = 1;
        const r = under(px, py);
        if (r) { py = r[2] - 26; if (under(px, py)) fade = 0.2; }
        mark.style.left = `${px.toFixed(1)}px`; mark.style.top = `${py.toFixed(1)}px`; set(mark, 'opacity', String(fade));
        set(mark, 'text', `${Math.round(Math.hypot(vx, vy, vz))} ${T.metres}`);
      }
    },
  };
}

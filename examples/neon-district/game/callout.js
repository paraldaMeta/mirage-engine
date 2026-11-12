// The bosses' screen furniture, in CSS (no images, no fonts of our own):
//   call(text, ally)   a move's name in brush lettering that slams in at the telegraph, holds 0.8 s and fades (on the
//                      game's clock: update(dt)); in the
//                      upper third, clear of the crosshair and of the robot's body (it never covers the dodge's read).
//                      Red ink for a foe, cyan for the ally. On by default (not the comic hit words' option).
//   bar(o)             a boss's health under the compass: its name, the bar, the phase marks; null hides it
//   endCard(onGo)      the ending: a black screen, two lines of bold white type that pulse, held until a click or a key
const CSS = `
.ndm{position:fixed;inset:0;pointer-events:none;z-index:7;user-select:none;-webkit-user-select:none}
.ndm-call{position:absolute;left:50%;top:27%;transform:translate(-50%,-50%);white-space:nowrap;opacity:0;text-align:center}
.ndm-call b{position:relative;display:inline-block;padding:.08em .7em .14em;font:900 clamp(34px,5.4vw,84px)/1 "Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif CJK TC","Noto Serif TC","Songti TC","Source Han Serif",serif;
  letter-spacing:.06em;color:#fff7f2;text-shadow:0 0 2px #000,3px 4px 0 #1a0004,0 0 26px #ff2a3a}
.ndm-call b:before{content:"";position:absolute;inset:8% -4% 2% -6%;z-index:-1;transform:skewX(-14deg) rotate(-2deg);
  background:linear-gradient(180deg,transparent 0 6%,#5a0010e8 14%,#b0102ae0 40%,#7a0618e8 78%,transparent 92%);
  clip-path:polygon(0 30%,4% 12%,14% 18%,26% 6%,41% 14%,57% 4%,72% 12%,86% 2%,100% 16%,97% 40%,100% 62%,95% 86%,80% 94%,62% 86%,44% 98%,28% 88%,12% 96%,2% 80%,4% 56%)}
.ndm-call i{display:block;margin-top:.5em;font:700 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.5em;color:#ffd8d8;text-shadow:0 1px 3px #000}
.ndm-call.ally b{text-shadow:0 0 2px #000,3px 4px 0 #001218,0 0 26px #19d8ff}.ndm-call.ally b:before{background:linear-gradient(180deg,transparent 0 6%,#00303ae8 14%,#0a7890e0 40%,#004858e8 78%,transparent 92%)}
.ndm-bar{position:absolute;left:50%;top:max(96px,calc(env(safe-area-inset-top) + 96px));width:min(560px,70vw);transform:translateX(-50%);display:none;text-align:center;font:700 12px/1.2 ui-monospace,Menlo,var(--nd-cjk,"PingFang TC"),monospace;letter-spacing:.3em;color:#ffe2e2;text-shadow:0 1px 3px #000}
.ndm-bar.on{display:block}
.ndm-bar i{position:relative;display:block;height:9px;margin-top:6px;border:1px solid #ff6a7a99;background:#1c0408d0;transform:skewX(-18deg)}
.ndm-bar i b{display:block;height:100%;background:linear-gradient(90deg,#ff2a4a,#ff8a6a);transition:width .15s linear}
.ndm-bar i u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#fff8;text-decoration:none}
.ndm-bar em{display:block;margin-top:4px;font-style:normal;font-size:10px;letter-spacing:.2em;opacity:.8}
.ndm-end{position:fixed;inset:0;z-index:60;display:none;place-items:center;background:#000;pointer-events:auto;cursor:pointer}
.ndm-end.on{display:grid}
.ndm-end p{margin:0;text-align:center;color:#fff;font:900 clamp(40px,8vw,120px)/1.18 "PingFang TC","PingFang SC","Hiragino Sans","Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;animation:ndm-pulse 1.1s ease-in-out infinite}
.ndm-end p span{display:block}.ndm-end p span+span{font-size:.62em;letter-spacing:.04em}
@keyframes ndm-pulse{0%,100%{transform:scale(1) translateY(0)}45%{transform:scale(1.07) translateY(-2%)}60%{transform:scale(.99) translateY(0)}}
`;
// the owner's handle and contact, as given (not translated, not in text.js)
export const END_LINES = ['AI乐子人灰叔', '+vx tamtamjun'];

export function createCallouts() {
  const root = document.createElement('div');
  root.className = 'ndm';
  root.innerHTML = `<style>${CSS}</style><div class="ndm-call"><b></b><i></i></div><div class="ndm-bar"><span></span><i><b></b></i><em></em></div>`;
  document.body.appendChild(root);
  const call = root.querySelector('.ndm-call'), bar = root.querySelector('.ndm-bar');
  const end = document.createElement('div');
  end.className = 'ndm-end'; end.innerHTML = `<p>${END_LINES.map((l) => `<span>${l}</span>`).join('')}</p>`;
  document.body.appendChild(end);
  let barKey = '', last = '', callT = -1;
  const api = {
    shown: '', count: 0, endOn: false,
    /** a move's name (sub: a small line under it, e.g. the speaker) */
    call(text, ally = false, sub = '') {
      call.querySelector('b').textContent = text; call.querySelector('i').textContent = sub;
      call.classList.toggle('ally', ally); callT = 0;
      api.shown = text; api.count++; last = text;
    },
    /** { name, frac, marks: [fractions], note } or null */
    bar(o) {
      if (!o) { if (barKey) { bar.classList.remove('on'); barKey = ''; } return; }
      const key = o.name + '|' + o.note + '|' + o.marks.join();
      if (key !== barKey) { barKey = key; bar.classList.add('on'); bar.querySelector('span').textContent = o.name; bar.querySelector('em').textContent = o.note || ''; bar.querySelectorAll('u').forEach((u) => u.remove()); for (const f of o.marks) { const u = document.createElement('u'); u.style.left = (f * 100) + '%'; bar.querySelector('i').appendChild(u); } }
      bar.querySelector('i b').style.width = (Math.max(0, Math.min(1, o.frac)) * 100).toFixed(1) + '%';
    },
    /** the ending's black card; onGo once it is clicked or a key is pressed (after a moment, so a held key does not skip it) */
    endCard(onGo) {
      if (api.endOn) return;
      api.endOn = true; end.classList.add('on');
      const t0 = performance.now();
      const go = (ev) => { if (performance.now() - t0 < 1200) return; ev.preventDefault?.(); removeEventListener('keydown', go, true); end.removeEventListener('pointerdown', go); end.classList.remove('on'); api.endOn = false; onGo(); };
      addEventListener('keydown', go, true); end.addEventListener('pointerdown', go);
    },
    get last() { return last; },
    /** the slam (0.13 s), the hold (0.8 s), the fade (0.25 s), on the game's clock (a pause holds it) */
    update(dt) {
      if (callT < 0) return;
      callT += dt;
      const t = callT, s = t < 0.13 ? 1.9 - 0.95 * (t / 0.13) : t < 0.2 ? 0.95 + 0.05 * ((t - 0.13) / 0.07) : 1, o = t < 0.13 ? t / 0.13 : t < 0.93 ? 1 : Math.max(0, 1 - (t - 0.93) / 0.25);
      call.style.opacity = o.toFixed(3); call.style.filter = t < 0.13 ? `blur(${(8 * (1 - t / 0.13)).toFixed(1)}px)` : '';
      call.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)}) rotate(${t < 0.13 ? (-3 * (1 - t / 0.13)).toFixed(2) : 0}deg)`;
      if (t > 1.2) { callT = -1; api.shown = ''; }
    },
    dispose() { root.remove(); end.remove(); },
  };
  return api;
}

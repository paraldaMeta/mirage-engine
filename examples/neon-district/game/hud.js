// The shooter's own HUD over @miragekit/game's overlay (which keeps the objective, prompts, toasts and menus):
// health and ammunition, a crosshair that opens with the spread, hit and kill markers, the direction a hit came
// from, a red edge when hurt, the uplink's progress, a marker on the next objective, and on touch screens the
// Fire / Aim / Reload buttons beside the overlay's own stick and Jump / Use.
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
.mg-touch .nd-btn{position:absolute;pointer-events:auto;width:74px;height:74px;min-height:0;padding:0;border-radius:50%;border:1px solid #6fe8ffaa;background:#04141c99;color:#d8f6ff;font:600 12px ui-monospace,monospace;letter-spacing:.08em;touch-action:none}
.mg-touch .nd-btn.on{background:#19d8ff66}
/* left of the overlay's own Bag / Use / Jump cluster */
.mg-touch .nd-fire{right:calc(max(16px,env(safe-area-inset-right)) + 180px);bottom:max(24px,env(safe-area-inset-bottom));width:92px;height:92px}
.mg-touch .nd-aim{right:calc(max(16px,env(safe-area-inset-right)) + 189px);bottom:calc(max(24px,env(safe-area-inset-bottom)) + 104px)}
.mg-touch .nd-rel{right:calc(max(16px,env(safe-area-inset-right)) + 284px);bottom:calc(max(24px,env(safe-area-inset-bottom)) + 6px);width:60px;height:60px}
.nd.touch .nd-ammo{right:auto;left:50%;bottom:auto;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);text-align:center}
.nd.touch .nd-ammo b{font-size:26px}.nd.touch .nd-ammo em,.nd.touch .nd-tally{display:none}
.nd.touch .nd-up{top:max(50px,calc(env(safe-area-inset-top) + 50px))}
.mg-ui .mg-cross{display:none}
.mg-ui{--mg-accent:#19d8ff}
`;

export function createHud({ camera, onDispose }) {
  const root = document.createElement('div');
  root.className = 'nd';
  root.innerHTML = `<style>${CSS}</style>
    <div class="nd-hurt"></div><div class="nd-dir"></div>
    <div class="nd-x"><i class="h"></i><i class="h"></i><i class="v"></i><i class="v"></i><u></u></div><div class="nd-hit"></div>
    <div class="nd-vit" role="status" aria-label="Health"><span>VITALS <b class="hp">100</b></span><i><b style="width:100%"></b></i></div>
    <div class="nd-ammo" role="status" aria-label="Ammunition"><em>K-7 CARBINE</em><b>24</b><span>96</span></div>
    <div class="nd-up" hidden><span>UPLINK</span><i><b style="width:0"></b></i></div>
    <div class="nd-mark" hidden></div><div class="nd-tally"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const x = [...root.querySelectorAll('.nd-x i')], hitEl = $('.nd-hit'), hurtEl = $('.nd-hurt'), dirEl = $('.nd-dir'), vit = $('.nd-vit'), ammo = $('.nd-ammo'), up = $('.nd-up'), mark = $('.nd-mark');
  let hitT = 0, hurtT = 0, dirT = 0, dirFrom = null, touch = null;
  const shown = new WeakMap();
  const set = (el, k, v) => { let c = shown.get(el); if (!c) shown.set(el, (c = {})); if (c[k] !== v) { c[k] = v; if (k === 'text') el.textContent = v; else el.style[k] = v; } };
  onDispose(() => { root.remove(); touch?.remove(); });
  const v3 = { x: 0, y: 0, z: 0 };
  return {
    root,
    /** touch buttons, added once a finger is seen: hold Fire, toggle Aim, tap Reload */
    touch(on, handlers) {
      if (!on || touch) return;
      touch = document.createElement('div'); root.classList.add('touch');
      touch.innerHTML = '<button class="nd-btn nd-fire">FIRE</button><button class="nd-btn nd-aim">AIM</button><button class="nd-btn nd-rel">RLD</button>';
      // inside the overlay's own touch layer, over its look area (which would otherwise take the finger first)
      (document.querySelector('.mg-touch') || root).appendChild(touch);
      const [fire, aim, rel] = touch.children;
      const hold = (el, fn) => { el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); fn(true); }); for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { el.classList.remove('on'); fn(false); }); };
      hold(fire, handlers.fire);
      aim.addEventListener('pointerdown', (e) => { e.preventDefault(); aim.classList.toggle('on', handlers.aim()); });
      rel.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.reload(); });
    },
    hit(kind) { hitEl.className = 'nd-hit ' + kind; hitT = kind === 'kill' ? 0.4 : 0.2; },
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
        set(mark, 'text', `${Math.round(Math.hypot(vx, vy, vz))} M`);
      }
    },
  };
}

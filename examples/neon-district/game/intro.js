// The map's introduction: after DEPLOY and before the player takes control, a camera tours the district in shots and
// ends by dollying down into the spawn view, where play takes over with no cut.
//
// The camera language is the "perspective illusion" (a long-lens elevation that opens into depth); written here from
// its description, no code taken:
//   a level camera     never pitched or rolled; the verticals stay vertical, as in an elevation drawing
//   the flat frame     a lens of a few degrees from hundreds of metres: the depth of a street reads as one plane
//   the dolly zoom     the lens widens while the camera comes in, the framed width W at the focus held: the subject
//                      keeps its size and the depth opens behind it
//   corner shots       the heading swung round the focus, flat first, then opened
//   elevation          the camera raised and the lens shifted (projectionMatrix.elements[9]) to keep the focus framed,
//                      never tilted
//   the swap           while the frame is flat, a few robots of the street move in depth (a row across the street
//                      becomes a diagonal down it); the next opening shows it
//   timing             every value on a monotone cubic (Fritsch-Carlson) through its keys; W and the lens in log space;
//                      holds drift a little (W x 0.97) so they breathe
// A far camera needs its own frame: the near plane is pushed out to a plane in front of the focus (`clip` metres before
// it: whatever stands between the camera and the district is not drawn, and the depth buffer keeps its precision on
// the far facades, so surfaces centimetres apart do not flicker), the fog is thinned by the distance (the haze of the
// visible depth only), the sun's shadow is fitted round the focus (play.director's shadow, the cascades' range when
// they are on) and the far plane is pushed past the sky dome. All of it is per shot and given back at the end.
// Skipping: any key, click, tap or pad button. It plays by itself once (localStorage 'nd-intro-seen'); the title has
// a REPLAY INTRO entry (I, the pad's View / Y). ?intro=1 plays it on every DEPLOY, ?intro=0 never.
import * as THREE from 'three';
import { FOG } from '@miragekit/core';

const SEEN = 'nd-intro-seen', D2R = Math.PI / 180, NEAR = 0.08, FADE = 0.32;
let seenHere = false;   // storage blocked: once a page
export function introSeen() { try { return seenHere || localStorage.getItem(SEEN) === '1'; } catch { return seenHere; } }
function markSeen() { seenHere = true; try { localStorage.setItem(SEEN, '1'); } catch { /* storage blocked: once a page */ } }

/** monotone cubic through (ts, ys), Fritsch-Carlson; flat at both ends (every shot starts and ends at rest) */
function monotone(ts, ys) {
  const n = ts.length;
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= ts[0]) return ys[0];
    if (t >= ts[n - 1]) return ys[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// A shot: its area (the caption), keys [time, values] (values carry over from the key before), and optionally a swap
// time (the robots' layout changes there: the frame must be flat then). Values:
//   F [x, y, z] the focus   h heading (deg; 0 looks east, 90 south)   W metres framed across at the focus
//   fov the horizontal lens (deg)   el elevation (deg: the camera raised, the lens shifted)   fy where the focus sits
//   on screen (NDC, 0 the centre)   clip metres in front of the focus where the near plane stands
const LOG = new Set(['W', 'fov']);
const KEYS = ['F0', 'F1', 'F2', 'h', 'W', 'fov', 'el', 'fy', 'clip'];
function shot(area, keys, extra = {}) {
  let cur = { F: [0, 0, 0], h: 0, W: 30, fov: 3, el: 0, fy: 0, clip: 1e4 };
  const full = keys.map(([t, v]) => { cur = { ...cur, ...v }; return [t, cur]; });
  const ts = full.map((k) => k[0]), fn = {};
  for (const k of KEYS) {
    const ys = full.map(([, v]) => (k[0] === 'F' && k.length === 2 ? v.F[+k[1]] : v[k]));
    const f = monotone(ts, LOG.has(k) ? ys.map(Math.log) : ys);
    fn[k] = LOG.has(k) ? (t) => Math.exp(f(t)) : f;
  }
  return { area, len: ts[ts.length - 1], at: (t) => ({ F: [fn.F0(t), fn.F1(t), fn.F2(t)], h: fn.h(t), W: fn.W(t), fov: fn.fov(t), el: fn.el(t), fy: fn.fy(t), clip: fn.clip(t) }), ...extra };
}
/** a hold: the key before, drifting in (W x 0.97) */
const drift = (v, k = 0.97) => ({ ...v, W: v.W * k });

/** the tour, then the last shot into `end` ({ eye, yaw (rad), vfov (deg), aspect, behind: metres behind the eye the
 *  near plane may stand (a fence, a wall), lift: deg of elevation at the start }) */
export function tour(end) {
  const S = [];
  // 1  Kestrel Street from its open west end: flat, opened (the robots stand in a row across the street), flat again
  //    (they move into a diagonal), opened again
  //    (clip 27: a sign's back stands at x -34, the plane 30 m before the focus cut through it, a black panel)
  const st = { F: [-4, 6.5, 6], h: 0, W: 30, fov: 2.6, el: 1.5, fy: -0.05, clip: 27 };
  S.push(shot('street', [[0, st], [1.6, drift(st)], [4.2, { W: 26.5, fov: 48, el: 0.5, F: [-4, 4.5, 6], clip: 27 }], [5.2, { W: 25.5 }],
    [7.0, { W: 26, fov: 2.6, el: 1.5, F: [-4, 6.5, 6] }], [7.7, { W: 25.5 }], [10.2, { W: 24, fov: 54, el: 4, F: [-6, 4.5, 6], h: 8 }], [11.0, { W: 23.4 }]], { swap: [0, 7.35] }));
  // 2  the walls: the north side's signs head on (the couplet, MIRAGE), a long lens from across the street, then open
  const sg = { F: [-2.4, 7, 2], h: -90, W: 15, fov: 2.2, el: 0, fy: 0, clip: 7.6 };
  S.push(shot('signs', [[0, sg], [2.2, drift(sg, 0.96)], [4.6, { W: 14, fov: 58, F: [-2.4, 6.2, 2], clip: 7.6 }], [5.4, { W: 13.6 }]]));
  // 3  the night market under the plaza's west wall, from across the plaza: flat, then a corner opened
  const nm = { F: [6.2, 6.5, -6.5], h: 180, W: 20, fov: 2.4, el: 3, fy: 0, clip: 22 };
  S.push(shot('market', [[0, nm], [2.0, drift(nm)], [4.6, { h: 205, W: 18.5, fov: 40, el: 6, F: [7.5, 4.2, -6], clip: 16 }], [5.4, { W: 18 }]]));
  // 4  the plaza: a high corner, flat, then wide
  const pz = { F: [18, 2, -9], h: -130, W: 34, fov: 3, el: 32, fy: 0, clip: 26 };
  S.push(shot('plaza', [[0, pz], [1.8, drift(pz)], [4.6, { W: 31, fov: 44, el: 28, h: -118 }], [5.4, { W: 30 }]]));
  // 5  the relay: a section through its south wall (the room, the stair, the roof over it), then into the room
  const rl = { F: [17, 4.2, -25], h: -90, W: 26, fov: 2.4, el: 0, fy: 0, clip: 4.4 };
  S.push(shot('relay', [[0, rl], [2.0, drift(rl)], [4.8, { W: 15, fov: 70, F: [14.5, 1.9, -25], clip: 4.3 }], [5.6, { W: 14.6 }]]));
  // 6  the roof, where the uplink is held: a high corner over the relay, flat then wide
  const rf = { F: [15, 6.8, -25], h: -150, W: 24, fov: 3, el: 24, fy: 0, clip: 18 };
  S.push(shot('roof', [[0, rf], [1.8, drift(rf)], [4.6, { W: 22, fov: 46, el: 20, h: -138 }], [5.4, { W: 21.4 }]]));
  // 7  the rooftops and the city above: a raised elevation of the roofline, flat then opened toward the towers
  const rt = { F: [2, 24, -12], h: -90, W: 70, fov: 3.2, el: 8, fy: -0.1, clip: 46 };
  S.push(shot('rooftops', [[0, rt], [1.8, drift(rt)], [4.6, { W: 64, fov: 50, el: 10, h: -80 }], [5.4, { W: 62 }]]));
  // 8  the water channel in the south gutter: a long low look down it, then a worm's-eye opening
  const wc = { F: [8, 0.7, 8.1], h: 180, W: 9, fov: 3, el: 2, fy: -0.25, clip: 11 };
  S.push(shot('channel', [[0, wc], [1.8, drift(wc)], [4.4, { W: 8, fov: 78, el: 1, F: [6, 0.55, 8.2], fy: -0.35, clip: 11 }], [5.2, { W: 7.8 }]]));
  // 9  the alley: down into the spawn view (the last key IS the walking camera)
  const th = Math.tan(end.vfov * D2R / 2) * end.aspect, hf = 2 * Math.atan(th) / D2R, D = 12, W = 2 * D * th;
  const dx = Math.cos(end.yaw), dz = Math.sin(end.yaw), F = [end.eye[0] + dx * D, end.eye[1], end.eye[2] + dz * D], h = end.yaw / D2R, clip = D + end.behind;
  S.push(shot('alley', [[0, { F, h, W, fov: 3.4, el: end.lift, fy: 0.05, clip }], [1.6, { W: W * 0.97 }], [4.2, { fov: 18, el: end.lift * 0.62, W: W * 0.985 }], [6.6, { fov: hf, el: 0, fy: 0, W }]], { final: true }));
  return S;
}

const CSS = `
.ni{position:fixed;inset:0;z-index:28;pointer-events:none;color:#d8f6ff;font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,var(--nd-cjk,"PingFang TC"),monospace;user-select:none;-webkit-user-select:none}
.ni[hidden]{display:none}
.ni-fade{position:absolute;inset:0;background:#000;opacity:0}
.ni-bar{position:absolute;left:0;right:0;height:9vh;background:#000}.ni-bar.t{top:0}.ni-bar.b{bottom:0}
.ni-cap{position:absolute;left:max(28px,env(safe-area-inset-left));bottom:calc(9vh + 26px);max-width:min(560px,calc(100vw - 56px));transition:opacity .4s,transform .4s}
.ni-cap.out{opacity:0;transform:translateY(6px)}
.ni-k{margin:0 0 6px;font-size:10px;letter-spacing:.28em;color:#7af0ffb0;text-shadow:0 1px 3px #000}
.ni-k i{display:inline-block;width:6px;height:6px;margin-right:9px;border-radius:50%;background:#ff3fd2;box-shadow:0 0 8px #ff3fd2;vertical-align:1px}
.ni-h{margin:0;font:800 26px/1.05 ui-monospace,SFMono-Regular,Menlo,var(--nd-cjk,"PingFang TC"),monospace;letter-spacing:.16em;color:#f4feff;text-shadow:0 2px 10px #000c,0 0 22px #19d8ff40}
.ni-l{margin:9px 0 0;padding-left:11px;border-left:2px solid #ff3fd2;font:400 14px/1.45 system-ui,-apple-system,var(--nd-cjk,"PingFang TC"),sans-serif;color:#d8f6ffe0;text-shadow:0 1px 4px #000}
.ni-skip{position:absolute;right:max(28px,env(safe-area-inset-right));bottom:calc(9vh + 26px);text-align:right;font-size:10px;letter-spacing:.24em;color:#d8f6ffb0;text-shadow:0 1px 3px #000}
.ni-skip b{display:inline-block;margin-left:10px;padding:3px 8px;border:1px solid #19d8ff70;color:#f4feff;letter-spacing:.3em;font-weight:700}
.ni-prog{position:absolute;left:0;bottom:9vh;height:2px;width:100%;background:#19d8ff18}.ni-prog i{display:block;height:100%;width:0;background:#19d8ff}
@media (max-height:520px){.ni-bar{height:6vh}.ni-cap,.ni-skip{bottom:calc(6vh + 12px)}.ni-prog{bottom:6vh}.ni-h{font-size:19px}.ni-l{font-size:12px;margin-top:5px}}
body.nd-intro .mg-ui>:not(dialog):not(style),body.nd-intro .mirage-hud{display:none!important}
body.nd-intro .nd>:not(style){display:none!important}
body.nd-intro .ndx>:not(style){display:none!important}
`;

/**
 * @param o.T the language's table (T.intro)   o.world, o.game   o.enemies (the swap's robots)   o.onDispose
 * @returns { play(g, end, onDone), skip(), playing, seek(t), hold, shots, length }
 */
export function createIntro({ T, world, game, enemies, onDispose, onFrame }) {
  const root = document.createElement('div');
  root.className = 'ni'; root.hidden = true;
  root.innerHTML = `<style>${CSS}</style><div class="ni-bar t"></div><div class="ni-bar b"></div><div class="ni-fade"></div>
    <div class="ni-cap out"><p class="ni-k"><i></i><span></span></p><h2 class="ni-h"></h2><p class="ni-l"></p></div>
    <div class="ni-skip"><span></span><b></b></div><div class="ni-prog"><i></i></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s), cap = $('.ni-cap'), fade = $('.ni-fade'), bars = [...root.querySelectorAll('.ni-bar')], prog = $('.ni-prog i');
  let on = false, rings = [], endYaw = 0, g = null, shots = [], starts = [], total = 0, t = 0, cur = -1, done = null, endCam = null, origCsm = null, swapState = -1, lastArea = '', fogK = 1, keyAt = 0;
  const hold = { on: false };
  const saved = [];

  // ---- the swap: up to four of the street's sentinels, a row across the street, then a diagonal down it
  const ROW = [[-5, 3.9], [-5, 5.3], [-5, 6.7], [-5, 8.1]], DIAG = [[-14, 3.9], [-8, 5.3], [-2, 6.7], [4, 8.1]];
  const swapBots = () => (enemies?.byZone?.street || []).filter((e) => e.rig && e.K && e.K.type !== 'hound').slice(0, 4);
  function lay(which) {
    if (which === swapState) return;
    swapState = which;
    const P = which ? DIAG : ROW;
    swapBots().forEach((e, i) => { const r = e.rig.root; r.position.set(P[i][0], 0, P[i][1]); r.rotation.y = -Math.PI / 2; r.visible = true; r.updateMatrixWorld(true); });
  }

  // ---- the camera at time t: pose, lens, lens shift, near / far; returns the shot's frame data
  const _f = new THREE.Vector3();
  function frameAt(time, cam) {
    let i = 0;
    while (i < shots.length - 1 && time >= starts[i + 1]) i++;
    const s = shots[i], lt = Math.min(s.len, Math.max(0, time - starts[i])), p = s.at(lt);
    const aspect = world.pipeline.w / world.pipeline.h;
    const th = Math.tan(p.fov * D2R / 2), vt = th / aspect, D = p.W / (2 * th), h = p.h * D2R, dx = Math.cos(h), dz = Math.sin(h), te = Math.tan(p.el * D2R);
    cam.position.set(p.F[0] - dx * D, p.F[1] + D * te, p.F[2] - dz * D);
    cam.up.set(0, 1, 0);
    cam.lookAt(_f.set(cam.position.x + dx, cam.position.y, cam.position.z + dz));
    let near = Math.min(900, Math.max(NEAR, D - p.clip));
    if (s.final && endCam && lt >= s.len) { cam.position.copy(endCam.pos); near = NEAR; }   // the last frame: the walking camera exactly
    cam.fov = 2 * Math.atan(vt) / D2R; cam.aspect = aspect; cam.near = near; cam.far = Math.max(3000, D + 1600);
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[9] = -(te / vt + p.fy);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return { i, s, lt, p, D, near };
  }

  // ---- the frame, from play.director: the time, the camera, the shot's fog / shadow / cascades, the captions
  function director(cam, dt) {
    if (!on) return null;
    if (!hold.on) t += Math.min(dt, 0.05);
    const f = frameAt(t, cam);
    g.play.turn(0, 0, 0);   // the scene clock runs (rain, screens, steam)
    onFrame?.(dt);
    // the rings of far towers (arcology.js, megastructure.js: 120 to 480 m out) stand between a far camera and the
    // district: they step aside while the camera is out among them
    const out = f.D > 100;
    for (const r of rings) r.visible = out ? false : r.userData.ndIntroVis;
    // the swap
    if (f.s.swap) lay(f.lt >= f.s.swap[1] ? 1 : 0);
    // the fog: the haze of the depth that is drawn, not of the air between a far camera and the district
    fogK = Math.min(1, 55 / f.D);
    // the cascades (high): their range round the focus while the camera is far
    const csm = world.lighting?.csm;
    if (csm && origCsm) { csm.cfg.near = Math.max(origCsm.near, f.near); csm.cfg.distance = Math.max(origCsm.distance, f.D + 90); }
    // captions, fades, the letterbox (out over the last shot's last 1.6 s), the progress
    if (f.i !== cur) { cur = f.i; caption(f.s.area, f.i); }
    const fo = f.s.final ? 1 : Math.max(0, Math.min(1, (f.s.len - f.lt) / FADE));
    const inn = f.i === 0 ? Math.min(1, f.lt / 0.6) : Math.min(1, f.lt / FADE);
    fade.style.opacity = (1 - Math.min(fo, inn)).toFixed(3);
    const lb = f.s.final ? Math.max(0, Math.min(1, (f.s.len - f.lt) / 1.6)) : 1;
    bars.forEach((b) => { b.style.transform = `scaleY(${lb.toFixed(3)})`; b.style.transformOrigin = b.classList.contains('t') ? 'top' : 'bottom'; });
    if (f.s.final && f.lt > f.s.len - 1.8) cap.classList.add('out');
    prog.style.width = `${(100 * Math.min(1, t / total)).toFixed(2)}%`;
    if (t >= total && !hold.on) setTimeout(finish, 0);
    // the shadow round the focus while far; the walking view's own fit as the camera comes in (the same at the end)
    const u = Math.max(0, Math.min(1, (f.D - 15) / 40));
    const yaw = f.p.h * D2R, wc = [cam.position.x + Math.cos(yaw) * 34 * 0.45, endCam ? endCam.feetY : 0, cam.position.z + Math.sin(yaw) * 34 * 0.45];
    const fc = [f.p.F[0], f.p.F[1] * 0.5, f.p.F[2]];
    return { shadow: { center: [wc[0] + (fc[0] - wc[0]) * u, wc[1] + (fc[1] - wc[1]) * u, wc[2] + (fc[2] - wc[2]) * u], radius: 34 + (Math.min(60, Math.max(24, f.p.W * 0.9)) - 34) * u } };
  }
  // the fog factor, after the world and main.js wrote the hour's fog (ctx.onUpdate runs after writeFog)
  world.ctx.onUpdate(() => { if (on && fogK < 1) { FOG.params[0] *= fogK; FOG.params[2] *= fogK; } });

  function caption(area, i) {
    const I = T.intro, a = I.areas[area];
    if (!a || area === lastArea) return;
    lastArea = area;
    cap.classList.add('out');
    setTimeout(() => {
      if (!on) return;
      $('.ni-k span').textContent = `${I.kicker} · ${String(i + 1).padStart(2, '0')}/${String(shots.length).padStart(2, '0')}`;
      $('.ni-h').textContent = a[0]; $('.ni-l').textContent = a[1];
      cap.classList.remove('out');
    }, i === 0 ? 350 : 260);
  }

  // ---- skipping: any key, click, tap or pad button (the first 300 ms after DEPLOY are ignored: its own key / click)
  const skipKey = (e) => {
    if (!on) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!e.repeat && performance.now() - keyAt > 300) skip();
  };
  const skipPtr = (e) => {
    if (!on) return;
    e.stopPropagation(); if (e.cancelable) e.preventDefault();
    if (performance.now() - keyAt > 300) skip();
  };
  window.addEventListener('keydown', skipKey, true);
  for (const ev of ['pointerdown', 'mousedown']) window.addEventListener(ev, skipPtr, true);
  onDispose(() => { window.removeEventListener('keydown', skipKey, true); for (const ev of ['pointerdown', 'mousedown']) window.removeEventListener(ev, skipPtr, true); root.remove(); });
  let origUpdate = null;
  const padUpdate = () => {
    const I = g.input;
    if (performance.now() - keyAt > 300 && [0, 1, 2, 3, 8, 9].some((b) => I.padPressed(b))) skip();
  };

  /** start: g the game session, end { eye, look, behind, lift, vfov: () => deg }, onDone () when control is handed over */
  function play(g_, end, onDone) {
    if (on) return;
    g = g_; on = true; done = onDone; t = 0; cur = -1; lastArea = ''; swapState = -1; keyAt = performance.now();
    markSeen();
    const play = g.play;
    play.place(end.eye, end.look, 'walk');
    play.pitch = 0;   // the tour's camera is level, and so is the view it hands over
    // where play's walking camera stands now: the tour ends exactly there
    play.step(0);
    endCam = { pos: world.camera.position.clone(), feetY: end.eye[1] - 1.62 }; endYaw = play.yaw;
    const aspect = world.pipeline.w / world.pipeline.h;
    shots = tour({ eye: endCam.pos.toArray(), yaw: play.yaw, vfov: end.vfov(), aspect, behind: end.behind ?? 9, lift: end.lift ?? 26 });
    starts = []; total = 0;
    for (const s of shots) { starts.push(total); total += s.len; }
    // the robots of the swap: kept, to be given back
    saved.length = 0;
    for (const e of swapBots()) { const r = e.rig.root; saved.push({ r, p: r.position.clone(), y: r.rotation.y, v: r.visible }); }
    rings = ['far-skyline', 'megastructure-far'].map((n) => world.scene.getObjectByName(n)).filter(Boolean);
    for (const r of rings) r.userData.ndIntroVis = r.visible;
    const csm = world.lighting?.csm;
    origCsm = csm ? { near: csm.cfg.near, distance: csm.cfg.distance } : null;
    $('.ni-skip span').textContent = T.intro.skipHint; $('.ni-skip b').textContent = T.intro.skip;
    root.hidden = false; cap.classList.add('out'); fade.style.opacity = '1';
    document.body.classList.add('nd-intro');
    origUpdate = g.ui.update; g.ui.update = padUpdate;   // the overlay would start the game on the pad's A
    play.director = director;
    game.set('intro', (game.flags.intro || 0) + 1);
  }
  function finish() {
    if (!on) return;
    on = false;
    const play = g.play;
    play.director = null;
    if (origUpdate) { g.ui.update = origUpdate; origUpdate = null; }
    for (const s of saved) { s.r.position.copy(s.p); s.r.rotation.y = s.y; s.r.visible = s.v; s.r.updateMatrixWorld(true); }
    saved.length = 0;
    for (const r of rings) r.visible = r.userData.ndIntroVis;
    const csm = world.lighting?.csm;
    if (csm && origCsm) { csm.cfg.near = origCsm.near; csm.cfg.distance = origCsm.distance; }
    fogK = 1;
    root.hidden = true; document.body.classList.remove('nd-intro');
    play.yaw = endYaw; play.pitch = 0;   // a mouse or a stick moved during the tour turned play's own view
    const cb = done; done = null; cb?.();
  }
  /** skip to the handover: the walking view at once */
  function skip() { if (on) finish(); }
  /** stills and checks: the camera at time s (hold.on keeps it there) */
  function seek(s) { t = Math.max(0, Math.min(total, s)); }
  return { play, skip, seek, hold, get playing() { return on; }, get time() { return t; }, get length() { return total; }, get shots() { return shots.map((s, i) => ({ area: s.area, start: starts[i], len: s.len, swap: s.swap ? starts[i] + s.swap[1] : null })); } };
}

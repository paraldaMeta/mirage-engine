// Mirage code. Modes, keys and the game camera adapted from the author's own earlier walk.js; the loop uses the
// core's renderFrame (temporal AA while moving, the still sub-frame path once the view holds still).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { QUALITY_KEY, QUALITY_LEVELS } from '@mirage/core';
import { bakeWalkGrid } from './walkgrid.js';
import { createWalker } from './walker.js';

// ---------------------------------------------------------------------------
// createPlay(world, { plan, canvas, mode, fit }): walk / fly / game / orbit over a built world.
//
//   walk   WASD or arrows, mouse looks (click to capture the pointer, or drag), Shift runs, Space jumps
//   fly    F toggles (WASD, Space / E up, C / Q down, Shift fast)
//   game   G toggles: an orthographic isometric view following a figure (WASD relative to the screen, wheel zooms)
//   orbit  O toggles: three's OrbitControls around a point (the stills view)
//   1-9    the plan's viewpoints, R back to the spawn, H hides the help
// Collision and ground come from the walk grid baked from the geometry (walkgrid.js). Every moving frame is one
// jittered sub-frame resolved by the core's temporal AA; when the view stops, the core's still path renders
// `refine[0]` sub-frames, later `refine[1]`, then nothing until something moves (the canvas keeps the image).
// ponytail: the animation clock stays at 0 unless `animate` (still frames stay bit-identical, as in M1b); the game
// view has no occluder x-ray and the figure only bobs; mouse look has no smoothing.
// ---------------------------------------------------------------------------

const GAME_DIR = new THREE.Vector3(1, 1.15, 1).normalize(), GAME_DIST = 40;
const FLY = 8, FLY_FAST = 28;

export function createPlay(world, opts = {}) {
  const { plan, canvas = world.renderer.domElement, spp = 6, refine = [spp, 16], animate = false } = opts;
  const { camera, scene, renderer } = world;
  const grid = opts.grid || bakeWalkGrid(world, { bounds: plan.bounds, ...plan.walk });
  const spawn = plan.spawn || plan.viewpoints[0] || { eye: [0, 1.7, 0], look: [0, 1.7, -1] };
  // opts.walker: anything with the walker's shape ({ pos, onGround, blocked, body, update(dt, input), place(p) }),
  // e.g. @mirage/game's physics character; the grid stays for ground queries (fly, viewpoints, agents)
  const walker = opts.walker || createWalker(grid, { pos: [spawn.eye[0], spawn.eye[1] - 1.62, spawn.eye[2]] });
  const B = walker.body;
  let mode = opts.mode || spawn.mode || 'walk';
  let yaw = 0, pitch = 0, eyeY = walker.pos[1] + B.eye, viewSize = opts.viewSize || 9, fov = opts.fov || 62;
  const flyPos = new THREE.Vector3(), flyVel = new THREE.Vector3(), gameTarget = new THREE.Vector3();
  const gameCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const orbitLens = { fov: camera.fov, near: camera.near, far: camera.far };   // the stills view keeps the world's lens
  const figure = makeFigure(world);
  figure.visible = false;
  scene.add(figure);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.enabled = false;
  let orbiting = false;
  controls.addEventListener('start', () => { orbiting = true; });
  controls.addEventListener('end', () => { orbiting = false; });

  // ---- placing
  function look(from, to) {
    const d = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
    yaw = Math.atan2(d.z, d.x); pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }
  /** put the viewer at `eye` looking at `look`; mode: 'walk' | 'fly' | 'game' | 'orbit' (default: keep) */
  function place(eye, lookAt, m = mode) {
    mode = m;
    look(eye, lookAt);
    walker.place([eye[0], eye[1] - B.eye + 0.3, eye[2]]);
    eyeY = walker.pos[1] + B.eye;
    flyPos.set(...eye); flyVel.set(0, 0, 0);
    gameTarget.set(walker.pos[0], walker.pos[1] + 0.9, walker.pos[2]);
    if (mode === 'orbit') { camera.position.set(...eye); controls.target.set(...lookAt); controls.update(); }
    setMode(mode);
  }
  function viewpoint(i) {
    const v = plan.viewpoints[i];
    if (!v) return;
    const above = v.eye[1] - (grid.groundAt(v.eye[0], v.eye[2], v.eye[1]) || 0);
    place(v.eye, v.look, v.mode || (mode === 'game' || mode === 'orbit' ? mode : above > 3 ? 'fly' : 'walk'));
  }
  function setMode(m) {
    if (mode === 'orbit' && m !== 'orbit') {   // leave the orbit where its camera is, looking where it looks
      const d = camera.getWorldDirection(new THREE.Vector3());
      yaw = Math.atan2(d.z, d.x); pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      flyPos.copy(camera.position);
      if (m !== 'fly') { walker.place([camera.position.x, camera.position.y - B.eye + 0.3, camera.position.z]); eyeY = walker.pos[1] + B.eye; }
      mode = 'fly';
    }
    if (m === 'fly' && mode !== 'fly') flyPos.set(walker.pos[0], eyeY, walker.pos[2]);
    if (m === 'walk' && mode === 'fly') { walker.place([flyPos.x, flyPos.y - B.eye + 0.3, flyPos.z]); eyeY = walker.pos[1] + B.eye; }
    if (m === 'orbit' && mode !== 'orbit') {
      camera.position.copy(mode === 'fly' ? flyPos : new THREE.Vector3(walker.pos[0], eyeY, walker.pos[2]));
      controls.target.copy(camera.position).addScaledVector(forward(), 8);
    }
    mode = m;
    controls.enabled = mode === 'orbit';
    if (mode === 'game') gameTarget.set(walker.pos[0], walker.pos[1] + 0.9, walker.pos[2]);
    if (mode === 'game' && document.pointerLockElement) document.exitPointerLock();
    ui.mode(mode);
    still = 0;
  }
  const forward = () => new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));

  // ---- input
  const keys = new Set();
  let drag = null;
  const ui = makeUI(opts.ui !== false, plan);
  const onKey = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    const k = e.code;
    if (opts.devKeys === false) return;   // a game maps its own keys (opts.input)
    if (k === 'KeyF') setMode(mode === 'fly' ? 'walk' : 'fly');
    if (k === 'KeyG') setMode(mode === 'game' ? 'walk' : 'game');
    if (k === 'KeyO') setMode(mode === 'orbit' ? 'walk' : 'orbit');
    if (k === 'KeyH') ui.toggle();
    if (k === 'KeyR') place(spawn.eye, spawn.look, spawn.mode || 'walk');
    if (/^Digit[1-9]$/.test(k)) viewpoint(+k.slice(5) - 1);
    if (k === 'Space') e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  const turn = (dx, dy, k) => { yaw += dx * k; pitch = THREE.MathUtils.clamp(pitch - dy * k, -1.45, 1.45); };
  document.addEventListener('mousemove', (e) => {
    if (mode === 'orbit' || mode === 'game') return;
    if (document.pointerLockElement === canvas) turn(e.movementX, e.movementY, 0.0022);
    else if (drag) { turn(e.clientX - drag[0], e.clientY - drag[1], 0.004); drag = [e.clientX, e.clientY]; }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (mode === 'orbit' || mode === 'game') return;
    drag = [e.clientX, e.clientY];
    if (canvas.requestPointerLock && opts.pointerLock !== false) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* drag instead */ }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { if (mode === 'game') { viewSize = THREE.MathUtils.clamp(viewSize * Math.exp(e.deltaY * 0.0012), 3, 60); e.preventDefault(); } }, { passive: false });

  // ---- shadows follow the view, the centre snapped to whole shadow texels (the map never swims)
  const shadowR = opts.shadowRadius || 22;
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function shadowAround(p, R) {
    const d = world.keyDir;
    _r.crossVectors(Y, d); if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0); _r.normalize();
    _u.crossVectors(d, _r);
    const step = (2 * R) / world.sun.shadow.mapSize.x * 8;
    const a = Math.round(p.dot(_r) / step) * step, b = Math.round(p.dot(_u) / step) * step, c = Math.round(p.dot(d) / 2) * 2;
    _c.set(0, 0, 0).addScaledVector(_r, a).addScaledVector(_u, b).addScaledVector(d, c);
    return { center: _c.toArray(), radius: R };
  }

  // ---- the frame
  let last = performance.now(), still = 0, lastKey = '', running = true;
  const t0 = performance.now();
  const stats = { frames: 0, moving: 0, refined: 0, lastMs: 0 };
  function keyInput() {
    const k = (...c) => c.some((x) => keys.has(x));
    return {
      x: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), z: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      up: (k('KeyE') || (mode === 'fly' && k('Space'))) - k('KeyQ', 'KeyC'), run: k('ShiftLeft', 'ShiftRight'), jump: k('Space'),
    };
  }
  let changed = false, acting = false;
  function step(dt) {
    // opts.input(): { x (right), z (forward), up, run, jump } from a game's action map; default: the keys above
    const inp = opts.input ? opts.input(dt) : keyInput();
    const fx = inp.x || 0, fz = inp.z || 0, up = inp.up || 0, run = !!inp.run;
    acting = !!(fx || fz || up || inp.jump);
    const game = mode === 'game';
    // game view: up on the screen is away from the camera
    const fwd = game ? new THREE.Vector3(-GAME_DIR.x, 0, -GAME_DIR.z).normalize() : new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx);
    if (want.lengthSq() > 1) want.normalize();
    if (mode === 'walk' || game) {
      walker.update(dt, { x: want.x, z: want.z, run, jump: !!inp.jump });
      const p = walker.pos;
      if (game && want.lengthSq() > 1e-4) { let d = Math.atan2(want.z, want.x) - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * Math.min(1, dt * 10); pitch = 0; }
      const target = p[1] + B.eye;
      eyeY += (target - eyeY) * Math.min(1, dt * (Math.abs(target - eyeY) > 0.5 ? 30 : 14));   // eased over steps
      if (!walker.onGround) eyeY = target;
      if (game) {
        const k = Math.min(1, dt * 6);
        gameTarget.x += (p[0] - gameTarget.x) * k; gameTarget.y += (p[1] + 0.9 - gameTarget.y) * k; gameTarget.z += (p[2] - gameTarget.z) * k;
        const a = world.pipeline.w / world.pipeline.h;
        gameCam.left = -viewSize * a; gameCam.right = viewSize * a; gameCam.top = viewSize; gameCam.bottom = -viewSize;
        gameCam.updateProjectionMatrix();
        gameCam.position.copy(gameTarget).addScaledVector(GAME_DIR, GAME_DIST); gameCam.lookAt(gameTarget);
        figure.position.set(p[0], p[1], p[2]); figure.rotation.y = -yaw + Math.PI / 2;
        const sp = Math.hypot(want.x, want.z) * (walker.blocked ? 0.3 : 1);
        figure.userData.phase += dt * (sp > 0.05 ? (run ? 11 : 7) : 0);
        figure.userData.body.position.y = sp > 0.05 && walker.onGround ? Math.abs(Math.sin(figure.userData.phase)) * 0.04 : 0;
      } else camera.position.set(p[0], eyeY, p[2]);
    } else if (mode === 'fly') {
      const target = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx).setY(up).multiplyScalar(run ? FLY_FAST : FLY);
      flyVel.lerp(target, Math.min(1, dt * 4));
      flyPos.addScaledVector(flyVel, dt);
      const g = grid.groundAt(flyPos.x, flyPos.z, flyPos.y);
      if (!Number.isNaN(g) && flyPos.y < g + 0.6) flyPos.y = g + 0.6;
      camera.position.copy(flyPos);
    }
    figure.visible = game;
    if (mode === 'orbit') controls.update();
    else { const f = forward(); camera.lookAt(camera.position.x + f.x, camera.position.y + f.y, camera.position.z + f.z); }
    Object.assign(camera, mode === 'orbit' ? orbitLens : { fov, near: 0.08, far: 3000 });
    camera.aspect = world.pipeline.w / world.pipeline.h; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (opts.onStep && opts.onStep(dt)) changed = true;   // a game's tick; truthy = something in the scene moved
  }
  function view() {
    if (mode === 'game') return { cam: gameCam, shadow: shadowAround(gameTarget, Math.max(14, viewSize * 1.9)) };
    if (mode === 'orbit') return { cam: camera, shadow: null };
    const f = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const c = camera.position.clone().addScaledVector(f, shadowR * 0.45); c.y = walker.pos[1];
    return { cam: camera, shadow: shadowAround(c, shadowR) };
  }
  /** render the current view: moving -> temporal AA; still -> the still path (spp sub-frames) */
  function render({ moving = true, spp: n = spp, frameIndex } = {}) {
    const { cam, shadow } = view();
    const T = animate ? (performance.now() - t0) / 1000 : 0;
    const o = { camera: cam, ...(shadow ? { shadow } : {}), ...(frameIndex !== undefined ? { frameIndex } : {}) };
    world.renderFrame(T, moving ? { ...o, taa: true } : { ...o, spp: n });
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(frame); } };
  function frame(now) {
    pending = false;
    if (!running || hidden) return;
    schedule();
    if (power.maxFps && now - lastFrame < 1000 / power.maxFps - 2) return;   // at most maxFps (60; power saver 30)
    lastFrame = now;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1)); last = now;   // a rAF stamp can precede `last`
    step(dt);
    const { cam } = view();
    cam.updateMatrixWorld();
    const key = cam.matrixWorld.elements.map((v) => v.toFixed(5)).join(',') + (cam.isOrthographicCamera ? cam.top.toFixed(4) : cam.fov) + figure.userData.body.position.y.toFixed(4) +
      `@${world.pipeline.w}x${world.pipeline.h}`;   // a resize clears the canvas: draw again even when still
    const viewMoved = key !== lastKey || orbiting;
    if (viewMoved || acting) wake();
    // scene animation (snow, a flickering fire) keeps drawing only while someone is there; a clock / light change
    // (world.tick) always does
    const idle = idleAfter > 0 && performance.now() - lastInput > idleAfter * 1000;
    let moving = viewMoved || (changed && !idle);
    changed = false;
    lastKey = key;
    if (world.tick(dt)) moving = true;
    const t = performance.now();
    if (moving) { still = 0; render({ moving: true }); stats.moving++; }
    else {
      still++;
      if (still === 2) { render({ moving: false, spp: refine[0], frameIndex: 1 }); stats.refined++; }
      else if (still === 45 && refine[1] > refine[0]) { render({ moving: false, spp: refine[1], frameIndex: 1 }); stats.refined++; }
      else if (still === 1) render({ moving: true });
    }
    const drew = moving || still === 1 || still === 2 || (still === 45 && refine[1] > refine[0]);
    stats.lastMs = performance.now() - t;
    stats.frames++;
    if (drew) { stats.draws++; draws.push(now); }
    while (draws.length && now - draws[0] > 1000) draws.shift();
    ui.stats(`${mode} · ${walker.pos.map((v) => v.toFixed(2)).join(', ')} · ${still ? 'still ' + still : 'moving'}`);
    hud.show(draws.length, still > 45 || (still > 2 && refine[1] <= refine[0]));
  }

  // opts.fit: the canvas follows the window (pages without a fixed ?w= / ?h=)
  if (opts.fit) window.addEventListener('resize', () => {
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    world.resize(innerWidth, innerHeight);
  });

  // ---- GPU load: idle (scene animation stops drawing after opts.idle s without input), a frame cap, nothing at
  // all while the tab is hidden, the quality / fps corner with the power saver (opts.quality: the page's level)
  const idleAfter = opts.idle ?? 10, draws = [];
  stats.draws = 0;
  let lastInput = performance.now(), lastFrame = -1e9, hidden = typeof document !== 'undefined' && document.hidden;
  const wake = () => { lastInput = performance.now(); };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
  const power = { saver: false, maxFps: opts.maxFps ?? 60 };
  const setSaver = (on) => {
    power.saver = !!on; power.maxFps = on ? 30 : opts.maxFps ?? 60;
    try { localStorage.setItem(POWER_KEY, on ? '1' : '0'); } catch { /* no storage */ }
    if (opts.onPowerSaver) opts.onPowerSaver(power.saver);
    hud.update(); wake();
  };
  const hud = makeHud(opts.hud !== false, { quality: opts.quality || world.ctx.quality, power, setSaver });
  try { if (localStorage.getItem(POWER_KEY) === '1') setSaver(true); } catch { /* no storage */ }
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (opts.onVisibility) opts.onVisibility(!hidden);
    if (!hidden && running) { last = performance.now(); keys.clear(); wake(); schedule(); }
  });

  place(spawn.eye, spawn.look, mode);
  schedule();

  return {
    world, grid, walker, keys, figure, gameCam, controls, stats, render, place, viewpoint, setMode, turn,
    /** turn the view toward a world point without moving */
    lookAt: (p) => look(camera.position.toArray(), p),
    get yaw() { return yaw; }, set yaw(v) { yaw = v; }, get pitch() { return pitch; }, set pitch(v) { pitch = v; },
    get mode() { return mode; }, get still() { return still; },
    get viewSize() { return viewSize; }, set viewSize(v) { viewSize = v; },
    /** a plain snapshot for tests: feet, eye, mode, yaw */
    state: () => ({ mode, pos: (mode === 'fly' ? [flyPos.x, flyPos.y - B.eye, flyPos.z] : walker.pos).map((v) => +v.toFixed(3)), eye: camera.position.toArray().map((v) => +v.toFixed(3)), onGround: walker.onGround, blocked: walker.blocked, yaw: +yaw.toFixed(3), still }),
    /** advance input, walker and cameras by dt without rendering (tools drive frames themselves after stop()) */
    step,
    stop() { running = false; },
    start() { if (!running) { running = true; last = performance.now(); schedule(); } },
    /** the power saver (30 fps cap) and the frame-rate cap; wake(): count as input (restarts scene animation) */
    get powerSaver() { return power.saver; }, set powerSaver(v) { setSaver(v); },
    get maxFps() { return power.maxFps; }, wake, get idleFor() { return (performance.now() - lastInput) / 1000; },
  };
}

// a simple figure for the game view: robe, head, arms (three built-ins, the world's materials and shadows)
function makeFigure(world) {
  const { mat } = world;
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const cloth = mat.std({ color: new THREE.Color(0.62, 0.12, 0.06), roughness: 0.8 });
  const skin = mat.std({ color: new THREE.Color(0.45, 0.3, 0.2), roughness: 0.7 });
  const robe = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.02], [0.22, 0.02], [0.2, 0.6], [0.19, 1.2], [0.15, 1.38], [0.06, 1.45], [0, 1.46]].map(([r, y]) => new THREE.Vector2(r, y)), 20), cloth);
  robe.scale.z = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  head.position.y = 1.58;
  body.add(robe, head);
  for (const s of [-1, 1]) { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.5, 4, 8), cloth); a.position.set(s * 0.21, 1.05, 0); a.rotation.z = s * 0.08; body.add(a); }
  g.traverse((o) => { o.userData.collide = false; if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.name = 'figure';
  g.userData.body = body; g.userData.phase = 0;
  return g;
}

// the corner: quality (a choice is saved and applied on reload), frames drawn per second, the power saver
const POWER_KEY = 'mirage:power-saver';
function makeHud(on, { quality, power, setSaver }) {
  if (!on) return { show() {}, update() {} };
  const el = document.createElement('div');
  el.className = 'mirage-hud';
  el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:20;display:flex;gap:6px;align-items:center;font:11px/1.2 ui-monospace,monospace;color:#f3e6cc;background:rgba(12,10,8,.55);padding:4px 6px;border-radius:6px;';
  const ctl = 'font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:2px 5px;cursor:pointer;';
  el.innerHTML = `<select title="Quality (reloads the page)" style="${ctl}">${QUALITY_LEVELS.map((q) => `<option${q === quality ? ' selected' : ''}>${q}</option>`).join('')}</select>` +
    `<span class="f" style="min-width:7ch;text-align:right"></span><button type="button" style="${ctl}">Power saver</button>`;
  const sel = el.querySelector('select'), fps = el.querySelector('.f'), btn = el.querySelector('button');
  sel.addEventListener('change', () => { try { localStorage.setItem(QUALITY_KEY, sel.value); } catch { /* no storage */ } location.reload(); });
  btn.addEventListener('click', () => { setSaver(!power.saver); btn.blur(); });   // no focus: Space must stay a jump
  for (const c of [sel, btn]) c.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(el);
  let shown = -1;
  const hud = {
    show(n, settled) {
      const s = settled ? 'idle' : `${n} fps`;
      if (s !== shown) { fps.textContent = s; shown = s; }
    },
    update() { btn.style.background = power.saver ? 'rgba(120,200,120,.35)' : 'rgba(255,255,255,.08)'; btn.setAttribute('aria-pressed', String(power.saver)); },
  };
  hud.update();
  return hud;
}

function makeUI(on, plan) {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:14px;bottom:12px;font:12px/1.5 system-ui,sans-serif;color:#f3e6cc;text-shadow:0 1px 2px #000;pointer-events:none;';
  const vps = plan.viewpoints.slice(0, 9).map((v, i) => `${i + 1} ${v.name}`).join(' · ');
  root.innerHTML = `<div class="m" style="font-weight:600;letter-spacing:.08em"></div><div>WASD walk · mouse look · Shift run · Space jump · F fly · G game view · O orbit · R spawn · H hide</div><div style="opacity:.8">${vps}</div><div class="s" style="opacity:.6;font-family:ui-monospace,monospace"></div>`;
  if (on) document.body.appendChild(root);
  let shown = on;
  return {
    mode: (m) => { root.querySelector('.m').textContent = { walk: 'WALK', fly: 'FLY', game: 'GAME VIEW', orbit: 'ORBIT' }[m] || m; },
    toggle: () => { shown = !shown; root.style.display = shown ? '' : 'none'; },
    stats: (s) => { if (shown) root.querySelector('.s').textContent = s; },
  };
}

// Mirage code. Modes, keys and the game camera adapted from the author's own earlier walk.js; the loop uses the
// core's renderFrame (temporal AA while moving, the still sub-frame path once the view holds still).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { QUALITY_KEY, QUALITY_LEVELS } from '@mirage/core';
import { createLifetime } from '@mirage/core/lifetime';
import { bakeWalkGrid } from './walkgrid.js';
import { createWalker } from './walker.js';
import { createCharacter } from './character.js';
import { followReducedMotion } from './motion.js';

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
// Each still frame fades in over FADE frames from the image before it: TAA is softer while walking, and switching
// in one frame popped the image sharp (B1). The last fade frame is the still frame itself (an exact copy).
// The scene clock (wind, water, clouds, ctx.onUpdate) runs while the view moves and stands still with it, so still
// frames stay deterministic (M1b); place() (a viewpoint, the spawn) sets it back to 0, so fixed views are what they
// were (B5). `animate: true` runs it on real time instead.
// Reduced motion (opts.reducedMotion: 'auto' follows prefers-reduced-motion, true / false / { sway, rain } override;
// play.reducedMotion sets it later): the world's wind sway and rain slow down and still frames get no motion blur
// (world.setReducedMotion), and the eye eases over steps and jumps instead of following them exactly.
// The game view animates the visible traveller using actual displacement. Its root follows the walker.
// ---------------------------------------------------------------------------

const GAME_DIR = new THREE.Vector3(1, 1.15, 1).normalize(), GAME_DIST = 40;
const FLY = 8, FLY_FAST = 28;

export function createPlay(world, opts = {}) {
  const life = createLifetime();
  try {
    return mountPlay(world, opts, life);
  } catch (error) {
    life.dispose();
    throw error;
  }
}

function mountPlay(world, opts, life) {
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
  // the world's camera is the host's: dispose() gives back its lens and pose
  const hostCamera = { ...orbitLens, aspect: camera.aspect, position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  life.defer(() => {
    Object.assign(camera, { fov: hostCamera.fov, near: hostCamera.near, far: hostCamera.far, aspect: hostCamera.aspect });
    camera.position.copy(hostCamera.position); camera.quaternion.copy(hostCamera.quaternion);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  });
  const avatar = createCharacter(world, opts.appearance), figure = avatar.root;
  figure.visible = false;
  life.defer(() => avatar.dispose());
  scene.add(figure);
  const { touchAction, cursor } = canvas.style;
  life.defer(() => { Object.assign(canvas.style, { touchAction, cursor }); });
  const controls = new OrbitControls(camera, canvas);
  const orbitCaptures = new Set();
  life.listen(canvas, 'pointerdown', e => {
    if (controls.enabled && canvas.hasPointerCapture(e.pointerId)) orbitCaptures.add(e.pointerId);
  });
  life.listen(canvas, 'lostpointercapture', e => orbitCaptures.delete(e.pointerId));
  life.defer(() => {
    controls.dispose();
    for (const id of orbitCaptures) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    orbitCaptures.clear();
  });
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.enabled = false;
  let orbiting = false;
  life.listen(controls, 'start', () => { orbiting = true; });
  life.listen(controls, 'end', () => { orbiting = false; });

  // ---- placing
  function look(from, to) {
    const d = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
    yaw = Math.atan2(d.z, d.x); pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }
  /** put the viewer at `eye` looking at `look`; mode: 'walk' | 'fly' | 'game' | 'orbit' (default: keep) */
  function place(eye, lookAt, m = mode) {
    if (life.disposed) return;
    mode = m;
    clock = 0;
    look(eye, lookAt);
    walker.place([eye[0], eye[1] - B.eye + 0.3, eye[2]]);
    syncWalkerView();
    flyPos.set(...eye); flyVel.set(0, 0, 0);
    if (mode === 'orbit') { camera.position.set(...eye); controls.target.set(...lookAt); controls.update(); }
    setMode(mode);
  }
  function syncWalkerView() {
    if (life.disposed) return;
    const [x, y, z] = walker.pos;
    eyeY = y + B.eye;
    figure.position.set(x, y, z); figure.rotation.y = Math.PI / 2 - yaw; avatar.reset();
    gameTarget.set(x, y + 0.9, z);
    if (mode === 'walk') camera.position.set(x, eyeY, z);
  }
  function viewpoint(i) {
    if (life.disposed) return;
    const v = plan.viewpoints[i];
    if (!v) return;
    const above = v.eye[1] - (grid.groundAt(v.eye[0], v.eye[2], v.eye[1]) || 0);
    place(v.eye, v.look, v.mode || (mode === 'game' || mode === 'orbit' ? mode : above > 3 ? 'fly' : 'walk'));
  }
  // leaving fly or orbit for the ground: over a column with no floor at all (outside the plan), back to the spawn
  // instead (the walker used to stay hanging there, unable to move)
  const land = (p) => {
    if (Number.isNaN(grid.groundAt(p[0], p[2], 1e4))) walker.place([spawn.eye[0], spawn.eye[1] - B.eye, spawn.eye[2]]);
    else walker.place(p);
    eyeY = walker.pos[1] + B.eye;
  };
  function setMode(m) {
    if (life.disposed) return;
    if (mode === 'orbit' && m !== 'orbit') {   // leave the orbit where its camera is, looking where it looks
      const d = camera.getWorldDirection(new THREE.Vector3());
      yaw = Math.atan2(d.z, d.x); pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      flyPos.copy(camera.position);
      if (m !== 'fly') land([camera.position.x, camera.position.y - B.eye + 0.3, camera.position.z]);
      mode = 'fly';
    }
    if (m === 'fly' && mode !== 'fly') flyPos.set(walker.pos[0], eyeY, walker.pos[2]);
    if ((m === 'walk' || m === 'game') && mode === 'fly') land([flyPos.x, flyPos.y - B.eye + 0.3, flyPos.z]);
    if (m === 'orbit' && mode !== 'orbit') {
      camera.position.copy(mode === 'fly' ? flyPos : new THREE.Vector3(walker.pos[0], eyeY, walker.pos[2]));
      controls.target.copy(camera.position).addScaledVector(forward(), 8);
    }
    if (mode !== m && m === 'game') syncWalkerView();
    if (mode === 'game' && m !== 'game') avatar.reset();
    mode = m;
    figure.visible = mode === 'game';
    controls.enabled = mode === 'orbit';
    if (mode === 'game') gameTarget.set(walker.pos[0], walker.pos[1] + 0.9, walker.pos[2]);
    // orbit drags and the game view's cursor need the pointer back
    if ((mode === 'game' || mode === 'orbit') && document.pointerLockElement === canvas) document.exitPointerLock();
    ui.mode(mode);
    still = 0;
  }
  const forward = () => new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));

  // ---- input
  const keys = new Set();
  let drag = null;
  let viewIndex = -1;
  const ui = makeUI(life, opts.ui !== false, plan, {
    toggleOrbit: () => setMode(mode === 'orbit' ? 'walk' : 'orbit'),
    nextView: () => viewpoint((viewIndex = (viewIndex + 1) % plan.viewpoints.length)),
  });
  const onKey = (e) => {
    if (e.repeat || typing(e)) return;   // keys typed into the host page's fields are not moves
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
  life.listen(window, 'keydown', onKey);
  life.listen(window, 'keyup', (e) => keys.delete(e.code));
  life.listen(window, 'blur', () => keys.clear());
  // a field taking focus mid-press would otherwise leave the key held (its keyup goes to the field, handled above)
  life.listen(window, 'focusin', (e) => { if (typing(e)) keys.clear(); });
  const turn = (dx, dy, k) => { turned = true; yaw += dx * k; pitch = THREE.MathUtils.clamp(pitch - dy * k, -1.45, 1.45); };
  life.listen(document, 'mousemove', (e) => {
    if (mode === 'orbit' || mode === 'game') return;
    if (document.pointerLockElement === canvas) turn(e.movementX, e.movementY, 0.0022);
    else if (drag) { turn(e.clientX - drag[0], e.clientY - drag[1], 0.004); drag = [e.clientX, e.clientY]; }
  });
  let touchAt = -1e9;   // a tap also fires mousedown: no pointer lock for it (touch fingers need pointer capture)
  life.listen(canvas, 'mousedown', (e) => {
    if (mode === 'orbit' || mode === 'game' || performance.now() - touchAt < 1000) return;
    drag = [e.clientX, e.clientY];
    if (canvas.requestPointerLock && opts.pointerLock !== false) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* drag instead */ }
  });
  life.listen(window, 'mouseup', () => { drag = null; });
  // touch (when no game overlay takes it): a finger going down on the left half is a stick around that point,
  // dragged past STICK_RUN px it runs; one on the right half looks. Orbit keeps OrbitControls' own touch.
  const STICK = 50, STICK_RUN = 80, fingers = new Map(), pad = { x: 0, z: 0, run: false };
  life.defer(() => {
    keys.clear(); drag = null;
    for (const id of fingers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    fingers.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  });
  if (!opts.input && opts.touch !== false) {
    canvas.style.touchAction = 'none';
    const padFrom = (f, e) => {
      const dx = e.clientX - f.at[0], dy = e.clientY - f.at[1], l = Math.hypot(dx, dy), k = l > STICK ? STICK / l : 1;
      pad.x = (dx * k) / STICK; pad.z = (-dy * k) / STICK; pad.run = l > STICK_RUN;
    };
    life.listen(canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      touchAt = performance.now();
      if (mode === 'orbit') return;
      const r = canvas.getBoundingClientRect(), stick = e.clientX < r.left + r.width / 2 && ![...fingers.values()].some((f) => f.stick);
      fingers.set(e.pointerId, { stick, at: [e.clientX, e.clientY] });
      canvas.setPointerCapture(e.pointerId);
    });
    life.listen(canvas, 'pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      if (f.stick) padFrom(f, e);
      else if (mode !== 'game') { turn(e.clientX - f.at[0], e.clientY - f.at[1], 0.005); f.at = [e.clientX, e.clientY]; }
    });
    const up = (e) => { const f = fingers.get(e.pointerId); if (!f) return; fingers.delete(e.pointerId); if (f.stick) Object.assign(pad, { x: 0, z: 0, run: false }); };
    life.listen(canvas, 'pointerup', up); life.listen(canvas, 'pointercancel', up);
  }
  life.listen(canvas, 'wheel', (e) => { if (mode === 'game') { viewSize = THREE.MathUtils.clamp(viewSize * Math.exp(e.deltaY * 0.0012), 3, 60); e.preventDefault(); } }, { passive: false });

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
  let clock = 0;
  const stats = { frames: 0, moving: 0, refined: 0, lastMs: 0 };
  function keyInput() {
    const k = (...c) => c.some((x) => keys.has(x));
    return {
      x: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + pad.x, z: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + pad.z,
      up: (k('KeyE') || (mode === 'fly' && k('Space'))) - k('KeyQ', 'KeyC'), run: k('ShiftLeft', 'ShiftRight') || pad.run, jump: k('Space'),
    };
  }
  let changed = false, acting = false, turned = false, xrInput = null;
  function step(dt) {
    if (life.disposed) return;
    // opts.input(): { x (right), z (forward), up, run, jump } from a game's action map; default: the keys above
    const base = opts.input ? opts.input(dt) : keyInput();
    const inp = xrInput ? xrInput(base, dt) : base;   // [xr] packages/play/src/xr.js adds the controllers' sticks
    if (life.disposed) return;
    const fx = inp.x || 0, fz = inp.z || 0, up = inp.up || 0, run = !!inp.run;
    acting = !!(fx || fz || up || inp.jump);
    const game = mode === 'game';
    // game view: up on the screen is away from the camera
    const fwd = game ? new THREE.Vector3(-GAME_DIR.x, 0, -GAME_DIR.z).normalize() : new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx);
    if (want.lengthSq() > 1) want.normalize();
    const walking = mode === 'walk' || game;
    const motion = walking ? { x: want.x, z: want.z, run, jump: !!inp.jump, jumpPressed: !!inp.jumpPressed } : null;
    if (opts.simulation) {
      if (opts.simulation.advance(dt, motion)) changed = true;
    } else if (walking) walker.update(dt, motion);
    if (life.disposed) return;
    if (walking) {
      const p = opts.simulation?.viewPosition ?? walker.pos;
      if (game && want.lengthSq() > 1e-4) { let d = Math.atan2(want.z, want.x) - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * Math.min(1, dt * 10); pitch = 0; }
      const target = p[1] + B.eye;
      eyeY += (target - eyeY) * Math.min(1, dt * (Math.abs(target - eyeY) > 0.5 ? 30 : 14));   // eased over steps
      if (calmEye) eyeY += (target - eyeY) * Math.min(1, dt * 7);   // reduced motion: a softer rise and fall
      else if (!walker.onGround) eyeY = target;
      if (game) {
        const k = Math.min(1, dt * 6);
        gameTarget.x += (p[0] - gameTarget.x) * k; gameTarget.y += (p[1] + 0.9 - gameTarget.y) * k; gameTarget.z += (p[2] - gameTarget.z) * k;
        const a = world.pipeline.w / world.pipeline.h;
        gameCam.left = -viewSize * a; gameCam.right = viewSize * a; gameCam.top = viewSize; gameCam.bottom = -viewSize;
        gameCam.updateProjectionMatrix();
        gameCam.position.copy(gameTarget).addScaledVector(GAME_DIR, GAME_DIST); gameCam.lookAt(gameTarget);
        const distance = Math.hypot(p[0] - figure.position.x, p[2] - figure.position.z);
        const heading = Math.PI / 2 - yaw;
        if (figure.rotation.y !== heading) changed = true;
        if (avatar.update(dt, { distance, run, onGround: walker.onGround, verticalSpeed: walker.vy })) changed = true;
        figure.position.set(p[0], p[1], p[2]); figure.rotation.y = heading;
      } else camera.position.set(p[0], eyeY, p[2]);
    } else if (mode === 'fly') {
      const target = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx).setY(up);
      if (target.lengthSq() > 1) target.normalize();   // diagonals and stick + keys fly no faster than straight ahead
      target.multiplyScalar(run ? FLY_FAST : FLY);
      flyVel.lerp(target, Math.min(1, dt * 4));
      flyPos.addScaledVector(flyVel, dt);
      const g = grid.groundAt(flyPos.x, flyPos.z, flyPos.y);
      if (!Number.isNaN(g) && flyPos.y < g + 0.6) flyPos.y = g + 0.6;
      camera.position.copy(flyPos);
    }
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
  /** render the current view: moving -> temporal AA; still -> the still path (spp sub-frames); transparent: a still
   *  with a transparent sky, returned as { width, height, data } (world.renderTransparent; nothing is drawn) */
  function render({ moving = true, spp: n = spp, frameIndex, target, transparent = false } = {}) {
    if (life.disposed) return;
    const { cam, shadow } = view();
    const T = animate ? (performance.now() - t0) / 1000 : clock;
    const o = { camera: cam, ...(shadow ? { shadow } : {}), ...(frameIndex !== undefined ? { frameIndex } : {}) };
    if (transparent) return world.renderTransparent(T, { ...o, spp: n });
    rendering = true;
    try {
      world.renderFrame(T, moving ? { ...o, taa: true, target } : { ...o, spp: n, target });
    } finally {
      rendering = false;
      if (life.disposed) releaseFadeTargets();
    }
  }
  const FADE = 10;
  let fadeRT = null, rendering = false;
  function releaseFadeTargets() {
    if (fadeRT) for (const target of fadeRT) target.dispose();
    fadeRT = null;
  }
  life.defer(() => { if (!rendering) releaseFadeTargets(); });
  const fadeTargets = () => {
    const { w, h } = world.pipeline;
    if (!fadeRT || fadeRT[0].width !== w || fadeRT[0].height !== h) {
      if (fadeRT) for (const t of fadeRT) t.dispose();
      fadeRT = [0, 1].map(() => new THREE.WebGLRenderTarget(w, h, { depthBuffer: false }));
    }
    return fadeRT;
  };
  let frameId = null;
  function stop() {
    running = false;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }
  const schedule = () => {
    if (running && !hidden && !life.disposed && frameId === null) frameId = requestAnimationFrame(frame);
  };
  life.defer(stop);
  function frame(now) {
    frameId = null;
    if (!running || hidden) return;
    schedule();
    if (!gate(now)) return;   // at most maxFps (60; power saver 30)
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1)); last = now;   // a rAF stamp can precede `last`
    step(dt);
    if (life.disposed || !running) return;
    const { cam } = view();
    cam.updateMatrixWorld();
    const key = cam.matrixWorld.elements.map((v) => v.toFixed(5)).join(',') + (cam.isOrthographicCamera ? cam.top.toFixed(4) : cam.fov) +
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
    if (life.disposed) return;
    const t = performance.now();
    // the clock runs only on frames the player drives (keys, stick, looking): a camera easing in after place() or
    // after letting go does not move it
    if (moving && (acting || turned || orbiting)) clock += dt;
    turned = false;
    if (moving) { still = 0; render({ moving: true }); stats.moving++; }
    else {
      still++;
      if (still === 1) { const [a] = fadeTargets(); render({ moving: true, target: a }); if (!life.disposed) world.pipeline.blend(a, a, 0); }
      else if (still <= FADE + 1) {
        const [a, b] = fadeTargets();
        if (still === 2) { render({ moving: false, spp: refine[0], frameIndex: 1, target: b }); stats.refined++; }
        if (!life.disposed) world.pipeline.blend(a, b, (still - 1) / FADE);
      } else if (still >= 45 && still < 45 + FADE && refine[1] > refine[0]) {
        const [a, b] = fadeTargets();
        if (still === 45) { render({ moving: false, spp: refine[1], frameIndex: 1, target: a }); stats.refined++; }
        if (!life.disposed) world.pipeline.blend(b, a, (still - 44) / FADE);
      }
    }
    if (life.disposed) return;
    const drew = moving || still <= FADE + 1 || (still >= 45 && still < 45 + FADE && refine[1] > refine[0]);
    stats.lastMs = performance.now() - t;
    stats.frames++;
    if (drew) { stats.draws++; draws.push(now); }
    while (draws.length && now - draws[0] > 1000) draws.shift();
    ui.stats(`${mode} · ${walker.pos.map((v) => v.toFixed(2)).join(', ')} · ${still ? 'still ' + still : 'moving'}`);
    hud.show(draws.length, still >= 44 + FADE || (still > FADE + 1 && refine[1] <= refine[0]));
  }

  // opts.fit: the canvas follows the window (pages without a fixed ?w= / ?h=)
  if (opts.fit) life.listen(window, 'resize', () => {
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    world.resize(innerWidth, innerHeight);
  });

  // ---- GPU load: idle (scene animation stops drawing after opts.idle s without input), a frame cap, nothing at
  // all while the tab is hidden, the quality / fps corner with the power saver (opts.quality: the page's level)
  const idleAfter = opts.idle ?? 10, draws = [];
  stats.draws = 0;
  let lastInput = performance.now(), hidden = typeof document !== 'undefined' && document.hidden;
  const wake = () => { lastInput = performance.now(); };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) life.listen(window, ev, wake, { passive: true });
  const power = { saver: false, maxFps: opts.maxFps ?? 60 }, gate = frameGate(() => power.maxFps);
  // dynamic resolution must not read this cap as a slow GPU
  const capDynamicRes = () => { if (world.dynamicRes) world.dynamicRes.cap = power.maxFps; };
  capDynamicRes();
  const setSaver = (on) => {
    if (life.disposed) return;
    power.saver = !!on; power.maxFps = on ? 30 : opts.maxFps ?? 60;
    capDynamicRes();
    try { localStorage.setItem(POWER_KEY, on ? '1' : '0'); } catch { /* no storage */ }
    if (opts.onPowerSaver) opts.onPowerSaver(power.saver);
    hud.update(); wake();
  };
  const hud = makeHud(life, opts.hud !== false, { quality: opts.quality || world.ctx.quality, power, setSaver, onQuality: opts.onQuality });
  try { if (localStorage.getItem(POWER_KEY) === '1') setSaver(true); } catch { /* no storage */ }
  life.listen(document, 'visibilitychange', () => {
    hidden = document.hidden;
    if (opts.onVisibility) opts.onVisibility(!hidden);
    if (!hidden && running) { last = performance.now(); keys.clear(); wake(); schedule(); }
  });

  // reduced motion: 'auto' turns the world's on and off with the system setting (off only if play turned it on, so a
  // world created with reducedMotion keeps it); an explicit value always applies. dispose() gives the world back.
  const worldMotion = world.reducedMotion ?? null;
  let calmEye = false, ours = false, motionOption = opts.reducedMotion, stopMotion = () => {};
  const applyMotion = (v) => {
    if (life.disposed) return;
    const auto = motionOption === undefined || motionOption === null || motionOption === 'auto';
    if (v || !auto || ours) { if (world.setReducedMotion) world.setReducedMotion(v); ours = !!v && auto; }
    calmEye = !!(world.reducedMotion ?? v);
    changed = true; wake();
  };
  const followMotion = (o) => { stopMotion(); motionOption = o; stopMotion = followReducedMotion(o, typeof window === 'undefined' ? null : window, applyMotion); };
  followMotion(motionOption);
  life.defer(() => { stopMotion(); if (world.setReducedMotion) world.setReducedMotion(worldMotion); });

  place(spawn.eye, spawn.look, mode);
  schedule();

  return {
    world, grid, walker, keys, figure, avatar, gameCam, controls, stats, render, place, viewpoint, setMode, turn, syncWalkerView,
    /** turn the view toward a world point without moving */
    lookAt: (p) => look(camera.position.toArray(), p),
    get yaw() { return yaw; }, set yaw(v) { yaw = v; }, get pitch() { return pitch; }, set pitch(v) { pitch = v; },
    get mode() { return mode; }, get still() { return still; },
    /** [xr] (input, dt) -> input: merged into each step's input by packages/play/src/xr.js (null: none) */
    get xrInput() { return xrInput; }, set xrInput(fn) { xrInput = fn || null; },
    /** the scene clock in seconds (see the top of this file) */
    get clock() { return clock; },
    /** [sub-frames of the first still frame, of the final one] */
    get refine() { return refine.slice(); },
    get viewSize() { return viewSize; }, set viewSize(v) { viewSize = v; },
    /** a plain snapshot for tests: feet, eye, mode, yaw */
    state: () => ({ mode, pos: (mode === 'fly' ? [flyPos.x, flyPos.y - B.eye, flyPos.z] : walker.pos).map((v) => +v.toFixed(3)), eye: camera.position.toArray().map((v) => +v.toFixed(3)), onGround: walker.onGround, blocked: walker.blocked, yaw: +yaw.toFixed(3), still }),
    /** advance input, walker and cameras by dt without rendering (tools drive frames themselves after stop()) */
    step,
    stop, dispose: life.dispose,
    start() { if (!life.disposed && !running) { running = true; last = performance.now(); schedule(); } },
    /** the power saver (30 fps cap) and the frame-rate cap; wake(): count as input (restarts scene animation) */
    get powerSaver() { return power.saver; }, set powerSaver(v) { setSaver(v); },
    get maxFps() { return power.maxFps; }, wake, get idleFor() { return (performance.now() - lastInput) / 1000; },
    /** reduced motion: true while on; set 'auto' (follow the system setting), true, false or { sway, rain } */
    get reducedMotion() { return calmEye; }, set reducedMotion(o) { if (!life.disposed) followMotion(o); },
  };
}

/** (now) -> whether an animation frame at `now` (ms) runs, keeping to at most fps() frames per second */
export function frameGate(fps) {
  let next = -1e9;
  return (now) => {
    const f = fps();
    if (!f) return true;
    if (now < next - 2) return false;   // 2 ms early still counts: rAF stamps jitter
    // a deadline per frame, not a minimum gap: at 75 Hz a minimum gap of 1/60 s drew every other frame (37.5 fps)
    next = Math.max(next + 1000 / f, now);
    return true;
  };
}

/** true for an event whose target is a text field, select or editable element (the host page's, or the HUD's) */
export function typing(e) {
  const t = (e && e.composedPath && e.composedPath()[0]) || (e && e.target);   // inside shadow DOM, the real field
  return !!(t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '')));
}

// the corner: quality (a choice is saved and applied on reload), frames drawn per second, the power saver
const POWER_KEY = 'mirage:power-saver';
function makeHud(life, on, { quality, power, setSaver, onQuality }) {
  if (!on) return { show() {}, update() {} };
  const el = document.createElement('div');
  el.className = 'mirage-hud';
  el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:20;display:flex;gap:6px;align-items:center;font:11px/1.2 ui-monospace,monospace;color:#f3e6cc;background:rgba(12,10,8,.55);padding:4px 6px;border-radius:6px;';
  const ctl = 'font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:2px 5px;cursor:pointer;';
  el.innerHTML = `<select title="Quality (reloads the page)" style="${ctl}">${QUALITY_LEVELS.map((q) => `<option${q === quality ? ' selected' : ''}>${q}</option>`).join('')}</select>` +
    `<span class="f" style="min-width:7ch;text-align:right"></span><button type="button" style="${ctl}">Power saver</button>`;
  const sel = el.querySelector('select'), fps = el.querySelector('.f'), btn = el.querySelector('button');
  life.listen(sel, 'change', () => {
    try { localStorage.setItem(QUALITY_KEY, sel.value); } catch { /* no storage */ }
    if (onQuality) onQuality(sel.value); else location.reload();   // an embedding page decides how to apply it
  });
  life.listen(btn, 'click', () => { setSaver(!power.saver); btn.blur(); });   // no focus: Space must stay a jump
  for (const c of [sel, btn]) life.listen(c, 'keydown', (e) => e.stopPropagation());
  life.defer(() => el.remove());
  document.body.appendChild(el);
  // on touch the bottom corners hold a game's stick and buttons: go below its menu button (top 70 px, 52 px tall)
  const up = () => { el.style.top = '132px'; el.style.right = '16px'; el.style.bottom = 'auto'; };
  if (matchMedia('(pointer: coarse)').matches) up();
  life.listen(window, 'pointerdown', (e) => { if (e.pointerType === 'touch') up(); }, { capture: true, passive: true });
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

function makeUI(life, on, plan, { toggleOrbit, nextView }) {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:14px;bottom:12px;font:12px/1.5 system-ui,sans-serif;color:#f3e6cc;text-shadow:0 1px 2px #000;pointer-events:none;';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const vps = plan.viewpoints.slice(0, 9).map((v, i) => `${i + 1} ${esc(v.name ?? 'view')}`).join(' · ');
  root.innerHTML = `<div class="m" style="font-weight:600;letter-spacing:.08em"></div><div class="k">WASD walk · mouse look · Shift run · Space jump · F fly · G game view · O orbit · R spawn · H hide</div><div style="opacity:.8">${vps}</div><div class="s" style="opacity:.6;font-family:ui-monospace,monospace"></div>`;
  // touch has no keys: buttons for walk / orbit and the next viewpoint
  const bar = document.createElement('div');
  bar.className = 'mirage-touchbar';
  bar.style.cssText = 'position:fixed;left:12px;top:12px;z-index:20;display:none;gap:8px;font:14px system-ui,sans-serif;';
  const b = 'min-height:40px;padding:0 14px;color:#f3e6cc;background:rgba(12,10,8,.55);border:1px solid rgba(255,255,255,.3);border-radius:8px;';
  bar.innerHTML = `<button type="button" data-t="mode" style="${b}"></button>` + (plan.viewpoints.length ? `<button type="button" data-t="view" style="${b}">View</button>` : '');
  const modeBtn = bar.querySelector('[data-t=mode]');
  life.listen(modeBtn, 'click', toggleOrbit);
  if (plan.viewpoints.length) life.listen(bar.querySelector('[data-t=view]'), 'click', nextView);
  const touchOn = () => {
    bar.style.display = 'flex';
    root.querySelector('.k').textContent = 'left half: drag to walk, far to run · right half: drag to look';
  };
  if (on) {
    life.defer(() => { root.remove(); bar.remove(); });
    document.body.appendChild(root); document.body.appendChild(bar);
    if (matchMedia('(pointer: coarse)').matches) touchOn();
    life.listen(window, 'pointerdown', (e) => { if (e.pointerType === 'touch') touchOn(); }, { capture: true, passive: true });
  }
  let shown = on;
  return {
    mode: (m) => {
      root.querySelector('.m').textContent = { walk: 'WALK', fly: 'FLY', game: 'GAME VIEW', orbit: 'ORBIT' }[m] || m;
      modeBtn.textContent = m === 'orbit' ? 'Walk' : 'Orbit';
    },
    toggle: () => { shown = !shown; root.style.display = shown ? '' : 'none'; },
    stats: (s) => { if (shown) root.querySelector('.s').textContent = s; },
  };
}

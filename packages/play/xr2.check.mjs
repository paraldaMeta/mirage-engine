// Node checks of the XR mode's opt-in parts that need no GPU: the frame-time governor and its ladders, the device
// profiles, the per-eye post settings, height calibration, the play-area distance, the throw's velocity tracker, the
// two-handed transform, the poke test, and the interaction flow with fake pointers: with a real Rapier body when
// @mirage/game's physics loads here, else with a stub that records what a body is told.
// (The GPU paths and the session flow are packages/tools/src/xr-stereo-check.mjs, against an emulated session.)
import * as THREE from 'three';
import { createXRGovernor, XR_LEVELS, XR_SCALE_LEVELS, XR_PROFILES, xrProfile, heightOffset, boundsDistance } from './src/xr-quality.js';
import { xrEyePost, xrEyeSize, XR_POST_OFF } from './src/xr-post.js';
import { createVelocityTracker, twoHandTransform, pokeTest, POKE, createXRInteraction } from './src/xr-interact.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- governor
{
  const P = 1000 / 72, g = createXRGovernor({ hz: 72 });
  for (let i = 0; i < 24; i++) g.update(40, 40);   // 0.96 s of hitches
  ok(g.index === 0 && g.steps === 0, 'the first second of a session (shader compiles) is not counted');
  for (let i = 0; i < 300; i++) g.update(4, P);
  ok(g.index === 0, 'on-time frames at 4 ms: stays at the top');
  let n = 0; while (g.index === 0 && n < 100) { g.update(4, P * 2); n++; }
  ok(g.index === 1 && g.reason === 'late' && n === 4, `4 missed vsyncs in the window: one step down (${n} frames, reason ${g.reason})`);
  n = 0; while (g.index === 1 && n < 200) { g.update(4, P * 2); n++; }
  ok(g.index === 2 && n * P * 2 >= 1000, `the next step waits out the 1 s hold (${(n * P * 2 / 1000).toFixed(2)} s)`);
  const c = createXRGovernor({ hz: 72, warm: 0 });
  n = 0; while (c.index === 0 && n < 100) { c.update(12, P); n++; }
  ok(c.index === 1 && c.reason === 'cpu', `CPU at 12 ms of 13.9 (> 80 %): steps down before a frame is dropped (${n} frames)`);
  for (let i = 0; i < 2000 && c.index < XR_LEVELS.length - 1; i++) c.update(12, P);
  ok(c.index === XR_LEVELS.length - 1 && c.level.post === false, 'the ladder ends at the direct path and stays there');
  n = 0; while (c.index > 0 && n < 5000) { c.update(3, P); n++; }
  const perStep = (n * P) / 1000 / (XR_LEVELS.length - 1);
  ok(c.index === 0 && perStep > 4 && perStep < 5.5, `calm frames climb back, one level per ~4 s (${perStep.toFixed(2)} s each)`);
  for (let i = 0; i < 500; i++) c.update(i % 20 === 0 ? 3 : 3, i % 20 === 0 ? P * 2 : P);
  ok(c.index === 0, 'one late frame in twenty does not step (3 in 45 is the limit)');
  for (let i = 0; i < 200; i++) c.update(8.5, P);   // 61 %: between low and high
  ok(c.index === 0 && c.steps === 2 * (XR_LEVELS.length - 1), 'between the low and the high mark nothing moves (hysteresis)');
  c.setRate(120); ok(near(c.period, 1000 / 120), 'setRate follows the session\'s frame rate');
  ok(XR_LEVELS.every((l, i) => !i || l.scale <= XR_LEVELS[i - 1].scale) && XR_SCALE_LEVELS.every((l, i) => !i || l.scale < XR_SCALE_LEVELS[i - 1].scale), 'the ladders only ever take away');
}

// ---- profiles
{
  const ua = {
    'quest-2': 'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126 VR Safari/537.36',
    'quest-3': 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126 VR Safari/537.36',
    'vision-pro': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    pcvr: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    default: 'SomeHeadset/1.0',
  };
  for (const id in ua) ok(xrProfile(ua[id]).id === id, `user agent -> ${id}`);
  ok(xrProfile('quest-3').id === 'quest-3' && xrProfile('pcvr').post === true && xrProfile('quest-2').post === false, 'by name; only PC VR gets the post chain by default');
  ok(Object.values(XR_PROFILES).every((p) => p.tested === false && p.framebufferScale > 0 && p.framebufferScale <= 1 && p.note), 'every profile is marked untested on hardware');
}

// ---- per-eye post settings and sizes
{
  const P = { ao: 0.6, bloom: 0.3, taa2: 1, motionBlur: 0.5, grain: 0.02, vignette: 0.3, chroma: 0.002, dof: 1, bokeh: 1, upscale: 1, lut: {}, exposure: 1.1 };
  const e = xrEyePost(P);
  ok(Object.keys(XR_POST_OFF).every((k) => e[k] === 0) && e.ao === 0.6 && e.bloom === 0.3 && e.exposure === 1.1 && e.lut === P.lut && P.taa2 === 1, 'xrEyePost: temporal and lens passes off, the rest as the frame has it, the input untouched');
  const l = xrEyePost(P, { ao: false, bloom: false, lut: false });
  ok(l.ao === 0 && l.bloom === 0 && l.lut === null, 'xrEyePost: the level takes AO, bloom and the LUT away');
  ok(xrEyeSize(2064, 2208, 1).join() === '2064,2208' && xrEyeSize(2064, 2208, 0.85).join() === '1754,1876' && xrEyeSize(100, 100, 0.1).join() === '64,64' && xrEyeSize(1001, 999, 1).every((v) => v % 2 === 0), 'xrEyeSize: scaled, even, never under 64');
}

// ---- height and bounds
{
  ok(near(heightOffset('seated', 1.62, 1.15), 0.47) && near(heightOffset('standing', 1.62, 1.75), -0.13) && heightOffset('room', 1.62, 1.15) === 0 && heightOffset('seated', 1.62, 0) === 0, 'heightOffset: seated and standing calibrate to the eye height, room scale keeps the real one');
  const sq = [[-1.5, -1], [1.5, -1], [1.5, 1], [-1.5, 1]];
  ok(near(boundsDistance(sq, 0, 0), 1) && near(boundsDistance(sq, 1.3, 0), 0.2) && near(boundsDistance(sq, 2, 0), -0.5) && near(boundsDistance(sq, 2.5, 2), -Math.hypot(1, 1)) && boundsDistance([[0, 0], [1, 1]], 0, 0) === Infinity, 'boundsDistance: inside positive, outside negative, corners, no polygon');
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  ok(boundsDistance(L, 1.5, 1.5) < 0 && near(boundsDistance(L, 0.5, 1.5), 0.5), 'boundsDistance: a concave play area');
}

// ---- the throw's velocity
{
  const t = createVelocityTracker(0.1), lin = new THREE.Vector3(), ang = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  ok(t.read(lin, ang) === false, 'no samples: no velocity');
  // a slow carry, then the last 0.1 s fast: the throw is the flick, not the carry
  let time = 0;
  for (let i = 0; i < 30; i++) { time += 1 / 72; p.x += 0.2 / 72; t.push(time, p, q); }
  for (let i = 0; i < 9; i++) { time += 1 / 72; p.x += 3 / 72; p.y += 1 / 72; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i + 1) * (4 / 72)); t.push(time, p, q); }
  t.read(lin, ang);
  ok(near(lin.x, 3, 0.4) && near(lin.y, 1, 0.15) && near(ang.y, 4, 0.6) && Math.abs(ang.x) < 1e-6, `mean over the last 0.1 s: (${lin.x.toFixed(2)}, ${lin.y.toFixed(2)}) m/s, ${ang.y.toFixed(2)} rad/s about y`);
  t.reset(); ok(t.read(lin, ang) === false && lin.length() === 0, 'reset');
}

// ---- two hands
{
  const V = (x, y, z) => new THREE.Vector3(x, y, z), M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let k = twoHandTransform(V(-0.1, 1, 0), V(0.1, 1, 0), V(-0.2, 1, 0), V(0.2, 1, 0), M, [0.5, 3]);
  M.decompose(p, q, s);
  ok(near(k, 2) && near(s.x, 2) && near(V(0, 1, 0).applyMatrix4(M).distanceTo(V(0, 1, 0)), 0), 'hands twice as far apart: scaled x2 about their midpoint');
  k = twoHandTransform(V(-0.1, 1, 0), V(0.1, 1, 0), V(-1, 1, 0), V(1, 1, 0), M, [0.5, 3]);
  ok(near(k, 3), 'the scale is clamped to the range');
  k = twoHandTransform(V(-0.1, 1, 0), V(0.1, 1, 0), V(-1, 1, 0), V(1, 1, 0), M, null);
  ok(k === 1, 'no range (an object with a body): no scaling');
  twoHandTransform(V(-0.1, 1, 0), V(0.1, 1, 0), V(0.5, 1.2, 0.1), V(0.5, 1.2, -0.1), M, [0.5, 3]);
  ok(V(0.1, 1, 0).applyMatrix4(M).distanceTo(V(0.5, 1.2, -0.1)) < 1e-9 && V(-0.1, 1, 0).applyMatrix4(M).distanceTo(V(0.5, 1.2, 0.1)) < 1e-9, 'turned and carried: what each hand held is still in that hand');
}

// ---- poke
{
  const st = { over: false, down: false, front: false, u: 0, v: 0 }, at = (x, y, z) => pokeTest(new THREE.Vector3(x, y, z), 0.5, 0.3, st);
  at(0, 0, 0.2); ok(!st.over && !st.down, 'far in front: nothing');
  at(0.125, 0.075, 0.05); ok(st.over && !st.down && near(st.u, 0.75) && near(st.v, 0.25), 'within 8 cm: hover, u v from the top left');
  at(0.125, 0.075, 0.002); ok(st.down, 'through the surface: pressed');
  at(0.125, 0.075, 0.008); ok(st.down, 'back to 8 mm: still pressed (hysteresis)');
  at(0.125, 0.075, 0.02); ok(!st.down && st.over, 'past 12 mm: released');
  const b = { over: false, down: false, front: false, u: 0, v: 0 };
  pokeTest(new THREE.Vector3(0, 0, -0.03), 0.5, 0.3, b); pokeTest(new THREE.Vector3(0, 0, 0.001), 0.5, 0.3, b);
  ok(!b.down, 'a finger coming through from behind does not press');
  at(0.3, 0, 0.002); ok(!st.over && !st.down, 'off the panel\'s edge: nothing');
  ok(POKE.press < POKE.release && POKE.release < POKE.hover, 'thresholds in order');
}

// ---- the interaction flow with fake pointers
const ptr = (id) => { const pulses = []; return { id, grip: new THREE.Matrix4(), origin: null, dir: null, tip: new THREE.Vector3(), grab: false, select: false, pulses, pulse: (v, ms) => pulses.push([v, ms]) }; };
const at = (p, x, y, z) => { p.grip.makeTranslation(x, y, z); p.tip.set(x, y, z); };
{
  const scene = new THREE.Scene(), ix = createXRInteraction({ ground: () => 0 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05)); ball.name = 'ball'; ball.position.set(0, 1, 0); scene.add(ball); scene.updateMatrixWorld(true);
  const ev = [];
  ix.grabbable(ball, { radius: 0.05, onGrab: () => ev.push('grab'), onRelease: () => ev.push('release'), onLand: () => ev.push('land') });
  const zone = ix.snapZone({ position: [2, 1, 0], radius: 0.15, onSnap: () => ev.push('snap'), onUnsnap: () => ev.push('unsnap') });
  const a = ptr(0), b = ptr(1), dt = 1 / 72;
  at(a, 0.5, 1, 0); at(b, -3, 1, 0);
  ix.update(dt, [a, b]); ok(ix.state().pointers[0].hover === null, 'out of reach: no hover');
  at(a, 0.1, 1, 0); ix.update(dt, [a, b]);
  ok(ix.state().pointers[0].hover === 'ball' && a.pulses.length === 1 && a.pulses[0][0] === 0.15, 'in reach (0.1 m + the radius): hover, a light pulse');
  a.grab = true; ix.update(dt, [a, b]);
  ok(ix.state().pointers[0].held === 'ball' && ev.join() === 'grab' && a.pulses[1][0] === 0.5 && ix.busy(0) && !ix.busy(1), 'squeeze: held, a firmer pulse, the pointer is busy');
  at(a, 0.1, 1.3, 0.2); ix.update(dt, [a, b]);
  ok(ball.position.distanceTo(new THREE.Vector3(0, 1.3, 0.2)) < 1e-9, 'the object keeps its offset in the hand');
  // taken by the other hand
  at(b, 0, 1.3, 0.2); ix.update(dt, [a, b]); b.grab = true; ix.update(dt, [a, b]);
  ok(ix.state().pointers[1].held === 'ball' && ix.state().pointers[0].held === null && ix.state().items[0].holders === 1, 'a one-handed object changes hands');
  a.grab = false; at(a, -3, 1, 0); ix.update(dt, [a, b]);
  // a throw: 2 m/s along x for 0.15 s, then let go
  for (let i = 1; i <= 11; i++) { at(b, i * 2 * dt, 1.3, 0.2); ix.update(dt, [a, b]); }
  b.grab = false; ix.update(dt, [a, b]);
  const x0 = ball.position.x - 2 * dt, y0 = 1.3;
  ok(ix.state().items[0].flying && ix.state().throws === 1, 'released while moving: it flies');
  let n = 1; while (ix.state().items[0].flying && n < 500) { ix.update(dt, [a, b]); n++; }
  const tf = Math.sqrt((2 * (y0 - 0.05)) / 9.81);
  ok(near(ball.position.y, 0.05, 1e-9) && near(ball.position.x, x0 + 2 * tf, 0.06) && ev.includes('land'), `lands on the ground on the arc (x ${ball.position.x.toFixed(3)}, expected ${(x0 + 2 * tf).toFixed(3)}, ${(n * dt).toFixed(2)} s of ${tf.toFixed(2)})`);
  // into the snap zone
  at(a, ball.position.x, 0.05, 0.2); ix.update(dt, [a, b]); a.grab = true; ix.update(dt, [a, b]);
  at(a, 1.9, 1.05, 0); for (let i = 0; i < 12; i++) ix.update(dt, [a, b]);
  a.grab = false; ix.update(dt, [a, b]);
  ok(ball.position.distanceTo(new THREE.Vector3(2, 1, 0)) < 1e-9 && ix.state().items[0].snapped && ev.includes('snap') && a.pulses.at(-1)[0] === 0.7 && zone.item, 'released in the zone: seated at its centre, the strongest pulse');
  at(a, 2, 1, 0); ix.update(dt, [a, b]); a.grab = true; ix.update(dt, [a, b]);
  ok(ev.includes('unsnap') && !ix.state().items[0].snapped, 'taken out of the zone again');
  // the pointer disappears (controller asleep, hand lost): the object is not left hanging in the air
  ix.update(dt, [b]);
  ok(ix.state().items[0].holders === 0, 'a pointer that goes away lets go');
  // inside a moved, turned, scaled parent the object still follows the hand in the world
  const g = new THREE.Group(); g.position.set(5, 0, 5); g.rotation.y = 1; g.scale.setScalar(2); scene.add(g);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)); cube.name = 'cube'; cube.position.set(0.2, 0.5, 0); g.add(cube); scene.updateMatrixWorld(true);
  ix.grabbable(cube, { radius: 0.1, twoHanded: true, scale: [0.5, 3] });
  const w = cube.getWorldPosition(new THREE.Vector3());
  a.grab = false; at(a, w.x, w.y, w.z); ix.update(dt, [a, b]); a.grab = true; ix.update(dt, [a, b]);
  at(a, w.x + 1, w.y + 0.5, w.z); ix.update(dt, [a, b]);
  ok(cube.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(w.x + 1, w.y + 0.5, w.z)) < 1e-9, 'in a transformed parent: follows the hand in world space');
  b.grab = false; at(b, w.x + 1.1, w.y + 0.5, w.z); ix.update(dt, [a, b]); b.grab = true; ix.update(dt, [a, b]);
  ok(ix.state().items[1].holders === 2, 'the second hand joins a two-handed object');
  at(a, w.x + 0.9, w.y + 0.5, w.z); at(b, w.x + 1.2, w.y + 0.5, w.z); ix.update(dt, [a, b]);
  ok(near(cube.scale.x, 3, 1e-6), `hands 3 x apart: local scale x3 (${cube.scale.x.toFixed(3)})`);
  ix.reset();
  ok(ix.state().items.every((i) => i.holders === 0) && ix.state().pointers.every((p) => p.held === null && p.hover === null), 'reset (the session ended): nothing held');
}

// ---- with a body: held = kinematic and driven, released = dynamic with the hand's velocity
{
  const calls = [];
  const stub = { setBodyType: (t) => calls.push(['type', t]), setNextKinematicTranslation: (p) => calls.push(['kt', p.x, p.y, p.z]), setNextKinematicRotation: () => {}, setLinvel: (v) => calls.push(['lin', v.x, v.y, v.z]), setAngvel: (v) => calls.push(['ang', v.x, v.y, v.z]), setTranslation: () => {}, setRotation: () => {} };
  const scene = new THREE.Scene(), ix = createXRInteraction({}), box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  box.position.set(0, 1, 0); scene.add(box); scene.updateMatrixWorld(true);
  ix.grabbable(box, { body: { body: stub }, radius: 0.1, twoHanded: true, scale: [0.5, 3] });
  const a = ptr(0), dt = 1 / 72;
  at(a, 0, 1, 0); ix.update(dt, [a]); a.grab = true; ix.update(dt, [a]);
  ok(calls[0][0] === 'type' && calls[0][1] === 2, 'grabbed: the body turns kinematic (position based)');
  for (let i = 1; i <= 10; i++) { at(a, 0, 1 + i * 1.5 * dt, 0); ix.update(dt, [a]); }
  ok(calls.filter((c) => c[0] === 'kt').length >= 10 && near(calls.filter((c) => c[0] === 'kt').at(-1)[2], 1 + 15 * dt, 1e-9), 'held: its next kinematic pose is the hand\'s every frame');
  a.grab = false; ix.update(dt, [a]);
  const lin = calls.find((c) => c[0] === 'lin'), ti = calls.findIndex((c, i) => i > 0 && c[0] === 'type');
  ok(calls[ti][1] === 0 && lin && near(lin[2], 1.5, 0.05) && Math.abs(lin[1]) < 1e-9, `released: dynamic again with the hand's velocity (${lin && lin[2].toFixed(2)} m/s up)`);
}
let rapier = 'not run';
try {
  const { createPhysics } = await import('../game/src/physics.js');
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 20)); floor.position.y = -0.1; scene.add(floor);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)); box.position.set(0, 1, 0); scene.add(box); scene.updateMatrixWorld(true);
  const phys = await createPhysics(scene), h = phys.body(box, { mass: 1 }), ix = createXRInteraction({ physics: phys });
  ix.grabbable(box, { body: h, radius: 0.1 });
  const a = ptr(0), dt = 1 / 60;
  at(a, 0, 1, 0); ix.update(dt, [a]); a.grab = true; ix.update(dt, [a]); phys.step(dt);
  for (let i = 1; i <= 12; i++) { at(a, i * 2 * dt, 1 + i * 2 * dt, 0); ix.update(dt, [a]); phys.step(dt); }
  const held = h.body.translation();
  ok(near(held.x, 0.4, 0.04) && near(held.y, 1.4, 0.04) && h.body.bodyType() === 2, `Rapier: the held body follows the hand (${held.x.toFixed(2)}, ${held.y.toFixed(2)})`);
  a.grab = false; ix.update(dt, [a]);
  const v = h.body.linvel();
  ok(h.body.bodyType() === 0 && near(v.x, 2, 0.1) && near(v.y, 2, 0.1), `Rapier: released dynamic at (${v.x.toFixed(2)}, ${v.y.toFixed(2)}) m/s`);
  let top = 0; for (let i = 0; i < 240; i++) { ix.update(dt, [a]); phys.step(dt); top = Math.max(top, h.body.translation().y); }
  const end = h.body.translation();
  // apex of a 2 m/s rise from 1.4 m: 1.4 + 4 / (2 * 9.81) = 1.60; then it comes down onto the floor
  ok(near(top, 1.4 + 4 / (2 * 9.81), 0.06) && end.y < 0.25 && end.x > 1.2, `Rapier: it rises to ${top.toFixed(2)} m (1.60 expected), lands on the floor at x ${end.x.toFixed(2)}`);
  rapier = 'ok';
} catch (e) {
  if (!/Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(String(e && (e.code || '') + e.message))) throw e;
  rapier = 'skipped: ' + e.message.split('\n')[0];
  console.log('  --  Rapier throw not run here (' + rapier + ')');
}
console.log('xr2.check ok' + (rapier === 'ok' ? '' : ' (Rapier part ' + rapier + ')'));

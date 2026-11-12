// Mirage original code.
// The 2.5D kit without a GPU (`node packages/play/sprites.check.mjs`, part of `npm test` in play): the direction
// convention against a real camera, atlas parsing and frame math, animation events, the placeholder atlases, the
// sprite material's shader edits and shared program, the actor, the iso camera (math, limits, input bind / unbind)
// and picking on a hand-made walk grid with the reachable fallback. What the GPU draws: examples/sprite-yard.
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { createMaterials, createEnv } from '@miragekit/core';
import {
  spriteDirection, drawnDirection, parseAtlas, createSpriteAnim, makePlaceholderAtlas, makeAtlas,
  createSpriteMaterial, createSilhouetteMaterial, createSpriteActor,
} from './src/sprites.js';
import { createIsoCamera } from './src/iso-camera.js';
import { pickWalkGrid, reachableGoal } from './src/walk-pick.js';
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createNavGrid } from './src/navgrid.js';
import * as index from './src/index.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const PI = Math.PI;

// ---- 1. directions: the table, mirroring, and the convention against a real camera ----
{
  const table = [[0, 0], [PI / 4, 1], [PI / 2, 2], [3 * PI / 4, 3], [PI, 4], [-3 * PI / 4, 5], [-PI / 2, 6], [-PI / 4, 7], [2 * PI, 0], [-2 * PI + 0.1, 0], [PI / 8 + 0.01, 1], [PI / 8 - 0.01, 0]];
  for (const [a, d] of table) assert.equal(spriteDirection(a, 0), d, `facing ${a.toFixed(3)} at yaw 0 -> ${d}`);
  for (const y of [0.3, -2, 5]) for (let d = 0; d < 8; d++) assert.equal(spriteDirection(y + (d * PI) / 4, y), d, `relative to yaw ${y}`);
  assert.deepEqual(drawnDirection(5, 5), [3, true]); assert.deepEqual(drawnDirection(5, 6), [2, true]); assert.deepEqual(drawnDirection(5, 7), [1, true]);
  assert.deepEqual(drawnDirection(5, 4), [4, false]); assert.deepEqual(drawnDirection(8, 6), [6, false]); assert.deepEqual(drawnDirection(1, 3), [0, false]);
  // a camera placed by the iso camera: facing it is dir 0, facing its screen right is dir 2, away is 4
  for (const yawDeg of [0, 35, 160, -90]) {
    const iso = createIsoCamera({ yaw: yawDeg, follow: Infinity }), cam = new THREE.PerspectiveCamera(30, 1.5, 0.5, 600);
    iso.follow([3, 0, -2]).update(0.016).apply(cam);
    const toCam = [cam.position.x - 3, cam.position.z + 2];
    assert.equal(spriteDirection(Math.atan2(toCam[0], toCam[1]), iso.yaw), 0, `yaw ${yawDeg}: facing the camera`);
    const e = cam.matrixWorld.elements;   // the camera's right axis
    assert.equal(spriteDirection(Math.atan2(e[0], e[2]), iso.yaw), 2, `yaw ${yawDeg}: facing screen right`);
    assert.equal(spriteDirection(Math.atan2(-toCam[0], -toCam[1]), iso.yaw), 4, `yaw ${yawDeg}: facing away`);
  }
}

// ---- 2. atlas parsing and frames ----
const goodJson = () => ({
  id: 't', cell: [100, 200], feet: [50, 190], height: 2, dirs: 5,
  anims: {
    idle: { fps: 4, frames: [0, 1, 2, 3, 4].map((d) => [[0, d * 200], [100, d * 200]]) },
    attack: { fps: 10, loop: false, hit: 2, frames: [0, 1, 2, 3, 4].map((d) => [[0, d * 200], [100, d * 200], [200, d * 200], [300, d * 200]]) },
  },
});
{
  const a = parseAtlas(goodJson(), { width: 400, height: 1000 });
  assert.equal(a.width, 1); assert.equal(a.height, 2);
  assert.ok(near(a.feetU, 0.5) && near(a.feetV, 0.05), 'feet pivot in texture space');
  assert.deepEqual(a.texel, [1 / 400, 1 / 1000]);
  assert.equal(a.duration('attack'), 0.4); assert.equal(a.duration('idle'), 0.5);
  let f = a.frame('idle', 2, 0.3);   // frame 1 of dir 2: cell (100, 400)
  assert.deepEqual(f.rect, [0.25, 1 - 600 / 1000, 0.25, 0.2]); assert.equal(f.index, 1); assert.equal(f.flip, false); assert.equal(f.done, false);
  f = a.frame('idle', 6, 0.55);       // looped back to 0; dir 6 is dir 2 mirrored
  assert.equal(f.index, 0); assert.equal(f.flip, true); assert.ok(near(f.rect[1], 1 - 600 / 1000));
  f = a.frame('attack', 0, 0.45);     // past the end: held on the last frame, done
  assert.equal(f.index, 3); assert.equal(f.done, true);
  assert.equal(a.frame('walk', 0, 0).count, 2, 'a missing animation falls back to idle');
  assert.equal(a.anim('walk'), a.anim('idle'));
  // 1 direction and 8 directions
  const one = parseAtlas({ cell: [10, 10], anims: { pulse: { frames: [[[0, 0]]] } } }, { width: 10, height: 10 });
  assert.equal(one.dirs, 1); assert.equal(one.anim('idle'), one.anim('pulse'), 'without idle: the first animation');
  assert.equal(one.frame('pulse', 5, 0).flip, false);
  const eight = parseAtlas({ cell: [10, 10], dirs: 8, anims: { idle: { frames: Array.from({ length: 8 }, (_, d) => [[d * 10, 0]]) } } }, { width: 80, height: 10 });
  assert.ok(near(eight.frame('idle', 7, 0).rect[0], 70 / 80), 'dir 7 drawn: its own cell');
  // every problem in one error
  const bad = { cell: [100, 0], dirs: 4, feet: [500, 0], anims: { idle: { fps: -1, loop: 'yes', frames: [[[0, 0]], [[900, 0]], [], [[0, 0]]], hit: 3 } } };
  try { parseAtlas(bad, { width: 400, height: 400 }); assert.fail('a bad atlas parsed'); } catch (e) {
    for (const s of ['cell:', 'dirs:', 'fps:', 'loop:', 'frames:']) assert.ok(e.message.includes(s), `the error names ${s}`);
    assert.ok(/\d+ problems/.test(e.message), 'and counts them');
  }
  const outside = goodJson(); outside.anims.idle.frames[4][1] = [350, 800];
  assert.throws(() => parseAtlas(outside, { width: 400, height: 1000 }), /outside the 400 x 1000 image/);
  const badHit = goodJson(); badHit.anims.attack.hit = 4;
  assert.throws(() => parseAtlas(badHit, { width: 400, height: 1000 }), /hit: a frame index 0..3/);
  assert.throws(() => parseAtlas(goodJson(), {}), /image size/);
}

// ---- 3. animation events ----
{
  const a = parseAtlas(goodJson(), { width: 400, height: 1000 });
  const anim = createSpriteAnim(a), log = [];
  assert.equal(anim.name, 'idle');
  anim.play('attack', { onHit: () => log.push(['hit', anim.frame.index]), onEnd: () => log.push(['end']) });
  for (let i = 0; i < 12; i++) anim.update(0.05, 0);   // 0.6 s: frames 0..3 at 10 fps, then done
  assert.deepEqual(log, [['hit', 2], ['end']], 'hit once on frame 2, end once');
  // playing the one already playing continues it; restart starts over
  anim.play('idle'); anim.update(0.3); const t = anim.time;
  anim.play('idle'); assert.equal(anim.time, t, 'same animation: continues');
  anim.play('idle', { restart: true }); assert.equal(anim.time, 0, 'restart');
  // no hit frame: a third of the way in
  const b = parseAtlas({ cell: [10, 10], anims: { idle: { frames: [[[0, 0]]] }, swing: { loop: false, fps: 10, frames: [[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]] } } }, { width: 10, height: 10 });
  const sb = createSpriteAnim(b); let at = -1;
  sb.play('swing', { onHit: () => { at = sb.frame.index; } });
  for (let i = 0; i < 10; i++) sb.update(0.1);
  assert.equal(at, 2, 'default hit: floor(6 / 3)');
  // a new animation started from onHit: the old one's onEnd never fires
  const sc = createSpriteAnim(a), ends = [];
  sc.play('attack', { onHit: () => sc.play('idle'), onEnd: () => ends.push('attack') });
  for (let i = 0; i < 20; i++) sc.update(0.05);
  assert.deepEqual(ends, [], 'replaced before its end: no onEnd');
  // a big step that jumps past the hit frame and the end fires both, hit first
  const sd = createSpriteAnim(a), order = [];
  sd.play('attack', { onHit: () => order.push('hit'), onEnd: () => order.push('end') }); sd.update(5);
  assert.deepEqual(order, ['hit', 'end']);
}

// ---- 4. placeholders: every shape draws in the atlas format ----
const stubCanvas = (w, h) => {
  const calls = { n: 0 };
  const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => { calls.n++; }), set: (t, k, v) => { t[k] = v; return true; } });
  return { width: w, height: h, calls, getContext: () => g };
};
{
  for (const shape of ['humanoid', 'blob', 'bird', 'crab', 'item']) {
    const { json, canvas } = makePlaceholderAtlas({ id: shape + '-x', shape }, { canvas: stubCanvas });
    const a = parseAtlas(json, canvas);
    assert.ok(canvas.calls.n > 5, `${shape}: drawn`);
    assert.ok(a.has('idle'), `${shape}: idle`);
    if (shape === 'item') assert.deepEqual(a.names, ['idle']);
    else { assert.deepEqual(a.names, ['idle', 'walk', 'attack', 'hurt', 'die']); assert.equal(a.anim('attack').hit, 2); assert.equal(a.anim('die').loop, false); }
  }
  const { json } = makePlaceholderAtlas({ shape: 'humanoid', dirs: 8, anims: ['idle', 'walk'], cell: [64, 96], feet: [32, 90], height: 1.6 }, { canvas: stubCanvas });
  assert.equal(json.dirs, 8); assert.equal(json.anims.walk.frames.length, 8); assert.deepEqual(Object.keys(json.anims), ['idle', 'walk']);
  assert.equal(json.height, 1.6);
}

// ---- 5. the sprite material and the actor ----
{
  const G = createEnv({}).G, mat = createMaterials(G);
  const hooks = [];
  const world = { mat, scene: new THREE.Scene(), post: { exposure: 2 }, exposure: 0.5, gradeLook: { exposure: 4 }, ctx: { onUpdate: (fn) => { hooks.push(fn); return () => {}; } } };
  const { json, canvas } = makePlaceholderAtlas({ shape: 'humanoid', id: 'hero' }, { canvas: stubCanvas });
  const atlas = makeAtlas(json, canvas, { source: 'placeholder' });
  assert.equal(atlas.source, 'placeholder'); assert.equal(atlas.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(makeAtlas(json, atlas.texture).texture, atlas.texture, 'a texture is used as it is');
  const m = createSpriteMaterial(world, atlas);
  const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
  m.onBeforeCompile(sh, null);
  assert.ok(sh.vertexShader.includes('spC2.z / spC2.w * spC1.w'), 'the clip-space depth edit found its anchor');
  assert.ok(sh.fragmentShader.includes('#define RE_Direct RE_Direct_Sprite'), 'the wrapped light found its anchor');
  assert.ok(sh.fragmentShader.includes('spAlphaAt') && sh.uniforms.uAtlas.value === atlas.texture);
  assert.equal(createSpriteMaterial(world, atlas).customProgramCacheKey(), m.customProgramCacheKey(), 'one program for every sprite');
  assert.ok(m.customProgramCacheKey().endsWith('sprite'));
  const sil = createSilhouetteMaterial(world, m.userData.sprite);
  const sb = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
  sil.onBeforeCompile(sb, null);
  assert.ok(sb.vertexShader.includes('spC2.z / spC2.w'), 'the silhouette is placed like the card');
  assert.equal(sil.depthFunc, THREE.GreaterDepth); assert.equal(sil.depthWrite, false);
  assert.equal(sil.userData.sprite.uRect, m.userData.sprite.uRect, 'it shares the card uniforms');
  // the emissive scale follows the world's exposure (one subscription per world)
  assert.equal(hooks.length, 1, 'one onUpdate per world');
  hooks[0](0);
  assert.ok(near(m.userData.sprite.uEmit.value, 1 / 4), 'uEmit = 1 / (post x auto x grade)');

  const ground = (x, z) => 0.1 * x + 0.2 * z;
  const actor = createSpriteActor(world, atlas, { silhouette: { color: [1, 0, 0] }, ground });
  assert.equal(actor.group.parent, world.scene); assert.ok(actor.silhouette);
  assert.ok([actor.group, actor.card, actor.blob, actor.silhouette].every((o) => o.userData.collide === false), 'the walk grid ignores it');
  actor.group.position.set(2, ground(2, 1), 1);
  actor.faceToward(2, 5);                        // +Z: toward a camera at yaw 0
  assert.equal(actor.update(0.1, 0), 0);
  assert.equal(actor.update(0.1, { yaw: PI / 2 }), 6, 'a camera at +X sees +Z as screen left');
  assert.equal(actor.uniforms.uFlip.value, 1, 'dir 6 of a 5-direction atlas is mirrored');
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(actor.blob.quaternion);
  assert.ok(near(n.x / n.y, -0.1, 1e-3) && near(n.z / n.y, -0.2, 1e-3), 'the blob lies on the slope');
  const ends = [];
  actor.play('attack', { onEnd: () => ends.push(1) });
  for (let i = 0; i < 10; i++) actor.update(0.1, 0);
  assert.deepEqual(ends, [1]);
  actor.flash(1); actor.update(0, 0); assert.ok(actor.uniforms.uFlash.value > 0.7);
  actor.update(1, 0); assert.equal(actor.uniforms.uFlash.value, 0, 'the flash fades');
  actor.flash(1).flash(0); assert.equal(actor.uniforms.uFlash.value, 0, 'flash(0) clears at once');
  actor.outline('enemy'); assert.equal(actor.uniforms.uOutline.value.w, 4); actor.outline(null); assert.equal(actor.uniforms.uOutline.value.w, 0);
  actor.setFade(0.5); assert.ok(near(actor.blob.material.opacity, 0.16));
  // screenRect: centred on the projected feet, the card's height above them
  const cam = new THREE.PerspectiveCamera(30, 1.5, 0.5, 600);
  createIsoCamera({ yaw: 20, distance: 15, follow: Infinity }).follow(actor.group.position).update(0).apply(cam);
  const r = actor.screenRect(cam, 1500, 1000), feet = actor.group.position.clone().project(cam);
  assert.ok(near(r.cx, (feet.x * 0.5 + 0.5) * 1500, 1e-6) && r.y0 < r.cy && r.x0 < r.cx && r.x1 > r.cx, 'screen rect round the feet');
  actor.dispose(); assert.equal(actor.group.parent, null);
  // a module ctx (no post, no onUpdate): uEmit stays 1
  const plain = createSpriteMaterial({ mat }, atlas);
  assert.equal(plain.userData.sprite.uEmit.value, 1);
}

// ---- 6. the iso camera ----
{
  const iso = createIsoCamera({ pitch: 45, yaw: 0, distance: 10, min: 5, max: 20, follow: 8 });
  iso.follow([0, 0, 0]).update(0);
  assert.ok(near(iso.position[0], 0) && near(iso.position[1], 1 + 10 * Math.SQRT1_2) && near(iso.position[2], 10 * Math.SQRT1_2), 'yaw 0: south of the target, pitch above it');
  assert.deepEqual(iso.look, [0, 1, 0]);
  iso.follow({ x: 10, y: 0, z: 0 }).update(0.1);
  assert.ok(near(iso.look[0], 8), 'the view eases toward the target (8 / s)');
  iso.snap().update(0.001); assert.ok(near(iso.look[0], 10), 'snap: jumps');
  iso.zoom(100); assert.equal(iso.want, 20); iso.zoom(1e-3); assert.equal(iso.want, 5, 'zoom stays in min..max');
  for (let i = 0; i < 100; i++) iso.update(0.1);
  assert.ok(near(iso.distance, 5, 1e-3), 'the boom eases to the wanted length');
  const p0 = iso.pitch; iso.turn(0.5, 0.3); assert.equal(iso.pitch, p0, 'a fixed pitch'); assert.ok(near(iso.yaw, 0.5));
  const lim = createIsoCamera({ pitch: 50, pitchMin: 30, pitchMax: 70, yaw: 0, yawMin: -45, yawMax: 45 });
  lim.turn(10, 10); assert.ok(near(lim.yaw, PI / 4) && near(lim.pitch, 70 * PI / 180), 'yaw and pitch limits');
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  lim.follow([1, 2, 3]).update(0).apply(cam);
  assert.equal(cam.fov, 30); assert.equal(cam.near, 0.5);
  const c = new THREE.Vector3(1, 3, 3).project(cam);
  assert.ok(near(c.x, 0, 1e-9) && near(c.y, 0, 1e-9), 'the look point is the middle of the screen');

  // input: bind, drive, unbind
  const dom = new EventTarget(), keys = new EventTarget();
  dom.setPointerCapture = () => {};
  const ev = (type, props) => Object.assign(new Event(type, { cancelable: true }), props);
  const cam2 = createIsoCamera({ yaw: 0, distance: 20, min: 10, max: 30 });
  const unbind = cam2.bind(dom, { keyTarget: keys });
  const w0 = cam2.want;
  const wheel = ev('wheel', { deltaY: 100 }); dom.dispatchEvent(wheel);
  assert.ok(cam2.want > w0 && wheel.defaultPrevented, 'the wheel zooms out');
  dom.dispatchEvent(ev('pointerdown', { button: 2, pointerId: 1, clientX: 100, clientY: 0, pointerType: 'mouse' }));
  dom.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: 200, clientY: 0, pointerType: 'mouse' }));
  dom.dispatchEvent(ev('pointerup', { button: 2, pointerId: 1, pointerType: 'mouse' }));
  assert.ok(near(cam2.yaw, -0.6), 'right-drag turns (0.006 rad / px)');
  keys.dispatchEvent(ev('keydown', { key: 'Q' })); cam2.update(0.5); keys.dispatchEvent(ev('keyup', { key: 'q' })); cam2.update(0.5);
  assert.ok(near(cam2.yaw, -0.6 + 0.9), 'Q turns while held');
  // two fingers: pinch out zooms in, a twist turns
  const t1 = { pointerType: 'touch', pointerId: 7 }, t2 = { pointerType: 'touch', pointerId: 8 };
  const wBefore = cam2.want, yBefore = cam2.yaw;
  dom.dispatchEvent(ev('pointerdown', { ...t1, clientX: 0, clientY: 0 })); dom.dispatchEvent(ev('pointerdown', { ...t2, clientX: 100, clientY: 0 }));
  dom.dispatchEvent(ev('pointermove', { ...t2, clientX: 0, clientY: 200 }));
  assert.ok(cam2.want < wBefore, 'pinch out: closer'); assert.ok(near(cam2.yaw, yBefore - PI / 2), 'twist: turns');
  dom.dispatchEvent(ev('pointerup', t1)); dom.dispatchEvent(ev('pointerup', t2));
  unbind();
  const snap = [cam2.want, cam2.yaw];
  dom.dispatchEvent(ev('wheel', { deltaY: 500 })); keys.dispatchEvent(ev('keydown', { key: 'e' })); cam2.update(1);
  dom.dispatchEvent(ev('pointerdown', { button: 2, pointerId: 2, clientX: 0, clientY: 0, pointerType: 'mouse' })); dom.dispatchEvent(ev('pointermove', { pointerId: 2, clientX: 300, clientY: 0, pointerType: 'mouse' }));
  assert.deepEqual([cam2.want, cam2.yaw], snap, 'unbound: no listener left');
  const cam3 = createIsoCamera(); cam3.bind(dom, { keyTarget: keys }); cam3.bind(dom, { keyTarget: keys }); cam3.dispose();
  const y3 = cam3.yaw; keys.dispatchEvent(ev('keydown', { key: 'q' })); cam3.update(1); assert.equal(cam3.yaw, y3, 'dispose() unbinds every bind');
}

// ---- 7. picking on the walk grid, and the reachable fallback ----
const cell = 0.125;
function gridOf(nx, nz, x0, z0, layers) {
  const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, L = layers(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
    count[k] = L.length;
    L.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; });
  }
  return makeGrid({ nx, nz, x0, z0, cell, floors, count });
}
{
  // ground at 0; a 2 x 2 m block 3 m high (a flat top a body fits on, no way up); a 0.2 m wall 2.5 m high (a top
  // nobody fits on); a 2 x 2 m deck at 2.7 with headroom under it (no way up either)
  const inBox = (x, z, a, b, c, d) => x > a && x < b && z > c && z < d;
  const grid = gridOf(160, 160, -10, -10, (x, z) => {
    if (inBox(x, z, 2, 4, -1, 1)) return [[3, Infinity]];
    if (inBox(x, z, -3, -2.8, -10, 10)) return [[2.5, Infinity]];
    if (inBox(x, z, -1, 1, 5, 7)) return [[0, 2.5], [2.7, Infinity]];
    return [[0, Infinity]];
  });
  const nav = createNavGrid(grid);
  const down = (x, z) => ({ origin: [x, 20, z], direction: [0, -1, 0] });
  let p = pickWalkGrid(grid, down(0.3, -2), { nav });
  assert.ok(p && near(p[0], 0.3) && near(p[1], 0) && near(p[2], -2), 'straight down: the ground');
  p = pickWalkGrid(grid, down(3, 0), { nav });
  assert.ok(p && near(p[1], 3), 'a flat top a body fits on is a floor');
  p = pickWalkGrid(grid, down(0, 6), { nav });
  assert.ok(p && near(p[1], 2.7), 'a deck: the top floor');
  p = pickWalkGrid(grid, down(0, 6), { nav, skip: (x, y) => y > 1 });
  assert.ok(p && near(p[1], 0), 'skip(): the floor under what is skipped');
  // a slanted ray over the thin wall's top: the top is a floor (the walker could stand there)
  const ray = new THREE.Ray(new THREE.Vector3(-8, 10, 0.2), new THREE.Vector3(6.5, -10, 0).normalize());
  p = pickWalkGrid(grid, ray, { nav });
  assert.ok(p && near(p[1], 2.5) && p[0] > -3.05 && p[0] < -2.75, 'the wall top');
  // a ray through the wall's body to the ground 0.1 m beside it: the body does not count; without nav the ground
  // there, with nav (a 0.3 m body does not fit against the wall) the march goes on to the first spot that fits
  const beside = { origin: [-8, 10, 0.2], direction: [5.3, -10, 0] };
  p = pickWalkGrid(grid, beside);
  assert.ok(p && near(p[1], 0) && near(p[0], -2.7, 0.01), 'no nav: the ground beside the wall (bisected, 1 cm)');
  p = pickWalkGrid(grid, beside, { nav });
  assert.ok(p && near(p[1], 0) && p[0] > -2.55 && p[0] < -2.3 && nav.fits(p[0], 0, p[2], 0.3), 'nav: the first spot a body fits, not back on the unfit one');
  // a long low ray hits the ground at the right distance (bisection, 10 halvings of a 0.25 m step)
  const flat = pickWalkGrid(grid, { origin: { x: -9, y: 1, z: -5 }, direction: { x: 9, y: -1, z: 0 } }, { nav });
  assert.ok(flat && near(flat[0], 0, 0.01), 'shallow ray: x within 1 cm');
  assert.equal(pickWalkGrid(grid, { origin: [0, 5, 0], direction: [0, 1, 0] }, { nav }), null, 'up into the sky: nothing');
  assert.equal(pickWalkGrid(grid, down(30, 30), { nav }), null, 'off the grid: nothing');

  const from = [0, 0, -4];
  const g0 = reachableGoal(nav, [0.3, 0, -2], { from });
  assert.deepEqual(g0, [0.3, 0, -2], 'reachable: the point itself');
  const roof = reachableGoal(nav, [3, 3, 0], { from });
  assert.ok(roof && near(roof[1], 0) && Math.hypot(roof[0] - 3, roof[2]) <= 3.6 + 0.2 && !inBox(roof[0], roof[2], 2, 4, -1, 1) && nav.findPath(from, roof, { radius: 0.3 }), 'a roof: a ground spot beside the block');
  const deck = reachableGoal(nav, [0, 2.7, 6], { from });
  assert.deepEqual(deck, [0, 0, 6], 'a deck: the floor under it');
  const asked = [];
  const viaAgent = reachableGoal(nav, [3, 3, 0], { from, tryGoal: (q) => { asked.push(q); return q[1] < 1 && asked.length > 3; } });
  assert.ok(viaAgent && asked.length === 4 && asked[0][1] === 3, 'tryGoal decides (the point, then rings)');
  assert.equal(reachableGoal(nav, [3, 3, 0], { from, tryGoal: () => false }), null, 'nothing reachable: null');
  assert.deepEqual(reachableGoal(nav, [3, 3, 0]).length, 3, 'without from: nav.fits (the roof fits a body)');
}

// ---- 8. the index exports the kit ----
for (const k of ['createSpriteActor', 'loadAtlas', 'makeAtlas', 'parseAtlas', 'createSpriteAnim', 'makePlaceholderAtlas', 'spriteDirection', 'drawnDirection', 'createSpriteMaterial', 'createSilhouetteMaterial', 'createIsoCamera', 'pickWalkGrid', 'reachableGoal'])
  assert.equal(typeof index[k], 'function', `@miragekit/play exports ${k}`);
console.log('sprites check: done');

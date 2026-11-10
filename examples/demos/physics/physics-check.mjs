// Check: the physics kit in headless Chrome, in the physics demo packaged as one HTML file.
//   node examples/demos/physics/physics-check.mjs
// 1. the single-file page loads with no errors; every station made its bodies and joints
// 2. joints: the chain hangs, the door stays in its limits, the slider reaches its motor target, the fuse breaks
// 3. water floats wood above stone; the platform carries its box; the explosion throws the stack
// 4. ragdoll: falls, rests, gets up; the gate (a sensor) counts the car
// 5. vehicle: stands on four wheels, drives, and the follow camera stays behind it
// 6. CCD: a 150 m/s ball is stopped by a 4 cm wall, and with ?ccd=0 it is not
// 7. debug draw adds lines to the picture and takes them out again; snapshot + N steps reproduces the hash
// 8. ?physics=0: the yard with no Rapier world
// 9. step time in this browser for ?boxes=500 and 2000 (reported, not judged)
// Writes out/physics-check.json and out/physics-*.png.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..'), out = path.join(here, 'out');
const checks = [], report = {};
const ok = (k, cond, v) => { checks.push({ k, ok: !!cond, v }); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${k}${v !== undefined ? ': ' + (typeof v === 'string' ? v : JSON.stringify(v)) : ''}`); };
const f = (v) => +v.toFixed(3);
fs.mkdirSync(out, { recursive: true });
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', path.join(out, 'physics.html')], { stdio: 'inherit' });
report.htmlBytes = fs.statSync(path.join(out, 'physics.html')).size;
const srv = await serve(out), b = await launch({ w: 1280, h: 720 });
const load = async (q) => { const o = await open(b, srv.url + 'physics.html?w=1280&h=720&ui=0&grain=0&' + q); await o.page.evaluate(() => window.__mirage.stop()); return o; };
const shot = async (page, name) => { const d = await page.evaluate(() => { const m = window.__mirage; m.render(); return m.world.renderer.domElement.toDataURL(); }); fs.writeFileSync(path.join(out, name), Buffer.from(d.split(',')[1], 'base64')); return d; };
const diff = (page, a, b2) => page.evaluate(async (a, b2) => {
  const px = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const A = await px(a), B = await px(b2); let s = 0; for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]); return s / A.length;
}, a, b2);

try {
  const { page, errors } = await load('');
  const st0 = await page.evaluate(() => window.__mirage.S.kit.stats());
  ok('page loads without errors', errors.length === 0, errors.slice(0, 3));
  ok('every station is there', st0.dynamic >= 50 && st0.joints >= 20, { bodies: st0.bodies, dynamic: st0.dynamic, colliders: st0.colliders, joints: st0.joints });

  // 2, 3: five seconds of the yard
  const five = await page.evaluate(() => {
    const m = window.__mirage, S = m.S; let doorMax = 0;
    for (let i = 0; i < 300; i++) { m.step(1); doorMax = Math.max(doorMax, Math.abs(S.door.angle)); }
    const by = (n) => [...S.kit.bodies.values()].filter((x) => x.obj && x.obj.position && n(x));
    const links = [...S.joints.all.values()].filter((j) => j.type === 'ball' && !j.name).map((j) => j.bodyB.translation().y);
    const pool = by((x) => x.pos[0] > 6 && x.pos[0] < 12 && x.pos[2] > -12 && x.pos[2] < -6).map((x) => [x.type, +x.pos[1].toFixed(3), +x.mass.toFixed(1)]);
    const lift = S.lift.pos, rider = by((x) => x.type === 'dynamic' && Math.hypot(x.pos[0] - lift[0], x.pos[2] - lift[2]) < 1.2 && x.pos[1] > lift[1])[0];
    return { doorMax, slider: S.slider.travel, lowest: Math.min(...links), fuse: S.fuse.alive, broke: S.broke, pool, lift, rider: rider ? rider.pos : null, worst: S.worst, stats: S.kit.stats() };
  });
  report.five = five;
  ok('chain: six links hang from the beam (lowest link, m)', five.lowest > 0.4 && five.lowest < 1.2, f(five.lowest));
  ok('hinge: the motor swings the door inside its limits of 1.2 rad (give 0.1)', five.doorMax > 0.8 && five.doorMax < 1.3, f(five.doorMax));
  ok('slider: the position motor holds 1.2 m (give 0.15)', Math.abs(five.slider - 1.2) < 0.15, f(five.slider));
  ok('breakable joint: the 60 kg weight broke the 400 N fuse', five.fuse === false && five.broke === 1, { alive: five.fuse, breaks: five.broke });
  const ys = five.pool.map((p) => p[1]).sort((x, y) => x - y);
  ok('water: three bodies in the pool, the lightest floats at the surface and the heaviest lies on the bottom', five.pool.length === 3 && ys[2] > 0.75 && ys[0] < 0.4, five.pool);
  ok('platform: its box is still on it, above the ground', five.rider && five.rider[1] > five.lift[1] && five.lift[1] > 0.5, { lift: five.lift.map(f), box: five.rider && five.rider.map(f) });
  ok('contact events carry an impulse (hardest hit so far, N s)', five.worst > 5, f(five.worst));
  report.shots = { yard: (await shot(page, 'physics-yard.png')).length };

  // 7a: debug draw
  const plain = await shot(page, 'physics-plain.png');
  const dbg = await page.evaluate(() => { const m = window.__mirage; m.S.act.debug(); m.S.dbg.update(); return { counts: m.S.dbg.counts, text: m.S.dbg.text(), inScene: !!m.world.scene.getObjectByName('physics-debug') }; });
  const drawn = await shot(page, 'physics-debug.png');
  const dd = await diff(page, plain, drawn);
  await page.evaluate(() => { const m = window.__mirage; m.S.dbg.dispose(); m.S.dbg = null; });
  const after = await shot(page, 'physics-plain2.png'), back = await diff(page, plain, after);
  report.debug = { ...dbg, diff: dd, back };
  ok('debug draw: collider lines, joints and a stats line', dbg.counts.lines > 500 && dbg.counts.joints >= 15 && /bodies \d+/.test(dbg.text) && dbg.inScene, { ...dbg.counts, text: dbg.text });
  ok('debug draw changes the picture, and disposed leaves it as it was (mean abs diff of 255)', dd > 0.3 && back < 0.05, { on: f(dd), off: f(back) });

  // 3: explosion
  const boom = await page.evaluate(() => { const m = window.__mirage, hits = m.S.act.boom(); m.step(30); return { hits: hits.length, top: Math.max(...hits.map((h) => h.impulse)), awake: m.S.kit.stats().awake }; });
  ok('explosion: bodies in range get an impulse and wake', boom.hits > 10 && boom.top > 20 && boom.awake > 10, boom);

  // 4: ragdoll
  const rag = await page.evaluate(() => {
    const m = window.__mirage, r = m.S.rags[0], head = () => r.rig.bones.Head.getWorldPosition(new m.THREE.Vector3()).y, o = { stand: head(), mode0: r.rag.mode };
    m.S.act.ragdoll(); m.step(360); Object.assign(o, { mode1: r.rag.mode, down: head(), rest: r.rag.atRest, lying: r.rag.pose().lying });
    m.S.act.ragdoll(); m.step(20); o.mid = head(); m.step(60); Object.assign(o, { up: head(), mode2: r.rag.mode });
    m.S.act.limp(); m.step(60); o.mode3 = r.rag.mode; m.S.act.limp(); m.step(60); o.mode4 = r.rag.mode;
    return o;
  });
  report.ragdoll = rag;
  ok('ragdoll: animated, then falls and lies still', rag.mode0 === 'animated' && rag.mode1 === 'ragdoll' && rag.down < 0.5 && rag.rest && rag.lying, { standing: f(rag.stand), fallen: f(rag.down), atRest: rag.rest });
  ok('get up: blends back to the animation where it lay', rag.mode2 === 'animated' && rag.up > 1.35 && rag.mid < rag.up, { half: f(rag.mid), up: f(rag.up) });
  ok('partial: a limp arm on and off', rag.mode3 === 'partial' && rag.mode4 === 'animated', [rag.mode3, rag.mode4]);

  // 5: the car
  const car = await page.evaluate(() => {
    const m = window.__mirage, S = m.S, c = S.car, o = { grounded0: c.grounded, y0: c.body.pos[1] };
    addEventListener('keydown', () => {}); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); m.step(180); o.speed = c.speed; o.z = c.body.pos[2];
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })); m.step(60); o.yaw = Math.atan2(...(() => { const f = new m.THREE.Vector3(0, 0, 1).applyQuaternion(c.obj.quaternion); return [f.x, f.z]; })());
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    m.cam.follow = true; m.render(); for (let i = 0; i < 45; i++) { m.step(1); m.render({ dt: 1 / 60 }); }
    const fw = new m.THREE.Vector3(0, 0, 1).applyQuaternion(c.obj.quaternion), to = c.obj.position.clone().sub(m.world.camera.position);
    o.camDist = to.length(); o.behind = to.normalize().dot(fw); o.grounded = c.grounded;
    const before = S.gate.count; c.place([0, 1, 9]); m.step(20); o.gate = [before, S.gate.count];
    return o;
  });
  report.car = car;
  ok('vehicle: rests on four wheels', car.grounded0 === 4 && car.y0 > 0.4 && car.y0 < 1, { wheels: car.grounded0, y: f(car.y0) });
  ok('vehicle: W for 3 s drives it forward (m/s), D turns it', car.speed > 8 && car.z < -12 && Math.abs(Math.abs(car.yaw) - Math.PI) > 0.15, { speed: f(car.speed), z: f(car.z), yaw: f(car.yaw) });
  ok('follow camera: behind the car, looking along its heading', car.camDist > 4 && car.camDist < 14 && car.behind > 0.6, { distance: f(car.camDist), along: f(car.behind) });
  ok('sensor: the gate counts the car when it stands in it', car.gate[1] > car.gate[0], car.gate);
  report.shots.car = (await shot(page, 'physics-car.png')).length;

  // 6: CCD
  const fire = (p) => p.evaluate(() => { const m = window.__mirage, bl = m.S.act.shoot(); m.step(30); return bl.pos; });
  const stopped = await fire(page);
  ok('CCD: a 150 m/s ball is stopped by the 4 cm wall (z of the ball; the wall is at -9)', stopped[2] > -9, f(stopped[2]));
  await page.close();
  { const o = await load('show=stack&ccd=0'); const through = await fire(o.page);
    ok('?ccd=0: the same ball is through the wall', through[2] < -9.5 && o.errors.length === 0, f(through[2])); await o.page.close(); }

  // 7b: snapshot, N steps, restore, N steps
  { const o = await load('show=stack,joints,water,platform');
    const h = await o.page.evaluate(() => { const m = window.__mirage, S = m.S; m.step(150); const snap = S.phys.snapshot(), t = S.time; S.act.boom(); m.step(120); const a = S.kit.hash(); S.phys.restore(snap); S.time = t; S.act.boom(); m.step(120); return [a, S.kit.hash(), S.kit.stats().bodies]; });
    report.determinism = h;
    ok('restore + the same explosion + 120 steps ends on the same state hash', h[0] === h[1] && o.errors.length === 0, h); await o.page.close(); }

  // 8: physics off
  { const o = await load('physics=0');
    const s = await o.page.evaluate(() => ({ kit: window.__mirage.S.kit, text: window.__mirage.text() }));
    ok('?physics=0: the yard alone, no errors', s.kit === null && o.errors.length === 0, s.text); await o.page.close(); }

  // 9: step time here
  report.stepMs = {};
  for (const n of [500, 2000]) {
    const o = await load('show=stack&boxes=' + n);
    report.stepMs[n] = await o.page.evaluate(() => { const m = window.__mirage, t = []; m.S.act.boom(); for (let i = 0; i < 240; i++) { m.step(1); t.push(m.S.kit.stats().stepMs); } t.sort((a, b) => a - b); return { median: +t[120].toFixed(2), p95: +t[228].toFixed(2), max: +t[239].toFixed(2), bodies: m.S.kit.stats().dynamic }; });
    console.log(`  step time, ${n} boxes after an explosion, 240 steps: ${JSON.stringify(report.stepMs[n])}`);
    await o.page.close();
  }
} finally { await b.close(); srv.close(); }

report.checks = checks;
fs.writeFileSync(path.join(out, 'physics-check.json'), JSON.stringify(report, null, 2));
const bad = checks.filter((c) => !c.ok);
console.log(bad.length ? `physics check: ${bad.length} FAILED` : `physics check: ok (${checks.length} checks)`);
process.exit(bad.length ? 1 : 0);

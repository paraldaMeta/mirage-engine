// Check: the character mover and the navigation stack in the browser, in the charnav demo packaged as one HTML file.
//   node examples/demos/charnav/charnav-check.mjs
// 1. the single-file page loads with no errors (Rapier inlined), 240 agents and a guard
// 2. the lift carries the player up to the deck; the turntable turns it; the camera turns with the turntable
// 3. the door: shut it blocks the player and the paths go round the wall; open, both go through
// 4. a crate walked into moves, and its Rapier body and its solid are in the same place (the one rule)
// 5. the crowd for 10 s: nobody inside anybody (deepest overlap), most agents travel; ms per step
// 6. the guard sees the player in the fenced yard, crosses the jump link and reaches it
// 7. the spring arm shortens with a wall behind; first person sits at the eye
// 8. debug draw changes the picture; ?physics=0 loads and the lift still carries
// Writes out/charnav-check.json and out/charnav-*.png.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..'), out = path.join(here, 'out');
const checks = [], report = {};
const ok = (k, cond, v) => { checks.push({ k, ok: !!cond, v }); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${k}${v !== undefined ? ': ' + (typeof v === 'string' ? v : JSON.stringify(v)) : ''}`); };
fs.mkdirSync(out, { recursive: true });
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', path.join(out, 'charnav.html')], { stdio: 'inherit' });
report.htmlBytes = fs.statSync(path.join(out, 'charnav.html')).size;
const srv = await serve(out), b = await launch({ w: 1280, h: 720 });
const page0 = (q) => open(b, srv.url + 'charnav.html?w=1280&h=720&ui=0&grain=0&door=manual&' + q);
const shot = async (page, name) => { const d = await page.evaluate(() => window.__mirage.world.renderer.domElement.toDataURL()); fs.writeFileSync(path.join(out, name), Buffer.from(d.split(',')[1], 'base64')); return d; };
const diff = (page, a, b2) => page.evaluate(async (a, b2) => {
  const px = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const A = await px(a), B = await px(b2); let s = 0; for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]); return s / A.length;
}, a, b2);
const r2 = (v) => +v.toFixed(3);

try {
  const { page, errors } = await page0('');
  // frames while the page runs itself (a shared, software-or-not GPU: reported, not judged)
  report.fps = await page.evaluate(async () => { const s = window.__mirage.stats, f0 = s.frames, t0 = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return +((s.frames - f0) / ((performance.now() - t0) / 1000)).toFixed(1); });
  await page.evaluate(() => window.__mirage.stop());
  const info = await page.evaluate(() => { const m = window.__mirage; return { agents: m.N, crowd: m.crowd.count, solids: m.space.solids.size, physics: !!m.phys, link: !!m.jump, nodes: m.nav.nodes, navMs: +m.nav.ms.toFixed(1) }; });
  report.info = info;
  ok('page loads without errors', errors.length === 0, errors.slice(0, 3));
  ok('240 agents, a guard, the player; six solids mirrored into Rapier; the jump link exists', info.agents === 240 && info.crowd === 242 && info.solids === 6 && info.physics && info.link, info);
  await page.evaluate(() => window.__mirage.render());
  report.overview = (await shot(page, 'charnav-start.png')).length;

  // 2. lift and turntable
  const lift = await page.evaluate(() => {
    const m = window.__mirage, w = m.mover;
    while (Math.abs((m.time % 12) - 10.5) > 0.02) m.step(1);   // the lift is down, and stays for 1.5 s
    w.place([-8.3, 0.3, 4]); m.step(30);
    const on = w.ground && w.ground.name, y0 = w.pos[1];
    m.step(360);                                               // 6 s on: up and waiting
    const top = w.pos[1], still = w.ground && w.ground.name;
    m.step(50, { x: -1, z: 0, run: true });                    // walk off onto the deck
    return { on, y0, top, still, deckX: w.pos[0], deckY: w.pos[1], after: w.ground ? w.ground.name : null, mode: w.mode };
  });
  report.lift = lift;
  ok('the lift carries the player 2.4 m up and it walks off onto the deck', lift.on === 'lift' && Math.abs(lift.y0 - 0.2) < 0.05 && Math.abs(lift.top - 2.6) < 0.05 && lift.deckX < -9.8 && Math.abs(lift.deckY - 2.6) < 0.05 && lift.after === null, lift);
  const turn = await page.evaluate(() => {
    const m = window.__mirage, w = m.mover;
    w.place([-6.5, 0.3, -7]); m.step(20); m.cam.yaw = 0; m.present(1 / 60);
    const a0 = Math.atan2(w.pos[2] + 7, w.pos[0] + 8), yaw0 = m.cam.yaw;
    for (let i = 0; i < 60; i++) { m.step(1); m.present(1 / 60); }
    const a1 = Math.atan2(w.pos[2] + 7, w.pos[0] + 8);
    return { on: w.ground && w.ground.name, turned: a1 - a0, r: Math.hypot(w.pos[0] + 8, w.pos[2] + 7), camTurned: m.cam.yaw - yaw0, mode: w.mode };
  });
  report.turntable = turn;
  // the solid's yaw is three's rotation.y: +0.6 rad/s turns x towards -z, so atan2(z, x) falls by 0.6 in a second
  ok('the turntable turns the player (0.6 rad in 1 s, radius kept) and the camera with it', turn.on === 'turntable' && Math.abs(Math.abs(turn.turned) - 0.6) < 0.03 && Math.abs(turn.r - 1.5) < 0.05 && Math.abs(Math.abs(turn.camTurned) - 0.6) < 0.03, turn);

  // 3. the door
  const door = await page.evaluate(() => {
    const m = window.__mirage, w = m.mover, len = (p) => { if (!p) return null; let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]); return s; };
    const A = [0.5, 0, -10.2], B = [6, 0, -10.2];
    m.setDoor(false); m.step(70);
    const shutPath = len(m.nav.findPath(A, B));
    w.place([1.5, 0, -10.2]); m.step(150, { x: 1, z: 0, run: true });
    const shutX = w.pos[0], v0 = m.nav.version;
    m.setDoor(true); m.step(70);
    const openPath = len(m.nav.findPath(A, B)), reblocks = m.nav.version - v0;
    w.place([1.5, 0, -10.2]); m.step(150, { x: 1, z: 0, run: true });
    const openX = w.pos[0];
    m.setDoor(false); m.step(70);
    return { shutPath, openPath, shutX, openX, reblocks, carveMs: m.carve.stats.ms };
  });
  report.door = door;
  ok('door shut: the player stops at it and the path goes round the wall; open: both go through', door.shutX < 2.95 && door.openX > 4 && door.shutPath > 10 && door.openPath < 6.5 && door.reblocks > 0, door);

  // 4. a crate
  const crate = await page.evaluate(() => {
    const m = window.__mirage, w = m.mover, c = m.crates[0], z0 = c.pos[2];
    w.place([1, 0, 7.6]); m.step(120, { x: 0, z: -1, run: true });
    m.step(60);
    const t = m.link.body(c).translation();
    return { pushed: z0 - c.pos[2], gap: Math.hypot(t.x - c.pos[0], t.y - c.pos[1], t.z - c.pos[2]), playerZ: w.pos[2], crateZ: c.pos[2], crateY: c.pos[1] };
  });
  report.crate = crate;
  ok('walking into a crate pushes it; Rapier body and solid agree; the player stays outside it', crate.pushed > 0.3 && crate.gap < 1e-6 && crate.playerZ - crate.crateZ > 0.6 && Math.abs(crate.crateY - 0.4) < 0.05, crate);

  // 5. the crowd, 10 s
  const crowd = await page.evaluate(() => {
    const m = window.__mirage, c = m.crowd, N = m.N, w = m.mover;
    w.place([18, 0, 18]);
    const x0 = Float64Array.from(c.x.subarray(0, N)), z0 = Float64Array.from(c.z.subarray(0, N));
    const s = m.stats, ms0 = s.crowdMs, st0 = s.steps;
    let deep = 0, sum = 0, samples = 0;
    for (let k = 0; k < 600; k++) {
      m.step(1);
      if (k % 20 === 19) for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const d = Math.hypot(c.x[i] - c.x[j], c.z[i] - c.z[j]) - c.radius[i] - c.radius[j];
        if (Math.abs(c.y[i] - c.y[j]) < 1 && d < 0) { deep = Math.max(deep, -d); sum -= d; samples++; }
      }
    }
    let moved = 0; for (let i = 0; i < N; i++) if (Math.hypot(c.x[i] - x0[i], c.z[i] - z0[i]) > 1) moved++;
    return { deepest: deep, overlapping: samples, moved, msPerStep: (s.crowdMs - ms0) / (s.steps - st0), pathQueue: c.queue.pending, moverUs: (s.moverMs / s.steps) * 1000, physMs: s.physMs / s.steps, carveMs: s.carveMs / s.steps };
  });
  report.crowd = Object.fromEntries(Object.entries(crowd).map(([k, v]) => [k, r2(v)]));
  ok('240 agents for 10 s: deepest overlap under 6 cm, over 200 travelled more than a metre', crowd.deepest < 0.06 && crowd.moved > 200, report.crowd);
  await page.evaluate(() => { const m = window.__mirage; m.mover.place([-2, 0, -12]); m.cam.yaw = -1.2; m.cam.pitch = 0.5; for (let i = 0; i < 40; i++) { m.step(1); m.present(1 / 60); } m.render(); });
  await shot(page, 'charnav-crowd.png');

  // 6. the guard over the fence
  const chase = await page.evaluate(() => {
    const m = window.__mirage, c = m.crowd, w = m.mover, g = m.gi;
    w.place([10, 0, 10]); m.stats.linkEvents.length = 0; const c0 = m.stats.catches;
    let n = 0, sawTarget = false, onLink = false, near = 1e9;
    for (; n < 3600; n++) {
      m.step(1);
      if (m.brain.blackboard.get('target')) sawTarget = true;
      if (c.state[g] === 5) onLink = true;
      near = Math.min(near, Math.hypot(c.x[g] - w.pos[0], c.z[g] - w.pos[2]));
      if (m.stats.catches > c0 || near < 1) break;
    }
    return { seconds: n / 60, sawTarget, onLink, events: m.stats.linkEvents.slice(), near, guard: [c.x[g], c.z[g]], catches: m.stats.catches - c0, active: m.brain.active() };
  });
  report.chase = chase;
  ok('the guard sees the player in the yard, crosses the jump link and reaches it', chase.sawTarget && chase.onLink && chase.events[0] === 'start' && chase.events.includes('end') && chase.near < 1.2 && chase.guard[1] > 6, chase);
  await page.evaluate(() => { const m = window.__mirage; m.cam.yaw = 0.6; m.cam.pitch = 0.35; for (let i = 0; i < 40; i++) m.present(1 / 60); m.render(); });
  await shot(page, 'charnav-chase.png');

  // 7. cameras
  const cams = await page.evaluate(() => {
    const m = window.__mirage, w = m.mover, cam = m.cam;
    w.place([-2, 0, 14]); m.step(10); cam.yaw = Math.PI / 2; cam.pitch = 0.2; for (let i = 0; i < 120; i++) m.present(1 / 60);
    const open = cam.arm;
    w.place([2.2, 0, -6]); m.step(10); for (let i = 0; i < 120; i++) m.present(1 / 60);   // the wall is 0.65 m behind
    const wall = cam.arm, camX = cam.position[0];
    cam.mode = 'first'; m.present(1 / 60);
    const eye = cam.position[1] - w.pos[1], dx = Math.hypot(cam.position[0] - w.pos[0], cam.position[2] - w.pos[2]);
    m.step(40, { crouch: true }); for (let i = 0; i < 60; i++) m.present(1 / 60);
    const crouchEye = cam.position[1] - w.pos[1], mode = w.mode;
    cam.mode = 'third';
    return { open, wall, camX, eye, dx, crouchEye, mode };
  });
  report.camera = cams;
  ok('spring arm: full boom in the open, short with a wall behind (camera this side of it); first person at the eye, lower crouched',
    Math.abs(cams.open - 4.5) < 0.05 && cams.wall < 1 && cams.camX < 2.85 && Math.abs(cams.eye - 1.62) < 0.02 && cams.dx < 0.01 && cams.crouchEye < 1.1 && cams.mode === 'crouch', cams);

  // 8. debug draw
  const pic = async (dbg) => { await page.evaluate((dbg) => { const m = window.__mirage; m.setDebug(dbg); m.cam.yaw = 0.3; m.cam.pitch = 0.6; m.mover.place([8, 0, 0]); m.step(1); for (let i = 0; i < 120; i++) m.present(1 / 60); m.render(); }, dbg); return shot(page, dbg ? 'charnav-debug.png' : 'charnav-plain.png'); };
  const plain = await pic(false), dbg = await pic(true);
  const tree = await page.evaluate(() => document.querySelector('#tree').textContent);
  report.debug = { diff: r2(await diff(page, plain, dbg)), tree: tree.split('\n').length };
  ok('debug draw: the picture changes and the tree is written', report.debug.diff > 1 && report.debug.tree > 4 && errors.length === 0, { ...report.debug, errors: errors.slice(0, 2) });
  await page.close();

  { const o = await page0('physics=0&agents=40');
    const r = await o.page.evaluate(() => { const m = window.__mirage, w = m.mover; m.stop(); while (Math.abs((m.time % 12) - 10.5) > 0.02) m.step(1); w.place([-8.3, 0.3, 4]); m.step(390); return { phys: !!m.phys, y: w.pos[1], agents: m.N, crate: m.crates[0].kind }; });
    report.noPhysics = r;
    ok('?physics=0&agents=40: no Rapier, the lift still carries', !r.phys && Math.abs(r.y - 2.6) < 0.05 && r.agents === 40 && o.errors.length === 0, { ...r, errors: o.errors.slice(0, 2) }); await o.page.close(); }
} finally { await b.close(); srv.close(); }

const bad = checks.filter((c) => !c.ok);
report.checks = checks; report.pass = bad.length === 0;
fs.writeFileSync(path.join(out, 'charnav-check.json'), JSON.stringify(report, null, 2));
console.log(bad.length ? `charnav check: ${bad.length} FAILED` : `charnav check: ok (${checks.length})`);
process.exit(bad.length ? 1 : 0);

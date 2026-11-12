#!/usr/bin/env node
// The robots' motion in the game: gait numbers per type and picture strips. Each biped type (sentinel, warden,
// shield, marksman) alone on the plaza (the rest parked, nobody sees the player), walked at a patrol's 1.3 m/s, run at
// its fight speed, turned on the spot, hit from the front, killed from the front; the civilian walkers on their loop;
// a hound trotting. Every 1/60 s step the soles are sampled (heel, ball, toe tip, as the experiment's
// gait-metrics.js), with the walk grid's ground under each:
//   planted   the lowest sole point within 2 cm of the ground under it      slide  its horizontal speed then (cm/s)
//   locked    planted steps sliding under 10 cm/s                           knee   thigh-shin angle (deg)
//   bob       the hips' height range over the walk (cm)                      sink   the deepest sole point under the ground (cm)
// Works on builds before the borrowed motion too (it only reads bones and instance matrices), for before / after.
//   node scripts/anim-check.mjs [dist] [--out out/anim] [--tag after] [--no-strips]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !args[i - 1].startsWith('--no'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/anim'))), TAG = flag('tag', 'after'), STRIPS = !args.includes('--no-strips'), W = 1280, H = 720;
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(dist), b = await launch({ w: W, h: H });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&hud=0&quality=medium&time=day&lang=en&fullscreen=0`, { timeout: 150000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(({ W, H }) => {
  const m = window.__mirage, G = m.game, E = G.enemies, play = m.play, V = (a) => new a.constructor().copy(a);
  play.stop();
  E.env.blind = () => true;
  for (const e of E.list) E.park(e);
  for (const d of G.drones.list) G.drones.park(d);
  const keep = () => { G.player.hp = 100; G.player.dead = false; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { keep(); play.step(1 / 60); } };
  const grid = () => play.grid;
  const ground = (p) => { const g = grid().groundAt(p.x, p.z, p.y + 0.3, 0.5); return Number.isNaN(g) ? null : g; };
  // sole points: [bone, offset in its frame] (the rig's foot: heel 7 cm behind the ankle, the toe joint's ball and tip)
  const SOLE = [['Foot', [0, -0.08, -0.07]], ['Toe', [0, -0.02, 0]], ['Toe', [0, -0.02, 0.07]]];
  const civSole = [[0, -0.08, -0.07], [0, -0.08, 0.13], [0, -0.08, 0.2]];
  const v3 = () => new (m.world.camera.position.constructor)();
  const M4 = new (m.world.camera.matrixWorld.constructor)();
  /** one sample of a biped: per side the sole points and the ground under each, the knee angle; the hips' height */
  const sampleRig = (e) => {
    e.rig.root.updateMatrixWorld(true);
    const B = e.rig.bones, out = { feet: [], knee: [], hipY: B.Hips.getWorldPosition(v3()).y - e.rig.root.position.y };
    for (const S of ['Left', 'Right']) {
      out.feet.push(SOLE.map(([bn, o]) => { const p = v3().set(...o).applyMatrix4(B[S + bn].matrixWorld); return [p.x, p.y, p.z, ground(p) ?? e.pos[1]]; }));
      const a = B[S + 'UpLeg'].getWorldPosition(v3()), k = B[S + 'Leg'].getWorldPosition(v3()), f = B[S + 'Foot'].getWorldPosition(v3());
      out.knee.push(k.clone().sub(a).angleTo(f.clone().sub(k)) * 57.2958);
    }
    return out;
  };
  const machines = m.world.scene.getObjectByName('machines'), S = machines.userData.batches.shell, units = machines.userData.units();
  const sampleCiv = (u) => {
    const out = { feet: [], knee: [], hipY: 0 };
    const seg = (i) => { S.getMatrixAt(u.shell[i], M4); return V(M4); };
    const hip = v3().setFromMatrixPosition(seg(0)); out.hipY = hip.y;
    for (const [up, kn, ft] of [[11, 12, 13], [14, 15, 16]]) {
      const F = seg(ft);
      out.feet.push(civSole.map((o) => { const p = v3().set(...o).applyMatrix4(F); return [p.x, p.y, p.z, ground(p) ?? 0]; }));
      const a = v3().setFromMatrixPosition(seg(up)), k = v3().setFromMatrixPosition(seg(kn)), f = v3().setFromMatrixPosition(F);
      out.knee.push(k.clone().sub(a).angleTo(f.clone().sub(k)) * 57.2958);
    }
    return out;
  };
  /** a subject: robot `id` revived at `at` facing `yaw`, not on patrol, not drawn toward the player */
  const subject = (id, at, yaw) => {
    for (const e of E.list) E.park(e);
    const e = E.list.find((x) => x.id === id);
    e.drill = true; e.def = { ...e.def, patrol: null };
    E.revive(e, at); e.yaw = yaw; e.heading[0] = Math.sin(yaw); e.heading[1] = Math.cos(yaw); e.state = 'post';
    step(30);
    return e;
  };
  const go = (e, to, speed) => { e.agent.speed = e.agent.walker.body.walk = e.agent.walker.body.run = speed; e.agent.setGoal(E.nav.nearest(to, { snap: 2 }) || to); };
  // pictures: a fixed camera beside the subject; each tile cut round its hips
  const tiles = [];
  const vm = m.world.scene.getObjectByName('viewmodel');
  // T: draw at that scene time (the civilians run on the scene clock, which play.step does not advance)
  // follow: [yaw, side, ahead] puts the camera beside it again for this tile (a few frames, so the AA settles)
  const shoot = (where, T = null, follow = null) => {
    const c = m.world.camera, p = where();
    if (vm) vm.visible = false;
    const draw = () => (T === null ? play.render({ moving: true }) : m.world.renderFrame(T, { camera: c, taa: true }));
    if (follow) { camAt(p, ...follow); draw(); draw(); draw(); }
    draw();
    c.updateMatrixWorld(); const s = v3().set(p[0], p[1] + 0.85, p[2]).project(c);
    const cx = (s.x * 0.5 + 0.5) * W, cy = (1 - (s.y * 0.5 + 0.5)) * H, tw = 240, th = 330;
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(document.querySelector('canvas'), cx - tw / 2, cy - th / 2, tw, th, 0, 0, tw, th);
    tiles.push(t);
  };
  const camAt = (p, yaw, side = 3.6, ahead = 0.6) => {
    // the camera on the subject's right, a little ahead, looking at it
    const lx = -Math.cos(yaw), lz = Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
    play.place([p[0] + lx * side + fx * ahead, p[1] + 1.1, p[2] + lz * side + fz * ahead], [p[0] + fx * ahead, p[1] + 0.85, p[2] + fz * ahead], 'fly');
  };
  const strip = (label) => {
    const c = document.createElement('canvas'), n = tiles.length; c.width = 240 * n; c.height = 330;
    const g = c.getContext('2d'); tiles.forEach((t, i) => g.drawImage(t, i * 240, 0));
    g.font = '15px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(label, 8, 20); g.fillText(label, 8, 20);
    tiles.length = 0;
    return c.toDataURL('image/png');
  };
  window.__an = { m, G, E, step, subject, go, sampleRig, sampleCiv, units, shoot, camAt, strip };
}, { W, H });

// ---- numbers from samples
function gait(samples, dt = 1 / 60) {
  const slides = [];
  let planted = 0, n = 0, sink = 0;
  for (let i = 1; i < samples.length; i++) for (let s = 0; s < 2; s++) {
    const a = samples[i - 1].feet[s], c = samples[i].feet[s];
    const low = (f) => f.reduce((m, p, j) => (p[1] - p[3] < f[m][1] - f[m][3] ? j : m), 0);
    const j = low(c), pc = c[j], pa = a[j];
    sink = Math.min(sink, pc[1] - pc[3]);
    n++;
    if (pc[1] - pc[3] > 0.02 || pa[1] - pa[3] > 0.02 + 0.0) continue;
    planted++;
    slides.push(Math.hypot(pc[0] - pa[0], pc[2] - pa[2]) / dt * 100);
  }
  slides.sort((x, y) => x - y);
  const knees = samples.flatMap((x) => x.knee), hy = samples.map((x) => x.hipY);
  const r1 = (x) => +x.toFixed(1);
  return { slideMedian: r1(slides[slides.length >> 1] ?? 0), slideMean: r1(slides.reduce((x, y) => x + y, 0) / Math.max(1, slides.length)), slideP90: r1(slides[Math.floor(slides.length * 0.9)] ?? 0),
    locked: +(slides.filter((x) => x < 10).length / Math.max(1, slides.length)).toFixed(2), planted: +(planted / Math.max(1, n)).toFixed(2),
    knee: [r1(Math.min(...knees)), r1(Math.max(...knees))], bobCm: r1((Math.max(...hy) - Math.min(...hy)) * 100), sinkCm: r1(sink * 100) };
}

const report = {};
const save = (name, url) => { if (!url) return; fs.writeFileSync(path.join(OUT, `${TAG}-${name}.png`), Buffer.from(url.split(',')[1], 'base64')); };
// the plaza's patrol line (g5's): open ground on the kerb level, x 10, z -6 .. -16
const A = [10, 0.14, -6.5], Bp = [10, 0.14, -17];
for (const [type, id] of [['sentinel', 'g5'], ['warden', 'g3'], ['shield', 'g11'], ['marksman', 'g12']]) {
  const r = await page.evaluate(async ({ id, A, Bp, STRIPS }) => {
    const { E, step, subject, go, sampleRig, shoot, camAt, strip } = window.__an, out = {}, pics = {};
    const yaw = Math.PI;   // toward -z
    for (const [mode, speed] of [['walk', 1.3], ['run', 0]]) {
      const e = subject(id, A, yaw);
      camAt([A[0], A[1], (A[2] + Bp[2]) / 2], yaw, 5, 0);   // the viewer near (the near level of detail: the feet solved)
      go(e, Bp, speed || e.K.speed);
      step(45);   // up to speed
      const smp = []; for (let i = 0; i < 100; i++) { step(); smp.push(sampleRig(e)); }
      out[mode] = { samples: smp, speed: e.speed };
      if (STRIPS) {
        const e2 = subject(id, A, yaw); go(e2, Bp, speed || e2.K.speed); step(45);
        camAt(e2.pos, yaw, 3.8, 0.9);
        const cyc = mode === 'walk' ? 72 : 36;
        for (let k = 0; k < 8; k++) { step(Math.round(cyc / 8)); shoot(() => e2.pos, null, [yaw, 3.8, 0]); }
        pics[mode] = strip(`${id} ${mode} ${e2.speed.toFixed(2)} m/s`);
      }
    }
    // turn on the spot: 150 degrees toward a point behind its left shoulder
    {
      const e = subject(id, A, yaw);
      camAt(e.pos, yaw, 3.6, 0);
      e.state = 'alert'; e.t = 0; e.wait = 99; e.lastSeen = [A[0] - 3, A[1], A[2] + 3 * Math.tan(1.0)];
      const smp = [];
      for (let k = 0; k < 8; k++) { for (let i = 0; i < 6; i++) { step(); smp.push(sampleRig(e)); } if (STRIPS) shoot(() => e.pos); }
      for (let i = 0; i < 40; i++) { step(); smp.push(sampleRig(e)); }
      out.turn = { samples: smp };
      if (STRIPS) pics.turn = strip(`${id} turn on the spot`);
    }
    // hit from the front in the chest (a carbine round), then killed from the front
    for (const what of ['hit', 'death']) {
      const e = subject(id, A, yaw);
      camAt(e.pos, yaw, 3.6, 0);
      e.hp = what === 'hit' ? 9999 : 10;
      const f = [Math.sin(yaw), Math.cos(yaw)], pt = [e.pos[0] + f[0] * 0.25, e.pos[1] + 1.25 * e.K.scale, e.pos[2] + f[1] * 0.25];
      E.damage(e, 22, false, pt, [-f[0], 0, -f[1]], {});
      const smp = [];
      const per = what === 'hit' ? 3 : 12;
      for (let k = 0; k < 8; k++) { for (let i = 0; i < per; i++) { step(); smp.push(sampleRig(e)); } if (STRIPS) shoot(() => [e.pos[0], e.pos[1] - (what === 'death' ? 0.4 : 0), e.pos[2]]); }
      if (what === 'death') { step(60); const s = sampleRig(e); e.rig.root.updateMatrixWorld(true); let low = 9; e.rig.root.traverse((o) => { if (o.isBone) { const p = o.getWorldPosition(new (o.position.constructor)()); low = Math.min(low, p.y - e.pos[1]); } }); out.rest = { lowestJointCm: +(low * 100).toFixed(1), hipY: +s.hipY.toFixed(3) }; }
      if (STRIPS) pics[what] = strip(`${id} ${what === 'hit' ? 'hit in the chest from the front' : 'killed from the front'}`);
    }
    return { out, pics };
  }, { id, A, Bp, STRIPS });
  report[type] = { walk: { speed: +r.out.walk.speed.toFixed(2), ...gait(r.out.walk.samples) }, run: { speed: +r.out.run.speed.toFixed(2), ...gait(r.out.run.samples) }, turn: gait(r.out.turn.samples), rest: r.out.rest };
  for (const [k, u] of Object.entries(r.pics)) save(`${type}-${k}`, u);
  console.log(type, JSON.stringify(report[type]));
}
// the civilian walkers: the first walker for 4 s on its loop
{
  const r = await page.evaluate(async (STRIPS) => {
    const { m, step, sampleCiv, units, shoot, camAt, strip } = window.__an;
    const u = units.find((x) => x.kind === 'walker');
    const S = m.world.scene.getObjectByName('machines').userData.batches.shell, M = new (m.world.camera.matrixWorld.constructor)();
    const at = () => { S.getMatrixAt(u.shell[0], M); return [M.elements[12], M.elements[13] - 0.75, M.elements[14]]; };
    let Tc = 1;
    const smp = []; for (let i = 0; i < 240; i++) { step(); Tc += 1 / 60; m.world.renderFrame(Tc, { camera: m.world.camera, taa: true }); smp.push(sampleCiv(u)); }
    let pic = null;
    if (STRIPS) {
      const p = at(); camAt(p, Math.atan2(M.elements[8], M.elements[10]), 3.2, 0.9);
      const yaw = Math.atan2(M.elements[8], M.elements[10]);
      for (let k = 0; k < 8; k++) { step(9); Tc += 9 / 60; shoot(at, Tc, [yaw, -3, 0]); }
      pic = strip('civilian walker');
    }
    return { smp, pic };
  }, STRIPS);
  report.civilian = { walk: gait(r.smp) };
  save('civilian-walk', r.pic);
  console.log('civilian', JSON.stringify(report.civilian));
}
// a hound (the scout) trotting across the plaza, and turning on the spot
{
  const r = await page.evaluate(async ({ A, Bp, STRIPS }) => {
    const { E, step, subject, go, shoot, camAt, strip } = window.__an;
    const pics = {};
    const e = subject('h2', A, Math.PI); go(e, Bp, 2.2); step(60);
    if (STRIPS) { camAt(e.pos, Math.PI, 2.6, 0.6); for (let k = 0; k < 8; k++) { step(4); shoot(() => [e.pos[0], e.pos[1] - 0.45, e.pos[2]], null, [Math.PI, 2.6, 0]); } pics.trot = strip('hound trot'); }
    const e2 = subject('h2', A, Math.PI);
    if (STRIPS) camAt(e2.pos, Math.PI, 2.6, 0);
    e2.state = 'alert'; e2.t = 0; e2.wait = 99; e2.lastSeen = [A[0] - 3, A[1], A[2] + 4];
    for (let k = 0; k < 8; k++) { step(5); if (STRIPS) shoot(() => [e2.pos[0], e2.pos[1] - 0.45, e2.pos[2]]); }
    if (STRIPS) pics.turn = strip('hound turn on the spot');
    void E;
    return pics;
  }, { A, Bp, STRIPS });
  for (const [k, u] of Object.entries(r)) save(`hound-${k}`, u);
}
fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`anim-check: ${Object.keys(report).length} types, numbers in ${path.join(OUT, TAG + '.json')}${errors.length ? ' (page errors: ' + errors.slice(0, 3).join(' | ') + ')' : ''}`);
await b.close(); srv.close?.();
process.exit(0);

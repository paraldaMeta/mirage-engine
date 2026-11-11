// Check: model import and the animation stack on the GPU, in the anim demo packaged as one HTML file.
//   node examples/demos/anim/anim-check.mjs
// 1. the single-file page loads with no errors; the rig came through the importer from meshopt-compressed GLB bytes
// 2. the Draco and Basis decoders, inlined by the packager as data: URLs, start up (no Draco encoder ships with
//    three, so no Draco file is decoded here: the decoder module is instantiated and its mesh decoder exists)
// 3. imported materials are adapted (fog and shadow chunks) and the crates are solid in the walk grid
// 4. the player is the imported rig: walking forward changes state, moves bones, and the figure is in the picture
// 5. foot placement: one foot on the kerb, one on the ground, each within 2 cm of its floor; off with ?ik=0
// 6. root motion: the second figure travels its clip's speed on a walker; foot events fire
// 7. retarget: the built-in traveller plays the rig's walk
// 8. timeline: ?timeline=1&t= draws the same picture twice, and different pictures at different times
// Writes out/anim-check.json and out/anim-*.png.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..'), out = path.join(here, 'out');
const checks = [], report = {};
const ok = (k, cond, v) => { checks.push({ k, ok: !!cond, v }); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${k}${v !== undefined ? ': ' + (typeof v === 'string' ? v : JSON.stringify(v)) : ''}`); };
fs.mkdirSync(out, { recursive: true });
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', path.join(out, 'anim.html')], { stdio: 'inherit' });
report.htmlBytes = fs.statSync(path.join(out, 'anim.html')).size;
const srv = await serve(out), b = await launch({ w: 1280, h: 720 });
const page0 = async (q) => { const o = await open(b, srv.url + 'anim.html?w=1280&h=720&ui=0&grain=0&' + q); return o; };
const shot = async (page, name) => { const d = await page.evaluate(() => window.__mirage.world.renderer.domElement.toDataURL()); fs.writeFileSync(path.join(out, name), Buffer.from(d.split(',')[1], 'base64')); return d.length; };
// mean absolute difference of two canvases' pixels, 0..255
const diff = (page, a, b2) => page.evaluate(async (a, b2) => {
  const px = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const A = await px(a), B = await px(b2); let s = 0; for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]); return s / A.length;
}, a, b2);

try {
  // 1-7: the play page
  const { page, errors } = await page0('mode=game');
  await page.evaluate(() => window.__mirage.play.stop());
  const info = await page.evaluate(() => { const { model, crate, rigBytes, assets } = window.__mirage; return { rigBytes, stats: model.stats, clips: model.animations.map((c) => c.name), skinned: model.skinned, crate: crate.stats, cache: assets.stats() }; });
  report.import = info;
  ok('page loads without errors', errors.length === 0, errors.slice(0, 3));
  ok('rig imported from meshopt GLB bytes', info.stats.extensions.includes('EXT_meshopt_compression') && info.skinned && info.clips.length === 9, { bytes: info.rigBytes, ms: +info.stats.ms.toFixed(1), triangles: info.stats.triangles, clips: info.clips.length, extensions: info.stats.extensions });

  const dec = await page.evaluate(() => window.__mirage.probe());
  report.decoders = dec;
  ok('Draco decoder starts from the inlined WASM', dec.draco.decoder && dec.draco.inline, dec.draco);
  ok('Basis (KTX2) transcoder starts from the inlined WASM', dec.basis.ktx2 && dec.basis.inline, dec.basis);

  const adapt = await page.evaluate(() => {
    const { hero, crate, play, world } = window.__mirage; let mat = null, heroMat = null;
    crate.scene.traverse((o) => { if (o.isMesh) mat = o.material; }); hero.root.traverse((o) => { if (o.isSkinnedMesh) heroMat = o.material; });
    const progs = world.renderer.info.programs.length;
    return { crateFog: mat.fog !== false, heroCast: (() => { let c = false; hero.root.traverse((o) => { if (o.isSkinnedMesh) c = o.castShadow; }); return c; })(), heroMatType: heroMat.type, progs,
      crateTop: play.grid.groundAt(-2.4, -3.5, 5, 0), beside: play.grid.groundAt(0, -6, 5, 0) };
  });
  report.adapt = adapt;
  ok('imported crate is solid in the walk grid (top at 0.8 m, ground beside it)', Math.abs(adapt.crateTop - 0.8) < 0.12 && Math.abs(adapt.beside) < 0.05, adapt);
  ok('imported skinned mesh casts shadows', adapt.heroCast, adapt.heroMatType);

  // walk forward 2 s from the spawn (deterministic steps)
  const walk = await page.evaluate(() => {
    const { play, hero, THREE } = window.__mirage; const hand = hero.root.getObjectByName('LeftHand'), p = new THREE.Vector3(), seen = new Set(), start = [...play.walker.pos]; let lo = 1e9, hi = -1e9;
    play.keys.add('KeyW');
    for (let i = 0; i < 120; i++) { play.step(1 / 60); seen.add(hero.state); hand.getWorldPosition(p); const rel = p.z - play.figure.position.z; lo = Math.min(lo, rel); hi = Math.max(hi, rel); }
    play.keys.delete('KeyW');
    const moved = Math.hypot(play.walker.pos[0] - start[0], play.walker.pos[2] - start[2]);
    return { states: [...seen], moved, handSwing: hi - lo, visible: play.figure.visible };
  });
  report.walk = walk;
  ok('the imported rig is the player: walks, state machine moves, arms swing', walk.states.includes('walk') && walk.moved > 1.5 && walk.handSwing > 0.1 && walk.visible, walk);
  await page.evaluate(() => window.__mirage.play.render({ spp: 4 }));
  report.shots = { play: await shot(page, 'anim-play.png') };
  // a still from a camera of the check's own (the game view is a high isometric one)
  const closeup = (eye, look, name) => page.evaluate((eye, look) => { const { play, world } = window.__mirage, c = world.camera; c.position.set(...eye); c.lookAt(...look); c.updateMatrixWorld(); play.figure.visible = true; world.renderFrame(1, { spp: 4, frameIndex: 1 }); }, eye, look).then(() => shot(page, name));

  // 5. feet: stand across the kerb edge (kerb top 0.15 for z in 0..3, x in -3..3): walker at the front edge
  const feet = async (pg) => pg.evaluate(() => {
    const { play, hero, groundAt, THREE } = window.__mirage, p = new THREE.Vector3(), res = {};
    play.place([3.0, 1.62 + 0.0, 1.5], [3.0, 1.0, -5], 'game');   // on the kerb's side edge: left / right feet either side of x = 3
    for (let i = 0; i < 90; i++) play.step(1 / 60);
    hero.root.updateMatrixWorld(true);
    for (const n of ['LeftFoot', 'RightFoot']) { hero.root.getObjectByName(n).getWorldPosition(p); const g = groundAt(p.x, p.z, p.y + 0.5); res[n] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3), ground: +g.toFixed(3), gap: +(p.y - g - 0.08).toFixed(4) }; }
    res.walker = play.walker.pos.map((v) => +v.toFixed(3)); res.state = hero.state;
    return res;
  });
  const f1 = await feet(page);
  report.feet = { on: f1 };
  const split = Math.abs(f1.LeftFoot.ground - f1.RightFoot.ground) > 0.1;
  ok('feet stand on different floors across the kerb edge', split, f1);
  ok('foot placement: each ankle within 2 cm of its own floor', Math.abs(f1.LeftFoot.gap) < 0.02 && Math.abs(f1.RightFoot.gap) < 0.02, [f1.LeftFoot.gap, f1.RightFoot.gap]);
  report.shots.kerb = await closeup([3.0, 0.7, -1.2], [3.0, 0.5, 1.5], 'anim-kerb.png');

  // 6. root motion NPC: 4 s of steps
  const npc = await page.evaluate(() => {
    const { play, npc } = window.__mirage, t0 = npc.travelled, e0 = npc.steps.footL + npc.steps.footR;
    for (let i = 0; i < 240; i++) play.step(1 / 60);
    return { metres: npc.travelled - t0, seconds: 4, events: npc.steps.footL + npc.steps.footR - e0, y: npc.walker.pos[1] };
  });
  report.npc = npc;
  ok('root motion drives a walker at the clip speed (1.5 m/s) and fires foot events', Math.abs(npc.metres / npc.seconds - 1.5) < 0.12 && npc.events >= 6, npc);

  // 7. retargeted traveller
  const rt = await page.evaluate(() => {
    const { play, retargeted } = window.__mirage, k = retargeted.root.getObjectByName('knee.L'), q0 = k.quaternion.clone(); let turn = 0;
    for (let i = 0; i < 40; i++) { play.step(1 / 60); turn = Math.max(turn, k.quaternion.angleTo(q0)); }
    return { tracks: retargeted.clip.tracks.length, duration: retargeted.clip.duration, kneeTurn: turn };
  });
  report.retarget = rt;
  ok('retargeted walk plays on the built-in traveller (knee bends)', rt.tracks > 8 && rt.kneeTurn > 0.2, rt);
  report.shots.yard = await closeup([5.5, 2.6, 8.5], [0.5, 0.8, 2], 'anim-yard.png');
  await page.close();

  // 5b. ?ik=0: the same stance, feet keep the animation's level
  { const o = await page0('mode=game&ik=0'); await o.page.evaluate(() => window.__mirage.play.stop());
    const f0 = await feet(o.page); report.feet.off = f0;
    ok('?ik=0: no foot placement (one ankle floats or sinks by the kerb height)', Math.max(Math.abs(f0.LeftFoot.gap), Math.abs(f0.RightFoot.gap)) > 0.1, [f0.LeftFoot.gap, f0.RightFoot.gap]);
    ok('?ik=0 page has no errors', o.errors.length === 0, o.errors.slice(0, 3)); await o.page.close(); }

  // 4b. ?player=procedural: the engine's own traveller, this stack not in the play loop
  { const o = await page0('mode=game&player=procedural&npc=0&retarget=0'); await o.page.evaluate(() => window.__mirage.play.stop());
    const r = await o.page.evaluate(() => ({ hero: window.__mirage.hero === null, bones: !!window.__mirage.play.figure.getObjectByName('hips') }));
    ok('?player=procedural keeps the built-in traveller', r.hero && r.bones && o.errors.length === 0, r); await o.page.close(); }

  // 8. timeline stills
  const still = async (t) => { const o = await page0('timeline=1&t=' + t); const d = await o.page.evaluate(() => window.__mirage.world.renderer.domElement.toDataURL()); const e = o.errors.length; return { o, d, e }; };
  const a = await still(2.2), a2 = await still(2.2), c = await still(4.6);
  fs.writeFileSync(path.join(out, 'anim-timeline-2.2.png'), Buffer.from(a.d.split(',')[1], 'base64')); fs.writeFileSync(path.join(out, 'anim-timeline-4.6.png'), Buffer.from(c.d.split(',')[1], 'base64'));
  const same = await diff(a.o.page, a.d, a2.d), other = await diff(a.o.page, a.d, c.d);
  const arm = await c.o.page.evaluate(() => { const { tlActor, kit } = window.__mirage, rest = kit.createRigModel().bones.LeftArm.quaternion; return tlActor.getObjectByName('LeftArm').quaternion.angleTo(rest); });
  ok('timeline: the wave plays over idle (the other arm hangs: turned from the T pose, rad)', arm > 1, +arm.toFixed(3));
  report.timeline = { sameT: same, otherT: other };
  ok('timeline: the same t draws the same picture (mean abs diff of 255)', same < 0.5 && a.e + a2.e + c.e === 0, +same.toFixed(4));
  ok('timeline: another t draws another picture', other > 2, +other.toFixed(2));
} finally { await b.close(); srv.close(); }

report.checks = checks;
fs.writeFileSync(path.join(out, 'anim-check.json'), JSON.stringify(report, null, 2));
const bad = checks.filter((c) => !c.ok);
console.log(bad.length ? `anim check: ${bad.length} FAILED` : `anim check: ok (${checks.length} checks)`);
process.exit(bad.length ? 1 : 0);

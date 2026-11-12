// Mirage original code. Browser check of sprite-yard (real Chrome, the built dist): no console errors; click to
// walk with real mouse clicks (the ground, a crate's top: the hero walks beside it, a creature: struck on the hit
// frame); stills of the night, the silhouette (cutaway off) and a hover outline. Writes PNGs and yard.json to
// out/sprite-yard/check. Exit 1 on any failure.
//   npm run build -w sprite-yard && node examples/sprite-yard/scripts/yard-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const dist = path.join(here, '../dist'), OUT = path.join(root, 'out/sprite-yard/check');
fs.mkdirSync(OUT, { recursive: true });
const W = 1280, H = 800;
const srv = await serve(dist), browser = await launch({ w: W, h: H });
const report = { checks: [], shots: [] }, fail = [];
const check = (name, ok, info = {}) => { report.checks.push({ name, ok: !!ok, ...info }); if (!ok) fail.push(name); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
try {
  const { page, errors, warnings, loadMs } = await open(browser, `${srv.url}?w=${W}&h=${H}`, { viewport: { width: W, height: H } });
  report.loadMs = loadMs;
  const still = async (file) => {
    const png = await page.evaluate(() => { window.__mirage.play.render({ moving: false, spp: 8, frameIndex: 1 }); return document.querySelector('canvas').toDataURL('image/png'); });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(png.split(',')[1], 'base64')); report.shots.push(file);
  };
  // the live loop runs: a few moving frames, then the page's own screenshot
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'live.png') }); report.shots.push('live.png');
  // from here the test drives the clock: the loop stops, play.step advances the simulation and the camera
  await page.evaluate(() => { const m = window.__mirage; m.play.stop(); m.play.place([0, 30, 30], [0, 0, 0]); });
  const toScreen = (p) => page.evaluate(([x, y, z, w, h]) => {
    const m = window.__mirage, v = new m.world.ctx.THREE.Vector3(x, y, z).project(m.world.camera);
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
  }, [...p, W, H]);
  const steps = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__mirage.play.step(1 / 30); }, n);
  const heroAt = () => page.evaluate(() => window.__mirage.hero.agent.pos.slice());
  // give the camera back to the iso camera (a click does that) and let it settle on the hero
  await page.mouse.click(5, 5, { button: 'right' });
  await steps(30);

  // 1. click the ground: the hero walks there
  const target = [2, 0, -1];
  let [sx, sy] = await toScreen(target);
  await page.mouse.click(sx, sy);
  await steps(150);
  let p = await heroAt();
  check('click the ground: the hero walks to the clicked point', Math.hypot(p[0] - target[0], p[2] - target[2]) < 0.4, { at: p.map((v) => +v.toFixed(2)), target });

  // 2. click a crate's top: no way up, so the hero walks beside the crates
  [sx, sy] = await toScreen([3.6, 0.9, 3.4]);
  await page.mouse.click(sx, sy);
  await steps(150);
  p = await heroAt();
  const onCrate = [[2.6, 3.2], [3.6, 3.4], [2.9, 4.2]].some(([x, z]) => Math.abs(p[0] - x) < 0.45 && Math.abs(p[2] - z) < 0.45);
  check('click a crate top: the hero ends beside the crates, on the ground', !onCrate && p[1] < 0.1 && Math.hypot(p[0] - 3.6, p[2] - 3.4) < 4, { at: p.map((v) => +v.toFixed(2)) });

  // 3. hover and click a creature: the outline, then struck on the attack's hit frame
  const c0 = await page.evaluate(() => { const c = window.__mirage.critters[0]; return { pos: c.agent.pos.slice(), hp: c.hp }; });
  const rect = await page.evaluate(() => { const m = window.__mirage, r = m.critters[0].sprite.screenRect(m.world.camera, 1280, 800); return [r.cx, (r.y0 + r.cy) / 2]; });
  await page.mouse.move(rect[0], rect[1]);
  await steps(1);
  const outlined = await page.evaluate(() => window.__mirage.critters[0].sprite.uniforms.uOutline.value.w);
  check('hover a creature: its outline is on', outlined > 0, { width: outlined });
  await still('hover-outline.png');
  // count blows: wrap strike's effect (hp) and the hit callback order
  await page.mouse.click(rect[0], rect[1]);
  const hits = await page.evaluate(() => {
    const m = window.__mirage, c = m.critters[0], log = [];
    for (let i = 0; i < 30 * 8 && log.length < 3; i++) {
      const hp = c.hp, anim = m.hero.sprite.name, frame = m.hero.sprite.anim.frame.index;
      m.play.step(1 / 30);
      if (c.hp < hp) log.push({ step: i, heroAnim: anim, frameBefore: frame, frameAfter: m.hero.sprite.anim.frame.index });
    }
    return { log, hp: c.hp, dead: !!c.dead };
  });
  const hitFrame = 2;
  check('click a creature: the hero walks up and strikes it', hits.log.length >= 1 && hits.hp < c0.hp, { blows: hits.log.length, hp: hits.hp, dead: hits.dead });
  check('each blow lands on the attack\'s hit frame', hits.log.every((b) => b.heroAnim === 'attack' && b.frameAfter >= hitFrame && b.frameBefore < hitFrame), { log: hits.log });

  // 4. stills: the silhouette (the cutaway off, the hero behind a house), the cutaway on, night
  await page.evaluate(() => { const m = window.__mirage; m.play.viewpoint(1); m.cut.off(); const set = m.cut.set; m.cut.set = () => m.cut; m.__restoreCut = () => { m.cut.set = set; }; });
  await still('silhouette.png');
  const sil = await page.evaluate(() => window.__mirage.hero.sprite.silhouette.visible);
  check('the silhouette mesh is drawn', sil);
  await page.evaluate(() => { const m = window.__mirage; m.__restoreCut(); m.play.viewpoint(1); });
  await still('cutaway.png');
  await page.evaluate(() => { const m = window.__mirage; m.world.setTime({ elevation: -18, azimuth: 300 }); m.world.captureEnv(true); m.play.viewpoint(0); m.hero.agent.place([0.5, 0, 0.6]); m.play.step(1 / 30); });
  await still('night.png');

  check('no console errors', errors.length === 0, { errors: errors.slice(0, 5), warnings: warnings.length });
  report.errors = errors; report.warnings = warnings;
  await page.close();
} catch (e) {
  fail.push('crashed: ' + e.message); console.error(e); if (e.errors) console.error(e.errors);
} finally {
  await browser.close(); srv.close();
}
fs.writeFileSync(path.join(OUT, 'yard.json'), JSON.stringify({ ...report, failed: fail }, null, 1));
console.log(fail.length ? `yard check: ${fail.length} FAILED (${fail.join('; ')})` : `yard check: ok (${report.checks.length} checks, ${report.shots.length} shots in ${path.relative(root, OUT)})`);
process.exit(fail.length ? 1 : 0);

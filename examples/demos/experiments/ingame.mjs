// Experiment: today's truck and sentinel in the built game (by day), for the comparison with the staged models.
//   node packages/tools/src/package.mjs examples/neon-district --out examples/demos/experiments/out/neon.html
//   node examples/demos/experiments/ingame.mjs        -> out/ingame-*.png, triangle / draw counts on stdout
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.join(here, 'out'), W = 1280, H = 800;
const srv = await serve(out), b = await launch({ w: W, h: H });
try {
  // ?world=1: the district alone (the camera is free); the sentinels need the game: a second page below
  let { page, errors } = await open(b, `${srv.url}neon.html?w=${W}&h=${H}&world=1&ui=0&grain=0&hud=0&quality=high&time=${process.argv[2] || 'day'}`);
  const snap = (eye, look) => page.evaluate((eye, look) => {
    const { play, world } = window.__mirage; play.stop();
    play.place(eye, look, 'fly');
    for (let i = 0; i < 40 || (world.lighting?.busy && i < 400); i++) { play.step(1 / 60); play.render({ moving: true }); }
    play.render({ moving: false, spp: 4, frameIndex: 1 });
    return document.querySelector('canvas').toDataURL('image/png');
  }, eye, look);
  const save = (n, d) => { fs.writeFileSync(path.join(out, n), Buffer.from(d.split(',')[1], 'base64')); console.log('wrote', n); };
  // the Slab: plan.cars[0] = [-21.5, 7.3, rot 0.03]; its front is +x
  const C = [-21.5, 0, 7.3];
  const views = { rear34: [-4.0, 1.4, 3.6], front34: [4.4, 1.5, 3.6], side: [0, 1.1, 4.4], rear: [-5.5, 1.4, 0.4] };   // the right (+z) side: the left one faces the shop counters
  for (const [n, [x, y, z]] of Object.entries(views)) save(`ingame-truck-${n}.png`, await snap([C[0] + x, y, C[2] + z], [C[0], 0.8, C[2]]));
  // a sentinel: the first one standing, from the front and three-quarter
  await page.close();
  ({ page, errors } = await open(b, `${srv.url}neon.html?w=${W}&h=${H}&ui=0&grain=0&hud=0&quality=high&time=${process.argv[2] || 'day'}`));
  const info = await page.evaluate(() => {
    const en = window.__mirage.game?.enemies, e = en?.list.find((x) => x.active && !x.dead);
    if (!e) return null;
    let tris = 0, draws = 0; e.rig.root.traverse((o) => { if (o.isMesh && o.visible) { draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return { id: e.id, kind: e.K.name, pos: e.pos, yaw: e.yaw, tris, draws };
  });
  console.log('sentinel', JSON.stringify(info));
  if (info) {
    const [x, y, z] = info.pos, f = [Math.sin(info.yaw), Math.cos(info.yaw)];
    save('ingame-sentinel-front.png', await snap([x + f[0] * 2.6, y + 1.3, z + f[1] * 2.6], [x, y + 0.95, z]));
    save('ingame-sentinel-34.png', await snap([x + f[0] * 2.0 + f[1] * 1.6, y + 1.4, z + f[1] * 2.0 - f[0] * 1.6], [x, y + 0.95, z]));
  }
  if (errors.length) console.log('page errors', errors.slice(0, 3));
} finally { await b.close(); srv.close(); }

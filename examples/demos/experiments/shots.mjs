// Experiment pictures in headless Chrome (packages/tools/src/chrome.mjs). The pages import three from the
// repository's node_modules, so the server's root is the folder that holds node_modules (in a worktree: the main
// checkout, which contains the worktree).
//   node examples/demos/experiments/shots.mjs walk      -> out/strip-*.png, out/walk-live.png
//   node examples/demos/experiments/shots.mjs models    -> out/models-*.png, out/models.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
let root = here; while (!fs.existsSync(path.join(root, 'node_modules', 'three'))) { const up = path.dirname(root); if (up === root) throw new Error('no node_modules/three above'); root = up; }
const rel = path.relative(root, here).split(path.sep).join('/');
const what = process.argv[2] || 'walk', arg = process.argv.slice(3);
const srv = await serve(root), b = await launch({ w: 1280, h: 720 });
const save = (name, dataUrl) => { fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64')); console.log('wrote', path.join(out, name)); };
try {
  if (what === 'walk') {
    const { page, errors } = await open(b, `${srv.url}${rel}/walk.html?w=1280&h=720&still=1`);
    for (const [bn, un, view, game] of [['walk', 'walk', 'side'], ['walk', 'walk', 'three'], ['run', 'run', 'side'], ['run', 'run', 'three'], ['walk', 'walk', 'side', true], ['run', 'run', 'side', true], ['idle', 'die', 'side'], ['idle', 'die', 'three'], ['idle', 'brokenWalk', 'side'], ['idle', 'hitKnockback', 'side'], ['idle', 'hitChest', 'side'], ['idle', 'hitHead', 'side'], ['idle', 'crouchWalk', 'side']]) {
      save(`strip-${un}-${view}${game ? '-game' : ''}.png`, await page.evaluate((o) => window.__strip(o), { base: bn, ual: un, view, game }));
    }
    console.log(JSON.stringify(await page.evaluate(() => window.__metrics())));
    if (errors.length) console.log('page errors', errors);
    const live = await open(b, `${srv.url}${rel}/walk.html?w=1280&h=720&clip=${arg[0] || 'walk'}`);
    await new Promise((r) => setTimeout(r, 2500));
    await live.page.screenshot({ path: path.join(out, `walk-live-${arg[0] || 'walk'}.png`) });
  } else {
    const { page, errors } = await open(b, `${srv.url}${rel}/models.html?w=1600&h=900&${arg[0] || ''}`);
    const res = await page.evaluate(() => window.__shoot());
    for (const [name, url] of Object.entries(res.images)) save(`models-${name}.png`, url);
    fs.writeFileSync(path.join(out, 'models.json'), JSON.stringify(res.stats, null, 1));
    console.log(JSON.stringify(res.stats, null, 1));
    if (errors.length) console.log('page errors', errors);
  }
} finally { await b.close(); srv.close(); }

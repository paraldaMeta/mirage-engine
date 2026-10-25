#!/usr/bin/env node
// Mirage original code. Multi-view snapshots of a world and a contact sheet of them.
//
// usage: mirage-snap <dist dir | page.html> [--out dir] [--views all | 0,2,5] [--query "time=12:00"] [--w 1440 --h 900]
//        [--spp 16] [--cols 3] [--game] (adds a game-view shot at the spawn)
// For each of the plan's viewpoints: place the viewer there (play.viewpoint), render the still path at `spp`,
// save <out>/vNN-name.png; then <out>/sheet.png (thumbnails with labels, composed in the page's 2D canvas)
// and <out>/snap.json (load time, per-view render ms, console errors).
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--game'));
if (!target) { console.error('usage: mirage-snap <dist dir | page.html> [--out dir] [--views all|0,1] [--query q] [--spp N]'); process.exit(2); }
const W = +flag('w', 1440), H = +flag('h', 900), SPP = +flag('spp', 16), COLS = +flag('cols', 3);
const OUT = path.resolve(flag('out', 'out/snap'));
fs.mkdirSync(OUT, { recursive: true });
const isFile = target.endsWith('.html');
const srv = isFile ? null : await serve(target);
const url = (isFile ? 'file://' + path.resolve(target) : srv.url) + `?mode=walk&ui=0&w=${W}&h=${H}` + (flag('query') ? '&' + flag('query') : '');
const browser = await launch({ w: W, h: H });
const report = { url, views: [] };
try {
  const { page, errors, loadMs } = await open(browser, url);
  report.loadMs = loadMs;
  const vps = await page.evaluate(() => window.__mirage.built.plan.viewpoints.map((v) => v.name));
  const pick = flag('views', 'all') === 'all' ? vps.map((_, i) => i) : String(flag('views')).split(',').map(Number);
  const shots = pick.map((i) => ({ i, name: vps[i] }));
  if (flag('game')) shots.push({ i: -1, name: 'game view' });
  const files = [];
  for (const s of shots) {
    const r = await page.evaluate(async (s, spp) => {
      const { play } = window.__mirage;
      play.stop();                                       // no animation frames in between: this task renders
      if (s.i >= 0) play.viewpoint(s.i);
      else { const p = window.__mirage.built.plan, sp = p.gameView || p.spawn; play.place(sp.eye, sp.look, 'game'); }
      for (let k = 0; k < 40; k++) play.step(1 / 30);    // settle: ground, eased eye, game camera follow
      const t = performance.now();
      play.render({ moving: false, spp, frameIndex: 1 });
      const gl = play.world.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      return { ms: +(performance.now() - t).toFixed(1), png: document.querySelector('canvas').toDataURL('image/png'), mode: play.mode };
    }, s, SPP);
    const f = `v${String(files.length).padStart(2, '0')}-${s.name.replace(/\W+/g, '-')}.png`;
    fs.writeFileSync(path.join(OUT, f), Buffer.from(r.png.split(',')[1], 'base64'));
    files.push({ f, name: s.name, data: r.png });
    report.views.push({ name: s.name, file: f, mode: r.mode, renderMs: r.ms });
    console.log(JSON.stringify(report.views.at(-1)));
  }
  // the contact sheet
  const sheet = await page.evaluate(async (items, cols) => {
    const tw = 480, th = Math.round((tw * innerHeight) / innerWidth), pad = 8, lab = 22;
    const rows = Math.ceil(items.length / cols), c = document.createElement('canvas');
    c.width = cols * (tw + pad) + pad; c.height = rows * (th + lab + pad) + pad;
    const g = c.getContext('2d');
    g.fillStyle = '#16130f'; g.fillRect(0, 0, c.width, c.height);
    for (const [k, it] of items.entries()) {
      const img = new Image(); img.src = it.data; await img.decode();
      const x = pad + (k % cols) * (tw + pad), y = pad + Math.floor(k / cols) * (th + lab + pad);
      g.drawImage(img, x, y, tw, th);
      g.fillStyle = '#f0e2c4'; g.font = '13px system-ui, sans-serif'; g.fillText(`${k + 1}  ${it.name}`, x + 2, y + th + 16);
    }
    return c.toDataURL('image/png');
  }, files.map(({ name, data }) => ({ name, data })), COLS);
  fs.writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  report.errors = errors;
} finally {
  await browser.close();
  if (srv) srv.close();
}
fs.writeFileSync(path.join(OUT, 'snap.json'), JSON.stringify(report, null, 1));
console.log(`snap: ${report.views.length} views, sheet ${path.join(OUT, 'sheet.png')}, errors ${report.errors?.length ?? '?'}`);

#!/usr/bin/env node
// Can a Mirage walker use the fort as Nizwa's own walk mode does? Reads the baked walk grid along the gate passage,
// then holds "forward" from the forecourt through the gate and reports where the walker ends up and which doors
// opened for it (Nizwa's doors animate in the vertex shader; Mirage's walk grid is baked once from the closed doors).
//   node tools/walkcheck.mjs [--seconds 14] [--out out/walkcheck]
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = 1280, H = 720, OUT = path.resolve(flag('out', 'out/walkcheck')), SECONDS = +flag('seconds', 14);
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch({ w: W, h: H });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[page:error] ' + e.message));
  await page.goto(`http://localhost:${process.env.VITE_PORT || 5291}/?mode=walk&ui=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 0 });
  await page.waitForFunction('window.__READY === true', { timeout: 600000, polling: 300 });
  const grid = await page.evaluate(() => {
    const { play, built } = window.__mirage, g = play.grid, gate = built.plan.fort.gate.pos;
    const rows = [];
    for (let z = gate[2] + 8; z >= gate[2] - 14; z -= 2) rows.push({ z, layers: [...g.layers(gate[0], z)].map((l) => [...l].map((v) => +v.toFixed(2))) });
    return { gate, rows };
  });
  console.log('[walkcheck] grid columns along the gate axis (x = ' + grid.gate[0] + '): [floor, ceiling] pairs, bottom to top');
  for (const r of grid.rows) console.log(`  z ${String(r.z).padStart(5)}  ${JSON.stringify(r.layers)}`);
  await page.evaluate(() => { const { play, built } = window.__mirage, g = built.plan.fort.gate.pos; play.place([g[0], 1.62, g[2] + 9], [g[0], 1.62, g[2] - 20], 'walk'); });
  await page.mouse.click(W / 2, H / 2);
  await page.keyboard.down('KeyW');
  const track = [];
  for (let i = 0; i < SECONDS; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    track.push(await page.evaluate(() => { const { play, nz } = window.__mirage; return { pos: play.walker.pos.map((v) => +v.toFixed(2)), blocked: !!play.walker.blocked, open: nz.doors.list.filter((d) => d.open > 0.5).length }; }));
    if (i === 3 || i === SECONDS - 1) await page.screenshot({ path: path.join(OUT, `walk-${i + 1}s.png`) });
  }
  await page.keyboard.up('KeyW');
  for (const [i, t] of track.entries()) console.log(`  t ${String(i + 1).padStart(2)} s  walker ${JSON.stringify(t.pos)}  blocked ${t.blocked}  doors open ${t.open}`);
  fs.writeFileSync(path.join(OUT, 'walkcheck.json'), JSON.stringify({ grid, track }, null, 1));
} finally { await browser.close(); }

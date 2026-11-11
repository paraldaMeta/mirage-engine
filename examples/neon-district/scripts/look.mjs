#!/usr/bin/env node
// A look at the running game in headless Chrome: load the page, optionally run a snippet in it, wait, save a
// screenshot, print the console errors.   node scripts/look.mjs "<query>" out/look.png [wait ms] ["js to evaluate"]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [query = 'start=1', out = 'out/look.png', wait = '2500', js = ''] = process.argv.slice(2);
const W = 1280, H = 720;
const srv = await serve(path.join(here, '../dist')), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&${query}`);
let warnings = 0; page.on('console', (m) => { if (/warn/.test(m.type())) warnings++; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let result;
if (js) result = await page.evaluate(js);
await sleep(+wait);
await page.screenshot({ path: out });
const state = await page.evaluate(() => { const m = window.__mirage, s = m.play.state(); return { pos: s.pos, flags: m.g?.game.flags, hp: m.game?.player.hp, alive: m.game?.enemies.alive, frames: m.play.stats.frames, lastMs: m.play.stats.lastMs, features: m.features }; });
console.log(JSON.stringify({ result, state, warnings }, null, 0));
for (const e of errors) console.log('ERR ' + e);
await b.close(); srv.close?.();

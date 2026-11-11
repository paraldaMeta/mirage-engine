// Check: the audio engine in a real browser. Packages the demo into one HTML file, opens it from file:// in headless
// Chrome, renders every graph with OfflineAudioContext and measures the samples (examples/demos/audio/tests.js), then
// lets the live page run for a moment (stream, voices, overlay).
// node examples/demos/audio/audio-check.mjs [--only text] [--json file]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? '' : process.argv[i + 1]; };
const html = path.join(here, 'out/audio.html');
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: 'inherit' });

const b = await launch({ w: 960, h: 600, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage(), errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(html) + '?auto=1&swarm=40&voices=16');
await page.waitForFunction('window.__READY === true', { timeout: 120000 });
const rows = await page.evaluate((only) => window.__audio.runTests(only), arg('--only'));
// the live page: the demo itself for a moment, then its numbers
const live = await page.evaluate(async () => {
  const { engine, act } = window.__audio;
  act.m(); act.t();
  await new Promise((r) => setTimeout(r, 2500));
  const m = engine.meters(), s = engine.stats;
  return { state: s.state, voices: s.voices, virtual: s.virtual, cap: engine.cap, streams: s.streams, zones: s.zones, rays: s.raysTotal, master: m.master?.peak, music: m.music?.peak,
    section: window.__audio.music?.section, overlay: document.querySelector('[data-mirage-audio-debug]')?.textContent.slice(0, 60), chime: engine.has('chime'), inlined: window.__audio.env.themeUrl.startsWith('data:') };
});
await b.close();

let bad = 0;
for (const r of rows) { if (!r.ok) bad++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.ms} ms)\n       ${r.note}`); }
const liveOk = arg('--only') ? true : live.state === 'running' && live.voices === live.cap && live.virtual > 0 && live.streams === 1 && live.master > 0.001 && live.section === 'calm' && live.chime && live.inlined && !!live.overlay;
console.log(`${liveOk ? 'ok  ' : 'FAIL'} live page from file:// (single HTML, sounds inlined: ${live.inlined})\n       context ${live.state}, ${live.voices} / ${live.cap} voices, ${live.virtual} virtual, ${live.streams} stream, master peak ${live.master?.toFixed(3)}, music peak ${live.music?.toFixed(3)}, ${live.rays} rays, section ${live.section}`);
for (const e of errors) console.log('page error: ' + e);
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ rows, live }, null, 1));
const ok = bad === 0 && liveOk && errors.length === 0;
console.log(`audio (browser): ${rows.length - bad} / ${rows.length} checks, live ${liveOk ? 'ok' : 'FAIL'}, ${errors.length} page errors, html ${(fs.statSync(html).size / 1024).toFixed(0)} KB -> ${ok ? 'ok' : 'FAIL'}`);
process.exit(ok ? 0 : 1);

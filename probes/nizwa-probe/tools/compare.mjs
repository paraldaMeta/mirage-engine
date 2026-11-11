#!/usr/bin/env node
// The same views at the same times in both engines, side by side.
//   node tools/compare.mjs [--out out/compare] [--w 1280 --h 720] [--spp 8] [--shots "approach@17:00,gate@19:30"]
//        [--query "off=ae"] (the probe's page query) [--nizwa-modules fort,props] [--tag name] (suffix of the files)
// Needs both dev servers: the Nizwa project's on NIZWA_PORT (default 5190: `npx vite --port 5190` in its folder) and
// this example's (npm run dev, 5291). Nizwa is shot by its own tools/snap.mjs; the pairs are joined by ImageMagick
// (`magick`) into <out>/<view>-<time>[-tag].jpg, left = Nizwa, right = Mirage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.resolve(import.meta.dirname, '..');
const NIZWA = path.resolve(process.env.NIZWA_DIR || path.join(os.homedir(), 'Documents/阿拉伯魔法原料/oman-golden'));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +flag('w', 1280), H = +flag('h', 720), SPP = +flag('spp', 8), OUT = path.resolve(flag('out', 'out/compare')), TAG = flag('tag') ? '-' + flag('tag') : '';
const DATE = '2026-10-25';
const plan = (await import(path.join(HERE, 'tools/views.mjs'))).VIEWS;
const shots = flag('shots', 'approach@17:00,gate@17:00,wall@17:00,crown@17:00,approach@12:00,gate@18:10,gate@19:30,wall@21:00').split(',').map((s) => { const [name, time] = s.split('@'); const v = plan.find((p) => p.name === name); if (!v) throw new Error('no view ' + name); return { ...v, time }; });
fs.mkdirSync(path.join(OUT, 'nizwa'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'mirage'), { recursive: true });
const file = (s) => `${s.name}-${s.time.replace(':', '')}`;
const run = (cmd, argv, opts) => { const r = spawnSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 26, ...opts }); if (r.status !== 0) { console.error(r.stdout); throw new Error(`${cmd} ${argv[0]} failed`); } return r.stdout; };

// ---- Nizwa: one page load, every view through its __renderView
const q = (s) => `cam=${s.eye}&look=${s.look}&focal=${s.focal}&time=${s.time}&date=${DATE}&spp=${SPP}`;
const nzArgs = [path.join(NIZWA, 'tools/snap.mjs'), `modules=${flag('nizwa-modules', 'fort,props')}&w=${W}&h=${H}&${q(shots[0])}`];
for (const s of shots) nzArgs.push('--view', q(s), path.join(OUT, 'nizwa', file(s) + '.png'));
let t0 = Date.now();
const nzLog = run(process.execPath, nzArgs, { cwd: NIZWA, env: { ...process.env, VITE_PORT: process.env.NIZWA_PORT || '5190' } });
console.log(`[compare] nizwa: ${shots.length} stills in ${((Date.now() - t0) / 1000).toFixed(1)} s; ` + (nzLog.match(/\[snap\] loaded.*$/m) || [''])[0]);

// ---- Mirage: this example's snap
const mgArgs = [path.join(HERE, 'tools/snap.mjs'), '--w', W, '--h', H, '--spp', SPP, '--out', path.join(OUT, 'mirage'), ...(flag('query') ? ['--query', flag('query')] : [])];
for (const s of shots) mgArgs.push('--view', `${s.name}@${s.time}`);
t0 = Date.now();
const mgLog = run(process.execPath, mgArgs.map(String), { cwd: HERE });
console.log(`[compare] mirage: ${shots.length} stills in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
fs.writeFileSync(path.join(OUT, `log${TAG}.txt`), '# nizwa\n' + nzLog + '\n# mirage\n' + mgLog);

for (const s of shots) {
  const out = path.join(OUT, `${file(s)}${TAG}.jpg`);
  run('magick', [path.join(OUT, 'nizwa', file(s) + '.png'), path.join(OUT, 'mirage', file(s) + '.png'), '+append', '-quality', '88', out]);
  console.log('[compare] ' + path.relative(process.cwd(), out));
}

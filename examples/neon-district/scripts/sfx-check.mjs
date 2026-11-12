#!/usr/bin/env node
// Check: the guns' sounds (game/gunsound.js: the engine's sound library under the game's names), measured instead of heard. Each sound is rendered in headless Chrome by
// the same code the game runs, played through Web Audio (an OfflineAudioContext renders the buffer as the mixer would
// get it), and its envelope and spectrum are measured:
//   peak       near full scale (0.8-0.99) and no sample at or past 0.999 (no clipping)
//   attack     onset (5 % of peak) to 90 % of peak: under 5 ms for every shot, blast and impact
//   tail       the last 10 ms window above -40 dB of the loudest: per room, indoor < alley < open for every gun,
//              indoor under 0.9 s, the alley 0.4-1.1 s, the open street over 1.1 s
//   centroid   the spectral centroid (magnitude-weighted) of the first 43 ms: each gun in its own band, the shotgun
//              and the explosion lower than the carbine, the pistol brighter than the shotgun
//   low        the share of the first 85 ms's energy under 200 Hz (the thump)
//   variants   two variants of a shot differ (pitch, level, timing)
// usage: node scripts/sfx-check.mjs        (no build needed: it serves the repository's source)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const srv = await serve(path.join(here, '../../..'));   // the repository: the game's file imports the engine's sound library
const b = await launch({ w: 320, h: 200, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// a blank page on the server's origin whose import map resolves the engine's package name to its source
await page.setRequestInterception(true);
page.on('request', (r) => (r.url().endsWith('/__sfx.html')
  ? r.respond({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"@miragekit/game/sounds":"/packages/game/src/sounds.js","@miragekit/assets/sounds":"/packages/assets/src/sounds/index.js"}}</script>' })
  : r.continue()));
await page.goto(`${srv.url}/__sfx.html`, { waitUntil: 'load' });
const rows = await page.evaluate(async () => {
  const { SOUNDS, ENVS } = await import('/examples/neon-district/game/gunsound.js');
  const SR = 48000;
  function analyze(x) {
    let peak = 0, clip = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; if (a >= 0.999) clip++; }
    let on = 0; while (on < x.length && Math.abs(x[on]) < peak * 0.05) on++;
    let at = on; while (at < x.length && Math.abs(x[at]) < peak * 0.9) at++;
    const win = Math.round(0.01 * SR), rms = [];
    for (let i = 0; i + win <= x.length; i += win) { let s = 0; for (let k = i; k < i + win; k++) s += x[k] * x[k]; rms.push(Math.sqrt(s / win)); }
    const top = Math.max(...rms); let last = 0; rms.forEach((r, k) => { if (r > top * 0.01) last = k; });
    const spec = (N) => {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N && on + i < x.length; i++) re[i] = x[on + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
      for (let i = 1, j = 0; i < N; i++) { let bb = N >> 1; for (; j & bb; bb >>= 1) j ^= bb; j ^= bb; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), h = i + k + len / 2, vr = re[h] * c - im[h] * s, vi = re[h] * s + im[h] * c; re[h] = re[i + k] - vr; im[h] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi; } }
      return { re, im };
    };
    let { re, im } = spec(2048), num = 0, den = 0;
    for (let k = 1; k < 1024; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * SR / 2048; den += m; }
    ({ re, im } = spec(4096)); let lo = 0, all = 0;
    for (let k = 1; k < 2048; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * SR / 4096; all += p; if (f < 200) lo += p; }
    return { dur: x.length / SR, peak, clip, attack: (at - on) / SR * 1000, tail: (last + 1) * win / SR, centroid: num / den, low: lo / all };
  }
  // through Web Audio: the buffer played into an OfflineAudioContext, its rendering measured
  async function viaWebAudio(data) {
    const ctx = new OfflineAudioContext(1, data.length, SR), buf = ctx.createBuffer(1, data.length, SR);
    buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }
  const out = [];
  const names = [...Object.keys(SOUNDS).filter((n) => SOUNDS[n].room), 'nd_imp_concrete', 'nd_imp_metal', 'nd_imp_glass', 'nd_imp_armour', 'nd_brass', 'nd_pump', 'nd_mag_in', 'nd_dry_light', 'nd_whizz', 'nd_bolt', 'nd_bolt_far', 'nd_heart', 'nd_land'];
  for (const name of names) {
    const S = SOUNDS[name], t0 = performance.now(), x = S.render(SR, 0), ms = performance.now() - t0;
    const r = analyze(await viaWebAudio(x));
    let differ = null;
    if (S.n > 1) { const y = S.render(SR, 1); let d = 0; for (let i = 0; i < Math.min(x.length, y.length); i++) d = Math.max(d, Math.abs(x[i] - y[i])); differ = d; }
    out.push({ name, kind: S.kind || (name.includes('imp_') ? 'impact' : 'mech'), gun: S.gun || '', room: S.room || '', n: S.n, ms, differ, ...r });
  }
  return { out, envs: ENVS };
});
await b.close(); srv.close?.();

// ---- the assertions
const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };
const R = rows.out, by = (n) => R.find((r) => r.name === n);
// each gun's band of centroids (Hz, first 43 ms) and the share under 200 Hz
const BAND = { pistol: [3600, 5200], carbine: [3800, 5400], shotgun: [1800, 3300], gatling: [2000, 3800], rocket: [2300, 3900] };
for (const r of R) {
  const loud = r.kind === 'shot' || r.kind === 'boom' || r.kind === 'loop';
  r.pass = true;
  const t = (c, m) => { if (!ok(c, `${r.name}: ${m}`)) r.pass = false; };
  t(r.peak >= 0.8 && r.peak <= 0.99, `peak ${r.peak.toFixed(3)} not in 0.8-0.99`);
  t(r.clip === 0, `${r.clip} samples clipped`);
  if (loud && r.kind !== 'loop' || r.kind === 'impact') t(r.attack < 5, `attack ${r.attack.toFixed(2)} ms >= 5`);
  if (r.kind === 'shot' && r.gun !== 'rocket') {
    if (r.room === 'indoor') t(r.tail < 0.9, `indoor tail ${r.tail} s >= 0.9`);
    if (r.room === 'alley') t(r.tail >= 0.4 && r.tail <= 1.1, `alley tail ${r.tail} s not in 0.4-1.1`);
    if (r.room === 'open') t(r.tail > 1.1, `open tail ${r.tail} s <= 1.1`);
  }
  if ((r.kind === 'shot' || r.kind === 'loop') && BAND[r.gun] && !r.name.includes('launch')) t(r.centroid >= BAND[r.gun][0] && r.centroid <= BAND[r.gun][1], `centroid ${r.centroid.toFixed(0)} Hz not in ${BAND[r.gun].join('-')}`);
  if (r.n > 1) t(r.differ > 0.01, `variants identical (max diff ${r.differ})`);
}
for (const g of ['pistol', 'carbine', 'shotgun']) {
  const [i, a, o] = ['indoor', 'alley', 'open'].map((e) => by(`nd_shot_${g}_${e}`).tail);
  ok(i < a && a < o, `${g}: tails not indoor < alley < open (${i}, ${a}, ${o})`);
}
const c = (n) => by(n).centroid;
ok(c('nd_shot_shotgun_open') < c('nd_shot_carbine_open'), 'the shotgun is not darker than the carbine');
ok(c('nd_shot_shotgun_open') < c('nd_shot_pistol_open'), 'the pistol is not brighter than the shotgun');
ok(c('nd_rkt_boom_open') < c('nd_shot_carbine_open') && by('nd_rkt_boom_open').low > by('nd_shot_carbine_open').low, 'the explosion is not lower and heavier than the carbine');
ok(by('nd_shot_shotgun_open').low > by('nd_shot_pistol_open').low, 'the shotgun has no more thump than the pistol');
ok(c('nd_bolt_far') < c('nd_bolt') && by('nd_bolt_far').tail > by('nd_bolt').tail, 'a far enemy shot is not duller and longer than a near one');
ok(errors.length === 0, 'page errors: ' + errors.join('; '));

const pad = (s, n) => String(s).padEnd(n), num = (v, d = 2) => (v == null ? '' : v.toFixed(d));
console.log('| sound | room | s | peak | clip | attack ms | tail s | centroid Hz | <200 Hz | made ms | |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of R) console.log(`| ${pad(r.name.replace(/^nd_/, ''), 22)} | ${pad(r.room || '-', 6)} | ${num(r.dur)} | ${num(r.peak, 3)} | ${r.clip} | ${num(r.attack)} | ${num(r.tail)} | ${num(r.centroid, 0)} | ${(r.low * 100).toFixed(0)} % | ${num(r.ms, 0)} | ${r.pass ? 'pass' : 'FAIL'} |`);
if (fails.length) console.log('\n' + fails.map((f) => 'FAIL  ' + f).join('\n'));
console.log(`\nneon-district sfx: ${R.length} sounds, ${fails.length} failures -> ${fails.length ? 'FAIL' : 'ok'}`);
process.exit(fails.length ? 1 : 0);

// Mirage original code. Node check of the synthesis kit and the table-free sound API (src/sounds.js): a definition
// made with `one` / `fold` renders finite, deterministic, under the limiter's ceiling; variants differ; renderSoundDef,
// soundBuffers and addSoundDefs work on stand-ins and refuse what is not a definition. The library's 125 sounds are
// checked by packages/assets/sounds.check.mjs.
import * as S from './src/sounds.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };
const SR = 48000;
const beep = { n: 3, render: S.one('check-beep', 0.25, (o, sr, R, v) => { S.noiseLayer(o, sr, R, 0, 0.2, S.biquad('bp', 1800 + v * 300, 3, sr), 0.002, 0.05, 0.9); S.thumpLayer(o, sr, 0, 160, 60, 0.05, 0.002, 0.08, 0.6); }) };
const hum = { n: 1, loop: true, render: S.fold('check-hum', 1, (o, sr) => { S.toneLayer(o, sr, 0, 1.5, 120, 0.01, 10, 0.5); }) };
const a = S.renderSoundDef(beep, SR, 1), b = S.renderSoundDef(beep, SR, 1), c = S.renderSoundDef(beep, SR, 2);
ok(a.length === Math.round(0.25 * SR) || a.length > 0, 'renders samples');
ok(a.every(Number.isFinite) && Math.max(...a.map(Math.abs)) <= 0.93, 'finite, under the ceiling');
ok(a.every((x, i) => x === b[i]), 'deterministic per key and variant');
ok(a.some((x, i) => x !== c[i]), 'variants differ');
ok(S.renderSoundDef(beep, SR, 4).every((x, i) => x === a[i]), 'the variant wraps');
ok(S.renderSoundDef(hum, SR).every(Number.isFinite), 'a folded loop renders');
let threw = false; try { S.renderSoundDef(beep, 4000); } catch { threw = true; } ok(threw, 'a rate under 8000 is refused');
threw = false; try { S.addSoundDefs({ add() {} }, { bad: {} }); } catch { threw = true; } ok(threw, 'not a definition: refused');
const ctx = { sampleRate: 22050, createBuffer: (ch, len, sr) => ({ len, sr, copyToChannel(d) { this.d = d; } }) };
const bufs = S.soundBuffers(ctx, beep);
ok(bufs.length === 3 && bufs[0].sr === 22050 && bufs[0].d.length === bufs[0].len, 'soundBuffers: every variant at the context rate');
const added = {};
S.addSoundDefs({ add: (n, make) => { added[n] = make(ctx); } }, { beep, hum }, { prefix: 'x_' });
ok(Array.isArray(added.x_beep) && added.x_beep.length === 3 && !Array.isArray(added.x_hum), 'addSoundDefs: names with the prefix, a list for variants');
ok(Object.keys(S.ROOMS).join() === 'alley,open,indoor' && S.room(new Float32Array(4800), SR, 'alley', S.makeRng(1)).every(Number.isFinite), 'rooms');
console.log(fails ? `sound kit check: ${fails} failed` : 'sound kit check: ok');
process.exit(fails ? 1 : 0);

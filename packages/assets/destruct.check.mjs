// Mirage original code. The destructibles' material classes (@miragekit/assets/destruct) without a GPU: every class
// is there with a sane table, every effect is a valid vfx effect, every sound renders finite under its ceiling, and
// importing the module registers the table with @miragekit/game's system. The system itself is checked by
// packages/game/destruct.check.mjs.
import assert from '../../scripts/soft-assert.mjs';
import { destructData, createDestructibles, DAMAGE_KINDS } from '@miragekit/game/destruct';
import { defineEffect } from '@miragekit/core/vfx-data';
import { DESTRUCT_MATERIALS, DESTRUCT_EFFECTS, DESTRUCT_SOUNDS, destructSoundFactories, registerDestruct } from './src/destruct/index.js';

const lines = [];
for (const k of ['glass', 'paper', 'wood', 'cardboard', 'plastic', 'thinMetal', 'heavyMetal', 'ceramic', 'liquid', 'electronics', 'fabric', 'actor']) assert.ok(DESTRUCT_MATERIALS[k], 'class ' + k);
for (const [k, m] of Object.entries(DESTRUCT_MATERIALS)) {
  assert.ok(m.health > 0 && m.pierce >= 0 && m.pierce <= 1 && Array.isArray(m.stages), `${k}: health, pierce, stages`);
  assert.ok(Object.keys(m.armour).every((d) => DAMAGE_KINDS.includes(d)), `${k}: armour per known damage kind`);
  assert.ok(DESTRUCT_SOUNDS.includes(m.sound), `${k}: its sound set exists`);
  for (const e of [m.fx?.hit, m.fx?.break, ...m.stages.map((s) => s.fx)].filter(Boolean)) assert.ok(DESTRUCT_EFFECTS[e], `${k}: effect ${e} exists`);
}
lines.push(`${Object.keys(DESTRUCT_MATERIALS).length} classes`);
for (const [k, e] of Object.entries(DESTRUCT_EFFECTS)) { let ok = true; try { defineEffect(e); } catch (err) { ok = false; console.log(k, err.message); } assert.ok(ok, 'effect ' + k); }
const ctx = { sampleRate: 22050, createBuffer: (ch, n, sr) => { const d = new Float32Array(n); return { length: n, sampleRate: sr, getChannelData: () => d }; } };
let n = 0;
for (const [k, f] of Object.entries(destructSoundFactories())) {
  const b = [].concat(f(ctx));
  for (const x of b) { const a = x.getChannelData(0); let pk = 0, bad = 0; for (const s of a) { if (!Number.isFinite(s)) bad++; pk = Math.max(pk, Math.abs(s)); } assert.ok(!bad && pk > 0.01 && pk <= 0.91, `sound ${k}: peak ${pk.toFixed(2)}`); n++; }
}
lines.push(`${Object.keys(DESTRUCT_EFFECTS).length} effects valid, ${n} sound buffers`);
// registered on import: a registry made now knows the classes and adds the sounds
const D = destructData();
assert.ok(D.materials === DESTRUCT_MATERIALS && D.effects === DESTRUCT_EFFECTS && D.fallback === 'plastic' && typeof D.addSounds === 'function', 'registered with the system on import');
const added = [];
const d = createDestructibles({ audio: { add: (name) => added.push(name) } }, { floor: 0 });
assert.ok(d.add({ id: 'pane', material: 'glass', box: { center: [0, 1, 0], half: [0.5, 0.5, 0.01] } }) && added.includes('dx_break_glass'), 'a registry made now: glass, its sounds');
assert.equal(registerDestruct().fallback, 'plastic', 'registerDestruct() again');
lines.push('registered');
console.log('destruct data check: ' + lines.join('; '));

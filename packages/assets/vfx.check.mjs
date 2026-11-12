// Mirage original code. Node check of the effect recipes (src/vfx/index.js): every recipe is a valid description
// for core's particle system (defineEffect), bakes its curves, keeps within a particle budget (8,000 for the
// weather that follows the camera, 600 for anything else), says truly whether it loops, and stays near its spawn
// point unless it is meant to travel; a few are checked against the physics they claim. The look is
// examples/demos/vfx-recipes (stills need the GPU).
import { defineEffect, bakeCurves, effectRadius, VFX_LIBRARY } from '@miragekit/core';
import { VFX_RECIPES, VFX_CATEGORIES, vfxNames } from './src/vfx/index.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };
const names = vfxNames();
const FAR = { tracer: 40, fireworkRocket: 60, rainHeavy: 60, drizzle: 60, blizzard: 90, hail: 70, sandstorm: 60, groundFog: 30, ashfall: 35, petals: 25, fountain: 20, drip: 15, iceBurst: 15, lightningStrike: 20 };
for (const n of names) {
  const r = VFX_RECIPES[n];
  let d = null;
  try { d = defineEffect(r.effect); } catch (e) { ok(false, `${n}: ${e.message}`); continue; }
  ok(VFX_CATEGORIES.includes(r.cat) && typeof r.desc === 'string' && r.desc.length > 10, `${n}: a category and a description`);
  ok(d.name === n, `${n}: the effect is named after the recipe`);
  const all = d.emitters.flatMap((e) => [e, ...e.sub.map((s) => s.emitter)]);
  ok(all.every((e) => { const t = bakeCurves(e); return t.every(Number.isFinite); }), `${n}: every emitter bakes finite curves`);
  const cap = all.reduce((a, e) => a + e.capacity, 0), budget = r.cat === 'weather' ? 8000 : 600;
  ok(cap <= budget, `${n}: ${cap} particles at most (budget ${budget})`);
  const loops = d.emitters.some((e) => e.loop && !(e.duration > 0));
  ok(loops === r.loop, `${n}: says loop ${r.loop}, the emitters ${loops ? 'loop' : 'end'}`);
  const rad = Math.max(...d.emitters.map(effectRadius));
  ok(rad < (FAR[n] ?? 14), `${n}: stays within ${(FAR[n] ?? 14)} m of its spawn point (${rad.toFixed(1)} m)`);
  ok(!(n in VFX_LIBRARY), `${n}: does not shadow a core effect`);
}
// physics the descriptions claim
{ const e = defineEffect(VFX_RECIPES.fountain.effect).emitters[0], v = e.velocity.speed[1], h = v * v / (2 * -e.gravity[1]); ok(h > 1.5 && h < 2.1, `fountain: the jet tops out at ${h.toFixed(2)} m (about 1.8)`); }
{ const e = defineEffect(VFX_RECIPES.tracer.effect).emitters[0]; ok(e.velocity.speed[0] * e.life[0] > 25, `tracer: travels ${(e.velocity.speed[0] * e.life[0]).toFixed(0)} m in its life`); }
{ const e = defineEffect(VFX_RECIPES.rainHeavy.effect).emitters[0], fall = e.velocity.speed[0] * e.life[1]; ok(fall > 9.5, `rainHeavy: a drop falls ${fall.toFixed(1)} m in its life, enough to reach the ground from 10 m`); }
ok(VFX_CATEGORIES.every((c) => vfxNames(c).length > 0), 'every category has recipes');
let threw = 0; try { vfxNames('nope'); } catch { threw++; }
ok(threw === 1, 'vfxNames: an unknown category throws');
console.log(fails ? `vfx recipes check: ${fails} failed` : `vfx recipes check: ok (${names.length} recipes in ${VFX_CATEGORIES.length} categories)`);
process.exit(fails ? 1 : 0);

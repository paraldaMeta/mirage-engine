// Node check of the effect description format and the library (no GPU): `node packages/core/vfx.check.mjs`,
// also run by check.mjs. The GPU side is examples/demos/vfx/vfx-check.mjs.
import assert from 'node:assert/strict';
import { defineEffect, evalCurve, bakeCurves, effectRadius, VFX_ENUMS, VFX_LUT_W, parseColor } from './src/vfx-data.js';
import { VFX_LIBRARY } from './src/vfx-library.js';
import { seeded } from './src/vfx-gpu.js';

// defaults, and the three value forms
const fx = defineEffect({ name: 'puff', rate: 40, life: [1.4, 0.8], size: 0.2, alpha: [[1, 0], [0, 1]], color: '#fff' });
const e = fx.emitters[0];
assert.deepEqual(e.life, [0.8, 1.4], 'a range is sorted');
assert.deepEqual(e.size, [0.2, 0.2], 'a number is a constant range');
assert.deepEqual(e.alpha, [[0, 1], [1, 0]], 'curve keys are sorted by time');
assert.equal(e.loop, true, 'an emitter with a rate loops unless told otherwise');
assert.equal(e.capacity, Math.ceil(40 * 1.4 * 1.1), 'capacity is the steady population plus headroom');
assert.equal(defineEffect({ bursts: [{ count: 30 }], life: 1 }).emitters[0].capacity, 30, 'a burst-only emitter holds its burst');
assert.equal(defineEffect({ bursts: [{ count: 10, every: 0.5 }], life: 2 }).emitters[0].capacity, 40, 'repeating bursts overlap one life');
assert.equal(defineEffect(fx), fx, 'a defined effect passes through');
// JSON round trip: the defined effect is itself a description, and defining it again changes nothing
for (const [name, d] of Object.entries(VFX_LIBRARY)) {
  const a = defineEffect(d), b = defineEffect(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), `${name}: define(JSON(define(x))) is stable`);
  assert.equal(a.name, name);
  for (const em of a.emitters) {
    assert.ok(em.capacity >= 1 && em.capacity <= 1 << 20, `${name}.${em.name} capacity ${em.capacity}`);
    const r = effectRadius(em); assert.ok(r > 0 && r < 200, `${name}.${em.name} radius ${r}`);
    const lut = bakeCurves(em); assert.equal(lut.length, VFX_LUT_W * 8); assert.ok(lut.every(Number.isFinite), `${name}.${em.name} lut is finite`);
  }
}
assert.deepEqual(Object.keys(VFX_LIBRARY).sort(), ['dust', 'explosion', 'fire', 'fireflies', 'leaves', 'magic', 'smoke', 'snow', 'sparks', 'splash']);

// mistakes are named with their path
const bad = (d, re) => assert.throws(() => defineEffect(d), re);
bad({ rat: 3 }, /effect\.rat is not a known key/);
bad({ emitters: [{ rate: 1 }, { shape: { type: 'cube' } }] }, /emitters\[1\]\.shape\.type must be one of/);
bad({ render: { blend: 'screen' } }, /effect\.render\.blend/);
bad({ color: [[0, 'red']] }, /effect\.color\[0\] must be '#rrggbb'/);
bad({ life: 'long' }, /effect\.life/);
bad({ shape: { type: 'mesh' } }, /shape\.mesh names a mesh/);
bad({ attractors: [{}, {}, {}, {}, {}] }, /holds at most 4/);
bad({ sub: [{ emitter: { sub: [{ emitter: {} }] } }] }, /do not nest/);
bad({ sub: [{ on: 'death' }] }, /emitter is required/);
bad({ collision: { planes: [[0, 1, 0]] } }, /planes\[0\] must be \[nx, ny, nz, d\]/);
bad({ emitters: [] }, /is empty/);
bad(null, /must be an object/);

// curves and the baked lookup
const c = [[0, 0], [0.5, 2], [1, 1]];
assert.equal(evalCurve(c, -1), 0); assert.equal(evalCurve(c, 0.25), 1); assert.equal(evalCurve(c, 0.75), 1.5); assert.equal(evalCurve(c, 2), 1);
const lut = bakeCurves(defineEffect({ color: [[0, '#ff0000'], [1, '#0000ff']], alpha: [[0, 1], [1, 0]], sizeOverLife: [[0, 1], [1, 3]], spinOverLife: [[0, 2], [1, 0]] }).emitters[0]);
const W = VFX_LUT_W, at = (row, i, ch) => lut[(row * W + i) * 4 + ch];
assert.ok(Math.abs(at(0, 0, 0) - 1) < 1e-6 && at(0, 0, 2) === 0 && Math.abs(at(0, W - 1, 2) - 1) < 1e-6, 'gradient ends');
assert.ok(Math.abs(at(0, W - 1, 3)) < 1e-6 && Math.abs(at(1, W - 1, 0) - 3) < 1e-6, 'alpha and size ends');
assert.ok(Math.abs(at(1, W - 1, 3) - 1) < 1e-3, `the spin integral of 2→0 over a life is 1 (${at(1, W - 1, 3)})`);
assert.ok(Math.abs(parseColor('#808080')[0] - 0.2158) < 1e-3, 'colours are linearised');
// bounds: an explicit value wins; drag shortens the reach; sub-emitters add theirs
const R = (d) => effectRadius(defineEffect(d).emitters[0]);
assert.equal(R({ bounds: 7 }), 7);
assert.ok(R({ velocity: { speed: 10 }, life: 2, drag: 3 }) < R({ velocity: { speed: 10 }, life: 2 }));
assert.ok(Math.abs(R({ velocity: { speed: 10 }, life: 2, size: 0 }) - 20) < 1e-9);
assert.ok(R({ life: 1, sub: [{ emitter: { velocity: { speed: 5 }, life: 1 } }] }) > 5);
assert.ok(VFX_ENUMS.SHAPES.includes('mesh') && VFX_ENUMS.MODES.join() === 'bounce,kill,stick');
const r1 = seeded(5), r2 = seeded(5); assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()], 'seeded() repeats');
console.log(`vfx check: ok (${Object.keys(VFX_LIBRARY).length} library effects, ${Object.values(VFX_LIBRARY).reduce((n, d) => n + defineEffect(d).emitters.length, 0)} emitters)`);

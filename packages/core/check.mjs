// One runnable self-check for the non-trivial pure logic: `npm test -w @mirage/core`
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rng, skyAt, placeDate, skyState, lightAt, transmitAtGround, geom } from './src/index.js';

const a = rng('x'), b = rng('x');
assert.deepEqual([a.next(), a.int(1, 6), a.gauss()], [b.next(), b.int(1, 6), b.gauss()], 'rng is deterministic');
assert.notEqual(rng('x').next(), rng('y').next(), 'names give independent streams');

// Kyoto, 2026-06-21 ~11:59 JST: the Sun near its highest, ~78.4° (90 - 35.01 + 23.44)
const s = skyAt(placeDate('2026-06-21', '11:59', 9), { lat: 35.01, lon: 135.77 });
assert.ok(Math.abs(s.sun.elevation - 78.4) < 0.6 && Math.abs(s.sun.azimuth - 180) < 8, `solar noon ${s.sun.elevation} ${s.sun.azimuth}`);

assert.equal(+lightAt(skyState('golden')).exposure.toFixed(6), 1, 'the golden hour is the exposure reference');
const t = transmitAtGround(90), t5 = transmitAtGround(5);
assert.ok(t[2] < t[0] && t5[2] < t[2] && t[0] > 0.8, 'blue is lost first, more so near the horizon');
assert.ok(lightAt(skyState({ day: '2026-10-25', time: '22:00' }, { lat: 35, lon: 135.8, tzHours: 9 })).keyIsMoon, 'the Moon is the key light at night');

const w = geom.wall({ length: 10, height: 4, thickness: 0.5, openings: [{ x: 0, width: 2, height: 2, arch: 'pointed' }, { x: 3, width: 1, height: 2, sill: 1, arch: 'round' }] });
w.computeBoundingBox();
assert.ok(w.attributes.position.count > 100 && Math.abs(w.boundingBox.max.y - 4) < 1e-6, 'wall with openings');
const p = geom.archPath(new THREE.Path().moveTo(-1, 2), -1, 1, 2, 'pointed', 0.8), end = p.currentPoint;
assert.ok(Math.abs(end.x - 1) < 1e-6 && Math.abs(end.y - 2) < 1e-6, 'arch ends on the far jamb');
console.log('core check: ok');

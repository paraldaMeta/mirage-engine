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
// B21: an iPad's Safari says "Macintosh" (a desktop user agent) but has a touch screen
const { pickQuality } = await import('./src/index.js');
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
assert.equal((await pickQuality({ storage: null, nav: { userAgent: SAFARI, maxTouchPoints: 5 } })).quality, 'low', 'an iPad gets low');
assert.equal((await pickQuality({ storage: null, nav: { userAgent: SAFARI, maxTouchPoints: 0 } })).quality, 'medium', 'a Mac gets medium');
// wrong time or place: a TypeError that names the field, not a world lit with NaN (review #12)
{
  const K = { lat: 35, lon: 135.8, tzHours: 9 };
  for (const [t, p, field] of [['noon', K, 'time'], [{ time: '18:00' }, K, 'time.day'], [{ elevation: 10 }, K, 'fixed sun'],
    [{ day: '2026-10-25', time: '6pm' }, K, 'time.time'], [new Date('nope'), K, 'invalid date'], [{ day: '2026-10-25' }, { lat: 35 }, 'place']]) {
    assert.throws(() => skyState(t, p), (e) => e instanceof TypeError && e.message.toLowerCase().includes(field.split(' ')[0].toLowerCase()), `${JSON.stringify(t)} names ${field}`);
  }
  const iso = skyState('2026-10-25T13:00:00Z', K), same = skyState(new Date('2026-10-25T13:00:00Z'), K);
  assert.equal(iso.sun.elevation, same.sun.elevation, 'an ISO string is that instant');
  for (const st of [iso, skyState({ day: '2026-10-25', time: '22:00' }, K), skyState({ elevation: 5, azimuth: 250 })]) {
    assert.ok(Object.values(lightAt(st)).flat().every((v) => typeof v !== 'number' || Number.isFinite(v)), 'every light value is finite');
  }
}
// texture set names reach GLSL identifiers: anything but letters, digits and _ is spelled out (review #21)
{
  const { glslName } = await import('./src/textures.js');
  assert.equal(glslName('stone_wall'), 'stone_wall', 'plain names unchanged');
  assert.match(glslName('stone-wall.v2'), /^[A-Za-z0-9_]+$/, 'dashes and dots become identifier characters');
  assert.notEqual(glslName('a-b'), glslName('a.b'), 'distinct names stay distinct');
}
// review 2026-11-09 (core)
{
  // taperedTube's sides face outward, with their normals (every side triangle faced in)
  const g = geom.taperedTube([[0, 0, 0], [0, 1, 0], [0, 2, 0]], [0.3, 0.2, 0.1], { capEnd: false });
  const P = g.attributes.position, N = g.attributes.normal, I = g.index.array, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  let inward = 0;
  for (let t = 0; t < I.length; t += 3) {
    A.fromBufferAttribute(P, I[t]); B.fromBufferAttribute(P, I[t + 1]); C.fromBufferAttribute(P, I[t + 2]);
    const face = B.clone().sub(A).cross(C.clone().sub(A)), n = new THREE.Vector3().fromBufferAttribute(N, I[t]);
    if (face.dot(n) < 0) inward++;
  }
  assert.equal(inward, 0, `taperedTube faces outward (${inward} of ${I.length / 3} inward)`);
  // a segmental arch whose rise is the span: up to (0, rise) at the middle, the ends on the springing line
  const pts = geom.archPath(new THREE.Path().moveTo(-0.5, 0), -0.5, 0.5, 0, 'segmental', 1, 32).getPoints();
  const top = Math.max(...pts.map((q) => q.y)), last = pts.at(-1);
  assert.ok(Math.abs(top - 1) < 1e-3 && Math.abs(last.x - 0.5) < 1e-6 && Math.abs(last.y) < 1e-6, `stilted segmental arch reaches its rise (${top.toFixed(3)}) and lands at (${last.x.toFixed(3)}, ${last.y.toFixed(3)})`);
  // wind with no direction is still air, not NaN
  const { createEnv } = await import('./src/env.js');
  const wv = createEnv({ wind: { dir: [0, 0], strength: 0 } }).G.uWind.value;
  assert.ok([wv.x, wv.y, wv.z].every(Number.isFinite), 'wind dir [0, 0] gives a finite uniform');
  // refraction has no step below the horizon
  const { refraction } = await import('./src/sky-time.js');
  for (let a = -3.5; a < 1; a += 0.01) assert.ok(Math.abs(refraction(a + 0.01) - refraction(a)) < 0.02, `refraction is continuous at ${a.toFixed(2)}°`);
}
// light2: importing it changes nothing; installing patches the light loop once, keeps three's code for other fog
const L2 = await import('./src/light2.js');
const chunk0 = THREE.ShaderChunk.lights_fragment_begin, common0 = THREE.ShaderChunk.common;
assert.equal(L2.light2Config(false), null, 'light2 off by default');
const c2 = L2.light2Config({ ssr: false, vol: { lamps: 3 } });
assert.ok(c2.ls.on && !c2.ssr.on && c2.vol.lamps === 3 && c2.vol.sun === L2.LIGHT2_DEFAULTS.vol.sun && c2.bloom.on, 'light2 config merges');
assert.equal(THREE.ShaderChunk.lights_fragment_begin, chunk0, 'importing light2 patches nothing');
assert.ok(L2.installLight2() && L2.installLight2(), 'light2 installs (idempotent)');
const lfb = THREE.ShaderChunk.lights_fragment_begin;
assert.equal(lfb.split('mgLsVisV').length, 2, 'one lamp-shadow lookup in the point-light loop');
assert.ok(THREE.ShaderChunk.common.startsWith(common0) && THREE.ShaderChunk.common.includes('defined( FOG_EXP2 )'), 'lamp shadows only under FogExp2');
assert.ok(THREE.ShaderChunk.opaque_fragment.includes('gl_FragColor.a = 2.0'), 'smooth surfaces flag reflections');
assert.ok(THREE.ShaderLib.standard.uniforms.mgLsAtlas.value === L2.LS_SHARED.atlas && L2.LS_SHARED.atlas.clone() === L2.LS_SHARED.atlas, 'one shared atlas, never cloned');
console.log('core check: ok');

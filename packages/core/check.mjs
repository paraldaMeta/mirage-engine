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
assert.ok(THREE.ShaderChunk.opaque_fragment.includes('gl_FragColor.a = -clamp'), 'smooth surfaces flag reflections');
assert.ok(THREE.ShaderLib.standard.uniforms.mgLsAtlas.value === L2.LS_SHARED.atlas && L2.LS_SHARED.atlas.clone() === L2.LS_SHARED.atlas, 'one shared atlas, never cloned');

// relief (opt-in close-range detail): soft geometry stays inside the plain bounds; opting out changes nothing
const { setRelief, RELIEF, RELIEF_GLSL, PROC, createMaterials, createTextures, createEnv } = await import('./src/index.js');
const bb = (g) => (g.computeBoundingBox(), g.boundingBox);
const within = (a, b, eps = 1e-6) => a.min.x >= b.min.x - eps && a.min.y >= b.min.y - eps && a.min.z >= b.min.z - eps && a.max.x <= b.max.x + eps && a.max.y <= b.max.y + eps && a.max.z <= b.max.z + eps;
const wo = { length: 10, height: 4, thickness: 0.5, openings: [{ x: 0, width: 2, height: 2, arch: 'pointed' }, { x: 3, width: 1, height: 2, sill: 1, arch: 'round' }] };
// a rounded wall keeps the plain wall's bounds above ground (its foot's chamfer is cut below y = 0), also with
// openings close to the top, an end or each other (the chamfer shrinks so the inset contours never cross)
const above = (g) => { const b = bb(g).clone(); b.min.y = Math.max(b.min.y, 0); return b; };
for (const [name, o] of [['two openings', wo],
  ['apex 4 cm under the top', { length: 6, height: 3.8, thickness: 0.6, openings: [{ x: 0, width: 2.4, height: 2.3, arch: 'pointed', rise: 0.8 }] }],
  ['window 3 cm under the top', { length: 10, height: 4, thickness: 0.5, openings: [{ x: 0, width: 1, height: 3.47, sill: 1, arch: 'round' }] }],
  ['door 3 cm from the end', { length: 10, height: 4, thickness: 0.5, openings: [{ x: -4.47, width: 1, height: 2, arch: 'flat' }] }],
  ['door flush with the end', { length: 10, height: 4, thickness: 0.5, openings: [{ x: -4.5, width: 1, height: 2, arch: 'flat' }] }],
  ['a 4 cm pier', { length: 10, height: 4, thickness: 0.5, openings: [{ x: 0, width: 1, height: 2, arch: 'round' }, { x: 1.04, width: 1, height: 2, arch: 'round' }] }]]) {
  const plainB = bb(geom.wall(o)), softG = geom.wall({ ...o, round: 0.05 }), softB = above(softG);
  assert.ok(within(softB, plainB, 1e-5) && within(plainB, softB, 1e-4), `rounded wall keeps the plain bounds above ground: ${name}`);
  assert.ok(bb(softG).min.y >= -0.08, `the foot's chamfer stays just below ground: ${name}`);
}
assert.ok(within(bb(geom.softBox(1, 0.5, 0.3)), bb(new THREE.BoxGeometry(1, 0.5, 0.3))), 'softBox inside the box');
assert.equal(geom.softBox(1, 0.08, 1).type, 'BoxGeometry', 'thin parts stay sharp');
const soot = geom.sootPlumes([{ pos: [0, 2, 0], rotY: 0 }, { pos: [1, 2, 0], normal: [0, 0, 1], scale: 0.5 }]);
assert.ok(soot.geometry.attributes.position.count === 8 && soot.material.depthWrite === false && !soot.castShadow, 'two soot quads, no depth, no shadow');
assert.equal(geom.sootPlumes([]), null);
assert.equal(geom.sootPlumes([{ normal: [0, 0, 1] }, { pos: [0, 1, 0], normal: [0, 1, 0] }]), null, 'no usable soot entry: null');
assert.equal(setRelief(0), 0); assert.equal(RELIEF.uRelief.value, 0);
setRelief(0.5); assert.ok(RELIEF.uRelief.value === 1 && Math.abs(RELIEF.uReliefFar.value - 4) < 1e-9, 'half level halves the reach');
setRelief(1); assert.equal(RELIEF.uReliefFar.value, 8);
assert.ok(/float mgRlFade[\s\S]*isOrthographic/.test(RELIEF_GLSL), 'the relief is off in orthographic views');
assert.equal(JSON.stringify(PROC.plaster()), JSON.stringify(PROC.plaster(undefined, { render: 0 })), 'no render: the same hooks');
assert.ok(!JSON.stringify(PROC.plaster()).includes('mgRl') && PROC.plaster(undefined, { render: 0.009 }).albedo.includes('mgRlRenderH'), 'render only on request');
// the texture layer: without relief / render a material's hooks are exactly the old ones
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const G = createEnv({}).G, kit = createMaterials(G);
const tx = createTextures({ renderer: { capabilities: { getMaxAnisotropy: () => 8 } }, mat: kit }, { manifest: { sets: { s: { tile: 2, mean: [0.2, 0.2, 0.2], hMean: 0.5, rough: 0.7, files: { c: 'c', n: 'n' } } } }, url: '' });
const h0 = tx.material('s', { mapping: 'wall' }).userData.hooks, h1 = tx.material('s', { mapping: 'wall', relief: 0.02, render: 0.009 }).userData.hooks;
assert.ok(!JSON.stringify(h0).includes('Relief') && !('lighting' in h0) && !('uRelief' in h0.uniforms), 'no relief unless asked');
assert.ok(h1.albedo.includes('mgTexWallRelief(') && h1.albedo.includes(', 0.02); diffuse') && h1.lighting.includes('mgRlSh') && 'uRelief' in h1.uniforms, 'relief taps, self-shadow and uniforms');
console.log('core check: ok');

// ---------------------------------------------------------------- soft sun shadows (softshadow.js, opt-in)
// config parsing; nothing patched or written before install; a chunk mismatch warns and patches nothing; install
// patches the sun's call once (idempotent), leaves spot / point / light2 paths alone; uniforms depend on k only
{
  const SS = await import('./src/softshadow.js');
  const C = THREE.ShaderChunk;
  assert.equal(SS.softShadowConfig(false), null, 'soft shadows off by default');
  assert.equal(SS.softShadowConfig(undefined), null);
  assert.deepEqual(SS.softShadowConfig(true), SS.SOFTSHADOW_DEFAULTS, 'true = the defaults');
  const sc = SS.softShadowConfig({ sunAngle: 2, blockerSamples: 99, filterSamples: 0.2, blockerSteps: 0, maxPenumbra: 'wide', on: false });
  assert.ok(sc.sunAngle === 2 && sc.blockerSamples === 32 && sc.filterSamples === 1 && sc.blockerSteps === 0 && !sc.on, 'clamped to the compiled maxima');
  assert.equal(sc.maxPenumbra, SS.SOFTSHADOW_DEFAULTS.maxPenumbra, 'a non-number keeps the default');
  const cam = new THREE.OrthographicCamera(-17, 17, 17, -17, 17, 85), size = new THREE.Vector2(4096, 4096);
  SS.softShadowUniforms(SS.softShadowConfig(true), cam, size, 3);
  assert.ok(!SS.softShadowsInstalled() && SS.SS_SHARED.a.every((v) => v === 0), 'no uniform written before install');
  const pars0 = C.shadowmap_pars_fragment, lfb0 = C.lights_fragment_begin;
  // fallback: a three whose chunks moved keeps its PCF (warning, nothing patched)
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  C.lights_fragment_begin = lfb0.replace('? getShadow( directionalShadowMap', '? getShadowMoved( directionalShadowMap');
  const moved = C.lights_fragment_begin;
  assert.equal(SS.installSoftShadows(), false, 'chunk mismatch: not installed');
  console.warn = warn;
  assert.ok(warned === 1 && C.lights_fragment_begin === moved && C.shadowmap_pars_fragment === pars0 && !THREE.ShaderLib.standard.uniforms.mgSsA && !SS.softShadowsInstalled(), 'mismatch: one warning, nothing patched');
  C.lights_fragment_begin = lfb0;
  assert.ok(SS.installSoftShadows() && SS.installSoftShadows(), 'soft shadows install (idempotent)');
  const pars = C.shadowmap_pars_fragment, lfb = C.lights_fragment_begin;
  assert.ok(pars.startsWith(pars0) && pars.split('float mgSoftShadow(').length === 2, 'mgSoftShadow appended once');
  assert.ok(pars.includes('defined( FOG_EXP2 )') && pars.includes('NUM_DIR_LIGHT_SHADOWS > 0'), 'only Mirage materials with a sun shadow');
  assert.equal(lfb.split('mgSoftShadow(').length, 2, 'one soft call: the directional loop');
  assert.ok(/#ifdef MG_SS[\s\S]*UNROLLED_LOOP_INDEX == 0 && mgSsA\.x > 0\.5[\s\S]*#else[\s\S]*getShadow\( directionalShadowMap[\s\S]*#endif/.test(lfb), 'the first directional light, runtime switch, stock path kept');
  const lp = lfb.indexOf('mgSoftShadow('), loopA = lfb.lastIndexOf('#pragma unroll_loop_start', lp), loopB = lfb.indexOf('#pragma unroll_loop_end', lp);
  assert.ok(loopA >= 0 && loopB > lp && lfb.slice(loopA, lp).includes('directionalLights[ i ]'), 'inside the unrolled directional loop');
  assert.equal(lfb.split('getShadow( spotShadowMap').length, lfb0.split('getShadow( spotShadowMap').length, 'spot shadows untouched');
  assert.equal(lfb.split('getPointShadow(').length, lfb0.split('getPointShadow(').length, 'point shadows untouched');
  assert.equal(lfb.split('mgLsVisV').length, 2, 'light2 lamp shadows untouched');
  assert.equal(C.shadowmask_pars_fragment.includes('mgSoftShadow'), false, 'ShadowMaterial keeps three\'s');
  const U = THREE.ShaderLib.standard.uniforms;
  assert.ok(U.mgSsA.value === SS.SS_SHARED.a && THREE.UniformsUtils.clone(U).mgSsA.value === SS.SS_SHARED.a, 'shared uniforms, kept by reference');
  // uniforms: on, a golden-ratio phase of the sub-frame index, the penumbra scale in map uv, the depth scale
  SS.softShadowUniforms(SS.softShadowConfig(true), cam, size, 3);
  const a1 = [...SS.SS_SHARED.a], b1 = [...SS.SS_SHARED.b];
  assert.ok(a1[0] === 1 && Math.abs(a1[1] - ((3 * 0.6180339887498949) % 1)) < 1e-6, 'on, phase of k = 3');
  assert.ok(Math.abs(a1[2] - Math.tan((0.53 * Math.PI) / 360) / 34) < 1e-9 && Math.abs(a1[3] - Math.min(0.3 / 68, 48 / 8192)) < 1e-9, 'penumbra scale and clamp (uv)');
  assert.ok(Math.abs(b1[0] - 1 / 68) < 1e-9 && Math.abs(b1[2] - a1[3] / a1[2]) < 1e-3, 'depth per metre, farthest blocker searched');
  SS.softShadowUniforms(SS.softShadowConfig(true), cam, size, 3);
  assert.deepEqual([...SS.SS_SHARED.a], a1, 'the same sub-frame index gives the same pattern');
  SS.softShadowUniforms(SS.softShadowConfig({ on: false }), cam, size, 3);
  assert.equal(SS.SS_SHARED.a[0], 0, 'on: false switches the patched path off');
  SS.softShadowUniforms(SS.softShadowConfig(true), cam, size, 1); SS.softShadowUniforms(null, cam, size, 1);
  assert.equal(SS.SS_SHARED.a[0], 0, 'a world without soft shadows writes off');
  console.log('softshadow check: ok');
}

// One runnable self-check for the non-trivial pure logic: `npm test -w @mirage/core`
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { rng, skyAt, placeDate, skyState, lightAt, transmitAtGround, geom } from './src/index.js';
import { dynamicResConfig } from './src/world.js';
import { DEFAULT_POST } from './src/post.js';

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
// ambient-only AO, auto exposure, dynamic resolution: off by default
assert.ok(DEFAULT_POST.aoLit === 0 && DEFAULT_POST.autoExposure === 0, 'aoLit and autoExposure are off by default');
assert.equal(dynamicResConfig(undefined), null); assert.equal(dynamicResConfig(false), null);
assert.deepEqual(dynamicResConfig(true), { target: 60, min: 0.6, step: 0.1 });
assert.deepEqual(dynamicResConfig({ target: 1000, min: 0, step: NaN }), { target: 240, min: 0.25, step: 0.1 }, 'clamped, NaN falls back');

// ---------------------------------------------------------------------------------------------------------------
// wet surfaces (wet.js, opt-in). Materials without withWet compile exactly as before. A wet material's wet code sits
// inside #ifdef MG_WET, a define that setWetness keeps on the opted-in materials only while the wetness is above 0:
// at setWetness(0) its program, once preprocessed, is the dry one (the image bit-identical; in the browser:
// examples/hello-courtyard/NOTES.md).
// ---------------------------------------------------------------------------------------------------------------
{
  const { WET, WET_GLSL, setWetness, setRain, withWet, RELIEF_GLSL: RG, PROC: PR, createMaterials: CM, createEnv: CE } = await import('./src/index.js');
  assert.ok(WET.uWet.value === 0 && WET.uRain.value === 0, 'wet and rain are off by default');
  assert.deepEqual([setWetness(2), setWetness(-1), setWetness(NaN), setWetness(0.4)], [1, 0, 0, 0.4], 'setWetness clamps to 0..1');
  assert.deepEqual([setRain(3), setRain(0.5)], [1, 0.5], 'setRain clamps to 0..1');
  setWetness(0); setRain(0);
  // composes with the relief and with PROC: every original hook is kept, in front of the wet code
  const base = PR.plaster(undefined, { render: 0.009 }), frozen = JSON.stringify(base), wet = withWet(base, { porosity: 0.8, puddles: 0 });
  assert.equal(JSON.stringify(base), frozen, 'withWet does not touch its input');
  for (const k of ['albedo', 'normal', 'output']) assert.ok(wet[k].startsWith(base[k]), `wet keeps the ${k} hook first`);
  assert.ok(wet.fragmentDecl.includes(RG) && wet.fragmentDecl.includes(WET_GLSL) && wet.fragmentDecl.endsWith(base.fragmentDecl), 'relief and wet GLSL together');
  assert.ok('uRelief' in wet.uniforms && wet.uniforms.uWet === WET.uWet && wet.uniforms.uRain === WET.uRain && wet.uniforms.mgWetP.value.w === 0, 'relief and wet uniforms (wet by reference)');
  assert.ok(withWet({}, { height: 'mgS.h', heightMid: 0.55 }).metalness.includes('0.012 * ((mgS.h) - 0.55)'), 'height bias about its mean');
  const plane = new THREE.Object3D(), parent = new THREE.Group();
  parent.position.y = 1; plane.position.y = 0.5; parent.add(plane);
  assert.equal(withWet({}, { ground: plane }).uniforms.mgWetP.value.y, 1.5, 'ground from an Object3D (its world y)');
  assert.equal(withWet({}, { ground: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.25) }).uniforms.mgWetP.value.y, -0.25, 'ground from a Plane');
  assert.throws(() => withWet({}, { ground: 'floor' }), TypeError);
  assert.throws(() => withWet({}, { heightScale: Infinity }), RangeError);
  // the patched shader: each wet part after the chunk it needs
  const Gw = CE({}).G, kw = CM(Gw);
  const fragOf = (h) => {
    const m = kw.std({ roughness: 0.8 }, h), sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
    m.onBeforeCompile(sh); return { m, fs: sh.fragmentShader, u: sh.uniforms };
  };
  const dry = fragOf(base), wt = fragOf(wet), fs = wt.fs;
  const at = (s) => fs.indexOf(s);
  assert.ok(at('#include <metalnessmap_fragment>') < at('mgWetApply(mgWorldPos') && at('#include <normal_fragment_begin>') < at('#include <normal_fragment_maps>') && at('#include <normal_fragment_maps>') < at('mgWetNormal(normal, nonPerturbedNormal'), 'wet hooks follow metalness and the normal maps');
  assert.ok(at('#include <lights_fragment_end>') < at('material.roughness = max(material.roughness') && at('material.roughness = max(material.roughness') < at('#include <opaque_fragment>'), 'the reflection floor comes after the lighting');
  // a tiny preprocessor: drop the #ifdef / #if defined blocks of a macro that is not defined, then compare the code
  const pre = (src, macro) => {
    const out = [], stack = [];
    for (const raw of src.split('\n')) {
      const l = raw.trim(), off = stack.includes(true);
      if (/^#if/.test(l)) { stack.push(l === `#ifdef ${macro}` || (l.startsWith('#if ') && l.includes(`defined(${macro})`) && !l.includes('||'))); if (!stack.at(-1) && !off) out.push(l); continue; }
      if (l === '#endif') { if (!stack.pop() && !stack.includes(true)) out.push(l); continue; }
      if (!off && l) out.push(l);
    }
    return out.join('\n');
  };
  assert.ok(!/mgWet|uWet|MG_WET/.test(dry.fs), 'the dry program has no wet line');
  assert.equal(pre(fs, 'MG_WET'), pre(dry.fs, 'MG_WET'), 'wet program without MG_WET = the dry program');
  assert.ok(/#if defined\(MG_WET\)\n\s*roughnessFactor = mgSpecAA\(/.test(fs) && !dry.fs.includes('mgSpecAA(roughnessFactor'), 'no AA dry: AA only while wet');
  const stoneH = PR.stone(), stoneDry = fragOf(stoneH).fs, stoneWet = fragOf(withWet(stoneH)).fs;
  assert.ok(stoneDry.includes('\troughnessFactor = mgSpecAA(') && !stoneWet.includes('defined(MG_WET)') && pre(stoneWet, 'MG_WET') === pre(stoneDry, 'MG_WET'), 'AA dry: the same unconditional AA');
  assert.equal(fragOf({ albedo: 'roughnessFactor;', specAA: false }).fs.includes('mgSpecAA(roughnessFactor'), false, 'specAA: false');
  assert.ok(wt.u.uWet === WET.uWet && wt.u.mgWetP && !('uWet' in dry.u) && !('uWet' in Gw), 'wet uniforms only in wet materials, never in the shared G');
  // MG_WET follows the wetness on the materials that opted in, and only on them; crossing 0 asks for a recompile
  const v0 = wt.m.version, dv = dry.m.version;
  assert.ok(!('MG_WET' in (wt.m.defines || {})), 'dry: no MG_WET');
  setWetness(0.6);
  assert.ok('MG_WET' in wt.m.defines && wt.m.version > v0 && !('MG_WET' in (dry.m.defines || {})) && dry.m.version === dv, 'wet > 0: MG_WET on wet materials only, recompiled');
  const v1 = wt.m.version; setWetness(0.9);
  assert.equal(wt.m.version, v1, 'changing the level above 0 recompiles nothing');
  const late = kw.std({}, withWet({}));
  assert.ok('MG_WET' in late.defines, 'a material made while wet starts wet');
  setWetness(0);
  assert.ok(!('MG_WET' in wt.m.defines) && !('MG_WET' in late.defines) && wt.m.version > v1, 'back to 0: the dry program again');
  // per-material numbers are a uniform: two porosities share one program
  const p1 = kw.std({}, withWet(base, { porosity: 0.2 })), p2 = kw.std({}, withWet(base, { porosity: 0.9, ground: 3, band: 0.1 }));
  assert.equal(p1.customProgramCacheKey(), p2.customProgramCacheKey(), 'porosity / ground / band share a program');
  assert.notEqual(p1.customProgramCacheKey(), dry.m.customProgramCacheKey(), 'a wet material is its own program');
  // the ripples depend on uTime only (no wall clock, no frame counter), the GLSL is guarded
  assert.ok(WET_GLSL.includes('uTime / P') && !/uFrame|gl_FragCoord/.test(WET_GLSL) && WET_GLSL.trim().startsWith('#ifdef MG_WET\n#ifndef MG_WET_GLSL'), 'ripples from uTime, guarded');
}
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

// metal PROCs (brushed, hammered, patina) and reduced motion's settings
{
  const { PROC: PM, createMaterials: CM, createEnv: CE } = await import('./src/index.js');
  const { reducedMotionConfig } = await import('./src/world.js');
  for (const name of ['brushed', 'hammered', 'patina']) {
    const h = PM[name]();
    assert.ok(h.fragmentDecl.includes('float mgH;') && h.albedo.includes('mgH =') && h.normal.includes('mgBump'), name + ': a PROC like the others (mgH, a bump)');
    assert.ok(h.roughness.includes('roughnessFactor'), name + ': the pattern reaches the roughness');
    assert.equal(JSON.stringify(PM[name]()), JSON.stringify(h), name + ': the same hooks every call (one program)');
    const m = CM(CE().G).std({ metalness: 1 }, h);
    assert.equal(m.userData.hooks, h, name + ': patches a standard material');
  }
  assert.ok(PM.brushed(undefined, { axis: 'y' }).albedo.includes('vec3(160.000, 0.900, 160.000)'), 'brushed: stretched along its axis');
  assert.throws(() => PM.brushed(undefined, { axis: 'w' }), /axis/);
  assert.ok(PM.patina().metalness.includes('metalnessFactor') && PM.patina(undefined, { amount: 9 }).albedo === PM.patina(undefined, { amount: 1 }).albedo, 'patina: verdigris is not metal; amount clamped');
  assert.equal(reducedMotionConfig(false), null);
  assert.deepEqual(reducedMotionConfig(true), { sway: 0.25, rain: 0.4 });
  assert.deepEqual(reducedMotionConfig({ sway: 2, rain: -1 }), { sway: 1, rain: 0 }, 'clamped to 0..1');
  assert.deepEqual(reducedMotionConfig({ sway: NaN }), { sway: 0.25, rain: 0.4 });
  console.log('metals, reduced-motion config: ok');
}

// streaming helpers (stream.js): the job queue's priority order and concurrency, the LRU's byte budget with pins,
// the upload budget's per-frame split, byte estimates
{
  const S = await import('./src/stream.js');
  const order = [], dist = { a: 5, b: 1, c: 3, d: 2 };
  let live = 0, peak = 0;
  const q = S.createJobQueue({ concurrency: 2, priority: (j) => dist[j.key] });
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const job = (k) => async () => { live++; peak = Math.max(peak, live); order.push(k); await tick(); live--; return k; };
  // a and b start at once (two slots); then d (2) before c (3): the lowest priority first, not the order added
  let ps = ['a', 'b', 'c', 'd'].map((k) => q.add(k, job(k)));
  assert.equal(q.add('c', job('c')), ps[2], 'a key already queued returns its promise');
  await Promise.all(ps);
  assert.deepEqual(order, ['a', 'b', 'd', 'c'], 'the first two run at once, then the lowest priority first');
  order.length = 0;
  ps = ['a', 'b', 'c', 'd'].map((k) => q.add(k, job(k)));
  dist.d = 9;   // read at every pick, not when added: d moved away
  await Promise.all(ps);
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'the priority follows the viewer');
  assert.equal(peak, 2, 'at most `concurrency` at once');
  const q2 = S.createJobQueue({ concurrency: 1 });
  q2.add('x', tick); const cancelled = q2.add('y', tick).catch((e) => e.cancelled);
  assert.ok(q2.cancel('y') && (await cancelled) === true, 'a waiting job can be cancelled');
  await q2.idle();
  assert.ok(!q2.waiting && !q2.running, 'idle');

  const out = [];
  const lru = S.createLRU({ budget: 100, evict: (k) => out.push(k) });
  lru.set('a', 1, 40); lru.set('b', 2, 40); lru.pin('a'); lru.get('b');
  lru.set('c', 3, 40);   // 120 > 100: a is pinned, b is the oldest unpinned
  assert.deepEqual(out, ['b'], 'the least recently used unpinned entry goes first');
  lru.unpin('a'); lru.set('d', 4, 40);
  assert.deepEqual(out, ['b', 'a'], 'unpinned, a goes next');
  assert.equal(lru.bytes, 80, 'bytes after eviction');

  const tex = (w) => { const t = new THREE.Texture({ width: w, height: w }); t.needsUpdate = true; return t; };
  const up = [], fake = { initTexture: (t) => up.push(t) };
  const ub = S.createUploadBudget(fake, { bytes: 5 * 1024 * 1024 });
  const big = tex(1024), small = [tex(512), tex(512)], late = new THREE.Texture();
  ub.add(big, small, late);
  assert.equal(S.textureBytes(big), Math.round(1024 * 1024 * 4 * 4 / 3), 'RGBA8 with mipmaps');
  const done = ub.whenDone([big, ...small]);
  const s1 = ub.step();
  assert.ok(s1.textures === 1 && s1.bytes === S.textureBytes(big) && up[0] === big && ub.pending === 3, 'frame 1: the big one alone (5.6 MB > 5 MB still goes: one at least)');
  ub.step();
  assert.equal(up.length, 3, 'frame 2: both small ones (2.8 MB)');
  await done;
  assert.equal(ub.pending, 1, 'a texture without its image waits');
  late.image = { width: 4, height: 4 }; late.needsUpdate = true; ub.step();
  assert.ok(ub.uploaded(late) && !ub.pending, 'then goes');

  const g = new THREE.BoxGeometry(1, 1, 1), m = new THREE.MeshBasicMaterial({ map: big }), root = new THREE.Group();
  root.add(new THREE.Mesh(g, m), new THREE.Mesh(g, m));
  const geoBytes = Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + g.index.array.byteLength;
  assert.equal(S.objectBytes(root), geoBytes + S.textureBytes(big), 'shared geometry and textures are counted once');
  const lt = S.watchLongTasks(); assert.equal(lt.stop().count, 0, 'no long tasks in Node (no observer, no rAF)');
  // review fixes: a set() into a full cache never evicts the entry it inserts; pinned inserts stay
  {
    const ev = [], c = S.createLRU({ budget: 100, evict: (k) => ev.push(k) });
    c.set('a', 1, 80, { pin: true });
    c.set('b', 2, 80, { pin: true });
    assert.ok(c.has('b') && !ev.length, 'a pinned insert over budget stays (and so does the pinned one before it)');
    c.set('c', 3, 80);
    assert.ok(c.has('c') && !ev.length, 'an unpinned insert is not evicted by its own set()');
    c.unpin('a');
    assert.deepEqual(ev, ['a', 'c'], 'unpinned later: evicted then, oldest first, until it fits');
  }
  // review fixes: textures that cannot upload never stall whenDone
  {
    const ups = [], ub2 = S.createUploadBudget({ initTexture: (t) => ups.push(t) }, { maxWaitMs: 20 });
    const never = new THREE.Texture();           // a 404: no image, version 0, for ever
    const disposed = new THREE.Texture();        // a KTX2 placeholder replaced and disposed
    const cube = new THREE.CubeTexture(Array.from({ length: 6 }, () => ({ width: 4, height: 4 }))); cube.needsUpdate = true;
    ub2.add(never, disposed, cube);
    const all = ub2.whenDone([never, disposed, cube]);
    disposed.dispose();
    ub2.step();
    assert.ok(ub2.uploaded(cube), 'a cube texture with its six faces uploads');
    await new Promise((r) => setTimeout(r, 30)); ub2.step();
    await all;
    assert.ok(!ub2.pending && !ub2.uploaded(never) && !ub2.uploaded(disposed), 'the 404 left after maxWaitMs, the disposed one at once; whenDone resolved');
    cube.dispose();
    assert.ok(!ub2.uploaded(cube), 'disposed after its upload: forgotten');
    ub2.add(cube); ub2.step();
    assert.ok(ub2.uploaded(cube) && ups.filter((t) => t === cube).length === 2, 'added again: uploaded again');
  }
  // the bitmap decode only where imageOrientation / colorSpaceConversion are honoured
  {
    const { bitmapDecodeOK } = await import('./src/textures.js');
    globalThis.createImageBitmap ??= () => {}; globalThis.fetch ??= () => {};
    const UA = {
      chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      safari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
      safari17: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      ios16chrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      firefox97: 'Mozilla/5.0 (X11; Linux x86_64; rv:97.0) Gecko/20100101 Firefox/97.0',
      firefox120: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    };
    const got = Object.fromEntries(Object.entries(UA).map(([k, ua]) => [k, bitmapDecodeOK(ua)]));
    assert.deepEqual(got, { chrome: true, safari16: false, safari17: true, ios16chrome: false, firefox97: false, firefox120: true, android: true }, JSON.stringify(got));
  }
  console.log('stream check: ok');
}
await import('./vfx.check.mjs');
await import('./lighting.check.mjs');

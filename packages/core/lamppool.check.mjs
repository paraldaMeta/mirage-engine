// Mirage original code.
// The lamp pool's pure parts (no GPU): `node packages/core/lamppool.check.mjs`, also run by `npm test` (core).
// What the GPU does with them is checked in Chrome: hello-courtyard ?lamppool=1 against its PointLights, and the
// nizwa probe's ?pools=1 (README "Lamp pool").
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { lampPoolConfig, poolLamp, realShare, binLamps, createLampPool, LAMPPOOL_DEFAULTS } from './src/lamppool.js';
import { createInjector } from './src/inject.js';
import { CLUSTER } from './src/lights.js';
import * as core from './src/index.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// --- settings
assert.equal(lampPoolConfig(false), null, 'off by default');
assert.equal(lampPoolConfig(undefined), null);
assert.deepEqual(lampPoolConfig(true), LAMPPOOL_DEFAULTS);
assert.equal(lampPoolConfig({ far: 80 }).far, 80);
assert.equal(lampPoolConfig({ far: 80 }).perCell, LAMPPOOL_DEFAULTS.perCell, 'a partial option keeps the other defaults');
assert.equal(core.LAMPPOOL_DEFAULTS, LAMPPOOL_DEFAULTS, 'exported from the package root');

// --- a lamp
{
  const l = poolLamp({ pos: [1, 2, 3] });
  assert.ok(l.x === 1 && l.y === 2 && l.z === 3 && l.range === 6 && l.power === 1 && l.decay === 2 && l.n === null && l.near === null, 'defaults');
  // the wall: a point on the wall face (back m behind the flame) is in front, a point inside the wall is behind
  const w = poolLamp({ pos: [0, 2, 0.42], normal: [0, 0, 2], back: 0.47 });
  const side = (p) => w.n[0] * p[0] + w.n[1] * p[1] + w.n[2] * p[2] + w.n[3];
  assert.ok(near(Math.hypot(w.n[0], w.n[1], w.n[2]), 1), 'the normal is normalised');
  assert.ok(near(side([0, 2, 0.42]), 0.47) && near(side([0, 1, 0]), 0.05), 'flame and wall face in front');
  assert.ok(side([0, 1, -0.5]) < -0.15 && side([3, 0, -2]) < 0, 'inside and behind the wall is behind the plane');
  assert.ok(poolLamp({ x: 4, y: 5, z: 6 }).x === 4, 'x, y, z instead of pos');
}

// --- a real light's share of a lamp
assert.ok(near(realShare(1.17, [1, 0.56, 0.25], 1.17, [1, 0.56, 0.25]), 1), 'the whole lamp');
assert.ok(near(realShare(0.585, [1, 0.56, 0.25], 1.17, [1, 0.56, 0.25]), 0.5), 'half of it');
assert.equal(realShare(5, [1, 1, 1], 1, [1, 1, 1]), 1, 'never more than the lamp');
assert.equal(realShare(0, [1, 1, 1], 1, [1, 1, 1]), 0);
assert.equal(realShare(1, [1, 1, 1], 0, [1, 1, 1]), 1, 'a dark lamp (day) needs nothing from the pool');

// --- binning: a lamp is listed in every cell its sphere reaches (checked against points sampled inside the sphere)
{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
  cam.position.set(0, 1.6, 0); cam.lookAt(0, 1.6, -10); cam.updateMatrixWorld();
  const lamps = [{ x: 0, y: 2, z: -6, range: 3 }, { x: 4, y: 2, z: -20, range: 6 }, { x: -3, y: 1, z: 5, range: 2 } /* behind */, { x: 0, y: 2, z: -150, range: 6 }];
  const near0 = 0.1, far0 = 400, p = cam.projectionMatrix.elements;
  const b = binLamps(lamps, cam.matrixWorldInverse, p[0], p[5], near0, far0, 32);
  assert.equal(b.clipped, 0);
  const cellOf = (pw) => {
    const v = pw.clone().applyMatrix4(cam.matrixWorldInverse), z = -v.z;
    if (z <= near0) return -1;
    const c = pw.clone().project(cam);
    if (Math.abs(c.x) > 1 || Math.abs(c.y) > 1) return -1;
    const cx = Math.min(CLUSTER.x - 1, Math.floor((c.x * 0.5 + 0.5) * CLUSTER.x)), cy = Math.min(CLUSTER.y - 1, Math.floor((c.y * 0.5 + 0.5) * CLUSTER.y));
    const cz = Math.max(0, Math.min(CLUSTER.z - 1, Math.floor((Math.log(z / near0) / Math.log(far0 / near0)) * CLUSTER.z)));
    return cx + CLUSTER.x * (cy + CLUSTER.y * cz);
  };
  const listed = (c, i) => { for (let k = 0; k < b.counts[c]; k++) if (b.index[b.offsets[c] + k] === i) return true; return false; };
  let s = 7, tested = 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < lamps.length; i++) for (let n = 0; n < 400; n++) {
    const L = lamps[i], d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (d.length() > 1) continue;
    const c = cellOf(new THREE.Vector3(L.x, L.y, L.z).addScaledVector(d, L.range));
    if (c < 0) continue;
    tested++;
    assert.ok(listed(c, i), `lamp ${i} listed in the cell of a point inside its sphere`);
  }
  assert.ok(tested > 300, 'sampled enough points');
  let behind = 0;
  for (let c = 0; c < b.offsets.length; c++) if (listed(c, 2)) behind++;
  assert.equal(behind, 0, 'a lamp behind the eye is in no cell');
  // a full cell keeps the nearest lamps
  const row = [0, 1, 2, 3, 4, 5].map((k) => ({ x: 0, y: 1.6, z: -5 - k * 0.5, range: 1 }));
  const c2 = binLamps(row, cam.matrixWorldInverse, p[0], p[5], near0, far0, 2);
  assert.ok(c2.clipped > 0, 'cells over perCell clip');
  const cc = cellOf(new THREE.Vector3(0, 1.6, -6));
  assert.equal(c2.counts[cc], 2, 'perCell lamps kept');
  const kept = [...c2.index.slice(c2.offsets[cc], c2.offsets[cc] + c2.counts[cc])];
  assert.ok(kept.every((i) => i <= 2), 'the nearest lamps are the ones kept: ' + kept);
}

// --- the shader part: one loop before the indirect light, the light2 lookup only where light2 compiled it
{
  const inj = createInjector();
  const scene = new THREE.Scene();
  const pool = createLampPool({ scene, G: { uLampGain: { value: 1 }, uLamp: { value: 1 } }, injector: inj }, lampPoolConfig(true));
  const fs = THREE.ShaderLib.standard.fragmentShader;
  const out = inj.preview(fs).fragmentShader;
  assert.ok(out.includes('uniform highp sampler2D mgPT;') && out.split('RE_Direct( mgPL').length === 2, 'the pool loop is in');
  assert.ok(out.indexOf('RE_Direct( mgPL') < out.indexOf('#if defined( RE_IndirectDiffuse )'), 'before the indirect light');
  assert.ok(out.includes('#ifdef MG_LS') && out.includes('mgLsVis( la.xyz'), 'light2 shadows by the lamp position');
  assert.equal(inj.preview('void main() { gl_FragColor = vec4(1.0); }').fragmentShader, 'void main() { gl_FragColor = vec4(1.0); }', 'an unlit program is left alone');
  // lamps, the hand-off and the per-render state (no GPU: a stand-in renderer)
  pool.set([{ pos: [0, 2, -6], power: 2 }, { pos: [3, 2, -8], power: 2, normal: [0, 0, 1], back: 0.4 }]);
  assert.equal(pool.count, 2);
  const real = new THREE.PointLight(new THREE.Color().setRGB(1, 0.56, 0.25), 1, 6, 2); real.position.set(0, 2, -6); scene.add(real);
  pool.cfg.real = true;
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 400); cam.position.set(0, 1.6, 0); cam.lookAt(0, 1.6, -10); cam.updateMatrixWorld();
  const r = { getCurrentViewport: (v) => v.set(0, 0, 800, 800) };
  scene.onBeforeRender(r, scene, cam, null);
  const t = pool.texture.image.data;
  assert.equal(pool.info.real, 1, 'the PointLight on lamp 0 is found');
  assert.ok(near(t[4], 1, 1e-6) && near(t[12 + 4], 2), 'lamp 0 keeps the half its real light lacks, lamp 1 all of it (colour x power)');
  assert.equal(pool.info.mode, 2, 'clustered for a perspective camera');
  real.intensity = 2; scene.onBeforeRender(r, scene, cam, null);
  assert.equal(pool.info.active, 1, 'a wholly real lamp is not shaded by the pool');
  // by day (lamp gain 0) the loop is skipped
  const s2 = new THREE.Scene(), day = createLampPool({ scene: s2, G: { uLampGain: { value: 0 } }, injector: createInjector() }, lampPoolConfig(true));
  day.add({ pos: [0, 2, -6] });
  s2.onBeforeRender(r, s2, cam, null);
  assert.ok(day.info.mode === 0 && day.uniforms.mgPA.value.y === 0, 'off by day');
  day.dispose();
  // an orthographic camera: one list of every lamp within reach
  const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100); ortho.position.set(0, 20, 0); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld();
  real.intensity = 0; scene.onBeforeRender(r, scene, ortho, null);
  assert.ok(pool.info.mode === 1 && pool.uniforms.mgPA.value.x === 2, 'the plain list for an orthographic camera');
  // a cube capture (three's PMREM target) is shaded too by default, and not with captures: false
  pool.cfg.captures = false;
  scene.onBeforeRender(r, scene, cam, { texture: { mapping: THREE.CubeUVReflectionMapping } });
  assert.equal(pool.info.mode, 0, 'captures: false skips a PMREM capture');
  pool.cfg.captures = true;
  const before = scene.onBeforeRender;
  pool.dispose();
  assert.ok(scene.onBeforeRender !== before, 'dispose unhooks the scene');
}

// --- light2: the pool's lamps are lamp-shadow candidates; a PointLight on one is folded into it (one slot a lamp)
{
  const { LampShadows, LIGHT2_DEFAULTS, light2Config } = await import('./src/light2.js');
  const scene = new THREE.Scene(), l2 = light2Config(true);
  const pool = createLampPool({ scene, G: { uLampGain: { value: 0.5 }, uLamp: { value: 1 } }, injector: createInjector(), light2: l2 }, lampPoolConfig(true));
  pool.set([{ pos: [0, 2, -6], power: 2, near: 0.16 }, { pos: [3, 2, -8], power: 2 }, { pos: [500, 2, 0], power: 2 }]);
  const pl = new THREE.PointLight(0xffffff, 0.3, 6, 2); pl.position.set(0, 2, -6); scene.add(pl);
  const other = new THREE.PointLight(0xffffff, 0.3, 6, 2); other.position.set(-4, 2, -6); scene.add(other);
  scene.updateMatrixWorld(true);
  const fake = { cfg: { ...LIGHT2_DEFAULTS.ls }, lampLevel: () => 1, _v: new THREE.Vector3(), _plCache: null, _plT: -1e9, _pointLights: LampShadows.prototype._pointLights };
  const c = LampShadows.prototype._candidates.call(fake, scene, new THREE.Vector3(0, 1.6, 0));
  const keys = c.map((q) => q.key).sort();
  assert.deepEqual(keys, [other.uuid, 'mgPool0', 'mgPool1'].sort(), 'the PointLight on lamp 0 is folded into it, the far lamp is out of reach: ' + keys);
  const q0 = c.find((q) => q.key === 'mgPool0');
  assert.ok(near(q0.power, 1) && near(q0.near, 0.16), 'the pool entry carries the whole lamp (power x gain) and its near plane');
  assert.equal(c.find((q) => q.key === 'mgPool1').near, l2.ls.near, 'no near plane given: light2\'s default, as for a PointLight');
  // without the pool nothing is folded (a world without lampPool picks its candidates as before)
  pool.dispose();
  const c2 = LampShadows.prototype._candidates.call({ ...fake, _plCache: null }, scene, new THREE.Vector3(0, 1.6, 0));
  assert.deepEqual(c2.map((q) => q.key).sort(), [pl.uuid, other.uuid].sort(), 'without the pool: the two PointLights');
}

console.log('lamppool checks done');

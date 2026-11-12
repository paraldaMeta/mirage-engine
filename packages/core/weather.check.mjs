// Mirage original code.
// The weather's options without a GPU (`node packages/core/weather.check.mjs`, also run by `npm test` in core): the
// lightning's flash (weather.js), the storm sky's settings (sky.js). What the GPU draws is looked at in Chrome
// (examples/neon-district/scripts/weather.mjs).
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { flashConfig, flashEnvelope, withFlash, withWet, enableFlash, flashEnabled, FLASH, createFlash, skyStormConfig, createSkyUniforms, createMaterials, createEnv, setWetness, setRain } from './src/index.js';

setWetness(0); setRain(0);
// --- off by default
assert.equal(flashConfig(undefined), null, 'no flash option: null');
assert.equal(flashConfig(false), null);
assert.equal(skyStormConfig(undefined), null, 'no storm option: null');
assert.equal(skyStormConfig({ dusk: true }), null, 'a sky without storm: null');
assert.ok(!('uStorm' in createSkyUniforms({})), 'no storm uniforms without the option');
assert.ok(flashEnabled() === false, 'no world, no flash');
// --- settings
{
  const c = flashConfig(true);
  assert.ok(c.intensity > 0 && c.bolt === true && c.color.length === 3, 'true: the defaults');
  assert.equal(flashConfig({ intensity: -3 }).intensity, 0, 'intensity clamps at 0');
  assert.equal(flashConfig({ bolt: false }).bolt, false);
  const s = skyStormConfig({ storm: { glow: 99, flash: NaN } });
  assert.ok(s.glow === 20 && s.flash === 0.35, 'storm numbers clamp, a non-number takes the default');
  assert.ok('uStorm' in createSkyUniforms({ storm: skyStormConfig({ storm: true }) }), 'storm uniforms with the option');
}
// --- the envelope: smooth below 1 (one pulse, no flicker), a leader / return stroke / re-strike at 1
{
  assert.equal(flashEnvelope(-1), 0); assert.equal(flashEnvelope(5), 0, 'over after 1.6 s');
  const pulses = (k) => { let n = 0, prev = 0, up = false; for (let t = 0; t < 1.6; t += 0.005) { const v = flashEnvelope(t, k); if (v > prev + 1e-4 && !up) { up = true; n++; } if (v < prev - 1e-4) up = false; prev = v; } return n; };
  assert.equal(pulses(0.6), 1, 'comfort: one pulse');
  assert.ok(pulses(1) >= 3, 'raw: leader, return stroke, re-strike');
  let peak = 0, maxStep = 0, last = 0; for (let t = 0; t < 1.6; t += 1 / 60) { const v = flashEnvelope(t, 0.5); peak = Math.max(peak, v); maxStep = Math.max(maxStep, Math.abs(v - last)); last = v; }
  assert.ok(peak <= 0.5 + 1e-9, 'k scales the peak');
}
// --- the material: no code without a world that has the option; the code under MG_FLASH
{
  const G = createEnv({}).G, kit = createMaterials(G);
  const f = withFlash({}, { shelter: 0.25 });
  assert.ok(f.lighting.includes('#if defined(MG_FLASH) && defined(STANDARD)') && f.lighting.includes('MG_FLASH_OPEN (0.75)'), 'a numeric shelter: the open share is 1 - shelter');
  assert.ok(withFlash(f) === f, 'applied once');
  assert.throws(() => withFlash({}, { shelter: [1] }), TypeError);
  const m = kit.std({ roughness: 0.5 }, f);
  assert.ok(!(m.defines && 'MG_FLASH' in m.defines), 'off: not defined');
  const w = withWet({}, {});
  assert.ok(w.lighting.includes('MG_FLASH') && w.lighting.includes('#ifdef MG_WET'), 'a wet material has the flash, inside MG_WET');
  assert.ok(withWet({}, { shelter: 'mgS' }).lighting.includes('mgS'), "its open share follows the wet layer's shelter");
  const fakeScene = new THREE.Scene(), fl = createFlash({ scene: fakeScene }, flashConfig(true));
  fl.set(1, [0, 1, 0]);
  assert.ok(FLASH.uFlash.value.x > 0 && fl.bolt.visible === false, 'a level lights the uniform; the bolt waits for a strike');
  fl.strike([0, 100, 0], [0, 0, 0], 3);
  fl.set(1);
  assert.ok(fl.bolt.visible && fl.bolt.geometry.drawRange.count > 0, 'a strike builds the bolt');
  fl.set(0.1); assert.ok(!fl.bolt.visible, 'dim: no bolt');
  fl.dispose();
  assert.ok(!flashEnabled() && FLASH.uFlash.value.lengthSq() === 0, 'disposed: off and dark');
  assert.ok(enableFlash(true) && enableFlash(true) && enableFlash(false) && flashEnabled() && !enableFlash(false), 'counted users');
}
console.log('weather check: ok');

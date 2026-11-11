// Mirage original code. Node checks of the platform layer's renderer side (src/platform.js, src/byte-targets.js)
// with a fake navigator, canvas and clock. (The real context: packages/tools/src/context-loss-check.mjs, mobile-check.mjs.)
import assert from 'node:assert/strict';
import { HalfFloatType, FloatType, UnsignedByteType } from 'three';
import { gpuTier, osOf, qualityFor, probeDevice, createContextRecovery, governorStep, createQualityGovernor, GOVERNOR_STEPS, GOVERNOR_DEFAULTS } from './src/platform.js';
import { byteTargets } from './src/byte-targets.js';

{ // gpu tiers: the strings browsers really give
  const t = (s) => gpuTier(s).tier;
  assert.equal(t('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 0);
  assert.equal(t('Adreno (TM) 506'), 1); assert.equal(t('Adreno (TM) 619'), 1); assert.equal(t('Adreno (TM) 650'), 2);
  assert.equal(t('Adreno (TM) 740'), 3); assert.equal(t('Adreno (TM) 830'), 3);
  assert.equal(t('Mali-T860'), 1); assert.equal(t('Mali-G52 MC2'), 1); assert.equal(t('Mali-G78'), 2); assert.equal(t('Mali-G610 MC6'), 2); assert.equal(t('Mali-G715'), 3);
  assert.equal(t('Immortalis-G720'), 3); assert.equal(t('PowerVR Rogue GE8320'), 1);
  assert.equal(t('Apple GPU'), 2); assert.equal(t('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)'), 3);
  assert.equal(t('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 3);
  assert.equal(t('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)'), 1);
  assert.equal(t(''), 1); assert.equal(gpuTier('Something New 9000').why, 'renderer not in the table');
  assert.equal(gpuTier('Adreno (TM) 740').family, 'adreno'); assert.equal(gpuTier('Adreno (TM) 740').model, '740');
}
{ // os: an iPad says Macintosh
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }), 'android');
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios');
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'ios');
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), 'macos');
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows');
  assert.equal(osOf({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)' }), 'chromeos');
  assert.equal(osOf({}), 'unknown');
}
{ // qualityFor: never high; every reason is named; a phone gets dynamic resolution and a 1x canvas
  const d = qualityFor({ tier: 3, mobile: false, dpr: 2, maxTextureSize: 16384 });
  assert.equal(d.quality, 'medium'); assert.equal(d.why, 'default'); assert.equal(d.settings.dynamicRes, false); assert.equal(d.settings.pixelRatio, 2); assert.equal(d.settings.msaa, 4);
  const p = qualityFor({ tier: 2, mobile: true, dpr: 3, maxTextureSize: 4096 });
  assert.equal(p.quality, 'low'); assert.equal(p.why, 'mobile'); assert.equal(p.settings.pixelRatio, 1); assert.equal(p.settings.msaa, 0); assert.ok(p.settings.dynamicRes.min >= 0.6);
  const f = qualityFor({ tier: 3, mobile: true, dpr: 3 });
  assert.equal(f.quality, 'medium'); assert.equal(f.settings.pixelRatio, 1.5);
  const w = qualityFor({ tier: 1, mobile: true, memory: 2, cores: 2, saveData: true, floatTargets: false, battery: { level: 0.1, charging: false }, maxTextureSize: 2048 });
  assert.equal(w.quality, 'low');
  for (const r of ['low gpu tier', 'mobile', 'battery low', 'data saver', '2 GB memory', '2 cores', 'no float targets']) assert.ok(w.why.includes(r), `${r} in "${w.why}"`);
  assert.equal(w.settings.maxFps, 30); assert.equal(w.settings.shadowMapSize, 1024); assert.equal(w.settings.dynamicRes.min, 0.5);
  assert.equal(qualityFor({ tier: 3, maxTextureSize: 1024 }).settings.shadowMapSize, 1024);
  assert.equal(qualityFor({ tier: 3, battery: { level: 0.9, charging: true } }).quality, 'medium');   // plugged in is not a reason
}
{ // probeDevice against a fake context; the saved choice wins; a desktop's fake battery is no battery
  const ext = { WEBGL_debug_renderer_info: { UNMASKED_RENDERER_WEBGL: 1 }, EXT_color_buffer_half_float: {}, EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 2 }, WEBGL_compressed_texture_astc: {}, WEBGL_compressed_texture_etc: {} };
  const gl = { MAX_TEXTURE_SIZE: 10, MAX_RENDERBUFFER_SIZE: 11, MAX_SAMPLES: 12, RENDERER: 13, getExtension: (n) => ext[n] || null, getParameter: (k) => ({ 1: 'Adreno (TM) 660', 10: 4096, 11: 8192, 12: 4, 2: 16 })[k] };
  const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-G991B) Mobile', maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 8, connection: { saveData: false }, getBattery: async () => ({ level: 0.5, charging: false, chargingTime: Infinity }) };
  const win = { devicePixelRatio: 3, screen: { width: 360, height: 800 }, matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) };
  const c = await probeDevice({ nav, win, gl, storage: null });
  assert.equal(c.mobile, true); assert.equal(c.os, 'android'); assert.equal(c.touch, true); assert.equal(c.coarse, true); assert.equal(c.standalone, false);
  assert.equal(c.gpu, 'Adreno (TM) 660'); assert.equal(c.tier, 2); assert.equal(c.gpuFamily, 'adreno');
  assert.equal(c.maxTextureSize, 4096); assert.equal(c.maxRenderbufferSize, 8192); assert.equal(c.maxSamples, 4); assert.equal(c.anisotropy, 16);
  assert.equal(c.floatTargets, false); assert.equal(c.halfFloatTargets, true); assert.equal(c.astc, true); assert.equal(c.etc2, true); assert.equal(c.bc, false);
  assert.deepEqual(c.battery, { level: 0.5, charging: false }); assert.equal(c.quality, 'low'); assert.equal(c.saved, false);
  assert.ok(c.why.includes('mobile') && c.why.includes('battery') && c.why.includes('no float targets'));
  const s = await probeDevice({ nav, win, gl, storage: { getItem: () => 'high' } });
  assert.equal(s.quality, 'high'); assert.equal(s.why, 'saved'); assert.equal(s.saved, true);
  const bad = await probeDevice({ nav, win, gl, storage: { getItem: () => 'ultra' } });
  assert.equal(bad.quality, 'low');
  const desk = await probeDevice({ nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', getBattery: async () => ({ level: 1, charging: true, chargingTime: 0 }) }, win: {}, gl: { ...gl, getParameter: (k) => (k === 1 ? 'NVIDIA GeForce RTX 3070' : 4096), getExtension: (n) => (n === 'EXT_color_buffer_float' ? {} : ext[n] || null) }, storage: null });
  assert.equal(desk.battery, null); assert.equal(desk.mobile, false); assert.equal(desk.quality, 'medium'); assert.equal(desk.floatTargets, true); assert.equal(desk.halfFloatTargets, true);
  const none = await probeDevice({ nav: {}, win: {}, storage: null });   // Node: no document, no WebGL
  assert.equal(none.webgl2, false); assert.equal(none.quality, 'low');
  const forced = await probeDevice({ nav: {}, win: {}, storage: null, gl, force: { tier: 0 } });
  assert.equal(forced.tier, 0); assert.ok(forced.why.includes('software gpu'));
}
{ // context recovery: the order of things, with a fake canvas
  const L = {}, canvas = { addEventListener: (t, f) => { L[t] = f; }, removeEventListener: (t) => { delete L[t]; } };
  const log = [];
  const play = { running: true, stop() { this.running = false; log.push('stop'); }, start() { this.running = true; log.push('start'); }, wake() { log.push('wake'); } };
  const world = { renderer: { domElement: canvas, getContext: () => ({ getExtension: () => null }) }, contextRestored() { log.push('rebake'); } };
  const r = createContextRecovery(world, { play, onLost: () => log.push('lost'), onRestored: (i) => log.push('restored ' + i.count), timeout: 0 });
  const off = r.onRestore(() => log.push('mine'));
  let prevented = false;
  L.webglcontextlost({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'without preventDefault the browser never restores'); assert.equal(r.lost, true); assert.equal(play.running, false);
  L.webglcontextlost({ preventDefault() {} });   // twice: counted once
  L.webglcontextrestored();
  assert.deepEqual(log, ['stop', 'lost', 'rebake', 'mine', 'start', 'wake', 'restored 1']);
  assert.equal(r.lost, false); assert.equal(r.count, 1);
  L.webglcontextrestored();   // a restore without a loss does nothing
  assert.equal(r.count, 1);
  // a play that was stopped stays stopped; a removed hook does not run; a throwing hook does not stop the others
  off(); log.length = 0; play.stop(); log.length = 0;
  const err = console.error; console.error = () => {};
  r.onRestore(() => { throw new Error('x'); }); r.onRestore(() => log.push('after'));
  L.webglcontextlost({ preventDefault() {} }); L.webglcontextrestored();
  console.error = err;
  assert.deepEqual(log, ['stop', 'lost', 'rebake', 'after', 'restored 2']);
  await assert.rejects(r.simulate(), /WEBGL_lose_context/);
  r.dispose(); assert.equal(L.webglcontextlost, undefined);
  // the give-up timer
  let gave = 0; const r2 = createContextRecovery(world, { onGiveUp: () => gave++, timeout: 20 });
  L.webglcontextlost({ preventDefault() {} });
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(gave, 1); r2.dispose();
}
{ // governorStep: down fast, up slowly, one step at a time
  const B = GOVERNOR_DEFAULTS.budget, at = (step, since = -1e9, calmFor = 0) => ({ step, since, calmFor });
  assert.equal(governorStep(at(0), { now: 10000, median: B }).step, 0);
  assert.equal(governorStep(at(0), { now: 10000, median: B * 1.3 }).step, 1);
  assert.equal(governorStep(at(0), { now: 10000, median: B * 1.2 }).step, 0);              // inside the dead band
  assert.equal(governorStep(at(1, 9000), { now: 10000, median: B * 2 }).why, 'hold');       // just stepped: wait
  assert.equal(governorStep(at(3), { now: 10000, median: B * 3 }).step, 3);                 // nothing below the last
  assert.equal(governorStep(at(2, 0, 19000), { now: 30000, median: B }).step, 2);           // calm, not long enough
  assert.equal(governorStep(at(2, 0, 20000), { now: 30000, median: B }).step, 1);
  assert.equal(governorStep(at(2, 0, 20000), { now: 30000, median: 0 }).step, 2);           // no evidence is not calm
  assert.equal(governorStep(at(0), { now: 10000, median: B, pressure: 'serious' }).step, 1);
  assert.equal(governorStep(at(0, 9900), { now: 10000, median: B, pressure: 'critical' }).step, 2);   // through the hold
  assert.equal(governorStep(at(2, 0, 1e6), { now: 30000, median: B, pressure: 'serious' }).step, 3);
  assert.equal(governorStep(at(0, 9900), { now: 10000, battery: { level: 0.15, charging: false } }).step, 3);
  assert.equal(governorStep(at(0), { now: 10000, median: B, battery: { level: 0.15, charging: true } }).step, 0);
  assert.equal(governorStep(at(3, 0, 1e6), { now: 30000, median: 33.3, battery: { level: 0.15, charging: false } }, { capMs: 33.3 }).step, 3);   // stays while the battery is low
  assert.equal(governorStep(at(3, 0, 1e6), { now: 30000, median: 33.4 }, { capMs: 1000 / 30 }).step, 2);   // 30 fps at a 30 fps cap is calm
  assert.equal(governorStep(at(0), { now: 10000, median: B * 2 }, { steps: 2 }).step, 1);
  assert.equal(governorStep(at(1), { now: 10000, median: B * 2 }, { steps: 2 }).step, 1);
  const s = at(0); governorStep(s, { now: 10000, median: 99 }); assert.equal(s.step, 0, 'state is not changed');
}
{ // createQualityGovernor on a fake clock: a slow device walks down the ladder, a recovered one climbs back
  const world = { dynamicRes: { target: 60, min: 0.5 } }, play = { maxFps: 0, powerSaver: false }, steps = [];
  const g = createQualityGovernor({ world, play, nav: {}, PressureObserver: null, onStep: (s, i) => steps.push([s, i.name]) });
  assert.equal(g.steps.length, GOVERNOR_STEPS.length);
  let t = 1000; const run = (ms, dt) => { for (const end = t + ms; t < end; t += dt) g.frame(t); };
  run(4000, 16.7); assert.equal(g.step, 0);
  run(6000, 30); assert.equal(g.step, 1); assert.equal(world.dynamicRes.max, 0.85); assert.match(g.why, /frame time/);
  run(40000, 30); assert.equal(g.step, 3); assert.equal(play.powerSaver, true); assert.equal(world.dynamicRes.max, 0.7);
  // behind the 30 fps cap it looks calm, so it tried one step up, failed and came back: the next try waits twice as long
  assert.deepEqual(steps.map((s) => s[0]), [1, 2, 3, 2, 3]);
  run(30000, 30); assert.deepEqual(steps.map((s) => s[0]), [1, 2, 3, 2, 3], 'no second try within 30 s');
  run(150000, 16.7); assert.equal(g.step, 0); assert.equal(world.dynamicRes.max, 1); assert.equal(play.powerSaver, false);
  assert.deepEqual(steps.map((s) => s[0]), [1, 2, 3, 2, 3, 2, 1, 0]);
  // a gap (hidden tab) is not a slow frame
  g.frame(t += 5000); assert.equal(g.signals().samples, 0);
  // manual pin, then back
  g.set(2); assert.equal(g.step, 2); assert.equal(g.why, 'manual'); run(30000, 16.7); assert.equal(g.step, 2);
  g.set(null); run(60000, 16.7); assert.equal(g.step, 0);
  g.set(99); assert.equal(g.step, 3);
  g.dispose(); assert.equal('max' in world.dynamicRes, false);
  // without dynamic resolution: two steps; a pressure observer and a battery feed it
  let observe; class PO { constructor(cb) { observe = cb; } observe() { return Promise.resolve(); } disconnect() {} }
  const p2 = { maxFps: 0, powerSaver: false }, applied = [];
  const g2 = createQualityGovernor({ play: p2, nav: { getBattery: async () => ({ level: 0.1, charging: false, chargingTime: Infinity }) }, PressureObserver: PO, apply: (s) => applied.push(s) });
  assert.equal(g2.steps.length, 2);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(g2.signals().battery, { level: 0.1, charging: false });
  t = 0; g2.frame(t += 600); g2.frame(t += 600);
  assert.equal(g2.step, 1); assert.equal(g2.why, 'battery low'); assert.deepEqual(applied, [1]);
  observe([{ state: 'critical' }]); assert.equal(g2.signals().pressure, 'critical');
  g2.dispose();
}
{ // byteTargets: only where float targets are missing; each target once; MRT and depth-only targets
  const mk = (exts) => { const calls = []; return { calls, getContext: () => ({ getExtension: (n) => (exts.includes(n) ? {} : null) }), setRenderTarget(rt, ...r) { calls.push([rt, ...r]); } }; };
  const rt = (...types) => ({ textures: types.map((type) => ({ type })) });
  const ok = mk(['EXT_color_buffer_half_float']), before = ok.setRenderTarget;
  assert.equal(byteTargets(ok), false); assert.equal(ok.setRenderTarget, before);
  const no = mk([]);
  assert.equal(byteTargets(no), true);
  const a = rt(HalfFloatType, FloatType, UnsignedByteType), old = { texture: { type: HalfFloatType } };
  no.setRenderTarget(a, 2, 1); no.setRenderTarget(null); no.setRenderTarget(old);
  assert.deepEqual(a.textures.map((t) => t.type), [UnsignedByteType, UnsignedByteType, UnsignedByteType]);
  assert.equal(old.texture.type, UnsignedByteType);
  assert.deepEqual(no.calls[0], [a, 2, 1]); assert.deepEqual(no.calls[1], [null]);
  a.textures[0].type = HalfFloatType; no.setRenderTarget(a); assert.equal(a.textures[0].type, HalfFloatType, 'a target is looked at once');
  const forced = mk(['EXT_color_buffer_float']); assert.equal(byteTargets(forced, true), true);
}
console.log('platform.check: gpu tiers, os, qualityFor, probeDevice, context recovery, governor, byte targets passed');

// Mirage original code.
// ---------------------------------------------------------------------------
// Realtime lighting features, all opt-in: createWorldRenderer({ lighting: { csm, gi, probes, lights } }).
//
//   const world = createWorldRenderer({ lighting: { csm: true, gi: { min, max, spacing: 2 } } });
//   world.lighting.addLight(new THREE.PointLight(0xffaa66, 40, 9), { shadow: true });   // clustered local light
//   world.lighting.invalidate();                                                       // after the built world changed
//
// One injector (inject.js) carries every feature's shader part into the world's lit materials, so nothing here
// patches three's page-global chunks and a world without `lighting` compiles and draws exactly what it did.
// The world calls in at four places: fitSun (each sub-frame's shadow fit), frame (before a frame's sub-frames),
// envCaptured (after the image-based light was recaptured: time of day moved) and dispose.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createInjector } from './inject.js';
import { csmConfig, createCsm } from './csm.js';
import { giConfig, createGi } from './gi.js';
import { lightsConfig, createLights } from './lights.js';
import { probesConfig, createProbes } from './probes.js';

export function createLighting(w, config) {
  const { renderer, scene, sun } = w;
  const inj = createInjector();
  const cfg = config === true ? {} : config;
  const features = {};
  let frames = 0, adopted = 0;

  const ccfg = csmConfig(cfg.csm);
  const csm = ccfg ? createCsm(sun, ccfg, { tile: Math.max(512, sun.shadow.mapSize.x >> 1), soft: w.soft }) : null;
  if (csm) { csm.enable(); inj.add(csm.part); features.csm = csm; }

  const hooks = [];   // each feature: { frame, envCaptured, invalidate, dispose, busy }
  const gcfg = giConfig(cfg.gi);
  const gi = gcfg ? createGi({ renderer, scene, capture: (fn) => api.capture(fn), skyVisible: w.skyVisible }, gcfg) : null;
  if (gi) { inj.add(gi.part); features.gi = gi; hooks.push(gi); }
  const pcfg = probesConfig(cfg.probes);
  const probes = pcfg ? createProbes({ renderer, scene, capture: (fn) => api.capture(fn) }, pcfg, { size: (w.Q && w.Q.envSize) || 256 }) : null;
  if (probes) { inj.add(probes.part); features.probes = probes; hooks.push(probes); }
  const lcfg = lightsConfig(cfg.lights);
  const lights = lcfg ? createLights({ renderer, scene }, lcfg) : null;
  if (lights) { inj.add(lights.part); features.lights = lights; hooks.push(lights); }
  const api = {
    injector: inj, csm, gi, probes, lights, features, hooks,
    /** hand a THREE.PointLight / SpotLight (already in the scene) to the clustered path; { shadow: true } gives it a tile of the shadow atlas */
    addLight(light, o) { if (!lights) { console.warn('[lighting] addLight needs lighting: { lights: true }'); return false; } return lights.add(light, o); },
    removeLight(light) { return !!lights && lights.remove(light); },
    /** true while baked light is still being brought up to date (the world keeps drawing) */
    get busy() { return hooks.some((h) => h.busy); },
    /** wrap lit materials added since the last call (the world does this in prepare and every half second of frames) */
    adopt() { const n = inj.adopt(scene); adopted += n; return n; },
    get materials() { return inj.materials.size; },
    fitSun(d, camera, center, radius, k) { if (csm) csm.fit(d, capturing ? null : camera, center, radius, k); },
    /** before a frame's sub-frames: camera = the view camera */
    frame(camera, dt = 1 / 60) {
      if (frames++ % 30 === 0) api.adopt();
      for (const h of hooks) if (h.frame) h.frame(camera, dt);
    },
    /** the sun / sky changed and the image-based light was recaptured */
    envCaptured(instant) { ready = true; api.adopt(); for (const h of hooks) if (h.envCaptured) h.envCaptured(instant); },
    /** the built world changed (a wall, a door): cached shadows and baked light are redone */
    invalidate() { if (ready) for (const h of hooks) if (h.invalidate) h.invalidate(); },
    /** true while a probe is being captured: cascades fit the world's shadow volume, not the view */
    get capturing() { return capturing; },
    capture(fn) { const was = capturing; capturing = true; try { return w.capture(fn); } finally { capturing = was; } },
    dispose() { for (const h of hooks) if (h.dispose) h.dispose(); if (csm) csm.disable(); },
  };
  let capturing = false, ready = false;
  return api;
}

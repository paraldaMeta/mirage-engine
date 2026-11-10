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

export function createLighting(w, config) {
  const { renderer, scene, sun } = w;
  const inj = createInjector();
  const cfg = config === true ? {} : config;
  const features = {};
  let frames = 0, adopted = 0;

  const ccfg = csmConfig(cfg.csm);
  const csm = ccfg ? createCsm(sun, ccfg, { tile: Math.max(512, sun.shadow.mapSize.x >> 1), soft: w.soft }) : null;
  if (csm) { csm.enable(); inj.add(csm.part); features.csm = csm; }

  const hooks = [];   // features added by the files below register { frame, envCaptured, dispose, capture }
  const api = {
    injector: inj, csm, features, hooks,
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
    envCaptured(instant) { for (const h of hooks) if (h.envCaptured) h.envCaptured(instant); },
    /** the built world changed (a wall, a door): cached shadows and baked light are redone */
    invalidate() { for (const h of hooks) if (h.invalidate) h.invalidate(); },
    /** true while a probe is being captured: cascades fit the world's shadow volume, not the view */
    get capturing() { return capturing; },
    capture(fn) { const was = capturing; capturing = true; try { return fn(); } finally { capturing = was; } },
    dispose() { for (const h of hooks) if (h.dispose) h.dispose(); if (csm) csm.disable(); },
  };
  let capturing = false;
  return api;
}

// A Nizwa build context (what src/main.js of the Nizwa project hands its world modules) made from a Mirage world.
// Nizwa's module code runs against it unchanged. What comes from where:
//   Mirage   renderer, camera, the uniforms' values (time, key light, lamp level, wind), createLod
//   Nizwa    layout (L), geom (Builder), rng (its own generator: the same seeds give the same fort), the material
//            library and the texture layer (through compat/patch.js), doors
import * as THREE from 'three';
import { createLod } from '@miragekit/core';
import * as geom from '@nizwa/core/geom.js';
import { rng } from '@nizwa/core/rng.js';
import { materials, patch, std, phys, glow, PROC, depthMaterialFor, setLampLevel } from '@nizwa/core/materials.js';
import { createTextures } from '@nizwa/core/textures.js';
import { G as NZG, ENV, sunDir } from '@nizwa/core/env.js';
import { L } from '@nizwa/layout.js';
import { bind } from './patch.js';

export function nizwaContext(world, { walkers = () => [] } = {}) {
  bind(world);
  const G = { ...NZG, uTime: world.G.uTime };   // by reference: hand-written shaders of the modules read ctx.G.uTime
  const nz = {
    THREE, renderer: world.renderer, scene: world.scene, camera: world.camera, L, G, ENV, sunDir, geom, rng, quality: 'final',
    M: null, mat: { patch, std, phys, glow, PROC, depthMaterialFor },
    tex: createTextures({ renderer: world.renderer }), lod: createLod(),
    onUpdate: (fn) => world.ctx.onUpdate((t) => fn(t, nz)),
    modules: {}, device: { mobile: false, msaa: world.device.msaa },
  };
  let gain = -1, last = -1;
  /** Mirage's light state into Nizwa's uniform objects (call after world.setTime and every frame) */
  nz.sync = (t = world.G.uTime.value) => {
    const M = world.G;
    sunDir.copy(M.uKeyDir.value); NZG.uSunDir.value.copy(sunDir); NZG.uSunColor.value.copy(M.uKeyColor.value);
    NZG.uTime.value = t; NZG.uLamp.value = M.uLamp.value; NZG.uNight.value = M.uNight.value;
    NZG.uAmbK.value = M.uSkyLight.value; NZG.uBakedSun.value = 0;   // no bakes for a fixed sun in the probe
    NZG.uWindDir.value.set(M.uWind.value.x, M.uWind.value.y); NZG.uWindStrength.value = M.uWind.value.z;
    if (M.uLampGain.value !== gain) { gain = M.uLampGain.value; setLampLevel(gain, gain); }   // Nizwa's glow materials
    // doors swing in real time (Mirage's scene clock stands still unless the host animates it)
    const now = performance.now();
    if (nz.doors) { nz.walkers = walkers(); nz.doors.update(last < 0 ? 0 : (now - last) / 1000, nz); }
    last = now;
  };
  nz.sync(0);
  nz.M = materials();
  world.ctx.onUpdate((t) => nz.sync(t));
  return nz;
}

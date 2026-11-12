// Mirage original code. The surface library: 35 physically plausible kinds made in code (concrete, asphalt, paving,
// brick, render, tile, corrugated, painted steel, stainless, galvanised, cast iron, aluminium, chrome, raw metals,
// powder coat, car paint, glass, plastics, rubber, fabric, paper, wood, bamboo, leather, carbon fibre, ceramic, roofing;
// neon, fluorescent, LED panel, LCD, light box, paper lantern, water, oil), their measured reference ranges, the F0 of
// common metals and the weathering decals, plugged into @miragekit/core's surface framework (createSurfaces: baking,
// mappings, LOD, the runtime layer).
//
//   import { SURFACES, createSurfaces } from '@miragekit/assets/surfaces';
//   const lib = createSurfaces(world);                           // core's createSurfaces, the recipes registered
//   const wall = lib.material(SURFACES.concrete({ variant: 'cast', age: 0.5 }), { mapping: 'wall', wet: true });
//
// Importing this module registers the recipes with the framework (registerSurfaces() does it again for another copy of
// @miragekit/core, e.g. one passed in); core's surfaceHooks / bakeSurface then take these specs too.
import * as core from '@miragekit/core/surfaces';
import { KINDS, METALS } from './kinds.js';
import { KIND_GLSL, LIVE_GLSL } from './glsl.js';
import { DECAL_GLSL, DECAL_FS, decalUniforms } from './decals.js';

export { METALS };
export { KIND_GLSL, LIVE_GLSL } from './glsl.js';

/** register the library's kinds and decals with a surface framework (default: @miragekit/core's) */
export function registerSurfaces(framework = core) {
  framework.registerSurfaceKinds({ kinds: KINDS, glsl: KIND_GLSL, liveGlsl: LIVE_GLSL });
  framework.registerSurfaceDecals({ glsl: DECAL_GLSL, fragment: DECAL_FS, uniforms: decalUniforms });
  return framework;
}
registerSurfaces();

/** SURFACES.<kind>(options) -> a surface spec (data: kind, variant, the packed numbers); see SURFACE_KINDS for the
 *  kinds, their variants and defaults. */
export const SURFACES = Object.fromEntries(Object.keys(KINDS).map((k) => [k, (opt) => core.surfaceSpec(k, opt)]));
/** Everything the library knows about each kind (family, variants, tile, depth, porosity, reference ranges, defaults). */
export const SURFACE_KINDS = core.surfaceKinds();
/** core's createSurfaces with the library's recipes registered */
export function createSurfaces(world, options) { registerSurfaces(); return core.createSurfaces(world, options); }

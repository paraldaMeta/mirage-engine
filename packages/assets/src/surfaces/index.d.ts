import type { MaterialKit } from '@miragekit/core/materials';
import type * as THREE from 'three';
import type { SurfaceKindInfo, SurfaceOptions, SurfaceSpec, SurfaceLibrary } from '@miragekit/core/surfaces';

/** The library's kinds. */
export type LibrarySurfaceKind =
  | 'concrete' | 'asphalt' | 'paving' | 'brick' | 'render' | 'tile' | 'corrugated' | 'paintedMetal' | 'stainless' | 'galvanised'
  | 'castIron' | 'aluminium' | 'chrome' | 'metal' | 'powderCoat' | 'carPaint' | 'glass' | 'plastic' | 'rubber' | 'fabric'
  | 'paper' | 'wood' | 'bamboo' | 'leather' | 'carbonFibre' | 'ceramic' | 'roofing'
  | 'neon' | 'fluorescent' | 'ledPanel' | 'lcd' | 'lightbox' | 'paperLantern' | 'water' | 'oil';

export const SURFACES: { readonly [K in LibrarySurfaceKind]: (options?: SurfaceOptions) => SurfaceSpec };
export const SURFACE_KINDS: { readonly [K in LibrarySurfaceKind]: SurfaceKindInfo };
/** F0 (linear) of common metals. */
export const METALS: Record<string, [number, number, number]>;
/** One `MsS ms_<kind>(vec2 u)` recipe per bakeable kind. */
export const KIND_GLSL: Record<string, string>;
/** The per-pixel-only kinds (emissive, liquids), each writing msEmit. */
export const LIVE_GLSL: Record<string, string>;
/** Register the library's kinds and decals with a surface framework (default: @miragekit/core's; done on import). */
export function registerSurfaces<F extends { registerSurfaceKinds(k: object): void; registerSurfaceDecals(d: object): void }>(framework?: F): F;
/** core's createSurfaces with the library's recipes registered. */
export function createSurfaces(world: { renderer: THREE.WebGLRenderer; mat: MaterialKit }, options?: { mode?: 'auto' | 'procedural' | 'baked'; size?: number; anisotropy?: number; tier?: 'high' | 'low' }): SurfaceLibrary;

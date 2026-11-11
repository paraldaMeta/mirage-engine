import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from './materials.js';
import type { WetOptions } from './wet.js';

export type SurfaceKind =
  | 'concrete' | 'asphalt' | 'paving' | 'brick' | 'render' | 'tile' | 'corrugated' | 'paintedMetal' | 'stainless' | 'galvanised'
  | 'castIron' | 'aluminium' | 'chrome' | 'metal' | 'powderCoat' | 'carPaint' | 'glass' | 'plastic' | 'rubber' | 'fabric'
  | 'paper' | 'wood' | 'bamboo' | 'leather' | 'carbonFibre' | 'ceramic' | 'roofing'
  | 'neon' | 'fluorescent' | 'ledPanel' | 'lcd' | 'lightbox' | 'paperLantern' | 'water' | 'oil';
export type SurfaceColor = readonly [number, number, number] | string | number;

/** Measured ranges a kind's defaults sit in (linear albedo or metal F0, roughness, metalness), with a note. */
export interface SurfaceRefs {
  albedo: readonly [number, number];
  rough: readonly [number, number];
  metal: number | string;
  note: string;
  variants?: Record<string, Omit<SurfaceRefs, 'variants'>>;
}
export interface SurfaceKindInfo {
  family: string; variants: string[]; tile: number; depth: number; size: number; porosity: number;
  live: boolean; physical: boolean; cheap: boolean; refs: SurfaceRefs; defaults: Record<string, unknown>;
}
/** Options every kind takes; each kind adds its own (see SURFACE_KINDS[kind].defaults). */
export interface SurfaceOptions {
  variant?: string | number;
  color?: SurfaceColor;
  roughness?: number;
  /** pattern size multiplier (1) */
  scale?: number;
  seed?: number;
  /** 0..1: weathering baked into the tile (bleed, erosion) and the run-off streaks */
  age?: number;
  /** 0..1: grime in cavities, at the foot, on top faces (live) */
  dirt?: number;
  /** 0..1: wear on edges (live; curvature or the `edge` attribute) */
  edgeWear?: number;
  /** 0..1: world-space macro tone variation that hides the tile (live) */
  variation?: number;
  dirtColor?: SurfaceColor;
  /** the repeat / bake period in metres */
  tile?: number;
  porosity?: number;
  [option: string]: unknown;
}
/** A surface: the kind, its variant and its numbers packed for the shader. */
export interface SurfaceSpec {
  readonly isSurface: true;
  kind: SurfaceKind; variant: string; options: Record<string, unknown>;
  uniforms: Record<'A' | 'B' | 'C' | 'D' | 'X' | 'W' | 'G' | 'E' | 'F', number[]>;
  quantum: [number, number]; tile: number; depth: number; porosity: number; live: boolean; physical: boolean;
  material: Record<string, unknown>; size: number; bakeKey: string;
}
export interface SurfaceDecals {
  rills?: { top?: number; length?: number; density?: number };
  damp?: number; stains?: number; cracks?: number; soot?: number;
  leaks?: number | { spacing?: number; top?: number };
}
export interface SurfaceHookOptions {
  mode?: 'procedural' | 'baked';
  baked?: { c: THREE.Texture; n: THREE.Texture };
  mapping?: 'tri' | 'wall' | 'ground' | 'grain' | 'uv';
  /** 'grain': the grain direction ([x, y, z]); others: the world axis kept as u */
  grain?: readonly [number, number, number] | 'x' | 'y' | 'z';
  space?: 'world' | 'object';
  uvScale?: number;
  ground?: number;
  breaker?: boolean;
  edges?: 'curvature' | 'attribute';
  decals?: SurfaceDecals;
  decalAtlas?: THREE.Texture;
  /** asphalt: a GLSL float 0..1, the road marking's mask */
  paint?: string;
  paintColor?: SurfaceColor;
  paintWear?: number;
  debug?: 'albedo' | 'rough' | 'height' | 'metal';
  lod?: number;
}
export interface SurfaceMaterialOptions extends Omit<SurfaceHookOptions, 'mode'> {
  mode?: 'auto' | 'procedural' | 'baked';
  wet?: boolean | WetOptions;
  /** bake size (px) */
  size?: number;
  params?: THREE.MeshPhysicalMaterialParameters;
}
export interface BakedSurface { c: THREE.Texture; n: THREE.Texture; target: THREE.WebGLRenderTarget; size: number; ms: number; bytes: number }
export interface SurfaceLibrary {
  material(spec: SurfaceSpec, options?: SurfaceMaterialOptions): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  hooks(spec: SurfaceSpec, options?: SurfaceMaterialOptions): MaterialHooks;
  bake(spec: SurfaceSpec, size?: number): BakedSurface;
  stats(): { baked: number; ms: number; bytes: number; materials: number };
  dispose(): void;
  SURFACES: typeof SURFACES;
  KINDS: typeof SURFACE_KINDS;
}

export const SURFACES: { readonly [K in SurfaceKind]: (options?: SurfaceOptions) => SurfaceSpec };
export const SURFACE_KINDS: { readonly [K in SurfaceKind]: SurfaceKindInfo };
/** F0 (linear) of common metals. */
export const METALS: Record<string, [number, number, number]>;
export function surfaceHooks(spec: SurfaceSpec, options?: SurfaceHookOptions): MaterialHooks;
export function bakeSurface(renderer: THREE.WebGLRenderer, spec: SurfaceSpec, options?: { size?: number; anisotropy?: number }): BakedSurface;
export function bakeDecalAtlas(renderer: THREE.WebGLRenderer, size?: number): THREE.WebGLRenderTarget;
export function createSurfaces(world: { renderer: THREE.WebGLRenderer; mat: MaterialKit }, options?: { mode?: 'auto' | 'procedural' | 'baked'; size?: number; anisotropy?: number }): SurfaceLibrary;
/** The runtime layer's shared noise texture (RGBA8 256 x 256, four tileable fractal channels; made once in JS). */
export function noiseTexture(): THREE.DataTexture;

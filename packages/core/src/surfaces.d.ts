import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from './materials.js';
import type { WetOptions } from './wet.js';

/** A registered kind's name (@miragekit/assets/surfaces narrows it to the library's 35). */
export type SurfaceKind = string;
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
  /** where edge wear comes from: the surface's curvature (bevelled meshes), a vertex attribute `edge` 0..1, or 'box':
   *  the distance to the edges of the drawn geometry's bounding box (unbevelled box-like meshes; with the curvature) */
  edges?: 'curvature' | 'attribute' | 'box';
  /** edges 'box': how far in from an edge the wear reaches (m, 0.03) */
  edgeWidth?: number;
  /** glass: through the transmission pass (refracts, tints and blurs what is behind; a MeshPhysicalMaterial) */
  transmission?: boolean;
  /** glass with transmission: the pane's thickness (m, 0.006) */
  thickness?: number;
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
  /** spec makers of the kinds registered when the library was made */
  SURFACES: Record<string, (options?: SurfaceOptions) => SurfaceSpec>;
  KINDS: Record<string, SurfaceKindInfo>;
}

/** A kind as registered: its table entry (the numbers, their packing, reference ranges) and optional program pieces. */
export interface SurfaceKindEntry {
  family: string; variants: readonly string[]; tile: number; depth: number; size?: number; porosity: number;
  refs: SurfaceRefs; defaults: Record<string, unknown>;
  cheap?: boolean; live?: boolean; physical?: boolean; mapping?: 'tri' | 'wall' | 'ground' | 'grain' | 'uv';
  micro?: readonly [number, number, number, number];
  variantDefaults?: Record<string, Record<string, unknown>>;
  pack(options: Record<string, any>): Record<'A' | 'B' | 'C' | 'D', number[]>;
  quantum?(options: Record<string, any>, tile: number, variant: number): [number, number];
  edge?(options: Record<string, any>, variant: number): { rgb: number[]; rough: number; metal: number; mode: number; chip: number };
  material?(options: Record<string, any>, variant: number): Record<string, unknown>;
  /** GLSL added to the evaluation before the runtime layer */
  body?(spec: SurfaceSpec, options: SurfaceHookOptions): string;
  /** adjust the hooks (output, emissive, normal...) */
  hooks?(hooks: MaterialHooks, spec: SurfaceSpec, options: SurfaceHookOptions): void;
  /** adjust the material parameters; true: a MeshPhysicalMaterial */
  prepare?(params: Record<string, unknown>, spec: SurfaceSpec, options: SurfaceMaterialOptions): boolean;
}
/** The weathering decals (options.decals) as registered. */
export interface SurfaceDecalRecipes {
  /** declares msDecals(inout MsS s, vec3 worldPos, vec3 worldNormal) */
  glsl: string;
  /** the atlas baker's fragment shader (GLSL3, uniform float msN) */
  fragment: string;
  uniforms(decals: SurfaceDecals): Record<string, { value: unknown }>;
}
/** Register kinds: table entries and their recipes (`glsl`: bakeable; `liveGlsl`: per pixel only). */
export function registerSurfaceKinds(kinds: { kinds?: Record<string, SurfaceKindEntry>; glsl?: Record<string, string>; liveGlsl?: Record<string, string> }): void;
export function registerSurfaceDecals(decals: SurfaceDecalRecipes): void;
/** Everything the framework knows about each registered kind. */
export function surfaceKinds(): Record<string, SurfaceKindInfo>;
/** A spec of a registered kind. */
export function surfaceSpec(kind: SurfaceKind, options?: SurfaceOptions): SurfaceSpec;
export function surfaceHooks(spec: SurfaceSpec, options?: SurfaceHookOptions): MaterialHooks;
export function bakeSurface(renderer: THREE.WebGLRenderer, spec: SurfaceSpec, options?: { size?: number; anisotropy?: number }): BakedSurface;
export function bakeDecalAtlas(renderer: THREE.WebGLRenderer, size?: number): THREE.WebGLRenderTarget;
export function createSurfaces(world: { renderer: THREE.WebGLRenderer; mat: MaterialKit }, options?: { mode?: 'auto' | 'procedural' | 'baked'; size?: number; anisotropy?: number; tier?: 'high' | 'low' }): SurfaceLibrary;
/** The runtime layer's shared noise texture (RGBA8 256 x 256, four tileable fractal channels; made once in JS). */
export function noiseTexture(): THREE.DataTexture;

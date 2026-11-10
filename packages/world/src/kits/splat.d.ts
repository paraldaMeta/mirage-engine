import type * as THREE from 'three';

/** Gaussian splats in the kit's shape: per splat a centre, sigma per axis (linear), a unit quaternion (x y z w) and
 *  sRGB colour + opacity bytes. */
export interface SplatData {
  count: number;
  center: Float32Array;
  scale: Float32Array;
  rot: Float32Array;
  color: Uint8Array;
  /** Trained with the anti-aliasing filter (SOG `model: 'antialiased'`): addSplats compensates opacity by default. */
  antialias?: boolean;
}
export interface SplatImage { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export interface SplatBounds { min: [number, number, number]; max: [number, number, number]; centre: [number, number, number]; radius: number }
/** GLSL run per splat in the vertex shader (see the world README, "Gaussian splats"). */
export interface SplatEffect {
  name?: string;
  /** progress when addSplats is given no `progress` */
  rest?: number;
  /** uFx.yzw */
  params?: readonly number[];
  /** uFx2 from the data's bounds */
  bind?(info: SplatBounds & { count: number }): readonly number[];
  decl?: string;
  center?: string;
  color?: string;
  scale?: string;
  uniforms?: Record<string, THREE.IUniform>;
}
export interface SplatOptions {
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
  /** Splats whose footprint is under this many pixels across are culled (1). */
  minPixelSize?: number;
  /** Opacity compensation for the 0.3 px low-pass (data.antialias). */
  antialias?: boolean;
  /** Brightness multiplier (1). */
  gain?: number;
  /** true: lit by the world's key light and sky; false: the golden-hour level at any time (true). */
  light?: boolean;
  effect?: SplatEffect | null;
  /** The effect's progress (its rest value, 1 without one). */
  progress?: number;
  /** Sort in a Blob worker (true); false sorts on the main thread. */
  worker?: boolean;
  /** Camera change (m, direction) under which the sort is kept (1e-3). */
  resort?: number;
  /** A depth-only second pass where a splat is at least this opaque, for SSAO and TAA (false). */
  depth?: false | number;
  name?: string;
}
export interface SplatStats { sorts: number; skipped: number; lastMs: number; maxMs: number; totalMs: number; visible: number; worker: boolean }
export interface Splats {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly count: number;
  readonly bounds: SplatBounds;
  readonly stats: SplatStats;
  progress: number;
  readonly effect: SplatEffect | null;
  setEffect(effect: SplatEffect | null): void;
  /** true once after the image changed (an effect, its progress, a sort that landed for a stale view); return it from play's onStep. */
  changed(): boolean;
  /** Sort now on the main thread for this camera; the ms it took. */
  sortNow(camera: THREE.Camera): number;
  /** Resolves once the sort in flight (if any) is in. */
  sorted(): Promise<void>;
  dispose(): void;
}
export function parseSplat(buffer: ArrayBuffer): SplatData;
export function parsePly(buffer: ArrayBuffer): SplatData;
export function parseSog(meta: object, images: Record<string, SplatImage>): SplatData;
export function loadSplats(url: string | URL, options?: { fetch?: typeof fetch }): Promise<SplatData>;
export function packSplats(data: SplatData, row: number): { data: Uint32Array; width: number; height: number };
export function splatBounds(data: SplatData): SplatBounds;
export function splatSorter(): {
  init(centers: Float32Array): void;
  sort(dir: readonly number[], offset: number, out: Uint32Array, eps?: number): { count: number; buckets?: number; ms: number } | null;
};
export const splatEffects: {
  reveal(options?: { origin?: readonly [number, number, number]; width?: number; glow?: number }): SplatEffect;
  dissolve(options?: { rise?: number; glow?: number }): SplatEffect;
};
export function addSplats(ctx: { root: THREE.Object3D; renderer?: THREE.WebGLRenderer; G?: { uKeyColor: { value: THREE.Vector3 }; uSkyLight: { value: number }; uFrame: { value: number } } }, data: SplatData, options?: SplatOptions): Splats;

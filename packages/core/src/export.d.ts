import type * as THREE from 'three';

export type BakeMap = 'color' | 'orm' | 'normal';
export interface ExportOptions {
  /** write a GLB (default true) */
  glb?: boolean;
  /** write a USDZ too (default false): instances merged, vertex colours baked, double-sided marked */
  usdz?: boolean;
  /** largest atlas edge in texels (default 1024) */
  bake?: number;
  /** most texels per metre (default 64) */
  density?: number;
  /** which maps to bake from the patch() hooks (default all three) */
  maps?: BakeMap[];
  /** opaque maps as JPEG (default true); PNG otherwise */
  jpeg?: boolean;
  /** supersampling per axis (default 2) */
  ss?: number;
  /** gutter texels around each chart (default 3) */
  pad?: number;
  /** share of each instanced mesh's instances kept in the USDZ (default 1) */
  usdzThin?: number;
  /** objects (and their subtrees) to leave out, e.g. play.figure */
  exclude?: THREE.Object3D[];
  onProgress?: (text: string) => void;
}
export interface ExportedMesh {
  kind: 'glb' | 'usdz'; name: string; module: string; material: string; instances: number; passes: BakeMap[];
  triangles: number; atlas?: number; density?: number; charts?: number; fallback?: string; cutout?: boolean;
}
export interface ExportReport {
  meshes: ExportedMesh[];
  skipped: { name: string; module: string; why: string }[];
  /** hooks (and ambientVolumes) whose effect the files cannot carry */
  lost: string[];
  textures: number; texels: number; bakeMs: number; ms: number;
}
export interface ExportResult { glb?: ArrayBuffer; usdz?: ArrayBuffer; glbScene?: THREE.Scene; report: ExportReport }
export interface WorldLike { scene: THREE.Scene; renderer: THREE.WebGLRenderer; G?: Record<string, { value: unknown }>; sky?: unknown; stars?: unknown; plan?: { name?: string } }

export function exportWorld(world: WorldLike, options?: ExportOptions): Promise<ExportResult>;

export interface Chart { axis: number; tris: number; minU: number; minV: number; maxU: number; maxV: number; x?: number; y?: number }
export interface Unwrapped { uv: Float32Array; chartOf: Int32Array; charts: Chart[] }
export function unwrap(positions: ArrayLike<number>, options?: { weld?: number }): Unwrapped;
export function layout(charts: Chart[], options?: { size?: number; density?: number; pad?: number; minSize?: number }): { size: number; density: number } | null;
export function atlasUV(unwrapped: Unwrapped, layout: { size: number; density: number }, pad?: number): Float32Array;
export function resolveBake(color: Uint8Array, cover: Uint8Array, size: number, ss: number, grow?: number): { rgba: Uint8ClampedArray; covered: Uint8Array; cut: number };
export function dilate(rgba: Uint8ClampedArray, covered: Uint8Array, n: number, passes: number): Uint8ClampedArray;
export function zipAligned(files: Record<string, Uint8Array>): Uint8Array;
export function zipOffsets(zip: Uint8Array): Record<string, number>;

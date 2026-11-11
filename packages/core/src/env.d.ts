import type * as THREE from 'three';

export interface EnvironmentUniforms {
  uTime: { value: number };
  uFrame: { value: number };
  uWind: { value: THREE.Vector3 };
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Vector3 };
  uLamp: { value: number };
  uLampGain: { value: number };
  uSkyLight: { value: number };
  uNight: { value: number };
  uUser: { value: THREE.Vector4 };
  uAmbN: { value: number };
  uAmbLo: { value: THREE.Vector4[] };
  uAmbHi: { value: THREE.Vector4[] };
  /** the grid path: origin x, z (m), 1 / cell size, data texture width */
  uAmbGrid: { value: THREE.Vector4 };
  /** the grid path: cells along x, z (x = 0 on the uniform path) */
  uAmbDim: { value: THREE.Vector4 };
  /** the grid path: cells, then 3 texels per (cell, box) */
  uAmbData: { value: THREE.DataTexture | null };
}
/** One box of writeAmbientVolumes / world.setAmbientVolumes. Inside, the image-based light is scaled by factor x tint
 *  per channel; it ramps back to 1 over `soft` metres outside the box. Overlapping boxes multiply. */
export interface AmbientVolumeBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** default 0.3 */
  factor?: number;
  /** metres, default 0.6 */
  soft?: number;
  /** linear RGB multiplier on top of factor, default [1, 1, 1] (a tint takes the grid path) */
  tint?: readonly [number, number, number];
}
export interface AmbientVolumesInfo {
  /** 'none', 'uniform' (at most AMB_MAX untinted boxes, the original path) or 'grid' */
  path: 'none' | 'uniform' | 'grid';
  boxes: number;
  cells: number;
  /** the most boxes a cell lists: the per-pixel cost on the grid path */
  maxPerCell: number;
  /** cells over AMB_PER_CELL boxes even at the finest cell size (each keeps its darkest) */
  overfull: number;
  texels: number;
  /** metres (0 off the grid) */
  cellSize: number;
}
export interface AmbientVolumesOptions {
  /** take the grid path for any list (default: only for more than AMB_MAX boxes or a tint) */
  grid?: boolean;
}
export const AMB_MAX: 8;
/** the most boxes one grid cell lists (the grid shader's constant loop bound) */
export const AMB_PER_CELL: 16;
export const GOLDEN: Readonly<{ elevation: 6.8; azimuth: 250 }>;
export function dirFromElevAz(elevation: number, azimuth: number, out?: THREE.Vector3): THREE.Vector3;
export function elevAzOf(direction: THREE.Vector3 | readonly [number, number, number]): { elevation: number; azimuth: number };
export function createEnv(options?: { wind?: { dir?: readonly [number, number]; strength?: number } }): {
  keyDir: THREE.Vector3; G: EnvironmentUniforms;
};
/** the uniform path's GLSL: float mgAmbient(vec3 p) */
export const AMBIENT_GLSL: string;
/** the grid path's GLSL: vec3 mgAmbientGrid(vec3 p); needs AMBIENT_GRID_DECL's uniforms */
export const AMBIENT_GRID_GLSL: string;
export const AMBIENT_GRID_DECL: string;
/** the ambient uniforms each path declares (0 none, 1 uniform, 2 grid) */
export const AMB_UNIFORMS: Readonly<Record<0 | 1 | 2, readonly string[]>>;
/** 0 no volumes, 1 the uniform path, 2 the grid path */
export function ambientMode(G: EnvironmentUniforms): 0 | 1 | 2;
/** the GLSL a patched material compiles for a path (grid: vec3 mgAmbientRGB(p) and float mgAmbient(p)) */
export function ambientGLSL(mode: 0 | 1 | 2): string;
/** write a list into G; recompile: the path changed (patched materials need needsUpdate) */
export function writeAmbientVolumes(G: EnvironmentUniforms, list?: readonly AmbientVolumeBox[], options?: AmbientVolumesOptions): { recompile: boolean; info: AmbientVolumesInfo };
/** is p within d metres of a box? */
export function ambientNear(G: EnvironmentUniforms, p: { x: number; y: number; z: number }, d: number): boolean;
/** free the grid path's texture */
export function disposeAmbient(G: EnvironmentUniforms): void;
export const WIND_GLSL: string;
/** @internal bumped when a module patches three's shader chunks; Mirage materials put it in their program cache key */
export const CHUNK_EPOCH: { n: number };

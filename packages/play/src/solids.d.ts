import type { WalkGrid } from './walkgrid.js';

export type SolidKind = 'kinematic' | 'dynamic' | 'static';
export interface SolidDef {
  /** half extents */
  box?: [number, number, number];
  /** [radius, half height] */
  cylinder?: [number, number];
  sphere?: number;
  /** centre */
  pos?: [number, number, number];
  yaw?: number;
  quat?: [number, number, number, number];
  kind?: SolidKind; mass?: number; name?: string;
  /** yours; { carve: false } keeps carveSolids off it */
  data?: any;
}
export interface Solid {
  id: number; name: string; kind: SolidKind; mass: number; data?: any;
  box: [number, number, number] | null; cylinder: [number, number] | null; sphere?: number;
  pos: [number, number, number]; quat: [number, number, number, number]; yaw: number;
  /** bumped by every real change of pose */
  rev: number;
  aabb: Float64Array;
  /** move it: { pos, yaw } (upright) or { pos, quat } */
  set(pose: { pos?: [number, number, number]; yaw?: number; quat?: [number, number, number, number] }): Solid;
  remove(): void;
}
export interface Volume { type: 'ladder' | 'water' | string; box: [number, number, number, number, number, number]; facing?: [number, number]; [key: string]: any }
export interface SolidPush { solid: Solid; impulse: [number, number, number]; point: [number, number, number] }
/** A walk grid with moving shapes composed in at query time. */
export interface SolidSpace extends WalkGrid {
  base: WalkGrid; solids: Map<number, Solid>; volumes: Volume[];
  /** bumped by every add / move / remove */
  version: number;
  /** impulses from movers, when nothing took them through onPush (linkSolids does) */
  pushes: SolidPush[];
  onPush: ((solid: Solid, ix: number, iy: number, iz: number, px: number, py: number, pz: number) => void) | null;
  add(def: SolidDef): Solid;
  onChange(fn: (solid: Solid, what: 'add' | 'move' | 'remove') => void): () => void;
  /** the solid a body with feet at y stands on, or null */
  groundSolid(x: number, z: number, y: number, step?: number): Solid | null;
  /** the solid holding the point (exact shape, no padding), or null */
  solidAt(x: number, y: number, z: number): Solid | null;
  addVolume(volume: Volume): Volume;
  removeVolume(volume: Volume): void;
  volumeAt(type: string, x: number, y: number, z: number): Volume | null;
  push(solid: Solid, ix: number, iy: number, iz: number, px: number, py: number, pz: number): void;
}
export function createSolids(grid: WalkGrid, options?: { bucket?: number }): SolidSpace;
export function volumeAt(volumes: Volume[], type: string, x: number, y: number, z: number): Volume | null;
/** true when the point is in the air of its column (not inside the ground or a solid) */
export function airAt(grid: WalkGrid, x: number, y: number, z: number): boolean;
/** 0..1: the fraction of the segment a -> b that is clear */
export function gridRay(grid: WalkGrid, a: ArrayLike<number>, b: ArrayLike<number>, step?: number): number;

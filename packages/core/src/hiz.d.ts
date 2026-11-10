import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
export interface OcclusionOptions { margin?: number; cutMetres?: number; cutDegrees?: number; confirm?: number; minTriangles?: number; depth?: number }
export interface OcclusionStats { objects: number; tested: number; hidden: number; hiddenTriangles: number; age: number; cuts: number; readbacks: number; ms: number }
export interface Occlusion { enabled: boolean; /** draw with nothing hidden, state untouched */ bypass: boolean; stats: OcclusionStats;
  /** every mesh under root becomes a candidate (its world bounds are taken now: static objects) */
  add(root: THREE.Object3D): void; remove(root: THREE.Object3D): void;
  /** the scene moved by (dx, dy, dz): a floating-origin rebase */ shift(dx: number, dy: number, dz: number): void; dispose(): void }
/** occlusion culling from the previous frame's depth: a max-depth pyramid read back asynchronously and tested on the CPU against object bounds */
export function createOcclusion(world: WorldRenderer, options?: OcclusionOptions): Occlusion;

import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
import type { Impostor } from './impostor.js';
export interface InstancesOptions { source: THREE.Object3D; /** 16 floats per instance */ matrices: Float32Array;
  ratios?: readonly number[]; errorPx?: number; hysteresis?: number;
  /** true or bake options: an octahedral impostor is the last level */ impostor?: boolean | { frames?: number; tile?: number }; impostorPx?: number;
  maxDistance?: number; /** size (m) of the culling grid's cells */ cell?: number; castShadow?: boolean; receiveShadow?: boolean; shadowMargin?: number;
  auto?: boolean; collide?: boolean }
export interface InstancesStats { instances: number; visible: number; perLevel: number[]; cells: number; cellsTested: number; instancesTested: number; triangles: number; ms: number; frames: number }
export interface Instances { object: THREE.Group; stats: InstancesStats; levels: unknown[]; errors: number[]; impostor: Impostor | null;
  update(camera: THREE.Camera, heightPx: number, force?: boolean): void;
  /** after writing into `matrices`: rebuild the culling grid */ refresh(): void; dispose(): void }
/** instanced drawing with per-instance frustum culling and per-instance LOD on the CPU (a grid of cells, then the instances of partly visible cells) */
export function createInstances(world: WorldRenderer, options: InstancesOptions): Instances;

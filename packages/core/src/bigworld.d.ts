import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
import type { ChunkOptions } from './chunk.js';
import type { AutoLod, AutoLodOptions, AutoLodStats } from './autolod.js';
import type { Occlusion, OcclusionOptions, OcclusionStats } from './hiz.js';
export interface BigWorldOptions { chunk?: boolean | ChunkOptions; lod?: boolean | AutoLodOptions; occ?: boolean | OcclusionOptions }
type ChunkResult = { meshes: THREE.Mesh[]; chunks: number; split: number };
export interface BigWorld { chunk: ChunkResult | null; lod: AutoLod | null; occ: Occlusion | null;
  stats(): { chunk: ChunkResult | null; lod: AutoLodStats | null; occ: OcclusionStats | null };
  /** the LOD chains are built */ ready(): Promise<unknown>; dispose(): void }
/** chunks, automatic LOD and occlusion culling for a scene that is already built; `options` may be 'chunk,lod,occ' (a URL flag) */
export function applyBigWorld(world: WorldRenderer, root?: THREE.Object3D, options?: BigWorldOptions | string): BigWorld;

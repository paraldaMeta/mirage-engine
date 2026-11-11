import type * as THREE from 'three';
import type { LRUCache, UploadBudget } from '@miragekit/core/stream';
import type { PlanInput, Bounds } from './plan.js';
import type { ModuleContext, WorldHost } from './loader.js';
export interface StreamedModule<P extends PlanInput = PlanInput> {
  name: string;
  /** XZ centre; the module comes in within `radius` metres of it. */
  center: readonly [x: number, z: number];
  radius: number;
  build(ctx: ModuleContext<P>): unknown | Promise<unknown>;
}
export interface StreamerOptions<P extends PlanInput = PlanInput> {
  plan: P; modules: readonly StreamedModule<P>[]; shared?: Record<string, unknown>; camera?: THREE.Camera;
  /** loads at once (1) */ concurrency?: number;
  /** LRU bytes of modules out of range kept for a quick return (256 MB) */ budget?: number;
  /** texture upload bytes a frame (8 MB) */ uploadBytes?: number;
  /** leave beyond radius x this (1.25) */ hysteresis?: number;
  /** load in the frame it comes in range (the baseline) */ sync?: boolean;
  onChange?(name: string, inScene: boolean, region: Bounds | null): void;
  log?: { log(...values: unknown[]): void; error(...values: unknown[]): void };
}
export interface Streamer {
  upload: UploadBudget; cache: LRUCache<THREE.Object3D>;
  stats: { loads: number; unloads: number; evictions: number; builds: { name: string; t0: number; build: number; compile?: number; upload?: number; total: number }[] };
  /** Once a frame before the draw. */
  update(position: THREE.Vector3 | readonly [number, number, number]): { textures: number; bytes: number; ms: number };
  state(): Record<string, 'out' | 'loading' | 'in' | 'cached' | 'failed'>;
  idle(): Promise<void>;
  dispose(): void;
}
export function createStreamer<P extends PlanInput>(world: WorldHost & { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; pipeline?: { sceneRT: THREE.WebGLRenderTarget } }, options: StreamerOptions<P>): Streamer;
/** The XZ rectangle an object covers, padded (null when empty). */
export function regionOf(root: THREE.Object3D, pad?: number): Bounds | null;

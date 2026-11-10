import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
import type { SimplifiedLevel, SimplifyMesh } from './simplify.js';
export interface AutoLodOptions { ratios?: readonly number[]; errorPx?: number; hysteresis?: number; fade?: number; minTriangles?: number;
  /** worker threads for the simplifier (0: on the main thread, `budgetMs` a frame) */ workers?: number; budgetMs?: number;
  maxError?: number; weights?: Record<string, number>; /** false: call update(camera, heightPx) yourself */ auto?: boolean }
export interface AutoLodStats { meshes: number; built: number; pending: number; levels: number; sourceTriangles: number; drawnTriangles: number; fading: number; buildMs: number; switches: number }
export interface AutoLod { stats: AutoLodStats; entries: unknown[];
  /** every mesh under root with at least minTriangles gets a chain of simplified levels, built in the background */
  add(root: THREE.Object3D): void; remove(root: THREE.Object3D): void;
  update(camera: THREE.Camera, heightPx: number): void;
  /** resolves when every queued chain is built */ ready(): Promise<unknown>; buildNow(): void;
  /** force one level everywhere (null: back to screen-size selection) */ freeze(level: number | null): void;
  /** finish running cross-fades at once (for a still) */ settle(): void; dispose(): void }
export function createAutoLod(world: WorldRenderer, options?: AutoLodOptions): AutoLod;
export interface ProxyOptions { material?: THREE.Material; triangles?: number; ratio?: number; error?: number; origin?: THREE.Matrix4;
  colorOf?: (material: THREE.Material, object: THREE.Mesh) => THREE.Color | null | undefined; lockBorder?: boolean }
/** HLOD: every mesh under roots merged into one vertex-coloured mesh and simplified; null when there is nothing to merge */
export function buildProxy(roots: THREE.Object3D | THREE.Object3D[], options?: ProxyOptions): THREE.Mesh | null;
export function buildProxyAsync(roots: THREE.Object3D | THREE.Object3D[], options?: ProxyOptions, workers?: SimplifyWorkers): Promise<THREE.Mesh | null>;
export interface SimplifyWorkers { readonly workers: number; run(mesh: SimplifyMesh, chainOptions?: { ratios?: readonly number[]; error?: number; minGain?: number }): Promise<SimplifiedLevel[]>; dispose(): void }
export function createSimplifyWorkers(count?: number): SimplifyWorkers;

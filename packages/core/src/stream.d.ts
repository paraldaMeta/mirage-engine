import type * as THREE from 'three';
export interface Job<D = unknown> { key: string; priority: number; data: D; cancelled: boolean }
export interface JobQueue<D = unknown> {
  /** Queue fn under key (a key already waiting or running returns its promise). The lowest priority(job) runs first. */
  add<R>(key: string, fn: (job: Job<D>) => R | Promise<R>, options?: { priority?: number; data?: D }): Promise<R>;
  /** Drops a waiting job (its promise rejects with `cancelled: true`); a running one only gets job.cancelled = true. */
  cancel(key: string): boolean;
  has(key: string): boolean;
  readonly waiting: number; readonly running: number;
  idle(): Promise<void>;
}
export function createJobQueue<D = unknown>(options?: { concurrency?: number; priority?: (job: Job<D>) => number }): JobQueue<D>;
export interface LRUCache<V = unknown> {
  readonly bytes: number; readonly size: number; budget: number;
  has(key: string): boolean;
  /** Marks the entry used. */
  get(key: string): V | undefined;
  set(key: string, value: V, bytes?: number): V;
  pin(key: string): boolean; unpin(key: string): void;
  /** Removes without evict(). */
  delete(key: string): boolean;
  /** Evicts unpinned entries, oldest first, until bytes <= to (default: the budget). */
  trim(to?: number): string[];
  keys(): string[];
}
export function createLRU<V = unknown>(options?: { budget?: number; evict?: (key: string, value: V) => void }): LRUCache<V>;
export interface UploadBudget {
  add(...textures: (THREE.Texture | THREE.Texture[])[]): UploadBudget;
  readonly pending: number;
  uploaded(texture: THREE.Texture): boolean;
  /** Call once a frame before the draw. */
  step(): { textures: number; bytes: number; ms: number };
  whenDone(textures?: THREE.Texture | THREE.Texture[]): Promise<void>;
}
export function createUploadBudget(renderer: THREE.WebGLRenderer, options?: { bytes?: number; count?: number }): UploadBudget;
/** Estimated GPU bytes (0 before the image arrives). */
export function textureBytes(texture: THREE.Texture): number;
export function objectBytes(root: THREE.Object3D): number;
export function texturesOf(object: THREE.Object3D): Set<THREE.Texture>;
export function disposeObject(root: THREE.Object3D, options?: { keepTextures?: boolean }): void;
export interface LongTaskStats { count: number; totalMs: number; maxMs: number; source: 'longtask' | 'frame-gap' | 'none'; tasks: { start: number; ms: number }[] }
export function watchLongTasks(): { stats(): LongTaskStats; stop(): LongTaskStats };
export function nextFrame(timeout?: number): Promise<void>;

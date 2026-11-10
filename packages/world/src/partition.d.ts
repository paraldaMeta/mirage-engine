import type * as THREE from 'three';
import type { WorldHost } from './loader.js';
import type { Streamer } from './stream.js';
export interface PartitionCell { name: string; ix: number; iz: number; /** absolute centre */ x: number; z: number; size: number;
  root: THREE.Object3D | null; inScene: boolean; proxy: THREE.Mesh | null }
export interface PartitionOptions { bounds: [number, number, number, number]; size?: number;
  /** a cell's content, in the cell's own space (its centre is the origin); also called once per cell to bake its proxy (ctx.proxy === true) */
  build(cell: PartitionCell, ctx: any): void | Promise<void>;
  load?: number; hysteresis?: number;
  proxy?: null | { ratio?: number; triangles?: number; material?: THREE.Material; lockBorder?: boolean; workers?: number;
    colorOf?: (material: THREE.Material, object: THREE.Mesh) => THREE.Color | null | undefined };
  origin?: null | { threshold?: number; snap?: number; vertical?: boolean };
  onCell?(cell: PartitionCell, inScene: boolean, root: THREE.Object3D): void; onProxy?(cell: PartitionCell, mesh: THREE.Mesh): void; onRebase?(shift: THREE.Vector3): void;
  concurrency?: number; budget?: number; shared?: object; log?: Pick<Console, 'log' | 'warn' | 'error'>; name?: string; seed?: string | number }
export interface PartitionStats { cells: number; in: number; proxies: number; proxyQueue: number; proxyMs: number; proxyTriangles: number; proxySourceTriangles: number; rebases: number }
export interface Partition { cells: PartitionCell[]; stats: PartitionStats; /** absolute position of the scene's origin */ offset: THREE.Vector3; streamer: Streamer;
  /** once a frame before the draw; may move the camera (a rebase) */ update(camera?: THREE.Camera): unknown;
  cellAt(x: number, z: number): PartitionCell | null; ready(): Promise<PartitionStats>; dispose(): void }
export function createPartition(world: WorldHost, options: PartitionOptions): Partition;
export function createFloatingOrigin(options?: { roots?: THREE.Object3D[]; threshold?: number; snap?: number; onRebase?(shift: THREE.Vector3): void }):
  { offset: THREE.Vector3; update(camera: THREE.Camera): THREE.Vector3 | null };

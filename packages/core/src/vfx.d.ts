import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
import type { VfxEffect, VfxDefinedEffect, VfxColor } from './vfx-data.js';

type P3 = readonly [number, number, number] | THREE.Vector3;
export interface VfxPlace { position?: P3; quaternion?: THREE.Quaternion; direction?: P3; scale?: number; velocity?: P3; rate?: number }
export interface VfxHandle {
  readonly effect: VfxDefinedEffect; readonly done: boolean; stopped: boolean;
  move(to: VfxPlace & { matrix?: THREE.Matrix4 }): VfxHandle;
  /** stop emitting; particles in the air live out their lives */
  stop(): VfxHandle;
}
export interface VfxStats { pools: number; particles: number; capacity: number; spawned: number; dropped: number; steps: number; instances: number; budget: number; simMs: number; sortPasses: number }
export interface VfxOptions { hz?: number; maxParticles?: number; instances?: number; windSpeed?: number; gain?: number }
export interface VfxBeamOptions { from: P3; to: P3; width?: number; color?: VfxColor; intensity?: number; life?: number; jitter?: number; rate?: number; branches?: number; seed?: number }
export interface VfxDecalOptions { position: P3; normal?: P3; size?: number | [number, number]; depth?: number; rotation?: number; pattern?: 'soft' | 'scorch' | 'splat' | 'crack' | 'ring';
  blend?: 'multiply' | 'add'; color?: VfxColor; intensity?: number; opacity?: number; life?: number; fade?: number; seed?: number }
export interface VfxGround { min: [number, number]; size: [number, number]; res: [number, number]; heightAt(x: number, z: number): number }
export interface Vfx {
  readonly root: THREE.Group; readonly stats: VfxStats; readonly hz: number; readonly effects: Map<string, VfxDefinedEffect>;
  define(effect: VfxEffect): VfxDefinedEffect;
  spawn(effect: string | VfxEffect | VfxDefinedEffect, place?: VfxPlace & { follow?: THREE.Object3D }): VfxHandle;
  burst(effect: string | VfxEffect | VfxDefinedEffect, position: P3, place?: VfxPlace): void;
  prewarm(effect: string | VfxEffect | VfxDefinedEffect, options?: { instances?: number; compile?: boolean }): unknown;
  /** advance to time T (seconds); a Mirage world calls it from its own clock */
  update(T: number): void;
  clear(): void; release(effect: string | VfxEffect | VfxDefinedEffect): void; dispose(): void;
  /** exact live count: reads the state back from the GPU (slow; tools and tests) */
  countAlive(): number;
  /** a walk grid (bakeWalkGrid) or a height function, for `collision.ground`; null clears */
  setGround(grid: VfxGround | { nx: number; nz: number; x0: number; z0: number; cell: number; groundAt(x: number, z: number): number } | null): void;
  registerMesh(name: string, geometry: THREE.BufferGeometry, options?: { samples?: number; seed?: number }): void;
  registerField(name: string, field: { size: [number, number, number]; data?: Float32Array; fn?: (u: number, v: number, w: number) => [number, number, number] }): void;
  registerSheet(name: string, sheet: { texture: THREE.Texture; cols: number; rows: number }): void;
  beam(options: VfxBeamOptions): { remove(): void };
  decal(options: VfxDecalOptions): { remove(): void };
}
/** GPU particles, trails, beams and decals for a Mirage world or a plain three.js scene (then call update yourself) */
export function createVfx(target: WorldRenderer | { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; G?: object }, options?: VfxOptions): Vfx;

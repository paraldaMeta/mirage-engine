import type * as THREE from 'three';
export interface PlumeLamp { pos: readonly number[]; color: readonly number[]; power: number; range: number }
export interface PlumeOptions {
  /** its foot [x, y, z] */
  pos: readonly number[];
  height?: number; radius?: number; density?: number;
  /** [x, z] metres at the top (the wind) */
  lean?: readonly number[];
  /** rise speed (m/s) */
  rise?: number; seed?: number;
  /** sun visibility at its foot, middle, top (0..1) */
  sun?: readonly number[];
  lamp?: PlumeLamp | null;
  /** 0..1 a fade the caller drives */
  strength?: number;
}
export interface Plumes {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  add(options: PlumeOptions): number;
  set(id: number, options: Partial<PlumeOptions>): void;
  get(id: number): Required<PlumeOptions> | undefined;
  remove(id: number): void;
  readonly count: number;
  /** sort and upload the plumes near the camera (once a frame) */
  update(camera: THREE.Camera): void;
  dispose(): void;
}
/** Lit volumetric plumes (steam, thin smoke) in one instanced draw (opt-in): see plumes.js. */
export function createPlumes(world: { G: Record<string, THREE.IUniform> }, options?: { budget?: number; slices?: number; far?: number; ambient?: readonly number[] }): Plumes;

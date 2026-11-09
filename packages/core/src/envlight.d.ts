import type * as THREE from 'three';
export interface EnvironmentLight {
  fade: number; readonly texture: THREE.Texture | null; readonly fading: boolean;
  capture(scene: THREE.Scene, position: readonly [number, number, number], options?: { instant?: boolean }): void;
  tick(dt: number): boolean;
  /** Disposes captures, PMREM and blending resources, but not the host renderer. */
  dispose(): void;
}
export function createEnvLight(renderer: THREE.WebGLRenderer, options?: { size?: number; fade?: number }): EnvironmentLight;

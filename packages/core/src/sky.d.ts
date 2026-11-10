import type * as THREE from 'three';
export interface SkyUniforms {
  uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>; uMoonI: THREE.IUniform<number>; uMoonDisc: THREE.IUniform<number>; uMoonR: THREE.IUniform<number>;
  uNightGlow: THREE.IUniform<THREE.Vector3>; uCloudCover: THREE.IUniform<number>; uCloudOffset: THREE.IUniform<THREE.Vector2>;
  uCapture: THREE.IUniform<number>; uEq: THREE.IUniform<THREE.Matrix3>; uStarVis: THREE.IUniform<number>; uStarGain: THREE.IUniform<number>;
  /** set by createSkyLut */
  tSkyCol?: THREE.IUniform<THREE.Texture>; tSkyTr?: THREE.IUniform<THREE.Texture>;
}
export function createSkyUniforms(): SkyUniforms;
export function createSky(uniforms: SkyUniforms): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
/** Bake the sky's air (scattering, airglow, ground) into direction tables the dome reads instead of marching per
 *  pixel. Call before createSky(uniforms); call bake() after the Sun / Moon / night-glow uniforms change. */
export function createSkyLut(renderer: THREE.WebGLRenderer, uniforms: SkyUniforms, options?: { width?: number; height?: number }): { bake(): void; dispose(): void };

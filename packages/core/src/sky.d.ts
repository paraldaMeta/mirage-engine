import type * as THREE from 'three';
export interface SkyUniforms {
  uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>; uMoonI: THREE.IUniform<number>; uMoonDisc: THREE.IUniform<number>; uMoonR: THREE.IUniform<number>;
  uNightGlow: THREE.IUniform<THREE.Vector3>; uCloudCover: THREE.IUniform<number>; uCloudOffset: THREE.IUniform<THREE.Vector2>;
  uCapture: THREE.IUniform<number>; uEq: THREE.IUniform<THREE.Matrix3>; uStarVis: THREE.IUniform<number>; uStarGain: THREE.IUniform<number>;
}
export function createSkyUniforms(): SkyUniforms;
export function createSky(uniforms: SkyUniforms): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

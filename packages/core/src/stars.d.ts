import type * as THREE from 'three';
import type { SkyUniforms } from './sky.js';
export function brightStars(): { ra: number; dec: number; mag: number; bv: number }[];
export function createStars(uniforms: Pick<SkyUniforms, 'uEq' | 'uStarVis' | 'uStarGain'>, options?: { faint?: number }): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

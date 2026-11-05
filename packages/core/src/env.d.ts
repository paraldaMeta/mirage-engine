import type * as THREE from 'three';

export interface EnvironmentUniforms {
  uTime: { value: number };
  uFrame: { value: number };
  uWind: { value: THREE.Vector3 };
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Vector3 };
  uLamp: { value: number };
  uLampGain: { value: number };
  uSkyLight: { value: number };
  uNight: { value: number };
  uUser: { value: THREE.Vector4 };
  uAmbN: { value: number };
  uAmbLo: { value: THREE.Vector4[] };
  uAmbHi: { value: THREE.Vector4[] };
}
export const AMB_MAX: 8;
export const GOLDEN: Readonly<{ elevation: 6.8; azimuth: 250 }>;
export function dirFromElevAz(elevation: number, azimuth: number, out?: THREE.Vector3): THREE.Vector3;
export function elevAzOf(direction: THREE.Vector3 | readonly [number, number, number]): { elevation: number; azimuth: number };
export function createEnv(options?: { wind?: { dir?: readonly [number, number]; strength?: number } }): {
  keyDir: THREE.Vector3; G: EnvironmentUniforms;
};
export const AMBIENT_GLSL: string;
export const WIND_GLSL: string;

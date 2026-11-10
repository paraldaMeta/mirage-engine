import type * as THREE from 'three';
export interface Light2Settings {
  ls: { on: boolean; slots: number; tile: number; cube: number; perFrame: number; refreshS: number; dynEvery: number; dayLevel: number; reach: number; near: number };
  ssr: { on: boolean; maxDist: number; gain: number; thick: number };
  vol: { on: boolean; sun: number; lamps: number; dustOut: number; golden: number; height: number; dustIn: number; lampDust: number; haloR: number; noise: number; g: number; maxDist: number; nearRoom: number; lampReach: number };
  bloom: { on: boolean; day: number; night: number };
}
/** `true`, or per part: `false` (off) or the fields to override. */
export type Light2Option = boolean | { [K in keyof Light2Settings]?: false | Partial<Light2Settings[K]> };
export const LIGHT2_DEFAULTS: Light2Settings;
/** The full settings for an option; null when off. */
export function light2Config(option?: Light2Option | null): Light2Settings | null;
/** Patch three's shader chunks once (page-global). False when three's chunks are not the expected ones. */
export function installLight2(): boolean;
export interface LampSource { x: number; y: number; z: number; range: number; power: number; near?: number; col?: [number, number, number] }
/** Register a lamp table on a scene: fn(cameraPosition) -> lamps that may get a shadow slot. */
export function addLampSource(scene: THREE.Scene, fn: (cameraPosition: THREE.Vector3) => LampSource[] | null | undefined): void;
export class LampShadows {
  constructor(renderer: THREE.WebGLRenderer, settings: Light2Settings['ls'], lampLevel?: () => number);
  stats: { slots: number; drawn: number; cands: number; tris: number };
  update(scene: THREE.Scene, camera: THREE.Camera): void;
  done(): void;
  clear(): void;
  dispose(): void;
}

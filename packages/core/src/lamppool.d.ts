import type * as THREE from 'three';
type V3 = [number, number, number];
export interface LampPoolSettings {
  /** Most lamps (the texture's record rows are sized for it). */
  max: number;
  /** Most lamps shaded in one cluster cell; the nearest are kept and `info.clipped` counts the rest. */
  perCell: number;
  /** Metres from the eye beyond which a lamp is not shaded; it fades out over the last `fade` metres. */
  far: number;
  fade: number;
  /** A lamp's power times the world's lamp gain (`G.uLampGain`: 0 by day); false: the power as given. */
  lampGain: boolean;
  /** A visible PointLight within 3 cm of a pool lamp is that lamp's real light: the pool adds only what it lacks. */
  real: boolean;
  /** Metres behind a lamp's wall over which its light fades out. */
  soft: number;
  /** Metres behind the wall face where the cut starts (0.4): reveals and soffits within it stay lit. */
  thick: number;
  /** With light2 on: pool lamps are lamp-shadow and in-scatter candidates (a PointLight on one is folded into it). */
  light2: boolean;
  /** Shade in cube captures too (the environment, lighting probes), as a PointLight is. */
  captures: boolean;
}
export type LampPoolOption = boolean | Partial<LampPoolSettings>;
/** One lamp of the pool. Units as three's PointLight: `power` is its intensity (candela), `range` its distance. */
export interface PoolLampInput {
  /** The flame (or `x`, `y`, `z`). */
  pos?: V3; x?: number; y?: number; z?: number;
  /** Metres (default 6). */
  range?: number;
  /** Default 1; times the lamp gain unless `lampGain: false`. */
  power?: number;
  /** Linear RGB (default a warm lantern: 1, 0.56, 0.25). */
  color?: V3;
  /** Default 2 (three's physical falloff). */
  decay?: number;
  /** The outward normal of the wall the lamp hangs on: nothing more than `soft` m behind the wall is lit. */
  normal?: V3;
  /** Metres from the flame back to the wall face along `normal` (default 0). */
  back?: number;
  /** Per lamp: where the cut starts behind the wall face (default the pool's `thick`). */
  thick?: number;
  /** A stable id for light2's slot (default: the lamp's place). */
  id?: string | number;
  /** The lamp-shadow cube's near plane with light2 (default: light2's `ls.near`, as for a PointLight without `userData.lsNear`). */
  near?: number;
}
export interface PoolLamp { x: number; y: number; z: number; range: number; power: number; r: number; g: number; b: number; decay: number; n: [number, number, number, number] | null; near: number | null }
export interface LampPoolInfo {
  lamps: number;
  /** Lamps shaded by the last render (some light left for the pool, within `far`). */
  active: number;
  /** PointLights found on pool lamps. */
  real: number;
  /** Cell list entries and the ones dropped by `perCell` (last binning). */
  indices: number; clipped: number;
  /** CPU time of the last binning (ms). */
  binMs: number;
  /** 0 off (day, no lamp), 1 one list (orthographic camera), 2 clustered. */
  mode: number;
  rows: number; renders: number;
}
export interface LampPool {
  cfg: LampPoolSettings;
  info: LampPoolInfo;
  readonly count: number;
  readonly lamps: readonly PoolLamp[];
  readonly texture: THREE.DataTexture;
  /** Replace every lamp; returns how many were kept (at most `max`). */
  set(lamps: PoolLampInput[]): number;
  /** Add one lamp; its index, or -1 when the pool is full. */
  add(lamp: PoolLampInput): number;
  /** Change lamp i (the fields given; the rest stay). */
  update(i: number, lamp: PoolLampInput): boolean;
  clear(): void;
  /** Wrap the lit materials added since the last call (the world does it in prepare, the pool every 30 renders). */
  adopt(): number;
  /** Look for the scene's PointLights again now (createWorldRenderer does it before every still frame). */
  rescan(): void;
  dispose(): void;
}
export const LAMPPOOL_DEFAULTS: LampPoolSettings;
/** The full settings for an option; null when off. */
export function lampPoolConfig(option?: LampPoolOption | null): LampPoolSettings | null;
/** What createWorldRenderer({ lampPool }) builds; `world` is the renderer's internals (renderer, scene, G, injector?, light2?). */
export function createLampPool(world: object, settings: LampPoolSettings): LampPool;
/** @internal a lamp as given -> the numbers the pool keeps */
export function poolLamp(lamp: PoolLampInput): PoolLamp;
/** @internal the share (0..1) of a lamp of `power` and colour `rgb` a PointLight of intensity `i` and colour `c` gives */
export function realShare(i: number, c: V3, power: number, rgb: V3): number;
/** @internal per cluster cell the lamps whose sphere reaches it, nearest first, at most perCell */
export function binLamps(lamps: { x: number; y: number; z: number; range: number }[], view: THREE.Matrix4, px: number, py: number, near: number, far: number, perCell: number): { offsets: Uint32Array; counts: Uint32Array; index: Uint32Array; clipped: number };

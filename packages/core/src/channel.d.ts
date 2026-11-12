import type * as THREE from 'three';
export interface ChannelWaterOptions {
  /** [x, z]: the water flows from -> to (required). */
  from: readonly [number, number];
  to: readonly [number, number];
  /** The rim's height (0). */
  y?: number;
  /** Inside width (m, 0.5). */
  width?: number;
  /** Rim to bed (m, 0.35). */
  depth?: number;
  /** The water's depth (m, 0.12). */
  water?: number;
  /** Flow speed (m/s, 0.6). */
  speed?: number;
  /** 0 glassy .. 1 lively (0.6). */
  turbulence?: number;
  /** Foam below the inflow 0..1 (0.8). */
  foam?: number;
  /** Linear albedo of the walls and the bed the shader traces. */
  wall?: readonly [number, number, number];
  bed?: readonly [number, number, number];
}
export interface ChannelWater {
  /** the surface (its material traces the cross-section) */
  water: THREE.Mesh;
  /** the inner walls and the bed: draw them with your own material */
  body: THREE.BufferGeometry;
  /** live: uChFlow (speed, turbulence, foam), uChWall, uChBed, … */
  uniforms: Record<string, THREE.IUniform>;
  material: THREE.MeshStandardMaterial;
}
/** A straight open channel of running water (opt-in): see channel.js. */
export function channelWater(world: { mat: { std(params: object, hooks: object): THREE.MeshStandardMaterial } }, options: ChannelWaterOptions): ChannelWater;

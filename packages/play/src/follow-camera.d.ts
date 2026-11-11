import type { WalkGrid } from './walkgrid.js';

export interface FollowCameraOptions {
  mode?: 'third' | 'first';
  /** boom length, pivot height above the feet, sideways offset (m) */
  distance?: number; height?: number; shoulder?: number;
  /** probe spread and the gap kept to a wall (m) */
  radius?: number;
  /** shortest boom (m) */
  min?: number;
  /** how fast the boom grows back (1/s) */
  ease?: number;
  yaw?: number; pitch?: number; pitchMin?: number; pitchMax?: number;
}
export interface FollowCamera extends Required<FollowCameraOptions> {
  /** the current boom (m) */
  arm: number;
  position: [number, number, number]; pivot: [number, number, number];
  /** near enough to see inside the figure: hide it */
  close: boolean;
  turn(dYaw: number, dPitch?: number): this;
  /** [x, z], unit: where "forward" is for the input */
  forward(): [number, number];
  update(dt: number, mover: { pos: ArrayLike<number>; body: { eye: number }; eye?: number; carry?: ArrayLike<number> }): this;
  apply<C extends { position: { set(x: number, y: number, z: number): unknown }; rotation: { set(x: number, y: number, z: number, order?: any): unknown } }>(camera: C): C;
}
export function createFollowCamera(grid: WalkGrid, options?: FollowCameraOptions): FollowCamera;

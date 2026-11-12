/** Angles in degrees. */
export interface IsoCameraOptions {
  /** above the horizon (52); pitchMin / pitchMax default to it (a fixed pitch) */
  pitch?: number; pitchMin?: number; pitchMax?: number;
  /** 0 = the camera south (+Z) of its target (35); yawMin / yawMax: limits (free) */
  yaw?: number; yawMin?: number; yawMax?: number;
  /** metres (22) and the zoom range (10 .. 34) */
  distance?: number; min?: number; max?: number;
  fov?: number; near?: number; far?: number;
  /** the point looked at, above the target (1 m) */
  lookHeight?: number;
  /** how fast the view catches up with the target (8 / s; Infinity: rigid) */
  follow?: number;
  zoomEase?: number;
  /** rad / s for the turn keys */
  turnSpeed?: number;
}
export interface IsoBindOptions {
  /** where the keys are heard (globalThis) */
  keyTarget?: EventTarget;
  /** turn left / right (['q', 'e']) */
  keys?: readonly [string, string];
  /** the mouse button that drags (2: right) */
  dragButton?: number;
  /** rad per pixel dragged (0.006) */
  drag?: number;
  /** zoom per wheel delta unit (0.0012) */
  wheel?: number;
  /** two-finger twist and pinch (true) */
  touch?: boolean;
}
export interface IsoCamera {
  /** radians */
  yaw: number; pitch: number;
  /** the boom now and the one it eases to (m) */
  distance: number; want: number;
  min: number; max: number; fov: number; near: number; far: number; lookHeight: number;
  readonly position: [number, number, number];
  readonly look: [number, number, number];
  follow(point: ArrayLike<number> | { x: number; y: number; z: number }): IsoCamera;
  snap(): IsoCamera;
  turn(dYaw: number, dPitch?: number): IsoCamera;
  zoom(factor: number): IsoCamera;
  update(dt: number): IsoCamera;
  apply<C extends { fov: number; near: number; far: number; updateProjectionMatrix(): void; position: { set(x: number, y: number, z: number): unknown }; lookAt(x: number, y: number, z: number): void; updateMatrixWorld(force?: boolean): void }>(camera: C): C;
  /** pointer, wheel and key listeners; returns unbind() */
  bind(dom: EventTarget & { setPointerCapture?(id: number): void }, options?: IsoBindOptions): () => void;
  dispose(): void;
}
export function createIsoCamera(options?: IsoCameraOptions): IsoCamera;

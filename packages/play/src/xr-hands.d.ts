/** The 25 WebXR hand joints in the order the gestures read them (x, y, z each). */
export const HAND_JOINTS: readonly string[];
export interface HandGestureOptions { pinchOn: number; pinchOff: number; pointHold: number; armWindow: number; straight: number; reach: number; curl: number }
/** The default thresholds (m, s and ratios). */
export const HAND_GESTURE: HandGestureOptions;
/** out[0..2] the index fingertip, out[3..5] the unit direction from its knuckle to the tip. */
export function indexRay<T extends { [i: number]: number }>(joints: ArrayLike<number>, out: T): T;
export function handMeasures(joints: ArrayLike<number>): { pinch: number; straight: number; reach: number; middle: number; ring: number };
export interface HandGesture {
  pinching: boolean; pointing: boolean; aiming: boolean; armed: boolean; event: 'act' | 'teleport' | null;
  /** joints: 75 numbers (HAND_JOINTS order); t: seconds. */
  update(joints: ArrayLike<number>, t: number): 'act' | 'teleport' | null;
  reset(): void;
}
export function createHandGesture(options?: Partial<HandGestureOptions>): HandGesture;

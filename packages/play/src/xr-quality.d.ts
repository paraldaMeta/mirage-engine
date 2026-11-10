export type XRProfileId = 'quest-2' | 'quest-3' | 'vision-pro' | 'pcvr' | 'default';
/** A device class's default quality. `tested` is false for all of them: no headset was available. */
export interface XRProfile {
  name: string; match: RegExp | null; framebufferScale: number; foveation: number;
  /** 0: not settable / left alone. */
  frameRate: number;
  /** The per-eye post chain by default (else the one-pass direct path). */
  post: boolean; msaa: number; ao: boolean; bloom: boolean; hands: boolean; ar: boolean; tested: boolean; note: string;
}
export const XR_PROFILES: Record<XRProfileId, XRProfile>;
/** The profile for a name or a user-agent string (default: this browser's). */
export function xrProfile(nameOrUserAgent?: string): XRProfile & { id: XRProfileId };

export interface XRLevel { scale: number; ao?: boolean; bloom?: boolean; post?: boolean }
/** The governor's ladder with the post chain: resolution, AO, resolution, bloom, then the direct path. */
export const XR_LEVELS: XRLevel[];
/** The ladder of the direct path: viewport scale only. */
export const XR_SCALE_LEVELS: XRLevel[];
export interface XRGovernorOptions {
  /** Display rate. Default 72. */
  hz?: number; levels?: XRLevel[];
  /** Step down over `high` x the period of smoothed CPU time (0.8); step up under `low` (0.55) for `calm` s (4). */
  high?: number; low?: number; calm?: number;
  /** Step down when more than `drops` (3) of the last `window` (45) intervals were late. */
  window?: number; drops?: number;
  /** Seconds after a step before the next (1); seconds ignored at the start of a session (1); first level (0). */
  hold?: number; warm?: number; start?: number;
}
export interface XRGovernor {
  index: number; steps: number; ema: number; late: number; reason: '' | 'cpu' | 'late' | 'calm';
  levels: XRLevel[]; readonly level: XRLevel; readonly period: number;
  setRate(hz: number): void;
  /** cpuMs: the frame callback's own time; intervalMs: since the previous callback. Returns the level index. */
  update(cpuMs: number, intervalMs: number): number;
  reset(): void;
}
export function createXRGovernor(options?: XRGovernorOptions): XRGovernor;
/** The rig's lift (m) that puts a head measured at headY at eye height; 0 for 'room'. */
export function heightOffset(posture: 'room' | 'standing' | 'seated', eye: number, headY: number): number;
/** Distance (m, positive inside) from (x, z) to the nearest edge of a boundary polygon [[x, z], ...]. */
export function boundsDistance(polygon: ArrayLike<readonly [number, number]> | null, x: number, z: number): number;

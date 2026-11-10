import type { WorldRenderer, DynamicResSettings } from './world.js';

export type PlatformQuality = 'low' | 'medium' | 'high';
export interface GpuTier { tier: 0 | 1 | 2 | 3; family: string; model: string; why: string }
/** GPU tier from a WebGL renderer string: 0 software, 1 low, 2 mid, 3 high */
export function gpuTier(renderer?: string): GpuTier;
export function osOf(nav?: { userAgent?: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } }): string;

export interface StartSettings { dynamicRes: Partial<DynamicResSettings> | false; maxFps: number; pixelRatio: number; shadowMapSize: number; msaa: number }
export interface DeviceCaps {
  mobile: boolean; os: string; touch: boolean; coarse: boolean; standalone: boolean; dpr: number; screen: [number, number] | null;
  cores: number; memory: number; saveData: boolean; reducedMotion: boolean; battery: { level: number; charging: boolean } | null;
  gpu: string; tier: number; gpuFamily: string; webgl2: boolean; maxTextureSize: number; maxRenderbufferSize: number; maxSamples: number;
  floatTargets: boolean; halfFloatTargets: boolean; floatLinear: boolean; anisotropy: number; astc: boolean; etc2: boolean; bc: boolean;
}
export interface DeviceProbe extends DeviceCaps { quality: PlatformQuality; why: string; saved: boolean; settings: StartSettings }
/** the quality level and start-up settings for a set of capabilities (pure); never 'high' */
export function qualityFor(caps?: Partial<DeviceCaps>): { quality: PlatformQuality; why: string; settings: StartSettings };
/** everything a page can learn about the device before it builds a world; a saved quality choice wins */
export function probeDevice(options?: { nav?: any; win?: any; storage?: Pick<Storage, 'getItem'> | null; gl?: WebGL2RenderingContext | null; force?: Partial<DeviceCaps> }): Promise<DeviceProbe>;

export interface ContextRecovery {
  readonly lost: boolean; readonly count: number;
  /** fn(world) runs after the engine's own re-bake; returns a function that removes it */
  onRestore(fn: (world: WorldRenderer) => void): () => void;
  /** lose the context and restore it after `hold` ms (WEBGL_lose_context) */
  simulate(options?: { hold?: number }): Promise<{ ms: number; count: number }>;
  dispose(): void;
}
export function createContextRecovery(world: WorldRenderer, options?: {
  play?: { running?: boolean; start(): void; stop(): void; wake(): void } | null; canvas?: HTMLCanvasElement;
  onLost?: () => void; onRestored?: (info: { ms: number; count: number }) => void; onGiveUp?: () => void; timeout?: number;
}): ContextRecovery;

export interface GovernorStep { name: string; scale: number; maxFps: number }
export const GOVERNOR_STEPS: GovernorStep[];
export interface GovernorSettings { budget: number; window: number; calm: number; hold: number; lowBattery: number; over: number; under: number }
export const GOVERNOR_DEFAULTS: GovernorSettings;
export type Pressure = 'nominal' | 'fair' | 'serious' | 'critical' | null;
/** one decision (pure): the step to be on and why */
export function governorStep(
  state: { step: number; since?: number; calmFor?: number },
  sample: { now: number; median?: number; pressure?: Pressure; battery?: { level: number; charging: boolean } | null },
  options?: Partial<GovernorSettings> & { steps?: number; capMs?: number },
): { step: number; why: string };
export interface QualityGovernor {
  readonly step: number; readonly name: string; readonly why: string; steps: GovernorStep[];
  frame(now: number): void;
  /** sample requestAnimationFrame itself; returns detach */
  attach(): () => void;
  /** pin a step; null hands it back */
  set(step: number | null): void;
  signals(): { pressure: Pressure; battery: { level: number; charging: boolean } | null; median: number; samples: number };
  dispose(): void;
}
export function createQualityGovernor(options?: Partial<GovernorSettings> & {
  world?: WorldRenderer | null; play?: { maxFps: number; powerSaver: boolean } | null; nav?: any; PressureObserver?: any;
  apply?: (step: number, info: GovernorStep & { why: string }) => void; onStep?: (step: number, info: GovernorStep & { why: string }) => void;
}): QualityGovernor;

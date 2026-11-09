export type Quality = 'low' | 'medium' | 'high';
export interface DeviceProfile { mobile: boolean; msaa: 0 | 4 }
export const QUALITY_LEVELS: Quality[];
export const QUALITY_KEY: 'mirage:quality';
export function deviceProfile(renderer?: { capabilities?: { maxSamples?: number } } | null, options?: { force?: boolean }): DeviceProfile;
export function pickQuality(options?: {
  storage?: Pick<Storage, 'getItem'> | null;
  nav?: { userAgent?: string; maxTouchPoints?: number; getBattery?: () => Promise<{ charging: boolean; level: number; chargingTime: number }> };
}): Promise<{ quality: Quality; why: string; gpu: string }>;

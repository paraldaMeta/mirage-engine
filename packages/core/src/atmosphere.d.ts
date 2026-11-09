export type RGB = [number, number, number];
export const ATMO: {
  Rg: number; Rt: number; betaR: RGB; HR: number; betaMs: number; betaMe: number; HM: number; g: number;
  betaO: RGB; ozoneH: number; ozoneColumn: number; observer: number; ms: number;
};
export const ATMOSPHERE_GLSL: string;
export function transmit(radius: number, cosine: number, clarity?: number): RGB;
export function transmitAtGround(elevationDegrees: number, clarity?: number): RGB;
export function scatter(direction: readonly [number, number, number], light: readonly [number, number, number], intensity: number, multipleScattering?: number): RGB;
export function skyLightAt(elevationDegrees: number, intensity?: number): { E: RGB; hz: RGB; hzToward: RGB; hzAway: RGB; zenith: RGB };

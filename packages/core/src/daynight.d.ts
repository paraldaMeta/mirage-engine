import type { Direction, Place, MoonPosition, AstronomicalSky } from './sky-time.js';
export type FixedSun = 'golden' | { elevation: number; azimuth: number } | null | undefined;
/** An ISO date string ('2026-06-21T18:00:00Z') is read as an instant. Bad input throws a TypeError naming the field. */
export type CalendarTime = Date | number | `${number}-${number}-${number}${string}` | { day: string; time?: string };
export type SkyTime = FixedSun | CalendarTime;
export type SkyState = Pick<AstronomicalSky, 'date' | 'sun' | 'moon' | 'eqToWorld'> | {
  date?: never; sun: { elevation: number; azimuth: number; dir: Direction }; moon: null; eqToWorld: null;
};
export interface LightState {
  keyDir: Direction; keyRGB: Direction; keyIsMoon: boolean; keyOn: boolean;
  sunSkyI: number; moonSkyI: number; moonDisc: number; moonR: number; nightGlow: Direction; starVis: number;
  eqToWorld: Float64Array | null; exposure: number; fog: Direction; glowDir: Direction; glow: Direction;
  warmth: number; lamp: number; night: number; skyLight: number;
}
export function skyState(time: FixedSun, place?: Place): SkyState;
export function skyState(time: SkyTime, place: Place): SkyState;
export function lightAt(state: { sun: { elevation: number; dir: Direction }; moon: MoonPosition | null; eqToWorld: Float64Array | null }): LightState;

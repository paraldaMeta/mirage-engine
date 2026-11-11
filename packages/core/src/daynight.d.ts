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
type RGB = [number, number, number];
/** One look of the time-of-day grade (GRADE_PRESETS): exposure in EV, temperature / tint added to the white balance,
 *  saturation / contrast multiplied, tonemapMix the AgX share of an ACES / AgX blend (null keeps post.tonemap),
 *  display-referred split toning (shadowTint / hiTint), sRGB black point, S-curve on luma (0 = off), punch (0..1: the
 *  AgX branch steeper and more saturated, AgX-punchy), clarity (local contrast against a 1/16-size blur), highlightWarmth
 *  (0..1: the bright end leans warm, as film's halation), display-referred RGB lift of the darks, display gamma (> 1 opens the darks). */
export interface GradeLookPreset {
  exposure: number; temperature: number; tint: number; saturation: number; contrast: number; tonemapMix: number | null;
  shadowTint: RGB; hiTint: RGB; black: number; curve: number; punch: number; clarity: number; highlightWarmth: number; lift: RGB; gamma: number;
}
/** gradeAt's result: as a preset, but exposure is a multiplier (2^EV x the night adaptation) and the tints are normalised to luma 1. */
export type GradeLook = GradeLookPreset;
export interface GradeSettings {
  /** 0..1: every term mixed from neutral (the tone-map blend from post.tonemap); 0 is the world's own look. */
  strength: number;
  /** 0..1: how much of the eye's dark adaptation (lightAt's exposure above 1) the grade takes back: a darker night. */
  nightAdapt: number;
  /** The highlights' tint as the lamps come on (light.lamp). */
  lampTint: RGB;
  noon: GradeLookPreset; golden: GradeLookPreset; dusk: GradeLookPreset; night: GradeLookPreset;
}
export interface GradeOptionObject extends Partial<Pick<GradeSettings, 'strength' | 'nightAdapt' | 'lampTint'>> {
  noon?: Partial<GradeLookPreset>; golden?: Partial<GradeLookPreset>; dusk?: Partial<GradeLookPreset>; night?: Partial<GradeLookPreset>;
}
export type GradeOption = boolean | GradeOptionObject | null | undefined;
/** The four looks the grade is keyed on (by the sun's elevation: night <= -12°, dusk -4°, golden 2..10°, noon >= 25°). */
export const GRADE_PRESETS: Readonly<{ noon: GradeLookPreset; golden: GradeLookPreset; dusk: GradeLookPreset; night: GradeLookPreset }>;
/** The full grade settings for `true` / a partial object (numbers clamped); null when off. */
export function gradeConfig(option?: GradeOption): GradeSettings | null;
/** The look of an hour (pure, deterministic). settings: gradeConfig()'s (default: the presets). */
export function gradeAt(light: Pick<LightState, 'exposure' | 'lamp'>, state: { sun: { elevation: number } }, settings?: GradeSettings | null): GradeLook;

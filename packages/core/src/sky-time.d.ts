export interface Place { lat: number; lon: number; height?: number; tzHours?: number }
export type Direction = [number, number, number];
export interface SunEquatorial { lambda: number; ra: number; dec: number; distanceAU: number; eps: number }
export interface MoonEquatorial { lambda: number; beta: number; ra: number; dec: number; distanceKm: number; eps: number }
export interface HorizontalPosition { elevation: number; elevationTrue: number; azimuth: number; dir: Direction }
export type SunPosition = SunEquatorial & HorizontalPosition;
export type MoonPosition = MoonEquatorial & HorizontalPosition & {
  raGeo: number; decGeo: number; elongation: number; phaseAngle: number; illumination: number; waxing: boolean; angularRadius: number;
};
export interface AstronomicalSky {
  date: Date; place: { lat: number; lon: number; height: number }; sun: SunPosition; moon: MoonPosition;
  lst: number; eqToWorld: Float64Array;
}
export function julianDay(date: Date): number;
export function gmst(date: Date): number;
export function sunEquatorial(date: Date): SunEquatorial;
export function moonEquatorial(date: Date): MoonEquatorial;
export function refraction(altitude: number): number;
export function dirFromAltAz(altitude: number, azimuth: number): Direction;
export function equatorialToWorld(lstDegrees: number, latitude: number): Float64Array;
export function skyAt(date: Date, place: Place): AstronomicalSky;
export function placeDate(day: string, time?: string, tzHours?: number): Date;
export function placeClock(date: Date, tzHours?: number): { day: string; time: string; hours: number };

export type DistanceModel = 'inverse' | 'linear' | 'exponential' | 'custom';
/** [[distance, gain], ...] (linear between points, clamped at the ends) or a function of distance in metres. */
export type RolloffCurve = [number, number][] | ((distance: number) => number);
export interface DistanceOptions { model?: DistanceModel; ref?: number; max?: number; rolloff?: number; curve?: RolloffCurve }
export interface ReverbParams { seconds: number; decay: number; damping: number; predelay: number; early: number; width: number; seed?: string }
export type ReverbPreset = 'room' | 'hall' | 'cave' | 'cathedral' | 'outdoor' | 'plate';
export type ReverbSpec = ReverbPreset | (Partial<ReverbParams> & { preset?: ReverbPreset });

export function dbToGain(db: number): number;
export function gainToDb(gain: number): number;
export function distanceGain(distance: number, options?: DistanceOptions): number;
/** dir: where the source points; toListener: from the source to the ears; angles are full cone angles in degrees. */
export function coneGain(dir: ArrayLike<number>, toListener: ArrayLike<number>, inner?: number, outer?: number, outerGain?: number): number;
/** The playback-rate factor for a moving source and listener (velocities in m/s), clamped so it stays playable. */
export function dopplerRatio(src: ArrayLike<number>, vSrc: ArrayLike<number>, lis: ArrayLike<number>, vLis: ArrayLike<number>, speedOfSound?: number, factor?: number): number;
/** occlusion 0..1 -> the gain and low-pass corner a voice gets. */
export function occlusionResponse(occlusion: number, options?: { gain?: number; freq?: number; open?: number }): { gain: number; freq: number };
export const REVERBS: Record<ReverbPreset, ReverbParams>;
export function reverbParams(spec?: ReverbSpec): ReverbParams;
/** A stereo impulse response made from seeded noise: unit energy, `decay` = the time to fall 60 dB. */
export function impulseResponse(options?: Partial<ReverbParams> & { sampleRate?: number }): [Float32Array, Float32Array];
/** PCM WAV (16-bit, or 32-bit float with bits = 32) from one Float32Array per channel. */
export function encodeWav(channels: Float32Array[], sampleRate?: number, bits?: 16 | 32): Uint8Array;
export function decodeWav(buffer: ArrayBuffer | ArrayBufferView): { sampleRate: number; channels: Float32Array[] };
/** The bytes of a data: URL (base64 or percent-encoded). */
export function dataUrlBytes(url: string): Uint8Array;
export function rms(samples: ArrayLike<number>, from?: number, to?: number): number;
export function peak(samples: ArrayLike<number>, from?: number, to?: number): number;
/** The amplitude of the sine at `freq` in samples[from, to) (Goertzel). */
export function toneLevel(samples: ArrayLike<number>, sampleRate: number, freq: number, from?: number, to?: number): number;
/** The first index at or after `from` whose absolute value reaches `level`, or -1. */
export function onset(samples: ArrayLike<number>, level?: number, from?: number): number;

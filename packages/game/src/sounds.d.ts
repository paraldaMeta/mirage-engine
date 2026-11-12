/** A random stream in [0, 1). */
export type Rng = () => number;
/** A per-sample filter. */
export type Filter = (x: number) => number;
export type SoundCategory = 'weapon' | 'ui' | 'step' | 'ambience' | 'machine' | 'vehicle' | 'nature';
export interface SoundDef {
  cat: SoundCategory;
  /** Variants (a mixer picks one at random). */
  n: number;
  /** A seamless loop. */
  loop?: boolean;
  desc: string;
  /** Render variant `v` at `sampleRate`: mono samples, peak under 0.93. */
  render(sampleRate: number, v?: number): Float32Array;
}
export interface RoomDef { early: readonly (readonly [number, number, number])[]; rt: number; size: number; damp: number; wet: number; pre: number; tail: number; box?: readonly [number, number] }
export interface MasterOptions { drive?: number; ceiling?: number; pre?: number; look?: number; release?: number; fade?: number }

/** Every sound by name. */
export const SOUNDS: Readonly<Record<string, SoundDef>>;
export const SOUND_CATEGORIES: readonly SoundCategory[];
/** The spaces a gun is heard in: 'alley', 'open', 'indoor'. */
export const SOUND_SPACES: readonly string[];
export const GUNS: readonly string[];
/** The names in a category, or all. Throws on an unknown category. */
export function soundNames(cat?: SoundCategory): string[];
/** One variant as a Float32Array (the variant wraps). Throws on an unknown name or a rate outside 8000..192000. */
export function renderSound(name: string, sampleRate?: number, variant?: number): Float32Array;
/** Every variant as one-channel AudioBuffers of `ctx`. */
export function soundBuffers(ctx: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>, name: string): AudioBuffer[];
/** Register sounds with a mixer that takes add(name, (ctx) => buffer | buffers), made at unlock. Returns the mixer. */
export function addSounds<A extends { add(name: string, make: (ctx: BaseAudioContext) => AudioBuffer | AudioBuffer[]): unknown }>(audio: A, names?: readonly string[], options?: { prefix?: string }): A;

// ---- the synthesis kit, for sounds of your own
export function makeRng(seed: number): Rng;
export function hash(s: string): number;
/** An RBJ biquad: 'lp' | 'hp' | 'bp' (0 dB peak) | 'peak' (gain in dB). */
export function biquad(type: 'lp' | 'hp' | 'bp' | 'peak', freq: number, q: number, sampleRate: number, gainDb?: number): Filter;
export function chain(...filters: Filter[]): Filter;
/** Attack then exponential decay, 0 before t = 0. */
export function env(t: number, attack: number, decay: number): number;
export function noiseLayer(out: Float32Array, sampleRate: number, R: Rng, t0: number, len: number, filter: Filter, attack: number, decay: number, gain: number): void;
export function thumpLayer(out: Float32Array, sampleRate: number, t0: number, f0: number, f1: number, tf: number, attack: number, decay: number, gain: number, len?: number): void;
export function modesLayer(out: Float32Array, sampleRate: number, R: Rng, t0: number, modes: readonly (readonly [number, number, number])[], gain: number, click?: number): void;
export function toneLayer(out: Float32Array, sampleRate: number, t0: number, len: number, freq: number | ((t: number) => number), attack: number, decay: number, gain: number,
  options?: { harm?: readonly (readonly [number, number])[]; vib?: readonly [number, number] | null; hold?: number }): void;
export const ROOMS: Readonly<Record<'alley' | 'open' | 'indoor', RoomDef>>;
/** The wet signal of `dry` in a room (early reflections and a diffuse tail). */
export function room(dry: Float32Array, sampleRate: number, name: 'alley' | 'open' | 'indoor', R: Rng): Float32Array;
/** Saturation, a look-ahead limiter and a fade: a new array, never past `ceiling`. */
export function master(x: Float32Array, sampleRate: number, options?: MasterOptions): Float32Array;
/** A one-shot renderer seeded by `key` and the variant. */
export function one(key: string, seconds: number, fn: (out: Float32Array, sampleRate: number, R: Rng, v: number) => void, options?: MasterOptions): (sampleRate: number, v?: number) => Float32Array;
/** A loop renderer: fn fills seconds + over; the overhang is cross-faded over the start, peak set to `level`. */
export function fold(key: string, seconds: number, fn: (out: Float32Array, sampleRate: number, R: Rng, v: number) => void, options?: { over?: number; level?: number }): (sampleRate: number, v?: number) => Float32Array;
export function click(out: Float32Array, sampleRate: number, R: Rng, t0: number, freq: number, gain: number, decay?: number): void;
export function scrape(out: Float32Array, sampleRate: number, R: Rng, t0: number, len: number, freq: number, gain: number): void;
export function renderShot(gun: string, space: string, sampleRate: number, v?: number): Float32Array;
export function renderGatlingLoop(space: string, sampleRate: number, seconds?: number, gap?: number): Float32Array;
export function renderGatlingTail(space: string, sampleRate: number): Float32Array;
export function renderRocketLaunch(space: string, sampleRate: number, v?: number): Float32Array;
export function renderExplosion(space: string, sampleRate: number, v?: number): Float32Array;

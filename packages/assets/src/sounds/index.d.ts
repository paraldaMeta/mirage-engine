import type { SoundDefinition } from '@miragekit/game/sounds';

export type SoundCategory = 'weapon' | 'ui' | 'step' | 'ambience' | 'machine' | 'vehicle' | 'nature';
export interface SoundDef extends SoundDefinition {
  cat: SoundCategory;
  /** Variants (a mixer picks one at random). */
  n: number;
  /** A seamless loop. */
  loop?: boolean;
  desc: string;
  /** Render variant `v` at `sampleRate`: mono samples, peak under 0.93. */
  render(sampleRate: number, v?: number): Float32Array;
}

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

export function renderShot(gun: string, space: string, sampleRate: number, v?: number): Float32Array;
export function renderGatlingLoop(space: string, sampleRate: number, seconds?: number, gap?: number): Float32Array;
export function renderGatlingTail(space: string, sampleRate: number): Float32Array;
export function renderRocketLaunch(space: string, sampleRate: number, v?: number): Float32Array;
export function renderExplosion(space: string, sampleRate: number, v?: number): Float32Array;

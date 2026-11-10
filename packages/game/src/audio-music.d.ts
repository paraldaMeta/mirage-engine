import type { AudioEngine } from './audio-engine.js';

export type Quantize = 'bar' | 'beat' | 'end' | 'now';
export interface MusicSection {
  /** length of the loop in bars */ bars: number;
  /** stem name -> a loaded sound, or { sound, gain } */
  stems: Record<string, string | { sound: string; gain?: number }>;
  bpm?: number; beatsPerBar?: number;
}
export interface MusicOptions { bpm?: number; beatsPerBar?: number; bus?: string; gain?: number; sections?: Record<string, MusicSection> }
export interface TransitionOptions { quantize?: Quantize; fade?: number; stinger?: string | null; stingerGain?: number }
export interface Music {
  readonly sections: Record<string, MusicSection>;
  readonly section: string | null; readonly pending: string | null; readonly playing: boolean;
  /** Whole bars and beats since the playing section started; phase 0..1 within the beat. */
  readonly position: { bar: number; beat: number; phase: number; time: number };
  onBeat: ((beat: number, bar: number, section: string) => void) | null;
  onSection: ((section: string) => void) | null;
  /** Start a section now. Returns the audio time (null while the context is locked: it starts on unlock). */
  play(name: string, options?: TransitionOptions): number | null;
  /** Go to a section on the next boundary of the playing one; returns the audio time of the change. */
  to(name: string, options?: TransitionOptions): number | null;
  /** The level of a stem, in every section that has one of that name. */
  layer(stem: string, level: number, fade?: number): Music;
  stop(fade?: number): void;
  update(): void;
  dispose(): void;
}
export function createMusic(engine: AudioEngine, options?: MusicOptions): Music;

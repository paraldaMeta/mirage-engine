import type { ReverbSpec, ReverbPreset } from './audio-dsp.js';

export type EffectType = 'eq' | 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'lowshelf' | 'highshelf' | 'compressor' | 'limiter' | 'delay' | 'reverb' | 'drive' | 'pan' | 'gain';
export const EFFECT_TYPES: EffectType[];
/** type picks the effect; the other keys are its parameters (freq, q, gain in dB, low / mid / high, threshold, ratio,
 *  time, feedback, preset, decay, amount, pan ...). Every effect also takes wet, dry, mix and bypass. */
export interface EffectSpec { type: EffectType; id?: string; wet?: number; dry?: number; mix?: number; bypass?: boolean; preset?: ReverbPreset; [param: string]: unknown }
export interface Effect {
  id: string; type: EffectType; input: AudioNode; output: AudioNode;
  params: Record<string, { value: number; read?: boolean }>;
  /** move parameters over `seconds` (frequencies ramp exponentially) */
  set(values: Record<string, unknown>, seconds?: number): Effect;
  dispose(): void;
}
export interface SendSpec { gain?: number; pre?: boolean }
export interface BusSpec { parent?: string; gain?: number; effects?: EffectSpec[]; sends?: Record<string, number | SendSpec> }
export interface Meter { peak: number; rms: number; peakDb: number; rmsDb: number }
export interface Bus {
  readonly name: string; readonly input: GainNode; readonly output: GainNode; readonly fader: GainNode; readonly post: AudioNode;
  readonly parent: string | null; readonly effects: Effect[]; readonly muted: boolean;
  /** The fader: v over sec seconds; without arguments, the value last asked for. */
  gain(): number; gain(value: number, seconds?: number): Bus;
  mute(on?: boolean): Bus;
  route(to: string): Bus;
  effect(id: string): Effect | null;
  addEffect(spec: EffectSpec, index?: number): Effect;
  removeEffect(id: string): boolean;
  /** A send to another bus (post-fader; pre: before it). */
  send(to: string, gain?: number, options?: { pre?: boolean }): Bus;
  /** Level after the fader over the last ~21 ms. */
  meter(): Meter;
}
/** bus -> { gain, sends: { bus: gain }, effectId: { param: value } } */
export type Snapshot = Record<string, { gain?: number; sends?: Record<string, number>; [effectId: string]: unknown }>;
export interface Duck { target: string; source: string; amount: number; remove(): void }
export interface Ramp { (param: AudioParam, value: number, seconds?: number, exponential?: boolean): void; valueAt(param: AudioParam, time: number): number }
export interface Mixer {
  readonly ctx: BaseAudioContext;
  readonly stats: { buses: number; effects: number; ducks: number; [k: string]: number };
  ramp: Ramp;
  readonly buses: string[]; readonly snapshots: string[]; readonly active: Record<string, number>;
  has(name: string): boolean;
  /** The bus `name`; with a spec it is created (or changed). Throws when it does not exist and no spec is given. */
  bus(name: string, spec?: BusSpec): Bus;
  snapshot(name: string, values: Snapshot): Mixer;
  /** Go to a snapshot, or to a weighted blend of snapshots ('default' is the mixer as set by hand), over `seconds`. */
  transition(target: string | Record<string, number>, seconds?: number): Mixer;
  /** `target` goes down to `amount` (a gain) while `source` is louder than `threshold`; runs in the audio graph. */
  duck(target: string, source: string, options?: { amount?: number; threshold?: number; knee?: number; attack?: number; release?: number }): Duck;
  meter(name: string): Meter;
  dispose(): void;
}
export function createMixer(ctx: BaseAudioContext, options?: { output?: AudioNode }): Mixer;
/** The AudioBuffer of a code-made impulse response (cached by parameters). */
export function reverbBuffer(ctx: BaseAudioContext, params?: ReverbSpec): AudioBuffer;
export function createRamps(ctx: BaseAudioContext): Ramp;

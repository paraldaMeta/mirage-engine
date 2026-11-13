import type * as THREE from 'three';
import type { XYZ } from '@miragekit/world';
export type Surface = 'stone' | 'gravel' | 'grass' | 'wood';
export type AudioBus = 'master' | 'music' | 'sfx' | 'ambience';
export type LoopSound = 'wind' | 'water' | 'pad';
export type Sound = LoopSound | `step_${Surface}` | 'pickup' | 'done' | 'locked' | 'door' | 'ignite';
export type SingleBufferSound = Exclude<Sound, `step_${Surface}`>;
export const SURFACES: Surface[];
export interface AudioOptions { at?: XYZ; bus?: AudioBus; gain?: number; rate?: number; ref?: number }
export type AudioSoundSource = AudioBuffer | AudioBuffer[] | ((context: AudioContext) => AudioBuffer | AudioBuffer[]);
export interface AudioLoop {
  name: SingleBufferSound | (string & {}); src: AudioBufferSourceNode | null;
  /** Called automatically on unlock for queued loops; requires an unlocked context when called manually. */
  start(): void;
}
export interface AudioMixer {
  dispose(): Promise<void>;
  readonly ctx: AudioContext | null; readonly volumes: Record<AudioBus, number>;
  /** The bus gain nodes and generated buffers (null before unlock), and an optional redirect of a bus's input: used by createAudioEngine. */
  readonly buses: Record<AudioBus, GainNode> | null; readonly buffers: Record<string, AudioBuffer | AudioBuffer[]> | null;
  route: ((bus: AudioBus) => AudioNode | null) | null;
  stats: { played: Record<string, number>; skipped: number; state: 'locked' | AudioContextState; genMs: number };
  /** Invoke from a user gesture; may leave ctx null when Web Audio is unavailable. */
  unlock(): void;
  /** Before the gesture: a stand-in maker (AudioBuffers need no context), so sounds can be made while the page loads; unlock() then only opens the device. */
  prepare(sampleRate?: number): AudioMixer;
  /** What makes buffers: the context, or before unlock the stand-in prepare() set; null before either. */
  readonly maker: { sampleRate: number; createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer } | null;
  /**
   * A sound of your own under `name` (replaces a built-in of that name): a buffer, a list of variants (play picks
   * one), or a factory called with the context. Before unlock() the factory waits and runs at unlock; play and loop
   * then find the sound. Returns the mixer.
   */
  add(name: string, sound: AudioSoundSource): AudioMixer;
  suspend(on: boolean): void; volume(bus: AudioBus, value: number): void;
  play(name: string, options?: AudioOptions): AudioBufferSourceNode | null;
  footstep(surface: string, run?: boolean): void;
  /** A built-in loop sound or one given to add() (footsteps are not loops). */
  loop<N extends string>(name: N extends `step_${Surface}` ? never : N, options?: Omit<AudioOptions, 'rate'>): AudioLoop;
  listen(camera: { matrixWorld: THREE.Matrix4 }): void;
}
export function createAudio(options?: { volumes?: Partial<Record<AudioBus, number>> }): AudioMixer;

import type * as THREE from 'three';
import type { XYZ } from '@mirage/world';
export type Surface = 'stone' | 'gravel' | 'grass' | 'wood';
export type AudioBus = 'master' | 'music' | 'sfx' | 'ambience';
export type LoopSound = 'wind' | 'water' | 'pad';
export type Sound = LoopSound | `step_${Surface}` | 'pickup' | 'done' | 'locked' | 'door' | 'ignite';
export type SingleBufferSound = Exclude<Sound, `step_${Surface}`>;
export const SURFACES: Surface[];
export interface AudioOptions { at?: XYZ; bus?: AudioBus; gain?: number; rate?: number; ref?: number }
export interface AudioLoop {
  name: SingleBufferSound; src: AudioBufferSourceNode | null;
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
  suspend(on: boolean): void; volume(bus: AudioBus, value: number): void;
  play(name: string, options?: AudioOptions): AudioBufferSourceNode | null;
  footstep(surface: string, run?: boolean): void;
  loop(name: SingleBufferSound, options?: Omit<AudioOptions, 'rate'>): AudioLoop;
  listen(camera: { matrixWorld: THREE.Matrix4 }): void;
}
export function createAudio(options?: { volumes?: Partial<Record<AudioBus, number>> }): AudioMixer;

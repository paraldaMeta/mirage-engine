import type * as THREE from 'three';
import type { Animator } from './anim.js';
type V3 = THREE.Vector3 | readonly [number, number, number];
export type TimelineEase = 'linear' | 'in' | 'out' | 'inOut' | 'step' | ((u: number) => number);
export interface TimelineKey {
  t: number; position?: V3; rotation?: THREE.Euler | readonly [number, number, number]; quaternion?: THREE.Quaternion | readonly [number, number, number, number];
  scale?: V3; lookAt?: V3;
  /** camera tracks only */
  fov?: number;
  /** how this key is approached from the one before */
  ease?: TimelineEase;
}
export type TimelineTrack =
  | { type: 'transform' | 'camera'; target: THREE.Object3D; keys: readonly TimelineKey[]; curve?: 'linear' | 'smooth' }
  | { type: 'animation'; animator: Animator; clips: readonly { t: number; clip: string; duration?: number; speed?: number; offset?: number; fade?: number }[]; rest?: boolean }
  | { type: 'audio'; cues: readonly ({ t: number } & Record<string, unknown>)[]; play?: (cue: any, offset: number) => void; stop?: () => void }
  | { type: 'event'; keys: readonly ({ t: number; name: string } & Record<string, unknown>)[] };
export interface TimelineEvent { name: string; time: number; [key: string]: unknown }
export interface Timeline {
  duration: number; loop: boolean; speed: number; readonly time: number; readonly playing: boolean;
  play(from?: number): Timeline; pause(): Timeline;
  /** pause, and call every audio track's stop() */
  stop(): Timeline;
  /** Show time t: the picture depends on t alone. Events and cues are skipped unless fire (forwards only). */
  seek(t: number, options?: { fire?: boolean }): Timeline;
  /** Advance while playing; true when the picture changed. */
  update(dt: number): boolean;
  /** an event key's name, 'audio', 'end', or '*' for all */
  on(name: string, listener: (event: TimelineEvent) => void): () => void;
}
export function createTimeline(options?: { tracks?: readonly TimelineTrack[]; duration?: number | null; loop?: boolean; speed?: number }): Timeline;

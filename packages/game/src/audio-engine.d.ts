import type { AudioMixer } from './audio.js';
import type { Mixer, Bus, BusSpec, Snapshot, Meter } from './audio-mixer.js';
import type { DistanceModel, RolloffCurve, ReverbSpec } from './audio-dsp.js';

export type Vec3 = [number, number, number] | ArrayLike<number>;
/** A fixed point, an object with a world matrix, or a function called each update. */
export type Place = Vec3 | { matrixWorld: { elements: ArrayLike<number> } } | (() => Vec3);
/** A three.js camera (matrixWorld) or plain vectors. */
export type Ears = { matrixWorld: { elements: ArrayLike<number> } } | { pos: Vec3; forward?: Vec3; up?: Vec3 };
export type PanningModel = 'HRTF' | 'equalpower';

export interface ZoneSpec {
  name?: string;
  /** [x0, y0, z0, x1, y1, z1] */ box?: number[];
  /** [x, y, z, radius] */ sphere?: number[];
  shape?: 'box' | 'sphere'; min?: number[]; max?: number[]; center?: number[]; size?: number | number[]; radius?: number;
  /** metres outside the shape over which the zone fades out (2) */ fade?: number;
  reverb?: ReverbSpec; wet?: number; priority?: number;
  /** a mixer snapshot blended in by the zone's weight */ snapshot?: string;
}
export interface Zone { name: string; box: number[] | null; sphere: number[] | null; fade: number; reverb: ReverbSpec; wet: number; priority: number; snapshot: string | null }
/** ambient: the reverb heard outside every zone; bus: the bus the zone reverbs return to ('reverb') */
export interface ZoneOptions { ambient?: { reverb?: ReverbSpec; wet?: number } | null; bus?: string }
export function normalizeZones(list?: ZoneSpec[]): Zone[];
/** The zones of a world plan: plan.audio.zones. */
export function zonesFromPlan(plan: { audio?: { zones?: ZoneSpec[] } } | null | undefined): Zone[];
/** Weight of each zone for a listener at pos; the last entry (out[zones.length]) is what is left for the ambient reverb. */
export function zoneWeights(zones: Zone[], pos: ArrayLike<number>, out?: number[]): number[];

export interface OcclusionOptions {
  /** 0 (clear) .. 1 (shut) between two points: gridOccluder, physicsOccluder, sceneOccluder or your own. */
  test: (from: number[], to: number[]) => number;
  rays?: number; radius?: number; interval?: number;
  /** rays per update, over all voices (8) */ budget?: number;
  gain?: number; freq?: number; open?: number; wet?: number; smooth?: number; max?: number;
}
export interface PlayOptions {
  at?: Place; bus?: string; gain?: number; rate?: number; loop?: boolean; priority?: number;
  model?: DistanceModel; ref?: number; max?: number; rolloff?: number; curve?: RolloffCurve;
  panning?: PanningModel;
  /** cone: the direction the source points, full angles in degrees, and the gain outside the outer cone */
  dir?: Vec3; inner?: number; outer?: number; outerGain?: number;
  /** 0 (a point) .. 1 (all around); blend: 0 (2D) .. 1 (3D) */ spread?: number; blend?: number;
  doppler?: number; occlude?: boolean; reverb?: number;
  delay?: number; offset?: number; fadeIn?: number;
  /** when it is inaudible or over the cap: 'resume' (default: keep time, come back where it would be), 'restart', 'stop' (end it) */
  virtual?: 'resume' | 'restart' | 'stop';
  onEnd?: (voice: Voice) => void;
}
export interface Voice {
  readonly id: number; readonly name: string; readonly bus: string; priority: number;
  /** sounding now (false: virtual, keeping time) */ readonly real: boolean;
  /** seconds into the sound */ readonly time: number;
  readonly audibility: number; readonly dist: number; readonly att: number;
  /** occlusion 0..1 as last traced */ readonly occ: number;
  /** the variant index, for a cue */ readonly variant?: number;
  set(values: { gain?: number; rate?: number; at?: Place; dir?: Vec3; priority?: number }, seconds?: number): Voice;
  stop(fadeSeconds?: number): void;
}
export interface CueSpec extends PlayOptions {
  sounds: (string | { sound: string; weight?: number; gain?: number; rate?: number })[];
  mode?: 'random' | 'shuffle' | 'sequence';
  /** a value or a [min, max] range; pitch in semitones */
  gain?: any; rate?: any; pitch?: number | [number, number];
  cooldown?: number; instances?: number; steal?: boolean; delay?: any;
  /** a cue to play after this one, `delay` seconds later */ then?: string;
}
export interface Stream {
  readonly name: string; readonly el: HTMLAudioElement; node: MediaElementAudioSourceNode | null;
  state: 'loading' | 'playing' | 'paused' | 'blocked' | 'ended' | 'error' | 'stopped'; error: unknown; gain: number;
  readonly time: number; readonly duration: number; readonly paused: boolean;
  play(): Stream; pause(): Stream; seek(seconds: number): Stream; fade(to: number, seconds?: number): Stream; stop(fadeSeconds?: number): void;
}
export interface AudioEngineStats {
  state: 'locked' | AudioContextState; time: number;
  voices: number; virtual: number; total: number; peak: number; hrtf: number; streams: number;
  started: number; ended: number; stolen: number; culled: number; resumed: number; dropped: number; skipped: number; cooled: number;
  rays: number; raysTotal: number; zones: Record<string, number>;
  assets: { count: number; bytes: number; decodeMs: number };
}
export interface AudioEngineOptions {
  /** The legacy mixer (createAudio): share its context, buses, volumes and sounds. */
  audio?: AudioMixer | null;
  /** A context to use (an OfflineAudioContext in checks); otherwise one is made on unlock(). */
  context?: BaseAudioContext | null;
  /** sounding voices at most (32); of those, HRTF voices at most (8) */ voices?: number; hrtfVoices?: number;
  panning?: PanningModel; doppler?: number; speedOfSound?: number; silent?: number; seed?: string;
  buses?: Record<string, BusSpec>; snapshots?: Record<string, Snapshot>;
  ducks?: { target: string; source: string; amount?: number; threshold?: number; attack?: number; release?: number }[];
  zones?: ZoneSpec[]; zoneOptions?: ZoneOptions; occlusion?: OcclusionOptions; cues?: Record<string, CueSpec>;
}
export interface AudioEngine {
  readonly stats: AudioEngineStats; readonly ctx: BaseAudioContext | null; readonly mixer: Mixer; readonly time: number; readonly ready: boolean;
  readonly voices: Voice[]; cap: number; readonly panning: PanningModel; readonly listenerPosition: number[];
  /** the engine's seeded generator: 0 <= x < 1 */ readonly rng: () => number;
  /** things updated with the engine (music, the debug overlay): { update(dt), dispose() } */
  readonly systems: Set<{ update?(dt: number): void; dispose?(): void }>;
  /** Make (or adopt) the context; call from a user gesture. */
  unlock(): void;
  whenReady(fn: () => void): void;
  /** Fetch and decode once; every call takes a reference. Reads data: and blob: URLs and file:// without fetch. */
  load(url: string, options?: { name?: string; group?: string }): Promise<AudioBuffer>;
  /** A buffer made in code: an AudioBuffer, a Float32Array (mono), or { channels, sampleRate }. */
  add(name: string, data: AudioBuffer | Float32Array | { channels: Float32Array[]; sampleRate?: number }): AudioBuffer;
  /** Give one reference back; returns those left (0: gone from the cache). */
  release(name: string): number;
  preload(group: string, items: Record<string, string> | (string | { name: string; url: string })[], progress?: (done: number, total: number, name: string) => void): Promise<AudioBuffer[]>;
  unload(group: string): void;
  buffer(name: string): AudioBuffer | null;
  has(name: string): boolean;
  /** Long music through a media element: not decoded into memory, not spatial. */
  stream(url: string, options?: { bus?: string; gain?: number; loop?: boolean; autoplay?: boolean; fadeIn?: number; name?: string }): Stream;
  /** A loaded sound, a cue, or one of the legacy mixer's sounds. null when dropped (cooldown, over the cap with virtual: 'stop', unknown name). */
  play(sound: string | AudioBuffer, options?: PlayOptions): Voice | null;
  cue(name: string, spec: CueSpec): unknown;
  zones(list: ZoneSpec[], options?: ZoneOptions): Zone[];
  occlusion(options: OcclusionOptions | null): OcclusionOptions | null;
  listener(ears: Ears, dt?: number): void;
  /** Once per frame: listener, voices, zones, occlusion, music. */
  update(dt?: number, ears?: Ears): void;
  bus(name: string, spec?: BusSpec): Bus | null;
  setPanning(model: PanningModel): void;
  stopAll(fadeSeconds?: number): void;
  meters(): Record<string, Meter>;
  dispose(): void;
}
export function createAudioEngine(options?: AudioEngineOptions): AudioEngine;

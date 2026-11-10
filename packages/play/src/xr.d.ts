import type * as THREE from 'three';
import type { Play } from './play.js';
import type { WalkerLike } from './walker.js';
import type { XYZ } from '@mirage/world';
import type { WorldRenderer } from '@mirage/core';

export interface XRSupport { vr: boolean; ar: boolean }
/** Which immersive sessions this browser offers (both false without WebXR). Await it before creating the world. */
export function xrSupport(navigator?: Navigator): Promise<XRSupport>;
/** The XR grade's uniforms (shared by every program): exposure x white balance + bloom gain, veil + saturation, contrast + lift. */
export const XR_GRADE: Float32Array;
/** The bloom stand-in: GAIN x the pixel + VEIL x the haze colour at VEIL_SAT of its saturation, times the bloom's weight. */
export const XR_FIT: { GAIN: number; VEIL: number; VEIL_SAT: number };
/** Fill XR_GRADE (or `out`) from a world's post settings, its light and the measured mean radiance (rgb) of the view. */
export function setGrade(world: WorldRenderer, options?: { mean?: readonly [number, number, number] | null; out?: Float32Array }): Float32Array;

/** The parts of a started game (@mirage/game startGame's result) the XR mode uses: interact, prompts, messages. */
export interface XRGameLike {
  readonly near: { id: string } | null;
  game: { label(entity: any): string; where(entity: any): readonly [number, number, number] };
  input?: { tap(action: string): void };
  ui?: { readonly started: boolean; readonly open: HTMLDialogElement | undefined; root: HTMLElement; begin(): void } | null;
}
export type XRMode = 'immersive-vr' | 'immersive-ar';
export interface XROptions {
  /** A started game: the trigger interacts (or closes its message), prompts and messages show in the world. */
  game?: XRGameLike;
  /** "Enter VR" / "Enter AR" buttons (shown only when supported); an element to put them in, or false for none. */
  button?: boolean | HTMLElement;
  /** Offer immersive-ar (the world as a table model) when supported. Default true. */
  ar?: boolean;
  /** A known xrSupport() result (skips asking again). */
  support?: XRSupport;
  /** Teleport arc on the right stick (forward). Default true. */
  teleport?: boolean;
  /** Highest climb (m) a teleport may land on. Default 1.2. */
  teleportMaxUp?: number;
  /** Snap turn angle in degrees; 0 = smooth turning at turnSpeed. Default 30. */
  snapTurn?: number;
  /** Smooth turning speed (rad/s). Default 2.5. */
  turnSpeed?: number;
  /** Comfort vignette while moving. Default true. */
  vignette?: boolean;
  /** XR framebuffer scale (1 = the headset's recommended size). Default by quality: high 1, medium 0.9, low 0.75. */
  framebufferScale?: number;
  /** Fixed foveation 0..1. Default 1. */
  foveation?: number;
  /** Target frame rate (e.g. 72, 90, 120) where the headset allows it. */
  frameRate?: number;
  /** Default 'local-floor'. */
  referenceSpace?: XRReferenceSpaceType;
  /** AR: the world's largest side in metres on the table. Default 0.9. */
  arSize?: number;
  /** The bloom stand-in measures the view (a 32 x 32 HDR render twice a second, read back asynchronously). Default true. */
  meter?: boolean;
  /** Shadow region radius around the view (m). Default 22. */
  shadowRadius?: number;
  /** Called on a controller's select (trigger) in VR. */
  onSelect?: (handedness: string) => void;
  /** An in-world prompt for pages without a game (shown in front of the view; null hides it). */
  prompt?: () => string | null;
}
export interface XRState {
  presenting: boolean; mode: 'vr' | 'ar' | null; rigYaw: number; rig: [number, number, number]; scale: number;
  head: [number, number, number]; yaw: number; walker: [number, number, number]; onGround: boolean; blocked: boolean;
  teleport: { aiming: boolean; valid: boolean; target: [number, number, number] | null };
  prompt: string | null; panel: string | null; near: string | null; vignette: number;
  ar: { placed: boolean; scale: number; hit: boolean; hitTest: boolean }; frames: number; size: [number, number];
  /** The meter's mean radiance of the view (linear rgb), null before the first reading. */
  meter: [number, number, number] | null;
}
export interface XRTraceRecord { dt: number; x: number; z: number; run: boolean; from: [number, number, number]; pos: [number, number, number]; blocked: boolean; onGround: boolean; yaw: number }
export interface MirageXR {
  rig: THREE.Group; camera: THREE.PerspectiveCamera; root: THREE.Group;
  buttons: Partial<Record<XRMode, HTMLButtonElement>>;
  stats: { frames: number; ms: number; sessions: number };
  /** The bloom stand-in's constants (XR_FIT, shared by every session on the page). */
  fit: { GAIN: number; VEIL: number; VEIL_SAT: number };
  support: Promise<XRSupport>;
  /** Start a session; call from a user gesture (a click). */
  enter(mode?: XRMode): Promise<XRSession>;
  exit(): Promise<void>;
  /** Ends a session, removes the buttons, frees what it made. */
  dispose(): Promise<void>;
  readonly session: XRSession | null; readonly presenting: boolean; readonly mode: 'vr' | 'ar' | null;
  readonly near: { id: string } | null;
  /** Put the walker at `eye` and turn the rig so the headset faces `look`. */
  place(eye: XYZ, look: XYZ): void;
  /** Tests: an array receives one record per VR frame. */
  trace: XRTraceRecord[] | null;
  state(): XRState;
}
export function createXR<W extends WalkerLike>(play: Play<W>, options?: XROptions): MirageXR;

import type * as THREE from 'three';
import type { Play } from './play.js';
import type { WalkerLike } from './walker.js';
import type { XYZ } from '@miragekit/world';
import type { WorldRenderer } from '@miragekit/core';
import type { XRPost, XRPostOptions } from './xr-post.js';
import type { XRProfile, XRProfileId, XRLevel, XRGovernorOptions } from './xr-quality.js';
import type { XRInteraction, XRInteractionState } from './xr-interact.js';
import type { XRAR, XRAROptions, XRARAnchor, XRARState } from './xr-ar.js';

export interface XRSupport { vr: boolean; ar: boolean }
/** Which immersive sessions this browser offers (both false without WebXR). Await it before creating the world. */
export function xrSupport(navigator?: Navigator): Promise<XRSupport>;
/** The XR grade's uniforms (shared by every program): exposure x white balance + bloom gain, veil + saturation, contrast + lift. */
export const XR_GRADE: Float32Array;
/** The bloom stand-in: GAIN x the pixel + VEIL x the haze colour at VEIL_SAT of its saturation, times the bloom's weight. */
export const XR_FIT: { GAIN: number; VEIL: number; VEIL_SAT: number };
/** Fill XR_GRADE (or `out`) from a world's post settings, its light and the measured mean radiance (rgb) of the view. */
export function setGrade(world: WorldRenderer, options?: { mean?: readonly [number, number, number] | null; out?: Float32Array }): Float32Array;

/** The parts of a started game (@miragekit/game startGame's result) the XR mode uses: interact, prompts, messages. */
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
  /** Called on a controller's select (trigger) or a tracked hand's pinch in VR. */
  onSelect?: (handedness: string) => void;
  /** An in-world prompt for pages without a game (shown in front of the view; null hides it). */
  prompt?: () => string | null;
  /** Where navigator.xr.offerSession exists (Quest Browser, native WebXR hosts), offer this session so the platform
   *  can start it without a DOM button; offered again after each session. true = 'immersive-vr'. Default true
   *  (nothing happens where offerSession is missing: desktop browsers). */
  offer?: boolean | XRMode;
  /** Start a session as soon as support is known: through offerSession where it exists (a host with
   *  xr.autoEnter grants it at once), else requestSession (a browser may refuse it without a user gesture; the
   *  buttons stay). true = 'immersive-vr'. Default false. */
  autoEnter?: boolean | XRMode;
  /** Hand tracking: pinch is the trigger, point with the index to aim the teleport, pinch to go; the ray comes from
   *  the index finger. Asks for the 'hand-tracking' feature. Default true (inert without tracked hands). */
  hands?: boolean;
  /** Thresholds of the hand gestures (packages/play/src/xr-hands.js HAND_GESTURE). */
  handGesture?: Partial<{ pinchOn: number; pinchOff: number; pointHold: number; armWindow: number; straight: number; reach: number; curl: number; grabOn: number; grabOff: number }>;
  /** How labels draw text: 'canvas' (Canvas 2D), 'glyphs' (the built-in glyph font into a DataTexture, no canvas or
   *  document needed), or 'auto' (glyphs where Canvas 2D draws no text, e.g. a native host). Default 'auto'. */
  text?: 'auto' | 'canvas' | 'glyphs';
  /** VR: the engine's post chain per eye (HDR + MSAA scene, AO, bloom, exposure, tone map, grade, LUT) in place of
   *  the one-pass direct path. Default off (with `profile`: the device's default). */
  post?: boolean | XRPostOptions;
  /** A frame-time governor that steps quality down (resolution, AO, bloom, then the direct path) before frames are
   *  dropped, and back up when there is room. Default off. */
  budget?: boolean | XRGovernorOptions;
  /** Device defaults for framebufferScale, foveation, frameRate and post: 'auto' (from the user agent) or a name.
   *  What is set explicitly wins. None of the profiles was tested on hardware. */
  profile?: 'auto' | XRProfileId;
  /** 'room' (default: the real head height), 'standing' or 'seated' (the eyes go to the character's eye height;
   *  seated also ignores walking about the room). */
  posture?: 'room' | 'standing' | 'seated';
  /** Eye height (m) the calibration aims for. Default the walker body's. */
  eyeHeight?: number;
  /** Show the play area's boundary (bounded-floor) within boundsWarn (0.5 m) of its edge, or 'always'. */
  bounds?: boolean | 'always'; boundsWarn?: number;
  /** Grab, throw, two-handed hold, snap zones, poke and UI panels: createXR feeds it controllers and hands. */
  interact?: XRInteraction;
  /** AR beyond the hit test: anchors, plane detection, light estimation, DOM overlay, a shadows-only ground. */
  arFeatures?: boolean | XRAROptions;
}
export interface XRState {
  presenting: boolean; mode: 'vr' | 'ar' | null; rigYaw: number; rig: [number, number, number]; scale: number;
  head: [number, number, number]; yaw: number; walker: [number, number, number]; onGround: boolean; blocked: boolean;
  teleport: { aiming: boolean; valid: boolean; target: [number, number, number] | null; by: 'stick' | 'hand' | null };
  prompt: string | null; panel: string | null; near: string | null; vignette: number;
  /** How the labels draw text. */
  text: 'canvas' | 'glyphs';
  /** Per input slot: a tracked hand (not a controller) and its gesture state. */
  hands: { handedness: string; hand: boolean; tracked: boolean; pinching: boolean; pointing: boolean; aiming: boolean; grabbing: boolean }[];
  ar: { placed: boolean; scale: number; hit: boolean; hitTest: boolean }; frames: number; size: [number, number];
  /** The meter's mean radiance of the view (linear rgb), null before the first reading. */
  meter: [number, number, number] | null;
  /** The per-eye post chain while presenting with `post` (on: it is drawing), else null. */
  post: { on: boolean; width: number; height: number; scale: number; resizes: number; eyes: number } | null;
  quality: { level: number; scale: number };
  /** Height calibration: the rig's lift (m) and the posture. */
  lift: number; posture: 'room' | 'standing' | 'seated';
  bounds: { points: number; distance: number; shown: boolean } | null;
  arx: XRARState | null; interact: XRInteractionState | null; profile: XRProfileId | null;
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
  /** How the in-headset labels draw text. */
  readonly text: 'canvas' | 'glyphs';
  /** A navigator.xr.offerSession is pending (the platform may start the session); offers made so far. */
  readonly offered: boolean; readonly offers: number;
  /** Tests: the prompt and panel sprites (world space). */
  labels: { prompt: THREE.Sprite; panel: THREE.Sprite };
  /** The opt-in parts: the per-eye post chain (null until a VR session with `post`), the interaction, the AR features, the device profile. */
  readonly post: XRPost | null; interact: XRInteraction | null; ar: XRAR | null; profile: (XRProfile & { id: XRProfileId }) | null;
  /** Quality now; `governor` is null without `budget`. */
  readonly quality: { level: number; scale: number; post: boolean; governor: { ema: number; late: number; steps: number; reason: string } | null };
  /** Force a level of the governor's ladder (with `budget` it moves on from there). */
  setLevel(index: number): XRLevel;
  /** Standing / seated: measure the head again; returns the rig's lift (m). */
  calibrateHeight(): number;
  /** AR: an anchor at the current hit test; rejects without anchors or a hit. */
  anchor(): Promise<XRARAnchor>;
  state(): XRState;
}
export function createXR<W extends WalkerLike>(play: Play<W>, options?: XROptions): MirageXR;

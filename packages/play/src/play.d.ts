import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldRenderer, Quality, ConvergeResult } from '@miragekit/core';
import type { ReducedMotionSettings } from '@miragekit/core/world';
import type { PlanInput, ViewMode, Viewpoint, XYZ } from '@miragekit/world';
import type { GridWalker, WalkerLike, MotionInput } from './walker.js';
import type { WalkGrid } from './walkgrid.js';
import type { Character, CharacterAppearance } from './character.js';
export interface SimulationDriver {
  viewPosition: [number, number, number]; advance(dt: number, motion: MotionInput | null): boolean;
}
/** createPlay reads viewpoints directly; use definePlan() to supply its default empty array. */
export type PlayPlan = PlanInput & { viewpoints: readonly Viewpoint[] };
export interface PlayOptions<W extends WalkerLike = GridWalker> {
  plan: PlayPlan; canvas?: HTMLCanvasElement; spp?: number; refine?: readonly [number, number]; animate?: boolean;
  grid?: WalkGrid; walker?: W; mode?: ViewMode; viewSize?: number; fov?: number; appearance?: CharacterAppearance;
  /** Opt-in: build the player figure yourself (createRigCharacter for an imported rigged model). Default: the procedural traveller. */
  character?: (world: WorldRenderer) => Character;
  ui?: boolean; devKeys?: boolean; pointerLock?: boolean; touch?: boolean; shadowRadius?: number;
  input?: (dt: number) => MotionInput; simulation?: SimulationDriver; onStep?: (dt: number) => boolean | void;
  fit?: boolean; idle?: number; maxFps?: number; hud?: boolean; quality?: Quality;
  onPowerSaver?: (on: boolean) => void; onVisibility?: (shown: boolean) => void;
  /** called at the end of place() / viewpoint(): restart scene clocks of your own (startGame emits game "place") */
  onPlace?: (eye: XYZ, look: XYZ, mode: ViewMode) => void;
  /** The HUD's quality menu. The choice is saved either way; default: reload the page to apply it. */
  onQuality?: (quality: Quality) => void;
  /** 'auto' (default): follow prefers-reduced-motion (live); true / false / { sway, rain } override it. On: the world's
   *  wind sway and rain slow down, still frames get no motion blur (world.setReducedMotion), the eye eases over steps
   *  and jumps. Without the system setting, 'auto' changes nothing. */
  reducedMotion?: ReducedMotionOption;
}
export type ReducedMotionOption = 'auto' | boolean | Partial<ReducedMotionSettings>;
export interface Play<W extends WalkerLike = GridWalker> {
  world: WorldRenderer; grid: WalkGrid; walker: W; keys: Set<string>; figure: THREE.Group; avatar: Character;
  gameCam: THREE.OrthographicCamera; controls: OrbitControls;
  stats: { frames: number; moving: number; refined: number; lastMs: number; draws: number };
  render(options?: { moving?: boolean; spp?: number; frameIndex?: number; target?: THREE.WebGLRenderTarget | null; converge?: boolean | number }): ConvergeResult | void;
  /** A still of the current view with a transparent sky (world.renderTransparent); nothing is drawn to the canvas. */
  render(options: { transparent: true; spp?: number; frameIndex?: number }): import('@miragekit/core/world').TransparentStill;
  place(eye: XYZ, look: XYZ, mode?: ViewMode): void;
  viewpoint(index: number): void; setMode(mode: ViewMode): void;
  turn(dx: number, dy: number, scale: number): void; syncWalkerView(): void; lookAt(position: XYZ): void;
  yaw: number; pitch: number; viewSize: number; powerSaver: boolean;
  /** Merged into each step's input (WebXR controllers, @miragekit/play/xr); null for none. */
  xrInput: ((input: MotionInput, dt: number) => MotionInput) | null;
  readonly mode: ViewMode; readonly still: number; readonly clock: number; readonly refine: [number, number];
  readonly maxFps: number; readonly idleFor: number;
  state(): { mode: ViewMode; pos: [number, number, number]; eye: [number, number, number]; onGround: boolean; blocked: boolean; yaw: number; still: number };
  step(dt: number): void;
  /** Terminal, idempotent cleanup. The caller owns the world and any injected walker or simulation. */
  dispose(): void;
  /** Pauses automatic frames. start() resumes and step() still works. */
  stop(): void;
  start(): void; wake(): void;
  /** false after stop() */
  readonly running: boolean;
  /** Reads true while reduced motion is on; set 'auto', true, false or { sway, rain }. */
  get reducedMotion(): boolean;
  set reducedMotion(option: ReducedMotionOption);
}
/** Creates DOM controls and immediately starts the animation loop. */
// Two signatures: with a walker of its own the play keeps that walker's type; without one it is the grid walker.
// (A single generic with a default fell back to GridWalker even when a walker was passed: TypeScript took the
// default before inferring from the walker object.)
export function createPlay<W extends WalkerLike>(world: WorldRenderer, options: Omit<PlayOptions, 'walker'> & { walker: W }): Play<W>;
export function createPlay(world: WorldRenderer, options: PlayOptions): Play<GridWalker>;
/** true when a key event comes from a text field, select or editable element. */
export function typing(e: Event): boolean;
export function frameGate(fps: () => number): (nowMilliseconds: number) => boolean;

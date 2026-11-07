import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldRenderer, Quality } from '@mirage/core';
import type { PlanInput, ViewMode, Viewpoint, XYZ } from '@mirage/world';
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
  ui?: boolean; devKeys?: boolean; pointerLock?: boolean; touch?: boolean; shadowRadius?: number;
  input?: (dt: number) => MotionInput; simulation?: SimulationDriver; onStep?: (dt: number) => boolean | void;
  fit?: boolean; idle?: number; maxFps?: number; hud?: boolean; quality?: Quality;
  onPowerSaver?: (on: boolean) => void; onVisibility?: (shown: boolean) => void;
}
export interface Play<W extends WalkerLike = GridWalker> {
  world: WorldRenderer; grid: WalkGrid; walker: W; keys: Set<string>; figure: THREE.Group; avatar: Character;
  gameCam: THREE.OrthographicCamera; controls: OrbitControls;
  stats: { frames: number; moving: number; refined: number; lastMs: number; draws: number };
  render(options?: { moving?: boolean; spp?: number; frameIndex?: number; target?: THREE.WebGLRenderTarget | null }): void;
  place(eye: XYZ, look: XYZ, mode?: ViewMode): void;
  viewpoint(index: number): void; setMode(mode: ViewMode): void;
  turn(dx: number, dy: number, scale: number): void; syncWalkerView(): void; lookAt(position: XYZ): void;
  yaw: number; pitch: number; viewSize: number; powerSaver: boolean;
  readonly mode: ViewMode; readonly still: number; readonly clock: number; readonly refine: [number, number];
  readonly maxFps: number; readonly idleFor: number;
  state(): { mode: ViewMode; pos: [number, number, number]; eye: [number, number, number]; onGround: boolean; blocked: boolean; yaw: number; still: number };
  step(dt: number): void;
  /** Terminal, idempotent cleanup. The caller owns the world and any injected walker or simulation. */
  dispose(): void;
  /** Pauses automatic frames. start() resumes and step() still works. */
  stop(): void;
  start(): void; wake(): void;
}
/** Creates DOM controls and immediately starts the animation loop. */
export function createPlay<W extends WalkerLike = GridWalker>(world: WorldRenderer, options: PlayOptions<W>): Play<W>;
export function frameGate(fps: () => number): (nowMilliseconds: number) => boolean;

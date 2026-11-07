import type * as THREE from 'three';
import type { WorldRenderer } from '@mirage/core';
import type { BuildResult, PlanInput, DefinedPlan, Viewpoint, AnchorTable } from '@mirage/world';
import type { Play, PlayOptions } from '@mirage/play/play';
import type { Game, Migrations, ExtendedSnapshot, LoadedSave, InteractableEntity } from './game.js';
import type { Physics, PhysicsCharacter } from './physics.js';
import type { Input } from './input.js';
import type { AudioMixer } from './audio.js';
import type { GameUI, GameMessages } from './ui.js';
export interface GameSetup<P extends PlanInput = PlanInput> {
  /** Register synchronous cleanup for resources owned by setup, including on startup failure. */
  onDispose(cleanup: () => void): void;
  game: Game; physics: Physics; audio: AudioMixer; input: Input; root: THREE.Group;
  plan: DefinedPlan<P> & { spawn: Viewpoint }; anchors: AnchorTable; world: WorldRenderer;
}
export type StartGameOptions<P extends PlanInput> = Pick<PlayOptions<PhysicsCharacter>, 'canvas' | 'spp' | 'shadowRadius' | 'grid' | 'fit' | 'quality' | 'hud' | 'idle' | 'appearance'> & {
  /** Unlike createPlay, startGame requires an explicit spawn. */
  built: BuildResult<P> & { plan: { spawn: Viewpoint } };
  id?: string; version?: number; migrate?: Migrations;
  setup?: (context: GameSetup<P>) => void | Promise<void>;
  objective?: (game: Game) => readonly [string, string]; summary?: (game: Game) => string;
  ui?: boolean; title?: string; subtitle?: string;
};
export type PlayerSnapshot = ExtendedSnapshot<{ player: { pos: [number, number, number]; yaw: number; pitch: number }; summary: string }>;
export interface GameSession {
  dispose(): Promise<void>;
  game: Game & { ui: GameMessages }; physics: Physics; input: Input; audio: AudioMixer;
  ui: GameUI | null; play: Play<PhysicsCharacter>; character: PhysicsCharacter; root: THREE.Group;
  save(slot?: number): PlayerSnapshot;
  save(slot: 'export'): string;
  save(slot: number | string): PlayerSnapshot | string;
  /** Numbers select local slots; every string is JSON text. Throws on an empty slot. Synchronous. */
  load(slotOrJSON?: number | string): LoadedSave;
  stats: { setupMs: number; colliders: number; triangles: number; collidersMs: number };
  readonly near: InteractableEntity | null;
}
/** Builds physics and controls, then starts play. Await session.dispose() before reusing the world. */
export function startGame<P extends PlanInput>(world: WorldRenderer, options: StartGameOptions<P>): Promise<GameSession>;

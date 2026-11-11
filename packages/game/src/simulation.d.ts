import type { WalkerLike } from '@miragekit/play/walker';
import type { SimulationDriver } from '@miragekit/play/play';
import type { Game } from './game.js';
import type { Physics } from './physics.js';
export interface Simulation extends SimulationDriver {
  dispose(): void;
  /** Clears accumulated time/jump input and snaps both interpolation endpoints to the character. */
  reset(): void;
}
/** Advances character, physics and game on one 60 Hz clock. dispose() releases its pause subscription. */
export function createSimulation(physics: Pick<Physics, 'step'>, character: Pick<WalkerLike, 'pos' | 'update'>,
  game: Pick<Game, 'paused' | 'player' | 'tick' | 'on'>): Simulation;

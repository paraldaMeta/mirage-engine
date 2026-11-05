import type { WalkerLike } from '@mirage/play/walker';
import type { SimulationDriver } from '@mirage/play/play';
import type { Game } from './game.js';
import type { Physics } from './physics.js';
export interface Simulation extends SimulationDriver {
  /** Clears accumulated time/jump input and snaps both interpolation endpoints to the character. */
  reset(): void;
}
/** Advances character, physics and game on one 60 Hz clock. Subscribes to pause; no unsubscribe handle is returned. */
export function createSimulation(physics: Pick<Physics, 'step'>, character: Pick<WalkerLike, 'pos' | 'update'>,
  game: Pick<Game, 'paused' | 'player' | 'tick' | 'on'>): Simulation;

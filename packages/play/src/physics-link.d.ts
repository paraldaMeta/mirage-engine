import type { Solid, SolidSpace } from './solids.js';
import type { Mover } from './mover.js';

export interface SolidLink {
  bodies: Map<number, { body: any; [key: string]: any }>;
  /** the Rapier rigid body of a solid */
  body(solid: Solid): any;
  /** the character as a kinematic capsule, so dynamic bodies stop at it */
  addMover(mover: Mover): any;
  /** before world.step: kinematic poses and queued pushes go to Rapier */
  pre(): void;
  /** after world.step: dynamic poses come back to the solids */
  post(): void;
  dispose(): void;
}
/** `physics`: @miragekit/game's createPhysics result, or any { R, world } (Rapier and its world) */
export function linkSolids(space: SolidSpace, physics: { R: any; world: any }): SolidLink;

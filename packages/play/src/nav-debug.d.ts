import type * as THREE from 'three';
import type { NavGrid, NavPoint } from './navgrid.js';
import type { Crowd } from './crowd.js';
import type { BehaviorTree } from './ai.js';

export interface NavDebug {
  group: THREE.Group;
  /** nav.version when grid() last ran */
  gridVersion: number;
  /** the cells a body of `radius` fits, coloured by area, carved cells red; returns the quad count */
  grid(options?: { region?: [number, number, number, number] }): number;
  links(): number;
  paths(list: (NavPoint[] | null)[], color?: [number, number, number]): void;
  /** per agent: a ring, its velocity (white) and its next waypoint (yellow) */
  crowd(crowd: Crowd): void;
  tree(brain: BehaviorTree, element?: { textContent: string | null }): string;
  clear(name: 'grid' | 'links' | 'paths' | 'crowd'): void;
  dispose(): void;
}
export function createNavDebug(nav: NavGrid, options?: { radius?: number; lift?: number }): NavDebug;

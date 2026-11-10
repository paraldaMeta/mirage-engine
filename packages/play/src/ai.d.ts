import type { WalkGrid } from './walkgrid.js';
import type { NavGrid, NavAgent, NavPoint } from './navgrid.js';
import type { Actor } from './crowd.js';

export type BTStatus = 'success' | 'failure' | 'running';
export const SUCCESS: 'success';
export const FAILURE: 'failure';
export const RUNNING: 'running';
export interface Blackboard {
  time: number; data: Map<string, any>;
  get<T = any>(key: string, fallback?: T): T;
  has(key: string): boolean;
  set<T>(key: string, value: T): T;
  delete(key: string): boolean;
  /** seconds since the key was written (Infinity: never) */
  age(key: string): number;
  onChange(fn: (key: string, value: any, old: any) => void): () => void;
  toJSON(): Record<string, any>;
}
export interface BTContext { bb: Blackboard; actor: Actor | null; nav: NavGrid | null; senses: Senses | null; time: number; dt: number; [key: string]: any }
export interface BTNode {
  type: string; name: string; children: BTNode[]; status: BTStatus | null;
  tick(ctx: BTContext, dt: number): BTStatus;
  reset(ctx: BTContext): void;
}
export const bt: {
  /** children in order, remembering the running one; fails with the first that fails */
  sequence(...children: BTNode[]): BTNode;
  /** the first child that does not fail, asked again from the first every tick (a higher branch interrupts) */
  selector(...children: BTNode[]): BTNode;
  /** all children every tick; success when `need` (default all) succeeded */
  parallel(need: number | BTNode, ...children: BTNode[]): BTNode;
  invert(child: BTNode): BTNode;
  succeed(child: BTNode): BTNode;
  repeat(child: BTNode, times?: number): BTNode;
  cooldown(seconds: number, child: BTNode): BTNode;
  timeout(seconds: number, child: BTNode): BTNode;
  wait(seconds: number): BTNode;
  condition(name: string, test: (ctx: BTContext) => unknown): BTNode;
  /** fn returns a status (nothing: success); onAbort runs when a running action is interrupted */
  action(name: string, fn: (ctx: BTContext, dt: number, node: BTNode) => BTStatus | void, onAbort?: (ctx: BTContext) => void): BTNode;
};
export function createBlackboard(init?: Record<string, any>): Blackboard;
export interface Noise { pos: NavPoint; radius: number; tag: string; source: any; time: number }
export interface SightOptions { range?: number; fov?: number; near?: number; eye?: number; height?: number }
export interface Senses {
  time: number; noises: Noise[];
  /** grid rays marched since creation */
  rays: number;
  sees(observer: { pos: ArrayLike<number>; heading: ArrayLike<number> }, target: { pos: ArrayLike<number> } | ArrayLike<number>, options?: SightOptions): boolean;
  noise(pos: ArrayLike<number>, options?: { radius?: number; tag?: string; source?: any }): Noise;
  /** the best noise in earshot (walls muffle by `muffle`), or null */
  hears(observer: { pos: ArrayLike<number> }, options?: { hearing?: number; muffle?: number; ear?: number; tag?: string }): Noise | null;
  update(dt: number): void;
}
export function createSenses(grid: WalkGrid, options?: { ttl?: number }): Senses;
export function agentActor(agent: NavAgent): Actor;
export interface Perception extends SightOptions {
  targets?: (ctx: BTContext) => Iterable<{ pos: ArrayLike<number> } | ArrayLike<number>>;
  /** seconds a target stays known after it is lost from sight (1) */
  memory?: number;
  /** 0: deaf */
  hearing?: number;
  /** seconds between looks (0.1) */
  every?: number;
}
export interface BehaviorTree {
  root: BTNode; blackboard: Blackboard; ctx: BTContext; status: BTStatus | null;
  tick(dt: number): BTStatus;
  reset(): void;
  /** names of the running leaves */
  active(): string[];
  /** the tree as text with each node's last status */
  describe(): string;
}
export function createBehaviorTree(root: BTNode, options?: { blackboard?: Blackboard; actor?: Actor | null; nav?: NavGrid | null; senses?: Senses | null; perception?: Perception | null; [key: string]: any }): BehaviorTree;
export function patrol(points: NavPoint[], options?: { wait?: number; reach?: number }): BTNode;
export function chase(options?: { key?: string; reach?: number; speed?: number }): BTNode;
export function investigate(options?: { key?: string; wait?: number; reach?: number }): BTNode;
export function follow(options?: { key?: string; distance?: number }): BTNode;
export function flee(options?: { key?: string; distance?: number; speed?: number }): BTNode;
export function guard(options: { points: NavPoint[]; reach?: number; chaseSpeed?: number; wait?: number; onCatch?: (ctx: BTContext) => void }): BTNode;

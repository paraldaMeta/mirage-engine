import type * as THREE from 'three';
import type { RandomStream } from '@mirage/core/rng';
import type { WorldContext } from '@mirage/core/world';
import type { PlanInput, DefinedPlan, XYZ } from './plan.js';

export interface AmbientVolume { min: XYZ; max: XYZ; factor?: number; soft?: number; [custom: string]: unknown }
export interface Anchor { pos: XYZ; rotY?: number; [custom: string]: unknown }
export type AnchorOffers = Record<string, readonly Anchor[]>;
export type ResolvedAnchor = Anchor & { from: string };
/** Missing keys really can be absent, including required keys during the build phase. */
export type AnchorTable = Record<string, ResolvedAnchor[] | undefined>;
export interface Consumption { required?: readonly string[]; optional?: readonly string[] }
export type CoreModuleContext = WorldContext;
/** Minimal loader host, not a declaration of the full @mirage/core renderer API. */
export interface WorldHost<C extends object = CoreModuleContext> {
  scene: THREE.Object3D;
  ctx: C & { onUpdate(callback: (seconds: number) => void): unknown };
  setAmbientVolumes?(volumes: readonly AmbientVolume[]): void;
}
export type ModuleContext<P extends PlanInput = PlanInput, Shared = Record<string, unknown>, C extends object = CoreModuleContext> =
  Omit<C, 'world' | 'plan' | 'shared' | 'name' | 'root' | 'scene' | 'R' | 'rng' | 'anchors' | 'modules' | 'onUpdate' | 'collider' | 'log'> & {
    world: WorldHost<C>; plan: DefinedPlan<P>; shared: Shared; name: string;
    root: THREE.Group; scene: THREE.Group; R: RandomStream; rng(sub?: string): RandomStream;
    anchors: AnchorTable; modules: Record<string, unknown>;
    onUpdate(callback: (seconds: number) => void): () => void;
    /** Replaces the material with the shared proxy material; returned identity is unchanged. */
    collider(mesh: THREE.Mesh): THREE.Mesh;
    log(...values: unknown[]): void;
  };
export interface WorldModule<P extends PlanInput = PlanInput, Shared = Record<string, unknown>, C extends object = CoreModuleContext> {
  name: string;
  build(ctx: ModuleContext<P, Shared, C>): unknown | Promise<unknown>;
  finalize?(ctx: ModuleContext<P, Shared, C>): unknown | Promise<unknown>;
  /** Hooks are synchronous. Build output is untrusted until narrowed by the consumer. */
  anchors?: AnchorOffers | ((ctx: ModuleContext<P, Shared, C>, built: unknown) => AnchorOffers | undefined);
  ambientVolumes?: readonly AmbientVolume[] | ((ctx: ModuleContext<P, Shared, C>, built: unknown) => readonly AmbientVolume[] | undefined);
  consumes?: Consumption;
}
export interface ModuleReport {
  name: string; ok: boolean; ms: number; tris: number; anchors: Record<string, number>;
  consumes?: { key: string; required: boolean; count: number }[];
}
export interface BuildReport {
  plan: string; modules: ModuleReport[];
  failed: { name: string; phase: 'build' | 'consumes' | 'finalize'; error: string }[];
  anchors: Record<string, number>;
  ambientVolumes: (AmbientVolume & { from: string })[];
  ms: number;
  /** Only with the `slice` option. */
  slices?: { yields: number; longestMs: number; longModules: string[]; longTasks: { count: number; totalMs: number; maxMs: number; source: 'longtask' | 'frame-gap' | 'none' } };
}
/** Opt-in time slicing: yield (default: to the next frame) between modules once `budgetMs` (8) of building ran. */
export type SliceOption = boolean | { budgetMs?: number; yield?: () => Promise<unknown> };
export interface BuildResult<P extends PlanInput = PlanInput> {
  plan: DefinedPlan<P>; modules: Record<string, unknown>; anchors: AnchorTable; report: BuildReport;
}
export function buildWorld<P extends PlanInput, Shared = Record<string, unknown>, C extends object = CoreModuleContext>(
  world: WorldHost<C>, options: { plan: P; modules: readonly WorldModule<P, Shared, C>[]; shared?: Shared;
    log?: { log(...values: unknown[]): void; error(...values: unknown[]): void }; slice?: SliceOption },
): Promise<BuildResult<P>>;
export const LAYER: { VIEW: 0; COLLIDE: 2 };
/** @internal the `ctx.collider` of a module root: marks a mesh as collision-only (walk grid, physics) and adds it */
export function colliderFor(root: THREE.Object3D): <M extends THREE.Mesh>(mesh: M) => M;

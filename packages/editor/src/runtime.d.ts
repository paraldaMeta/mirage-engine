// Mirage original code.
import type * as THREE from 'three';
type V3 = [number, number, number];
/** One placed object of the layer (plan.objects[id]). `type` picks the fields: see OBJECT_TYPES. */
export interface PlacedObject { type: string; name?: string; position: V3; rotation: V3; scale: V3; [field: string]: unknown }
/** A node override: a pose, visibility and material values written over a node the modules built. */
export interface NodeOverride { position?: V3; rotation?: V3; scale?: V3; visible?: boolean; material?: Record<string, number | string> }
export interface TimelineDef { duration?: number; loop?: boolean; tracks: { type: 'transform' | 'camera' | 'event'; target?: string; curve?: string; keys: Record<string, unknown>[] }[] }
/** What the editor saves (plan.edits.json): edits over a plan, never a copy of it. */
export interface EditLayer {
  version: number;
  /** plan path ("points.palm", "regions.court.rect") -> value */
  set: Record<string, unknown>;
  objects: Record<string, PlacedObject>;
  /** scene path ("module/0/2") -> override */
  nodes: Record<string, NodeOverride>;
  /** time, date, wet, rain, post.<setting>, light2.<part>.<setting> */
  env: Record<string, string | number | boolean>;
  timelines: Record<string, TimelineDef>;
}
export interface Placed {
  group: THREE.Group; items: Map<string, { id: string; def: PlacedObject; root: THREE.Object3D }>;
  get(id: string): THREE.Object3D | null;
  /** Add, change (in place when only the pose changed) or, with undefined, remove one object. */
  set(id: string, def: PlacedObject | undefined): void;
  /** Resolves when every model and effect asked for so far is in the scene. */
  ready(): Promise<void>;
  dispose(): void;
}
export interface EditableState { placed: Placed | null; timelines: Record<string, unknown>; missing?: string[] }
export interface EditorHost {
  world: unknown; built: unknown; play?: unknown;
  /** The buildWorld options for a plan: lets the editor rebuild the modules in place after a plan edit. */
  rebuild?: (plan: any) => unknown;
  /** Start the project's own play mode (createPlay) for play-in-editor. */
  makePlay?: (options: { plan: any }) => { dispose(): void };
  /** Animators to watch in the animator viewer. */
  animators?: Record<string, unknown>;
}
export interface Editable<P> {
  base: P; layer: EditLayer;
  /** The plan with the layer applied; the plan object itself when the layer is empty. */
  plan: P;
  /** True when the page is served by mirage-editor. */
  editor: boolean;
  hash(): string;
  /** The world's `lighting` config with the layer's probe and GI volumes added (cfg itself when there are none). */
  lighting<T>(cfg: T): T;
  /** After buildWorld: placed objects, node overrides, environment, timelines. Adds nothing for an empty layer. */
  apply(world: unknown, built?: unknown): Promise<EditableState>;
  /** Hand the live world to the editor. Returns false (and does nothing) outside mirage-editor. */
  attach(host: EditorHost): boolean;
}
export function editable<P extends object>(plan: P, layer?: unknown, options?: { resolve?: (url: string) => string }): Editable<P>;
export function createPlaced(world: unknown, options?: { resolve?: (url: string) => string; onError?: (id: string, error: unknown) => void }): Placed;
export function setPose(o: THREE.Object3D, def: { position?: V3; rotation?: V3; scale?: V3 }): void;
export function getPose(o: THREE.Object3D): { position: V3; rotation: V3; scale: V3 };
export function nodePath(o: THREE.Object3D, scene: THREE.Object3D): string;
export function resolveNode(scene: THREE.Object3D, path: string): THREE.Object3D | null;
export function nodeMaterial(o: THREE.Object3D): Record<string, number | string> | null;
export function applyNodeOverride(o: THREE.Object3D, override: NodeOverride | undefined): void;
/** Apply every node override; returns the paths that matched no node. */
export function applyNodes(scene: THREE.Object3D, nodes?: Record<string, NodeOverride>): string[];
/** Apply environment values (all of them, or `only` these keys). A key set to undefined goes back to what the world had. */
export function applyEnv(world: unknown, env?: EditLayer['env'], only?: string[]): Promise<void>;
export function lightingFromPlan<T>(plan: unknown, cfg: T): T;
export function createTriggers(plan: unknown, handlers?: { onEnter?: (t: { event: string }) => void; onLeave?: (t: { event: string }) => void }): { triggers: unknown[]; update(position: V3): void };
/** plan.timelines as live createTimeline objects (name -> timeline). */
export function createTimelines(plan: unknown, world: unknown, placed?: Placed | null): Promise<Record<string, { play(from?: number): unknown; pause(): unknown; stop(): unknown; seek(t: number): unknown; update(dt: number): boolean; time: number; playing: boolean }>>;
export function applyEdits<P extends object>(plan: P, layer: unknown): P;
export function planHash(plan: unknown): string;
export function normalizeLayer(layer: unknown): EditLayer;
export function isEmptyLayer(layer: unknown): boolean;

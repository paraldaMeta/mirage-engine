import type * as THREE from 'three';
import type { XYZ } from '@mirage/world';
import type { GameMessages } from './ui.js';

export interface InventoryItem { id: string; name: string; text?: string; [field: string]: unknown }
export interface Interaction {
  label: string | ((game: Game, entity: InteractableEntity) => string);
  can?(game: Game, entity: InteractableEntity): boolean;
  use(game: Game, entity: InteractableEntity): void;
  at?(entity: InteractableEntity): XYZ; reach?: number;
}
export interface Entity {
  id: string; pos?: XYZ; object?: THREE.Object3D; interact?: Interaction;
  update?(dt: number, game: Game): void; save?(game: Game): unknown;
  load?(data: unknown, game: Game): void; onRemove?(game: Game): void;
}
export type InteractableEntity = Entity & { interact: Interaction };
export type ZoneShape = { box: readonly [XYZ, XYZ]; sphere?: never } | { sphere: readonly [XYZ, number]; box?: never };
export type Zone = ZoneShape & {
  id: string; once?: boolean; inside?: boolean; fired?: boolean;
  enter?(game: Game, zone: ActiveZone): void; exit?(game: Game, zone: ActiveZone): void;
};
export type ActiveZone = Zone & { inside: boolean; fired: boolean };
/** restore() validates only v. All other fields from imported JSON still require application validation. */
export interface LoadedSave { v: number; [field: string]: unknown }
export interface Snapshot {
  v: number; id: string; at: string; time: number; flags: Record<string, unknown>; inventory: InventoryItem[];
  removed: string[]; entities: Record<string, unknown>; zones: Record<string, { inside: boolean; fired: boolean }>;
  settings: Record<string, unknown>;
}
/** Extra fields spread last at runtime, including overrides of base fields. */
export type ExtendedSnapshot<Extra extends object = Record<never, never>> = Omit<Snapshot, keyof Extra> & Extra;
export type SaveSlot = number | string;
export type SlotInfo = { slot: number; broken?: never; at?: never; time?: never; summary?: never }
  | { slot: number; broken: true; at?: never; time?: never; summary?: never }
  | { slot: number; broken?: never; at: unknown; time: unknown; summary: unknown };
export type Migrations = Record<number, (save: LoadedSave) => object>;
export interface GameOptions { id?: string; version?: number; migrate?: Migrations; storage?: Pick<Storage, 'getItem' | 'setItem'> }
export interface GameEvents {
  flag: { key: string; value: unknown }; spawn: Entity; remove: Entity; interact: InteractableEntity;
  pause: boolean; zone: { id: string; inside: boolean }; inventory: { added?: InventoryItem; removed?: InventoryItem };
  load: LoadedSave; save: { slot: SaveSlot; s: object }; start: undefined;
}
export type EventData<K extends string> = K extends keyof GameEvents ? GameEvents[K] : unknown;
export type System = (dt: number, game: Game) => void;
export interface Game {
  id: string; version: number; entities: Map<string, Entity>; systems: System[];
  flags: Record<string, unknown>; removed: Set<string>; settings: Record<string, unknown>;
  paused: boolean; time: number; zones: Map<string, ActiveZone>; player: XYZ | null;
  dirty?: boolean; ui?: GameMessages;
  on<K extends string>(type: K, listener: (data: EventData<K>, game: Game) => void): () => boolean;
  emit<K extends string>(type: K, ...args: undefined extends EventData<K> ? [data?: EventData<K>] : [data: EventData<K>]): void;
  set(key: string, value?: unknown): void;
  add<E extends Entity>(entity: E): E;
  spawn<A, E extends Entity>(anchors: readonly A[] | null | undefined, make: (anchor: A, index: number) => E): E[];
  remove(entity: Entity | string | null | undefined): void;
  system<F extends System>(fn: F): F;
  tick(dt: number): void;
  zone<Z extends Zone>(zone: Z): Z & { inside: boolean; fired: boolean };
  pause(on?: boolean): void;
  label(entity: InteractableEntity): string;
  /** Entity must provide interact.at, pos or object. */
  where(entity: InteractableEntity): XYZ;
  nearest(eye: XYZ, direction: XYZ, options?: { reach?: number; cone?: number }): InteractableEntity | null;
  interact(entity: Entity | null | undefined): void;
  inventory: { items: InventoryItem[]; has(id: string): boolean; add(item: InventoryItem): void; remove(id: string): void };
  snapshot<Extra extends object = Record<never, never>>(extra?: Extra): ExtendedSnapshot<Extra>;
  restore(save: unknown): LoadedSave;
  save<Extra extends object = Record<never, never>>(slot?: SaveSlot, extra?: Extra): ExtendedSnapshot<Extra>;
  load(slot?: SaveSlot): LoadedSave | null;
  slots(count?: number): SlotInfo[];
  exportJSON(extra?: object): string;
  importJSON(text: string): LoadedSave;
  saveSettings(): void;
  /** JSON settings are not schema-validated; narrow before use. */
  loadSettings(): unknown;
  /** Resets flags/inventory/time/zones; keeps entities, systems and listeners. */
  reset(): void;
}
export function createGame(options?: GameOptions): Game;

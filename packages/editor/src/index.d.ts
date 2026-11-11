// Mirage original code.
import type { EditLayer, PlacedObject } from './runtime.js';
export type { EditLayer, PlacedObject, NodeOverride, TimelineDef, Placed, Editable, EditorHost, EditableState } from './runtime.js';
export { editable, createPlaced, applyNodes, applyEnv, createTimelines, createTriggers, applyEdits, planHash, normalizeLayer, isEmptyLayer } from './runtime.js';

export const LAYER_VERSION: number;
export function emptyLayer(): EditLayer;
/** The layer as the text that is written to disk: sorted keys, two-space indent, trailing newline. */
export function serializeLayer(layer: unknown): string;

export interface Change { section: 'set' | 'objects' | 'nodes' | 'env' | 'timelines'; key: string; value: unknown }
export interface DocumentEvent { kind: 'do' | 'undo' | 'redo' | 'load' | 'saved'; label?: string; changes: { section: Change['section']; key: string; before: unknown; after: unknown }[] }
/** A layer with a command stack: every edit is exec(label, changes) and can be undone. */
export interface EditorDocument<P = unknown> {
  base: P; readonly layer: EditLayer; readonly plan: P;
  get(section: Change['section'], key: string): unknown;
  /** One undo step. `merge`: steps with the same id within 1.5 s fold into one (a drag). False when nothing changes. */
  exec(label: string, changes: Change | Change[], options?: { merge?: string }): boolean;
  undo(): boolean; redo(): boolean; readonly canUndo: boolean; readonly canRedo: boolean;
  history(): { done: string[]; undone: string[] };
  on(listener: (event: DocumentEvent) => void): () => void;
  newId(type: string): string;
  serialize(): string; hash(): string; readonly dirty: boolean; markSaved(): void; load(layer: unknown): void;
}
export function createDocument<P extends object>(basePlan: P, layer?: unknown, options?: { limit?: number }): EditorDocument<P>;

export interface Field { path: string; label: string; type: 'number' | 'vector' | 'color' | 'enum' | 'bool' | 'string' | 'asset' | 'points' | 'json'; min?: number; max?: number; step?: number; labels?: string[]; options?: unknown[]; kind?: string; optional?: boolean; readonly?: boolean }
/** The placed-object types: label, defaults and typed fields. */
export const OBJECT_TYPES: Record<string, { label: string; volume?: boolean; reload?: boolean; defaults: Record<string, unknown>; fields: (Partial<Field> & { key: string })[] }>;
export function newObject(type: string, at?: [number, number, number], extra?: Record<string, unknown>): PlacedObject;
/** Every plan entry the editor can select. */
export function planElements(plan: unknown): { id: string; path: string; group: string; kind: 'point' | 'shape' | 'path' | 'view'; label: string }[];
/** The JSON-schema node a plan path points at (null where the schema says nothing). */
export function schemaAt(schema: unknown, path: string): unknown;
/** Typed inspector fields for a value under a schema node. */
export function fieldsFromSchema(schema: unknown, node: unknown, value: unknown, path?: string, label?: string): Field[];

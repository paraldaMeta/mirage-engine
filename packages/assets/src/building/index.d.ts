import type * as THREE from 'three';
import type { MeshBatch } from '@miragekit/core/geom';

/** The building kit's material slots (buildingMaterials makes them; any object with these slots works). */
export interface BuildingMaterials { wall: THREE.Material; trim: THREE.Material; stone: THREE.Material; wood: THREE.Material; roof: THREE.Material; metal: THREE.Material; glass: THREE.Material; floor: THREE.Material }
/** A part: adds to `batch` at `matrix` (its foot on y = 0, front toward +z, width along x). */
type Part<O = Record<string, unknown>, R = void> = (batch: MeshBatch, M: BuildingMaterials, matrix: THREE.Matrix4 | null, options?: O) => R;
export interface Opening { x?: number; width: number; height: number; sill?: number; arch?: 'flat' | 'round'; kind?: 'door' | 'window' | 'open' }

export const wallPanel: Part<{ width?: number; height?: number; thick?: number; plinth?: number }>;
export const wallOpenings: Part<{ width?: number; height?: number; thick?: number; openings?: readonly Opening[]; plinth?: number; frame?: number }>;
export const wallDoor: Part<{ width?: number; height?: number; thick?: number; door?: readonly [number, number]; arch?: 'flat' | 'round'; leaf?: boolean }>;
export const wallWindow: Part<{ width?: number; height?: number; thick?: number; window?: readonly [number, number]; sill?: number; count?: number; arch?: 'flat' | 'round' }>;
export const corner: Part<{ height?: number; size?: number }>;
export const doorLeaf: Part<{ width?: number; height?: number; style?: 'panel' | 'plank' | 'glass'; thick?: number }>;
export const windowFrame: Part<{ width?: number; height?: number; panes?: readonly [number, number]; depth?: number }>;
export const shutters: Part<{ width?: number; height?: number; open?: number }>;
export const floorSlab: Part<{ width?: number; depth?: number; thick?: number; edge?: boolean }>;
export const column: Part<{ height?: number; radius?: number; style?: 'round' | 'square' }>;
export const beam: Part<{ a?: readonly [number, number, number]; b?: readonly [number, number, number]; size?: readonly [number, number] }>;
export const archway: Part<{ width?: number; height?: number; thick?: number; pier?: number; kind?: 'round' | 'pointed' | 'segmental' | 'flat' }>;
export const stairs: Part<{ width?: number; rise?: number; steps?: number; going?: number; stringer?: boolean; rails?: readonly [boolean, boolean]; solid?: boolean }, { run: number }>;
export const spiralStairs: Part<{ radius?: number; rise?: number; steps?: number; turns?: number }>;
export const railing: Part<{ length?: number; rise?: number; height?: number; style?: 'bars' | 'glass' | 'solid' | 'cable'; spacing?: number }>;
export const ramp: Part<{ width?: number; rise?: number; run?: number }>;
export const stoop: Part<{ width?: number; rise?: number; count?: number; going?: number }>;
export const ladder: Part<{ height?: number; width?: number; cage?: boolean }>;
export const roofGable: Part<{ width?: number; depth?: number; pitch?: number; overhang?: number }, { rise: number }>;
export const roofHip: Part<{ width?: number; depth?: number; pitch?: number; overhang?: number }, { rise: number }>;
export const roofFlat: Part<{ width?: number; depth?: number; parapet?: number; thick?: number }>;
export const dormer: Part<{ width?: number; height?: number; depth?: number }>;
export const chimney: Part<{ height?: number; size?: readonly [number, number] }>;
export const gutter: Part<{ length?: number; drop?: number; side?: number }>;
export const balcony: Part<{ width?: number; depth?: number; style?: 'bars' | 'glass' | 'solid' | 'cable' }>;
export const awning: Part<{ width?: number; depth?: number; drop?: number; stripes?: number; fabric?: THREE.Material | null }>;
export const fence: Part<{ length?: number; height?: number; style?: 'picket' | 'wire' | 'panel' }>;
export const gate: Part<{ width?: number; height?: number; open?: number }>;
export const moulding: Part<{ length?: number; profile?: readonly (readonly [number, number])[]; slot?: keyof BuildingMaterials }>;

export type BuildingStyle = 'stucco' | 'stone' | 'brick' | 'timber' | 'concrete';
export const BUILDING_STYLES: Readonly<Record<BuildingStyle, { wall: string; trim: readonly number[]; stone: string; roof: string; proc: string; brick?: boolean }>>;
/** The slots for a style, made once per ctx (cached on ctx.shared). Throws on an unknown style. */
export function buildingMaterials(ctx: { mat: { std: (...a: never[]) => THREE.Material; phys: (...a: never[]) => THREE.Material; PROC: Record<string, (...a: never[]) => unknown> }; shared?: Record<string, unknown> }, style?: BuildingStyle): BuildingMaterials;
/** A seeded house of 3 m bays and storeys, its door on the front (+z). */
export const house: Part<{ bays?: readonly [number, number]; storeys?: number; roof?: 'gable' | 'hip' | 'flat'; seed?: number; bay?: number; storey?: number; thick?: number; plinth?: number },
  { width: number; depth: number; height: number; doors: [number, number, number][] }>;

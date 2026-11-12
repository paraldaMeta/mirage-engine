import type * as THREE from 'three';
import type { MeshBatch } from '@miragekit/core/geom';
import type { BuildingMaterials } from '../building/index.js';

/** The home props' material slots (homeMaterials makes them; values are tinted per part by a vertex colour). */
export interface HomeMaterials { wood: THREE.Material; fabric: THREE.Material; leather: THREE.Material; metal: THREE.Material; chrome: THREE.Material; plastic: THREE.Material; ceramic: THREE.Material; glass: THREE.Material; paper: THREE.Material; leaf: THREE.Material; screen: THREE.Material }
/** Linear RGB. */
export type RGB = readonly [number, number, number];
/** A prop: adds to `batch` at `matrix` (its foot on y = 0, front toward +z, centred on x). Options: sizes in metres, colours as RGB, `seed` where a prop varies. */
type Prop<R = void> = (batch: MeshBatch, M: HomeMaterials, matrix: THREE.Matrix4 | null, options?: Record<string, unknown>) => R;
export const sofa: Prop<{ width: number; depth: number }>;
export const armchair: Prop<{ width: number; depth: number }>;
export const cushion: Prop;
export const coffeeTable: Prop;
export const sideTable: Prop;
export const tvStand: Prop;
export const television: Prop;
export const bookshelf: Prop;
export const rug: Prop;
export const floorLamp: Prop;
export const tableLamp: Prop;
export const plant: Prop;
export const wallClock: Prop;
export const picture: Prop;
export const curtain: Prop;
export const diningTable: Prop;
export const chair: Prop;
export const barStool: Prop;
export const kitchenCounter: Prop;
export const fridge: Prop;
export const microwave: Prop;
export const kettle: Prop;
export const mug: Prop;
export const placeSetting: Prop;
export const bed: Prop;
export const nightstand: Prop;
export const wardrobe: Prop;
export const dresser: Prop;
export const toilet: Prop;
export const washbasin: Prop;
export const bathtub: Prop;
export const towelRail: Prop;
export const desk: Prop;
export const monitor: Prop;
export const laptop: Prop;
export const keyboard: Prop;
export const computerMouse: Prop;
export const deskLamp: Prop;
export const papers: Prop;
export const officeChair: Prop;
export const filingCabinet: Prop;
export const whiteboard: Prop;
export const printer: Prop;
export const waterCooler: Prop;
export const wasteBin: Prop;
export const partition: Prop;
export const meetingTable: Prop;
export const deskPhone: Prop;
/** The slots, made once per ctx (cached on ctx.shared.home). */
export function homeMaterials(ctx: { mat: { std: (...a: never[]) => THREE.Material; phys: (...a: never[]) => THREE.Material; patch: (...a: never[]) => THREE.Material; PROC: Record<string, (...a: never[]) => unknown> }; shared?: Record<string, unknown> }): HomeMaterials;
export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'office';
export const ROOM_KINDS: readonly RoomKind[];
/** A furnished room (a floor, three walls with a window, the front open unless `closed`), centred, floor at y 0. Throws on an unknown kind. */
export function room(batch: MeshBatch, M: HomeMaterials, MB: BuildingMaterials, matrix: THREE.Matrix4 | null, options?: { kind?: RoomKind; size?: readonly [number, number]; height?: number; seed?: number; closed?: boolean; window?: boolean }): { width: number; depth: number };

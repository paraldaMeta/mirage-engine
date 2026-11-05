export type XZ = readonly [x: number, z: number];
export type XYZ = readonly [x: number, y: number, z: number];
export type Bounds = readonly [xMin: number, zMin: number, xMax: number, zMax: number];
export type ViewMode = 'walk' | 'fly' | 'game' | 'orbit';
export type Shape = ({ rect: Bounds; circle?: never; poly?: never }
  | { circle: readonly [x: number, z: number, radius: number]; rect?: never; poly?: never }
  | { poly: readonly XZ[]; rect?: never; circle?: never }) & { y?: number; [custom: string]: unknown };
export interface PlanPath { points: readonly XZ[]; width?: number; y?: number; [custom: string]: unknown }
export interface Viewpoint { eye: XYZ; look: XYZ; name?: string; mode?: ViewMode; [custom: string]: unknown }
export interface PlanInput {
  name: string;
  bounds: Bounds;
  units?: 'm';
  seed?: string | number | null;
  axes?: { x?: 'east'; y?: 'up'; z?: 'south'; [custom: string]: unknown };
  walk?: { yMin?: number; yMax?: number; [custom: string]: unknown };
  regions?: Record<string, Shape>;
  footprints?: Record<string, Shape>;
  paths?: Record<string, PlanPath>;
  points?: Record<string, XYZ>;
  viewpoints?: readonly Viewpoint[];
  spawn?: Viewpoint;
  gameView?: Viewpoint;
}
type Field<P, K extends PropertyKey, Default> = K extends keyof P ? Exclude<P[K], undefined> : Default;
/** Defaults are present, while concrete world-specific fields keep their inferred types. */
export type DefinedPlan<P extends PlanInput = PlanInput> = Omit<P,
  'units' | 'seed' | 'axes' | 'walk' | 'regions' | 'footprints' | 'paths' | 'points' | 'viewpoints'> & {
  units: 'm'; seed: string | number;
  axes: Field<P, 'axes', object> & { x: 'east'; y: 'up'; z: 'south' };
  walk: Field<P, 'walk', object> & { yMin: number; yMax: number };
  regions: Field<P, 'regions', Record<string, Shape>>;
  footprints: Field<P, 'footprints', Record<string, Shape>>;
  paths: Field<P, 'paths', Record<string, PlanPath>>;
  points: Field<P, 'points', Record<string, XYZ>>;
  viewpoints: Field<P, 'viewpoints', readonly Viewpoint[]>;
};
/** Checks runtime ranges and fills defaults. Extra fields are preserved. Throws all diagnostics together. */
export function definePlan<const P extends PlanInput>(plan: P): DefinedPlan<P>;
export function contains(shape: Shape, x: number, z: number): boolean;
export function bbox(shape: Shape): [number, number, number, number];
export function pathLength(path: Pick<PlanPath, 'points'>): number;
/** Clamps distance to the path ends; fewer than two points return undefined. */
export function along(path: Pick<PlanPath, 'points'>, distance: number): { x: number; z: number; dx: number; dz: number } | undefined;

/** 0 (clear) .. 1 (shut) between a sound and the ears. */
export type Occluder = (from: number[], to: number[]) => number;
/** The walk grid of @mirage/play (createWalkGrid): the blocked length of the segment over `thickness` metres. */
export function gridOccluder(grid: { cell: number; floors: ArrayLike<number>; count: ArrayLike<number>; idx(x: number, z: number): number },
  options?: { thickness?: number; skin?: number; step?: number }): Occluder;
/** A Rapier ray (createPhysics().ray); near: metres ignored at both ends. */
export function physicsOccluder(physics: { ray(from: number[], dir: number[], max: number, exclude?: unknown): unknown }, options?: { near?: number; exclude?: unknown }): Occluder;
/** A three.js raycast against `root`; raycaster: a THREE.Raycaster the caller owns. */
export function sceneOccluder(root: object, options: { raycaster: { ray: { origin: { set(x: number, y: number, z: number): unknown }; direction: { set(x: number, y: number, z: number): unknown } }; near: number; far: number; intersectObject(root: any, recursive: boolean, hits: any[]): unknown };
  near?: number; filter?: (object: any) => boolean | void }): Occluder;

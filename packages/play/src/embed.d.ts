import type * as THREE from 'three';
import type { WorldRenderer, WorldRendererOptions, RenderCamera, ShadowRegion } from '@miragekit/core';
import type { PlanInput, DefinedPlan, WorldModule, AnchorTable, BuildReport, XYZ } from '@miragekit/world';
import type { BakedWalkGrid } from './walkgrid.js';
import type { GridWalker, GridBody } from './walker.js';
export interface MountedWorld<P extends PlanInput = PlanInput> {
  world: WorldRenderer; root: THREE.Group; grid: BakedWalkGrid; plan: DefinedPlan<P>; anchors: AnchorTable; report: BuildReport;
  walker(position?: XYZ, body?: Partial<GridBody>): GridWalker;
  groundAt(x: number, z: number, y?: number): number;
  update(dt: number): boolean;
  render(camera: RenderCamera, options?: { target?: THREE.WebGLRenderTarget | null; moving?: boolean; spp?: number; T?: number; shadow?: ShadowRegion }): void;
  setSize(width: number, height: number): void;
  /** Delegates to world.dispose(); the host owns its renderer and animation loop. */
  dispose(): void;
}
export function mountWorld<P extends PlanInput, Shared extends object = Record<string, unknown>>(options: {
  renderer: THREE.WebGLRenderer; plan: P; modules: readonly WorldModule<P, Shared>[];
  world?: WorldRendererOptions; shared?: Shared | ((world: WorldRenderer) => Shared | Promise<Shared>);
  width?: number; height?: number;
}): Promise<MountedWorld<P>>;

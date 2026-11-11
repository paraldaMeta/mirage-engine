import type * as THREE from 'three';
import type { MaterialKit } from '@miragekit/core/materials';
export interface CharacterPalette { jacket: THREE.ColorRepresentation; trousers: THREE.ColorRepresentation; scarf: THREE.ColorRepresentation; leather: THREE.ColorRepresentation; skin: THREE.ColorRepresentation; hair: THREE.ColorRepresentation }
export interface CharacterAppearance { palette?: Partial<CharacterPalette> }
export type CharacterState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land';
export interface Character {
  root: THREE.Group; mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly state: CharacterState;
  update(dt: number, motion?: { distance?: number; run?: boolean; onGround?: boolean; verticalSpeed?: number }): boolean;
  reset(): void;
  /** Detaches the figure and disposes its geometry; the geometry's listener also frees skeleton and material. */
  dispose(): void;
}
export function createCharacter(world: { mat: MaterialKit }, options?: CharacterAppearance): Character;

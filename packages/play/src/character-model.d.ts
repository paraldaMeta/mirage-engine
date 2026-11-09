import type * as THREE from 'three';
import type { MaterialKit } from '@mirage/core/materials';
import type { Character, CharacterPalette } from './character.js';
export interface CharacterModel {
  root: THREE.Group; body: THREE.Group; mesh: Character['mesh']; spine: THREE.Bone; head: THREE.Bone;
  limbs: { side: -1 | 1; hip: THREE.Bone; knee: THREE.Bone; ankle: THREE.Bone; shoulder: THREE.Bone; elbow: THREE.Bone }[];
}
export function buildCharacterModel(world: { mat: MaterialKit }, palette: CharacterPalette): CharacterModel;

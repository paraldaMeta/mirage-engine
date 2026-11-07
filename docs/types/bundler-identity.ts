// Bundler consumers can exchange nominal Rapier objects with the native package.
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { DynamicProp, Physics, PhysicsCharacter } from '@mirage/game';
declare const physics: Physics, prop: DynamicProp, character: PhysicsCharacter;
const nativeWorld: World = physics.world;
const nativeBody: RigidBody = prop.body;
const nativeCollider: Collider = character.collider;
physics.ray([0, 1, 0], [0, -1, 0], 10, nativeCollider);

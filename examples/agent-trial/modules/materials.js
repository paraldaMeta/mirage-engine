// Materials more than one module uses, made once per world (cached in ctx.shared.mats). Lead-owned: modules ask
// for additions in NOTES.md; module-only materials stay in the module's own file.
import * as THREE from 'three';
import { PROC } from '@mirage/core';

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  return (ctx.shared.mats = {
    stone: mat.std({ roughness: 0.86 }, PROC.stone('vec3(0.40, 0.38, 0.35)')),          // seawall, paving, plinth
    timber: mat.std({ roughness: 0.82 }, PROC.wood('vec3(0.24, 0.20, 0.16)', 'z')),     // deck, rails, benches, door (grain along z)
    post: mat.std({ roughness: 0.82 }, PROC.wood('vec3(0.20, 0.16, 0.12)', 'y')),       // piles, posts (grain up)
    iron: mat.std({ color: new THREE.Color(0.03, 0.032, 0.035), roughness: 0.45, metalness: 0.85 }),   // lamp posts, railings
    plaster: mat.std({ roughness: 0.9 }, PROC.plaster('vec3(0.80, 0.79, 0.76)')),       // the lighthouse
  });
}

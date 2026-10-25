// Materials more than one module uses, made once per world (cached in ctx.shared.mats). Lead-owned: modules ask
// for additions in NOTES.md; module-only materials stay in the module's own file.
import * as THREE from 'three';
import { PROC } from '@mirage/core';

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  return (ctx.shared.mats = {
    stone: mat.std({ roughness: 0.85 }, PROC.stone()),
    wood: mat.std({ roughness: 0.8 }, PROC.wood()),
    plaster: mat.std({ roughness: 0.92 }, PROC.plaster()),
    iron: mat.std({ color: new THREE.Color(0.03, 0.028, 0.025), roughness: 0.5, metalness: 0.8 }),
    lamp: mat.glow([1.0, 0.58, 0.26], 14),
  });
}

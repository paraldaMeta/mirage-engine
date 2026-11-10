// Materials more than one module uses, made once per world (cached in ctx.shared.mats).
import * as THREE from 'three';
import { PROC } from '@mirage/core';

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  return (ctx.shared.mats = {
    stone: mat.std({ roughness: 0.85 }, PROC.stone()),
    wood: mat.std({ roughness: 0.8, transparent: true, opacity: 0.96 }, PROC.wood()),
    plaster: mat.std({ roughness: 0.92 }, PROC.plaster()),
    paving: mat.std({ color: new THREE.Color(0.42, 0.36, 0.3), roughness: 0.9 }),
    iron: mat.std({ color: new THREE.Color(0.03, 0.028, 0.025), roughness: 0.5, metalness: 0.8 }),
    lamp: mat.glow([1.0, 0.58, 0.26], 6),
  });
}

// Materials more than one module uses, made once per world (cached in ctx.shared.mats). Lead-owned.
import * as THREE from 'three';
import { PROC } from '@mirage/core';

// snow: blue-white, soft large-scale undulation, fine crust bump; `lie` (GLSL float) = how much snow a face holds
export const snowHooks = (lie = '1.0') => ({
  fragmentDecl: 'float sH;',
  albedo: /* glsl */ `{
    vec3 p = mgWorldPos; float n = mgFbm3(p * 0.35, 3), f = mgFbm3(p * 9.0, 2);
    vec3 snow = mix(vec3(0.70, 0.74, 0.80), vec3(0.86, 0.88, 0.92), n) * (0.94 + 0.08 * f);
    diffuseColor.rgb = mix(diffuseColor.rgb, snow, clamp(${lie}, 0.0, 1.0)); sH = 0.6 * n + 0.25 * f;
  }`,
  normal: 'normal = mgBump(normal, sH, 0.012);',
});

// a PROC hook set with snow lying on its upward faces (normal.y above ~0.6)
export const withSnow = (hooks) => {
  const s = snowHooks('smoothstep(0.55, 0.8, normalize(mgWorldNormal).y + 0.15 * mgFbm3(mgWorldPos * 6.0, 2))');
  return { ...hooks, fragmentDecl: (hooks.fragmentDecl || '') + s.fragmentDecl, albedo: hooks.albedo + s.albedo };
};

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  return (ctx.shared.mats = {
    snow: mat.std({ color: 0xffffff, roughness: 0.78 }, snowHooks()),
    log: mat.std({ roughness: 0.85 }, PROC.wood('vec3(0.20, 0.13, 0.08)', 'x')),        // fence rails, logs (grain along x)
    post: mat.std({ roughness: 0.85 }, PROC.wood('vec3(0.17, 0.12, 0.08)', 'y')),       // posts, trunks (grain up)
    stone: mat.std({ roughness: 0.88 }, PROC.stone('vec3(0.30, 0.30, 0.31)')),
    iron: mat.std({ color: new THREE.Color(0.025, 0.025, 0.027), roughness: 0.5, metalness: 0.8 }),
  });
}

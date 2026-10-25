// The courtyard's materials, made once per world and shared by every module (ctx.shared).
import * as THREE from 'three';
import { PROC } from '@mirage/core';

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx, tex = ctx.shared.tex;
  // photo detail (texture sets) under the courtyard's own palette, plus procedural weathering
  const plaster = mat.std({ roughness: 0.92 }, tex.hooks(['plaster'], {
    fragmentDecl: 'MgTex mgS;',
    albedo: `{
      vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
      mgS = mgTexWall(MG_TEX_plaster, p, n, 2.2, 1.4);
      vec3 c = mgTexTint(mgS, vec3(0.80, 0.68, 0.52), 1.2) * (0.93 + 0.12 * mgFbm3(p * 0.35, 3));
      c *= 1.0 - 0.14 * smoothstep(0.15, 0.8, mgFbm3(p * vec3(2.4, 0.16, 2.4) + 3.0, 3)) * (1.0 - abs(n.y));   // rain streaks
      c *= mix(0.74, 1.0, smoothstep(0.0, 0.9, p.y + 0.3 * mgFbm3(p * 1.7, 2)));                              // damp foot
      diffuseColor.rgb *= c; }`,
    normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
  }));
  const land = mat.std({ roughness: 0.95 }, tex.hooks(['ground'], { fragmentDecl: 'MgTex mgS;', albedo: `
    mgS = mgTexGround(MG_TEX_ground, mgWorldPos, normalize(mgWorldNormal), 0.0, 1.0);
    float n = mgFbm2(mgWorldPos.xz * 0.05, 5), slope = 1.0 - normalize(mgWorldNormal).y;
    vec3 c = mix(vec3(0.42, 0.35, 0.25), vec3(0.30, 0.30, 0.19), smoothstep(-0.1, 0.4, n));
    c = mix(c, vec3(0.36, 0.32, 0.28), smoothstep(0.08, 0.3, slope));
    diffuseColor.rgb *= mgTexTint(mgS, c, 0.9);`, normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));' }));
  return (ctx.shared.mats = {
    plaster, land,
    ashlar: tex.material('ashlar', { mapping: 'wall', tint: [0.56, 0.47, 0.37], detail: 1.1, tile: 2.4, roughness: 0.85 }),
    paving: tex.material('paving', { mapping: 'ground', tint: [0.56, 0.48, 0.38], detail: 0.8, roughness: 0.82 }),
    planks: tex.material('planks', { mapping: 'tri', tint: [0.36, 0.25, 0.16], detail: 1, roughness: 0.78, tile: 1.6 }),
    clay: mat.std({ roughness: 0.75 }, PROC.terracotta()),
    iron: mat.std({ color: new THREE.Color(0.03, 0.028, 0.025), roughness: 0.5, metalness: 0.8 }),
    glass: mat.glow([1.0, 0.58, 0.26], 14),
    water: mat.phys({ color: new THREE.Color(0.02, 0.05, 0.05), roughness: 0.04, metalness: 0, ior: 1.33 },
      { normal: 'normal = mgBump(normal, mgFbm2(mgWorldPos.xz * 3.0 + uTime * 0.25, 3) * 0.6, 0.002);' }),
  });
}

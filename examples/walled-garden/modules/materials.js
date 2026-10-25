// The garden's materials, made once per world (ctx.shared.mats) from the courtyard's CC0 texture sets plus
// procedural surfaces (lawn, hedge, foliage, roof tiles, bark).
import * as THREE from 'three';
import { PROC } from '@mirage/core';

const leafy = (dark, light, scale) => ({
  fragmentDecl: 'float gH;',
  albedo: `{ vec3 p = mgWorldPos; gH = mgFbm3(p * ${scale.toFixed(2)}, 4) * 0.5 + 0.5;
    float twig = mgHash(floor(p * ${(scale * 3.5).toFixed(1)})); gH = gH * 0.6 + 0.4 * mgValue3(p * ${(scale * 7).toFixed(1)});
    diffuseColor.rgb *= mix(vec3(${dark}), vec3(${light}), gH) * (0.75 + 0.45 * twig) * (0.75 + 0.25 * smoothstep(-1.0, 2.0, p.y)); }`,
  normal: 'normal = mgBump(normal, gH, 0.045);',
  // a little light through the leaves toward the sun
  lighting: 'reflectedLight.indirectDiffuse += diffuseColor.rgb * uKeyColor * 0.04 * max(dot(-normalize(mgWorldPos - cameraPosition), uKeyDir), 0.0);',
});

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx, tex = ctx.shared.tex;
  const wallTint = (c) => tex.hooks(['plaster'], {
    fragmentDecl: 'MgTex mgS;',
    albedo: `{ vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
      mgS = mgTexWall(MG_TEX_plaster, p, n, 2.2, 1.4);
      vec3 c = mgTexTint(mgS, vec3(${c}), 1.2) * (0.93 + 0.12 * mgFbm3(p * 0.3, 3));
      c *= 1.0 - 0.16 * smoothstep(0.15, 0.8, mgFbm3(p * vec3(2.4, 0.14, 2.4) + 3.0, 3)) * (1.0 - abs(n.y));
      c *= mix(0.72, 1.0, smoothstep(0.0, 1.1, p.y + 0.3 * mgFbm3(p * 1.7, 2)));   // damp foot
      diffuseColor.rgb *= c; }`,
    normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));',
  });
  const ground = (c, k) => tex.hooks(['ground'], { fragmentDecl: 'MgTex mgS;', albedo: `
    mgS = mgTexGround(MG_TEX_ground, mgWorldPos, normalize(mgWorldNormal), 0.0, 1.0);
    float n = mgFbm2(mgWorldPos.xz * 0.05, 5);
    vec3 c = mix(vec3(${c}), vec3(${c}) * vec3(0.82, 0.86, 0.72), smoothstep(-0.1, 0.4, n));
    diffuseColor.rgb *= mgTexTint(mgS, c, ${k});`, normal: 'normal = mgTexNormal(normal, mgS, normalize(mgWorldNormal));' });
  return (ctx.shared.mats = {
    plaster: mat.std({ roughness: 0.92 }, wallTint('0.82, 0.70, 0.55')),
    pavilion: mat.std({ roughness: 0.9 }, wallTint('0.86, 0.78, 0.66')),
    ashlar: tex.material('ashlar', { mapping: 'wall', tint: [0.56, 0.47, 0.37], detail: 1.1, tile: 2.4, roughness: 0.85 }),
    paving: tex.material('paving', { mapping: 'ground', tint: [0.6, 0.52, 0.42], detail: 0.8, roughness: 0.82 }),
    planks: tex.material('planks', { mapping: 'tri', tint: [0.36, 0.25, 0.16], detail: 1, roughness: 0.78, tile: 1.6 }),
    land: mat.std({ roughness: 0.95 }, ground('0.42, 0.35, 0.25', 0.9)),
    gravel: mat.std({ roughness: 0.93 }, ground('0.56, 0.50, 0.41', 0.7)),
    lawn: mat.std({ roughness: 0.97 }, {
      fragmentDecl: 'float gH;',
      albedo: `{ vec2 p = mgWorldPos.xz; float big = mgFbm2(p * 0.12, 4), blade = mgValue2(p * vec2(55.0, 61.0));
        gH = blade; vec3 c = mix(vec3(0.085, 0.13, 0.035), vec3(0.15, 0.19, 0.055), smoothstep(-0.3, 0.5, big));
        diffuseColor.rgb *= c * (0.8 + 0.35 * blade); }`,
      normal: 'normal = mgBump(normal, gH, 0.004);',
    }),
    hedge: mat.std({ roughness: 0.85 }, leafy('0.035, 0.06, 0.02', '0.09, 0.13, 0.04', 5.0)),
    foliage: mat.std({ roughness: 0.8 }, leafy('0.05, 0.08, 0.02', '0.17, 0.21, 0.06', 3.2)),
    cypress: mat.std({ roughness: 0.9 }, leafy('0.03, 0.05, 0.02', '0.07, 0.1, 0.04', 2.5)),
    bark: mat.std({ roughness: 0.9 }, { fragmentDecl: 'float gH;', albedo: 'gH = mgFbm3(mgWorldPos * vec3(9.0, 1.5, 9.0), 4); diffuseColor.rgb *= vec3(0.22, 0.18, 0.14) * (0.7 + 0.5 * gH);', normal: 'normal = mgBump(normal, gH, 0.01);' }),
    clay: mat.std({ roughness: 0.75 }, PROC.terracotta()),
    iron: mat.std({ color: new THREE.Color(0.03, 0.028, 0.025), roughness: 0.5, metalness: 0.8 }),
    glass: mat.glow([1.0, 0.58, 0.26], 14),
    water: mat.phys({ color: new THREE.Color(0.015, 0.04, 0.045), roughness: 0.04, metalness: 0, ior: 1.33 },
      { normal: 'normal = mgBump(normal, mgFbm2(mgWorldPos.xz * 3.0 + uTime * 0.25, 3) * 0.6, 0.002);' }),
  });
}

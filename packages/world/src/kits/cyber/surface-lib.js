// Mirage original code. kit/cyber's surface library per world: surfaceLib(ctx) (cached on ctx.shared.surf) wraps
// core's createSurfaces in 'auto' mode with a bake size per quality (ctx.shared.tier) and per role, and adds the
// helpers the kit's props and the neon district share: surf (a material from a surface spec, optionally wet, with
// layout marks over it), painted (painted steel in any colour from one bake) and shade (light-coloured sets tinted per part).
import * as THREE from 'three';
import { withWet, SURFACES, SURFACE_KINDS, createSurfaces } from '@miragekit/core';

/** The district's surface library (one per world, ctx.shared.surf): createSurfaces in 'auto' mode with a bake size
 *  per quality (ctx.shared.tier) and per role, so the baked sets stay inside the memory budget (NOTES.md "Surfaces").
 *  surf(spec, options, { post, decl }) -> a material: options as lib.material's plus `size` ('big' | 'mid' | 'small' |
 *  px); `post` edits msAlb / msR / msM before they apply (layout marks over the surface: kerb paint, hazard
 *  stripes), `decl` adds GLSL the options reference (the road paint mask). */
export function surfaceLib(ctx) {
  if (ctx.shared.surf) return ctx.shared.surf;
  const world = ctx.world || ctx, tier = ctx.shared.tier || 'high';
  const lib = createSurfaces(world, { mode: 'auto' });
  // big: the ground and the walls you walk along; mid: large props and interiors; small: things a metre across
  // (measured, NOTES.md "Surfaces": high 1024 / 512 / 256 px, medium 512 / 256 / 256, low 256 / 128 / 128; the baked sets
  // then come to about 59, 28 and 9 MB, the decal atlas's 2 MB included)
  const SIZE = { high: { big: 1024, mid: 512, small: 256 }, medium: { big: 512, mid: 256, small: 256 }, low: { big: 256, mid: 128, small: 128 } }[tier] || { big: 512, mid: 256, small: 256 };
  const STEP = { wood: 'wood', bamboo: 'wood' };
  const surf = (spec, o = {}, x = {}) => {
    const { wet, params, size = 'mid', ...ho } = o;
    let h = lib.hooks(spec, { ...ho, size: SIZE[size] || size });
    if (x.decl) h = { ...h, fragmentDecl: h.fragmentDecl + x.decl };
    if (x.post) h = { ...h, albedo: h.albedo.replace('diffuseColor.rgb *= msAlb;', x.post + '\n  diffuseColor.rgb *= msAlb;') };
    if (wet) h = withWet(h, { porosity: spec.porosity, height: 'msH', heightMid: 0.5, heightScale: Math.max(spec.depth, 0.004), ground: ho.ground ?? 0, ...(wet === true ? {} : wet) });
    const base = { roughness: 1, metalness: 1, ...spec.material, ...(params || {}) };
    const m = spec.physical ? ctx.mat.phys(base, h) : ctx.mat.std(base, h);
    m.name = `surface-${spec.kind}-${spec.variant}`;
    // footsteps (@miragekit/game reads userData.surface): metal rattles like gravel
    m.userData.surface = STEP[spec.kind] || (/metal|coating|composite/.test(SURFACE_KINDS[spec.kind].family) ? 'gravel' : 'stone');
    m.userData.surfaceKind = { kind: spec.kind, variant: spec.variant };
    return m;
  };
  // painted steel in any colour from one bake per variant: a mid-grey set tinted by the material's colour (the rust and
  // the primer take the tint too, which is why the tints are muted colours)
  const painted = (color, { variant = 'sheet', side, size = 'mid', ...o } = {}) => surf(
    SURFACES.paintedMetal({ variant, color: [0.4, 0.4, 0.4], chips: 0.3, rust: 0.22, streaks: 0.35 }),
    { size, ...o, params: { color: new THREE.Color().setRGB(color[0] / 0.4, color[1] / 0.4, color[2] / 0.4), ...(side ? { side } : {}) } });
  // light-coloured sets shared by every part of that make, the part's colour a tint (one bake each): 'plastic',
  // 'coat' (satin powder coat), 'board' (cardboard), 'sawn' (sawn wood). shade(kind, rgb, options)
  const LIGHT = {
    plastic: [SURFACES.plastic({ variant: 'textured', color: [0.8, 0.8, 0.8] }), 0.8],
    coat: [SURFACES.powderCoat({ variant: 'cerakote', color: [0.82, 0.82, 0.82], roughness: 0.5 }), 0.82],
    board: [SURFACES.paper({ variant: 'cardboard', color: [0.85, 0.85, 0.85] }), 0.85],
    sawn: [SURFACES.wood({ variant: 'sawn', color: [0.8, 0.8, 0.8] }), 0.8],
  };
  const shade = (kind, rgb, { params, ...o } = {}) => {
    const [spec, k] = LIGHT[kind];
    return surf(spec, { size: 'small', ...o, params: { ...(rgb ? { color: new THREE.Color().setRGB(rgb[0] / k, rgb[1] / k, rgb[2] / k) } : {}), ...(params || {}) } });
  };
  return (ctx.shared.surf = { lib, surf, painted, shade, LIGHT, SURFACES, SIZE, tier });
}

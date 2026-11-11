// The district's materials, made once per world (ctx.shared.mats). Everything is procedural: no texture files.
// Ground and walls opt into @miragekit/core's wet layer (withWet), so the rain level set in main.js soaks them and
// pools puddles that the screen-space reflections then mirror. Lit windows, screens and holograms are emissive
// hooks scaled by the world's lamp gain (uLampGain), so they read the same at any exposure.
import * as THREE from 'three';
import { PROC, withWet } from '@miragekit/core';

// ---- facades: one window grid per style, lit rooms by a hash of the bay and the floor
const FACADE_DECL = /* glsl */ `
float ndGlass; vec3 ndLit; float ndH;
// (u along the wall, v up) for a vertical face
vec2 ndWallUV(vec3 p, vec3 n){ return abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y); }
// 1 inside the rectangle lo..hi of a cell's 0..1 coordinates, antialiased by the cell coordinate's derivative
float ndRect(vec2 f, vec2 g, vec2 lo, vec2 hi){
  vec2 w = max(fwidth(g), vec2(1e-4)) * 1.2, a = smoothstep(lo - w, lo + w, f), b = 1.0 - smoothstep(hi - w, hi + w, f);
  return a.x * a.y * b.x * b.y;
}
// a lit room: its colour and how bright, from the cell's hash; most rooms are dark
vec3 ndRoom(vec2 id, float seed, float share){
  float r = mgHash(vec3(id, seed)), on = step(1.0 - share, r), k = fract(r * 31.7);
  vec3 c = k < 0.55 ? vec3(1.0, 0.74, 0.46) : k < 0.85 ? vec3(0.62, 0.82, 1.0) : k < 0.94 ? vec3(1.0, 0.35, 0.7) : vec3(0.3, 1.0, 0.85);
  return c * on * (0.35 + 0.65 * fract(r * 57.3));
}`;
const facade = (style) => {
  const S = {
    // poured concrete, punched windows
    concrete: { bay: 2.6, floor: 3.3, lo: '0.2, 0.3', hi: '0.8, 0.8', base: 'vec3(0.105, 0.11, 0.12)', panes: 2, share: 0.24, gloss: 0.1, rough: 0.9 },
    // metal cladding, strip windows
    panel: { bay: 3.4, floor: 3.6, lo: '0.04, 0.38', hi: '0.96, 0.72', base: 'vec3(0.075, 0.085, 0.1)', panes: 4, share: 0.3, gloss: 0.08, rough: 0.55 },
    // a curtain wall: nearly all glass between thin mullions
    glass: { bay: 1.8, floor: 3.9, lo: '0.035, 0.05', hi: '0.965, 0.95', base: 'vec3(0.05, 0.055, 0.065)', panes: 1, share: 0.2, gloss: 0.05, rough: 0.4 },
  }[style];
  return {
    fragmentDecl: FACADE_DECL,
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
      ndGlass = 0.0; ndLit = vec3(0.0);
      float grime = mgFbm3(p * vec3(0.45, 0.12, 0.45), 4);
      ndH = grime;
      vec3 c = ${S.base} * (0.75 + 0.5 * grime);
      c *= 1.0 - 0.3 * smoothstep(0.2, 0.9, mgFbm3(p * vec3(2.1, 0.11, 2.1) + 7.0, 3));          // rain streaks down the wall
      if (abs(n.y) < 0.5) {
        vec2 uv = ndWallUV(p, n), g = uv / vec2(${S.bay.toFixed(2)}, ${S.floor.toFixed(2)}), id = floor(g), f = fract(g);
        float seed = dot(n, vec3(13.0, 0.0, 29.0));
        float w = ndRect(f, g, vec2(${S.lo}), vec2(${S.hi})) * step(4.4, p.y);                      // none on the ground storey
        // panel joints
        vec2 j = abs(f - 0.5) * 2.0;
        c *= 1.0 - 0.35 * (1.0 - w) * smoothstep(0.93, 0.99, max(j.x, j.y));
        vec3 room = ndRoom(id, seed, ${S.share.toFixed(2)});
        // inside a lit room: a ceiling strip brighter than the floor, a blind part-way down, a little furniture noise
        float blind = step(fract(mgHash(vec3(id, seed + 3.0)) * 9.1), 0.35) * smoothstep(0.55, 0.6, f.y);
        float inside = (0.35 + 0.65 * smoothstep(0.2, 0.95, f.y)) * (0.7 + 0.3 * mgValue2(uv * vec2(2.3, 5.0))) * (1.0 - 0.6 * blind);
        // glazing bars between the panes; they thin out with distance instead of crawling
        float q = abs(fract(f.x * ${S.panes.toFixed(1)}) - 0.5) / ${S.panes.toFixed(1)}, bars = smoothstep(0.004, 0.016, 0.5 / ${S.panes.toFixed(1)} - q);
        bars = mix(1.0, bars, clamp(1.0 - fwidth(g.x) * 45.0, 0.0, 1.0));
        ndLit = room * inside * w * bars;
        ndGlass = w * bars;
        c = mix(c, vec3(0.012, 0.016, 0.022), w * bars);
      }
      diffuseColor.rgb *= c; }`,
    roughness: `roughnessFactor = mix(${S.rough.toFixed(2)} + 0.08 * ndH, ${S.gloss.toFixed(2)}, ndGlass);`,
    metalness: 'metalnessFactor = mix(metalnessFactor, 0.0, ndGlass);',
    normal: 'normal = mgBump(normal, ndH * (1.0 - ndGlass), 0.01);',
    emissive: 'totalEmissiveRadiance += ndLit * (0.9 * uLampGain);',
  };
};

// ---- the ground
const ASPHALT = {
  fragmentDecl: 'float ndH; float ndPaint;',
  albedo: /* glsl */ `{
    vec2 p = mgWorldPos.xz;
    float coarse = mgFbm2(p * 0.35, 4), grit = mgValue2(p * 38.0), patchy = smoothstep(0.1, 0.5, mgFbm2(p * 0.11 + 9.0, 3));
    ndH = 0.55 * coarse + 0.25 * grit + 0.2 * mgValue2(p * 7.0);
    vec3 c = mix(vec3(0.03, 0.031, 0.034), vec3(0.052, 0.05, 0.05), patchy) * (0.75 + 0.5 * grit);
    // cracks: thin dark lines where two noise cells meet
    vec2 ce = mgCell2(p * 0.55);
    c *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.035, ce.y - ce.x));
    // road paint on the street's carriageway: a dashed centre line and two edge lines, worn
    float inRoad = step(3.6, p.y) * step(p.y, 8.4) * step(abs(p.x), 34.0);
    float wear = smoothstep(0.25, 0.7, mgFbm2(p * 1.7, 3) * 0.5 + 0.5);
    float aa = fwidth(p.y) * 1.5;
    float centre = (1.0 - smoothstep(0.06, 0.06 + aa, abs(p.y - 6.0))) * step(fract(p.x / 4.0), 0.5);
    float edges = 1.0 - smoothstep(0.05, 0.05 + aa, min(abs(p.y - 3.9), abs(p.y - 8.1)));
    ndPaint = inRoad * max(centre, edges) * wear;
    c = mix(c, vec3(0.5, 0.48, 0.4), ndPaint * 0.85);
    diffuseColor.rgb *= c; }`,
  roughness: 'roughnessFactor = 0.86 - 0.12 * ndPaint;',
  normal: 'normal = mgBump(normal, ndH, 0.006);',
};
const slabs = (size, base, joint) => ({
  fragmentDecl: 'float ndH; float ndJ;',
  albedo: /* glsl */ `{
    vec2 p = mgWorldPos.xz, g = p / ${size.toFixed(2)}, id = floor(g), f = abs(fract(g) - 0.5) * 2.0;
    float w = max(fwidth(g.x), fwidth(g.y)) * 2.0 + 0.02;
    ndJ = smoothstep(1.0 - ${joint.toFixed(3)} - w, 1.0 - ${joint.toFixed(3)} * 0.3, max(f.x, f.y));        // 1 in the joint
    float tone = mgHash(id), speck = mgValue2(p * 26.0), stain = mgFbm2(p * 0.4 + 3.0, 4);
    ndH = (1.0 - ndJ) * (0.7 + 0.1 * tone) + 0.2 * speck * (1.0 - ndJ);
    vec3 c = ${base} * (0.82 + 0.3 * tone) * (0.8 + 0.3 * speck) * (0.8 + 0.35 * stain);
    c *= 1.0 - 0.55 * ndJ;
    diffuseColor.rgb *= c; }`,
  roughness: 'roughnessFactor = mix(roughnessFactor, 0.95, ndJ);',
  normal: 'normal = mgBump(normal, ndH, 0.012);',
});

// ---- walls at eye level: board-marked concrete with tie holes, and ribbed metal sheet
const CONCRETE = {
  fragmentDecl: 'float ndH;',
  albedo: /* glsl */ `{
    vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
    vec2 uv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y));
    vec2 g = uv / vec2(2.4, 1.2), f = abs(fract(g) - 0.5) * 2.0;
    float seam = smoothstep(0.965, 0.995, max(f.x, f.y));
    vec2 q = fract(uv / vec2(1.2, 0.6)) - 0.5;
    float hole = 1.0 - smoothstep(0.02, 0.035, length(q * vec2(1.2, 0.6)));
    float big = mgFbm3(p * 0.6, 4), fine = mgValue3(p * 22.0);
    ndH = 0.5 * big + 0.2 * fine - 0.6 * seam - 0.8 * hole;
    vec3 c = vec3(0.17, 0.172, 0.18) * (0.72 + 0.45 * big) * (0.9 + 0.2 * fine);
    c *= 1.0 - 0.4 * seam - 0.6 * hole;
    c *= 1.0 - 0.32 * smoothstep(0.15, 0.85, mgFbm3(p * vec3(2.6, 0.13, 2.6) + 4.0, 3)) * (1.0 - abs(n.y));   // run-off
    c *= mix(0.62, 1.0, smoothstep(0.0, 1.0, p.y + 0.3 * big));                                                // a damp foot
    diffuseColor.rgb *= c; }`,
  normal: 'normal = mgBump(normal, ndH, 0.01);',
};
const RIBBED = (base) => ({
  fragmentDecl: 'float ndH;',
  albedo: /* glsl */ `{
    vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
    float u = abs(n.x) > 0.5 ? p.z : p.x;
    float rib = abs(fract(u / 0.22) - 0.5) * 2.0;
    ndH = smoothstep(0.25, 0.75, rib) * (1.0 - abs(n.y));
    float dirt = mgFbm3(p * vec3(1.3, 0.3, 1.3), 4);
    vec3 c = ${base} * (0.7 + 0.45 * dirt) * (0.85 + 0.15 * ndH);
    c = mix(c, vec3(0.16, 0.07, 0.035), 0.55 * smoothstep(0.25, 0.7, mgFbm3(p * vec3(3.0, 0.5, 3.0) + 11.0, 4)) * smoothstep(1.8, 0.0, p.y));
    diffuseColor.rgb *= c; }`,
  normal: 'normal = mgBump(normal, ndH, 0.012);',
});

// ---- screens: scrolling glyph rows, driven by the scene clock
const SCREEN = (tint) => ({
  fragmentDecl: 'vec3 ndE;',
  albedo: /* glsl */ `{
    vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
    vec2 uv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y));
    vec2 g = uv * vec2(34.0, 22.0); float row = floor(g.y);
    float sp = 0.6 + 2.4 * mgHash(vec2(row, 3.0));
    float col = floor(g.x + uTime * sp);
    float on = step(0.52, mgHash(vec2(col, row))) * step(mgHash(vec2(row, floor(uTime * 0.4))), 0.8);
    vec2 f = fract(vec2(g.x + uTime * sp, g.y));
    float dot_ = on * step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
    float fade = 1.0 / (1.0 + 0.02 * max(fwidth(g.x), fwidth(g.y)) * 40.0);
    ndE = ${tint} * (0.08 + mix(0.5, dot_, fade));
    diffuseColor.rgb *= vec3(0.01); }`,
  roughness: 'roughnessFactor = 0.12;',
  emissive: 'totalEmissiveRadiance += ndE * (1.3 * uLampGain);',
});

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  const wet = (hooks, o) => withWet(hooks, o);
  const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  // neon tubes and sign faces: display-referred colours x a gain (the bloom spreads them)
  const neon = (c, k = 9) => mat.glow(c, k);
  const NEON = {
    pink: [1.0, 0.16, 0.5], cyan: [0.1, 0.85, 1.0], amber: [1.0, 0.55, 0.12], violet: [0.55, 0.25, 1.0], green: [0.2, 1.0, 0.55],
    red: [1.0, 0.12, 0.1], white: [0.95, 0.95, 1.0], warm: [1.0, 0.72, 0.42],
  };
  const M = {
    NEON,
    asphalt: mat.std({ roughness: 0.86 }, wet(ASPHALT, { porosity: 0.35, puddles: 1.5, height: 'ndH', heightMid: 0.5, heightScale: 0.02 })),
    pavement: mat.std({ roughness: 0.82 }, wet(slabs(1.2, 'vec3(0.16, 0.16, 0.165)', 0.035), { porosity: 0.5, puddles: 0.9, height: 'ndH', heightMid: 0.6, heightScale: 0.014 })),
    plaza: mat.std({ roughness: 0.42 }, wet(slabs(0.9, 'vec3(0.075, 0.08, 0.09)', 0.02), { porosity: 0.2, puddles: 1.1, height: 'ndH', heightMid: 0.65, heightScale: 0.012 })),
    kerb: mat.std({ roughness: 0.8 }, wet(CONCRETE, { porosity: 0.6, puddles: 0 })),
    concrete: mat.std({ roughness: 0.88 }, wet(CONCRETE, { porosity: 0.8, puddles: 0, band: 0.5 })),
    concreteDry: mat.std({ roughness: 0.9 }, CONCRETE),                                              // indoors
    sheet: mat.std({ roughness: 0.5, metalness: 0.75 }, wet(RIBBED('vec3(0.2, 0.22, 0.25)'), { porosity: 0.1, puddles: 0 })),
    sheetRed: mat.std({ roughness: 0.55, metalness: 0.6 }, wet(RIBBED('vec3(0.3, 0.06, 0.05)'), { porosity: 0.1, puddles: 0 })),
    facade: { concrete: mat.std({ roughness: 0.9 }, facade('concrete')), panel: mat.std({ roughness: 0.55, metalness: 0.5 }, facade('panel')), glass: mat.std({ roughness: 0.4, metalness: 0.3 }, facade('glass')) },
    roofing: mat.std({ roughness: 0.92 }, wet({ fragmentDecl: 'float ndH;', albedo: 'ndH = mgFbm2(mgWorldPos.xz * 1.4, 4); diffuseColor.rgb *= vec3(0.045, 0.047, 0.052) * (0.7 + 0.6 * ndH);', normal: 'normal = mgBump(normal, ndH, 0.006);' }, { porosity: 0.3, puddles: 1.6, height: 'ndH', heightMid: 0.5 })),
    steel: mat.std({ metalness: 1, roughness: 0.34 }, PROC.brushed('vec3(0.34, 0.36, 0.4)', { axis: 'y', wear: 1.4 })),
    darkMetal: mat.std({ color: rgb(0.035, 0.038, 0.045), metalness: 0.9, roughness: 0.42 }),
    blackMetal: mat.std({ color: rgb(0.012, 0.013, 0.016), metalness: 0.8, roughness: 0.5 }),
    grate: mat.std({ color: rgb(0.02, 0.022, 0.026), metalness: 1, roughness: 0.35 }),
    yellow: mat.std({ color: rgb(0.55, 0.36, 0.03), roughness: 0.6, metalness: 0.2 }),
    rubber: mat.std({ color: rgb(0.012, 0.012, 0.013), roughness: 0.8 }),
    plastic: mat.std({ color: rgb(0.05, 0.055, 0.07), roughness: 0.45 }),
    crate: mat.std({ color: rgb(0.09, 0.11, 0.1), roughness: 0.6, metalness: 0.5 }),
    // glass you cannot walk through: the pane is not in the walk grid (transparent), a proxy box is
    glass: mat.std({ color: rgb(0.5, 0.65, 0.7), roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
    car: Object.fromEntries(Object.entries({ teal: [0.0, 0.14, 0.15], amber: [0.4, 0.14, 0.01], white: [0.42, 0.44, 0.46] }).map(([k, c]) =>
      [k, mat.phys({ color: rgb(...c), roughness: 0.32, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.08 })])),
    // interiors
    tile: mat.std({ roughness: 0.22 }, {
      fragmentDecl: 'float ndH;',
      albedo: `{ vec2 g = mgWorldPos.xz / 0.45, id = floor(g), f = abs(fract(g) - 0.5) * 2.0; float j = smoothstep(0.93, 0.98, max(f.x, f.y));
        ndH = 1.0 - j; float chk = mod(id.x + id.y, 2.0);
        diffuseColor.rgb *= mix(vec3(0.5, 0.46, 0.4), vec3(0.06, 0.05, 0.05), chk) * (0.85 + 0.2 * mgHash(id)) * (1.0 - 0.6 * j); }`,
      roughness: 'roughnessFactor = mix(0.2, 0.8, 1.0 - ndH);',
      normal: 'normal = mgBump(normal, ndH, 0.004);',
    }),
    plaster: mat.std({ roughness: 0.9 }, PROC.plaster('vec3(0.42, 0.3, 0.22)', { wear: 1.2, foot: 0.3 })),
    wood: mat.std({ roughness: 0.5 }, PROC.wood('vec3(0.2, 0.1, 0.05)', 'x')),
    lacquer: mat.std({ color: rgb(0.32, 0.02, 0.02), roughness: 0.18 }),
    paper: mat.std({ color: rgb(0.9, 0.55, 0.3), roughness: 0.9, emissive: rgb(1, 0.5, 0.2), emissiveIntensity: 0 }),
    relayFloor: mat.std({ roughness: 0.3, metalness: 0.4 }, slabs(0.6, 'vec3(0.1, 0.11, 0.13)', 0.03)),
    rack: mat.std({ color: rgb(0.02, 0.022, 0.028), metalness: 0.85, roughness: 0.38 }),
    screenCyan: mat.std({ roughness: 0.12 }, SCREEN('vec3(0.15, 0.9, 1.0)')),
    screenAmber: mat.std({ roughness: 0.12 }, SCREEN('vec3(1.0, 0.55, 0.12)')),
    screenPink: mat.std({ roughness: 0.12 }, SCREEN('vec3(1.0, 0.2, 0.55)')),
    paperGlow: neon([1.0, 0.62, 0.3], 0.9),
    neon: Object.fromEntries(Object.entries(NEON).map(([k, c]) => [k, neon(c)])),
    neonSoft: Object.fromEntries(Object.entries(NEON).map(([k, c]) => [k, neon(c, 1.5)])),   // large faces: a sign box, a light panel
  };
  // footsteps (the game layer reads userData.surface from the material)
  for (const k of ['wood']) M[k].userData.surface = 'wood';
  for (const k of ['steel', 'grate', 'sheet', 'relayFloor']) M[k].userData.surface = 'gravel';   // the nearest built-in: a rattle on metal
  return (ctx.shared.mats = M);
}

/** a hologram material: additive, scan lines that drift, a slow flicker; `tint` a GLSL vec3 expression */
export function holoMaterial(ctx, tint = 'vec3(0.15, 0.9, 1.0)', gain = 1) {
  return ctx.mat.patch(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }), {
    output: /* glsl */ `{
      vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
      float rim = pow(1.0 - abs(dot(V, N)), 1.5);
      float scan = 0.55 + 0.45 * sin(mgWorldPos.y * 90.0 - uTime * 6.0);
      float band = smoothstep(0.92, 1.0, sin(mgWorldPos.y * 1.7 + uTime * 1.3));
      float flick = 0.82 + 0.18 * step(0.12, mgHash(vec2(floor(uTime * 14.0), 5.0)));
      outgoingLight = ${tint} * (0.18 + 0.9 * rim + 0.5 * band) * scan * flick * (${gain.toFixed(2)} * max(uLampGain, 0.03));
    }`,
  });
}

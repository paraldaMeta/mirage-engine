// The district's materials, made once per world (ctx.shared.mats). Everything is procedural: no texture files. What
// a thing is made of comes from the engine's surface library (docs/surfaces.md: asphalt, paving, concrete, painted
// and powder-coated steel, stainless, glass, plastics, wood...; baked where that is cheaper); what stays here is the
// district's layout (road paint, ruts, kerb zones, the facades' window grid, screens). Ground and walls opt into @miragekit/core's wet layer (withWet), so the rain level set in main.js soaks them and
// pools puddles that the screen-space reflections then mirror. Lit windows, screens and holograms are emissive
// hooks scaled by the world's lamp gain (uLampGain), so they read the same at any exposure.
import * as THREE from 'three';
import { SURFACES } from '@miragekit/assets/surfaces';
import { surfaceLib } from '@miragekit/assets/kits/cyber';

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
    concrete: { bay: 2.6, floor: 3.3, lo: '0.2, 0.3', hi: '0.8, 0.8', base: 'vec3(0.25, 0.25, 0.26)', panes: 2, share: 0.24, gloss: 0.1, rough: 0.9 },
    // metal cladding, strip windows
    panel: { bay: 3.4, floor: 3.6, lo: '0.04, 0.38', hi: '0.96, 0.72', base: 'vec3(0.17, 0.19, 0.22)', panes: 4, share: 0.3, gloss: 0.08, rough: 0.55 },
    // a curtain wall: nearly all glass between thin mullions
    glass: { bay: 1.8, floor: 3.9, lo: '0.035, 0.05', hi: '0.965, 0.95', base: 'vec3(0.1, 0.11, 0.13)', panes: 1, share: 0.2, gloss: 0.05, rough: 0.4 },
  }[style];
  return {
    fragmentDecl: FACADE_DECL,
    albedo: /* glsl */ `{
      vec3 p = mgWorldPos, n = normalize(mgWorldNormal);
      ndGlass = 0.0; ndLit = vec3(0.0);
      float grime = mgFbm3(p * vec3(0.45, 0.12, 0.45), 4);
      ndH = grime;
      vec3 c = ${S.base} * (0.75 + 0.5 * grime);
      // paint: each face of a building its own colour (a hash of the face's plane), most of them muted
      float fk = mgHash(vec3(floor(dot(p, n) + 0.5), floor(n.x * 3.0 + n.z * 7.0 + 0.5), ${S.bay.toFixed(1)}));
      vec3 paint = fk < 0.2 ? vec3(1.25, 1.1, 0.88) : fk < 0.38 ? vec3(0.82, 1.08, 1.06) : fk < 0.52 ? vec3(1.2, 0.85, 0.72) : fk < 0.66 ? vec3(0.9, 0.95, 1.18) : fk < 0.74 ? vec3(1.15, 1.05, 0.6) : vec3(1.0);
      c *= mix(vec3(1.0), paint, ${style === 'glass' ? '0.35' : '0.85'});
      c *= 1.0 - 0.3 * smoothstep(0.2, 0.9, mgFbm3(p * vec3(2.1, 0.11, 2.1) + 7.0, 3));          // rain streaks down the wall
      if (abs(n.y) < 0.5) {
        vec2 uv = ndWallUV(p, n), g = uv / vec2(${S.bay.toFixed(2)}, ${S.floor.toFixed(2)}), id = floor(g), f = fract(g);
        float seed = dot(n, vec3(13.0, 0.0, 29.0));
        float w = ndRect(f, g, vec2(${S.lo}), vec2(${S.hi})) * step(4.4, p.y);                      // none on the ground storey
        // far away a window is a few pixels: the grid (joints, lit rooms, glass) goes over to its average before its
        // cells get smaller than about three pixels, so it cannot twinkle as the jitter moves it under the pixels
        float far = smoothstep(0.18, 0.5, max(fwidth(g.x), fwidth(g.y)));
        // panel joints
        vec2 j = abs(f - 0.5) * 2.0;
        c *= 1.0 - 0.35 * (1.0 - w) * smoothstep(0.93, 0.99, max(j.x, j.y)) * (1.0 - far);
        vec3 room = ndRoom(id, seed, ${S.share.toFixed(2)});
        c *= 0.9 + 0.2 * mgHash(vec3(id, seed + 9.0));                                                 // panels painted at different times
        float run = smoothstep(0.72, 0.95, mgValue2(vec2(uv.x * 4.0, id.y * 3.1 + seed))) * (1.0 - smoothstep(0.0, 0.42, ${S.lo.split(',')[1]} - f.y)) * step(f.y, ${S.lo.split(',')[1]}) * step(4.4, p.y);
        c = mix(c, vec3(0.16, 0.07, 0.03), 0.6 * run * (1.0 - w));                                      // rust run down from the sills
        // inside a lit room: a ceiling strip brighter than the floor, a blind part-way down, a little furniture noise
        float blind = step(fract(mgHash(vec3(id, seed + 3.0)) * 9.1), 0.35) * smoothstep(0.55, 0.6, f.y);
        float inside = (0.35 + 0.65 * smoothstep(0.2, 0.95, f.y)) * (0.7 + 0.3 * mgValue2(uv * vec2(2.3, 5.0))) * (1.0 - 0.6 * blind);
        // glazing bars between the panes; they thin out with distance instead of crawling
        float q = abs(fract(f.x * ${S.panes.toFixed(1)}) - 0.5) / ${S.panes.toFixed(1)}, bars = smoothstep(0.004, 0.016, 0.5 / ${S.panes.toFixed(1)} - q);
        bars = mix(1.0, bars, clamp(1.0 - fwidth(g.x) * 45.0, 0.0, 1.0));
        // (the averages: a share of lit rooms, their mean colour and brightness, the window's part of the cell)
        vec2 wa = vec2(${S.hi}) - vec2(${S.lo});
        float area = wa.x * wa.y * step(4.4, p.y);
        ndLit = mix(room * inside * w * bars, vec3(0.844, 0.745, 0.667) * (${S.share.toFixed(2)} * 0.675 * 0.5 * area), far);
        ndGlass = mix(w * bars, 0.9 * area, far);
        c = mix(c, vec3(0.012, 0.016, 0.022), ndGlass);
      }
      diffuseColor.rgb *= c; }`,
    roughness: `roughnessFactor = mix(${S.rough.toFixed(2)} + 0.08 * ndH, ${S.gloss.toFixed(2)}, ndGlass);`,
    metalness: 'metalnessFactor = mix(metalnessFactor, 0.0, ndGlass);',
    normal: 'normal = mgBump(normal, ndH * (1.0 - ndGlass), 0.01);',
    emissive: 'totalEmissiveRadiance += ndLit * (0.9 * uLampGain);',
  };
};

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
    float fade = 1.0 - smoothstep(0.2, 0.55, max(fwidth(g.x), fwidth(g.y)));   // the dots go to their average under ~4 px a cell
    ndE = ${tint} * (0.08 + mix(0.5, dot_, fade));
    diffuseColor.rgb *= vec3(0.01); }`,
  roughness: 'roughnessFactor = 0.12;',
  emissive: 'totalEmissiveRadiance += ndE * (1.3 * max(uLampGain, 0.1));   // a screen is on by day too',
});

// ---- the district's layout in the ground: road paint and where the water gathers (the surfaces themselves come
// from the engine's library, docs/surfaces.md)
const LINES_DECL = /* glsl */ `
float ndLines(vec2 p){
  float inRoad = step(3.6, p.y) * step(p.y, 8.4) * step(abs(p.x), 34.0);
  float aa = fwidth(p.y) * 1.5;
  float centre = (1.0 - smoothstep(0.06, 0.06 + aa, abs(p.y - 6.0))) * step(fract(p.x / 4.0), 0.5);
  float edges = 1.0 - smoothstep(0.05, 0.05 + aa, min(abs(p.y - 3.9), abs(p.y - 8.1)));
  float zebra = step(abs(p.x - 18.0), 2.2) * step(fract(p.y / 0.9), 0.52) * step(4.1, p.y) * step(p.y, 7.9);
  float stop = step(abs(abs(p.x - 18.0) - 3.4), 0.15) * step(3.9, p.y) * step(p.y, 8.1);
  return inRoad * max(max(centre * (1.0 - step(abs(p.x - 18.0), 3.6)), edges), max(zebra, stop));
}`;
// water gathers in the two wheel ruts along the street and in the gutters by the kerbs
const RUTS = 'max(smoothstep(0.5, 0.0, abs(abs(mgWorldPos.z - 6.0) - 1.3)), 0.8 * smoothstep(0.55, 0.0, min(abs(mgWorldPos.z - 2.5), abs(mgWorldPos.z - 9.5))))';
// the kerb's painted zones (yellow and black at the crossing, the bus stop, the hydrant), worn
const KERB_PAINT = /* glsl */ `{ vec3 p = msPW;
  float zone = min(step(abs(p.x - 18.0), 4.4) + step(abs(p.x + 22.0), 2.4) + step(abs(p.x - 7.0), 1.6), 1.0);
  float seg = step(0.5, fract((p.x + p.z) / 0.9)), wr = smoothstep(0.25, 0.6, mgFbm3(p * 2.3, 3) * 0.5 + 0.5), k = zone * wr;
  msAlb = mix(msAlb, mix(vec3(0.55, 0.4, 0.02), vec3(0.03), seg), k); msR = mix(msR, 0.62, k); }`;
// hazard stripes over yellow paint (the edge wear's bare steel stays bare)
const HAZARD = /* glsl */ `{ vec3 p = msPW, n = msNWorld; float u = abs(n.y) > 0.5 ? p.x + p.z : (abs(n.x) > 0.5 ? p.z : p.x);
  float s = step(0.5, fract((u + p.y) / 0.32)) * (1.0 - msM); msAlb = mix(msAlb, vec3(0.03) * (0.9 + 0.2 * msH), s); }`;

// the district's surface library (surf, painted, shade; one per world, ctx.shared.surf) is the cyber kit's
export { surfaceLib } from '@miragekit/assets/kits/cyber';

export function materials(ctx) {
  if (ctx.shared.mats) return ctx.shared.mats;
  const { mat } = ctx;
  const { surf, lib, shade } = surfaceLib(ctx);
  const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  // neon tubes: the library's tube (a glass tube round a saturated gas column; a trace of it by day); large sign
  // faces stay display-referred colours x a gain (the bloom spreads them)
  const glow = (c, k = 9) => mat.glow(c, k);
  const NEON = {
    pink: [1.0, 0.16, 0.5], cyan: [0.1, 0.85, 1.0], amber: [1.0, 0.55, 0.12], violet: [0.55, 0.25, 1.0], green: [0.2, 1.0, 0.55],
    red: [1.0, 0.12, 0.1], white: [0.95, 0.95, 1.0], warm: [1.0, 0.72, 0.42],
  };
  // the dark structural metal: black powder coat (a dielectric with a satin sheen, steel at worn edges), not a black
  // mirror; blackMetal is the same set a shade darker (a tint: no second bake)
  const POWDER = SURFACES.powderCoat({ variant: 'powder', color: [0.045, 0.047, 0.052] });
  const SHEET = (color) => SURFACES.corrugated({ variant: 'painted', color, pitch: 0.22, profile: 'box', rust: 0.35, chips: 0.3, gravity: [-1, 0], stencil: 1, dents: 0.5 });   // (grain 'y': u up, the fall down u)
  const CONCRETE = SURFACES.concrete({ variant: 'cast', panel: [2.4, 1.2], tieSpacing: 0.6, age: 0.6 });
  const SHEET_DECALS = { rills: { top: 2.6, length: 1.1, density: 0.5 }, leaks: { spacing: 1.52 } };
  const M = {
    NEON,
    asphalt: surf(SURFACES.asphalt({ variant: 'worn', cracks: 0.5, oil: 0.25 }),
      { mapping: 'ground', size: 'big', paint: 'ndLines(msPW.xz)', paintColor: [0.5, 0.48, 0.4], paintWear: 0.55, wet: { puddles: 1.5, ripples: 1.3, specAA: 2.5, wear: RUTS } }, { decl: LINES_DECL }),
    pavement: surf(SURFACES.paving({ variant: 'slabs', cell: [0.6, 0.6], color: [0.27, 0.27, 0.275] }), { mapping: 'ground', wet: { puddles: 0.9, specAA: 2.5 } }),
    plaza: surf(SURFACES.paving({ variant: 'polished', color: [0.12, 0.125, 0.14], cell: [0.9, 0.9] }), { mapping: 'ground', wet: { puddles: 1.1, ripples: 1.3, specAA: 2.5 } }),
    kerb: surf(SURFACES.concrete({ variant: 'precast', panel: [0.9, 0.3], color: [0.36, 0.355, 0.34], age: 0.5 }), { mapping: 'wall', size: 'small', wet: { puddles: 0 } }, { post: KERB_PAINT }),
    concrete: surf(CONCRETE, { mapping: 'wall', size: 'big', wet: { puddles: 0, band: 0.5 }, decals: { damp: 0.55, rills: { top: 3.2, length: 1.4, density: 0.55 }, stains: 0.35, cracks: 0.25, soot: 0.15 } }),
    concreteDry: surf(CONCRETE, { mapping: 'wall', size: 'big', decals: { cracks: 0.2, stains: 0.2 } }),                                    // indoors
    sheet: surf(SHEET([0.32, 0.34, 0.38]), { mapping: 'wall', grain: 'y', wet: { puddles: 0 }, decals: SHEET_DECALS }),
    sheetRed: surf(SHEET([0.42, 0.1, 0.08]), { mapping: 'wall', grain: 'y', wet: { puddles: 0 }, decals: SHEET_DECALS }),
    facade: { concrete: mat.std({ roughness: 0.9, metalness: 0 }, facade('concrete')), panel: mat.std({ roughness: 0.55, metalness: 0 }, facade('panel')), glass: mat.std({ roughness: 0.4, metalness: 0 }, facade('glass')) },
    roofing: surf(SURFACES.roofing({ variant: 'felt' }), { mapping: 'ground', wet: { puddles: 1.6 } }),
    // brushed stainless, its grain up the part (posts, hoods, rails)
    steel: surf(SURFACES.stainless({ variant: 'brushed' }), { mapping: 'grain', grain: [0, 1, 0] }),
    darkMetal: surf(POWDER, { size: 'small' }),
    blackMetal: surf(POWDER, { size: 'small', params: { color: rgb(0.7, 0.7, 0.7) } }),
    grate: surf(SURFACES.castIron({ variant: 'grate' }), { mapping: 'ground', size: 'small' }),
    yellow: surf(SURFACES.paintedMetal({ variant: 'sheet', color: [0.6, 0.42, 0.02], chips: 0.5, rust: 0.45 }), { size: 'small' }, { post: HAZARD }),
    rubber: surf(SURFACES.rubber({ variant: 'moulded' })),
    plastic: shade('plastic', [0.05, 0.055, 0.07]),
    crate: shade('coat', [0.09, 0.11, 0.1]),
    // glass you cannot walk through: the pane is not in the walk grid (transparent), a proxy box is. Fresnel: the
    // street mirrored at grazing angles, the room behind straight on; shop windows are dirtier
    glass: lib.material(SURFACES.glass({ variant: 'clear', dirt: 0.12 })),
    glassDirty: lib.material(SURFACES.glass({ variant: 'dirty', dirt: 0.35 })),
    car: Object.fromEntries(Object.entries({ teal: [0.0, 0.14, 0.15], amber: [0.4, 0.14, 0.01], white: [0.42, 0.44, 0.46] }).map(([k, c]) =>
      [k, surf(SURFACES.carPaint({ variant: 'metallic', color: c }), { space: 'object' })])),
    // interiors
    tile: surf(SURFACES.tile({ variant: 'floor', cell: [0.45, 0.45], color: [0.5, 0.46, 0.4], alt: 1, altColor: [0.06, 0.05, 0.05], roughness: 0.25 }), { mapping: 'ground' }),
    plaster: surf(SURFACES.render({ variant: 'smooth', color: [0.42, 0.3, 0.22], cracks: 0.3 }), { mapping: 'wall', size: 'small', decals: { damp: 0.35, stains: 0.3 } }),
    wood: surf(SURFACES.wood({ variant: 'planks', color: [0.2, 0.1, 0.05] }), { mapping: 'grain', grain: [1, 0, 0], size: 'small' }),
    lacquer: surf(SURFACES.wood({ variant: 'varnished', color: [0.32, 0.02, 0.02], roughness: 0.18 }), { mapping: 'grain', grain: [1, 0, 0], size: 'small' }),
    paper: shade('board', [0.8, 0.5, 0.28], { params: { emissive: rgb(1, 0.5, 0.2), emissiveIntensity: 0 } }),
    relayFloor: surf(SURFACES.aluminium({ variant: 'tread', color: [0.62, 0.63, 0.64] }), { mapping: 'ground' }),
    rack: surf(POWDER, { size: 'small', params: { color: rgb(0.68, 0.68, 0.7) } }),
    screenCyan: mat.std({ roughness: 0.12, metalness: 0 }, SCREEN('vec3(0.15, 0.9, 1.0)')),
    screenAmber: mat.std({ roughness: 0.12, metalness: 0 }, SCREEN('vec3(1.0, 0.55, 0.12)')),
    screenPink: mat.std({ roughness: 0.12, metalness: 0 }, SCREEN('vec3(1.0, 0.2, 0.55)')),
    paperGlow: glow([1.0, 0.62, 0.3], 0.9),
    // (low: the plain glow, a few ALU fewer per pixel where the tubes fill the view)
    neon: Object.fromEntries(Object.entries(NEON).map(([k, c]) => [k, ctx.shared.tier === 'low' ? glow(c) : lib.material(SURFACES.neon({ color: c, intensity: 9 }))])),
    neonSoft: Object.fromEntries(Object.entries(NEON).map(([k, c]) => [k, glow(c, 1.5)])),   // large faces: a sign box, a light panel
  };
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

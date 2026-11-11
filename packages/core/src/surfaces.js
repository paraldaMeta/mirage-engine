// Mirage original code.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { hash32 } from './rng.js';
import { withWet } from './wet.js';
import { MS_COMMON, KIND_GLSL, LIVE_GLSL } from './surface-glsl.js';

// ---------------------------------------------------------------------------
// The surface library: physically plausible materials made in code, for any project.
//
//   import { SURFACES, createSurfaces } from '@miragekit/core';
//   const lib = createSurfaces(world);                           // baked by default (falls back to procedural)
//   const wall = lib.material(SURFACES.concrete({ variant: 'cast', age: 0.5 }), { mapping: 'wall', wet: true });
//   const deck = lib.material(SURFACES.wood({ variant: 'planks' }), { mapping: 'grain', grain: [1, 0, 0] });
//
// A surface is a recipe (surface-glsl.js) plus numbers. Two paths behind one call:
//   procedural  the recipe runs per pixel (its octaves cut by the pixel's footprint: far pixels cost less)
//   baked       the recipe is rendered once into a tileable texture set on the GPU (albedo + roughness, normal +
//               height + metalness; mipmapped, anisotropic), sampled with the same mapping, a repetition breaker and
//               the same world-space macro layer on top. Several times cheaper per pixel. Deterministic (seeded).
// Both go through patch(): lighting, shadows, image-based light, fog, the wet layer (withWet, porosity from the
// kind), planar and screen-space reflections, probes and the lamp pool all keep working.
//
// Runtime layer (both paths, live uniforms; not baked): macro variation in world space (hides the tile), dirt in
// cavities / at the foot / on top faces, run-off streaks (age), edge wear from the surface's curvature or a vertex
// attribute, weathering decals placed by rules (rills under a ledge, damp at the base, leaks under fixings, stains,
// soot, cracks), the asphalt's road paint.
// ---------------------------------------------------------------------------

const lin = (c, d) => {
  if (c == null) return d;
  if (Array.isArray(c)) return c.map(Number);
  const k = new THREE.Color(c); return [k.r, k.g, k.b];
};
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
const snap = (T, s) => T / Math.max(1, Math.round(T / s));
// gravity in the surface's own plane (u, v), snapped to an axis (rotations by quarter turns keep the tile periodic):
// [0, -1] = down v (a wall under 'wall' mapping); [-1, 0] = down u (a sheet mapped with grain: 'y', u up)
const fall = (g) => { const [x, y] = Array.isArray(g) ? g.map(Number) : [0, -1]; return Math.abs(x) > Math.abs(y) ? [Math.sign(x), 0] : [0, y > 0 ? 1 : -1]; };

// ---- the kinds ------------------------------------------------------------------------------------------------------
// tile (m), depth (m: height 0..1 spans it), size (bake px), porosity (withWet), refs: measured ranges the defaults
// sit in (linear albedo or F0, roughness, metalness), quantum: the repetition breaker's offset step (m, the pattern's
// module), edge: what worn edges expose, dirt: the grime colour.
const DIRT = [0.11, 0.095, 0.08];
// the footstep sound a family walks with (@miragekit/game's surfaces; metal rattles like gravel)
const FOOTSTEP = { wood: 'wood', metal: 'gravel', coating: 'gravel', composite: 'gravel', ground: 'stone', masonry: 'stone', ceramic: 'stone' };
const STEEL = [0.53, 0.53, 0.54];
const KINDS = {
  concrete: {
    micro: [0.003, 0.06, 0.25, 0.05], family: 'masonry', variants: ['cast', 'boardFormed', 'painted', 'precast'], tile: 2.4, depth: 0.006, size: 1024, porosity: 0.8,
    refs: { albedo: [0.18, 0.42], rough: [0.75, 0.95], metal: 0, note: 'Portland cement concrete 0.20-0.40 (fresh grey ~0.35, weathered 0.20-0.30)', variants: { painted: { albedo: [0.03, 0.85], rough: [0.5, 0.95], metal: 0, note: 'masonry paint as its pigment (white 0.70-0.85), satin 0.55-0.7' } } },
    defaults: { color: [0.33, 0.32, 0.3], roughness: 0.88, panel: [2.4, 1.2], tieSpacing: 0.6, boardHeight: 0.15, paint: [0.62, 0.6, 0.55], peel: 0.35, aggregate: 0.6, pores: 0.6, coldJoint: 0, efflorescence: 0 },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.panel[0], o.panel[1], o.tieSpacing, o.boardHeight], C: [...o.paint, o.peel], D: [o.aggregate, o.pores, o.coldJoint, o.efflorescence] }),
    quantum: (o, T, v) => (v === 1 ? [T, snap(T, o.boardHeight)] : [snap(T, o.panel[0]), snap(T, o.panel[1])]),
    edge: (o) => ({ rgb: [1.12, 1.1, 1.06], rough: 0.95, metal: 0, mode: 1, chip: 0.02 }),
  },
  asphalt: {
    micro: [0.002, 0.12, 0.3, 0.06], family: 'ground', variants: ['fresh', 'worn', 'patched'], tile: 1.2, depth: 0.005, size: 1024, porosity: 0.35,
    refs: { albedo: [0.03, 0.16], rough: [0.3, 0.95], metal: 0, note: 'binder 0.03-0.06; aggregate 0.10-0.30; worn surface overall 0.08-0.14; crack sealant (tar) glossy 0.3-0.4' },
    defaults: { color: [0.042, 0.041, 0.04], roughness: 0.88, stone: [0.2, 0.2, 0.19], stoneSize: 0.011, patch: 1, cracks: 0.5, oil: 0, polish: 0.5 },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [...o.stone, o.stoneSize], C: [o.patch, o.cracks, o.oil, o.polish], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.25, 1.25, 1.25], rough: 0.9, metal: 0, mode: 1, chip: 0.03 }),
  },
  paving: {
    micro: [0.003, 0.06, 0.2, 0.05], family: 'ground', variants: ['slabs', 'setts', 'polished', 'hex'], tile: 2.4, depth: 0.012, size: 1024, porosity: 0.5,
    refs: { albedo: [0.08, 0.42], rough: [0.1, 0.95], metal: 0, note: 'concrete flags 0.25-0.35, granite setts 0.10-0.30, polished granite 0.08-0.40 (roughness 0.10-0.30)' },
    defaults: { color: [0.3, 0.29, 0.27], roughness: 0.82, cell: [0.6, 0.6], joint: 0.008, shift: 0, jointColor: [0.1, 0.085, 0.07], tilt: 0.25, chips: 0.5, speckle: 1 },
    variantDefaults: { setts: { cell: [0.2, 0.1], joint: 0.012, shift: 0.5, color: [0.2, 0.19, 0.18], roughness: 0.78 }, polished: { color: [0.16, 0.16, 0.17], roughness: 0.2, cell: [0.6, 0.6], joint: 0.003 }, hex: { cell: [0.27, 0.27], joint: 0.008 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.cell[0], o.cell[1], o.joint, o.shift], C: [...o.jointColor, o.tilt], D: [o.chips, o.speckle, 0, 0] }),
    quantum: (o, T, v) => (v === 3 ? [snap(T, o.cell[0]), 2 * T / Math.max(2, 2 * Math.round(T / (o.cell[0] * 0.866) / 2))] : [snap(T, o.cell[0]), snap(T, o.cell[1]) * (o.shift ? 2 : 1)]),
    edge: () => ({ rgb: [1.15, 1.15, 1.12], rough: 0.95, metal: 0, mode: 1, chip: 0.02 }),
  },
  brick: {
    micro: [0.003, 0.06, 0.15, 0.04], family: 'masonry', variants: ['common', 'engineering', 'painted', 'stock'], tile: 2.25, depth: 0.02, size: 1024, porosity: 0.7,
    refs: { albedo: [0.06, 0.45], rough: [0.5, 0.95], metal: 0, note: 'red clay brick R 0.20-0.40; engineering blue 0.05-0.10 (dense, roughness ~0.6); London stock ~(0.40, 0.30, 0.17); lime mortar 0.35-0.55', variants: { painted: { albedo: [0.03, 0.85], rough: [0.5, 0.95], metal: 0, note: 'masonry paint over brick' } } },
    defaults: { color: [0.32, 0.12, 0.07], roughness: 0.82, brick: [0.225, 0.075], mortar: 0.01, recess: 0.008, mortarColor: [0.44, 0.42, 0.38], burnt: 0.12, paint: [0.7, 0.7, 0.68], peel: 0.3 },
    variantDefaults: { engineering: { color: [0.075, 0.065, 0.075], mortarColor: [0.25, 0.25, 0.25], burnt: 0.05 }, stock: { color: [0.42, 0.31, 0.17], burnt: 0.18 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.brick[0], o.brick[1], o.mortar, Math.min(1, o.recess / 0.02)], C: [...o.mortarColor, o.burnt], D: [...o.paint, o.peel] }),
    quantum: (o, T) => [snap(T, o.brick[0]), 2 * snap(T, o.brick[1])],
    edge: () => ({ rgb: [1.1, 1.08, 1.05], rough: 0.95, metal: 0, mode: 1, chip: 0.02 }),
  },
  render: {
    micro: [0.002, 0.05, 0.3, 0.04], family: 'masonry', variants: ['smooth', 'pebbledash', 'roughcast'], tile: 2.0, depth: 0.008, size: 1024, porosity: 0.75,
    refs: { albedo: [0.3, 0.8], rough: [0.75, 0.95], metal: 0, note: 'cement / lime render 0.40-0.75; painted white ~0.75' },
    defaults: { color: [0.55, 0.52, 0.46], roughness: 0.88, cracks: 0.3, patches: 0, patchColor: [0.6, 0.58, 0.52], spall: 0 },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.spall, o.cracks, o.patches, 0], C: [...o.patchColor, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [0.85, 0.85, 0.85], rough: 0.95, metal: 0, mode: 1, chip: 0.03 }),
  },
  tile: {
    cheap: true, family: 'ceramic', variants: ['subway', 'square', 'mosaic', 'floor'], tile: 1.2, depth: 0.004, size: 1024, porosity: 0.1,
    refs: { albedo: [0.03, 0.85], rough: [0.04, 0.95], metal: 0, note: 'white glaze 0.70-0.85 (roughness 0.05-0.15); grout 0.30-0.60' },
    defaults: { color: [0.78, 0.78, 0.76], roughness: 0.08, cell: [0.15, 0.075], grout: 0.003, bevel: 0.006, groutColor: [0.42, 0.41, 0.39], alt: 0, altColor: [0.05, 0.05, 0.055], crazing: 0 },
    variantDefaults: { square: { cell: [0.15, 0.15], bevel: 0.002 }, mosaic: { cell: [0.025, 0.025], grout: 0.0025, bevel: 0.001, color: [0.2, 0.42, 0.45] }, floor: { cell: [0.3, 0.3], grout: 0.004, bevel: 0.001, roughness: 0.55, altColor: [0.05, 0.05, 0.05] } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.cell[0], o.cell[1], o.grout, o.bevel], C: [...o.groutColor, o.alt], D: [...o.altColor, o.crazing] }),
    quantum: (o, T, v) => [snap(T, o.cell[0]) * (v === 3 ? 2 : 1), snap(T, o.cell[1]) * 2],
    edge: () => ({ rgb: [0.9, 0.9, 0.9], rough: 0.3, metal: 0, mode: 1, chip: 0.01 }),
  },
  corrugated: {
    micro: [0.002, 0.04, 0.04, 0.05], family: 'metal', variants: ['galvanised', 'painted', 'rusted'], tile: 1.52, depth: 0.018, size: 1024, porosity: 0.1,
    refs: { albedo: [0.05, 0.7], rough: [0.25, 0.95], metal: 'zinc 1 / paint 0 / rust 0', note: 'zinc F0 ~(0.62, 0.64, 0.66); rust 0.10-0.35 (R)' },
    defaults: { color: [0.17, 0.24, 0.27], roughness: 0.6, pitch: 0.076, sheet: 0.76, fixings: 0.38, profile: 'sine', rust: 0.3, chips: 0.2, whiteRust: 0.3, gravity: [0, -1] },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.pitch, o.sheet, o.fixings, o.profile === 'box' ? 1 : 0], C: [o.rust, o.chips, o.whiteRust, 0], D: [...fall(o.gravity), 0, 0] }),
    quantum: (o, T) => [snap(T, o.sheet), snap(T, o.fixings)],
    edge: (o, v) => (v === 1 ? { rgb: [0.6, 0.62, 0.64], rough: 0.45, metal: 1, mode: 0, chip: 0.012 } : { rgb: [0.2, 0.08, 0.03], rough: 0.9, metal: 0, mode: 0, chip: 0.015 }),
  },
  paintedMetal: {
    micro: [0.002, 0.02, 0.2, 0.03], family: 'metal', variants: ['sheet', 'panels', 'enamel'], tile: 2.0, depth: 0.003, size: 1024, porosity: 0.1,
    refs: { albedo: [0.03, 0.85], rough: [0.15, 0.92], metal: 'paint 0 / bare steel 1 / rust 0', note: 'paint as its pigment (white 0.70-0.85, black 0.03-0.05); bare steel F0 (0.53, 0.53, 0.54); red-oxide primer ~(0.25, 0.08, 0.05)' },
    defaults: { color: [0.3, 0.33, 0.36], roughness: 0.45, primer: [0.24, 0.08, 0.05], chips: 0.35, panel: [1.0, 1.0], boltSpacing: 0.15, rust: 0.5, streaks: 0.5, gloss: 0, gravity: [0, -1] },
    variantDefaults: { enamel: { roughness: 0.25, gloss: 0.5 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [...o.primer, o.chips], C: [o.panel[0], o.panel[1], o.boltSpacing, o.rust], D: [o.streaks, o.gloss, ...fall(o.gravity)] }),
    quantum: (o, T) => [snap(T, o.panel[0]), snap(T, o.panel[1])],
    edge: (o) => ({ rgb: STEEL, rough: 0.42, metal: 1, mode: 0, chip: 0.012 }),
  },
  stainless: {
    cheap: true, family: 'metal', variants: ['brushed', 'polished', 'blasted'], tile: 0.6, depth: 0.0006, size: 1024, porosity: 0.05,
    refs: { albedo: [0.5, 0.7], rough: [0.03, 0.5], metal: 1, note: 'stainless steel F0 ~(0.58, 0.58, 0.56); brushed roughness 0.25-0.40, polished 0.04-0.10' },
    defaults: { color: [0.58, 0.58, 0.56], roughness: 0.3, grain: 0.3, scratches: 0.4, swirls: 0.5 },
    variantDefaults: { polished: { roughness: 0.06 }, blasted: { roughness: 0.42 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.grain, o.scratches, o.swirls, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.05, 1.05, 1.05], rough: 0.15, metal: 1, mode: 1, chip: 0.01 }),
  },
  galvanised: {
    micro: [0.002, 0.03, 0.3, 0.05], family: 'metal', variants: ['new', 'weathered'], tile: 1.0, depth: 0.0006, size: 512, porosity: 0.05,
    refs: { albedo: [0.4, 0.72], rough: [0.25, 0.95], metal: 'zinc 1 / white rust 0', note: 'zinc F0 ~(0.62, 0.64, 0.66); patina ~0.42; white rust ~0.6 dielectric' },
    defaults: { color: [0.62, 0.64, 0.66], roughness: 0.38, spangle: 0.014, whiteRust: 0.25 },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.spangle, o.whiteRust, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.06, 1.06, 1.06], rough: 0.3, metal: 1, mode: 1, chip: 0.01 }),
  },
  castIron: {
    micro: [0.002, 0.05, 0.06, 0.05], family: 'metal', variants: ['manhole', 'plain', 'grate'], tile: 0.8, depth: 0.012, size: 1024, porosity: 0.2,
    refs: { albedo: [0.006, 0.55], rough: [0.3, 0.95], metal: 'worn tops 1 / rust and grime 0', note: 'cast iron F0 ~(0.45, 0.44, 0.43), darker than wrought; rust 0.10-0.35', variants: { grate: { albedo: [0.0, 0.55], rough: [0.3, 0.95], metal: 'bars 1 / openings 0', note: 'a grate is half openings (near black)' } } },
    defaults: { color: [0.45, 0.44, 0.43], roughness: 0.35, rustColor: [0.2, 0.08, 0.035], rust: 0.5, diameter: 0.7, pitch: 0.035 },
    variantDefaults: { grate: { pitch: 0.04 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [...o.rustColor, o.rust], C: [o.diameter, o.pitch, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T, v) => (v === 0 ? [T, T] : [0, 0]),
    edge: () => ({ rgb: [0.45, 0.44, 0.43], rough: 0.3, metal: 1, mode: 0, chip: 0.01 }),
  },
  aluminium: {
    family: 'metal', variants: ['anodised', 'extruded', 'tread', 'cast'], tile: 0.6, depth: 0.003, size: 1024, porosity: 0.05,
    refs: { albedo: [0.4, 0.95], rough: [0.2, 0.8], metal: 'aluminium 1 / a white oxide bloom over it 0', note: 'aluminium F0 (0.91, 0.92, 0.92); anodised: the dye tints it' },
    defaults: { color: [0.91, 0.92, 0.92], roughness: 0.32, treadPitch: 0.03, oxide: 0.1 },
    variantDefaults: { anodised: { color: [0.5, 0.52, 0.56], roughness: 0.35 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.treadPitch, o.oxide, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T, v) => (v === 2 ? [2 * snap(T, o.treadPitch), 2 * snap(T, o.treadPitch)] : [0, 0]),
    edge: () => ({ rgb: [0.91, 0.92, 0.92], rough: 0.25, metal: 1, mode: 0, chip: 0.008 }),
  },
  chrome: {
    cheap: true, family: 'metal', variants: ['new', 'pitted'], tile: 0.5, depth: 0.0005, size: 512, porosity: 0.02,
    refs: { albedo: [0.5, 0.6], rough: [0.02, 0.12], metal: 1, note: 'chromium F0 (0.55, 0.56, 0.55)' },
    defaults: { color: [0.55, 0.56, 0.55], roughness: 0.04, pitting: 0, spots: 0.4 },
    variantDefaults: { pitted: { pitting: 0.6 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.pitting, o.spots, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1, 1, 1], rough: 0.03, metal: 1, mode: 1, chip: 0.01 }),
  },
  metal: {
    cheap: true, family: 'metal', variants: ['machined', 'cast', 'worn'], tile: 0.5, depth: 0.0006, size: 512, porosity: 0.05,
    refs: { albedo: [0.4, 1.0], rough: [0.05, 0.7], metal: 1, note: 'F0 by metal: iron (0.53, 0.51, 0.50), copper (0.96, 0.64, 0.54), brass (0.91, 0.78, 0.42), gold (1.0, 0.77, 0.34), titanium (0.54, 0.50, 0.45), nickel (0.65, 0.61, 0.54), silver (0.97, 0.96, 0.92), zinc (0.62, 0.64, 0.66)' },
    defaults: { metal: 'steel', color: null, roughness: 0.3, tarnishColor: [0.6, 0.55, 0.45], tarnish: 0.2 },
    pack: (o) => ({ A: [...(o.color || METALS[o.metal] || METALS.steel), o.roughness], B: [...o.tarnishColor, o.tarnish], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.05, 1.05, 1.05], rough: 0.15, metal: 1, mode: 1, chip: 0.008 }),
  },
  powderCoat: {
    family: 'coating', variants: ['powder', 'cerakote', 'wrinkle'], tile: 0.5, depth: 0.0015, size: 512, porosity: 0.05,
    refs: { albedo: [0.02, 0.85], rough: [0.3, 0.75], metal: 'coat 0 / worn edges 1', note: 'a dielectric coat: black powder coat 0.03-0.05, not a dark metal; worn edges show the metal under it' },
    defaults: { color: [0.035, 0.037, 0.042], roughness: 0.45, peel: 0.004, bare: STEEL },
    variantDefaults: { cerakote: { roughness: 0.58 }, wrinkle: { peel: 0.0025, roughness: 0.55 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.peel, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: (o) => ({ rgb: lin(o.bare, STEEL), rough: 0.35, metal: 1, mode: 0, chip: 0.008 }),
  },
  carPaint: {
    cheap: true, family: 'coating', variants: ['solid', 'metallic', 'pearl', 'matte'], tile: 0.3, depth: 0.00015, size: 1024, porosity: 0.0, physical: true,
    refs: { albedo: [0.02, 0.85], rough: [0.05, 0.6], metal: 'binder 0 / flakes 1 (their share at range)', note: 'base coat as its pigment, a clear coat (F0 0.04, roughness 0.02-0.08) on top; metallic: aluminium flakes' },
    defaults: { color: [0.03, 0.12, 0.14], flakes: 0.35, flakeColor: [0.75, 0.76, 0.78], flakeSize: 0.00045, swirls: 0.3, clearcoatRoughness: 0.04 },
    pack: (o) => ({ A: [...o.color, o.flakes], B: [...o.flakeColor, o.flakeSize], C: [o.swirls, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [0.25, 0.25, 0.26], rough: 0.6, metal: 0, mode: 0, chip: 0.005 }),
    material: (o, v) => ({ clearcoat: v === 3 ? 0 : 1, clearcoatRoughness: o.clearcoatRoughness, ...(v === 2 ? { iridescence: 0.6, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 420] } : {}) }),
  },
  glass: {
    family: 'glass', variants: ['clear', 'tinted', 'frosted', 'wired', 'dirty'], tile: 1.6, depth: 0.0004, size: 1024, porosity: 0.0, live: true,
    refs: { albedo: [0.0, 0.9], rough: [0.0, 0.8], metal: 'glass 0 / wire 1', note: 'soda-lime glass F0 0.04 (IOR 1.52); clear transmits ~0.9' },
    defaults: { color: [0.86, 0.9, 0.9], opacity: 0.04, dirtColor: [0.32, 0.3, 0.27], dirt: 0.06, wirePitch: 0.0125 },
    variantDefaults: { tinted: { color: [0.18, 0.24, 0.24], opacity: 0.4 }, frosted: { dirt: 0.04 }, dirty: { dirt: 0.75 } },
    pack: (o) => ({ A: [...o.color, o.opacity], B: [...o.dirtColor, o.dirt], C: [o.wirePitch, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1, 1, 1], rough: 0.1, metal: 0, mode: -1, chip: 0.01 }),
  },
  plastic: {
    micro: [0.0009, 0.015, 0.35, 0.05], family: 'polymer', variants: ['abs', 'textured', 'diffuser', 'hdpe'], tile: 0.5, depth: 0.0004, size: 512, porosity: 0.0,
    refs: { albedo: [0.02, 0.85], rough: [0.15, 0.7], metal: 0, note: 'pigmented plastics: black 0.03-0.05, white 0.60-0.80; ABS gloss 0.15-0.3, textured 0.45-0.65' },
    defaults: { color: [0.5, 0.06, 0.04], roughness: 0.25, texture: 0.0008, scuffs: 0.4, chalking: 0 },
    variantDefaults: { textured: { roughness: 0.55 }, diffuser: { color: [0.8, 0.8, 0.78], roughness: 0.3 }, hdpe: { roughness: 0.42, color: [0.07, 0.2, 0.09] } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.texture, o.scuffs, o.chalking, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.3, 1.3, 1.3], rough: 0.6, metal: 0, mode: 1, chip: 0.006 }),
  },
  rubber: {
    cheap: true, family: 'polymer', variants: ['tread', 'sidewall', 'moulded', 'mat'], tile: 0.6, depth: 0.008, size: 512, porosity: 0.05,
    refs: { albedo: [0.015, 0.06], rough: [0.6, 0.95], metal: 0, note: 'tyre rubber 0.02-0.04 (carbon black), bloom to ~0.1' },
    defaults: { color: [0.026, 0.026, 0.028], roughness: 0.82, pitch: 0.03, groove: 0.008, bloom: 0.2 },
    variantDefaults: { sidewall: { roughness: 0.75 }, moulded: { roughness: 0.7 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.pitch, o.groove, o.bloom, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T, v) => (v === 0 ? [snap(T, o.pitch), 0.05] : [0, 0]),
    edge: () => ({ rgb: [1.6, 1.6, 1.6], rough: 0.9, metal: 0, mode: 1, chip: 0.01 }),
  },
  fabric: {
    micro: [0.0015, 0.05, 0.2, 0.03], family: 'textile', variants: ['canvas', 'tarpaulin', 'cotton', 'nylon'], tile: 0.5, depth: 0.0025, size: 1024, porosity: 0.9,
    refs: { albedo: [0.03, 0.75], rough: [0.45, 0.98], metal: 0, note: 'canvas 0.30-0.60 (a scanned canvas set averages 0.53); cotton 0.85-0.95 rough' },
    defaults: { color: [0.5, 0.06, 0.05], roughness: 0.9, stripe: [0.62, 0.6, 0.52], stripeWidth: 0, thread: 0.0009, fuzz: 1 },
    variantDefaults: { tarpaulin: { roughness: 0.5, color: [0.03, 0.12, 0.3], thread: 0.002 }, cotton: { thread: 0.0006 }, nylon: { roughness: 0.55, thread: 0.0004 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [...o.stripe, o.stripeWidth], C: [o.thread, o.fuzz, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T) => (o.stripeWidth > 0 ? [2 * snap(T, o.stripeWidth), 0] : [0, 0]),
    edge: () => ({ rgb: [1.2, 1.2, 1.15], rough: 0.95, metal: 0, mode: 1, chip: 0.01 }),
    physical: true,
    material: (o, v) => (v === 1 ? {} : { sheen: 1, sheenRoughness: v === 3 ? 0.5 : 0.8, sheenColor: new THREE.Color().setRGB(...o.color.map((c) => Math.min(1, c * 0.6 + 0.12))) }),
  },
  paper: {
    micro: [0.0015, 0.04, 0.3, 0.03], family: 'fibre', variants: ['cardboard', 'boardEdge', 'paper'], tile: 0.5, depth: 0.0008, size: 512, porosity: 0.95,
    refs: { albedo: [0.15, 0.85], rough: [0.7, 0.95], metal: 0, note: 'kraft board ~(0.42, 0.29, 0.16); white paper 0.70-0.85' },
    defaults: { color: [0.42, 0.29, 0.16], roughness: 0.88, flute: 0.008 },
    variantDefaults: { paper: { color: [0.78, 0.77, 0.73], roughness: 0.82 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.flute, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [0.85, 0.85, 0.85], rough: 0.95, metal: 0, mode: 1, chip: 0.01 }),
  },
  wood: {
    family: 'wood', variants: ['planks', 'plywood', 'painted', 'weathered', 'varnished', 'sawn'], tile: 1.2, depth: 0.004, size: 1024, porosity: 0.7,
    refs: { albedo: [0.02, 0.6], rough: [0.15, 0.92], metal: 0, note: 'pine 0.35-0.50, oak ~(0.30, 0.19, 0.10), old planks (scan) ~(0.10, 0.08, 0.05), teak (scan) ~(0.08, 0.03, 0.01), silvered ~0.30' },
    defaults: { color: [0.36, 0.22, 0.12], roughness: 0.68, board: [0.14, 1.2], gap: 0.003, along: 'u', paint: [0.2, 0.32, 0.3], peel: 0.35, latewood: [0.62, 0.55, 0.5], knots: 0.35 },
    variantDefaults: { plywood: { color: [0.5, 0.36, 0.22], board: [1.2, 1.2], gap: 0.001, knots: 0.1 }, varnished: { color: [0.22, 0.1, 0.04], roughness: 0.22 }, weathered: { roughness: 0.86 }, sawn: { roughness: 0.88, color: [0.4, 0.29, 0.17] } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.board[0], o.board[1], o.gap, o.along === 'v' ? 1 : 0], C: [...o.paint, o.peel], D: [...o.latewood, o.knots] }),
    quantum: (o, T, v) => { const q = [v === 1 ? T : snap(T, o.board[1]), snap(T, o.board[0])]; return o.along === 'v' ? [q[1], q[0]] : q; },
    edge: (o, v) => ({ rgb: v === 2 ? [0.3, 0.28, 0.25] : [1.15, 1.12, 1.08], rough: 0.85, metal: 0, mode: v === 2 ? 0 : 1, chip: 0.02 }),
  },
  bamboo: {
    cheap: true, family: 'wood', variants: ['poles', 'slats'], tile: 1.0, depth: 0.012, size: 1024, porosity: 0.5,
    refs: { albedo: [0.15, 0.55], rough: [0.3, 0.8], metal: 0, note: 'dried bamboo ~(0.45, 0.36, 0.18), its skin waxy (0.3-0.45)' },
    defaults: { color: [0.45, 0.36, 0.17], roughness: 0.38, width: 0.04, node: 0.32 },
    variantDefaults: { slats: { width: 0.02, roughness: 0.55 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.width, o.node, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: () => ({ rgb: [1.1, 1.1, 1.05], rough: 0.6, metal: 0, mode: 1, chip: 0.01 }),
  },
  leather: {
    micro: [0.0015, 0.04, 0.3, 0.05], family: 'polymer', variants: ['leather', 'vinyl', 'suede', 'aged'], tile: 0.4, depth: 0.0008, size: 1024, porosity: 0.4,
    refs: { albedo: [0.03, 0.4], rough: [0.4, 0.95], metal: 0, note: 'tanned leather 0.05-0.25; black vinyl 0.03-0.05' },
    defaults: { color: [0.16, 0.07, 0.035], roughness: 0.55, grain: 0.0015, pleat: 0.08 },
    variantDefaults: { vinyl: { color: [0.03, 0.03, 0.032], roughness: 0.45, grain: 0.0008 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.grain, o.pleat, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T, v) => (v === 1 ? [0, snap(T, o.pleat)] : [0, 0]),
    edge: () => ({ rgb: [1.35, 1.3, 1.25], rough: 0.4, metal: 0, mode: 1, chip: 0.01 }),
  },
  carbonFibre: {
    cheap: true, family: 'composite', variants: ['twill'], tile: 0.192, depth: 0.0003, size: 512, porosity: 0.0, physical: true,
    refs: { albedo: [0.015, 0.06], rough: [0.2, 0.5], metal: 0, note: 'carbon tows ~0.03 under an epoxy clear coat (F0 0.04)' },
    defaults: { color: [0.03, 0.031, 0.034], roughness: 0.3, tow: 0.004, clearcoatRoughness: 0.03 },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.tow, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T) => [4 * snap(T, o.tow), 4 * snap(T, o.tow)],
    edge: () => ({ rgb: [1.5, 1.5, 1.5], rough: 0.5, metal: 0, mode: 1, chip: 0.006 }),
    material: (o) => ({ clearcoat: 1, clearcoatRoughness: o.clearcoatRoughness }),
  },
  ceramic: {
    family: 'ceramic', variants: ['glazed', 'bisque', 'enamel'], tile: 0.3, depth: 0.0005, size: 512, porosity: 0.05,
    refs: { albedo: [0.03, 0.85], rough: [0.03, 0.85], metal: 0, note: 'glazed porcelain 0.05-0.15 rough; brown insulator glaze ~(0.25, 0.09, 0.04); bisque 0.6-0.8 rough' },
    defaults: { color: [0.26, 0.09, 0.04], roughness: 0.06, crazing: 0.3 },
    variantDefaults: { bisque: { color: [0.55, 0.36, 0.22], roughness: 0.75 }, enamel: { color: [0.05, 0.12, 0.35], roughness: 0.12 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.crazing, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: () => [0, 0],
    edge: (o, v) => (v === 2 ? { rgb: [0.03, 0.03, 0.03], rough: 0.5, metal: 0, mode: 0, chip: 0.006 } : { rgb: [1.1, 1.1, 1.1], rough: 0.3, metal: 0, mode: 1, chip: 0.006 }),
  },
  roofing: {
    micro: [0.002, 0.08, 0.25, 0.05], family: 'ground', variants: ['felt', 'epdm', 'gravel'], tile: 2.0, depth: 0.006, size: 1024, porosity: 0.3,
    refs: { albedo: [0.03, 0.4], rough: [0.6, 0.95], metal: 0, note: 'bitumen 0.04-0.06; mineral granules 0.10-0.20; ballast gravel 0.25-0.45' },
    defaults: { color: [0.11, 0.11, 0.11], roughness: 0.88, roll: 1.0, granule: 0.0018 },
    variantDefaults: { epdm: { color: [0.05, 0.05, 0.052], roughness: 0.72 }, gravel: { color: [0.36, 0.34, 0.31], roughness: 0.82 } },
    pack: (o) => ({ A: [...o.color, o.roughness], B: [o.roll, o.granule, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    quantum: (o, T) => [0, snap(T, o.roll)],
    edge: () => ({ rgb: [1.1, 1.1, 1.1], rough: 0.95, metal: 0, mode: 1, chip: 0.02 }),
  },
  // ---- live kinds (per pixel always)
  neon: {
    family: 'emissive', variants: ['tube'], tile: 1, depth: 0.0001, live: true, porosity: 0,
    refs: { albedo: [0, 0.7], rough: [0.03, 0.1], metal: 0, note: 'glass tube F0 0.04; the gas column saturated (neon red, argon-mercury blue / phosphor colours)' },
    defaults: { color: [1.0, 0.16, 0.5], intensity: 9, on: 1, dayFloor: 0.03, electrodes: 0, supports: 0 },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [o.on, 0, 0, 0], C: [0, 0, 0, 0], D: [o.dayFloor, o.electrodes, o.supports, 0] }),
  },
  fluorescent: {
    family: 'emissive', variants: ['tube'], tile: 1, depth: 0.0001, live: true, porosity: 0,
    refs: { albedo: [0.7, 0.9], rough: [0.2, 0.3], metal: 0, note: 'phosphor coat white ~0.82 when off' },
    defaults: { color: [0.95, 0.97, 1.0], intensity: 6, on: 1, dayFloor: 0.5 },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [o.on, 0, 0, 0], C: [0, 0, 0, 0], D: [o.dayFloor, 0, 0, 0] }),
  },
  ledPanel: {
    family: 'emissive', variants: ['bare', 'diffused'], tile: 1, depth: 0.002, live: true, porosity: 0,
    refs: { albedo: [0.02, 0.6], rough: [0.15, 0.6], metal: 0, note: 'black LED module face 0.02-0.04 between the emitters' },
    defaults: { color: [0.2, 0.85, 1.0], intensity: 4, pitch: 0.01, diffuser: 0, fill: 0.2, content: 'solid', speed: 0.5, dayFloor: 0.6 },
    variantDefaults: { diffused: { diffuser: 1, fill: 0.9 } },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [o.pitch, o.diffuser, o.fill, 0], C: [{ solid: 0, noise: 1, bars: 2 }[o.content] ?? 0, o.speed, 0, 0], D: [o.dayFloor, 0, 0, 0] }),
  },
  lcd: {
    family: 'emissive', variants: ['screen'], tile: 1, depth: 0.0001, live: true, porosity: 0,
    refs: { albedo: [0.005, 0.02], rough: [0.03, 0.1], metal: 0, note: 'a cover glass over a black matrix' },
    defaults: { color: [0.9, 0.95, 1.0], intensity: 2, pitch: 0.0006, content: 'noise', speed: 0.5, dayFloor: 0.8 },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [o.pitch, 0, 0, 0], C: [{ solid: 0, noise: 1, bars: 2 }[o.content] ?? 0, o.speed, 0, 0], D: [o.dayFloor, 0, 0, 0] }),
  },
  lightbox: {
    family: 'emissive', variants: ['acrylic'], tile: 1, depth: 0.0001, live: true, porosity: 0, mapping: 'uv',
    refs: { albedo: [0.4, 0.9], rough: [0.05, 0.12], metal: 0, note: 'opal acrylic face lit from behind' },
    defaults: { color: [1.0, 0.95, 0.85], intensity: 3, rows: 0.25, hotspot: 0.35, edge: 0.12, dayFloor: 0.5 },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [o.rows, o.hotspot, o.edge, 0], C: [0, 0, 0, 0], D: [o.dayFloor, 0, 0, 0] }),
  },
  paperLantern: {
    family: 'emissive', variants: ['washi'], tile: 0.5, depth: 0.0005, live: true, porosity: 0.9,
    refs: { albedo: [0.5, 0.85], rough: [0.8, 0.95], metal: 0, note: 'washi paper transmits ~30-50 %' },
    defaults: { color: [0.82, 0.62, 0.42], intensity: 2.5, glow: [1.0, 0.55, 0.22], ribs: 0.06, dayFloor: 0.08 },
    pack: (o) => ({ A: [...o.color, o.intensity], B: [...o.glow, o.ribs], C: [0, 0, 0, 0], D: [o.dayFloor, 0, 0, 0] }),
  },
  water: {
    family: 'liquid', variants: ['film', 'standing'], tile: 1, depth: 0.002, live: true, porosity: 0,
    refs: { albedo: [0.01, 0.1], rough: [0.02, 0.06], metal: 0, note: 'water F0 0.02 (IOR 1.33)' },
    defaults: { color: [0.06, 0.06, 0.06], depthShare: 0.3, ripples: 1 },
    variantDefaults: { standing: { depthShare: 1 } },
    pack: (o) => ({ A: [...o.color, 0], B: [o.depthShare, o.ripples, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
  },
  oil: {
    family: 'liquid', variants: ['sheen'], tile: 1, depth: 0.0001, live: true, porosity: 0, physical: true,
    refs: { albedo: [0.01, 0.05], rough: [0.02, 0.08], metal: 0, note: 'a thin oil film (IOR ~1.45) 150-900 nm on dark water' },
    defaults: { color: [0.02, 0.02, 0.022], minNm: 180, maxNm: 820, swirl: 0.6 },
    pack: (o) => ({ A: [...o.color, 0], B: [o.minNm, o.maxNm, o.swirl, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] }),
    material: () => ({ iridescence: 1, iridescenceIOR: 1.45, iridescenceThicknessRange: [100, 800] }),
  },
};
/** F0 (linear) of common metals */
export const METALS = {
  iron: [0.53, 0.51, 0.5], steel: [0.56, 0.57, 0.58], stainless: [0.58, 0.58, 0.56], castIron: [0.45, 0.44, 0.43], aluminium: [0.91, 0.92, 0.92],
  chrome: [0.55, 0.56, 0.55], copper: [0.96, 0.64, 0.54], brass: [0.91, 0.78, 0.42], bronze: [0.8, 0.6, 0.38], gold: [1.0, 0.77, 0.34],
  silver: [0.97, 0.96, 0.92], titanium: [0.54, 0.5, 0.45], nickel: [0.65, 0.61, 0.54], zinc: [0.62, 0.64, 0.66], lead: [0.63, 0.63, 0.64],
};

/** Everything the library knows about each kind (family, variants, tile, depth, porosity, reference ranges, defaults). */
export const SURFACE_KINDS = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, {
  family: v.family, variants: [...v.variants], tile: v.tile, cheap: !!v.cheap, depth: v.depth, size: v.size || 0, porosity: v.porosity, live: !!v.live, physical: !!v.physical,
  refs: v.refs, defaults: v.defaults,
}]));

// ---- specs ----------------------------------------------------------------------------------------------------------
// common options: variant, scale (pattern size multiplier), seed, age 0..1, dirt 0..1, edgeWear 0..1, variation (macro
// tone, 0..1), dirtColor, tile (m: the bake / repeat period)
function makeSpec(kind, opt = {}) {
  const K = KINDS[kind];
  if (!K) throw new Error(`[mirage/surfaces] unknown kind "${kind}"`);
  const vName = opt.variant ?? K.variants[0];
  const v = typeof vName === 'number' ? vName : K.variants.indexOf(vName);
  if (v < 0 || v >= K.variants.length) throw new RangeError(`[mirage/surfaces] ${kind}: unknown variant "${vName}" (have: ${K.variants.join(', ')})`);
  const o = { ...K.defaults, ...((K.variantDefaults || {})[K.variants[v]] || {}), ...opt };
  for (const k of ['color', 'stone', 'paint', 'primer', 'jointColor', 'mortarColor', 'groutColor', 'altColor', 'patchColor', 'rustColor', 'tarnishColor', 'flakeColor', 'dirtColor', 'stripe', 'latewood', 'glow', 'bare']) {
    if (k in o && o[k] != null) o[k] = lin(o[k]);
  }
  const P = K.pack(o);
  const T = +(opt.tile ?? K.tile), seed = +(opt.seed ?? 1) % 997;
  const common = {
    X: [T, seed, v, +(opt.scale ?? 1)],
    W: [clamp01(opt.age ?? 0.35), clamp01(opt.dirt ?? (K.family === 'metal' || K.family === 'coating' ? 0.15 : 0.3)), clamp01(opt.edgeWear ?? (K.live ? 0 : K.family === 'coating' || K.family === 'metal' ? 0.25 : 0.5)), clamp01(opt.variation ?? 0.5)],
    G: [...lin(opt.dirtColor, DIRT), 0],
  };
  const e = K.edge ? K.edge(o, v) : { rgb: [1, 1, 1], rough: 0.5, metal: 0, mode: -1, chip: 0.01 };
  const q = K.quantum ? K.quantum(o, T, v) : [0, 0];
  const spec = {
    isSurface: true, kind, variant: K.variants[v], options: o, uniforms: { ...P, ...common, E: [...e.rgb, e.rough], F: [e.metal, e.mode, e.chip, 1] },
    quantum: q, tile: T, depth: K.depth * +(opt.scale ?? 1), porosity: opt.porosity ?? K.porosity, live: !!K.live, physical: !!K.physical,
    material: K.material ? K.material(o, v) : {}, size: K.size || 0,
  };
  // the numbers the baked texture depends on (the runtime layer's are live)
  spec.bakeKey = kind + ':' + hash32(JSON.stringify([P, common.X, common.W[0], K.size]));
  return spec;
}
/** SURFACES.<kind>(options) -> a surface spec (data: kind, variant, the packed numbers); see SURFACE_KINDS for the
 *  kinds, their variants and defaults. */
export const SURFACES = Object.fromEntries(Object.keys(KINDS).map((k) => [k, (opt) => makeSpec(k, opt)]));

// ---- hooks ----------------------------------------------------------------------------------------------------------
const MAPPINGS = ['tri', 'wall', 'ground', 'grain', 'uv'];
const AXES = { x: 1, y: 2, z: 3 };

// the frames: up to three planar projections; T, B = the world directions of u and v
const FRAME_GLSL = /* glsl */ `
vec3 msFrameT[3]; vec3 msFrameB[3]; vec3 msFrameW;
void msFrames(vec3 p, vec3 n, int mapping){
  float g = msY.x;
  if (mapping == 2) {          // ground
    msFrameT[0] = g > 2.5 ? vec3(0, 0, 1) : vec3(1, 0, 0); msFrameB[0] = g > 2.5 ? vec3(1, 0, 0) : vec3(0, 0, 1); msFrameW = vec3(1, 0, 0);
  } else if (mapping == 1) {   // wall: u along the wall, v up; the ground projection on tops
    vec3 T = vec3(-n.z, 0.0, n.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1, 0, 0);
    bool up = g > 1.5 && g < 2.5;
    msFrameT[0] = up ? vec3(0, 1, 0) : T; msFrameB[0] = up ? T : vec3(0, 1, 0);
    msFrameT[1] = vec3(1, 0, 0); msFrameB[1] = vec3(0, 0, 1);
    float wy = smoothstep(0.6, 0.8, abs(n.y));
    msFrameW = vec3(1.0 - wy, wy, 0.0);
  } else if (mapping == 3) {   // grain: u along the grain vector projected into the face (any orientation, one tap)
    vec3 gv = msGrainV, t = cross(n, gv); float tl = length(t);
    vec3 alt = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
    t = tl > 0.2 ? t / tl : alt;
    msFrameT[0] = normalize(cross(t, n)); msFrameB[0] = t; msFrameW = vec3(1, 0, 0);
  } else {                     // triplanar, the grain axis kept as u where it lies in the plane
    msFrameT[0] = g > 1.5 && g < 2.5 ? vec3(0, 1, 0) : vec3(0, 0, 1); msFrameB[0] = g > 1.5 && g < 2.5 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    msFrameT[1] = g > 2.5 ? vec3(0, 0, 1) : vec3(1, 0, 0); msFrameB[1] = g > 2.5 ? vec3(1, 0, 0) : vec3(0, 0, 1);
    msFrameT[2] = g > 1.5 && g < 2.5 ? vec3(0, 1, 0) : vec3(1, 0, 0); msFrameB[2] = g > 1.5 && g < 2.5 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    vec3 w = pow(abs(n), vec3(8.0)); w /= w.x + w.y + w.z;
    w = max(w - 0.04, 0.0); msFrameW = w / (w.x + w.y + w.z);
  }
}
MsS msZero(){ return MsS(vec3(0.0), 0.0, 0.0, 0.0, 0.0); }
void msAcc(inout MsS o, MsS s, float w){ o.a += s.a * w; o.r += s.r * w; o.h += s.h * w; o.m += s.m * w; o.ao += s.ao * w; }
`;

// the runtime layer: macro variation, dirt, streaks, edge wear (both paths)
const FINISH_GLSL = /* glsl */ `
// the runtime layer's noise: four independent tileable fractal channels in one small texture (noiseTexture()), read
// in a plane across the world's diagonal (no axis-aligned face sees it edge-on): a few taps instead of hashing
uniform sampler2D msNoiseT;
vec2 msNQ(vec3 p){ return vec2(dot(p, vec3(0.7071, 0.0, -0.7071)), dot(p, vec3(-0.4082, 0.8165, -0.4082))); }
vec4 msN4(vec3 p, float f){ return texture(msNoiseT, msNQ(p) * (f * 0.125)) * 2.0 - 1.0; }
void msFinish(inout MsS s, vec3 wp, vec3 wn, float fpw){
  vec4 n1 = msN4(wp + msX.y, 0.23), n2 = msN4(wp + 3.1, 1.7);
  float v1 = 0.65 * n1.r + 0.35 * n1.g, v2 = n2.b;
  if (msW.w > 0.0) {   // macro variation: hides the tile
    s.a *= max(1.0 + msW.w * (0.3 * v1 + 0.1 * v2), 0.2);
    s.r = clamp(s.r + msW.w * 0.06 * v1, 0.02, 1.0);
  }
  if (msW.y > 0.0) {   // dirt: in the cavities, at the foot, on top faces; run-off streaks down walls with age
    float up = clamp(wn.y, 0.0, 1.0), wall = 1.0 - abs(wn.y);
    float foot = 1.0 - smoothstep(0.0, 0.45 + 0.4 * (v1 * 0.5 + 0.5), wp.y - msG.w);
    float cav = clamp((0.5 - s.h) * 2.2, 0.0, 1.0);
    float d = msW.y * clamp(0.6 * cav * (0.7 + 0.3 * v2) + 0.55 * foot + 0.3 * up * smoothstep(-0.2, 0.6, n2.a), 0.0, 1.0);
    vec3 T = vec3(-wn.z, 0.0, wn.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1.0, 0.0, 0.0);
    vec4 sn = texture(msNoiseT, vec2(dot(wp, T) * 0.3, wp.y * 0.02 + msX.y));
    float st = sn.r * 0.6 + sn.g * 0.4;
    d = clamp(d + 0.5 * msW.x * msW.y * smoothstep(0.45, 0.8, st) * wall, 0.0, 1.0);
    s.a = mix(s.a, msG.rgb * (0.85 + 0.3 * (v2 * 0.5 + 0.5)), d * 0.8);
    s.r = mix(s.r, 0.9, d * 0.75);
    s.m *= 1.0 - d;
  }
  if (msF.y >= 0.0 && msW.z > 0.0 && msEdgeK > 0.02) {   // edge wear, broken into chips
    float cs = msF.z;
    vec2 cq = msNQ(wp) / cs * 0.125;
    float lod = log2(max(fpw / cs * 32.0, 1.0));
    vec4 cnv = textureLod(msNoiseT, cq, lod);
    float cn = 0.7 * cnv.r + 0.3 * cnv.a;
    float e = clamp(msEdgeK * msW.z * 1.6, 0.0, 1.0);
    float ex = smoothstep(0.55, 0.6, e * 0.6 + (cn - 0.5) * 1.2 + 0.05);
    if (msF.y < 0.5) { s.a = mix(s.a, msE.rgb, ex); s.m = mix(s.m, msF.x, ex); }
    else s.a = mix(s.a, s.a * msE.rgb, ex);
    s.r = mix(s.r, msE.a, ex);
    s.h -= 0.15 * ex;
  }
}
`;

// four tileable fractal value-noise channels (256 x 256, eight base cells per tile), made once in JS (deterministic)
let NOISE_TEX = null;
/** The runtime layer's shared noise texture (RGBA8, 256 x 256, repeat, mipmapped; four independent channels). */
export function noiseTexture() {
  if (NOISE_TEX) return NOISE_TEX;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x, y, c) => { let h = Math.imul(x * 374761393 + y * 668265263 + c * 2147483647, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const val = (x, y, P, c) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const h = (i, j) => hash(((xi + i) % P + P) % P, ((yi + j) % P + P) % P, c);
    return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fy) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 4; c++) {
    let s = 0, a = 0.5, tot = 0;
    for (let o = 0, P = 8; o < 5; o++, P *= 2, a *= 0.5) { s += a * val(x / N * P + c * 0.37, y / N * P + c * 0.71, P, c * 7 + o); tot += a; }
    const v = (s / tot - 0.5) * 1.9 + 0.5;   // contrast back what the octaves average away
    data[4 * (y * N + x) + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; t.name = 'surface-noise';
  return (NOISE_TEX = t);
}

// decals placed by rules (DECAL_GLSL): only with options.decals (a define; uniforms msDa, msDb)
const DECAL_GLSL = /* glsl */ `
uniform vec4 msDa;   // rills: top (m), length (m), density;  damp height (m)
uniform vec4 msDb;   // stains, cracks, soot, leaks spacing (m)
uniform sampler2D msDecalAtlas;
// one cell of the atlas (4 x 2 masks): id 0 crack, 1 crack net, 2 rill, 3 drip, 4 soot, 5 stain, 6 leak, 7 splash
float msDecal(int id, vec2 q){
  if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return 0.0;
  vec2 c = vec2(float(id % 4), float(id / 4));
  return textureLod(msDecalAtlas, (c + clamp(q, 0.004, 0.996)) / vec2(4.0, 2.0), 0.0).r;
}
float msDecalScatter(int id, vec2 q, vec2 cell, vec2 size, float density, float seed){
  vec2 id2 = floor(q / cell), f = q - id2 * cell;
  vec3 h = mgHash3(vec3(id2, seed));
  if (h.z > density) return 0.0;
  vec2 o = (cell - size) * h.xy;
  return msDecal(id, (f - o) / size);
}
void msDecals(inout MsS s, vec3 wp, vec3 wn){
  vec3 T = vec3(-wn.z, 0.0, wn.x); float tl = length(T); T = tl > 1e-3 ? T / tl : vec3(1, 0, 0);
  vec2 q = vec2(dot(wp, T), wp.y);
  float wall = smoothstep(0.3, 0.6, 1.0 - abs(wn.y));
  float dark = 0.0, rust = 0.0, white = 0.0, wet = 0.0, crackM = 0.0;
  if (msDa.z > 0.0) {   // rain rills hanging from a ledge at msDa.x
    float y = (msDa.x - q.y) / msDa.y;
    float r = msDecalScatter(2, vec2(q.x, y * 0.7), vec2(0.35, 1.0), vec2(0.3, 0.7), msDa.z, 3.0);
    dark = max(dark, r * step(0.0, y) * 0.8);
  }
  if (msDa.w > 0.0) {   // damp rising from the ground, a salt tide line on top
    float hy = wp.y - msG.w, top = msDa.w * (0.75 + 0.35 * (mgFbm3(wp * vec3(1.2, 0.0, 1.2), 3) * 0.5 + 0.5));
    float damp = 1.0 - smoothstep(top - 0.06, top, hy);
    float tide = (1.0 - smoothstep(0.0, 0.025, abs(hy - top + 0.02)));
    dark = max(dark, damp * 0.6); white = max(white, tide * 0.5); wet = max(wet, damp);
  }
  if (msDb.x > 0.0) dark = max(dark, 0.55 * msDecalScatter(5, q, vec2(2.2, 2.0), vec2(1.0, 1.0), msDb.x, 5.0));
  if (msDb.y > 0.0) crackM = max(msDecalScatter(0, q, vec2(3.0, 2.6), vec2(1.6, 2.2), msDb.y, 7.0), msDecalScatter(1, q + 1.3, vec2(2.4, 2.4), vec2(1.2, 1.2), msDb.y * 0.5, 8.0));
  if (msDb.z > 0.0) dark = max(dark, 0.85 * msDecalScatter(4, q, vec2(4.0, 3.5), vec2(1.4, 2.6), msDb.z, 9.0));
  if (msDb.w > 0.0) {   // leaks under fixings: every msDb.w metres along the wall, a rust run below a fixing row at msDa.x
    float y = (msDa.x - 0.05 - q.y);
    vec2 lq = vec2(mod(q.x, msDb.w) - 0.5 * msDb.w + 0.05, y) / vec2(0.12, 0.8) + vec2(0.5, 0.0);
    rust = max(rust, msDecal(6, lq) * step(0.4, mgHash3(vec3(floor(q.x / msDb.w), 3.0, 1.0)).x));
  }
  dark *= wall; rust *= wall; white *= wall; crackM *= wall;
  s.a *= 1.0 - 0.55 * dark;
  s.r = mix(s.r, max(s.r - 0.15, 0.3), wet * wall);
  s.a = mix(s.a, vec3(0.62, 0.6, 0.55), white);
  s.a = mix(s.a, msRustCol(0.4), rust * 0.85); s.r = mix(s.r, 0.9, rust); s.m *= 1.0 - rust;
  s.a *= 1.0 - 0.75 * crackM; s.h -= 0.3 * crackM; s.ao *= 1.0 - 0.5 * crackM;
}
`;

// road paint on asphalt (options.paint: a GLSL float 0..1, the marking's mask; its colour msPaint)
const PAINT_GLSL = /* glsl */ `
uniform vec4 msPaint;
void msRoadPaint(inout MsS s, vec2 u, float mask){
  // thermoplastic: a raised film with glass beads (fine glints), worn in the wheel paths and on the aggregate tops
  float wear = smoothstep(0.35, 0.75, mgFbm3(vec3(u * 1.6, 2.0), 3) * 0.5 + 0.5 + 0.35 * (s.h - 0.5));
  float m = clamp(mask, 0.0, 1.0) * (1.0 - wear * msPaint.a);
  float bead = step(0.82, mgHash3(vec3(floor(u * 900.0), 4.0)).x) * clamp(0.0009 / max(msFP, 1e-6) - 0.5, 0.0, 1.0);
  s.a = mix(s.a, msPaint.rgb * (0.9 + 0.1 * mgFbm3(vec3(u * 40.0, 1.0), 2)), m);
  s.r = mix(s.r, mix(0.55, 0.2, bead), m);
  s.h = mix(s.h, max(s.h, 0.62), m);
}
`;

const fmt = (v) => { const n = +(+v).toFixed(6); return Number.isInteger(n) ? n.toFixed(1) : String(n); };
const v4 = (a) => new THREE.Vector4(...a);

/**
 * The patch() hooks of a surface. options: mode 'procedural' | 'baked' (needs baked: { c, n } textures),
 * mapping 'tri' | 'wall' | 'ground' | 'grain' | 'uv', grain ([x, y, z] for 'grain'; 'x' | 'y' | 'z' keeps that world
 * axis as u in 'tri' / 'wall' / 'ground'), space 'world' | 'object', uvScale (m per uv unit), ground (m: the foot),
 * breaker (baked: hide the repeat, true), edges 'curvature' | 'attribute' (vertex attribute `edge` 0..1),
 * decals { rills: { top, length, density }, damp, stains, cracks, soot, leaks }, paint (asphalt: a GLSL float mask),
 * paintColor, debug ('albedo' | 'rough' | 'height' | 'metal'), lod (footprints per wavelength under which detail is
 * dropped: 3; 2 matches a bake).
 */
export function surfaceHooks(spec, options = {}) {
  if (!spec || !spec.isSurface) throw new TypeError('surfaceHooks: pass a spec from SURFACES.<kind>(...)');
  const K = KINDS[spec.kind];
  const o = { mapping: K.mapping || 'tri', mode: 'procedural', space: 'world', breaker: true, edges: 'curvature', ...options };
  if (!MAPPINGS.includes(o.mapping)) throw new RangeError(`surfaceHooks: mapping must be one of ${MAPPINGS.join(', ')}`);
  const live = spec.live, baked = !live && o.mode === 'baked';
  if (baked && !(o.baked && o.baked.c && o.baked.n)) throw new Error('surfaceHooks: mode "baked" needs options.baked { c, n } (createSurfaces bakes them)');
  const U = spec.uniforms;
  const grainVec = Array.isArray(o.grain) ? new THREE.Vector3(...o.grain).normalize() : new THREE.Vector3(1, 0, 0);
  const grainAxis = typeof o.grain === 'string' ? AXES[o.grain] || 0 : 0;
  const Y = [grainAxis, spec.depth, spec.quantum[0] || 0, spec.quantum[1] || 0];
  const F = [...U.F]; F[3] = o.breaker === false ? 0 : 1;
  const G = [...U.G]; G[3] = +(o.ground ?? 0);
  const uniforms = {
    msX: { value: v4(U.X) }, msY: { value: v4(Y) }, msW: { value: v4(U.W) }, msA: { value: v4(U.A) }, msB: { value: v4(U.B) }, msC: { value: v4(U.C) },
    msD: { value: v4(U.D) }, msE: { value: v4(U.E) }, msF: { value: v4(F) }, msG: { value: v4(G) }, msGrainV: { value: grainVec }, msUVScale: { value: +(o.uvScale ?? 1) }, msNoiseT: { value: noiseTexture() },
  };
  const mapIdx = { tri: 0, wall: 1, ground: 2, grain: 3, uv: 4 }[o.mapping];
  const objectSpace = o.space === 'object';
  const fn = 'ms_' + spec.kind;
  let decl = MS_COMMON + 'uniform vec3 msGrainV; uniform float msUVScale; varying vec2 msUVraw;\n' + (objectSpace ? 'varying vec3 msOP; varying vec3 msON;\n' : '')
    + (o.edges === 'attribute' ? 'varying float msEdgeV;\n' : '') + (o.edges === 'box' ? 'varying vec3 msBP; uniform vec3 msBoxLo; uniform vec3 msBoxHi; uniform vec4 msBoxS;\n' : '')
    + FRAME_GLSL + FINISH_GLSL + (LIVE_GLSL[spec.kind] || KIND_GLSL[spec.kind]);
  if (baked) {
    uniforms.msTC = { value: o.baked.c }; uniforms.msTN = { value: o.baked.n };
    // close up, where a pixel is finer than the set's texel: the kind's grain as a runtime detail layer over the bake
    uniforms.msMi = { value: new THREE.Vector4(...(K.micro || [0, 0, 0, 0])) };
    uniforms.msBakeN = { value: o.baked.size || (o.baked.c.image && o.baked.c.image.width) || 1024 };
    decl += /* glsl */ `
uniform sampler2D msTC; uniform sampler2D msTN; uniform vec4 msMi; uniform float msBakeN; float msMicroH = 0.0;
// one baked tap: the tile at uv (m), a repetition breaker (offsets in whole pattern modules, cross-faded by height)
void msTap(vec2 uv, vec2 gx, vec2 gy, out vec4 c, out vec4 n){
  vec2 t = uv / msT, tx = gx / msT, ty = gy / msT;
  if (msF.w > 0.5) {
    // patches of ~3 tiles pick one of six offsets (whole pattern modules); neighbours cross-fade, the seam steered by
    // the two heights; where one offset rules alone (most pixels) only its two taps are read
    float v = textureGrad(msNoiseT, t * 0.046 + msSeed * 0.013, tx * 0.046, ty * 0.046).r * 6.0, i = floor(v), f = fract(v);
    vec2 oa = mgHash3(vec3(i, 7.0, msSeed)).xy * 17.0, ob = mgHash3(vec3(i + 1.0, 7.0, msSeed)).xy * 17.0;
    vec2 q = msY.zw / msT;
    oa = vec2(q.x > 0.0 ? floor(oa.x / q.x) * q.x : oa.x, q.y > 0.0 ? floor(oa.y / q.y) * q.y : oa.y);
    ob = vec2(q.x > 0.0 ? floor(ob.x / q.x) * q.x : ob.x, q.y > 0.0 ? floor(ob.y / q.y) * q.y : ob.y);
    float w0 = smoothstep(0.25, 0.75, f);
    if (w0 <= 0.0) { c = textureGrad(msTC, t + oa, tx, ty); n = textureGrad(msTN, t + oa, tx, ty); }
    else if (w0 >= 1.0) { c = textureGrad(msTC, t + ob, tx, ty); n = textureGrad(msTN, t + ob, tx, ty); }
    else {
      vec4 na = textureGrad(msTN, t + oa, tx, ty), nb = textureGrad(msTN, t + ob, tx, ty);
      float w = smoothstep(0.25, 0.75, f + 0.5 * (nb.b - na.b));
      c = mix(textureGrad(msTC, t + oa, tx, ty), textureGrad(msTC, t + ob, tx, ty), w);
      n = mix(na, nb, w);
    }
  } else { c = textureGrad(msTC, t, tx, ty); n = textureGrad(msTN, t, tx, ty); }
}`;
  }
  if (o.decals) decl += DECAL_GLSL;
  if (o.paint) decl += PAINT_GLSL;
  // the evaluation: in uniform flow the footprint, the edge measure and the projected gradients; then the taps
  const pos = objectSpace ? 'msOP' : 'mgWorldPos', nrm = objectSpace ? 'normalize(msON)' : 'normalize(mgWorldNormal)';
  const tapProc = (i, uv) => `msAcc(msS, ${fn}(${uv}), msFrameW[${i}]);`;
  const tapBaked = (i, uv) => `{ vec4 c, n; msTap(${uv}, msGx[${i}], msGy[${i}], c, n); vec2 t = n.xy * 2.0 - 1.0;
      msAcc(msS, MsS(c.rgb, c.a, n.b, n.a, 1.0), msFrameW[${i}]);
      msNW += (msFrameT[${i}] * t.x + msFrameB[${i}] * t.y + msWN * sqrt(max(1.0 - dot(t, t), 0.0))) * msFrameW[${i}]; }`;
  const nTaps = { tri: 3, wall: 2, ground: 1, grain: 1, uv: 1 }[o.mapping];
  let body = /* glsl */ `
  msT = msX.x; msSeed = msX.y; msLodA = ${fmt(o.lod ?? 3)};
  vec3 msP0 = ${pos}, msWN = ${nrm};
  vec3 msPW = mgWorldPos, msNWorld = normalize(mgWorldNormal);
  float msFPW = max(length(dFdx(mgWorldPos)), length(dFdy(mgWorldPos)));
  msFP = msFPW / msX.w;
  ${o.edges === 'attribute' ? 'msEdgeK = msEdgeV;' : 'msEdgeK = smoothstep(4.0, 30.0, length(fwidth(msNWorld)) / max(length(fwidth(msPW)), 1e-5));'}
  ${o.edges === 'box' ? `{ // the object's own box: distance to its edges (two of the three face pairs near), in metres; wear within msBoxS.w
    vec3 bd = min(msBP - msBoxLo, msBoxHi - msBP) * msBoxS.xyz;
    float e2 = max(min(bd.x, bd.y), min(max(bd.x, bd.y), bd.z));
    msEdgeK = max(msEdgeK, 1.0 - smoothstep(0.0, msBoxS.w, e2)); }` : ''}
  msFrames(msP0, msWN, ${mapIdx});
  vec2 msU[3]; vec2 msGx[3]; vec2 msGy[3];
  vec3 msDX = dFdx(msP0) / msX.w, msDY = dFdy(msP0) / msX.w;
  for (int i = 0; i < ${nTaps}; i++) {
    msU[i] = vec2(dot(msP0, msFrameT[i]), dot(msP0, msFrameB[i])) / msX.w;
    msGx[i] = vec2(dot(msDX, msFrameT[i]), dot(msDX, msFrameB[i])); msGy[i] = vec2(dot(msDY, msFrameT[i]), dot(msDY, msFrameB[i]));
  }`;
  if (o.mapping === 'uv') {
    body += /* glsl */ `
  msU[0] = msUVraw * msUVScale / msX.w; msGx[0] = dFdx(msU[0]); msGy[0] = dFdy(msU[0]); msFrameW = vec3(1, 0, 0);
  { vec3 dp1 = dFdx(msPW), dp2 = dFdy(msPW); vec2 du1 = dFdx(msUVraw), du2 = dFdy(msUVraw);
    vec3 a1 = cross(dp2, msNWorld), a2 = cross(msNWorld, dp1);
    vec3 Tt = a1 * du1.x + a2 * du2.x, Bt = a1 * du1.y + a2 * du2.y;
    float s = inversesqrt(max(max(dot(Tt, Tt), dot(Bt, Bt)), 1e-12));
    msFrameT[0] = Tt * s; msFrameB[0] = Bt * s; }`;
  }
  body += '\n  MsS msS = msZero(); vec3 msNW = vec3(0.0);\n';
  for (let i = 0; i < nTaps; i++) body += `  if (msFrameW[${i}] > 0.0) ${(baked ? tapBaked : tapProc)(i, `msU[${i}]`)}\n`;
  if (!baked) body += '  msS.a *= msS.ao;\n';   // the bake folds the cavity into the albedo
  else body += `  if (msMi.x > 0.0) {
    vec2 mq = msNQ(msPW) / msMi.x * 0.125;
    vec2 mq2 = mat2(0.8, 0.6, -0.6, 0.8) * mq * 2.37 + 0.31;
    vec4 md = (textureGrad(msNoiseT, mq, dFdx(mq), dFdy(mq)) + textureGrad(msNoiseT, mq2, dFdx(mq2), dFdy(mq2))) * 0.5 - 0.5;
    float mk = clamp(msT / msBakeN / max(msFP, 1e-6) - 1.0, 0.0, 1.0);
    float g = (md.r * 0.7 + md.g * 0.3) * mk;
    msS.a *= 1.0 + msMi.y * g * 2.5; msS.r = clamp(msS.r + msMi.w * g * 2.0, 0.02, 1.0); msMicroH = msMi.z * g * 0.4;
  }\n`;
  const trans = spec.kind === 'glass' && !!o.transmission;
  // glass through the transmission pass: dirt and wire opaque, the clean pane transmits (tinted by its attenuation);
  // the share per pixel is applied at the output (three mixes by its uniform; the diffuse before it is re-mixed)
  if (trans) body += '  msTrans = clamp(1.0 - (msAlpha - msA.a) / max(1.0 - msA.a, 1e-3), 0.0, 1.0); if (msX.z > 1.5 && msX.z < 2.5) msTrans = 1.0 - 0.35 * (1.0 - msTrans); msS.a = mix(msS.a, msA.rgb, msTrans);\n';
  if (o.paint) body += `  msRoadPaint(msS, msPW.xz, ${o.paint});\n`;
  if (o.decals) body += '  msDecals(msS, msPW, msNWorld);\n';
  if (!live) body += '  msFinish(msS, msPW, msNWorld, msFPW);\n';
  body += '  msH = clamp(msS.h, 0.0, 1.0); msM = clamp(msS.m, 0.0, 1.0); msR = clamp(msS.r, 0.02, 1.0); msAlb = msS.a;\n';
  if (baked) body += '  msNWo = msNW;\n';
  const h = {
    fragmentDecl: decl + '\nvec3 msAlb = vec3(0.5); vec3 msNWo = vec3(0.0);\n',
    albedo: `{${body}\n  diffuseColor.rgb *= msAlb; }`,
    roughness: 'roughnessFactor = msR;',
    metalness: 'metalnessFactor = msM;',
    normal: baked
      ? 'if (dot(msNWo, msNWo) > 0.0) { vec3 wn = normalize(mgWorldNormal); normal = normalize(normal + (viewMatrix * vec4(normalize(msNWo) - wn, 0.0)).xyz); }\nnormal = mgBump(normal, msMicroH * msY.y, 1.0);'
      : 'normal = mgBump(normal, msH * msY.y, 1.0);',
    uniforms,
    vertexDecl: 'varying vec2 msUVraw;' + (objectSpace ? ' varying vec3 msOP; varying vec3 msON;' : '') + (o.edges === 'attribute' ? ' attribute float edge; varying float msEdgeV;' : '') + (o.edges === 'box' ? ' varying vec3 msBP;' : ''),
    vertexWorld: 'msUVraw = uv;' + (o.edges === 'box' ? ' msBP = position;' : '') + (objectSpace ? ` msOP = mgW4.xyz * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      msON = vec3(0.0, 1.0, 0.0);
      #ifdef USE_INSTANCING
        msON = mat3(instanceMatrix) * normal;
      #else
        msON = normal;
      #endif` : '') + (o.edges === 'attribute' ? ' msEdgeV = edge;' : ''),
  };
  if (spec.physical && spec.kind === 'carPaint') {
    // the clear coat's own orange peel (a slow wave), on its own normal
    h.emissive = '#ifdef USE_CLEARCOAT\nclearcoatNormal = mgBump(clearcoatNormal, mgFbm3(mgWorldPos * 140.0, 2) * 0.00004 * clamp(0.004 / max(msFP, 1e-6) - 0.5, 0.0, 1.0), 1.0);\n#endif';
  }
  if (LIVE_GLSL[spec.kind]) {
    if (spec.kind === 'water') h.normal = 'normal = mgBump(normal, msH * 0.002, 1.0);';
    h.emissive = (h.emissive ? h.emissive + '\n' : '') + 'totalEmissiveRadiance += msEmit * max(uLampGain, msD.x);';
  }
  if (trans) {
    h.fragmentDecl += 'float msTrans = 1.0;\n';
    h.output = `#ifdef USE_TRANSMISSION
{ vec3 mgD0 = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  outgoingLight += mix(mgD0, transmitted.rgb, msTrans * material.transmission) - totalDiffuse;
  material.transmissionAlpha = mix(1.0, material.transmissionAlpha, msTrans); }
#endif`;
  }
  if (spec.kind === 'glass' && !trans) {
    h.output = /* glsl */ `{
      vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
      float F = 0.04 + 0.96 * pow(1.0 - abs(dot(N, V)), 5.0);
      float a = clamp(msAlpha + (1.0 - msAlpha) * F, 0.02, 1.0);
      outgoingLight /= a; diffuseColor.a = a;   // premultiplied blending: reflection added, the scene behind kept by 1 - a
    }`;
  }
  if (o.decals) {
    const d = o.decals, r = d.rills || {}, lk = d.leaks || {};
    uniforms.msDa = { value: new THREE.Vector4(+(r.top ?? lk.top ?? 3), +(r.length ?? 1.2), +(r.density ?? (d.rills ? 0.6 : 0)), +(d.damp ?? 0)) };
    uniforms.msDb = { value: new THREE.Vector4(+(d.stains ?? 0), +(d.cracks ?? 0), +(d.soot ?? 0), +(typeof lk === 'number' ? lk : lk.spacing ?? 0)) };
    uniforms.msDecalAtlas = { value: o.decalAtlas || null };
  }
  if (o.paint) uniforms.msPaint = { value: new THREE.Vector4(...lin(o.paintColor, [0.62, 0.6, 0.55]), +(o.paintWear ?? 0.6)) };
  if (o.edges === 'box') {
    // edge wear without bevels or attributes: the distance to the edges of the drawn geometry's bounding box (crates,
    // containers, slabs, walls: any box-like mesh), refreshed per draw from the geometry and the object's scale
    uniforms.msBoxLo = { value: new THREE.Vector3(-0.5, -0.5, -0.5) }; uniforms.msBoxHi = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
    uniforms.msBoxS = { value: new THREE.Vector4(1, 1, 1, +(o.edgeWidth ?? 0.03)) };
    const sc = new THREE.Vector3();
    h.attach = (m) => {
      const prev = m.onBeforeRender;
      m.onBeforeRender = function (r, s, c, geo, obj, grp) {
        if (prev) prev.call(this, r, s, c, geo, obj, grp);
        if (!geo.boundingBox) geo.computeBoundingBox();
        uniforms.msBoxLo.value.copy(geo.boundingBox.min); uniforms.msBoxHi.value.copy(geo.boundingBox.max);
        obj.getWorldScale(sc); uniforms.msBoxS.value.set(sc.x, sc.y, sc.z, +(o.edgeWidth ?? 0.03));
        this.uniformsNeedUpdate = true;
      };
    };
  }
  if (o.debug) {
    const out = { albedo: 'msAlb', rough: 'vec3(msR)', height: 'vec3(msH)', metal: 'vec3(msM)' }[o.debug];
    if (!out) throw new RangeError("surfaceHooks: debug must be 'albedo' | 'rough' | 'height' | 'metal'");
    h.output = `outgoingLight = ${out}; diffuseColor.a = 1.0;`;
  }
  return h;
}

// ---- the baker ------------------------------------------------------------------------------------------------------
const BAKE_VS = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const bakeFS1 = (kind) => `precision highp float; precision highp int;
uniform float msN; uniform float uTime; uniform vec3 cameraPosition;
${NOISE_GLSL}
${MS_COMMON}
vec3 mgWorldPos = vec3(0.0), mgWorldNormal = vec3(0.0, 1.0, 0.0);
${KIND_GLSL[kind]}
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main(){
  msT = msX.x; msSeed = msX.y; msFP = msT / msN; msLodA = 2.0;
  vec2 u = gl_FragCoord.xy / msN * msT;
  MsS s = ms_${kind}(u);
  o0 = vec4(max(s.a, 0.0), clamp(s.r, 0.02, 1.0));
  o1 = vec4(clamp(s.h, 0.0, 1.0), clamp(s.m, 0.0, 1.0), clamp(s.ao, 0.0, 1.0), 1.0);
}`;
const BAKE_FS2 = `precision highp float; precision highp int;
uniform sampler2D t0; uniform sampler2D t1; uniform float msN; uniform vec4 msX; uniform vec4 msY;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
float hAt(ivec2 p){ int N = int(msN); return texelFetch(t1, ivec2((p.x + N) % N, (p.y + N) % N), 0).r; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float texel = msX.x / msN;
  vec2 g = vec2(hAt(p + ivec2(1, 0)) - hAt(p - ivec2(1, 0)), hAt(p + ivec2(0, 1)) - hAt(p - ivec2(0, 1))) / (2.0 * texel) * msY.y;
  vec3 n = normalize(vec3(-g, 1.0));
  vec4 a = texelFetch(t0, p, 0), b = texelFetch(t1, p, 0);
  o0 = vec4(a.rgb * b.b, a.a);
  o1 = vec4(n.xy * 0.5 + 0.5, b.r, b.g);
}`;

const BAKERS = new WeakMap();
/** Render a surface's tile into a texture set: { c: albedo (sRGB, cavity folded in) + roughness (A), n: normal xy +
 *  height + metalness, size, ms (CPU-side time of the bake call; the GPU work is flushed), bytes }. */
export function bakeSurface(renderer, spec, { size = 0, anisotropy = 8 } = {}) {
  if (spec.live) throw new Error(`bakeSurface: ${spec.kind} is a live surface (per pixel only)`);
  const N = size || spec.size || 1024;
  const t0 = performance.now();
  const rt1 = new THREE.WebGLRenderTarget(N, N, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const rt2 = new THREE.WebGLRenderTarget(N, N, { count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
  const aniso = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  rt2.textures.forEach((t, i) => {
    t.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = aniso;
    t.name = `surface-${spec.kind}-${i ? 'n' : 'c'}`;
  });
  const U = spec.uniforms;
  // the two passes' materials, kept per renderer and kind (a second bake of a kind compiles nothing)
  let per = BAKERS.get(renderer);
  if (!per) BAKERS.set(renderer, (per = { quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), kinds: {}, m2: null }));
  if (!per.kinds[spec.kind]) {
    const uni = { msN: { value: 0 }, uTime: { value: 0 }, cameraPosition: { value: new THREE.Vector3() } };
    for (const k of ['X', 'Y', 'W', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) uni['ms' + k] = { value: new THREE.Vector4() };
    per.kinds[spec.kind] = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: bakeFS1(spec.kind), uniforms: uni });
  }
  if (!per.m2) per.m2 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: BAKE_FS2,
    uniforms: { t0: { value: null }, t1: { value: null }, msN: { value: 0 }, msX: { value: new THREE.Vector4() }, msY: { value: new THREE.Vector4() } } });
  const m1 = per.kinds[spec.kind], m2 = per.m2, uni = m1.uniforms;
  uni.msN.value = N;
  for (const k of ['X', 'W', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) uni['ms' + k].value.fromArray(U[k]);
  uni.msY.value.set(0, spec.depth, 0, 0);
  m2.uniforms.t0.value = rt1.textures[0]; m2.uniforms.t1.value = rt1.textures[1]; m2.uniforms.msN.value = N;
  m2.uniforms.msX.value.copy(uni.msX.value); m2.uniforms.msY.value.copy(uni.msY.value);
  const quad = per.quad; quad.material = m1; quad.frustumCulled = false;
  const cam = per.cam;
  const prev = renderer.getRenderTarget(), prevXR = renderer.xr.enabled, prevAuto = renderer.autoClear;
  renderer.xr.enabled = false; renderer.autoClear = false;
  renderer.setRenderTarget(rt1); renderer.render(quad, cam);
  quad.material = m2; renderer.setRenderTarget(rt2); renderer.render(quad, cam);
  renderer.setRenderTarget(prev); renderer.xr.enabled = prevXR; renderer.autoClear = prevAuto;
  rt1.dispose();
  const ms = performance.now() - t0;
  return { c: rt2.textures[0], n: rt2.textures[1], target: rt2, size: N, ms, bytes: Math.round(N * N * 8 * 4 / 3) };
}

// ---- the decal atlas ------------------------------------------------------------------------------------------------
const DECAL_FS = `precision highp float; precision highp int;
uniform float msN;
${NOISE_GLSL}
layout(location = 0) out vec4 o0;
float fbm(vec2 p, int o){ return mgFbm2(p, o); }
void main(){
  vec2 px = gl_FragCoord.xy / msN;              // atlas 0..1 (4 x 2 cells)
  vec2 cell = floor(px * vec2(4.0, 2.0)), q = fract(px * vec2(4.0, 2.0));
  int id = int(cell.x + 4.0 * cell.y);
  float m = 0.0, fade = smoothstep(0.0, 0.08, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y)));
  if (id == 0) {        // one long crack, wandering down, a branch, its width varying
    float x = 0.5 + 0.18 * fbm(vec2(q.y * 3.0, 1.0), 4);
    float w = 0.004 + 0.006 * (fbm(vec2(q.y * 9.0, 4.0), 2) * 0.5 + 0.5);
    m = 1.0 - smoothstep(w, w + 0.004, abs(q.x - x));
    float bx = x + (q.y - 0.55) * 0.6 + 0.05 * fbm(vec2(q.y * 8.0, 7.0), 3);
    m = max(m, (1.0 - smoothstep(0.003, 0.006, abs(q.x - bx))) * step(q.y, 0.55) * step(0.25, q.y));
  } else if (id == 1) { // a crack network (shrinkage)
    vec2 p = q * 5.0 + 0.15 * vec2(fbm(q * 8.0, 2), fbm(q * 8.0 + 3.0, 2));
    vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(float(x), float(y)); vec2 r = o + mgHash3(vec3(i + o, 2.0)).xy - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else d2 = min(d2, d); }
    m = 1.0 - smoothstep(0.02, 0.05, sqrt(d2) - sqrt(d1));
    m *= smoothstep(0.55, 0.3, length(q - 0.5));
  } else if (id == 2) { // rain rills from a ledge: thin dark runs of random length, joined at the top
    float x = q.x * 9.0, k = floor(x), f = fract(x) - 0.5 + 0.12 * fbm(vec2(q.y * 4.0, k), 2);
    float len = 0.35 + 0.65 * mgHash3(vec3(k, 1.0, 2.0)).x;
    m = (1.0 - smoothstep(0.1, 0.3, abs(f))) * (1.0 - smoothstep(len * 0.7, len, q.y)) + (1.0 - smoothstep(0.0, 0.12, q.y)) * 0.6;
    m *= 0.6 + 0.4 * (fbm(q * vec2(6.0, 30.0), 2) * 0.5 + 0.5);
  } else if (id == 3) { // a drip: a long run with a bulb at its end
    float f = abs(q.x - 0.5 - 0.02 * fbm(vec2(q.y * 5.0, 3.0), 2));
    m = (1.0 - smoothstep(0.02, 0.05, f)) * step(q.y, 0.85) + (1.0 - smoothstep(0.05, 0.08, length(q - vec2(0.5, 0.88))));
  } else if (id == 4) { // soot plume: from a source at the bottom, spreading upward
    float spread = 0.08 + 0.35 * q.y;
    float n = fbm(q * vec2(3.0, 2.0) + vec2(0.0, -q.y), 4) * 0.5 + 0.5;
    m = (1.0 - smoothstep(spread * 0.4, spread, abs(q.x - 0.5))) * (1.0 - smoothstep(0.6, 1.0, q.y)) * (0.5 + 0.7 * n);
  } else if (id == 5) { // a water stain with a tide ring
    float r = length(q - 0.5) * 2.0 + 0.15 * fbm(q * 5.0, 3);
    m = (1.0 - smoothstep(0.7, 0.85, r)) * 0.45 + (1.0 - smoothstep(0.0, 0.05, abs(r - 0.8))) * 0.6;
  } else if (id == 6) { // a rust leak under a fixing: dense at the top, thinning down
    float f = abs(q.x - 0.5 - 0.04 * fbm(vec2(q.y * 4.0, 5.0), 2));
    m = (1.0 - smoothstep(0.04 + 0.12 * q.y, 0.08 + 0.2 * q.y, f)) * (1.0 - smoothstep(0.2, 1.0, q.y)) * (0.7 + 0.3 * fbm(q * 12.0, 2));
  } else {              // splash-back: speckle along the bottom edge
    m = step(0.75, fbm(q * 40.0, 2) * 0.5 + 0.5 + 0.4 * (1.0 - q.y)) * (1.0 - smoothstep(0.0, 0.5, q.y));
  }
  o0 = vec4(clamp(m, 0.0, 1.0) * fade, 0.0, 0.0, 1.0);
}`;
/** The weathering decal masks (8, procedural) rendered once into an atlas (4 x 2 cells), for options.decals. */
export function bakeDecalAtlas(renderer, size = 1024) {
  const rt = new THREE.WebGLRenderTarget(size, size / 2, { type: THREE.UnsignedByteType, depthBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false; rt.texture.name = 'surface-decals';
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: DECAL_FS, uniforms: { msN: { value: size } } });
  m.fragmentShader = m.fragmentShader.replace('vec2 px = gl_FragCoord.xy / msN;', 'vec2 px = gl_FragCoord.xy / vec2(msN, msN * 0.5);');
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); renderer.setRenderTarget(prev);
  m.dispose(); quad.geometry.dispose();
  return rt;
}

// ---- the library bound to a world -----------------------------------------------------------------------------------
/**
 * createSurfaces(world, { mode = 'auto' | 'baked' | 'procedural', size, anisotropy, tier = 'high' | 'low' }) -> {
 *   (tier 'low': every set at half its kind's size, a quarter of the memory; 'auto': baked, except
 *   the kinds cheaper per pixel than their taps: tile, stainless, chrome, metal, carPaint, rubber, bamboo, carbonFibre)
 *   material(spec, options)  a ready MeshStandard / MeshPhysical material (options: see surfaceHooks, plus wet: true |
 *                            withWet options, mode, size, and three material parameters in `params`)
 *   hooks(spec, options)     the hooks (baked on demand), to combine yourself
 *   bake(spec, size?)        the texture set (cached per kind, numbers and size)
 *   stats()                  { baked, ms, bytes, materials }
 *   dispose()
 * }
 */
export function createSurfaces(world, { mode = 'auto', size = 0, anisotropy = 8, tier = 'high' } = {}) {
  const renderer = world.renderer, kit = world.mat;
  const cache = new Map();
  let atlas = null, bakeMs = 0, made = 0;
  // 'auto': bake the kinds whose recipe costs more than its texture taps; the cheap ones (a grid, a few lines) run per pixel
  const pathOf = (spec, m) => (spec.live ? 'procedural' : m === 'auto' ? (KINDS[spec.kind].cheap ? 'procedural' : 'baked') : m);
  // the set's size: an explicit one, else the kind's own (its detail needs it); tier 'low' halves it (a quarter of the
  // memory: phones), never under 256
  const sizeOf = (spec, sz) => sz || (tier === 'low' ? Math.max(256, (spec.size || 1024) >> 1) : spec.size || 1024);
  const bake = (spec, sz = size) => {
    const N = sizeOf(spec, sz), key = spec.bakeKey + ':' + N;
    if (!cache.has(key)) { const b = bakeSurface(renderer, spec, { size: N, anisotropy }); bakeMs += b.ms; cache.set(key, b); }
    return cache.get(key);
  };
  const hooks = (spec, o = {}) => {
    const m = pathOf(spec, o.mode || mode);
    const extra = {};
    if (m === 'baked') extra.baked = bake(spec, o.size || size);
    if (o.decals) extra.decalAtlas = (atlas ??= bakeDecalAtlas(renderer)).texture;
    let h = surfaceHooks(spec, { ...o, ...extra, mode: m });
    if (o.wet) h = withWet(h, { porosity: spec.porosity, height: 'msH', heightMid: 0.5, heightScale: Math.max(spec.depth, 0.004), ground: o.ground ?? 0, ...(o.wet === true ? {} : o.wet) });
    return h;
  };
  const material = (spec, o = {}) => {
    const h = hooks(spec, o);
    const base = { roughness: 1, metalness: 1, ...spec.material, ...(o.params || {}) };
    const trans = spec.kind === 'glass' && !!o.transmission;
    if (trans) {
      // the transmission path (three's): the scene behind is refracted, tinted by the pane's attenuation and blurred
      // by its roughness (frosted); costs a pass over the opaque scene per frame (shared by every transmissive material)
      const tint = new THREE.Color().setRGB(...spec.options.color);
      Object.assign(base, { transmission: 1, ior: 1.52, thickness: +(o.thickness ?? 0.006), attenuationColor: tint, attenuationDistance: spec.variant === 'tinted' ? 0.012 : 0.6, metalness: 1, ...(o.params || {}) });
    } else if (spec.kind === 'glass') Object.assign(base, { transparent: true, premultipliedAlpha: true, depthWrite: false, metalness: 1, ...(o.params || {}) });
    const m = spec.physical || trans ? kit.phys(base, h) : kit.std(base, h);
    m.name = `surface-${spec.kind}-${spec.variant}`;
    // footsteps (@miragekit/game reads userData.surface: 'stone' | 'gravel' | 'grass' | 'wood'); the spec beside it
    m.userData.surface = FOOTSTEP[KINDS[spec.kind].family] || 'stone';
    m.userData.surfaceKind = { kind: spec.kind, variant: spec.variant, mode: pathOf(spec, o.mode || mode) };
    made++;
    return m;
  };
  const stats = () => ({ baked: cache.size, ms: +bakeMs.toFixed(2), bytes: [...cache.values()].reduce((s, b) => s + b.bytes, 0) + (atlas ? atlas.width * atlas.height * 4 : 0), materials: made });
  const dispose = () => { for (const b of cache.values()) b.target.dispose(); cache.clear(); if (atlas) atlas.dispose(); atlas = null; };
  return { material, hooks, bake, stats, dispose, SURFACES, KINDS: SURFACE_KINDS };
}

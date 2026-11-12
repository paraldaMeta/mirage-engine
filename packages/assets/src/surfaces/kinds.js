// Mirage original code.
// ---------------------------------------------------------------------------
// The surface library's kinds: one table entry per kind (the numbers a recipe takes, how they pack into its uniforms,
// the measured reference ranges its defaults sit in: the calibration data) and the F0 of common metals. The recipes'
// GLSL is glsl.js; the framework that turns both into materials is @miragekit/core's createSurfaces.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const lin = (c, d) => {
  if (c == null) return d;
  if (Array.isArray(c)) return c.map(Number);
  const k = new THREE.Color(c); return [k.r, k.g, k.b];
};
const snap = (T, s) => T / Math.max(1, Math.round(T / s));
// gravity in the surface's own plane (u, v), snapped to an axis (rotations by quarter turns keep the tile periodic):
// [0, -1] = down v (a wall under 'wall' mapping); [-1, 0] = down u (a sheet mapped with grain: 'y', u up)
const fall = (g) => { const [x, y] = Array.isArray(g) ? g.map(Number) : [0, -1]; return Math.abs(x) > Math.abs(y) ? [Math.sign(x), 0] : [0, y > 0 ? 1 : -1]; };

// ---- the kinds ------------------------------------------------------------------------------------------------------
// tile (m), depth (m: height 0..1 spans it), size (bake px), porosity (withWet), refs: measured ranges the defaults
// sit in (linear albedo or F0, roughness, metalness), quantum: the repetition breaker's offset step (m, the pattern's
// module), edge: what worn edges expose, dirt: the grime colour.
const STEEL = [0.53, 0.53, 0.54];
export const KINDS = {
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
    family: 'polymer', variants: ['tread', 'sidewall', 'moulded', 'mat'], tile: 0.6, depth: 0.008, size: 512, porosity: 0.05,
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

// ---- program pieces of single kinds (the framework calls them: body, hooks, prepare) ----------------------------------
// glass through the transmission pass: dirt and wire opaque, the clean pane transmits (tinted by its attenuation);
// the share per pixel is applied at the output (three mixes by its uniform; the diffuse before it is re-mixed)
KINDS.glass.body = (spec, o) => (o.transmission ? '  msTrans = clamp(1.0 - (msAlpha - msA.a) / max(1.0 - msA.a, 1e-3), 0.0, 1.0); if (msX.z > 1.5 && msX.z < 2.5) msTrans = 1.0 - 0.35 * (1.0 - msTrans); msS.a = mix(msS.a, msA.rgb, msTrans);\n' : '');
KINDS.glass.hooks = (h, spec, o) => {
  if (o.transmission) {
    h.fragmentDecl += 'float msTrans = 1.0;\n';
    h.output = `#ifdef USE_TRANSMISSION
{ vec3 mgD0 = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  outgoingLight += mix(mgD0, transmitted.rgb, msTrans * material.transmission) - totalDiffuse;
  material.transmissionAlpha = mix(1.0, material.transmissionAlpha, msTrans); }
#endif`;
  } else {
    h.output = /* glsl */ `{
      vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal);
      float F = 0.04 + 0.96 * pow(1.0 - abs(dot(N, V)), 5.0);
      float a = clamp(msAlpha + (1.0 - msAlpha) * F, 0.02, 1.0);
      outgoingLight /= a; diffuseColor.a = a;   // premultiplied blending: reflection added, the scene behind kept by 1 - a
    }`;
  }
};
KINDS.glass.prepare = (base, spec, o) => {
  if (o.transmission) {
    // the transmission path (three's): the scene behind is refracted, tinted by the pane's attenuation and blurred
    // by its roughness (frosted); costs a pass over the opaque scene per frame (shared by every transmissive material)
    const tint = new THREE.Color().setRGB(...spec.options.color);
    Object.assign(base, { transmission: 1, ior: 1.52, thickness: +(o.thickness ?? 0.006), attenuationColor: tint, attenuationDistance: spec.variant === 'tinted' ? 0.012 : 0.6, metalness: 1, ...(o.params || {}) });
    return true;
  }
  Object.assign(base, { transparent: true, premultipliedAlpha: true, depthWrite: false, metalness: 1, ...(o.params || {}) });
  return false;
};
// car paint: the clear coat's own orange peel (a slow wave), on its own normal
KINDS.carPaint.hooks = (h, spec) => {
  if (spec.physical) h.emissive = '#ifdef USE_CLEARCOAT\nclearcoatNormal = mgBump(clearcoatNormal, mgFbm3(mgWorldPos * 140.0, 2) * 0.00004 * clamp(0.004 / max(msFP, 1e-6) - 0.5, 0.0, 1.0), 1.0);\n#endif';
};
// standing water: a flatter normal than its height would give
KINDS.water.hooks = (h) => { h.normal = 'normal = mgBump(normal, msH * 0.002, 1.0);'; };

/** F0 (linear) of common metals */
export const METALS = {
  iron: [0.53, 0.51, 0.5], steel: [0.56, 0.57, 0.58], stainless: [0.58, 0.58, 0.56], castIron: [0.45, 0.44, 0.43], aluminium: [0.91, 0.92, 0.92],
  chrome: [0.55, 0.56, 0.55], copper: [0.96, 0.64, 0.54], brass: [0.91, 0.78, 0.42], bronze: [0.8, 0.6, 0.38], gold: [1.0, 0.77, 0.34],
  silver: [0.97, 0.96, 0.92], titanium: [0.54, 0.5, 0.45], nickel: [0.65, 0.61, 0.54], zinc: [0.62, 0.64, 0.66], lead: [0.63, 0.63, 0.64],
};

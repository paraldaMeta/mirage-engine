# Surfaces: a material library made in code

`@miragekit/core` ships a library of physically plausible surfaces: concrete, asphalt, paving, brick, render,
ceramic tile, corrugated and painted steel, stainless, galvanised, cast iron, aluminium, chrome, raw metals, powder
coat, car paint, glass, plastics, rubber, fabric, paper and board, wood, bamboo, leather, carbon fibre, glazed
ceramic, roofing, and the emissive and liquid surfaces a night city needs (neon tube, fluorescent tube, LED panel,
LCD, backlit acrylic, paper lantern, water, oil sheen). No image ships with it: every surface is a GLSL recipe.

```js
import { SURFACES, createSurfaces } from '@miragekit/core';
const lib = createSurfaces(world);                                          // baked by default
const wall = lib.material(SURFACES.concrete({ variant: 'cast', age: 0.5 }), { mapping: 'wall', wet: true });
const road = lib.material(SURFACES.asphalt({ variant: 'worn', oil: 0.3 }), { mapping: 'ground', wet: { puddles: 1.5 }, paint: 'myLineMask' });
const deck = lib.material(SURFACES.wood({ variant: 'planks' }), { mapping: 'grain', grain: [0, 0, 1] });
const sign = lib.material(SURFACES.neon({ color: [1, 0.16, 0.5] }));
```

Live: `examples/demos/materials` (`node packages/tools/src/package.mjs examples/demos/materials --out out/materials.html`).
Pick a surface, a lighting (studio, golden hour, night with a white and a coloured lamp), dry or wet, a view (5 m,
0.5 m on the cube's edge, 0.5 m on the wall, 0.5 m on the ground), baked or procedural.

## How it works

A surface is a **recipe** (`MsS ms_<kind>(vec2 u)` in `packages/core/src/surface-glsl.js`) plus **numbers**
(`SURFACES.<kind>(options)` packs them into eight `vec4` uniforms). The recipe returns, for a point `u` of the
surface in metres: linear albedo (a metal's F0), roughness, height 0..1 (the kind's `depth` in metres), metalness
and cavity occlusion. Three scales of variation are in every recipe: **macro** (stains, clouds, panel and board
tones, 0.1..1 m), **meso** (aggregate, chips, grain, pits, 1..30 mm), **micro** (sand, fibres, orange peel, below
1 mm). Every pattern repeats exactly over the kind's tile (lattice noise hashed modulo the tile's cell count; grids
snapped to a whole number of modules), which is what makes the two paths give the same surface:

- **procedural**: the recipe runs per pixel. Octaves and features finer than ~3 pixel footprints are not evaluated
  (`msLod`, from `dFdx` / `dFdy` of the world position): far pixels cost less and do not shimmer. The height becomes
  a normal through `mgBump`.
- **baked** (default): the recipe is rendered once, on the GPU, into a tileable set: `c` = albedo with the cavity
  folded in (sRGB) + roughness (A), `n` = normal xy + height + metalness; 512 or 1024 px, mipmapped, anisotropic.
  Materials sample it with the same mapping, a **repetition breaker** (patches of ~3 tiles take one of six offsets,
  whole pattern modules for patterned kinds, neighbours cross-fade along the height) and the same runtime layer.
  Deterministic (seeded); cached per kind, numbers and size; the bake programs are kept per kind (a second bake
  compiles nothing).

The **runtime layer** is live in both paths (uniforms; nothing is re-baked when it changes): world-space macro
variation (hides the tile), dirt in cavities / at the foot / on top faces, run-off streaks on walls (age), edge
wear (from the surface's curvature, or a vertex attribute `edge` 0..1 with `edges: 'attribute'`; what an edge
exposes is the kind's: primer and steel under paint, steel under powder coat, paler concrete, whitened plastic),
and, opt-in, weathering decals and road paint. It reads one shared 256 x 256 noise texture (`noiseTexture()`,
made once in JS) instead of hashing.

Everything goes through `patch()`: lighting, shadows, image-based light, fog, the wet layer, planar and
screen-space reflections, probes and the lamp pool keep working. Materials of one kind that differ only by numbers
share a program (the kind, the mapping, the path, wet or dry, decals and road paint make the program).

## API

| name | |
|---|---|
| `SURFACES.<kind>(options)` | a spec. Common options: `variant`, `color` (linear `[r, g, b]` or a hex / CSS colour, sRGB), `roughness`, `scale` (pattern size), `seed`, `age` 0..1 (baked: bleed, erosion; live: streaks), `dirt` 0..1, `edgeWear` 0..1, `variation` 0..1 (macro), `dirtColor`, `tile` (m), `porosity`. Each kind adds its own (see `SURFACE_KINDS[kind].defaults`) |
| `SURFACE_KINDS` | per kind: `family`, `variants`, `tile`, `depth`, `size`, `porosity`, `live`, `physical`, `refs` (the measured ranges below), `defaults` |
| `createSurfaces(world, { mode, size, anisotropy })` | `{ material(spec, options), hooks(spec, options), bake(spec, size?), stats(), dispose() }` |
| `lib.material(spec, options)` | a `MeshStandardMaterial` (`MeshPhysicalMaterial` for car paint, carbon fibre, fabric's sheen, oil). Options: `mapping` `'tri'` (default; objects) \| `'wall'` (u along the wall, v up, tops by the ground projection) \| `'ground'` \| `'grain'` (u along `grain: [x, y, z]` projected into each face: stairs, sloped faces, boards in any direction, one tap) \| `'uv'` (the mesh's uv x `uvScale` metres); `grain: 'x' \| 'y' \| 'z'` keeps that axis as u in the planar mappings; `space: 'world' \| 'object'` (object: the pattern rides on moving things); `mode`; `size`; `wet: true \| withWet options` (porosity, height from the kind); `ground` (m, the foot of dirt and damp); `breaker`; `edges`; `decals`; `paint` / `paintColor` / `paintWear` (asphalt road marking: a GLSL float mask); `params` (three material parameters) |
| `lib.hooks(spec, options)` | the same as hooks, to pass to `world.mat.std` / `phys` yourself |
| `surfaceHooks(spec, options)` | the hooks without a library (`mode: 'baked'` needs `baked: { c, n }`); `debug: 'albedo' \| 'rough' \| 'height' \| 'metal'` writes that channel to the output |
| `bakeSurface(renderer, spec, { size, anisotropy })` | `{ c, n, target, size, ms, bytes }` |
| `bakeDecalAtlas(renderer, size)` | the decal masks (4 x 2: crack, crack network, rain rills, drip, soot plume, water stain with tide ring, rust leak, splash-back) |
| `noiseTexture()` | the runtime layer's shared noise |
| `METALS` | F0 of common metals (`SURFACES.metal({ metal: 'brass' })`) |

### Weathering decals (`decals`)

Placed by rules in the wall's own coordinates (u along the wall, v up), drawn from a decal atlas baked once:
`rills: { top, length, density }` (rain rills hanging from a ledge at height `top`), `damp` (m: damp rising from the
ground with a salt tide line), `stains`, `cracks`, `soot` (densities 0..1, scattered), `leaks: { spacing }` (rust
runs under a fixing row at `rills.top`, every `spacing` metres). One define and two uniforms; the numbers are live.

## The kinds and their reference values

The defaults sit in measured real-world ranges (linear albedo; metals by F0). Metalness is 0 or 1; in-between values
appear only where the kind mixes a metal with a film at sub-pixel scale (rust and dirt over metal, the platelets of a
metallic paint at range). `npm test` (`packages/core/surfaces.check.mjs`) holds the defaults to these ranges;
`packages/tools/src/surfaces-check.mjs` reads a bake back and holds its texels to them.

| kind | family | variants | tile m | depth mm | porosity | albedo / F0 (linear) | roughness | metalness | reference |
|---|---|---|---|---|---|---|---|---|---|
| `concrete` | masonry | cast, boardFormed, painted, precast | 2.4 | 6 | 0.8 | 0.18–0.42 | 0.75–0.95 | 0 | Portland cement concrete 0.20-0.40 (fresh grey ~0.35, weathered 0.20-0.30) |
| `asphalt` | ground | fresh, worn, patched | 1.2 | 5 | 0.35 | 0.03–0.16 | 0.3–0.95 | 0 | binder 0.03-0.06; aggregate 0.10-0.30; worn surface overall 0.08-0.14; crack sealant (tar) glossy 0.3-0.4 |
| `paving` | ground | slabs, setts, polished | 2.4 | 12 | 0.5 | 0.08–0.42 | 0.1–0.95 | 0 | concrete flags 0.25-0.35, granite setts 0.10-0.30, polished granite 0.08-0.40 (roughness 0.10-0.30) |
| `brick` | masonry | common, engineering, painted, stock | 2.25 | 20 | 0.7 | 0.06–0.45 | 0.5–0.95 | 0 | red clay brick R 0.20-0.40; engineering blue 0.05-0.10 (dense, roughness ~0.6); London stock ~(0.40, 0.30, 0.17); lime mortar 0.35-0.55 |
| `render` | masonry | smooth, pebbledash, roughcast | 2 | 4 | 0.75 | 0.3–0.8 | 0.75–0.95 | 0 | cement / lime render 0.40-0.75; painted white ~0.75 |
| `tile` | ceramic | subway, square, mosaic, floor | 1.2 | 4 | 0.1 | 0.03–0.85 | 0.04–0.95 | 0 | white glaze 0.70-0.85 (roughness 0.05-0.15); grout 0.30-0.60 (per pixel under auto) |
| `corrugated` | metal | galvanised, painted, rusted | 1.52 | 18 | 0.1 | 0.05–0.7 | 0.25–0.95 | zinc 1 / paint 0 / rust 0 | zinc F0 ~(0.62, 0.64, 0.66); rust 0.10-0.35 (R) |
| `paintedMetal` | metal | sheet, panels, enamel | 2 | 3 | 0.1 | 0.03–0.85 | 0.15–0.92 | paint 0 / bare steel 1 / rust 0 | paint as its pigment (white 0.70-0.85, black 0.03-0.05); bare steel F0 (0.53, 0.53, 0.54); red-oxide primer ~(0.25, 0.08, 0.05) |
| `stainless` | metal | brushed, polished, blasted | 0.6 | 0.6 | 0.05 | 0.5–0.7 | 0.03–0.5 | 1 | stainless steel F0 ~(0.58, 0.58, 0.56); brushed roughness 0.25-0.40, polished 0.04-0.10 (per pixel under auto) |
| `galvanised` | metal | new, weathered | 1 | 0.6 | 0.05 | 0.4–0.72 | 0.25–0.95 | zinc 1 / white rust 0 | zinc F0 ~(0.62, 0.64, 0.66); patina ~0.42; white rust ~0.6 dielectric |
| `castIron` | metal | manhole, plain, grate | 0.8 | 12 | 0.2 | 0.006–0.55 | 0.3–0.95 | worn tops 1 / rust and grime 0 | cast iron F0 ~(0.45, 0.44, 0.43), darker than wrought; rust 0.10-0.35 |
| `aluminium` | metal | anodised, extruded, tread, cast | 0.6 | 3 | 0.05 | 0.4–0.95 | 0.2–0.8 | aluminium 1 / a white oxide bloom over it 0 | aluminium F0 (0.91, 0.92, 0.92); anodised: the dye tints it |
| `chrome` | metal | new, pitted | 0.5 | 0.5 | 0.02 | 0.5–0.6 | 0.02–0.12 | 1 | chromium F0 (0.55, 0.56, 0.55) (per pixel under auto) |
| `metal` | metal | machined, cast, worn | 0.5 | 0.6 | 0.05 | 0.4–1 | 0.05–0.7 | 1 | F0 by metal: iron (0.53, 0.51, 0.50), copper (0.96, 0.64, 0.54), brass (0.91, 0.78, 0.42), gold (1.0, 0.77, 0.34), titanium (0.54, 0.50, 0.45), nickel (0.65, 0.61, 0.54), silver (0.97, 0.96, 0.92), zinc (0.62, 0.64, 0.66) (per pixel under auto) |
| `powderCoat` | coating | powder, cerakote, wrinkle | 0.5 | 0.8 | 0.05 | 0.02–0.85 | 0.3–0.75 | coat 0 / worn edges 1 | a dielectric coat: black powder coat 0.03-0.05, not a dark metal; worn edges show the metal under it |
| `carPaint` | coating | solid, metallic, pearl, matte | 0.3 | 0.15 | 0 | 0.02–0.85 | 0.05–0.6 | binder 0 / flakes 1 (their share at range) | base coat as its pigment, a clear coat (F0 0.04, roughness 0.02-0.08) on top; metallic: aluminium flakes (per pixel under auto) |
| `glass` | glass | clear, tinted, frosted, wired, dirty | 1.6 | 0.4 | 0 | 0–0.9 | 0–0.8 | glass 0 / wire 1 | soda-lime glass F0 0.04 (IOR 1.52); clear transmits ~0.9 |
| `plastic` | polymer | abs, textured, diffuser, hdpe | 0.5 | 0.4 | 0 | 0.02–0.85 | 0.15–0.7 | 0 | pigmented plastics: black 0.03-0.05, white 0.60-0.80; ABS gloss 0.15-0.3, textured 0.45-0.65 |
| `rubber` | polymer | tread, sidewall, moulded, mat | 0.6 | 8 | 0.05 | 0.015–0.06 | 0.6–0.95 | 0 | tyre rubber 0.02-0.04 (carbon black), bloom to ~0.1 (per pixel under auto) |
| `fabric` | textile | canvas, tarpaulin, cotton, nylon | 0.5 | 2.5 | 0.9 | 0.03–0.75 | 0.45–0.98 | 0 | canvas 0.30-0.60 (a scanned canvas set averages 0.53); cotton 0.85-0.95 rough |
| `paper` | fibre | cardboard, boardEdge, paper | 0.5 | 0.8 | 0.95 | 0.15–0.85 | 0.7–0.95 | 0 | kraft board ~(0.42, 0.29, 0.16); white paper 0.70-0.85 |
| `wood` | wood | planks, plywood, painted, weathered, varnished, sawn | 2.4 | 4 | 0.7 | 0.02–0.6 | 0.15–0.92 | 0 | pine 0.35-0.50, oak ~(0.30, 0.19, 0.10), old planks (scan) ~(0.10, 0.08, 0.05), teak (scan) ~(0.08, 0.03, 0.01), silvered ~0.30 |
| `bamboo` | wood | poles, slats | 1 | 12 | 0.5 | 0.15–0.55 | 0.3–0.8 | 0 | dried bamboo ~(0.45, 0.36, 0.18), its skin waxy (0.3-0.45) (per pixel under auto) |
| `leather` | polymer | leather, vinyl, suede, aged | 0.4 | 0.8 | 0.4 | 0.03–0.4 | 0.4–0.95 | 0 | tanned leather 0.05-0.25; black vinyl 0.03-0.05 |
| `carbonFibre` | composite | twill | 0.192 | 0.3 | 0 | 0.015–0.06 | 0.2–0.5 | 0 | carbon tows ~0.03 under an epoxy clear coat (F0 0.04) (per pixel under auto) |
| `ceramic` | ceramic | glazed, bisque, enamel | 0.3 | 0.5 | 0.05 | 0.03–0.85 | 0.03–0.85 | 0 | glazed porcelain 0.05-0.15 rough; brown insulator glaze ~(0.25, 0.09, 0.04); bisque 0.6-0.8 rough |
| `roofing` | ground | felt, epdm, gravel | 2 | 6 | 0.3 | 0.03–0.4 | 0.6–0.95 | 0 | bitumen 0.04-0.06; mineral granules 0.10-0.20; ballast gravel 0.25-0.45 |
| `neon` | emissive | tube | 1 | 0.1 | 0 | 0–0.7 | 0.03–0.1 | 0 | glass tube F0 0.04; the gas column saturated (neon red, argon-mercury blue / phosphor colours) |
| `fluorescent` | emissive | tube | 1 | 0.1 | 0 | 0.7–0.9 | 0.2–0.3 | 0 | phosphor coat white ~0.82 when off |
| `ledPanel` | emissive | bare, diffused | 1 | 2 | 0 | 0.02–0.6 | 0.15–0.6 | 0 | black LED module face 0.02-0.04 between the emitters |
| `lcd` | emissive | screen | 1 | 0.1 | 0 | 0.005–0.02 | 0.03–0.1 | 0 | a cover glass over a black matrix |
| `lightbox` | emissive | acrylic | 1 | 0.1 | 0 | 0.4–0.9 | 0.05–0.12 | 0 | opal acrylic face lit from behind |
| `paperLantern` | emissive | washi | 0.5 | 0.5 | 0.9 | 0.5–0.85 | 0.8–0.95 | 0 | washi paper transmits ~30-50 % |
| `water` | liquid | film, standing | 1 | 2 | 0 | 0.01–0.1 | 0.02–0.06 | 0 | water F0 0.02 (IOR 1.33) |
| `oil` | liquid | sheen | 1 | 0.1 | 0 | 0.01–0.05 | 0.02–0.08 | 0 | a thin oil film (IOR ~1.45) 150-900 nm on dark water |

Albedo references used: concrete and render from Portland cement and lime render measurements (concrete 0.20-0.40,
render 0.40-0.75); asphalt binder 0.03-0.06 with aggregate 0.10-0.30; clay brick and mortar; paint as its pigment
(black 0.03-0.05, white 0.70-0.85); metals by F0 (`METALS`: iron 0.53, cast iron 0.45, steel 0.56, stainless 0.58,
chromium 0.55, zinc 0.62-0.66, aluminium 0.91, copper 0.96 / 0.64 / 0.54, brass 0.91 / 0.78 / 0.42, gold
1.0 / 0.77 / 0.34); tyre rubber 0.02-0.04; dielectric F0 0.04 (glass, clear coat), water 0.02. Several recipes were
also calibrated against scanned sets (see "Calibration" below).

## Cost: procedural against baked

A wall 1.5 m away filling 1440 x 900, 30 frames x 5 rounds, median; base = a plain `MeshStandardMaterial` on the
same quad; bakes synced by a readback (the first of a kind includes compiling its program). Apple M4 Pro (ANGLE /
Metal), `node examples/demos/materials/bench.mjs`.

| kind | base ms | procedural ms (+) | baked ms (+) | proc / baked (above base) | bake first / repeat ms | set px | MB |
|---|---|---|---|---|---|---|---|
| concrete | 0.15 | 2.39 (+2.24) | 0.35 (+0.19) | 11.6x | 5.3 / 4 | 1024 | 10.7 |
| asphalt | 0.1 | 2.04 (+1.94) | 0.36 (+0.27) | 7.3x | 8.2 / 4.1 | 1024 | 10.7 |
| paving | 0.12 | 1.4 (+1.28) | 0.35 (+0.23) | 5.6x | 4.2 / 3.4 | 1024 | 10.7 |
| brick | 0.17 | 4.06 (+3.89) | 0.39 (+0.22) | 17.9x | 8 / 5.6 | 1024 | 10.7 |
| render | 0.09 | 2.04 (+1.95) | 0.34 (+0.25) | 7.8x | 7.7 / 4 | 1024 | 10.7 |
| tile | 0.09 | 0.63 (+0.54) | 0.37 (+0.29) | 1.9x | 4.5 / 3.6 | 1024 | 10.7 |
| corrugated | 0.1 | 1.7 (+1.6) | 0.37 (+0.27) | 6x | 6.4 / 6 | 1024 | 10.7 |
| paintedMetal | 0.1 | 3.34 (+3.24) | 0.38 (+0.28) | 11.6x | 6.2 / 7.2 | 1024 | 10.7 |
| stainless | 0.12 | 0.74 (+0.62) | 0.53 (+0.41) | 1.5x | 6.2 / 3.9 | 1024 | 10.7 |
| galvanised | 0.12 | 1.36 (+1.24) | 0.53 (+0.4) | 3.1x | 8.7 / 3.6 | 1024 | 10.7 |
| castIron | 0.09 | 0.97 (+0.88) | 0.46 (+0.37) | 2.4x | 12.4 / 5.3 | 1024 | 10.7 |
| aluminium | 0.1 | 0.84 (+0.74) | 0.44 (+0.35) | 2.1x | 7.3 / 4.2 | 1024 | 10.7 |
| chrome | 0.13 | 0.62 (+0.48) | 0.49 (+0.35) | 1.4x | 3.3 / 3 | 512 | 2.7 |
| metal | 0.09 | 0.6 (+0.51) | 0.48 (+0.39) | 1.3x | 3.9 / 1.7 | 512 | 2.7 |
| powderCoat | 0.23 | 0.65 (+0.43) | 0.33 (+0.11) | 4x | 4.6 / 2 | 512 | 2.7 |
| carPaint | 0.09 | 0.74 (+0.66) | 0.73 (+0.64) | 1x | 6.3 / 3.4 | 1024 | 10.7 |
| plastic | 0.13 | 0.93 (+0.8) | 0.48 (+0.36) | 2.2x | 2.7 / 2.1 | 512 | 2.7 |
| rubber | 0.09 | 0.56 (+0.47) | 0.46 (+0.37) | 1.3x | 2 / 2.4 | 512 | 2.7 |
| fabric | 0.12 | 1.33 (+1.21) | 0.46 (+0.34) | 3.5x | 3.5 / 3.7 | 1024 | 10.7 |
| paper | 0.11 | 0.7 (+0.59) | 0.47 (+0.36) | 1.6x | 8.2 / 4.8 | 1024 | 10.7 |
| wood | 0.09 | 1.08 (+0.99) | 0.46 (+0.37) | 2.7x | 10.1 / 3.2 | 1024 | 10.7 |
| bamboo | 0.11 | 0.49 (+0.38) | 0.52 (+0.41) | 0.9x | 7.2 / 4.9 | 1024 | 10.7 |
| leather | 0.09 | 1.06 (+0.98) | 0.49 (+0.4) | 2.4x | 9.2 / 2.8 | 1024 | 10.7 |
| carbonFibre | 0.12 | 0.38 (+0.26) | 0.52 (+0.4) | 0.6x | 5.4 / 1.7 | 512 | 2.7 |
| ceramic | 0.12 | 0.93 (+0.81) | 0.52 (+0.41) | 2x | 4.9 / 1.6 | 512 | 2.7 |
| roofing | 0.18 | 1.05 (+0.86) | 0.4 (+0.21) | 4x | 10.8 / 3.7 | 1024 | 10.7 |

Read: the recipes with many octaves (brick, concrete, painted metal, render, asphalt) cost 2-4 ms per full screen
per pixel and 0.2-0.3 ms baked (6-18x); simple patterns (tile, stainless, chrome, rubber, bamboo, carbon fibre, car
paint) cost about as much either way, so `mode: 'auto'` (the default) runs those per pixel and bakes the rest. A
street's twelve kinds bake in 40-70 ms from cold (`surfaces-check.mjs`). Memory: 10.7 MB per 1024 px set (2.7 MB at
512): `size` trades it against sharpness at 0.5 m (a 1024 px set over 2.4 m is 2.3 mm a texel).

## Checks

- `node packages/core/surfaces.check.mjs` (in `npm test`): every kind and variant makes hooks for every mapping and
  both paths; defaults in the reference ranges; numbers are uniforms (two concretes with other numbers and variants
  share a program key; another mapping, path or kind does not); specs deterministic; option validation.
- `node packages/tools/src/surfaces-check.mjs` (Chrome with a GPU): every kind and variant compiles, procedural and
  baked, dry and wet; a bake read back sits in its ranges (metalness 0 or 1 where the kind says so); baked ==
  procedural at the bake's scale through the real material path (albedo, roughness, height); a bake repeats byte for
  byte, another seed changes it; ten concretes with other numbers add one program per path; a street's twelve kinds
  bake in under 1 s.
- `node examples/demos/materials/shoot.mjs [--only kind] [--lights ..] [--views ..] [--wet ..]`: the gallery sheets
  (out/gallery/, gitignored); `bench.mjs`: the table above.
- `node examples/demos/materials/compare.mjs --ref <folder of scanned sets>`: calibration against photographed sets
  (out/compare/, gitignored; nothing of the photos enters the repository).

## Calibration against scanned sets

Recipes were tuned against CC0 scans (Poly Haven, ambientCG) kept outside this repository: the flat tiles side by side at the scan's texel
density, then both on the gallery objects under the same light, and numbers (albedo mean and spread per channel,
luminance histogram, power by octave of luminance and of height, normal slope distribution, roughness). None of their
pixels is in the library; the numbers are the targets the recipes were moved toward. Distances: Euclidean over the
three channels (albedo), over the 16 bins (histogram of sqrt luminance), over the 7 octaves (normalised power).

| scan (tile) | recipe | albedo mean scan / recipe | albedo dist | sd dist | histogram dist | lum. octaves dist | height octaves dist | slope p50 scan / recipe | roughness scan / recipe | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| plaster_smooth (1 m) | `render:smooth` | 0.121 0.095 0.063 / 0.123 0.095 0.064 | 0.002 | 0.03 | 0.215 | 0.132 | 0.247 | 0.045 / 0.012 | 0.589 / 0.586 | close (tone, roughness, spectrum; the scan has more trowel relief) |
| plaster_broken (1.5 m) | `render:roughcast` | 0.318 0.211 0.102 / 0.232 0.155 0.074 | 0.106 | 0.066 | 0.439 | 0.596 | 0.885 | 0.067 / 0.111 | 0.856 / 0.89 | not there yet (no broken-off render islands) |
| brick_buff (1 m) | `brick:common` | 0.420 0.260 0.136 / 0.346 0.216 0.119 | 0.088 | 0.135 | 0.456 | 0.177 | 0.107 | 0.056 / 0.139 | 0.691 / 0.799 | close at 5 m; at 0.5 m the scan's flaky eroded faces are richer |
| paving_hex (1.6 m) | `paving:slabs` | 0.402 0.330 0.237 / 0.373 0.300 0.209 | 0.05 | 0.044 | 0.314 | 0.261 | 0.096 | 0.055 / 0.121 | 0.872 / 0.874 | close in tone and grain (hexagons not modelled) |
| flagstone (1.8 m) | `paving:setts` | 0.124 0.086 0.060 / 0.119 0.083 0.058 | 0.006 | 0.025 | 0.178 | 0.191 | 0.505 | 0.123 / 0.065 | 0.834 / 0.772 | close in tone (irregular flags not modelled: setts) |
| wood_old (2 m) | `wood:planks` | 0.105 0.079 0.054 / 0.096 0.068 0.044 | 0.018 | 0.011 | 0.306 | 0.192 | 0.647 | 0.051 / 0.006 | 0.674 / 0.666 | close at 5 m; at 0.5 m fewer gouges and grain streaks |
| wood_teak (0.55 m) | `wood:varnished` | 0.083 0.028 0.007 / 0.071 0.022 0.006 | 0.013 | 0.003 | 0.139 | 0.224 | 0.449 | 0.075 / 0.036 | 0.724 / 0.698 | close in tone and spectrum; less wear |
| iron_rusty (1 m) | `paintedMetal:sheet` | 0.382 0.271 0.213 / 0.333 0.258 0.217 | 0.051 | 0.098 | 0.369 | 0.251 | 0.144 | 0.03 / 0.037 | 0.59 / 0.729 | close: coverage, colour, streaks; the scan's rust is more fragmented at mm scale |
| canvas (0.5 m) | `fabric:canvas` | 0.533 0.529 0.517 / 0.479 0.475 0.464 | 0.093 | 0.052 | 0.385 | 0.513 | 0.404 | 0.294 / 0.225 | 0.531 / 0.549 | not there yet (weave relief weak, slubs regular) |
| gravel (2.48 m) | `roofing:gravel` | 0.257 0.143 0.067 / 0.195 0.107 0.049 | 0.075 | 0.014 | 0.297 | 0.346 | 0.604 | 0.174 / 0.219 | 0.788 / 0.758 | close in tone; stones rounder and more uniform |
| terracotta (2 m) | `tile:floor` | 0.190 0.113 0.046 / 0.195 0.116 0.052 | 0.008 | 0.026 | 0.055 | 0.258 | 0.577 | 0.02 / 0.006 | 0.686 / 0.698 | tone and histogram matched; the scan's tiles have more relief |

## Adding a surface

1. Write `MsS ms_<kind>(vec2 u)` in `KIND_GLSL` (`surface-glsl.js`). Use the periodic helpers only: `msFbm(u, f,
   oct)` / `msFbm2(u, vec2 f, oct)` (fractal noise, octaves cut by `msLod`), `msCell(u, f, jitter)` (F1, F2, two
   hashes of the nearest cell), `msVal2`, `msGrid(u, cell, shift)` with `msEdgeD` (bricks, tiles, panels, snapped to
   the tile), `msSnap(spacing)`, `msLine(d, halfWidth)` (antialiased lines), `msLayers(n, amount)` (paint, lifted
   edge, primer, bare), `msRustCol(n)`. Never `mgFbm*` of the raw position: it is not periodic and the bake would
   seam. Fade every feature by `msLod(wavelength)` toward its mean.
2. Add the kind to `KINDS` in `surfaces.js`: family, variants, tile, depth (m), size, porosity, the measured `refs`,
   `defaults`, `pack(o)` (the numbers into `A`..`D`), `quantum` (the pattern's module, for the repetition breaker),
   `edge` (what a worn edge exposes), `material` (Physical parameters) if any, `cheap` if it costs no more than its
   taps.
3. `node packages/core/surfaces.check.mjs`, `node packages/tools/src/surfaces-check.mjs --only=<kind>`, then shoot it
   (`shoot.mjs --only <kind>`) and look at every lighting, dry and wet, at 5 m and at 0.5 m.

## Switching a material over (neon-district, before / after)

`createSurfaces(ctx)` takes a module's context (it has `renderer` and `mat`). The district's asphalt, ribbed sheet
and concrete wall:

```js
// before: examples/neon-district/modules/materials.js (hooks written by hand, ~25 lines each)
const ASPHALT = { fragmentDecl: 'float ndH; float ndPaint;', albedo: `{ vec2 p = mgWorldPos.xz;
    float coarse = mgFbm2(p * 0.35, 4), grit = mgValue2(p * 38.0), ...    // value-noise grit, one roughness
    ndPaint = inRoad * max(max(centre * ..., edges), max(zebra, stop)) * wear; ... }`,
  roughness: 'roughnessFactor = 0.86 - 0.12 * ndPaint;', normal: 'normal = mgBump(normal, ndH, 0.006);' };
asphalt: mat.std({ roughness: 0.86 }, wet(ASPHALT, { porosity: 0.35, puddles: 1.5, height: 'ndH', heightMid: 0.5,
  heightScale: 0.02, ripples: 1.3, specAA: 2.5, wear: RUTS })),
sheet: mat.std({ roughness: 0.5, metalness: 0.75 }, wet(RIBBED('vec3(0.32, 0.34, 0.38)'), { porosity: 0.1, puddles: 0 })),
concrete: mat.std({ roughness: 0.88 }, wet(CONCRETE, { porosity: 0.8, puddles: 0, band: 0.5 })),

// after
import { SURFACES, createSurfaces } from '@miragekit/core';
const lib = createSurfaces(ctx);
const LINES = '...';   // the same centre / edge / zebra / stop masks as before, as one GLSL float expression
asphalt: lib.material(SURFACES.asphalt({ variant: 'worn', cracks: 0.5, oil: 0.25 }),
  { mapping: 'ground', paint: LINES, wet: { puddles: 1.5, ripples: 1.3, specAA: 2.5, wear: RUTS } }),
sheet: lib.material(SURFACES.corrugated({ variant: 'painted', color: [0.32, 0.34, 0.38], pitch: 0.22, profile: 'box', rust: 0.35 }),
  { mapping: 'wall', grain: 'y', wet: { puddles: 0 } }),   // paint and rust dielectric; zinc where it wore through
concrete: lib.material(SURFACES.concrete({ variant: 'cast', panel: [2.4, 1.2], tieSpacing: 0.6, age: 0.6 }),
  { mapping: 'wall', wet: { puddles: 0, band: 0.5 }, decals: { damp: 0.6, rills: { top: 3.2, length: 1.4 } } }),
```

The ruts (`wear`) and the line masks are the district's layout and stay its own; what the surface is made of moves
into the library. A material on something that moves (a car, a door, the weapon in hand) takes `space: 'object'`.
Brushed parts take `mapping: 'grain'` with the part's long axis (world-axis brushing streaked on stairs).

## The neon-district inventory

What the flagship example used (read from `examples/neon-district/modules` and `game`: every `mat.std` / `phys` /
`glow` / `patch` and `new THREE.Mesh*Material`): 107 material ids (101 in use, parameterised sets counted once) in 24
families. Repeated faults: in-between metalness on paint and dielectrics (~25 ids: painted sheet 0.75, shutters 0.55,
products 0.5, glass 0.1-0.3, car paint 0.55-0.75); "black metals" (albedo 0.01-0.06 at metalness 0.8-1, not a
physical metal: a black mirror; the most-used structural ids); two props-kit materials (`paint`, `metal`) standing
in for ~15 surfaces; one constant roughness on most ids; world-axis grain (wood, brushing) and wear anchored to world
y = 0; value-noise blobs for grit and grime; glass without Fresnel.

| family (ids) | the district's ids | made of today | replace with |
|---|---|---|---|
| asphalt (1) | `M.asphalt` | fbm + value-noise grit, Voronoi cracks, painted lines, one roughness, wet | `asphalt` worn `{ cracks: 0.5, oil: 0.25 }`, ground, `paint: LINES`, wet as before |
| paving (3) | `M.pavement`, `M.plaza`, `relayFloor` | hashed slabs, speckle, joints | `paving` slabs `{ cell: [0.6, 0.6], color: [0.27, 0.27, 0.275] }`; plaza: `paving` polished `{ color: [0.12, 0.125, 0.14], cell: [0.9, 0.9] }`; relay floor: `aluminium` tread |
| concrete (4) | `M.concrete`, `M.concreteDry`, `M.kerb`, `farMat`'s walls | board seams, tie holes, bleed, run-off; flat roughness | `concrete` cast `{ panel: [2.4, 1.2], tieSpacing: 0.6, age: 0.6 }`, wall, decals damp + rills; kerb: `concrete` precast `{ panel: [0.9, 0.3] }` + its stripe mask kept |
| facades (4) | `M.facade.*`, `farMat` | window-grid hooks (layout) | keep the window grid; set the panel / glass metalness to 0 and the glass roughness to 0.05 (the wall between windows: `concrete` precast / `paintedMetal` panels when a facade is near) |
| roofing (1) | `M.roofing` | fbm | `roofing` felt (ground, puddles 1.6) |
| painted steel (13) | `M.sheet`, `M.sheetRed`, `M.yellow`, `M.crate`, shutters x5, `frameMat`, streetlife paint / blue, `boxMat`, `doorMat`, `crateMat`, view-model olive / warhead / `rocketMat` | `RIBBED` / `worn()` hooks or flat colour at metalness 0.2-0.85 | ribbed boxes: `corrugated` painted `{ pitch: 0.22, profile: 'box', color }`; on real corrugated geometry (shutters, container): `paintedMetal` sheet `{ color, chips 0.45-0.7, rust 0.45-0.85 }`; frames, doors, breaker boxes: `paintedMetal` panels / enamel; crates and launcher parts: `powderCoat` cerakote (olive); `M.yellow`: `paintedMetal` sheet yellow + the stripe mask |
| dark coated metal (13) | `M.darkMetal`, `M.blackMetal`, `M.rack`, aerial `dark`, enemies `plate`, view-model `body` / `dark` / `heat`, `card`, `caseMat`, drone `shell`, aerial `plate` | flat albedo 0.01-0.16 at metalness 0.8-0.9 | `powderCoat` powder `{ color: [0.035, 0.038, 0.045] }` (blackMetal 0.03, rack: wrinkle); gun bodies: `powderCoat` cerakote, `space: 'object'`; grips: `plastic` textured; drone shell, card: `plastic` abs; aerial plate: `aluminium` cast; heat: `metal` machined + its emissive ramp |
| stainless (2) | `M.steel`, cars `steel` | `PROC.brushed` on world y; cars: anisotropy | `stainless` brushed, `mapping: 'grain'` with each part's long axis; cars: `mapping: 'uv'`, keep `anisotropy` in `params` |
| bare metals (3) | `P.mats.metal`, manhole, brass | one material for every metal tint | split by role: `chrome`, `galvanised`, `castIron`, `metal { metal: 'brass' }`, `powderCoat` for black brackets (`space: 'object'`, `params: { map, vertexColors }`); manhole: `castIron` manhole, `mapping: 'uv'`, `uvScale: 0.8`; casings: `metal { metal: 'brass', variant: 'machined' }` |
| grate (1) | `M.grate` | flat black metal box | `castIron` grate |
| car paint (3) | `M.car.*`, cars `pearl`, aerial `paint` | Physical, metalness 0.55-0.75 | `carPaint` metallic `{ color }` / pearl / solid (aerial: instance colours) |
| glass (5) | `M.glass`, cars `glass`, `P.mats.clear`, `darkGlass`, lens | constant opacity, metalness 0.1-0.3 | `glass` clear / dirty (shop windows) / tinted (cars, dark panes, lens `{ color: [0.35, 0.75, 0.9] }`) |
| plastic (9) | `M.plastic`, cone, robot `shell`, `canopy`, enemy `armour`, `poly`, `hullRed`, `coverMat`, pickups | flat colour | `plastic` textured (ceiling panels, cone `{ color: [0.75, 0.2, 0.03] }`, grips, covers); abs (robot shells, `space: 'object'`, pickups, shell hulls); armour: `paintedMetal` enamel `space: 'object'`; canopy: `fabric` nylon + opacity |
| rubber / leather (2) | `M.rubber`, glove | flat 0.012 | `rubber` moulded (cables, seats), tread / sidewall (tyres, `mapping: 'uv'`); glove: `leather` |
| fabric (4) | awnings x4, laundry, cloth x5, sleeve | world-axis stripes; flat | `fabric` canvas `{ color, stripe, stripeWidth: 0.25 }`, `mapping: 'grain'` down the slope; laundry, cloth: `fabric` cotton; sleeve: `fabric` nylon, `space: 'object'` |
| wood (3) | `M.wood`, `M.lacquer`, pallet | `PROC.wood` on world x | `wood` planks `{ color: [0.2, 0.1, 0.05] }`, `mapping: 'grain'` along each board; lacquer: `wood` varnished `{ color: [0.32, 0.02, 0.02], roughness: 0.18 }`; pallet: `wood` sawn |
| paper (3) | `M.paper`, litter `card`, posters | flat; canvas maps | `paper` paper / cardboard; posters keep their art (a map) |
| plaster (1) | `M.plaster` | `PROC.plaster` | `render` smooth `{ color: [0.42, 0.3, 0.22], cracks: 0.3 }` |
| markings (3) | wayfinding paint, stencils, container code | atlas maps | keep (layout); the container code: normal blending, not additive |
| catch-alls (2) | `P.mats.paint`, `P.mats.product` | one roughness / metalness for ~15 surfaces | split by role: `plastic` hdpe (bins), `wood` sawn (slats), `paper` cardboard, `ceramic` glazed (bowls), `rubber` tread (tyres), `concrete` precast (jersey barrier); products: cans `aluminium` anodised, cartons `paper` (labels as maps) |
| neon / emissive (6) | `M.neon.*`, `M.neonSoft.*`, `paperGlow`, `P.mats.glow`, `P.mats.lantern`, small glows | `mat.glow` (unlit colour x gain) | tubes: `neon` `{ color, intensity: 9 }`; light boxes, ceiling panels: `lightbox` (uv) or `ledPanel` diffused; lanterns: `paperLantern`; small LEDs and beacons: keep `mat.glow` |
| screens (10) | `M.screen*`, LED wall, ad screens, ticker, signs, interiors | glyph hooks, canvas atlases | `lcd` / `ledPanel` bare for the bezel-less screens (their content as `content`); atlas signs, adverts, interiors: keep (content), put `glass` dirty over the shop interiors |
| water (2) | puddle decals, drips | dark film, hard cut | puddles: `water` standing (or the wet layer's own puddles); drips: keep |
| foliage, holograms, FX (10) | leaves, holograms, beams, trails, shields | additive / unlit | not surfaces: keep |


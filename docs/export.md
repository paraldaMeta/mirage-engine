# Exporting a world: GLB, USDZ and the other routes

`mirage-export` turns a built example into files other tools open: a **GLB** (Blender, Android Scene Viewer, any
glTF viewer or engine) and a **USDZ** (Quick Look on iPhone and iPad, Reality Composer).

```sh
cd examples/garden-quest && npm run build
node ../../packages/tools/src/export.mjs dist --out out/garden-quest.glb --usdz out/garden-quest.usdz --verify out/export-verify
```

Options: `--bake N` (largest atlas edge, default 1024), `--density T` (most texels per metre, default 64),
`--maps color,orm,normal`, `--png` (no JPEG), `--usdz-thin f` (keep that share of each instanced mesh's instances in
the USDZ), `--query "time=19:30"` (any page query, as for mirage-snap), `--views 0,3` and `--spp 4` for `--verify`,
`--no-validate`. In a page of your own: `const { glb, usdz, report } = await exportWorld(world, { usdz: true,
exclude: [play.figure] })` from `@miragekit/core/export`.

## What goes in, and how the looks survive

Everything visible on layer 0 under the scene, grouped by module (the module names become the node names). Left
out: the sky and stars (ShaderMaterial, not geometry), collision proxies (layer 2, `colorWrite: false`), points and
lines, skinned meshes and the player figure.

Most Mirage surfaces get their look in the shader: `patch()` hooks compute colour, roughness and a bumped normal
from the world position (noise, ashlar courses, world-space texture taps). A plain GLTFExporter export keeps only
the flat base colour, so the exporter **bakes** every hooked material into textures:

1. **Charts.** The mesh's triangles are grouped into charts: connected triangles whose face normal shares its
   dominant axis (±X, ±Y, ±Z), each chart projected onto that axis plane. Box projection keeps metric scale
   (a texel is the same size everywhere), stretches at most 1.73x (at 54.7°), keeps winding, and turns Mirage's
   geometry (boxes, extruded walls, lathes, heightfields) into few, large charts: a box is 6 charts, a 96,800-
   triangle terrain 29. A general unwrapper (xatlas) would pack tighter but brings a WebAssembly dependency.
2. **Atlas.** Charts are shelf-packed into a power-of-two atlas (at most `--bake` texels on a side); the texel
   density is bisected to the largest that fits, capped at `--density` texels per metre.
3. **Bake.** The mesh's own patched material is drawn into the atlas (`gl_Position` = atlas UV), so every hook runs
   exactly as in the world (world position and normal, instance attributes, the real texture taps, `textureGrad`
   at the atlas's own scale). The end of `main()` writes `diffuseColor` (sRGB), `roughnessFactor` /
   `metalnessFactor` (glTF ORM, G and B) or the hooked normal expressed in the frame three and MikkTSpace rebuild
   from the atlas UVs. 2x2 supersampled, gutters dilated (no mip bleeding), JPEG unless the colour has cut-outs.
4. **Fallback.** A mesh with more charts than its atlas holds (thousands of leaf cards) is baked to **vertex
   colours** instead: the same material drawn once per vertex as points. In the USDZ it becomes one flat colour per
   chart in a small palette texture, because Quick Look ignores vertex colours.

Why atlas baking and not vertex colours everywhere: Mirage geometry is coarse (a 6 m wall is 12 triangles), so
vertex colours would lose the stone courses, plaster streaks and wood grain entirely; the atlas keeps them at
14–64 texels per metre. Vertex colours stay right for what is already coloured per vertex (grass, leaves).

Instanced meshes stay instanced in the GLB (`EXT_mesh_gpu_instancing`, instance colours as `_COLOR_0`); one bake,
drawn with instance 0, serves every instance. three's USDZExporter has no instancing, so the USDZ merges instances
into one mesh, marks double-sided meshes `doubleSided` (the exporter does not; the archive is re-zipped with USDZ's
64-byte alignment, checked on every run) and writes object matrices as they stand.

## Results (this machine, Apple GPU, Chrome headless, three r186)

`--bake 1024 --density 64`, `--verify` from every plan viewpoint at 960x600. The comparison draws the re-imported
GLB (GLTFLoader) through the world's own renderer, sky, sun, shadows, image-based light and post, so the difference
is the material and the hooks that do not travel. *Coverage IoU*: geometry-vs-background masks of the two; *normals*:
share of pixels whose view normals agree; *colour*: mean absolute difference of the final images (0–255).

| example | GLB | USDZ | meshes (instanced / instances) | materials | maps baked | triangles | export | coverage IoU | normals | colour diff GLB (USDZ) |
|---|---|---|---|---|---|---|---|---|---|---|
| woodland-path | 0.58 MB | 44.3 MB | 7 (5 / 8,166) | 7 | 12 (4 meshes) | 182,308 | 2.5 s | 1.000 all 4 views | 100 % | 3.5–8.9 (8.8–20.2) |
| hello-courtyard | 5.3 MB | 11.5 MB | 17 (0) | 17 | 32 (15 meshes) | 107,582 | 5.1 s | 1.000 all 6 | 100 % | 1.5–2.8 (3.9–7.7) |
| garden-quest | 20.8 MB | 51.0 MB | 55 (0) | 39 | 72 (30 meshes) | 263,508 | 10.2 s | 1.000 all 9 | 99.4–100 % | 0.5–2.4, interior 21.1 (0.9–3.2, interior 22.2) |

gltf-validator 2.0.0-dev.3.10: **0 errors** on all three; the only warnings are `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`
(2 / 14 / 30: normal maps without stored tangents; three, Blender and Quick Look generate them). three's USDLoader
parses every USDZ to the same mesh and triangle counts as the GLB. Where the colour differs:

- woodland-path: wind (the export is the rest pose, the live grass sways) and grass/leaf edges.
- garden-quest *interior*: ambient volumes dim the image-based light inside the pavilion in the live world; that is
  lighting, not material, so the exported interior is brighter.
- Paving and terrain are softer: a 1024 atlas over a large area gives 14 texels/m for paving and 0.4 texels/m for
  the far terrain (garden-quest `land`, 2.5 km across). `--bake 2048` doubles both.
- USDZ via three's USDLoader (not Quick Look): no image-based-light response from the metallic props, and in
  woodland-path the leaves are culled from behind because USDLoader ignores `doubleSided`.

Size: geometry, not textures, dominates. garden-quest's 20.8 MB is 5.6 MB of JPEG and 14.1 MB of float32 attributes
(the crowns alone are 97,200 faceted triangles that cannot share vertices). `--bake 512` gives 16.9 MB (the crowns,
4,650 charts, fall back to vertex colours). The USDZ is larger still: it stores ASCII `.usda` (USDZ allows no
compression) and expands every instance; `--usdz-thin 0.25` brings woodland-path from 44.3 MB to 11.4 MB (45,613 triangles).

## What does not survive

| lost | why |
|---|---|
| sky, stars, aerial perspective, fog, post (exposure, bloom, grain, TAA) | not geometry; screen- and view-dependent |
| wind and other `vertexWorld` motion | glTF/USD carry no vertex shaders; the rest pose is exported |
| `lighting` hooks (translucency of hedges, crowns) and `output` hooks | view- and light-dependent; lamps become emissive (`KHR_materials_emissive_strength` above 1, the current lamp gain folded in) |
| ambient volumes (interior light dimming) | lighting of the world, not of a surface |
| procedural detail finer than the atlas texel | bounded by `--bake` / `--density` |
| anything drawn by a ShaderMaterial, points, skinned meshes | out of scope (the figure is a player avatar) |
| shadows and the sun | lights are not exported; any viewer relights the scene |

## Other routes, and which to use

Measured where a number is given (gltf-transform 4.5.1 `optimize --simplify false` on the GLBs above); otherwise an
assessment.

| route | what it gives | numbers / cost | verdict |
|---|---|---|---|
| **mirage-export GLB** (this) | one file, baked looks, instancing, validates clean | 0.58 / 5.3 / 20.8 MB | the master file |
| + gltf-transform `--compress meshopt --texture-compress webp` | quantised, meshopt-compressed geometry, WebP textures; keeps `EXT_mesh_gpu_instancing` | 0.65 / 1.45 / 5.2 MB, < 1.2 s | for the web (three, Babylon, model-viewer need the meshopt decoder) |
| + gltf-transform `--compress draco --texture-compress webp` | Draco geometry | 0.41 / 1.15 / 2.8 MB | smallest; Blender and Scene Viewer document Draco support (not tried); slower to decode |
| + `--compress meshopt` alone | | 0.81 / 3.2 / 9.2 MB | woodland-path grows (already small, quantisation overhead) |
| KTX2 (`gltf-transform uastc` / `etc1s`) | GPU-compressed textures, less VRAM | needs the KTX-Software binary (not tried) | worth it for big atlases in a web viewer |
| per-module GLBs | one file per module (the export is already grouped by module) | a loop over groups; not built | for streaming or editing parts in Blender |
| single-file playable HTML (`mirage-package`) | the live world, all looks, wind, sky | exists (woodland-path's budget: 5 MB) | for sharing the experience, not the asset |
| OpenUSD (`pip install usd-core`) from the GLB | binary `.usdc` crate, `PointInstancer` for vegetation, proper USDZ packaging | not built; Python dependency | the fix for the USDZ size (44 MB of text for woodland-path) |
| Blender (`blender -b --python`) as converter | GLB in, FBX/USD/.blend out, Cycles lightmaps | heavy dependency, 100+ MB | for people who live in Blender anyway |
| 3D Tiles (Cesium) | tiled, streamed, geo-referenced | meaningful at city scale; our worlds are < 300 k triangles | not needed yet |
| Gaussian-splat capture | photographic capture of the rendered world (sky, fog, translucency included) | hundreds of renders + training (GPU hours), 20–200 MB `.ply`/`.spz`; not editable | a demo medium, not an interchange format |

**Recommendation.** Make `mirage-export` GLB at the defaults the default route: it is complete (every visible
surface, instancing kept), checked (0 validator errors, coverage IoU 1.000 from all 19 viewpoints of three
examples, colour within 0.5–8.9/255 outside the interior) and opens anywhere glTF does. Ship it as is for Blender
and archives; for the web run `gltf-transform optimize <in> <out> --compress meshopt --texture-compress webp
--simplify false` (garden-quest 20.8 → 5.2 MB, hello-courtyard 5.3 → 1.45 MB). Use the USDZ for Quick Look,
with `--usdz-thin` for vegetation-heavy worlds, until an OpenUSD step writes binary crates with instancing.

## Not verified

- Opening the files in Blender, in Quick Look on a device, or in Android Scene Viewer. Checked: gltf-validator,
  three's GLTFLoader and USDLoader, and USDZ 64-byte alignment.
- That the gltf-transform outputs render the same (sizes only).
- The normal-map convention outside three: baked against three's derivative tangent frame, which agrees with
  MikkTSpace on planar charts; not checked in another renderer.
- Examples other than the three above.

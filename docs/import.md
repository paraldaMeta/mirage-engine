# Importing models (glTF / GLB)

Mirage worlds are built in code, and nothing here changes that. `@miragekit/core/assets` (experimental, opt-in) is for
the things code is a poor tool for: a scanned statue, a rigged character, a prop from a modelling tool. It is a
subpath, not in the index: a project that imports no models ships none of it (the three example bundles compared, hello-courtyard,
garden-quest and walled-garden, grew by 27 bytes each on this branch, which is `createPlay`'s `character` option, and their stills did not change: see
[animation.md](animation.md)).

```js
import { createAssets } from '@miragekit/core/assets';
import { decoders } from '@miragekit/core/assets-decoders';   // Vite: three's Draco / Basis files as bundled URLs

const assets = createAssets(world, { decoders });
const chair = await assets.load('/models/chair.glb', { collide: 'box' });
ctx.root.add(assets.instantiate(chair));                   // a clone sharing geometry, materials, textures
const row = assets.instances(chair, matrices);             // one InstancedMesh per primitive
ctx.root.add(row.root);
assets.release(row); assets.release(chair);                // the last reference frees the GPU resources
```

`load` takes a URL or the bytes of a .glb / .gltf (`ArrayBuffer` or typed array; give `key` to cache a buffer, `path`
for its external files). The result is an `AssetModel`: `scene` (a template: never add it, `instantiate` it),
`animations`, `cameras`, `bounds`, `skinned`, `collide`, and `stats` (`meshes`, `triangles`, `textures`, `bytes`,
`extensions`, `ms`).

## Compressed files

| payload | glTF extension | decoder | checked here |
|---|---|---|---|
| meshopt | `EXT_meshopt_compression` | three's `meshopt_decoder` (WASM inside the module) | yes: `writeGLB(..., { meshopt: true })` files load in Node and in Chrome, vertex streams bit-exact |
| Draco | `KHR_draco_mesh_compression` | `decoders.draco` | the decoder starts from the inlined WASM in the single-file build; **no Draco file was decoded** (three ships no encoder, and the rules of this repository forbid downloading one) |
| KTX2 / Basis | `KHR_texture_basisu` | `decoders.basis` | the transcoder starts the same way; **no KTX2 texture was decoded** |

A decoder is created only when a file lists its extension in `extensionsUsed` (`gltfExtensions(buffer)` reads the
list without loading), so plain files never fetch one. `@miragekit/core/assets-decoders` is Vite `?url` imports of the
four decoder files in three; the single-file packager (`packages/tools/src/package.mjs`) inlines them as `data:`
URLs: 3.48 MB of the anim demo's 4.58 MB file. Leave the import out and pass folder URLs
(`{ draco: '/draco/', basis: '/basis/' }`) to host them yourself, or pass nothing if your files are uncompressed or
meshopt.

## What "adapted" means

Fog, shadow filtering and the second light model live in three's shader chunks, the sky light is
`scene.environment` and the grade is the post pipeline, so a stock glTF material already gets all four. `load`
adds the rest: every Standard / Physical / Basic / Lambert material goes through `patch()` with empty hooks (the
world's uniforms, interior ambient volumes, a place for `withWet` and other hooks), meshes get shadow flags, and
textures the world's anisotropy. `adapt: false` skips it; `adapt: (material, mesh) => replacement` lets you swap a
material (`ctx.mat.std(...)`) instead. ShaderMaterials are left alone.

## Collision

The engine has one rule, and imports follow it: a visible, opaque, depth-writing mesh on layer 0 is solid, both in
the walk grid (`bakeWalkGrid`, baked from the scene) and in Rapier (`@miragekit/game` builds static colliders from the
same meshes; the walk-grid side is checked in the demo, the Rapier side follows from the shared rule and was
not run here). `collide` says what a model contributes:

| `collide` | walk grid and physics see | use for |
|---|---|---|
| `'mesh'` (default for static models) | the render triangles | buildings, terrain pieces, anything walked on |
| `'box'` | one box around the model (a proxy on layer 2, `userData.collider`, never drawn); the meshes get `userData.collide = false` | props |
| `'hull'` | the convex hull of the vertices, same convention | rocks, furniture |
| `false` (default for skinned models) | nothing | figures, decoration |

Add instances **before** the walk grid is baked (in a module's `build`, as the anim demo does), or re-bake their
region afterwards (`bakeWalkGrid(world, { region: regionOf(root), into: grid })`). In the demo a 0.8 m imported
crate placed with `instances` reads 0.800 m in `grid.groundAt` and the ground beside it 0.000.

## Cache

`load` of the same key returns the same model and adds a reference; `instantiate` and `instances` add one each;
`release(model | instance | instances | key)` drops one, and the last drop disposes geometries, materials and
textures. `refs(model)`, `stats()` (`models`, `refs`, `bytes`, `triangles`) and `dispose()` (everything, whatever
the counts) are there for tools and scene changes.

## Writing GLB

`writeGLB(root, { clips, meshopt })` (in `@miragekit/core`) writes an object tree as binary glTF: nodes, meshes,
skins, standard-material factors, clips (a clip's `userData`, events included, goes to `extras`), and images when
a map carries its file (`texture.userData.glb = { bytes, mimeType }`). `meshopt: true` compresses vertex streams
with the repository's own encoder of the meshopt vertex codec. It exists so the checks can make real files without
downloads, and so a world built in code can be handed to other tools. The code-authored test rig: 164 596 B plain,
137 932 B with meshopt (880 vertices, 20 bones, nine clips; the clips are most of it and are not compressed).

## Not here

FBX, OBJ and USD (convert to glTF first); morph-target authoring in `writeGLB`; texture compression (the writer
embeds what it is given); LOD generation; a Draco or KTX2 file actually decoded in a check.

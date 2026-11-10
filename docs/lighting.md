# Realtime lighting: cascades, probe GI, reflection probes, many lights

Four features, all **experimental** and all **off by default**. They are turned on per world:

```js
const world = createWorldRenderer({
  lighting: {
    csm: true,                                                    // cascaded sun shadows
    gi: { min: [-4, 3.6, -29], max: [4, 7.4, -21], spacing: 1.2 }, // irradiance probes over one box
    probes: [{ min: [-4, 3.6, -29], max: [4, 7.4, -21] }],          // box reflection probes (at most 4)
    lights: true,                                                 // clustered local lights + shadow atlas
  },
});
const lamp = new THREE.PointLight(0xffaa66, 40, 9);
lamp.position.set(2, 3, 1); world.scene.add(lamp);
world.lighting.addLight(lamp, { shadow: true });   // from now on drawn by the clustered path
world.lighting.invalidate();                       // after the built world changed (a door, a wall)
```

Without `lighting` nothing of this runs: no file below is instantiated, no material is wrapped, and the shaders and
the image are the ones from before (stills compared, see *Checks*).

Try them on two examples (each flag alone or together):

| flag | what |
|---|---|
| `?csm=1` (`&cascades=2..4`) | cascaded sun shadows; walled-garden also `&soft=1` for the contact-hardening filter per cascade |
| `?gi=1` (`&gispacing=m`) | the probe volume: walled-garden's pavilion interior (lit through its doors), hello-courtyard's court |
| `?probes=1` | one box reflection probe (the pavilion room; the court) |
| `?lights=N` | N lamps on the clustered path (`&cluster=0`: the plain loop over all lights; `&stock=1`: three's own PointLights instead, for comparison) |
| `&lshadows=K` | the first K lamps cast shadows from the atlas |

`examples/walled-garden/?gi=1&probes=1&csm=1&lights=64&lshadows=4&time=20:30`, the same on `examples/hello-courtyard/`.

## How the shader parts get in

`packages/core/src/inject.js`. Each feature is a *part* (GLSL declarations, uniforms, and text replacements inside
three's `lights_fragment_begin` / `lights_fragment_maps`). The injector wraps `onBeforeCompile` and
`customProgramCacheKey` of the world's own lit materials (Standard, Physical, Lambert, Phong; the material's own
hook runs first), expands those two includes in that material's source and edits them there. `THREE.ShaderChunk` is
not written to, two worlds on one page can have different parts, and a world without parts compiles the stock
source under the stock program key. World position and normal are derived from the view-space ones three already
has, so vertex shaders are never touched. Materials are adopted in `prepare()` and every 30 frames
(`world.lighting.adopt()` does it at once); `material.userData.mgNoLighting = true` keeps one out.

The older page-global patches (fog, `softShadows`, `light2`) are as they were: moving them onto the injector would
change their compiled source and was left out.

## Cascaded sun shadows (`csm`)

`packages/core/src/csm.js`. The sun's shadow map becomes a 2 x 2 atlas of 2-4 orthographic maps. A cascade is the
bounding sphere of one slice of the view frustum (splits between logarithmic and linear by `lambda`), so its size
does not change as the camera turns, and its centre is snapped to whole texels: edges do not swim. three's own
shadow pass draws it (the sun's `LightShadow` gets one viewport per cascade), so alpha-tested leaves and wind sway
cast as before, and the atlas is the sun's own sampler: no extra texture unit. Per pixel: the first cascade that
holds the normal-offset position, a blend band into the next one, a fade to unshadowed at the far end. The filter
radius is in metres, so cascades agree where they meet; with the world's `softShadows` the contact-hardening search
runs per cascade. Tile size is half the quality tier's shadow map (the atlas takes the memory the single map took).

Limits: every cascade is redrawn each (sub-)frame (three clears the whole atlas, so far cascades cannot be refreshed
less often). Readers that are not adopted lit materials (the volumetric light march of `light2`, a host
`ShaderMaterial`) still read `sun.shadow.matrix`, which is the last cascade only. Orthographic game cameras and
probe captures get spheres around the world's shadow centre instead of view slices.

## Diffuse GI: an irradiance probe volume (`gi`)

`packages/core/src/gi.js`. A regular grid of probes over one box. A probe stores irradiance (8 x 8 texels,
octahedral) and the mean / mean-squared distance to the scene per direction (16 x 16); everything is one
half-float atlas. Baked on the GPU at load from the scene itself (a 32 px cube of the lit scene and a cube of
distances per probe, folded by a full-screen pass); each pass over the volume sees the probes baked so far and so
adds a bounce (`bounces`, default 2). When the time of day moves, probes are re-baked `perFrame` (2) per frame.
In the material the image-based diffuse light is replaced inside the box by the 8 surrounding probes, weighted
trilinearly, by facing, and by visibility (Chebyshev's bound from the two distance moments), which is what keeps
light from leaking through a wall thicker than the bias. Image-based specular is scaled by probe light / sky light,
so a dark room does not mirror the open sky.

Limits: one box per world. Static geometry only (`userData.mgDynamic` roots are left out of the bake and only
receive). Local lamps are in the bake but a lamp that moves or switches does not update it until `invalidate()`.
The sun arrives as its first bounce, not as a disc. Probes see the sky at its capture brightness, not scaled by
`envIntensity`. Do not also declare `ambientVolumes` for the same room.

## Reflection probes (`probes`)

`packages/core/src/probes.js`. Each probe is a capture from inside its box, prefiltered by three's PMREM at the
world's own size (roughness reads the same blur as the world's image-based light). A pixel inside the box reflects
the probe: the reflected ray is cut against the box and the capture is looked up toward that hit point (box
parallax correction). Within `fade` metres of the faces it blends out to the world's light; overlapping boxes blend
by their weights. Captured after the sky changed and after `invalidate()`, one probe every 8 frames.

Limits: at most 4 (each is one more texture in every lit program: with everything on, a Physical material with all
its maps is close to WebGL2's guaranteed 16 units). Axis-aligned boxes only, no spheres. A capture is a whole PMREM
pass, a visible hitch (measured below), so "on a budget" here means one probe at a time, not time-sliced faces.
Rough reflections use the mirror's hit point.

## Many local lights (`lights`)

`packages/core/src/lights.js`. Registered lights live in one float texture (5 texels a light). The view frustum is
cut into 16 x 9 x 24 cells (logarithmic in depth); each frame the CPU writes per cell the lights whose sphere
reaches it, and a pixel shades only its cell's list through the material's own BRDF with three's falloff. The
light count is data: adding a lamp compiles nothing. Captures and orthographic cameras take the plain loop.

Shadows: one depth atlas (2048 px). A light with `{ shadow: true }` gets a square tile, 64-512 px by its size on
screen (buddy allocator, hysteresis), holding distance per direction in an octahedral layout, read with 4 rotated
hardware compares. Tiles are cached: redrawn only when the light moved, its tile changed size, `invalidate()` was
called, or a `userData.mgDynamic` root moved within range; at most `perFrame` (2) per frame.

Limits: a spot light pays the same six cube faces as a point light. Static and moving casters share a tile (no
separate static layer: a light with a mover in range redraws all its casters). Alpha-tested cut-outs cast as their
whole card. A cell keeps at most `perCell` (64) lights; `world.lighting.lights.info.clipped` counts drops.

## Measured

MEASURED_SECTION

## Checks

- `node packages/core/lighting.check.mjs` (part of `npm test`): splits, slice spheres, texel snapping, the probe
  grid and atlas tiles, cluster slices and sphere spans against brute force, the tile allocator, box exits and
  probe weights, and the injector (no part = stock source and stock program key; `THREE.ShaderChunk` untouched).
- `node packages/tools/src/lighting-check.mjs examples/walled-garden/dist examples/hello-courtyard/dist` in Chrome
  with everything on: no console errors or missing shader anchors; each part is in the compiled programs; clustered
  shading equals the plain loop on three views; a quiet scene redraws no shadow tile and a moved lamp redraws one;
  a new caster darkens the ground after `invalidate()`; a red emitter beside a probe is read back from that side;
  a mirror off the probe's centre shows a marker on the wall where the parallax-corrected ray ends.
- Off = unchanged: stills of both examples without any flag, before and after this work (`snap.mjs --baseline`).

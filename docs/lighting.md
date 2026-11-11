# Realtime lighting: cascades, probe GI, bounce light, reflection probes, many lights, screen-space passes, planar reflection

Seven features, all **experimental** and all **off by default**. They are turned on per world:

```js
const world = createWorldRenderer({
  lighting: {
    csm: true,                                                    // cascaded sun shadows
    gi: { min: [-4, 3.6, -29], max: [4, 7.4, -21], spacing: 1.2 }, // irradiance probes over one box
    bounce: true,                                                 // one-bounce light from a height field (or { min, max, spacing })
    probes: [{ min: [-4, 3.6, -29], max: [4, 7.4, -21] }],          // box reflection probes (at most 4)
    lights: true,                                                 // clustered local lights + shadow atlas
    screen: true,                                                 // SSR, SSGI, contact shadows (world.post.ssr2 / ssgi / contact)
    planar: { y: 0 },                                             // a planar reflection of flat (wet) ground at y = 0
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
| `?csm=1` (`&cascades=2..4`, `&stagger=1`) | cascaded sun shadows (`stagger`: far cascades redrawn less often); walled-garden also `&soft=1` for the contact-hardening filter per cascade |
| `?gi=1` (`&gispacing=m`) | the probe volume: walled-garden's pavilion interior (lit through its doors), hello-courtyard's court |
| `?bounce=1` (`&bspacing=m`) | hello-courtyard: bounce light over the shadow volume; `probes/nizwa-probe/?bounce=1`: over the fort |
| `?probes=1` | one box reflection probe (the pavilion room; the court) |
| `?lights=N` | N lamps on the clustered path (`&cluster=0`: the plain loop over all lights; `&stock=1`: three's own PointLights instead, for comparison) |
| `&percell=64` | cap the lights per cluster cell (the examples ask for `perCell: 0`, no cap) |
| `?ssr=1` `?ssgi=1` `?contact=1` | the screen-space passes (below) |
| `&lshadows=K` | the first K lamps cast shadows from the atlas |
| `?planar=1` (`&planary=m`, `&planarscale=0.5`, `&planarevery=N`) | the planar reflection: hello-courtyard's floor (with `?wet=0.8`), walled-garden's two pools (their water, 1.94 m) |

`examples/walled-garden/?gi=1&probes=1&csm=1&lights=64&lshadows=4&time=20:30`. On `examples/hello-courtyard/` use `lights=8`: 64 lamps in that small yard over-expose most views (there is no exposure adaptation unless auto exposure is on).

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

**`stagger: true`** (opt-in). On a moving frame only some cascades are redrawn: the first every frame, the second
every 2nd, the third every 4th, the fourth every 8th (2.13 of 4 on average, counted). three clears and draws the
atlas through the shadow target's own scissor, so the tiles that are kept are simply outside it. A kept cascade
keeps its matrix, so its shadows stay where they were drawn; cascades after the first are `pad` (12 %) larger than
their slice and are redrawn at once when the slice has drifted out of that margin or the sun has moved. The price: a
caster moving inside a far cascade moves its shadow at that cascade's rate, and the padded cascades have 12 % larger
texels (a moving frame differs from the unstaggered one by 52.4-52.9 dB). Stills and captures always draw all four.
Measured at 1440 x 900, panning, interleaved: walled-garden 3.60 [3.50-3.60] -> 3.30 [3.20-3.30] ms; at 2880 x 1800
10.10 -> 10.00 ms; hello-courtyard 3.20 -> 3.20 (its shadow pass is too cheap to show).

The contact-hardening filter (`softShadows`) already runs per cascade; `contact` (below) adds the screen-space
contact shadow.

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

What it does to a scene, and why (diagnosed on Nizwa Fort, `probes/nizwa-probe/?gi=1`, and hello-courtyard): the
volume *replaces* the world's image-based diffuse light with what its probes captured, at the capture's brightness.
The world's light is calibrated (`envIntensity`, one capture point); the probes are not. In hello-courtyard
(`envIntensity` 0.5) the court came out about twice as bright (hero shade 80 -> 108 of 255) and the gate's outer wall
2.4 times (37 -> 88): the wall's outside face lies in the box's fade band and takes the court's probes. On the fort
(`envIntensity` 1) the probes agree with the image-based light in the open (a white sphere in the forecourt: within
1 of 255), but at the tower top they see dark, ambient-lit masonry and less sky than the forecourt capture point, so
the shade drops (crown, shaded wall 57 -> 45). The bridged Nizwa materials are not the cause (their `fragLight` hooks
touch direct light only; the part's anchors are found in all 71). The fort's 51 s were two things: about 25 s of lit
programs linked one by one in the first capture (the parallel compile in `prepare()` did not include the variants
with the environment: fixed, now 2-3 s) and 36-46 s of bake: 3,536 probes x 2 passes x 12 cube faces of the
1.6 M-triangle scene. That cost grows with probes x triangles; for the town (25.7 M triangles) it is out of reach.
For sunlit shade next to sunlit walls, use `bounce` below.

## One-bounce light from a height field (`bounce`)

`packages/core/src/bounce.js`, ported from the author's Nizwa Golden Hour project (`src/core/irradiance.js`). Warm
light from sunlit walls and ground into the shade next to them, and the sky occlusion of lanes and courts, as a
factor on every lit material's image-based diffuse light. A world of walls, roofs and ground is close to 2.5D, so
the probes are gathered from a height field of the real scene instead of a cube render per probe:

1. At `prepare()` (and after `invalidate()`): one orthographic draw of the built scene from above, with its own
   materials under a uniform white sky and every light off (= albedo); its depth is the height. Mipmapped.
2. Per bake: the key light's shadow height over the map (one march toward the light per texel).
3. Per bake: every probe (a grid over the box: `spacing` in x and z, `layers` heights, `curve` 2 = dense at the
   ground) marches 48 fixed directions through the height field: a ray that leaves sees the world's image-based
   light; a ray that drops onto a top sees albedo / pi x (key x cos x lit + sky); a ray that runs into the side of a
   column sees a wall (the albedo of its top, its normal against the ray, lit by the shadow height just outside
   it); `multi` stands in for the further bounces (1 / (1 - multi x albedo)). Stored as L1 spherical harmonics,
   premultiplied by validity (a probe inside a solid or under a roof is 0). One more probe is gathered at
   `envProbe`, where the world's image-based light is captured: the reference.
4. Materials: `iblIrradiance *= E_local(n) / E_reference(n)`, clamped to 0.3..4. The world's light keeps its level
   and only gains the local variation: the bake's own biases (and `envIntensity`) cancel in the ratio. Outside the
   grid the factor fades to 1 over `edge` probes.

```js
createWorldRenderer({ shadow: { center: [0, 2, 0], radius: 17 }, lighting: { bounce: true } });   // the shadow volume
createWorldRenderer({ lighting: { bounce: { min: [-34, 0.5, -46], max: [92, 33, 62], layers: 12, curve: 1.3 } } });
world.lighting.bounce.info       // { probes, grid, map, box, prepareMs, bakeMs, bakes }
world.lighting.bounce.strength = 0.5;
```

Time of day: a bake follows each recapture of the image-based light. A still (`setTime` without `ease`) bakes at
once, so stills are exact and repeat bit for bit. A running clock gathers one band of one layer per frame and then
eases the volume the materials read toward the new one (0.45 s), so nothing steps.

Settings (`BOUNCE_DEFAULTS`): `spacing` 2 m, `layers` 8, `curve` 2, `texel` 0.5 m, `margin` 8 m, `hmax` (rays above
escape; 0 = box top + 4 m), `strength` 1, `multi` 0.55, `edge` 3, `lo` 0.3, `hi` 4, `bands` 3, `ease` 0.45 s,
`maxProbes` 400,000 (the spacing grows to fit), `maxMap` 4096 px (the texel grows to fit), `keep(object)`. Objects
whose root has `userData.mgDynamic`, `mgNoCapture` or `mgNoBounce` are left out, as are points, lines, sprites and
transparent meshes.

Limits: one height per (x, z). Under an arch, a roof or a floor the probes are invalid and the image-based light
stays as it is (rooms: ambient volumes); a balcony is a column to the ground; a camera inside a solid that its
one-sided cap hides from below sees no change (the probe's crown view: its eye, 25.6 m up, is under a surface at
27.0 m that the height field sees from above and the camera does not see from below). Local lamps are not in it. Do not turn on `gi` over the same area (both act on the
same term; the world warns).

Measured (Apple M4 Pro, a GPU shared with other jobs, headless Chrome; GPU-synced, 4-5 repeats, range):

| | Nizwa Fort (`probes/nizwa-probe/?bounce=1`) | hello-courtyard (`?bounce=1`) | Nizwa's town grid on the fort |
|---|---|---|---|
| grid | 64 x 12 x 55 = 42,240 probes, 2 m; map 284 x 248 | 35 x 8 x 35 = 9,800, 1 m; map 100 x 100 | 168 x 8 x 192 = 258,048, 2 m; map 700 x 796 |
| height field (one draw of the scene) | 5-11 ms (1.6 M triangles) | 2.7-2.9 ms | 4-7 ms (the same 1.6 M) |
| bake (shadow height, gather, copy) | 31-41 ms | 4.3-4.7 ms | 45-64 ms |
| page ready | 2.3-4.5 s, as without (`gi=1`: 49-61 s) | 0.6-0.7 s (without: 0.55-0.6 s) | |

A running clock on the fort (16:30 -> 17:30 over 360 temporal-AA frames, gate view): 5 re-bakes, +0.6 ms median and
+1.4 ms p90 per frame against the same run without, and no step in a shaded pixel beyond the image-based light's own
cross-fade (largest frame-to-frame change 8 of 255 with, 9 without). The per-pixel cost of the factor (the same
frames with the strength at 0 and 1, 12 alternating blocks of 40 temporal-AA frames, three spots, two runs) was
below what this shared GPU resolves: -0.2 to +1.3 ms at 1440 x 900 (median +0.2), with blocks spreading 3-20 ms.

For the town (25.7 M triangles, 956 rooms): the height field is one draw of the town (Nizwa does the same at load),
the gather is the 258,048-probe row above, and a running clock spreads it over 27 frames (`bands` 3; raise `bands`
for a smaller per-frame share). Rooms stay with ambient volumes (gap 5 of the probe's report). Not measured here:
the draw of 25.7 M triangles, other GPUs, phones.

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
`perCell: 0` removes the limit: the index texture grows to what the frame needs, and the result is the plain loop's
(hello-courtyard `?lights=100&time=20:30`, two views, 4 spp: bit-identical to `&cluster=0`; with `&percell=64` the
same views are 53.4 and 54.8 dB from it, largest difference 6 of 255).

## Screen-space reflections, indirect light and contact shadows (`screen`)

`lighting: { screen: true }` adds one part to the lit materials and three half-size passes before the scene is drawn
(`packages/core/src/screen.js`). Nothing runs until a strength is above 0; the strengths are post settings:

| option | URL flag | what |
|---|---|---|
| `ssr2: 0..1` (`ssrRough`, `ssrDist`, `ssrThick`) | `?ssr=1` (`&ssrrough=0.55`) | reflections of what is on screen, up to roughness `ssrRough` |
| `ssgi: 0..1` (`ssgiRange` m, `ssgiRays`) | `?ssgi=1` (`&girange=3&girays=1`) | short-range indirect light with the colour of what it bounced off |
| `contact: 0..1` (`contactLen` m) | `?contact=1` | short sun shadows traced in the depth buffer |

`examples/hello-courtyard/?wet=0.8&ssr=1&ssgi=1&contact=1` (wet cobbles reflect the arcade, the posts and the
fountain); the same flags on `examples/walled-garden/`.

How: the opaque lit meshes are drawn once more with their own programs into a small G-buffer (normal, roughness;
the part ends the shader early), on their own layer and without touching the shadow maps. One trace shader marches
the depth buffer in view space with growing steps, a thickness test and a bisection at the hit: a GGX-distributed
ray for reflections, cosine rays for indirect light, one ray toward the sun for contact shadows. Hits read the
previous frame's lit colour, reprojected. Each result is blended with its reprojected history (depth rejection;
reflections reproject at the virtual hit distance) and blurred edge-aware, wider on rougher surfaces. The materials
then use it where three shades: a reflection replaces the environment (reflection probe, then sky) by its
confidence, faded at the screen edge and toward `ssrRough`; indirect light is added to the irradiance and the
probe volume / ambient there is scaled by the rays' visibility, so GI and SSGI are one sum; the contact term
multiplies the sun.

Stills use a reference mode: full-size buffers, more steps, a new random sequence per sub-frame, no history and no
blur, so `spp` converges them like everything else and a still does not depend on the frames before it (the first
sub-frame draws the scene once to have a colour to read). They are shaded into the HDR scene target, so
`mirage-snap --png16 --exr` carries them (checked: both files change with the flags).

Limits, plainly. Only what is on screen can be reflected or bounce light; off-screen and behind-the-camera hits
fall back to the probe or the sky. The colour is last frame's (one frame of lag, one bounce per frame). History is
reprojected by the camera matrices, not the velocity buffer (the passes run before that frame's velocities exist),
so reflections of moving objects trail for a few frames. The half-size results are stretched without a depth-aware
upsample. Transparent and unlit meshes are not in the G-buffer. With `?light2=1` the older deferred SSR also runs
(`l2=nossr` turns it off). `ao` and `ssgi` both darken corners: lower one. Not in XR.

## Planar reflection of flat ground (`planar`)

`packages/core/src/planar.js`. Screen-space reflections can only mirror what is on screen: a puddle in the lower half
of the frame cannot show the lamp above the frame or the sky behind the camera. For one horizontal plane per world
the scene is drawn once more, from the camera mirrored in the plane, and the lit materials read that image.

```js
createWorldRenderer({ lighting: { planar: { y: 0 } } });   // PLANAR_DEFAULTS below
world.lighting.planar.info   // { on, size, calls, ms, renders, kept, skipped }
world.lighting.planar.cfg.y = 0.1;   // live: y, fade, roughMax, clip, every are read each sub-frame
```

| setting | default | |
|---|---|---|
| `y` | 0 | m: the plane's height |
| `scale` | 0.5 | the mirror target's size, x the frame (0.1..1) |
| `roughMax` | 0.35 | surfaces rougher than this keep the probe / sky reflection (the mirror fades in from 0.7 x it) |
| `fade` | 0.25 | m above / below the plane over which the mirror fades out |
| `clip` | 0.02 | m: the mirror pass's near plane sits this far above the plane (the ground does not mirror itself) |
| `layers` | null | three.js layers the mirror pass draws (an array); null = the view camera's |
| `every` | 1 | moving frames redraw the mirror every Nth frame; stills always redraw it |

How. Before each sub-frame's scene pass (the pipeline calls the planar pass ahead of the screen-space passes):

1. The mirror camera is the view camera's world matrix reflected in the plane, its x axis turned back (a proper
   rotation, so three's face culling holds; the image is left-right turned, which the lookup does not mind), with the
   view's own projection (temporal-AA jitter, lens offset) and Lengyel's oblique near plane at `y + clip`: nothing under
   the plane is drawn, with no change to the shaders.
2. The scene is drawn with it into a mipmapped half-float target of `scale` x the frame, with the world's own
   materials, lights, sky and fog, without the post chain, without objects marked `userData.mgNoCapture` (rain
   streaks, particles), and with the part switched off and its sampler unbound (no recursion, no feedback loop).
   It is the sub-frame's first render, so it draws the shadow maps (the sun is already fitted to the view); the scene
   pass then reuses them instead of drawing them again. Shadows are not drawn twice, and a still does not depend on
   the frame before it.
3. In the lit materials (an injected part, order 45: after reflection probes and screen-space reflections): a pixel
   within `fade` of the plane, facing up (world normal y 0.72..0.9 fades it in) and no rougher than `roughMax` projects
   its world position into the mirror camera; the reflected ray of the shaded normal (normal maps, wet ripples, the
   cobbles' relief) minus the flat mirror ray, taken 2.5 m out, moves the lookup, so ripples and bumps distort the
   image. Roughness blurs it: a mip level for the width (alpha x 0.6 of the target's height, in pixels) and four taps
   stretched 3x along the target's vertical, which smears reflections toward the viewer as on a wet street. The
   result replaces `iblRadiance` (the probe / sky reflection) by that weight, before three's specular response, so
   Fresnel and the surface's own tint stay the material's. The target's outer 3 % fades out.

With `withWet` materials the standing water (roughness about 0.05) mirrors sharply, the soaked film (0.1-0.2) gets a
blurred, stretched image, and damp ground (0.42 and up) keeps its probe / sky reflection.

Moving frames redraw the mirror every `every` frames; a kept mirror is read with the matrix it was drawn with, so it
stays registered on the ground while the camera moves (what it shows lags). Still sub-frames always redraw it: jitter,
lens and time change per sub-frame, and the still converges with `spp` like everything else.

**Planar over screen-space reflections.** Where both apply, the plane's mirror wins (it is this frame's, holds what
is off screen, and has no thickness guess); SSR keeps walls, steps and anything off the plane. Measured: moving
frames (60 temporal-AA frames after a pan) against their own 64-sample still, hello-courtyard `?wet=0.8`, 960 x 600:
hero view 33.36 dB with planar over SSR, 33.12 dB with SSR over planar (the part's order switched at run time); a
view down across the floor 35.57 against 35.02 dB. For comparison: off 33.57 / 35.96, SSR alone 32.99 / 34.76,
planar alone 33.43 / 35.69. SSR's temporal noise costs more than the mirror does.

Limits, plainly:
- One plane per world, horizontal. Surfaces more than `fade` off it (steps, a raised kerb, a pool at another level),
  walls and sloped ground keep the probe / SSR reflection.
- A pixel at height h above the plane is looked up as if it lay on it: an offset of about h in the mirror (the reason
  for `fade`). The normal's distortion assumes what is mirrored is 2.5 m away.
- The scene is drawn a second time: its CPU cost (draw calls: `info.calls`) and GPU cost grow with the scene, not with
  the wet area. `every: 2` halves it on moving frames.
- Fog of the mirror pass is counted from the mirrored eye, under the ground: the eye-to-puddle stretch is fogged
  twice, and the height fog sees an eye a little lower. Small in a court; visible over long wet streets in fog.
- Per-view hooks (`onView`: LOD, instance culling, occlusion culling) run for the view camera only; the mirror sees
  what they left. An instanced object culled from the view (above the frame) is missing from the mirror too.
- The clustered lights take their plain loop in the mirror pass (correct, not culled); the lamp pool bins its
  lamps for the mirror camera and again for the view (two binnings a frame; its `info.binMs`).
- Temporal AA (`taa`, `taa2`) reprojects the mirror image by the surface's motion, not the reflection's: a reflection
  of something far smears a little under a fast pan.
- Not in XR. Perspective cameras only. A camera at or under the plane gets no mirror (`info.skipped`).
- `info.ms` is the CPU time to submit the mirror pass; its GPU cost is in the table below.

Measured (Apple M4 Pro shared with other GPU jobs, headless Chrome, ANGLE Metal): hello-courtyard `?wet=0.8`, hero
view, moving frames (temporal AA, a pan), each frame ended by a 1-px `readPixels`; five pages in one Chrome, 8 rounds
round-robin over them, 40 frames a round; median of the round medians [lowest-highest], ms per frame. The mirror pass
draws 34 calls.

| | 1440 x 900 | 2880 x 1800 |
|---|---|---|
| off | 3.20 [3.10-3.30] | 10.20 [9.80-10.60] |
| `planar=1` | 3.60 [3.40-3.90] | 10.10 [9.60-10.40] |
| `planar=1&planarevery=2` | 3.40 [3.20-3.50] | 9.90 [9.50-11.70] |
| `ssr=1` | 3.70 [3.60-3.80] | 11.40 [10.90-11.90] |
| `planar=1&ssr=1` | 4.20 [4.00-4.50] | 12.20 [11.50-12.60] |

Reading it: +0.4 ms at 1440 x 900 (SSR: +0.5). At 2880 x 1800 alone it is inside the spread (an earlier run of 6
rounds: off 12.2 [10.5-13.0], planar 12.0 [9.9-12.6]); on top of SSR it adds 0.8 ms. Its cost is mostly a second
draw of a small scene at a quarter of the pixels, so it does not grow with the resolution the way SSR does. Not
measured: big scenes (where the second draw's CPU side will dominate), other GPUs, phones.

## Measured

Screen-space passes, hello-courtyard `?wet=0.8`, moving frames with a pan, 5 interleaved rounds of 30 frames, median
[min-max] ms per frame (this machine's GPU, headless Chrome):

| | 1440 x 900 | 2880 x 1800 |
|---|---|---|
| off | 3.30 [3.20-3.50] | 11.9 [11.3-12.6] |
| `ssr2` | 4.00 [3.90-4.30] | 13.80 [13.20-14.70] |
| `ssgi` | 4.20 [4.10-4.30] | 15.00 [14.30-15.30] |
| `contact` | 4.10 [4.10-4.20] | 14.80 [14.00-15.60] |
| all three | 4.40 [4.30-4.50] | 15.80 [15.10-16.20] |

Each pass alone pays for the G-buffer draw; together they share it. Quality at 960 x 600 against a 64-sample
reference still with all three on (PSNR): hello-courtyard 4 spp 37.4 dB, 16 spp 45.0 dB; a moving frame with the
passes 36.9 dB, without 29.9 dB. walled-garden: 38.5, 45.9; 40.3 against 38.0.

Apple M4 Pro, headless Chrome (ANGLE Metal), a machine shared with other GPU jobs while measuring. Every variant
is its own page in one Chrome; six rounds go round-robin over the pages (A/B interleaved), 40 walking (temporal-AA)
frames a round, each frame ended by a 1-px `readPixels`. A number is the median of the six round medians, the
bracket their lowest and highest. ms per frame; "100 lamps" = `?lights=100`, range 6 m.

1440 x 900 (pixel ratio 1):

| | hello-courtyard, hero | walled-garden, gate | walled-garden, interior |
|---|---|---|---|
| nothing on | 3.4 [3.2-3.5] | 3.8 [3.4-4.0] | 4.0 [3.8-4.2] |
| `csm=1` | 3.4 [3.4-3.6] | 4.0 [3.8-4.2] | 4.3 [4.0-5.2] |
| `gi=1` | 3.6 [3.3-3.6] | 3.5 [3.3-3.6] | 4.2 [3.8-4.8] |
| `probes=1` | 3.2 [3.0-3.5] | 3.5 [3.4-4.2] | 4.0 [3.5-4.2] |
| 100 lamps, clustered | 6.2 [5.9-6.3] | 3.6 [3.4-3.9] | 3.9 [3.6-4.4] |
| 100 lamps, plain loop (`cluster=0`) | 7.0 [6.7-7.1] | 6.1 [5.3-6.3] | 6.7 [6.1-7.5] |
| 100 lamps as three's own PointLights (`stock=1`) | 183.4 [175.7-185.3] | 121.6 [112.2-122.1] | 146.9 [143.0-147.3] |
| 100 lamps clustered, 8 shadowed | 6.5 [6.4-6.6] | 3.8 [3.4-3.9] | 4.2 [3.8-4.4] |
| everything | 7.5 [7.2-7.7] | 4.3 [3.8-4.5] | 5.3 [4.7-5.5] |

2880 x 1800 (pixel ratio 2):

| | hello-courtyard, hero | walled-garden, gate | walled-garden, interior |
|---|---|---|---|
| nothing on | 11.3 [9.8-12.3] | 18.8 [11.2-35.1] | 13.2 [12.6-18.6] |
| `csm=1` | 10.9 [9.5-12.5] | 18.3 [11.0-38.8] | 13.1 [12.5-23.4] |
| `gi=1` | 11.5 [10.0-13.1] | 17.0 [10.7-39.8] | 13.5 [12.6-24.2] |
| `probes=1` | 10.2 [9.6-12.2] | 16.9 [10.5-37.8] | 12.4 [12.0-22.6] |
| 100 lamps, clustered | 19.8 [18.0-21.1] | 16.8 [10.8-33.8] | 12.7 [12.2-22.1] |
| 100 lamps, plain loop | 22.5 [19.9-25.6] | 22.7 [15.6-49.8] | 21.1 [19.8-41.1] |
| 100 lamps as three's own PointLights | 542 [529-555] | 355 [345-463] | 499 [482-601] |
| 100 lamps clustered, 8 shadowed | 21.5 [18.0-23.0] | 17.9 [10.8-30.0] | 15.9 [12.7-29.4] |
| everything | 24.1 [20.0-31.8] | 19.4 [11.5-32.8] | 15.1 [14.9-22.9] |

Reading it honestly:

- Cascades, the probe volume and one reflection probe each cost less than the run-to-run spread on these scenes
  (0.3 ms or so at pixel ratio 1, several ms at 2 on the loaded machine): their cost is **not resolved**, not zero.
  The pixel-ratio-2 walled-garden rows are too noisy to rank anything but the lamp rows.
- 100 lamps: three's own lights are 30-50 times the frame; the light texture alone (plain loop) brings that to
  +2.3 to +3.6 ms at ratio 1; clustering brings it to within the spread of no lamps at all in walled-garden (lamps
  spread over 40 x 40 m). In hello-courtyard 100 lamps of 6 m range sit in a 16 m court, nearly every lamp reaches
  nearly every cell, and clustering saves little (6.2 against 7.0); there the 64-per-cell cap also dropped 782 cell
  entries, so that image is not exact (walled-garden: 0 dropped).

One-off costs, GPU-synced the same way:

| | hello-courtyard | walled-garden |
|---|---|---|
| probe volume bake at load (2 bounces) | 400 probes: 369-452 ms | 196 probes: 315-495 ms (649-1225 ms in the ratio-2 run, machine loaded) |
| a frame that captures one reflection probe | 9.9-12.6 ms against 3.1 (ratio 1); 15.0-19.7 against 11 (ratio 2) | 11.8-16.9 against 3.8-4.9; 18.9-31.7 against 17-19 |
| a frame that redraws one shadow tile (a lamp moving every frame) | +0.7 to +1.2 ms | +0.1 to +1.6 ms (ratio 1), +0.7 to +3.2 (ratio 2) |
| shadow tiles redrawn while nothing moves | 0 | 0 |

Not measured: other GPUs (nothing here ran on a phone or an integrated Intel/AMD GPU), the incremental re-bake's
per-frame cost while the clock moves, CSM with `softShadows`, more than one reflection probe, spot lights.

## What Unity HDRP and Unreal still have

- **Hardware ray tracing** (reflections, shadows and GI of what is off screen). Everything here that is not a
  probe is screen space: it cannot show what the camera does not see.
- **Lumen's surface cache and far field**: multi-bounce GI of a whole changing level. Here: one probe box baked
  ahead plus one screen-space bounce.
- **Virtual shadow maps**: a shadow texel per pixel at any distance. Here: 4 cascades in one atlas (staggered at
  best) and an atlas of light tiles; spot lights were not given a single-tile path in this round.
- **Nanite**: no virtualised geometry; LOD, impostors and HLOD only (`docs/big-worlds.md`).
- **A path tracer.** The stills accumulate the rasteriser's own effects (area sun, lens, the reference mode above):
  they converge to this renderer's answer, not to ground truth.
- Not done in this round either: time-sliced reflection-probe capture (a capture is still one hitch), more than 4
  probes, velocities for instanced / morphed / batched meshes and transparents (skinned meshes have them), a
  negative mip bias under upscaling (WebGL2 has no sampler LOD bias; it would have to go into every lookup).

## Checks

- `node packages/tools/src/screen-check.mjs examples/hello-courtyard/dist examples/walled-garden/dist` in Chrome: the
  lit programs carry the part; no pass runs with the strengths at 0; each pass alone and all three change the frame
  without a GL error; a still is the same after another view was drawn; 16 sub-frames are closer to the 64-sample
  reference than 4; a moving frame with the passes is closer to it than one without.
- `node packages/core/lighting.check.mjs` (part of `npm test`): splits, slice spheres, texel snapping, the probe
  grid and atlas tiles, the bounce grid (layer heights, the probe and map caps, Nizwa's town grid), cluster slices and sphere spans against brute force, the tile allocator, box exits and
  probe weights, and the injector (no part = stock source and stock program key; `THREE.ShaderChunk` untouched).
- `node packages/tools/src/lighting-check.mjs examples/walled-garden/dist examples/hello-courtyard/dist` in Chrome
  with everything on: no console errors or missing shader anchors; each part is in the compiled programs; clustered
  shading equals the plain loop on three views; a quiet scene redraws no shadow tile and a moved lamp redraws one;
  a new caster darkens the ground after `invalidate()`; a red emitter beside a probe is read back from that side;
  a mirror off the probe's centre shows a marker on the wall where the parallax-corrected ray ends.
- `node packages/tools/src/planar-check.mjs examples/hello-courtyard/dist --garden=examples/walled-garden/dist
  [--before=<hello-courtyard dist built before> --garden-before=<walled-garden dist built before>] [--out=dir]` in
  Chrome: the lit programs carry the planar part (and the pages without it do not); the mirror pass draws; a red
  emitter put above the frame, out of view, along the ray a wet patch of ground mirrors, turns that patch red with
  planar on (redness -6 -> 87) and changes nothing with it off (-4.3 -> -4.3); a still with planar is byte-identical
  when drawn again after another view and moving frames; moving frames with `taa2`, `ssr`, 8 clustered lamps and
  the lamp pool draw the mirror every frame; no page errors, GL errors or shader warnings; walled-garden's pools change
  with it. With `--before`: hello-courtyard (hero, gate; dry and `wet=0.8`) and walled-garden (pools, gate, looking
  back) without `planar` are byte-identical to the build from before it.
- `node packages/core/lighting.check.mjs` also checks the planar maths: the mirror matrix, the mirror camera (a proper
  rotation, the eye mirrored), points above the plane landing where the real camera sees their mirror images, points
  under the clip plane cut by the oblique near plane and points on it at depth -1, only the projection's z row changed.
- Off = unchanged: stills of both examples without any flag (hello-courtyard hero and corner, walled-garden gate and
  aerial, 1440 x 900), built from the commit before this work and from this branch in the same session: the PNGs
  are byte-identical.

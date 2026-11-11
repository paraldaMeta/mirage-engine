# Notes — neon-district

A small first-person shooter in one rain-wet block of a city at night: the alley, Kestrel Street, a noodle bar,
the plaza, the relay (a server room and a stairwell) and its roof. About five minutes from the spawn to the end.
It is the engine's showcase, so this file first says which engine feature each part shows and where the code is,
then holds the modules' own sections (the convention of `docs/world-protocol.md`).

```
npm run dev -w neon-district            # http://localhost:5194
npm run build -w neon-district && npm run playtest -w neon-district     # the whole route, headless
npm run playtest:holdout -w neon-district                               # the holdout's first waves, headless
node examples/neon-district/scripts/measure.mjs --ab                   # frame time per quality and per feature
node examples/neon-district/scripts/controls-check.mjs                 # title, holdout, keys, gamepad and touch, with real events (ONLY=touch: one part)
node examples/neon-district/scripts/gameshots.mjs                      # frames of the running game, a contact sheet
node examples/neon-district/scripts/kitshots.mjs                       # the hacks, abilities and new jobs in frames (out/kit)
```

The playtest takes about nine minutes: it plays the route (152 steps: every wall, door and stair on it, the hacks, the abilities, the ammunition, the
fights, the pass, the relay door, the uplink and its wave) and a view with rain never comes to rest, which the tool
waits for before each of its 17 screenshots.

Everything is made in code. There is no texture, model or sound file in the folder: surfaces are GLSL hooks,
signs are text drawn into a canvas with the system's own font (so the glyph shapes follow the machine: the
Traditional Chinese signs need a CJK font, which macOS, Windows, Android and iOS ship), sounds are synthesised at
the first click. Nothing was taken from another project.

## What makes it different

**The city is your weapon.** The gun is the fallback; the district is the toolkit (`game/kit.js` wires it all).

- **Hack** (hold G, pad B; `game/hack.js`). Look at something of the city's within 25 m, a ring fills in 0.8 s, it
  happens; three charge pips, one back every 8 s. The scan view while the key is held puts holo brackets on
  everything hackable and marks robots within 30 m through walls (for 2 s after). Targets: every **street lamp** and
  four **breaker boxes** (the alley, the bar, the server room, the roof) put their zone out for 12 s: pool lamps,
  clustered lamps and sign faces really switch off (`world.lampPool.set` with scaled powers, the clustered lamps'
  `nd`, the sign materials), then stutter back. In the dark the sentinels see a third as far, hit about a third as
  often, and those fighting there lose the player and go looking; the player's visor raises the robots' rim and marks
  the ones in the dark. Every low **sign** overloads into an EMP that stuns robots within 6.5 m for 4 s; every
  **vent** blows a steam cloud no sentinel sees through for 10 s; every parked **car**'s alarm lures whoever is awake
  within 26 m; a **kite** is turned for 15 s (it hunts sentinels, then burns out); a **sentinel** (two pips) has its
  weapon jammed for 5 s, a warden only from behind or while stunned. Every fight on the route has at least two hack
  options (alley: a breaker, two vents, two signs; street: lamps, cars, vents, signs, a kite; bar: a breaker, two
  signs; plaza: four lamps, vents, signs, kites, the mender; server room: its breaker and the robots themselves; roof:
  its breaker, the parapet sign, the wave's kites). The first fight teaches it with a radio line and a prompt.
- **Abilities** (`game/abilities.js`): **dash** (1; 5 m the way you move, 0.35 s in which every shot misses, 5 s),
  **EMP grenade** (2; an arc, stuns robots within 5 m for 4 s, 12 s), **overdrive** (3; charged by damage dealt, kills
  and hacks; 8 s of everything marked through walls, fire 1.7 x as fast, reloads in half the time, free hacks).
- **Enemy jobs** (`game/enemies.js`, `game/drones.js`), on the two rigs, each with its own accent and tell: the
  **shield sentinel** (amber; a curved shield that stops rounds from the front: flank it, EMP it, hack it, or shoot
  the lit emitter on its lower rim), the **marksman** (violet; holds the relay's roof over the plaza; a beam tightens
  on you for 1.2 s before a heavy shot: break the line or dash), the **mender kite** (green ring; mends damaged
  sentinels with a beam and keeps away from you), and the **warden** (a red lamp on its chest and a rising whine
  0.8 s before a nine-round suppressing burst). Distinct hit, head-shot, shield-hit and kill sounds and crosshair
  marks; a dim rim on the armour so robots read in the dark. The holdout brings shields from wave 2, marksmen from
  wave 3, menders from wave 4.
- **Ammunition you can always find** (`game/ammo.js`): sentinels drop ammo cells (always when your reserve is under
  two magazines or the kill was with the stock; otherwise 35 %, every third kill at the latest), kites drop small
  ones; five crates along the route (`plan.crates`) with a lamp and a holo glyph refill 30 s after they are emptied.
  Under two magazines the counter goes amber and a waypoint and a compass tick point at the nearest full crate or
  cell; dry, it pulses, a hint line shows and the radio says so once. Melee does 2.4 x on a stunned robot, so the
  stock, the hacks, the grenade and turned kites are never a dead end.
- **A short story with a sting** (`game/story.js`): a three-line cold open; the handler's name tag going wrong along
  the route (CONTROL, C0NTR0L, CONTROL//RELAY-07); three clues (the pass card is issued to the relay itself, a
  sentinel's banter line "there is no Control", the handler's slip "we— you"); when the uplink completes the
  handler admits it is the relay's own mind and you have just let it out, every sign on the street stutters, and a
  closing card has one last line. The holdout opens on a one-line epigraph instead. Idle sentinels trade deadpan
  pairs over their heads when you are near and unseen; alert, hurt, hacked, stunned and lured barks keep the same
  voice (a synthesised blip). Comic hit words pop on head shots, shield breaks, EMPs and overloads (the options
  panel turns them off). All of it in English and Traditional Chinese (`game/text.js`, the `xt` tables).

Keys and buttons of the kit (the touch layer is wired separately, through the API in `game/kit.js`):

| | keyboard / mouse | gamepad |
|---|---|---|
| hack (hold) | G | B |
| dash · EMP grenade · overdrive | 1 · 2 · 3 (mouse back / forward: dash / grenade) | d-pad left · d-pad right · d-pad up |

What is rough: the bar's paper lanterns and bottle neon and every LED wall are shared emissive materials, so a dark
zone leaves them glowing (a street lamp's panel gets a dark cover instead); the bar's baked irradiance probes keep a
little of the lamps' bounce in the dark. The marksman's beam is a stretched box, not a volumetric beam. Robots do
not hear the steam or the alarm of a car beyond the radius; a lured sentinel looks round the car, then goes home.
Banter is timed with the page clock, not the game's (a pause does not hold a pair mid-line). The holdout's wave
composition is checked only for its first waves by the scripted test. Tests: `?reserve=N` starts with N rounds in
reserve (the playtest starts low so a drop, the marker and a crate are certain); the assist mode's floor on the
reserve is now one magazine (it was two), low enough for the marker to show.

## What shows what

| part of the district | engine feature | where |
|---|---|---|
| the whole world | site plan + modules + anchors (`@miragekit/world`), ten modules | `plan.js`, `modules/` |
| any hour: `?time=night\|dawn\|day\|dusk\|HH:MM`, T in the game, a slider in the options | `world.setTime(t, { ease: true })`; the probes bake again, the lamps follow the hour | `main.js` `setHour`, `relight` |
| the hour's look: blue shadows and magenta-cyan lights by night, warm smog by day | the time-of-day grade (`grade`, four custom looks) | `main.js` |
| sunset and night skies, cloud cells | the dusk sky (`sky: { dusk }`) | `main.js` |
| shafts between the towers and the sun's flare by day and at dusk | `post.godrays`, `post.flare` | `main.js` |
| light off the sunlit side of a street into the shade | bounce light (`lighting.bounce`) | `main.js` |
| wet asphalt, paving, roofs: puddles, rain rings | `withWet`, `setWetness`, `setRain` | `modules/materials.js` |
| reflections of the signs in the street | screen-space reflections `post.ssr2` (`lighting.screen`) | `main.js` |
| every sign, neon line, screen and bridge lights what is round it (over a hundred lamps) | the lamp pool (`lampPool`, `world.lampPool.set`), each lamp cut at the wall it hangs on (`normal`, `back`) | `modules/lib.js` `lamp()`, `main.js` |
| lamps that cast shadows, flicker or stay lit indoors by day | clustered lights, `world.lighting.addLight` | `modules/lib.js` `lamp()` |
| lamp shadows (street lamps, the hologram, interiors) | the clustered path's shadow atlas (`{ shadow: true }`) | `modules/lib.js` |
| the noodle bar's warm bounce | irradiance probe volume (`lighting.gi`) over `plan.bar.rect` | `main.js`, `modules/bar.js` |
| tiles, lacquer and racks that mirror their room | two box reflection probes (`lighting.probes`): the bar, the relay | `main.js` |
| the relay and the stairwell are dark without their lamps | `ambientVolumes` (the bar declares one only when the probes are off) | `modules/relay.js`, `modules/bar.js` |
| short-range bounce and grounding outdoors | `post.ssgi`, `post.contact` (high) | `main.js` |
| Moon shadows that stay sharp near the viewer | cascaded shadows, staggered (`lighting.csm`, high) | `main.js` |
| halos round the street lamps, shafts past the posts | `light2` volumetric light, fed by `addLampSource` with the clustered lamps marked `vol` | `main.js` |
| haze down the street | height fog (`fog`) | `main.js` |
| signs, windows, screens, the hologram | `mat.glow`, emissive hooks scaled by `uLampGain`, an additive `mat.patch` material | `modules/materials.js`, `modules/signs.js` |
| the look of a moving frame | `taa2`, `motionBlur`, `bloomPyramid`, a LUT made in code (`makeLut`), `chroma`, vignette, grain | `main.js` |
| low quality | `upscale: 0.75` (the temporal upscaler), no screen-space passes | `main.js` `TIER` |
| rain | `@miragekit/world/kits/rain` | `main.js` |
| steam, sparks, muzzle flash, impacts, motes, rain rings | `createVfx`: effects as data, one-shot bursts, a followed emitter, depth collision | `game/fx.js` |
| tracers, scorch marks | `vfx.beam`, `vfx.decal` | `game/weapon.js`, `game/enemies.js` |
| chunks, occlusion culling, automatic LOD | `applyBigWorld` behind `?big=chunk,occ,lod`; off by default because it does not pay here (numbers below) | `main.js` |
| the player: physics character, action map, pause, saves | `startGame` (`@miragekit/game`) | `main.js`, `game/index.js` |
| checkpoints | `game.zone` + `g.save('auto')`; a death loads it | `game/index.js` |
| the relay door | `physics.hinge` leaves hung in a module's `doors` anchor | `game/index.js` |
| hit-scan | Rapier ray with the surface normal (`physics.world.castRayAndGetNormal`) | `game/weapon.js` |
| sentinels: walking | `createNavGrid` on the player's walk grid, `createNavAgent`, `createNavCrowd` | `game/enemies.js` |
| sentinels: seeing | `createSenses` (sight cones the walk grid occludes) | `game/enemies.js` |
| kites (flying drones) | the walk grid as a volume: `airAt` to stay out of solids, `gridRay` for a line of fire | `game/drones.js` |
| sentinels: bodies | `createRigModel` + `createAnimator`: a speed blend, a masked aim layer, an additive flinch, a fall | `game/enemies.js` |
| the title screen | the camera on a closed Catmull-Rom spline through six of the plan's viewpoints (the orbit camera, so the scene clock is not reset), the game paused behind it; replaces the overlay's start card | `game/title.js` |
| HUD and menus | `@miragekit/game`'s overlay (objective, prompts, toasts, pause menu, save slots, rebinding, the touch layer) plus the example's own HUD and touch controls (the overlay's own stick and buttons hidden under them) | `game/hud.js`, `game/touch.js` |
| sound | the mixer's buses and 3D placement, the engine's own pickup / door / chime, the example's synthesised set; the audio engine's reverb zones from `plan.audio.zones` (the bar, the relay, the open street) | `game/sfx.js`, `game/index.js` |
| lightning | `vfx.beam` with `jitter` and `branches`, one clustered lamp 110 m up for the flash | `game/index.js` |
| two languages | English and Traditional Chinese for everything the game itself shows (`?lang=`) | `game/text.js` |
| the test | `mirage-playtest` scenarios: the route, and the holdout's first waves | `scenarios/playtest.json`, `scenarios/holdout.json` |

## Controls

| | keyboard / mouse | gamepad | touch |
|---|---|---|---|
| the title: choose, change, select | ↑ ↓ / Tab / W S, ← → / A D, Enter or Space (O: options) | d-pad or left stick, A (Start deploys, B closes the options) | tap a row or its arrows |
| move, look | WASD, mouse (click captures the pointer) | left stick, right stick | a floating stick: it appears where the left thumb lands in the lower left; drag anywhere on the right that is not a button to look (slower down the sight, slower again over a target) |
| fire | left button (or F) | right trigger | the big FIRE low right, or the smaller one on the left above the stick; a finger on either fires **and** turns the view as it drags |
| aim | right button (or Q), held | left trigger, held | AIM above FIRE: held, aims while held (and turns as it drags); a quick tap toggles |
| reload, strike, crouch, jump | R, V, C, Space | right bumper, right stick click, none, A | the small buttons in an arc round FIRE (circular arrow, down arrow, up arrow) and the blade above them |
| lean | Z / X, held | none | L and R beside the left FIRE: held, or a quick tap toggles |
| run | Shift | LB | push the stick past its rim; pushed far up it locks (a padlock above the stick lights; let go and the run holds; a touch on the stick ends it) |
| use | E | X | a hand and the label, centre right, only while something can be used (a door, the pass, the uplink) |
| options (sensitivity, field of view, inverted look, full screen, language; on touch also touch look sensitivity, button opacity and size, the left FIRE on / off, the sprint lock on / off) | O | none | the gear, top right |
| menu | Esc | Start | ☰, top right |

Touch is laid out the way mobile battle-royale shooters lay theirs out (the genre's conventions only; the glyphs are
drawn in `game/touch.js`). Every finger is tracked by its own pointer id, so moving, looking and firing go together.
On touch the HUD moves out from under the thumbs: the objective top left, the compass top centre with the uplink bar
and the radio under it, the gun and its rounds over the health bar at the bottom centre; the engine's quality and
frame-rate corner is hidden there. Ammunition and med packs are taken by walking over them (all inputs). A hit taken
and a magazine running dry buzz the phone where `navigator.vibrate` exists (Android Chrome; iOS Safari has none).
**What was tested, and how:** only in headless Chrome emulating a phone held sideways (844 x 390, 667 x 375 and
932 x 430, touch events with several fingers through the DevTools protocol, `scripts/controls-check.mjs`), not on a
real phone: thumb reach, the feel of the look speed and the aim assist, the vibration, safe-area insets on a notched
phone, and iOS Safari's own gestures (pinch, the swipe-up bar) are untested.

## Modes and difficulty

The game opens on a title: the camera flies a slow loop through the district (street west, the bar's front, the
plaza, the monument, the roof vista, street east) while the game waits paused, the HUD and the view model hidden.
Its menu picks, before DEPLOY:

- **Mode.** MISSION is the route from the alley to the relay roof. HOLDOUT starts on the relay roof with the uplink
  already running: endless waves, sentinels from the stair foot and the relay room, kites out of the air over the
  plaza. Wave *n* brings 2 + *n* sentinels (wardens from the third wave), 1 + (*n* - 1) / 2 kites, and 7 % more health a
  wave; nine seconds between waves, a radio line at each, the roof's ammunition and med pack back after each. The
  enemy and kite lists are fixed pools: a wave revives the dead (`enemies.revive`, `drones.revive`) rather than
  building new rigs, so a wave is at most 14 sentinels and 5 kites. The HUD shows the wave and how many are left; a
  death ends the run with an end card (waves survived, kills, accuracy, rating, the best wave at that difficulty,
  kept in the settings) and goes back to the title. No checkpoints in the holdout.
- **Difficulty.** STANDARD is the game as built; HARD and BRUTAL multiply the damage the player takes (1.4, 2), the
  enemies' health (1.3, 1.6) and their accuracy (1.15, 1.35; the cap on a shot's chance rises with it). `?assist=1`
  works on top of any of them.
- **Time.** Night, dusk or day, through `setHour` (the options' slider gives any other hour).

Mode, difficulty and the title's hour are kept with the player's settings (`game.settings.ndRun`), and shown on the
HUD's tally and the end card. For tests, `?mode=holdout` and `?difficulty=hard|brutal` set them for one visit;
`?start=1` skips the title and goes straight in with them.

`?assist=1` is an easy mode (an eighth of the damage, health comes back in full, the reserve never runs dry); the playtest uses it, because its
scripted player stands in the open and aims once per step.

## Measured

Apple M4 Pro, headless Chrome (ANGLE Metal), 1440 x 900 at pixel ratio 1, `node scripts/measure.mjs` (and `--ab`).
Every variant is its own page in one Chrome and the rounds go round-robin over the pages; in a round each view is
walked for 40 moving frames with a slow pan, each frame ended by a 1-pixel read-back. A cell is the median of the
round medians in ms per frame, the bracket their lowest and highest. Other GPU jobs ran on the machine while this
was measured: read the brackets. The table of quality levels below is from a quiet run of 6 rounds on the current build. The feature table further
down is older: it was taken before the lamp pool, the facades and the megastructure went in, on a run that other
jobs disturbed (its high ends are those jobs), and is kept for what it says about the screen-space passes.

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| game, low | 8.3 [8.3-8.5] | 9.1 [9.1-9.3] | 7.0 [6.7-7.0] | 7.7 [7.7-7.8] | 8.3 [8.3-8.5] | 535, 268 k |
| game, medium | 11.6 [11.5-11.8] | 13.9 [13.8-14.1] | 10.2 [9.7-10.3] | 11.6 [11.3-11.6] | 12.9 [12.8-13.1] | 1155, 777 k |
| game, high | 13.8 [13.6-14.1] | 15.7 [15.4-15.9] | 11.8 [11.4-12.0] | 12.8 [12.7-12.8] | 14.1 [13.9-14.2] | 1143, 772 k |
| world, low | 6.6 [6.5-6.8] | 7.4 [7.3-7.7] | 5.1 [5.0-5.7] | 5.8 [5.5-6.3] | 6.9 [6.4-7.0] | 324, 199 k |
| world, medium | 8.9 [8.8-9.1] | 10.4 [10.4-10.6] | 7.7 [7.4-8.0] | 8.4 [8.3-8.5] | 9.5 [9.2-9.7] | 431, 332 k |
| world, high | 10.4 [10.3-10.5] | 12.0 [11.9-12.4] | 9.0 [8.8-9.3] | 9.8 [9.6-10.0] | 10.9 [10.7-11.0] | 422, 327 k |

`game` is the whole thing (nine sentinels and three kites awake, their animation and navigation, the view model, effects, the HUD);
`world` is the district alone. Before the detail pass and the lamp pool the game ran at 6.2-7.0 / 8.5-10.0 /
9.8-11.1 ms; the dressing of the buildings, the megastructure, the 163 pool lamps and the armoured sentinels cost
about 2 to 4 ms. The difference between `game` and `world` is mostly the lamp shadow tiles: a sentinel that moves near a
shadowed lamp makes its cached tile draw again (one tile, six faces, a frame).

Each feature of `high` switched off in turn, the world alone (6 rounds):

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| world, high | 8.3 [7.7-14.2] | 9.8 [9.3-16.1] | 8.1 [7.6-14.6] | 8.6 [8.2-15.2] | 9.3 [8.8-15.7] | 296, 183 k |
| world, high, ssr=0 | 7.9 [7.5-13.7] | 8.7 [8.0-14.8] | 7.7 [7.3-14.2] | 8.1 [7.7-14.1] | 8.4 [8.2-14.3] | 294, 183 k |
| world, high, ssgi=0 | 7.8 [7.6-13.4] | 8.7 [8.4-14.8] | 7.7 [7.2-14.1] | 8.0 [7.8-14.1] | 8.5 [8.3-14.4] | 294, 183 k |
| world, high, contact=0 | 7.9 [7.6-13.5] | 8.8 [8.5-14.9] | 7.8 [7.2-13.9] | 7.9 [7.2-14.2] | 8.3 [7.9-14.6] | 294, 183 k |
| world, high, gi=0&probes=0 | 7.8 [7.3-7.8] | 8.7 [8.5-8.7] | 7.8 [7.3-7.9] | 7.9 [7.6-8.0] | 8.2 [8.0-8.3] | 296, 183 k |
| world, high, csm=0 | 7.8 [7.1-8.0] | 8.7 [8.3-9.2] | 7.7 [7.2-8.1] | 8.0 [7.4-8.0] | 8.3 [8.2-8.5] | 312, 190 k |
| world, high, shadows=0 | 8.2 [7.9-8.2] | 8.8 [8.5-8.9] | 7.7 [7.2-8.0] | 7.9 [7.2-8.2] | 8.3 [8.2-8.8] | 296, 183 k |
| world, high, vol=0 | 8.0 [7.8-8.3] | 8.7 [8.5-9.5] | 8.1 [7.3-8.5] | 8.1 [7.9-8.3] | 8.4 [8.1-8.6] | 295, 183 k |
| world, high, taa2=0 | 8.1 [7.9-8.3] | 9.0 [8.9-9.2] | 8.1 [8.0-8.3] | 8.1 [7.8-8.4] | 8.6 [8.4-8.7] | 296, 183 k |
| world, high, mb=0 | 7.7 [7.7-7.8] | 8.7 [8.4-8.8] | 7.7 [7.6-7.8] | 7.8 [7.7-8.0] | 8.3 [8.2-8.3] | 292, 183 k |
| world, high, rain=0 | 7.7 [7.7-7.8] | 8.7 [8.5-8.9] | 7.8 [7.3-7.9] | 7.8 [7.6-8.0] | 8.4 [8.2-14.5] | 295, 165 k |
| world, high, big=0 | 8.1 [8.0-8.4] | 9.1 [8.7-9.2] | 8.1 [7.5-14.4] | 8.3 [7.8-14.4] | 8.8 [8.0-14.9] | 270, 185 k |
| world, high, big=chunk,occ | 8.1 [7.8-13.9] | 9.3 [8.9-15.2] | 8.2 [8.0-14.7] | 8.3 [7.8-14.6] | 8.7 [8.3-14.9] | 296, 183 k |
| world, high, big=chunk,occ,lod | 8.3 [8.1-13.7] | 9.2 [8.9-15.2] | 8.1 [7.4-14.8] | 8.3 [8.2-14.6] | 8.6 [8.3-15.0] | 296, 175 k |
| world, high, lamps=100 | 8.3 [8.2-13.9] | 10.9 [10.7-17.2] | 8.4 [8.1-14.8] | 8.5 [8.4-15.0] | 8.8 [8.4-15.3] | 296, 183 k |

Read honestly: no single feature is resolved. Every row is within about a millisecond of the first, which is
inside the run-to-run spread, so the table says the features are cheap together on this GPU at this size, not what
each costs. `lamps=100` (100 more clustered lamps along the street) shows only in the street view. Chunks,
occlusion culling and automatic LOD (`big=`) make no measurable difference: the block is 68 x 64 m, its buildings
are a few boxes each and most of it is on screen or behind one wall, so they stay behind the flag.
Not measured: any other GPU, a phone, pixel ratio 2.

The single file (`npm run package -w neon-district`): **3.53 MB (3,702,149 bytes)**, against the site's 5 MB budget. All of it is
code (Rapier's WASM is 2.2 MB of it); there are no assets.

## Below a commercial shooter, and why

- **Geometry and materials.** Buildings are still boxes with a window grid in the shader; what dresses them
  (balconies, units, pipes, fire escapes, bridges) and every prop is built from boxes, cylinders, lathes and two
  extruded profiles. No sculpted or scanned models, no texture maps beyond canvas-drawn signs and wall art, no
  parallax interiors behind the windows, no per-surface wear maps. Up close the edges are hard and the surfaces flat.
- **Characters.** The sentinels are the engine's 880-vertex test rig under about ninety rigid armour parts (helmet,
  breastplate, pack, pauldrons, gauntlets, greaves, lights at the joints). Five extra clips were authored by hand as
  a few keys each; the head tracks the player. No motion capture, no blend between aiming directions, no ragdoll
  (the engine has one; it needs the physics kit, which `startGame` does not set up), no cover use, no flanking:
  the brain is five states.
- **Lighting.** Lamps do not light particles (steam is tinted by hand) and only 16 of 76 cast shadows. Reflections
  are screen space: what is off screen falls back to two box probes or the sky. The probe volume covers one room.
  The volumetric pass scatters 8 lamps. There is no ray tracing and no path-traced reference.
- **Weapon feel.** One gun, hit-scan, no projectiles, no penetration, no animation of the hands beyond the reload
  tilt; the view model is in the world's depth range and pulls back from walls instead of having its own.
- **Sound.** Everything is synthesised from noise and sines in a few lines each. No reverb zones or occlusion
  (the engine's audio engine has both; not wired here), no recorded material.
- **Movement.** Crouching lowers the eye and slows the walk but the body's collider keeps its height; there is no
  slide, no mantle, no sprint stamina. Leaning and crouching are keyboard only.
- **Scope.** One gun, six enemy jobs on two rigs and a drone, five minutes.

## What the example works around (engine gaps)

1. **The scene clock stops when the player stops.** `createPlay` runs the clock only on frames the player drives,
   and `startGame` does not pass `animate` on. The game calls `play.turn(0, 0, 0)` every tick to keep rain, effects
   and screens running.
2. **No weapon layer.** The view model is an ordinary object placed from the camera before every sub-frame
   (`world.ctx.onUpdate`); it comes back from walls (a short ray) instead of being drawn in its own depth range.
3. **The field of view of a game is fixed at 62°.** `startGame` does not pass `fov` to play; aiming sets the
   camera's lens in `world.ctx.onUpdate`, after play wrote its own.
4. **The action map has no fire / aim / reload and no mouse buttons.** The game listens for them itself, so the
   pause menu cannot rebind them.
5. **The mixer cannot be given a sound.** The game's sounds are written into `audio.buffers` after the first gesture.
6. **`physics.ray` has no normal.** The weapon calls Rapier's `castRayAndGetNormal` through `physics.world`.
7. **Particles take no local lamps** (documented in `docs/vfx.md`): steam is unlit and tinted by hand.
8. **`startGame`'s character has no crouch, lean or look sensitivity.** The game lowers and shifts the camera itself
   (`world.ctx.onUpdate`) and rescales what the mouse turned since the last tick. `createMover` has a real crouch,
   but `startGame` drives the Rapier character.
13. **The lamp pool bins again for every lamp shadow tile face.** With `lampPool.captures` on, each cube face of a
    redrawn shadow tile is a capture that re-bins all 160 lamps: +5 ms a frame while a sentinel walks past a shadowed
    lamp (18.9 against 13.0 ms). The example sets `captures: false`, so pool lamps do not light environment captures.
12. **`ui.message` has no callback.** The death screen listens for the dialog's `close`.
9. **A jump of the view rewinds the particles for good.** `play.place` (tools, viewpoints) sets the scene clock to
   0; the pools reset, and a looping emitter spawned at a later step waits for that step again. The reset pass
   also draws into the state textures it still has bound (Chrome: "Feedback loop formed between Framebuffer and
   active Texture", a warning, 7 per jump). The game spawns its loops again three ticks after a `place`.
10. **`mirage-playtest` waits 20 s for a still view before each screenshot.** A world with rain never rests, so the
    scenario takes screenshots on a few of its 152 steps only.
11. **Moving casters must be top-level scene objects** (`userData.mgDynamic`) for the lamp shadow tiles to follow
    them, so the sentinels are added to `world.scene`, not to the game's group.
14. **The overlay's start card cannot be replaced, only hidden.** Any key, the pad's A or Start, or a tap starts the
    game from it, and `startGame` has no option for a front end of the game's own. The title hides `.mg-start` with
    CSS, holds the keys in a window capture listener registered in `setup` (before the overlay's own), swaps
    `g.ui.update` (which starts the game on A) while it is up, and calls `g.ui.begin()` itself on DEPLOY.
15. **No camera path for menus.** The title flies the camera in play's orbit mode, writing the camera's position and
    `play.controls.target` each frame: `play.place` would rewind the scene clock and the particles on every frame.

---

Each module owns one section below; only its owner writes there. Build order: ground, blocks, facades,
megastructure, street, clutter, bar, relay, plaza, signs.

## ground

The carriageway and the alley (asphalt, y = 0), both pavements and the plaza (`plan.levels.kerb` = 0.14 m),
kerb stones 1 cm proud of the paving, a dark base 5 cm under everything out to 140 m, drain grates and manhole
covers (decor). Reads: `street`, `alley`, `plaza`, `levels`, `vents`. Owns: `street`, `alley`, `levels.kerb`.

| key | pos is | count |
|---|---|---|
| `steam` | the centre of a vent grate, 5 cm above it | 5 |

## blocks

Eleven buildings as solid boxes (`plan.blocks`), one facade material per style (`concrete`, `panel`, `glass`: the
window grid and the lit rooms are in the shader, none below 4.4 m), roofs (deck, parapet, plant rooms, a tank or
a mast; not in the walk grid) and eleven skyline towers beyond the block. Reads / owns: `blocks`, `skyline`,
`points.billboard`.

| key | pos is | extra | count |
|---|---|---|---|
| `signs` | the centre of the sign on the wall's face; `rotY` out of the wall | `w`, `h`, `text`, `color`, `kind` (`board` / `blade`), `vertical`, `second` | 24 |
| `beacons` | the top of a mast | | 13 |
| `holos` | the centre of the board on the tallest tower | `kind: 'board'`, `w`, `h` | 1 |

## facades

What was bolted onto the buildings afterwards, on every block face that looks onto walkable ground (`lib.js`
`openFaces`): balconies with rails, ledges, AC units, pipes on brackets, a sagging cable bundle with junction boxes,
fins on the glass towers, fire escapes on six faces, four scaffolded roof billboards, and on the ground storey
posters, tags and stencils drawn into canvases. Repeated parts are one instanced unit box per material. All decor.

| key | pos is | count |
|---|---|---|
| `signs` | the roof billboards | 4 |
| `ledWalls` | the centre of an LED advertising wall (`w`, `h`) | 2 |

## megastructure

The city overhead: three glazed skybridges (two over the street at 7.6 and 10.4 m, one over the alley at 8.2 m), a
road deck from the bar's roof at 14 m, a gallery along the plaza's west wall, setbacks, spires and light fins on the
skyline towers, sixteen stepped megatowers 120 to 210 m out, and behind the relay a viaduct at 13 m with a train
that crosses every 24 s of scene clock. Not in the walk grid.

## clutter

Rubbish heaps (bags, boxes, pallets, litter), cones, bins, newspaper boxes, a hydrant, two scooters, a noodle cart,
a signal gantry at the plaza's entrance, cables across the street, washing over the alley, a closed underpass
entrance. Soft and small things are decor; the cart, scooters, bins, gantry post and the underpass are solid.

| key | pos is | count |
|---|---|---|
| `signs` | the cart's board, the underpass's board | 2 |
| `steam` | the cart's pot | 1 |

## street

Ten lamp posts (a shadowed lamp each, a 0.3 m collider proxy), jersey barriers on the road and planters on the
plaza (`plan.cover`), three parked cars, shutters / doors / awnings along both pavements, wall plant, four vending
machines, bollards along the plaza's edge (proxies), the alley's dumpsters, crates, pipes, fence and bulb strings,
and a sheet wall with barriers at both ends of the street. Reads: `lamps`, `cover`, `cars`, `street`, `alley`.

| key | pos is | count |
|---|---|---|
| `signs` | the boards on the two end walls | 2 |
| `sparks` | a broken fitting (the game bursts sparks there) | 2 |
| `cars` | 1.6 m over each car's centre | 3 |

## bar

`plan.bar`: 12 x 11 m, ceiling 3.4 m, floor at `levels.floor` (0.16 m). A shop front with a 1.8 m door and two
windows (glass panes with 0.2 m collider proxies: not walked or shot through), a counter (1.05 m) with six stools,
a back counter, three shelves of bottles, a hood, three booths, a menu screen, six paper lanterns (three are
lamps), a canopy and two red lanterns outside. The room is the world's GI box and a reflection probe; with
`ctx.shared.gi` false it declares an ambient volume (factor 0.25) instead.

| key | pos is | count |
|---|---|---|
| `signs` | two neon signs on the inner walls (`bare`: no box behind) | 2 |
| `lanterns` | the three lanterns that are lamps (`light`) | 3 |

## relay

`plan.relay`: the room (15.8 x 9 m, ceiling 3.6 m), the stairwell (two flights of 17 risers of 0.176 m, treads
0.28 m, 2.5 m wide, a half landing at 3 m, a spine wall between the flights, a 1.1 m guard at the top landing) and
the roof at 6 m (parapet 1.1 m; plant from `plan.roofUnits`, a mast with a proxy, two dishes, the uplink console).
The stairwell's door to the room and its door to the roof are one above the other (`relay.stair.door`).
Ambient volumes: the room and the stairwell, factor 0.22.

| key | pos is | extra | count |
|---|---|---|---|
| `doors` | floor centre of the plaza doorway, in the wall's middle | `width` 1.9, `height` 2.5, `leaves` 2, `swing` 1.5 rad | 1 |
| `signs` | the board on the parapet over the door | | 1 |
| `beacons` | the top of the mast | | 1 |
| `consoles` | the uplink's screen | | 1 |
| `strobes` | the red lamp inside the door; the stairwell's landing lamp (`flicker`) | `light` | 2 |

## plaza

A plinth (r 2.3 m) with a hologram over it (a knot, two rings and a cone, turning on the scene clock; additive, not
in the walk grid), two kiosks, four benches, two advertising pylons, light strips in the paving.

| key | pos is | count |
|---|---|---|
| `holos` | the hologram's centre (`kind: 'figure'`) | 1 |
| `signs` | the kiosks' boards | 2 |

## signs

Consumes `signs` (required), `beacons`, `holos`. A board is a dark box with a glowing face 14.5 cm off the wall; a
blade sticks out of the wall with a face on both sides; each gets one clustered lamp of its colour (range 5 to 22 m
by its area; the three largest are also volumetric). Beacons blink on the scene clock.

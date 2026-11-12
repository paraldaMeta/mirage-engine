# Notes — neon-district

A small first-person shooter in one rain-wet block of a city at night: the alley, Kestrel Street, a noodle bar,
the plaza, the relay (a server room and a stairwell) and its roof. About five minutes from the spawn to the end.
It is the engine's showcase, so this file first says which engine feature each part shows and where the code is,
then holds the modules' own sections (the convention of `docs/world-protocol.md`).

**Licence: Business Source License 1.1, not MIT** ([LICENSE](LICENSE), the same as `@miragekit/assets`): free for
non-production use; in production free for an individual using it for themselves, for non-commercial use and for
organisations of up to three people; never to offer a competing engine, asset library or content tool; Apache-2.0
four years after each version's first public release. Commercial licence: an issue titled "Commercial license" at
https://github.com/paraldaMeta/mirage-engine or flytoheptameron@outlook.com. (Versions published earlier on `main`
under MIT stay MIT.) Its props, cars, robots, the robot kit and rig, its surfaces' recipes, gun sounds and the
destructibles' classes are the library's: `@miragekit/assets` (`kits/cyber`, `surfaces`, `sounds`, `destruct`); the
older sections below name them by the files they were in here (`props-kit.js`, `cars.js`, `machines.js`,
`robot-kit.js`, `game/robot-rig.js`), now `packages/assets/src/kits/cyber/` (`kit.js`, `cars.js`, `robots.js`,
`robot-kit.js`, `robot-rig.js`).

```
npm run dev -w neon-district            # http://localhost:5194
npm run build -w neon-district && npm run playtest -w neon-district     # the whole route, headless
npm run playtest:holdout -w neon-district                               # the holdout's first waves, headless
node examples/neon-district/scripts/measure.mjs --ab                   # frame time per quality and per feature
node examples/neon-district/scripts/controls-check.mjs                 # title, holdout, keys, gamepad and touch, with real events (ONLY=touch: one part)
node examples/neon-district/scripts/gameshots.mjs                      # frames of the running game, a contact sheet
node examples/neon-district/scripts/kitshots.mjs                       # the hacks, abilities and new jobs in frames (out/kit)
node examples/neon-district/scripts/weaponshots.mjs                    # every gun at the hip and aimed, night and dusk, a rocket, the touch HUD (out/weapons)
node examples/neon-district/scripts/sfx-check.mjs                      # the guns' sounds measured (envelope, tail per room, spectrum): no build needed
```

The playtest takes about ten minutes: it plays the route (179 steps: every wall, door and stair on it, the hacks, the abilities, the ammunition, the
fights, the pass, the relay door, the uplink and its wave; and the guns: the 0 unlock, a rocket into a shield
sentinel (a splash kill that breaks its shield), the shotgun on a sentinel up close (both stood in front of the player
by the test hook `?drill=1` at the spawn, before the route: J the street's shield sentinel 8 m ahead, K a sentinel
4 m ahead, so they do not depend on where the route's robots happen to be; the second stunned, neither drops a cell;
on the route U stations the street's kite 5 m ahead and over the eye, held still for 3 s, for the hack, then K a
stunned sentinel beside it for the kite to hunt, and L drops an ammo cell 2.5 m ahead for take-the-cell), before the uplink
completes the gatling sweeps the wave, then on
the roof every slot fired, the sidearm past its magazine and on, the gatling spun up until it overheats) and a view
with rain never comes to rest, which the tool waits for before each of its 24 screenshots.

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
- **Abilities** (`game/abilities.js`): **dash** (Alt; 5 m the way you move, 0.35 s in which every shot misses, 5 s),
  **EMP grenade** (H; an arc, stuns robots within 5 m for 4 s, 12 s), **overdrive** (B; charged by damage dealt, kills
  and hacks; 8 s of everything marked through walls, fire 1.7 x as fast, reloads in half the time, free hacks; every
  gun: the gatling spins up faster too). The keys were 1 2 3; those are the guns' slots now.
- **Enemy jobs** (`game/enemies.js`, `game/drones.js`), on the two rigs, each with its own accent and tell: the
  **shield sentinel** (amber; a curved shield that stops rounds from the front: flank it, EMP it, hack it, or shoot
  the lit emitter on its lower rim), the **marksman** (violet; holds the relay's roof over the plaza; a beam tightens
  on you for 1.2 s before a heavy shot: break the line or dash), the **mender kite** (green ring; mends damaged
  sentinels with a beam and keeps away from you), and the **warden** (a red lamp on its chest and a rising whine
  0.8 s before a nine-round suppressing burst), and the **hounds** (robot dogs: the scout flanks, closes in and lunges
  after a tell: it crouches, its lights flare, a charge sound, 0.6 s; the hauler carries a small turret that fires
  bursts; low, hard to hit over cover). Distinct hit, head-shot, shield-hit and kill sounds and crosshair
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
  voice (a synthesised blip). Comic hit words can pop on head shots, shield breaks, EMPs and overloads: off by
  default (the owner's playtest), the options panel turns them on. All of it in Traditional Chinese, English and
  Japanese (`game/text.js`, the `xt` branch; see Languages below).

Keys and buttons of the kit (the touch layer's buttons use the API in `game/kit.js`):

| | keyboard / mouse | gamepad | touch |
|---|---|---|---|
| hack (hold) | G | B | HACK, held (its pips, the ring filling; dimmed with the reason when nothing can be hacked) |
| dash · EMP grenade · overdrive | Alt · H · B (mouse back / forward: dash / grenade) | d-pad left · d-pad right · d-pad up | DASH · GRENADE (cooldown sweeps) · OVERDRIVE (a charge ring) |

## The arsenal

Five guns from one table (`game/arms.js`), each with its own view model (`game/viewmodels.js`: extruded profiles,
lathes, rounded boxes, library materials; the gloved hands modelled round the carbine, each finger one smooth tapered
tube, moved onto each gun's grip and support and opened or closed per gun),
rounds, crosshair, recoil pattern, muzzle flash, tracer or projectile, casings and sounds (`game/weapon.js`).

| slot | gun | kind | magazine / reserve (max) | rate | damage | reload | what it is for |
|---|---|---|---|---|---|---|---|
| 1 | P-9 sidearm | semi-auto, hit-scan | 12 / endless | 0.16 s (held: 0.3 s) | 21 | 1.25 s | never dry: you are never weaponless |
| 2 | K-7 carbine | automatic, hit-scan | 24 / 96 (168) | 0.095 s | 22 | 1.7 s | the all-rounder (the first gun, as before) |
| 3 | M-12 shotgun | pump, 9 pellets | 6 / 18 (36) | 0.82 s | 12 a pellet, 30 % past 22 m | 0.42 s + 0.5 s a shell | up close; a pellet within 8 m does 3.2 x to a shield |
| 4 | RL-4 rocket launcher (locked) | a projectile, 34 m/s, aimed from the tube at the crosshair's point, a 0.9 m proximity fuse | 1 / 4 (6) | 1 s | 220, splash 5.5 m with falloff | 2.6 s | breaks every shield in the blast; hurts you too (35 %) |
| 5 | G-6 gatling (locked) | spin-up 0.7 s, then 24 a second | 200 / 200 (400) | 0.042 s | 11 | 3 s | a heat gauge: full, it vents until 30 %; you walk at half pace while it spins |

- **The unlock.** `0` (pad: both sticks clicked together; touch: the options panel's code field, type 0) gives slots
  4 and 5 with a full load, a toast, a radio line and a sound; kept in the settings (`game.settings.nd.unlocked`), so
  they are there on the next visit. Again: a refill of both, at most once a minute (a toast says how long to wait).
- **Switching.** 1-5, the mouse wheel, pad Y (which cycles; the engine's Y for the bag is taken off it, the bag stays on
  I), the touch strip (tap a slot, swipe across it). Holster 0.2 s, the next one up in 0.33 s.
- **Ammunition** (`game/ammo.js`). A cell or a crate is units of ammunition (24 / 48), given to the gun in hand or, if
  it is full or the sidearm, to the emptiest; `per` in the table converts (a cell: 24 carbine rounds, 6 shells, 1
  rocket, 60 gatling rounds); a crate gives half as much again to the other guns. The low-ammo marker counts the gun in
  hand (with the sidearm in hand, the emptiest real gun). The last round in a magazine starts the reload by itself.
- **Overdrive** works for all of them (fire 1.7 x as fast, reloads and shell inserts in half the time, a faster
  spin-up); the EMP, the hacks and the stock work as before. The kill feed and the hit markers are per target, also
  for pellets and splash.
- **Feel.** A patterned climb per gun (a vertical climb that rises through a burst, a fixed side pattern, a little
  noise) that comes back after the burst (a good part of it springs back during one) unless the player pulled down
  against it (what the player turns down is paid off the debt); the gun kicks back and rolls; a short field-of-view punch (1-4 degrees); spread that blooms and
  shows in the crosshair (the crosshair's gap is the spread's angle at the current lens); a screen shake by gun and a
  much larger one for a blast, falling off over 34 m; a muzzle lamp of 20-60 (a clustered lamp of 10-14 m) for 0.04 s
  that lights the walls round the player; casings (brass, the shotgun's red hulls) that fall, bounce and tinkle where
  they land; a hit-stop of 55 ms on a kill (the robots freeze; options); a hurt that flinches the view away from the
  shot, a larger arrow toward it, a stronger red edge, the colour going out of the world below 30 health (a CSS
  saturate on the canvas) and a heartbeat below 25; a landing thump with a dip of the view; a walk bob on the camera
  tied to speed. All camera offsets are applied once a frame after play has written the camera, so they never move
  the aim. Options: camera shake 0-1.5, vibration 0-1, hit-stop on / off; with `prefers-reduced-motion` the shake
  starts at 0.3 and the hit-stop off.
- **Haptics** (`game/feel.js`). The pad's `vibrationActuator.playEffect('dual-rumble', ...)` on every shot (by gun,
  70 ms apart at most for automatic fire), a hit taken, a blast (by distance), an empty magazine, a reload done, a
  landing, a kill, the heartbeat. A phone's `navigator.vibrate` per gun on fire (110 ms apart at most for automatic
  fire), a hit, a blast, a reload done, an empty magazine. The vibration option shortens the phone's pulses and scales
  the rumble's magnitudes.

**The sound** (`game/gunsound.js`, rendered offline in JS into buffers and handed to the mixer with `audio.add`,
in the browser's idle time after the first gesture, not inside a frame, the carbine first). A shot is five layers: a 2-3 ms broadband snap
through a high band, a band-passed crack with a fast decay, a thump falling from about 150 to 50 Hz, the mechanism's
short metallic resonances (slide, bolt), and a low-passed body; then the room the player stands in, from the audio
engine's zones: the alley a tight slapback (echoes 31 ms apart off its two walls), the street and the plaza a long
diffuse tail with late reflections off far facades (rt60 1.8 s), the bar and the relay a short boxy room (rt60 0.3 s, a
lift at 260 Hz). Light tanh saturation, then a look-ahead peak limiter at -0.6 dBFS. Three or four variants a sound
(+-3 % pitch, +-1 dB, up to 1.5 ms between layers). The pistol is snappy (bright, short), the carbine cracks (a second
lower crack, the bolt's ring), the shotgun booms (a slow, deep thump and body; the pump's two clacks 0.3 s later), the
gatling is a 1.6 s loop of 25 overlapping rounds a second with its room folded in, a motor whine whose rate follows the
spin and a spin-down, the rocket a whoosh (noise faded across four bands) and a blast with a sub that falls from 58 to
27 Hz, a roaring body and 46 pieces of debris over 1.6 s. Also: dry-fire clicks, magazine out / in, bolt, slide, pump,
a shell going in, the rocket loading, brass and hull casings (2-3 variants), impacts by surface (concrete, metal and
glass from the collider's material; robot armour), the whizz of a sentinel's round passing within 1.5 m, the sentinels'
rifles near and far (beyond 16 m a duller, quieter version with more of the street in it), a heartbeat, a landing.
`scripts/sfx-check.mjs` renders every one in headless Chrome, plays it through an OfflineAudioContext and measures
it: peak 0.80-0.99 and no sample at full scale, attack under 5 ms, the tail ordered indoor < alley < open for every gun
(the alley 0.4-1.1 s, the street over 1.1 s), the spectral centroid of the first 43 ms in each gun's band (the
shotgun and the blast darker than the carbine), the share under 200 Hz, the variants differing. The bands were set
around what the synthesis was designed to do: the check guards the character, it does not prove it sounds right.

What is rough here: nobody has listened to it. The sounds were designed by numbers and checked by analysis; how
they sound to a human ear, on speakers or a phone, is untested. The rumble and the phone buzz are called and counted
but never felt (no pad or phone here). The view models are good from the player's seat and crude from anywhere else
(they are only ever seen from the eye); the hands are the carbine's hands moved onto each grip, so the pistol's
support hand and the gatling's front hand are approximations. The rocket has no sound in flight (the mixer's 3D
loops cannot move); a blast's splash is blocked by a wall only on a straight line from its centre. The hit-stop
freezes the robots and their animation, not the engine's clock (the robots' step runs at 8 % for 55 ms). The touch
buttons follow the layout rule but were only tried in an emulated phone. The rocket's self-damage is a fifth of
that in the easy mode.

What is rough: the bar's paper lanterns and bottle neon and every LED wall are shared emissive materials, so a dark
zone leaves them glowing (a street lamp's panel gets a dark cover instead); the bar's baked irradiance probes keep a
little of the lamps' bounce in the dark. The marksman's beam is a stretched box, not a volumetric beam. Robots do
not hear the steam or the alarm of a car beyond the radius; a lured sentinel looks round the car, then goes home.
Banter is timed with the page clock, not the game's (a pause does not hold a pair mid-line). The holdout's wave
composition is checked only for its first waves by the scripted test. Tests: `?drill=1` (see the playtest above); `?reserve=N` starts with N rounds in
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
| three languages | Traditional Chinese, English and Japanese for everything the game shows, the engine's pause menu included (`createUI`'s `setStrings`) | `game/text.js` |
| the test | `mirage-playtest` scenarios: the route, and the holdout's first waves | `scenarios/playtest.json`, `scenarios/holdout.json` |

## Controls

| | keyboard / mouse | gamepad | touch |
|---|---|---|---|
| the title: choose, change, select | ↑ ↓ / Tab / W S, ← → / A D, Enter or Space (O: options) | d-pad or left stick, A (Start deploys, B closes the options) | tap a row or its arrows |
| move, look | WASD, mouse (click captures the pointer) | left stick, right stick | a floating stick: it appears where the left thumb lands in the lower left; drag anywhere on the right that is not a button to look (slower down the sight, slower again over a target) |
| fire | left button (or F) | right trigger | the big FIRE low right, or the smaller one on the left above the stick; a finger on either fires **and** turns the view as it drags |
| guns | 1 sidearm · 2 carbine · 3 shotgun · 4 rocket launcher · 5 gatling, the mouse wheel | Y cycles | the strip at the bottom centre: tap a slot, swipe across it |
| unlock slots 4 and 5 (again: a refill, once a minute) | 0 | both sticks clicked together | the options panel's code field: type 0 |
| hack, dash, EMP grenade, overdrive | G (hold), Alt, H, B | B (hold), d-pad left, right, up | HACK (hold), DASH, GRENADE, OVERDRIVE: a column left of RELOAD / CROUCH |
| aim | right button (or Q), held | left trigger, held | AIM above FIRE: held, aims while held (and turns as it drags); a quick tap toggles |
| reload, strike, crouch, jump | R, V, C, Space | right bumper, right stick click, none, A | the small buttons in an arc round FIRE (circular arrow, down arrow, up arrow) and the blade above them |
| lean | Z / X, held | none | L and R beside the left FIRE: held, or a quick tap toggles |
| run | Shift | LB | push the stick past its rim; pushed far up it locks (a padlock above the stick lights; let go and the run holds; a touch on the stick ends it) |
| use | E | X | a hand and the label, centre right, only while something can be used (a door, the pass, the uplink) |
| options (sensitivity, field of view, inverted look, full screen, language, camera shake, vibration, hit-stop, the code field; on touch also touch look sensitivity, button opacity and size, the left FIRE on / off, the sprint lock on / off) | O | none | the gear, top right |
| menu | Esc | Start | ☰, top right |

Touch is laid out the way mobile battle-royale shooters lay theirs out (the genre's conventions only; the glyphs are
drawn in `game/touch.js`). Every finger is tracked by its own pointer id, so moving, looking and firing go together.
On touch the HUD moves out from under the thumbs: the objective top left, the compass top centre with the uplink bar
and the radio under it, the gun and its rounds over the health bar at the bottom centre; the engine's quality and
frame-rate corner is hidden there; the gun strip sits under the health bar and the rounds over it. World markers (the
objective's, the ammo waypoint, robots marked through walls) keep off the buttons: one that would sit on a control
moves above it, and fades if it still would. Ammunition and med packs are taken by walking over them (all inputs).
Shots, hits, blasts, reloads and a magazine running dry buzz the phone where `navigator.vibrate` exists (Android
Chrome; iOS Safari has none).
**What was tested, and how:** only in headless Chrome emulating a phone held sideways (844 x 390, 667 x 375 and
932 x 430, touch events with several fingers through the DevTools protocol, `scripts/controls-check.mjs`), not on a
real phone: thumb reach, the feel of the look speed and the aim assist, the vibration, safe-area insets on a notched
phone, and iOS Safari's own gestures (pinch, the swipe-up bar) are untested.

## Comfort

The owner felt a little dizzy after 15 minutes. The game's motion was audited, put into numbers and calmed by
default; the old feel is one setting away.

**One setting, three presets** (`game/feel.js` `COMFORT`; `window.__mirage.game.comfort` for the options panel):

| value | what it scales | comfort (default) | standard | intense (= before) |
|---|---|---:|---:|---:|
| `shake` | screen shake (shots, hits, blasts, landings), the flinch when hit | 0.45 | 0.75 | 1 |
| `bob` | the walk's head bob (vertical only) and the landing dip | 0.35 | 0.7 | 1 |
| `punch` | the field-of-view punch a shot gives | 0.25 | 0.6 | 1 |
| `roll` | camera roll from recoil, the walk and the shake (the lean's tilt stays: the player asks for it) | 0 | 0.5 | 1 |
| `kick` | the camera's share of the recoil climb (what it gives up goes to the gun model's kick) | 0.6 | 0.85 | 1 |
| `settle` | how fast shake, flinch and dip die away | 2x | 1.4x | 1x |
| `hitStop` | the 55 ms freeze of the robots on a kill | off | on | on |
| `blur` | factor on the quality level's motion blur (high: 0.12 shutter) | 0 | 0.5 | 1 |
| `flashes` | lightning, sparks, flickering signs, the dash / overdrive tint: below 1 smooth and dimmer | 0.6 | 0.8 | 1 (raw) |

Changing one value after a preset makes it `custom`. `prefers-reduced-motion` gives the comfort preset with the
flashes at 0.3. `?comfort=standard|intense` sets one for a visit. Settings kept before this pass (no `v: 2`) keep
the look and touch choices (sensitivity, inverted look, touch sizes) and get the new feel and field of view.
**Field of view:** 75 degrees vertical on a desktop (107.5 horizontal at 16:9; it was 62, 94 horizontal), 62 on a
touch screen (a phone held sideways, about 2.1:1, already sees 105 horizontal); the slider keeps 50-90. The aim
down the sight narrows in the same ratio as before. The wider view costs frame time: the playtest's frame-cost view
draws 1761 calls and 1412 k triangles at 75 against 1556 and 1305 k at 62 (25.0 against 21.1 ms on the same
loaded machine; that step failed its 16.7 ms gate at 62 too).
**The dash** never had a field-of-view warp, speed lines or blur: 0.2 s of movement and a tint, now faint.
**The flashes:** raw, the lightning's lamp took a random level every tick (a 60 Hz flicker for 0.38 s), a sign that
flickers dropped to a quarter on a random 4 % of ticks, the spark lamp flickered per tick. Below 1: the lightning is
two smooth pulses (about 5 Hz) at the flashes' strength, a flickering sign dims by half for 0.6 s every 4.8 s, the
spark lamp fades. The uplink's strobe (1.4 Hz) and the muzzle lamp (the player's own shots) are unchanged.

**Measured** (`node scripts/motion-check.mjs`, `BEFORE=<old dist>` adds the first column): a scripted 20 s run with
no look input (walk 3 s, sprint 2.5 s, strafe, each of four guns fired 0.9-2.2 s, three hits, a dash, a rocket into
the street 5 m ahead); every rendered frame's final camera; headless Chrome, medium quality, 1280 x 720.

| measure | before | comfort | standard | intense |
|---|---:|---:|---:|---:|
| camera angular velocity, peak / RMS (deg/s) | 235 / 16.5 | 120 / 8.1 | 178 / 10.7 | 266 / 16.5 |
| the offsets' (shake, flinch, roll) angular velocity, peak / RMS (deg/s) | 140 / 7.0 | 70 / 3.7 | 110 / 4.7 | 145 / 7.3 |
| shake + flinch offset, peak / RMS (deg) | 2.53 / 0.23 | 1.31 / 0.07 | 1.71 / 0.12 | 2.40 / 0.22 |
| roll outside the lean, peak (deg) | 2.09 | 0.00 | 0.82 | 2.21 |
| field-of-view punch, peak (deg; the rocket and shotgun reach 4 / 3.2 x 1.6 before) | 2.00 | 0.50 | 1.20 | 2.00 |
| recoil climb in a burst, peak (deg) | 1.24 | 0.76 | 1.02 | 1.30 |
| offsets over 0.1 deg after their cause ended (ms) | 340 | 117 | 204 | 298 |
| head bob, walking, peak-to-peak (cm) at Hz | 3.5* at 2.6 | 0.74 at 2.5 | 1.49 at 2.4 | 2.12 at 2.3 |
| head bob, sprinting, peak-to-peak (cm) at Hz | 3.6* at 4.7 | 1.13 at 3.9 | 2.30 at 3.9 | 3.27 at 4.1 |
| camera vs mouse, largest error on a frame, sens 2.5, at 50 / 60 / 120 Hz (deg) | 2.84 / 0.95 / 3.78 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

(*the old build reports no bob of its own: its column is the eye's height over the feet less its 0.6 s mean, which
also holds the kerbs and steps.) Gates on the default: offsets <= 1.5 deg, no roll, punch <= 1 deg, bob <= 2 cm,
nothing still moving the view 150 ms after its cause, the camera within 0.3 deg of the mouse on every frame.

**Frame pacing and latency:** the mouse turns the view in its own event and the camera is set from it on the next
rendered frame (no fixed-step lag); the position is interpolated between the 60 Hz steps (the simulation's
`viewPosition`), so 50 and 120 Hz displays do not judder; the game draws at most 60 frames a second (play's frame
gate). Before this pass the sensitivity was applied in the game's fixed tick, so at sens != 1 a frame without a tick
showed the turn unscaled and the next caught up (up to 3.8 deg off at 120 Hz, the table's last row). The frame cost
(16-27 ms a frame on a fast laptop) is the performance pass's, not this one's: below 60 fps the turn still lands on
the frame, but each frame is a bigger step.

**The first click** (found when the check failed with "997 deg" after the full-screen pass): DEPLOY, and the first
click of a `?start=1` page, asked for full screen before the pointer lock. Full screen takes the click's user
activation, so the lock was refused and the mouse did not look until a second click; the check's one click never
locked, the camera never turned, and its frame-to-frame unwrap of the heading booked whole turns as error. The lock
is now asked for first (`game/index.js`), and the check unwraps the heading against what the mouse sent (a frame that
comes late no longer reads as a turn).

**Not measured, and cannot be:** whether anyone feels better. Nobody can feel motion sickness in a headless browser;
the presets follow the usual advice (a wide enough field of view, no camera roll the player did not cause, little
bob, short and small shake, no flicker), and the numbers above say only that the motion is smaller and shorter.
The HUD's low-health pulse (a red edge at about 1.1 Hz below 35 health) and the comic pop words (their own `pops`
option) are the HUD's and were left as they are.

## The stuck view ("if I carelessly look up, the view gets stuck looking up")

Reproduced in `scripts/look-check.mjs` (real input over the DevTools protocol: pointer-lock mouse, multi-touch on a
phone and a tablet, an injected gamepad), 189 cases, before the fix 67 failed:
- **inverted look (any sensitivity, mouse, touch and pad):** the game rescaled what had turned since its last tick
  (`endPitch + (pitch - endPitch) x sens x -1`) after play had already clamped the pitch to 1.45: at the top, a
  look down was clamped away by play, and the game mirrored what was left back up. The view stayed at exactly
  1.450 until a shot's recoil recovery happened to pull it below the clamp. A checkpoint load was "mirrored" too.
- **a sensitivity other than 1:** a checkpoint load's pitch was rescaled as if it were a turn (saved -0.5 came back
  as +0.66 at 0.3, -1.45 at 2.5).
- **a "gamepad" that is not one:** Chrome and Safari list wheels, joysticks and HID devices as gamepads; their axes
  2 / 3 (triggers, pedals) rest at -1 or +1, which the game read as the right stick held up: the view climbed to the
  top in half a second and held there against the mouse. A pad with a stick reporting full deflection from the start,
  or drifting 0.3 past the dead zone, crept the same way.
- **a pointer-lock jump** (one movementY of hundreds of px on capture, as browsers report on focus return) threw the
  view to the top in one frame.
- **recoil at the top:** the climb that the clamp swallowed was still booked as debt and "paid back", pulling the
  view below where the player had put it.
Fixed at the cause: the sensitivity and inverted axis live in play (`play.look`) and act on each turn as it
arrives; the pad's right stick is read on standard-mapping pads only, a stick counts once seen at rest, a drift on a
pad lying on the desk gets its own dead zone; pointer-lock jumps are dropped; `play.pitch` / `yaw` refuse NaN; the
kept settings are cleaned (NaN, strings, out of range); the recoil books only the climb that happened. Without the
inverted look and without a pad nothing reproduced on the mouse or on touch; which of these the owner met is not
known. (The look-check's later "down -0.297, want -0.3" at sensitivity 2.5 was the same first click as in "Comfort":
at 2.5 a look to the top is one stroke, the stroke came before the pointer was locked and was lost, so "up" never
reached the top; the threshold was not the problem.) `?debug=look` shows the pitch (game and camera), the last turn's device and size, dropped jumps, the pad as
the browser reports it and as the game reads it, the fingers down and the camera offsets: a screenshot of it when
the view sticks says which.

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

**The last wave can always be finished.** The uplink completes only when every robot of its wave is down, and a
holdout wave ends the same way. A wave sentinel that lost the player used to search, give up and walk home to its post
on the relay's ground floor, where nobody on the roof saw it again (the playtest's `uplink-complete` failed with 17
kills and no `done`). Now a robot of the last wave or of a holdout wave never goes home: it goes where the player is;
one unseen for 14 s is a straggler, marked through walls like the overdrive's marks, and runs to the player; one that
makes no progress for 12 s while unseen, or is still unseen after 50 s, withdraws (out of play, counted down, no kill:
`flags.withdrawn`). Kites of those waves likewise (marked after 14 s unseen, withdrawn after 40 s:
`flags.kitesWithdrawn`). `node scripts/uplink-check.mjs` fast-forwards it: a wave sentinel far off on the street comes
and fights the player, marked on the way; one pinned in a corner and a kite pinned under the roof withdraw and the
uplink completes 40.5 s after it started (the build before fails both).

Mode, difficulty and the title's hour are kept with the player's settings (`game.settings.ndRun`), and shown on the
HUD's tally and the end card. For tests, `?mode=holdout` and `?difficulty=hard|brutal` set them for one visit;
`?start=1` skips the title and goes straight in with them.

`?assist=1` is an easy mode (an eighth of the damage, health comes back in full, the reserve never runs dry); the playtest uses it, because its
scripted player stands in the open and aims once per step.

Full screen: DEPLOY asks for it (browsers allow it only from a click, key or tap), and a phone tries to lock
landscape; the options' toggle is on by default and its "off" is kept (then DEPLOY no longer asks); `?fullscreen=0`
for one visit (the headless checks). With `?start=1` the first click or tap asks. Left with Esc in play: the game
pauses as before and the pause menu offers "Return to full screen". iPhone Safari has no element full screen: a
one-line hint says to add the page to the Home Screen.

## Languages

Traditional Chinese (Taiwan usage), English and Japanese, for every line the game shows: title, HUD, objectives,
radio, the robots' banter and barks, the story, hit words, options, weapons, toasts, touch labels, end cards, and
the engine's own overlay (pause menu, its panels, the bag, the message button: `@miragekit/game`'s `UI_STRINGS`
keys, passed with `g.ui.setStrings`) and `@miragekit/play`'s quality / fps corner (relabelled from here). The
in-world signs are the plan's and stay as they are.

- **Picking:** `?lang=en|zh|ja` for one visit; else the player's saved choice (`settings.ndLang`); else the
  browser's first language: `ja-*` Japanese, any `zh-*` Traditional Chinese (`zh-CN` too: there is no Simplified
  table), anything else English.
- **Switching:** the title's LANGUAGE row and the options' language button cycle English, 繁體中文, 日本語. The switch
  is live (no reload): `text.js` swaps the strings inside the one `T` object, so modules that kept a branch of it
  (`T.xt` in the hack, the ammo, the story) read the new language; what was drawn once (the title, the HUD's
  labels, the compass, the options panel, touch labels, the engine menu, the objective, the bag) is drawn again.
  Lines already queued on the radio stay in the language they were said in.
- **Tables:** `game/text.js` holds three full tables of one shape. English is the source of keys; at load the
  others are compared with it (a missing, extra or different-kind key throws in the dev server, falls back to
  English in a build). `node scripts/i18n-check.mjs` also fails on empty strings, Simplified-only characters in
  `zh`, `ja` with no kana or kanji where English has words, `zh` with no Han, and engine keys the tables lack; it
  prints strings more than 60 % wider than the English (CJK counted double) as places to look at.
- **Glyphs:** `<html lang>` is `zh-Hant-TW`, `en` or `ja`, so the browser picks the right Han forms; the CSS stacks
  take `--nd-cjk` (PingFang TC / Noto Sans TC for Chinese, Hiragino Sans / Noto Sans JP / Yu Gothic / Meiryo for
  Japanese). Sentences wrap with `text-wrap: pretty`, Japanese by phrase (`word-break: auto-phrase`, Chrome).
- **Japanese:** written for the game rather than translated word for word (katakana UI nouns, terse HUD labels, a
  gruff handler, the robots deadpan and a little too polite). No native speaker has read it yet.
- **Checks:** `scripts/controls-check.mjs` (`lang`): browser languages, `?lang=`, the cycle and its keeping, the
  engine menu, and no English words left on the title, options, HUD, pause menu and panels, bag and end card in
  `ja` and `zh`. `scripts/i18nshots.mjs` writes every screen in the three languages to `out/i18n/`.
- **One thing in the middle at a time:** the cold open's card comes first, the radio waits for it, and a prompt
  (the hack's teaching line) waits for the radio. On touch screens these sit in the strip above the buttons (the
  card one line at a time), and nothing the HUD shows enters the stick's zone or a button (`tablet` in the
  controls check, phones and tablets in both orientations).

## Measured

Apple M4 Pro, headless Chrome (ANGLE Metal), 1440 x 900 at pixel ratio 1, `node scripts/measure.mjs` (and `--ab`).
Every variant is its own page in one Chrome and the rounds go round-robin over the pages; in a round each view is
walked for 40 moving frames with a slow pan, each frame ended by a 1-pixel read-back. A cell is the median of the
round medians in ms per frame, the bracket their lowest and highest. Other GPU jobs ran on the machine while this
was measured: read the brackets. The table of quality levels below is from a quiet run of 6 rounds on the build before the city art, the close-up
props, the cars, the street robots, the kit and the five guns; what they cost and what was won back is under
"Frame budget". The feature table further
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

## Frame budget

After the city art, the close-up props, the cars, the street robots, the kit and the five guns the game ran at 12.6-13.4
(low), 22-23 (medium) and 25-27 ms (high) a frame at 1440 x 900; the targets are 10 / 16 / 20. What a frame drew, at
the street view, medium (`renderer.info` per pass, four frames averaged):

| pass | draws | triangles |
|---|---|---|
| the scene | 678 | 516 k |
| the screen-space G-buffer (SSR) | ~290 | ~340 k |
| the wet street's mirror (every 2nd frame; per frame) | ~250 | ~245 k |
| one lamp's shadow tile, six faces (redrawn every frame) | 277 | 302 k |
| the sun's shadow map | 123 | 65 k |
| the velocity buffer (moving objects) | 147 | 56 k |
| post | ~40 | 0 |
| **all** | **1691** | **1525 k** |

Where the multiplication was: every sentinel's three skinned meshes had `frustumCulled = false`, so each was drawn in
all six faces of the lamp tile being redrawn (12 draws and 21 k triangles per sentinel per frame), in the mirror, in
the sun's map and in the velocity buffer wherever it stood; each kite was 15 meshes, all casting, and its hover
dirtied the nearest shadowed street lamp every frame; the view model and the close-up props (cans, bottles, the
bar's goods, the stall's goods) were drawn into the mirror; the gun sounds were synthesised inside the step (2.8 ms a
frame for the first seconds). The game adds draws over the world for those reasons, not for its effects or HUD.

What changed (nothing removed, no prop, no gameplay; `perf.js`, `main.js`):

- **Sentinels** (`game/enemies.js`): one fixed bounding sphere in the rig's space that holds every pose (arms out,
  the aim, lying after the fall); the skinned meshes are culled by it in every pass. Core's velocity pass now culls a
  skinned stand-in by the same sphere (CHANGELOG).
- **Kites** (`game/drones.js`): the parts that do not move are one mesh per material (15 meshes -> 6); they cast no
  shadow (a 0.4 m body 5-11 m up), and core's lamp tiles no longer redraw for a moving object that casts nothing.
- **The mirror** draws one layer (`lighting.planar.layers`, `perf.js mirrorLayer`): everything but the view model
  and the close-up props (`vending-*` goods and spirals, `bar-props`, `relay-props`, `stall-goods`, `grime-props`,
  `clutter-props`, `shop-props`). `?mirrorall=1` puts them back.
- **Wall bills and tags** (`modules/facades.js`): drawn as before into their own canvases, then copied into one
  atlas: 2 draws instead of one per bill (47 fewer at the street).
- **Vending goods** (`modules/vending.js`): an instanced set per row of machines instead of one for the district,
  each culled with its row and drawn within 30 m (a can is then under 3 px; the lit window stays).
- **The med kit's cross** is one mesh; **the gun sounds** are made in the browser's idle time (`game/sfx.js`).
- **Tiers** (below): the mirror is redrawn every 3rd moving frame at medium and high (it keeps the matrix it was drawn
  with, so it stays registered while the camera moves); medium has no screen-space reflections (the mirror covers the
  street, the plaza and the pavements; cars and the bar keep their reflection probes); low's moon casts no shadow at
  night.

The tiers now:

| | low (phones) | medium | high |
|---|---|---|---|
| render scale | 0.75 | 1 | 1 |
| temporal AA (taa2) | - | yes | yes |
| lamp shadow tiles, volumetric lamps, probe GI, bounce | - | yes | yes |
| planar mirror | - | every 3rd frame, half size | every 3rd frame, half size |
| screen-space reflections | - | - | yes |
| SSGI, contact shadows, sun cascades, motion blur | - | - | yes |
| sun / moon shadow map | by day and dusk (the moon casts none at night) | yes | yes (4096) |
| dressing (`detail`) | 0.4 | 0.8 | 1 |
| lens dirt, streaks, sharpening, chroma | - | yes | yes |

Draws and triangles a frame at the street view, medium, averaged over four frames: 1691 / 1525 k before, about 800 /
620 k after (a frame that draws the mirror: 1257 / 896 k, the measure table's last column). Times: see the table
below (`scripts/measure.mjs --vs <old dist>` measures both builds in the same rounds, so a busy machine weighs on both).

Measured on a machine other agents were loading (their playtests and stills ran throughout: the same build ran
22-23 ms at medium alone, 29-30 ms here), 6 interleaved rounds, both builds in the same rounds: `vs` rows are the
build before this pass. Read the ratios and the low ends of the brackets (the least disturbed rounds), not the
medians as absolute numbers.

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| vs game, low | 16.6 [12.3-22.3] | 15.0 [13.3-16.5] | 10.6 [8.6-11.8] | 13.3 [9.8-14.6] | 15.1 [12.3-17.1] | 677, 497 k |
| game, low | 14.8 [11.2-16.5] | 15.7 [11.8-17.0] | 9.6 [7.3-12.0] | 10.3 [8.2-11.7] | 15.8 [11.1-16.4] | 444, 396 k |
| vs game, medium | 27.7 [21.5-30.7] | 29.6 [23.1-29.9] | 20.6 [15.8-21.3] | 24.4 [18.1-26.4] | 27.1 [21.1-28.5] | 1898, 1693 k |
| game, medium | 21.1 [15.2-23.4] | 23.2 [16.6-24.6] | 16.8 [12.8-18.6] | 19.9 [14.2-20.5] | 22.6 [16.0-23.4] | 1257, 896 k |
| vs game, high | 33.5 [24.9-33.8] | 34.0 [27.2-37.1] | 25.5 [18.2-27.0] | 28.6 [20.7-29.7] | 33.0 [24.3-33.6] | 1886, 1705 k |
| game, high | 26.1 [18.6-26.7] | 27.6 [19.7-28.1] | 20.1 [15.3-20.6] | 23.9 [16.4-24.6] | 27.3 [18.9-28.2] | 1483, 1232 k |

| vs world, low | 15.2 [14.8-16.1] | 16.4 [15.1-17.1] | 11.3 [10.4-12.1] | 12.1 [11.6-13.5] | 15.4 [15.3-15.6] | 420, 393 k |
| world, low | 14.3 [14.0-15.0] | 15.8 [15.1-16.1] | 9.7 [9.4-10.9] | 11.1 [9.1-11.8] | 12.5 [11.6-13.6] | 317, 337 k |
| vs world, medium | 23.8 [21.9-25.5] | 27.1 [23.9-29.2] | 17.1 [16.7-17.8] | 20.9 [18.1-22.8] | 25.4 [21.9-27.0] | 949, 1123 k |
| world, medium | 18.8 [17.7-19.7] | 20.4 [19.1-20.9] | 15.1 [13.3-16.4] | 16.6 [15.9-17.1] | 19.1 [18.0-21.3] | 751, 641 k |
| vs world, high | 29.1 [27.3-31.5] | 32.1 [29.6-34.9] | 19.8 [17.4-22.2] | 24.9 [22.7-26.0] | 29.3 [27.1-31.8] | 940, 1135 k |
| world, high | 24.6 [22.6-26.8] | 27.1 [24.3-27.8] | 17.9 [16.6-19.0] | 21.6 [19.7-22.9] | 25.5 [23.9-27.6] | 905, 928 k |

After / before, medians: game medium 0.76-0.82, game high 0.78-0.81, game low 0.89-1.05 (low is bound by the lamp
pool's shading per pixel, which this pass did not cut: `?pool=0` is a quarter of low's frame, `?percell=16` a tenth
of it and visibly darkens the street, so both stay). Scaled to the quiet run of the old build (medium 22-23, high
25-27, low 12.4-13.3 ms) that is about 17.5-18.5 at medium, 20-21.5 at high and 11.5-13 at low; the brackets' low
ends (rounds the other jobs disturbed least) are 15.2-16.6 at medium, 18.6-19.7 at high and 11.1-11.8 at low in the
alley, the street and on the roof. So high is about at its 20 ms, medium near its 16, low over its 10.

### After the realism pass (robots, civilians, cars)

The realism pass put the game back over budget (quiet machine, `measure.mjs --rounds 5`: low 9.7-12.4, medium
14.2-17.7, high 16.5-21.7 ms against 10 / 16 / 20; the world alone 5.9-10.3 / 10.2-14.3 / 13.5-19.4). What a frame drew
at street west, before and after this pass (`node scripts/passes.mjs <unminified build> --variants game:medium,...`:
`renderer.info` per top-level render() and per shadow-map update, grouped by the code that asked, averaged over 12
moving frames; `--objects N` lists them by object):

| pass (draws / triangles a frame) | game, medium before | game, medium after | world, medium | game, high before | game, high after |
|---|---|---|---|---|---|
| the scene | 490 / 506 k | 431 / 502 k | 332 / 446 k | 490 / 520 k | 431 / 514 k |
| SSR G-buffer (high, every frame) + the mirror (every 3rd frame), per frame | 175 / 123 k | 151 / 120 k | 123 / 106 k | 492 / 547 k | 435 / 541 k |
| their shadow maps | 23 / 27 k | 22 / 26 k | 18 / 22 k | 40 / 48 k | 37 / 46 k |
| one lamp's shadow tile, six faces, redrawn every frame while a robot walks | 160 / 262 k | 2 / 7 k (+2 quads) | 0 | 160 / 262 k | 2 / 7 k |
| the velocity buffer (moving objects) | 119 / 50 k | 61 / 48 k | 0 | 119 / 50 k | 61 / 48 k |
| the moon's map | 49 / 60 k | 46 / 57 k | 37 / 43 k | 83 / 101 k | 75 / 96 k |
| **all** (without post's ~33 quads) | **1050 / 1028 k** | **748 / 759 k** | **543 / 615 k** | **1423 / 1528 k** | **1081 / 1252 k** |

The CPU profile (`node scripts/cpu-profile.mjs <unminified build> --quality medium --incl .`: the DevTools sampling
profiler over the measured frames) said where a frame went: at medium the CPU built the frame in 6.3 ms (game logic
0.7, render() 5.7) and then waited 11.6 ms for the GPU (the 1-pixel read-back), against 4.0 + 12.2 for the world
alone; the game's extra was CPU (draws, uniform uploads, program lookups, skeleton updates), not pixels. And the GPU
only started on a frame once the CPU had finished building it: Chrome sends a task's WebGL commands to the GPU process
when the task ends. What changed, each with what it saved (`scripts/ablate.mjs` hides a part and pairs its frames
with the frames before it; `measure.mjs --vs <the build before>` interleaves two builds; both on a quiet machine):

- **Flush as it goes** (core, `createWorldRenderer({ flushEvery: 128 })`, CHANGELOG): the commands go to the GPU every
  128 draws and around the scene pass, so the GPU draws the shadow maps and the first of the scene while the CPU
  builds the rest. Medium 16.4-17.3 -> 13.1-13.9 ms, low 12.3-12.5 -> 9.8-9.9, high 20.0-21.5 -> 17.5-18.4 at the
  alley, the street and the roof (every 40 draws flushed too often: -2.2 at low; every 400 too seldom: -1.3). The
  image is the same. This is most of the win.
- **Static and moving casters apart** (core, `lighting.lights.split`, CHANGELOG): a lamp tile redrawn because a robot
  walked past it copies the cached static tile back and draws only the movers over it: 160 draws and 262 k triangles
  a frame -> 2 and 7 k. A batch also walks the scene graph once for matrices (it was once per cube face), and only
  the movers' subtrees for casters. (Its first commit hid the sun in that pass: three's light state then changed
  twice a frame and every lit material looked its program up again, 157 lookups a frame; the next commit keeps the
  lights: 37, as the world alone. `node scripts/program-churn.mjs` counts them per material.)
- **Robots: two skinned meshes, not five** (`robot-kit` glow in the shell, `robot-rig` bySlot, `enemies.js`): the
  lights are drawn by the shell's material (a vertex with ndR -1 is unlit glow, one shell material per kind carries the
  visor's colour), the rifle and its muzzle are skinned to the right hand in the shell's mesh; the hounds 3 -> 2. A
  robot's skeleton is updated once after each step (three updated it in every render() call: scene, velocity, mirror,
  six cube faces). The rifle, the shield's emitter and frame have their own plain materials and the additive shield
  is one pass (a material moving between a skinned and a plain mesh, and a DoubleSide transparent one, made three look
  its program up again at every switch). Robots' metal parts stay out of the mirror; past 30 m a sentinel casts no
  shadow (as the hounds: a far robot under a lamp no longer redraws its tile). Together about 1 ms at medium (hiding
  every robot and civilian saved 2.7 ms before, 1.5 after).
- **Near level** (`robot-kit`): sentinel 6220 / 3604 / 1480 -> 4906 / 3356 / 1364 triangles (near / middle / far),
  warden 6130 -> 4978, civilian 3928 / 2610 / 1368 -> 3532 / 2442 / 1252, scout 3136 -> 2656, the shield and mast kits
  about 5.04 k: the lathes' zero-area pole triangles dropped (nothing drawn changes), an actuator's face as two caps
  (the barrel between them was inside the housing), drums under 5 cm 8-sided near, fingers open tubes closed at the
  tip, cables 5 x 4, the chest, hips, head and bellows a step coarser near (`node scripts/robot-tris.mjs`).
- **Kites**: the four rotors are one instanced mesh with its own material (6 meshes -> 3).
- **Pickups** are drawn within 45 m (each spinning box was four draws a frame wherever it was).
- **The lamp pool's loop** (core, CHANGELOG) skips a lamp out of a pixel's reach after one texel fetch, not three.

Not done, and why:
- **The lamp pool at low** is no longer the floor: `node scripts/pool-ab.mjs --quality low` (the pool's settings at
  run time, paired, with stills) found switching it off saves 1.4-1.5 ms of 12 (it was a quarter of the frame), and
  fewer lamps per cell nothing measurable (perCell 3: -0.1 ms; the lists average 8 lamps a cell): the cost is the
  loop's presence in the shader, not its length. The flush brought low under 10 without touching it.
- **The cars' wheels have no LOD**: they are merged with the cars' bodies into one mesh per material for the three
  cars, so a level of detail per car needs its own meshes, about 20 more draws a frame (scene, moon, mirror,
  G-buffer) to save some 20-40 k triangles a pass; on this GPU the draws cost more than the triangles.
- **Civilians beyond 35 m** keep their far level (1.25 k): hiding every civilian saves 0.2-0.4 ms; an impostor level
  was not worth its risk.
- **"17 texture units"** at high did not reproduce, in the build before this pass or after, at night, dusk or day,
  with the camera at 1.5 m from the pedestrians, the courier and the vendors (the lighting pass changed the units);
  the world's surface materials sit at exactly 16 active samplers (no margin).

Measured (M4 Pro, 1440 x 900, `measure.mjs --vs <the build before> --rounds 3 --frames 30`, interleaved; the game rows
at 08:57 after the flush, load average 2.7; the world rows at 08:32 before the flush, load 2.5: quiet enough that the
build before reproduced the quiet table above within 0.5 ms; the world with the flush was not measured on a quiet
machine: a later run was spoiled by another job on the GPU):

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| vs game, low | 12.3 [12.2-12.5] | 12.5 [12.4-12.7] | 9.4 [9.3-9.9] | 11.0 [10.8-11.1] | 12.2 [12.0-12.2] | 457, 449 k |
| game, low | 9.8 [9.7-9.8] | 9.9 [9.8-10.0] | 8.4 [8.3-8.9] | 9.0 [8.8-9.1] | 9.7 [9.5-9.8] | 447, 449 k |
| vs game, medium | 16.4 [16.1-16.5] | 17.3 [17.2-17.5] | 12.8 [12.6-13.1] | 15.5 [15.0-15.6] | 16.1 [16.1-16.2] | 1085, 991 k |
| game, medium | 13.1 [12.9-13.2] | 13.9 [13.8-13.9] | 12.4 [12.0-12.9] | 12.2 [12.2-12.6] | 13.0 [12.9-13.1] | 1055, 991 k |
| vs game, high | 20.0 [19.8-20.1] | 21.5 [21.0-21.9] | 15.6 [15.4-16.0] | 18.4 [18.1-18.6] | 19.6 [19.5-20.3] | 1453, 1505 k |
| game, high | 17.5 [17.3-17.7] | 18.4 [18.0-18.5] | 14.3 [13.9-14.4] | 15.9 [15.6-16.5] | 16.8 [16.8-16.8] | 1408, 1504 k |
| world, low (no flush) | 10.2 [10.1-10.5] | 10.5 [10.4-10.7] | 6.0 [5.9-6.3] | 8.8 [8.7-8.9] | 9.8 [9.7-10.1] | 344, 400 k |
| world, medium (no flush) | 13.4 [12.9-13.8] | 14.7 [14.6-15.1] | 10.3 [10.2-10.6] | 11.9 [11.8-12.3] | 13.2 [12.9-13.3] | 802, 829 k |
| world, high (no flush) | 18.5 [18.1-18.9] | 20.2 [20.0-20.3] | 13.8 [13.7-14.1] | 16.7 [16.4-16.8] | 18.3 [17.8-18.6] | 1068, 1282 k |

(`vs game` there is the build just before the flush, with the other changes already in: against the realism build the
game rows at 08:32 were medium 17.1 / 18.0 / 14.0 / 16.2 / 17.3 -> 16.7 / 17.2 / 12.8 / 15.3 / 16.0, high 21.2 / 22.1 /
16.6 / 19.4 / 20.9 -> 19.8 / 21.1 / 15.5 / 18.4 / 19.5, low unchanged.) Every view is inside its target: low <= 10
(by 0.1-0.3 ms at the alley, the street and the roof: little margin), medium <= 16, high <= 20. The playtest's
frame-cost view (medium, 1280 x 720): 16.55-16.67 ms before the flush (17.4-18.5 for the realism build), not yet
re-measured on a quiet machine with it.

The tiers are unchanged (same features, same resolution, the mirror still every 3rd frame). The close-ups at 1.5 m
(`node scripts/realism.mjs --only robots,civ,cars --match ... --dist <the build before>`: a sentinel, a hound, the
civilians, each car's front and rear wheel) and the timeshots (seven cameras, night, dusk, day, high) are the same
before and after, but for two things on the sentinels: the rifle's muzzle tip now glows (its glow material had vertex
colours and the geometry none: it drew black) and the rifle, now in the shell's mesh, takes the body's shadow.

## Image stability

The owner saw distant buildings shimmer. `scripts/stability.mjs` draws the district (no robots firing) at two vistas,
the street looking up at the towers and the relay's roof over the plaza, 48 frames still and 48 with a 1 degree a
second pan, and measures per pixel the temporal standard deviation of luma (still) and the RMS of its second
difference in time (pan: a steady slide cancels, a twinkle does not), over the upper (far) and lower (near) half.

Medium, 960 x 600 (the 0..255 luma; before = the build before this pass):

| vista | camera | far half, before | far half, after | far p99, before | far p99, after | near half, before / after |
|---|---|---|---|---|---|---|
| street, towers | still | 0.465 | 0.461 | 2.20 | 2.12 | 0.504 / 0.499 |
| street, towers | pan 1°/s | 0.820 | 0.814 | 5.19 | 5.04 | 0.774 / 0.774 |
| roof, plaza | still | 0.671 | 0.529 | 5.09 | 3.07 | 0.631 / 0.598 |
| roof, plaza | pan 1°/s | 1.195 | 0.968 | 7.01 | 4.84 | 0.778 / 0.739 |

High: the roof 0.67 -> 0.55 (still, p99 5.0 -> 3.2) and 1.18 -> 0.96 (pan, p99 6.9 -> 4.8); the street the same as at
medium. The twinkling the maps showed (`--map dir`: the metric as an image beside the frame) was the LED wall over
the plaza, the far window grids and the advert screens; it is gone or halved. Not reached: the 3x the owner asked
for. What is left at both vistas is spread evenly over every geometric edge (the TAA's 3 x 3 neighbourhood clip
moving with the jitter, core `postfx.js`), and the street vista was already near that floor.

What changed: the facades' window grid (`modules/materials.js`: joints, lit rooms, glazing) goes over to its average
before a window is under about three pixels, instead of letting the lit-room hash and the panes alias under the TAA
jitter; the LED walls (`signs.js`), the advert screens' dots and scan lines and the ticker's LED text (`adverts.js`)
fade their dot grids to the mean cover under ~3 px (the ticker samples its text continuously then), the scrolling
glyph screens fade earlier; the camera's near plane is 0.1 m (was 0.08) and its far plane 1600 m (was 3000: the sky
dome is 1000 m round the eye), for more depth resolution on the far facades; the bystander robots switch LOD at 13 and
32 m (were 9 and 26) with wider hysteresis. Specular AA is already on in every patched lit material whose hooks set the
roughness (the facades, the megastructure). The bloom pyramid's first downsample is Karis-weighted already.
`?sharp=0` (no RCAS) lowers the far half's numbers by another 10-15 %; the sharpening is kept (it is part of the
look). The rest of what the metric sees is the TAA's neighbourhood clip on geometric edges (core), not the district.

The single file (`npm run package -w neon-district`): **3.53 MB (3,702,149 bytes)**, against the site's 5 MB budget. All of it is
code (Rapier's WASM is 2.2 MB of it); there are no assets.

## The view model's flicker

The owner saw the gun and the gloved hands flicker in play. Causes found in the code, and fixed at the cause:

1. **The near plane cut the gun.** The camera's near plane went from 0.08 to 0.1 m in the far-field pass (depth
   resolution on the far facades). The carbine aims at 12 cm from the eye (the sight, the receiver and the left cuff
   nearer still), it kicks 4 cm back toward the eye and the tuck at a wall pulls it 20 cm back: those parts crossed
   the plane as the gun swayed, bobbed and kicked and were cut on and off (a hole into the mesh). Now the view model
   has its own near plane (1 cm) in the camera's depth range: core `viewModelDepth` (opt-in, `@miragekit/core/viewmodel`)
   keeps the camera's x, y, w and TAA jitter, clips at 1 cm and writes the camera's own depth (gl_FragDepth), so AO,
   the velocity buffer and the TAA's nearest-depth tap see the gun where it is and a wall in front still hides it.
   The scene's near plane stays at 0.1.
2. **Motion vectors.** The velocity pass (core `postfx.js`) draws the gun with its own matrix of the last frame, so its
   velocity was already camera-relative; it now clips the gun at the same 1 cm plane and compares depths by view
   distance there (what lay between 1 cm and the camera's near plane had a camera-motion velocity).
3. **The gun's steel was the world's**: `M.steel` maps its brushed grain in world space, so on a gun that moves with
   the eye the grain slid over the bolts, the barrel and the rail every frame. The gun has its own brushed steel in
   object space now (`viewmodels.js`), and its own neon strips (the signs' `M.neon` would have taken the near-plane
   patch with them).
4. Not causes (read and ruled out): the fill and rim lights are clustered lamps with exact per-cell lists (perCell 0)
   and steady intensity; the gun casts no shadow (castShadow false: the lamp tiles and the sun map hide it); the
   muzzle lamp flickers per shot by design; the mirror never draws the gun (its layer).

Measured (`scripts/gun-flicker.mjs`: the game at the spawn, carbine, rain off, 60 frames per run, real time; per
pixel of the gun: the temporal sd of luma and the RMS of its second difference, 0..255; `iso` draws the gun alone on
black; before = 49c5106). The sd also carries the auto exposure's drift after a jump; the second difference does not.

| tier | run | sd before | sd after | sd p95 before / after | 2nd diff before / after |
|---|---|---|---|---|---|
| high | aim (scene) | 2.02 | 0.73 | 4.92 / 2.00 | 0.84 / 0.59 |
| high | still (scene) | 1.17 | 1.10 | 4.11 / 3.09 | 0.66 / 0.64 |
| medium | aim (scene) | 0.90 | 0.80 | 2.51 / 2.24 | 0.62 / 0.60 |
| medium | still (iso) | 2.31 | 0.70 | 9.32 / 1.54 | 1.05 / 0.56 |
| low | aim (scene) | 0.89 | 1.00 | 2.87 / 3.03 | 0.66 / 0.65 |

Aiming, the nearest ribs of the rail and the back of the sight were missing before (crops:
`out/nizwa-light/gun-dist-base/` and `gun-dist-gun/`, `gun-<tier>-night-scene-aim.png`). Walking and firing, the
metric is dominated by the gun's own bob and the muzzle flash (in both builds alike). Headless at 60 Hz the flicker
the owner saw does not reproduce as a large number at the spawn; the near-plane cut is visible in the stills.
The low tier's temporal AA (`taa2` off) reprojects every pixel as if it were fixed in the world: on a gun that
turns with the eye its history is rejected by the neighbourhood clip while turning. Not changed (low keeps the depth
reprojection for cost).

## Below a commercial shooter, and why

- **Geometry and materials.** Buildings are still boxes with a window grid in the shader; what dresses them
  (balconies, units, pipes, fire escapes, bridges) and every prop is built from boxes, cylinders, lathes and two
  extruded profiles. No sculpted or scanned models, no texture maps beyond canvas-drawn signs and wall art, no
  parallax interiors behind the windows, no per-surface wear maps. Up close the edges are hard and the surfaces flat.
- **Characters.** The robots are built in code from a kit of parts (`modules/robot-kit.js`): rigid links skinned to
  the engine's test rig, turned and extruded shells, no sculpting, no texture maps beyond printed decals; the gait is
  procedural (planted feet, heel-toe, playback scaled to the ground covered), the aim and fall are a few hand-set
  keys; the head tracks the player. No motion capture, no blend between aiming directions, no ragdoll (the engine has
  one; it needs the physics kit, which `startGame` does not set up), no cover use; the hounds flank, the rest close in
  and side-step: the brain is five states.
- **Lighting.** Lamps do not light particles (steam is tinted by hand) and only 16 of 76 cast shadows. Reflections
  are screen space: what is off screen falls back to two box probes or the sky. The probe volume covers one room.
  The volumetric pass scatters 8 lamps. There is no ray tracing and no path-traced reference.
- **Weapon feel.** Five guns (one projectile), no penetration, no animation of the fingers (the hands move as a whole:
  the reload, the pump); the view model is in the world's depth range (its own 1 cm near plane, core
  `viewModelDepth`) and pulls back from walls instead of being drawn over them.
- **Sound.** Everything is synthesised; the guns are layered and put in the room the player stands in, but there is
  no recorded material and no occlusion, and nobody has listened to it critically (see The arsenal).
- **Movement.** Crouching lowers the eye and slows the walk but the body's collider keeps its height; there is no
  slide, no mantle, no sprint stamina. Leaning and crouching are keyboard only.
- **Scope.** Five guns, six enemy jobs on two rigs and a drone, five minutes.

## What the example works around (engine gaps)

1. **The scene clock stops when the player stops.** `createPlay` runs the clock only on frames the player drives,
   and `startGame` does not pass `animate` on. The game calls `play.turn(0, 0, 0)` every tick to keep rain, effects
   and screens running.
2. **No weapon layer.** The view model is an ordinary object placed from the camera before every sub-frame
   (`world.ctx.onUpdate`); it comes back from walls (a short ray) instead of being drawn over them. Since the
   flicker pass it has its own near plane (core `viewModelDepth`, 1 cm, the camera's depth written): see "The view
   model's flicker".
3. **The field of view of a game is fixed at 62°.** `startGame` does not pass `fov` to play; aiming sets the
   camera's lens in `world.ctx.onUpdate`, after play wrote its own.
4. **The action map has no fire / aim / reload and no mouse buttons.** The game listens for them itself, so the
   pause menu cannot rebind them.
5. **The mixer can be given a sound now** (`audio.add`), and the game uses it. What it still lacks: a loop's handle
   has no gain or rate (the gatling's motor sets `h.src.playbackRate` itself) and a 3D loop cannot move (the rocket is
   silent in flight).
6. **`physics.ray` has no normal.** The weapon calls Rapier's `castRayAndGetNormal` through `physics.world`.
7. **Particles take no local lamps** (documented in `docs/vfx.md`): steam is unlit and tinted by hand.
8. **`startGame`'s character has no crouch, lean or look sensitivity.** The game lowers and shifts the camera itself
   (`world.ctx.onUpdate`) and rescales what the mouse turned since the last tick. `createMover` has a real crouch,
   but `startGame` drives the Rapier character.
13. **The lamp pool bins again for every lamp shadow tile face.** With `lampPool.captures` on, each cube face of a
    redrawn shadow tile is a capture that re-bins all 160 lamps: +5 ms a frame while a sentinel walks past a shadowed
    lamp (18.9 against 13.0 ms). The example sets `captures: false`, so pool lamps do not light environment captures.
12. **`ui.message` has no callback.** The death screen listens for the dialog's `close`.
16. **The pad's buttons are one global table** (`PAD` in `@miragekit/game`): to give Y to the guns the game empties
    `PAD.inventory` for the page. **No time scale**: `game.tick` has none, so the hit-stop slows only the game's own
    robots' step. **No haptics in the engine**: the rumble goes straight to the Gamepad API (`game/feel.js`).
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

## The megacity pass (density, advertising, street life, the city overhead)

Learned from the big open-world cyberpunk RPGs set in a Californian megacity: their methods only (vertical density,
advertising on every surface, people on the street, traffic in the air, yellow-on-black angular graphics). Every
brand, slogan, logo and motif here is invented for this district; nothing was copied.

- **Surface detail where the player stands** (`kit.js`, `materials.js`, `shopfronts.js`): roller shutters and
  container walls are corrugated geometry, not boxes; a worn-paint hook (chips to primer and bare steel, rust run down
  from rows of fixings, tide marks, a wet foot) on shutters, the container, crates, ducts, junction boxes and the
  ribbed sheet; concrete bleeds rust from some tie holes; the facades get a paint per face, panels repainted at
  different times and rust runs under the sills (the day look is less grey-green); hazard paint on the barrier tops
  and on the kerbs at the alley's mouth and the plaza's way in; cast manhole covers.
- **Shop fronts with depth** (`shopfronts.js`, called by `street.js`): bevelled piers and fascias, open shops lit
  inside (interior mapping: a box ray-cast behind the glass with shelves of goods, a counter and the keeper's
  silhouette), shutters part way down, striped awnings, light-box names from one atlas; the street doctor's clinic
  (`plan.shopfronts.clinic`).
- **Advertising** (`adverts.js`, `plan.adverts`): six portrait totems on the walls (16 invented ads in one atlas,
  page changes with a glitch, LED grid and scan lines in the shader), a ticker running round block e's corner, and a
  30 m jellyfish hologram over the plaza selling a soda, its bell pulsing, tentacles swaying, a ring of text turning.
- **The city above** (`aerial.js`, `arcology.js`): three lanes of flying cars (instanced hulls, head and tail lights,
  trails), a corporate transport circling with two searchlight cones; the HOKUTEN arcology (four setbacks to 230 m,
  a twin, three glazed sky-bridges, external lifts, a 64 m vertical name, red warning lights) built round the two
  skyline towers north of the relay; a ring of 150 far towers with tiny lit windows in the fog.
- **Street life and grime** (`streetlife.js`, `machines.js`, `grime.js`): the street life is civilian robots (see
  streetlife below): androids under the awnings, at the cart, the stall and the vending machines, walkers and a parcel
  courier on a loop east of the fight, vendors, a sweeper, a queue totem, two broken units; a yakitori stall in a
  shipping container under the gallery; vending rows in the alley and by the plaza; cables and junction boxes across
  the alley, a duct, dripping pipes, bags, crates, puddles for the planar mirror, striped barricades, wayfinding,
  district numbers, balcony laundry, dishes and grow-light plants (`facades.js`).
- **The owner's signs**: `facades.js` keeps every wall sign of the plan (and the LED walls, the ticker, the alley's
  number) clear of balconies, units, ribs, fins, pipes, cables and fire escapes (`kit.js` `signRects`); the alley's
  third pipe, bulb string and washing line and the bulb string by the arcade were moved off the five signs.
- **Density follows quality**: `ctx.shared.detail` (main.js: low 0.4, medium 0.8, high 1, `?detail=` overrides)
  thins people, traffic, balcony life, bag heaps and the far skyline. `?skip=module,...` builds without modules.

Measured (M4 Pro, 1440 x 900, headless Chrome, `out/` A/B script: both builds as pages of one Chrome, rounds
interleaved; other agents' GPU jobs were running, so the before numbers are higher than the table above):

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| before, game, low | 8.6 [8.4-9.1] | 9.6 [9.5-10.4] | 7.3 [7.1-7.9] | 8.1 [8.0-8.6] | 9.2 [8.8-9.6] | 522, 284 k |
| after, game, low | 11.3 [10.9-13.6] | 12.3 [11.8-15.2] | 7.9 [7.4-8.3] | 9.0 [8.4-10.1] | 11.7 [11.1-13.7] | 626, 331 k |
| before, game, medium | 16.0 [15.0-18.7] | 17.6 [17.2-20.4] | 12.3 [12.0-15.1] | 14.3 [13.7-17.0] | 16.4 [15.9-19.2] | 1227, 1037 k |
| after, game, medium | 19.0 [18.5-21.9] | 20.8 [19.8-23.7] | 15.0 [14.9-18.2] | 16.7 [16.6-19.6] | 19.0 [18.4-21.8] | 1376, 1129 k |
| before, game, high | 18.6 [17.8-20.0] | 20.5 [19.7-22.6] | 15.5 [15.2-16.5] | 17.0 [16.3-21.0] | 19.0 [18.3-23.9] | 1732, 1316 k |
| after, game, high | 21.9 [21.3-26.5] | 23.7 [23.0-30.7] | 17.5 [16.9-22.9] | 19.1 [18.7-23.9] | 22.1 [22.0-24.8] | 1984, 1480 k |

So the pass costs about 2.5 ms at medium and 2 to 4 ms at high on a loaded machine (rounds 5, 40 moving frames a
view; the brackets are wide because of the other jobs). Not yet measured on a quiet machine: by the ratio it would
put medium near 14 to 16.5 ms (street west the worst) and high near 15.5 to 18.5 ms; the playtest's own frame-cost
step (medium, 1280 x 720, street west) read 15.7 ms. Triangles: the scene's own geometry (meshes x instances, medium)
went from 196 k to 269 k; drawn per frame at street west (every pass: shadow tiles, the mirror) 1037 k to 1129 k at
medium, 1316 k to 1480 k at high. Low still rises 0.6 to 2.7 ms: its share is the shaders and lamps, not the
counts that `detail` thins (`?detail=0.4` at medium saved only 0.1 to 0.3 ms).

What is still rough: the fake interiors are the same box for every shop (only the light and the
goods change) and show no reflection of the street; the ticker's glyphs are canvas text, so the far half of the ring
on the jellyfish reads mirrored; flying cars have no lights on the ground and their trails are straight; the
arcology's lower half is hidden from the plaza by the skyline tower in front, and its faces use the shared window
shader (no balconies or greebles up there); the searchlights light nothing; the stall's lanterns are flat spheres.

Each module owns one section below; only its owner writes there. Build order: ground, blocks, facades,
megastructure, street, clutter, bar, relay, plaza, adverts, aerial, arcology, streetlife, grime, signs.

## Surfaces (the engine's library)

The art direction is a real-looking city with cyberpunk content, so what things are made of comes from
`@miragekit/core`'s surface library (`docs/surfaces.md`), not from hand-written hooks. `modules/materials.js`:

- `surfaceLib(ctx)` (one per world, `ctx.shared.surf`): `createSurfaces(world, { mode: 'auto' })` (baked where that is
  cheaper, per pixel for the cheap kinds: stainless, tile, rubber, car paint, metal) and `surf(spec, options, { post,
  decl })`, which is `lib.material` plus a bake size by role and quality (`big` / `mid` / `small`), the district's own
  marks over a surface (`post` edits `msAlb` / `msR` / `msM`: the kerb's painted zones, the hazard stripes on
  `M.yellow`) and the wet layer (`wet`, as before: ruts and gutters as `wear`, puddles, ripples). `painted(rgb)` is
  painted steel in any colour from one grey set (the shutters, the shop frames, the stall); `shade(kind, rgb)` the same
  for plastic, satin coat, cardboard and sawn wood (one light set per make, the part's colour a tint).
- `M.*` keep their names. Ground: asphalt worn (the road paint is `ndLines`, a mask over the library's
  thermoplastic paint), paving slabs, polished paving (plaza), precast kerbs. Walls: cast concrete with weathering
  decals (`decals`: rain rills under a ledge at 3.2 m, damp at the foot with a salt line, stains, cracks, soot); indoors
  `concreteDry` (cracks and stains only: the relay's stairwell and room). Corrugated painted sheet (box profile, rust
  leaks under each fixing row). The "black metals" (`darkMetal`, `blackMetal`, `rack`: albedo 0.01-0.03 at
  metalness 0.8-0.9, black mirrors) are black powder coat now: a dielectric with a satin sheen and steel at worn
  edges, so a bracket shows its form under any lamp. `grate` cast iron, `steel` brushed stainless with its grain up
  the part (`mapping: 'grain'`), glass with Fresnel (`glassDirty` for shop windows and the bar's panes), car paint,
  tile, render, planks, varnished wood, aluminium tread (relay floor), neon tubes (`SURFACES.neon`: a trace by day).
- `props-kit.js`: `paint` and `metal` stood in for fifteen surfaces. Now `paint` is a satin coat, `metal` is bare
  steel whose F0 is the vertex colour, and a part coloured darker than ~0.15 turns into black powder coat in the
  shader (no dark metal); `plastic` (bins), `wood` (crates, bench slats), `cardboard`, `concrete` (jersey barriers),
  `ceramic` (bowls) for the parts that are those. Every in-between metalness (paint 0.2-0.75, glass 0.1-0.3, products
  0.5, facades 0.3-0.5) is 0 or 1.
- Left as they were: the facades' window grid (layout; panels and glass now dielectric), screens and sign faces
  (content), `neonSoft` (sign boxes), the interiors, posters and markings, holograms and other additive effects. The
  cars, the robots, the drones and the view models are another pass's (their materials keep reading `M.*` / `P.mats`).

Texture units. A lit material has 16 and the lighting of `high` takes 13 (lamp atlas, env, sun shadow, lamp tables,
probes, GI, bounce, screen, mirror): a baked surface needs three of the rest (its two maps and the runtime noise), its
decals a fourth, an atlas-mapped prop a fourth. So the third reflection probe (the steel truck's) is off by default
(`?truckprobe=1`): every probe is one unit in every lit material.

Memory (the baked sets, `shared.surf.lib.stats()`, 31 sets, ~80 ms of bakes at load): high 59 MB (1024 px for the
asphalt and the street walls, 512 for floors and sheet, 256 for props), medium 28 MB (512 / 256 / 256), low 8.6 MB
(256 / 128 / 128). The decal atlas's 2 MB is in each.

## Light by the hour

Main.js keeps the whole model in one place: `weatherAt(h)` (the Sun's elevation in degrees -> rain, wetness, cloud,
haze, the sky's fill), the grade's four looks, `TIMES`. The time slider calls `setHour`; an `onUpdate` eases the
weather toward the hour's every frame (wetness in 0.05 steps: each step recaptures the image-based light; the haze
numbers are scaled after the world writes them). `?rain=` / `?wet=` pin those two.

| h (deg) | -12 night | -4 | 2 dusk | 8 | 16 |
|---|---|---|---|---|---|
| rain (x tier) | 1 | 0.6 | 0 | 0 | 0 |
| wetness | 0.9 | 0.8 | 0.55 | 0.22 | 0.12 |
| cloud cover | 0.85 | 0.75 | 0.45 | 0.3 | 0.25 |
| ground haze / air / glow | 1 / 1 / 1 | 1 / 1 / 0.9 | 0.75 / 0.8 / 0.55 | 0.4 / 0.5 / 0.3 | 0.3 / 0.4 / 0.22 |
| sky fill (x env) | 1.8 | 2 | 4 | 12 | 12 |

- **Night** (23:10, rain): the key light is white: street lamps 5000 K LED (`0xffe4ce`, 18, 16 m), shop lights 3000-6000 K,
  sodium and tungsten windows and stalls; a saturated lamp (a sign, a screen) is an accent: `lib.lamp` keeps 55 % of its
  power and 65 % of its reach outdoors (the lamp count is unchanged). With the accents reaching less, a view cell
  holds fewer lamps: the pool keeps 20 per cell on low and 26 on medium (32 on high), with no visible change in the
  standard views (same mean luminance to 0.001). The shadows keep their form from the sky glow of
  a lit city under low cloud (the image-based light x1.8) and a small warm-grey lift in the grade. Grade: -0.65 EV,
  saturation 0.88, AgX share 0.55 (highlights roll off to white), gentle curve; bloom 0.11 with a 0.32 radius; the
  volumetric cones take 35 % of their lamp's colour (lit rain, not coloured smoke).
- **Dusk** (17:04, h 1.5): the rain has just stopped: wet streets drying in patches (the puddle films shrink with the
  wetness), the cloud breaking, signs and windows coming on. Grade +0.15 EV, warm highlights over cool shade.
- **Day** (16:15, h 10.6, bearing 247: the Sun low in the west-south-west), dry: the street is in the south blocks'
  shade with the light raking the north facades above it, the towers at the ends and the roofs; the shade is lit by
  the open sky (the capture is taken between dark walls in the street, so the sky's fill is x12) and by the warm
  bounce off the sunlit walls (`lighting.bounce`). Haze is distance only (x0.3, glow x0.22, and the haze is no
  brighter than the sky: the old x1.3 was the white veil). Grade +0.7 EV (golden), warm highlights, cool shade, a firm
  curve, saturation 1.04. Sign tubes go to a trace, screens stay on.

Measured (1280 x 720, high, linear luminance of the frame, the HUD hidden): mean 0.06-0.15 by night, 0.06-0.15 at dusk,
0.08-0.25 by day; no clipped white anywhere (under 0.3 % of pixels above 0.95). Pixels under 2 % luminance by night:
14-29 % in the street views (wet black asphalt, unlit windows and the vignette), 4-8 % in close views of walls, shutters
and the stairwell.

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
and a sheet wall with barriers at both ends of the street. Reads: `lamps`, `cover`, `cars`, `street`, `alley`,
`shopfronts`. The shop fronts are built by `shopfronts.js` (open shops, shutters, doors, the clinic); they cast no shadows.

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
Ambient volumes: the room and the stairwell, factor 0.22. The stairwell is cast concrete throughout (the landings
were brushed steel, which streaked); caged bulkheads (4000 K) light the foot, each flight and each landing, and the
top landing's guard is hazard-striped painted steel.

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

## adverts

`plan.adverts`: portrait totems on walls (`totems`: [x, z, rotY]), the ticker (`ticker`: y, h, a path round a
corner), the jellyfish hologram (`jelly`: its bell's centre), `walls` (rectangles that facades.js keeps clear).
Screens are one shader over a canvas atlas of invented ads (the quad's uv.x carries its index); one pool lamp per
totem, one per long ticker run, one under the hologram. Decor.

## aerial

`plan.traffic` (lanes: y, two points, craft each way, speed, spacing) and `plan.transport` (an ellipse, period).
Five instanced meshes for all the cars, moved in onUpdate on the scene clock; the transport is a group with two
additive searchlight cones. Decor, no shadows, no lamps.

## arcology

`plan.arcology`: rect, height, twin. Swallows the two skyline towers it stands round. Setbacks in the facade
materials, sky-bridges, lifts (instanced cabins on the clock), the vertical name (a canvas), warning lights
(instanced, blinking together) and the far ring of towers (instanced boxes, a window shader). Decor.

## streetlife

`plan.streetlife`: people, walkers, vending rows, the stall, and the machines' own posts (`cartVendor`, `sweeper`,
`totem`, `broken`). The street's bystanders are civilian robots from the robot kit (`machines.js`, see "Robots and
cars" below), built never to be taken for the sentinels: light shells (white, pale greys), black joints under fabric
boots, a dark glass face plate with a soft white or blue status light that breathes, no weapons (the sentinels are
carbon black with red and amber sensors). Printed decals (ID numbers, the maker's plate, aprons, a wet-floor sign, an
out-of-order sticker, parcel labels) come from the kit's decal atlas; the totem's notices (English, 繁中, kana) from
the machines' own.
- **pedestrians** (`people`): compact domestic humanoids (the kit's `home` body at 0.82 scale, about 1.45 m), standing
  with soft knees and shifting their weight; neighbours closer than 1.7 m talk (heads turn, one gestures while the
  other listens, they take turns), the rest look about. Some carry an umbrella, only while it rains (`WET.uRain`).
- **walkers** (`walkers`): one loop, one pace, evenly spaced; a real gait (the kit's `bipedLegs`: the stance foot
  stays where it landed because the cycle runs on the distance walked; knee flexion, heel strike and toe-off, hip
  sway, arm swing); the second walker is the courier, a robot dog with a parcel box on its back, trotting the loop.
- **vendors**: a humanoid upper body on a carriage that runs along a ceiling rail in the yakitori container (turns
  skewers at the grill, slides to the pot and stirs), and on a pedestal behind the noodle cart; an apron each.
- **sweeper** (`sweeper`): a floor scrubber: a rounded hull with a rubber bumper, two disc brushes with bristle tufts
  that turn, a squeegee at the back, a lidar puck, a blue beacon; up and down the north kerb east of the plaza's way in.
- **queue totem** (`totem`) by the clinic: a signage kiosk on a mast (four notices paging every 5 s), a camera, a blue
  status ring.
- **broken units** (`broken`): pedestrians slumped against a wall (the alley, the north pavement), grimy, an
  out-of-order sticker, the status light flickering, a servo that twitches.
- **shop keepers**: drawn in the shop interiors' shader (`kit.js` `interiorMaterial`), unchanged.
Cost: four THREE.BatchedMesh (shells, printed decals, lights, umbrella canopies), so four draws a pass for every
machine; each body is 17 segment instances posed in code from joint angles (forward kinematics in the module's
onUpdate), three levels by distance (the kit's home body: about 3.9 k, 2.6 k and 1.4 k triangles; full within 13 m x
detail², the far level past 32 m x detail², with hysteresis; decals near only); per-instance frustum culling. No lamps,
no shadows; decor, out of the walk grid.
**For the destructible civilians**: `machineUnits(group)` (machines.js; the group is `scene.getObjectByName('machines')`,
also `group.userData.units()`) lists every unit: `{ id ('pedestrian-3', 'walker-0', 'courier-0', 'vendor-1',
'sweeper-0', 'totem-0', 'broken-1'), kind, shell: [instance ids], decals: [ids], lights: [ids], canopy: [canopy id,
shaft id (in shell), rim id (in lights)], frame: Matrix4 (the unit's root segment now) }`; the meshes are
`group.userData.batches` `{ shell, decals, lights, canopy }`. Hide a unit with `setVisibleAt(id, false)` on each id in
its batch (its pose keeps being written each frame, which is harmless while hidden).
Still rough: the pedestrians' joints are rigid segments (no skin between them: they are robots, but the shoulder and
hip covers can open a gap at extreme poses); the umbrella is a flat-shaded canopy without drips; the broken units sit
stiffly; the vendors' arms do not reach the grill exactly.
`plan.streetlife`: people, walkers, vending rows, the stall. People are four instanced meshes (body, legs, accents,
umbrellas) posed in onUpdate; the stall is solid (one proxy for the container). The vending rows are built by
vending.js.

| key | pos is | count |
|---|---|---|
| `steam` | the stall's pot | 1 |

## grime

`plan.grime`: cables over the alley, a duct, dripping pipes (drops in the vertex shader), heaps, crates, puddles
(cut-out glossy films the planar mirror sees), barricades (solid), wayfinding panels, stencilled numbers, floor
marks (one atlas), manhole covers.

## vending

`plan.streetlife.vending` rows plus four singles along the street (moved here from streetlife.js and street.js:
same places, same lamps). Five kinds (cold drinks, hot food, snacks, capsule toys, parts / ammo). Cabinets are
decor; an invisible box of the old size collides. Products are six instanced meshes for all the machines together.

## Close-up detail

A pass so that what the player can walk up to holds at 0.5–1.5 m. Shared pieces (no module of their own):

- `props-kit.js`: one 2048² canvas atlas for everything printed (invented brands in English / Traditional Chinese /
  kana: can wraps, bottle labels, cartons, snack packs, capsules, price tags, stickers, warning labels, stencils,
  number plates, menus, lantern paper, drive sleds, keyboards, tyre walls, lenses) and the materials that read it:
  `paint`, `metal`, `glow` (intensity in the vertex colour), `lantern` (brighter where it faces you), `clear`,
  `product` (instanced, a per-instance label offset `ndLab`). `put()` fits a part's uv to its atlas cell and writes
  its tint as a vertex colour, so a module's props merge into one draw per material.
- `props-shapes.js` (cans, PET bottles, cups, boxes, pillow packs, capsules, spirals, bowls, jars, glasses),
  `props-goods.js` (spirit bottles with liquid levels, tumblers, bowl stacks, pots, noodle baskets, a rice cooker,
  chopstick holders, skewers, stools, a goods rack), `props-lights.js` (paper lanterns, bulb strings, street lamp
  heads, bulkheads, tube fixtures, floodlights, beacons, signal heads), `props-street.js` (bins, crates, bags,
  cardboard, AC units, junction boxes, bollards, jersey barriers, news boxes, benches).
- `cars.js` (built by street.js): three designs of an invented marque, remodelled in the realism pass (see "Robots and
  cars" below). `rain-beads.js` adds beads, running drops, splash rings, water spots and a wet foot to the car paint,
  steel and glass (inside withWet). main.js adds one reflection probe box round the steel truck.

Rules kept: every colliding thing keeps its volume (an invisible proxy of the old size where the visible part became
decor: vending cabinets, stools, bins, news boxes, crates, barriers, cars, lamp bases, rack faces); every light keeps
its `lamp()` call; new lamps: three (the cars' under-glow). Small parts cast no shadows.

Still not up to standard at 1 m: the shop interiors behind the glass are still the ray-cast box (`goodsRack` exists
but no shop uses it yet); the kiosks, the plinth, the planters (no plants), the scooters, the hydrant, the pallets,
the underpass head, the roof HVAC boxes and the duct are still bevelled or plain boxes; the bar's booths and the
relay's desk body are plain slabs; bag heaps read only as dark lumps at night; the mast beacons and the aerial traffic
keep their spheres (far away).

## Robots and cars (the realism pass)

The owner looked at the cars and the robots up close and asked for a realistic standard. Learned from real products'
design language only (current humanoid robots, commercial robot dogs, home robots, service machines, angular
electric pickups, wedge concept coupes, autonomous cabs); no logos, names or one-to-one copies: the makers are
invented (KORVID SYSTEMS, MIRU HOME, QUADRA, KESTREL MOTOR WORKS). `node scripts/realism.mjs [--only robots|cars|civ|compare]
[--time dusk,night,day] [--match a,b]` shoots every subject from its sides (out/realism, gitignored).

**The robot kit** (`modules/robot-kit.js`, used by `game/enemies.js` through `game/robot-rig.js` and by `machines.js`):
- parts: actuators (a dark housing round a machined aluminium face and hub), turned oval covers with a panel seam,
  extruded shells with rounded edges, cable loops, hands with jointed fingers, feet with a rubber sole, sensor heads
  (a wraparound visor with a ring of cameras; a ring-light puck; a dark glass face plate), battery packs with ribs, a
  handle and status lights; printed decals (unit numbers as a worn stencil, a high-voltage label, the maker's plate,
  IDs, aprons) from one 512 canvas through a per-vertex attribute;
- materials: the surface library's powder coat (dielectric; worn edges show steel) and anodised aluminium, in the
  part's own space (`msOP` is the bind-pose position, so the texture sticks to a skinned or batched part), a
  per-vertex roughness (rubber, visor glass, fabric), a wet film by the street's wetness (`WET.uWet`); metalness 0 or
  1. The wet film is the kit's own (no textures): a skinned or batched robot is at the GPU's 16 texture units already;
- bodies: `humanoid(style, lod)` gives every bone's parts in its own frame: `sentinel` (slim, carbon black and
  graphite), `warden` (wide shoulders, ring actuators, a bearing ring under a torso that turns, thick forearms with a
  tool rail, a ring-light head), `home` (the civilians: light shells, fabric boots over the joints, a dark face
  plate); kits: `shield` (chest and shoulder plates, an emitter on the left forearm, chevrons), `mast` (the marksman's
  sensor mast). `quadruped(style)`: `scout`, `hauler` (a turret on a yoke), `courier` (a parcel box). Triangles
  (near / middle / far; `node scripts/robot-tris.mjs`): sentinel 4.9 k / 3.4 k / 1.4 k (6.2 / 3.6 / 1.5 before the frame
  budget pass), warden 5.0 / 3.3 / 1.5 k, home 3.5 / 2.4 / 1.3 k, scout 2.7 / 1.7 / 1.3 k, hauler 3.0 / 1.9 / 1.5 k;
  the enemies switch at 12 and 30 m with hysteresis;
- gait: `bipedLegs(phase, gait)`: the stance foot is fixed on the ground and moves back under the hip at exactly the
  gait's speed, rolled over the heel at strike and over the toe at push-off; the hip is as high as the stance leg's
  reach allows (a compass bob), the knees stay bent (robots walk crouched); two-bone IK (`legIK`) for the angles.
  `robotClips()` bakes idle (weight shifts), walk and run for the rig; the enemies' blend plays at a rate that makes
  the clips' travel equal to the ground covered (`speedParam`), so the feet do not slide. `trotLegs` for the dogs
  (diagonal pairs, knees back), driven by the distance travelled.

**Enemies** keep every behaviour, hit volume and API: two skinned meshes per robot at each of three levels (the shell,
which also draws the lights, as glow, and the rifle skinned to the right hand; the metal: "Frame budget"), one fixed
bounding sphere for all, the rig's own body not drawn; only the shell casts shadows, and only within 30 m. Lights
are red or amber (the grunt red, the warden red-orange, the shield amber, the marksman red; the hounds orange-red);
the dim rim outline as before. **Hounds** (`plan.enemies` `h0`-`h4`: a scout on the street, a hauler and a scout on
the plaza; a scout and a hauler in zone `holdout`, never woken in the mission: in the last wave they kept the uplink
from completing in the playtest): `K.type 'hound'`, counted as sentinels by the rest of the game
(`K.name 'grunt'`: the kill feed says "Sentinel"; story.js's banter can pick a hound as a speaker); posed in code, no
animator (`game/robot-rig.js` `createHound`, a stand-in for the animator's calls); the FSM's fight state calls
`hunt()`: flank (a point beside the player on the side it is on), within 3.6 m the tell, then a leap along the walk
grid to where the player stood (a bite: `K.bite`, under the assist factor); the hauler's turret fires bursts by the
sentinels' rules (two robots fire at a time). The holdout keeps its hounds back until the third wave (they are held
as "not dead" while the wave is under 2, then put first among the small fry: the holdout picks in list order).

**Civilians**: see streetlife above (`machineUnits` for the destructibles agent).

**Cars** (`modules/cars.js`), each fault the owner named:
- the pickup's tail light: one thin continuous red bar (2.2 cm) across the tailgate's top edge under the bed cover, in
  a black channel, brighter end segments; small red reflectors low in the bumper; a thin white bar across the nose
  between two slim headlamps (a chrome reflector bowl behind a clear lens). The old tail lamp's pool light was moved
  low behind the bumper (it washed the tailgate red);
- the coupe's seats: seats are a cushion, a reclined back and a headrest (vinyl), set on the cabin floor and checked
  against the canopy (the headrests 7 cm under the glass); the steering wheel and the dash under the windshield; the
  pickup has two rows under its glass roof, the cab two rows and a passenger screen;
- the wheels: per car (pickup: r 0.385 m, a tall all-terrain sidewall, a flat aero cover with five segments; coupe:
  r 0.345 m, a 0.265 m rim, a thin sidewall, fourteen fine spokes, the cast-iron disc and a caliper behind; cab:
  r 0.30 m, a flush cover); a 48-segment tyre profile with grooves, tread and sidewall from the library's rubber in
  metres of uv, the contact patch flattened on the ground, the fronts steered 0.11 rad; centred in arches cut out of
  the lower body (the side silhouette extruded across the width: the tyre's radius plus 3-4.5 cm), a dark liner and
  panel in each well; track and wheelbase symmetric. No level of detail for the wheels (three cars);
- bodies: brushed stainless with the grain along each panel (uv in metres along the car), the coupe pearl and the
  cab metallic car paint with clearcoat, black textured cladding (the pickup's arch lips and sills), tinted glass flush
  with the body and a dotted black frit band inside each pane's edge (no seal tube), shut lines, a flush handle,
  camera pods instead of mirrors, a charge port with a lit ring, number plates, the coupe's light blades, aero
  channels and diffuser strakes, the cab's lidar dome and corner cameras;
- rain: beads stand and run while it rains, as the street dries they go and leave water spots (`rain-beads.js` reads
  `WET.uWet` and `WET.uRain`); drops swell under the sills and bumpers and fall to the road while the street is wet;
  the under-glow strips are lit only at night (`uLampGain`).
Proportions: the pickup 4.7 x 1.9 x 1.56 m (5.7 x 2.0 x 1.8 in life, scaled to the footprint), the coupe 4.6 x 1.94 x
1.12, the cab 4.4 x 1.86 x 1.86; every car keeps its anchors, proxy boxes and lamps.

**Hands** (`game/viewmodels.js`): fingers as single tapered tubes with knuckles (they were chains of capsules), a
smaller hand, dark leather gloves and a cotton sleeve without sheen (the nylon's sheen read as a pale sleeve under
the gun's fill light); the pistol's support hand closes round the firing hand, the gatling's front hand opens.

**What still looks unreal**: the robots' parts are rigid and their silhouettes are built from turned and extruded
shapes (a real humanoid's covers are freeform); the gait is procedural, without the small corrections a balancing
robot makes; the hounds' lunge is a straight line; the civilians' umbrellas have no drips; the cars' bodies are
faceted lofts (the coupe's surfaces are smooth only between its stations), the tyre tread is a shader over a grooved
profile, the interiors are simple; the wheels have no LOD. Lighting is another agent's: at night and in the shade
under a car (the wheels at 0.7 m) the forms are still dark; the stills were judged at dusk. The day is not yet dry
(the rain still falls at `time=day`), so the cars' water spots are only seen once the lighting pass dries the day.
(The "17 texture units" warning at high no longer reproduces: "Frame budget".)

**Measured** (`node scripts/measure.mjs --vs <the build before> --only game --rounds 2 --frames 30`, M4 Pro, 1440 x 900,
both builds in the same rounds, other agents' jobs on the machine; `vs` = before):

| variant | alley | street west | bar inside | plaza | roof vista | calls, triangles (street) |
|---|---|---|---|---|---|---|
| vs game, low | 11.4 | 12.1 | 7.9 | 8.8 | 11.2 | 469, 393 k |
| game, low | 12.1 | 12.9 | 7.9 | 10.9 | 12.1 | 496, 446 k |
| vs game, medium | 15.8 | 17.5 | 13.1 | 15.3 | 16.7 | 838, 617 k |
| game, medium | 16.8 | 18.4 | 13.8 | 16.1 | 17.9 | 868, 890 k |
| vs game, high | 18.7 | 19.9 | 14.9 | 17.0 | 18.8 | 1179, 1013 k |
| game, high | 20.6 | 21.9 | 15.8 | 19.1 | 21.2 | 1216, 1393 k |

The pass costs 0.7-1.2 ms at medium and 1-2 ms at high, +30 draws and +270 k (medium) / +380 k (high) triangles a frame
at street west: the near robots (6 k each, three passes), the civilians' near and middle levels (2.6-3.9 k each, no
shadows) and the cars' wheels (48-segment tyres, no LOD). Won back, and more, by the frame budget pass ("Frame
budget", "After the realism pass").

## Destructibles (things break when shot)

The engine's registry (`createDestructibles`, `docs/destructibles.md`) over what the modules already draw, wired in
`game/destruct.js` (the plan: `docs/destructibles-neon-district.md`). The modules record each prop as they build it
(`modules/props-kit.js` `recorder`: its id, family, box, the vertex ranges it added to each merged batch, resolved to
`{ mesh, range }` when the batch is finished, its glowing ranges, pool lamps and clustered lights, its collider proxies;
`ctx.shared.breakables`). No prop costs a draw call up front: ranges collapse, glow ranges dim in their vertex colour,
instances hide; the only new draws are the scooters' two materials (moved from the solid `clutter` batch into decor:
a thrown scooter leaves no collider behind) and, once a tube is broken, one instanced mesh of dead tubes.

What is registered (727 at medium): vending machines 9 (their glass 9, their goods 239: cans roll and never break;
bottles, cups, boxes, packs and capsules are knocked and break), shop windows 9, shop light boxes 14, shutters 9, AC
units 11, neon strips 19 (shop doors, kiosks, benches, planters, the bar's counter), tube fixtures 2, street lamps 10,
bulbs 54 (5 strings: they pop one after another, the string's lamp goes with the last), paper lanterns 18 (bar, door,
cart, stall), signs 29 boards and 8 blades (a blade cut loose falls and crushes what is under it), LED walls 2, bar
windows 2, bottles 80, glasses 6, bowl stacks 6, jars 4, crates 11, cardboard 25, bags 60, bins 6, jersey barriers 3
(chip, hold, block blasts), barricades 5 (hold) with their beacons 5, scooters 2, cars 3 (panes 12, tyres 12, the body,
a cabin box that passes its hits to the body), the stall's flap, gas bottle and extinguisher (the last two new props,
`props-goods.js`), steam pipes 6 (alley), water pipes 3 (grime's drip pipes), civilians 21.
Protected (never break; a round shows its impact, nothing else): the owner's five wall signs (anchors whose text
contains 视频号 or 他抄由他抄, tag `owner`; `signs.js` `ownerSign`), the pass on the counter, the uplink terminal. The
relay door, the stairs and everything else on the route are not registered.

- **Rounds** (`weapon.js` `cast`): the world's distance from a ray that steps over the props' proxies and the
  characters (`props.worldRay`), then the props up to the robot or the wall (`props.shoot`): thin ones let a round
  through with less (glass 85 %, a bag 35 %, a crate 15 %), the robot behind takes what is left; a civilian, a machine
  or a car stops it. The impact sound by what was hit. The gatling's rounds count 1.6 x on props, the shotgun's 1.2 x;
  the rocket's blast is 1.25 x as wide and 1.15 x as hard on props as on robots (it throws scooters, folds the stall's
  flap, dents shutters with a scorch); the stock hits a prop when no robot is in reach. The robots' rounds: every
  tracer they draw goes through the props on its line (`shotTap` on the vfx index.js hands them).
- **Lights**: a prop's light is a channel (pool lamps through `lamps.off`, a factor kept apart from the hack's
  `scale`; clustered lights through `userData.ndOff`, which `hack.js` multiplies in; glow ranges; sign faces through
  `face.off`; a neon strip's range hidden and a dead tube shown). A hurt light flickers, a broken one goes out. A street
  lamp shot out makes its light hack's zone dark for good; other lights darken their place once under 45 % of the light
  there (weighted by distance) is left. `hack.dark` reads `extraDark`, so robots see a third as far and those fighting
  there lose the player, as in a hacked zone; steam, spray and the extinguisher's cloud block their sight (`extraBlind`).
- **The fight**: crates, boxes and bags wear out and are gone; machines burst (sparks, the lit parts dark, cans thrown
  out of the front, a spill; ammunition or a med can 55 % of the time, the parts machine always ammunition); the gas
  bottle burns 2.6 s and goes off (5.5 m, 230: robots and the player in reach, behind cover less, behind a wall
  nothing); a car: its glass crumbles, a flat tyre sinks that corner 7.5 cm, its alarm lures (35 m) the robots that are
  awake, past 55 % it burns 5 s and goes off (7 m, 300), the wreck charred and burning for 14 s.
- **Civilians** (`machines.js` units as `d.actor`): a felled one folds over its feet where it fell (the fold is written
  over the instance matrices machines.js wrote that frame); those within 11 m cower for about 7 s. Charged to the
  player: his rounds, his blasts and props he set off (the blame follows `lastHit.source` back). Each: a red warning
  `CIVILIAN DOWN −500`, a radio line (six, deadpan), the HUD tally `civ n −points`. The robots' rounds fell them too,
  charged to nobody.
- **Score** (`index.js` end cards, mission and holdout): `Property damage: N credits` (what the player broke: vending
  1,500, a shop window 400, a car 18,000, a street lamp 900, a blade sign 1,200, an LED wall 2,500, a bottle 18, a
  civilian 25,000 ... `PRICE`), `Civilian casualties: n (−500 points each)`, a remark by the bill (from 0, 2,000,
  20,000, 100,000 credits). The rating as before, then: with any casualty never the top, one step down for every two more.
- **Saves**: the registry is the game's `destructibles` entity, `destructScore` keeps whose casualties were whose; a
  load brings back the broken set, the lamps out, the sunk corners, the charred cars, the folded flap, the thrown
  scooters (lying beside where they stood) and the dark zones.

Budgets: debris 160 / 380 / 600 and marks 32 / 64 / 96 (low / medium / high), emitters 4 / 8, movers 24 / 48, detail
from `shared.detail`; debris and marks stay out of the shadow, mirror and probe passes (the engine's). The programs of
what breaking shows are made while the game loads (a few hidden instances for 20 frames): no hitch at the first pane,
crate or tube.

Measured (M4 Pro, 1440 x 900, other agents' jobs on the machine). Idle, nothing broken: 0.5 µs a fixed step and 0.3 µs
a frame for the civilians (`props.idleCost()`); `measure.mjs --vs` the build before, game, medium: street west 20.1 vs
19.9 ms, alley 18.9 vs 18.4 (the spread inside a round is ±2 ms), +3 calls (the scooters' materials). Under load
(`node scripts/destruct-measure.mjs`, ms a frame, median / p95 / worst):

| quality | idle (street west) | gatling sweep, 3 s | rocket into the stall, 2 s | debris, marks at most (cap) |
|---|---|---|---|---|
| low | 11.3 / 12.3 / 18.0 | 11.6 / 12.5 / 31.5 | 10.3 / 11.2 / 39.5 | 64 (160), 13 (32) |
| medium | 15.8 / 22.6 / 24.8 | 16.2 / 22.8 / 24.1 | 14.0 / 19.4 / 42.1 | 304 (380), 50 (64) |
| high | 21.4 / 27.2 / 29.3 | 21.8 / 27.6 / 29.6 | 19.4 / 23.2 / 49.3 | 553 (600), 50 (96) |

Check: `node scripts/destruct-check.mjs [--shots]` (60 checks in the built game; pictures in out/destruct).

Still rough: a felled walker keeps its walk cycle while it lies there and cowering is a crouch in place, not a flight
along the pavement (machines.js has no hook to stop or steer a unit: asked for); the robots' rounds reach the props
through the tracer they draw (a hook in enemies.js and drones.js would be cleaner); shop glass is so clear that a
shattered window reads mostly by its glints and the shards on the pavement; a blade sign falls as its two faces, its
box hidden on the wall; the stall's lanterns stay where they hung when its flap folds (they die with it); a car's sunk
corner moves its vertices, not its proxies; bottles, bowls and jars in the merged batches break where they stand (only
the vending goods are movers); the first frame of a rocket into a crowded place still costs 30-50 ms (twenty breaks'
debris at once).


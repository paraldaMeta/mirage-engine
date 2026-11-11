# Sound library

`@miragekit/game/sounds`: 125 sounds in seven categories (243 variants, 22 loops), all made in code. There are no
audio files: each sound is a function that renders mono samples at any sample rate, in a page, a worker or Node, and
gives the same samples on every machine (each is seeded by its name and variant). Load the ones a world uses; they
are made when the mixer unlocks, at the device's rate.

```js
import { createAudio } from '@miragekit/game/audio';
import { addSounds, soundNames, renderSound } from '@miragekit/game/sounds';

const audio = createAudio();
addSounds(audio, [...soundNames('ui'), 'step_metal', 'step_wet', 'amb_rain', 'door_slide']);
// after audio.unlock() (a click):
audio.play('ui_click');
audio.play('door_slide', { at: [4, 1, -2] });
audio.loop('amb_rain', { bus: 'ambience', gain: 0.35 });

const pcm = renderSound('explosion_open', 48000, 1);   // a Float32Array (variant 1): your own mixer, a WAV, a test
```

`createAudioEngine` (docs/audio.md) takes the samples directly: `engine.add(name, renderSound(name, rate, v))`.

To hear them all: `npx vite examples/demos/sounds` (or `node packages/tools/src/package.mjs examples/demos/sounds` for
one HTML file). Every card renders its sound when clicked and draws its waveform; `?cat=ambience`, `?q=door`.

## Categories

| category | what is in it |
|---|---|
| `weapon` (46) | pistol, carbine and shotgun shots in three spaces (an alley's slapback, the open street's long tail, a boxy room), a gatling (loop, tail, motor, spin-down, vent), a rocket's launch and a heavy explosion with debris, the mechanics (magazines out and in, a bolt, a slide, a pump, shells, dry fire), casings, impacts on concrete / metal / glass / armour, a round passing the ear, energy bolts near and far, landing, a heartbeat |
| `ui` (15) | click, hover, confirm, deny, notify, open, close, a key, a coin, a level-up, an error, a toggle, a slider tick, back, a reward |
| `step` (10) | concrete, sheet metal, a steel grate, wet pavement, a puddle, sand, snow, carpet, tiles, a ladder rung (four variants each); `createAudio` has stone, gravel, grass and wood |
| `ambience` (12, loops) | rain on a street, rain on a tin roof, a city, wind with gusts, a room's tone, a neon hum, a vent, a server room, a crowd's murmur, the sea, crickets, a fire |
| `machine` (21) | servos, robot beeps and chatter, a sliding door, a pneumatic door, a lift bell, a terminal booting, a keypad, a lock opening and refusing, a vending machine's drop, power down and up, an EMP, a shield hit, a laser, a teleport, a scanner, a hack; an alarm and a hovering drone (loops) |
| `vehicle` (9) | a car and a hover car passing (with the Doppler shift and distance), an electric car's whine and an idling engine (loops), a horn, a car alarm and a far siren (loops), a train passing, a skid |
| `nature` (12) | thunder near and far, drips, a splash, a stone into water, a gust, a songbird, a branch cracking, debris settling, glass shattering, wood breaking, a body falling |

## How they are made

`synth.js` has the parts, the way a recorded sound is made of layers: `noiseLayer` (filtered noise with an envelope:
cracks, hiss, whooshes), `thumpLayer` (a sine falling in pitch: weight), `modesLayer` (struck resonances: metal,
glass, keys), `toneLayer` (tones with harmonics, vibrato and a pitch curve: beeps, bells, motors), `room` (early
reflections and a diffuse comb / all-pass tail per space) and `master` (saturation and a look-ahead limiter, so the
summed layers never clip). `one(key, seconds, fn)` and `fold(key, seconds, fn)` make a one-shot or a seamless loop of
your own with the same seeding; all of these are exported.

Levels: one-shots are mastered to about 0.9 of full scale and loops to 0.7, so a click is as loud as an explosion at
the source. Set each one's level with the play gain (a hover at 0.2, footsteps at 0.5, a blast at 1).

Cost: rendering every variant of every sound takes about 4 s on one laptop core (Apple M4 Pro, Node 22, 48 kHz);
the slowest are `amb_rain_roof` (0.7 s) and `amb_crowd` (0.4 s). Most one-shots take a few ms. Code: 36 KB
minified (14 KB gzip) for the whole library.

## Checked

`packages/game/sounds.check.mjs` (in `npm test`) renders every variant in Node and measures it: finite, peak 0.3 to
0.93, deterministic, variants different; loops step no more at the seam than inside and hold their level across it;
hits (clicks, keys, impacts, steps, shots) reach 90 % of their peak within 8 ms of their onset and swells take over
30 ms; thunder, falls, the heartbeat and explosions carry most of their first 100 ms under 200 Hz and clicks,
glass, drips and beeps almost none; beeps, the coin, the lift bell and the keypad sound at their written notes; a
passing car is higher coming than going. `examples/neon-district/scripts/sfx-check.mjs` measures the weapons in
Chrome through Web Audio (attack, tail per space, spectral centroid, the share under 200 Hz).

None of this says a sound is good to the ear. The numbers above catch a broken sound (silent, clipped, mushy where it
should snap, thin where it should thump, off pitch, clicking at a loop's seam); whether it is convincing is a matter
of listening, which the demo page is for.

## The sounds

Measured by the check (`node packages/game/sounds.check.mjs --table`): length, attack (onset to 90 % of peak) and
the share of the first 100 ms under 200 Hz.

| name | category | variants | seconds | attack ms | under 200 Hz |
|---|---|---|---|---|---|
| `shot_pistol_alley` | weapon | 4 | 1.22 | 0.5 | 64 % |
| `shot_pistol_open` | weapon | 4 | 2.32 | 1.1 | 64 % |
| `shot_pistol_indoor` | weapon | 4 | 0.72 | 1.3 | 67 % |
| `shot_carbine_alley` | weapon | 4 | 1.30 | 0.2 | 70 % |
| `shot_carbine_open` | weapon | 4 | 2.40 | 0.3 | 72 % |
| `shot_carbine_indoor` | weapon | 4 | 0.80 | 0.7 | 69 % |
| `shot_shotgun_alley` | weapon | 4 | 1.52 | 1.6 | 82 % |
| `shot_shotgun_open` | weapon | 4 | 2.62 | 1.1 | 85 % |
| `shot_shotgun_indoor` | weapon | 4 | 1.02 | 2.3 | 82 % |
| `gatling_loop_alley` | weapon (loop) | 1 | 1.60 | - | 72 % |
| `gatling_tail_alley` | weapon | 1 | 1.15 | 1.3 | 73 % |
| `rocket_launch_alley` | weapon | 2 | 1.89 | 3.7 | 72 % |
| `explosion_alley` | weapon | 2 | 3.00 | 3.4 | 91 % |
| `gatling_loop_open` | weapon (loop) | 1 | 1.60 | - | 76 % |
| `gatling_tail_open` | weapon | 1 | 2.25 | 0.4 | 75 % |
| `rocket_launch_open` | weapon | 2 | 2.55 | 0.9 | 75 % |
| `explosion_open` | weapon | 2 | 4.10 | 2.7 | 90 % |
| `gatling_loop_indoor` | weapon (loop) | 1 | 1.60 | - | 75 % |
| `gatling_tail_indoor` | weapon | 1 | 0.65 | 0.2 | 77 % |
| `rocket_launch_indoor` | weapon | 2 | 1.59 | 3.5 | 72 % |
| `explosion_indoor` | weapon | 2 | 2.50 | 2.6 | 91 % |
| `dry_light` | weapon | 1 | 0.10 | 0.7 | 1 % |
| `dry_heavy` | weapon | 1 | 0.12 | 1.2 | 15 % |
| `mag_out` | weapon | 1 | 0.32 | 0.9 | 1 % |
| `mag_in` | weapon | 1 | 0.30 | 68.5 | 20 % |
| `bolt_rack` | weapon | 1 | 0.32 | 163.5 | 1 % |
| `slide` | weapon | 1 | 0.18 | 0.9 | 1 % |
| `pump` | weapon | 2 | 0.32 | 57.1 | 30 % |
| `shell_in` | weapon | 2 | 0.16 | 41.0 | 2 % |
| `rocket_load` | weapon | 1 | 0.55 | 219.1 | 7 % |
| `brass` | weapon | 3 | 0.45 | 0.3 | 0 % |
| `shell_hull` | weapon | 2 | 0.35 | 0.4 | 33 % |
| `impact_concrete` | weapon | 3 | 0.32 | 0.6 | 42 % |
| `impact_metal` | weapon | 3 | 0.50 | 0.3 | 2 % |
| `impact_glass` | weapon | 3 | 0.32 | 0.4 | 0 % |
| `impact_armour` | weapon | 3 | 0.32 | 1.0 | 11 % |
| `whizz` | weapon | 3 | 0.20 | 51.5 | 1 % |
| `energy_bolt` | weapon | 3 | 0.30 | 1.2 | 23 % |
| `energy_bolt_far` | weapon | 3 | 0.90 | 125.0 | 15 % |
| `heartbeat` | weapon | 1 | 0.50 | 3.3 | 92 % |
| `land` | weapon | 2 | 0.25 | 1.5 | 90 % |
| `unlock` | weapon | 1 | 0.90 | 106.4 | 2 % |
| `weapon_draw` | weapon | 2 | 0.28 | 148.2 | 3 % |
| `gatling_motor` | weapon (loop) | 1 | 0.50 | - | 14 % |
| `gatling_spindown` | weapon | 1 | 1.40 | 0.1 | 17 % |
| `gatling_vent` | weapon | 1 | 1.50 | 40.6 | 0 % |
| `ui_click` | ui | 3 | 0.06 | 0.5 | 0 % |
| `ui_hover` | ui | 2 | 0.08 | 1.6 | 1 % |
| `ui_confirm` | ui | 1 | 0.50 | 3.2 | 6 % |
| `ui_deny` | ui | 1 | 0.30 | 3.5 | 48 % |
| `ui_notify` | ui | 1 | 0.80 | 71.5 | 4 % |
| `ui_open` | ui | 1 | 0.24 | 65.2 | 3 % |
| `ui_close` | ui | 1 | 0.24 | 62.6 | 1 % |
| `ui_type` | ui | 4 | 0.06 | 0.4 | 21 % |
| `ui_coin` | ui | 1 | 0.60 | 80.9 | 3 % |
| `ui_level_up` | ui | 1 | 1.40 | 98.3 | 11 % |
| `ui_error` | ui | 1 | 0.36 | 2.4 | 40 % |
| `ui_toggle` | ui | 2 | 0.06 | 0.2 | 1 % |
| `ui_slider` | ui | 1 | 0.02 | 0.4 | 0 % |
| `ui_back` | ui | 1 | 0.36 | 2.6 | 8 % |
| `ui_reward` | ui | 1 | 1.30 | 77.3 | 12 % |
| `step_concrete` | step | 4 | 0.16 | 2.0 | 82 % |
| `step_metal` | step | 4 | 0.50 | 0.2 | 26 % |
| `step_grate` | step | 4 | 0.25 | 1.2 | 29 % |
| `step_wet` | step | 4 | 0.22 | 4.1 | 27 % |
| `step_puddle` | step | 4 | 0.32 | 7.3 | 32 % |
| `step_sand` | step | 4 | 0.18 | 1.7 | 65 % |
| `step_snow` | step | 4 | 0.22 | 1.8 | 46 % |
| `step_carpet` | step | 4 | 0.14 | 1.6 | 90 % |
| `step_tile` | step | 4 | 0.14 | 1.4 | 58 % |
| `step_ladder` | step | 4 | 0.90 | 1.5 | 9 % |
| `amb_rain` | ambience (loop) | 1 | 8.00 | - | 1 % |
| `amb_rain_roof` | ambience (loop) | 1 | 6.00 | - | 1 % |
| `amb_city` | ambience (loop) | 1 | 12.00 | - | 71 % |
| `amb_wind` | ambience (loop) | 1 | 10.00 | - | 39 % |
| `amb_room` | ambience (loop) | 1 | 4.00 | - | 62 % |
| `amb_neon_hum` | ambience (loop) | 1 | 4.00 | - | 71 % |
| `amb_vent` | ambience (loop) | 1 | 5.00 | - | 4 % |
| `amb_servers` | ambience (loop) | 1 | 6.00 | - | 16 % |
| `amb_crowd` | ambience (loop) | 1 | 8.00 | - | 19 % |
| `amb_sea` | ambience (loop) | 1 | 12.00 | - | 22 % |
| `amb_crickets` | ambience (loop) | 1 | 8.00 | - | 1 % |
| `amb_fire` | ambience (loop) | 1 | 6.00 | - | 16 % |
| `servo` | machine | 3 | 0.36 | 0.8 | 7 % |
| `robot_beep` | machine | 4 | 0.15 | 1.7 | 5 % |
| `robot_chatter` | machine | 3 | 0.90 | 2.4 | 7 % |
| `door_slide` | machine | 1 | 0.70 | 516.4 | 32 % |
| `door_hiss` | machine | 1 | 0.75 | 13.5 | 8 % |
| `lift_bell` | machine | 1 | 1.50 | 2.5 | 3 % |
| `terminal_boot` | machine | 1 | 1.50 | 1.5 | 33 % |
| `keypad` | machine | 4 | 0.14 | 1.8 | 6 % |
| `lock_open` | machine | 1 | 0.45 | 84.2 | 16 % |
| `lock_denied` | machine | 1 | 0.30 | 0.4 | 20 % |
| `vend_drop` | machine | 1 | 0.50 | 0.1 | 4 % |
| `power_down` | machine | 1 | 1.80 | 1.8 | 64 % |
| `power_up` | machine | 1 | 1.40 | 0.3 | 29 % |
| `emp` | machine | 1 | 1.00 | 1.6 | 49 % |
| `shield_hit` | machine | 3 | 0.70 | 1.1 | 32 % |
| `laser` | machine | 3 | 0.40 | 0.9 | 3 % |
| `teleport` | machine | 1 | 1.10 | 257.0 | 8 % |
| `scanner` | machine | 1 | 1.00 | 33.1 | 3 % |
| `hack` | machine | 1 | 1.30 | 40.5 | 21 % |
| `alarm` | machine (loop) | 1 | 4.00 | - | 9 % |
| `drone_hover` | machine (loop) | 1 | 4.00 | - | 61 % |
| `car_pass` | vehicle | 2 | 5.00 | 1989.9 | 79 % |
| `hover_pass` | vehicle | 2 | 4.00 | 1016.9 | 15 % |
| `ev_whine` | vehicle (loop) | 1 | 2.00 | - | 11 % |
| `engine_idle` | vehicle (loop) | 1 | 3.00 | - | 84 % |
| `horn` | vehicle | 1 | 0.80 | 8.0 | 11 % |
| `car_alarm` | vehicle (loop) | 1 | 4.00 | - | 3 % |
| `siren_far` | vehicle (loop) | 1 | 6.00 | - | 7 % |
| `train_pass` | vehicle | 2 | 8.00 | 2823.6 | 82 % |
| `skid` | vehicle | 1 | 1.20 | 22.7 | 1 % |
| `thunder_near` | nature | 2 | 3.60 | 1.3 | 89 % |
| `thunder_far` | nature | 2 | 3.60 | 458.4 | 84 % |
| `drip` | nature | 4 | 0.12 | 1.6 | 4 % |
| `splash` | nature | 1 | 1.00 | 6.1 | 60 % |
| `stone_water` | nature | 2 | 0.25 | 2.5 | 12 % |
| `gust` | nature | 2 | 2.60 | 550.9 | 35 % |
| `bird` | nature | 3 | 0.90 | 3.3 | 0 % |
| `branch_crack` | nature | 1 | 0.60 | 0.9 | 3 % |
| `debris` | nature | 1 | 2.00 | 19.0 | 2 % |
| `glass_break` | nature | 1 | 1.40 | 0.6 | 6 % |
| `wood_break` | nature | 1 | 0.50 | 1.2 | 71 % |
| `body_fall` | nature | 2 | 0.40 | 1.7 | 91 % |

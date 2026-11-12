# Experiments: borrowed walk data, and the img2threejs method by hand

These are feasibility tests, not engine code. Nothing here is imported by `examples/neon-district`. The borrowed walk
went into the cyber kit: `walk/bake-ual.mjs` now writes `packages/assets/src/kits/cyber/motion-data.js` (decoded by
`motion-clips.js` there; `walk/ual-clips.js` is gone) and the pages here read it from there.
The pages import three from the repository's `node_modules`, so serve the repository root (`shots.mjs` does).
Pictures and JSON go to `out/`, which git ignores.

```
node examples/demos/experiments/walk/bake-ual.mjs <UAL1 .glb> <UAL2 .glb>   # downloaded data -> the kit's motion-data.js
node examples/demos/experiments/walk/measure.mjs                            # gait numbers (robotClips vs borrowed) -> out/gait.json
node examples/demos/experiments/shots.mjs walk                              # strips -> out/strip-*.png
node examples/demos/experiments/shots.mjs models [set=truck|robot|compare|walk]
node packages/tools/src/package.mjs examples/neon-district --out examples/demos/experiments/out/neon.html
node examples/demos/experiments/ingame.mjs                                  # today's truck and sentinel in the game
```

## 1. Borrowed walk (Quaternius Universal Animation Library 1 + 2, CC0)

**Source.** I took both packs from OpenGameArt, where Quaternius uploaded them himself. Both download without
an account.
- UAL1: `universal_animation_librarystandard.zip`, 14,541,205 B.
- UAL2: `universal_animation_library_2standard.zip`, 10,257,419 B.

The `License.txt` inside each archive reads "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication".

Watch out: quaternius.com/license.html now publishes a different licence, the "Quaternius Asset License (QAL)
v1.0, last updated 8/28/2026". It does not allow redistributing the assets themselves, "whether alone or
bundled", "regardless of how much the Assets have been modified". It also says it does not apply to assets
already obtained under an earlier version. The pack pages and both archives (dated 2025-03 and 2026-01) still
say CC0, and a CC0 dedication cannot be revoked. The owner should still decide this knowingly.

**Rigs.**
- UAL1 has 53 joints with Rigify names (`DEF-hips`, `DEF-thigh.L`, and so on). UAL2 has 65 joints with Unreal
  names (`pelvis`, `thigh_l`, and so on).
- Both rest in the same T-pose and face +Z, as ours does.
- Hip height is 0.917 m against our 0.95 m. Thigh is 0.40 m against our 0.42 m. Shin is 0.43 m against our
  0.42 m.
- Every clip keys T, R and S on every joint at 30 Hz, and every clip plays in place: the root does not move.

**Clips in the free Standard packs.**
- Locomotion: walk, jog, sprint, crouch walk, zombie walk.
- Idles: several, including idle.
- Hits: hit chest, hit head, hit knockback.
- Death: one only (Death01).
- Aim: static pistol aim poses.

Missing from the free packs: strafes, turn-in-place, rifle aim-walk and a second death. The page says the Pro
pack ($9.99) adds 8-direction locomotion. I could not check that without paying.

**Pipeline** (`walk/bake-ual.mjs`):
1. Map the bones explicitly. GLTFLoader sanitises names, so `DEF-thigh.L` becomes `DEF-thighL`.
2. Keep the rotation tracks plus the hips and root translation. The rest are dropped: they would stretch our
   bones.
3. Retarget with the engine's own `retargetClip`. It uses model-space deltas, matches rest directions, and
   scales hip height by 1.036.
4. Raise the hips by one ground correction for the whole set, measured on idle: 4.2 cm. The sources stand with
   slightly bent knees.
5. Extract root motion from the feet. The speed is the one at which the planted foot is still: the median of
   the planted foot's velocity, iterated three times.
6. Encode with `walk/clip-codec.js`: 30 Hz, int16 x/y/z with w rebuilt, hips offset in 0.1 mm units,
   near-constant tracks stored as one key, and travel stored as one number. The codec rebuilds the
   `Root.position` track, so `createAnimator`'s `rootMotion` works unchanged.

Worst angle error of the decoded clip against the float bake is 0.15°.

**Bytes per clip** (from `out/bake-report.json`; "GLB" counts all 53 joints' keys as stored, float32):

| clip | s | GLB keys | enc 15 Hz | enc 20 Hz | enc 30 Hz | 30 Hz gzip |
|---|---|---|---|---|---|---|
| idle | 2.50 | 161,424 | 4,301 | 5,381 | 7,631 | 5,405 |
| walk | 1.33 | 87,084 | 3,285 | 4,083 | 5,565 | 4,707 |
| run (jog) | 0.93 | 61,596 | 2,432 | 2,942 | 3,860 | 3,340 |
| sprint | 0.67 | 44,604 | 1,997 | 2,303 | 3,017 | 2,658 |
| crouchWalk | 2.00 | 129,564 | 3,888 | 4,848 | 6,768 | 4,785 |
| brokenWalk (zombie) | 1.33 | 106,764 | 3,233 | 4,031 | 5,513 | 5,040 |
| aimPistol | 0.17 | 12,744 | 888 | 888 | 888 | 905 |
| hitChest | 0.33 | 23,364 | 1,338 | 1,518 | 1,789 | 1,747 |
| hitHead | 0.43 | 29,736 | 1,475 | 1,644 | 1,980 | 1,870 |
| hitKnockback | 0.83 | 67,704 | 2,117 | 2,627 | 3,443 | 3,069 |
| die | 2.40 | 155,052 | 4,769 | 6,065 | 8,657 | 6,285 |

Each "enc" column includes that clip's JSON metadata, about 0.6–0.8 KB. With a fixed bone order that metadata
would be about 60 B.

The 11 clips at 30 Hz come to 40,164 B of keys plus 8,959 B of metadata. As a JS module that is 62,857 B,
53,552 B of it base64, and 32,409 B gzipped.

**The requested set:**
- Present in the free packs (walk, run, idle, hit, one death): 27.5 KB at 30 Hz, about 37 KB as base64 in the
  single file, or about 20 KB / 27 KB at 20 Hz.
- With the missing clips estimated at sizes like the present ones (2 strafes, a turn, an aim-walk, a second
  death): about 55 KB at 30 Hz, or about 74 KB as base64. That is under 2% of the 5 MB budget.

**Gait numbers** (`out/gait.json`; same rig, one cycle sampled at 120 Hz). Definitions:
- "Planted" means the foot's lowest sole point is within 2 cm of the lowest any sole point reaches.
- Slide is that point's horizontal speed.
- "Locked" is the share of planted frames that slide under 10 cm/s.

| clip | speed m/s | slide mean / median / p95 cm/s | locked | knee flexion ° | hip bob cm | lowest sole point cm |
|---|---|---|---|---|---|---|
| today's walk | 1.50 | 85 / 84 / 97 | 0% | 0–52 | 2.2 | −7.2 (sinks into the floor) |
| borrowed walk | 1.13 | 21 / 6 / 138 | 66% | 10–88 | 5.4 | +0.7 |
| borrowed walk at 1.5 (rate ×1.33) | 1.50 | 25 / 8 / 181 | 59% | 10–88 | 5.4 | +0.7 |
| borrowed walk at 1.5, own cycle (no rate change) | 1.50 | 45 / 37 / 175 | 7% | 10–88 | 5.4 | +0.7 |
| today's run | 4.20 | 224 / 229 / 233 | 0% | 0–97 | 4.8 | −17.2 |
| borrowed jog | 5.81 | 28 / 34 / 55 | 13% | 0–129 | 25.3 | +1.2 |
| borrowed jog at 4.2 (rate ×0.72) | 4.20 | 20 / 21 / 41 | 17% | 0–129 | 25.3 | +1.2 |

How to read these:
- The high p95 on the borrowed clips comes from the moment a foot enters or leaves the 2 cm band, not from
  sliding during stance.
- The jog's feet sweep 0.8 m in 0.16 s, so its natural ground speed is 5.8 m/s. At the game's 4.2 m/s it has to
  play at ×0.72, which is 93 steps/min and looks floaty. The sprint (8.9 m/s natural) played slower may suit
  better.
- The borrowed walk leans forward about 12°, as the source does (11°).

Strips (baseline on top, borrowed below), in `out/`:
- `strip-walk-side.png`, `strip-walk-three.png`
- `strip-run-side.png`, `strip-run-three.png`
- `strip-*-game.png`
- `strip-die-side.png`, `strip-brokenWalk-side.png`

`out/models-robot-walk.png` shows the borrowed walk and run on the staged robot (below), with no retargeting.

## 2. img2threejs: review and a trial by hand

**Downloads.**
- Repository: `git clone --depth 1 https://github.com/img2threejs/img2threejs` at commit `0c0c49bc`
  (2026-11-05), 7.6 MB checked out. GitHub reports 21,201 stars, Apache-2.0, not a fork. Nothing in it was run.
- Truck reference: Commons "2024 Tesla Cybertruck, rear left, 07-27-2024.jpg" by Cutlass, CC0, 1920 px
  thumbnail, 578,711 B.
- Robot reference: Commons "Tesla Bot, Tesla Shop, Westfield Century City (Sept. 2024).JPG" by Alexis Doine,
  CC0, 1,454,452 B.

Both references stay in the download folder and are not in the repository. The models are a generic faceted
pickup and a generic humanoid, with no badges.

**The method, as applied.** For each subject I worked through these steps:
1. A reference sheet in numbers.
2. A quality contract: at most 5 critical features, and the failures that block.
3. A detail inventory mapped to parts.
4. A spec: hierarchy, pivots and materials.
5. Five locked passes: blockout → structure → form → material → optimise.

At every pass I rendered four views on a neutral stage, looked at them against the reference, and chose one of
continue / refine-spec / refine-code.

**Truck: reference sheet.**
- Length 5.68, width 2.03 (2.41 with mirrors), height 1.79, wheelbase 3.81, track 1.72.
- Tyre Ø0.88 × 0.285 with 20" rims; clearance 0.40.
- A single ridge from the nose (1.03) to the apex (1.79, at the B pillar), then one straight slope to the tail
  (1.30).
- Belt line 1.22–1.27, side crease about 1.05, trapezoid arches in black cladding, black sills and bumpers.
- One full-width tail lamp bar across the top of the tailgate, with a bright line under it; a full-width front
  light bar.

Critical features: the ridge silhouette, the trapezoid arches, the full-width tail bar, the AT tyres on black
6-spoke rims, and the black lower band.

**Truck: gates.**
- p1 OK.
- p2: the silhouette reads right.
- p3/4, try 1: the arch cladding was a solid block, because the hole fell outside the shape. Rear slats read as
  stripes. Refine-code. Picture: `out/gate-truck-p4-try1.png`.
- p5, try 2: the belt line was 1.07 against about 1.27 measured from the photo. Refine-spec. Picture:
  `out/gate-truck-p5-try2.png`.
- Final: `out/models-truck-p5.png`.

**Robot: reference sheet.**
- 1.73–1.76 m tall. The joints are deliberately the rig's: hips 0.95, knee 0.50, shoulder 1.40.
- Egg helmet with a full gloss visor; neck column exposed.
- Shield-shaped chest shell (0.43 wide at the shoulders, 0.26 at the waist) and a battery pack on the back.
- Exposed waist column; black pelvis with a front disc and hip actuators.
- Bulky thigh shells with a black front inset; knee actuators; slim shins with two calf rods.
- Shoe feet with a toe cap; silver arms with elbow actuators; hands with 4 two-part fingers and a thumb.

**Robot: gates.**
- p2: proportions OK.
- p4, try 1: thighs and shoulder caps too slim against the reference. Refine-code. Picture:
  `out/gate-robot-p4-try1.png`.
- Final: `out/models-robot-p5.png`.

**Counts** (neutral stage, `out/models.json`, `ingame.mjs`):

| model | triangles | draw calls | materials | size L×H×W m |
|---|---|---|---|---|
| today's Slab (cars.js) | 6,876 | 6* | 5 | 4.72 × 1.64 × 2.16 |
| staged truck (truck.js, pass 5) | 11,734 | 18 | 11 | 5.90 × 1.82 × 2.40 (with bumpers and mirrors) |
| today's sentinel in game (rig, plates, visor, rifle) | 3,664 | 5 | – | – |
| today's sentinel body alone (rig) | 1,328 | 1 | 1 | – |
| staged robot (robot.js, pass 5, rigid skin) | 15,204 | 5 | 5 | 1.76 tall |

\* In the game the car shares the street's batches, so its draw calls are shared too.

**What the comparison found in today's truck** (`out/models-compare-truck-current.png`,
`out/ingame-truck-rear.png`):
- **The tail lamp is buried.** The rear light plane and its housing sit at x = −2.344 / −2.338, inside the rear
  cap at x = −2.36. In the game only two small red corner points show.
- **A bar runs through every wheel.** Each arch cladding shape has a bottom strip between y −0.06 and −0.04,
  which draws a black bar across the wheel at axle height.
- **The proportions are off.** The wheels are Ø0.76 against 0.88, and the wheelbase is 2.90 against 3.81. The
  body is 17% short. The whole lower body up to 0.82 m is black, where the reference shows steel down to
  0.55 m.

These are notes for the agent who owns `cars.js`. Nothing in `examples/neon-district` was changed.

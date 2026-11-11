# Animation: controller, IK, retargeting, timeline

All of this is in `@mirage/play`, experimental and opt-in: a world that does not call it runs none of it. It works
on any three.js skeleton and `AnimationClip`s, normally the `animations` of an imported model
([import.md](import.md)). To see it: `examples/demos/anim` (flags at the end).

## The animator

```js
import { createAnimator, rootMotionInput } from '@mirage/play';

const anim = createAnimator(model, clips, {
  parameters: { speed: 0, grounded: true, wave: 'trigger' },
  rootMotion: { bone: 'Root' },
  layers: [
    { name: 'base', start: 'move',
      states: {
        move: { blend1d: { param: 'speed', points: [[0, 'idle'], [1.5, 'walk'], [4.2, 'run']] } },
        air: { clip: 'jump', loop: false },
      },
      transitions: [
        { from: 'move', to: 'air', when: ['!grounded'], duration: 0.1 },
        { from: 'air', to: 'move', when: ['grounded'], duration: 0.15 },
      ] },
    { name: 'arm', start: 'none', mask: ['RightShoulder'],            // a bone and everything below it
      states: { none: {}, wave: { clip: 'wave', loop: false } },
      transitions: [{ to: 'wave', when: ['wave'] }, { from: 'wave', to: 'none', exitTime: 0.95 }] },
    { name: 'lean', start: 'lean', additive: true, weight: 0.5, states: { lean: { clip: 'lean' } } },
  ],
});
anim.on('footL', (e) => playStep());                                  // clip events (clip.userData.events)
const move = anim.update(dt);                                         // { x, y, z, yaw }: the root bone's travel
```

- **State machine**: per layer; conditions are `'name'`, `'!name'`, `'speed > 1.5'` (`>=`, `<=`, `==`, `!=`, `<`,
  `>`) or a function; `from` a name, a list or `'*'`; `exitTime`, cross-fade `duration` (0.2 s), `interrupt`.
  `anim.play(state)` cross-fades directly; a `'trigger'` parameter resets once a transition used it.
- **Blend spaces**: `blend1d` and `blend2d` (`'cartesian'` or `'directional'`). The clips of one blend share a
  phase, so a walk and a run of different lengths stay foot-synchronised. A blend is not linear in speed: the
  test rig's walk (1.5 m/s) and run (4.2 m/s) blended at `speed` 2.85 travel 2.512 m/s. Use root motion, or a
  `speedParam` (as `createRigCharacter` does), when the feet must match the ground.
- **Layers**: `mask` limits a layer to bones; `additive` adds the pose's difference from the clip's first frame.
- **Root motion**: the named bone's horizontal travel (and yaw) is taken out of the pose and returned. To let the
  walk grid decide where the figure can go:
  `walker.update(dt, rootMotionInput(anim.update(dt), model.rotation.y, walker.body, dt))`.
- **Events**: `{ time, name }` in `clip.userData.events` (kept by `writeGLB` and the importer) or the `events`
  option; in a blend only the heaviest clip fires, so a step sounds once.
- **Deterministic**: no clocks inside; `fixedStep` advances in whole steps whatever `dt` arrives (the same pose for
  1 x 1/30 as for 2 x 1/60); `snapshot()` / `restore()` continue bit-identically.

Why not `THREE.AnimationMixer`: it has no shared phase for blend spaces, no bone masks, no additive layers by
reference pose, and it advances on its own clock per action, which makes root motion and bit-identical restore
awkward. The animator samples the same clip tracks with three's interpolants and does its own blending in flat
buffers. Node 22, the 20-bone rig, one `update`: one clip 1.5 µs, a 3-clip blend with root motion 2.3 µs, the whole
rig character with foot IK and look-at 5.7 µs (median of 7 interleaved runs of 20 000; spread 1.45-1.60, 2.21-2.43,
5.51-5.88). Skinning itself is three's, on the GPU.

## IK

`anim.post` holds functions run after every pose write; IK goes there.

```js
import { createFootIK, solveLookAt, solveTwoBone } from '@mirage/play';
const feet = createFootIK(model, { ground: (x, z, y) => grid.groundAt(x, z, y, 0.4), hips: 'Hips',
  legs: [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']] });
anim.post.push(() => { feet.update(anim.dt); solveLookAt([neck, head], target, { share: [0.35, 0.65], limit: 1.1 }); });
solveTwoBone(upperArm, foreArm, hand, handTarget, { pole: elbowPoint });   // analytic, world space
```

Foot placement samples the floor under each animated foot, lowers the hips so the lower foot reaches, lifts the
other with two-bone IK and pitches feet on slopes; offsets ease (`rate` 12 /s) and are limited (`maxStep` 0.4,
`maxDrop` 0.35). In the demo, standing across a 0.15 m kerb, both ankles sit 7 mm from their own floor; with
`?ik=0` one is 143 mm off. Inside `createPlay` the figure's position is set after the character's update, so foot
placement sees the previous frame's position (one frame of lag while moving, none standing).

## Retargeting

```js
import { retargetClip } from '@mirage/play';
const walk = retargetClip(sourceClip, sourceModel, targetModel);   // both in their rest pose, matrices updated
```

Bones are matched by name (`humanoidRoles`: Mixamo-style names, `.L` / `_l` / `Left` spellings; pass `map` to
override), rotations are transferred as world-space deltas after swinging the target's limbs onto the source's rest
directions (a T-pose clip on an arms-down skeleton), hip travel is scaled by hip height, events are kept. Test rig
to the built-in traveller (other names, other rest pose): 13 bones mapped, scale 0.937, limb direction error
4.9e-4 rad (1.35 rad without rest matching). It is a bake, not a runtime solver: no finger chains, no IK pass for
contact, and a root bone above the hips keeps its motion only if the target has one too (otherwise the travel is on
the hips: name it as `rootMotion.bone`).

## Timeline

```js
import { createTimeline } from '@mirage/play';
const tl = createTimeline({ tracks: [
  { type: 'camera', target: camera, curve: 'smooth', keys: [{ t: 0, position: [0, 1.6, 6], lookAt: [0, 1, 0], fov: 50 }, { t: 4, position: [3, 1.2, 3], lookAt: [0, 1.2, 0], fov: 30, ease: 'inOut' }] },
  { type: 'transform', target: door, keys: [{ t: 1, rotation: [0, 0, 0] }, { t: 2, rotation: [0, 1.4, 0], ease: 'out' }] },
  { type: 'animation', animator: anim, clips: [{ t: 0, clip: 'walk', duration: 3 }, { t: 3, clip: 'wave', over: 'idle', fade: 0.3 }] },
  { type: 'audio', cues: [{ t: 1, sound: 'creak' }], play: (cue, offset) => audio.play(cue.sound, offset) },
  { type: 'event', keys: [{ t: 2, name: 'doorOpen' }] },
] });
tl.on('doorOpen', () => {}); tl.play();   // then tl.update(dt) every frame; tl.seek(t) to scrub
```

`seek(t)` shows time `t` whatever came before (two page loads of the demo at `?timeline=1&t=2.2` are the same
image, pixel for pixel), so a shot can be scrubbed and rendered frame by frame. One rule: an animation track poses
its animator with `poseClip`, so do not also call `anim.update` on that animator while the timeline owns it. `over`
names a clip posed underneath one that keys only part of the body.

## An imported model as the player

```js
import { createPlay, createRigCharacter } from '@mirage/play';
let hero;
const play = createPlay(world, { plan, canvas, mode: 'game',
  character: () => (hero = createRigCharacter(assets.instantiate(model), model.animations)) });
hero.ground = (x, z, y) => play.grid.groundAt(x, z, y, 0.4);   // foot placement on
```

`character` is the opt-in: without it `createPlay` builds the procedural traveller exactly as before
(hello-courtyard and garden-quest, two viewpoints and the game view each at 960 x 540, 8 spp: the six PNGs are
byte-identical before and after this work). The rig
needs clips named `idle`, `walk`, `run` and optionally `jump` (`clipNames` maps other names); `layers` replaces
the default controller.

## The demo

`examples/demos/anim` (Vite: `npx vite examples/demos/anim`; one file:
`node packages/tools/src/package.mjs examples/demos/anim`). Check: `node examples/demos/anim/anim-check.mjs`.

| flag | |
|---|---|
| `?player=procedural` | the built-in traveller instead of the imported rig |
| `?ik=0` | no foot placement, no look-at |
| `?npc=0` | no second figure walking a circle by root motion |
| `?retarget=0` | no built-in traveller playing the rig's retargeted walk |
| `?timeline=1` (`&t=seconds`) | a scripted shot instead of play |
| `?src=url` | your own .glb as the player |
| `?decoders=1` | start the Draco and Basis decoders and print what they report |

## Not here

Animation compression, morph-target tracks (the animator blends node transforms only),
full-body or CCD / FABRIK chains, motion matching, a graph editor, curve editing in the timeline, and
inertial blending (cross-fades are linear).

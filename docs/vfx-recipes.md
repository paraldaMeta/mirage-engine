# Effect recipes

Part of the asset library (`@miragekit/assets/vfx`, BSL: see that package's licence): 55 effects in core's effect
format, played by core's particle system (`createVfx`, [vfx.md](vfx.md) has the format). Everything is made in code:
the sprites, the flipbook sheets and the shard mesh are core's own.

```js
import { createVfx } from '@miragekit/core';
import { VFX_RECIPES, vfxNames } from '@miragekit/assets/vfx';

const vfx = createVfx(world);
vfx.burst(VFX_RECIPES.impactMetal.effect, hit.point, { direction: hit.normal });   // a one-shot
const fire = vfx.spawn(VFX_RECIPES.brazier.effect, { position: [2, 0, -3] });        // a loop: a handle
const rain = vfx.spawn(VFX_RECIPES.rainHeavy.effect, { follow: cameraRig });         // weather rides on the camera
fire.stop();
```

`VFX_RECIPES[name]` is `{ cat, desc, loop, effect }`; `vfxNames(cat)` lists a category. A recipe's `effect` is plain
JSON: copy it and change a colour or a rate to make your own.

| category | recipes |
|---|---|
| combat (13) | `muzzleFlash`, `tracer`, `impactConcrete`, `impactMetal`, `impactWood`, `impactWater`, `robotHit`, `shockwave`, `empPulse`, `shieldHit`, `plasmaBolt`, `lightningArc`, `bloodlessHit` |
| weather (9) | `rainHeavy` (splashes where drops land), `drizzle`, `blizzard`, `hail`, `sandstorm`, `groundFog`, `ashfall`, `petals`, `pollen` |
| fire (11) | `torch`, `candle`, `brazier`, `burningWreck`, `chimneySmoke`, `steamVent`, `exhaust`, `smokeGrenade`, `flare`, `weldingSparks`, `electricShort` |
| water (5) | `fountain`, `waterfallSpray`, `drip`, `bubbles`, `wake` |
| magic (10) | `healAura`, `levelUpPillar`, `portal`, `teleport`, `poisonCloud`, `iceBurst`, `lightningStrike`, `summonCircle`, `hologramMotes`, `buffSparkle` |
| celebration (4) | `fireworkBurst`, `fireworkRocket`, `confetti`, `sparkler` |
| ambience (3) | `dustMotes`, `sandTrickle`, `butterflies` |

Core's own ten (`VFX_LIBRARY`: fire, smoke, sparks, dust, splash, snow, leaves, fireflies, magic, explosion) are not
repeated here. Directions: a recipe's +y is turned to `direction` (a shot's forward for `muzzleFlash` and `tracer`, the
surface normal for the impacts). Weather boxes are about 30 m square and centred on what they follow.

Budgets: the weather recipes use up to 8,000 particles each (`blizzard` the most, about 7,200), everything else at
most 600; one draw call per emitter whatever the count.

To see them: `npx vite examples/demos/vfx-recipes` (every recipe on a pad, one-shots replaying every few seconds,
Shift+W cycles the weather; `?view=combat | fire | water | magic | celebration | ambience | yard`). Check:
`node packages/assets/vfx.check.mjs` (every recipe passes defineEffect and bakes, stays in its budget and near its
spawn point, says truly whether it loops; the fountain's height, the tracer's reach and the rain's fall are checked
against their descriptions).

Limits: `butterflies` and `petals` are tumbling shards (core has no wing mesh); the lightning is particles along a line, not a branching bolt.

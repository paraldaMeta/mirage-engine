# Destructibles

Props that crack, dent, shatter, spill, burn, fall and explode when they are shot: `createDestructibles` in
`@miragekit/game` (also `@miragekit/game/destruct`). It works over what a scene already draws (a mesh, one instance of
an `InstancedMesh` or a `BatchedMesh`, a vertex range of a merged mesh) and adds nothing to the scene until something
breaks. Demo: `examples/demos/destruct` (a shooting range); checks: `packages/game/destruct.check.mjs` (Node, in
`npm test`) and `examples/demos/destruct/destruct-check.mjs` (Chrome).

```js
import { createDestructibles } from '@miragekit/game';

const g = await startGame(world, { built, setup(ctx) { /* ... */ } });
const d = createDestructibles(g, { seed: 'level-1', vfx, lamps: world.lampPool });   // g: { game, physics, audio, root }
d.add({ id: 'shop-window-3', draw: { mesh: shopGlass, range: [first, count] }, material: 'glass', value: 400, lamps: [17] });
d.add({ id: 'crate-1', draw: crateMesh, material: 'wood', broken: 'crate', solid: true });

// in the weapon: the props along the round, nearest first; thin ones let it through with less damage
const r = d.hit({ ray: { origin, dir, max: wallDistance }, kind: 'bullet', damage: 22, source: player, occlude: false });
if (r.item) impactFor(r.hits[r.count - 1].class, r.point, r.normal);
d.blast({ point, radius: 5.5, damage: 220, falloff: 'linear', occlusion: true });
d.on('break', (e) => hud.money(d.tally.value));
```

With a game (`startGame`'s session or `setup`'s ctx) the registry steps with the game's systems (its fixed 60 Hz
tick) and is an entity of the game (`'destructibles'`): `game.save()` / `load()` and checkpoints carry the broken set.
Without one, call `d.update(frameDt)` once a frame.

## API

| call | what it does |
|---|---|
| `createDestructibles(target, options)` | a registry. `target`: `{ game, physics, audio, root, world }` (a session or ctx) or `{}` |
| `d.add(spec)` | register a breakable (below); returns its record |
| `d.actor(spec)` | a bystander: collapses (a pose blend to a slump, sparks), `'casualty'`, `'panic'` to the actors near it |
| `d.place(id, pos)` | move an actor (or a capsule / sphere prop) with whatever moves it |
| `d.hit({ ray \| point \| item, kind, damage, source, pierce, occlude })` | damage; returns a reused result: `item`, `t`, `point`, `normal`, `hits[]` (`{ item, id, t, point, normal, damage, broke, class }`), `count`, `stopped` (`'world'`, `'item'`, `'none'`), `world`, `left` |
| `d.blast({ point, radius, damage, falloff, occlusion, kind, source, min })` | every prop in reach; `falloff` `'linear'`, `'square'`, `'none'`, an exponent or a function; behind solid world nothing (`options.occludedBlast`), behind a blocking prop (heavy metal) a quarter. Returns `[{ item, damage, distance, cover }]` and emits `'blast'` |
| `d.cover(from, to)` | the same cover test, 0..1, for the game's own entities (enemies, the player) |
| `d.ray(origin, dir, max)` | the nearest unbroken prop on a ray, no damage |
| `d.damage(id, amount, kind)` / `d.break(id)` | direct; `break` refuses a protected prop |
| `d.on(type, fn)` | `'hit'`, `'stage'`, `'break'`, `'casualty'`, `'panic'`, `'noise'`, `'blast'`, `'crush'`, `'loot'`, `'spill'`, `'fire'`, `'steam'`, `'water'`, `'restore'`, `'reset'` |
| `d.tally` | `{ count, value, casualties, byClass: { glass: { count, value } }, byTag }` |
| `d.snapshot()` / `d.restore(s)` / `d.reset()` | compact state (ids of broken props with their stage, hurt props' health, where moved props lie) |
| `d.update(frameDt)` / `d.step()` / `d.sync(alpha)` | fixed steps (`hz`, 60) and the draw blended between the last two |
| `d.visibility(from, to)` / `d.blocksSight(from, to)` | how much of a line of sight survives steam and spray (for AI) |
| `d.surfaceAt(p)` | the spill under p: `{ slippery, conductive, liquid }` or null |
| `d.query(p, r)`, `d.get(id)`, `d.items`, `d.fromCollider(handle)` | lookups |
| `d.setDetail(x)`, `d.prewarm()`, `d.hash()`, `d.stats`, `d.dispose()` | quality, shader warm-up, a determinism hash, counters |

### A prop: `add(spec)`

| field | |
|---|---|
| `id` | a stable string (saves name it); default `d<index>` |
| `draw` | an `Object3D`, `{ mesh: InstancedMesh, index }`, `{ mesh: BatchedMesh, id }`, `{ mesh, range: [firstVertex, count] }` (non-indexed merged geometry), `{ mesh, indexRange: [first, count] }`, `{ hide, show }` of your own, or a list of these |
| `box` / `sphere` / `capsule` | the hit volume: `{ center, half, quaternion \| yaw }` or `{ min, max }`; `{ center, radius }`; `{ a, b, radius }`. Default: the drawn thing's bounds (an oriented box) |
| `material` | a class (below); `health`, `armour: { kind: k }`, `pierce`, `value`, `stages`, `debris`, `fx`, `sound` override it |
| `solid` | a fixed Rapier cuboid the character bumps into, removed when it breaks (rays of the default occluder step over it) |
| `protected` | never breaks: takes hits, shows impacts, nothing else (`break()` refuses it, blasts leave it whole) |
| `group`, `tags` | `group` orders `chain`; tags are tallied (`tally.byTag`) |
| `lamps`, `lights`, `emissive`, `lampMode` | lamp pool indices, `PointLight`s, materials or `{ mesh, index \| id }` colours it owns: dark when it breaks (`'off'`), or a stutter first (`'flicker'`) |
| `broken` | `'pane'`, `'crate'`, `'dent'`, `'tyre'`, an `Object3D`, `(item) => Object3D`, or `null` (just gone) |
| `behave` | `{ explosive, spillLiquid, ventSteam, sprayWater, dropLoot, alarm, fall, chain, burn }`: `true` or options |
| `mover` | `{ shape: 'cylinder' \| 'box', mass, bounce, friction, breakable, reinstance }`: knocked about (below) |
| `onHit(e)`, `onBreak(e)` | per prop; the events carry `item, damage, kind, point, normal, dir, source, stage` / `id, class, value, tags` |

### Options

`seed`, `hz` (60), `detail` (1), `maxDebris` (600), `maxDecals` (96), `maxEmitters` (8), `maxSpawnPerStep` (160),
`maxMovers` (64), `maxPierce` (3), `maxSounds` / `maxFx` per step (6 / 12), `cell` (4 m, the grid), `root`, `world`,
`vfx` (a `createVfx`: particles), `audio` (a `createAudio`: its sounds are added unless `sounds: false`), `physics`,
`kit` (for `physics: true` pieces), `lamps` (`world.lampPool`, or `(index, k) => void`), `occluder`
(`(from, dir, max) => hit | null`; default `physics.ray` stepping over the props' own colliders), `occludedBlast` (0),
`floor` (a height or `(x, y, z) => y`; default a ray down), `colliders` (`[{ min, max }]` movers bounce off), `sensors`,
`materials` / `effects` (merged into the defaults), `onBlast`, `onCrush`, `onNoise`, `onLoot`, `attach` (true),
`id` (the game entity, `'destructibles'`).

## Material classes

Damage is `damage x armour[kind]`; kinds are `bullet`, `pellet`, `blast`, `melee`, `emp`, `fire`. `pierce` is the share
of a bullet's or pellet's damage that goes on through (up to `maxPierce` props). Stages start at a share of health
lost; each stage's mark is put where each later hit lands.

| class | health | armour (bullet / pellet / blast / melee / emp) | pierce | stages | breaks into |
|---|---|---|---|---|---|
| `glass` | 40 | 1 / 1 / 2 / 1.5 / 0 | 0.85 | a radial crack per hit place, growing with the damage | glass shards (thin, lie flat), glints; a pane leaves a jagged rim (`'pane'`, by default when the box is flat) |
| `paper` | 8 | 1 / 1 / 2 / 1 / 0 | 0.95 | holes | flakes, scraps |
| `wood` | 60 | 0.8 / 0.7 / 1.5 / 1.2 / 0 | 0.2 | holes, then splinter gashes at 55 % | chunks, splinters, dust; `broken: 'crate'` splits it |
| `cardboard` | 25 | 1 / 1 / 1.6 / 1.3 / 0 | 0.7 | holes | flakes, dust |
| `plastic` | 30 | 1 / 1 / 1.4 / 1 / 0 | 0.5 | holes | chips |
| `thinMetal` | 70 | 0.6 / 0.5 / 1.2 / 0.8 / 0.2 | 0.3 | dents, a dented panel at 60 % | bolts, sparks; stays dented |
| `heavyMetal` | 400 | 0.15 / 0.1 / 0.8 / 0.2 / 0.3 | 0 | dents, dented at 50 %; blocks blasts (x0.25 behind it) | bolts, sparks |
| `ceramic` | 15 | 1 / 1 / 2 / 1.5 / 0 | 0.1 | cracks | shards, dust |
| `liquid` | 20 | 1 / 1 / 1.5 / 1 / 0 | 0.4 | holes that spray | splash, a spreading puddle (`spillLiquid` by default) |
| `electronics` | 40 | 1 / 0.8 / 1.5 / 1 / 4 | 0.2 | holes with sparks, its lamps stutter at 30 % | a short circuit (sparks and smoke), lamps out |
| `fabric` | 20 | 0.9 / 0.9 / 1.5 / 0.8 / 0 | 0.9 | holes | flakes, fibres |
| `actor` | 50 | 1 / 0.9 / 1.5 / 1 / 2 | 0 | sparks | a slump (no debris) |

All of it is data (`DESTRUCT_MATERIALS`, `DESTRUCT_EFFECTS`): override a field per class with
`options.materials.glass = { health: 25 }`, per prop with the spec, or add a class of your own (it starts from
`plastic`). Sounds are made in code (`addDestructSounds(audio)`; `dx_break_<class sound>`, `dx_hit_tick|ping|zap|thud`,
`dx_boom`, loops `dx_alarm`, `dx_hiss`, `dx_fire`).

## Behaviours

| behaviour | defaults | what happens |
|---|---|---|
| `explosive` | delay 0.4 s, radius 4, damage 180, linear, occlusion | a delayed blast at its centre: other props, a scorch, `'blast'` (`onBlast`) for the game's entities, noise 40 m |
| `spillLiquid` | radius 0.9, grows over 1.4 s, slippery | a puddle on the floor; `surfaceAt(p)` says slippery / conductive |
| `ventSteam` | 10 s, radius 0.8, height 2.6, density 2.4 | a steam emitter where it was hit, a hissing loop, an occluder: `visibility()` drops through it |
| `sprayWater` | 8 s, radius 0.5, density 0.9 | the same with a water jet |
| `dropLoot` | chance 1, table `[{ id, weight }]` | `'loot'` (`onLoot`) with the pick, at its centre |
| `alarm` | radius 30, 8 s, on the first hit | `'noise'` (`onNoise`) for AI, an alarm loop, its lamps flash |
| `fall` | damage 60, radius 0.9 | a hung sign cut loose drops (gravity, a bounce), crushes what it lands on (`'crush'`), stays there |
| `chain` | delay 0.09 s | the next unbroken prop of its `group` on each side goes after the delay: bulb strings pop in sequence |
| `burn` | 4 s, caught by blast or fire or below half health, then `'break'` or `'explode'` | a fire emitter, `'fire'`, then it breaks (or goes off) |

## Movers

Small loose props (cans, bottles, cups, boxes) given `mover: { shape }` are knocked about instead of (or before)
breaking: a hit pushes and spins them; a cheap kinematic step (no rigid body) drops them on the floor, rolls a lying
cylinder about its axis, tips an upright one past 20 degrees, bounces them off `colliders` and solid props, looks
for the floor again as they go (off a shelf) and puts them to sleep when still. An instance moves as a pooled copy
(one extra `InstancedMesh` per source mesh, made on first use) and goes back into its instance at rest. `breakable:
false` never breaks (a can); otherwise a hit of its health or more breaks it.

## Budgets

Debris live count (`maxDebris`), pieces spawned per step (`maxSpawnPerStep`; the rest are dropped and counted in
`stats.spawnDropped`), marks (`maxDecals`, the oldest goes), persistent emitters (`maxEmitters`), sounds and bursts per
step. `detail` (0..1) scales debris counts, the live caps (down to a quarter), marks and bursts: tie it to the quality
level. Debris and marks are pooled instanced meshes with no shadows, out of the planar, probe, environment and bounce
captures (`mgNoCapture`, `mgDynamic`), and the step and draw allocate nothing.

Measured: Node, 900 props, 17 rounds a frame (1000 a second) and a blast every third of a second: 0.7 ms a frame
mean, 3 ms worst, debris held at 600, marks at 96, heap flat (+0.2 MB over two more seconds). Chrome (M-series GPU,
960 x 600) in the demo: idle 4.3 ms a frame with the range registered against 4.3 to 4.8 ms with no registry (inside
the run-to-run spread); 1000 rounds a second over 400 extra props 7.5 ms mean, 11.6 ms p95.

## Instancing recipe

The registry hides and shows what is drawn without splitting draw calls:

- an `InstancedMesh` instance: `{ mesh, index }`; hidden by a zero-scale matrix (one 64-byte update range), shown by
  the saved matrix. A thousand bottles in one mesh are a thousand props and one draw call.
- a `BatchedMesh` instance: `{ mesh, id }`; `setVisibleAt`. Actors pose their parts through `setMatrixAt`.
- a merged mesh (`geom.MeshBatch`): note each prop's vertex range while you build (non-indexed: read the batch
  group's vertex count before and after the builder call) and pass `{ mesh, range: [first, count] }` per material
  mesh it spans (a list). Hiding collapses the range onto its first vertex (degenerate triangles); the hit volume
  comes from the range's bounds or a `box` you give.
- the broken look comes from one `InstancedMesh` per broken kind and material (a shattered pane rim, a split crate,
  a dented panel, a flat tyre), placed on the prop's box.

## Save / restore

`snapshot()` is small (`{ v, steps, broken: [id | [id, stage]], hurt: [[id, health, stage]], moved: [[id, x, y, z,
qx, qy, qz, qw]] }`, about 100 bytes for a handful of broken props). `restore(s)` resets, then breaks the listed
props quietly (no debris, sound or events; lamps out, broken states shown, puddles full, endless vents back), sets the
hurt props' health and puts moved props where they lay; the tally is rebuilt from the broken set. Two registries
with the same seed given the same hits in the same steps agree step for step (`d.hash()`): debris draws from the
seeded stream; cosmetic draws (sound pitch, mark rotation) from another, so audio or particles on or off change
nothing.

## Worked example

```js
const d = createDestructibles(g, { seed: plan.name, vfx, lamps: world.lampPool, detail: quality === 'low' ? 0.4 : 1 });
// a shelf of bottles in one InstancedMesh, cans that roll
for (let i = 0; i < bottles.count; i++) d.add({ id: 'bottle' + i, draw: { mesh: bottles, index: i }, material: 'glass', health: 6, value: 9, tags: ['bar'] });
for (let i = 0; i < cans.count; i++) d.add({ id: 'can' + i, draw: { mesh: cans, index: i }, material: 'thinMetal', mover: { shape: 'cylinder', breakable: false } });
// a bulb string: each bulb owns its pool lamp; neighbours pop in sequence
bulbs.forEach((b, i) => d.add({ id: 'bulb' + i, draw: b.mesh, material: 'glass', health: 4, group: 'string-1', lamps: [b.lamp], emissive: b.mesh.material, behave: { chain: true } }));
// the stall's gas can: catches fire in a blast, burns, goes off
d.add({ id: 'gas', draw: gasCan, material: 'thinMetal', health: 60, behave: { burn: { then: 'explode' }, explosive: { radius: 4, damage: 200 } } });
// the owner's signs never break
for (const s of ownerSigns) d.add({ id: s.id, draw: s.mesh, material: 'glass', protected: true, tags: ['owner'] });
// bystanders in a BatchedMesh
robots.forEach((r) => d.actor({ id: r.id, parts: [{ draw: { mesh: shell, id: r.legs } }, { draw: { mesh: shell, id: r.torso }, lag: 0.1 }, { draw: { mesh: shell, id: r.head }, lag: 0.25 }],
  pos: r.pos, onPanic: (it, from) => r.flee(from) }));
d.on('casualty', () => game.set('civilians', (game.flags.civilians || 0) + 1));
d.on('blast', (e) => { for (const en of enemies) { const k = e.cover(en.chest); if (k > 0) en.hurt(e.damage * k * falloff(en, e)); } });
d.on('noise', (e) => ai.hear(e.point, e.radius));
```

## Limits

- Debris has no collision except the floor (it falls through walls it is thrown at); `physics: true` with a kit gives
  a prop up to two real bodies for its big pieces.
- A merged-range prop can break but not move (movers need an `Object3D`, an instance or a batched id).
- `fall` moves an `Object3D` or an instance; the sign's own lamp, if any, goes out when it falls.
- Rays use the registry's own grid, not Rapier; `options.sensors: true` also registers Rapier sensors for kit
  queries (`kit.ray(..., { sensors: true })` then `d.fromCollider(hit.collider)`).
- Steam and spray block sight through `visibility()`; they do not stop bullets.

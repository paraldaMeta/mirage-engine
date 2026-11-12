# Destructibles in neon-district: a migration note

How `examples/neon-district` can adopt [destructibles](destructibles.md). This note is a plan; the example is not
changed by it. Line numbers are those of the example when this note was written.

Weapon numbers it has to fit (`game/arms.js`): sidearm 21, carbine 22, gatling 11 a round; shotgun 9 pellets of 12
(falloff to 30 % from 7 to 22 m); rocket 220 with a 5.5 m splash; melee 85. The EMP grenade stuns only (an `emp` hit of
0 damage today; give it a damage number if electronics should die to it).

## Wiring (game side)

- `game/index.js` `setup`: `const d = createDestructibles(ctx, { seed: plan.name, vfx, lamps: (i, k) => { lamps.scale[i] = k; lamps.touch(); }, detail })`.
  The example keeps its own lamp list (`game/lamps.js`: `base x scale`, flushed once a tick) instead of setting the
  pool's records, so route lamps through that function, not `world.lampPool.scale`. Pool indices are what
  `lamps.base` holds (`shared.pool` order).
- `game/weapon.js` `cast()` (:124): keep `physics.ray` for the world distance `wt` and `targets.rayHit` for enemies; add
  `const dr = d.hit({ ray: { origin: o, dir: dv, max: eh ? eh.t : wt }, kind: pellets > 1 ? 'pellet' : 'bullet', damage: A.damage * fall, source: 'player', occlude: false })`
  before the enemy hit (a prop in front of an enemy takes the round; `dr.left` is what goes on: multiply the
  enemy's damage by `dr.left / damage` when `dr.count`). Pick the impact by `dr.hits[dr.count - 1].class`
  (`glass` -> `nd_imp_glass`). Melee (:330): `d.hit({ ray, kind: 'melee', damage: 85, pierce: false })` over 2.3 m.
- `explode()` (:272): `d.blast({ point: p, radius: ARM.rocket.splash, damage: ARM.rocket.damage, falloff: (x) => Math.max(0.12, 1 - x ** 1.3) })`.
  Let `d.on('blast', ...)` hurt enemies and the player for the props' own explosions (fuel, gas can) with the same
  `blastAt` code, using `e.cover(c)` instead of its own `physics.ray` check, so cover is the same for both.
- `d.on('noise', (e) => targets.noise(e.point, e.radius))` (alarms, breaks, blasts wake the robots);
  `d.on('loot', (e) => ammo.drop(e.point, 1))` needs `drop` exposed on `ammo.js`'s API (:123; today internal, :44).
- `d.on('break', ...)` for the HUD's property damage (`d.tally.value`), `d.on('casualty', ...)` for civilians.
- Saves: automatic (the registry is the game entity `'destructibles'`; checkpoints `g.save('auto')` carry it).
  `hack.js`'s `load` resets lamps to `scale = 1`: make it run before the registry's restore, or re-apply the broken
  lamps after it (`d.restore(d.snapshot())`).
- `steam` (`game/index.js:223`) is FX only; a vent that blocks sight would register as a prop with `ventSteam`
  `duration: 0` (endless) and `protected` false, or the AI can read `d.visibility()` for the vents a player shoots open.

## Per prop family

Builders today record no per-prop handles: merged batches (`geom.MeshBatch`, non-indexed, one mesh per material key)
lose the vertex ranges, and `lamp()` (`modules/lib.js:15`) returns null for pool lamps. Each builder below must expose,
per prop: its id, its box (centre, half, yaw), the draw handles (instance index, or the vertex range per material mesh
it spans: read `batch.groups.get(mat.uuid + '+c').verts` before and after the call), its pool lamp indices
(`shared.pool.length` before `lamp()`) and its collider proxy (tag `proxy.userData.destructible = id`; with `solid`
the registry makes its own collider, so drop the proxy or keep it and leave `solid` off).

| family | where | class, health, value | behaviours, broken | the builder must expose |
|---|---|---|---|---|
| vending machines (9) | `modules/vending.js` `machine()` :35-131 | `electronics`, 120, 1500 | `spillLiquid` (conductive), `lampMode: 'flicker'`, `dropLoot` (cans) | each machine's box, its glass range in `vending-glass`, its body range in `vending-body`, its pool lamp (:141, :147), its proxy (:133) |
| their glass fronts | `vending-glass` batch | `glass`, 40, 150 | `'pane'` | the range per machine (one material key) |
| vending products | `vending-can|bottle|cup|box|pack|cap` InstancedMesh | cans `thinMetal` mover `breakable: false`; bottles `glass` 6; cups `plastic` 5 mover; boxes `cardboard` 8, 3 each | — | `items[shape]` index ranges per machine (snapshot `items[k].length` around each call); the 2 ground cans (:152) |
| bar bottles | `modules/bar.js` :61-69 (shelf), :82-87 (counter) into `bar-props` | `glass`, 6, 18 | — | move them out of the merged batch into one InstancedMesh per shape (`props-goods.js` shapes), or record ranges; positions from the loops |
| bar bowls, pots | `bar.js` :77, `props-goods.js` | `ceramic`, 10, 12 | — | as bottles |
| stall jars, bottles | `streetlife.js` :53 `stall-goods` | `glass` / `ceramic`, 6, 8 | — | as bottles |
| paper lanterns | `props-lights.js:26`; bar :104-113, cart `clutter.js:73`, stall `streetlife.js:66` | `paper`, 8, 20 | `burn` (catch on fire), lamps | per lantern range in its module batch; the bar's 3 real ones are PointLights (`anchors.lanterns[i].light` -> `lights`); shared pool lamps (door :110, cart :75, stall :77) belong to the group: give the lamp to the last lantern standing (`chain` with a delay of 0 does not apply: register a `group` and switch the lamp in `onBreak` when all are broken) |
| bulb strings | `props-lights.js:43 bulbString`, `street.js:92-102` | `glass`, 4, 2 a bulb | `chain` (`group` per string, delay 0.08) | `pts[1..n-1]` per string (today only the midpoint is passed on), each bulb's range or a separate InstancedMesh of bulbs; one pool lamp per string (:98-101): give it to the middle bulb, or split the string's lamp into 2-3 |
| neon tubes | `props-lights.js:95 tubeFixture`, `fx.box(M.neon.*)` strips in bar, street, plaza, relay, adverts | `glass`, 12, 300 | `lampMode: 'flicker'` | the range per tube in each batch; neon materials are shared (`materials.js:240`): use per-tube vertex colour or an `emissive` of `{ mesh, index }` if made instanced, not the shared material |
| signs | `modules/signs.js` :16-61, faces in `sign-faces` (one Mesh each, own `mat.glow` clone) | `glass` (face), 30, 400 | `lampMode: 'flicker'`; the hung ones `fall` | the face mesh (an `Object3D`: the easy case), the sign's anchor (text), its pool lamp (:33/:39, or the indoor PointLight when `bare`) |
| LED walls | `signs.js` :43-60 `led-wall` | `electronics`, 200, 2500 | 2 pool lamps, `lampMode: 'flicker'` | the mesh and its two pool indices |
| adverts | `adverts.js` `advert-housings/lit/screens` | screens `electronics` 80, 800 | lamps (:115, :148) | ranges per advert |
| street lamps (10) | `street.js:24-29`, `props-lights.js:61` | lens `glass` 15, 200; post `heavyMetal` protected-ish (leave it out) | lamps | the lens range in `street-props`; the light: a PointLight at medium / high quality (return value of `lamp()` discarded today) or a pool index at low; `hack.js:53` already maps `'lamp' + i` by order |
| shop windows | `shopfronts.js:61` `shop-glass` (one plane per open bay) | `glass`, 40, 400 | `'pane'` (the plane is flat) | the plane's range per bay (6 vertices each, non-indexed), the bay's pool lamp (:69) |
| bar windows | `bar.js:33-35` `bar-window` (Meshes + proxies) | `glass`, 40, 400 | `'pane'`, `solid: true` | the Mesh (easy) |
| car glass | `cars.js` `cars` batch, `CM.glass` | `glass`, 30, 300 | `'pane'` per window | ranges per window |
| car tyres | `cars.js:245 wheel()` into `street-props` | `plastic` (armour bullet 0.7), 40, 150, sound `fabric` | `'tyre'` | ranges per tyre, its box (axis across the car) |
| car bodies | `cars.js` `cars` batch | `thinMetal`, 500, 6000 | `alarm` (radius 35, 10 s; the shared `alarmLight` and `nd_caralarm` of `hack.js:72`), `'dent'` stage | the body range, the car's box (two proxies, `carBox` :233), its 2 pool lamps (:231 underglow, :235 tail) |
| crates | `props-street.js:33`; `street.js:74-77` (5), `grime.js:63-66` (3), `relay.js:96` (3) | `wood`, 70, 25 | `'crate'`, `solid: true` | range + box per crate; their proxies |
| ammo crates | `game/ammo.js:62-71` Groups | leave them out (pickups) | — | — |
| cardboard boxes | `clutter.js:32` into `clutter-props` | `cardboard`, 25, 4 | `dropLoot` for a few | range + box per box (random in the heaps: record as placed) |
| trash bags | `clutter.js:31`, `grime.js:59-62` | `fabric`, 20, 1 | — (no `broken`: just gone, flakes) | range + box per bag |
| barriers | jersey `street.js:40-41` (2 proxies each), A-frames `grime.js:79-85` (glow beacon), bollards `street.js:62-66` | jersey `heavyMetal` 2000 (effectively cover; blocks blasts), A-frames `plastic` 60 with the beacon as `emissive`, bollards leave out | — | ranges, boxes, proxies |
| AC units | shopfronts `props-street.js:74` at :100 into `shop-props` | `thinMetal`, 90, 350 | `'dent'`, `ventSteam` (short, 3 s) | range + box per unit; facade AC units (`facades.js:58,149`, kit instances spread over several InstancedMeshes) are not one instance per unit: leave them out |
| stall gas can | does not exist yet | `thinMetal`, 60, 80 | `burn: { then: 'explode' }`, `explosive: { radius: 4, damage: 200 }` | add the prop to the stall (`streetlife.js`) as its own Mesh |
| steam pipes | `grime.js:33-56` (merged into `fx`) | `thinMetal`, 50, 60 | `ventSteam` (10 s) from the hit, `sprayWater` for water pipes | the pipe segments' ranges and boxes |
| bystander robots | `modules/machines.js`, `BatchedMesh` `machines-shell/lights/umbrellas` | `d.actor`, 50 | casualty, panic (walkers flee from `from`) | the per-robot ids (`r.torso`, `r.head`, legs; :361/387/409 are closure-private): expose them, and call `d.place(id, pos)` from the walkers' update; the `machines-lights` ids as `emissive: { mesh, id }` |

## Never breaks: `protected: true`

| what | where | how to find it |
|---|---|---|
| the mission door | the two hinged leaves of `game/index.js:149-169` (`physics.hinge`, entity `'door'`), anchor `relay.js:165`; the frame is in the solid `relay` batch | do not register the leaves; if a family registration sweeps the relay batch, skip the door's range |
| the pass (keycard) | `game/index.js:135-147`, a Group at `plan.bar.pass`, on the bar counter among the bar props | register it `protected` (so a shotgun at the counter cannot take it), or keep the bar bottles' boxes clear of it |
| the uplink terminal | geometry `relay.js:136-139` (merged into `relay`), anchor `consoles` :168, entity `'uplink'` (`index.js:172-179`), its pool lamp | `protected`, or leave it out; its pool lamp must not be owned by any prop |
| the stairs | `relay.js:47-56` slabs in `relay`, rails in `relay-decor` | leave out of every registration |
| the owner's five wall signs | `plan.js:43` (sw, 他抄由他抄…), :47 (s1, 视频号：AI乐子人灰叔), :56 (s3, 视频号…), :69 (c, 他抄由他抄…), :70 (c, 视频号…); faces in `sign-faces` (`signs.js:19-22, 35-37`) | match by the anchor's `text` (contains `视频号` or `他抄由他抄`), register the face `protected: true, tags: ['owner']`, and give the sign family registration a filter that skips them; `hack.js` overload darkens them today (all five are below y 9.5): that is a hack, not a break, and stays |

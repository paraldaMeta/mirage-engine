# Notes between modules — agent-trial

Convention: `docs/world-protocol.md` §5. Each module owns one `## <module>` section; only its owner writes there.
Re-read the whole file before editing. Append dated entries; never rewrite another section, never delete (write
"superseded by …"). Requests to another module go in your own `### Requests` list, addressed by name; the
addressee answers in its own section. Numbers, not adjectives. Build order: shore, pier, lighthouse. Module briefs: BRIEF.md § Modules.

## lead

Owns `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js`, `game.js`, `scenarios/playtest.json`. Plan changes are
requested here (`### Requests` in your section, addressed to **lead**) and announced here with a date.

Shared materials (`modules/materials.js`): `stone`, `timber` (grain along z), `post` (grain up), `iron`, `plaster`.
The game (`game.js`, lead) puts a lantern on every `lamps` anchor, a lever on `levers`, the lamp and its beam on
`beacon`; modules build posts and walls only, no lanterns.

- 2026-10-25 (answers **shore**'s requests): `plan.lampPost.h = 3.6` added; lead edited the two local constants
  (`POST_H` in shore, `LAMP_H` in pier) to read it — a tiny fix, no other change. The walker overhang bug is fixed
  in the engine (`packages/play/src/walker.js`: a falling walker no longer moves into a place its body does not
  fit; it lands on the edge; test in `packages/play/check.mjs`); shore's proxies may stay.

## shore

2026-10-25 — built (`modules/shore.js`, 42.1 k tris, 6 materials: stone, timber, iron shared; wall, water, land local).
Self-test `scenarios/shore.json` passes on `?modules=shore` (flicker 1.3, 3.3 ms/frame).

- Sea: 6 km plane at y 0 (`collide = false`); seabed plane at `seawall.bottom − 0.02` (−3.02), `collide = false`.
- Seawall face: x −2 … −1.6, y −3 … 2.39 (wet band below ~1 m); paving slab x −1.99 … 10, top 2.4 (= `shore.y`).
- Coping string course: x −2.14 … −1.98, y 2.16 … 2.34, only for |z| > 2.3 (none in the pier opening).
- Parapet: x −2 … −1.6, top 3.3, cap 0.48 wide; end piers at the opening z −2.79 … −2.29 and 2.29 … 2.79, top 3.48.
  Proxy x −2.07 … −1.53, top 3.7 (no jumping over). Opening z −2.3 … 2.3 clear down to the paving.
- Land wall x 10 … 10.6, cap top 3.74; proxy x 9.95 … 15, top 5.4 (the land strip inside bounds is not walkable).
- Land: heightfield east of x 10.6 at 3.7 rising into hills 10–80 m between x 30 and 150; coastal flanks for |z| > 30
  flush with the promenade at z ±30, the coast bending west; 90 rocks along the waterline at |z| 31 … 271. All
  `collide = false` (outside the walkable promenade).
- Benches (3) at `shore.benches`: seat 1.8 m along z, top 2.84; backrest top ≈ 3.3; proxies make each bench a solid
  step (seat 0.46, back 0.94): a walker can climb onto one but never leave the promenade.
- Lamp posts (2) at `shore.lamps`: iron lathe, ring top 3.6 m above the paving (y 6.0, same as pier); proxy 0.34 m.

Plan fields read: `shore.*`, `bounds[2]`.

| key | pos is | extra | count |
|---|---|---|---|
| `lamps` | the top ring of an entrance lamp post, (x, 6.0, z) at `shore.lamps` | `kind: 'post'`, `rotY` 0 (z < 0) / π (z > 0): faces the pier axis | 2 |
| `seats` | the paving point under a bench centre, (9.4, 2.4, z) at `shore.benches` | `rotY` −π/2 (faces west, −X) | 3 |

Keep clear: x −2.07 … −1.53 for |z| > 2.29 (parapet + proxy); x ≥ 9.95 (land wall + proxy).

### Requests

- **lead** (2026-10-25): lamp post ring height 3.6 m above the deck/paving is now a local constant in both shore
  (`POST_H`, `// TODO plan`) and pier; consider `plan.lampPost.h = 3.6`.
- **lead** (2026-10-25, engine FYI): `packages/play/src/walker.js` — a walker in the air whose disc overlaps a cell
  whose floor has a ceiling lower than `head` above it (under a 4 cm cap overhang, under a bench seat) gets
  `fits() === null` and never lands: it falls through the world (seen: y −11 after jumping at a bench). Shore works
  around it with proxies; any overhang a jump can reach (rails, plinths) will hit it.

## pier

2026-10-25 — built (`modules/pier.js`, 9.0 k tris, 4 materials: shared timber/post/iron + local `railWood`
(timber, grain along x) for joists, fascia and rails).
- Deck: 267 boards across the run (x −2 … −58, z ±2, ≈ 0.20 m wide, 1 cm gaps, 5 cm thick, top 2.4 − 0…4 mm),
  57 boards along z on the head (x −70 … −58, z ±6). Joists 0.1 × 0.2 under the boards, pile caps 0.26 × 0.3 under
  the joists (cap bottom = pile top ≈ 1.85). Fascia boards on every deck edge, 0.24 m deep, top 2.38.
- Piles: r 0.18 (1.08× at the foot), from `pier.seabed` −3 to the caps. Run: bents every 4 m at x −6 … −54, z ±1.75,
  X-bracing y 0.3 … 1.7, a waling at y 0.9 each side. Head: 4 × 4 grid (x −69.7 … −58.3, z −5.7 … 5.7, 3.8 m).
- Rails: centre line 8 cm inside the deck edge (run z ±1.92; head x −69.92 / −58.08, z ±5.92), posts 0.12 m
  every ≈ 2 m, handrail top at deck + 1.05, mid rail at +0.5, kick rail at +0.14. Head east rail is open for z ±1.92
  (where the run joins). Run rails start at x −2.1 (10 cm onto the promenade).
- Lamp posts: iron lathe 3.6 m, at x −8, −20, −32, −44, −56 on z +1.92, −1.92, +1.92, −1.92, +1.92 (in the rail line,
  replacing a rail post).
- Collision: closed proxies — deck slabs top 2.4 (run x −58 … −1.9, head x −70 … −58), rail boxes 0.24 thick,
  1.15 high, 0.24 longer than each rail line. Walkers stop ≈ 0.3 m short (run walkable z ±1.5, head ±5.5).
- Plan fields read: `pier.*`, `footprints.pierHead`. Local (module-only) constants: board / joist / cap sizes,
  rail post spacing 2 m and inset 0.08, lamp post height 3.6, first lamp at `pier.x0 − 6`.

| key | pos is | extra | count |
|---|---|---|---|
| `lamps` | the lantern ring = top centre of each pier lamp post (x, 6.0, ±1.92) | `kind: 'post'`, `rotY` 0 (z > 0) / π (z < 0): faces out over the sea | 5 |

Keep clear: the deck volume x −70 … −2, z ±2 (run) / ±6 (head), y 2.4 … 8, except the rail lines. For **shore**: the
parapet opening z ±2.3 leaves 0.26 m between my rail proxy (to z ±2.04) and the parapet end — too narrow to pass,
so no gap at the joint; my deck proxy overlaps the promenade by 0.1 m at the same top 2.4 (invisible).

### Requests

none.

## lighthouse

2026-10-25 — built (`modules/lighthouse.js`, 7.5 k tris, 6 materials: shared stone/plaster/timber/iron + local
`red` band plaster and `glass`). Centre (−64, 0); deck y 2.4.
- Plinth: stone cylinder r 2.8, top 2.7 (sunk 2 cm into the deck). Shaft: closed plaster lathe r 2.6 at 2.7 →
  linear taper to r 1.9 at the gallery (16.4); shaft solid ends at 15.8. Stone foot course 2.7–3.03 (4 cm proud).
  Red band 10.8–12.2 (deck +8.4 … +9.8, 2 cm proud). Windows (stone frame, dark pane): east at y 8.0, azimuth
  216° (south-west) at y 13.0.
- Door: shut timber leaf 1.0 × 2.1 m, sill at `points.lighthouseDoor` (y 2.7), face 8 cm proud of the shaft
  (x ≈ −61.32), stone jambs and lintel. Lever plate: iron 0.22 × 0.42 × 0.26, face at x −61.70, boss to the pivot.
- Gallery: corbel lathe + 20 brackets 15.5–16.14, stone slab r 2.55 top 16.4, iron railing r 2.45, 1.05 m.
  Lantern: white drum 16.4–17.0 r 1.38–1.44, glazing r 1.3 17.0–19.4 (10 mullions, 3 rings), iron dome to 20.54,
  ball, vane (seeded heading) at 21.6. Lens: glass lathe r 0.5 × 1.0 m on an iron pedestal (mesh `lighthouse:lens`).
- Collision: plinth + shaft + door + plate are solid (walkers stop at x ≈ −61.0 east, r ≈ 2.9 around; the 0.2 m
  plinth ring is too narrow to stand on). Everything from the gallery up is `collide = false` (above walk.yMax).
- Plan fields read: `lighthouse.*`, `pier.y`, `points.lighthouseDoor`, `points.lever`. No local positions.

| key | pos is | extra | count |
|---|---|---|---|
| `levers` | the lever's pivot = `points.lever` (−61.65, 3.5, 1.3), 5 cm in front of the plate face | `rotY` π/2 (east) | 1 |
| `beacon` | the lens centre (−64, 18.2, 0), middle of the glazing | `rotY` π/2 | 1 |

Keep clear: the plinth circle r 2.8 (footprint `lighthouse`).

### Requests

none.

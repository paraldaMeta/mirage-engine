# Sprite Yard

The 2.5D kit ([docs/sprites-25d.md](../../docs/sprites-25d.md)) on a small world: a yard between three houses, a
low wall, crates and a lamp. The figures are placeholder atlases drawn in code (`makePlaceholderAtlas`), so there is
no art file in this folder; `?atlas=<url of an atlas.json>` loads real art for the hero (a placeholder if it fails).

- Click the ground: the hero walks there (`pickWalkGrid` + `reachableGoal`: a crate's top or a house sends it beside
  them). Click a creature: the hero walks up and strikes; the blow lands on the atlas's hit frame.
- Right-drag or Q / E turns the iso camera, the wheel zooms, two fingers twist and pinch.
- Walk behind a house: the cutaway opens the walls and roofs in front of the hero, and the silhouette shows it
  through what is left.
- `?time=night` (the lamp lights the figures), `dusk`, `noon`.

```sh
npm run dev -w sprite-yard        # or: npm run build -w sprite-yard
```

`window.__mirage.play` is a small adapter with the parts of a `createPlay` object the repository's still tools use
(`stop`, `step`, `place`, `viewpoint`, `render`); `place` and `viewpoint` reset the simulation, so a still repeats.

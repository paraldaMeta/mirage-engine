# @miragekit/editor

A visual editor that runs in the browser against a live Mirage world: a viewport with fly/orbit camera, click
selection and move/rotate/scale gizmos; a hierarchy, an inspector whose fields come from the plan schema, an asset
browser, a console with the diagnostics codes, undo/redo for every edit, play-in-editor, and a timeline. Plain DOM,
no framework. Experimental and opt-in.

```sh
npx mirage-editor examples/hello-courtyard            # read-only towards the disk: saves stay in memory
npx mirage-editor examples/hello-courtyard --write    # Save writes examples/hello-courtyard/plan.edits.json
```

What it saves is data, never code: an edit layer (`plan.edits.json`) of overrides on the plan, placed objects, node
overrides, environment settings and timelines. The project applies it on load with a few lines:

```js
import { editable } from '@miragekit/editor/runtime';
import edits from './plan.edits.json';                       // {} until the first save

const ed = editable(plan, edits);
const world = createWorldRenderer({ ..., lighting: ed.lighting(lighting) });
const built = await buildWorld(world, { plan: ed.plan, modules, shared });
await ed.apply(world, built);                                 // placed objects, node overrides, environment
const play = createPlay(world, { plan: built.plan, ... });
ed.attach({ world, built, play, rebuild: (p) => ({ plan: p, modules, shared }), makePlay: (o) => createPlay(world, { ...o }) });
```

With an empty layer every one of those calls does nothing (`ed.plan` is the plan object itself), and outside
`mirage-editor` `attach` returns false. The page a visitor gets is `?editor=0`, or simply the project's own build.

The server listens on 127.0.0.1 only, checks Host and Origin on every request, needs a per-run token for POSTs,
and writes exactly one file, fixed when it starts, inside the project, and only with `--write`.

The guide, the keyboard sheet, the list of object types, the measured numbers and what Unity and Unreal editors
have that this one does not: [`docs/editor.md`](../../docs/editor.md).

Checks: `node check.mjs` (data model and the server's refusals, Node only) and `node editor-check.mjs` (a headless
browser drives the editor on two examples: select, gizmo drag, undo, save, reload, compare).

# In-game UI toolkit

Experimental, opt-in. `createUI` (the overlay `startGame` makes) is unchanged and stays the default; nothing here
loads unless a game imports it. No dependencies: the DOM, `Intl`, and three for the world and texture parts.

| module | what it holds |
|---|---|
| `@miragekit/game/ui-kit` | `createUIKit`, `h` / `each` / `show`, layout (`stack`, `row`, `grid`, `anchor`, `safeArea`), themes, colour maths |
| `@miragekit/game/ui-reactive` | `signal`, `computed`, `effect`, `batch`, `store`, `scope` |
| `@miragekit/game/ui-widgets` | the widget set and the modal, dialogue, toast and radial services |
| `@miragekit/game/ui-nav` | `createFocusNav`, `nextFocus`, `glyphFor` |
| `@miragekit/game/ui-i18n`, `ui-locales` | `createI18n`, `wrapText`; English, Traditional Chinese and Arabic tables |
| `@miragekit/game/ui-world` | `createWorldUI`: labels, markers, health bars at 3D points |
| `@miragekit/game/ui-canvas` | `createCanvasUI`: a panel drawn into a texture (screens in the world, XR) |
| `@miragekit/game/ui-menu` | `createKitUI`: the pause menu and start screen on the toolkit; `TouchControls` |

The six `create*` functions are also exported from `@miragekit/game`.

## A HUD in twenty lines

```js
import { createUIKit, signal, h, anchor, stack } from '@miragekit/game/ui-kit';
import { Bar, Button, Prompt, modals, toasts } from '@miragekit/game/ui-widgets';

const kit = createUIKit({ input, theme: 'dark' });          // input: createInput's, for glyphs and the gamepad
const hp = signal(80);
kit.mount(anchor({ at: 'bottom-start', offset: [1, 1] },
  stack({ gap: 0.4 },
    h(Bar, { value: hp, max: 100, tone: 'health', label: kit.tx('hud.health') }),
    h(Prompt, { action: 'interact', label: kit.tx('hud.open') }))), 'hud');
hp.value = 55;                                              // one style write next frame; no re-render

const menu = modals(kit).open((close) => stack({ gap: 0.5 },
  h('h2', null, kit.tx('menu.paused')),
  h(Button, { label: kit.tx('menu.resume'), variant: 'primary', onPress: () => close() })), { label: 'Pause' });
toasts(kit).push({ text: 'Saved', tone: 'good' });
// each frame: kit.update(now)   (or kit.autoUpdate() for its own requestAnimationFrame)
```

A description is plain data: `h(tag or component, props, ...children)`, text, arrays, or a function. Any prop, style
property, class flag or child may be a signal or a function; each is bound on its own, so a change writes that one
attribute and nothing is diffed. `each(list, key, render)` keeps one row per key and moves rows when the order
changes; `show(when, render, { transition })` mounts and unmounts with an enter / leave transition. A component is
`(props, ctx) => description`, run once.

Layers, back to front: `world`, `hud`, `modal`, `toast`. The root is `pointer-events: none`; widgets opt in, so the
canvas keeps its input.

## Layout, themes, scale

`stack` / `row` (flex), `grid`, `anchor({ at: 'top-end' })` (nine points; start / end follow the text direction),
`safeArea` (the notch insets). Sizes are in em: the root font size is `computeScale(width, height, { reference:
[1280, 720], min, max })` x `kit.textScale`, so the whole UI follows the screen and the player's text-size setting
with no per-widget code.

Themes are token tables turned into CSS custom properties: `THEMES.dark`, `light`, `contrast`, `colorblind`;
`kit.setTheme(name or { token: value })`. `kit.setMotion('reduced')` (default `'auto'`: follows
`prefers-reduced-motion`) removes movement and keeps short fades.

## Widgets

`Button`, `Toggle`, `Slider`, `Select`, `Tabs`, `TextInput`, `Progress`, `Bar` (health / stamina with a damage
ghost and a low-value state), `Tooltip`, `VirtualList` (only the rows in view exist: 10 000 items, a few dozen
nodes), `InventoryGrid` (drag and drop by pointer and touch; pick up / put down with confirm on keyboard and
gamepad; stacks merge), `MinimapFrame`, `ObjectiveTracker`, `RebindList` (the rebinding screen over `input.rebind`),
`Glyph`, `Prompt`. Services, one per kit: `modals(kit)` (a stack; the top one traps focus), `confirm(kit, ...)`,
`dialogue(kit).say({ speaker, text, choices })` (typewriter by grapheme, so CJK and emoji never split; resolves with
the choice), `toasts(kit)`, `openRadial(kit, { items, onPick })` (stick, mouse or touch). The pure halves are
exported for tests: `virtualRange`, `moveItem`, `radialIndex`, `revealCount`.

## Focus, gamepad, glyphs

`kit.nav` is a `createFocusNav`. Arrows and the D-pad / left stick move focus spatially (`nextFocus`: the nearest
element in that half-plane, alignment weighted; `data-nav-up="#id"` overrides, `data-nav="skip"` excludes), Enter /
A activates, Escape / B goes back, Q / E and the bumpers change tab. `nav.pushScope(el)` traps focus (modals do
this) and restores it on pop. By default the gamepad drives the UI only while a scope is open, so a pad that is
walking the character does not also walk the HUD (`gamepad: 'always'` for a menu-only screen).

`kit.device` is the last device used (`keyboard`, `mouse`, `gamepad`, `touch`). `Glyph` / `Prompt` read it and the
input's bindings: `E` becomes `X` (or the PlayStation / Switch name, from the pad's id) the moment a pad button is
pressed, and follows a rebind after `kit.rebound()`. With touch, controls grow to at least 44 px.

## Languages

```js
import { createI18n } from '@miragekit/game/ui-i18n';
import { LOCALES } from '@miragekit/game/ui-locales';
const i18n = createI18n({ locale: 'zh-Hant', fallback: 'en', tables: LOCALES });
i18n.add('en', { quest: { apples: '{count, plural, one {# apple} other {# apples}} for {name}' } });
i18n.t('quest.apples', { count: 3, name: 'Mira' });
i18n.setLocale('ar');        // every kit.tx() text on screen follows; the root becomes dir="rtl"
```

Messages take `{name}`, `{n, number}`, `{d, date}`, `{count, plural, ...}` (all six CLDR categories through
`Intl.PluralRules`, `=0` exact matches, `#`), `{n, selectordinal, ...}` and `{g, select, ...}`. A missing key falls
back along `zh-Hant-TW -> zh-Hant -> fallback` and is recorded in `i18n.missing`. Interpolated values are wrapped in
bidi isolates so a Latin name inside Arabic keeps its order. Layout uses logical properties throughout, so RTL is
the same widgets mirrored. CJK text gets `line-break: strict` and a per-language font stack (`fontStack`); `wrapText`
does the same breaking (`Intl.Segmenter`, no break before closing punctuation) for the canvas renderer.

## World-space UI

```js
import { createWorldUI } from '@miragekit/game/ui-world';
const wui = createWorldUI({ kit, camera, occluders: [walls] });
const m = wui.marker({ position: [4, 1.8, -2], icon: '◆', label: 'Well', showDistance: true, clamp: true });
wui.healthBar({ object: enemy, offset: [0, 2, 0], value: enemyHp, max: 40 });
// each frame after the camera moved: wui.update()
```

Elements are DOM nodes moved with `transform` and `opacity` only, written once per frame and only when the rounded
value (a tenth of a pixel, a fiftieth of opacity) changed: no layout is read or caused. Distance fades out toward `maxDistance`;
occlusion is a ray per item against `occluders` (or your own `occlude(point, eye)`), a few per frame in turn
(`raysPerFrame`), fading rather than popping. `clamp` keeps a marker at the screen edge when its point is off screen
or behind.

## A panel in a texture

```js
import { createCanvasUI, cv } from '@miragekit/game/ui-canvas';
const panel = createCanvasUI({ width: 512, height: 320, kit, description: () => cv.panel({ title: 'Door' },
  cv.toggle({ label: 'Locked', value: locked }), cv.slider({ label: 'Volume', value: vol, min: 0, max: 1 }),
  cv.button({ label: 'Open', onPress: open })) });
scene.add(panel.mesh({ width: 0.8 }));
// each frame: panel.update();   pointer: panel.raycast(raycaster, down)   XR: panel.pointFrom(controller, down)
```

The subset is `panel`, `col`, `row`, `text`, `button`, `toggle`, `slider`, `bar`, `spacer`. `layoutCanvas` is pure:
it returns draw commands and hit boxes, so it runs in Node. Painting uses Canvas 2D; where that draws no text (the
native WebXR hosts `docs/xr.md` describes) `backend: 'glyphs'` rasterises into a `DataTexture` with
`@miragekit/play`'s built-in glyph font, Latin only. It repaints only when a signal it read changed.

## The default overlay in another language

`createUI` (the overlay `startGame` makes when `ui` is absent) shows its start card, pause menu and panels, the
inventory panel, the message dialog's button and the touch buttons from a table of strings. The default table,
`UI_STRINGS` (exported by `@miragekit/game`), is the English it always had, so a game that passes nothing sees no
change. A game passes its own, whole or in part (keys left out stay English); `{name}` marks a parameter:

```js
import { startGame, UI_STRINGS } from '@miragekit/game';
console.log(Object.keys(UI_STRINGS));   // start, startHint, paused, resume, save, slot ('Slot {n}: {text}'), action.jump, bus.music, ...
const g = await startGame(world, { built, ui: { strings: { paused: '一時停止', resume: '再開', back: '戻る' } } });
g.ui.setStrings(JA);                    // a language switch at run time: the labels and an open menu follow at once
g.ui.strings;                           // the table in use
```

`setStrings` replaces the previous table (merged over `UI_STRINGS` again). Texts a game passes itself
(`ui.message(head, body, button)`, toasts, the objective) are the game's to translate. `examples/neon-district`
feeds it Traditional Chinese, English and Japanese and switches with its options panel. Checked by
`examples/demos/ui/ui-check.mjs --only menu` (snow-hut: the pause menu in another table, and back).

## The pause menu on the toolkit

```js
import { createKitUI } from '@miragekit/game/ui-menu';
const g = await startGame(world, { built, ui: (o) => createKitUI({ ...o, locale: 'zh-Hant' }) });
```

Same interface as `createUI` (start screen, pause menu with settings and rebinding, save / load, prompts, toasts,
objective, touch controls) with gamepad navigation, the three languages, themes and text scale. `startGame`'s `ui`
option takes a factory for this; `true` / absent is `createUI` as before. Try it: `examples/snow-hut/?ui=kit`.

## Accessibility

Widgets carry their roles and states (`switch`, `slider` with value text, `tablist` / `tab` / `tabpanel`,
`dialog` with `aria-modal`, `progressbar`, `meter`, `listbox` with `aria-activedescendant`, `menu`); `kit.announce(text)`
speaks through a live region without moving focus (toasts and dialogue lines do); focus is always visible.
`packages/game/ui.check.mjs` checks every theme's text pairs against WCAG AA (4.5) and that the colour-blind
theme's good / bad colours stay apart under simulated protanopia, deuteranopia and tritanopia.

## Demo and checks

`examples/demos/ui/` is a HUD, world markers, inventory, dialogue, radial menu and settings (language, theme, text
size, motion, rebinding) over a small scene. Flags: `?lang=en|zh-Hant|ar`, `?theme=dark|light|contrast|colorblind`,
`?hud=0`, `?touch=1`, `?auto=1` (the camera orbits), `?motion=reduced`.

- `node packages/game/ui.check.mjs`: binding, localisation, focus graph, widget logic, contrast, projection, the
  canvas layout. Part of `npm test`.
- `node examples/demos/ui/ui-check.mjs [--only keyboard,touch,gamepad,locale,perf,menu]`: builds the demo and plays
  it in headless Chrome with real key and touch events and a scripted gamepad, and measures layout work per frame.
  `menu` (not in the default set; needs `examples/snow-hut/dist`) plays snow-hut `?ui=kit` through `startGame`.

Measured by that check (headless Chrome, 1280 x 720, an M-series Mac shared with other jobs; median (min-max) of 5
interleaved rounds of 180 frames):

| | layouts / frame | UI work, ms | frame callback, ms | main thread, ms |
|---|---|---|---|---|
| HUD on, idle | 0.000 | | | |
| HUD on, camera orbiting | 0.111 (0.017 ms) | 0.139 (0.108-0.147) | 0.277 (0.229-0.323) | 0.756 (0.640-0.840) |
| HUD hidden | | 0.001 (0.000-0.001) | 0.133 (0.112-0.182) | 0.266 (0.239-0.404) |
| no toolkit (`?hud=0`) | | | 0.141 (0.122-0.179) | 0.302 (0.272-0.393) |

The 0.111 is text changing (the distance read-out in metres is the likely source; not isolated); with the camera
still there is no layout at all. Style recalculation is 1.000 a frame (0.143 ms) while moving: a transform write costs one.

## Not done

- No real XR session was run: the canvas panel is tested by ray and UV in Node and on a desktop page only.
- World elements are not depth-sorted against each other (later ones draw on top).
- The glyph backend draws Latin only; CJK and Arabic panels need Canvas 2D.
- Arabic and Chinese tables are sample translations by the author, not reviewed by a native editor.
- The `.d.ts` files cover the public surface; widget props are typed loosely.
- Not measured: a real phone, a real gamepad (the check scripts `navigator.getGamepads`), a screen reader's speech.

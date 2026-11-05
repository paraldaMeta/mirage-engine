// Compile only. Never run this file: it includes intentional API misuse guarded by @ts-expect-error.
import * as THREE from 'three';
import { createWorldRenderer } from '@mirage/core';
import { definePlan, buildWorld, type WorldModule } from '@mirage/world';
import { createPlay } from '@mirage/play';
import { startGame, createPhysics, loadRapier, createGame, createInput, createAudio, createUI,
  ACTIONS, DEFAULT_BINDINGS, PAD, SURFACES, type Game, type Snapshot, type InteractableEntity, type PlayerSnapshot } from '@mirage/game';
import { createSimulation } from '@mirage/game/simulation';
import { keyName, PAD_NAMES } from '@mirage/game/input';

const world = createWorldRenderer();
const plan = definePlan({ name: 'typed-game', bounds: [-8, -8, 8, 8],
  spawn: { eye: [0, 1.62, 6], look: [0, 1.62, 0] }, quest: { goal: 3 } });
const modules: WorldModule<typeof plan>[] = [];
const built = await buildWorld(world, { plan, modules });
const game: Game = createGame({ id: 'fixture', version: 2, migrate: { 1: save => ({ ...save, chapter: 2 }) },
  storage: { getItem: _key => null, setItem: (_key, _value) => {} } });
const key: InteractableEntity = { id: 'key', pos: [0, 0, 0], interact: {
  label: (g, e) => g.inventory.has(e.id) ? 'Taken' : 'Take key', can: g => !g.paused,
  use(g, e) { g.inventory.add({ id: e.id, name: 'Key', uses: 1 }); g.remove(e); },
}, save: g => ({ on: g.flags.on }), load(data) { if (typeof data === 'object' && data !== null && 'on' in data) game.set('on', data.on); } };
const returned = game.add({ ...key, kind: 'quest-key' }); returned.kind.toUpperCase();
game.spawn(built.anchors.keys, (anchor, i) => ({ id: 'lamp' + i, pos: anchor.pos }));
game.zone({ id: 'entry', box: [[-1, 0, -1], [1, 2, 1]], enter(g, zone) { g.set(zone.id, true); } });
game.zone({ id: 'exit', sphere: [[0, 0, 6], 2], once: true });
// @ts-expect-error zone representations are exclusive
game.zone({ id: 'bad', box: [[0, 0, 0], [1, 1, 1]], sphere: [[0, 0, 0], 1] });
const off = game.on('zone', (event, g) => { const inside: boolean = event.inside; g.set(event.id, inside); }); off();
game.on('pause', paused => { const flag: boolean = paused; });
game.on('custom-quest', data => { if (typeof data === 'number') data.toFixed(); });
game.emit('pause', true); game.emit('start'); game.emit('custom-quest', { chapter: 1 });
// @ts-expect-error known events have a concrete payload
game.emit('pause', 'yes');
// @ts-expect-error custom payloads must be narrowed
game.on('custom-quest', data => data.chapter);
game.system((dt, g) => { g.dirty = dt > 0; }); game.tick(1 / 60); game.pause();
game.label(key); game.where(key); game.interact(game.nearest([0, 1, 1], [0, 0, -1]));
// @ts-expect-error an entity without interact cannot be labelled
game.label({ id: 'plain' });
const snapshot: Snapshot = game.snapshot();
const extra = game.snapshot({ chapter: 2 }); extra.chapter.toFixed();
const overridden: string = game.snapshot({ time: 'custom-clock' }).time;
const savedChapter: number = game.save(1, { chapter: 2 }).chapter;
const loaded = game.load(1);
if (loaded && typeof loaded.chapter === 'number') loaded.chapter.toFixed();
// @ts-expect-error an empty slot returns null
game.load(2).v;
// @ts-expect-error importJSON does not validate custom player fields
game.importJSON('{}').player.pos;
game.restore({ v: 1 }); game.exportJSON({ chapter: 3 }); game.slots().forEach(slot => {
  if (typeof slot.at === 'string') slot.at.toUpperCase();
});
const settings = game.loadSettings();
if (typeof settings === 'object' && settings && 'sound' in settings) game.set('sound', settings.sound);
game.settings.volume = 0.5; game.saveSettings(); game.reset();

const input = createInput({ target: new EventTarget(), bindings: { jump: ['Space'] } });
input.rebind('interact', 'KeyE'); input.poll(); input.down('jump'); input.pressed('interact'); input.padPressed(0);
input.move().x.toFixed(); input.look(1 / 60)[0].toFixed(); input.spend('Enter'); input.discardActions();
input.stick(1, 0); input.hold('run', true); input.tap('jump'); input.addLook(0.1, 0); input.glyph('menu'); input.clear(); input.reset();
input.pad?.buttons[0]?.pressed; (await input.capture())?.toUpperCase();
// @ts-expect-error Escape cancels capture
const captured: string = await input.capture();
// @ts-expect-error unrecognised action
input.rebind('shoot', 'KeyF');
const bindings = DEFAULT_BINDINGS; const actions: string[] = ACTIONS; const pad: number[] = PAD.jump;
keyName('KeyE'); PAD_NAMES[0].toLowerCase();
const audio = createAudio({ volumes: { music: 0.4 } });
audio.unlock(); audio.volume('ambience', 0.2); audio.play('pickup', { at: [1, 0, 1], rate: 0.9 })?.stop();
audio.footstep(SURFACES[0] ?? 'stone'); const loop = audio.loop('water'); loop.src?.stop();
audio.listen(world.camera); audio.suspend(true); audio.ctx?.close();
// @ts-expect-error before unlock the AudioContext can be null
audio.ctx.close();
// @ts-expect-error known buses only
audio.volume('voice', 1);
// @ts-expect-error footsteps are arrays of variants and cannot be passed as a single loop buffer
audio.loop('step_stone');

const R = await loadRapier(); R.version();
const physics = await createPhysics(world.scene); physics.addStatic();
const prop = physics.body(new THREE.Mesh(new THREE.BoxGeometry()), { shape: 'box', mass: 2 });
prop.body.setLinvel({ x: 0, y: 1, z: 0 }, true); prop.state = { p: [0, 1, 0], q: [0, 0, 0, 1] }; prop.obj.geometry.dispose();
const door = physics.hinge(new THREE.Group(), { half: [0.5, 1, 0.1] }); door.open(); door.close(); door.toggle(); door.set(false);
// @ts-expect-error a hinge needs collider half extents
physics.hinge(new THREE.Group());
const character = physics.character({ pos: [0, 0, 0], body: { stride: 0.8 }, onPlace() { input.discardActions(); } });
character.onStride = (surface, run) => audio.footstep(surface, run);
character.update(1 / 60, { x: 1 }).place([0, 0, 0], { exact: true });
character.controller.computedGrounded(); character.collider.handle.toFixed();
physics.ray([0, 1, 0], [0, -1, 0], 5, character.collider)?.object?.removeFromParent();
// @ts-expect-error a ray can miss
physics.ray([0, 1, 0], [0, -1, 0]).distance;
const simulation = createSimulation(physics, character, game);
simulation.advance(1 / 144, { x: 1, jumpPressed: true }); simulation.advance(1 / 60, null); simulation.reset();
const play = createPlay(world, { plan, walker: character, simulation }); play.walker.collider.handle.toFixed(); play.stop();
const session = await startGame(world, { built, ui: false, appearance: { palette: { scarf: '#d98645' } },
  async setup(ctx) { const goal: number = ctx.plan.quest.goal; ctx.game.set('goal', goal); ctx.root.name = 'entities'; },
  objective: g => ['Collect keys', String(g.inventory.items.length)], summary: g => String(g.time) });
const playerSave: PlayerSnapshot = session.save(1); const exported: string = session.save('export');
session.load(exported); session.load(1); session.ui?.toast('Hello'); session.game.ui.toast('Ready');
// @ts-expect-error disabling UI may return null
session.ui.toast('Hello');
// @ts-expect-error no unified session disposal exists yet
session.dispose();
const noSpawn = await buildWorld(world, { plan: { name: 'no-spawn', bounds: [-1, -1, 1, 1] }, modules: [] });
// @ts-expect-error startGame requires an explicit spawn
await startGame(world, { built: noSpawn });
const ui = createUI({ game, input, audio, onSave: session.save, onLoad: session.load });
ui.begin(); ui.objective('Keys', 'Find three'); ui.prompt(key); ui.openMenu('save'); ui.openInventory(); ui.update(); ui.setTouch(true);
ui.open?.close();
// @ts-expect-error no dialog is open initially
ui.open.close();
session.play.stop(); physics.world.free();

// A missing library declaration must not silently turn the major handles into any.
type IsAny<T> = 0 extends (1 & T) ? true : false;
const worldIsTyped: IsAny<typeof world> = false;
const gameIsTyped: IsAny<typeof game> = false;
const bodyIsTyped: IsAny<typeof prop.body> = false;

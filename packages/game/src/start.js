// Mirage original code. startGame wires the parts over a built world: Rapier colliders from the modules'
// geometry, the physics character as @mirage/play's walker, the action map as play's input, footsteps, the
// interaction prompt, the overlay, save / load of the player and every entity, pause.
// ---------------------------------------------------------------------------
// const built = await buildWorld(world, { plan, modules });
// const g = await startGame(world, { built, canvas, id: 'my-game', version: 1,
//   setup({ game, physics, audio, root, anchors, plan, world }) { /* spawn entities (before shaders compile) */ },
//   objective: (game) => ['Find the key', 'It is somewhere in the garden'], summary: (game) => 'lanterns 2/4' });
// g = { game, physics, input, audio, ui, play, character, root, save(slot), load(slot | json text) }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createLifetime } from '@mirage/core/lifetime';
import { createPlay } from '@mirage/play';
import { createPhysics } from './physics.js';
import { createSimulation } from './simulation.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';

export async function startGame(world, opts) {
  const life = createLifetime();
  let audioClosed, completion;
  function dispose() {
    if (completion) return completion;
    // Mark completion before callbacks can re-enter. Detach resources on this stack;
    // Web Audio closes asynchronously even when the host immediately mounts again.
    let cleanupError;
    completion = Promise.resolve().then(async () => {
      await audioClosed;
      if (cleanupError) throw cleanupError;
    });
    try { life.dispose(); } catch (error) { cleanupError = error; }
    return completion;
  }
  try {
    return await mountGame(world, opts, life, dispose, audio => {
      life.defer(() => { audioClosed = audio.dispose(); });
    });
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Game startup and teardown failed'); }
    throw error;
  }
}

async function mountGame(world, opts, life, dispose, ownAudio) {
  const { built, canvas = world.renderer.domElement, id = built.plan.name, version = 1, migrate, setup, objective, summary } = opts;
  const plan = built.plan;
  const t0 = performance.now();
  const physics = await createPhysics(world.scene);
  life.defer(() => physics.dispose());
  physics.addStatic(world.scene);                       // the modules' geometry, before any entity exists
  const root = new THREE.Group();
  root.name = 'game'; root.userData.collide = false;     // entities move: the baked walk grid leaves them out
  life.defer(() => { root.removeFromParent(); root.clear(); });
  world.scene.add(root);
  const game = createGame({ id, version, migrate });
  life.defer(() => game.dispose());
  const input = createInput();
  life.defer(() => input.dispose());
  const settings = game.loadSettings();
  if (settings.bindings) input.bindings = settings.bindings;
  const audio = createAudio({ volumes: settings.volumes });
  ownAudio(audio);
  const ctx = { onDispose: life.defer, game, physics, audio, input, root, plan, anchors: built.anchors, world };
  if (setup) await setup(ctx);
  await world.prepare();                                // compiles every program once, entities included
  const sp = plan.spawn;
  let play = null, simulation;
  const character = physics.character({
    pos: [sp.eye[0], sp.eye[1] - 1.62, sp.eye[2]],
    onPlace() {
      simulation?.reset();
      input.discardActions();
      play?.syncWalkerView();
    },
  });
  simulation = createSimulation(physics, character, game);
  life.defer(() => simulation.dispose());
  life.defer(game.on('pause', () => { input.discardActions(); play?.syncWalkerView(); }));
  character.onStride = (surface, run) => audio.footstep(surface, run);
  life.defer(() => { character.onStride = null; });
  const save = (slot) => {
    if (life.disposed) throw new Error('Game session disposed');
    const extra = { player: { pos: character.pos.map((v) => +v.toFixed(3)), yaw: +play.yaw.toFixed(4), pitch: +play.pitch.toFixed(4) }, summary: summary ? summary(game) : '' };
    return slot === 'export' ? game.exportJSON(extra) : game.save(slot, extra);
  };
  const load = (slot) => {
    if (life.disposed) throw new Error('Game session disposed');
    // a string is an exported save when it is a JSON object, otherwise a named slot (save('auto') then load('auto'))
    const s = typeof slot === 'string' && /^\s*\{/.test(slot) ? game.importJSON(slot) : game.load(slot);
    if (!s) throw new Error('empty slot');
    simulation.reset();
    input.clear();
    if (s.player) { character.place(s.player.pos, { exact: true }); play.yaw = s.player.yaw; play.pitch = s.player.pitch; }
    apply();
    return s;
  };
  const apply = () => {
    if (game.settings.bindings) input.bindings = game.settings.bindings;
    for (const [b, v] of Object.entries(game.settings.volumes || {})) audio.volume(b, v);
  };
  const ui = opts.ui === false ? null : createUI({ game, input, audio, canvas, title: opts.title || plan.name, subtitle: opts.subtitle, onSave: save, onLoad: load, onRestart: opts.onRestart || (() => location.reload()) });
  if (ui) life.defer(() => ui.dispose());
  game.ui = ui || { toast() {}, message() {}, prompt() {}, objective() {} };   // entities talk to the overlay through the game
  const refresh = () => { if (ui && objective) ui.objective(...objective(game)); };
  for (const ev of ['flag', 'inventory', 'load']) life.defer(game.on(ev, refresh));
  refresh();

  const cam = world.camera, dir = new THREE.Vector3();
  let near = null;
  play = createPlay(world, {
    plan, canvas, mode: 'walk', walker: character, devKeys: false, spp: opts.spp || 6, ui: false, shadowRadius: opts.shadowRadius, grid: opts.grid, fit: opts.fit,
    quality: opts.quality, hud: opts.hud, idle: opts.idle, appearance: opts.appearance, onQuality: opts.onQuality, simulation,
    onVisibility(shown) { simulation.reset(); input.clear(); audio.suspend(!shown); },
    // play.place() / viewpoint(): no tick left over from before the jump, and systems restart their scene clocks
    onPlace() { simulation.reset(); game.emit('place'); },
    input(dt) {
      input.poll();
      if (ui) ui.update();
      const p = input.pad;   // a pad has no DOM events: any button or stick counts as someone being there
      if (p && (p.buttons.some((b) => b.pressed) || p.axes.some((v) => Math.abs(v) > 0.2))) play.wake();
      const [lx, ly] = input.look(dt);
      if (lx || ly) play.turn(lx, ly, 1);
      const m = input.move();
      return { x: m.x, z: m.z, run: input.down('run'), jump: input.down('jump'), jumpPressed: input.pressed('jump') };
    },
    onStep() {
      if (game.paused) { if (ui) ui.prompt(null); return false; }
      cam.getWorldDirection(dir);
      near = game.nearest(cam.position.toArray(), dir.toArray());
      if (ui) ui.prompt(near);
      if (near && input.pressed('interact')) game.interact(near);
      audio.listen(cam);
      const d = game.dirty; game.dirty = false;
      return d;
    },
  });
  life.defer(() => { near = null; play.dispose(); });
  const stats = { setupMs: +(performance.now() - t0).toFixed(1), colliders: physics.stats.colliders, triangles: physics.stats.triangles, collidersMs: +physics.stats.buildMs.toFixed(1) };
  return { dispose, game, physics, input, audio, ui, play, character, root, save, load, stats, get near() { return near; } };
}

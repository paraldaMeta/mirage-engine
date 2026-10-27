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
import { createPlay } from '@mirage/play';
import { createPhysics } from './physics.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';

export async function startGame(world, opts) {
  const { built, canvas = world.renderer.domElement, id = built.plan.name, version = 1, migrate, setup, objective, summary } = opts;
  const plan = built.plan;
  const t0 = performance.now();
  const physics = await createPhysics(world.scene);
  physics.addStatic(world.scene);                       // the modules' geometry, before any entity exists
  const root = new THREE.Group();
  root.name = 'game'; root.userData.collide = false;     // entities move: the baked walk grid leaves them out
  world.scene.add(root);
  const game = createGame({ id, version, migrate });
  const input = createInput();
  const settings = game.loadSettings();
  if (settings.bindings) input.bindings = settings.bindings;
  const audio = createAudio({ volumes: settings.volumes });
  const ctx = { game, physics, audio, input, root, plan, anchors: built.anchors, world };
  if (setup) await setup(ctx);
  await world.prepare();                                // compiles every program once, entities included
  const sp = plan.spawn;
  const character = physics.character({ pos: [sp.eye[0], sp.eye[1] - 1.62, sp.eye[2]] });
  character.onStride = (surface, run) => audio.footstep(surface, run);
  let play = null;
  const save = (slot) => {
    const extra = { player: { pos: character.pos.map((v) => +v.toFixed(3)), yaw: +play.yaw.toFixed(4), pitch: +play.pitch.toFixed(4) }, summary: summary ? summary(game) : '' };
    return slot === 'export' ? game.exportJSON(extra) : game.save(slot, extra);
  };
  const load = (slot) => {
    const s = typeof slot === 'string' ? game.importJSON(slot) : game.load(slot);
    if (!s) throw new Error('empty slot');
    if (s.player) { character.place(s.player.pos, { exact: true }); play.yaw = s.player.yaw; play.pitch = s.player.pitch; }
    apply();
    return s;
  };
  const apply = () => {
    if (game.settings.bindings) input.bindings = game.settings.bindings;
    for (const [b, v] of Object.entries(game.settings.volumes || {})) audio.volume(b, v);
  };
  const ui = opts.ui === false ? null : createUI({ game, input, audio, canvas, title: opts.title || plan.name, subtitle: opts.subtitle, onSave: save, onLoad: load, onRestart: () => location.reload() });
  game.ui = ui || { toast() {}, message() {}, prompt() {}, objective() {} };   // entities talk to the overlay through the game
  const refresh = () => { if (ui && objective) ui.objective(...objective(game)); };
  for (const ev of ['flag', 'inventory', 'load']) game.on(ev, refresh);
  refresh();

  const cam = world.camera, dir = new THREE.Vector3();
  let near = null;
  play = createPlay(world, {
    plan, canvas, mode: 'walk', walker: character, devKeys: false, spp: opts.spp || 6, ui: false, shadowRadius: opts.shadowRadius, grid: opts.grid, fit: opts.fit,
    quality: opts.quality, hud: opts.hud, idle: opts.idle,
    onVisibility: (shown) => audio.suspend(!shown),
    input(dt) {
      input.poll();
      const p = input.pad;   // a pad has no DOM events: any button or stick counts as someone being there
      if (p && (p.buttons.some((b) => b.pressed) || p.axes.some((v) => Math.abs(v) > 0.2))) play.wake();
      const [lx, ly] = input.look(dt);
      if (lx || ly) play.turn(lx, ly, 1);
      const m = input.move();
      return { x: m.x, z: m.z, run: input.down('run'), jump: input.down('jump') };
    },
    onStep(dt) {
      if (ui) ui.update();
      if (game.paused) { if (ui) ui.prompt(null); return false; }
      cam.getWorldDirection(dir);
      near = game.nearest(cam.position.toArray(), dir.toArray());
      if (ui) ui.prompt(near);
      if (near && input.pressed('interact')) game.interact(near);
      game.tick(dt);
      const moved = physics.step(dt);
      audio.listen(cam);
      const d = game.dirty; game.dirty = false;
      return moved || d;
    },
  });
  const stats = { setupMs: +(performance.now() - t0).toFixed(1), colliders: physics.stats.colliders, triangles: physics.stats.triangles, collidersMs: +physics.stats.buildMs.toFixed(1) };
  return { game, physics, input, audio, ui, play, character, root, save, load, stats, get near() { return near; } };
}

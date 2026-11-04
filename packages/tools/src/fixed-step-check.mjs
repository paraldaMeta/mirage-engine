// Test-machine acceptance on the actual snow-hut doorway. Drive the normal input/camera/game loop without
// waiting for a particular monitor refresh rate. Run after building examples/snow-hut.
import assert from 'node:assert/strict';
import { launch, open, serve } from './chrome.mjs';

const server = await serve(process.argv[2] || 'examples/snow-hut/dist');
let browser;
try {
  browser = await launch();
  const { page, errors } = await open(browser, server.url + '?start=1&hud=0');
  const result = await page.evaluate(() => {
    const { play, world, g } = window.__mirage;
    const { game, input, character } = g;
    play.stop();
    const spawn = () => play.place([1.3, 1.62, 3], [1.3, 1.62, -6], 'walk');
    const door = [];
    for (const hz of [30, 60, 90, 120, 144, 165]) {
      spawn();
      input.stick(0, 1);
      for (let frame = 0; frame < hz * 4; frame++) play.step(1 / hz);
      door.push({ hz, pos: character.pos.slice() });
    }
    spawn();
    input.stick(0, 1);
    const origin = character.pos.slice();
    play.step(1.5 / 60);
    const halfStep = (origin[2] + character.pos[2]) / 2;
    const cameraError = Math.abs(world.camera.position.z - halfStep);
    const saved = g.save('export'), savedZ = JSON.parse(saved).player.pos[2];
    const saveError = Math.abs(savedZ - character.pos[2]);
    input.stick(0, 0);
    g.load(saved);
    const loadCameraError = Math.abs(world.camera.position.z - savedZ);

    // A touch down/up between two physical ticks is delivered once, even with a zero-tick frame.
    spawn();
    input.hold('jump', true); input.hold('jump', false);
    play.step(1 / 240);
    const beforeJump = character.pos[1];
    play.step(3 / 240);
    const jumped = character.pos[1] > beforeJump && character.vy > 0;

    function dropsPendingJump(discontinuity) {
      spawn(); input.tap('jump'); play.step(1 / 240);
      discontinuity();
      play.step(1 / 60);
      return character.vy <= 0 && character.onGround;
    }
    const teleport = dropsPendingJump(spawn);
    const load = dropsPendingJump(() => g.load(saved));
    const pause = dropsPendingJump(() => { game.pause(true); play.step(0.1); game.pause(false); });
    const visibility = dropsPendingJump(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    spawn();
    let uses = 0, entries = 0;
    const [x, y, z] = character.pos;
    game.add({ id: 'clock-check-target', pos: [x, y + character.body.eye, z - 0.8],
      interact: { label: 'check', use() { uses++; } } });
    game.zone({ id: 'clock-check-zone', box: [[x - 1, y - 1, z - 0.2], [x + 1, y + 1, z - 0.06]],
      enter() { entries++; } });
    input.tap('interact'); input.stick(0, 1);
    play.step(0.1); play.step(0.1);
    return { door, cameraError, saveError, loadCameraError, jumped, teleport, load, pause, visibility, uses, entries };
  });
  const baseline = result.door.find(row => row.hz === 60).pos;
  for (const { hz, pos } of result.door) {
    assert.ok(pos[2] < -1.6 && Math.abs(pos[1] - 0.34) < 0.08, `doorway at ${hz} Hz: ${pos}`);
    assert.ok(Math.hypot(...pos.map((v, axis) => v - baseline[axis])) < 0.01, `endpoint at ${hz} Hz`);
  }
  assert.ok(result.cameraError < 1e-6 && result.saveError < 0.00051 && result.loadCameraError < 1e-6, JSON.stringify(result));
  for (const event of ['jumped', 'pause', 'teleport', 'load', 'visibility']) assert.ok(result[event], event);
  assert.equal(result.uses, 1);
  assert.equal(result.entries, 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { if (browser) await browser.close(); } finally { await server.close(); }
}

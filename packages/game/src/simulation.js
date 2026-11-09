// One clock for the game character, rigid bodies and trigger zones. Rendering can sample between ticks.
const STEP = 1 / 60;
const EPSILON = 1e-10;

export function createSimulation(physics, character, game) {
  let disposed = false;
  let remainder = 0, pendingJump = false;
  const previous = character.pos.slice(), viewPosition = character.pos.slice();

  function reset() {
    if (disposed) return;
    remainder = 0;
    pendingJump = false;
    game.player = character.pos;
    for (let axis = 0; axis < 3; axis++) previous[axis] = viewPosition[axis] = character.pos[axis];
  }

  function advance(dt, motion) {
    if (disposed || game.paused) return false;
    // Match the play loop's stall limit, including when a host calls play.step() directly.
    remainder += Math.max(0, Math.min(dt, 0.1));
    pendingJump = !!motion && (pendingJump || motion.jumpPressed || motion.jump);
    let moved = false;
    while (remainder + EPSILON >= STEP) {
      remainder = Math.max(0, remainder - STEP);
      for (let axis = 0; axis < 3; axis++) previous[axis] = character.pos[axis];
      if (motion) character.update(STEP, { ...motion, jump: !!(pendingJump || motion.jump) });
      if (disposed) return moved;
      pendingJump = false;
      if (physics.step(STEP)) moved = true;
      game.player = character.pos;
      game.tick(STEP);
      if (disposed || game.paused) return moved;
    }
    const alpha = remainder / STEP;
    for (let axis = 0; axis < 3; axis++) {
      viewPosition[axis] = previous[axis] + (character.pos[axis] - previous[axis]) * alpha;
    }
    return moved;
  }

  const unsubscribe = game.on('pause', reset);
  reset();
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (game.player === character.pos) game.player = null;
  }
  return { advance, reset, viewPosition, dispose };
}

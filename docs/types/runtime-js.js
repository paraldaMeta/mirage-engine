// @ts-check
// Compile only, including negative cases. This module is not a runnable demo.
import { createWorldRenderer } from '@miragekit/core';
import { definePlan } from '@miragekit/world';
import { createPlay } from '@miragekit/play';
import { createGame } from '@miragekit/game/game';

const world = createWorldRenderer({ quality: 'medium' });
const plan = definePlan({ name: 'js-runtime', bounds: [-4, -4, 4, 4] });
const play = createPlay(world, { plan, onStep: dt => dt > 0 });
play.stop(); world.resize(800, 600); world.renderFrame();
const game = createGame();
game.on('zone', data => data.inside.valueOf());
game.add({ id: 'marker', save: () => ({ visible: true }), load(data) {
  if (typeof data === 'object' && data && 'visible' in data) game.set('visible', data.visible);
} });
// @ts-expect-error strict coordinate length applies in checked JavaScript too
play.lookAt([0, 1]);
play.dispose(); world.dispose();
// @ts-expect-error save payloads require narrowing
game.importJSON('{}').player.pos;

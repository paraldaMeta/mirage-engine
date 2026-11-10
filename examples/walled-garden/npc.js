// Mirage original code.
// ?npc=N (main.js calls this only then): N travellers wander the garden, each walking to a random spot on a
// terrace, pausing, then picking another. They path on the player's own walk grid (createNavGrid), walk as
// walkers do (createNavAgent: the same collision, steps and ground following) and keep apart (createNavCrowd).
import { createCharacter, createNavGrid, createNavAgent, createNavCrowd } from '@mirage/play';

const PALETTES = [
  { jacket: 0x6d4c3d, scarf: 0x3f6f8f }, { jacket: 0x3d5a6d, scarf: 0xc98a3a }, { jacket: 0x5b6b3d, scarf: 0x8f3f4a },
  { jacket: 0x7a6a58, scarf: 0x2f5f4f, trousers: 0x40362e }, { jacket: 0x40404a, scarf: 0xd0b060 }, { jacket: 0x8a5a3a, scarf: 0x405a8a },
];

export function npcDemo(world, play, plan, n = 6) {
  const t0 = performance.now();
  const nav = createNavGrid(play.grid, { coarse: 4 });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const regions = Object.values(plan.regions);
  /** a random spot a traveller fits, on one of the terraces */
  const spot = () => {
    for (let tries = 0; tries < 50; tries++) {
      const { rect, y } = regions[Math.floor(rnd() * regions.length)];
      const p = nav.nearest([rect[0] + rnd() * (rect[2] - rect[0]), y, rect[1] + rnd() * (rect[3] - rect[1])], { snap: 1.5 });
      if (p) return p;
    }
    return null;
  };
  const crowd = createNavCrowd(nav, { separation: 2 });
  const npcs = [];
  for (let q = 0; q < n; q++) {
    const at = spot();
    if (!at) continue;
    const agent = crowd.add(createNavAgent(nav, { pos: at, speed: 1.1 + rnd() * 0.5 }));
    const figure = createCharacter(world, { palette: PALETTES[q % PALETTES.length] });
    world.scene.add(figure.root);
    figure.root.position.set(...agent.pos);
    npcs.push({ agent, figure, wait: rnd() * 2, last: agent.pos.slice() });
  }
  const ms = performance.now() - t0;
  /** advance them by dt; true while any moved (the frame is not still) */
  function step(dt) {
    for (const c of npcs) if (c.agent.arrived || !c.agent.path) { if ((c.wait -= dt) <= 0) { const g = spot(); if (g) c.agent.setGoal(g); c.wait = 2 + rnd() * 3; } }
    crowd.update(dt);
    let moved = false;
    for (const c of npcs) {
      const p = c.agent.pos, distance = Math.hypot(p[0] - c.last[0], p[2] - c.last[2]);
      if (c.figure.update(dt, { distance, onGround: c.agent.walker.onGround, verticalSpeed: c.agent.walker.vy })) moved = true;
      if (distance > 1e-5) moved = true;
      c.figure.root.position.set(p[0], p[1], p[2]);
      c.figure.root.rotation.y = Math.atan2(c.agent.heading[0], c.agent.heading[1]);
      c.last = p.slice();
    }
    return moved;
  }
  return { nav, crowd, npcs, step, ms, createNavAgent };
}

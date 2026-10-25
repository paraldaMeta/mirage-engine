// Mirage code; the embedding shape (shared renderer, host objects in the world's root, render with any camera)
// adapted from the author's own earlier embed.js.
import * as THREE from 'three';
import { createWorldRenderer } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { bakeWalkGrid } from './walkgrid.js';
import { createWalker } from './walker.js';

// ---------------------------------------------------------------------------
// mountWorld: a Mirage world inside a game's own three.js program.
//
//   const mw = await mountWorld({ renderer, plan, modules, world: { place, time, ... }, shared: (world) => ({ tex }) });
//   mw.root.add(player, npcs);                  // drawn with the world: its sky, fog, shadows, light, TAA
//   mw.render(camera, { target, moving });      // any perspective or orthographic camera of the host
//   mw.grid / mw.walker(pos) / mw.groundAt(x, z, y)   collision and ground for the host's own characters
//   mw.update(dt) (eased clock, env fades); mw.setSize(w, h); mw.dispose()
//
// The host's renderer is shared (the core sets tone mapping off and shadows on; it owns the drawing size).
// Render into `target` (a WebGLRenderTarget) to composite the world under the host's own scene instead.
// The host camera is never modified: the core jitters a copy of its projection and restores it.
// ---------------------------------------------------------------------------

export async function mountWorld({ renderer, plan, modules, world: cfg = {}, shared = {}, width, height } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const world = createWorldRenderer({ renderer, width: width || size.x, height: height || size.y, ...cfg });
  const sh = typeof shared === 'function' ? await shared(world) : shared;   // e.g. a texture layer made for this world
  const built = await buildWorld(world, { plan, modules, shared: sh });
  if (sh.tex) await sh.tex.ready();
  await world.prepare();
  const grid = bakeWalkGrid(world, { bounds: built.plan.bounds, ...built.plan.walk });
  const root = new THREE.Group();
  root.name = 'host';
  root.userData.collide = false;   // the host's characters are not part of the baked ground
  world.scene.add(root);
  return {
    world, root, grid, plan: built.plan, anchors: built.anchors, report: built.report,
    walker: (pos, body) => createWalker(grid, { pos, body }),
    groundAt: (x, z, y) => grid.groundAt(x, z, y),
    update: (dt) => world.tick(dt),
    /** moving: true -> one TAA sub-frame (default); false -> the still path (spp sub-frames) */
    render(camera, { target = null, moving = true, spp = 6, T = 0, shadow } = {}) {
      world.renderFrame(T, { camera, target, ...(shadow ? { shadow } : {}), ...(moving ? { taa: true } : { spp, frameIndex: 1 }) });
    },
    setSize: (w, h) => world.resize(w, h),
    dispose: () => world.dispose(),
  };
}

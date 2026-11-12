// Compile only: this file is never executed. The 2.5D kit as a consumer uses it (docs/sprites-25d.md).
import * as THREE from 'three';
import { createWorldRenderer } from '@miragekit/core';
import { buildWorld, type WorldModule } from '@miragekit/world';
import { createCutaway } from '@miragekit/world/kits/cutaway';
import { addPerimeter, addBarrier } from '@miragekit/world/kits/edge';
import {
  bakeWalkGrid, createNavGrid, createNavAgent, createSpriteActor, makePlaceholderAtlas, makeAtlas, loadAtlas,
  parseAtlas, createSpriteAnim, spriteDirection, drawnDirection, createIsoCamera, pickWalkGrid, reachableGoal,
  type SpriteAtlas, type SpriteActor, type IsoCamera, type AtlasJSON,
} from '@miragekit/play';
import { createSpriteMaterial } from '@miragekit/play/sprites';
import { createIsoCamera as isoSub } from '@miragekit/play/iso-camera';
import { pickWalkGrid as pickSub } from '@miragekit/play/walk-pick';

const world = createWorldRenderer({ canvas: document.createElement('canvas') });
const cut = createCutaway({ radius: 1.9 });
const yard: WorldModule = {
  name: 'yard',
  build(ctx) {
    ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), ctx.mat.std({ color: 0xddccaa }, cut.hooks(ctx.mat.PROC.plaster('vec3(1.0)')))));
    cut.apply(ctx.mat, new THREE.MeshStandardMaterial());
    addPerimeter(ctx, [-10, -10, 10, 10], { thickness: 0.5 });
    const bank: THREE.Mesh | null = addBarrier(ctx, [[0, 0], [3, 1]]);
    void bank;
  },
};
await buildWorld(world, { plan: { name: 'yard', bounds: [-10, -10, 10, 10] }, modules: [yard] });
const grid = bakeWalkGrid(world, { bounds: [-10, -10, 10, 10] });
const nav = createNavGrid(grid);

const { json, canvas } = makePlaceholderAtlas({ id: 'hero', shape: 'humanoid', body: '#3f6fb5' });
const placeholder: SpriteAtlas = makeAtlas(json, canvas);
const art: SpriteAtlas = await loadAtlas('/sprites/hero/atlas.json', { placeholder: { shape: 'humanoid' } });
const parsed = parseAtlas(json as AtlasJSON, { width: 512, height: 1920 });
const anim = createSpriteAnim(parsed).play('attack', { onHit: () => {}, onEnd: () => {} });
const frame = anim.update(1 / 60, spriteDirection(0.5, 0.2));
const [drawn, mirrored]: [number, boolean] = drawnDirection(5, 6);
const hero: SpriteActor = createSpriteActor(world, art, { silhouette: { color: [0.5, 0.8, 1] }, ground: (x, z) => grid.groundAt(x, z) });
hero.play('walk').setFacing(Math.PI).outline('hover').setTint(1, 0.9, 0.9);
// @ts-expect-error not an outline preset
hero.outline('glow');
createSpriteMaterial(world, placeholder).dispose();

const iso: IsoCamera = createIsoCamera({ pitch: 52, yaw: 35, min: 10, max: 34 });
const unbind: () => void = iso.bind(canvas as unknown as HTMLCanvasElement, { keys: ['a', 'd'] });
iso.follow(hero.group.position).update(1 / 60).apply(world.camera);
hero.update(1 / 60, iso);
isoSub().dispose();
unbind();

const agent = createNavAgent(nav, { radius: 0.3 });
const ray = new THREE.Raycaster();
const p = pickWalkGrid(grid, ray.ray, { nav, skip: (x, y, z) => cut.hides(x, y, z, world.camera.position) });
const goal: [number, number, number] | null = p && reachableGoal(nav, p, { from: agent.pos, tryGoal: (q) => agent.setGoal(q) });
pickSub(grid, { origin: [0, 10, 0], direction: [0, -1, 0] });
const rect = hero.screenRect(world.camera, 1280, 720);
void [frame, drawn, mirrored, goal, rect.depth];

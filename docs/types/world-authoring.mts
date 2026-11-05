// Compile only. These fixtures do not run or create a WebGL context.
import * as THREE from 'three';
import { definePlan, buildWorld, along, contains, bbox, pathLength, LAYER,
  type PlanInput, type WorldModule, type WorldHost, type Shape } from '@mirage/world';
import { definePlan as defineSubpath } from '@mirage/world/plan';
import { buildWorld as buildSubpath } from '@mirage/world/loader';
import { planProblems } from '@mirage/world/plan-validation';
import { addTerrain } from '@mirage/world/kits/terrain';
import { addWater } from '@mirage/world/kits/water';
import { addGrass, addTreeCanopies } from '@mirage/world/kits/vegetation';
import { createEnv, dirFromElevAz, elevAzOf } from '@mirage/core/env';
import { createMaterials, patch, PROC } from '@mirage/core/materials';
import { rng, hash32, sfc32, valueNoise2, fbm2 } from '@mirage/core/rng';
import { MeshBatch, archPath, instances, compose, lathe, taperedTube, wall, mergeGeometries, RoundedBoxGeometry } from '@mirage/core/geom';
import schema from '@mirage/world/plan.schema.json' with { type: 'json' };

const input = {
  name: 'typed-trail', bounds: [-8, -8, 8, 8], seed: null, walk: { yMin: -2 },
  trail: { slope: 0.05 },
  paths: { trail: { points: [[0, -6], [0, 6]], width: 1.5 } },
  viewpoints: [{ name: 'entry', eye: [0, 2, 7], look: [0, 1, 0], mode: 'walk' }],
} satisfies PlanInput & { trail: { slope: number } };
const plan = definePlan(input);
const slope: number = plan.trail.slope;
const upper: number = plan.walk.yMax;
const seed: string | number = plan.seed;
const east: 'east' = plan.axes.x;
defineSubpath(input);
planProblems({ bounds: [0] });
const region: Shape = { rect: [-1, -1, 1, 1], purpose: 'camp' };
contains(region, 0, 0); bbox(region); pathLength(plan.paths.trail);
const position = along(plan.paths.trail, 3);
if (position) position.dx.toFixed(2);
// @ts-expect-error a path with fewer than two points has no returned position
const absent: { x: number } = along({ points: [] }, 0);
// @ts-expect-error only one shape representation is accepted
const invalidShape: Shape = { rect: [-1, -1, 1, 1], circle: [0, 0, 1] };
// @ts-expect-error XYZ needs exactly three coordinates
definePlan({ name: 'bad', bounds: [-1, -1, 1, 1], spawn: { eye: [0, 1], look: [0, 0, 0] } });
// @ts-expect-error unknown camera modes cannot reach the walker
definePlan({ name: 'bad', bounds: [-1, -1, 1, 1], spawn: { eye: [0, 1, 0], look: [0, 0, 0], mode: 'vehicle' } });
// @ts-expect-error known custom fields retain their concrete types
const notText: string = plan.trail.slope;
// @ts-expect-error null seeds are replaced with the plan name
const stillNull: null = plan.seed;

type Shared = { tint: number };
const ground: WorldModule<typeof input, Shared> = {
  name: 'ground',
  build(ctx) {
    const terrain = addTerrain(ctx, { bounds: ctx.plan.bounds, segments: [24, 24],
      sample: (x, z) => x * ctx.plan.trail.slope, material: ctx.mat.std({ color: ctx.shared.tint }) });
    addWater(ctx, { outline: [[-2, -2], [2, -2], [2, 2], [-2, 2]], flow: [0, 0.2] });
    const grass = addGrass(ctx, { bounds: ctx.plan.bounds, count: 80, heightAt: (x, z) => terrain.heightAt(x, z) ?? 0 });
    if (grass) grass.count.toFixed(0);
    const trees = addTreeCanopies(ctx, { trees: [{ pos: [2, 0, 2], height: 4 }] });
    trees.trunks?.computeBoundingSphere();
    // @ts-expect-error null terrain heights must be handled before placing grass
    addGrass(ctx, { bounds: ctx.plan.bounds, count: 1, heightAt: terrain.heightAt });
    // @ts-expect-error an excluded area may produce no grass instances
    grass.count;
    // @ts-expect-error empty tree lists return null meshes
    trees.crowns.count;
    ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 1)));
    ctx.onUpdate(seconds => { ctx.root.rotation.y = seconds * 0.01; });
    ctx.log(ctx.R.range(0, 1), ctx.rng('details').inDisc());
    return terrain;
  },
  anchors: { lamps: [{ pos: [2, 1, 0], watts: 4 }] },
};
const lamps: WorldModule<typeof input, Shared> = {
  name: 'lamps', consumes: { required: ['lamps'], optional: ['seats'] },
  async build() { return { ready: true }; },
  finalize(ctx) {
    for (const lamp of ctx.anchors.lamps ?? []) {
      const author: string = lamp.from;
      if (typeof lamp.watts === 'number') lamp.watts.toFixed(0);
    }
    // @ts-expect-error a missing anchor is undefined, not an empty array
    ctx.anchors.seats.map(a => a.pos);
    // @ts-expect-error another module's output requires a type guard
    ctx.modules.ground.mesh;
    // @ts-expect-error custom anchor metadata requires a type guard
    const watts: number = ctx.anchors.lamps?.[0]?.watts;
  },
};
const wrongHooks: WorldModule = {
  name: 'async-offers', build() {},
  // @ts-expect-error the loader does not await anchor hooks
  anchors: async () => ({ lamps: [] }),
};
declare const host: WorldHost;
const built = await buildWorld(host, { plan: input, modules: [ground, lamps], shared: { tint: 0x998866 } });
await buildSubpath(host, { plan: input, modules: [ground], shared: { tint: 0x998866 } });
built.plan.trail.slope.toFixed(1);
built.report.modules.forEach(row => row.consumes?.forEach(request => request.count.toFixed(0)));
const phase: 'build' | 'consumes' | 'finalize' | undefined = built.report.failed[0]?.phase;

const G = createEnv().G, mat = createMaterials(G), R = rng('fixture');
const sample: string | undefined = R.pick(['a', 'b']);
// @ts-expect-error picking from an empty list can return undefined
const mustExist: string = R.pick<string>([]);
hash32('fixture'); sfc32(12)(); valueNoise2(0, 1); fbm2(0, 1); R.fork('flowers').onSphere();
const material = patch(mat.std({ color: '#889966' }), PROC.wood(), G);
const instanced = instances(new THREE.BoxGeometry(), material, [compose()]);
instanced.material.roughness = 0.7;
const path = archPath(new THREE.Shape(), -1, 1, 2);
path.holes.push(new THREE.Path());
new MeshBatch().box(material, [1, 2, 3]).finish();
lathe([[0.1, 0], [0.2, 1]]); taperedTube([[0, 0, 0], [0, 2, 0]], [0.2, 0.1]);
wall({ length: 3, height: 2, openings: [{ x: 0, width: 1, height: 1.5, arch: 'round' }] });
mergeGeometries([new RoundedBoxGeometry()]);
elevAzOf(dirFromElevAz(6, 250));
const schemaTitle: string = schema.title;
const layer: 2 = LAYER.COLLIDE;

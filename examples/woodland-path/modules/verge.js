import { addGrass, addTreeCanopies } from '@mirage/world/kits/vegetation';

// Distance to the nearest trail segment, including its endpoints.
function offTrail(x, z, trail) {
  for (let i = 1; i < trail.points.length; i++) {
    const [ax, az] = trail.points[i - 1], [bx, bz] = trail.points[i];
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) < trail.width * 0.51) return false;
  }
  return true;
}

export default {
  name: 'verge',
  build(ctx) {
    const { woodland, regions, paths } = ctx.plan;
    const trees = addTreeCanopies(ctx, { trees: woodland.trees, cardsPerTree: ctx.quality === 'low' ? 64 : 96 });
    const grass = addGrass(ctx, { bounds: regions.meadow.rect, height: 0.48,
      count: ctx.quality === 'low' ? Math.floor(woodland.grassTufts / 2) : woodland.grassTufts,
      include: (x, z) => offTrail(x, z, paths.trail) });
    return { trunks: trees.trunks.count, cards: trees.crowns.count, tufts: grass.count };
  },
};

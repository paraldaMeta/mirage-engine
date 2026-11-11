// lawn (opt-in, ?lawn=fur | fur-fins | tufts): turf on the lower east lawn panel, for comparing @miragekit/world's shell
// fur (one draw call) with its instanced tuft cards. Without ?lawn the module is not loaded (the garden is as before).
import { addFur } from '@miragekit/world/kits/fur';
import { addGrass } from '@miragekit/world/kits/vegetation';

export default (kind) => ({
  name: 'lawn',
  build(ctx) {
    const { rect: [x0, z0, x1, z1], y } = ctx.plan.lawns[0], m = 0.5;   // inside the hedge
    const r = [x0 + m, z0 + m, x1 - m, z1 - m], top = y + 0.061;           // on the panel (0.06 m)
    if (kind === 'tufts') {
      // 30 tufts per m², short: about the cover the shells give
      const g = addGrass(ctx, { bounds: r, count: Math.round((r[2] - r[0]) * (r[3] - r[1]) * 30), height: 0.11, heightAt: () => top, seed: 'lawn' });
      return { tufts: g.count };
    }
    const fur = addFur(ctx, { rect: r, y: top, length: 0.07, density: 900, shells: 16, fins: kind === 'fur-fins' ? 0.3 : false, seed: 'lawn', name: 'lawn-fur',
      root: [0.04, 0.07, 0.015], tip: [0.3, 0.36, 0.1] });
    return { shells: fur.shells.geometry.instanceCount };
  },
});

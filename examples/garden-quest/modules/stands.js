// stands: two stone lantern stands on the upper terrace, either side of the pavilion's front steps.
// Offers `questLamps` (kind 'stand': pos = the top of the stand, where a lantern sits).
import { materials } from '../../walled-garden/modules/materials.js';

export default {
  name: 'stands',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), b = new geom.MeshBatch();
    for (const [x, y, z] of plan.quest.stands) {
      b.box(M.ashlar, [0.5, 0.16, 0.5], [x, y + 0.08, z], [0, 0, 0], 0.02);
      b.box(M.ashlar, [0.28, 0.9, 0.28], [x, y + 0.6, z], [0, 0, 0], 0.02);
      b.box(M.ashlar, [0.44, 0.08, 0.44], [x, y + 1.09, z], [0, 0, 0], 0.02);
    }
    root.add(b.finish({ name: 'stands' }));
  },
  anchors: (ctx) => ({ questLamps: ctx.plan.quest.stands.map(([x, y, z]) => ({ pos: [x, y + 1.13, z], rotY: 0, kind: 'stand' })) }),
};

// The site plan of garden-quest: walled-garden's plan (same seed, so the same trees and urns) with the pavilion's
// door and inner lamps handed to the game, and the quest's own positions.
import base from '../walled-garden/plan.js';

const [cx, y0, cz] = base.pavilion.center, front = cz + base.pavilion.size / 2 + 0.3;   // the plinth's south edge
export default {
  ...base,
  name: 'garden-quest', seed: 'walled-garden',
  pavilion: { ...base.pavilion, leaves: false, lampKey: 'questLamps' },
  quest: {
    keySeat: [-22, 17.95],                                       // the bench (a `seats` anchor) nearest to this
    stands: [[cx - 2.6, front + 0.5], [cx + 2.6, front + 0.5]].map(([x, z]) => [x, y0, z]),   // two lantern stands either side of the front steps
    crates: [[4.2, 0, 29.5, 0.2], [4.9, 0, 30.6, 0.7], [4.5, 0.75, 30.0, 0.4]],   // x, y, z, rotY: a little pile by the axis
    ball: [2.5, 0.3, 33],
  },
};

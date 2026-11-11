// The site plan of the probe: the fort's part of Nizwa's own site plan (src/layout.js of the Nizwa project), with
// what a Mirage plan needs around it (bounds for the walk grid, viewpoints, a spawn). Metres; +X east, +Z south.
import { L } from '@nizwa/layout.js';
import { VIEWS } from './tools/views.mjs';

const [tx, , tz] = L.fort.tower.center, [cx, , cz] = L.fort.castle.center, [sw, sd] = L.fort.castle.size;
export default {
  name: 'nizwa-probe',
  seed: 'nizwa',
  bounds: [-34, -46, 92, 62],
  walk: { yMin: -1, yMax: 34 },
  fort: L.fort,                                   // tower, castle, gate: exactly Nizwa's numbers
  place: { lat: 22.933, lon: 57.533, height: 500, tzHours: 4 },   // Nizwa (src/core/sky-time.js NIZWA)
  footprints: {
    tower: { circle: [tx, tz, L.fort.tower.radius] },
    castle: { rect: [cx - sw / 2, cz - sd / 2, cx + sw / 2, cz + sd / 2] },
  },
  points: { gate: L.fort.gate.pos },
  // eye, look and focal (mm, 36 mm wide sensor): what both engines are shot with (tools/views.mjs, tools/compare.mjs)
  viewpoints: VIEWS,
  spawn: { eye: [36, 1.62, 40], look: [44, 3, 17], mode: 'walk' },
  gameView: { eye: [40, 1.62, 30], look: [44, 3, 17] },
};

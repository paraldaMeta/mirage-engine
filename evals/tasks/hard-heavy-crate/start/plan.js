// The site plan of yard: every position more than one module needs (metres; +X east, +Y up, +Z south).
export default {
  name: 'yard',
  bounds: [-10, -10, 10, 10],
  walk: { yMin: -1, yMax: 6 },
  render: {
    place: { lat: 45, lon: 5, height: 100, tzHours: 1 },
    time: 'golden',
    shadow: { center: [0, 1, 0], radius: 14 },
    envProbe: [0, 2, 0],
    fog: { groundDensity: 0.002, height: 30 },
    post: {},
    shadowRadius: 14,
  },
  budget: { frameMs: 16.7, triangles: 150000, calls: 120 },

  // the yard: walls on x = +-half and z = +-half, the gate a gap in the south wall
  yard: { half: 7, wallHeight: 2.6, thickness: 0.4, gate: 1.6 },
  crate: { size: 1 },
  points: {
    crate: [3, 0, -2],
  },
  paths: {
    rail: { points: [[-5.5, 3], [-0.5, 3]], width: 0.2, height: 1.0 },   // a railing nobody may cross
  },
  lamps: [[5, 4], [-5, -4]],

  viewpoints: [
    { name: 'yard', eye: [0, 1.62, 5], look: [-4, 0.8, 9] },
    { name: 'rail', eye: [-3, 1.62, 6], look: [-3, 0.8, 3] },
    { name: 'gate', eye: [0, 1.62, 9], look: [3, 0.5, -2] },
    { name: 'above', eye: [12, 14, 12], look: [0, 0, 0] },
  ],
  spawn: { eye: [0, 1.62, 4], look: [0, 1.5, -5], mode: 'walk' },
};

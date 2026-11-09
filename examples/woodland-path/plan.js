// A short path at the edge of a deciduous wood. Metres, Y up, north toward negative Z.
const trail = [[-1, 16], [-0.5, 10], [0.6, 5], [0.7, 1], [-1, -5], [0.9, -11], [1.8, -18]];
const trees = [
  [2.5, 0, 8.2], [-3.7, -1.5, 7.3], [-5, 11, 7], [5.8, 8.4, 8.8], [-4.6, -8, 8.4],
  [4.4, -8.3, 7.2], [-3.5, -16, 8.7], [6.5, -15, 9], [9.2, -2.5, 10.1], [10, 12, 7.4],
  [-9.2, 5, 9.3], [-9, -4.5, 8.8], [-9.7, -13.5, 9.9], [13.3, -9.5, 10.5], [15, 3, 8.1],
  [-13.6, 12.4, 9.6], [11.9, -20.6, 9.3], [-12.5, -21, 10.1], [-6.5, -25, 8.6],
  [-1.4, -28, 10.3], [6.4, -26, 9.7], [17, -23, 11.3], [-18.5, -8, 9.9],
].map(([x, z, height]) => ({ pos: [x, 0, z], height }));
trees[0].trunkRadius = 0.46;

export default {
  name: 'woodland-path', seed: 'hazel-verge-01',
  bounds: [-14, -18, 14, 16], walk: { yMin: -1, yMax: 5 },
  paths: { trail: { points: trail, width: 2.1 } },
  regions: { meadow: { rect: [-14.4, -18.5, 14.4, 16.4] } },
  woodland: { trees, grassTufts: 5500 },
  render: {
    time: { elevation: 16, azimuth: 258 }, wind: { dir: [0.8, 0.6], strength: 0.8 },
    shadow: { center: [0, 3, 0], radius: 29 }, envProbe: [-0.8, 2.4, 6],
    fog: { groundDensity: 0.0015, height: 24 }, post: { grain: 0 },
  },
  budget: { singleFileMB: 5, frameMs: 16.7, calls: 150, triangles: 400000 },
  spawn: { eye: [-0.5, 1.62, 10], look: [0.5, 2.1, -4], mode: 'walk' },
  viewpoints: [
    { name: 'trailhead', eye: [-0.5, 1.62, 10], look: [0.5, 2.1, -4], mode: 'orbit' },
    { name: 'grass-at-eye-level', eye: [-3.3, 0.43, 6.8], look: [-2.4, 0.60, 3.5], mode: 'orbit' },
    { name: 'side-lit-crown', eye: [-0.8, 2.15, 1.8], look: [2.8, 6.3, 0], mode: 'orbit' },
    { name: 'trunk-and-turn', eye: [3.7, 1.45, 3.1], look: [1.8, 1.65, -2.0], mode: 'orbit' },
  ],
};

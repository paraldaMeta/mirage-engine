// A small yard between three houses: enough walls for the cutaway and the silhouette, crates whose tops the
// reachable fallback has to step off, a lamp for the night (?time=night).
export default {
  name: 'sprite-yard', seed: 'sprite-yard',
  bounds: [-14, -14, 14, 14], walk: { yMin: -1, yMax: 8 },
  houses: [
    { at: [-6, -5], size: [6, 4.5], height: 3.4, roof: 2.2, wall: [0.86, 0.79, 0.66], tile: [0.62, 0.27, 0.15] },
    { at: [6.5, -6], size: [5, 5], height: 4.2, roof: 2.4, wall: [0.68, 0.74, 0.62], tile: [0.2, 0.24, 0.3] },
    { at: [-7, 6.5], size: [4.5, 5.5], height: 3, roof: 2, wall: [0.88, 0.66, 0.48], tile: [0.52, 0.36, 0.2] },
  ],
  crates: [[2.6, 3.2], [3.6, 3.4], [2.9, 4.2]],
  wall: [[4, 9], [9, 9], [9, 4]],
  lamp: [0.5, -0.5],
  hero: [0, 0, 3],
  critters: [
    { shape: 'blob', at: [4, 0, -1], body: '#9fbf5a' },
    { shape: 'bird', at: [-3, 0, 1], body: '#d9b0c8' },
    { shape: 'crab', at: [5, 0, 6], body: '#b8653f' },
    { shape: 'blob', at: [-2, 0, -9], body: '#7aa6c8' },
  ],
  render: { time: { elevation: 34, azimuth: 225 }, shadow: { center: [0, 1, 0], radius: 20 }, post: { grain: 0 } },
  spawn: { eye: [0, 1.62, 6], look: [0, 1, 0], mode: 'walk' },
  viewpoints: [
    // the iso camera's own view (yaw 35, pitch 52, 22 m) of the hero; `hero`: where the still puts the hero
    { name: 'iso', eye: [7.77, 18.34, 14.09], look: [0, 1, 3], hero: [0, 0, 3] },
    { name: 'behind-house', eye: [1.77, 18.34, 2.59], look: [-6, 1, -8.5], hero: [-6, 0, -8.5] },
  ],
};

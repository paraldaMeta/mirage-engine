// The site plan of snow-hut: a log hut in a fenced yard on a snowy mountain slope at blue hour (metres; +X east,
// +Y up, +Z south; the yard is level at y = 0, the slope rises north). Every position more than one module needs
// is here; modules read it and never measure each other. Direction: BRIEF.md.
const F = 0.34;                        // hut floor top
export default {
  name: 'snow-hut',
  bounds: [-16.5, -12.5, 16.5, 14.5],  // the fenced yard (the fence and its proxies close it)
  walk: { yMin: -1, yMax: 6 },

  render: {
    place: { lat: 46, lon: 10, height: 1800, tzHours: 1 },      // a generic alpine slope, not a named site
    time: { elevation: -6, azimuth: 300 },                      // blue hour: the sun under the western ridge
    shadow: { center: [0, 2, -2], radius: 22 },
    envProbe: [2, 1.8, 6],
    fog: { groundDensity: 0.0035, height: 60, air: 0.0002, glow: 0.35 },
    post: { exposure: 0.4, bloom: 0.06 },
    clouds: 0.2,
    shadowRadius: 18,
  },
  budget: { frameMs: 8, triangles: 0.6e6, calls: 120, singleFileMB: 5 },

  ground: {
    yard: [-16, -12, 16, 14],          // the fence line; level snow inside (drifts ≤ 0.25 m away from the hut)
    calm: [-6, -8, 6, 2.5],            // around the hut: exactly level (y 0)
    grade: { north: 0.34, south: -0.12, side: 0.1 },            // slope per metre beyond the yard
    ridges: { from: 260, height: 320 },                         // mountains rising from 260 m out
    extent: 1400,                                               // the terrain's half size
  },
  fence: { rect: [-16, -12, 16, 14], post: 2.5, h: 1.1 },       // split-rail fence on the yard edge
  hut: {
    rect: [-3, -5.5, 3, -0.5],         // outer wall faces
    wall: 0.25, floor: F, eaves: F + 2.45, ridge: F + 4.1, overhang: 0.55,
    door: { x: 1.3, w: 1.0, h: 2.0 },  // in the south wall (z = -0.5), floor-level
    windows: [                          // [wall, centre along it (x or z), width, sill above floor, top above floor]
      ['south', -1.4, 1.1, 0.9, 1.85], ['west', -3.0, 0.9, 0.95, 1.75], ['north', 1.2, 0.7, 1.05, 1.65],
    ],
  },
  woodpile: { rect: [3.25, -4.6, 3.95, -1.4] },                 // against the east wall
  pines: { yard: [[-11, -8.5], [-12.5, 3.5], [11.5, -7], [10.5, 8.5], [-7, 10.5], [13, 1]], count: 220, r: [22, 240] },
  snow: { flakes: 7000, box: 36, fall: 0.85 },                  // flakes in a box that follows the camera, m/s

  regions: { yard: { rect: [-16, -12, 16, 14], y: 0 } },
  footprints: {
    hut: { rect: [-3.3, -5.8, 3.3, -0.2], y: F },
    woodpile: { rect: [3.25, -4.6, 3.95, -1.4], y: 0 },
  },
  paths: {
    route: { points: [[4, 11], [1.3, 1.5], [1.3, -1.6], [-1.2, -2.0], [-1.5, -3.9]], width: 1.4, y: 0 },
  },
  points: {
    door: [1.3, F, -0.5],               // floor centre of the doorway
    stove: [-2.2, F, -4.75],            // the stove's foot centre (inside, north-west corner), fire door facing +Z
    lantern: [0.45, F + 2.05, -0.2],    // the porch lantern beside the door (hangs from a bracket on the wall)
    lamp: [0.6, F + 1.95, -3.0],        // the lamp inside, over the table
  },

  viewpoints: [
    { name: 'arrival', eye: [4, 1.62, 11], look: [0, 1.8, -3] },
    { name: 'the porch', eye: [2.6, 1.62, 3.2], look: [0.6, 1.6, -1] },
    { name: 'through the door', eye: [1.3, F + 1.62, 0.8], look: [-2.2, 0.9, -4.6] },
    { name: 'the stove', eye: [-1.2, F + 1.62, -3.1], look: [-2.2, 0.8, -4.8] },
    { name: 'up the slope', eye: [-3, 1.62, 12.5], look: [-2, 9, -60] },
    { name: 'from the pines', eye: [-14, 1.8, -5.5], look: [0, 1.4, -2] },
    { name: 'aerial', eye: [26, 22, 34], look: [0, 0, -4] },
  ],
  spawn: { eye: [4, 1.62, 11], look: [0, 1.8, -3], mode: 'walk' },
  gameView: { eye: [4, 1.62, 6], look: [0, 1.62, -3] },
};

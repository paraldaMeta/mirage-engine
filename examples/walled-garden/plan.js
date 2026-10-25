// The site plan of walled-garden: a walled garden of three terraces rising north (+Z south, metres), a gate in
// the south wall, stairs on the axis, a pavilion with an interior on the top terrace. Every module reads its
// positions from here; nothing shared is hard-coded in a module.
const A = 36;                     // wall centre lines at x, z = ±A
const T = [0, 1.6, 3.2];          // terrace levels: lower, middle, upper
const TREAD = 0.36, STEPS = 9;    // 9 risers of 0.178 m per retaining wall
export default {
  name: 'walled-garden',
  bounds: [-40, -40, 40, 54],
  walk: { yMin: -1, yMax: 10 },
  enclosure: { half: A, height: 3.6, thickness: 0.6 },
  gate: { x: 0, z: A, width: 3.0, spring: 2.8, segment: 8, height: 5.0, thickness: 0.8 },
  levels: T,
  // terraces: z ranges (north edge, south edge) and level; the retaining walls stand on the boundaries
  terraces: [
    { name: 'lower', z: [8, A], y: T[0] },
    { name: 'middle', z: [-14, 8], y: T[1] },
    { name: 'upper', z: [-A, -14], y: T[2] },
  ],
  retaining: { thickness: 0.6, parapet: 0.8 },
  // stairs climb north on the axis; `z` is the retaining wall's centre line, they run south from its face
  stairs: [
    { x: 0, z: 8, width: 5, from: T[0], to: T[1], steps: STEPS, tread: TREAD },
    { x: 0, z: -14, width: 5, from: T[1], to: T[2], steps: STEPS, tread: TREAD },
  ],
  pavilion: { center: [0, T[2], -25], size: 9, plinth: 0.45, wall: 3.9, thickness: 0.4, door: 2.0, roof: 3.2 },
  basin: { center: [0, T[0], 24], r: 2.6, paving: 5.2 },
  pools: [{ rect: [-14, -2.5, -5, 4.5], y: T[1] }, { rect: [5, -2.5, 14, 4.5], y: T[1] }],
  paths: {
    approach: { points: [[0, 54], [0, A]], width: 4, y: T[0] },
    lowerAxis: { points: [[0, A], [0, 8.3]], width: 4, y: T[0] },
    lowerCross: { points: [[-A, 16], [A, 16]], width: 2.6, y: T[0] },
    middleAxis: { points: [[0, 7.7], [0, -13.7]], width: 4, y: T[1] },
    middleCross: { points: [[-A, -6], [A, -6]], width: 2.6, y: T[1] },
    upperAxis: { points: [[0, -14.3], [0, -19.4]], width: 4, y: T[2] },
    upperCross: { points: [[-A, -17], [A, -17]], width: 2.6, y: T[2] },
  },
  // lawn panels (hedged): [x0, z0, x1, z1] and level
  lawns: [
    ...[[6, 18.4, 31.5, 32.5], [-31.5, 18.4, -6, 32.5], [5, 11.8, 31.5, 14.4], [-31.5, 11.8, -5, 14.4]].map((r) => ({ rect: r, y: T[0] })),
    ...[[5, -12.6, 31.5, -8.3], [-31.5, -12.6, -5, -8.3], [17, -3.7, 31.5, 5.5], [-31.5, -3.7, -17, 5.5]].map((r) => ({ rect: r, y: T[1] })),
    ...[[8, -33, 31.5, -19.6], [-31.5, -33, -8, -19.6]].map((r) => ({ rect: r, y: T[2] })),
  ],
  trees: [[18.5, 25.5, 1.1], [-18.5, 25.5, 1.0], [24, 1, 0.9], [-24, 1, 0.95], [16, -26, 1.15], [-16, -26, 1.1]],
  cypresses: [...[30, 22, 14].flatMap((z) => [[33.5, z], [-33.5, z]]), ...[-26, -31].flatMap((z) => [[33.5, z], [-33.5, z]]),
    [-9, 44, 1.2], [9, 44, 1.1], [-17, 47], [21, 49], [-46, 20], [47, -8]],
  viewpoints: [
    { name: 'gate', eye: [1.2, 1.62, 47], look: [0, 3, 30] },
    { name: 'axis', eye: [2.2, 1.62, 33], look: [0, 4.5, -20] },
    { name: 'stairs', eye: [4.5, 1.62, 15.5], look: [0, 1.6, 8] },
    { name: 'pools', eye: [-2.5, 1.6 + 1.62, -4.6], look: [-10, 1.6, 2.5] },
    { name: 'pavilion', eye: [5.5, 3.2 + 1.62, -14.8], look: [0, 5.5, -25] },
    { name: 'interior', eye: [2.6, 3.65 + 1.62, -21.6], look: [-2.5, 4.6, -28] },
    { name: 'looking back', eye: [-1.2, 3.2 + 1.62, -15.6], look: [2, 1, 20] },
    { name: 'aerial', eye: [44, 34, 50], look: [0, 0, -2] },
    { name: 'lawn corner', eye: [30, 1.62, 34], look: [8, 2, 18] },
  ],
  spawn: { eye: [0, 1.62, 45], look: [0, 1.62, 30], mode: 'walk' },
  gameView: { eye: [3, 1.62, 15], look: [0, 1.62, 8] },   // where tools put the game-view figure
  regions: {
    lower: { rect: [-A, 8, A, A], y: T[0] }, middle: { rect: [-A, -14, A, 8], y: T[1] }, upper: { rect: [-A, -A, A, -14], y: T[2] },
  },
  footprints: {
    pavilion: { rect: [-4.5, -29.5, 4.5, -19.4] }, basin: { circle: [0, 24, 2.6] },
    stairsLower: { rect: [-2.9, 8.3, 2.9, 8.3 + (STEPS - 1) * TREAD] }, stairsMiddle: { rect: [-2.9, -13.7, 2.9, -13.7 + (STEPS - 1) * TREAD] },
  },
};

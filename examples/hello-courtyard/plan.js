// The site plan of hello-courtyard: every position the modules share lives here (metres; +X east, +Z south).
const S = 7.5;   // half the courtyard's inner span to the wall centre lines
export default {
  name: 'hello-courtyard',
  bounds: [-12, -12, 12, 17],          // the court and the ground outside the gate (the walk grid)
  walk: { yMin: -1, yMax: 7 },
  court: { half: S, wallHeight: 3.8, thickness: 0.6 },
  regions: {
    court: { rect: [-S + 0.3, -S + 0.3, S - 0.3, S - 0.3], y: 0 },
    outside: { rect: [-12, S + 0.3, 12, 17], y: 0 },
  },
  footprints: {
    basin: { circle: [0, 0, 1.86] },
    pergola: { rect: [-3.6, -S + 0.3, 3.6, -S + 2.5] },
    bench: { rect: [-3, -S + 0.3, 3, -S + 0.8] },
  },
  points: {
    gate: [0, 0, S],
    palm: [-3.6, 0, 3.2],
    jarsNorthWest: [-5.7, 0, -5.6],
    jarsGate: [3.3, 0, 6.2],
  },
  cypresses: [[-11, -9, 9], [-13.5, -4, 7.5], [10.5, -11, 8.2], [12.5, 6, 6.8], [-12, 9, 8]],
  viewpoints: [
    { name: 'hero', eye: [5.9, 1.45, 6.1], look: [-2.2, 2.0, -2.6], mode: 'orbit' },   // M1b's stills
    { name: 'corner', eye: [5.6, 1.75, 5.9], look: [-2.5, 2.3, -2.8], mode: 'orbit' },
    { name: 'gate', eye: [0.6, 1.62, 13.5], look: [0, 1.8, 0] },
    { name: 'pergola', eye: [2.6, 1.62, -4.2], look: [-3.5, 1.4, -6.4] },
    { name: 'basin', eye: [-1.8, 1.62, 2.6], look: [0.4, 0.8, -0.6] },
    { name: 'above', eye: [9, 14, 15], look: [0, 0, 0] },
  ],
  spawn: { eye: [0.4, 1.62, 5.4], look: [0, 1.5, -6], mode: 'walk' },
  gameView: { eye: [2, 1.62, 3.5], look: [0, 1.6, 0] },   // where tools put the game-view figure
};

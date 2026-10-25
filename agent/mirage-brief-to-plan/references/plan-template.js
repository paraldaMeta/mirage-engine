// The site plan of <name>: every position more than one module needs (metres; +X east, +Y up, +Z south).
// Modules read from here and never measure each other. Checked by definePlan() (@mirage/world).
export default {
  name: '<name>',
  // seed: '<name>',                    // default: name. Every module's ctx.R derives from it.
  bounds: [-40, -40, 40, 40],          // walkable rectangle [x0, z0, x1, z1] (walk grid: 0.125 m cells)
  walk: { yMin: -1, yMax: 10 },        // lowest / highest walkable floor + head room

  // how it looks: passed to createWorldRenderer by main.js
  render: {
    place: { lat: 45, lon: 5, height: 100, tzHours: 1 },        // a generic site, not a named one
    time: 'golden',                    // 'golden' | { day: 'YYYY-MM-DD', time: 'HH:MM' } | { elevation, azimuth }
    shadow: { center: [0, 2, 0], radius: 40 },   // the sun's shadow map covers this sphere
    envProbe: [0, 3, 0],               // image-based light capture point: open air, near eye height
    fog: { groundDensity: 0.0018, height: 40 },
    post: {},                          // exposure, saturation, contrast, vignette, bloom ... (core README)
    shadowRadius: 26,                  // play: the moving shadow window around the viewer
  },
  budget: { frameMs: 8, triangles: 1.0e6, calls: 150, singleFileMB: 5 },

  regions: {                           // areas: { rect: [x0, z0, x1, z1] } | { circle: [x, z, r] } | { poly: [[x, z], ...] }, y = level
    // court: { rect: [-10, -10, 10, 10], y: 0 },
  },
  footprints: {                        // what a structure occupies; other modules keep out
    // tower: { circle: [0, -20, 3] },
  },
  paths: {                             // { points: [[x, z], ...], width, y }
    // main: { points: [[0, 38], [0, -15]], width: 3, y: 0 },
  },
  points: {                            // named spots [x, y, z]
    // door: [0, 0, -17],
  },
  // shared parameters (heights, widths, levels) go here as named objects, e.g.
  // deck: { y: 2.0, width: 4 },

  viewpoints: [                        // 6-9, eye height 1.62 m above the floor; keys 1-9; the playtest's stills
    { name: 'arrival', eye: [0, 1.62, 35], look: [0, 2, 0] },
    { name: 'aerial', eye: [45, 35, 45], look: [0, 0, 0] },
  ],
  spawn: { eye: [0, 1.62, 35], look: [0, 1.62, 0], mode: 'walk' },
  gameView: { eye: [0, 1.62, 20], look: [0, 1.62, 0] },   // where tools put the game-view figure
};

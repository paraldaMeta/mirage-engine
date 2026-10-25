// The site plan of agent-trial: a seaside promenade, a timber pier running west out to sea, a lighthouse on the
// pier head, at dusk (metres; +X east, +Y up, +Z south; sea level y = 0). Every position more than one module
// needs is here; modules read it and never measure each other. Direction: BRIEF.md.
const Y = 2.4;                         // promenade and deck level above the sea
export default {
  name: 'agent-trial',
  bounds: [-74, -30, 14, 30],          // promenade, pier, pier head (the sea is not walkable)
  walk: { yMin: 1.5, yMax: 8 },        // nothing walkable below the deck; the seabed is out of the grid

  render: {
    place: { lat: 48, lon: -4, height: 10, tzHours: 1 },        // a generic Atlantic coast, not a named site
    time: { elevation: 1.2, azimuth: 262 },                     // dusk: the sun low over the sea, behind the lighthouse
    shadow: { center: [-30, 4, 0], radius: 48 },
    envProbe: [-20, 4.5, 0],
    fog: { groundDensity: 0.0012, height: 30 },
    post: {},
    shadowRadius: 26,
  },
  budget: { frameMs: 8, triangles: 0.6e6, calls: 120, singleFileMB: 5 },

  shore: {
    y: Y, x0: -2, x1: 10, z: [-30, 30],                          // the promenade's top and extent
    seawall: { bottom: -3 },                                    // the seawall face on x = x0, from the seabed up
    parapet: { h: 0.9, t: 0.4 },                                // sea side, on x0 ... x0 + t
    opening: [-2.3, 2.3],                                       // z range of the gap in the parapet (the pier entrance)
    landWall: { x: 10, t: 0.6, h: 1.3 },                         // land side, x ... x + t, h above the promenade
    land: 3.7,                                                  // ground level behind the land wall
    benches: [[9.4, -16], [9.4, -8], [9.4, 16]],                 // [x, z] bench centres against the land wall
    lamps: [[-1.0, -2.9], [-1.0, 2.9]],                          // [x, z] lamp posts either side of the entrance
  },
  lampPost: { h: 3.6 },                                          // ring (where the lantern sits) above the floor; shore and pier
  pier: { y: Y, x0: -2, end: -58, width: 4, bay: 4, rail: 1.05, lampEvery: 12, pile: 0.18, seabed: -3 },
  lighthouse: {
    center: [-64, Y, 0],
    plinth: { r: 2.8, h: 0.3 },                                 // one step up from the deck
    base: 2.6, top: 1.9,                                        // shaft radius at the plinth and at the gallery
    gallery: 14,                                                // gallery floor above the deck
    band: [8.4, 9.8],                                           // the red band, metres above the deck
    lantern: { r: 1.3, h: 2.4 },                                // glazing radius and height above the gallery
  },

  regions: {
    promenade: { rect: [-2, -30, 10, 30], y: Y },
    sea: { rect: [-3000, -3000, -2, 3000], y: 0 },
  },
  footprints: {
    pierHead: { rect: [-70, -6, -58, 6], y: Y },
    lighthouse: { circle: [-64, 0, 2.8] },
  },
  paths: {
    pier: { points: [[-2, 0], [-58, 0]], width: 4, y: Y },
    route: { points: [[6, 8], [0, 0], [-58, 0], [-60.3, 1.4]], width: 2, y: Y },   // the walk the brief describes
  },
  points: {
    pierEntrance: [-2, Y, 0],
    lighthouseDoor: [-61.4, Y + 0.3, 0],                         // floor centre of the door on the shaft's face (east)
    lever: [-61.65, Y + 1.1, 1.3],                               // the lever's pivot, on the shaft beside the door
  },

  viewpoints: [
    { name: 'promenade', eye: [6, Y + 1.62, 8], look: [-64, 9, 0] },
    { name: 'pier entrance', eye: [1, Y + 1.62, -3.5], look: [-40, Y + 1, 1] },
    { name: 'on the pier', eye: [-30, Y + 1.62, 1.2], look: [-64, 8, 0] },
    { name: 'pier head', eye: [-58.5, Y + 1.62, 4.8], look: [-64, 10, 0] },
    { name: 'the lever', eye: [-60.2, Y + 1.62, 1.8], look: [-61.65, Y + 1.0, 1.3] },
    { name: 'looking back', eye: [-60, Y + 1.62, -3.5], look: [6, 3, 0] },
    { name: 'from the sea', eye: [-44, 5, 26], look: [-52, 6, 0] },
    { name: 'aerial', eye: [24, 32, 44], look: [-32, 0, 0] },
  ],
  spawn: { eye: [6, Y + 1.62, 8], look: [-64, Y + 1.62, 0], mode: 'walk' },
  gameView: { eye: [-20, Y + 1.62, 0], look: [-40, Y + 1.62, 0] },
};

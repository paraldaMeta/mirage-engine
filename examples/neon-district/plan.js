// The site plan of neon-district: one block of a rain-wet city at night (+X east, +Z south, metres).
//
//   z = -30 ┌──────────────┬──────────┬─────────────────────────┬────┐
//           │   tower W    │ tower N  │  RELAY (room, stairwell, │    │
//   z = -20 │              │          │  roof at y = 6)          │ E  │
//           │         ┌────┴────┐     ├─────────────────────────┤ a  │
//   z =  -9 │         │ NOODLE  │  C  │                         │ s  │
//           │         │  BAR    │     │         PLAZA           │ t  │
//   z =   2 ├─────────┴──door───┴─────┴─────────────────────────┴────┤
//           │                 KESTREL STREET  (z 2 .. 10)             │
//   z =  10 ├────────┬───┬───────────────────────────────────────────┤
//           │   SW   │ a │        south blocks                        │
//   z =  34 └────────┴───┴───────────────────────────────────────────┘
//          x = -34  -24 -20                                       x = 34
//
// The route: the alley (spawn) -> the street -> the noodle bar (the pass) -> the plaza -> the relay (door, room,
// stairs) -> the roof (the uplink). Every module reads its positions from here; nothing shared is hard-coded.
const KERB = 0.14;              // pavements and the plaza stand this far above the carriageway
const FLOOR = 0.16;             // interior floors (a threshold at each door)
const ROOF = 6;                 // the relay's roof
const RISERS = 17, RISE = (ROOF / 2) / RISERS, TREAD = 0.28;   // two flights of 17 risers (0.176 m), treads 0.28 m

export default {
  name: 'neon-district',
  bounds: [-34, -30, 34, 34],
  walk: { yMin: -1, yMax: 12 },
  budget: { frameMs: 16, triangles: 900000 },
  levels: { kerb: KERB, floor: FLOOR, roof: ROOF },

  // ---- the open ground
  street: { rect: [-34, 2, 34, 10], road: [3.6, 8.4] },                 // z range of the carriageway inside it
  alley: { rect: [-24, 10, -20, 32], fence: 32 },                       // closed by a fence at its south end
  plaza: { rect: [6, -20, 30, 2], monument: [18, -9], plinth: 2.3 },

  // ---- buildings: solid boxes; `style` picks the facade, `sign` hangs a big sign on a face
  //      face: 'n' | 's' | 'e' | 'w' (the side it looks out of)
  //      signs: { face, at (x along a north / south face, z along an east / west one), y (centre), w, h, text, color,
  //      kind: 'board' (flat on the wall) | 'blade' (sticking out, glyphs stacked) }
  blocks: [
    { name: 'sw', rect: [-34, 10, -24, 34], h: 22, style: 'concrete', signs: [
      { face: 'n', at: -29, y: 6.4, w: 1.1, h: 3.4, text: '旅館', color: 'pink', kind: 'blade' },
      { face: 'e', at: 13.5, y: 3.3, w: 1.7, h: 0.8, text: '24H', color: 'amber' },
      { face: 'e', at: 21, y: 4.4, w: 0.8, h: 2.6, text: '按摩', color: 'violet', kind: 'blade' } ] },
    { name: 's1', rect: [-20, 10, -4, 34], h: 17, style: 'panel', signs: [
      { face: 'n', at: -12, y: 5.1, w: 5.4, h: 1.25, text: 'KESTREL ARCADE', color: 'cyan' },
      { face: 'n', at: -5.4, y: 7.2, w: 1.1, h: 3.2, text: '電玩', color: 'green', kind: 'blade' },
      { face: 'w', at: 27, y: 3.2, w: 1.5, h: 0.6, text: 'EXIT', color: 'green' } ] },
    { name: 's2', rect: [-4, 10, 14, 34], h: 36, style: 'glass', signs: [
      { face: 'n', at: 5, y: 5.6, w: 6, h: 1.5, text: 'SYN·TEK', color: 'violet' },
      { face: 'n', at: 5, y: 24, w: 9, h: 4.6, text: ['ΛRC', 'BIO'], color: 'pink', second: '#19d8ff' },
      { face: 'n', at: 12.6, y: 7.6, w: 1.1, h: 3.2, text: '藥局', color: 'green', kind: 'blade' } ] },
    { name: 's3', rect: [14, 10, 34, 34], h: 21, style: 'concrete', signs: [
      { face: 'n', at: 24.5, y: 5.4, w: 6, h: 1.4, text: 'HOTEL NOVA', color: 'amber' },
      { face: 'n', at: 16.2, y: 8, w: 1.1, h: 3.2, text: '酒吧', color: 'pink', kind: 'blade' } ] },
    { name: 'westcap', rect: [-42, -2, -34, 14], h: 30, style: 'glass', signs: [
      { face: 'e', at: 6, y: 13, w: 3.2, h: 10, text: '新城', color: 'pink', vertical: true } ] },
    { name: 'eastcap', rect: [34, -2, 42, 14], h: 32, style: 'panel', signs: [
      { face: 'w', at: 6, y: 13.5, w: 2.6, h: 12, text: 'KESTREL', color: 'cyan', vertical: true } ] },
    { name: 'w', rect: [-34, -30, -22, 2], h: 27, style: 'panel', signs: [
      { face: 's', at: -28.4, y: 5.4, w: 4.4, h: 1.2, text: 'PAWN · 當', color: 'amber' },
      { face: 's', at: -23.3, y: 8, w: 1.1, h: 3.2, text: '當鋪', color: 'amber', kind: 'blade' } ] },
    { name: 'n', rect: [-22, -30, -10, -9], h: 31, style: 'glass', signs: [
      { face: 's', at: -16, y: 23, w: 8, h: 5, text: '夢', color: 'violet' } ] },
    { name: 'c', rect: [-10, -30, 6, 2], h: 20, style: 'concrete', signs: [
      { face: 's', at: -2.4, y: 5.2, w: 5.2, h: 1.3, text: 'MIRAGE', color: 'cyan' },
      { face: 'e', at: -7.5, y: 7.2, w: 7.5, h: 1.9, text: '夜市 NIGHT MARKET', color: 'pink' },
      { face: 'e', at: -16.2, y: 4.6, w: 3.2, h: 0.95, text: 'TATTOO', color: 'violet' } ] },
    { name: 'e', rect: [30, -30, 34, 2], h: 19, style: 'panel', signs: [
      { face: 'w', at: -6, y: 6.6, w: 6.4, h: 1.5, text: 'DATA·HAVEN', color: 'green' },
      { face: 'w', at: -15.5, y: 8.4, w: 1.1, h: 3.2, text: '銀行', color: 'cyan', kind: 'blade' } ] },
    { name: 'barUpper', rect: [-22, -9, -10, 2], y: 3.7, h: 14, style: 'panel', signs: [   // the floors over the bar
      { face: 's', at: -16, y: 4.7, w: 5.4, h: 1.35, text: '麵 NOODLES', color: 'pink', second: '#ffb347' },
      { face: 's', at: -10.9, y: 7.4, w: 1.1, h: 3.2, text: '拉麵', color: 'amber', kind: 'blade' } ] },
  ],
  // scenery beyond the walkable block (no collision needed, seen over the roofs)
  skyline: [
    { rect: [-30, -62, -14, -38], h: 64 }, { rect: [-8, -70, 6, -40], h: 92 }, { rect: [12, -58, 30, -36], h: 54 },
    { rect: [36, -66, 54, -40], h: 78 }, { rect: [-56, -40, -44, -10], h: 58 }, { rect: [-58, 18, -46, 44], h: 46 },
    { rect: [46, -22, 60, 0], h: 66 }, { rect: [48, 16, 62, 40], h: 50 }, { rect: [-24, 40, -6, 58], h: 60 },
    { rect: [4, 40, 22, 62], h: 84 }, { rect: [28, 42, 44, 60], h: 44 },
  ],

  // ---- interior 1: the noodle bar (probe GI + a reflection probe)
  bar: {
    rect: [-22, -9, -10, 2], height: 3.4, wall: 0.4,
    door: { x: -16, width: 1.8, height: 2.4 },                          // in the south wall (z = 2)
    windows: [{ x: -20, width: 2.6 }, { x: -12.2, width: 2.6 }],        // shop windows either side, sill 0.9, to 2.5
    counter: { rect: [-21, -6.2, -13.2, -5.3], height: 1.05 },
    pass: [-17, 1.25, -5.75],                                         // where the relay pass lies (on the counter)
  },
  // ---- interior 2: the relay (ambient volume + a reflection probe), its stairwell and the roof
  relay: {
    rect: [6, -30, 30, -20], height: 3.6, wall: 0.5, roof: ROOF, parapet: 1.1,
    room: [6.5, -29.5, 22.3, -20.5],
    door: { x: 14, width: 1.9, height: 2.5 },                           // in the south wall (z = -20), on the plaza
    stair: { rect: [23.3, -28.7, 28.7, -21.3], top: 8.8, risers: RISERS, rise: RISE, tread: TREAD, width: 2.5,
      foot: -23.0, door: { z: -22.15, width: 1.2, height: 2.3 } },      // doors in its west wall: ground and roof
    uplink: [9.5, ROOF, -25],                                           // the console on the roof
  },

  // ---- things modules place and the game spawns on (one [x, y, z] per name)
  points: {
    monument: [18, KERB, -9],
    billboard: [0, 26, -40],            // the big holo board on the skyline tower
    relayDoor: [14, KERB, -20],
    uplink: [9.5, ROOF, -25],
  },
  lamps: [   // street lamps: [x, z, side] (side: which way the arm reaches, +1 south / -1 north)
    [-28, 2.7, 1], [-6, 2.7, 1], [16, 2.7, 1], [-17, 9.3, -1], [5, 9.3, -1], [27, 9.3, -1],
    [8.5, -17.5, 1], [27.5, -17.5, 1], [8.5, -0.5, -1], [27.5, -0.5, -1],
  ],
  vents: [[-23.2, 0, 24], [-20.8, 0, 14.5], [-9, KERB, 9.2], [22, KERB, 2.9], [28.6, KERB, -12]],   // steam
  cover: [   // low concrete barriers and planters: [x, z, rotY, length]
    [-12, 6.9, 0.2, 2.4], [-1.5, 4.6, -0.15, 2.4], [9.5, 7.2, 0.1, 2.4],
    [11, -4, 1.57, 3], [24.5, -5.5, 1.57, 3], [12.5, -14, 0, 3], [23.5, -14.5, 0, 3], [18, -2.2, 0, 3.2],
  ],
  cars: [[-21.5, 7.3, 0.03, 'teal'], [2.5, 4.7, 3.12, 'amber'], [22, 7.25, -0.04, 'white']],   // parked: [x, z, rotY, paint]
  roofUnits: [[12.5, -27.6, 2.6, 1.5], [17.5, -22.2, 2.2, 1.4], [20.2, -27.8, 1.6, 1.3]],       // HVAC: [x, z, length, height]

  // ---- the game: who stands where (feet), pickups, checkpoints
  enemies: [
    { id: 'g0', at: [-22, 0, 15], face: 1.57, zone: 'alley' },
    { id: 'g1', at: [-10, KERB, 9], face: 3.14, zone: 'street', patrol: [[-10, 9.2], [2, 9.2]] },
    { id: 'g2', at: [-3, 0, 5.5], face: 3.14, zone: 'street' },
    { id: 'g3', at: [8, 0, 6.2], face: 3.14, zone: 'street', kind: 'heavy' },
    { id: 'g4', at: [-13, FLOOR, -3], face: 0, zone: 'bar' },
    { id: 'g5', at: [10, KERB, -6], face: 1.57, zone: 'plaza', patrol: [[10, -6], [10, -16]] },
    { id: 'g6', at: [22, KERB, -3.5], face: 3.14, zone: 'plaza' },
    { id: 'g7', at: [26, KERB, -15], face: 3.14, zone: 'plaza', kind: 'heavy' },
    { id: 'g8', at: [15, KERB, -17], face: 1.57, zone: 'plaza' },
    { id: 'g9', at: [10, FLOOR, -26], face: 1.57, zone: 'relay' },
    { id: 'g10', at: [19, FLOOR, -24], face: 3.14, zone: 'relay', kind: 'heavy' },
    // the last wave: they come up the stairs once the uplink runs
    { id: 'w0', at: [24.5, FLOOR, -22], face: 0, zone: 'wave' },
    { id: 'w1', at: [20, FLOOR, -26], face: 0, zone: 'wave' },
    { id: 'w2', at: [16, FLOOR, -22], face: 0, zone: 'wave', kind: 'heavy' },
  ],
  // kites: flying drones, where each hovers until it is woken ([x, y, z] in the air)
  drones: [
    { id: 'd0', at: [-4, 5.2, 6], zone: 'street' }, { id: 'd1', at: [19, 6.4, -3], zone: 'plaza' }, { id: 'd2', at: [25, 6, -15], zone: 'plaza' },
    { id: 'd3', at: [13, 10.5, -17], zone: 'wave' }, { id: 'd4', at: [19, 11, -16], zone: 'wave' },
  ],
  pickups: [
    { id: 'ammo0', kind: 'ammo', at: [-23.3, 0, 19.5] }, { id: 'med0', kind: 'med', at: [-27, KERB, 9.2] },
    { id: 'ammo1', kind: 'ammo', at: [-20.5, FLOOR, -8.2] }, { id: 'med1', kind: 'med', at: [-11, FLOOR, 0.8] },
    { id: 'ammo2', kind: 'ammo', at: [7, KERB, -1] }, { id: 'med2', kind: 'med', at: [29, KERB, -19] },
    { id: 'ammo3', kind: 'ammo', at: [7.2, FLOOR, -29] }, { id: 'med3', kind: 'med', at: [21.5, FLOOR, -29] },
    { id: 'ammo4', kind: 'ammo', at: [7.5, ROOF, -21.2] }, { id: 'med4', kind: 'med', at: [22, ROOF, -29] },
  ],
  checkpoints: [   // boxes [[min], [max]] the player crosses; the game saves there
    { id: 'street', box: [[-24, -1, 8], [-20, 4, 10.5]] },
    { id: 'plaza', box: [[4.5, -1, 2], [7.5, 4, 10]] },
    { id: 'roof', box: [[21.5, 5.5, -23], [23.3, 9, -21.3]] },
  ],
  audio: { zones: [
    { name: 'bar', box: [-22, 0, -9, -10, 3.6, 2], fade: 1.5, reverb: 'room', wet: 0.5 },
    { name: 'relay', box: [6, 0, -30, 30, 3.8, -20], fade: 1.5, reverb: 'hall', wet: 0.55 },
  ] },

  viewpoints: [
    { name: 'alley', eye: [-22, 1.62, 29.5], look: [-22, 2.4, 10] },
    { name: 'street west', eye: [-29.5, 1.62, 6.4], look: [8, 3.4, 5] },
    { name: 'street east', eye: [29, 1.76, 3.2], look: [-10, 4, 6.5] },
    { name: 'bar front', eye: [-14.5, 1.76, 9.2], look: [-16.5, 2.2, 2] },
    { name: 'bar inside', eye: [-11.4, 1.78, 0.6], look: [-19, 1.3, -6.5] },
    { name: 'plaza', eye: [10.2, 1.76, 0.9], look: [19, 3.6, -11] },
    { name: 'monument', eye: [24, 1.76, -3.2], look: [17.6, 4, -9.5] },
    { name: 'relay room', eye: [8.4, 1.78, -22.6], look: [19, 1.5, -27] },
    { name: 'stairwell', eye: [24.5, 1.78, -21.9], look: [24.6, 2.6, -27] },
    { name: 'roof', eye: [21.4, ROOF + 1.62, -24.9], look: [9.5, ROOF + 1.1, -25.2] },
    { name: 'roof vista', eye: [9, ROOF + 1.62, -21.3], look: [20, 2.5, 5] },
    { name: 'aerial', eye: [40, 46, 36], look: [0, 0, -6], mode: 'fly' },
  ],
  spawn: { eye: [-22, 1.62, 29.5], look: [-22, 1.7, 10], mode: 'walk' },
  regions: {
    alley: { rect: [-24, 10, -20, 32] }, street: { rect: [-34, 2, 34, 10] }, plaza: { rect: [6, -20, 30, 2], y: KERB },
    roof: { rect: [6.5, -29.5, 23, -20.5], y: ROOF },
  },
  footprints: {
    bar: { rect: [-22, -9, -10, 2] }, relay: { rect: [6, -30, 30, -20] }, monument: { circle: [18, -9, 2.3] },
  },
  paths: {
    street: { points: [[-22, 9], [-10, 6], [6, 6]], width: 3 },
  },
};

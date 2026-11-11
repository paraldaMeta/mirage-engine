// The weapon set as data (weapon.js reads it; the HUD, the ammunition and the tests read it too).
//   kind      'hitscan' (a ray per round), 'pellets' (a ray per pellet), 'rocket' (a projectile, splash on impact)
//   auto      held fire repeats at `rate`; a semi-automatic repeats at `hold` while held (touch-friendly)
//   reserve   Infinity: never runs dry (the sidearm). `locked`: slots 4 and 5 until the 0 key unlocks them
//   per       how many of this gun's rounds one unit of ammunition is worth (a cell is 24 units, a crate 48): ammo.js
//   recoil    climb (rad a round, rising by `ramp` a round in a burst), side (a fixed pattern, x climb), rand (rad),
//             back (the gun's kick, m), roll (rad), fov (degrees of punch), shake (screen), recover (1/s)
//   spread    hip / ads (rad), bloom (rad a round, decays at `decay` 1/s), move (rad per m/s), max
export const ARMS = [
  { id: 'sidearm', slot: 1, model: 'pistol', kind: 'hitscan', auto: false, mag: 12, reserve: Infinity, max: Infinity, rate: 0.16, hold: 0.3, damage: 21, reload: 1.25, range: 90,
    spread: { hip: 0.011, ads: 0.0025, bloom: 0.012, decay: 3, move: 0.0024, max: 0.045 },
    recoil: { climb: 0.02, ramp: 0.05, side: [0.25, -0.35, 0.3, -0.2, 0.4], rand: 0.004, back: 0.05, roll: 0.06, fov: 1.6, shake: 0.28, recover: 10 },
    adsFov: 52, flash: { gain: 20, scale: 0.75 }, tracer: { width: 0.014, color: '#ffe2b8', life: 0.04 }, shell: 'brass', sound: 'pistol', dry: 'nd_dry_light', per: 0,
    haptic: { strong: 0.25, weak: 0.55, ms: 70, phone: 18 }, cross: 'dot', walk: 1 },
  { id: 'carbine', slot: 2, model: 'carbine', kind: 'hitscan', auto: true, mag: 24, reserve: 96, max: 168, rate: 0.095, damage: 22, reload: 1.7, range: 120,
    spread: { hip: 0.008, ads: 0.0025, bloom: 0.0045, decay: 3.4, move: 0.002, max: 0.04 },
    recoil: { climb: 0.0088, ramp: 0.03, side: [0.1, 0.25, -0.15, 0.35, -0.3, 0.45, -0.1, -0.4, 0.3, -0.2], rand: 0.0025, back: 0.03, roll: 0.035, fov: 0.9, shake: 0.22, recover: 7 },
    adsFov: 44, flash: { gain: 22, scale: 1 }, tracer: { width: 0.022, color: '#ffd9a0', life: 0.055 }, shell: 'brass', sound: 'carbine', dry: 'nd_dry_light', per: 1,
    haptic: { strong: 0.35, weak: 0.6, ms: 55, phone: 14 }, cross: 'ticks', walk: 1 },
  { id: 'shotgun', slot: 3, model: 'shotgun', kind: 'pellets', pellets: 9, auto: false, mag: 6, reserve: 18, max: 36, rate: 0.82, hold: 0.82, damage: 12, falloff: [7, 22, 0.3], shieldK: 3.2, shieldRange: 8,
    reload: 0.5, reloadFirst: 0.42, shellByShell: true, range: 40,
    spread: { hip: 0.055, ads: 0.038, bloom: 0.012, decay: 2.5, move: 0.002, max: 0.08 },
    recoil: { climb: 0.055, ramp: 0, side: [0.2, -0.25, 0.15], rand: 0.008, back: 0.09, roll: 0.12, fov: 3.2, shake: 0.75, recover: 6 },
    adsFov: 54, flash: { gain: 40, scale: 1.6 }, tracer: { width: 0.012, color: '#ffd090', life: 0.05 }, shell: 'hull', sound: 'shotgun', dry: 'nd_dry_heavy', per: 0.25,
    haptic: { strong: 0.85, weak: 0.7, ms: 140, phone: 45 }, cross: 'ring', walk: 0.95 },
  { id: 'rocket', slot: 4, model: 'rocket', kind: 'rocket', locked: true, auto: false, mag: 1, reserve: 4, max: 6, rate: 1.0, hold: 1.0, damage: 220, splash: 5.5, selfK: 0.35, speed: 34, reload: 2.6, range: 160,
    spread: { hip: 0.004, ads: 0.0015, bloom: 0, decay: 1, move: 0.002, max: 0.02 },
    recoil: { climb: 0.06, ramp: 0, side: [0.15], rand: 0.006, back: 0.12, roll: 0.05, fov: 4, shake: 0.9, recover: 4 },
    adsFov: 40, flash: { gain: 60, scale: 1.4 }, shell: null, sound: 'rocket', dry: 'nd_dry_heavy', per: 1 / 24,
    haptic: { strong: 1, weak: 0.6, ms: 220, phone: 80 }, cross: 'chevron', walk: 0.88 },
  { id: 'gatling', slot: 5, model: 'gatling', kind: 'hitscan', locked: true, auto: true, mag: 200, reserve: 200, max: 400, rate: 0.042, damage: 11, reload: 3.0, range: 100,
    spinUp: 0.7, spinDown: 1.4, heatPer: 0.018, cool: 0.34, ventTo: 0.3,
    spread: { hip: 0.02, ads: 0.013, bloom: 0.0012, decay: 2, move: 0.002, max: 0.045 },
    recoil: { climb: 0.0032, ramp: 0.01, side: [0.6, -0.6, 0.9, -0.3, -0.8, 0.4], rand: 0.0022, back: 0.012, roll: 0.012, fov: 0.35, shake: 0.12, recover: 5 },
    adsFov: 56, flash: { gain: 26, scale: 1.1 }, tracer: { width: 0.02, color: '#ffc880', life: 0.04, every: 2 }, shell: 'brass', sound: 'gatling', dry: 'nd_dry_heavy', per: 2.5,
    haptic: { strong: 0.55, weak: 0.9, ms: 60, phone: 12 }, cross: 'brackets', walk: 0.8, walkFiring: 0.5 },
];
export const ARM = Object.fromEntries(ARMS.map((a) => [a.id, a]));

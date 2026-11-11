// Mirage original code. The data of the destructibles (destruct.js): damage kinds, the material classes with their
// default stages, debris, particles and sounds, the particle effects (vfx JSON) and the break sounds, made in code.
// Everything here is plain data or a pure function: a game overrides any field through createDestructibles'
// `materials` option or per prop in add(spec).
// ---------------------------------------------------------------------------
import { sfc32, hash32 } from '@miragekit/core/rng';

/** the damage kinds hit() and blast() take (armour is a multiplier per kind: 0 immune, 1 as dealt) */
export const DAMAGE_KINDS = ['bullet', 'pellet', 'blast', 'melee', 'emp', 'fire'];

// A class: health (damage points to break), armour per kind, pierce (the share of a bullet's damage that goes on
// through it: thin things), stages (at: the share of health lost; mark: a decal on the surface where it was hit,
// grow: the mark grows with the damage instead of a new one per hit; flicker: its lamps stutter; state: the broken
// state generator to show early, e.g. a dent), debris (what flies when it breaks), fx (particle effects by event),
// sound (the procedural sound set), value (a price for the tally).
// Debris: shape (glass | shard | chunk | flake | bolt), count, size [min, max] m (sizes are drawn on a power law: many
// small, a few large), speed [min, max] m/s along the hit plus a spread, up (a lift), bounce, friction, spin
// (rad/s), rest (s lying still before fading), colors.
const A = (bullet, pellet, blast, melee, emp, fire = 1) => ({ bullet, pellet, blast, melee, emp, fire });
export const DESTRUCT_MATERIALS = {
  glass: { health: 40, armour: A(1, 1, 2, 1.5, 0, 0.5), pierce: 0.85, value: 40, sound: 'glass',
    stages: [{ at: 0.01, mark: 'crack', grow: true }],
    debris: { shape: 'glass', count: 46, size: [0.025, 0.16], speed: [0.6, 3.2], spread: 0.55, up: 0.4, bounce: 0.18, friction: 0.7, spin: 14, rest: 4, colors: ['#d8eef2', '#b9dce4', '#e9f6f8'] },
    fx: { hit: 'glitter', break: 'glitter' }, hitSound: 'tick' },
  paper: { health: 8, armour: A(1, 1, 2, 1, 0, 3), pierce: 0.95, value: 2, sound: 'paper',
    stages: [{ at: 0.01, mark: 'hole' }],
    debris: { shape: 'flake', count: 22, size: [0.03, 0.08], speed: [0.4, 1.8], spread: 0.9, up: 1, bounce: 0.05, friction: 0.9, spin: 8, rest: 3, drag: 2.4, colors: ['#e8e2d2', '#d8cfb8', '#f2eee4'] },
    fx: { hit: 'scraps', break: 'scraps' } },
  wood: { health: 60, armour: A(0.8, 0.7, 1.5, 1.2, 0, 1.2), pierce: 0.2, value: 25, sound: 'wood',
    stages: [{ at: 0.01, mark: 'hole' }, { at: 0.55, mark: 'splinter' }],
    debris: { shape: 'chunk', count: 18, size: [0.04, 0.22], speed: [1, 4], spread: 0.7, up: 1.2, bounce: 0.25, friction: 0.6, spin: 9, rest: 5, colors: ['#8a6440', '#6e4e30', '#a07a50'] },
    fx: { hit: 'splinters', break: 'dust' } },
  cardboard: { health: 25, armour: A(1, 1, 1.6, 1.3, 0, 2), pierce: 0.7, value: 5, sound: 'cardboard',
    stages: [{ at: 0.01, mark: 'hole' }],
    debris: { shape: 'flake', count: 16, size: [0.05, 0.16], speed: [0.6, 2.4], spread: 0.8, up: 1, bounce: 0.1, friction: 0.85, spin: 7, rest: 4, drag: 1.2, colors: ['#a8875a', '#b8976a', '#8e7048'] },
    fx: { hit: 'scraps', break: 'dust' } },
  plastic: { health: 30, armour: A(1, 1, 1.4, 1, 0, 1.5), pierce: 0.5, value: 10, sound: 'plastic',
    stages: [{ at: 0.01, mark: 'hole' }],
    debris: { shape: 'chunk', count: 14, size: [0.02, 0.1], speed: [1, 3.5], spread: 0.7, up: 1, bounce: 0.45, friction: 0.5, spin: 12, rest: 4, colors: ['#d8d4cc', '#3a6ea8', '#c84a3a'] },
    fx: { hit: 'chips', break: 'chips' } },
  thinMetal: { health: 70, armour: A(0.6, 0.5, 1.2, 0.8, 0.2, 0.4), pierce: 0.3, value: 60, sound: 'metal',
    stages: [{ at: 0.01, mark: 'dent' }, { at: 0.6, state: 'dent' }],
    debris: { shape: 'bolt', count: 8, size: [0.03, 0.12], speed: [1.5, 4.5], spread: 0.6, up: 1.2, bounce: 0.4, friction: 0.5, spin: 16, rest: 5, colors: ['#8c9094', '#6a6e72'] },
    fx: { hit: 'sparks', break: 'sparks' }, hitSound: 'ping' },
  heavyMetal: { health: 400, armour: A(0.15, 0.1, 0.8, 0.2, 0.3, 0.2), pierce: 0, value: 300, sound: 'heavy', blocks: true,
    stages: [{ at: 0.01, mark: 'dent' }, { at: 0.5, state: 'dent' }],
    debris: { shape: 'bolt', count: 10, size: [0.05, 0.2], speed: [1, 3.5], spread: 0.6, up: 1, bounce: 0.3, friction: 0.6, spin: 8, rest: 6, colors: ['#5a5e62', '#46494c'] },
    fx: { hit: 'sparks', break: 'sparks' }, hitSound: 'ping' },
  ceramic: { health: 15, armour: A(1, 1, 2, 1.5, 0, 0.3), pierce: 0.1, value: 15, sound: 'ceramic',
    stages: [{ at: 0.01, mark: 'crack', grow: true }],
    debris: { shape: 'shard', count: 22, size: [0.02, 0.1], speed: [0.8, 3], spread: 0.6, up: 0.8, bounce: 0.2, friction: 0.7, spin: 12, rest: 5, colors: ['#ece8e0', '#d8d2c6', '#c0b8a8'] },
    fx: { hit: 'dust', break: 'dust' }, hitSound: 'tick' },
  liquid: { health: 20, armour: A(1, 1, 1.5, 1, 0, 0.5), pierce: 0.4, value: 8, sound: 'liquid', behave: { spillLiquid: true },
    stages: [{ at: 0.01, mark: 'hole', fx: 'spray' }],
    debris: { shape: 'chunk', count: 8, size: [0.02, 0.08], speed: [1, 3], spread: 0.6, up: 1, bounce: 0.3, friction: 0.6, spin: 10, rest: 4, colors: ['#c8c4bc', '#3a6ea8'] },
    fx: { hit: 'spray', break: 'splash' } },
  electronics: { health: 40, armour: A(1, 0.8, 1.5, 1, 4, 1), pierce: 0.2, value: 120, sound: 'electronics',
    stages: [{ at: 0.01, mark: 'hole', fx: 'sparks' }, { at: 0.3, flicker: true }],
    debris: { shape: 'chunk', count: 12, size: [0.02, 0.09], speed: [1, 3.5], spread: 0.7, up: 1, bounce: 0.35, friction: 0.6, spin: 12, rest: 5, colors: ['#2a2c30', '#3c6a3a', '#9a9ca0'] },
    fx: { hit: 'sparks', break: 'shorted' }, hitSound: 'zap' },
  fabric: { health: 20, armour: A(0.9, 0.9, 1.5, 0.8, 0, 3), pierce: 0.9, value: 6, sound: 'fabric',
    stages: [{ at: 0.01, mark: 'hole' }],
    debris: { shape: 'flake', count: 12, size: [0.03, 0.1], speed: [0.4, 1.6], spread: 0.9, up: 0.8, bounce: 0.05, friction: 0.9, spin: 6, rest: 3, drag: 2, colors: ['#5a4a6a', '#3a3a48'] },
    fx: { hit: 'fibres', break: 'dust' } },
  // a bystander robot (createDestructibles().actor): collapses instead of breaking apart
  actor: { health: 50, armour: A(1, 0.9, 1.5, 1, 2, 0.5), pierce: 0, value: 0, sound: 'electronics', stages: [{ at: 0.01, fx: 'sparks' }],
    debris: { shape: 'bolt', count: 6, size: [0.02, 0.07], speed: [1, 3], spread: 0.7, up: 1, bounce: 0.35, friction: 0.6, spin: 12, rest: 5, colors: ['#3a3c40', '#8a8c90'] },
    fx: { hit: 'sparks', break: 'shorted' }, hitSound: 'zap' },
};

// ---- particle effects (vfx JSON, see packages/core/src/vfx-data.js); keyed by the names the classes use
const smoke = (o) => ({ name: 'smoke', life: [1.6, 2.6], shape: { type: 'sphere', radius: 0.12 }, velocity: { speed: [0.3, 0.7], spread: 25 }, gravity: 0.4, drag: 0.8, wind: 0.5,
  turbulence: { strength: 0.4, scale: 1, speed: 0.4 }, size: [0.35, 0.6], sizeOverLife: [[0, 0.4], [1, 2]], color: [[0, '#2c2a28'], [1, '#6a6660']], alpha: [[0, 0], [0.15, 0.45], [1, 0]],
  rotation: [0, 360], spin: [-30, 30], render: { blend: 'alpha', lit: 1, soft: 0.4, sort: 'oldest', flipbook: { sheet: 'smoke', fps: 0, blend: true } }, ...o });
export const DESTRUCT_EFFECTS = {
  // glints thrown off broken glass: few, small, short and bright, falling with the shards (not a cloud of confetti)
  glitter: { name: 'dx-glitter', bursts: [{ time: 0, count: 26 }], duration: 0.1, life: [0.25, 0.7], shape: { type: 'sphere', radius: 0.08 }, velocity: { speed: [0.8, 2.6], spread: 50 }, gravity: -9.8, drag: 0.4,
    size: [0.012, 0.026], color: '#f4fbff', alpha: [[0, 1], [0.5, 0.8], [1, 0]], emissive: 3, render: { blend: 'add', sprite: 'star' } },
  dust: { name: 'dx-dust', bursts: [{ time: 0, count: 12 }], duration: 0.1, life: [0.6, 1.3], shape: { type: 'sphere', radius: 0.1 }, velocity: { speed: [0.2, 0.9], spread: 70 }, gravity: -0.3, drag: 2.4, wind: 0.6,
    size: [0.14, 0.3], sizeOverLife: [[0, 0.4], [1, 2]], color: '#a89a86', alpha: [[0, 0], [0.12, 0.38], [1, 0]], rotation: [0, 360], spin: [-40, 40], render: { blend: 'alpha', lit: 1, soft: 0.15 } },
  scraps: { name: 'dx-scraps', bursts: [{ time: 0, count: 8 }], duration: 0.1, life: [0.4, 0.9], shape: { type: 'sphere', radius: 0.05 }, velocity: { speed: [0.5, 1.6], spread: 60 }, gravity: -3, drag: 2,
    size: [0.02, 0.04], color: '#d8cfb8', alpha: [[0, 1], [1, 0]], rotation: [0, 360], spin: [-200, 200], render: { type: 'mesh', mesh: 'shard', lit: 1 } },
  splinters: { name: 'dx-splinters', bursts: [{ time: 0, count: 10 }], duration: 0.1, life: [0.4, 0.9], shape: { type: 'point' }, velocity: { speed: [1.5, 3.5], spread: 40 }, gravity: -9.8, drag: 0.5,
    size: [0.015, 0.035], color: '#9a7650', alpha: [[0, 1], [0.8, 1], [1, 0]], rotation: [0, 360], spin: [-400, 400], render: { type: 'mesh', mesh: 'shard', lit: 1 } },
  chips: { name: 'dx-chips', bursts: [{ time: 0, count: 8 }], duration: 0.1, life: [0.4, 0.8], shape: { type: 'point' }, velocity: { speed: [1.5, 3], spread: 45 }, gravity: -9.8, drag: 0.5,
    size: [0.01, 0.025], color: '#d8d4cc', alpha: [[0, 1], [0.8, 1], [1, 0]], rotation: [0, 360], spin: [-400, 400], render: { type: 'mesh', mesh: 'cube', lit: 1 } },
  fibres: { name: 'dx-fibres', bursts: [{ time: 0, count: 10 }], duration: 0.1, life: [0.8, 1.6], shape: { type: 'point' }, velocity: { speed: [0.3, 1], spread: 70 }, gravity: -0.6, drag: 2.5, wind: 1,
    size: [0.008, 0.016], color: '#c8c0d0', alpha: [[0, 0.8], [1, 0]], render: { blend: 'alpha', lit: 1 } },
  sparks: { name: 'dx-sparks', bursts: [{ time: 0, count: 18 }], duration: 0.1, life: [0.25, 0.6], shape: { type: 'point' }, velocity: { speed: [2.5, 6], spread: 45 }, gravity: -9.8, drag: 0.6,
    size: [0.012, 0.022], color: [[0, '#fff3d0'], [0.4, '#ffb84a'], [1, '#c8380a']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 7, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 } },
  // a short circuit: a shower of sparks and a puff of dark smoke
  shorted: { name: 'dx-shorted', emitters: [
    { name: 'sparks', bursts: [{ time: 0, count: 40 }, { time: 0.18, count: 16 }], duration: 0.3, life: [0.3, 0.9], shape: { type: 'sphere', radius: 0.1 }, velocity: { speed: [2, 6], spread: 70 }, gravity: -9.8, drag: 0.5,
      size: [0.012, 0.024], color: [[0, '#e8f4ff'], [0.3, '#ffd27a'], [1, '#c8380a']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 8, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 } },
    smoke({ bursts: [{ time: 0.05, count: 8 }], duration: 0.2 }),
  ] },
  spray: { name: 'dx-spray', bursts: [{ time: 0, count: 20 }], duration: 0.1, life: [0.3, 0.7], shape: { type: 'point' }, velocity: { speed: [1.5, 3.5], spread: 18 }, gravity: -9.8, drag: 0.4,
    size: [0.015, 0.03], color: '#cfe2ea', alpha: [[0, 0.85], [1, 0]], render: { type: 'stretched', sprite: 'drop', stretch: 0.01, lit: 1 } },
  splash: { name: 'dx-splash', bursts: [{ time: 0, count: 40 }], duration: 0.1, life: [0.4, 0.9], shape: { type: 'sphere', radius: 0.08 }, velocity: { speed: [1, 3], spread: 80 }, gravity: -9.8, drag: 0.3,
    size: [0.02, 0.04], color: '#d6e8f2', alpha: [[0, 0.9], [1, 0]], render: { type: 'stretched', sprite: 'drop', stretch: 0.012, lit: 1 } },
  blast: { name: 'dx-blast', emitters: [
    { name: 'fireball', bursts: [{ time: 0, count: 22 }], duration: 0.1, life: [0.35, 0.7], shape: { type: 'sphere', radius: 0.25 }, velocity: { speed: [0, 0.5], normal: [1.5, 5], spread: 180 }, drag: 3.5, gravity: 0.8,
      size: [0.7, 1.2], sizeOverLife: [[0, 0.4], [0.3, 1], [1, 1.3]], color: [[0, '#fff6d8'], [0.2, '#ffc050'], [0.55, '#ff5a1a'], [1, '#2a0d05']], alpha: [[0, 0.95], [0.6, 0.7], [1, 0]], emissive: [[0, 6], [0.5, 1.5], [1, 0]],
      rotation: [0, 360], spin: [-60, 60], render: { blend: 'premultiplied', additive: 0.7, soft: 0.4, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    { name: 'flash', bursts: [{ time: 0, count: 1 }], duration: 0.1, life: [0.14, 0.14], shape: { type: 'point' }, size: [4, 4], sizeOverLife: [[0, 0.4], [1, 1.2]], color: '#ffe2a8', alpha: [[0, 1], [1, 0]], emissive: 10, render: { blend: 'add', sprite: 'soft', soft: 0.5 } },
    smoke({ bursts: [{ time: 0.06, count: 16 }], duration: 0.2, life: [2, 3.2], shape: { type: 'sphere', radius: 0.5 }, size: [0.9, 1.4] }),
  ] },
  // persistent emitters (spawned, stopped on reset): steam from a cut pipe, water from a burst one, a fire, its smoke
  steam: { name: 'dx-steam', rate: 46, life: [1.2, 2.2], shape: { type: 'point' }, velocity: { speed: [2.4, 3.6], spread: 10 }, gravity: 0.6, drag: 1.4, wind: 0.6,
    turbulence: { strength: 0.6, scale: 0.8, speed: 0.6 }, size: [0.25, 0.4], sizeOverLife: [[0, 0.3], [1, 3.2]], color: '#e8ecef', alpha: [[0, 0], [0.1, 0.42], [1, 0]], rotation: [0, 360], spin: [-30, 30],
    render: { blend: 'alpha', lit: 1, soft: 0.4, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
  water: { name: 'dx-water', rate: 120, life: [0.5, 0.9], shape: { type: 'point' }, velocity: { speed: [3, 4.5], spread: 7 }, gravity: -9.8, drag: 0.2,
    size: [0.02, 0.035], color: '#d6e8f2', alpha: [[0, 0.85], [1, 0.3]], render: { type: 'stretched', sprite: 'drop', stretch: 0.012, lit: 1 } },
  fire: { name: 'dx-fire', emitters: [
    { name: 'flames', rate: 26, life: [0.5, 0.9], shape: { type: 'sphere', radius: 0.16, hemisphere: true }, velocity: { speed: [0.7, 1.3], spread: 10 }, gravity: 0.8, drag: 0.8,
      turbulence: { strength: 0.5, scale: 0.6, speed: 0.8 }, wind: 0.5, size: [0.4, 0.65], sizeOverLife: [[0, 0.55], [0.3, 1], [1, 0.35]],
      color: [[0, '#fff2c8'], [0.25, '#ffb445'], [0.6, '#ff5a1c'], [1, '#4a1005']], alpha: [[0, 0], [0.12, 0.9], [0.7, 0.55], [1, 0]], emissive: [[0, 2.5], [1, 0.5]],
      rotation: [-15, 15], render: { blend: 'premultiplied', additive: 0.8, soft: 0.25, flipbook: { sheet: 'flame', fps: 14, blend: true } } },
    smoke({ rate: 6, life: [2, 3.4], shape: { type: 'sphere', radius: 0.12, offset: [0, 0.7, 0] } }),
  ] },
};

// ---- sounds: made at audio.unlock() from seeded noise and sines (addDestructSounds puts them in a createAudio)
/** the sound names: dx_break_<set> (a break per material set), dx_hit_<kind> (tick | ping | zap | thud), loops
 *  dx_alarm, dx_hiss, dx_fire, and dx_boom (a blast) */
export const DESTRUCT_SOUNDS = ['glass', 'paper', 'wood', 'cardboard', 'plastic', 'metal', 'heavy', 'ceramic', 'liquid', 'electronics', 'fabric'];

/** every destructibles sound as audio.add() factories: { name: (ctx) => AudioBuffer | AudioBuffer[] } */
export function destructSoundFactories() {
  const out = {};
  const make = (sec, fn, seed) => (ctx) => {
    const SR = ctx.sampleRate, b = ctx.createBuffer(1, Math.ceil(sec * SR), SR), d = b.getChannelData(0);
    fn(d, SR, sfc32(hash32('mirage/destruct/' + seed)));
    let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0.9) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / m;
    return b;
  };
  const variants = (n, sec, fn, name) => (ctx) => Array.from({ length: n }, (_, v) => make(sec, (d, SR, R) => fn(d, SR, R, v), name + v)(ctx));
  const lp = (a) => { let y = 0; return (x) => (y += a * (x - y)); };
  const ring = (d, SR, f, t0, amp, dec) => { for (let i = Math.floor(t0 * SR); i < d.length; i++) { const t = i / SR - t0; d[i] += amp * Math.exp(-t / dec) * Math.sin(6.283 * f * t); } };
  const grains = (d, SR, R, n, span, f0, f1, amp, dec) => { for (let k = 0; k < n; k++) { const t0 = Math.pow(R(), 1.8) * span; ring(d, SR, f0 + R() * (f1 - f0), t0, amp * (0.4 + 0.6 * R()) * Math.exp(-t0 / span), dec * (0.5 + R())); } };
  const crunch = (d, SR, R, cut, dec, amp, at = 0) => { const l = lp(cut); for (let i = Math.floor(at * SR); i < d.length; i++) { const t = i / SR - at, x = R() * 2 - 1; d[i] += amp * l(x) * Math.exp(-t / dec); } };
  const hp = (d, a) => { const l = lp(a); for (let i = 0; i < d.length; i++) d[i] -= l(d[i]); };
  out.dx_break_glass = variants(3, 1.1, (d, SR, R) => { crunch(d, SR, R, 0.9, 0.03, 0.9); grains(d, SR, R, 70, 0.7, 2400, 7800, 0.35, 0.03); hp(d, 0.08); }, 'glass');
  out.dx_break_paper = variants(2, 0.5, (d, SR, R) => { const l = lp(0.5); for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = l(R() * 2 - 1) * (0.5 + 0.5 * Math.sin(t * 90 + R())) * Math.exp(-t / 0.18) * 0.7; } }, 'paper');
  out.dx_break_wood = variants(3, 0.7, (d, SR, R, v) => { crunch(d, SR, R, 0.35, 0.06, 0.8); ring(d, SR, 180 + v * 25, 0, 0.5, 0.08); ring(d, SR, 420 + v * 30, 0.01, 0.25, 0.05); grains(d, SR, R, 18, 0.25, 600, 1800, 0.2, 0.02); }, 'wood');
  out.dx_break_cardboard = variants(2, 0.5, (d, SR, R) => { crunch(d, SR, R, 0.15, 0.08, 0.9); crunch(d, SR, R, 0.6, 0.12, 0.25, 0.02); ring(d, SR, 110, 0, 0.4, 0.06); }, 'cardboard');
  out.dx_break_plastic = variants(2, 0.5, (d, SR, R, v) => { crunch(d, SR, R, 0.7, 0.025, 0.6); ring(d, SR, 900 + v * 120, 0, 0.35, 0.04); grains(d, SR, R, 10, 0.3, 1200, 2600, 0.25, 0.015); }, 'plastic');
  out.dx_break_metal = variants(3, 1.2, (d, SR, R, v) => { crunch(d, SR, R, 0.8, 0.02, 0.6); for (const [f, a, t] of [[420, 0.4, 0.5], [1130, 0.3, 0.3], [2270, 0.2, 0.2], [3370, 0.1, 0.12]]) ring(d, SR, f * (1 + v * 0.07), 0, a, t); }, 'metal');
  out.dx_break_heavy = variants(2, 1.6, (d, SR, R, v) => { crunch(d, SR, R, 0.2, 0.08, 0.9); ring(d, SR, 70 + v * 8, 0, 0.8, 0.3); for (const [f, a, t] of [[240, 0.3, 0.8], [610, 0.18, 0.5]]) ring(d, SR, f, 0.005, a, t); }, 'heavy');
  out.dx_break_ceramic = variants(3, 0.8, (d, SR, R) => { crunch(d, SR, R, 0.85, 0.02, 0.7); grains(d, SR, R, 26, 0.35, 1800, 4800, 0.4, 0.025); ring(d, SR, 1400, 0, 0.3, 0.05); }, 'ceramic');
  out.dx_break_liquid = variants(2, 0.9, (d, SR, R) => { crunch(d, SR, R, 0.6, 0.03, 0.6); const l = lp(0.25); for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] += l(R() * 2 - 1) * 1.2 * Math.exp(-t / 0.3) * (0.6 + 0.4 * Math.sin(t * 60)); } for (let k = 0; k < 6; k++) { const t0 = 0.05 + R() * 0.5, f = 300 + R() * 500; for (let i = Math.floor(t0 * SR); i < d.length; i++) { const t = i / SR - t0; d[i] += 0.2 * Math.exp(-t / 0.04) * Math.sin(6.283 * f * (1 + t * 6) * t); } } }, 'liquid');
  out.dx_break_electronics = variants(2, 0.9, (d, SR, R) => { crunch(d, SR, R, 0.5, 0.04, 0.6); for (let i = 0; i < d.length; i++) { const t = i / SR; if (R() < 0.004 * Math.exp(-t / 0.3)) for (let j = 0; j < 40 && i + j < d.length; j++) d[i + j] += (R() - 0.5) * 1.2 * Math.exp(-j / 10); d[i] += 0.12 * Math.sign(Math.sin(6.283 * 120 * t)) * Math.exp(-t / 0.25); } }, 'electronics');
  out.dx_break_fabric = variants(2, 0.6, (d, SR, R) => { const l = lp(0.45), l2 = lp(0.05); for (let i = 0; i < d.length; i++) { const t = i / SR, x = l(R() * 2 - 1); d[i] = (x - l2(x)) * 1.6 * Math.min(1, t / 0.03) * Math.exp(-t / 0.2) * (0.5 + 0.5 * Math.abs(Math.sin(t * 220))); } }, 'fabric');
  out.dx_hit_tick = variants(3, 0.15, (d, SR, R, v) => { crunch(d, SR, R, 0.9, 0.008, 0.5); ring(d, SR, 3200 + v * 400, 0, 0.3, 0.02); }, 'tick');
  out.dx_hit_ping = variants(3, 0.4, (d, SR, R, v) => { crunch(d, SR, R, 0.8, 0.006, 0.5); ring(d, SR, 1800 + v * 260, 0, 0.35, 0.09); ring(d, SR, 4100 + v * 300, 0, 0.15, 0.05); }, 'ping');
  out.dx_hit_zap = variants(2, 0.3, (d, SR, R) => { for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (R() - 0.5) * (R() < 0.3 ? 1 : 0.2) * Math.exp(-t / 0.07); } }, 'zap');
  out.dx_hit_thud = variants(3, 0.25, (d, SR, R, v) => { crunch(d, SR, R, 0.2, 0.03, 0.8); ring(d, SR, 90 + v * 15, 0, 0.5, 0.05); }, 'thud');
  out.dx_boom = variants(2, 2.2, (d, SR, R) => { const l = lp(0.04), l2 = lp(0.004); for (let i = 0; i < d.length; i++) { const t = i / SR, x = l(R() * 2 - 1) - l2(R() * 2 - 1) * 0.3; d[i] = x * 6 * Math.min(1, t / 0.004) * Math.exp(-t / 0.5); } ring(d, SR, 45, 0, 0.8, 0.35); }, 'boom');
  out.dx_alarm = make(2, (d, SR) => { let ph = 0; for (let i = 0; i < d.length; i++) { const t = i / SR, f = (t % 1) < 0.5 ? 880 : 660; ph += 6.283 * f / SR; d[i] = 0.35 * Math.sign(Math.sin(ph)) * (0.8 + 0.2 * Math.sin(ph * 0.5)); } }, 'alarm');
  out.dx_hiss = make(3, (d, SR, R) => { const l = lp(0.7), l2 = lp(0.12); for (let i = 0; i < d.length; i++) { const x = l(R() * 2 - 1); d[i] = (x - l2(x)) * 0.9; } }, 'hiss');
  out.dx_fire = make(3, (d, SR, R) => { const l = lp(0.03); for (let i = 0; i < d.length; i++) { d[i] = l(R() * 2 - 1) * 3 + (R() < 0.002 ? (R() - 0.5) * 0.8 : 0); } }, 'fire');
  return out;
}

/** add every destructibles sound to a createAudio() mixer (made at unlock, or now when it is unlocked); returns names */
export function addDestructSounds(audio) {
  const f = destructSoundFactories();
  for (const [name, fn] of Object.entries(f)) audio.add(name, fn);
  return Object.keys(f);
}

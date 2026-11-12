// Mirage original code. Effect recipes of @miragekit/assets (vfx): descriptions in core's effect format (plain JSON,
// checked by defineEffect), for core's particle system to play. Grouped by what they are for; each entry is
// { cat, desc, loop, effect }. Sizes are metres at a person's scale; a looping effect plays until its handle is
// stopped, a one-shot ends by itself.
//   import { createVfx } from '@miragekit/core';
//   import { VFX_RECIPES } from '@miragekit/assets/vfx';
//   const vfx = createVfx(world);
//   vfx.burst(VFX_RECIPES.muzzleFlash.effect, { position: muzzle, direction: forward });
//   const rain = vfx.spawn(VFX_RECIPES.rainHeavy.effect, { follow: cameraRig });
// Sprites, flipbook sheets and the 'shard' mesh are core's own (made in code); nothing here loads a file.

/** a lit, soft smoke puff on core's smoke flipbook (the base of several recipes) */
const puff = (o) => ({
  life: [2, 3.5], shape: { type: 'sphere', radius: 0.15 }, velocity: { speed: [0.5, 1.0], spread: 15 }, gravity: 0.4, drag: 0.6, wind: 0.5,
  turbulence: { strength: 0.4, scale: 1.2, speed: 0.35 }, size: [0.5, 0.8], sizeOverLife: [[0, 0.35], [0.4, 1], [1, 2]],
  color: [[0, '#3a3632'], [1, '#8a857e']], alpha: [[0, 0], [0.15, 0.5], [0.6, 0.28], [1, 0]], rotation: [0, 360], spin: [-25, 25],
  render: { blend: 'alpha', lit: 1, soft: 0.5, sort: 'oldest', order: -1, flipbook: { sheet: 'smoke', fps: 0, blend: true } }, ...o,
});
/** hot sparks thrown from a point, bouncing off what the camera sees */
const sparkBurst = (o) => ({
  bursts: [{ time: 0, count: 24 }], duration: 0.1, life: [0.25, 0.6], velocity: { speed: [2, 6], spread: 50 }, gravity: -9.8, drag: 0.6,
  size: [0.012, 0.024], color: [[0, '#fff6d8'], [0.4, '#ffb04a'], [1, '#b8320a']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 8,
  render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 }, collision: { mode: 'bounce', depth: true, ground: true, bounce: 0.4, friction: 0.4, lifeLoss: 0.2 }, ...o,
});
const once = (n) => ({ bursts: [{ time: 0, count: n }], duration: 0.1 });

const R = {};
const loops = (e) => (e.loop ?? (e.rate > 0)) && !(e.duration > 0);   // core's rule: loop defaults to rate > 0; a duration with loop ends it
const add = (name, cat, desc, effect) => { R[name] = { cat, desc, loop: (effect.emitters || [effect]).some(loops), effect: { name, ...effect } }; };

// ---------------------------------------------------------------------------------------------------------------
// combat: shots and hits (direction: the shot's forward, +y of the effect)
add('muzzleFlash', 'combat', 'a gun firing: a star of flame, a puff, a few sparks (one shot)', { emitters: [
  { name: 'flash', ...once(3), life: [0.04, 0.06], size: [0.18, 0.3], sizeOverLife: [[0, 0.6], [1, 1.3]], color: '#ffe6a0', alpha: [[0, 1], [1, 0]], emissive: 12, rotation: [0, 360], render: { blend: 'add', sprite: 'star' } },
  { name: 'cone', ...once(6), life: [0.05, 0.08], shape: { type: 'point', offset: [0, 0.08, 0] }, velocity: { speed: [3, 6], spread: 10 }, size: [0.08, 0.14], color: [[0, '#fff2c0'], [1, '#ff7a20']], alpha: [[0, 1], [1, 0]], emissive: 10, render: { blend: 'add', type: 'stretched', sprite: 'soft', stretch: 0.03 } },
  puff({ name: 'smoke', ...once(3), life: [0.6, 1.1], velocity: { speed: [0.4, 1], spread: 25 }, size: [0.12, 0.2], alpha: [[0, 0], [0.1, 0.3], [1, 0]] }),
  sparkBurst({ name: 'sparks', ...once(5), velocity: { speed: [4, 9], spread: 18 }, life: [0.1, 0.25] }),
] });
add('tracer', 'combat', 'a tracer round streaking away (one shot; direction: the shot)', { ...once(1), life: [0.18, 0.18], shape: { type: 'point', offset: [0, 0.3, 0] }, velocity: { speed: [180, 180] }, size: [0.03, 0.03],
  color: '#ffd890', alpha: 1, emissive: 10, render: { blend: 'add', type: 'stretched', sprite: 'soft', stretch: 0.012 }, trail: { segments: 8, every: 1, width: 0.6, taper: 1 } });
add('impactConcrete', 'combat', 'a round hitting concrete: dust, chips, a few sparks (direction: the surface normal)', { emitters: [
  puff({ name: 'dust', ...once(6), life: [0.6, 1.4], velocity: { speed: [0.6, 2], spread: 35 }, gravity: -0.6, drag: 2.5, size: [0.12, 0.25], color: [[0, '#b0a898'], [1, '#c8c0b2']], alpha: [[0, 0], [0.1, 0.5], [1, 0]] }),
  { name: 'chips', ...once(10), life: [0.4, 0.9], velocity: { speed: [2, 5], spread: 40 }, gravity: -9.8, drag: 0.2, size: [0.008, 0.02], color: '#8a8378', rotation: [0, 360], spin: [-900, 900], render: { type: 'mesh', mesh: 'shard', lit: 1 },
    collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.3, friction: 0.5 } },
  sparkBurst({ name: 'sparks', ...once(4), life: [0.1, 0.25] }),
] });
add('impactMetal', 'combat', 'a round hitting steel: a bright spray of sparks, a small flash (direction: the surface normal)', { emitters: [
  sparkBurst({ name: 'sparks', ...once(26), velocity: { speed: [3, 9], spread: 60 } }),
  { name: 'flash', ...once(1), life: [0.05, 0.05], size: [0.25, 0.25], color: '#fff0c0', alpha: [[0, 1], [1, 0]], emissive: 10, render: { blend: 'add', sprite: 'star' } },
] });
add('impactWood', 'combat', 'a round hitting wood: splinters and a puff of sawdust (direction: the surface normal)', { emitters: [
  { name: 'splinters', ...once(12), life: [0.5, 1.2], velocity: { speed: [1.5, 4.5], spread: 45 }, gravity: -9.8, drag: 0.4, size: [0.015, 0.04], color: '#c49a62', rotation: [0, 360], spin: [-1200, 1200],
    render: { type: 'mesh', mesh: 'shard', lit: 1 }, collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.25, friction: 0.6 } },
  puff({ name: 'sawdust', ...once(4), life: [0.5, 1.0], velocity: { speed: [0.5, 1.5], spread: 40 }, gravity: -0.8, drag: 2.5, size: [0.08, 0.15], color: '#d8bc8c', alpha: [[0, 0], [0.1, 0.45], [1, 0]] }),
] });
add('impactWater', 'combat', 'a round hitting water: a thin spout and a ring', { emitters: [
  { name: 'spout', ...once(22), life: [0.4, 0.8], shape: { type: 'point' }, velocity: { speed: [2, 4.5], spread: 12 }, gravity: -9.8, drag: 0.3, size: [0.02, 0.04], color: '#dcecf4', alpha: [[0, 0.9], [1, 0]],
    render: { type: 'stretched', sprite: 'drop', stretch: 0.015, lit: 1 }, collision: { mode: 'kill', ground: true } },
  { name: 'ring', ...once(1), life: [0.6, 0.6], size: [0.3, 0.3], sizeOverLife: [[0, 0.2], [1, 2.4]], color: '#e6f2f8', alpha: [[0, 0.7], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 1 } },
] });
add('robotHit', 'combat', 'a round into a machine: sparks, a puff of black smoke, oil drops', { emitters: [
  sparkBurst({ name: 'sparks', ...once(18) }),
  puff({ name: 'smoke', ...once(3), life: [0.8, 1.6], size: [0.15, 0.3], color: [[0, '#151515'], [1, '#3a3a3a']] }),
  { name: 'oil', ...once(8), life: [0.4, 0.9], velocity: { speed: [1, 3], spread: 45 }, gravity: -9.8, size: [0.012, 0.025], color: '#0c0b0a', render: { type: 'stretched', sprite: 'drop', stretch: 0.01, lit: 1 }, collision: { mode: 'kill', ground: true, depth: true } },
] });
add('shockwave', 'combat', 'a ground shockwave: a ring of dust racing outward and a flash ring', { emitters: [
  puff({ name: 'dust', ...once(40), life: [0.8, 1.6], shape: { type: 'ring', radius: 0.4, offset: [0, 0.1, 0] }, velocity: { speed: [0, 0.3], normal: [5, 9] }, gravity: -0.3, drag: 3, size: [0.4, 0.8], color: [[0, '#9c8f7a'], [1, '#b8ad9a']], alpha: [[0, 0], [0.1, 0.55], [1, 0]] }),
  { name: 'ring', ...once(1), life: [0.45, 0.45], shape: { type: 'point', offset: [0, 0.05, 0] }, size: [2, 2], sizeOverLife: [[0, 0.3], [1, 4]], color: '#fff0d0', alpha: [[0, 0.8], [1, 0]], emissive: 4, render: { type: 'horizontal', blend: 'add', sprite: 'ring' } },
] });
add('empPulse', 'combat', 'an electromagnetic pulse: a blue sphere of light, arcs crawling out, a ground ring', { emitters: [
  { name: 'flash', ...once(1), life: [0.25, 0.25], size: [3, 3], sizeOverLife: [[0, 0.2], [1, 1.4]], color: '#9ad8ff', alpha: [[0, 1], [1, 0]], emissive: 8, render: { blend: 'add', sprite: 'soft' } },
  { name: 'arcs', ...once(40), life: [0.15, 0.4], shape: { type: 'sphere', radius: 0.4, offset: [0, 1, 0] }, velocity: { speed: [0, 1], normal: [4, 9] }, drag: 4, size: [0.02, 0.04], color: '#d8f2ff', alpha: [[0, 1], [1, 0]], emissive: 10,
    render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.04 }, trail: { segments: 6, every: 1, width: 0.5, taper: 1 } },
  { name: 'ring', ...once(1), life: [0.6, 0.6], shape: { type: 'point', offset: [0, 0.04, 0] }, size: [2, 2], sizeOverLife: [[0, 0.2], [1, 5]], color: '#7ac8ff', alpha: [[0, 0.9], [1, 0]], emissive: 5, render: { type: 'horizontal', blend: 'add', sprite: 'ring' } },
] });
add('shieldHit', 'combat', 'a round stopped by an energy shield: a hex-blue ripple and glints (direction: the shield normal)', { emitters: [
  { name: 'ripple', ...once(2), life: [0.4, 0.5], size: [0.6, 0.8], sizeOverLife: [[0, 0.2], [1, 1.6]], color: '#6ad0ff', alpha: [[0, 0.9], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'ring' } },
  { name: 'glints', ...once(16), life: [0.2, 0.5], shape: { type: 'ring', radius: 0.15 }, velocity: { speed: [0.5, 2], spread: 70 }, drag: 3, size: [0.02, 0.05], color: '#d0f4ff', emissive: 8, alpha: [[0, 1], [1, 0]], render: { blend: 'add', sprite: 'star' } },
] });
add('plasmaBolt', 'combat', 'a ball of plasma in flight (loop: attach it to the projectile)', { emitters: [
  { name: 'core', rate: 60, life: [0.1, 0.18], shape: { type: 'sphere', radius: 0.03 }, size: [0.18, 0.26], sizeOverLife: [[0, 1], [1, 0.4]], color: '#c0f0ff', alpha: [[0, 1], [1, 0]], emissive: 9, render: { blend: 'add', sprite: 'soft' } },
  { name: 'wake', rate: 80, life: [0.2, 0.4], shape: { type: 'sphere', radius: 0.06 }, velocity: { inherit: -0.2, random: [0.2, 0.6] }, size: [0.03, 0.06], color: [[0, '#80d8ff'], [1, '#3060ff']], alpha: [[0, 1], [1, 0]], emissive: 7, render: { blend: 'add', sprite: 'spark' } },
] });
add('lightningArc', 'combat', 'electricity arcing between two points 1 m apart (loop)', { rate: 90, life: [0.04, 0.09], shape: { type: 'edge', a: [-0.5, 0, 0], b: [0.5, 0, 0] }, velocity: { random: [1, 3] }, turbulence: { strength: 6, scale: 0.15, speed: 4 },
  size: [0.02, 0.05], color: '#e0f4ff', alpha: [[0, 1], [1, 0]], emissive: 12, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.03 } });
add('bloodlessHit', 'combat', 'a stylised hit on a character: a white flash and a ring of stars (no gore)', { emitters: [
  { name: 'flash', ...once(1), life: [0.12, 0.12], size: [0.6, 0.6], sizeOverLife: [[0, 0.4], [1, 1.2]], color: '#ffffff', alpha: [[0, 1], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'star' } },
  { name: 'stars', ...once(10), life: [0.3, 0.5], shape: { type: 'ring', radius: 0.1 }, velocity: { normal: [2, 3.5], speed: [0, 0.3] }, drag: 4, size: [0.06, 0.1], color: '#fff2a0', alpha: [[0, 1], [1, 0]], emissive: 4, render: { blend: 'add', sprite: 'star' } },
] });

// ---------------------------------------------------------------------------------------------------------------
// weather (spawn with follow: the camera rig; boxes are centred on it)
add('rainHeavy', 'weather', 'heavy rain over a 30 m square, splashing where it lands (loop)', { rate: 2400, life: [0.9, 1.2], shape: { type: 'box', size: [30, 1, 30], offset: [0, 10, 0] }, velocity: { dir: [0, -1, 0], speed: [9, 11], spread: 3 }, wind: 0.4,
  size: [0.012, 0.016], color: '#c8d4dc', alpha: [[0, 0], [0.05, 0.45], [1, 0.45]], render: { type: 'stretched', sprite: 'drop', stretch: 0.03, lit: 0.6, nearFade: 0.5 },
  collision: { mode: 'kill', ground: true, depth: true }, lod: { near: 30, far: 80, min: 0.4 },
  sub: [{ on: 'death', count: 1, emitter: { name: 'splash', life: [0.15, 0.25], size: [0.05, 0.09], sizeOverLife: [[0, 0.3], [1, 1.5]], color: '#d8e4ea', alpha: [[0, 0.5], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 0.6 } } }] });
add('drizzle', 'weather', 'a fine drizzle drifting on the wind (loop)', { rate: 600, life: [3, 4.5], shape: { type: 'box', size: [30, 1, 30], offset: [0, 8, 0] }, velocity: { dir: [0, -1, 0], speed: [2, 3], spread: 6 }, wind: 1.2, turbulence: { strength: 0.3, scale: 3, speed: 0.3 },
  size: [0.006, 0.01], color: '#d0dae0', alpha: [[0, 0], [0.1, 0.4], [1, 0.4]], render: { type: 'stretched', sprite: 'drop', stretch: 0.02, lit: 0.6, nearFade: 0.4 }, collision: { mode: 'kill', ground: true } });
add('blizzard', 'weather', 'a blizzard: dense snow driven sideways, gusting (loop)', { rate: 1300, life: [3, 5], shape: { type: 'box', size: [30, 6, 30], offset: [0, 4, 0] }, velocity: { dir: [1, -0.3, 0.2], speed: [4, 8], spread: 15 }, wind: 2, turbulence: { strength: 2.5, scale: 2, speed: 0.8 },
  size: [0.025, 0.06], color: '#f4f8fc', alpha: [[0, 0], [0.05, 0.9], [0.9, 0.9], [1, 0]], rotation: [0, 360], spin: [-90, 90], render: { sprite: 'flake', lit: 0.7, nearFade: 0.3 }, collision: { mode: 'kill', ground: true, depth: true }, lod: { near: 40, far: 120, min: 0.4 } });
add('hail', 'weather', 'hail: hard white pellets that bounce (loop)', { rate: 500, life: [1.5, 2.5], shape: { type: 'box', size: [24, 1, 24], offset: [0, 10, 0] }, velocity: { dir: [0, -1, 0], speed: [12, 15], spread: 4 },
  size: [0.012, 0.025], color: '#eef4f8', render: { sprite: 'disc', lit: 1 }, collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.45, friction: 0.3, lifeLoss: 0.35 } });
add('sandstorm', 'weather', 'a sandstorm: low brown haze and sand streaming past (loop)', { emitters: [
  puff({ name: 'haze', rate: 40, life: [4, 6], shape: { type: 'box', size: [40, 4, 40], offset: [0, 2, 0] }, velocity: { dir: [1, 0, 0.2], speed: [3, 6] }, gravity: 0, wind: 1.5, size: [3, 5], color: [[0, '#b08a5a'], [1, '#c8a676']], alpha: [[0, 0], [0.2, 0.35], [0.8, 0.35], [1, 0]], render: { blend: 'alpha', lit: 0.8, soft: 1, sort: 'distance' } }),
  { name: 'grains', rate: 1200, life: [1, 2], shape: { type: 'box', size: [30, 3, 30], offset: [0, 1.5, 0] }, velocity: { dir: [1, 0.05, 0.2], speed: [8, 14], spread: 8 }, turbulence: { strength: 2, scale: 1, speed: 1 },
    size: [0.005, 0.01], color: '#c8a070', alpha: [[0, 0], [0.1, 0.7], [1, 0]], render: { type: 'stretched', sprite: 'soft', stretch: 0.02, lit: 0.8, nearFade: 0.3 } },
] });
add('groundFog', 'weather', 'low fog rolling over the ground in a 20 m square (loop)', puff({ rate: 10, life: [8, 12], shape: { type: 'box', size: [20, 0.3, 20], offset: [0, 0.3, 0] }, velocity: { dir: [1, 0, 0], speed: [0.1, 0.3], spread: 60 }, gravity: 0, wind: 0.8,
  turbulence: { strength: 0.15, scale: 4, speed: 0.1 }, size: [3, 5], sizeOverLife: [[0, 0.7], [1, 1.3]], color: '#c8ccd0', alpha: [[0, 0], [0.25, 0.3], [0.75, 0.3], [1, 0]], render: { blend: 'alpha', lit: 1, soft: 1.5, sort: 'distance' } }));
add('ashfall', 'weather', 'ash drifting down after a fire (loop)', { rate: 160, life: [6, 9], shape: { type: 'box', size: [24, 1, 24], offset: [0, 7, 0] }, velocity: { dir: [0, -1, 0], speed: [0.3, 0.7], spread: 20 }, gravity: -0.6, drag: 1, wind: 1.4,
  turbulence: { strength: 0.6, scale: 1.5, speed: 0.3 }, size: [0.02, 0.05], color: [[0, '#4a4642'], [1, '#8a8682']], alpha: [[0, 0], [0.1, 0.9], [0.9, 0.9], [1, 0]], rotation: [0, 360], spin: [-120, 120], render: { sprite: 'flake', lit: 1 },
  collision: { mode: 'stick', ground: true, depth: true, lifeLoss: 0.5 } });
add('petals', 'weather', 'cherry blossom petals tumbling from above (loop)', { rate: 14, life: [6, 9], shape: { type: 'box', size: [10, 0.5, 10], offset: [0, 5, 0] }, velocity: { dir: [0, -1, 0], speed: [0.3, 0.6], spread: 30 }, gravity: -1.6, drag: 1.4, wind: 1.6,
  turbulence: { strength: 1.2, scale: 1.2, speed: 0.4 }, size: [0.025, 0.04], color: [[0, '#ffd8e4'], [1, '#f4b0c8']], rotation: [0, 360], spin: [-300, 300], render: { type: 'mesh', mesh: 'shard', lit: 1 },
  collision: { mode: 'stick', ground: true, depth: true, lifeLoss: 0.4 } });
add('pollen', 'weather', 'pollen and dust motes hanging in sunlight in a 3 m sphere (loop)', { rate: 20, life: [5, 8], shape: { type: 'sphere', radius: 3, offset: [0, 1.5, 0] }, velocity: { speed: [0.01, 0.06], spread: 180 }, drag: 1,
  turbulence: { strength: 0.12, scale: 1.5, speed: 0.15 }, size: [0.006, 0.012], color: '#fff4d0', alpha: [[0, 0], [0.2, 0.8], [0.8, 0.8], [1, 0]], render: { sprite: 'disc', lit: 1 } });

// ---------------------------------------------------------------------------------------------------------------
// fire, smoke and steam
add('torch', 'fire', 'a hand torch or wall torch: a tall flame and a thread of smoke (loop)', { emitters: [
  { name: 'flame', rate: 26, life: [0.35, 0.6], shape: { type: 'sphere', radius: 0.05 }, velocity: { speed: [0.6, 1], spread: 8 }, gravity: 0.8, drag: 0.8, wind: 0.5, turbulence: { strength: 0.4, scale: 0.3, speed: 1 },
    size: [0.16, 0.24], sizeOverLife: [[0, 0.6], [0.3, 1], [1, 0.3]], color: [[0, '#fff0c0'], [0.4, '#ffa040'], [1, '#601808']], alpha: [[0, 0], [0.15, 0.95], [1, 0]], emissive: [[0, 3], [1, 0.6]],
    render: { blend: 'premultiplied', additive: 0.8, soft: 0.1, flipbook: { sheet: 'flame', fps: 16, blend: true } } },
  puff({ name: 'smoke', rate: 4, life: [1.5, 2.5], shape: { type: 'point', offset: [0, 0.35, 0] }, size: [0.12, 0.2], alpha: [[0, 0], [0.2, 0.25], [1, 0]] }),
] });
add('candle', 'fire', 'a candle flame: small, steady, a faint flicker (loop)', { rate: 18, life: [0.25, 0.35], shape: { type: 'point' }, velocity: { speed: [0.05, 0.1] }, gravity: 0.2, drag: 2, turbulence: { strength: 0.03, scale: 0.1, speed: 2 },
  size: [0.025, 0.032], sizeOverLife: [[0, 0.7], [0.4, 1], [1, 0.4]], color: [[0, '#fff8e0'], [0.5, '#ffc060'], [1, '#ff6020']], alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 4, render: { blend: 'add', sprite: 'soft' } });
add('brazier', 'fire', 'a brazier or barrel fire: flames, embers, smoke (loop)', { emitters: [
  { name: 'flames', rate: 36, life: [0.5, 0.9], shape: { type: 'ring', radius: 0.22, shell: 0.6 }, velocity: { speed: [0.7, 1.3], spread: 12 }, gravity: 0.8, drag: 0.8, wind: 0.6, turbulence: { strength: 0.5, scale: 0.5, speed: 0.9 },
    size: [0.35, 0.55], sizeOverLife: [[0, 0.5], [0.3, 1], [1, 0.3]], color: [[0, '#fff0c0'], [0.3, '#ffa840'], [0.7, '#ff5018'], [1, '#401005']], alpha: [[0, 0], [0.12, 0.9], [1, 0]], emissive: [[0, 2.5], [1, 0.4]],
    rotation: [-15, 15], render: { blend: 'premultiplied', additive: 0.8, soft: 0.2, flipbook: { sheet: 'flame', fps: 14, blend: true } } },
  { name: 'embers', rate: 12, life: [1, 2.5], shape: { type: 'ring', radius: 0.2 }, velocity: { speed: [1.2, 2.6], spread: 22 }, gravity: 0.6, drag: 0.5, wind: 1, turbulence: { strength: 1.4, scale: 0.5, speed: 1 },
    size: [0.015, 0.03], color: [[0, '#ffd070'], [1, '#801a05']], alpha: [[0, 1], [0.8, 1], [1, 0]], emissive: 6, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.03 } },
  puff({ name: 'smoke', rate: 6, life: [3, 5], shape: { type: 'sphere', radius: 0.15, offset: [0, 0.9, 0] }, size: [0.6, 1.0] }),
] });
add('burningWreck', 'fire', 'a burning wreck: big flames, thick black smoke, popping sparks (loop)', { emitters: [
  { name: 'flames', rate: 50, life: [0.6, 1.1], shape: { type: 'box', size: [2, 0.4, 1] }, velocity: { speed: [1, 2], spread: 15 }, gravity: 1, drag: 0.7, wind: 0.7, turbulence: { strength: 0.8, scale: 0.8, speed: 1 },
    size: [0.7, 1.1], sizeOverLife: [[0, 0.5], [0.3, 1], [1, 0.4]], color: [[0, '#fff0c0'], [0.3, '#ffa040'], [0.7, '#ff4a15'], [1, '#300c05']], alpha: [[0, 0], [0.12, 0.9], [1, 0]], emissive: [[0, 3], [1, 0.5]],
    rotation: [-20, 20], render: { blend: 'premultiplied', additive: 0.75, soft: 0.4, flipbook: { sheet: 'flame', fps: 12, blend: true } } },
  puff({ name: 'smoke', rate: 10, life: [5, 8], shape: { type: 'box', size: [1.6, 0.3, 0.8], offset: [0, 1.4, 0] }, velocity: { speed: [1, 2], spread: 12 }, size: [1.5, 2.5], color: [[0, '#151312'], [1, '#3a3836']], alpha: [[0, 0], [0.1, 0.75], [0.6, 0.45], [1, 0]] }),
  sparkBurst({ name: 'pops', bursts: [{ time: 0, count: 6, every: 0.7 }], duration: 0, loop: true, life: [0.5, 1.2], velocity: { speed: [2, 5], spread: 40 } }),
] });
add('chimneySmoke', 'fire', 'smoke from a chimney, bending with the wind (loop)', puff({ rate: 5, life: [6, 9], shape: { type: 'sphere', radius: 0.12 }, velocity: { speed: [0.6, 1], spread: 8 }, gravity: 0.3, wind: 0.9, size: [0.5, 0.8], sizeOverLife: [[0, 0.4], [1, 3]], color: [[0, '#d8d4d0'], [1, '#b8b4b0']], alpha: [[0, 0], [0.1, 0.4], [1, 0]] }));
add('steamVent', 'fire', 'steam hissing from a vent or a manhole (loop)', puff({ rate: 16, life: [1.5, 2.5], shape: { type: 'ring', radius: 0.15 }, velocity: { speed: [1.5, 2.5], spread: 10 }, gravity: 0.6, drag: 1.2, wind: 0.8,
  size: [0.3, 0.5], sizeOverLife: [[0, 0.4], [1, 2.5]], color: '#e8ecee', alpha: [[0, 0], [0.1, 0.45], [1, 0]] }));
add('exhaust', 'fire', 'a vehicle exhaust: a thin grey puff trail (loop; direction: out of the pipe)', puff({ rate: 18, life: [0.8, 1.6], shape: { type: 'point' }, velocity: { speed: [1.2, 2], spread: 12 }, gravity: 0.2, drag: 1.5, size: [0.06, 0.1], sizeOverLife: [[0, 0.5], [1, 3]], color: '#9a9896', alpha: [[0, 0], [0.1, 0.3], [1, 0]] }));
add('smokeGrenade', 'fire', 'a smoke grenade: a thick billowing cloud that fills about 6 m (one go, 12 s)', puff({ rate: 18, loop: false, duration: 12, life: [8, 12], shape: { type: 'sphere', radius: 0.1, hemisphere: true }, velocity: { speed: [0.3, 1.2], spread: 80 }, gravity: 0.15, drag: 0.8,
  size: [1.5, 2.5], sizeOverLife: [[0, 0.3], [0.3, 1], [1, 2]], color: [[0, '#d0d0d4'], [1, '#a8a8ac']], alpha: [[0, 0], [0.1, 0.75], [0.7, 0.6], [1, 0]], render: { blend: 'alpha', lit: 1, soft: 0.8, sort: 'distance', flipbook: { sheet: 'smoke', fps: 0, blend: true } } }));
add('flare', 'fire', 'a road flare: a hot red flame and pink smoke (loop)', { emitters: [
  { name: 'flame', rate: 40, life: [0.1, 0.2], shape: { type: 'point' }, velocity: { speed: [0.3, 0.6], spread: 20 }, size: [0.08, 0.14], color: [[0, '#ffe0e0'], [1, '#ff2010']], alpha: [[0, 1], [1, 0]], emissive: 10, render: { blend: 'add', sprite: 'soft' } },
  puff({ name: 'smoke', rate: 8, life: [2, 3.5], shape: { type: 'point', offset: [0, 0.1, 0] }, size: [0.3, 0.5], color: [[0, '#e07070'], [1, '#c09090']], alpha: [[0, 0], [0.15, 0.4], [1, 0]] }),
] });
add('weldingSparks', 'fire', 'welding: a white-blue point, a fan of sparks, a little smoke (loop)', { emitters: [
  { name: 'arc', rate: 50, life: [0.03, 0.06], size: [0.08, 0.14], color: '#e0f0ff', alpha: 1, emissive: 14, render: { blend: 'add', sprite: 'star' } },
  sparkBurst({ name: 'sparks', bursts: [], rate: 120, loop: true, duration: 0, life: [0.3, 0.8], velocity: { speed: [1.5, 4], spread: 70 } }),
  puff({ name: 'smoke', rate: 3, life: [1.5, 2.5], size: [0.15, 0.25], color: '#c0c0c0', alpha: [[0, 0], [0.2, 0.2], [1, 0]] }),
] });
add('electricShort', 'fire', 'a broken cable shorting: bursts of sparks every second or so (loop)', sparkBurst({ bursts: [{ time: 0, count: 14, every: 1.1 }, { time: 0.35, count: 6, every: 1.1 }], duration: 0, loop: true, life: [0.2, 0.6], velocity: { speed: [1, 4], spread: 90 } }));

// ---------------------------------------------------------------------------------------------------------------
// water
add('fountain', 'water', 'a fountain jet about 1.8 m high falling back into its basin (loop)', { rate: 260, life: [1.1, 1.4], shape: { type: 'point' }, velocity: { speed: [5.6, 6.2], spread: 4 }, gravity: -9.8, drag: 0.1,
  size: [0.025, 0.045], color: '#dceaf2', alpha: [[0, 0.8], [1, 0.6]], render: { type: 'stretched', sprite: 'drop', stretch: 0.015, lit: 1 }, collision: { mode: 'kill', ground: true },
  sub: [{ on: 'death', count: 1, emitter: { name: 'ripple', life: [0.3, 0.5], size: [0.08, 0.12], sizeOverLife: [[0, 0.3], [1, 2]], color: '#e6f2f8', alpha: [[0, 0.5], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 1 } } }] });
add('waterfallSpray', 'water', 'the mist and spray at the foot of a waterfall 3 m wide (loop)', { emitters: [
  puff({ name: 'mist', rate: 20, life: [2, 3.5], shape: { type: 'box', size: [3, 0.2, 0.6] }, velocity: { speed: [0.5, 1.5], spread: 60 }, gravity: 0.1, drag: 1.2, size: [1, 1.8], color: '#eef4f8', alpha: [[0, 0], [0.15, 0.35], [1, 0]], render: { blend: 'alpha', lit: 1, soft: 0.8 } }),
  { name: 'spray', rate: 200, life: [0.6, 1.2], shape: { type: 'box', size: [3, 0.1, 0.3] }, velocity: { speed: [1.5, 4], spread: 50 }, gravity: -9.8, drag: 0.3, size: [0.02, 0.04], color: '#e0eef6', alpha: [[0, 0.8], [1, 0]],
    render: { type: 'stretched', sprite: 'drop', stretch: 0.01, lit: 1 }, collision: { mode: 'kill', ground: true } },
] });
add('drip', 'water', 'water dripping from a ledge, a ripple where each drop lands (loop)', { rate: 2.5, life: [1.5, 1.5], shape: { type: 'edge', a: [-0.4, 0, 0], b: [0.4, 0, 0] }, gravity: -9.8, size: [0.012, 0.016], color: '#dceaf2', alpha: 0.9,
  render: { type: 'stretched', sprite: 'drop', stretch: 0.01, lit: 1 }, collision: { mode: 'kill', ground: true, depth: true },
  sub: [{ on: 'death', count: 1, emitter: { name: 'ripple', life: [0.5, 0.7], size: [0.06, 0.1], sizeOverLife: [[0, 0.2], [1, 3]], color: '#e6f2f8', alpha: [[0, 0.6], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 1 } } }] });
add('bubbles', 'water', 'bubbles rising under water from a point, wobbling (loop)', { rate: 14, life: [2, 3.5], shape: { type: 'sphere', radius: 0.08 }, velocity: { speed: [0.3, 0.6], spread: 10 }, gravity: 0.8, drag: 1.4, turbulence: { strength: 0.4, scale: 0.3, speed: 1 },
  size: [0.015, 0.05], sizeOverLife: [[0, 0.6], [1, 1.2]], color: '#e8f6ff', alpha: [[0, 0], [0.1, 0.7], [0.9, 0.7], [1, 0]], render: { sprite: 'ring', lit: 0.5 } });
add('wake', 'water', 'foam behind something moving on water (loop; attach it at the waterline)', { rate: 40, life: [1.5, 3], shape: { type: 'ring', radius: 0.3 }, velocity: { inherit: -0.3, normal: [0.2, 0.6] }, drag: 1.5, size: [0.15, 0.3], sizeOverLife: [[0, 0.5], [1, 2.2]],
  color: '#f2f8fa', alpha: [[0, 0.7], [1, 0]], rotation: [0, 360], render: { type: 'horizontal', sprite: 'soft', lit: 1 } });

// ---------------------------------------------------------------------------------------------------------------
// magic and science fiction
add('healAura', 'magic', 'healing: green motes rising round a person and a soft ground ring (loop)', { emitters: [
  { name: 'motes', rate: 30, life: [1.2, 2], shape: { type: 'ring', radius: 0.5, offset: [0, 0.1, 0] }, velocity: { speed: [0.5, 1.1], spread: 6 }, drag: 0.4, turbulence: { strength: 0.2, scale: 0.5, speed: 0.4 },
    size: [0.03, 0.06], sizeOverLife: [[0, 0.5], [0.3, 1], [1, 0]], color: [[0, '#d0ffd0'], [1, '#50e080']], alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 4, render: { blend: 'add', sprite: 'star' } },
  { name: 'ring', rate: 1.2, life: [1.6, 1.6], shape: { type: 'point', offset: [0, 0.03, 0] }, size: [1.2, 1.2], sizeOverLife: [[0, 0.6], [1, 1.2]], color: '#70ff9a', alpha: [[0, 0], [0.3, 0.6], [1, 0]], emissive: 3, render: { type: 'horizontal', blend: 'add', sprite: 'ring' } },
] });
add('levelUpPillar', 'magic', 'a pillar of golden light with rising stars (one go, 1.5 s)', { emitters: [
  { name: 'pillar', ...once(12), life: [0.8, 1.4], shape: { type: 'ring', radius: 0.45 }, velocity: { speed: [2.5, 4], spread: 2 }, drag: 0.8, size: [0.3, 0.45], sizeOverLife: [[0, 1], [1, 0.4]], color: [[0, '#fff4c0'], [1, '#ffb030']], alpha: [[0, 0], [0.1, 0.8], [1, 0]], emissive: 5,
    render: { blend: 'add', type: 'stretched', sprite: 'soft', stretch: 0.15 } },
  { name: 'stars', rate: 60, loop: false, duration: 1.2, life: [0.8, 1.4], shape: { type: 'ring', radius: 0.5 }, velocity: { speed: [1, 2.4], spread: 10 }, size: [0.04, 0.08], color: '#fff0a0', alpha: [[0, 1], [1, 0]], emissive: 6, rotation: [0, 90], spin: [-120, 120], render: { blend: 'add', sprite: 'star' } },
] });
add('portal', 'magic', 'a portal 2 m tall: a ring of swirling light and motes pulled into its centre (loop; it faces +z)', { emitters: [
  { name: 'rim', rate: 160, life: [0.6, 1.0], shape: { type: 'ring', radius: 1, offset: [0, 1.2, 0] }, velocity: { normal: [-0.2, 0.2] }, attractors: [{ position: [0, 1.2, 0], strength: 0.6, radius: 2, spin: 4 }],
    size: [0.06, 0.12], color: [[0, '#d0b8ff'], [1, '#6a30ff']], alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'soft' } },
  { name: 'motes', rate: 40, life: [1, 1.6], shape: { type: 'sphere', radius: 2.2, shell: 0.8, offset: [0, 1.2, 0] }, attractors: [{ position: [0, 1.2, 0], strength: 5, radius: 3, spin: 3 }], drag: 0.8,
    size: [0.02, 0.04], color: '#e0d0ff', alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 5, render: { blend: 'add', sprite: 'star' }, trail: { segments: 8, every: 2, width: 0.6, taper: 1 } },
] });
add('teleport', 'magic', 'a teleport: a column of light that collapses with a flash (one go)', { emitters: [
  { name: 'column', ...once(60), life: [0.5, 0.9], shape: { type: 'ring', radius: 0.4 }, velocity: { speed: [1, 3], spread: 3 }, size: [0.05, 0.1], color: [[0, '#c0f0ff'], [1, '#4080ff']], alpha: [[0, 1], [1, 0]], emissive: 6,
    render: { blend: 'add', type: 'stretched', sprite: 'soft', stretch: 0.08 } },
  { name: 'flash', bursts: [{ time: 0.5, count: 1 }], duration: 0.6, life: [0.2, 0.2], shape: { type: 'point', offset: [0, 1, 0] }, size: [2.5, 2.5], sizeOverLife: [[0, 0.3], [1, 1]], color: '#e0f8ff', alpha: [[0, 1], [1, 0]], emissive: 8, render: { blend: 'add', sprite: 'soft' } },
] });
add('poisonCloud', 'magic', 'a poison cloud: a low green haze with bubbles popping (loop)', { emitters: [
  puff({ name: 'haze', rate: 8, life: [3, 5], shape: { type: 'sphere', radius: 1.2, hemisphere: true }, velocity: { speed: [0.05, 0.2], spread: 90 }, gravity: 0.05, size: [1.2, 2], color: [[0, '#6a8a2a'], [1, '#90a850']], alpha: [[0, 0], [0.2, 0.45], [1, 0]] }),
  { name: 'pops', rate: 10, life: [0.6, 1.2], shape: { type: 'sphere', radius: 1, hemisphere: true }, velocity: { speed: [0.2, 0.5] }, size: [0.04, 0.08], sizeOverLife: [[0, 0.5], [0.9, 1.4], [1, 0]], color: '#b8e060', alpha: [[0, 0.8], [1, 0]], emissive: 1, render: { sprite: 'ring', lit: 0.6 } },
] });
add('iceBurst', 'magic', 'a burst of ice: shards flying out, frost mist, glints (one shot)', { emitters: [
  { name: 'shards', ...once(24), life: [0.6, 1.2], shape: { type: 'sphere', radius: 0.2, offset: [0, 0.8, 0] }, velocity: { speed: [3, 7], spread: 180 }, gravity: -9.8, drag: 0.5, size: [0.04, 0.1], color: '#c8ecff', rotation: [0, 360], spin: [-600, 600],
    render: { type: 'mesh', mesh: 'shard', lit: 1 }, collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.3, friction: 0.4, lifeLoss: 0.2 } },
  puff({ name: 'mist', ...once(14), life: [0.8, 1.6], shape: { type: 'sphere', radius: 0.3, offset: [0, 0.8, 0] }, velocity: { normal: [1, 3] }, gravity: -0.3, drag: 3, size: [0.5, 0.9], color: '#e8f6ff', alpha: [[0, 0], [0.1, 0.5], [1, 0]] }),
  { name: 'glints', ...once(30), life: [0.3, 0.8], shape: { type: 'sphere', radius: 0.8, offset: [0, 0.8, 0] }, size: [0.03, 0.06], color: '#ffffff', alpha: [[0, 1], [1, 0]], emissive: 6, rotation: [0, 90], render: { blend: 'add', sprite: 'star' } },
] });
add('lightningStrike', 'magic', 'lightning striking the ground: a bolt of streaks, a flash, a scorch ring and sparks (one go)', { emitters: [
  { name: 'bolt', ...once(70), life: [0.08, 0.16], shape: { type: 'edge', a: [0, 0, 0], b: [0, 14, 0] }, velocity: { random: [1, 3] }, turbulence: { strength: 8, scale: 0.6, speed: 3 }, size: [0.06, 0.14], color: '#eef6ff', alpha: [[0, 1], [1, 0]], emissive: 14,
    render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.05 } },
  { name: 'flash', ...once(1), life: [0.15, 0.15], shape: { type: 'point', offset: [0, 1, 0] }, size: [3, 3], color: '#dfe8ff', alpha: [[0, 0.8], [1, 0]], emissive: 5, render: { blend: 'add', sprite: 'soft' } },   // smaller and dimmer: at 6 m and 10 it washed out the whole view
  sparkBurst({ name: 'sparks', ...once(40), velocity: { speed: [3, 8], spread: 70 } }),
  { name: 'scorch', ...once(1), life: [2.5, 2.5], shape: { type: 'point', offset: [0, 0.02, 0] }, size: [1.4, 1.4], color: '#1a1410', alpha: [[0, 0.8], [0.7, 0.6], [1, 0]], render: { type: 'horizontal', sprite: 'soft' } },
] });
add('summonCircle', 'magic', 'a summoning circle: two counter-turning rings on the ground and rising runes of light (loop)', { emitters: [
  { name: 'rings', rate: 2, life: [1.5, 1.5], shape: { type: 'point', offset: [0, 0.02, 0] }, size: [2.4, 2.4], color: '#ff9040', alpha: [[0, 0], [0.2, 0.8], [0.8, 0.8], [1, 0]], emissive: 4, rotation: [0, 360], spin: [-40, 40], render: { type: 'horizontal', blend: 'add', sprite: 'ring' } },
  { name: 'runes', rate: 24, life: [1, 1.8], shape: { type: 'ring', radius: 1.1 }, velocity: { speed: [0.3, 0.8], spread: 4 }, size: [0.06, 0.1], color: [[0, '#ffd080'], [1, '#ff6020']], alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 5, rotation: [0, 360], render: { blend: 'add', sprite: 'star' } },
] });
add('hologramMotes', 'magic', 'a hologram flickering: cyan motes drifting up through a 1 m column (loop)', { rate: 40, life: [1, 2], shape: { type: 'box', size: [0.6, 1.6, 0.6], offset: [0, 0.9, 0] }, velocity: { speed: [0.1, 0.3], spread: 5 }, size: [0.01, 0.02],
  color: '#60f0ff', alpha: [[0, 0], [0.1, 1], [0.5, 0.3], [0.6, 1], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'disc' } });
add('buffSparkle', 'magic', 'a buff on a person: glints circling the body (loop)', { rate: 24, life: [0.6, 1.2], shape: { type: 'ring', radius: 0.45, offset: [0, 1, 0] }, attractors: [{ position: [0, 1, 0], strength: 0, radius: 1, spin: 4 }],
  velocity: { speed: [0.2, 0.6], spread: 30 }, size: [0.03, 0.05], color: '#fff2b0', alpha: [[0, 0], [0.2, 1], [1, 0]], emissive: 5, rotation: [0, 90], render: { blend: 'add', sprite: 'star' } });

// ---------------------------------------------------------------------------------------------------------------
// celebration and ambience
add('fireworkBurst', 'celebration', 'a firework shell bursting: a sphere of trailing stars that fall and fade (one go; place it in the sky)', { ...once(140), life: [1.4, 2.2], velocity: { speed: [9, 12], spread: 180 }, gravity: -3, drag: 1.4,
  size: [0.08, 0.12], color: [[0, '#ffffff'], [0.15, '#ffd070'], [0.6, '#ff4060'], [1, '#601020']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 9, render: { blend: 'add', sprite: 'soft' }, trail: { segments: 10, every: 2, width: 0.5, taper: 1 },
  sub: [{ on: 'death', count: 2, emitter: { name: 'crackle', life: [0.1, 0.2], velocity: { random: [0.5, 1.5] }, size: [0.05, 0.08], color: '#fff6e0', alpha: [[0, 1], [1, 0]], emissive: 8, render: { blend: 'add', sprite: 'star' } } }] });
add('fireworkRocket', 'celebration', 'a firework rocket going up on a trail of sparks (one go, 1.6 s)', { ...once(1), life: [1.6, 1.6], velocity: { speed: [22, 24], spread: 3 }, gravity: -6, size: [0.06, 0.06], color: '#fff0c0', emissive: 8, render: { blend: 'add', sprite: 'soft' },
  sub: [{ on: 'life', rate: 70, emitter: { name: 'sparks', life: [0.3, 0.7], velocity: { random: [0.3, 1] }, gravity: -4, size: [0.015, 0.03], color: [[0, '#ffe0a0'], [1, '#ff6020']], alpha: [[0, 1], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'spark' } } }] });
add('confetti', 'celebration', 'confetti thrown up and fluttering down (one go)', { ...once(160), life: [3, 5], shape: { type: 'point', offset: [0, 1, 0] }, velocity: { speed: [4, 7], spread: 35 }, gravity: -3, drag: 1.6, wind: 1, turbulence: { strength: 1.5, scale: 0.8, speed: 0.5 },
  size: [0.02, 0.035], color: [[0, '#ff4060'], [0.25, '#ffd040'], [0.5, '#40c0ff'], [0.75, '#60e080'], [1, '#c060ff']], rotation: [0, 360], spin: [-700, 700], render: { type: 'mesh', mesh: 'shard', lit: 1 },
  collision: { mode: 'stick', ground: true, depth: true, lifeLoss: 0.3 } });
add('sparkler', 'celebration', 'a sparkler: a white-hot point throwing branching sparks (loop)', { rate: 160, life: [0.15, 0.4], velocity: { speed: [1.5, 3.5], spread: 180 }, drag: 2, size: [0.008, 0.015], color: [[0, '#ffffff'], [1, '#ffc060']], alpha: [[0, 1], [1, 0]], emissive: 10,
  render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 }, sub: [{ on: 'death', count: 2, emitter: { name: 'fork', life: [0.05, 0.12], velocity: { random: [1, 2] }, size: [0.006, 0.01], color: '#fff4d0', emissive: 8, render: { blend: 'add', sprite: 'spark' } } }] });
add('dustMotes', 'ambience', 'dust motes turning in a shaft of light in a room (loop)', { rate: 12, life: [6, 10], shape: { type: 'box', size: [2, 2.4, 2], offset: [0, 1.4, 0] }, velocity: { speed: [0.005, 0.03], spread: 180 }, drag: 1.5,
  turbulence: { strength: 0.04, scale: 1, speed: 0.08 }, size: [0.003, 0.007], color: '#fff0d8', alpha: [[0, 0], [0.2, 0.9], [0.8, 0.9], [1, 0]], render: { sprite: 'disc', lit: 1 } });
add('sandTrickle', 'ambience', 'sand or grit trickling from a crack (loop)', { rate: 120, life: [0.6, 1], shape: { type: 'sphere', radius: 0.02 }, velocity: { speed: [0.05, 0.2], spread: 20, dir: [0, -1, 0] }, gravity: -9.8, size: [0.004, 0.008], color: '#b89a70',
  render: { type: 'stretched', sprite: 'soft', stretch: 0.01, lit: 1 }, collision: { mode: 'kill', ground: true, depth: true },
  sub: [{ on: 'death', count: 1, emitter: { name: 'puff', life: [0.3, 0.6], velocity: { random: [0.05, 0.2] }, size: [0.03, 0.06], sizeOverLife: [[0, 0.5], [1, 2]], color: '#c8ac80', alpha: [[0, 0.3], [1, 0]], render: { lit: 1 } } }] });
add('butterflies', 'ambience', 'butterflies flitting over a 3 m patch (loop)', { rate: 1.5, life: [6, 9], shape: { type: 'box', size: [3, 0.6, 3], offset: [0, 0.8, 0] }, velocity: { speed: [0.3, 0.6], spread: 180 }, drag: 0.6, turbulence: { strength: 1.2, scale: 0.6, speed: 0.6 },
  size: [0.05, 0.07], color: [[0, '#ffb030'], [0.5, '#f8f0e0'], [1, '#6080ff']], rotation: [0, 360], spin: [-400, 400], render: { type: 'mesh', mesh: 'shard', lit: 1 } });

export const VFX_RECIPES = Object.freeze(R);
export const VFX_CATEGORIES = Object.freeze(['combat', 'weather', 'fire', 'water', 'magic', 'celebration', 'ambience']);

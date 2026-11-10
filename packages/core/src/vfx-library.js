// Mirage original code.
// Ready effects in the effect description format (vfx-data.js): plain JSON, so each is also a worked example to copy
// and change. Metres and seconds; an effect's +Y is "up" unless the instance is turned (spawn's `direction`).
//
//   import { createVfx, VFX_LIBRARY } from '@mirage/core';
//   const vfx = createVfx(world);
//   vfx.spawn(VFX_LIBRARY.fire, { position: [0, 0, 0] });        // loops until handle.stop()
//   vfx.burst(VFX_LIBRARY.dust, foot);                            // one-shots: dust, sparks, splash, magic, explosion
//
// Looping: fire, smoke, snow, leaves, fireflies. One-shot: sparks, dust, splash, magic, explosion.
// `collision.ground` needs vfx.setGround(walkGrid); `collision.depth` uses what the camera sees and needs nothing.

const smokePuff = (o) => ({
  life: [2.6, 4.2], shape: { type: 'sphere', radius: 0.18 }, velocity: { speed: [0.6, 1.0], spread: 12 }, gravity: 0.55, drag: 0.5, wind: 0.45,
  turbulence: { strength: 0.45, scale: 1.2, speed: 0.35 }, size: [0.7, 1.0], sizeOverLife: [[0, 0.35], [0.4, 1], [1, 2.2]],
  color: [[0, '#2c2824'], [0.5, '#5f5a54'], [1, '#8a857e']], alpha: [[0, 0], [0.15, 0.55], [0.6, 0.3], [1, 0]], rotation: [0, 360], spin: [-25, 25],
  render: { blend: 'alpha', lit: 1, soft: 0.6, sort: 'oldest', order: -1, flipbook: { sheet: 'smoke', fps: 0, blend: true } }, ...o,
});

export const VFX_LIBRARY = {
  // a camp fire about half a metre across: flames (one draw that slides between alpha and additive), embers, smoke
  fire: { name: 'fire', emitters: [
    smokePuff({ name: 'smoke', rate: 7, shape: { type: 'sphere', radius: 0.15, offset: [0, 0.9, 0] } }),
    { name: 'flames', rate: 30, life: [0.6, 1.0], shape: { type: 'sphere', radius: 0.22, hemisphere: true }, velocity: { speed: [0.8, 1.5], spread: 10 }, gravity: 0.8, drag: 0.8,
      turbulence: { strength: 0.5, scale: 0.6, speed: 0.8 }, wind: 0.5, size: [0.55, 0.85], sizeOverLife: [[0, 0.55], [0.3, 1], [1, 0.35]],
      color: [[0, '#fff2c8'], [0.25, '#ffb445'], [0.6, '#ff5a1c'], [1, '#4a1005']], alpha: [[0, 0], [0.12, 0.9], [0.7, 0.55], [1, 0]], emissive: [[0, 2.5], [1, 0.5]],
      rotation: [-15, 15], render: { blend: 'premultiplied', additive: 0.8, soft: 0.25, flipbook: { sheet: 'flame', fps: 14, blend: true } } },
    { name: 'embers', rate: 9, life: [1.0, 2.4], shape: { type: 'sphere', radius: 0.2 }, velocity: { speed: [1.2, 2.6], spread: 22 }, gravity: 0.6, drag: 0.5, wind: 1,
      turbulence: { strength: 1.6, scale: 0.5, speed: 1 }, size: [0.02, 0.04], color: [[0, '#ffd27a'], [0.6, '#ff6a1e'], [1, '#7a1a05']], alpha: [[0, 1], [0.8, 1], [1, 0]], emissive: 6,
      render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.03 } },
  ] },
  // a standing column of smoke, lit and shadowed like the scene and bent by the world's wind
  smoke: smokePuff({ name: 'smoke', rate: 14, life: [4, 6.5], shape: { type: 'sphere', radius: 0.3 }, size: [0.9, 1.4], velocity: { speed: [0.9, 1.4], spread: 9 } }),
  // a shower of sparks that bounce off whatever the camera sees (and the ground height map, when one is set)
  sparks: { name: 'sparks', bursts: [{ time: 0, count: 70 }], duration: 0.1, life: [0.5, 1.3], velocity: { speed: [2.5, 8], spread: 55 }, gravity: -9.8, drag: 0.5,
    size: [0.02, 0.035], color: [[0, '#fff3d0'], [0.3, '#ffb84a'], [1, '#c8380a']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 8,
    render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.025 }, collision: { mode: 'bounce', depth: true, ground: true, bounce: 0.45, friction: 0.35, lifeLoss: 0.15, radius: 0.02 } },
  // the puff under a footstep: a low ring pushed outward, gone in a second
  dust: { name: 'dust', bursts: [{ time: 0, count: 14 }], duration: 0.1, life: [0.5, 1.1], shape: { type: 'ring', radius: 0.12, offset: [0, 0.05, 0] }, velocity: { speed: [0.15, 0.5], normal: [0.5, 1.3], spread: 30 },
    gravity: -0.25, drag: 2.8, wind: 0.6, size: [0.14, 0.24], sizeOverLife: [[0, 0.4], [1, 2]], color: '#b7a58a', alpha: [[0, 0], [0.15, 0.4], [1, 0]], rotation: [0, 360], spin: [-40, 40],
    render: { blend: 'alpha', lit: 1, soft: 0.15, nearFade: 0.3 }, lod: { near: 15, far: 50, min: 0.3, cull: 80 } },
  // something dropped in water: drops thrown up in a crown, a ring spreading on the surface, a ripple where each drop lands
  splash: { name: 'splash', emitters: [
    { name: 'drops', bursts: [{ time: 0, count: 48 }], duration: 0.1, life: [0.7, 1.4], shape: { type: 'ring', radius: 0.12 }, velocity: { speed: [2.2, 4.6], spread: 28, normal: [0.2, 1.0] }, gravity: -9.8, drag: 0.2,
      size: [0.035, 0.07], color: '#d6e8f2', alpha: [[0, 0.9], [0.8, 0.8], [1, 0]], render: { type: 'stretched', sprite: 'drop', stretch: 0.012, lit: 1 },
      collision: { mode: 'kill', ground: true, planes: [], radius: 0.02 },
      sub: [{ on: 'death', count: 1, emitter: { name: 'ripple', life: [0.5, 0.9], size: [0.12, 0.2], sizeOverLife: [[0, 0.3], [1, 2.6]], color: '#e6f2f8', alpha: [[0, 0.6], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 1 } } }] },
    { name: 'crown', bursts: [{ time: 0, count: 2 }], duration: 0.1, life: [0.7, 1.0], shape: { type: 'point', offset: [0, 0.02, 0] }, size: [0.5, 0.7], sizeOverLife: [[0, 0.25], [1, 3.2]], color: '#e6f2f8',
      alpha: [[0, 0.8], [1, 0]], render: { type: 'horizontal', sprite: 'ring', lit: 1 } },
    { name: 'mist', bursts: [{ time: 0, count: 12 }], duration: 0.1, life: [0.5, 0.9], shape: { type: 'sphere', radius: 0.15, hemisphere: true }, velocity: { speed: [0.6, 1.6], spread: 50 }, gravity: -2, drag: 2,
      size: [0.25, 0.45], sizeOverLife: [[0, 0.5], [1, 1.8]], color: '#eef6fa', alpha: [[0, 0.35], [1, 0]], render: { lit: 1, soft: 0.2 } },
  ] },
  // snowfall over a 30 m square that follows whatever it is attached to (spawn it with follow: the camera rig)
  snow: { name: 'snow', rate: 700, life: [7, 10], shape: { type: 'box', size: [30, 1, 30], offset: [0, 9, 0] }, velocity: { dir: [0, -1, 0], speed: [0.9, 1.5], spread: 8 }, wind: 1.2,
    turbulence: { strength: 0.5, scale: 2.5, speed: 0.25 }, gravity: -2.4, drag: 0.6, size: [0.05, 0.1], color: '#f4f7fb', alpha: [[0, 0], [0.05, 0.9], [0.92, 0.9], [1, 0]], rotation: [0, 360], spin: [-60, 60],
    render: { sprite: 'soft', lit: 1, nearFade: 0.25 }, collision: { mode: 'stick', ground: true, depth: true, lifeLoss: 0.7 }, lod: { near: 60, far: 200, min: 0.5 } },
  // (wind couples on every axis, so it is drag too: the terminal fall speed is gravity / (drag + wind))
  // leaves coming down from a canopy: they tumble (mesh particles), drift on the wind and lie where they land
  leaves: { name: 'leaves', rate: 7, life: [6, 9], shape: { type: 'box', size: [8, 0.5, 8], offset: [0, 5, 0] }, velocity: { dir: [0, -1, 0], speed: [0.3, 0.8], spread: 30 }, gravity: -2.6, drag: 1.4, wind: 1.6,
    turbulence: { strength: 1.3, scale: 1.4, speed: 0.4 }, size: [0.07, 0.12], color: [[0, '#a8842c'], [1, '#7a4a1c']], alpha: [[0, 0], [0.05, 1], [0.9, 1], [1, 0]], rotation: [0, 360], spin: [-220, 220],
    spinOverLife: [[0, 1], [1, 0.6]], render: { type: 'mesh', mesh: 'shard', lit: 1 }, collision: { mode: 'stick', ground: true, depth: true, lifeLoss: 0.4 } },
  // fireflies wandering in a 4 m sphere at dusk: each blinks three times over its life
  fireflies: { name: 'fireflies', rate: 6, life: [4, 7], shape: { type: 'sphere', radius: 4, offset: [0, 1.4, 0] }, velocity: { speed: [0.05, 0.25], spread: 180 }, drag: 1,
    turbulence: { strength: 0.7, scale: 1.8, speed: 0.3 }, size: [0.05, 0.08], color: '#d4ff5a', alpha: [[0, 0], [0.1, 1], [0.3, 0.15], [0.5, 1], [0.7, 0.15], [0.9, 1], [1, 0]], emissive: 5,
    render: { blend: 'add', sprite: 'soft' } },
  // a spell going off: motes pulled into a spiral round a point above the ground, each leaving a ribbon, and a ground ring
  magic: { name: 'magic', emitters: [
    { name: 'motes', bursts: [{ time: 0, count: 90 }], duration: 0.1, life: [1.1, 1.9], shape: { type: 'ring', radius: 0.9, offset: [0, 0.1, 0] }, velocity: { speed: [0.5, 1.8], spread: 15, normal: [-0.4, 0.4] }, drag: 0.6,
      attractors: [{ position: [0, 1.3, 0], strength: 7, radius: 4, spin: 6 }], size: [0.05, 0.09], sizeOverLife: [[0, 1], [1, 0.2]], color: [[0, '#bff4ff'], [0.5, '#6aa8ff'], [1, '#b05cff']],
      alpha: [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]], emissive: 5, render: { blend: 'add', sprite: 'star' }, trail: { segments: 12, every: 2, width: 0.7, taper: 1 } },
    { name: 'ring', bursts: [{ time: 0, count: 1 }, { time: 0.25, count: 1 }], duration: 0.4, life: [0.9, 0.9], shape: { type: 'point', offset: [0, 0.03, 0] }, size: [1, 1], sizeOverLife: [[0, 0.4], [1, 3.4]],
      color: [[0, '#d8f8ff'], [1, '#7a5cff']], alpha: [[0, 0.9], [1, 0]], emissive: 4, render: { type: 'horizontal', blend: 'add', sprite: 'ring' } },
    { name: 'glints', rate: 40, loop: false, duration: 1.2, life: [0.3, 0.7], shape: { type: 'sphere', radius: 1.1, offset: [0, 1.2, 0] }, size: [0.06, 0.14], sizeOverLife: [[0, 0], [0.3, 1], [1, 0]], color: '#e8f6ff',
      alpha: 1, emissive: 6, rotation: [0, 90], spin: [-90, 90], render: { blend: 'add', sprite: 'star' } },
  ] },
  // a blast about three metres across: flash, fireball, sparks with trails, tumbling debris that bounces and kicks
  // up dust where it lands, and the smoke that is left
  explosion: { name: 'explosion', emitters: [
    smokePuff({ name: 'smoke', bursts: [{ time: 0.08, count: 26 }], duration: 0.3, life: [2.2, 3.8], shape: { type: 'sphere', radius: 0.6, offset: [0, 0.5, 0] }, velocity: { speed: [0, 0.4], normal: [0.8, 3], spread: 180 }, drag: 1.6, gravity: 0.35, size: [1.2, 1.9] }),
    { name: 'fireball', bursts: [{ time: 0, count: 28 }], duration: 0.1, life: [0.45, 0.85], shape: { type: 'sphere', radius: 0.3, offset: [0, 0.4, 0] }, velocity: { speed: [0, 0.5], normal: [2, 6.5], spread: 180 }, drag: 3.5, gravity: 0.8,
      size: [0.9, 1.5], sizeOverLife: [[0, 0.4], [0.3, 1], [1, 1.3]], color: [[0, '#fff6d8'], [0.2, '#ffc050'], [0.55, '#ff5a1a'], [1, '#2a0d05']], alpha: [[0, 0.95], [0.6, 0.7], [1, 0]], emissive: [[0, 6], [0.5, 1.5], [1, 0]],
      rotation: [0, 360], spin: [-60, 60], render: { blend: 'premultiplied', additive: 0.7, soft: 0.4, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    { name: 'flash', bursts: [{ time: 0, count: 1 }], duration: 0.1, life: [0.16, 0.16], shape: { type: 'point', offset: [0, 0.5, 0] }, size: [5, 5], sizeOverLife: [[0, 0.4], [1, 1.2]], color: '#ffe2a8', alpha: [[0, 1], [1, 0]], emissive: 10,
      render: { blend: 'add', sprite: 'soft', soft: 0.5 } },
    { name: 'sparks', bursts: [{ time: 0, count: 36 }], duration: 0.1, life: [0.6, 1.3], shape: { type: 'sphere', radius: 0.2, offset: [0, 0.4, 0] }, velocity: { speed: [5, 12], spread: 75 }, gravity: -9.8, drag: 0.9,
      size: [0.03, 0.05], color: [[0, '#fff3d0'], [0.4, '#ffa23a'], [1, '#a82a08']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 8, render: { blend: 'add', sprite: 'soft' },
      trail: { segments: 10, every: 1, width: 0.8, taper: 1 }, collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.4, friction: 0.4, lifeLoss: 0.2 } },
    { name: 'debris', bursts: [{ time: 0, count: 22 }], duration: 0.1, life: [1.6, 2.8], shape: { type: 'sphere', radius: 0.25, offset: [0, 0.3, 0] }, velocity: { speed: [4, 9], spread: 65 }, gravity: -9.8, drag: 0.15,
      size: [0.06, 0.16], color: '#3a332c', alpha: [[0, 1], [0.85, 1], [1, 0]], rotation: [0, 360], spin: [-720, 720], render: { type: 'mesh', mesh: 'shard', lit: 1 },
      collision: { mode: 'bounce', ground: true, depth: true, bounce: 0.35, friction: 0.5, lifeLoss: 0.1, radius: 0.05 },
      sub: [{ on: 'collision', count: 2, emitter: { name: 'kick', life: [0.4, 0.8], velocity: { speed: [0.2, 0.7], spread: 60 }, drag: 3, size: [0.12, 0.2], sizeOverLife: [[0, 0.5], [1, 2]], color: '#a8977e',
        alpha: [[0, 0.4], [1, 0]], render: { lit: 1, soft: 0.15 } } }] },
  ] },
};

// The district's effects, in @miragekit/core's effect format (docs/vfx.md): plain data, each emitter one GPU pool.
// Particles take the sun, the sky and the fog but no local lamps, so at night the ones that should be seen are
// unlit and tinted by hand toward the sign they stand next to.
import { VFX_LIBRARY } from '@miragekit/core';

const steam = (tint) => ({ name: 'nd-steam-' + tint, rate: 8, life: [2.4, 3.8], shape: { type: 'box', size: [0.8, 0.04, 0.5] }, velocity: { speed: [0.8, 1.5], spread: 9 }, gravity: 0.45, drag: 0.55, wind: 0.35,
  turbulence: { strength: 0.5, scale: 1.1, speed: 0.4 }, size: [0.32, 0.5], sizeOverLife: [[0, 0.3], [0.5, 1], [1, 2.6]], color: [[0, tint], [1, '#59616b']], alpha: [[0, 0], [0.15, 0.1], [0.6, 0.055], [1, 0]],
  rotation: [0, 360], spin: [-18, 18], render: { blend: 'alpha', soft: 0.7, nearFade: 1.6, sort: 'oldest', order: -1, flipbook: { sheet: 'smoke', fps: 0, blend: true } }, lod: { near: 18, far: 45, min: 0.35, cull: 60 } });

export const FX = {
  steam,
  // a round hitting something hard: a few sparks along the surface normal and a puff of dust
  impact: { name: 'nd-impact', emitters: [
    { name: 'sparks', bursts: [{ time: 0, count: 12 }], duration: 0.05, life: [0.15, 0.5], velocity: { speed: [1.5, 6], spread: 50 }, gravity: -9.8, drag: 0.8, size: [0.012, 0.024],
      color: [[0, '#fff6d8'], [0.4, '#ffc060'], [1, '#c8400a']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 7, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 } },
    { name: 'dust', bursts: [{ time: 0, count: 3 }], duration: 0.05, life: [0.4, 0.8], velocity: { speed: [0.3, 0.9], spread: 35 }, drag: 2.5, size: [0.12, 0.2], sizeOverLife: [[0, 0.4], [1, 2.2]],
      color: '#6a7078', alpha: [[0, 0.28], [1, 0]], rotation: [0, 360], render: { blend: 'alpha', soft: 0.2 } },
  ] },
  // the carbine's muzzle: a star of light for two frames, sparks thrown forward
  muzzle: { name: 'nd-muzzle', emitters: [
    { name: 'flash', bursts: [{ time: 0, count: 2 }], duration: 0.03, life: [0.03, 0.05], size: [0.14, 0.24], rotation: [0, 360], color: [[0, '#fff4d0'], [1, '#ff9a30']], alpha: [[0, 1], [1, 0]], emissive: 9,
      render: { blend: 'add', sprite: 'star' } },
    { name: 'sparks', bursts: [{ time: 0, count: 5 }], duration: 0.03, life: [0.08, 0.2], velocity: { speed: [6, 14], spread: 14 }, drag: 3, size: [0.008, 0.016], color: [[0, '#fff0c0'], [1, '#ff7a20']], alpha: [[0, 1], [1, 0]],
      emissive: 8, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.02 } },
  ] },
  // a sentinel taking a round, and going down
  hit: { name: 'nd-hit', bursts: [{ time: 0, count: 16 }], duration: 0.05, life: [0.2, 0.6], velocity: { speed: [1.5, 5], spread: 70 }, gravity: -7, drag: 1, size: [0.014, 0.03],
    color: [[0, '#e8fbff'], [0.4, '#58d8ff'], [1, '#2038c0']], alpha: [[0, 1], [0.7, 1], [1, 0]], emissive: 8, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.022 } },
  down: { name: 'nd-down', emitters: [
    { name: 'burst', bursts: [{ time: 0, count: 60 }], duration: 0.08, life: [0.4, 1.2], shape: { type: 'sphere', radius: 0.2 }, velocity: { speed: [2, 7], spread: 180 }, gravity: -8, drag: 0.7, size: [0.016, 0.034],
      color: [[0, '#f0fcff'], [0.3, '#58d8ff'], [1, '#3020a0']], alpha: [[0, 1], [0.8, 1], [1, 0]], emissive: 9, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.024 },
      collision: { mode: 'bounce', depth: true, bounce: 0.4, friction: 0.4, lifeLoss: 0.2, radius: 0.02 } },
    { name: 'smoke', bursts: [{ time: 0, count: 6 }, { time: 0.4, count: 4 }], duration: 0.6, life: [1.2, 2.2], shape: { type: 'sphere', radius: 0.25 }, velocity: { speed: [0.3, 1], spread: 60 }, gravity: 0.5, drag: 1.2,
      size: [0.5, 0.8], sizeOverLife: [[0, 0.4], [1, 2]], color: [[0, '#4a6a80'], [1, '#30343a']], alpha: [[0, 0.3], [1, 0]], rotation: [0, 360], render: { blend: 'alpha', soft: 0.5, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
  ] },
  // a broken fitting: the library's shower of sparks, as it is
  sparks: VFX_LIBRARY.sparks,
  // rain meeting the ground round the player: rings that spread and fade on the wet surface
  splash: { name: 'nd-splash', rate: 170, life: [0.22, 0.4], shape: { type: 'box', size: [16, 0.01, 16] }, size: [0.07, 0.13], sizeOverLife: [[0, 0.3], [1, 2.4]], color: '#9ab0c4', alpha: [[0, 0.3], [1, 0]],
    render: { type: 'horizontal', blend: 'add', sprite: 'ring' }, capacity: 200 },
  // motes drifting round the hologram
  motes: { name: 'nd-motes', rate: 16, life: [3, 6], shape: { type: 'sphere', radius: 3.2 }, velocity: { speed: [0.05, 0.3], spread: 180 }, drag: 0.8, turbulence: { strength: 0.6, scale: 1.6, speed: 0.3 },
    attractors: [{ position: [0, 0, 0], strength: 0.5, radius: 5, spin: 1.2 }], size: [0.025, 0.05], color: [[0, '#bff6ff'], [1, '#ff4fa0']], alpha: [[0, 0], [0.15, 0.9], [0.8, 0.7], [1, 0]], emissive: 5,
    render: { blend: 'add', sprite: 'soft' }, lod: { near: 25, far: 60, min: 0.3, cull: 80 } },
  // the rocket: a smoke trail that follows it (lit by hand: warm near the motor, grey behind), a few embers
  rocketTrail: { name: 'nd-rocket-trail', emitters: [
    { name: 'smoke', rate: 140, life: [0.8, 1.6], shape: { type: 'sphere', radius: 0.04 }, velocity: { speed: [0.1, 0.5], spread: 180 }, drag: 1.4, gravity: 0.25, turbulence: { strength: 0.6, scale: 1.2, speed: 0.6 },
      size: [0.12, 0.2], sizeOverLife: [[0, 0.5], [1, 3.2]], color: [[0, '#ffb070'], [0.12, '#8a8378'], [1, '#4a4c52']], alpha: [[0, 0.5], [0.3, 0.32], [1, 0]], rotation: [0, 360], spin: [-40, 40],
      render: { blend: 'alpha', soft: 0.5, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    { name: 'embers', rate: 60, life: [0.15, 0.35], velocity: { speed: [0.5, 2], spread: 180 }, drag: 2, size: [0.02, 0.04], color: [[0, '#fff0c0'], [1, '#ff6a10']], alpha: [[0, 1], [1, 0]], emissive: 9,
      render: { blend: 'add', sprite: 'soft' } },
  ] },
  // the rocket's burst: a fireball, a flash, sparks thrown out with bounces, a column of smoke, debris
  explosion: { name: 'nd-explosion', emitters: [
    { name: 'flash', bursts: [{ time: 0, count: 3 }], duration: 0.05, life: [0.08, 0.14], size: [2.6, 3.6], color: [[0, '#fff8e0'], [1, '#ffa040']], alpha: [[0, 1], [1, 0]], emissive: 12, render: { blend: 'add', sprite: 'soft' } },
    { name: 'fire', bursts: [{ time: 0, count: 26 }], duration: 0.08, life: [0.35, 0.8], shape: { type: 'sphere', radius: 0.5 }, velocity: { speed: [1.5, 5], spread: 180 }, drag: 3, gravity: 1.2,
      size: [0.7, 1.3], sizeOverLife: [[0, 0.6], [0.4, 1.4], [1, 1.8]], color: [[0, '#fff0c0'], [0.3, '#ff9a30'], [0.7, '#c03a10'], [1, '#301810']], alpha: [[0, 1], [0.6, 0.7], [1, 0]], emissive: 7, rotation: [0, 360], spin: [-60, 60],
      render: { blend: 'add', soft: 0.6, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    { name: 'sparks', bursts: [{ time: 0, count: 70 }], duration: 0.06, life: [0.4, 1.4], velocity: { speed: [6, 18], spread: 180 }, gravity: -9.8, drag: 0.6, size: [0.02, 0.045],
      color: [[0, '#fff6d8'], [0.4, '#ffc060'], [1, '#c8400a']], alpha: [[0, 1], [0.8, 1], [1, 0]], emissive: 9, render: { blend: 'add', type: 'stretched', sprite: 'spark', stretch: 0.03 },
      collision: { mode: 'bounce', depth: true, bounce: 0.35, friction: 0.4, lifeLoss: 0.25, radius: 0.02 } },
    { name: 'smoke', bursts: [{ time: 0.05, count: 18 }, { time: 0.35, count: 8 }], duration: 0.5, life: [2.2, 4], shape: { type: 'sphere', radius: 0.8 }, velocity: { speed: [0.5, 2.2], spread: 180 }, gravity: 0.9, drag: 1.1,
      turbulence: { strength: 0.6, scale: 1.4, speed: 0.4 }, size: [1.2, 2], sizeOverLife: [[0, 0.5], [1, 2.6]], color: [[0, '#5a4a40'], [1, '#2c2e33']], alpha: [[0, 0.55], [0.5, 0.3], [1, 0]], rotation: [0, 360], spin: [-20, 20],
      render: { blend: 'alpha', soft: 0.8, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    { name: 'debris', bursts: [{ time: 0, count: 22 }], duration: 0.05, life: [0.8, 1.8], velocity: { speed: [4, 10], spread: 75 }, gravity: -9.8, drag: 0.3, size: [0.04, 0.08], color: '#202226', alpha: [[0, 1], [0.85, 1], [1, 0]],
      rotation: [0, 360], spin: [-300, 300], render: { blend: 'alpha' }, collision: { mode: 'bounce', depth: true, bounce: 0.3, friction: 0.5, lifeLoss: 0.2, radius: 0.04 } },
  ] },
  // the launcher's back-blast: a cone of hot gas and dust out of the back of the tube
  backblast: { name: 'nd-backblast', emitters: [
    { name: 'gas', bursts: [{ time: 0, count: 14 }], duration: 0.05, life: [0.25, 0.6], velocity: { speed: [4, 9], spread: 16 }, drag: 4, size: [0.3, 0.6], sizeOverLife: [[0, 0.5], [1, 2.4]],
      color: [[0, '#ffd8a0'], [0.2, '#a09080'], [1, '#55575c']], alpha: [[0, 0.6], [1, 0]], rotation: [0, 360], render: { blend: 'alpha', soft: 0.4, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
  ] },
  // a pickup taken
  take: { name: 'nd-take', bursts: [{ time: 0, count: 18 }], duration: 0.05, life: [0.3, 0.7], shape: { type: 'ring', radius: 0.18 }, velocity: { speed: [0.4, 1.4], normal: [0.6, 1.6], spread: 20 }, drag: 1.5,
    size: [0.03, 0.05], sizeOverLife: [[0, 1], [1, 0.2]], color: '#aef4ff', alpha: [[0, 1], [1, 0]], emissive: 6, render: { blend: 'add', sprite: 'star' } },
};

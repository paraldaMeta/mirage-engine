// The ford crosses the creek west to east at z = 0. River bends are shared by the bed, water and banks.
export function channelX(z) { return 1.35 * Math.sin(z * 0.115) + 0.45 * Math.sin(z * 0.24); }
const bank = side => Array.from({ length: 37 }, (_, i) => {
  const z = -36 + i * 2;
  return [channelX(z) + side * 6.5, z];
});

export default {
  name: 'river-ford', seed: 'alder-crossing',
  bounds: [-17, -13, 17, 13], walk: { yMin: -2, yMax: 7 },
  land: { bounds: [-38, -40, 38, 40], segments: [152, 160] },
  creek: { outline: [...bank(-1), ...bank(1).reverse()], level: 0, flow: [0, 0.32], ripple: 0.055 },
  paths: { crossing: { points: [[-10, 0], [0, 0], [10, 0]], width: 2.5 } },
  render: { time: { elevation: 19, azimuth: 245 }, envProbe: [-5, 2.2, 4],
    shadow: { center: [0, 2, 0], radius: 26 }, fog: { groundDensity: 0.0015, height: 26 }, post: { grain: 0 } },
  spawn: { eye: [-10, 3.1, 0], look: [1, 0.65, 0], mode: 'walk' },
  viewpoints: [
    { name: 'west-bank', eye: [-10, 2.9, 3], look: [1, 0.6, -1], mode: 'orbit' },
    { name: 'waterline', eye: [-2.4, 0.48, 5.2], look: [0.4, 0.18, -3.3], mode: 'orbit' },
    { name: 'east-shingle', eye: [6.4, 1.85, -3.5], look: [-1, 0.26, 2.2], mode: 'orbit' },
    { name: 'river-bend', eye: [11, 10, 17], look: [0, 0, -4], mode: 'orbit' }
  ],
  budget: { singleFileMB: 5 }
};

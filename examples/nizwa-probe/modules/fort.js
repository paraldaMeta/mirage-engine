// fort: Nizwa Fort, built by the Nizwa project's own module (src/world/fort.js and the nine files it imports, read
// in place and unchanged) against a Nizwa context made from this Mirage world (compat/ctx.js). This file is the
// whole adapter between the two module protocols:
//   Nizwa build(ctx) -> { object, footprints, ambientVolumes, anchors: { wallLamps, doors }, site }
//   Mirage module    -> build adds to ctx.root; anchors -> `lamps`; ambientVolumes -> [{ min, max, factor, soft }]
import { build } from '@nizwa/world/fort.js';

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const size = (v) => (v.max[0] - v.min[0]) * (v.max[1] - v.min[1]) * (v.max[2] - v.min[2]);

export default {
  name: 'fort',
  async build(ctx) {
    const nz = ctx.shared.nz, t0 = performance.now();
    const res = await build(nz);
    nz.modules.fort = res;
    ctx.root.add(res.object);
    await nz.tex.ready();
    ctx.log(`built by Nizwa's fort.js in ${Math.round(performance.now() - t0)} ms; ${res.anchors.wallLamps.length} wall lamps, ${res.ambientVolumes.length} ambient volumes, ${res.footprints.length} footprints`);
    return res;
  },
  // Nizwa: { pos (the bracket's wall plate), normal | rotY, scale }. Mirage: { pos, rotY (local +Z out of the wall) }
  anchors: (ctx, res) => ({
    lamps: res.anchors.wallLamps.map((a) => ({ pos: a.pos, rotY: a.normal ? Math.atan2(a.normal[0], a.normal[2]) : a.rotY || 0, kind: 'wall', scale: a.scale ?? 1 })),
  }),
  // Nizwa: up to 48 boxes with an RGB tint. Mirage: 8 boxes with one factor: the 8 largest, tint -> its luminance
  ambientVolumes: (ctx, res) => [...res.ambientVolumes].sort((a, b) => size(b) - size(a)).slice(0, 8)
    .map((v) => ({ min: v.min, max: v.max, factor: Math.min(1, lum(v.tint || [0.3, 0.3, 0.3])), soft: v.soft ?? 0.6 })),
};

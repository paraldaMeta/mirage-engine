// fort: Nizwa Fort, built by the Nizwa project's own module (src/world/fort.js and the nine files it imports, read
// in place and unchanged) against a Nizwa context made from this Mirage world (compat/ctx.js). This file is the
// whole adapter between the two module protocols:
//   Nizwa build(ctx) -> { object, footprints, ambientVolumes, anchors: { wallLamps, doors }, site }
//   Mirage module    -> build adds to ctx.root; anchors -> `lamps`; ambientVolumes -> [{ min, max, factor, soft, tint }]
import { build } from '@nizwa/world/fort.js';

// Nizwa's ramp runs from `soft` inside the box to `soft` outside it (1 - smoothstep(-soft, soft, signed distance));
// Mirage's from the box's surface to `soft` outside. The same ramp on every face: the box shrunk by soft, ramp 2 soft
// (an axis thinner than 2 soft shrinks to its middle).
const volume = (v) => {
  const soft = v.soft ?? 0.5, min = [], max = [];
  for (let i = 0; i < 3; i++) { const s = Math.min(soft, (v.max[i] - v.min[i]) / 2); min.push(v.min[i] + s); max.push(v.max[i] - s); }
  return { min, max, factor: 1, tint: v.tint || [0.3, 0.3, 0.3], soft: 2 * soft };
};

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
  // Nizwa: up to 48 boxes, each with an RGB tint (the whole value inside). Mirage: every box, factor 1 x the tint
  ambientVolumes: (ctx, res) => res.ambientVolumes.map(volume),
};

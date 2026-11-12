// Gait numbers per clip on the rig: the robots' code-made clips (the cyber kit's robotClips, what the game played
// before) against the borrowed ones (motion-clips.js), each played at the game's speeds by rate.
//   node examples/demos/experiments/walk/measure.mjs        -> prints a table, writes out/gait.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRigModel } from '../../../../packages/play/src/rig-model.js';
import { robotClips, CLIP_SPEED } from '../../../../packages/assets/src/kits/cyber/robot-rig.js';
import { motionClips } from '../../../../packages/assets/src/kits/cyber/motion-clips.js';
import { gaitMetrics } from './gait-metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rig = createRigModel();
const base = Object.fromEntries(robotClips().map((c) => [c.name, c])), got = Object.fromEntries(motionClips().clips.map((c) => [c.name, c]));
const speedOf = (c) => { const t = c.tracks.find((x) => x.name === 'Root.position'); return t ? (t.values[t.values.length - 1] - t.values[2]) / c.duration : 0; };
// a clip played `rate` times faster: the same keys on a shorter time line (the travel scales with it)
const atRate = (c, rate) => { const k = c.clone(); k.duration = c.duration / rate; for (const t of k.tracks) t.times = t.times.map((x) => x / rate); return k; };
const at = (c, v) => atRate(c, v / speedOf(c));

const rows = [];
const add = (label, clip) => {
  const m = gaitMetrics(rig.root, clip);
  rows.push({ label, cycle: +clip.duration.toFixed(3), speed: +speedOf(clip).toFixed(2), cadence: +(2 * 60 / clip.duration).toFixed(0), ...m, downs: m.downs.length });
};
// the robots' speeds: a patrol 1.3 m/s, the warden 2.3, the sentinel 3.0
for (const v of [1.3, 2.3]) { add(`before walk at ${v}`, at(base.walk, v)); add(`after walk at ${v}`, at(got.walk, v)); }
add('before run at 3.0', at(base.run, 3)); add('after run (jog) at 3.0', at(got.run, 3)); add(`after run (jog) at its own ${speedOf(got.run).toFixed(2)}`, got.run);
add('after crouchWalk (own speed)', got.crouchWalk); add('after brokenWalk (own speed)', got.brokenWalk);
const idleB = gaitMetrics(rig.root, base.idle, { travel: false }), idleU = gaitMetrics(rig.root, got.idle, { travel: false });
rows.push({ label: 'before idle', ...idleB, downs: 0 }, { label: 'after idle', ...idleU, downs: 0 });
const cols = ['label', 'cycle', 'speed', 'cadence', 'slideMean', 'slideMedian', 'lockedFrac', 'slideP95', 'plantedFrac', 'kneeL', 'kneeR', 'bobCm', 'groundCm'];
console.log(cols.join(' | '));
for (const r of rows) console.log(cols.map((c) => (Array.isArray(r[c]) ? r[c].join('..') : r[c] ?? '')).join(' | '));
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'gait.json'), JSON.stringify(rows, null, 1));
void CLIP_SPEED;

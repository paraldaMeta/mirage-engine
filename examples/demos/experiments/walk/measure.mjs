// Experiment: gait numbers, today's hand-written clips vs the borrowed (retargeted, re-encoded) ones, on the same rig.
//   node examples/demos/experiments/walk/measure.mjs        -> prints a table, writes out/gait.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createRigModel, RIG } from '../../../../packages/play/src/rig-model.js';
import { decodeClips, fromB64 } from './clip-codec.js';
import { gaitMetrics } from './gait-metrics.js';
import data from './ual-clips.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rig = createRigModel(), rest = {};
rig.root.traverse((o) => { if (o.isBone) rest[o.name] = o.position.toArray(); });
const ual = decodeClips({ meta: data.meta, bytes: fromB64(data.b64) }, rest);
const base = Object.fromEntries(rig.clips.map((c) => [c.name, c])), got = Object.fromEntries(ual.map((c) => [c.name, c]));
const speedOf = (c) => { const t = c.tracks.find((x) => x.name === 'Root.position'); return t ? (t.values[t.values.length - 1] - t.values[2]) / c.duration : 0; };
// a clip played `rate` times faster: the same keys on a shorter time line (the travel scales with it)
const atRate = (c, rate) => { const k = c.clone(); k.duration = c.duration / rate; for (const t of k.tracks) t.times = t.times.map((x) => x / rate); return k; };

const rows = [];
const add = (label, clip) => {
  const m = gaitMetrics(rig.root, clip);
  rows.push({ label, cycle: +clip.duration.toFixed(3), speed: +speedOf(clip).toFixed(2), cadence: +(2 * 60 / clip.duration).toFixed(0), ...m, downs: m.downs.length });
};
add('baseline walk', base.walk);
add('borrowed walk (own speed)', got.walk);
add(`borrowed walk at ${RIG.walk} m/s (rate x${(RIG.walk / speedOf(got.walk)).toFixed(2)})`, atRate(got.walk, RIG.walk / speedOf(got.walk)));
// the borrowed walk at the game's speed with its own cycle: what a blend space that does not rescale would give
{ const c = got.walk.clone(); const t = c.tracks.find((x) => x.name === 'Root.position'); t.values = t.values.slice(); t.values[5] = RIG.walk * c.duration; add(`borrowed walk forced to ${RIG.walk} m/s, own cycle`, c); }
add('baseline run', base.run);
add('borrowed run/jog (own speed)', got.run);
add(`borrowed run at ${RIG.run} m/s (rate x${(RIG.run / speedOf(got.run)).toFixed(2)})`, atRate(got.run, RIG.run / speedOf(got.run)));
add('borrowed sprint (own speed)', got.sprint);
add('baseline walkBack', base.walkBack);
add('borrowed crouchWalk', got.crouchWalk);
add('borrowed brokenWalk (zombie)', got.brokenWalk);
const idleB = gaitMetrics(rig.root, base.idle, { travel: false }), idleU = gaitMetrics(rig.root, got.idle, { travel: false });
rows.push({ label: 'baseline idle', ...idleB, downs: 0 }, { label: 'borrowed idle', ...idleU, downs: 0 });
const cols = ['label', 'cycle', 'speed', 'cadence', 'slideMean', 'slideMedian', 'lockedFrac', 'slideP95', 'slidePeak', 'plantedFrac', 'kneeL', 'kneeR', 'bobCm', 'groundCm'];
console.log(cols.join(' | '));
for (const r of rows) console.log(cols.map((c) => (Array.isArray(r[c]) ? r[c].join('..') : r[c] ?? '')).join(' | '));
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'gait.json'), JSON.stringify(rows, null, 1));
void THREE;

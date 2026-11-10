#!/usr/bin/env node
// Save the procedural splat hill (hill.js) in the three formats the splat kit reads:
//   node examples/demos/splats/make-fixtures.mjs [--n 300000] [--seed 1] [--out examples/demos/splats/out/fixtures]
// -> hill.splat, hill.ply, hill-sog/meta.json + 5 webp. Deterministic (same n and seed, same bytes). out/ is not
// committed: the files are made by this script (the browser check runs it).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeHill } from './hill.js';
import { writeSplat, writePly, writeSog } from './formats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: o } = parseArgs({ options: { n: { type: 'string', default: '300000' }, seed: { type: 'string', default: '1' }, out: { type: 'string', default: path.join(here, 'out/fixtures') } } });
const t0 = Date.now(), D = makeHill({ count: +o.n, seed: +o.seed });
fs.mkdirSync(path.join(o.out, 'hill-sog'), { recursive: true });
const sizes = {};
const save = (f, bytes) => { fs.writeFileSync(path.join(o.out, f), bytes); sizes[f] = bytes.length; };
save('hill.splat', writeSplat(D));
save('hill.ply', writePly(D));
const sog = writeSog(D);
save('hill-sog/meta.json', JSON.stringify(sog.meta));
for (const [f, b] of Object.entries(sog.files)) save('hill-sog/' + f, b);
const mb = (b) => (b / 1e6).toFixed(2) + ' MB';
const sogBytes = Object.entries(sizes).filter(([f]) => f.startsWith('hill-sog/')).reduce((s, [, b]) => s + b, 0);
console.log(`splat fixtures: ${D.count} splats (seed ${o.seed}) in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${o.out}\n` +
  `  hill.splat ${mb(sizes['hill.splat'])}, hill.ply ${mb(sizes['hill.ply'])}, hill-sog ${mb(sogBytes)} (${sog.width}x${sog.height} webp x5)`);

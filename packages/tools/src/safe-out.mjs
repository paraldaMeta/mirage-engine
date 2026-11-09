// Mirage original code. A tool may empty its output folder only when that folder is clearly its own: never the
// current folder, the project, the home folder, a filesystem root or any folder that contains one of them, and an
// existing non-empty folder only if it carries the tool's marker file from an earlier run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** throws (with the reason) unless `out` may be deleted and recreated; `keep` = folders that must survive */
export function checkOut(out, { keep = [], marker, fsx = fs, home = os.homedir(), cwd = process.cwd() } = {}) {
  const o = path.resolve(out);
  if (o === path.parse(o).root) throw new Error(`refusing to empty ${o}: a filesystem root`);
  for (const k of [cwd, home, ...keep].map((p) => path.resolve(p))) {
    if (inside(k, o)) throw new Error(`refusing to empty ${o}: it is or contains ${k}`);
  }
  if (fsx.existsSync(o)) {
    if (!fsx.statSync(o).isDirectory()) throw new Error(`refusing to replace ${o}: it is a file`);
    const files = fsx.readdirSync(o);
    if (files.length && !(marker && files.includes(marker))) {
      throw new Error(`refusing to empty ${o}: it is not empty and has no ${marker || 'marker'} from an earlier run (delete it yourself or pick another --out)`);
    }
  }
  return o;
}

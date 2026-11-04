// Proctor tool. Materialize only the files a participant may see, from one immutable Git object.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASE = 'db0759af34b3908a427dc976f20192e0c11ab3a3';
const control = fileURLToPath(new URL('../../../', import.meta.url));
export function prepare(destination) {
  const root = path.resolve(destination);
  const relative = path.relative(control, root);
  if (!(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
    throw new Error('Choose a new workspace outside the controller checkout');
  }
  mkdirSync(root); // refuse an existing directory, including a previous attempt
  const tar = path.join(root, 'base.tar');
  execFileSync('git', ['-C', control, 'archive', '--format=tar', '--output', tar, BASE,
    'agent', 'packages', 'docs/world-protocol.md', 'LICENSE', 'NOTICE', 'package.json', 'package-lock.json']);
  try { execFileSync('tar', ['-xf', tar, '-C', root]); } finally { unlinkSync(tar); }
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key.startsWith('examples/') || (entry.link && entry.resolved.startsWith('examples/'))) delete lock.packages[key];
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  mkdirSync(path.join(root, 'examples'));
  cpSync(new URL('PARTICIPANT.md', import.meta.url), path.join(root, 'TASK.md'));
  return root;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('Usage: node prepare.mjs <new-workspace>');
  console.log(prepare(process.argv[2]), BASE);
}

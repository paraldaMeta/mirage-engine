#!/usr/bin/env node
// Mirage original code. The visual editor's dev server.
//
// usage: mirage-editor <project dir> [--write] [--port 5190] [--layer plan.edits.json] [--open]
//
//   <project dir>   a Mirage project Vite can serve (index.html at its root), e.g. examples/hello-courtyard
//   --write         let Save write the edit layer into the project (<dir>/plan.edits.json). Without it the editor
//                   is read-only towards the disk: saves are kept in memory until the server stops.
//   --layer         another file name for the layer; it must be a .json inside the project directory
//   --port          default 5190; 0 picks a free one
//   --open          open the page in the default browser
//
// The server listens on 127.0.0.1 only and there is no flag to change that: it can write a file, so it is not
// something to put on a network. docs/editor.md has the whole list of what it accepts.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { startEditor } from '../src/server.mjs';

const argv = process.argv.slice(2), flags = {}, rest = [];
const BOOL = new Set(['write', 'open', 'help', 'h']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { rest.push(a); continue; }
  const k = a.slice(2);
  flags[k] = BOOL.has(k) ? true : argv[++i];
}
const die = (msg) => { console.error('mirage-editor: ' + msg); process.exit(1); };
if (flags.help || flags.h || !rest.length) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(rest.length || flags.help || flags.h ? 0 : 1);
}
for (const k of Object.keys(flags)) if (!['write', 'open', 'port', 'layer', 'help', 'h'].includes(k)) die('unknown flag --' + k);
const port = flags.port === undefined ? 5190 : Number(flags.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) die('--port must be 0..65535');

try {
  const ed = await startEditor({ root: rest[0], port, write: !!flags.write, layerFile: flags.layer || 'plan.edits.json' });
  if (flags.open) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [ed.url], { stdio: 'ignore', detached: true }).unref();
  const stop = () => ed.close().finally(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (e) {
  die(e.code === 'EADDRINUSE' ? `port ${port} is in use (try --port 0)` : String(e.message || e));
}

// Mirage original code. The hand-written declarations against the JavaScript they describe: `npm run test:dts`
// (part of `npm test`; typescript and @types/three are devDependencies, nothing is installed at test time).
//   1. tsc --noEmit over every packages/*/src/**/*.d.ts and the consumer fixtures in docs/types (tsconfig.json):
//      strict, skipLibCheck off, so a declaration that does not compile or contradicts a fixture fails.
//   2. For every entry of every export map: import the module in Node and compare the names it really exports with
//      the VALUE names its .d.ts declares. A function exported but not declared is invisible to TypeScript users; a
//      name declared but not exported type-checks and then is undefined at run time. Types and interfaces have no
//      run-time side and are not compared. What this does not see: wrong parameter or return types (only the
//      fixtures exercise those), and members of returned objects.
// `npm run test:types` (packages/tools/src/typecheck.mjs) stays the stronger, slower check: it packs the tarballs
// and installs them into an empty consumer from the network, which is why it runs on a test machine only.
//   usage: node scripts/check-types.mjs [--no-tsc] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), bad = [], notes = [];

/** the value names a declaration file exports (functions, consts, classes, enums, namespaces; not types) */
export function declaredValues(program, file) {
  const checker = program.getTypeChecker(), sf = program.getSourceFile(file);
  const mod = sf && checker.getSymbolAtLocation(sf);
  if (!mod) return null;   // not a module (no import / export)
  const out = new Set();
  for (const s of checker.getExportsOfModule(mod)) {
    // `export type { X }` re-exports a class as a type only: no run-time side
    if ((s.declarations || []).some((d) => ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly))) continue;
    const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
    // an alias TypeScript could not resolve counts as a value: tsc reports the broken import itself
    if (target.flags & ts.SymbolFlags.Value || checker.isUnknownSymbol(target)) out.add(s.name);
  }
  return out;
}

// ---- 1. the compiler
const cfgPath = path.join(ROOT, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ROOT);
const entries = [];   // { pkg, sub, js, dts }
for (const d of fs.readdirSync(path.join(ROOT, 'packages'))) {
  const f = path.join(ROOT, 'packages', d, 'package.json');
  if (!fs.existsSync(f)) continue;
  const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [sub, target] of Object.entries(pkg.exports || {})) {
    const js = typeof target === 'string' ? target : target.default;
    if (!js || !js.endsWith('.js')) continue;
    const dts = typeof target === 'object' && target.types ? target.types : null;
    entries.push({ pkg: pkg.name, sub, js: path.join(ROOT, 'packages', d, js), dts: dts && path.join(ROOT, 'packages', d, dts) });
  }
}
const program = ts.createProgram({ rootNames: [...new Set([...cfg.fileNames, ...entries.map((e) => e.dts).filter(Boolean)])], options: cfg.options });
let diagnostics = 0;
if (!argv.includes('--no-tsc')) {
  const diags = ts.getPreEmitDiagnostics(program);
  diagnostics = diags.length;
  for (const d of diags) {
    const at = d.file ? `${path.relative(ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : 'tsconfig';
    bad.push(`tsc ${at}  TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 300)}`);
  }
}

// ---- 2. runtime exports against declared values
// modules Node cannot import, with the reason (keep this list short and explained)
const BUNDLER_ONLY = { '@mirage/core/assets-decoders': "imports the decoders' .wasm with Vite's ?url" };
let compared = 0, names = 0;
const untyped = [];
for (const e of entries) {
  const id = e.pkg + (e.sub === '.' ? '' : e.sub.slice(1));
  if (!e.dts) { untyped.push(id); continue; }
  if (BUNDLER_ONLY[id]) { notes.push(`${id}: not compared (${BUNDLER_ONLY[id]})`); continue; }
  let mod;
  try { mod = await import(pathToFileURL(e.js)); }
  catch (err) { bad.push(`${id}: cannot be imported in Node (${String(err.message).split('\n')[0]}); a module must not touch the page at import time`); continue; }
  const declared = declaredValues(program, e.dts);
  if (!declared) { bad.push(`${id}: ${path.relative(ROOT, e.dts)} is not a module`); continue; }
  const real = new Set(Object.keys(mod).filter((k) => k !== 'default' || mod.default !== undefined));
  const undeclared = [...real].filter((k) => !declared.has(k)), phantom = [...declared].filter((k) => !real.has(k));
  if (undeclared.length) bad.push(`${id}: exported by the .js, missing from the .d.ts: ${undeclared.join(', ')}`);
  if (phantom.length) bad.push(`${id}: declared as a value in the .d.ts, not exported by the .js: ${phantom.join(', ')}`);
  compared++; names += real.size;
}
if (untyped.length) notes.push(`no declaration (untyped subpaths): ${untyped.join(', ')}`);

const summary = { entries: compared, names, untyped, tscFiles: cfg.fileNames.length, tscDiagnostics: diagnostics, failures: bad.length };
if (argv.includes('--json')) console.log(JSON.stringify({ ...summary, bad }, null, 2));
else {
  for (const n of notes) console.log('  ' + n);
  if (bad.length) console.error(`types check: FAIL (${bad.length})\n  ` + bad.join('\n  '));
  else console.log(`types check: ok (${compared} modules, ${names} runtime exports all declared, no phantom values; tsc clean over ${cfg.fileNames.length} files, typescript ${ts.version})`);
}
process.exit(bad.length ? 1 : 0);

// Mirage original code. Every `@miragekit/<pkg>/<subpath>` written anywhere in the repository (source, examples, docs,
// the agent skill, READMEs) must be a subpath that package's export map lists: `node scripts/check-imports.mjs`
// (part of `npm test`). The export maps are explicit allow-lists (no "./*"), so a file under src/ that is not listed
// is internal; an import of it works inside this workspace only by accident of a bundler alias and breaks for
// whoever installs the package. Also fails when
//   - an export map still carries a wildcard, or lists a target that does not exist,
//   - a package's src/ reaches into another package's src/ with a relative path (it must go through the name),
//   - a typed module (src/x.js with src/x.d.ts) is listed without its `types` condition.
// @miragekit/tools has no export map (it is a set of commands): there a subpath must simply be an existing file.
//   usage: node scripts/check-imports.mjs            exit 1 with every offending file:line
//          import { scan, exported } from './check-imports.mjs'   (the checks call these with fixtures)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(js|mjs|cjs|ts|mts|html|md|json)$/;
const SPEC = /@miragekit\/(core|world|play|game|net|editor|tools|assets)\/([A-Za-z0-9_.\-/]*[A-Za-z0-9_])/g;

/** { name: { exports, dir } } for every package under packages/ */
export function readPackages(root = ROOT) {
  const out = {};
  for (const d of fs.readdirSync(path.join(root, 'packages'))) {
    const f = path.join(root, 'packages', d, 'package.json');
    if (!fs.existsSync(f)) continue;
    const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
    out[pkg.name.replace('@miragekit/', '')] = { exports: pkg.exports || null, dir: path.join(root, 'packages', d), name: pkg.name };
  }
  return out;
}
/** is `sub` ('assets', 'kits/water', 'src/chrome.mjs') importable from the package? */
export function exported(pkg, sub) {
  if (!pkg) return false;
  if (!pkg.exports) return fs.existsSync(path.join(pkg.dir, sub));   // no map: any shipped file
  // 'kits' in prose ("@miragekit/world/kits/*") names a folder of exported subpaths
  return Object.prototype.hasOwnProperty.call(pkg.exports, './' + sub) || Object.keys(pkg.exports).some((k) => k.startsWith('./' + sub + '/'));
}
/** problems in one file's text: [{ line, text }] */
export function scan(text, file, pkgs) {
  const bad = [], lines = text.split('\n');
  const own = /^packages\/([^/]+)\/src\//.exec(file.replaceAll(path.sep, '/'));
  lines.forEach((l, i) => {
    for (const m of l.matchAll(SPEC)) {
      const sub = m[2].replace(/\.$/, '');
      if (!exported(pkgs[m[1]], sub)) bad.push({ line: i + 1, text: `@miragekit/${m[1]}/${sub} is not in the export map of @miragekit/${m[1]}` });
    }
    if (own) for (const m of l.matchAll(/(?:from|import)\s*\(?\s*['"]((?:\.\.\/)+)([a-z]+)\/src\//g)) {
      if (m[1] === '../../' && m[2] !== own[1] && pkgs[m[2]]) bad.push({ line: i + 1, text: `relative import into packages/${m[2]}/src: import '@miragekit/${m[2]}' instead` });
    }
  });
  return bad;
}
/** problems in the export maps themselves */
export function checkMaps(pkgs) {
  const bad = [];
  for (const p of Object.values(pkgs)) {
    for (const [sub, target] of Object.entries(p.exports || {})) {
      if (sub.includes('*')) { bad.push(`${p.name}: export "${sub}" is a wildcard; list the subpaths`); continue; }
      const js = typeof target === 'string' ? target : target.default, types = typeof target === 'object' ? target.types : null;
      for (const t of [js, types]) if (t && !fs.existsSync(path.join(p.dir, t))) bad.push(`${p.name}: export "${sub}" -> ${t} does not exist`);
      const dts = js && js.endsWith('.js') ? js.slice(0, -3) + '.d.ts' : null;
      if (dts && !types && fs.existsSync(path.join(p.dir, dts))) bad.push(`${p.name}: export "${sub}" has ${dts} but no "types" condition`);
    }
  }
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkgs = readPackages();
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => TEXT.test(f) && !f.endsWith('package-lock.json') && f !== 'scripts/check-imports.mjs' && !f.startsWith('scripts/checks/') && fs.existsSync(path.join(ROOT, f)));
  const bad = checkMaps(pkgs);
  let seen = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!text.includes('@miragekit/') && !text.includes('/src/')) continue;
    seen++;
    for (const b of scan(text, f, pkgs)) bad.push(`${f}:${b.line}  ${b.text}`);
  }
  if (bad.length) { console.error(`import check: FAIL (${bad.length})\n  ` + bad.join('\n  ')); process.exit(1); }
  const n = Object.values(pkgs).reduce((s, p) => s + (p.exports ? Object.keys(p.exports).length : 0), 0);
  console.log(`import check: ok (${seen} files, ${n} export-map entries, no wildcard)`);
}

// What each package would ship to npm, checked without publishing anything: `npm run test:pack`.
// - `npm pack --dry-run` contents: package.json, README.md, LICENSE and every file the export map points at
// - metadata an npm page needs: licence, repository (with its directory), homepage, bugs
// - one version for the root and every package; the packages' peer ranges on each other accept that version
// - three: the version the examples build with is inside every package's peer range
// - every export map target (and its types) ships; the root entry declares its types
//   (the export maps are explicit allow-lists; scripts/check-imports.mjs checks every import against them)
// - every name a package's index exports is described in docs/api.md
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = ['core', 'world', 'play', 'game', 'tools', 'net'];
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const root = read('package.json');
const three = read('node_modules/three/package.json').version;
const api = fs.readFileSync(path.join(ROOT, 'docs/api.md'), 'utf8');
const bad = [];

// a small semver range test: enough for the forms used here (x.y.z, ^x.y.z, >=a <b)
const num = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function satisfies(v, range) {
  return range.split(/\s+/).every((part) => {
    const m = /^(\^|>=|<=|>|<)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!m) throw new Error(`range "${range}" not understood`);
    const [, op = '=', r] = m, c = cmp(v, r);
    if (op === '^') { const [M, m2] = num(r); const [vM, vm] = num(v); return c >= 0 && (M ? vM === M : vM === 0 && vm === m2); }
    return { '=': c === 0, '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0 }[op];
  });
}

for (const name of PKGS) {
  const dir = path.join(ROOT, 'packages', name), pkg = read(`packages/${name}/package.json`), at = `${pkg.name}:`;
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const files = new Set(packed.files.map((f) => f.path));
  for (const f of ['package.json', 'README.md', 'LICENSE']) if (!files.has(f)) bad.push(`${at} the tarball has no ${f}`);
  if (pkg.license !== 'MIT') bad.push(`${at} licence is ${pkg.license}`);
  if (pkg.repository?.directory !== `packages/${name}` || !pkg.repository?.url) bad.push(`${at} repository { url, directory: "packages/${name}" } missing`);
  if (!pkg.homepage) bad.push(`${at} homepage missing`);
  if (!pkg.bugs?.url) bad.push(`${at} bugs.url missing`);
  if (pkg.version !== root.version) bad.push(`${at} version ${pkg.version}, the root is ${root.version}`);
  for (const [dep, range] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (dep === 'three' && !satisfies(three, range)) bad.push(`${at} three ${three} (installed) is outside its range "${range}"`);
    if (dep.startsWith('@mirage/') && !satisfies(root.version, range)) bad.push(`${at} ${dep} "${range}" does not accept ${root.version}`);
  }
  const entry = (t) => (typeof t === 'string' ? t : t?.default);
  for (const [sub, target] of Object.entries(pkg.exports || {})) {
    if (sub.includes('*')) continue;
    for (const t of [entry(target), typeof target === 'object' ? target.types : null].filter(Boolean)) {
      if (!files.has(path.normalize(t).replace(/^\.\//, ''))) bad.push(`${at} export "${sub}" -> ${t} is not in the tarball`);
    }
  }
  if (pkg.exports?.['.'] && !(pkg.types && files.has(path.normalize(pkg.types)) && pkg.exports['.'].types)) bad.push(`${at} the root entry declares no shipped types`);
  for (const [bin, target] of Object.entries(pkg.bin || {})) if (!files.has(path.normalize(target))) bad.push(`${at} bin ${bin} -> ${target} is not in the tarball`);
  if (pkg.exports?.['.']) {
    const mod = await import(pathToFileURL(path.join(dir, entry(pkg.exports['.']))));
    const missing = Object.keys(mod).filter((k) => !new RegExp('`' + k + '[`(.\\s]').test(api));
    if (missing.length) bad.push(`${at} exports not described in docs/api.md: ${missing.join(', ')}`);
  }
  console.log(`  ${pkg.name}@${pkg.version}: ${files.size} files, ${(packed.size / 1024).toFixed(1)} kB packed`);
}
if (bad.length) { console.error('package check: FAIL\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`package check: ok (${PKGS.length} packages, three ${three})`);

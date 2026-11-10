// Mirage original code. What the Node checks execute of packages/*/src, from V8's own coverage (NODE_V8_COVERAGE,
// built into node: no dependency). The browser checks are not in it, so shader strings and WebGL paths read low.
//
//   node scripts/coverage.mjs                 run `npm test` under coverage, print the table, write out/coverage/summary.json
//   node scripts/coverage.mjs --from <dir>    aggregate raw V8 files already written (no run)
//   node scripts/coverage.mjs --files         also list every file
//
// How a file is counted. V8 reports ranges of source with a count; the innermost range wins. A character counts as
// run when any process ran it. A line counts when it has code (not blank, not only a comment) and at least one of
// its non-space characters ran; a function counts when its count is above zero in some process. A source file no
// process loaded counts as all zero, its functions unknown (reported as 0 of 0). Lines here are long (several
// statements each), so "characters" is the stricter number and the one to quote.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** run flags (Uint8Array, one per UTF-16 unit) of one script in one process, from its V8 function list. */
export function ranFlags(functions, length) {
  const ran = new Uint8Array(length).fill(1);   // code outside every function range is module top level: it ran
  const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) ran.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, length));   // outer first, inner overwrite
  return ran;
}

/** { lines, linesRun, chars, charsRun } for a source text and its merged run flags (null: never loaded). */
export function measure(src, ran) {
  let lines = 0, linesRun = 0, chars = 0, charsRun = 0, at = 0, block = false;
  for (const line of src.split('\n')) {
    const t = line.trim(); let code = t.length > 0;
    if (block) { code = false; if (t.includes('*/')) block = false; }
    else if (t.startsWith('//')) code = false;
    else if (t.startsWith('/*')) { code = false; block = !t.includes('*/'); }
    if (code) {
      let n = 0, r = 0;
      for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) > 32) { n++; if (ran && ran[at + i]) r++; }
      lines++; chars += n; charsRun += r; if (r) linesRun++;
    }
    at += line.length + 1;
  }
  return { lines, linesRun, chars, charsRun };
}

export function aggregate(dir, files) {
  const flags = new Map(), fns = new Map();   // file -> merged flags; file -> Map(function key -> ran)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let data; try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const s of data.result || []) {
      if (!s.url.startsWith('file://')) continue;
      let file; try { file = fs.realpathSync(fileURLToPath(s.url)); } catch { continue; }
      if (!files.has(file)) continue;
      const len = files.get(file).length, ran = ranFlags(s.functions, len), have = flags.get(file);
      if (have) { for (let i = 0; i < len; i++) have[i] |= ran[i]; } else flags.set(file, ran);
      const m = fns.get(file) || fns.set(file, new Map()).get(file);
      for (const fn of s.functions) { if (!fn.ranges.length || (fn.functionName === '' && fn.ranges[0].startOffset === 0)) continue; const k = fn.ranges[0].startOffset + ':' + fn.ranges[0].endOffset; m.set(k, m.get(k) || fn.ranges[0].count > 0); }
    }
  }
  const rows = [];
  for (const [file, src] of files) {
    const m = fns.get(file), fv = m ? [...m.values()] : [];
    rows.push({ file: path.relative(ROOT, file), loaded: flags.has(file), ...measure(src, flags.get(file) || null), functions: fv.length, functionsRun: fv.filter(Boolean).length });
  }
  return rows;
}

const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
export const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0');
export function summarize(rows) {
  const by = (set, name) => ({ name, files: set.length, loaded: set.filter((r) => r.loaded).length, lines: sum(set, 'lines'), linesRun: sum(set, 'linesRun'), chars: sum(set, 'chars'), charsRun: sum(set, 'charsRun'), functions: sum(set, 'functions'), functionsRun: sum(set, 'functionsRun') });
  const pk = [...new Set(rows.map((r) => r.file.split(path.sep)[1]))].sort();
  return [...pk.map((p) => by(rows.filter((r) => r.file.split(path.sep)[1] === p), '@mirage/' + p)), by(rows, 'all')];
}

function sources() {
  const files = new Map();
  for (const p of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const src = path.join(ROOT, 'packages', p, 'src'); if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src, { recursive: true })) if (/\.m?js$/.test(f)) { const full = fs.realpathSync(path.join(src, f)); files.set(full, fs.readFileSync(full, 'utf8')); }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const out = path.join(ROOT, 'out/coverage'); let dir = arg('--from'), status = 0;
  if (!dir) {
    dir = path.join(out, 'v8'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const run = spawnSync('npm', ['test'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NODE_V8_COVERAGE: dir } });
    status = run.status ?? 1;
    if (status) console.error(`npm test exited ${status}: the numbers below are from a failing run`);
  }
  const rows = aggregate(dir, sources()), s = summarize(rows);
  console.log('| package | files (loaded) | characters run | lines run | functions run (in loaded files) |\n|---|---|---|---|---|');
  for (const r of s) console.log(`| ${r.name === 'all' ? '**all**' : '`' + r.name + '`'} | ${r.files} (${r.loaded}) | ${pct(r.charsRun, r.chars)} % | ${pct(r.linesRun, r.lines)} % of ${r.lines} | ${pct(r.functionsRun, r.functions)} % of ${r.functions} |`);
  if (process.argv.includes('--files')) for (const r of rows.sort((a, b) => a.charsRun / (a.chars || 1) - b.charsRun / (b.chars || 1))) console.log(`${pct(r.charsRun, r.chars).padStart(5)} %  ${r.loaded ? ' ' : 'x'} ${r.file}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ node: process.version, summary: s, files: rows }, null, 1));
  process.exit(status);
}

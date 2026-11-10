#!/usr/bin/env node
// Mirage original code. docs/README.md is the index of the documentation: this fails when a docs/*.md file is not
// linked from it (a guide nobody can find), when the index links a file that does not exist, and when a relative
// link in any tracked Markdown file of the repository points at nothing.   node scripts/check-docs.mjs
// (part of `npm test`).  import { links, missingFromIndex } from './check-docs.mjs' for the checks.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** relative link targets of a Markdown text: [{ href, line }] (no http:, mailto:, #anchor-only; code spans skipped) */
export function links(md) {
  const out = [];
  let fence = false;
  md.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    for (const m of l.replace(/`[^`]*`/g, '').matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) continue;
      out.push({ href: href.split('#')[0].split('?')[0], line: i + 1 });
    }
  });
  return out.filter((x) => x.href);
}
/** the docs/*.md names (not README.md itself) the index text does not link */
export function missingFromIndex(indexText, names) {
  const linked = new Set(links(indexText).map((l) => path.posix.normalize(l.href)));
  return names.filter((n) => n !== 'README.md' && !linked.has(n));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = [];
  const docs = path.join(ROOT, 'docs'), index = path.join(docs, 'README.md');
  const guides = fs.readdirSync(docs).filter((f) => f.endsWith('.md')).sort();
  if (!fs.existsSync(index)) bad.push('docs/README.md does not exist');
  else for (const n of missingFromIndex(fs.readFileSync(index, 'utf8'), guides)) bad.push(`docs/${n} is not linked from docs/README.md`);
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && fs.existsSync(path.join(ROOT, f)));
  let n = 0;
  for (const f of files) {
    for (const l of links(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
      n++;
      let target; try { target = path.resolve(ROOT, path.dirname(f), decodeURIComponent(l.href)); } catch { target = null; }
      if (!target || !fs.existsSync(target)) bad.push(`${f}:${l.line} links ${l.href}, which does not exist`);
    }
  }
  if (bad.length) { console.error(`docs check: FAIL (${bad.length})\n  ` + bad.join('\n  ')); process.exit(1); }
  console.log(`docs check: ok (${guides.length - 1} guides in docs/, all linked from docs/README.md; ${n} relative links in ${files.length} Markdown files resolve)`);
}

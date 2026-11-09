#!/usr/bin/env node
// Mirage original code. Builds the demo site that GitHub Pages serves (.github/workflows/pages.yml): every example
// as its single-file build (mirage-deploy) in its own folder, and an index page that links them. Uploads nothing.
//
// usage: node scripts/build-site.mjs [--out deploy/site]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkOut } from '../packages/tools/src/safe-out.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const EXAMPLES = ['hello-courtyard', 'walled-garden', 'garden-quest', 'agent-trial', 'snow-hut', 'woodland-path', 'river-ford'];
const BUDGET = 5_000_000; // the single-file budget the e2e run checks

let out;
try { out = checkOut(values.out ?? path.join(repo, 'deploy', 'site'), { keep: [repo], marker: '.nojekyll' }); }
catch (e) { console.error('[site] ' + e.message); process.exit(2); }
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rows = [];
for (const name of EXAMPLES) {
  const dir = path.join(repo, 'examples', name);
  execFileSync(process.execPath, [path.join(repo, 'packages/tools/src/deploy.mjs'), dir, '--out', path.join(out, name)], { stdio: 'inherit' });
  const size = fs.statSync(path.join(out, name, 'index.html')).size;
  if (size > BUDGET) { console.error(`[site] ${name}: ${size} bytes is over the ${BUDGET} byte single-file budget`); process.exit(1); }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const description = (pkg.description || '').replace(/^Mirage (minimal )?example( built by agents from the skill pack)?:\s*/i, '').replace(/^./, (c) => c.toUpperCase());
  rows.push({ name, description, size });
}

const version = JSON.parse(fs.readFileSync(path.join(repo, 'packages/core/package.json'), 'utf8')).version;
const sha = process.env.GITHUB_SHA?.slice(0, 7) || execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mirage ${esc(version)} · examples</title>
<style>
  :root { color-scheme: light dark; --fg: #1d1d1f; --mute: #6e6e73; --line: #d9d9de; --bg: #fbfbfa; --link: #0b5cad; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececec; --mute: #a0a0a6; --line: #333338; --bg: #141416; --link: #7db7ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 56px 24px 72px; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  p.lead { margin: 0 0 32px; color: var(--mute); }
  ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  li { padding: 16px 0; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto; gap: 2px 16px; }
  a { color: var(--link); text-decoration: none; font-weight: 600; } a:hover { text-decoration: underline; }
  .d { grid-column: 1; color: var(--mute); font-size: 15px; }
  .s { grid-column: 2; grid-row: 1; color: var(--mute); font-size: 13px; font-variant-numeric: tabular-nums; }
  footer { margin-top: 32px; color: var(--mute); font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>Mirage ${esc(version)}</h1>
  <p class="lead">A code-only world engine for three.js. Each example is one self-contained HTML file. Walk with WASD, drag to look; desktop Chrome with a GPU works best.</p>
  <ul>
${rows.map((r) => `    <li><a href="${esc(r.name)}/">${esc(r.name)}</a><span class="s">${(r.size / 1e6).toFixed(2)} MB</span><span class="d">${esc(r.description)}</span></li>`).join('\n')}
  </ul>
  <footer>Built from <a href="https://github.com/paraldaMeta/mirage-engine/commit/${esc(sha)}">${esc(sha)}</a> · <a href="https://github.com/paraldaMeta/mirage-engine">source</a></footer>
</main>
</body>
</html>
`);
console.log(`\n[site] ${out}: ${rows.length} examples + index.html`);

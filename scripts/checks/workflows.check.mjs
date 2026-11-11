// Mirage original code. The GitHub workflows keep two promises a reviewer cannot see at a glance: every action is
// pinned to a full commit SHA (a tag can be moved), and the token is read-only.   node scripts/checks/workflows.check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from '../soft-assert.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
/** problems of one workflow text: unpinned actions, a missing or writable permissions block. */
// The one write scope allowed anywhere: release.yml's publish job signs npm provenance with an OIDC token.
export function workflowProblems(text, { idToken = false } = {}) {
  const bad = [];
  for (const [i, line] of text.split('\n').entries()) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
    if (m && !m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) bad.push(`line ${i + 1}: ${m[1]} is not pinned to a commit SHA`);
  }
  const top = /^permissions:\s*(.*)\n((?:[ \t]+.*\n?)*)/m.exec(text);
  if (!top) bad.push('no top-level permissions block (the default token can write)');
  else if (/write/.test(top[1] + top[2])) bad.push('top-level permissions grant write');
  for (const m of text.matchAll(/^\s+[\w-]+:\s*write\s*$/gm)) if (!(idToken && m[0].trim() === 'id-token: write')) bad.push(`a job asks for ${m[0].trim()}`);
  return [...new Set(bad)];
}

assert.deepEqual(workflowProblems('permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v5\n'), ['line 6: actions/checkout@v5 is not pinned to a commit SHA']);
assert.equal(workflowProblems('jobs:\n  a:\n    steps:\n      - uses: ./local\n').length, 1, 'a workflow without permissions is reported');
assert.ok(workflowProblems('permissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      id-token: write\n').some((p) => /id-token: write/.test(p)));
assert.deepEqual(workflowProblems(`permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)} # v6\n`), []);
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
assert.ok(files.length >= 1, 'there are workflows');
assert.deepEqual(workflowProblems('permissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      id-token: write\n', { idToken: true }), []);
assert.ok(workflowProblems('permissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      contents: write\n', { idToken: true }).length, 'only id-token is allowed');
for (const f of files) assert.deepEqual(workflowProblems(fs.readFileSync(path.join(dir, f), 'utf8'), { idToken: f === 'release.yml' }), [], f);
console.log(`workflows check: ${assert.failures.length ? 'FAILED' : 'ok'} (${files.length} workflows, ${assert.count} assertions)`);

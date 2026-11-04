import { readFileSync, statSync, writeFileSync } from 'node:fs';

// Collect the HTTP and file:// reports produced by test:e2e for a procedural example.
export function writeExampleMetrics(base, plan) {
  const here = name => new URL(name, base);
  const file = 'release/' + plan.name + '.html';
  const bytes = statSync(here(file)).size, byteLimit = plan.budget.singleFileMB * 1_000_000;
  const targets = [];
  for (const [dir, protocol] of [['out/playtest', 'http:'], ['out/playtest-file', 'file:']]) {
    const report = JSON.parse(readFileSync(here(dir + '/report.json'), 'utf8'));
    const url = new URL(report.url), quality = url.searchParams.get('quality');
    const step = report.steps.find(s => s.step === 'medium-frame-cost');
    const { frameMs, p95Ms, calls, triangles } = step?.metrics ?? {};
    const measured = [frameMs, p95Ms, calls, triangles].every(n => Number.isFinite(n) && n > 0);
    const sheet = dir + '/sheet.png';
    const pass = report.pass && report.build?.failed?.length === 0 && url.protocol === protocol &&
      quality === 'medium' && measured && statSync(here(sheet)).size > 0;
    targets.push({ url: report.url, quality, gpu: report.gpu, frameMs, p95Ms, calls, triangles, sheet, pass });
  }
  const summary = { file, bytes, byteLimit, targets, pass: bytes <= byteLimit && targets.every(t => t.pass) };
  const json = JSON.stringify(summary, null, 2);
  writeFileSync(here('out/acceptance.json'), json + '\n');
  console.log(json);
  if (!summary.pass) process.exitCode = 1;
}

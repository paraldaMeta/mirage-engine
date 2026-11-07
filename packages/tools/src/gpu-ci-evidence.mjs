// Collect only this attempt's evidence. No browser, dependency installation or test execution.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function collectEvidence(root) {
  const upload = path.join(root, 'upload');
  fs.mkdirSync(upload);
  const files = [], omitted = [], errors = [];
  function copy(relative) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) return;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) { omitted.push(relative); return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) {
        if (name === 'node_modules' || name === '.git' || name.startsWith('.chrome-profile')) continue;
        copy(path.join(relative, name));
      }
      return;
    }
    if (!stat.isFile()) { omitted.push(relative); return; }
    const target = path.join(upload, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    files.push({ path: relative.split(path.sep).join('/'), bytes: stat.size,
      sha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
  }
  for (const name of ['ci.json', 'ci.log', 'bootstrap.log', 'machine.json', 'acceptance/summary.json', 'acceptance/gpu.json',
    'acceptance/source.tar', 'acceptance/REVIEW.md', 'acceptance/logs', 'acceptance/types', 'acceptance/workspace/out']) copy(name);
  const examples = path.join(root, 'acceptance/workspace/examples');
  if (fs.existsSync(examples)) {
    for (const entry of fs.readdirSync(examples, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const dir of ['out', 'release']) copy('acceptance/workspace/examples/' + entry.name + '/' + dir);
    }
  }
  function read(relative) {
    const file = path.join(upload, relative);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { errors.push(relative + ': ' + error.message); return null; }
  }
  const ci = read('ci.json'), acceptance = read('acceptance/summary.json');
  const measured = { commit: ci?.commit, machine: read('machine.json'), scenes: [], characters: [], singleFiles: [] };
  for (const file of files) {
    if (/\/out\/playtest(?:-file)?\/report\.json$/.test(file.path)) {
      const report = read(file.path);
      if (!report) continue;
      measured.scenes.push({ source: file.path, url: report.url, gpu: report.gpu, pass: report.pass,
        measurements: (report.steps || []).filter(step => step.metrics).map(step => ({ step: step.step, metrics: step.metrics })) });
    }
    if (/\/out\/character-(?:http|file)\/report\.json$/.test(file.path)) {
      const report = read(file.path);
      if (report) measured.characters.push({ source: file.path, url: report.url, quality: report.quality,
        gpu: report.model?.gpu, timing: report.timing });
    }
    if (/\/release\/[^/]+\.html$/.test(file.path)) measured.singleFiles.push(file);
  }
  const machinePassed = ci?.status === 'completed' && ci.code === 0 &&
    acceptance?.status === 'machine-pass-pending-review' && acceptance.commit === ci.commit;
  if (machinePassed) {
    for (const required of ['acceptance/source.tar', 'acceptance/gpu.json', 'acceptance/types/summary.json', 'acceptance/REVIEW.md']) {
      if (!files.some(file => file.path === required && file.bytes > 0)) errors.push('Missing evidence: ' + required);
    }
    if (read('acceptance/gpu.json')?.status !== 'passed') errors.push('Hardware GPU preflight did not pass');
    if (read('acceptance/types/summary.json')?.status !== 'passed') errors.push('Type consumer did not pass');
    if (!acceptance.examples?.length || measured.scenes.length !== acceptance.examples.length * 2) errors.push('Missing HTTP or file scene metrics');
    if (measured.characters.length !== 2) errors.push('Missing character metric reports');
    if (!files.some(file => file.path.endsWith('.png') && file.bytes > 0)) errors.push('Missing screenshots');
  }
  const index = { schemaVersion: 1, commit: ci?.commit, ci, status: machinePassed ? 'machine-pass-pending-review' : ci?.status || 'not-started',
    acceptanceStatus: acceptance?.status || 'not-started', releaseReady: false, errors, omitted, files,
    screenshots: files.filter(file => /\.(png|webp|jpg)$/i.test(file.path)).map(file => file.path) };
  if (!machinePassed && index.status === 'completed') index.status = 'incomplete';
  if (errors.length) index.status = 'collection-failed';
  fs.writeFileSync(path.join(upload, 'PERFORMANCE.json'), JSON.stringify(measured, null, 2) + '\n');
  fs.writeFileSync(path.join(upload, 'EVIDENCE.json'), JSON.stringify(index, null, 2) + '\n');
  // Escape values from the report before displaying them in GitHub Markdown.
  const text = value => String(value ?? 'unavailable').replace(/[\r\n<>`|]/g, ' ');
  const markdown = [
    'Mirage GPU acceptance — ' + text(index.status), '',
    'Commit ' + text(ci?.commit), '',
    'Runner ' + text(ci?.runner) + ' · acceptance ' + text(index.acceptanceStatus), '',
    files.length + ' evidence files · ' + index.screenshots.length + ' screenshots · ' + measured.scenes.length + ' scene metric reports', '',
    'EVIDENCE.json lists paths and SHA-256 values. PERFORMANCE.json gathers the measured frame costs, draw calls and single-file sizes.', '',
    'Acceptance logs are under acceptance/logs. Raw scene reports and screenshots are under acceptance/workspace/examples.', '',
    'Stages that were never reached have no measurements. Visual and device review remain pending.', '',
  ].join('\n');
  fs.writeFileSync(path.join(upload, 'README.md'), markdown);
  return { upload, index, markdown };
}

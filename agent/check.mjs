// Mirage original code. Validates the skill pack (Agent Skills format): every agent/<folder>/SKILL.md has YAML
// frontmatter with `name` = the folder (lower-case words joined by '-', <= 64 chars) and a `description`
// (<= 1024 chars), and every references/ or assets/ path a skill mentions exists; and that the skills have not drifted
// from the tools (every MG code, tool flag and scenario field they mention exists). Run: node agent/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bad = [];
const dirs = fs.readdirSync(here).filter((d) => fs.existsSync(path.join(here, d, 'SKILL.md')));
for (const d of dirs) {
  const text = fs.readFileSync(path.join(here, d, 'SKILL.md'), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { bad.push(`${d}: no frontmatter`); continue; }
  const fm = {};
  let key = null;
  for (const line of m[1].split('\n')) {   // ponytail: flat key: value YAML (and folded >/| blocks), all a SKILL.md needs
    const kv = line.match(/^([a-z][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; fm[key] = /^[>|]-?$/.test(kv[2]) ? '' : kv[2].replace(/^["']|["']$/g, ''); }
    else if (key && /^\s+\S/.test(line)) fm[key] += (fm[key] ? ' ' : '') + line.trim();
  }
  if (fm.name !== d) bad.push(`${d}: name "${fm.name}" must equal the folder name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name || '') || fm.name.length > 64) bad.push(`${d}: name must be lower-case words joined by '-', <= 64 chars`);
  if (!fm.description) bad.push(`${d}: description missing`);
  else if (fm.description.length > 1024) bad.push(`${d}: description is ${fm.description.length} chars (max 1024)`);
  for (const [, ref] of text.matchAll(/`?((?:references|assets)\/[\w./-]+)`?/g)) {
    if (!fs.existsSync(path.join(here, d, ref.replace(/[.,)]+$/, '')))) bad.push(`${d}: mentions ${ref}, which does not exist`);
  }
  console.log(`  ok ${d} (description ${fm.description ? fm.description.length : 0} chars, body ${text.split('\n').length} lines)`);
}
if (!dirs.length) bad.push('no skills found');
// the scaffold a new world is copied from must ask for the @mirage versions this repository has: npm resolves a
// workspace dependency locally only when the version matches, otherwise it asks the registry (404 before publishing)
const version = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')).version;
const skel = JSON.parse(fs.readFileSync(path.join(here, 'mirage-brief-to-plan/assets/skeleton/package.json'), 'utf8'));
for (const [dep, want] of Object.entries(skel.dependencies || {})) {
  if (dep.startsWith('@mirage/') && want !== version) bad.push(`skeleton package.json: ${dep} "${want}", the packages are ${version}`);
}
// ---- drift: what the skills teach must exist in the tools. Every MG code in CODES (and so in docs/diagnostics.md);
// every --flag on a line that runs a tool (<name>.mjs or a mirage-<bin>) in that tool's source; every scenario field,
// step field and expectation value in the playtest vocabulary (packages/tools/src/scenario-fields.mjs)
const tools = path.join(here, '../packages/tools');
const { CODES } = await import(path.join(tools, 'src/diagnostics.mjs'));
const F = await import(path.join(tools, 'src/scenario-fields.mjs'));
const bins = JSON.parse(fs.readFileSync(path.join(tools, 'package.json'), 'utf8')).bin;
const toolSource = (name) => {
  const f = name.startsWith('mirage-') ? bins[name] && path.join(tools, bins[name]) : [path.join(tools, 'src', name), path.join(tools, name)].find((p) => fs.existsSync(p));
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};
const docs = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(md|json)$/.test(f.name) && !p.includes('node_modules')) docs.push(p); } };
walk(here);
let drift = { codes: 0, flags: 0, fields: 0 };
const allowedKeys = new Set([...F.SCENARIO_FIELDS, ...F.STEP_FIELDS, ...F.NESTED_FIELDS]);
const checkScenario = (sc, where) => { for (const u of F.unknownFields(sc)) bad.push(`${where}: scenario field ${u} is not one playtest reads`); drift.fields++; };
for (const file of docs) {
  const rel = path.relative(here, file), text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) { if (/scenarios\//.test(rel)) checkScenario(JSON.parse(text), rel); continue; }
  for (const [code] of text.matchAll(/\bMG\d{3}\b/g)) { drift.codes++; if (!CODES[code]) bad.push(`${rel}: mentions ${code}, which is not a diagnostic code`); }
  for (const line of text.split('\n')) {
    const m = line.match(/\b(mirage-[a-z-]+|[a-z][\w-]*\.mjs)\b(.*)$/);
    if (!m || m[1] === 'check.mjs') continue;
    const src = toolSource(m[1]);
    for (const [, flag] of m[2].matchAll(/(?:^|[\s\[`(])--([a-z][\w-]*)/g)) {
      if (!src) continue;   // a tool outside packages/tools (an example's script): not checked here
      drift.flags++;
      if (!new RegExp(`['"\`]${flag}['"\`]|--${flag}\\b`).test(src)) bad.push(`${rel}: ${m[1]} --${flag}, which ${m[1]} does not read`);
    }
  }
  for (const [, block] of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    if (!/"steps"/.test(block)) continue;
    let sc; try { sc = JSON.parse(block); } catch (e) { bad.push(`${rel}: a scenario example is not valid JSON (${e.message})`); continue; }
    checkScenario(sc, rel);
  }
  // fields named in prose: `"field": ...` (a key whose value is an expectation, "rail": ">= 0.005", names a see
  // object or a value, not a field: skipped)
  for (const [, frag] of text.matchAll(/`([^`]*"\w+":[^`]*)`/g)) for (const [, k] of frag.matchAll(/"(\w+)":(?!\s*"(?:<|>|~|==|!=|has))/g)) {
    drift.fields++;
    if (!allowedKeys.has(k) && !F.EXPECT_VALUES.includes(k)) bad.push(`${rel}: \`"${k}":\` is not a scenario, step or expectation field`);
  }
}
console.log(`skill drift: ${drift.codes} code mentions, ${drift.flags} tool flags, ${drift.fields} scenario fields checked`);
if (bad.length) { console.error('skill check failed:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`skill check: ${dirs.length} skills ok`);

// Mirage original code. Validates the skill pack (Agent Skills format): every agent/<folder>/SKILL.md has YAML
// frontmatter with `name` = the folder (lower-case words joined by '-', <= 64 chars) and a `description`
// (<= 1024 chars), and every references/ or assets/ path a skill mentions exists. Run: node agent/check.mjs
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
if (bad.length) { console.error('skill check failed:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`skill check: ${dirs.length} skills ok`);

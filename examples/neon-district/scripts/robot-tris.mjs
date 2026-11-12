#!/usr/bin/env node
// Triangles of the robot kit's bodies per level of detail (NOTES.md "Frame budget"): node scripts/robot-tris.mjs
import { humanoid, quadruped } from '@miragekit/world/kits/cyber';

const t = (l) => l.reduce((s, p) => s + p.g.attributes.position.count / 3, 0);
for (const [style, kit] of [['sentinel', {}], ['sentinel', { shield: true }], ['sentinel', { mast: true }], ['warden', {}], ['home', {}]]) {
  const row = [0, 1, 2].map((lod) => {
    const P = humanoid(style, lod, kit), by = {};
    let all = 0;
    for (const [b, l] of Object.entries(P)) { const n = t(l), k = b.replace(/^(Left|Right)/, ''); all += n; by[k] = (by[k] || 0) + n; }
    return { all, by };
  });
  console.log(`${style}${Object.keys(kit).length ? ' ' + Object.keys(kit).join('+') : ''}: ${row.map((r) => r.all).join(' / ')}   near by bone: ${Object.entries(row[0].by).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
for (const s of ['scout', 'hauler', 'courier']) console.log(`${s}: ${[0, 1, 2].map((lod) => { const Q = quadruped(s, lod); return t(Q.body) + 4 * (t(Q.upper) + t(Q.lower)); }).join(' / ')}`);

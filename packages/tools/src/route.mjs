// Mirage original code. The route map of a playtest `walkTo` step: the walk grid from above around the route, the
// planned route (dashed, numbered waypoints), the path the walker took (solid), where it got stuck (a red cross),
// and an onion skin of the game entities that moved during the walk (a dot per sample, fading from old to new).
// Written as NN-<step>-route.png; a failed walk is read from it at a glance (the wall it ran into, the turn it cut).
//   const png = await page.evaluate(routeMapInPage, { name, plan: [[x, z], ...], path: [[x, y, z], ...], stuck?: [x, z], ents?: { id: [[x, z], ...] } })

/** Runs in the page (window.__mirage.play.grid): returns the map as a PNG data URL. */
export function routeMapInPage(o) {
  const { play } = window.__mirage, grid = play.grid;
  const pts = [...o.plan, ...o.path.map((p) => [p[0], p[2]]), ...(o.stuck ? [o.stuck] : [])];
  const feet = o.path.length ? o.path[0][1] : 0;
  const m = 3, gx0 = grid.x0, gz0 = grid.z0, gx1 = grid.x0 + grid.nx * grid.cell, gz1 = grid.z0 + grid.nz * grid.cell;
  let x0 = Math.min(...pts.map((p) => p[0])) - m, x1 = Math.max(...pts.map((p) => p[0])) + m;
  let z0 = Math.min(...pts.map((p) => p[1])) - m, z1 = Math.max(...pts.map((p) => p[1])) + m;
  x0 = Math.max(x0, gx0); z0 = Math.max(z0, gz0); x1 = Math.min(x1, gx1); z1 = Math.min(z1, gz1);
  const s = Math.max(4, Math.min(40, 860 / Math.max(x1 - x0, z1 - z0, 1)));   // px per metre
  const top = 30, W = Math.ceil((x1 - x0) * s), H = Math.ceil((z1 - z0) * s);
  const c = document.createElement('canvas'); c.width = Math.max(W, 420); c.height = H + top + 40;
  const g = c.getContext('2d');
  g.fillStyle = '#16130f'; g.fillRect(0, 0, c.width, c.height);
  const X = (x) => (x - x0) * s, Z = (z) => top + (z - z0) * s;
  // the grid: walkable floors near the walker's height light (darker = lower), solids above the feet brown, no floor black
  const step = Math.max(grid.cell, 1 / s);
  for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
    const L = grid.layers(x + step / 2, z + step / 2);
    let col = '#0b0a09';
    if (L.length) {
      const f = L.find(([fl, ce]) => fl >= feet - 2 && fl <= feet + 0.45 && ce - fl >= 1.7);
      if (f) { const k = Math.max(0, Math.min(1, 0.75 + (f[0] - feet) * 0.25)); col = `rgb(${Math.round(120 + 90 * k)},${Math.round(115 + 85 * k)},${Math.round(100 + 75 * k)})`; }
      else col = '#6b3b2a';
    }
    g.fillStyle = col; g.fillRect(X(x), Z(z), Math.ceil(step * s) + 0.5, Math.ceil(step * s) + 0.5);
  }
  // onion skin: entities that moved
  for (const [id, trail] of Object.entries(o.ents || {})) {
    trail.forEach(([x, z], i) => { g.fillStyle = `rgba(120,200,255,${0.15 + 0.85 * (i + 1) / trail.length})`; g.beginPath(); g.arc(X(x), Z(z), 3, 0, 7); g.fill(); });
    const [lx, lz] = trail.at(-1); g.fillStyle = '#9ad4ff'; g.font = '11px system-ui, sans-serif'; g.fillText(id, X(lx) + 5, Z(lz) - 4);
  }
  // planned route
  g.setLineDash([6, 5]); g.strokeStyle = '#7fb2ff'; g.lineWidth = 2; g.beginPath();
  o.plan.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); g.setLineDash([]);
  o.plan.forEach(([x, z], i) => { if (!i) return; g.fillStyle = '#7fb2ff'; g.beginPath(); g.arc(X(x), Z(z), 5, 0, 7); g.fill(); g.fillStyle = '#0b0a09'; g.font = '600 10px system-ui, sans-serif'; g.fillText(String(i), X(x) - 3, Z(z) + 3.5); });
  // the path taken
  if (o.path.length) {
    g.strokeStyle = '#ffb04a'; g.lineWidth = 2.5; g.beginPath();
    o.path.forEach(([x, , z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke();
    g.fillStyle = '#7be07b'; g.beginPath(); g.arc(X(o.path[0][0]), Z(o.path[0][2]), 5, 0, 7); g.fill();
  }
  if (o.stuck) {
    const [sx, sz] = o.stuck; g.strokeStyle = '#ff4a3a'; g.lineWidth = 3; g.beginPath();
    g.moveTo(X(sx) - 7, Z(sz) - 7); g.lineTo(X(sx) + 7, Z(sz) + 7); g.moveTo(X(sx) + 7, Z(sz) - 7); g.lineTo(X(sx) - 7, Z(sz) + 7); g.stroke();
    g.fillStyle = '#ff7a6a'; g.font = '600 12px system-ui, sans-serif'; g.fillText(`stuck ${sx.toFixed(2)}, ${sz.toFixed(2)}`, X(sx) + 10, Z(sz) - 8);
  }
  // title, legend, scale bar (1 and 5 m), north = -z up
  g.fillStyle = '#f0e2c4'; g.font = '600 13px system-ui, sans-serif';
  g.fillText(`${o.name}  ·  x ${x0.toFixed(1)}..${x1.toFixed(1)}, z ${z0.toFixed(1)}..${z1.toFixed(1)} (−z up)`, 6, 19);
  g.font = '11px system-ui, sans-serif'; const ly = top + H + 17;
  const leg = [['#7fb2ff', 'planned'], ['#ffb04a', 'walked'], ['#ff4a3a', 'stuck'], ['#9ad4ff', 'moving entities'], ['#6b3b2a', 'solid'], ['#0b0a09', 'no floor']];
  let lx = 6; for (const [col, t] of leg) { g.fillStyle = col; g.fillRect(lx, ly - 9, 10, 10); g.fillStyle = '#f0e2c4'; g.fillText(t, lx + 13, ly); lx += 22 + g.measureText(t).width; }
  // the scale bar under the legend's row, right-aligned (a narrow map has no room beside the legend)
  const bar = s >= 30 ? 1 : 5; g.fillStyle = '#f0e2c4'; g.fillRect(c.width - 10 - bar * s, ly + 8, bar * s, 3); g.fillText(`${bar} m`, c.width - 34 - bar * s, ly + 13);
  return c.toDataURL('image/png');
}

// Mirage original code.
// ---------------------------------------------------------------------------
// Moving solids cut out of the navigation: every solid of a createSolids space (doors, crates, barrels: the same
// description the walker and Rapier collide with) becomes a nav.block obstacle that follows it. The re-bake is
// navgrid's incremental one: fit bits and coarse pieces in the cells round the old and the new footprint only.
//
//   const carve = carveSolids(nav, space, { tolerance: 0.06 });
//   each step (after physics-link's post()):  carve.update();     // re-blocks what moved more than the tolerance
//   carve.stats -> { ms, moved, total }       carve.dispose()
//   space.add({ ..., data: { carve: false } })                    // a lift or a raft: walked on, never carved
//
// An upright box is carved as a turned box (obb), an upright cylinder and a sphere as a cylinder, a tumbling box by
// its bounding box. Agents re-plan because nav.version moves (createNavAgent and createCrowd watch it).
// ponytail: a carved solid is a hole, not a floor: agents do not ride lifts or walk over a fallen crate; give a
// lift { carve: false } and link its two landings with nav.link if agents must use it.
// ---------------------------------------------------------------------------

export function carveSolids(nav, space, { tolerance = nav.base.cell / 2, turn = 0.05, pad = 0, max = Infinity, filter } = {}) {
  const held = new Map(), dirty = new Set();
  const wanted = (s) => s.data?.carve !== false && (!filter || filter(s));
  const shapeOf = (s) => {
    const q = s.quat, upright = Math.abs(q[0]) < 0.02 && Math.abs(q[2]) < 0.02, y0 = s.aabb[1], y1 = s.aabb[4];
    if (s.box && upright) return { obb: [s.pos[0], s.pos[2], s.box[0] + pad, s.box[2] + pad, s.yaw, y0, y1] };
    if (s.cylinder && upright) return { cylinder: [s.pos[0], s.pos[2], s.cylinder[0] + pad, y0, y1] };
    if (s.sphere) return { cylinder: [s.pos[0], s.pos[2], s.sphere + pad, y0, y1] };
    return { box: [s.aabb[0] - pad, y0, s.aabb[2] - pad, s.aabb[3] + pad, y1, s.aabb[5] + pad] };
  };
  function put(s) {
    const h = held.get(s.id);
    if (h) nav.unblock(h.id);
    held.set(s.id, { id: nav.block(shapeOf(s)), x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw, qx: s.quat[0], qz: s.quat[2] });
  }
  const carve = {
    stats: { ms: 0, moved: 0, total: 0 },
    /** re-block the solids that moved more than the tolerance since they were last carved; returns how many */
    update() {
      const t = performance.now();
      let n = 0;
      for (const s of dirty) {
        if (n >= max) break;
        dirty.delete(s);
        const h = held.get(s.id);
        if (!h) continue;
        if (Math.hypot(s.pos[0] - h.x, s.pos[1] - h.y, s.pos[2] - h.z) < tolerance && (!s.box || Math.abs(s.yaw - h.yaw) < turn) && Math.abs(s.quat[0] - h.qx) + Math.abs(s.quat[2] - h.qz) < turn) continue;
        put(s); n++;
      }
      carve.stats.ms = +(performance.now() - t).toFixed(3); carve.stats.moved = n; carve.stats.total = held.size;
      return n;
    },
    dispose() { off(); for (const h of held.values()) nav.unblock(h.id); held.clear(); dirty.clear(); },
  };
  for (const s of space.solids.values()) if (wanted(s)) put(s);
  const off = space.onChange((s, what) => {
    if (what === 'remove') { const h = held.get(s.id); if (h) { nav.unblock(h.id); held.delete(s.id); } dirty.delete(s); }
    else if (!wanted(s)) return;
    else if (what === 'add') put(s);
    else dirty.add(s);
  });
  return carve;
}

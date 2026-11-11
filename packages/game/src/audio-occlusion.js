// Mirage original code. What stands between a sound and the listener, for the audio engine's occlusion: three ways
// to ask, all with the same answer shape, test(from, to) -> 0 (clear) .. 1 (shut). The engine calls it for a few
// voices per update (engine.occlusion({ test, budget })), so each call may cost a ray.
// ---------------------------------------------------------------------------
// engine.occlusion({ test: gridOccluder(play.grid) })            the walk grid: no physics, no scene raycast
// engine.occlusion({ test: physicsOccluder(physics) })           Rapier ray against the colliders
// engine.occlusion({ test: sceneOccluder(scene, { raycaster }) })   three.js raycast (slow on big scenes: keep the budget low)
// ponytail: the walk grid only knows where one can stand, so a cell without a floor (a wall, but also a pond or the
// far side of a ledge) counts as solid, and a window in a wall is shut; physics and scene rays return shut or clear
// for the first hit (thickness is not measured), so the engine's side rays do the grading.
// ---------------------------------------------------------------------------
const MAXL = 4;   // floors per cell of the walk grid (@miragekit/play/walkgrid MAXL; not imported: that module pulls three in)

/** March the segment through the walk grid. A point is in the open when its cell has a floor at or below it (skin
 *  metres of slack) with the ceiling above it. The answer is the blocked length over `thickness` metres, capped at 1:
 *  a thin screen muffles less than a thick wall. Cells outside the grid are open. */
export function gridOccluder(grid, { thickness = 0.6, skin = 0.35, step = grid.cell } = {}) {
  const { floors, count } = grid;
  const open = (x, y, z) => {
    const k = grid.idx(x, z);
    if (k < 0) return true;
    for (let l = 0; l < count[k]; l++) if (y >= floors[(k * MAXL + l) * 2] - skin && y <= floors[(k * MAXL + l) * 2 + 1] + skin) return true;
    return false;
  };
  return (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len < step) return 0;
    const n = Math.ceil(len / step), d = len / n;
    let solid = 0;
    // the two ends are where the sound and the ears are: a source on a wall or a camera pushed into one is not "inside"
    for (let i = 1; i < n; i++) { const t = i / n; if (!open(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t)) solid += d; }
    return Math.min(solid / thickness, 1);
  };
}

/** A Rapier ray (createPhysics().ray) from the sound to the ears: 1 when something is hit before the listener.
 *  near: metres at both ends that are ignored (the source's own collider, the player's capsule). */
export function physicsOccluder(physics, { near = 0.3, exclude } = {}) {
  const from = [0, 0, 0], dir = [0, 0, 0];
  return (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len <= near * 2) return 0;
    dir[0] = dx / len; dir[1] = dy / len; dir[2] = dz / len;
    from[0] = a[0] + dir[0] * near; from[1] = a[1] + dir[1] * near; from[2] = a[2] + dir[2] * near;
    return physics.ray(from, dir, len - near * 2, exclude) ? 1 : 0;
  };
}

/** A three.js raycast against `root` (give it the few big occluders, not the whole scene). raycaster: a
 *  THREE.Raycaster the caller owns, so this module needs no three import; filter(object) -> false skips a hit. */
export function sceneOccluder(root, { raycaster, near = 0.3, filter } = {}) {
  if (!raycaster) throw new Error('sceneOccluder: pass { raycaster: new THREE.Raycaster() }');
  const hits = [];
  return (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len <= near * 2) return 0;
    raycaster.ray.origin.set(a[0], a[1], a[2]); raycaster.ray.direction.set(dx / len, dy / len, dz / len);
    raycaster.near = near; raycaster.far = len - near;
    hits.length = 0;
    raycaster.intersectObject(root, true, hits);
    for (const h of hits) if (!filter || filter(h.object) !== false) return 1;
    return 0;
  };
}

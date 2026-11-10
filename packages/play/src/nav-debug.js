// Mirage original code.
// ---------------------------------------------------------------------------
// See what the navigation thinks: the walkable cells (by area, carved cells in red), off-mesh links, paths, the
// crowd's velocities and wishes, and a behaviour tree as text. One group of unlit lines and quads; nothing here is
// needed to run the navigation, and nothing is drawn until a method is called.
//
//   const debug = createNavDebug(nav, { radius: 0.28 });  scene.add(debug.group);
//   debug.grid();                         // again after nav.version changes (debug.gridVersion tells)
//   debug.links();
//   debug.paths([path, ...]);             // findPath results
//   debug.crowd(crowd);                   // each frame: velocity (white), wish (yellow), a ring per agent
//   debug.tree(brain, element?)           // -> brain.describe(); written to a <pre> when one is given
//   debug.dispose();
//
// ponytail: the grid view is one quad per fitting node, rebuilt whole (160 x 160: about 20k quads; pass `region`
// [x0, z0, x1, z1] on big grids); the lines draw over everything (no depth test) so they read through walls.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const AREA = [[0.25, 0.8, 0.45], [0.95, 0.75, 0.2], [0.3, 0.6, 0.95], [0.85, 0.4, 0.9], [0.4, 0.85, 0.85], [0.95, 0.55, 0.35]];

export function createNavDebug(nav, { radius, lift = 0.04 } = {}) {
  const group = new THREE.Group();
  group.name = 'nav-debug';
  const cell = nav.base.cell, made = {};
  const lines = (name, color) => {
    if (made[name]) return made[name];
    const g = new THREE.BufferGeometry(), m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false });
    const o = new THREE.LineSegments(g, m);
    o.name = name; o.renderOrder = 999; o.frustumCulled = false; o.userData.collide = false;
    group.add(o);
    return (made[name] = o);
  };
  /** fill a LineSegments from flat [x, y, z, ...] and [r, g, b, ...] (two vertices a segment), reusing its buffers */
  function fill(o, pos, col) {
    const g = o.geometry, old = g.getAttribute('position');
    if (!old || old.array.length < pos.length) {
      const n = Math.max(pos.length, (old?.array.length || 0) * 2);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage));
    }
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    p.array.set(pos); c.array.set(col); p.needsUpdate = c.needsUpdate = true;
    g.setDrawRange(0, pos.length / 3);
  }
  const seg = (pos, col, a, b, c) => { pos.push(a[0], a[1] + lift, a[2], b[0], b[1] + lift, b[2]); col.push(c[0], c[1], c[2], c[0], c[1], c[2]); };
  const debug = {
    group, gridVersion: -1,
    /** the cells a body of `radius` fits, coloured by area; carved cells red; { region: [x0, z0, x1, z1] } to bound it */
    grid({ region } = {}) {
      const pos = [], col = [], h = cell * 0.46;
      nav.eachNode((x, y, z, v, fits, area, blocked) => {
        if ((!fits && !blocked) || (region && (x < region[0] || z < region[1] || x > region[2] || z > region[3]))) return;
        const c = blocked ? [0.9, 0.2, 0.2] : AREA[area % AREA.length], yy = y + lift * 0.5;
        pos.push(x - h, yy, z - h, x - h, yy, z + h, x + h, yy, z + h, x - h, yy, z - h, x + h, yy, z + h, x + h, yy, z - h);
        for (let q = 0; q < 6; q++) col.push(c[0], c[1], c[2]);
      }, { radius });
      if (made.grid) { made.grid.geometry.dispose(); group.remove(made.grid); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      o.name = 'grid'; o.renderOrder = 998; o.userData.collide = false;
      group.add(o); made.grid = o;
      debug.gridVersion = nav.version;
      return pos.length / 18;
    },
    /** off-mesh links as arcs (two-way: cyan, one-way: orange, with a tick at the far end) */
    links() {
      const pos = [], col = [];
      for (const l of nav.links()) {
        const c = l.bidirectional ? [0.3, 0.9, 1] : [1, 0.6, 0.2], up = Math.max(0.3, 0.2 * Math.hypot(l.to[0] - l.from[0], l.to[2] - l.from[2]));
        let a = l.from;
        for (let s = 1; s <= 8; s++) { const t = s / 8, b = [l.from[0] + (l.to[0] - l.from[0]) * t, l.from[1] + (l.to[1] - l.from[1]) * t + Math.sin(Math.PI * t) * up, l.from[2] + (l.to[2] - l.from[2]) * t]; seg(pos, col, a, b, c); a = b; }
        seg(pos, col, l.to, [l.to[0], l.to[1] + 0.4, l.to[2]], c);
      }
      fill(lines('links'), pos, col);
      return nav.links().length;
    },
    /** paths as polylines (a link crossing dashed in the link colour) */
    paths(list, color = [1, 1, 1]) {
      const pos = [], col = [];
      for (const p of list) if (p) for (let q = 1; q < p.length; q++) seg(pos, col, p[q - 1], p[q], p[q].link ? [0.3, 0.9, 1] : color);
      fill(lines('paths'), pos, col);
    },
    /** per agent: a ring of its radius, its velocity (white) and its wish, the next waypoint (yellow) */
    crowd(crowd) {
      const pos = [], col = [], W = [1, 1, 1], Y = [1, 0.9, 0.2], G = [0.5, 0.9, 0.5], R = [1, 0.4, 0.3];
      for (let i = 0; i < crowd.max; i++) {
        const s = crowd.state[i];
        if (!s) continue;
        const p = [crowd.x[i], crowd.y[i], crowd.z[i]], r = crowd.radius[i], c = s === 6 ? R : G;
        for (let q = 0; q < 8; q++) { const a0 = (q / 8) * Math.PI * 2, a1 = ((q + 1) / 8) * Math.PI * 2; seg(pos, col, [p[0] + Math.cos(a0) * r, p[1], p[2] + Math.sin(a0) * r], [p[0] + Math.cos(a1) * r, p[1], p[2] + Math.sin(a1) * r], c); }
        seg(pos, col, p, [p[0] + crowd.vx[i] * 0.5, p[1], p[2] + crowd.vz[i] * 0.5], W);
        const path = crowd.pathOf(i);
        if (path && path[crowd.waypoint(i)]) seg(pos, col, p, path[crowd.waypoint(i)], Y);
      }
      fill(lines('crowd'), pos, col);
    },
    /** a behaviour tree's state as text; also put into `element` (a <pre>) when given */
    tree(brain, element) { const t = `${brain.describe()}\n[${[...brain.blackboard.data.keys()].join(', ')}]`; if (element) element.textContent = t; return t; },
    clear(name) { if (made[name]) made[name].geometry.setDrawRange(0, 0); },
    dispose() { for (const o of Object.values(made)) { o.geometry.dispose(); o.material.dispose(); } group.removeFromParent(); group.clear(); },
  };
  return debug;
}

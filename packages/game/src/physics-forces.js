// Mirage original code. Forces on physics-kit bodies: water that floats them, explosions, and kinematic platforms
// that carry what stands on them (the character included).
// ---------------------------------------------------------------------------
// const forces = createForces(kit);
//   forces.water({ min: [x, y, z], max: [x, y, z] }, { density: 1000, drag: 1.5, angularDrag: 1.5, flow: [0.5, 0, 0] })
//       a box of water: bodies in it are lifted by the weight of the water they displace (eight sample points per
//       collider, so a box rights itself), slowed, and carried by the flow. -> { remove(), inside: awake bodies in it }
//   forces.explosion([x, y, z], { radius: 6, impulse: 400, falloff: 'linear' | 'square' | 'none', upward: 0.5,
//                                 occlude: true })   -> [{ body, impulse, distance }]; walls shield when occlude
//   forces.platform(obj, { path: [[x, y, z], ...], speed: 2, mode: 'pingpong' | 'loop', spin: 0.5, half })
//       a kinematic body moved along a path; dynamic bodies on it are carried by friction -> { body, pos, remove() }
//   forces.carry(character)       the phys.character() rides platforms too (Rapier's controller does not by itself)
// All of it runs inside phys.step, before Rapier's own step, and is part of phys.snapshot().
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function createForces(kit) {
  const { phys, R } = kit, ext = phys.ext;
  const waters = [], platforms = [], carried = [];
  const api = { waters, platforms };

  // ---- water
  /** half extents of a collider's shape in its own frame (what the sample points are spread over) */
  function halfOf(col) {
    const s = col.shape, T = R.ShapeType;
    switch (s.type) {
      case T.Ball: return [s.radius, s.radius, s.radius];
      case T.Cuboid: return [s.halfExtents.x, s.halfExtents.y, s.halfExtents.z];
      case T.Capsule: return [s.radius, s.halfHeight + s.radius, s.radius];
      case T.Cylinder: case T.Cone: return [s.radius, s.halfHeight, s.radius];
      default: {
        const v = s.vertices; if (!v) return [0.25, 0.25, 0.25];
        const h = [0, 0, 0]; for (let i = 0; i < v.length; i++) h[i % 3] = Math.max(h[i % 3], Math.abs(v[i]));
        return h;
      }
    }
  }
  const SIGNS = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]];
  const cache = new Map();   // collider handle -> { half, volume }
  const shapeInfo = (col) => { let c = cache.get(col.handle); if (!c) cache.set(col.handle, c = { half: halfOf(col), volume: col.volume() }); return c; };

  api.water = (box, { density = 1000, drag = 1.5, angularDrag = 1.5, flow = null } = {}) => {
    const w = { min: box.min.slice(), max: box.max.slice(), density, drag, angularDrag, flow, inside: 0, get level() { return w.max[1]; },
      remove() { const i = waters.indexOf(w); if (i >= 0) waters.splice(i, 1); } };
    waters.push(w);
    return w;
  };
  function float(w, dt) {
    const g = -phys.world.gravity.y, top = w.max[1];
    w.inside = 0;
    phys.world.forEachRigidBody((rb) => {
      if (!rb.isDynamic() || rb.isSleeping()) return;   // at rest in the water: nothing to add (and waking it would keep it awake for good)
      const t = rb.translation();
      // a body well clear of the box costs one comparison; 3 m covers any prop's reach from its origin
      if (t.x < w.min[0] - 3 || t.x > w.max[0] + 3 || t.z < w.min[2] - 3 || t.z > w.max[2] + 3 || t.y > top + 3 || t.y < w.min[1] - 3) return;
      let wet = 0, total = 0;
      for (let i = 0; i < rb.numColliders(); i++) {
        const col = rb.collider(i);
        if (col.isSensor()) continue;
        const { half, volume } = shapeInfo(col), c = col.translation(), r = col.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        // how tall one octant stands in the world: the turned half box's reach along y, halved
        _e.set(1, 0, 0).applyQuaternion(_q); let reach = Math.abs(_e.y) * half[0];
        _e.set(0, 1, 0).applyQuaternion(_q); reach += Math.abs(_e.y) * half[1];
        _e.set(0, 0, 1).applyQuaternion(_q); reach += Math.abs(_e.y) * half[2];
        reach = Math.max(reach / 2, 1e-4);
        total += volume;
        for (let k = 0; k < 8; k++) {
          const s = SIGNS[k];
          _v.set(s[0] * half[0] / 2, s[1] * half[1] / 2, s[2] * half[2] / 2).applyQuaternion(_q);
          const x = c.x + _v.x, y = c.y + _v.y, z = c.z + _v.z;
          if (x < w.min[0] || x > w.max[0] || z < w.min[2] || z > w.max[2] || y < w.min[1] - reach) continue;
          const frac = Math.min(1, Math.max(0, 0.5 + (top - y) / (2 * reach)));
          if (frac <= 0) continue;
          const v = volume / 8 * frac;
          wet += v;
          rb.applyImpulseAtPoint({ x: 0, y: w.density * g * v * dt, z: 0 }, { x, y, z }, false);
        }
      }
      if (wet <= 0) return;
      w.inside++;
      // drag grows with how much of the body is under; implicit, so a large drag cannot overshoot
      const part = wet / total, m = rb.mass(), v = rb.linvel(), a = rb.angvel(), k = 1 - 1 / (1 + w.drag * part * dt), ka = 1 / (1 + w.angularDrag * part * dt);
      const fx = w.flow ? w.flow[0] : 0, fy = w.flow ? w.flow[1] : 0, fz = w.flow ? w.flow[2] : 0;
      rb.applyImpulse({ x: -(v.x - fx) * k * m, y: -(v.y - fy) * k * m, z: -(v.z - fz) * k * m }, false);
      rb.setAngvel({ x: a.x * ka, y: a.y * ka, z: a.z * ka }, false);
    });
  }

  // ---- explosions
  api.explosion = (center, { radius = 5, impulse = 300, falloff = 'linear', upward = 0, occlude = false, filter = null } = {}) => {
    const hit = [], w = phys.world;
    w.forEachRigidBody((rb) => {
      if (!rb.isDynamic()) return;
      const body = kit.bodies.get(rb.handle) || null;
      if (filter && !filter(body, rb)) return;
      const c = rb.worldCom(), dx = c.x - center[0], dy = c.y - center[1], dz = c.z - center[2], d = Math.hypot(dx, dy, dz);
      if (d > radius) return;
      if (occlude && d > 1e-3) {
        // a wall between the charge and the body's centre of mass shields it (fixed colliders only)
        const o = w.castRay(new R.Ray(V(center), { x: dx / d, y: dy / d, z: dz / d }), d, true, R.QueryFilterFlags.ONLY_FIXED | R.QueryFilterFlags.EXCLUDE_SENSORS);
        if (o) return;
      }
      const k = d / radius, f = falloff === 'none' ? 1 : falloff === 'square' ? (1 - k) * (1 - k) : 1 - k;
      // `upward` lowers the point the push comes from, so things are thrown up as well as away (Unity's upwardsModifier)
      const ux = dx, uy = dy + upward, uz = dz, ul = Math.hypot(ux, uy, uz) || 1, j = impulse * f;
      rb.applyImpulse({ x: ux / ul * j, y: uy / ul * j, z: uz / ul * j }, true);
      hit.push({ body, rigidBody: rb, impulse: j, distance: d });
    });
    kit.emit('explosion', { center, radius, hit });
    return hit;
  };

  // ---- platforms
  const along = (p, s) => {   // the point at distance s along the polyline
    for (let i = 0; i < p.seg.length; i++) { if (s <= p.seg[i] || i === p.seg.length - 1) { const a = p.path[i], b = p.path[i + 1], k = p.seg[i] > 0 ? Math.min(1, s / p.seg[i]) : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; } s -= p.seg[i]; }
    return p.path[0].slice();
  };
  const poseAt = (p, t) => {
    let pos = p.path[0];
    if (p.total > 0) {
      let u = t * p.speed;
      if (p.mode === 'loop') u %= p.total; else { u %= 2 * p.total; if (u > p.total) u = 2 * p.total - u; }
      pos = along(p, u);
    }
    _q.setFromAxisAngle(_up, p.spin * t).premultiply(p.base);
    return { pos, quat: [_q.x, _q.y, _q.z, _q.w] };
  };
  /** obj: an Object3D (its box becomes the collider), a kit body of type 'kinematic', or null with `half` given */
  api.platform = (obj, { path, speed = 1.5, mode = 'pingpong', spin = 0, half, material = 'default', layer, mask, name = '' } = {}) => {
    const body = obj && obj._b ? obj : kit.rigid(obj, { type: 'kinematic', shape: 'box', half, pos: !obj && path ? path[0] : undefined, material, layer, mask, name });
    const p0 = body.pos, q0 = body.quat;
    const pts = (path && path.length ? path : [p0]).map((p) => p.slice());
    if (mode === 'loop' && pts.length > 1) pts.push(pts[0].slice());
    if (pts.length < 2) pts.push(pts[0].slice());
    const seg = []; let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); seg.push(d); total += d; }
    const p = { body, path: pts, seg, total, speed, mode, spin, base: new THREE.Quaternion(...q0), t: 0, from: null, to: null, paused: false,
      get pos() { return body.pos; },
      remove() { const i = platforms.indexOf(p); if (i >= 0) platforms.splice(i, 1); } };
    platforms.push(p);
    return p;
  };

  // ---- the character on platforms
  /** character: what phys.character() returned. It is moved with the kinematic body under its feet. */
  api.carry = (character) => {
    const c = { character, on: null, yaw: 0, remove() { const i = carried.indexOf(c); if (i >= 0) carried.splice(i, 1); } };
    carried.push(c);
    return c;
  };
  const _a = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function ride(c) {
    const w = c.character, col = w.collider, feet = w.pos;
    c.on = null;
    if (!w.onGround) return;
    const hit = phys.world.castRay(new R.Ray({ x: feet[0], y: feet[1] + 0.15, z: feet[2] }, { x: 0, y: -1, z: 0 }), 0.4, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, col);
    const rb = hit?.collider.parent();
    if (!rb || !rb.isKinematic()) return;
    const p = platforms.find((x) => x.body._b.handle === rb.handle);
    if (!p || !p.from) return;
    // where the point under the feet goes when the platform moves from `from` to `to`
    _qa.set(...p.from.quat).invert(); _qb.set(...p.to.quat);
    _a.set(feet[0] - p.from.pos[0], feet[1] - p.from.pos[1], feet[2] - p.from.pos[2]).applyQuaternion(_qa).applyQuaternion(_qb);
    const nx = p.to.pos[0] + _a.x, ny = p.to.pos[1] + _a.y, nz = p.to.pos[2] + _a.z;
    w.pos[0] = nx; w.pos[1] = ny; w.pos[2] = nz;
    col.parent().setNextKinematicTranslation({ x: nx, y: ny + w.body.head / 2, z: nz });
    c.on = p; c.yaw += p.spin * phys.world.timestep;
  }

  const off = kit.on('step', (dt) => {
    for (const p of platforms) {
      if (p.paused) { p.from = p.to; continue; }
      p.from = p.to || poseAt(p, p.t);
      p.t += dt;
      p.to = poseAt(p, p.t);
      p.body.moveTo(p.to.pos, p.to.quat);
    }
    for (const c of carried) ride(c);
    for (const w of waters) float(w, dt);
  });

  ext.save.forces = () => ({ platforms: platforms.map((p) => [p.t, p.paused]) });
  ext.load.forces = (s) => { s.platforms.forEach(([t, paused], i) => { const p = platforms[i]; if (p) { p.t = t; p.paused = paused; p.from = null; p.to = poseAt(p, t); } }); cache.clear(); };
  api.dispose = () => { off(); delete ext.save.forces; delete ext.load.forces; };
  return api;
}

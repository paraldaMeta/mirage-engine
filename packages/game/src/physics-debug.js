// Mirage original code. Debug draw for the physics kit: collider outlines, joints, contact points and a stats
// line. Nothing is added to the scene until this is created, and dispose() takes it all out again.
// ---------------------------------------------------------------------------
// const dbg = createPhysicsDebug(kit, scene, { colliders: true, joints: true, contacts: true, stats: element });
//   each frame, after kit.advance:   dbg.update();
//   dbg.visible = false              hidden, and update() does no work
//   dbg.show({ contacts: false })    switch layers at run time
//   dbg.text()                       'bodies 412 (awake 37) · colliders 430 · joints 13 · step 0.84 ms (avg 0.91)'
//   dbg.counts                       { lines, joints, contacts } of the last update (for checks)
// Colliders come from Rapier's own debug render (sleeping bodies are drawn darker by it). Joints are drawn from
// each body to the joint's anchor on it: orange alive, red over 80 % of the break force, grey once broken.
// Contacts are a yellow tick along the normal at every solver contact point between awake bodies.
// The lines are drawn over everything (no depth test) and are not ray-cast targets.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

/** a LineSegments whose buffers grow as needed */
function lines(name) {
  const geo = new THREE.BufferGeometry(), mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = 9999; mesh.raycast = () => {}; mesh.userData.collide = false; mesh.matrixAutoUpdate = false;
  let cap = 0, pos = null, col = null, n = 0;
  const need = (verts) => {
    if (verts <= cap) return;
    cap = Math.max(verts, cap * 2, 256);
    const p = new Float32Array(cap * 3), c = new Float32Array(cap * 4);
    if (pos) { p.set(pos.subarray(0, n * 3)); c.set(col.subarray(0, n * 4)); }
    pos = p; col = c;
    geo.dispose();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  };
  return {
    mesh,
    begin() { n = 0; },
    /** a whole block at once (Rapier's buffers) */
    set(p, c) { const v = p.length / 3; need(v); pos.set(p); col.set(c); n = v; },
    seg(a, b, r, g, bl, al = 1) {
      need(n + 2);
      pos[n * 3] = a.x; pos[n * 3 + 1] = a.y; pos[n * 3 + 2] = a.z; pos[n * 3 + 3] = b.x; pos[n * 3 + 4] = b.y; pos[n * 3 + 5] = b.z;
      for (let i = 0; i < 2; i++) { const k = (n + i) * 4; col[k] = r; col[k + 1] = g; col[k + 2] = bl; col[k + 3] = al; }
      n += 2;
    },
    end() { if (!pos) return 0; geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; return n / 2; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export function createPhysicsDebug(kit, scene, o = {}) {
  const { phys } = kit;
  const group = new THREE.Group(); group.name = 'physics-debug'; group.userData.collide = false;
  const cols = lines('physics-debug-colliders'), jts = lines('physics-debug-joints'), cts = lines('physics-debug-contacts');
  group.add(cols.mesh, jts.mesh, cts.mesh);
  scene.add(group);
  const on = { colliders: o.colliders !== false, joints: o.joints !== false, contacts: o.contacts !== false };
  const tick = o.contactSize ?? 0.12;
  const dbg = { group, counts: { lines: 0, joints: 0, contacts: 0 }, element: o.stats || null };
  Object.defineProperty(dbg, 'visible', { get: () => group.visible, set: (v) => { group.visible = !!v; } });
  dbg.show = (what) => { Object.assign(on, what); return dbg; };

  const anchor = (rb, l, out) => { const t = rb.translation(), r = rb.rotation(); return out.set(l.x, l.y, l.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_b.set(t.x, t.y, t.z)); };
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _ca = new THREE.Vector3(), _cb = new THREE.Vector3();
  function drawJoints() {
    jts.begin(); let n = 0;
    const all = kit.joints?.all;
    if (all) for (const j of all.values()) {
      const A = j.bodyA, B = j.bodyB;
      if (!A || !B || A.handle !== j.ha || B.handle !== j.hb) continue;
      const ta = A.translation(), tb = B.translation();
      _ca.set(ta.x, ta.y, ta.z); _cb.set(tb.x, tb.y, tb.z);
      if (!j.alive) { jts.seg(_ca, _cb, 0.5, 0.5, 0.5, 0.35); continue; }
      anchor(A, j.anchorA, _pa); anchor(B, j.anchorB, _pb);
      const hot = j.breakForce != null && j.force > 0.8 * j.breakForce;
      const r = 1, g = hot ? 0.1 : 0.55, b = hot ? 0.1 : 0.05;
      if (j.pin == null) jts.seg(_ca, _pa, r, g, b);
      jts.seg(_pb, _cb, r, g, b);
      // a stretched joint (a spring, a rope, a joint the solver has not closed) shows as its own line
      if (_pa.distanceToSquared(_pb) > 1e-6) jts.seg(_pa, _pb, 1, 1, 1);
      n++;
    }
    jts.end(); return n;
  }
  function drawContacts() {
    cts.begin(); let n = 0;
    const w = phys.world;
    w.forEachActiveRigidBody((rb) => {
      for (let i = 0; i < rb.numColliders(); i++) {
        const c1 = rb.collider(i);
        w.contactPairsWith(c1, (c2) => {
          // a pair of two awake bodies is met from both sides: draw it from the lower handle only
          const other = c2.parent();
          if (other && other.isDynamic() && !other.isSleeping() && c2.handle < c1.handle) return;
          w.contactPair(c1, c2, (m, flipped) => {
            const nn = m.normal(), s = flipped ? -tick : tick;
            for (let k = 0; k < m.numSolverContacts(); k++) {
              const p = m.solverContactPoint(k);
              if (!p) continue;
              _a.set(p.x, p.y, p.z); _b.set(p.x + nn.x * s, p.y + nn.y * s, p.z + nn.z * s);
              cts.seg(_a, _b, 1, 0.9, 0.1); n++;
            }
          });
        });
      }
    });
    cts.end(); return n;
  }

  dbg.text = () => {
    const s = kit.stats();
    return `bodies ${s.bodies} (awake ${s.awake} of ${s.dynamic}) · colliders ${s.colliders} · joints ${s.joints} · step ${s.stepMs.toFixed(2)} ms (avg ${s.stepMsAvg.toFixed(2)})`;
  };
  dbg.update = () => {
    if (!group.visible) return dbg;
    cols.mesh.visible = on.colliders; jts.mesh.visible = on.joints; cts.mesh.visible = on.contacts;
    if (on.colliders) { const r = phys.world.debugRender(); cols.set(r.vertices, r.colors); dbg.counts.lines = cols.end(); } else dbg.counts.lines = 0;
    dbg.counts.joints = on.joints ? drawJoints() : 0;
    dbg.counts.contacts = on.contacts ? drawContacts() : 0;
    if (dbg.element) dbg.element.textContent = dbg.text();
    return dbg;
  };
  dbg.dispose = () => { scene.remove(group); cols.dispose(); jts.dispose(); cts.dispose(); };
  return dbg;
}

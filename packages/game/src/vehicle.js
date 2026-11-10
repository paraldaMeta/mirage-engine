// Mirage original code. A ray-cast wheel vehicle on a physics-kit body: one ray per wheel, a spring and damper
// along it, and tyre forces at the contact, clamped by grip times load. No wheel bodies, no wheel colliders.
// ---------------------------------------------------------------------------
// const car = createVehicle(kit, chassisObject, {
//   half: [0.85, 0.3, 1.9], mass: 1200, com: [0, -0.35, 0],
//   wheels: [{ pos: [0.8, -0.2, 1.3], steer: true, drive: false, obj: wheelMesh }, ...],   default: four at the corners,
//   radius: 0.34, rest: 0.3, sag: 0.1, dampingRatio: 0.6,       front steer, rear drive
//   engine: 7000, brake: 9000, topSpeed: 30, maxSteer: 0.55, grip: 1.4, rollInfluence: 0.25 });
// car.controls.throttle = 1;  car.controls.steer = -0.4;  car.controls.brake = 0;  car.controls.handbrake = false;
// car.speed (m/s, forward positive)   car.wheels[i].contact / .compression / .load   car.body (the kit body)
// The chassis' forward is its +z, up is +y; steer > 0 turns right. Wheel pos is the top of the suspension, in the
// chassis' frame; `obj` (a child of the chassis object, axle along its x) is moved and spun for you.
// It drives on anything with a collider (fixed, kinematic or dynamic: what it stands on is pushed back).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _a = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);

export function createVehicle(kit, obj, o = {}) {
  const { phys, R } = kit, ext = phys.ext;
  const half = o.half || [0.85, 0.3, 1.9], mass = o.mass ?? 1200, radius = o.radius ?? 0.34, rest = o.rest ?? 0.3;
  const body = o.body || kit.rigid(obj, { shape: 'box', half, mass, com: o.com || [0, -half[1] * 0.9, 0], pos: o.pos, quat: o.quat, material: o.material || { friction: 0.3, restitution: 0.1 },
    layer: o.layer, mask: o.mask, damping: 0.02, angularDamping: 0.3, ccd: o.ccd, name: o.name || 'vehicle', events: o.events });
  const defs = o.wheels || [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => ({ pos: [sx * (half[0] - 0.05), -half[1] * 0.5, sz * half[2] * 0.7], steer: sz > 0, drive: sz < 0 }));
  const perWheel = mass / defs.length;
  // the spring that holds a wheel's share of the weight at `sag` metres of compression; damping as a ratio of critical
  const stiffness = o.stiffness ?? perWheel * 9.81 / (o.sag ?? 0.1), damping = o.damping ?? 2 * (o.dampingRatio ?? 0.6) * Math.sqrt(stiffness * perWheel);
  const wheels = defs.map((d) => ({ pos: d.pos.slice(), radius: d.radius ?? radius, rest: d.rest ?? rest, steer: !!d.steer, drive: !!d.drive, brake: d.brake !== false, handbrake: d.handbrake ?? !d.steer,
    obj: d.obj || null, contact: false, compression: 0, length: d.rest ?? rest, load: 0, spin: 0, slip: 0, point: [0, 0, 0], normal: [0, 1, 0], ground: null }));
  const car = { body, obj, wheels, controls: { throttle: 0, steer: 0, brake: 0, handbrake: false }, steerAngle: 0, speed: 0, grounded: 0,
    engine: o.engine ?? 7000, brake: o.brake ?? 9000, topSpeed: o.topSpeed ?? 30, reverseSpeed: o.reverseSpeed ?? 8, maxSteer: o.maxSteer ?? 0.55, steerSpeed: o.steerSpeed ?? 2.5, steerFade: o.steerFade ?? 18,
    grip: o.grip ?? 1.4, rollInfluence: o.rollInfluence ?? 0.25, rolling: o.rolling ?? 0.4, stiffness, damping };
  const drives = wheels.filter((w) => w.drive).length || 1;

  const step = (dt) => {
    const rb = body._b, c = car.controls;
    const idle = !c.throttle && !c.steer && !c.brake;
    if (rb.isSleeping() && idle) return;
    const wake = !idle;   // a waking impulse restarts Rapier's sleep timer: a parked car would never sleep
    const t = rb.translation(), r = rb.rotation(), com = rb.worldCom(), lv = rb.linvel(), av = rb.angvel();
    _q.set(r.x, r.y, r.z, r.w);
    _up.set(0, 1, 0).applyQuaternion(_q); _fw.set(0, 0, 1).applyQuaternion(_q); _rt.set(-1, 0, 0).applyQuaternion(_q);
    car.speed = lv.x * _fw.x + lv.y * _fw.y + lv.z * _fw.z;
    // steering eases to its target, and the lock narrows with speed (full lock at 100 km/h turns the car over)
    const want = -Math.max(-1, Math.min(1, c.steer)) * car.maxSteer / (1 + Math.abs(car.speed) / car.steerFade);
    const ds = want - car.steerAngle, ms = car.steerSpeed * dt;
    car.steerAngle += Math.abs(ds) <= ms ? ds : Math.sign(ds) * ms;
    let grounded = 0;
    for (const w of wheels) {
      _a.set(w.pos[0], w.pos[1], w.pos[2]).applyQuaternion(_q);
      const ax = t.x + _a.x, ay = t.y + _a.y, az = t.z + _a.z, reach = w.rest + w.radius;
      const hit = phys.world.castRayAndGetNormal(new R.Ray({ x: ax, y: ay, z: az }, { x: -_up.x, y: -_up.y, z: -_up.z }), reach, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, rb);
      // the wheel turns with the car's forward speed when it rolls, and stops when it is braked hard
      const locked = (c.handbrake && w.handbrake) || (c.brake >= 1 && w.brake);
      if (!hit) {
        w.contact = false; w.compression = 0; w.length = w.rest; w.load = 0; w.ground = null; w.slip = 0;
        if (!locked) w.spin += (w.drive ? c.throttle * 20 : car.speed / w.radius) * dt;
        continue;
      }
      grounded++;
      const d = hit.timeOfImpact, px = ax - _up.x * d, py = ay - _up.y * d, pz = az - _up.z * d;
      _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const gb = hit.collider.parent();
      // the chassis' velocity at the contact, less the ground's (a moving platform, a body driven over)
      let vx = lv.x + av.y * (pz - com.z) - av.z * (py - com.y), vy = lv.y + av.z * (px - com.x) - av.x * (pz - com.z), vz = lv.z + av.x * (py - com.y) - av.y * (px - com.x);
      if (gb && !gb.isFixed()) {
        const gl = gb.linvel(), ga = gb.angvel(), gc = gb.worldCom();
        vx -= gl.x + ga.y * (pz - gc.z) - ga.z * (py - gc.y); vy -= gl.y + ga.z * (px - gc.x) - ga.x * (pz - gc.z); vz -= gl.z + ga.x * (py - gc.y) - ga.y * (px - gc.x);
      }
      w.contact = true; w.length = Math.max(0, d - w.radius); w.compression = w.rest - w.length; w.ground = gb;
      w.point[0] = px; w.point[1] = py; w.point[2] = pz; w.normal[0] = _n.x; w.normal[1] = _n.y; w.normal[2] = _n.z;
      // suspension: pushes along the ground's normal; never pulls
      const closing = -(vx * _n.x + vy * _n.y + vz * _n.z);
      const load = Math.max(0, stiffness * w.compression + damping * closing) * Math.max(0, _n.dot(_up));
      w.load = load;
      let jx = _n.x * load * dt, jy = _n.y * load * dt, jz = _n.z * load * dt;
      // the tyre's own directions on the ground
      _f.copy(_fw); if (w.steer) _f.applyAxisAngle(_up, car.steerAngle);
      _f.addScaledVector(_n, -_f.dot(_n)).normalize();
      _s.crossVectors(_n, _f);
      const vf = vx * _f.x + vy * _f.y + vz * _f.z, vs = vx * _s.x + vy * _s.y + vz * _s.z;
      let jl = 0;
      if (w.drive && c.throttle) {
        const fwd = c.throttle > 0, lim = fwd ? car.topSpeed : car.reverseSpeed, k = Math.min(1, Math.max(0, 1 - Math.max(0, fwd ? vf : -vf) / lim) * 4);   // full push until the last quarter of the speed range
        jl += c.throttle * car.engine / drives * k * dt;
      }
      const hold = locked ? Infinity : (w.brake ? c.brake * car.brake / wheels.length : 0) + car.rolling * perWheel * (idle ? 3 : 1);
      // brakes and rolling resistance oppose the motion and stop at zero; a sideways slide is stopped outright
      jl += Math.max(-hold * dt, Math.min(hold * dt, -vf * perWheel));
      let jt = -vs * perWheel;
      const max = car.grip * load * dt, need = Math.hypot(jl, jt);
      w.slip = max > 0 ? need / max : need > 0 ? 9 : 0;
      if (need > max) { const k = max / need; jl *= k; jt *= k; }
      // sideways force acts nearer the centre of mass's height: less body roll than a real car, on purpose
      const lift = (com.x - px) * _up.x + (com.y - py) * _up.y + (com.z - pz) * _up.z, h = lift * (1 - car.rollInfluence);
      rb.applyImpulseAtPoint({ x: jx + _f.x * jl, y: jy + _f.y * jl, z: jz + _f.z * jl }, { x: px, y: py, z: pz }, wake);
      rb.applyImpulseAtPoint({ x: _s.x * jt, y: _s.y * jt, z: _s.z * jt }, { x: px + _up.x * h, y: py + _up.y * h, z: pz + _up.z * h }, wake);
      if (gb && gb.isDynamic()) gb.applyImpulseAtPoint({ x: -(jx + _f.x * jl + _s.x * jt), y: -(jy + _f.y * jl + _s.y * jt), z: -(jz + _f.z * jl + _s.z * jt) }, { x: px, y: py, z: pz }, true);
      if (!locked) w.spin += vf / w.radius * dt;
    }
    car.grounded = grounded;
  };
  const draw = () => {
    for (const w of wheels) {
      if (!w.obj) continue;
      w.obj.position.set(w.pos[0], w.pos[1] - w.length, w.pos[2]);
      _qs.setFromAxisAngle(_Y, w.steer ? car.steerAngle : 0); _qr.setFromAxisAngle(_X, w.spin);
      w.obj.quaternion.copy(_qs).multiply(_qr);
    }
  };
  const off = kit.on('step', step), offDraw = kit.on('stepped', draw);
  draw();

  const key = 'vehicle' + (kit.vehicles = (kit.vehicles || 0) + 1);
  ext.save[key] = () => ({ steer: car.steerAngle, controls: { ...car.controls }, wheels: wheels.map((w) => [w.spin, w.length]) });
  ext.load[key] = (s) => { car.steerAngle = s.steer; Object.assign(car.controls, s.controls); s.wheels.forEach(([spin, length], i) => { wheels[i].spin = spin; wheels[i].length = length; }); draw(); };
  /** put the car somewhere, at rest, upright unless a quaternion is given */
  car.place = (pos, quat = [0, 0, 0, 1]) => { body.teleport(pos, quat, true); car.steerAngle = 0; return car; };
  car.dispose = () => { off(); offDraw(); delete ext.save[key]; delete ext.load[key]; };
  return car;
}

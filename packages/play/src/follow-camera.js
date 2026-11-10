// Mirage original code.
// ---------------------------------------------------------------------------
// Two character cameras over the walk grid (with or without createSolids): a third-person spring arm that shortens
// when the world is in the way, and a first-person eye that follows a crouch. No three import: it writes numbers
// and, if asked, a camera.
//
//   const cam = createFollowCamera(space, { mode: 'third', distance: 4, height: 1.55, shoulder: 0.35 });
//   cam.turn(dYaw, dPitch);                       // from the mouse / stick (pitch > 0: the camera rises, looks down)
//   cam.update(dt, mover);                        // after mover.update: adds the turn of a platform it rides
//   cam.apply(camera)                             // position + rotation on a THREE camera (YXZ order)
//   cam.position, cam.yaw, cam.pitch, cam.arm (metres, the current boom), cam.forward() -> [x, z] to steer input by
//   cam.mode = 'first'                            // eye at mover.eye (BODY.eye when it has none)
//
// The arm: five rays from the pivot (centre and four `radius` apart) marched through the grid; the shortest clear
// one sets the boom. Shorter: at once (a wall never shows its back). Longer: eased (`ease` per second), so
// passing a post does not pump the camera. The pivot's shoulder offset is pulled in the same way.
// ponytail: collision is against the walk grid and its solids only: what the bake left out (foliage, thin wires,
// userData.collide === false) does not push the camera, and a surface thinner than half a cell sideways can slip
// between two samples.
// ---------------------------------------------------------------------------
import { gridRay } from './solids.js';

export function createFollowCamera(grid, opts = {}) {
  const o = { mode: 'third', distance: 4, height: 1.55, shoulder: 0.35, radius: 0.18, min: 0.25, ease: 5, pitchMin: -1.2, pitchMax: 1.2, ...opts };
  const cam = { ...o, yaw: opts.yaw || 0, pitch: opts.pitch || 0, arm: o.distance, position: [0, 0, 0], pivot: [0, 0, 0], close: false };
  const a = [0, 0, 0], b = [0, 0, 0];
  cam.turn = (dy, dp = 0) => { cam.yaw += dy; cam.pitch = Math.max(cam.pitchMin, Math.min(cam.pitchMax, cam.pitch + dp)); return cam; };
  /** the direction the camera faces over the ground, [x, z] (unit) */
  cam.forward = () => [-Math.sin(cam.yaw), -Math.cos(cam.yaw)];
  cam.update = (dt, m) => {
    if (m.carry) cam.yaw += m.carry[3];
    const p = m.pos, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    if (cam.mode === 'first') {
      cam.position[0] = p[0]; cam.position[1] = p[1] + (m.eye ?? m.body.eye); cam.position[2] = p[2];
      cam.pivot[0] = p[0]; cam.pivot[1] = cam.position[1]; cam.pivot[2] = p[2]; cam.arm = 0; cam.close = true;
      return cam;
    }
    // the pivot: above the feet (lower when crouched), a shoulder to the right as far as the world allows
    const h = cam.height * ((m.eye ?? m.body.eye) / m.body.eye);
    a[0] = p[0]; a[1] = p[1] + h; a[2] = p[2];
    b[0] = a[0] + cy * cam.shoulder; b[1] = a[1]; b[2] = a[2] - sy * cam.shoulder;
    const sh = cam.shoulder ? Math.max(0, gridRay(grid, a, b) * Math.abs(cam.shoulder) - cam.radius) * Math.sign(cam.shoulder) : 0;
    a[0] += cy * sh; a[2] -= sy * sh;
    cam.pivot[0] = a[0]; cam.pivot[1] = a[1]; cam.pivot[2] = a[2];
    // back along the view: the boom
    const bx = sy * cp, by = sp, bz = cy * cp;
    let clear = cam.distance;
    for (let i = 0; i < 5; i++) {
      const ox = i === 1 ? cy : i === 2 ? -cy : 0, oy = i === 3 ? 1 : i === 4 ? -1 : 0, oz = i === 1 ? -sy : i === 2 ? sy : 0, r = cam.radius;
      b[0] = a[0] + bx * cam.distance + ox * r; b[1] = a[1] + by * cam.distance + oy * r; b[2] = a[2] + bz * cam.distance + oz * r;
      const t = gridRay(grid, a, b) * cam.distance;
      if (t < clear) clear = t;
    }
    if (clear < cam.distance) clear = Math.max(cam.min, clear - cam.radius);
    cam.arm = clear < cam.arm ? clear : cam.arm + (clear - cam.arm) * Math.min(1, dt * cam.ease);
    cam.position[0] = a[0] + bx * cam.arm; cam.position[1] = a[1] + by * cam.arm; cam.position[2] = a[2] + bz * cam.arm;
    cam.close = cam.arm < 0.7;   // near enough to see inside the figure: a host hides it
    return cam;
  };
  cam.apply = (camera) => { camera.position.set(cam.position[0], cam.position[1], cam.position[2]); camera.rotation.set(-cam.pitch, cam.yaw, 0, 'YXZ'); return camera; };
  return cam;
}

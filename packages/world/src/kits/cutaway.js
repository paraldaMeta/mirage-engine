// Mirage original code. Brought in from a game built on Mirage (an iso camera in a town of houses).
// ---------------------------------------------------------------------------
// See-through cutaway for high cameras: what stands between the camera and the player is cut away in a dithered
// round hole along the line of sight, in the materials marked for it (walls, roofs, tree crowns); the ground and
// everything else stay. An iso or top-down game needs this from day one: walk behind a house and the player is
// gone. Shadow (depth) materials are not touched, so the cut walls still cast their shadows.
//
//   const cut = createCutaway({ radius: 1.9 });
//   const wall = ctx.mat.std({ color }, cut.hooks(PROC.plaster()));     // mark a material while building
//   cut.apply(ctx.mat, roofMaterial);                                    // or mark one that already exists
//   each frame: cut.set(feet.x, feet.y + 1, feet.z);                     // the point to keep in view (the chest)
//   picking: cut.hides(x, y, z, camera.position) -> what the cut hides cannot be clicked either
// The hole: fragments whose distance to the eye -> target segment is under the radius (narrower near the camera:
// 0.55 r at the eye, r from 90 % of the way), between `near` and `far` of the way along it, and higher than
// `below` m under the target (the ground the player stands on stays). One program for every cutaway: the target,
// radius and shape are uniforms.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const GLSL = /* glsl */ `{
  vec3 mgCa = uMgCut.xyz - cameraPosition, mgCp = mgWorldPos - cameraPosition;
  float mgCt = dot(mgCp, mgCa) / max(dot(mgCa, mgCa), 1e-4);
  if (uMgCut.w > 0.0 && mgCt > uMgCutShape.x && mgCt < uMgCutShape.y && mgWorldPos.y > uMgCut.y - uMgCutShape.z) {
    float mgCd = length(mgCp - mgCa * mgCt), mgCr = uMgCut.w * (0.55 + 0.45 * smoothstep(0.3, 0.9, mgCt));
    float mgCn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (mgCd < mgCr * (0.72 + 0.28 * mgCn)) discard;
  }
}`;

const xyz = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? v : [v.x, v.y, v.z]);

/** A cutaway: options radius (1.8 m), near (0.02) and far (0.96) of the eye -> target way, below (0.6 m). Off until set(). */
export function createCutaway({ radius = 1.8, near = 0.02, far = 0.96, below = 0.6 } = {}) {
  const uCut = { value: new THREE.Vector4(0, -1e4, 0, 0) };
  const uShape = { value: new THREE.Vector3(near, far, below) };
  const cut = {
    radius,
    /** the uniforms, shared by every material marked with this cutaway */
    uniforms: { uMgCut: uCut, uMgCutShape: uShape },
    /** `hooks` (patch() hooks) with the cut in front of their albedo */
    hooks(hooks = {}) {
      return {
        ...hooks,
        uniforms: { ...(hooks.uniforms || {}), uMgCut: uCut, uMgCutShape: uShape },
        fragmentDecl: (hooks.fragmentDecl || '') + '\nuniform vec4 uMgCut; uniform vec3 uMgCutShape;',
        albedo: GLSL + '\n' + (hooks.albedo || ''),
      };
    },
    /** mark a material that exists: re-patch it with its own hooks (a patch()ed one keeps them) plus the cut */
    apply(mat, material) { return mat.patch(material, cut.hooks(material.userData.hooks || {})); },
    /** the point kept in view (world, m); r: the radius (default the option) */
    set(x, y, z, r = cut.radius) { uCut.value.set(x, y, z, r); return cut; },
    off() { uCut.value.w = 0; return cut; },
    get on() { return uCut.value.w > 0; },
    /** would the hole (at its full radius, no dither) hide the point (x, y, z) seen from `eye`? */
    hides(x, y, z, eye) {
      const c = uCut.value, r = c.w;
      if (!(r > 0)) return false;
      const e = xyz(eye);
      const ax = c.x - e[0], ay = c.y - e[1], az = c.z - e[2], px = x - e[0], py = y - e[1], pz = z - e[2];
      const t = (px * ax + py * ay + pz * az) / Math.max(ax * ax + ay * ay + az * az, 1e-6);
      if (!(t > uShape.value.x && t < uShape.value.y && y > c.y - uShape.value.z)) return false;
      return Math.hypot(px - ax * t, py - ay * t, pz - az * t) < r;
    },
  };
  return cut;
}

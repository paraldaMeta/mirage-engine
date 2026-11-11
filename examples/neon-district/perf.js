// perf: what neon-district does to stay inside its frame budget without losing what the player can see (NOTES.md,
// "Frame budget"). Nothing here changes a module's art; it changes in which passes things are drawn.
//
//  - the mirror (mirrorLayer): the wet street's planar reflection draws one layer; everything is put on it except
//    what the caller leaves out (the view model, the close-up props: what a puddle shows from where a player stands
//    is the signs, facades, cars, lamps, robots and large silhouettes).
//  - by distance (distanceCull): the close-up goods that a module splits by place (vending.js: the cans, bottles and
//    spirals of each row of machines) are drawn only within their `userData.ndFar` metres.
import * as THREE from 'three';

/** the layer the mirror pass draws (main.js: lighting.planar.layers) */
export const MIRROR_LAYER = 6;

/** put everything under `root` on the mirror's layer except what `leave(o)` says (and its subtree); later additions
 *  (casings, rockets, effects) are not on it, which is what the mirror wants of them anyway */
export function mirrorLayer(root, leave) {
  let n = 0;
  const walk = (o) => { if (leave(o)) return; o.layers.enable(MIRROR_LAYER); n++; for (const c of o.children) walk(c); };
  walk(root);
  return n;
}

/** a mesh's world-space distance test, cheap enough for every frame: visible while the eye is within `far` metres of
 *  its bounding sphere (hysteresis of 6 %, so a thing at the edge does not blink) */
export function distanceCull(meshes, far) {
  const c = new THREE.Vector3(), s = new THREE.Sphere(), f2 = far * far, in2 = (far * 0.94) ** 2;
  let lastT = Infinity;
  return (camera, t = 0) => {
    c.setFromMatrixPosition(camera.matrixWorld);
    // a jump of the view (the scene clock set back): decide afresh, so a still does not depend on the view before it
    const fresh = t < lastT - 0.25; lastT = t;
    for (const m of meshes) {
      if (fresh) m.visible = false;
      const bs = m.isInstancedMesh ? (m.boundingSphere || (m.computeBoundingSphere(), m.boundingSphere)) : (m.geometry.boundingSphere || (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere));
      s.copy(bs).applyMatrix4(m.matrixWorld);
      const d = Math.max(0, c.distanceTo(s.center) - s.radius), d2 = d * d;
      if (m.visible && d2 > f2) m.visible = false; else if (!m.visible && d2 < in2) m.visible = true;
    }
  };
}

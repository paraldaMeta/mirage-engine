// Mirage original code.
// A per-view hook for systems that must run just before a view is drawn (LOD selection, instance culling,
// occlusion): three calls scene.onBeforeRender before it collects the objects of a render, so what a hook hides
// or swaps there is what that render draws. Hooks chain (several systems, one scene) and run only for the camera
// they were given: shadow maps, the walk-grid bake and probes use other cameras and see the scene as it was left.
//
//   import { onView } from '@miragekit/core/frame';
//   const off = onView(world.scene, world.camera, (camera, heightPx, renderer, target) => { ... });   off() removes it
//   onView(scene, camera, before, after)     `after(camera, renderer)` runs when that render is done (undo what before did)
export function onView(scene, camera, fn, after = null) {
  let hooks = scene.userData.viewHooks;
  if (!hooks) {
    hooks = [];
    Object.defineProperty(scene.userData, 'viewHooks', { value: hooks, enumerable: false });   // not for toJSON / clone
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, s, cam, target) {
      before.call(this, renderer, s, cam, target);
      for (let i = 0; i < hooks.length; i++) if (hooks[i].camera === cam) hooks[i].fn(cam, target ? target.height : renderer.domElement.height, renderer, target);
    };
    const done = scene.onAfterRender;
    scene.onAfterRender = function (renderer, s, cam) {
      done.call(this, renderer, s, cam);
      for (let i = 0; i < hooks.length; i++) if (hooks[i].camera === cam && hooks[i].after) hooks[i].after(cam, renderer);
    };
  }
  const h = { camera, fn, after };
  hooks.push(h);
  return () => { const i = hooks.indexOf(h); if (i >= 0) hooks.splice(i, 1); };
}

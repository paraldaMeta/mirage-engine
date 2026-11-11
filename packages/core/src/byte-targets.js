// Mirage original code.
// ---------------------------------------------------------------------------
// A WebGL2 context that cannot draw into float textures (neither EXT_color_buffer_float nor
// EXT_color_buffer_half_float: some older phone GPUs) leaves every half-float render target incomplete, and the
// pipeline draws a black canvas. The world renderer calls this once (world.js); on such a context every render
// target is made 8-bit the first time it is bound, so the picture comes back: clamped at 1 before the tone curve
// (flat highlights, banding in the dark) instead of nothing. Where float targets exist this does nothing at all.
//   import { byteTargets } from '@miragekit/core/byte-targets';
//   byteTargets(renderer)            // -> true when the fallback was installed
//   byteTargets(renderer, true)      // install it anyway (to look at it on a desktop: ?bytetargets=1 in hello-courtyard)
// Not covered: what stores numbers rather than colour in a float target (GPU particles, probe GI, Hi-Z occlusion,
// auto exposure); those are opt-in and should stay off when probeDevice() says halfFloatTargets: false.
// ---------------------------------------------------------------------------
import { HalfFloatType, FloatType, UnsignedByteType } from 'three';

export function byteTargets(renderer, force = false) {
  const gl = renderer.getContext();
  if (!force && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) return false;
  const set = renderer.setRenderTarget.bind(renderer), seen = new WeakSet();
  renderer.setRenderTarget = (rt, ...rest) => {
    if (rt && !seen.has(rt)) {
      seen.add(rt);
      for (const t of rt.textures || [rt.texture]) if (t && (t.type === HalfFloatType || t.type === FloatType)) t.type = UnsignedByteType;
    }
    return set(rt, ...rest);
  };
  return true;
}

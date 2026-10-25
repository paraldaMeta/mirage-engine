// Mirage code adapted from the author's own earlier envlight.js (no Golden Temple code in it); slimmed.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// Image-based light that follows a running clock without jumps.
//
//   const env = createEnvLight(renderer, { size: 256 });
//   env.capture(scene, position, { instant })   PMREM of the scene (sky + world) from `position`
//   env.tick(dt)                                advances the cross-fade; true while it is fading
//   env.texture                                 set once as scene.environment and never replaced
//
// Each capture goes into `next`; the texture the scene uses (`out`) cross-fades from what it showed (`prev`)
// to `next` over `fade` seconds: a full-screen mix over the CubeUV atlas (one layout for all three targets,
// so a texel-wise mix is exact). The scene keeps `out` while it is captured, so every capture already carries
// one more bounce of the light before it.
// ponytail: one probe for the whole world; local probes / an irradiance volume when interiors need their own.
// ---------------------------------------------------------------------------

export function createEnvLight(renderer, { size = 256, fade = 1.5 } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const mix = new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, uF: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tA, tB; uniform float uF; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uF); }',
    depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(mix);
  let next = null, prev = null, out = null, t = 1;
  const pos = new THREE.Vector3();

  function draw(a, b, k, dst) {
    const saved = renderer.getRenderTarget();
    mix.uniforms.tA.value = a.texture; mix.uniforms.tB.value = b.texture; mix.uniforms.uF.value = k;
    dst.viewport.set(0, 0, dst.width, dst.height); dst.scissorTest = false;
    renderer.setRenderTarget(dst);
    quad.render(renderer);
    renderer.setRenderTarget(saved);
  }

  const env = {
    fade,
    get texture() { return out ? out.texture : null; },
    get fading() { return t < 1; },
    capture(scene, position, { instant = false } = {}) {
      const rt = pmrem.fromScene(scene, 0, 0.1, 1500, { size, position: pos.fromArray(position) });
      if (next) next.dispose();
      next = rt;
      if (!out) {
        out = next.clone(); prev = next.clone();
        for (const x of [out, prev]) x.texture.mapping = THREE.CubeUVReflectionMapping;
        instant = true;
      }
      if (instant) { draw(next, next, 1, out); t = 1; }
      else { draw(out, out, 0, prev); t = 0; }   // what the scene sees now fades out
    },
    tick(dt) {
      if (t >= 1 || !out) return false;
      t = Math.min(1, t + dt / env.fade);
      draw(prev, next, t * t * (3 - 2 * t), out);
      return true;
    },
    dispose() { for (const x of [next, prev, out]) x && x.dispose(); pmrem.dispose(); mix.dispose(); quad.dispose(); },
  };
  return env;
}

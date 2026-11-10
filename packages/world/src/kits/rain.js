// Mirage original code.
import * as THREE from 'three';
import { WET, setRain, rng } from '@mirage/core';

// Falling rain around the camera: `count` thin streaks in a box that follows the eye (one instanced draw call).
// Each streak keeps a fixed place in the world and falls with time (G.uTime), wrapped into the box, so a still frame
// is the same on every run and walking through the rain does not drag it along. A streak is stretched along its
// velocity (fall + wind) for `streak` seconds of travel, at least one pixel wide (thinner ones are spread over the
// pixel with less alpha: no crawling), faint, lit by the sky and, looking toward it, the key light. Its density
// follows setRain(level) (core: the same level drives the ripples on puddles); environment captures do not see it.
const VS_DECL = /* glsl */ `
attribute vec4 aRain;
uniform vec3 uRainBox;
uniform vec4 uRainView;     // centre (xyz), metres per pixel per metre away (w > 0; perspective) or per pixel (w < 0)
uniform vec4 uRainShape;    // fall speed (m/s), streak time (s), width (m), density
uniform float uRainHide;
varying float vRainA;
varying vec2 vRainQ;
`;
const VS_WORLD = /* glsl */ `{
  float sp = uRainShape.x * (0.85 + 0.3 * fract(aRain.w * 97.13));
  vec3 vel = vec3(uWind.x, 0.0, uWind.y) * uWind.z * 1.2 - vec3(0.0, sp, 0.0);
  vec3 rel = mod(aRain.xyz * uRainBox + vel * uTime - uRainView.xyz + 0.5 * uRainBox, uRainBox) - 0.5 * uRainBox;
  vec3 head = uRainView.xyz + rel, dir = normalize(vel), toCam = cameraPosition - head;
  float dist = max(length(toCam), 1e-3);
  vec3 side = cross(dir, toCam / dist);
  side /= max(length(side), 1e-4);
  float px = uRainView.w > 0.0 ? uRainView.w * dist : -uRainView.w;
  float wd = max(uRainShape.z, px);
  vec3 b = abs(rel) / (0.5 * uRainBox);
  float on = step(aRain.w, uRain * uRainShape.w) * (1.0 - uRainHide);
  // faded toward the box's rim (the wrap never pops) and right at the eye
  vRainA = on * (1.0 - smoothstep(0.65, 1.0, max(max(b.x, b.y), b.z))) * smoothstep(0.4, 1.2, dist) * uRainShape.z / wd;
  vRainQ = position.xy;
  mgWorld = head + on * (side * (0.5 * wd * position.x) - vel * (uRainShape.y * position.y));
}`;
const FS_DECL = 'varying float vRainA;\nvarying vec2 vRainQ;\nuniform float uRainGain;';
const FS_OUT = /* glsl */ `{
  vec3 V = normalize(mgWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uKeyDir), 0.0), 8.0) * step(0.0, uKeyDir.y);
  vec3 sky = vec3(0.55, 0.6, 0.68) * (0.6 * uSkyLight + 0.01);
  outgoingLight = (sky + uKeyColor * (0.04 + 0.4 * fwd) + vec3(1.0, 0.62, 0.32) * 0.012 * uLamp) * uRainGain;
  float across = 1.0 - abs(vRainQ.x), along = smoothstep(0.0, 0.2, vRainQ.y) * (1.0 - smoothstep(0.55, 1.0, vRainQ.y));
  diffuseColor.a = clamp(vRainA * across * along, 0.0, 1.0);
}`;

/** Rain streaks around the camera. options: count (6000), box [x, y, z] metres (22, 14, 22), speed m/s (8.5), streak
 *  seconds of travel per streak (0.035), width m (0.0012), density 0..1 of the count at rain 1 (1), gain (1),
 *  intensity (if given: setRain(intensity)), seed. Returns the mesh (added to ctx.root). */
export function addRain(ctx, { count = 6000, box = [22, 14, 22], speed = 8.5, streak = 0.035, width = 0.0012, density = 1, gain = 1, intensity, seed = 'rain' } = {}) {
  if (!(Number.isInteger(count) && count > 0)) throw new RangeError('rain.count must be a positive integer');
  if (!Array.isArray(box) || box.length !== 3 || !box.every((v) => Number.isFinite(v) && v > 0)) throw new RangeError('rain.box must be [x, y, z] > 0');
  if (![speed, streak, width, density, gain].every(Number.isFinite)) throw new RangeError('rain options must be finite numbers');
  if (intensity !== undefined) setRain(intensity);
  const R = rng(seed), seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = R.next();
  const geometry = new THREE.InstancedBufferGeometry();
  // one quad: x across (-1 .. 1), y along the streak (0 head .. 1 tail)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aRain', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const U = {
    uRainBox: { value: new THREE.Vector3(...box) }, uRainView: { value: new THREE.Vector4() },
    uRainShape: { value: new THREE.Vector4(speed, streak, width, density) }, uRainHide: { value: 0 },
    uRainGain: { value: gain }, uRain: WET.uRain,
  };
  // additive: order-free, so the two-sided quads go in one pass (one draw call)
  const material = ctx.mat.patch(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, forceSinglePass: true }), {
    vertexDecl: VS_DECL + 'uniform float uRain;', vertexWorld: VS_WORLD, fragmentDecl: FS_DECL, output: FS_OUT, uniforms: U,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rain'; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.collide = false; mesh.renderOrder = 10;
  const v2 = new THREE.Vector2(), c = new THREE.Vector3(), d = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    // the environment capture's cube faces (90°, square) do not see the rain
    U.uRainHide.value = camera.isPerspectiveCamera && camera.fov === 90 && camera.aspect === 1 ? 1 : 0;
    const rt = renderer.getRenderTarget(), h = rt ? rt.height : renderer.getDrawingBufferSize(v2).y;
    camera.getWorldPosition(c);
    if (camera.isOrthographicCamera) {
      // centred where the view axis meets the ground (y = 0), not on the far-away eye
      camera.getWorldDirection(d);
      if (d.y < -0.05) c.addScaledVector(d, -c.y / d.y);
      U.uRainView.value.set(c.x, c.y, c.z, -(camera.top - camera.bottom) / camera.zoom / h);
    } else {
      U.uRainView.value.set(c.x, c.y, c.z, 2 / (camera.projectionMatrix.elements[5] * h));
    }
  };
  ctx.root.add(mesh);
  return mesh;
}

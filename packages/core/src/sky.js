// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { ATMO, ATMOSPHERE_GLSL } from './atmosphere.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// The sky dome: the atmosphere of atmosphere.js lit by the Sun (and by the Moon at night), an HDR sun disc, the
// Moon's disc with its phase, a cloud layer at 2.5 km and a faint night glow. It follows whatever camera draws
// it (cube captures included) and sits at the far plane, drawn after the opaque world.
// All values live in `uniforms` (createSkyUniforms); daynight.js writes them.
// ---------------------------------------------------------------------------

export function createSkyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 20 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonI: { value: 0 }, uMoonDisc: { value: 0 }, uMoonR: { value: 0.0045 },
    uNightGlow: { value: new THREE.Vector3() },
    uCloudCover: { value: 0.35 }, uCloudOffset: { value: new THREE.Vector2() },
    uCapture: { value: 0 },                 // 1 while an environment map is captured: no discs
    // stars.js reads these three
    uEq: { value: new THREE.Matrix3() }, uStarVis: { value: 0 }, uStarGain: { value: 0.3 },
  };
}

// The air (scattering of Sun and Moon light, airglow, the ground below the horizon) depends only on the view
// direction and on uniforms that change in setTime, so createSkyLut bakes it once per setTime into two small
// direction tables (colour + ground flag, transmittance); the dome then reads them instead of marching 16 steps
// per pixel twice (1.4-1.5 ms of a 12-13 ms frame at 2880x1800, measured). Without a table it marches as before.
// Table layout: u = world azimuth (wraps), v = elevation, squeezed toward the horizon where the sky changes fastest.
const LUT_GLSL = /* glsl */ `
uniform sampler2D tSkyCol, tSkyTr;
vec2 mgSkyUV(vec3 d){
  float el = asin(clamp(d.y, -1.0, 1.0));
  return vec2(atan(d.z, d.x) / (2.0 * MG_PI) + 0.5, 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * MG_PI)));
}
vec3 mgSkyDir(vec2 uv){
  float az = (uv.x - 0.5) * 2.0 * MG_PI, t = 2.0 * uv.y - 1.0, el = sign(t) * t * t * 0.5 * MG_PI;
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
vec3 mgSkyAir(vec3 d, vec3 L, out vec3 tr, out float hit){
  vec3 col = mgScatter(d, L, uSunI, ${ATMO.ms}, tr, hit);
  if (uMoonI > 0.0) { vec3 t2; float h2; col += mgScatter(d, normalize(uMoonDir), uMoonI, ${ATMO.ms}, t2, h2); }
  col += uNightGlow * (0.6 + 0.8 * pow(1.0 - abs(d.y), 3.0));   // airglow: emitted inside the air, not behind it
  // the ground below the horizon: dark, lit by the light that reaches it
  col += hit * tr * vec3(0.05, 0.045, 0.04) * (uSunI * 0.05 * max(L.y, 0.0) + 0.002);
  return col;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uNightGlow;
uniform float uSunI, uMoonI, uMoonDisc, uMoonR, uCloudCover, uCapture;
uniform vec2 uCloudOffset;
varying vec3 vDir;
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
${LUT_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 L = normalize(uSunDir);
  vec3 tr; float hit;
#ifdef MG_SKY_LUT
  vec2 luv = mgSkyUV(d);
  vec4 S = texture2D(tSkyCol, luv);
  vec3 col = S.rgb; hit = S.a; tr = texture2D(tSkyTr, luv).rgb;
#else
  vec3 col = mgSkyAir(d, L, tr, hit);
#endif
  if (uCapture < 0.5 && hit < 0.5) {
    // sun disc (0.27 deg) with limb darkening
    float a = acos(clamp(dot(d, L), -1.0, 1.0)), R = 0.0047;
    float disc = 1.0 - smoothstep(R - fwidth(a), R, a);
    col += disc * tr * uSunI * 1500.0 * (0.4 + 0.6 * sqrt(max(1.0 - (a / R) * (a / R), 0.0)));
    // the Moon: a sphere lit from the Sun's direction (phase), mottled maria
    vec3 M = normalize(uMoonDir);
    float cm = dot(d, M);
    if (uMoonDisc > 0.0 && cm > cos(uMoonR * 1.2)) {
      vec3 q = (d - M * cm) / sin(uMoonR);
      float r2 = dot(q, q);
      float inside = 1.0 - smoothstep(1.0 - 2.0 * fwidth(r2), 1.0, r2);
      vec3 n = q - M * sqrt(max(1.0 - r2, 0.0));
      float lit = smoothstep(-0.03, 0.05, dot(n, L));
      float maria = 0.72 + 0.28 * smoothstep(-0.2, 0.4, mgFbm2(q.xy * 2.3 + 4.0, 4));
      col += inside * tr * uMoonDisc * maria * (lit + 0.004);
    }
  }
  // clouds: one layer at 2.5 km, coverage from fractal noise, lit through the atmosphere
  if (d.y > 0.01 && uCloudCover > 0.0) {
    vec2 p = d.xz / d.y * 2.5 + uCloudOffset;             // km on the layer
    float n = mgFbm2(p * 0.42, 5) * 0.5 + 0.5;
    float den = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);
    if (den > 0.001) {
      vec3 CL = uSunI > 0.0 ? L : normalize(uMoonDir);
      float I = uSunI > 0.0 ? uSunI : uMoonI;
      float toward = mgFbm2((p + CL.xz * 0.25) * 0.42, 4) * 0.5 + 0.5;
      float shade = exp(-2.2 * smoothstep(1.0 - uCloudCover, 1.0, toward));
      vec3 tl = mgTransmit(MG_RG + 2500.0, CL.y, 1.0);
      float nu = dot(d, CL);
      float ph = mix(mgPhaseM(nu, 0.6), 1.0 / (4.0 * MG_PI), 0.5);
      vec3 lit = tl * I * (0.25 * ph * (0.25 + 0.75 * shade) + 0.012 * shade);
      vec3 amb = col * 0.55 + uNightGlow * 0.5;
      vec3 cc = lit + amb;
      float alpha = den * smoothstep(0.01, 0.12, d.y) * 0.92;
      col = mix(col, mix(col, cc, exp(-length(d.xz / d.y) * 0.05)), alpha);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.999999; }',
    fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  if (uniforms.tSkyCol && uniforms.tSkyCol.value) mat.defines = { MG_SKY_LUT: '' };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = 1000;   // after opaques: only uncovered pixels pay for the sky
  sky.onBeforeRender = (r, s, cam) => { sky.position.setFromMatrixPosition(cam.matrixWorld); sky.updateMatrixWorld(); };
  return sky;
}

/** Bake the air of the sky dome into two direction tables (see LUT_GLSL) and point `uniforms` at them. Call before
 *  createSky(uniforms); call bake() whenever the Sun, Moon or night glow uniforms change (world.setTime does). */
export function createSkyLut(renderer, uniforms, { width = 512, height = 256 } = {}) {
  const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping };
  const col = new THREE.WebGLRenderTarget(width, height, opts), tr = new THREE.WebGLRenderTarget(width, height, opts);
  uniforms.tSkyCol = { value: col.texture };
  uniforms.tSkyTr = { value: tr.texture };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uOut: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec3 uSunDir, uMoonDir, uNightGlow;
      uniform float uSunI, uMoonI, uOut;
      varying vec2 vUv;
      ${ATMOSPHERE_GLSL}
      ${LUT_GLSL}
      void main(){
        vec3 tr; float hit;
        vec3 c = mgSkyAir(mgSkyDir(vUv), normalize(uSunDir), tr, hit);
        gl_FragColor = uOut < 0.5 ? vec4(c, hit) : vec4(tr, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(mat);
  return {
    bake() {
      const saved = renderer.getRenderTarget(), xr = renderer.xr && renderer.xr.enabled;
      if (renderer.xr) renderer.xr.enabled = false;
      for (const [k, t] of [[0, col], [1, tr]]) { mat.uniforms.uOut.value = k; renderer.setRenderTarget(t); quad.render(renderer); }
      renderer.setRenderTarget(saved);
      if (renderer.xr) renderer.xr.enabled = xr;
    },
    dispose() { col.dispose(); tr.dispose(); mat.dispose(); quad.dispose(); },
  };
}

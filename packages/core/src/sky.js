// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { ATMO, ATMOSPHERE_GLSL } from './atmosphere.js';

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

const FRAG = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uNightGlow;
uniform float uSunI, uMoonI, uMoonDisc, uMoonR, uCloudCover, uCapture;
uniform vec2 uCloudOffset;
varying vec3 vDir;
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 L = normalize(uSunDir);
  vec3 tr; float hit;
  vec3 col = mgScatter(d, L, uSunI, ${ATMO.ms}, tr, hit);
  if (uMoonI > 0.0) { vec3 t2; float h2; col += mgScatter(d, normalize(uMoonDir), uMoonI, ${ATMO.ms}, t2, h2); }
  col += uNightGlow * (0.6 + 0.8 * pow(1.0 - abs(d.y), 3.0));   // airglow: emitted inside the air, not behind it
  // the ground below the horizon: dark, lit by the light that reaches it
  col += hit * tr * vec3(0.05, 0.045, 0.04) * (uSunI * 0.05 * max(L.y, 0.0) + 0.002);
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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = 1000;   // after opaques: only uncovered pixels pay for the sky
  sky.onBeforeRender = (r, s, cam) => { sky.position.setFromMatrixPosition(cam.matrixWorld); sky.updateMatrixWorld(); };
  return sky;
}

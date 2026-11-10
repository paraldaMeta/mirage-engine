// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LampShadows, LS_SHARED, LS_N, VOL_LAMPS, lampShadowsIdle } from './light2.js';
import { AMBIENT_GLSL } from './env.js';

// ---------------------------------------------------------------------------
// The frame pipeline. A frame is the weighted average of `spp` sub-frames; the caller moves the camera
// (sub-pixel offset, shutter time) and the sun (a point on the solar disc) between them, so the average gives
// anti-aliasing, motion blur and soft shadows, and SSAO (its kernel rotated per sub-frame) comes out clean.
//
//   const pp = new Pipeline(renderer, { width, height, msaa, aoSamples });
//   pp.begin();  for k: pp.add(scene, camera, weight, k, post);  pp.end(post, frameIndex, target?)
//
// per sub-frame: scene -> HDR (RGBA16F, MSAA, depth texture) -> SSAO (half res, from depth) -> acc += w·c·ao
// per frame:     bloom (three's UnrealBloomPass, over the HDR sum) -> grade (exposure, white balance,
//                three's AgX / ACES tone map, saturation, contrast, vignette, sharpening, grain + dither)
// Every per-pixel pattern depends on the sub-frame index k only (never on the frame number), except grain and
// dither, which are seeded by `frameIndex` (pass a constant to make still frames bit-identical).
//
// light2 (opt-in, light2.js; pp.useLight2(cfg, { sun, G })): lamp shadows drawn inside the scene render, then per
// sub-frame screen-space reflections and volumetric light (half resolution, jittered by the index `jk` that add()
// receives), mixed in by the accumulation; per frame the bloom is mixed in instead of added.
// ---------------------------------------------------------------------------

export const DEFAULT_POST = {
  exposure: 0.4, temperature: 0, saturation: 1.08, contrast: 1.0, lift: 0, vignette: 0.28,
  tonemap: 'aces', sharpen: 0.2, grain: 0.012,
  bloom: 0.08, bloomRadius: 0.55,
  ao: 0.8, aoRadius: 0.9, aoPower: 1.3,
  aoLit: 0,            // 0..1: fade the AO out on brightly lit pixels (occlusion belongs to ambient light), 0 = off
  autoExposure: 0,     // 0..1: how far the eye adapts toward aeKey (log2 space), 0 = off; see end()
  // auto exposure: aeKey = the target log-mean of the exposed luminance by day (hello-courtyard's views average about
  // 0.07), aeNight = how many EV lower the target sits at full lamp level (night stays night), aeRange = the largest
  // correction either way (EV), aeUp / aeDown = adaptation rates (1/s) when brightening / darkening
  aeKey: 0.07, aeNight: 1, aeRange: 1, aeUp: 1.0, aeDown: 2.5,
  sky: 1,              // multiplier for sky pixels (nothing drawn), applied per sub-frame
  dof: 0, focus: 8,    // depth of field: lens radius (m, 0 = off) and focus distance (m); needs spp > 1
};

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quadMat = (fs, uniforms, extra) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });

// view-space position from depth (perspective or orthographic: through the inverse projection)
const VIEWPOS = /* glsl */ `
uniform sampler2D tDepth; uniform mat4 uInvProj;
vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }`;

export class Pipeline {
  constructor(renderer, { width, height, msaa = 4, aoSamples = 12 }) {
    this.r = renderer;
    this.msaa = msaa;
    this.quad = new FullScreenQuad();
    this.ao = quadMat(/* glsl */ `
      varying vec2 vUv; uniform vec2 uTexel; uniform float uRadius, uPower, uK; uniform mat4 uProj;
      ${VIEWPOS}
      void main(){
        if (texture2D(tDepth, vUv).x >= 1.0) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(vUv);
        vec3 N = normalize(cross(dFdx(P), dFdy(P)));
        // rotation: a 4x4 interleaved pattern plus a step per sub-frame (golden ratio), nothing else
        vec2 px = floor(gl_FragCoord.xy);
        float bayer = mod(px.x * 0.25 + mod(px.y, 4.0) * 0.5625 + mod(floor(px.x * 0.5) + floor(px.y * 0.5), 2.0) * 0.375, 1.0);
        float rot = 6.2831853 * fract(bayer + uK * 0.618034);
        vec3 T = normalize(cross(N, abs(N.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0))), B = cross(N, T);
        float occ = 0.0;
        const int NS = ${aoSamples};
        for (int i = 0; i < NS; i++){
          float u = (float(i) + 0.5) / float(NS);
          float a = rot + float(i) * 2.3999632;
          float rr = sqrt(1.0 - u);
          vec3 k = (T * cos(a) * rr + B * sin(a) * rr + N * sqrt(u)) * uRadius * mix(0.15, 1.0, u * u);
          vec4 c = uProj * vec4(P + k, 1.0);
          vec2 q = c.xy / c.w * 0.5 + 0.5;
          float z = viewPos(q).z;
          float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - z), 1e-3));
          occ += step(P.z + k.z + 0.02 + 0.002 * -P.z, z) * range;
        }
        gl_FragColor = vec4(vec3(pow(clamp(1.0 - occ / float(NS), 0.0, 1.0), uPower)), 1.0);
      }`, { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uPower: { value: 1 }, uK: { value: 0 } });
    // accumulate, with a 4x4 depth-aware blur of the AO (it removes the interleaved pattern)
    this.acc = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor, tAO; uniform vec2 uAOTexel; uniform float uW, uAO, uSky, uAOLit, uAOExp;
      uniform sampler2D tSSR, tVol; uniform float uUseSSR, uUseVol; uniform vec2 uVolTexel;
      ${VIEWPOS}
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb;
        bool sky = texture2D(tDepth, vUv).x >= 1.0;
        if (sky) c *= uSky;
        else if (uAO > 0.0) {
          float z0 = viewPos(vUv).z, s = 0.0, w = 0.0;
          for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++){
            vec2 q = vUv + (vec2(x, y) + 0.5) * uAOTexel;
            float wz = exp(-abs(viewPos(q).z - z0) / (0.03 * abs(z0) + 0.05));
            s += texture2D(tAO, q).r * wz; w += wz;
          }
          float o = s / max(w, 1e-4);
          // aoLit: occlusion belongs to ambient light; a brightly lit pixel (exposed luminance; sunlit plaster sits at
          // about 0.25-0.5, shade at 0.05-0.2) is mostly direct light, so fade the darkening there (no dirty halos in sun)
          if (uAOLit > 0.0) o = mix(o, 1.0, uAOLit * smoothstep(0.1, 0.32, dot(c, vec3(0.2126, 0.7152, 0.0722)) * uAOExp));
          c *= mix(1.0, o, uAO);
        }
        if (uUseSSR > 0.5) {
          // light2: toward the screen-space reflection where it hit (premultiplied: bilinear up-sampling keeps the colour)
          vec4 r = texture2D(tSSR, vUv);
          if (r.a > 0.001) c = mix(c, r.rgb / r.a, min(r.a, 1.0));
        }
        if (uUseVol > 0.5) {
          // light2: the half-resolution in-scatter, a small cross filter
          vec3 v = texture2D(tVol, vUv).rgb * 0.4;
          v += (texture2D(tVol, vUv + vec2(uVolTexel.x, 0.0)).rgb + texture2D(tVol, vUv - vec2(uVolTexel.x, 0.0)).rgb
              + texture2D(tVol, vUv + vec2(0.0, uVolTexel.y)).rgb + texture2D(tVol, vUv - vec2(0.0, uVolTexel.y)).rgb) * 0.15;
          c += v;
        }
        if (any(isnan(c))) c = vec3(0.0);
        gl_FragColor = vec4(min(c, vec3(32000.0)) * uW, uW);
      }`, { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uAOTexel: { value: new THREE.Vector2() }, uW: { value: 1 }, uAO: { value: 0 }, uSky: { value: 1 }, uAOLit: { value: 0 }, uAOExp: { value: 1 },
      tSSR: { value: null }, tVol: { value: null }, uUseSSR: { value: 0 }, uUseVol: { value: 0 }, uVolTexel: { value: new THREE.Vector2() } },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
    this.grade = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel;
      uniform float uExposure, uSat, uCon, uLift, uVig, uSharp, uGrain, uFrame, uTM; uniform vec3 uWB;
      uniform sampler2D tAE; uniform float uUseAE;
      #include <tonemapping_pars_fragment>
      float h3(vec3 p){ uvec3 v = floatBitsToUint(p) * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; return float(v.x) / 4294967296.0; }
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb;
        vec3 n = texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb
               + texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb;
        c = max(c + uSharp * clamp(c - n * 0.25, -0.5 * c, 0.5 * c), 0.0);   // limited: no halos on hot edges
        c *= uExposure * uWB;
        if (uUseAE > 0.5) c *= exp2(texture2D(tAE, vec2(0.5)).r);   // auto exposure: the adapted EV (end())
        c = uTM < 0.5 ? AgXToneMapping(c) : uTM < 1.5 ? ACESFilmicToneMapping(c) : NeutralToneMapping(c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l), c, uSat), 0.0);
        c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
        c = c + uLift * (1.0 - c);
        vec2 v = vUv - 0.5;
        c *= 1.0 - uVig * smoothstep(0.1, 0.8, dot(v, v) * 2.0);
        vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;
        float g = h3(vec3(gl_FragCoord.xy, uFrame)) + h3(vec3(gl_FragCoord.yx * 0.5, uFrame + 7.0)) - 1.0;
        o += g * uGrain * (1.0 - 0.6 * o) + (h3(vec3(gl_FragCoord.xy, uFrame + 13.0)) - 0.5) / 255.0;
        gl_FragColor = vec4(o, 1.0);
      }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uSat: { value: 1 }, uCon: { value: 1 }, uLift: { value: 0 }, uVig: { value: 0 }, uSharp: { value: 0 }, uGrain: { value: 0 }, uFrame: { value: 0 }, uTM: { value: 0 }, uWB: { value: new THREE.Vector3(1, 1, 1) },
      tAE: { value: null }, uUseAE: { value: 0 } });
    // auto exposure (opt-in, P.autoExposure): meter the frame into a 32 x 18 grid of centre-weighted log luminances,
    // reduce it to one EV and adapt toward it (all on the GPU: no read-back). A still frame is metered on its own
    // (no history), so it stays bit-identical; while moving the EV eases in log space, slower when brightening.
    this.meterMat = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uCell; uniform float uExp;
      void main(){
        float s = 0.0;
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++){
          vec3 c = texture2D(tColor, vUv + (vec2(x, y) - 1.5) * 0.25 * uCell).rgb;
          s += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExp, 1e-4));
        }
        vec2 d = (vUv - 0.5) * vec2(1.6, 1.0);
        float w = exp(-4.0 * dot(d, d)) + 0.05;   // centre-weighted, the edges still count a little
        gl_FragColor = vec4(s / 16.0 * w, w, 0.0, 1.0);
      }`, { tColor: { value: null }, uCell: { value: new THREE.Vector2() }, uExp: { value: 1 } });
    this.adaptMat = quadMat(/* glsl */ `
      uniform sampler2D tMeter, tPrev; uniform float uKey, uStrength, uRange, uUp, uDown, uDt, uReset;
      void main(){
        float s = 0.0, w = 0.0;
        for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++){
          vec2 m = texture2D(tMeter, (vec2(x, y) + 0.5) / vec2(32.0, 18.0)).rg; s += m.x; w += m.y;
        }
        float ev = clamp(uStrength * (log2(uKey) - s / max(w, 1e-6)), -uRange, uRange);
        float prev = texture2D(tPrev, vec2(0.5)).r;
        // a reset takes ev exactly (mix(prev, ev, 1) is not exact on every GPU, and prev may be garbage); a non-finite
        // result never reaches the history, or one bad frame would black the image out for good
        float v = uReset > 0.5 || isnan(prev) || isinf(prev) ? ev : mix(prev, ev, 1.0 - exp(-uDt * (ev > prev ? uUp : uDown)));
        if (isnan(v) || isinf(v)) v = 0.0;
        gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
      }`, { tMeter: { value: null }, tPrev: { value: null }, uKey: { value: 0.2 }, uStrength: { value: 0 }, uRange: { value: 1.5 }, uUp: { value: 1 }, uDown: { value: 2.5 }, uDt: { value: 1 / 60 }, uReset: { value: 1 } });
    const small = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.meterRT = small(32, 18); this.aeA = small(1, 1); this.aeB = small(1, 1); this.aeValid = false;
    // temporal AA for a moving camera (one jittered sub-frame per frame): the history is reprojected through the
    // depth buffer and clipped to the new frame's 3x3 neighbourhood (mean +- 1.25 sigma), in a compressed range
    // so one hot pixel cannot dominate. ponytail: static-scene reprojection (no motion vectors), bilinear
    // history; wind-blown leaves rely on the clip. Add velocity buffers when things move fast on screen.
    this.taaMat = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tCur, tHist, tDepth; uniform mat4 uInvVP, uPrevVP; uniform vec2 uTexel; uniform float uAlpha;
      vec3 squash(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
      vec3 unsquash(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
      void main(){
        vec3 cur = squash(texture2D(tCur, vUv).rgb), m1 = vec3(0.0), m2 = vec3(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
          vec3 c = squash(texture2D(tCur, vUv + vec2(x, y) * uTexel).rgb); m1 += c; m2 += c * c;
        }
        m1 /= 9.0; vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
        vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, texture2D(tDepth, vUv).x * 2.0 - 1.0, 1.0);
        vec4 pc = uPrevVP * vec4(w.xyz / w.w, 1.0);
        vec2 q = pc.xy / pc.w * 0.5 + 0.5;
        vec3 h = clamp(squash(texture2D(tHist, q).rgb), m1 - 1.25 * sd, m1 + 1.25 * sd);
        float a = any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0))) ? 1.0 : uAlpha;
        gl_FragColor = vec4(unsquash(mix(h, cur, a)), 1.0);
      }`, { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uAlpha: { value: 1 } });
    this.copyMat = quadMat('varying vec2 vUv; uniform sampler2D tColor; void main(){ gl_FragColor = texture2D(tColor, vUv); }', { tColor: { value: null } });
    this.blendMat = quadMat('varying vec2 vUv; uniform sampler2D tA, tB; uniform float uT; void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uT); }', { tA: { value: null }, tB: { value: null }, uT: { value: 0 } });
    this.setSize(width, height);
  }

  /** light2 (light2.js): cfg = light2Config(...), ctx = { sun: DirectionalLight, G: the world's uniforms }. */
  useLight2(cfg, { sun, G }) {
    if (this.l2 || !cfg) return;
    const lamps = new LampShadows(this.r, cfg.ls, () => G.uLamp.value, G);   // cfg.ls.on is read live
    this.l2 = { cfg, sun, G, lamps, ssrMat: this._ssrMat(), volMat: this._volMat(G) };
    this._l2Targets();
  }

  _l2Targets() {
    for (const t of [this.ssrRT, this.volRT]) t && t.dispose();
    const hw = Math.ceil(this.rw / 2), hh = Math.ceil(this.rh / 2);
    this.ssrRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.volRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
  }

  // screen-space reflections: smooth opaque surfaces mark their reflectance in the scene target's alpha (light2.js);
  // the view-space ray is marched against this sub-frame's depth (24 growing steps + 6 of refinement); the hit's
  // colour comes from this sub-frame; misses keep the material's own environment reflection
  _ssrMat() {
    return quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform mat4 uProj; uniform vec2 uRes;
      uniform float uJ, uMaxDist, uThick, uGain, uNear;
      ${VIEWPOS}
      vec2 proj(vec3 p){ vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
      void main(){
        float w = clamp(-texture2D(tColor, vUv).a, 0.0, 1.0);   // -reflectance (light2.js); >= 0 everywhere else
        if (w < 0.02) { gl_FragColor = vec4(0.0); return; }
        if (texture2D(tDepth, vUv).x >= 1.0) { gl_FragColor = vec4(0.0); return; }
        vec3 P = viewPos(vUv);
        vec2 px = 1.0 / uRes;
        vec3 pr = viewPos(vUv + vec2(px.x, 0.0)), pl = viewPos(vUv - vec2(px.x, 0.0));
        vec3 pu = viewPos(vUv + vec2(0.0, px.y)), pd = viewPos(vUv - vec2(0.0, px.y));
        vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
        vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
        vec3 N = normalize(cross(dx, dy));
        vec3 R = reflect(normalize(P), N);
        if (R.z > 0.6) { gl_FragColor = vec4(0.0); return; }   // toward the camera: leaves the screen at once
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uJ * 0.618034);
        float t = 0.0, tPrev = 0.0, stepL = max(0.04, -P.z * 0.012);
        vec3 O = P + N * (0.01 - P.z * 0.002), Q; vec2 uv; bool hit = false;
        for (int i = 0; i < 24; i++){
          tPrev = t; t += stepL * (1.0 + jit * 0.5); stepL *= 1.22;
          if (t > uMaxDist) break;
          Q = O + R * t;
          if (Q.z > -uNear) break;
          uv = proj(Q);
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
          if (viewPos(uv).z - Q.z > 0.0) { hit = true; break; }
        }
        if (!hit) { gl_FragColor = vec4(0.0); return; }
        float t0 = tPrev, t1 = t;
        for (int i = 0; i < 6; i++){
          float tm = 0.5 * (t0 + t1); vec3 Qm = O + R * tm;
          if (viewPos(proj(Qm)).z - Qm.z > 0.0) t1 = tm; else t0 = tm;
        }
        Q = O + R * t1; uv = proj(Q);
        // a thick crossing is a ray passing behind an object, not a hit
        if (viewPos(uv).z - Q.z > uThick + 0.03 * t1 || texture2D(tDepth, uv).x >= 1.0) { gl_FragColor = vec4(0.0); return; }
        vec3 c = texture2D(tColor, uv).rgb;
        vec2 e = smoothstep(0.0, 0.08, uv) * smoothstep(0.0, 0.08, 1.0 - uv);
        float wa = w * e.x * e.y * (1.0 - smoothstep(uMaxDist * 0.6, uMaxDist, t1)) * (1.0 - smoothstep(0.2, 0.6, R.z)) * uGain;
        gl_FragColor = vec4(min(c, vec3(1000.0)) * wa, wa);
      }`, {
      tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2() }, uJ: { value: 0 }, uMaxDist: { value: 30 }, uThick: { value: 0.35 }, uGain: { value: 1 }, uNear: { value: 0.1 },
    });
  }

  _ssr(camera, jk) {
    const S = this.l2.cfg.ssr;
    if (!S.on || camera.isOrthographicCamera) return false;
    const u = this.l2.ssrMat.uniforms;
    u.tColor.value = this.sceneRT.texture; u.tDepth.value = this.sceneRT.depthTexture;
    u.uProj.value.copy(camera.projectionMatrix); u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uRes.value.set(this.ssrRT.width, this.ssrRT.height); u.uNear.value = camera.near;
    u.uJ.value = jk; u.uMaxDist.value = S.maxDist; u.uThick.value = S.thick; u.uGain.value = S.gain;
    this._draw(this.l2.ssrMat, this.ssrRT);
    return true;
  }

  // volumetric in-scatter of the key light (through its shadow map) and of the best lamps (through the lamp atlas) in
  // a thin dust medium: a low layer outdoors, denser inside the ambient volumes. Shafts only: outdoors, the share of
  // the dust the march finds in shadow decides how much shows, so an open, wholly lit ray lays no veil.
  _volMat(G) {
    const NL = VOL_LAMPS;
    return quadMat(/* glsl */ `
      precision highp sampler2DShadow;
      varying vec2 vUv;
      uniform sampler2DShadow tShadow; uniform float uHasShadow; uniform mat4 uShadowMatrix;
      uniform mat4 uCamWorld; uniform vec3 uCamPos, uSunDir, uSunCol;
      uniform float uJ, uMaxDist, uTime;
      uniform vec4 uMed;      // x outdoor dust at the floor (1/m), y its scale height (m), z indoor dust (1/m), w floor y
      uniform vec4 uMed2;     // x lamp gain, y key gain, z noise, w key phase g
      uniform vec4 uMed3;     // x dust round a flame, y 1 / its radius^2, z the lamps' march radius (m)
      uniform vec4 uLp[${NL}];   // lamp xyz, range
      uniform vec4 uLc[${NL}];   // lamp colour x intensity, slot + 1 (0: none)
      uniform sampler2DShadow tLs; uniform vec4 uLsPos[${LS_N}]; uniform vec4 uLsInfo; uniform vec4 uLsNear;
      uniform float uAmbN; uniform vec4 uAmbLo[${G.uAmbLo.value.length}]; uniform vec4 uAmbHi[${G.uAmbHi.value.length}];
      ${VIEWPOS}
      ${AMBIENT_GLSL}
      float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      float vnoise(vec3 p){
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float n = i.x + i.y * 57.0 + i.z * 113.0;
        vec4 h = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
        vec4 h2 = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
        vec4 a = mix(h, h2, f.z); vec2 b = mix(a.xz, a.yw, f.x);
        return mix(b.x, b.y, f.y);
      }
      // indoor-ness: how much an ambient volume dims the sky at p
      float indoor(vec3 p){ return uAmbN > 0.0 ? clamp((1.0 - mgAmbient(p)) * 1.6, 0.0, 1.0) : 0.0; }
      float gFloor;
      float noiseK(vec3 p){ return uMed2.z > 0.0 ? 1.0 - uMed2.z + uMed2.z * 2.0 * vnoise(p * 0.7 + vec3(uTime * 0.11, uTime * 0.03, uTime * 0.07)) : 1.0; }
      float dustOut(vec3 p){ return uMed.x * exp(-max(p.y - gFloor, 0.0) / uMed.y); }
      float dens(vec3 p, float ind){ return (dustOut(p) + uMed.z * ind) * noiseK(p); }
      vec2 octE(vec3 d){
        d /= abs(d.x) + abs(d.y) + abs(d.z);
        vec2 o = d.xz;
        if (d.y > 0.0) o = (1.0 - abs(o.yx)) * vec2(o.x >= 0.0 ? 1.0 : -1.0, o.y >= 0.0 ? 1.0 : -1.0);
        return o * 0.5 + 0.5;
      }
      float lsVis(int s, vec3 p){
        vec4 L = uLsPos[s];
        if (L.w <= 0.0) return 1.0;
        vec3 v = p - L.xyz; float d = length(v);
        float ref = (d - uLsNear[s]) / (L.w - uLsNear[s]) - 0.004;
        if (ref >= 1.0) return 1.0;
        vec2 t = clamp(octE(v / d), vec2(uLsInfo.w * 1.5), vec2(1.0 - uLsInfo.w * 1.5));
        float cols = 1.0 / uLsInfo.y;
        vec2 base = vec2(mod(float(s), cols), floor(float(s) / cols));
        return texture(tLs, vec3((base + t) * uLsInfo.yz, ref));
      }
      void main(){
        bool sky = texture2D(tDepth, vUv).x >= 1.0;
        vec3 vpos;
        if (sky) { vec4 v4 = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vpos = v4.xyz / v4.w; }   // the far plane
        else vpos = viewPos(vUv);
        vec3 wpos = (uCamWorld * vec4(vpos, 1.0)).xyz;
        vec3 ray = wpos - uCamPos;
        float dist = length(ray);
        vec3 dir = ray / dist;
        // per-pixel noise + an 8-step cycle by the sub-frame (the accumulation / temporal AA averages it)
        float jit = fract(ign(gl_FragCoord.xy) + mod(uJ, 8.0) * 0.618034);
        gFloor = sky ? uMed.w : min(uMed.w, wpos.y);
        float hEye = max(uCamPos.y - gFloor - 1.6, 0.0);   // an eye high above the floor sees less of the layer
        vec3 acc = vec3(0.0);
        if (uMed2.y > 0.0) {
          float L = min(dist, uMaxDist);
          const int N = 16;
          float dt = L / float(N);
          float i0 = indoor(uCamPos), i1 = indoor(uCamPos + dir * L * 0.33), i2 = indoor(uCamPos + dir * L * 0.67), i3 = indoor(uCamPos + dir * L);
          float sOut = 0.0, sOutAll = 0.0, sIn = 0.0;
          for (int i = 0; i < N; i++){
            float f = (float(i) + jit) / float(N);
            vec3 p = uCamPos + dir * (f * L);
            float vis = 1.0;
            if (uHasShadow > 0.5) {
              vec4 sc = uShadowMatrix * vec4(p, 1.0);
              if (all(greaterThan(sc.xyz, vec3(0.0))) && all(lessThan(sc.xyz, vec3(1.0)))) vis = texture(tShadow, vec3(sc.xy, sc.z - 0.0004));
            }
            float g3 = f * 3.0;
            float ind = g3 < 1.0 ? mix(i0, i1, g3) : g3 < 2.0 ? mix(i1, i2, g3 - 1.0) : mix(i2, i3, g3 - 2.0);
            float nk = noiseK(p);
            float dO = dustOut(p) * nk * (1.0 - ind);
            sOut += dO * vis * dt; sOutAll += dO * dt;
            sIn += uMed.z * ind * nk * vis * dt;
          }
          float occl = 1.0 - sOut / max(sOutAll, 1e-6);           // share of the outdoor dust in shadow
          float s = sIn + sOut * smoothstep(0.06, 0.35, occl);
          float mu = dot(dir, uSunDir), g = uMed2.w;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 12.566;
          acc += uSunCol * s * mix(0.0796, hg, 0.75) * uMed2.y / (1.0 + hEye * hEye / 144.0);
        }
        if (uMed2.x > 0.0) {
          for (int j = 0; j < ${NL}; j++){
            vec4 Lp = uLp[j];   // w: the march radius (min of the lamp's range and uMed3.z)
            if (Lp.w <= 0.0) continue;
            vec3 oc = uCamPos - Lp.xyz;
            float b = dot(oc, dir), c = dot(oc, oc) - Lp.w * Lp.w;
            float h = b * b - c;
            if (h <= 0.0) continue;
            h = sqrt(h);
            float t0 = max(-b - h, 0.0), t1 = min(-b + h, dist);
            if (t1 <= t0) continue;
            const int M = 8;
            float dt = (t1 - t0) / float(M);
            int slot = int(uLc[j].w + 0.5) - 1;
            // indoor-ness and the drifting noise once per lamp (at the segment's middle), the layer per step
            vec3 pm = uCamPos + dir * (0.5 * (t0 + t1));
            float indL = indoor(pm), nkL = noiseK(pm), sl = 0.0;
            for (int i = 0; i < M; i++){
              vec3 p = uCamPos + dir * (t0 + (float(i) + jit) * dt);
              vec3 v = p - Lp.xyz; float d2 = dot(v, v);
              float win = 1.0 - d2 / (Lp.w * Lp.w); win *= win;
              float vis = slot >= 0 ? lsVis(slot, p) : 1.0;
              sl += ((dustOut(p) + uMed.z * indL) * nkL + uMed3.x * exp(-d2 * uMed3.y)) * win * vis / (d2 + 0.04) * dt;
            }
            acc += uLc[j].rgb * sl * 0.0796 * uMed2.x;
          }
        }
        if (any(isnan(acc)) || any(isinf(acc))) acc = vec3(0.0);
        gl_FragColor = vec4(min(acc, vec3(200.0)), 1.0);
      }`, {
      tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() },
      tShadow: { value: null }, uHasShadow: { value: 0 }, uShadowMatrix: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Vector3() }, uJ: { value: 0 }, uMaxDist: { value: 60 }, uTime: { value: 0 },
      uMed: { value: new THREE.Vector4() }, uMed2: { value: new THREE.Vector4() }, uMed3: { value: new THREE.Vector4() },
      uLp: { value: Array.from({ length: NL }, () => new THREE.Vector4()) }, uLc: { value: Array.from({ length: NL }, () => new THREE.Vector4()) },
      tLs: { value: null }, uLsPos: { value: LS_SHARED.pos }, uLsInfo: { value: LS_SHARED.info }, uLsNear: { value: LS_SHARED.near },
      uAmbN: G.uAmbN, uAmbLo: G.uAmbLo, uAmbHi: G.uAmbHi,
    });
  }

  _vol(camera, jk) {
    const { cfg, sun, G, lamps } = this.l2, V = cfg.vol;
    if (!V.on || camera.isOrthographicCamera) return false;
    const top = lamps ? lamps.top : [];
    const kd = G.uKeyDir.value, kc = G.uKeyColor.value;
    // the key light's shafts are worth their march toward a low sun / moon, or when the eye is near a room, vault
    // or arcade (an ambient volume); a high sun over open ground makes none
    const low = THREE.MathUtils.smoothstep(0.45 - kd.y, 0.0, 0.37) * (1 - (G.uNight ? G.uNight.value : 0));
    const cp = (this._cp || (this._cp = new THREE.Vector3())).setFromMatrixPosition(camera.matrixWorld);
    const sm = sun && sun.castShadow && sun.intensity > 0 && sun.shadow.map && sun.shadow.map.depthTexture;
    const keyOn = V.sun > 0 && !!sm && kc.x + kc.y + kc.z > 1e-4 && (low > 0.02 || this._nearVolume(cp, G, V.nearRoom));
    if (!keyOn && !(V.lamps > 0 && top.length)) return false;
    const u = this.l2.volMat.uniforms;
    u.tDepth.value = this.sceneRT.depthTexture; u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uHasShadow.value = sm ? 1 : 0; u.tShadow.value = sm || null;
    if (sm) u.uShadowMatrix.value.copy(sun.shadow.matrix);
    u.uCamWorld.value.copy(camera.matrixWorld); u.uCamPos.value.copy(cp);
    u.uSunDir.value.copy(kd); u.uSunCol.value.copy(kc);
    u.uJ.value = jk; u.uTime.value = G.uTime.value; u.uMaxDist.value = V.maxDist;
    u.uMed.value.set(V.dustOut * (1 + V.golden * low), V.height, V.dustIn, cp.y - 1.6);
    u.uMed2.value.set(V.lamps, keyOn ? V.sun : 0, V.noise, V.g);
    u.uMed3.value.set(V.lampDust, 1 / (V.haloR * V.haloR), V.lampReach, 0);
    for (let j = 0; j < VOL_LAMPS; j++) {
      const q = top[j];
      if (q) { u.uLp.value[j].set(q.x, q.y, q.z, Math.min(q.range, V.lampReach)); u.uLc.value[j].set(q.col[0], q.col[1], q.col[2], (q.slotIdx ?? -1) + 1); }
      else u.uLp.value[j].set(0, -1e4, 0, 0);
    }
    u.tLs.value = LS_SHARED.atlas;
    this._draw(this.l2.volMat, this.volRT);
    return true;
  }

  // is p within d metres of an ambient volume?
  _nearVolume(p, G, d) {
    for (let i = 0; i < G.uAmbN.value; i++) {
      const lo = G.uAmbLo.value[i], hi = G.uAmbHi.value[i];
      const dx = Math.max(lo.x - p.x, 0, p.x - hi.x), dy = Math.max(lo.y - p.y, 0, p.y - hi.y), dz = Math.max(lo.z - p.z, 0, p.z - hi.z);
      if (dx * dx + dy * dy + dz * dz < d * d) return true;
    }
    return false;
  }

  /** The output size (w, h: what the caller sees, stable) and the render size (rw, rh = w, h x the render scale). */
  setSize(w, h) {
    this.w = w; this.h = h; this.renderScale = 1;
    this._alloc(w, h);
  }

  /** Dynamic resolution: render at s x the output size (stretched by the grade pass). Reallocates when it changes;
   *  w and h stay as they are. s = 1 renders at exactly the output size. */
  setRenderScale(s) {
    s = Number.isFinite(s) ? Math.min(1, Math.max(0.1, s)) : 1;
    const rw = s === 1 ? this.w : Math.max(16, Math.round(this.w * s)), rh = s === 1 ? this.h : Math.max(16, Math.round(this.h * s));
    this.renderScale = s;
    if (rw === this.rw && rh === this.rh) return false;
    this._alloc(rw, rh);
    return true;
  }

  _alloc(w, h) {
    this.rw = w; this.rh = h;
    for (const t of [this.sceneRT, this.aoRT, this.accRT, this.histA, this.histB, this.ssrRT, this.volRT]) t && t.dispose();
    this.ssrRT = this.volRT = null;
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.msaa, depthTexture });
    this.aoRT = new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { type: THREE.UnsignedByteType, depthBuffer: false });
    this.accRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.histA = this.accRT.clone(); this.histB = this.accRT.clone();
    if (this.bloomPass) this.bloomPass.setSize(w, h);
    else this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.5, 0);
    if (this.l2) this._l2Targets();
  }

  // autoClear off: renderer.render() would otherwise clear the target first, and the accumulation pass must add
  // to what the earlier sub-frames left (M1 cleared it, so a frame was only its last sub-frame times its weight)
  _draw(mat, target) {
    const ac = this.r.autoClear; this.r.autoClear = false;
    this.quad.material = mat; this.r.setRenderTarget(target); this.quad.render(this.r);
    this.r.autoClear = ac;
  }

  begin() {
    this.r.setRenderTarget(this.accRT);
    this.r.setClearColor(0x000000, 0);
    this.r.clear(true, false, false);
  }

  /** Render sub-frame k of the frame with weight w (weights of one frame sum to 1). */
  add(scene, camera, w, k, P, jk = k, still = false) {
    const r = this.r, l2 = this.l2;
    if (l2) l2.lamps.update(scene, camera, { k, still });
    else lampShadowsIdle();   // another world may have published its lamps into the page-global uniforms
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (l2) l2.lamps.done();
    const useAO = P.ao > 0;
    if (useAO) {
      const u = this.ao.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uProj.value.copy(camera.projectionMatrix);
      u.uRadius.value = P.aoRadius; u.uPower.value = P.aoPower; u.uK.value = k;
      this._draw(this.ao, this.aoRT);
    }
    const useSSR = !!l2 && this._ssr(camera, jk), useVol = !!l2 && this._vol(camera, jk);
    const a = this.acc.uniforms;
    a.uUseSSR.value = useSSR ? 1 : 0; a.uUseVol.value = useVol ? 1 : 0;
    if (l2) { a.tSSR.value = this.ssrRT.texture; a.tVol.value = this.volRT.texture; a.uVolTexel.value.set(0.75 / this.volRT.width, 0.75 / this.volRT.height); }
    a.tColor.value = this.sceneRT.texture; a.tAO.value = this.aoRT.texture; a.tDepth.value = this.sceneRT.depthTexture;
    a.uInvProj.value.copy(camera.projectionMatrixInverse); a.uAOTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    a.uW.value = w; a.uAO.value = useAO ? P.ao : 0; a.uSky.value = P.sky;
    a.uAOLit.value = useAO ? Math.min(1, Math.max(0, P.aoLit || 0)) : 0; a.uAOExp.value = P.exposure;
    this._draw(this.acc, this.accRT);
  }

  /** Temporal AA of the sub-frame just added: blend into the reprojected history (alpha = weight of the new frame). */
  taa(invVP, prevVP, alpha) {
    const u = this.taaMat.uniforms;
    u.tCur.value = this.accRT.texture; u.tHist.value = this.histA.texture; u.tDepth.value = this.sceneRT.depthTexture;
    u.uInvVP.value.copy(invVP); u.uPrevVP.value.copy(prevVP); u.uTexel.value.set(1 / this.rw, 1 / this.rh); u.uAlpha.value = alpha;
    this._draw(this.taaMat, this.histB);
    [this.histA, this.histB] = [this.histB, this.histA];
    // ponytail: one extra copy, because bloom adds into accRT in place and must never reach the history
    this.copyMat.uniforms.tColor.value = this.histA.texture;
    this._draw(this.copyMat, this.accRT);
  }

  /** Forget the adapted exposure: the next frame is metered on its own (a cut, a teleport). */
  resetExposure() { this.aeValid = false; }

  _meter(P, expo, { dt, still }) {
    const D = DEFAULT_POST, num = (v, d) => (Number.isFinite(v) ? v : d);
    // no dt: a caller that does not say it is moving gets a still frame (metered on its own, history-free)
    if (still === undefined) still = !Number.isFinite(dt);
    dt = num(dt, 1 / 60); expo = num(expo, 1);
    const m = this.meterMat.uniforms;
    m.tColor.value = this.accRT.texture; m.uCell.value.set(1 / 32, 1 / 18); m.uExp.value = expo;
    this._draw(this.meterMat, this.meterRT);
    const u = this.adaptMat.uniforms;
    u.tMeter.value = this.meterRT.texture; u.tPrev.value = this.aeA.texture;
    u.uKey.value = Math.max(1e-4, num(P.aeKey, D.aeKey)); u.uStrength.value = Math.min(1, num(P.autoExposure, 0)); u.uRange.value = Math.max(0, num(P.aeRange, D.aeRange));
    u.uUp.value = Math.max(0, num(P.aeUp, D.aeUp)); u.uDown.value = Math.max(0, num(P.aeDown, D.aeDown));
    u.uDt.value = Math.min(Math.max(dt, 0), 0.25); u.uReset.value = still || !this.aeValid ? 1 : 0;
    this._draw(this.adaptMat, this.aeB);
    [this.aeA, this.aeB] = [this.aeB, this.aeA];
    this.aeValid = true;   // a still frame's EV is its own (reset above); the next moving frame eases on from it
  }

  /** Bloom and grade the accumulated frame into `target` (null = the canvas). opts: { dt, still } for auto exposure:
   *  dt = the seconds since the last moving frame (the exposure eases), still = meter this frame on its own (stays
   *  bit-identical). Without dt the frame counts as still. */
  end(P, frameIndex = 0, target = null, opts = {}) {
    const useAE = P.autoExposure > 0;
    if (useAE) this._meter(P, P.exposure, opts);
    else this.aeValid = false;
    const b = this.bloomPass;
    // the mid-range factor of three's bloom composite (3 x the radius-mixed mip weights): the lift an additive
    // bloom of strength 1 gives a flat image
    const lift = 3 * [1.0, 0.8, 0.6, 0.4, 0.2].reduce((s, f) => s + f + (1.2 - 2 * f) * P.bloomRadius, 0);
    const B2 = this.l2 && this.l2.cfg.bloom.on && P.bloom > 0 ? this.l2.cfg.bloom : null;
    let expK = 1;
    if (B2) {
      // light2: mix toward the normalised blur (k by the lamp level) through constant-alpha blending, and raise the
      // exposure by what the additive bloom of P.bloom used to add, so the mid-tones stay
      const n = Math.min(1, Math.max(0, this.l2.G.uLamp.value));
      const k = Math.max(1e-4, B2.day + (B2.night - B2.day) * n);   // never exactly 0 (three skips blendColor then)
      // threshold below 0: three's high-pass otherwise drops pixels darker than 0.01, and mixing toward a blur that
      // lacks them would darken dusk and night
      b.strength = 1 / lift; b.radius = P.bloomRadius; b.threshold = -1;
      const m = b.blendMaterial;
      m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.ConstantAlphaFactor; m.blendDst = THREE.OneMinusConstantAlphaFactor; m.blendAlpha = k;
      b.render(this.r, null, this.accRT, 0, false);
      expK = 1 + Math.max(0, P.bloom) * lift;
    } else if (P.bloom > 0) {
      const m = b.blendMaterial;
      if (m.blending !== THREE.AdditiveBlending) m.blending = THREE.AdditiveBlending;
      b.strength = P.bloom; b.radius = P.bloomRadius; b.threshold = 0;
      b.render(this.r, null, this.accRT, 0, false);
    }
    const u = this.grade.uniforms;
    u.tColor.value = this.accRT.texture; u.uTexel.value.set(1 / this.rw, 1 / this.rh);
    u.uExposure.value = P.exposure * expK; u.uSat.value = P.saturation; u.uCon.value = P.contrast; u.uLift.value = P.lift;
    u.uVig.value = P.vignette; u.uSharp.value = P.sharpen; u.uGrain.value = P.grain; u.uFrame.value = frameIndex % 4096;
    u.uTM.value = { agx: 0, aces: 1, neutral: 2 }[P.tonemap] ?? 0;
    u.uUseAE.value = useAE ? 1 : 0; u.tAE.value = this.aeA.texture;
    const t = P.temperature;   // -1 cool .. +1 warm, a simple channel tilt
    u.uWB.value.set(1 + 0.1 * t, 1, 1 - 0.12 * t);
    this._draw(this.grade, target);
  }

  /** Show mix(a, b, t) of two finished frames (render targets that end() drew into) on `target` (null = the canvas). */
  blend(a, b, t, target = null) {
    const u = this.blendMat.uniforms;
    u.tA.value = a.texture; u.tB.value = b.texture; u.uT.value = t;
    this._draw(this.blendMat, target);
  }

  dispose() {
    for (const t of [this.sceneRT, this.aoRT, this.accRT, this.histA, this.histB, this.ssrRT, this.volRT, this.meterRT, this.aeA, this.aeB]) t && t.dispose();
    if (this.l2) { this.l2.lamps.dispose(); this.l2.ssrMat.dispose(); this.l2.volMat.dispose(); }
    this.bloomPass.dispose(); this.quad.dispose();
    for (const m of [this.ao, this.acc, this.grade, this.taaMat, this.copyMat, this.blendMat, this.meterMat, this.adaptMat]) m.dispose();
  }
}

// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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
// ---------------------------------------------------------------------------

export const DEFAULT_POST = {
  exposure: 0.4, temperature: 0, saturation: 1.08, contrast: 1.0, lift: 0, vignette: 0.28,
  tonemap: 'aces', sharpen: 0.2, grain: 0.012,
  bloom: 0.08, bloomRadius: 0.55,
  ao: 0.8, aoRadius: 0.9, aoPower: 1.3,
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
      varying vec2 vUv; uniform sampler2D tColor, tAO; uniform vec2 uAOTexel; uniform float uW, uAO, uSky;
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
          c *= mix(1.0, s / max(w, 1e-4), uAO);
        }
        if (any(isnan(c))) c = vec3(0.0);
        gl_FragColor = vec4(min(c, vec3(32000.0)) * uW, uW);
      }`, { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uAOTexel: { value: new THREE.Vector2() }, uW: { value: 1 }, uAO: { value: 0 }, uSky: { value: 1 } },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
    this.grade = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel;
      uniform float uExposure, uSat, uCon, uLift, uVig, uSharp, uGrain, uFrame, uTM; uniform vec3 uWB;
      #include <tonemapping_pars_fragment>
      float h3(vec3 p){ uvec3 v = floatBitsToUint(p) * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; return float(v.x) / 4294967296.0; }
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb;
        vec3 n = texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb
               + texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb;
        c = max(c + uSharp * clamp(c - n * 0.25, -0.5 * c, 0.5 * c), 0.0);   // limited: no halos on hot edges
        c *= uExposure * uWB;
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
      }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uSat: { value: 1 }, uCon: { value: 1 }, uLift: { value: 0 }, uVig: { value: 0 }, uSharp: { value: 0 }, uGrain: { value: 0 }, uFrame: { value: 0 }, uTM: { value: 0 }, uWB: { value: new THREE.Vector3(1, 1, 1) } });
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

  setSize(w, h) {
    this.w = w; this.h = h;
    for (const t of [this.sceneRT, this.aoRT, this.accRT, this.histA, this.histB]) t && t.dispose();
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.msaa, depthTexture });
    this.aoRT = new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { type: THREE.UnsignedByteType, depthBuffer: false });
    this.accRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.histA = this.accRT.clone(); this.histB = this.accRT.clone();
    if (this.bloomPass) this.bloomPass.setSize(w, h);
    else this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.5, 0);
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
  add(scene, camera, w, k, P) {
    const r = this.r;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    const useAO = P.ao > 0;
    if (useAO) {
      const u = this.ao.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uProj.value.copy(camera.projectionMatrix);
      u.uRadius.value = P.aoRadius; u.uPower.value = P.aoPower; u.uK.value = k;
      this._draw(this.ao, this.aoRT);
    }
    const a = this.acc.uniforms;
    a.tColor.value = this.sceneRT.texture; a.tAO.value = this.aoRT.texture; a.tDepth.value = this.sceneRT.depthTexture;
    a.uInvProj.value.copy(camera.projectionMatrixInverse); a.uAOTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    a.uW.value = w; a.uAO.value = useAO ? P.ao : 0; a.uSky.value = P.sky;
    this._draw(this.acc, this.accRT);
  }

  /** Temporal AA of the sub-frame just added: blend into the reprojected history (alpha = weight of the new frame). */
  taa(invVP, prevVP, alpha) {
    const u = this.taaMat.uniforms;
    u.tCur.value = this.accRT.texture; u.tHist.value = this.histA.texture; u.tDepth.value = this.sceneRT.depthTexture;
    u.uInvVP.value.copy(invVP); u.uPrevVP.value.copy(prevVP); u.uTexel.value.set(1 / this.w, 1 / this.h); u.uAlpha.value = alpha;
    this._draw(this.taaMat, this.histB);
    [this.histA, this.histB] = [this.histB, this.histA];
    // ponytail: one extra copy, because bloom adds into accRT in place and must never reach the history
    this.copyMat.uniforms.tColor.value = this.histA.texture;
    this._draw(this.copyMat, this.accRT);
  }

  /** Bloom and grade the accumulated frame into `target` (null = the canvas). */
  end(P, frameIndex = 0, target = null) {
    if (P.bloom > 0) {
      const b = this.bloomPass;
      b.strength = P.bloom; b.radius = P.bloomRadius; b.threshold = 0;
      b.render(this.r, null, this.accRT, 0, false);
    }
    const u = this.grade.uniforms;
    u.tColor.value = this.accRT.texture; u.uTexel.value.set(1 / this.w, 1 / this.h);
    u.uExposure.value = P.exposure; u.uSat.value = P.saturation; u.uCon.value = P.contrast; u.uLift.value = P.lift;
    u.uVig.value = P.vignette; u.uSharp.value = P.sharpen; u.uGrain.value = P.grain; u.uFrame.value = frameIndex % 4096;
    u.uTM.value = { agx: 0, aces: 1, neutral: 2 }[P.tonemap] ?? 0;
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
    for (const t of [this.sceneRT, this.aoRT, this.accRT, this.histA, this.histB]) t.dispose();
    this.bloomPass.dispose(); this.quad.dispose();
    for (const m of [this.ao, this.acc, this.grade, this.taaMat, this.copyMat, this.blendMat]) m.dispose();
  }
}

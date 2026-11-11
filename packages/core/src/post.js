// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LampShadows, LS_SHARED, LS_N, VOL_LAMPS, lampShadowsIdle } from './light2.js';
import { AMBIENT_GLSL, AMBIENT_GRID_DECL, AMBIENT_GRID_GLSL, ambientNear } from './env.js';
import { FX_DEFAULTS, PostFX } from './postfx.js';
import { SCREEN_POST } from './screen.js';

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
//
// time-of-day grade (opt-in, P.grade = daynight.js gradeAt(); pp.useGrade()): the grade's GRADE variant (split
// toning, black point, S-curve, ACES / AgX-punchy blend, highlight warmth, display gamma and lift, clarity from a
// 1/16-size local mean).
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
  ...FX_DEFAULTS,      // the opt-in passes (postfx.js), all off
  ...SCREEN_POST,      // screen-space lighting (screen.js, needs lighting.screen), all off
};

// the grade's CLEAR variant: alpha from the black / white sums before the sharpening (weighted by alpha: no bright
// rims), the colour un-premultiplied, alpha written out
function CLEAR(fs) {
  const swap = (a, b) => { if (!fs.includes(a)) throw new Error('post: grade text changed, CLEAR cannot patch it'); fs = fs.replace(a, b); };
  swap('uniform sampler2D tAE; uniform float uUseAE;', 'uniform sampler2D tAE; uniform float uUseAE; uniform sampler2D tWhite, tBloom; uniform float uClearK;');
  swap('c = max(c + uSharp *', [
    'vec4 wh = texture2D(tWhite, vUv);',   // .a: the sum of the sub-frame weights (1 up to half-float rounding)
    'float a = clamp(1.0 - dot(wh.rgb - c, vec3(1.0 / 3.0)) / (uClearK * max(wh.a, 1e-3)), 0.0, 1.0);',
    'a = a < 0.5 / 255.0 ? 0.0 : a > 1.0 - 0.5 / 255.0 ? 1.0 : a;',
    'vec3 bl = texture2D(tBloom, vUv).rgb - c;',   // the bloom the object gives itself (bloomed black sum - black sum)
    'c = max(c + uSharp * a * a *'].join('\n        '));
  swap('c *= uExposure * uWB;', 'c = a > 0.0 ? c / a + bl : vec3(0.0);\n        c *= uExposure * uWB;');
  swap('gl_FragColor = vec4(o, 1.0);', 'gl_FragColor = vec4(o, a);');
  return fs;
}

// The time-of-day grade's variant of the grade (opt-in: P.grade, a look from daynight.js gradeAt; useGrade()). Built
// from the grade's own text, so the default program is untouched and a world without the grade renders exactly as
// before. Every original line stays as it was (CLEAR and postfx.js patch the result in turn); the additions:
//   clarity   (linear, exposed) local contrast against a 1/16-size local mean (tLocal), as a log ratio
//   warmth    highlight warmth: the bright end leans warm, as film's halation does (uHiWarm)
//   tone map  an ACES / AgX-punchy blend by uTmMix (< 0: post.tonemap as before); punch (uPunch) steepens and
//             saturates the AgX branch; then a display gamma
//   lift      a display-referred RGB lift of the darks
//   split     shadow / highlight tints by display luma, then (sRGB) a black point and an S-curve on luma
// Ported from the Nizwa Golden Hour project's grade (src/core/post.js, the author's own code; it descends from Golden
// Temple's). Not ported: its lens flare and screen-space god rays (light2's volumetric shafts cover the latter).
const AGX_PUNCHY = /* glsl */ `
      // AgX (Troy Sobotka / Benjamin Wrensch fit) with the punchy look (Nizwa's agx / agxPunchy / agxEotf)
      vec3 mgAgxContrast(vec3 x){ vec3 x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
      vec3 mgAgxPunchy(vec3 v, float punch){
        const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
        const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
        const float mn = -12.47393, mx = 4.026069;
        v = mgAgxContrast((clamp(log2(max(m * v, 1e-10)), mn, mx) - mn) / (mx - mn));
        float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
        v = pow(max(v, 0.0), vec3(mix(1.0, 1.12, punch)));
        v = l + mix(1.0, 1.2, punch) * (v - l);
        return clamp(pow(max(mi * v, 0.0), vec3(2.2)), 0.0, 1.0);
      }`;
function GRADE(fs) {
  const swap = (a, b) => { if (!fs.includes(a)) throw new Error('post: grade text changed, GRADE cannot patch it'); fs = fs.replace(a, b); };
  const TM = 'c = uTM < 0.5 ? AgXToneMapping(c) : uTM < 1.5 ? ACESFilmicToneMapping(c) : NeutralToneMapping(c);';
  swap('uniform sampler2D tAE; uniform float uUseAE;', 'uniform sampler2D tAE; uniform float uUseAE;\n      uniform sampler2D tLocal; uniform float uTmMix, uGamma, uBlack, uCurve, uPunch, uClarity, uHiWarm; uniform vec3 uShTint, uHiTint, uGLift;');
  swap('#include <tonemapping_pars_fragment>', '#include <tonemapping_pars_fragment>' + AGX_PUNCHY);
  swap(TM, [
    'if (uClarity != 0.0) {',
    '  float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722)), lb = dot(texture2D(tLocal, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)) * uExposure * (uUseAE > 0.5 ? exp2(texture2D(tAE, vec2(0.5)).r) : 1.0);',
    '  c *= exp2(uClarity * 0.5 * clamp(log2((l0 + 0.02) / (lb + 0.02)), -2.0, 2.0));',
    '}',
    'if (uHiWarm > 0.0) c = mix(c, c * vec3(1.06, 0.98, 0.88), clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25, 0.0, 1.0) * uHiWarm);',
    `if (uTmMix < 0.0) ${TM}`,
    'else c = mix(ACESFilmicToneMapping(c), mgAgxPunchy(c, uPunch), uTmMix);',
    'if (uGamma != 1.0) c = pow(max(c, 0.0), vec3(1.0 / uGamma));',
  ].join('\n        '));
  swap('c = c + uLift * (1.0 - c);', 'c = c + uLift * (1.0 - c);\n        c = c + uGLift * (1.0 - c);');
  swap('vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;', [
    'c = clamp(c * mix(uShTint, uHiTint, smoothstep(0.02, 0.55, dot(c, vec3(0.2126, 0.7152, 0.0722)))), 0.0, 1.0);',
    'vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;',
    'if (uBlack > 0.0 || uCurve != 0.0) {',
    '  o = max(o - uBlack, 0.0) / (1.0 - uBlack);',
    '  float lo = max(dot(o, vec3(0.2126, 0.7152, 0.0722)), 1e-5), ls = clamp(lo, 0.0, 1.0);',
    '  o = clamp(o * (mix(ls, ls * ls * (3.0 - 2.0 * ls), uCurve) / lo), 0.0, 1.0);',
    '}',
  ].join('\n        '));
  return fs;
}
const GRADE_U = () => ({ tLocal: { value: null }, uTmMix: { value: -1 }, uGamma: { value: 1 }, uBlack: { value: 0 }, uCurve: { value: 0 }, uPunch: { value: 0 }, uClarity: { value: 0 }, uHiWarm: { value: 0 },
  uShTint: { value: new THREE.Vector3(1, 1, 1) }, uHiTint: { value: new THREE.Vector3(1, 1, 1) }, uGLift: { value: new THREE.Vector3() } });

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quadMat = (fs, uniforms, extra) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });

// view-space position from depth (perspective or orthographic: through the inverse projection)
// The render scale never reallocates: every target is as large as the output and a scaled frame is drawn into its
// lower-left corner (viewport + scissor, _fit()). Passes keep working in 0..1 of that corner; texS / texH map a
// lookup into the full-size / half-size texture and clamp it to the corner's last texel centre (bilinear taps must
// not reach the stale pixels beyond). At scale 1 uSub = (1, 1, 1e9, 1e9): the coordinate goes through unchanged.
const SUB = /* glsl */ `
uniform vec4 uSub, uSubH;
vec4 texS(sampler2D t, vec2 uv){ return texture2D(t, min(uv * uSub.xy, uSub.zw)); }
vec4 texH(sampler2D t, vec2 uv){ return texture2D(t, min(uv * uSubH.xy, uSubH.zw)); }`;
const VIEWPOS = /* glsl */ `
uniform sampler2D tDepth; uniform mat4 uInvProj;
${SUB}
vec3 viewPos(vec2 uv){ float d = texS(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }`;

export class Pipeline {
  constructor(renderer, { width, height, msaa = 4, aoSamples = 12 }) {
    this.r = renderer;
    this.msaa = msaa;
    this.quad = new FullScreenQuad();
    this.sub = { uSub: { value: new THREE.Vector4(1, 1, 1e9, 1e9) }, uSubH: { value: new THREE.Vector4(1, 1, 1e9, 1e9) } };
    this.ao = quadMat(/* glsl */ `
      varying vec2 vUv; uniform vec2 uTexel; uniform float uRadius, uPower, uK; uniform mat4 uProj;
      ${VIEWPOS}
      void main(){
        if (texS(tDepth, vUv).x >= 1.0) { gl_FragColor = vec4(1.0); return; }
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
        vec3 c = texS(tColor, vUv).rgb;
        bool sky = texS(tDepth, vUv).x >= 1.0;
        if (sky) c *= uSky;
        else if (uAO > 0.0) {
          float z0 = viewPos(vUv).z, s = 0.0, w = 0.0;
          for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++){
            vec2 q = vUv + (vec2(x, y) + 0.5) * uAOTexel;
            float wz = exp(-abs(viewPos(q).z - z0) / (0.03 * abs(z0) + 0.05));
            s += texH(tAO, q).r * wz; w += wz;
          }
          float o = s / max(w, 1e-4);
          // aoLit: occlusion belongs to ambient light; a brightly lit pixel (exposed luminance; sunlit plaster sits at
          // about 0.25-0.5, shade at 0.05-0.2) is mostly direct light, so fade the darkening there (no dirty halos in sun)
          if (uAOLit > 0.0) o = mix(o, 1.0, uAOLit * smoothstep(0.1, 0.32, dot(c, vec3(0.2126, 0.7152, 0.0722)) * uAOExp));
          c *= mix(1.0, o, uAO);
        }
        if (uUseSSR > 0.5) {
          // light2: toward the screen-space reflection where it hit (premultiplied: bilinear up-sampling keeps the colour)
          vec4 r = texH(tSSR, vUv);
          if (r.a > 0.001) c = mix(c, r.rgb / r.a, min(r.a, 1.0));
        }
        if (uUseVol > 0.5) {
          // light2: the half-resolution in-scatter, a small cross filter
          vec3 v = texH(tVol, vUv).rgb * 0.4;
          v += (texH(tVol, vUv + vec2(uVolTexel.x, 0.0)).rgb + texH(tVol, vUv - vec2(uVolTexel.x, 0.0)).rgb
              + texH(tVol, vUv + vec2(0.0, uVolTexel.y)).rgb + texH(tVol, vUv - vec2(0.0, uVolTexel.y)).rgb) * 0.15;
          c += v;
        }
        if (any(isnan(c))) c = vec3(0.0);
        gl_FragColor = vec4(min(c, vec3(32000.0)) * uW, uW);
      }`, { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uAOTexel: { value: new THREE.Vector2() }, uW: { value: 1 }, uAO: { value: 0 }, uSky: { value: 1 }, uAOLit: { value: 0 }, uAOExp: { value: 1 },
      tSSR: { value: null }, tVol: { value: null }, uUseSSR: { value: 0 }, uUseVol: { value: 0 }, uVolTexel: { value: new THREE.Vector2() } },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
    const gradeFS = /* glsl */ `
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
      }`;
    const gradeU = () => ({ tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uSat: { value: 1 }, uCon: { value: 1 }, uLift: { value: 0 }, uVig: { value: 0 }, uSharp: { value: 0 }, uGrain: { value: 0 }, uFrame: { value: 0 }, uTM: { value: 0 }, uWB: { value: new THREE.Vector3(1, 1, 1) },
      tAE: { value: null }, uUseAE: { value: 0 } });
    this.grade = quadMat(gradeFS, gradeU());
    this._gradeFS = gradeFS; this._gradeU = gradeU;   // postfx.js builds its LUT / chromatic variant from these
    // the transparent still (endClear; illos.dev's CLEAR variant of the grade): tColor holds the frame summed over a
    // black background, tWhite over white (uClearK in linear HDR); both sums are linear in the background, so
    // alpha = 1 - (white - black) / K and the straight colour = black / alpha, graded as usual. Built from the grade's
    // own text (the default grade program is untouched); compiled on first use.
    this._gradeClear = () => this.gradeClear || (this.gradeClear = quadMat(CLEAR(this._gradeFS), { ...this._gradeU(), tWhite: { value: null }, tBloom: { value: null }, uClearK: { value: 1 } }, { defines: { CLEAR: '' } }));

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
      ${SUB}
      vec3 squash(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
      vec3 unsquash(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
      void main(){
        vec3 cur = squash(texS(tCur, vUv).rgb), m1 = vec3(0.0), m2 = vec3(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
          vec3 c = squash(texS(tCur, vUv + vec2(x, y) * uTexel).rgb); m1 += c; m2 += c * c;
        }
        m1 /= 9.0; vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
        vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, texS(tDepth, vUv).x * 2.0 - 1.0, 1.0);
        vec4 pc = uPrevVP * vec4(w.xyz / w.w, 1.0);
        vec2 q = pc.xy / pc.w * 0.5 + 0.5;
        vec3 h = clamp(squash(texture2D(tHist, q).rgb), m1 - 1.25 * sd, m1 + 1.25 * sd);
        float a = any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0))) ? 1.0 : uAlpha;
        gl_FragColor = vec4(unsquash(mix(h, cur, a)), 1.0);
      }`, { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uAlpha: { value: 1 } });
    this.copyMat = quadMat('varying vec2 vUv; uniform sampler2D tColor; void main(){ gl_FragColor = texture2D(tColor, vUv); }', { tColor: { value: null } });
    this.blendMat = quadMat('varying vec2 vUv; uniform sampler2D tA, tB; uniform float uT; void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uT); }', { tA: { value: null }, tB: { value: null }, uT: { value: 0 } });
    for (const m of [this.ao, this.acc, this.taaMat]) Object.assign(m.uniforms, this.sub);
    this.setSize(width, height);
  }

  /** light2 (light2.js): cfg = light2Config(...), ctx = { sun: DirectionalLight, G: the world's uniforms }. */
  useLight2(cfg, { sun, G }) {
    if (this.l2 || !cfg) return;
    const lamps = new LampShadows(this.r, cfg.ls, () => G.uLamp.value, G);   // cfg.ls.on is read live
    this.l2 = { cfg, sun, G, lamps, ssrMat: this._ssrMat(), volMat: this._volMat(G) };
    for (const m of [this.l2.ssrMat, this.l2.volMat]) Object.assign(m.uniforms, this.sub);
    this._l2Targets();
  }

  /** The time-of-day grade (GRADE above): switch the grade (and the transparent still's, and postfx's LUT / chroma
   *  variant) to the graded text. end() calls it on the first frame whose P.grade is set; createWorldRenderer calls it
   *  up front for `grade`. Without it nothing changes. */
  useGrade() {
    if (this.graded) return;
    this.graded = true;
    const base = this._gradeU;
    this._gradeFS = GRADE(this._gradeFS);
    this._gradeU = () => ({ ...base(), ...GRADE_U() });
    this.grade.dispose(); this.grade = quadMat(this._gradeFS, this._gradeU());
    if (this.gradeClear) { this.gradeClear.dispose(); this.gradeClear = null; }
    const fm = this.fx && this.fx.mats;
    if (fm && fm.grade) { fm.grade.dispose(); delete fm.grade; }
    // clarity: the frame's local mean, 1/16 size (16 bilinear taps over each 16 x 16 block, read back bilinear)
    this.localMat = quadMat(/* glsl */ `
      varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel;
      void main(){
        vec3 s = vec3(0.0);
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) s += texture2D(tColor, vUv + (vec2(x, y) * 4.0 - 6.0) * uTexel).rgb;
        gl_FragColor = vec4(s / 16.0, 1.0);
      }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
  }

  // clarity's local mean of accRT (after the bloom), in a target sized to the output
  _local() {
    const w = Math.max(1, Math.ceil(this.w / 16)), h = Math.max(1, Math.ceil(this.h / 16));
    if (!this.localRT || this.localRT.width !== w || this.localRT.height !== h) {
      if (this.localRT) this.localRT.dispose();
      this.localRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    const u = this.localMat.uniforms;
    u.tColor.value = this.accRT.texture; u.uTexel.value.set(1 / this.w, 1 / this.h);
    this._draw(this.localMat, this.localRT);
    return this.localRT.texture;
  }

  _l2Targets() {
    for (const t of [this.ssrRT, this.volRT]) t && t.dispose();
    const hw = Math.ceil(this.w / 2), hh = Math.ceil(this.h / 2);
    this.ssrRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.volRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    this._fit();
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
        float w = clamp(-texS(tColor, vUv).a, 0.0, 1.0);   // -reflectance (light2.js); >= 0 everywhere else
        if (w < 0.02) { gl_FragColor = vec4(0.0); return; }
        if (texS(tDepth, vUv).x >= 1.0) { gl_FragColor = vec4(0.0); return; }
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
        if (viewPos(uv).z - Q.z > uThick + 0.03 * t1 || texS(tDepth, uv).x >= 1.0) { gl_FragColor = vec4(0.0); return; }
        vec3 c = texS(tColor, uv).rgb;
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
    u.uRes.value.set(this.hw, this.hh); u.uNear.value = camera.near;
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
      ${AMBIENT_GRID_DECL}
      ${AMBIENT_GRID_GLSL}
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
      float indoor(vec3 p){ return uAmbN > 0.0 ? clamp((1.0 - (uAmbDim.x > 0.0 ? dot(mgAmbientGrid(p), vec3(0.2126, 0.7152, 0.0722)) : mgAmbient(p))) * 1.6, 0.0, 1.0) : 0.0; }
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
        bool sky = texS(tDepth, vUv).x >= 1.0;
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
      uAmbN: G.uAmbN, uAmbLo: G.uAmbLo, uAmbHi: G.uAmbHi, uAmbGrid: G.uAmbGrid, uAmbDim: G.uAmbDim, uAmbData: G.uAmbData,
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
    this._volKey = keyOn;
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
  _nearVolume(p, G, d) { return ambientNear(G, p, d); }

  /** The output size (w, h: what the caller sees, stable) and the render size (rw, rh = w, h x the render scale). */
  setSize(w, h) {
    this.w = w; this.h = h; this.renderScale = 1;
    this._alloc(w, h);
    this._fit();
  }

  /** Dynamic resolution / temporal upscaling: render the scene at s x the output size into the lower-left corner of
   *  the same targets (nothing is reallocated, so the scale may change every frame); the temporal resolve (taa())
   *  reads that corner and writes a full-size frame, which bloom and grade then see. Only meaningful with taa():
   *  without a resolve keep s = 1. Returns false (the history stays valid). */
  setRenderScale(s) {
    s = Number.isFinite(s) ? Math.min(1, Math.max(0.1, s)) : 1;
    const rw = s === 1 ? this.w : Math.max(16, Math.round(this.w * s)), rh = s === 1 ? this.h : Math.max(16, Math.round(this.h * s));
    this.renderScale = s;
    if (rw === this.rw && rh === this.rh) return false;
    this.rw = rw; this.rh = rh;
    this._fit();
    return false;
  }

  // point the scene-sized targets and the lookups at the current render size (see SUB)
  _fit() {
    const { w, h, rw, rh } = this, on = rw !== w || rh !== h, hw = Math.ceil(rw / 2), hh = Math.ceil(rh / 2);
    for (const [t, tw, th] of [[this.sceneRT, rw, rh], [this.aoRT, hw, hh], [this.ssrRT, hw, hh], [this.volRT, hw, hh]]) {
      if (t) { t.viewport.set(0, 0, tw, th); t.scissor.set(0, 0, tw, th); t.scissorTest = on; }
    }
    this.hw = hw; this.hh = hh;
    if (on) { this.sub.uSub.value.set(rw / w, rh / h, (rw - 0.5) / w, (rh - 0.5) / h); this.sub.uSubH.value.set(hw / Math.ceil(w / 2), hh / Math.ceil(h / 2), (hw - 0.5) / Math.ceil(w / 2), (hh - 0.5) / Math.ceil(h / 2)); }
    else { this.sub.uSub.value.set(1, 1, 1e9, 1e9); this.sub.uSubH.value.set(1, 1, 1e9, 1e9); }
    this._accView(false);
    if (this.fx) this.fx.fit();
  }

  // the accumulation target: the render-size corner while sub-frames add into it, whole once resolved
  _accView(corner) {
    const t = this.accRT, on = corner && (this.rw !== this.w || this.rh !== this.h);
    if (!t || t.scissorTest === on) return;
    t.viewport.set(0, 0, on ? this.rw : this.w, on ? this.rh : this.h); t.scissor.copy(t.viewport); t.scissorTest = on;
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

  /** renderTransparent: keep the frame summed so far (over black) in histB, bloom it and keep that in histA (scratch:
   *  the TAA history, which a still frame invalidates anyway) */
  keepBlack(P) {
    this.copyMat.uniforms.tColor.value = this.accRT.texture;
    this._draw(this.copyMat, this.histB);
    this._clearExpK = this._bloom(P);
    this.copyMat.uniforms.tColor.value = this.accRT.texture;
    this._draw(this.copyMat, this.histA);
  }

  /** renderTransparent: grade the black sum (keepBlack) and the white one (accRT, background K) into `target` with
   *  straight alpha: alpha from the sums before the bloom, the object's own bloom added to its colour. No auto exposure. */
  endClear(P, frameIndex, target, K = 1) {
    const m = this._gradeClear(), u = m.uniforms, g = this.grade.uniforms;
    this.end({ ...P, bloom: 0, autoExposure: 0 }, frameIndex, null, {}, true);   // set the grade's uniforms, draw nothing
    for (const k of Object.keys(g)) if (u[k]) u[k].value = g[k].value;
    u.uExposure.value = P.exposure * (this._clearExpK ?? 1);
    u.tColor.value = this.histB.texture; u.tBloom.value = this.histA.texture; u.tWhite.value = this.accRT.texture; u.uClearK.value = K;
    this._draw(m, target);
  }

  begin() {
    this._accView(false);
    this.r.setRenderTarget(this.accRT);
    this.r.setClearColor(0x000000, 0);
    this.r.clear(true, false, false);
  }

  /** Render sub-frame k of the frame with weight w (weights of one frame sum to 1). */
  add(scene, camera, w, k, P, jk = k, still = false) {
    const r = this.r, l2 = this.l2;
    if (this.screen) this.screen.before(this, scene, camera, k, still, P);   // screen-space lighting (screen.js, opt-in): its buffers for this sub-frame
    if (l2) l2.lamps.update(scene, camera, { k, still });
    else lampShadowsIdle();   // another world may have published its lamps into the page-global uniforms
    r.setRenderTarget(this.sceneRT);
    if (this.clearColor == null) r.setClearColor(0x000000, 1);
    else r.setClearColor((this._cc || (this._cc = new THREE.Color())).setRGB(this.clearColor, this.clearColor, this.clearColor), 1);   // renderTransparent
    r.clear(true, true, false);
    r.render(scene, camera);
    if (this.screen) this.screen.after(this, camera);
    if (l2) l2.lamps.done();
    // opt-in passes (postfx.js): a moving frame is one sub-frame of weight 1; it gets a velocity buffer when asked
    this._live = w === 1 && !still; this._cam = camera; this._jk = jk;
    this._taa2 = this._live && P.taa2 > 0;
    if (this._live && (P.taa2 > 0 || P.motionBlur > 0)) this._fx().velocity(scene, camera);
    const useAO = P.ao > 0;
    if (useAO) {
      const u = this.ao.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uProj.value.copy(camera.projectionMatrix);
      u.uRadius.value = P.aoRadius; u.uPower.value = P.aoPower; u.uK.value = k;
      this._draw(this.ao, this.aoRT);
    }
    this._volKey = false;   // _vol: light2 marched the key light (postfx godrays weigh themselves down)
    const useSSR = !!l2 && this._ssr(camera, jk), useVol = !!l2 && this._vol(camera, jk);
    const a = this.acc.uniforms;
    a.uUseSSR.value = useSSR ? 1 : 0; a.uUseVol.value = useVol ? 1 : 0;
    if (l2) { a.tSSR.value = this.ssrRT.texture; a.tVol.value = this.volRT.texture; a.uVolTexel.value.set(0.75 / this.hw, 0.75 / this.hh); }
    a.tColor.value = this.sceneRT.texture; a.tAO.value = this.aoRT.texture; a.tDepth.value = this.sceneRT.depthTexture;
    a.uInvProj.value.copy(camera.projectionMatrixInverse); a.uAOTexel.value.set(1 / this.hw, 1 / this.hh);
    a.uW.value = w; a.uAO.value = useAO ? P.ao : 0; a.uSky.value = P.sky;
    a.uAOLit.value = useAO ? Math.min(1, Math.max(0, P.aoLit || 0)) : 0; a.uAOExp.value = P.exposure;
    this._accView(true);
    this._draw(this.acc, this.accRT);
  }

  /** Temporal AA of the sub-frame just added: blend into the reprojected history (alpha = weight of the new frame). */
  taa(invVP, prevVP, alpha) {
    if (this._taa2) return this.fx.resolve(alpha);   // post.taa2: the velocity-buffer resolve (postfx.js)
    const u = this.taaMat.uniforms;
    u.tCur.value = this.accRT.texture; u.tHist.value = this.histA.texture; u.tDepth.value = this.sceneRT.depthTexture;
    u.uInvVP.value.copy(invVP); u.uPrevVP.value.copy(prevVP); u.uTexel.value.set(1 / this.rw, 1 / this.rh); u.uAlpha.value = alpha;
    this._draw(this.taaMat, this.histB);
    [this.histA, this.histB] = [this.histB, this.histA];
    // ponytail: one extra copy, because bloom adds into accRT in place and must never reach the history
    this.copyMat.uniforms.tColor.value = this.histA.texture;
    this._accView(false);
    this._draw(this.copyMat, this.accRT);
  }

  /** [converge] An adaptive still (renderFrame's `converge`) asks after some sub-frames how far the frame still
   *  moves: the accumulation so far, normalised by its weight sum `wsum`, against the estimate at the last call, in
   *  display levels (0..255 after exposure and a plain tone curve: close to what the grade will show). Returns the
   *  mean over the frame, or null on the first call of a frame (first = true: nothing to compare with yet). Blocks
   *  of 8 x 8 px are averaged on the GPU; only a small float target is read back. */
  converge(wsum, exposure, first) {
    const w = this.rw, h = this.rh, bw = Math.ceil(w / 8), bh = Math.ceil(h / 8);
    if (!this.cv || this.cv.prev.width !== w || this.cv.prev.height !== h) {
      if (this.cv) { this.cv.prev.dispose(); this.cv.stats.dispose(); }
      this.cv = {
        prev: new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }),
        stats: new THREE.WebGLRenderTarget(bw, bh, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
        buf: new Float32Array(bw * bh * 4),
      };
      this.cvDiff ??= quadMat(/* glsl */ `
        varying vec2 vUv; uniform sampler2D tCur, tPrev; uniform vec2 uTexel; uniform float uN, uExp;
        vec3 disp(vec3 c){ c = max(c, 0.0) * uExp; return 255.0 * pow(c / (1.0 + c), vec3(1.0 / 2.2)); }
        void main(){
          vec2 o = floor(vUv / (uTexel * 8.0)) * uTexel * 8.0 + 0.5 * uTexel;
          float s = 0.0;
          for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
            vec2 uv = o + vec2(float(x), float(y)) * uTexel;
            vec3 d = abs(disp(texture2D(tCur, uv).rgb * uN) - disp(texture2D(tPrev, uv).rgb));
            s += max(d.r, max(d.g, d.b));
          }
          gl_FragColor = vec4(s / 64.0, 0.0, 0.0, 1.0);
        }`, { tCur: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uN: { value: 1 }, uExp: { value: 1 } });
      this.cvScale ??= quadMat('varying vec2 vUv; uniform sampler2D tColor; uniform float uS; void main(){ gl_FragColor = texture2D(tColor, vUv) * uS; }', { tColor: { value: null }, uS: { value: 1 } });
    }
    const cv = this.cv;
    let mean = null;
    if (!first) {
      const u = this.cvDiff.uniforms;
      u.tCur.value = this.accRT.texture; u.tPrev.value = cv.prev.texture; u.uTexel.value.set(1 / w, 1 / h); u.uN.value = 1 / wsum; u.uExp.value = exposure;
      this._draw(this.cvDiff, cv.stats);
      this.r.readRenderTargetPixels(cv.stats, 0, 0, bw, bh, cv.buf);
      let s = 0;
      for (let i = 0; i < bw * bh; i++) s += cv.buf[4 * i];
      mean = s / (bw * bh);
    }
    this.cvScale.uniforms.tColor.value = this.accRT.texture; this.cvScale.uniforms.uS.value = 1 / wsum;
    this._draw(this.cvScale, cv.prev);
    return mean;
  }

  /** [converge] Stop early: scale the accumulation by s (1 / the weight sum of the sub-frames drawn), so end() grades
   *  a whole frame. The scratch is histB (a still frame has just invalidated the temporal-AA history anyway). */
  scaleAccumulation(s) {
    this.cvScale.uniforms.tColor.value = this.accRT.texture; this.cvScale.uniforms.uS.value = s;
    this._draw(this.cvScale, this.histB);
    this.copyMat.uniforms.tColor.value = this.histB.texture;
    this._draw(this.copyMat, this.accRT);
  }

  _fx() { return this.fx || (this.fx = new PostFX(this)); }
  /** post.taa2: the projection's next sub-pixel offset, in render pixels (the caller applies it; see postfx.js). */
  fxJitter() { return this._fx().jitter(); }

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

  // bloom into accRT in place; returns the exposure factor the grade applies (light2's mixed bloom raises it)
  _bloom(P) {
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
      this._bloomMip = b.renderTargetsVertical[3];   // the grade's clarity reads this blur as its local mean
      expK = 1 + Math.max(0, P.bloom) * lift;
    } else if (P.bloom > 0) {
      const m = b.blendMaterial;
      if (m.blending !== THREE.AdditiveBlending) m.blending = THREE.AdditiveBlending;
      b.strength = P.bloom; b.radius = P.bloomRadius; b.threshold = 0;
      b.render(this.r, null, this.accRT, 0, false);
      this._bloomMip = b.renderTargetsVertical[3];   // the grade's clarity reads this blur as its local mean
    }
    return expK;
  }

  /** Bloom and grade the accumulated frame into `target` (null = the canvas). opts: { dt, still } for auto exposure:
   *  dt = the seconds since the last moving frame (the exposure eases), still = meter this frame on its own (stays
   *  bit-identical). Without dt the frame counts as still. */
  end(P, frameIndex = 0, target = null, opts = {}, setOnly = false) {
    const useAE = P.autoExposure > 0;
    if (useAE) { if (opts.meter !== false || !this.aeValid) this._meter(P, P.exposure, opts); }   // meter: false = keep the adapted exposure (XR: the second eye)
    else this.aeValid = false;
    // opt-in passes (postfx.js) on a moving frame: lens blur, then motion blur, over the resolved frame
    const live = opts.still === false && this._live;
    if (live && P.bokeh > 0) this._fx().bokeh(P, this._cam);
    if (live && P.motionBlur > 0) this._fx().motionBlur(P);
    if (live && P.rcas > 0) this._fx().rcas(P);
    this._bloomMip = null;
    if (!setOnly && P.godrays > 0) this._fx().godrays(P, this._cam, this._jk, this._volKey, live);   // the sun's shafts, bloomed with the rest
    const expK = P.bloomPyramid > 0 && P.bloom > 0 ? this._fx().bloom(P) : this._bloom(P);
    if (!setOnly && P.flare > 0) this._fx().flare(P, this._cam, live);   // the sun's lens flare, after the bloom
    if (P.grade && !this.graded) this.useGrade();
    const gm = (!setOnly && (P.lut || P.chroma > 0) && this._fx().grade(P)) || this.grade;
    const u = gm.uniforms;
    u.tColor.value = this.accRT.texture; u.uTexel.value.set(1 / this.w, 1 / this.h);
    u.uExposure.value = P.exposure * expK; u.uSat.value = P.saturation; u.uCon.value = P.contrast; u.uLift.value = P.lift;
    u.uVig.value = P.vignette; u.uSharp.value = P.sharpen; u.uGrain.value = P.grain; u.uFrame.value = frameIndex % 4096;
    u.uTM.value = { agx: 0, aces: 1, neutral: 2 }[P.tonemap] ?? 0;
    u.uUseAE.value = useAE ? 1 : 0; u.tAE.value = this.aeA.texture;
    const t = P.temperature;   // -1 cool .. +1 warm, a simple channel tilt
    u.uWB.value.set(1 + 0.1 * t, 1, 1 - 0.12 * t);
    if (this.graded) {
      // the time-of-day grade (GRADE): P.grade is the hour's look (daynight.js gradeAt); without one, every term is off
      const L = P.grade, cl = L && !setOnly ? L.clarity || 0 : 0;
      u.uTmMix.value = L && L.tonemapMix !== null && L.tonemapMix !== undefined ? Math.min(1, Math.max(0, L.tonemapMix)) : -1;
      u.uGamma.value = L ? Math.max(0.1, L.gamma ?? 1) : 1;
      u.uBlack.value = L ? Math.min(0.5, Math.max(0, L.black || 0)) : 0; u.uCurve.value = L ? L.curve || 0 : 0;
      u.uShTint.value.fromArray(L ? L.shadowTint : [1, 1, 1]); u.uHiTint.value.fromArray(L ? L.hiTint : [1, 1, 1]);
      u.uGLift.value.fromArray(L ? L.lift : [0, 0, 0]);
      if (L && L.tint) u.uWB.value.set(u.uWB.value.x + 0.02 * L.tint, 1 - 0.06 * L.tint, u.uWB.value.z + 0.02 * L.tint);
      u.uPunch.value = L ? Math.min(1, Math.max(0, L.punch || 0)) : 0; u.uHiWarm.value = L ? Math.max(0, L.highlightWarmth || 0) : 0;
      // clarity's local mean: the bloom's 1/16 blur when the bloom ran this frame (free), else a pass of its own (~0.3 ms at 1440 x 900, M4 Pro)
      u.uClarity.value = cl; u.tLocal.value = cl !== 0 ? (this._bloomMip ? this._bloomMip.texture : this._local()) : null;
    }
    if (!setOnly) this._draw(gm, target);
  }

  /** Show mix(a, b, t) of two finished frames (render targets that end() drew into) on `target` (null = the canvas). */
  blend(a, b, t, target = null) {
    const u = this.blendMat.uniforms;
    u.tA.value = a.texture; u.tB.value = b.texture; u.uT.value = t;
    this._draw(this.blendMat, target);
  }

  /** Start compiling every pass's program at once (KHR_parallel_shader_compile); resolves when all are ready. Left to
   *  the first frames, each one compiles on the main thread in turn (~50-370 ms each on a cold start). Programs are
   *  keyed on the output colour space and on the geometry's attributes, so this uses the passes' own full-screen
   *  triangle and compiles the passes that draw to the canvas for both kinds of target. */
  compileAsync() {
    const r = this.r, cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), geo = this.quad._mesh.geometry;   // FullScreenQuad's (shared)
    const bloom = Object.values(this.bloomPass).flat().filter((m) => m && m.isMaterial);
    const passes = [this.ao, this.acc, this.taaMat, this.copyMat, this.grade, this.blendMat, ...bloom, ...(this.localMat ? [this.localMat] : [])];
    const sceneOf = (mats) => { const s = new THREE.Scene(); for (const m of mats) { const q = new THREE.Mesh(geo, m); q.frustumCulled = false; s.add(q); } return s; };
    const saved = r.getRenderTarget(), jobs = [];
    r.setRenderTarget(this.accRT); jobs.push(r.compileAsync(sceneOf(passes), cam));
    r.setRenderTarget(null); jobs.push(r.compileAsync(sceneOf([this.grade, this.blendMat]), cam));
    r.setRenderTarget(saved);
    return Promise.all(jobs);
  }

  dispose() {
    for (const t of [this.sceneRT, this.aoRT, this.accRT, this.histA, this.histB, this.ssrRT, this.volRT, this.meterRT, this.aeA, this.aeB, this.localRT]) t && t.dispose();
    if (this.l2) { this.l2.lamps.dispose(); this.l2.ssrMat.dispose(); this.l2.volMat.dispose(); }
    this.bloomPass.dispose(); this.quad.dispose(); this.fx && this.fx.dispose();
    for (const m of [this.ao, this.acc, this.grade, this.gradeClear, this.taaMat, this.copyMat, this.blendMat, this.meterMat, this.adaptMat, this.cvDiff, this.cvScale, this.localMat]) m && m.dispose();
    if (this.cv) { this.cv.prev.dispose(); this.cv.stats.dispose(); this.cv = null; }
  }
}

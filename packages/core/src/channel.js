// Mirage original code. The technique (the water knows its channel's cross-section and traces its two short rays
// analytically: refraction onto the bed or a wall, reflection of the opposite wall; caustics, sun glints, foam below a
// drop) follows the owner's Nizwa project (src/world/falaj-water.js, falaj-glsl.js), re-implemented on patch().
import * as THREE from 'three';
import { WET, WET_GLSL } from './wet.js';
import { withFlash } from './weather.js';

// ---------------------------------------------------------------------------
// Open channel water (opt-in: nothing changes until you call these). A straight U channel from `from` to `to`:
//
//   const ch = channelWater(world, { from: [x, z], to: [x, z], y: 0, width: 0.5, depth: 0.35, water: 0.12 });
//   scene.add(ch.water, new THREE.Mesh(ch.body, myConcrete));
//
//   water   a Mesh: the surface, its material traces the cross-section (no mirror pass)
//   body    a BufferGeometry: the two inner walls and the bed (draw it with your own material)
//   uniforms  live: uChFlow (x speed m/s, y turbulence 0..1, z foam at the inflow 0..1), uChWall / uChBed (linear albedo)
//
// The surface: ripples advected with the flow (standing waves, boils, ripples, capillaries; octaves finer than the
// pixel fade into roughness), rain rings while setRain > 0 (wet.js). Its light, per pixel: what three computed for a
// white surface there (the shadowed sun, the lamps, the image-based light, the flash: recovered from the diffuse terms)
// lights the traced bed and walls; the reflection is three's own (sky, probe, planar mirror) except where the mirrored
// ray meets the opposite wall, which is shaded; the refracted ray meets the bed or a wall, lit by the refracted sun
// with caustics, shadowed by the walls (from the cross-section) and by the world (the surface's own shadow), absorbed
// along both paths; glints are three's GGX on the rippled normal. Foam and bubbles below the inflow.
// ---------------------------------------------------------------------------

const CH_GLSL = /* glsl */ `
uniform vec4 uChA;     // from.xz, flow tangent T.xz
uniform vec4 uChDim;   // half width, water depth, wall above the water, length
uniform vec4 uChFlow;  // speed (m/s), turbulence 0..1, foam at the inflow 0..1, -
uniform vec3 uChWall, uChBed;
float chFade(float r){ return 1.0 - smoothstep(0.25, 0.8, r); }
// ripple height (m) at sa = (along, across), footprint fp; lost: slope variance of the octaves too fine to show
float chH(vec2 sa, float v, float fp, float calm, out float lost){
  float t = uTime, sv = sa.x - v * t, w; float h = 0.0; lost = 0.0;
  w = chFade(fp / 0.3);   // standing waves fixed to the bed, breathing
  h += 0.0015 * mgGrad3(vec3(sa.x / 0.3, sa.y / 0.2, t * 0.45)) * w * (0.55 + 0.45 * calm);
  lost += (1.0 - w) * 0.0012;
  w = chFade(fp / 0.55);  // boils carried by the current
  h += 0.003 * calm * mgGrad3(vec3(sv / 0.55, sa.y / 0.38, t * 0.55)) * w;
  lost += (1.0 - w) * 0.0012 * calm;
  w = chFade(fp / 0.13);  // ripples, a little warped
  vec2 q = vec2(sv / 0.13, sa.y / 0.1) + 0.6 * vec2(mgGrad2(vec2(sv * 3.1, sa.y * 4.0 + t * 0.7)), mgGrad2(vec2(sv * 2.7 + 9.0, sa.y * 3.3 - t * 0.6)));
  h += 0.0011 * calm * mgGrad3(vec3(q, t * 1.25)) * w;
  lost += (1.0 - w) * 0.0025 * calm;
  w = chFade(fp / 0.045); // capillaries, close up only
  h += 0.00025 * (0.35 + 0.65 * calm) * mgGrad3(vec3(sv / 0.045, sa.y / 0.038, t * 2.1)) * w;
  lost += (1.0 - w) * 0.0012;
  return h;
}
// a caustic net on what lies under the moving water (mean about 1), fading to 1 where it is sub-pixel
float chCaustic(vec2 q, float v, float fp){
  float f = 1.0 - smoothstep(0.01, 0.045, fp);
  if (f < 0.01) return 1.0;
  float t = uTime; vec2 p = q; p.x -= v * t * 0.85;
  vec2 w = vec2(mgGrad2(p * 2.3 + vec2(0.0, t * 0.35)), mgGrad2(p * 2.1 + vec2(7.3, -t * 0.31)));
  vec2 pp = p + w * 0.09;
  float r1 = 1.0 - abs(mgGrad3(vec3(pp * vec2(9.0, 10.5), t * 0.85)));
  float r2 = 1.0 - abs(mgGrad3(vec3(pp * vec2(18.0, 20.0) + 3.1, t * 1.15 + 4.0)));
  float c = pow(r1, 26.0) * 3.6 + pow(r2, 34.0) * 2.2 + pow(r1 * r2, 9.0) * 4.0;
  c = 0.62 + c * 1.6 * (0.6 + 0.4 * mgGrad2(p * 0.9));
  return mix(1.0, c, f);
}
// the bed: fine grit and small stones in silt (soft joints), mottled patches of silt, streaks of it along the flow
vec3 chBedAlb(vec2 q, float fp){
  vec2 c = mgCell2(q / 0.022);
  float res = 1.0 - smoothstep(0.004, 0.02, fp);
  float e = c.y - c.x;
  float id = mgHash(floor(q / 0.022 + 0.5));
  vec3 a = uChBed * (0.82 + 0.3 * id * res) * (1.0 - 0.25 * (1.0 - smoothstep(0.02, 0.25, e)) * res);
  float patch_ = smoothstep(0.35, 0.75, mgFbm2(q * vec2(0.9, 2.2) + 7.0, 3) * 0.5 + 0.5);
  float silt = smoothstep(0.45, 0.85, mgFbm2(vec2(q.x * 1.2, q.y * 9.0), 3) * 0.5 + 0.5);
  return mix(a, uChBed * vec3(0.62, 0.58, 0.46), max(patch_ * 0.7, silt * 0.45));
}
// a wall: the material's colour, mottled, darker and wet near the water line (dz: height above it)
vec3 chWallAlb(vec2 q, float dz){
  vec3 a = uChWall * (0.8 + 0.35 * (mgFbm2(q * vec2(2.0, 6.0), 3) * 0.5 + 0.5));
  float wet = 1.0 - smoothstep(0.004, 0.06 + 0.02 * mgGrad2(q * vec2(5.0, 1.0)), dz - 0.01 * sin(q.x * 9.0 + uTime * 2.6));
  a *= mix(1.0, 0.5, max(wet, step(dz, 0.0)));
  return mix(a, a * vec3(0.55, 0.7, 0.45), (1.0 - smoothstep(-0.02, 0.03, dz)) * 0.5);   // a film of algae under water
}
float chBubbles(vec2 p, float sc, float dens, float fp){
  vec2 q = p * sc, c = floor(q), f = fract(q); float cov = 0.0, e = fp * sc * 1.5 + 0.02;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec3 h = mgHash3(vec3(c + g, 5.0));
    float r = 0.28 + 0.3 * h.y, d = length(g + 0.5 + 0.6 * (h.xy - 0.5) - f);
    cov = max(cov, (1.0 - smoothstep(r - e, r + e, d)) * step(h.z, dens) * (0.75 + 0.35 * smoothstep(r * 0.4, r * 0.95, d)));
  }
  return cov;
}
vec3 chN; float chLost, chFoam;
vec2 chSA;
`;

// the normal hook: the rippled surface (world -> view), the roughness from the ripples too fine to see
const CH_NORMAL = /* glsl */ `{
  vec2 T = uChA.zw, B = vec2(-T.y, T.x), d = mgWorldPos.xz - uChA.xy;
  chSA = vec2(dot(d, T), dot(d, B));
  float fp = max(length(dFdx(mgWorldPos)), length(dFdy(mgWorldPos)));
  float calm = clamp(uChFlow.y + 0.6 * exp(-chSA.x / 1.2) * uChFlow.z, 0.0, 1.0), e = clamp(fp * 0.7, 0.004, 0.05), l0, l1, l2;
  float v = uChFlow.x;
  float h0 = chH(chSA, v, fp, calm, l0), hs = chH(chSA + vec2(e, 0.0), v, fp, calm, l1), ha = chH(chSA + vec2(0.0, e), v, fp, calm, l2);
  vec2 g = vec2(hs - h0, ha - h0) / e;
  vec3 T3 = vec3(T.x, 0.0, T.y), B3 = vec3(B.x, 0.0, B.y);
  vec3 n = vec3(0.0, 1.0, 0.0) - g.x * T3 - g.y * B3;
  if (uRain > 0.0) { vec2 r = mgWetRipples(mgWorldPos.xz) * (0.5 + 0.5 * uRain) * (1.0 - smoothstep(0.004, 0.012, fp)); n -= vec3(r.x, 0.0, r.y); }
  chN = normalize(n); chLost = l0;
  normal = normalize((viewMatrix * vec4(chN, 0.0)).xyz);
  roughnessFactor = clamp(sqrt(sqrt(0.0002 + chLost) * 1.4), 0.06, 0.5);
}`;

// after <lights_fragment_end>: what three lit for a white surface becomes the light of the traced bed and walls
const CH_LIGHT = /* glsl */ `{
  vec3 P = mgWorldPos, V = normalize(cameraPosition - P), N = chN;
  vec2 T = uChA.zw; vec3 T3 = vec3(T.x, 0.0, T.y), B3 = vec3(-T.y, 0.0, T.x);
  float s = chSA.x, a = chSA.y, hw = uChDim.x, D = max(uChDim.y, 0.005), up = uChDim.z, v = uChFlow.x;
  float fp = max(length(dFdx(P)), length(dFdy(P)));
  vec3 Edir = reflectedLight.directDiffuse * 3.14159, Eamb = reflectedLight.indirectDiffuse * 3.14159;
  vec3 Ls = normalize(uKeyDir);
  vec3 sunE = uKeyColor * max(dot(N, Ls), 0.0);
  float sunV = clamp(mgLuma(Edir) / max(mgLuma(sunE), 1e-5), 0.0, 1.0) * step(1e-6, mgLuma(sunE));
  vec3 lampE = max(Edir - sunE * sunV, 0.0);
  vec3 sunC = uKeyColor * sunV;            // the sun (or moon) reaching this point, shadowed by the world
  float NdV = clamp(dot(N, V), 1e-3, 1.0), F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  // ---- reflection: three's (sky, probe, mirror), or the opposite wall where the mirrored ray meets it
  vec3 refl = reflectedLight.indirectSpecular;
  vec3 Rr = reflect(-V, N); Rr.y = max(Rr.y, 0.003); Rr = normalize(Rr);
  float Rb = dot(Rr, B3);
  if (abs(Rb) > 1e-3) {
    float sd = sign(Rb), lw = (sd * hw - a) / Rb, yh = Rr.y * lw;
    if (lw > 0.0 && yh < up) {
      vec3 nW = -sd * B3;
      vec3 alb = chWallAlb(vec2(s + dot(Rr, T3) * lw, yh), yh);
      vec3 Lw = alb * (uKeyColor * max(dot(nW, Ls), 0.0) * sunV + Eamb * 0.55 + lampE * 0.5) / 3.14159;
      refl = mix(refl, Lw * F, 1.0 - smoothstep(up - 0.03, up, yh));
    }
  }
  // ---- refraction: the bed or a wall under the water
  vec3 Tr = refract(-V, N, 0.7502);
  if (dot(Tr, Tr) < 1e-6) Tr = vec3(0.0, -1.0, 0.0);
  Tr.y = min(Tr.y, -0.05); Tr = normalize(Tr);
  float Tb = dot(Tr, B3), lb = D / -Tr.y, lw = abs(Tb) > 1e-4 ? (sign(Tb) * hw - a) / Tb : 1e3;
  float lam = max(min(lb, lw), 0.0);
  bool onWall = lw < lb;
  vec3 H = P + Tr * lam;
  float dH = max(P.y - H.y, 0.0), aH = a + Tb * lam;
  vec2 q = vec2(s + dot(Tr, T3) * lam, aH);
  float fpH = fp * (1.0 + lam * 1.5);
  vec3 alb = onWall ? chWallAlb(vec2(q.x, -dH), -dH) : chBedAlb(q, fpH);
  vec3 nH = onWall ? -sign(Tb) * B3 : vec3(0.0, 1.0, 0.0);
  // the sun into the water and down to the hit point; in the walls' shadow when its way in crosses a wall
  vec3 Lr = refract(-Ls, vec3(0.0, 1.0, 0.0), 0.7502);
  float lu = dH / max(-Lr.y, 0.05), aE = aH - dot(Lr, B3) * lu, aTop = aE + dot(Ls, B3) / max(Ls.y, 0.02) * up;
  float inside = (1.0 - smoothstep(hw - 0.02, hw + 0.01, abs(aE))) * (1.0 - smoothstep(hw - 0.02, hw + 0.01, abs(aTop)));
  float Fin = 0.02 + 0.98 * pow(1.0 - max(Ls.y, 0.0), 5.0);
  float caus = mix(1.0, chCaustic(onWall ? vec2(q.x, H.y * 2.5) : q, v, fpH), smoothstep(0.0, 0.03, dH));
  vec3 sig = vec3(1.6, 0.55, 0.45);         // red taken first, a little silt: a green-grey body
  vec3 Esun = uKeyColor * sunV * (1.0 - Fin) * max(dot(nH, -Lr), 0.0) * caus * inside * exp(-sig * lu);
  float sky = clamp(hw / sqrt(hw * hw + (up + dH) * (up + dH)) * 1.15, 0.1, 1.0) * (onWall ? 0.6 : 1.0);
  vec3 Lh = alb * (Esun + (Eamb * sky + lampE * 0.7) * exp(-sig * dH)) / 3.14159;
  vec3 Tv = exp(-sig * lam);
  vec3 Lrefr = Lh * Tv + vec3(0.03, 0.05, 0.04) * (Eamb * 0.35 + sunC * 0.1 + lampE * 0.25) * (1.0 - Tv);
  // drift on the surface: a thin broken film of dust drawn into streaks by the current (what makes running water read
  // from above, where the reflection is weak), carried at the surface's speed
  {
    vec2 dq = vec2(s - v * uTime * 1.05, a);
    float st = mgGrad2(vec2(dq.x * 1.3, dq.y * 16.0 + mgGrad2(dq * vec2(0.8, 2.0)) * 1.5));
    float film = smoothstep(0.35, 0.75, st) * smoothstep(0.35, 0.7, mgGrad2(dq * vec2(0.6, 1.5) + 7.0) * 0.5 + 0.5) * (0.4 + 0.6 * (1.0 - smoothstep(0.004, 0.03, fp)));
    Lrefr = mix(Lrefr, vec3(0.42, 0.4, 0.34) * (sunC * max(N.y, 0.0) + Eamb * 0.8 + lampE * 0.6) / 3.14159, film * 0.3);
  }
  // ---- foam and bubbles below the inflow, drifting down the channel and thinning
  float src = uChFlow.z * exp(-s / 1.2);
  chFoam = 0.0;
  if (src > 0.01) {
    float t = uTime; vec2 fq = vec2(s - v * t * 0.9, a);
    vec2 wq = fq + 0.02 * vec2(mgGrad2(fq * 4.0 + vec2(0.0, t * 0.5)), mgGrad2(fq * 4.0 + vec2(5.2, -t * 0.45)));
    float dens = clamp(smoothstep(0.62 - 0.45 * src, 0.85 - 0.3 * src, mgFbm2(wq * vec2(3.6, 5.0) + 3.0, 3) * 0.5 + 0.5) * (0.35 + 0.65 * src), 0.0, 1.0);
    float det = max(chBubbles(wq, 80.0, dens * 1.1, fp) * 0.85, chBubbles(wq + 0.37, 190.0, dens * 1.25, fp) * 0.7);
    chFoam = clamp(mix(dens * 0.45, det, 1.0 - smoothstep(0.004, 0.02, fp)) * (0.4 + 0.4 * src), 0.0, 0.8);
  }
  vec3 white = vec3(0.86, 0.88, 0.87) * (sunC * (0.15 + 0.85 * max(Ls.y, 0.0) + 1.2 * pow(max(dot(-V, Ls), 0.0), 3.0)) + Eamb * 0.85 + lampE) / 3.14159;
  vec3 col = refl + (1.0 - F) * Lrefr + reflectedLight.directSpecular;
  reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
  reflectedLight.directSpecular = mix(col, white, chFoam);
}`;

/** A straight open channel of running water: { water (Mesh), body (BufferGeometry: inner walls and bed), uniforms }.
 *  options: from, to ([x, z]: the water flows from -> to), y (the rim's height, 0), width (inside, 0.5), depth (rim
 *  to bed, 0.35), water (its depth, 0.12), speed (m/s, 0.6), turbulence (0..1, 0.6), foam (at the inflow, 0..1, 0.8),
 *  wall / bed (linear albedo of the concrete the shader sees under and across the water). */
export function channelWater(world, { from, to, y = 0, width = 0.5, depth = 0.35, water = 0.12, speed = 0.6, turbulence = 0.6, foam = 0.8, wall = [0.3, 0.29, 0.27], bed = [0.22, 0.2, 0.17] } = {}) {
  const dx = to[0] - from[0], dz = to[1] - from[1], L = Math.hypot(dx, dz);
  if (!(L > 0) || !(width > 0) || !(depth > water) || !(water > 0)) throw new RangeError('channelWater: from != to, width > 0, depth > water > 0');
  const tx = dx / L, tz = dz / L, bx = -tz, bz = tx, hw = width / 2, yw = y - depth + water, yb = y - depth;
  const uniforms = {
    uChA: { value: new THREE.Vector4(from[0], from[1], tx, tz) }, uChDim: { value: new THREE.Vector4(hw, water, depth - water, L) },
    uChFlow: { value: new THREE.Vector4(speed, turbulence, foam, 0) }, uChWall: { value: new THREE.Vector3(...wall) }, uChBed: { value: new THREE.Vector3(...bed) },
    ...WET, mgWetP: { value: new THREE.Vector4() }, mgWetQ: { value: new THREE.Vector4() },
  };
  const hooks = withFlash({ fragmentDecl: WET_GLSL + CH_GLSL, normal: CH_NORMAL, uniforms, defines: { MG_WET: '' }, specAA: 1 });
  hooks.lighting += '\n' + CH_LIGHT;
  // writes depth, sorts and fogs like any surface; the roughness the screen passes see stays above their mirror's
  hooks.output = 'material.roughness = max(material.roughness, 0.45);';
  const m = world.mat.std({ color: 0xffffff, roughness: 0.1, metalness: 0 }, hooks);
  m.name = 'mg-channel-water';
  // the surface: a strip across the channel's width, a vertex every 0.25 m along it
  const n = Math.max(1, Math.ceil(L / 0.25)), P = [], I = [];
  const at = (s, a, yy) => [from[0] + tx * s + bx * a, yy, from[1] + tz * s + bz * a];
  for (let i = 0; i <= n; i++) { const s = (L * i) / n; P.push(...at(s, -hw, yw), ...at(s, hw, yw)); if (i < n) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(I); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'mg-channel-water'; mesh.receiveShadow = true; mesh.castShadow = false;
  // the body: the two inner walls (facing in) and the bed, as quads
  const BP = [], BN = [], BI = [];
  const quad = (p0, p1, p2, p3, nn) => { const k = BP.length / 3; BP.push(...p0, ...p1, ...p2, ...p3); for (let i = 0; i < 4; i++) BN.push(...nn); BI.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); };
  quad(at(0, -hw, y), at(L, -hw, y), at(0, -hw, yb), at(L, -hw, yb), [bx, 0, bz]);
  quad(at(L, hw, y), at(0, hw, y), at(L, hw, yb), at(0, hw, yb), [-bx, 0, -bz]);
  quad(at(0, -hw, yb), at(L, -hw, yb), at(0, hw, yb), at(L, hw, yb), [0, 1, 0]);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(BP, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(BN, 3));
  body.setIndex(BI); body.computeBoundingSphere();
  return { water: mesh, body, uniforms, material: m };
}

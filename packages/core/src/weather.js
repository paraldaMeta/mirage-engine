// Mirage original code. The lightning's look (one shared flash uniform that every open-sky material adds as a cold
// light with a wet glint; a branching bolt rebuilt per strike; a leader / return stroke / re-strike envelope) follows
// the technique of the owner's Nizwa project (src/maps/qulzum-mat.js, qulzum-sea.js), re-implemented here.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Lightning (opt-in): createWorldRenderer({ flash: true | { intensity, color, bolt } }) -> world.flash.
//
//   world.flash.set(level, dir)   level 0..1 (the flash's brightness this frame), dir: toward the flash (world)
//   world.flash.strike(from, to)  a new bolt from `from` (the cloud) to `to` (where it ends), drawn while level > 0.3
//   world.flash.envelope(t, k)    the level t s after a strike: k = 1 a leader, the return stroke and a re-strike
//                                 (three pulses in 0.4 s); k < 1 one smooth pulse at k (no flicker: comfort)
//
// The flash lights the materials that opt in: every withWet material does (the wet layer reads it), any other
// Standard / Physical one with withFlash(hooks). Each adds, while the level is above 0, a cold diffuse light from the
// flash's direction plus the whole cloud's (the open sky's share: up-facing more, sheltered less) and the flash
// reflected in it: three's own BRDF for the bolt's direction (a sharp glint on water and wet paint) and a broad lobe
// for the lit cloud (wet, smooth surfaces glint; rough dry ones barely). The sky reads it too (sky.js storm).
// Off: the code is compiled only under the define MG_FLASH, set on the opted-in materials while a world with the
// option exists (enableFlash), so without it every program is the one it was and the image is bit-identical.
// ponytail: the uniforms are page-global (one sky per page), like the wetness's.
// ---------------------------------------------------------------------------

/** The flash's page-global uniforms: uFlash = colour x irradiance (already exposure-compensated), uFlashDir toward it. */
export const FLASH = {
  uFlash: { value: new THREE.Vector3() },
  uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
};
const state = { on: 0 };
const mats = new Set();
function sync(m) {
  const on = state.on > 0, has = !!m.defines && 'MG_FLASH' in m.defines;
  if (on === has) return;
  if (on) m.defines = { ...(m.defines || {}), MG_FLASH: '' };
  else { const { MG_FLASH, ...rest } = m.defines; m.defines = rest; }
  m.needsUpdate = true;
}
function syncAll() { for (const r of mats) { const m = r.deref(); if (!m) mats.delete(r); else sync(m); } }
/** Count a user of the flash (a world with the option): while any exists the opted-in materials compile its code.
 *  enableFlash(false) gives one back. Returns whether it is on. */
export function enableFlash(on = true) {
  state.on = Math.max(0, state.on + (on ? 1 : -1));
  if (!state.on) FLASH.uFlash.value.set(0, 0, 0);
  syncAll();
  return state.on > 0;
}
/** whether a flash is on (some world has the option) */
export const flashEnabled = () => state.on > 0;

// declarations (fragmentDecl) and the body (the lighting hook, after <lights_fragment_end>, where three's material,
// normal and geometryViewDir are in scope: the body is inline, its BRDFs are declared after the hooks' declarations).
// MG_FLASH_OPEN: 0..1 the open sky's share at the pixel (the caller's shelter)
export const FLASH_GLSL = /* glsl */ `
#ifdef MG_FLASH
#ifndef MG_FLASH_GLSL
#define MG_FLASH_GLSL
uniform vec3 uFlash;
uniform vec3 uFlashDir;
#endif
#endif
`;
export const FLASH_LIGHT_GLSL = /* glsl */ `
if (uFlash.x + uFlash.y + uFlash.z > 0.0) {
  float fOpen = MG_FLASH_OPEN;
  vec3 fN = normal, fV = geometryViewDir;
  vec3 fNW = normalize((vec4(fN, 0.0) * viewMatrix).xyz);
  // the open sky's share: a wall sees half of it, an underside little; sheltered surfaces less
  float fSky = fOpen * (0.3 + 0.7 * smoothstep(-0.6, 0.9, fNW.y));
  vec3 fL = normalize((viewMatrix * vec4(uFlashDir, 0.0)).xyz);
  float fNdL = max(dot(fN, fL), 0.0);
  // diffuse: the bolt's direction and the lit cloud round it
  reflectedLight.directDiffuse += uFlash * fSky * (0.35 + 0.65 * fNdL) * BRDF_Lambert(material.diffuseContribution);
  // the bolt itself, through the material's own BRDF (a sharp glint on water, wet paint, glass)
  reflectedLight.directSpecular += uFlash * fSky * fNdL * BRDF_GGX(fL, fV, fN, material) * 0.6;
  // the lit cloud mirrored: a broad lobe toward the flash and a little of the whole deck, as strong as the surface is
  // smooth (wet); Fresnel by the view
  vec3 fR = reflect(-fV, fN);
  float fLobe = pow(max(dot(fR, fL), 0.0), 12.0) + 0.15 * smoothstep(0.0, 0.6, dot(fR, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
  float fSmooth = 1.0 - smoothstep(0.08, 0.55, material.roughness);
  float fNv = clamp(dot(fN, fV), 0.0, 1.0);
  vec3 fF = material.specularColorBlended + (1.0 - material.specularColorBlended) * pow(1.0 - fNv, 5.0);
  reflectedLight.directSpecular += uFlash * fOpen * fF * fLobe * fSmooth * 0.6;
}
`;

const isUniform = (v) => !!v && typeof v === 'object' && 'value' in v;
const glf = (v) => { const n = +(+v).toFixed(5); return Number.isInteger(n) ? n.toFixed(1) : String(n); };

/** The flash on a hooks object (Standard / Physical). options: shelter (0..1 where the sky is hidden: a number, a
 *  GLSL float of the material or a { value } uniform; 0). withWet applies it with the wet layer's own shelter
 *  (internal: `open`, a GLSL float in place of the shelter, and `inside`, a macro the whole of it is compiled under). */
export function withFlash(h = {}, { shelter = 0, open = null, inside = null } = {}) {
  if (h.__flash) return h;
  if (shelter != null && !['number', 'string'].includes(typeof shelter) && !isUniform(shelter)) throw new TypeError('withFlash: shelter must be a number, a GLSL float or a { value } uniform');
  const U = open == null && isUniform(shelter);
  const op = open != null ? open : typeof shelter === 'number' ? glf(1 - Math.max(0, Math.min(1, shelter))) : `(1.0 - clamp((${U ? 'mgFlashShelter' : shelter}), 0.0, 1.0))`;
  const wrap = (g) => (inside ? `#ifdef ${inside}\n${g}\n#endif` : g);
  const code = wrap(`#if defined(MG_FLASH) && defined(STANDARD)\n{\n#define MG_FLASH_OPEN (${op})\n${FLASH_LIGHT_GLSL}#undef MG_FLASH_OPEN\n}\n#endif`);
  const out = {
    ...h,
    fragmentDecl: (h.fragmentDecl || '') + '\n' + wrap(FLASH_GLSL + (U ? '#ifdef MG_FLASH\nuniform float mgFlashShelter;\n#endif\n' : '')),
    lighting: (h.lighting ? h.lighting + '\n' : '') + code,
    uniforms: { ...(h.uniforms || {}), ...FLASH, ...(U ? { mgFlashShelter: shelter } : {}) },
    attach: (m) => { mats.add(new WeakRef(m)); sync(m); if (h.attach) h.attach(m); },
  };
  Object.defineProperty(out, '__flash', { value: true, enumerable: false });
  return out;
}

/** createWorldRenderer's flash option -> settings or null (off). */
export function flashConfig(c) {
  if (!c) return null;
  const o = c === true ? {} : c;
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  return { intensity: Math.max(0, n(o.intensity, 2.5)), color: o.color ? [...o.color] : [0.78, 0.86, 1.0], bolt: o.bolt !== false, boltGain: Math.max(0, n(o.boltGain, 30)) };
}

/** The flash's level t seconds after a strike (Nizwa's shape): k >= 1 a leader, the return stroke, a re-strike and an
 *  afterglow; below 1 one smooth pulse at k (about 0.5 s, no flicker). */
export function flashEnvelope(t, k = 1) {
  if (!(t >= 0) || t > 1.6) return 0;
  if (k < 1) { const u = Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.08) * 5); return Math.max(0, k) * u * u * (3 - 2 * u); }
  const p = (c, w) => Math.exp(-((t - c) * (t - c)) / (w * w));
  return Math.max(p(0.04, 0.035) * 0.55, p(0.13, 0.05), p(0.36, 0.06) * 0.8, t > 0.36 ? Math.exp(-(t - 0.4) * 4) * 0.25 : 0);
}

/** The flash of one world: { set(level, dir), strike(from, to, seed), envelope, level, dir, bolt (a Mesh or null),
 *  dispose }. gain(): the world's exposure compensation (so the flash holds its look at any hour's exposure). */
export function createFlash({ scene, gain = () => 1 }, cfg) {
  enableFlash(true);
  const color = new THREE.Vector3(...cfg.color), dir = new THREE.Vector3(0, 1, 0);
  const bolt = cfg.bolt ? makeBolt() : null;
  if (bolt) scene.add(bolt.mesh);
  let level = 0, alive = true;
  const api = {
    get level() { return level; },
    dir,
    bolt: bolt ? bolt.mesh : null,
    envelope: flashEnvelope,
    /** level 0..1 this frame; dir (optional): toward the flash, world space */
    set(l, d) {
      if (!alive) return;
      level = Math.max(0, Math.min(1, +l || 0));
      if (d) { dir.set(d[0] ?? d.x, d[1] ?? d.y, d[2] ?? d.z); if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0); dir.normalize(); FLASH.uFlashDir.value.copy(dir); }
      FLASH.uFlash.value.copy(color).multiplyScalar(level * cfg.intensity * gain());
      if (bolt) { bolt.u.uBolt.value.copy(FLASH.uFlash.value).multiplyScalar(cfg.boltGain * THREE.MathUtils.smoothstep(level, 0.25, 0.7)); bolt.mesh.visible = level > 0.25 && bolt.n > 0; }
    },
    /** a new bolt: from (the cloud) to (where it ends), [x, y, z]; seed: its shape; eye: where it is seen from (its quads face it) */
    strike(from, to, seed = 1, eye = null) { if (bolt) bolt.build(from, to, seed, eye); },
    dispose() { if (!alive) return; alive = false; if (bolt) { scene.remove(bolt.mesh); bolt.mesh.geometry.dispose(); bolt.mesh.material.dispose(); } enableFlash(false); },
  };
  return api;
}

// a branching strike: quads along a jagged path, each one turned to face the eye
function makeBolt() {
  const MAXQ = 200;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * 3), 3));
  g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * 2), 2));
  const idx = new Uint16Array(MAXQ * 6);
  for (let i = 0; i < MAXQ; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  const u = { uBolt: { value: new THREE.Vector3() } };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'attribute vec2 aW; varying vec2 vW; void main(){ vW = aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // a hot core, a soft glow to the quad's edges; brightness by the branch's weight
    fragmentShader: 'uniform vec3 uBolt; varying vec2 vW; void main(){ float c = exp(-vW.x * vW.x * 6.0); gl_FragColor = vec4(uBolt * vW.y * (c * c * 2.0 + c * 0.4), 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false,
  });
  m.name = 'mg-bolt';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'mg-bolt'; mesh.frustumCulled = false; mesh.renderOrder = 1001; mesh.visible = false;
  const B = { mesh, u, n: 0 };
  B.build = (from, to, seed, eye) => {
    let s = (Math.abs(Math.floor(seed * 9301 + 49297)) % 2147483646) + 1;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const A = new THREE.Vector3(...from), Z = new THREE.Vector3(...to), len = A.distanceTo(Z), segs = [];
    const walk = (p0, goal, n, w, depth) => {
      let p = p0.clone();
      for (let i = 0; i < n && segs.length < MAXQ; i++) {
        const rest = goal.clone().sub(p), steps = n - i, q = p.clone().addScaledVector(rest, 1 / steps);
        const j = rest.length() / steps;
        q.x += (rand() - 0.5) * j * 1.3; q.z += (rand() - 0.5) * j * 1.3; q.y += (rand() - 0.5) * j * 0.3;
        segs.push([p, q, w * (1 - 0.45 * i / n)]);
        if (depth < 2 && rand() < (depth ? 0.12 : 0.2)) {
          const side = new THREE.Vector3(rand() - 0.5, -0.6 - rand() * 0.5, rand() - 0.5).normalize().multiplyScalar(len * (depth ? 0.12 : 0.25));
          walk(q, q.clone().add(side), depth ? 5 : 9, w * 0.45, depth + 1);
        }
        p = q;
      }
    };
    walk(A, Z, 26, Math.max(0.6, len * 0.006), 0);
    const P = g.attributes.position.array, W = g.attributes.aW.array, E = eye ? new THREE.Vector3(...eye) : A.clone().add(Z).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, 100)), side = new THREE.Vector3(), t = new THREE.Vector3(), v = new THREE.Vector3();
    segs.forEach(([a, b, w], i) => {
      t.subVectors(b, a).normalize(); v.subVectors(E, a).normalize();
      side.crossVectors(t, v); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize().multiplyScalar(w * 2);
      const o = i * 12;
      P.set([a.x + side.x, a.y + side.y, a.z + side.z, a.x - side.x, a.y - side.y, a.z - side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z], o);
      const k = Math.min(1, w / segs[0][2]);
      W.set([1, k, -1, k, 1, k, -1, k], i * 8);
    });
    B.n = segs.length;
    g.setDrawRange(0, segs.length * 6);
    g.attributes.position.needsUpdate = true; g.attributes.aW.needsUpdate = true;
  };
  return B;
}

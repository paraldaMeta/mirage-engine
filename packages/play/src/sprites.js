// Mirage original code. Brought in from a game built on Mirage (2D sprites in a lit 3D world); guide:
// docs/sprites-25d.md.
// ---------------------------------------------------------------------------
// A 2D character standing in a lit 3D world: a card whose picture is the atlas cell for its animation and its
// facing as seen from the camera, lit by exactly what lights the world, because its material is a patch()ed
// MeshStandardMaterial (world.mat.std): the sun and its shadow map, the sky's image-based light, PointLights and
// the lamp pool, fog, the time-of-day grade. A night sprite beside a lantern warms without a line of game code.
//
//   const atlas = await loadAtlas('/sprites/hero/atlas.json', { placeholder: { shape: 'humanoid' } });
//   const hero = createSpriteActor(world, atlas, { silhouette: true, ground: (x, z) => grid.groundAt(x, z) });
//   hero.play('attack', { onHit: () => strike(), onEnd: () => hero.play('idle') });
//   each frame: hero.group.position.set(...feet); hero.setFacing(angle); hero.update(dt, iso.yaw);
//
// The card. Geometry is a unit quad; the vertex hook builds three points per corner from the feet (the mesh's
// position):
//   P1  on a card facing the camera (its up = the camera's up): where the corner shows on screen, so the art keeps
//       its drawn proportions under a high pitch;
//   Pv  on a vertical card through the feet, facing the camera's yaw, at true height: the world position the
//       lighting, shadows, fog and lamps see (mgWorld), so they fall on the body and not on a point behind it;
//   P2  where the eye ray through P1 meets that vertical plane: the depth. A card leaning back with the camera would
//       cut into walls and slopes behind the feet; the vertical plane occludes like a standing body.
// gl_Position keeps P1's x, y, w (the texture maps as drawn) and takes P2's depth (z/w is affine in screen space for
// a plane, so the interpolated depth is that plane's exactly).
// Fragment: the cell, alpha-tested at 0.5 (no blending: depth stays exact, no sorting); a shading normal between
// up, the camera and the sun (the art carries its own shading; a camera-facing normal turns every back-lit sprite
// black at golden hour); wrapped direct light; an outline from the neighbouring texels' alpha; a hit flash; a
// dithered fade. Outline and flash are divided by the frame's exposure so they read the same at noon and at night.
// All per-sprite state is uniforms: every sprite shares one program.
// ponytail: one mesh per actor (two draws, three with the silhouette). Fine for tens of actors; crowds of hundreds
// want an InstancedMesh per atlas with the uniforms as instance attributes. Sprites are drawn into environment
// captures like any mesh.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { parseAtlas, spriteDirection, createSpriteAnim } from './sprite-atlas.js';
import { makePlaceholderAtlas } from './sprite-placeholder.js';

export { spriteDirection, drawnDirection, parseAtlas, createSpriteAnim } from './sprite-atlas.js';
export { makePlaceholderAtlas } from './sprite-placeholder.js';

/** The atlas data (parseAtlas) with its texture. `image`: an image, a canvas, an ImageBitmap or a THREE.Texture. */
export function makeAtlas(json, image, { pixelArt = !!(json && json.pixelArt), source = 'file' } = {}) {
  const texture = image && image.isTexture ? image : new THREE.Texture(image);
  const img = texture.image || {};
  const atlas = parseAtlas(json, { width: img.width, height: img.height });
  if (!image.isTexture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }
  atlas.texture = texture;
  atlas.source = source;
  return atlas;
}

/**
 * Fetch `url` (an atlas.json) and its image (`json.image`, else atlas.png beside it). When the files are missing or
 * wrong and `placeholder` is a spec (makePlaceholderAtlas), a placeholder in the same format is returned instead
 * (`atlas.source === 'placeholder'`), so a game runs before its art exists; without one, the error is thrown.
 * ponytail: not cached; keep the promise per id if several actors share an atlas.
 */
export async function loadAtlas(url, { placeholder = null, fetch: get = globalThis.fetch, pixelArt } = {}) {
  try {
    const base = new URL(url, globalThis.location ? globalThis.location.href : 'file:///');
    const res = await get(base.href, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const json = await res.json();
    const img = new Image();
    img.decoding = 'async';
    img.src = new URL(json.image || 'atlas.png', base).href;
    await img.decode();
    return makeAtlas(json, img, { pixelArt: pixelArt ?? !!json.pixelArt });
  } catch (e) {
    if (!placeholder) throw e;
    const { json, canvas } = makePlaceholderAtlas(placeholder === true ? {} : placeholder);
    return makeAtlas(json, canvas, { source: 'placeholder' });
  }
}

const VERT_DECL = /* glsl */ `
uniform vec4 uRect; uniform vec4 uCard; uniform float uFlip; uniform float uLift;
varying vec2 spUv;`;

const VERT_WORLD = /* glsl */ `
  vec2 spQ = position.xy;
  float spPivot = uFlip > 0.5 ? 1.0 - uCard.z : uCard.z;
  float spX = (spQ.x - spPivot) * uCard.x, spY = (spQ.y - uCard.w) * uCard.y + uLift;
  vec3 spF = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 spR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 spU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 spN = cameraPosition - spF; spN.y = 0.0; spN = normalize(spN + vec3(1e-5, 0.0, 0.0));
  vec3 spRh = normalize(vec3(spR.x, 0.0, spR.z) + vec3(0.0, 0.0, 1e-5));
  vec3 spP1 = spF + spR * spX + spU * spY;
  float spDen = dot(spP1 - cameraPosition, spN);
  vec3 spP2 = cameraPosition + (spP1 - cameraPosition) * (dot(spF - cameraPosition, spN) / min(spDen, -1e-4));
  mgWorld = spF + spRh * spX + vec3(0.0, spY, 0.0);
  spUv = uRect.xy + vec2(uFlip > 0.5 ? 1.0 - spQ.x : spQ.x, spQ.y) * uRect.zw;`;

const VERT_CLIP = /* glsl */ `
  { vec4 spC1 = projectionMatrix * viewMatrix * vec4(spP1, 1.0), spC2 = projectionMatrix * viewMatrix * vec4(spP2, 1.0);
    gl_Position = vec4(spC1.xy, spC2.z / spC2.w * spC1.w, spC1.w); }`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uAtlas; uniform vec4 uRect; uniform vec2 uTexel; uniform vec3 uTint; uniform vec4 uOutline;
uniform float uFlash; uniform float uFade; uniform float uEmit;
varying vec2 spUv;
float spEdge = 0.0;
float spAlphaAt(vec2 o) { return texture2D(uAtlas, clamp(spUv + o * uTexel, uRect.xy + uTexel * 0.5, uRect.xy + uRect.zw - uTexel * 0.5)).a; }`;

const FRAG_ALBEDO = /* glsl */ `
  vec4 spT = texture2D(uAtlas, spUv);
  if (spT.a < 0.5) {
    float e = 0.0;
    if (uOutline.a > 0.0) {
      float r = uOutline.a;
      e = max(max(spAlphaAt(vec2(r, 0.0)), spAlphaAt(vec2(-r, 0.0))), max(spAlphaAt(vec2(0.0, r)), spAlphaAt(vec2(0.0, -r))));
      e = max(e, max(max(spAlphaAt(vec2(r, r) * 0.7), spAlphaAt(vec2(-r, r) * 0.7)), max(spAlphaAt(vec2(r, -r) * 0.7), spAlphaAt(vec2(-r, -r) * 0.7))));
    }
    if (e < 0.5) discard;
    spEdge = 1.0;
  }
  if (uFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > uFade) discard;
  diffuseColor.rgb *= spT.rgb * uTint;`;

const FRAG_NORMAL = /* glsl */ `
  {
    vec3 c = cameraPosition - mgWorldPos; c.y = 0.0; c = normalize(c + vec3(1e-5, 0.0, 0.0));
    vec3 k = vec3(uKeyDir.x, 0.0, uKeyDir.z); float kl = length(k); k = kl > 1e-3 ? k / kl : c;
    vec3 n = normalize(vec3(0.0, 0.6, 0.0) + c * 0.7 + k * 0.3);
    normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
  }`;

const FRAG_OUTPUT = /* glsl */ `
  outgoingLight = mix(outgoingLight, uOutline.rgb * uEmit, spEdge);
  outgoingLight = mix(outgoingLight, vec3(1.0, 0.92, 0.85) * uEmit * 0.9, uFlash);`;

// Wrapped direct light: a flat card stands for a round body, so a light behind or beside it still lights it (35 %
// from straight behind, 100 % from the front) instead of three's Lambert cut-off at 90°. The shadow map, the lamp
// pool and every PointLight go through RE_Direct, so all of them wrap.
const WRAP = /* glsl */ `
void RE_Direct_Sprite( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight spL = directLight;
  spL.color *= 0.35 + 0.65 * ( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
  spL.direction = geometryNormal;
  RE_Direct_Physical( spL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Sprite
`;

// The emissive scale per world: 1 / the frame's exposure (post x auto exposure x grade), kept in step by a
// ctx.onUpdate subscription made with the world's first sprite (world.dispose() drops it).
const emits = new WeakMap();
function emitFor(world) {
  let u = emits.get(world);
  if (u) return u;
  u = { value: 1 };
  emits.set(world, u);
  if (world.ctx && typeof world.ctx.onUpdate === 'function' && world.post) {
    world.ctx.onUpdate(() => {
      const ex = (world.post.exposure ?? 1) * (world.exposure || 1) * (world.gradeLook ? world.gradeLook.exposure : 1);
      u.value = 1 / Math.max(1e-4, ex);
    });
  }
  return u;
}

function spriteUniforms(world, atlas) {
  return {
    uAtlas: { value: atlas.texture },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uCard: { value: new THREE.Vector4(atlas.width, atlas.height, atlas.feetU, atlas.feetV) },
    uTexel: { value: new THREE.Vector2(atlas.texel[0], atlas.texel[1]) },
    uFlip: { value: 0 }, uLift: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uOutline: { value: new THREE.Vector4(1, 1, 1, 0) },   // rgb, width in texels (0 = off)
    uFlash: { value: 0 }, uFade: { value: 1 },
    uEmit: emitFor(world),
  };
}

function withClip(material, wrap) {
  const inner = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('vec4 worldPosition = vec4( mgWorld, 1.0 );', 'vec4 worldPosition = vec4( mgWorld, 1.0 );\n' + VERT_CLIP);
    if (wrap) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + WRAP);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => key() + 'sprite';
  return material;
}

/**
 * The lit card material for one actor: a world.mat.std material (patch() hooks) with its own uniforms
 * (`material.userData.sprite`); every sprite shares one program. `world`: a world renderer (or a module ctx).
 */
export function createSpriteMaterial(world, atlas) {
  const uniforms = spriteUniforms(world, atlas);
  const m = world.mat.std({ roughness: 1, metalness: 0, side: THREE.DoubleSide }, {
    uniforms, vertexDecl: VERT_DECL, vertexWorld: VERT_WORLD, fragmentDecl: FRAG_DECL,
    albedo: FRAG_ALBEDO, normal: FRAG_NORMAL, output: FRAG_OUTPUT, specAA: false,
  });
  m.userData.sprite = uniforms;
  return withClip(m, true);
}

/**
 * The see-through silhouette: the same card drawn only where something stands in front of it (depthFunc
 * GreaterDepth), flat `color`, blended. Shares `uniforms` (the card's), so it follows the card's cell and flip.
 */
export function createSilhouetteMaterial(world, uniforms, { color = [0.55, 0.8, 1.0], opacity = 0.42 } = {}) {
  const sil = { ...uniforms, uSil: { value: new THREE.Vector3(color[0], color[1], color[2]) } };
  const m = world.mat.patch(new THREE.MeshBasicMaterial({
    transparent: true, opacity, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide,
  }), {
    uniforms: sil, vertexDecl: VERT_DECL, vertexWorld: VERT_WORLD,
    fragmentDecl: FRAG_DECL + '\nuniform vec3 uSil;',
    albedo: FRAG_ALBEDO.replace('if (uOutline.a > 0.0)', 'if (false)'),
    output: 'outgoingLight = uSil * uEmit * 0.6;',
  });
  m.userData.sprite = sil;
  return withClip(m, false);
}

// shared by every actor of the page (never disposed: a few hundred bytes)
let QUAD = null, BLOB_GEO = null, BLOB_TEX = null;
function shared() {
  if (QUAD) return;
  QUAD = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  BLOB_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // a soft round shadow: alpha 1 in the middle, 0.75 at 45 % of the radius, 0 at the rim
  const N = 64, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2);
    const a = r < 0.45 ? 1 - (r / 0.45) * 0.25 : r < 1 ? 0.75 * (1 - (r - 0.45) / 0.55) : 0;
    px[(j * N + i) * 4 + 3] = Math.round(a * 255);
  }
  BLOB_TEX = new THREE.DataTexture(px, N, N);
  BLOB_TEX.magFilter = BLOB_TEX.minFilter = THREE.LinearFilter;
  BLOB_TEX.needsUpdate = true;
}

const OUTLINES = { hover: [1.6, 1.5, 1.1], enemy: [1.9, 0.55, 0.4], friend: [0.7, 1.7, 0.95], select: [1.8, 1.4, 0.5] };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/**
 * A sprite actor: the card, a blob shadow under its feet (tilted to the ground's slope when `ground(x, z)` is
 * given), an optional silhouette (`silhouette: true | { color, opacity }`: shows it through whatever stands in front,
 * so a high camera never has to dodge walls). Move `actor.group`; call `update(dt, yaw)` each frame with the camera's
 * yaw (a number or anything with `.yaw`). Every mesh is `userData.collide = false` (the walk grid ignores it).
 */
export function createSpriteActor(world, atlas, { parent = world.scene, shadow = 0.42, shadowOpacity = 0.32, silhouette = false, ground = null } = {}) {
  shared();
  const group = new THREE.Group();
  group.userData.collide = false;
  const mat = createSpriteMaterial(world, atlas), U = mat.userData.sprite;
  const card = new THREE.Mesh(QUAD, mat);
  card.frustumCulled = false;              // the vertex shader places it: the quad's own bounds mean nothing
  card.castShadow = false; card.receiveShadow = true;
  card.userData.collide = false;
  card.renderOrder = 1;
  const blobMat = new THREE.MeshBasicMaterial({ map: BLOB_TEX, color: 0x000000, transparent: true, opacity: shadowOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const blob = new THREE.Mesh(BLOB_GEO, blobMat);
  const bw = Math.max(0.35, atlas.width * shadow * 2);
  blob.scale.set(bw, 1, bw * 0.8);
  blob.userData.collide = false; blob.castShadow = blob.receiveShadow = false;
  group.add(blob, card);
  let sil = null;
  if (silhouette) {
    sil = new THREE.Mesh(QUAD, createSilhouetteMaterial(world, U, silhouette === true ? {} : silhouette));
    sil.frustumCulled = false; sil.renderOrder = 10; sil.userData.collide = false;
    group.add(sil);
  }
  if (parent) parent.add(group);

  const anim = createSpriteAnim(atlas);
  const st = { facing: 0, dir: 0, flash: 0, lift: 0 };
  const n = new THREE.Vector3(), q = new THREE.Quaternion();

  const actor = {
    group, card, blob, silhouette: sil, atlas, uniforms: U, anim,
    get name() { return anim.name; },
    /** the screen direction 0..7 of the last update */
    get dir() { return st.dir; },
    get facing() { return st.facing; },
    /** face a world direction: radians, atan2(dx, dz) (0 = +Z) */
    setFacing(a) { st.facing = a; return actor; },
    faceToward(x, z) { const p = group.position; if (Math.hypot(x - p.x, z - p.z) > 1e-3) st.facing = Math.atan2(x - p.x, z - p.z); return actor; },
    /** play an animation (createSpriteAnim's rules: missing ones fall back to idle; onHit on the hit frame, onEnd) */
    play(name, options) { anim.play(name, options); return actor; },
    /** seconds one run of an animation lasts at speed 1 */
    duration: (name) => atlas.duration(name),
    /** a white flash that fades in about 0.15 s (k: 0..1); flash(0) clears one */
    flash(k = 1) { st.flash = k > 0 ? Math.max(st.flash, k) : 0; U.uFlash.value = st.flash * 0.75; return actor; },
    /** 'hover' | 'enemy' | 'friend' | 'select' | [r, g, b] (linear, may exceed 1) | null; width in texels */
    outline(kind, width = 4) {
      if (!kind) { U.uOutline.value.w = 0; return actor; }
      const c = Array.isArray(kind) ? kind : OUTLINES[kind] || OUTLINES.hover;
      U.uOutline.value.set(c[0], c[1], c[2], width);
      return actor;
    },
    setTint(r, g, b) { U.uTint.value.set(r, g, b); return actor; },
    /** 0..1, dithered (no blending); the blob fades with it */
    setFade(k) { U.uFade.value = k; blobMat.opacity = shadowOpacity * k; return actor; },
    /** raise the card off the ground (m): a jump, a flying creature */
    setLift(m) { st.lift = m; return actor; },
    set visible(v) { group.visible = v; }, get visible() { return group.visible; },
    update(dt, yaw = 0) {
      st.dir = spriteDirection(st.facing, typeof yaw === 'number' ? yaw : yaw.yaw);
      const f = anim.update(dt, st.dir);
      U.uRect.value.set(f.rect[0], f.rect[1], f.rect[2], f.rect[3]);
      U.uFlip.value = f.flip ? 1 : 0;
      U.uLift.value = st.lift;
      st.flash = Math.max(0, st.flash - dt * 6);
      U.uFlash.value = st.flash * 0.75;
      const p = group.position;
      blob.quaternion.identity(); blob.position.y = 0.03;
      if (ground) {
        const e = 0.35, h0 = ground(p.x, p.z), hx = ground(p.x + e, p.z), hz = ground(p.x, p.z + e);
        if (Number.isFinite(h0) && Number.isFinite(hx) && Number.isFinite(hz)) {
          n.set(-(hx - h0) / e, 1, -(hz - h0) / e).normalize();
          blob.quaternion.copy(q.setFromUnitVectors(UP, n));
          blob.position.y = h0 - p.y + 0.03;
        }
      }
      return st.dir;
    },
    /**
     * The card's rectangle on screen in pixels { x0, y0, x1, y1, cx, cy, depth } for picking (the vertex shader
     * places the card, so a CPU raycast cannot see it). The camera's matrices must be current.
     */
    screenRect(camera, width, height, out = {}) {
      const p = group.position;
      const v = _v.set(p.x, p.y + st.lift, p.z).project(camera);
      const e = camera.matrixWorld.elements, hh = atlas.height * 0.95;   // the card's up is the camera's up
      const top = _v2.set(p.x + e[4] * hh, p.y + st.lift + e[5] * hh, p.z + e[6] * hh).project(camera);
      const hpx = (top.y - v.y) * 0.5 * height, cx = (v.x * 0.5 + 0.5) * width, cy = (-v.y * 0.5 + 0.5) * height;
      const half = (hpx * atlas.width / atlas.height) * 0.42;
      out.x0 = cx - half; out.x1 = cx + half; out.y0 = cy - hpx; out.y1 = cy + 4; out.depth = v.z; out.cx = cx; out.cy = cy;
      return out;
    },
    /** removes the group and frees its materials (the atlas texture is the caller's) */
    dispose() {
      group.removeFromParent();
      mat.dispose(); blobMat.dispose(); if (sil) sil.material.dispose();
    },
  };
  return actor;
}

// shafts: light you can see in a room, through its openings, with dust turning in it. Adapted from the Nizwa Golden
// Hour project's src/maps/bursa-fx.js (the owner's own code): a shaft is the oblique prism an opening (origin O,
// edges E1, E2) sweeps along -L (L toward the light); in the coordinates q = Minv (p - O) (Minv the inverse of
// [E1 E2 -L]) it is the box [0,1]^2 x [0,tMax], so each fragment of the prism intersects the view ray with that box
// (and with the room's box: walls stop it) and adds in-scatter over the length inside, a few noise taps for drifting
// dust; the prism's corners follow the light every frame; a wall's depth trims the lit part of the opening.
// Added here: two kinds of light, the key light (the sun by day, the moon by night: its colour and direction from the
// world, G.uKeyColor / G.uKeyDir) and a lamp's spill (a street lamp or a sign outside, from its position, on with the
// lamp level); a forward-scatter phase (brighter looking toward the light); a test that the light reaches the opening
// at all (setSee: a ray through the physics world toward the light, every 0.25 s, eased), so a shaft is there only
// when the sun or the lamp really shines in; motes that drift in the prism, lit only while the light comes through;
// the prism drawn from inside (back faces, so a wall behind it bounds it) or outside (front faces) by where the eye is.
//   const S = shafts(ctx)            the world's one shaft system (ctx.shared.shafts), made on first use
//   S.add({ o, e1, e2, out, depth, floorY, clip, dens, motes, kind: 'key' | 'spill', src, color, power, tint, maxLen })
//   S.setSee((from, dir, max) => blocked?)   main.js gives it the physics world's ray
import * as THREE from 'three';

const VS = /* glsl */ `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = /* glsl */ `
uniform mat3 uMinv; uniform vec3 uO, uL, uCol, uCMin, uCMax; uniform float uTMax, uDens, uTime, uBack;
varying vec3 vW;
float hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1,0,0)), f.x), mix(hh(i + vec3(0,1,0)), hh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh(i + vec3(0,0,1)), hh(i + vec3(1,0,1)), f.x), mix(hh(i + vec3(0,1,1)), hh(i + vec3(1,1,1)), f.x), f.z), f.z); }
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
  float tFace = length(vW - cameraPosition);
  vec3 qo = uMinv * (ro - uO), qd = uMinv * rd;
  vec3 inv = 1.0 / qd, t0 = (vec3(0.0) - qo) * inv, t1 = (vec3(1.0, 1.0, uTMax) - qo) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), max(tn.z, 0.0)), b = min(min(tf.x, tf.y), tf.z);
  if (uBack > 0.5) b = min(b, tFace);            // from inside: what stands behind bounds it (the back face's depth test)
  vec3 ci = 1.0 / rd, c0 = (uCMin - ro) * ci, c1 = (uCMax - ro) * ci, cn = min(c0, c1), cf = max(c0, c1);
  a = max(a, max(max(cn.x, cn.y), cn.z)); b = min(b, min(min(cf.x, cf.y), cf.z));
  if (b <= a) discard;
  float L = b - a, acc = 0.0;
  for (int i = 0; i < 6; i++) {
    float s = a + L * (float(i) + 0.5) / 6.0;
    vec3 p = ro + rd * s, q = uMinv * (p - uO);
    float edge = smoothstep(0.0, 0.1, q.x) * smoothstep(0.0, 0.1, 1.0 - q.x) * smoothstep(0.0, 0.1, q.y) * smoothstep(0.0, 0.1, 1.0 - q.y);
    float fade = smoothstep(0.0, 0.12 * uTMax, q.z) * (1.0 - 0.5 * q.z / uTMax);
    float dust = 0.5 + 0.9 * vn(p * 1.3 + vec3(0.0, -uTime * 0.05, uTime * 0.03)) * vn(p * 4.1 - uTime * 0.04);
    acc += edge * fade * dust;
  }
  // forward scatter: the air is brightest looking toward the light (a soft Henyey-Greenstein lobe, g ~ 0.6)
  float mu = dot(rd, uL), ph = 0.35 + 0.65 * 0.16 / pow(1.36 - 1.2 * mu, 1.5);
  gl_FragColor = vec4(uCol * uDens * acc * L / 6.0 * ph, 1.0);
}`;
const MOTE_VS = /* glsl */ `
attribute vec4 aQ;
uniform vec3 uO, uE1, uE2, uL; uniform float uTMax, uTime, uPx;
varying float vA;
void main(){
  vec3 q = aQ.xyz;
  q.x = fract(q.x + 0.03 * sin(uTime * 0.21 + aQ.w * 17.0) + uTime * 0.004 * (aQ.w - 0.5));
  q.y = fract(q.y + 0.03 * cos(uTime * 0.17 + aQ.w * 11.0));
  q.z = mod(q.z + uTime * 0.03 * (0.4 + aQ.w), uTMax);
  vec3 p = uO + q.x * uE1 + q.y * uE2 - uL * q.z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(uPx * 0.005 / max(d, 0.1), 1.0, 4.0);
  float edge = smoothstep(0.0, 0.1, q.x) * smoothstep(1.0, 0.9, q.x) * smoothstep(0.0, 0.1, q.y) * smoothstep(1.0, 0.9, q.y);
  vA = edge * (1.0 - smoothstep(5.0, 12.0, d)) * (0.5 + 0.5 * sin(uTime * (1.0 + aQ.w) + aQ.w * 40.0));
}`;
const MOTE_FS = /* glsl */ `
uniform vec3 uCol; varying float vA;
void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(uCol * vA * (1.0 - r), 1.0); }`;

const v3 = (a) => new THREE.Vector3(...a);
/** the world's shaft system (one per world, on ctx.shared) */
export function shafts(ctx) {
  if (ctx.shared.shafts) return ctx.shared.shafts;
  const G = ctx.world.G, group = new THREE.Group(); group.name = 'shafts';
  ctx.root.add(group);
  const items = [];
  let see = null, R = 0x2545f491;
  const rnd = () => ((R = (Math.imul(R ^ (R >>> 15), 0x2c1b3c6d) ^ (R << 7)) >>> 0) / 4294967296);
  const L = new THREE.Vector3(), M = new THREE.Matrix3(), col = new THREE.Vector3(), tmp = new THREE.Vector3(), cam = new THREE.Vector3(), q = new THREE.Vector3(), Minv = new THREE.Matrix3();
  let clock = 0, last = -1;
  function add(ap) {
    const O = v3(ap.o), E1 = v3(ap.e1), E2 = v3(ap.e2), out = v3(ap.out).normalize();
    const geo = new THREE.BoxGeometry(1, 1, 1), unit = geo.attributes.position.array.slice();
    const U = {
      uMinv: { value: new THREE.Matrix3() }, uO: { value: O.clone() }, uL: { value: new THREE.Vector3(0, 1, 0) }, uTMax: { value: 1 }, uCol: { value: new THREE.Vector3() },
      uDens: { value: ap.dens ?? 0.05 }, uTime: G.uTime, uBack: { value: 1 },
      uCMin: { value: v3(ap.clip.slice(0, 3)) }, uCMax: { value: v3(ap.clip.slice(3, 6)) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = true;   // (its bounding sphere follows the prism) mesh.renderOrder = 25; mesh.name = 'shaft'; mesh.visible = false;
    mesh.castShadow = mesh.receiveShadow = false; mesh.userData.occlude = false;
    group.add(mesh);
    let motes = null;
    if (ap.motes) {
      const n = ap.motes, aq = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) aq.set([rnd(), rnd(), rnd() * 8, rnd()], i * 4);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aQ', new THREE.BufferAttribute(aq, 4));
      const MU = { uO: U.uO, uE1: { value: E1.clone() }, uE2: { value: E2.clone() }, uL: U.uL, uTMax: U.uTMax, uTime: G.uTime, uPx: { value: 900 }, uCol: { value: new THREE.Vector3() } };
      const mm = new THREE.ShaderMaterial({ uniforms: MU, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      motes = new THREE.Points(g, mm); motes.frustumCulled = true; g.boundingSphere = new THREE.Sphere();   // the prism's sphere, set each frame motes.renderOrder = 26; motes.name = 'shaft-motes'; motes.visible = false;
      motes.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); MU.uPx.value = (rt ? rt.height : renderer.domElement.height) * 1.4; };
      group.add(motes);
    }
    items.push({ ap, O, E1, E2, out, geo, unit, U, mesh, motes, vis: 0, want: 1, seenAt: -1, seenL: new THREE.Vector3() });
  }
  function update(t) {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last)); last = t; clock += dt;
    const kc = G.uKeyColor.value, lampK = Math.max(0, G.uLampGain.value);
    ctx.world.camera.getWorldPosition(cam);
    for (const it of items) {
      const { ap } = it;
      const centre = tmp.copy(it.O).addScaledVector(it.E1, 0.5).addScaledVector(it.E2, 0.5);
      let k;
      if (ap.kind === 'spill') {
        L.copy(v3(ap.src)).sub(centre).normalize();
        col.fromArray(ap.color).multiplyScalar((ap.power ?? 1) * lampK);
        k = 1;
      } else {
        L.copy(G.uKeyDir.value).normalize();
        col.copy(kc).multiplyScalar(ap.power ?? 1);
        k = THREE.MathUtils.smoothstep(L.y, -0.01, 0.06);   // the light above the horizon
      }
      if (ap.tint) col.multiply(v3(ap.tint));
      const facing = L.dot(it.out);
      k *= THREE.MathUtils.smoothstep(facing, 0.02, 0.12);
      // the light reaches the opening: a ray from just outside it toward the light (re-asked every 0.25 s or when the
      // light turned), eased over about a third of a second
      if (see && k > 0 && (clock - it.seenAt > 0.25 || it.seenL.dot(L) < 0.99995)) {
        const from = centre.clone().addScaledVector(it.out, (ap.depth || 0) + 0.15), max = ap.kind === 'spill' ? Math.max(0.1, v3(ap.src).distanceTo(from) - 0.6) : 400;
        it.want = see(from.toArray(), L.toArray(), max) ? 0 : 1; it.seenAt = clock; it.seenL.copy(L);
      }
      it.vis += ((see ? it.want : 1) - it.vis) * Math.min(1, dt * 3 + (it.seenAt < 0 ? 1 : 0));
      // a wall's depth: the lit part of the inner opening is its overlap with the outer one carried along the light
      let O = it.O, E1 = it.E1, E2 = it.E2, pass = 1;
      if (ap.depth && facing > 0.02) {
        const den = facing, sh = L.clone().multiplyScalar(ap.depth / den).addScaledVector(it.out, -ap.depth);
        const su = sh.dot(it.E1) / it.E1.lengthSq(), sv = sh.dot(it.E2) / it.E2.lengthSq();
        const u0 = Math.max(0, su), u1 = Math.min(1, 1 + su), v0 = Math.max(0, sv), v1 = Math.min(1, 1 + sv);
        if (u1 - u0 < 0.02 || v1 - v0 < 0.02) pass = 0;
        else { O = it.O.clone().addScaledVector(it.E1, u0).addScaledVector(it.E2, v0); E1 = it.E1.clone().multiplyScalar(u1 - u0); E2 = it.E2.clone().multiplyScalar(v1 - v0); }
      }
      const lum = 0.2126 * col.x + 0.7152 * col.y + 0.0722 * col.z, on = k * it.vis * pass * Math.min(1, lum * 20);
      // beyond 45 m a shaft is a few pixels of haze: not drawn
      it.mesh.visible = on > 0.04 && cam.distanceTo(centre) < 45;
      if (it.motes) it.motes.visible = it.mesh.visible;
      if (!it.mesh.visible) continue;
      // the shaft runs down to the floor (or the clip box's end), along -L
      const drop = Math.max(0, O.y + Math.max(0, E1.y) + Math.max(0, E2.y) - (ap.floorY ?? 0));
      const tMax = Math.min(ap.maxLen ?? 25, L.y > 0.02 ? drop / L.y : ap.maxLen ?? 25);
      it.U.uTMax.value = Math.max(0.2, tMax); it.U.uO.value.copy(O); it.U.uL.value.copy(L);
      M.set(E1.x, E2.x, -L.x, E1.y, E2.y, -L.y, E1.z, E2.z, -L.z);
      Minv.copy(M).invert(); it.U.uMinv.value.copy(Minv);
      it.U.uCol.value.copy(col).multiplyScalar(on);
      const P = it.geo.attributes.position, tm = it.U.uTMax.value;
      for (let i = 0; i < P.count; i++) {
        const a = it.unit[i * 3] > 0 ? 1 : 0, b = it.unit[i * 3 + 1] > 0 ? 1 : 0, c = it.unit[i * 3 + 2] > 0 ? 1 : 0;
        P.setXYZ(i, O.x + E1.x * a + E2.x * b - L.x * tm * c, O.y + E1.y * a + E2.y * b - L.y * tm * c, O.z + E1.z * a + E2.z * b - L.z * tm * c);
      }
      P.needsUpdate = true; it.geo.computeBoundingSphere();
      if (it.motes) it.motes.geometry.boundingSphere.copy(it.geo.boundingSphere);
      // from inside the prism: its back faces (a wall behind bounds it); from outside: its front faces
      q.copy(cam).sub(O).applyMatrix3(Minv);
      const inside = q.x > -0.05 && q.x < 1.05 && q.y > -0.05 && q.y < 1.05 && q.z > -0.2 && q.z < tm + 0.2;
      const flip = M.determinant() < 0;
      it.mesh.material.side = inside !== flip ? THREE.BackSide : THREE.FrontSide;
      it.U.uBack.value = inside ? 1 : 0;
      if (it.motes) { const mu = it.motes.material.uniforms; mu.uE1.value.copy(E1); mu.uE2.value.copy(E2); mu.uCol.value.copy(col).multiplyScalar(on * (ap.moteK ?? 0.15)); }
    }
  }
  ctx.onUpdate(update);
  return (ctx.shared.shafts = { add, update, items, group, setSee: (fn) => { see = fn; for (const it of items) it.seenAt = -1; } });
}

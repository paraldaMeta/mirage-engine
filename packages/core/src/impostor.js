// Mirage original code.
// Impostors: an object drawn as one camera-facing quad that shows a picture of it taken from about the same
// direction. The pictures are baked once into an atlas of N x N views laid out on a hemi-octahedron (every
// direction above the horizon is a point of a square, so the four nearest views are the four nearest tiles), with
// a second atlas of object-space normals so the quad is lit by the live sun and sky like the mesh it stands for.
// The technique is the usual octahedral impostor (R. Brucks' description for Unreal is the common reference); the
// code is ours.
//
//   import { bakeImpostor, impostorMaterial } from '@mirage/core/impostor';
//   const imp = bakeImpostor(world, treeGroup, { frames: 8, tile: 128 });   // { albedo, normal, center, radius, frames, ... }
//   const mesh = new THREE.InstancedMesh(imp.geometry, impostorMaterial(world, imp), n);   // instance matrices as for the tree
//   createInstances(world, { source: treeGroup, matrices, impostor: imp })  // instancing.js: the last LOD
//
// The bake renders the object with its own materials under white ambient light (so the atlas holds albedo, as far
// as the materials are diffuse) and again with a material that writes object-space normals. Limits: views from
// below the horizon reuse the horizon ring; no parallax between views (blending the four nearest tiles hides the
// steps but can ghost close up: use it where the object is small on screen); impostors receive shadows at the
// quad's depth and cast none; metal and emissive looks are not captured.
import * as THREE from 'three';

// hemi-octahedron: a direction with y >= 0 <-> a point of the square [-1, 1]^2
export function hemiOctDecode(u, v, out = new THREE.Vector3()) {
  const x = (u - v) / 2, z = (u + v) / 2;
  return out.set(x, 1 - Math.abs(x) - Math.abs(z), z).normalize();
}
export function hemiOctEncode(d, out = new THREE.Vector2()) {
  const s = Math.abs(d.x) + Math.max(d.y, 0) + Math.abs(d.z), x = d.x / s, z = d.z / s;
  return out.set(x + z, z - x);
}
// the picture's axes for a view direction (the same rule in the bake and in the shader)
const BASIS = /* glsl */ `
void mgImpBasis(vec3 d, out vec3 r, out vec3 u){ vec3 a = abs(d.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0); r = normalize(cross(a, d)); u = cross(d, r); }`;

export function bakeImpostor(world, object, { frames = 8, tile = 128 } = {}) {
  const renderer = world.renderer, box = new THREE.Box3().setFromObject(object), sphere = box.getBoundingSphere(new THREE.Sphere());
  const size = frames * tile, mk = (srgb) => {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.anisotropy = 4;
    return rt;
  };
  const albedo = mk(true), normal = mk(false);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-sphere.radius, sphere.radius, sphere.radius, -sphere.radius, 0.01, sphere.radius * 4);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const parent = object.parent, at = parent ? parent.children.indexOf(object) : -1;
  scene.add(object);
  // object-space normals (the object's own space: world space of this scene, as the object sits at its transform)
  const nMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN;\nvoid main(){\n  vec3 n = normal; vec4 p = vec4(position, 1.0);\n  #ifdef USE_INSTANCING\n  n = mat3(instanceMatrix) * n; p = instanceMatrix * p;\n  #endif\n  vN = mat3(modelMatrix) * n; gl_Position = projectionMatrix * viewMatrix * modelMatrix * p; }',
    fragmentShader: 'varying vec3 vN;\nvoid main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }' });
  const keep = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear, shadow: renderer.shadowMap.enabled, tone: renderer.toneMapping };
  const d = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Zn = new THREE.Vector3(0, 0, -1);
  renderer.shadowMap.enabled = false; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  try {
    for (const [rt, override] of [[albedo, null], [normal, nMat]]) {
      scene.overrideMaterial = override;
      renderer.setRenderTarget(rt);
      rt.scissorTest = true;
      for (let j = 0; j < frames; j++) for (let i = 0; i < frames; i++) {
        hemiOctDecode(i / (frames - 1) * 2 - 1, j / (frames - 1) * 2 - 1, d);
        r.crossVectors(Math.abs(d.y) > 0.999 ? Zn : Y, d).normalize(); u.crossVectors(d, r);
        cam.position.copy(sphere.center).addScaledVector(d, sphere.radius * 2);
        cam.up.copy(u); cam.lookAt(sphere.center); cam.updateMatrixWorld();
        rt.viewport.set(i * tile, j * tile, tile, tile); rt.scissor.set(i * tile, j * tile, tile, tile);
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
      }
      rt.scissorTest = false; rt.viewport.set(0, 0, size, size); rt.scissor.set(0, 0, size, size);
    }
  } finally {
    renderer.setRenderTarget(keep.target); renderer.setClearColor(keep.clear, keep.alpha); renderer.autoClear = keep.auto; renderer.shadowMap.enabled = keep.shadow; renderer.toneMapping = keep.tone;
    scene.remove(object);
    if (parent) { parent.children.splice(at, 0, object); object.parent = parent; }
    nMat.dispose();
  }
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.boundingSphere = new THREE.Sphere(sphere.center.clone(), sphere.radius); geometry.boundingBox = box.clone();
  return { albedo: albedo.texture, normal: normal.texture, targets: [albedo, normal], center: sphere.center.clone(), radius: sphere.radius, frames, tile, geometry,
    dispose() { albedo.dispose(); normal.dispose(); geometry.dispose(); } };
}

// the material: Mirage's standard material (lights, shadows received, image-based light, fog) with the quad's
// position, albedo and normal replaced. Instance matrices: a rotation, a uniform scale and a translation.
export function impostorMaterial(world, imp, params = {}) {
  const N = imp.frames, uniforms = { uImpAlbedo: { value: imp.albedo }, uImpNormal: { value: imp.normal }, uImpCenter: { value: imp.center }, uImpRadius: { value: imp.radius } };
  const mat = world.mat.std({ roughness: 1, metalness: 0, side: THREE.FrontSide, ...params }, {
    uniforms,
    vertexDecl: /* glsl */ `uniform vec3 uImpCenter; uniform float uImpRadius; varying vec2 mgImpUv; varying vec2 mgImpFrame; varying mat3 mgImpRot;${BASIS}`,
    vertexWorld: /* glsl */ `
      {
        mat4 mgM = modelMatrix;
        #ifdef USE_INSTANCING
          mgM = modelMatrix * instanceMatrix;
        #endif
        vec3 c = (mgM * vec4(uImpCenter, 1.0)).xyz;
        float sc = length(mgM[0].xyz);
        mat3 rot = mat3(mgM) / sc;
        vec3 dO = normalize((cameraPosition - c) * rot);          // towards the camera, in the object's space
        vec3 dF = normalize(vec3(dO.x, max(dO.y, 0.0), dO.z));    // views exist above the horizon only
        float s = abs(dF.x) + dF.y + abs(dF.z);
        vec2 o = vec2(dF.x + dF.z, dF.z - dF.x) / s;
        mgImpFrame = (o * 0.5 + 0.5) * ${(N - 1).toFixed(1)};
        vec3 r, u; mgImpBasis(dO, r, u);
        mgWorld = c + rot * (r * position.x + u * position.y) * (uImpRadius * sc);
        mgWorldNormal = rot * dO;
        mgImpUv = position.xy * 0.5 + 0.5;
        mgImpRot = rot;
      }`,
    fragmentDecl: /* glsl */ `uniform sampler2D uImpAlbedo; uniform sampler2D uImpNormal; varying vec2 mgImpUv; varying vec2 mgImpFrame; varying mat3 mgImpRot; vec3 mgImpN;`,
    albedo: /* glsl */ `
      {
        vec2 f0 = floor(mgImpFrame), w = mgImpFrame - f0; vec4 a = vec4(0.0); vec3 n = vec3(0.0);
        for (int k = 0; k < 4; k++) {
          vec2 off = vec2(float(k & 1), float(k >> 1));
          float wk = (off.x > 0.5 ? w.x : 1.0 - w.x) * (off.y > 0.5 ? w.y : 1.0 - w.y);
          vec2 uv = (min(f0 + off, vec2(${(N - 1).toFixed(1)})) + clamp(mgImpUv, 0.004, 0.996)) / ${N.toFixed(1)};
          vec4 t = texture2D(uImpAlbedo, uv);
          vec4 tn = texture2D(uImpNormal, uv);   // both atlases are black where empty, so filtered texels are premultiplied
          a += t * wk; n += (tn.xyz - 0.5 * tn.a) * wk;
        }
        if (a.a < 0.5) discard;
        diffuseColor.rgb = a.rgb / a.a;
        mgImpN = normalize(mgImpRot * n);
      }`,
    normal: /* glsl */ `normal = normalize((viewMatrix * vec4(mgImpN, 0.0)).xyz);`,
  });
  mat.name = 'impostor';
  return mat;
}

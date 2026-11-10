// A streamed module for the streaming demo: a small tiled kiosk outside the courtyard's gate, built to cost what an
// interior costs when it comes in: eight materials the world has not compiled (each its own program), two 1024 px
// textures it makes itself (16 MB on the GPU with mipmaps) and a few thousand triangles. No lights (a new light would
// recompile every program in the scene).
import * as THREE from 'three';

const N_MAT = 8;
// a seeded RGBA texture: cheap to make, a full upload to the GPU
function makeTexture(R, size, tint) {
  const data = new Uint8Array(size * size * 4);
  const a = R.range(4, 9), b = R.range(4, 9);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, v = 0.55 + 0.25 * Math.sin(x / a) * Math.cos(y / b) + 0.2 * (((x * 7 + y * 13) & 31) / 31);
    data[i] = 255 * Math.min(1, v * tint[0]); data[i + 1] = 255 * Math.min(1, v * tint[1]); data[i + 2] = 255 * Math.min(1, v * tint[2]); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export default {
  name: 'kiosk', center: [7, 13.2], radius: 9,
  build(ctx) {
    const { root, mat, R } = ctx, salt = ctx.shared.salt | 0;   // the check's salt: shaders new to the driver
    const tiles = makeTexture(R, 1024, [1.0, 0.82, 0.62]), wood = makeTexture(R, 1024, [0.75, 0.52, 0.34]);
    // eight programs: each material's albedo hook differs, so each is its own program (as distinct materials are)
    const M = Array.from({ length: N_MAT }, (_, k) => mat.std({ roughness: 0.6 + 0.04 * k, map: k % 2 ? wood : tiles },
      { albedo: `diffuseColor.rgb *= vec3(${(0.8 + 0.025 * k).toFixed(3)}, ${(0.9 - 0.02 * k).toFixed(3)}, 0.85) * (0.9 + 0.1 * sin(mgWorldPos.y * ${(3 + k).toFixed(1)}))${salt ? ` + 0.0 * ${salt}.0` : ''};` }));
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 4, 4, 4), M[m]); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
    const [cx, cz] = this.center, W = 5, D = 5, H = 2.8, T = 0.2;
    box(W, 0.3, D, cx, 0.15, cz, 0);                                         // floor slab (a step up)
    box(W, T, D, cx, H + 0.4, cz, 1);                                        // roof
    box(T, H, D, cx - W / 2 + T / 2, 0.3 + H / 2, cz, 2);                    // west wall
    box(T, H, D, cx + W / 2 - T / 2, 0.3 + H / 2, cz, 3);                    // east wall
    box(W, H, T, cx, 0.3 + H / 2, cz - D / 2 + T / 2, 4);                    // north wall
    box(1.6, H, T, cx - W / 2 + 0.8, 0.3 + H / 2, cz + D / 2 - T / 2, 5);    // south wall, a door gap in the middle
    box(1.6, H, T, cx + W / 2 - 0.8, 0.3 + H / 2, cz + D / 2 - T / 2, 5);
    box(1.6, 0.08, 0.8, cx, 1.05, cz - 1, 6);                                // a counter and shelves
    for (let i = 0; i < 6; i++) box(0.9, 0.05, 0.35, cx - 1.9 + 0.75 * (i % 2 ? 1 : 0) + (i > 3 ? 2.6 : 0), 0.8 + 0.45 * (i % 3), cz - 2.1, 7);
    for (let i = 0; i < 24; i++) {                                           // jars on the shelves
      const j = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), M[i % N_MAT]);
      j.position.set(cx - 2 + R.range(0, 4), 0.9 + 0.45 * R.int(0, 2), cz - 2.1); root.add(j);
    }
  },
};

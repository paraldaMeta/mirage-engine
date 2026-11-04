import * as THREE from 'three';

// Original character in metres, feet at Y=0, facing +Z. All garment panels share a vertex-coloured
// skin. Ring weights blend adjacent joints at the elbows and knees without extra draw groups.
export function buildCharacterModel(world, palette) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.name = 'figure'; root.add(body); root.userData.body = body;
  const bones = [], origins = [], ids = new Map();
  const xyz = [], rgb = [], indices = [], joints = [], weights = [];
  function joint(name, parent, x, y, z = 0) {
    const bone = new THREE.Bone(), at = new THREE.Vector3(x, y, z);
    bone.name = name; bone.position.copy(at);
    if (parent) { parent.add(bone); bone.position.sub(origins[ids.get(parent)]); }
    ids.set(bone, bones.length); bones.push(bone); origins.push(at);
    return bone;
  }
  const hips = joint('hips', null, 0, 0.89), spine = joint('spine', hips, 0, 1.03);
  const head = joint('head', spine, 0, 1.52);

  // Each horizontal section is [height, half-width, half-depth, centre X, centre Z, second joint weight].
  function panel(color, bone, sections, { other = bone, sides = 12 } = {}) {
    const start = xyz.length / 3, id = ids.get(bone), origin = origins[id], tint = new THREE.Color(color);
    function vertex(x, y, z, w) {
      xyz.push(origin.x + x, origin.y + y, origin.z + z);
      rgb.push(tint.r, tint.g, tint.b);
      joints.push(id, ids.get(other), 0, 0); weights.push(1 - w, w, 0, 0);
    }
    for (const [y, rx, rz, x = 0, z = 0, w = 0] of sections) {
      for (let i = 0; i < sides; i++) {
        const a = 2 * Math.PI * i / sides;
        vertex(x + Math.sin(a) * rx, y, z + Math.cos(a) * rz, w);
      }
    }
    for (let row = 1; row < sections.length; row++) {
      const lower = start + (row - 1) * sides;
      for (let i = 0; i < sides; i++) {
        const a = lower + i, b = lower + (i + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
    for (const row of [0, sections.length - 1]) {
      const [y, , , x = 0, z = 0, w = 0] = sections[row], centre = xyz.length / 3;
      vertex(x, y, z, w);
      const edge = start + row * sides;
      for (let i = 0; i < sides; i++) {
        const a = edge + i, b = edge + (i + 1) % sides;
        if (row === 0) indices.push(centre, b, a); else indices.push(centre, a, b);
      }
    }
  }
  const { jacket, trousers, scarf, leather, skin, hair } = palette;
  panel(trousers, hips, [[-0.09,0.147,0.108], [0,0.17,0.125], [0.12,0.14,0.10]]);
  panel(jacket, hips, [[0.03,0.17,0.128], [0.10,0.176,0.13], [0.19,0.146,0.119,0,0,0.65],
    [0.36,0.19,0.135,0,0.008,1], [0.49,0.202,0.116,0,0,1], [0.55,0.091,0.088,0,0,1]], { other: spine });
  panel(0x344a47, hips, [[0.038,0.171,0.130], [0.061,0.175,0.132]]);
  panel(0xb2986e, spine, [[0.047,0.004,0.005,0,0.124], [0.215,0.004,0.005,0,0.143],
    [0.344,0.004,0.005,0,0.128]], { sides: 6 });
  panel(skin, head, [[-0.10,0.058,0.053], [0.052,0.06,0.058]]);
  panel(scarf, spine, [[0.371,0.119,0.105], [0.407,0.126,0.112], [0.456,0.086,0.081], [0.469,0.079,0.075]]);
  panel(scarf, spine, [[0.205,0.027,0.010,-0.064,0.129], [0.282,0.035,0.012,-0.05,0.139], [0.407,0.047,0.018,0,0.106]]);
  // Chin, jaw, cheekbones and temples; the profile projects forward around the nose and recedes at the jaw.
  panel(skin, head, [[-0.009,0.053,0.059,0,0.021], [0.014,0.085,0.085,0,0.015],
    [0.060,0.103,0.097,0,0.009], [0.114,0.110,0.103], [0.173,0.104,0.099], [0.213,0.070,0.073]], { sides: 16 });
  panel(skin, head, [[0.061,0.021,0.012,0,0.109], [0.076,0.019,0.024,0,0.116], [0.119,0.010,0.012,0,0.099]], { sides: 8 });
  panel(0x935d4d, head, [[0.036,0.019,0.003,0,0.107], [0.039,0.023,0.004,0,0.106]], { sides: 8 });
  panel(hair, head, [[0.125,0.108,0.092,-0.002,-0.016], [0.160,0.115,0.109,-0.004,-0.006],
    [0.205,0.106,0.108,-0.008,-0.013], [0.240,0.077,0.074,-0.015,-0.016], [0.248,0.031,0.034,-0.022,-0.01]]);
  // Back panel, flap and paired shoulder straps read from the isometric camera.
  panel(leather, spine, [[0.07,0.103,0.041,0,-0.141], [0.12,0.136,0.065,0,-0.146],
    [0.31,0.141,0.077,0,-0.151], [0.389,0.119,0.051,0,-0.134]], { sides: 10 });
  panel(0xac865c, spine, [[0.237,0.119,0.021,0,-0.207], [0.317,0.138,0.032,0,-0.198], [0.373,0.124,0.035,0,-0.169]]);

  const limbs = [];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? '.R' : '.L';
    panel(hair, head, [[0.095,0.017,0.006,side*0.044,0.097], [0.105,0.022,0.008,side*0.043,0.097]], { sides: 8 });
    panel(skin, head, [[0.050,0.012,0.016,side*0.103,0], [0.080,0.019,0.021,side*0.104,-0.003],
      [0.105,0.013,0.018,side*0.103,-0.004]], { sides: 8 });
    panel(leather, spine, [[0.090,0.015,0.010,side*0.128,0.075], [0.292,0.021,0.011,side*0.106,0.124],
      [0.435,0.022,0.014,side*0.133,0.079], [0.455,0.022,0.04,side*0.136,0.005]]);
    const hip = joint('hip'+suffix, hips, side*0.092,0.89);
    const knee = joint('knee'+suffix, hip, side*0.092,0.485);
    const ankle = joint('ankle'+suffix, knee, side*0.092,0.095);
    panel(trousers, hip, [[-0.422,0.065,0.073,0,0.012,0.83], [-0.365,0.073,0.082,0,0.004,0.23],
      [-0.19,0.091,0.099], [-0.045,0.103,0.111], [0.005,0.090,0.096]], { other: knee });
    panel(trousers, knee, [[-0.337,0.053,0.062], [-0.21,0.065,0.082,0,-0.014], [-0.083,0.079,0.086,0,-0.009], [0.009,0.064,0.073,0,0.010]]);
    panel(leather, ankle, [[-0.094,0.068,0.13,0,0.038], [-0.069,0.072,0.136,0,0.043],
      [-0.033,0.068,0.129,0,0.041], [0.036,0.065,0.087,0,0.006], [0.115,0.060,0.065]]);
    panel(0x373835, ankle, [[-0.095,0.069,0.133,0,0.041], [-0.076,0.073,0.137,0,0.043]]);
    const shoulder = joint('shoulder'+suffix, spine, side*0.187,1.373);
    const elbow = joint('elbow'+suffix, shoulder, side*0.237,1.112,0.006);
    panel(jacket, shoulder, [[-0.279,0.055,0.062,side*0.050,0.006,0.83], [-0.219,0.064,0.074,side*0.046,0,0.14],
      [-0.09,0.076,0.089,side*0.030], [-0.018,0.081,0.087], [0.034,0.057,0.058]], { other: elbow });
    panel(jacket, elbow, [[-0.212,0.046,0.050,side*0.017,0.020], [-0.13,0.059,0.063,side*0.010,0.014], [0.009,0.055,0.064]]);
    panel(skin, elbow, [[-0.313,0.025,0.032,side*0.017,0.028], [-0.262,0.041,0.046,side*0.018,0.026], [-0.205,0.034,0.039,side*0.017,0.020]]);
    limbs.push({ side, hip, knee, ankle, shoulder, elbow });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geo.setIndex(indices); geo.computeVertexNormals();
  const material = world.mat.std({ vertexColors: true, roughness: 0.88 });
  const mesh = new THREE.SkinnedMesh(geo, material), skeleton = new THREE.Skeleton(bones);
  mesh.name = 'traveller'; mesh.add(hips); body.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(skeleton); mesh.castShadow = mesh.receiveShadow = true;
  // Walking and jumping move vertices outside the rest bounds. This is one player in the following camera.
  mesh.frustumCulled = false;
  root.traverse(node => { node.userData.collide = false; });
  geo.addEventListener('dispose', () => { skeleton.dispose(); material.dispose(); });
  return { root, body, mesh, spine, head, limbs };
}

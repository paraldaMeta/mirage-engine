import * as THREE from 'three';
import { PROC } from '@mirage/core';

// One folded, compound leaf card. Its silhouette is cut in the mesh so it can share an opaque instance batch.
function leafSprig() {
  const positions = [], colors = [], indices = [];
  function leaf(x, y, dx, dy, width) {
    const start = positions.length / 3, length = Math.hypot(dx, dy);
    const nx = -dy * width / length, ny = dx * width / length;
    const mx = x + dx * 0.5, my = y + dy * 0.5;
    positions.push(x, y, 0, mx - nx, my - ny, 0, x + dx, y + dy, -0.035, mx + nx, my + ny, 0, mx, my, 0.038);
    colors.push(0.36, 0.48, 0.25, 0.66, 0.79, 0.44, 0.98, 0.93, 0.53, 0.52, 0.72, 0.32, 0.88, 0.91, 0.48);
    for (let edge = 0; edge < 4; edge++) indices.push(start + edge, start + (edge + 1) % 4, start + 4);
  }
  leaf(0, 0, 0, 0.92, 0.012); // midrib
  for (let i = 0; i < 4; i++) {
    const reach = 0.42 - 0.045 * i, y = 0.08 + i * 0.18;
    leaf(0, y, -reach, 0.24, reach * 0.20);
    leaf(0, y + 0.07, reach, 0.26, reach * 0.22);
  }
  leaf(0, 0.76, 0.05, 0.32, 0.065);
  return geometry(positions, colors, indices);
}

function grassTuft() {
  const positions = [], colors = [], indices = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.40, x = Math.cos(angle), z = Math.sin(angle), h = 0.65 + i * 0.085;
    const width = 0.045, base = positions.length / 3;
    positions.push(x * 0.05 - z * width, 0, z * 0.05 + x * width,
      x * 0.05 + z * width, 0, z * 0.05 - x * width,
      x * 0.20 - z * width * 0.6, h * 0.62, z * 0.20 + x * width * 0.6,
      x * 0.20 + z * width * 0.6, h * 0.62, z * 0.20 - x * width * 0.6,
      x * 0.42, h, z * 0.42);
    colors.push(0.32, 0.41, 0.18, 0.32, 0.41, 0.18, 0.64, 0.79, 0.33, 0.64, 0.79, 0.33, 0.96, 0.89, 0.52);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base + 2, base + 3, base + 4);
  }
  return geometry(positions, colors, indices);
}

function geometry(positions, colors, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const TAU = Math.PI * 2;
const sway = { vertexWorld: 'mgWorld.xz += uWind.xy * (uWind.z * 0.036 * position.y * sin(uTime * 1.6 + dot(mgWorld.xz, vec2(0.43, 0.26))));' };

function foliage(ctx, name, geo, matrices, color, shadows) {
  const material = ctx.mat.std({ color, vertexColors: true, side: THREE.DoubleSide, roughness: 0.92 }, sway);
  const mesh = ctx.geom.instances(geo, material, matrices, { castShadow: shadows });
  if (shadows) mesh.customDepthMaterial = ctx.mat.depth(sway);
  mesh.name = name;
  mesh.userData.collide = false;
  ctx.root.add(mesh);
  return mesh;
}

/** trees: [{ pos: [x,y,z] (ground), height, crownRadius?, trunkRadius? }]. Returns the three instance batches. */
export function addTreeCanopies(ctx, { trees, seed = 'canopy', cardsPerTree = 96 }) {
  if (!Number.isSafeInteger(cardsPerTree) || cardsPerTree < 1) throw new RangeError('cardsPerTree must be a positive integer');
  if (!trees.length) return { trunks: null, branches: null, crowns: null };
  const trunks = [], branches = [], cards = [];
  const bark = ctx.mat.std({ roughness: 0.96 }, PROC.wood('vec3(0.13, 0.085, 0.047)', 'y'));
  const pole = new THREE.CylinderGeometry(0.64, 1, 1, 9).translate(0, 0.5, 0);
  const up = new THREE.Vector3(0, 1, 0);
  for (const [index, tree] of trees.entries()) {
    const { pos: [x, y, z], height: h, crownRadius = h * 0.34, trunkRadius = h * 0.045 } = tree;
    if (![x, y, z, h, crownRadius, trunkRadius].every(Number.isFinite) || Math.min(h, crownRadius, trunkRadius) <= 0) {
      throw new RangeError('trees[' + index + '] needs finite coordinates, a positive height and positive radii');
    }
    const R = ctx.rng(seed + '/' + index);
    trunks.push(ctx.geom.compose([x, y, z], [0, 0, 0], [trunkRadius, h * 0.78, trunkRadius]));
    // Five uneven boughs give the canopy lobes and let the side light through the gaps.
    const centres = [], phase = R.range(0, TAU);
    for (let b = 0; b < 5; b++) {
      const a = phase + b * 2.40, reach = crownRadius * R.range(0.29, 0.65);
      const start = new THREE.Vector3(x, y + h * (0.39 + b * 0.064), z);
      const end = start.clone().add(new THREE.Vector3(Math.cos(a) * reach, h * R.range(0.18, 0.25), Math.sin(a) * reach));
      const dir = end.clone().sub(start), len = dir.length(), r = trunkRadius * (0.42 - b * 0.045);
      branches.push(new THREE.Matrix4().compose(start, new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()), new THREE.Vector3(r, len, r)));
      centres.push(end);
    }
    for (let i = 0; i < cardsPerTree; i++) {
      const centre = centres[i % centres.length], [dx, dy, dz] = R.onSphere();
      const spread = crownRadius * R.range(0.21, 0.68), size = crownRadius * R.range(0.36, 0.70);
      const p = [centre.x + dx * spread, centre.y + dy * spread * 0.71, centre.z + dz * spread];
      cards.push(ctx.geom.compose(p, [R.range(-1.1, 1.1), Math.atan2(dx, dz), R.range(-1.7, 1.7)], size));
    }
  }
  const trunkMesh = ctx.geom.instances(pole, bark, trunks), branchMesh = ctx.geom.instances(pole, bark, branches);
  trunkMesh.name = 'canopy-trunks'; // capped cylinders form the physical trunks in both collision backends
  branchMesh.name = 'canopy-boughs';
  branchMesh.userData.collide = false;
  ctx.root.add(trunkMesh, branchMesh);
  return { trunks: trunkMesh, branches: branchMesh, crowns: foliage(ctx, 'canopy-leaves', leafSprig(), cards, 0xb4c480, true) };
}

/** Place at most count instanced tufts in [x0,z0,x1,z1]. include(x,z) cuts paths, heightAt(x,z) follows terrain. */
export function addGrass(ctx, { bounds, count, height = 0.40, seed = 'grass', include = () => true, heightAt = () => 0 }) {
  const [x0, z0, x1, z1] = bounds, R = ctx.rng(seed), matrices = [];
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  if (![x0, z0, x1, z1, height].every(Number.isFinite) || x0 >= x1 || z0 >= z1 || height <= 0) {
    throw new RangeError('grass needs ordered bounds and a positive height');
  }
  for (let tries = 0; matrices.length < count && tries < count * 8; tries++) {
    const x = R.range(x0, x1), z = R.range(z0, z1);
    if (!include(x, z)) continue;
    const h = height * R.range(0.65, 1.35), width = h * R.range(1.0, 1.65);
    matrices.push(ctx.geom.compose([x, heightAt(x, z), z], [0, R.range(0, TAU), R.range(-0.18, 0.18)], [width, h, width]));
  }
  return matrices.length ? foliage(ctx, 'grass-tufts', grassTuft(), matrices, 0xb0b975, false) : null;
}

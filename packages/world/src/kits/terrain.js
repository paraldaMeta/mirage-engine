import * as THREE from 'three';

/** Attach a static XZ heightfield. heightAt(x,z) samples the rendered triangles and returns null off the map. */
export function addTerrain(ctx, { bounds, segments = [48, 48], sample, material, surface = 'ground' }) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !Array.from(bounds).every(Number.isFinite)) {
    throw new RangeError('terrain.bounds must be [xMin, zMin, xMax, zMax] in metres');
  }
  const [x0, z0, x1, z1] = bounds;
  const width = x1 - x0, depth = z1 - z0;
  if (!(Math.fround(width) > 0 && Math.fround(depth) > 0) ||
      !Number.isFinite(Math.fround(width)) || !Number.isFinite(Math.fround(depth))) {
    throw new RangeError('terrain.bounds must have finite positive width and depth');
  }
  if (!Array.isArray(segments) || segments.length !== 2 ||
      !Array.from(segments).every(n => Number.isSafeInteger(n) && n >= 1)) {
    throw new RangeError('terrain.segments must be two positive integers');
  }
  const [nx, nz] = segments, stride = nx + 1;
  if (stride * (nz + 1) > 1_048_576) throw new RangeError('terrain exceeds the 1,048,576 vertex limit');
  if (typeof sample !== 'function') throw new TypeError('terrain.sample must be a height function');

  const geometry = new THREE.PlaneGeometry(1, 1, nx, nz);
  const positions = geometry.getAttribute('position');
  for (let j = 0; j <= nz; j++) {
    const localZ = depth * (j / nz), z = z0 + localZ;
    for (let i = 0; i <= nx; i++) {
      const localX = width * (i / nx), x = x0 + localX, y = sample(x, z);
      if (!Number.isFinite(y) || !Number.isFinite(Math.fround(y))) throw new RangeError('invalid terrain height at ' + x + ', ' + z);
      positions.setXYZ(j * stride + i, localX, y, localZ);
    }
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material ?? ctx.mat.std({ color: 0x938469, roughness: 0.96 }));
  mesh.name = 'terrain'; mesh.receiveShadow = true; mesh.userData.surface = surface;
  mesh.position.set(x0, 0, z0);
  ctx.root.add(mesh);

  function heightAt(x, z) {
    if (!(x >= x0 && x <= x1 && z >= z0 && z <= z1) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const u = (x - x0) / width * nx, v = (z - z0) / depth * nz;
    const i = Math.min(Math.floor(u), nx - 1), j = Math.min(Math.floor(v), nz - 1);
    const tx = u - i, tz = v - j, a = j * stride + i;
    const right = positions.getY(a + 1), below = positions.getY(a + stride);
    // PlaneGeometry splits the cell along (i+1,j) to (i,j+1). Bilinear sampling would float over a saddle.
    if (tx + tz <= 1) return positions.getY(a) * (1 - tx - tz) + right * tx + below * tz;
    return positions.getY(a + stride + 1) * (tx + tz - 1) + right * (1 - tz) + below * (1 - tx);
  }
  return { mesh, heightAt };
}

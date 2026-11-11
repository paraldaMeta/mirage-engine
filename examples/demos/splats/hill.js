// Mirage original code. A Gaussian splat test asset made in code (no capture): a grassy hill with a lichen-grey
// rock and a broad-leaved tree on it, ~13 m across, its foot at y = 0 around the origin. Seeded: the same count and
// seed give the same splats on every machine. Returns the kit's data shape (@miragekit/world/kits/splat).

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// smooth value noise in 3D (for colour patches and surface lumps)
function noise3(seed) {
  const R = mulberry(seed), P = new Float32Array(4096);
  for (let i = 0; i < P.length; i++) P[i] = R();
  const h = (x, y, z) => P[((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 4095];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = s(x - X), v = s(y - Y), w = s(z - Z);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(X, Y, Z), h(X + 1, Y, Z), u), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u), v),
      l(l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u), l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u), v), w);
  };
}

export const HILL = { radius: 6.5, height: 1.6, rock: [1.6, 0, 1.2], tree: [-1.2, 0, -0.6] };
export const hillHeight = (x, z) => HILL.height * Math.exp(-(x * x + z * z) / (2 * 2.6 * 2.6));

/** count splats (300 000) from seed (1): 58 % hill, 14 % rock, 4 % trunk and boughs, 24 % leaves */
export function makeHill({ count = 300000, seed = 1 } = {}) {
  const R = mulberry(seed), N = noise3(seed + 7), N2 = noise3(seed + 11);
  const D = { count, center: new Float32Array(count * 3), scale: new Float32Array(count * 3), rot: new Float32Array(count * 4), color: new Uint8Array(count * 4) };
  const g = () => { let s = 0; for (let k = 0; k < 4; k++) s += R(); return (s - 2) * 1.732; };   // ~ unit gaussian
  const b = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  let i = 0;
  // a flat splat (thin along its normal n) at p; spin: an angle about n, or a direction for its long axis
  const put = (p, n, s0, s1, thin, rgb, a, spin = R() * Math.PI) => {
    if (i >= count) return;
    // the quaternion that turns +z onto n, then a spin about n
    const [nx, ny, nz] = n, d = nz, c = [-ny, nx, 0];   // cross(z, n)
    let qx, qy, qz, qw;
    if (d < -0.9999) { qx = 1; qy = 0; qz = 0; qw = 0; } else { const w0 = 1 + d, l = Math.hypot(c[0], c[1], c[2], w0); qx = c[0] / l; qy = c[1] / l; qz = c[2] / l; qw = w0 / l; }
    if (Array.isArray(spin)) {
      const ex = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy)];
      const ey = [ny * ex[2] - nz * ex[1], nz * ex[0] - nx * ex[2], nx * ex[1] - ny * ex[0]];
      spin = Math.atan2(spin[0] * ey[0] + spin[1] * ey[1] + spin[2] * ey[2], spin[0] * ex[0] + spin[1] * ex[1] + spin[2] * ex[2]);
    }
    const sh = Math.sin(spin / 2), ch = Math.cos(spin / 2);   // q * (spin about z)
    D.rot.set([qx * ch + qy * sh, qy * ch - qx * sh, qz * ch + qw * sh, qw * ch - qz * sh], i * 4);
    D.center.set(p, i * 3); D.scale.set([s0, s1, thin], i * 3);
    D.color.set([b(rgb[0]), b(rgb[1]), b(rgb[2]), b(a)], i * 4);
    i++;
  };
  const nHill = Math.round(count * 0.58), nRock = Math.round(count * 0.14), nWood = Math.round(count * 0.04), nLeaf = count - nHill - nRock - nWood;
  // splat sizes follow the spacing (the surface area over the count), so more splats are finer, not thicker: about as
  // many layers deep at any count, like a capture (the overdraw stays that of a real scene)
  const sp = (area, k) => Math.sqrt(area / Math.max(1, k)), spH = sp(140, nHill), spR = sp(7.5, nRock), spW = sp(4.5, nWood), spL = sp(44, nLeaf);
  // the hill: grass and earth, denser toward the top, a worn path of bare earth
  for (let k = 0; k < nHill; k++) {
    const r = HILL.radius * Math.sqrt(R()) * (0.35 + 0.65 * Math.sqrt(R())), th = R() * Math.PI * 2;
    const x = r * Math.cos(th), z = r * Math.sin(th), e = 0.04;
    const y = hillHeight(x, z) + 0.06 * (N(x * 1.3, 0, z * 1.3) - 0.5);
    const nx = -(hillHeight(x + e, z) - hillHeight(x - e, z)) / (2 * e), nz = -(hillHeight(x, z + e) - hillHeight(x, z - e)) / (2 * e), l = Math.hypot(nx, 1, nz);
    const patch = N(x * 0.6, 1, z * 0.6), path = Math.exp(-((z - 0.35 * x - 0.4) ** 2) / 0.12), dry = N2(x * 2.1, 0, z * 2.1);
    const earth = Math.min(1, path * 0.8 + Math.max(0, patch - 0.72) * 2.5);
    const grass = [0.22 + 0.2 * dry, 0.36 + 0.16 * dry + 0.06 * patch, 0.12 + 0.05 * dry], soil = [0.38, 0.29, 0.2];
    const v = 0.85 + 0.3 * R(), fade = Math.min(1, (HILL.radius - r) / 1.2);
    const rgb = grass.map((c, j) => (c * (1 - earth) + soil[j] * earth) * v);
    put([x, y + 0.01, z], [nx / l, 1 / l, nz / l], spH * (0.8 + 0.6 * R()), spH * (0.5 + 0.4 * R()), spH * 0.15, rgb, (0.55 + 0.4 * R()) * Math.max(0.1, fade));
  }
  // the rock: a lumpy, half-buried ellipsoid with lichen
  const [rx, , rz] = HILL.rock, ry = hillHeight(rx, rz) - 0.15;
  for (let k = 0; k < nRock; k++) {
    let u = g(), v = g(), w = g(); const l = Math.hypot(u, v, w) || 1; u /= l; v /= l; w /= l;
    const lump = 1 + 0.25 * (N(u * 2 + 5, v * 2, w * 2) - 0.5) + 0.06 * (N(u * 9, v * 9 + 3, w * 9) - 0.5);
    const p = [rx + u * 0.95 * lump, ry + Math.abs(v) * 0.7 * lump * (v > 0 ? 1 : 0.3), rz + w * 0.75 * lump];
    if (p[1] < hillHeight(p[0], p[2]) - 0.05) { k--; continue; }
    const lich = Math.max(0, N2(p[0] * 3, p[1] * 3, p[2] * 3) - 0.55) * 2.5, t = 0.42 + 0.14 * N(p[0] * 6, p[1] * 6, p[2] * 6) + 0.05 * g();
    const rgb = [t * (1 - lich) + 0.55 * lich, t * 0.98 * (1 - lich) + 0.58 * lich, t * 0.93 * (1 - lich) + 0.3 * lich];
    put(p, [u, v, w], spR * (0.8 + 0.5 * R()), spR * (0.6 + 0.4 * R()), spR * 0.1, rgb, 0.85 + 0.15 * R());
  }
  // the tree: a trunk and three boughs (elongated bark splats along the axis), then leafy clumps
  const [tx, , tz] = HILL.tree, ty = hillHeight(tx, tz) - 0.05;
  const limbs = [[[tx, ty, tz], [tx + 0.1, ty + 2.6, tz - 0.05], 0.16], [[tx + 0.05, ty + 1.7, tz], [tx + 1.0, ty + 2.9, tz + 0.4], 0.07],
    [[tx + 0.05, ty + 2.0, tz], [tx - 0.9, ty + 3.1, tz - 0.3], 0.07], [[tx + 0.1, ty + 2.5, tz], [tx + 0.2, ty + 3.6, tz - 0.7], 0.06]];
  for (let k = 0; k < nWood; k++) {
    const [a, c, r0] = limbs[k % 4 === 0 ? 0 : k % 7 < 4 ? 0 : 1 + (k % 3)], t = R();
    const ax = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(...ax), A = ax.map((v) => v / L);
    const side = Math.abs(A[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [A[1] * side[2] - A[2] * side[1], A[2] * side[0] - A[0] * side[2], A[0] * side[1] - A[1] * side[0]];
    const ul = Math.hypot(...u); u = u.map((v) => v / ul);
    const vv = [A[1] * u[2] - A[2] * u[1], A[2] * u[0] - A[0] * u[2], A[0] * u[1] - A[1] * u[0]];
    const th = R() * Math.PI * 2, rr = r0 * (1 - 0.45 * t) * (1 + 0.5 * Math.max(0, 0.15 - t)), n = u.map((x, j) => x * Math.cos(th) + vv[j] * Math.sin(th));
    const p = a.map((x, j) => x + ax[j] * t + n[j] * rr);
    const bark = 0.2 + 0.08 * N(p[0] * 8, p[1] * 20, p[2] * 8);
    put(p, n, spW * 1.8, spW * (0.6 + 0.3 * R()), spW * 0.1, [bark * 1.1, bark * 0.85, bark * 0.65], 0.95, A);   // long along the limb
  }
  const clumps = [[tx + 0.1, ty + 3.3, tz - 0.1, 1.15], [tx + 1.0, ty + 3.0, tz + 0.45, 0.8], [tx - 0.9, ty + 3.15, tz - 0.3, 0.85], [tx + 0.25, ty + 3.75, tz - 0.7, 0.7], [tx - 0.3, ty + 2.75, tz + 0.5, 0.6]];
  while (i < count) {
    const [cx, cy, cz, cr] = clumps[Math.floor(R() * clumps.length)];
    let u = g(), v = g(), w = g(); const l = Math.hypot(u, v, w) || 1; u /= l; v /= l; w /= l;
    const r = cr * (0.8 + 0.2 * R()) * (0.85 + 0.3 * N(u * 3, v * 3 + 2, w * 3));   // leaves on the clump's skin
    const p = [cx + u * r, cy + v * r * 0.8, cz + w * r];
    const out = r / cr, lit = 0.5 + 0.5 * v, hue = N2(p[0] * 2, p[1] * 2, p[2] * 2);
    const rgb = [(0.16 + 0.12 * hue) * (0.6 + 0.6 * lit * out), (0.3 + 0.12 * hue) * (0.6 + 0.6 * lit * out), 0.08 * (0.6 + 0.6 * lit)];
    const n = [g(), g(), g()], nl = Math.hypot(...n) || 1;
    put(p, n.map((x) => x / nl), spL * (0.7 + 0.5 * R()), spL * (0.45 + 0.3 * R()), spL * 0.1, rgb, 0.6 + 0.35 * R());
  }
  return D;
}

// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
// ---------------------------------------------------------------------------
// Seeded randomness. World code never calls Math.random: every generator is named, so one module's draws
// never shift another's, and every load builds the same world.
//
//   const R = rng('courtyard/jars');
//   R.float() R.range(a, b) R.int(a, b) R.pick(list) R.chance(p) R.sign() R.gauss(mu, sd) R.inDisc() R.onSphere()
//   R.fork('sub')   an independent generator derived from this one's seed
//
// Generator: SFC32 (Chris Doty-Humphrey's "small fast counting" generator) seeded through a 32-bit string hash
// (FNV-1a followed by a murmur3 finaliser). CPU noise for placement: valueNoise2 / fbm2.
// ---------------------------------------------------------------------------

export function hash32(input) {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  // avalanche (murmur3 fmix32)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** SFC32 stream: returns a function that yields floats in [0, 1). */
export function sfc32(seed) {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();   // warm up: the first outputs of a fresh state are correlated
  return next;
}

export function rng(seed = 'mirage') {
  const s = typeof seed === 'number' ? seed >>> 0 : hash32(seed);
  const next = sfc32(s);
  let spare = null;
  const R = {
    seed: s,
    next,
    float: (a = 0, b = 1) => a + (b - a) * next(),
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor((b - a + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss(mu = 0, sd = 1) {
      // Marsaglia polar method, keeping the second value
      if (spare !== null) { const v = spare; spare = null; return mu + sd * v; }
      let u, v, q;
      do { u = next() * 2 - 1; v = next() * 2 - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
      const f = Math.sqrt((-2 * Math.log(q)) / q);
      spare = v * f;
      return mu + sd * u * f;
    },
    inDisc() { const r = Math.sqrt(next()), a = next() * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)]; },
    onSphere() { const y = next() * 2 - 1, a = next() * Math.PI * 2, r = Math.sqrt(1 - y * y); return [r * Math.cos(a), y, r * Math.sin(a)]; },
    fork: (name) => rng(hash32(s + ':' + name)),
  };
  return R;
}

// integer lattice hash -> [0, 1)
function lattice(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1] (quintic fade), for CPU-side placement. */
export function valueNoise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed), c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
  const top = a + (b - a) * ux, bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/** Fractal sum of valueNoise2, normalised to [0, 1]. */
export function fbm2(x, y, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f + i * 31.7, y * f - i * 17.3, seed + i);
    norm += amp; amp *= 0.5; f *= 2.0;
  }
  return sum / norm;
}

// The lamp pool as the game changes it: the modules' lamps (shared.pool, as main.js handed them to world.lampPool)
// each with a factor the hacks set (a dark zone: near 0), plus lamps the game adds (the ammo crates' lights). The
// pool is set again only on a tick where something changed.
export function createLamps({ world, shared }) {
  const base = shared.pool || [], scale = new Float32Array(base.length).fill(1), extra = [];
  let dirty = false;
  return {
    base, scale, extra,
    /** a lamp of the game's own: { pos, range, power, color }; change its fields, then call touch() */
    add(l) { extra.push(l); dirty = true; return l; },
    touch() { dirty = true; },
    /** once a tick: the pool again if anything changed */
    flush() {
      if (!dirty || !world.lampPool) return false;
      dirty = false;
      const list = [];
      for (let i = 0; i < base.length; i++) list.push(scale[i] === 1 ? base[i] : { ...base[i], power: base[i].power * scale[i] });
      for (const l of extra) list.push(l);
      world.lampPool.set(list);
      return true;
    },
  };
}

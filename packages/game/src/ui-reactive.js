// Mirage original code. The reactive core of the UI toolkit: signals, computed values, effects and batches.
// No DOM, no framework: the DOM layer (ui-kit.js) and the canvas layer (ui-canvas.js) bind one effect per
// changing thing (a text node, one attribute, one style property), so a change re-runs exactly the effects that
// read it and nothing is diffed.
// ---------------------------------------------------------------------------
// const hp = signal(80), max = signal(100);
// const ratio = computed(() => hp.value / max.value);            // lazy, cached, re-run only when read after a change
// const stop = effect(() => { bar.style.transform = `scaleX(${ratio.value})`; });   // runs now and on change
// batch(() => { hp.value = 60; max.value = 120; });              // effects run once, after the batch
// hp.peek()  read without subscribing    untracked(fn)  the same for a block
// const s = store({ gold: 3, name: 'Ana' }); s.gold++            // an object whose own keys are signals
// scope(fn) -> [result, dispose]: every effect created inside is disposed together (a mounted subtree owns one)
// Glitch-free: a set marks dependants dirty (through computeds) and queues effects; they run after the outermost
// batch in creation order, each at most once, and read computeds that recompute on demand.
// ---------------------------------------------------------------------------

let current = null;        // the effect / computed being evaluated: reads subscribe it
let owner = null;          // the scope collecting disposers
let depth = 0;             // batch nesting
const queue = [];          // effects waiting for the batch to end
let flushing = false;
/** counters for tests and the perf check: effect runs and computed evaluations since the page started */
export const reactiveStats = { effects: 0, computes: 0 };

function track(node) {
  if (!current || current.deps.has(node)) return;
  current.deps.add(node); node.subs.add(current);
}
function unlink(obs) { for (const d of obs.deps) d.subs.delete(obs); obs.deps.clear(); }
// a changed source: computeds below it go dirty (and pass it on once), effects are queued once
function notify(node) {
  for (const s of [...node.subs]) {
    if (s.kind === 1) { if (!s.dirty) { s.dirty = true; notify(s); } }
    else if (!s.queued && !s.dead) { s.queued = true; queue.push(s); }
  }
}
function flush() {
  if (flushing) return;
  flushing = true;
  try {
    // creation order: a parent's effect (which may dispose children) runs before its children's
    for (let guard = 0; queue.length; guard++) {
      if (guard > 1e5) { queue.length = 0; throw new Error('ui-reactive: effects keep triggering each other'); }
      queue.sort((a, b) => a.id - b.id);
      const e = queue.shift();
      e.queued = false;
      if (!e.dead) e.run();
    }
  } finally { flushing = false; }
}
let ids = 0;

/** A value that effects and computeds can depend on. `equals` (default Object.is) decides what counts as a change. */
export function signal(initial, equals = Object.is) {
  const node = { subs: new Set() };
  let v = initial;
  const s = {
    get value() { track(node); return v; },
    set value(next) { if (equals(v, next)) return; v = next; notify(node); if (!depth) flush(); },
    peek: () => v,
    /** change in place (arrays, maps) and notify: update((list) => list.push(x)) */
    update(fn) { const r = fn(v); if (r !== undefined) v = r; notify(node); if (!depth) flush(); },
    subscribe: (fn) => effect(() => fn(s.value)),
    isSignal: true,
  };
  return s;
}

/** A cached derived value: evaluated on first read and again only after something it read has changed. */
export function computed(fn) {
  const c = { kind: 1, subs: new Set(), deps: new Set(), dirty: true, v: undefined };
  const read = (subscribe) => {
    if (subscribe) track(c);
    if (c.dirty) {
      unlink(c);
      const prev = current; current = c;
      try { c.v = fn(); reactiveStats.computes++; } finally { current = prev; }
      c.dirty = false;
    }
    return c.v;
  };
  return { get value() { return read(true); }, peek: () => read(false), isSignal: true, subscribe(f) { return effect(() => f(this.value)); } };
}

/** A derived value that notifies only when its result changes (a computed marks its readers dirty on every change
 *  of what it read): `memo(() => shown.value >= total)` flips its readers twice, not once per character. Owned by
 *  the scope it is made in. */
export function memo(fn, equals) {
  let s;
  effect(() => { const v = fn(); if (s) s.value = v; else s = signal(v, equals); });
  return s;
}

/** Run `fn` now and again whenever a signal it read changes. fn may return a cleanup. Returns dispose(). */
export function effect(fn) {
  const e = { kind: 2, id: ++ids, deps: new Set(), queued: false, dead: false, cleanup: null, run: null };
  e.run = () => {
    if (e.cleanup) { const c = e.cleanup; e.cleanup = null; c(); }
    unlink(e);
    const prev = current, prevOwner = owner;
    current = e; owner = null;   // effects created inside an effect are the caller's to dispose (use scope())
    depth++;
    try { const r = fn(); if (typeof r === 'function') e.cleanup = r; reactiveStats.effects++; }
    finally { current = prev; owner = prevOwner; depth--; }
    if (!depth) flush();
  };
  const dispose = () => { if (e.dead) return; e.dead = true; unlink(e); if (e.cleanup) { const c = e.cleanup; e.cleanup = null; c(); } };
  if (owner) owner.push(dispose);
  e.run();
  return dispose;
}

/** Several writes, one round of effects. Nested batches flush at the outermost end. Returns fn's result. */
export function batch(fn) {
  depth++;
  try { return fn(); } finally { if (!--depth) flush(); }
}
/** Read signals inside fn without subscribing the running effect. */
export function untracked(fn) {
  const prev = current; current = null;
  try { return fn(); } finally { current = prev; }
}
/** Collect every effect (and onCleanup) created while fn runs: [result, dispose]. */
export function scope(fn) {
  const mine = [], prev = owner;
  owner = mine;
  let result;
  try { result = untracked(fn); } finally { owner = prev; }
  let done = false;
  const dispose = () => { if (done) return; done = true; for (let i = mine.length - 1; i >= 0; i--) mine[i](); mine.length = 0; };
  if (prev) prev.push(dispose);
  return [result, dispose];
}
/** Register a cleanup with the scope being built (a component's listeners, timers). */
export function onCleanup(fn) { if (owner) owner.push(fn); return fn; }

/** A value as it is now: a signal's value, a function's result, or the thing itself. Subscribes when tracked. */
export const read = (v) => (v && v.isSignal ? v.value : typeof v === 'function' ? v() : v);
/** Whether a description value changes over time (a signal or a function). */
export const isReactive = (v) => typeof v === 'function' || !!(v && v.isSignal);

/** An object whose own enumerable keys are signals: reads subscribe per key, writes notify per key.
 *  Shallow on purpose (nested objects are replaced, not mutated); `$` gives the signals: s.$.gold. */
export function store(initial) {
  const sig = {};
  for (const k of Object.keys(initial)) sig[k] = signal(initial[k]);
  return new Proxy(sig, {
    get: (t, k) => (k === '$' ? t : k in t ? t[k].value : undefined),
    set: (t, k, v) => { if (k in t) t[k].value = v; else t[k] = signal(v); return true; },
    has: (t, k) => k in t, ownKeys: (t) => Reflect.ownKeys(t),
    getOwnPropertyDescriptor: (t, k) => (k in t ? { enumerable: true, configurable: true, value: t[k].peek() } : undefined),
  });
}

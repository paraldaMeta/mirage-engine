// Internal wiring shared by play and game. Release acquisitions in reverse order,
// including when a constructor throws before its public handle can be returned.
export function createLifetime() {
  const cleanups = [];
  let disposed = false;
  function defer(fn) {
    if (disposed) throw new Error('Lifetime already disposed');
    cleanups.push(fn);
  }
  function listen(target, type, listener, options) {
    // Older injected input targets support registration only. Disarm that callback too.
    const fn = target.removeEventListener ? listener : (...args) => listener?.(...args);
    target.addEventListener(type, fn, options);
    defer(() => { target.removeEventListener?.(type, fn, options); listener = null; });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    while (cleanups.length) {
      try { cleanups.pop()(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Could not release all resources');
  }
  return { defer, listen, dispose, get disposed() { return disposed; } };
}

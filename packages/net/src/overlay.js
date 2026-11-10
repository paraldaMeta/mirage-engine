// Mirage original code.
// ---------------------------------------------------------------------------
// The debug overlay: what the connection is doing, in a corner of the page, and the network simulator's keys.
//
//   const overlay = createNetOverlay(client, { conditions, session });   // nothing is created until this is called
//   each frame: overlay.update();          // re-reads client.stats twice a second, costs nothing in between
//   overlay.read()                         // the same numbers as an object (tests, your own HUD)
//   overlay.dispose();
//
// Lines: transport (websocket / relay / webrtc) and room; rtt, loss, interpolation delay; prediction error now and
// worst, corrections against exact matches; bytes a second in and out; bytes a second per entity type (what the
// snapshots spend on players, on pickups, ...); the simulated conditions if any.
//
// `conditions` is the object of a conditioned() transport on THIS side (transport.js); with it the keys work:
// [ and ] change latency by 25 ms, - and = loss by 1 %, 0 clears both. Without it the line is not shown.
// All text goes in with textContent: nothing from the network is parsed as HTML.
// ---------------------------------------------------------------------------

const rate = (now, was, dt) => Math.max(0, (now - was) / dt);

export function createNetOverlay(client, { parent = globalThis.document?.body, conditions = null, session = null, interval = 500, keys = true, now = () => performance.now() } = {}) {
  let last = now(), prev = null, values = { kind: '', rtt: 0, loss: 0, delay: 0, predErr: 0, predErrMax: 0, corrections: 0, exact: 0, bytesIn: 0, bytesOut: 0, byType: {}, entities: 0 };
  const el = parent ? parent.ownerDocument.createElement('pre') : null;
  if (el) {
    el.className = 'mirage-net-overlay';
    el.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#dfe;background:rgba(0,0,0,.6);border-radius:4px;pointer-events:none;z-index:20;white-space:pre';
    parent.appendChild(el);
  }
  const sample = () => {
    const s = client.stats, t = now(), dt = Math.max(1e-3, (t - last) / 1000);
    const cur = { bytesIn: s.bytesIn, bytesOut: s.bytesOut, byType: { ...s.byType } };
    if (prev && cur.bytesIn >= prev.bytesIn) {   // a reconnect starts the counters again: skip that one sample
      values.bytesIn = rate(cur.bytesIn, prev.bytesIn, dt); values.bytesOut = rate(cur.bytesOut, prev.bytesOut, dt);
      for (const k in cur.byType) values.byType[k] = rate(cur.byType[k], prev.byType[k] ?? 0, dt);
    }
    prev = cur; last = t;
    Object.assign(values, { kind: client.transport?.kind ?? '', rtt: s.rtt, loss: s.loss, delay: s.delay, predErr: s.predErr, predErrMax: s.predErrMax, corrections: s.corrections, exact: s.exact, entities: client.entities.size });
  };
  const draw = () => {
    if (!el) return;
    const v = values, f = (n, d = 0) => (+n || 0).toFixed(d);
    const lines = [
      `${client.status}${v.kind ? ' · ' + v.kind : ''}${session?.mode ? ' · ' + session.mode : ''}${client.code ? ' · room ' + client.code : ''} · ${client.tickRate || '?'} Hz`,
      `rtt ${f(v.rtt)} ms   loss ${f(v.loss * 100, 1)} %   delay ${f(v.delay)} ms`,
      `predict err ${f(v.predErr * 100, 1)} cm (max ${f(v.predErrMax * 100, 1)})   corrected ${v.corrections} / exact ${v.exact}`,
      `in ${f(v.bytesIn)} B/s   out ${f(v.bytesOut)} B/s   entities ${v.entities}`,
      ...Object.entries(v.byType).map(([k, b]) => `  ${k.padEnd(10)} ${f(b).padStart(6)} B/s`),
    ];
    if (conditions) lines.push(`sim: latency ${f(conditions.latency)} ms  loss ${f(conditions.loss * 100)} %   keys [ ] - = 0`);
    el.textContent = lines.join('\n');
  };
  const onKey = (e) => {
    if (!conditions || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
    const c = conditions;
    if (e.key === '[') c.latency = Math.max(0, (c.latency || 0) - 25);
    else if (e.key === ']') c.latency = Math.min(1000, (c.latency || 0) + 25);
    else if (e.key === '-') c.loss = Math.max(0, Math.round(((c.loss || 0) - 0.01) * 100) / 100);
    else if (e.key === '=') c.loss = Math.min(0.5, Math.round(((c.loss || 0) + 0.01) * 100) / 100);
    else if (e.key === '0') { c.latency = 0; c.loss = 0; c.jitter = 0; }
    else return;
    draw();
  };
  if (keys && conditions) globalThis.addEventListener?.('keydown', onKey);
  sample(); draw();
  return {
    el, values,
    update() { if (now() - last >= interval) { sample(); draw(); } },
    read() { return { ...values, byType: { ...values.byType }, conditions: conditions ? { latency: conditions.latency || 0, loss: conditions.loss || 0 } : null }; },
    dispose() { globalThis.removeEventListener?.('keydown', onKey); el?.remove(); },
  };
}

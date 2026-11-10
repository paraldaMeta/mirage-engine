// Mirage original code. What the audio engine is doing, as text and as a small overlay: voices sounding and virtual,
// what was stolen or dropped, rays spent on occlusion, reverb zone weights, and a level meter for every bus.
// ---------------------------------------------------------------------------
// const dbg = createAudioDebug(engine, { parent: document.body, rate: 10 })     refreshed from engine.update
// dbg.text()         the stat block as a string (also what the overlay prints above the meters)
// dbg.toggle()       dbg.dispose()
// ponytail: meters read the last ~21 ms at the refresh rate, so short peaks between refreshes are missed.
// ---------------------------------------------------------------------------
/** the stat block: one string, the same from a test as on screen */
export function audioStatsText(engine) {
  const s = engine.stats, z = Object.entries(s.zones).filter(([, w]) => w > 0).map(([n, w]) => `${n} ${w.toFixed(2)}`).join('  ');
  return [
    `audio ${s.state}  t ${s.time.toFixed(2)} s`,
    `voices ${s.voices} / ${engine.cap}  virtual ${s.virtual}  peak ${s.peak}  hrtf ${s.hrtf}  streams ${s.streams}`,
    `started ${s.started}  ended ${s.ended}  stolen ${s.stolen}  culled ${s.culled}  resumed ${s.resumed}  dropped ${s.dropped}  cooldown ${s.cooled}`,
    `rays ${s.rays} / update  (${s.raysTotal} in all)   assets ${s.assets.count}  ${(s.assets.bytes / 1048576).toFixed(1)} MB  decode ${s.assets.decodeMs.toFixed(0)} ms`,
    z ? `zones ${z}` : 'zones -',
  ].join('\n');
}

export function createAudioDebug(engine, { parent = globalThis.document?.body, rate = 10, visible = true } = {}) {
  let el = null, pre = null, bars = null, acc = 1;
  const rows = new Map();
  if (parent && globalThis.document) {
    el = document.createElement('div');
    el.setAttribute('data-mirage-audio-debug', '');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.35 ui-monospace,Menlo,monospace;color:#dfe;background:rgba(8,12,16,.78);padding:8px 10px;border-radius:6px;pointer-events:none;white-space:pre;min-width:300px';
    pre = document.createElement('div'); bars = document.createElement('div');
    el.append(pre, bars); parent.append(el);
    el.style.display = visible ? '' : 'none';
  }
  const dbg = {
    el,
    text: () => audioStatsText(engine),
    toggle(on = el ? el.style.display === 'none' : false) { if (el) el.style.display = on ? '' : 'none'; return on; },
    update(dt = 0) {
      acc += dt;
      if (!el || el.style.display === 'none' || acc < 1 / rate) return;
      acc = 0;
      pre.textContent = audioStatsText(engine);
      for (const [name, v] of Object.entries(engine.meters())) {
        let r = rows.get(name);
        if (!r) {
          r = { row: document.createElement('div'), fill: document.createElement('span'), label: document.createElement('span') };
          r.row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px';
          const track = document.createElement('span');
          track.style.cssText = 'display:inline-block;width:140px;height:6px;background:#233;border-radius:3px;overflow:hidden';
          r.fill.style.cssText = 'display:block;height:100%;width:0;background:#5d9';
          track.append(r.fill); r.row.append(track, r.label); bars.append(r.row); rows.set(name, r);
        }
        // -60 dB .. 0 dB across the bar; amber near full scale, red over it
        r.fill.style.width = (((Math.max(v.rmsDb, -60) + 60) / 60) * 100).toFixed(1) + '%';
        r.fill.style.background = v.peak > 1 ? '#e55' : v.peakDb > -6 ? '#eb5' : '#5d9';
        r.label.textContent = `${name} ${v.rms > 0 ? v.rmsDb.toFixed(1) : '-inf'} dB`;
      }
    },
    dispose() { engine.systems.delete(dbg); el?.remove(); rows.clear(); },
  };
  engine.systems.add(dbg);
  return dbg;
}

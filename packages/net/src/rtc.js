// Mirage original code.
// ---------------------------------------------------------------------------
// A WebRTC data channel as a transport: unreliable and unordered (ordered: false, maxRetransmits: 0), which is
// what channel.js is written for: a lost snapshot is not sent again and does not hold up the next one, where a
// WebSocket (TCP) stalls everything behind one lost segment. Browser to browser only: Node has no WebRTC of its
// own, so a Node server speaks WebSocket and data channels serve the browser-host mode (host.js).
//
//   const t = rtcTransport({ initiator: true, signal: (data) => lobby.signal(hostKey, data) });
//   lobby.onsignal = ({ data }) => t.signal(data);       // offers, answers and candidates go through the lobby
//   await t.ready;                                        // rejects after `timeout` ms: keep using the relay
//
// `iceServers` is empty by default: nothing outside this machine or LAN is contacted. Two players behind
// different routers need a STUN server, and some pairs a TURN relay; pass your own (docs/multiplayer.md).
// The channel is pre-negotiated (id 0), so there is no "datachannel" event to wait for and both ends are symmetric.
// Signalling data from the other side is checked for shape and size before the browser parses it.
// ---------------------------------------------------------------------------

export function rtcTransport({ initiator = false, signal, iceServers = [], timeout = 6000, RTCPeerConnectionImpl = globalThis.RTCPeerConnection } = {}) {
  const t = { kind: 'webrtc', reliable: false, open: false, onmessage: null, onclose: null, onopen: null, pc: null, failed: false,
    send(u) { if (t.open) try { dc.send(u); } catch { /* buffer full: a lost packet */ } },
    close(why) { end(why || 'closed'); },
    signal: () => {}, ready: null };
  if (!RTCPeerConnectionImpl) { t.failed = true; t.close = () => {}; t.ready = Promise.reject(new Error('mirage net: no WebRTC here')); t.ready.catch(() => {}); return t; }   // Node, or a browser without it: the fallback carries everything
  const pc = t.pc = new RTCPeerConnectionImpl({ iceServers });
  const dc = pc.createDataChannel('mirage', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
  dc.binaryType = 'arraybuffer';
  let ended = false, remote = false, okReady, noReady;
  const early = [];
  t.ready = new Promise((ok, no) => { okReady = ok; noReady = no; });
  t.ready.catch(() => {});
  const timer = setTimeout(() => { if (!t.open) end('webrtc timeout'); }, timeout);
  function end(why) {
    if (ended) return;
    ended = true; clearTimeout(timer);
    const was = t.open; t.open = false; t.failed = !was;
    try { dc.close(); pc.close(); } catch { /* closed */ }
    noReady(new Error('mirage net: ' + why));
    t.onclose?.(why);
  }
  dc.onopen = () => { if (ended) return; t.open = true; clearTimeout(timer); okReady(t); t.onopen?.(); };
  dc.onclose = () => end('closed');
  dc.onmessage = (e) => { if (e.data instanceof ArrayBuffer && e.data.byteLength <= 1500) t.onmessage?.(new Uint8Array(e.data)); };
  pc.onicecandidate = (e) => { if (e.candidate) signal?.({ ice: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end('connection ' + pc.connectionState); };
  const fail = (err) => end('webrtc: ' + (err?.message || err));
  t.signal = async (data) => {
    if (ended || !data || typeof data !== 'object') return;
    try {
      if (data.sdp && typeof data.sdp === 'object') {
        const { type, sdp } = data.sdp;
        if (remote || (type !== 'offer' && type !== 'answer') || typeof sdp !== 'string' || sdp.length > 12000 || (type === 'offer') === initiator) return;
        remote = true;
        await pc.setRemoteDescription({ type, sdp });
        if (type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); signal?.({ sdp: pc.localDescription.toJSON() }); }
        for (const c of early.splice(0)) await pc.addIceCandidate(c);
      } else if (data.ice && typeof data.ice === 'object') {
        const { candidate, sdpMid, sdpMLineIndex } = data.ice;
        if (typeof candidate !== 'string' || candidate.length > 1000) return;
        const c = { candidate, sdpMid: typeof sdpMid === 'string' ? sdpMid.slice(0, 32) : null, sdpMLineIndex: Number.isInteger(sdpMLineIndex) ? sdpMLineIndex : null };
        if (remote) await pc.addIceCandidate(c); else if (early.length < 32) early.push(c);
      }
    } catch (err) { fail(err); }
  };
  if (initiator) pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => signal?.({ sdp: pc.localDescription.toJSON() })).catch(fail);
  return t;
}

/** Send over `better` while it is open, over `fallback` otherwise; receive from both (the channel above drops
 *  duplicates and old packets). `kind` says which one carries the traffic now. */
export function preferTransport(fallback, better) {
  const t = { reliable: false, onmessage: null, onclose: null, fallback, better,
    get kind() { return better?.open ? better.kind : fallback.kind; },
    get open() { return fallback.open || !!better?.open; },
    send(u) { if (better?.open) better.send(u); else fallback.send(u); },
    close(why) { if (better) { better.onclose = null; better.close(why); } fallback.close(why); } };
  fallback.onmessage = (u) => t.onmessage?.(u);
  fallback.onclose = (why) => { if (better) { better.onclose = null; better.close(why); } t.onclose?.(why); };   // the relay is the lifeline: without it the peer is gone
  if (better) better.onmessage = (u) => t.onmessage?.(u);
  return t;
}

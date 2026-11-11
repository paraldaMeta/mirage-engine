// The story's frame and the robots' voice: a short, self-contained tale with a sting in the tail.
//   cold open    three lines over the first seconds of the mission
//   the handler  the radio's name tag goes slightly wrong as the route goes on (CONTROL, C0NTR0L, ...); a slip of
//                the tongue at the relay door, another on the roof
//   clues        the pass card's issuer (a radio line when it is taken), a banter line ("there is no Control"), the
//                handler's "we"
//   the twist    when the uplink completes: the handler is the relay's own machine mind, and the player has just let
//                it out. Three radio lines, every low sign on the street stutters, and a closing card with one line.
//   holdout      a one-line epigraph instead
//   banter       idle sentinels at their posts trade deadpan pairs when the player is within earshot and unseen
//                (a subtitle over each speaker and the radio blip); state barks (alert, hurt, hacked, ...) in the
//                same voice, at most one every 1.2 s, the nearest first
//   hit words    comic words in the world on a head shot, a shield breaking, an EMP and an overload (opts.pops)
export function createStory({ game, enemies, hud, overlay, sfx, player, T, hack, opts, holdout }) {
  const X = T.xt, ST = X.story;
  let rnd = 0x1f83d9ab, stage = -1, banterT = 6, banterI = 0, barkGap = 0, twistT = -1, closeShown = false, coldDone = false;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  const voice = (e) => ({ grunt: 0, shield: 0, heavy: 2, marksman: 1 }[e.K.name] ?? 0);
  const tag = (e) => T.kinds[e.K.name] || '';
  const headOf = (e) => () => (e.dead || !e.rig.root.visible ? null : [e.pos[0], e.pos[1] + 2.05 * e.K.scale, e.pos[2]]);
  const speak = (e, text, sec = 3) => { overlay.say(text, headOf(e), tag(e).toUpperCase(), sec); sfx.play('nd_blip', { at: [e.pos[0], e.pos[1] + 1.6, e.pos[2]], gain: 0.7, ref: 4, rate: [1, 1.22, 0.78][voice(e)] * (0.96 + R() * 0.08) }); };
  const pick = (a) => a[Math.floor(R() * a.length)];
  enemies.on.bark = (e, key) => {
    const lines = X.barks[key];
    if (!lines || barkGap > 0 || player.dead) return;
    if (Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) > 26) return;
    barkGap = 1.2; speak(e, pick(lines), 2.4);
  };
  const POP_KIND = { head: 'head', shield: 'shield', emp: 'emp', overload: 'overload' };
  /** a comic word (when the option is on) */
  function pop(kind, pos) { if (opts.pops === false) return; overlay.pop(pick(X.pops[kind]), pos, POP_KIND[kind]); }
  enemies.on.pop = pop;
  // the handler's tag, by how far the route has gone
  const setStage = (n) => { if (n <= stage) return; stage = n; T.control = ST.labels[Math.min(n, ST.labels.length - 1)]; };
  game.on('start', () => {
    if (game.flags.holdout || holdout.on) { overlay.card([ST.epigraph], 7); return; }
    if (!coldDone) { coldDone = true; overlay.card(ST.cold, 9, true); }
    setStage(0);
  });
  // a banter pair at a post: the speaker and a neighbour within 9 m (or the speaker alone, to its radio)
  function banter(dt) {
    if ((banterT -= dt) > 0) return;
    banterT = 4;
    const near = enemies.list.filter((e) => !e.dead && e.active && e.rig.root.visible && e.state === 'post' && Math.hypot(e.pos[0] - player.feet[0], e.pos[2] - player.feet[2]) < 17);
    if (!near.length || player.dead) return;
    const a = near[Math.floor(R() * near.length)];
    const b = enemies.list.find((o) => o !== a && !o.dead && o.active && o.state === 'post' && Math.hypot(o.pos[0] - a.pos[0], o.pos[2] - a.pos[2]) < 9) || a;
    const lines = X.banter[banterI++ % X.banter.length];
    lines.forEach((l, i) => setTimeout(() => { if (a.state === 'post' && !a.dead) speak(i % 2 ? b : a, l, 3); }, i * 3000));
    banterT = 10 + lines.length * 3;
    game.set('banter', (game.flags.banter || 0) + 1);
  }
  function update(dt) {
    barkGap = Math.max(0, barkGap - dt);
    if (holdout.on) return;
    banter(dt);
    const f = game.flags;
    if (game.inventory?.has?.('pass') && stage < 1) { setStage(1); hud.radio(ST.pass); }
    if (f.doorOpen && stage < 2) { setStage(2); hud.radio(ST.door); }
    if (f.cp_roof && stage < 3) { setStage(3); hud.radio(ST.roof); }
    if (f.done && stage < 4) { setStage(4); for (const l of ST.twist) hud.radio(l); hack.flickerAll(6); twistT = 0; }
    if (twistT >= 0 && !closeShown) {
      twistT += dt;
      // the closing card once the end dialog is closed (or after half a minute)
      if ((twistT > 4 && !document.querySelector('.mg-msg[open]')) || twistT > 30) { closeShown = true; overlay.card([ST.close], 12); game.set('closed', true); }
    }
  }
  return { update, pop };
}

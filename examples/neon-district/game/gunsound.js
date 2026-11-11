// The guns' sounds and the rest of the feel's: the engine's sound library (@miragekit/game/sounds, which grew out of
// this file) under the names the game has always used (nd_*). Rendered offline into sample buffers a few at a time
// after the first gesture (sfx.js); scripts/sfx-check.mjs renders the same functions in headless Chrome and measures
// them. Exports: ENVS, GUNS, SOUNDS (name -> { n: variants, render(SR, v) -> Float32Array, loop? }), ORDER,
// renderSound().
import { SOUNDS as LIB, SOUND_SPACES, GUNS as LIB_GUNS } from '@miragekit/game/sounds';

export const ENVS = SOUND_SPACES;
export const GUNS = LIB_GUNS;

/** the game's name -> the library's */
const NAME = {};
for (const g of GUNS) for (const r of ENVS) NAME[`nd_shot_${g}_${r}`] = `shot_${g}_${r}`;
for (const r of ENVS) Object.assign(NAME, { [`nd_gat_loop_${r}`]: `gatling_loop_${r}`, [`nd_gat_tail_${r}`]: `gatling_tail_${r}`, [`nd_rkt_launch_${r}`]: `rocket_launch_${r}`, [`nd_rkt_boom_${r}`]: `explosion_${r}` });
Object.assign(NAME, {
  nd_dry_light: 'dry_light', nd_dry_heavy: 'dry_heavy', nd_mag_out: 'mag_out', nd_mag_in: 'mag_in', nd_bolt_rack: 'bolt_rack', nd_slide: 'slide',
  nd_pump: 'pump', nd_shell_in: 'shell_in', nd_rkt_load: 'rocket_load', nd_brass: 'brass', nd_hull: 'shell_hull',
  nd_imp_concrete: 'impact_concrete', nd_imp_metal: 'impact_metal', nd_imp_glass: 'impact_glass', nd_imp_armour: 'impact_armour', nd_whizz: 'whizz',
  nd_bolt: 'energy_bolt', nd_bolt_far: 'energy_bolt_far', nd_heart: 'heartbeat', nd_land: 'land', nd_unlock: 'unlock', nd_draw: 'weapon_draw',
  nd_gat_motor: 'gatling_motor', nd_gat_spindown: 'gatling_spindown', nd_gat_vent: 'gatling_vent',
});
/** every sound the game adds: name -> { n (variants), render(SR, v) -> Float32Array, loop?, kind?, gun?, room? } */
export const SOUNDS = {};
for (const [nd, lib] of Object.entries(NAME)) {
  const s = LIB[lib], m = nd.match(/^nd_(shot|gat_loop|gat_tail|rkt_launch|rkt_boom)_(?:(\w+?)_)?(alley|open|indoor)$/);
  SOUNDS[nd] = { n: s.n, render: s.render, ...(s.loop ? { loop: true } : {}), ...(m ? { kind: m[1] === 'rkt_boom' ? 'boom' : m[1] === 'gat_loop' ? 'loop' : 'shot', gun: m[2] || (m[1].startsWith('gat') ? 'gatling' : 'rocket'), room: m[3] } : {}) };
}
/** the order the game makes them in: what is heard first comes first */
export const ORDER = Object.keys(SOUNDS).sort((a, b) => rank(a) - rank(b));
function rank(n) { return /carbine/.test(n) ? 0 : /pistol|shotgun_/.test(n) ? 1 : /bolt|imp_|dry|mag|brass|draw|whizz/.test(n) ? 2 : 3; }
/** render one variant of a named sound */
export const renderSound = (name, SR, v = 0) => SOUNDS[name].render(SR, v);

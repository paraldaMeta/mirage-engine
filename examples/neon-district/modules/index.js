// The modules of neon-district in build order: the ground first, then what stands on it, the interiors, and last
// the signs (it consumes every `signs` anchor in finalize).
import ground from './ground.js';
import blocks from './blocks.js';
import street from './street.js';
import bar from './bar.js';
import relay from './relay.js';
import plaza from './plaza.js';
import facades from './facades.js';
import megastructure from './megastructure.js';
import clutter from './clutter.js';
import signs from './signs.js';
export default [ground, blocks, facades, megastructure, street, clutter, bar, relay, plaza, signs];

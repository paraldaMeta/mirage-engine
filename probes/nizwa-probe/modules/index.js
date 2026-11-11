// build order: the ground, the fort (offers `lamps`), the lanterns (consume them in finalize)
import ground from './ground.js';
import fort from './fort.js';
import lamps from './lamps.js';
export default [ground, fort, lamps];
